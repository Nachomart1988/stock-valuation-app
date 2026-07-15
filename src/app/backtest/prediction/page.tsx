'use client';

/**
 * Edge Predictor — /backtest/prediction (GOD MODE).
 *
 * Pestaña que se abre desde el botón «Prediction» del Edge Finder. Recibe por
 * localStorage el perfil del análisis recién corrido (KPIs + distribuciones) y
 * lanza el motor de predicción: re-escanea el MISMO universo al último cierre
 * y rankea los tickers cuyo setup actual más se parece al patrón previo de los
 * surges históricos — candidatos "a punto de breakout", con su plan de trade
 * (entrada sobre el high de 10 días, stop, target y R:R) y gráfico diario.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ComposedChart,
} from 'recharts';
import Header from '@/app/components/Header';
import { postBackend, getBackend } from '@/lib/backendClient';

// ── Types (espejo del backend edge_predictor_engine.py) ───────────────────
interface HandoffConfig {
  price_min: number; price_max: number;
  market_cap_min: string; market_cap_max: string;
  surge_pct_min: number; surge_days: number;
  date_from: string; date_to: string;
  max_universe: number;
  [k: string]: unknown;
}

interface Handoff {
  v: number;
  created_at: string;
  config: HandoffConfig;
  profile: {
    kpis: {
      events: number; symbols: number;
      median_surge_pct: number | null; avg_surge_pct: number;
      median_days_to_peak: number | null; pct_hot_sector: number | null;
      median_dist_52w_low: number | null; pct_after_red_streak: number | null;
      [k: string]: unknown;
    };
    by_pattern: Array<{ pattern: string; count: number; pct: number; med_ret_10d: number | null; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  summary: { events: number; symbols: number; date_from: string; date_to: string };
}

interface ScorePart { key: string; label: string; points: number; max: number; detail: string }

interface Candidate {
  symbol: string; sector: string; industry: string | null; exchange: string | null;
  market_cap: number | null;
  as_of: string; price: number; d1_chg_pct: number | null;
  trigger: number; proximity_pct: number; status: 'breaking' | 'ready' | 'building';
  pattern: string; pre_ret10_pct: number; compression: number; pre_tr_pct: number;
  consec_red: number; consec_green: number;
  vol_prev: number; vol_avg20: number | null; vol_ratio: number | null;
  dist_52w_low_pct: number | null; dist_52w_high_pct: number | null;
  sector_etf: string | null; sector_ret20_pct: number | null; spy_ret20_pct: number | null;
  sector_hot_now: boolean | null;
  entry: number; stop: number; target: number; rr: number | null; risk_pct: number | null;
  exp_move_pct: number | null; exp_days_to_peak: number | null;
  hist_pattern_count: number | null; hist_pattern_med_surge: number | null; hist_pattern_med_ret10: number | null;
  score: number; score_breakdown: ScorePart[];
}

interface PredictorResult {
  kpis: {
    candidates_total: number; shown: number;
    breaking: number; ready: number; building: number;
    median_score: number | null; pct_sector_hot_now: number | null; median_rr: number | null;
    exp_move_pct: number | null; exp_days_to_peak: number | null;
    top_pattern: string | null; top_pattern_count: number | null;
  };
  candidates: Candidate[];
  meta: {
    as_of: string; universe_size: number; universe_full: number;
    profile_events: number; warnings: string[];
  };
}

interface JobStatus {
  job_id: string; status: 'queued' | 'running' | 'done' | 'error';
  progress: number; stage: string; error?: string | null; result?: PredictorResult;
}

interface CandleBar {
  t: string; day: string;
  open: number; high: number; low: number; close: number; volume: number;
  range: [number, number];
}

const HANDOFF_KEY = 'edge-predictor-handoff:v1';

const CAP_LABEL: Record<string, string> = {
  nano: 'Nano', micro: 'Micro', small: 'Small', mid: 'Mid', large: 'Large', mega: 'Mega',
};

const STATUS_META: Record<Candidate['status'], { label: string; cls: string }> = {
  breaking: { label: 'Rompiendo hoy', cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' },
  ready: { label: 'En zona de disparo', cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' },
  building: { label: 'Armándose', cls: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' },
};

// ── Primitivas locales (mismo idioma visual que /backtest) ────────────────
const inputCls =
  'bg-gray-950 border border-violet-500/20 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-violet-400/60';

const fmt = (v: number | null | undefined, suffix = '', dash = '–') =>
  v == null ? dash : `${v}${suffix}`;
const fmtVol = (v: number | null | undefined) => {
  if (v == null) return '–';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${Math.round(v)}`;
};
const fmtCap = (v: number | null | undefined) => {
  if (v == null) return '–';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v)}`;
};

const tooltipStyle = { background: '#0f172a', border: '1px solid #8b5cf633', borderRadius: 8, fontSize: 11 };

function StatCard({ label, value, tone = 'neutral', hint }: {
  label: string; value: string; tone?: 'pos' | 'neg' | 'neutral'; hint?: string;
}) {
  const toneCls = tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-rose-400' : 'text-gray-100';
  return (
    <div className="bg-gray-950/70 border border-violet-500/15 rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-black mt-1 font-mono ${toneCls}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

// Vela custom (idéntica en espíritu a la del Edge Finder)
function Candle(props: any) {
  const { x, y, width, height, payload } = props;
  const { open, high, low, close } = payload as CandleBar;
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

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-300';
  if (score >= 50) return 'text-amber-300';
  return 'text-gray-300';
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function PredictionPage() {
  const { user, isLoaded } = useUser();
  const isGodMode = (user?.publicMetadata?.plan as string) === 'godmode';

  // undefined = leyendo storage · null = no hay handoff
  const [handoff, setHandoff] = useState<Handoff | null | undefined>(undefined);
  const [topN, setTopN] = useState(40);
  const [near, setNear] = useState(10);

  const [job, setJob] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<PredictorResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);

  // modal de gráfico por candidato
  const [chartCand, setChartCand] = useState<Candidate | null>(null);
  const [chartBars, setChartBars] = useState<CandleBar[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HANDOFF_KEY);
      setHandoff(raw ? (JSON.parse(raw) as Handoff) : null);
    } catch {
      setHandoff(null);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const run = useCallback(async (h: Handoff) => {
    setError(''); setResult(null); setJob(null); setRunning(true);
    stopPolling();
    const body = {
      price_min: h.config.price_min,
      price_max: h.config.price_max,
      market_cap_min: h.config.market_cap_min,
      market_cap_max: h.config.market_cap_max,
      surge_pct_min: h.config.surge_pct_min,
      surge_days: h.config.surge_days,
      max_universe: h.config.max_universe,
      top_n: topN,
      near_trigger_pct: near,
      profile: h.profile,
    };
    try {
      const { job_id } = await postBackend<{ job_id: string }>('/backtest/edge-predictor/start', body, 15000);
      pollRef.current = setInterval(async () => {
        try {
          const snap = await getBackend<JobStatus>(`/backtest/edge-predictor/status/${job_id}`, 20000);
          setJob(snap);
          if (snap.status === 'done') {
            stopPolling(); setRunning(false);
            setResult(snap.result ?? null);
          } else if (snap.status === 'error') {
            stopPolling(); setRunning(false);
            setError(snap.error || 'Error en la predicción');
          }
        } catch (e: any) {
          stopPolling(); setRunning(false);
          setError(e?.message || 'Error consultando el estado del job');
        }
      }, 1500);
    } catch (e: any) {
      setRunning(false);
      setError(e?.message || 'No se pudo iniciar la predicción');
    }
  }, [topN, near, stopPolling]);

  // auto-arranque al abrir la pestaña con un handoff válido
  useEffect(() => {
    if (handoff && isGodMode && !startedRef.current) {
      startedRef.current = true;
      run(handoff);
    }
  }, [handoff, isGodMode, run]);

  const openChart = useCallback(async (cand: Candidate) => {
    setChartCand(cand); setChartBars(null); setChartError(''); setChartLoading(true);
    try {
      const data = await postBackend<{ bars: Omit<CandleBar, 'range'>[] }>(
        '/backtest/edge-predictor/chart', { symbol: cand.symbol, bars: 60 }, 25000,
      );
      setChartBars((data.bars || []).map((b) => ({ ...b, range: [b.low, b.high] as [number, number] })));
    } catch (e: any) {
      setChartError(e?.message || 'No se pudo cargar el gráfico');
    } finally {
      setChartLoading(false);
    }
  }, []);

  // ── Gating ────────────────────────────────────────────────────────────────
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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-bold uppercase tracking-wider mb-4">
            God Mode
          </div>
          <h1 className="text-3xl font-black text-white mb-3">Edge Predictor</h1>
          <p className="text-gray-400">Esta herramienta está disponible únicamente para cuentas <span className="text-violet-300 font-semibold">God Mode</span>.</p>
          <Link href="/" className="inline-block mt-6 px-5 py-2.5 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-200 font-semibold hover:bg-violet-500/30 transition">Volver al inicio</Link>
        </div>
      </div>
    );
  }

  const k = result?.kpis;
  const pk = handoff?.profile?.kpis;
  const topPatterns = (handoff?.profile?.by_pattern ?? []).slice(0, 3);

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Heading */}
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl sm:text-3xl font-black text-violet-300">Edge Predictor</h1>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 uppercase tracking-wider">God Mode</span>
        </div>
        <p className="text-gray-400 text-sm mb-6 max-w-3xl">
          Re-escanea el <span className="text-violet-300">mismo universo</span> del Edge Finder al último cierre y rankea
          los tickers cuyo setup actual más se parece al patrón previo de los surges históricos — candidatos
          a <span className="text-violet-300">próximo breakout</span>, con entrada, stop, target y gráfico.
        </p>

        {/* Sin handoff */}
        {handoff === null && (
          <div className="rounded-2xl border border-violet-500/20 bg-gray-900/40 p-10 text-center">
            <p className="text-gray-300 font-semibold mb-2">No hay un análisis del Edge Finder para predecir.</p>
            <p className="text-gray-500 text-sm mb-6 max-w-xl mx-auto">
              Esta página se alimenta del perfil histórico que genera el Edge Finder. Corré primero un escaneo
              en la pestaña <span className="text-violet-300">Edge Finder · Surges</span> y apretá el botón <span className="text-violet-300">🔮 Prediction</span> sobre los resultados.
            </p>
            <Link href="/backtest" className="inline-block px-5 py-2.5 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-200 font-semibold hover:bg-violet-500/30 transition">
              Ir al Edge Finder
            </Link>
          </div>
        )}

        {handoff && (
          <>
            {/* Perfil del edge heredado */}
            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.04] p-5 mb-6">
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
                <h2 className="text-sm font-bold text-violet-300">Perfil histórico del Edge Finder</h2>
                <span className="text-[10px] text-gray-500">generado {new Date(handoff.created_at).toLocaleString()}</span>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">
                <span className="font-mono text-violet-200">{handoff.summary.events}</span> surges en{' '}
                <span className="font-mono text-violet-200">{handoff.summary.symbols}</span> tickers
                ({handoff.summary.date_from} → {handoff.summary.date_to}) · objetivo{' '}
                <span className="text-emerald-400 font-semibold">+{handoff.config.surge_pct_min}% en {handoff.config.surge_days}d</span> ·
                surge mediano <span className="text-emerald-400">{fmt(pk?.median_surge_pct, '%')}</span> ·
                días al pico {fmt(pk?.median_days_to_peak)} · sector HOT {fmt(pk?.pct_hot_sector, '%')}
              </p>
              <p className="text-xs text-gray-400 mt-1.5">
                Universo: ${handoff.config.price_min}–${handoff.config.price_max} ·{' '}
                {CAP_LABEL[handoff.config.market_cap_min] ?? handoff.config.market_cap_min}→{CAP_LABEL[handoff.config.market_cap_max] ?? handoff.config.market_cap_max}
                {topPatterns.length > 0 && (
                  <>
                    {' '}· patrones dominantes:{' '}
                    {topPatterns.map((p, i) => (
                      <span key={p.pattern}>
                        {i > 0 && ', '}
                        <span className="text-gray-200">{p.pattern}</span> <span className="text-violet-300">({p.pct}%)</span>
                      </span>
                    ))}
                  </>
                )}
              </p>

              {/* Knobs + re-run */}
              <div className="flex flex-wrap items-end gap-4 mt-4">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300/80">Máx candidatos</span>
                  <input type="number" className={inputCls} value={topN} min={5} max={200} step={5}
                    onChange={(e) => setTopN(parseInt(e.target.value) || 40)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300/80">Cercanía al disparo (%)</span>
                  <input type="number" className={inputCls} value={near} min={1} max={50} step={1}
                    onChange={(e) => setNear(parseFloat(e.target.value) || 10)} />
                </label>
                <button onClick={() => run(handoff)} disabled={running}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-600 hover:to-fuchsia-700 text-white font-bold rounded-xl shadow-lg shadow-violet-500/20 disabled:opacity-50 transition-all text-sm">
                  {running ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : null}
                  {running ? 'Prediciendo…' : 'Actualizar predicción'}
                </button>
                <span className="text-[11px] text-gray-500 pb-2">
                  Cercanía = distancia máxima del cierre al high de 10 días (el nivel de disparo).
                </span>
              </div>

              {running && job && (
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] text-gray-400 mb-1">
                    <span>{job.stage}</span><span>{job.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${job.progress}%` }} />
                  </div>
                </div>
              )}
              {error && <p className="mt-4 text-sm text-rose-400">⚠ {error}</p>}
            </div>

            {/* Resultados */}
            {result && k && (
              <div className="space-y-6">
                {k.candidates_total === 0 ? (
                  <div className="rounded-2xl border border-violet-500/15 bg-gray-900/40 p-8 text-center text-gray-400">
                    Ningún ticker del universo está hoy a ≤{near}% de su nivel de disparo.{' '}
                    <span className="text-gray-500">({result.meta.universe_size} tickers analizados al {result.meta.as_of})</span>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <h2 className="text-lg font-black text-violet-200">
                        Candidatos a breakout{' '}
                        <span className="text-gray-500 font-normal text-sm">
                          · {k.candidates_total} detectados al {result.meta.as_of} · mostrando top {k.shown}
                        </span>
                      </h2>
                    </div>

                    {/* KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      <StatCard label="Candidatos" value={String(k.candidates_total)} hint={`en ${result.meta.universe_size} tickers del universo`} />
                      <StatCard label="Rompiendo hoy" value={String(k.breaking)} tone={k.breaking > 0 ? 'pos' : 'neutral'} hint="cerraron sobre el high de 10 días" />
                      <StatCard label="En zona de disparo" value={String(k.ready)} hint="a ≤3% del nivel de disparo" />
                      <StatCard label="Score mediano" value={fmt(k.median_score)} hint="similitud con el perfil histórico (0–100)" />
                      <StatCard label="Sector HOT ahora" value={fmt(k.pct_sector_hot_now, '%')} tone={(k.pct_sector_hot_now ?? 0) >= 50 ? 'pos' : 'neutral'} hint="ETF sectorial > SPY (últimos 20d)" />
                      <StatCard label="R:R mediano" value={fmt(k.median_rr, '×')} hint="target vs stop del plan de trade" />
                      <StatCard label="Movida esperada" value={fmt(k.exp_move_pct, '%')} tone="pos" hint="mediana de los surges históricos" />
                      <StatCard label="Días al pico (est.)" value={fmt(k.exp_days_to_peak)} hint="mediana histórica dentro de la ventana" />
                    </div>

                    {/* Tabla de candidatos */}
                    <div className="rounded-2xl border border-violet-500/15 bg-gray-900/40 p-5">
                      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                        <h3 className="text-sm font-bold text-violet-300">Ranking por similitud con el edge</h3>
                        <span className="text-[10px] text-gray-500">🔥 = sector HOT ahora · Δ disparo = cierre vs high 10d · plan: entrada buy-stop en el disparo, stop bajo el mínimo 5d, target = mediana histórica</span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 text-left border-b border-gray-800">
                              <th className="py-2 pr-2 text-right">#</th>
                              <th className="pr-3">Símbolo</th>
                              <th className="pr-3">Sector</th>
                              <th className="pr-3 text-right">Precio</th>
                              <th className="pr-3 text-right">Score</th>
                              <th className="pr-3">Estado</th>
                              <th className="pr-3 text-right">Δ disparo</th>
                              <th className="pr-3">Patrón actual</th>
                              <th className="pr-3 text-right">Vol últ. día</th>
                              <th className="pr-3 text-right">Δ52w low</th>
                              <th className="pr-3 text-right">Entrada</th>
                              <th className="pr-3 text-right">Stop</th>
                              <th className="pr-3 text-right">Target</th>
                              <th className="pr-3 text-right">R:R</th>
                              <th className="pr-3 text-center">📈</th>
                            </tr>
                          </thead>
                          <tbody className="font-mono">
                            {result.candidates.map((c, i) => (
                              <tr key={c.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer" onClick={() => openChart(c)}>
                                <td className="py-1.5 pr-2 text-right text-gray-500">{i + 1}</td>
                                <td className="pr-3 text-gray-100 font-sans font-semibold whitespace-nowrap">
                                  {c.symbol}
                                  {c.sector_hot_now && <span className="ml-1" title={`Sector HOT ahora: ${c.sector_etf} ${c.sector_ret20_pct}% vs SPY ${c.spy_ret20_pct}% (20d)`}>🔥</span>}
                                </td>
                                <td className="pr-3 font-sans text-gray-400 whitespace-nowrap" title={c.industry ?? undefined}>
                                  {c.sector}{c.market_cap ? <span className="text-gray-600"> · {fmtCap(c.market_cap)}</span> : null}
                                </td>
                                <td className="pr-3 text-right text-gray-300">${c.price}</td>
                                <td className="pr-3 text-right">
                                  <span className={`font-bold ${scoreColor(c.score)}`}>{c.score}</span>
                                  <span className="inline-block w-10 h-1.5 rounded-full bg-gray-800 ml-1.5 align-middle overflow-hidden">
                                    <span className="block h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, c.score)}%` }} />
                                  </span>
                                </td>
                                <td className="pr-3 font-sans whitespace-nowrap">
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${STATUS_META[c.status].cls}`}>
                                    {STATUS_META[c.status].label}
                                  </span>
                                </td>
                                <td className={`pr-3 text-right ${c.proximity_pct >= -3 ? 'text-amber-300' : 'text-gray-400'}`}>{c.proximity_pct}%</td>
                                <td className="pr-3 font-sans text-gray-300 whitespace-nowrap" title={`ret 10d previo ${c.pre_ret10_pct}% · compresión ${c.compression} · ${c.consec_red > 0 ? `${c.consec_red} días rojos` : `${c.consec_green} días verdes`}`}>
                                  {c.pattern}
                                </td>
                                <td className={`pr-3 text-right ${(c.vol_ratio ?? 0) > 1.5 ? 'text-amber-300' : (c.vol_ratio ?? 1) < 0.6 ? 'text-cyan-300' : 'text-gray-400'}`}
                                  title={`Vol ${fmtVol(c.vol_prev)} vs promedio 20d ${fmtVol(c.vol_avg20)}`}>
                                  {fmt(c.vol_ratio, '×')}
                                </td>
                                <td className="pr-3 text-right text-gray-300">{fmt(c.dist_52w_low_pct, '%')}</td>
                                <td className="pr-3 text-right text-violet-300 font-bold">${c.entry}</td>
                                <td className="pr-3 text-right text-rose-300">${c.stop}</td>
                                <td className="pr-3 text-right text-emerald-300">${c.target}</td>
                                <td className={`pr-3 text-right ${(c.rr ?? 0) >= 3 ? 'text-emerald-400' : 'text-gray-400'}`}>{fmt(c.rr, '×')}</td>
                                <td className="pr-3 text-center">
                                  <button onClick={(e) => { e.stopPropagation(); openChart(c); }} title="Ver gráfico con el plan de entrada"
                                    className="text-cyan-400 hover:text-cyan-300 transition" aria-label="Ver gráfico del candidato">
                                    <svg className="w-3.5 h-3.5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M3 3v18h18" />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Warnings */}
                    {result.meta.warnings.length > 0 && (
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300/90">
                        {result.meta.warnings.map((w, i) => <p key={i}>• {w}</p>)}
                      </div>
                    )}

                    {/* Limitaciones */}
                    <div className="rounded-xl border border-gray-700/40 bg-gray-900/30 p-4 text-[11px] text-gray-500 leading-relaxed">
                      <p className="font-semibold text-gray-400 mb-1">Cómo leer esta predicción</p>
                      <p>• El score (0–100) mide cuánto se parece el setup ACTUAL de cada ticker al patrón previo de los surges históricos: proximidad al disparo (25), patrón de los últimos 10 días (20), volumen del último día (15), distancia al mínimo de 52 semanas (10), sector HOT (10) y racha roja (10).</p>
                      <p>• Plan de trade sugerido: entrada buy-stop sobre el high de 10 días (el nivel violeta), stop bajo el mínimo de los últimos 5 días, target = entrada × (1 + surge mediano histórico). Son niveles estadísticos, no una recomendación de inversión.</p>
                      <p>• Un score alto NO garantiza el breakout: indica confluencia con las condiciones que históricamente precedieron a los surges de este universo.</p>
                      <p>• Mismo sesgo de supervivencia del Edge Finder (screener point-in-time) y cobertura sujeta a rate limits de FMP.</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: gráfico del candidato + plan de trade + desglose del score */}
      {chartCand && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6"
          onClick={() => setChartCand(null)}>
          <div className="w-full max-w-6xl max-h-[94vh] overflow-y-auto rounded-2xl border border-violet-500/25 bg-gray-950 p-4 sm:p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
              <div>
                <h3 className="text-xl font-black text-violet-300">
                  {chartCand.symbol}{' '}
                  <span className="text-gray-500 text-sm font-normal">
                    · {chartCand.sector}{chartCand.market_cap ? ` · ${fmtCap(chartCand.market_cap)}` : ''} · cierre ${chartCand.price} ({chartCand.as_of})
                  </span>
                </h3>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border mr-2 ${STATUS_META[chartCand.status].cls}`}>{STATUS_META[chartCand.status].label}</span>
                  score <span className={`font-bold ${scoreColor(chartCand.score)}`}>{chartCand.score}</span> ·
                  patrón: <span className="text-gray-200">{chartCand.pattern}</span> ·
                  Δ disparo {chartCand.proximity_pct}% · vol {fmt(chartCand.vol_ratio, '×')} · Δ52w low {fmt(chartCand.dist_52w_low_pct, '%')}
                  {chartCand.sector_hot_now != null && (
                    <span className={chartCand.sector_hot_now ? ' text-amber-300' : ' text-cyan-300'}>
                      {' '}· sector {chartCand.sector_hot_now ? 'HOT 🔥' : 'COLD'} ({chartCand.sector_etf} {fmt(chartCand.sector_ret20_pct, '%')} vs SPY {fmt(chartCand.spy_ret20_pct, '%')})
                    </span>
                  )}
                </p>
              </div>
              <button onClick={() => setChartCand(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            {chartLoading && <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height: '50vh' }}>Cargando gráfico…</div>}
            {chartError && <div className="flex items-center justify-center text-rose-400 text-sm" style={{ height: '50vh' }}>⚠ {chartError}</div>}
            {chartBars && chartBars.length > 0 && (
              <>
                {/* Panel de precio (velas, últimos ~60 días) */}
                <ResponsiveContainer width="100%" height={Math.round(typeof window !== 'undefined' ? window.innerHeight * 0.40 : 360)}>
                  <ComposedChart data={chartBars} margin={{ top: 14, right: 70, bottom: 0, left: 8 }} syncId="edge-cand">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.25} />
                    <XAxis dataKey="t" stroke="#6b7280" fontSize={10} minTickGap={18} />
                    <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} width={62} orientation="right" />
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(_v: any, _n: any, p: any) => {
                        const b = p?.payload as CandleBar;
                        return [`O ${b.open} H ${b.high} L ${b.low} C ${b.close}`, b.day];
                      }} />
                    <ReferenceLine y={chartCand.entry} stroke="#a78bfa" strokeDasharray="4 3" strokeWidth={1.5}
                      label={{ value: `ENTRADA ${chartCand.entry} · posible breakout`, fill: '#a78bfa', fontSize: 10, position: 'insideTopRight' }} />
                    <ReferenceLine y={chartCand.stop} stroke="#f43f5e" strokeDasharray="4 3"
                      label={{ value: `stop ${chartCand.stop}`, fill: '#f43f5e', fontSize: 9, position: 'insideBottomRight' }} />
                    <ReferenceLine y={chartCand.target} stroke="#10b981" strokeDasharray="4 3"
                      label={{ value: `target ${chartCand.target}`, fill: '#10b981', fontSize: 9, position: 'insideTopRight' }} />
                    <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                {/* Panel de volumen */}
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={chartBars} margin={{ top: 4, right: 70, bottom: 0, left: 8 }} syncId="edge-cand">
                    <XAxis dataKey="t" stroke="#6b7280" fontSize={10} minTickGap={18} hide />
                    <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => fmtVol(Number(v))} width={62} orientation="right" />
                    <Tooltip contentStyle={tooltipStyle}
                      formatter={(v: any, _n: any, p: any) => [fmtVol(Number(v)), `Volumen ${p?.payload?.day}`]} />
                    <Bar dataKey="volume" isAnimationActive={false} maxBarSize={14} radius={[2, 2, 0, 0]}
                      fill="#8b5cf6" opacity={0.7} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[10px] text-gray-600 mt-2">
                  Últimos {chartBars.length} días de rueda. Violeta = entrada buy-stop (high de 10 días — el punto del posible breakout) ·
                  rosa = stop (mínimo 5d) · verde = target (+{fmt(chartCand.exp_move_pct, '%')} — si queda fuera del rango del gráfico no se dibuja).
                </p>

                {/* Plan de trade + desglose del score */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
                    <h4 className="text-sm font-bold text-violet-300 mb-2">Plan de trade · Posible Breakout</h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-mono">
                      <span className="text-gray-400 font-sans">Entrada (buy stop)</span>
                      <span className="text-violet-300 font-bold text-right">${chartCand.entry}</span>
                      <span className="text-gray-400 font-sans">Stop (mín 5 días)</span>
                      <span className="text-rose-300 text-right">${chartCand.stop}{chartCand.risk_pct != null ? ` (−${chartCand.risk_pct}%)` : ''}</span>
                      <span className="text-gray-400 font-sans">Target (surge mediano)</span>
                      <span className="text-emerald-300 text-right">${chartCand.target}{chartCand.exp_move_pct != null ? ` (+${chartCand.exp_move_pct}%)` : ''}</span>
                      <span className="text-gray-400 font-sans">Riesgo : beneficio</span>
                      <span className={`text-right ${(chartCand.rr ?? 0) >= 3 ? 'text-emerald-400' : 'text-gray-300'}`}>{fmt(chartCand.rr, '×')}</span>
                      <span className="text-gray-400 font-sans">Días estimados al pico</span>
                      <span className="text-gray-300 text-right">{fmt(chartCand.exp_days_to_peak)}</span>
                    </div>
                    {chartCand.hist_pattern_count != null && (
                      <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
                        Contexto: {chartCand.hist_pattern_count} surges históricos nacieron del patrón «{chartCand.pattern}»
                        {chartCand.hist_pattern_med_surge != null ? ` con surge mediano +${chartCand.hist_pattern_med_surge}%` : ''}
                        {chartCand.hist_pattern_med_ret10 != null ? ` y retorno mediano a +10d de ${chartCand.hist_pattern_med_ret10}%` : ''}.
                      </p>
                    )}
                    <p className="text-[10px] text-gray-600 mt-2">
                      La entrada se dispara solo si el precio supera el nivel violeta — si no rompe, no hay trade.
                    </p>
                  </div>

                  <div className="rounded-xl border border-gray-700/40 bg-gray-900/40 p-4">
                    <h4 className="text-sm font-bold text-gray-300 mb-2">Por qué está en la lista · score {chartCand.score}/100</h4>
                    <div className="space-y-2">
                      {chartCand.score_breakdown.map((p) => (
                        <div key={p.key}>
                          <div className="flex justify-between text-[11px] mb-0.5">
                            <span className="text-gray-300">{p.label}</span>
                            <span className="font-mono text-gray-400">{p.points}/{p.max}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                            <div className="h-full rounded-full bg-violet-400/80" style={{ width: `${(p.points / p.max) * 100}%` }} />
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5">{p.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
            {chartBars && chartBars.length === 0 && !chartLoading && (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: '50vh' }}>Sin datos diarios para este candidato.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
