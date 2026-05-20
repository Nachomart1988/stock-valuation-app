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

interface StockChartModalProps {
  symbol: string;
  companyName: string;
  currentPrice: number;
  /** Optional one-line context shown under the title (e.g. "Episodic Pivot · 2024-03-15") */
  subtitle?: string;
  /** Optional date marker line (e.g. breakout/bounce/squeeze trigger date as YYYY-MM-DD or ISO) */
  markerDate?: string | null;
  markerLabel?: string;
  onClose: () => void;
}

type Months = 3 | 6 | 9 | 12;

export default function StockChartModal({
  symbol,
  companyName,
  currentPrice,
  subtitle,
  markerDate,
  markerLabel,
  onClose,
}: StockChartModalProps) {
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
      console.error('[StockChart] fetch error:', err);
      setChartData(null);
      setError('Failed to load chart');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChart(symbol, months);
  }, [symbol, months, fetchChart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const config = useMemo(() => {
    if (!chartData || chartData.length === 0) return null;

    const annotations: Record<string, any> = {};

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

    if (markerDate) {
      const ts = new Date(markerDate).getTime();
      if (!Number.isNaN(ts)) {
        annotations['marker'] = {
          type: 'line',
          xMin: ts,
          xMax: ts,
          borderColor: 'rgba(34, 211, 238, 0.75)',
          borderWidth: 1.5,
          borderDash: [4, 4],
          label: {
            display: true,
            content: markerLabel || 'Signal',
            position: 'start',
            backgroundColor: 'rgba(34, 211, 238, 0.9)',
            color: '#000',
            font: { size: 10, weight: 'bold' },
          },
        };
      }
    }

    const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;
    const markerTs = markerDate ? new Date(markerDate).getTime() : null;
    const xMin = markerTs && !Number.isNaN(markerTs) ? Math.min(cutoff, markerTs) : cutoff;

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
  }, [chartData, currentPrice, months, symbol, markerDate, markerLabel]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl bg-gray-950 border border-emerald-500/25 rounded-2xl shadow-2xl shadow-emerald-500/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r from-emerald-500/10 to-transparent">
          <div>
            <h2 className="text-lg font-black text-emerald-300">
              {symbol}
              <span className="text-gray-400 font-normal text-sm ml-2">{companyName}</span>
            </h2>
            {subtitle ? (
              <p className="text-[11px] text-emerald-400/60 mt-0.5">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {([3, 6, 9, 12] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    months === m
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
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

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-amber-400" /> Current price
            </span>
            {markerDate ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 border-t border-dashed border-cyan-400" /> {markerLabel || 'Signal date'}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
