from __future__ import annotations

# backend/probability_engine.py
# CRR Binomial Tree Probability Engine
# Calculates the probability of a stock reaching a target price
# using Cox-Ross-Rubinstein binomial model with historical & implied volatility

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
        self.max_steps = 500  # Maximum tree depth
        self.data_fetcher = None  # Injected from spectral_cycle_analyzer
        self._hist_vol_cache: Dict[str, float | None] = {}

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

            # Determine number of steps
            if steps is None:
                steps = min(days, 252)
            if steps > self.max_steps:
                logger.warning(
                    "Requested steps=%d exceeds max_steps=%d — clamping",
                    steps, self.max_steps,
                )
            steps = max(10, min(steps, self.max_steps))

            # ── Calculate Historical Volatility ──
            hist_vol = self._calculate_historical_volatility(ticker, fmp_api_key)

            # ── Try Implied Volatility ──
            implied_vol = None
            options_chain = None
            if use_implied_vol and YFINANCE_AVAILABLE:
                implied_vol, options_chain = self._fetch_implied_volatility(ticker, days)

            # ── Choose / blend volatility ──
            if implied_vol and implied_vol > 0 and hist_vol and hist_vol > 0:
                # Blend: default 60% implied + 40% historical
                w = max(0.0, min(1.0, vol_blend_weight))
                vol_used = w * implied_vol + (1.0 - w) * hist_vol
                vol_source = f"blended ({w:.0%} implied + {1-w:.0%} historical)"
            elif implied_vol and implied_vol > 0:
                vol_used = implied_vol
                vol_source = "implied"
            elif hist_vol and hist_vol > 0:
                vol_used = hist_vol
                vol_source = "historical"
            else:
                vol_used = 0.30  # Default 30% if nothing available
                vol_source = "default"

            logger.info(
                "Volatility: hist=%s, implied=%s, using=%s (%s)",
                hist_vol, implied_vol, vol_used, vol_source,
            )

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

            result = {
                "probability":          round(probability * 100, 2),
                "bsProbability":        round(bs_probability * 100, 2),
                "upFactor":             round(u, 6),
                "downFactor":           round(d, 6),
                "upProbability":        round(p_up * 100, 4),
                "downProbability":      round(p_down * 100, 4),
                "historicalVolatility": round(hist_vol * 100, 2) if hist_vol else None,
                "impliedVolatility":    round(implied_vol * 100, 2) if implied_vol else None,
                "volatilityUsed":       round(vol_used * 100, 2),
                "volatilitySource":     vol_source,
                "expectedPrice":        round(expected_price, 2),
                "steps":                steps,
                "days":                 days,
                "deltaT":               round(T, 6),
                "deltaTPerStep":        round(dt, 6),
                "probSum":              round(float(np.sum(probs)) * 100, 4),  # sanity check (should be 100)
                "priceDistribution":    distribution_chart,
                "treePreview":          tree_preview,
                "optionsChain":         options_chain,
                "currentPrice":         current_price,
                "targetPrice":          target_price,
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

    # ── Historical volatility with retry + cache ──────────────────────

    def _calculate_historical_volatility(
        self, ticker: str, fmp_api_key: Optional[str]
    ) -> Optional[float]:
        """Calculate annualized historical volatility from daily returns."""
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

            # Retry loop — up to 3 attempts
            historical = None
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                try:
                    historical = self.data_fetcher.fetch(ticker, max_bars=300)
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

            # Annualized volatility (ddof=1 for sample std dev)
            daily_vol  = np.std(log_returns, ddof=1)
            annual_vol = daily_vol * sqrt(252)

            logger.info(
                "Historical vol for %s: %.2f%% (%d days)",
                ticker, annual_vol * 100, len(closes),
            )

            # Store in cache
            self._hist_vol_cache[ticker] = float(annual_vol)
            return float(annual_vol)

        except Exception as e:
            logger.error("Error calculating historical vol: %s", e)
            return None

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
