# backend/momentum_engine.py
# Intraday Momentum Analyzer — Prismo breakout-leader detection
# Multi-layer: Ingest → Metrics → Leader → Compression → Signals → Narrative

from __future__ import annotations

import logging
import os
import math
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False
    logger.warning("yfinance not available — momentum analysis will be limited")

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


# ── Constants ────────────────────────────────────────────────────────────────
PRISMO_THRESHOLDS = {
    'rs_min':           1.10,   # RS vs benchmark ≥ 1.10
    'vol_surge_min':    1.50,   # Volume ≥ 1.5x avg
    'adx_coil_max':    25.0,   # ADX < 25 for coiling (pre-breakout compression)
    'roc_5m_min':       2.0,    # 5-minute ROC ≥ 2%
    'roc_15m_min':      4.0,   # 15-minute ROC ≥ 4%
    'vwap_dev_bull':    0.3,    # > 0.3% above VWAP = bullish
    'proximity_high':  95.0,   # ≥ 95% = price near session high
    'float_small':   100e6,    # Float < 100M shares = small float
    'eps_growth_min':  20.0,   # EPS growth ≥ 20% YoY
    'big_run_min':     50.0,   # ≥ 50% run before base
    'compression_days_min': 10, # at least 10 days of base
}


# ── Helper math functions ────────────────────────────────────────────────────
def _safe_div(a: float, b: float, default: float = 0.0) -> float:
    return a / b if b and not math.isnan(b) and b != 0 else default


def _rolling_std(arr: List[float], window: int) -> float:
    if len(arr) < window:
        return float(np.std(arr)) if arr else 0.0
    sub = arr[-window:]
    return float(np.std(sub))


def _rolling_mean(arr: List[float], window: int) -> float:
    if len(arr) < window:
        return float(np.mean(arr)) if arr else 0.0
    return float(np.mean(arr[-window:]))


def _linreg(xs: List[float], ys: List[float]) -> Tuple[float, float]:
    """Return (slope, intercept) of linear regression."""
    n = len(xs)
    if n < 2:
        return 0.0, ys[-1] if ys else 0.0
    x_mean = float(np.mean(xs))
    y_mean = float(np.mean(ys))
    num = sum((xs[i] - x_mean) * (ys[i] - y_mean) for i in range(n))
    den = sum((xs[i] - x_mean) ** 2 for i in range(n))
    slope = _safe_div(num, den)
    intercept = y_mean - slope * x_mean
    return slope, intercept


