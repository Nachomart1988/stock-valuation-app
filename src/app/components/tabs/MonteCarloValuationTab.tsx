// src/app/components/tabs/MonteCarloValuationTab.tsx
// Monte Carlo Advanced Valuation Tab — Dynamic Markov Regime Switching + Longstaff-Schwartz
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { useLanguage } from '@/i18n/LanguageContext';
import { postBackend } from '@/lib/backendClient';
import { fetchFmp } from '@/lib/fmpClient';

interface MonteCarloValuationTabProps {
  ticker: string;
  income?: any[];
  balance?: any[];
  cashFlow?: any[];
  quote?: any;
  profile?: any;
  wacc?: number | null;
}

interface AutoDefaults {
  // value + human-readable source so the UI can show "auto · …" badges
  operatingMarginMean: { value: number; source: string };
  waccMean: { value: number; source: string };
  terminalGrowth: { value: number; source: string };
  taxRate: { value: number; source: string };
  reinvestmentRate: { value: number; source: string };
  riskFreeRate: { value: number; source: string };
}

const DEFAULT_FALLBACKS: AutoDefaults = {
  operatingMarginMean: { value: 0.175, source: 'fallback 17.5%' },
  waccMean: { value: 0.095, source: 'fallback 9.5%' },
  terminalGrowth: { value: 0.025, source: 'fallback 2.5%' },
  taxRate: { value: 0.21, source: 'US fed corp rate' },
  reinvestmentRate: { value: 0.33, source: 'fallback 33%' },
  riskFreeRate: { value: 0.042, source: 'fallback 4.2%' },
};

