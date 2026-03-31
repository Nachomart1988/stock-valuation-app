# backend/ep_detection_engine.py
# Episodic Pivot (EP) Detection Engine — Quillamaggie Style
# Detects explosive gap/move events (20-50%+) on catalyst with follow-through

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

try:
    from sklearn.svm import SVC
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not available — EP ML scoring will use heuristic fallback")

TRADING_DAYS_YEAR = 252


class EPDetectionEngine:
    """
    Hedge-fund grade Episodic Pivot detector.

    Pipeline:
      1. Ingest: fetch daily prices + volume + earnings surprises from FMP
      2. Catalyst Detection: EPS beat >20%, gap >20%, news sentiment
      3. Pattern Metrics: gap %, hold support, follow-through vol, RS outperformance
      4. ML Layer: GBM/SVM classifier (fallback: heuristic rules)
      5. Fusion: composite score 0-100

    Quillamaggie EP criteria:
      - Gap/move: ≥20% on catalyst day
      - Hold: price holds above prior close (support)
      - Follow-through: volume ≥2x average
      - Fundamentals: accelerating EPS growth, RS outperformance vs SPY
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_gap: float = 0.15,          # 15% minimum gap (relaxed from 20%)
        min_surprise: float = 0.10,     # 10% EPS surprise threshold
        lookback_days: int = 504,       # ~2 years lookback
        ml_mode: bool = True,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_gap = min_gap
        self.min_surprise = min_surprise
        self.lookback_days = lookback_days
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
        dates = [d['date'] for d in data]

        # Use adjClose for split-adjusted prices; adjust OHLC proportionally
        raw_closes = np.array([d.get('close', 0) for d in data], dtype=float)
        adj_closes = np.array([d.get('adjClose', d.get('close', 0)) for d in data], dtype=float)
        adj_ratio = np.where(raw_closes > 0, adj_closes / raw_closes, 1.0)

        opens = np.array([d.get('open', d.get('close', 0)) for d in data], dtype=float) * adj_ratio
        highs = np.array([d.get('high', d.get('close', 0)) for d in data], dtype=float) * adj_ratio
        lows = np.array([d.get('low', d.get('close', 0)) for d in data], dtype=float) * adj_ratio
        closes = adj_closes
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)

        return {
            'dates': dates, 'open': opens, 'high': highs,
            'low': lows, 'close': closes, 'volume': volumes,
        }

    def _fetch_spy_prices(self, days: int = 756) -> Optional[np.ndarray]:
        data = self._fetch_daily_prices('SPY', days)
        return data['close'] if data else None

    def _fetch_earnings_surprises(self, ticker: str) -> List[Dict]:
        data = self._fetch_json('earnings-surprises', {'symbol': ticker})
        return data if data and isinstance(data, list) else []

    def _fetch_quote(self, ticker: str) -> Optional[Dict]:
        data = self._fetch_json('quote', {'symbol': ticker})
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]
        return None

    def _fetch_earnings_growth(self, ticker: str) -> List[Dict]:
        """Fetch income growth for accelerating fundamentals check."""
        data = self._fetch_json('income-statement-growth', {'symbol': ticker, 'limit': 8})
        return data if data and isinstance(data, list) else []

    # ── Core Detection ───────────────────────────────────────────────────

    def _detect_gaps(self, daily: Dict) -> List[Dict]:
        """
        Detect gap-up events where open >> prior close.
        A gap is (open[i] - close[i-1]) / close[i-1] >= min_gap.
        Also captures large intraday moves.
        """
        opens = daily['open']
        closes = daily['close']
        highs = daily['high']
        lows = daily['low']
        volumes = daily['volume']
        dates = daily['dates']
        n = len(closes)

        gaps = []
        avg_vol_50 = np.convolve(volumes, np.ones(50) / 50, mode='full')[:n]
        avg_vol_50[:50] = np.mean(volumes[:50])

        for i in range(1, n):
            prior_close = closes[i - 1]
            if prior_close <= 0:
                continue

            # Gap: open vs prior close
            gap_pct = (opens[i] - prior_close) / prior_close

            # Intraday move: close vs prior close (captures non-gap explosive moves)
            move_pct = (closes[i] - prior_close) / prior_close

            # Use the larger of gap or move
            effective_pct = max(gap_pct, move_pct)

            if effective_pct >= self.min_gap:
                vol_ratio = volumes[i] / avg_vol_50[i] if avg_vol_50[i] > 0 else 1.0
                day_range = (highs[i] - lows[i]) / lows[i] if lows[i] > 0 else 0

                gaps.append({
                    'index': i,
                    'date': dates[i],
                    'gap_pct': float(gap_pct * 100),
                    'move_pct': float(move_pct * 100),
                    'effective_pct': float(effective_pct * 100),
                    'prior_close': float(prior_close),
                    'open': float(opens[i]),
                    'close': float(closes[i]),
                    'high': float(highs[i]),
                    'low': float(lows[i]),
                    'volume': float(volumes[i]),
                    'vol_ratio': round(float(vol_ratio), 2),
                    'day_range_pct': round(float(day_range * 100), 1),
                })

        # Sort by effective_pct descending
        gaps.sort(key=lambda g: g['effective_pct'], reverse=True)
        return gaps[:10]  # Top 10 events

    def _match_earnings_catalyst(self, gap: Dict, earnings: List[Dict]) -> Optional[Dict]:
        """Match a gap event with earnings surprise data."""
        gap_date = gap['date']

        for ep in earnings:
            ep_date = ep.get('date', '')
            if not ep_date:
                continue

            # Earnings on gap day or day before
            try:
                gd = datetime.strptime(gap_date, '%Y-%m-%d')
                ed = datetime.strptime(ep_date, '%Y-%m-%d')
                delta = abs((gd - ed).days)
            except ValueError:
                continue

            if delta <= 2:  # Within 2 calendar days
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
                    'magnitude': 'massive' if abs(surprise_pct) > 50 else
                                 'strong' if abs(surprise_pct) > 20 else 'moderate',
                }

        return None

    def _check_support_hold(self, daily: Dict, gap: Dict, days_after: int = 5) -> Dict:
        """
        Check if price holds above prior close after gap.
        Quillamaggie: buy if holds support, stop below gap low.
        """
        idx = gap['index']
        n = len(daily['close'])
        end_idx = min(idx + days_after + 1, n)

        if idx >= n - 1:
            return {'holds': False, 'days_checked': 0, 'min_low': 0, 'support_level': gap['prior_close']}

        post_lows = daily['low'][idx:end_idx]
        post_closes = daily['close'][idx:end_idx]
        prior_close = gap['prior_close']

        # Support = prior close * 0.98 (2% tolerance)
        support_level = prior_close * 0.98
        holds = bool(np.all(post_lows >= support_level))

        # Check close-based hold (more lenient)
        close_holds = bool(np.all(post_closes >= prior_close * 0.95))

        min_low = float(np.min(post_lows)) if len(post_lows) > 0 else 0
        max_drawdown = ((min_low - gap['close']) / gap['close']) * 100 if gap['close'] > 0 else 0

        return {
            'holds': holds,
            'close_holds': close_holds,
            'days_checked': len(post_lows),
            'min_low': round(min_low, 2),
            'max_drawdown_pct': round(float(max_drawdown), 2),
            'support_level': round(float(support_level), 2),
            'gap_low': round(float(gap['low']), 2),
        }

    def _check_follow_through(self, daily: Dict, gap: Dict, days_window: int = 10) -> Dict:
        """
        Check follow-through after gap: sustained volume, price continuation.
        """
        idx = gap['index']
        n = len(daily['close'])
        end_idx = min(idx + days_window + 1, n)

        if idx >= n - 1:
            return {'has_followthrough': False, 'continuation_pct': 0}

        post_closes = daily['close'][idx:end_idx]
        post_volumes = daily['volume'][idx:end_idx]

        # Price continuation
        if len(post_closes) >= 2:
            continuation = ((post_closes[-1] - post_closes[0]) / post_closes[0]) * 100
        else:
            continuation = 0

        # Volume follow-through (avg post-gap vol vs 50-day avg before gap)
        pre_vols = daily['volume'][max(0, idx - 50):idx]
        avg_pre_vol = np.mean(pre_vols) if len(pre_vols) > 0 else 1
        avg_post_vol = np.mean(post_volumes) if len(post_volumes) > 0 else 0
        vol_followthrough = avg_post_vol / avg_pre_vol if avg_pre_vol > 0 else 1.0

        # Higher high after gap day?
        gap_high = gap['high']
        post_highs = daily['high'][idx:end_idx]
        made_new_high = bool(np.any(post_highs[1:] > gap_high)) if len(post_highs) > 1 else False

        return {
            'has_followthrough': continuation > 0 and vol_followthrough > 1.2,
            'continuation_pct': round(float(continuation), 2),
            'vol_followthrough_ratio': round(float(vol_followthrough), 2),
            'made_new_high': made_new_high,
            'days_analyzed': len(post_closes),
        }

    def _compute_rs(self, stock_closes: np.ndarray, spy_closes: np.ndarray, gap_idx: int) -> Dict:
        """RS outperformance check at time of gap."""
        min_len = min(len(stock_closes), len(spy_closes))
        sc = stock_closes[-min_len:]
        sp = spy_closes[-min_len:]

        if len(sc) < 50 or np.any(sp == 0):
            return {'rs_outperform': False, 'rs_percentile': 50, 'stock_vs_spy_pct': 0}

        rs_line = sc / sp

        # Adjust gap_idx for trimmed array
        adj_idx = min(gap_idx, len(rs_line) - 1)

        # RS at gap time
        rs_at_gap = rs_line[adj_idx] if adj_idx < len(rs_line) else rs_line[-1]
        rs_vals = rs_line[max(0, adj_idx - 252):adj_idx + 1]
        rs_percentile = float(stats.percentileofscore(rs_vals, rs_at_gap)) if len(rs_vals) > 1 else 50

        # Stock vs SPY performance over 3 months pre-gap
        lookback = min(63, adj_idx)
        if lookback > 0:
            stock_ret = (sc[adj_idx] / sc[adj_idx - lookback] - 1) * 100
            spy_ret = (sp[adj_idx] / sp[adj_idx - lookback] - 1) * 100
            outperform = stock_ret - spy_ret
        else:
            stock_ret = spy_ret = outperform = 0

        return {
            'rs_outperform': outperform > 0,
            'rs_percentile': round(rs_percentile, 1),
            'stock_vs_spy_pct': round(float(outperform), 2),
            'stock_3m_ret': round(float(stock_ret), 2),
            'spy_3m_ret': round(float(spy_ret), 2),
        }

    def _check_accelerating_fundamentals(self, growth_data: List[Dict]) -> Dict:
        """Check if EPS growth is accelerating quarter over quarter."""
        if not growth_data or len(growth_data) < 2:
            return {'accelerating': False, 'quarters_analyzed': 0, 'growth_rates': []}

        # Extract EPS growth rates (most recent first from FMP)
        rates = []
        for g in growth_data[:6]:
            eps_g = g.get('growthEPS', g.get('growthNetIncome', 0))
            if eps_g is not None:
                rates.append(float(eps_g) * 100)

        if len(rates) < 2:
            return {'accelerating': False, 'quarters_analyzed': len(rates), 'growth_rates': rates}

        # Reverse to chronological order (oldest first)
        rates_chrono = list(reversed(rates))

        # Check if last 2-3 quarters show acceleration
        accelerating = False
        if len(rates_chrono) >= 3:
            accelerating = rates_chrono[-1] > rates_chrono[-2] > rates_chrono[-3]
        elif len(rates_chrono) >= 2:
            accelerating = rates_chrono[-1] > rates_chrono[-2]

        # Consecutive positive growth quarters
        consecutive_positive = 0
        for r in reversed(rates_chrono):
            if r > 0:
                consecutive_positive += 1
            else:
                break

        return {
            'accelerating': accelerating,
            'quarters_analyzed': len(rates),
            'growth_rates': rates_chrono,
            'latest_growth': rates_chrono[-1] if rates_chrono else 0,
            'consecutive_positive': consecutive_positive,
        }

    def _build_features(self, gap: Dict, support: Dict, followthrough: Dict,
                        rs: Dict, catalyst: Optional[Dict],
                        fundamentals: Dict) -> np.ndarray:
        """Build feature vector for ML scoring."""
        return np.array([
            gap['effective_pct'] / 100.0,                          # 0: gap magnitude
            gap['vol_ratio'],                                       # 1: volume spike
            gap['day_range_pct'] / 100.0,                          # 2: day range
            1.0 if support['holds'] else 0.0,                      # 3: holds support
            support['max_drawdown_pct'] / 100.0,                   # 4: max drawdown
            1.0 if followthrough['has_followthrough'] else 0.0,    # 5: follow-through
            followthrough['vol_followthrough_ratio'],               # 6: vol follow-through
            rs.get('rs_percentile', 50) / 100.0,                   # 7: RS percentile
            1.0 if rs.get('rs_outperform', False) else 0.0,        # 8: RS outperform
            catalyst['surprise_pct'] / 100.0 if catalyst and catalyst.get('surprise_pct') else 0.0,  # 9: surprise
            1.0 if catalyst and catalyst.get('beat') else 0.0,     # 10: catalyst beat
            1.0 if fundamentals.get('accelerating') else 0.0,      # 11: accelerating growth
        ])

    def _train_synthetic_model(self):
        """Train GBM on synthetic labeled data based on EP historical patterns."""
        if not SKLEARN_AVAILABLE:
            return

        np.random.seed(42)
        n = 500

        # Positive: valid EPs
        pos = np.column_stack([
            np.random.uniform(0.20, 0.80, n),      # gap 20-80%
            np.random.uniform(2.0, 8.0, n),         # vol spike 2-8x
            np.random.uniform(0.10, 0.40, n),       # day range
            np.random.binomial(1, 0.85, n),          # holds support
            np.random.uniform(-0.05, 0.0, n),       # small drawdown
            np.random.binomial(1, 0.80, n),          # follow-through
            np.random.uniform(1.3, 4.0, n),          # vol follow-through
            np.random.uniform(0.65, 1.0, n),         # RS high
            np.random.binomial(1, 0.75, n),          # RS outperform
            np.random.uniform(0.15, 0.80, n),        # EPS surprise
            np.random.binomial(1, 0.85, n),          # catalyst beat
            np.random.binomial(1, 0.70, n),          # accelerating
        ])

        # Negative: not valid
        neg = np.column_stack([
            np.random.uniform(0.10, 0.40, n),       # smaller gaps
            np.random.uniform(0.5, 3.0, n),          # moderate vol
            np.random.uniform(0.05, 0.30, n),        # day range
            np.random.binomial(1, 0.35, n),          # often fails support
            np.random.uniform(-0.15, -0.02, n),     # larger drawdown
            np.random.binomial(1, 0.30, n),          # weak follow-through
            np.random.uniform(0.5, 1.5, n),          # vol fades
            np.random.uniform(0.20, 0.60, n),        # weak RS
            np.random.binomial(1, 0.30, n),          # RS lagging
            np.random.uniform(-0.20, 0.20, n),       # weak/miss surprise
            np.random.binomial(1, 0.30, n),          # no catalyst
            np.random.binomial(1, 0.25, n),          # decelerating
        ])

        X = np.vstack([pos, neg])
        y = np.concatenate([np.ones(n), np.zeros(n)])

        self._scaler = StandardScaler()
        X_scaled = self._scaler.fit_transform(X)

        self._ml_model = GradientBoostingClassifier(
            n_estimators=100, max_depth=5, random_state=42
        )
        self._ml_model.fit(X_scaled, y)
        logger.info("EP ML model trained on synthetic data")

    def _ml_score(self, features: np.ndarray) -> float:
        if not self.ml_mode or self._ml_model is None:
            return self._heuristic_score(features)
        try:
            X = self._scaler.transform(features.reshape(1, -1))
            prob = self._ml_model.predict_proba(X)[0][1]
            return float(prob)
        except Exception as e:
            logger.warning(f"EP ML scoring failed: {e}")
            return self._heuristic_score(features)

    def _heuristic_score(self, features: np.ndarray) -> float:
        gap = features[0]
        vol_spike = features[1]
        holds = features[3]
        followthrough = features[5]
        rs_pct = features[7]
        rs_out = features[8]
        catalyst_beat = features[10]
        accel = features[11]

        score = 0.0
        score += min(gap / 0.5, 1.0) * 0.20          # gap strength
        score += min(vol_spike / 5.0, 1.0) * 0.15     # volume spike
        score += holds * 0.20                           # holds support
        score += followthrough * 0.10                   # follow-through
        score += rs_pct * 0.10                          # RS
        score += rs_out * 0.05                          # RS outperform
        score += catalyst_beat * 0.15                   # catalyst
        score += accel * 0.05                           # accelerating growth
        return float(min(max(score, 0), 1.0))

    def _fusion_score(self, catalyst_score: float, metrics_score: float,
                      ml_prob: float) -> float:
        """
        Composite 0-100:
          50% catalyst quality, 30% pattern metrics, 20% ML probability
        """
        raw = catalyst_score * 0.50 + metrics_score * 0.30 + ml_prob * 0.20
        return round(raw * 100, 1)

    def _compute_catalyst_score(self, catalyst: Optional[Dict],
                                gap: Dict, fundamentals: Dict) -> float:
        """Score the catalyst quality 0-1."""
        score = 0.0

        if catalyst:
            if catalyst.get('beat'):
                score += 0.3
            surprise = abs(catalyst.get('surprise_pct', 0))
            score += min(surprise / 50, 1.0) * 0.3
        else:
            # No earnings catalyst — still could be valid (FDA, M&A, etc.)
            score += 0.1 if gap['vol_ratio'] > 3 else 0

        # Gap quality
        score += min(gap['effective_pct'] / 50, 1.0) * 0.2

        # Fundamentals
        if fundamentals.get('accelerating'):
            score += 0.2

        return min(score, 1.0)

    def _compute_metrics_score(self, support: Dict, followthrough: Dict,
                               rs: Dict) -> float:
        """Score pattern metrics 0-1."""
        score = 0.0
        if support['holds']:
            score += 0.35
        elif support.get('close_holds'):
            score += 0.20

        if followthrough['has_followthrough']:
            score += 0.25
        if followthrough.get('made_new_high'):
            score += 0.10

        score += (rs.get('rs_percentile', 50) / 100) * 0.20
        if rs.get('rs_outperform'):
            score += 0.10

        return min(score, 1.0)

    def _generate_narrative(self, ticker: str, gap: Dict, catalyst: Optional[Dict],
                            support: Dict, followthrough: Dict, rs: Dict,
                            fundamentals: Dict, score: float) -> str:
        parts = []

        if score >= 70:
            parts.append(f"**EPISODIC PIVOT DETECTED** on {ticker} — Score {score}/100")
        elif score >= 50:
            parts.append(f"**Potential EP forming** on {ticker} — Score {score}/100")
        else:
            parts.append(f"**No valid EP** on {ticker} — Score {score}/100")

        # Gap details
        parts.append(f"Gap/Move: +{gap['effective_pct']:.1f}% on {gap['date']} "
                      f"(volume {gap['vol_ratio']:.1f}x average)")

        # Catalyst
        if catalyst:
            parts.append(f"Catalyst: EPS {'beat' if catalyst['beat'] else 'miss'} "
                         f"{catalyst['surprise_pct']:+.1f}% — {catalyst['magnitude']} surprise")
        else:
            parts.append("No confirmed earnings catalyst — investigate news/FDA/M&A events")

        # Support
        if support['holds']:
            parts.append(f"Support hold ✓ — price held above ${support['support_level']:.2f} "
                         f"(max drawdown {support['max_drawdown_pct']:.1f}%)")
        elif support.get('close_holds'):
            parts.append(f"Close-based hold ✓ — intraday wick below support but closes held")
        else:
            parts.append(f"Support FAILED ✗ — price broke below ${support['support_level']:.2f} "
                         f"(drawdown {support['max_drawdown_pct']:.1f}%)")

        # Follow-through
        if followthrough['has_followthrough']:
            parts.append(f"Follow-through ✓ — {followthrough['continuation_pct']:+.1f}% continuation, "
                         f"vol {followthrough['vol_followthrough_ratio']:.1f}x sustained"
                         f"{' — new highs ✓' if followthrough['made_new_high'] else ''}")
        else:
            parts.append(f"Weak follow-through — {followthrough['continuation_pct']:+.1f}% post-gap, "
                         f"vol ratio {followthrough['vol_followthrough_ratio']:.1f}x")

        # RS
        if rs.get('rs_outperform'):
            parts.append(f"RS outperforming SPY by {rs['stock_vs_spy_pct']:+.1f}% (3M) — "
                         f"confirms leadership ({rs['rs_percentile']:.0f}th percentile)")
        else:
            parts.append(f"RS at {rs.get('rs_percentile', 50):.0f}th percentile — "
                         f"{'acceptable' if rs.get('rs_percentile', 0) > 50 else 'weak leadership'}")

        # Fundamentals
        if fundamentals.get('accelerating'):
            parts.append(f"Accelerating growth ✓ — last {fundamentals['consecutive_positive']} quarters positive, "
                         f"latest {fundamentals['latest_growth']:.1f}%")

        # Action
        if score >= 70 and support['holds']:
            parts.append(f"\n→ BUY/ADD — trail stop below gap low ${support['gap_low']:.2f}")
        elif score >= 50:
            parts.append(f"\n→ WATCH — wait for follow-through confirmation above ${gap['high']:.2f}")
        else:
            parts.append(f"\n→ SKIP — setup does not meet EP criteria")

        return "\n".join(parts)

    def _build_chart_data(self, daily: Dict, gaps: List[Dict]) -> List[Dict]:
        """Build annotated chart data for visualization."""
        # Create a set of gap indices for annotation
        gap_indices = {g['index'] for g in gaps}
        gap_zones = set()
        for g in gaps:
            for delta in range(-2, 8):  # Mark 2 days before to 7 days after
                gap_zones.add(g['index'] + delta)

        chart = []
        for i, d in enumerate(daily['dates']):
            zone = 'normal'
            annotation = None

            if i in gap_indices:
                zone = 'gap'
                matching = [g for g in gaps if g['index'] == i]
                if matching:
                    annotation = f"+{matching[0]['effective_pct']:.0f}%"
            elif i in gap_zones:
                zone = 'post_gap'

            chart.append({
                'date': d,
                'close': float(daily['close'][i]),
                'high': float(daily['high'][i]),
                'low': float(daily['low'][i]),
                'open': float(daily['open'][i]),
                'volume': float(daily['volume'][i]),
                'zone': zone,
                'annotation': annotation,
            })

        return chart

    # ── Main Analysis ────────────────────────────────────────────────────

    def analyze(self, ticker: str) -> Dict[str, Any]:
        """
        Run full EP detection pipeline.

        Returns:
          - detected: bool (any EP with score ≥50)
          - score: best EP score
          - episodes: list of detected EPs with full metrics
          - narrative: interpretation of best EP
          - chart_data: annotated time series
        """
        ticker = ticker.upper().strip()

        # 1. Ingest
        daily = self._fetch_daily_prices(ticker, days=self.lookback_days)
        if daily is None:
            return {'error': f'Insufficient price data for {ticker} — need at least 60 daily bars'}

        if len(daily['close']) < 60:
            return {'error': f'Only {len(daily["close"])} bars available for {ticker} — need at least 60'}

        spy_closes = self._fetch_spy_prices(days=self.lookback_days)
        earnings = self._fetch_earnings_surprises(ticker)
        growth_data = self._fetch_earnings_growth(ticker)
        quote = self._fetch_quote(ticker)

        fundamentals = self._check_accelerating_fundamentals(growth_data)

        # 2. Detect gaps
        gaps = self._detect_gaps(daily)

        if not gaps:
            return {
                'detected': False,
                'score': 0,
                'ticker': ticker,
                'current_price': float(daily['close'][-1]),
                'analysis_date': daily['dates'][-1],
                'episodes': [],
                'narrative': f'No explosive gap events (≥{self.min_gap*100:.0f}%) detected for {ticker} '
                             f'in the last {len(daily["close"])} trading days.',
                'chart_data': [],
                'fundamentals': fundamentals,
            }

        # Train ML if needed
        if self.ml_mode and self._ml_model is None:
            self._train_synthetic_model()

        # 3-5. Analyze each gap
        episodes = []
        for gap in gaps:
            # RS at time of gap
            rs = self._compute_rs(daily['close'], spy_closes, gap['index']) if spy_closes is not None else \
                 {'rs_outperform': False, 'rs_percentile': 50, 'stock_vs_spy_pct': 0}

            catalyst = self._match_earnings_catalyst(gap, earnings)
            support = self._check_support_hold(daily, gap)
            followthrough = self._check_follow_through(daily, gap)

            # Build features + ML
            features = self._build_features(gap, support, followthrough, rs, catalyst, fundamentals)
            ml_prob = self._ml_score(features)

            catalyst_score = float(self._compute_catalyst_score(catalyst, gap, fundamentals))
            metrics_score = float(self._compute_metrics_score(support, followthrough, rs))
            score = float(self._fusion_score(catalyst_score, metrics_score, ml_prob))

            narrative = self._generate_narrative(
                ticker, gap, catalyst, support, followthrough, rs, fundamentals, score
            )

            # Z-score for anomaly detection
            all_moves = np.abs(np.diff(daily['close']) / daily['close'][:-1])
            z_score = (abs(gap['effective_pct'] / 100) - np.mean(all_moves)) / (np.std(all_moves) + 1e-8)

            episodes.append({
                'gap': gap,
                'catalyst': catalyst,
                'support': support,
                'followthrough': followthrough,
                'relative_strength': rs,
                'ml_probability': round(ml_prob, 3),
                'catalyst_score': round(catalyst_score, 3),
                'metrics_score': round(metrics_score, 3),
                'fusion_score': score,
                'z_score': round(float(z_score), 2),
                'narrative': narrative,
                'action': 'buy' if score >= 70 and support['holds'] else
                          'watch' if score >= 50 else 'skip',
            })

        # Sort by score
        episodes.sort(key=lambda e: e['fusion_score'], reverse=True)
        best = episodes[0]

        # Chart data
        chart_data = self._build_chart_data(daily, [e['gap'] for e in episodes[:3]])

        return {
            'detected': best['fusion_score'] >= 50,
            'score': best['fusion_score'],
            'ticker': ticker,
            'current_price': float(daily['close'][-1]),
            'analysis_date': daily['dates'][-1],
            'episodes': episodes,
            'best_episode': {
                'date': best['gap']['date'],
                'gap_pct': best['gap']['effective_pct'],
                'vol_spike': best['gap']['vol_ratio'],
                'holds_support': best['support']['holds'],
                'has_followthrough': best['followthrough']['has_followthrough'],
                'catalyst_type': 'earnings' if best['catalyst'] else 'unknown',
                'action': best['action'],
                'ml_probability': best['ml_probability'],
            },
            'fundamentals': fundamentals,
            'narrative': best['narrative'],
            'chart_data': chart_data,
            'ml_available': self.ml_mode,
            'total_gaps_found': len(gaps),
            'quote': {
                'price': quote.get('price', 0) if quote else 0,
                'change_pct': quote.get('changesPercentage', 0) if quote else 0,
                'volume': quote.get('volume', 0) if quote else 0,
                'avg_volume': quote.get('avgVolume', 0) if quote else 0,
                'market_cap': quote.get('marketCap', 0) if quote else 0,
            } if quote else None,
        }


# ── Singleton ────────────────────────────────────────────────────────────

_engine_instance: Optional[EPDetectionEngine] = None

def get_ep_engine() -> EPDetectionEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = EPDetectionEngine()
    return _engine_instance
