'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchFmp } from '@/lib/fmpClient';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-luxon';
import { CandlestickController, CandlestickElement, OhlcElement } from 'chartjs-chart-financial';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin,
  CandlestickController,
  CandlestickElement,
  OhlcElement
);

export interface HTFChartPattern {
  surge_pct: number;
  flag_range_pct: number | null;
  flag_weeks: number | null;
  vol_dryup: number | null;
  ml_probability: number;
  breakout_status: string;
  surge_start_date?: string | null;
  surge_peak_date?: string | null;
  surge_low_price?: number | null;
  surge_high_price?: number | null;
  flag_start_date?: string | null;
  flag_end_date?: string | null;
  flag_high?: number | null;
  flag_low?: number | null;
}

interface HTFChartModalProps {
  symbol: string;
  companyName: string;
  currentPrice: number;
  pattern: HTFChartPattern | null;
  onClose: () => void;
}

type Months = 3 | 6 | 9 | 12;

export default function HTFChartModal({
  symbol,
  companyName,
  currentPrice,
  pattern,
  onClose,
}: HTFChartModalProps) {
  const [months, setMonths] = useState<Months>(6);
  const [chartData, setChartData] = useState<Array<{ x: number; o: number; h: number; l: number; c: number }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChart = useCallback(async (sym: string, m: Months) => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const from = new Date(today);
      // Pull a bit extra so the surge/flag dates (which can be older than the visible window) still render.
      from.setMonth(from.getMonth() - m - 1);
      const fromStr = from.toISOString().split('T')[0];
      const toStr = today.toISOString().split('T')[0];

      const json = await fetchFmp('stable/historical-price-eod/full', {
        symbol: sym,
        from: fromStr,
        to: toStr,
      });

      if (!Array.isArray(json) || json.length === 0) {
        setChartData(null);
        setError('No price data available');
        return;
      }

      const sorted = json
        .map((d: any) => ({
          x: new Date(d.date).getTime(),
          o: d.open,
          h: d.high,
          l: d.low,
          c: d.close,
        }))
        .sort((a, b) => a.x - b.x);

      setChartData(sorted);
    } catch (err) {
      console.error('[HTFChart] fetch error:', err);
      setChartData(null);
      setError('Failed to load chart');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChart(symbol, months);
  }, [symbol, months, fetchChart]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const config = useMemo(() => {
    if (!chartData || chartData.length === 0) return null;

    const annotations: Record<string, any> = {};

    const toTs = (d?: string | null) => (d ? new Date(d).getTime() : null);

    const surgeStartTs = toTs(pattern?.surge_start_date);
    const surgePeakTs = toTs(pattern?.surge_peak_date);
    const flagStartTs = toTs(pattern?.flag_start_date);
    const flagEndTs = toTs(pattern?.flag_end_date);

    // Surge pole: diagonal line from low at surge start → high at surge peak
    if (
      surgeStartTs && surgePeakTs &&
      pattern?.surge_low_price != null && pattern?.surge_high_price != null
    ) {
      annotations['surgePole'] = {
        type: 'line',
        xMin: surgeStartTs,
        xMax: surgePeakTs,
        yMin: pattern.surge_low_price,
        yMax: pattern.surge_high_price,
        borderColor: 'rgba(34, 197, 94, 0.85)',
        borderWidth: 3,
        borderDash: [],
        label: {
          display: true,
          content: `Pole +${(pattern.surge_pct * 100).toFixed(0)}%`,
          position: 'center',
          backgroundColor: 'rgba(34, 197, 94, 0.9)',
          color: '#000',
          font: { size: 10, weight: 'bold' },
        },
      };
    }

    // Flag box: rectangle from flag start → flag end, between flag_low and flag_high
    if (
      flagStartTs && flagEndTs &&
      pattern?.flag_high != null && pattern?.flag_low != null
    ) {
      annotations['flagBox'] = {
        type: 'box',
        xMin: flagStartTs,
        xMax: flagEndTs,
        yMin: pattern.flag_low,
        yMax: pattern.flag_high,
        backgroundColor: 'rgba(244, 63, 94, 0.10)',
        borderColor: 'rgba(244, 63, 94, 0.85)',
        borderWidth: 2,
        label: {
          display: true,
          content: pattern.flag_range_pct != null
            ? `Flag · ${(pattern.flag_range_pct * 100).toFixed(1)}%${pattern.flag_weeks ? ` · ${pattern.flag_weeks}w` : ''}`
            : 'Flag',
          position: { x: 'center', y: 'start' },
          backgroundColor: 'rgba(244, 63, 94, 0.9)',
          color: '#fff',
          font: { size: 10, weight: 'bold' },
          yAdjust: -6,
        },
      };

      // Breakout level (flag high) — horizontal dashed line that extends past the flag
      annotations['flagHigh'] = {
        type: 'line',
        yMin: pattern.flag_high,
        yMax: pattern.flag_high,
        borderColor: 'rgba(244, 63, 94, 0.7)',
        borderWidth: 1.5,
        borderDash: [6, 4],
        label: {
          display: true,
          content: `Breakout $${pattern.flag_high.toFixed(2)}`,
          position: 'end',
          backgroundColor: 'rgba(244, 63, 94, 0.85)',
          color: '#fff',
          font: { size: 10, weight: 'bold' },
        },
      };
    }

    // Current price reference
    if (currentPrice) {
      annotations['currentPrice'] = {
        type: 'line',
        yMin: currentPrice,
        yMax: currentPrice,
        borderColor: 'rgba(251, 191, 36, 0.85)',
        borderWidth: 1.5,
        label: {
          display: true,
          content: `Now $${currentPrice.toFixed(2)}`,
          position: 'start',
          backgroundColor: 'rgba(251, 191, 36, 0.9)',
          color: '#000',
          font: { size: 10, weight: 'bold' },
        },
      };
    }

    // Trim view to last `months` months but keep dataset full so annotations anchor correctly
    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    const xMin = Math.min(cutoff, surgeStartTs ?? cutoff);

    return {
      data: {
        datasets: [
          {
            label: symbol,
            data: chartData,
            color: {
              up: 'rgba(34, 197, 94, 1)',
              down: 'rgba(239, 68, 68, 1)',
              unchanged: 'rgba(156, 163, 175, 1)',
            },
            borderColor: {
              up: 'rgba(34, 197, 94, 1)',
              down: 'rgba(239, 68, 68, 1)',
              unchanged: 'rgba(156, 163, 175, 1)',
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const d = ctx.raw;
                return [
                  `O: $${d.o?.toFixed(2)}`,
                  `H: $${d.h?.toFixed(2)}`,
                  `L: $${d.l?.toFixed(2)}`,
                  `C: $${d.c?.toFixed(2)}`,
                ];
              },
            },
          },
          annotation: { annotations },
        },
        scales: {
          x: {
            type: 'time',
            min: xMin,
            time: { unit: 'week', displayFormats: { week: 'MMM dd' } },
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#9ca3af', maxTicksLimit: 10 },
          },
          y: {
            position: 'right',
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#9ca3af',
              callback: (v: any) => `$${Number(v).toFixed(2)}`,
            },
          },
        },
      },
    };
  }, [chartData, pattern, currentPrice, months, symbol]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl bg-gray-950 border border-rose-500/25 rounded-2xl shadow-2xl shadow-rose-500/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r from-rose-500/10 to-transparent">
          <div>
            <h2 className="text-lg font-black text-rose-300">
              {symbol}
              <span className="text-gray-400 font-normal text-sm ml-2">{companyName}</span>
            </h2>
            <p className="text-[11px] text-rose-400/60 mt-0.5">HTF Pattern · Pole + Flag visualization</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Period selector */}
            <div className="flex gap-1">
              {([3, 6, 9, 12] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    months === m
                      ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30'
                      : 'bg-black/50 text-gray-400 hover:bg-white/10 border border-white/[0.06]'
                  }`}
                >
                  {m}M
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Pattern stats */}
        {pattern && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-5 py-3 bg-black/30 border-b border-white/[0.04] text-[11px]">
            <div>
              <div className="text-gray-500 uppercase tracking-wider">Surge</div>
              <div className="text-emerald-300 font-data font-bold">+{(pattern.surge_pct * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-gray-500 uppercase tracking-wider">Flag Range</div>
              <div className="text-rose-300 font-data font-bold">
                {pattern.flag_range_pct != null ? `${(pattern.flag_range_pct * 100).toFixed(1)}%` : '–'}
                {pattern.flag_weeks ? <span className="text-gray-500 font-normal"> · {pattern.flag_weeks}w</span> : null}
              </div>
            </div>
            <div>
              <div className="text-gray-500 uppercase tracking-wider">ML Prob</div>
              <div className="text-cyan-300 font-data font-bold">{(pattern.ml_probability * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-gray-500 uppercase tracking-wider">Breakout</div>
              <div className={`font-bold ${
                pattern.breakout_status === 'confirmed' ? 'text-emerald-300' :
                pattern.breakout_status === 'approaching' ? 'text-yellow-300' :
                'text-gray-400'
              }`}>{pattern.breakout_status}</div>
            </div>
          </div>
        )}

        {/* Chart body */}
        <div className="p-5">
          {loading ? (
            <div className="h-[520px] flex items-center justify-center">
              <div className="text-gray-500 text-sm animate-pulse">Loading chart...</div>
            </div>
          ) : error ? (
            <div className="h-[520px] flex items-center justify-center">
              <div className="text-rose-400 text-sm">{error}</div>
            </div>
          ) : config ? (
            <div className="h-[520px]">
              <Chart
                type="candlestick"
                data={config.data as any}
                options={config.options as any}
              />
            </div>
          ) : (
            <div className="h-[520px] flex items-center justify-center">
              <div className="text-gray-600 text-sm">No chart data available</div>
            </div>
          )}

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-emerald-500" /> Pole (surge)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border border-rose-500 bg-rose-500/20" /> Flag (consolidation)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 border-t border-dashed border-rose-500" /> Breakout level
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-amber-400" /> Current price
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
