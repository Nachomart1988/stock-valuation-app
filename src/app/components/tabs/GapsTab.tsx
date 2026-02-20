// src/app/components/tabs/GapsTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface GapStats {
  count: number;
  greenDayPct: number;
  redDayPct: number;
  fillRatePct: number;
  nextDayGreenPct: number | null;
  gapPct: { mean: number; median: number; std: number; min: number; max: number };
  highVsOpen: { mean: number; median: number; std: number; min: number; max: number };
  lowVsOpen: { mean: number; median: number; std: number; min: number; max: number };
  closeVsOpen: { mean: number; median: number; std: number; min: number; max: number };
  nextCloseVsOpen: { mean: number; median: number; std: number; min: number; max: number };
}

interface Gap {
  date: string;
  type: 'up' | 'down';
  prevClose: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  gapPct: number;
  highVsOpen: number;
  lowVsOpen: number;
  closeVsOpen: number;
  greenDay: boolean;
  gapFilled: boolean;
  nextDay: {
    highVsOpen: number;
    lowVsOpen: number;
    closeVsOpen: number;
    greenDay: boolean;
  } | null;
}

interface GapResult {
  ticker: string;
  days: number;
  gapThresholdPct: number;
  direction: string;
  totalGaps: number;
  upGaps: number;
  downGaps: number;
  stats: GapStats | null;
  upStats: GapStats | null;
  downStats: GapStats | null;
  recentGaps: Gap[];
  message?: string;
  error?: string;
}

interface GapsTabProps {
  ticker: string;
}

