'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import zoomPlugin from 'chartjs-plugin-zoom';
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
  zoomPlugin,
  CandlestickController,
  CandlestickElement,
  OhlcElement
);

type Interval = 'daily' | '5min' | '1min';

export interface TradeChartInfo {
  symbol: string;
  name?: string;
  side: 'Long' | 'Short';
  entryPrice: number;
  entryDate: string;            // YYYY-MM-DD
  exitPrice?: number | null;
  exitDate?: string | null;     // YYYY-MM-DD
  sl?: number | null;
  pt1?: number | null;
}

interface Props {
  trade: TradeChartInfo;
  onClose: () => void;
}

type Bar = { x: number; o: number; h: number; l: number; c: number };

const dayMs = 24 * 60 * 60 * 1000;

export default function TradeChartModal({ trade, onClose }: Props) {
  const [interval, setInterval] = useState<Interval>('daily');
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChart = useCallback(async (iv: Interval) => {
    setLoading(true);
    setError(null);
    setBars(null);
    try {
      const entryTs = new Date(trade.entryDate).getTime();
      const exitTs = trade.exitDate ? new Date(trade.exitDate).getTime() : Date.now();

      let raw: any[];
      if (iv === 'daily') {
        // Margen de contexto: ~30 días antes de la entrada, ~10 días después de la salida
        const from = new Date(entryTs - 30 * dayMs).toISOString().split('T')[0];
        const to = new Date(exitTs + 10 * dayMs).toISOString().split('T')[0];
        raw = await fetchFmp('stable/historical-price-eod/full', { symbol: trade.symbol, from, to });
      } else {
        // Intradía: desde el día de entrada hasta el de salida (FMP 1min sólo cubre días recientes)
        const from = new Date(entryTs - dayMs).toISOString().split('T')[0];
        const to = new Date(exitTs + dayMs).toISOString().split('T')[0];
        raw = await fetchFmp(`stable/historical-chart/${iv}`, { symbol: trade.symbol, from, to });
      }

      if (!Array.isArray(raw) || raw.length === 0) {
        setError(iv === 'daily'
          ? 'No hay datos de precio para este rango'
          : `Sin datos intradía ${iv} (FMP sólo guarda los días más recientes)`);
        return;
      }

      const sorted: Bar[] = raw
        .map((d: any) => ({
          x: new Date(d.date).getTime(),
          o: d.open, h: d.high, l: d.low, c: d.close,
        }))
        .filter(b => !Number.isNaN(b.x) && b.o != null)
        .sort((a, b) => a.x - b.x);

      setBars(sorted);
    } catch (err) {
      console.error('[TradeChart] fetch error:', err);
      setError('Error al cargar el gráfico');
    } finally {
      setLoading(false);
    }
  }, [trade.symbol, trade.entryDate, trade.exitDate]);

  useEffect(() => { fetchChart(interval); }, [interval, fetchChart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const config = useMemo(() => {
    if (!bars || bars.length === 0) return null;

    const entryTs = new Date(trade.entryDate).getTime();
    const exitTs = trade.exitDate ? new Date(trade.exitDate).getTime() : null;
    const closed = trade.exitPrice != null && trade.exitDate != null;
    const win = closed
      ? (trade.side === 'Long'
          ? (trade.exitPrice as number) >= trade.entryPrice
          : (trade.exitPrice as number) <= trade.entryPrice)
      : null;

    const annotations: Record<string, any> = {};

    // ── Líneas de precio ──
    annotations['entryPrice'] = {
      type: 'line',
      yMin: trade.entryPrice, yMax: trade.entryPrice,
      borderColor: 'rgba(16, 185, 129, 0.9)', borderWidth: 1.5,
      label: {
        display: true, content: `Entry $${trade.entryPrice.toFixed(2)}`, position: 'start',
        backgroundColor: 'rgba(16, 185, 129, 0.92)', color: '#000',
        font: { size: 10, weight: 'bold' },
      },
    };
    if (closed) {
      annotations['exitPrice'] = {
        type: 'line',
        yMin: trade.exitPrice as number, yMax: trade.exitPrice as number,
        borderColor: win ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)', borderWidth: 1.5,
        label: {
          display: true, content: `Exit $${(trade.exitPrice as number).toFixed(2)}`, position: 'end',
          backgroundColor: win ? 'rgba(34, 197, 94, 0.92)' : 'rgba(239, 68, 68, 0.92)', color: '#000',
          font: { size: 10, weight: 'bold' },
        },
      };
    }
    if (trade.sl) {
      annotations['sl'] = {
        type: 'line', yMin: trade.sl, yMax: trade.sl,
        borderColor: 'rgba(239, 68, 68, 0.5)', borderWidth: 1, borderDash: [3, 3],
        label: { display: true, content: `SL $${trade.sl.toFixed(2)}`, position: 'start',
          backgroundColor: 'rgba(239, 68, 68, 0.6)', color: '#fff', font: { size: 9 } },
      };
    }
    if (trade.pt1) {
      annotations['pt1'] = {
        type: 'line', yMin: trade.pt1, yMax: trade.pt1,
        borderColor: 'rgba(16, 185, 129, 0.4)', borderWidth: 1, borderDash: [3, 3],
        label: { display: true, content: `PT1 $${trade.pt1.toFixed(2)}`, position: 'end',
          backgroundColor: 'rgba(16, 185, 129, 0.55)', color: '#000', font: { size: 9 } },
      };
    }

    // ── Líneas verticales de fecha (entrada / salida) ──
    annotations['entryDate'] = {
      type: 'line', xMin: entryTs, xMax: entryTs,
      borderColor: 'rgba(16, 185, 129, 0.7)', borderWidth: 1.5, borderDash: [5, 4],
      label: { display: true, content: '▲ Entrada', position: 'start',
        backgroundColor: 'rgba(16, 185, 129, 0.85)', color: '#000', font: { size: 9, weight: 'bold' } },
    };
    if (exitTs) {
      annotations['exitDate'] = {
        type: 'line', xMin: exitTs, xMax: exitTs,
        borderColor: win ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)', borderWidth: 1.5, borderDash: [5, 4],
        label: { display: true, content: '▼ Salida', position: 'start',
          backgroundColor: win ? 'rgba(34, 197, 94, 0.85)' : 'rgba(239, 68, 68, 0.85)', color: '#000', font: { size: 9, weight: 'bold' } },
      };
      // Zona sombreada entre entrada y salida
      annotations['holdZone'] = {
        type: 'box', xMin: entryTs, xMax: exitTs,
        backgroundColor: win ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.06)',
        borderWidth: 0,
      };
    }

    // ── Flechas de operación estilo backtest (▲ compra / ▼ venta) ──
    // Long: entra comprando (▲) y sale vendiendo (▼). Short: al revés.
    const entryArrow = trade.side === 'Long' ? '▲' : '▼';
    const exitArrow = trade.side === 'Long' ? '▼' : '▲';
    annotations['entryArrowMark'] = {
      type: 'label', xValue: entryTs, yValue: trade.entryPrice,
      content: entryArrow,
      color: trade.side === 'Long' ? '#34d399' : '#f43f5e',
      font: { size: 18, weight: 'bold' },
      yAdjust: trade.side === 'Long' ? 18 : -18,  // por debajo si compra, por encima si vende
      backgroundColor: 'transparent',
    };
    if (closed) {
      annotations['exitArrowMark'] = {
        type: 'label', xValue: exitTs, yValue: trade.exitPrice as number,
        content: exitArrow,
        color: win ? '#34d399' : '#f43f5e',
        font: { size: 18, weight: 'bold' },
        yAdjust: trade.side === 'Long' ? -18 : 18,
        backgroundColor: 'transparent',
      };
    }

    const isDaily = interval === 'daily';

    return {
      data: {
        datasets: [{
          label: trade.symbol,
          data: bars,
          color: { up: 'rgba(34, 197, 94, 1)', down: 'rgba(239, 68, 68, 1)', unchanged: 'rgba(156, 163, 175, 1)' },
          borderColor: { up: 'rgba(34, 197, 94, 1)', down: 'rgba(239, 68, 68, 1)', unchanged: 'rgba(156, 163, 175, 1)' },
        }],
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
                return [`O: $${d.o?.toFixed(2)}`, `H: $${d.h?.toFixed(2)}`, `L: $${d.l?.toFixed(2)}`, `C: $${d.c?.toFixed(2)}`];
              },
            },
          },
          annotation: { annotations },
          zoom: {
            pan: { enabled: true, mode: 'xy', modifierKey: null },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              drag: { enabled: false },
              mode: 'xy',
            },
            limits: { y: { min: 'original', max: 'original' } },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: isDaily
              ? { unit: 'week', displayFormats: { week: 'MMM dd' } }
              : { unit: 'hour', displayFormats: { hour: 'MMM dd HH:mm' } },
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#9ca3af', maxTicksLimit: 10 },
          },
          y: {
            position: 'right',
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#9ca3af', callback: (v: any) => `$${Number(v).toFixed(2)}` },
          },
        },
      },
    };
  }, [bars, trade, interval]);

  const pnlPct = trade.exitPrice != null
    ? (trade.side === 'Long'
        ? (trade.exitPrice - trade.entryPrice) / trade.entryPrice
        : (trade.entryPrice - trade.exitPrice) / trade.entryPrice)
    : null;

  const chartRef = useRef<any>(null);
  const resetZoom = () => { chartRef.current?.resetZoom?.(); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-7xl bg-gray-950 border border-emerald-500/25 rounded-2xl shadow-2xl shadow-emerald-500/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.06] bg-gradient-to-r from-emerald-500/10 to-transparent">
          <div>
            <h2 className="text-lg font-black text-emerald-300">
              {trade.symbol}
              {trade.name ? <span className="text-gray-400 font-normal text-sm ml-2">{trade.name}</span> : null}
              <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded ${trade.side === 'Long' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                {trade.side}
              </span>
            </h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Entrada {trade.entryDate} @ ${trade.entryPrice.toFixed(2)}
              {trade.exitDate ? ` → Salida ${trade.exitDate} @ $${(trade.exitPrice as number).toFixed(2)}` : ' · posición abierta'}
              {pnlPct != null && (
                <span className={pnlPct >= 0 ? ' text-emerald-400' : ' text-rose-400'}>
                  {`  (${pnlPct >= 0 ? '+' : ''}${(pnlPct * 100).toFixed(2)}%)`}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex gap-1 rounded-lg border border-white/[0.06] bg-black/40 p-0.5">
              {(['daily', '5min', '1min'] as const).map((iv) => (
                <button
                  key={iv}
                  onClick={() => setInterval(iv)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                    interval === iv
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'
                      : 'text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {iv === 'daily' ? 'Diario' : iv === '5min' ? '5M' : '1M'}
                </button>
              ))}
            </div>
            <button
              onClick={resetZoom}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-black/50 text-gray-300 hover:bg-white/10 border border-white/[0.06] transition"
              title="Restablecer zoom"
            >
              🔍 Reset
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"
              aria-label="Cerrar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chart body */}
        <div className="p-3 sm:p-5">
          {loading ? (
            <div className="h-[72vh] flex items-center justify-center">
              <div className="text-gray-500 text-sm animate-pulse">Cargando gráfico {interval === 'daily' ? 'diario' : interval}…</div>
            </div>
          ) : error ? (
            <div className="h-[72vh] flex flex-col items-center justify-center gap-2">
              <div className="text-rose-400 text-sm">{error}</div>
              {interval !== 'daily' && (
                <button onClick={() => setInterval('daily')} className="text-xs text-emerald-400 hover:underline">
                  Ver gráfico diario →
                </button>
              )}
            </div>
          ) : config ? (
            <div className="h-[72vh]">
              <Chart ref={chartRef} type="candlestick" data={config.data as any} options={config.options as any} />
            </div>
          ) : (
            <div className="h-[72vh] flex items-center justify-center">
              <div className="text-gray-600 text-sm">Sin datos para mostrar</div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">▲▼</span> Flechas de entrada/salida</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-emerald-400" /> Entrada</span>
            {trade.exitDate && <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-rose-400" /> Salida</span>}
            {trade.sl ? <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 border-t border-dashed border-rose-400/60" /> Stop</span> : null}
            {trade.pt1 ? <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 border-t border-dashed border-emerald-400/60" /> PT1</span> : null}
            <span className="text-gray-500 ml-auto">🖱️ Rueda = zoom · arrastrar = mover · botón Reset</span>
          </div>
        </div>
      </div>
    </div>
  );
}
