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

  // ── Día de gap promedio ─────────────────────────────────────────────
  // Muestra 1-3 velas promedio (Todos / Alcista / Bajista) sobre la misma
  // escala, relativas al open (0%). Los números van en una fila debajo de
  // cada vela — nada de etiquetas flotantes que se superponen.
  function AvgGapDayChart({ all, up, down }: { all: GapStats; up: GapStats | null; down: GapStats | null }) {
    const series = [
      { key: 'all', label: t('All gaps', 'Todos'), stats: all },
      ...(up && up.count > 0 ? [{ key: 'up', label: t('Gap Up ↑', 'Alcista ↑'), stats: up }] : []),
      ...(down && down.count > 0 ? [{ key: 'down', label: t('Gap Down ↓', 'Bajista ↓'), stats: down }] : []),
    ];

    // Nivel del cierre previo relativo al open: si el gap fue g%, prevClose = open/(1+g/100)
    const prevCloseRel = (g: number) => (1 / (1 + g / 100) - 1) * 100;

    const W = 480, H = 250;
    const PAD = { l: 46, r: 14, t: 14, b: 26 };
    const plotW = W - PAD.l - PAD.r;
    const plotH = H - PAD.t - PAD.b;

    const allVals = series.flatMap(s => [
      s.stats.highVsOpen.mean, s.stats.lowVsOpen.mean, s.stats.closeVsOpen.mean,
      prevCloseRel(s.stats.gapPct.mean), 0,
    ]);
    const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
    const span = Math.max(rawMax - rawMin, 1);
    const yMin = rawMin - span * 0.12, yMax = rawMax + span * 0.12;
    const toY = (pct: number) => PAD.t + (1 - (pct - yMin) / (yMax - yMin)) * plotH;

    // Gridlines con paso "lindo"
    const step = span > 24 ? 10 : span > 12 ? 5 : span > 6 ? 2 : 1;
    const gridVals: number[] = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) gridVals.push(v);

    const slotW = plotW / series.length;
    const zeroY = toY(0);

    return (
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxWidth: 560 }} shapeRendering="geometricPrecision">
          {/* Gridlines + eje % */}
          {gridVals.map(v => (
            <g key={v}>
              <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)} stroke="#ffffff" strokeOpacity="0.05" strokeWidth="1" />
              <text x={PAD.l - 6} y={toY(v) + 3.5} fill="#6b7280" fontSize="9.5" textAnchor="end">{v > 0 ? `+${v}` : v}%</text>
            </g>
          ))}

          {/* Línea del open (0%) */}
          <line x1={PAD.l} y1={zeroY} x2={W - PAD.r} y2={zeroY} stroke="#9ca3af" strokeWidth="1.2" strokeDasharray="5,4" />
          <text x={W - PAD.r} y={zeroY - 5} fill="#9ca3af" fontSize="9.5" textAnchor="end">Open · 0%</text>

          {series.map((s, i) => {
            const cx = PAD.l + slotW * i + slotW / 2;
            const high = s.stats.highVsOpen.mean;
            const low = s.stats.lowVsOpen.mean;
            const close = s.stats.closeVsOpen.mean;
            const pc = prevCloseRel(s.stats.gapPct.mean);
            const color = close >= 0 ? '#22c55e' : '#ef4444';
            const bodyW = Math.min(44, slotW * 0.34);

            return (
              <g key={s.key}>
                {/* Zona del gap: entre el cierre previo y el open */}
                <rect
                  x={cx - bodyW * 1.15}
                  y={Math.min(toY(pc), zeroY)}
                  width={bodyW * 2.3}
                  height={Math.max(Math.abs(toY(pc) - zeroY), 1)}
                  fill="#f59e0b"
                  opacity="0.10"
                />
                {/* Cierre previo */}
                <line x1={cx - bodyW * 1.15} y1={toY(pc)} x2={cx + bodyW * 1.15} y2={toY(pc)}
                      stroke="#f59e0b" strokeWidth="1.4" strokeDasharray="3,3" />
                <text x={cx + bodyW * 1.15 + 4} y={toY(pc) + 3.5} fill="#f59e0b" fontSize="8.5">PC</text>

                {/* Mecha high-low */}
                <line x1={cx} y1={toY(high)} x2={cx} y2={toY(low)} stroke={color} strokeWidth="2" strokeLinecap="round" />

                {/* Cuerpo open→close */}
                <rect
                  x={cx - bodyW / 2}
                  y={Math.min(zeroY, toY(close))}
                  width={bodyW}
                  height={Math.max(Math.abs(toY(close) - zeroY), 2)}
                  fill={color}
                  opacity="0.9"
                  rx="2.5"
                />

                {/* Nombre de la serie */}
                <text x={cx} y={H - 8} fill="#d1d5db" fontSize="10.5" fontWeight="600" textAnchor="middle">
                  {s.label} <tspan fill="#6b7280" fontWeight="400">({s.stats.count})</tspan>
                </text>
              </g>
            );
          })}
        </svg>

        {/* Valores por serie — en tabla, no flotando sobre el gráfico */}
        <div className={`grid gap-2 mt-3 ${series.length === 3 ? 'grid-cols-3' : series.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {series.map(s => (
            <div key={s.key} className="bg-black/50 rounded-lg border border-white/[0.06] px-3 py-2 text-[11px] space-y-0.5">
              <div className="text-gray-300 font-semibold mb-1">{s.label}</div>
              <div className="flex justify-between"><span className="text-amber-400/90">Gap</span><span className="text-amber-400">{fmtPct(s.stats.gapPct.mean, 1)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('High', 'Máx')}</span><span className="text-green-400">{fmtPct(s.stats.highVsOpen.mean, 1)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('Close', 'Cierre')}</span><span className={pctColor(s.stats.closeVsOpen.mean)}>{fmtPct(s.stats.closeVsOpen.mean, 1)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{t('Low', 'Mín')}</span><span className="text-red-400">{fmtPct(s.stats.lowVsOpen.mean, 1)}</span></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function StatCard({
    label, value, subtext, color = 'text-white'
  }: { label: string; value: string; subtext?: string; color?: string }) {
    return (
      <div className="bg-black/50 rounded-xl p-4 border border-white/[0.07] text-center">
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
              <tr className="bg-black/40 text-gray-300">
                <th className="text-left px-4 py-2">{t('Metric', 'Métrica')}</th>
                <th className="text-right px-3 py-2">{t('Mean', 'Media')}</th>
                <th className="text-right px-3 py-2">{t('Median', 'Mediana')}</th>
                <th className="text-right px-3 py-2">{t('Min', 'Mín')}</th>
                <th className="text-right px-3 py-2">{t('Max', 'Máx')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-green-900/15/50">
              {rows.map(row => (
                <tr key={row.label} className="hover:bg-black/30 transition">
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
      <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07]">
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
              className="w-full bg-black/60 border border-green-900/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
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
              className="w-full bg-black/60 border border-green-900/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('Direction', 'Dirección')}</label>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as any)}
              className="w-full bg-black/60 border border-green-900/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
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
              <div key={i} className="h-24 bg-black/60 rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-black/60 rounded-xl" />
        </div>
      )}

      {/* No gaps found */}
      {result && result.totalGaps === 0 && (
        <div className="bg-black/40 border border-white/[0.07] rounded-xl p-8 text-center">
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
            <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-base font-semibold text-gray-200 mb-1 text-center">
                {t('Average Gap Day', 'Día de Gap Promedio')}
              </h4>
              <p className="text-[11px] text-gray-500 mb-4 text-center">
                {t('Everything measured from the open (0%)', 'Todo medido desde el open (0%)')}
              </p>
              <AvgGapDayChart all={result.stats} up={result.upStats} down={result.downStats} />
              <p className="text-xs text-gray-500 mt-3 text-center">
                {t(
                  'Each candle is the average day: body = open→close, wick = high/low range. The amber dashed line (PC) is the previous close — the shaded zone is the gap being crossed at the open.',
                  'Cada vela es el día promedio: cuerpo = open→cierre, mecha = rango máx/mín. La línea punteada ámbar (PC) es el cierre del día anterior — la zona sombreada es el gap que se saltó en la apertura.'
                )}
              </p>
            </div>

            {/* Right: Up vs Down stats */}
            <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07] space-y-5">
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
          <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07]">
            <StatsTable
              stats={result.stats}
              title={t('All Gaps — Detailed Statistics', 'Todos los Gaps — Estadísticas Detalladas')}
              color="text-purple-400"
            />
          </div>

          {result.upStats && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07]">
                <StatsTable
                  stats={result.upStats}
                  title={t('Gap Up Statistics', 'Estadísticas de Gaps Alcistas')}
                  color="text-green-400"
                />
              </div>
              {result.downStats && (
                <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07]">
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
            <div className="bg-black/40 rounded-xl p-5 border border-white/[0.07]">
              <h4 className="text-base font-semibold text-gray-200 mb-4">
                {t('Recent Gaps', 'Gaps Recientes')} ({result.recentGaps.length})
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border border-white/[0.06] rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-black/40 text-gray-300">
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
                  <tbody className="divide-y divide-green-900/15/40">
                    {result.recentGaps.map(g => (
                      <tr
                        key={g.date}
                        className={`hover:bg-black/30 transition ${
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
