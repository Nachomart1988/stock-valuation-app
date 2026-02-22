from __future__ import annotations

# backend/spectral_cycle_analyzer.py
# FFT Spectral Cycle Analysis Engine
# Detects dominant market cycles using Fast Fourier Transform
# Generates trading signals based on cycle phase, momentum, and volatility

import logging
import time
import numpy as np
from scipy import signal as scipy_signal
from scipy.signal import hilbert as scipy_hilbert
from typing import Dict, List, Tuple, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import requests
import traceback

logger = logging.getLogger(__name__)


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
    is_significant: bool = True  # Whether peak passed bootstrap significance test


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
# TECHNICAL INDICATORS (separated concern)
# ═══════════════════════════════════════════════════════════════════════════════

class TechnicalIndicators:
    """
    Standalone helper for computing technical indicators (ATR, RSI, momentum).
    Separated from the FFT analysis logic for clarity and reusability.
    """

    @staticmethod
    def calculate_atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        """Average True Range over the last `period` bars."""
        if len(closes) < period + 1:
            return 0.0

        n = len(closes)
        tr = np.empty(n - 1)
        for i in range(1, n):
            hl = highs[i] - lows[i]
            hc = abs(highs[i] - closes[i - 1])
            lc = abs(lows[i] - closes[i - 1])
            tr[i - 1] = max(hl, hc, lc)

        atr = np.mean(tr[-period:])
        return float(atr)

    @staticmethod
    def calculate_rsi(data: np.ndarray, period: int = 14) -> float:
        """Relative Strength Index with epsilon edge-case handling."""
        if len(data) < period + 1:
            return 50.0

        deltas = np.diff(data)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)

        avg_gain = np.mean(gains[-period:])
        avg_loss = np.mean(losses[-period:])

        if avg_loss < 1e-12:
            return 100.0 if avg_gain > 1e-12 else 50.0
        if avg_gain < 1e-12:
            return 0.0

        rs = avg_gain / avg_loss
        rsi = 100 - (100 / (1 + rs))
        return float(rsi)

    @staticmethod
    def calculate_momentum(prices: np.ndarray, short_period: int = 5, long_period: int = 20) -> bool:
        """Return True if short-term SMA > long-term SMA (bullish momentum)."""
        if len(prices) < long_period:
            return False
        sma_short = np.mean(prices[-short_period:])
        sma_long = np.mean(prices[-long_period:])
        return bool(sma_short > sma_long)

    @staticmethod
    def calculate_atr_normalized(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        """ATR expressed as a percentage of recent average price."""
        atr = TechnicalIndicators.calculate_atr(highs, lows, closes, period)
        avg_price = np.mean(closes[-20:]) if len(closes) >= 20 else np.mean(closes)
        return (atr / avg_price * 100) if avg_price > 0 else 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# HISTORICAL DATA FETCHER (FMP API)
# ═══════════════════════════════════════════════════════════════════════════════

class HistoricalDataFetcher:
    """Fetch and cache historical price data from Financial Modeling Prep API"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._cache: Dict[str, Tuple[List[Dict], float]] = {}
        self.cache_ttl = 300  # 5 minutes
        self._session = requests.Session()
        self._max_retries = 3
        self._retry_delay = 1.0  # seconds

    def invalidate_cache(self, ticker: str) -> None:
        """Remove cached data for a specific ticker."""
        keys_to_remove = [k for k in self._cache if k == ticker or k.endswith(f'_{ticker}__')]
        for key in keys_to_remove:
            del self._cache[key]
            logger.info("Cache invalidated for key: %s", key)

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
                logger.info("Cache hit for %s (%d bars)", ticker, len(data))
                return data[-max_bars:] if len(data) > max_bars else data

        url = (
            f"https://financialmodelingprep.com/stable/historical-price-eod/full"
            f"?symbol={ticker}&apikey={self.api_key}"
        )

        # Retry loop
        for attempt in range(1, self._max_retries + 1):
            try:
                logger.info("Fetching historical data for %s (attempt %d/%d)...", ticker, attempt, self._max_retries)
                response = self._session.get(url, timeout=15)
                response.raise_for_status()

                raw = response.json()
                historical = raw.get('historical', [])

                if not historical:
                    logger.warning("No historical data returned for %s", ticker)
                    return []

                # Validate required keys in first record
                sample = historical[0]
                for required_key in ('close', 'high', 'low'):
                    if required_key not in sample:
                        logger.error("Historical data for %s missing required key '%s'", ticker, required_key)
                        return []

                # FMP returns newest first — reverse to oldest first
                historical = list(reversed(historical))

                # Trim to max_bars
                if len(historical) > max_bars:
                    historical = historical[-max_bars:]

                # Cache
                self._cache[ticker] = (historical, now)
                logger.info("Got %d bars for %s", len(historical), ticker)
                return historical

            except requests.exceptions.Timeout:
                logger.warning("Timeout fetching %s (attempt %d/%d)", ticker, attempt, self._max_retries)
            except requests.exceptions.RequestException as e:
                logger.warning("Request error for %s (attempt %d/%d): %s", ticker, attempt, self._max_retries, e)
            except Exception as e:
                logger.error("Unexpected error for %s (attempt %d/%d): %s", ticker, attempt, self._max_retries, e)

            if attempt < self._max_retries:
                time.sleep(self._retry_delay)

        logger.error("All %d fetch attempts failed for %s", self._max_retries, ticker)
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
                logger.info("Cache hit for sector/industry data")
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
                response = self._session.get(url, timeout=10)
                if response.ok:
                    data = response.json()
                    if isinstance(data, list):
                        result[key] = data
                        logger.info("Got %d items for %s", len(data), key)
                    else:
                        logger.warning("Unexpected format for %s: %s", key, type(data))
            except Exception as e:
                logger.error("Error fetching %s: %s", key, e)

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
            response = self._session.get(url, timeout=10)
            if response.ok:
                data = response.json()
                profile = data[0] if isinstance(data, list) and len(data) > 0 else {}
                self._cache[cache_key] = (profile, now)
                logger.info("Got profile for %s: sector=%s, industry=%s", ticker, profile.get('sector'), profile.get('industry'))
                return profile
        except Exception as e:
            logger.error("Error fetching profile for %s: %s", ticker, e)

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
    4. Compute FFT -> power spectrum
    5. Identify dominant cycles (10-200 day periods, top by amplitude)
    5b. Bootstrap significance test on dominant peaks
    6. Reconstruct clean signal using only dominant frequencies
    7. Detect current phase via Hilbert transform (instantaneous phase)
    8. Calculate confirmation indicators (ATR, momentum, RSI) via TechnicalIndicators
    9. Score 0-100 based on cycle position, strength, and confirmation (configurable weights)
    """

    def __init__(
        self,
        window_size: int = 512,
        # Configurable scoring weights
        phase_weight: float = 1.0,
        momentum_weight: float = 1.0,
        rsi_weight: float = 1.0,
        volatility_weight: float = 1.0,
        # Bootstrap significance parameters
        bootstrap_iterations: int = 200,
        bootstrap_alpha: float = 0.05,
        # Adaptive frequency threshold for rolling reconstruction
        adaptive_power_threshold: float = 0.80,
    ):
        # Snap to nearest power-of-2 for faster FFT
        self.window_size = 2 ** int(np.log2(window_size)) if window_size > 0 else 512
        self.min_window = 256
        self.min_cycle_days = 10
        self.max_cycle_days = 200
        self.top_k_cycles = 5  # Number of dominant cycles to keep

        # Configurable scoring weights (improvement #3)
        self.phase_weight = phase_weight
        self.momentum_weight = momentum_weight
        self.rsi_weight = rsi_weight
        self.volatility_weight = volatility_weight

        # Bootstrap significance parameters (improvement #6)
        self.bootstrap_iterations = bootstrap_iterations
        self.bootstrap_alpha = bootstrap_alpha

        # Adaptive frequency selection threshold (improvement #2)
        self.adaptive_power_threshold = adaptive_power_threshold

        # Technical indicators helper (improvement #5)
        self.indicators = TechnicalIndicators()

    def analyze(self, historical_data: List[Dict]) -> SpectralCycleResult:
        """Main analysis pipeline"""
        try:
            return self._run_analysis(historical_data)
        except Exception as e:
            logger.error("SpectralAnalyzer error: %s", e, exc_info=True)
            return self._neutral_result(f"Analysis error: {str(e)[:80]}")

    def _run_analysis(self, historical_data: List[Dict]) -> SpectralCycleResult:
        # ── Input validation ──
        if not historical_data:
            return self._neutral_result("No historical data provided")

        sample = historical_data[0]
        if 'close' not in sample:
            return self._neutral_result("Historical data missing required 'close' key")

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

        # Find peaks in amplitude spectrum using scipy.signal.find_peaks with prominence
        if len(valid_amplitudes) >= 5:
            # Use find_peaks with prominence for better peak detection
            min_prominence = np.std(valid_amplitudes) * 0.3
            peak_indices, peak_props = scipy_signal.find_peaks(
                valid_amplitudes,
                prominence=min_prominence,
                distance=3,
            )
        else:
            peak_indices = np.arange(len(valid_amplitudes))

        if len(peak_indices) == 0:
            # Fallback: top amplitudes directly
            top_n = min(self.top_k_cycles, len(valid_amplitudes))
            peak_indices = np.argsort(valid_amplitudes)[-top_n:]

        # Sort peaks by amplitude (descending)
        peak_indices = sorted(peak_indices, key=lambda i: valid_amplitudes[i], reverse=True)
        peak_indices = peak_indices[:self.top_k_cycles]

        # ── Step 5b: Bootstrap significance test ──
        significance_map = self._bootstrap_significance_test(
            windowed, freqs, valid_mask, peak_indices, valid_amplitudes
        )

        dominant_cycles = []
        for idx in peak_indices:
            power_pct = (valid_amplitudes[idx] ** 2 / total_power * 100) if total_power > 0 else 0
            phase_deg = np.degrees(valid_phases[idx]) % 360
            dominant_cycles.append(CycleInfo(
                period_days=round(valid_periods[idx], 1),
                amplitude=float(valid_amplitudes[idx]),
                phase_degrees=round(phase_deg, 1),
                contribution_pct=round(power_pct, 1),
                is_significant=significance_map.get(idx, False),
            ))

        # ── Step 6: Reconstruct signal ──
        fft_filtered = np.zeros_like(np.fft.rfft(windowed))
        full_freqs = np.fft.rfftfreq(len(windowed), d=1.0)

        for cycle in dominant_cycles:
            target_freq = 1.0 / cycle.period_days
            idx = np.argmin(np.abs(full_freqs - target_freq))
            fft_filtered[idx] = np.fft.rfft(windowed)[idx]

        reconstructed = np.fft.irfft(fft_filtered, n=len(windowed))

        # ── Step 7: Detect phase via Hilbert transform ──
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

        # ── Step 9: Confirmation indicators (via TechnicalIndicators) ──
        atr_normalized = self.indicators.calculate_atr_normalized(highs_w, lows_w, closes[-window_n:])
        momentum_confirmation = self.indicators.calculate_momentum(prices)
        rsi_value = self.indicators.calculate_rsi(detrended, period=14)

        # Reconstructed vs price trend
        recon_trend = reconstructed[-1] - reconstructed[-20] if len(reconstructed) >= 20 else 0
        price_trend = detrended[-1] - detrended[-20] if len(detrended) >= 20 else 0
        recon_vs_price = 1.0  # neutral default
        if abs(price_trend) > 0.01:
            recon_vs_price = recon_trend / price_trend if abs(price_trend) > 0 else 1.0

        # ── Step 10: Score (with configurable weights) ──
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
    # BOOTSTRAP SIGNIFICANCE TEST (improvement #6)
    # ───────────────────────────────────────────────────────────────────────

    def _bootstrap_significance_test(
        self,
        windowed: np.ndarray,
        freqs_no_dc: np.ndarray,
        valid_mask: np.ndarray,
        peak_indices: List[int],
        valid_amplitudes: np.ndarray,
    ) -> Dict[int, bool]:
        """
        Bootstrap-based significance test for dominant FFT peaks.

        Procedure:
        1. Shuffle the time-domain signal N times (destroying temporal structure).
        2. Compute FFT on each shuffled version.
        3. For each detected peak, compare the real amplitude to the distribution
           of amplitudes at the same frequency bin from shuffled data.
        4. If the real amplitude exceeds the (1 - alpha) quantile of the null
           distribution, the peak is considered statistically significant
           (i.e., not attributable to noise).

        Returns a dict mapping peak_index -> bool (True = significant).
        """
        if len(peak_indices) == 0:
            return {}

        n_iters = self.bootstrap_iterations
        rng = np.random.default_rng(seed=42)

        # We need to map valid_mask indices back to full FFT indices.
        # valid_mask was applied to freqs[1:] (DC-skipped), so valid_mask
        # indices correspond to positions within the DC-skipped amplitude array.
        # We need the full-FFT indices (offset by +1 for DC).
        valid_indices_in_full = np.where(valid_mask)[0]  # indices within DC-skipped array

        # Collect null-distribution amplitudes for each peak
        null_amplitudes: Dict[int, List[float]] = {idx: [] for idx in peak_indices}

        for _ in range(n_iters):
            shuffled = rng.permutation(windowed)
            fft_shuffled = np.fft.rfft(shuffled)
            # Amplitudes without DC
            shuf_amps = np.abs(fft_shuffled[1:])
            shuf_valid = shuf_amps[valid_mask]

            for idx in peak_indices:
                if idx < len(shuf_valid):
                    null_amplitudes[idx].append(float(shuf_valid[idx]))

        # Determine significance for each peak
        significance: Dict[int, bool] = {}
        quantile_threshold = 1.0 - self.bootstrap_alpha

        for idx in peak_indices:
            if not null_amplitudes[idx]:
                significance[idx] = False
                continue
            null_dist = np.array(null_amplitudes[idx])
            threshold = np.quantile(null_dist, quantile_threshold)
            real_amp = float(valid_amplitudes[idx])
            significance[idx] = bool(real_amp > threshold)

        n_sig = sum(1 for v in significance.values() if v)
        logger.info(
            "Bootstrap significance: %d/%d peaks significant (alpha=%.2f, iters=%d)",
            n_sig, len(peak_indices), self.bootstrap_alpha, n_iters
        )
        return significance

    # ───────────────────────────────────────────────────────────────────────
    # PHASE DETECTION via Hilbert Transform (improvement #1)
    # ───────────────────────────────────────────────────────────────────────

    def _detect_phase(self, reconstructed: np.ndarray) -> Tuple[str, float]:
        """
        Detect current cycle phase from reconstructed signal using the
        Hilbert transform for instantaneous phase estimation.

        The Hilbert transform produces an analytic signal whose angle gives
        the instantaneous phase at each time step. This is more precise than
        simple slope-based heuristics because it directly measures where we
        are in the oscillation cycle (0 to 2*pi).

        Phase mapping (radians -> label):
          - [-pi, -pi/2)  : trough    (position 0.0 - 0.25)
          - [-pi/2, 0)    : rising    (position 0.25 - 0.5)
          - [0, pi/2)     : peak      (position 0.5 - 0.75)
          - [pi/2, pi)    : falling   (position 0.75 - 1.0)

        Falls back to slope-based detection if the Hilbert transform
        produces degenerate results (e.g., near-zero signal).
        """
        if len(reconstructed) < 30:
            return 'unknown', 0.5

        try:
            # Compute the analytic signal via the Hilbert transform
            analytic_signal = scipy_hilbert(reconstructed)

            # Instantaneous phase at the last sample
            inst_phase = np.angle(analytic_signal[-1])  # range [-pi, pi]

            # Check for degenerate case (near-zero amplitude)
            inst_amplitude = np.abs(analytic_signal[-1])
            signal_amplitude = np.max(np.abs(reconstructed))
            if signal_amplitude < 1e-10 or inst_amplitude < signal_amplitude * 0.01:
                return self._detect_phase_fallback(reconstructed)

            # Map phase from [-pi, pi] to [0, 1] position
            # -pi = trough (0.0), -pi/2 = rising midpoint (0.25),
            # 0 = peak (0.5), pi/2 = falling midpoint (0.75), pi = trough again (1.0)
            # Normalize: position = (inst_phase + pi) / (2*pi)
            position = float((inst_phase + np.pi) / (2.0 * np.pi))
            position = max(0.0, min(1.0, position))

            # Classify phase based on position
            if position < 0.125 or position >= 0.875:
                phase = 'trough'
            elif 0.125 <= position < 0.375:
                phase = 'rising'
            elif 0.375 <= position < 0.625:
                phase = 'peak'
            else:  # 0.625 <= position < 0.875
                phase = 'falling'

            return phase, position

        except Exception as e:
            logger.warning("Hilbert transform failed, using fallback: %s", e)
            return self._detect_phase_fallback(reconstructed)

    def _detect_phase_fallback(self, reconstructed: np.ndarray) -> Tuple[str, float]:
        """
        Original slope-based phase detection, used as fallback when Hilbert
        transform produces degenerate results.
        """
        if len(reconstructed) < 30:
            return 'unknown', 0.5

        recent = reconstructed[-60:] if len(reconstructed) >= 60 else reconstructed

        slope_short = reconstructed[-1] - reconstructed[-5] if len(reconstructed) >= 5 else 0
        slope_medium = reconstructed[-1] - reconstructed[-15] if len(reconstructed) >= 15 else 0

        amp = np.max(np.abs(recent)) if np.max(np.abs(recent)) > 0 else 1
        norm_slope_short = slope_short / amp
        norm_slope_medium = slope_medium / amp

        recent_min = np.min(recent)
        recent_max = np.max(recent)
        recent_range = recent_max - recent_min

        if recent_range < 1e-10:
            return 'unknown', 0.5

        position = (reconstructed[-1] - recent_min) / recent_range

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
            if norm_slope_medium > 0:
                return 'rising', position
            elif norm_slope_medium < 0:
                return 'falling', position
            return 'unknown', position

    # ───────────────────────────────────────────────────────────────────────
    # SCORING (with configurable weights — improvement #3)
    # ───────────────────────────────────────────────────────────────────────

    def _calculate_score(
        self, phase: str, phase_pos: float, strength: float,
        momentum: bool, atr_norm: float, rsi: float, regime: str
    ) -> float:
        """
        Calculate composite score 0-100.

        Each component is scaled by its corresponding weight parameter
        (phase_weight, momentum_weight, rsi_weight, volatility_weight)
        set during __init__. Defaults are 1.0 (original behavior).
        """
        score = 50.0  # Neutral base

        pw = self.phase_weight
        mw = self.momentum_weight
        rw = self.rsi_weight
        vw = self.volatility_weight

        # ── Phase contribution (strongest factor) ──
        if phase == 'trough':
            score += 25 * strength * pw
        elif phase == 'rising':
            score += 15 * strength * pw
        elif phase == 'peak':
            score -= 20 * strength * pw
        elif phase == 'falling':
            score -= 12 * strength * pw

        # ── Momentum confirmation ──
        if momentum and phase in ('trough', 'rising'):
            score += 12 * mw
        elif not momentum and phase in ('peak', 'falling'):
            score -= 8 * mw
        elif momentum and phase in ('peak', 'falling'):
            score += 3 * mw
        elif not momentum and phase in ('trough', 'rising'):
            score -= 5 * mw

        # ── RSI contribution ──
        if rsi < 30:
            score += 8 * rw
        elif rsi > 70:
            score -= 8 * rw

        # ── Volatility filter ──
        if atr_norm > 4.0:
            score -= 12 * vw
        elif atr_norm > 3.0:
            score -= 6 * vw
        elif atr_norm < 1.0:
            score += 3 * vw

        # ── Regime adjustment ──
        if regime == 'noisy':
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
            sig_label = "" if top_cycle.is_significant else " [not statistically significant]"
            parts.append(
                f"Dominant cycle: {top_cycle.period_days:.0f} days "
                f"({top_cycle.contribution_pct:.0f}% of spectral power){sig_label}"
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
    # ADAPTIVE FREQUENCY SELECTION (improvement #2)
    # ───────────────────────────────────────────────────────────────────────

    def _adaptive_num_freq(self, fft_complex: np.ndarray, target_power_ratio: float = 0.80) -> int:
        """
        Determine how many frequency bins to keep so that they capture at
        least `target_power_ratio` (default 80%) of total spectral power.

        Instead of a fixed num_freq=8, this adapts to the actual spectrum:
        - If the signal is dominated by a few low frequencies, fewer are kept.
        - If power is spread across many frequencies, more are kept.

        Minimum: 2 (DC + 1 harmonic). Maximum: len(fft_complex).
        """
        mags = np.abs(fft_complex)
        total_power = np.sum(mags[1:] ** 2)  # skip DC for power calc

        if total_power < 1e-15:
            return min(8, len(fft_complex))

        cumulative = 0.0
        # Always include DC (index 0), so start counting from index 1
        for i in range(1, len(mags)):
            cumulative += mags[i] ** 2
            if cumulative / total_power >= target_power_ratio:
                # +1 because we include DC at index 0
                return max(2, i + 1)

        return len(fft_complex)

    # ───────────────────────────────────────────────────────────────────────
    # ROLLING WINDOW FFT RECONSTRUCTION
    # ───────────────────────────────────────────────────────────────────────

    def compute_rolling_reconstruction(
        self,
        historical_data: List[Dict],
        window: int = 256,
        num_freq: int = 8,
        output_bars: int = 60,
        threshold_pct: float = 0.002,   # 0.2% anti-whipsaw threshold
        adaptive_freq: bool = True,     # Use adaptive frequency selection
    ) -> Dict[str, Any]:
        """
        Rolling-window FFT low-pass filter reconstruction.

        When adaptive_freq=True (default), the num_freq parameter is treated
        as a fallback maximum. The actual number of frequencies kept per window
        is determined adaptively to capture 80% of cumulative spectral power
        (configurable via self.adaptive_power_threshold).

        Exactly matches the reference spec:
          1. prices[i-window+1 : i+1]  -- window ending at bar i (inclusive)
          2. scipy.signal.detrend(prices, type='linear')  -- remove linear trend
          3. trend = prices - detrended  -- recover trend for last-bar add-back
          4. np.hanning(window) * detrended  -- Hann window (spectral leakage)
          5. scipy.fft.rfft(windowed)  -> fft_complex (complex vector, length=window/2+1)
          6. fft_filtered[:K] = fft_complex[:K]  -- low-pass (adaptive or fixed K)
          7. scipy.fft.irfft(fft_filtered)  -> reconstructed detrended signal
          8. fft_signal[i] = reconstructed[-1] + trend[-1]  -- add trend back

        Position signal:
          position = 1 (long) if Close > fft_signal * (1 + threshold_pct)
          position = 0 (flat) otherwise

        Returns:
          rollingCurve:       [{date, price, reconstructed, aboveRecon, position}]
          complexComponents:  [{freq_index, period_days, magnitude, phase_rad,
                                phase_deg, real, imag, contribution_pct}]
          currentSignal:      'bullish' | 'bearish' | 'neutral'
          cycleStrength:      dominant power / total power (0-1)
          windowSize, numFreqKept, thresholdPct
        """
        from scipy.fft import rfft as scipy_rfft, irfft as scipy_irfft
        from scipy.signal import detrend as scipy_detrend

        try:
            closes = np.array([float(h['close']) for h in historical_data], dtype=np.float64)
            dates  = [h.get('date', '') for h in historical_data]
            n = len(closes)

            if n < window + 5:
                return {'error': f'Need at least {window + 5} bars, got {n}'}

            # ── Rolling reconstruction (compute only last output_bars + buffer) ──
            start_i = max(window - 1, n - output_bars - 15)
            fft_signal_vals: List[Optional[float]] = []
            actual_num_freq = num_freq  # track what was actually used (last window)

            for i in range(start_i, n):
                # Extract window: bars [i-window+1 ... i] (inclusive, length=window)
                prices = closes[i - window + 1 : i + 1]

                # 1. Detrend
                detrended = scipy_detrend(prices, type='linear')

                # 2. Recover trend so we can add it back at the last bar
                trend = prices - detrended
                last_trend = float(trend[-1])

                # 3. Hann window to reduce spectral leakage
                hann     = np.hanning(window)
                windowed = detrended * hann

                # 4. FFT -> complex vector (length = window//2 + 1)
                fft_complex = scipy_rfft(windowed)

                # 5. Determine number of frequencies to keep
                if adaptive_freq:
                    k = self._adaptive_num_freq(fft_complex, self.adaptive_power_threshold)
                    # Cap at the user-specified num_freq as maximum
                    k = min(k, num_freq) if num_freq > 0 else k
                else:
                    k = num_freq

                actual_num_freq = k

                # 6. Low-pass filter: keep first k coefficients (incl. DC=0)
                fft_filtered = np.zeros_like(fft_complex, dtype=complex)
                fft_filtered[:k] = fft_complex[:k]

                # 7. Inverse FFT -> reconstructed detrended signal
                reconstructed_detrended = scipy_irfft(fft_filtered)

                # 8. Add trend back (last bar value)
                fft_signal_vals.append(reconstructed_detrended[-1] + last_trend)

            # ── Build output list ──
            THRESH = threshold_pct
            result_bars = []
            for idx, rv in enumerate(fft_signal_vals):
                t_idx = start_i + idx
                if t_idx >= n or rv is None:
                    continue
                p = float(closes[t_idx])
                position = 1 if p > rv * (1.0 + THRESH) else 0
                result_bars.append({
                    'date':          dates[t_idx] if t_idx < len(dates) else '',
                    'price':         round(p, 2),
                    'reconstructed': round(float(rv), 2),
                    'aboveRecon':    p > rv,
                    'position':      position,
                })

            result_bars = result_bars[-output_bars:]

            # ── Current signal from last 5 bars ──
            current_signal = 'neutral'
            if len(result_bars) >= 5:
                recent = result_bars[-5:]
                above  = sum(1 for r in recent if r['aboveRecon'])
                if above >= 4:
                    current_signal = 'bullish'
                elif above <= 1:
                    current_signal = 'bearish'

            # Also check most recent position signal
            if result_bars:
                last_pos = result_bars[-1]['position']
                if last_pos == 1:
                    current_signal = 'bullish'
                else:
                    current_signal = 'bearish'

            # ── Complex components from the most recent full window ──
            prices_last = closes[-(window):]
            detrended_last = scipy_detrend(prices_last, type='linear')
            hann_last      = np.hanning(window)
            windowed_last  = detrended_last * hann_last

            fft_last  = scipy_rfft(windowed_last)
            freqs     = np.fft.rfftfreq(window, d=1.0)  # frequency bins
            mags      = np.abs(fft_last)

            # Determine actual num_freq for components output
            if adaptive_freq:
                final_num_freq = self._adaptive_num_freq(fft_last, self.adaptive_power_threshold)
                final_num_freq = min(final_num_freq, num_freq) if num_freq > 0 else final_num_freq
            else:
                final_num_freq = num_freq

            # Total power (skip DC for contribution calculation)
            total_power = float(np.sum(mags[1:] ** 2))

            # Power in kept frequencies (1 to final_num_freq-1, skip DC)
            kept_power = float(np.sum(mags[1:final_num_freq] ** 2))
            cycle_strength = round(kept_power / total_power, 4) if total_power > 0 else 0.0

            complex_components = []
            for i in range(final_num_freq):
                freq  = float(freqs[i])
                period = round(1.0 / freq, 1) if freq > 0 else 0.0
                c     = fft_last[i]
                mag   = float(np.abs(c))
                pwr   = mag ** 2
                contrib = round(pwr / total_power * 100, 2) if (total_power > 0 and i > 0) else 0.0
                complex_components.append({
                    'freq_index':       i,
                    'period_days':      period,
                    'magnitude':        round(mag, 4),
                    'phase_rad':        round(float(np.angle(c)), 4),
                    'phase_deg':        round(float(np.degrees(np.angle(c))) % 360, 1),
                    'real':             round(float(c.real), 4),
                    'imag':             round(float(c.imag), 4),
                    'contribution_pct': contrib,
                })

            return {
                'rollingCurve':      result_bars,
                'complexComponents': complex_components,
                'currentSignal':     current_signal,
                'cycleStrength':     cycle_strength,
                'windowSize':        window,
                'numFreqKept':       final_num_freq,
                'thresholdPct':      threshold_pct,
            }

        except Exception as e:
            logger.error("FFT Rolling error: %s", e, exc_info=True)
            return {'error': str(e)}
