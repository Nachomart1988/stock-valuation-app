"""
Strategy One Backtest Engine
============================

A general *daily-setup* backtest that supports **long OR short**. Unlike the gap-up
short engine, the universe day-scan is driven by a configurable setup (previous-day
color, consecutive green/red streaks, distance from the 52-week low, ATR floor, market
cap + price range). When a day **D** qualifies (evaluated at its close), the trade is
taken the **next** trading day **D+1** intraday, with the chosen entry / stop-loss /
take-profit rules — simulated on 1-minute bars (premarket included via FMP
``extended=true``).

Mirrors ``gap_short_backtest_engine.py`` (async job system, FMP helpers, metrics,
optimization, SPY/weekday analysis) but is self-contained so the working gap strategy
is never touched. The per-trade chart reuses the gap engine's symbol/date/interval
endpoint, so this module does not expose its own chart.

Documented limitations (same spirit as the gap engine, surfaced in the UI):
  - Market cap / 52w-low / ATR use point-in-time-of-scan data → survivorship/look-ahead
    bias in universe selection.
  - Conservative intrabar assumption: if a 1-min bar touches both stop and target, the
    stop is assumed to fill first.
  - Borrow/locate availability and short financing costs are NOT modeled.
"""

from __future__ import annotations

import os
import time
import uuid
import logging
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Tuple, Callable

import numpy as np
import requests

logger = logging.getLogger(__name__)

# ── Session time gates (minutes since midnight, US Eastern) ──────────────────
PREMARKET_START = 4 * 60        # 04:00
REGULAR_OPEN = 9 * 60 + 30      # 09:30  (570)
REGULAR_CLOSE = 16 * 60         # 16:00  (960) — last 1-min bar stamps 15:59

# ── Market cap buckets (USD) — extended vs the gap engine ────────────────────
MARKET_CAP_BUCKETS: Dict[str, Tuple[float, float]] = {
    "nano":  (0,               50_000_000),
    "micro": (50_000_000,      300_000_000),
    "small": (300_000_000,     2_000_000_000),
    "mid":   (2_000_000_000,   10_000_000_000),
    "large": (10_000_000_000,  200_000_000_000),
    "mega":  (200_000_000_000, 100_000_000_000_000),
    "all":   (0,               100_000_000_000_000),
}

TRADING_DAYS_PER_YEAR = 252
LOOKBACK_52W = 252  # trading days ≈ 52 weeks (rolling low window)

# Price tick: prices are quoted in pennies (2 decimals); the stop must sit at least one
# tick (1¢) on the protective side of the entry.
PRICE_TICK = 0.01

WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

# Pyramiding add-on rules (keep TOTAL position risk at exactly 1R). Names are
# side-neutral; the meaning mirrors per side (e.g. failed_reclaim_open = a counter-move
# that fails to reclaim the session open against the trade).
PYRAMID_RULES = ("failed_reclaim_open", "ema9_reject", "new_extreme_after_window")


def _r2(price: float) -> float:
    """Round a price to the penny tick (2 decimals)."""
    return round(float(price) + 1e-9, 2)


def _clamp_short_stop(entry: float, raw_stop: float) -> float:
    """SHORT stop: round to penny, force ≥ entry + 1 tick (stop sits above entry)."""
    return round(max(_r2(raw_stop), _r2(entry) + PRICE_TICK), 2)


def _clamp_long_stop(entry: float, raw_stop: float) -> float:
    """LONG stop: round to penny, force ≤ entry − 1 tick (stop sits below entry)."""
    return round(min(_r2(raw_stop), _r2(entry) - PRICE_TICK), 2)


