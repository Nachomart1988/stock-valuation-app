// src/app/components/tabs/MomentumTab.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

// ── Types ──────────────────────────────────────────────────────────────────────

interface BBData {
  width: number | null;
  compressed: boolean;
  compression_pct: number;
  upper: number;
  lower: number;
  mid: number;
}

interface Metrics {
  current_price: number;
  session_high: number;
  session_low: number;
  session_open: number;
  session_change_pct: number;
  vwap: number;
  vwap_deviation: number;
  roc_1m: number;
  roc_5m: number;
  roc_15m: number;
  roc_1h: number;
  rs: number;
  rs_15m: number;
  vol_surge: number;
  adx: number;
  bb: BBData;
  atr: number;
  proximity_to_high: number;
  bar_count: number;
}

interface MetricsByTF {
  timeframe: string;
  roc: number;
  rs?: number;
  vol_surge?: number;
  adx?: number;
  vwap_dev?: number;
  description: string;
  bars: number;
}

interface Momentum {
  direction: 'alcista' | 'bajista' | 'neutral';
  strength: 'alto' | 'moderado' | 'leve' | 'neutral';
  bull_pts: number;
  bear_pts: number;
  net: number;
  confidence: number;
}

interface Prismo {
  score: number;
  factors: string[];
}

interface Leader {
  score: number;
  r3m: number;
  r6m: number;
  r12m: number;
  b3m: number;
  b6m: number;
  b12m: number;
  ex3m: number;
  ex6m: number;
  ex12m: number;
}

interface Compression {
  detected: boolean;
  score: number;
  big_run_pct: number;
  big_run_confirmed: boolean;
  base_window_days: number;
  range_compression: number;
  range_compressed: boolean;
  vol_dry_up: number;
  vol_contracting: boolean;
  diagonal_ceiling: boolean;
  ceiling_level: number | null;
  slope_pct_per_day: number;
  breakout_proximity: number;
  distance_to_ceiling_pct: number;
}

interface Signal {
  type: string;
  color: string;
  message: string;
  priority: number;
}

interface Fundamental {
  float_shares: number | null;
  mkt_cap: number | null;
  eps_growth: number | null;
  sector: string | null;
  beta: number | null;
}

interface ChartData {
  labels: string[];
  prices: number[];
  vwap: number[];
  volumes: number[];
  momentum: number[];
  session_high: number;
  session_low: number;
  vwap_line: number;
}

interface MomentumResult {
  ticker: string;
  benchmark: string;
  market_status: string;
  data_quality: string;
  timestamp: string;
  elapsed_s: number;
  metrics: Metrics;
  metrics_by_tf: MetricsByTF[];
  momentum: Momentum;
  prismo: Prismo;
  leader: Leader;
  compression: Compression;
  breakout_prob: number;
  signals: Signal[];
  narrative: string;
  confidence: number;
  fundamental: Fundamental;
  chart: ChartData;
  error?: string;
}

