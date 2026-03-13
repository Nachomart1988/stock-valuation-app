'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Cell, Area,
} from 'recharts';

interface HTFDetectionTabProps {
  ticker?: string;
}

interface SurgeData {
  start_date: string;
  peak_date: string;
  surge_pct: number;
  weeks: number;
  low_price: number;
  high_price: number;
}

interface FlagData {
  flag_high: number;
  flag_low: number;
  flag_range_pct: number;
  vol_dryup_ratio: number;
  vol_declining: boolean;
  weeks: number;
  start_date: string;
  end_date: string;
}

interface BreakoutData {
  current_price: number;
  flag_high: number;
  proximity_pct: number;
  breakout_triggered: boolean;
  vol_confirmation: boolean;
  vol_ratio: number;
}

interface CatalystData {
  date: string;
  actual_eps: number;
  estimated_eps: number;
  surprise_pct: number;
  beat: boolean;
}

interface RSData {
  rs_current: number;
  rs_new_high: boolean;
  rs_percentile: number;
}

interface PatternData {
  surge: SurgeData;
  flag: FlagData | null;
  catalyst: CatalystData | null;
  breakout: BreakoutData;
  ml_probability: number;
  fusion_score: number;
  narrative: string;
}

interface ChartPoint {
  date: string;
  close: number;
  high: number;
  low: number;
  volume: number;
  zone: string;
  flag_high?: number;
  flag_low?: number;
}

interface HTFResult {
  detected: boolean;
  score: number;
  ticker: string;
  current_price: number;
  analysis_date: string;
  patterns: PatternData[];
  best_pattern: {
    surge_pct: number;
    flag_range_pct: number | null;
    flag_weeks: number | null;
    vol_dryup: number | null;
    ml_probability: number;
    breakout_status: string;
  };
  relative_strength: RSData;
  bollinger_tightness: number;
  pullback_to_ma50_pct: number;
  narrative: string;
  chart_data: ChartPoint[];
  ml_available: boolean;
  earnings_catalysts: CatalystData[];
  quote: { price: number; change_pct: number; volume: number; avg_volume: number; market_cap: number } | null;
}

