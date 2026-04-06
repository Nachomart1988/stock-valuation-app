'use client';

import { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { NarrativeText } from '@/app/components/NarrativeText';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Area,
} from 'recharts';

interface FormerRunnerTabProps {
  ticker?: string;
}

interface PatternData {
  past_surge_pct: number;
  dormancy_months: number;
  wake_volume_multiplier: number;
  peak_date: string;
  peak_price: number;
  current_price: number;
  current_date: string;
}

interface ChartPoint {
  date: string;
  close: number;
  volume: number;
  zone: string;
}

interface FormerRunnerResult {
  detected: boolean;
  score: number;
  ticker: string;
  pattern: PatternData | null;
  narrative: string;
  current_price: number;
  chart_data: ChartPoint[];
}

const ZONE_COLORS: Record<string, string> = {
  surge: '#ef4444',
  dormant: '#6b7280',
  wake: '#22c55e',
};

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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

export default function FormerRunnerLowFloatTab({ ticker }: FormerRunnerTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [tickerInput, setTickerInput] = useState(ticker || '');
  const [minSurge, setMinSurge] = useState(400);
  const [minDormancy, setMinDormancy] = useState(6);
  const [wakeVolume, setWakeVolume] = useState(15);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FormerRunnerResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // Sync ticker from props
  useEffect(() => {
    if (ticker) setTickerInput(ticker);
  }, [ticker]);

  const runDetection = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${backendUrl}/former-runner/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: tickerInput.toUpperCase().trim(),
          min_past_surge: minSurge / 100,
          min_dormancy_months: minDormancy,
          wake_volume_multiplier: wakeVolume,
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

  // Chart data sampling
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
        <div className="w-10 h-10 rounded-xl bg-emerald-900/30 border border-emerald-500/30 flex items-center justify-center">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">
            {es ? 'Former Runner + Low-Float Scanner' : 'Former Runner + Low-Float Scanner'}
          </h2>
          <p className="text-xs text-gray-500">
            Jack Sykes / Quillamaggie Style — {es ? 'Run pasado + dormancia + volumen explosivo' : 'Past run + dormancy + explosive volume wake'}
          </p>
        </div>
        <span className="ml-auto px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-900/50 text-emerald-400 border border-emerald-500/30 uppercase tracking-wider">
          God Mode
        </span>
      </div>

      {/* Controls */}
      <div className="bg-black/40 rounded-xl border border-green-900/20 p-4">
        <div className="grid sm:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Ticker</label>
            <input
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && runDetection()}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
              placeholder="AAPL"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Surge mínimo' : 'Min Surge'} (%)</label>
            <input
              type="number" value={minSurge} onChange={e => setMinSurge(+e.target.value)}
              min={100} max={2000} step={50}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Dormancia mín' : 'Min Dormancy'} (m)</label>
            <input
              type="number" value={minDormancy} onChange={e => setMinDormancy(+e.target.value)}
              min={1} max={36} step={1}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">{es ? 'Vol Wake' : 'Wake Vol'} (x)</label>
            <input
              type="number" value={wakeVolume} onChange={e => setWakeVolume(+e.target.value)}
              min={5} max={100} step={5}
              className="w-full px-3 py-2 rounded-lg bg-black/60 border border-green-900/30 text-white text-sm font-data focus:outline-none focus:border-green-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={runDetection}
              disabled={loading || !tickerInput.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition"
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
            <div className={`rounded-xl border p-4 ${result.detected ? 'bg-emerald-900/20 border-emerald-500/30' : 'bg-gray-900/40 border-gray-700/30'}`}>
              <div className="text-xs text-gray-400 mb-1">{es ? 'Estado' : 'Status'}</div>
              <div className={`text-lg font-bold ${result.detected ? 'text-emerald-400' : 'text-gray-500'}`}>
                {result.detected ? (es ? 'DETECTADO' : 'DETECTED') : (es ? 'No detectado' : 'Not detected')}
              </div>
            </div>
            <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
              <div className="text-xs text-gray-400 mb-1">Score</div>
              <ScoreBadge score={result.score} />
            </div>
            {result.pattern && (
              <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
                <div className="text-xs text-gray-400 mb-1">{es ? 'Precio actual' : 'Current Price'}</div>
                <div className="text-lg font-bold text-white">${fmt(result.current_price, 4)}</div>
              </div>
            )}
          </div>

          {/* Pattern Details */}
          {result.pattern && (
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="rounded-xl border bg-red-900/10 border-red-500/20 p-4">
                <div className="text-xs text-gray-400 mb-1">{es ? 'Run pasado' : 'Past Run'}</div>
                <div className="text-lg font-bold text-red-400">+{fmt(result.pattern.past_surge_pct, 0)}%</div>
                <div className="text-xs text-gray-500">{es ? 'Pico' : 'Peak'}: {result.pattern.peak_date}</div>
              </div>
              <div className="rounded-xl border bg-gray-900/40 border-gray-700/30 p-4">
                <div className="text-xs text-gray-400 mb-1">{es ? 'Dormancia' : 'Dormancy'}</div>
                <div className="text-lg font-bold text-gray-300">{fmt(result.pattern.dormancy_months)} {es ? 'meses' : 'months'}</div>
              </div>
              <div className="rounded-xl border bg-emerald-900/10 border-emerald-500/20 p-4">
                <div className="text-xs text-gray-400 mb-1">{es ? 'Vol. Wake' : 'Wake Volume'}</div>
                <div className="text-lg font-bold text-emerald-400">{fmt(result.pattern.wake_volume_multiplier)}x</div>
                <div className="text-xs text-gray-500">{es ? 'vs promedio dormido' : 'vs dormant avg'}</div>
              </div>
            </div>
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
                  <Bar yAxisId="vol" dataKey="volume" opacity={0.4} radius={[2, 2, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={ZONE_COLORS[d.zone] || '#6b7280'} />
                    ))}
                  </Bar>
                  <Line yAxisId="price" type="monotone" dataKey="close" stroke="#60a5fa" dot={false} strokeWidth={1.5} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500" /> {es ? 'Surge' : 'Surge'}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-500" /> {es ? 'Dormancia' : 'Dormant'}</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-500" /> {es ? 'Despertar' : 'Wake'}</span>
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
          <svg className="w-12 h-12 mx-auto mb-3 text-emerald-700/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-sm">{es ? 'Ingresa un ticker y ejecuta el scanner' : 'Enter a ticker and run the scanner'}</p>
        </div>
      )}
    </div>
  );
}
