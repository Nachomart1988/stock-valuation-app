# backend/ma_bounce_engine.py
# MA Bounce Detection Engine
# Finds stocks that surged X%+ in N months and counts bounces off MA10/MA20/MA50

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
    bounce off a chosen moving average (MA10, MA20 or MA50).

    Pipeline:
      1. Fetch daily price data
      2. Check if stock surged >= min_surge in the lookback window (max run-up)
      3. Compute MA
      4. Count bounce events: price riding above a rising MA dips into the MA
         zone and recovers — only counted after the surge low
      5. Score by bounce count + quality (proximity, speed, magnitude, volume)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_surge: float = 0.50,           # 50% minimum surge
        surge_lookback_months: int = 6,     # lookback for surge detection
        ma_period: int = 20,                # MA10 / MA20 / MA50
        bounce_tolerance: float = 0.02,     # 2% zone around MA counts as "touch"
        min_recovery_pct: float = 0.02,     # 2% bounce off MA to confirm recovery
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_surge = min_surge
        self.surge_lookback_months = surge_lookback_months
        self.ma_period = max(5, min(int(ma_period), 200))
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

        Uses maximum run-up (best low → subsequent high move) instead of the
        window's absolute min/max, so an early peak followed by a later surge
        is still detected.
        """
        if self.surge_lookback_months <= 0:
            lookback_days = len(closes)
        else:
            lookback_days = self.surge_lookback_months * 21  # ~21 trading days/month

        lookback_days = min(lookback_days, len(closes))
        window = closes[-lookback_days:]
        window_dates = dates[-lookback_days:]

        if len(window) < 20 or np.min(window) <= 0:
            return None

        # Max run-up: gain of each bar vs the lowest close seen up to that bar
        running_min = np.minimum.accumulate(window)
        runup = window / running_min - 1.0
        high_idx = int(np.argmax(runup))
        surge_pct = float(runup[high_idx])

        if high_idx == 0 or surge_pct < self.min_surge:
            return None

        low_idx = int(np.argmin(window[:high_idx + 1]))
        offset = len(closes) - lookback_days

        return {
            'surge_pct': surge_pct,
            'low_price': float(window[low_idx]),
            'high_price': float(window[high_idx]),
            'low_date': window_dates[low_idx],
            'high_date': window_dates[high_idx],
            'low_global_idx': offset + low_idx,
        }

    @staticmethod
    def _sma(values: np.ndarray, period: int) -> np.ndarray:
        """Vectorized simple moving average (NaN until `period` bars exist)."""
        n = len(values)
        out = np.full(n, np.nan)
        if n < period:
            return out
        csum = np.cumsum(np.insert(values.astype(float), 0, 0.0))
        out[period - 1:] = (csum[period:] - csum[:-period]) / period
        return out

    def _compute_ma(self, closes: np.ndarray) -> np.ndarray:
        """Compute simple moving average."""
        return self._sma(closes, self.ma_period)

    def _detect_bounces(self, dates: List[str], closes: np.ndarray,
                        lows: np.ndarray, volumes: np.ndarray,
                        ma: np.ndarray, start_idx_hint: Optional[int] = None) -> List[Dict]:
        """
        Detect bounce events off the moving average.

        A bounce is:
        1. Price was riding above the MA (majority of recent closes above it)
        2. The MA itself is rising (support in an uptrend, not resistance)
        3. Low dips into the MA zone without crashing through it
        4. Price recovers above MA and moves up >= min_recovery_pct from the low

        Only bounces after `start_idx_hint` (the surge low) are counted, so a
        pre-surge chop doesn't inflate the count.
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

        if start_idx_hint is not None:
            lookback_start = max(lookback_start, start_idx_hint)

        avg_vol = self._sma(volumes, 20)
        slope_gap = max(self.ma_period // 2, 3)
        tol_range = self.bounce_tolerance * 2.5

        i = lookback_start
        while i < n - 2:  # need at least 2 bars after for recovery check
            if np.isnan(ma[i]):
                i += 1
                continue

            ma_val = ma[i]
            upper_zone = ma_val * (1 + self.bounce_tolerance)
            lower_zone = ma_val * (1 - tol_range)

            # The touch must come from above: most recent closes traded over the MA
            prior_closes = closes[max(i - 5, 0):i]
            prior_ma = ma[max(i - 5, 0):i]
            valid = ~np.isnan(prior_ma)
            if valid.sum() < 3 or np.mean(prior_closes[valid] > prior_ma[valid]) < 0.6:
                i += 1
                continue

            # MA must be rising (allow ~1% of flatness during consolidations)
            slope_ref = i - slope_gap
            if slope_ref < 0 or np.isnan(ma[slope_ref]) or ma_val <= ma[slope_ref] * 0.99:
                i += 1
                continue

            # Low dips into or near the MA, but doesn't crash through it
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
                    # proximity spans the full touch zone (0 = zone edge, 1 = exact MA touch)
                    ma_proximity = max(0.0, 1.0 - abs(bounce_low - ma_val) / (ma_val * tol_range)) if ma_val > 0 else 0
                    recovery_speed = 1.0 / max(recovery_idx - i, 1)  # faster = better
                    recovery_magnitude = (closes[recovery_idx] - bounce_low) / bounce_low if bounce_low > 0 else 0
                    # Volume confirmation: bounce day demand vs 20-day average
                    if not np.isnan(avg_vol[i]) and avg_vol[i] > 0:
                        volume_ratio = volumes[i] / avg_vol[i]
                        volume_factor = min(volume_ratio / 1.5, 1.0)
                    else:
                        volume_ratio = 0.0
                        volume_factor = 0.5  # neutral when volume data is missing

                    quality = (ma_proximity * 0.25 + recovery_speed * 0.25 +
                               min(recovery_magnitude / 0.05, 1.0) * 0.35 +
                               volume_factor * 0.15)

                    bounces.append({
                        'date': dates[i],
                        'bounce_low': float(bounce_low),
                        'ma_value': float(ma_val),
                        'recovery_date': dates[recovery_idx],
                        'recovery_price': float(closes[recovery_idx]),
                        'recovery_pct': round(float(recovery_magnitude * 100), 1),
                        'bars_to_recover': recovery_idx - i,
                        'volume_ratio': round(float(volume_ratio), 2),
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

        # 3. Detect bounces (only after the surge low — the trend must exist)
        bounces = self._detect_bounces(
            daily['dates'], closes, daily['low'], daily['volume'], ma,
            start_idx_hint=surge.get('low_global_idx'),
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

        # Current MA value, distance and slope
        current_ma = float(ma[-1]) if not np.isnan(ma[-1]) else 0
        current_price = float(closes[-1])
        ma_distance_pct = ((current_price - current_ma) / current_ma * 100) if current_ma > 0 else 0
        slope_gap = max(self.ma_period // 2, 3)
        ma_rising = bool(
            len(ma) > slope_gap
            and not np.isnan(ma[-1]) and not np.isnan(ma[-1 - slope_gap])
            and ma[-1] > ma[-1 - slope_gap]
        )

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
        narrative += f"Current price ${current_price:.2f} is {ma_distance_pct:+.1f}% from MA{self.ma_period} (${current_ma:.2f}, {'rising' if ma_rising else 'flat/falling'})."

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
            'ma_rising': ma_rising,
            'above_ma': bool(current_ma > 0 and current_price > current_ma),
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
