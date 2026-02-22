from __future__ import annotations

# backend/options_strategy_simulator.py
# Options Strategy Simulator
# Fetches options chain from Yahoo Finance, simulates multi-leg strategies,
# computes Black-Scholes pricing/Greeks, payoff diagrams, probability of profit,
# IV surface data, and strategy suggestions based on market outlook.

import logging
import numpy as np
import os
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from math import exp, log, sqrt
from scipy.stats import norm

logger = logging.getLogger("OptionsStrategySimulator")

try:
    import yfinance as yf
    YF_AVAILABLE = True
    logger.info("yfinance available — options chain fetching enabled")
except ImportError:
    YF_AVAILABLE = False
    logger.warning("yfinance not available — options chain fetching disabled")


# ════════════════════════════════════════════════════════════════════
# Data Classes
# ════════════════════════════════════════════════════════════════════

@dataclass
class OptionLeg:
    """Single leg of an options strategy."""
    type: str           # 'call' or 'put'
    strike: float
    expiration: str     # YYYY-MM-DD
    premium: float
    quantity: int       # positive = buy, negative = sell (write)
    iv: float = 0.0

@dataclass
class Greeks:
    """Option Greeks for a single contract or aggregate position."""
    delta: float
    gamma: float
    theta: float
    vega: float
    rho: float


# ════════════════════════════════════════════════════════════════════
# Black-Scholes Calculator
# ════════════════════════════════════════════════════════════════════

class BlackScholesCalculator:
    """
    Full Black-Scholes-Merton pricing and Greeks.

    Formulas:
      d1 = [ln(S/K) + (r - q + sigma^2/2) * T] / (sigma * sqrt(T))
      d2 = d1 - sigma * sqrt(T)

      Call = S * e^(-qT) * N(d1) - K * e^(-rT) * N(d2)
      Put  = K * e^(-rT) * N(-d2) - S * e^(-qT) * N(-d1)

    Greeks derived analytically from partial derivatives of the BS formula.
    """

    @staticmethod
    def _d1d2(S: float, K: float, T: float, r: float, sigma: float,
              q: float = 0.0) -> Tuple[float, float]:
        """Compute d1 and d2 parameters."""
        if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
            return 0.0, 0.0
        d1 = (log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * sqrt(T))
        d2 = d1 - sigma * sqrt(T)
        return d1, d2

    @staticmethod
    def price(S: float, K: float, T: float, r: float, sigma: float,
              option_type: str = 'call', q: float = 0.0) -> float:
        """
        Compute Black-Scholes theoretical option price.

        Parameters:
            S: Current underlying price
            K: Strike price
            T: Time to expiration in years
            r: Risk-free interest rate (annual, decimal)
            sigma: Volatility (annual, decimal)
            option_type: 'call' or 'put'
            q: Continuous dividend yield (annual, decimal)

        Returns:
            Theoretical option price.
        """
        if T <= 0:
            # At expiration: intrinsic value
            if option_type == 'call':
                return max(S - K, 0.0)
            return max(K - S, 0.0)
        if sigma <= 0:
            # Zero vol: discount the intrinsic
            df = exp(-r * T)
            if option_type == 'call':
                return max(S * exp(-q * T) - K * df, 0.0)
            return max(K * df - S * exp(-q * T), 0.0)

        d1, d2 = BlackScholesCalculator._d1d2(S, K, T, r, sigma, q)
        if option_type == 'call':
            return S * exp(-q * T) * norm.cdf(d1) - K * exp(-r * T) * norm.cdf(d2)
        else:
            return K * exp(-r * T) * norm.cdf(-d2) - S * exp(-q * T) * norm.cdf(-d1)

    @staticmethod
    def greeks(S: float, K: float, T: float, r: float, sigma: float,
               option_type: str = 'call', q: float = 0.0) -> Greeks:
        """
        Compute analytical Black-Scholes Greeks.

        Returns Greeks dataclass with delta, gamma, theta, vega, rho.
        Theta is expressed as per-day decay (divided by 365).
        Vega is per 1% move in IV (divided by 100).
        """
        if T <= 1e-10 or sigma <= 1e-10:
            # At/near expiration: degenerate Greeks
            itm = (S > K) if option_type == 'call' else (S < K)
            return Greeks(
                delta=1.0 if (itm and option_type == 'call') else (-1.0 if (itm and option_type == 'put') else 0.0),
                gamma=0.0, theta=0.0, vega=0.0, rho=0.0
            )

        d1, d2 = BlackScholesCalculator._d1d2(S, K, T, r, sigma, q)
        sqrt_T = sqrt(T)
        exp_qT = exp(-q * T)
        exp_rT = exp(-r * T)
        n_d1 = norm.pdf(d1)  # Standard normal PDF at d1

        # Gamma (same for call and put)
        gamma = (exp_qT * n_d1) / (S * sigma * sqrt_T)

        # Vega (same for call and put), per 1% IV move
        vega = S * exp_qT * n_d1 * sqrt_T / 100.0

        if option_type == 'call':
            delta = exp_qT * norm.cdf(d1)
            theta = (-(S * sigma * exp_qT * n_d1) / (2.0 * sqrt_T)
                     - r * K * exp_rT * norm.cdf(d2)
                     + q * S * exp_qT * norm.cdf(d1)) / 365.0
            rho = K * T * exp_rT * norm.cdf(d2) / 100.0
        else:
            delta = exp_qT * (norm.cdf(d1) - 1.0)
            theta = (-(S * sigma * exp_qT * n_d1) / (2.0 * sqrt_T)
                     + r * K * exp_rT * norm.cdf(-d2)
                     - q * S * exp_qT * norm.cdf(-d1)) / 365.0
            rho = -K * T * exp_rT * norm.cdf(-d2) / 100.0

        return Greeks(delta=delta, gamma=gamma, theta=theta, vega=vega, rho=rho)

    @staticmethod
    def implied_volatility(market_price: float, S: float, K: float, T: float,
                           r: float, option_type: str = 'call', q: float = 0.0,
                           tol: float = 1e-6, max_iter: int = 100) -> float:
        """
        Newton-Raphson implied volatility solver.

        Given a market price, iteratively solves for the volatility (sigma)
        that makes Black-Scholes price equal to the market price.

        Returns IV as a decimal (e.g. 0.30 = 30%).
        Returns 0.0 if convergence fails.
        """
        if market_price <= 0 or T <= 0:
            return 0.0

        # Intrinsic value check
        if option_type == 'call':
            intrinsic = max(S * exp(-q * T) - K * exp(-r * T), 0.0)
        else:
            intrinsic = max(K * exp(-r * T) - S * exp(-q * T), 0.0)

        if market_price < intrinsic - 0.01:
            return 0.0  # Below intrinsic — no valid IV

        # Initial guess using Brenner-Subrahmanyam approximation
        sigma = sqrt(2.0 * abs(log(S / K) + r * T) / T) if T > 0 else 0.3
        sigma = max(0.05, min(sigma, 5.0))

        bs = BlackScholesCalculator

        for _ in range(max_iter):
            price = bs.price(S, K, T, r, sigma, option_type, q)
            diff = price - market_price

            if abs(diff) < tol:
                return sigma

            # Vega (un-scaled, raw) for Newton step
            d1, _ = bs._d1d2(S, K, T, r, sigma, q)
            vega_raw = S * exp(-q * T) * norm.pdf(d1) * sqrt(T)

            if vega_raw < 1e-12:
                break  # Vega too small, can't converge

            sigma -= diff / vega_raw
            sigma = max(0.001, min(sigma, 10.0))

        return sigma if abs(diff) < 0.01 else 0.0


# ════════════════════════════════════════════════════════════════════
# Options Strategy Simulator
# ════════════════════════════════════════════════════════════════════