const ZONE_COLORS: Record<string, string> = {
  surge: '#ef4444',
  flag: '#22c55e',
  breakout_watch: '#f59e0b',
  normal: '#6b7280',
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

export default function HTFDetectionTab({ ticker }: HTFDetectionTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState(ticker || 'TSLA');
  const [minSurge, setMinSurge] = useState(80);
  const [maxRange, setMaxRange] = useState(15);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HTFResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPattern, setSelectedPattern] = useState(0);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const runDetection = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${backendUrl}/htf/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: tickerInput.toUpperCase().trim(),
          min_surge: minSurge / 100,
          max_flag_range: maxRange / 100,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setResult(data);
      setSelectedPattern(0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const pattern = result?.patterns?.[selectedPattern];

  // Chart data: sample every Nth point to keep chart responsive
  const chartData = (() => {
    if (!result?.chart_data?.length) return [];
    const raw = result.chart_data;
    if (raw.length <= 200) return raw;
    const step = Math.ceil(raw.length / 200);
    return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  })();

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center">
          <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            {es ? 'Detección de High-Tight Flag' : 'High-Tight Flag Detection'}
          </h2>
          <p className="text-xs text-gray-500">
            Quillamaggie Style — {es ? 'Surge explosivo + consolidación tight + breakout' : 'Explosive surge + tight consolidation + breakout'}
          </p>
        </div>
        <span className="ml-auto px-2 py-0.5 text-[10px] font-bold rounded bg-red-900/50 text-red-400 border border-red-500/30 uppercase tracking-wider">
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
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Surge mínimo' : 'Min Surge'} (%)</label>
            <input
              type="number" value={minSurge} onChange={e => setMinSurge(+e.target.value)}
              min={50} max={200} step={10}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Rango flag máx' : 'Max Flag Range'} (%)</label>
            <input
              type="number" value={maxRange} onChange={e => setMaxRange(+e.target.value)}
              min={5} max={25} step={1}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={runDetection}
              disabled={loading || !tickerInput.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {es ? 'Analizando…' : 'Analyzing…'}
                </span>
              ) : (
                es ? 'Detectar HTF' : 'Detect HTF'
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
          {/* Top-level score card */}
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Detection Status */}
            <div className={`p-5 rounded-xl border ${result.detected ? 'bg-emerald-900/10 border-emerald-500/30' : 'bg-gray-900/30 border-gray-700/30'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 uppercase tracking-wider">{es ? 'Detección' : 'Detection'}</span>
                <ScoreBadge score={result.score} />
              </div>
              <p className={`text-2xl font-black ${result.detected ? 'text-emerald-400' : 'text-gray-500'}`}>
                {result.detected ? (es ? 'HTF DETECTADO' : 'HTF DETECTED') : (es ? 'No detectado' : 'Not Detected')}
              </p>
              <p className="text-xs text-gray-500 mt-1">{result.ticker} · {result.analysis_date}</p>
            </div>

            {/* Best Pattern Metrics */}
            {result.best_pattern && (
              <div className="p-5 rounded-xl border border-green-900/20 bg-black/30">
                <span className="text-xs text-gray-400 uppercase tracking-wider">{es ? 'Mejor Patrón' : 'Best Pattern'}</span>
                <div className="mt-2 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Surge</span>
                    <span className="text-white font-data">{fmtPct(result.best_pattern.surge_pct)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Flag Range</span>
                    <span className="text-white font-data">{result.best_pattern.flag_range_pct != null ? `${fmt(result.best_pattern.flag_range_pct)}%` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Vol Dry-Up</span>
                    <span className="text-white font-data">{result.best_pattern.vol_dryup != null ? `${fmt(result.best_pattern.vol_dryup, 2)}x` : '—'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">ML Prob</span>
                    <span className="text-white font-data">{fmt(result.best_pattern.ml_probability * 100)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Technical Signals */}
            <div className="p-5 rounded-xl border border-green-900/20 bg-black/30">
              <span className="text-xs text-gray-400 uppercase tracking-wider">{es ? 'Señales Técnicas' : 'Technical Signals'}</span>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill active={result.relative_strength?.rs_new_high} label={es ? 'RS Nuevos Máximos' : 'RS New Highs'} />
                <StatusPill active={result.best_pattern?.breakout_status === 'confirmed'} label="Breakout" />
                <StatusPill active={result.bollinger_tightness < 0.05} label="BB Tight" />
                <StatusPill active={Math.abs(result.pullback_to_ma50_pct) < 5} label="Near MA50" />
              </div>
              <div className="mt-3 text-xs text-gray-500">
                RS: {fmt(result.relative_strength?.rs_percentile)}th pctile · BB: {fmt(result.bollinger_tightness, 4)} · MA50: {fmtPct(result.pullback_to_ma50_pct)}
              </div>
            </div>
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-black/30 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Mapa de Precio con Zonas HTF' : 'Price Map with HTF Zones'}</h3>
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
                      if (name === 'flag_high') return [`$${v.toFixed(2)}`, 'Flag High'];
                      return [v, name ?? ''];
                    }) as never}
                  />
                  <Bar yAxisId="vol" dataKey="volume" opacity={0.3} barSize={2}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={ZONE_COLORS[d.zone] || '#374151'} />
                    ))}
                  </Bar>
                  <Line yAxisId="price" type="monotone" dataKey="close" stroke="#22c55e" dot={false} strokeWidth={1.5} />
                  {chartData.some(d => d.flag_high) && (
                    <Line yAxisId="price" type="stepAfter" dataKey="flag_high" stroke="#f59e0b" dot={false} strokeWidth={1} strokeDasharray="4 4" />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-red-500" /> Surge</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-emerald-500" /> Flag</span>
                <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-yellow-500" /> Breakout Watch</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t border-dashed border-yellow-500" /> Flag High</span>
              </div>
            </div>
          )}

          {/* Pattern selector (if multiple) */}
          {result.patterns.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {result.patterns.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedPattern(i)}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    selectedPattern === i
                      ? 'bg-red-900/40 text-red-400 border border-red-500/40'
                      : 'bg-black/40 text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  Pattern #{i + 1} — {fmt(p.fusion_score)}/100
                </button>
              ))}
            </div>
          )}

          {/* Narrative */}
          <div className="bg-black/30 rounded-xl border border-green-900/20 p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Interpretación' : 'Interpretation'}
            </h3>
            <div className="text-sm text-gray-300 whitespace-pre-line font-data leading-relaxed">
              {pattern?.narrative || result.narrative}
            </div>
          </div>

          {/* Detailed metrics table */}
          {pattern && (
            <div className="grid sm:grid-cols-2 gap-4">
              {/* Surge Details */}
              <div className="bg-black/30 rounded-xl border border-red-900/20 p-4">
                <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-3">
                  Surge {es ? 'Detalles' : 'Details'}
                </h4>
                <div className="space-y-2 text-sm">
                  {[
                    [es ? 'Magnitud' : 'Magnitude', fmtPct(pattern.surge.surge_pct * 100)],
                    [es ? 'Duración' : 'Duration', `${pattern.surge.weeks} ${es ? 'semanas' : 'weeks'}`],
                    [es ? 'Precio mín' : 'Low Price', `$${fmt(pattern.surge.low_price, 2)}`],
                    [es ? 'Precio máx' : 'High Price', `$${fmt(pattern.surge.high_price, 2)}`],
                    [es ? 'Inicio' : 'Start', pattern.surge.start_date],
                    ['Peak', pattern.surge.peak_date],
                  ].map(([label, val]) => (
                    <div key={label as string} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className="text-white font-data">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Flag Details */}
              <div className="bg-black/30 rounded-xl border border-emerald-900/20 p-4">
                <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                  Flag {es ? 'Detalles' : 'Details'}
                </h4>
                {pattern.flag ? (
                  <div className="space-y-2 text-sm">
                    {[
                      ['Range', `${fmt(pattern.flag.flag_range_pct)}%`],
                      [es ? 'Duración' : 'Duration', `${pattern.flag.weeks} ${es ? 'semanas' : 'weeks'}`],
                      ['Flag High', `$${fmt(pattern.flag.flag_high, 2)}`],
                      ['Flag Low', `$${fmt(pattern.flag.flag_low, 2)}`],
                      ['Vol Dry-Up', `${fmt(pattern.flag.vol_dryup_ratio, 2)}x`],
                      ['Vol Declining', pattern.flag.vol_declining ? '✓' : '✗'],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex justify-between">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-white font-data">{val}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">{es ? 'No se detectó flag válido' : 'No valid flag detected'}</p>
                )}
              </div>

              {/* Catalyst */}
              <div className="bg-black/30 rounded-xl border border-yellow-900/20 p-4">
                <h4 className="text-xs font-semibold text-yellow-400 uppercase tracking-wider mb-3">
                  Catalyst
                </h4>
                {pattern.catalyst ? (
                  <div className="space-y-2 text-sm">
                    {[
                      [es ? 'Fecha' : 'Date', pattern.catalyst.date],
                      ['EPS Actual', `$${fmt(pattern.catalyst.actual_eps, 2)}`],
                      ['EPS Estimado', `$${fmt(pattern.catalyst.estimated_eps, 2)}`],
                      ['Surprise', fmtPct(pattern.catalyst.surprise_pct)],
                      ['Beat', pattern.catalyst.beat ? '✓ Beat' : '✗ Miss'],
                    ].map(([label, val]) => (
                      <div key={label as string} className="flex justify-between">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-white font-data">{val}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">{es ? 'Sin catalizador de earnings confirmado' : 'No confirmed earnings catalyst'}</p>
                )}
              </div>

              {/* Breakout Proximity */}
              <div className="bg-black/30 rounded-xl border border-orange-900/20 p-4">
                <h4 className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">
                  Breakout Status
                </h4>
                <div className="space-y-2 text-sm">
                  {[
                    [es ? 'Precio actual' : 'Current Price', `$${fmt(pattern.breakout.current_price, 2)}`],
                    ['Flag High', `$${fmt(pattern.breakout.flag_high, 2)}`],
                    [es ? 'Proximidad' : 'Proximity', fmtPct(pattern.breakout.proximity_pct)],
                    ['Breakout', pattern.breakout.breakout_triggered ? '✓ Triggered' : '✗ Not Yet'],
                    [es ? 'Vol Confirmación' : 'Vol Confirmation', pattern.breakout.vol_confirmation ? `✓ ${fmt(pattern.breakout.vol_ratio)}x` : `✗ ${fmt(pattern.breakout.vol_ratio)}x`],
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

          {/* ML & RS Footer */}
          <div className="flex items-center justify-between text-xs text-gray-600 px-1">
            <span>ML: {result.ml_available ? 'GBM (synthetic-trained)' : 'Heuristic fallback'}</span>
            <span>RS: {fmt(result.relative_strength?.rs_percentile)}th pctile{result.relative_strength?.rs_new_high ? ' (NEW HIGH)' : ''}</span>
            <span>{result.patterns.length} pattern{result.patterns.length !== 1 ? 's' : ''} found</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-16 text-gray-600">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <p className="text-lg font-semibold">
            {es ? 'High-Tight Flag Scanner' : 'High-Tight Flag Scanner'}
          </p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            {es
              ? 'Detecta surges explosivos (100%+) seguidos de consolidación tight con volume dry-up — el setup de Quillamaggie.'
              : 'Detects explosive surges (100%+) followed by tight consolidation with volume dry-up — the Quillamaggie setup.'}
          </p>
        </div>
      )}
    </div>
  );
}
