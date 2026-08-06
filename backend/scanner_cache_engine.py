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
AVG_VOLUME_WINDOW = 50
FETCH_WORKERS = 10              # concurrency for per-ticker history fetch
FETCH_RETRIES = 2

STALE_AFTER_HOURS = 20          # consider cache stale after this many hours

# ── Deviation scanner (over-extension vs moving average) ────────
# For each MA period we store how far price sits from that MA, expressed three
# ways: in standard deviations (σ), in %, and in ATR units.
#
# σ here is the distance to the MA divided by the stock's own typical daily move
# (stdev of daily returns over VOL_WINDOW bars), NOT the Bollinger z-score of the
# closes inside the MA window. Bollinger's version saturates at sqrt(p-1) — only
# 3.0σ for a 10-day MA — so the most extended names would all pile up against the
# ceiling and the ranking would collapse. Normalising by trailing return vol keeps
# the scale unbounded and comparable, so "XYZ está a 20 desvíos de su MA de 10"
# means what a trader expects: 20 typical daily moves away from the average.
DEV_MA_PERIODS = (10, 20, 50, 100, 200)
MA_SLOPE_LOOKBACK = 10          # bars used to measure whether the MA itself rises
VOL_WINDOW = 100                # bars of daily returns used for the σ unit
MIN_VOL_BARS = 20               # need at least this many returns for a usable σ
MIN_DAILY_VOL = 0.0005          # 0.05% — below this the stock is too stale to score
SIGMA_CAP = 99.0                # clamp so a near-zero σ can't produce absurd values

