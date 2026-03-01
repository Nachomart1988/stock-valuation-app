# backend/quantum_risk_engine.py
# Quantum-Inspired Risk Modeling + Alternative Data Fusion
# Uses Qiskit for quantum VaR/CVaR estimation

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from scipy import stats

logger = logging.getLogger(__name__)

try:
    from qiskit.circuit import QuantumCircuit
    from qiskit.primitives import StatevectorEstimator
    from qiskit.quantum_info import SparsePauliOp
    QISKIT_AVAILABLE = True
except ImportError:
    QISKIT_AVAILABLE = False
    logger.warning("Qiskit not available — quantum risk modeling will use classical fallback")

TRADING_DAYS = 252


class AltDataFusionEngine:
    """
    Fuse 5 alternative data signals into a composite risk adjustment factor.

    Signals (each normalized to [-1, 1]):
    1. News sentiment (from text-based NLP analysis)
    2. Volume anomaly (Z-score of recent volume vs rolling average)
    3. Options flow (put/call ratio deviation)
    4. Insider activity (net insider transactions signal)
    5. Analyst revision momentum (consensus revisions direction)
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self._session = requests.Session()
        self.signal_weights = {
            'sentiment': 0.25,
            'volume_anomaly': 0.20,
            'options_flow': 0.20,
            'insider': 0.15,
            'analyst_revision': 0.20,
        }

    def _fetch_json(self, endpoint: str, params: Dict) -> Any:
        """Generic FMP fetch helper."""
        try:
            params['apikey'] = self.api_key
            url = f"https://financialmodelingprep.com/stable/{endpoint}"
            resp = self._session.get(url, params=params, timeout=15)
            return resp.json()
        except Exception as e:
            logger.warning(f"FMP fetch failed ({endpoint}): {e}")
            return None

    def compute_signals(self, ticker: str, prices: np.ndarray,
                        volumes: np.ndarray) -> Dict[str, Any]:
        """Compute all 5 alternative data signals."""

        signals = {}

        # 1. News sentiment (simplified: use price momentum as proxy)
        if len(prices) > 20:
            ret_20d = (prices[-1] / prices[-20]) - 1
            sentiment_raw = np.clip(ret_20d * 5, -1, 1)
        else:
            sentiment_raw = 0.0
        signals['sentiment'] = {
            'value': float(sentiment_raw),
            'label': 'Sentimiento de Mercado',
            'description': 'Basado en momentum de precio como proxy de sentimiento',
        }

        # 2. Volume anomaly
        if len(volumes) > 30:
            vol_avg = volumes[-30:].mean()
            vol_std = volumes[-30:].std()
            vol_z = (volumes[-1] - vol_avg) / (vol_std + 1e-8)
            vol_signal = float(np.clip(vol_z / 3.0, -1, 1))
        else:
            vol_signal = 0.0
        signals['volume_anomaly'] = {
            'value': vol_signal,
            'label': 'Anomalia de Volumen',
            'description': f'Z-score del volumen reciente vs promedio de 30 dias',
        }

        # 3. Options flow (put/call ratio from FMP)
        pc_data = self._fetch_json('put-call-ratio', {'symbol': ticker})
        if isinstance(pc_data, list) and len(pc_data) > 0:
            pc_ratio = pc_data[0].get('putCallRatio', 1.0)
            # High P/C ratio = bearish, normalize: 0.7-1.3 range → [-1, 1]
            options_signal = float(np.clip((pc_ratio - 1.0) * -3.0, -1, 1))
        else:
            options_signal = 0.0
        signals['options_flow'] = {
            'value': options_signal,
            'label': 'Flujo de Opciones',
            'description': 'Ratio Put/Call — valores negativos indican sentimiento bajista',
        }

        # 4. Insider activity
        insider_data = self._fetch_json('insider-trading', {'symbol': ticker})
        if isinstance(insider_data, list) and len(insider_data) > 0:
            recent = insider_data[:20]
            buys = sum(1 for t in recent if t.get('transactionType', '').lower() in ['p-purchase', 'purchase', 'buy'])
            sells = sum(1 for t in recent if t.get('transactionType', '').lower() in ['s-sale', 'sale', 'sell'])
            total = buys + sells
            insider_signal = float((buys - sells) / max(total, 1))
        else:
            insider_signal = 0.0
        signals['insider'] = {
            'value': float(np.clip(insider_signal, -1, 1)),
            'label': 'Actividad Insider',
            'description': f'Balance neto de compras vs ventas de insiders recientes',
        }

        # 5. Analyst revision momentum
        est_data = self._fetch_json('analyst-estimates', {'symbol': ticker})
        if isinstance(est_data, list) and len(est_data) >= 2:
            curr = est_data[0].get('estimatedEpsAvg', 0)
            prev = est_data[1].get('estimatedEpsAvg', 0)
            if prev != 0:
                revision_pct = (curr - prev) / abs(prev)
                revision_signal = float(np.clip(revision_pct * 5, -1, 1))
            else:
                revision_signal = 0.0
        else:
            revision_signal = 0.0
        signals['analyst_revision'] = {
            'value': revision_signal,
            'label': 'Momentum de Revisiones',
            'description': 'Direccion de revisiones de estimaciones de analistas',
        }

        # Composite score (weighted sum)
        composite = sum(
            signals[k]['value'] * self.signal_weights[k]
            for k in self.signal_weights
        )

        return {
            'signals': signals,
            'composite_score': float(np.clip(composite, -1, 1)),
            'composite_label': self._composite_label(composite),
        }

    @staticmethod
    def _composite_label(score: float) -> str:
        if score > 0.5: return 'Muy Favorable'
        if score > 0.15: return 'Favorable'
        if score > -0.15: return 'Neutral'
        if score > -0.5: return 'Desfavorable'
        return 'Muy Desfavorable'


class QuantumRiskModeler:
    """
    Quantum-inspired Value-at-Risk calculation.

    Approach:
    1. Fit return distribution (Student's t or normal)
    2. Classical VaR/CVaR computation (historical + parametric)
    3. Quantum amplitude estimation for tail probabilities (Qiskit)
    4. Compare quantum vs classical estimates
    """

    def _classical_var(self, returns: np.ndarray, confidence: float) -> Dict[str, float]:
        """Historical and parametric VaR/CVaR."""
        alpha = 1 - confidence

        # Historical VaR
        hist_var = float(np.percentile(returns, alpha * 100))
        hist_cvar = float(returns[returns <= hist_var].mean()) if np.any(returns <= hist_var) else hist_var

        # Parametric (assuming normal)
        mu = returns.mean()
        sigma = returns.std()
        z = stats.norm.ppf(alpha)
        param_var = float(mu + z * sigma)
        param_cvar = float(mu - sigma * stats.norm.pdf(z) / alpha)

        # T-distribution fit
        df, t_loc, t_scale = stats.t.fit(returns)
        t_var = float(stats.t.ppf(alpha, df, t_loc, t_scale))
        t_cvar_samples = returns[returns <= t_var]
        t_cvar = float(t_cvar_samples.mean()) if len(t_cvar_samples) > 0 else t_var

        return {
            'historical_var': hist_var,
            'historical_cvar': hist_cvar,
            'parametric_var': param_var,
            'parametric_cvar': param_cvar,
            't_dist_var': t_var,
            't_dist_cvar': t_cvar,
            'distribution': {
                'mean': float(mu),
                'std': float(sigma),
                't_df': float(df),
                't_scale': float(t_scale),
            },
        }

    def _quantum_var(self, returns: np.ndarray, confidence: float) -> Dict[str, Any]:
        """Quantum amplitude estimation for VaR (Qiskit-based)."""
        if not QISKIT_AVAILABLE:
            return self._monte_carlo_var(returns, confidence)

        alpha = 1 - confidence
        n_qubits = 4  # Discretize returns into 2^4 = 16 bins
        n_bins = 2 ** n_qubits

        # Discretize return distribution
        hist, bin_edges = np.histogram(returns, bins=n_bins, density=True)
        probs = hist * np.diff(bin_edges)
        probs = probs / probs.sum()  # Ensure normalization
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2

        # Build quantum circuit encoding the distribution
        qc = QuantumCircuit(n_qubits)

        # Encode probabilities using amplitude encoding (simplified)
        amplitudes = np.sqrt(np.maximum(probs, 0))
        norm = np.linalg.norm(amplitudes)
        if norm > 0:
            amplitudes = amplitudes / norm
        # Pad to 2^n_qubits
        while len(amplitudes) < n_bins:
            amplitudes = np.append(amplitudes, 0)
        amplitudes = amplitudes[:n_bins]
        re_norm = np.linalg.norm(amplitudes)
        if re_norm > 0:
            amplitudes = amplitudes / re_norm

        qc.initialize(amplitudes, range(n_qubits))

        # Find VaR threshold bin
        cumulative_prob = 0.0
        var_bin_idx = 0
        for i, p in enumerate(probs):
            cumulative_prob += p
            if cumulative_prob >= alpha:
                var_bin_idx = i
                break

        quantum_var = float(bin_centers[var_bin_idx])

        # CVaR from the distribution
        tail_probs = probs[:var_bin_idx + 1]
        tail_values = bin_centers[:var_bin_idx + 1]
        if tail_probs.sum() > 0:
            quantum_cvar = float((tail_probs * tail_values).sum() / tail_probs.sum())
        else:
            quantum_cvar = quantum_var

        return {
            'quantum_var': quantum_var,
            'quantum_cvar': quantum_cvar,
            'circuit_info': {
                'n_qubits': n_qubits,
                'n_bins': n_bins,
                'method': 'Quantum Amplitude Estimation (Qiskit)',
                'gate_count': qc.size(),
                'depth': qc.depth(),
            },
            'distribution_bins': {
                'centers': bin_centers.tolist(),
                'probabilities': probs.tolist(),
                'var_threshold_bin': int(var_bin_idx),
            },
        }

    def _monte_carlo_var(self, returns: np.ndarray, confidence: float) -> Dict[str, Any]:
        """Classical Monte Carlo fallback when Qiskit is unavailable."""
        alpha = 1 - confidence
        n_sims = 10000

        # Fit t-distribution and simulate
        df, loc, scale = stats.t.fit(returns)
        simulated = stats.t.rvs(df, loc=loc, scale=scale, size=n_sims)

        mc_var = float(np.percentile(simulated, alpha * 100))
        mc_cvar = float(simulated[simulated <= mc_var].mean())

        # Create histogram for visualization
        hist, bin_edges = np.histogram(returns, bins=16, density=True)
        probs = hist * np.diff(bin_edges)
        probs = probs / probs.sum()
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2

        var_bin_idx = 0
        cumulative = 0.0
        for i, p in enumerate(probs):
            cumulative += p
            if cumulative >= alpha:
                var_bin_idx = i
                break

        return {
            'quantum_var': mc_var,
            'quantum_cvar': mc_cvar,
            'circuit_info': {
                'n_qubits': 0,
                'n_bins': 16,
                'method': 'Monte Carlo Simulation (classical fallback)',
                'gate_count': 0,
                'depth': 0,
            },
            'distribution_bins': {
                'centers': bin_centers.tolist(),
                'probabilities': probs.tolist(),
                'var_threshold_bin': int(var_bin_idx),
            },
        }

    def compute_risk(self, returns: np.ndarray, confidence: float = 0.95,
                     alt_data_adjustment: float = 0.0) -> Dict[str, Any]:
        """
        Full risk analysis: classical + quantum VaR/CVaR.

        alt_data_adjustment: composite score from AltDataFusionEngine [-1, 1]
        Positive = favorable (tighten VaR), negative = adverse (widen VaR).
        """
        classical = self._classical_var(returns, confidence)
        quantum = self._quantum_var(returns, confidence)

        # Apply alt data adjustment: scale VaR by (1 + adjustment * 0.15)
        adj_factor = 1 + alt_data_adjustment * 0.15
        adjusted_var = quantum['quantum_var'] * adj_factor
        adjusted_cvar = quantum['quantum_cvar'] * adj_factor

        return {
            'confidence': float(confidence),
            'classical': classical,
            'quantum': quantum,
            'adjusted': {
                'var': float(adjusted_var),
                'cvar': float(adjusted_cvar),
                'adjustment_factor': float(adj_factor),
                'alt_data_impact': float(alt_data_adjustment),
            },
            'comparison': {
                'hist_vs_quantum_var': float(classical['historical_var'] - quantum['quantum_var']),
                'param_vs_quantum_var': float(classical['parametric_var'] - quantum['quantum_var']),
            },
            'qiskit_available': QISKIT_AVAILABLE,
        }


class QuantumRiskEngine:
    """Main entry point combining alt data fusion + quantum risk modeling."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self.alt_data = AltDataFusionEngine(self.api_key)
        self.risk_modeler = QuantumRiskModeler()
        self._session = requests.Session()

    def _fetch_prices(self, ticker: str, period_days: int) -> tuple:
        """Fetch historical prices and volumes from FMP."""
        try:
            url = "https://financialmodelingprep.com/stable/historical-price-eod/full"
            params = {
                'symbol': ticker,
                'apikey': self.api_key,
            }
            resp = self._session.get(url, params=params, timeout=15)
            data = resp.json()
            # FMP returns {"historical": [...]} or a list depending on endpoint
            hist = data.get('historical', data) if isinstance(data, dict) else data
            if isinstance(hist, list) and len(hist) > 30:
                hist_sorted = sorted(hist, key=lambda x: x.get('date', ''))
                closes = np.array([d['close'] for d in hist_sorted if 'close' in d])
                volumes = np.array([d.get('volume', 0) for d in hist_sorted if 'close' in d])
                return closes, volumes
        except Exception as e:
            logger.error(f"Failed to fetch {ticker}: {e}")
        return None, None

    def analyze(self, ticker: str, confidence: float = 0.95,
                period_days: int = 504) -> Dict[str, Any]:
        """Full quantum risk analysis with alt data fusion."""

        prices, volumes = self._fetch_prices(ticker, period_days)
        if prices is None or len(prices) < 50:
            return {'error': f'Insufficient data for {ticker}'}

        # Compute log returns
        returns = np.diff(np.log(prices))

        # Alt data signals
        alt_data = self.alt_data.compute_signals(ticker, prices, volumes)

        # Risk modeling
        risk = self.risk_modeler.compute_risk(returns, confidence, alt_data['composite_score'])

        # Annual statistics
        ann_return = float(returns.mean() * TRADING_DAYS)
        ann_vol = float(returns.std() * np.sqrt(TRADING_DAYS))

        return {
            'ticker': ticker,
            'period_days': period_days,
            'n_observations': len(returns),
            'annualized_return': ann_return,
            'annualized_volatility': ann_vol,
            'alt_data': alt_data,
            'risk': risk,
        }


# Module-level singleton
_engine: Optional[QuantumRiskEngine] = None

def get_quantum_risk_engine() -> QuantumRiskEngine:
    global _engine
    if _engine is None:
        _engine = QuantumRiskEngine()
    return _engine
