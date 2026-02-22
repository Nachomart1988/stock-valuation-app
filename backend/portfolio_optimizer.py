# backend/portfolio_optimizer.py
# Advanced Portfolio Optimizer — Markowitz Mean-Variance + Monte Carlo + Risk Analytics

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from scipy.optimize import minimize
from scipy import stats

logger = logging.getLogger(__name__)

TRADING_DAYS = 252


class PortfolioOptimizer:
    """
    Multi-asset portfolio optimizer using:
    - Markowitz mean-variance optimization (scipy.optimize)
    - Efficient frontier calculation (25 points)
    - Monte Carlo simulation (5000 random portfolios)
    - Risk analytics: VaR, CVaR, max drawdown, Sortino, Calmar
    """

    def __init__(self, api_key: Optional[str] = None, risk_free_rate: float = 0.042):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.risk_free_rate = risk_free_rate
        self._session = requests.Session()

    # ────────────────────────────────────────────────────────────────
    # PUBLIC: main optimize method
    # ────────────────────────────────────────────────────────────────

    def optimize(
        self,
        tickers: List[str],
        objective: str = 'max_sharpe',
        period_days: int = 756,
        max_weight: float = 0.40,
        min_weight: float = 0.0,
        target_return: Optional[float] = None,
        monte_carlo_sims: int = 5000,
    ) -> Dict[str, Any]:
        """
        Main optimization entry point.

        Parameters
        ----------
        tickers : list of str
            Ticker symbols (2+).
        objective : str
            One of 'max_sharpe', 'min_variance', 'max_return', 'risk_parity'.
        period_days : int
            Look-back window in calendar days (default 756 ~ 3 years).
        max_weight : float
            Maximum weight per asset (0-1, default 0.40).
        min_weight : float
            Minimum weight per asset (default 0.0 — no short selling).
        target_return : float or None
            If provided, optimize for min variance at this target annual return.
        monte_carlo_sims : int
            Number of random portfolios for the MC cloud.

        Returns
        -------
        dict with keys:
            optimalWeights, efficientFrontier, monteCarloCloud,
            riskMetrics, correlationMatrix, covarianceMatrix,
            individualStats, backtest
        """
        if len(tickers) < 2:
            raise ValueError("Need at least 2 tickers for portfolio optimization")

        logger.info(f"[PortfolioOpt] Starting {objective} optimization for {tickers}")

        # 1. Fetch prices
        prices = self._fetch_prices(tickers, period_days)
        if not prices:
            raise ValueError("Could not fetch price data for any ticker")
        valid_tickers = [t for t in tickers if t in prices]
        if len(valid_tickers) < 2:
            raise ValueError(f"Need prices for at least 2 tickers, got {len(valid_tickers)}")

        n = len(valid_tickers)

        # 2. Align price series to common dates
        aligned_prices = self._align_prices(prices, valid_tickers)

        # 3. Calculate log returns
        log_returns = np.diff(np.log(aligned_prices), axis=0)  # (T-1, n)

        # 4. Stats
        mean_daily = np.mean(log_returns, axis=0)
        cov_daily = np.cov(log_returns, rowvar=False)
        mean_annual = mean_daily * TRADING_DAYS
        cov_annual = cov_daily * TRADING_DAYS

        # 5. Optimal weights
        opt_weights = self._optimize_weights(
            mean_annual, cov_annual, objective,
            max_weight=max_weight,
            min_weight=min_weight,
            target_return=target_return,
        )

        # 6. Efficient frontier
        frontier = self._efficient_frontier(mean_annual, cov_annual, valid_tickers,
                                            max_weight=max_weight, min_weight=min_weight)

        # 7. Monte Carlo cloud
        mc_cloud = self._monte_carlo_simulation(mean_annual, cov_annual, monte_carlo_sims)

        # 8. Portfolio daily returns with optimal weights
        port_daily = log_returns @ opt_weights

        # 9. Risk metrics
        risk = self._risk_metrics(port_daily)

        # 10. Correlation matrix
        corr = np.corrcoef(log_returns, rowvar=False)

        # 11. Individual asset stats
        individual = self._individual_stats(log_returns, valid_tickers)

        # 12. Backtest
        backtest = self._backtest(log_returns, opt_weights)

        # Assemble result
        optimal_weights_dict = {
            valid_tickers[i]: round(float(opt_weights[i]), 6) for i in range(n)
        }

        # Portfolio-level annual metrics
        port_annual_ret = float(mean_annual @ opt_weights)
        port_annual_vol = float(np.sqrt(opt_weights @ cov_annual @ opt_weights))
        port_sharpe = (port_annual_ret - self.risk_free_rate) / port_annual_vol if port_annual_vol > 0 else 0.0

        result = {
            'tickers': valid_tickers,
            'objective': objective,
            'optimalWeights': optimal_weights_dict,
            'portfolioReturn': round(port_annual_ret, 6),
            'portfolioVolatility': round(port_annual_vol, 6),
            'portfolioSharpe': round(port_sharpe, 4),
            'efficientFrontier': frontier,
            'monteCarloCloud': mc_cloud,
            'riskMetrics': risk,
            'correlationMatrix': np.round(corr, 4).tolist(),
            'covarianceMatrix': np.round(cov_annual, 8).tolist(),
            'individualStats': individual,
            'backtest': backtest,
            'periodDays': period_days,
            'dataPoints': log_returns.shape[0],
            'riskFreeRate': self.risk_free_rate,
        }

        logger.info(f"[PortfolioOpt] Done — Sharpe={port_sharpe:.3f}, "
                     f"Return={port_annual_ret:.2%}, Vol={port_annual_vol:.2%}")

        return result

    # ────────────────────────────────────────────────────────────────
    # DATA FETCHING
    # ────────────────────────────────────────────────────────────────

    def _fetch_prices(self, tickers: List[str], days: int) -> Dict[str, List[Tuple[str, float]]]:
        """
        Fetch daily close prices from FMP for each ticker.
        Returns dict of ticker -> list of (date_str, close).
        """
        results: Dict[str, List[Tuple[str, float]]] = {}
        from_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        to_date = datetime.now().strftime('%Y-%m-%d')

        for ticker in tickers:
            try:
                url = f"https://financialmodelingprep.com/stable/historical-price-eod/full"
                params = {
                    'symbol': ticker,
                    'from': from_date,
                    'to': to_date,
                    'apikey': self.api_key,
                }
                resp = self._session.get(url, params=params, timeout=15)
                resp.raise_for_status()
                data = resp.json()

                if not data:
                    logger.warning(f"[PortfolioOpt] No data for {ticker}")
                    continue

                # FMP returns list of {date, open, high, low, close, volume, ...}
                # sorted newest-first, so reverse for chronological order
                rows = sorted(data, key=lambda r: r.get('date', ''))
                prices = [(r['date'], float(r['close'])) for r in rows if r.get('close')]

                if len(prices) > 20:
                    results[ticker] = prices
                    logger.info(f"[PortfolioOpt] {ticker}: {len(prices)} price points")
                else:
                    logger.warning(f"[PortfolioOpt] {ticker}: only {len(prices)} points, skipping")

            except Exception as e:
                logger.warning(f"[PortfolioOpt] Failed to fetch {ticker}: {e}")

        return results

    def _align_prices(self, prices: Dict[str, List[Tuple[str, float]]],
                      tickers: List[str]) -> np.ndarray:
        """
        Align price series to common trading dates.
        Returns (T, n) array of close prices.
        """
        # Build date -> price maps
        date_maps = {}
        for t in tickers:
            date_maps[t] = {d: p for d, p in prices[t]}

        # Find common dates
        common_dates = set(date_maps[tickers[0]].keys())
        for t in tickers[1:]:
            common_dates &= set(date_maps[t].keys())

        common_dates = sorted(common_dates)

        if len(common_dates) < 30:
            raise ValueError(f"Only {len(common_dates)} common trading dates, need at least 30")

        # Build aligned matrix
        aligned = np.zeros((len(common_dates), len(tickers)))
        for j, t in enumerate(tickers):
            for i, d in enumerate(common_dates):
                aligned[i, j] = date_maps[t][d]

        return aligned

    # ────────────────────────────────────────────────────────────────
    # OPTIMIZATION CORE
    # ────────────────────────────────────────────────────────────────

    def _portfolio_return(self, weights: np.ndarray, mean_returns: np.ndarray) -> float:
        return float(weights @ mean_returns)

    def _portfolio_volatility(self, weights: np.ndarray, cov: np.ndarray) -> float:
        return float(np.sqrt(weights @ cov @ weights))

    def _neg_sharpe(self, weights: np.ndarray, mean_returns: np.ndarray,
                    cov: np.ndarray) -> float:
        ret = self._portfolio_return(weights, mean_returns)
        vol = self._portfolio_volatility(weights, cov)
        if vol < 1e-10:
            return 1e6
        return -(ret - self.risk_free_rate) / vol

    def _optimize_weights(
        self,
        mean_returns: np.ndarray,
        cov: np.ndarray,
        objective: str,
        max_weight: float = 0.40,
        min_weight: float = 0.0,
        target_return: Optional[float] = None,
    ) -> np.ndarray:
        """
        Optimize portfolio weights using scipy.optimize.minimize.
        Supports: max_sharpe, min_variance, max_return, risk_parity.
        """
        n = len(mean_returns)
        w0 = np.ones(n) / n  # equal-weight starting point

        bounds = [(min_weight, max_weight)] * n
        constraints = [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}]

        if target_return is not None:
            constraints.append({
                'type': 'eq',
                'fun': lambda w, tr=target_return: self._portfolio_return(w, mean_returns) - tr
            })

        if objective == 'max_sharpe':
            res = minimize(
                self._neg_sharpe, w0,
                args=(mean_returns, cov),
                method='SLSQP',
                bounds=bounds,
                constraints=constraints,
                options={'maxiter': 1000, 'ftol': 1e-12},
            )

        elif objective == 'min_variance':
            res = minimize(
                lambda w: self._portfolio_volatility(w, cov),
                w0,
                method='SLSQP',
                bounds=bounds,
                constraints=constraints,
                options={'maxiter': 1000, 'ftol': 1e-12},
            )

        elif objective == 'max_return':
            res = minimize(
                lambda w: -self._portfolio_return(w, mean_returns),
                w0,
                method='SLSQP',
                bounds=bounds,
                constraints=constraints,
                options={'maxiter': 1000, 'ftol': 1e-12},
            )

        elif objective == 'risk_parity':
            # Risk parity: each asset contributes equally to portfolio risk
            def risk_parity_obj(w):
                w = np.maximum(w, 1e-10)
                port_vol = np.sqrt(w @ cov @ w)
                if port_vol < 1e-10:
                    return 1e6
                # Marginal risk contributions
                mrc = cov @ w
                rc = w * mrc / port_vol  # risk contribution per asset
                target_rc = port_vol / n
                return float(np.sum((rc - target_rc) ** 2))

            res = minimize(
                risk_parity_obj, w0,
                method='SLSQP',
                bounds=bounds,
                constraints=constraints,
                options={'maxiter': 2000, 'ftol': 1e-14},
            )

        else:
            raise ValueError(f"Unknown objective: {objective}. "
                             f"Use max_sharpe, min_variance, max_return, or risk_parity")

        if not res.success:
            logger.warning(f"[PortfolioOpt] Optimizer did not converge: {res.message}")

        weights = res.x
        # Clamp and re-normalize
        weights = np.maximum(weights, 0.0)
        weights /= weights.sum()

        return weights

    # ────────────────────────────────────────────────────────────────
    # EFFICIENT FRONTIER
    # ────────────────────────────────────────────────────────────────

    def _efficient_frontier(
        self,
        mean_returns: np.ndarray,
        cov: np.ndarray,
        tickers: List[str],
        n_points: int = 25,
        max_weight: float = 0.40,
        min_weight: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        Trace the efficient frontier from min-variance to max-return.
        Returns list of {return, risk, sharpe, weights}.
        """
        n = len(mean_returns)
        bounds = [(min_weight, max_weight)] * n

        # Find min-variance portfolio return
        w_minvar = self._optimize_weights(mean_returns, cov, 'min_variance',
                                          max_weight=max_weight, min_weight=min_weight)
        ret_min = self._portfolio_return(w_minvar, mean_returns)

        # Find max-return portfolio return
        w_maxret = self._optimize_weights(mean_returns, cov, 'max_return',
                                          max_weight=max_weight, min_weight=min_weight)
        ret_max = self._portfolio_return(w_maxret, mean_returns)

        # Generate target returns from min to max
        target_returns = np.linspace(ret_min, ret_max, n_points)

        frontier: List[Dict[str, Any]] = []

        for tr in target_returns:
            constraints = [
                {'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0},
                {'type': 'eq', 'fun': lambda w, t=tr: self._portfolio_return(w, mean_returns) - t},
            ]
            w0 = np.ones(n) / n

            res = minimize(
                lambda w: self._portfolio_volatility(w, cov),
                w0,
                method='SLSQP',
                bounds=bounds,
                constraints=constraints,
                options={'maxiter': 1000, 'ftol': 1e-12},
            )

            if res.success:
                w = np.maximum(res.x, 0.0)
                w /= w.sum()
                ret = self._portfolio_return(w, mean_returns)
                vol = self._portfolio_volatility(w, cov)
                sharpe = (ret - self.risk_free_rate) / vol if vol > 1e-10 else 0.0

                frontier.append({
                    'return': round(ret, 6),
                    'risk': round(vol, 6),
                    'sharpe': round(sharpe, 4),
                    'weights': {tickers[i]: round(float(w[i]), 4) for i in range(n)},
                })

        return frontier

    # ────────────────────────────────────────────────────────────────
    # MONTE CARLO SIMULATION
    # ────────────────────────────────────────────────────────────────

    def _monte_carlo_simulation(
        self,
        mean_returns: np.ndarray,
        cov: np.ndarray,
        n_sims: int = 5000,
    ) -> List[Dict[str, float]]:
        """
        Generate n_sims random portfolios for visualization (scatter cloud).
        Uses Dirichlet distribution to sample valid weight vectors.
        """
        n = len(mean_returns)
        cloud: List[Dict[str, float]] = []

        # Use Dirichlet for faster random weight generation (weights sum to 1, all >= 0)
        rng = np.random.default_rng(42)
        all_weights = rng.dirichlet(np.ones(n), size=n_sims)  # (n_sims, n)

        for i in range(n_sims):
            w = all_weights[i]
            ret = float(w @ mean_returns)
            vol = float(np.sqrt(w @ cov @ w))
            sharpe = (ret - self.risk_free_rate) / vol if vol > 1e-10 else 0.0

            cloud.append({
                'return': round(ret, 6),
                'risk': round(vol, 6),
                'sharpe': round(sharpe, 4),
            })

        return cloud

    # ────────────────────────────────────────────────────────────────
    # RISK METRICS
    # ────────────────────────────────────────────────────────────────

    def _risk_metrics(self, portfolio_returns: np.ndarray) -> Dict[str, float]:
        """
        Compute VaR (95%, 99%), CVaR, max drawdown, Sortino ratio, Calmar ratio.
        """
        if len(portfolio_returns) == 0:
            return {}

        # Annualized return & volatility
        ann_ret = float(np.mean(portfolio_returns) * TRADING_DAYS)
        ann_vol = float(np.std(portfolio_returns, ddof=1) * np.sqrt(TRADING_DAYS))

        # Sharpe
        sharpe = (ann_ret - self.risk_free_rate) / ann_vol if ann_vol > 1e-10 else 0.0

        # VaR (parametric, daily)
        var_95 = float(np.percentile(portfolio_returns, 5))
        var_99 = float(np.percentile(portfolio_returns, 1))

        # CVaR (Expected Shortfall)
        cvar_95 = float(np.mean(portfolio_returns[portfolio_returns <= var_95]))
        cvar_99_mask = portfolio_returns <= var_99
        cvar_99 = float(np.mean(portfolio_returns[cvar_99_mask])) if np.any(cvar_99_mask) else var_99

        # Annualized VaR / CVaR
        var_95_annual = var_95 * np.sqrt(TRADING_DAYS)
        var_99_annual = var_99 * np.sqrt(TRADING_DAYS)
        cvar_95_annual = cvar_95 * np.sqrt(TRADING_DAYS)

        # Max Drawdown
        cumulative = np.exp(np.cumsum(portfolio_returns))  # log returns -> cumulative
        running_max = np.maximum.accumulate(cumulative)
        drawdowns = (cumulative - running_max) / running_max
        max_dd = float(np.min(drawdowns))

        # Sortino Ratio (downside deviation)
        downside = portfolio_returns[portfolio_returns < 0]
        downside_std = float(np.std(downside, ddof=1)) * np.sqrt(TRADING_DAYS) if len(downside) > 1 else ann_vol
        sortino = (ann_ret - self.risk_free_rate) / downside_std if downside_std > 1e-10 else 0.0

        # Calmar Ratio (annual return / |max drawdown|)
        calmar = ann_ret / abs(max_dd) if abs(max_dd) > 1e-10 else 0.0

        # Skewness and Kurtosis
        skew = float(stats.skew(portfolio_returns))
        kurt = float(stats.kurtosis(portfolio_returns))

        return {
            'annualReturn': round(ann_ret, 6),
            'annualVolatility': round(ann_vol, 6),
            'sharpe': round(sharpe, 4),
            'sortino': round(sortino, 4),
            'calmar': round(calmar, 4),
            'var95Daily': round(float(var_95), 6),
            'var99Daily': round(float(var_99), 6),
            'cvar95Daily': round(float(cvar_95), 6),
            'var95Annual': round(float(var_95_annual), 6),
            'var99Annual': round(float(var_99_annual), 6),
            'cvar95Annual': round(float(cvar_95_annual), 6),
            'maxDrawdown': round(max_dd, 6),
            'skewness': round(skew, 4),
            'kurtosis': round(kurt, 4),
        }

    # ────────────────────────────────────────────────────────────────
    # INDIVIDUAL ASSET STATS
    # ────────────────────────────────────────────────────────────────

    def _individual_stats(self, log_returns: np.ndarray,
                          tickers: List[str]) -> List[Dict[str, Any]]:
        """Per-asset annualized return, volatility, Sharpe, beta (vs equal-weight portfolio)."""
        n = log_returns.shape[1]
        ew_port = log_returns @ (np.ones(n) / n)  # equal-weight benchmark

        results = []
        for j, ticker in enumerate(tickers):
            col = log_returns[:, j]
            ann_ret = float(np.mean(col) * TRADING_DAYS)
            ann_vol = float(np.std(col, ddof=1) * np.sqrt(TRADING_DAYS))
            sharpe = (ann_ret - self.risk_free_rate) / ann_vol if ann_vol > 1e-10 else 0.0

            # Beta vs equal-weight portfolio
            cov_with_port = np.cov(col, ew_port)[0, 1]
            var_port = np.var(ew_port, ddof=1)
            beta = cov_with_port / var_port if var_port > 1e-10 else 1.0

            # Max drawdown for individual asset
            cum = np.exp(np.cumsum(col))
            running_max = np.maximum.accumulate(cum)
            dd = (cum - running_max) / running_max
            max_dd = float(np.min(dd))

            results.append({
                'ticker': ticker,
                'annualReturn': round(ann_ret, 6),
                'annualVolatility': round(ann_vol, 6),
                'sharpe': round(sharpe, 4),
                'beta': round(float(beta), 4),
                'maxDrawdown': round(max_dd, 6),
            })

        return results

    # ────────────────────────────────────────────────────────────────
    # BACKTEST
    # ────────────────────────────────────────────────────────────────

    def _backtest(self, log_returns: np.ndarray, weights: np.ndarray) -> Dict[str, Any]:
        """
        Backtest the optimized portfolio over the entire historical period.
        Returns daily cumulative returns and drawdown series.
        """
        port_daily = log_returns @ weights
        cum_log = np.cumsum(port_daily)
        cum_simple = np.exp(cum_log) - 1.0  # cumulative simple return

        # Drawdown series
        cum_value = np.exp(cum_log)
        running_max = np.maximum.accumulate(cum_value)
        drawdown_series = ((cum_value - running_max) / running_max).tolist()

        total_return = float(cum_simple[-1]) if len(cum_simple) > 0 else 0.0

        # Subsample for frontend (max ~500 points)
        n_pts = len(cum_simple)
        step = max(1, n_pts // 500)
        sampled_returns = cum_simple[::step].tolist()
        sampled_drawdowns = drawdown_series[::step]

        return {
            'cumulativeReturn': round(total_return, 6),
            'returns': [round(r, 6) for r in sampled_returns],
            'drawdowns': [round(d, 6) for d in sampled_drawdowns],
            'totalDays': n_pts,
        }


# ════════════════════════════════════════════════════════════════════
# Convenience function
# ════════════════════════════════════════════════════════════════════

def optimize_portfolio(
    tickers: List[str],
    objective: str = 'max_sharpe',
    api_key: Optional[str] = None,
    **kwargs,
) -> Dict[str, Any]:
    """Convenience wrapper — instantiate optimizer and run."""
    engine = PortfolioOptimizer(api_key=api_key)
    return engine.optimize(tickers, objective=objective, **kwargs)
