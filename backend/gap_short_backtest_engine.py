"""
Gap Short Backtest Engine
=========================

Backtests a *short selling* strategy on small-cap **gap-up** days, simulating the
intraday operation with 1-minute bars (including premarket via FMP ``extended=true``).

This is the first of several planned backtest strategies, so the public surface is a
generic async **job system** (start -> poll status -> result) that a future strategy
can reuse.

Pipeline of a run (see ``run_backtest``):
  1. Build a broad small-cap universe via ``company-screener`` (current market cap).
  2. For each ticker, fetch daily OHLCV (``historical-price-eod/full``) and find days
     that gapped up >= ``gap_pct_min`` with the gap-day open inside the price range.
  3. For each gap event, fetch 1-min extended intraday bars and simulate the chosen
     entry / stop-loss / take-profit / close rules -> one trade (or "no trade").
  4. Aggregate metrics (win rate, avg R:R, expected value, Sharpe, R^2, drawdown ...).

Exposed via POST /backtest/gap-short/start and GET /backtest/gap-short/status/{id}.
GOD MODE only (gated in the frontend /backtest page).

Documented limitations (also surfaced in the UI):
  - Market cap is point-in-time (current) from the screener -> survivorship/look-ahead
    bias in universe selection.
  - Conservative intrabar assumption: if a 1-min bar touches both the short stop (high)
    and target (low), the stop is assumed to fill first.
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

# ── Market cap buckets (USD) ─────────────────────────────────────────────────
MARKET_CAP_BUCKETS: Dict[str, Tuple[float, float]] = {
    "nano":  (0,            50_000_000),
    "micro": (50_000_000,   300_000_000),
    "small": (300_000_000,  2_000_000_000),
    "mid":   (2_000_000_000, 10_000_000_000),
}

TRADING_DAYS_PER_YEAR = 252

# Short weekday labels (Mon..Sun); gap-up trades only land on Mon-Fri.
WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]


# ═══════════════════════════════════════════════════════════════════════════
#  Job registry (in-process; single uvicorn worker is enough for a God Mode tool)
# ═══════════════════════════════════════════════════════════════════════════
_JOBS: Dict[str, Dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SECONDS = 60 * 60  # keep finished jobs around for an hour


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
class GapShortBacktestEngine:
    FMP_BASE = "https://financialmodelingprep.com/stable"

    def __init__(self, api_key: Optional[str] = None) -> None:
        self.version = "1.0"
        self.api_key = api_key or os.environ.get("FMP_API_KEY", "")
        self._session = requests.Session()
        # in-memory per-process cache of daily history keyed by symbol
        self._daily_cache: Dict[str, List[Dict]] = {}
        self._daily_cache_lock = threading.Lock()
        # prepared-event cache (fetched intraday bars) → makes the optimization grid cheap
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
        logger.warning("[GapShortBT] FMP fetch failed (%s): %s", endpoint, last_err)
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

    # ── Step 1: universe ─────────────────────────────────────────────────────
    def _build_universe(self, cfg: Dict[str, Any]) -> List[str]:
        lo, hi = MARKET_CAP_BUCKETS.get(cfg["market_cap_bucket"], (0, 10_000_000_000))
        params = {
            "marketCapMoreThan": int(lo),
            "marketCapLowerThan": int(hi),
            "priceLowerThan": cfg["price_max"],
            "isActivelyTrading": "true",
            "isEtf": "false",
            "isFund": "false",
            # request well above any real bucket size so FMP returns the FULL universe;
            # the optional safety cap is applied (with a warning) in run_backtest.
            "limit": 10000,
        }
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

    # ── Step 2: daily history + gap detection ────────────────────────────────
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
        # ascending by date
        hist = sorted(hist, key=lambda b: b.get("date", ""))
        with self._daily_cache_lock:
            self._daily_cache[key] = hist
        return hist

    def _find_gap_events(self, symbol: str, cfg: Dict[str, Any]) -> List[Dict]:
        hist = self._daily_history(symbol, cfg["date_from"], cfg["date_to"])
        events: List[Dict] = []
        thr = cfg["gap_pct_min"] / 100.0
        for i in range(1, len(hist)):
            prev, cur = hist[i - 1], hist[i]
            try:
                prev_close = float(prev["close"])
                cur_open = float(cur["open"])
            except (KeyError, TypeError, ValueError):
                continue
            if prev_close <= 0 or cur_open <= 0:
                continue
            gap = (cur_open - prev_close) / prev_close
            if gap < thr:
                continue
            if not (cfg["price_min"] <= cur_open <= cfg["price_max"]):
                continue
            events.append({
                "symbol": symbol,
                "date": cur["date"],
                "gap_pct": round(gap * 100, 2),
                "prev_close": prev_close,
                "prev_high": float(prev.get("high") or 0),
            })
        return events

    # ── Step 3: intraday fetch + simulation ──────────────────────────────────
    def _intraday_day(self, symbol: str, day: str) -> List[Dict]:
        """Fetch one calendar day of 1-min extended bars (premarket + regular + after).

        NOTE: FMP's 1-min historical caps a multi-day range to ~the last 3 days, so for
        multi-day (carry) walks we must fetch one day at a time and concatenate.
        """
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

    def _intraday_bars(self, symbol: str, gap_day: str, carry_days: int) -> List[Dict]:
        """Gap-day bars, plus up to ``carry_days`` subsequent trading days (day-by-day)."""
        bars = self._intraday_day(symbol, gap_day)
        if not bars or carry_days <= 0:
            return bars
        cur = datetime.strptime(gap_day, "%Y-%m-%d")
        collected = 0
        probes = 0
        while collected < carry_days and probes < carry_days * 3 + 5:
            cur += timedelta(days=1)
            probes += 1
            day_str = cur.strftime("%Y-%m-%d")
            day_bars = self._intraday_day(symbol, day_str)
            if day_bars:
                bars.extend(day_bars)
                collected += 1
        bars.sort(key=lambda x: x["date"])
        return bars

    def _prepare_event(self, event: Dict, carry_days: int) -> Optional[Dict]:
        """Fetch + split intraday bars once for an event (cached). The result feeds
        ``_run_rules`` for ANY entry/stop/tp config — this is what makes the
        optimization grid cheap (fetch once, simulate many combos in memory)."""
        symbol, gap_day = event["symbol"], self._day_of(event["date"])
        ckey = f"{symbol}:{gap_day}:{carry_days}"
        with self._event_cache_lock:
            cached = self._event_cache.get(ckey)
        if cached is not None:
            return cached if cached.get("ok") else None

        bars = self._intraday_bars(symbol, gap_day, carry_days)
        prepared: Dict[str, Any] = {"ok": False}
        if bars:
            day_bars = [b for b in bars if b["day"] == gap_day]
            pre = [b for b in day_bars if b["min"] < REGULAR_OPEN]
            reg = [b for b in day_bars if REGULAR_OPEN <= b["min"] < REGULAR_CLOSE]
            if len(reg) >= 2:
                prepared = {
                    "ok": True,
                    "symbol": symbol,
                    "gap_day": gap_day,
                    "bars": bars,
                    "reg": reg,
                    "pmh": max((b["high"] for b in pre), default=None),
                    "pml": min((b["low"] for b in pre), default=None),
                }
        with self._event_cache_lock:
            self._event_cache[ckey] = prepared
        return prepared if prepared.get("ok") else None

    def _run_rules(self, prepared: Dict, event: Dict, cfg: Dict[str, Any]) -> Optional[Dict]:
        """Apply entry/stop/take-profit/walk rules to a prepared event. Pure compute."""
        symbol, gap_day = prepared["symbol"], prepared["gap_day"]
        bars, reg = prepared["bars"], prepared["reg"]
        pmh, pml = prepared["pmh"], prepared["pml"]

        # ── Entry ────────────────────────────────────────────────────────────
        entry = self._resolve_entry(cfg, reg, pmh)
        if entry is None:
            return None
        entry_idx, entry_price, stop_override = entry

        entry_bar = reg[entry_idx]
        g_idx = next((i for i, b in enumerate(bars) if b["date"] == entry_bar["date"]), None)
        if g_idx is None:
            return None

        trailing = cfg["stop_loss"] == "trailing_pct"
        stop_level = self._resolve_stop(cfg, reg, pmh, entry_price, stop_override)
        target = self._resolve_target(cfg, pml, event, entry_price, stop_level)
        risk_per_share = (stop_level - entry_price) if (stop_level is not None) else None

        exit_price, reason = self._walk(
            bars, g_idx, gap_day, entry_price, stop_level, target, cfg, trailing,
        )

        return {
            "symbol": symbol,
            "date": gap_day,
            "gap_pct": event["gap_pct"],
            "entry": round(entry_price, 4),
            "exit": round(exit_price, 4),
            "stop": round(stop_level, 4) if stop_level is not None else None,
            "target": round(target, 4) if target is not None else None,
            "risk_per_share": round(risk_per_share, 4) if risk_per_share else None,
            "reason": reason,
        }

    def _simulate_event(self, event: Dict, cfg: Dict[str, Any]) -> Optional[Dict]:
        carry_days = int(cfg["carry_max_days"]) if cfg["eod_close"] == "carry_next_day" else 0
        prepared = self._prepare_event(event, carry_days)
        if prepared is None:
            return None
        return self._run_rules(prepared, event, cfg)

    def _resolve_entry(self, cfg: Dict, reg: List[Dict], pmh: Optional[float]
                       ) -> Optional[Tuple[int, float, Optional[float]]]:
        """Return (entry_index_in_reg, entry_price, stop_override) or None (no trade)."""
        mode = cfg["entry"]
        if mode == "opening_bell":
            return 0, reg[0]["open"], None

        if mode == "second_red_after_green":
            b0 = reg[0]
            if b0["close"] > b0["open"] and len(reg) > 1:  # first bar green
                return 1, reg[1]["open"], None
            return None

        if mode == "opening_range_break":
            n = int(cfg["orb_minutes"])
            if len(reg) <= n:
                return None
            or_low = min(b["low"] for b in reg[:n])
            for i in range(n, len(reg)):
                if reg[i]["low"] < or_low:
                    # fill at the break level, or at the open if it gapped below
                    price = min(or_low, reg[i]["open"])
                    return i, price, None
            return None

        if mode == "failed_premarket_high_break":
            if pmh is None or pmh <= 0:
                return None
            exceeded = False
            peak = pmh
            for i in range(len(reg)):
                b = reg[i]
                if b["high"] > pmh:
                    exceeded = True
                    peak = max(peak, b["high"])
                if exceeded and b["close"] < pmh and i + 1 < len(reg):
                    # enter on the next bar's open; stop override = peak above PMH
                    return i + 1, reg[i + 1]["open"], peak
            return None

        return None

    def _resolve_stop(self, cfg: Dict, reg: List[Dict], pmh: Optional[float],
                      entry_price: float, stop_override: Optional[float]) -> Optional[float]:
        mode = cfg["stop_loss"]
        if stop_override is not None and mode == "premarket_high":
            return stop_override
        if mode == "none":
            return None
        if mode == "trailing_pct":
            return entry_price * (1 + cfg["trailing_pct"] / 100.0)
        if mode == "premarket_high":
            if pmh is not None and pmh > entry_price:
                return pmh
            # fallback when no premarket data / pmh below entry -> first-bar high
            return max(reg[0]["high"], entry_price * 1.001)
        if mode == "one_min_high":
            return max(reg[0]["high"], entry_price * 1.001)
        return None

    def _resolve_target(self, cfg: Dict, pml: Optional[float], event: Dict,
                        entry_price: float, stop_level: Optional[float]) -> Optional[float]:
        mode = cfg["take_profit"]
        if mode == "premarket_low":
            return pml if (pml is not None and pml < entry_price) else None
        if mode == "yesterday_high":
            ph = event.get("prev_high")
            return ph if (ph and ph < entry_price) else None
        if mode == "yesterday_close":
            pc = event.get("prev_close")
            return pc if (pc and pc < entry_price) else None
        if mode == "risk_reward":
            if stop_level is None:
                return None  # R:R needs a defined stop (disabled in UI otherwise)
            risk = stop_level - entry_price
            return entry_price - cfg["rr_ratio"] * risk
        return None

    def _walk(self, bars: List[Dict], g_idx: int, gap_day: str, entry_price: float,
              stop_level: Optional[float], target: Optional[float], cfg: Dict,
              trailing: bool) -> Tuple[float, str]:
        """Walk bars from the entry bar; return (exit_price, reason)."""
        carry = cfg["eod_close"] == "carry_next_day"
        carry_max = int(cfg["carry_max_days"])
        lowest = entry_price
        trail_pct = cfg.get("trailing_pct", 0) / 100.0
        days_seen: List[str] = []
        last_reg_close: Optional[float] = None

        for i in range(g_idx, len(bars)):
            b = bars[i]
            is_reg = REGULAR_OPEN <= b["min"] < REGULAR_CLOSE

            # day-budget bookkeeping (count distinct trading days walked)
            if b["day"] not in days_seen:
                days_seen.append(b["day"])
            day_count = len(days_seen) - 1  # 0 on the gap day

            # current stop (trailing uses lowest seen on PRIOR bars -> conservative)
            cur_stop = (lowest * (1 + trail_pct)) if trailing else stop_level

            # conservative intrabar order: short stop (high) before target (low)
            if cur_stop is not None and b["high"] >= cur_stop:
                return cur_stop, "stop"
            if target is not None and b["low"] <= target:
                return target, "target"

            if trailing:
                lowest = min(lowest, b["low"])
            if is_reg:
                last_reg_close = b["close"]

            # end-of-day handling for the non-carry case
            if not carry and b["day"] == gap_day:
                nxt = bars[i + 1] if i + 1 < len(bars) else None
                if nxt is None or nxt["day"] != gap_day or nxt["min"] >= REGULAR_CLOSE:
                    return (last_reg_close if last_reg_close is not None else b["close"]), "eod"

            if carry and day_count > carry_max:
                return (last_reg_close if last_reg_close is not None else b["close"]), "carry_end"

        # ran out of data
        return (last_reg_close if last_reg_close is not None else bars[-1]["close"]), "carry_end"

    # ── SPY market-context map ───────────────────────────────────────────────
    def _build_spy_map(self, date_from: str, date_to: str) -> Dict[str, Dict[str, Any]]:
        """Per trading day SPY context: how it opened vs the prior close and how it
        closed vs the prior close. Returns { 'YYYY-MM-DD': {open_above, close_up, ...} }."""
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
                "open_above": o > prev_close,        # gapped up vs prior close
                "close_up": c > prev_close,          # finished above prior close
                "open_pct": round((o - prev_close) / prev_close * 100, 2),
                "close_pct": round((c - prev_close) / prev_close * 100, 2),
            }
        return out

    # ── Step 4: aggregation / metrics ────────────────────────────────────────
    def _aggregate(self, raw_trades: List[Dict], cfg: Dict, meta: Dict,
                   spy_map: Optional[Dict[str, Dict]] = None) -> Dict[str, Any]:
        spy_map = spy_map or {}
        trades = sorted(raw_trades, key=lambda t: t["date"])
        equity = cfg["portfolio_usd"]
        equity_curve = [round(equity, 2)]
        out_trades: List[Dict] = []
        pnls: List[float] = []
        r_multiples: List[float] = []

        for t in trades:
            entry_p, exit_p = t["entry"], t["exit"]
            rps = t["risk_per_share"]  # stop - entry (>0) or None

            # dollars risked this trade (R)
            if cfg["position_sizing"] == "pct_portfolio_risk":
                r_dollars = equity * cfg["pct_portfolio_risk"] / 100.0
            else:
                r_dollars = cfg["fixed_risk_usd"]
            r_dollars = max(r_dollars, 0.01)

            # shares
            if rps and rps > 0:
                shares = r_dollars / rps
            else:
                # no stop -> size R as a notional position (documented fallback)
                shares = r_dollars / entry_p if entry_p > 0 else 0.0

            pnl = shares * (entry_p - exit_p)  # short P&L
            equity += pnl
            r_mult = pnl / r_dollars if r_dollars > 0 else 0.0

            # weekday + SPY market context for the trade day
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

    # ── Distribution analysis (SPY context + weekday) ────────────────────────
    def _compute_analysis(self, trades: List[Dict]) -> Dict[str, Any]:
        wins = [t for t in trades if t["pnl"] > 0]
        losses = [t for t in trades if t["pnl"] < 0]

        def share(sub: List[Dict], field: str, want: bool) -> Optional[float]:
            cov = [t for t in sub if t.get(field) is not None]
            if not cov:
                return None
            return round(100.0 * sum(1 for t in cov if t[field] is want) / len(cov), 1)

        # weekday breakdown (only days that actually appear)
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

        # equity-curve based returns
        eq = np.asarray(equity_curve, dtype=float)
        rets = np.diff(eq) / eq[:-1]
        rets = rets[np.isfinite(rets)]
        if rets.size > 1 and rets.std() > 0:
            # annualize by trades-per-year from the data span
            span_years = max(self._span_years(meta), 1e-6)
            trades_per_year = n / span_years
            sharpe = float(rets.mean() / rets.std() * np.sqrt(max(trades_per_year, 1.0)))
        else:
            sharpe = 0.0

        # R^2 of the equity curve vs a straight line (consistency of returns)
        r_squared = self._r_squared(eq)

        # max drawdown
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
        "second_red_after_green": "2ª barra tras verde",
        "failed_premarket_high_break": "Fallo de premarket high",
    }
    _STOP_LABELS = {
        "premarket_high": "stop Pre-market high",
        "one_min_high": "stop 1-min high",
        "trailing_pct": "stop trailing",
    }
    _TP_LABELS = {
        "risk_reward": "TP R:R",
        "premarket_low": "TP Pre-market low",
        "yesterday_close": "TP Yesterday close",
        "yesterday_high": "TP Yesterday high",
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
    def _grid() -> List[Dict]:
        """Candidate entry × stop × take-profit combos. Only risk-DEFINED stops are
        included so every combo keeps exactly 1R of risk per trade."""
        entries = [
            {"entry": "opening_bell", "orb_minutes": 5},
            {"entry": "opening_range_break", "orb_minutes": 1},
            {"entry": "opening_range_break", "orb_minutes": 5},
            {"entry": "opening_range_break", "orb_minutes": 15},
            {"entry": "second_red_after_green", "orb_minutes": 5},
            {"entry": "failed_premarket_high_break", "orb_minutes": 5},
        ]
        stops = [
            {"stop_loss": "premarket_high", "trailing_pct": 10},
            {"stop_loss": "one_min_high", "trailing_pct": 10},
            {"stop_loss": "trailing_pct", "trailing_pct": 5},
            {"stop_loss": "trailing_pct", "trailing_pct": 10},
        ]
        tps = [
            {"take_profit": "risk_reward", "rr_ratio": 2},
            {"take_profit": "risk_reward", "rr_ratio": 3},
            {"take_profit": "premarket_low", "rr_ratio": 2},
            {"take_profit": "yesterday_close", "rr_ratio": 2},
            {"take_profit": "yesterday_high", "rr_ratio": 2},
        ]
        grid = []
        for e in entries:
            for s in stops:
                for t in tps:
                    grid.append({**e, **s, **t})
        return grid

    # Per-trade R is winsorized so a few tiny-stop / far-target outliers (e.g. a
    # 1-min stop that lets a runner reach yesterday's close at +40R) don't dominate
    # the ranking and recommend a fragile, low-win-rate "lottery" config.
    _R_CAP = 10.0

    def _score_config(self, prepared_events: List[Tuple[Dict, Dict]],
                      base_cfg: Dict, overrides: Dict) -> Optional[Dict]:
        """Run one config over all prepared events; return 1R-normalized stats."""
        cfg = {**base_cfg, **overrides}
        rs: List[float] = []
        for prepared, event in prepared_events:
            tr = self._run_rules(prepared, event, cfg)
            if tr is None:
                continue
            rps = tr.get("risk_per_share")
            if not rps or rps <= 0:
                continue  # need a defined stop to express risk in R
            r = (tr["entry"] - tr["exit"]) / rps  # short R-multiple, exactly 1R risked
            r = max(min(r, self._R_CAP), -1.5)    # winsorize for robustness
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
        # bound grid runtime: reuse cached prepared events (already fetched in main run)
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
        grid = self._grid()
        results: List[Dict] = []
        for i, overrides in enumerate(grid):
            sc = self._score_config(prepared_events, base_cfg, overrides)
            if sc and sc["trades"] >= min_trades:
                results.append(sc)
            if i % 20 == 0:
                progress(95 + int(4 * i / len(grid)), f"Optimizando {i}/{len(grid)}")
        if not results:
            return None

        # baseline = the user's own chosen config
        baseline = self._score_config(prepared_events, base_cfg, {
            "entry": base_cfg["entry"], "orb_minutes": base_cfg["orb_minutes"],
            "stop_loss": base_cfg["stop_loss"], "trailing_pct": base_cfg["trailing_pct"],
            "take_profit": base_cfg["take_profit"], "rr_ratio": base_cfg["rr_ratio"],
        })

        by_profit = sorted(results, key=lambda r: r["total_r"], reverse=True)
        by_edge = sorted(results, key=lambda r: r["expectancy_r"], reverse=True)
        return {
            "baseline": baseline,                    # may be None if user used stop=none
            "best_profit": by_profit[0],             # max total R (profit, 1R risk)
            "best_expectancy": by_edge[0],           # best edge per trade
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
        progress(10, f"Universo: {len(universe)}/{full_universe} tickers — escaneando gaps")

        # ── Gap scan (concurrent) ────────────────────────────────────────────
        events: List[Dict] = []
        done = 0
        with ThreadPoolExecutor(max_workers=10) as pool:
            futs = {pool.submit(self._find_gap_events, sym, cfg): sym for sym in universe}
            for fut in as_completed(futs):
                done += 1
                try:
                    events.extend(fut.result() or [])
                except Exception as e:  # noqa: BLE001
                    logger.debug("[GapShortBT] gap scan error %s: %s", futs[fut], e)
                if done % 25 == 0 or done == len(universe):
                    pct = 10 + int(45 * done / max(len(universe), 1))
                    progress(pct, f"Escaneando gaps {done}/{len(universe)} — {len(events)} eventos")

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

        # SPY market-context for the date range (one fetch, cached)
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
                    logger.debug("[GapShortBT] sim error: %s", e)
                if done % 20 == 0 or done == total:
                    pct = 55 + int(40 * done / max(total, 1))
                    progress(pct, f"Simulando {done}/{total} — {len(trades)} trades")

        progress(94, "Calculando métricas")
        meta = self._meta(cfg, len(universe), events_found, len(trades), no_trade, warnings)
        result = self._aggregate(trades, cfg, meta, spy_map)

        # ── Optimization sweep (1R-normalized) ───────────────────────────────
        if cfg.get("optimize", True) and trades:
            try:
                progress(95, "Optimizando entries/exits")
                result["optimization"] = self._optimize(events, cfg, progress)
            except Exception as e:  # noqa: BLE001
                logger.warning("[GapShortBT] optimize failed: %s", e)
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
def _normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    def f(key: str, default: float) -> float:
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    today = datetime.utcnow().date()
    default_from = (today - timedelta(days=365)).strftime("%Y-%m-%d")
    default_to = today.strftime("%Y-%m-%d")

    bucket = str(raw.get("market_cap_bucket", "micro")).lower()
    if bucket not in MARKET_CAP_BUCKETS:
        bucket = "micro"

    cfg = {
        "gap_pct_min": max(f("gap_pct_min", 20.0), 1.0),
        "price_min": max(f("price_min", 0.0), 0.0),
        "price_max": max(f("price_max", 20.0), 0.01),
        "market_cap_bucket": bucket,
        "stop_loss": str(raw.get("stop_loss", "premarket_high")),
        "trailing_pct": max(f("trailing_pct", 10.0), 0.1),
        "take_profit": str(raw.get("take_profit", "risk_reward")),
        "rr_ratio": max(f("rr_ratio", 2.0), 0.1),
        "eod_close": str(raw.get("eod_close", "close_eod")),
        "carry_max_days": int(max(f("carry_max_days", 5), 1)),
        "portfolio_usd": max(f("portfolio_usd", 10000.0), 1.0),
        "position_sizing": str(raw.get("position_sizing", "fixed_risk_usd")),
        "fixed_risk_usd": max(f("fixed_risk_usd", 100.0), 0.01),
        "pct_portfolio_risk": max(f("pct_portfolio_risk", 1.0), 0.01),
        "entry": str(raw.get("entry", "opening_bell")),
        "orb_minutes": int(raw.get("orb_minutes", 5) or 5),
        "date_from": str(raw.get("date_from") or default_from),
        "date_to": str(raw.get("date_to") or default_to),
        "max_universe": int(max(f("max_universe", 6000), 1)),
        "max_events": int(max(f("max_events", 3000), 1)),
        "optimize": bool(raw.get("optimize", True)),
    }
    return cfg


_ENGINE: Optional[GapShortBacktestEngine] = None


def get_gap_short_backtest_engine() -> GapShortBacktestEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = GapShortBacktestEngine()
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
            engine = get_gap_short_backtest_engine()
            result = engine.run_backtest(cfg, progress)
            _set_job(job_id, status="done", progress=100, stage="Listo", result=result)
        except Exception as e:  # noqa: BLE001
            logger.exception("[GapShortBT] job %s failed", job_id)
            _set_job(job_id, status="error", error=str(e), stage="Error")

    threading.Thread(target=_run, daemon=True).start()
    return job_id
