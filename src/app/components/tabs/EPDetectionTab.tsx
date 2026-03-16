'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { NarrativeText } from '@/app/components/NarrativeText';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

interface EPDetectionTabProps {
  ticker?: string;
}

interface GapData {
  index: number;
  date: string;
  gap_pct: number;
  move_pct: number;
  effective_pct: number;
  prior_close: number;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  vol_ratio: number;
  day_range_pct: number;
}

interface CatalystData {
  date: string;
  actual_eps: number;
  estimated_eps: number;
  surprise_pct: number;
  beat: boolean;
  magnitude: string;
}

interface SupportData {
  holds: boolean;
  close_holds: boolean;
  days_checked: number;
  min_low: number;
  max_drawdown_pct: number;
  support_level: number;
  gap_low: number;
}

interface FollowthroughData {
  has_followthrough: boolean;
  continuation_pct: number;
  vol_followthrough_ratio: number;
  made_new_high: boolean;
  days_analyzed: number;
}

interface RSData {
  rs_outperform: boolean;
  rs_percentile: number;
  stock_vs_spy_pct: number;
  stock_3m_ret: number;
  spy_3m_ret: number;
}

interface FundamentalsData {
  accelerating: boolean;
  quarters_analyzed: number;
  growth_rates: number[];
  latest_growth: number;
  consecutive_positive: number;
}

interface EpisodeData {
  gap: GapData;
  catalyst: CatalystData | null;
  support: SupportData;
  followthrough: FollowthroughData;
  relative_strength: RSData;
  ml_probability: number;
  catalyst_score: number;
  metrics_score: number;
  fusion_score: number;
  z_score: number;
  narrative: string;
  action: 'buy' | 'watch' | 'skip';
}

interface ChartPoint {
  date: string;
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  zone: string;
  annotation: string | null;
}

interface EPResult {
  detected: boolean;
  score: number;
  ticker: string;
  current_price: number;
  analysis_date: string;
  episodes: EpisodeData[];
  best_episode: {
    date: string;
    gap_pct: number;
    vol_spike: number;
    holds_support: boolean;
    has_followthrough: boolean;
    catalyst_type: string;
    action: string;
    ml_probability: number;
  };
  fundamentals: FundamentalsData;
  narrative: string;
  chart_data: ChartPoint[];
  ml_available: boolean;
  total_gaps_found: number;
  quote: { price: number; change_pct: number; volume: number; avg_volume: number; market_cap: number } | null;
}

const ZONE_COLORS: Record<string, string> = {
  gap: '#ef4444',
  post_gap: '#f59e0b',
  normal: '#6b7280',
};

const ACTION_STYLES: Record<string, { bg: string; text: string; label: string; labelEs: string }> = {
  buy:   { bg: 'bg-emerald-900/40', text: 'text-emerald-400', label: 'BUY / ADD', labelEs: 'COMPRAR' },
  watch: { bg: 'bg-yellow-900/40',  text: 'text-yellow-400',  label: 'WATCH', labelEs: 'MONITOREAR' },
  skip:  { bg: 'bg-red-900/30',     text: 'text-red-400',     label: 'SKIP', labelEs: 'DESCARTAR' },
};

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${fmt(n)}%`;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-emerald-400 border-emerald-500/40 bg-emerald-900/30'
    : score >= 50 ? 'text-yellow-400 border-yellow-500/40 bg-yellow-900/30'
    : 'text-red-400 border-red-500/40 bg-red-900/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-sm font-bold ${color}`}>
      {score}/100
    </span>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      active ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/30' : 'bg-red-900/30 text-red-400 border border-red-500/30'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {label}
    </span>
  );
}

