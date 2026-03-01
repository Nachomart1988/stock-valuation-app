// src/app/components/tabs/PortfolioOptimizerTab.tsx
'use client';

import { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ScatterChart, Scatter, LineChart, Line, Legend,
  ResponsiveContainer, Cell,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface OptimizationResult {
  tickers: string[];
  optimalWeights: Record<string, number>;
  portfolioReturn: number;
  portfolioVolatility: number;
  portfolioSharpe: number;
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
  efficientFrontier: { return: number; risk: number; sharpe: number }[];
  monteCarloCloud: { return: number; risk: number; sharpe: number }[];
  correlationMatrix: { tickers: string[]; matrix: number[][] };
}

interface FactorRegressionResult {
  benchmark: string;
  period_days: number;
  factor_stats: { market_return_annual: number; market_vol_annual: number; market_sharpe: number };
  regressions: {
    ticker: string;
    alpha_annual: number;
    beta: number;
    r_squared: number;
    residual_vol_annual: number;
    information_ratio: number;
    market_risk_pct: number;
    idio_risk_pct: number;
    total_vol_annual: number;
    correlation_to_market: number;
  }[];
}

interface PCAResult {
  tickers: string[];
  n_components: number;
  components: {
    pc: number;
    variance_explained_pct: number;
    cumulative_variance_pct: number;
    eigenvalue: number;
    loadings: Record<string, number>;
  }[];
}

interface BlackLittermanResult {
  tickers: string[];
  bl_weights: Record<string, number>;
  market_weights: Record<string, number>;
  bl_expected_returns: Record<string, number>;
  implied_returns: Record<string, number>;
  market_caps: Record<string, number>;
  views_applied: number;
  bl_portfolio_metrics: { annual_return: number; annual_vol: number; sharpe: number };
  market_portfolio_metrics: { annual_return: number; annual_vol: number; sharpe: number };
}

interface RollingResult {
  tickers: string[];
  objective: string;
  window_days: number;
  step_days: number;
  windows: { date: string; weights: Record<string, number>; sharpe: number; annual_return: number; annual_vol: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OBJECTIVES = [
  { value: 'max_sharpe', label: 'Max Sharpe', labelEs: 'Max Sharpe' },
  { value: 'min_variance', label: 'Min Variance', labelEs: 'Min Varianza' },
  { value: 'risk_parity', label: 'Risk Parity', labelEs: 'Paridad de Riesgo' },
  { value: 'max_return', label: 'Max Return', labelEs: 'Max Retorno' },
];

const SUB_TAB_KEYS = ['optimization', 'frontier', 'factors', 'pca', 'bl', 'rolling'] as const;
type SubTabKey = typeof SUB_TAB_KEYS[number];
const SUB_TAB_LABELS: Record<SubTabKey, { es: string; en: string }> = {
  optimization: { es: 'Optimización', en: 'Optimization' },
  frontier:     { es: 'Frontera Eficiente', en: 'Efficient Frontier' },
  factors:      { es: 'Factores', en: 'Factors' },
  pca:          { es: 'PCA', en: 'PCA' },
  bl:           { es: 'Black-Litterman', en: 'Black-Litterman' },
  rolling:      { es: 'Rolling', en: 'Rolling' },
};

const TICKER_COLORS = [
  '#a855f7', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899',
  '#06b6d4', '#f97316', '#84cc16', '#8b5cf6', '#10b981',
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const fmtPctRaw = (v: number) => `${(v * 100).toFixed(2)}%`;

function sharpeToColor(sharpe: number): string {
  if (sharpe > 1.5) return '#22c55e';
  if (sharpe > 1.0) return '#86efac';
  if (sharpe > 0.5) return '#fbbf24';
  if (sharpe > 0) return '#fb923c';
  return '#ef4444';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-tab components (defined inside file for locality)
// ─────────────────────────────────────────────────────────────────────────────

function EfficientFrontierTab({ result }: { result: OptimizationResult | null }) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  if (!result) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        {es ? 'Ejecuta la optimización primero (pestaña Optimización)' : 'Run optimization first (Optimization tab)'}
      </div>
    );
  }

  const cloudData = (result.monteCarloCloud || []).slice(0, 1000).map((pt) => ({
    risk: parseFloat((pt.risk * 100).toFixed(3)),
    return: parseFloat((pt.return * 100).toFixed(3)),
    sharpe: pt.sharpe,
    fill: sharpeToColor(pt.sharpe),
  }));

  const frontierData = (result.efficientFrontier || []).map((pt) => ({
    risk: parseFloat((pt.risk * 100).toFixed(3)),
    return: parseFloat((pt.return * 100).toFixed(3)),
    sharpe: pt.sharpe,
  }));

  const optimalPoint = [{
    risk: parseFloat((result.portfolioVolatility * 100).toFixed(3)),
    return: parseFloat((result.portfolioReturn * 100).toFixed(3)),
    sharpe: result.portfolioSharpe,
  }];

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-1">{es ? 'Frontera Eficiente + Nube Monte Carlo' : 'Efficient Frontier + Monte Carlo Cloud'}</h4>
        <p className="text-xs text-gray-500">{es ? 'Color = Sharpe ratio (verde=alto, rojo=bajo). Estrella = portafolio óptimo.' : 'Color = Sharpe ratio (green=high, red=low). Star = optimal portfolio.'}</p>
      </div>

      <div className="bg-black/50 rounded-xl p-3">
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="risk"
              name="Volatilidad"
              unit="%"
              label={{ value: es ? 'Volatilidad Anual (%)' : 'Annual Volatility (%)', position: 'insideBottom', offset: -15, fill: '#9ca3af', fontSize: 12 }}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
            />
            <YAxis
              dataKey="return"
              name="Retorno"
              unit="%"
              label={{ value: es ? 'Retorno Anual (%)' : 'Annual Return (%)', angle: -90, position: 'insideLeft', fill: '#9ca3af', fontSize: 12 }}
              tick={{ fill: '#9ca3af', fontSize: 11 }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: '#6b7280' }}
              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value: any) => [`${Number(value ?? 0).toFixed(2)}%`]}
            />
            {/* Monte Carlo cloud */}
            <Scatter name="Monte Carlo" data={cloudData} opacity={0.4}>
              {cloudData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Scatter>
            {/* Efficient frontier */}
            <Scatter name={es ? 'Frontera Eficiente' : 'Efficient Frontier'} data={frontierData} fill="#a855f7" opacity={0.9} line={{ stroke: '#a855f7', strokeWidth: 2 }} lineType="joint" shape="circle" />
            {/* Optimal portfolio */}
            <Scatter name={es ? 'Óptimo' : 'Optimal'} data={optimalPoint} fill="#fbbf24" shape="star" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> {es ? 'Alto Sharpe (>1.5)' : 'High Sharpe (>1.5)'}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" /> {es ? 'Sharpe medio' : 'Mid Sharpe'}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> {es ? 'Bajo Sharpe' : 'Low Sharpe'}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-violet-500 inline-block" /> {es ? 'Frontera eficiente' : 'Efficient frontier'}</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-300 inline-block" /> {es ? 'Portafolio óptimo' : 'Optimal portfolio'}</span>
      </div>

      {/* Frontier table */}
      {frontierData.length > 0 && (
        <div className="bg-black/30 rounded-xl p-4">
          <h5 className="text-xs font-semibold text-gray-400 mb-2 uppercase">{es ? 'Puntos de Frontera Eficiente' : 'Efficient Frontier Points'}</h5>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-green-900/20">
                  <th className="text-right py-1 pr-3">{es ? 'Retorno' : 'Return'}</th>
                  <th className="text-right py-1 pr-3">{es ? 'Volatilidad' : 'Volatility'}</th>
                  <th className="text-right py-1">Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {frontierData.filter((_, i) => i % 3 === 0).map((pt, i) => (
                  <tr key={i} className="border-t border-green-900/20/40">
                    <td className={`py-1 pr-3 text-right ${pt.return >= 0 ? 'text-green-400' : 'text-red-400'}`}>{pt.return.toFixed(2)}%</td>
                    <td className="py-1 pr-3 text-right text-yellow-400">{pt.risk.toFixed(2)}%</td>
                    <td className="py-1 text-right text-violet-400">{pt.sharpe.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FactorAnalysisTab({
  tickers,
  backendUrl,
}: { tickers: string[]; backendUrl: string }) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const [benchmark, setBenchmark] = useState('SPY');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FactorRegressionResult | null>(null);

  const runAnalysis = useCallback(async () => {
    if (tickers.length < 1) { setError(es ? 'Necesitas al menos 1 ticker' : 'Need at least 1 ticker'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/portfolio/factor-regression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, benchmark, period_days: 756 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [tickers, benchmark, backendUrl]);

  const riskBarData = result?.regressions.map((r) => ({
    ticker: r.ticker,
    market: parseFloat(r.market_risk_pct.toFixed(1)),
    idio: parseFloat(r.idio_risk_pct.toFixed(1)),
  })) || [];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Benchmark</label>
          <input
            type="text"
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value.toUpperCase())}
            className="w-24 px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
          />
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
        >
          {loading ? (es ? 'Analizando...' : 'Analyzing...') : (es ? 'Ejecutar Análisis' : 'Run Analysis')}
        </button>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm">{error}</div>}

      {result && (
        <>
          {/* Benchmark stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: es ? 'Retorno Anual' : 'Annual Return', value: fmtPct(result.factor_stats.market_return_annual), color: 'text-green-400' },
              { label: es ? 'Volatilidad Anual' : 'Annual Volatility', value: fmtPctRaw(result.factor_stats.market_vol_annual), color: 'text-yellow-400' },
              { label: `Sharpe (${result.benchmark})`, value: result.factor_stats.market_sharpe.toFixed(3), color: 'text-violet-400' },
            ].map((m) => (
              <div key={m.label} className="bg-black/30 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 uppercase mb-1">{m.label}</div>
                <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Regressions table */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Resultados de Regresión OLS' : 'OLS Regression Results'}</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-green-900/20 text-right">
                    <th className="text-left py-2">Ticker</th>
                    <th className="py-2 pr-2">Alpha (anual)</th>
                    <th className="py-2 pr-2">Beta</th>
                    <th className="py-2 pr-2">R²</th>
                    <th className="py-2 pr-2">Vol Residual</th>
                    <th className="py-2 pr-2">Info Ratio</th>
                    <th className="py-2 pr-2">{es ? 'Riesgo Mkt %' : 'Mkt Risk %'}</th>
                    <th className="py-2 pr-2">{es ? 'Riesgo Idio %' : 'Idio Risk %'}</th>
                    <th className="py-2">Corr Mkt</th>
                  </tr>
                </thead>
                <tbody>
                  {result.regressions.map((r) => (
                    <tr key={r.ticker} className="border-t border-green-900/20/40">
                      <td className="py-2 font-semibold text-violet-400">{r.ticker}</td>
                      <td className={`py-2 pr-2 text-right ${r.alpha_annual >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(r.alpha_annual)}</td>
                      <td className="py-2 pr-2 text-right text-gray-200">{r.beta.toFixed(3)}</td>
                      <td className="py-2 pr-2 text-right text-gray-200">{(r.r_squared * 100).toFixed(1)}%</td>
                      <td className="py-2 pr-2 text-right text-yellow-400">{fmtPctRaw(r.residual_vol_annual)}</td>
                      <td className={`py-2 pr-2 text-right ${r.information_ratio >= 0 ? 'text-green-400' : 'text-red-400'}`}>{r.information_ratio.toFixed(3)}</td>
                      <td className="py-2 pr-2 text-right text-blue-400">{r.market_risk_pct.toFixed(1)}%</td>
                      <td className="py-2 pr-2 text-right text-orange-400">{r.idio_risk_pct.toFixed(1)}%</td>
                      <td className="py-2 text-right text-gray-300">{r.correlation_to_market.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk decomposition bar chart */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Descomposición de Riesgo (Mercado vs Idiosincrático)' : 'Risk Decomposition (Market vs Idiosyncratic)'}</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={riskBarData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="ticker" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis unit="%" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(v: any) => [`${Number(v).toFixed(1)}%`]}
                />
                <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                <Bar dataKey="market" name={es ? 'Riesgo Mercado %' : 'Market Risk %'} fill="#3b82f6" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="idio" name={es ? 'Riesgo Idiosincrático %' : 'Idiosyncratic Risk %'} fill="#f97316" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

function PCATab({
  tickers,
  backendUrl,
}: { tickers: string[]; backendUrl: string }) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const [nComponents, setNComponents] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PCAResult | null>(null);

  const runPCA = useCallback(async () => {
    if (tickers.length < 2) { setError(es ? 'Necesitas al menos 2 tickers' : 'Need at least 2 tickers'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/portfolio/pca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, period_days: 756, n_components: nComponents }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [tickers, nComponents, backendUrl]);

  const screePlotData = result?.components.map((c) => ({
    pc: `PC${c.pc}`,
    variance: parseFloat(c.variance_explained_pct.toFixed(2)),
    cumulative: parseFloat(c.cumulative_variance_pct.toFixed(2)),
  })) || [];

  function loadingColor(v: number): string {
    if (v > 0.3) return 'text-green-400 font-semibold';
    if (v > 0.1) return 'text-green-300';
    if (v < -0.3) return 'text-red-400 font-semibold';
    if (v < -0.1) return 'text-red-300';
    return 'text-gray-400';
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{es ? 'Componentes' : 'Components'}: {nComponents}</label>
          <input
            type="range"
            min={2}
            max={Math.min(10, tickers.length)}
            value={nComponents}
            onChange={(e) => setNComponents(parseInt(e.target.value))}
            className="w-40 accent-violet-500"
          />
        </div>
        <button
          onClick={runPCA}
          disabled={loading}
          className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
        >
          {loading ? (es ? 'Calculando...' : 'Calculating...') : (es ? 'Ejecutar PCA' : 'Run PCA')}
        </button>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm">{error}</div>}

      {result && (
        <>
          {/* Scree plot */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Scree Plot — Varianza Explicada por Componente' : 'Scree Plot — Variance Explained per Component'}</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={screePlotData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="pc" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <YAxis unit="%" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(v: any) => [`${Number(v).toFixed(2)}%`]}
                />
                <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                <Bar dataKey="variance" name={es ? 'Varianza %' : 'Variance %'} fill="#a855f7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cumulative" name={es ? 'Acumulada %' : 'Cumulative %'} fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Loadings table */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Matriz de Cargas (Loadings) — verde=positivo, rojo=negativo' : 'Loadings Matrix — green=positive, red=negative'}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-green-900/20">
                    <th className="text-left py-2">Ticker</th>
                    {result.components.map((c) => (
                      <th key={c.pc} className="text-right py-2 pr-3">
                        <div className="text-violet-400">PC{c.pc}</div>
                        <div className="text-gray-600">{c.variance_explained_pct.toFixed(1)}%</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.tickers.map((ticker) => (
                    <tr key={ticker} className="border-t border-green-900/20/40">
                      <td className="py-2 font-semibold text-violet-400">{ticker}</td>
                      {result.components.map((c) => {
                        const v = c.loadings[ticker] ?? 0;
                        return (
                          <td key={c.pc} className={`py-2 pr-3 text-right ${loadingColor(v)}`}>
                            {v.toFixed(3)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {result.components.map((c) => (
              <div key={c.pc} className="bg-black/50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">PC{c.pc} (λ={c.eigenvalue.toFixed(3)})</div>
                <div className="text-sm font-bold text-violet-400">{c.variance_explained_pct.toFixed(2)}%</div>
                <div className="text-xs text-gray-500">{es ? 'Acum' : 'Cum'}: {c.cumulative_variance_pct.toFixed(2)}%</div>
                <div className="mt-1 h-1.5 bg-gray-600 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full" style={{ width: `${Math.min(c.variance_explained_pct, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BlackLittermanTab({
  tickers,
  backendUrl,
  optimizationResult,
}: { tickers: string[]; backendUrl: string; optimizationResult: OptimizationResult | null }) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const [views, setViews] = useState<Record<string, string>>({});
  const [viewConfidence, setViewConfidence] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BlackLittermanResult | null>(null);

  // Initialize views when tickers change
  useEffect(() => {
    const init: Record<string, string> = {};
    tickers.forEach((t) => { init[t] = ''; });
    setViews(init);
  }, [tickers]);

  const runBL = useCallback(async () => {
    if (tickers.length < 2) { setError(es ? 'Necesitas al menos 2 tickers' : 'Need at least 2 tickers'); return; }
    const viewsList = Object.entries(views)
      .filter(([, v]) => v !== '')
      .map(([asset, v]) => ({ asset, return_view: parseFloat(v) / 100 }))
      .filter((v) => !isNaN(v.return_view));

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/portfolio/black-litterman`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, views: viewsList, view_confidence: viewConfidence, period_days: 756, risk_aversion: 2.5 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [tickers, views, viewConfidence, backendUrl]);

  return (
    <div className="space-y-5">
      {/* Views input */}
      <div className="bg-black/30 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">
          {es ? 'Vistas del Inversor (opcional — deja en blanco para usar solo equilibrio)' : 'Investor Views (optional — leave blank to use equilibrium only)'}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {tickers.map((ticker) => (
            <div key={ticker}>
              <label className="block text-xs text-gray-400 mb-1">{ticker} {es ? 'retorno esperado (%)' : 'expected return (%)'}</label>
              <input
                type="number"
                step="0.1"
                placeholder="ej. 15.0"
                value={views[ticker] ?? ''}
                onChange={(e) => setViews((prev) => ({ ...prev, [ticker]: e.target.value }))}
                className="w-full px-3 py-2 bg-black/60 border border-green-900/20 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{es ? 'Confianza en Vistas' : 'View Confidence'}: {(viewConfidence * 100).toFixed(0)}%</label>
            <input
              type="range"
              min={5}
              max={95}
              step={5}
              value={viewConfidence * 100}
              onChange={(e) => setViewConfidence(parseInt(e.target.value) / 100)}
              className="w-40 accent-violet-500"
            />
          </div>
          <button
            onClick={runBL}
            disabled={loading}
            className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
          >
            {loading ? (es ? 'Calculando...' : 'Calculating...') : (es ? 'Ejecutar Black-Litterman' : 'Run Black-Litterman')}
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm">{error}</div>}

      {result && (
        <>
          {/* Portfolio metrics comparison */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: es ? 'Portafolio BL' : 'BL Portfolio', m: result.bl_portfolio_metrics, color: 'violet' },
              { label: es ? 'Portafolio Mkt (Cap)' : 'Mkt Cap Portfolio', m: result.market_portfolio_metrics, color: 'blue' },
            ].map(({ label, m, color }) => (
              <div key={label} className="bg-black/30 rounded-xl p-4">
                <h5 className={`text-sm font-semibold text-${color}-400 mb-3`}>{label}</h5>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">{es ? 'Retorno Anual' : 'Annual Return'}</span><span className={m.annual_return >= 0 ? 'text-green-400' : 'text-red-400'}>{fmtPct(m.annual_return)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">{es ? 'Volatilidad' : 'Volatility'}</span><span className="text-yellow-400">{fmtPctRaw(m.annual_vol)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Sharpe</span><span className="text-violet-400">{m.sharpe.toFixed(3)}</span></div>
                </div>
              </div>
            ))}
          </div>

          {/* Weights comparison table */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Comparación de Pesos' : 'Weights Comparison'} ({result.views_applied} {es ? 'vista(s) aplicada(s)' : 'view(s) applied'})
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-green-900/20 text-right">
                    <th className="text-left py-2">Ticker</th>
                    <th className="py-2 pr-3">{es ? 'Peso BL' : 'BL Weight'}</th>
                    <th className="py-2 pr-3">{es ? 'Peso Mkt Cap' : 'Mkt Cap Weight'}</th>
                    {optimizationResult && <th className="py-2 pr-3">{es ? 'Peso Optimizer' : 'Optimizer Weight'}</th>}
                    <th className="py-2 pr-3">{es ? 'Retorno BL' : 'BL Return'}</th>
                    <th className="py-2">{es ? 'Retorno Implícito' : 'Implied Return'}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tickers.map((ticker) => (
                    <tr key={ticker} className="border-t border-green-900/20/40">
                      <td className="py-2 font-semibold text-violet-400">{ticker}</td>
                      <td className="py-2 pr-3 text-right text-violet-300">{((result.bl_weights[ticker] ?? 0) * 100).toFixed(2)}%</td>
                      <td className="py-2 pr-3 text-right text-blue-300">{((result.market_weights[ticker] ?? 0) * 100).toFixed(2)}%</td>
                      {optimizationResult && (
                        <td className="py-2 pr-3 text-right text-green-300">
                          {((optimizationResult.optimalWeights[ticker] ?? 0) * 100).toFixed(2)}%
                        </td>
                      )}
                      <td className={`py-2 pr-3 text-right ${(result.bl_expected_returns[ticker] ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {fmtPct(result.bl_expected_returns[ticker] ?? 0)}
                      </td>
                      <td className={`py-2 text-right ${(result.implied_returns[ticker] ?? 0) >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                        {fmtPct(result.implied_returns[ticker] ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Market caps */}
          <div className="bg-black/30 rounded-xl p-4">
            <h5 className="text-xs font-semibold text-gray-400 mb-2 uppercase">{es ? 'Cap. de Mercado Usada para Prior (USD B)' : 'Market Cap Used for Prior (USD B)'}</h5>
            <div className="flex flex-wrap gap-2">
              {result.tickers.map((t) => (
                <div key={t} className="bg-black/50 rounded-lg px-3 py-2 text-xs">
                  <span className="text-violet-400 font-semibold">{t}</span>
                  <span className="text-gray-300 ml-2">${result.market_caps[t]?.toFixed(1)}B</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RollingTab({
  tickers,
  backendUrl,
}: { tickers: string[]; backendUrl: string }) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const [objective, setObjective] = useState('max_sharpe');
  const [windowDays, setWindowDays] = useState(252);
  const [stepDays, setStepDays] = useState(21);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RollingResult | null>(null);

  const runRolling = useCallback(async () => {
    if (tickers.length < 2) { setError(es ? 'Necesitas al menos 2 tickers' : 'Need at least 2 tickers'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/portfolio/rolling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, objective, window_days: windowDays, step_days: stepDays, period_days: 756, max_weight: 0.4 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [tickers, objective, windowDays, stepDays, backendUrl]);

  // Build line chart data: [{date, AAPL: 0.25, MSFT: 0.30, ...}, ...]
  const lineData = result?.windows.map((w) => ({
    date: w.date.slice(0, 10),
    sharpe: parseFloat(w.sharpe.toFixed(3)),
    ...Object.fromEntries(
      Object.entries(w.weights).map(([t, v]) => [t, parseFloat((v * 100).toFixed(2))])
    ),
  })) || [];

  const lastWindow = result?.windows[result.windows.length - 1];

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{es ? 'Objetivo' : 'Objective'}</label>
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm"
          >
            {OBJECTIVES.map((o) => <option key={o.value} value={o.value}>{es ? o.labelEs : o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{es ? 'Ventana' : 'Window'}</label>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(parseInt(e.target.value))}
            className="px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm"
          >
            <option value={63}>{es ? '3M (63d)' : '3M (63d)'}</option>
            <option value={126}>{es ? '6M (126d)' : '6M (126d)'}</option>
            <option value={252}>{es ? '1A (252d)' : '1Y (252d)'}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{es ? 'Paso' : 'Step'}</label>
          <select
            value={stepDays}
            onChange={(e) => setStepDays(parseInt(e.target.value))}
            className="px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm"
          >
            <option value={5}>{es ? 'Semanal (5d)' : 'Weekly (5d)'}</option>
            <option value={21}>{es ? 'Mensual (21d)' : 'Monthly (21d)'}</option>
          </select>
        </div>
        <button
          onClick={runRolling}
          disabled={loading}
          className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
        >
          {loading ? (es ? 'Calculando...' : 'Calculating...') : (es ? 'Ejecutar Rolling' : 'Run Rolling')}
        </button>
      </div>

      {error && <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 text-sm">{error}</div>}

      {result && lineData.length > 0 && (
        <>
          {/* Weight evolution chart */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Evolución de Pesos por Ventana' : 'Weight Evolution per Window'} ({result.windows.length} {es ? 'ventanas' : 'windows'})
            </h4>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  interval="preserveStartEnd"
                />
                <YAxis unit="%" tick={{ fill: '#9ca3af', fontSize: 11 }} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(v: any) => [`${Number(v).toFixed(2)}%`]}
                />
                <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                {result.tickers.map((ticker, i) => (
                  <Line
                    key={ticker}
                    type="monotone"
                    dataKey={ticker}
                    stroke={TICKER_COLORS[i % TICKER_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    name={ticker}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sharpe evolution */}
          <div className="bg-black/30 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Evolución del Sharpe' : 'Sharpe Evolution'}</h4>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={lineData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} angle={-30} textAnchor="end" interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} formatter={(v: any) => [Number(v).toFixed(3)]} />
                <Line type="monotone" dataKey="sharpe" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Last window stats */}
          {lastWindow && (
            <div className="bg-black/30 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Última Ventana' : 'Last Window'} ({lastWindow.date.slice(0, 10)})</h4>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-black/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">Sharpe</div>
                  <div className="text-lg font-bold text-green-400">{lastWindow.sharpe.toFixed(3)}</div>
                </div>
                <div className="bg-black/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">{es ? 'Retorno Anual' : 'Annual Return'}</div>
                  <div className={`text-lg font-bold ${lastWindow.annual_return >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(lastWindow.annual_return)}</div>
                </div>
                <div className="bg-black/50 rounded-lg p-3 text-center">
                  <div className="text-xs text-gray-500">{es ? 'Volatilidad Anual' : 'Annual Volatility'}</div>
                  <div className="text-lg font-bold text-yellow-400">{fmtPctRaw(lastWindow.annual_vol)}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(lastWindow.weights)
                  .sort(([, a], [, b]) => b - a)
                  .map(([t, w], i) => (
                    <div key={t} className="bg-black/50 rounded-lg px-3 py-2 text-xs flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: TICKER_COLORS[i % TICKER_COLORS.length] }} />
                      <span className="text-violet-400 font-semibold">{t}</span>
                      <span className="text-gray-300">{(w * 100).toFixed(1)}%</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function PortfolioOptimizerTab() {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState('');
  const [diaryLoaded, setDiaryLoaded] = useState(false);

  // Auto-load open positions from diary
  useEffect(() => {
    if (diaryLoaded) return;

    const getOpenSymbols = (trades: any[]): string[] =>
      [...new Set(
        trades
          .filter((t: any) => t.state === 'Open' && t.symbol)
          .map((t: any) => t.symbol.toUpperCase().trim())
      )] as string[];

    try {
      const raw = localStorage.getItem('diario_trades_v2');
      if (raw) {
        const trades = JSON.parse(raw);
        const openSymbols = getOpenSymbols(trades);
        if (openSymbols.length >= 2) {
          setTickerInput(openSymbols.join(', '));
          setDiaryLoaded(true);
          return;
        }
      }
    } catch { /* ignore parse errors */ }

    (async () => {
      try {
        const res = await fetch('/api/diary');
        if (res.ok) {
          const data = await res.json();
          const trades = data?.trades || [];
          const openSymbols = getOpenSymbols(trades);
          if (openSymbols.length >= 2) {
            setTickerInput(openSymbols.join(', '));
            setDiaryLoaded(true);
            return;
          }
        }
      } catch { /* ignore */ }

      setTickerInput('AAPL, MSFT, GOOGL, AMZN, NVDA');
      setDiaryLoaded(true);
    })();
  }, [diaryLoaded]);

  const [objective, setObjective] = useState('max_sharpe');
  const [maxWeight, setMaxWeight] = useState(0.40);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>('optimization');

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const parsedTickers = tickerInput.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);

  const runOptimization = useCallback(async () => {
    const tickers = tickerInput.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
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
      setActiveSubTab('optimization');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tickerInput, objective, maxWeight, backendUrl, es]);

  const fmtPctLocal = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-xl font-bold text-violet-400">
          {es ? 'Optimización de Portafolio' : 'Portfolio Optimization'}
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          {es
            ? 'Markowitz mean-variance · Monte Carlo · Factores · PCA · Black-Litterman · Rolling'
            : 'Markowitz mean-variance · Monte Carlo · Factors · PCA · Black-Litterman · Rolling'}
        </p>
      </div>

      {/* Shared Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm text-gray-400 mb-1">Tickers ({es ? 'separados por coma' : 'comma separated'})</label>
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            className="w-full px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm focus:border-violet-500 focus:outline-none"
            placeholder="AAPL, MSFT, GOOGL, AMZN"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">{es ? 'Objetivo' : 'Objective'}</label>
          <select
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            className="w-full px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm"
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
              className="w-20 px-3 py-2 bg-black/50 border border-green-900/20 rounded-lg text-white text-sm"
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

      {/* Sub-tab Navigation */}
      <div className="flex flex-wrap gap-1 border-b border-green-900/20 pb-0">
        {SUB_TAB_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all border-b-2 ${
              activeSubTab === key
                ? 'text-violet-400 border-violet-500 bg-black/50'
                : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-black/60/30'
            }`}
          >
            {es ? SUB_TAB_LABELS[key].es : SUB_TAB_LABELS[key].en}
          </button>
        ))}
      </div>

      {/* Sub-tab Content */}
      <div className="min-h-75">
        {/* ── Optimización ─────────────────────────────────────────── */}
        {activeSubTab === 'optimization' && result && (
          <>
            {/* Optimal Weights */}
            <div className="bg-black/30 rounded-xl p-5 mb-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-4">
                {es ? 'Pesos Óptimos' : 'Optimal Weights'}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {Object.entries(result.optimalWeights)
                  .sort(([, a], [, b]) => b - a)
                  .map(([ticker, weight]) => (
                    <div key={ticker} className="bg-black/50 rounded-lg p-3 text-center">
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
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Sharpe', value: result.riskMetrics.sharpe.toFixed(2), color: 'text-green-400' },
                { label: 'Sortino', value: result.riskMetrics.sortino.toFixed(2), color: 'text-green-400' },
                { label: es ? 'Retorno Anual' : 'Annual Return', value: fmtPctLocal(result.riskMetrics.annualReturn), color: result.riskMetrics.annualReturn >= 0 ? 'text-green-400' : 'text-red-400' },
                { label: es ? 'Volatilidad' : 'Volatility', value: `${(result.riskMetrics.annualVolatility * 100).toFixed(2)}%`, color: 'text-yellow-400' },
                { label: 'VaR 95%', value: fmtPctLocal(result.riskMetrics.var95), color: 'text-red-400' },
                { label: 'CVaR', value: fmtPctLocal(result.riskMetrics.cvar), color: 'text-red-400' },
                { label: 'Max Drawdown', value: fmtPctLocal(result.riskMetrics.maxDrawdown), color: 'text-red-400' },
                { label: 'Calmar', value: result.riskMetrics.calmar.toFixed(2), color: 'text-cyan-400' },
              ].map((m) => (
                <div key={m.label} className="bg-black/30 rounded-lg p-3">
                  <div className="text-xs text-gray-500 uppercase">{m.label}</div>
                  <div className={`text-lg font-semibold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Individual Stats */}
            <div className="bg-black/30 rounded-xl p-4 mb-4">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">
                {es ? 'Estadísticas Individuales' : 'Individual Stats'}
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-green-900/20">
                      <th className="text-left py-2">Ticker</th>
                      <th className="text-right py-2">{es ? 'Peso' : 'Weight'}</th>
                      <th className="text-right py-2">{es ? 'Retorno' : 'Return'}</th>
                      <th className="text-right py-2">{es ? 'Volatilidad' : 'Volatility'}</th>
                      <th className="text-right py-2">Sharpe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.individualStats.map((s) => (
                      <tr key={s.ticker} className="border-t border-green-900/15">
                        <td className="py-2 font-semibold text-violet-400">{s.ticker}</td>
                        <td className="py-2 text-right text-gray-300">{(s.weight * 100).toFixed(1)}%</td>
                        <td className={`py-2 text-right ${s.annualReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmtPctLocal(s.annualReturn)}
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
              <div className="bg-black/30 rounded-xl p-4">
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

        {activeSubTab === 'optimization' && !result && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500 text-sm gap-2">
            <div className="text-4xl opacity-30">∑</div>
            <p>{es ? 'Ingresa tickers y haz clic en "Optimizar" para ver los resultados' : 'Enter tickers and click "Optimize" to see results'}</p>
          </div>
        )}

        {/* ── Frontera Eficiente ────────────────────────────────────── */}
        {activeSubTab === 'frontier' && (
          <EfficientFrontierTab result={result} />
        )}

        {/* ── Factores ─────────────────────────────────────────────── */}
        {activeSubTab === 'factors' && (
          <FactorAnalysisTab tickers={parsedTickers} backendUrl={backendUrl} />
        )}

        {/* ── PCA ──────────────────────────────────────────────────── */}
        {activeSubTab === 'pca' && (
          <PCATab tickers={parsedTickers} backendUrl={backendUrl} />
        )}

        {/* ── Black-Litterman ──────────────────────────────────────── */}
        {activeSubTab === 'bl' && (
          <BlackLittermanTab
            tickers={parsedTickers}
            backendUrl={backendUrl}
            optimizationResult={result}
          />
        )}

        {/* ── Rolling ──────────────────────────────────────────────── */}
        {activeSubTab === 'rolling' && (
          <RollingTab tickers={parsedTickers} backendUrl={backendUrl} />
        )}
      </div>
    </div>
  );
}