# ── Core engine ──────────────────────────────────────────────────────────────
class IntradayMomentumAnalyzer:
    """
    Prismo intraday momentum & breakout detector.
    Finds LEADERS (top performers 3/6/12m), detects post-run compression
    (tight base + diagonal ceiling), and scores breakout proximity.
    """

    def __init__(self, api_key: str, quillamaggie_mode: bool = True):
        self.api_key = api_key
        self._cache: Dict[str, Any] = {}
        self._cache_ts: Dict[str, float] = {}
        self._cache_ttl = 120  # seconds

    def _cached(self, key: str) -> Any:
        if key in self._cache and time.time() - self._cache_ts.get(key, 0) < self._cache_ttl:
            return self._cache[key]
        return None

    def _set_cache(self, key: str, val: Any) -> None:
        self._cache[key] = val
        self._cache_ts[key] = time.time()

    # ── Layer 1: Data Ingest ─────────────────────────────────────────────────

    def _fetch_intraday_yf(self, ticker: str, interval: str = '5m') -> List[Dict]:
        """Fetch intraday OHLCV via yfinance."""
        if not YF_AVAILABLE:
            return []
        key = f"intra_{ticker}_{interval}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        try:
            tkr = yf.Ticker(ticker)
            df = tkr.history(period='1d', interval=interval, auto_adjust=True)
            if df.empty:
                df = tkr.history(period='2d', interval=interval, auto_adjust=True)
            bars = []
            for ts, row in df.iterrows():
                bars.append({
                    'ts':     str(ts),
                    'open':   float(row.get('Open', 0)),
                    'high':   float(row.get('High', 0)),
                    'low':    float(row.get('Low', 0)),
                    'close':  float(row.get('Close', 0)),
                    'volume': float(row.get('Volume', 0)),
                })
            self._set_cache(key, bars)
            logger.info(f"Intraday {ticker} ({interval}): {len(bars)} bars")
            return bars
        except Exception as e:
            logger.error(f"yfinance intraday error {ticker} {interval}: {e}")
            return []

    def _fetch_daily_history_yf(self, ticker: str, period: str = '1y') -> List[Dict]:
        """Fetch daily OHLCV via yfinance for leader/compression analysis."""
        if not YF_AVAILABLE:
            return []
        key = f"daily_{ticker}_{period}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        try:
            tkr = yf.Ticker(ticker)
            df = tkr.history(period=period, interval='1d', auto_adjust=True)
            bars = []
            for ts, row in df.iterrows():
                bars.append({
                    'ts':     str(ts.date()),
                    'open':   float(row.get('Open', 0)),
                    'high':   float(row.get('High', 0)),
                    'low':    float(row.get('Low', 0)),
                    'close':  float(row.get('Close', 0)),
                    'volume': float(row.get('Volume', 0)),
                })
            self._set_cache(key, bars)
            logger.info(f"Daily {ticker} ({period}): {len(bars)} bars")
            return bars
        except Exception as e:
            logger.error(f"yfinance daily error {ticker}: {e}")
            return []

    def _fetch_fundamental_fmp(self, ticker: str) -> Dict:
        """Fetch float, EPS growth, sector from FMP with yfinance fallback."""
        key = f"fund_{ticker}"
        cached = self._cached(key)
        if cached is not None:
            return cached

        result: Dict[str, Any] = {}

        if REQUESTS_AVAILABLE and self.api_key:
            try:
                # ── Profile (sector, mktCap, beta) ──
                r = requests.get(
                    f"https://financialmodelingprep.com/stable/profile?symbol={ticker}&apikey={self.api_key}",
                    timeout=6,
                )
                profile = r.json() if r.ok else {}
                if isinstance(profile, list):
                    profile = profile[0] if profile else {}
                result.update({
                    'sector':   profile.get('sector', ''),
                    'industry': profile.get('industry', ''),
                    'mktCap':   profile.get('mktCap') or profile.get('marketCap'),
                    'beta':     profile.get('beta'),
                })

                # ── Float: dedicated endpoint ──
                r2 = requests.get(
                    f"https://financialmodelingprep.com/api/v4/shares_float?symbol={ticker}&apikey={self.api_key}",
                    timeout=6,
                )
                if r2.ok:
                    fd = r2.json()
                    if isinstance(fd, list) and fd:
                        fd = fd[0]
                    if isinstance(fd, dict):
                        result['floatShares'] = fd.get('floatShares') or fd.get('float')

                # Fallback from profile
                if not result.get('floatShares'):
                    result['floatShares'] = (
                        profile.get('floatShares') or profile.get('float')
                        or profile.get('sharesFloat')
                    )

                # ── EPS growth: annual income statements ──
                r3 = requests.get(
                    f"https://financialmodelingprep.com/api/v3/income-statement/{ticker}"
                    f"?limit=4&period=annual&apikey={self.api_key}",
                    timeout=6,
                )
                incomes = r3.json() if r3.ok and isinstance(r3.json(), list) else []
                if len(incomes) >= 2:
                    eps_cur  = incomes[0].get('epsdiluted') or incomes[0].get('eps') or 0
                    eps_prev = incomes[1].get('epsdiluted') or incomes[1].get('eps') or 0
                    if eps_cur and eps_prev and eps_prev != 0:
                        result['eps_growth'] = _safe_div(eps_cur - eps_prev, abs(eps_prev)) * 100

            except Exception as e:
                logger.warning(f"FMP fundamental error {ticker}: {e}")

        # ── yfinance fallback for float + EPS ──
        if YF_AVAILABLE and (not result.get('floatShares') or not result.get('eps_growth')):
            try:
                tkr  = yf.Ticker(ticker)
                info = tkr.info or {}
                if not result.get('floatShares'):
                    result['floatShares'] = info.get('floatShares')
                if not result.get('eps_growth'):
                    trailing = info.get('trailingEps') or 0
                    forward  = info.get('forwardEps') or 0
                    if trailing and trailing != 0:
                        result['eps_growth'] = _safe_div(forward - trailing, abs(trailing)) * 100
                if not result.get('mktCap'):
                    result['mktCap'] = info.get('marketCap')
                if not result.get('beta'):
                    result['beta'] = info.get('beta')
                if not result.get('sector'):
                    result['sector'] = info.get('sector', '')
            except Exception:
                pass

        self._set_cache(key, result)
        return result

    # ── Layer 2: Intraday Metrics ─────────────────────────────────────────────

    def _calc_roc(self, closes: List[float], period: int) -> float:
        if len(closes) <= period:
            return 0.0
        return _safe_div(closes[-1] - closes[-1 - period], closes[-1 - period]) * 100

    def _calc_vwap(self, bars: List[Dict]) -> float:
        cumvol = 0.0
        cumvp  = 0.0
        for b in bars:
            typ = (b['high'] + b['low'] + b['close']) / 3
            vol = b['volume']
            cumvp  += typ * vol
            cumvol += vol
        return _safe_div(cumvp, cumvol, bars[-1]['close'] if bars else 0)

    def _calc_rs(self, stock_closes: List[float], bench_closes: List[float], period: int = 12) -> float:
        s_roc = self._calc_roc(stock_closes, period)
        b_roc = self._calc_roc(bench_closes, period)
        if abs(b_roc) < 0.01:
            return 1.0 if s_roc >= 0 else 0.8
        return _safe_div(s_roc, b_roc, 1.0)

    def _calc_adx(self, bars: List[Dict], period: int = 14) -> float:
        if len(bars) < period + 1:
            return 20.0
        highs  = [b['high']  for b in bars]
        lows   = [b['low']   for b in bars]
        closes = [b['close'] for b in bars]
        trs = []
        for i in range(1, len(bars)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i-1]),
                abs(lows[i]  - closes[i-1]),
            )
            trs.append(tr)
        pDMs, nDMs = [], []
        for i in range(1, len(bars)):
            up   = highs[i]  - highs[i-1]
            down = lows[i-1] - lows[i]
            pDMs.append(max(up, 0)   if up   > down else 0)
            nDMs.append(max(down, 0) if down > up   else 0)
        atr  = _rolling_mean(trs[-period:],  period)
        pDI  = _safe_div(_rolling_mean(pDMs[-period:], period), atr) * 100
        nDI  = _safe_div(_rolling_mean(nDMs[-period:], period), atr) * 100
        dx   = _safe_div(abs(pDI - nDI), pDI + nDI) * 100
        return min(float(dx), 100.0)

    def _calc_bb_compression(self, closes: List[float], period: int = 20) -> Dict:
        if len(closes) < period:
            return {'width': None, 'compressed': False, 'compression_pct': 0,
                    'upper': 0, 'lower': 0, 'mid': 0}
        sub   = closes[-period:]
        mid   = float(np.mean(sub))
        std   = float(np.std(sub))
        upper = mid + 2 * std
        lower = mid - 2 * std
        width = _safe_div(upper - lower, mid) * 100
        if len(closes) >= period * 2:
            widths_hist = []
            for i in range(period, len(closes)):
                s = closes[i-period:i]
                m = float(np.mean(s))
                sv = float(np.std(s))
                w = _safe_div(4 * sv, m) * 100
                widths_hist.append(w)
            avg_w = float(np.mean(widths_hist)) or 1
            compressed = width < avg_w * 0.75
            compression_pct = round(_safe_div(avg_w - width, avg_w) * 100, 1)
        else:
            compressed = False
            compression_pct = 0
        return {
            'width':           round(width, 2),
            'compressed':      compressed,
            'compression_pct': max(0, compression_pct),
            'upper':           round(upper, 2),
            'lower':           round(lower, 2),
            'mid':             round(mid, 2),
        }

    def _calc_vol_surge(self, volumes: List[float], window: int = 20) -> float:
        if len(volumes) < 2:
            return 1.0
        avg = _rolling_mean(volumes[:-1], min(window, len(volumes) - 1)) or 1
        return _safe_div(volumes[-1], avg)

    def _calc_atr(self, bars: List[Dict], period: int = 14) -> float:
        if len(bars) < 2:
            return bars[-1]['high'] - bars[-1]['low'] if bars else 0
        trs = []
        for i in range(1, len(bars)):
            tr = max(
                bars[i]['high'] - bars[i]['low'],
                abs(bars[i]['high'] - bars[i-1]['close']),
                abs(bars[i]['low']  - bars[i-1]['close']),
            )
            trs.append(tr)
        return _rolling_mean(trs, min(period, len(trs)))

    # ── Layer 3a: Leader Score ────────────────────────────────────────────────

    def _calc_leader_score(self, daily: List[Dict], bench_daily: List[Dict]) -> Dict:
        """
        Leader score (0-100): top performers 3/6/12 months vs benchmark.
        Prismo looks for the top 2% stocks by relative performance.
        """
        def perf(bars: List[Dict], lookback: int) -> float:
            lb = min(lookback, len(bars) - 1)
            if lb < 1:
                return 0.0
            return _safe_div(bars[-1]['close'] - bars[-lb]['close'], bars[-lb]['close']) * 100

        r3m  = perf(daily,       63)
        r6m  = perf(daily,      126)
        r12m = perf(daily,      252)

        b3m  = perf(bench_daily,  63)
        b6m  = perf(bench_daily, 126)
        b12m = perf(bench_daily, 252)

        ex3m  = r3m  - b3m
        ex6m  = r6m  - b6m
        ex12m = r12m - b12m

        score = 0.0

        # 12-month absolute return: the "big run" prerequisite
        if   r12m >= 200: score += 35
        elif r12m >= 100: score += 28
        elif r12m >= 60:  score += 20
        elif r12m >= 30:  score += 12
        elif r12m >= 15:  score += 6

        # 6-month excess vs benchmark (relative strength)
        if   ex6m >= 50: score += 28
        elif ex6m >= 30: score += 22
        elif ex6m >= 15: score += 15
        elif ex6m >= 5:  score += 8
        elif ex6m >= 0:  score += 4

        # 3-month excess (recent leadership momentum)
        if   ex3m >= 30: score += 22
        elif ex3m >= 15: score += 16
        elif ex3m >= 5:  score += 10
        elif ex3m >= 0:  score += 4

        # Consistency bonus: all 3 TFs outperform
        if ex3m > 0 and ex6m > 0 and ex12m > 0:
            score += 15
        elif ex6m > 0 and ex12m > 0:
            score += 7

        return {
            'score':  round(min(score, 100), 1),
            'r3m':    round(r3m,  1),
            'r6m':    round(r6m,  1),
            'r12m':   round(r12m, 1),
            'b3m':    round(b3m,  1),
            'b6m':    round(b6m,  1),
            'b12m':   round(b12m, 1),
            'ex3m':   round(ex3m,  1),
            'ex6m':   round(ex6m,  1),
            'ex12m':  round(ex12m, 1),
        }

    # ── Layer 3b: Compression Pattern ────────────────────────────────────────

    def _detect_compression_pattern(self, daily: List[Dict]) -> Dict:
        """
        Prismo compression = tight base after a big run:
        1. Big run (≥50% gain in prior 6-12 months)
        2. Recent consolidation (10-30 days): narrowing high-low amplitude
        3. Volume drying up during base
        4. Diagonal ceiling (lower highs = downward-sloping resistance)
        5. Breakout proximity (price vs diagonal ceiling)
        """
        empty = {
            'detected': False, 'score': 0.0,
            'big_run_pct': 0.0, 'big_run_confirmed': False,
            'base_window_days': 0,
            'range_compression': 1.0, 'range_compressed': False,
            'vol_dry_up': 1.0, 'vol_contracting': False,
            'diagonal_ceiling': False,
            'ceiling_level': None, 'slope_pct_per_day': 0.0,
            'breakout_proximity': 0.0, 'distance_to_ceiling_pct': 0.0,
        }
        if len(daily) < 20:
            return empty

        current_price = daily[-1]['close']

        # ── 1. Big run detection ────────────────────────────────────────────
        # Look for max gain in prior 252 days (exclude last 30 days = base)
        run_end   = max(0, len(daily) - 30)
        run_start = max(0, len(daily) - 252)
        run_bars  = daily[run_start:run_end] if run_end > run_start else daily

        if run_bars:
            min_close = min(b['close'] for b in run_bars)
            max_close = max(b['close'] for b in run_bars)
            big_run = _safe_div(max_close - min_close, min_close) * 100
        else:
            big_run = 0.0
        big_run_confirmed = big_run >= PRISMO_THRESHOLDS['big_run_min']

        # ── 2. Base window detection ────────────────────────────────────────
        # Auto-detect: last 10-40 days depending on available data
        base_window  = min(30, max(10, len(daily) // 8))
        prior_window = min(60, len(daily) - base_window)
        if prior_window < 5:
            return empty

        base_bars  = daily[-base_window:]
        prior_bars = daily[-(base_window + prior_window):-base_window]

        # Range amplitude (high - low) per day
        base_ranges  = [b['high'] - b['low'] for b in base_bars  if b['high'] > b['low']]
        prior_ranges = [b['high'] - b['low'] for b in prior_bars if b['high'] > b['low']]

        avg_base_range  = float(np.mean(base_ranges))  if base_ranges  else 0
        avg_prior_range = float(np.mean(prior_ranges)) if prior_ranges else avg_base_range

        range_compression = _safe_div(avg_base_range, avg_prior_range, 1.0)
        range_compressed  = range_compression < 0.75

        # ── 3. Volume dry-up ────────────────────────────────────────────────
        base_vols  = [b['volume'] for b in base_bars  if b['volume'] > 0]
        prior_vols = [b['volume'] for b in prior_bars if b['volume'] > 0]

        avg_base_vol  = float(np.mean(base_vols))  if base_vols  else 0
        avg_prior_vol = float(np.mean(prior_vols)) if prior_vols else avg_base_vol

        vol_dry_up     = _safe_div(avg_base_vol, avg_prior_vol, 1.0)
        vol_contracting = vol_dry_up < 0.80

        # ── 4. Diagonal ceiling (linear regression on highs) ────────────────
        highs_base = [b['high'] for b in base_bars]
        n = len(highs_base)
        xs = list(range(n))
        ceiling_level     = max(highs_base) if highs_base else current_price
        slope_pct_per_day = 0.0
        diagonal_ceiling  = False

        if n >= 6:
            slope, intercept = _linreg(xs, highs_base)
            ceiling_level    = intercept + slope * (n - 1)  # extrapolate to latest bar
            # Normalize slope as % of price per day
            slope_pct_per_day = _safe_div(slope, float(np.mean(highs_base))) * 100
            # Diagonal ceiling: gently declining or flat highs = compressed resistance
            diagonal_ceiling = -1.5 <= slope_pct_per_day <= 0.3

        # ── 5. Breakout proximity ────────────────────────────────────────────
        distance_to_ceiling = _safe_div(ceiling_level - current_price, current_price) * 100
        distance_to_ceiling = max(distance_to_ceiling, -5.0)  # cap negative (above ceiling)

        # Score: 100 = at/above ceiling, 0 = far below
        # Linear: 0% away → 100, 5% away → 0
        breakout_proximity = round(max(0.0, 100.0 - distance_to_ceiling * 20), 1)

        # ── Compression score (0-100) ────────────────────────────────────────
        cs = 0.0

        # Big run prerequisite
        if   big_run >= 200: cs += 20
        elif big_run >= 100: cs += 16
        elif big_run >= 50:  cs += 10
        elif big_run >= 25:  cs +=  5

        # Range compression (tighter = better)
        if   range_compression <= 0.40: cs += 25
        elif range_compression <= 0.55: cs += 20
        elif range_compression <= 0.65: cs += 15
        elif range_compression <= 0.75: cs += 10
        elif range_compression <= 0.85: cs +=  4

        # Volume dry-up
        if   vol_dry_up <= 0.40: cs += 20
        elif vol_dry_up <= 0.55: cs += 16
        elif vol_dry_up <= 0.65: cs += 12
        elif vol_dry_up <= 0.80: cs +=  8
        elif vol_dry_up <= 0.90: cs +=  3

        # Diagonal ceiling
        if diagonal_ceiling:
            cs += 20
        elif abs(slope_pct_per_day) < 0.5:
            cs += 10  # flat is ok too

        # Breakout proximity bonus
        if   breakout_proximity >= 85: cs += 15
        elif breakout_proximity >= 65: cs +=  8
        elif breakout_proximity >= 45: cs +=  4

        detected = big_run_confirmed and range_compressed

        return {
            'detected':                detected,
            'score':                   round(min(cs, 100), 1),
            'big_run_pct':             round(big_run, 1),
            'big_run_confirmed':       big_run_confirmed,
            'base_window_days':        base_window,
            'range_compression':       round(range_compression, 3),
            'range_compressed':        range_compressed,
            'vol_dry_up':              round(vol_dry_up, 3),
            'vol_contracting':         vol_contracting,
            'diagonal_ceiling':        diagonal_ceiling,
            'ceiling_level':           round(ceiling_level, 2),
            'slope_pct_per_day':       round(slope_pct_per_day, 3),
            'breakout_proximity':      breakout_proximity,
            'distance_to_ceiling_pct': round(distance_to_ceiling, 2),
        }

    # ── Layer 3c: Prismo Score ────────────────────────────────────────────────

    def _score_prismo(self, metrics: Dict, fund: Dict,
                      leader: Dict, compression: Dict) -> Dict:
        """
        Prismo Score (0-100):
        Leader 30% | Compression 35% | Breakout Proximity 25% | Fundamentals 10%
        Designed to identify stocks that are:
          ① Market leaders (top 2% by 3/6/12m performance)
          ② In a tight base after a big run
          ③ Close to breaking the diagonal ceiling
        """
        score   = 0.0
        factors: List[str] = []

        # ── 1. Leader score (30%) ──────────────────────────────────────────
        leader_s = leader.get('score', 0)
        score += leader_s * 0.30
        r12m = leader.get('r12m', 0)
        ex6m = leader.get('ex6m', 0)
        ex3m = leader.get('ex3m', 0)
        if r12m >= 100:
            factors.append(f"Líder: +{r12m:.0f}% en 12 meses (top performer)")
        elif r12m >= 50:
            factors.append(f"Líder: +{r12m:.0f}% en 12 meses")
        if ex6m >= 20:
            factors.append(f"RS 6m: +{ex6m:.0f}% sobre benchmark (✓ líder sectorial)")
        elif ex6m >= 10:
            factors.append(f"RS 6m: +{ex6m:.0f}% sobre benchmark")
        if ex3m > 0 and leader.get('ex6m', 0) > 0 and leader.get('ex12m', 0) > 0:
            factors.append("Liderazgo consistente en 3/6/12 meses (✓)")

        # ── 2. Compression quality (35%) ──────────────────────────────────
        comp_s = compression.get('score', 0)
        score += comp_s * 0.35
        if compression.get('big_run_confirmed'):
            run = compression['big_run_pct']
            factors.append(f"Gran corrida previa +{run:.0f}% (✓ base válida)")
        if compression.get('range_compressed'):
            pct = round((1 - compression['range_compression']) * 100)
            factors.append(f"Compresión de rango -{pct}% (✓ base estrecha)")
        if compression.get('vol_contracting'):
            pct = round((1 - compression['vol_dry_up']) * 100)
            factors.append(f"Volumen secándose -{pct}% (✓ señal alcista)")
        if compression.get('diagonal_ceiling'):
            factors.append("Techo diagonal detectado (resistencia descendente, ✓)")

        # ── 3. Breakout proximity (25%) ────────────────────────────────────
        prox = compression.get('breakout_proximity', 0)
        score += prox * 0.25
        dist = compression.get('distance_to_ceiling_pct', 0)
        if prox >= 80:
            ceil_lvl = compression.get('ceiling_level')
            level_str = f"${ceil_lvl:.2f}" if ceil_lvl else "resistencia"
            factors.append(f"⚡ {dist:.1f}% del techo diagonal — breakout inminente ({level_str})")
        elif prox >= 55:
            factors.append(f"Acercándose al techo: {dist:.1f}% por debajo")

        # ── 4. Fundamentals (10%) ──────────────────────────────────────────
        s_fund = 0
        float_s = fund.get('floatShares')
        eps_g   = fund.get('eps_growth')
        if float_s and float_s < PRISMO_THRESHOLDS['float_small']:
            s_fund += 5
            factors.append(f"Float pequeño {float_s/1e6:.0f}M acciones (✓)")
        if eps_g and eps_g >= PRISMO_THRESHOLDS['eps_growth_min']:
            s_fund += 5
            factors.append(f"EPS growth +{eps_g:.0f}% YoY (✓ catalizador)")
        score += min(s_fund, 10)

        return {
            'score':   round(min(score, 100), 1),
            'factors': factors,
        }

    # ── Layer 4: Momentum Classification ─────────────────────────────────────

    def _classify_momentum(self, metrics: Dict) -> Dict:
        roc_5m  = metrics.get('roc_5m',  0)
        roc_15m = metrics.get('roc_15m', 0)
        rs      = metrics.get('rs', 1.0)
        vol_s   = metrics.get('vol_surge', 1.0)
        adx     = metrics.get('adx', 20)
        vwap_d  = metrics.get('vwap_deviation', 0)

        bull_pts = 0
        bear_pts = 0

        if roc_5m  >  3.0: bull_pts += 3
        elif roc_5m > 1.5: bull_pts += 2
        elif roc_5m > 0:   bull_pts += 1
        if roc_5m  < -3.0: bear_pts += 3
        elif roc_5m < -1.5: bear_pts += 2
        elif roc_5m < 0:    bear_pts += 1

        if roc_15m  >  5.0: bull_pts += 3
        elif roc_15m > 2.5: bull_pts += 2
        elif roc_15m > 0:   bull_pts += 1
        if roc_15m  < -5.0: bear_pts += 3
        elif roc_15m < -2.5: bear_pts += 2
        elif roc_15m < 0:    bear_pts += 1

        if rs >  1.3: bull_pts += 2
        elif rs > 1.1: bull_pts += 1
        if rs < 0.9:  bear_pts += 2
        elif rs < 0.7: bear_pts += 1

        if vol_s > 2.0: bull_pts += 2
        if vol_s > 1.5: bull_pts += 1

        if vwap_d >  0.5: bull_pts += 2
        elif vwap_d > 0.2: bull_pts += 1
        if vwap_d < -0.5: bear_pts += 2
        elif vwap_d < -0.2: bear_pts += 1

        if adx > 30:
            if roc_5m > 0: bull_pts += 1
            else: bear_pts += 1

        net = bull_pts - bear_pts
        if net >= 8:
            direction, strength = 'alcista', 'alto'
        elif net >= 4:
            direction, strength = 'alcista', 'moderado'
        elif net >= 1:
            direction, strength = 'alcista', 'leve'
        elif net <= -8:
            direction, strength = 'bajista', 'alto'
        elif net <= -4:
            direction, strength = 'bajista', 'moderado'
        elif net <= -1:
            direction, strength = 'bajista', 'leve'
        else:
            direction, strength = 'neutral', 'neutral'

        conf_raw   = min(abs(net) / 10.0, 1.0)
        confidence = round(50 + conf_raw * 50, 0)

        return {
            'direction':  direction,
            'strength':   strength,
            'bull_pts':   bull_pts,
            'bear_pts':   bear_pts,
            'net':        net,
            'confidence': int(confidence),
        }

    # ── Layer 5: Breakout Probability ─────────────────────────────────────────

    def _calc_breakout_probability(self, metrics: Dict, prismo_score: float,
                                   compression: Dict) -> float:
        """
        Breakout probability (0-99%):
        Prismo score 40% | Compression quality 30% | Proximity 20% | Intraday 10%
        """
        score = 0.0

        # 1. Prismo score (40%)
        score += prismo_score * 0.40

        # 2. Compression quality (30%)
        comp_s = compression.get('score', 0)
        score += comp_s * 0.30

        # 3. Breakout proximity (20%)
        prox = compression.get('breakout_proximity', 0)
        score += prox * 0.20

        # 4. Intraday confirmation (10%)
        roc_5m    = metrics.get('roc_5m', 0)
        vol_surge = metrics.get('vol_surge', 1.0)
        intra = 0
        if roc_5m > 2:     intra += 5
        if vol_surge >= 2: intra += 5
        elif vol_surge >= 1.5: intra += 3
        score += min(intra, 10)

        return round(min(max(score, 0), 99), 1)

    # ── Layer 6: Signals ──────────────────────────────────────────────────────

    def _generate_signals(self, metrics: Dict, momentum: Dict,
                          prismo: Dict, breakout_prob: float,
                          leader: Dict, compression: Dict) -> List[Dict]:
        signals = []
        direction  = momentum['direction']
        prismo_s   = prismo['score']
        vwap_d     = metrics.get('vwap_deviation', 0)
        rs         = metrics.get('rs', 1.0)
        roc_5m     = metrics.get('roc_5m', 0)
        vol_s      = metrics.get('vol_surge', 1.0)
        adx        = metrics.get('adx', 20)
        bb         = metrics.get('bb', {})
        session_high = metrics.get('session_high', 0)

        # ── Breakout alert ──────────────────────────────────────────────────
        if breakout_prob >= 80 and direction == 'alcista':
            ceil = compression.get('ceiling_level')
            level_str = f"${'%.2f' % ceil}" if ceil else "máximo sesión"
            signals.append({
                'type':     '🚀 BREAKOUT ALERT',
                'color':    'emerald',
                'message':  f"Prob. breakout {breakout_prob:.0f}% — "
                            f"monitorear ruptura de {level_str} con vol>2x",
                'priority': 1,
            })
        elif breakout_prob >= 60 and direction == 'alcista':
            signals.append({
                'type':     '📈 SETUP EN DESARROLLO',
                'color':    'yellow',
                'message':  f"Setup alcista building: proximidad {breakout_prob:.0f}%",
                'priority': 2,
            })

        # ── Prismo setup ────────────────────────────────────────────────────
        if prismo_s >= 70 and direction == 'alcista':
            signals.append({
                'type':     '⚡ PRISMO SETUP',
                'color':    'purple',
                'message':  f"Score {prismo_s:.0f}/100 — " + '; '.join(prismo['factors'][:2]),
                'priority': 1,
            })

        # ── Leader signal ───────────────────────────────────────────────────
        r12m = leader.get('r12m', 0)
        ex6m = leader.get('ex6m', 0)
        if r12m >= 100 or ex6m >= 30:
            signals.append({
                'type':     '🏆 LÍDER DE MERCADO',
                'color':    'blue',
                'message':  f"+{r12m:.0f}% en 12m | +{ex6m:.0f}% sobre benchmark 6m",
                'priority': 2,
            })

        # ── Compression / base ──────────────────────────────────────────────
        if compression.get('detected'):
            dist = compression.get('distance_to_ceiling_pct', 0)
            signals.append({
                'type':     '🔲 BASE ACTIVA',
                'color':    'orange',
                'message':  f"Compresión post-corrida confirmada — "
                            f"{dist:.1f}% del techo diagonal",
                'priority': 2,
            })

        # ── Diagonal ceiling proximity ──────────────────────────────────────
        prox = compression.get('breakout_proximity', 0)
        if prox >= 75 and compression.get('diagonal_ceiling'):
            signals.append({
                'type':     '📐 TECHO DIAGONAL',
                'color':    'yellow',
                'message':  f"Precio dentro del {compression.get('distance_to_ceiling_pct', 0):.1f}% "
                            f"del techo diagonal — vigilar ruptura",
                'priority': 2,
            })

        # ── VWAP ────────────────────────────────────────────────────────────
        if vwap_d > 0.5:
            signals.append({
                'type':    '📊 SOBRE VWAP',
                'color':   'emerald',
                'message': f"+{vwap_d:.2f}% sobre VWAP — compradores controlando sesión",
                'priority': 3,
            })
        elif vwap_d < -0.5:
            signals.append({
                'type':    '📊 BAJO VWAP',
                'color':   'red',
                'message': f"{vwap_d:.2f}% bajo VWAP — vendedores dominan intraday",
                'priority': 3,
            })

        # ── RS ──────────────────────────────────────────────────────────────
        if rs >= 1.3:
            signals.append({
                'type':    '💪 RS FUERTE',
                'color':   'emerald',
                'message': f"Relative Strength intraday {rs:.2f}x vs benchmark",
                'priority': 3,
            })
        elif rs <= 0.7:
            signals.append({
                'type':    '⚠️ RS DÉBIL',
                'color':   'red',
                'message': f"Relative Strength intraday {rs:.2f}x — underperforming",
                'priority': 3,
            })

        # ── Volume surge ────────────────────────────────────────────────────
        if vol_s >= 2.0:
            signals.append({
                'type':    '🔊 VOLUME SURGE',
                'color':   'blue',
                'message': f"Volumen {vol_s:.1f}x promedio — interés institucional intraday",
                'priority': 2,
            })

        # ── BB coiling ──────────────────────────────────────────────────────
        if bb.get('compressed') and adx < 25:
            signals.append({
                'type':    '🎯 BB COILING',
                'color':   'purple',
                'message': f"Bandas Bollinger {bb.get('compression_pct',0):.0f}% comprimidas, "
                           f"ADX {adx:.0f} — expansión pendiente",
                'priority': 3,
            })

        return signals

    # ── Layer 7: Narrative ────────────────────────────────────────────────────

    def _build_narrative(self, metrics: Dict, momentum: Dict, prismo: Dict,
                         breakout_prob: float, fund: Dict, benchmark: str,
                         leader: Dict, compression: Dict) -> str:
        direction  = momentum['direction']
        strength   = momentum['strength']
        prismo_s   = prismo['score']
        roc_5m     = metrics.get('roc_5m', 0)
        roc_15m    = metrics.get('roc_15m', 0)
        rs         = metrics.get('rs', 1.0)
        vol_s      = metrics.get('vol_surge', 1.0)
        vwap_d     = metrics.get('vwap_deviation', 0)
        adx        = metrics.get('adx', 20)
        bb         = metrics.get('bb', {})

        lines = []

        # Opening: momentum + Prismo score
        mom_label = f"Momentum {direction} {strength}"
        lines.append(f"**{mom_label}** (confianza: {momentum['confidence']}%)")

        # Leader context
        r12m = leader.get('r12m', 0)
        ex6m = leader.get('ex6m', 0)
        ex3m = leader.get('ex3m', 0)
        leader_s = leader.get('score', 0)
        if leader_s >= 70:
            lines.append(
                f"✅ **Líder de mercado** (Score {leader_s:.0f}/100): "
                f"+{r12m:.0f}% en 12m, +{ex6m:+.0f}% vs {benchmark} en 6m, "
                f"+{ex3m:+.0f}% en 3m — top performer sectorial"
            )
        elif leader_s >= 40:
            lines.append(
                f"📈 Performance moderada: +{r12m:.0f}% en 12m, "
                f"{ex6m:+.0f}% vs {benchmark} en 6m"
            )

        # Compression state
        if compression.get('detected'):
            run = compression['big_run_pct']
            rc  = round((1 - compression['range_compression']) * 100)
            vd  = round((1 - compression['vol_dry_up']) * 100)
            dist = compression['distance_to_ceiling_pct']
            lines.append(
                f"🔲 **Base activa** (post-corrida +{run:.0f}%): "
                f"rango comprimido -{rc}%, volumen -{vd}%, "
                f"precio {dist:.1f}% del techo diagonal"
            )
            if compression.get('diagonal_ceiling'):
                lines.append(
                    "📐 Techo diagonal confirmado (series de máximos descendentes) — "
                    "el punto de ruptura es la resistencia clave"
                )
        elif compression.get('big_run_confirmed'):
            run = compression['big_run_pct']
            lines.append(
                f"⚠️ Corrida previa +{run:.0f}% detectada pero sin base estrecha aún"
            )

        # Intraday metrics
        parts = []
        if roc_5m  != 0:  parts.append(f"ROC 5m {roc_5m:+.1f}%")
        if roc_15m != 0:  parts.append(f"ROC 15m {roc_15m:+.1f}%")
        if rs != 1.0:     parts.append(f"RS {rs:.2f}x vs {benchmark}")
        if vol_s != 1.0:  parts.append(f"Vol {vol_s:.1f}x avg")
        if parts:
            lines.append("Métricas intraday: " + " | ".join(parts))

        # VWAP
        if abs(vwap_d) > 0.1:
            vwap_dir = "sobre" if vwap_d > 0 else "bajo"
            lines.append(
                f"Precio {abs(vwap_d):.2f}% {vwap_dir} VWAP — "
                f"{'compradores controlan' if vwap_d > 0 else 'vendedores presionan'}"
            )

        # Intraday coiling
        if bb.get('compressed') and adx < 25:
            lines.append(
                f"⚡ Coiling intraday: BB {bb.get('compression_pct',0):.0f}% comprimido, "
                f"ADX {adx:.0f} — expansión pendiente"
            )

        # Breakout call
        if breakout_prob >= 80:
            ceil = compression.get('ceiling_level')
            ceil_str = f"${ceil:.2f}" if ceil else "techo diagonal"
            lines.append(
                f"🚀 **Proximidad de breakout {breakout_prob:.0f}%** — "
                f"vigilar ruptura de {ceil_str} con vol>2x para confirmar"
            )
        elif breakout_prob >= 60:
            lines.append(
                f"📈 Setup en construcción ({breakout_prob:.0f}%) — "
                "aguardar confirmación de volumen y precio"
            )

        # Prismo Score
        if prismo_s >= 70:
            lines.append(f"✅ **Score Prismo {prismo_s:.0f}/100** — setup power intraday válido")
        elif prismo_s >= 50:
            lines.append(f"⚠️ Score Prismo {prismo_s:.0f}/100 — setup parcial, falta confirmación")

        lines.append("*Análisis no constituye consejo de inversión. Gestione el riesgo siempre.*")
        return "\n\n".join(lines)

    # ── Main Analysis Entry Point ─────────────────────────────────────────────

    def analyze(self, ticker: str, benchmark: str = 'SPY',
                timeframes: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Full Prismo momentum analysis.
        Returns: metrics_by_tf, momentum, prismo, breakout_prob,
                 leader, compression, signals, narrative, chart_data, confidence.
        """
        if timeframes is None:
            timeframes = ['1m', '5m', '15m']

        start_time = time.time()
        logger.info(f"[Prismo] Starting analysis for {ticker} vs {benchmark}")

        # ── Fetch intraday data ───────────────────────────────────────────────
        bars_5m   = self._fetch_intraday_yf(ticker,    '5m')
        bench_5m  = self._fetch_intraday_yf(benchmark, '5m')
        bars_1m   = self._fetch_intraday_yf(ticker,    '1m')
        bench_1m  = self._fetch_intraday_yf(benchmark, '1m')
        bars_15m  = self._fetch_intraday_yf(ticker,    '15m')
        bench_15m = self._fetch_intraday_yf(benchmark, '15m')

        # ── Fetch daily data (for leader + compression) ───────────────────────
        daily       = self._fetch_daily_history_yf(ticker,    '1y')
        bench_daily = self._fetch_daily_history_yf(benchmark, '1y')

        # ── Fundamentals ─────────────────────────────────────────────────────
        fund = self._fetch_fundamental_fmp(ticker)

        # ── Data quality check ────────────────────────────────────────────────
        data_quality = 'high'   if len(bars_5m) >= 40 else \
                       'medium' if len(bars_5m) >= 20 else \
                       'low'    if len(bars_5m) >= 5  else 'insufficient'

        if data_quality == 'insufficient':
            return {
                'error':        f"Datos insuficientes para {ticker}. El mercado puede estar cerrado.",
                'ticker':       ticker,
                'data_quality': data_quality,
            }

        # ── Intraday metrics ──────────────────────────────────────────────────
        closes_5m  = [b['close']  for b in bars_5m]
        volumes_5m = [b['volume'] for b in bars_5m]
        closes_b5m = [b['close']  for b in bench_5m]  if bench_5m  else closes_5m

        closes_1m   = [b['close'] for b in bars_1m]   if bars_1m  else []
        closes_b1m  = [b['close'] for b in bench_1m]  if bench_1m else []
        closes_15m  = [b['close'] for b in bars_15m]  if bars_15m else []
        closes_b15m = [b['close'] for b in bench_15m] if bench_15m else []

        current_price  = closes_5m[-1]
        session_high   = max(b['high']   for b in bars_5m)
        session_low    = min(b['low']    for b in bars_5m)
        session_open   = bars_5m[0]['open']
        session_change = _safe_div(current_price - session_open, session_open) * 100

        vwap      = self._calc_vwap(bars_5m)
        vwap_dev  = _safe_div(current_price - vwap, vwap) * 100
        vol_surge = self._calc_vol_surge(volumes_5m)
        adx       = self._calc_adx(bars_5m)
        bb        = self._calc_bb_compression(closes_5m)
        atr       = self._calc_atr(bars_5m)

        roc_1m  = self._calc_roc(closes_1m,  3) if len(closes_1m)  > 3 else self._calc_roc(closes_5m, 1)
        roc_5m  = self._calc_roc(closes_5m,  3)
        roc_15m = self._calc_roc(closes_15m, 3) if len(closes_15m) > 3 else self._calc_roc(closes_5m, 9)
        roc_1h  = self._calc_roc(closes_5m,  12)

        rs_5m  = self._calc_rs(closes_5m,  closes_b5m,  6)
        rs_15m = self._calc_rs(closes_15m, closes_b15m, 6) if len(closes_15m) > 6 and len(closes_b15m) > 6 else rs_5m

        rng = session_high - session_low or 1
        proximity_to_high = min(100.0, _safe_div(current_price - session_low, rng) * 100)

        metrics = {
            'current_price':      round(current_price, 2),
            'session_high':       round(session_high, 2),
            'session_low':        round(session_low, 2),
            'session_open':       round(session_open, 2),
            'session_change_pct': round(session_change, 2),
            'vwap':               round(vwap, 2),
            'vwap_deviation':     round(vwap_dev, 2),
            'roc_1m':             round(roc_1m, 2),
            'roc_5m':             round(roc_5m, 2),
            'roc_15m':            round(roc_15m, 2),
            'roc_1h':             round(roc_1h, 2),
            'rs':                 round(rs_5m, 3),
            'rs_15m':             round(rs_15m, 3),
            'vol_surge':          round(vol_surge, 2),
            'adx':                round(adx, 1),
            'bb':                 bb,
            'atr':                round(atr, 3),
            'proximity_to_high':  round(proximity_to_high, 1),
            'bar_count':          len(bars_5m),
        }

        metrics_by_tf: List[Dict] = [
            {
                'timeframe':   '1m',
                'roc':         round(roc_1m, 2),
                'description': 'Micro momentum',
                'bars':        len(bars_1m),
            },
            {
                'timeframe':   '5m',
                'roc':         round(roc_5m, 2),
                'rs':          round(rs_5m, 3),
                'vol_surge':   round(vol_surge, 2),
                'adx':         round(adx, 1),
                'vwap_dev':    round(vwap_dev, 2),
                'description': 'Primary signal',
                'bars':        len(bars_5m),
            },
            {
                'timeframe':   '15m',
                'roc':         round(roc_15m, 2),
                'rs':          round(rs_15m, 3),
                'description': 'Trend context',
                'bars':        len(bars_15m),
            },
            {
                'timeframe':   '1h',
                'roc':         round(roc_1h, 2),
                'description': 'Macro intraday',
                'bars':        len(bars_5m) // 12,
            },
        ]

        # ── Leader score (multi-timeframe performance vs benchmark) ───────────
        leader = self._calc_leader_score(daily, bench_daily)

        # ── Compression pattern (post-run base detection) ─────────────────────
        compression = self._detect_compression_pattern(daily)

        # ── Prismo Score ───────────────────────────────────────────────────────
        momentum = self._classify_momentum(metrics)
        prismo   = self._score_prismo(metrics, fund, leader, compression)

        # ── Breakout probability ───────────────────────────────────────────────
        breakout_prob = self._calc_breakout_probability(metrics, prismo['score'], compression)

        # ── Signals ───────────────────────────────────────────────────────────
        signals = self._generate_signals(
            metrics, momentum, prismo, breakout_prob, leader, compression
        )

        # ── Narrative ─────────────────────────────────────────────────────────
        narrative = self._build_narrative(
            metrics, momentum, prismo, breakout_prob, fund, benchmark, leader, compression
        )

        # ── Chart data ────────────────────────────────────────────────────────
        chart_labels   = [b['ts'][-8:-3] for b in bars_5m]
        chart_prices   = [b['close']     for b in bars_5m]
        chart_vols     = [b['volume']    for b in bars_5m]
        chart_vwap     = []
        _cv, _cvol = 0.0, 0.0
        for b in bars_5m:
            typ    = (b['high'] + b['low'] + b['close']) / 3
            _cvol += b['volume']
            _cv   += typ * b['volume']
            chart_vwap.append(round(_safe_div(_cv, _cvol, b['close']), 2))

        chart_momentum = []
        for i in range(len(chart_prices)):
            if i < 5:
                chart_momentum.append(0)
            else:
                r = _safe_div(chart_prices[i] - chart_prices[i-5], chart_prices[i-5]) * 100
                chart_momentum.append(round(r, 2))

        # ── Confidence + Market status ─────────────────────────────────────────
        conf_base = momentum['confidence']
        conf_adj  = conf_base if data_quality == 'high' else \
                    int(conf_base * 0.85) if data_quality == 'medium' else \
                    int(conf_base * 0.65)

        now_utc    = datetime.utcnow()
        et_hour    = (now_utc.hour - 5) % 24
        market_open = 9 <= et_hour < 16 and now_utc.weekday() < 5
        if not market_open:
            market_status = 'closed'
            narrative = "⚠️ **Mercado cerrado** — mostrando datos de última sesión.\n\n" + narrative
        elif et_hour == 9:
            market_status = 'pre_market_transition'
        else:
            market_status = 'open'

        elapsed = round(time.time() - start_time, 2)
        logger.info(
            f"[Prismo] {ticker} done in {elapsed}s — "
            f"momentum={momentum['direction']}/{momentum['strength']}, "
            f"prismo={prismo['score']}, breakout_prob={breakout_prob}%, "
            f"leader={leader['score']}, compression={compression['score']}"
        )

        return {
            'ticker':        ticker,
            'benchmark':     benchmark,
            'market_status': market_status,
            'data_quality':  data_quality,
            'timestamp':     datetime.utcnow().isoformat() + 'Z',
            'elapsed_s':     elapsed,

            # Core outputs
            'metrics':       metrics,
            'metrics_by_tf': metrics_by_tf,
            'momentum':      momentum,
            'prismo':        prismo,
            'leader':        leader,
            'compression':   compression,
            'breakout_prob': breakout_prob,
            'signals':       signals,
            'narrative':     narrative,
            'confidence':    conf_adj,

            # Fundamentals snapshot
            'fundamental': {
                'float_shares': fund.get('floatShares'),
                'mkt_cap':      fund.get('mktCap'),
                'eps_growth':   fund.get('eps_growth'),
                'sector':       fund.get('sector'),
                'beta':         fund.get('beta'),
            },

            # Chart data
            'chart': {
                'labels':       chart_labels,
                'prices':       chart_prices,
                'vwap':         chart_vwap,
                'volumes':      chart_vols,
                'momentum':     chart_momentum,
                'session_high': session_high,
                'session_low':  session_low,
                'vwap_line':    round(vwap, 2),
            },
        }


# ── Module-level singleton ────────────────────────────────────────────────────
_analyzer: Optional[IntradayMomentumAnalyzer] = None


def get_momentum_analyzer() -> IntradayMomentumAnalyzer:
    global _analyzer
    if _analyzer is None:
        api_key  = os.getenv('FMP_API_KEY') or os.getenv('NEXT_PUBLIC_FMP_API_KEY', '')
        _analyzer = IntradayMomentumAnalyzer(api_key=api_key)
    return _analyzer
