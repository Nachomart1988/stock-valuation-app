"""
Edge Predictor Engine (breakout candidates)
===========================================

Companion engine of ``edge_finder_engine.py``. The Edge Finder looks BACKWARD:
it scans every historical surge in a universe and aggregates the pattern that
preceded it (pattern mix, volume ratio, distance to the 52-week low, sector
hot/cold, red streaks...). This engine looks FORWARD: it re-scans the SAME
universe **as of the last close** and ranks the tickers whose *current* setup
most resembles that historical pre-surge profile — i.e. candidates that look
"about to break out".

Interconnection with the Edge Finder:
  - Reuses its universe builder, daily-history fetcher (shared cache/session),
    pre-surge pattern classifier and red/green streak logic by importing the
    ``EdgeFinderEngine`` singleton.
  - Receives the finished Edge Finder result (kpis + by_pattern +
    vol/dist buckets) as a ``profile`` and converts the historical frequencies
    into scoring weights: a candidate scores high when its current pattern /
    volume bucket / 52w-distance bucket / sector-hot state / red-streak state
    were FREQUENT among the historical surges, and when its price sits close
    to the breakout trigger (the high of the last 10 sessions).

Per candidate the engine also emits a trade plan derived from the profile:
entry = trigger (buy stop over the 10-day high), stop = 5-day low, target =
entry x (1 + median historical surge), R:R and expected days to peak.

Exposed via POST /backtest/edge-predictor/start (async job), GET
/backtest/edge-predictor/status/{id} and POST /backtest/edge-predictor/chart
(lazy daily chart for one candidate). GOD MODE only (gated in the frontend).

This is a statistical screener based on historical frequencies — not a
forecast model and not investment advice; the same survivorship / look-ahead
caveats of the Edge Finder universe apply.
"""

from __future__ import annotations

import time
import uuid
import logging
import threading
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
    LOOKBACK_52W,
)

logger = logging.getLogger(__name__)

# Bucket ranges — MUST mirror the Edge Finder aggregation buckets (labels are
# the lookup key against the profile distributions).
VOL_BUCKETS: List[Tuple[str, float, float]] = [
    ("Seco (<0.5×)", 0, 0.5), ("Bajo (0.5–1×)", 0.5, 1.0),
    ("Normal (1–1.5×)", 1.0, 1.5), ("Elevado (1.5–3×)", 1.5, 3.0),
    ("Explosivo (>3×)", 3.0, 1e9),
]
DIST_BUCKETS: List[Tuple[str, float, float]] = [
    ("<25%", -1e9, 25), ("25–50%", 25, 50), ("50–100%", 50, 100),
    ("100–300%", 100, 300), (">300%", 300, 1e12),
]

READY_ZONE_PCT = 3.0   # close within −3% of the trigger => "en zona de disparo"
STALE_DAYS = 7         # skip tickers whose last bar is older than this vs as-of
STOP_BARS = 5          # stop = low of the last 5 sessions

# Score weights (sum = 90, normalized to 0–100)
W_TRIGGER = 25.0
W_PATTERN = 20.0
W_VOLUME = 15.0
W_DIST52W = 10.0
W_SECTOR = 10.0
W_STREAK = 10.0
W_TOTAL = W_TRIGGER + W_PATTERN + W_VOLUME + W_DIST52W + W_SECTOR + W_STREAK


# ═══════════════════════════════════════════════════════════════════════════
#  Job registry (in-process; own registry, separate from the other engines)
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
#  Profile normalization (Edge Finder result -> scoring lookups)
# ═══════════════════════════════════════════════════════════════════════════
def _shares(rows: Optional[List[Dict]], key: str) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for r in rows or []:
        label = r.get(key)
        if label and label != "s/d" and r.get("pct") is not None:
            try:
                out[str(label)] = float(r["pct"])
            except (TypeError, ValueError):
                continue
    return out


