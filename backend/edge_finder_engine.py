"""
Edge Finder Engine (Surge Scanner)
==================================

Not a classic entry/exit backtest: an **edge-discovery scanner**. The user defines a
*surge* (e.g. +50% or more within 3 trading days) plus universe filters (price range,
market-cap range, date window), and the engine finds every historical surge event and
characterizes the **pattern that preceded it**:

  - the 10 daily bars BEFORE the surge start and the 10 bars AFTER it (per-event chart
    + a normalized composite path across all events),
  - volume on the day before the surge (absolute + ratio vs the 20-day average),
  - sector / industry and whether the sector was HOT or COLD (sector ETF 20-day return
    vs SPY into the surge),
  - distance from the 52-week low (and high) at the surge start,
  - a heuristic pre-surge pattern label (capitulation, pullback, flat base, range
    compression, prior momentum, choppy), consecutive red/green days, gap on day 0,
  - post-surge continuation (+3/+5/+10 day returns from the base close).

Aggregations (pattern mix, sector mix, 52w-low / volume-ratio / gap buckets, weekday,
composite average path) are what the user reads to find an edge.

Exposed via POST /backtest/edge-finder/start (async job), GET /backtest/edge-finder/
status/{id} and POST /backtest/edge-finder/chart (lazy per-event daily chart).
GOD MODE only (gated in the frontend /backtest page). Mirrors the job system of
``gap_short_backtest_engine.py`` but is fully self-contained.

Documented limitations (surfaced in the UI):
  - Market cap / sector come from the CURRENT company screener -> survivorship and
    look-ahead bias in universe selection (delisted tickers are absent).
  - The screener price filter uses today's price; the historical price filter is then
    re-applied per event on the base close (day before the surge).
  - The `earnings` filter is a reserved placeholder (accepted but ignored for now).
"""

from __future__ import annotations

import os
import time
import uuid
import logging
import threading
from bisect import bisect_right
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple, Callable

import numpy as np
import requests

logger = logging.getLogger(__name__)

# ── Market cap buckets (USD), ordered — the filter is a RANGE between two buckets ──
CAP_ORDER = ["nano", "micro", "small", "mid", "large", "mega"]
MARKET_CAP_BUCKETS: Dict[str, Tuple[float, float]] = {
    "nano":  (0,               50_000_000),
    "micro": (50_000_000,      300_000_000),
    "small": (300_000_000,     2_000_000_000),
    "mid":   (2_000_000_000,   10_000_000_000),
    "large": (10_000_000_000,  200_000_000_000),
    "mega":  (200_000_000_000, 100_000_000_000_000),
}

WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

PRE_BARS = 10    # daily bars shown/analyzed before the surge start
POST_BARS = 10   # daily bars after the surge start
LOOKBACK_52W = 252
VOL_AVG_WINDOW = 20

# Sector -> SPDR sector ETF used for the hot/cold context (20d return vs SPY)
SECTOR_ETF: Dict[str, str] = {
    "Technology": "XLK",
    "Healthcare": "XLV",
    "Financial Services": "XLF",
    "Financial": "XLF",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Energy": "XLE",
    "Industrials": "XLI",
    "Basic Materials": "XLB",
    "Real Estate": "XLRE",
    "Utilities": "XLU",
    "Communication Services": "XLC",
}
SECTOR_RET_WINDOW = 20  # trading days for the hot/cold sector return

# Pre-surge pattern labels (heuristic, over the 10 bars before the surge start)
PAT_CAPITULATION = "Capitulación (caída fuerte)"
PAT_PULLBACK = "Pullback bajista"
PAT_MOMENTUM = "Momentum previo (ya corría)"
PAT_UPTREND = "Tendencia alcista suave"
PAT_COIL = "Compresión de rango (coil)"
PAT_FLAT = "Base plana"
PAT_CHOPPY = "Lateral / choppy"

