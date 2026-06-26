'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import Header from '@/app/components/Header';
import { postBackend, getBackend } from '@/lib/backendClient';

// ── Config & result types ────────────────────────────────────────────────
interface BacktestConfig {
  gap_pct_min: number;
  price_min: number;
  price_max: number;
  market_cap_bucket: 'nano' | 'micro' | 'small' | 'mid';
  stop_loss: 'premarket_high' | 'one_min_high' | 'none' | 'trailing_pct';
  trailing_pct: number;
  take_profit: 'premarket_low' | 'yesterday_high' | 'yesterday_close' | 'risk_reward';
  rr_ratio: number;
  eod_close: 'close_eod' | 'carry_next_day';
  carry_max_days: number;
  portfolio_usd: number;
  position_sizing: 'fixed_risk_usd' | 'pct_portfolio_risk';
  fixed_risk_usd: number;
  pct_portfolio_risk: number;
  entry: 'opening_range_break' | 'opening_bell' | 'second_red_after_green' | 'failed_premarket_high_break';
  orb_minutes: 1 | 5 | 15;
  date_from: string;
  date_to: string;
  max_universe: number;
  max_events: number;
}

interface Trade {
  symbol: string; date: string; gap_pct: number;
  entry: number; exit: number; stop: number | null; target: number | null;
  shares: number; pnl: number; r_multiple: number; equity: number; reason: string;
  weekday: string | null;
  spy_open_above: boolean | null;
  spy_close_up: boolean | null;
  spy_open_pct: number | null;
  spy_close_pct: number | null;
}

interface BacktestAnalysis {
  wins_count: number;
  losses_count: number;
  spy_coverage_pct: number;
  spy_open: {
    wins_above_pct: number | null; wins_below_pct: number | null;
    losses_above_pct: number | null; losses_below_pct: number | null;
  };
  spy_close: {
    wins_up_pct: number | null; wins_down_pct: number | null;
    losses_up_pct: number | null; losses_down_pct: number | null;
  };
  weekday: Array<{
    weekday: string; trades: number; win_rate_pct: number;
    pct_of_wins: number; pct_of_losses: number;
  }>;
}

interface BacktestResult {
  total_trades: number;
  win_rate_pct: number;
  avg_rr: number;
  expected_value_usd: number;
  expected_value_r: number;
  sharpe_ratio: number;
  r_squared: number;
  max_drawdown_pct: number;
  profit_factor: number | null;
  total_return_pct: number;
  avg_win: number;
  avg_loss: number;
  equity_curve: number[];
  r_multiples: number[];
  trades: Trade[];
  analysis: BacktestAnalysis;
  meta: {
    universe_size: number; events_found: number; trades_taken: number;
    no_trade_count: number; date_from: string; date_to: string; warnings: string[];
  };
}

interface JobStatus {
  job_id: string; status: 'queued' | 'running' | 'done' | 'error';
  progress: number; stage: string; error?: string | null; result?: BacktestResult;
}

const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

const DEFAULT_CONFIG: BacktestConfig = {
  gap_pct_min: 20, price_min: 0, price_max: 20, market_cap_bucket: 'micro',
  stop_loss: 'premarket_high', trailing_pct: 10,
  take_profit: 'risk_reward', rr_ratio: 2,
  eod_close: 'close_eod', carry_max_days: 5,
  portfolio_usd: 10000, position_sizing: 'fixed_risk_usd',
  fixed_risk_usd: 100, pct_portfolio_risk: 1,
  entry: 'opening_bell', orb_minutes: 5,
  date_from: yearAgo(), date_to: today(),
  max_universe: 1500, max_events: 1500,
};

// ── Small UI primitives ──────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300/80">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-gray-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  'bg-gray-950 border border-rose-500/20 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-rose-400/60';

function NumberInput({ value, onChange, step = 1, min }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number;
}) {
  return (
    <input type="number" className={inputCls} value={value} step={step} min={min}
      onChange={(e) => onChange(parseFloat(e.target.value))} />
  );
}

