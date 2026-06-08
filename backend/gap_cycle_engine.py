"""
Gap Cycle Engine
================

Scans a broad small/mid-cap US universe for bullish gap-ups (>= threshold, default 20%)
over the last 7 (weekly) and 30 (monthly) calendar days, and classifies each gap day's
intraday behaviour into one of three regimes — plus an "other" fallback bucket.

Classification rules (US Eastern market time, the gap day):
  - RECLAIM : price stays below the open until 1 PM, but closes above the open.
  - FADE    : high-of-day occurs before 11 AM, then bleeds down, closing below the open
              and near the lows of the day.
  - CHOPPY  : multiple highs/lows during the day, price closes near the open.
  - OTHER   : anything not matching the above (e.g. a runner that kept climbing all day).

Used by POST /gap-cycle/scan in main.py and surfaced in the Market Pulse "Gap Cycle"
section (GODMODE).
"""

from __future__ import annotations

import os
import json
import time
import logging
import sqlite3
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# ── Tunable classification constants ────────────────────────────────────────
OPEN_TOL = 0.003          # 0.3% tolerance around the open line
NEAR_LOWS_FRAC = 0.25     # close within bottom 25% of [low, high] range → "near lows"
CHOPPY_BAND = 0.03        # |close - open| / open <= 3% → close "near open"
CHOPPY_MIN_CROSSES = 3    # >= 3 crossings of the open line → "multiple highs/lows"

# ── Time gates (minutes since midnight ET) ──────────────────────────────────
MIN_11AM = 11 * 60        # 660
MIN_1PM = 13 * 60         # 780

CATEGORIES = ("reclaim", "fade", "choppy", "other")


