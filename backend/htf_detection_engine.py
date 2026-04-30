# backend/htf_detection_engine.py
# High-Tight Flag (HTF) Detection Engine — Quillamaggie Style (VERSIÓN GOD MODE)
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
    Hedge-fund grade High-Tight Flag detector — tuned against real Notion FLAGS.
    """

    # Class-level ML model cache
    _shared_ml_model = None
    _shared_scaler = None

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_surge: float = 1.00,          # 100% clásico (antes 80%)
        max_flag_range: float = 0.22,     # hasta 22% (cubre el 90%+ de los FLAGS reales)
        flag_weeks: Tuple[int, int] = (3, 8),   # 3-8 semanas
        surge_weeks: Tuple[int, int] = (4, 12), # 4-12 semanas
        ml_mode: bool = True,
        surge_lookback_months: int = 0,
        ignore_vol_dryup: bool = False,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_surge = min_surge
        self.max_flag_range = max_flag_range
        self.flag_weeks_range = flag_weeks
        self.surge_weeks_range = surge_weeks
        self.ml_mode = ml_mode and SKLEARN_AVAILABLE
        self.surge_lookback_months = surge_lookback_months
        self.ignore_vol_dryup = ignore_vol_dryup
        self._session = requests.Session()
        self._ml_model = HTFDetectionEngine._shared_ml_model
        self._scaler = HTFDetectionEngine._shared_scaler

    # ── FMP Helpers (sin cambios) ────────────────────────────────────────
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
        data = self._fetch_json('historical-price-eod/full', {'symbol': ticker})
        if not data or not isinstance(data, list):
            if isinstance(data, dict) and 'historical' in data:
                data = data['historical']
            else:
                return None

        data = sorted(data, key=lambda x: x.get('date', ''))
        if len(data) < 100:
            return None
        data = data[-days:]

        dates = [d['date'] for d in data]
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

    def _fetch_earnings(self, ticker: str) -> List[Dict]:
        data = self._fetch_json('earnings-surprises', {'symbol': ticker})
        return data if data and isinstance(data, list) else []

    def _fetch_quote(self, ticker: str) -> Optional[Dict]:
        data = self._fetch_json('quote', {'symbol': ticker})
        return data[0] if data and isinstance(data, list) and len(data) > 0 else None

    # ── CORE FIXES ───────────────────────────────────────────────────────

    def _to_weekly(self, dates: List[str], closes: np.ndarray,
                   highs: np.ndarray, lows: np.ndarray,
                   volumes: np.ndarray) -> Dict:
        """Aggregate daily → weekly con ISO year fix (CRÍTICO)."""
        from collections import defaultdict
        weeks = defaultdict(lambda: {'close': [], 'high': [], 'low': [], 'volume': [], 'date': ''})
        for i, d in enumerate(dates):
            dt = datetime.strptime(d, '%Y-%m-%d')
            iso = dt.isocalendar()
            key = f"{iso.year}-W{iso.week:02d}"

            weeks[key]['close'].append(closes[i])
            weeks[key]['high'].append(highs[i])
            weeks[key]['low'].append(lows[i])
            weeks[key]['volume'].append(volumes[i])
            weeks[key]['date'] = d

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

    def _check_total_lookback_gain(self, daily: Dict, surge_lookback_months: int) -> bool:
        """Valida que la acción haya tenido un peak >= min_surge desde el inicio del lookback (no que el precio actual esté +X%, eso pierde flags después de pullbacks)."""
        if surge_lookback_months <= 0 or len(daily['close']) < 20:
            return True
        cutoff_idx = max(0, len(daily['close']) - int(surge_lookback_months * 21))
        if cutoff_idx >= len(daily['close']) - 1:
            return True
        price_then = daily['close'][cutoff_idx]
        if price_then <= 0:
            return True
        # Use the highest high reached AFTER cutoff, not just current price.
        # Esto permite detectar HTF en consolidación/pullback después del surge.
        peak_after = float(np.max(daily['high'][cutoff_idx:]))
        peak_gain = (peak_after - price_then) / price_then
        return peak_gain >= self.min_surge

    def _detect_surges(self, weekly: Dict) -> List[Dict]:
        """
        Find surge candidates whose peak leaves at least min_flag_weeks of room
        for a flag to form afterward. Without this constraint, an all-time high on
        the last bar (e.g. INTC mid-breakout) is picked as the peak and no flag fits.
        """
        closes = weekly['close']
        highs = weekly['high']
        dates = weekly['dates']
        n = len(closes)

        min_w, max_w = self.surge_weeks_range
        min_fw = self.flag_weeks_range[0]
        latest_peak_idx = n - min_fw - 1
        if latest_peak_idx < min_w:
            return []

        earliest_start_idx = 0
        if self.surge_lookback_months > 0 and n > 0:
            cutoff_date = datetime.now() - timedelta(days=self.surge_lookback_months * 30)
            for idx, d in enumerate(dates):
                if d >= cutoff_date.strftime('%Y-%m-%d'):
                    earliest_start_idx = idx
                    break

        candidates: List[Dict] = []
        for start_idx in range(earliest_start_idx, latest_peak_idx - min_w + 2):
            peak_min = start_idx + min_w - 1
            peak_max = min(start_idx + max_w - 1, latest_peak_idx)
            if peak_min > peak_max:
                continue
            for peak_idx in range(peak_min, peak_max + 1):
                # peak_idx must be the highest high in [start_idx, peak_idx]
                if highs[peak_idx] < np.max(highs[start_idx:peak_idx + 1]) - 1e-9:
                    continue
                low_window = closes[start_idx:start_idx + min(4, peak_idx - start_idx + 1)]
                low_point = float(np.min(low_window))
                if low_point <= 0:
                    continue
                high_point = float(highs[peak_idx])
                surge_pct = (high_point - low_point) / low_point
                if surge_pct < self.min_surge:
                    continue
                candidates.append({
                    'start_idx': int(start_idx),
                    'peak_idx': int(peak_idx),
                    'end_idx': int(peak_idx),
                    'surge_pct': float(surge_pct),
                    'low_price': low_point,
                    'high_price': high_point,
                    'start_date': dates[start_idx],
                    'peak_date': dates[peak_idx],
                    'weeks': int(peak_idx - start_idx + 1),
                })

        # Keep best surge per peak_idx, then take top 5 by recency-weighted strength
        candidates.sort(key=lambda s: (s['surge_pct'], -s['peak_idx']), reverse=True)
        seen_peaks = set()
        unique: List[Dict] = []
        for s in candidates:
            if s['peak_idx'] in seen_peaks:
                continue
            seen_peaks.add(s['peak_idx'])
            unique.append(s)
        unique.sort(key=lambda s: (s['peak_idx'], s['surge_pct']), reverse=True)
        return unique[:5]

    def _detect_flag(self, weekly: Dict, surge: Dict) -> Optional[Dict]:
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
        pole_high = surge['high_price']

        for flag_end in range(peak_idx + min_fw, min(peak_idx + max_fw + 1, n)):
            flag_slice_h = highs[peak_idx + 1:flag_end + 1]
            flag_slice_l = lows[peak_idx + 1:flag_end + 1]
            flag_slice_v = volumes[peak_idx + 1:flag_end + 1]

            flag_high = np.max(flag_slice_h)
            flag_low = np.min(flag_slice_l)
            flag_range = (pole_high - flag_low) / pole_high

            if flag_range > self.max_flag_range:
                continue

            surge_vol = np.mean(volumes[surge['start_idx']:surge['peak_idx'] + 1])
            flag_vol = np.mean(flag_slice_v)
            vol_dryup = flag_vol / surge_vol if surge_vol > 0 else 1.0

            vol_declining = np.polyfit(np.arange(len(flag_slice_v)), flag_slice_v, 1)[0] < 0 if len(flag_slice_v) >= 3 else vol_dryup < 0.65

            weeks = flag_end - peak_idx

            tightness_score = 1.0 - (flag_range / self.max_flag_range)
            dryup_score = max(0, 1.0 - vol_dryup)
            duration_score = 1.0 - abs(weeks - 5) / 5

            if self.ignore_vol_dryup:
                flag_score = tightness_score * 0.65 + duration_score * 0.35
            else:
                flag_score = tightness_score * 0.45 + dryup_score * 0.35 + duration_score * 0.20

            if flag_score > best_score:
                best_score = flag_score
                best_flag = {
                    'start_idx': peak_idx,
                    'end_idx': flag_end,
                    'flag_high': float(pole_high),
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

    # ── Resto de métodos (sin cambios relevantes) ───────────────────────
    # (Mantengo _compute_rs, _match_catalyst, _compute_bollinger_width,
    #  _build_features, _train_synthetic_model, _ml_score, _heuristic_score,
    #  _breakout_proximity, _fusion_score, _generate_narrative, _build_chart_data
    #  exactamente como estaban en tu versión original para no romper nada)

    def _compute_rs(self, stock_closes: np.ndarray, spy_closes: np.ndarray) -> Dict:
        min_len = min(len(stock_closes), len(spy_closes))
        sc = stock_closes[-min_len:]
        sp = spy_closes[-min_len:]
        if len(sc) < 50 or np.any(sp == 0):
            return {'rs_current': 0, 'rs_new_high': False, 'rs_percentile': 50}
        rs_line = sc / sp
        rs_current = rs_line[-1]
        rs_52w_high = np.max(rs_line[-min(252, len(rs_line)):])
        rs_new_high = rs_current >= rs_52w_high * 0.98
        rs_vals = rs_line[-min(252, len(rs_line)):]
        rs_percentile = float(stats.percentileofscore(rs_vals, rs_current))
        return {
            'rs_current': float(rs_current),
            'rs_new_high': bool(rs_new_high),
            'rs_percentile': round(rs_percentile, 1),
            'rs_52w_high': float(rs_52w_high),
        }

    def _match_catalyst(self, surge: Dict, earnings: List[Dict]) -> Optional[Dict]:
        if not earnings:
            return None
        surge_start = surge['start_date']
        surge_peak = surge['peak_date']
        for ep in earnings:
            ep_date = ep.get('date', '')
            if surge_start <= ep_date <= surge_peak:
                actual = ep.get('actualEarningResult', 0)
                estimated = ep.get('estimatedEarning', 0)
                surprise_pct = ((actual - estimated) / abs(estimated)) * 100 if estimated and estimated != 0 else 0
                return {
                    'date': ep_date,
                    'actual_eps': actual,
                    'estimated_eps': estimated,
                    'surprise_pct': round(surprise_pct, 1),
                    'beat': actual > estimated if estimated else False,
                }
        return None

    def _compute_bollinger_width(self, closes: np.ndarray, period: int = 20) -> np.ndarray:
        if len(closes) < period:
            return np.full(len(closes), 0.1)
        sma = np.convolve(closes, np.ones(period) / period, mode='valid')
        std = np.array([np.std(closes[i:i + period]) for i in range(len(closes) - period + 1)])
        bb_width = (2 * std) / np.where(sma > 0, sma, 1)
        pad = np.full(period - 1, bb_width[0] if len(bb_width) > 0 else 0.1)
        return np.concatenate([pad, bb_width])

    def _build_features(self, surge: Dict, flag: Dict, rs: Dict,
                        catalyst: Optional[Dict], vol_dryup: float) -> np.ndarray:
        return np.array([
            surge['surge_pct'],
            surge['weeks'],
            flag['flag_range_pct'] / 100.0,
            flag['weeks'],
            vol_dryup,
            1.0 if flag['vol_declining'] else 0.0,
            rs.get('rs_percentile', 50) / 100.0,
            1.0 if rs.get('rs_new_high', False) else 0.0,
            catalyst['surprise_pct'] / 100.0 if catalyst and catalyst.get('surprise_pct') else 0.0,
            1.0 if catalyst and catalyst.get('beat') else 0.0,
        ])

    def _train_synthetic_model(self):
        if not SKLEARN_AVAILABLE:
            return
        np.random.seed(42)
        n_samples = 500
        pos = np.column_stack([
            np.random.uniform(0.8, 3.0, n_samples),
            np.random.uniform(3, 12, n_samples),
            np.random.uniform(0.02, 0.10, n_samples),
            np.random.uniform(2, 8, n_samples),
            np.random.uniform(0.2, 0.5, n_samples),
            np.random.binomial(1, 0.8, n_samples),
            np.random.uniform(0.7, 1.0, n_samples),
            np.random.binomial(1, 0.7, n_samples),
            np.random.uniform(0.1, 0.8, n_samples),
            np.random.binomial(1, 0.75, n_samples),
        ])
        neg = np.column_stack([
            np.random.uniform(0.3, 1.5, n_samples),
            np.random.uniform(1, 20, n_samples),
            np.random.uniform(0.08, 0.30, n_samples),
            np.random.uniform(1, 15, n_samples),
            np.random.uniform(0.5, 1.2, n_samples),
            np.random.binomial(1, 0.3, n_samples),
            np.random.uniform(0.2, 0.7, n_samples),
            np.random.binomial(1, 0.2, n_samples),
            np.random.uniform(-0.3, 0.3, n_samples),
            np.random.binomial(1, 0.3, n_samples),
        ])
        X = np.vstack([pos, neg])
        y = np.concatenate([np.ones(n_samples), np.zeros(n_samples)])
        self._scaler = StandardScaler()
        X_scaled = self._scaler.fit_transform(X)
        self._ml_model = GradientBoostingClassifier(n_estimators=100, max_depth=5, random_state=42)
        self._ml_model.fit(X_scaled, y)
        HTFDetectionEngine._shared_ml_model = self._ml_model
        HTFDetectionEngine._shared_scaler = self._scaler
        logger.info("HTF ML model trained on synthetic data")

    def _ml_score(self, features: np.ndarray) -> float:
        if not self.ml_mode or self._ml_model is None:
            return self._heuristic_score(features)
        try:
            X = self._scaler.transform(features.reshape(1, -1))
            prob = self._ml_model.predict_proba(X)[0][1]
            return float(prob)
        except Exception:
            return self._heuristic_score(features)

    def _heuristic_score(self, features: np.ndarray) -> float:
        surge_pct = features[0]
        flag_range = features[2]
        vol_dryup = features[4]
        vol_declining = features[5]
        rs_pct = features[6]
        rs_new_high = features[7]
        catalyst = features[9]
        score = 0.0
        if self.ignore_vol_dryup:
            score += min(surge_pct / 2.0, 1.0) * 0.30
            score += max(0, 1.0 - flag_range / 0.15) * 0.30
            score += rs_pct * 0.20
            score += rs_new_high * 0.05
            score += catalyst * 0.15
        else:
            score += min(surge_pct / 2.0, 1.0) * 0.20
            score += max(0, 1.0 - flag_range / 0.15) * 0.25
            score += max(0, 1.0 - vol_dryup) * 0.20
            score += vol_declining * 0.05
            score += rs_pct * 0.15
            score += rs_new_high * 0.05
            score += catalyst * 0.10
        return float(min(max(score, 0), 1.0))

    def _breakout_proximity(self, daily: Dict, flag: Optional[Dict]) -> Dict:
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

    def _fusion_score(self, metrics_score: float, ml_prob: float, breakout: Dict) -> float:
        proximity_score = 0
        if breakout['breakout_triggered'] and breakout['vol_confirmation']:
            proximity_score = 1.0
        elif breakout['breakout_triggered']:
            proximity_score = 0.7
        elif breakout['proximity_pct'] > -3:
            proximity_score = 0.5
        elif breakout['proximity_pct'] > -5:
            proximity_score = 0.3
        raw = metrics_score * 0.40 + ml_prob * 0.30 + proximity_score * 0.30
        return round(raw * 100, 1)

    def _generate_narrative(self, ticker: str, surge: Dict, flag: Optional[Dict],
                            catalyst: Optional[Dict], rs: Dict,
                            breakout: Dict, score: float) -> str:
        parts = []
        if score >= 70:
            parts.append(f"**HTF DETECTED** on {ticker} — Score {score}/100")
        elif score >= 50:
            parts.append(f"**Potential HTF forming** on {ticker} — Score {score}/100")
        else:
            parts.append(f"**No valid HTF** on {ticker} — Score {score}/100")
        parts.append(f"Surge: +{surge['surge_pct']*100:.0f}% in {surge['weeks']} weeks "
                     f"({surge['start_date']} → {surge['peak_date']})")
        if catalyst:
            parts.append(f"Catalyst: EPS {'beat' if catalyst['beat'] else 'miss'} "
                         f"{catalyst['surprise_pct']:+.1f}% on {catalyst['date']}")
        else:
            parts.append("No confirmed earnings catalyst — check for news")
        if flag:
            parts.append(f"Flag: {flag['flag_range_pct']:.1f}% range over {flag['weeks']} weeks, "
                         f"vol dry-up {flag['vol_dryup_ratio']:.2f} "
                         f"({'declining ✓' if flag['vol_declining'] else 'not declining ✗'})")
        else:
            parts.append("No valid flag detected")
        rs_status = "RS new highs ✓" if rs.get('rs_new_high') else f"RS at {rs.get('rs_percentile', 0):.0f}th percentile"
        parts.append(rs_status)
        if breakout.get('breakout_triggered') and breakout.get('vol_confirmation'):
            parts.append(f"⚡ BREAKOUT CONFIRMED — price above flag high ${breakout.get('flag_high', 0):.2f} "
                         f"with {breakout.get('vol_ratio', 0):.1f}x avg volume")
        elif breakout.get('breakout_triggered'):
            parts.append(f"Price above flag high but volume weak")
        elif breakout.get('proximity_pct', -99) > -5 and breakout.get('flag_high', 0) > 0:
            parts.append(f"Breakout watch: {breakout['proximity_pct']:+.1f}% from flag high")
        return "\n".join(parts)

    def _build_chart_data(self, daily: Dict, surge: Dict, flag: Optional[Dict], weekly: Dict) -> List[Dict]:
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

    # ── MAIN ANALYSIS ───────────────────────────────────────────────────
    def analyze(self, ticker: str) -> Dict[str, Any]:
        ticker = ticker.upper().strip()

        daily = self._fetch_daily_prices(ticker, days=756)
        if daily is None or len(daily['close']) < 100:
            return {'error': f'Insufficient price data for {ticker}'}

        # NUEVA VALIDACIÓN DE LOOKBACK (anti-falsos)
        if self.surge_lookback_months > 0 and not self._check_total_lookback_gain(daily, self.surge_lookback_months):
            return {
                'detected': False,
                'score': 0,
                'narrative': f"No cumple +100% en los últimos {self.surge_lookback_months} meses.",
                'ticker': ticker,
            }

        spy_closes = self._fetch_spy_prices(days=756)
        earnings = self._fetch_earnings(ticker)
        quote = self._fetch_quote(ticker)

        weekly = self._to_weekly(daily['dates'], daily['close'], daily['high'],
                                 daily['low'], daily['volume'])

        if len(weekly['close']) < 20:
            return {'error': f'Insufficient weekly data for {ticker}'}

        surges = self._detect_surges(weekly)
        if not surges:
            return {
                'detected': False,
                'score': 0,
                'patterns': [],
                'narrative': f'No explosive surges (≥{self.min_surge*100:.0f}%) detected.',
                'ticker': ticker,
                'current_price': float(daily['close'][-1]),
                'analysis_date': daily['dates'][-1],
            }

        if self.ml_mode and self._ml_model is None:
            self._train_synthetic_model()

        rs = self._compute_rs(daily['close'], spy_closes) if spy_closes is not None else \
             {'rs_current': 0, 'rs_new_high': False, 'rs_percentile': 50}

        patterns = []
        for surge in surges:
            flag = self._detect_flag(weekly, surge)
            catalyst = self._match_catalyst(surge, earnings)
            vol_dryup = flag['vol_dryup_ratio'] if flag else 1.0

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

        patterns.sort(key=lambda p: p['fusion_score'], reverse=True)
        best = patterns[0]
        chart_data = self._build_chart_data(daily, best['surge'], best.get('flag'), weekly)

        return {
            'detected': best['fusion_score'] >= 50,
            'score': best['fusion_score'],
            'ticker': ticker,
            'current_price': float(daily['close'][-1]),
            'analysis_date': daily['dates'][-1],
            'patterns': patterns,
            'best_pattern': {**best},
            'relative_strength': rs,
            'narrative': best['narrative'],
            'chart_data': chart_data,
            'ml_available': self.ml_mode,
            'quote': quote,
        }


# ── Singleton ────────────────────────────────────────────────────────────
_engine_instance: Optional[HTFDetectionEngine] = None

def get_htf_engine() -> HTFDetectionEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = HTFDetectionEngine()
    return _engine_instance
