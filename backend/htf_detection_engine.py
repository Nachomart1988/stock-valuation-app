# backend/htf_detection_engine.py
# High-Tight Flag (HTF) Detection Engine — Quillamaggie Style
# Detects explosive surges (100%+) followed by tight consolidation with volume dry-up

from __future__ import annotations
import logging
import numpy as np
import os
import requests
import warnings
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from scipy import stats

warnings.filterwarnings('ignore')
logger = logging.getLogger(__name__)

# ── Optional ML dependencies ────────────────────────────────────────────
try:
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not available — HTF ML scoring will use heuristic fallback")

TRADING_DAYS_WEEK = 5
TRADING_DAYS_YEAR = 252


class HTFDetectionEngine:
    """
    Hedge-fund grade High-Tight Flag detector.

    Pipeline:
      1. Ingest: fetch weekly/daily prices + volume + earnings from FMP
      2. Catalyst Detection: correlate surges with EPS beats / news events
      3. Pattern Metrics: surge %, flag range %, vol dry-up ratio, RS vs SPY
      4. ML Layer: RF/GBM classifier on labeled features (fallback: heuristic rules)
      5. Breakout Fusion: composite score 0-100

    Quillamaggie thresholds:
      - Surge: ≥80% move in 4-12 weeks (classic = 100%, relaxed = 80%)
      - Flag: tight range ≤10-15%, duration 3-8 weeks, volume declining
      - Breakout: price > flag high on ≥2x avg volume
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_surge: float = 0.80,        # 80% minimum surge
        max_flag_range: float = 0.15,    # 15% max flag range
        flag_weeks: Tuple[int, int] = (2, 10),  # 2-10 weeks flag duration
        surge_weeks: Tuple[int, int] = (3, 16),  # 3-16 weeks surge window
        ml_mode: bool = True,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_surge = min_surge
        self.max_flag_range = max_flag_range
        self.flag_weeks_range = flag_weeks
        self.surge_weeks_range = surge_weeks
        self.ml_mode = ml_mode and SKLEARN_AVAILABLE
        self._session = requests.Session()
        self._ml_model = None
        self._scaler = None

    # ── FMP Helpers ──────────────────────────────────────────────────────

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
        """Fetch daily OHLCV from FMP historical-price-eod."""
        data = self._fetch_json('historical-price-eod/full', {
            'symbol': ticker,
        })
        if not data or not isinstance(data, list):
            # Try alternate format
            if isinstance(data, dict) and 'historical' in data:
                data = data['historical']
            else:
                return None

        # Sort ascending by date
        data = sorted(data, key=lambda x: x.get('date', ''))
        if len(data) < 100:
            return None

        # Limit to requested days
        data = data[-days:]

        dates = [d['date'] for d in data]
        opens = np.array([d.get('open', d.get('close', 0)) for d in data], dtype=float)
        highs = np.array([d.get('high', d.get('close', 0)) for d in data], dtype=float)
        lows = np.array([d.get('low', d.get('close', 0)) for d in data], dtype=float)
        closes = np.array([d.get('close', 0) for d in data], dtype=float)
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)

        return {
            'dates': dates, 'open': opens, 'high': highs,
            'low': lows, 'close': closes, 'volume': volumes,
        }

    def _fetch_spy_prices(self, days: int = 756) -> Optional[np.ndarray]:
        """Fetch SPY closes for relative strength calculation."""
        data = self._fetch_daily_prices('SPY', days)
        if data is None:
            return None
        return data['close']

    def _fetch_earnings(self, ticker: str) -> List[Dict]:
        """Fetch earnings surprises from FMP."""
        data = self._fetch_json('earnings-surprises', {'symbol': ticker})
        if not data or not isinstance(data, list):
            return []
        return data

    def _fetch_quote(self, ticker: str) -> Optional[Dict]:
        """Fetch current quote."""
        data = self._fetch_json('quote', {'symbol': ticker})
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]
        return None

    # ── Core Detection Logic ─────────────────────────────────────────────

    def _to_weekly(self, dates: List[str], closes: np.ndarray,
                   highs: np.ndarray, lows: np.ndarray,
                   volumes: np.ndarray) -> Dict:
        """Aggregate daily data to weekly bars."""
        from collections import defaultdict

        weeks = defaultdict(lambda: {'close': [], 'high': [], 'low': [], 'volume': [], 'date': ''})
        for i, d in enumerate(dates):
            # ISO week number as key
            dt = datetime.strptime(d, '%Y-%m-%d')
            wk = dt.isocalendar()[1]
            yr = dt.year
            key = f"{yr}-W{wk:02d}"
            weeks[key]['close'].append(closes[i])
            weeks[key]['high'].append(highs[i])
            weeks[key]['low'].append(lows[i])
            weeks[key]['volume'].append(volumes[i])
            weeks[key]['date'] = d  # last day of that week

        sorted_keys = sorted(weeks.keys())
        w_dates = [weeks[k]['date'] for k in sorted_keys]
        w_closes = np.array([weeks[k]['close'][-1] for k in sorted_keys])
        w_highs = np.array([max(weeks[k]['high']) for k in sorted_keys])
        w_lows = np.array([min(weeks[k]['low']) for k in sorted_keys])
        w_volumes = np.array([sum(weeks[k]['volume']) for k in sorted_keys])

        return {
            'dates': w_dates, 'close': w_closes, 'high': w_highs,
            'low': w_lows, 'volume': w_volumes,
        }

    def _detect_surges(self, weekly: Dict) -> List[Dict]:
        """
        Detect explosive surges: ≥min_surge move in surge_weeks_range.
        Returns list of surge candidates with start/end indices.
        """
        closes = weekly['close']
        highs = weekly['high']
        n = len(closes)
        surges = []

        min_w, max_w = self.surge_weeks_range

        for end_idx in range(min_w, n):
            for start_idx in range(max(0, end_idx - max_w), end_idx - min_w + 1):
                low_point = np.min(closes[start_idx:start_idx + 3])  # low near start
                high_point = np.max(highs[start_idx:end_idx + 1])
                if low_point <= 0:
                    continue
                surge_pct = (high_point - low_point) / low_point

                if surge_pct >= self.min_surge:
                    # Find exact peak index
                    peak_rel = np.argmax(highs[start_idx:end_idx + 1])
                    peak_idx = start_idx + peak_rel

                    surges.append({
                        'start_idx': start_idx,
                        'peak_idx': peak_idx,
                        'end_idx': end_idx,
                        'surge_pct': float(surge_pct),
                        'low_price': float(low_point),
                        'high_price': float(high_point),
                        'start_date': weekly['dates'][start_idx],
                        'peak_date': weekly['dates'][peak_idx],
                        'weeks': end_idx - start_idx,
                    })

        # Deduplicate: keep strongest surge per overlapping window
        if not surges:
            return []

        surges.sort(key=lambda s: s['surge_pct'], reverse=True)
        used_peaks = set()
        unique = []
        for s in surges:
            if s['peak_idx'] not in used_peaks:
                unique.append(s)
                # Mark nearby peaks as used
                for delta in range(-3, 4):
                    used_peaks.add(s['peak_idx'] + delta)

        return unique[:5]  # Top 5 surges

    def _detect_flag(self, weekly: Dict, surge: Dict) -> Optional[Dict]:
        """
        Detect tight consolidation (flag) after surge peak.
        Flag criteria:
          - Range ≤ max_flag_range
          - Duration in flag_weeks_range
          - Volume declining vs surge volume
        """
        closes = weekly['close']
        highs = weekly['high']
        lows = weekly['low']
        volumes = weekly['volume']
        n = len(closes)

        peak_idx = surge['peak_idx']
        min_fw, max_fw = self.flag_weeks_range

        if peak_idx + min_fw >= n:
            return None

        best_flag = None
        best_score = -1

        for flag_end in range(peak_idx + min_fw, min(peak_idx + max_fw + 1, n)):
            flag_slice_h = highs[peak_idx:flag_end + 1]
            flag_slice_l = lows[peak_idx:flag_end + 1]
            flag_slice_v = volumes[peak_idx:flag_end + 1]

            flag_high = np.max(flag_slice_h)
            flag_low = np.min(flag_slice_l)

            if flag_high <= 0:
                continue

            flag_range = (flag_high - flag_low) / flag_high

            if flag_range > self.max_flag_range:
                continue

            # Volume dry-up: flag avg vol vs surge avg vol
            surge_vol = np.mean(volumes[surge['start_idx']:surge['peak_idx'] + 1])
            flag_vol = np.mean(flag_slice_v)
            vol_dryup = flag_vol / surge_vol if surge_vol > 0 else 1.0

            # Volume declining trend in flag
            if len(flag_slice_v) >= 3:
                vol_slope = np.polyfit(np.arange(len(flag_slice_v)), flag_slice_v, 1)[0]
                vol_declining = vol_slope < 0
            else:
                vol_declining = vol_dryup < 0.7

            weeks = flag_end - peak_idx

            # Score this flag: tighter range + more vol dry-up = better
            tightness_score = 1.0 - (flag_range / self.max_flag_range)
            dryup_score = max(0, 1.0 - vol_dryup)
            duration_score = 1.0 - abs(weeks - 5) / 5  # optimal ~5 weeks
            flag_score = tightness_score * 0.4 + dryup_score * 0.35 + duration_score * 0.25

            if flag_score > best_score:
                best_score = flag_score
                best_flag = {
                    'start_idx': peak_idx,
                    'end_idx': flag_end,
                    'flag_high': float(flag_high),
                    'flag_low': float(flag_low),
                    'flag_range_pct': float(flag_range * 100),
                    'vol_dryup_ratio': float(vol_dryup),
                    'vol_declining': bool(vol_declining),
                    'weeks': weeks,
                    'flag_score': float(flag_score),
                    'start_date': weekly['dates'][peak_idx],
                    'end_date': weekly['dates'][flag_end],
                }

        return best_flag

    def _compute_rs(self, stock_closes: np.ndarray, spy_closes: np.ndarray) -> Dict:
        """Compute Mansfield Relative Strength metrics."""
        min_len = min(len(stock_closes), len(spy_closes))
        sc = stock_closes[-min_len:]
        sp = spy_closes[-min_len:]

        if len(sc) < 50 or np.any(sp == 0):
            return {'rs_current': 0, 'rs_new_high': False, 'rs_percentile': 50}

        rs_line = sc / sp
        rs_current = rs_line[-1]
        rs_52w_high = np.max(rs_line[-min(252, len(rs_line)):])
        rs_new_high = rs_current >= rs_52w_high * 0.98  # Within 2% of RS high

        # RS percentile over last year
        rs_vals = rs_line[-min(252, len(rs_line)):]
        rs_percentile = float(stats.percentileofscore(rs_vals, rs_current))

        return {
            'rs_current': float(rs_current),
            'rs_new_high': bool(rs_new_high),
            'rs_percentile': round(rs_percentile, 1),
            'rs_52w_high': float(rs_52w_high),
        }

    def _match_catalyst(self, surge: Dict, earnings: List[Dict]) -> Optional[Dict]:
        """Check if surge coincides with an earnings surprise."""
        if not earnings:
            return None

        surge_start = surge['start_date']
        surge_peak = surge['peak_date']

        for ep in earnings:
            ep_date = ep.get('date', '')
            if not ep_date:
                continue
            if surge_start <= ep_date <= surge_peak:
                actual = ep.get('actualEarningResult', 0)
                estimated = ep.get('estimatedEarning', 0)
                surprise_pct = 0
                if estimated and estimated != 0:
                    surprise_pct = ((actual - estimated) / abs(estimated)) * 100

                return {
                    'date': ep_date,
                    'actual_eps': actual,
                    'estimated_eps': estimated,
                    'surprise_pct': round(surprise_pct, 1),
                    'beat': actual > estimated if estimated else False,
                }

        return None

    def _compute_bollinger_width(self, closes: np.ndarray, period: int = 20) -> np.ndarray:
        """Bollinger Band width for measuring tightness."""
        if len(closes) < period:
            return np.full(len(closes), 0.1)

        sma = np.convolve(closes, np.ones(period) / period, mode='valid')
        std = np.array([np.std(closes[i:i + period]) for i in range(len(closes) - period + 1)])

        bb_width = (2 * std) / np.where(sma > 0, sma, 1)
        # Pad front
        pad = np.full(period - 1, bb_width[0] if len(bb_width) > 0 else 0.1)
        return np.concatenate([pad, bb_width])

    def _build_features(self, surge: Dict, flag: Dict, rs: Dict,
                        catalyst: Optional[Dict], vol_dryup: float) -> np.ndarray:
        """Build feature vector for ML scoring."""
        return np.array([
            surge['surge_pct'],                         # 0: surge magnitude
            surge['weeks'],                             # 1: surge duration
            flag['flag_range_pct'] / 100.0,             # 2: flag tightness
            flag['weeks'],                              # 3: flag duration
            vol_dryup,                                  # 4: volume dry-up
            1.0 if flag['vol_declining'] else 0.0,      # 5: vol declining trend
            rs.get('rs_percentile', 50) / 100.0,        # 6: RS percentile
            1.0 if rs.get('rs_new_high', False) else 0.0,  # 7: RS new high
            catalyst['surprise_pct'] / 100.0 if catalyst and catalyst.get('surprise_pct') else 0.0,  # 8: EPS surprise
            1.0 if catalyst and catalyst.get('beat') else 0.0,  # 9: catalyst binary
        ])

    def _train_synthetic_model(self):
        """
        Train RF on synthetic labeled data based on Quillamaggie historical patterns.
        In production, this would use real labeled HTF data.
        """
        if not SKLEARN_AVAILABLE:
            return

        np.random.seed(42)
        n_samples = 500

        # Positive examples: valid HTF patterns
        pos = np.column_stack([
            np.random.uniform(0.8, 3.0, n_samples),     # surge 80-300%
            np.random.uniform(3, 12, n_samples),         # surge weeks
            np.random.uniform(0.02, 0.10, n_samples),    # tight flag range
            np.random.uniform(2, 8, n_samples),          # flag weeks
            np.random.uniform(0.2, 0.5, n_samples),      # vol dry-up
            np.random.binomial(1, 0.8, n_samples),       # vol declining
            np.random.uniform(0.7, 1.0, n_samples),      # RS percentile
            np.random.binomial(1, 0.7, n_samples),       # RS new high
            np.random.uniform(0.1, 0.8, n_samples),      # EPS surprise
            np.random.binomial(1, 0.75, n_samples),      # catalyst
        ])

        # Negative examples: not valid HTF
        neg = np.column_stack([
            np.random.uniform(0.3, 1.5, n_samples),     # weaker surges
            np.random.uniform(1, 20, n_samples),         # any duration
            np.random.uniform(0.08, 0.30, n_samples),   # loose flag
            np.random.uniform(1, 15, n_samples),         # any duration
            np.random.uniform(0.5, 1.2, n_samples),      # high volume (no dry-up)
            np.random.binomial(1, 0.3, n_samples),       # vol not declining
            np.random.uniform(0.2, 0.7, n_samples),      # weak RS
            np.random.binomial(1, 0.2, n_samples),       # RS not at highs
            np.random.uniform(-0.3, 0.3, n_samples),     # weak/miss EPS
            np.random.binomial(1, 0.3, n_samples),       # no catalyst
        ])

        X = np.vstack([pos, neg])
        y = np.concatenate([np.ones(n_samples), np.zeros(n_samples)])

        self._scaler = StandardScaler()
        X_scaled = self._scaler.fit_transform(X)

        self._ml_model = GradientBoostingClassifier(
            n_estimators=100, max_depth=5, random_state=42
        )
        self._ml_model.fit(X_scaled, y)
        logger.info("HTF ML model trained on synthetic data")

    def _ml_score(self, features: np.ndarray) -> float:
        """Get ML probability of valid HTF."""
        if not self.ml_mode or self._ml_model is None:
            return self._heuristic_score(features)

        try:
            X = self._scaler.transform(features.reshape(1, -1))
            prob = self._ml_model.predict_proba(X)[0][1]
            return float(prob)
        except Exception as e:
            logger.warning(f"ML scoring failed: {e}")
            return self._heuristic_score(features)

    def _heuristic_score(self, features: np.ndarray) -> float:
        """Rule-based fallback scoring."""
        surge_pct = features[0]
        flag_range = features[2]
        vol_dryup = features[4]
        vol_declining = features[5]
        rs_pct = features[6]
        rs_new_high = features[7]
        catalyst = features[9]

        score = 0.0
        # Surge strength
        score += min(surge_pct / 2.0, 1.0) * 0.20
        # Flag tightness
        score += max(0, 1.0 - flag_range / 0.15) * 0.25
        # Volume dry-up
        score += max(0, 1.0 - vol_dryup) * 0.20
        # Volume declining
        score += vol_declining * 0.05
        # RS strength
        score += rs_pct * 0.15
        # RS new high
        score += rs_new_high * 0.05
        # Catalyst
        score += catalyst * 0.10

        return float(min(max(score, 0), 1.0))

    def _breakout_proximity(self, daily: Dict, flag: Optional[Dict]) -> Dict:
        """Check how close current price is to breakout."""
        if flag is None:
            return {'proximity_pct': 0, 'breakout_triggered': False, 'vol_confirmation': False, 'flag_high': 0, 'vol_ratio': 0}

        closes = daily['close']
        volumes = daily['volume']
        current_price = closes[-1]
        current_vol = volumes[-1]
        avg_vol_20 = np.mean(volumes[-20:]) if len(volumes) >= 20 else np.mean(volumes)

        flag_high = flag['flag_high']
        proximity = ((current_price - flag_high) / flag_high) * 100 if flag_high > 0 else 0

        breakout = current_price > flag_high
        vol_confirm = current_vol > avg_vol_20 * 1.5

        return {
            'current_price': float(current_price),
            'flag_high': float(flag_high),
            'proximity_pct': round(float(proximity), 2),
            'breakout_triggered': bool(breakout),
            'vol_confirmation': bool(vol_confirm),
            'vol_ratio': round(float(current_vol / avg_vol_20) if avg_vol_20 > 0 else 0, 2),
        }

    def _fusion_score(self, metrics_score: float, ml_prob: float,
                      breakout: Dict) -> float:
        """
        Composite score 0-100:
          40% pattern metrics, 30% ML probability, 30% breakout proximity
        """
        proximity_score = 0
        if breakout['breakout_triggered'] and breakout['vol_confirmation']:
            proximity_score = 1.0
        elif breakout['breakout_triggered']:
            proximity_score = 0.7
        elif breakout['proximity_pct'] > -3:  # within 3% of breakout
            proximity_score = 0.5
        elif breakout['proximity_pct'] > -5:
            proximity_score = 0.3

        raw = metrics_score * 0.40 + ml_prob * 0.30 + proximity_score * 0.30
        return round(raw * 100, 1)

    def _generate_narrative(self, ticker: str, surge: Dict, flag: Optional[Dict],
                            catalyst: Optional[Dict], rs: Dict,
                            breakout: Dict, score: float) -> str:
        """Generate Quillamaggie-style narrative."""
        parts = []

        # Detection status
        if score >= 70:
            parts.append(f"**HTF DETECTED** on {ticker} — Score {score}/100")
        elif score >= 50:
            parts.append(f"**Potential HTF forming** on {ticker} — Score {score}/100")
        else:
            parts.append(f"**No valid HTF** on {ticker} — Score {score}/100")

        # Surge details
        parts.append(f"Surge: +{surge['surge_pct']*100:.0f}% in {surge['weeks']} weeks "
                      f"({surge['start_date']} → {surge['peak_date']})")

        # Catalyst
        if catalyst:
            parts.append(f"Catalyst: EPS {'beat' if catalyst['beat'] else 'miss'} "
                         f"{catalyst['surprise_pct']:+.1f}% on {catalyst['date']}")
        else:
            parts.append("No confirmed earnings catalyst — check for news/FDA/M&A events")

        # Flag
        if flag:
            parts.append(f"Flag: {flag['flag_range_pct']:.1f}% range over {flag['weeks']} weeks, "
                         f"vol dry-up ratio {flag['vol_dryup_ratio']:.2f} "
                         f"({'declining ✓' if flag['vol_declining'] else 'not declining ✗'})")
        else:
            parts.append("No valid flag detected — consolidation too wide or too short")

        # RS
        rs_status = "RS new highs ✓ — confirms leadership" if rs.get('rs_new_high') else \
                    f"RS at {rs.get('rs_percentile', 0):.0f}th percentile"
        parts.append(rs_status)

        # Breakout
        if breakout.get('breakout_triggered') and breakout.get('vol_confirmation'):
            parts.append(f"⚡ BREAKOUT CONFIRMED — price above flag high ${breakout.get('flag_high', 0):.2f} "
                         f"with {breakout.get('vol_ratio', 0):.1f}x avg volume")
        elif breakout.get('breakout_triggered'):
            parts.append(f"Price above flag high but volume weak ({breakout.get('vol_ratio', 0):.1f}x avg) — "
                         f"wait for volume confirmation")
        elif breakout.get('proximity_pct', -99) > -5 and breakout.get('flag_high', 0) > 0:
            parts.append(f"Breakout watch: {breakout['proximity_pct']:+.1f}% from flag high "
                         f"${breakout['flag_high']:.2f}")
        elif breakout.get('flag_high', 0) > 0:
            parts.append(f"Price {breakout.get('proximity_pct', 0):+.1f}% from flag high ${breakout['flag_high']:.2f} — not yet actionable")
        else:
            parts.append("No flag detected — breakout analysis not applicable")

        return "\n".join(parts)

    def _build_chart_data(self, daily: Dict, surge: Dict, flag: Optional[Dict],
                          weekly: Dict) -> List[Dict]:
        """Build annotated chart data for frontend visualization."""
        chart = []
        surge_start_date = surge['start_date']
        surge_peak_date = surge['peak_date']
        flag_end_date = flag['end_date'] if flag else surge_peak_date

        for i, d in enumerate(daily['dates']):
            zone = 'normal'
            if d >= surge_start_date and d <= surge_peak_date:
                zone = 'surge'
            elif flag and d > surge_peak_date and d <= flag_end_date:
                zone = 'flag'
            elif flag and d > flag_end_date:
                zone = 'breakout_watch'

            entry = {
                'date': d,
                'close': float(daily['close'][i]),
                'high': float(daily['high'][i]),
                'low': float(daily['low'][i]),
                'volume': float(daily['volume'][i]),
                'zone': zone,
            }

            if flag:
                entry['flag_high'] = float(flag['flag_high'])
                entry['flag_low'] = float(flag['flag_low'])

            chart.append(entry)

        return chart

    # ── Main Analysis Method ─────────────────────────────────────────────

    def analyze(self, ticker: str) -> Dict[str, Any]:
        """
        Run full HTF detection pipeline on a ticker.

        Returns dict with:
          - detected: bool
          - score: 0-100
          - patterns: list of detected HTF setups
          - metrics: detailed metrics
          - narrative: human-readable interpretation
          - chart_data: annotated time series for visualization
        """
        ticker = ticker.upper().strip()

        # 1. Ingest
        daily = self._fetch_daily_prices(ticker, days=756)
        if daily is None:
            return {'error': f'Insufficient price data for {ticker} — need at least 100 daily bars'}

        if len(daily['close']) < 100:
            return {'error': f'Only {len(daily["close"])} bars available for {ticker} — need at least 100'}

        spy_closes = self._fetch_spy_prices(days=756)
        earnings = self._fetch_earnings(ticker)
        quote = self._fetch_quote(ticker)

        # Weekly aggregation for surge/flag detection
        weekly = self._to_weekly(daily['dates'], daily['close'], daily['high'],
                                 daily['low'], daily['volume'])

        if len(weekly['close']) < 20:
            return {'error': f'Insufficient weekly data for {ticker}'}

        # 2-3. Detect surges + flags
        surges = self._detect_surges(weekly)

        if not surges:
            return {
                'detected': False,
                'score': 0,
                'patterns': [],
                'metrics': {},
                'narrative': f'No explosive surges (≥{self.min_surge*100:.0f}%) detected for {ticker} '
                             f'in the last {len(weekly["close"])} weeks.',
                'chart_data': self._build_chart_data(daily, {'start_date': '', 'peak_date': ''}, None, weekly) if False else [],
                'ticker': ticker,
                'current_price': float(daily['close'][-1]),
                'analysis_date': daily['dates'][-1],
            }

        # Train ML model if needed
        if self.ml_mode and self._ml_model is None:
            self._train_synthetic_model()

        # RS computation
        rs = self._compute_rs(daily['close'], spy_closes) if spy_closes is not None else \
             {'rs_current': 0, 'rs_new_high': False, 'rs_percentile': 50}

        # Bollinger width for daily tightness
        bb_width = self._compute_bollinger_width(daily['close'])

        # Analyze each surge
        patterns = []
        for surge in surges:
            flag = self._detect_flag(weekly, surge)

            catalyst = self._match_catalyst(surge, earnings)

            vol_dryup = flag['vol_dryup_ratio'] if flag else 1.0

            # Build features
            if flag:
                features = self._build_features(surge, flag, rs, catalyst, vol_dryup)
                ml_prob = float(self._ml_score(features))
                metrics_score = float(flag['flag_score'])
            else:
                ml_prob = 0.2
                metrics_score = 0.1

            breakout = self._breakout_proximity(daily, flag)
            score = float(self._fusion_score(metrics_score, ml_prob, breakout))

            narrative = self._generate_narrative(ticker, surge, flag, catalyst, rs, breakout, score)

            pattern = {
                'surge': surge,
                'flag': flag,
                'catalyst': catalyst,
                'breakout': breakout,
                'ml_probability': round(float(ml_prob), 3),
                'fusion_score': score,
                'narrative': narrative,
            }
            patterns.append(pattern)

        # Sort by score
        patterns.sort(key=lambda p: p['fusion_score'], reverse=True)
        best = patterns[0]

        # Build chart for best pattern
        chart_data = self._build_chart_data(daily, best['surge'], best.get('flag'), weekly)

        # BB tightness for recent period
        recent_bb = float(np.mean(bb_width[-20:])) if len(bb_width) >= 20 else float(np.mean(bb_width))

        # Constructive pullback check (price near MA50/EMA65)
        ma50 = np.mean(daily['close'][-50:]) if len(daily['close']) >= 50 else daily['close'][-1]
        current = daily['close'][-1]
        pullback_to_ma50 = ((current - ma50) / ma50) * 100

        return {
            'detected': best['fusion_score'] >= 50,
            'score': best['fusion_score'],
            'ticker': ticker,
            'current_price': float(current),
            'analysis_date': daily['dates'][-1],
            'patterns': patterns,
            'best_pattern': {
                'surge_pct': best['surge']['surge_pct'] * 100,
                'flag_range_pct': best['flag']['flag_range_pct'] if best['flag'] else None,
                'flag_weeks': best['flag']['weeks'] if best['flag'] else None,
                'vol_dryup': best['flag']['vol_dryup_ratio'] if best['flag'] else None,
                'ml_probability': best['ml_probability'],
                'breakout_status': 'confirmed' if best['breakout'].get('breakout_triggered') and best['breakout'].get('vol_confirmation')
                                   else 'triggered' if best['breakout'].get('breakout_triggered')
                                   else 'watching' if best['breakout'].get('proximity_pct', -99) > -5
                                   else 'distant',
            },
            'relative_strength': rs,
            'bollinger_tightness': round(recent_bb, 4),
            'pullback_to_ma50_pct': round(float(pullback_to_ma50), 2),
            'narrative': best['narrative'],
            'chart_data': chart_data,
            'ml_available': self.ml_mode,
            'earnings_catalysts': [c for p in patterns if p.get('catalyst') for c in [p['catalyst']]],
            'quote': {
                'price': quote.get('price', 0) if quote else 0,
                'change_pct': quote.get('changesPercentage', 0) if quote else 0,
                'volume': quote.get('volume', 0) if quote else 0,
                'avg_volume': quote.get('avgVolume', 0) if quote else 0,
                'market_cap': quote.get('marketCap', 0) if quote else 0,
            } if quote else None,
        }


# ── Singleton ────────────────────────────────────────────────────────────

_engine_instance: Optional[HTFDetectionEngine] = None

def get_htf_engine() -> HTFDetectionEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = HTFDetectionEngine()
    return _engine_instance
