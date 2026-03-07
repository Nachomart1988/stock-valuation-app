// src/app/components/tabs/OptionSentimentTab.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
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
} from 'chart.js';
import { Bar, Scatter, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, BarElement,
  Title, Tooltip, Legend, Filler,
);

interface ChainData {
  expirations: string[];
  allExpirations?: string[];
  calls: Record<string, any[]>;
  puts: Record<string, any[]>;
}

interface GreeksAgg {
  expiration: string;
  netDelta: number;
  netGamma: number;
  netVega: number;
  netTheta: number;
  callOI: number;
  putOI: number;
  callVol: number;
  putVol: number;
}

interface Anomaly {
  strike: number;
  expiration: string;
  type: string;
  metric: string;
  value: number;
  zScore: number;
  description: string;
}

interface HistoricalIV {
  atmIV: number;
  realizedVol7d: number;
  realizedVol30d: number;
  ivRank: number;
  ivPercentile: number;
}

interface BiasScore {
  score: number;
  label: string;
  components: {
    pcrComponent: number;
    deltaComponent: number;
    skewComponent: number;
    anomalyComponent: number;
  };
}

interface Insight {
  type: string;
  severity: string;
  message: string;
}

interface SentimentData {
  ticker: string;
  currentPrice: number;
  greeksAggregation: GreeksAgg[];
  anomalies: Anomaly[];
  historicalIV: HistoricalIV;
  biasScore: BiasScore;
  insights: Insight[];
  pcrOI: number;
  pcrVolume: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallVol: number;
  totalPutVol: number;
}

interface IVSurfaceData {
  ticker: string;
  currentPrice: number;
  strikes: number[];
  expirations: string[];
  daysToExpiry: number[];
  callIV: number[][];
  putIV: number[][];
}

interface OptionSentimentTabProps {
  ticker: string;
  currentPrice: number;
  chainData: ChainData | null;
}