export default function GapsTab({ ticker }: GapsTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [days, setDays] = useState(600);
  const [threshold, setThreshold] = useState(2.0);
  const [direction, setDirection] = useState<'both' | 'up' | 'down'>('both');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = (en: string, esp: string) => es ? esp : en;

  const analyze = async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const res = await fetch(`${backendUrl}/gaps/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          days,
          gapThresholdPct: threshold,
          direction,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Error from server');
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Auto-analyze when ticker changes
  useEffect(() => {
    if (ticker) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const fmtPct = (v: number | null | undefined, decimals = 1) => {
    if (v == null || !isFinite(v)) return '—';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(decimals)}%`;
  };

  const pctColor = (v: number | null | undefined) => {
    if (v == null) return 'text-gray-400';
    return v >= 0 ? 'text-green-400' : 'text-red-400';
  };

  // SVG OHLC-style bar for average gap day
  function OHLCBar({ stats, type }: { stats: GapStats; type: 'up' | 'down' | 'all' }) {
    const gapAvg = stats.gapPct.mean;
    const highAvg = stats.highVsOpen.mean;
    const lowAvg = stats.lowVsOpen.mean;
    const closeAvg = stats.closeVsOpen.mean;

    // Normalize to SVG coords: center = 150, scale
    const values = [gapAvg, highAvg, lowAvg, closeAvg];
    const absMax = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)), 1);
    const scale = 90 / absMax; // pixels per %

    const cx = 150;
    const cy = 120;

    const toY = (pct: number) => cy - pct * scale;

    const openY = cy; // open = 0 baseline
    const highY = toY(highAvg);
    const lowY = toY(lowAvg);
    const closeY = toY(closeAvg);
    const gapLineY = toY(gapAvg); // prev close level

    const candleColor = closeAvg >= 0 ? '#22c55e' : '#ef4444';

    return (
      <svg width="300" height="240" viewBox="0 0 300 240" className="mx-auto">
        {/* Background */}
        <rect width="300" height="240" fill="transparent" />

        {/* Zero line (Open) */}
        <line x1="50" y1={openY} x2="250" y2={openY} stroke="#6b7280" strokeWidth="1" strokeDasharray="4,4" />
        <text x="255" y={openY + 4} fill="#9ca3af" fontSize="10">Open (0%)</text>

        {/* Prev close line (gap reference) */}
        <line x1="50" y1={gapLineY} x2="250" y2={gapLineY} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,3" />
        <text x="255" y={gapLineY + 4} fill="#f59e0b" fontSize="10">PrevClose ({fmtPct(gapAvg)})</text>

        {/* Wick high to low */}
        <line x1={cx} y1={highY} x2={cx} y2={lowY} stroke={candleColor} strokeWidth="2" />

        {/* Candle body (open to close) */}
        <rect
          x={cx - 20}
          y={Math.min(openY, closeY)}
          width={40}
          height={Math.max(Math.abs(closeY - openY), 2)}
          fill={candleColor}
          opacity={0.85}
          rx={2}
        />

        {/* Labels */}
        <text x={cx - 25} y={highY - 5} fill="#22c55e" fontSize="9" textAnchor="middle">
          H {fmtPct(highAvg)}
        </text>
        <text x={cx + 30} y={closeY} fill={candleColor} fontSize="9" textAnchor="start">
          C {fmtPct(closeAvg)}
        </text>
        <text x={cx - 25} y={lowY + 12} fill="#ef4444" fontSize="9" textAnchor="middle">
          L {fmtPct(lowAvg)}
        </text>

        {/* Title */}
        <text x={cx} y="20" fill="#e5e7eb" fontSize="12" textAnchor="middle" fontWeight="bold">
          {t('Avg Gap Day Behavior', 'Comportamiento Promedio del Gap')}
          {type === 'up' ? ' ↑' : type === 'down' ? ' ↓' : ''}
        </text>
        <text x={cx} y="36" fill="#9ca3af" fontSize="10" textAnchor="middle">
          {t('(relative to open)', '(relativo al open)')}
        </text>
      </svg>
    );
  }

  function StatCard({
    label, value, subtext, color = 'text-white'
  }: { label: string; value: string; subtext?: string; color?: string }) {
    return (
      <div className="bg-gray-900/60 rounded-xl p-4 border border-white/[0.07] text-center">
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
      </div>
    );
  }

  function StatsTable({ stats, title, color }: { stats: GapStats; title: string; color: string }) {
    const rows = [
      {
        label: t('Gap Size', 'Tamaño del Gap'),
        mean: stats.gapPct.mean, median: stats.gapPct.median, min: stats.gapPct.min, max: stats.gapPct.max,
      },
      {
        label: t('High vs Open', 'Máx vs Open'),
        mean: stats.highVsOpen.mean, median: stats.highVsOpen.median, min: stats.highVsOpen.min, max: stats.highVsOpen.max,
      },
      {
        label: t('Low vs Open', 'Mín vs Open'),
        mean: stats.lowVsOpen.mean, median: stats.lowVsOpen.median, min: stats.lowVsOpen.min, max: stats.lowVsOpen.max,
      },
      {
        label: t('Close vs Open', 'Cierre vs Open'),
        mean: stats.closeVsOpen.mean, median: stats.closeVsOpen.median, min: stats.closeVsOpen.min, max: stats.closeVsOpen.max,
      },
      {
        label: t('Next Day Close vs Open', 'Cierre Día Sig. vs Open'),
        mean: stats.nextCloseVsOpen.mean, median: stats.nextCloseVsOpen.median, min: stats.nextCloseVsOpen.min, max: stats.nextCloseVsOpen.max,
      },
    ];

    return (
      <div>
        <h4 className={`text-lg font-bold ${color} mb-3`}>{title}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-white/[0.06] rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-gray-700/50 text-gray-300">
                <th className="text-left px-4 py-2">{t('Metric', 'Métrica')}</th>
                <th className="text-right px-3 py-2">{t('Mean', 'Media')}</th>
                <th className="text-right px-3 py-2">{t('Median', 'Mediana')}</th>
                <th className="text-right px-3 py-2">{t('Min', 'Mín')}</th>
                <th className="text-right px-3 py-2">{t('Max', 'Máx')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {rows.map(row => (
                <tr key={row.label} className="hover:bg-gray-700/30 transition">
                  <td className="px-4 py-2 text-gray-300">{row.label}</td>
                  <td className={`text-right px-3 py-2 font-medium ${pctColor(row.mean)}`}>{fmtPct(row.mean, 2)}</td>
                  <td className={`text-right px-3 py-2 ${pctColor(row.median)}`}>{fmtPct(row.median, 2)}</td>
                  <td className={`text-right px-3 py-2 text-red-400`}>{fmtPct(row.min, 2)}</td>
                  <td className={`text-right px-3 py-2 text-green-400`}>{fmtPct(row.max, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-purple-400">
            {t('Gap Analysis', 'Análisis de Gaps')} — {ticker}
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            {t(
              'Historical price gaps: days where open was significantly above/below previous close',
              'Gaps históricos: días donde el open fue significativamente mayor/menor que el cierre anterior'
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
        <h4 className="text-sm font-semibold text-gray-300 mb-4">{t('Parameters', 'Parámetros')}</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('Days of History', 'Días de Historial')}</label>
            <input
              type="number"
              value={days}
              min={60}
              max={2000}
              step={60}
              onChange={e => setDays(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('Gap Threshold (%)', 'Umbral del Gap (%)')}</label>
            <input
              type="number"
              value={threshold}
              min={0.5}
              max={20}
              step={0.5}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('Direction', 'Dirección')}</label>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as any)}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
            >
              <option value="both">{t('Both', 'Ambos')}</option>
              <option value="up">{t('Gap Up Only', 'Solo Gap Alcista')}</option>
              <option value="down">{t('Gap Down Only', 'Solo Gap Bajista')}</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={analyze}
              disabled={loading}
              className="w-full py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('Analyzing...', 'Analizando...') : t('Analyze', 'Analizar')}
            </button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-24 bg-gray-800 rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-gray-800 rounded-xl" />
        </div>
      )}

      {/* No gaps found */}
      {result && result.totalGaps === 0 && (
        <div className="bg-gray-900/50 border border-white/[0.07] rounded-xl p-8 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-gray-400">{result.message || t('No gaps found with these parameters.', 'No se encontraron gaps con estos parámetros.')}</p>
        </div>
      )}

      {/* Results */}
      {result && result.totalGaps > 0 && result.stats && (
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label={t('Total Gaps', 'Total de Gaps')}
              value={String(result.totalGaps)}
              subtext={`${result.days} ${t('days', 'días')}`}
              color="text-purple-400"
            />
            <StatCard
              label={t('Gap Up ↑', 'Gap Alcista ↑')}
              value={String(result.upGaps)}
              subtext={result.upStats ? `${result.upStats.greenDayPct.toFixed(0)}% ${t('green', 'verde')}` : undefined}
              color="text-green-400"
            />
            <StatCard
              label={t('Gap Down ↓', 'Gap Bajista ↓')}
              value={String(result.downGaps)}
              subtext={result.downStats ? `${result.downStats.redDayPct.toFixed(0)}% ${t('red', 'rojo')}` : undefined}
              color="text-red-400"
            />
            <StatCard
              label={t('Fill Rate', 'Tasa de Llenado')}
              value={`${result.stats.fillRatePct.toFixed(1)}%`}
              subtext={t('gaps that filled same day', 'gaps que se llenaron el mismo día')}
              color="text-yellow-400"
            />
          </div>

          {/* Behavioral stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label={t('Green Day Prob.', 'Prob. Día Verde')}
              value={`${result.stats.greenDayPct.toFixed(1)}%`}
              subtext={t('close > open on gap day', 'cierre > open en día de gap')}
              color={result.stats.greenDayPct >= 50 ? 'text-green-400' : 'text-red-400'}
            />
            <StatCard
              label={t('Red Day Prob.', 'Prob. Día Rojo')}
              value={`${result.stats.redDayPct.toFixed(1)}%`}
              subtext={t('close < open on gap day', 'cierre < open en día de gap')}
              color={result.stats.redDayPct >= 50 ? 'text-red-400' : 'text-gray-400'}
            />
            <StatCard
              label={t('Next Day Green', 'Día Sig. Verde')}
              value={result.stats.nextDayGreenPct != null ? `${result.stats.nextDayGreenPct.toFixed(1)}%` : '—'}
              subtext={t('day after gap closes green', 'el día siguiente cierra en verde')}
              color={
                result.stats.nextDayGreenPct != null && result.stats.nextDayGreenPct >= 50
                  ? 'text-green-400' : 'text-red-400'
              }
            />
            <StatCard
              label={t('Avg Gap Size', 'Tamaño Medio Gap')}
              value={fmtPct(result.stats.gapPct.mean, 2)}
              subtext={t('mean gap magnitude', 'magnitud media del gap')}
              color="text-blue-400"
            />
          </div>

          {/* OHLC visual + stats split */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: OHLC visualization */}
            <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-base font-semibold text-gray-200 mb-4 text-center">
                {t('Average Gap Day (All)', 'Día de Gap Promedio (Todos)')}
              </h4>
              <OHLCBar stats={result.stats} type="all" />
              <p className="text-xs text-gray-500 mt-3 text-center">
                {t(
                  'Candle shows avg high, low, close relative to gap open. Yellow line = avg gap from prev close.',
                  'La vela muestra el máx, mín y cierre promedio relativo al open del gap. Línea amarilla = gap promedio desde el cierre anterior.'
                )}
              </p>
            </div>

            {/* Right: Up vs Down stats */}
            <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07] space-y-5">
              <h4 className="text-base font-semibold text-gray-200">
                {t('Gap Up vs Gap Down Comparison', 'Comparativa Gap Alcista vs Bajista')}
              </h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-2">
                  <p className="text-green-400 font-semibold">{t('Gap Up ↑', 'Gap Alcista ↑')} ({result.upGaps})</p>
                  {result.upStats && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Green Day', 'Día Verde')}</span>
                        <span className="text-green-400">{result.upStats.greenDayPct.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Fill Rate', 'Tasa Llenado')}</span>
                        <span className="text-yellow-400">{result.upStats.fillRatePct.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Next Day Green', 'Día Sig. Verde')}</span>
                        <span className={result.upStats.nextDayGreenPct && result.upStats.nextDayGreenPct >= 50 ? 'text-green-400' : 'text-red-400'}>
                          {result.upStats.nextDayGreenPct != null ? `${result.upStats.nextDayGreenPct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Avg Close vs Open', 'Cierre vs Open')}</span>
                        <span className={pctColor(result.upStats.closeVsOpen.mean)}>{fmtPct(result.upStats.closeVsOpen.mean, 2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Avg Gap', 'Gap Medio')}</span>
                        <span className="text-green-400">{fmtPct(result.upStats.gapPct.mean, 2)}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-red-400 font-semibold">{t('Gap Down ↓', 'Gap Bajista ↓')} ({result.downGaps})</p>
                  {result.downStats && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Green Day', 'Día Verde')}</span>
                        <span className="text-green-400">{result.downStats.greenDayPct.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Fill Rate', 'Tasa Llenado')}</span>
                        <span className="text-yellow-400">{result.downStats.fillRatePct.toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Next Day Green', 'Día Sig. Verde')}</span>
                        <span className={result.downStats.nextDayGreenPct && result.downStats.nextDayGreenPct >= 50 ? 'text-green-400' : 'text-red-400'}>
                          {result.downStats.nextDayGreenPct != null ? `${result.downStats.nextDayGreenPct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Avg Close vs Open', 'Cierre vs Open')}</span>
                        <span className={pctColor(result.downStats.closeVsOpen.mean)}>{fmtPct(result.downStats.closeVsOpen.mean, 2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">{t('Avg Gap', 'Gap Medio')}</span>
                        <span className="text-red-400">{fmtPct(result.downStats.gapPct.mean, 2)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Detailed stats table */}
          <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
            <StatsTable
              stats={result.stats}
              title={t('All Gaps — Detailed Statistics', 'Todos los Gaps — Estadísticas Detalladas')}
              color="text-purple-400"
            />
          </div>

          {result.upStats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
                <StatsTable
                  stats={result.upStats}
                  title={t('Gap Up Statistics', 'Estadísticas de Gaps Alcistas')}
                  color="text-green-400"
                />
              </div>
              {result.downStats && (
                <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
                  <StatsTable
                    stats={result.downStats}
                    title={t('Gap Down Statistics', 'Estadísticas de Gaps Bajistas')}
                    color="text-red-400"
                  />
                </div>
              )}
            </div>
          )}

          {/* Recent gaps table */}
          {result.recentGaps && result.recentGaps.length > 0 && (
            <div className="bg-gray-900/50 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-base font-semibold text-gray-200 mb-4">
                {t('Recent Gaps', 'Gaps Recientes')} ({result.recentGaps.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-white/[0.06] rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-gray-700/50 text-gray-300">
                      <th className="text-left px-3 py-2">{t('Date', 'Fecha')}</th>
                      <th className="text-center px-2 py-2">{t('Type', 'Tipo')}</th>
                      <th className="text-right px-3 py-2">{t('Gap%', 'Gap%')}</th>
                      <th className="text-right px-3 py-2">{t('PrevClose', 'Cierre Ant.')}</th>
                      <th className="text-right px-3 py-2">{t('Open', 'Open')}</th>
                      <th className="text-right px-3 py-2">{t('High', 'High')}</th>
                      <th className="text-right px-3 py-2">{t('Low', 'Low')}</th>
                      <th className="text-right px-3 py-2">{t('Close', 'Cierre')}</th>
                      <th className="text-right px-3 py-2">{t('Close/Open', 'Cierre/Open')}</th>
                      <th className="text-center px-2 py-2">{t('Green', 'Verde')}</th>
                      <th className="text-center px-2 py-2">{t('Filled', 'Llenado')}</th>
                      <th className="text-right px-3 py-2">{t('Next Day C/O', 'Sig. C/O')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/40">
                    {result.recentGaps.map(g => (
                      <tr
                        key={g.date}
                        className={`hover:bg-gray-700/30 transition ${
                          g.type === 'up' ? 'bg-green-900/10' : 'bg-red-900/10'
                        }`}
                      >
                        <td className="px-3 py-1.5 text-gray-300 whitespace-nowrap">{g.date}</td>
                        <td className="text-center px-2 py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${
                            g.type === 'up'
                              ? 'bg-green-900/50 text-green-400'
                              : 'bg-red-900/50 text-red-400'
                          }`}>
                            {g.type === 'up' ? '↑ UP' : '↓ DN'}
                          </span>
                        </td>
                        <td className={`text-right px-3 py-1.5 font-semibold ${g.type === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                          {fmtPct(g.gapPct, 2)}
                        </td>
                        <td className="text-right px-3 py-1.5 text-gray-400">${g.prevClose.toFixed(2)}</td>
                        <td className="text-right px-3 py-1.5 text-gray-200">${g.open.toFixed(2)}</td>
                        <td className="text-right px-3 py-1.5 text-green-400">${g.high.toFixed(2)}</td>
                        <td className="text-right px-3 py-1.5 text-red-400">${g.low.toFixed(2)}</td>
                        <td className={`text-right px-3 py-1.5 ${g.greenDay ? 'text-green-400' : 'text-red-400'}`}>
                          ${g.close.toFixed(2)}
                        </td>
                        <td className={`text-right px-3 py-1.5 ${pctColor(g.closeVsOpen)}`}>
                          {fmtPct(g.closeVsOpen, 2)}
                        </td>
                        <td className="text-center px-2 py-1.5">
                          {g.greenDay ? '🟢' : '🔴'}
                        </td>
                        <td className="text-center px-2 py-1.5">
                          {g.gapFilled ? '✅' : '❌'}
                        </td>
                        <td className={`text-right px-3 py-1.5 ${g.nextDay ? pctColor(g.nextDay.closeVsOpen) : 'text-gray-500'}`}>
                          {g.nextDay ? fmtPct(g.nextDay.closeVsOpen, 2) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                {t(
                  'Filled = gap closed back to prev close on the same day. Next Day C/O = next day close vs next day open.',
                  'Llenado = el gap se cerró hasta el precio de cierre anterior el mismo día. Sig. C/O = cierre del día siguiente vs open del día siguiente.'
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