function Select<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function StatCard({ label, value, tone = 'neutral', hint }: {
  label: string; value: string; tone?: 'pos' | 'neg' | 'neutral'; hint?: string;
}) {
  const toneCls = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-gray-100';
  return (
    <div className="bg-gray-950/70 border border-rose-500/15 rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-black mt-1 font-mono ${toneCls}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function AnalysisRow({ label, winPct, lossPct }: {
  label: string; winPct: number | null; lossPct: number | null;
}) {
  const bar = (pct: number | null, tone: 'pos' | 'neg') => (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full ${tone === 'pos' ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className={`w-12 text-right font-mono text-xs ${tone === 'pos' ? 'text-emerald-400' : 'text-rose-400'}`}>
        {pct == null ? '–' : `${pct}%`}
      </span>
    </div>
  );
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-300 mb-1">{label}</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 items-center">
        <span className="text-[10px] text-emerald-400/70 uppercase">Ganancias</span>{bar(winPct, 'pos')}
        <span className="text-[10px] text-rose-400/70 uppercase">Pérdidas</span>{bar(lossPct, 'neg')}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const { user, isLoaded } = useUser();
  const isGodMode = (user?.publicMetadata?.plan as string) === 'godmode';

  const [cfg, setCfg] = useState<BacktestConfig>(DEFAULT_CONFIG);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const set = <K extends keyof BacktestConfig>(k: K, v: BacktestConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const run = useCallback(async () => {
    setError(''); setResult(null); setJob(null); setRunning(true);
    stopPolling();
    try {
      const { job_id } = await postBackend<{ job_id: string }>('/backtest/gap-short/start', cfg);
      pollRef.current = setInterval(async () => {
        try {
          const snap = await getBackend<JobStatus>(`/backtest/gap-short/status/${job_id}`);
          setJob(snap);
          if (snap.status === 'done') {
            stopPolling(); setRunning(false);
            setResult(snap.result ?? null);
          } else if (snap.status === 'error') {
            stopPolling(); setRunning(false);
            setError(snap.error || 'Error en el backtest');
          }
        } catch (e: any) {
          stopPolling(); setRunning(false);
          setError(e?.message || 'Error consultando el estado del job');
        }
      }, 1500);
    } catch (e: any) {
      setRunning(false);
      setError(e?.message || 'No se pudo iniciar el backtest');
    }
  }, [cfg, stopPolling]);

  // R-multiple histogram bins
  const histdata = useMemo(() => {
    if (!result?.r_multiples?.length) return [];
    const bins = [-3, -2, -1, 0, 1, 2, 3, 4, 5];
    const counts = bins.map((b, i) => ({
      bin: i === 0 ? `≤${bins[1]}` : i === bins.length - 1 ? `≥${b}` : `${bins[i]}`,
      lo: b, count: 0,
    }));
    for (const r of result.r_multiples) {
      let idx = bins.findIndex((b) => r < b);
      if (idx === -1) idx = bins.length - 1; else idx = Math.max(0, idx - 1);
      counts[idx].count += 1;
    }
    return counts;
  }, [result]);

  const equityData = useMemo(
    () => (result?.equity_curve ?? []).map((v, i) => ({ i, equity: v })),
    [result],
  );

  // ── Gating ──────────────────────────────────────────────────────────────
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950"><Header />
        <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-400">Cargando…</div>
      </div>
    );
  }
  if (!isGodMode) {
    return (
      <div className="min-h-screen bg-gray-950"><Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold uppercase tracking-wider mb-4">
            God Mode
          </div>
          <h1 className="text-3xl font-black text-white mb-3">Backtest</h1>
          <p className="text-gray-400">Esta herramienta está disponible únicamente para cuentas <span className="text-rose-300 font-semibold">God Mode</span>.</p>
          <Link href="/" className="inline-block mt-6 px-5 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 font-semibold hover:bg-rose-500/30 transition">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  // ── Tool ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Heading */}
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl sm:text-3xl font-black text-rose-300">Backtest</h1>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-wider">God Mode</span>
        </div>
        <p className="text-gray-400 text-sm mb-6 max-w-3xl">
          Short selling de small caps en <span className="text-rose-300">gap ups</span> intradiarios, simulado con barras de 1 minuto (incluyendo premarket).
        </p>

        {/* Strategy selector (only one for now) */}
        <div className="mb-6 inline-flex rounded-xl border border-rose-500/20 bg-gray-900/50 p-1">
          <span className="px-4 py-2 rounded-lg bg-rose-500/20 text-rose-200 text-sm font-semibold">Short Gap-Ups · Small Caps</span>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5 sm:p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <Field label="Gap % mínimo" hint="≥ 1% — filtra gaps de ese % o superior">
              <NumberInput value={cfg.gap_pct_min} min={1} step={1} onChange={(v) => set('gap_pct_min', v)} />
            </Field>
            <Field label="Precio mín ($)">
              <NumberInput value={cfg.price_min} min={0} step={0.5} onChange={(v) => set('price_min', v)} />
            </Field>
            <Field label="Precio máx ($)">
              <NumberInput value={cfg.price_max} min={0.01} step={0.5} onChange={(v) => set('price_max', v)} />
            </Field>
            <Field label="Market cap">
              <Select value={cfg.market_cap_bucket} onChange={(v) => set('market_cap_bucket', v)} options={[
                { value: 'nano', label: 'Nano (< $50M)' },
                { value: 'micro', label: 'Micro ($50M–$300M)' },
                { value: 'small', label: 'Small ($300M–$2B)' },
                { value: 'mid', label: 'Mid ($2B–$10B)' },
              ]} />
            </Field>

            {/* Entry */}
            <Field label="Entrada">
              <Select value={cfg.entry} onChange={(v) => set('entry', v)} options={[
                { value: 'opening_bell', label: 'Short en opening bell' },
                { value: 'opening_range_break', label: 'Opening range break' },
                { value: 'second_red_after_green', label: '2ª barra (si 1ª fue verde)' },
                { value: 'failed_premarket_high_break', label: 'Fallo de premarket high' },
              ]} />
            </Field>
            {cfg.entry === 'opening_range_break' && (
              <Field label="ORB timeframe">
                <Select value={String(cfg.orb_minutes) as any} onChange={(v) => set('orb_minutes', Number(v) as 1 | 5 | 15)} options={[
                  { value: '1', label: '1 minuto' }, { value: '5', label: '5 minutos' }, { value: '15', label: '15 minutos' },
                ]} />
              </Field>
            )}

            {/* Stop loss */}
            <Field label="Stop loss">
              <Select value={cfg.stop_loss} onChange={(v) => set('stop_loss', v)} options={[
                { value: 'premarket_high', label: 'Pre-market high' },
                { value: 'one_min_high', label: '1-minute high' },
                { value: 'none', label: 'Sin stop loss' },
                { value: 'trailing_pct', label: 'Trailing stop %' },
              ]} />
            </Field>
            {cfg.stop_loss === 'trailing_pct' && (
              <Field label="Trailing %">
                <NumberInput value={cfg.trailing_pct} min={0.1} step={0.5} onChange={(v) => set('trailing_pct', v)} />
              </Field>
            )}

            {/* Take profit */}
            <Field label="Take profit">
              <Select value={cfg.take_profit} onChange={(v) => set('take_profit', v)} options={[
                { value: 'risk_reward', label: 'Risk:Reward fijo' },
                { value: 'premarket_low', label: 'Pre-market low' },
                { value: 'yesterday_high', label: 'Yesterday high' },
                { value: 'yesterday_close', label: 'Yesterday close' },
              ]} />
            </Field>
            {cfg.take_profit === 'risk_reward' && (
              <Field label="Ratio (R:1)" hint={cfg.stop_loss === 'none' ? '⚠ requiere stop loss' : 'ej. 2 = 2× el riesgo'}>
                <NumberInput value={cfg.rr_ratio} min={0.1} step={0.5} onChange={(v) => set('rr_ratio', v)} />
              </Field>
            )}

            {/* Close */}
            <Field label="Cierre">
              <Select value={cfg.eod_close} onChange={(v) => set('eod_close', v)} options={[
                { value: 'close_eod', label: 'Cerrar al fin del día' },
                { value: 'carry_next_day', label: 'Continuar al día siguiente' },
              ]} />
            </Field>
            {cfg.eod_close === 'carry_next_day' && (
              <Field label="Máx. días carry">
                <NumberInput value={cfg.carry_max_days} min={1} step={1} onChange={(v) => set('carry_max_days', v)} />
              </Field>
            )}

            {/* Position */}
            <Field label="Cartera (USD)">
              <NumberInput value={cfg.portfolio_usd} min={1} step={500} onChange={(v) => set('portfolio_usd', v)} />
            </Field>
            <Field label="Sizing">
              <Select value={cfg.position_sizing} onChange={(v) => set('position_sizing', v)} options={[
                { value: 'fixed_risk_usd', label: 'Riesgo fijo (USD)' },
                { value: 'pct_portfolio_risk', label: '% de la cartera' },
              ]} />
            </Field>
            {cfg.position_sizing === 'fixed_risk_usd' ? (
              <Field label="Riesgo por trade ($)">
                <NumberInput value={cfg.fixed_risk_usd} min={0.01} step={10} onChange={(v) => set('fixed_risk_usd', v)} />
              </Field>
            ) : (
              <Field label="Riesgo por trade (%)">
                <NumberInput value={cfg.pct_portfolio_risk} min={0.01} step={0.25} onChange={(v) => set('pct_portfolio_risk', v)} />
              </Field>
            )}

            {/* Dates */}
            <Field label="Desde">
              <input type="date" className={inputCls} value={cfg.date_from} onChange={(e) => set('date_from', e.target.value)} />
            </Field>
            <Field label="Hasta">
              <input type="date" className={inputCls} value={cfg.date_to} onChange={(e) => set('date_to', e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-6">
            <button onClick={run} disabled={running}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-bold rounded-xl shadow-lg shadow-rose-500/20 disabled:opacity-50 transition-all text-sm">
              {running ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : null}
              {running ? 'Corriendo…' : 'Run Backtest'}
            </button>
            <span className="text-[11px] text-gray-500">
              Universo amplio: el escaneo día-a-día puede tardar varios minutos.
            </span>
          </div>

          {/* Progress */}
          {running && job && (
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                <span>{job.stage}</span><span>{job.progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-rose-500 to-red-500 transition-all" style={{ width: `${job.progress}%` }} />
              </div>
            </div>
          )}
          {error && <p className="mt-4 text-sm text-rose-400">⚠ {error}</p>}
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {result.total_trades === 0 ? (
              <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-8 text-center text-gray-400">
                No se generaron trades con estos filtros.{' '}
                <span className="text-gray-500">
                  ({result.meta.universe_size} tickers escaneados, {result.meta.events_found} gaps encontrados)
                </span>
              </div>
            ) : (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  <StatCard label="Win rate" value={`${result.win_rate_pct}%`} tone={result.win_rate_pct >= 50 ? 'pos' : 'neg'} />
                  <StatCard label="Avg R:R" value={`${result.avg_rr}R`} tone={result.avg_rr >= 0 ? 'pos' : 'neg'} hint="R-multiple medio" />
                  <StatCard label="Expected value" value={`$${result.expected_value_usd}`} tone={result.expected_value_usd >= 0 ? 'pos' : 'neg'} hint={`${result.expected_value_r}R / trade`} />
                  <StatCard label="Sharpe" value={`${result.sharpe_ratio}`} tone={result.sharpe_ratio >= 1 ? 'pos' : 'neutral'} />
                  <StatCard label="R²" value={`${result.r_squared}`} hint="consistencia equity" />
                  <StatCard label="Total return" value={`${result.total_return_pct}%`} tone={result.total_return_pct >= 0 ? 'pos' : 'neg'} />
                  <StatCard label="Max drawdown" value={`${result.max_drawdown_pct}%`} tone="neg" />
                  <StatCard label="Profit factor" value={`${result.profit_factor ?? '∞'}`} tone={(result.profit_factor ?? 99) >= 1 ? 'pos' : 'neg'} />
                  <StatCard label="Trades" value={`${result.total_trades}`} hint={`${result.meta.no_trade_count} sin trade`} />
                  <StatCard label="Avg win / loss" value={`$${result.avg_win} / $${result.avg_loss}`} />
                </div>

                {/* Equity curve */}
                <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                  <h3 className="text-sm font-bold text-rose-300 mb-3">Equity curve</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={equityData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                      <XAxis dataKey="i" stroke="#6b7280" fontSize={11} />
                      <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #f43f5e33', borderRadius: 8 }}
                        formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Equity']} labelFormatter={(l) => `Trade #${l}`} />
                      <ReferenceLine y={cfg.portfolio_usd} stroke="#6b7280" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="equity" stroke="#f43f5e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* R-multiple histogram */}
                <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                  <h3 className="text-sm font-bold text-rose-300 mb-3">Distribución de R-multiples</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={histdata}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                      <XAxis dataKey="bin" stroke="#6b7280" fontSize={11} />
                      <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #f43f5e33', borderRadius: 8 }} />
                      <Bar dataKey="count">
                        {histdata.map((d, i) => (
                          <Cell key={i} fill={d.lo < 0 ? '#f43f5e' : '#10b981'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* SPY context + weekday analysis */}
                {result.analysis && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* SPY context */}
                    <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                      <h3 className="text-sm font-bold text-rose-300 mb-1">Contexto SPY</h3>
                      <p className="text-[11px] text-gray-500 mb-3">vs cierre del día anterior · cobertura {result.analysis.spy_coverage_pct}%</p>
                      <div className="space-y-3 text-sm">
                        <AnalysisRow
                          label="SPY abrió POR ENCIMA"
                          winPct={result.analysis.spy_open.wins_above_pct}
                          lossPct={result.analysis.spy_open.losses_above_pct}
                        />
                        <AnalysisRow
                          label="SPY abrió POR DEBAJO"
                          winPct={result.analysis.spy_open.wins_below_pct}
                          lossPct={result.analysis.spy_open.losses_below_pct}
                        />
                        <div className="h-px bg-gray-800 my-1" />
                        <AnalysisRow
                          label="SPY cerró EN VERDE"
                          winPct={result.analysis.spy_close.wins_up_pct}
                          lossPct={result.analysis.spy_close.losses_up_pct}
                        />
                        <AnalysisRow
                          label="SPY cerró EN ROJO"
                          winPct={result.analysis.spy_close.wins_down_pct}
                          lossPct={result.analysis.spy_close.losses_down_pct}
                        />
                      </div>
                      <p className="text-[10px] text-gray-600 mt-3">
                        % de las {result.analysis.wins_count} ganancias / {result.analysis.losses_count} pérdidas que ocurrieron bajo cada condición del SPY.
                      </p>
                    </div>

                    {/* Weekday */}
                    <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                      <h3 className="text-sm font-bold text-rose-300 mb-3">Por día de la semana</h3>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 text-left border-b border-gray-800">
                            <th className="py-1.5 pr-2">Día</th>
                            <th className="pr-2 text-right">Trades</th>
                            <th className="pr-2 text-right">Win rate</th>
                            <th className="pr-2 text-right">% ganancias</th>
                            <th className="pr-2 text-right">% pérdidas</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {result.analysis.weekday.map((d) => (
                            <tr key={d.weekday} className="border-b border-gray-800/50">
                              <td className="py-1.5 pr-2 font-sans text-gray-200">{d.weekday}</td>
                              <td className="pr-2 text-right text-gray-400">{d.trades}</td>
                              <td className={`pr-2 text-right ${d.win_rate_pct >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>{d.win_rate_pct}%</td>
                              <td className="pr-2 text-right text-emerald-400/80">{d.pct_of_wins}%</td>
                              <td className="pr-2 text-right text-rose-400/80">{d.pct_of_losses}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {result.meta.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300/90">
                    {result.meta.warnings.map((w, i) => <p key={i}>• {w}</p>)}
                  </div>
                )}

                {/* Trades table */}
                <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                  <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                    <h3 className="text-sm font-bold text-rose-300">Trades ({result.trades.length}{result.total_trades > result.trades.length ? ` de ${result.total_trades}` : ''})</h3>
                    <span className="text-[10px] text-gray-500">SPY = apertura / cierre vs día anterior (▲ por encima · ▼ por debajo)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 text-left border-b border-gray-800">
                          <th className="py-2 pr-3">Fecha</th><th className="pr-3">Día</th><th className="pr-3">Símbolo</th><th className="pr-3 text-right">Gap%</th>
                          <th className="pr-3 text-center">SPY</th>
                          <th className="pr-3 text-right">Entry</th><th className="pr-3 text-right">Exit</th><th className="pr-3 text-right">Stop</th>
                          <th className="pr-3 text-right">Target</th><th className="pr-3 text-right">Shares</th>
                          <th className="pr-3 text-right">P&L</th><th className="pr-3 text-right">R</th><th className="pr-3">Salida</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {result.trades.map((t, i) => (
                          <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="py-1.5 pr-3 text-gray-400">{t.date}</td>
                            <td className="pr-3 font-sans text-gray-400">{t.weekday ?? '–'}</td>
                            <td className="pr-3 text-gray-100 font-sans font-semibold">{t.symbol}</td>
                            <td className="pr-3 text-right text-gray-300">{t.gap_pct}%</td>
                            <td className="pr-3 text-center whitespace-nowrap">
                              {t.spy_open_above == null ? (
                                <span className="text-gray-600">–</span>
                              ) : (
                                <span title={`SPY abrió ${t.spy_open_pct}% · cerró ${t.spy_close_pct}% (vs día anterior)`}>
                                  <span className={t.spy_open_above ? 'text-emerald-400' : 'text-rose-400'}>{t.spy_open_above ? '▲' : '▼'}</span>
                                  <span className="text-gray-600 mx-0.5">/</span>
                                  <span className={t.spy_close_up ? 'text-emerald-400' : 'text-rose-400'}>{t.spy_close_up ? '▲' : '▼'}</span>
                                </span>
                              )}
                            </td>
                            <td className="pr-3 text-right text-gray-300">{t.entry}</td>
                            <td className="pr-3 text-right text-gray-300">{t.exit}</td>
                            <td className="pr-3 text-right text-gray-500">{t.stop ?? '–'}</td>
                            <td className="pr-3 text-right text-gray-500">{t.target ?? '–'}</td>
                            <td className="pr-3 text-right text-gray-400">{t.shares}</td>
                            <td className={`pr-3 text-right ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{t.pnl >= 0 ? '+' : ''}{t.pnl}</td>
                            <td className={`pr-3 text-right ${t.r_multiple >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{t.r_multiple}R</td>
                            <td className="pr-3 text-gray-500">{t.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Limitations */}
            <div className="rounded-xl border border-gray-700/40 bg-gray-900/30 p-4 text-[11px] text-gray-500 leading-relaxed">
              <p className="font-semibold text-gray-400 mb-1">Limitaciones del modelo</p>
              <p>• Market cap point-in-time (actual, no la del día del gap) → sesgo de supervivencia/look-ahead en la selección del universo.</p>
              <p>• Orden intrabar conservador: si una vela de 1-min toca stop (high) y target (low), se asume el stop primero.</p>
              <p>• No se modelan disponibilidad de borrow/locate ni costos de short.</p>
              <p>• Cobertura del universo sujeta a rate limits de FMP y al cap de seguridad de tickers.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
