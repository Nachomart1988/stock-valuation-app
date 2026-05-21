# backend/cheap_breakout_scanner.py
# Cheap Breakout Scanner — COILED SPRING (pre-breakout) edition
# Looks for cheap stocks consolidating tight near recent resistance,
# i.e. SET UP to break out — not stocks that already exploded.

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, Optional, Any

logger = logging.getLogger(__name__)

# Rolling window for the "baseline" volume average (used to grade prior interest)
BASELINE_VOL_WINDOW = 120
MIN_NONZERO_DAYS = 30


class CheapBreakoutScanner:
    """
    Detects penny stocks (cents range) currently set up for a potential
    breakout: price near a recent resistance high, tight consolidation,
    closes clustered in the upper half of the range, recent volume drying
    up, and prior institutional interest (a past volume spike).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        min_price: float = 0.01,
        max_price: float = 0.10,
        max_dist_to_resistance_pct: float = 8.0,
        resistance_lookback_weeks: int = 8,
        coil_window_days: int = 10,
        max_coil_pct: float = 25.0,
        min_prior_spike_multiplier: float = 5.0,
        prior_spike_lookback_days: int = 120,
        min_prev_day_volume: int = 0,
        min_recent_avg_volume: int = 10_000,
        exclude_recent_breakout_days: int = 5,
        lookback_days: int = 504,
    ):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.min_price = min_price
        self.max_price = max_price
        self.max_dist_to_resistance_pct = max_dist_to_resistance_pct
        self.resistance_lookback_days = max(20, int(resistance_lookback_weeks * 5))
        self.coil_window_days = max(3, int(coil_window_days))
        self.max_coil_pct = max_coil_pct
        self.min_prior_spike_multiplier = max(1.0, float(min_prior_spike_multiplier))
        self.prior_spike_lookback_days = max(30, int(prior_spike_lookback_days))
        self.min_prev_day_volume = max(0, int(min_prev_day_volume or 0))
        self.min_recent_avg_volume = max(0, int(min_recent_avg_volume or 0))
        self.exclude_recent_breakout_days = max(0, int(exclude_recent_breakout_days))
        self.lookback_days = lookback_days
        self._session = requests.Session()

    # ── data fetch ───────────────────────────────────────────────

    def _fetch_json(self, endpoint: str, params: Optional[Dict] = None) -> Any:
        params = dict(params or {})
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
        highs = np.array([d.get('high', d.get('close', 0)) for d in data], dtype=float)
        lows = np.array([d.get('low', d.get('close', 0)) for d in data], dtype=float)
        volumes = np.array([d.get('volume', 0) for d in data], dtype=float)

        return {'dates': dates, 'close': closes, 'high': highs, 'low': lows, 'volume': volumes}

    # ── helpers ──────────────────────────────────────────────────

    def _baseline_volume(self, volumes: np.ndarray) -> float:
        """Mean of non-zero volumes over the trailing BASELINE_VOL_WINDOW days."""
        window = volumes[-BASELINE_VOL_WINDOW:]
        nonzero = window[window > 0]
        if len(nonzero) == 0:
            return 0.0
        return float(np.mean(nonzero))

    def _days_in_range(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, max_pct: float) -> int:
        """Walk back from the end; count days while the cumulative high-low range stays under max_pct."""
        n = len(closes)
        if n == 0:
            return 0
        cur_high = closes[-1]
        cur_low = closes[-1]
        days = 0
        for i in range(n - 1, -1, -1):
            cur_high = max(cur_high, float(highs[i]))
            cur_low = min(cur_low, float(lows[i]))
            mean_close = (cur_high + cur_low) / 2.0
            if mean_close <= 0:
                break
            rng_pct = (cur_high - cur_low) / mean_close * 100.0
            if rng_pct > max_pct:
                break
            days += 1
        return days

    def _build_chart_data(
        self, dates, closes, highs, lows, volumes, window,
        resistance: float, coil_high: float, coil_low: float, coil_start_idx: int,
    ) -> list:
        out = []
        start = max(0, len(dates) - window)
        for i in range(start, len(dates)):
            point = {
                'date': dates[i],
                'close': round(float(closes[i]), 4),
                'high': round(float(highs[i]), 4),
                'low': round(float(lows[i]), 4),
                'volume': int(volumes[i]),
                'resistance': round(float(resistance), 4) if resistance > 0 else None,
                'in_coil': bool(coil_start_idx >= 0 and i >= coil_start_idx),
            }
            if coil_high > 0 and coil_low > 0:
                point['coil_high'] = round(float(coil_high), 4)
                point['coil_low'] = round(float(coil_low), 4)
            out.append(point)
        return out

    # ── main ─────────────────────────────────────────────────────

    def analyze(self, ticker: str) -> Dict[str, Any]:
        data = self._fetch_historical(ticker)
        if not data or len(data['close']) < 60:
            return {'error': f'Datos insuficientes para {ticker}'}

        closes = data['close']
        highs = data['high']
        lows = data['low']
        volumes = data['volume']
        dates = data['dates']
        n = len(closes)
        current_price = float(closes[-1])
        chart_window = min(120, n)

        # 1. Price range
        if current_price < self.min_price or current_price > self.max_price:
            return self._not_detected(
                ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                reason=f'{ticker} fuera de rango (${current_price:.4f})',
            )

        baseline_vol = self._baseline_volume(volumes)

        # 2. Resistance — highest high in the lookback window, excluding the last `excl` days
        excl = self.exclude_recent_breakout_days
        rb = self.resistance_lookback_days
        if excl > 0 and rb > excl:
            res_high_window = highs[-rb:-excl]
        else:
            res_high_window = highs[-rb:]
        if len(res_high_window) < 5:
            return {'error': f'Insuficiente historia para resistencia de {ticker}'}
        resistance = float(np.max(res_high_window))
        if resistance <= 0:
            return {'error': f'Resistencia inválida para {ticker}'}

        dist_pct = (resistance - current_price) / current_price * 100.0

        # Too far below — not close to popping
        if dist_pct > self.max_dist_to_resistance_pct:
            return self._not_detected(
                ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                reason=f'{ticker} a {dist_pct:.1f}% de resistencia (> {self.max_dist_to_resistance_pct:.0f}%)',
                resistance=resistance,
            )
        # Already blown through — breakout in progress, no longer "pre"
        if dist_pct < -3.0:
            return self._not_detected(
                ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                reason=f'{ticker} ya rompió resistencia (+{-dist_pct:.1f}%) — breakout en curso',
                resistance=resistance,
            )

        # 3. Coil tightness — range over last coil_window_days as % of mean close
        cwd = self.coil_window_days
        coil_highs = highs[-cwd:]
        coil_lows = lows[-cwd:]
        coil_closes = closes[-cwd:]
        coil_mean = float(np.mean(coil_closes))
        if coil_mean <= 0:
            return {'error': f'Mean coil inválido para {ticker}'}
        coil_high = float(np.max(coil_highs))
        coil_low = float(np.min(coil_lows))
        coil_pct = (coil_high - coil_low) / coil_mean * 100.0

        if coil_pct > self.max_coil_pct:
            return self._not_detected(
                ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                reason=f'{ticker} rango {coil_pct:.1f}% (> {self.max_coil_pct:.0f}% — sin compresión)',
                resistance=resistance,
            )

        # 4. Closes-in-upper-half (accumulation pattern)
        closes_position = (coil_mean - coil_low) / (coil_high - coil_low) if coil_high > coil_low else 0.5

        # 5. Recent volume vs baseline (dryness)
        recent_vol_window = volumes[-cwd:]
        recent_nonzero = recent_vol_window[recent_vol_window > 0]
        recent_avg_vol = float(np.mean(recent_nonzero)) if len(recent_nonzero) > 0 else 0.0
        vol_dryness = (recent_avg_vol / baseline_vol) if baseline_vol > 0 else 0.0

        # Liquidity floors
        if self.min_recent_avg_volume > 0 and recent_avg_vol < self.min_recent_avg_volume:
            return self._not_detected(
                ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                reason=f'{ticker} vol reciente {int(recent_avg_vol):,} < piso {self.min_recent_avg_volume:,}',
                resistance=resistance,
            )
        if self.min_prev_day_volume > 0 and n >= 2 and volumes[-2] < self.min_prev_day_volume:
            return self._not_detected(
                ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                reason=f'{ticker} vol día previo {int(volumes[-2]):,} < piso {self.min_prev_day_volume:,}',
                resistance=resistance,
            )

        # 6. Prior interest (a volume spike within the lookback window, OUTSIDE the coil)
        ps_lookback = self.prior_spike_lookback_days
        if ps_lookback > cwd:
            prior_window = volumes[-ps_lookback:-cwd]
        else:
            prior_window = volumes[-ps_lookback:]
        prior_max_vol = float(np.max(prior_window)) if len(prior_window) > 0 else 0.0
        prior_spike_mult = (prior_max_vol / baseline_vol) if baseline_vol > 0 else 0.0
        had_prior_spike = prior_spike_mult >= self.min_prior_spike_multiplier

        # 7. Exclude if a sharp breakout day already happened recently
        if excl > 0 and n > excl:
            for i in range(n - excl, n):
                prev = float(closes[i - 1])
                if prev <= 0:
                    continue
                gain_pct = (float(closes[i]) - prev) / prev * 100.0
                day_vol_mult = (float(volumes[i]) / baseline_vol) if baseline_vol > 0 else 0.0
                if gain_pct >= 20.0 and day_vol_mult >= 5.0:
                    return self._not_detected(
                        ticker, current_price, dates, closes, highs, lows, volumes, chart_window,
                        reason=f'{ticker} ya tuvo breakout reciente (+{gain_pct:.1f}% con {day_vol_mult:.1f}x vol)',
                        resistance=resistance,
                    )

        # 8. Days in range
        days_in_range = self._days_in_range(highs, lows, closes, self.max_coil_pct)
        coil_start_idx = max(0, n - days_in_range)

        # ── SCORE ───────────────────────────────────────────────
        # Proximity (0–30): closer to resistance ⇒ higher
        clamped_dist = max(0.0, dist_pct)
        prox_score = max(0.0, (self.max_dist_to_resistance_pct - clamped_dist) / self.max_dist_to_resistance_pct * 30.0)
        # Tightness (0–25): tighter coil ⇒ higher
        tight_score = max(0.0, (self.max_coil_pct - coil_pct) / self.max_coil_pct * 25.0)
        # Closes position (0–15): upper half ⇒ higher
        cp_score = max(0.0, min(15.0, closes_position * 15.0))
        # Prior spike (0–15)
        if baseline_vol > 0 and self.min_prior_spike_multiplier > 0:
            ps_score = min(15.0, prior_spike_mult / self.min_prior_spike_multiplier * 15.0)
        else:
            ps_score = 0.0
        if not had_prior_spike:
            ps_score *= 0.5
        # Volume dryness (0–15): vol_dryness < 1 ⇒ higher, capped at 0
        if vol_dryness > 0:
            dry_score = max(0.0, min(15.0, (1.0 - min(1.5, vol_dryness)) / 1.5 * 15.0))
        else:
            dry_score = 0.0

        score = int(round(prox_score + tight_score + cp_score + ps_score + dry_score))
        score = max(0, min(100, score))

        # Narrative
        narrative = self._build_narrative(
            ticker, score, current_price, resistance, dist_pct,
            coil_pct, days_in_range, closes_position, vol_dryness,
            prior_spike_mult, had_prior_spike,
        )

        # Chart
        chart_data = self._build_chart_data(
            dates, closes, highs, lows, volumes, chart_window,
            resistance, coil_high, coil_low, coil_start_idx,
        )

        return {
            'detected': True,
            'score': score,
            'ticker': ticker,
            'narrative': narrative,
            'current_price': current_price,
            'setup': {
                'resistance': round(resistance, 4),
                'dist_to_resistance_pct': round(dist_pct, 2),
                'coil_pct': round(coil_pct, 2),
                'coil_high': round(coil_high, 4),
                'coil_low': round(coil_low, 4),
                'days_in_range': int(days_in_range),
                'closes_position': round(float(closes_position), 3),
                'vol_dryness': round(vol_dryness, 2),
                'recent_avg_volume': int(recent_avg_vol),
                'baseline_volume': int(baseline_vol),
                'prior_spike_multiplier': round(prior_spike_mult, 1),
                'had_prior_spike': bool(had_prior_spike),
                'prev_day_volume': int(volumes[-2]) if n >= 2 else 0,
            },
            'chart_data': chart_data,
        }

    # ── narratives & not-detected helper ─────────────────────────

    def _build_narrative(
        self, ticker, score, price, resistance, dist_pct,
        coil_pct, days, cp, dryness, prior_mult, had_prior,
    ) -> str:
        lines = [
            f"**COILED SPRING** en {ticker} — Score {score}/100",
            f"• Precio: ${price:.4f}  ·  Resistencia: ${resistance:.4f}",
        ]
        if dist_pct >= 0:
            lines.append(f"• Distancia al techo: {dist_pct:.1f}% por debajo")
        else:
            lines.append(f"• Tocando techo: +{-dist_pct:.1f}% sobre resistencia")
        lines.append(f"• Coil (rango {self.coil_window_days}d): {coil_pct:.1f}%  ·  Días consolidando: ~{days}")
        lines.append(f"• Cierres en {int(cp * 100)}% superior del rango (≥50% = acumulación)")
        if dryness > 0:
            lines.append(f"• Volumen reciente vs baseline: {dryness:.2f}x ({'secándose' if dryness < 1 else 'activo'})")
        if had_prior:
            lines.append(f"• Huella institucional previa: {prior_mult:.1f}x baseline ✓")
        else:
            lines.append(f"• Sin spike previo significativo ({prior_mult:.1f}x baseline)")
        lines.append("→ Pre-breakout: resorte cargado cerca de resistencia.")
        return "\n".join(lines)

    def _not_detected(
        self, ticker, price, dates, closes, highs, lows, volumes, window,
        reason: str, resistance: float = 0.0,
    ) -> Dict[str, Any]:
        chart_data = []
        start = max(0, len(dates) - window)
        for i in range(start, len(dates)):
            chart_data.append({
                'date': dates[i],
                'close': round(float(closes[i]), 4),
                'high': round(float(highs[i]), 4),
                'low': round(float(lows[i]), 4),
                'volume': int(volumes[i]),
                'resistance': round(float(resistance), 4) if resistance > 0 else None,
                'in_coil': False,
            })
        return {
            'detected': False,
            'score': 0,
            'ticker': ticker,
            'current_price': float(price),
            'narrative': reason,
            'setup': None,
            'chart_data': chart_data,
        }


# Singleton
_engine: Optional[CheapBreakoutScanner] = None


def get_cheap_breakout_scanner() -> CheapBreakoutScanner:
    global _engine
    if _engine is None:
        _engine = CheapBreakoutScanner()
    return _engine