BASE_COLUMNS = [
    'symbol', 'company_name', 'sector', 'exchange', 'country',
    'market_cap', 'price',
    'red_streak', 'green_streak', 'compression_days',
    'latest_range_pct', 'widest_range_pct',
    'atr', 'atr_pct', 'zscore', 'mean_price',
    'low_52w', 'rise_from_low_pct',
]
DEV_COLUMNS = [
    f'{metric}_{p}'
    for p in DEV_MA_PERIODS
    for metric in ('ma', 'dev_sigma', 'dev_pct', 'dev_atr', 'ma_slope')
]
EXTRA_COLUMNS = ['volume', 'avg_volume', 'rvol', 'high_52w', 'drop_from_high_pct']
ALL_COLUMNS = BASE_COLUMNS + DEV_COLUMNS + EXTRA_COLUMNS


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
            # Migrate older DBs: add any column the current schema knows about.
            existing = {r['name'] for r in conn.execute("PRAGMA table_info(scanner_metrics)")}
            for col in ALL_COLUMNS:
                if col not in existing:
                    conn.execute(f"ALTER TABLE scanner_metrics ADD COLUMN {col} REAL")
            for p in DEV_MA_PERIODS:
                conn.execute(f"CREATE INDEX IF NOT EXISTS idx_dev_{p} ON scanner_metrics(dev_sigma_{p})")
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
                'v': float(d.get('volume') or 0),
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

    @staticmethod
    def _daily_vol(adj_close: np.ndarray) -> float:
        """Stdev of daily returns over the last VOL_WINDOW bars — the σ unit."""
        window = adj_close[-(VOL_WINDOW + 1):]
        if len(window) < MIN_VOL_BARS + 1:
            return 0.0
        prev = window[:-1]
        rets = np.diff(window)[prev > 0] / prev[prev > 0]
        if len(rets) < MIN_VOL_BARS:
            return 0.0
        return float(np.std(rets))

    @staticmethod
    def _deviation(adj_close: np.ndarray, atr: float, price_scale: float,
                   daily_vol: float) -> List[Optional[float]]:
        """Per-MA-period extension metrics, flattened in DEV_COLUMNS order.

        Everything is computed on adjusted closes; the MA itself is rescaled to
        raw-price space so it lines up with the quoted price in the UI.
        """
        out: List[Optional[float]] = []
        last = float(adj_close[-1]) if len(adj_close) else 0.0
        for p in DEV_MA_PERIODS:
            if len(adj_close) < p or last <= 0:
                out.extend([None] * 5)
                continue
            ma = float(np.mean(adj_close[-p:]))
            if ma <= 0:
                out.extend([None] * 5)
                continue

            # One σ = one typical daily move, priced off the MA.
            dev_sigma = None
            if daily_vol >= MIN_DAILY_VOL:
                raw = (last - ma) / (daily_vol * ma)
                dev_sigma = round(max(-SIGMA_CAP, min(SIGMA_CAP, raw)), 2)
            dev_pct = round((last - ma) / ma * 100.0, 2)
            dev_atr = round((last - ma) / atr, 2) if atr > 0 else None

            ma_slope = None
            if len(adj_close) >= p + MA_SLOPE_LOOKBACK:
                prev_ma = float(np.mean(adj_close[-(p + MA_SLOPE_LOOKBACK):-MA_SLOPE_LOOKBACK]))
                if prev_ma > 0:
                    ma_slope = round((ma - prev_ma) / prev_ma * 100.0, 2)

            out.extend([round(ma * price_scale, 4), dev_sigma, dev_pct, dev_atr, ma_slope])
        return out

    def _compute_row(self, sym: str, meta: Dict, bars: List[Dict]) -> Optional[tuple]:
        if len(bars) < MIN_BARS:
            return None
        opens = np.array([b['o'] for b in bars], dtype=float)
        raw_close = np.array([b['c'] for b in bars], dtype=float)
        adj_close = np.array([b['ac'] for b in bars], dtype=float)
        highs = np.array([b['h'] for b in bars], dtype=float)
        lows = np.array([b['l'] for b in bars], dtype=float)
        volumes = np.array([b.get('v', 0.0) for b in bars], dtype=float)

        current_price = float(raw_close[-1]) if raw_close[-1] > 0 else meta['price']
        red, green = self._streaks(opens, raw_close)
        comp_days, latest_rng, widest_rng = self._compression(highs, lows, adj_close)
        atr = self._atr(highs, lows, adj_close)
        atr_pct = (atr / current_price * 100.0) if current_price > 0 else 0.0
        zscore, mean_price = self._zscore(adj_close)

        low_window = lows[-WEEKS_52_DAYS:] if len(lows) >= WEEKS_52_DAYS else lows
        low_52w = float(np.min(low_window)) if len(low_window) else current_price
        rise_from_low = ((current_price - low_52w) / low_52w * 100.0) if low_52w > 0 else 0.0

        high_window = highs[-WEEKS_52_DAYS:] if len(highs) >= WEEKS_52_DAYS else highs
        high_52w = float(np.max(high_window)) if len(high_window) else current_price
        drop_from_high = ((current_price - high_52w) / high_52w * 100.0) if high_52w > 0 else 0.0

        volume = float(volumes[-1]) if len(volumes) else 0.0
        vol_window = volumes[-AVG_VOLUME_WINDOW:]
        avg_volume = float(np.mean(vol_window)) if len(vol_window) else 0.0
        rvol = round(volume / avg_volume, 2) if avg_volume > 0 else 0.0

        # MA math runs on adjusted closes; rescale to raw-price space for display.
        price_scale = (current_price / float(adj_close[-1])) if adj_close[-1] > 0 else 1.0
        dev_values = self._deviation(adj_close, atr, price_scale, self._daily_vol(adj_close))

        return tuple([
            sym, meta['company_name'], meta['sector'], meta['exchange'], meta['country'],
            meta['market_cap'], round(current_price, 4),
            int(red), int(green), int(comp_days),
            round(latest_rng, 2), round(widest_rng, 2),
            round(atr, 4), round(atr_pct, 2), round(zscore, 2), round(mean_price, 4),
            round(low_52w, 4), round(rise_from_low, 2),
        ] + dev_values + [
            round(volume, 0), round(avg_volume, 0), rvol,
            round(high_52w, 4), round(drop_from_high, 2),
        ])

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
                    f"INSERT INTO scanner_metrics ({','.join(ALL_COLUMNS)}) "
                    f"VALUES ({','.join(['?'] * len(ALL_COLUMNS))})",
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
        # A cache built before the deviation columns existed has rows but no MA
        # data — the deviation scanner needs a rebuild before it can answer.
        deviation_ready = False
        try:
            conn = self._connect()
            try:
                row = conn.execute(
                    "SELECT 1 FROM scanner_metrics WHERE dev_sigma_20 IS NOT NULL LIMIT 1"
                ).fetchone()
                deviation_ready = row is not None
            finally:
                conn.close()
        except Exception:
            pass
        return {
            'last_refresh': last,
            'age_hours': age_hours,
            'stale': stale,
            'building': self._building,
            'row_count': int(rows) if rows else 0,
            'ready': bool(rows and int(rows) > 0),
            'deviation_ready': deviation_ready,
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

    def query_deviation(self, ma_period=20, direction='above', min_sigma=0.0,
                        price_min=None, price_max=None, mcap_min=None, mcap_max=None,
                        sector=None, limit=300) -> List[Dict]:
        """Stocks ranked by how many σ they trade away from the chosen MA."""
        p = int(ma_period) if int(ma_period) in DEV_MA_PERIODS else 20
        sigma_col = f'dev_sigma_{p}'
        where = [f"{sigma_col} IS NOT NULL"]
        args: List = []
        min_sigma = abs(float(min_sigma or 0.0))

        if direction == 'below':
            where.append(f"{sigma_col} <= ?"); args.append(-min_sigma)
            order = f"{sigma_col} ASC"
        elif direction == 'both':
            where.append(f"ABS({sigma_col}) >= ?"); args.append(min_sigma)
            order = f"ABS({sigma_col}) DESC"
        else:
            where.append(f"{sigma_col} >= ?"); args.append(min_sigma)
            order = f"{sigma_col} DESC"

        self._apply_common_filters(where, args, price_min, price_max, mcap_min, mcap_max, sector)
        sql = (
            f"SELECT * FROM scanner_metrics WHERE {' AND '.join(where)} "
            f"ORDER BY {order}, ABS(dev_pct_{p}) DESC LIMIT ?"
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
            d['ma_period'] = p
            d['ma'] = d.get(f'ma_{p}')
            d['dev_sigma'] = d.get(sigma_col)
            d['dev_pct'] = d.get(f'dev_pct_{p}')
            d['dev_atr'] = d.get(f'dev_atr_{p}')
            d['ma_slope'] = d.get(f'ma_slope_{p}')
            out.append(d)
        return out


# Singleton
_engine: Optional[ScannerCacheEngine] = None


def get_scanner_cache_engine() -> ScannerCacheEngine:
    global _engine
    if _engine is None:
        _engine = ScannerCacheEngine()
    return _engine
