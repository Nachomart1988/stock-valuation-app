# backend/spectral_cycle_analyzer.py
# FFT Spectral Cycle Analysis Engine
# Detects dominant market cycles using Fast Fourier Transform
# Generates trading signals based on cycle phase, momentum, and volatility

import numpy as np
from scipy import signal as scipy_signal
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import requests
import traceback


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class CycleInfo:
    """A detected market cycle"""
    period_days: float      # Cycle length in trading days
    amplitude: float        # Relative amplitude (normalized)
    phase_degrees: float    # Current phase position (0-360)
    contribution_pct: float # % of total spectral power


@dataclass
class SpectralCycleResult:
    """Complete results from FFT spectral analysis"""
    dominant_cycles: List[CycleInfo]
    current_phase: str              # 'trough', 'rising', 'peak', 'falling', 'unknown'
    phase_position: float           # 0.0 (trough) to 1.0 (peak)
    cycle_strength: float           # 0-1, how dominant the cycles are vs noise
    momentum_confirmation: bool     # SMA5 > SMA20
    atr_normalized: float           # Current ATR as % of price
    rsi_value: float                # RSI of detrended signal
    reconstructed_vs_price: float   # Ratio: reconstructed / actual price trend
    spectral_score: float           # Final score 0-100
    bars_analyzed: int
    signal_description: str         # Human-readable summary
    trading_regime: str             # 'trending', 'cycling', 'noisy'


# ═══════════════════════════════════════════════════════════════════════════════
# HISTORICAL DATA FETCHER (FMP API)
# ═══════════════════════════════════════════════════════════════════════════════

