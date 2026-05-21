'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { NarrativeText } from '@/app/components/NarrativeText';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

interface CheapBreakoutTabProps {
  ticker?: string;
}

interface SetupData {
  resistance: number;
  dist_to_resistance_pct: number;
  touch_count: number;
  coil_pct: number;
  coil_high: number;
  coil_low: number;
  days_in_range: number;
  closes_position: number;
  vol_dryness: number;
  vol_signal: string;
  recent_avg_volume: number;
  baseline_volume: number;
  prior_spike_multiplier: number;
  had_prior_spike: boolean;
  prev_day_volume: number;
}

interface ChartPoint {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume: number;
  resistance: number | null;
  coil_high?: number;
  coil_low?: number;
  in_coil?: boolean;
}

interface CheapBreakoutResult {
  detected: boolean;
  score: number;
  ticker: string;
  setup: SetupData | null;
  narrative: string;
  current_price: number;
  chart_data: ChartPoint[];
}

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-amber-400 border-amber-500/40 bg-amber-900/30'
    : score >= 50 ? 'text-yellow-400 border-yellow-500/40 bg-yellow-900/30'
    : 'text-red-400 border-red-500/40 bg-red-900/30';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-sm font-bold ${color}`}>
      {score}/100
    </span>
  );
}

export default function CheapBreakoutScannerTab({ ticker }: CheapBreakoutTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState(ticker || '');
  const [minPrice, setMinPrice] = useState(0.01);
  const [maxPrice, setMaxPrice] = useState(0.10);
  const [maxDistPct, setMaxDistPct] = useState(8);
  const [maxCoilPct, setMaxCoilPct] = useState(25);
  const [minPrevDayVolume, setMinPrevDayVolume] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheapBreakoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  useEffect(() => {
    if (ticker) setTickerInput(ticker);
  }, [ticker]);

  const runDetection = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${backendUrl}/cheap-breakout/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: tickerInput.toUpperCase().trim(),
          min_price: minPrice,
          max_price: maxPrice,
          max_dist_to_resistance_pct: maxDistPct,
          max_coil_pct: maxCoilPct,
          min_prev_day_volume: minPrevDayVolume,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const chartData = (() => {
    if (!result?.chart_data?.length) return [];
    const raw = result.chart_data;
    if (raw.length <= 200) return raw;
    const step = Math.ceil(raw.length / 200);
    return raw.filter((_, i) => i % step === 0 || i === raw.length - 1);
  })();

  const setup = result?.setup ?? null;
  const distLabel = setup
    ? (setup.dist_to_resistance_pct >= 0
        ? `${fmt(setup.dist_to_resistance_pct, 1)}% ${es ? 'por debajo' : 'below'}`
        : `+${fmt(-setup.dist_to_resistance_pct, 1)}% ${es ? 'sobre' : 'over'}`)
    : '—';

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-amber-900/30 border border-amber-500/30 flex items-center justify-center">
          <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            Cheap Breakout Scanner (.01-.10)
          </h2>
          <p className="text-xs text-gray-500">
            {es ? 'Coiled Spring — setups pre-breakout en centavos' : 'Coiled Spring — pre-breakout setups in cents range'}
          </p>
        </div>
        <span className="ml-auto px-2 py-0.5 text-[10px] font-bold rounded bg-amber-900/50 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
          God Mode
        </span>
      </div>

      {/* Controls */}
      <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
        <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Ticker</label>
            <input
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && runDetection()}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-amber-500"
              placeholder="ABCD"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Precio mín' : 'Min Price'} ($)</label>
            <input
              type="number" value={minPrice} onChange={e => setMinPrice(+e.target.value)}
              min={0.001} max={0.10} step={0.005}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Precio máx' : 'Max Price'} ($)</label>
            <input
              type="number" value={maxPrice} onChange={e => setMaxPrice(+e.target.value)}
              min={0.01} max={1.00} step={0.01}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1.5"
              title={es ? 'Distancia máxima al techo de resistencia (más chico = más cerca de romper)' : 'Max % below resistance high (smaller = closer to popping)'}
            >
              {es ? 'Dist máx %' : 'Max Dist %'}
            </label>
            <input
              type="number" value={maxDistPct} onChange={e => setMaxDistPct(+e.target.value)}
              min={1} max={25} step={1}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1.5"
              title={es ? 'Rango máximo de los últimos 10 días (más chico = coil más comprimido)' : 'Max 10-day range as % of mean close (tighter = better coil)'}
            >
              {es ? 'Coil máx %' : 'Max Coil %'}
            </label>
            <input
              type="number" value={maxCoilPct} onChange={e => setMaxCoilPct(+e.target.value)}
              min={5} max={60} step={5}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label
              className="block text-xs text-gray-400 mb-1.5"
              title={es ? 'Volumen mínimo el día previo (0 = sin filtro)' : 'Minimum volume yesterday (0 = disabled)'}
            >
              {es ? 'Vol día prev. mín' : 'Prev Day Vol Min'}
            </label>
            <input
              type="number" value={minPrevDayVolume} onChange={e => setMinPrevDayVolume(+e.target.value)}
              min={0} step={1000}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={runDetection}
              disabled={loading || !tickerInput.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {es ? 'Buscando…' : 'Scanning…'}
                </span>
              ) : (
                es ? 'Detectar' : 'Detect'
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
          {/* Score Card */}
          <div className="grid sm:grid-cols-3 gap-4">
            <div className={`rounded-xl border p-4 ${result.detected ? 'bg-amber-900/20 border-amber-500/30' : 'bg-gray-900/40 border-gray-700/30'}`}>
              <div className="text-xs text-gray-400 mb-1">{es ? 'Estado' : 'Status'}</div>
              <div className={`text-lg font-bold ${result.detected ? 'text-amber-400' : 'text-gray-500'}`}>
                {result.detected ? (es ? 'COILED SPRING' : 'COILED SPRING') : (es ? 'Sin setup' : 'No setup')}
              </div>
            </div>
            <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
              <div className="text-xs text-gray-400 mb-1">Score</div>
              <ScoreBadge score={result.score} />
            </div>
            <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
              <div className="text-xs text-gray-400 mb-1">{es ? 'Precio actual' : 'Current Price'}</div>
              <div className="text-lg font-bold text-white">${fmt(result.current_price, 4)}</div>
            </div>
          </div>

          {/* Setup Metrics */}
          {setup && (
            <>
              <div className="grid sm:grid-cols-4 gap-4">
                <div className="rounded-xl border bg-amber-900/10 border-amber-500/20 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Resistencia' : 'Resistance'}</div>
                  <div className="text-lg font-bold text-amber-400">${fmt(setup.resistance, 4)}</div>
                  <div className="text-xs text-gray-500">{distLabel}</div>
                </div>
                <div className="rounded-xl border bg-amber-900/10 border-amber-500/20 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Toques de resistencia' : 'Resistance Touches'}</div>
                  <div className={`text-lg font-bold ${setup.touch_count >= 4 ? 'text-emerald-400' : setup.touch_count >= 3 ? 'text-amber-400' : 'text-gray-300'}`}>
                    {setup.touch_count}
                  </div>
                  <div className="text-xs text-gray-500">{es ? 'días tocando techo (±1%)' : 'days within 1% of high'}</div>
                </div>
                <div className="rounded-xl border bg-orange-900/10 border-orange-500/20 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Coil (rango 10d)' : 'Coil (10d range)'}</div>
                  <div className="text-lg font-bold text-orange-400">{fmt(setup.coil_pct)}%</div>
                  <div className="text-xs text-gray-500">${fmt(setup.coil_low, 4)} – ${fmt(setup.coil_high, 4)}</div>
                </div>
                <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Días consolidando' : 'Days in Range'}</div>
                  <div className="text-lg font-bold text-white">{setup.days_in_range}d</div>
                  <div className="text-xs text-gray-500">{es ? 'cierres en ' : 'closes at '}{Math.round(setup.closes_position * 100)}%{es ? ' del rango' : ' of range'}</div>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Señal de volumen' : 'Volume Signal'}</div>
                  <div className={`text-lg font-bold ${
                    setup.vol_signal === 'accumulating' || setup.vol_signal === 'drying' ? 'text-emerald-400'
                    : setup.vol_signal === 'neutral' ? 'text-gray-300'
                    : 'text-orange-400'
                  }`}>
                    {setup.vol_signal}
                  </div>
                  <div className="text-xs text-gray-500">{fmt(setup.vol_dryness, 2)}x {es ? 'vs baseline' : 'vs baseline'}</div>
                </div>
                <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Spike previo' : 'Prior Spike'}</div>
                  <div className={`text-lg font-bold ${setup.had_prior_spike ? 'text-emerald-400' : 'text-gray-500'}`}>
                    {fmt(setup.prior_spike_multiplier, 1)}x{setup.had_prior_spike ? ' ✓' : ''}
                  </div>
                  <div className="text-xs text-gray-500">{es ? 'vs baseline 120d' : 'vs 120d baseline'}</div>
                </div>
                <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
                  <div className="text-xs text-gray-400 mb-1">{es ? 'Volumen día previo' : 'Prev Day Volume'}</div>
                  <div className="text-lg font-bold text-white">{setup.prev_day_volume.toLocaleString('en-US')}</div>
                  <div className="text-xs text-gray-500">{es ? 'baseline:' : 'baseline:'} {setup.baseline_volume.toLocaleString('en-US')}</div>
                </div>
              </div>
            </>
          )}

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">{es ? 'Precio + Volumen' : 'Price + Volume'}</h3>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} interval={Math.ceil(chartData.length / 8)} />
                  <YAxis yAxisId="price" tick={{ fill: '#9ca3af', fontSize: 10 }} domain={['auto', 'auto']} />
                  <YAxis yAxisId="vol" orientation="right" tick={{ fill: '#4b5563', fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                    labelStyle={{ color: '#9ca3af' }}
                  />
                  {setup && (
                    <ReferenceLine
                      yAxisId="price" y={setup.resistance} stroke="#f59e0b" strokeDasharray="5 5"
                      label={{ value: `R $${setup.resistance.toFixed(4)}`, fill: '#f59e0b', fontSize: 10, position: 'right' }}
                    />
                  )}
                  {setup && (
                    <ReferenceLine
                      yAxisId="price" y={setup.coil_low} stroke="#6b7280" strokeDasharray="2 4"
                      label={{ value: `Coil low`, fill: '#6b7280', fontSize: 9, position: 'right' }}
                    />
                  )}
                  <Bar yAxisId="vol" dataKey="volume" opacity={0.3} radius={[2, 2, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.in_coil ? '#f59e0b' : '#1f2937'} />
                    ))}
                  </Bar>
                  <Line yAxisId="price" type="monotone" dataKey="close" stroke="#60a5fa" dot={false} strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-500" /> {es ? 'En coil' : 'In coil'}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-amber-500" /> {es ? 'Resistencia' : 'Resistance'}</span>
              </div>
            </div>
          )}

          {/* Narrative */}
          {result.narrative && (
            <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">{es ? 'Análisis' : 'Analysis'}</h3>
              <NarrativeText text={result.narrative} />
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-16 text-gray-600">
          <svg className="w-12 h-12 mx-auto mb-3 text-amber-700/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">{es ? 'Ingresá un ticker en centavos y ejecutá el scanner' : 'Enter a penny ticker and run the scanner'}</p>
        </div>
      )}
    </div>
  );
}
