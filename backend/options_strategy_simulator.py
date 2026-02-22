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

            if edge_pnl_high > max_profit * 1.5:
                max_profit = float('inf')
            if edge_pnl_low < max_loss * 1.5 and max_loss < 0:
                max_loss = float('-inf')

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
            return [leg('call', _c(0.05), -1)]

        if sn == 'protective_put':
            return [leg('put', _p(-0.05), 1)]

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
            return [leg('call', _c(0.10),  -1),
                    leg('put',  _p(-0.05),  1)]

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

        suggestions = strategy_map.get(outlook, [])

        if not suggestions:
            return [{
                "error": f"Unknown outlook '{outlook}'. Use: bullish, bearish, neutral, volatile."
            }]

        # Try to fetch current price and nearest expiration for context
        context: Dict[str, Any] = {"ticker": ticker, "outlook": outlook}
        if YF_AVAILABLE:
            try:
                stock = yf.Ticker(ticker)
                info = stock.info or {}
                current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
                if not current_price:
                    hist = stock.history(period="1d")
                    current_price = float(hist['Close'].iloc[-1]) if len(hist) > 0 else 0
                context["currentPrice"] = current_price
                exps = list(stock.options) if stock.options else []
                context["nearestExpiration"] = exps[0] if exps else None
                context["availableExpirations"] = exps[:6]  # first 6
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
          - Call intrinsic = max(price - strike, 0)
          - Put  intrinsic = max(strike - price, 0)
          - Leg P/L = (intrinsic - premium) * quantity
            where quantity > 0 means long, quantity < 0 means short.
        """
        total_pnl = 0.0
        for leg in legs:
            if leg.type == 'call':
                intrinsic = max(price - leg.strike, 0.0)
            else:
                intrinsic = max(leg.strike - price, 0.0)

            # quantity positive = buy (pay premium), negative = sell (receive premium)
            # P/L = (intrinsic * |qty| - premium * |qty|) * sign(qty)
            # Simplified: (intrinsic - premium) * quantity
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


def suggest_options_strategies(ticker: str, outlook: str, **kwargs) -> List[Dict]:
    """Suggest strategies based on market outlook."""
    return options_simulator.suggest_strategies(ticker, outlook, **kwargs)


def get_iv_surface(ticker: str) -> Dict[str, Any]:
    """Build IV surface data for 3D visualization."""
    return options_simulator.iv_surface(ticker)
