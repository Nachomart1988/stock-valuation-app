# backend/cheap_breakout_scanner.py
# Cheap Breakout Scanner (.01-.10 + explosive volume) — Jack Sykes Classic

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Minimum rolling window for computing the volume baseline
VOL_MA_WINDOW = 120  # 120 trading days (~6 months) — long enough to smooth OTC dead days
MIN_NONZERO_DAYS = 30  # Need at least 30 non-zero volume days in the window to trust the avg


class CheapBreakoutScanner:
    """
    Detecta breakouts en el rango 0.01-0.10 con volumen explosivo vs media móvil
    de 120 días (excluyendo días con volumen 0).
    Setup favorito de Jack Sykes en OTCs.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_price: float = 0.01,
        max_price: float = 0.10,
        min_volume_multiplier: float = 15.0,
        min_absolute_volume: int = 50_000,   # Minimum raw volume to consider
        lookback_days: int = 504,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_price = min_price
        self.max_price = max_price
        self.min_volume_multiplier = min_volume_multiplier
        self.min_absolute_volume = min_absolute_volume
        self.lookback_days = lookback_days
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
        if len(data) < 60:
            return None

        dates = [d['date'] for d in data]
        closes = np.array([d.get('adjClose', d.get('close', 0)) for d in data], dtype=float)
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)

        return {'dates': dates, 'close': closes, 'volume': volumes}

    def _compute_nonzero_rolling_avg(self, volumes: np.ndarray) -> np.ndarray:
        """
        Compute a rolling average of volume over VOL_MA_WINDOW days,
        but EXCLUDING days where volume == 0 from the mean calculation.
        This avoids OTC dead-day dilution where many days have 0 volume.
        Returns an array the same length as volumes.
        """
        n = len(volumes)
        avg = np.zeros(n, dtype=float)

        for i in range(n):
            # Look back up to VOL_MA_WINDOW days
            start = max(0, i - VOL_MA_WINDOW)
            window = volumes[start:i]  # exclude current day
            nonzero = window[window > 0]

            if len(nonzero) >= MIN_NONZERO_DAYS:
                avg[i] = np.mean(nonzero)
            elif len(nonzero) > 0:
                # Not enough data but some — use what we have, flagged as unreliable
                avg[i] = np.mean(nonzero)
            else:
                avg[i] = 0  # No valid baseline

        return avg

    def analyze(self, ticker: str) -> Dict[str, Any]:
        data = self._fetch_historical(ticker)
        if not data or len(data['close']) < 60:
            return {'error': f'Datos insuficientes para {ticker}'}

        closes = data['close']
        volumes = data['volume']
        dates = data['dates']

        in_range = (closes >= self.min_price) & (closes <= self.max_price)
        if not np.any(in_range):
            return {
                'detected': False,
                'score': 0,
                'narrative': f'{ticker} no está en rango .01-.10.',
                'ticker': ticker,
                'chart_data': [],
            }

        # 120-day rolling average volume (excluding zero-volume days)
        avg_vol = self._compute_nonzero_rolling_avg(volumes)

        breakouts = []
        for i in range(1, len(closes)):
            if not in_range[i]:
                continue
            prev_close = closes[i - 1]
            if prev_close <= 0:
                continue

            # Skip if today's volume doesn't meet absolute minimum
            if volumes[i] < self.min_absolute_volume:
                continue

            # Skip if no reliable baseline
            if avg_vol[i] <= 0:
                continue

            breakout_pct = (closes[i] - prev_close) / prev_close
            vol_multiplier = volumes[i] / avg_vol[i]

            if breakout_pct >= 0.20 and vol_multiplier >= self.min_volume_multiplier:
                breakouts.append({
                    'date': dates[i],
                    'breakout_pct': round(breakout_pct * 100, 1),
                    'volume_multiplier': round(vol_multiplier, 1),
                    'price': round(float(closes[i]), 4),
                    'volume': int(volumes[i]),
                    'avg_volume_120d': int(avg_vol[i]),
                })

        # Build chart data
        chart_data = []
        breakout_dates = {b['date'] for b in breakouts}
        for i in range(len(dates)):
            chart_data.append({
                'date': dates[i],
                'close': round(float(closes[i]), 4),
                'volume': int(volumes[i]),
                'avg_vol_120': round(float(avg_vol[i]), 0) if avg_vol[i] > 0 else 0,
                'is_breakout': dates[i] in breakout_dates,
                'in_range': bool(in_range[i]),
            })

        if not breakouts:
            return {
                'detected': False,
                'score': 0,
                'narrative': f'No se detectaron breakouts .01-.10 con volumen explosivo en {ticker}.',
                'ticker': ticker,
                'chart_data': chart_data[-120:],
            }

        best = breakouts[-1]
        score = min(100, int(40 + best['breakout_pct'] * 2 + best['volume_multiplier'] * 3))

        narrative = f"**CHEAP BREAKOUT DETECTADO** en {ticker} — Score {score}/100\n"
        narrative += f"• Breakout: +{best['breakout_pct']:.1f}% en rango centavos\n"
        narrative += f"• Volumen: {best['volume_multiplier']:.1f}x vs MA-120d (excl. días muertos) → explosivo\n"
        narrative += f"• Volumen raw: {best['volume']:,} vs avg {best['avg_volume_120d']:,}\n"
        narrative += f"• Precio: ${best['price']:.4f}\n"
        narrative += f"• Total breakouts detectados: {len(breakouts)}\n"
        narrative += "→ Setup clásico de Jack Sykes: lottery ticket con momentum institucional."

        return {
            'detected': True,
            'score': score,
            'ticker': ticker,
            'breakouts': breakouts[-5:],
            'best_breakout': best,
            'narrative': narrative,
            'current_price': float(closes[-1]),
            'chart_data': chart_data[-120:],
        }


# Singleton
_engine: CheapBreakoutScanner | None = None

def get_cheap_breakout_scanner() -> CheapBreakoutScanner:
    global _engine
    if _engine is None:
        _engine = CheapBreakoutScanner()
    return _engine
