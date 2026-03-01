'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell,
} from 'recharts';

interface QuantumRiskTabProps {
  ticker?: string;
}

interface SignalData {
  value: number;
  label: string;
  description: string;
}

interface RiskResult {
  ticker: string;
  period_days: number;
  n_observations: number;
  annualized_return: number;
  annualized_volatility: number;
  alt_data: {
    signals: Record<string, SignalData>;
    composite_score: number;
    composite_label: string;
  };
  risk: {
    confidence: number;
    classical: {
      historical_var: number;
      historical_cvar: number;
      parametric_var: number;
      parametric_cvar: number;
      t_dist_var: number;
      t_dist_cvar: number;
      distribution: { mean: number; std: number; t_df: number; t_scale: number };
    };
    quantum: {
      quantum_var: number;
      quantum_cvar: number;
      circuit_info: {
        n_qubits: number;
        n_bins: number;
        method: string;
        gate_count: number;
        depth: number;
      };
      distribution_bins: {
        centers: number[];
        probabilities: number[];
        var_threshold_bin: number;
      };
    };
    adjusted: {
      var: number;
      cvar: number;
      adjustment_factor: number;
      alt_data_impact: number;
    };
    qiskit_available: boolean;
  };
}

const SIGNAL_COLORS: Record<string, string> = {
  sentiment: '#00A651',
  volume_anomaly: '#3b82f6',
  options_flow: '#f59e0b',
  insider: '#8b5cf6',
  analyst_revision: '#06b6d4',
};

function SignalGauge({ signal, signalKey }: { signal: SignalData; signalKey: string }) {
  const color = SIGNAL_COLORS[signalKey] || '#888';
  const pct = ((signal.value + 1) / 2) * 100; // -1..1 → 0..100

  return (
    <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-300">{signal.label}</span>
        <span className="font-data text-sm font-bold" style={{ color }}>
          {signal.value > 0 ? '+' : ''}{signal.value.toFixed(2)}
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-xs text-gray-600 mt-1">{signal.description}</p>
    </div>
  );
}

