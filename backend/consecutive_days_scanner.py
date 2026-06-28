# backend/consecutive_days_scanner.py
# Consecutive Red / Green Days Scanner
# Counts how many of the most recent trading days closed RED (close < open)
# or GREEN (close > open) consecutively, and reports ATR + how many standard
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


class ConsecutiveDaysScanner:
    """
    Detects stocks that closed RED or GREEN for N consecutive sessions.

    RED  day = close < open  (closed below the open)
    GREEN day = close > open  (closed above the open)

    The streak is measured from the most recent session walking backwards.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        direction: str = 'red',          # 'red' | 'green'
        min_streak: int = 5,
        atr_period: int = ATR_PERIOD,
        zscore_window: int = ZSCORE_WINDOW,
        lookback_days: int = 260,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.direction = direction if direction in ('red', 'green') else 'red'
        self.min_streak = max(1, int(min_streak))
        self.atr_period = max(2, int(atr_period))
        self.zscore_window = max(2, int(zscore_window))
        self.lookback_days = max(60, int(lookback_days))
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
        opens = np.array([d.get('open', d.get('close', 0)) for d in data], dtype=float)
        closes = np.array([d.get('adjClose', d.get('close', 0)) for d in data], dtype=float)
        highs = np.array([d.get('high', d.get('close', 0)) for d in data], dtype=float)
        lows = np.array([d.get('low', d.get('close', 0)) for d in data], dtype=float)
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)
        # Use raw (non-adjusted) close for the red/green test so it matches the open.
        raw_closes = np.array([d.get('close', 0) for d in data], dtype=float)

        return {
            'dates': dates, 'open': opens, 'close': closes, 'raw_close': raw_closes,
            'high': highs, 'low': lows, 'volume': volumes,
        }

    # ── helpers ──────────────────────────────────────────────────

    def _atr(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray) -> float:
        """Simple ATR over the trailing atr_period True-Range values."""
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
        """How many std devs the current close is from its rolling mean."""
        window = closes[-self.zscore_window:]
        if len(window) < 2:
            return 0.0
        mean = float(np.mean(window))
        std = float(np.std(window))
        if std <= 0:
            return 0.0
        return (float(closes[-1]) - mean) / std

    def _streak(self, opens: np.ndarray, closes: np.ndarray) -> int:
        """Consecutive RED or GREEN days from the most recent session backwards."""
        n = len(closes)
        streak = 0
        for i in range(n - 1, -1, -1):
            o = float(opens[i])
            c = float(closes[i])
            if o <= 0 or c <= 0:
                break
            is_red = c < o
            is_green = c > o
            if self.direction == 'red' and is_red:
                streak += 1
            elif self.direction == 'green' and is_green:
                streak += 1
            else:
                break
        return streak

    # ── main ─────────────────────────────────────────────────────

    def analyze(self, ticker: str) -> Dict[str, Any]:
        data = self._fetch_historical(ticker)
        if not data:
            return {'error': f'Datos insuficientes para {ticker}'}

        opens = data['open']
        closes = data['close']
        raw_closes = data['raw_close']
        highs = data['high']
        lows = data['low']
        n = len(closes)
        current_price = float(closes[-1])

        streak = self._streak(opens, raw_closes)
        detected = streak >= self.min_streak

        atr = self._atr(highs, lows, closes)
        atr_pct = (atr / current_price * 100.0) if current_price > 0 else 0.0
        zscore = self._zscore(closes)

        mean_price = float(np.mean(closes[-self.zscore_window:])) if n else current_price

        return {
            'detected': bool(detected),
            'ticker': ticker,
            'direction': self.direction,
            'current_price': round(current_price, 4),
            'streak': int(streak),
            'atr': round(atr, 4),
            'atr_pct': round(atr_pct, 2),
            'zscore': round(zscore, 2),
            'mean_price': round(mean_price, 4),
        }


# Singleton
_engine: Optional[ConsecutiveDaysScanner] = None


def get_consecutive_days_scanner() -> ConsecutiveDaysScanner:
    global _engine
    if _engine is None:
        _engine = ConsecutiveDaysScanner()
    return _engine
