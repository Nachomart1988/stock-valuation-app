# backend/compression_scanner.py
# Compression Scanner
# Detects stocks whose daily high-low range has been shrinking for N
# consecutive sessions (a volatility-contraction / coil), with an optional
# floor on the % rise from the 52-week low. Reports ATR + how many standard
# deviations the current price sits from its rolling mean.

from __future__ import annotations
import logging
import os
import numpy as np
import requests
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)

ATR_PERIOD = 14
ZSCORE_WINDOW = 20
WEEKS_52_DAYS = 252


class CompressionScanner:
    """
    Detects volatility compression: each of the most recent N sessions has a
    daily range % strictly smaller than the session before it.

      range%[day] = (high - low) / close * 100

    Example streak (most recent last): 10% → 8% → 7.5% → 6% → 4%  ⇒ 5 days.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_compression_days: int = 5,
        min_rise_from_low_pct: float = 0.0,
        atr_period: int = ATR_PERIOD,
        zscore_window: int = ZSCORE_WINDOW,
        lookback_days: int = 300,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_compression_days = max(2, int(min_compression_days))
        self.min_rise_from_low_pct = max(0.0, float(min_rise_from_low_pct or 0.0))
        self.atr_period = max(2, int(atr_period))
        self.zscore_window = max(2, int(zscore_window))
        self.lookback_days = max(WEEKS_52_DAYS + 20, int(lookback_days))
        self._session = requests.Session()

    # ── data fetch ───────────────────────────────────────────────

    def _fetch_json(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        params = dict(params or {})
        params['apikey'] = self.api_key
        try:
            url = f"https://financialmodelingprep.com/stable/{endpoint}"
            resp = self._session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"FMP fetch failed: {e}")
            return None

    def _fetch_historical(self, ticker: str) -> Optional[Dict]:
        data = self._fetch_json('historical-price-eod/full', {'symbol': ticker})
        if not data or not isinstance(data, list):
            if isinstance(data, dict) and 'historical' in data:
                data = data['historical']
            else:
                return None
        data = sorted(data, key=lambda x: x.get('date', ''))
        data = data[-self.lookback_days:]
        if len(data) < self.atr_period + 5:
            return None

        dates = [d['date'] for d in data]
        closes = np.array([d.get('adjClose', d.get('close', 0)) for d in data], dtype=float)
        highs = np.array([d.get('high', d.get('close', 0)) for d in data], dtype=float)
        lows = np.array([d.get('low', d.get('close', 0)) for d in data], dtype=float)
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)

        return {'dates': dates, 'close': closes, 'high': highs, 'low': lows, 'volume': volumes}

    # ── helpers ──────────────────────────────────────────────────

    def _atr(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> float:
        n = len(closes)
        if n < self.atr_period + 1:
            return 0.0
        prev_close = closes[:-1]
        tr = np.maximum.reduce([
            highs[1:] - lows[1:],
            np.abs(highs[1:] - prev_close),
            np.abs(lows[1:] - prev_close),
        ])
        if len(tr) < self.atr_period:
            return float(np.mean(tr)) if len(tr) else 0.0
        return float(np.mean(tr[-self.atr_period:]))

    def _zscore(self, closes: np.ndarray) -> float:
        window = closes[-self.zscore_window:]
        if len(window) < 2:
            return 0.0
        mean = float(np.mean(window))
        std = float(np.std(window))
        if std <= 0:
            return 0.0
        return (float(closes[-1]) - mean) / std

    def _range_pcts(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> np.ndarray:
        """Daily high-low range as % of close."""
        safe_close = np.where(closes > 0, closes, np.nan)
        rng = (highs - lows) / safe_close * 100.0
        return np.nan_to_num(rng, nan=0.0)

    def _compression_streak(self, range_pcts: np.ndarray) -> int:
        """
        Consecutive days (ending at the most recent session) whose range is
        strictly smaller than the prior session's range. Counts days, so a run
        of k strictly-decreasing transitions => k+1 days.
        """
        n = len(range_pcts)
        if n < 2:
            return 0
        streak = 1
        for i in range(n - 1, 0, -1):
            if range_pcts[i] < range_pcts[i - 1] and range_pcts[i - 1] > 0:
                streak += 1
            else:
                break
        return streak

    # ── main ─────────────────────────────────────────────────────

    def analyze(self, ticker: str) -> Dict[str, Any]:
        data = self._fetch_historical(ticker)
        if not data:
            return {'error': f'Datos insuficientes para {ticker}'}

        closes = data['close']
        highs = data['high']
        lows = data['low']
        n = len(closes)
        current_price = float(closes[-1])

        # 52-week low + % rise from it
        low_window = lows[-WEEKS_52_DAYS:] if n >= WEEKS_52_DAYS else lows
        low_52w = float(np.min(low_window)) if len(low_window) else current_price
        rise_from_low_pct = ((current_price - low_52w) / low_52w * 100.0) if low_52w > 0 else 0.0

        range_pcts = self._range_pcts(highs, lows, closes)
        streak = self._compression_streak(range_pcts)

        detected = (
            streak >= self.min_compression_days
            and rise_from_low_pct >= self.min_rise_from_low_pct
        )

        atr = self._atr(highs, lows, closes)
        atr_pct = (atr / current_price * 100.0) if current_price > 0 else 0.0
        zscore = self._zscore(closes)
        mean_price = float(np.mean(closes[-self.zscore_window:])) if n else current_price

        # Range of the compressing window: oldest (widest) vs latest (tightest)
        latest_range = float(range_pcts[-1]) if n else 0.0
        widest_range = float(np.max(range_pcts[-streak:])) if streak > 0 else latest_range

        return {
            'detected': bool(detected),
            'ticker': ticker,
            'current_price': round(current_price, 4),
            'compression_days': int(streak),
            'latest_range_pct': round(latest_range, 2),
            'widest_range_pct': round(widest_range, 2),
            'low_52w': round(low_52w, 4),
            'rise_from_low_pct': round(rise_from_low_pct, 2),
            'atr': round(atr, 4),
            'atr_pct': round(atr_pct, 2),
            'zscore': round(zscore, 2),
            'mean_price': round(mean_price, 4),
        }


# Singleton
_engine: Optional[CompressionScanner] = None


def get_compression_scanner() -> CompressionScanner:
    global _engine
    if _engine is None:
        _engine = CompressionScanner()
    return _engine
