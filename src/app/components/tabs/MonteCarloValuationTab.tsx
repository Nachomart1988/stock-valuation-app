// src/app/components/tabs/MonteCarloValuationTab.tsx
// Monte Carlo Advanced Valuation Tab — Dynamic Markov Regime Switching + Longstaff-Schwartz
'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { useLanguage } from '@/i18n/LanguageContext';
import { postBackend } from '@/lib/backendClient';

interface MonteCarloValuationTabProps {
  ticker: string;
  income?: any[];
  balance?: any[];
  quote?: any;
  profile?: any;
  wacc?: number | null;
}

interface AdvMCResult {
  ticker: string;
  mean_equity_value: number;
  median_equity_value: number;
  std_dev: number;
  percentile_5: number;
  percentile_10: number;
  percentile_25: number;
  percentile_75: number;
  percentile_90: number;
  percentile_95: number;
  probability_undervalued: number;
  real_options_value: number;
  expansion_option_value: number;
  abandonment_option_value: number;
  early_exercise_premium: number;
  regime_statistics: { Bull: number; Base: number; Bear: number };
  sensitivity: Array<{ variable: string; impact: number }>;
  distribution: Array<{ bin: number; count: number }>;
  narrative: string;
  var_95: number;
  cvar_95: number;
  n_simulations: number;
  years: number;
  current_price: number;
  upside_pct: number;
  signal: string;
}

const SIGNAL_COLORS: Record<string, string> = {
  STRONG_BUY: '#10b981',
  BUY: '#34d399',
  HOLD: '#fbbf24',
  SELL: '#f87171',
  STRONG_SELL: '#ef4444',
};

