# backend/probability_engine.py
# CRR Binomial Tree Probability Engine
# Calculates the probability of a stock reaching a target price
# using Cox-Ross-Rubinstein binomial model with historical & implied volatility

import numpy as np
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass
from math import comb, exp, sqrt, log
from datetime import datetime, timedelta
import traceback

# Try to import yfinance for implied volatility
try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
    print("[ProbabilityEngine] yfinance available — implied volatility enabled")
except ImportError:
    YFINANCE_AVAILABLE = False
    print("[ProbabilityEngine] yfinance not available — using historical volatility only")


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
    """

    def __init__(self):
        self.max_steps = 500  # Maximum tree depth
        self.data_fetcher = None  # Injected from spectral_cycle_analyzer

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
        """
        try:
            print(f"[ProbabilityEngine] Calculating for {ticker}: "
                  f"S={current_price}, T={target_price}, r={risk_free_rate}, "
                  f"DY={dividend_yield}, days={days}")

            # Determine number of steps
            if steps is None:
                steps = min(days, 252)
            steps = max(10, min(steps, self.max_steps))

            # ── Calculate Historical Volatility ──
            hist_vol = self._calculate_historical_volatility(ticker, fmp_api_key)

            # ── Try Implied Volatility ──
            implied_vol = None
            options_chain = None
            if use_implied_vol and YFINANCE_AVAILABLE:
                implied_vol, options_chain = self._fetch_implied_volatility(ticker, days)

            # Choose volatility to use
            if implied_vol and implied_vol > 0:
                vol_used = implied_vol
                vol_source = "implied"
            elif hist_vol and hist_vol > 0:
                vol_used = hist_vol
                vol_source = "historical"
            else:
                vol_used = 0.30  # Default 30% if nothing available
                vol_source = "default"

            print(f"[ProbabilityEngine] Volatility: hist={hist_vol}, implied={implied_vol}, "
                  f"using={vol_used} ({vol_source})")

            # ── Build CRR Binomial Tree ──
            T = days / 365.0  # Total time in years
            dt = T / steps    # Time per step

            u = exp(vol_used * sqrt(dt))  # Up factor
            d = 1.0 / u                   # Down factor

            # Risk-neutral probability
            p_up = (exp((risk_free_rate - dividend_yield) * dt) - d) / (u - d)
            p_down = 1.0 - p_up

            # Validate probabilities
            if p_up < 0 or p_up > 1:
                print(f"[ProbabilityEngine] Warning: p_up={p_up} out of range, clamping")
                p_up = max(0.01, min(0.99, p_up))
                p_down = 1.0 - p_up

            # ── Calculate Terminal Prices and Probability ──
            probability = 0.0
            price_distribution = []
            expected_price = 0.0

            # Use log-space for large step counts to avoid overflow
            log_p_up = log(p_up) if p_up > 0 else -100
            log_p_down = log(p_down) if p_down > 0 else -100

            for j in range(steps + 1):
                # Terminal price after j ups and (steps-j) downs
                terminal_price = current_price * (u ** j) * (d ** (steps - j))

                # Binomial probability using log-space for numerical stability
                log_prob = self._log_binom_prob(steps, j, log_p_up, log_p_down)
                prob = exp(log_prob) if log_prob > -500 else 0.0

                expected_price += terminal_price * prob

                # Check if terminal price reaches target
                if target_price >= current_price:
                    # Bullish target: probability of going UP to target
                    if terminal_price >= target_price:
                        probability += prob
                else:
                    # Bearish target: probability of going DOWN to target
                    if terminal_price <= target_price:
                        probability += prob

                price_distribution.append({
                    "price": round(terminal_price, 2),
                    "probability": round(prob * 100, 6),
                    "ups": j,
                    "downs": steps - j,
                })

            # ── Build Tree Preview (first 6 levels for visualization) ──
            preview_levels = min(6, steps)
            tree_preview = self._build_tree_preview(
                current_price, u, d, preview_levels, target_price
            )

            # ── Aggregate price distribution for chart ──
            distribution_chart = self._aggregate_distribution(
                price_distribution, current_price, target_price, num_buckets=30
            )

            result = {
                "probability": round(probability * 100, 2),
                "upFactor": round(u, 6),
                "downFactor": round(d, 6),
                "upProbability": round(p_up * 100, 4),
                "downProbability": round(p_down * 100, 4),
                "historicalVolatility": round(hist_vol * 100, 2) if hist_vol else None,
                "impliedVolatility": round(implied_vol * 100, 2) if implied_vol else None,
                "volatilityUsed": round(vol_used * 100, 2),
                "volatilitySource": vol_source,
                "expectedPrice": round(expected_price, 2),
                "steps": steps,
                "days": days,
                "deltaT": round(T, 6),
                "deltaTPerStep": round(dt, 6),
                "priceDistribution": distribution_chart,
                "treePreview": tree_preview,
                "optionsChain": options_chain,
                "currentPrice": current_price,
                "targetPrice": target_price,
            }

            print(f"[ProbabilityEngine] Result: probability={result['probability']}%, "
                  f"expected={result['expectedPrice']}, u={result['upFactor']}, d={result['downFactor']}")

            return result

        except Exception as e:
            traceback.print_exc()
            print(f"[ProbabilityEngine] Error: {e}")
            return {
                "error": str(e),
                "probability": None,
            }

    def _log_binom_prob(self, n: int, k: int, log_p: float, log_q: float) -> float:
        """Calculate log of binomial probability using Stirling's approximation for large n."""
        if n <= 500:
            # Direct calculation for moderate n
            try:
                log_comb = sum(log(n - i) - log(i + 1) for i in range(min(k, n - k)))
            except ValueError:
                return -1000
            return log_comb + k * log_p + (n - k) * log_q
        else:
            # Stirling's for very large n
            def log_fact(x):
                if x <= 1:
                    return 0
                return x * log(x) - x + 0.5 * log(2 * 3.14159265 * x)

            log_comb = log_fact(n) - log_fact(k) - log_fact(n - k)
            return log_comb + k * log_p + (n - k) * log_q

    def _calculate_historical_volatility(
        self, ticker: str, fmp_api_key: Optional[str]
    ) -> Optional[float]:
        """Calculate annualized historical volatility from daily returns."""
        if not fmp_api_key:
            import os
            fmp_api_key = os.environ.get('FMP_API_KEY')

        if not fmp_api_key:
            print("[ProbabilityEngine] No FMP API key for historical vol")
            return None

        try:
            from spectral_cycle_analyzer import HistoricalDataFetcher

            if not self.data_fetcher:
                self.data_fetcher = HistoricalDataFetcher(fmp_api_key)

            historical = self.data_fetcher.fetch(ticker, max_bars=300)
            if not historical or len(historical) < 30:
                return None

            closes = np.array([float(h['close']) for h in historical])

            # Log returns
            log_returns = np.diff(np.log(closes))

            # Annualized volatility
            daily_vol = np.std(log_returns, ddof=1)
            annual_vol = daily_vol * sqrt(252)

            print(f"[ProbabilityEngine] Historical vol for {ticker}: "
                  f"{annual_vol*100:.2f}% ({len(closes)} days)")
            return float(annual_vol)

        except Exception as e:
            print(f"[ProbabilityEngine] Error calculating historical vol: {e}")
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
                print(f"[ProbabilityEngine] No options available for {ticker}")
                return None, None

            # Find closest expiration to requested days
            target_date = datetime.now() + timedelta(days=days)
            closest_exp = None
            min_diff = float('inf')

            for exp_str in expirations:
                exp_date = datetime.strptime(exp_str, '%Y-%m-%d')
                diff = abs((exp_date - target_date).days)
                if diff < min_diff:
                    min_diff = diff
                    closest_exp = exp_str

            if not closest_exp:
                return None, None

            print(f"[ProbabilityEngine] Using options expiration: {closest_exp} "
                  f"(target was {target_date.strftime('%Y-%m-%d')}, diff={min_diff}d)")

            # Get options chain
            chain = stock.option_chain(closest_exp)
            calls = chain.calls

            if calls.empty:
                return None, None

            # Get current price for ATM detection
            info = stock.info
            current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)

            if current_price <= 0:
                return None, None

            # Find ATM option (closest strike to current price)
            calls_sorted = calls.copy()
            calls_sorted['dist'] = abs(calls_sorted['strike'] - current_price)
            atm = calls_sorted.nsmallest(1, 'dist').iloc[0]

            iv = float(atm.get('impliedVolatility', 0))
            print(f"[ProbabilityEngine] ATM IV for {ticker}: {iv*100:.2f}% "
                  f"(strike={atm['strike']}, price={current_price})")

            # Build options chain summary (top 10 near ATM)
            near_atm = calls_sorted.nsmallest(10, 'dist')
            options_summary = []
            for _, row in near_atm.iterrows():
                options_summary.append({
                    "strike": float(row['strike']),
                    "lastPrice": float(row.get('lastPrice', 0)),
                    "bid": float(row.get('bid', 0)),
                    "ask": float(row.get('ask', 0)),
                    "impliedVolatility": round(float(row.get('impliedVolatility', 0)) * 100, 2),
                    "volume": int(row.get('volume', 0)) if not np.isnan(row.get('volume', 0)) else 0,
                    "openInterest": int(row.get('openInterest', 0)) if not np.isnan(row.get('openInterest', 0)) else 0,
                    "expiration": closest_exp,
                })

            return iv if iv > 0 else None, options_summary if options_summary else None

        except Exception as e:
            print(f"[ProbabilityEngine] Error fetching IV from Yahoo: {e}")
            traceback.print_exc()
            return None, None

    def _build_tree_preview(
        self, S: float, u: float, d: float, levels: int, target: float
    ) -> List[List[Dict]]:
        """Build first N levels of binomial tree for visualization."""
        tree = []
        for step in range(levels + 1):
            level = []
            for j in range(step + 1):
                price = S * (u ** j) * (d ** (step - j))
                level.append({
                    "price": round(price, 2),
                    "reachesTarget": price >= target if target >= S else price <= target,
                    "step": step,
                    "ups": j,
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

        prices = [d['price'] for d in distribution]
        probs = [d['probability'] for d in distribution]

        min_p = min(prices)
        max_p = max(prices)

        if max_p <= min_p:
            return []

        # Create buckets
        bucket_width = (max_p - min_p) / num_buckets
        buckets = []

        for i in range(num_buckets):
            bucket_min = min_p + i * bucket_width
            bucket_max = bucket_min + bucket_width
            bucket_center = (bucket_min + bucket_max) / 2

            # Sum probabilities for prices in this bucket
            total_prob = sum(
                p for price, p in zip(prices, probs)
                if bucket_min <= price < bucket_max
            )

            if total_prob > 0.001:  # Only include non-trivial buckets
                buckets.append({
                    "priceRange": f"${bucket_min:.0f}-${bucket_max:.0f}",
                    "center": round(bucket_center, 2),
                    "probability": round(total_prob, 4),
                    "aboveTarget": bucket_center >= target_price if target_price >= current_price else bucket_center <= target_price,
                })

        return buckets


# Singleton instance
probability_engine = BinomialTreeEngine()
