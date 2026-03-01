# backend/quantum_portfolio_engine.py
# Quantum-Inspired Portfolio Optimization via QAOA (Quantum Approximate Optimization Algorithm)
# Uses Pennylane for quantum circuit simulation on CPU

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from scipy.optimize import minimize

logger = logging.getLogger(__name__)

try:
    import pennylane as qml
    from pennylane import numpy as pnp
    PENNYLANE_AVAILABLE = True
except ImportError:
    PENNYLANE_AVAILABLE = False
    logger.warning("PennyLane not available — quantum optimization will use classical fallback")

TRADING_DAYS = 252


class QuantumPortfolioOptimizer:
    """
    QAOA-based portfolio optimizer.

    Encodes portfolio selection as a QUBO (Quadratic Unconstrained Binary Optimization):
    - Binary variables x_i: include/exclude asset i
    - Objective: maximize expected return - lambda * portfolio variance
    - Budget constraint penalized via (sum(x) - k)^2

    The QAOA circuit alternates cost and mixer unitaries for p layers,
    then samples the optimal binary portfolio from measurements.
    Compares quantum result against classical scipy-based continuous optimization.
    """

    def __init__(self, api_key: Optional[str] = None, risk_free_rate: float = 0.042):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.risk_free_rate = risk_free_rate
        self._session = requests.Session()

    def _fetch_prices(self, tickers: List[str], period_days: int) -> Dict[str, np.ndarray]:
        """Fetch historical close prices from FMP."""
        prices = {}
        for ticker in tickers:
            try:
                url = f"https://financialmodelingprep.com/stable/historical-price-eod/dividend-adjusted"
                params = {
                    'symbol': ticker,
                    'from': (datetime.now() - timedelta(days=period_days)).strftime('%Y-%m-%d'),
                    'to': datetime.now().strftime('%Y-%m-%d'),
                    'apikey': self.api_key,
                }
                resp = self._session.get(url, params=params, timeout=15)
                data = resp.json()
                if isinstance(data, list) and len(data) > 5:
                    closes = np.array([d['close'] for d in reversed(data) if 'close' in d])
                    if len(closes) > 20:
                        prices[ticker] = closes
            except Exception as e:
                logger.warning(f"Failed to fetch {ticker}: {e}")
        return prices

    def _compute_returns(self, prices: Dict[str, np.ndarray]) -> tuple:
        """Compute aligned returns matrix, mean returns, and covariance."""
        tickers = list(prices.keys())
        min_len = min(len(p) for p in prices.values())
        ret_matrix = np.column_stack([
            np.diff(np.log(prices[t][-min_len:])) for t in tickers
        ])
        mean_returns = ret_matrix.mean(axis=0) * TRADING_DAYS
        cov_matrix = np.cov(ret_matrix, rowvar=False) * TRADING_DAYS
        return tickers, ret_matrix, mean_returns, cov_matrix

    def _build_qubo(self, mean_returns: np.ndarray, cov_matrix: np.ndarray,
                    risk_aversion: float, budget: int) -> np.ndarray:
        """Build QUBO matrix for the portfolio problem.

        Q_ij = -return_contribution + risk_aversion * cov + budget_penalty
        """
        n = len(mean_returns)
        Q = np.zeros((n, n))

        # Return term (diagonal): maximize returns
        for i in range(n):
            Q[i, i] -= mean_returns[i]

        # Risk term: minimize risk
        Q += risk_aversion * cov_matrix

        # Budget constraint penalty: (sum(x) - budget)^2
        penalty = max(abs(mean_returns).max(), abs(cov_matrix).max()) * 2.0
        for i in range(n):
            Q[i, i] += penalty * (1 - 2 * budget)
            for j in range(n):
                Q[i, j] += penalty

        return Q

    def _qaoa_optimize(self, Q: np.ndarray, n_layers: int, n_qubits: int) -> Dict[str, Any]:
        """Run QAOA on the QUBO problem using Pennylane."""
        if not PENNYLANE_AVAILABLE:
            return self._classical_binary_solve(Q, n_qubits)

        dev = qml.device('default.qubit', wires=n_qubits)

        def cost_hamiltonian(Q_mat):
            """Build cost Hamiltonian from QUBO matrix."""
            coeffs = []
            obs = []
            for i in range(n_qubits):
                for j in range(i, n_qubits):
                    if i == j:
                        c = Q_mat[i, i] / 2.0
                        if abs(c) > 1e-10:
                            coeffs.append(c)
                            obs.append(qml.PauliZ(i))
                    else:
                        c = Q_mat[i, j] / 4.0
                        if abs(c) > 1e-10:
                            coeffs.append(c)
                            obs.append(qml.PauliZ(i) @ qml.PauliZ(j))
            if not coeffs:
                coeffs = [0.0]
                obs = [qml.Identity(0)]
            return qml.Hamiltonian(coeffs, obs)

        H_cost = cost_hamiltonian(Q)

        @qml.qnode(dev)
        def qaoa_circuit(gamma, beta):
            # Initial superposition
            for i in range(n_qubits):
                qml.Hadamard(wires=i)

            # QAOA layers
            for layer in range(n_layers):
                # Cost unitary
                qml.ApproxTimeEvolution(H_cost, gamma[layer], 1)
                # Mixer unitary
                for i in range(n_qubits):
                    qml.RX(2 * beta[layer], wires=i)

            return qml.probs(wires=range(n_qubits))

        # Classical optimization of QAOA angles
        n_params = n_layers
        gamma_init = np.random.uniform(0, 2 * np.pi, n_params)
        beta_init = np.random.uniform(0, np.pi, n_params)

        best_cost = float('inf')
        best_probs = None
        best_params = None

        def objective(params):
            nonlocal best_cost, best_probs, best_params
            gamma = params[:n_params]
            beta = params[n_params:]
            probs = qaoa_circuit(gamma, beta)
            probs_np = np.array(probs)

            # Expected cost = sum over all bitstrings of prob * cost
            cost = 0.0
            for state_idx in range(2 ** n_qubits):
                bits = np.array([int(b) for b in format(state_idx, f'0{n_qubits}b')])
                state_cost = bits @ Q @ bits
                cost += probs_np[state_idx] * state_cost

            if cost < best_cost:
                best_cost = cost
                best_probs = probs_np.copy()
                best_params = params.copy()
            return cost

        init_params = np.concatenate([gamma_init, beta_init])

        try:
            result = minimize(objective, init_params, method='COBYLA',
                              options={'maxiter': 200, 'rhobeg': 0.5})
        except Exception as e:
            logger.warning(f"QAOA optimization failed: {e}")
            return self._classical_binary_solve(Q, n_qubits)

        # Extract best bitstring from probability distribution
        if best_probs is None:
            return self._classical_binary_solve(Q, n_qubits)

        top_states = np.argsort(best_probs)[-5:][::-1]
        best_state = top_states[0]
        best_bits = np.array([int(b) for b in format(best_state, f'0{n_qubits}b')])

        # Compute quantum cost
        q_cost = best_bits @ Q @ best_bits

        return {
            'selected_assets': best_bits.tolist(),
            'qaoa_cost': float(q_cost),
            'top_states': [
                {
                    'bitstring': format(s, f'0{n_qubits}b'),
                    'probability': float(best_probs[s]),
                    'cost': float(np.array([int(b) for b in format(s, f'0{n_qubits}b')]) @ Q @ np.array([int(b) for b in format(s, f'0{n_qubits}b')])),
                }
                for s in top_states
            ],
            'n_layers': n_layers,
            'n_qubits': n_qubits,
            'total_gates': n_layers * (n_qubits + len([c for c in H_cost.coeffs if abs(c) > 1e-10])),
            'converged': True,
            'method': 'QAOA (Pennylane)',
        }

    def _classical_binary_solve(self, Q: np.ndarray, n_qubits: int) -> Dict[str, Any]:
        """Brute-force classical solver for small QUBO (fallback)."""
        best_cost = float('inf')
        best_bits = None

        for state_idx in range(2 ** n_qubits):
            bits = np.array([int(b) for b in format(state_idx, f'0{n_qubits}b')])
            if bits.sum() == 0:
                continue
            cost = bits @ Q @ bits
            if cost < best_cost:
                best_cost = cost
                best_bits = bits.copy()

        if best_bits is None:
            best_bits = np.ones(n_qubits)

        return {
            'selected_assets': best_bits.tolist(),
            'qaoa_cost': float(best_cost),
            'top_states': [{'bitstring': ''.join(map(str, best_bits.astype(int))), 'probability': 1.0, 'cost': float(best_cost)}],
            'n_layers': 0,
            'n_qubits': n_qubits,
            'total_gates': 0,
            'converged': True,
            'method': 'Classical Brute-Force (fallback)',
        }

    def _classical_continuous_solve(self, mean_returns: np.ndarray, cov_matrix: np.ndarray,
                                    risk_aversion: float) -> Dict[str, Any]:
        """Classical continuous Markowitz optimization for comparison."""
        n = len(mean_returns)

        def neg_utility(w):
            ret = w @ mean_returns
            risk = w @ cov_matrix @ w
            return -(ret - risk_aversion * risk)

        constraints = [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1}]
        bounds = [(0, 1)] * n

        w0 = np.ones(n) / n
        result = minimize(neg_utility, w0, method='SLSQP', bounds=bounds, constraints=constraints)

        weights = result.x
        port_return = weights @ mean_returns
        port_risk = np.sqrt(weights @ cov_matrix @ weights)
        sharpe = (port_return - self.risk_free_rate) / port_risk if port_risk > 0 else 0

        return {
            'weights': weights.tolist(),
            'return': float(port_return),
            'risk': float(port_risk),
            'sharpe': float(sharpe),
        }

    def optimize(self, tickers: List[str], risk_aversion: float = 1.0,
                 n_layers: int = 2, period_days: int = 756) -> Dict[str, Any]:
        """Main optimization entry point. Returns quantum + classical comparison."""

        if len(tickers) < 2:
            return {'error': 'Need at least 2 tickers'}
        if len(tickers) > 10:
            return {'error': 'Maximum 10 tickers for quantum optimization (qubit limit)'}

        # Fetch data
        prices = self._fetch_prices(tickers, period_days)
        valid_tickers = [t for t in tickers if t in prices]

        if len(valid_tickers) < 2:
            return {'error': f'Only {len(valid_tickers)} tickers with valid data'}

        tickers_final, ret_matrix, mean_returns, cov_matrix = self._compute_returns(
            {t: prices[t] for t in valid_tickers}
        )
        n = len(tickers_final)
        budget = max(1, n // 2)  # Select ~half the assets

        # Build QUBO
        Q = self._build_qubo(mean_returns, cov_matrix, risk_aversion, budget)

        # Quantum optimization
        quantum_result = self._qaoa_optimize(Q, n_layers, n)

        # Convert binary selection to weights (equal weight among selected)
        selected = np.array(quantum_result['selected_assets'])
        n_selected = max(selected.sum(), 1)
        q_weights = (selected / n_selected).tolist()
        q_weights_arr = np.array(q_weights)
        q_return = float(q_weights_arr @ mean_returns)
        q_risk = float(np.sqrt(q_weights_arr @ cov_matrix @ q_weights_arr)) if q_weights_arr.sum() > 0 else 0
        q_sharpe = float((q_return - self.risk_free_rate) / q_risk) if q_risk > 0 else 0

        # Classical continuous optimization
        classical_result = self._classical_continuous_solve(mean_returns, cov_matrix, risk_aversion)

        return {
            'tickers': tickers_final,
            'quantum': {
                'weights': q_weights,
                'return': q_return,
                'risk': q_risk,
                'sharpe': q_sharpe,
                'selected_assets': quantum_result['selected_assets'],
                'circuit_info': {
                    'method': quantum_result['method'],
                    'n_qubits': quantum_result['n_qubits'],
                    'n_layers': quantum_result['n_layers'],
                    'total_gates': quantum_result['total_gates'],
                    'converged': quantum_result['converged'],
                },
                'top_states': quantum_result['top_states'],
            },
            'classical': classical_result,
            'comparison': {
                'return_diff': q_return - classical_result['return'],
                'risk_diff': q_risk - classical_result['risk'],
                'sharpe_diff': q_sharpe - classical_result['sharpe'],
            },
            'mean_returns': mean_returns.tolist(),
            'risk_per_asset': np.sqrt(np.diag(cov_matrix)).tolist(),
            'pennylane_available': PENNYLANE_AVAILABLE,
        }


# Module-level singleton
_optimizer: Optional[QuantumPortfolioOptimizer] = None

def get_quantum_portfolio_optimizer() -> QuantumPortfolioOptimizer:
    global _optimizer
    if _optimizer is None:
        _optimizer = QuantumPortfolioOptimizer()
    return _optimizer