function fmtUSD(n: number | null | undefined, digits = 2): string {
  if (n == null || !isFinite(n)) return 'N/A';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function KpiCard({
  label, value, color = 'text-white', sub,
}: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-black/40 border border-green-900/20 rounded-2xl p-5">
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`text-3xl font-bold mt-1 font-data ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function MonteCarloValuationTab({
  ticker, income, balance, quote, profile, wacc,
}: MonteCarloValuationTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  // ── Derive sane defaults from already-loaded fundamentals ──────────────
  const defaults = useMemo(() => {
    const latestIncome = Array.isArray(income) && income.length > 0 ? income[0] : null;
    const latestBalance = Array.isArray(balance) && balance.length > 0 ? balance[0] : null;
    const currentRevenue = latestIncome?.revenue || 0;
    const sharesOutstanding =
      latestIncome?.weightedAverageShsOutDil ||
      latestIncome?.weightedAverageShsOut ||
      quote?.sharesOutstanding ||
      0;
    const totalDebt = (latestBalance?.totalDebt ?? 0);
    const cash = (latestBalance?.cashAndShortTermInvestments ?? latestBalance?.cashAndCashEquivalents ?? 0);
    const netDebt = Math.max(0, totalDebt - cash);
    const opMargin = currentRevenue > 0 && latestIncome?.operatingIncome
      ? Math.min(0.42, Math.max(0.04, latestIncome.operatingIncome / currentRevenue))
      : 0.175;
    const waccDefault = wacc && isFinite(wacc) && wacc > 0 ? wacc : 0.095;
    return {
      currentRevenue,
      sharesOutstanding,
      netDebt,
      currentPrice: quote?.price || 0,
      operatingMarginMean: +opMargin.toFixed(4),
      waccMean: +waccDefault.toFixed(4),
    };
  }, [income, balance, quote, wacc]);

  const [inputs, setInputs] = useState({
    years: 8,
    nSimulations: 12000,
    operatingMarginMean: defaults.operatingMarginMean,
    waccMean: defaults.waccMean,
    terminalGrowth: 0.03,
    taxRate: 0.25,
    reinvestmentRate: 0.33,
    expansionStrike: Math.max(10, Math.round((quote?.price || 50) * 0.6)),
    abandonmentStrike: Math.max(20, Math.round((quote?.price || 50) * 1.05)),
    riskFreeRate: 0.04,
  });

  const [result, setResult] = useState<AdvMCResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = defaults.currentRevenue > 0 && defaults.sharesOutstanding > 0;

  const runSimulation = async () => {
    if (!canRun) {
      setError(es
        ? 'Faltan datos fundamentales (revenue / shares outstanding) — analiza un ticker primero.'
        : 'Missing fundamentals (revenue / shares outstanding) — analyze a ticker first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ticker,
        current_revenue: defaults.currentRevenue,
        shares_outstanding: defaults.sharesOutstanding,
        net_debt: defaults.netDebt,
        current_price: defaults.currentPrice,
        years: inputs.years,
        n_simulations: inputs.nSimulations,
        operating_margin_mean: inputs.operatingMarginMean,
        wacc_mean: inputs.waccMean,
        terminal_growth_mean: inputs.terminalGrowth,
        tax_rate: inputs.taxRate,
        reinvestment_rate: inputs.reinvestmentRate,
        expansion_strike: inputs.expansionStrike,
        abandonment_strike: inputs.abandonmentStrike,
        risk_free_rate: inputs.riskFreeRate,
      };
      const data = await postBackend<AdvMCResult>('/monte-carlo-advanced/predict', payload, 90_000);
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Backend error');
    } finally {
      setLoading(false);
    }
  };

  const signalColor = result ? (SIGNAL_COLORS[result.signal] || '#9ca3af') : '#9ca3af';
  const probColor = result && result.probability_undervalued > 60
    ? 'text-emerald-400'
    : result && result.probability_undervalued < 40 ? 'text-red-400' : 'text-amber-400';

  const regimeData = result ? [
    { name: 'Bull', value: result.regime_statistics.Bull, fill: '#10b981' },
    { name: 'Base', value: result.regime_statistics.Base, fill: '#3b82f6' },
    { name: 'Bear', value: result.regime_statistics.Bear, fill: '#ef4444' },
  ] : [];

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-700/40 to-fuchsia-700/40 border border-violet-500/30 flex items-center justify-center">
          <span className="text-xl">&#x1F3B2;</span>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">
            {es ? 'Monte Carlo DCF + Dynamic Regime Switching' : 'Monte Carlo DCF + Dynamic Regime Switching'}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Longstaff-Schwartz Real Options &middot; Markov Chain Regimes &middot; Full Path Simulation
          </p>
        </div>
      </div>

      {/* Input controls */}
      <div className="bg-black/40 border border-green-900/20 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Anos' : 'Years'}</label>
            <input
              type="number" min={3} max={15} value={inputs.years}
              onChange={(e) => setInputs({ ...inputs, years: Math.max(3, Math.min(15, parseInt(e.target.value) || 8)) })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Simulaciones' : 'Simulations'}</label>
            <select
              value={inputs.nSimulations}
              onChange={(e) => setInputs({ ...inputs, nSimulations: parseInt(e.target.value) })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            >
              <option value={3000}>3,000 (rapido)</option>
              <option value={6000}>6,000</option>
              <option value={12000}>12,000 (default)</option>
              <option value={25000}>25,000 (preciso)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Margen Op. medio' : 'Op Margin Mean'}</label>
            <input
              type="number" step="0.01" min={0.04} max={0.42} value={inputs.operatingMarginMean}
              onChange={(e) => setInputs({ ...inputs, operatingMarginMean: parseFloat(e.target.value) || 0.175 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">WACC base</label>
            <input
              type="number" step="0.005" min={0.05} max={0.18} value={inputs.waccMean}
              onChange={(e) => setInputs({ ...inputs, waccMean: parseFloat(e.target.value) || 0.095 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Crecimiento terminal' : 'Terminal Growth'}</label>
            <input
              type="number" step="0.005" min={0} max={0.06} value={inputs.terminalGrowth}
              onChange={(e) => setInputs({ ...inputs, terminalGrowth: parseFloat(e.target.value) || 0.03 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Tasa de impuesto' : 'Tax Rate'}</label>
            <input
              type="number" step="0.01" min={0} max={0.4} value={inputs.taxRate}
              onChange={(e) => setInputs({ ...inputs, taxRate: parseFloat(e.target.value) || 0.25 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Reinversion' : 'Reinvestment'}</label>
            <input
              type="number" step="0.01" min={0} max={0.7} value={inputs.reinvestmentRate}
              onChange={(e) => setInputs({ ...inputs, reinvestmentRate: parseFloat(e.target.value) || 0.33 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Strike Expansion ($)' : 'Expansion Strike ($)'}</label>
            <input
              type="number" step="1" min={1} value={inputs.expansionStrike}
              onChange={(e) => setInputs({ ...inputs, expansionStrike: parseFloat(e.target.value) || 28 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Strike Abandono ($)' : 'Abandonment Strike ($)'}</label>
            <input
              type="number" step="1" min={1} value={inputs.abandonmentStrike}
              onChange={(e) => setInputs({ ...inputs, abandonmentStrike: parseFloat(e.target.value) || 52 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Tasa libre de riesgo' : 'Risk-free Rate'}</label>
            <input
              type="number" step="0.005" min={0} max={0.1} value={inputs.riskFreeRate}
              onChange={(e) => setInputs({ ...inputs, riskFreeRate: parseFloat(e.target.value) || 0.04 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>

        {/* Auto-detected fundamentals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-green-900/15 text-xs">
          <div>
            <div className="text-gray-500">Revenue (TTM)</div>
            <div className="font-data text-gray-200">{fmtUSD(defaults.currentRevenue, 0)}</div>
          </div>
          <div>
            <div className="text-gray-500">Shares Out.</div>
            <div className="font-data text-gray-200">
              {defaults.sharesOutstanding ? (defaults.sharesOutstanding / 1e6).toFixed(1) + 'M' : 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Net Debt</div>
            <div className="font-data text-gray-200">{fmtUSD(defaults.netDebt, 0)}</div>
          </div>
          <div>
            <div className="text-gray-500">{es ? 'Precio actual' : 'Current price'}</div>
            <div className="font-data text-gray-200">{fmtUSD(defaults.currentPrice)}</div>
          </div>
        </div>

        <button
          onClick={runSimulation}
          disabled={loading || !canRun}
          className="w-full py-3.5 rounded-xl font-semibold transition-all bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {es ? `Simulando ${inputs.nSimulations.toLocaleString()} paths con Regime Switching + LSM...`
                  : `Simulating ${inputs.nSimulations.toLocaleString()} paths with Regime Switching + LSM...`}
            </span>
          ) : (
            es ? 'Ejecutar Simulacion' : 'Run Simulation'
          )}
        </button>

        {!canRun && (
          <p className="text-xs text-amber-400/80">
            {es
              ? 'Esperando datos fundamentales del ticker (revenue y shares outstanding)...'
              : 'Waiting for ticker fundamentals (revenue and shares outstanding)...'}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label={es ? 'Valor Promedio' : 'Mean Value'}
              value={fmtUSD(result.mean_equity_value)}
              sub={`${es ? 'Mediana' : 'Median'}: ${fmtUSD(result.median_equity_value)}`}
            />
            <KpiCard
              label={es ? 'Prob. Subvaluada' : 'Prob. Undervalued'}
              value={`${result.probability_undervalued.toFixed(1)}%`}
              color={probColor}
              sub={`vs. ${fmtUSD(result.current_price)}`}
            />
            <KpiCard
              label={es ? 'Valor Opciones Reales' : 'Real Options Value'}
              value={fmtUSD(result.real_options_value)}
              color="text-amber-400"
              sub={`Call + Put + LSM`}
            />
            <KpiCard
              label="VaR 95% / CVaR"
              value={`${fmtUSD(result.var_95)} / ${fmtUSD(result.cvar_95)}`}
              color="text-red-400"
              sub={es ? 'Riesgo de cola' : 'Tail risk'}
            />
          </div>

          {/* Signal */}
          <div className="bg-black/40 border border-green-900/20 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider">{es ? 'Senal' : 'Signal'}</div>
              <div className="text-3xl font-bold mt-1" style={{ color: signalColor }}>
                {result.signal.replace('_', ' ')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 uppercase tracking-wider">{es ? 'Upside vs. precio actual' : 'Upside vs. current price'}</div>
              <div className="text-3xl font-bold mt-1 font-data" style={{ color: result.upside_pct >= 0 ? '#10b981' : '#ef4444' }}>
                {result.upside_pct >= 0 ? '+' : ''}{result.upside_pct.toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 uppercase tracking-wider">{es ? 'Simulaciones' : 'Simulations'}</div>
              <div className="text-2xl font-data text-white mt-1">
                {result.n_simulations.toLocaleString()} &times; {result.years}y
              </div>
            </div>
          </div>

          {/* Regime distribution */}
          <div className="bg-black/40 border border-green-900/20 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-green-400 mb-4">
              {es ? 'Distribucion de Regimen (Markov Chain)' : 'Regime Distribution (Markov Chain)'}
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {regimeData.map((r) => (
                <div key={r.name} className="rounded-2xl p-5 text-center" style={{ backgroundColor: `${r.fill}1A`, borderColor: `${r.fill}40`, borderWidth: 1 }}>
                  <div className="text-sm" style={{ color: r.fill }}>{r.name}</div>
                  <div className="text-4xl font-bold font-data mt-1" style={{ color: r.fill }}>{r.value.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Distribution histogram */}
          <div className="bg-black/40 border border-green-900/20 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-green-400 mb-4">
              {es
                ? `Distribucion de Valor por Accion (${result.n_simulations.toLocaleString()} simulaciones)`
                : `Per-Share Value Distribution (${result.n_simulations.toLocaleString()} simulations)`}
            </h3>
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={result.distribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis dataKey="bin" tick={{ fill: '#888', fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis tick={{ fill: '#888', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: 8 }}
                  formatter={(v) => [v as number, 'Paths']}
                  labelFormatter={(v) => `$${v}`}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {result.distribution.map((d, i) => (
                    <Cell key={i} fill={d.bin < result.percentile_5 ? '#ef4444' : d.bin > result.percentile_95 ? '#10b981' : '#a78bfa'} opacity={0.85} />
                  ))}
                </Bar>
                {result.current_price > 0 && (
                  <ReferenceLine x={Math.round(result.current_price)} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: es ? 'Precio actual' : 'Current', fill: '#fbbf24', fontSize: 11, position: 'top' }} />
                )}
                <ReferenceLine x={Math.round(result.median_equity_value)} stroke="#06b6d4" strokeDasharray="4 4" label={{ value: es ? 'Mediana' : 'Median', fill: '#06b6d4', fontSize: 11, position: 'top' }} />
              </BarChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-4 text-xs">
              {[
                ['P5', result.percentile_5],
                ['P10', result.percentile_10],
                ['P25', result.percentile_25],
                ['P75', result.percentile_75],
                ['P90', result.percentile_90],
                ['P95', result.percentile_95],
              ].map(([label, val]) => (
                <div key={label as string} className="bg-black/40 rounded-lg p-2 text-center">
                  <div className="text-gray-500">{label}</div>
                  <div className="font-data text-gray-200">{fmtUSD(val as number)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tornado + Real Options */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-black/40 border border-green-900/20 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-green-400 mb-4">
                {es ? 'Analisis de Sensibilidad (Tornado)' : 'Sensitivity Analysis (Tornado)'}
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={result.sensitivity} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis type="number" tick={{ fill: '#888', fontSize: 11 }} unit="%" />
                  <YAxis dataKey="variable" type="category" width={180} tick={{ fill: '#aaa', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #003319', borderRadius: 8 }}
                    formatter={(v) => `${(v as number).toFixed(1)}%`}
                  />
                  <Bar dataKey="impact" radius={[0, 4, 4, 0]}>
                    {result.sensitivity.map((d, i) => (
                      <Cell key={i} fill={d.impact >= 0 ? '#10b981' : '#ef4444'} opacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-black/40 border border-green-900/20 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-green-400">
                {es ? 'Opciones Reales (Longstaff-Schwartz)' : 'Real Options (Longstaff-Schwartz)'}
              </h3>
              <div className="space-y-3">
                <div className="bg-emerald-900/15 border border-emerald-500/20 rounded-xl p-4">
                  <div className="text-xs text-gray-400">{es ? 'Opcion de Expansion (Call)' : 'Expansion Option (Call)'}</div>
                  <div className="text-3xl font-bold text-emerald-400 font-data">{fmtUSD(result.expansion_option_value)}</div>
                  <div className="text-xs text-gray-500 mt-1">Strike: ${inputs.expansionStrike}</div>
                </div>
                <div className="bg-red-900/15 border border-red-500/20 rounded-xl p-4">
                  <div className="text-xs text-gray-400">{es ? 'Opcion de Abandono (Put)' : 'Abandonment Option (Put)'}</div>
                  <div className="text-3xl font-bold text-red-400 font-data">{fmtUSD(result.abandonment_option_value)}</div>
                  <div className="text-xs text-gray-500 mt-1">Strike: ${inputs.abandonmentStrike}</div>
                </div>
                <div className="bg-amber-900/15 border border-amber-500/20 rounded-xl p-4">
                  <div className="text-xs text-gray-400">{es ? 'Early Exercise Premium (LSM)' : 'Early Exercise Premium (LSM)'}</div>
                  <div className="text-3xl font-bold text-amber-400 font-data">{fmtUSD(result.early_exercise_premium)}</div>
                  <div className="text-xs text-gray-500 mt-1">{es ? 'Backward induction sobre anos 3-7' : 'Backward induction over years 3-7'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Narrative */}
          <div className="bg-black/40 border border-green-900/20 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-green-400 mb-3">{es ? 'Resumen' : 'Summary'}</h3>
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-data leading-relaxed">{result.narrative}</pre>
          </div>
        </>
      )}
    </div>
  );
}