class GapCycleEngine:
    FMP_BASE = "https://financialmodelingprep.com/stable"

    def __init__(self, api_key: Optional[str] = None, db_path: str = "sentiment.db",
                 cache_ttl: int = 270):
        self.version = "1.0"
        self.api_key = api_key or os.environ.get("FMP_API_KEY", "")
        self._session = requests.Session()
        self._db_path = db_path
        self._cache_ttl = cache_ttl  # in-memory TTL (s); kept just under the 5-min refresh
        self._mem: Dict[str, Any] = {}   # signature -> (ts, payload)
        self._init_db()

    # ── FMP helpers ─────────────────────────────────────────────────────────
    def _fetch_json(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        params = dict(params or {})
        params["apikey"] = self.api_key
        try:
            resp = self._session.get(f"{self.FMP_BASE}/{endpoint}", params=params, timeout=20)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"[GapCycle] FMP fetch failed ({endpoint}): {e}")
            return None

    # ── SQLite cache ──────────────────────────────────────────────────────────
    def _init_db(self):
        try:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS gap_cycle_cache (
                        signature TEXT PRIMARY KEY,
                        ts        TEXT NOT NULL,
                        payload   TEXT NOT NULL
                    )
                    """
                )
                conn.commit()
        except Exception as e:
            logger.warning(f"[GapCycle] DB init failed: {e}")

    def _cache_get(self, signature: str) -> Optional[Dict]:
        # in-memory first
        hit = self._mem.get(signature)
        if hit and (time.time() - hit[0]) < self._cache_ttl:
            payload = dict(hit[1])
            payload["cached"] = True
            return payload
        # then SQLite (survives process restarts within TTL)
        try:
            with sqlite3.connect(self._db_path) as conn:
                row = conn.execute(
                    "SELECT ts, payload FROM gap_cycle_cache WHERE signature = ?",
                    (signature,),
                ).fetchone()
            if row:
                ts = datetime.fromisoformat(row[0])
                if (datetime.now() - ts).total_seconds() < self._cache_ttl:
                    payload = json.loads(row[1])
                    payload["cached"] = True
                    self._mem[signature] = (time.time(), payload)
                    return payload
        except Exception as e:
            logger.warning(f"[GapCycle] cache_get failed: {e}")
        return None

    def _cache_set(self, signature: str, payload: Dict):
        self._mem[signature] = (time.time(), payload)
        try:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO gap_cycle_cache (signature, ts, payload) VALUES (?,?,?)",
                    (signature, datetime.now().isoformat(), json.dumps(payload)),
                )
                conn.commit()
        except Exception as e:
            logger.warning(f"[GapCycle] cache_set failed: {e}")

    # ── Universe ──────────────────────────────────────────────────────────────
    def _build_universe(self, max_symbols: int, min_price: float,
                        min_volume: float) -> List[str]:
        """Broad small/mid-cap US universe via FMP company-screener, sorted by volume."""
        rows: List[Dict] = []
        for exchange in ("NASDAQ", "NYSE", "AMEX"):
            data = self._fetch_json(
                "company-screener",
                {
                    "priceMoreThan": min_price,
                    "volumeMoreThan": int(min_volume),
                    "marketCapLowerThan": 50_000_000_000,   # exclude mega-caps
                    "country": "US",
                    "exchange": exchange,
                    "isActivelyTrading": "true",
                    "isEtf": "false",
                    "isFund": "false",
                    "limit": 3000,
                },
            )
            if isinstance(data, list):
                rows.extend(data)

        # Dedupe by symbol, drop non-common tickers, sort by volume desc
        seen = set()
        clean: List[Dict] = []
        for r in rows:
            sym = (r.get("symbol") or "").strip().upper()
            if not sym or sym in seen or any(c in sym for c in (".", "-", "/")):
                continue
            seen.add(sym)
            clean.append(r)
        clean.sort(key=lambda r: float(r.get("volume") or 0), reverse=True)
        return [r["symbol"] for r in clean[:max_symbols]]

    # ── Daily gap detection ─────────────────────────────────────────────────
    def _detect_gap_days(self, symbol: str, gap_threshold: float,
                        since_date: str) -> List[Dict]:
        """Return gap-up days within [since_date, today] where open >= prevClose*(1+thr)."""
        data = self._fetch_json(
            "historical-price-eod/full",
            {"symbol": symbol, "from": since_date},
        )
        if isinstance(data, dict) and "historical" in data:
            data = data["historical"]
        if not isinstance(data, list) or len(data) < 2:
            return []

        data = sorted(data, key=lambda d: d.get("date", ""))
        gaps: List[Dict] = []
        for i in range(1, len(data)):
            prev_close = float(data[i - 1].get("close") or 0)
            d_open = float(data[i].get("open") or 0)
            if prev_close <= 0 or d_open <= 0:
                continue
            gap_pct = (d_open - prev_close) / prev_close
            if gap_pct >= gap_threshold:
                gaps.append({
                    "symbol": symbol,
                    "date": data[i].get("date", "")[:10],
                    "gapPct": round(gap_pct * 100, 2),
                    "prevClose": round(prev_close, 4),
                    "open": round(d_open, 4),
                    "dayHigh": round(float(data[i].get("high") or 0), 4),
                    "dayLow": round(float(data[i].get("low") or 0), 4),
                    "close": round(float(data[i].get("close") or 0), 4),
                })
        return gaps

    # ── Intraday classification ─────────────────────────────────────────────
    @staticmethod
    def _minutes_et(bar_date: str) -> Optional[int]:
        """Minutes-since-midnight from an FMP intraday timestamp 'YYYY-MM-DD HH:MM:SS' (ET)."""
        try:
            t = bar_date.split(" ")[1]
            hh, mm = t.split(":")[0:2]
            return int(hh) * 60 + int(mm)
        except Exception:
            return None

    def _classify(self, gap: Dict) -> str:
        """Classify a gap day's intraday behaviour. Falls back to daily OHLC if no intraday."""
        symbol, date = gap["symbol"], gap["date"]
        bars = self._fetch_json(
            "historical-chart/5min",
            {"symbol": symbol, "from": date, "to": date},
        )

        if not isinstance(bars, list) or len(bars) < 5:
            return self._classify_daily(gap)

        # FMP returns newest-first; sort ascending by timestamp
        bars = sorted(bars, key=lambda b: b.get("date", ""))
        opens, highs, lows, closes, mins = [], [], [], [], []
        for b in bars:
            m = self._minutes_et(b.get("date", ""))
            if m is None:
                continue
            opens.append(float(b.get("open") or 0))
            highs.append(float(b.get("high") or 0))
            lows.append(float(b.get("low") or 0))
            closes.append(float(b.get("close") or 0))
            mins.append(m)
        if len(closes) < 5:
            return self._classify_daily(gap)

        day_open = opens[0]
        day_close = closes[-1]
        if day_open <= 0:
            return self._classify_daily(gap)

        hod = max(highs)
        lod = min(lows)
        hod_min = mins[highs.index(hod)]
        rng = hod - lod

        # Reference prices at the 11 AM / 1 PM gates (last bar at/before the gate)
        price_11am = next((closes[i] for i in range(len(mins) - 1, -1, -1) if mins[i] <= MIN_11AM), day_open)
        price_1pm = next((closes[i] for i in range(len(mins) - 1, -1, -1) if mins[i] <= MIN_1PM), day_open)
        morning_low = min((lows[i] for i in range(len(mins)) if mins[i] <= MIN_1PM), default=lod)

        # Crossings of the open line (oscillation count) using bar closes
        crosses = 0
        prev_side = None
        for c in closes:
            side = 1 if c > day_open * (1 + OPEN_TOL) else (-1 if c < day_open * (1 - OPEN_TOL) else 0)
            if side != 0 and prev_side is not None and side != prev_side:
                crosses += 1
            if side != 0:
                prev_side = side

        # RECLAIM: stayed below open until 1 PM, closed green
        if (day_close > day_open * (1 + OPEN_TOL)
                and price_1pm < day_open
                and morning_low < day_open):
            return "reclaim"

        # FADE: topped before 11 AM, closed red and near the lows
        if (hod_min < MIN_11AM
                and day_close < day_open * (1 - OPEN_TOL)
                and rng > 0
                and (day_close - lod) <= NEAR_LOWS_FRAC * rng):
            return "fade"

        # CHOPPY: closed near the open with multiple crossings
        if abs(day_close - day_open) / day_open <= CHOPPY_BAND and crosses >= CHOPPY_MIN_CROSSES:
            return "choppy"

        return "other"

    def _classify_daily(self, gap: Dict) -> str:
        """Fallback classification from daily OHLC only (no intraday timing)."""
        o, h, l, c = gap["open"], gap["dayHigh"], gap["dayLow"], gap["close"]
        if o <= 0:
            return "other"
        rng = h - l
        if c > o * (1 + OPEN_TOL) and l < o:
            return "reclaim"
        if c < o * (1 - OPEN_TOL) and rng > 0 and (c - l) <= NEAR_LOWS_FRAC * rng:
            return "fade"
        if abs(c - o) / o <= CHOPPY_BAND:
            return "choppy"
        return "other"

    # ── Aggregation ───────────────────────────────────────────────────────────
    @staticmethod
    def _aggregate(stocks: List[Dict], window: int) -> Dict:
        total = len(stocks)
        cats: Dict[str, Dict[str, float]] = {}
        for cat in CATEGORIES:
            count = sum(1 for s in stocks if s["classification"] == cat)
            cats[cat] = {
                "count": count,
                "pct": round(100.0 * count / total, 1) if total else 0.0,
            }
        ordered = sorted(stocks, key=lambda s: (s["date"], s["gapPct"]), reverse=True)
        return {"window": window, "totalGappers": total, "categories": cats, "stocks": ordered}

    # ── Orchestration ─────────────────────────────────────────────────────────
    def scan(self, gap_threshold_pct: float = 20.0, window_short: int = 7,
             window_long: int = 30, max_symbols: int = 2000, min_price: float = 1.0,
             min_volume: float = 200_000, max_workers: int = 32,
             refresh: bool = False) -> Dict[str, Any]:
        gap_threshold = gap_threshold_pct / 100.0
        today = datetime.now().strftime("%Y-%m-%d")
        signature = f"gc:{today}:{gap_threshold_pct}:{window_short}:{window_long}:{max_symbols}"

        if not refresh:
            cached = self._cache_get(signature)
            if cached:
                return cached

        if not self.api_key:
            return self._empty(window_short, window_long, error="FMP_API_KEY not configured")

        long_cutoff = (datetime.now() - timedelta(days=window_long)).strftime("%Y-%m-%d")
        short_cutoff = (datetime.now() - timedelta(days=window_short)).strftime("%Y-%m-%d")
        # Look back a few extra days so the first bar has a prior close to gap against
        since_date = (datetime.now() - timedelta(days=window_long + 7)).strftime("%Y-%m-%d")

        universe = self._build_universe(max_symbols, min_price, min_volume)
        if not universe:
            return self._empty(window_short, window_long, error="empty universe")

        # 1) Detect gap days across the universe (fan-out)
        gap_days: List[Dict] = []
        workers = max(1, min(max_workers, 48))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {
                ex.submit(self._detect_gap_days, sym, gap_threshold, since_date): sym
                for sym in universe
            }
            for fut in as_completed(futures):
                try:
                    res = fut.result()
                    if res:
                        gap_days.extend(res)
                except Exception as e:
                    logger.warning(f"[GapCycle] detect failed for {futures[fut]}: {e}")

        # Keep only gap days within the monthly window
        gap_days = [g for g in gap_days if g["date"] >= long_cutoff]

        # 2) Classify each gap day's intraday behaviour (fan-out)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(self._classify, g): g for g in gap_days}
            for fut in as_completed(futures):
                g = futures[fut]
                try:
                    g["classification"] = fut.result()
                except Exception as e:
                    logger.warning(f"[GapCycle] classify failed for {g['symbol']}: {e}")
                    g["classification"] = "other"

        # 3) Aggregate per window
        monthly_stocks = gap_days
        weekly_stocks = [g for g in gap_days if g["date"] >= short_cutoff]

        payload = {
            "version": self.version,
            "timestamp": datetime.now().isoformat(),
            "cached": False,
            "universeSize": len(universe),
            "gappersFound": len(gap_days),
            "weekly": self._aggregate(weekly_stocks, window_short),
            "monthly": self._aggregate(monthly_stocks, window_long),
        }
        self._cache_set(signature, payload)
        return payload

    def _empty(self, window_short: int, window_long: int, error: str = "") -> Dict:
        empty_cats = {c: {"count": 0, "pct": 0.0} for c in CATEGORIES}
        return {
            "version": self.version,
            "timestamp": datetime.now().isoformat(),
            "cached": False,
            "universeSize": 0,
            "gappersFound": 0,
            "error": error,
            "weekly": {"window": window_short, "totalGappers": 0, "categories": empty_cats, "stocks": []},
            "monthly": {"window": window_long, "totalGappers": 0, "categories": empty_cats, "stocks": []},
        }


# ── Singleton ───────────────────────────────────────────────────────────────
_engine: Optional[GapCycleEngine] = None


def get_gap_cycle_engine() -> GapCycleEngine:
    global _engine
    if _engine is None:
        _engine = GapCycleEngine()
    return _engine