interface MomentumTabProps {
  ticker: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 2, suffix = '') {
  if (v == null || !isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}${suffix}`;
}

function fmtPct(v: number | null | undefined, decimals = 2) {
  return fmt(v, decimals, '%');
}

function fmtPrice(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '—';
  return `$${v.toFixed(2)}`;
}

function fmtBig(v: number | null | undefined) {
  if (v == null) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString();
}

function pctColor(v: number | null | undefined) {
  if (v == null) return 'text-gray-400';
  return v >= 0 ? 'text-emerald-400' : 'text-red-400';
}

function signalBgColor(color: string) {
  const map: Record<string, string> = {
    emerald: 'bg-emerald-900/30 border-emerald-500/40 text-emerald-300',
    yellow:  'bg-yellow-900/30 border-yellow-500/40 text-yellow-300',
    red:     'bg-red-900/30 border-red-500/40 text-red-300',
    blue:    'bg-blue-900/30 border-blue-500/40 text-blue-300',
    purple:  'bg-purple-900/30 border-purple-500/40 text-purple-300',
    orange:  'bg-orange-900/30 border-orange-500/40 text-orange-300',
    gray:    'bg-gray-800/50 border-gray-600/40 text-gray-400',
  };
  return map[color] || map.gray;
}

// ── Score gauge (arc SVG) ─────────────────────────────────────────────────────

function ScoreGauge({ score, label, color }: { score: number; label: string; color: string }) {
  const pct = Math.min(Math.max(score, 0), 100);
  const colorMap: Record<string, string> = {
    emerald: '#10b981',
    yellow:  '#f59e0b',
    red:     '#ef4444',
    blue:    '#3b82f6',
    purple:  '#a855f7',
    orange:  '#f97316',
  };
  const fill = colorMap[color] || '#6b7280';
  const startDeg = 210, sweep = 120;
  const arcPct = pct / 100;
  const arcEnd = startDeg + sweep * arcPct;
  const toRad  = (d: number) => (d * Math.PI) / 180;
  const cx = 50, cy = 55, r = 38;
  const sx = cx + r * Math.cos(toRad(startDeg));
  const sy = cy + r * Math.sin(toRad(startDeg));
  const ex = cx + r * Math.cos(toRad(arcEnd));
  const ey = cy + r * Math.sin(toRad(arcEnd));
  const bgEx = cx + r * Math.cos(toRad(startDeg + sweep));
  const bgEy = cy + r * Math.sin(toRad(startDeg + sweep));
  const large = sweep * arcPct > 180 ? 1 : 0;

  return (
    <svg viewBox="0 0 100 80" className="w-full" style={{ maxWidth: 120 }}>
      <path
        d={`M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 1 1 ${bgEx.toFixed(2)},${bgEy.toFixed(2)}`}
        fill="none" stroke="#374151" strokeWidth="7" strokeLinecap="round"
      />
      {pct > 0 && (
        <path
          d={`M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 ${large} 1 ${ex.toFixed(2)},${ey.toFixed(2)}`}
          fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round"
        />
      )}
      <text x="50" y="54" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">
        {pct.toFixed(0)}
      </text>
      <text x="50" y="68" textAnchor="middle" fill="#9ca3af" fontSize="7">
        {label}
      </text>
    </svg>
  );
}

// ── Mini SVG Price+VWAP chart ─────────────────────────────────────────────────

function PriceChart({ chart }: { chart: ChartData }) {
  const W = 600, H = 160;
  const PAD = { l: 50, r: 10, t: 10, b: 30 };
  const prices = chart.prices;
  const vwap   = chart.vwap;
  const labels = chart.labels;
  if (!prices.length) return null;

  const allVals = [...prices, ...vwap].filter(isFinite);
  const minY = Math.min(...allVals) * 0.9995;
  const maxY = Math.max(...allVals) * 1.0005;

  const scaleX = (i: number) => PAD.l + (i / (prices.length - 1)) * (W - PAD.l - PAD.r);
  const scaleY = (v: number) => PAD.t + (1 - (v - minY) / (maxY - minY)) * (H - PAD.t - PAD.b);

  const pricePath = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p).toFixed(1)}`).join(' ');
  const vwapPath  = vwap.map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');
  const fillPath  = prices.map((p, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(p).toFixed(1)}`).join(' ')
    + ` L${scaleX(prices.length - 1).toFixed(1)},${(H - PAD.b).toFixed(1)} L${PAD.l},${(H - PAD.b).toFixed(1)} Z`;

  const tickEvery = Math.max(1, Math.floor(labels.length / 6));
  const ticks = labels.filter((_, i) => i % tickEvery === 0);
  const tickXs = ticks.map((_, i) => scaleX(i * tickEvery));

  const sHighY = scaleY(chart.session_high);
  const sLowY  = scaleY(chart.session_low);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minHeight: 120 }}>
      <defs>
        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <line x1={PAD.l} y1={sHighY} x2={W - PAD.r} y2={sHighY}
            stroke="#22c55e" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.5" />
      <line x1={PAD.l} y1={sLowY}  x2={W - PAD.r} y2={sLowY}
            stroke="#ef4444" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.5" />
      <path d={fillPath} fill="url(#priceGrad)" />
      <path d={vwapPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.8" />
      <path d={pricePath} fill="none" stroke="#10b981" strokeWidth="2" />
      {ticks.map((label, i) => (
        <text key={i} x={tickXs[i]} y={H - PAD.b + 14}
              fill="#6b7280" fontSize="9" textAnchor="middle">{label}</text>
      ))}
      <text x={PAD.l - 4} y={scaleY(maxY) + 4} fill="#6b7280" fontSize="9" textAnchor="end">{maxY.toFixed(2)}</text>
      <text x={PAD.l - 4} y={scaleY(minY) - 2} fill="#6b7280" fontSize="9" textAnchor="end">{minY.toFixed(2)}</text>
      <circle cx={PAD.l + 8} cy={H - PAD.b + 25} r="3" fill="#10b981" />
      <text x={PAD.l + 14} y={H - PAD.b + 28} fill="#10b981" fontSize="9">Price</text>
      <circle cx={PAD.l + 55} cy={H - PAD.b + 25} r="3" fill="#f59e0b" />
      <text x={PAD.l + 61} y={H - PAD.b + 28} fill="#f59e0b" fontSize="9">VWAP</text>
    </svg>
  );
}

// ── Momentum oscillator chart ─────────────────────────────────────────────────

function MomentumChart({ chart }: { chart: ChartData }) {
  const W = 600, H = 100;
  const PAD = { l: 40, r: 10, t: 10, b: 25 };
  const mom = chart.momentum;
  if (!mom.length) return null;

  const maxAbs = Math.max(...mom.map(Math.abs), 0.1);
  const scaleX = (i: number) => PAD.l + (i / (mom.length - 1)) * (W - PAD.l - PAD.r);
  const scaleY = (v: number) => PAD.t + (1 - (v + maxAbs) / (2 * maxAbs)) * (H - PAD.t - PAD.b);
  const zeroY  = scaleY(0);
  const linePath = mom.map((v, i) => `${i === 0 ? 'M' : 'L'}${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ minHeight: 80 }}>
      <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke="#4b5563" strokeWidth="0.8" />
      {mom.map((v, i) => {
        const x  = scaleX(i);
        const y1 = zeroY;
        const y2 = scaleY(v);
        const bh = Math.abs(y2 - y1);
        return (
          <rect key={i} x={x - 1.5} y={Math.min(y1, y2)}
                width={3} height={Math.max(bh, 1)}
                fill={v >= 0 ? '#10b981' : '#ef4444'} opacity="0.7" />
        );
      })}
      <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="1.2" opacity="0.6" />
      <text x={PAD.l - 4} y={PAD.t + 8} fill="#6b7280" fontSize="8" textAnchor="end">+{maxAbs.toFixed(1)}%</text>
      <text x={PAD.l - 4} y={H - PAD.b - 2} fill="#6b7280" fontSize="8" textAnchor="end">-{maxAbs.toFixed(1)}%</text>
      <text x={PAD.l + 4} y={H - PAD.b + 14} fill="#6b7280" fontSize="9">ROC 5-bar rolling</text>
    </svg>
  );
}

