'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Legend, ScatterChart, Scatter,
} from 'recharts';

interface DRLTradingTabProps {
  ticker?: string;
}

interface DRLResult {
  ticker: string;
  algorithm: string;
  sb3_available: boolean;
  trades: Array<{ step: number; action: string; price: number; shares: number }>;
  pnl_curve: number[];
  benchmark_curve: number[];
  training_curve: number[];
  action_distribution: { hold: number; buy: number; sell: number };
  metrics: {
    total_return: number;
    benchmark_return: number;
    alpha: number;
    sharpe?: number;
    max_drawdown?: number;
    win_rate?: number;
    n_trades: number;
    n_round_trips?: number;
    final_value: number;
    initial_capital: number;
  };
  train_days: number;
  test_days: number;
  training_steps?: number;
}

export default function DRLTradingTab({ ticker }: DRLTradingTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState(ticker || 'AAPL');
  const [algorithm, setAlgorithm] = useState('PPO');
  const [trainingSteps, setTrainingSteps] = useState(10000);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DRLResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runSimulation = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${backendUrl}/drl/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: tickerInput.toUpperCase().trim(),
          algorithm,
          training_steps: trainingSteps,
          initial_capital: initialCapital,
          period_days: 756,
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

  // Prepare PnL chart data
  const pnlData = result ? result.pnl_curve.map((val, i) => ({
    day: i,
    agent: +val.toFixed(2),
    benchmark: result.benchmark_curve[i] ? +result.benchmark_curve[i].toFixed(2) : null,
  })) : [];

  // Action distribution chart
  const actionData = result ? [
    { action: 'Hold', count: result.action_distribution.hold, fill: '#555' },
    { action: es ? 'Compra' : 'Buy', count: result.action_distribution.buy, fill: '#00A651' },
    { action: es ? 'Venta' : 'Sell', count: result.action_distribution.sell, fill: '#ef4444' },
  ] : [];

  // Trade scatter for buy/sell signals
  const tradeData = result ? result.trades.map(t => ({
    step: t.step,
    price: t.price,
    action: t.action,
  })) : [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-violet-900/30 border border-violet-500/30 flex items-center justify-center">
          <span className="text-lg">&#x1F916;</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            {es ? 'Simulador de Trading con Deep RL' : 'Deep RL Trading Simulator'}
          </h2>
          <p className="text-xs text-gray-500">
            PPO / A2C — Proximal Policy Optimization / Advantage Actor-Critic
          </p>
        </div>
      </div>

      {/* Input controls */}
      <div className="bg-black/40 rounded-xl border border-green-900/20 p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
            <label className="text-sm text-gray-400 mb-1 block">{es ? 'Algoritmo' : 'Algorithm'}</label>
            <select
              className="input"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
            >
              <option value="PPO">PPO</option>
              <option value="A2C">A2C</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">
              {es ? 'Pasos de entrenamiento' : 'Training Steps'}: {trainingSteps.toLocaleString()}
            </label>
            <input
              type="range" min="2000" max="20000" step="1000"
              value={trainingSteps}
              onChange={(e) => setTrainingSteps(parseInt(e.target.value))}
              className="w-full accent-green-500"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400 mb-1 block">
              {es ? 'Capital Inicial' : 'Initial Capital'}
            </label>
            <input
              type="number"
              className="input font-data"
              value={initialCapital}
              onChange={(e) => setInitialCapital(parseInt(e.target.value) || 10000)}
            />
          </div>
        </div>

        <button
          onClick={runSimulation}
          disabled={loading}
          className="w-full py-3 rounded-xl font-semibold transition-all bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {es ? 'Entrenando agente...' : 'Training agent...'}
            </span>
          ) : (
            es ? 'Entrenar y Simular' : 'Train & Simulate'
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
          {/* Agent info + key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: es ? 'Retorno Agente' : 'Agent Return',
                value: `${(result.metrics.total_return * 100).toFixed(2)}%`,
                color: result.metrics.total_return >= 0 ? 'text-green-400' : 'text-red-400',
              },
              {
                label: 'Benchmark (B&H)',
                value: `${(result.metrics.benchmark_return * 100).toFixed(2)}%`,
                color: result.metrics.benchmark_return >= 0 ? 'text-green-400' : 'text-red-400',
              },
              {
                label: 'Alpha',
                value: `${result.metrics.alpha >= 0 ? '+' : ''}${(result.metrics.alpha * 100).toFixed(2)}%`,
                color: result.metrics.alpha >= 0 ? 'text-green-400' : 'text-red-400',
              },
              {
                label: es ? 'Operaciones' : 'Trades',
                value: result.metrics.n_trades.toString(),
                color: 'text-white',
              },
            ].map((m) => (
              <div key={m.label} className="bg-black/40 rounded-xl border border-green-900/20 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                <p className={`text-lg font-data font-bold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Extended metrics row — DRL mode */}
          {result.metrics.sharpe !== undefined && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Sharpe</p>
                <p className={`text-lg font-data font-bold ${result.metrics.sharpe > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {result.metrics.sharpe.toFixed(3)}
                </p>
              </div>
              <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Max Drawdown</p>
                <p className="text-lg font-data font-bold text-red-400">
                  {((result.metrics.max_drawdown || 0) * 100).toFixed(2)}%
                </p>
              </div>
              <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                <p className="text-lg font-data font-bold text-white">
                  {((result.metrics.win_rate || 0) * 100).toFixed(0)}%
                </p>
              </div>
              <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{es ? 'Valor Final' : 'Final Value'}</p>
                <p className="text-lg font-data font-bold text-white">
                  ${result.metrics.final_value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </p>
              </div>
            </div>
          )}

          {/* Fallback mode: show final value row when SB3 not available */}
          {!result.sb3_available && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{es ? 'Valor Final' : 'Final Value'}</p>
                <p className="text-lg font-data font-bold text-white">
                  ${result.metrics.final_value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </p>
              </div>
              <div className="bg-yellow-900/10 rounded-xl border border-yellow-500/20 p-3 text-center">
                <p className="text-xs text-yellow-500/80 mb-1">{es ? 'Modo' : 'Mode'}</p>
                <p className="text-sm font-semibold text-yellow-400">
                  {es ? 'Momentum (Fallback)' : 'Momentum (Fallback)'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {es ? 'PPO/A2C disponible pronto' : 'PPO/A2C coming soon'}
                </p>
              </div>
            </div>
          )}

          {/* PnL chart */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
            <h3 className="text-sm font-semibold text-green-400 mb-3">
              {es ? 'PnL: Agente vs Buy & Hold' : 'PnL: Agent vs Buy & Hold'}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="day" tick={{ fill: '#888', fontSize: 11 }} label={{ value: es ? 'Dia' : 'Day', position: 'bottom', fill: '#666' }} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: '8px' }}
                  formatter={(value) => [`$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`, '']}
                  labelFormatter={(label) => `${es ? 'Dia' : 'Day'} ${label}`}
                />
                <Legend />
                <Line type="monotone" dataKey="agent" name={es ? 'Agente DRL' : 'DRL Agent'} stroke="#00A651" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="benchmark" name="Buy & Hold" stroke="#555" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Action distribution + trades */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Action distribution */}
            <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-green-400 mb-3">
                {es ? 'Distribucion de Acciones' : 'Action Distribution'}
              </h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={actionData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis type="number" tick={{ fill: '#888', fontSize: 11 }} />
                  <YAxis dataKey="action" type="category" tick={{ fill: '#888', fontSize: 12 }} width={60} />
                  <Tooltip contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: '8px' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {actionData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Recent trades table */}
            <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-green-400 mb-3">
                {es ? 'Ultimas Operaciones' : 'Recent Trades'} ({result.trades.length})
              </h3>
              <div className="max-h-[200px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-green-900/20">
                      <th className="text-left py-1.5 text-gray-500">{es ? 'Dia' : 'Day'}</th>
                      <th className="text-left py-1.5 text-gray-500">{es ? 'Accion' : 'Action'}</th>
                      <th className="text-right py-1.5 text-gray-500">{es ? 'Precio' : 'Price'}</th>
                      <th className="text-right py-1.5 text-gray-500">{es ? 'Cantidad' : 'Shares'}</th>
                    </tr>
                  </thead>
                  <tbody className="font-data">
                    {result.trades.slice(-20).map((t, i) => (
                      <tr key={i} className="border-b border-gray-900/50">
                        <td className="py-1 text-gray-400">{t.step}</td>
                        <td className={`py-1 font-semibold ${t.action === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                          {t.action === 'buy' ? (es ? 'COMPRA' : 'BUY') : (es ? 'VENTA' : 'SELL')}
                        </td>
                        <td className="py-1 text-right text-white">${t.price.toFixed(2)}</td>
                        <td className="py-1 text-right text-gray-400">{t.shares}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Algorithm info */}
          <div className="bg-black/40 rounded-xl border border-green-900/20 p-3 flex items-center gap-4 text-xs text-gray-500">
            <span className="font-data text-green-400">{result.algorithm}</span>
            <span>{es ? 'Entrenamiento' : 'Training'}: {result.train_days} {es ? 'dias' : 'days'}</span>
            <span>{es ? 'Evaluacion' : 'Test'}: {result.test_days} {es ? 'dias' : 'days'}</span>
            {result.training_steps && <span>{result.training_steps.toLocaleString()} steps</span>}
            {!result.sb3_available && (
              <span className="text-yellow-500">
                {es ? 'Modo momentum RSI — PPO/A2C se activa cuando se instale stable-baselines3' : 'RSI momentum mode — PPO/A2C activates once stable-baselines3 is installed'}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