# Breakout types — "patrón previo 2": what kind of breakout launched the surge.
# Classified against the prior 10-day high / 52-week high / flag structure.
BK_FLAG = "Flag breakout"
BK_52W = "Breakout 52 semanas"
BK_GAP = "Gap breakout"
BK_BASE = "Breakout de base"
BK_CONTINUATION = "Breakout de continuación"
BK_REVERSAL_RECLAIM = "Reversión con reclaim"
BK_BOUNCE = "Rebote sin breakout"
BK_RANGE = "Dentro del rango"
BREAKOUT_ORDER = [BK_FLAG, BK_52W, BK_GAP, BK_BASE, BK_CONTINUATION,
                  BK_REVERSAL_RECLAIM, BK_BOUNCE, BK_RANGE]


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
#  Engine
# ═══════════════════════════════════════════════════════════════════════════
class EdgeFinderEngine:
    FMP_BASE = "https://financialmodelingprep.com/stable"

    def __init__(self, api_key: Optional[str] = None) -> None:
        self.version = "1.0"
        self.api_key = api_key or os.environ.get("FMP_API_KEY", "")
        self._session = requests.Session()
        self._daily_cache: Dict[str, List[Dict]] = {}
        self._daily_cache_lock = threading.Lock()

    # ── FMP fetch with light retry/backoff on rate limits ────────────────────
    def _fetch_json(self, endpoint: str, params: Optional[Dict] = None,
                    retries: int = 3) -> Any:
        params = dict(params or {})
        params["apikey"] = self.api_key
        last_err: Optional[Exception] = None
        for attempt in range(1, retries + 1):
            try:
                resp = self._session.get(
                    f"{self.FMP_BASE}/{endpoint}", params=params, timeout=25
                )
                if resp.status_code == 429:
                    time.sleep(1.5 * attempt)
                    continue
                resp.raise_for_status()
                return resp.json()
            except Exception as e:  # noqa: BLE001
                last_err = e
                time.sleep(0.4 * attempt)
        logger.warning("[EdgeFinder] FMP fetch failed (%s): %s", endpoint, last_err)
        return None

    # ── Step 1: universe (with sector/industry/mktCap metadata) ──────────────
    def _build_universe(self, cfg: Dict[str, Any]) -> List[Dict]:
        lo = MARKET_CAP_BUCKETS[cfg["market_cap_min"]][0]
        hi = MARKET_CAP_BUCKETS[cfg["market_cap_max"]][1]
        params = {
            "marketCapMoreThan": int(lo),
            "marketCapLowerThan": int(hi),
            "priceLowerThan": cfg["price_max"],
            "isActivelyTrading": "true",
            "isEtf": "false",
            "isFund": "false",
            "limit": 10000,
        }
        if cfg["price_min"] > 0:
            params["priceMoreThan"] = cfg["price_min"]
        data = self._fetch_json("company-screener", params)
        if not isinstance(data, list):
            return []
        rows: List[Dict] = []
        for row in data:
            sym = row.get("symbol")
            exch = (row.get("exchangeShortName") or "").upper()
            if not sym:
                continue
            if exch and exch not in ("NASDAQ", "NYSE", "AMEX"):
                continue
            rows.append({
                "symbol": sym,
                "sector": row.get("sector") or "Desconocido",
                "industry": row.get("industry") or None,
                "market_cap": row.get("marketCap") or None,
                "exchange": exch or None,
            })
        return rows

    # ── Daily history (ascending, cached) ─────────────────────────────────────
    def _daily_history(self, symbol: str, date_from: str, date_to: str) -> List[Dict]:
        key = f"{symbol}:{date_from}:{date_to}"
        with self._daily_cache_lock:
            cached = self._daily_cache.get(key)
        if cached is not None:
            return cached
        data = self._fetch_json(
            "historical-price-eod/full",
            {"symbol": symbol, "from": date_from, "to": date_to},
        )
        hist = data.get("historical", []) if isinstance(data, dict) else data
        if not isinstance(hist, list):
            hist = []
        hist = sorted(hist, key=lambda b: b.get("date", ""))
        with self._daily_cache_lock:
            self._daily_cache[key] = hist
        return hist

    @staticmethod
    def _parse_bars(hist: List[Dict]) -> Tuple[List[str], np.ndarray, np.ndarray,
                                               np.ndarray, np.ndarray, np.ndarray]:
        """Split history into parallel arrays (dates, open, high, low, close, volume);
        rows with malformed OHLC are dropped."""
        dates: List[str] = []
        o: List[float] = []; h: List[float] = []; l: List[float] = []
        c: List[float] = []; v: List[float] = []
        for b in hist:
            try:
                dt = str(b["date"])[:10]
                bo = float(b["open"]); bh = float(b["high"])
                bl = float(b["low"]); bc = float(b["close"])
                bv = float(b.get("volume") or 0)
            except (KeyError, TypeError, ValueError):
                continue
            dates.append(dt)
            o.append(bo); h.append(bh); l.append(bl); c.append(bc); v.append(bv)
        return (dates, np.asarray(o), np.asarray(h), np.asarray(l),
                np.asarray(c), np.asarray(v))

    # ── Pre-surge pattern classification (10 bars ending the day before D0) ──
    @staticmethod
    def _classify_pattern(closes: np.ndarray, highs: np.ndarray, lows: np.ndarray
                          ) -> Tuple[str, float, float, float]:
        """Returns (label, pre_ret10_pct, compression_ratio, avg_tr_pct)."""
        ret10 = (closes[-1] / closes[0] - 1.0) * 100 if closes[0] > 0 else 0.0
        tr = (highs - lows) / np.where(closes > 0, closes, 1.0) * 100
        tr_first = float(np.mean(tr[:5])) if tr.size >= 5 else float(np.mean(tr))
        tr_last = float(np.mean(tr[5:])) if tr.size > 5 else float(np.mean(tr))
        compression = tr_last / tr_first if tr_first > 0 else 1.0
        avg_tr = float(np.mean(tr))
        span = (float(np.max(closes)) - float(np.min(closes))) / float(np.min(closes)) * 100 \
            if float(np.min(closes)) > 0 else 0.0

        if ret10 <= -12:
            label = PAT_CAPITULATION
        elif ret10 <= -5:
            label = PAT_PULLBACK
        elif ret10 >= 12:
            label = PAT_MOMENTUM
        elif ret10 >= 5:
            label = PAT_UPTREND
        elif compression <= 0.6:
            label = PAT_COIL
        elif span <= 8:
            label = PAT_FLAT
        else:
            label = PAT_CHOPPY
        return label, round(float(ret10), 2), round(float(compression), 3), round(avg_tr, 2)

    # ── Breakout type — "patrón previo 2" ─────────────────────────────────────
    @staticmethod
    def _classify_breakout(o: np.ndarray, h: np.ndarray, c: np.ndarray,
                           i: int, w_end: int, high52: Optional[float],
                           pattern: str, pre_ret10: float
                           ) -> Tuple[str, Optional[int], float]:
        """Classify what kind of breakout (if any) launched the surge.

        Returns (label, breakout_day, pre_high_10d):
          - breakout_day: 1-based day within the surge window when price first
            CLOSED above the prior 10-day high (None if it never did),
          - pre_high_10d: the prior 10-day high level (for the event chart).
        """
        pre10_high = float(np.max(h[i - PRE_BARS:i]))
        breakout_day: Optional[int] = None
        for k in range(i, w_end):
            if c[k] > pre10_high:
                breakout_day = k - i + 1
                break
        broke = breakout_day is not None

        # flag: pole up (≥15% into the flag top), shallow drifting pullback
        # (−25%..−1% from that top into D-1), then break of the prior highs
        is_flag = False
        peak_zone = c[i - PRE_BARS:i - 2]
        if peak_zone.size and broke:
            j = i - PRE_BARS + int(np.argmax(peak_zone))
            peak_close = float(c[j])
            pole_base = float(np.min(c[max(0, j - 10):j + 1]))
            if pole_base > 0 and peak_close > 0:
                pole_ret = (peak_close - pole_base) / pole_base * 100
                pullback = (float(c[i - 1]) - peak_close) / peak_close * 100
                is_flag = pole_ret >= 15 and -25 <= pullback <= -1

        if is_flag:
            label = BK_FLAG
        elif broke and high52 is not None and float(np.max(c[i:w_end])) > high52:
            label = BK_52W
        elif float(o[i]) > pre10_high:
            label = BK_GAP
        elif broke and pattern in (PAT_COIL, PAT_FLAT):
            label = BK_BASE
        elif pre_ret10 <= -5:
            label = BK_REVERSAL_RECLAIM if broke else BK_BOUNCE
        elif broke:
            label = BK_CONTINUATION
        else:
            label = BK_RANGE
        return label, breakout_day, round(pre10_high, 2)

    @staticmethod
    def _consecutive(closes: np.ndarray) -> Tuple[int, int]:
        """(consecutive red days, consecutive green days) ending at the last close."""
        red = green = 0
        for j in range(closes.size - 1, 0, -1):
            if closes[j] < closes[j - 1] and green == 0:
                red += 1
            elif closes[j] > closes[j - 1] and red == 0:
                green += 1
            else:
                break
        return red, green

    # ── Step 2: per-symbol surge scan ─────────────────────────────────────────
    def _scan_symbol(self, meta: Dict, cfg: Dict[str, Any]) -> List[Dict]:
        symbol = meta["symbol"]
        hist = self._daily_history(symbol, cfg["_hist_from"], cfg["_hist_to"])
        if len(hist) < PRE_BARS + 2:
            return []
        dates, o, h, l, c, v = self._parse_bars(hist)
        n = len(dates)
        if n < PRE_BARS + 2:
            return []

        thr = cfg["surge_pct_min"] / 100.0
        days = cfg["surge_days"]
        events: List[Dict] = []
        i = PRE_BARS  # need 10 pre-bars and i-1 as base
        while i < n:
            day = dates[i]
            if day < cfg["date_from"]:
                i += 1
                continue
            if day > cfg["date_to"]:
                break
            base = c[i - 1]
            if base <= 0 or not (cfg["price_min"] <= base <= cfg["price_max"]):
                i += 1
                continue
            if c[i] <= c[i - 1]:  # anchor: the surge must START with an up day
                i += 1
                continue
            w_end = min(i + days, n)  # window [i, i+days-1]
            win_high = h[i:w_end]
            if win_high.size == 0:
                break
            peak_pos = int(np.argmax(win_high))
            peak = float(win_high[peak_pos])
            surge_pct = (peak - base) / base * 100
            if surge_pct < thr * 100:
                i += 1
                continue

            events.append(self._build_event(meta, cfg, dates, o, h, l, c, v,
                                            i, base, peak, peak_pos, surge_pct))
            i = i + days  # dedupe: skip past the surge window before rescanning
        return events

    def _build_event(self, meta: Dict, cfg: Dict, dates: List[str],
                     o: np.ndarray, h: np.ndarray, l: np.ndarray, c: np.ndarray,
                     v: np.ndarray, i: int, base: float, peak: float,
                     peak_pos: int, surge_pct: float) -> Dict:
        n = len(dates)
        pre_c = c[i - PRE_BARS:i]
        pre_h = h[i - PRE_BARS:i]
        pre_l = l[i - PRE_BARS:i]

        pattern, pre_ret10, compression, avg_tr = self._classify_pattern(pre_c, pre_h, pre_l)
        consec_red, consec_green = self._consecutive(c[max(0, i - PRE_BARS - 1):i])

        # volume: day before the surge vs the 20-day average ending at D-2
        vol_prev = float(v[i - 1])
        va = v[max(0, i - 1 - VOL_AVG_WINDOW):i - 1]
        vol_avg20 = float(np.mean(va)) if va.size >= 5 else None
        vol_ratio = round(vol_prev / vol_avg20, 2) if vol_avg20 else None
        vol_d0_ratio = round(float(v[i]) / vol_avg20, 2) if vol_avg20 else None

        # 52-week distance at the surge start (base close vs rolling extremes to D-1)
        lb_l = l[max(0, i - LOOKBACK_52W):i]
        lb_h = h[max(0, i - LOOKBACK_52W):i]
        if lb_l.size >= 120 and float(np.min(lb_l)) > 0:
            low52 = float(np.min(lb_l)); high52 = float(np.max(lb_h))
            dist_low = round((base - low52) / low52 * 100, 1)
            dist_high = round((base - high52) / high52 * 100, 1) if high52 > 0 else None
            high52_val: Optional[float] = high52
        else:
            dist_low = dist_high = None
            high52_val = None

        gap_pct = round((float(o[i]) - base) / base * 100, 2)

        # patrón previo 2: tipo de breakout que lanzó el surge
        w_end = min(i + int(cfg["surge_days"]), n)
        breakout, breakout_day, pre_high_10d = self._classify_breakout(
            o, h, c, i, w_end, high52_val, pattern, pre_ret10)

        # post-surge continuation from the base close (offset +k = k days after D0)
        def ret_at(k: int) -> Optional[float]:
            j = i + k
            return round((float(c[j]) - base) / base * 100, 2) if j < n else None

        # normalized closes (base=100 at D-1) for the composite path, offsets -10..+10
        norm: Dict[int, float] = {}
        for off in range(-PRE_BARS, POST_BARS + 1):
            j = i + off
            if 0 <= j < n and base > 0:
                norm[off] = round(float(c[j]) / base * 100, 3)

        try:
            wd_idx = datetime.strptime(dates[i], "%Y-%m-%d").weekday()
        except ValueError:
            wd_idx = None

        return {
            "symbol": meta["symbol"],
            "sector": meta["sector"],
            "industry": meta["industry"],
            "exchange": meta["exchange"],
            "market_cap": meta["market_cap"],
            "date": dates[i],
            "weekday_idx": wd_idx,
            "weekday": WEEKDAY_LABELS[wd_idx] if wd_idx is not None else None,
            "base_price": round(base, 2),
            "peak_price": round(peak, 2),
            "surge_pct": round(surge_pct, 1),
            "days_to_peak": peak_pos + 1,
            "gap_pct": gap_pct,
            "vol_prev": vol_prev,
            "vol_avg20": round(vol_avg20) if vol_avg20 else None,
            "vol_ratio": vol_ratio,
            "vol_d0_ratio": vol_d0_ratio,
            "dist_52w_low_pct": dist_low,
            "dist_52w_high_pct": dist_high,
            "pattern": pattern,
            "breakout": breakout,
            "breakout_day": breakout_day,
            "pre_high_10d": pre_high_10d,
            "consec_red": consec_red,
            "consec_green": consec_green,
            "pre_ret10_pct": pre_ret10,
            "compression": compression,
            "pre_tr_pct": avg_tr,
            "ret_3d": ret_at(3),
            "ret_5d": ret_at(5),
            "ret_10d": ret_at(10),
            # sector context filled in later (needs the ETF/SPY histories)
            "sector_etf": SECTOR_ETF.get(meta["sector"]),
            "sector_ret20_pct": None,
            "spy_ret20_pct": None,
            "sector_hot": None,
            "spy_up_d0": None,
            "_norm": norm,  # stripped before returning the payload
        }

    # ── Step 3: sector ETF / SPY context (hot vs cold into the surge) ────────
    def _attach_sector_context(self, events: List[Dict], cfg: Dict) -> None:
        etfs = sorted({e["sector_etf"] for e in events if e["sector_etf"]}) + ["SPY"]
        ctx: Dict[str, Tuple[List[str], np.ndarray]] = {}
        ctx_from = (datetime.strptime(cfg["date_from"], "%Y-%m-%d")
                    - timedelta(days=60)).strftime("%Y-%m-%d")
        for etf in etfs:
            hist = self._daily_history(etf, ctx_from, cfg["date_to"])
            dates, _o, _h, _l, c, _v = self._parse_bars(hist)
            if dates:
                ctx[etf] = (dates, c)

        def ret20_before(etf: str, day: str) -> Optional[float]:
            data = ctx.get(etf)
            if not data:
                return None
            dates, closes = data
            idx = bisect_right(dates, day) - 1  # last bar <= day
            if idx < SECTOR_RET_WINDOW + 1:
                return None
            # 20d return ENDING the day before the surge start
            a, b = closes[idx - 1 - SECTOR_RET_WINDOW], closes[idx - 1]
            return round((float(b) / float(a) - 1.0) * 100, 2) if a > 0 else None

        spy = ctx.get("SPY")
        for e in events:
            day = e["date"]
            spy_ret = ret20_before("SPY", day)
            e["spy_ret20_pct"] = spy_ret
            if spy is not None:
                sd, sc = spy
                idx = bisect_right(sd, day) - 1
                if idx >= 1 and sd[idx] == day:
                    e["spy_up_d0"] = bool(sc[idx] > sc[idx - 1])
            if e["sector_etf"]:
                sec_ret = ret20_before(e["sector_etf"], day)
                e["sector_ret20_pct"] = sec_ret
                if sec_ret is not None and spy_ret is not None:
                    e["sector_hot"] = bool(sec_ret > spy_ret)

    # ── Step 4: aggregation ───────────────────────────────────────────────────
    @staticmethod
    def _bucketize(events: List[Dict], field: str,
                   buckets: List[Tuple[str, float, float]]) -> List[Dict]:
        """Bucket events by a numeric field; (label, lo, hi] half-open ranges."""
        out = []
        vals = [(e, e.get(field)) for e in events]
        known = [(e, x) for e, x in vals if x is not None]
        n = len(events)
        for label, lo, hi in buckets:
            sub = [e for e, x in known if lo <= x < hi]
            if not sub:
                continue
            out.append({
                "bucket": label,
                "count": len(sub),
                "pct": round(100.0 * len(sub) / n, 1),
                "avg_surge": round(float(np.mean([e["surge_pct"] for e in sub])), 1),
                "med_ret_10d": EdgeFinderEngine._median([e["ret_10d"] for e in sub]),
            })
        unknown = n - len(known)
        if unknown:
            out.append({"bucket": "s/d", "count": unknown,
                        "pct": round(100.0 * unknown / n, 1),
                        "avg_surge": None, "med_ret_10d": None})
        return out

    @staticmethod
    def _median(vals: List[Optional[float]]) -> Optional[float]:
        xs = [x for x in vals if x is not None]
        return round(float(np.median(xs)), 2) if xs else None

    @staticmethod
    def _pct_of(events: List[Dict], pred: Callable[[Dict], bool],
                field: Optional[str] = None) -> Optional[float]:
        """% of events satisfying pred; if field given, only over events where it's known."""
        pool = [e for e in events if e.get(field) is not None] if field else events
        if not pool:
            return None
        return round(100.0 * sum(1 for e in pool if pred(e)) / len(pool), 1)

    def _aggregate(self, events: List[Dict], cfg: Dict, meta: Dict) -> Dict[str, Any]:
        if not events:
            return {"kpis": None, "composite": [], "by_pattern": [], "by_breakout": [], "by_sector": [],
                    "dist_52w_buckets": [], "vol_ratio_buckets": [], "gap_buckets": [],
                    "weekday": [], "events": [], "meta": meta}

        events.sort(key=lambda e: e["date"])
        n = len(events)

        # composite normalized path (base=100 at offset -1)
        composite: List[Dict] = []
        for off in range(-PRE_BARS, POST_BARS + 1):
            xs = [e["_norm"][off] for e in events if off in e["_norm"]]
            if not xs:
                continue
            composite.append({
                "off": off,
                "avg": round(float(np.mean(xs)), 2),
                "median": round(float(np.median(xs)), 2),
                "n": len(xs),
            })

        # pattern mix — the core edge table
        by_pattern: List[Dict] = []
        for label in [PAT_CAPITULATION, PAT_PULLBACK, PAT_MOMENTUM, PAT_UPTREND,
                      PAT_COIL, PAT_FLAT, PAT_CHOPPY]:
            sub = [e for e in events if e["pattern"] == label]
            if not sub:
                continue
            by_pattern.append({
                "pattern": label,
                "count": len(sub),
                "pct": round(100.0 * len(sub) / n, 1),
                "avg_surge": round(float(np.mean([e["surge_pct"] for e in sub])), 1),
                "med_surge": self._median([e["surge_pct"] for e in sub]),
                "avg_days_to_peak": round(float(np.mean([e["days_to_peak"] for e in sub])), 1),
                "med_vol_ratio": self._median([e["vol_ratio"] for e in sub]),
                "med_dist_52w": self._median([e["dist_52w_low_pct"] for e in sub]),
                "med_ret_10d": self._median([e["ret_10d"] for e in sub]),
            })
        by_pattern.sort(key=lambda r: r["count"], reverse=True)

        # breakout-type mix — "patrón previo 2"
        by_breakout: List[Dict] = []
        for label in BREAKOUT_ORDER:
            sub = [e for e in events if e["breakout"] == label]
            if not sub:
                continue
            by_breakout.append({
                "breakout": label,
                "count": len(sub),
                "pct": round(100.0 * len(sub) / n, 1),
                "avg_surge": round(float(np.mean([e["surge_pct"] for e in sub])), 1),
                "med_surge": self._median([e["surge_pct"] for e in sub]),
                "avg_days_to_peak": round(float(np.mean([e["days_to_peak"] for e in sub])), 1),
                "med_breakout_day": self._median([float(e["breakout_day"]) for e in sub
                                                  if e["breakout_day"] is not None]),
                "med_vol_ratio": self._median([e["vol_ratio"] for e in sub]),
                "med_ret_10d": self._median([e["ret_10d"] for e in sub]),
            })
        by_breakout.sort(key=lambda r: r["count"], reverse=True)

        # sector mix + hot share
        sectors = sorted({e["sector"] for e in events})
        by_sector: List[Dict] = []
        for s in sectors:
            sub = [e for e in events if e["sector"] == s]
            hot_known = [e for e in sub if e["sector_hot"] is not None]
            by_sector.append({
                "sector": s,
                "count": len(sub),
                "pct": round(100.0 * len(sub) / n, 1),
                "hot_pct": (round(100.0 * sum(1 for e in hot_known if e["sector_hot"])
                                  / len(hot_known), 1) if hot_known else None),
                "avg_surge": round(float(np.mean([e["surge_pct"] for e in sub])), 1),
                "med_ret_10d": self._median([e["ret_10d"] for e in sub]),
            })
        by_sector.sort(key=lambda r: r["count"], reverse=True)

        dist_buckets = self._bucketize(events, "dist_52w_low_pct", [
            ("<25%", -1e9, 25), ("25–50%", 25, 50), ("50–100%", 50, 100),
            ("100–300%", 100, 300), (">300%", 300, 1e12),
        ])
        vol_buckets = self._bucketize(events, "vol_ratio", [
            ("Seco (<0.5×)", 0, 0.5), ("Bajo (0.5–1×)", 0.5, 1.0),
            ("Normal (1–1.5×)", 1.0, 1.5), ("Elevado (1.5–3×)", 1.5, 3.0),
            ("Explosivo (>3×)", 3.0, 1e9),
        ])
        gap_buckets = self._bucketize(events, "gap_pct", [
            ("Gap down (≤−2%)", -1e9, -2), ("Sin gap (±2%)", -2, 2),
            ("Gap 2–10%", 2, 10), ("Gap 10–25%", 10, 25), ("Gap >25%", 25, 1e9),
        ])

        weekday: List[Dict] = []
        for idx in range(7):
            sub = [e for e in events if e.get("weekday_idx") == idx]
            if sub:
                weekday.append({"weekday": WEEKDAY_LABELS[idx], "count": len(sub),
                                "pct": round(100.0 * len(sub) / n, 1)})

        kpis = {
            "events": n,
            "symbols": len({e["symbol"] for e in events}),
            "median_surge_pct": self._median([e["surge_pct"] for e in events]),
            "avg_surge_pct": round(float(np.mean([e["surge_pct"] for e in events])), 1),
            "median_days_to_peak": self._median([float(e["days_to_peak"]) for e in events]),
            "pct_gap_start": self._pct_of(events, lambda e: e["gap_pct"] >= 2),
            "pct_vol_elevated": self._pct_of(events, lambda e: (e["vol_ratio"] or 0) > 1.5, "vol_ratio"),
            "pct_vol_dryup": self._pct_of(events, lambda e: (e["vol_ratio"] or 9) < 0.6, "vol_ratio"),
            "pct_hot_sector": self._pct_of(events, lambda e: e["sector_hot"] is True, "sector_hot"),
            "median_dist_52w_low": self._median([e["dist_52w_low_pct"] for e in events]),
            "pct_after_red_streak": self._pct_of(events, lambda e: e["consec_red"] >= 3),
            "median_ret_3d": self._median([e["ret_3d"] for e in events]),
            "median_ret_5d": self._median([e["ret_5d"] for e in events]),
            "median_ret_10d": self._median([e["ret_10d"] for e in events]),
            "pct_positive_10d": self._pct_of(events, lambda e: (e["ret_10d"] or -1) > 0, "ret_10d"),
        }

        # payload events (strip internals; cap the table size)
        out_events = []
        for e in events[-int(cfg["max_table_events"]):]:
            ev = {k: v for k, v in e.items() if not k.startswith("_")}
            out_events.append(ev)

        return {
            "kpis": kpis,
            "composite": composite,
            "by_pattern": by_pattern,
            "by_breakout": by_breakout,
            "by_sector": by_sector,
            "dist_52w_buckets": dist_buckets,
            "vol_ratio_buckets": vol_buckets,
            "gap_buckets": gap_buckets,
            "weekday": weekday,
            "events": out_events,
            "meta": meta,
        }

    # ── Per-event daily chart (lazy-loaded by the frontend) ──────────────────
    def event_chart(self, symbol: str, date: str) -> List[Dict]:
        """Daily OHLCV window: 10 bars before the surge start + the start + 10 after."""
        try:
            d = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            return []
        date_from = (d - timedelta(days=45)).strftime("%Y-%m-%d")
        date_to = (d + timedelta(days=30)).strftime("%Y-%m-%d")
        hist = self._daily_history(symbol, date_from, date_to)
        dates, o, h, l, c, v = self._parse_bars(hist)
        if not dates:
            return []
        idx = bisect_right(dates, date) - 1
        if idx < 0 or dates[idx] != date:
            # surge day not in range (rare); fall back to the closest prior bar
            if idx < 0:
                return []
        lo_i = max(0, idx - PRE_BARS)
        hi_i = min(len(dates), idx + POST_BARS + 1)
        out: List[Dict] = []
        for j in range(lo_i, hi_i):
            out.append({
                "t": dates[j][5:],          # MM-DD label
                "day": dates[j],
                "off": j - idx,             # 0 = surge start
                "open": float(o[j]), "high": float(h[j]),
                "low": float(l[j]), "close": float(c[j]),
                "volume": float(v[j]),
                "surge_start": j == idx,
            })
        return out

    # ── Orchestration ────────────────────────────────────────────────────────
    def run_scan(self, cfg: Dict[str, Any],
                 progress: Callable[[int, str], None]) -> Dict[str, Any]:
        warnings: List[str] = [
            "Market cap y sector son point-in-time (actuales) del screener → sesgo de "
            "supervivencia/look-ahead en la selección del universo.",
        ]
        if cfg["use_earnings"]:
            warnings.append("El filtro de earnings todavía no está implementado; se ignoró.")

        # history fetch range: 52w lookback + pre-window before date_from; post bars after
        d_from = datetime.strptime(cfg["date_from"], "%Y-%m-%d")
        d_to = datetime.strptime(cfg["date_to"], "%Y-%m-%d")
        cfg["_hist_from"] = (d_from - timedelta(days=420)).strftime("%Y-%m-%d")
        cfg["_hist_to"] = (d_to + timedelta(days=30)).strftime("%Y-%m-%d")

        progress(3, "Construyendo universo")
        universe = self._build_universe(cfg)
        if not universe:
            raise RuntimeError("No se obtuvieron tickers del screener (revisa filtros / API key)")
        full_universe = len(universe)
        cap = int(cfg["max_universe"])
        if full_universe > cap:
            warnings.append(
                f"Universo completo: {full_universe} tickers; limitado por seguridad a {cap}."
            )
            universe = universe[:cap]
        progress(8, f"Universo: {len(universe)}/{full_universe} tickers — buscando surges")

        events: List[Dict] = []
        done = 0
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {pool.submit(self._scan_symbol, m, cfg): m["symbol"] for m in universe}
            for fut in as_completed(futs):
                done += 1
                try:
                    events.extend(fut.result() or [])
                except Exception as e:  # noqa: BLE001
                    logger.debug("[EdgeFinder] scan error %s: %s", futs[fut], e)
                if done % 25 == 0 or done == len(universe):
                    pct = 8 + int(80 * done / max(len(universe), 1))
                    progress(pct, f"Escaneando {done}/{len(universe)} — {len(events)} surges")

        events.sort(key=lambda e: e["date"])
        events_found = len(events)
        if events_found > cfg["max_events"]:
            warnings.append(
                f"{events_found} surges encontrados; el análisis se limitó a los "
                f"{cfg['max_events']} más recientes."
            )
            events = events[-int(cfg["max_events"]):]

        meta = {
            "universe_size": len(universe),
            "universe_full": full_universe,
            "events_found": events_found,
            "date_from": cfg["date_from"],
            "date_to": cfg["date_to"],
            "params": {k: v for k, v in cfg.items() if not k.startswith("_")},
            "warnings": warnings,
        }

        if events:
            progress(90, "Contexto sectorial (ETFs vs SPY)")
            try:
                self._attach_sector_context(events, cfg)
            except Exception as e:  # noqa: BLE001
                logger.warning("[EdgeFinder] sector context failed: %s", e)

        progress(96, "Agregando y buscando el edge")
        result = self._aggregate(events, cfg, meta)
        progress(100, "Listo")
        return result