// ── Leader score bar chart ────────────────────────────────────────────────────

function LeaderPerformanceBar({ label, stock, benchmark }: {
  label: string; stock: number; benchmark: number;
}) {
  const maxAbs = Math.max(Math.abs(stock), Math.abs(benchmark), 10);
  const stockW   = Math.abs(stock)     / maxAbs * 100;
  const benchW   = Math.abs(benchmark) / maxAbs * 100;
  const stockPos = stock     >= 0;
  const benchPos = benchmark >= 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400 mb-0.5">
        <span>{label}</span>
        <span className={stock >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          {fmtPct(stock)} vs {fmtPct(benchmark)}
        </span>
      </div>
      <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full rounded-full ${stockPos ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${stockW}%` }}
        />
      </div>
      <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full rounded-full ${benchPos ? 'bg-gray-500' : 'bg-gray-600'}`}
          style={{ width: `${benchW}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MomentumTab({ ticker }: MomentumTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [benchmark, setBenchmark] = useState('SPY');
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<MomentumResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const abortRef                  = useRef<AbortController | null>(null);

  const t = (en: string, esp: string) => (es ? esp : en);

  const analyze = async () => {
    if (!ticker) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const res = await fetch(`${backendUrl}/momentum/analyze`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticker, benchmark }),
        signal:  abortRef.current.signal,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error del servidor');
      }
      const data: MomentumResult = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (e: any) {
      if (e.name !== 'AbortError') setError(e.message || t('Unknown error', 'Error desconocido'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ticker) analyze();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const momentumLabel = (d: string, s: string) => {
    const dm: Record<string, string> = { alcista: t('Bullish','Alcista'), bajista: t('Bearish','Bajista'), neutral: t('Neutral','Neutral') };
    const sm: Record<string, string> = { alto: t('High','Alto'), moderado: t('Moderate','Moderado'), leve: t('Low','Leve'), neutral: t('Neutral','Neutral') };
    return `${dm[d] ?? d} — ${sm[s] ?? s}`;
  };
  const momentumColor = (d: string) =>
    d === 'alcista' ? 'text-emerald-400' : d === 'bajista' ? 'text-red-400' : 'text-gray-400';

  const gaugeColor = (score: number) =>
    score >= 75 ? 'emerald' : score >= 50 ? 'yellow' : score >= 25 ? 'orange' : 'red';

  const marketBadge = (status: string) => {
    if (status === 'open') return { text: t('Market Open','Mercado Abierto'), cls: 'bg-emerald-900/50 text-emerald-400 border-emerald-500/30' };
    if (status === 'pre_market_transition') return { text: t('Opening','Apertura'), cls: 'bg-yellow-900/50 text-yellow-400 border-yellow-500/30' };
    return { text: t('Market Closed','Mercado Cerrado'), cls: 'bg-gray-800/50 text-gray-400 border-gray-600/30' };
  };

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-gray-800 rounded-lg" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-28 bg-gray-800 rounded-xl" />)}
        </div>
        <div className="h-48 bg-gray-800 rounded-xl" />
        <div className="h-32 bg-gray-800 rounded-xl" />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-emerald-400">
            ⚡ {t('Intraday Momentum', 'Momentum Intraday')} — {ticker}
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {t(
              'Prismo breakout detection · Leader Score, post-run compression, diagonal ceiling',
              'Detección de breakout Prismo · Liderazgo, compresión post-corrida, techo diagonal'
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">{t('Benchmark','Benchmark')}</label>
            <select
              value={benchmark}
              onChange={e => setBenchmark(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="SPY">SPY</option>
              <option value="QQQ">QQQ</option>
              <option value="IWM">IWM</option>
              <option value="DIA">DIA</option>
            </select>
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="py-1.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition disabled:opacity-50"
          >
            {loading ? t('Analyzing…','Analizando…') : t('Refresh','Actualizar')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!result && !error && !loading && (
        <div className="bg-gray-900/50 border border-white/[0.07] rounded-xl p-8 text-center">
          <p className="text-4xl mb-3">⚡</p>
          <p className="text-gray-400">
            {t('Click Refresh to start Prismo analysis.', 'Presiona Actualizar para iniciar el análisis Prismo.')}
          </p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-8">

          {/* Status bar */}
          <div className="flex items-center gap-3 flex-wrap">
            {(() => {
              const b = marketBadge(result.market_status);
              return <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${b.cls}`}>{b.text}</span>;
            })()}
            <span className="text-xs text-gray-500">
              {result.data_quality === 'high' ? t('High quality','Datos alta calidad') : result.data_quality === 'medium' ? t('Medium quality','Calidad media') : t('Limited data','Datos limitados')}
              {' · '}{result.metrics.bar_count} bars · {result.elapsed_s}s
            </span>
            <span className="text-xs text-gray-600 ml-auto">{new Date(result.timestamp).toLocaleTimeString()}</span>
          </div>

          {/* ── TOP HERO: 4 main gauges ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

            {/* Momentum direction */}
            <div className="bg-gray-900/60 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center text-center">
              <p className="text-xs text-gray-400 mb-2">{t('Momentum','Momentum')}</p>
              <p className={`text-lg font-bold ${momentumColor(result.momentum.direction)}`}>
                {momentumLabel(result.momentum.direction, result.momentum.strength)}
              </p>
              <p className="text-xs text-gray-500 mt-1">{t('Confidence','Confianza')}: {result.confidence}%</p>
              <p className="text-xs text-gray-600 mt-0.5">B{result.momentum.bull_pts} / S{result.momentum.bear_pts}</p>
            </div>

            {/* Score Prismo */}
            <div className="bg-gray-900/60 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center">
              <p className="text-xs text-gray-400 mb-1 text-center">{t('Score Prismo','Score Prismo')}</p>
              <div className="w-24">
                <ScoreGauge score={result.prismo.score} label="/100" color={gaugeColor(result.prismo.score)} />
              </div>
            </div>

            {/* Breakout Prob */}
            <div className="bg-gray-900/60 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center">
              <p className="text-xs text-gray-400 mb-1 text-center">{t('Breakout Prob.','Prob. Breakout')}</p>
              <div className="w-24">
                <ScoreGauge score={result.breakout_prob} label="%" color={gaugeColor(result.breakout_prob)} />
              </div>
            </div>

            {/* RS vs Benchmark */}
            <div className="bg-gray-900/60 rounded-xl p-4 border border-white/[0.07] flex flex-col items-center justify-center text-center">
              <p className="text-xs text-gray-400 mb-2">{t('Rel. Strength (intraday)','RS Intraday')} vs {result.benchmark}</p>
              <p className={`text-3xl font-bold ${result.metrics.rs >= 1.1 ? 'text-emerald-400' : result.metrics.rs < 0.9 ? 'text-red-400' : 'text-gray-300'}`}>
                {result.metrics.rs.toFixed(2)}x
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {result.metrics.rs >= 1.1 ? t('Outperforming','Superando mercado')
                  : result.metrics.rs < 0.9 ? t('Underperforming','Debajo del mercado')
                  : t('In line','En línea')}
              </p>
            </div>
          </div>

          {/* ── LEADER SCORE section ── */}
          <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h4 className="text-base font-bold text-blue-400">
                🏆 {t('Leader Score', 'Score de Liderazgo')}
              </h4>
              <div className="flex items-center gap-3">
                <div className="w-20">
                  <ScoreGauge score={result.leader.score} label="/100" color={gaugeColor(result.leader.score)} />
                </div>
                <div className="text-right">
                  {result.leader.score >= 70
                    ? <span className="text-xs font-bold bg-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">{t('Top Leader','Líder Top')}</span>
                    : result.leader.score >= 40
                    ? <span className="text-xs font-bold bg-blue-900/50 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/30">{t('Outperformer','Outperformer')}</span>
                    : <span className="text-xs font-bold bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full border border-gray-600">{t('Average','Promedio')}</span>
                  }
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {([
                { label: t('3 Months','3 Meses'), stock: result.leader.r3m, bench: result.leader.b3m, ex: result.leader.ex3m },
                { label: t('6 Months','6 Meses'), stock: result.leader.r6m, bench: result.leader.b6m, ex: result.leader.ex6m },
                { label: t('12 Months','12 Meses'), stock: result.leader.r12m, bench: result.leader.b12m, ex: result.leader.ex12m },
              ] as const).map(({ label, stock, bench, ex }) => (
                <div key={label} className="bg-gray-800/50 rounded-lg p-3 border border-white/5">
                  <p className="text-xs text-gray-400 mb-2 font-medium">{label}</p>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-xl font-bold ${stock >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {fmtPct(stock, 1)}
                    </span>
                    <span className="text-xs text-gray-500">{ticker}</span>
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-sm text-gray-400">{fmtPct(bench, 1)}</span>
                    <span className="text-xs text-gray-600">{result.benchmark}</span>
                  </div>
                  <div className={`text-sm font-semibold ${ex >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtPct(ex, 1)} {t('excess','exceso')}
                  </div>
                  {/* Performance bar */}
                  <div className="mt-2 space-y-1">
                    <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`absolute top-0 left-0 h-full rounded-full ${stock >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(Math.abs(stock) / Math.max(Math.abs(stock), Math.abs(bench), 10) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="relative h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="absolute top-0 left-0 h-full rounded-full bg-gray-500"
                        style={{ width: `${Math.min(Math.abs(bench) / Math.max(Math.abs(stock), Math.abs(bench), 10) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-500">
              {t(
                'Prismo looks for the top 2% stocks by relative performance over 3/6/12 months vs their benchmark.',
                'Prismo busca el top 2% de acciones por rendimiento relativo en 3/6/12 meses vs su benchmark.'
              )}
            </p>
          </div>

          {/* ── COMPRESSION PATTERN section ── */}
          <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h4 className="text-base font-bold text-orange-400">
                🔲 {t('Post-Run Compression', 'Compresión Post-Corrida')}
              </h4>
              <div className="flex items-center gap-3">
                <div className="w-20">
                  <ScoreGauge score={result.compression.score} label="/100" color={gaugeColor(result.compression.score)} />
                </div>
                <div>
                  {result.compression.detected
                    ? <span className="text-xs font-bold bg-orange-900/50 text-orange-400 px-2 py-0.5 rounded-full border border-orange-500/30">{t('Base Active','Base Activa')}</span>
                    : <span className="text-xs font-bold bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full border border-gray-600">{t('No Base','Sin Base')}</span>
                  }
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {/* Big run */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/5 text-center">
                <p className="text-xs text-gray-400 mb-1">{t('Prior Run','Corrida Previa')}</p>
                <p className={`text-xl font-bold ${result.compression.big_run_confirmed ? 'text-emerald-400' : 'text-gray-500'}`}>
                  +{result.compression.big_run_pct.toFixed(0)}%
                </p>
                <p className="text-xs mt-0.5">
                  {result.compression.big_run_confirmed
                    ? <span className="text-emerald-400">✓ {t('Confirmed','Confirmado')}</span>
                    : <span className="text-gray-500">{t('Not enough','Insuficiente')}</span>}
                </p>
              </div>

              {/* Range compression */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/5 text-center">
                <p className="text-xs text-gray-400 mb-1">{t('Range Compression','Compresión Rango')}</p>
                <p className={`text-xl font-bold ${result.compression.range_compressed ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {((1 - result.compression.range_compression) * 100).toFixed(0)}%
                </p>
                <p className="text-xs mt-0.5">
                  {result.compression.range_compressed
                    ? <span className="text-emerald-400">✓ {t('Tight','Estrecho')}</span>
                    : <span className="text-gray-500">{t('Normal','Normal')}</span>}
                </p>
              </div>

              {/* Volume dry-up */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/5 text-center">
                <p className="text-xs text-gray-400 mb-1">{t('Volume Dry-up','Secado Volumen')}</p>
                <p className={`text-xl font-bold ${result.compression.vol_contracting ? 'text-emerald-400' : 'text-gray-400'}`}>
                  -{((1 - result.compression.vol_dry_up) * 100).toFixed(0)}%
                </p>
                <p className="text-xs mt-0.5">
                  {result.compression.vol_contracting
                    ? <span className="text-emerald-400">✓ {t('Contracting','Contrayendo')}</span>
                    : <span className="text-gray-500">{t('Normal','Normal')}</span>}
                </p>
              </div>

              {/* Diagonal ceiling */}
              <div className="bg-gray-800/50 rounded-lg p-3 border border-white/5 text-center">
                <p className="text-xs text-gray-400 mb-1">{t('Diagonal Ceiling','Techo Diagonal')}</p>
                <p className={`text-xl font-bold ${result.compression.diagonal_ceiling ? 'text-yellow-400' : 'text-gray-500'}`}>
                  {result.compression.diagonal_ceiling ? t('Yes','Sí') : t('No','No')}
                </p>
                {result.compression.ceiling_level && (
                  <p className="text-xs text-gray-500 mt-0.5">{fmtPrice(result.compression.ceiling_level)}</p>
                )}
              </div>
            </div>

            {/* Breakout proximity bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-400">
                <span>{t('Breakout Proximity','Proximidad al Breakout')}</span>
                <span className={result.compression.breakout_proximity >= 70 ? 'text-emerald-400 font-bold' : 'text-gray-300'}>
                  {result.compression.breakout_proximity.toFixed(0)}%
                  {result.compression.ceiling_level && (
                    <span className="text-gray-500 ml-1">
                      ({result.compression.distance_to_ceiling_pct.toFixed(1)}% {t('to ceiling','al techo')})
                    </span>
                  )}
                </span>
              </div>
              <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`absolute top-0 left-0 h-full rounded-full transition-all ${
                    result.compression.breakout_proximity >= 80 ? 'bg-emerald-500' :
                    result.compression.breakout_proximity >= 55 ? 'bg-yellow-500' : 'bg-orange-500'
                  }`}
                  style={{ width: `${result.compression.breakout_proximity}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">
                {t(
                  `Base window: last ${result.compression.base_window_days} days · Ceiling slope: ${result.compression.slope_pct_per_day >= 0 ? '+' : ''}${result.compression.slope_pct_per_day.toFixed(3)}%/day`,
                  `Ventana base: últimos ${result.compression.base_window_days} días · Pendiente techo: ${result.compression.slope_pct_per_day >= 0 ? '+' : ''}${result.compression.slope_pct_per_day.toFixed(3)}%/día`
                )}
              </p>
            </div>
          </div>

          {/* ── Active Signals ── */}
          {result.signals.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-300">
                {t('Active Signals','Señales Activas')} ({result.signals.length})
              </h4>
              <div className="space-y-2">
                {result.signals
                  .sort((a, b) => a.priority - b.priority)
                  .map((sig, i) => (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border text-sm ${signalBgColor(sig.color)}`}>
                      <span className="font-bold whitespace-nowrap">{sig.type}</span>
                      <span className="opacity-80">{sig.message}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── Intraday metrics row ── */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[
              { label: t('Price','Precio'),          value: fmtPrice(result.metrics.current_price), color: 'text-white' },
              { label: 'VWAP',                       value: fmtPrice(result.metrics.vwap),          color: 'text-yellow-400' },
              { label: t('VWAP Dev.','Dev. VWAP'),   value: fmtPct(result.metrics.vwap_deviation),  color: pctColor(result.metrics.vwap_deviation) },
              { label: t('Session Chg','Var. Sesión'),value: fmtPct(result.metrics.session_change_pct), color: pctColor(result.metrics.session_change_pct) },
              { label: 'ADX', value: result.metrics.adx.toFixed(0), color: result.metrics.adx < 25 ? 'text-yellow-400' : 'text-gray-300' },
              { label: t('Vol Surge','Surge Vol'),   value: `${result.metrics.vol_surge.toFixed(1)}x`, color: result.metrics.vol_surge >= 2 ? 'text-emerald-400' : result.metrics.vol_surge >= 1.5 ? 'text-yellow-400' : 'text-gray-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-900/50 rounded-lg p-3 border border-white/6 text-center">
                <p className="text-xs text-gray-400 mb-1">{label}</p>
                <p className={`text-base font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* ── Multi-TF table ── */}
          <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
            <h4 className="text-sm font-semibold text-gray-300 mb-4">
              {t('Multi-Timeframe Metrics','Métricas Multi-Temporalidad')}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-white/6 rounded-lg overflow-hidden">
                <thead>
                  <tr className="bg-gray-700/50 text-gray-300">
                    <th className="text-left px-4 py-2">TF</th>
                    <th className="text-right px-3 py-2">ROC%</th>
                    <th className="text-right px-3 py-2">RS</th>
                    <th className="text-right px-3 py-2">{t('Vol Surge','Surge Vol')}</th>
                    <th className="text-right px-3 py-2">ADX</th>
                    <th className="text-right px-3 py-2">{t('VWAP Dev.','Dev. VWAP')}</th>
                    <th className="text-left px-3 py-2 text-gray-500 hidden sm:table-cell">{t('Description','Descripción')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/40">
                  {result.metrics_by_tf.map(row => (
                    <tr key={row.timeframe} className="hover:bg-gray-700/30 transition">
                      <td className="px-4 py-2 font-semibold text-emerald-400">{row.timeframe}</td>
                      <td className={`text-right px-3 py-2 font-medium ${pctColor(row.roc)}`}>{fmtPct(row.roc)}</td>
                      <td className={`text-right px-3 py-2 ${row.rs != null ? (row.rs >= 1.1 ? 'text-emerald-400' : row.rs < 0.9 ? 'text-red-400' : 'text-gray-300') : 'text-gray-600'}`}>
                        {row.rs != null ? `${row.rs.toFixed(2)}x` : '—'}
                      </td>
                      <td className={`text-right px-3 py-2 ${row.vol_surge != null ? (row.vol_surge >= 2 ? 'text-emerald-400' : row.vol_surge >= 1.5 ? 'text-yellow-400' : 'text-gray-400') : 'text-gray-600'}`}>
                        {row.vol_surge != null ? `${row.vol_surge.toFixed(1)}x` : '—'}
                      </td>
                      <td className={`text-right px-3 py-2 ${row.adx != null ? (row.adx < 25 ? 'text-yellow-400' : 'text-gray-300') : 'text-gray-600'}`}>
                        {row.adx != null ? row.adx.toFixed(0) : '—'}
                      </td>
                      <td className={`text-right px-3 py-2 ${row.vwap_dev != null ? pctColor(row.vwap_dev) : 'text-gray-600'}`}>
                        {row.vwap_dev != null ? fmtPct(row.vwap_dev) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs hidden sm:table-cell">{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Charts ── */}
          {result.chart.prices.length > 2 && (
            <div className="space-y-4">
              <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
                <h4 className="text-sm font-semibold text-gray-300 mb-3">
                  {t('Price vs VWAP','Precio vs VWAP')} — {t('5m bars','Barras 5m')}
                </h4>
                <PriceChart chart={result.chart} />
              </div>
              <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
                <h4 className="text-sm font-semibold text-gray-300 mb-3">
                  {t('Momentum Oscillator','Oscilador de Momentum')}
                </h4>
                <MomentumChart chart={result.chart} />
              </div>
            </div>
          )}

          {/* ── Prismo factors ── */}
          {result.prismo.factors.length > 0 && (
            <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-sm font-semibold text-purple-400 mb-3">
                ⚡ {t('Prismo Factors','Factores Prismo')}
              </h4>
              <ul className="space-y-1.5">
                {result.prismo.factors.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="text-purple-400 mt-0.5">▸</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Session stats + Fundamentals ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-900/50 rounded-lg p-3 border border-white/6 text-center">
              <p className="text-xs text-gray-400 mb-1">{t('BB Compressed','BB Comprimido')}</p>
              <p className={`text-base font-bold ${result.metrics.bb.compressed ? 'text-yellow-400' : 'text-gray-500'}`}>
                {result.metrics.bb.compressed ? t('Yes — Coiling','Sí — Coiling') : 'No'}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{result.metrics.bb.compression_pct.toFixed(0)}% {t('compression','compresión')}</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 border border-white/6 text-center">
              <p className="text-xs text-gray-400 mb-1">{t('Proximity to High','Prox. al Máximo')}</p>
              <p className={`text-base font-bold ${result.metrics.proximity_to_high >= 90 ? 'text-emerald-400' : result.metrics.proximity_to_high < 50 ? 'text-red-400' : 'text-gray-300'}`}>
                {result.metrics.proximity_to_high.toFixed(0)}%
              </p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 border border-white/6 text-center">
              <p className="text-xs text-gray-400 mb-1">ATR</p>
              <p className="text-base font-bold text-blue-400">{fmtPrice(result.metrics.atr)}</p>
              <p className="text-xs text-gray-600 mt-0.5">{t('Avg True Range','Rango Verdadero')}</p>
            </div>
            <div className="bg-gray-900/50 rounded-lg p-3 border border-white/6 text-center">
              <p className="text-xs text-gray-400 mb-1">{t('Session Range','Rango Sesión')}</p>
              <p className="text-sm font-bold text-gray-300">
                {fmtPrice(result.metrics.session_low)} — {fmtPrice(result.metrics.session_high)}
              </p>
            </div>
          </div>

          {/* Fundamentals */}
          {result.fundamental && (
            <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">
                {t('Fundamentals Snapshot','Snapshot Fundamental')}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                {[
                  {
                    label: t('Float','Float'),
                    value: fmtBig(result.fundamental.float_shares),
                    note: result.fundamental.float_shares && result.fundamental.float_shares < 100e6
                      ? t('Small Float ✓','Float Pequeño ✓') : undefined,
                  },
                  { label: t('Mkt Cap','Mkt Cap'), value: result.fundamental.mkt_cap ? `$${fmtBig(result.fundamental.mkt_cap)}` : '—' },
                  {
                    label: t('EPS Growth','Crecimiento EPS'),
                    value: fmtPct(result.fundamental.eps_growth),
                    color: result.fundamental.eps_growth && result.fundamental.eps_growth > 0 ? 'text-emerald-400' : undefined,
                  },
                  { label: t('Sector','Sector'), value: result.fundamental.sector ?? '—' },
                  { label: 'Beta', value: result.fundamental.beta?.toFixed(2) ?? '—' },
                ].map(({ label, value, note, color }) => (
                  <div key={label} className="text-center">
                    <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                    <p className={`font-semibold ${color ?? 'text-gray-300'}`}>{value}</p>
                    {note && <p className="text-xs text-emerald-400 mt-0.5">{note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Narrative ── */}
          {result.narrative && (
            <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">{t('Narrative','Narrativa')}</h4>
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {result.narrative}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
