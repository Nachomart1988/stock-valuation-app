// src/app/components/tabs/PortfolioOptimizerTab.tsx
'use client';

import { useState, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface OptimizationResult {
  optimalWeights: Record<string, number>;
  riskMetrics: {
    sharpe: number;
    sortino: number;
    var95: number;
    var99: number;
    cvar: number;
    maxDrawdown: number;
    calmar: number;
    annualReturn: number;
    annualVolatility: number;
  };
  individualStats: {
    ticker: string;
    annualReturn: number;
    annualVolatility: number;
    sharpe: number;
    weight: number;
  }[];
  efficientFrontier: { return_val: number; risk: number; sharpe: number }[];
  monteCarloCloud: { return_val: number; risk: number; sharpe: number }[];
  correlationMatrix: { tickers: string[]; matrix: number[][] };
}

const OBJECTIVES = [
  { value: 'max_sharpe', label: 'Max Sharpe', labelEs: 'Max Sharpe' },
  { value: 'min_variance', label: 'Min Variance', labelEs: 'Min Varianza' },
  { value: 'risk_parity', label: 'Risk Parity', labelEs: 'Paridad de Riesgo' },
  { value: 'max_return', label: 'Max Return', labelEs: 'Max Retorno' },
];

export default function PortfolioOptimizerTab() {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState('AAPL, MSFT, GOOGL, AMZN, NVDA');
  const [objective, setObjective] = useState('max_sharpe');
  const [maxWeight, setMaxWeight] = useState(0.40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runOptimization = useCallback(async () => {
    const tickers = tickerInput.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length < 2) {
      setError(es ? 'Necesitas al menos 2 tickers' : 'Need at least 2 tickers');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/portfolio/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, objective, maxWeight, periodDays: 756 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tickerInput, objective, maxWeight, backendUrl, es]);

  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-xl font-bold text-violet-400">
          {es ? 'Optimización de Portafolio' : 'Portfolio Optimization'}
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          {es
            ? 'Markowitz mean-variance con simulación Monte Carlo'
            : 'Markowitz mean-variance with Monte Carlo simulation'}
        </p>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm text-gray-400 mb-1">Tickers ({es ? 'separados por coma' : 'comma separated'})</label>
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
            placeholder="AAPL, MSFT, GOOGL, AMZN"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{es ? 'Objetivo' : 'Objective'}</label>
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
          >
            {OBJECTIVES.map((o) => (
              <option key={o.value} value={o.value}>{es ? o.labelEs : o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{es ? 'Peso Máx.' : 'Max Weight'}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={maxWeight * 100}
              onChange={(e) => setMaxWeight(parseFloat(e.target.value) / 100 || 0.40)}
              className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              min={10}
              max={100}
              step={5}
            />
            <span className="text-gray-400 text-sm">%</span>
            <button
              onClick={runOptimization}
              disabled={loading}
              className="ml-auto px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
            >
              {loading ? (es ? 'Optimizando...' : 'Optimizing...') : (es ? 'Optimizar' : 'Optimize')}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300">{error}</div>
      )}

      {result && (
        <>
          {/* Optimal Weights */}
          <div className="bg-gray-700/30 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-4">
              {es ? 'Pesos Óptimos' : 'Optimal Weights'}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {Object.entries(result.optimalWeights)
                .sort(([, a], [, b]) => b - a)
                .map(([ticker, weight]) => (
                  <div key={ticker} className="bg-gray-800/60 rounded-lg p-3 text-center">
                    <div className="text-sm font-bold text-violet-400">{ticker}</div>
                    <div className="text-lg font-bold text-white">{(weight * 100).toFixed(1)}%</div>
                    <div className="mt-1 h-2 bg-gray-600 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full"
                        style={{ width: `${weight * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Portfolio Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {[
              { label: 'Sharpe', value: result.riskMetrics.sharpe.toFixed(2), color: 'text-green-400' },
              { label: 'Sortino', value: result.riskMetrics.sortino.toFixed(2), color: 'text-green-400' },
              { label: es ? 'Retorno Anual' : 'Annual Return', value: fmtPct(result.riskMetrics.annualReturn * 100), color: result.riskMetrics.annualReturn >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: es ? 'Volatilidad' : 'Volatility', value: `${(result.riskMetrics.annualVolatility * 100).toFixed(2)}%`, color: 'text-yellow-400' },
              { label: 'VaR 95%', value: fmtPct(result.riskMetrics.var95 * 100), color: 'text-red-400' },
              { label: 'CVaR', value: fmtPct(result.riskMetrics.cvar * 100), color: 'text-red-400' },
              { label: 'Max Drawdown', value: fmtPct(result.riskMetrics.maxDrawdown * 100), color: 'text-red-400' },
              { label: 'Calmar', value: result.riskMetrics.calmar.toFixed(2), color: 'text-cyan-400' },
            ].map((m) => (
              <div key={m.label} className="bg-gray-700/30 rounded-lg p-3">
                <div className="text-xs text-gray-500 uppercase">{m.label}</div>
                <div className={`text-lg font-semibold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Individual Stats */}
          <div className="bg-gray-700/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Estadísticas Individuales' : 'Individual Stats'}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs border-b border-gray-700">
                    <th className="text-left py-2">Ticker</th>
                    <th className="text-right py-2">{es ? 'Peso' : 'Weight'}</th>
                    <th className="text-right py-2">{es ? 'Retorno' : 'Return'}</th>
                    <th className="text-right py-2">{es ? 'Volatilidad' : 'Volatility'}</th>
                    <th className="text-right py-2">Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {result.individualStats.map((s) => (
                    <tr key={s.ticker} className="border-t border-gray-700/50">
                      <td className="py-2 font-semibold text-violet-400">{s.ticker}</td>
                      <td className="py-2 text-right text-gray-300">{(s.weight * 100).toFixed(1)}%</td>
                      <td className={`py-2 text-right ${s.annualReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fmtPct(s.annualReturn * 100)}
                      </td>
                      <td className="py-2 text-right text-yellow-400">{(s.annualVolatility * 100).toFixed(1)}%</td>
                      <td className={`py-2 text-right ${s.sharpe >= 1 ? 'text-green-400' : 'text-gray-300'}`}>
                        {s.sharpe.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Correlation Matrix */}
          {result.correlationMatrix && (
            <div className="bg-gray-700/30 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">
                {es ? 'Matriz de Correlación' : 'Correlation Matrix'}
              </h4>
              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-1"></th>
                      {result.correlationMatrix.tickers.map((t) => (
                        <th key={t} className="px-3 py-1 text-violet-400 font-semibold">{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.correlationMatrix.tickers.map((t, i) => (
                      <tr key={t}>
                        <td className="px-3 py-1 font-semibold text-violet-400">{t}</td>
                        {result.correlationMatrix.matrix[i].map((v, j) => {
                          const color = v > 0.7 ? 'text-red-400' : v > 0.3 ? 'text-yellow-400' : 'text-green-400';
                          return (
                            <td key={j} className={`px-3 py-1 text-center ${i === j ? 'text-gray-500' : color}`}>
                              {v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
