"""
Ultimate Predictor Engine
=========================

La pieza más ambiciosa del /backtest (GOD MODE): el usuario elige SOLO un rango
de precio y un rango de market cap, y el motor produce el **Top 5 de trades
para la próxima sesión** (long o short), cada uno con entrada / stop / target y
validado por un backtest propio antes de ser publicado.

Orquesta (y aprende de) los motores existentes:

  1. **Edge Finder** — reutiliza su universo (screener FMP), su caché de
     históricos diarios, el clasificador de patrón previo (coil / base plana /
     capitulación / momentum...) y la lógica de rachas rojas/verdes.
  2. **Edge Predictor** — hereda su filosofía de scoring "estado actual vs
     perfil" (proximidad al disparo, volumen, sector hot/cold, 52w).
  3. **Estrategia 1 / Gap Short** — hereda su mecánica de trade D→D+1
     (setup al cierre de D, ejecución en D+1) y su supuesto conservador
     intrabarra (si una barra toca stop y target, se asume stop primero).
  4. **Dilution engine (SEC EDGAR)** — veto de dilución para longs de baja
     capitalización (shelfs/ATMs activos = overhang que mata breakouts).

Pipeline por corrida:

  A. Califica las predicciones de corridas ANTERIORES contra los precios
     reales (SQLite local ``ultimate_predictor.db``) → track record honesto que
     además sesga levemente los pesos long/short (loop de aprendizaje).
  B. Contexto de mercado: SPY 5/20d, ETFs sectoriales hot/cold, régimen.
  C. Escaneo del universo al último cierre: setups LONG (breakout inminente
     del high de 10 días) y SHORT (sobre-extensión parabólica / fatiga).
  D. **Validación por backtest propio**: para cada candidato se re-ejecuta el
     MISMO setup sobre su propia historia (~1 año, barras diarias) con las
     mismas reglas de entrada/stop/target; si la acción "no se movió así en el
     pasado" (pocos eventos, expectancy ≤ 0, win rate pobre) se DESCARTA y se
     pasa al siguiente — hasta juntar 5 aprobados.
  E. Veto de dilución (EDGAR) para longs < $2B dentro de un presupuesto de
     tiempo; en shorts la dilución alta se anota como viento a favor.
  F. Publica el Top 5 para el **próximo día hábil** (si ya cerró el mercado,
     automáticamente es la sesión siguiente) y persiste cada pick como
     predicción "pending" para auto-calificarse en la próxima corrida.

Limitaciones documentadas (se muestran en la UI):
  - Universo point-in-time del screener → sesgo de supervivencia/look-ahead.
  - La validación usa barras diarias (no 1-min): asume stop primero si la
    barra toca stop y target — conservador pero no exacto.
  - No modela borrow/locate ni costos de financiación de shorts, ni feriados
    del calendario de mercado (el "próximo día hábil" salta solo fines de
    semana).

Expuesto vía POST /backtest/ultimate/start (job async), GET
/backtest/ultimate/status/{id} y GET /backtest/ultimate/history (track
record). El gráfico por pick reutiliza POST /backtest/edge-predictor/chart.

Screener estadístico + validación histórica — no es un pronóstico ni consejo
de inversión.
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

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ultimate_predictor.db")

# ── Mecánica del trade (D+1, barras diarias, conservador) ────────────────────
MAX_HOLD_DAYS = 5          # salida forzada al cierre del 5º día si no tocó nada
RR_TARGET = 2.0            # target fijo = entrada ± 2R
MAX_CHASE_PCT = 5.0        # si abre más de 5% pasado el nivel de entrada → sin fill
MIN_RISK_PCT = 1.0         # clamp del riesgo (stop) como % de la entrada
MAX_RISK_PCT = 12.0
STOP_BARS_LONG = 5         # stop long = low de las últimas 5 sesiones
STOP_BARS_SHORT = 2        # stop short = high de las últimas 2 sesiones

# ── Elegibilidad de setups al último cierre ──────────────────────────────────
LONG_NEAR_TRIGGER_PCT = 5.0    # cierre a ≤5% del high de 10 días
LONG_MIN_RET10 = -5.0          # no comprar cuchillos cayendo
SHORT_RET10_MIN = 30.0         # sobre-extensión: +30% en 10 días…
SHORT_CONSEC_GREEN_MIN = 4     # …o 4+ días verdes seguidos
MIN_DOLLAR_VOL = 300_000       # liquidez mínima (precio × vol promedio 20d)
MIN_ATR_PCT = 1.5              # sin rango no hay trade
MIN_SCORE = 45.0               # piso de score para entrar a validación
STALE_DAYS = 7                 # ticker "muerto" si su última barra es vieja
MIN_BARS = 90                  # historia mínima para escanear + validar

# ── Gates de la validación histórica (backtest propio del candidato) ─────────
VAL_MIN_EVENTS = 6         # setups históricos mínimos encontrados
VAL_MIN_FILLS = 5          # de esos, cuántos ejecutaron el D+1
VAL_MIN_EXPECTANCY = 0.05  # R promedio por trade ejecutado
VAL_MIN_WINRATE = 25.0     # % (con RR 2:1, 34% ya es rentable; 25 da margen)
VAL_EVENT_CAP = 40         # como mucho, los 40 setups más recientes

PRELIM_POOL = 60           # candidatos que entran a la fase de validación
TOP_N = 5                  # SIEMPRE se buscan 5 picks

# ── Veto de dilución (SEC EDGAR — lento, con presupuesto) ────────────────────
DILUTION_CAP_MAX = 2_000_000_000   # solo se chequean tickers < $2B
DILUTION_REJECT_SCORE = 70         # overallRisk ≥ 70 → veto para longs
DILUTION_TIME_BUDGET_S = 90.0
DILUTION_MAX_CHECKS = 8

# ── Pesos del score (por lado; suman 100) ────────────────────────────────────
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
#  Helpers de calendario y precios
# ═══════════════════════════════════════════════════════════════════════════
def _next_trading_day(date_str: str) -> str:
    """Próximo día hábil (salta sábados/domingos; feriados no modelados)."""
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def _px(x: float) -> float:
    return round(float(x), 4 if x < 1 else 2)


def _clamp_levels(side: str, entry: float, raw_stop: float) -> Tuple[float, float, float]:
    """Devuelve (stop, target, risk) con el riesgo acotado a [1%, 12%] de la
    entrada y el target fijo a RR_TARGET. El stop siempre queda del lado
    protector de la entrada."""
    if side == "long":
        stop = min(raw_stop, entry * (1 - MIN_RISK_PCT / 100))
        stop = max(stop, entry * (1 - MAX_RISK_PCT / 100))
        risk = entry - stop
        target = entry + RR_TARGET * risk
    else:
        stop = max(raw_stop, entry * (1 + MIN_RISK_PCT / 100))
        stop = min(stop, entry * (1 + MAX_RISK_PCT / 100))
        risk = stop - entry
        target = entry - RR_TARGET * risk
    return _px(stop), _px(target), risk


def _try_fill(side: str, level: float, o: float, h: float, lo: float) -> Optional[float]:
    """Fill del D+1 con orden stop en `level`. Si abre pasado el nivel, el fill
    es al open (peor precio); si abre demasiado pasado (>MAX_CHASE_PCT) no se
    persigue y no hay fill."""
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
    """Simula el trade desde la barra de fill (inclusive) con barras diarias.
    Conservador: si una barra toca stop y target, se asume stop primero.
    Devuelve (r_multiple, motivo, días_en_trade, precio_salida); r es None si
    todavía no hay barras suficientes para resolver (para el grading en vivo)."""
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
#  Engine
# ═══════════════════════════════════════════════════════════════════════════
class UltimatePredictorEngine:
    def __init__(self) -> None:
        self.version = "1.0"
        # comparte sesión FMP + caché de históricos con el Edge Finder
        self.finder: EdgeFinderEngine = get_edge_finder_engine()
        self._db_lock = threading.Lock()
        self._init_db()

    # ── SQLite local (memoria persistente del motor) ─────────────────────────
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

    # ── A. Grading de predicciones anteriores (loop de aprendizaje) ──────────
    def _grade_pending(self, as_of: str) -> int:
        """Evalúa contra precios reales las predicciones pending cuya sesión
        objetivo ya pasó. Devuelve cuántas quedaron calificadas."""
        with self._db_lock, closing(self._db()) as conn, conn:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE status='pending' AND for_date <= ? "
                "ORDER BY for_date ASC LIMIT 40", (as_of,),
            ).fetchall()
        graded = 0
        for row in rows:
            try:
                d_from = (datetime.strptime(row["for_date"], "%Y-%m-%d")
                          - timedelta(days=7)).strftime("%Y-%m-%d")
                hist = self.finder._daily_history(row["symbol"], d_from, as_of)
                dates, o, h, lo, c, _v = self.finder._parse_bars(hist)
                idx = next((i for i, dt in enumerate(dates) if dt >= row["for_date"]), None)
                if idx is None:
                    continue  # la sesión objetivo aún no tiene barra
                fill = _try_fill(row["side"], float(row["entry"]),
                                 float(o[idx]), float(h[idx]), float(lo[idx]))
                now = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
                if fill is None:
                    upd = ("graded", "no_fill", None, None, 0, now, row["id"])
                else:
                    r, reason, days, exit_px = _sim_trade(
                        row["side"], fill, float(row["stop"]), float(row["target"]),
                        h, lo, c, idx)
                    if r is None:
                        continue  # trade aún abierto — se califica en otra corrida
                    outcome = "win" if r > 0 else ("loss" if r < 0 else "flat")
                    upd = ("graded", f"{outcome}:{reason}", round(r, 3),
                           _px(exit_px), days, now, row["id"])
                with self._db_lock, closing(self._db()) as conn, conn:
                    conn.execute(
                        "UPDATE predictions SET status=?, outcome=?, outcome_r=?, "
                        "exit_price=?, days_held=?, evaluated_at=? WHERE id=?", upd)
                graded += 1
            except Exception as e:  # noqa: BLE001
                logger.debug("[Ultimate] grading %s failed: %s", row["symbol"], e)
        return graded

    def track_record(self) -> Dict[str, Any]:
        """KPIs del historial calificado + últimas predicciones (para la UI)."""
        with self._db_lock, closing(self._db()) as conn, conn:
            rows = conn.execute(
                "SELECT * FROM predictions WHERE status='graded' "
                "ORDER BY for_date DESC LIMIT 400").fetchall()
            recent = conn.execute(
                "SELECT for_date, symbol, side, entry, stop, target, score, status, "
                "outcome, outcome_r, exit_price, days_held FROM predictions "
                "ORDER BY id DESC LIMIT 30").fetchall()

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

        return {
            "overall": _stats(list(rows)),
            "long": _stats([r for r in rows if r["side"] == "long"]),
            "short": _stats([r for r in rows if r["side"] == "short"]),
            "recent": [dict(r) for r in recent],
        }

    @staticmethod
    def _side_bias(track: Dict[str, Any]) -> Dict[str, float]:
        """Sesgo de aprendizaje: si un lado viene rindiendo mal/bien en el track
        record real (n≥8 fills), su score se multiplica ×[0.85, 1.15]."""
        bias = {"long": 1.0, "short": 1.0}
        for side in ("long", "short"):
            st = track.get(side) or {}
            if (st.get("fills") or 0) >= 8 and st.get("avg_r") is not None:
                bias[side] = float(np.clip(1.0 + st["avg_r"] * 0.15, 0.85, 1.15))
        return bias

    # ── B. Contexto de mercado ────────────────────────────────────────────────
    def _market_context(self, date_from: str, date_to: str) -> Dict[str, Any]:
        etf_ret: Dict[str, float] = {}
        spy20 = spy5 = None
        as_of = None
        for etf in sorted(set(SECTOR_ETF.values())) + ["SPY"]:
            hist = self.finder._daily_history(etf, date_from, date_to)
            dates, _o, _h, _l, c, _v = self.finder._parse_bars(hist)
            if len(dates) < SECTOR_RET_WINDOW + 1:
                continue
            r20 = round((float(c[-1]) / float(c[-1 - SECTOR_RET_WINDOW]) - 1.0) * 100, 2)
            if etf == "SPY":
                spy20 = r20
                as_of = dates[-1]
                if len(c) >= 6 and float(c[-6]) > 0:
                    spy5 = round((float(c[-1]) / float(c[-6]) - 1.0) * 100, 2)
            else:
                etf_ret[etf] = r20
        regime = "neutral"
        if spy20 is not None:
            regime = "risk_on" if spy20 >= 2.0 else ("risk_off" if spy20 <= -2.0 else "neutral")
        ranked = sorted(etf_ret.items(), key=lambda kv: kv[1], reverse=True)
        return {
            "as_of": as_of,
            "spy_ret5_pct": spy5,
            "spy_ret20_pct": spy20,
            "regime": regime,
            "etf_ret20": etf_ret,
            "hot_sectors": [{"etf": k, "ret20_pct": v} for k, v in ranked[:3]],
            "cold_sectors": [{"etf": k, "ret20_pct": v} for k, v in ranked[-3:][::-1]],
        }

    # ── C. Escaneo por símbolo (features al último cierre + score por lado) ──
    def _scan_symbol(self, meta: Dict, cfg: Dict[str, Any], ctx: Dict[str, Any],
                     bias: Dict[str, float]) -> Optional[Dict]:
        symbol = meta["symbol"]
        hist = self.finder._daily_history(symbol, cfg["_hist_from"], cfg["_hist_to"])
        if len(hist) < MIN_BARS:
            return None
        dates, o, h, lo, c, v = self.finder._parse_bars(hist)
        n = len(dates)
        if n < MIN_BARS:
            return None
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

        # Features compartidas
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

        trigger = float(np.max(pre_h))                # high de 10 días (incluye hoy)
        prox = (price - trigger) / trigger * 100.0 if trigger > 0 else -99.0
        prior_trigger = float(np.max(h[-(PRE_BARS + 1):-1]))
        breaking = bool(n >= 2 and price > prior_trigger and c[-1] > c[-2])

        last_red = bool(c[-1] < o[-1])
        day_range = float(h[-1] - lo[-1])
        close_pos = (price - float(lo[-1])) / day_range if day_range > 0 else 0.5

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
            total = min(100.0, total * tilt * bias[side])
            return round(total, 1), parts

        candidates_here: List[Dict] = []

        # LONG: breakout inminente del high de 10 días
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
            stop, target, risk = _clamp_levels("long", entry, float(np.min(lo[-STOP_BARS_LONG:])))
            candidates_here.append({
                "side": "long", "score": score, "score_breakdown": parts,
                "entry": entry, "stop": stop, "target": target,
                "rr": RR_TARGET, "risk_pct": round(risk / entry * 100, 1),
                "status": "breaking" if breaking else "ready",
            })

        # SHORT: sobre-extensión parabólica / fatiga del movimiento
        short_ok = ret10 >= SHORT_RET10_MIN or consec_green >= SHORT_CONSEC_GREEN_MIN
        if short_ok:
            comps = {
                "overext": (min(1.0, max(0.0, (ret10 - SHORT_RET10_MIN) / 30.0 + 0.5))
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
            entry = _px(float(lo[-1]))                 # quiebre del low del último día
            stop, target, risk = _clamp_levels("short", entry, float(np.max(h[-STOP_BARS_SHORT:])))
            candidates_here.append({
                "side": "short", "score": score, "score_breakdown": parts,
                "entry": entry, "stop": stop, "target": target,
                "rr": RR_TARGET, "risk_pct": round(risk / entry * 100, 1),
                "status": "ready",
            })

        best = max(candidates_here, key=lambda x: x["score"], default=None)
        if best is None or best["score"] < MIN_SCORE:
            return None

        best.update({
            "symbol": symbol,
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
            "_arrays": (o, h, lo, c),
        })
        return best

    # ── D. Validación: backtest del MISMO setup sobre la historia propia ─────
    @staticmethod
    def _validate(cand: Dict) -> Dict[str, Any]:
        o, h, lo, c = cand["_arrays"]
        n = len(c)
        side = cand["side"]
        events = fills = wins = losses = 0
        rs: List[float] = []
        days_list: List[int] = []
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
            entry = _px(level)
            stop, target, _risk = _clamp_levels(side, entry, raw_stop)
            fill = _try_fill(side, entry, float(o[i + 1]), float(h[i + 1]), float(lo[i + 1]))
            if fill is not None:
                r, reason, days, _exit = _sim_trade(side, fill, stop, target, h, lo, c, i + 1)
                if r is not None:
                    fills += 1
                    rs.append(min(max(r, -3.0), 6.0))  # winsorize por robustez
                    days_list.append(days)
                    wins += 1 if r > 0 else 0
                    losses += 1 if r <= 0 else 0
                    i += 1 + days  # no solapar eventos: saltar al día de salida
                    continue
            i += 2  # setup sin fill: saltar un día para no contar el mismo nivel

        # cap: los VAL_EVENT_CAP más recientes ya están implícitos (1 año de barras)
        expectancy = round(float(np.mean(rs)), 3) if rs else None
        win_rate = round(100.0 * wins / len(rs), 1) if rs else None
        result = {
            "events": events,
            "fills": fills,
            "win_rate_pct": win_rate,
            "expectancy_r": expectancy,
            "total_r": round(float(np.sum(rs)), 2) if rs else None,
            "med_days_held": int(np.median(days_list)) if days_list else None,
            "passed": False,
            "reject_reason": None,
        }
        if events < VAL_MIN_EVENTS:
            result["reject_reason"] = f"solo {events} setups históricos (mín {VAL_MIN_EVENTS})"
        elif fills < VAL_MIN_FILLS:
            result["reject_reason"] = f"solo {fills} ejecuciones históricas (mín {VAL_MIN_FILLS})"
        elif expectancy is None or expectancy < VAL_MIN_EXPECTANCY:
            result["reject_reason"] = (f"expectancy {expectancy}R < {VAL_MIN_EXPECTANCY}R — "
                                       "la acción no se movió así en el pasado")
        elif win_rate is not None and win_rate < VAL_MIN_WINRATE:
            result["reject_reason"] = f"win rate {win_rate}% < {VAL_MIN_WINRATE}%"
        else:
            result["passed"] = True
        return result

    # ── E. Veto de dilución (EDGAR) ───────────────────────────────────────────
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

    # ── Rationale en español (resumen humano del porqué) ─────────────────────
    @staticmethod
    def _rationale(cand: Dict, val: Dict) -> str:
        side_txt = "LONG sobre el quiebre del high de 10 días" if cand["side"] == "long" \
            else "SHORT sobre el quiebre del low del último día (sobre-extensión)"
        top = sorted(cand["score_breakdown"], key=lambda p: p["points"] / max(p["max"], 1e-9),
                     reverse=True)[:2]
        drivers = "; ".join(p["detail"] for p in top)
        return (f"{side_txt}. {drivers}. Validación histórica: {val['fills']} trades "
                f"del mismo setup en ~1 año, win rate {val['win_rate_pct']}%, "
                f"expectancy {val['expectancy_r']}R por trade.")

    # ── F. Orquestación ───────────────────────────────────────────────────────
    def run_predict(self, cfg: Dict[str, Any], progress) -> Dict[str, Any]:
        t0 = time.time()
        warnings: List[str] = [
            "Universo point-in-time del screener → sesgo de supervivencia/look-ahead.",
            "Validación con barras diarias: si una barra toca stop y target se asume "
            "stop primero (conservador). No modela borrow/locate ni slippage.",
            "El «próximo día hábil» salta fines de semana pero no feriados de mercado.",
        ]
        today = datetime.utcnow()
        cfg["_hist_from"] = (today - timedelta(days=420)).strftime("%Y-%m-%d")
        cfg["_hist_to"] = today.strftime("%Y-%m-%d")

        progress(2, "Contexto de mercado (SPY + ETFs sectoriales)")
        ctx = self._market_context(cfg["_hist_from"], cfg["_hist_to"])
        if ctx["as_of"] is None:
            ctx["as_of"] = today.strftime("%Y-%m-%d")
            warnings.append("No se pudo leer SPY; la fecha de corte es la de hoy (UTC).")
        for_date = _next_trading_day(ctx["as_of"])

        progress(4, "Calificando predicciones de corridas anteriores")
        try:
            graded_now = self._grade_pending(ctx["as_of"])
        except Exception as e:  # noqa: BLE001
            graded_now = 0
            warnings.append(f"No se pudo calificar el historial previo: {e}")
        track = self.track_record()
        bias = self._side_bias(track)
        if bias["long"] != 1.0 or bias["short"] != 1.0:
            warnings.append(
                f"Aprendizaje del track record aplicado: sesgo long ×{round(bias['long'], 2)}, "
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

        progress(10, f"Escaneando {len(universe)} tickers al último cierre ({ctx['as_of']})")
        prelim: List[Dict] = []
        done = 0
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {pool.submit(self._scan_symbol, m, cfg, ctx, bias): m["symbol"]
                    for m in universe}
            for fut in as_completed(futs):
                done += 1
                try:
                    cand = fut.result()
                    if cand is not None:
                        prelim.append(cand)
                except Exception as e:  # noqa: BLE001
                    logger.debug("[Ultimate] scan %s: %s", futs[fut], e)
                if done % 25 == 0 or done == len(universe):
                    pct = 10 + int(50 * done / max(len(universe), 1))
                    progress(pct, f"Escaneando {done}/{len(universe)} — {len(prelim)} setups")

        prelim.sort(key=lambda x: x["score"], reverse=True)
        pool_cands = prelim[:PRELIM_POOL]
        n_long = sum(1 for x in prelim if x["side"] == "long")
        n_short = len(prelim) - n_long

        progress(62, f"Validando candidatos con backtest propio ({len(pool_cands)} en cola)")
        picks: List[Dict] = []
        rejected: List[Dict] = []
        dilution_budget = DILUTION_TIME_BUDGET_S
        dilution_checks = 0
        for k, cand in enumerate(pool_cands):
            if len(picks) >= TOP_N:
                break
            progress(62 + int(28 * k / max(len(pool_cands), 1)),
                     f"Validando {cand['symbol']} ({cand['side'].upper()}) — "
                     f"{len(picks)}/{TOP_N} aprobados")
            val = self._validate(cand)
            if not val["passed"]:
                rejected.append({"symbol": cand["symbol"], "side": cand["side"],
                                 "score": cand["score"], "stage": "backtest",
                                 "reason": val["reject_reason"]})
                continue

            # Veto de dilución: longs de baja capitalización con presupuesto
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
                                     "score": cand["score"], "stage": "dilution",
                                     "reason": f"riesgo de dilución {dilution['score']}/100 "
                                               f"({dilution.get('label')}) — overhang EDGAR"})
                    continue

            cand["validation"] = val
            cand["dilution"] = dilution
            if cand["side"] == "short" and dilution and (dilution.get("score") or 0) >= 60:
                cand["dilution_note"] = "dilución alta — viento a favor del short"
            cand["rationale"] = self._rationale(cand, val)
            cand["exp_hold_days"] = val["med_days_held"] or MAX_HOLD_DAYS
            picks.append(cand)

        if len(picks) < TOP_N:
            warnings.append(
                f"Solo {len(picks)} de {TOP_N} candidatos superaron la validación con estos "
                "filtros — amplía el rango de precio/market cap o espera otro contexto."
            )

        # ranking final: expectancy validada × score
        picks.sort(key=lambda x: (x["validation"]["expectancy_r"] or 0) * x["score"],
                   reverse=True)
        for cand in picks:
            cand.pop("_arrays", None)
        for cand in pool_cands:
            cand.pop("_arrays", None)
        for cand in prelim:
            cand.pop("_arrays", None)

        # ── Persistencia (memoria local + predicciones para auto-calificar) ──
        run_id = uuid.uuid4().hex[:12]
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
                    conn.execute(
                        "INSERT INTO predictions (run_id, created_at, for_date, symbol, "
                        "side, entry, stop, target, score, expectancy_r) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (run_id, now_str, for_date, cand["symbol"], cand["side"],
                         cand["entry"], cand["stop"], cand["target"], cand["score"],
                         cand["validation"]["expectancy_r"]))
        except Exception as e:  # noqa: BLE001
            warnings.append(f"No se pudo persistir la corrida en la base local: {e}")

        kpis = {
            "universe": len(universe),
            "setups_long": n_long,
            "setups_short": n_short,
            "validated": len(picks),
            "rejected_backtest": sum(1 for r in rejected if r["stage"] == "backtest"),
            "rejected_dilution": sum(1 for r in rejected if r["stage"] == "dilution"),
            "graded_this_run": graded_now,
            "avg_expectancy_r": (round(float(np.mean(
                [p["validation"]["expectancy_r"] for p in picks
                 if p["validation"]["expectancy_r"] is not None])), 3) if picks else None),
            "avg_score": (round(float(np.mean([p["score"] for p in picks])), 1)
                          if picks else None),
        }
        meta = {
            "run_id": run_id,
            "as_of": ctx["as_of"],
            "for_date": for_date,
            "universe_full": full_universe,
            "params": {k: v for k, v in cfg.items() if not k.startswith("_")},
            "runtime_s": round(time.time() - t0, 1),
            "warnings": warnings,
        }
        progress(100, "Listo")
        return {"kpis": kpis, "market": ctx, "picks": picks, "rejected": rejected[:20],
                "track_record": track, "meta": meta}


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
    """Track record + últimas corridas (para GET /backtest/ultimate/history)."""
    engine = get_ultimate_predictor_engine()
    track = engine.track_record()
    with engine._db_lock, closing(engine._db()) as conn, conn:
        runs = conn.execute(
            "SELECT * FROM runs ORDER BY created_at DESC LIMIT 12").fetchall()
    return {"track_record": track, "runs": [dict(r) for r in runs]}


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