function avgOfFinite(nums: number[]): number | null {
  const xs = nums.filter((n) => isFinite(n));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdOfFinite(nums: number[]): number | null {
  const xs = nums.filter((n) => isFinite(n));
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
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
  ticker, income, balance, cashFlow, quote, profile, wacc,
}: MonteCarloValuationTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  // ── Derive structural fundamentals (revenue, shares, net debt, price) ──
  const fundamentals = useMemo(() => {
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
    return {
      currentRevenue,
      sharesOutstanding,
      netDebt,
      currentPrice: quote?.price || 0,
    };
  }, [income, balance, quote]);

  // ── Async auto-defaults: combine historical fundamentals + FMP treasury ─
  const [autoDefaults, setAutoDefaults] = useState<AutoDefaults>(DEFAULT_FALLBACKS);
  const [autoLoading, setAutoLoading] = useState(true);
  const lastAutoTicker = useRef<string | null>(null);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    setAutoLoading(true);

    (async () => {
      const next: AutoDefaults = { ...DEFAULT_FALLBACKS };

      // ── Operating Margin: avg of last 3 fiscal years (more robust than spot) ─
      if (Array.isArray(income) && income.length > 0) {
        const margins = income.slice(0, 3)
          .map((r) => (r?.operatingIncome && r?.revenue) ? r.operatingIncome / r.revenue : NaN)
          .filter(isFinite);
        const m = avgOfFinite(margins);
        if (m !== null) {
          const clamped = Math.min(0.42, Math.max(0.04, m));
          next.operatingMarginMean = {
            value: +clamped.toFixed(4),
            source: `avg ${margins.length}y income.operatingIncome/revenue · ${(clamped * 100).toFixed(1)}%`,
          };
        }
      }

      // ── Effective Tax Rate: avg of last 3y (incomeTaxExpense / incomeBeforeTax) ─
      if (Array.isArray(income) && income.length > 0) {
        const rates = income.slice(0, 3)
          .map((r) => (r?.incomeBeforeTax && r.incomeBeforeTax > 0 && r?.incomeTaxExpense != null)
            ? r.incomeTaxExpense / r.incomeBeforeTax
            : NaN)
          .filter((x) => isFinite(x) && x > 0 && x < 0.6);
        const t = avgOfFinite(rates);
        if (t !== null) {
          const clamped = Math.min(0.35, Math.max(0.10, t));
          next.taxRate = {
            value: +clamped.toFixed(4),
            source: `effective TR (avg ${rates.length}y) · ${(clamped * 100).toFixed(1)}%`,
          };
        }
      }

      // ── Reinvestment Rate: avg of (|capex| + ΔWC) / NOPAT over last 3y ───
      if (Array.isArray(cashFlow) && cashFlow.length > 0 && Array.isArray(income) && income.length > 1) {
        const rates: number[] = [];
        const n = Math.min(3, cashFlow.length, income.length);
        for (let i = 0; i < n; i++) {
          const cf = cashFlow[i];
          const inc = income[i];
          const capex = Math.abs(cf?.capitalExpenditure ?? 0);
          const dwc = -(cf?.changeInWorkingCapital ?? 0); // positive = absorbs cash
          const ebit = inc?.operatingIncome ?? 0;
          const taxR = next.taxRate.value;
          const nopat = ebit * (1 - taxR);
          if (nopat > 0) {
            const r = (capex + Math.max(0, dwc)) / nopat;
            if (isFinite(r) && r > 0 && r < 1.5) rates.push(r);
          }
        }
        const r = avgOfFinite(rates);
        if (r !== null) {
          const clamped = Math.min(0.70, Math.max(0.05, r));
          next.reinvestmentRate = {
            value: +clamped.toFixed(4),
            source: `(capex + ΔWC) / NOPAT avg ${rates.length}y · ${(clamped * 100).toFixed(1)}%`,
          };
        }
      }

      // ── Risk-Free Rate + Terminal Growth from FMP treasury rates ─────────
      try {
        const treasuryJson = await fetchFmp('stable/treasury-rates');
        if (Array.isArray(treasuryJson) && treasuryJson.length > 0) {
          const latest = treasuryJson[0];
          const y10 = Number(latest.year10);
          const y30 = Number(latest.year30);
          if (isFinite(y10) && y10 > 0) {
            next.riskFreeRate = {
              value: +(y10 / 100).toFixed(4),
              source: `10Y US Treasury · ${y10.toFixed(2)}%`,
            };
          }
          // Terminal growth ≈ long-term nominal GDP. Best proxy in FMP:
          // 30Y yield minus a small spread (capped 2-3.5%) — closer to real LT growth.
          if (isFinite(y30) && y30 > 0) {
            const gT = Math.min(0.035, Math.max(0.015, (y30 - 1.2) / 100));
            next.terminalGrowth = {
              value: +gT.toFixed(4),
              source: `30Y Treasury ${y30.toFixed(2)}% − 1.2 spread · ${(gT * 100).toFixed(2)}%`,
            };
          } else if (isFinite(y10)) {
            const gT = Math.min(0.030, Math.max(0.015, (y10 - 1.5) / 100));
            next.terminalGrowth = {
              value: +gT.toFixed(4),
              source: `10Y Treasury ${y10.toFixed(2)}% − 1.5 spread · ${(gT * 100).toFixed(2)}%`,
            };
          }
        }
      } catch {/* fallback retained */}

      // ── WACC: prefer shared WACC from WACCTab; else CAPM fallback ────────
      if (wacc && isFinite(wacc) && wacc > 0) {
        next.waccMean = {
          value: +wacc.toFixed(4),
          source: `WACC tab · ${(wacc * 100).toFixed(2)}%`,
        };
      } else {
        // CAPM fallback: rf + beta * MRP (no debt weight — best we can do without WACCTab)
        try {
          const mrpJson = await fetchFmp('stable/market-risk-premium');
          let mrp: number | null = null;
          if (Array.isArray(mrpJson)) {
            const us = mrpJson.find((x: any) =>
              x?.country === 'United States' || x?.countryCode === 'US');
            mrp = Number(us?.totalEquityRiskPremium ?? us?.equityRiskPremium ?? us?.premium ?? NaN);
          }
          const beta = Number(profile?.beta);
          const rfPct = next.riskFreeRate.value * 100;
          if (isFinite(beta) && beta > 0 && isFinite(mrp ?? NaN) && mrp! > 0 && isFinite(rfPct)) {
            const capm = (rfPct + beta * mrp!) / 100;
            const clamped = Math.min(0.18, Math.max(0.05, capm));
            next.waccMean = {
              value: +clamped.toFixed(4),
              source: `CAPM fallback (β=${beta.toFixed(2)}, MRP=${mrp!.toFixed(1)}%) · ${(clamped * 100).toFixed(2)}%`,
            };
          }
        } catch {/* keep DEFAULT_FALLBACKS.waccMean */}
      }

      if (!cancelled) {
        setAutoDefaults(next);
        setAutoLoading(false);
        lastAutoTicker.current = ticker;
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, income, cashFlow, profile, wacc]);

  // ── Revenue CAGR std from historical YoY growth (drives sim noise) ─────
  const revenueCagrStd = useMemo(() => {
    if (!Array.isArray(income) || income.length < 3) return 0.04;
    const sorted = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);
    const growths: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const r0 = sorted[i + 1]?.revenue;
      const r1 = sorted[i]?.revenue;
      if (r0 > 0 && r1 > 0) growths.push((r1 - r0) / r0);
    }
    const s = stdOfFinite(growths);
    return s !== null ? Math.min(0.20, Math.max(0.01, s)) : 0.04;
  }, [income]);

  const [inputs, setInputs] = useState({
    years: 8,
    nSimulations: 12000,
    operatingMarginMean: DEFAULT_FALLBACKS.operatingMarginMean.value,
    waccMean: DEFAULT_FALLBACKS.waccMean.value,
    terminalGrowth: DEFAULT_FALLBACKS.terminalGrowth.value,
    taxRate: DEFAULT_FALLBACKS.taxRate.value,
    reinvestmentRate: DEFAULT_FALLBACKS.reinvestmentRate.value,
    expansionStrike: Math.max(10, Math.round((quote?.price || 50) * 0.6)),
    abandonmentStrike: Math.max(20, Math.round((quote?.price || 50) * 1.05)),
    riskFreeRate: DEFAULT_FALLBACKS.riskFreeRate.value,
  });

  // Track which inputs the user has manually overridden — never auto-overwrite those
  const [overrides, setOverrides] = useState<Set<string>>(new Set());
  const markOverride = (key: string) => setOverrides((s) => new Set(s).add(key));
  const isAuto = (key: string) => !overrides.has(key);

  // Reset overrides + result when the ticker changes — defaults are now company-specific
  useEffect(() => {
    setOverrides(new Set());
    setResult(null);
  }, [ticker]);

  // Sync auto-defaults into inputs (only for non-overridden fields)
  useEffect(() => {
    setInputs((prev) => ({
      ...prev,
      operatingMarginMean: overrides.has('operatingMarginMean') ? prev.operatingMarginMean : autoDefaults.operatingMarginMean.value,
      waccMean: overrides.has('waccMean') ? prev.waccMean : autoDefaults.waccMean.value,
      terminalGrowth: overrides.has('terminalGrowth') ? prev.terminalGrowth : autoDefaults.terminalGrowth.value,
      taxRate: overrides.has('taxRate') ? prev.taxRate : autoDefaults.taxRate.value,
      reinvestmentRate: overrides.has('reinvestmentRate') ? prev.reinvestmentRate : autoDefaults.reinvestmentRate.value,
      riskFreeRate: overrides.has('riskFreeRate') ? prev.riskFreeRate : autoDefaults.riskFreeRate.value,
    }));
  }, [autoDefaults, overrides]);

  const resetToAuto = () => {
    setOverrides(new Set());
    setInputs((prev) => ({
      ...prev,
      operatingMarginMean: autoDefaults.operatingMarginMean.value,
      waccMean: autoDefaults.waccMean.value,
      terminalGrowth: autoDefaults.terminalGrowth.value,
      taxRate: autoDefaults.taxRate.value,
      reinvestmentRate: autoDefaults.reinvestmentRate.value,
      riskFreeRate: autoDefaults.riskFreeRate.value,
      expansionStrike: Math.max(10, Math.round((quote?.price || 50) * 0.6)),
      abandonmentStrike: Math.max(20, Math.round((quote?.price || 50) * 1.05)),
    }));
  };

  const [result, setResult] = useState<AdvMCResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = fundamentals.currentRevenue > 0 && fundamentals.sharesOutstanding > 0;

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
        current_revenue: fundamentals.currentRevenue,
        shares_outstanding: fundamentals.sharesOutstanding,
        net_debt: fundamentals.netDebt,
        current_price: fundamentals.currentPrice,
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
        revenue_cagr_std: revenueCagrStd,
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            {es
              ? 'Defaults cableados desde income / balance / cashFlow del ticker + FMP economic data. Podes overridear cualquier campo.'
              : 'Defaults auto-derived from income / balance / cashFlow + FMP economic data. You can override any field.'}
          </p>
          {overrides.size > 0 && (
            <button
              onClick={resetToAuto}
              className="text-xs px-3 py-1 rounded-lg bg-violet-900/30 border border-violet-500/30 text-violet-300 hover:bg-violet-900/50"
            >
              {es ? `Reset auto (${overrides.size})` : `Reset auto (${overrides.size})`}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Anos' : 'Years'}</label>
            <input
              type="number" min={3} max={15} value={inputs.years}
              onChange={(e) => setInputs({ ...inputs, years: Math.max(3, Math.min(15, parseInt(e.target.value) || 8)) })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">{es ? 'horizonte de proyeccion' : 'projection horizon'}</p>
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
            <p className="text-[10px] text-gray-600 mt-1">{es ? 'paths Monte Carlo' : 'Monte Carlo paths'}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Margen Op. medio' : 'Op Margin Mean'}</label>
            <input
              type="number" step="0.01" min={0.04} max={0.42} value={inputs.operatingMarginMean}
              onChange={(e) => { markOverride('operatingMarginMean'); setInputs({ ...inputs, operatingMarginMean: parseFloat(e.target.value) || autoDefaults.operatingMarginMean.value }); }}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className={`text-[10px] mt-1 ${isAuto('operatingMarginMean') ? 'text-emerald-500/70' : 'text-amber-400/80'}`}>
              {isAuto('operatingMarginMean') ? `auto · ${autoDefaults.operatingMarginMean.source}` : (es ? 'manual override' : 'manual override')}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">WACC base</label>
            <input
              type="number" step="0.005" min={0.05} max={0.18} value={inputs.waccMean}
              onChange={(e) => { markOverride('waccMean'); setInputs({ ...inputs, waccMean: parseFloat(e.target.value) || autoDefaults.waccMean.value }); }}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className={`text-[10px] mt-1 ${isAuto('waccMean') ? 'text-emerald-500/70' : 'text-amber-400/80'}`}>
              {isAuto('waccMean') ? `auto · ${autoDefaults.waccMean.source}` : (es ? 'manual override' : 'manual override')}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Crecimiento terminal' : 'Terminal Growth'}</label>
            <input
              type="number" step="0.005" min={0} max={0.06} value={inputs.terminalGrowth}
              onChange={(e) => { markOverride('terminalGrowth'); setInputs({ ...inputs, terminalGrowth: parseFloat(e.target.value) || autoDefaults.terminalGrowth.value }); }}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className={`text-[10px] mt-1 ${isAuto('terminalGrowth') ? 'text-emerald-500/70' : 'text-amber-400/80'}`}>
              {isAuto('terminalGrowth') ? `auto · ${autoDefaults.terminalGrowth.source}` : (es ? 'manual override' : 'manual override')}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Tasa de impuesto' : 'Tax Rate'}</label>
            <input
              type="number" step="0.01" min={0} max={0.4} value={inputs.taxRate}
              onChange={(e) => { markOverride('taxRate'); setInputs({ ...inputs, taxRate: parseFloat(e.target.value) || autoDefaults.taxRate.value }); }}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className={`text-[10px] mt-1 ${isAuto('taxRate') ? 'text-emerald-500/70' : 'text-amber-400/80'}`}>
              {isAuto('taxRate') ? `auto · ${autoDefaults.taxRate.source}` : (es ? 'manual override' : 'manual override')}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Reinversion' : 'Reinvestment'}</label>
            <input
              type="number" step="0.01" min={0} max={0.7} value={inputs.reinvestmentRate}
              onChange={(e) => { markOverride('reinvestmentRate'); setInputs({ ...inputs, reinvestmentRate: parseFloat(e.target.value) || autoDefaults.reinvestmentRate.value }); }}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className={`text-[10px] mt-1 ${isAuto('reinvestmentRate') ? 'text-emerald-500/70' : 'text-amber-400/80'}`}>
              {isAuto('reinvestmentRate') ? `auto · ${autoDefaults.reinvestmentRate.source}` : (es ? 'manual override' : 'manual override')}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Strike Expansion ($)' : 'Expansion Strike ($)'}</label>
            <input
              type="number" step="1" min={1} value={inputs.expansionStrike}
              onChange={(e) => setInputs({ ...inputs, expansionStrike: parseFloat(e.target.value) || 28 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">{es ? '~60% del precio actual' : '~60% of current price'}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Strike Abandono ($)' : 'Abandonment Strike ($)'}</label>
            <input
              type="number" step="1" min={1} value={inputs.abandonmentStrike}
              onChange={(e) => setInputs({ ...inputs, abandonmentStrike: parseFloat(e.target.value) || 52 })}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className="text-[10px] text-gray-600 mt-1">{es ? '~105% del precio actual' : '~105% of current price'}</p>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">{es ? 'Tasa libre de riesgo' : 'Risk-free Rate'}</label>
            <input
              type="number" step="0.005" min={0} max={0.1} value={inputs.riskFreeRate}
              onChange={(e) => { markOverride('riskFreeRate'); setInputs({ ...inputs, riskFreeRate: parseFloat(e.target.value) || autoDefaults.riskFreeRate.value }); }}
              className="w-full bg-black/60 border border-green-900/30 rounded-lg px-3 py-2 text-sm font-data text-white focus:outline-none focus:border-violet-500"
            />
            <p className={`text-[10px] mt-1 ${isAuto('riskFreeRate') ? 'text-emerald-500/70' : 'text-amber-400/80'}`}>
              {isAuto('riskFreeRate') ? `auto · ${autoDefaults.riskFreeRate.source}` : (es ? 'manual override' : 'manual override')}
            </p>
          </div>
        </div>

        {/* Auto-detected fundamentals */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-green-900/15 text-xs">
          <div>
            <div className="text-gray-500">Revenue (FY)</div>
            <div className="font-data text-gray-200">{fmtUSD(fundamentals.currentRevenue, 0)}</div>
          </div>
          <div>
            <div className="text-gray-500">Shares Out.</div>
            <div className="font-data text-gray-200">
              {fundamentals.sharesOutstanding ? (fundamentals.sharesOutstanding / 1e6).toFixed(1) + 'M' : 'N/A'}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Net Debt</div>
            <div className="font-data text-gray-200">{fmtUSD(fundamentals.netDebt, 0)}</div>
          </div>
          <div>
            <div className="text-gray-500">{es ? 'Precio actual' : 'Current price'}</div>
            <div className="font-data text-gray-200">{fmtUSD(fundamentals.currentPrice)}</div>
          </div>
          <div>
            <div className="text-gray-500">{es ? 'Revenue CAGR σ' : 'Revenue CAGR σ'}</div>
            <div className="font-data text-gray-200">{(revenueCagrStd * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-emerald-500/70">{es ? 'auto · std YoY hist.' : 'auto · YoY std'}</div>
          </div>
        </div>

        {autoLoading && (
          <p className="text-[11px] text-violet-300/70">
            {es ? 'Cargando defaults desde FMP economic data…' : 'Loading defaults from FMP economic data…'}
          </p>
        )}

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
