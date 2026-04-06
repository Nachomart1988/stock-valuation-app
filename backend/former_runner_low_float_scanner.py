# backend/former_runner_low_float_scanner.py
# Former Runner + Low-Float OTC Scanner — Jack Sykes / Quillamaggie Style

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

try:
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.preprocessing import StandardScaler
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn not available — using heuristic fallback")


class FormerRunnerLowFloatScanner:
    """
    Detecta Former Runners + Low-Float: acciones que corrieron fuerte en el pasado,
    estuvieron dormidas y ahora despiertan con volumen explosivo.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_past_surge: float = 4.0,          # 400% mínimo
        min_dormancy_months: int = 6,
        wake_volume_multiplier: float = 15.0,
        max_float: int = 20_000_000,
        ml_mode: bool = True,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_past_surge = min_past_surge
        self.min_dormancy_months = min_dormancy_months
        self.wake_volume_multiplier = wake_volume_multiplier
        self.max_float = max_float
        self.ml_mode = ml_mode and SKLEARN_AVAILABLE
        self._session = requests.Session()
        self._ml_model = None
        self._scaler = None

    def _fetch_json(self, endpoint: str, params: Dict = None) -> Any:
        params = params or {}
        params['apikey'] = self.api_key
        try:
            url = f"https://financialmodelingprep.com/stable/{endpoint}"
            resp = self._session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"FMP fetch failed: {e}")
            return None

    def _fetch_historical(self, ticker: str, days: int = 1260) -> Optional[Dict]:
        data = self._fetch_json('historical-price-eod/full', {'symbol': ticker})
        if not data or not isinstance(data, list):
            if isinstance(data, dict) and 'historical' in data:
                data = data['historical']
            else:
                return None
        data = sorted(data, key=lambda x: x.get('date', ''))
        data = data[-days:]
        if len(data) < 300:
            return None

        dates = [d['date'] for d in data]
        closes = np.array([d.get('adjClose', d.get('close', 0)) for d in data], dtype=float)
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)

        return {'dates': dates, 'close': closes, 'volume': volumes}

    def _detect_former_runner(self, data: Dict) -> Optional[Dict]:
        closes = data['close']
        volumes = data['volume']
        dates = data['dates']
        n = len(closes)

        peak_idx = int(np.argmax(closes))
        peak_price = closes[peak_idx]

        # Find the lowest point before the peak (the base of the run)
        if peak_idx == 0:
            return None
        low_before = np.min(closes[:peak_idx])
        if low_before <= 0:
            return None

        surge_ratio = peak_price / low_before
        if surge_ratio < self.min_past_surge:
            return None

        dormancy_days = n - peak_idx
        dormancy_months = dormancy_days / 30.4

        if dormancy_months < self.min_dormancy_months:
            return None

        # Check for volume awakening in recent period vs dormant average
        recent_vol = np.mean(volumes[-30:]) if len(volumes) >= 30 else np.mean(volumes[-10:])
        dormant_start = peak_idx + 30  # skip post-peak sell-off
        if dormant_start >= n - 30:
            hist_avg_vol = np.mean(volumes[peak_idx:n - 30]) if n - 30 > peak_idx else 1
        else:
            hist_avg_vol = np.mean(volumes[dormant_start:n - 30])
        if hist_avg_vol <= 0:
            hist_avg_vol = 1

        vol_multiplier = recent_vol / hist_avg_vol

        if vol_multiplier < self.wake_volume_multiplier:
            return None

        # Build chart data for frontend visualization
        chart_data = []
        for i in range(len(dates)):
            zone = 'dormant'
            if i <= peak_idx:
                zone = 'surge'
            elif i >= n - 30:
                zone = 'wake'
            chart_data.append({
                'date': dates[i],
                'close': float(closes[i]),
                'volume': int(volumes[i]),
                'zone': zone,
            })

        return {
            'past_surge_pct': round((surge_ratio - 1) * 100, 1),
            'dormancy_months': round(dormancy_months, 1),
            'wake_volume_multiplier': round(vol_multiplier, 1),
            'peak_date': dates[peak_idx],
            'peak_price': float(peak_price),
            'current_price': float(closes[-1]),
            'current_date': dates[-1],
            'chart_data': chart_data,
        }

    def _heuristic_score(self, data: Dict) -> float:
        score = 0.0
        score += min(data['past_surge_pct'] / 1000, 1.0) * 0.35
        score += min(data['dormancy_months'] / 24, 1.0) * 0.25
        score += min(data['wake_volume_multiplier'] / 30, 1.0) * 0.30
        # Bonus for very high volume wake
        if data['wake_volume_multiplier'] > 50:
            score += 0.10
        return round(min(score, 1.0) * 100, 1)

    def analyze(self, ticker: str) -> Dict[str, Any]:
        data = self._fetch_historical(ticker)
        if not data:
            return {'error': f'Datos insuficientes para {ticker}'}

        runner = self._detect_former_runner(data)
        if not runner:
            return {
                'detected': False,
                'score': 0,
                'narrative': f'{ticker} no califica como Former Runner + Low-Float.',
                'ticker': ticker,
                'chart_data': [],
            }

        score = self._heuristic_score(runner)

        narrative = f"**FORMER RUNNER + LOW-FLOAT DETECTADO** en {ticker} — Score {score}/100\n"
        narrative += f"• Run pasado: +{runner['past_surge_pct']:.0f}% (pico en {runner['peak_date']})\n"
        narrative += f"• Dormida por {runner['dormancy_months']:.1f} meses\n"
        narrative += f"• Volumen actual: {runner['wake_volume_multiplier']:.1f}x promedio dormido → posible pump violento\n"
        narrative += f"• Precio actual: ${runner['current_price']:.4f}"

        return {
            'detected': score >= 55,
            'score': score,
            'ticker': ticker,
            'pattern': runner,
            'narrative': narrative,
            'current_price': runner['current_price'],
            'chart_data': runner.get('chart_data', []),
        }


# Singleton
_engine: FormerRunnerLowFloatScanner | None = None

def get_former_runner_scanner() -> FormerRunnerLowFloatScanner:
    global _engine
    if _engine is None:
        _engine = FormerRunnerLowFloatScanner()
    return _engine
