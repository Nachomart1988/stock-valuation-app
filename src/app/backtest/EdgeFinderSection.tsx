'use client';

/**
 * Edge Finder (Surge Scanner) — sección de /backtest (GOD MODE).
 *
 * No es un backtest de entradas/salidas: escanea surges históricos (p.ej. +50% en
 * 3 días) y caracteriza el patrón PREVIO al surge (10 días antes / 10 después,
 * volumen del día previo, sector hot/cold, distancia al mínimo de 52 semanas...)
 * para encontrar un edge repetible.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ComposedChart, Legend,
} from 'recharts';
import { postBackend, getBackend } from '@/lib/backendClient';

// ── Types (espejo del backend edge_finder_engine.py) ─────────────────────
type CapBucket = 'nano' | 'micro' | 'small' | 'mid' | 'large' | 'mega';

interface EdgeFinderConfig {
  price_min: number;
  price_max: number;
  market_cap_min: CapBucket;
  market_cap_max: CapBucket;
  surge_pct_min: number;
  surge_days: number;
  use_earnings: boolean;   // reservado — el backend lo ignora por ahora
  date_from: string;
  date_to: string;
  max_universe: number;
  max_events: number;
  max_table_events: number;
}

interface EdgeEvent {
  symbol: string; sector: string; industry: string | null; exchange: string | null;
  market_cap: number | null;
  date: string; weekday: string | null; weekday_idx: number | null;
  base_price: number; peak_price: number; surge_pct: number; days_to_peak: number;
  gap_pct: number;
  vol_prev: number; vol_avg20: number | null; vol_ratio: number | null; vol_d0_ratio: number | null;
  dist_52w_low_pct: number | null; dist_52w_high_pct: number | null;
  pattern: string; breakout: string; breakout_day: number | null; pre_high_10d: number;
  consec_red: number; consec_green: number;
  pre_ret10_pct: number; compression: number; pre_tr_pct: number;
  ret_3d: number | null; ret_5d: number | null; ret_10d: number | null;
  sector_etf: string | null; sector_ret20_pct: number | null; spy_ret20_pct: number | null;
  sector_hot: boolean | null; spy_up_d0: boolean | null;
}

interface BucketRow { bucket: string; count: number; pct: number; avg_surge: number | null; med_ret_10d: number | null }

interface EdgeFinderResult {
  kpis: {
    events: number; symbols: number;
    median_surge_pct: number | null; avg_surge_pct: number;
    median_days_to_peak: number | null;
    pct_gap_start: number | null; pct_vol_elevated: number | null; pct_vol_dryup: number | null;
    pct_hot_sector: number | null; median_dist_52w_low: number | null;
    pct_after_red_streak: number | null;
    median_ret_3d: number | null; median_ret_5d: number | null; median_ret_10d: number | null;
    pct_positive_10d: number | null;
  } | null;
  composite: Array<{ off: number; avg: number; median: number; n: number }>;
  by_pattern: Array<{
    pattern: string; count: number; pct: number; avg_surge: number; med_surge: number | null;
    avg_days_to_peak: number; med_vol_ratio: number | null; med_dist_52w: number | null;
    med_ret_10d: number | null;
  }>;
  by_breakout: Array<{
    breakout: string; count: number; pct: number; avg_surge: number; med_surge: number | null;
    avg_days_to_peak: number; med_breakout_day: number | null; med_vol_ratio: number | null;
    med_ret_10d: number | null;
  }>;
  by_sector: Array<{ sector: string; count: number; pct: number; hot_pct: number | null; avg_surge: number; med_ret_10d: number | null }>;
  dist_52w_buckets: BucketRow[];
  vol_ratio_buckets: BucketRow[];
  gap_buckets: BucketRow[];
  weekday: Array<{ weekday: string; count: number; pct: number }>;
  events: EdgeEvent[];
  meta: {
    universe_size: number; universe_full: number; events_found: number;
    date_from: string; date_to: string; warnings: string[];
  };
}

interface JobStatus {
  job_id: string; status: 'queued' | 'running' | 'done' | 'error';
  progress: number; stage: string; error?: string | null; result?: EdgeFinderResult;
}

interface EventBar {
  t: string; day: string; off: number;
  open: number; high: number; low: number; close: number; volume: number;
  surge_start: boolean; range: [number, number];
}

const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

const DEFAULT_CONFIG: EdgeFinderConfig = {
  price_min: 1, price_max: 100,
  market_cap_min: 'small', market_cap_max: 'large',
  surge_pct_min: 50, surge_days: 3,
  use_earnings: false,
  date_from: yearAgo(), date_to: today(),
  max_universe: 5000, max_events: 3000, max_table_events: 600,
};

const CAP_OPTIONS: { value: CapBucket; label: string }[] = [
  { value: 'nano', label: 'Nano (< $50M)' },
  { value: 'micro', label: 'Micro ($50M–$300M)' },
  { value: 'small', label: 'Small ($300M–$2B)' },
  { value: 'mid', label: 'Mid ($2B–$10B)' },
  { value: 'large', label: 'Large ($10B–$200B)' },
  { value: 'mega', label: 'Mega (> $200B)' },
];

// ── Primitivas locales (mismo idioma visual que la página) ────────────────
const inputCls =
  'bg-gray-950 border border-rose-500/20 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-rose-400/60';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300/80">{label}</span>
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
    <div className="bg-gray-950/70 border border-rose-500/15 rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-black mt-1 font-mono ${toneCls}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-500 mt-0.5">{hint}</p>}
    </div>
  );
}

// Vela custom (idéntica en espíritu a la del resto de la página)
function Candle(props: any) {
  const { x, y, width, height, payload } = props;
  const { open, high, low, close } = payload as EventBar;
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

const tooltipStyle = { background: '#0f172a', border: '1px solid #f43f5e33', borderRadius: 8, fontSize: 11 };

// Barra de distribución compacta (un solo tono — cian, como los accents de chart)
function DistributionCard({ title, data, hint }: { title: string; data: BucketRow[]; hint?: string }) {
  return (
    <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
      <h3 className="text-sm font-bold text-rose-300 mb-1">{title}</h3>
      {hint && <p className="text-[10px] text-gray-500 mb-2">{hint}</p>}
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
          <XAxis dataKey="bucket" stroke="#6b7280" fontSize={10} interval={0} tickFormatter={(s) => String(s).replace(/ \(.*\)/, '')} />
          <YAxis stroke="#6b7280" fontSize={10} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: any, _n: any, p: any) => {
              const r = p?.payload as BucketRow;
              return [`${v} eventos (${r.pct}%)${r.avg_surge != null ? ` · surge medio +${r.avg_surge}%` : ''}${r.med_ret_10d != null ? ` · ret +10d med ${r.med_ret_10d}%` : ''}`, r.bucket];
            }} />
          <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={48}
            label={{ position: 'top', fill: '#67e8f9', fontSize: 10, formatter: (v: any) => v }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sección ───────────────────────────────────────────────────────────────
export default function EdgeFinderSection() {
  const [cfg, setCfg] = useState<EdgeFinderConfig>(DEFAULT_CONFIG);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<EdgeFinderResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // modal de gráfico por evento
  const [chartEvent, setChartEvent] = useState<EdgeEvent | null>(null);
  const [chartBars, setChartBars] = useState<EventBar[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');

  const set = <K extends keyof EdgeFinderConfig>(k: K, v: EdgeFinderConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const run = useCallback(async () => {
    setError(''); setResult(null); setJob(null); setRunning(true);
    stopPolling();
    try {
      const { job_id } = await postBackend<{ job_id: string }>('/backtest/edge-finder/start', cfg);
      pollRef.current = setInterval(async () => {
        try {
          const snap = await getBackend<JobStatus>(`/backtest/edge-finder/status/${job_id}`, 20000);
          setJob(snap);
          if (snap.status === 'done') {
            stopPolling(); setRunning(false);
            setResult(snap.result ?? null);
          } else if (snap.status === 'error') {
            stopPolling(); setRunning(false);
            setError(snap.error || 'Error en el escaneo');
          }
        } catch (e: any) {
          stopPolling(); setRunning(false);
          setError(e?.message || 'Error consultando el estado del job');
        }
      }, 1500);
    } catch (e: any) {
      setRunning(false);
      setError(e?.message || 'No se pudo iniciar el escaneo');
    }
  }, [cfg, stopPolling]);

  const openChart = useCallback(async (ev: EdgeEvent) => {
    setChartEvent(ev); setChartBars(null); setChartError(''); setChartLoading(true);
    try {
      const data = await postBackend<{ bars: Omit<EventBar, 'range'>[] }>(
        '/backtest/edge-finder/chart', { symbol: ev.symbol, date: ev.date }, 25000,
      );
      setChartBars((data.bars || []).map((b) => ({ ...b, range: [b.low, b.high] as [number, number] })));
    } catch (e: any) {
      setChartError(e?.message || 'No se pudo cargar el gráfico');
    } finally {
      setChartLoading(false);
    }
  }, []);

  const compositeData = useMemo(() => result?.composite ?? [], [result]);

  // ── Descargas ────────────────────────────────────────────────────────────
  const downloadBlob = useCallback((content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadJSON = useCallback(() => {
    if (!result) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(JSON.stringify({ config: cfg, exported_at: new Date().toISOString(), result }, null, 2),
      `edge-finder-${stamp}.json`, 'application/json');
  }, [result, cfg, downloadBlob]);

  const downloadCSV = useCallback(() => {
    if (!result?.events?.length) return;
    const cols: (keyof EdgeEvent)[] = [
      'symbol', 'date', 'weekday', 'sector', 'industry', 'market_cap', 'base_price', 'peak_price',
      'surge_pct', 'days_to_peak', 'gap_pct', 'vol_prev', 'vol_avg20', 'vol_ratio', 'vol_d0_ratio',
      'dist_52w_low_pct', 'dist_52w_high_pct', 'pattern', 'breakout', 'breakout_day',
      'pre_high_10d', 'consec_red', 'consec_green',
      'pre_ret10_pct', 'compression', 'sector_etf', 'sector_ret20_pct', 'spy_ret20_pct',
      'sector_hot', 'spy_up_d0', 'ret_3d', 'ret_5d', 'ret_10d',
    ];
    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(','), ...result.events.map((e) => cols.map((c) => esc((e as any)[c])).join(','))];
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(lines.join('\n'), `edge-finder-eventos-${stamp}.csv`, 'text/csv;charset=utf-8');
  }, [result, downloadBlob]);

  const k = result?.kpis;

  return (
    <>
      {/* Filtros */}
      <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5 sm:p-6 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Field label="Precio mín ($)" hint="al inicio del surge (cierre del día previo)">
            <NumberInput value={cfg.price_min} min={0} step={0.5} onChange={(v) => set('price_min', v)} />
          </Field>
          <Field label="Precio máx ($)">
            <NumberInput value={cfg.price_max} min={0.01} step={0.5} onChange={(v) => set('price_max', v)} />
          </Field>
          <Field label="Market cap desde">
            <Select value={cfg.market_cap_min} onChange={(v) => set('market_cap_min', v)} options={CAP_OPTIONS} />
          </Field>
          <Field label="Market cap hasta" hint="rango inclusive (between)">
            <Select value={cfg.market_cap_max} onChange={(v) => set('market_cap_max', v)} options={CAP_OPTIONS} />
          </Field>

          <Field label="Surge mínimo (%)" hint="suba desde el cierre base al máximo de la ventana">
            <NumberInput value={cfg.surge_pct_min} min={1} step={5} onChange={(v) => set('surge_pct_min', v)} />
          </Field>
          <Field label="Días (ventana)" hint="1–100 días de rueda para completar el surge">
            <NumberInput value={cfg.surge_days} min={1} max={100} step={1} onChange={(v) => set('surge_days', v)} />
          </Field>
          <Field label="Desde">
            <input type="date" className={inputCls} value={cfg.date_from} onChange={(e) => set('date_from', e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" className={inputCls} value={cfg.date_to} onChange={(e) => set('date_to', e.target.value)} />
          </Field>

          {/* Earnings — placeholder para el futuro */}
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={cfg.use_earnings} onChange={(e) => set('use_earnings', e.target.checked)}
                className="accent-rose-500 w-3.5 h-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-300/80">Earnings</span>
            </label>
            <input type="text" className={`${inputCls} opacity-50`} disabled placeholder="Próximamente" />
            <span className="text-[10px] text-gray-500">{cfg.use_earnings ? 'aún sin implementar — se ignora en esta versión' : 'desactivado'}</span>
          </div>
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
            {running ? 'Escaneando…' : 'Buscar Edge'}
          </button>
          <span className="text-[11px] text-gray-500">
            Escanea el historial diario de todo el universo — puede tardar varios minutos.
          </span>
        </div>

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

      {/* Resultados */}
      {result && (
        <div className="space-y-6">
          {!k || k.events === 0 ? (
            <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-8 text-center text-gray-400">
              No se encontraron surges con estos filtros.{' '}
              <span className="text-gray-500">({result.meta.universe_size} tickers escaneados)</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-black text-rose-200">
                  Resultados <span className="text-gray-500 font-normal text-sm">· {k.events} surges en {k.symbols} tickers</span>
                </h2>
                <div className="flex gap-2">
                  <button onClick={downloadCSV}
                    title="Descargar la lista de eventos en CSV (Excel / Sheets)"
                    className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs font-semibold hover:bg-rose-500/20 transition">
                    ⬇ Eventos CSV
                  </button>
                  <button onClick={downloadJSON}
                    title="Descargar el análisis completo (config + agregados + eventos) en JSON"
                    className="px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs font-semibold hover:bg-rose-500/20 transition">
                    ⬇ Análisis JSON
                  </button>
                </div>
              </div>

              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <StatCard label="Surge mediano" value={fmt(k.median_surge_pct, '%', '–')} tone="pos" hint={`promedio +${k.avg_surge_pct}%`} />
                <StatCard label="Días al pico" value={fmt(k.median_days_to_peak)} hint="mediana dentro de la ventana" />
                <StatCard label="Sector HOT" value={fmt(k.pct_hot_sector, '%')} hint="ETF sectorial > SPY (20d previos)" tone={k.pct_hot_sector != null && k.pct_hot_sector >= 50 ? 'pos' : 'neutral'} />
                <StatCard label="Δ mín 52 sem" value={fmt(k.median_dist_52w_low, '%')} hint="mediana sobre el mínimo de 52 sem" />
                <StatCard label="Empiezan con gap" value={fmt(k.pct_gap_start, '%')} hint="gap ≥ 2% el día del inicio" />
                <StatCard label="Vol D-1 elevado" value={fmt(k.pct_vol_elevated, '%')} hint=">1.5× el promedio 20d (pre-carga)" />
                <StatCard label="Vol D-1 seco" value={fmt(k.pct_vol_dryup, '%')} hint="<0.6× el promedio (dry-up)" />
                <StatCard label="Tras 3+ días rojos" value={fmt(k.pct_after_red_streak, '%')} hint="surge nace de una racha roja" />
                <StatCard label="Ret +10d (desde base)" value={fmt(k.median_ret_10d, '%')} tone={(k.median_ret_10d ?? 0) >= 0 ? 'pos' : 'neg'} hint={`+3d ${fmt(k.median_ret_3d, '%')} · +5d ${fmt(k.median_ret_5d, '%')}`} />
                <StatCard label="Positivos a +10d" value={fmt(k.pct_positive_10d, '%')} hint="siguen sobre el precio base" />
              </div>

              {/* Patrón compuesto (precio normalizado) */}
              <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                <h3 className="text-sm font-bold text-rose-300 mb-1">Patrón compuesto (todos los surges)</h3>
                <p className="text-[11px] text-gray-500 mb-3">
                  Cierre normalizado (base 100 = día previo al surge) · 10 días antes → 10 días después del inicio.
                </p>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={compositeData} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis dataKey="off" stroke="#6b7280" fontSize={11}
                      tickFormatter={(v) => (v === 0 ? 'Inicio' : `${v > 0 ? '+' : ''}${v}`)} />
                    <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `${v}`} />
                    <Tooltip contentStyle={tooltipStyle}
                      labelFormatter={(l) => (Number(l) === 0 ? 'Día de inicio del surge' : `Día ${Number(l) > 0 ? '+' : ''}${l}`)}
                      formatter={(v: any, name: any, p: any) => [`${v} (n=${p?.payload?.n})`, name]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine x={0} stroke="#06b6d4" strokeDasharray="4 4"
                      label={{ value: 'inicio surge', fill: '#67e8f9', fontSize: 9, position: 'top' }} />
                    <ReferenceLine y={100} stroke="#6b7280" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="avg" name="Promedio" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="median" name="Mediana" stroke="#9ca3af" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Tabla de patrones previos — el corazón del edge */}
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.04] p-5">
                <h3 className="text-sm font-bold text-violet-300 mb-1">Patrón previo al surge</h3>
                <p className="text-[11px] text-gray-500 mb-3">
                  Clasificación heurística de los 10 días anteriores al inicio — dónde se concentra el edge.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-left border-b border-gray-800">
                        <th className="py-1.5 pr-2">Patrón</th>
                        <th className="pr-2 text-right">Eventos</th>
                        <th className="pr-2 text-right">% del total</th>
                        <th className="pr-2 text-right">Surge medio</th>
                        <th className="pr-2 text-right">Días al pico</th>
                        <th className="pr-2 text-right">Vol D-1 (med)</th>
                        <th className="pr-2 text-right">Δ52w low (med)</th>
                        <th className="pr-2 text-right">Ret +10d (med)</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {result.by_pattern.map((p) => (
                        <tr key={p.pattern} className="border-b border-gray-800/50">
                          <td className="py-1.5 pr-2 font-sans text-gray-200">{p.pattern}</td>
                          <td className="pr-2 text-right text-gray-300">{p.count}</td>
                          <td className="pr-2 text-right text-violet-300 font-bold">{p.pct}%</td>
                          <td className="pr-2 text-right text-emerald-400">+{p.avg_surge}%</td>
                          <td className="pr-2 text-right text-gray-400">{p.avg_days_to_peak}</td>
                          <td className="pr-2 text-right text-gray-400">{fmt(p.med_vol_ratio, '×')}</td>
                          <td className="pr-2 text-right text-gray-400">{fmt(p.med_dist_52w, '%')}</td>
                          <td className={`pr-2 text-right ${(p.med_ret_10d ?? 0) >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{fmt(p.med_ret_10d, '%')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Patrón previo 2 — tipo de breakout */}
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/[0.04] p-5">
                <h3 className="text-sm font-bold text-violet-300 mb-1">Tipo de breakout <span className="text-[10px] font-normal text-violet-400/70 uppercase tracking-wider">· patrón previo 2</span></h3>
                <p className="text-[11px] text-gray-500 mb-3">
                  Qué clase de breakout lanzó el surge — flag, base, 52 semanas, gap, continuación o reversión (vs el high de los 10 días previos).
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-left border-b border-gray-800">
                        <th className="py-1.5 pr-2">Breakout</th>
                        <th className="pr-2 text-right">Eventos</th>
                        <th className="pr-2 text-right">% del total</th>
                        <th className="pr-2 text-right">Surge medio</th>
                        <th className="pr-2 text-right">Días al pico</th>
                        <th className="pr-2 text-right">Día del break</th>
                        <th className="pr-2 text-right">Vol D-1 (med)</th>
                        <th className="pr-2 text-right">Ret +10d (med)</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {result.by_breakout.map((b) => (
                        <tr key={b.breakout} className="border-b border-gray-800/50">
                          <td className="py-1.5 pr-2 font-sans text-gray-200">{b.breakout}</td>
                          <td className="pr-2 text-right text-gray-300">{b.count}</td>
                          <td className="pr-2 text-right text-violet-300 font-bold">{b.pct}%</td>
                          <td className="pr-2 text-right text-emerald-400">+{b.avg_surge}%</td>
                          <td className="pr-2 text-right text-gray-400">{b.avg_days_to_peak}</td>
                          <td className="pr-2 text-right text-gray-400">{fmt(b.med_breakout_day)}</td>
                          <td className="pr-2 text-right text-gray-400">{fmt(b.med_vol_ratio, '×')}</td>
                          <td className={`pr-2 text-right ${(b.med_ret_10d ?? 0) >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{fmt(b.med_ret_10d, '%')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-600 mt-2">Día del break = primer día del surge que cierra sobre el high de los 10 días previos (mediana).</p>
              </div>

              {/* Distribuciones */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <DistributionCard title="Distancia al mínimo 52 sem" data={result.dist_52w_buckets}
                  hint="al inicio del surge — ¿nacen del piso o ya extendidas?" />
                <DistributionCard title="Volumen del día previo" data={result.vol_ratio_buckets}
                  hint="vs promedio 20 días — ¿dry-up o pre-carga?" />
                <DistributionCard title="Gap del día de inicio" data={result.gap_buckets}
                  hint="apertura del día 0 vs cierre base" />
              </div>

              {/* Sectores + weekday */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                  <h3 className="text-sm font-bold text-rose-300 mb-3">Por sector</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 text-left border-b border-gray-800">
                          <th className="py-1.5 pr-2">Sector</th>
                          <th className="pr-2 text-right">Eventos</th>
                          <th className="pr-2 text-right">%</th>
                          <th className="pr-2 text-right">% en HOT</th>
                          <th className="pr-2 text-right">Surge medio</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {result.by_sector.map((s) => (
                          <tr key={s.sector} className="border-b border-gray-800/50">
                            <td className="py-1.5 pr-2 font-sans text-gray-200">{s.sector}</td>
                            <td className="pr-2 text-right text-gray-300">{s.count}</td>
                            <td className="pr-2 text-right text-gray-400">{s.pct}%</td>
                            <td className={`pr-2 text-right ${(s.hot_pct ?? 0) >= 50 ? 'text-amber-300' : 'text-gray-400'}`}>{fmt(s.hot_pct, '%')}</td>
                            <td className="pr-2 text-right text-emerald-400">+{s.avg_surge}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-gray-600 mt-2">HOT = ETF del sector superó al SPY en los 20 días previos al surge.</p>
                </div>

                <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                  <h3 className="text-sm font-bold text-rose-300 mb-3">Día de inicio del surge</h3>
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart data={result.weekday} margin={{ top: 16, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} vertical={false} />
                      <XAxis dataKey="weekday" stroke="#6b7280" fontSize={11} />
                      <YAxis stroke="#6b7280" fontSize={10} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle}
                        formatter={(v: any, _n: any, p: any) => [`${v} eventos (${p?.payload?.pct}%)`, p?.payload?.weekday]} />
                      <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={56}
                        label={{ position: 'top', fill: '#67e8f9', fontSize: 10 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Warnings */}
              {result.meta.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300/90">
                  {result.meta.warnings.map((w, i) => <p key={i}>• {w}</p>)}
                </div>
              )}

              {/* Tabla de eventos */}
              <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5">
                <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                  <h3 className="text-sm font-bold text-rose-300">
                    Eventos ({result.events.length}{k.events > result.events.length ? ` de ${k.events}` : ''})
                  </h3>
                  <span className="text-[10px] text-gray-500">🔥 = sector HOT (vs SPY, 20d previos) · vol = día previo al surge</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-left border-b border-gray-800">
                        <th className="py-2 pr-3">Fecha</th><th className="pr-3">Día</th><th className="pr-3">Símbolo</th>
                        <th className="pr-3">Sector</th>
                        <th className="pr-3 text-right">Base</th>
                        <th className="pr-3 text-right">Surge</th>
                        <th className="pr-3 text-right">D→pico</th>
                        <th className="pr-3 text-right">Gap%</th>
                        <th className="pr-3 text-right">Vol D-1</th>
                        <th className="pr-3 text-right">Ratio</th>
                        <th className="pr-3 text-right">Δ52w low</th>
                        <th className="pr-3">Patrón previo</th>
                        <th className="pr-3">Breakout</th>
                        <th className="pr-3 text-right">Ret +10d</th>
                        <th className="pr-3 text-center">📈</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {result.events.map((e, i) => (
                        <tr key={`${e.symbol}-${e.date}-${i}`} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="py-1.5 pr-3 text-gray-400">{e.date}</td>
                          <td className="pr-3 font-sans text-gray-400">{e.weekday ?? '–'}</td>
                          <td className="pr-3 text-gray-100 font-sans font-semibold whitespace-nowrap">
                            {e.symbol}
                            {e.sector_hot && <span className="ml-1" title={`Sector HOT: ${e.sector_etf} ${e.sector_ret20_pct}% vs SPY ${e.spy_ret20_pct}% (20d)`}>🔥</span>}
                          </td>
                          <td className="pr-3 font-sans text-gray-400 whitespace-nowrap" title={e.industry ?? undefined}>
                            {e.sector}{e.market_cap ? <span className="text-gray-600"> · {fmtCap(e.market_cap)}</span> : null}
                          </td>
                          <td className="pr-3 text-right text-gray-300">${e.base_price}</td>
                          <td className="pr-3 text-right text-emerald-400 font-bold">+{e.surge_pct}%</td>
                          <td className="pr-3 text-right text-gray-400">{e.days_to_peak}</td>
                          <td className={`pr-3 text-right ${e.gap_pct >= 2 ? 'text-amber-300' : 'text-gray-400'}`}>{e.gap_pct >= 0 ? '+' : ''}{e.gap_pct}%</td>
                          <td className="pr-3 text-right text-gray-300">{fmtVol(e.vol_prev)}</td>
                          <td className={`pr-3 text-right ${(e.vol_ratio ?? 0) > 1.5 ? 'text-amber-300' : (e.vol_ratio ?? 1) < 0.6 ? 'text-cyan-300' : 'text-gray-400'}`}>{fmt(e.vol_ratio, '×')}</td>
                          <td className="pr-3 text-right text-gray-300">{fmt(e.dist_52w_low_pct, '%')}</td>
                          <td className="pr-3 font-sans text-gray-300 whitespace-nowrap">{e.pattern}</td>
                          <td className="pr-3 font-sans text-violet-300 whitespace-nowrap"
                            title={e.breakout_day != null ? `Cerró sobre el high 10d previo (${e.pre_high_10d}) el día ${e.breakout_day} del surge` : `No cerró sobre el high 10d previo (${e.pre_high_10d}) dentro de la ventana`}>
                            {e.breakout}{e.breakout_day != null ? <span className="text-gray-500"> d{e.breakout_day}</span> : null}
                          </td>
                          <td className={`pr-3 text-right ${(e.ret_10d ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmt(e.ret_10d, '%')}</td>
                          <td className="pr-3 text-center">
                            <button onClick={() => openChart(e)} title="Ver gráfico diario (−10 / +10)"
                              className="text-cyan-400 hover:text-cyan-300 transition" aria-label="Ver gráfico del evento">
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

              {/* Limitaciones */}
              <div className="rounded-xl border border-gray-700/40 bg-gray-900/30 p-4 text-[11px] text-gray-500 leading-relaxed">
                <p className="font-semibold text-gray-400 mb-1">Limitaciones del modelo</p>
                <p>• Market cap y sector son actuales (point-in-time del screener) → sesgo de supervivencia/look-ahead; tickers deslistados no aparecen.</p>
                <p>• El surge se mide del cierre base (día previo) al máximo (high) dentro de la ventana; el inicio se ancla al primer día verde que cumple el umbral.</p>
                <p>• Sector HOT/COLD usa ETFs SPDR como proxy del sector (retorno 20 días vs SPY).</p>
                <p>• El filtro de earnings está reservado para una versión futura (hoy se ignora).</p>
                <p>• Cobertura sujeta a rate limits de FMP y al cap de seguridad del universo.</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal de gráfico por evento: velas + panel de volumen (misma escala X) */}
      {chartEvent && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6"
          onClick={() => setChartEvent(null)}>
          <div className="w-full max-w-6xl rounded-2xl border border-cyan-500/25 bg-gray-950 p-4 sm:p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
              <div>
                <h3 className="text-xl font-black text-cyan-300">
                  {chartEvent.symbol}{' '}
                  <span className="text-gray-500 text-sm font-normal">
                    · surge +{chartEvent.surge_pct}% en {chartEvent.days_to_peak}d · inicio {chartEvent.date} ({chartEvent.weekday}) · {chartEvent.sector}
                  </span>
                </h3>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  Base ${chartEvent.base_price} → pico ${chartEvent.peak_price} · gap {chartEvent.gap_pct}% · vol D-1 {fmtVol(chartEvent.vol_prev)} ({fmt(chartEvent.vol_ratio, '×')}) ·
                  Δ52w low {fmt(chartEvent.dist_52w_low_pct, '%')} · patrón: <span className="text-gray-200">{chartEvent.pattern}</span> · breakout: <span className="text-violet-300">{chartEvent.breakout}{chartEvent.breakout_day != null ? ` (día ${chartEvent.breakout_day})` : ''}</span>
                  {chartEvent.sector_hot != null && (
                    <span className={chartEvent.sector_hot ? ' text-amber-300' : ' text-cyan-300'}>
                      {' '}· sector {chartEvent.sector_hot ? 'HOT 🔥' : 'COLD'} ({chartEvent.sector_etf} {fmt(chartEvent.sector_ret20_pct, '%')} vs SPY {fmt(chartEvent.spy_ret20_pct, '%')})
                    </span>
                  )}
                </p>
              </div>
              <button onClick={() => setChartEvent(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            {chartLoading && <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height: '60vh' }}>Cargando gráfico…</div>}
            {chartError && <div className="flex items-center justify-center text-rose-400 text-sm" style={{ height: '60vh' }}>⚠ {chartError}</div>}
            {chartBars && chartBars.length > 0 && (() => {
              const startBar = chartBars.find((b) => b.surge_start);
              return (
                <>
                  {/* Panel de precio (velas) */}
                  <ResponsiveContainer width="100%" height={Math.round(typeof window !== 'undefined' ? window.innerHeight * 0.46 : 400)}>
                    <ComposedChart data={chartBars} margin={{ top: 14, right: 64, bottom: 0, left: 8 }} syncId="edge-event">
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.25} />
                      <XAxis dataKey="t" stroke="#6b7280" fontSize={11} interval={0} minTickGap={12} />
                      <YAxis stroke="#6b7280" fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} width={58} orientation="right" />
                      <Tooltip contentStyle={{ ...tooltipStyle, border: '1px solid #06b6d433' }}
                        formatter={(_v: any, _n: any, p: any) => {
                          const b = p?.payload as EventBar;
                          return [`O ${b.open} H ${b.high} L ${b.low} C ${b.close}`, `${b.day} (día ${b.off > 0 ? '+' : ''}${b.off})`];
                        }} />
                      {startBar && <ReferenceLine x={startBar.t} stroke="#06b6d4" strokeDasharray="4 4" label={{ value: 'inicio surge', fill: '#67e8f9', fontSize: 9, position: 'top' }} />}
                      <ReferenceLine y={chartEvent.base_price} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: `base ${chartEvent.base_price}`, fill: '#9ca3af', fontSize: 9, position: 'right' }} />
                      <ReferenceLine y={chartEvent.peak_price} stroke="#10b981" strokeDasharray="4 4" label={{ value: `pico ${chartEvent.peak_price}`, fill: '#10b981', fontSize: 9, position: 'right' }} />
                      {chartEvent.pre_high_10d != null && <ReferenceLine y={chartEvent.pre_high_10d} stroke="#a78bfa" strokeDasharray="2 3" label={{ value: `high 10d ${chartEvent.pre_high_10d}`, fill: '#a78bfa', fontSize: 9, position: 'right' }} />}
                      <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  {/* Panel de volumen (eje propio, misma X) */}
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={chartBars} margin={{ top: 4, right: 64, bottom: 0, left: 8 }} syncId="edge-event">
                      <XAxis dataKey="t" stroke="#6b7280" fontSize={10} interval={0} minTickGap={12} hide />
                      <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => fmtVol(Number(v))} width={58} orientation="right" />
                      <Tooltip contentStyle={{ ...tooltipStyle, border: '1px solid #06b6d433' }}
                        formatter={(v: any, _n: any, p: any) => [fmtVol(Number(v)), `Volumen ${p?.payload?.day}`]} />
                      <Bar dataKey="volume" isAnimationActive={false} maxBarSize={26} radius={[2, 2, 0, 0]}
                        fill="#06b6d4" opacity={0.7} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-gray-600 mt-2">
                    Velas diarias: 10 días antes → 10 después del inicio del surge. Línea gris = precio base (cierre previo) · verde = pico de la ventana · violeta = high 10d previos (nivel de breakout) · panel inferior = volumen diario.
                  </p>
                </>
              );
            })()}
            {chartBars && chartBars.length === 0 && !chartLoading && (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: '60vh' }}>Sin datos diarios para este evento.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