export default function QuantumRiskTab({ ticker }: QuantumRiskTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState(ticker || 'AAPL');
  const [confidence, setConfidence] = useState(0.95);
  const [periodDays, setPeriodDays] = useState(504);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${backendUrl}/quantum/risk-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: tickerInput.toUpperCase().trim(),
          confidence,
          period_days: periodDays,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      setResult(await resp.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // Distribution chart data
  const distData = result ? result.risk.quantum.distribution_bins.centers.map((c, i) => ({
    return: +(c * 100).toFixed(2),
    probability: +(result.risk.quantum.distribution_bins.probabilities[i] * 100).toFixed(2),
    isTail: i <= result.risk.quantum.distribution_bins.var_threshold_bin,
  })) : [];

  const compositeColor = result
    ? result.alt_data.composite_score > 0.15 ? '#00A651'
    : result.alt_data.composite_score < -0.15 ? '#ef4444'
    : '#f59e0b'
    : '#888';

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-cyan-900/30 border border-cyan-500/30 flex items-center justify-center">
          <span className="text-lg">&#x26A0;</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            {es ? 'Modelo de Riesgo Cuantico + Alt Data' : 'Quantum Risk Model + Alt Data'}
          </h2>
          <p className="text-xs text-gray-500">
            Quantum VaR/CVaR + {es ? 'Fusion de Datos Alternativos' : 'Alternative Data Fusion'}
          </p>
        </div>
      </div>

      {/* Input controls */}
      <div className="bg-black/40 rounded-xl border border-green-900/20 p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">Ticker</label>
            <input
              type="text"
              className="input font-data"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="AAPL"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">{es ? 'Nivel de Confianza' : 'Confidence Level'}</label>
            <select
              className="input"
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
            >
              <option value={0.90}>90%</option>
              <option value={0.95}>95%</option>
              <option value={0.99}>99%</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">{es ? 'Periodo (dias)' : 'Period (days)'}</label>
            <select
              className="input"
              value={periodDays}
              onChange={(e) => setPeriodDays(parseInt(e.target.value))}
            >
              <option value={252}>1 {es ? 'ano' : 'year'}</option>
              <option value={504}>2 {es ? 'anos' : 'years'}</option>
              <option value={756}>3 {es ? 'anos' : 'years'}</option>
            </select>
          </div>
        </div>

        <button
          onClick={runAnalysis}
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold transition-all bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {es ? 'Analizando riesgo...' : 'Analyzing risk...'}
            </span>
          ) : (
            es ? 'Analizar Riesgo Cuantico' : 'Run Quantum Risk Analysis'
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Composite risk score */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-6 text-center">
            <p className="text-xs text-gray-500 mb-2">{es ? 'Score Compuesto de Riesgo' : 'Composite Risk Score'}</p>
            <p className="text-5xl font-data font-bold mb-1" style={{ color: compositeColor }}>
              {result.alt_data.composite_score > 0 ? '+' : ''}{result.alt_data.composite_score.toFixed(2)}
            </p>
            <p className="text-sm font-semibold" style={{ color: compositeColor }}>
              {result.alt_data.composite_label}
            </p>
            <div className="flex justify-center gap-6 mt-3 text-xs text-gray-500">
              <span>{es ? 'Retorno Anual' : 'Ann. Return'}: <span className="font-data text-white">{(result.annualized_return * 100).toFixed(2)}%</span></span>
              <span>{es ? 'Volatilidad' : 'Volatility'}: <span className="font-data text-white">{(result.annualized_volatility * 100).toFixed(2)}%</span></span>
              <span>{es ? 'Observaciones' : 'Observations'}: <span className="font-data text-white">{result.n_observations}</span></span>
            </div>
          </div>

          {/* Alt Data Signal Dashboard */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Senales de Datos Alternativos' : 'Alternative Data Signals'}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(result.alt_data.signals).map(([key, signal]) => (
                <SignalGauge key={key} signal={signal} signalKey={key} />
              ))}
            </div>
          </div>

          {/* Return Distribution + VaR Lines */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Distribucion de Retornos con VaR/CVaR' : 'Return Distribution with VaR/CVaR'}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={distData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="return" tick={{ fill: '#888', fontSize: 11 }} unit="%" label={{ value: es ? 'Retorno Diario' : 'Daily Return', position: 'bottom', fill: '#666' }} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: '8px' }}
                  formatter={(value) => `${value}%`}
                />
                <Bar dataKey="probability" radius={[2, 2, 0, 0]}>
                  {distData.map((entry, i) => (
                    <Cell key={i} fill={entry.isTail ? '#ef4444' : '#00A651'} opacity={entry.isTail ? 0.8 : 0.5} />
                  ))}
                </Bar>
                <ReferenceLine
                  x={+(result.risk.quantum.quantum_var * 100).toFixed(2)}
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{ value: `VaR ${(result.risk.confidence * 100).toFixed(0)}%`, position: 'top', fill: '#ef4444', fontSize: 11 }}
                />
                <ReferenceLine
                  x={+(result.risk.quantum.quantum_cvar * 100).toFixed(2)}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  label={{ value: 'CVaR', position: 'top', fill: '#f59e0b', fontSize: 11 }}
                />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span><span className="inline-block w-3 h-1 bg-red-500 mr-1" />VaR {es ? '(Valor en Riesgo)' : '(Value at Risk)'}</span>
              <span><span className="inline-block w-3 h-1 bg-yellow-500 mr-1" />CVaR {es ? '(VaR Condicional)' : '(Conditional VaR)'}</span>
              <span><span className="inline-block w-3 h-3 bg-red-500/80 rounded mr-1" />{es ? 'Cola de Riesgo' : 'Risk Tail'}</span>
            </div>
          </div>

          {/* VaR Comparison Table */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Comparacion de Metodos VaR' : 'VaR Method Comparison'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-2 text-gray-400">{es ? 'Metodo' : 'Method'}</th>
                    <th className="text-right py-2 text-gray-400">VaR ({(result.risk.confidence * 100).toFixed(0)}%)</th>
                    <th className="text-right py-2 text-gray-400">CVaR</th>
                  </tr>
                </thead>
                <tbody className="font-data">
                  <tr className="border-b border-gray-900">
                    <td className="py-2 text-cyan-400">{result.risk.quantum.circuit_info.method.split('(')[0].trim()}</td>
                    <td className="text-right text-white">{(result.risk.quantum.quantum_var * 100).toFixed(3)}%</td>
                    <td className="text-right text-white">{(result.risk.quantum.quantum_cvar * 100).toFixed(3)}%</td>
                  </tr>
                  <tr className="border-b border-gray-900">
                    <td className="py-2 text-gray-300">{es ? 'Historico' : 'Historical'}</td>
                    <td className="text-right text-gray-400">{(result.risk.classical.historical_var * 100).toFixed(3)}%</td>
                    <td className="text-right text-gray-400">{(result.risk.classical.historical_cvar * 100).toFixed(3)}%</td>
                  </tr>
                  <tr className="border-b border-gray-900">
                    <td className="py-2 text-gray-300">{es ? 'Parametrico (Normal)' : 'Parametric (Normal)'}</td>
                    <td className="text-right text-gray-400">{(result.risk.classical.parametric_var * 100).toFixed(3)}%</td>
                    <td className="text-right text-gray-400">{(result.risk.classical.parametric_cvar * 100).toFixed(3)}%</td>
                  </tr>
                  <tr className="border-b border-gray-900">
                    <td className="py-2 text-gray-300">t-Distribution</td>
                    <td className="text-right text-gray-400">{(result.risk.classical.t_dist_var * 100).toFixed(3)}%</td>
                    <td className="text-right text-gray-400">{(result.risk.classical.t_dist_cvar * 100).toFixed(3)}%</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-yellow-400">{es ? 'Ajustado (Alt Data)' : 'Adjusted (Alt Data)'}</td>
                    <td className="text-right text-yellow-400">{(result.risk.adjusted.var * 100).toFixed(3)}%</td>
                    <td className="text-right text-yellow-400">{(result.risk.adjusted.cvar * 100).toFixed(3)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Circuit info */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span className="font-data text-cyan-400">{result.risk.quantum.circuit_info.method}</span>
            <span>Qubits: {result.risk.quantum.circuit_info.n_qubits}</span>
            <span>Bins: {result.risk.quantum.circuit_info.n_bins}</span>
            <span>Gates: {result.risk.quantum.circuit_info.gate_count}</span>
            <span>Depth: {result.risk.quantum.circuit_info.depth}</span>
            {!result.risk.qiskit_available && (
              <span className="text-yellow-500">Qiskit not installed — using Monte Carlo fallback</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