class OptionsStrategySimulator:
    """
    Multi-leg options strategy simulator.

    Features:
    - Fetch full options chain from Yahoo Finance
    - Analyze any multi-leg strategy (payoff, Greeks, P&L)
    - Suggest strategies based on market outlook
    - Build predefined strategy templates
    - Compute IV surface for 3D visualization
    """

    STRATEGY_TEMPLATES = [
        'covered_call', 'protective_put', 'bull_call_spread',
        'bear_put_spread', 'iron_condor', 'straddle', 'strangle',
        'butterfly', 'collar',
    ]

    def __init__(self):
        self.bs = BlackScholesCalculator()

    # ────────────────────────────────────────────────────────────
    # Fetch Options Chain
    # ────────────────────────────────────────────────────────────

    def fetch_chain(self, ticker: str) -> Dict[str, Any]:
        """
        Fetch full options chain from Yahoo Finance.

        Returns:
            {
              ticker: str,
              currentPrice: float,
              expirations: [str, ...],
              chain: {
                "YYYY-MM-DD": {
                  calls: [{strike, lastPrice, bid, ask, volume, openInterest, iv}, ...],
                  puts:  [{strike, lastPrice, bid, ask, volume, openInterest, iv}, ...]
                },
                ...
              }
            }
        """
        if not YF_AVAILABLE:
            return {"error": "yfinance not installed on server", "ticker": ticker}

        try:
            stock = yf.Ticker(ticker)
            all_expirations = list(stock.options)  # List of 'YYYY-MM-DD' strings

            if not all_expirations:
                return {
                    "error": f"No options data available for {ticker}",
                    "ticker": ticker,
                }

            # Get current price — fast path: use fast_info to avoid slow info dict
            try:
                current_price = float(stock.fast_info.get('last_price') or stock.fast_info.get('lastPrice') or 0)
            except Exception:
                current_price = 0.0
            if not current_price:
                try:
                    hist = stock.history(period="1d")
                    current_price = float(hist['Close'].iloc[-1]) if len(hist) > 0 else 0.0
                except Exception:
                    current_price = 0.0

            # Limit to MAX_EXP nearest expirations to avoid Railway timeout.
            # Each option_chain() call is a separate HTTP request to Yahoo Finance.
            # Fetching 8 expirations ≈ 5-8 seconds, which is well within limits.
            MAX_EXP = 8
            expirations_to_fetch = all_expirations[:MAX_EXP]

            # Flat dicts keyed by date — this is the format the frontend expects:
            # calls["YYYY-MM-DD"] = [{strike, lastPrice, bid, ask, iv, ...}, ...]
            calls_by_exp: Dict[str, List] = {}
            puts_by_exp: Dict[str, List] = {}

            def _parse_chain_row(row: Any) -> Dict:
                return {
                    "strike": float(row.get("strike", 0)),
                    "lastPrice": float(row.get("lastPrice", 0)),
                    "bid": float(row.get("bid", 0)),
                    "ask": float(row.get("ask", 0)),
                    "volume": int(row.get("volume", 0)) if not _is_nan(row.get("volume")) else 0,
                    "openInterest": int(row.get("openInterest", 0)) if not _is_nan(row.get("openInterest")) else 0,
                    "iv": float(row.get("impliedVolatility", 0)),
                    "inTheMoney": bool(row.get("inTheMoney", False)),
                }

            for exp_date in expirations_to_fetch:
                try:
                    opt = stock.option_chain(exp_date)
                    calls_by_exp[exp_date] = [
                        _parse_chain_row(row)
                        for _, row in opt.calls.iterrows()
                    ] if opt.calls is not None and len(opt.calls) > 0 else []
                    puts_by_exp[exp_date] = [
                        _parse_chain_row(row)
                        for _, row in opt.puts.iterrows()
                    ] if opt.puts is not None and len(opt.puts) > 0 else []
                except Exception as e:
                    logger.warning(f"Failed to fetch chain for {ticker} exp={exp_date}: {e}")
                    calls_by_exp[exp_date] = []
                    puts_by_exp[exp_date] = []

            fetched_exps = list(calls_by_exp.keys())
            return {
                "ticker": ticker,
                "currentPrice": current_price,
                "expirations": fetched_exps,
                "calls": calls_by_exp,
                "puts": puts_by_exp,
                # also expose all available expirations for the strategy simulator dropdown
                "allExpirations": all_expirations,
            }

        except Exception as e:
            logger.error(f"Error fetching options chain for {ticker}: {e}")
            return {"error": str(e), "ticker": ticker}

    # ────────────────────────────────────────────────────────────
    # Analyze Strategy
    # ────────────────────────────────────────────────────────────

    def analyze_strategy(
        self,
        ticker: str,
        legs: List[Dict],
        current_price: float,
        risk_free_rate: float = 0.042,
        dividend_yield: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Analyze a multi-leg options strategy.

        Parameters:
            ticker: Stock ticker symbol
            legs: List of leg dicts with keys: type, strike, expiration, premium, quantity, [iv]
            current_price: Current underlying price
            risk_free_rate: Annual risk-free rate (decimal)
            dividend_yield: Annual dividend yield (decimal)

        Returns:
            {
              ticker, currentPrice,
              payoffDiagram: [{price, pnl}, ...],   # 100 points from -30% to +30%
              maxProfit, maxLoss, breakevens: [float],
              greeks: {delta, gamma, theta, vega, rho},
              probabilityOfProfit: float,            # 0-1
              costBasis: float,                      # net premium paid (+) or received (-)
              legs: [detailed leg info],
              riskRewardRatio: float,
            }
        """
        try:
            # Parse legs
            parsed_legs: List[OptionLeg] = []
            for leg in legs:
                parsed_legs.append(OptionLeg(
                    type=leg.get('type', 'call').lower(),
                    strike=float(leg.get('strike', 0)),
                    expiration=leg.get('expiration', ''),
                    premium=float(leg.get('premium', 0)),
                    quantity=int(leg.get('quantity', 1)),
                    iv=float(leg.get('iv', 0.3)),
                ))

            if not parsed_legs:
                return {"error": "No valid legs provided", "ticker": ticker}

            # Net cost basis (positive = debit, negative = credit)
            cost_basis = sum(leg.premium * leg.quantity for leg in parsed_legs)

            # ── Payoff Diagram ──
            # 100 points from -30% to +30% of current price
            price_low = current_price * 0.70
            price_high = current_price * 1.30
            prices = np.linspace(price_low, price_high, 100)

            payoff_points = []
            pnl_values = []

            for p in prices:
                pnl = self._calculate_pnl_at_price(parsed_legs, p, cost_basis)
                pnl_values.append(pnl)
                payoff_points.append({"price": round(float(p), 2), "pnl": round(float(pnl), 2)})

            pnl_array = np.array(pnl_values)

            # ── Max Profit / Max Loss ──
            # Extend range for true max calculations
            extended_low = current_price * 0.01  # Near zero
            extended_high = current_price * 3.0   # 3x price
            extended_prices = np.linspace(extended_low, extended_high, 1000)
            extended_pnl = np.array([
                self._calculate_pnl_at_price(parsed_legs, p, cost_basis)
                for p in extended_prices
            ])

            max_profit = float(np.max(extended_pnl))
            max_loss = float(np.min(extended_pnl))

            # Check for unlimited profit/loss (if value keeps growing at edges)
            edge_pnl_low = self._calculate_pnl_at_price(parsed_legs, 0.01, cost_basis)
            edge_pnl_high = self._calculate_pnl_at_price(parsed_legs, current_price * 10, cost_basis)
            has_stock_leg = any(l.type == 'stock' for l in parsed_legs)

            if edge_pnl_high > max_profit * 1.5:
                max_profit = float('inf')
            # Stock can only go to zero → max loss is always finite; no -inf for stock strategies.
            if not has_stock_leg and edge_pnl_low < max_loss * 1.5 and max_loss < 0:
                max_loss = float('-inf')
            elif has_stock_leg:
                # Include near-zero price in the min-loss calculation
                max_loss = min(max_loss, edge_pnl_low)

            # ── Breakeven Points ──
            breakevens = self._find_breakevens(parsed_legs, cost_basis, current_price)

            # ── Aggregate Greeks ──
            agg_greeks = self._aggregate_greeks(
                parsed_legs, current_price, risk_free_rate, dividend_yield
            )

            # ── Probability of Profit ──
            pop = self._probability_of_profit(
                parsed_legs, current_price, cost_basis, risk_free_rate, dividend_yield
            )

            # ── Risk/Reward Ratio ──
            if max_loss != 0 and max_loss != float('-inf') and max_profit != float('inf'):
                risk_reward = abs(max_profit / max_loss) if max_loss != 0 else float('inf')
            else:
                risk_reward = None

            # ── Detailed Leg Info ──
            legs_detail = []
            for leg in parsed_legs:
                if leg.type == 'stock':
                    # Stock leg: no options-specific fields
                    legs_detail.append({
                        "type": "stock",
                        "strike": leg.strike,   # entry price
                        "expiration": leg.expiration,
                        "premium": 0.0,         # no option premium
                        "quantity": leg.quantity,
                        "iv": 0.0,
                        "bsPrice": 0.0,
                        "greeks": {"delta": float(leg.quantity), "gamma": 0, "theta": 0, "vega": 0, "rho": 0},
                        "daysToExpiry": 0,
                        "intrinsicValue": 0.0,
                        "timeValue": 0.0,
                    })
                    continue
                T = self._years_to_expiry(leg.expiration)
                leg_greeks = self.bs.greeks(
                    current_price, leg.strike, T, risk_free_rate,
                    leg.iv if leg.iv > 0 else 0.3, leg.type, dividend_yield
                )
                bs_price = self.bs.price(
                    current_price, leg.strike, T, risk_free_rate,
                    leg.iv if leg.iv > 0 else 0.3, leg.type, dividend_yield
                )
                legs_detail.append({
                    "type": leg.type,
                    "strike": leg.strike,
                    "expiration": leg.expiration,
                    "premium": leg.premium,
                    "quantity": leg.quantity,
                    "iv": leg.iv,
                    "bsPrice": round(bs_price, 4),
                    "greeks": asdict(leg_greeks),
                    "daysToExpiry": round(T * 365, 0),
                    "intrinsicValue": round(
                        max(current_price - leg.strike, 0) if leg.type == 'call'
                        else max(leg.strike - current_price, 0), 2
                    ),
                    "timeValue": round(leg.premium - (
                        max(current_price - leg.strike, 0) if leg.type == 'call'
                        else max(leg.strike - current_price, 0)
                    ), 2),
                })

            return {
                "ticker": ticker,
                "currentPrice": current_price,
                "payoffDiagram": payoff_points,
                "maxProfit": round(max_profit, 2) if max_profit != float('inf') else "unlimited",
                "maxLoss": round(max_loss, 2) if max_loss != float('-inf') else "unlimited",
                "breakevens": [round(b, 2) for b in breakevens],
                "greeks": asdict(agg_greeks),
                "probabilityOfProfit": round(pop, 4),
                "costBasis": round(cost_basis, 2),
                "legs": legs_detail,
                "riskRewardRatio": round(risk_reward, 2) if risk_reward is not None else "N/A",
            }

        except Exception as e:
            logger.error(f"Error analyzing strategy for {ticker}: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e), "ticker": ticker}

    # ────────────────────────────────────────────────────────────
    # Helpers: fetch one expiration + parse rows
    # ────────────────────────────────────────────────────────────

    @staticmethod
    def _fetch_single_expiration(ticker: str, expiration: str) -> Tuple[List[Dict], List[Dict], float]:
        """Fetch calls, puts, and current price for ONE expiration.  Returns (calls, puts, price)."""
        stock = yf.Ticker(ticker)
        opt = stock.option_chain(expiration)

        def _rows(df: Any) -> List[Dict]:
            if df is None or len(df) == 0:
                return []
            result = []
            for _, row in df.iterrows():
                result.append({
                    "strike":    float(row.get("strike", 0)),
                    "bid":       float(row.get("bid", 0)),
                    "ask":       float(row.get("ask", 0)),
                    "lastPrice": float(row.get("lastPrice", 0)),
                    "iv":        float(row.get("impliedVolatility", 0.3)),
                    "volume":    int(row.get("volume", 0)) if not _is_nan(row.get("volume")) else 0,
                    "openInterest": int(row.get("openInterest", 0)) if not _is_nan(row.get("openInterest")) else 0,
                })
            return result

        calls = _rows(opt.calls)
        puts  = _rows(opt.puts)

        try:
            price = float(stock.fast_info.get('last_price') or stock.fast_info.get('lastPrice') or 0)
        except Exception:
            price = 0.0
        if not price and calls:
            # Approximate from ATM call (put-call parity)
            price = float(sorted(calls, key=lambda c: abs(c['strike']))[0].get('strike', 0))

        return calls, puts, price

    @staticmethod
    def _mid(row: Dict) -> float:
        """Midpoint price for an option row; fall back to lastPrice."""
        mid = (row.get('bid', 0) + row.get('ask', 0)) / 2
        return float(mid or row.get('lastPrice', 0) or 0.0)

    def _quick_combo_metrics(
        self,
        legs_obj: List[OptionLeg],
        current_price: float,
    ) -> Dict[str, Any]:
        """Fast analytical metrics for a strategy combo (no Monte Carlo)."""
        # cost = net option premium only (stock legs have premium=0)
        cost = sum(l.premium * l.quantity for l in legs_obj)
        has_stock = any(l.type == 'stock' for l in legs_obj)

        # 80 test prices; for stock strategies extend range to near-zero to capture max loss
        lo = current_price * (0.05 if has_stock else 0.70)
        test_prices = np.linspace(lo, current_price * 1.50, 80)
        pnls = np.array([self._calculate_pnl_at_price(legs_obj, p, cost) for p in test_prices])

        max_p = float(np.max(pnls))
        max_l = float(np.min(pnls))

        # Check for unlimited profit at high prices
        edge_hi = self._calculate_pnl_at_price(legs_obj, current_price * 3.0,  cost)
        edge_lo = self._calculate_pnl_at_price(legs_obj, current_price * 0.01, cost)

        # Stock can only go to zero → max loss is always finite for stock strategies.
        # For pure-option strategies we still detect unlimited loss (naked short call etc).
        if edge_hi > max_p * 1.5:
            max_p = float('inf')
        if not has_stock and edge_lo < max_l * 1.5 and max_l < 0:
            max_l = float('-inf')
        elif has_stock:
            # Ensure near-zero price is captured as worst case for stock strategies
            max_l = min(max_l, edge_lo)

        # P(profit) approximation: fraction of test prices above breakeven
        pop = float(np.mean(pnls > 0))

        # Risk/reward
        if max_l not in (0.0, float('-inf')) and max_p != float('inf'):
            rr = abs(max_p / max_l) if max_l != 0 else 10.0
        else:
            rr = 10.0 if max_p == float('inf') else 0.0

        # Composite score: weight P(profit) 45%, RR 40%, cost efficiency 15%
        rr_score   = min(rr / 3.0, 1.0)
        cost_eff   = max(0.0, 1.0 - abs(cost) / max(abs(max_p) * 0.5, 0.01)) if max_p not in (0, float('inf')) else 0.5
        score      = 0.45 * pop + 0.40 * rr_score + 0.15 * cost_eff

        bkevens = self._find_breakevens(legs_obj, cost, current_price)

        return {
            "maxProfit":           round(max_p, 2) if max_p != float('inf')  else "unlimited",
            "maxLoss":             round(max_l, 2) if max_l != float('-inf') else "unlimited",
            "riskReward":          round(rr,    2),
            "probabilityOfProfit": round(pop,   3),
            "costBasis":           round(cost,  2),
            "breakevens":          [round(b, 2) for b in bkevens],
            "score":               round(score, 4),
        }

    # ────────────────────────────────────────────────────────────
    # Scan All Viable Strike Combinations
    # ────────────────────────────────────────────────────────────

    def scan_strategy_combinations(
        self,
        ticker: str,
        strategy_name: str,
        expiration: str,
        current_price: float,
        top_n: int = 8,
    ) -> Dict[str, Any]:
        """
        Scan ALL viable strike combinations for a strategy on a single expiration.

        For each combination it calculates quick analytical metrics (payoff at expiry,
        P(profit) approximation, risk/reward) and returns the top_n ranked by
        composite score.  No Monte Carlo — fast enough for Railway.
        """
        if not YF_AVAILABLE:
            return {"error": "yfinance not available"}

        try:
            calls, puts, fetched_price = self._fetch_single_expiration(ticker, expiration)
            price = current_price or fetched_price or 1.0

            # Only keep tradeable strikes (bid > 0 or lastPrice > 0)
            t_calls = [c for c in calls if c['bid'] > 0 or c['lastPrice'] > 0]
            t_puts  = [p for p in puts  if p['bid'] > 0 or p['lastPrice'] > 0]

            sn = strategy_name.lower()
            combos: List[Dict] = []

            def add(desc: str, legs_obj: List[OptionLeg]) -> None:
                if not legs_obj:
                    return
                m = self._quick_combo_metrics(legs_obj, price)
                combos.append({
                    "description": desc,
                    "legs": [asdict(l) for l in legs_obj],
                    **m,
                })

            if sn == 'bull_call_spread':
                cs = sorted(set(c['strike'] for c in t_calls))
                for i, s1 in enumerate(cs):
                    for s2 in cs[i+1:]:
                        w = s2 - s1
                        if w < price * 0.01 or w > price * 0.22: continue
                        c1 = next((c for c in t_calls if c['strike'] == s1), None)
                        c2 = next((c for c in t_calls if c['strike'] == s2), None)
                        if not c1 or not c2: continue
                        add(f"Long ${s1:.0f}C / Short ${s2:.0f}C", [
                            OptionLeg('call', s1, expiration, self._mid(c1), +1, c1['iv']),
                            OptionLeg('call', s2, expiration, self._mid(c2), -1, c2['iv']),
                        ])

            elif sn == 'bear_put_spread':
                ps = sorted(set(p['strike'] for p in t_puts))
                for i, s1 in enumerate(ps):
                    for s2 in ps[i+1:]:
                        w = s2 - s1
                        if w < price * 0.01 or w > price * 0.22: continue
                        p1 = next((p for p in t_puts if p['strike'] == s2), None)  # buy higher
                        p2 = next((p for p in t_puts if p['strike'] == s1), None)  # sell lower
                        if not p1 or not p2: continue
                        add(f"Long ${s2:.0f}P / Short ${s1:.0f}P", [
                            OptionLeg('put', s2, expiration, self._mid(p1), +1, p1['iv']),
                            OptionLeg('put', s1, expiration, self._mid(p2), -1, p2['iv']),
                        ])

            elif sn == 'covered_call':
                # Covered Call = own 100 shares at current price + sell OTM call.
                # Stock leg: strike = entry price, premium = 0 (not an option premium;
                # excludes stock purchase from cost_basis so it shows option income only).
                for c in t_calls:
                    s = c['strike']
                    if s <= price * 1.0 or s > price * 1.25: continue
                    add(f"Short ${s:.0f} Call ({(s/price-1)*100:+.1f}% OTM) + Stock", [
                        OptionLeg('stock', price, expiration, 0.0, +1, 0.0),
                        OptionLeg('call',  s,     expiration, self._mid(c), -1, c['iv']),
                    ])

            elif sn == 'protective_put':
                # Protective Put = own 100 shares + buy OTM put as insurance.
                for p in t_puts:
                    s = p['strike']
                    if s >= price * 1.0 or s < price * 0.78: continue
                    add(f"Long ${s:.0f} Put ({(s/price-1)*100:+.1f}% OTM) + Stock", [
                        OptionLeg('stock', price, expiration, 0.0, +1, 0.0),
                        OptionLeg('put',   s,     expiration, self._mid(p), +1, p['iv']),
                    ])

            elif sn == 'straddle':
                for c in t_calls:
                    s = c['strike']
                    if abs(s - price) / price > 0.07: continue
                    mp = next((p for p in t_puts if p['strike'] == s), None)
                    if not mp: continue
                    add(f"Straddle @ ${s:.0f}", [
                        OptionLeg('call', s, expiration, self._mid(c),  +1, c['iv']),
                        OptionLeg('put',  s, expiration, self._mid(mp), +1, mp['iv']),
                    ])

            elif sn == 'strangle':
                otm_calls = sorted([c for c in t_calls if c['strike'] > price * 1.01], key=lambda x: x['strike'])
                otm_puts  = sorted([p for p in t_puts  if p['strike'] < price * 0.99], key=lambda x: -x['strike'])
                for c in otm_calls[:12]:
                    for p in otm_puts[:12]:
                        cs, ps = c['strike'], p['strike']
                        if (cs - price) / price > 0.20: continue
                        if (price - ps) / price > 0.20: continue
                        add(f"Call ${cs:.0f} / Put ${ps:.0f}", [
                            OptionLeg('call', cs, expiration, self._mid(c), +1, c['iv']),
                            OptionLeg('put',  ps, expiration, self._mid(p), +1, p['iv']),
                        ])

            elif sn == 'iron_condor':
                sc_list = sorted([c for c in t_calls if c['strike'] > price], key=lambda x: x['strike'])
                lc_list = sc_list[:]
                sp_list = sorted([p for p in t_puts if p['strike'] < price], key=lambda x: -x['strike'])
                lp_list = sp_list[:]
                for sc in sc_list[:8]:
                    for lc in [c for c in lc_list if c['strike'] > sc['strike']][:4]:
                        if (lc['strike'] - sc['strike']) > price * 0.12: continue
                        for sp in sp_list[:8]:
                            for lp in [p for p in lp_list if p['strike'] < sp['strike']][:3]:
                                if (sp['strike'] - lp['strike']) > price * 0.12: continue
                                add(
                                    f"SC${sc['strike']:.0f}/LC${lc['strike']:.0f} | SP${sp['strike']:.0f}/LP${lp['strike']:.0f}",
                                    [
                                        OptionLeg('call', sc['strike'], expiration, self._mid(sc), -1, sc['iv']),
                                        OptionLeg('call', lc['strike'], expiration, self._mid(lc), +1, lc['iv']),
                                        OptionLeg('put',  sp['strike'], expiration, self._mid(sp), -1, sp['iv']),
                                        OptionLeg('put',  lp['strike'], expiration, self._mid(lp), +1, lp['iv']),
                                    ]
                                )

            elif sn == 'butterfly':
                cs = sorted(set(c['strike'] for c in t_calls))
                for i in range(len(cs) - 2):
                    for j in range(i+1, len(cs) - 1):
                        for k in range(j+1, len(cs)):
                            s1, s2, s3 = cs[i], cs[j], cs[k]
                            # Require roughly symmetric wings (within 30% of each other)
                            w1, w2 = s2 - s1, s3 - s2
                            if max(w1, w2) / max(min(w1, w2), 0.01) > 1.3: continue
                            if w1 + w2 > price * 0.22: continue
                            c1 = next((c for c in t_calls if c['strike'] == s1), None)
                            c2 = next((c for c in t_calls if c['strike'] == s2), None)
                            c3 = next((c for c in t_calls if c['strike'] == s3), None)
                            if not all([c1, c2, c3]): continue
                            add(f"${s1:.0f}/${s2:.0f}/${s3:.0f} Butterfly", [
                                OptionLeg('call', s1, expiration, self._mid(c1), +1, c1['iv']),
                                OptionLeg('call', s2, expiration, self._mid(c2), -2, c2['iv']),
                                OptionLeg('call', s3, expiration, self._mid(c3), +1, c3['iv']),
                            ])

            elif sn == 'collar':
                # Collar = own 100 shares + sell OTM call + buy OTM put.
                for sc in t_calls:
                    if sc['strike'] <= price: continue
                    for lp in t_puts:
                        if lp['strike'] >= price: continue
                        if (sc['strike'] - price) > price * 0.20: continue
                        if (price - lp['strike']) > price * 0.20: continue
                        add(f"Short ${sc['strike']:.0f}C / Long ${lp['strike']:.0f}P + Stock", [
                            OptionLeg('stock', price, expiration, 0.0, +1, 0.0),
                            OptionLeg('call', sc['strike'], expiration, self._mid(sc), -1, sc['iv']),
                            OptionLeg('put',  lp['strike'], expiration, self._mid(lp), +1, lp['iv']),
                        ])

            if not combos:
                return {"error": f"No viable combinations found for '{strategy_name}' on {expiration}.",
                        "ticker": ticker}

            # Sort by score descending, take top_n
            combos.sort(key=lambda x: x.get('score', 0), reverse=True)
            top = combos[:top_n]
            # Mark optimal
            if top:
                top[0]['optimal'] = True

            return {
                "ticker":       ticker,
                "strategy":     strategy_name,
                "expiration":   expiration,
                "currentPrice": round(price, 2),
                "total":        len(combos),
                "combinations": top,
            }

        except Exception as e:
            logger.error(f"[Scan] {strategy_name} {ticker} {expiration}: {e}")
            import traceback; traceback.print_exc()
            return {"error": str(e), "ticker": ticker}

    # ────────────────────────────────────────────────────────────
    # Auto-Build Strategy Legs + Analyze by Name
    # ────────────────────────────────────────────────────────────

    @staticmethod
    def _find_nearest_strike(strikes: list, target: float) -> float:
        """Return the strike price closest to target."""
        if not strikes:
            return target
        return min(strikes, key=lambda s: abs(s - target))

    def _build_strategy_legs(
        self,
        strategy_name: str,
        expiration: str,
        calls: list,
        puts: list,
        current_price: float,
    ) -> List[OptionLeg]:
        """Auto-select strikes and build OptionLeg list for a named strategy."""
        call_strikes = sorted([c['strike'] for c in calls]) if calls else []
        put_strikes  = sorted([p['strike'] for p in puts])  if puts  else []

        def _c(pct: float = 0.0) -> Tuple[float, float, float]:
            """Nearest call strike at current_price*(1+pct) → (strike, premium, iv)"""
            s = self._find_nearest_strike(call_strikes, current_price * (1 + pct))
            for c in calls:
                if c['strike'] == s:
                    mid = (c.get('bid', 0) + c.get('ask', 0)) / 2
                    return s, (mid or c.get('lastPrice', 0)), c.get('iv', 0.3)
            return s, 0.0, 0.3

        def _p(pct: float = 0.0) -> Tuple[float, float, float]:
            """Nearest put strike at current_price*(1+pct) → (strike, premium, iv)"""
            s = self._find_nearest_strike(put_strikes, current_price * (1 + pct))
            for p in puts:
                if p['strike'] == s:
                    mid = (p.get('bid', 0) + p.get('ask', 0)) / 2
                    return s, (mid or p.get('lastPrice', 0)), p.get('iv', 0.3)
            return s, 0.0, 0.3

        def leg(opt_type: str, info: Tuple, qty: int) -> OptionLeg:
            s, prem, iv = info
            return OptionLeg(type=opt_type, strike=s, expiration=expiration,
                             premium=prem, quantity=qty, iv=iv)

        sn = strategy_name.lower()

        if sn == 'covered_call':
            # Own 100 shares + sell OTM call
            return [
                OptionLeg('stock', current_price, expiration, 0.0, +1, 0.0),
                leg('call', _c(0.05), -1),
            ]

        if sn == 'protective_put':
            # Own 100 shares + buy OTM put
            return [
                OptionLeg('stock', current_price, expiration, 0.0, +1, 0.0),
                leg('put', _p(-0.05), 1),
            ]

        if sn == 'bull_call_spread':
            return [leg('call', _c(0.0),  1),
                    leg('call', _c(0.05), -1)]

        if sn == 'bear_put_spread':
            return [leg('put', _p(0.0),   1),
                    leg('put', _p(-0.05), -1)]

        if sn == 'iron_condor':
            return [leg('call', _c(0.05),  -1),
                    leg('call', _c(0.10),   1),
                    leg('put',  _p(-0.05), -1),
                    leg('put',  _p(-0.10),  1)]

        if sn == 'straddle':
            return [leg('call', _c(0.0), 1),
                    leg('put',  _p(0.0), 1)]

        if sn == 'strangle':
            return [leg('call', _c(0.05),  1),
                    leg('put',  _p(-0.05), 1)]

        if sn == 'butterfly':
            return [leg('call', _c(-0.05),  1),
                    leg('call', _c(0.0),   -2),
                    leg('call', _c(0.05),   1)]

        if sn == 'collar':
            # Own 100 shares + sell OTM call + buy OTM put
            return [
                OptionLeg('stock', current_price, expiration, 0.0, +1, 0.0),
                leg('call', _c(0.10),  -1),
                leg('put',  _p(-0.05),  1),
            ]

        return []

    def auto_analyze_strategy(
        self,
        ticker: str,
        strategy_name: str,
        expiration: str,
        current_price: float,
        risk_free_rate: float = 0.042,
        dividend_yield: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Fetch a single expiration from Yahoo Finance, auto-build legs for the
        named strategy, and run the full analysis.  Much faster than fetching
        the whole chain because only one HTTP request to Yahoo is needed.
        """
        if not YF_AVAILABLE:
            return {"error": "yfinance not installed on server", "ticker": ticker}

        try:
            stock = yf.Ticker(ticker)
            opt   = stock.option_chain(expiration)

            def _rows(df: Any) -> list:
                if df is None or len(df) == 0:
                    return []
                out = []
                for _, row in df.iterrows():
                    out.append({
                        "strike":   float(row.get("strike", 0)),
                        "bid":      float(row.get("bid", 0)),
                        "ask":      float(row.get("ask", 0)),
                        "lastPrice": float(row.get("lastPrice", 0)),
                        "iv":       float(row.get("impliedVolatility", 0.3)),
                    })
                return out

            calls = _rows(opt.calls)
            puts  = _rows(opt.puts)

            legs_obj = self._build_strategy_legs(
                strategy_name, expiration, calls, puts, current_price
            )

            if not legs_obj:
                return {"error": f"No legs built for strategy '{strategy_name}'. "
                                 f"Check that options data exists for {ticker} on {expiration}.",
                        "ticker": ticker}

            legs_dicts = [asdict(leg) for leg in legs_obj]
            result = self.analyze_strategy(
                ticker, legs_dicts, current_price,
                risk_free_rate, dividend_yield
            )
            # Add the strategy name to the result so the UI can display it
            if isinstance(result, dict) and not result.get('error'):
                result['name'] = strategy_name.replace('_', ' ').title()
            return result

        except Exception as e:
            logger.error(f"[AutoAnalyze] {strategy_name} {ticker} {expiration}: {e}")
            import traceback; traceback.print_exc()
            return {"error": str(e), "ticker": ticker}

    # ────────────────────────────────────────────────────────────
    # Suggest Strategies
    # ────────────────────────────────────────────────────────────

    def suggest_strategies(
        self,
        ticker: str,
        outlook: str,
        lang: str = 'en',
        budget: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """
        Suggest strategies based on market outlook.

        Parameters:
            ticker: Stock ticker
            outlook: 'bullish', 'bearish', 'neutral', 'volatile'
            budget: Optional max net debit the user is willing to pay

        Returns:
            List of strategy suggestions with name, description, legs template, and rationale.
        """
        outlook = outlook.lower().strip()
        use_es = lang.lower().startswith('es')

        strategy_map_es: Dict[str, List[Dict[str, Any]]] = {
            "bullish": [
                {"name": "Bull Call Spread", "template": "bull_call_spread",
                 "description": "Compra un call de strike bajo y vende uno de strike alto. Riesgo y recompensa limitados.",
                 "riskProfile": "definido", "idealIV": "baja-moderada",
                 "rationale": "Ganar con subida moderada del precio, reduciendo el costo con el call vendido.",
                 "maxRisk": "débito neto pagado", "maxReward": "ancho del spread menos débito neto"},
                {"name": "Covered Call", "template": "covered_call",
                 "description": "Posees 100 acciones y vendes un call OTM. Genera ingreso y limita la suba.",
                 "riskProfile": "riesgo de posición en acciones", "idealIV": "alta",
                 "rationale": "Ideal cuando eres moderadamente alcista; cobra prima para mejorar el rendimiento de acciones ya en cartera.",
                 "maxRisk": "precio acción a cero menos prima", "maxReward": "prima + (strike - precio compra)"},
                {"name": "Long Call", "template": "long_call",
                 "description": "Compra un call para exposición alcista apalancada.",
                 "riskProfile": "definido (prima pagada)", "idealIV": "baja",
                 "rationale": "Máximo apalancamiento para una convicción alcista fuerte. Riesgo limitado a la prima.",
                 "maxRisk": "prima pagada", "maxReward": "ilimitado"},
                {"name": "Collar", "template": "collar",
                 "description": "Posees acciones + compras put protector + vendes call cubierto. Limita alza y baja.",
                 "riskProfile": "definido", "idealIV": "moderada-alta",
                 "rationale": "Protege posición larga existente mientras financias parcialmente el put con la prima del call.",
                 "maxRisk": "precio acción - strike put + prima neta", "maxReward": "strike call - precio acción - prima neta"},
            ],
            "bearish": [
                {"name": "Bear Put Spread", "template": "bear_put_spread",
                 "description": "Compra un put de strike alto y vende uno de strike bajo. Riesgo y recompensa limitados.",
                 "riskProfile": "definido", "idealIV": "baja-moderada",
                 "rationale": "Ganar con caída moderada del precio, reduciendo el costo con el put vendido.",
                 "maxRisk": "débito neto pagado", "maxReward": "ancho del spread menos débito neto"},
                {"name": "Protective Put", "template": "protective_put",
                 "description": "Posees acciones + compras un put como seguro contra caídas.",
                 "riskProfile": "baja definida", "idealIV": "baja (puts baratos)",
                 "rationale": "Cubre una posición larga contra caídas manteniendo la suba ilimitada.",
                 "maxRisk": "precio acción - strike put + prima pagada", "maxReward": "suba ilimitada menos prima"},
                {"name": "Long Put", "template": "long_put",
                 "description": "Compra un put para exposición bajista apalancada.",
                 "riskProfile": "definido (prima pagada)", "idealIV": "baja",
                 "rationale": "Máximo apalancamiento bajista. Riesgo limitado a la prima.",
                 "maxRisk": "prima pagada", "maxReward": "strike - prima (acción a cero)"},
            ],
            "neutral": [
                {"name": "Iron Condor", "template": "iron_condor",
                 "description": "Vende spread de call OTM + vende spread de put OTM. Gana con precio en rango.",
                 "riskProfile": "definido", "idealIV": "alta (vender prima)",
                 "rationale": "Cobrar prima de ambos lados cuando se espera baja volatilidad y precio en rango.",
                 "maxRisk": "ancho del spread mayor menos crédito neto", "maxReward": "crédito neto recibido"},
                {"name": "Butterfly Spread", "template": "butterfly",
                 "description": "Compra 1 call bajo + vende 2 calls medios + compra 1 call alto. Máximo en el strike central.",
                 "riskProfile": "definido", "idealIV": "alta",
                 "rationale": "Máxima ganancia si el precio termina exactamente en el strike central al vencimiento.",
                 "maxRisk": "débito neto pagado", "maxReward": "ancho del spread menos débito neto"},
                {"name": "Short Straddle", "template": "short_straddle",
                 "description": "Vende call ATM + vende put ATM. Crédito máximo, riesgo gamma alto.",
                 "riskProfile": "indefinido", "idealIV": "muy alta",
                 "rationale": "Ideal cuando la IV está elevada y se espera compresión. Requiere gestión activa.",
                 "maxRisk": "ilimitado", "maxReward": "prima total recibida"},
            ],
            "volatile": [
                {"name": "Long Straddle", "template": "straddle",
                 "description": "Compra call ATM + put ATM. Gana con un movimiento grande en cualquier dirección.",
                 "riskProfile": "definido (prima total)", "idealIV": "baja",
                 "rationale": "Ganar con un movimiento grande sin importar la dirección. Ideal antes de earnings.",
                 "maxRisk": "prima total pagada", "maxReward": "ilimitado"},
                {"name": "Long Strangle", "template": "strangle",
                 "description": "Compra call OTM + put OTM. Más barato que el straddle pero requiere mayor movimiento.",
                 "riskProfile": "definido (prima total)", "idealIV": "baja",
                 "rationale": "Menor costo que el straddle pero necesita un movimiento de precio mayor para ganar.",
                 "maxRisk": "prima total pagada", "maxReward": "ilimitado"},
                {"name": "Reverse Iron Condor", "template": "reverse_iron_condor",
                 "description": "Compra spread de call OTM + spread de put OTM. Riesgo definido en volatilidad.",
                 "riskProfile": "definido", "idealIV": "baja",
                 "rationale": "Ganar con un movimiento grande en cualquier dirección con riesgo acotado.",
                 "maxRisk": "débito neto pagado", "maxReward": "ancho del spread menos débito neto"},
            ],
        }

        strategy_map: Dict[str, List[Dict[str, Any]]] = {
            "bullish": [
                {
                    "name": "Bull Call Spread",
                    "template": "bull_call_spread",
                    "description": "Buy a lower-strike call, sell a higher-strike call. Limited risk, limited reward.",
                    "riskProfile": "defined",
                    "idealIV": "low-to-moderate",
                    "rationale": "Profit from moderate upside while capping cost with the short call.",
                    "maxRisk": "net debit paid",
                    "maxReward": "spread width minus net debit",
                },
                {
                    "name": "Covered Call",
                    "template": "covered_call",
                    "description": "Own 100 shares + sell an OTM call. Generates income, caps upside.",
                    "riskProfile": "stock ownership risk",
                    "idealIV": "high",
                    "rationale": "Best when mildly bullish; collect premium to enhance yield on shares you already own.",
                    "maxRisk": "stock price to zero minus premium received",
                    "maxReward": "premium + (strike - purchase price)",
                },
                {
                    "name": "Long Call",
                    "template": "long_call",
                    "description": "Buy a call option for leveraged upside exposure.",
                    "riskProfile": "defined (premium paid)",
                    "idealIV": "low",
                    "rationale": "Maximum leverage for a strong bullish conviction. Risk limited to premium.",
                    "maxRisk": "premium paid",
                    "maxReward": "unlimited",
                },
                {
                    "name": "Collar",
                    "template": "collar",
                    "description": "Own shares + buy protective put + sell covered call. Limits both downside and upside.",
                    "riskProfile": "defined",
                    "idealIV": "moderate-to-high",
                    "rationale": "Protect existing long position while partially funding the put with call premium.",
                    "maxRisk": "stock price - put strike + net premium",
                    "maxReward": "call strike - stock price - net premium",
                },
            ],
            "bearish": [
                {
                    "name": "Bear Put Spread",
                    "template": "bear_put_spread",
                    "description": "Buy a higher-strike put, sell a lower-strike put. Limited risk, limited reward.",
                    "riskProfile": "defined",
                    "idealIV": "low-to-moderate",
                    "rationale": "Profit from moderate downside while capping cost with the short put.",
                    "maxRisk": "net debit paid",
                    "maxReward": "spread width minus net debit",
                },
                {
                    "name": "Protective Put",
                    "template": "protective_put",
                    "description": "Own shares + buy a put as insurance against downside.",
                    "riskProfile": "defined downside",
                    "idealIV": "low (cheaper puts)",
                    "rationale": "Hedge an existing long position against a drop while keeping unlimited upside.",
                    "maxRisk": "stock price - put strike + premium paid",
                    "maxReward": "unlimited upside minus premium",
                },
                {
                    "name": "Long Put",
                    "template": "long_put",
                    "description": "Buy a put option for leveraged downside exposure.",
                    "riskProfile": "defined (premium paid)",
                    "idealIV": "low",
                    "rationale": "Maximum leverage for a bearish conviction. Risk limited to premium.",
                    "maxRisk": "premium paid",
                    "maxReward": "strike - premium (stock to zero)",
                },
            ],
            "neutral": [
                {
                    "name": "Iron Condor",
                    "template": "iron_condor",
                    "description": "Sell OTM call spread + sell OTM put spread. Profit from range-bound movement.",
                    "riskProfile": "defined",
                    "idealIV": "high (sell premium)",
                    "rationale": "Collect premium from both sides when expecting low volatility and range-bound price.",
                    "maxRisk": "wider spread width minus net credit",
                    "maxReward": "net credit received",
                },
                {
                    "name": "Butterfly Spread",
                    "template": "butterfly",
                    "description": "Buy 1 lower call + sell 2 middle calls + buy 1 higher call. Profit at the center strike.",
                    "riskProfile": "defined",
                    "idealIV": "high (sell middle strikes)",
                    "rationale": "Maximum profit if stock pins at center strike at expiration. Very low cost.",
                    "maxRisk": "net debit paid",
                    "maxReward": "spread width minus net debit",
                },
                {
                    "name": "Short Straddle",
                    "template": "short_straddle",
                    "description": "Sell ATM call + sell ATM put. Maximum credit, maximum gamma risk.",
                    "riskProfile": "undefined",
                    "idealIV": "very high",
                    "rationale": "Best when IV is elevated and you expect it to crush. Requires active management.",
                    "maxRisk": "unlimited",
                    "maxReward": "total premium received",
                },
            ],
            "volatile": [
                {
                    "name": "Long Straddle",
                    "template": "straddle",
                    "description": "Buy ATM call + ATM put. Profit from large move in either direction.",
                    "riskProfile": "defined (total premium)",
                    "idealIV": "low (buy cheap options)",
                    "rationale": "Profit from a big move regardless of direction. Ideal before earnings or catalysts.",
                    "maxRisk": "total premium paid",
                    "maxReward": "unlimited",
                },
                {
                    "name": "Long Strangle",
                    "template": "strangle",
                    "description": "Buy OTM call + OTM put. Cheaper than straddle but needs bigger move.",
                    "riskProfile": "defined (total premium)",
                    "idealIV": "low",
                    "rationale": "Lower cost than straddle, but requires a larger price move to profit.",
                    "maxRisk": "total premium paid",
                    "maxReward": "unlimited",
                },
                {
                    "name": "Reverse Iron Condor",
                    "template": "reverse_iron_condor",
                    "description": "Buy OTM call spread + buy OTM put spread. Defined-risk volatility play.",
                    "riskProfile": "defined",
                    "idealIV": "low",
                    "rationale": "Profit from a large move in either direction with capped risk.",
                    "maxRisk": "net debit paid",
                    "maxReward": "spread width minus net debit",
                },
            ],
        }

        active_map = strategy_map_es if use_es else strategy_map
        suggestions = active_map.get(outlook, [])

        if not suggestions:
            msg = (f"Perspectiva '{outlook}' desconocida. Usa: bullish, bearish, neutral, volatile."
                   if use_es else
                   f"Unknown outlook '{outlook}'. Use: bullish, bearish, neutral, volatile.")
            return [{"error": msg}]

        # Fetch expirations + price quickly (no stock.info — it's too slow)
        context: Dict[str, Any] = {"ticker": ticker, "outlook": outlook}
        if YF_AVAILABLE:
            try:
                stock = yf.Ticker(ticker)
                # fast_info is non-blocking and much faster than stock.info
                try:
                    current_price = float(
                        stock.fast_info.get('last_price')
                        or stock.fast_info.get('lastPrice')
                        or 0
                    )
                except Exception:
                    current_price = 0.0
                if not current_price:
                    try:
                        hist = stock.history(period="1d")
                        current_price = float(hist['Close'].iloc[-1]) if len(hist) > 0 else 0.0
                    except Exception:
                        pass
                context["currentPrice"] = current_price
                exps = list(stock.options) if stock.options else []
                context["nearestExpiration"] = exps[0] if exps else None
                context["availableExpirations"] = exps[:6]
            except Exception:
                pass

        # Add context to each suggestion
        for s in suggestions:
            s["ticker"] = ticker
            s["outlook"] = outlook
            if "currentPrice" in context:
                s["currentPrice"] = context["currentPrice"]
            if "nearestExpiration" in context:
                s["nearestExpiration"] = context.get("nearestExpiration")
            if "availableExpirations" in context:
                s["availableExpirations"] = context.get("availableExpirations")

        return suggestions

    # ────────────────────────────────────────────────────────────
    # Build Predefined Strategy
    # ────────────────────────────────────────────────────────────

    def build_predefined_strategy(
        self,
        strategy_name: str,
        ticker: str,
        expiration: str,
        **kwargs,
    ) -> List[OptionLeg]:
        """
        Build legs for a predefined strategy using live chain data.

        Parameters:
            strategy_name: One of STRATEGY_TEMPLATES
            ticker: Stock ticker
            expiration: Expiration date (YYYY-MM-DD)
            **kwargs: Strategy-specific parameters (e.g. width for spreads)

        Returns:
            List of OptionLeg dataclass instances.
        """
        if not YF_AVAILABLE:
            raise ValueError("yfinance is required to build predefined strategies")

        stock = yf.Ticker(ticker)
        info = stock.info or {}
        S = info.get('currentPrice') or info.get('regularMarketPrice', 0)
        if not S:
            hist = stock.history(period="1d")
            S = float(hist['Close'].iloc[-1]) if len(hist) > 0 else 0

        if S <= 0:
            raise ValueError(f"Cannot determine current price for {ticker}")

        opt = stock.option_chain(expiration)
        calls_df = opt.calls
        puts_df = opt.puts

        width = kwargs.get('width', None)
        # Default spread width: ~5% of stock price, rounded to nearest available strike
        if width is None:
            width = max(1.0, round(S * 0.05, 0))

        strategy_name = strategy_name.lower().replace(' ', '_').replace('-', '_')

        if strategy_name == 'covered_call':
            return self._build_covered_call(S, calls_df, expiration, **kwargs)
        elif strategy_name == 'protective_put':
            return self._build_protective_put(S, puts_df, expiration, **kwargs)
        elif strategy_name == 'bull_call_spread':
            return self._build_bull_call_spread(S, calls_df, expiration, width, **kwargs)
        elif strategy_name == 'bear_put_spread':
            return self._build_bear_put_spread(S, puts_df, expiration, width, **kwargs)
        elif strategy_name == 'iron_condor':
            return self._build_iron_condor(S, calls_df, puts_df, expiration, width, **kwargs)
        elif strategy_name == 'straddle':
            return self._build_straddle(S, calls_df, puts_df, expiration, **kwargs)
        elif strategy_name == 'strangle':
            return self._build_strangle(S, calls_df, puts_df, expiration, width, **kwargs)
        elif strategy_name == 'butterfly':
            return self._build_butterfly(S, calls_df, expiration, width, **kwargs)
        elif strategy_name == 'collar':
            return self._build_collar(S, calls_df, puts_df, expiration, width, **kwargs)
        else:
            raise ValueError(f"Unknown strategy: {strategy_name}. Available: {self.STRATEGY_TEMPLATES}")

    # ────────────────────────────────────────────────────────────
    # IV Surface
    # ────────────────────────────────────────────────────────────

    def iv_surface(self, ticker: str) -> Dict[str, Any]:
        """
        Build IV surface data for 3D visualization.

        Returns:
            {
              ticker: str,
              strikes: [float, ...],
              expirations: [str, ...],
              daysToExpiry: [int, ...],
              callIV: [[float, ...], ...],   # [expiration_idx][strike_idx]
              putIV: [[float, ...], ...],
            }
        """
        if not YF_AVAILABLE:
            return {"error": "yfinance not installed on server", "ticker": ticker}

        try:
            stock = yf.Ticker(ticker)
            expirations = list(stock.options)

            if not expirations:
                return {"error": f"No options data for {ticker}", "ticker": ticker}

            info = stock.info or {}
            S = info.get('currentPrice') or info.get('regularMarketPrice', 0)
            if not S:
                hist = stock.history(period="1d")
                S = float(hist['Close'].iloc[-1]) if len(hist) > 0 else 0

            # Limit to first 8 expirations for manageable data
            expirations = expirations[:8]

            # Collect all unique strikes across expirations
            all_strikes = set()
            chain_data: Dict[str, Any] = {}

            for exp_date in expirations:
                try:
                    opt = stock.option_chain(exp_date)
                    call_strikes = set(opt.calls['strike'].tolist()) if len(opt.calls) > 0 else set()
                    put_strikes = set(opt.puts['strike'].tolist()) if len(opt.puts) > 0 else set()
                    all_strikes.update(call_strikes)
                    all_strikes.update(put_strikes)
                    chain_data[exp_date] = opt
                except Exception:
                    continue

            if not all_strikes:
                return {"error": f"No strike data for {ticker}", "ticker": ticker}

            # Filter strikes to reasonable range around current price (50% to 150%)
            strike_low = S * 0.50
            strike_high = S * 1.50
            strikes = sorted([k for k in all_strikes if strike_low <= k <= strike_high])

            if len(strikes) > 50:
                # Subsample to keep it manageable
                step = max(1, len(strikes) // 50)
                strikes = strikes[::step]

            # Build IV matrices
            now = datetime.now()
            days_to_expiry = []
            call_iv_matrix: List[List[float]] = []
            put_iv_matrix: List[List[float]] = []

            for exp_date in expirations:
                if exp_date not in chain_data:
                    continue

                exp_dt = datetime.strptime(exp_date, "%Y-%m-%d")
                dte = max((exp_dt - now).days, 1)
                days_to_expiry.append(dte)

                opt = chain_data[exp_date]

                # Build strike->IV lookup for calls
                call_iv_lookup: Dict[float, float] = {}
                if opt.calls is not None and len(opt.calls) > 0:
                    for _, row in opt.calls.iterrows():
                        call_iv_lookup[float(row['strike'])] = float(row.get('impliedVolatility', 0))

                put_iv_lookup: Dict[float, float] = {}
                if opt.puts is not None and len(opt.puts) > 0:
                    for _, row in opt.puts.iterrows():
                        put_iv_lookup[float(row['strike'])] = float(row.get('impliedVolatility', 0))

                call_row = []
                put_row = []
                for k in strikes:
                    call_row.append(round(call_iv_lookup.get(k, 0.0), 4))
                    put_row.append(round(put_iv_lookup.get(k, 0.0), 4))

                call_iv_matrix.append(call_row)
                put_iv_matrix.append(put_row)

            return {
                "ticker": ticker,
                "currentPrice": S,
                "strikes": strikes,
                "expirations": [e for e in expirations if e in chain_data],
                "daysToExpiry": days_to_expiry,
                "callIV": call_iv_matrix,
                "putIV": put_iv_matrix,
            }

        except Exception as e:
            logger.error(f"Error building IV surface for {ticker}: {e}")
            return {"error": str(e), "ticker": ticker}

    # ════════════════════════════════════════════════════════════════════
    # Internal Helpers
    # ════════════════════════════════════════════════════════════════════

    def _years_to_expiry(self, expiration: str) -> float:
        """Convert expiration date string to years from now."""
        try:
            exp_dt = datetime.strptime(expiration, "%Y-%m-%d")
            delta = (exp_dt - datetime.now()).total_seconds()
            return max(delta / (365.25 * 86400), 1e-6)
        except Exception:
            return 30 / 365.25  # Default 30 days

    def _calculate_pnl_at_price(self, legs: List[OptionLeg], price: float,
                                cost_basis: float) -> float:
        """
        Calculate total P/L at a given underlying price at expiration.

        For each leg:
          - Stock:  P/L = (exit_price - entry_price) * quantity
                    where leg.strike = entry price, premium = 0 (not an option)
          - Call:   intrinsic = max(price - strike, 0)
          - Put:    intrinsic = max(strike - price, 0)
          - Leg P/L = (intrinsic - premium) * quantity
            where quantity > 0 means long, quantity < 0 means short (write).
        """
        total_pnl = 0.0
        for leg in legs:
            if leg.type == 'stock':
                # Long/short stock position: P&L per share = (exit - entry)
                # leg.strike holds the entry/purchase price per share
                leg_pnl = (price - leg.strike) * leg.quantity
            elif leg.type == 'call':
                intrinsic = max(price - leg.strike, 0.0)
                leg_pnl = (intrinsic - leg.premium) * leg.quantity
            else:  # put
                intrinsic = max(leg.strike - price, 0.0)
                leg_pnl = (intrinsic - leg.premium) * leg.quantity
            total_pnl += leg_pnl

        return total_pnl

    def _find_breakevens(self, legs: List[OptionLeg], cost_basis: float,
                         current_price: float) -> List[float]:
        """
        Find breakeven points by scanning for sign changes in the payoff.
        """
        price_low = current_price * 0.01
        price_high = current_price * 3.0
        prices = np.linspace(price_low, price_high, 5000)
        pnls = np.array([self._calculate_pnl_at_price(legs, p, cost_basis) for p in prices])

        breakevens = []
        for i in range(1, len(pnls)):
            if pnls[i - 1] * pnls[i] < 0:
                # Linear interpolation between sign-change points
                p1, p2 = prices[i - 1], prices[i]
                v1, v2 = pnls[i - 1], pnls[i]
                be = p1 + (p2 - p1) * (-v1) / (v2 - v1)
                breakevens.append(float(be))

        return breakevens

    def _aggregate_greeks(self, legs: List[OptionLeg], current_price: float,
                          risk_free_rate: float, dividend_yield: float) -> Greeks:
        """Sum Greeks across all legs (quantity-weighted)."""
        agg = Greeks(delta=0, gamma=0, theta=0, vega=0, rho=0)

        for leg in legs:
            if leg.type == 'stock':
                # Stock delta = 1 per share (per unit of quantity); gamma/theta/vega/rho = 0
                agg.delta += float(leg.quantity)
                continue
            T = self._years_to_expiry(leg.expiration)
            iv = leg.iv if leg.iv > 0 else 0.3
            g = self.bs.greeks(current_price, leg.strike, T, risk_free_rate, iv,
                               leg.type, dividend_yield)
            agg.delta += g.delta * leg.quantity
            agg.gamma += g.gamma * leg.quantity
            agg.theta += g.theta * leg.quantity
            agg.vega += g.vega * leg.quantity
            agg.rho += g.rho * leg.quantity

        return Greeks(
            delta=round(agg.delta, 4),
            gamma=round(agg.gamma, 6),
            theta=round(agg.theta, 4),
            vega=round(agg.vega, 4),
            rho=round(agg.rho, 4),
        )

    def _probability_of_profit(self, legs: List[OptionLeg], current_price: float,
                                cost_basis: float, risk_free_rate: float,
                                dividend_yield: float) -> float:
        """
        Estimate probability of profit using lognormal distribution.

        Assumes stock follows GBM: S_T = S_0 * exp((mu - sigma^2/2)*T + sigma*sqrt(T)*Z)
        where Z ~ N(0,1).

        We compute PnL at 10,000 simulated terminal prices and count profitable outcomes.
        """
        # Use average IV across legs as volatility estimate
        ivs = [leg.iv for leg in legs if leg.iv > 0]
        sigma = np.mean(ivs) if ivs else 0.3

        # Use the earliest expiration for time horizon
        T_values = [self._years_to_expiry(leg.expiration) for leg in legs]
        T = min(T_values) if T_values else 30 / 365.25

        # Risk-neutral drift
        mu = risk_free_rate - dividend_yield

        # Monte Carlo: 10,000 terminal prices
        np.random.seed(42)
        Z = np.random.standard_normal(10000)
        S_T = current_price * np.exp((mu - 0.5 * sigma ** 2) * T + sigma * sqrt(T) * Z)

        profitable = 0
        for s in S_T:
            pnl = self._calculate_pnl_at_price(legs, float(s), cost_basis)
            if pnl > 0:
                profitable += 1

        return profitable / len(S_T)

    # ────────────────────────────────────────────────────────────
    # Predefined Strategy Builders
    # ────────────────────────────────────────────────────────────

    def _nearest_strike(self, df, target: float) -> float:
        """Find the strike in a DataFrame nearest to target."""
        strikes = df['strike'].values
        idx = np.argmin(np.abs(strikes - target))
        return float(strikes[idx])

    def _get_option_data(self, df, strike: float) -> Dict[str, float]:
        """Get premium and IV for a given strike from the chain DataFrame."""
        row = df[df['strike'] == strike]
        if len(row) == 0:
            return {"premium": 0, "iv": 0.3}
        row = row.iloc[0]
        # Use mid price if available, else last price
        bid = float(row.get('bid', 0) or 0)
        ask = float(row.get('ask', 0) or 0)
        mid = (bid + ask) / 2 if bid > 0 and ask > 0 else float(row.get('lastPrice', 0) or 0)
        iv = float(row.get('impliedVolatility', 0.3) or 0.3)
        return {"premium": mid, "iv": iv}

    def _build_covered_call(self, S, calls_df, expiration, **kwargs):
        """Long 100 shares (simulated as stock leg) + short 1 OTM call."""
        otm_target = S * 1.05  # ~5% OTM
        strike = self._nearest_strike(calls_df, otm_target)
        data = self._get_option_data(calls_df, strike)

        return [
            OptionLeg(type='call', strike=0.01, expiration=expiration,
                      premium=S, quantity=1, iv=0.0),  # Synthetic stock as deep ITM call
            OptionLeg(type='call', strike=strike, expiration=expiration,
                      premium=data['premium'], quantity=-1, iv=data['iv']),
        ]

    def _build_protective_put(self, S, puts_df, expiration, **kwargs):
        """Long 100 shares + long 1 OTM put."""
        otm_target = S * 0.95  # ~5% OTM
        strike = self._nearest_strike(puts_df, otm_target)
        data = self._get_option_data(puts_df, strike)

        return [
            OptionLeg(type='call', strike=0.01, expiration=expiration,
                      premium=S, quantity=1, iv=0.0),  # Synthetic stock
            OptionLeg(type='put', strike=strike, expiration=expiration,
                      premium=data['premium'], quantity=1, iv=data['iv']),
        ]

    def _build_bull_call_spread(self, S, calls_df, expiration, width, **kwargs):
        """Buy lower-strike call, sell higher-strike call."""
        lower_strike = self._nearest_strike(calls_df, S)
        upper_strike = self._nearest_strike(calls_df, S + width)
        if lower_strike >= upper_strike:
            upper_strike = self._nearest_strike(calls_df, lower_strike + 1)

        lower_data = self._get_option_data(calls_df, lower_strike)
        upper_data = self._get_option_data(calls_df, upper_strike)

        return [
            OptionLeg(type='call', strike=lower_strike, expiration=expiration,
                      premium=lower_data['premium'], quantity=1, iv=lower_data['iv']),
            OptionLeg(type='call', strike=upper_strike, expiration=expiration,
                      premium=upper_data['premium'], quantity=-1, iv=upper_data['iv']),
        ]

    def _build_bear_put_spread(self, S, puts_df, expiration, width, **kwargs):
        """Buy higher-strike put, sell lower-strike put."""
        upper_strike = self._nearest_strike(puts_df, S)
        lower_strike = self._nearest_strike(puts_df, S - width)
        if lower_strike >= upper_strike:
            lower_strike = self._nearest_strike(puts_df, upper_strike - 1)

        upper_data = self._get_option_data(puts_df, upper_strike)
        lower_data = self._get_option_data(puts_df, lower_strike)

        return [
            OptionLeg(type='put', strike=upper_strike, expiration=expiration,
                      premium=upper_data['premium'], quantity=1, iv=upper_data['iv']),
            OptionLeg(type='put', strike=lower_strike, expiration=expiration,
                      premium=lower_data['premium'], quantity=-1, iv=lower_data['iv']),
        ]

    def _build_iron_condor(self, S, calls_df, puts_df, expiration, width, **kwargs):
        """Sell OTM call spread + sell OTM put spread."""
        inner_width = width
        outer_width = kwargs.get('outer_width', width)

        # Call side (above current price)
        short_call = self._nearest_strike(calls_df, S + inner_width)
        long_call = self._nearest_strike(calls_df, short_call + outer_width)

        # Put side (below current price)
        short_put = self._nearest_strike(puts_df, S - inner_width)
        long_put = self._nearest_strike(puts_df, short_put - outer_width)

        sc_data = self._get_option_data(calls_df, short_call)
        lc_data = self._get_option_data(calls_df, long_call)
        sp_data = self._get_option_data(puts_df, short_put)
        lp_data = self._get_option_data(puts_df, long_put)

        return [
            OptionLeg(type='put', strike=long_put, expiration=expiration,
                      premium=lp_data['premium'], quantity=1, iv=lp_data['iv']),
            OptionLeg(type='put', strike=short_put, expiration=expiration,
                      premium=sp_data['premium'], quantity=-1, iv=sp_data['iv']),
            OptionLeg(type='call', strike=short_call, expiration=expiration,
                      premium=sc_data['premium'], quantity=-1, iv=sc_data['iv']),
            OptionLeg(type='call', strike=long_call, expiration=expiration,
                      premium=lc_data['premium'], quantity=1, iv=lc_data['iv']),
        ]

    def _build_straddle(self, S, calls_df, puts_df, expiration, **kwargs):
        """Buy ATM call + ATM put."""
        atm_strike = self._nearest_strike(calls_df, S)
        call_data = self._get_option_data(calls_df, atm_strike)

        put_strike = self._nearest_strike(puts_df, S)
        put_data = self._get_option_data(puts_df, put_strike)

        return [
            OptionLeg(type='call', strike=atm_strike, expiration=expiration,
                      premium=call_data['premium'], quantity=1, iv=call_data['iv']),
            OptionLeg(type='put', strike=put_strike, expiration=expiration,
                      premium=put_data['premium'], quantity=1, iv=put_data['iv']),
        ]

    def _build_strangle(self, S, calls_df, puts_df, expiration, width, **kwargs):
        """Buy OTM call + OTM put."""
        call_strike = self._nearest_strike(calls_df, S + width)
        put_strike = self._nearest_strike(puts_df, S - width)

        call_data = self._get_option_data(calls_df, call_strike)
        put_data = self._get_option_data(puts_df, put_strike)

        return [
            OptionLeg(type='call', strike=call_strike, expiration=expiration,
                      premium=call_data['premium'], quantity=1, iv=call_data['iv']),
            OptionLeg(type='put', strike=put_strike, expiration=expiration,
                      premium=put_data['premium'], quantity=1, iv=put_data['iv']),
        ]

    def _build_butterfly(self, S, calls_df, expiration, width, **kwargs):
        """Buy 1 lower call + sell 2 middle calls + buy 1 higher call."""
        middle = self._nearest_strike(calls_df, S)
        lower = self._nearest_strike(calls_df, middle - width)
        upper = self._nearest_strike(calls_df, middle + width)

        lower_data = self._get_option_data(calls_df, lower)
        middle_data = self._get_option_data(calls_df, middle)
        upper_data = self._get_option_data(calls_df, upper)

        return [
            OptionLeg(type='call', strike=lower, expiration=expiration,
                      premium=lower_data['premium'], quantity=1, iv=lower_data['iv']),
            OptionLeg(type='call', strike=middle, expiration=expiration,
                      premium=middle_data['premium'], quantity=-2, iv=middle_data['iv']),
            OptionLeg(type='call', strike=upper, expiration=expiration,
                      premium=upper_data['premium'], quantity=1, iv=upper_data['iv']),
        ]

    def _build_collar(self, S, calls_df, puts_df, expiration, width, **kwargs):
        """Long stock + buy OTM put + sell OTM call."""
        put_strike = self._nearest_strike(puts_df, S - width)
        call_strike = self._nearest_strike(calls_df, S + width)

        put_data = self._get_option_data(puts_df, put_strike)
        call_data = self._get_option_data(calls_df, call_strike)

        return [
            OptionLeg(type='call', strike=0.01, expiration=expiration,
                      premium=S, quantity=1, iv=0.0),  # Synthetic stock
            OptionLeg(type='put', strike=put_strike, expiration=expiration,
                      premium=put_data['premium'], quantity=1, iv=put_data['iv']),
            OptionLeg(type='call', strike=call_strike, expiration=expiration,
                      premium=call_data['premium'], quantity=-1, iv=call_data['iv']),
        ]


# ════════════════════════════════════════════════════════════════════
# Utility
# ════════════════════════════════════════════════════════════════════

def _is_nan(value) -> bool:
    """Check if a value is NaN (works for float, numpy, and None)."""
    if value is None:
        return True
    try:
        return np.isnan(value)
    except (TypeError, ValueError):
        return False


# ════════════════════════════════════════════════════════════════════
# Module-level singleton & convenience functions
# ════════════════════════════════════════════════════════════════════

options_simulator = OptionsStrategySimulator()


def fetch_options_chain(ticker: str) -> Dict[str, Any]:
    """Fetch full options chain for a ticker."""
    return options_simulator.fetch_chain(ticker)


def analyze_options_strategy(ticker: str, legs: List[Dict], current_price: float,
                             **kwargs) -> Dict[str, Any]:
    """Analyze a multi-leg options strategy."""
    return options_simulator.analyze_strategy(ticker, legs, current_price, **kwargs)


def auto_analyze_options_strategy(
    ticker: str, strategy_name: str, expiration: str, current_price: float, **kwargs
) -> Dict[str, Any]:
    """Auto-build legs from a strategy name and single expiration, then analyze."""
    return options_simulator.auto_analyze_strategy(
        ticker, strategy_name, expiration, current_price, **kwargs
    )


def suggest_options_strategies(ticker: str, outlook: str, lang: str = 'en', **kwargs) -> List[Dict]:
    """Suggest strategies based on market outlook."""
    return options_simulator.suggest_strategies(ticker, outlook, lang=lang, **kwargs)


def get_iv_surface(ticker: str) -> Dict[str, Any]:
    """Build IV surface data for 3D visualization."""
    return options_simulator.iv_surface(ticker)


def scan_options_combinations(
    ticker: str, strategy_name: str, expiration: str,
    current_price: float, top_n: int = 8
) -> Dict[str, Any]:
    """Scan all viable strike combos for a strategy, return top_n by score."""
    return options_simulator.scan_strategy_combinations(
        ticker, strategy_name, expiration, current_price, top_n
    )
