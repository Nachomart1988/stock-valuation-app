'use client';

/**
 * Ultimate Prediction v2 — sección de /backtest (GOD MODE).
 *
 * El usuario elige SOLO precio + market cap. El motor busca MOVIMIENTOS
 * EXPLOSIVOS (surges de +80% y superiores / desplomes −50% en ≤5 días, escala
 * Edge Finder): una red neuronal PyTorch —que se re-entrena en cada corrida con el
 * dataset local acumulado y con el resultado real de sus propias predicciones—
 * asigna P(explosión) a cada setup; cada candidato se VALIDA con un backtest
 * propio sobre su historia y los longs chicos pasan el veto de dilución EDGAR.
 * Top 5 para la próxima sesión + track record auto-calificado.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from 'recharts';
import { postBackend, getBackend } from '@/lib/backendClient';

// ── Types (espejo del backend ultimate_predictor_engine.py) ────────────────
type CapBucket = 'nano' | 'micro' | 'small' | 'mid' | 'large' | 'mega';

interface UltimateConfig {
  price_min: number;
  price_max: number;
  market_cap_min: CapBucket;
  market_cap_max: CapBucket;
  max_universe: number;
}

interface ScorePart { key: string; max: number; points: number; detail: string }

interface EntryStats {
  fills: number; win_rate_pct: number | null; expectancy_r: number | null;
  total_r: number | null; med_days_held: number | null;
}

interface Validation {
  events: number; fills: number; win_rate_pct: number | null;
  expectancy_r: number | null; total_r: number | null;
  med_days_held: number | null; passed: boolean; reject_reason: string | null;
  entry_type: 'stop' | 'open';
  by_entry?: { stop: EntryStats; open: EntryStats };
}

interface SurgeDossierEvent {
  date: string; magnitude_pct: number; days_to_peak: number;
  pre_pattern: string; vol_pre: number | null; is_main: boolean;
}

interface SurgeDossier {
  side: string; lookback_days: number;
  threshold_context_pct: number; threshold_main_pct: number;
  n_context: number; n_main: number;
  best_pct?: number; median_pct?: number; median_days_to_peak?: number;
  top_pre_pattern?: string; last_event_date?: string;
  events: SurgeDossierEvent[];
}

interface Fundamentals {
  name: string | null; industry: string | null; country: string | null;
  ipo_date: string | null; beta: number | null;
  current_ratio: number | null; net_margin: number | null; gross_margin: number | null;
  debt_to_equity: number | null; price_to_sales: number | null;
  net_debt_to_ebitda: number | null;
  flags: string[];
}

interface Pick {
  symbol: string; side: 'long' | 'short'; sector: string; industry: string | null;
  exchange: string | null; market_cap: number | null;
  as_of: string; price: number; status: string; pattern: string;
  ret10_pct: number; atr_pct: number; vol_ratio: number | null;
  consec_red: number; consec_green: number;
  long_run_max_pct?: number | null;
  surge_dossier?: SurgeDossier | null;
  fundamentals?: Fundamentals | null;
  dist_52w_low_pct: number | null; dist_52w_high_pct: number | null;
  sector_etf: string | null; sector_ret20_pct: number | null; sector_hot_now: boolean | null;
  entry: number; stop: number; target: number; rr: number; risk_pct: number;
  exp_move_pct: number; own_surges: number;
  pedigree?: number; own_surge_max?: number;
  entry_reach_pct?: number | null; entry_reach_atr?: number | null;
  learned_factor?: number; learned_notes?: string[];
  surge_prob_pct: number | null; p_up_pct: number | null; p_down_pct: number | null;
  score: number; score_breakdown: ScorePart[];
  validation: Validation;
  dilution: { score: number | null; label: string | null; dilution_1y_pct: number | null } | null;
  dilution_note?: string;
  rationale: string; exp_hold_days: number;
  entry_type?: 'stop' | 'open';
}

interface Insights {
  n: number;
  fill_rate_pct?: number; missed_move_rate_pct?: number;
  avg_r_filled?: number | null; avg_r_open_counterfactual?: number | null;
  avg_mfe_r?: number; pct_reached_1r?: number; pct_reached_2r?: number; losers_avg_mfe_r?: number;
  vol_threshold?: { above_1_5x: { n: number; avg_r: number }; below_1_5x: { n: number; avg_r: number } };
  by_pattern?: Array<{ pattern: string; n: number; avg_r: number }>;
  prob_buckets?: { p_ge_75: { n: number; avg_r: number }; p_lt_75: { n: number; avg_r: number } };
  reasoning?: {
    winners_vol_vs_prior_day?: number | null; winners_vol_vs_prior_week?: number | null;
    losers_vol_vs_prior_day?: number | null; winners_median_move_time?: string | null;
    winners_pm_gap_pct?: number | null; winners_pm_range_pct?: number | null;
    winners_first5_fav_pct?: number | null; losers_first5_fav_pct?: number | null;
    winners_first5_relvol?: number | null; losers_first5_relvol?: number | null;
  };
  market_context?: {
    long_spy_green: { n: number; avg_r: number };
    long_spy_red: { n: number; avg_r: number };
  };
  sector_context?: {
    with_sector: { n: number; avg_r: number };
    against_sector: { n: number; avg_r: number };
  };
  recent_previews?: Array<{
    symbol: string; for_date: string; side: string; outcome: string | null; r: number | null;
    vol_vs_prior_day: number | null; vol_vs_prior_week: number | null;
    move_time: string | null; pm_gap_pct: number | null;
  }>;
  recent_verdicts: Array<{ symbol: string; for_date: string; side: string; verdict: string }>;
}

interface LearningEntry { created_at: string; kind: string; message: string }

interface LearnedPriors {
  active: boolean;
  n_filled: number;
  n_graded?: number;
  baseline_r: number | null;
  patterns: Record<string, { factor: number; n: number; avg_r: number }>;
  relvol: { threshold: number; hi_factor: number; lo_factor: number; hi_n: number; lo_n: number; hi_avg_r: number; lo_avg_r: number } | null;
  prob: { hi_factor: number; lo_factor: number; hi_n: number; lo_n: number; hi_avg_r: number; lo_avg_r: number } | null;
  vetoes?: Array<{ key: string; side: string; pattern: string; n: number; fills: number; avg_r: number; r_per_pick: number }>;
  notes: string[];
}

interface Rejected {
  symbol: string; side: string; score: number; stage: string; reason: string;
  surge_prob_pct?: number | null;
}

interface ModelInfo {
  torch_available: boolean;
  status: 'trained' | 'heuristic';
  ephemeral_storage?: boolean;
  active_this_run?: boolean;
  trained_at: string | null;
  rows: number | null;
  dataset_rows: number;
  dataset_up: number;
  dataset_down: number;
  examples_added_this_run?: number;
  global_median_surge_pct?: number | null;
  metrics: {
    val_loss: number; epochs: number;
    auc_up: number | null; auc_down: number | null;
    pos_rate_up_pct: number; pos_rate_down_pct: number;
  } | null;
  last_training?: { trained: boolean; reason?: string };
}

interface SideStats {
  n: number; fills: number; fill_rate_pct: number | null;
  win_rate_pct: number | null; avg_r: number | null; total_r: number | null;
}

interface TrackRow {
  id?: number;
  for_date: string; symbol: string; side: string; entry: number; stop: number;
  target: number; score: number; status: string; outcome: string | null;
  outcome_r: number | null; exit_price: number | null; days_held: number | null;
  pattern?: string | null; surge_prob_pct?: number | null;
  entry_type?: string | null; cur_r?: number | null; max_r?: number | null;
}

interface TrackRecord {
  overall: SideStats; long: SideStats; short: SideStats;
  by_pattern?: Array<SideStats & { pattern: string }>;
  recent: TrackRow[];
  total?: number;
}

interface PredictionDetail {
  prediction: TrackRow & {
    run_id?: string; created_at?: string; expectancy_r?: number | null;
    exp_move_pct?: number | null; vol_ratio?: number | null;
    dilution_score?: number | null; sector_etf?: string | null;
    evaluated_at?: string | null;
  };
  trigger: {
    score_breakdown: ScorePart[];
    rationale: string | null;
    setup: Record<string, unknown>;
    validation: Partial<Validation>;
  };
  post_mortem: {
    filled?: number | null; outcome?: string | null; r?: number | null;
    mfe_r?: number | null; move_pct?: number | null; missed?: number | null;
    gap_pct?: number | null; session_vol_ratio?: number | null;
    verdict?: string | null; high_time_min?: number | null;
    low_time_min?: number | null; first5_ret_pct?: number | null;
    first5_relvol?: number | null; spy_day_pct?: number | null;
    sector_day_pct?: number | null;
  } | null;
  bars: Array<{
    date: string; open: number; high: number; low: number; close: number;
    volume: number; phase: 'previa' | 'trade'; event: string | null;
  }>;
}

interface GradeResponse {
  as_of: string; graded_now: number; feedback_rows: number;
  pending_future: number; track_record: TrackRecord;
  insights?: Insights; learning_log?: LearningEntry[]; learned?: LearnedPriors;
}

interface UltimateResult {
  kpis: {
    universe: number; setups_long: number; setups_short: number; validated: number;
    rejected_backtest: number; rejected_dilution: number; rejected_learned?: number;
    graded_this_run: number;
    dataset_rows: number; avg_expectancy_r: number | null;
    avg_surge_prob_pct: number | null;
  };
  market: {
    as_of: string; spy_ret5_pct: number | null; spy_ret20_pct: number | null;
    regime: 'risk_on' | 'risk_off' | 'neutral';
    hot_sectors: Array<{ etf: string; ret20_pct: number }>;
    cold_sectors: Array<{ etf: string; ret20_pct: number }>;
  };
  model: ModelInfo;
  learned?: LearnedPriors;
  picks: Pick[];
  rejected: Rejected[];
  track_record: TrackRecord;
  meta: {
    run_id: string; as_of: string; for_date: string; universe_full: number;
    surge_days: number; surge_pct_min: number; crash_pct_min: number;
    runtime_s: number; warnings: string[];
  };
}

interface JobStatus {
  job_id: string; status: 'queued' | 'running' | 'done' | 'error';
  progress: number; stage: string; error?: string | null; result?: UltimateResult;
}

interface ChartBar { t: string; day: string; open: number; high: number; low: number; close: number; volume: number; range?: [number, number] }

const DEFAULT_CONFIG: UltimateConfig = {
  price_min: 1, price_max: 100,
  market_cap_min: 'small', market_cap_max: 'large',
  max_universe: 3000,
};

const CAP_OPTIONS: { value: CapBucket; label: string }[] = [
  { value: 'nano', label: 'Nano (< $50M)' },
  { value: 'micro', label: 'Micro ($50M–$300M)' },
  { value: 'small', label: 'Small ($300M–$2B)' },
  { value: 'mid', label: 'Mid ($2B–$10B)' },
  { value: 'large', label: 'Large ($10B–$200B)' },
  { value: 'mega', label: 'Mega (> $200B)' },
];

const SCORE_LABELS: Record<string, string> = {
  trigger: 'Proximidad al disparo', pattern: 'Patrón previo', volume: 'Volumen',
  sector: 'Sector', trend: 'Tendencia', risk: 'Calidad del riesgo',
  overext: 'Sobre-extensión', fatigue: 'Fatiga del impulso', high52: 'Extensión vs 52w',
};

// ── Primitivas locales (mismo idioma visual que la página) ────────────────
const inputCls =
  'bg-gray-950 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-amber-400/60';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-gray-500">{hint}</span>}
    </label>
  );
}

function NumberInput({ value, onChange, step = 1, min, max }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <input type="number" className={inputCls} value={value} step={step} min={min} max={max}
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
    <div className="bg-gray-950/70 border border-amber-500/15 rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-black mt-1 font-mono ${toneCls}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

function Candle(props: any) {
  const { x, y, width, height, payload } = props;
  const { open, high, low, close } = payload as ChartBar;
  if (high <= low) return null;
  const ratio = height / (high - low);
  const px = (p: number) => y + (high - p) * ratio;
  const up = close >= open;
  const color = up ? '#10b981' : '#f43f5e';
  const cx = x + width / 2;
  const bodyTop = px(Math.max(open, close));
  const bodyH = Math.max(1, px(Math.min(open, close)) - bodyTop);
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={x + width * 0.2} width={Math.max(1, width * 0.6)} y={bodyTop} height={bodyH} fill={color} />
    </g>
  );
}

const fmt = (v: number | null | undefined, suffix = '', dash = '–') =>
  v == null ? dash : `${v}${suffix}`;
const fmtCap = (v: number | null | undefined) => {
  if (v == null) return '–';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v)}`;
};
const fmtDate = (d: string) => {
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};

const tooltipStyle = { background: '#0f172a', border: '1px solid #f59e0b33', borderRadius: 8, fontSize: 11 };

const REGIME_UI = {
  risk_on: { label: 'RISK ON', cls: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' },
  neutral: { label: 'NEUTRAL', cls: 'bg-gray-500/15 border-gray-500/30 text-gray-300' },
  risk_off: { label: 'RISK OFF', cls: 'bg-rose-500/15 border-rose-500/30 text-rose-300' },
} as const;

// ── Tarjeta de un pick ──────────────────────────────────────────────────────
function PickCard({ pick, rank, onChart }: { pick: Pick; rank: number; onChart: (p: Pick) => void }) {
  const [open, setOpen] = useState(false);
  const long = pick.side === 'long';
  const sideCls = long
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    : 'bg-rose-500/15 border-rose-500/40 text-rose-300';
  const v = pick.validation;
  return (
    <div className="rounded-2xl border border-amber-500/20 bg-gray-900/50 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-black text-amber-300/60 font-mono">#{rank}</span>
        <span className="text-xl font-black text-white">{pick.symbol}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${sideCls}`}>
          {long ? 'LONG' : 'SHORT'}
        </span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{pick.sector}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{fmtCap(pick.market_cap)}</span>
        {pick.own_surge_max != null && pick.own_surge_max >= 50 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-300"
            title={`Historial: ${pick.own_surges} movimientos, máx ${pick.own_surge_max}% — pedigrí ${pick.pedigree}`}>
            🚀 mover {pick.own_surge_max >= 100 ? '100%+' : `${Math.round(pick.own_surge_max)}%`}
          </span>
        )}
        {pick.status === 'breaking' && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300">EN CURSO</span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {pick.surge_prob_pct != null ? (
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-wider text-gray-500">P(explosión) 🧠</p>
              <p className="text-xl font-black font-mono text-amber-300 leading-none">{pick.surge_prob_pct}%</p>
            </div>
          ) : (
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-wider text-gray-500">Score</p>
              <p className="text-xl font-black font-mono text-amber-300 leading-none">{pick.score}</p>
            </div>
          )}
          <button onClick={() => onChart(pick)}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition">
            Gráfico
          </button>
        </div>
      </div>

      {/* Plan de trade */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
        <div><p className="text-[10px] uppercase tracking-wider text-gray-500">Último cierre</p>
          <p className="font-mono font-bold text-gray-200">${pick.price}</p></div>
        <div><p className="text-[10px] uppercase tracking-wider text-gray-500">
            {pick.entry_type === 'open' ? 'Entrada (al open · adaptativa)' : `Entrada (${long ? 'buy stop' : 'sell stop'})`}
          </p>
          <p className="font-mono font-bold text-amber-300">${pick.entry}{pick.entry_type === 'open' && <span className="text-[10px] text-gray-500"> ref.</span>}</p>
          {pick.entry_type !== 'open' && pick.entry_reach_pct != null && (
            <p className="text-[9px] text-gray-500">a {pick.entry_reach_pct}% del cierre{pick.entry_reach_atr != null && ` · ${pick.entry_reach_atr}× ATR`} → alcanzable mañana</p>
          )}</div>
        <div><p className="text-[10px] uppercase tracking-wider text-gray-500">Stop loss</p>
          <p className="font-mono font-bold text-rose-400">${pick.stop} <span className="text-[10px] text-gray-500">(−{pick.risk_pct}%)</span></p></div>
        <div><p className="text-[10px] uppercase tracking-wider text-gray-500">Target ({long ? '+' : '−'}{pick.exp_move_pct}% · {pick.rr}R)</p>
          <p className="font-mono font-bold text-emerald-400">${pick.target}</p></div>
        <div><p className="text-[10px] uppercase tracking-wider text-gray-500">Hold esperado</p>
          <p className="font-mono font-bold text-gray-200">~{pick.exp_hold_days} días</p></div>
      </div>

      {/* Validación por backtest propio */}
      <div className="mt-4 rounded-xl bg-gray-950/60 border border-emerald-500/15 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/80 mb-1">
          ✓ Validado por backtest propio (~1 año, mismo setup, target explosivo)
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-300">
          <span>{v.fills} trades ejecutados ({v.events} setups)</span>
          <span>Win rate <b className="text-gray-100">{fmt(v.win_rate_pct, '%')}</b></span>
          <span>Expectancy <b className={v.expectancy_r != null && v.expectancy_r > 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmt(v.expectancy_r, 'R')}</b>/trade</span>
          <span>R total <b className="text-gray-100">{fmt(v.total_r, 'R')}</b></span>
          {v.by_entry && (
            <span className="text-gray-500">
              entrada elegida: <b className="text-cyan-300">{v.entry_type === 'open' ? 'al open' : 'stop en disparo'}</b>
              {' '}(stop {fmt(v.by_entry.stop.expectancy_r, 'R')} vs open {fmt(v.by_entry.open.expectancy_r, 'R')})
            </span>
          )}
        </div>
      </div>

      {/* Dossier de explosiones previas (análisis profundo, ~2 años) */}
      {pick.surge_dossier && pick.surge_dossier.n_context > 0 && (
        <div className="mt-3 rounded-xl bg-gray-950/60 border border-amber-500/15 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80 mb-1">
            🧨 {long ? 'Explosiones' : 'Desplomes'} previos (2 años · estilo Edge Finder)
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-300 mb-2">
            <span><b className="text-amber-300">{pick.surge_dossier.n_context}</b> de ≥{pick.surge_dossier.threshold_context_pct}% · <b className="text-amber-300">{pick.surge_dossier.n_main}</b> de ≥{pick.surge_dossier.threshold_main_pct}%</span>
            {pick.surge_dossier.best_pct != null && <span>Mejor: <b className="text-gray-100">{long ? '+' : '−'}{pick.surge_dossier.best_pct}%</b></span>}
            {pick.surge_dossier.median_pct != null && <span>Mediana: <b className="text-gray-100">{long ? '+' : '−'}{pick.surge_dossier.median_pct}%</b> en ~{pick.surge_dossier.median_days_to_peak}d al pico</span>}
            {pick.surge_dossier.top_pre_pattern && <span>Patrón previo típico: <b className="text-gray-100">{pick.surge_dossier.top_pre_pattern}</b></span>}
          </div>
          {pick.surge_dossier.events.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pick.surge_dossier.events.map((e, i) => (
                <span key={e.date + i} title={`patrón previo: ${e.pre_pattern}${e.vol_pre != null ? ` · vol víspera ${e.vol_pre}×` : ''}`}
                  className={`text-[10px] px-2 py-0.5 rounded-md border font-mono ${e.is_main ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-gray-700 bg-gray-800/50 text-gray-400'}`}>
                  {e.date} {long ? '+' : '−'}{e.magnitude_pct}% ({e.days_to_peak}d)
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Radiografía fundamental (motores de /analizar) */}
      {pick.fundamentals && (
        <div className="mt-2 rounded-xl bg-gray-950/60 border border-sky-500/15 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300/80 mb-1">
            🔬 Fundamentals {pick.fundamentals.name ? `· ${pick.fundamentals.name}` : ''}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-400">
            {pick.fundamentals.current_ratio != null && <span>Current ratio <b className={pick.fundamentals.current_ratio < 1 ? 'text-rose-300' : 'text-gray-200'}>{pick.fundamentals.current_ratio.toFixed(2)}</b></span>}
            {pick.fundamentals.gross_margin != null && <span>Margen bruto <b className="text-gray-200">{Math.round(pick.fundamentals.gross_margin * 100)}%</b></span>}
            {pick.fundamentals.net_margin != null && <span>Margen neto <b className={pick.fundamentals.net_margin < 0 ? 'text-rose-300' : 'text-gray-200'}>{Math.round(pick.fundamentals.net_margin * 100)}%</b></span>}
            {pick.fundamentals.debt_to_equity != null && <span>D/E <b className="text-gray-200">{pick.fundamentals.debt_to_equity.toFixed(1)}</b></span>}
            {pick.fundamentals.price_to_sales != null && <span>P/S <b className="text-gray-200">{pick.fundamentals.price_to_sales.toFixed(2)}</b></span>}
            {pick.fundamentals.beta != null && <span>Beta <b className="text-gray-200">{pick.fundamentals.beta.toFixed(2)}</b></span>}
            {pick.fundamentals.ipo_date && <span>IPO <b className="text-gray-200">{pick.fundamentals.ipo_date}</b></span>}
          </div>
          {pick.fundamentals.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {pick.fundamentals.flags.map((f, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-200">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dilución */}
      {pick.dilution && (
        <p className="mt-2 text-xs text-gray-400">
          Dilución (EDGAR): <b className="text-gray-200">{pick.dilution.score}/100 · {pick.dilution.label}</b>
          {pick.dilution.dilution_1y_pct != null && <> · O/S +{pick.dilution.dilution_1y_pct}% en 1 año</>}
          {pick.dilution_note && <span className="text-rose-300"> — {pick.dilution_note}</span>}
        </p>
      )}

      <p className="mt-3 text-sm text-gray-300 leading-relaxed">{pick.rationale}</p>

      <button onClick={() => setOpen(!open)} className="mt-3 text-xs text-amber-300/80 hover:text-amber-200 font-semibold">
        {open ? '▾ Ocultar desglose del score' : '▸ Ver desglose del score'}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {pick.score_breakdown.map((p) => (
            <div key={p.key} className="flex items-center gap-3 text-xs">
              <span className="w-40 shrink-0 text-gray-400">{SCORE_LABELS[p.key] || p.key}</span>
              <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div className="h-full bg-amber-400/70" style={{ width: `${(p.points / p.max) * 100}%` }} />
              </div>
              <span className="w-14 text-right font-mono text-gray-300">{p.points}/{p.max}</span>
              <span className="hidden md:block flex-[1.4] text-gray-500 truncate" title={p.detail}>{p.detail}</span>
            </div>
          ))}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-1 pt-2 text-[11px] text-gray-500">
            <span>Patrón: <b className="text-gray-300">{pick.pattern}</b></span>
            <span>Ret 10d: <b className="text-gray-300">{pick.ret10_pct}%</b></span>
            {pick.long_run_max_pct != null && <span>Run máx 3-12m: <b className={pick.long_run_max_pct >= 100 ? 'text-amber-300' : 'text-gray-300'}>{pick.long_run_max_pct > 0 ? '+' : ''}{pick.long_run_max_pct}%</b>{pick.long_run_max_pct >= 100 && ' 🚀'}</span>}
            <span>ATR: <b className="text-gray-300">{pick.atr_pct}%</b></span>
            <span>Vol: <b className="text-gray-300">{fmt(pick.vol_ratio, '×')}</b></span>
            <span>Δ52w low: <b className="text-gray-300">{fmt(pick.dist_52w_low_pct, '%')}</b></span>
            <span>Δ52w high: <b className="text-gray-300">{fmt(pick.dist_52w_high_pct, '%')}</b></span>
            <span>Verdes/rojas: <b className="text-gray-300">{pick.consec_green}/{pick.consec_red}</b></span>
            <span>Sector 20d: <b className="text-gray-300">{fmt(pick.sector_ret20_pct, '%')}</b> {pick.sector_hot_now != null && (pick.sector_hot_now ? '🔥' : '❄️')}</span>
            <span>Explosiones propias 1a: <b className="text-gray-300">{pick.own_surges}</b></span>
            {pick.p_up_pct != null && <span>P(↑surge)/P(↓crash): <b className="text-gray-300">{pick.p_up_pct}% / {pick.p_down_pct}%</b></span>}
            <span>Score heurístico: <b className="text-gray-300">{pick.score}</b></span>
          </div>
          {pick.learned_factor != null && pick.learned_notes && pick.learned_notes.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-800">
              <span className="text-[11px] text-teal-300/90">🎯 Ajuste aprendido al ranking: <b className={pick.learned_factor > 1.02 ? 'text-emerald-400' : pick.learned_factor < 0.98 ? 'text-rose-400' : 'text-gray-300'}>×{pick.learned_factor}</b></span>
              <span className="text-[11px] text-gray-500"> — {pick.learned_notes.join(' · ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sección ────────────────────────────────────────────────────────────────
export default function UltimatePredictionSection() {
  const [cfg, setCfg] = useState<UltimateConfig>(DEFAULT_CONFIG);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<UltimateResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [track, setTrack] = useState<TrackRecord | null>(null);
  const [showTrack, setShowTrack] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [chartPick, setChartPick] = useState<Pick | null>(null);
  const [chartBars, setChartBars] = useState<ChartBar[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');

  // Detalle de un pick del track record (disparador + trade)
  const [detailRow, setDetailRow] = useState<TrackRow | null>(null);
  const [detail, setDetail] = useState<PredictionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // Filtros de la tabla del track record (ahora trae el historial completo)
  const [trackFilter, setTrackFilter] = useState<'all' | 'graded' | 'open' | 'pending'>('all');
  const [trackSide, setTrackSide] = useState<'all' | 'long' | 'short'>('all');
  const [trackQuery, setTrackQuery] = useState('');
  const [trackLimit, setTrackLimit] = useState(100);

  const openDetail = useCallback(async (row: TrackRow) => {
    setDetailRow(row); setDetail(null); setDetailError('');
    if (row.id == null) {
      setDetailError('Este pick es anterior al guardado del disparador — no hay detalle.');
      return;
    }
    setDetailLoading(true);
    try {
      setDetail(await getBackend<PredictionDetail>(
        `/backtest/ultimate/prediction/${row.id}`, 30000));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'No se pudo cargar el detalle');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const set = <K extends keyof UltimateConfig>(k: K, v: UltimateConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  // Al montar: califica lo vencido contra precios reales y trae el track
  // record actualizado (si falla, cae al history de solo lectura).
  const [gradeInfo, setGradeInfo] = useState<GradeResponse | null>(null);
  const [grading, setGrading] = useState(false);

  const gradeNow = useCallback(async (silent = false) => {
    if (!silent) setGrading(true);
    try {
      const d = await postBackend<GradeResponse>('/backtest/ultimate/grade', {}, 60000);
      setGradeInfo(d);
      setTrack(d.track_record);
    } catch {
      if (silent) {
        getBackend<{ track_record: TrackRecord }>('/backtest/ultimate/history', 12000)
          .then((d) => setTrack(d.track_record))
          .catch(() => { /* backend caído o sin historial — silencioso */ });
      }
    } finally {
      setGrading(false);
    }
  }, []);

  useEffect(() => { gradeNow(true); }, [gradeNow]);

  const run = useCallback(async () => {
    setError(''); setResult(null); setJob(null); setRunning(true);
    stopPolling();
    // el backend puede estar ocupado (entrenando la red en su ciclo horario);
    // se reintenta el arranque unas veces con timeout generoso antes de rendirse
    const startJob = async (): Promise<string> => {
      let lastErr: any;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const { job_id } = await postBackend<{ job_id: string }>(
            '/backtest/ultimate/start', cfg, 30000);
          return job_id;
        } catch (e: any) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 2500 * attempt));
        }
      }
      throw lastErr;
    };
    try {
      const job_id = await startJob();
      let pollErrors = 0; // se toleran fallos transitorios de polling
      pollRef.current = setInterval(async () => {
        try {
          const snap = await getBackend<JobStatus>(`/backtest/ultimate/status/${job_id}`, 30000);
          pollErrors = 0;
          setJob(snap);
          if (snap.status === 'done') {
            stopPolling(); setRunning(false);
            setResult(snap.result ?? null);
            if (snap.result?.track_record) setTrack(snap.result.track_record);
            gradeNow(true); // refresco completo desde el servidor (track + insights + diario)
          } else if (snap.status === 'error') {
            stopPolling(); setRunning(false);
            setError(snap.error || 'Error en la predicción');
          }
        } catch {
          // el backend puede tardar mientras entrena/valida — no abortar por un
          // fallo puntual; recién se corta tras varios seguidos
          pollErrors += 1;
          if (pollErrors >= 6) {
            stopPolling(); setRunning(false);
            setError('Se perdió la conexión con el backend mientras corría la predicción. '
              + 'La corrida puede seguir en el servidor — reabrí la pestaña en un minuto para ver el resultado.');
          }
        }
      }, 2500);
    } catch (e: any) {
      setRunning(false);
      const msg = String(e?.message || '');
      setError(/abort/i.test(msg)
        ? 'El backend está ocupado (probablemente entrenando la red neuronal). Esperá unos segundos y volvé a intentar.'
        : (e?.message || 'No se pudo iniciar la predicción'));
    }
  }, [cfg, stopPolling, gradeNow]);

  const openChart = useCallback(async (p: Pick) => {
    setChartPick(p); setChartBars(null); setChartError(''); setChartLoading(true);
    try {
      const data = await postBackend<{ bars: ChartBar[] }>(
        '/backtest/edge-predictor/chart', { symbol: p.symbol, bars: 60 }, 25000,
      );
      setChartBars((data.bars || []).map((b) => ({ ...b, range: [b.low, b.high] as [number, number] })));
    } catch (e: any) {
      setChartError(e?.message || 'No se pudo cargar el gráfico');
    } finally {
      setChartLoading(false);
    }
  }, []);

  const regime = result ? REGIME_UI[result.market.regime] : null;

  return (
    <div>
      {/* Filtros — SOLO precio y market cap */}
      <div className="rounded-2xl border border-amber-500/20 bg-gray-900/40 p-5 sm:p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <Field label="Precio mín ($)">
            <NumberInput value={cfg.price_min} min={0} step={0.5} onChange={(v) => set('price_min', v)} />
          </Field>
          <Field label="Precio máx ($)">
            <NumberInput value={cfg.price_max} min={0.01} step={0.5} onChange={(v) => set('price_max', v)} />
          </Field>
          <Field label="Market cap desde">
            <Select value={cfg.market_cap_min} onChange={(v) => set('market_cap_min', v)} options={CAP_OPTIONS} />
          </Field>
          <Field label="Market cap hasta">
            <Select value={cfg.market_cap_max} onChange={(v) => set('market_cap_max', v)} options={CAP_OPTIONS} />
          </Field>
          <Field label="Universo máx" hint="tickers analizados">
            <NumberInput value={cfg.max_universe} min={100} max={8000} step={500} onChange={(v) => set('max_universe', v)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-5">
          <button onClick={run} disabled={running}
            className="px-6 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 font-bold hover:bg-amber-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed">
            {running ? 'Buscando el Top 5…' : '🏆 Buscar Top 5 para la próxima sesión'}
          </button>
          <p className="text-xs text-gray-500 max-w-xl">
            Objetivo: movimientos VERDADERAMENTE explosivos (+80% y superiores / −50% en
            ≤5 días). Una red neuronal re-entrenada en cada corrida asigna P(explosión);
            cada candidato se valida con backtest propio, veto de dilución y veto de
            setups que ya demostraron perder. La corrida puede tardar varios minutos —
            el dataset y la red mejoran con cada día que corras el motor.
          </p>
        </div>
      </div>

      {/* Progreso */}
      {running && (
        <div className="rounded-2xl border border-amber-500/20 bg-gray-900/40 p-5 mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-amber-200 font-semibold">{job?.stage || 'Iniciando…'}</span>
            <span className="font-mono text-gray-400">{job?.progress ?? 0}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-500"
              style={{ width: `${job?.progress ?? 0}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 mb-6 text-sm text-rose-200">{error}</div>
      )}

      {/* Resultado */}
      {result && (
        <div className="space-y-6">
          {/* Banner: para qué sesión + contexto de mercado */}
          <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-transparent p-5">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-amber-300/80 font-bold">Top 5 para la sesión del</p>
                <p className="text-2xl font-black text-white">{fmtDate(result.meta.for_date)}</p>
                <p className="text-[11px] text-gray-500">datos al cierre del {fmtDate(result.meta.as_of)}</p>
              </div>
              {regime && (
                <span className={`ml-2 text-xs font-bold px-3 py-1 rounded-full border ${regime.cls}`}>{regime.label}</span>
              )}
              <div className="ml-auto flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
                <span>SPY 5d <b className="text-gray-200">{fmt(result.market.spy_ret5_pct, '%')}</b> · 20d <b className="text-gray-200">{fmt(result.market.spy_ret20_pct, '%')}</b></span>
                <span>🔥 {result.market.hot_sectors.map((s) => `${s.etf} ${s.ret20_pct > 0 ? '+' : ''}${s.ret20_pct}%`).join(' · ')}</span>
                <span>❄️ {result.market.cold_sectors.map((s) => `${s.etf} ${s.ret20_pct > 0 ? '+' : ''}${s.ret20_pct}%`).join(' · ')}</span>
              </div>
            </div>
          </div>

          {/* Panel de la red neuronal */}
          <div className="rounded-2xl border border-violet-500/25 bg-gray-900/40 p-5">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h3 className="text-sm font-bold text-violet-300">🧠 Red neuronal (surge ≥ +{result.meta.surge_pct_min}% · crash ≥ −{result.meta.crash_pct_min}% en ≤{result.meta.surge_days} días)</h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${result.model.active_this_run ? 'bg-violet-500/15 border-violet-500/40 text-violet-300' : 'bg-gray-500/15 border-gray-500/30 text-gray-400'}`}>
                {result.model.active_this_run ? 'Activa — rankeando por P(explosión)' : 'En espera — ranking heurístico'}
              </span>
              {result.model.trained_at && <span className="text-[10px] text-gray-500">entrenada {result.model.trained_at}</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard label="Dataset acumulado" value={String(result.model.dataset_rows)}
                hint={`+${result.model.examples_added_this_run ?? 0} en esta corrida · ↑${result.model.dataset_up} ↓${result.model.dataset_down}`} />
              <StatCard label="AUC validación ↑" value={fmt(result.model.metrics?.auc_up)}
                tone={(result.model.metrics?.auc_up ?? 0) >= 0.6 ? 'pos' : 'neutral'} hint="0.5 = azar, 1 = perfecto" />
              <StatCard label="AUC validación ↓" value={fmt(result.model.metrics?.auc_down)}
                tone={(result.model.metrics?.auc_down ?? 0) >= 0.6 ? 'pos' : 'neutral'} />
              <StatCard label="Épocas / val loss" value={`${result.model.metrics?.epochs ?? '–'} / ${fmt(result.model.metrics?.val_loss)}`} />
              <StatCard label="Surge mediano del universo" value={fmt(result.model.global_median_surge_pct, '%')} hint="magnitud de las explosiones cosechadas" />
            </div>
            {!result.model.active_this_run && result.model.last_training?.reason && (
              <p className="mt-2 text-xs text-gray-500">⏳ {result.model.last_training.reason}</p>
            )}
            {result.model.ephemeral_storage && (
              <p className="mt-2 text-xs font-semibold text-rose-300">
                ⚠️ Almacenamiento efímero: el backend borra su disco en cada deploy — la memoria del motor
                (dataset, modelo, track record) se pierde con cada push. Monta un volumen persistente en el
                servicio y define <span className="font-mono">ULTIMATE_DATA_DIR=/data</span>.
              </p>
            )}
          </div>

          {/* Ajustes aprendidos aplicados al ranking (loop aprendizaje→decisión) */}
          {result.learned && (
            <div className="rounded-2xl border border-teal-500/25 bg-gray-900/40 p-5">
              <div className="flex flex-wrap items-center gap-3 mb-1">
                <h3 className="text-sm font-bold text-teal-300">🎯 Ajustes aprendidos aplicados al ranking</h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${result.learned.active ? 'bg-teal-500/15 border-teal-500/40 text-teal-300' : 'bg-gray-500/15 border-gray-500/30 text-gray-400'}`}>
                  {result.learned.active ? `activo · ${result.learned.n_filled} trades` : 'en espera'}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mb-3">el track record calificado reordena las oportunidades nuevas: setups que pagaron suben, los que no bajan, y los demostrados perdedores se ELIMINAN (R por pick publicado; sin fill = 0R)</p>
              {!result.learned.active ? (
                <p className="text-xs text-gray-500">{result.learned.notes[0]}</p>
              ) : (
                <div className="space-y-2">
                  {(result.learned.vetoes?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {result.learned.vetoes!.map((v) => (
                        <span key={v.key} className="text-[11px] px-2.5 py-1 rounded-lg border border-rose-500/40 bg-rose-500/15 text-rose-300 font-semibold">
                          🚫 {v.side} «{v.pattern}» eliminado <span className="text-rose-400/70">({v.avg_r}R en {v.fills} trades · {v.n} picks)</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {Object.keys(result.learned.patterns).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(result.learned.patterns).sort((a, b) => b[1].factor - a[1].factor).map(([pat, p]) => (
                        <span key={pat} className={`text-[11px] px-2.5 py-1 rounded-lg border ${p.factor > 1.02 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : p.factor < 0.98 ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-gray-700 bg-gray-800/50 text-gray-400'}`}>
                          {pat.split(' ')[0]} ×{p.factor} <span className="text-gray-500">({p.avg_r}R · {p.n})</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
                    {result.learned.relvol && (
                      <span>Volumen ≥1.5×: <b className={result.learned.relvol.hi_factor > 1 ? 'text-emerald-400' : 'text-rose-400'}>×{result.learned.relvol.hi_factor}</b> ({result.learned.relvol.hi_avg_r}R) · &lt;1.5×: <b>×{result.learned.relvol.lo_factor}</b></span>
                    )}
                    {result.learned.prob && (
                      <span>P(explosión) ≥75%: <b className={result.learned.prob.hi_factor > 1 ? 'text-emerald-400' : 'text-rose-400'}>×{result.learned.prob.hi_factor}</b> ({result.learned.prob.hi_avg_r}R) · &lt;75%: <b>×{result.learned.prob.lo_factor}</b></span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard label="Universo" value={String(result.kpis.universe)} hint={`de ${result.meta.universe_full} del screener`} />
            <StatCard label="Setups long / short" value={`${result.kpis.setups_long} / ${result.kpis.setups_short}`} />
            <StatCard label="Aprobados" value={`${result.kpis.validated}/5`} tone={result.kpis.validated >= 5 ? 'pos' : 'neg'} />
            <StatCard label="Rechazados backtest" value={String(result.kpis.rejected_backtest)} hint="no pasaron su propia historia" />
            <StatCard label="Vetados dilución" value={String(result.kpis.rejected_dilution)} hint="overhang EDGAR" />
            {(result.kpis.rejected_learned ?? 0) > 0 && (
              <StatCard label="Vetados por aprendizaje" value={String(result.kpis.rejected_learned)} tone="neg" hint="setups demostrados perdedores" />
            )}
            <StatCard label={result.kpis.avg_surge_prob_pct != null ? 'P(explosión) media' : 'Expectancy media'}
              value={result.kpis.avg_surge_prob_pct != null ? `${result.kpis.avg_surge_prob_pct}%` : fmt(result.kpis.avg_expectancy_r, 'R')}
              tone="pos" hint="del Top 5" />
          </div>

          {/* Picks */}
          {result.picks.length === 0 ? (
            <div className="rounded-2xl border border-gray-700 bg-gray-900/40 p-8 text-center text-gray-400 text-sm">
              Ningún candidato superó la validación con estos filtros. Amplía el rango de precio/market cap o vuelve a intentar en otro contexto de mercado.
            </div>
          ) : (
            <div className="space-y-4">
              {result.picks.map((p, i) => (
                <PickCard key={p.symbol + p.side} pick={p} rank={i + 1} onChart={openChart} />
              ))}
            </div>
          )}

          {/* Rechazados (transparencia del embudo) */}
          {result.rejected.length > 0 && (
            <div className="rounded-2xl border border-gray-700/60 bg-gray-900/40 p-5">
              <h3 className="text-sm font-bold text-gray-300 mb-3">Candidatos descartados por el propio backtest</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="py-1.5 pr-3">Símbolo</th><th className="pr-3">Lado</th>
                    <th className="pr-3 text-right">P(explosión)</th>
                    <th className="pr-3 text-right">Score</th><th className="pr-3">Etapa</th><th>Motivo</th>
                  </tr></thead>
                  <tbody>
                    {result.rejected.map((r, i) => (
                      <tr key={r.symbol + i} className="border-b border-gray-800/50 text-gray-400">
                        <td className="py-1.5 pr-3 font-mono text-gray-300">{r.symbol}</td>
                        <td className={`pr-3 font-semibold ${r.side === 'long' ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{r.side.toUpperCase()}</td>
                        <td className="pr-3 text-right font-mono">{r.surge_prob_pct != null ? `${r.surge_prob_pct}%` : '–'}</td>
                        <td className="pr-3 text-right font-mono">{r.score}</td>
                        <td className="pr-3">{r.stage === 'dilution' ? 'Dilución' : r.stage === 'aprendizaje' ? 'Veto aprendido' : 'Backtest'}</td>
                        <td>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Warnings */}
          {result.meta.warnings.length > 0 && (
            <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-yellow-300/80 mb-1.5">Limitaciones y notas</p>
              <ul className="text-xs text-gray-400 space-y-1 list-disc pl-4">
                {result.meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Track record (histórico persistente, auto-calificado) */}
      {track && (track.recent?.length ?? 0) > 0 && (
        <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-gray-900/40 p-5">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h3 className="text-sm font-bold text-cyan-300">📒 Track record del motor</h3>
            <p className="text-[11px] text-gray-500">se califica contra los precios reales al abrir esta pestaña, al calificar manualmente o en cada corrida</p>
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => gradeNow(false)} disabled={grading}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition disabled:opacity-50">
                {grading ? 'Calificando…' : '🔄 Calificar ahora'}
              </button>
              <button onClick={() => setShowTrack(!showTrack)} className="text-xs text-cyan-300/80 hover:text-cyan-200 font-semibold">
                {showTrack ? 'Ocultar detalle ▾' : 'Ver detalle ▸'}
              </button>
            </div>
          </div>
          {gradeInfo && (
            <p className="text-[11px] text-gray-500 mb-3">
              Último cierre disponible: <b className="text-gray-300">{gradeInfo.as_of}</b>
              {' · '}{gradeInfo.graded_now > 0
                ? <>se calificaron <b className="text-emerald-300">{gradeInfo.graded_now}</b> predicciones ahora (+{gradeInfo.feedback_rows} ejemplos a la red)</>
                : 'nada nuevo para calificar'}
              {gradeInfo.pending_future > 0 && (
                <> · <b className="text-yellow-300/90">{gradeInfo.pending_future} pendientes</b> son para una sesión futura — se califican cuando esa sesión ocurra</>
              )}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Predicciones calificadas" value={String(track.overall.n)} hint={`${fmt(track.overall.fill_rate_pct, '%')} ejecutaron`} />
            <StatCard label="Win rate real" value={fmt(track.overall.win_rate_pct, '%')}
              tone={(track.overall.win_rate_pct ?? 0) >= 34 ? 'pos' : 'neutral'} hint="con RR 2:1, >34% es rentable" />
            <StatCard label="R promedio real" value={fmt(track.overall.avg_r, 'R')}
              tone={(track.overall.avg_r ?? 0) > 0 ? 'pos' : (track.overall.avg_r ?? 0) < 0 ? 'neg' : 'neutral'} />
            <StatCard label="Long vs Short (R medio)" value={`${fmt(track.long.avg_r)} / ${fmt(track.short.avg_r)}`} hint="el motor ajusta sus pesos con esto" />
          </div>
          {showTrack && (track.by_pattern?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/70 mb-1.5">Qué setups están funcionando (calificados)</p>
              <div className="flex flex-wrap gap-2">
                {track.by_pattern!.map((p) => (
                  <span key={p.pattern} className={`text-[11px] px-2.5 py-1 rounded-lg border ${(p.avg_r ?? 0) > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : (p.avg_r ?? 0) < 0 ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-gray-700 bg-gray-800/50 text-gray-400'}`}>
                    {p.pattern} · {p.n} picks · WR {fmt(p.win_rate_pct, '%')} · {fmt(p.avg_r, 'R')} medio
                  </span>
                ))}
              </div>
            </div>
          )}
          {showTrack && (() => {
            const q = trackQuery.trim().toUpperCase();
            const filtered = track.recent.filter((r) => {
              if (trackFilter === 'graded' && r.status !== 'graded') return false;
              if (trackFilter === 'open' && r.status !== 'open') return false;
              if (trackFilter === 'pending' && r.status !== 'pending') return false;
              if (trackSide !== 'all' && r.side !== trackSide) return false;
              if (q && !r.symbol.toUpperCase().includes(q)) return false;
              return true;
            });
            const shown = filtered.slice(0, trackLimit);
            const chip = (active: boolean) =>
              `px-2 py-0.5 rounded-md text-[11px] font-semibold border transition ${
                active ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                       : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:text-gray-200'}`;
            return (
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[11px] text-gray-500">
                  Historial completo: <b className="text-gray-300">{track.recent.length}</b> predicciones
                  {filtered.length !== track.recent.length && <> · {filtered.length} tras filtrar</>}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  {(['all', 'graded', 'open', 'pending'] as const).map((f) => (
                    <button key={f} onClick={() => { setTrackFilter(f); setTrackLimit(100); }} className={chip(trackFilter === f)}>
                      {f === 'all' ? 'Todas' : f === 'graded' ? 'Calificadas' : f === 'open' ? 'En curso' : 'Pendientes'}
                    </button>
                  ))}
                  <span className="w-px h-4 bg-gray-700 mx-1" />
                  {(['all', 'long', 'short'] as const).map((s) => (
                    <button key={s} onClick={() => { setTrackSide(s); setTrackLimit(100); }} className={chip(trackSide === s)}>
                      {s === 'all' ? 'Ambos' : s.toUpperCase()}
                    </button>
                  ))}
                  <input value={trackQuery} onChange={(e) => { setTrackQuery(e.target.value); setTrackLimit(100); }}
                    placeholder="Símbolo…"
                    className="ml-1 w-24 px-2 py-0.5 rounded-md text-[11px] bg-gray-800/60 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/40" />
                </div>
              </div>
              <p className="text-[11px] text-gray-600 mb-1.5">Clic en el símbolo para ver su disparador y el trade que salió.</p>
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="py-1.5 pr-3">Sesión</th><th className="pr-3">Símbolo</th><th className="pr-3">Lado</th>
                  <th className="pr-3">Patrón</th><th className="pr-3 text-right">P(expl.)</th>
                  <th className="pr-3 text-right">Entrada</th><th className="pr-3 text-right">Stop</th>
                  <th className="pr-3 text-right">Target</th><th className="pr-3">Resultado</th>
                  <th className="pr-3 text-right">R</th><th className="text-right">Días</th>
                </tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.id ?? i} className="border-b border-gray-800/50 text-gray-400 hover:bg-cyan-500/5">
                      <td className="py-1.5 pr-3">{r.for_date}</td>
                      <td className="pr-3">
                        <button onClick={() => openDetail(r)}
                          className="font-mono text-cyan-300 hover:text-cyan-200 hover:underline font-semibold">
                          {r.symbol}
                        </button>
                      </td>
                      <td className={`pr-3 font-semibold ${r.side === 'long' ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{r.side.toUpperCase()}</td>
                      <td className="pr-3 text-gray-500">{r.pattern ? r.pattern.split(' ')[0] : '–'}</td>
                      <td className="pr-3 text-right font-mono">{r.surge_prob_pct != null ? `${r.surge_prob_pct}%` : '–'}</td>
                      <td className="pr-3 text-right font-mono">${r.entry}</td>
                      <td className="pr-3 text-right font-mono">${r.stop}</td>
                      <td className="pr-3 text-right font-mono">${r.target}</td>
                      <td className="pr-3">
                        {r.status === 'pending' ? <span className="text-yellow-400/80">pendiente</span>
                          : r.status === 'open' ? (
                            <span className="text-cyan-300">en curso{r.cur_r != null && <> · <b className={r.cur_r > 0 ? 'text-emerald-400' : 'text-rose-400'}>{r.cur_r > 0 ? '+' : ''}{r.cur_r}R</b></>}{r.max_r != null && r.max_r > 0 && <span className="text-gray-500"> (máx +{r.max_r}R)</span>}</span>
                          )
                          : r.outcome === 'no_fill' || r.outcome?.startsWith('no_fill') ? <span className="text-gray-500">sin fill</span>
                          : <span className={r.outcome?.startsWith('win') ? 'text-emerald-400' : 'text-rose-400'}>{r.outcome}</span>}
                      </td>
                      <td className={`pr-3 text-right font-mono ${(r.outcome_r ?? 0) > 0 ? 'text-emerald-400' : (r.outcome_r ?? 0) < 0 ? 'text-rose-400' : ''}`}>
                        {r.outcome_r != null ? r.outcome_r : (r.status === 'open' && r.cur_r != null ? `${r.cur_r > 0 ? '+' : ''}${r.cur_r}` : '–')}
                        {r.status === 'graded' && r.max_r != null && r.max_r > (r.outcome_r ?? 0) + 0.3 && (
                          <span className="text-gray-500 text-[10px]"> (llegó +{r.max_r})</span>
                        )}
                      </td>
                      <td className="text-right font-mono">{r.days_held ?? '–'}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr><td colSpan={11} className="py-4 text-center text-gray-600">
                      Ninguna predicción coincide con el filtro.
                    </td></tr>
                  )}
                </tbody>
              </table>
              </div>
              {filtered.length > shown.length && (
                <button onClick={() => setTrackLimit((n) => n + 250)}
                  className="mt-2 w-full py-1.5 rounded-lg text-[11px] font-semibold bg-gray-800/50 border border-gray-700 text-gray-400 hover:text-cyan-300 hover:border-cyan-500/30 transition">
                  Mostrar 250 más ({filtered.length - shown.length} restantes)
                </button>
              )}
            </div>
            );
          })()}
        </div>
      )}

      {/* Aprendizaje autónomo: post-mortems, insights y diario */}
      {gradeInfo?.insights && gradeInfo.insights.n > 0 && (
        <div className="mt-6 rounded-2xl border border-violet-500/20 bg-gray-900/40 p-5">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h3 className="text-sm font-bold text-violet-300">🧬 Aprendizaje autónomo</h3>
            <p className="text-[11px] text-gray-500">
              el motor hace un post-mortem de cada predicción (¿ejecutó? ¿el movimiento ocurrió igual?
              ¿qué daba la entrada al open?) y ajusta su comportamiento — también corre solo cada hora en el backend
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Post-mortems" value={String(gradeInfo.insights.n)} hint="predicciones analizadas" />
            <StatCard label="Fill rate real" value={fmt(gradeInfo.insights.fill_rate_pct, '%')}
              tone={(gradeInfo.insights.fill_rate_pct ?? 100) < 45 ? 'neg' : 'neutral'} />
            <StatCard label="Movimientos perdidos" value={fmt(gradeInfo.insights.missed_move_rate_pct, '%')}
              tone={(gradeInfo.insights.missed_move_rate_pct ?? 0) >= 40 ? 'neg' : 'neutral'}
              hint="sin fill pero la explosión ocurrió" />
            <StatCard label="R real vs contrafactual open" value={`${fmt(gradeInfo.insights.avg_r_filled)} / ${fmt(gradeInfo.insights.avg_r_open_counterfactual)}`}
              hint="con esto elige el modo de entrada" />
          </div>
          {gradeInfo.insights.avg_mfe_r != null && (
            <div className="mt-3 rounded-xl bg-gray-950/60 border border-amber-500/15 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300/80 mb-1.5">Máxima ganancia alcanzada (MFE) — ¿el target es demasiado ambicioso?</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-300">
                <span>MFE medio: <b className="text-gray-100">+{gradeInfo.insights.avg_mfe_r}R</b></span>
                <span>Tocaron +1R: <b className="text-gray-100">{gradeInfo.insights.pct_reached_1r}%</b></span>
                <span>Tocaron +2R: <b className="text-gray-100">{gradeInfo.insights.pct_reached_2r}%</b></span>
                {gradeInfo.insights.losers_avg_mfe_r != null && (
                  <span>Perdedores llegaron a: <b className={gradeInfo.insights.losers_avg_mfe_r >= 1 ? 'text-amber-400' : 'text-gray-100'}>+{gradeInfo.insights.losers_avg_mfe_r}R</b> antes de revertir</span>
                )}
              </div>
            </div>
          )}
          {gradeInfo.insights.vol_threshold && (
            <p className="mt-3 text-xs text-gray-400">
              Umbral de volumen de sesión: ≥1.5× → <b className="text-gray-200">{gradeInfo.insights.vol_threshold.above_1_5x.avg_r}R</b> medio
              ({gradeInfo.insights.vol_threshold.above_1_5x.n}) · &lt;1.5× → <b className="text-gray-200">{gradeInfo.insights.vol_threshold.below_1_5x.avg_r}R</b> ({gradeInfo.insights.vol_threshold.below_1_5x.n})
            </p>
          )}
          {gradeInfo.insights.prob_buckets && (
            <p className="mt-1 text-xs text-gray-400">
              ¿La P(explosión) discrimina? P≥75% → <b className="text-gray-200">{gradeInfo.insights.prob_buckets.p_ge_75.avg_r}R</b> medio
              ({gradeInfo.insights.prob_buckets.p_ge_75.n}) · P&lt;75% → <b className="text-gray-200">{gradeInfo.insights.prob_buckets.p_lt_75.avg_r}R</b> ({gradeInfo.insights.prob_buckets.p_lt_75.n})
            </p>
          )}
          {gradeInfo.insights.recent_verdicts.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-300/70 mb-1.5">Post-mortems recientes (el motor se pregunta por qué)</p>
              <ul className="space-y-1.5">
                {gradeInfo.insights.recent_verdicts.map((pm, i) => (
                  <li key={i} className="text-xs text-gray-400">
                    <span className="font-mono text-gray-300">{pm.symbol}</span>
                    <span className={`ml-1.5 font-semibold ${pm.side === 'long' ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>{pm.side.toUpperCase()}</span>
                    <span className="text-gray-600"> · {pm.for_date} — </span>{pm.verdict}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gradeInfo.insights.reasoning && (gradeInfo.insights.reasoning.winners_vol_vs_prior_day != null || gradeInfo.insights.reasoning.winners_median_move_time != null) && (
            <div className="mt-4 rounded-xl bg-gray-950/60 border border-violet-500/15 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-300/80 mb-1.5">La previa de los ganadores (razonamiento sobre volumen · hora · premarket)</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-300">
                {gradeInfo.insights.reasoning.winners_vol_vs_prior_day != null && (
                  <span>Volumen vs día previo: ganadores <b className="text-emerald-400">{gradeInfo.insights.reasoning.winners_vol_vs_prior_day}×</b>
                    {gradeInfo.insights.reasoning.losers_vol_vs_prior_day != null && <> · perdedores <b className="text-rose-400">{gradeInfo.insights.reasoning.losers_vol_vs_prior_day}×</b></>}</span>
                )}
                {gradeInfo.insights.reasoning.winners_vol_vs_prior_week != null && (
                  <span>Vol vs semana previa (gan.): <b className="text-gray-100">{gradeInfo.insights.reasoning.winners_vol_vs_prior_week}×</b></span>
                )}
                {gradeInfo.insights.reasoning.winners_median_move_time && (
                  <span>Hora típica del extremo: <b className="text-gray-100">{gradeInfo.insights.reasoning.winners_median_move_time} ET</b></span>
                )}
                {gradeInfo.insights.reasoning.winners_pm_gap_pct != null && (
                  <span>Premarket gap medio (gan.): <b className="text-gray-100">{gradeInfo.insights.reasoning.winners_pm_gap_pct}%</b></span>
                )}
                {gradeInfo.insights.reasoning.winners_first5_fav_pct != null && (
                  <span>Primeros 5 min (a favor del lado): ganadores <b className="text-emerald-400">{gradeInfo.insights.reasoning.winners_first5_fav_pct > 0 ? '+' : ''}{gradeInfo.insights.reasoning.winners_first5_fav_pct}%</b>
                    {gradeInfo.insights.reasoning.losers_first5_fav_pct != null && <> · perdedores <b className="text-rose-400">{gradeInfo.insights.reasoning.losers_first5_fav_pct > 0 ? '+' : ''}{gradeInfo.insights.reasoning.losers_first5_fav_pct}%</b></>}</span>
                )}
                {gradeInfo.insights.reasoning.winners_first5_relvol != null && (
                  <span>Vol primeros 5 min (gan.): <b className="text-gray-100">{gradeInfo.insights.reasoning.winners_first5_relvol}×</b> lo normal
                    {gradeInfo.insights.reasoning.losers_first5_relvol != null && <> · perd. <b className="text-gray-400">{gradeInfo.insights.reasoning.losers_first5_relvol}×</b></>}</span>
                )}
              </div>
            </div>
          )}
          {(gradeInfo.insights.market_context || gradeInfo.insights.sector_context) && (
            <div className="mt-4 rounded-xl bg-gray-950/60 border border-violet-500/15 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-300/80 mb-1.5">¿Cómo estaba el mercado y el sector el día del trade?</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-300">
                {gradeInfo.insights.market_context && (
                  <span>Longs con SPY verde: <b className="text-emerald-400">{gradeInfo.insights.market_context.long_spy_green.avg_r}R</b> ({gradeInfo.insights.market_context.long_spy_green.n})
                    {' '}· con SPY rojo: <b className="text-rose-400">{gradeInfo.insights.market_context.long_spy_red.avg_r}R</b> ({gradeInfo.insights.market_context.long_spy_red.n})</span>
                )}
                {gradeInfo.insights.sector_context && (
                  <span>Sector a favor: <b className="text-emerald-400">{gradeInfo.insights.sector_context.with_sector.avg_r}R</b> ({gradeInfo.insights.sector_context.with_sector.n})
                    {' '}· en contra: <b className="text-rose-400">{gradeInfo.insights.sector_context.against_sector.avg_r}R</b> ({gradeInfo.insights.sector_context.against_sector.n})</span>
                )}
              </div>
            </div>
          )}
          {(gradeInfo.learning_log?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-violet-300/70 mb-1.5">Diario de aprendizaje</p>
              <ul className="space-y-1.5">
                {gradeInfo.learning_log!.map((l, i) => (
                  <li key={i} className="text-xs text-gray-400">
                    <span className="text-gray-600">{l.created_at} · </span>
                    <span className={`font-semibold ${l.kind === 'retrain' ? 'text-violet-300' : l.kind === 'grade' ? 'text-cyan-300' : l.kind === 'veto' ? 'text-rose-300' : l.kind === 'migration' ? 'text-sky-300' : 'text-amber-300'}`}>{l.kind}</span>
                    <span className="text-gray-600"> — </span>{l.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Modal de gráfico */}
      {chartPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setChartPick(null)}>
          <div className="bg-gray-900 border border-amber-500/25 rounded-2xl p-5 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-black text-amber-300">
                {chartPick.symbol}
                <span className="text-gray-500 text-sm font-normal"> · {chartPick.side.toUpperCase()} · entrada ${chartPick.entry} · stop ${chartPick.stop} · target ${chartPick.target}</span>
              </h3>
              <button onClick={() => setChartPick(null)} className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
            </div>
            {chartLoading && <p className="text-sm text-gray-400 py-16 text-center">Cargando gráfico…</p>}
            {chartError && <p className="text-sm text-rose-300 py-16 text-center">{chartError}</p>}
            {chartBars && chartBars.length > 0 && (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={chartBars} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                  <XAxis dataKey="t" stroke="#6b7280" fontSize={10} minTickGap={24} />
                  <YAxis stroke="#6b7280" fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v: any, name: any) => (name === 'range' ? null : [v, name])}
                    labelFormatter={(l: any, pl: any) => {
                      const b = pl?.[0]?.payload as ChartBar | undefined;
                      return b ? `${b.day} · O ${b.open} H ${b.high} L ${b.low} C ${b.close}` : l;
                    }} />
                  <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
                  <ReferenceLine y={chartPick.entry} stroke="#f59e0b" strokeDasharray="4 4"
                    label={{ value: 'entrada', fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }} />
                  <ReferenceLine y={chartPick.stop} stroke="#f43f5e" strokeDasharray="4 4"
                    label={{ value: 'stop', fill: '#f43f5e', fontSize: 10, position: 'insideBottomRight' }} />
                  <ReferenceLine y={chartPick.target} stroke="#10b981" strokeDasharray="4 4"
                    label={{ value: 'target', fill: '#10b981', fontSize: 10, position: 'insideTopLeft' }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            {chartBars && chartBars.length === 0 && (
              <p className="text-sm text-gray-400 py-16 text-center">Sin datos de gráfico para este símbolo.</p>
            )}
          </div>
        </div>
      )}

      {/* Detalle de un pick del track record: disparador + trade */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto"
          onClick={() => { setDetailRow(null); setDetail(null); }}>
          <div className="bg-gray-900 border border-cyan-500/25 rounded-2xl p-5 w-full max-w-4xl my-8"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-cyan-300">
                  {detailRow.symbol}
                  <span className={`ml-2 text-sm font-bold ${detailRow.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {detailRow.side.toUpperCase()}
                  </span>
                  <span className="text-gray-500 text-sm font-normal"> · sesión {detailRow.for_date}</span>
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Entrada ${detailRow.entry} · stop ${detailRow.stop} · target ${detailRow.target}
                  {detailRow.entry_type && <> · entrada por {detailRow.entry_type === 'open' ? 'apertura' : 'stop'}</>}
                  {' · '}score {detailRow.score}
                </p>
              </div>
              <button onClick={() => { setDetailRow(null); setDetail(null); }}
                className="text-gray-500 hover:text-gray-300 text-xl leading-none">×</button>
            </div>

            {detailLoading && <p className="text-sm text-gray-400 py-12 text-center">Cargando el disparador y el trade…</p>}
            {detailError && <p className="text-sm text-amber-300/90 py-8 text-center">{detailError}</p>}

            {detail && (
              <div className="space-y-5">
                {/* ── EL DISPARADOR ── */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300/70 mb-2">
                    🎯 El disparador — por qué se publicó
                  </h4>
                  {detail.trigger.rationale && (
                    <p className="text-xs text-gray-300 leading-relaxed mb-3 bg-gray-800/40 rounded-lg p-3 border border-gray-700/50">
                      {detail.trigger.rationale}
                    </p>
                  )}
                  {detail.trigger.score_breakdown.length > 0 ? (
                    <div className="space-y-1">
                      {detail.trigger.score_breakdown.map((p) => (
                        <div key={p.key} className="flex items-center gap-2 text-[11px]">
                          <span className="w-24 shrink-0 font-semibold text-gray-400">{p.key}</span>
                          <div className="w-28 shrink-0 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div className="h-full bg-cyan-500/60 rounded-full"
                              style={{ width: `${Math.max(0, Math.min(100, (p.points / p.max) * 100))}%` }} />
                          </div>
                          <span className="w-16 shrink-0 font-mono text-gray-400">{p.points}/{p.max}</span>
                          <span className="text-gray-500 truncate">{p.detail}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-600">
                      Este pick se publicó antes de que el motor guardara el desglose del disparador.
                    </p>
                  )}
                  {Object.keys(detail.trigger.setup).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {Object.entries(detail.trigger.setup).map(([k, v]) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800/60 border border-gray-700/60 text-gray-400">
                          {k}: <b className="text-gray-300">{typeof v === 'boolean' ? (v ? 'sí' : 'no') : String(v)}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {detail.trigger.validation?.expectancy_r != null && (
                    <p className="text-[11px] text-gray-500 mt-2">
                      Validación previa sobre su propia historia: {detail.trigger.validation.fills} fills ·
                      WR {fmt(detail.trigger.validation.win_rate_pct, '%')} ·
                      expectancy <b className="text-gray-300">{fmt(detail.trigger.validation.expectancy_r, 'R')}</b>
                    </p>
                  )}
                </div>

                {/* ── EL TRADE ── */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300/70 mb-2">
                    📈 El trade — qué pasó realmente
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <StatCard label="Resultado" value={detailRow.outcome ?? detailRow.status}
                      tone={detailRow.outcome?.startsWith('win') ? 'pos'
                        : detailRow.outcome?.startsWith('loss') ? 'neg' : 'neutral'} />
                    <StatCard label="R realizado" value={fmt(detailRow.outcome_r, 'R')}
                      tone={(detailRow.outcome_r ?? 0) > 0 ? 'pos' : (detailRow.outcome_r ?? 0) < 0 ? 'neg' : 'neutral'} />
                    <StatCard label="R máximo alcanzado" value={fmt(detail.post_mortem?.mfe_r ?? detailRow.max_r, 'R')}
                      hint="cuánto llegó a dar" />
                    <StatCard label="Días en el trade" value={detailRow.days_held != null ? String(detailRow.days_held) : '–'} />
                  </div>
                  {detail.post_mortem && (
                    <div className="text-[11px] text-gray-400 bg-gray-800/40 rounded-lg p-3 border border-gray-700/50 space-y-1">
                      {detail.post_mortem.verdict && (
                        <p className="text-gray-300"><b>Veredicto del motor:</b> {detail.post_mortem.verdict}</p>
                      )}
                      <p>
                        {detail.post_mortem.filled ? 'Ejecutó la entrada' : 'No llegó a ejecutar'}
                        {detail.post_mortem.gap_pct != null && <> · gap de apertura {detail.post_mortem.gap_pct}%</>}
                        {detail.post_mortem.session_vol_ratio != null && <> · volumen de la sesión {detail.post_mortem.session_vol_ratio}× el promedio</>}
                        {detail.post_mortem.move_pct != null && <> · el movimiento fue {detail.post_mortem.move_pct}%</>}
                      </p>
                      {(detail.post_mortem.spy_day_pct != null || detail.post_mortem.sector_day_pct != null) && (
                        <p className="text-gray-500">
                          Contexto de ese día: SPY {fmt(detail.post_mortem.spy_day_pct, '%')}
                          {detail.post_mortem.sector_day_pct != null && <> · sector {fmt(detail.post_mortem.sector_day_pct, '%')}</>}
                        </p>
                      )}
                    </div>
                  )}
                  {detail.bars.length > 0 && (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-[11px]">
                        <thead><tr className="text-left text-gray-600 border-b border-gray-800">
                          <th className="py-1 pr-3">Fecha</th><th className="pr-3 text-right">Apertura</th>
                          <th className="pr-3 text-right">Máx</th><th className="pr-3 text-right">Mín</th>
                          <th className="pr-3 text-right">Cierre</th><th>Evento</th>
                        </tr></thead>
                        <tbody>
                          {detail.bars.map((b) => (
                            <tr key={b.date} className={`border-b border-gray-800/40 ${
                              b.phase === 'previa' ? 'text-gray-600' : 'text-gray-400'}`}>
                              <td className="py-1 pr-3 font-mono">{b.date}</td>
                              <td className="pr-3 text-right font-mono">{b.open}</td>
                              <td className="pr-3 text-right font-mono">{b.high}</td>
                              <td className="pr-3 text-right font-mono">{b.low}</td>
                              <td className="pr-3 text-right font-mono">{b.close}</td>
                              <td>
                                {b.event === 'entrada' ? <span className="text-amber-300 font-semibold">▶ entrada</span>
                                  : b.event === 'target' ? <span className="text-emerald-400 font-semibold">✓ target</span>
                                  : b.event === 'stop' ? <span className="text-rose-400 font-semibold">✗ stop</span>
                                  : b.event === 'sin_fill_gap' ? <span className="text-gray-500">abrió pasado el nivel — no se persigue</span>
                                  : b.phase === 'previa' ? <span className="text-gray-700">previa</span> : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
