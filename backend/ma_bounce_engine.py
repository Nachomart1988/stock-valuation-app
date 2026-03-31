# backend/ma_bounce_engine.py
# MA Bounce Detection Engine
# Finds stocks that surged X%+ in N months and counts bounces off MA20/MA50

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class MABounceEngine:
    """
    Detects stocks with strong momentum (surge filter) that repeatedly
    bounce off a chosen moving average (MA20 or MA50).

    Pipeline:
      1. Fetch daily price data
      2. Check if stock surged >= min_surge in the lookback window
      3. Compute MA (20 or 50)
      4. Count bounce events: price touches/dips into MA zone then recovers
      5. Score by bounce count + quality of bounces
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_surge: float = 0.50,           # 50% minimum surge
        surge_lookback_months: int = 6,     # lookback for surge detection
        ma_period: int = 20,                # MA20 or MA50
        bounce_tolerance: float = 0.02,     # 2% zone around MA counts as "touch"
        min_recovery_pct: float = 0.02,     # 2% bounce off MA to confirm recovery
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_surge = min_surge
        self.surge_lookback_months = surge_lookback_months
        self.ma_period = ma_period
        self.bounce_tolerance = bounce_tolerance
        self.min_recovery_pct = min_recovery_pct
        self._session = requests.Session()

    def _fetch_json(self, endpoint: str, params: Dict = None) -> Any:
        params = params or {}
        params['apikey'] = self.api_key
        try:
            url = f"https://financialmodelingprep.com/stable/{endpoint}"
            resp = self._session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"FMP fetch failed ({endpoint}): {e}")
            return None

    def _fetch_daily_prices(self, ticker: str, days: int = 756) -> Optional[Dict]:
        """Fetch daily OHLCV from FMP."""
        data = self._fetch_json('historical-price-eod/full', {'symbol': ticker})
        if not data or not isinstance(data, list):
            if isinstance(data, dict) and 'historical' in data:
                data = data['historical']
            else:
                return None

        data = sorted(data, key=lambda x: x.get('date', ''))
        if len(data) < 60:
            return None

        data = data[-days:]

        # Use adjClose for split-adjusted prices; adjust OHLC proportionally
        raw_closes = np.array([d.get('close', 0) for d in data], dtype=float)
        adj_closes = np.array([d.get('adjClose', d.get('close', 0)) for d in data], dtype=float)
        adj_ratio = np.where(raw_closes > 0, adj_closes / raw_closes, 1.0)

        return {
            'dates': [d['date'] for d in data],
            'open': np.array([d.get('open', d.get('close', 0)) for d in data], dtype=float) * adj_ratio,
            'high': np.array([d.get('high', d.get('close', 0)) for d in data], dtype=float) * adj_ratio,
            'low': np.array([d.get('low', d.get('close', 0)) for d in data], dtype=float) * adj_ratio,
            'close': adj_closes,
            'volume': np.array([d.get('volume', 0) for d in data], dtype=float),
        }

    def _check_surge(self, dates: List[str], closes: np.ndarray) -> Optional[Dict]:
        """
        Check if stock surged >= min_surge within the lookback window.
        Returns surge info or None.
        """
        if self.surge_lookback_months <= 0:
            lookback_days = len(closes)
        else:
            lookback_days = self.surge_lookback_months * 21  # ~21 trading days/month

        lookback_days = min(lookback_days, len(closes))
        window = closes[-lookback_days:]
        window_dates = dates[-lookback_days:]

        if len(window) < 20:
            return None

        low_val = np.min(window)
        high_val = np.max(window)

        if low_val <= 0:
            return None

        low_idx = np.argmin(window)
        high_idx = np.argmax(window)

        # Surge must go low → high (not high → low)
        if high_idx <= low_idx:
            return None

        surge_pct = (high_val - low_val) / low_val

        if surge_pct < self.min_surge:
            return None

        return {
            'surge_pct': float(surge_pct),
            'low_price': float(low_val),
            'high_price': float(high_val),
            'low_date': window_dates[low_idx],
            'high_date': window_dates[high_idx],
        }

    def _compute_ma(self, closes: np.ndarray) -> np.ndarray:
        """Compute simple moving average."""
        if len(closes) < self.ma_period:
            return np.full(len(closes), np.nan)

        ma = np.full(len(closes), np.nan)
        for i in range(self.ma_period - 1, len(closes)):
            ma[i] = np.mean(closes[i - self.ma_period + 1:i + 1])
        return ma

    def _detect_bounces(self, dates: List[str], closes: np.ndarray,
                        lows: np.ndarray, highs: np.ndarray,
                        ma: np.ndarray) -> List[Dict]:
        """
        Detect bounce events off the moving average.

        A bounce is:
        1. Price dips into the MA zone (low <= MA * (1 + tolerance))
        2. Price doesn't break significantly below MA (low >= MA * (1 - tolerance * 2))
        3. Price recovers above MA and moves up >= min_recovery_pct from the low

        Only count bounces after the surge start (within the lookback window).
        """
        bounces = []
        n = len(closes)

        # Only look at data where MA is valid
        start_idx = self.ma_period + 5  # give MA a few bars to stabilize

        # Determine lookback start
        if self.surge_lookback_months > 0:
            lookback_days = self.surge_lookback_months * 21
            lookback_start = max(start_idx, n - lookback_days)
        else:
            lookback_start = start_idx

        i = lookback_start
        while i < n - 2:  # need at least 2 bars after for recovery check
            if np.isnan(ma[i]):
                i += 1
                continue

            ma_val = ma[i]
            upper_zone = ma_val * (1 + self.bounce_tolerance)
            lower_zone = ma_val * (1 - self.bounce_tolerance * 2.5)

            # Check if price touches MA zone from above
            # Low dips into or near MA, but doesn't crash through
            if lows[i] <= upper_zone and lows[i] >= lower_zone:
                # Look for recovery in next 1-10 bars
                bounce_low = lows[i]
                recovered = False
                recovery_idx = i

                for j in range(i + 1, min(i + 11, n)):
                    if np.isnan(ma[j]):
                        continue
                    # Price recovers above MA and moves up from the dip
                    recovery_pct = (closes[j] - bounce_low) / bounce_low if bounce_low > 0 else 0
                    if closes[j] > ma[j] and recovery_pct >= self.min_recovery_pct:
                        recovered = True
                        recovery_idx = j
                        break

                if recovered:
                    # Quality score: how clean was the bounce?
                    # Factors: how close to MA, how fast recovery, recovery magnitude
                    ma_proximity = 1.0 - abs(bounce_low - ma[i]) / ma[i] if ma[i] > 0 else 0
                    recovery_speed = 1.0 / max(recovery_idx - i, 1)  # faster = better
                    recovery_magnitude = (closes[recovery_idx] - bounce_low) / bounce_low if bounce_low > 0 else 0

                    quality = (ma_proximity * 0.3 + recovery_speed * 0.3 +
                               min(recovery_magnitude / 0.05, 1.0) * 0.4)

                    bounces.append({
                        'date': dates[i],
                        'bounce_low': float(bounce_low),
                        'ma_value': float(ma[i]),
                        'recovery_date': dates[recovery_idx],
                        'recovery_price': float(closes[recovery_idx]),
                        'recovery_pct': round(float(recovery_magnitude * 100), 1),
                        'bars_to_recover': recovery_idx - i,
                        'quality': round(float(quality), 3),
                    })

                    # Skip ahead past recovery to avoid double-counting
                    i = recovery_idx + 3
                    continue

            i += 1

        return bounces

    def analyze(self, ticker: str) -> Dict[str, Any]:
        """
        Run full MA Bounce detection on a ticker.

        Returns:
          - detected: bool (has surge + at least 1 bounce)
          - bounce_count: number of MA bounces
          - bounces: list of bounce events
          - surge: surge info
          - score: composite score (bounce_count weighted by quality)
        """
        ticker = ticker.upper().strip()

        daily = self._fetch_daily_prices(ticker, days=756)
        if daily is None:
            return {'error': f'Insufficient price data for {ticker}'}

        closes = daily['close']
        if len(closes) < max(self.ma_period + 20, 60):
            return {'error': f'Insufficient data for {ticker} (need {self.ma_period + 20}+ bars)'}

        # 1. Check surge
        surge = self._check_surge(daily['dates'], closes)
        if surge is None:
            return {
                'detected': False,
                'bounce_count': 0,
                'bounces': [],
                'surge': None,
                'score': 0,
                'ticker': ticker,
                'current_price': float(closes[-1]),
                'ma_period': self.ma_period,
                'narrative': f'No surge >= {self.min_surge*100:.0f}% detected for {ticker} in last {self.surge_lookback_months} months.',
            }

        # 2. Compute MA
        ma = self._compute_ma(closes)

        # 3. Detect bounces
        bounces = self._detect_bounces(
            daily['dates'], closes, daily['low'], daily['high'], ma
        )

        # 4. Score: weighted by count + average quality
        bounce_count = len(bounces)
        avg_quality = np.mean([b['quality'] for b in bounces]) if bounces else 0
        avg_recovery = np.mean([b['recovery_pct'] for b in bounces]) if bounces else 0

        # Score 0-100: mostly bounce count, modulated by quality
        count_score = min(bounce_count / 8.0, 1.0) * 60  # 8+ bounces = max count score
        quality_score = avg_quality * 25
        recovery_score = min(avg_recovery / 5.0, 1.0) * 15  # 5%+ avg recovery = max
        score = round(count_score + quality_score + recovery_score, 1)

        # Current MA value and distance
        current_ma = float(ma[-1]) if not np.isnan(ma[-1]) else 0
        current_price = float(closes[-1])
        ma_distance_pct = ((current_price - current_ma) / current_ma * 100) if current_ma > 0 else 0

        # Narrative
        if bounce_count >= 5:
            narrative = f"**Strong MA{self.ma_period} Bouncer** — {ticker} has bounced {bounce_count} times off the MA{self.ma_period}. "
        elif bounce_count >= 3:
            narrative = f"**Reliable MA{self.ma_period} Support** — {ticker} has bounced {bounce_count} times off the MA{self.ma_period}. "
        elif bounce_count >= 1:
            narrative = f"**Some MA{self.ma_period} Support** — {ticker} has {bounce_count} bounce(s) off MA{self.ma_period}. "
        else:
            narrative = f"No MA{self.ma_period} bounces detected for {ticker}. "

        narrative += f"Surge: +{surge['surge_pct']*100:.0f}% ({surge['low_date']} → {surge['high_date']}). "
        narrative += f"Current price ${current_price:.2f} is {ma_distance_pct:+.1f}% from MA{self.ma_period} (${current_ma:.2f})."

        if bounces:
            narrative += f" Avg recovery: {avg_recovery:.1f}%, avg {np.mean([b['bars_to_recover'] for b in bounces]):.0f} bars to recover."

        return {
            'detected': bounce_count >= 1,
            'bounce_count': bounce_count,
            'bounces': bounces,
            'surge': surge,
            'score': score,
            'ticker': ticker,
            'current_price': current_price,
            'current_ma': current_ma,
            'ma_distance_pct': round(float(ma_distance_pct), 2),
            'ma_period': self.ma_period,
            'avg_quality': round(float(avg_quality), 3),
            'avg_recovery_pct': round(float(avg_recovery), 1),
            'narrative': narrative,
        }


# ── Singleton ────────────────────────────────────────────────────────────
_engine_instance: Optional[MABounceEngine] = None

def get_ma_bounce_engine() -> MABounceEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = MABounceEngine()
    return _engine_instance
