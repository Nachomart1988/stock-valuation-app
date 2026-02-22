from __future__ import annotations

# backend/probability_engine.py
# CRR Binomial Tree Probability Engine
# Calculates the probability of a stock reaching a target price
# using Cox-Ross-Rubinstein binomial model with historical & implied volatility
#
# Scientific features:
# - Sensitivity analysis (vol, rate, days perturbation)
# - Bootstrap confidence intervals for probability estimate
# - Greeks approximation (Delta, Gamma) from binomial tree
# - IV skew analysis (OTM put IV - ATM IV)
# - Multiple time horizon projections
# - Expected move (1-sigma)
# - Risk-reward ratio (vs 5th percentile worst case)

import logging
import traceback
from datetime import datetime, timedelta
from math import exp, log, sqrt
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from scipy.special import gammaln
from scipy.stats import norm

logger = logging.getLogger("ProbabilityEngine")

# Try to import yfinance for implied volatility
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
    logger.info("yfinance available — implied volatility enabled")
except ImportError:
    YFINANCE_AVAILABLE = False
    logger.warning("yfinance not available — using historical volatility only")


class BinomialTreeEngine:
    """
    CRR (Cox-Ross-Rubinstein) Binomial Tree for price probability calculation.

    The model builds a recombining binomial tree of stock prices and calculates
    the probability of reaching or exceeding a target price at expiration.

    Key formulas:
    - ΔT = T / N  (time per step)
    - u = exp(σ * √ΔT)  (up factor)
    - d = 1/u  (down factor)
    - p = (exp((r - q) * ΔT) - d) / (u - d)  (risk-neutral up probability)
    - S(j) = S₀ * u^j * d^(N-j)  (terminal node price after j ups)
    - P(target) = Σ C(N,j) * p^j * (1-p)^(N-j) for all j where S(j) ≥ target

    Probability calculation uses scipy.special.gammaln for log-factorial computation,
    which is numerically stable for any number of steps. All terminal nodes are computed
    simultaneously using numpy vectorized operations, and probabilities are normalized
    to guarantee sum=1.0 before reporting.
    """

    def __init__(self):
        self.max_steps = 2000  # Maximum tree depth (increased for convergence)
        self.convergence_tol = 0.005  # 0.5% tolerance for CRR vs BS
        self.data_fetcher = None  # Injected from spectral_cycle_analyzer
        self._hist_vol_cache: Dict[str, float | None] = {}
        self._hist_drift_cache: Dict[str, float] = {}
        self._ewma_vol_cache: Dict[str, float] = {}
        self._drift_confidence_cache: Dict[str, float] = {}

    def calculate(
        self,
        ticker: str,
        current_price: float,
        target_price: float,
        risk_free_rate: float,
        dividend_yield: float,
        days: int,
        steps: Optional[int] = None,
        use_implied_vol: bool = True,
        fmp_api_key: Optional[str] = None,
        vol_blend_weight: float = 0.6,
    ) -> Dict[str, Any]:
        """
        Main calculation method.

        Args:
            ticker: Stock ticker symbol
            current_price: Current stock price
            target_price: Target price to calculate probability for
            risk_free_rate: Annual risk-free rate (decimal, e.g., 0.042)
            dividend_yield: Annual dividend yield (decimal, e.g., 0.005)
            days: Number of calendar days for the projection
            steps: Number of binomial steps (default = min(days, 252))
            use_implied_vol: Whether to try fetching IV from Yahoo
            fmp_api_key: FMP API key for historical data
            vol_blend_weight: Weight for implied vol when blending
                (0.0 = pure historical, 1.0 = pure implied, default 0.6)
        """
        try:
            # ── Input validation ──
            if current_price <= 0:
                raise ValueError(f"current_price must be > 0, got {current_price}")
            if target_price <= 0:
                raise ValueError(f"target_price must be > 0, got {target_price}")
            if days <= 0:
                raise ValueError(f"days must be > 0, got {days}")
            if not fmp_api_key:
                import os
                fmp_api_key = os.environ.get("FMP_API_KEY")
                if not fmp_api_key:
                    logger.warning("No FMP API key provided and FMP_API_KEY env var not set")

            logger.info(
                "Calculating for %s: S=%s, T=%s, r=%s, DY=%s, days=%s",
                ticker, current_price, target_price, risk_free_rate,
                dividend_yield, days,
            )

            # ── Calculate Historical Volatility + EWMA ──
            hist_vol = self._calculate_historical_volatility(ticker, fmp_api_key)
            ewma_vol = self._ewma_vol_cache.get(ticker)

            # ── Try Implied Volatility ──
            implied_vol = None
            options_chain = None
            if use_implied_vol and YFINANCE_AVAILABLE:
                implied_vol, options_chain = self._fetch_implied_volatility(ticker, days)

            # ── Choose / blend volatility (EWMA + hist + implied) ──
            vol_clamped = False
            if implied_vol and implied_vol > 0 and hist_vol and hist_vol > 0 and ewma_vol and ewma_vol > 0:
                # 3-way blend: 30% implied + 30% EWMA + 40% historical (more robust)
                vol_used = 0.30 * implied_vol + 0.30 * ewma_vol + 0.40 * hist_vol
                vol_source = "blended (30% implied + 30% EWMA + 40% historical)"
            elif implied_vol and implied_vol > 0 and ewma_vol and ewma_vol > 0:
                vol_used = 0.5 * implied_vol + 0.5 * ewma_vol
                vol_source = "blended (50% implied + 50% EWMA)"
            elif implied_vol and implied_vol > 0 and hist_vol and hist_vol > 0:
                w = max(0.0, min(1.0, vol_blend_weight))
                vol_used = w * implied_vol + (1.0 - w) * hist_vol
                vol_source = f"blended ({w:.0%} implied + {1-w:.0%} historical)"
            elif ewma_vol and ewma_vol > 0 and hist_vol and hist_vol > 0:
                vol_used = 0.5 * ewma_vol + 0.5 * hist_vol
                vol_source = "blended (50% EWMA + 50% historical)"
            elif implied_vol and implied_vol > 0:
                vol_used = implied_vol
                vol_source = "implied"
            elif ewma_vol and ewma_vol > 0:
                vol_used = ewma_vol
                vol_source = "EWMA"
            elif hist_vol and hist_vol > 0:
                vol_used = hist_vol
                vol_source = "historical"
            else:
                vol_used = 0.30
                vol_source = "default"

            # Clamp vol to [0.05, 1.0] for numerical stability
            if vol_used < 0.05:
                logger.warning("Clamping vol from %.4f to 0.05", vol_used)
                vol_used = 0.05
                vol_clamped = True
            elif vol_used > 1.0:
                logger.warning("Clamping vol from %.4f to 1.0", vol_used)
                vol_used = 1.0
                vol_clamped = True

            logger.info(
                "Volatility: hist=%s, EWMA=%s, implied=%s, using=%s (%s)%s",
                hist_vol, ewma_vol, implied_vol, vol_used, vol_source,
                " [CLAMPED]" if vol_clamped else "",
            )

            # ── Auto-tune steps for convergence ──
            T = days / 365.0
            bs_probability_ref = self._black_scholes_probability(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used, T,
            )
            if steps is None:
                # Start at 200, double until convergence or max
                steps = 200
                for _ in range(5):  # max 5 doublings: 200→400→800→1600→2000
                    crr_test = self._quick_crr_probability(
                        current_price, target_price, risk_free_rate,
                        dividend_yield, vol_used, days, steps,
                    )
                    diff = abs(crr_test - bs_probability_ref)
                    if diff < self.convergence_tol or steps >= self.max_steps:
                        break
                    steps = min(steps * 2, self.max_steps)
                logger.info(
                    "Auto-tuned steps=%d (CRR-BS diff=%.4f, tol=%.4f)",
                    steps, diff, self.convergence_tol,
                )
            else:
                if steps > self.max_steps:
                    logger.warning("Requested steps=%d > max=%d, clamping", steps, self.max_steps)
                steps = max(10, min(steps, self.max_steps))

            # ── CRR Parameters ──
            T = days / 365.0  # Total time in years
            dt = T / steps    # Time per step

            u = exp(vol_used * sqrt(dt))  # Up factor
            d = 1.0 / u                   # Down factor

            # Risk-neutral probability
            p_up = (exp((risk_free_rate - dividend_yield) * dt) - d) / (u - d)
            p_down = 1.0 - p_up

            # Validate probabilities
            if p_up < 0 or p_up > 1:
                logger.warning("p_up=%s out of [0,1] range — clamping", p_up)
                p_up = max(0.01, min(0.99, p_up))
                p_down = 1.0 - p_up

            # ── Vectorized Terminal Node Calculation ──
            # j = number of up-moves at terminal level (0 ... steps)
            j = np.arange(steps + 1, dtype=np.float64)

            # Terminal price for each node: S₀ · u^j · d^(N-j)
            terminal_prices = current_price * (u ** j) * (d ** (steps - j))

            # Log-binomial coefficient: log C(N, j) = logΓ(N+1) - logΓ(j+1) - logΓ(N-j+1)
            # gammaln is numerically stable for all N and j
            log_binom_coef = (
                gammaln(steps + 1)
                - gammaln(j + 1)
                - gammaln(steps - j + 1)
            )

            # Log-probability of each terminal node
            log_p_up  = np.log(p_up)
            log_p_down = np.log(p_down)
            log_probs = log_binom_coef + j * log_p_up + (steps - j) * log_p_down

            # Convert back to probability space
            probs = np.exp(log_probs)

            # Normalize — guarantees Σ probs = 1.0 exactly (removes floating-point drift)
            prob_sum_raw = float(probs.sum())
            probs = probs / prob_sum_raw

            logger.info(
                "Probability check: raw_sum=%.10f -> normalized to 1.0 (%d terminal nodes)",
                prob_sum_raw, steps + 1,
            )

            # ── Target Probability (CRR) ──
            if target_price >= current_price:
                # Bullish: probability of price going UP to / above target
                mask = terminal_prices >= target_price
            else:
                # Bearish: probability of price going DOWN to / below target
                mask = terminal_prices <= target_price

            probability    = float(np.sum(probs[mask]))
            expected_price = float(np.dot(terminal_prices, probs))

            # ── Black-Scholes sanity-check probability ──
            bs_probability = self._black_scholes_probability(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used, T,
            )

            # ── Historical drift for real-world probabilities ──
            hist_drift = self._hist_drift_cache.get(ticker, risk_free_rate)
            # Clamp drift to reasonable range (-50% to +100%)
            hist_drift = max(-0.50, min(1.00, hist_drift))

            # ── Barrier / First-Passage probability ──
            # "What is the probability the price EVER TOUCHES the target?"
            barrier_prob_rn = self._barrier_probability(
                current_price, target_price,
                risk_free_rate - dividend_yield, vol_used, T,
            )
            barrier_prob_real = self._barrier_probability(
                current_price, target_price,
                hist_drift, vol_used, T,
            )

            # ── Real-world terminal probability ──
            real_world_prob = self._real_world_terminal_probability(
                current_price, target_price, hist_drift, vol_used, T,
            )

            logger.info(
                "Probabilities for %s: CRR=%.1f%%, BS=%.1f%%, "
                "Real-world terminal=%.1f%%, Barrier(RN)=%.1f%%, Barrier(RW)=%.1f%%, "
                "hist_drift=%.2f%%",
                ticker, probability * 100, bs_probability * 100,
                real_world_prob * 100, barrier_prob_rn * 100, barrier_prob_real * 100,
                hist_drift * 100,
            )

            # ── Price Distribution for Chart ──
            price_distribution = [
                {
                    "price":       round(float(terminal_prices[jj]), 2),
                    "probability": round(float(probs[jj]) * 100, 6),
                    "ups":         int(jj),
                    "downs":       int(steps - jj),
                }
                for jj in range(steps + 1)
            ]

            # ── Build Tree Preview (first 6 levels) with per-node probabilities ──
            preview_levels = min(6, steps)
            tree_preview = self._build_tree_preview(
                current_price, u, d, p_up, p_down, preview_levels, target_price
            )

            # ── Aggregate price distribution for chart ──
            distribution_chart = self._aggregate_distribution(
                price_distribution, current_price, target_price, num_buckets=30
            )

            # ── Expected Move ──
            expected_move = self._expected_move(current_price, vol_used, days)

            # ── Greeks Approximation ──
            greeks = self._approximate_greeks(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used, days, steps,
            )

            # ── Risk-Reward Ratio ──
            risk_reward = self._risk_reward_ratio(
                current_price, target_price, vol_used, days, steps,
                risk_free_rate, dividend_yield,
            )

            # ── Sensitivity Analysis ──
            sensitivity = self._sensitivity_analysis(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used, days, steps,
            )

            # ── Multiple Time Horizons ──
            time_horizons = self._multiple_time_horizons(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used,
            )

            # ── Richardson Extrapolation for higher accuracy ──
            half_steps = max(10, steps // 2)
            p_half = self._quick_crr_probability(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used, days, half_steps,
            )
            p_full = self._quick_crr_probability(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol_used, days, steps,
            )
            # Richardson: (4*P_2N - P_N) / 3
            richardson_prob = (4.0 * p_full - p_half) / 3.0
            richardson_prob = max(0.0, min(1.0, richardson_prob))

            # ── Convergence metrics ──
            convergence_diff = abs(probability - bs_probability)
            accuracy_score = 1.0 - convergence_diff / max(bs_probability, 0.001)
            accuracy_score = max(0.0, min(1.0, accuracy_score))
            convergence_warning = None
            if convergence_diff > 0.05:
                convergence_warning = f"CRR-BS diff is {convergence_diff*100:.1f}% — consider increasing steps for better accuracy"
            elif convergence_diff > 0.02:
                convergence_warning = f"CRR-BS diff is {convergence_diff*100:.1f}% — moderate convergence"

            # ── Monte Carlo barrier check (10000 paths) ──
            mc_barrier_prob = self._monte_carlo_barrier(
                current_price, target_price, hist_drift, vol_used, T,
                n_paths=10000,
            )

            # ── Bootstrap Confidence Interval ──
            bootstrap_ci = self._bootstrap_confidence_interval(
                ticker, current_price, target_price, risk_free_rate,
                dividend_yield, days, steps, fmp_api_key,
                n_bootstrap=1000, confidence=0.90,
            )

            # ── IV Skew Analysis ──
            iv_skew = None
            if use_implied_vol and YFINANCE_AVAILABLE:
                iv_skew = self._compute_iv_skew(ticker, days)

            # ── Drift confidence ──
            drift_confidence = self._drift_confidence_cache.get(ticker, 0.0)

            result = {
                "probability":          round(probability * 100, 2),
                "bsProbability":        round(bs_probability * 100, 2),
                "richardsonProbability": round(richardson_prob * 100, 2),
                "barrierProbability":   round(barrier_prob_real * 100, 2),
                "barrierProbabilityRN": round(barrier_prob_rn * 100, 2),
                "mcBarrierProbability": round(mc_barrier_prob * 100, 2),
                "realWorldProbability": round(real_world_prob * 100, 2),
                "historicalDrift":      round(hist_drift * 100, 2),
                "driftConfidence":      round(drift_confidence * 100, 1),
                "upFactor":             round(u, 6),
                "downFactor":           round(d, 6),
                "upProbability":        round(p_up * 100, 4),
                "downProbability":      round(p_down * 100, 4),
                "historicalVolatility": round(hist_vol * 100, 2) if hist_vol else None,
                "ewmaVolatility":       round(ewma_vol * 100, 2) if ewma_vol else None,
                "impliedVolatility":    round(implied_vol * 100, 2) if implied_vol else None,
                "volatilityUsed":       round(vol_used * 100, 2),
                "volatilitySource":     vol_source,
                "volatilityClamped":    vol_clamped,
                "expectedPrice":        round(expected_price, 2),
                "steps":                steps,
                "days":                 days,
                "deltaT":               round(T, 6),
                "deltaTPerStep":        round(dt, 6),
                "probSum":              round(float(np.sum(probs)) * 100, 4),
                "convergenceDiff":      round(convergence_diff * 100, 2),
                "accuracyScore":        round(accuracy_score * 100, 1),
                "convergenceWarning":   convergence_warning,
                "priceDistribution":    distribution_chart,
                "treePreview":          tree_preview,
                "optionsChain":         options_chain,
                "currentPrice":         current_price,
                "targetPrice":          target_price,
                # ── Scientific / ML additions ──
                "expectedMove":         expected_move,
                "greeks":               greeks,
                "riskReward":           risk_reward,
                "sensitivity":          sensitivity,
                "timeHorizons":         time_horizons,
                "bootstrapCI":          bootstrap_ci,
                "ivSkew":               iv_skew,
            }

            logger.info(
                "Result: CRR probability=%.2f%%, B-S probability=%.2f%%, "
                "expected=%s, u=%s, d=%s, prob_sum=%.4f%%",
                result["probability"], result["bsProbability"],
                result["expectedPrice"], result["upFactor"],
                result["downFactor"], result["probSum"],
            )

            return result

        except Exception as e:
            logger.error("Error in calculate(): %s", e, exc_info=True)
            return {
                "error": str(e),
                "probability": None,
            }

    # ── Black-Scholes closed-form probability ──────────────────────────

    @staticmethod
    def _black_scholes_probability(
        S: float,
        K: float,
        r: float,
        q: float,
        sigma: float,
        T: float,
    ) -> float:
        """
        Risk-neutral probability that S_T >= K (or S_T <= K when K < S)
        under geometric Brownian motion using the Black-Scholes framework.

        P(S_T >= K) = N(d2)  where d2 = [ln(S/K) + (r - q - σ²/2)T] / (σ√T)
        """
        if T <= 0 or sigma <= 0:
            return 0.0
        d2 = (log(S / K) + (r - q - 0.5 * sigma ** 2) * T) / (sigma * sqrt(T))
        if K >= S:
            # Bullish target: probability price ends >= K
            return float(norm.cdf(d2))
        else:
            # Bearish target: probability price ends <= K
            return float(norm.cdf(-d2))

    @staticmethod
    def _barrier_probability(
        S: float,
        K: float,
        mu: float,
        sigma: float,
        T: float,
    ) -> float:
        """
        First-passage / barrier probability: P(max S_t >= K) for any t in [0, T]
        (or P(min S_t <= K) if K < S).

        This answers "what is the probability the price EVER TOUCHES the target
        during the period?" — much higher than the terminal probability.

        Uses the reflection principle for geometric Brownian motion:
        P(max S_t >= K | S_0 = S) = N(d+) + exp(2*nu*alpha/sigma^2) * N(d-)

        where:
            alpha = ln(K/S)
            nu = mu - sigma^2/2  (drift of log-price)
            d+ = (-alpha + nu*T) / (sigma*sqrt(T))
            d- = (-alpha - nu*T) / (sigma*sqrt(T))
        """
        if T <= 0 or sigma <= 0:
            return 0.0

        bullish = K >= S

        if bullish:
            alpha = log(K / S)
        else:
            # For bearish: P(min S_t <= K) = P(max(1/S_t) >= 1/K)
            # Equivalent: flip and use -mu drift
            alpha = log(S / K)
            mu = -mu

        nu = mu - 0.5 * sigma ** 2
        sqrt_T = sigma * sqrt(T)

        if sqrt_T < 1e-12:
            return 1.0 if (bullish and S >= K) or (not bullish and S <= K) else 0.0

        d_plus = (-alpha + nu * T) / sqrt_T
        d_minus = (-alpha - nu * T) / sqrt_T

        # Reflection principle formula
        exponent = 2.0 * nu * alpha / (sigma ** 2)
        exponent = max(-500.0, min(500.0, exponent))  # Prevent overflow

        prob = float(norm.cdf(d_plus) + exp(exponent) * norm.cdf(d_minus))
        return max(0.0, min(1.0, prob))

    @staticmethod
    def _real_world_terminal_probability(
        S: float,
        K: float,
        mu: float,
        sigma: float,
        T: float,
    ) -> float:
        """
        Real-world terminal probability using actual expected return (mu)
        instead of risk-free rate. This is the probability the stock ENDS
        above/below the target (not touches it).

        P(S_T >= K) = N(d2_real)
        where d2_real = [ln(S/K) + (mu - σ²/2)T] / (σ√T)
        """
        if T <= 0 or sigma <= 0:
            return 0.0
        d2 = (log(S / K) + (mu - 0.5 * sigma ** 2) * T) / (sigma * sqrt(T))
        if K >= S:
            return float(norm.cdf(d2))
        else:
            return float(norm.cdf(-d2))

    # ── Historical volatility with retry + cache ──────────────────────

    def _calculate_historical_volatility(
        self, ticker: str, fmp_api_key: Optional[str]
    ) -> Optional[float]:
        """Calculate annualized historical volatility + EWMA vol + drift from daily returns."""
        # Check cache first
        if ticker in self._hist_vol_cache:
            logger.info("Historical vol cache hit for %s", ticker)
            return self._hist_vol_cache[ticker]

        if not fmp_api_key:
            import os
            fmp_api_key = os.environ.get("FMP_API_KEY")

        if not fmp_api_key:
            logger.warning("No FMP API key for historical vol")
            return None

        try:
            from spectral_cycle_analyzer import HistoricalDataFetcher

            if not self.data_fetcher:
                self.data_fetcher = HistoricalDataFetcher(fmp_api_key)

            # Fetch 500+ days for better drift estimation
            historical = None
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                try:
                    historical = self.data_fetcher.fetch(ticker, max_bars=600)
                    if historical:
                        break
                except Exception as fetch_err:
                    logger.warning(
                        "Fetch attempt %d/%d for %s failed: %s",
                        attempt, max_retries, ticker, fetch_err,
                    )
                    if attempt == max_retries:
                        raise

            if not historical or len(historical) < 30:
                self._hist_vol_cache[ticker] = None
                return None

            closes = np.array([float(h["close"]) for h in historical])

            # Log returns
            log_returns = np.diff(np.log(closes))

            # Standard annualized volatility (ddof=1 for sample std dev)
            daily_vol = np.std(log_returns, ddof=1)
            annual_vol = daily_vol * sqrt(252)

            # EWMA volatility (lambda=0.94, RiskMetrics standard)
            ewma_lambda = 0.94
            n = len(log_returns)
            ewma_var = float(log_returns[0] ** 2)
            for i in range(1, n):
                ewma_var = ewma_lambda * ewma_var + (1 - ewma_lambda) * log_returns[i] ** 2
            ewma_daily_vol = sqrt(ewma_var)
            ewma_annual_vol = ewma_daily_vol * sqrt(252)
            self._ewma_vol_cache[ticker] = float(ewma_annual_vol)

            # Annualized drift (mean log return) — for real-world probability
            daily_drift = np.mean(log_returns)
            annual_drift = daily_drift * 252

            # Drift confidence: based on data length and stability
            # Higher confidence with more data and lower standard error
            drift_se = np.std(log_returns, ddof=1) / sqrt(n) * sqrt(252)
            # Confidence = 1 - (standard_error / abs(drift)) clamped to [0, 1]
            if abs(annual_drift) > 0.001:
                drift_conf = max(0.0, min(1.0, 1.0 - drift_se / abs(annual_drift)))
            else:
                drift_conf = 0.0
            # Bonus for having more data
            data_bonus = min(0.3, n / 1000.0)
            drift_conf = min(1.0, drift_conf + data_bonus)
            self._drift_confidence_cache[ticker] = float(drift_conf)

            logger.info(
                "Vol for %s: hist=%.2f%%, EWMA=%.2f%%, drift=%.2f%% "
                "(drift_conf=%.0f%%, %d days)",
                ticker, annual_vol * 100, ewma_annual_vol * 100,
                annual_drift * 100, drift_conf * 100, len(closes),
            )

            # Store in cache
            self._hist_vol_cache[ticker] = float(annual_vol)
            self._hist_drift_cache[ticker] = float(annual_drift)
            return float(annual_vol)

        except Exception as e:
            logger.error("Error calculating historical vol: %s", e)
            return None

    @staticmethod
    def _monte_carlo_barrier(
        S: float, K: float, mu: float, sigma: float, T: float,
        n_paths: int = 10000, n_steps: int = 252,
    ) -> float:
        """
        Monte Carlo simulation for barrier probability verification.
        Simulates n_paths GBM paths and counts how many touch the target.
        """
        if T <= 0 or sigma <= 0:
            return 0.0
        try:
            rng = np.random.default_rng(seed=42)
            dt = T / n_steps
            sqrt_dt = sqrt(dt)
            drift_per_step = (mu - 0.5 * sigma ** 2) * dt
            bullish = K >= S

            touched = 0
            for _ in range(n_paths):
                price = S
                for __ in range(n_steps):
                    z = rng.standard_normal()
                    price *= exp(drift_per_step + sigma * sqrt_dt * z)
                    if bullish and price >= K:
                        touched += 1
                        break
                    elif not bullish and price <= K:
                        touched += 1
                        break

            return touched / n_paths
        except Exception:
            return 0.0

    def _fetch_implied_volatility(
        self, ticker: str, days: int
    ) -> Tuple[Optional[float], Optional[List[Dict]]]:
        """Fetch implied volatility from Yahoo Finance options chain."""
        if not YFINANCE_AVAILABLE:
            return None, None

        try:
            stock = yf.Ticker(ticker)
            expirations = stock.options

            if not expirations:
                logger.info("No options available for %s", ticker)
                return None, None

            # Find closest expiration to requested days
            target_date = datetime.now() + timedelta(days=days)
            closest_exp = None
            min_diff = float("inf")

            for exp_str in expirations:
                exp_date = datetime.strptime(exp_str, "%Y-%m-%d")
                diff = abs((exp_date - target_date).days)
                if diff < min_diff:
                    min_diff = diff
                    closest_exp = exp_str

            if not closest_exp:
                return None, None

            logger.info(
                "Using options expiration: %s (target was %s, diff=%dd)",
                closest_exp, target_date.strftime("%Y-%m-%d"), min_diff,
            )

            # Get options chain
            chain = stock.option_chain(closest_exp)
            calls = chain.calls

            if calls.empty:
                return None, None

            # Get current price for ATM detection — multiple fallbacks for after-hours
            info = stock.info
            current_price = (
                info.get("currentPrice")
                or info.get("regularMarketPrice")
                or info.get("previousClose")
                or info.get("regularMarketPreviousClose")
                or 0
            )

            if current_price <= 0:
                logger.warning(
                    "No price available for %s (after hours?), skipping IV", ticker,
                )
                return None, None

            # Find ATM option (closest strike to current price)
            calls_sorted = calls.copy()
            calls_sorted["dist"] = abs(calls_sorted["strike"] - current_price)
            atm = calls_sorted.nsmallest(1, "dist").iloc[0]

            iv = float(atm.get("impliedVolatility", 0))
            logger.info(
                "ATM IV for %s: %.2f%% (strike=%s, price=%s)",
                ticker, iv * 100, atm["strike"], current_price,
            )

            # Build options chain summary (top 10 near ATM)
            near_atm = calls_sorted.nsmallest(10, "dist")
            options_summary: List[Dict[str, Any]] = []
            for _, row in near_atm.iterrows():
                options_summary.append({
                    "strike":           float(row["strike"]),
                    "lastPrice":        float(row.get("lastPrice", 0)),
                    "bid":              float(row.get("bid", 0)),
                    "ask":              float(row.get("ask", 0)),
                    "impliedVolatility": round(float(row.get("impliedVolatility", 0)) * 100, 2),
                    "volume":           int(row.get("volume", 0)) if not np.isnan(row.get("volume", 0)) else 0,
                    "openInterest":     int(row.get("openInterest", 0)) if not np.isnan(row.get("openInterest", 0)) else 0,
                    "expiration":       closest_exp,
                })

            return iv if iv > 0 else None, options_summary if options_summary else None

        except Exception as e:
            logger.error("Error fetching IV from Yahoo: %s", e, exc_info=True)
            return None, None

    # ── IV Skew Analysis ──────────────────────────────────────────────

    def _compute_iv_skew(
        self, ticker: str, days: int
    ) -> Optional[Dict[str, Any]]:
        """
        Compute implied volatility skew from options chain.

        IV skew = OTM put IV - ATM call IV.
        A large positive skew indicates the market is pricing in more downside
        risk (hedging demand), while a negative skew suggests bullish sentiment.

        Also computes the 25-delta risk reversal approximation by comparing
        OTM put IV (strike ~5% below spot) vs OTM call IV (strike ~5% above spot).
        """
        if not YFINANCE_AVAILABLE:
            return None

        try:
            stock = yf.Ticker(ticker)
            expirations = stock.options
            if not expirations:
                return None

            target_date = datetime.now() + timedelta(days=days)
            closest_exp = min(
                expirations,
                key=lambda e: abs((datetime.strptime(e, "%Y-%m-%d") - target_date).days),
            )

            chain = stock.option_chain(closest_exp)
            calls = chain.calls
            puts = chain.puts

            if calls.empty or puts.empty:
                return None

            info = stock.info
            spot = (
                info.get("currentPrice")
                or info.get("regularMarketPrice")
                or info.get("previousClose")
                or 0
            )
            if spot <= 0:
                return None

            # ATM call IV (closest strike to spot)
            calls_cp = calls.copy()
            calls_cp["dist"] = abs(calls_cp["strike"] - spot)
            atm_call = calls_cp.nsmallest(1, "dist").iloc[0]
            atm_iv = float(atm_call.get("impliedVolatility", 0))

            # OTM put: strike ~5% below spot
            otm_put_strike = spot * 0.95
            puts_cp = puts.copy()
            puts_cp["dist"] = abs(puts_cp["strike"] - otm_put_strike)
            otm_put = puts_cp.nsmallest(1, "dist").iloc[0]
            otm_put_iv = float(otm_put.get("impliedVolatility", 0))

            # OTM call: strike ~5% above spot
            otm_call_strike = spot * 1.05
            calls_cp2 = calls.copy()
            calls_cp2["dist"] = abs(calls_cp2["strike"] - otm_call_strike)
            otm_call = calls_cp2.nsmallest(1, "dist").iloc[0]
            otm_call_iv = float(otm_call.get("impliedVolatility", 0))

            skew = otm_put_iv - atm_iv  # positive = downside fear
            risk_reversal = otm_call_iv - otm_put_iv  # negative = put premium

            # Interpret the skew
            if skew > 0.05:
                interpretation = "High downside fear — market hedging aggressively"
            elif skew > 0.02:
                interpretation = "Moderate downside concern"
            elif skew > -0.02:
                interpretation = "Neutral skew — balanced sentiment"
            elif skew > -0.05:
                interpretation = "Moderate upside bias"
            else:
                interpretation = "Strong upside bias — unusual"

            result = {
                "atmIV": round(atm_iv * 100, 2),
                "otmPutIV": round(otm_put_iv * 100, 2),
                "otmCallIV": round(otm_call_iv * 100, 2),
                "skew": round(skew * 100, 2),  # in percentage points
                "riskReversal": round(risk_reversal * 100, 2),
                "interpretation": interpretation,
                "expiration": closest_exp,
                "otmPutStrike": round(float(otm_put["strike"]), 2),
                "otmCallStrike": round(float(otm_call["strike"]), 2),
            }
            logger.info("IV skew for %s: %s", ticker, result)
            return result

        except Exception as e:
            logger.error("Error computing IV skew: %s", e)
            return None

    # ── Sensitivity Analysis ──────────────────────────────────────────

    def _sensitivity_analysis(
        self,
        current_price: float,
        target_price: float,
        risk_free_rate: float,
        dividend_yield: float,
        vol: float,
        days: int,
        steps: int,
    ) -> Dict[str, Any]:
        """
        Vary key inputs around their base values and observe how the
        CRR probability changes.  Returns a dict of perturbation results.

        Perturbations:
        - Volatility:  ±5 percentage points (e.g. 30% -> 25%, 35%)
        - Risk-free rate: ±1 percentage point
        - Days to expiry: ±30 calendar days
        """
        base_prob = self._quick_crr_probability(
            current_price, target_price, risk_free_rate, dividend_yield,
            vol, days, steps,
        )

        results: Dict[str, Any] = {"baseProbability": round(base_prob * 100, 2)}

        # Volatility perturbation
        vol_shifts = [-0.05, -0.025, 0.025, 0.05]
        vol_results = []
        for dv in vol_shifts:
            shifted_vol = max(0.01, vol + dv)
            p = self._quick_crr_probability(
                current_price, target_price, risk_free_rate, dividend_yield,
                shifted_vol, days, steps,
            )
            vol_results.append({
                "volShift": round(dv * 100, 1),
                "volUsed": round(shifted_vol * 100, 2),
                "probability": round(p * 100, 2),
                "delta": round((p - base_prob) * 100, 2),
            })
        results["volatility"] = vol_results

        # Rate perturbation
        rate_shifts = [-0.01, -0.005, 0.005, 0.01]
        rate_results = []
        for dr in rate_shifts:
            shifted_rate = max(0.0, risk_free_rate + dr)
            p = self._quick_crr_probability(
                current_price, target_price, shifted_rate, dividend_yield,
                vol, days, steps,
            )
            rate_results.append({
                "rateShift": round(dr * 100, 2),
                "rateUsed": round(shifted_rate * 100, 2),
                "probability": round(p * 100, 2),
                "delta": round((p - base_prob) * 100, 2),
            })
        results["riskFreeRate"] = rate_results

        # Days perturbation
        day_shifts = [-30, -15, 15, 30]
        days_results = []
        for dd in day_shifts:
            shifted_days = max(1, days + dd)
            shifted_steps = max(10, min(shifted_days, self.max_steps))
            p = self._quick_crr_probability(
                current_price, target_price, risk_free_rate, dividend_yield,
                vol, shifted_days, shifted_steps,
            )
            days_results.append({
                "dayShift": dd,
                "daysUsed": shifted_days,
                "probability": round(p * 100, 2),
                "delta": round((p - base_prob) * 100, 2),
            })
        results["daysToExpiry"] = days_results

        # Drift perturbation (real-world probability sensitivity)
        T = days / 365.0
        drift_shifts = [-0.10, -0.05, 0.05, 0.10]
        drift_results = []
        base_drift = self._hist_drift_cache.get(
            "", risk_free_rate
        )  # approx — will use r as base
        for dd in drift_shifts:
            shifted_drift = risk_free_rate + dd
            rw_p = self._real_world_terminal_probability(
                current_price, target_price, shifted_drift, vol, T,
            )
            drift_results.append({
                "driftShift": round(dd * 100, 1),
                "driftUsed": round(shifted_drift * 100, 2),
                "realWorldProb": round(rw_p * 100, 2),
            })
        results["drift"] = drift_results

        return results

    def _quick_crr_probability(
        self,
        S: float, K: float, r: float, q: float,
        sigma: float, days: int, steps: int,
    ) -> float:
        """
        Lightweight CRR probability calculation (no tree preview, no charts).
        Used internally by sensitivity analysis and bootstrap.
        """
        T = days / 365.0
        dt = T / steps
        u = exp(sigma * sqrt(dt))
        d = 1.0 / u
        p_up = (exp((r - q) * dt) - d) / (u - d)
        p_up = max(0.01, min(0.99, p_up))

        j = np.arange(steps + 1, dtype=np.float64)
        terminal = S * (u ** j) * (d ** (steps - j))

        log_binom = gammaln(steps + 1) - gammaln(j + 1) - gammaln(steps - j + 1)
        log_probs = log_binom + j * np.log(p_up) + (steps - j) * np.log(1.0 - p_up)
        probs = np.exp(log_probs)
        probs /= probs.sum()

        if K >= S:
            mask = terminal >= K
        else:
            mask = terminal <= K

        return float(np.sum(probs[mask]))

    # ── Bootstrap Confidence Interval ─────────────────────────────────

    def _bootstrap_confidence_interval(
        self,
        ticker: str,
        current_price: float,
        target_price: float,
        risk_free_rate: float,
        dividend_yield: float,
        days: int,
        steps: int,
        fmp_api_key: Optional[str],
        n_bootstrap: int = 500,
        confidence: float = 0.90,
    ) -> Optional[Dict[str, Any]]:
        """
        Bootstrap the probability estimate by resampling historical returns.

        For each bootstrap iteration:
        1. Resample daily log-returns with replacement
        2. Recalculate annualized volatility from the resampled series
        3. Recompute the CRR probability with this new volatility

        Returns the mean, median, and confidence interval of the probability.
        """
        try:
            if not fmp_api_key:
                import os
                fmp_api_key = os.environ.get("FMP_API_KEY")
            if not fmp_api_key:
                return None

            from spectral_cycle_analyzer import HistoricalDataFetcher

            if not self.data_fetcher:
                self.data_fetcher = HistoricalDataFetcher(fmp_api_key)

            historical = self.data_fetcher.fetch(ticker, max_bars=300)
            if not historical or len(historical) < 30:
                return None

            closes = np.array([float(h["close"]) for h in historical])
            log_returns = np.diff(np.log(closes))
            n_returns = len(log_returns)

            rng = np.random.default_rng(seed=42)
            bootstrap_probs = np.empty(n_bootstrap)

            for i in range(n_bootstrap):
                # Resample returns with replacement
                resampled = rng.choice(log_returns, size=n_returns, replace=True)
                resampled_vol = float(np.std(resampled, ddof=1) * sqrt(252))
                resampled_vol = max(0.01, resampled_vol)  # floor

                p = self._quick_crr_probability(
                    current_price, target_price, risk_free_rate, dividend_yield,
                    resampled_vol, days, steps,
                )
                bootstrap_probs[i] = p

            alpha = (1.0 - confidence) / 2.0
            lower = float(np.percentile(bootstrap_probs, alpha * 100))
            upper = float(np.percentile(bootstrap_probs, (1.0 - alpha) * 100))
            mean_p = float(np.mean(bootstrap_probs))
            median_p = float(np.median(bootstrap_probs))
            std_p = float(np.std(bootstrap_probs))

            result = {
                "mean": round(mean_p * 100, 2),
                "median": round(median_p * 100, 2),
                "std": round(std_p * 100, 2),
                "lower": round(lower * 100, 2),
                "upper": round(upper * 100, 2),
                "confidence": confidence,
                "nBootstrap": n_bootstrap,
                "nReturns": n_returns,
            }

            logger.info(
                "Bootstrap CI for %s: %.2f%% [%.2f%%, %.2f%%] (n=%d)",
                ticker, mean_p * 100, lower * 100, upper * 100, n_bootstrap,
            )
            return result

        except Exception as e:
            logger.error("Error in bootstrap CI: %s", e)
            return None

    # ── Greeks Approximation (Delta, Gamma) ───────────────────────────

    def _approximate_greeks(
        self,
        current_price: float,
        target_price: float,
        risk_free_rate: float,
        dividend_yield: float,
        vol: float,
        days: int,
        steps: int,
    ) -> Dict[str, Any]:
        """
        Approximate Delta and Gamma of the probability with respect to
        the underlying price, using finite-difference on the CRR model.

        Delta = dP/dS ≈ [P(S+h) - P(S-h)] / (2h)
        Gamma = d²P/dS² ≈ [P(S+h) - 2P(S) + P(S-h)] / h²

        where h = 0.5% of the current price (central differences).

        Interpretation:
        - Delta > 0 means probability increases as price rises (bullish target)
        - Gamma shows the convexity / acceleration of the probability change
        """
        h = current_price * 0.005  # 0.5% bump
        if h < 0.01:
            h = 0.01

        p_center = self._quick_crr_probability(
            current_price, target_price, risk_free_rate, dividend_yield,
            vol, days, steps,
        )
        p_up = self._quick_crr_probability(
            current_price + h, target_price, risk_free_rate, dividend_yield,
            vol, days, steps,
        )
        p_down = self._quick_crr_probability(
            current_price - h, target_price, risk_free_rate, dividend_yield,
            vol, days, steps,
        )

        delta = (p_up - p_down) / (2.0 * h)         # per $1 change
        gamma = (p_up - 2.0 * p_center + p_down) / (h * h)  # per $1² change

        # Also express as probability change per 1% price move
        one_pct = current_price * 0.01
        delta_pct = delta * one_pct * 100  # pp change in probability per 1% price move

        return {
            "delta": round(delta, 6),
            "gamma": round(gamma, 8),
            "deltaPctInterpretation": round(delta_pct, 2),
            "description": (
                f"A $1 increase in price changes the probability by "
                f"{delta * 100:+.4f} pp. A 1% price move ({one_pct:.2f}) "
                f"changes it by {delta_pct:+.2f} pp."
            ),
            "bumpSize": round(h, 2),
        }

    # ── Multiple Time Horizons ────────────────────────────────────────

    def _multiple_time_horizons(
        self,
        current_price: float,
        target_price: float,
        risk_free_rate: float,
        dividend_yield: float,
        vol: float,
    ) -> List[Dict[str, Any]]:
        """
        Calculate probability for standard time horizons: 30d, 60d, 90d,
        180d, 365d.  Uses both CRR and Black-Scholes for comparison.
        """
        horizons = [30, 60, 90, 180, 365]
        results = []

        for d in horizons:
            s = max(10, min(d, self.max_steps))
            crr_p = self._quick_crr_probability(
                current_price, target_price, risk_free_rate, dividend_yield,
                vol, d, s,
            )
            T = d / 365.0
            bs_p = self._black_scholes_probability(
                current_price, target_price, risk_free_rate,
                dividend_yield, vol, T,
            )
            # Expected move for this horizon
            expected_move = current_price * vol * sqrt(T)

            results.append({
                "days": d,
                "crrProbability": round(crr_p * 100, 2),
                "bsProbability": round(bs_p * 100, 2),
                "expectedMove": round(expected_move, 2),
                "expectedRange": {
                    "low": round(current_price - expected_move, 2),
                    "high": round(current_price + expected_move, 2),
                },
            })

        return results

    # ── Expected Move ─────────────────────────────────────────────────

    @staticmethod
    def _expected_move(
        current_price: float, vol: float, days: int,
    ) -> Dict[str, Any]:
        """
        Calculate the expected 1-sigma and 2-sigma moves based on
        annualized volatility.

        1-sigma move = S * σ * √(T/252)   (trading days)
        This represents the range within which the stock price is expected
        to fall ~68% of the time (1σ) or ~95% of the time (2σ).
        """
        T_trading = days / 252.0
        one_sigma = current_price * vol * sqrt(T_trading)
        two_sigma = 2.0 * one_sigma

        return {
            "oneSigma": round(one_sigma, 2),
            "twoSigma": round(two_sigma, 2),
            "oneSigmaRange": {
                "low": round(current_price - one_sigma, 2),
                "high": round(current_price + one_sigma, 2),
            },
            "twoSigmaRange": {
                "low": round(current_price - two_sigma, 2),
                "high": round(current_price + two_sigma, 2),
            },
            "oneSigmaPct": round((one_sigma / current_price) * 100, 2),
            "twoSigmaPct": round((two_sigma / current_price) * 100, 2),
            "days": days,
            "volUsed": round(vol * 100, 2),
        }

    # ── Risk-Reward Ratio ─────────────────────────────────────────────

    def _risk_reward_ratio(
        self,
        current_price: float,
        target_price: float,
        vol: float,
        days: int,
        steps: int,
        risk_free_rate: float,
        dividend_yield: float,
    ) -> Dict[str, Any]:
        """
        Calculate risk/reward ratio using the 5th percentile of the
        terminal price distribution as the worst-case scenario.

        Risk  = current_price - worst_case_5th_pct
        Reward = |target_price - current_price|
        Ratio  = Reward / Risk   (higher is better)
        """
        T = days / 365.0
        dt = T / steps
        u = exp(vol * sqrt(dt))
        d = 1.0 / u
        p_up = (exp((risk_free_rate - dividend_yield) * dt) - d) / (u - d)
        p_up = max(0.01, min(0.99, p_up))

        j = np.arange(steps + 1, dtype=np.float64)
        terminal = current_price * (u ** j) * (d ** (steps - j))

        log_binom = gammaln(steps + 1) - gammaln(j + 1) - gammaln(steps - j + 1)
        log_probs = log_binom + j * np.log(p_up) + (steps - j) * np.log(1.0 - p_up)
        probs = np.exp(log_probs)
        probs /= probs.sum()

        # Sort terminal prices and compute cumulative probabilities
        sorted_idx = np.argsort(terminal)
        sorted_prices = terminal[sorted_idx]
        sorted_probs = probs[sorted_idx]
        cum_probs = np.cumsum(sorted_probs)

        # Percentiles via interpolation
        pct_5  = float(np.interp(0.05, cum_probs, sorted_prices))
        pct_25 = float(np.interp(0.25, cum_probs, sorted_prices))
        pct_50 = float(np.interp(0.50, cum_probs, sorted_prices))
        pct_75 = float(np.interp(0.75, cum_probs, sorted_prices))
        pct_95 = float(np.interp(0.95, cum_probs, sorted_prices))

        reward = abs(target_price - current_price)
        risk   = max(0.01, current_price - pct_5)
        ratio  = reward / risk

        # Interpret the ratio
        if ratio >= 3.0:
            interpretation = "Excellent risk/reward"
        elif ratio >= 2.0:
            interpretation = "Good risk/reward"
        elif ratio >= 1.0:
            interpretation = "Acceptable risk/reward"
        elif ratio >= 0.5:
            interpretation = "Poor risk/reward — risk outweighs reward"
        else:
            interpretation = "Very poor risk/reward"

        return {
            "ratio": round(ratio, 2),
            "reward": round(reward, 2),
            "risk": round(risk, 2),
            "interpretation": interpretation,
            "worstCase5thPct": round(pct_5, 2),
            "percentiles": {
                "p5":  round(pct_5, 2),
                "p25": round(pct_25, 2),
                "p50": round(pct_50, 2),
                "p75": round(pct_75, 2),
                "p95": round(pct_95, 2),
            },
        }

    def _build_tree_preview(
        self,
        S: float,
        u: float,
        d: float,
        p_up: float,
        p_down: float,
        levels: int,
        target: float,
    ) -> List[List[Dict]]:
        """
        Build first N levels of binomial tree for visualization.

        Each node includes:
        - price: S₀ · u^j · d^(step-j)
        - probability: C(step, j) · p_up^j · p_down^(step-j)  [% of paths at this step]
        - reachesTarget: whether this node's price hits the target
        """
        tree: List[List[Dict]] = []

        for step in range(levels + 1):
            level: List[Dict] = []
            j_arr = np.arange(step + 1, dtype=np.float64)

            if step == 0:
                node_probs = np.array([1.0])
            else:
                log_binom = (
                    gammaln(step + 1)
                    - gammaln(j_arr + 1)
                    - gammaln(step - j_arr + 1)
                )
                log_probs = log_binom + j_arr * np.log(p_up) + (step - j_arr) * np.log(p_down)
                node_probs = np.exp(log_probs)
                node_probs = node_probs / node_probs.sum()  # normalize within step

            for j in range(step + 1):
                price = S * (u ** j) * (d ** (step - j))
                prob  = float(node_probs[j])
                level.append({
                    "price":        round(price, 2),
                    "probability":  round(prob * 100, 4),  # % of paths at this step
                    "reachesTarget": price >= target if target >= S else price <= target,
                    "step":         step,
                    "ups":          j,
                })

            tree.append(level)

        return tree

    def _aggregate_distribution(
        self, distribution: List[Dict], current_price: float,
        target_price: float, num_buckets: int = 30
    ) -> List[Dict]:
        """Aggregate terminal price distribution into buckets for chart display."""
        if not distribution:
            return []

        prices = [d["price"]       for d in distribution]
        probs  = [d["probability"] for d in distribution]  # already in %

        min_p = min(prices)
        max_p = max(prices)

        if max_p <= min_p:
            return []

        bucket_width = (max_p - min_p) / num_buckets
        buckets: List[Dict] = []

        for i in range(num_buckets):
            bucket_min    = min_p + i * bucket_width
            bucket_max    = bucket_min + bucket_width
            bucket_center = (bucket_min + bucket_max) / 2

            total_prob = sum(
                p for price, p in zip(prices, probs)
                if bucket_min <= price < bucket_max
            )

            if total_prob > 0.001:
                buckets.append({
                    "priceRange":  f"${bucket_min:.0f}-${bucket_max:.0f}",
                    "center":      round(bucket_center, 2),
                    "probability": round(total_prob, 4),
                    "aboveTarget": (
                        bucket_center >= target_price
                        if target_price >= current_price
                        else bucket_center <= target_price
                    ),
                })

        return buckets


# Singleton instance
probability_engine = BinomialTreeEngine()