export default function EPDetectionTab({ ticker }: EPDetectionTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState(ticker || 'TSLA');
  const [minGap, setMinGap] = useState(15);
  const [lookbackDays, setLookbackDays] = useState(504);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EPResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState(0);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runDetection = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${backendUrl}/ep/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: tickerInput.toUpperCase().trim(),
          min_gap: minGap / 100,
          lookback_days: lookbackDays,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setResult(data);
      setSelectedEpisode(0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const episode = result?.episodes?.[selectedEpisode];

  // Chart data sampling
  const chartData = (() => {
    if (!result?.chart_data?.length) return [];
    const raw = result.chart_data;
    if (raw.length <= 200) return raw;
    const step = Math.ceil(raw.length / 200);
    // Always include gap days
    const gapDates = new Set(result.episodes.map(e => e.gap.date));
    return raw.filter((d, i) => i % step === 0 || i === raw.length - 1 || gapDates.has(d.date));
  })();

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-purple-900/30 border border-purple-500/30 flex items-center justify-center">
          <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            {es ? 'Detección de Episodic Pivots' : 'Episodic Pivot Detection'}
          </h2>
          <p className="text-xs text-gray-500">
            Quillamaggie Style — {es ? 'Gaps explosivos + catalizador + acumulación institucional' : 'Explosive gaps + catalyst + institutional accumulation'}
          </p>
        </div>
        <span className="ml-auto px-2 py-0.5 text-[10px] font-bold rounded bg-purple-900/50 text-purple-400 border border-purple-500/30 uppercase tracking-wider">
          God Mode
        </span>
      </div>

      {/* Controls */}
      <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
        <div className="grid sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Ticker</label>
            <input
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && runDetection()}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
              placeholder="TSLA"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Gap mínimo' : 'Min Gap'} (%)</label>
            <input
              type="number" value={minGap} onChange={e => setMinGap(+e.target.value)}
              min={10} max={50} step={5}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Lookback ({es ? 'días' : 'days'})</label>
            <select
              value={lookbackDays} onChange={e => setLookbackDays(+e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm focus:outline-none focus:border-green-500"
            >
              <option value={252}>1 {es ? 'año' : 'year'}</option>
              <option value={504}>2 {es ? 'años' : 'years'}</option>
              <option value={756}>3 {es ? 'años' : 'years'}</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={runDetection}
              disabled={loading || !tickerInput.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {es ? 'Escaneando…' : 'Scanning…'}
                </span>
              ) : (
                es ? 'Detectar EPs' : 'Detect EPs'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-900/20 border border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Top score cards */}
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Detection Status */}
            <div className={`p-5 rounded-xl border ${result.detected ? 'bg-purple-900/10 border-purple-500/30' : 'bg-gray-900/30 border-gray-700/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 uppercase tracking-wider">{es ? 'Detección' : 'Detection'}</span>
                <ScoreBadge score={result.score} />
              </div>
              <p className={`text-2xl font-black ${result.detected ? 'text-purple-400' : 'text-gray-500'}`}>
                {result.detected ? (es ? 'EP DETECTADO' : 'EP DETECTED') : (es ? 'No detectado' : 'Not Detected')}
              </p>
              <p className="text-xs text-gray-500 mt-1">{result.ticker} · {result.analysis_date} · {result.total_gaps_found} gaps found</p>
            </div>

            {/* Best Episode */}
            {result.best_episode && (
              <div className="p-5 rounded-xl border border-green-900/20 bg-black/30">
                <span className="text-xs text-gray-400 uppercase tracking-wider">{es ? 'Mejor Episodio' : 'Best Episode'}</span>
                <div className="mt-2 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">{es ? 'Fecha' : 'Date'}</span>
                    <span className="text-white font-data">{result.best_episode.date}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Gap</span>
                    <span className="text-white font-data">{fmtPct(result.best_episode.gap_pct)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Vol Spike</span>
                    <span className="text-white font-data">{fmt(result.best_episode.vol_spike)}x</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">ML Prob</span>
                    <span className="text-white font-data">{fmt(result.best_episode.ml_probability * 100)}%</span>
                  </div>
                </div>
                <div className="mt-3">
                  {(() => {
                    const a = ACTION_STYLES[result.best_episode.action] || ACTION_STYLES.skip;
                    return (
                      <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold ${a.bg} ${a.text} border border-current/20`}>
                        {es ? a.labelEs : a.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Signals */}
            <div className="p-5 rounded-xl border border-green-900/20 bg-black/30">
              <span className="text-xs text-gray-400 uppercase tracking-wider">{es ? 'Señales' : 'Signals'}</span>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill active={result.best_episode?.holds_support} label={es ? 'Soporte' : 'Support Hold'} />
                <StatusPill active={result.best_episode?.has_followthrough} label="Follow-Through" />
                <StatusPill active={result.fundamentals?.accelerating} label={es ? 'Crecimiento Acelerado' : 'Accelerating Growth'} />
                <StatusPill active={result.best_episode?.catalyst_type === 'earnings'} label="Earnings Catalyst" />
              </div>
              {result.fundamentals && (
                <div className="mt-3 text-xs text-gray-500">
                  {es ? 'Crecimiento EPS' : 'EPS Growth'}: {result.fundamentals.growth_rates?.slice(-3).map(r => fmtPct(r)).join(' → ') || '—'}
                  {result.fundamentals.consecutive_positive > 0 && ` · ${result.fundamentals.consecutive_positive}Q ${es ? 'positivos' : 'positive'}`}
                </div>
              )}
            </div>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-black/30 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Mapa de Precio con Episodios' : 'Price Map with Episodes'}</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a2e1a" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={d => d?.slice(5) || ''}
                    interval={Math.max(1, Math.floor(chartData.length / 12))}
                  />
                  <YAxis
                    yAxisId="price" domain={['auto', 'auto']}
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    tickFormatter={v => `$${v}`}
                  />
                  <YAxis
                    yAxisId="vol" orientation="right" domain={[0, 'auto']}
                    tick={{ fill: '#6b7280', fontSize: 9 }}
                    tickFormatter={v => `${(v / 1e6).toFixed(0)}M`}
                    width={45}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0a0a0a', border: '1px solid #1a3a1a', borderRadius: '12px', fontSize: '12px' }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={((value: number | undefined, name: string | undefined) => {
                      const v = value ?? 0;
                      if (name === 'volume') return [`${(v / 1e6).toFixed(1)}M`, 'Vol'];
                      if (name === 'close') return [`$${v.toFixed(2)}`, 'Close'];
                      return [v, name ?? ''];
                    }) as never}
                  />
                  <Bar yAxisId="vol" dataKey="volume" opacity={0.3} barSize={2}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={ZONE_COLORS[d.zone] || '#374151'} />
                    ))}
                  </Bar>
                  <Line yAxisId="price" type="monotone" dataKey="close" stroke="#a855f7" dot={false} strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-red-500" /> Gap Day</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-yellow-500" /> Post-Gap</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-purple-500" /> Price</span>
              </div>
            </div>
          )}

          {/* Episode selector */}
          {result.episodes.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {result.episodes.map((ep, i) => {
                const a = ACTION_STYLES[ep.action] || ACTION_STYLES.skip;
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedEpisode(i)}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      selectedEpisode === i
                        ? 'bg-purple-900/40 text-purple-400 border border-purple-500/40'
                        : 'bg-black/40 text-gray-500 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    {ep.gap.date} — {fmtPct(ep.gap.effective_pct)} — {fmt(ep.fusion_score)}/100
                    <span className={`ml-1.5 ${a.text}`}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Narrative */}
          <div className="bg-black/30 rounded-xl border border-green-900/20 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Interpretación' : 'Interpretation'}
            </h3>
            <NarrativeText text={episode?.narrative || result.narrative} className="text-sm text-gray-300 whitespace-pre-line font-data leading-relaxed" />
          </div>

          {/* Detailed metrics */}
          {episode && (
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Gap Details */}
              <div className="bg-black/30 rounded-xl border border-red-900/20 p-4">
                <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">
                  Gap / Move
                </h4>
                <div className="space-y-2 text-sm">
                  {[
                    [es ? 'Fecha' : 'Date', episode.gap.date],
                    ['Gap %', fmtPct(episode.gap.gap_pct)],
                    ['Move %', fmtPct(episode.gap.move_pct)],
                    ['Vol Spike', `${fmt(episode.gap.vol_ratio)}x avg`],
                    ['Day Range', `${fmt(episode.gap.day_range_pct)}%`],
                    [es ? 'Cierre previo' : 'Prior Close', `$${fmt(episode.gap.prior_close, 2)}`],
                    ['Open', `$${fmt(episode.gap.open, 2)}`],
                    ['Close', `$${fmt(episode.gap.close, 2)}`],
                    ['Z-Score', `${fmt(episode.z_score, 1)}σ`],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="text-white font-data">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Support & Follow-Through */}
              <div className="bg-black/30 rounded-xl border border-emerald-900/20 p-4">
                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                  Support & Follow-Through
                </h4>
                <div className="space-y-2 text-sm">
                  {[
                    [es ? 'Soporte' : 'Support Hold', episode.support.holds ? '✓' : (episode.support.close_holds ? '~ Close Hold' : '✗')],
                    [es ? 'Nivel soporte' : 'Support Level', `$${fmt(episode.support.support_level, 2)}`],
                    ['Gap Low (Stop)', `$${fmt(episode.support.gap_low, 2)}`],
                    ['Max Drawdown', fmtPct(episode.support.max_drawdown_pct)],
                    [es ? 'Continuación' : 'Continuation', fmtPct(episode.followthrough.continuation_pct)],
                    ['Vol Follow-Through', `${fmt(episode.followthrough.vol_followthrough_ratio)}x`],
                    [es ? 'Nuevos máximos' : 'New Highs', episode.followthrough.made_new_high ? '✓' : '✗'],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="text-white font-data">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Catalyst */}
              <div className="bg-black/30 rounded-xl border border-yellow-900/20 p-4">
                <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-3">
                  Catalyst
                </h4>
                {episode.catalyst ? (
                  <div className="space-y-2 text-sm">
                    {[
                      [es ? 'Fecha' : 'Date', episode.catalyst.date],
                      ['EPS Actual', `$${fmt(episode.catalyst.actual_eps, 2)}`],
                      ['EPS Estimado', `$${fmt(episode.catalyst.estimated_eps, 2)}`],
                      ['Surprise', fmtPct(episode.catalyst.surprise_pct)],
                      [es ? 'Resultado' : 'Result', episode.catalyst.beat ? '✓ Beat' : '✗ Miss'],
                      [es ? 'Magnitud' : 'Magnitude', episode.catalyst.magnitude],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex justify-between">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-white font-data">{val}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">{es ? 'Sin catalizador de earnings — investigar noticias/FDA/M&A' : 'No earnings catalyst — investigate news/FDA/M&A'}</p>
                )}
              </div>

              {/* Relative Strength */}
              <div className="bg-black/30 rounded-xl border border-purple-900/20 p-4">
                <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
                  Relative Strength
                </h4>
                <div className="space-y-2 text-sm">
                  {[
                    ['RS Percentile', `${fmt(episode.relative_strength.rs_percentile)}th`],
                    ['RS Outperform', episode.relative_strength.rs_outperform ? '✓' : '✗'],
                    [`${result.ticker} 3M`, fmtPct(episode.relative_strength.stock_3m_ret)],
                    ['SPY 3M', fmtPct(episode.relative_strength.spy_3m_ret)],
                    ['Alpha', fmtPct(episode.relative_strength.stock_vs_spy_pct)],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="text-white font-data">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Scoring breakdown */}
          {episode && (
            <div className="bg-black/30 rounded-xl border border-green-900/20 p-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                {es ? 'Desglose de Puntuación' : 'Score Breakdown'}
              </h4>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Catalyst', value: episode.catalyst_score, weight: '50%', color: 'bg-yellow-500' },
                  { label: 'Metrics', value: episode.metrics_score, weight: '30%', color: 'bg-emerald-500' },
                  { label: 'ML Prob', value: episode.ml_probability, weight: '20%', color: 'bg-purple-500' },
                  { label: 'FUSION', value: episode.fusion_score / 100, weight: '', color: 'bg-white' },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
                      <div
                        className={`absolute inset-y-0 left-0 ${item.color} rounded-full transition-all`}
                        style={{ width: `${item.value * 100}%` }}
                      />
                    </div>
                    <p className="text-sm font-bold text-white">{fmt(item.value * 100)}%</p>
                    <p className="text-xs text-gray-500">{item.label} {item.weight && `(${item.weight})`}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-gray-600 px-1">
            <span>ML: {result.ml_available ? 'GBM (synthetic-trained)' : 'Heuristic fallback'}</span>
            <span>{result.episodes.length} episode{result.episodes.length !== 1 ? 's' : ''} · {result.total_gaps_found} gaps scanned</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-16 text-gray-600">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <p className="text-lg font-semibold">
            {es ? 'Episodic Pivot Scanner' : 'Episodic Pivot Scanner'}
          </p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            {es
              ? 'Detecta gaps explosivos (20%+) en catalizadores como earnings beats, FDA approvals o M&A — el setup de Quillamaggie para capturar explosiones institucionales.'
              : 'Detects explosive gaps (20%+) on catalysts like earnings beats, FDA approvals or M&A — the Quillamaggie setup for capturing institutional explosions.'}
          </p>
        </div>
      )}
    </div>
  );
}