export default function OptionSentimentTab({ ticker, currentPrice, chainData }: OptionSentimentTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [ivSurface, setIVSurface] = useState<IVSurfaceData | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const fetchSentiment = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sentimentRes, ivRes] = await Promise.all([
        fetch(`${backendUrl}/options/sentiment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        }),
        fetch(`${backendUrl}/options/iv-surface`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        }),
      ]);

      if (!sentimentRes.ok) throw new Error(`Sentiment: ${sentimentRes.statusText}`);
      if (!ivRes.ok) throw new Error(`IV Surface: ${ivRes.statusText}`);

      const sentimentData = await sentimentRes.json();
      const ivData = await ivRes.json();

      if (sentimentData.error) throw new Error(sentimentData.error);
      setSentiment(sentimentData);
      if (!ivData.error) setIVSurface(ivData);
    } catch (err: any) {
      setError(err.message || 'Error fetching sentiment data');
    } finally {
      setLoading(false);
    }
  }, [ticker, backendUrl]);

  // ── IV vs Moneyness scatter ──
  const ivMoneyness = useMemo(() => {
    const chain = chainData;
    if (!chain) return null;

    const points: { x: number; y: number; type: string }[] = [];
    for (const exp of chain.expirations.slice(0, 3)) {
      const calls = chain.calls?.[exp] || [];
      const puts = chain.puts?.[exp] || [];

      for (const c of calls) {
        if (c.iv > 0.001 && c.strike > 0) {
          const moneyness = c.strike / currentPrice;
          if (moneyness > 0.7 && moneyness < 1.5) {
            points.push({ x: moneyness, y: c.iv * 100, type: 'call' });
          }
        }
      }
      for (const p of puts) {
        if (p.iv > 0.001 && p.strike > 0) {
          const moneyness = p.strike / currentPrice;
          if (moneyness > 0.7 && moneyness < 1.5) {
            points.push({ x: moneyness, y: p.iv * 100, type: 'put' });
          }
        }
      }
    }

    return {
      datasets: [
        {
          label: 'Call IV',
          data: points.filter(p => p.type === 'call').map(p => ({ x: p.x, y: p.y })),
          backgroundColor: 'rgba(16,185,129,0.6)',
          borderColor: 'rgba(16,185,129,0.8)',
          pointRadius: 3,
        },
        {
          label: 'Put IV',
          data: points.filter(p => p.type === 'put').map(p => ({ x: p.x, y: p.y })),
          backgroundColor: 'rgba(239,68,68,0.6)',
          borderColor: 'rgba(239,68,68,0.8)',
          pointRadius: 3,
        },
      ],
    };
  }, [chainData, currentPrice]);

  // ── PCR data (from chain) ──
  const pcrData = useMemo(() => {
    const chain = chainData;
    if (!chain) return null;

    const rows: { exp: string; pcrOI: number; pcrVol: number; callOI: number; putOI: number }[] = [];
    for (const exp of chain.expirations) {
      const calls = chain.calls?.[exp] || [];
      const puts = chain.puts?.[exp] || [];
      const callOI = calls.reduce((s: number, c: any) => s + (c.openInterest || 0), 0);
      const putOI = puts.reduce((s: number, p: any) => s + (p.openInterest || 0), 0);
      const callVol = calls.reduce((s: number, c: any) => s + (c.volume || 0), 0);
      const putVol = puts.reduce((s: number, p: any) => s + (p.volume || 0), 0);
      rows.push({
        exp,
        pcrOI: callOI > 0 ? putOI / callOI : 0,
        pcrVol: callVol > 0 ? putVol / callVol : 0,
        callOI,
        putOI,
      });
    }
    return rows;
  }, [chainData]);

  // ── Bias gauge SVG ──
  const BiasGauge = ({ score, label }: { score: number; label: string }) => {
    // score: -5 to +5 → angle: 180° to 0°
    const angle = 180 - ((score + 5) / 10) * 180;
    const rad = (angle * Math.PI) / 180;
    const cx = 150, cy = 130, r = 100;
    const nx = cx + r * 0.85 * Math.cos(rad);
    const ny = cy - r * 0.85 * Math.sin(rad);

    const color =
      score > 2 ? '#10b981' :
      score > 0.5 ? '#34d399' :
      score > -0.5 ? '#fbbf24' :
      score > -2 ? '#f87171' :
      '#ef4444';

    return (
      <svg viewBox="0 0 300 160" className="w-full max-w-[300px] mx-auto">
        {/* Background arc */}
        <path d="M 30 130 A 120 120 0 0 1 270 130" fill="none" stroke="#333" strokeWidth="18" strokeLinecap="round" />
        {/* Gradient segments */}
        <path d="M 30 130 A 120 120 0 0 1 90 42" fill="none" stroke="#ef4444" strokeWidth="16" strokeLinecap="round" />
        <path d="M 90 42 A 120 120 0 0 1 150 10" fill="none" stroke="#f87171" strokeWidth="16" />
        <path d="M 150 10 A 120 120 0 0 1 210 42" fill="none" stroke="#fbbf24" strokeWidth="16" />
        <path d="M 210 42 A 120 120 0 0 1 270 130" fill="none" stroke="#10b981" strokeWidth="16" strokeLinecap="round" />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={color} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill={color} />
        {/* Labels */}
        <text x={30} y={155} fill="#888" fontSize="10" textAnchor="middle">-5</text>
        <text x={150} y={8} fill="#888" fontSize="10" textAnchor="middle">0</text>
        <text x={270} y={155} fill="#888" fontSize="10" textAnchor="middle">+5</text>
        <text x={150} y={145} fill={color} fontSize="16" fontWeight="bold" textAnchor="middle">{score.toFixed(1)}</text>
        <text x={150} y={160} fill="#aaa" fontSize="11" textAnchor="middle">{label}</text>
      </svg>
    );
  };

  // ── IV Surface Heatmap ──
  const IVHeatmap = ({ data }: { data: IVSurfaceData }) => {
    const matrix = data.callIV;
    if (!matrix.length || !data.strikes.length) return null;

    // Find min/max IV for color scaling
    let minIV = Infinity, maxIV = -Infinity;
    for (const row of matrix) {
      for (const v of row) {
        if (v > 0.001) {
          minIV = Math.min(minIV, v);
          maxIV = Math.max(maxIV, v);
        }
      }
    }
    if (minIV === Infinity) return null;

    const ivToColor = (iv: number) => {
      if (iv < 0.001) return '#111';
      const t = (iv - minIV) / (maxIV - minIV + 0.001);
      // Blue → Green → Yellow → Red
      if (t < 0.33) {
        const s = t / 0.33;
        return `rgb(${Math.round(20 + s * 30)}, ${Math.round(60 + s * 140)}, ${Math.round(180 - s * 80)})`;
      } else if (t < 0.66) {
        const s = (t - 0.33) / 0.33;
        return `rgb(${Math.round(50 + s * 205)}, ${Math.round(200 - s * 30)}, ${Math.round(100 - s * 60)})`;
      } else {
        const s = (t - 0.66) / 0.34;
        return `rgb(${Math.round(255)}, ${Math.round(170 - s * 120)}, ${Math.round(40 - s * 40)})`;
      }
    };

    // Subsample strikes for display
    const maxCols = 25;
    const step = Math.max(1, Math.floor(data.strikes.length / maxCols));
    const sampledIdx = Array.from({ length: Math.min(maxCols, data.strikes.length) }, (_, i) => i * step);

    return (
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="flex mb-1">
            <div className="w-20 shrink-0" />
            {sampledIdx.map(si => (
              <div key={si} className="flex-1 text-[9px] text-gray-500 text-center min-w-[28px]">
                ${data.strikes[si]?.toFixed(0)}
              </div>
            ))}
          </div>
          {matrix.map((row, ri) => (
            <div key={ri} className="flex items-center">
              <div className="w-20 shrink-0 text-[10px] text-gray-400 pr-1 text-right">
                {data.expirations[ri]} ({data.daysToExpiry[ri]}d)
              </div>
              {sampledIdx.map(si => (
                <div
                  key={si}
                  className="flex-1 min-w-[28px] h-6 border border-black/30"
                  style={{ backgroundColor: ivToColor(row[si] || 0) }}
                  title={`Strike: $${data.strikes[si]?.toFixed(0)} | IV: ${((row[si] || 0) * 100).toFixed(1)}%`}
                />
              ))}
            </div>
          ))}
          <div className="flex items-center mt-2 justify-center gap-2 text-[10px] text-gray-400">
            <span>{es ? 'Baja IV' : 'Low IV'}</span>
            <div className="flex">
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map(t => (
                <div key={t} className="w-6 h-3" style={{ backgroundColor: ivToColor(minIV + t * (maxIV - minIV)) }} />
              ))}
            </div>
            <span>{es ? 'Alta IV' : 'High IV'}</span>
          </div>
        </div>
      </div>
    );
  };

  const severityIcon = (s: string) =>
    s === 'alert' ? '🔴' : s === 'warning' ? '🟠' : '🟢';

  const severityBorder = (s: string) =>
    s === 'alert' ? 'border-red-500/40' : s === 'warning' ? 'border-amber-500/40' : 'border-emerald-500/30';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-bold text-amber-400">
          {es ? 'Sentimiento de Opciones' : 'Options Sentiment'} — {ticker}
        </h4>
        <button
          onClick={fetchSentiment}
          disabled={loading}
          className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm"
        >
          {loading
            ? (es ? 'Analizando... (10-15 seg)' : 'Analyzing... (10-15 sec)')
            : (es ? 'Analizar Sentimiento' : 'Analyze Sentiment')}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      {/* ── Section 1: IV vs Moneyness (from chain data, no backend needed) ── */}
      {chainData && ivMoneyness && ivMoneyness.datasets[0].data.length > 0 && (
        <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
          <h5 className="text-sm font-semibold text-gray-300 mb-3">
            {es ? 'IV vs Moneyness (Smile de Volatilidad)' : 'IV vs Moneyness (Volatility Smile)'}
          </h5>
          <div className="h-64">
            <Scatter
              data={ivMoneyness}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    title: { display: true, text: es ? 'Moneyness (Strike/Precio)' : 'Moneyness (Strike/Price)', color: '#888' },
                    ticks: { color: '#888' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                  },
                  y: {
                    title: { display: true, text: 'IV (%)', color: '#888' },
                    ticks: { color: '#888' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                  },
                },
                plugins: {
                  legend: { labels: { color: '#ccc' } },
                  tooltip: {
                    callbacks: {
                      label: (ctx: any) => `Moneyness: ${ctx.raw.x.toFixed(3)} | IV: ${ctx.raw.y.toFixed(1)}%`,
                    },
                  },
                },
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            {es
              ? 'Moneyness = Strike/Precio. 1.0 = ATM. <1 = ITM calls/OTM puts. >1 = OTM calls/ITM puts.'
              : 'Moneyness = Strike/Price. 1.0 = ATM. <1 = ITM calls/OTM puts. >1 = OTM calls/ITM puts.'}
          </p>
        </div>
      )}

      {/* ── Section 2: PCR by Expiration (from chain data) ── */}
      {pcrData && pcrData.length > 0 && (
        <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
          <h5 className="text-sm font-semibold text-gray-300 mb-3">
            Put/Call Ratio {es ? 'por Vencimiento' : 'by Expiration'}
          </h5>
          <div className="h-52">
            <Bar
              data={{
                labels: pcrData.map(r => r.exp),
                datasets: [
                  {
                    label: 'PCR (OI)',
                    data: pcrData.map(r => r.pcrOI),
                    backgroundColor: 'rgba(245,158,11,0.6)',
                    borderColor: 'rgba(245,158,11,0.9)',
                    borderWidth: 1,
                  },
                  {
                    label: 'PCR (Volume)',
                    data: pcrData.map(r => r.pcrVol),
                    backgroundColor: 'rgba(139,92,246,0.6)',
                    borderColor: 'rgba(139,92,246,0.9)',
                    borderWidth: 1,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                  y: {
                    ticks: { color: '#888' },
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    title: { display: true, text: 'P/C Ratio', color: '#888' },
                  },
                },
                plugins: {
                  legend: { labels: { color: '#ccc', font: { size: 11 } } },
                  annotation: {
                    annotations: {
                      neutral: {
                        type: 'line' as const,
                        yMin: 1.0,
                        yMax: 1.0,
                        borderColor: 'rgba(255,255,255,0.3)',
                        borderDash: [4, 4],
                        borderWidth: 1,
                        label: { display: true, content: 'Neutral (1.0)', color: '#888', font: { size: 9 } },
                      },
                    },
                  } as any,
                },
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            {es
              ? 'PCR > 1.2 = sentimiento bajista. PCR < 0.7 = sentimiento alcista.'
              : 'PCR > 1.2 = bearish sentiment. PCR < 0.7 = bullish sentiment.'}
          </p>
        </div>
      )}

      {/* ── Sections requiring backend data ── */}
      {sentiment && (
        <>
          {/* ── Section 3: Bias Score Gauge ── */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
            <h5 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Puntuacion de Sesgo' : 'Sentiment Bias Score'}
            </h5>
            <BiasGauge score={sentiment.biasScore.score} label={sentiment.biasScore.label} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {[
                { label: 'PCR', value: sentiment.biasScore.components.pcrComponent },
                { label: 'Delta', value: sentiment.biasScore.components.deltaComponent },
                { label: 'Skew', value: sentiment.biasScore.components.skewComponent },
                { label: es ? 'Anomalias' : 'Anomalies', value: sentiment.biasScore.components.anomalyComponent },
              ].map(c => (
                <div key={c.label} className="bg-black/30 rounded-lg p-2 text-center">
                  <div className="text-[10px] text-gray-500">{c.label}</div>
                  <div className={`text-sm font-bold ${c.value > 0 ? 'text-green-400' : c.value < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    {c.value > 0 ? '+' : ''}{c.value.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section 4: Key Metrics Summary ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { label: 'PCR (OI)', value: sentiment.pcrOI.toFixed(2), color: sentiment.pcrOI > 1.2 ? 'text-red-400' : sentiment.pcrOI < 0.7 ? 'text-green-400' : 'text-amber-400' },
              { label: 'PCR (Vol)', value: sentiment.pcrVolume.toFixed(2), color: sentiment.pcrVolume > 1.2 ? 'text-red-400' : sentiment.pcrVolume < 0.7 ? 'text-green-400' : 'text-amber-400' },
              { label: 'ATM IV', value: `${(sentiment.historicalIV.atmIV * 100).toFixed(1)}%`, color: 'text-purple-400' },
              { label: es ? 'Vol Real 7d' : 'RV 7d', value: `${(sentiment.historicalIV.realizedVol7d * 100).toFixed(1)}%`, color: 'text-blue-400' },
              { label: 'IV Rank', value: `${(sentiment.historicalIV.ivRank * 100).toFixed(0)}%`, color: sentiment.historicalIV.ivRank > 0.7 ? 'text-red-400' : sentiment.historicalIV.ivRank < 0.3 ? 'text-green-400' : 'text-amber-400' },
              { label: es ? 'Anomalias' : 'Anomalies', value: `${sentiment.anomalies.length}`, color: sentiment.anomalies.length > 5 ? 'text-red-400' : 'text-gray-300' },
            ].map(m => (
              <div key={m.label} className="bg-black/40 border border-gray-700/50 rounded-xl p-3 text-center">
                <div className="text-[10px] text-gray-500 mb-1">{m.label}</div>
                <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* ── Section 5: Historical IV Comparison ── */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
            <h5 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Volatilidad: Implicita vs Realizada' : 'Volatility: Implied vs Realized'}
            </h5>
            <div className="h-48">
              <Bar
                data={{
                  labels: [
                    'ATM IV',
                    es ? 'Vol Realizada 7d' : 'Realized Vol 7d',
                    es ? 'Vol Realizada 30d' : 'Realized Vol 30d',
                  ],
                  datasets: [{
                    label: es ? 'Volatilidad Anualizada' : 'Annualized Volatility',
                    data: [
                      sentiment.historicalIV.atmIV * 100,
                      sentiment.historicalIV.realizedVol7d * 100,
                      sentiment.historicalIV.realizedVol30d * 100,
                    ],
                    backgroundColor: [
                      'rgba(168,85,247,0.7)',
                      'rgba(59,130,246,0.7)',
                      'rgba(16,185,129,0.7)',
                    ],
                    borderColor: [
                      'rgba(168,85,247,1)',
                      'rgba(59,130,246,1)',
                      'rgba(16,185,129,1)',
                    ],
                    borderWidth: 1,
                    borderRadius: 6,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: 'y',
                  scales: {
                    x: { ticks: { color: '#888', callback: (v: any) => `${v}%` }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#ccc', font: { size: 11 } }, grid: { display: false } },
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx: any) => `${ctx.raw.toFixed(1)}%` } },
                  },
                }}
              />
            </div>
            <div className="flex gap-4 mt-3 text-xs">
              <div className="bg-black/30 rounded-lg px-3 py-2 flex-1 text-center">
                <div className="text-gray-500 mb-1">IV Rank</div>
                <div className="text-lg font-bold text-amber-400">{(sentiment.historicalIV.ivRank * 100).toFixed(0)}%</div>
              </div>
              <div className="bg-black/30 rounded-lg px-3 py-2 flex-1 text-center">
                <div className="text-gray-500 mb-1">IV Percentile</div>
                <div className="text-lg font-bold text-purple-400">{(sentiment.historicalIV.ivPercentile * 100).toFixed(0)}%</div>
              </div>
              <div className="bg-black/30 rounded-lg px-3 py-2 flex-1 text-center">
                <div className="text-gray-500 mb-1">{es ? 'Prima IV' : 'IV Premium'}</div>
                <div className={`text-lg font-bold ${
                  sentiment.historicalIV.atmIV > sentiment.historicalIV.realizedVol30d ? 'text-red-400' : 'text-green-400'
                }`}>
                  {sentiment.historicalIV.realizedVol30d > 0
                    ? `${(((sentiment.historicalIV.atmIV / sentiment.historicalIV.realizedVol30d) - 1) * 100).toFixed(0)}%`
                    : 'N/A'}
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 6: Greeks Aggregation ── */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
            <h5 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Greeks Agregados por Vencimiento' : 'Aggregated Greeks by Expiration'}
            </h5>
            <div className="h-56">
              <Bar
                data={{
                  labels: sentiment.greeksAggregation.map(g => g.expiration),
                  datasets: [
                    {
                      label: 'Net Delta',
                      data: sentiment.greeksAggregation.map(g => g.netDelta),
                      backgroundColor: 'rgba(16,185,129,0.7)',
                      borderColor: 'rgba(16,185,129,1)',
                      borderWidth: 1,
                    },
                    {
                      label: 'Net Vega',
                      data: sentiment.greeksAggregation.map(g => g.netVega),
                      backgroundColor: 'rgba(168,85,247,0.7)',
                      borderColor: 'rgba(168,85,247,1)',
                      borderWidth: 1,
                    },
                    {
                      label: 'Net Theta',
                      data: sentiment.greeksAggregation.map(g => g.netTheta),
                      backgroundColor: 'rgba(239,68,68,0.7)',
                      borderColor: 'rgba(239,68,68,1)',
                      borderWidth: 1,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                  },
                  plugins: {
                    legend: { labels: { color: '#ccc', font: { size: 11 } } },
                  },
                }}
              />
            </div>
            {/* OI/Volume table */}
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700/50">
                    <th className="text-left py-1 px-2">{es ? 'Vencimiento' : 'Expiration'}</th>
                    <th className="text-right py-1 px-2">Call OI</th>
                    <th className="text-right py-1 px-2">Put OI</th>
                    <th className="text-right py-1 px-2">Call Vol</th>
                    <th className="text-right py-1 px-2">Put Vol</th>
                    <th className="text-right py-1 px-2">Net Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {sentiment.greeksAggregation.map(g => (
                    <tr key={g.expiration} className="border-b border-gray-800/50 text-gray-300">
                      <td className="py-1 px-2 text-amber-400 font-mono">{g.expiration}</td>
                      <td className="text-right py-1 px-2">{g.callOI.toLocaleString()}</td>
                      <td className="text-right py-1 px-2">{g.putOI.toLocaleString()}</td>
                      <td className="text-right py-1 px-2">{g.callVol.toLocaleString()}</td>
                      <td className="text-right py-1 px-2">{g.putVol.toLocaleString()}</td>
                      <td className={`text-right py-1 px-2 font-semibold ${g.netDelta > 0 ? 'text-green-400' : g.netDelta < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        {g.netDelta > 0 ? '+' : ''}{g.netDelta.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 7: IV Surface Heatmap ── */}
          {ivSurface && !ivSurface.callIV?.every(row => row.every(v => v === 0)) && (
            <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
              <h5 className="text-sm font-semibold text-gray-300 mb-3">
                {es ? 'Superficie de Volatilidad (Call IV)' : 'Volatility Surface (Call IV)'}
              </h5>
              <IVHeatmap data={ivSurface} />
            </div>
          )}

          {/* ── Section 8: Anomaly Detection ── */}
          {sentiment.anomalies.length > 0 && (
            <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
              <h5 className="text-sm font-semibold text-gray-300 mb-3">
                {es ? 'Deteccion de Anomalias' : 'Anomaly Detection'}
                <span className="ml-2 text-xs text-amber-400/80">({sentiment.anomalies.length})</span>
              </h5>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/50">
                      <th className="text-left py-1 px-2">Strike</th>
                      <th className="text-left py-1 px-2">{es ? 'Venc.' : 'Exp.'}</th>
                      <th className="text-left py-1 px-2">{es ? 'Tipo' : 'Type'}</th>
                      <th className="text-left py-1 px-2">{es ? 'Metrica' : 'Metric'}</th>
                      <th className="text-right py-1 px-2">{es ? 'Valor' : 'Value'}</th>
                      <th className="text-right py-1 px-2">Z-Score</th>
                      <th className="text-left py-1 px-2">{es ? 'Descripcion' : 'Description'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sentiment.anomalies.map((a, i) => (
                      <tr key={i} className="border-b border-gray-800/50">
                        <td className="py-1 px-2 text-amber-400 font-mono">${a.strike.toFixed(0)}</td>
                        <td className="py-1 px-2 text-gray-400">{a.expiration}</td>
                        <td className={`py-1 px-2 font-semibold ${a.type === 'call' ? 'text-green-400' : 'text-red-400'}`}>
                          {a.type.toUpperCase()}
                        </td>
                        <td className="py-1 px-2 text-gray-300">{a.metric.replace('_', ' ')}</td>
                        <td className="text-right py-1 px-2 text-gray-200">{typeof a.value === 'number' ? a.value.toLocaleString() : a.value}</td>
                        <td className="text-right py-1 px-2 text-purple-400 font-semibold">{a.zScore.toFixed(1)}σ</td>
                        <td className="py-1 px-2 text-gray-400 text-[11px]">{a.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Section 9: Insights ── */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
            <h5 className="text-sm font-semibold text-gray-300 mb-3">
              {es ? 'Insights del Mercado de Opciones' : 'Options Market Insights'}
            </h5>
            <div className="space-y-2">
              {sentiment.insights.map((ins, i) => (
                <div key={i} className={`p-3 rounded-lg border bg-black/30 ${severityBorder(ins.severity)}`}>
                  <span className="mr-2">{severityIcon(ins.severity)}</span>
                  <span className="text-sm text-gray-200">{ins.message}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !sentiment && !chainData && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-sm">
            {es
              ? 'Carga la cadena de opciones primero, luego analiza el sentimiento.'
              : 'Load the options chain first, then analyze sentiment.'}
          </p>
        </div>
      )}

      {!loading && !sentiment && chainData && (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">
            {es
              ? 'Presiona "Analizar Sentimiento" para obtener el analisis completo del backend.'
              : 'Press "Analyze Sentiment" to get the full backend analysis.'}
          </p>
        </div>
      )}
    </div>
  );
}
