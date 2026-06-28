# backend/scanner_cache_engine.py
# Daily-refreshed scanner cache.
#
# Instead of fetching per-ticker history on every scan request (which times out
# on broad universes), we precompute threshold-independent metrics for the WHOLE
# US universe once per day and store them in SQLite. Scan requests then become a
# fast indexed query with no external calls.
#
# Data sources (all FMP "stable"):
#   • company-screener        → US universe + companyName/sector/exchange/marketCap/price
#   • historical-price-eod/full?symbol=  → per-ticker daily OHLC (last ~1y)
#
# NOTE: FMP's bulk "batch-eod" endpoint is hard daily-limited ("Limit Reach … bulk
# endpoint") and cannot backfill history, so the daily job uses the per-ticker
# endpoint (the same one the other scanners use) at controlled concurrency. The
# full year of history also yields a true 52-week low.
#
# Metrics stored are threshold-independent (actual streak lengths, ATR, z-score,
# % from 52w low, …) so any user threshold is applied at query time.

from __future__ import annotations
import datetime as dt
import logging
import os
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Any

import numpy as np
import requests

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scanner_cache.db')
FMP_BASE = 'https://financialmodelingprep.com/stable'

HISTORY_DAYS = 260              # ~1 trading year → true 52-week low
MIN_BARS = 20                   # need at least this many bars to compute metrics
ATR_PERIOD = 14
ZSCORE_WINDOW = 20
WEEKS_52_DAYS = 252
FETCH_WORKERS = 10              # concurrency for per-ticker history fetch
FETCH_RETRIES = 2

STALE_AFTER_HOURS = 20          # consider cache stale after this many hours