def _normalize_profile(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    raw = raw or {}
    kpis = raw.get("kpis") or {}

    def num(field: str) -> Optional[float]:
        v = kpis.get(field)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    pattern_rows: Dict[str, Dict] = {}
    for r in raw.get("by_pattern") or []:
        if r.get("pattern"):
            pattern_rows[str(r["pattern"])] = r

    return {
        "events": int(num("events") or 0),
        "median_surge_pct": num("median_surge_pct"),
        "median_days_to_peak": num("median_days_to_peak"),
        "pct_hot_sector": num("pct_hot_sector"),
        "pct_after_red_streak": num("pct_after_red_streak"),
        "median_ret_10d": num("median_ret_10d"),
        "pattern_shares": _shares(raw.get("by_pattern"), "pattern"),
        "pattern_rows": pattern_rows,
        "vol_shares": _shares(raw.get("vol_ratio_buckets"), "bucket"),
        "dist_shares": _shares(raw.get("dist_52w_buckets"), "bucket"),
    }


def _bucket_label(value: Optional[float],
                  buckets: List[Tuple[str, float, float]]) -> Optional[str]:
    if value is None:
        return None
    for label, lo, hi in buckets:
        if lo <= value < hi:
            return label
    return None


def _share_score(label: Optional[str], shares: Dict[str, float]) -> Tuple[float, str]:
    """Score 0..1 = historical share of the candidate's bucket vs the top bucket."""
    if label is None:
        return 0.5, "sin datos — peso neutro"
    if not shares:
        return 0.5, "sin perfil histórico — peso neutro"
    mx = max(shares.values())
    pct = shares.get(label, 0.0)
    if mx <= 0:
        return 0.5, "sin perfil histórico — peso neutro"
    return pct / mx, f"{pct}% de los surges históricos cayó en «{label}»"


def _binary_score(match: bool, hist_pct: Optional[float],
                  yes_txt: str, no_txt: str) -> Tuple[float, str]:
    """Score 0..1 for a yes/no dimension against its historical frequency."""
    if hist_pct is None:
        return 0.5, "sin perfil histórico — peso neutro"
    share = hist_pct if match else 100.0 - hist_pct
    mx = max(hist_pct, 100.0 - hist_pct)
    txt = yes_txt if match else no_txt
    return (share / mx if mx > 0 else 0.5), f"{txt} — {round(share, 1)}% de los surges históricos"


# ═══════════════════════════════════════════════════════════════════════════
#  Engine
# ═══════════════════════════════════════════════════════════════════════════
class EdgePredictorEngine:
    def __init__(self) -> None:
        self.version = "1.0"
        # shared with the Edge Finder: session, daily-history cache, helpers
        self.finder: EdgeFinderEngine = get_edge_finder_engine()

    # ── Current sector context: ETF 20d return vs SPY ending the last close ──
    def _sector_context_now(self, date_from: str, date_to: str
                            ) -> Tuple[Optional[str], Optional[float], Dict[str, float]]:
        """Returns (as_of_date, spy_ret20, {etf: ret20})."""
        etf_ret: Dict[str, float] = {}
        spy_ret: Optional[float] = None
        as_of: Optional[str] = None
        for etf in sorted(set(SECTOR_ETF.values())) + ["SPY"]:
            hist = self.finder._daily_history(etf, date_from, date_to)
            dates, _o, _h, _l, c, _v = self.finder._parse_bars(hist)
            if len(dates) < SECTOR_RET_WINDOW + 1:
                continue
            a, b = float(c[-1 - SECTOR_RET_WINDOW]), float(c[-1])
            if a <= 0:
                continue
            ret = round((b / a - 1.0) * 100, 2)
            if etf == "SPY":
                spy_ret = ret
                as_of = dates[-1]
            else:
                etf_ret[etf] = ret
        return as_of, spy_ret, etf_ret

    # ── Per-symbol candidate build (features as of the LAST close) ───────────
    def _scan_symbol(self, meta: Dict, cfg: Dict[str, Any], as_of: str,
                     spy_ret: Optional[float], etf_ret: Dict[str, float],
                     prof: Dict[str, Any]) -> Optional[Dict]:
        symbol = meta["symbol"]
        hist = self.finder._daily_history(symbol, cfg["_hist_from"], cfg["_hist_to"])
        if len(hist) < PRE_BARS + VOL_AVG_WINDOW + 5:
            return None
        dates, o, h, l, c, v = self.finder._parse_bars(hist)
        n = len(dates)
        if n < PRE_BARS + VOL_AVG_WINDOW + 5:
            return None

        # skip stale/halted tickers (last bar too old vs the market as-of date)
        try:
            gap_days = (datetime.strptime(as_of, "%Y-%m-%d")
                        - datetime.strptime(dates[-1], "%Y-%m-%d")).days
        except ValueError:
            gap_days = 0
        if gap_days > STALE_DAYS:
            return None

        base = float(c[-1])  # last close = the hypothetical "base" (D-1 of a future surge)
        if base <= 0 or not (cfg["price_min"] <= base <= cfg["price_max"]):
            return None

        # Mirror of the Edge Finder features anchored at D-1 (tomorrow = D0):
        pre_c, pre_h, pre_l = c[-PRE_BARS:], h[-PRE_BARS:], l[-PRE_BARS:]
        pattern, pre_ret10, compression, avg_tr = \
            EdgeFinderEngine._classify_pattern(pre_c, pre_h, pre_l)
        consec_red, consec_green = EdgeFinderEngine._consecutive(c[-(PRE_BARS + 1):])

        trigger = float(np.max(pre_h))              # high of the last 10 sessions
        prior_trigger = float(np.max(h[-(PRE_BARS + 1):-1]))  # 10d high as of yesterday
        if trigger <= 0:
            return None
        proximity = (base - trigger) / trigger * 100.0  # always <= 0 (close <= high)
        if proximity < -cfg["near_trigger_pct"]:
            return None

        # already fired today? (closed green above yesterday's 10-day high)
        breaking = bool(n >= 2 and base > prior_trigger and c[-1] > c[-2])
        status = "breaking" if breaking else ("ready" if proximity >= -READY_ZONE_PCT else "building")

        vol_prev = float(v[-1])
        va = v[-1 - VOL_AVG_WINDOW:-1]
        vol_avg20 = float(np.mean(va)) if va.size >= 5 else None
        vol_ratio = round(vol_prev / vol_avg20, 2) if vol_avg20 else None

        lb_l, lb_h = l[-LOOKBACK_52W:], h[-LOOKBACK_52W:]
        if lb_l.size >= 120 and float(np.min(lb_l)) > 0:
            low52, high52 = float(np.min(lb_l)), float(np.max(lb_h))
            dist_low = round((base - low52) / low52 * 100, 1)
            dist_high = round((base - high52) / high52 * 100, 1) if high52 > 0 else None
        else:
            dist_low = dist_high = None

        d1_chg = round((base / float(c[-2]) - 1.0) * 100, 2) if n >= 2 and float(c[-2]) > 0 else None

        etf = SECTOR_ETF.get(meta["sector"])
        sec_ret = etf_ret.get(etf) if etf else None
        hot_now = bool(sec_ret > spy_ret) if (sec_ret is not None and spy_ret is not None) else None

        # ── Score vs the historical profile ──────────────────────────────────
        parts: List[Dict[str, Any]] = []

        if breaking:
            s01, detail = 1.0, "cerró hoy sobre el high de 10 días — breakout en curso"
        else:
            s01 = max(0.0, 1.0 - abs(proximity) / cfg["near_trigger_pct"])
            detail = f"cierre a {round(proximity, 1)}% del nivel de disparo (high 10d)"
        parts.append({"key": "trigger", "label": "Proximidad al disparo",
                      "max": W_TRIGGER, "points": round(W_TRIGGER * s01, 1), "detail": detail})

        s01, detail = _share_score(pattern, prof["pattern_shares"])
        parts.append({"key": "pattern", "label": "Patrón previo",
                      "max": W_PATTERN, "points": round(W_PATTERN * s01, 1), "detail": detail})

        s01, detail = _share_score(_bucket_label(vol_ratio, VOL_BUCKETS), prof["vol_shares"])
        parts.append({"key": "volume", "label": "Volumen del último día",
                      "max": W_VOLUME, "points": round(W_VOLUME * s01, 1), "detail": detail})

        s01, detail = _share_score(_bucket_label(dist_low, DIST_BUCKETS), prof["dist_shares"])
        parts.append({"key": "dist52w", "label": "Distancia al mín 52 sem",
                      "max": W_DIST52W, "points": round(W_DIST52W * s01, 1), "detail": detail})

        if hot_now is None:
            s01, detail = 0.5, "sin ETF sectorial — peso neutro"
        else:
            s01, detail = _binary_score(hot_now, prof["pct_hot_sector"],
                                        "sector HOT ahora", "sector COLD ahora")
        parts.append({"key": "sector", "label": "Sector HOT",
                      "max": W_SECTOR, "points": round(W_SECTOR * s01, 1), "detail": detail})

        s01, detail = _binary_score(consec_red >= 3, prof["pct_after_red_streak"],
                                    "viene de 3+ días rojos", "sin racha roja previa")
        parts.append({"key": "streak", "label": "Racha roja previa",
                      "max": W_STREAK, "points": round(W_STREAK * s01, 1), "detail": detail})

        score = round(sum(p["points"] for p in parts) * 100.0 / W_TOTAL, 1)

        # ── Trade plan from the profile ───────────────────────────────────────
        def px(x: float) -> float:
            return round(float(x), 4 if x < 1 else 2)

        entry = px(trigger)
        stop = px(float(np.min(l[-STOP_BARS:])))
        exp_move = prof["median_surge_pct"] if prof["median_surge_pct"] is not None \
            else float(cfg["surge_pct_min"])
        target = px(trigger * (1.0 + exp_move / 100.0))
        risk = entry - stop
        rr = round((target - entry) / risk, 2) if risk > 0 else None
        risk_pct = round(risk / entry * 100, 1) if entry > 0 and risk > 0 else None

        hist_row = prof["pattern_rows"].get(pattern) or {}

        return {
            "symbol": symbol,
            "sector": meta["sector"],
            "industry": meta["industry"],
            "exchange": meta["exchange"],
            "market_cap": meta["market_cap"],
            "as_of": dates[-1],
            "price": px(base),
            "d1_chg_pct": d1_chg,
            "trigger": px(trigger),
            "proximity_pct": round(proximity, 2),
            "status": status,
            "pattern": pattern,
            "pre_ret10_pct": pre_ret10,
            "compression": compression,
            "pre_tr_pct": avg_tr,
            "consec_red": consec_red,
            "consec_green": consec_green,
            "vol_prev": vol_prev,
            "vol_avg20": round(vol_avg20) if vol_avg20 else None,
            "vol_ratio": vol_ratio,
            "dist_52w_low_pct": dist_low,
            "dist_52w_high_pct": dist_high,
            "sector_etf": etf,
            "sector_ret20_pct": sec_ret,
            "spy_ret20_pct": spy_ret,
            "sector_hot_now": hot_now,
            "entry": entry,
            "stop": stop,
            "target": target,
            "rr": rr,
            "risk_pct": risk_pct,
            "exp_move_pct": round(float(exp_move), 1),
            "exp_days_to_peak": prof["median_days_to_peak"],
            "hist_pattern_count": hist_row.get("count"),
            "hist_pattern_med_surge": hist_row.get("med_surge"),
            "hist_pattern_med_ret10": hist_row.get("med_ret_10d"),
            "score": score,
            "score_breakdown": parts,
        }

    # ── Daily chart for one candidate (lazy-loaded by the frontend) ──────────
    def candidate_chart(self, symbol: str, bars: int = 60) -> List[Dict]:
        bars = int(min(max(bars, 20), 150))
        date_to = datetime.utcnow().strftime("%Y-%m-%d")
        date_from = (datetime.utcnow() - timedelta(days=int(bars * 2.2) + 30)).strftime("%Y-%m-%d")
        hist = self.finder._daily_history(symbol, date_from, date_to)
        dates, o, h, l, c, v = self.finder._parse_bars(hist)
        n = len(dates)
        if n == 0:
            return []
        lo_i = max(0, n - bars)
        out: List[Dict] = []
        for j in range(lo_i, n):
            out.append({
                "t": dates[j][5:],          # MM-DD label
                "day": dates[j],
                "open": float(o[j]), "high": float(h[j]),
                "low": float(l[j]), "close": float(c[j]),
                "volume": float(v[j]),
            })
        return out

    # ── Orchestration ────────────────────────────────────────────────────────
    def run_predict(self, cfg: Dict[str, Any], profile_raw: Optional[Dict[str, Any]],
                    progress) -> Dict[str, Any]:
        prof = _normalize_profile(profile_raw)
        warnings: List[str] = [
            "Market cap y sector son point-in-time (actuales) del screener → mismo sesgo "
            "de supervivencia/look-ahead que el Edge Finder.",
            "Si el mercado está abierto, la última vela puede estar incompleta; el análisis "
            "usa datos hasta el último cierre disponible.",
        ]
        if prof["events"] <= 0:
            warnings.append(
                "No se recibió el perfil histórico del Edge Finder — se usaron pesos "
                "neutros (el score queda dominado por la proximidad al disparo)."
            )

        today = datetime.utcnow()
        cfg["_hist_from"] = (today - timedelta(days=420)).strftime("%Y-%m-%d")
        cfg["_hist_to"] = today.strftime("%Y-%m-%d")

        progress(3, "Construyendo universo (mismos filtros del Edge Finder)")
        universe = self.finder._build_universe(cfg)
        if not universe:
            raise RuntimeError("No se obtuvieron tickers del screener (revisa filtros / API key)")
        full_universe = len(universe)
        cap = int(cfg["max_universe"])
        if full_universe > cap:
            warnings.append(
                f"Universo completo: {full_universe} tickers; limitado por seguridad a {cap}."
            )
            universe = universe[:cap]

        progress(6, "Contexto sectorial actual (ETFs vs SPY)")
        as_of, spy_ret, etf_ret = self._sector_context_now(cfg["_hist_from"], cfg["_hist_to"])
        if as_of is None:
            as_of = today.strftime("%Y-%m-%d")
            warnings.append("No se pudo leer SPY para fijar la fecha de corte; se usó la fecha de hoy.")

        progress(8, f"Universo: {len(universe)}/{full_universe} tickers — analizando el estado actual")
        candidates: List[Dict] = []
        done = 0
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {pool.submit(self._scan_symbol, m, cfg, as_of, spy_ret, etf_ret, prof):
                    m["symbol"] for m in universe}
            for fut in as_completed(futs):
                done += 1
                try:
                    cand = fut.result()
                    if cand is not None:
                        candidates.append(cand)
                except Exception as e:  # noqa: BLE001
                    logger.debug("[EdgePredictor] scan error %s: %s", futs[fut], e)
                if done % 25 == 0 or done == len(universe):
                    pct = 8 + int(84 * done / max(len(universe), 1))
                    progress(pct, f"Escaneando {done}/{len(universe)} — {len(candidates)} candidatos")

        progress(94, "Puntuando y rankeando candidatos")
        candidates.sort(key=lambda x: (x["score"], x["proximity_pct"]), reverse=True)
        total = len(candidates)
        top = candidates[:int(cfg["top_n"])]

        def med(vals: List[Optional[float]]) -> Optional[float]:
            xs = [x for x in vals if x is not None]
            return round(float(np.median(xs)), 2) if xs else None

        hot_known = [x for x in candidates if x["sector_hot_now"] is not None]
        pattern_counts: Dict[str, int] = {}
        for x in candidates:
            pattern_counts[x["pattern"]] = pattern_counts.get(x["pattern"], 0) + 1
        top_pattern = max(pattern_counts.items(), key=lambda kv: kv[1]) if pattern_counts else None

        kpis = {
            "candidates_total": total,
            "shown": len(top),
            "breaking": sum(1 for x in candidates if x["status"] == "breaking"),
            "ready": sum(1 for x in candidates if x["status"] == "ready"),
            "building": sum(1 for x in candidates if x["status"] == "building"),
            "median_score": med([x["score"] for x in candidates]),
            "pct_sector_hot_now": (round(100.0 * sum(1 for x in hot_known if x["sector_hot_now"])
                                         / len(hot_known), 1) if hot_known else None),
            "median_rr": med([x["rr"] for x in candidates]),
            "exp_move_pct": prof["median_surge_pct"],
            "exp_days_to_peak": prof["median_days_to_peak"],
            "top_pattern": top_pattern[0] if top_pattern else None,
            "top_pattern_count": top_pattern[1] if top_pattern else None,
        }

        meta = {
            "as_of": as_of,
            "universe_size": len(universe),
            "universe_full": full_universe,
            "profile_events": prof["events"],
            "params": {k: v for k, v in cfg.items() if not k.startswith("_")},
            "warnings": warnings,
        }

        progress(100, "Listo")
        return {"kpis": kpis, "candidates": top, "meta": meta}


# ═══════════════════════════════════════════════════════════════════════════
#  Config normalization + public job API
# ═══════════════════════════════════════════════════════════════════════════
def _normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    def f(key: str, default: float) -> float:
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    cap_min = str(raw.get("market_cap_min", "small")).lower()
    cap_max = str(raw.get("market_cap_max", "large")).lower()
    if cap_min not in MARKET_CAP_BUCKETS:
        cap_min = "nano"
    if cap_max not in MARKET_CAP_BUCKETS:
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
        "surge_pct_min": max(f("surge_pct_min", 50.0), 1.0),
        "surge_days": int(min(max(f("surge_days", 3), 1), 100)),
        "max_universe": int(max(f("max_universe", 5000), 1)),
        "top_n": int(min(max(f("top_n", 40), 5), 200)),
        "near_trigger_pct": min(max(f("near_trigger_pct", 10.0), 1.0), 50.0),
    }


_ENGINE: Optional[EdgePredictorEngine] = None


def get_edge_predictor_engine() -> EdgePredictorEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = EdgePredictorEngine()
    return _ENGINE


def start_job(raw_config: Dict[str, Any]) -> str:
    """Create a job, launch the prediction scan on a background thread, return job_id."""
    _prune_jobs()
    profile = raw_config.get("profile") if isinstance(raw_config, dict) else None
    cfg = _normalize_config(raw_config or {})
    job_id = uuid.uuid4().hex[:16]
    _set_job(job_id, status="queued", progress=0, stage="En cola",
             result=None, error=None, created_at=time.time())

    def _run() -> None:
        def progress(pct: int, stage: str) -> None:
            _set_job(job_id, status="running", progress=int(pct), stage=stage)
        try:
            engine = get_edge_predictor_engine()
            result = engine.run_predict(cfg, profile, progress)
            _set_job(job_id, status="done", progress=100, stage="Listo", result=result)
        except Exception as e:  # noqa: BLE001
            logger.exception("[EdgePredictor] job %s failed", job_id)
            _set_job(job_id, status="error", error=str(e), stage="Error")

    threading.Thread(target=_run, daemon=True).start()
    return job_id
