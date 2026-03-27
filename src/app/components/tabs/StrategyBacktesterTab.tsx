'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface BacktestResult {
  strategy_name: string;
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  total_trades: number;
  equity_curve: number[];
  trades: Array<{ date: string; action: string; price: number; shares: number; reason: string }>;
  insights: string;
  mode: string;
}

interface MCPResult {
  mode: 'mcp_ready';
  prompt: string;
  mcp_url: string;
}

type Result = BacktestResult | MCPResult;

function isMCPResult(r: Result): r is MCPResult {
  return r.mode === 'mcp_ready';
}

export default function StrategyBacktesterTab() {
  const [strategyText, setStrategyText] = useState(
    "Comprar en breakout de High-Tight Flag con volumen >2x promedio, trail con 20-DMA, salir si sentiment cae por debajo de 50"
  );
  const [ticker, setTicker] = useState("AAPL");
  const [periodDays, setPeriodDays] = useState(756);
  const [mode, setMode] = useState<'local' | 'mcp'>('local');
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  const runBacktest = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(`${backendUrl}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: strategyText,
          ticker,
          period_days: periodDays,
          mode,
        }),
      });
      if (!res.ok) throw new Error(`Backend error: ${res.status}`);
      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Error running backtest');
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = (text: string) => {
    navigator.clipboard.writeText(text);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl flex items-center justify-center text-white font-bold text-xl">BT</div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white">AI Strategy Backtester</h2>
          <span className="px-3 py-1 text-xs bg-violet-500/10 text-violet-400 rounded-full font-mono hidden sm:inline">MCP Powered</span>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="inline-flex bg-gray-900 border border-white/10 rounded-3xl p-1">
        <button
          onClick={() => setMode('local')}
          className={`px-4 sm:px-6 py-3 rounded-3xl text-sm font-medium transition-all ${mode === 'local' ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'}`}
        >
          Simulación Local (rápida)
        </button>
        <button
          onClick={() => setMode('mcp')}
          className={`px-4 sm:px-6 py-3 rounded-3xl text-sm font-medium transition-all ${mode === 'mcp' ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'}`}
        >
          MCP + Claude / Cursor (real)
        </button>
      </div>

      {/* Input Area */}
      <div className="bg-gray-900/70 border border-white/10 rounded-3xl p-6 sm:p-8">
        <textarea
          value={strategyText}
          onChange={(e) => setStrategyText(e.target.value)}
          className="w-full h-36 bg-black border border-white/10 rounded-2xl p-4 sm:p-6 text-white resize-none focus:outline-none focus:border-violet-500 text-sm sm:text-base"
          placeholder="Describe tu estrategia en lenguaje natural..."
        />

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-2">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-white font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-2">Período</label>
            <select
              value={periodDays}
              onChange={(e) => setPeriodDays(Number(e.target.value))}
              className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-white"
            >
              <option value={252}>1 año</option>
              <option value={504}>2 años</option>
              <option value={756}>3 años</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={runBacktest}
              disabled={loading || !strategyText.trim()}
              className="w-full h-[56px] bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white font-semibold rounded-2xl transition disabled:opacity-50"
            >
              {loading ? 'Ejecutando...' : mode === 'mcp' ? 'Generar Prompt MCP' : 'Ejecutar Backtest Local'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Resultados */}
      {result && (
        <div className="space-y-8">
          {isMCPResult(result) ? (
            <div className="bg-black border border-cyan-400/30 rounded-3xl p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <p className="text-cyan-400 text-sm">Prompt listo para Claude / Cursor</p>
                <button
                  onClick={() => copyPrompt(result.prompt)}
                  className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-sm rounded-xl transition"
                >
                  {promptCopied ? 'Copiado!' : 'Copiar Prompt'}
                </button>
              </div>
              <pre className="bg-gray-950 text-xs text-gray-300 p-6 rounded-2xl overflow-auto max-h-[420px] whitespace-pre-wrap">
                {result.prompt}
              </pre>
              <p className="mt-6 text-xs text-gray-500">
                Usa esta URL MCP: <span className="font-mono text-cyan-300 break-all">{result.mcp_url}</span>
              </p>
            </div>
          ) : (
            <>
              {/* Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-900/70 border border-emerald-400/20 rounded-3xl p-5 sm:p-6">
                  <p className="text-xs text-gray-400">Retorno Total</p>
                  <p className={`text-3xl sm:text-4xl font-bold ${result.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {result.total_return_pct}%
                  </p>
                </div>
                <div className="bg-gray-900/70 border border-white/10 rounded-3xl p-5 sm:p-6">
                  <p className="text-xs text-gray-400">Sharpe Ratio</p>
                  <p className="text-3xl sm:text-4xl font-bold text-white">{result.sharpe_ratio}</p>
                </div>
                <div className="bg-gray-900/70 border border-red-400/20 rounded-3xl p-5 sm:p-6">
                  <p className="text-xs text-gray-400">Max Drawdown</p>
                  <p className="text-3xl sm:text-4xl font-bold text-red-400">{result.max_drawdown_pct}%</p>
                </div>
                <div className="bg-gray-900/70 border border-white/10 rounded-3xl p-5 sm:p-6">
                  <p className="text-xs text-gray-400">Win Rate</p>
                  <p className="text-3xl sm:text-4xl font-bold text-white">{result.win_rate_pct}%</p>
                </div>
              </div>

              {/* Equity Curve */}
              <div className="bg-gray-900/70 border border-white/10 rounded-3xl p-6 sm:p-8">
                <h3 className="text-lg font-semibold mb-6">Equity Curve</h3>
                <ResponsiveContainer width="100%" height={420}>
                  <LineChart data={result.equity_curve.map((v: number, i: number) => ({ day: i, equity: v }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="day" tick={{ fill: '#71717a', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', borderColor: '#3b82f6', borderRadius: '12px' }}
                      labelStyle={{ color: '#a1a1aa' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Trade Log */}
              {result.trades && result.trades.length > 0 && (
                <div className="bg-gray-900/70 border border-white/10 rounded-3xl p-6 sm:p-8">
                  <h3 className="text-lg font-semibold mb-4">Trade Log ({result.total_trades} trades)</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 border-b border-white/10">
                          <th className="text-left py-2 px-3">Fecha</th>
                          <th className="text-left py-2 px-3">Acción</th>
                          <th className="text-right py-2 px-3">Precio</th>
                          <th className="text-right py-2 px-3">Shares</th>
                          <th className="text-left py-2 px-3">Razón</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t, i) => (
                          <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                            <td className="py-2 px-3 text-gray-300 font-mono text-xs">{t.date}</td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${t.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                {t.action.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right text-white font-mono">${t.price}</td>
                            <td className="py-2 px-3 text-right text-gray-300">{t.shares}</td>
                            <td className="py-2 px-3 text-gray-400 text-xs">{t.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Insights */}
              <div className="bg-gray-900/70 border border-white/10 rounded-3xl p-6 text-sm text-gray-300">
                <h3 className="text-base font-semibold mb-2 text-white">Insights</h3>
                {result.insights}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