class ScannerCacheEngine:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self._session = requests.Session()
        self._lock = threading.Lock()       # guards refresh (one at a time)
        self._building = False
        self._init_db()

    # ── DB ───────────────────────────────────────────────────────

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS scanner_metrics (
                    symbol            TEXT PRIMARY KEY,
                    company_name      TEXT,
                    sector            TEXT,
                    exchange          TEXT,
                    country           TEXT,
                    market_cap        REAL,
                    price             REAL,
                    red_streak        INTEGER,
                    green_streak      INTEGER,
                    compression_days  INTEGER,
                    latest_range_pct  REAL,
                    widest_range_pct  REAL,
                    atr               REAL,
                    atr_pct           REAL,
                    zscore            REAL,
                    mean_price        REAL,
                    low_52w           REAL,
                    rise_from_low_pct REAL
                );
                CREATE INDEX IF NOT EXISTS idx_red   ON scanner_metrics(red_streak);
                CREATE INDEX IF NOT EXISTS idx_green ON scanner_metrics(green_streak);
                CREATE INDEX IF NOT EXISTS idx_cmp   ON scanner_metrics(compression_days);
                CREATE TABLE IF NOT EXISTS scanner_cache_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
                """
            )
            conn.commit()
        finally:
            conn.close()

    def _set_meta(self, conn: sqlite3.Connection, key: str, value: str) -> None:
        conn.execute(
            "INSERT INTO scanner_cache_meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )

    def _get_meta(self, key: str) -> Optional[str]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT value FROM scanner_cache_meta WHERE key=?", (key,)).fetchone()
            return row['value'] if row else None
        finally:
            conn.close()

    # ── FMP fetch ────────────────────────────────────────────────

    def _get(self, endpoint: str, params: Dict, timeout: int = 60) -> Any:
        params = dict(params)
        params['apikey'] = self.api_key
        resp = self._session.get(f"{FMP_BASE}/{endpoint}", params=params, timeout=timeout)
        resp.raise_for_status()
        return resp.json()

    def _fetch_universe(self) -> Dict[str, Dict]:
        """US, actively-trading common stocks with metadata, keyed by symbol."""
        data = self._get('company-screener', {
            'country': 'US',
            'isActivelyTrading': 'true',
            'isEtf': 'false',
            'isFund': 'false',
            'priceMoreThan': '0',
            'limit': '10000',
        })
        universe: Dict[str, Dict] = {}
        if isinstance(data, list):
            for s in data:
                sym = s.get('symbol')
                if not sym or s.get('isEtf') or s.get('isFund'):
                    continue
                universe[sym] = {
                    'company_name': s.get('companyName') or sym,
                    'sector': s.get('sector') or '',
                    'exchange': s.get('exchangeShortName') or s.get('exchange') or '',
                    'country': s.get('country') or 'US',
                    'market_cap': float(s.get('marketCap') or 0),
                    'price': float(s.get('price') or 0),
                }
        return universe

    def _fetch_history(self, symbol: str) -> Optional[List[Dict]]:
        """Per-ticker daily OHLC, oldest→newest, last ~HISTORY_DAYS sessions."""
        today = dt.date.today()
        frm = (today - dt.timedelta(days=int(HISTORY_DAYS * 1.6))).isoformat()
        for attempt in range(FETCH_RETRIES + 1):
            try:
                data = self._get('historical-price-eod/full',
                                 {'symbol': symbol, 'from': frm, 'to': today.isoformat()},
                                 timeout=20)
                break
            except Exception as e:
                if attempt >= FETCH_RETRIES:
                    return None
                time.sleep(0.5 * (attempt + 1))      # light backoff on 429
        if isinstance(data, dict) and 'historical' in data:
            data = data['historical']
        if not isinstance(data, list) or not data:
            return None
        data = sorted(data, key=lambda x: x.get('date', ''))[-HISTORY_DAYS:]
        bars = []
        for d in data:
            close = d.get('close') or 0
            bars.append({
                'o': float(d.get('open') or close or 0),
                'h': float(d.get('high') or close or 0),
                'l': float(d.get('low') or close or 0),
                'c': float(close or 0),
                'ac': float(d.get('adjClose', close) or 0),
            })
        return bars

    # ── metric math (mirrors the per-ticker engines) ─────────────

    @staticmethod
    def _atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> float:
        n = len(closes)
        if n < ATR_PERIOD + 1:
            return 0.0
        prev_close = closes[:-1]
        tr = np.maximum.reduce([
            highs[1:] - lows[1:],
            np.abs(highs[1:] - prev_close),
            np.abs(lows[1:] - prev_close),
        ])
        if len(tr) < ATR_PERIOD:
            return float(np.mean(tr)) if len(tr) else 0.0
        return float(np.mean(tr[-ATR_PERIOD:]))

    @staticmethod
    def _zscore(closes: np.ndarray) -> tuple:
        window = closes[-ZSCORE_WINDOW:]
        if len(window) < 2:
            return 0.0, float(closes[-1]) if len(closes) else 0.0
        mean = float(np.mean(window))
        std = float(np.std(window))
        z = (float(closes[-1]) - mean) / std if std > 0 else 0.0
        return z, mean

    @staticmethod
    def _streaks(opens: np.ndarray, closes: np.ndarray) -> tuple:
        """Current consecutive red and green streaks from the most recent day."""
        red = green = 0
        for i in range(len(closes) - 1, -1, -1):
            o, c = float(opens[i]), float(closes[i])
            if o <= 0 or c <= 0:
                break
            if c < o:
                red += 1
            else:
                break
        for i in range(len(closes) - 1, -1, -1):
            o, c = float(opens[i]), float(closes[i])
            if o <= 0 or c <= 0:
                break
            if c > o:
                green += 1
            else:
                break
        return red, green

    @staticmethod
    def _compression(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> tuple:
        safe = np.where(closes > 0, closes, np.nan)
        rng = np.nan_to_num((highs - lows) / safe * 100.0, nan=0.0)
        n = len(rng)
        if n < 2:
            return 1 if n else 0, float(rng[-1]) if n else 0.0, float(rng[-1]) if n else 0.0
        streak = 1
        for i in range(n - 1, 0, -1):
            if rng[i] < rng[i - 1] and rng[i - 1] > 0:
                streak += 1
            else:
                break
        latest = float(rng[-1])
        widest = float(np.max(rng[-streak:])) if streak > 0 else latest
        return streak, latest, widest

    def _compute_row(self, sym: str, meta: Dict, bars: List[Dict]) -> Optional[tuple]:
        if len(bars) < MIN_BARS:
            return None
        opens = np.array([b['o'] for b in bars], dtype=float)
        raw_close = np.array([b['c'] for b in bars], dtype=float)
        adj_close = np.array([b['ac'] for b in bars], dtype=float)
        highs = np.array([b['h'] for b in bars], dtype=float)
        lows = np.array([b['l'] for b in bars], dtype=float)

        current_price = float(raw_close[-1]) if raw_close[-1] > 0 else meta['price']
        red, green = self._streaks(opens, raw_close)
        comp_days, latest_rng, widest_rng = self._compression(highs, lows, adj_close)
        atr = self._atr(highs, lows, adj_close)
        atr_pct = (atr / current_price * 100.0) if current_price > 0 else 0.0
        zscore, mean_price = self._zscore(adj_close)

        low_window = lows[-WEEKS_52_DAYS:] if len(lows) >= WEEKS_52_DAYS else lows
        low_52w = float(np.min(low_window)) if len(low_window) else current_price
        rise_from_low = ((current_price - low_52w) / low_52w * 100.0) if low_52w > 0 else 0.0

        return (
            sym, meta['company_name'], meta['sector'], meta['exchange'], meta['country'],
            meta['market_cap'], round(current_price, 4),
            int(red), int(green), int(comp_days),
            round(latest_rng, 2), round(widest_rng, 2),
            round(atr, 4), round(atr_pct, 2), round(zscore, 2), round(mean_price, 4),
            round(low_52w, 4), round(rise_from_low, 2),
        )

    # ── refresh ──────────────────────────────────────────────────

    def is_building(self) -> bool:
        return self._building

    def refresh(self) -> Dict[str, Any]:
        """Rebuild the whole cache. Heavy — runs in a background thread."""
        if not self.api_key:
            return {'ok': False, 'error': 'FMP_API_KEY not configured'}
        if not self._lock.acquire(blocking=False):
            return {'ok': False, 'error': 'refresh already running'}
        self._building = True
        started = time.time()
        try:
            universe = self._fetch_universe()
            if not universe:
                return {'ok': False, 'error': 'empty universe'}
            symbols = list(universe.keys())

            rows: List[tuple] = []

            def work(sym: str) -> Optional[tuple]:
                bars = self._fetch_history(sym)
                if not bars:
                    return None
                return self._compute_row(sym, universe[sym], bars)

            with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
                futures = {pool.submit(work, s): s for s in symbols}
                for fut in as_completed(futures):
                    try:
                        row = fut.result()
                    except Exception:
                        row = None
                    if row is not None:
                        rows.append(row)

            conn = self._connect()
            try:
                conn.execute("DELETE FROM scanner_metrics")
                conn.executemany(
                    "INSERT INTO scanner_metrics VALUES (" + ",".join(["?"] * 18) + ")",
                    rows,
                )
                self._set_meta(conn, 'last_refresh', dt.datetime.utcnow().isoformat())
                self._set_meta(conn, 'universe_count', str(len(symbols)))
                self._set_meta(conn, 'row_count', str(len(rows)))
                conn.commit()
            finally:
                conn.close()

            elapsed = round(time.time() - started, 1)
            logger.info(f"[ScannerCache] refreshed {len(rows)}/{len(symbols)} in {elapsed}s")
            return {'ok': True, 'rows': len(rows), 'universe': len(symbols), 'elapsed_s': elapsed}
        except Exception as e:
            logger.exception("[ScannerCache] refresh failed")
            return {'ok': False, 'error': str(e)}
        finally:
            self._building = False
            self._lock.release()

    # ── status & queries ─────────────────────────────────────────

    def status(self) -> Dict[str, Any]:
        last = self._get_meta('last_refresh')
        rows = self._get_meta('row_count')
        age_hours = None
        stale = True
        if last:
            try:
                age = dt.datetime.utcnow() - dt.datetime.fromisoformat(last)
                age_hours = round(age.total_seconds() / 3600.0, 1)
                stale = age_hours >= STALE_AFTER_HOURS
            except Exception:
                pass
        return {
            'last_refresh': last,
            'age_hours': age_hours,
            'stale': stale,
            'building': self._building,
            'row_count': int(rows) if rows else 0,
            'ready': bool(rows and int(rows) > 0),
        }

    def _apply_common_filters(self, where: List[str], args: List,
                              price_min, price_max, mcap_min, mcap_max, sector) -> None:
        if price_min is not None:
            where.append("price >= ?"); args.append(float(price_min))
        if price_max is not None:
            where.append("price <= ?"); args.append(float(price_max))
        if mcap_min:
            where.append("market_cap >= ?"); args.append(float(mcap_min))
        if mcap_max:
            where.append("market_cap <= ?"); args.append(float(mcap_max))
        if sector:
            where.append("sector = ?"); args.append(sector)

    def query_consecutive(self, direction='red', min_streak=5, price_min=None, price_max=None,
                          mcap_min=None, mcap_max=None, sector=None, limit=300) -> List[Dict]:
        col = 'green_streak' if direction == 'green' else 'red_streak'
        where = [f"{col} >= ?"]
        args: List = [int(min_streak)]
        self._apply_common_filters(where, args, price_min, price_max, mcap_min, mcap_max, sector)
        sql = (
            f"SELECT * FROM scanner_metrics WHERE {' AND '.join(where)} "
            f"ORDER BY {col} DESC, atr_pct DESC LIMIT ?"
        )
        args.append(int(limit))
        conn = self._connect()
        try:
            rows = conn.execute(sql, args).fetchall()
        finally:
            conn.close()
        out = []
        for r in rows:
            d = dict(r)
            d['streak'] = d[col]
            d['direction'] = direction
            out.append(d)
        return out

    def query_compression(self, min_compression_days=5, min_rise_from_low_pct=0.0,
                         price_min=None, price_max=None, mcap_min=None, mcap_max=None,
                         sector=None, limit=300) -> List[Dict]:
        where = ["compression_days >= ?", "rise_from_low_pct >= ?"]
        args: List = [int(min_compression_days), float(min_rise_from_low_pct or 0.0)]
        self._apply_common_filters(where, args, price_min, price_max, mcap_min, mcap_max, sector)
        sql = (
            f"SELECT * FROM scanner_metrics WHERE {' AND '.join(where)} "
            f"ORDER BY compression_days DESC, latest_range_pct ASC LIMIT ?"
        )
        args.append(int(limit))
        conn = self._connect()
        try:
            rows = conn.execute(sql, args).fetchall()
        finally:
            conn.close()
        return [dict(r) for r in rows]


# Singleton
_engine: Optional[ScannerCacheEngine] = None


def get_scanner_cache_engine() -> ScannerCacheEngine:
    global _engine
    if _engine is None:
        _engine = ScannerCacheEngine()
    return _engine
