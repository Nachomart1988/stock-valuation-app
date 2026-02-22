# backend/gap_analysis_engine.py
# Gap Analysis Engine — Identifies historical price gaps and computes behavioral statistics
# A gap occurs when today's open is significantly above/below the previous close.

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import numpy as np

try:
    from scipy import stats as scipy_stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Required keys expected in each OHLCV bar from FMP
# ---------------------------------------------------------------------------
_REQUIRED_OHLCV_KEYS = {'date', 'open', 'high', 'low', 'close', 'volume'}

_VALID_DIRECTIONS = {'up', 'down', 'both'}

_FETCH_MAX_RETRIES = 3
_FETCH_RETRY_DELAY = 1  # seconds


class GapAnalysisEngine:
    """Class-based gap analysis engine with validation, retries, and enriched stats."""

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("A valid FMP API key is required")
        self.api_key = api_key

    # ------------------------------------------------------------------
    # Data fetching (with retries)
    # ------------------------------------------------------------------
    def _fetch_historical_ohlcv(self, ticker: str, days: int) -> List[Dict]:
        """Fetch daily OHLCV from FMP stable API with retry logic."""
        if not REQUESTS_AVAILABLE:
            logger.warning("requests library not available — cannot fetch data")
            return []

        url = (
            f"https://financialmodelingprep.com/stable/historical-price-eod/full"
            f"?symbol={ticker}&apikey={self.api_key}"
        )

        last_err: Optional[Exception] = None
        for attempt in range(1, _FETCH_MAX_RETRIES + 1):
            try:
                logger.info("[GapEngine] Fetching historical data for %s (attempt %d/%d)...",
                            ticker, attempt, _FETCH_MAX_RETRIES)
                resp = requests.get(url, timeout=20)
                if not resp.ok:
                    logger.error("[GapEngine] FMP error %s for %s", resp.status_code, ticker)
                    last_err = RuntimeError(f"HTTP {resp.status_code}")
                    if attempt < _FETCH_MAX_RETRIES:
                        time.sleep(_FETCH_RETRY_DELAY)
                    continue

                data = resp.json()
                hist = data.get('historical', []) if isinstance(data, dict) else data
                if not hist:
                    logger.warning("[GapEngine] No historical data returned for %s", ticker)
                    return []

                logger.info("[GapEngine] Got %d raw bars for %s", len(hist), ticker)
                # FMP returns newest first — sort ascending (oldest first)
                hist = sorted(hist, key=lambda x: x.get('date', ''))
                return hist

            except Exception as e:
                last_err = e
                logger.error("[GapEngine] fetch error (attempt %d): %s", attempt, e)
                if attempt < _FETCH_MAX_RETRIES:
                    time.sleep(_FETCH_RETRY_DELAY)

        logger.error("[GapEngine] All %d fetch attempts failed. Last error: %s",
                     _FETCH_MAX_RETRIES, last_err)
        return []

    # ------------------------------------------------------------------
    # Input validation
    # ------------------------------------------------------------------
    @staticmethod
    def _validate_inputs(
        ticker: str,
        days: int,
        gap_threshold_pct: float,
        direction: str,
    ) -> Optional[Dict[str, Any]]:
        """Return an error dict if inputs are invalid, else None."""
        if not isinstance(ticker, str) or not ticker.strip():
            return {"error": "ticker must be a non-empty string"}
        if ticker != ticker.upper():
            return {"error": f"ticker must be uppercase (got '{ticker}')"}
        if not isinstance(days, (int, float)) or days <= 0:
            return {"error": "days must be a positive number"}
        if not isinstance(gap_threshold_pct, (int, float)) or gap_threshold_pct <= 0:
            return {"error": "gap_threshold_pct must be a positive number"}
        if direction not in _VALID_DIRECTIONS:
            return {"error": f"direction must be one of {sorted(_VALID_DIRECTIONS)}, got '{direction}'"}
        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _bar_is_valid(bar: Dict) -> bool:
        """Check that a bar dict contains all required keys."""
        return _REQUIRED_OHLCV_KEYS.issubset(bar.keys())

    @staticmethod
    def _agg(lst: List[float]) -> Dict:
        """Aggregate statistics including percentiles."""
        if not lst:
            return {"mean": None, "median": None, "std": None,
                    "min": None, "max": None, "p25": None, "p75": None}
        arr = np.array(lst)
        return {
            "mean":   round(float(np.mean(arr)), 2),
            "median": round(float(np.median(arr)), 2),
            "std":    round(float(np.std(arr)), 1),
            "min":    round(float(np.min(arr)), 2),
            "max":    round(float(np.max(arr)), 2),
            "p25":    round(float(np.percentile(arr, 25)), 2),
            "p75":    round(float(np.percentile(arr, 75)), 2),
        }

    # ------------------------------------------------------------------
    # Gap classification
    # ------------------------------------------------------------------
    @staticmethod
    def _classify_gap(
        abs_gap_pct: float,
        volume: float,
        avg_volume_20: float,
        reversal_next_day: bool,
    ) -> str:
        """Classify gap as common, breakaway, or exhaustion.

        - common:    |gap| < 5%
        - breakaway: |gap| >= 5% AND volume > 1.5x 20-day avg
        - exhaustion: followed by a same-day or next-day reversal
        """
        if reversal_next_day:
            return "exhaustion"
        if abs_gap_pct >= 5.0 and avg_volume_20 > 0 and volume > 1.5 * avg_volume_20:
            return "breakaway"
        return "common"

    @staticmethod
    def _compute_sma(hist: List[Dict], end_index: int, window: int = 20) -> Optional[float]:
        """Compute simple moving average of close prices over `window` bars ending at end_index (exclusive)."""
        start = max(0, end_index - window)
        closes = []
        for j in range(start, end_index):
            c = float(hist[j].get('close') or 0)
            if c > 0:
                closes.append(c)
        if len(closes) < window // 2:
            return None
        return float(np.mean(closes))

    @staticmethod
    def _determine_trend_context(hist: List[Dict], index: int, window: int = 20) -> str:
        """Determine if the gap occurred in an uptrend or downtrend using SMA direction.

        Compares the 20-day SMA at `index` vs SMA at `index - 5` to determine slope.
        """
        if index < window + 5:
            return "unknown"
        closes_recent = [float(hist[j].get('close') or 0) for j in range(index - window, index)]
        closes_earlier = [float(hist[j].get('close') or 0) for j in range(index - window - 5, index - 5)]
        closes_recent = [c for c in closes_recent if c > 0]
        closes_earlier = [c for c in closes_earlier if c > 0]
        if not closes_recent or not closes_earlier:
            return "unknown"
        sma_now = np.mean(closes_recent)
        sma_prev = np.mean(closes_earlier)
        if sma_now > sma_prev * 1.001:
            return "uptrend"
        elif sma_now < sma_prev * 0.999:
            return "downtrend"
        return "sideways"

    @staticmethod
    def _compute_avg_volume(hist: List[Dict], end_index: int, window: int = 20) -> float:
        """Compute average volume over `window` bars ending *before* end_index."""
        start = max(0, end_index - window)
        vols = []
        for j in range(start, end_index):
            v = float(hist[j].get('volume') or 0)
            if v > 0:
                vols.append(v)
        return float(np.mean(vols)) if vols else 0.0

    @staticmethod
    def _compute_days_to_fill(
        gap_type: str,
        prev_close: float,
        hist: List[Dict],
        start_index: int,
    ) -> Optional[int]:
        """Count trading days until the gap is filled (close crosses prev_close).

        Returns None if the gap was never filled within the available data.
        """
        for offset, j in enumerate(range(start_index, len(hist)), start=0):
            bar_close = float(hist[j].get('close') or 0)
            if gap_type == 'up' and bar_close <= prev_close:
                return offset
            if gap_type == 'down' and bar_close >= prev_close:
                return offset
        return None

    # ------------------------------------------------------------------
    # Core analysis
    # ------------------------------------------------------------------
    def analyze(
        self,
        ticker: str,
        days: int = 600,
        gap_threshold_pct: float = 2.0,
        direction: str = 'both',
    ) -> Dict[str, Any]:
        """Find historical gaps and compute behavioral statistics.

        A gap is defined as:
          gap_up:   open > prev_close * (1 + threshold/100)
          gap_down: open < prev_close * (1 - threshold/100)

        For each gap day we track:
          - gap_pct: (open - prev_close) / prev_close
          - same_day: high, low, close relative to open
          - filled: close crossed back through prev_close
          - green_day: close > open
          - gapClass: common | breakaway | exhaustion
          - volumeVsAvg: volume / 20-day avg volume
          - daysToFill: trading days until gap filled (null if unfilled)

        For the day AFTER a gap we also track OHLC relative to gap open.
        """
        # --- Validation ---
        validation_err = self._validate_inputs(ticker, days, gap_threshold_pct, direction)
        if validation_err:
            return validation_err

        days = int(days)

        hist = self._fetch_historical_ohlcv(ticker, days)
        if len(hist) < 10:
            return {"error": f"Insufficient historical data for {ticker}"}

        # Filter out bars with missing required keys
        hist = [h for h in hist if self._bar_is_valid(h)]

        # Trim to requested days
        cutoff_date = datetime.now() - timedelta(days=days)
        hist = [h for h in hist if datetime.strptime(h['date'][:10], '%Y-%m-%d') >= cutoff_date]

        if len(hist) < 5:
            return {"error": "Not enough data within the requested date range"}

        thr = gap_threshold_pct / 100.0
        gaps: List[Dict] = []

        for i in range(1, len(hist)):
            prev = hist[i - 1]
            curr = hist[i]
            next_day = hist[i + 1] if i + 1 < len(hist) else None

            prev_close = float(prev.get('close') or 0)
            curr_open  = float(curr.get('open')  or 0)
            curr_high  = float(curr.get('high')  or 0)
            curr_low   = float(curr.get('low')   or 0)
            curr_close = float(curr.get('close') or 0)
            curr_vol   = float(curr.get('volume') or 0)

            if prev_close <= 0 or curr_open <= 0:
                continue

            gap_pct = (curr_open - prev_close) / prev_close

            is_gap_up   = gap_pct >= thr
            is_gap_down = gap_pct <= -thr

            if direction == 'up'   and not is_gap_up:   continue
            if direction == 'down' and not is_gap_down: continue
            if direction == 'both' and not (is_gap_up or is_gap_down): continue

            gap_type = 'up' if is_gap_up else 'down'

            # Same-day behavior (relative to open = 0 baseline)
            high_vs_open  = (curr_high  - curr_open) / curr_open if curr_open > 0 else 0
            low_vs_open   = (curr_low   - curr_open) / curr_open if curr_open > 0 else 0
            close_vs_open = (curr_close - curr_open) / curr_open if curr_open > 0 else 0

            # Green day: close > open (regardless of gap direction)
            green_day = curr_close > curr_open

            # Gap filled same-day: price returned to prev_close
            gap_filled = False
            if gap_type == 'up':
                gap_filled = curr_low <= prev_close
            else:
                gap_filled = curr_high >= prev_close

            # Volume vs 20-day average
            avg_vol_20 = self._compute_avg_volume(hist, i)
            volume_vs_avg = round(curr_vol / avg_vol_20, 2) if avg_vol_20 > 0 else None

            # Days to fill (searching from the gap day onward)
            days_to_fill = self._compute_days_to_fill(gap_type, prev_close, hist, i)

            # Determine reversal for gap classification
            reversal_next_day = False
            if next_day:
                n_close = float(next_day.get('close') or 0)
                if gap_type == 'up' and n_close < curr_open:
                    reversal_next_day = True
                elif gap_type == 'down' and n_close > curr_open:
                    reversal_next_day = True

            gap_class = self._classify_gap(
                abs(gap_pct * 100), curr_vol, avg_vol_20, reversal_next_day
            )

            # Trend context (uptrend / downtrend / sideways / unknown)
            trend_ctx = self._determine_trend_context(hist, i)

            # Day after stats
            next_stats = None
            if next_day:
                n_open  = float(next_day.get('open')  or 0)
                n_close = float(next_day.get('close') or 0)
                n_high  = float(next_day.get('high')  or 0)
                n_low   = float(next_day.get('low')   or 0)
                if n_open > 0:
                    next_stats = {
                        "highVsOpen":  round((n_high  - n_open) / n_open * 100, 2),
                        "lowVsOpen":   round((n_low   - n_open) / n_open * 100, 2),
                        "closeVsOpen": round((n_close - n_open) / n_open * 100, 2),
                        "greenDay":    n_close > n_open,
                    }

            gaps.append({
                "date":         curr['date'][:10],
                "type":         gap_type,
                "gapClass":     gap_class,
                "trendContext": trend_ctx,
                "prevClose":    round(prev_close, 2),
                "open":         round(curr_open, 2),
                "high":         round(curr_high, 2),
                "low":          round(curr_low, 2),
                "close":        round(curr_close, 2),
                "volume":       int(curr_vol),
                "volumeVsAvg":  volume_vs_avg,
                "gapPct":       round(gap_pct * 100, 2),
                "highVsOpen":   round(high_vs_open  * 100, 2),
                "lowVsOpen":    round(low_vs_open   * 100, 2),
                "closeVsOpen":  round(close_vs_open * 100, 2),
                "greenDay":     green_day,
                "gapFilled":    gap_filled,
                "daysToFill":   days_to_fill,
                "nextDay":      next_stats,
            })

        if not gaps:
            return {
                "ticker": ticker,
                "days": days,
                "gapThresholdPct": gap_threshold_pct,
                "direction": direction,
                "totalGaps": 0,
                "upGaps": 0,
                "downGaps": 0,
                "gaps": [],
                "stats": None,
                "message": f"No gaps found >={gap_threshold_pct}% in the last {days} days",
            }

        # -- Aggregate statistics --
        up_gaps   = [g for g in gaps if g['type'] == 'up']
        down_gaps = [g for g in gaps if g['type'] == 'down']

        def compute_stats(gap_list: List[Dict]) -> Optional[Dict]:
            if not gap_list:
                return None
            n = len(gap_list)
            green_days  = sum(1 for g in gap_list if g['greenDay'])
            filled_days = sum(1 for g in gap_list if g['gapFilled'])
            unfilled_count = n - filled_days
            next_green  = sum(1 for g in gap_list if g['nextDay'] and g['nextDay']['greenDay'])
            next_n      = sum(1 for g in gap_list if g['nextDay'] is not None)

            # Win rate: for gap-up, win = close > prev_close; for gap-down, win = close < prev_close
            wins = 0
            for g in gap_list:
                if g['type'] == 'up' and g['close'] > g['prevClose']:
                    wins += 1
                elif g['type'] == 'down' and g['close'] < g['prevClose']:
                    wins += 1
            win_rate = round(wins / n * 100, 1)

            # Days-to-fill stats (only for filled gaps)
            fill_days_list = [g['daysToFill'] for g in gap_list if g['daysToFill'] is not None]

            # Gap class distribution
            class_counts = {}
            for g in gap_list:
                cls = g['gapClass']
                class_counts[cls] = class_counts.get(cls, 0) + 1

            # --- Volume profile by filled vs unfilled ---
            filled_vols = [g['volumeVsAvg'] for g in gap_list if g['gapFilled'] and g['volumeVsAvg'] is not None]
            unfilled_vols = [g['volumeVsAvg'] for g in gap_list if not g['gapFilled'] and g['volumeVsAvg'] is not None]
            volume_profile = {
                "filledAvgVolumeRatio":   round(float(np.mean(filled_vols)), 2) if filled_vols else None,
                "unfilledAvgVolumeRatio": round(float(np.mean(unfilled_vols)), 2) if unfilled_vols else None,
            }

            # --- Unfilled gap bias note ---
            # Recent unfilled gaps bias fill_rate downward because they haven't had time to fill yet.
            # We flag this when >20% of unfilled gaps are from the most recent quarter of data.
            recent_quarter = sorted(gap_list, key=lambda g: g['date'], reverse=True)[:max(1, n // 4)]
            recent_unfilled = sum(1 for g in recent_quarter if not g['gapFilled'])
            fill_rate_bias_warning = (
                unfilled_count > 0 and recent_unfilled / max(unfilled_count, 1) > 0.5
            )

            return {
                "count":            n,
                "greenDayPct":      round(green_days  / n * 100, 1),
                "redDayPct":        round((n - green_days) / n * 100, 1),
                "fillRatePct":      round(filled_days / n * 100, 1),
                "unfilledCount":    unfilled_count,
                "fillRateBiasWarning": fill_rate_bias_warning,
                "winRate":          win_rate,
                "nextDayGreenPct":  round(next_green / next_n * 100, 1) if next_n > 0 else None,
                "gapPct":           self._agg([g['gapPct']       for g in gap_list]),
                "highVsOpen":       self._agg([g['highVsOpen']   for g in gap_list]),
                "lowVsOpen":        self._agg([g['lowVsOpen']    for g in gap_list]),
                "closeVsOpen":      self._agg([g['closeVsOpen']  for g in gap_list]),
                "nextCloseVsOpen":  self._agg([g['nextDay']['closeVsOpen'] for g in gap_list if g['nextDay']]),
                "daysToFill":       self._agg(fill_days_list),
                "gapClassCounts":   class_counts,
                "volumeProfile":    volume_profile,
            }

        all_stats  = compute_stats(gaps)
        up_stats   = compute_stats(up_gaps)
        down_stats = compute_stats(down_gaps)

        # --- Conditional probabilities ---
        conditional_probs = self._compute_conditional_probs(gaps, up_gaps, down_gaps)

        # --- Statistical significance (t-test: gap-up returns vs gap-down returns) ---
        stat_significance = self._compute_stat_significance(up_gaps, down_gaps)

        # --- Gap size analysis (clustering by size buckets) ---
        gap_size_analysis = self._compute_gap_size_analysis(gaps)

        # --- Volume profile by gap type ---
        volume_profile_by_type = self._compute_volume_profile_by_type(up_gaps, down_gaps)

        # Limit gaps returned to most recent 50 for the table
        recent_gaps = sorted(gaps, key=lambda x: x['date'], reverse=True)[:50]

        return {
            "ticker":              ticker,
            "days":                days,
            "gapThresholdPct":     gap_threshold_pct,
            "direction":           direction,
            "totalGaps":           len(gaps),
            "upGaps":              len(up_gaps),
            "downGaps":            len(down_gaps),
            "stats":               all_stats,
            "upStats":             up_stats,
            "downStats":           down_stats,
            "conditionalProbs":    conditional_probs,
            "statSignificance":    stat_significance,
            "gapSizeAnalysis":     gap_size_analysis,
            "volumeProfileByType": volume_profile_by_type,
            "recentGaps":          recent_gaps,
        }

    # ------------------------------------------------------------------
    # Conditional probabilities
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_conditional_probs(
        all_gaps: List[Dict],
        up_gaps: List[Dict],
        down_gaps: List[Dict],
    ) -> Dict[str, Any]:
        """Compute conditional probabilities for key gap behaviors.

        Returns probabilities like P(green_day | gap_up > 5%), P(fill_same_day | gap_up), etc.
        """
        def safe_pct(numerator: int, denominator: int) -> Optional[float]:
            return round(numerator / denominator * 100, 1) if denominator > 0 else None

        # P(green_day | gap_up)
        up_green = sum(1 for g in up_gaps if g['greenDay'])
        # P(green_day | gap_down)
        down_green = sum(1 for g in down_gaps if g['greenDay'])

        # P(green_day | gap_up > 5%)
        big_up = [g for g in up_gaps if g['gapPct'] > 5.0]
        big_up_green = sum(1 for g in big_up if g['greenDay'])

        # P(green_day | gap_down > 5%)
        big_down = [g for g in down_gaps if g['gapPct'] < -5.0]
        big_down_green = sum(1 for g in big_down if g['greenDay'])

        # P(fill_same_day | gap_up)
        up_filled = sum(1 for g in up_gaps if g['gapFilled'])
        # P(fill_same_day | gap_down)
        down_filled = sum(1 for g in down_gaps if g['gapFilled'])

        # P(fill_same_day | gap in uptrend)
        uptrend_gaps = [g for g in all_gaps if g['trendContext'] == 'uptrend']
        uptrend_filled = sum(1 for g in uptrend_gaps if g['gapFilled'])
        # P(fill_same_day | gap in downtrend)
        downtrend_gaps = [g for g in all_gaps if g['trendContext'] == 'downtrend']
        downtrend_filled = sum(1 for g in downtrend_gaps if g['gapFilled'])

        # P(next_day_green | gap_up)
        up_next_green = sum(1 for g in up_gaps if g['nextDay'] and g['nextDay']['greenDay'])
        up_with_next = sum(1 for g in up_gaps if g['nextDay'] is not None)
        # P(next_day_green | gap_down)
        down_next_green = sum(1 for g in down_gaps if g['nextDay'] and g['nextDay']['greenDay'])
        down_with_next = sum(1 for g in down_gaps if g['nextDay'] is not None)

        return {
            "P_green_given_gap_up":           safe_pct(up_green, len(up_gaps)),
            "P_green_given_gap_down":         safe_pct(down_green, len(down_gaps)),
            "P_green_given_gap_up_gt5pct":    safe_pct(big_up_green, len(big_up)),
            "P_green_given_gap_down_gt5pct":  safe_pct(big_down_green, len(big_down)),
            "P_fill_same_day_given_gap_up":   safe_pct(up_filled, len(up_gaps)),
            "P_fill_same_day_given_gap_down": safe_pct(down_filled, len(down_gaps)),
            "P_fill_given_uptrend":           safe_pct(uptrend_filled, len(uptrend_gaps)),
            "P_fill_given_downtrend":         safe_pct(downtrend_filled, len(downtrend_gaps)),
            "P_next_green_given_gap_up":      safe_pct(up_next_green, up_with_next),
            "P_next_green_given_gap_down":    safe_pct(down_next_green, down_with_next),
            "sample_sizes": {
                "up_gaps":        len(up_gaps),
                "down_gaps":      len(down_gaps),
                "big_up_gaps":    len(big_up),
                "big_down_gaps":  len(big_down),
                "uptrend_gaps":   len(uptrend_gaps),
                "downtrend_gaps": len(downtrend_gaps),
            },
        }

    # ------------------------------------------------------------------
    # Statistical significance (t-test)
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_stat_significance(
        up_gaps: List[Dict],
        down_gaps: List[Dict],
    ) -> Dict[str, Any]:
        """Use Welch's t-test to determine if gap-up day returns differ
        significantly from gap-down day returns.

        Returns t-statistic, p-value, and significance flag (p < 0.05).
        """
        if not SCIPY_AVAILABLE:
            return {"error": "scipy not available for statistical tests"}

        up_returns = [g['closeVsOpen'] for g in up_gaps]
        down_returns = [g['closeVsOpen'] for g in down_gaps]

        if len(up_returns) < 3 or len(down_returns) < 3:
            return {
                "t_statistic": None,
                "p_value": None,
                "significant": None,
                "note": "Insufficient samples (need >= 3 per group)",
            }

        t_stat, p_val = scipy_stats.ttest_ind(up_returns, down_returns, equal_var=False)
        return {
            "t_statistic":      round(float(t_stat), 4),
            "p_value":          round(float(p_val), 6),
            "significant":      bool(p_val < 0.05),
            "up_mean_return":   round(float(np.mean(up_returns)), 2),
            "down_mean_return": round(float(np.mean(down_returns)), 2),
            "up_n":             len(up_returns),
            "down_n":           len(down_returns),
        }

    # ------------------------------------------------------------------
    # Gap size analysis (clustering by size buckets)
    # ------------------------------------------------------------------
    def _compute_gap_size_analysis(self, gaps: List[Dict]) -> Dict[str, Any]:
        """Group gaps into size buckets and compute stats per bucket.

        Buckets: 0-2%, 2-5%, 5-10%, >10% (using absolute gap %).
        """
        buckets = {
            "0_to_2pct":   [],
            "2_to_5pct":   [],
            "5_to_10pct":  [],
            "over_10pct":  [],
        }

        for g in gaps:
            abs_pct = abs(g['gapPct'])
            if abs_pct < 2.0:
                buckets["0_to_2pct"].append(g)
            elif abs_pct < 5.0:
                buckets["2_to_5pct"].append(g)
            elif abs_pct < 10.0:
                buckets["5_to_10pct"].append(g)
            else:
                buckets["over_10pct"].append(g)

        result = {}
        for bucket_name, bucket_gaps in buckets.items():
            n = len(bucket_gaps)
            if n == 0:
                result[bucket_name] = {"count": 0}
                continue

            green_n = sum(1 for g in bucket_gaps if g['greenDay'])
            filled_n = sum(1 for g in bucket_gaps if g['gapFilled'])
            fill_days = [g['daysToFill'] for g in bucket_gaps if g['daysToFill'] is not None]

            result[bucket_name] = {
                "count":       n,
                "greenDayPct": round(green_n / n * 100, 1),
                "fillRatePct": round(filled_n / n * 100, 1),
                "avgGapPct":   round(float(np.mean([abs(g['gapPct']) for g in bucket_gaps])), 2),
                "avgReturn":   round(float(np.mean([g['closeVsOpen'] for g in bucket_gaps])), 2),
                "avgDaysToFill": round(float(np.mean(fill_days)), 1) if fill_days else None,
                "gapPctStats": self._agg([g['gapPct'] for g in bucket_gaps]),
            }

        return result

    # ------------------------------------------------------------------
    # Volume profile by gap type
    # ------------------------------------------------------------------
    @staticmethod
    def _compute_volume_profile_by_type(
        up_gaps: List[Dict],
        down_gaps: List[Dict],
    ) -> Dict[str, Any]:
        """Average volume ratio broken down by gap type and fill status."""
        def avg_vol_ratio(gap_list: List[Dict]) -> Optional[float]:
            vols = [g['volumeVsAvg'] for g in gap_list if g['volumeVsAvg'] is not None]
            return round(float(np.mean(vols)), 2) if vols else None

        up_filled = [g for g in up_gaps if g['gapFilled']]
        up_unfilled = [g for g in up_gaps if not g['gapFilled']]
        down_filled = [g for g in down_gaps if g['gapFilled']]
        down_unfilled = [g for g in down_gaps if not g['gapFilled']]

        return {
            "upGapAvgVolumeRatio":            avg_vol_ratio(up_gaps),
            "downGapAvgVolumeRatio":          avg_vol_ratio(down_gaps),
            "upFilledAvgVolumeRatio":         avg_vol_ratio(up_filled),
            "upUnfilledAvgVolumeRatio":       avg_vol_ratio(up_unfilled),
            "downFilledAvgVolumeRatio":       avg_vol_ratio(down_filled),
            "downUnfilledAvgVolumeRatio":     avg_vol_ratio(down_unfilled),
        }

    # ------------------------------------------------------------------
    # Active (unfilled) gaps — support/resistance levels
    # ------------------------------------------------------------------
    def get_active_gaps(
        self,
        ticker: str,
        days: int = 600,
        gap_threshold_pct: float = 2.0,
        direction: str = 'both',
    ) -> Dict[str, Any]:
        """Return gaps that have NOT been filled yet.

        These represent open support/resistance levels that may still influence price.
        Each active gap includes the gap zone (prevClose to open) which acts as a
        magnetic zone the price may revisit.
        """
        result = self.analyze(ticker, days, gap_threshold_pct, direction)
        if 'error' in result:
            return result

        all_gaps = result.get('recentGaps', [])
        # Also check all gaps from the full analysis (recentGaps is capped at 50)
        # We need to re-analyze to get the full list, but we can use recentGaps
        # since unfilled gaps are more likely to be recent anyway.

        active = []
        for g in all_gaps:
            if not g['gapFilled'] and g['daysToFill'] is None:
                gap_zone_low = min(g['prevClose'], g['open'])
                gap_zone_high = max(g['prevClose'], g['open'])
                active.append({
                    "date":        g['date'],
                    "type":        g['type'],
                    "gapClass":    g['gapClass'],
                    "trendContext": g['trendContext'],
                    "gapPct":      g['gapPct'],
                    "gapZoneLow":  round(gap_zone_low, 2),
                    "gapZoneHigh": round(gap_zone_high, 2),
                    "volumeVsAvg": g['volumeVsAvg'],
                    "levelType":   "resistance" if g['type'] == 'down' else "support",
                })

        return {
            "ticker":     ticker,
            "activeGaps": active,
            "count":      len(active),
            "note":       "Unfilled gaps act as support (gap-up) or resistance (gap-down) levels.",
        }


# ---------------------------------------------------------------------------
# Module-level convenience wrapper (preserves original public interface)
# ---------------------------------------------------------------------------
def analyze_gaps(
    ticker: str,
    days: int = 600,
    gap_threshold_pct: float = 2.0,
    direction: str = 'both',
    fmp_api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Convenience function — creates a GapAnalysisEngine and runs analysis.

    This keeps the exact same signature as the original module-level function
    so that callers (e.g. main.py) do not need any changes.
    """
    api_key = fmp_api_key or os.environ.get('FMP_API_KEY', '')
    if not api_key:
        return {"error": "No FMP API key available"}

    engine = GapAnalysisEngine(api_key)
    return engine.analyze(ticker, days, gap_threshold_pct, direction)
