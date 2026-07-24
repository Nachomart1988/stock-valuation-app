"""
Ultimate Predictor Engine v2 — predictor de movimientos explosivos
==================================================================

La pieza más ambiciosa del /backtest (GOD MODE): el usuario elige SOLO un rango
de precio y un rango de market cap, y el motor produce el **Top 5 de trades
para la próxima sesión** apuntando a MOVIMIENTOS EXPLOSIVOS — surges al estilo
Edge Finder (+30% en ≤5 días) al alza, y desplomes espejo a la baja — cada uno
validado por un backtest propio antes de ser publicado.

Novedad v2 — **red neuronal con aprendizaje día a día**:

  - En cada corrida, el escaneo del universo cosecha ejemplos de entrenamiento:
    para cada símbolo se localizan los surges históricos (misma definición que
    el Edge Finder: base = cierre de D-1, el surge arranca con día verde, pico
    = high máximo de la ventana) y los desplomes espejo; el día previo (D-1) se
    convierte en ejemplo positivo y días aleatorios sin surge en negativos.
  - Los ejemplos se ACUMULAN en SQLite local (``ultimate_predictor.db``,
    tabla ``training_data``): el dataset crece con cada corrida diaria.
  - Un MLP PyTorch (27 features → 64 → 32 → 2 cabezas: P(surge↑), P(crash↓))
    se re-entrena en cada corrida sobre el dataset completo, con early stop y
    AUC de validación reportado en la UI.
  - Cuando una predicción publicada se califica contra los precios reales, su
    vector de features entra al dataset con la etiqueta VERDADERA y peso ×3:
    el motor aprende de sus propios aciertos y errores (feedback loop real).
  - Si torch no está disponible o el dataset aún es chico, cae al score
    heurístico v1 (los drivers heurísticos siempre se calculan y se muestran
    como explicación).

Sigue orquestando los motores existentes: universo + caché + clasificador de
patrones del Edge Finder, mecánica D→D+1 conservadora de Estrategia 1 / Gap
Short (stop primero si la barra toca ambos), y veto de dilución EDGAR para
longs de baja capitalización.

Pipeline por corrida:
  A. Califica predicciones anteriores → track record + ejemplos peso ×3.
  B. Contexto de mercado (SPY/ETFs, régimen) con mapas por-fecha para features.
  C. Escaneo del universo al último cierre: features NN + setups elegibles
     (long: cerca del disparo 10d; short: sobre-extensión) + cosecha de
     ejemplos históricos.
  D. Entrenamiento de la red (dataset acumulado) y scoring P(explosión).
  E. Validación por backtest propio: replay del mismo setup sobre ~1 año del
     propio símbolo con target = movimiento explosivo esperado (mediana de SUS
     surges, o la global); si su historia no paga, se descarta.
  F. Veto de dilución (EDGAR) para longs < $2B; en shorts se anota a favor.
  G. Publica el Top 5 para el próximo día hábil y persiste cada pick (con su
     vector de features) para auto-calificarse y re-alimentar la red.

Limitaciones documentadas (se muestran en la UI):
  - Universo point-in-time del screener → sesgo de supervivencia/look-ahead.
  - Validación con barras diarias, stop-primero conservador; sin borrow/locate.
  - «Próximo día hábil» salta fines de semana, no feriados.
  - La red se entrena con datos del propio universo escaneado — más corridas y
    más días ⇒ mejor dataset (el motor está diseñado para correr a diario).

Expuesto vía POST /backtest/ultimate/start (job async), GET
/backtest/ultimate/status/{id} y GET /backtest/ultimate/history. El gráfico
por pick reutiliza POST /backtest/edge-predictor/chart.

Screener estadístico + validación histórica — no es consejo de inversión.
"""

from __future__ import annotations

import os
import json
import time
import uuid
import sqlite3
import logging
import threading
from contextlib import closing
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from edge_finder_engine import (
    EdgeFinderEngine,
    get_edge_finder_engine,
    MARKET_CAP_BUCKETS,
    CAP_ORDER,
    SECTOR_ETF,
    SECTOR_RET_WINDOW,
    PRE_BARS,
    VOL_AVG_WINDOW,
    PAT_CAPITULATION,
    PAT_PULLBACK,
    PAT_MOMENTUM,
    PAT_UPTREND,
    PAT_COIL,
    PAT_FLAT,
    PAT_CHOPPY,
)

try:
    import torch
    import torch.nn as nn
    TORCH_AVAILABLE = True
except Exception:  # noqa: BLE001
    TORCH_AVAILABLE = False

logger = logging.getLogger(__name__)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# La memoria del motor (dataset, modelo, track record) DEBE sobrevivir a los
# deploys. En hosts efímeros (Railway/Render) el filesystem se borra en cada
# deploy: define ULTIMATE_DATA_DIR apuntando a un volumen persistente
# (p.ej. /data) o toda la memoria se pierde con cada push.
_DATA_DIR = os.environ.get("ULTIMATE_DATA_DIR") or _BASE_DIR
try:
    os.makedirs(_DATA_DIR, exist_ok=True)
except OSError:
    _DATA_DIR = _BASE_DIR
DB_PATH = os.path.join(_DATA_DIR, "ultimate_predictor.db")
MODEL_PATH = os.path.join(_DATA_DIR, "ultimate_predictor_model.pt")
EPHEMERAL_STORAGE = os.environ.get("ULTIMATE_DATA_DIR") is None and (
    os.environ.get("RAILWAY_ENVIRONMENT") is not None
    or os.environ.get("RENDER") is not None)

# ── Objetivo: movimientos explosivos (misma definición que el Edge Finder) ───
SURGE_DAYS = 5             # ventana del movimiento explosivo (3-5 días)
SURGE_PCT_MIN = 30.0       # surge alcista: +30% del cierre base al high máximo
CRASH_PCT_MIN = 25.0       # espejo bajista: −25% del cierre base al low mínimo

# ── Mecánica del trade (D+1, barras diarias, conservador) ────────────────────
MAX_HOLD_DAYS = SURGE_DAYS # salida forzada al cierre del 5º día
MAX_CHASE_PCT = 5.0        # si abre >5% pasado el nivel de entrada → sin fill
MIN_RISK_PCT = 1.0         # piso duro del riesgo (%)
MAX_RISK_PCT = 18.0        # techo del riesgo (%) — nombres explosivos necesitan aire
# El stop NUNCA debe quedar más ajustado que el ruido diario: un stop dentro del
# ATR se barre casi siempre (era la causa de la epidemia de −1R). El riesgo
# mínimo efectivo es max(MIN_RISK_PCT, ATR_STOP_MULT × ATR% diario).
ATR_STOP_MULT = 1.3
STOP_BARS_LONG = 5         # stop long = low de las últimas 5 sesiones
STOP_BARS_SHORT = 2        # stop short = high de las últimas 2 sesiones
MIN_RR = 1.5               # estructura mínima: (target−entry)/riesgo

# ── Elegibilidad de setups al último cierre ──────────────────────────────────
LONG_NEAR_TRIGGER_PCT = 8.0    # cierre a ≤8% del high de 10 días
LONG_MIN_RET10 = -10.0         # no comprar cuchillos en caída libre
SHORT_RET10_MIN = 20.0         # sobre-extensión: +20% en 10 días…
SHORT_CONSEC_GREEN_MIN = 3     # …o 3+ días verdes seguidos
MIN_DOLLAR_VOL = 300_000       # liquidez mínima (precio × vol promedio 20d)
MIN_ATR_PCT = 1.5              # sin rango no hay explosión
MIN_SCORE = 40.0               # piso heurístico (solo en modo sin red)
STALE_DAYS = 7                 # ticker "muerto" si su última barra es vieja
MIN_BARS = 90                  # historia mínima para escanear + validar

# ── Gates de la validación histórica (backtest propio del candidato) ─────────
# Con targets explosivos los wins son raros pero enormes: el gate clave es la
# expectancy; el win rate mínimo baja respecto de v1.
VAL_MIN_EVENTS = 5
VAL_MIN_FILLS = 4
VAL_MIN_EXPECTANCY = 0.05  # R promedio por trade ejecutado
VAL_MIN_WINRATE = 12.0     # % (target ~5R: 20% ya es muy rentable)

PRELIM_POOL = 60           # candidatos que entran a la fase de validación
TOP_N = 5                  # SIEMPRE se buscan 5 picks

# ── Veto de dilución (SEC EDGAR — lento, con presupuesto) ────────────────────
DILUTION_CAP_MAX = 2_000_000_000
DILUTION_REJECT_SCORE = 70
DILUTION_TIME_BUDGET_S = 90.0
DILUTION_MAX_CHECKS = 8

# ── Red neuronal ─────────────────────────────────────────────────────────────
PATTERN_ORDER = [PAT_CAPITULATION, PAT_PULLBACK, PAT_MOMENTUM, PAT_UPTREND,
                 PAT_COIL, PAT_FLAT, PAT_CHOPPY]
# fv2: se suma el bloque de "previa de volumen" (los grandes movimientos suelen
# telegrafiarse en el volumen): secuencia de ratios de los últimos 5 días,
# dry-up, pocket pivots (días >2× promedio), share de volumen en días verdes
# (acumulación vs distribución), expansión de rango y log(market cap).
N_BASE_FEATURES = 29
N_FEATURES = N_BASE_FEATURES + len(PATTERN_ORDER)   # 36
FEAT_VERSION = "fv2"

MIN_TRAIN_ROWS = 800       # bajo esto, la red no entrena (modo heurístico)
MAX_TRAIN_ROWS = 250_000   # techo del dataset cargado en memoria
NEG_PER_POS = 3            # negativos muestreados por cada positivo
MAX_ROWS_PER_SYMBOL = 60
GRADED_SAMPLE_WEIGHT = 3.0 # peso de los ejemplos que vienen de picks calificados
TRAIN_MAX_EPOCHS = 40
TRAIN_PATIENCE = 6
TRAIN_BATCH = 512

# ── Pesos del score heurístico (drivers explicativos + fallback) ─────────────
LONG_W = {"trigger": 25.0, "pattern": 15.0, "volume": 15.0, "sector": 15.0,
          "trend": 15.0, "risk": 15.0}
SHORT_W = {"overext": 25.0, "fatigue": 20.0, "volume": 15.0, "sector": 10.0,
           "high52": 15.0, "risk": 15.0}

PATTERN_LONG_QUALITY = {
    PAT_COIL: 1.0, PAT_FLAT: 1.0, PAT_UPTREND: 0.85, PAT_PULLBACK: 0.7,
    PAT_MOMENTUM: 0.6, PAT_CHOPPY: 0.4, PAT_CAPITULATION: 0.2,
}


