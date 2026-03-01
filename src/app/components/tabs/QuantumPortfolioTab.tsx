'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, Cell, Legend,
} from 'recharts';

interface QuantumPortfolioTabProps {
  ticker?: string;
}

interface QuantumResult {
  tickers: string[];
  quantum: {
    weights: number[];
    return: number;
    risk: number;
    sharpe: number;
    selected_assets: number[];
    circuit_info: {
      method: string;
      n_qubits: number;
      n_layers: number;
      total_gates: number;
      converged: boolean;
    };
    top_states: Array<{ bitstring: string; probability: number; cost: number }>;
  };
  classical: {
    weights: number[];
    return: number;
    risk: number;
    sharpe: number;
  };
  comparison: {
    return_diff: number;
    risk_diff: number;
    sharpe_diff: number;
  };
  mean_returns: number[];
  risk_per_asset: number[];
  pennylane_available: boolean;
}

const COLORS = ['#00A651', '#34d97b', '#00c05a', '#4ade80', '#16a34a', '#22c55e', '#15803d', '#10b981', '#059669', '#047857'];

export default function QuantumPortfolioTab({ ticker }: QuantumPortfolioTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickersInput, setTickersInput] = useState(ticker ? `${ticker}, AAPL, MSFT, GOOGL` : 'AAPL, MSFT, GOOGL, AMZN, NVDA');
  const [riskAversion, setRiskAversion] = useState(1.0);
  const [nLayers, setNLayers] = useState(2);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuantumResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runOptimization = async () => {
    setLoading(true);
    setError(null);
    try {
      const tickers = tickersInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      if (tickers.length < 2) {
        setError(es ? 'Se necesitan al menos 2 tickers' : 'Need at least 2 tickers');
        return;
      }
      if (tickers.length > 10) {
        setError(es ? 'Maximo 10 tickers para optimizacion cuantica' : 'Max 10 tickers for quantum optimization');
        return;
      }

      const resp = await fetch(`${backendUrl}/quantum/portfolio-optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, risk_aversion: riskAversion, n_layers: nLayers, period_days: 756 }),
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

  // Prepare comparison data for chart
  const comparisonData = result ? result.tickers.map((t, i) => ({
    ticker: t,
    quantum: +(result.quantum.weights[i] * 100).toFixed(1),
    classical: +(result.classical.weights[i] * 100).toFixed(1),
  })) : [];

  // Scatter data for risk/return
  const scatterData = result ? result.tickers.map((t, i) => ({
    name: t,
    risk: +(result.risk_per_asset[i] * 100).toFixed(2),
    return: +(result.mean_returns[i] * 100).toFixed(2),
  })) : [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-green-900/30 border border-green-500/30 flex items-center justify-center">
          <span className="text-lg">&#x269B;</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            {es ? 'Optimizador de Portafolio Cuantico' : 'Quantum Portfolio Optimizer'}
          </h2>
          <p className="text-xs text-gray-500">
            QAOA — Quantum Approximate Optimization Algorithm
          </p>
        </div>
      </div>

      {/* Input controls */}
      <div className="bg-black/40 rounded-xl border border-green-900/20 p-4 space-y-4">
        <div>
          <label className="text-sm text-gray-400 mb-1 block">Tickers ({es ? 'separados por coma' : 'comma-separated'})</label>
          <input
            type="text"
            className="input font-data"
            value={tickersInput}
            onChange={(e) => setTickersInput(e.target.value)}
            placeholder="AAPL, MSFT, GOOGL, AMZN"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400 mb-1 block">
              {es ? 'Aversion al riesgo' : 'Risk Aversion'}: {riskAversion.toFixed(1)}
            </label>
            <input
              type="range" min="0.1" max="5" step="0.1"
              value={riskAversion}
              onChange={(e) => setRiskAversion(parseFloat(e.target.value))}
              className="w-full accent-green-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">
              QAOA Layers: {nLayers}
            </label>
            <input
              type="range" min="1" max="5" step="1"
              value={nLayers}
              onChange={(e) => setNLayers(parseInt(e.target.value))}
              className="w-full accent-green-500"
            />
          </div>
        </div>

        <button
          onClick={runOptimization}
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold transition-all bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {es ? 'Optimizando...' : 'Optimizing...'}
            </span>
          ) : (
            es ? 'Ejecutar Optimizacion Cuantica' : 'Run Quantum Optimization'
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
          {/* Circuit Info */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Informacion del Circuito' : 'Circuit Information'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: es ? 'Metodo' : 'Method', value: result.quantum.circuit_info.method },
                { label: 'Qubits', value: result.quantum.circuit_info.n_qubits },
                { label: 'Layers', value: result.quantum.circuit_info.n_layers },
                { label: 'Gates', value: result.quantum.circuit_info.total_gates },
                { label: es ? 'Convergido' : 'Converged', value: result.quantum.circuit_info.converged ? 'Yes' : 'No' },
              ].map((item) => (
                <div key={item.label} className="text-center p-2 bg-gray-900/50 rounded-lg">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-sm font-data text-white">{item.value}</p>
                </div>
              ))}
            </div>
            {!result.pennylane_available && (
              <p className="text-xs text-yellow-500/70 mt-2">
                PennyLane not installed — using classical brute-force fallback
              </p>
            )}
          </div>

          {/* QAOA Layer Visualization */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Circuito QAOA' : 'QAOA Circuit'}
            </h3>
            <div className="flex items-center gap-1 overflow-x-auto pb-2">
              {/* Initial H gates */}
              <div className="shrink-0 flex flex-col gap-1">
                {result.tickers.map((_, i) => (
                  <div key={`h-${i}`} className="w-8 h-8 rounded bg-blue-600/30 border border-blue-500/50 flex items-center justify-center text-xs font-data text-blue-400">
                    H
                  </div>
                ))}
              </div>
              {/* QAOA layers */}
              {Array.from({ length: result.quantum.circuit_info.n_layers }).map((_, layer) => (
                <div key={`layer-${layer}`} className="shrink-0 flex items-center gap-1">
                  <div className="flex flex-col gap-1">
                    {result.tickers.map((_, i) => (
                      <div key={`cost-${layer}-${i}`} className="w-10 h-8 rounded bg-green-600/30 border border-green-500/50 flex items-center justify-center text-xs font-data text-green-400">
                        U_C
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    {result.tickers.map((_, i) => (
                      <div key={`mix-${layer}-${i}`} className="w-10 h-8 rounded bg-purple-600/30 border border-purple-500/50 flex items-center justify-center text-xs font-data text-purple-400">
                        RX
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* Measurement */}
              <div className="shrink-0 flex flex-col gap-1">
                {result.tickers.map((_, i) => (
                  <div key={`m-${i}`} className="w-8 h-8 rounded bg-yellow-600/30 border border-yellow-500/50 flex items-center justify-center text-xs font-data text-yellow-400">
                    M
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span><span className="inline-block w-3 h-3 rounded bg-blue-600/30 mr-1" />Hadamard</span>
              <span><span className="inline-block w-3 h-3 rounded bg-green-600/30 mr-1" />{es ? 'Unitario Costo' : 'Cost Unitary'}</span>
              <span><span className="inline-block w-3 h-3 rounded bg-purple-600/30 mr-1" />Mixer (RX)</span>
              <span><span className="inline-block w-3 h-3 rounded bg-yellow-600/30 mr-1" />{es ? 'Medicion' : 'Measurement'}</span>
            </div>
          </div>

          {/* Quantum vs Classical Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Weights comparison bar chart */}
            <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-green-400 mb-3">
                {es ? 'Pesos: Cuantico vs Clasico' : 'Weights: Quantum vs Classical'}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={comparisonData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis dataKey="ticker" tick={{ fill: '#888', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#888', fontSize: 12 }} unit="%" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Legend />
                  <Bar dataKey="quantum" name={es ? 'Cuantico' : 'Quantum'} fill="#00A651" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="classical" name={es ? 'Clasico' : 'Classical'} fill="#555" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Risk-Return scatter */}
            <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-green-400 mb-3">
                {es ? 'Riesgo vs Retorno por Activo' : 'Risk vs Return per Asset'}
              </h3>
              <ResponsiveContainer width="100%" height={250}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis dataKey="risk" name={es ? 'Riesgo' : 'Risk'} unit="%" tick={{ fill: '#888', fontSize: 12 }} />
                  <YAxis dataKey="return" name={es ? 'Retorno' : 'Return'} unit="%" tick={{ fill: '#888', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: '8px' }}
                    formatter={(value) => `${value}%`}
                  />
                  <Scatter data={scatterData} fill="#00A651">
                    {scatterData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Metrics comparison table */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Comparacion de Metricas' : 'Metrics Comparison'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left py-2 text-gray-400">{es ? 'Metrica' : 'Metric'}</th>
                    <th className="text-right py-2 text-green-400">{es ? 'Cuantico' : 'Quantum'}</th>
                    <th className="text-right py-2 text-gray-400">{es ? 'Clasico' : 'Classical'}</th>
                    <th className="text-right py-2 text-gray-400">{es ? 'Diferencia' : 'Diff'}</th>
                  </tr>
                </thead>
                <tbody className="font-data">
                  <tr className="border-b border-gray-900">
                    <td className="py-2 text-gray-300">{es ? 'Retorno Esperado' : 'Expected Return'}</td>
                    <td className="text-right text-white">{(result.quantum.return * 100).toFixed(2)}%</td>
                    <td className="text-right text-gray-400">{(result.classical.return * 100).toFixed(2)}%</td>
                    <td className={`text-right ${result.comparison.return_diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {result.comparison.return_diff >= 0 ? '+' : ''}{(result.comparison.return_diff * 100).toFixed(2)}%
                    </td>
                  </tr>
                  <tr className="border-b border-gray-900">
                    <td className="py-2 text-gray-300">{es ? 'Riesgo (Vol)' : 'Risk (Vol)'}</td>
                    <td className="text-right text-white">{(result.quantum.risk * 100).toFixed(2)}%</td>
                    <td className="text-right text-gray-400">{(result.classical.risk * 100).toFixed(2)}%</td>
                    <td className={`text-right ${result.comparison.risk_diff <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {result.comparison.risk_diff >= 0 ? '+' : ''}{(result.comparison.risk_diff * 100).toFixed(2)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 text-gray-300">Sharpe Ratio</td>
                    <td className="text-right text-white">{result.quantum.sharpe.toFixed(3)}</td>
                    <td className="text-right text-gray-400">{result.classical.sharpe.toFixed(3)}</td>
                    <td className={`text-right ${result.comparison.sharpe_diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {result.comparison.sharpe_diff >= 0 ? '+' : ''}{result.comparison.sharpe_diff.toFixed(3)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Top quantum states */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'Estados Cuanticos Principales' : 'Top Quantum States'}
            </h3>
            <div className="space-y-2">
              {result.quantum.top_states.map((state, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="font-data text-xs text-gray-500 w-6">#{i + 1}</span>
                  <span className="font-data text-sm text-green-400 tracking-wider">|{state.bitstring}&#x27E9;</span>
                  <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-600 to-emerald-500 rounded-full"
                      style={{ width: `${Math.min(state.probability * 100, 100)}%` }}
                    />
                  </div>
                  <span className="font-data text-xs text-gray-400 w-16 text-right">
                    {(state.probability * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