# ═══════════════════════════════════════════════════════════════════════════
#  Job registry (in-process; own registry separate from the gap engine)
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
class StrategyOneBacktestEngine:
    FMP_BASE = "https://financialmodelingprep.com/stable"

    _R_CAP = 10.0           # winsorize per-trade R for robust optimization ranking
    _MAX_ADD_MULT = 20.0    # cap pyramid add size as a multiple of the initial leg

    def __init__(self, api_key: Optional[str] = None) -> None:
        self.version = "1.0"
        self.api_key = api_key or os.environ.get("FMP_API_KEY", "")
        self._session = requests.Session()
        self._daily_cache: Dict[str, List[Dict]] = {}
        self._daily_cache_lock = threading.Lock()
        self._event_cache: Dict[str, Dict] = {}
        self._event_cache_lock = threading.Lock()

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
        logger.warning("[StrategyOneBT] FMP fetch failed (%s): %s", endpoint, last_err)
        return None

    # ── Time helpers ─────────────────────────────────────────────────────────
    @staticmethod
    def _minutes_et(bar_date: str) -> Optional[int]:
        try:
            t = bar_date.split(" ")[1]
            hh, mm = t.split(":")[0:2]
            return int(hh) * 60 + int(mm)
        except Exception:
            return None

    @staticmethod
    def _day_of(bar_date: str) -> str:
        return bar_date.split(" ")[0]

    @staticmethod
    def _hhmm(minutes: Optional[int]) -> Optional[str]:
        if minutes is None:
            return None
        return f"{minutes // 60:02d}:{minutes % 60:02d}"

    # ── Step 1: universe ─────────────────────────────────────────────────────
    def _build_universe(self, cfg: Dict[str, Any]) -> List[str]:
        lo, hi = MARKET_CAP_BUCKETS.get(cfg["market_cap_bucket"], (0, 1e17))
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
        symbols: List[str] = []
        for row in data:
            sym = row.get("symbol")
            exch = (row.get("exchangeShortName") or "").upper()
            if not sym:
                continue
            if exch and exch not in ("NASDAQ", "NYSE", "AMEX"):
                continue
            symbols.append(sym)
        return symbols

    # ── Step 2: daily history + setup detection ──────────────────────────────
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
    def _is_green(bar: Dict) -> Optional[bool]:
        try:
            o, c = float(bar["open"]), float(bar["close"])
        except (KeyError, TypeError, ValueError):
            return None
        if c > o:
            return True
        if c < o:
            return False
        return None  # doji → neither green nor red (breaks a streak)

    def _find_setups(self, symbol: str, cfg: Dict[str, Any]) -> List[Dict]:
        """Scan daily bars; emit one event per day that qualifies as a setup. The setup
        is evaluated through day D (= ``hist[i-1]``) and the trade is taken on D+1
        (= ``hist[i]``)."""
        # extend the daily window backwards so the 52w-low / ATR / streak lookbacks have
        # enough history at the start of the requested date range.
        try:
            ext_from = (datetime.strptime(cfg["date_from"], "%Y-%m-%d")
                        - timedelta(days=420)).strftime("%Y-%m-%d")
        except Exception:
            ext_from = cfg["date_from"]
        hist = self._daily_history(symbol, ext_from, cfg["date_to"])
        n = len(hist)
        if n < 3:
            return []

        # precompute True Range and rolling ATR (simple moving average of TR)
        period = int(cfg["atr_period"])
        tr: List[Optional[float]] = [None] * n
        for i in range(1, n):
            try:
                h = float(hist[i]["high"]); l = float(hist[i]["low"])
                pc = float(hist[i - 1]["close"])
            except (KeyError, TypeError, ValueError):
                continue
            tr[i] = max(h - l, abs(h - pc), abs(l - pc))
        atr: List[Optional[float]] = [None] * n
        if cfg["atr_min"] > 0:
            for i in range(n):
                window = [x for x in tr[max(1, i - period + 1): i + 1] if x is not None]
                if len(window) >= max(2, period // 2):
                    atr[i] = float(np.mean(window))

        events: List[Dict] = []
        want_color = cfg["prev_day_color"]
        need_green = int(cfg["consec_green"])
        need_red = int(cfg["consec_red"])
        dist_min = cfg["dist_52w_min_pct"] / 100.0
        from_day = cfg["date_from"]

        for i in range(1, n):
            d = i - 1                      # setup day D
            entry_bar = hist[i]            # trade day D+1
            day_d = hist[d]
            try:
                entry_open = float(entry_bar["open"])
                close_d = float(day_d["close"])
            except (KeyError, TypeError, ValueError):
                continue
            if entry_bar.get("date", "") < from_day:
                continue  # entry day before the requested range (warm-up only)
            if entry_open <= 0 or close_d <= 0:
                continue

            # price range applies to the entry-day open
            if not (cfg["price_min"] <= entry_open <= cfg["price_max"]):
                continue

            # previous-day color (color of D)
            green_d = self._is_green(day_d)
            if want_color == "green" and green_d is not True:
                continue
            if want_color == "red" and green_d is not False:
                continue

            # consecutive green/red streaks ending at D
            if need_green > 0 and not self._streak_ok(hist, d, need_green, True):
                continue
            if need_red > 0 and not self._streak_ok(hist, d, need_red, False):
                continue

            # distance from the 52-week low (as of close[D])
            if cfg["use_dist_52w"]:
                lo_window = [float(b["low"]) for b in hist[max(0, d - LOOKBACK_52W + 1): d + 1]
                             if self._safe_float(b.get("low")) is not None]
                if not lo_window:
                    continue
                low52 = min(lo_window)
                if low52 <= 0:
                    continue
                dist = (close_d - low52) / low52
                if dist < dist_min:
                    continue
                dist_pct = round(dist * 100, 2)
            else:
                dist_pct = None

            # ATR floor (as of D)
            if cfg["atr_min"] > 0:
                a = atr[d]
                if a is None or a < cfg["atr_min"]:
                    continue

            events.append({
                "symbol": symbol,
                "date": entry_bar["date"],
                "gap_pct": dist_pct if dist_pct is not None else 0.0,  # reuse field for UI
                "dist_52w_pct": dist_pct,
                "prev_close": close_d,
                "prev_high": self._safe_float(day_d.get("high")) or 0.0,
                "prev_low": self._safe_float(day_d.get("low")) or 0.0,
            })
        return events

    @staticmethod
    def _safe_float(v: Any) -> Optional[float]:
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def _streak_ok(self, hist: List[Dict], end_idx: int, n: int, green: bool) -> bool:
        """True if the ``n`` daily bars ending at ``end_idx`` are all green (or all red)."""
        if end_idx - n + 1 < 0:
            return False
        for j in range(end_idx - n + 1, end_idx + 1):
            if self._is_green(hist[j]) is not green:
                return False
        return True

    # ── Step 3: intraday fetch + simulation ──────────────────────────────────
    def _intraday_day(self, symbol: str, day: str) -> List[Dict]:
        data = self._fetch_json(
            "historical-chart/1min",
            {"symbol": symbol, "from": day, "to": day, "extended": "true"},
        )
        if not isinstance(data, list):
            return []
        bars: List[Dict] = []
        for b in data:
            m = self._minutes_et(b.get("date", ""))
            if m is None:
                continue
            try:
                bars.append({
                    "date": b["date"],
                    "day": self._day_of(b["date"]),
                    "min": m,
                    "open": float(b["open"]),
                    "high": float(b["high"]),
                    "low": float(b["low"]),
                    "close": float(b["close"]),
                })
            except (KeyError, TypeError, ValueError):
                continue
        bars.sort(key=lambda x: x["date"])
        return bars

    def _intraday_bars(self, symbol: str, day0: str, carry_days: int) -> List[Dict]:
        bars = self._intraday_day(symbol, day0)
        if not bars or carry_days <= 0:
            return bars
        cur = datetime.strptime(day0, "%Y-%m-%d")
        collected = 0
        probes = 0
        while collected < carry_days and probes < carry_days * 3 + 5:
            cur += timedelta(days=1)
            probes += 1
            day_bars = self._intraday_day(symbol, cur.strftime("%Y-%m-%d"))
            if day_bars:
                bars.extend(day_bars)
                collected += 1
        bars.sort(key=lambda x: x["date"])
        return bars

    def _prepare_event(self, event: Dict, carry_days: int) -> Optional[Dict]:
        """Fetch + split intraday bars once for an event (cached). Feeds ``_run_rules``
        for ANY entry/stop/tp config (cheap optimization grid)."""
        symbol, day0 = event["symbol"], self._day_of(event["date"])
        ckey = f"{symbol}:{day0}:{carry_days}"
        with self._event_cache_lock:
            cached = self._event_cache.get(ckey)
        if cached is not None:
            return cached if cached.get("ok") else None

        bars = self._intraday_bars(symbol, day0, carry_days)
        prepared: Dict[str, Any] = {"ok": False}
        if bars:
            day_bars = [b for b in bars if b["day"] == day0]
            pre = [b for b in day_bars if b["min"] < REGULAR_OPEN]
            reg = [b for b in day_bars if REGULAR_OPEN <= b["min"] < REGULAR_CLOSE]
            if len(reg) >= 2:
                prepared = {
                    "ok": True,
                    "symbol": symbol,
                    "day0": day0,
                    "bars": bars,
                    "reg": reg,
                    "pmh": max((b["high"] for b in pre), default=None),
                    "pml": min((b["low"] for b in pre), default=None),
                    "one_min_high": reg[0]["high"],
                    "one_min_low": reg[0]["low"],
                    "five_min_high": max(b["high"] for b in reg[:5]),
                    "five_min_low": min(b["low"] for b in reg[:5]),
                }
        with self._event_cache_lock:
            self._event_cache[ckey] = prepared
        return prepared if prepared.get("ok") else None

    def _simulate_event(self, event: Dict, cfg: Dict[str, Any]) -> Optional[Dict]:
        carry_days = int(cfg["carry_max_days"]) if cfg["eod_close"] == "carry_next_day" else 0
        prepared = self._prepare_event(event, carry_days)
        if prepared is None:
            return None
        return self._run_rules(prepared, event, cfg)

    def _run_rules(self, prepared: Dict, event: Dict, cfg: Dict[str, Any]) -> Optional[Dict]:
        symbol, day0 = prepared["symbol"], prepared["day0"]
        bars, reg = prepared["bars"], prepared["reg"]
        side = cfg["side"]

        entry = self._resolve_entry(cfg, prepared)
        if entry is None:
            return None
        entry_idx, entry_price, stop_override = entry
        entry_price = _r2(entry_price)
        if stop_override is not None:
            stop_override = _r2(stop_override)

        if cfg.get("pyramid"):
            pyr = self._simulate_pyramid(prepared, event, cfg, entry_idx, entry_price, stop_override)
            if pyr is not None:
                return pyr

        entry_bar = reg[entry_idx]
        g_idx = next((i for i, b in enumerate(bars) if b["date"] == entry_bar["date"]), None)
        if g_idx is None:
            return None

        trailing = cfg["stop_loss"] == "trailing_pct"
        stop_level = self._resolve_stop(cfg, prepared, entry_price, stop_override)
        target = self._resolve_target(cfg, prepared, event, entry_price, stop_level)
        risk_per_share = abs(stop_level - entry_price) if (stop_level is not None) else None

        entry_min = reg[entry_idx]["min"]
        exit_price, reason, exit_min = self._walk(
            bars, g_idx, day0, side, entry_price, stop_level, target, cfg, trailing,
        )

        return {
            "symbol": symbol,
            "date": day0,
            "side": side,
            "gap_pct": event.get("gap_pct", 0.0),
            "dist_52w_pct": event.get("dist_52w_pct"),
            "entry": _r2(entry_price),
            "exit": _r2(exit_price),
            "stop": _r2(stop_level) if stop_level is not None else None,
            "target": _r2(target) if target is not None else None,
            "risk_per_share": round(risk_per_share, 4) if risk_per_share else None,
            "reason": reason,
            "entry_min": entry_min, "entry_time": self._hhmm(entry_min),
            "exit_min": exit_min, "exit_time": self._hhmm(exit_min),
            "add_min": None, "add_time": None,
        }

    # ── Entry / stop / target (side-aware) ───────────────────────────────────
    def _resolve_entry(self, cfg: Dict, prepared: Dict
                       ) -> Optional[Tuple[int, float, Optional[float]]]:
        """Return (entry_index_in_reg, entry_price, stop_override) or None (no trade)."""
        mode = cfg["entry"]
        side = cfg["side"]
        reg = prepared["reg"]
        pmh, pml = prepared["pmh"], prepared["pml"]

        if mode == "opening_bell":
            return 0, reg[0]["open"], None

        if mode == "opening_range_break":
            n = int(cfg["orb_minutes"])
            if len(reg) <= n:
                return None
            if side == "long":
                or_high = max(b["high"] for b in reg[:n])
                for i in range(n, len(reg)):
                    if reg[i]["high"] > or_high:
                        return i, max(or_high, reg[i]["open"]), None
            else:
                or_low = min(b["low"] for b in reg[:n])
                for i in range(n, len(reg)):
                    if reg[i]["low"] < or_low:
                        return i, min(or_low, reg[i]["open"]), None
            return None

        if mode == "premarket_break":
            if side == "long":
                if pmh is None or pmh <= 0:
                    return None
                for i in range(len(reg)):
                    if reg[i]["high"] > pmh:
                        return i, max(pmh, reg[i]["open"]), None
            else:
                if pml is None or pml <= 0:
                    return None
                for i in range(len(reg)):
                    if reg[i]["low"] < pml:
                        return i, min(pml, reg[i]["open"]), None
            return None

        return None

    def _resolve_stop(self, cfg: Dict, prepared: Dict, entry_price: float,
                      stop_override: Optional[float]) -> Optional[float]:
        mode = cfg["stop_loss"]
        side = cfg["side"]
        if mode == "none":
            return None

        if mode == "trailing_pct":
            if side == "long":
                return _clamp_long_stop(entry_price, entry_price * (1 - cfg["trailing_pct"] / 100.0))
            return _clamp_short_stop(entry_price, entry_price * (1 + cfg["trailing_pct"] / 100.0))

        level_map = {
            "premarket_high": prepared.get("pmh"),
            "premarket_low": prepared.get("pml"),
            "one_min_high": prepared.get("one_min_high"),
            "one_min_low": prepared.get("one_min_low"),
            "five_min_high": prepared.get("five_min_high"),
            "five_min_low": prepared.get("five_min_low"),
        }
        raw = stop_override if stop_override is not None else level_map.get(mode)
        if raw is None:
            # fall back to the first regular bar's protective extreme
            raw = prepared["reg"][0]["low"] if side == "long" else prepared["reg"][0]["high"]

        if side == "long":
            # stop must be below entry; if the chosen level is above, use the 1-min low
            if raw >= entry_price:
                raw = min(prepared.get("one_min_low", raw), raw)
            return _clamp_long_stop(entry_price, raw)
        else:
            if raw <= entry_price:
                raw = max(prepared.get("one_min_high", raw), raw)
            return _clamp_short_stop(entry_price, raw)

    def _resolve_target(self, cfg: Dict, prepared: Dict, event: Dict,
                        entry_price: float, stop_level: Optional[float]) -> Optional[float]:
        mode = cfg["take_profit"]
        side = cfg["side"]

        def ok(level: Optional[float]) -> Optional[float]:
            if level is None or level <= 0:
                return None
            if side == "long":
                return _r2(level) if level > entry_price else None
            return _r2(level) if level < entry_price else None

        if mode == "risk_reward":
            if stop_level is None:
                return None
            risk = abs(stop_level - entry_price)
            if side == "long":
                return _r2(entry_price + cfg["rr_ratio"] * risk)
            return _r2(entry_price - cfg["rr_ratio"] * risk)
        if mode == "premarket_high":
            return ok(prepared.get("pmh"))
        if mode == "premarket_low":
            return ok(prepared.get("pml"))
        if mode == "yesterday_high":
            return ok(event.get("prev_high"))
        if mode == "yesterday_low":
            return ok(event.get("prev_low"))
        if mode == "yesterday_close":
            return ok(event.get("prev_close"))
        return None

    def _walk(self, bars: List[Dict], g_idx: int, day0: str, side: str, entry_price: float,
              stop_level: Optional[float], target: Optional[float], cfg: Dict,
              trailing: bool) -> Tuple[float, str, Optional[int]]:
        """Walk bars from the entry bar; return (exit_price, reason, exit_minute)."""
        carry = cfg["eod_close"] == "carry_next_day"
        carry_max = int(cfg["carry_max_days"])
        trail_pct = cfg.get("trailing_pct", 0) / 100.0
        extreme = entry_price  # lowest-seen (short) / highest-seen (long) for trailing
        days_seen: List[str] = []
        last_reg_close: Optional[float] = None
        last_reg_min: Optional[int] = None

        for i in range(g_idx, len(bars)):
            b = bars[i]
            is_reg = REGULAR_OPEN <= b["min"] < REGULAR_CLOSE
            if b["day"] not in days_seen:
                days_seen.append(b["day"])
            day_count = len(days_seen) - 1

            if trailing:
                if side == "long":
                    cur_stop = _clamp_long_stop(extreme, extreme * (1 - trail_pct))
                else:
                    cur_stop = _clamp_short_stop(extreme, extreme * (1 + trail_pct))
            else:
                cur_stop = stop_level

            # conservative intrabar order: stop before target
            if side == "long":
                if cur_stop is not None and b["low"] <= cur_stop:
                    return cur_stop, "stop", b["min"]
                if target is not None and b["high"] >= target:
                    return target, "target", b["min"]
            else:
                if cur_stop is not None and b["high"] >= cur_stop:
                    return cur_stop, "stop", b["min"]
                if target is not None and b["low"] <= target:
                    return target, "target", b["min"]

            if trailing:
                extreme = max(extreme, b["high"]) if side == "long" else min(extreme, b["low"])
            if is_reg:
                last_reg_close, last_reg_min = b["close"], b["min"]

            if not carry and b["day"] == day0:
                nxt = bars[i + 1] if i + 1 < len(bars) else None
                if nxt is None or nxt["day"] != day0 or nxt["min"] >= REGULAR_CLOSE:
                    return (last_reg_close if last_reg_close is not None else b["close"]), "eod", \
                        (last_reg_min if last_reg_min is not None else b["min"])

            if carry and day_count > carry_max:
                return (last_reg_close if last_reg_close is not None else b["close"]), "carry_end", \
                    (last_reg_min if last_reg_min is not None else b["min"])

        return (last_reg_close if last_reg_close is not None else bars[-1]["close"]), "carry_end", \
            (last_reg_min if last_reg_min is not None else bars[-1]["min"])

    # ── Pyramiding (side-aware mirror of the gap engine) ─────────────────────
    def _simulate_pyramid(self, prepared: Dict, event: Dict, cfg: Dict,
                          entry_idx: int, E1: float,
                          stop_override: Optional[float]) -> Optional[Dict]:
        """Add a 2nd leg once the trade is in profit and a counter-move fails, moving the
        stop to that failed-rally extreme, re-sized so TOTAL risk stays exactly 1R.
        Returns a trade with a pre-computed 1R-normalized ``r_multiple`` or None (no
        defined stop → caller uses the single leg)."""
        symbol, day0 = prepared["symbol"], prepared["day0"]
        bars, reg = prepared["bars"], prepared["reg"]
        side = cfg["side"]
        long = side == "long"

        S1 = self._resolve_stop(cfg, prepared, E1, stop_override)
        if S1 is None:
            return None
        rps1 = abs(S1 - E1)
        if rps1 <= 0:
            return None
        target = self._resolve_target(cfg, prepared, event, E1, S1)
        open_price = reg[0]["open"]
        window_end = REGULAR_OPEN + int(cfg["pyramid_window_min"])

        entry_bar = reg[entry_idx]
        g_idx = next((i for i, b in enumerate(bars) if b["date"] == entry_bar["date"]), None)
        if g_idx is None:
            return None

        carry = cfg["eod_close"] == "carry_next_day"
        carry_max = int(cfg["carry_max_days"])
        n1 = 1.0 / rps1  # initial leg risks exactly 1R

        entry_min = reg[entry_idx]["min"]
        state = {"pyr": False, "E2": None, "S2": None, "n2_ratio": 0.0, "add_min": None}

        def r_at(x: float) -> float:
            # per-share P&L per leg, in 1R units (long: x-E ; short: E-x)
            def leg_r(n: float, e: float) -> float:
                return n * (x - e) if long else n * (e - x)
            r = leg_r(n1, E1)
            if state["pyr"]:
                r += leg_r(state["n2_ratio"] * n1, state["E2"])
            return r

        def finish(x: float, reason: str, exit_min: Optional[int]) -> Dict:
            x = _r2(x)
            return {
                "symbol": symbol, "date": day0, "side": side,
                "gap_pct": event.get("gap_pct", 0.0), "dist_52w_pct": event.get("dist_52w_pct"),
                "entry": _r2(E1), "exit": x,
                "stop": _r2(state["S2"]) if state["pyr"] else _r2(S1),
                "target": _r2(target) if target is not None else None,
                "risk_per_share": round(rps1, 4),
                "r_multiple": round(r_at(x), 4),
                "reason": reason,
                "pyramided": state["pyr"],
                "add_price": _r2(state["E2"]) if state["pyr"] else None,
                "add_stop": _r2(state["S2"]) if state["pyr"] else None,
                "add_size_mult": round(state["n2_ratio"], 3) if state["pyr"] else 0.0,
                "entry_min": entry_min, "entry_time": self._hhmm(entry_min),
                "exit_min": exit_min, "exit_time": self._hhmm(exit_min),
                "add_min": state["add_min"], "add_time": self._hhmm(state["add_min"]),
            }

        def commit_add(p_add: float, s2: float) -> None:
            """Add a 2nd leg at p_add with new stop s2, re-sized so TOTAL risk stays 1R.
            Long requires s2 < p_add < E1's... actually: long add when in profit means
            p_add > E1 and stop s2 below p_add but above E1. Short is the mirror."""
            p_add = _r2(p_add)
            if long:
                s2 = _clamp_long_stop(p_add, s2)
                if not (E1 < s2 < p_add):
                    return
                n2 = (1.0 - n1 * (E1 - s2)) / (p_add - s2)
            else:
                s2 = _clamp_short_stop(p_add, s2)
                if not (p_add < s2 < E1):
                    return
                n2 = (1.0 - n1 * (s2 - E1)) / (s2 - p_add)
            if n2 <= 0:
                return
            n2 = min(n2, self._MAX_ADD_MULT * n1)
            state.update({"pyr": True, "E2": p_add, "S2": s2, "n2_ratio": n2 / n1})

        rule = cfg.get("pyramid_rule", "failed_reclaim_open")
        EMA_ALPHA = 2.0 / (9 + 1)
        went_profit = False
        ext_w = (float("inf") if long else float("-inf"))  # window counter-extreme
        evaluated = False
        ema: Optional[float] = None
        pend_level: Optional[float] = None
        ext_day = (float("-inf") if long else float("inf"))   # running HOD (long) / LOD (short)
        pull_ext = (float("inf") if long else float("-inf"))  # last bounce extreme
        days_seen: List[str] = []
        last_reg_close: Optional[float] = None
        last_reg_min: Optional[int] = None

        for i in range(g_idx, len(bars)):
            b = bars[i]
            is_reg = REGULAR_OPEN <= b["min"] < REGULAR_CLOSE
            if b["day"] not in days_seen:
                days_seen.append(b["day"])
            day_count = len(days_seen) - 1

            active_stop = state["S2"] if state["pyr"] else S1
            if long:
                if active_stop is not None and b["low"] <= active_stop:
                    return finish(active_stop, "stop", b["min"])
                if target is not None and b["high"] >= target:
                    return finish(target, "target", b["min"])
                if b["high"] > E1:
                    went_profit = True
            else:
                if active_stop is not None and b["high"] >= active_stop:
                    return finish(active_stop, "stop", b["min"])
                if target is not None and b["low"] <= target:
                    return finish(target, "target", b["min"])
                if b["low"] < E1:
                    went_profit = True

            gap_day_bar = b["day"] == day0
            after_entry = i > g_idx

            if not state["pyr"] and went_profit and after_entry:
                if rule == "failed_reclaim_open":
                    if gap_day_bar and REGULAR_OPEN <= b["min"] < window_end:
                        ext_w = min(ext_w, b["low"]) if long else max(ext_w, b["high"])
                    if (not evaluated) and gap_day_bar and b["min"] >= window_end:
                        evaluated = True
                        if long and ext_w < float("inf") and ext_w > open_price:
                            commit_add(b["open"], ext_w)
                        elif (not long) and ext_w > float("-inf") and ext_w < open_price:
                            commit_add(b["open"], ext_w)
                elif rule == "ema9_reject":
                    if pend_level is not None:
                        commit_add(b["open"], pend_level)
                        pend_level = None
                    elif ema is not None:
                        if long and b["low"] <= ema and b["close"] > ema and b["low"] > E1:
                            pend_level = b["low"]
                        elif (not long) and b["high"] >= ema and b["close"] < ema and b["high"] < E1:
                            pend_level = b["high"]
                elif rule == "new_extreme_after_window":
                    if gap_day_bar and b["min"] >= window_end:
                        if long and b["high"] > ext_day and pull_ext < float("inf"):
                            commit_add(b["open"], pull_ext)
                        elif (not long) and b["low"] < ext_day and pull_ext > float("-inf"):
                            commit_add(b["open"], pull_ext)
                if state["pyr"] and state["add_min"] is None:
                    state["add_min"] = b["min"]

            ema = b["close"] if ema is None else ema + EMA_ALPHA * (b["close"] - ema)
            if long:
                if b["high"] > ext_day:
                    ext_day, pull_ext = b["high"], float("inf")
                else:
                    pull_ext = min(pull_ext, b["low"])
            else:
                if b["low"] < ext_day:
                    ext_day, pull_ext = b["low"], float("-inf")
                else:
                    pull_ext = max(pull_ext, b["high"])

            if is_reg:
                last_reg_close, last_reg_min = b["close"], b["min"]

            if not carry and b["day"] == day0:
                nxt = bars[i + 1] if i + 1 < len(bars) else None
                if nxt is None or nxt["day"] != day0 or nxt["min"] >= REGULAR_CLOSE:
                    return finish(last_reg_close if last_reg_close is not None else b["close"], "eod",
                                  last_reg_min if last_reg_min is not None else b["min"])
            if carry and day_count > carry_max:
                return finish(last_reg_close if last_reg_close is not None else b["close"], "carry_end",
                              last_reg_min if last_reg_min is not None else b["min"])

        return finish(last_reg_close if last_reg_close is not None else bars[-1]["close"], "carry_end",
                      last_reg_min if last_reg_min is not None else bars[-1]["min"])

    def trade_chart(self, symbol: str, day: str, interval: str = "5min") -> List[Dict]:
        """1- or 5-minute OHLC for one session (premarket + regular + after-hours)."""
        interval = "1min" if interval == "1min" else "5min"
        data = self._fetch_json(
            f"historical-chart/{interval}",
            {"symbol": symbol, "from": day, "to": day, "extended": "true"},
        )
        if not isinstance(data, list):
            return []
        out: List[Dict] = []
        for b in data:
            ts = b.get("date", "")
            if not ts.startswith(day):
                continue
            mn = self._minutes_et(ts)
            if mn is None:
                continue
            try:
                out.append({
                    "t": ts.split(" ")[1][:5],
                    "min": mn,
                    "open": float(b["open"]), "high": float(b["high"]),
                    "low": float(b["low"]), "close": float(b["close"]),
                    "premarket": mn < REGULAR_OPEN or mn >= REGULAR_CLOSE,
                })
            except (KeyError, TypeError, ValueError):
                continue
        out.sort(key=lambda x: x["min"])
        return out

    # ── SPY market-context map ───────────────────────────────────────────────
    def _build_spy_map(self, date_from: str, date_to: str) -> Dict[str, Dict[str, Any]]:
        hist = self._daily_history("SPY", date_from, date_to)
        out: Dict[str, Dict[str, Any]] = {}
        for i in range(1, len(hist)):
            prev, cur = hist[i - 1], hist[i]
            try:
                prev_close = float(prev["close"])
                o = float(cur["open"]); c = float(cur["close"])
                day = cur["date"]
            except (KeyError, TypeError, ValueError):
                continue
            if prev_close <= 0:
                continue
            out[day] = {
                "open_above": o > prev_close,
                "close_up": c > prev_close,
                "open_pct": round((o - prev_close) / prev_close * 100, 2),
                "close_pct": round((c - prev_close) / prev_close * 100, 2),
            }
        return out

    # ── Step 4: aggregation / metrics (side-aware P&L) ───────────────────────
    def _aggregate(self, raw_trades: List[Dict], cfg: Dict, meta: Dict,
                   spy_map: Optional[Dict[str, Dict]] = None) -> Dict[str, Any]:
        spy_map = spy_map or {}
        trades = sorted(raw_trades, key=lambda t: t["date"])
        equity = cfg["portfolio_usd"]
        equity_curve = [round(equity, 2)]
        out_trades: List[Dict] = []
        pnls: List[float] = []
        r_multiples: List[float] = []
        long = cfg["side"] == "long"

        def per_share(entry_p: float, exit_p: float) -> float:
            return (exit_p - entry_p) if long else (entry_p - exit_p)

        for t in trades:
            entry_p, exit_p = t["entry"], t["exit"]
            rps = t["risk_per_share"]

            if cfg["position_sizing"] == "pct_portfolio_risk":
                r_dollars = equity * cfg["pct_portfolio_risk"] / 100.0
            else:
                r_dollars = cfg["fixed_risk_usd"]
            r_dollars = max(r_dollars, 0.01)

            if t.get("pyramided") and t.get("r_multiple") is not None:
                r_mult = t["r_multiple"]
                n1 = r_dollars / rps if (rps and rps > 0) else 0.0
                shares = n1 * (1.0 + t.get("add_size_mult", 0.0))
                pnl = r_mult * r_dollars
            elif rps and rps > 0:
                shares = r_dollars / rps
                pnl = shares * per_share(entry_p, exit_p)
                r_mult = pnl / r_dollars if r_dollars > 0 else 0.0
            else:
                shares = r_dollars / entry_p if entry_p > 0 else 0.0
                pnl = shares * per_share(entry_p, exit_p)
                r_mult = pnl / r_dollars if r_dollars > 0 else 0.0

            equity += pnl

            try:
                wd_idx = datetime.strptime(t["date"], "%Y-%m-%d").weekday()
            except Exception:
                wd_idx = None
            spy = spy_map.get(t["date"])

            pnls.append(pnl)
            r_multiples.append(r_mult)
            equity_curve.append(round(equity, 2))
            out_trades.append({
                **t,
                "shares": round(shares, 2),
                "pnl": round(pnl, 2),
                "r_multiple": round(r_mult, 3),
                "equity": round(equity, 2),
                "weekday_idx": wd_idx,
                "weekday": WEEKDAY_LABELS[wd_idx] if wd_idx is not None else None,
                "spy_open_above": spy["open_above"] if spy else None,
                "spy_close_up": spy["close_up"] if spy else None,
                "spy_open_pct": spy["open_pct"] if spy else None,
                "spy_close_pct": spy["close_pct"] if spy else None,
            })

        stats = self._compute_stats(equity_curve, pnls, r_multiples, cfg, meta)
        analysis = self._compute_analysis(out_trades)
        return {
            **stats,
            "equity_curve": equity_curve,
            "r_multiples": [round(x, 3) for x in r_multiples],
            "trades": out_trades[:500],
            "analysis": analysis,
            "meta": meta,
        }

    def _compute_analysis(self, trades: List[Dict]) -> Dict[str, Any]:
        wins = [t for t in trades if t["pnl"] > 0]
        losses = [t for t in trades if t["pnl"] < 0]

        def share(sub: List[Dict], field: str, want: bool) -> Optional[float]:
            cov = [t for t in sub if t.get(field) is not None]
            if not cov:
                return None
            return round(100.0 * sum(1 for t in cov if t[field] is want) / len(cov), 1)

        weekday: List[Dict[str, Any]] = []
        nwin, nloss = len(wins), len(losses)
        for idx in range(7):
            day_trades = [t for t in trades if t.get("weekday_idx") == idx]
            if not day_trades:
                continue
            w = sum(1 for t in day_trades if t["pnl"] > 0)
            l = sum(1 for t in day_trades if t["pnl"] < 0)
            weekday.append({
                "weekday": WEEKDAY_LABELS[idx],
                "trades": len(day_trades),
                "win_rate_pct": round(100.0 * w / len(day_trades), 1),
                "pct_of_wins": round(100.0 * w / nwin, 1) if nwin else 0.0,
                "pct_of_losses": round(100.0 * l / nloss, 1) if nloss else 0.0,
            })

        spy_coverage = sum(1 for t in trades if t.get("spy_open_above") is not None)
        return {
            "wins_count": nwin,
            "losses_count": nloss,
            "spy_coverage_pct": round(100.0 * spy_coverage / len(trades), 1) if trades else 0.0,
            "spy_open": {
                "wins_above_pct": share(wins, "spy_open_above", True),
                "wins_below_pct": share(wins, "spy_open_above", False),
                "losses_above_pct": share(losses, "spy_open_above", True),
                "losses_below_pct": share(losses, "spy_open_above", False),
            },
            "spy_close": {
                "wins_up_pct": share(wins, "spy_close_up", True),
                "wins_down_pct": share(wins, "spy_close_up", False),
                "losses_up_pct": share(losses, "spy_close_up", True),
                "losses_down_pct": share(losses, "spy_close_up", False),
            },
            "weekday": weekday,
        }

    def _compute_stats(self, equity_curve: List[float], pnls: List[float],
                       r_multiples: List[float], cfg: Dict, meta: Dict) -> Dict[str, Any]:
        n = len(pnls)
        start = cfg["portfolio_usd"]
        final = equity_curve[-1] if equity_curve else start
        if n == 0:
            return {
                "total_trades": 0, "win_rate_pct": 0.0, "avg_rr": 0.0,
                "expected_value_usd": 0.0, "expected_value_r": 0.0,
                "sharpe_ratio": 0.0, "r_squared": 0.0, "max_drawdown_pct": 0.0,
                "profit_factor": 0.0, "total_return_pct": 0.0,
                "avg_win": 0.0, "avg_loss": 0.0,
            }

        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]
        gross_win = sum(wins)
        gross_loss = abs(sum(losses))

        eq = np.asarray(equity_curve, dtype=float)
        rets = np.diff(eq) / eq[:-1]
        rets = rets[np.isfinite(rets)]
        if rets.size > 1 and rets.std() > 0:
            span_years = max(self._span_years(meta), 1e-6)
            trades_per_year = n / span_years
            sharpe = float(rets.mean() / rets.std() * np.sqrt(max(trades_per_year, 1.0)))
        else:
            sharpe = 0.0

        r_squared = self._r_squared(eq)

        peak = -np.inf
        max_dd = 0.0
        for v in eq:
            peak = max(peak, v)
            if peak > 0:
                max_dd = max(max_dd, (peak - v) / peak)

        return {
            "total_trades": n,
            "win_rate_pct": round(100.0 * len(wins) / n, 2),
            "avg_rr": round(float(np.mean(r_multiples)), 3),
            "expected_value_usd": round(float(np.mean(pnls)), 2),
            "expected_value_r": round(float(np.mean(r_multiples)), 3),
            "sharpe_ratio": round(sharpe, 3),
            "r_squared": round(r_squared, 4),
            "max_drawdown_pct": round(100.0 * max_dd, 2),
            "profit_factor": round(gross_win / gross_loss, 3) if gross_loss > 0 else None,
            "total_return_pct": round(100.0 * (final - start) / start, 2) if start > 0 else 0.0,
            "avg_win": round(float(np.mean(wins)), 2) if wins else 0.0,
            "avg_loss": round(float(np.mean(losses)), 2) if losses else 0.0,
        }

    @staticmethod
    def _r_squared(eq: np.ndarray) -> float:
        if eq.size < 3:
            return 0.0
        x = np.arange(eq.size, dtype=float)
        try:
            slope, intercept = np.polyfit(x, eq, 1)
            fit = slope * x + intercept
            ss_res = float(np.sum((eq - fit) ** 2))
            ss_tot = float(np.sum((eq - eq.mean()) ** 2))
            if ss_tot <= 0:
                return 0.0
            return max(0.0, 1.0 - ss_res / ss_tot)
        except Exception:
            return 0.0

    @staticmethod
    def _span_years(meta: Dict) -> float:
        try:
            d0 = datetime.strptime(meta["date_from"], "%Y-%m-%d")
            d1 = datetime.strptime(meta["date_to"], "%Y-%m-%d")
            return max((d1 - d0).days / 365.25, 1e-6)
        except Exception:
            return 1.0

    # ── Optimization (grid sweep over entries/stops/take-profits, 1R-normalized) ──
    _ENTRY_LABELS = {
        "opening_bell": "Opening bell",
        "opening_range_break": "Opening range break",
        "premarket_break": "Premarket break",
    }
    _STOP_LABELS = {
        "premarket_high": "stop PM high", "premarket_low": "stop PM low",
        "one_min_high": "stop 1-min high", "one_min_low": "stop 1-min low",
        "five_min_high": "stop 5-min high", "five_min_low": "stop 5-min low",
        "trailing_pct": "stop trailing",
    }
    _TP_LABELS = {
        "risk_reward": "TP R:R", "premarket_high": "TP PM high", "premarket_low": "TP PM low",
        "yesterday_high": "TP Yest. high", "yesterday_low": "TP Yest. low",
        "yesterday_close": "TP Yest. close",
    }

    @classmethod
    def _config_label(cls, combo: Dict) -> str:
        entry = cls._ENTRY_LABELS.get(combo["entry"], combo["entry"])
        if combo["entry"] == "opening_range_break":
            entry += f" ({combo['orb_minutes']}m)"
        stop = cls._STOP_LABELS.get(combo["stop_loss"], combo["stop_loss"])
        if combo["stop_loss"] == "trailing_pct":
            stop += f" {combo['trailing_pct']}%"
        tp = cls._TP_LABELS.get(combo["take_profit"], combo["take_profit"])
        if combo["take_profit"] == "risk_reward":
            tp += f" {combo['rr_ratio']:g}:1"
        return f"{entry} · {stop} · {tp}"

    @staticmethod
    def _grid(side: str) -> List[Dict]:
        entries = [
            {"entry": "opening_bell", "orb_minutes": 5},
            {"entry": "opening_range_break", "orb_minutes": 1},
            {"entry": "opening_range_break", "orb_minutes": 5},
            {"entry": "opening_range_break", "orb_minutes": 15},
            {"entry": "premarket_break", "orb_minutes": 5},
        ]
        if side == "long":
            stops = [
                {"stop_loss": "premarket_low", "trailing_pct": 10},
                {"stop_loss": "one_min_low", "trailing_pct": 10},
                {"stop_loss": "five_min_low", "trailing_pct": 10},
                {"stop_loss": "trailing_pct", "trailing_pct": 5},
                {"stop_loss": "trailing_pct", "trailing_pct": 10},
            ]
            tps = [
                {"take_profit": "risk_reward", "rr_ratio": 2},
                {"take_profit": "risk_reward", "rr_ratio": 3},
                {"take_profit": "premarket_high", "rr_ratio": 2},
                {"take_profit": "yesterday_high", "rr_ratio": 2},
            ]
        else:
            stops = [
                {"stop_loss": "premarket_high", "trailing_pct": 10},
                {"stop_loss": "one_min_high", "trailing_pct": 10},
                {"stop_loss": "five_min_high", "trailing_pct": 10},
                {"stop_loss": "trailing_pct", "trailing_pct": 5},
                {"stop_loss": "trailing_pct", "trailing_pct": 10},
            ]
            tps = [
                {"take_profit": "risk_reward", "rr_ratio": 2},
                {"take_profit": "risk_reward", "rr_ratio": 3},
                {"take_profit": "premarket_low", "rr_ratio": 2},
                {"take_profit": "yesterday_low", "rr_ratio": 2},
                {"take_profit": "yesterday_close", "rr_ratio": 2},
            ]
        grid = []
        for e in entries:
            for s in stops:
                for t in tps:
                    grid.append({**e, **s, **t})
        return grid

    def _score_config(self, prepared_events: List[Tuple[Dict, Dict]],
                      base_cfg: Dict, overrides: Dict) -> Optional[Dict]:
        cfg = {**base_cfg, **overrides}
        rs: List[float] = []
        for prepared, event in prepared_events:
            tr = self._run_rules(prepared, event, cfg)
            if tr is None:
                continue
            rps = tr.get("risk_per_share")
            if not rps or rps <= 0:
                continue
            if tr.get("pyramided") and tr.get("r_multiple") is not None:
                r = tr["r_multiple"]
            elif cfg["side"] == "long":
                r = (tr["exit"] - tr["entry"]) / rps
            else:
                r = (tr["entry"] - tr["exit"]) / rps
            r = max(min(r, self._R_CAP), -1.5)
            rs.append(r)
        if not rs:
            return None
        wins = sum(1 for r in rs if r > 0)
        combo = {**cfg}
        return {
            "label": self._config_label(combo),
            "entry": cfg["entry"], "orb_minutes": cfg["orb_minutes"],
            "stop_loss": cfg["stop_loss"], "trailing_pct": cfg["trailing_pct"],
            "take_profit": cfg["take_profit"], "rr_ratio": cfg["rr_ratio"],
            "trades": len(rs),
            "total_r": round(float(np.sum(rs)), 2),
            "expectancy_r": round(float(np.mean(rs)), 3),
            "win_rate_pct": round(100.0 * wins / len(rs), 1),
        }

    def _optimize(self, events: List[Dict], base_cfg: Dict,
                  progress: Callable[[int, str], None]) -> Optional[Dict]:
        carry_days = int(base_cfg["carry_max_days"]) if base_cfg["eod_close"] == "carry_next_day" else 0
        sample = events[-1000:] if len(events) > 1000 else events
        prepared_events: List[Tuple[Dict, Dict]] = []
        for ev in sample:
            p = self._prepare_event(ev, carry_days)
            if p is not None:
                prepared_events.append((p, ev))
        if not prepared_events:
            return None

        min_trades = max(10, int(0.05 * len(prepared_events)))
        grid = self._grid(base_cfg["side"])
        results: List[Dict] = []
        for i, overrides in enumerate(grid):
            sc = self._score_config(prepared_events, base_cfg, overrides)
            if sc and sc["trades"] >= min_trades:
                results.append(sc)
            if i % 20 == 0:
                progress(95 + int(4 * i / len(grid)), f"Optimizando {i}/{len(grid)}")
        if not results:
            return None

        baseline = self._score_config(prepared_events, base_cfg, {
            "entry": base_cfg["entry"], "orb_minutes": base_cfg["orb_minutes"],
            "stop_loss": base_cfg["stop_loss"], "trailing_pct": base_cfg["trailing_pct"],
            "take_profit": base_cfg["take_profit"], "rr_ratio": base_cfg["rr_ratio"],
        })

        by_profit = sorted(results, key=lambda r: r["total_r"], reverse=True)
        by_edge = sorted(results, key=lambda r: r["expectancy_r"], reverse=True)
        return {
            "baseline": baseline,
            "best_profit": by_profit[0],
            "best_expectancy": by_edge[0],
            "top": by_profit[:6],
            "sample_size": len(prepared_events),
            "sampled": len(sample) < len(events),
            "min_trades": min_trades,
        }

    # ── Orchestration ────────────────────────────────────────────────────────
    def run_backtest(self, cfg: Dict[str, Any],
                     progress: Callable[[int, str], None]) -> Dict[str, Any]:
        warnings: List[str] = []

        progress(3, "Construyendo universo")
        universe = self._build_universe(cfg)
        if not universe:
            raise RuntimeError("No se obtuvieron tickers del screener (revisa filtros / API key)")
        full_universe = len(universe)
        cap = int(cfg["max_universe"])
        if full_universe > cap:
            warnings.append(
                f"Universo completo: {full_universe} tickers; limitado por seguridad a {cap}. "
                f"Subí 'max_universe' para escanear todos."
            )
            universe = universe[:cap]
        progress(10, f"Universo: {len(universe)}/{full_universe} tickers — escaneando setups")

        # ── Setup scan (concurrent) ──────────────────────────────────────────
        events: List[Dict] = []
        done = 0
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {pool.submit(self._find_setups, sym, cfg): sym for sym in universe}
            for fut in as_completed(futs):
                done += 1
                try:
                    events.extend(fut.result() or [])
                except Exception as e:  # noqa: BLE001
                    logger.debug("[StrategyOneBT] setup scan error %s: %s", futs[fut], e)
                if done % 25 == 0 or done == len(universe):
                    pct = 10 + int(45 * done / max(len(universe), 1))
                    progress(pct, f"Escaneando setups {done}/{len(universe)} — {len(events)} eventos")

        events.sort(key=lambda e: e["date"])
        events_found = len(events)
        if events_found > cfg["max_events"]:
            warnings.append(
                f"{events_found} eventos encontrados; limitado a los {cfg['max_events']} más recientes."
            )
            events = events[-int(cfg["max_events"]):]

        if not events:
            meta = self._meta(cfg, len(universe), 0, 0, 0, warnings)
            return self._aggregate([], cfg, meta, {})

        spy_map = self._build_spy_map(cfg["date_from"], cfg["date_to"])

        # ── Intraday simulation (concurrent fetch + simulate) ─────────────────
        trades: List[Dict] = []
        no_trade = 0
        done = 0
        total = len(events)
        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = {pool.submit(self._simulate_event, ev, cfg): ev for ev in events}
            for fut in as_completed(futs):
                done += 1
                try:
                    res = fut.result()
                    if res:
                        trades.append(res)
                    else:
                        no_trade += 1
                except Exception as e:  # noqa: BLE001
                    no_trade += 1
                    logger.debug("[StrategyOneBT] sim error: %s", e)
                if done % 20 == 0 or done == total:
                    pct = 55 + int(40 * done / max(total, 1))
                    progress(pct, f"Simulando {done}/{total} — {len(trades)} trades")

        progress(94, "Calculando métricas")
        meta = self._meta(cfg, len(universe), events_found, len(trades), no_trade, warnings)
        result = self._aggregate(trades, cfg, meta, spy_map)

        if cfg.get("optimize", True) and trades:
            try:
                progress(95, "Optimizando entries/exits")
                result["optimization"] = self._optimize(events, cfg, progress)
            except Exception as e:  # noqa: BLE001
                logger.warning("[StrategyOneBT] optimize failed: %s", e)
                result["optimization"] = None
        else:
            result["optimization"] = None

        progress(100, "Listo")
        return result

    @staticmethod
    def _meta(cfg: Dict, universe_size: int, events_found: int, trades_taken: int,
              no_trade: int, warnings: List[str]) -> Dict[str, Any]:
        return {
            "universe_size": universe_size,
            "events_found": events_found,
            "trades_taken": trades_taken,
            "no_trade_count": no_trade,
            "date_from": cfg["date_from"],
            "date_to": cfg["date_to"],
            "params": cfg,
            "warnings": warnings,
        }


