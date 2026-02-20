# backend/gap_analysis_engine.py
# Gap Analysis Engine — Identifies historical price gaps and computes behavioral statistics
# A gap occurs when today's open is significantly above/below the previous close.

import numpy as np
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import os

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


def fetch_historical_ohlcv(ticker: str, days: int, api_key: str) -> List[Dict]:
    """Fetch daily OHLCV from FMP stable API."""
    if not REQUESTS_AVAILABLE:
        return []
    try:
        # Add buffer to account for weekends/holidays
        limit = max(days + 60, 300)
        url = (
            f"https://financialmodelingprep.com/stable/historical-price-full"
            f"?symbol={ticker}&limit={limit}&apikey={api_key}"
        )
        resp = requests.get(url, timeout=15)
        if not resp.ok:
            print(f"[GapEngine] FMP error {resp.status_code} for {ticker}")
            return []
        data = resp.json()
        hist = data.get('historical', []) if isinstance(data, dict) else data
        # Sort ascending (oldest first)
        hist = sorted(hist, key=lambda x: x.get('date', ''))
        return hist
    except Exception as e:
        print(f"[GapEngine] fetch error: {e}")
        return []


def analyze_gaps(
    ticker: str,
    days: int = 600,
    gap_threshold_pct: float = 2.0,
    direction: str = 'both',   # 'up', 'down', 'both'
    fmp_api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Find historical gaps and compute behavioral statistics.

    A gap is defined as:
      gap_up:   open > prev_close * (1 + threshold/100)
      gap_down: open < prev_close * (1 - threshold/100)

    For each gap day we track:
      - gap_pct: (open - prev_close) / prev_close
      - same_day: high, low, close relative to open
      - filled: close crossed back through prev_close
      - green_day: close > open (for gap up) OR close < open (for gap down) [standard green/red]

    For the day AFTER a gap we also track OHLC relative to gap open.
    """
    api_key = fmp_api_key or os.environ.get('FMP_API_KEY', '')
    if not api_key:
        return {"error": "No FMP API key available"}

    hist = fetch_historical_ohlcv(ticker, days, api_key)
    if len(hist) < 10:
        return {"error": f"Insufficient historical data for {ticker}"}

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

        # Gap filled: price returned to prev_close on the same day
        gap_filled = False
        if gap_type == 'up':
            gap_filled = curr_low <= prev_close
        else:
            gap_filled = curr_high >= prev_close

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
            "prevClose":    round(prev_close, 2),
            "open":         round(curr_open, 2),
            "high":         round(curr_high, 2),
            "low":          round(curr_low, 2),
            "close":        round(curr_close, 2),
            "volume":       int(curr_vol),
            "gapPct":       round(gap_pct * 100, 2),
            "highVsOpen":   round(high_vs_open  * 100, 2),
            "lowVsOpen":    round(low_vs_open   * 100, 2),
            "closeVsOpen":  round(close_vs_open * 100, 2),
            "greenDay":     green_day,
            "gapFilled":    gap_filled,
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
            "message": f"No gaps found ≥{gap_threshold_pct}% in the last {days} days",
        }

    # ── Aggregate statistics ──
    def agg(lst: List[float]) -> Dict:
        if not lst:
            return {"mean": None, "median": None, "std": None, "min": None, "max": None}
        arr = np.array(lst)
        return {
            "mean":   round(float(np.mean(arr)), 2),
            "median": round(float(np.median(arr)), 2),
            "std":    round(float(np.std(arr)), 1),
            "min":    round(float(np.min(arr)), 2),
            "max":    round(float(np.max(arr)), 2),
        }

    up_gaps   = [g for g in gaps if g['type'] == 'up']
    down_gaps = [g for g in gaps if g['type'] == 'down']

    def compute_stats(gap_list: List[Dict]) -> Optional[Dict]:
        if not gap_list:
            return None
        n = len(gap_list)
        green_days  = sum(1 for g in gap_list if g['greenDay'])
        filled_days = sum(1 for g in gap_list if g['gapFilled'])
        next_green  = sum(1 for g in gap_list if g['nextDay'] and g['nextDay']['greenDay'])
        next_n      = sum(1 for g in gap_list if g['nextDay'] is not None)
        return {
            "count":           n,
            "greenDayPct":     round(green_days  / n * 100, 1),
            "redDayPct":       round((n - green_days) / n * 100, 1),
            "fillRatePct":     round(filled_days / n * 100, 1),
            "nextDayGreenPct": round(next_green / next_n * 100, 1) if next_n > 0 else None,
            "gapPct":          agg([g['gapPct']       for g in gap_list]),
            "highVsOpen":      agg([g['highVsOpen']   for g in gap_list]),
            "lowVsOpen":       agg([g['lowVsOpen']    for g in gap_list]),
            "closeVsOpen":     agg([g['closeVsOpen']  for g in gap_list]),
            "nextCloseVsOpen": agg([g['nextDay']['closeVsOpen'] for g in gap_list if g['nextDay']]),
        }

    all_stats  = compute_stats(gaps)
    up_stats   = compute_stats(up_gaps)
    down_stats = compute_stats(down_gaps)

    # Limit gaps returned to most recent 50 for the table
    recent_gaps = sorted(gaps, key=lambda x: x['date'], reverse=True)[:50]

    return {
        "ticker":          ticker,
        "days":            days,
        "gapThresholdPct": gap_threshold_pct,
        "direction":       direction,
        "totalGaps":       len(gaps),
        "upGaps":          len(up_gaps),
        "downGaps":        len(down_gaps),
        "stats":           all_stats,
        "upStats":         up_stats,
        "downStats":       down_stats,
        "recentGaps":      recent_gaps,
    }