# ═══════════════════════════════════════════════════════════════════════════
#  Config normalization + public job API
# ═══════════════════════════════════════════════════════════════════════════
def _normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    def f(key: str, default: float) -> float:
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    today = datetime.utcnow().date()
    default_from = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    default_to = today.strftime("%Y-%m-%d")

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
        "use_earnings": bool(raw.get("use_earnings", False)),  # reserved (ignored)
        "date_from": str(raw.get("date_from") or default_from),
        "date_to": str(raw.get("date_to") or default_to),
        "max_universe": int(max(f("max_universe", 5000), 1)),
        "max_events": int(max(f("max_events", 3000), 1)),
        "max_table_events": int(max(f("max_table_events", 600), 1)),
    }


_ENGINE: Optional[EdgeFinderEngine] = None


def get_edge_finder_engine() -> EdgeFinderEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = EdgeFinderEngine()
    return _ENGINE


def start_job(raw_config: Dict[str, Any]) -> str:
    """Create a job, launch the scan on a background thread, return job_id."""
    _prune_jobs()
    cfg = _normalize_config(raw_config)
    job_id = uuid.uuid4().hex[:16]
    _set_job(job_id, status="queued", progress=0, stage="En cola",
             result=None, error=None, created_at=time.time())

    def _run() -> None:
        def progress(pct: int, stage: str) -> None:
            _set_job(job_id, status="running", progress=int(pct), stage=stage)
        try:
            engine = get_edge_finder_engine()
            result = engine.run_scan(cfg, progress)
            _set_job(job_id, status="done", progress=100, stage="Listo", result=result)
        except Exception as e:  # noqa: BLE001
            logger.exception("[EdgeFinder] job %s failed", job_id)
            _set_job(job_id, status="error", error=str(e), stage="Error")

    threading.Thread(target=_run, daemon=True).start()
    return job_id
