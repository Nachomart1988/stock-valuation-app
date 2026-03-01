'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Logo from '../components/Logo';
import Header from '../components/Header';
import { LogoLoader } from '../components/ui/LogoLoader';
import { useLanguage } from '@/i18n/LanguageContext';
import { fetchFmp } from '@/lib/fmpClient';

interface MarketSignal {
  source: string;
  type: string;
  strength: number;
  weight: number;
  description: string;
  dataPoint?: string;
  emoji: string;
}

interface MacroAnalysis {
  sectorBreadth: number;
  industryBreadth: number;
  hotSectors: Array<{ sector: string; change: number }>;
  coldSectors: Array<{ sector: string; change: number }>;
  majorIndicesUp: string[];
  majorIndicesDown: string[];
  vixRegime?: string;
}

interface SentimentTrends {
  daily_delta: number | null;
  weekly_mean: number | null;
  monthly_delta: number | null;
  weekly_trend: 'mejorando' | 'deteriorando' | 'estable' | null;
  ema_score: number;
  momentum_streak: number;
  anomaly: boolean;
  note?: string;
}

interface MarketSentimentData {
  version: string;
  timestamp: string;
  processingTime: number;
  compositeScore: number;
  overallSentiment: string;
  sentimentEmoji: string;
  recommendation: string;
  recommendationDescription: string;
  actionableAdvice?: string;
  fearGreedScore?: number;
  fearGreedLabel?: string;
  vixValue?: number;
  scores: Record<string, number>;
  moversAnalysis: {
    breadthRatio: number;
    breadthLabel: string;
    gainersCount: number;
    losersCount: number;
    topGainers: Array<{ symbol: string; name: string; change: number; price: number; sector: string }>;
    topLosers: Array<{ symbol: string; name: string; change: number; price: number; sector: string }>;
    sectorRotation: {
      hot: Array<{ sector: string; gainers: number; losers: number }>;
      cold: Array<{ sector: string; gainers: number; losers: number }>;
    };
  };
  macroAnalysis?: MacroAnalysis;
  signals: MarketSignal[];
  reasoningChain?: string[];
  briefing: string;
  trends?: SentimentTrends;
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color = score >= 60 ? 'bg-green-500' : score >= 45 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = score >= 60 ? 'text-green-400' : score >= 45 ? 'text-yellow-400' : 'text-red-400';
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider">{label}</span>
        <span className={`text-xs sm:text-sm font-bold ${textColor}`}>{score.toFixed(0)}</span>
      </div>
      <div className="h-1.5 bg-black/60 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function FearGreedGauge({ score, label }: { score: number; label: string }) {
  const getColor = (s: number) => {
    if (s >= 75) return '#ef4444';   // Extreme Greed = red
    if (s >= 60) return '#f97316';   // Greed = orange
    if (s >= 45) return '#eab308';   // Neutral = yellow
    if (s >= 30) return '#3b82f6';   // Fear = blue
    return '#8b5cf6';                // Extreme Fear = purple
  };
  const color = getColor(score);
  const rotation = (score / 100) * 180 - 90; // -90° to +90°

  // Arc points for score thresholds (center=80,80, r=70, angle=180*(1-score/100))
  // score 30 → (39, 23), 45 → (69, 11), 60 → (102, 13), 75 → (130, 31)

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-16 sm:w-40 sm:h-20">
        <svg viewBox="0 0 160 80" className="w-full h-full">
          {/* Background track */}
          <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#374151" strokeWidth="12" strokeLinecap="round" />
          {/* 5 color zones matching getColor thresholds */}
          <path d="M 10 80 A 70 70 0 0 1 39 23"   fill="none" stroke="#8b5cf6" strokeWidth="12" strokeLinecap="round" opacity="0.45" />
          <path d="M 39 23 A 70 70 0 0 1 69 11"   fill="none" stroke="#3b82f6" strokeWidth="12" strokeLinecap="round" opacity="0.45" />
          <path d="M 69 11 A 70 70 0 0 1 102 13"  fill="none" stroke="#eab308" strokeWidth="12" strokeLinecap="round" opacity="0.45" />
          <path d="M 102 13 A 70 70 0 0 1 130 31" fill="none" stroke="#f97316" strokeWidth="12" strokeLinecap="round" opacity="0.45" />
          <path d="M 130 31 A 70 70 0 0 1 150 80" fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" opacity="0.45" />
          {/* Needle */}
          <line
            x1="80" y1="80" x2="80" y2="18"
            stroke={color} strokeWidth="3" strokeLinecap="round"
            transform={`rotate(${rotation}, 80, 80)`}
          />
          <circle cx="80" cy="80" r="5" fill={color} />
        </svg>
      </div>
      <div className="text-center -mt-2">
        <div className="text-2xl sm:text-3xl font-black" style={{ color }}>{score.toFixed(0)}</div>
        <div className="text-xs font-semibold" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}