class HistoricalDataFetcher:
    """Fetch and cache historical price data from Financial Modeling Prep API"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._cache: Dict[str, Tuple[List[Dict], float]] = {}
        self.cache_ttl = 300  # 5 minutes

    def fetch(self, ticker: str, max_bars: int = 600) -> List[Dict]:
        """
        Fetch daily OHLCV data with in-memory caching.
        Returns list of dicts with keys: date, open, high, low, close, volume
        Sorted from oldest to newest.
        """
        now = datetime.now().timestamp()

        # Check cache
        if ticker in self._cache:
            data, cached_at = self._cache[ticker]
            if now - cached_at < self.cache_ttl:
                print(f"[HistoricalFetcher] Cache hit for {ticker} ({len(data)} bars)")
                return data[-max_bars:] if len(data) > max_bars else data

        try:
            url = (
                f"https://financialmodelingprep.com/stable/historical-price-eod/full"
                f"?symbol={ticker}&apikey={self.api_key}"
            )
            print(f"[HistoricalFetcher] Fetching historical data for {ticker}...")
            response = requests.get(url, timeout=15)
            response.raise_for_status()

            raw = response.json()
            historical = raw.get('historical', [])

            if not historical:
                print(f"[HistoricalFetcher] No historical data returned for {ticker}")
                return []

            # FMP returns newest first — reverse to oldest first
            historical = list(reversed(historical))

            # Trim to max_bars
            if len(historical) > max_bars:
                historical = historical[-max_bars:]

            # Cache
            self._cache[ticker] = (historical, now)
            print(f"[HistoricalFetcher] Got {len(historical)} bars for {ticker}")
            return historical

        except requests.exceptions.Timeout:
            print(f"[HistoricalFetcher] Timeout fetching {ticker}")
            return []
        except requests.exceptions.RequestException as e:
            print(f"[HistoricalFetcher] Request error for {ticker}: {e}")
            return []
        except Exception as e:
            print(f"[HistoricalFetcher] Unexpected error for {ticker}: {e}")
            return []

    def fetch_sector_industry_data(self) -> Dict[str, Any]:
        """
        Fetch sector and industry performance snapshots + P/E ratios.
        Used by the neural engine for macro context analysis.
        """
        cache_key = '__sector_industry__'
        now = datetime.now().timestamp()

        if cache_key in self._cache:
            data, cached_at = self._cache[cache_key]
            if now - cached_at < self.cache_ttl:
                print(f"[HistoricalFetcher] Cache hit for sector/industry data")
                return data

        result = {
            'sectorPerformance': [],
            'industryPerformance': [],
            'sectorPE': [],
            'industryPE': [],
        }

        endpoints = {
            'sectorPerformance': 'sector-performance-snapshot',
            'industryPerformance': 'industry-performance-snapshot',
            'sectorPE': 'sector-pe-snapshot',
            'industryPE': 'industry-pe-snapshot',
        }

        for key, endpoint in endpoints.items():
            try:
                url = f"https://financialmodelingprep.com/stable/{endpoint}?apikey={self.api_key}"
                response = requests.get(url, timeout=10)
                if response.ok:
                    data = response.json()
                    if isinstance(data, list):
                        result[key] = data
                        print(f"[HistoricalFetcher] Got {len(data)} items for {key}")
                    else:
                        print(f"[HistoricalFetcher] Unexpected format for {key}: {type(data)}")
            except Exception as e:
                print(f"[HistoricalFetcher] Error fetching {key}: {e}")

        self._cache[cache_key] = (result, now)
        return result

    def fetch_company_profile(self, ticker: str) -> Dict[str, Any]:
        """Fetch company profile to get sector and industry."""
        cache_key = f'__profile_{ticker}__'
        now = datetime.now().timestamp()

        if cache_key in self._cache:
            data, cached_at = self._cache[cache_key]
            if now - cached_at < self.cache_ttl:
                return data

        try:
            url = f"https://financialmodelingprep.com/stable/profile?symbol={ticker}&apikey={self.api_key}"
            response = requests.get(url, timeout=10)
            if response.ok:
                data = response.json()
                profile = data[0] if isinstance(data, list) and len(data) > 0 else {}
                self._cache[cache_key] = (profile, now)
                print(f"[HistoricalFetcher] Got profile for {ticker}: sector={profile.get('sector')}, industry={profile.get('industry')}")
                return profile
        except Exception as e:
            print(f"[HistoricalFetcher] Error fetching profile for {ticker}: {e}")

        return {}


# ═══════════════════════════════════════════════════════════════════════════════
# SPECTRAL CYCLE ANALYZER (FFT ENGINE)
# ═══════════════════════════════════════════════════════════════════════════════

class SpectralCycleAnalyzer:
    """
    FFT-based market cycle detection and phase analysis.

    Pipeline:
    1. Extract close prices from OHLCV data
    2. Detrend (remove linear trend to isolate cyclical component)
    3. Apply Hann window to reduce spectral leakage
    4. Compute FFT → power spectrum
    5. Identify dominant cycles (10-200 day periods, top by amplitude)
    6. Reconstruct clean signal using only dominant frequencies
    7. Detect current phase (trough/rising/peak/falling)
    8. Calculate confirmation indicators (ATR, momentum, RSI)
    9. Score 0-100 based on cycle position, strength, and confirmation
    """

    def __init__(self, window_size: int = 512):
        self.window_size = window_size
        self.min_window = 256
        self.min_cycle_days = 10
        self.max_cycle_days = 200
        self.top_k_cycles = 5  # Number of dominant cycles to keep

    def analyze(self, historical_data: List[Dict]) -> SpectralCycleResult:
        """Main analysis pipeline"""
        try:
            return self._run_analysis(historical_data)
        except Exception as e:
            traceback.print_exc()
            print(f"[SpectralAnalyzer] Error: {e}")
            return self._neutral_result(f"Analysis error: {str(e)[:80]}")

    def _run_analysis(self, historical_data: List[Dict]) -> SpectralCycleResult:
        # ── Step 1: Extract prices ──
        closes = np.array([float(h['close']) for h in historical_data], dtype=np.float64)
        highs = np.array([float(h.get('high', h['close'])) for h in historical_data], dtype=np.float64)
        lows = np.array([float(h.get('low', h['close'])) for h in historical_data], dtype=np.float64)

        n = len(closes)
        if n < self.min_window:
            return self._neutral_result(f"Insufficient data: {n} bars (need {self.min_window}+)")

        # Use appropriate window
        if n >= self.window_size:
            window_n = self.window_size
        else:
            window_n = self.min_window

        # Take most recent window
        prices = closes[-window_n:]
        highs_w = highs[-window_n:]
        lows_w = lows[-window_n:]

        # ── Step 2: Detrend ──
        detrended = scipy_signal.detrend(prices, type='linear')

        # ── Step 3: Apply Hann window to reduce spectral leakage ──
        hann = np.hanning(len(detrended))
        windowed = detrended * hann

        # ── Step 4: FFT ──
        fft_result = np.fft.rfft(windowed)
        freqs = np.fft.rfftfreq(len(windowed), d=1.0)  # 1 sample = 1 trading day
        amplitudes = np.abs(fft_result)
        phases = np.angle(fft_result)

        # Skip DC component (index 0)
        freqs = freqs[1:]
        amplitudes = amplitudes[1:]
        phases = phases[1:]

        # Convert to periods
        with np.errstate(divide='ignore'):
            periods = np.where(freqs > 0, 1.0 / freqs, 0)

        # ── Step 5: Identify dominant cycles ──
        # Filter to valid range
        valid_mask = (periods >= self.min_cycle_days) & (periods <= self.max_cycle_days)
        valid_periods = periods[valid_mask]
        valid_amplitudes = amplitudes[valid_mask]
        valid_phases = phases[valid_mask]

        if len(valid_amplitudes) == 0:
            return self._neutral_result("No cycles in 10-200 day range")

        total_power = np.sum(valid_amplitudes ** 2)

        # Find peaks in amplitude spectrum
        if len(valid_amplitudes) >= 5:
            peak_indices = scipy_signal.argrelextrema(valid_amplitudes, np.greater, order=3)[0]
        else:
            peak_indices = np.arange(len(valid_amplitudes))

        if len(peak_indices) == 0:
            # Fallback: top amplitudes directly
            top_n = min(self.top_k_cycles, len(valid_amplitudes))
            peak_indices = np.argsort(valid_amplitudes)[-top_n:]

        # Sort peaks by amplitude (descending)
        peak_indices = sorted(peak_indices, key=lambda i: valid_amplitudes[i], reverse=True)
        peak_indices = peak_indices[:self.top_k_cycles]

        dominant_cycles = []
        for idx in peak_indices:
            power_pct = (valid_amplitudes[idx] ** 2 / total_power * 100) if total_power > 0 else 0
            phase_deg = np.degrees(valid_phases[idx]) % 360
            dominant_cycles.append(CycleInfo(
                period_days=round(valid_periods[idx], 1),
                amplitude=float(valid_amplitudes[idx]),
                phase_degrees=round(phase_deg, 1),
                contribution_pct=round(power_pct, 1)
            ))

        # ── Step 6: Reconstruct signal ──
        fft_filtered = np.zeros_like(np.fft.rfft(windowed))
        full_freqs = np.fft.rfftfreq(len(windowed), d=1.0)
        full_amplitudes = np.abs(np.fft.rfft(windowed))

        for cycle in dominant_cycles:
            target_freq = 1.0 / cycle.period_days
            idx = np.argmin(np.abs(full_freqs - target_freq))
            fft_filtered[idx] = np.fft.rfft(windowed)[idx]

        reconstructed = np.fft.irfft(fft_filtered, n=len(windowed))

        # ── Step 7: Detect phase ──
        current_phase, phase_position = self._detect_phase(reconstructed)

        # ── Step 8: Cycle strength ──
        dominant_power = sum(c.amplitude ** 2 for c in dominant_cycles)
        all_power = np.sum(amplitudes ** 2)
        cycle_strength = min(1.0, (dominant_power / all_power * 2)) if all_power > 0 else 0.0

        # Determine trading regime
        if cycle_strength > 0.5:
            trading_regime = 'cycling'
        elif cycle_strength > 0.25:
            trading_regime = 'trending'
        else:
            trading_regime = 'noisy'

        # ── Step 9: Confirmation indicators ──
        # ATR (using full price data)
        atr = self._calculate_atr(highs_w, lows_w, closes[-window_n:])
        avg_price = np.mean(prices[-20:])
        atr_normalized = (atr / avg_price * 100) if avg_price > 0 else 0

        # Momentum: SMA5 vs SMA20
        sma5 = np.mean(prices[-5:])
        sma20 = np.mean(prices[-20:])
        momentum_confirmation = sma5 > sma20

        # RSI of detrended signal (14-period)
        rsi_value = self._calculate_rsi(detrended, period=14)

        # Reconstructed vs price trend
        recon_trend = reconstructed[-1] - reconstructed[-20] if len(reconstructed) >= 20 else 0
        price_trend = detrended[-1] - detrended[-20] if len(detrended) >= 20 else 0
        recon_vs_price = 1.0  # neutral default
        if abs(price_trend) > 0.01:
            recon_vs_price = recon_trend / price_trend if abs(price_trend) > 0 else 1.0

        # ── Step 10: Score ──
        score = self._calculate_score(
            current_phase, phase_position, cycle_strength,
            momentum_confirmation, atr_normalized, rsi_value, trading_regime
        )

        # ── Summary description ──
        top_cycle = dominant_cycles[0] if dominant_cycles else None
        desc = self._generate_description(
            current_phase, cycle_strength, momentum_confirmation,
            atr_normalized, top_cycle, trading_regime, rsi_value
        )

        return SpectralCycleResult(
            dominant_cycles=dominant_cycles,
            current_phase=current_phase,
            phase_position=round(phase_position, 3),
            cycle_strength=round(cycle_strength, 3),
            momentum_confirmation=momentum_confirmation,
            atr_normalized=round(atr_normalized, 2),
            rsi_value=round(rsi_value, 1),
            reconstructed_vs_price=round(recon_vs_price, 3),
            spectral_score=round(score, 1),
            bars_analyzed=window_n,
            signal_description=desc,
            trading_regime=trading_regime
        )

    # ───────────────────────────────────────────────────────────────────────
    # PHASE DETECTION
    # ───────────────────────────────────────────────────────────────────────

    def _detect_phase(self, reconstructed: np.ndarray) -> Tuple[str, float]:
        """Detect current cycle phase from reconstructed signal"""
        if len(reconstructed) < 30:
            return 'unknown', 0.5

        # Look at recent portion
        recent = reconstructed[-60:] if len(reconstructed) >= 60 else reconstructed

        # Current derivative (slope)
        slope_short = reconstructed[-1] - reconstructed[-5] if len(reconstructed) >= 5 else 0
        slope_medium = reconstructed[-1] - reconstructed[-15] if len(reconstructed) >= 15 else 0

        # Normalize by amplitude
        amp = np.max(np.abs(recent)) if np.max(np.abs(recent)) > 0 else 1
        norm_slope_short = slope_short / amp
        norm_slope_medium = slope_medium / amp

        # Current position relative to recent range
        recent_min = np.min(recent)
        recent_max = np.max(recent)
        recent_range = recent_max - recent_min

        if recent_range < 1e-10:
            return 'unknown', 0.5

        position = (reconstructed[-1] - recent_min) / recent_range  # 0=min, 1=max

        # Phase classification
        if position < 0.2 and norm_slope_short > 0:
            return 'trough', position
        elif position < 0.2 and norm_slope_short <= 0:
            return 'falling', position
        elif position > 0.8 and norm_slope_short < 0:
            return 'peak', position
        elif position > 0.8 and norm_slope_short >= 0:
            return 'rising', position
        elif norm_slope_short > 0.05:
            return 'rising', position
        elif norm_slope_short < -0.05:
            return 'falling', position
        else:
            # Near zero slope — check medium term
            if norm_slope_medium > 0:
                return 'rising', position
            elif norm_slope_medium < 0:
                return 'falling', position
            return 'unknown', position

    # ───────────────────────────────────────────────────────────────────────
    # TECHNICAL INDICATORS
    # ───────────────────────────────────────────────────────────────────────

    def _calculate_atr(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        """Average True Range"""
        if len(closes) < period + 1:
            return 0.0

        n = len(closes)
        tr = np.zeros(n - 1)
        for i in range(1, n):
            hl = highs[i] - lows[i]
            hc = abs(highs[i] - closes[i - 1])
            lc = abs(lows[i] - closes[i - 1])
            tr[i - 1] = max(hl, hc, lc)

        # Simple moving average of TR
        atr = np.mean(tr[-period:])
        return float(atr)

    def _calculate_rsi(self, data: np.ndarray, period: int = 14) -> float:
        """Relative Strength Index"""
        if len(data) < period + 1:
            return 50.0

        deltas = np.diff(data)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)

        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])

        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return float(rsi)

    # ───────────────────────────────────────────────────────────────────────
    # SCORING
    # ───────────────────────────────────────────────────────────────────────

    def _calculate_score(
        self, phase: str, phase_pos: float, strength: float,
        momentum: bool, atr_norm: float, rsi: float, regime: str
    ) -> float:
        """Calculate composite score 0-100"""
        score = 50.0  # Neutral base

        # ── Phase contribution (strongest factor) ──
        if phase == 'trough':
            score += 25 * strength  # Max +25 at strong trough
        elif phase == 'rising':
            score += 15 * strength
        elif phase == 'peak':
            score -= 20 * strength
        elif phase == 'falling':
            score -= 12 * strength

        # ── Momentum confirmation ──
        if momentum and phase in ('trough', 'rising'):
            score += 12  # Confirmed uptrend
        elif not momentum and phase in ('peak', 'falling'):
            score -= 8  # Confirmed downtrend
        elif momentum and phase in ('peak', 'falling'):
            score += 3  # Divergence — slight positive
        elif not momentum and phase in ('trough', 'rising'):
            score -= 5  # Divergence — waiting for confirmation

        # ── RSI contribution ──
        if rsi < 30:
            score += 8  # Oversold
        elif rsi > 70:
            score -= 8  # Overbought

        # ── Volatility filter ──
        if atr_norm > 4.0:
            score -= 12  # Very high volatility — reduce conviction
        elif atr_norm > 3.0:
            score -= 6
        elif atr_norm < 1.0:
            score += 3  # Low volatility — stable cycles

        # ── Regime adjustment ──
        if regime == 'noisy':
            # Pull toward neutral — low confidence
            score = 50 + (score - 50) * 0.5

        return max(0, min(100, score))

    # ───────────────────────────────────────────────────────────────────────
    # DESCRIPTION GENERATOR
    # ───────────────────────────────────────────────────────────────────────

    def _generate_description(
        self, phase: str, strength: float, momentum: bool,
        atr_norm: float, top_cycle: Optional[CycleInfo], regime: str, rsi: float
    ) -> str:
        """Generate human-readable analysis summary"""
        parts = []

        # Regime
        if regime == 'cycling':
            parts.append(f"Strong cyclical pattern detected (strength: {strength:.0%})")
        elif regime == 'trending':
            parts.append(f"Moderate cyclical pattern with trending component (strength: {strength:.0%})")
        else:
            parts.append(f"Weak/noisy cyclical pattern (strength: {strength:.0%})")

        # Dominant cycle
        if top_cycle:
            parts.append(
                f"Dominant cycle: {top_cycle.period_days:.0f} days "
                f"({top_cycle.contribution_pct:.0f}% of spectral power)"
            )

        # Phase
        phase_labels = {
            'trough': 'at cycle TROUGH (potential entry)',
            'rising': 'in RISING phase',
            'peak': 'at cycle PEAK (potential exit)',
            'falling': 'in FALLING phase',
            'unknown': 'in unclear phase'
        }
        parts.append(f"Currently {phase_labels.get(phase, 'in unclear phase')}")

        # Momentum
        if momentum:
            parts.append("Short-term momentum is POSITIVE (SMA5 > SMA20)")
        else:
            parts.append("Short-term momentum is NEGATIVE (SMA5 < SMA20)")

        # RSI
        if rsi < 30:
            parts.append(f"RSI oversold ({rsi:.0f})")
        elif rsi > 70:
            parts.append(f"RSI overbought ({rsi:.0f})")

        # Volatility
        if atr_norm > 3.0:
            parts.append(f"HIGH volatility (ATR: {atr_norm:.1f}% of price)")
        elif atr_norm < 1.5:
            parts.append(f"Low volatility (ATR: {atr_norm:.1f}%)")

        return ". ".join(parts)

    # ───────────────────────────────────────────────────────────────────────
    # NEUTRAL FALLBACK
    # ───────────────────────────────────────────────────────────────────────

    def _neutral_result(self, reason: str) -> SpectralCycleResult:
        """Return neutral result when analysis cannot be performed"""
        return SpectralCycleResult(
            dominant_cycles=[],
            current_phase='unknown',
            phase_position=0.5,
            cycle_strength=0.0,
            momentum_confirmation=False,
            atr_normalized=0.0,
            rsi_value=50.0,
            reconstructed_vs_price=1.0,
            spectral_score=50.0,
            bars_analyzed=0,
            signal_description=reason,
            trading_regime='unknown'
        )

    # ───────────────────────────────────────────────────────────────────────
    # ROLLING WINDOW FFT RECONSTRUCTION
    # ───────────────────────────────────────────────────────────────────────

    def compute_rolling_reconstruction(
        self,
        historical_data: List[Dict],
        window: int = 256,
        num_freq: int = 8,
        output_bars: int = 60,
    ) -> Dict[str, Any]:
        """
        Rolling-window FFT reconstruction.

        For each bar t (t = window ... n), we:
          1. Extract the preceding `window` bars: prices[t-window : t]
          2. Detrend (linear) to isolate the cyclical component
          3. Apply Hann window (reduces spectral leakage)
          4. rfft → complex spectrum
          5. Low-pass filter: keep DC + first `num_freq` frequency bins
          6. irfft → reconstructed detrended signal (length=window)
          7. Add back the linear trend for the last sample
          8. reconstructed_t = recon[-1] + trend_at_last

        The reconstructed curve is the "smooth FFT cycle envelope" for the price.

        Returns:
        - rollingCurve: [{date, price, reconstructed, aboveRecon}] last output_bars
        - complexComponents: [{freq_index, period_days, magnitude, phase_rad,
                               phase_deg, real, imag, contribution_pct}] for the
                              most recent window's top num_freq frequencies
        - currentSignal: 'bullish' | 'bearish' | 'neutral' based on last 5 bars
        - windowSize, numFreqKept
        """
        try:
            closes = np.array([float(h['close']) for h in historical_data], dtype=np.float64)
            dates  = [h.get('date', '') for h in historical_data]
            n = len(closes)

            if n < window + 5:
                return {'error': f'Need at least {window + 5} bars, got {n}'}

            # ── Rolling reconstruction ──
            # Only compute what we need: last output_bars + a small buffer
            start_t = max(window, n - output_bars - 10)

            reconstructed_values: List[Optional[float]] = []

            for t in range(start_t, n):
                w_prices = closes[t - window : t]

                # Linear detrend
                x = np.arange(window, dtype=np.float64)
                coeffs = np.polyfit(x, w_prices, 1)   # [slope, intercept]
                trend  = np.polyval(coeffs, x)
                detrended = w_prices - trend

                # Hann window
                hann     = np.hanning(window)
                windowed = detrended * hann

                # FFT
                fft_c = np.fft.rfft(windowed)

                # Low-pass: zero out everything above num_freq (skip DC=0 too)
                fft_filtered = np.zeros_like(fft_c)
                fft_filtered[1 : num_freq + 1] = fft_c[1 : num_freq + 1]

                # Reconstruct detrended signal
                recon = np.fft.irfft(fft_filtered, n=window)

                # Add trend back at last position
                trend_at_last = float(np.polyval(coeffs, window - 1))
                reconstructed_values.append(recon[-1] + trend_at_last)

            # Build output list aligned with the price array
            result_bars = []
            for i, (rv) in enumerate(reconstructed_values):
                t_idx = start_t + i
                if t_idx >= n:
                    break
                if rv is not None:
                    p = float(closes[t_idx])
                    result_bars.append({
                        'date':         dates[t_idx] if t_idx < len(dates) else '',
                        'price':        round(p, 2),
                        'reconstructed': round(rv, 2),
                        'aboveRecon':   p > rv,
                    })

            # Keep only last output_bars
            result_bars = result_bars[-output_bars:]

            # ── Complex components from the most recent full window ──
            w_prices = closes[-window:]
            x        = np.arange(window, dtype=np.float64)
            coeffs   = np.polyfit(x, w_prices, 1)
            trend    = np.polyval(coeffs, x)
            detrended = w_prices - trend

            hann     = np.hanning(window)
            windowed = detrended * hann

            fft_c     = np.fft.rfft(windowed)
            freqs     = np.fft.rfftfreq(window, d=1.0)
            magnitudes = np.abs(fft_c)
            total_power = float(np.sum(magnitudes[1:] ** 2))

            complex_components = []
            for i in range(1, num_freq + 1):
                freq  = float(freqs[i])
                period = round(1.0 / freq, 1) if freq > 0 else 0.0
                c     = fft_c[i]
                mag   = float(np.abs(c))
                pwr   = mag ** 2
                contribution_pct = round(pwr / total_power * 100, 2) if total_power > 0 else 0.0
                complex_components.append({
                    'freq_index':       i,
                    'period_days':      period,
                    'magnitude':        round(mag, 4),
                    'phase_rad':        round(float(np.angle(c)), 4),
                    'phase_deg':        round(float(np.degrees(np.angle(c))) % 360, 1),
                    'real':             round(float(c.real), 4),
                    'imag':             round(float(c.imag), 4),
                    'contribution_pct': contribution_pct,
                })

            # ── Current signal: price vs reconstructed in last 5 bars ──
            current_signal = 'neutral'
            if len(result_bars) >= 5:
                recent = result_bars[-5:]
                above  = sum(1 for r in recent if r['aboveRecon'])
                if above >= 4:
                    current_signal = 'bullish'
                elif above <= 1:
                    current_signal = 'bearish'

            return {
                'rollingCurve':      result_bars,
                'complexComponents': complex_components,
                'currentSignal':     current_signal,
                'windowSize':        window,
                'numFreqKept':       num_freq,
            }

        except Exception as e:
            traceback.print_exc()
            return {'error': str(e)}