# ═══════════════════════════════════════════════════════════════════════════
#  Job registry (in-process; registro propio, separado de los otros motores)
# ═══════════════════════════════════════════════════════════════════════════
_JOBS: Dict[str, Dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SECONDS = 60 * 60


def _set_job(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id, {})
        job.update(fields)
        _JOBS[job_id] = job


def _prune_jobs() -> None:
    now = time.time()
    with _JOBS_LOCK:
        stale = [jid for jid, j in _JOBS.items()
                 if now - j.get("created_at", now) > _JOB_TTL_SECONDS]
        for jid in stale:
            _JOBS.pop(jid, None)


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Return a serializable snapshot of a job, or None if unknown."""
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return None
        snap = {
            "job_id": job_id,
            "status": job.get("status"),
            "progress": job.get("progress", 0),
            "stage": job.get("stage", ""),
            "error": job.get("error"),
        }
        if job.get("status") == "done":
            snap["result"] = job.get("result")
        return snap


# ═══════════════════════════════════════════════════════════════════════════
#  Helpers de calendario, precios y simulación
# ═══════════════════════════════════════════════════════════════════════════
def _next_trading_day(date_str: str) -> str:
    """Próximo día hábil (salta sábados/domingos; feriados no modelados)."""
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def _px(x: float) -> float:
    return round(float(x), 4 if x < 1 else 2)


def _plan_levels(side: str, entry: float, raw_stop: float,
                 exp_move_pct: float, atr_pct: float = 0.0
                 ) -> Tuple[float, float, float, float]:
    """(stop, target, risk, rr) — el stop respeta la estructura (low/high
    reciente) PERO nunca queda más ajustado que ATR_STOP_MULT×ATR (para no ser
    barrido por el ruido); riesgo acotado a [min, MAX_RISK_PCT]. El target es el
    movimiento explosivo esperado, no un múltiplo fijo de R."""
    min_risk = max(MIN_RISK_PCT, ATR_STOP_MULT * float(atr_pct or 0.0))
    min_risk = min(min_risk, MAX_RISK_PCT)
    if side == "long":
        stop = min(raw_stop, entry * (1 - min_risk / 100))   # al menos min_risk lejos
        stop = max(stop, entry * (1 - MAX_RISK_PCT / 100))    # pero no más que el techo
        risk = entry - stop
        target = entry * (1 + exp_move_pct / 100)
        rr = (target - entry) / risk if risk > 0 else 0.0
    else:
        stop = max(raw_stop, entry * (1 + min_risk / 100))
        stop = min(stop, entry * (1 + MAX_RISK_PCT / 100))
        risk = stop - entry
        target = entry * (1 - exp_move_pct / 100)
        rr = (entry - target) / risk if risk > 0 else 0.0
    return _px(stop), _px(target), risk, round(rr, 2)


def _try_fill(side: str, level: float, o: float, h: float, lo: float) -> Optional[float]:
    """Fill del D+1 con orden stop en `level`; si abre demasiado pasado
    (>MAX_CHASE_PCT) no se persigue."""
    if side == "long":
        if o >= level:
            return o if o <= level * (1 + MAX_CHASE_PCT / 100) else None
        return level if h >= level else None
    if o <= level:
        return o if o >= level * (1 - MAX_CHASE_PCT / 100) else None
    return level if lo <= level else None


def _sim_trade(side: str, fill: float, stop: float, target: float,
               h: np.ndarray, lo: np.ndarray, c: np.ndarray,
               start: int) -> Tuple[Optional[float], str, int, float]:
    """Simula desde la barra de fill (inclusive), conservador (stop primero).
    r es None si aún faltan barras para resolver (grading en vivo)."""
    risk = (fill - stop) if side == "long" else (stop - fill)
    if risk <= 0:
        return -1.0, "stop_invalid", 0, stop
    n = len(c)
    last = min(start + MAX_HOLD_DAYS - 1, n - 1)
    for j in range(start, last + 1):
        if side == "long":
            if lo[j] <= stop:
                return (stop - fill) / risk, "stop", j - start + 1, stop
            if h[j] >= target:
                return (target - fill) / risk, "target", j - start + 1, target
        else:
            if h[j] >= stop:
                return (fill - stop) / risk, "stop", j - start + 1, stop
            if lo[j] <= target:
                return (fill - target) / risk, "target", j - start + 1, target
    if last < start + MAX_HOLD_DAYS - 1:
        return None, "open", last - start + 1, float(c[last])  # aún en curso
    exit_px = float(c[last])
    r = (exit_px - fill) / risk if side == "long" else (fill - exit_px) / risk
    return r, "time", MAX_HOLD_DAYS, exit_px


# ═══════════════════════════════════════════════════════════════════════════
#  Features y etiquetas de la red neuronal
# ═══════════════════════════════════════════════════════════════════════════
def _feature_vector(dates: List[str], o: np.ndarray, h: np.ndarray,
                    lo: np.ndarray, c: np.ndarray, v: np.ndarray, i: int,
                    spy_map: Dict[str, float], etf_map: Optional[Dict[str, float]],
                    market_cap: Optional[float] = None) -> Optional[np.ndarray]:
    """Vector fv2 de 36 features al cierre del día i (sin look-ahead)."""
    if i < 60:
        return None
    px = float(c[i])
    if px <= 0:
        return None

    def ret(k: int) -> float:
        prev = float(c[i - k])
        return (px / prev - 1.0) * 100 if prev > 0 else 0.0

    tr = (h[i - 13:i + 1] - lo[i - 13:i + 1]) / np.where(c[i - 13:i + 1] > 0,
                                                         c[i - 13:i + 1], 1.0) * 100
    atr_pct = float(np.mean(tr))
    pre_c = c[i - PRE_BARS + 1:i + 1]
    pre_h = h[i - PRE_BARS + 1:i + 1]
    pre_l = lo[i - PRE_BARS + 1:i + 1]
    pattern, ret10, compression, _ = EdgeFinderEngine._classify_pattern(pre_c, pre_h, pre_l)

    va = v[i - VOL_AVG_WINDOW:i]
    vol_avg20 = float(np.mean(va)) if va.size >= 5 else 0.0
    vol_ratio = float(v[i]) / vol_avg20 if vol_avg20 > 0 else 1.0
    vol_trend = float(np.mean(v[i - 4:i + 1])) / vol_avg20 if vol_avg20 > 0 else 1.0

    trig = float(np.max(h[i - PRE_BARS + 1:i + 1]))
    prox = (px - trig) / trig * 100 if trig > 0 else 0.0

    lb_l, lb_h = lo[max(0, i - 252):i + 1], h[max(0, i - 252):i + 1]
    low52, high52 = float(np.min(lb_l)), float(np.max(lb_h))
    dist_low = (px - low52) / low52 * 100 if low52 > 0 else 0.0
    dist_high = (px - high52) / high52 * 100 if high52 > 0 else 0.0

    consec_red, consec_green = EdgeFinderEngine._consecutive(c[max(0, i - PRE_BARS):i + 1])
    rng = float(h[i] - lo[i])
    close_pos = (px - float(lo[i])) / rng if rng > 0 else 0.5
    gap = (float(o[i]) / float(c[i - 1]) - 1.0) * 100 if float(c[i - 1]) > 0 else 0.0

    spy20 = float(spy_map.get(dates[i], 0.0))
    sec20 = float(etf_map.get(dates[i], spy20)) if etf_map else spy20
    hot = 1.0 if sec20 > spy20 else 0.0

    # ── Bloque "previa de volumen" (fv2) ─────────────────────────────────────
    # Secuencia de ratios de los últimos 5 días (forma del patrón de volumen)
    vol_seq = [float(v[i - k]) / vol_avg20 if vol_avg20 > 0 else 1.0
               for k in (4, 3, 2, 1)]                       # d-4..d-1 (d0 = vol_ratio)
    v10 = v[i - 9:i + 1]
    dryup = float(np.min(v[i - 4:i + 1])) / vol_avg20 if vol_avg20 > 0 else 1.0
    pocket_pivots = float(np.sum(v10 > 2 * vol_avg20)) / 10.0 if vol_avg20 > 0 else 0.0
    c10, o10 = c[i - 9:i + 1], o[i - 9:i + 1]
    green = c10 > o10
    tot_v10 = float(np.sum(v10))
    upvol_share = float(np.sum(v10[green])) / tot_v10 if tot_v10 > 0 else 0.5
    tr10 = (h[i - 9:i + 1] - lo[i - 9:i + 1]) / np.where(c10 > 0, c10, 1.0) * 100
    tr_first = float(np.mean(tr10[:5])); tr_last = float(np.mean(tr10[5:]))
    range_trend = tr_last / tr_first if tr_first > 0 else 1.0
    log_mktcap = float(np.log10(max(float(market_cap or 0), 1.0)))

    base = [ret(1), ret(5), float(ret10), ret(20),
            atr_pct, float(compression), vol_ratio, vol_trend, prox,
            dist_low, dist_high, float(consec_red), float(consec_green),
            close_pos, gap,
            float(np.log10(max(px, 0.01))),
            float(np.log10(max(px * vol_avg20, 1.0))),
            spy20, sec20, hot,
            *vol_seq, dryup, pocket_pivots, upvol_share, range_trend, log_mktcap]
    onehot = [1.0 if pattern == p else 0.0 for p in PATTERN_ORDER]
    vec = np.asarray(base + onehot, dtype=np.float32)
    vec = np.nan_to_num(vec, nan=0.0, posinf=0.0, neginf=0.0)
    vec[:N_BASE_FEATURES] = np.clip(vec[:N_BASE_FEATURES], -500.0, 1000.0)
    return vec


def _labels_at(c: np.ndarray, h: np.ndarray, lo: np.ndarray, i: int
               ) -> Optional[Tuple[int, int, float, float]]:
    """(label_up, label_down, surge_pct, crash_pct) anclado al cierre del día i.

    Misma definición que el Edge Finder: el movimiento arranca en i+1 con día
    verde (rojo para el crash) y el pico/valle es el extremo de la ventana de
    SURGE_DAYS. Ventanas incompletas solo cuentan si YA son positivas."""
    n = len(c)
    if i + 1 >= n:
        return None
    base = float(c[i])
    if base <= 0:
        return None
    end = min(i + 1 + SURGE_DAYS, n)
    peak = float(np.max(h[i + 1:end]))
    valley = float(np.min(lo[i + 1:end]))
    surge_pct = (peak - base) / base * 100
    crash_pct = (base - valley) / base * 100
    up = int(c[i + 1] > c[i] and surge_pct >= SURGE_PCT_MIN)
    down = int(c[i + 1] < c[i] and crash_pct >= CRASH_PCT_MIN)
    if end < i + 1 + SURGE_DAYS and not (up or down):
        return None  # ventana incompleta y sin evento → etiqueta incierta
    return up, down, round(surge_pct, 1), round(crash_pct, 1)


if TORCH_AVAILABLE:
    class SurgeNet(nn.Module):
        """MLP 27 → 64 → 32 → 2 (logits: surge↑, crash↓)."""

        def __init__(self, n_in: int = N_FEATURES) -> None:
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(n_in, 64), nn.ReLU(), nn.Dropout(0.15),
                nn.Linear(64, 32), nn.ReLU(), nn.Dropout(0.10),
                nn.Linear(32, 2),
            )

        def forward(self, x):  # noqa: ANN001
            return self.net(x)


def _auc(y: np.ndarray, p: np.ndarray) -> Optional[float]:
    """AUC por ranking (Mann-Whitney); None si falta alguna clase."""
    pos, neg = p[y > 0.5], p[y <= 0.5]
    if pos.size == 0 or neg.size == 0:
        return None
    order = np.argsort(np.concatenate([pos, neg]), kind="mergesort")
    ranks = np.empty(order.size, dtype=np.float64)
    ranks[order] = np.arange(1, order.size + 1)
    r_pos = float(np.sum(ranks[:pos.size]))
    auc = (r_pos - pos.size * (pos.size + 1) / 2) / (pos.size * neg.size)
    return round(auc, 3)


# ═══════════════════════════════════════════════════════════════════════════
#  Engine
# ═══════════════════════════════════════════════════════════════════════════
class UltimatePredictorEngine:
    def __init__(self) -> None:
        self.version = "2.0"
        # comparte sesión FMP + caché de históricos con el Edge Finder
        self.finder: EdgeFinderEngine = get_edge_finder_engine()
        self._db_lock = threading.Lock()
        self._init_db()
        self._model = None
        self._model_meta: Dict[str, Any] = {}
        self._load_model()
        # loop autónomo: mientras el backend esté levantado, el motor califica,
        # hace post-mortems y re-entrena solo cada hora (sin abrir la página)
        self._busy = False
        threading.Thread(target=self._auto_learn_loop, daemon=True,
                         name="ultimate-auto-learn").start()

    # ── SQLite local (memoria persistente + dataset de la red) ───────────────
    def _db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH, timeout=15)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._db_lock, closing(self._db()) as conn, conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    created_at TEXT,
                    for_date TEXT,
                    params TEXT,
                    regime TEXT,
                    spy_ret20 REAL,
                    universe INTEGER,
                    picks INTEGER
                )""")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT,
                    created_at TEXT,
                    for_date TEXT,
                    symbol TEXT,
                    side TEXT,
                    entry REAL,
                    stop REAL,
                    target REAL,
                    score REAL,
                    expectancy_r REAL,
                    status TEXT DEFAULT 'pending',
                    outcome TEXT,
                    outcome_r REAL,
                    exit_price REAL,
                    days_held INTEGER,
                    evaluated_at TEXT
                )""")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS training_data (
                    symbol TEXT,
                    date TEXT,
                    features TEXT,
                    label_up INTEGER,
                    label_down INTEGER,
                    surge_pct REAL,
                    weight REAL DEFAULT 1.0,
                    run_id TEXT,
                    added_at TEXT,
                    feat_version TEXT,
                    PRIMARY KEY (symbol, date)
                )""")
            # migraciones (columnas nuevas)
            for ddl in ("ALTER TABLE predictions ADD COLUMN features TEXT",
                        "ALTER TABLE predictions ADD COLUMN exp_move_pct REAL",
                        "ALTER TABLE predictions ADD COLUMN surge_prob_pct REAL",
                        "ALTER TABLE predictions ADD COLUMN pattern TEXT",
                        "ALTER TABLE predictions ADD COLUMN vol_ratio REAL",
                        "ALTER TABLE predictions ADD COLUMN dilution_score REAL",
                        "ALTER TABLE training_data ADD COLUMN feat_version TEXT"):
                try:
                    conn.execute(ddl)
                except sqlite3.OperationalError:
                    pass  # columna ya existe
            conn.execute("""
                CREATE TABLE IF NOT EXISTS post_mortems (
                    pred_id INTEGER PRIMARY KEY,
                    symbol TEXT, for_date TEXT, side TEXT,
                    filled INTEGER, outcome TEXT, r REAL,
                    r_open REAL,            -- contrafactual: ¿y si entraba al open?
                    move_pct REAL,          -- movimiento explosivo realizado (con o sin fill)
                    missed INTEGER,         -- sin fill pero el movimiento ocurrió
                    gap_pct REAL,
                    session_vol_ratio REAL,
                    verdict TEXT,
                    created_at TEXT
                )""")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS learning_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT,
                    kind TEXT,
                    message TEXT
                )""")
            # columnas de razonamiento del post-mortem (aditivas, no borran nada)
            for ddl in ("ALTER TABLE predictions ADD COLUMN entry_type TEXT DEFAULT 'stop'",
                        "ALTER TABLE post_mortems ADD COLUMN vol_vs_prior_day REAL",
                        "ALTER TABLE post_mortems ADD COLUMN vol_vs_prior_week REAL",
                        "ALTER TABLE post_mortems ADD COLUMN high_time_min INTEGER",
                        "ALTER TABLE post_mortems ADD COLUMN low_time_min INTEGER",
                        "ALTER TABLE post_mortems ADD COLUMN pm_gap_pct REAL",
                        "ALTER TABLE post_mortems ADD COLUMN pm_range_pct REAL",
                        "ALTER TABLE post_mortems ADD COLUMN first30_range_pct REAL",
                        "ALTER TABLE post_mortems ADD COLUMN pattern TEXT"):
                try:
                    conn.execute(ddl)
                except sqlite3.OperationalError:
                    pass
            # al cambiar la versión de features, el dataset viejo se descarta
            # (se vuelve a cosechar con la versión nueva en la próxima corrida)
            conn.execute("DELETE FROM training_data WHERE feat_version IS NULL "
                         "OR feat_version != ?", (FEAT_VERSION,))
            # dedupe histórico: si una corrida repetida insertó el mismo pick
            # pendiente varias veces, queda solo el más reciente
            conn.execute(
                "DELETE FROM predictions WHERE status='pending' AND id NOT IN ("
                "SELECT MAX(id) FROM predictions WHERE status='pending' "
                "GROUP BY for_date, symbol, side)")
            # calificaciones basura de versiones previas (stop inválido por gap):
            # se reabren para re-calificarse con la lógica de gap corregida
            conn.execute(
                "UPDATE predictions SET status='pending', outcome=NULL, outcome_r=NULL, "
                "exit_price=NULL, days_held=NULL, evaluated_at=NULL "
                "WHERE outcome LIKE '%stop_invalid%'")
            conn.execute("DELETE FROM post_mortems WHERE outcome LIKE '%stop_invalid%'")

    # ── Modelo: load / save / predict ────────────────────────────────────────
    def _load_model(self) -> None:
        if not TORCH_AVAILABLE or not os.path.exists(MODEL_PATH):
            return
        try:
            blob = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
            if blob.get("version") != FEAT_VERSION:
                logger.warning("[Ultimate] modelo con feat_version distinta — se re-entrenará")
                return
            model = SurgeNet()
            model.load_state_dict(blob["state"])
            model.eval()
            self._model = model
            self._model_meta = {k: blob[k] for k in
                                ("mean", "std", "metrics", "trained_at", "rows")
                                if k in blob}
        except Exception as e:  # noqa: BLE001
            logger.warning("[Ultimate] no se pudo cargar el modelo: %s", e)

    def model_info(self) -> Dict[str, Any]:
        info = {
            "torch_available": TORCH_AVAILABLE,
            "status": "trained" if self._model is not None else "heuristic",
            "data_dir": _DATA_DIR,
            "ephemeral_storage": EPHEMERAL_STORAGE,
            "feat_version": FEAT_VERSION,
            "n_features": N_FEATURES,
            "trained_at": self._model_meta.get("trained_at"),
            "rows": self._model_meta.get("rows"),
            "metrics": self._model_meta.get("metrics"),
        }
        with self._db_lock, closing(self._db()) as conn, conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n, SUM(label_up) AS up, SUM(label_down) AS dn "
                "FROM training_data").fetchone()
        info["dataset_rows"] = row["n"] or 0
        info["dataset_up"] = row["up"] or 0
        info["dataset_down"] = row["dn"] or 0
        return info

    def _predict_probs(self, X: np.ndarray) -> Optional[np.ndarray]:
        if self._model is None or not TORCH_AVAILABLE:
            return None
        mean = np.asarray(self._model_meta.get("mean"), dtype=np.float32)
        std = np.asarray(self._model_meta.get("std"), dtype=np.float32)
        if mean.shape != (N_FEATURES,) or std.shape != (N_FEATURES,):
            return None
        Xn = (X - mean) / np.where(std > 1e-6, std, 1.0)
        with torch.no_grad():
            t = torch.from_numpy(Xn.astype(np.float32))
            return torch.sigmoid(self._model(t)).numpy()

    # ── Dataset: upsert + carga + entrenamiento ──────────────────────────────
    def _upsert_training(self, rows: List[Tuple], run_id: str) -> int:
        """rows: (symbol, date, features_json, label_up, label_down, surge_pct,
        weight). INSERT OR REPLACE si el peso nuevo es mayor (los ejemplos de
        picks calificados ×3 pisan a los cosechados ×1, nunca al revés).
        Features con dimensión distinta a la versión vigente se descartan."""
        if not rows:
            return 0
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        added = 0
        with self._db_lock, closing(self._db()) as conn, conn:
            for r in rows:
                try:
                    if len(json.loads(r[2])) != N_FEATURES:
                        continue
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                cur = conn.execute(
                    "SELECT weight FROM training_data WHERE symbol=? AND date=?",
                    (r[0], r[1]))
                old = cur.fetchone()
                if old is not None and float(old["weight"]) >= float(r[6]):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO training_data "
                    "(symbol, date, features, label_up, label_down, surge_pct, "
                    "weight, run_id, added_at, feat_version) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (*r, run_id, now, FEAT_VERSION))
                added += 1
        return added

    def _load_training(self) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        with self._db_lock, closing(self._db()) as conn, conn:
            rows = conn.execute(
                "SELECT features, label_up, label_down, weight FROM training_data "
                "ORDER BY added_at DESC LIMIT ?", (MAX_TRAIN_ROWS,)).fetchall()
        X, y, w = [], [], []
        for r in rows:
            try:
                f = json.loads(r["features"])
                if len(f) != N_FEATURES:
                    continue
                X.append(f)
                y.append([float(r["label_up"] or 0), float(r["label_down"] or 0)])
                w.append(float(r["weight"] or 1.0))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
        if not X:
            return (np.zeros((0, N_FEATURES), np.float32),
                    np.zeros((0, 2), np.float32), np.zeros((0,), np.float32))
        return (np.asarray(X, np.float32), np.asarray(y, np.float32),
                np.asarray(w, np.float32))

    def _train_model(self, progress) -> Dict[str, Any]:
        """Re-entrena la red sobre el dataset acumulado. Devuelve info del
        entrenamiento (o el motivo por el que quedó en modo heurístico)."""
        if not TORCH_AVAILABLE:
            return {"trained": False, "reason": "torch no disponible en el backend"}
        X, y, w = self._load_training()
        n = X.shape[0]
        if n < MIN_TRAIN_ROWS:
            return {"trained": False,
                    "reason": f"dataset aún chico ({n}/{MIN_TRAIN_ROWS} ejemplos) — "
                              "corre el motor más días para acumular"}

        mean = X.mean(axis=0)
        std = X.std(axis=0)
        std_safe = np.where(std > 1e-6, std, 1.0)
        Xn = (X - mean) / std_safe

        rng = np.random.default_rng(int(time.time()) % 2**31)
        perm = rng.permutation(n)
        n_val = max(64, int(n * 0.15))
        val_idx, tr_idx = perm[:n_val], perm[n_val:]

        def pos_weight(col: int) -> float:
            pos = float(np.sum(w[tr_idx] * y[tr_idx, col]))
            neg = float(np.sum(w[tr_idx] * (1 - y[tr_idx, col])))
            return float(np.clip(neg / max(pos, 1.0), 1.0, 50.0))

        pw = torch.tensor([pos_weight(0), pos_weight(1)], dtype=torch.float32)
        model = SurgeNet()
        opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-5)
        crit = nn.BCEWithLogitsLoss(pos_weight=pw, reduction="none")

        Xt = torch.from_numpy(Xn[tr_idx]); yt = torch.from_numpy(y[tr_idx])
        wt = torch.from_numpy(w[tr_idx]).unsqueeze(1)
        Xv = torch.from_numpy(Xn[val_idx]); yv = torch.from_numpy(y[val_idx])
        wv = torch.from_numpy(w[val_idx]).unsqueeze(1)

        best_val = float("inf")
        best_state = None
        patience = 0
        epochs_run = 0
        n_tr = Xt.shape[0]
        for epoch in range(1, TRAIN_MAX_EPOCHS + 1):
            epochs_run = epoch
            model.train()
            order = torch.randperm(n_tr)
            for s in range(0, n_tr, TRAIN_BATCH):
                idx = order[s:s + TRAIN_BATCH]
                opt.zero_grad()
                out = model(Xt[idx])
                loss = (crit(out, yt[idx]) * wt[idx]).mean()
                loss.backward()
                opt.step()
            model.eval()
            with torch.no_grad():
                val_loss = float((crit(model(Xv), yv) * wv).mean())
            progress(58 + int(12 * epoch / TRAIN_MAX_EPOCHS),
                     f"Entrenando red neuronal — época {epoch}/{TRAIN_MAX_EPOCHS} "
                     f"(val loss {round(val_loss, 4)})")
            if val_loss < best_val - 1e-5:
                best_val = val_loss
                best_state = {k: v.clone() for k, v in model.state_dict().items()}
                patience = 0
            else:
                patience += 1
                if patience >= TRAIN_PATIENCE:
                    break
        if best_state is not None:
            model.load_state_dict(best_state)
        model.eval()
        with torch.no_grad():
            pv = torch.sigmoid(model(Xv)).numpy()
        metrics = {
            "val_loss": round(best_val, 4),
            "epochs": epochs_run,
            "auc_up": _auc(y[val_idx, 0], pv[:, 0]),
            "auc_down": _auc(y[val_idx, 1], pv[:, 1]),
            "pos_rate_up_pct": round(100 * float(y[:, 0].mean()), 2),
            "pos_rate_down_pct": round(100 * float(y[:, 1].mean()), 2),
        }
        trained_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        try:
            torch.save({"state": model.state_dict(), "mean": mean, "std": std_safe,
                        "version": FEAT_VERSION, "metrics": metrics,
                        "trained_at": trained_at, "rows": n}, MODEL_PATH)
        except Exception as e:  # noqa: BLE001
            logger.warning("[Ultimate] no se pudo guardar el modelo: %s", e)
        self._model = model
        self._model_meta = {"mean": mean, "std": std_safe, "metrics": metrics,
                            "trained_at": trained_at, "rows": n}
        return {"trained": True, "rows": n, **metrics}

    # ── A. Grading de predicciones anteriores (feedback a la red) ────────────
    # ── Intradía: cerrar el ciclo de aprendizaje el MISMO día ────────────────
    # FMP publica la barra diaria (EOD) horas después del cierre — a veces
    # recién a la mañana siguiente. Para calificar apenas cierra el mercado se
    # sintetiza la barra diaria de la sesión a partir de las velas de 1 minuto
    # (sesión regular 9:30–16:00 ET), que sí están disponibles enseguida.
    def _session_ohlc_from_intraday(self, symbol: str, day: str) -> Optional[Dict]:
        data = self.finder._fetch_json(
            "historical-chart/1min",
            {"symbol": symbol, "from": day, "to": day, "extended": "true"})
        if not isinstance(data, list) or not data:
            return None
        rows: List[Tuple[str, float, float, float, float, float, int]] = []
        for b in data:
            try:
                t = str(b["date"])
                hhmm = t.split(" ")[1]
                mm = int(hhmm[:2]) * 60 + int(hhmm[3:5])
                if mm < 570 or mm > 960:  # solo sesión regular (RTH)
                    continue
                rows.append((t, float(b["open"]), float(b["high"]), float(b["low"]),
                             float(b["close"]), float(b.get("volume") or 0), mm))
            except (KeyError, TypeError, ValueError, IndexError):
                continue
        if not rows:
            return None
        rows.sort(key=lambda x: x[0])
        return {
            "date": day,
            "open": rows[0][1],
            "high": max(r[2] for r in rows),
            "low": min(r[3] for r in rows),
            "close": rows[-1][4],
            "volume": sum(r[5] for r in rows),
            "closed": rows[-1][6] >= 955,  # llegó al final de la sesión (15:55+)
        }

    def _session_stats_intraday(self, symbol: str, day: str) -> Optional[Dict]:
        """Estadísticas ricas de la sesión desde 1-min: hora del high/low, gap y
        rango del premarket, y rango de los primeros 30 minutos. Alimenta el
        razonamiento de los post-mortems (¿a qué hora explota? ¿cómo venía el
        premarket de los ganadores?). Una sola llamada por símbolo calificado."""
        data = self.finder._fetch_json(
            "historical-chart/1min",
            {"symbol": symbol, "from": day, "to": day, "extended": "true"})
        if not isinstance(data, list) or not data:
            return None
        rth: List[Tuple[int, float, float, float, float, float]] = []
        pm: List[Tuple[float, float, float, float]] = []  # premarket H, L, C, V
        for b in data:
            try:
                t = str(b["date"]); hhmm = t.split(" ")[1]
                mm = int(hhmm[:2]) * 60 + int(hhmm[3:5])
                hi, lowv = float(b["high"]), float(b["low"])
                vol = float(b.get("volume") or 0)
                if mm < 570:  # premarket (antes de 9:30)
                    pm.append((hi, lowv, float(b["close"]), vol))
                elif mm <= 960:
                    rth.append((mm, float(b["open"]), hi, lowv, float(b["close"]), vol))
            except (KeyError, TypeError, ValueError, IndexError):
                continue
        if not rth:
            return None
        rth.sort(key=lambda x: x[0])
        session_open = rth[0][1]
        hi_bar = max(rth, key=lambda x: x[2])
        lo_bar = min(rth, key=lambda x: x[3])
        first30 = [r for r in rth if r[0] <= 600]  # 9:30–10:00
        out: Dict[str, Any] = {
            "high_time_min": hi_bar[0],
            "low_time_min": lo_bar[0],
            "first30_range_pct": (round((max(r[2] for r in first30) - min(r[3] for r in first30))
                                        / session_open * 100, 2)
                                  if first30 and session_open > 0 else None),
            "pm_gap_pct": None, "pm_range_pct": None,
        }
        if pm and session_open > 0:
            pm_high = max(p[0] for p in pm); pm_low = min(p[1] for p in pm)
            pm_last = pm[-1][2]
            out["pm_gap_pct"] = round((session_open / pm_last - 1.0) * 100, 2) if pm_last > 0 else None
            out["pm_range_pct"] = round((pm_high - pm_low) / session_open * 100, 2)
        return out

    @staticmethod
    def _hhmm(minutes: Optional[int]) -> Optional[str]:
        if minutes is None:
            return None
        return f"{minutes // 60:02d}:{minutes % 60:02d}"

    def _advance_as_of(self, eod_as_of: Optional[str]) -> str:
        """Avanza el corte al último día cuya sesión regular YA cerró, mirando
        SPY intradía, aunque FMP todavía no haya publicado su barra EOD."""
        today = datetime.utcnow().strftime("%Y-%m-%d")
        base = eod_as_of or (datetime.utcnow() - timedelta(days=5)).strftime("%Y-%m-%d")
        if base >= today:
            return base
        latest = base
        probe = datetime.strptime(base, "%Y-%m-%d")
        for _ in range(6):
            probe += timedelta(days=1)
            d = probe.strftime("%Y-%m-%d")
            if d > today:
                break
            if probe.weekday() >= 5:
                continue
            bar = self._session_ohlc_from_intraday("SPY", d)
            if bar and bar["closed"]:
                latest = d
            elif bar is None and d < today:
                latest = d  # feriado/sin datos: no bloquea el avance
        return latest

    def _series_through(self, symbol: str, d_from: str, as_of: str
                        ) -> Tuple[List[str], np.ndarray, np.ndarray,
                                   np.ndarray, np.ndarray, np.ndarray]:
        """Barras diarias EOD extendidas con sesiones recientes sintetizadas
        desde intradía (las que EOD aún no publicó, hasta `as_of`)."""
        hist = self.finder._daily_history(symbol, d_from, as_of)
        dates, o, h, lo, c, v = self.finder._parse_bars(hist)
        last_eod = dates[-1] if dates else None
        if last_eod is not None and last_eod >= as_of:
            return dates, o, h, lo, c, v
        ed, eo, eh, el, ec, ev = [], [], [], [], [], []
        probe = (datetime.strptime(last_eod, "%Y-%m-%d") if last_eod
                 else datetime.strptime(as_of, "%Y-%m-%d") - timedelta(days=SURGE_DAYS + 3))
        end = datetime.strptime(as_of, "%Y-%m-%d")
        while probe < end:
            probe += timedelta(days=1)
            if probe.weekday() >= 5:
                continue
            d = probe.strftime("%Y-%m-%d")
            if last_eod is not None and d <= last_eod:
                continue
            bar = self._session_ohlc_from_intraday(symbol, d)
            if bar:
                ed.append(d); eo.append(bar["open"]); eh.append(bar["high"])
                el.append(bar["low"]); ec.append(bar["close"]); ev.append(bar["volume"])
        if not ed:
            return dates, o, h, lo, c, v
        return (list(dates) + ed,
                np.concatenate([o, eo]), np.concatenate([h, eh]),
                np.concatenate([lo, el]), np.concatenate([c, ec]),
                np.concatenate([v, ev]))

    def _grade_pending(self, as_of: str) -> Tuple[int, List[Tuple]]:
        """Califica pending/abiertas vencidas, marca 'open' las que ejecutaron y
        siguen en curso, y escribe el POST-MORTEM de cada calificada (¿ejecutó?
        ¿el movimiento ocurrió igual? ¿qué hubiera dado la entrada al open?).
        Devuelve (calificadas, ejemplos ×3 con la etiqueta VERDADERA)."""
        with self._db_lock, closing(self._db()) as conn, conn:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE status IN ('pending','open') "
                "AND for_date <= ? ORDER BY for_date ASC LIMIT 60", (as_of,)).fetchall()
        graded = 0
        feedback: List[Tuple] = []
        for row in rows:
            try:
                d_from = (datetime.strptime(row["for_date"], "%Y-%m-%d")
                          - timedelta(days=60)).strftime("%Y-%m-%d")
                # barras EOD + sesiones recientes sintetizadas desde intradía,
                # para poder calificar el mismo día que cierra el mercado
                dates, o, h, lo, c, v = self._series_through(row["symbol"], d_from, as_of)
                idx = next((i for i, dt in enumerate(dates) if dt >= row["for_date"]), None)
                if idx is None or idx == 0:
                    continue  # la sesión objetivo aún no tiene barra
                side = row["side"]
                entry_type = (row["entry_type"] if "entry_type" in row.keys()
                              and row["entry_type"] else "stop")
                entry_ref = float(row["entry"])
                stop_lvl, target_lvl = float(row["stop"]), float(row["target"])
                prev_close = float(c[idx - 1])
                gap = (float(o[idx]) / prev_close - 1.0) * 100 if prev_close > 0 else 0.0
                now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
                # Gap gigante en la apertura ⇒ split / oferta / dato anómalo: los
                # niveles calculados sobre el cierre previo dejan de tener sentido.
                # Se marca sin fill (no contamina R ni el aprendizaje con basura).
                if abs(gap) > 40:
                    upd = ("graded", f"no_fill:gap_anomalo_{round(gap)}pct",
                           None, None, 0, now, row["id"])
                    graded += 1
                    with self._db_lock, closing(self._db()) as conn, conn:
                        conn.execute(
                            "UPDATE predictions SET status=?, outcome=?, outcome_r=?, "
                            "exit_price=?, days_held=?, evaluated_at=? WHERE id=?", upd)
                    continue
                if entry_type == "open":
                    # entrada a mercado en la apertura: stop/target se recalculan a
                    # la MISMA distancia relativa desde el fill real (no absolutos
                    # sobre el cierre previo, que un gap dejaría inválidos)
                    fill = float(o[idx])
                    if entry_ref > 0 and fill > 0:
                        stop_frac = abs(entry_ref - stop_lvl) / entry_ref
                        tgt_frac = abs(target_lvl - entry_ref) / entry_ref
                        if side == "long":
                            stop_lvl, target_lvl = fill * (1 - stop_frac), fill * (1 + tgt_frac)
                        else:
                            stop_lvl, target_lvl = fill * (1 + stop_frac), fill * (1 - tgt_frac)
                else:
                    fill = _try_fill(side, entry_ref,
                                     float(o[idx]), float(h[idx]), float(lo[idx]))
                if fill is None:
                    upd = ("graded", "no_fill", None, None, 0, now, row["id"])
                    graded += 1
                else:
                    r, reason, days, exit_px = _sim_trade(
                        side, fill, stop_lvl, target_lvl, h, lo, c, idx)
                    if r is None:
                        # ejecutó y sigue en curso — visible como "en curso"
                        upd = ("open", None, None, _px(exit_px), days, now, row["id"])
                    else:
                        outcome = "win" if r > 0 else ("loss" if r < 0 else "flat")
                        upd = ("graded", f"{outcome}:{reason}", round(r, 3),
                               _px(exit_px), days, now, row["id"])
                        graded += 1
                with self._db_lock, closing(self._db()) as conn, conn:
                    conn.execute(
                        "UPDATE predictions SET status=?, outcome=?, outcome_r=?, "
                        "exit_price=?, days_held=?, evaluated_at=? WHERE id=?", upd)
                if upd[0] == "graded":
                    self._write_post_mortem(row, dates, o, h, lo, c, v, idx,
                                            fill, upd[1], upd[2])
                    # feedback: etiqueta verdadera anclada al día previo
                    feats = row["features"] if "features" in row.keys() else None
                    lab = _labels_at(c, h, lo, idx - 1)
                    if feats and lab is not None:
                        up, down, s_pct, _c_pct = lab
                        feedback.append((row["symbol"], dates[idx - 1], feats,
                                         up, down, s_pct, GRADED_SAMPLE_WEIGHT))
            except Exception as e:  # noqa: BLE001
                logger.debug("[Ultimate] grading %s failed: %s", row["symbol"], e)
        return graded, feedback

    # ── Post-mortem: el motor se pregunta por qué funcionó o falló ───────────
    def _write_post_mortem(self, row: sqlite3.Row, dates: List[str], o: np.ndarray,
                           h: np.ndarray, lo: np.ndarray, c: np.ndarray,
                           v: np.ndarray, idx: int, fill: Optional[float],
                           outcome: str, r: Optional[float]) -> None:
        side = row["side"]
        prev_close = float(c[idx - 1])
        end = min(idx + SURGE_DAYS, len(c))
        if prev_close <= 0 or end <= idx:
            return
        # ¿el movimiento explosivo ocurrió, con o sin nosotros?
        if side == "long":
            move_pct = (float(np.max(h[idx:end])) - prev_close) / prev_close * 100
        else:
            move_pct = (prev_close - float(np.min(lo[idx:end]))) / prev_close * 100
        exp_move = float(row["exp_move_pct"] or (SURGE_PCT_MIN if side == "long"
                                                 else CRASH_PCT_MIN))
        missed = int(outcome == "no_fill" and move_pct >= exp_move * 0.6)
        gap_pct = round((float(o[idx]) / prev_close - 1.0) * 100, 2)
        va = v[max(0, idx - 20):idx]
        session_vol_ratio = (round(float(v[idx]) / float(np.mean(va)), 2)
                             if va.size >= 5 and float(np.mean(va)) > 0 else None)
        # ── Preguntas que se hace el motor (razonamiento del post-mortem) ────
        # ¿el volumen venía subiendo respecto del día / de la semana previa?
        vol_vs_prior_day = (round(float(v[idx]) / float(v[idx - 1]), 2)
                            if idx >= 1 and float(v[idx - 1]) > 0 else None)
        vw = v[max(0, idx - 5):idx]
        vol_vs_prior_week = (round(float(v[idx]) / float(np.mean(vw)), 2)
                             if vw.size >= 3 and float(np.mean(vw)) > 0 else None)
        # ¿a qué hora explotó? ¿cómo venía el premarket? (velas de 1 min)
        istats = self._session_stats_intraday(row["symbol"], dates[idx]) or {}
        # contrafactual: entrada a mercado en el open, misma distancia de stop/target
        entry_ref = float(row["entry"])
        risk_frac = abs(entry_ref - float(row["stop"])) / entry_ref if entry_ref > 0 else 0.05
        tgt_frac = abs(float(row["target"]) - entry_ref) / entry_ref if entry_ref > 0 else 0.3
        eo = float(o[idx])
        if side == "long":
            r_open, _, _, _ = _sim_trade("long", eo, eo * (1 - risk_frac),
                                         eo * (1 + tgt_frac), h, lo, c, idx)
        else:
            r_open, _, _, _ = _sim_trade("short", eo, eo * (1 + risk_frac),
                                         eo * (1 - tgt_frac), h, lo, c, idx)
        # veredicto en español (esto es lo que "se pregunta" el motor)
        mv = round(move_pct, 1)
        if outcome == "no_fill" and missed:
            verdict = (f"Sin fill pero el movimiento OCURRIÓ ({'+' if side == 'long' else '−'}{mv}%) — "
                       f"la entrada en el disparo fue demasiado exigente; al open habría dado "
                       f"{round(r_open, 2) if r_open is not None else 's/d'}R.")
        elif outcome == "no_fill":
            verdict = f"Sin fill y el movimiento nunca vino (máx {mv}%) — el filtro de entrada protegió."
        elif outcome.startswith("win"):
            hora = self._hhmm(istats.get("high_time_min" if side == "long" else "low_time_min"))
            verdict = (f"Acierto: {round(r or 0, 2)}R (movimiento máx {mv}%, vol sesión "
                       f"{session_vol_ratio}×{f', extremo ~{hora} ET' if hora else ''}).")
        elif "stop" in outcome and abs(gap_pct) >= 3 and ((side == "long") == (gap_pct < 0)):
            verdict = f"Stop con gap en contra de {gap_pct}% en la apertura — riesgo de gap, no de tesis."
        elif outcome.startswith("loss"):
            verdict = (f"Fallo: {round(r or 0, 2)}R. Movimiento máx {mv}% vs esperado {round(exp_move, 1)}% "
                       f"— {'la explosión no llegó' if move_pct < exp_move * 0.5 else 'llegó tarde o se revirtió'}.")
        else:
            verdict = f"Salida por tiempo: {round(r or 0, 2)}R (movimiento máx {mv}%)."
        with self._db_lock, closing(self._db()) as conn, conn:
            conn.execute(
                "INSERT OR REPLACE INTO post_mortems (pred_id, symbol, for_date, side, "
                "filled, outcome, r, r_open, move_pct, missed, gap_pct, "
                "session_vol_ratio, verdict, created_at, vol_vs_prior_day, "
                "vol_vs_prior_week, high_time_min, low_time_min, pm_gap_pct, "
                "pm_range_pct, first30_range_pct, pattern) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (row["id"], row["symbol"], row["for_date"], side,
                 int(fill is not None), outcome, r,
                 round(r_open, 3) if r_open is not None else None,
                 round(move_pct, 1), missed, gap_pct, session_vol_ratio, verdict,
                 datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
                 vol_vs_prior_day, vol_vs_prior_week,
                 istats.get("high_time_min"), istats.get("low_time_min"),
                 istats.get("pm_gap_pct"), istats.get("pm_range_pct"),
                 istats.get("first30_range_pct"),
                 row["pattern"] if "pattern" in row.keys() else None))

    def grade_now(self) -> Dict[str, Any]:
        """Calificación bajo demanda (sin correr una predicción completa):
        usa la última fecha de SPY como corte, califica lo vencido, mete el
        feedback al dataset y devuelve el track record actualizado. Las
        predicciones para sesiones FUTURAS siguen (correctamente) pendientes."""
        today = datetime.utcnow()
        d_from = (today - timedelta(days=15)).strftime("%Y-%m-%d")
        d_to = today.strftime("%Y-%m-%d")
        hist = self.finder._daily_history("SPY", d_from, d_to)
        dates, _o, _h, _l, _c, _v = self.finder._parse_bars(hist)
        eod_as_of = dates[-1] if dates else None
        # avanza el corte a hoy si la sesión regular ya cerró (vía SPY intradía),
        # aunque FMP todavía no haya publicado la barra EOD del día
        as_of = self._advance_as_of(eod_as_of)
        graded, feedback = self._grade_pending(as_of)
        fed = self._upsert_training(feedback, "grade-now")
        with self._db_lock, closing(self._db()) as conn, conn:
            pending_future = conn.execute(
                "SELECT COUNT(*) AS n FROM predictions WHERE status='pending' "
                "AND for_date > ?", (as_of,)).fetchone()["n"]
        return {"as_of": as_of, "graded_now": graded, "feedback_rows": fed,
                "pending_future": pending_future, "track_record": self.track_record(),
                "insights": self.insights(), "learning_log": self.learning_log()}

    # ── Diario de aprendizaje ────────────────────────────────────────────────
    def _log_learning(self, kind: str, message: str) -> None:
        """Registra un aprendizaje (dedupe: no repite el mismo mensaje en 24h)."""
        cutoff = (datetime.utcnow() - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M")
        with self._db_lock, closing(self._db()) as conn, conn:
            dup = conn.execute(
                "SELECT 1 FROM learning_log WHERE message=? AND created_at >= ?",
                (message, cutoff)).fetchone()
            if dup is None:
                conn.execute("INSERT INTO learning_log (created_at, kind, message) "
                             "VALUES (?,?,?)",
                             (datetime.utcnow().strftime("%Y-%m-%d %H:%M"), kind, message))

    def learning_log(self, limit: int = 15) -> List[Dict[str, Any]]:
        with self._db_lock, closing(self._db()) as conn, conn:
            rows = conn.execute("SELECT created_at, kind, message FROM learning_log "
                                "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    # ── Insights: las preguntas que el motor se hace sobre sus resultados ────
    def insights(self) -> Dict[str, Any]:
        with self._db_lock, closing(self._db()) as conn, conn:
            pms = conn.execute(
                "SELECT pm.*, p.pattern, p.surge_prob_pct, p.entry_type AS pred_entry "
                "FROM post_mortems pm JOIN predictions p ON p.id = pm.pred_id "
                "ORDER BY pm.for_date DESC LIMIT 400").fetchall()
        n = len(pms)
        out: Dict[str, Any] = {"n": n, "texts": [], "recent_verdicts": [
            {"symbol": r["symbol"], "for_date": r["for_date"], "side": r["side"],
             "verdict": r["verdict"]} for r in pms[:10]]}
        if n == 0:
            return out

        filled = [r for r in pms if r["filled"]]
        missed = [r for r in pms if r["missed"]]
        rs = [r["r"] for r in filled if r["r"] is not None]
        r_opens = [r["r_open"] for r in pms if r["r_open"] is not None]
        out["fill_rate_pct"] = round(100.0 * len(filled) / n, 1)
        out["missed_move_rate_pct"] = round(100.0 * len(missed) / n, 1)
        out["avg_r_filled"] = round(float(np.mean(rs)), 3) if rs else None
        out["avg_r_open_counterfactual"] = round(float(np.mean(r_opens)), 3) if r_opens else None

        if n >= 5:
            if out["missed_move_rate_pct"] >= 40:
                self._log_learning("insight", (
                    f"El {out['missed_move_rate_pct']}% de los picks sin fill IGUAL hicieron el "
                    f"movimiento — la entrada en el disparo pierde explosiones; la validación "
                    f"dual ya prefiere el open cuando la historia del símbolo lo paga."))
            if (out["avg_r_open_counterfactual"] is not None and rs
                    and out["avg_r_open_counterfactual"] > (out["avg_r_filled"] or 0) + 0.1):
                self._log_learning("insight", (
                    f"Contrafactual: entrar al open habría dado {out['avg_r_open_counterfactual']}R "
                    f"medio vs {out['avg_r_filled']}R real — el motor pondera esto por símbolo."))

        # ¿pasa algo above/below un umbral de volumen de sesión?
        hi = [r["r"] for r in filled if r["r"] is not None
              and (r["session_vol_ratio"] or 0) >= 1.5]
        lo_ = [r["r"] for r in filled if r["r"] is not None
               and (r["session_vol_ratio"] or 0) < 1.5]
        if len(hi) >= 3 and len(lo_) >= 3:
            out["vol_threshold"] = {
                "above_1_5x": {"n": len(hi), "avg_r": round(float(np.mean(hi)), 3)},
                "below_1_5x": {"n": len(lo_), "avg_r": round(float(np.mean(lo_)), 3)},
            }
            if float(np.mean(hi)) > float(np.mean(lo_)) + 0.2:
                self._log_learning("insight", (
                    f"Umbral de volumen: con vol de sesión ≥1.5× el R medio es "
                    f"{round(float(np.mean(hi)), 2)} vs {round(float(np.mean(lo_)), 2)} por debajo "
                    f"— confirmar volumen antes de entrar suma."))

        # ¿qué patrones respetan más?
        by_pat: Dict[str, List[float]] = {}
        for r in filled:
            if r["pattern"] and r["r"] is not None:
                by_pat.setdefault(r["pattern"], []).append(r["r"])
        pat_rows = [{"pattern": p, "n": len(v), "avg_r": round(float(np.mean(v)), 3)}
                    for p, v in by_pat.items() if len(v) >= 3]
        pat_rows.sort(key=lambda x: -x["avg_r"])
        out["by_pattern"] = pat_rows
        if pat_rows:
            best, worst = pat_rows[0], pat_rows[-1]
            if best["avg_r"] > 0 and best is not worst:
                self._log_learning("insight", (
                    f"Mejor setup hasta ahora: «{best['pattern']}» ({best['avg_r']}R medio, "
                    f"n={best['n']}); peor: «{worst['pattern']}» ({worst['avg_r']}R). "
                    f"La red ya recibe el patrón como feature y el feedback ×3 refuerza esto."))

        # ¿la P(explosión) de la red discrimina en la práctica?
        hi_p = [r["r"] for r in filled if r["r"] is not None
                and (r["surge_prob_pct"] or 0) >= 75]
        lo_p = [r["r"] for r in filled if r["r"] is not None
                and 0 < (r["surge_prob_pct"] or 0) < 75]
        if len(hi_p) >= 3 and len(lo_p) >= 3:
            out["prob_buckets"] = {
                "p_ge_75": {"n": len(hi_p), "avg_r": round(float(np.mean(hi_p)), 3)},
                "p_lt_75": {"n": len(lo_p), "avg_r": round(float(np.mean(lo_p)), 3)},
            }

        # ── Razonamiento sobre la "previa" (volumen, hora, premarket) ────────
        def key(r):  # noqa: ANN001 — helper local
            return "win" if (r["r"] or 0) > 0 else "loss"
        winners = [r for r in filled if (r["r"] or 0) > 0]
        losers = [r for r in filled if (r["r"] or 0) <= 0]

        def avg(rows, col):  # noqa: ANN001
            xs = [r[col] for r in rows if col in r.keys() and r[col] is not None]
            return round(float(np.mean(xs)), 2) if xs else None

        reasoning: Dict[str, Any] = {}
        # ¿el volumen venía subiendo vs día/semana previa en los ganadores?
        if len(winners) >= 3:
            reasoning["winners_vol_vs_prior_day"] = avg(winners, "vol_vs_prior_day")
            reasoning["winners_vol_vs_prior_week"] = avg(winners, "vol_vs_prior_week")
            reasoning["losers_vol_vs_prior_day"] = avg(losers, "vol_vs_prior_day")
            wd, ld = avg(winners, "vol_vs_prior_day"), avg(losers, "vol_vs_prior_day")
            if wd is not None and ld is not None and wd > ld * 1.2:
                self._log_learning("insight", (
                    f"La previa importa: los ganadores traían {wd}× el volumen del día previo "
                    f"vs {ld}× los perdedores — el volumen creciente antes del disparo anticipa la explosión."))
            # ¿a qué hora explotan? (mediana de la hora del extremo favorable)
            times = [(r["high_time_min"] if r["side"] == "long" else r["low_time_min"])
                     for r in winners
                     if (r["high_time_min"] if r["side"] == "long" else r["low_time_min"]) is not None]
            if len(times) >= 3:
                med_t = int(np.median(times))
                reasoning["winners_median_move_time"] = self._hhmm(med_t)
                bucket = ("primera hora (open drive)" if med_t <= 630 else
                          "media mañana" if med_t <= 720 else
                          "mediodía/tarde temprano" if med_t <= 840 else "cierre (power hour)")
                self._log_learning("insight", (
                    f"Timing: los movimientos ganadores tienden a marcar su extremo hacia "
                    f"~{self._hhmm(med_t)} ET ({bucket})."))
            # premarket de los ganadores
            pmg = avg(winners, "pm_gap_pct"); pmr = avg(winners, "pm_range_pct")
            if pmg is not None or pmr is not None:
                reasoning["winners_pm_gap_pct"] = pmg
                reasoning["winners_pm_range_pct"] = pmr
        out["reasoning"] = reasoning
        # snapshot de las últimas previas (para mostrar el detalle en la UI)
        out["recent_previews"] = [{
            "symbol": r["symbol"], "for_date": r["for_date"], "side": r["side"],
            "outcome": r["outcome"], "r": r["r"],
            "vol_vs_prior_day": r["vol_vs_prior_day"] if "vol_vs_prior_day" in r.keys() else None,
            "vol_vs_prior_week": r["vol_vs_prior_week"] if "vol_vs_prior_week" in r.keys() else None,
            "move_time": self._hhmm((r["high_time_min"] if r["side"] == "long"
                                     else r["low_time_min"]) if "high_time_min" in r.keys() else None),
            "pm_gap_pct": r["pm_gap_pct"] if "pm_gap_pct" in r.keys() else None,
        } for r in pms[:12]]
        return out

    # ── Loop autónomo: aprende solo, cada hora, mientras el backend corre ────
    def auto_learn(self) -> Dict[str, Any]:
        """Grade + post-mortems + insights + retrain si hay feedback nuevo.
        Es lo que corre el hilo de fondo y el endpoint /grade."""
        res = self.grade_now()
        if res.get("graded_now", 0) > 0:
            self._log_learning("grade", (
                f"Calificadas {res['graded_now']} predicciones contra precios reales "
                f"(+{res['feedback_rows']} ejemplos ×3 al dataset)."))
        if res.get("feedback_rows", 0) >= 5 and TORCH_AVAILABLE:
            try:
                info = self._train_model(lambda p, s: None)
                if info.get("trained"):
                    self._log_learning("retrain", (
                        f"Red re-entrenada con el feedback nuevo: {info['rows']} ejemplos, "
                        f"AUC↑ {info.get('auc_up')}, {info.get('epochs')} épocas."))
            except Exception as e:  # noqa: BLE001
                logger.debug("[Ultimate] auto retrain failed: %s", e)
        res["learning_log"] = self.learning_log()
        return res

    def _auto_learn_loop(self) -> None:
        time.sleep(120)  # dejar levantar el backend
        while True:
            try:
                if not self._busy:
                    self.auto_learn()
            except Exception as e:  # noqa: BLE001
                logger.debug("[Ultimate] auto-learn loop: %s", e)
            time.sleep(3600)

    def track_record(self) -> Dict[str, Any]:
        """KPIs del historial calificado + últimas predicciones (para la UI)."""
        with self._db_lock, closing(self._db()) as conn, conn:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE status='graded' "
                "ORDER BY for_date DESC LIMIT 400").fetchall()
            recent = conn.execute(
                "SELECT for_date, symbol, side, entry, stop, target, score, status, "
                "outcome, outcome_r, exit_price, days_held, pattern, surge_prob_pct, "
                "entry_type FROM predictions ORDER BY id DESC LIMIT 60").fetchall()

        def _stats(subset: List[sqlite3.Row]) -> Dict[str, Any]:
            fills = [r for r in subset if r["outcome"] != "no_fill"]
            rs = [r["outcome_r"] for r in fills if r["outcome_r"] is not None]
            wins = [x for x in rs if x > 0]
            return {
                "n": len(subset),
                "fills": len(fills),
                "fill_rate_pct": round(100.0 * len(fills) / len(subset), 1) if subset else None,
                "win_rate_pct": round(100.0 * len(wins) / len(rs), 1) if rs else None,
                "avg_r": round(float(np.mean(rs)), 3) if rs else None,
                "total_r": round(float(np.sum(rs)), 2) if rs else None,
            }

        # rendimiento por patrón de setup: qué "previas" están funcionando
        by_pattern: List[Dict[str, Any]] = []
        pats: Dict[str, List[sqlite3.Row]] = {}
        for r in rows:
            pat = r["pattern"] if "pattern" in r.keys() else None
            if pat:
                pats.setdefault(pat, []).append(r)
        for pat, subset in sorted(pats.items(), key=lambda kv: -len(kv[1])):
            by_pattern.append({"pattern": pat, **_stats(subset)})

        return {
            "overall": _stats(list(rows)),
            "long": _stats([r for r in rows if r["side"] == "long"]),
            "short": _stats([r for r in rows if r["side"] == "short"]),
            "by_pattern": by_pattern,
            "recent": [dict(r) for r in recent],
        }

    @staticmethod
    def _side_bias(track: Dict[str, Any]) -> Dict[str, float]:
        """Sesgo del track record real sobre el ranking (n≥8 fills por lado)."""
        bias = {"long": 1.0, "short": 1.0}
        for side in ("long", "short"):
            st = track.get(side) or {}
            if (st.get("fills") or 0) >= 8 and st.get("avg_r") is not None:
                bias[side] = float(np.clip(1.0 + st["avg_r"] * 0.15, 0.85, 1.15))
        return bias

    # ── B. Contexto de mercado + mapas por-fecha para features ───────────────
    def _market_context(self, date_from: str, date_to: str
                        ) -> Tuple[Dict[str, Any], Dict[str, float], Dict[str, Dict[str, float]]]:
        """(ctx serializable, spy_map fecha→ret20, {etf: fecha→ret20})."""
        def ret20_map(closes: np.ndarray, dts: List[str]) -> Dict[str, float]:
            out: Dict[str, float] = {}
            for j in range(SECTOR_RET_WINDOW, len(dts)):
                a = float(closes[j - SECTOR_RET_WINDOW])
                if a > 0:
                    out[dts[j]] = round((float(closes[j]) / a - 1.0) * 100, 2)
            return out

        etf_ret: Dict[str, float] = {}
        etf_maps: Dict[str, Dict[str, float]] = {}
        spy_map: Dict[str, float] = {}
        spy20 = spy5 = None
        as_of = None
        for etf in sorted(set(SECTOR_ETF.values())) + ["SPY"]:
            hist = self.finder._daily_history(etf, date_from, date_to)
            dts, _o, _h, _l, cc, _v = self.finder._parse_bars(hist)
            if len(dts) < SECTOR_RET_WINDOW + 1:
                continue
            m = ret20_map(cc, dts)
            if etf == "SPY":
                spy_map = m
                spy20 = m.get(dts[-1])
                as_of = dts[-1]
                if len(cc) >= 6 and float(cc[-6]) > 0:
                    spy5 = round((float(cc[-1]) / float(cc[-6]) - 1.0) * 100, 2)
            else:
                etf_maps[etf] = m
                if m.get(dts[-1]) is not None:
                    etf_ret[etf] = m[dts[-1]]
        regime = "neutral"
        if spy20 is not None:
            regime = "risk_on" if spy20 >= 2.0 else ("risk_off" if spy20 <= -2.0 else "neutral")
        ranked = sorted(etf_ret.items(), key=lambda kv: kv[1], reverse=True)
        ctx = {
            "as_of": as_of,
            "spy_ret5_pct": spy5,
            "spy_ret20_pct": spy20,
            "regime": regime,
            "etf_ret20": etf_ret,
            "hot_sectors": [{"etf": k, "ret20_pct": v} for k, v in ranked[:3]],
            "cold_sectors": [{"etf": k, "ret20_pct": v} for k, v in ranked[-3:][::-1]],
        }
        return ctx, spy_map, etf_maps

    # ── C. Escaneo por símbolo: candidato + cosecha de entrenamiento ─────────
    def _scan_symbol(self, meta: Dict, cfg: Dict[str, Any], ctx: Dict[str, Any],
                     spy_map: Dict[str, float], etf_maps: Dict[str, Dict[str, float]],
                     rng: np.random.Generator
                     ) -> Tuple[Optional[Dict], List[Tuple], List[float]]:
        """Devuelve (candidato|None, filas_entrenamiento, magnitudes_surge)."""
        symbol = meta["symbol"]
        hist = self.finder._daily_history(symbol, cfg["_hist_from"], cfg["_hist_to"])
        if len(hist) < MIN_BARS:
            return None, [], []
        dates, o, h, lo, c, v = self.finder._parse_bars(hist)
        n = len(dates)
        if n < MIN_BARS:
            return None, [], []

        etf = SECTOR_ETF.get(meta["sector"])
        etf_map = etf_maps.get(etf) if etf else None

        # ── Cosecha de ejemplos históricos para la red ────────────────────────
        pos_idx: List[Tuple[int, Tuple[int, int, float, float]]] = []
        neg_idx: List[int] = []
        surge_mags: List[float] = []
        crash_mags: List[float] = []
        i = 60
        while i < n - 1:
            lab = _labels_at(c, h, lo, i)
            if lab is not None:
                up, down, s_pct, c_pct = lab
                if up or down:
                    pos_idx.append((i, lab))
                    if up:
                        surge_mags.append(s_pct)
                    if down:
                        crash_mags.append(c_pct)
                    i += SURGE_DAYS  # dedupe como el Edge Finder
                    continue
                neg_idx.append(i)
            i += 1

        n_neg = min(len(neg_idx), max(5, NEG_PER_POS * max(len(pos_idx), 1)))
        sampled_neg = list(rng.choice(neg_idx, size=n_neg, replace=False)) if neg_idx else []
        train_rows: List[Tuple] = []
        mcap = meta.get("market_cap")
        for idx, lab in pos_idx[:MAX_ROWS_PER_SYMBOL]:
            vec = _feature_vector(dates, o, h, lo, c, v, idx, spy_map, etf_map, mcap)
            if vec is not None:
                up, down, s_pct, _ = lab
                train_rows.append((symbol, dates[idx],
                                   json.dumps([round(float(x), 4) for x in vec]),
                                   up, down, s_pct, 1.0))
        for idx in sampled_neg[:MAX_ROWS_PER_SYMBOL]:
            vec = _feature_vector(dates, o, h, lo, c, v, int(idx), spy_map, etf_map, mcap)
            if vec is not None:
                train_rows.append((symbol, dates[int(idx)],
                                   json.dumps([round(float(x), 4) for x in vec]),
                                   0, 0, 0.0, 1.0))

        # ── Candidato al último cierre ────────────────────────────────────────
        cand = self._build_candidate(meta, cfg, ctx, dates, o, h, lo, c, v,
                                     spy_map, etf_map, surge_mags, crash_mags)
        return cand, train_rows, surge_mags

    def _build_candidate(self, meta: Dict, cfg: Dict[str, Any], ctx: Dict[str, Any],
                         dates: List[str], o: np.ndarray, h: np.ndarray,
                         lo: np.ndarray, c: np.ndarray, v: np.ndarray,
                         spy_map: Dict[str, float], etf_map: Optional[Dict[str, float]],
                         surge_mags: List[float], crash_mags: List[float]
                         ) -> Optional[Dict]:
        n = len(dates)
        try:
            gap_days = (datetime.strptime(ctx["as_of"], "%Y-%m-%d")
                        - datetime.strptime(dates[-1], "%Y-%m-%d")).days
        except (ValueError, TypeError):
            gap_days = 0
        if gap_days > STALE_DAYS:
            return None

        price = float(c[-1])
        if price <= 0 or not (cfg["price_min"] <= price <= cfg["price_max"]):
            return None

        va = v[-1 - VOL_AVG_WINDOW:-1]
        vol_avg20 = float(np.mean(va)) if va.size >= 5 else 0.0
        if price * vol_avg20 < MIN_DOLLAR_VOL:
            return None
        vol_ratio = round(float(v[-1]) / vol_avg20, 2) if vol_avg20 > 0 else None

        tr = (h[-14:] - lo[-14:]) / np.where(c[-14:] > 0, c[-14:], 1.0) * 100
        atr_pct = round(float(np.mean(tr)), 2)
        if atr_pct < MIN_ATR_PCT:
            return None

        pre_c, pre_h, pre_l = c[-PRE_BARS:], h[-PRE_BARS:], lo[-PRE_BARS:]
        pattern, ret10, compression, _avg_tr = \
            EdgeFinderEngine._classify_pattern(pre_c, pre_h, pre_l)
        consec_red, consec_green = EdgeFinderEngine._consecutive(c[-(PRE_BARS + 1):])

        lb_l, lb_h = lo[-252:], h[-252:]
        dist_low = dist_high = None
        if lb_l.size >= 120 and float(np.min(lb_l)) > 0:
            low52, high52 = float(np.min(lb_l)), float(np.max(lb_h))
            dist_low = round((price - low52) / low52 * 100, 1)
            dist_high = round((price - high52) / high52 * 100, 1) if high52 > 0 else None

        sma20 = float(np.mean(c[-20:]))
        sma50 = float(np.mean(c[-50:])) if n >= 50 else sma20

        etf = SECTOR_ETF.get(meta["sector"])
        sec_ret = ctx["etf_ret20"].get(etf) if etf else None
        spy20 = ctx["spy_ret20_pct"]
        hot_now = bool(sec_ret > spy20) if (sec_ret is not None and spy20 is not None) else None

        trigger = float(np.max(pre_h))
        prox = (price - trigger) / trigger * 100.0 if trigger > 0 else -99.0
        prior_trigger = float(np.max(h[-(PRE_BARS + 1):-1]))
        breaking = bool(n >= 2 and price > prior_trigger and c[-1] > c[-2])

        last_red = bool(c[-1] < o[-1])
        day_range = float(h[-1] - lo[-1])
        close_pos = (price - float(lo[-1])) / day_range if day_range > 0 else 0.5

        # movimiento explosivo esperado: mediana de SUS propios surges/crashes
        exp_up = round(float(np.median(surge_mags)), 1) if len(surge_mags) >= 2 else SURGE_PCT_MIN
        exp_down = round(float(np.median(crash_mags)), 1) if len(crash_mags) >= 2 else CRASH_PCT_MIN

        # ── Pedigrí de surge (alineación con Edge Finder) ────────────────────
        # El Edge Finder muestra que los +100% dejan huella: nombres con
        # historial de movimientos GRANDES tienen más chance de repetirlos. Se
        # premia en el ranking a los que ya explotaron fuerte y seguido, y se
        # castiga a los de surge chico (lo que el usuario marcó como problema).
        def pedigree_of(mags: List[float]) -> Tuple[float, float]:
            mx = float(max(mags)) if mags else 0.0
            ped = 0.65
            if len(mags) >= 2:
                ped += 0.10
            if len(mags) >= 4:
                ped += 0.10
            if mx >= 50:
                ped += 0.15
            if mx >= 100:  # movers a escala Edge Finder
                ped += 0.25
            return round(min(ped, 1.35), 3), round(mx, 1)

        def score_of(weights: Dict[str, float], comps: Dict[str, Tuple[float, str]],
                     side: str) -> Tuple[float, List[Dict]]:
            parts, total = [], 0.0
            for key, w in weights.items():
                s01, detail = comps[key]
                pts = round(w * max(0.0, min(1.0, s01)), 1)
                total += pts
                parts.append({"key": key, "max": w, "points": pts, "detail": detail})
            tilt = 1.0
            if ctx["regime"] == "risk_on":
                tilt = 1.05 if side == "long" else 0.92
            elif ctx["regime"] == "risk_off":
                tilt = 0.92 if side == "long" else 1.05
            return round(min(100.0, total * tilt), 1), parts

        candidates_here: List[Dict] = []

        # LONG: breakout inminente del high de 10 días → surge esperado
        long_ok = (breaking or prox >= -LONG_NEAR_TRIGGER_PCT) and ret10 > LONG_MIN_RET10
        if long_ok and trigger > 0:
            comps = {
                "trigger": ((1.0, "cerró sobre el high de 10 días — breakout en curso") if breaking
                            else (1.0 - abs(prox) / LONG_NEAR_TRIGGER_PCT,
                                  f"cierre a {round(prox, 1)}% del disparo (high 10d)")),
                "pattern": (PATTERN_LONG_QUALITY.get(pattern, 0.4), f"patrón previo: {pattern}"),
                "volume": ((1.0 if vol_ratio and vol_ratio >= 3 else
                            0.8 if vol_ratio and vol_ratio >= 1.5 else
                            0.6 if vol_ratio and vol_ratio >= 1.0 else 0.4),
                           f"volumen {vol_ratio}× su promedio 20d" if vol_ratio else "volumen s/d"),
                "sector": ((0.5, "sin ETF sectorial — neutro") if hot_now is None else
                           ((1.0, f"sector HOT ({etf} {sec_ret:+}% vs SPY {spy20:+}%)") if hot_now
                            else (0.3, f"sector COLD ({etf} {sec_ret:+}% vs SPY {spy20:+}%)"))),
                "trend": ((1.0, "cierre > SMA20 > SMA50 — tendencia sana")
                          if price > sma20 > sma50 else
                          (0.7, "cierre sobre SMA20") if price > sma20 else
                          (0.4, "cierre bajo SMA20 — tendencia débil")),
                "risk": ((1.0, f"ATR {atr_pct}% — rango operable") if 2 <= atr_pct <= 10 else
                         (0.7, f"ATR {atr_pct}%") if atr_pct <= 15 else
                         (0.3, f"ATR {atr_pct}% — volatilidad extrema")),
            }
            score, parts = score_of(LONG_W, comps, "long")
            entry = _px(trigger)
            stop, target, risk, rr = _plan_levels(
                "long", entry, float(np.min(lo[-STOP_BARS_LONG:])), exp_up, atr_pct)
            if rr >= MIN_RR:
                candidates_here.append({
                    "side": "long", "score": score, "score_breakdown": parts,
                    "entry": entry, "stop": stop, "target": target,
                    "rr": rr, "risk_pct": round(risk / entry * 100, 1),
                    "exp_move_pct": exp_up,
                    "own_surges": len(surge_mags),
                    "pedigree": pedigree_of(surge_mags)[0],
                    "own_surge_max": pedigree_of(surge_mags)[1],
                    "status": "breaking" if breaking else "ready",
                })

        # SHORT: sobre-extensión parabólica → desplome esperado
        short_ok = ret10 >= SHORT_RET10_MIN or consec_green >= SHORT_CONSEC_GREEN_MIN
        if short_ok:
            comps = {
                "overext": (min(1.0, max(0.0, (ret10 - SHORT_RET10_MIN) / 40.0 + 0.5))
                            if ret10 >= SHORT_RET10_MIN else 0.6,
                            f"+{round(ret10, 1)}% en 10 días · {consec_green} verdes seguidos"),
                "fatigue": ((1.0, "último día rojo — el impulso se agota") if last_red else
                            (0.8, "cierre en el tercio bajo del rango — presión vendedora")
                            if close_pos <= 0.33 else
                            (0.35, "aún cierra fuerte — sin señal de fatiga")),
                "volume": ((1.0 if vol_ratio and vol_ratio >= 3 else
                            0.7 if vol_ratio and vol_ratio >= 1.5 else 0.4),
                           f"volumen {vol_ratio}× — clímax" if vol_ratio and vol_ratio >= 3
                           else (f"volumen {vol_ratio}×" if vol_ratio else "volumen s/d")),
                "sector": ((0.5, "sin ETF sectorial — neutro") if hot_now is None else
                           ((1.0, f"sector COLD ({etf} {sec_ret:+}%) — sin viento de cola")
                            if not hot_now else (0.4, f"sector HOT ({etf} {sec_ret:+}%)"))),
                "high52": ((1.0, f"a {dist_high}% del máximo 52w — extendido")
                           if dist_high is not None and dist_high > -5 else
                           (0.6, f"a {dist_high}% del máximo 52w") if dist_high is not None
                           else (0.5, "máximo 52w s/d")),
                "risk": ((1.0, f"ATR {atr_pct}% — rango operable") if 3 <= atr_pct <= 12 else
                         (0.6, f"ATR {atr_pct}%")),
            }
            score, parts = score_of(SHORT_W, comps, "short")
            entry = _px(float(lo[-1]))
            stop, target, risk, rr = _plan_levels(
                "short", entry, float(np.max(h[-STOP_BARS_SHORT:])), exp_down, atr_pct)
            if rr >= MIN_RR:
                candidates_here.append({
                    "side": "short", "score": score, "score_breakdown": parts,
                    "entry": entry, "stop": stop, "target": target,
                    "rr": rr, "risk_pct": round(risk / entry * 100, 1),
                    "exp_move_pct": exp_down,
                    "own_surges": len(crash_mags),
                    "pedigree": pedigree_of(crash_mags)[0],
                    "own_surge_max": pedigree_of(crash_mags)[1],
                    "status": "ready",
                })

        best = max(candidates_here, key=lambda x: x["score"], default=None)
        if best is None:
            return None

        feats = _feature_vector(dates, o, h, lo, c, v, n - 1, spy_map, etf_map,
                                meta.get("market_cap"))
        best.update({
            "symbol": meta["symbol"],
            "sector": meta["sector"],
            "industry": meta["industry"],
            "exchange": meta["exchange"],
            "market_cap": meta["market_cap"],
            "as_of": dates[-1],
            "price": _px(price),
            "pattern": pattern,
            "ret10_pct": ret10,
            "compression": compression,
            "atr_pct": atr_pct,
            "vol_ratio": vol_ratio,
            "consec_red": consec_red,
            "consec_green": consec_green,
            "dist_52w_low_pct": dist_low,
            "dist_52w_high_pct": dist_high,
            "sector_etf": etf,
            "sector_ret20_pct": sec_ret,
            "sector_hot_now": hot_now,
            "surge_prob_pct": None,     # lo llena la red tras el entrenamiento
            "p_up_pct": None,
            "p_down_pct": None,
            "_features": feats,
            "_arrays": (o, h, lo, c),
        })
        return best

    # ── E. Validación: backtest del MISMO setup con target explosivo ─────────
    # Prueba DOS modos de entrada sobre la historia del propio símbolo —
    # (a) buy/sell stop en el nivel de disparo, (b) a mercado en el open del
    # D+1 — y publica el modo que mejor expectancy real generó. Así el motor
    # aprende por símbolo qué entrada "respeta más" en vez de asumir una.
    @staticmethod
    def _validate(cand: Dict) -> Dict[str, Any]:
        o, h, lo, c = cand["_arrays"]
        n = len(c)
        side = cand["side"]
        exp_move = float(cand["exp_move_pct"])
        # ATR% por barra para dimensionar el stop igual que en vivo (sin ruido)
        tr_all = (h - lo) / np.where(c > 0, c, 1.0) * 100.0
        events = 0
        mode: Dict[str, Dict[str, List]] = {
            "stop": {"rs": [], "days": [], "wins": []},
            "open": {"rs": [], "days": [], "wins": []},
        }
        i = 60
        while i < n - 1:
            setup = False
            if side == "long":
                trig = float(np.max(h[i - PRE_BARS + 1:i + 1]))
                if trig > 0 and float(c[i - PRE_BARS + 1]) > 0:
                    prox = (float(c[i]) - trig) / trig * 100.0
                    r10 = (float(c[i]) / float(c[i - PRE_BARS + 1]) - 1.0) * 100.0
                    setup = prox >= -LONG_NEAR_TRIGGER_PCT and r10 > LONG_MIN_RET10
                level = trig
                raw_stop = float(np.min(lo[i - STOP_BARS_LONG + 1:i + 1]))
            else:
                r10 = (float(c[i]) / float(c[i - PRE_BARS + 1]) - 1.0) * 100.0 \
                    if float(c[i - PRE_BARS + 1]) > 0 else 0.0
                _red, green = EdgeFinderEngine._consecutive(c[i - PRE_BARS:i + 1])
                setup = r10 >= SHORT_RET10_MIN or green >= SHORT_CONSEC_GREEN_MIN
                level = float(lo[i])
                raw_stop = float(np.max(h[i - STOP_BARS_SHORT + 1:i + 1]))
            if not setup or level <= 0:
                i += 1
                continue

            events += 1
            step_days = None
            atr_i = float(np.mean(tr_all[max(0, i - 13):i + 1]))
            # (a) entrada con orden stop en el disparo
            entry = _px(level)
            stop, target, _risk, _rr = _plan_levels(side, entry, raw_stop, exp_move, atr_i)
            fill = _try_fill(side, entry, float(o[i + 1]), float(h[i + 1]), float(lo[i + 1]))
            if fill is not None:
                r, _reason, days, _exit = _sim_trade(side, fill, stop, target, h, lo, c, i + 1)
                if r is not None:
                    mode["stop"]["rs"].append(min(max(r, -3.0), 12.0))
                    mode["stop"]["days"].append(days)
                    mode["stop"]["wins"].append(1 if r > 0 else 0)
                    step_days = days
            # (b) entrada a mercado en el open del D+1
            eo = float(o[i + 1])
            if eo > 0:
                stop_o, target_o, _r2, _rr2 = _plan_levels(side, eo, raw_stop, exp_move, atr_i)
                r_o, _reason_o, days_o, _exit_o = _sim_trade(side, eo, stop_o, target_o,
                                                             h, lo, c, i + 1)
                if r_o is not None:
                    mode["open"]["rs"].append(min(max(r_o, -3.0), 12.0))
                    mode["open"]["days"].append(days_o)
                    mode["open"]["wins"].append(1 if r_o > 0 else 0)
                    if step_days is None:
                        step_days = days_o
            i += (1 + step_days) if step_days is not None else 2

        def stats(m: str) -> Dict[str, Any]:
            rs, days, wins = mode[m]["rs"], mode[m]["days"], mode[m]["wins"]
            return {
                "fills": len(rs),
                "win_rate_pct": round(100.0 * sum(wins) / len(rs), 1) if rs else None,
                "expectancy_r": round(float(np.mean(rs)), 3) if rs else None,
                "total_r": round(float(np.sum(rs)), 2) if rs else None,
                "med_days_held": int(np.median(days)) if days else None,
            }

        s_stop, s_open = stats("stop"), stats("open")
        # el motor elige el modo de entrada que SU historia pagó mejor
        chosen = "stop"
        if (s_open["fills"] >= VAL_MIN_FILLS
                and (s_open["expectancy_r"] or -9) > (s_stop["expectancy_r"] or -9)
                and (s_stop["fills"] < VAL_MIN_FILLS
                     or (s_open["expectancy_r"] or 0) > (s_stop["expectancy_r"] or 0) + 0.05)):
            chosen = "open"
        cs = s_open if chosen == "open" else s_stop

        result = {
            "events": events,
            "entry_type": chosen,
            "by_entry": {"stop": s_stop, "open": s_open},
            "fills": cs["fills"],
            "win_rate_pct": cs["win_rate_pct"],
            "expectancy_r": cs["expectancy_r"],
            "total_r": cs["total_r"],
            "med_days_held": cs["med_days_held"],
            "passed": False,
            "reject_reason": None,
        }
        if events < VAL_MIN_EVENTS:
            result["reject_reason"] = f"solo {events} setups históricos (mín {VAL_MIN_EVENTS})"
        elif cs["fills"] < VAL_MIN_FILLS:
            result["reject_reason"] = f"solo {cs['fills']} ejecuciones históricas (mín {VAL_MIN_FILLS})"
        elif cs["expectancy_r"] is None or cs["expectancy_r"] < VAL_MIN_EXPECTANCY:
            result["reject_reason"] = (f"expectancy {cs['expectancy_r']}R < {VAL_MIN_EXPECTANCY}R "
                                       "(en ambos modos de entrada) — la acción no explotó así en el pasado")
        elif cs["win_rate_pct"] is not None and cs["win_rate_pct"] < VAL_MIN_WINRATE:
            result["reject_reason"] = f"win rate {cs['win_rate_pct']}% < {VAL_MIN_WINRATE}%"
        else:
            result["passed"] = True
        return result

    # ── F. Veto de dilución (EDGAR) ───────────────────────────────────────────
    @staticmethod
    def _dilution_check(symbol: str) -> Optional[Dict[str, Any]]:
        try:
            from dilution_engine import get_dilution_engine
            engine = get_dilution_engine(os.environ.get("FMP_API_KEY", ""))
            res = engine.analyze(symbol)
            if res.get("error"):
                return None
            risk = (res.get("riskScores") or {}).get("overallRisk") or {}
            return {
                "score": risk.get("score"),
                "label": risk.get("label"),
                "dilution_1y_pct": (res.get("riskScores") or {}).get("dilutionPct1Y"),
            }
        except Exception as e:  # noqa: BLE001
            logger.debug("[Ultimate] dilution check %s failed: %s", symbol, e)
            return None

    # ── Rationale en español ─────────────────────────────────────────────────
    @staticmethod
    def _rationale(cand: Dict, val: Dict) -> str:
        if cand["side"] == "long":
            side_txt = (f"LONG sobre el quiebre del high de 10 días, buscando un movimiento "
                        f"explosivo de ~+{cand['exp_move_pct']}% en ≤{SURGE_DAYS} días")
        else:
            side_txt = (f"SHORT sobre el quiebre del low del último día, buscando un desplome "
                        f"de ~−{cand['exp_move_pct']}% en ≤{SURGE_DAYS} días")
        prob_txt = ""
        if cand.get("surge_prob_pct") is not None:
            prob_txt = f" La red neuronal le asigna {cand['surge_prob_pct']}% de probabilidad de explosión."
        if cand.get("entry_type") == "open":
            side_txt = side_txt.replace("sobre el quiebre del high de 10 días",
                                        "a mercado en la apertura")
            side_txt = side_txt.replace("sobre el quiebre del low del último día",
                                        "a mercado en la apertura")
            prob_txt += (" Su propia historia pagó mejor entrando al open que esperando "
                         "el quiebre, así que el plan usa entrada a mercado en la apertura.")
        own = cand.get("own_surges") or 0
        own_txt = f" Este símbolo ya tuvo {own} movimientos así en el último año." if own >= 2 else ""
        top = sorted(cand["score_breakdown"], key=lambda p: p["points"] / max(p["max"], 1e-9),
                     reverse=True)[:2]
        drivers = "; ".join(p["detail"] for p in top)
        return (f"{side_txt}.{prob_txt}{own_txt} {drivers}. Validación histórica: "
                f"{val['fills']} trades del mismo setup, win rate {val['win_rate_pct']}%, "
                f"expectancy {val['expectancy_r']}R por trade.")

    # ── G. Orquestación ───────────────────────────────────────────────────────
    def run_predict(self, cfg: Dict[str, Any], progress) -> Dict[str, Any]:
        self._busy = True
        try:
            return self._run_predict_inner(cfg, progress)
        finally:
            self._busy = False

    def _run_predict_inner(self, cfg: Dict[str, Any], progress) -> Dict[str, Any]:
        t0 = time.time()
        warnings: List[str] = [
            "Universo point-in-time del screener → sesgo de supervivencia/look-ahead.",
            "Validación con barras diarias: si una barra toca stop y target se asume "
            "stop primero (conservador). No modela borrow/locate ni slippage.",
            "El «próximo día hábil» salta fines de semana pero no feriados de mercado.",
            f"Objetivo: movimientos explosivos (surge ≥ +{SURGE_PCT_MIN:.0f}% / crash ≥ "
            f"−{CRASH_PCT_MIN:.0f}% en ≤{SURGE_DAYS} días). La red mejora con cada corrida diaria.",
        ]
        if EPHEMERAL_STORAGE:
            warnings.insert(0, (
                "⚠️ ALMACENAMIENTO EFÍMERO: este backend corre en un host que BORRA el "
                "disco en cada deploy — predicciones, dataset y modelo se pierden con "
                "cada push. Monta un volumen persistente y define ULTIMATE_DATA_DIR "
                "(p.ej. /data) en las variables de entorno del servicio."))
        today = datetime.utcnow()
        cfg["_hist_from"] = (today - timedelta(days=420)).strftime("%Y-%m-%d")
        cfg["_hist_to"] = today.strftime("%Y-%m-%d")
        run_id = uuid.uuid4().hex[:12]

        progress(2, "Contexto de mercado (SPY + ETFs sectoriales)")
        ctx, spy_map, etf_maps = self._market_context(cfg["_hist_from"], cfg["_hist_to"])
        if ctx["as_of"] is None:
            ctx["as_of"] = today.strftime("%Y-%m-%d")
            warnings.append("No se pudo leer SPY; la fecha de corte es la de hoy (UTC).")
        # corte real: avanza a hoy si la sesión ya cerró (SPY intradía), para no
        # publicar picks de una sesión que ya pasó ni dejar de calificar
        market_as_of = self._advance_as_of(ctx["as_of"])
        if market_as_of > ctx["as_of"]:
            warnings.append(
                f"La sesión del {market_as_of} ya cerró (leída por intradía; EOD de FMP "
                f"aún no publicado) — los picks son para la sesión siguiente y ya se "
                f"calificó lo vencido con datos de 1 minuto.")
        for_date = _next_trading_day(market_as_of)

        progress(4, "Calificando predicciones anteriores (feedback a la red)")
        graded_now, feedback_rows = 0, []
        try:
            graded_now, feedback_rows = self._grade_pending(market_as_of)
        except Exception as e:  # noqa: BLE001
            warnings.append(f"No se pudo calificar el historial previo: {e}")
        track = self.track_record()
        bias = self._side_bias(track)
        if bias["long"] != 1.0 or bias["short"] != 1.0:
            warnings.append(
                f"Track record aplicado al ranking: sesgo long ×{round(bias['long'], 2)}, "
                f"short ×{round(bias['short'], 2)} (según R promedio realizado)."
            )

        progress(7, "Construyendo universo (screener FMP)")
        universe = self.finder._build_universe(cfg)
        if not universe:
            raise RuntimeError("No se obtuvieron tickers del screener (revisa filtros / API key)")
        full_universe = len(universe)
        cap = int(cfg["max_universe"])
        if full_universe > cap:
            warnings.append(f"Universo completo: {full_universe} tickers; limitado a {cap}.")
            universe = universe[:cap]

        progress(10, f"Escaneando {len(universe)} tickers + cosechando surges históricos")
        prelim: List[Dict] = []
        harvest: List[Tuple] = []
        all_surge_mags: List[float] = []
        done = 0
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {pool.submit(self._scan_symbol, m, cfg, ctx, spy_map, etf_maps,
                                np.random.default_rng(hash(m["symbol"]) % 2**31)):
                    m["symbol"] for m in universe}
            for fut in as_completed(futs):
                done += 1
                try:
                    cand, rows, mags = fut.result()
                    if cand is not None:
                        prelim.append(cand)
                    harvest.extend(rows)
                    all_surge_mags.extend(mags)
                except Exception as e:  # noqa: BLE001
                    logger.debug("[Ultimate] scan %s: %s", futs[fut], e)
                if done % 25 == 0 or done == len(universe):
                    pct = 10 + int(44 * done / max(len(universe), 1))
                    progress(pct, f"Escaneando {done}/{len(universe)} — {len(prelim)} setups, "
                                  f"{len(harvest)} ejemplos cosechados")

        progress(55, f"Guardando dataset ({len(harvest)} ejemplos nuevos + "
                     f"{len(feedback_rows)} de feedback)")
        added = self._upsert_training(harvest, run_id)
        added += self._upsert_training(feedback_rows, run_id)

        progress(58, "Entrenando red neuronal sobre el dataset acumulado")
        train_info = {"trained": False, "reason": "sin intento"}
        try:
            train_info = self._train_model(progress)
        except Exception as e:  # noqa: BLE001
            train_info = {"trained": False, "reason": f"error de entrenamiento: {e}"}
            logger.exception("[Ultimate] training failed")
        if not train_info.get("trained"):
            warnings.append(f"Red neuronal en espera: {train_info.get('reason')} — "
                            "ranking por score heurístico.")

        # ── Scoring con la red (o heurístico) y ranking preliminar ───────────
        progress(71, "Puntuando candidatos con la red neuronal")
        model_active = False
        featured = [x for x in prelim if x.get("_features") is not None]
        if self._model is not None and featured:
            X = np.stack([x["_features"] for x in featured])
            probs = self._predict_probs(X)
            if probs is not None:
                model_active = True
                for cand, p in zip(featured, probs):
                    cand["p_up_pct"] = round(float(p[0]) * 100, 1)
                    cand["p_down_pct"] = round(float(p[1]) * 100, 1)
                    p_side = float(p[0] if cand["side"] == "long" else p[1])
                    cand["surge_prob_pct"] = round(p_side * 100, 1)
                    cand["_rank"] = p_side * bias[cand["side"]]
        if not model_active:
            for cand in prelim:
                if cand["score"] < MIN_SCORE:
                    cand["_rank"] = -1.0
                else:
                    cand["_rank"] = cand["score"] / 100.0 * bias[cand["side"]]
        # pedigrí de surge: nombres con historial de movimientos GRANDES suben,
        # los de surge chico bajan (Edge Finder → prioriza los verdaderos movers)
        for cand in prelim:
            if cand.get("_rank", -1) > 0:
                cand["_rank"] *= float(cand.get("pedigree", 1.0))
        prelim = [x for x in prelim if x.get("_rank", -1) > 0]
        prelim.sort(key=lambda x: x["_rank"], reverse=True)
        pool_cands = prelim[:PRELIM_POOL]
        n_long = sum(1 for x in prelim if x["side"] == "long")
        n_short = len(prelim) - n_long

        progress(74, f"Validando candidatos con backtest propio ({len(pool_cands)} en cola)")
        picks: List[Dict] = []
        rejected: List[Dict] = []
        dilution_budget = DILUTION_TIME_BUDGET_S
        dilution_checks = 0
        for k, cand in enumerate(pool_cands):
            if len(picks) >= TOP_N:
                break
            progress(74 + int(18 * k / max(len(pool_cands), 1)),
                     f"Validando {cand['symbol']} ({cand['side'].upper()}) — "
                     f"{len(picks)}/{TOP_N} aprobados")
            val = self._validate(cand)
            if not val["passed"]:
                rejected.append({"symbol": cand["symbol"], "side": cand["side"],
                                 "score": cand["score"],
                                 "surge_prob_pct": cand.get("surge_prob_pct"),
                                 "stage": "backtest", "reason": val["reject_reason"]})
                continue

            dilution = None
            mc = cand.get("market_cap") or 0
            if (mc and mc < DILUTION_CAP_MAX and dilution_checks < DILUTION_MAX_CHECKS
                    and dilution_budget > 5):
                t_d = time.time()
                dilution = self._dilution_check(cand["symbol"])
                dilution_budget -= time.time() - t_d
                dilution_checks += 1
                if (cand["side"] == "long" and dilution and dilution.get("score") is not None
                        and dilution["score"] >= DILUTION_REJECT_SCORE):
                    rejected.append({"symbol": cand["symbol"], "side": cand["side"],
                                     "score": cand["score"],
                                     "surge_prob_pct": cand.get("surge_prob_pct"),
                                     "stage": "dilution",
                                     "reason": f"riesgo de dilución {dilution['score']}/100 "
                                               f"({dilution.get('label')}) — overhang EDGAR"})
                    continue

            # si su propia historia paga mejor entrando al open, se adapta el plan
            cand["entry_type"] = val["entry_type"]
            if val["entry_type"] == "open":
                o_arr, h_arr, lo_arr, c_arr = cand["_arrays"]
                ref = float(c_arr[-1])
                raw_stop = (float(np.min(lo_arr[-STOP_BARS_LONG:])) if cand["side"] == "long"
                            else float(np.max(h_arr[-STOP_BARS_SHORT:])))
                stop, target, risk, rr = _plan_levels(cand["side"], ref, raw_stop,
                                                      float(cand["exp_move_pct"]),
                                                      float(cand.get("atr_pct") or 0.0))
                cand.update({"entry": _px(ref), "stop": stop, "target": target,
                             "rr": rr, "risk_pct": round(risk / ref * 100, 1)})

            cand["validation"] = val
            cand["dilution"] = dilution
            if cand["side"] == "short" and dilution and (dilution.get("score") or 0) >= 60:
                cand["dilution_note"] = "dilución alta — viento a favor del short"
            # penalización blanda: dilución 40-69 en longs baja el ranking
            if (cand["side"] == "long" and dilution and dilution.get("score") is not None
                    and dilution["score"] >= 40):
                cand["_rank"] *= 1.0 - (dilution["score"] - 40) / 100.0
                cand["dilution_note"] = "dilución moderada — ranking penalizado"
            cand["rationale"] = self._rationale(cand, val)
            cand["exp_hold_days"] = val["med_days_held"] or MAX_HOLD_DAYS
            picks.append(cand)

        if len(picks) < TOP_N:
            warnings.append(
                f"Solo {len(picks)} de {TOP_N} candidatos superaron la validación con estos "
                "filtros — amplía el rango de precio/market cap o espera otro contexto."
            )

        # ranking final: prob (o score) × expectancy validada
        picks.sort(key=lambda x: x["_rank"] * max(x["validation"]["expectancy_r"] or 0, 0.01),
                   reverse=True)

        # ── Persistencia (con features para el feedback futuro de la red) ────
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        try:
            with self._db_lock, closing(self._db()) as conn, conn:
                conn.execute(
                    "INSERT INTO runs (run_id, created_at, for_date, params, regime, "
                    "spy_ret20, universe, picks) VALUES (?,?,?,?,?,?,?,?)",
                    (run_id, now_str, for_date,
                     json.dumps({k: v for k, v in cfg.items() if not k.startswith("_")}),
                     ctx["regime"], ctx["spy_ret20_pct"], len(universe), len(picks)))
                for cand in picks:
                    feats_json = (json.dumps([round(float(x), 4) for x in cand["_features"]])
                                  if cand.get("_features") is not None else None)
                    # dedupe: si otra corrida del mismo día ya publicó este pick
                    # pendiente, se reemplaza (queda la versión más reciente)
                    conn.execute(
                        "DELETE FROM predictions WHERE status='pending' AND "
                        "for_date=? AND symbol=? AND side=?",
                        (for_date, cand["symbol"], cand["side"]))
                    conn.execute(
                        "INSERT INTO predictions (run_id, created_at, for_date, symbol, "
                        "side, entry, stop, target, score, expectancy_r, features, "
                        "exp_move_pct, surge_prob_pct, pattern, vol_ratio, dilution_score, "
                        "entry_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (run_id, now_str, for_date, cand["symbol"], cand["side"],
                         cand["entry"], cand["stop"], cand["target"], cand["score"],
                         cand["validation"]["expectancy_r"], feats_json,
                         cand["exp_move_pct"], cand.get("surge_prob_pct"),
                         cand.get("pattern"), cand.get("vol_ratio"),
                         (cand.get("dilution") or {}).get("score"),
                         cand.get("entry_type", "stop")))
        except Exception as e:  # noqa: BLE001
            warnings.append(f"No se pudo persistir la corrida en la base local: {e}")

        # el track record del resultado debe incluir los picks recién guardados
        # (la foto tomada al inicio de la corrida quedaría desactualizada)
        try:
            track = self.track_record()
        except Exception:  # noqa: BLE001
            pass

        # limpieza de campos internos
        for cand in prelim:
            cand.pop("_arrays", None)
            cand.pop("_features", None)
            cand.pop("_rank", None)

        model = self.model_info()
        model["last_training"] = train_info
        model["examples_added_this_run"] = added
        model["active_this_run"] = model_active
        model["global_median_surge_pct"] = (round(float(np.median(all_surge_mags)), 1)
                                            if all_surge_mags else None)

        kpis = {
            "universe": len(universe),
            "setups_long": n_long,
            "setups_short": n_short,
            "validated": len(picks),
            "rejected_backtest": sum(1 for r in rejected if r["stage"] == "backtest"),
            "rejected_dilution": sum(1 for r in rejected if r["stage"] == "dilution"),
            "graded_this_run": graded_now,
            "dataset_rows": model["dataset_rows"],
            "avg_expectancy_r": (round(float(np.mean(
                [p["validation"]["expectancy_r"] for p in picks
                 if p["validation"]["expectancy_r"] is not None])), 3) if picks else None),
            "avg_surge_prob_pct": (round(float(np.mean(
                [p["surge_prob_pct"] for p in picks if p["surge_prob_pct"] is not None])), 1)
                if model_active and picks else None),
        }
        meta = {
            "run_id": run_id,
            "as_of": market_as_of,
            "eod_as_of": ctx["as_of"],
            "for_date": for_date,
            "universe_full": full_universe,
            "surge_days": SURGE_DAYS,
            "surge_pct_min": SURGE_PCT_MIN,
            "crash_pct_min": CRASH_PCT_MIN,
            "params": {k: v for k, v in cfg.items() if not k.startswith("_")},
            "runtime_s": round(time.time() - t0, 1),
            "warnings": warnings,
        }
        progress(100, "Listo")
        return {"kpis": kpis, "market": ctx, "model": model, "picks": picks,
                "rejected": rejected[:20], "track_record": track, "meta": meta}


# ═══════════════════════════════════════════════════════════════════════════
#  Config normalization + API pública del job
# ═══════════════════════════════════════════════════════════════════════════
def _normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    def f(key: str, default: float) -> float:
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    cap_min = str(raw.get("market_cap_min", "small")).lower()
    cap_max = str(raw.get("market_cap_max", "large")).lower()
    if cap_min not in MARKET_CAP_BUCKETS or cap_min == "all":
        cap_min = "nano"
    if cap_max not in MARKET_CAP_BUCKETS or cap_max == "all":
        cap_max = "mega"
    if CAP_ORDER.index(cap_min) > CAP_ORDER.index(cap_max):
        cap_min, cap_max = cap_max, cap_min

    price_min = max(f("price_min", 1.0), 0.0)
    price_max = max(f("price_max", 100.0), 0.01)
    if price_min > price_max:
        price_min, price_max = price_max, price_min

    return {
        "price_min": price_min,
        "price_max": price_max,
        "market_cap_min": cap_min,
        "market_cap_max": cap_max,
        "max_universe": int(min(max(f("max_universe", 3000), 100), 8000)),
    }


_ENGINE: Optional[UltimatePredictorEngine] = None
_ENGINE_LOCK = threading.Lock()


def get_ultimate_predictor_engine() -> UltimatePredictorEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            _ENGINE = UltimatePredictorEngine()
        return _ENGINE


def get_history() -> Dict[str, Any]:
    """Track record + últimas corridas + estado del modelo (para la UI)."""
    engine = get_ultimate_predictor_engine()
    track = engine.track_record()
    with engine._db_lock, closing(engine._db()) as conn, conn:
        runs = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT 12").fetchall()
    return {"track_record": track, "runs": [dict(r) for r in runs],
            "model": engine.model_info(), "insights": engine.insights(),
            "learning_log": engine.learning_log()}


def grade_now() -> Dict[str, Any]:
    """Ciclo de aprendizaje bajo demanda (POST /backtest/ultimate/grade):
    califica, escribe post-mortems, actualiza insights y re-entrena si hay
    feedback nuevo suficiente."""
    return get_ultimate_predictor_engine().auto_learn()


def start_job(raw_config: Dict[str, Any]) -> str:
    """Crea el job, lanza la predicción en un hilo de fondo y devuelve job_id."""
    _prune_jobs()
    cfg = _normalize_config(raw_config or {})
    job_id = uuid.uuid4().hex[:16]
    _set_job(job_id, status="queued", progress=0, stage="En cola",
             result=None, error=None, created_at=time.time())

    def _run() -> None:
        def progress(pct: int, stage: str) -> None:
            _set_job(job_id, status="running", progress=int(pct), stage=stage)
        try:
            engine = get_ultimate_predictor_engine()
            result = engine.run_predict(cfg, progress)
            _set_job(job_id, status="done", progress=100, stage="Listo", result=result)
        except Exception as e:  # noqa: BLE001
            logger.exception("[Ultimate] job %s failed", job_id)
            _set_job(job_id, status="error", error=str(e), stage="Error")

    threading.Thread(target=_run, daemon=True).start()
    return job_id