# ═══════════════════════════════════════════════════════════════════════════
#  Config normalization + public job API
# ═══════════════════════════════════════════════════════════════════════════
_VALID_ENTRIES = ("opening_bell", "opening_range_break", "premarket_break")
_VALID_STOPS = ("premarket_high", "premarket_low", "one_min_high", "one_min_low",
                "five_min_high", "five_min_low", "trailing_pct", "none")
_VALID_TPS = ("risk_reward", "premarket_high", "premarket_low",
              "yesterday_high", "yesterday_low", "yesterday_close")


def _normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    def f(key: str, default: float) -> float:
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    def pick(key: str, valid: Tuple[str, ...], default: str) -> str:
        v = str(raw.get(key, default))
        return v if v in valid else default

    today = datetime.utcnow().date()
    default_from = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    default_to = today.strftime("%Y-%m-%d")

    bucket = str(raw.get("market_cap_bucket", "small")).lower()
    if bucket not in MARKET_CAP_BUCKETS:
        bucket = "small"

    side = str(raw.get("side", "long")).lower()
    if side not in ("long", "short"):
        side = "long"

    color = str(raw.get("prev_day_color", "any")).lower()
    if color not in ("any", "green", "red"):
        color = "any"

    cfg = {
        "side": side,
        "price_min": max(f("price_min", 0.0), 0.0),
        "price_max": max(f("price_max", 50.0), 0.01),
        "market_cap_bucket": bucket,
        "prev_day_color": color,
        "consec_green": int(max(f("consec_green", 0), 0)),
        "consec_red": int(max(f("consec_red", 0), 0)),
        "use_dist_52w": bool(raw.get("use_dist_52w", False)),
        "dist_52w_min_pct": max(f("dist_52w_min_pct", 50.0), 0.0),
        "atr_min": max(f("atr_min", 0.0), 0.0),
        "atr_period": int(max(f("atr_period", 14), 2)),
        "stop_loss": pick("stop_loss", _VALID_STOPS, "premarket_low" if side == "long" else "premarket_high"),
        "trailing_pct": max(f("trailing_pct", 10.0), 0.1),
        "take_profit": pick("take_profit", _VALID_TPS, "risk_reward"),
        "rr_ratio": max(f("rr_ratio", 2.0), 0.1),
        "eod_close": str(raw.get("eod_close", "close_eod")),
        "carry_max_days": int(max(f("carry_max_days", 5), 1)),
        "portfolio_usd": max(f("portfolio_usd", 10000.0), 1.0),
        "position_sizing": str(raw.get("position_sizing", "fixed_risk_usd")),
        "fixed_risk_usd": max(f("fixed_risk_usd", 100.0), 0.01),
        "pct_portfolio_risk": max(f("pct_portfolio_risk", 1.0), 0.01),
        "entry": pick("entry", _VALID_ENTRIES, "opening_bell"),
        "orb_minutes": int(raw.get("orb_minutes", 5) or 5),
        "date_from": str(raw.get("date_from") or default_from),
        "date_to": str(raw.get("date_to") or default_to),
        "max_universe": int(max(f("max_universe", 3000), 1)),
        "max_events": int(max(f("max_events", 3000), 1)),
        "optimize": bool(raw.get("optimize", True)),
        "pyramid": bool(raw.get("pyramid", False)),
        "pyramid_rule": (str(raw.get("pyramid_rule", "failed_reclaim_open"))
                         if str(raw.get("pyramid_rule", "")) in PYRAMID_RULES
                         else "failed_reclaim_open"),
        "pyramid_window_min": int(max(f("pyramid_window_min", 30), 1)),
    }
    return cfg


_ENGINE: Optional[StrategyOneBacktestEngine] = None


def get_strategy_one_backtest_engine() -> StrategyOneBacktestEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = StrategyOneBacktestEngine()
    return _ENGINE


def start_job(raw_config: Dict[str, Any]) -> str:
    """Create a job, launch the backtest on a background thread, return job_id."""
    _prune_jobs()
    cfg = _normalize_config(raw_config)
    job_id = uuid.uuid4().hex[:16]
    _set_job(job_id, status="queued", progress=0, stage="En cola",
             result=None, error=None, created_at=time.time())

    def _run() -> None:
        def progress(pct: int, stage: str) -> None:
            _set_job(job_id, status="running", progress=int(pct), stage=stage)
        try:
            engine = get_strategy_one_backtest_engine()
            result = engine.run_backtest(cfg, progress)
            _set_job(job_id, status="done", progress=100, stage="Listo", result=result)
        except Exception as e:  # noqa: BLE001
            logger.exception("[StrategyOneBT] job %s failed", job_id)
            _set_job(job_id, status="error", error=str(e), stage="Error")

    threading.Thread(target=_run, daemon=True).start()
    return job_id