export default function MarketSentimentPage() {
  const [data, setData] = useState<MarketSentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const [showReasoning, setShowReasoning] = useState(false);
  const { t, locale } = useLanguage();

  // Translate finite-set backend labels to Spanish
  const tl = (text: string | undefined): string => {
    if (!text || locale !== 'es') return text || '';
    const map: Record<string, string> = {
      // Fear & Greed labels
      'Extreme Greed': 'Codicia Extrema', 'Greed': 'Codicia',
      'Neutral': 'Neutral', 'Fear': 'Miedo', 'Extreme Fear': 'Miedo Extremo',
      // VIX Regime labels
      'Extreme Complacency': 'Complacencia Extrema', 'Low Volatility': 'Baja Volatilidad',
      'Normal': 'Normal', 'Elevated': 'Elevada', 'High Fear': 'Alto Miedo',
      'Fear Spike': 'Pico de Miedo', 'Extreme Dislocation': 'Dislocación Extrema',
      'Unknown': 'Desconocido',
      // Breadth labels
      'Extreme Breadth': 'Amplitud Extrema', 'Positive': 'Positivo',
      'Negative': 'Negativo', 'Extreme Weakness': 'Debilidad Extrema',
      // Recommendation titles
      'BULL MARKET — FULL RISK ON': 'MERCADO ALCISTA — MÁXIMO RIESGO',
      'BULLISH — SOLID MOMENTUM': 'ALCISTA — MOMENTUM SÓLIDO',
      'NEUTRAL — MIXED SIGNALS': 'NEUTRAL — SEÑALES MIXTAS',
      'BEARISH — SELLING PRESSURE': 'BAJISTA — PRESIÓN VENDEDORA',
      'RISK OFF — DEFENSIVE MODE': 'RIESGO OFF — MODO DEFENSIVO',
      'EXTREME FEAR — POSSIBLE CAPITULATION': 'MIEDO EXTREMO — POSIBLE CAPITULACIÓN',
      // Actionable advice
      'AGGRESSIVE BUY: Add to winners, focus on hot sectors & momentum plays. Tight 2% stops.':
        'COMPRA AGRESIVA: Añadir a ganadores, enfocarse en sectores calientes y momentum. Stops al 2%.',
      'GO LONG: Rotate into strength. Sector leaders and breakouts. Monitor VIX for regime shift.':
        'IR LARGO: Rotar hacia fortaleza. Líderes sectoriales y rupturas. Vigilar cambio de régimen en VIX.',
      'SELECTIVE: Quality over quantity. 30-40% cash buffer. Wait for volume confirmation.':
        'SELECTIVO: Calidad sobre cantidad. Buffer 30-40% efectivo. Esperar confirmación de volumen.',
      'REDUCE: Trim longs 30-50%. Sector rotation to defensives. Hedge with inverse ETFs.':
        'REDUCIR: Recortar largos 30-50%. Rotar a defensivos. Cobertura con ETFs inversos.',
      'SELL: Move 60%+ to cash/bonds. Wait for VIX<25 and breadth>55% before re-entering.':
        'VENDER: Mover 60%+ a efectivo/bonos. Esperar VIX<25 y amplitud>55% antes de volver.',
      'SURVIVE FIRST: 80%+ cash. Watch for VIX spike + reversal as capitulation signal → aggressive re-entry.':
        'SUPERVIVENCIA: 80%+ efectivo. Vigilar pico de VIX + reversión como señal de capitulación → reentrada agresiva.',
    };
    if (map[text]) return map[text];
    // Partial match for texts with dynamic suffix (e.g. recommendation descriptions with VIX regime appended)
    for (const [en, es] of Object.entries(map)) {
      if (text.startsWith(en)) return es + text.slice(en.length);
    }
    return text;
  };

  const fetchMarketData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [newsData, gainersData, losersData, sectorsData, industriesData, forexData, sp500Cons, dowCons] = await Promise.all([
        fetchFmp('stable/news/general-latest', { page: 0, limit: 30 }).catch(() => []),
        fetchFmp('stable/biggest-gainers').catch(() => []),
        fetchFmp('stable/biggest-losers').catch(() => []),
        fetchFmp('stable/sector-performance-snapshot').catch(() => []),
        fetchFmp('stable/industry-performance-snapshot').catch(() => []),
        fetchFmp('stable/fx').catch(() => []),
        fetchFmp('stable/sp500-constituent').catch(() => []),
        fetchFmp('stable/dowjones-constituent').catch(() => []),
      ]);

      // Helper: fetch batch-quote-short for a list of constituent symbols → compute breadth counts
      const computeBreadth = async (constituents: any[]) => {
        if (!Array.isArray(constituents) || constituents.length === 0) return null;
        // FMP may return Symbol (capital) or symbol (lowercase)
        const symbols: string[] = constituents
          .map((c: any) => c.symbol || c.Symbol)
          .filter(Boolean);
        if (symbols.length === 0) return null;
        const batchSize = 500;
        const batchResults = await Promise.all(
          Array.from({ length: Math.ceil(symbols.length / batchSize) }, (_, i) => {
            const batch = symbols.slice(i * batchSize, (i + 1) * batchSize).join(',');
            return fetchFmp('stable/batch-quote-short', { symbols: batch })
              .catch(() => []);
          })
        );
        const allQuotes: any[] = (batchResults as any[][]).flat();
        // Use changesPercentage or change; treat null/undefined as unknown (not 0)
        const withData = allQuotes.filter(q => {
          const pct = q.changesPercentage ?? q.change;
          return pct !== null && pct !== undefined && !isNaN(Number(pct));
        });
        const advancing = withData.filter(q => Number(q.changesPercentage ?? q.change) > 0).length;
        const declining = withData.filter(q => Number(q.changesPercentage ?? q.change) < 0).length;
        // If less than 10% of stocks show any movement, data is likely stale/pre-market
        if (withData.length < symbols.length * 0.1) return null;
        return { advancing, declining, unchanged: withData.length - advancing - declining, total: withData.length };
      };

      const [sp500Breadth, dowBreadth] = await Promise.all([
        computeBreadth(sp500Cons),
        computeBreadth(dowCons),
      ]);

      const indexBreadth = { sp500: sp500Breadth, dow: dowBreadth };

      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/market-sentiment/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            news: newsData || [],
            gainers: gainersData || [],
            losers: losersData || [],
            sectorPerformance: sectorsData || [],
            industryPerformance: industriesData || [],
            language: locale,
            forexQuotes: forexData || [],
            indexBreadth,
          }),
        });
        if (!res.ok) throw new Error('Backend error: ' + res.status);
        const sentimentData: MarketSentimentData = await res.json();
        setBackendStatus('connected');
        setData(sentimentData);
        setLastUpdate(new Date());
      } catch (backendErr: any) {
        setBackendStatus('disconnected');
        setData(generateFallback(gainersData || [], losersData || []));
        setLastUpdate(new Date());
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const generateFallback = (gainers: any[], losers: any[]): MarketSentimentData => {
    const total = gainers.length + losers.length;
    const breadthRatio = total > 0 ? gainers.length / total : 0.5;
    const composite = breadthRatio * 100;
    return {
      version: 'fallback', timestamp: new Date().toISOString(), processingTime: 0,
      compositeScore: Math.round(composite),
      overallSentiment: composite > 55 ? 'bullish' : composite < 45 ? 'bearish' : 'neutral',
      sentimentEmoji: composite > 55 ? '📈' : composite < 45 ? '📉' : '⚖️',
      recommendation: t('marketSentiment.backendDisconnected'),
      recommendationDescription: t('marketSentiment.runBackend'),
      scores: { news: 50, movers: Math.round(composite), composite: Math.round(composite) },
      moversAnalysis: {
        breadthRatio, breadthLabel: '',
        gainersCount: gainers.length, losersCount: losers.length,
        topGainers: gainers.slice(0, 10).map((g: any) => ({ symbol: g.symbol || '', name: g.name || '', change: g.changesPercentage || 0, price: g.price || 0, sector: g.sector || '' })),
        topLosers: losers.slice(0, 10).map((l: any) => ({ symbol: l.symbol || '', name: l.name || '', change: l.changesPercentage || 0, price: l.price || 0, sector: l.sector || '' })),
        sectorRotation: { hot: [], cold: [] },
      },
      signals: [], briefing: t('marketSentiment.engineUnavailable'),
    };
  };

  useEffect(() => {
    fetchMarketData();
    const interval = autoRefresh ? setInterval(fetchMarketData, 300000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [fetchMarketData, autoRefresh]);

  const scoreLabels: Record<string, string> = {
    news: t('marketSentiment.scoreLabels.news'),
    movers: t('marketSentiment.scoreLabels.movers'),
    sectors: t('marketSentiment.scoreLabels.sectors'),
    industries: t('marketSentiment.scoreLabels.industries'),
    indices: t('marketSentiment.scoreLabels.indices'),
    vix: t('marketSentiment.scoreLabels.vix'),
    forex: t('marketSentiment.scoreLabels.forex'),
    fearGreed: t('marketSentiment.scoreLabels.fearGreed'),
    composite: t('marketSentiment.scoreLabels.composite'),
  };

  const sentimentBg = (s: string) => {
    switch (s) {
      case 'very_bullish': return 'from-emerald-950/90 to-emerald-950/70 border-emerald-500/60';
      case 'bullish': return 'from-green-950/80 to-emerald-950/60 border-green-500/50';
      case 'neutral': return 'from-amber-950/70 to-yellow-950/50 border-amber-500/40';
      case 'bearish': return 'from-orange-950/70 to-red-950/50 border-orange-500/40';
      case 'very_bearish': return 'from-red-950/90 to-red-950/40 border-red-500/60';
      default: return 'from-black to-slate-900 border-white/[0.08]';
    }
  };

  const scoreColor = (s: number) => s >= 65 ? 'text-emerald-400' : s >= 52 ? 'text-green-400' : s >= 45 ? 'text-yellow-400' : s >= 35 ? 'text-orange-400' : 'text-red-400';

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black to-slate-950 flex items-center justify-center px-4">
        <div className="text-center">
          <LogoLoader size="xl" />
          <p className="text-xl sm:text-2xl font-light text-emerald-400 mt-6">{t('marketSentiment.analyzing')}</p>
          <p className="text-gray-500 mt-2 text-sm">{t('marketSentiment.processingData')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-black to-slate-950 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl sm:text-2xl font-bold text-red-400 mb-4">{t('marketSentiment.error')}</h2>
          <p className="text-gray-400 mb-6 text-sm">{error}</p>
          <button onClick={fetchMarketData} className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-semibold transition">
            {t('marketSentiment.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-slate-900 to-black pb-16">
      <Header />

      {/* Sub-header */}
      <header className="border-b border-green-900/20 bg-black/70 backdrop-blur-lg mt-16">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 sm:gap-4">
              <Logo size="sm" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base sm:text-xl font-bold text-white">Market Pulse</span>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-cyan-900/60 text-cyan-400 border border-cyan-700/50 uppercase tracking-wider">Beta</span>
                </div>
                <div className="text-[9px] sm:text-[10px] text-emerald-400 font-data tracking-[2px] sm:tracking-[3px] uppercase">
                  NEURAL v{data.version}
                </div>
              </div>
              <span className={`hidden sm:flex px-2 py-1 text-xs rounded-full border ${backendStatus === 'connected' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'}`}>
                {backendStatus === 'connected' ? '🟢 Neural Engine' : '⚠️ Fallback'}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
              {lastUpdate && (
                <span className="text-[10px] sm:text-xs text-gray-500 hidden sm:block">
                  {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  {data.processingTime > 0 && ` · ${data.processingTime}s`}
                </span>
              )}
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-2 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs rounded-full border transition-all ${autoRefresh ? 'bg-green-500/10 border-green-500 text-green-400' : 'bg-black/60 border-white/[0.06] text-gray-500'}`}
              >
                {autoRefresh ? '🔄 Auto' : '⏸️ Off'}
              </button>
              <button
                onClick={fetchMarketData}
                disabled={loading}
                className="bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-500 hover:to-emerald-500 disabled:opacity-50 px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all active:scale-95"
              >
                {loading ? '⏳' : `🔄 ${t('marketSentiment.update')}`}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-6 sm:pt-10 space-y-6 sm:space-y-8">

        {/* ── HERO ── */}
        <div className={`rounded-2xl sm:rounded-[2rem] p-6 sm:p-10 md:p-14 border-2 bg-gradient-to-br ${sentimentBg(data.overallSentiment)} relative overflow-hidden`}>
          <div className="absolute inset-0 bg-[radial-gradient(at_top_right,#ffffff06_0%,transparent_60%)]" />
          <div className="relative z-10">
            {/* Mobile: stacked. Desktop: centered */}
            <div className="text-center">
              <div className="text-5xl sm:text-7xl mb-3">{data.sentimentEmoji}</div>
              <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white mb-2 tracking-tight leading-tight">
                {tl(data.recommendation)}
              </h1>
              <p className="text-sm sm:text-lg text-gray-300 max-w-xl mx-auto leading-relaxed">
                {tl(data.recommendationDescription)}
              </p>
            </div>

            {/* Composite + VIX + Fear/Greed row */}
            <div className="mt-8 flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-6">
              {/* Composite Score */}
              <div className="bg-black/40 backdrop-blur-xl rounded-2xl px-6 sm:px-8 py-4 sm:py-5 border border-white/10 text-center">
                <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">{t('marketSentiment.compositeScore')}</div>
                <div className={`text-5xl sm:text-6xl font-black ${scoreColor(data.compositeScore)}`}>{data.compositeScore}</div>
                <div className="text-[10px] text-gray-500 mt-1">/ 100</div>
              </div>

              {/* VIX */}
              {data.vixValue != null && (
                <div className="bg-black/40 backdrop-blur-xl rounded-2xl px-6 sm:px-8 py-4 sm:py-5 border border-white/10 text-center">
                  <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider">VIX</div>
                  <div className={`text-4xl sm:text-5xl font-black ${data.vixValue < 20 ? 'text-green-400' : data.vixValue < 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {data.vixValue.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">{tl(data.macroAnalysis?.vixRegime || '')}</div>
                </div>
              )}

              {/* Fear & Greed */}
              {data.fearGreedScore != null && (
                <div className="bg-black/40 backdrop-blur-xl rounded-2xl px-4 py-4 border border-white/10">
                  <div className="text-xs text-gray-400 mb-1 uppercase tracking-wider text-center">Fear & Greed</div>
                  <FearGreedGauge score={data.fearGreedScore} label={tl(data.fearGreedLabel || '')} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── BRIEFING ── */}
        <div className="bg-black/80/70 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-5 sm:p-8">
          <h3 className="text-base sm:text-lg font-bold text-emerald-400 mb-3 sm:mb-4 flex items-center gap-2">
            🧠 {t('marketSentiment.neuralAnalysis')}
          </h3>
          <p className="text-sm sm:text-lg leading-relaxed text-gray-200">{tl(data.briefing)}</p>
        </div>

        {/* ── TEMPORAL TRENDS ── */}
        {data.trends && !data.trends.note && (
          <div className="bg-black/50 border border-cyan-800/30 rounded-2xl sm:rounded-3xl p-5 sm:p-8">
            <h3 className="text-base sm:text-lg font-bold text-cyan-400 mb-4 flex items-center gap-2">
              📈 {locale === 'es' ? 'Tendencia Histórica' : 'Historical Trend'}
              {data.trends.anomaly && (
                <span className="ml-2 px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-900/60 text-red-400 border border-red-700/50 uppercase">⚠️ {locale === 'es' ? 'Anomalía' : 'Anomaly'}</span>
              )}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* EMA Score */}
              <div className="bg-black/40 rounded-xl p-3 sm:p-4 text-center border border-cyan-800/20">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  {locale === 'es' ? 'Score EMA' : 'EMA Score'}
                </div>
                <div className={`text-2xl sm:text-3xl font-black ${data.trends.ema_score >= 60 ? 'text-emerald-400' : data.trends.ema_score >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {data.trends.ema_score.toFixed(1)}
                </div>
                <div className="text-[9px] text-gray-600 mt-0.5">α=0.3 EMA</div>
              </div>
              {/* Daily delta */}
              <div className="bg-black/40 rounded-xl p-3 sm:p-4 text-center border border-white/[0.06]">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  {locale === 'es' ? 'Δ Día' : 'Δ Day'}
                </div>
                <div className={`text-2xl sm:text-3xl font-black ${data.trends.daily_delta === null ? 'text-gray-500' : data.trends.daily_delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.trends.daily_delta === null ? '—' : `${data.trends.daily_delta > 0 ? '+' : ''}${data.trends.daily_delta.toFixed(1)}`}
                </div>
                <div className="text-[9px] text-gray-600 mt-0.5">{locale === 'es' ? 'vs ayer' : 'vs yesterday'}</div>
              </div>
              {/* Weekly mean */}
              <div className="bg-black/40 rounded-xl p-3 sm:p-4 text-center border border-white/[0.06]">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  {locale === 'es' ? 'Media 7d' : '7d Mean'}
                </div>
                <div className={`text-2xl sm:text-3xl font-black ${data.trends.weekly_mean === null ? 'text-gray-500' : data.trends.weekly_mean >= 60 ? 'text-green-400' : data.trends.weekly_mean >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {data.trends.weekly_mean === null ? '—' : data.trends.weekly_mean.toFixed(1)}
                </div>
                <div className={`text-[9px] mt-0.5 ${data.trends.weekly_trend === 'mejorando' ? 'text-green-500' : data.trends.weekly_trend === 'deteriorando' ? 'text-red-500' : 'text-gray-500'}`}>
                  {data.trends.weekly_trend
                    ? locale === 'es'
                      ? data.trends.weekly_trend
                      : data.trends.weekly_trend === 'mejorando' ? 'improving'
                        : data.trends.weekly_trend === 'deteriorando' ? 'deteriorating'
                        : 'stable'
                    : ''}
                </div>
              </div>
              {/* Monthly delta */}
              <div className="bg-black/40 rounded-xl p-3 sm:p-4 text-center border border-white/[0.06]">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  {locale === 'es' ? 'Δ 30d' : 'Δ 30d'}
                </div>
                <div className={`text-2xl sm:text-3xl font-black ${data.trends.monthly_delta === null ? 'text-gray-500' : data.trends.monthly_delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {data.trends.monthly_delta === null ? '—' : `${data.trends.monthly_delta > 0 ? '+' : ''}${data.trends.monthly_delta.toFixed(1)}`}
                </div>
                <div className="text-[9px] text-gray-600 mt-0.5">
                  {data.trends.momentum_streak > 0 ? `${data.trends.momentum_streak}d ${locale === 'es' ? 'racha' : 'streak'}` : ''}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ACTIONABLE ADVICE ── */}
        {data.actionableAdvice && (
          <div className="bg-gradient-to-br from-green-950/50 to-emerald-950/30 border border-green-600/40 rounded-2xl sm:rounded-3xl p-5 sm:p-8">
            <h3 className="text-base sm:text-lg font-bold text-green-400 mb-3 sm:mb-4 flex items-center gap-2">
              🎯 {t('marketSentiment.actionableAdvice')}
            </h3>
            <p className="text-sm sm:text-lg leading-relaxed text-gray-100 font-medium">{tl(data.actionableAdvice)}</p>
          </div>
        )}

        {/* ── SCORE BREAKDOWN ── */}
        <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-5 sm:p-8">
          <h3 className="text-base sm:text-lg font-bold text-teal-400 mb-4 sm:mb-6 flex items-center gap-2">
            📊 {t('marketSentiment.neuralLayers')}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {Object.entries(data.scores).map(([key, value]) => (
              <div key={key} className="bg-black/50 rounded-xl sm:rounded-2xl p-3 sm:p-4 text-center border border-white/[0.06]/50">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{scoreLabels[key] || key}</div>
                <div className={`text-2xl sm:text-3xl font-bold ${scoreColor(value)}`}>{value.toFixed(0)}</div>
                <div className="h-1 bg-black/50 rounded-full mt-2 overflow-hidden">
                  <div className={`h-full rounded-full ${value >= 60 ? 'bg-green-500' : value >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── MACRO ANALYSIS ── */}
        {data.macroAnalysis && (
          <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-5 sm:p-8">
            <h3 className="text-base sm:text-lg font-bold text-teal-400 mb-4 sm:mb-6 flex items-center gap-2">
              🌐 {t('marketSentiment.macroAnalysis')}
            </h3>
            <div className="space-y-4 sm:space-y-6">
              {/* Breadth bars */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-black/40 rounded-xl sm:rounded-2xl p-4 sm:p-5 border border-white/[0.06]">
                  <ScoreBar score={data.macroAnalysis.sectorBreadth} label={t('marketSentiment.sectorBreadth') + ' %'} />
                </div>
                <div className="bg-black/40 rounded-xl sm:rounded-2xl p-4 sm:p-5 border border-white/[0.06]">
                  <ScoreBar score={data.macroAnalysis.industryBreadth} label={t('marketSentiment.industryBreadth') + ' %'} />
                </div>
              </div>

              {/* Hot/Cold sectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {data.macroAnalysis.hotSectors.length > 0 && (
                  <div className="bg-green-900/20 border border-green-800/30 rounded-xl sm:rounded-2xl p-4">
                    <div className="text-xs text-green-400 uppercase mb-2 sm:mb-3 font-semibold">🔥 {t('marketSentiment.hotSectors')}</div>
                    <div className="space-y-1.5">
                      {data.macroAnalysis.hotSectors.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-green-300 text-xs sm:text-sm truncate mr-2">{s.sector}</span>
                          <span className="text-green-400 text-xs font-data shrink-0">+{s.change?.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.macroAnalysis.coldSectors.length > 0 && (
                  <div className="bg-red-900/20 border border-red-800/30 rounded-xl sm:rounded-2xl p-4">
                    <div className="text-xs text-red-400 uppercase mb-2 sm:mb-3 font-semibold">❄️ {t('marketSentiment.coldSectors')}</div>
                    <div className="space-y-1.5">
                      {data.macroAnalysis.coldSectors.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-red-300 text-xs sm:text-sm truncate mr-2">{s.sector}</span>
                          <span className="text-red-400 text-xs font-data shrink-0">{s.change?.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Index pills */}
              {(data.macroAnalysis.majorIndicesUp.length > 0 || data.macroAnalysis.majorIndicesDown.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {data.macroAnalysis.majorIndicesUp.map((idx, i) => (
                    <span key={`up-${i}`} className="px-2 sm:px-3 py-1 bg-green-900/30 border border-green-700/40 rounded-full text-green-400 text-[10px] sm:text-sm">
                      ▲ {idx}
                    </span>
                  ))}
                  {data.macroAnalysis.majorIndicesDown.map((idx, i) => (
                    <span key={`dn-${i}`} className="px-2 sm:px-3 py-1 bg-red-900/30 border border-red-700/40 rounded-full text-red-400 text-[10px] sm:text-sm">
                      ▼ {idx}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SIGNALS ── */}
        {data.signals.length > 0 && (
          <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-5 sm:p-8">
            <h3 className="text-base sm:text-lg font-bold text-emerald-400 mb-4 sm:mb-6 flex items-center gap-2">
              📡 {t('marketSentiment.signalsDetected')} ({data.signals.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {data.signals.slice(0, 18).map((signal, i) => (
                <div key={i} className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border ${
                  signal.type === 'bullish' ? 'bg-emerald-900/25 border-emerald-700/50' :
                  signal.type === 'bearish' ? 'bg-red-900/25 border-red-700/50' :
                  signal.type === 'cautionary' ? 'bg-amber-900/25 border-amber-700/50' :
                  'bg-black/40 border-white/[0.06]'
                }`}>
                  <div className="flex items-start gap-2">
                    <span className="text-lg sm:text-xl shrink-0">{signal.emoji}</span>
                    <div className="min-w-0">
                      <p className="font-medium text-white text-xs sm:text-sm leading-snug">{signal.description}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-gray-500 uppercase">{signal.source.replace(/_/g, ' ')}</span>
                        <span className={`text-[10px] font-medium ${signal.type === 'bullish' ? 'text-green-400' : signal.type === 'bearish' ? 'text-red-400' : 'text-amber-400'}`}>
                          {(signal.strength * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── BREADTH BAR ── */}
        <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-5 sm:p-8">
          <h3 className="text-base sm:text-lg font-bold text-amber-400 mb-4">📊 {t('marketSentiment.marketBreadth')}</h3>
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="flex-1 w-full">
              <div className="h-5 sm:h-6 bg-black/60 rounded-full overflow-hidden flex">
                <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all" style={{ width: `${data.moversAnalysis.breadthRatio * 100}%` }} />
                <div className="h-full bg-gradient-to-r from-red-500 to-rose-400" style={{ width: `${(1 - data.moversAnalysis.breadthRatio) * 100}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-xs">
                <span className="text-green-400">{t('marketSentiment.gainers')}: {data.moversAnalysis.gainersCount}</span>
                <span className="text-gray-300 font-bold">{(data.moversAnalysis.breadthRatio * 100).toFixed(0)}% {t('marketSentiment.advancing')}</span>
                <span className="text-red-400">{t('marketSentiment.losers')}: {data.moversAnalysis.losersCount}</span>
              </div>
            </div>
            <div className="text-center px-4 sm:px-6 shrink-0">
              <div className="text-xl sm:text-2xl font-bold text-white">{tl(data.moversAnalysis.breadthLabel)}</div>
              <div className="text-[10px] text-gray-500">{t('marketSentiment.breadth')}</div>
            </div>
          </div>
        </div>

        {/* ── GAINERS & LOSERS ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-8">
          <div className="bg-gradient-to-br from-green-950/30 to-emerald-950/20 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-green-700/50">
            <h3 className="text-base sm:text-xl font-bold text-green-400 mb-3 sm:mb-4 flex items-center gap-2">
              🚀 {t('marketSentiment.topGainers')}
              <span className="text-xs font-normal text-gray-500">({data.moversAnalysis.gainersCount})</span>
            </h3>
            {data.moversAnalysis.topGainers.length === 0 ? (
              <p className="text-gray-500 text-center py-6 text-sm">{t('marketSentiment.noDataAvailable')}</p>
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {data.moversAnalysis.topGainers.slice(0, 8).map((stock, idx) => (
                  <Link key={idx} href={`/analizar?ticker=${stock.symbol}`}
                    className="flex items-center justify-between bg-black/40 p-2.5 sm:p-3 rounded-xl hover:bg-black/50 transition">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <span className="text-gray-600 text-xs w-4 shrink-0">{idx + 1}</span>
                      <div className="min-w-0">
                        <span className="font-bold text-green-400 text-sm">{stock.symbol}</span>
                        <p className="text-gray-500 text-[10px] truncate max-w-[100px] sm:max-w-[140px]">{stock.name}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-green-400 font-bold text-xs sm:text-sm">+{stock.change?.toFixed(2)}%</span>
                      <p className="text-gray-500 text-[10px] sm:text-xs">${stock.price?.toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gradient-to-br from-red-950/30 to-red-950/40 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-red-700/50">
            <h3 className="text-base sm:text-xl font-bold text-red-400 mb-3 sm:mb-4 flex items-center gap-2">
              📉 {t('marketSentiment.topLosers')}
              <span className="text-xs font-normal text-gray-500">({data.moversAnalysis.losersCount})</span>
            </h3>
            {data.moversAnalysis.topLosers.length === 0 ? (
              <p className="text-gray-500 text-center py-6 text-sm">{t('marketSentiment.noDataAvailable')}</p>
            ) : (
              <div className="space-y-1.5 sm:space-y-2">
                {data.moversAnalysis.topLosers.slice(0, 8).map((stock, idx) => (
                  <Link key={idx} href={`/analizar?ticker=${stock.symbol}`}
                    className="flex items-center justify-between bg-black/40 p-2.5 sm:p-3 rounded-xl hover:bg-black/50 transition">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <span className="text-gray-600 text-xs w-4 shrink-0">{idx + 1}</span>
                      <div className="min-w-0">
                        <span className="font-bold text-red-400 text-sm">{stock.symbol}</span>
                        <p className="text-gray-500 text-[10px] truncate max-w-[100px] sm:max-w-[140px]">{stock.name}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-red-400 font-bold text-xs sm:text-sm">{stock.change?.toFixed(2)}%</span>
                      <p className="text-gray-500 text-[10px] sm:text-xs">${stock.price?.toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── SECTOR ROTATION ── */}
        {(data.moversAnalysis.sectorRotation.hot.length > 0 || data.moversAnalysis.sectorRotation.cold.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-8">
            <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-4 sm:p-6">
              <h3 className="text-green-400 font-bold mb-3 sm:mb-4 flex items-center gap-2 text-sm sm:text-base">
                🔥 {t('marketSentiment.hotSectorsRotation')}
              </h3>
              <div className="space-y-2 sm:space-y-3">
                {data.moversAnalysis.sectorRotation.hot.map((s, i) => (
                  <div key={i} className="bg-green-900/20 border border-green-800/30 rounded-xl p-3 flex justify-between items-center">
                    <span className="font-semibold text-green-300 text-xs sm:text-sm">{s.sector}</span>
                    <span className="text-green-400 text-xs">{s.gainers}↑ {s.losers}↓</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl p-4 sm:p-6">
              <h3 className="text-red-400 font-bold mb-3 sm:mb-4 flex items-center gap-2 text-sm sm:text-base">
                ❄️ {t('marketSentiment.coldSectorsRotation')}
              </h3>
              <div className="space-y-2 sm:space-y-3">
                {data.moversAnalysis.sectorRotation.cold.map((s, i) => (
                  <div key={i} className="bg-red-900/20 border border-red-800/30 rounded-xl p-3 flex justify-between items-center">
                    <span className="font-semibold text-red-300 text-xs sm:text-sm">{s.sector}</span>
                    <span className="text-red-400 text-xs">{s.gainers}↑ {s.losers}↓</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── REASONING CHAIN (collapsible) ── */}
        {data.reasoningChain && data.reasoningChain.length > 0 && (
          <div className="bg-black/50 border border-white/[0.06] rounded-2xl sm:rounded-3xl overflow-hidden">
            <button
              onClick={() => setShowReasoning(!showReasoning)}
              className="w-full px-5 sm:px-8 py-4 sm:py-5 flex items-center justify-between hover:bg-black/60/30 transition"
            >
              <h3 className="text-sm sm:text-lg font-bold text-amber-400 flex items-center gap-2">
                🔗 {t('marketSentiment.reasoningChain')} ({data.reasoningChain.length} steps)
              </h3>
              <span className="text-gray-400 text-lg">{showReasoning ? '▲' : '▼'}</span>
            </button>
            {showReasoning && (
              <div className="px-5 sm:px-8 pb-5 sm:pb-8 space-y-2 sm:space-y-3 border-t border-green-900/20">
                {data.reasoningChain.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 pt-2">
                    <div className="shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-[10px] sm:text-xs font-bold">
                      {i + 1}
                    </div>
                    <p className="text-gray-300 text-xs sm:text-sm leading-relaxed pt-0.5">{step}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── FOOTER ── */}
        <div className="text-center pt-6 border-t border-green-900/20">
          <p className="text-gray-500 text-xs mb-4">
            Neural Market Pulse v{data.version} · {t('marketSentiment.footerText')}
          </p>
          <div className="flex justify-center gap-3 sm:gap-4 flex-wrap">
            <Link href="/" className="px-4 sm:px-6 py-2 bg-black/60 hover:bg-black/50 text-gray-300 rounded-lg transition text-xs sm:text-sm">
              ← {t('marketSentiment.backToHome')}
            </Link>
            <Link href="/analizar" className="px-4 sm:px-6 py-2 bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-500 hover:to-emerald-500 text-white rounded-lg transition text-xs sm:text-sm">
              {t('marketSentiment.analyzeStock')} →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
