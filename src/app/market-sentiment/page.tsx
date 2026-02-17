'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Logo from '../components/Logo';
import Header from '../components/Header';
import { useLanguage } from '@/i18n/LanguageContext';

interface MarketSignal {
  source: string;
  type: string;
  strength: number;
  weight: number;
  description: string;
  dataPoint?: string;
  emoji: string;
}

interface TopStock {
  symbol: string;
  name: string;
  change: number;
  price: number;
  sector: string;
}

interface SectorRotation {
  hot: Array<{ sector: string; gainers: number; losers: number }>;
  cold: Array<{ sector: string; gainers: number; losers: number }>;
}

interface MacroAnalysis {
  sectorBreadth: number;
  industryBreadth: number;
  hotSectors: Array<{ sector: string; change: number }>;
  coldSectors: Array<{ sector: string; change: number }>;
  majorIndicesUp: string[];
  majorIndicesDown: string[];
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
  scores: {
    news: number;
    movers: number;
    sectors?: number;
    industries?: number;
    indices?: number;
    forex?: number;
    trends?: number;
    breadth?: number;
    institutional?: number;
    composite: number;
  };
  moversAnalysis: {
    breadthRatio: number;
    breadthLabel: string;
    gainersCount: number;
    losersCount: number;
    topGainers: TopStock[];
    topLosers: TopStock[];
    sectorRotation: SectorRotation;
  };
  macroAnalysis?: MacroAnalysis;
  signals: MarketSignal[];
  reasoningChain?: string[];
  briefing: string;
}

export default function MarketSentimentPage() {
  const [data, setData] = useState<MarketSentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
  const { t } = useLanguage();

  const fetchMarketData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      if (!apiKey) throw new Error('API key not found');

      console.log('[MarketSentiment] Fetching market data...');

      const [newsRes, gainersRes, losersRes, sectorsRes, industriesRes, forexRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=30&apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/biggest-losers?apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/sector-performance-snapshot?apikey=${apiKey}`).catch(() => null),
        fetch(`https://financialmodelingprep.com/stable/industry-performance-snapshot?apikey=${apiKey}`).catch(() => null),
        fetch(`https://financialmodelingprep.com/stable/fx?apikey=${apiKey}`).catch(() => null),
      ]);

      const [newsData, gainersData, losersData, sectorsData, industriesData, forexData] = await Promise.all([
        newsRes.ok ? newsRes.json() : [],
        gainersRes.ok ? gainersRes.json() : [],
        losersRes.ok ? losersRes.json() : [],
        sectorsRes?.ok ? sectorsRes.json() : [],
        industriesRes?.ok ? industriesRes.json() : [],
        forexRes?.ok ? forexRes.json() : [],
      ]);

      console.log('[MarketSentiment] Data fetched:', {
        news: newsData?.length || 0,
        gainers: gainersData?.length || 0,
        losers: losersData?.length || 0,
        sectors: sectorsData?.length || 0,
        industries: industriesData?.length || 0,
        forex: forexData?.length || 0,
      });

      // Try backend first
      try {
        console.log('[MarketSentiment] Calling backend with:', {
          newsCount: (newsData || []).length,
          gainersCount: (gainersData || []).length,
          losersCount: (losersData || []).length,
        });

        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/market-sentiment/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            news: newsData || [],
            gainers: gainersData || [],
            losers: losersData || [],
            sectorPerformance: sectorsData || [],
            industryPerformance: industriesData || [],
            forexQuotes: forexData || [],
          }),
        });

        console.log('[MarketSentiment] Backend response status:', res.status);

        if (!res.ok) {
          const errorText = await res.text();
          console.error('[MarketSentiment] Backend error:', errorText);
          throw new Error('Backend error: ' + res.status);
        }

        const sentimentData: MarketSentimentData = await res.json();
        console.log('[MarketSentiment] Backend response:', sentimentData);

        setBackendStatus('connected');
        setData(sentimentData);
        setLastUpdate(new Date());
      } catch (backendErr: any) {
        console.error('[MarketSentiment] Backend error details:', backendErr.message);
        setBackendStatus('disconnected');

        // Fallback analysis
        const fallbackData = generateFallbackAnalysis(
          Array.isArray(newsData) ? newsData : [],
          Array.isArray(gainersData) ? gainersData : [],
          Array.isArray(losersData) ? losersData : []
        );
        setData(fallbackData);
        setLastUpdate(new Date());
      }
    } catch (err: any) {
      console.error('[MarketSentiment] Error:', err);
      setError(err.message || t('marketSentiment.errorAnalyzing'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fallback when backend is unavailable
  const generateFallbackAnalysis = (news: any[], gainers: any[], losers: any[]): MarketSentimentData => {
    const total = (gainers?.length || 0) + (losers?.length || 0);
    const breadthRatio = total > 0 ? (gainers?.length || 0) / total : 0.5;
    const composite = breadthRatio * 100;

    return {
      version: 'fallback',
      timestamp: new Date().toISOString(),
      processingTime: 0,
      compositeScore: Math.round(composite),
      overallSentiment: composite > 55 ? 'bullish' : composite < 45 ? 'bearish' : 'neutral',
      sentimentEmoji: composite > 55 ? '📈' : composite < 45 ? '📉' : '⚖️',
      recommendation: t('marketSentiment.backendDisconnected'),
      recommendationDescription: t('marketSentiment.runBackend'),
      scores: {
        news: 50,
        movers: Math.round(composite),
        breadth: Math.round(breadthRatio * 100),
        institutional: 50,
        composite: Math.round(composite),
      },
      moversAnalysis: {
        breadthRatio,
        breadthLabel: breadthRatio > 0.55 ? t('marketSentiment.positive') : breadthRatio < 0.45 ? t('marketSentiment.negative') : t('marketSentiment.neutral'),
        gainersCount: gainers?.length || 0,
        losersCount: losers?.length || 0,
        topGainers: (gainers || []).slice(0, 10).map((g: any) => ({
          symbol: g?.symbol || '',
          name: g?.name || '',
          change: g?.changesPercentage || 0,
          price: g?.price || 0,
          sector: g?.sector || '',
        })),
        topLosers: (losers || []).slice(0, 10).map((l: any) => ({
          symbol: l?.symbol || '',
          name: l?.name || '',
          change: l?.changesPercentage || 0,
          price: l?.price || 0,
          sector: l?.sector || '',
        })),
        sectorRotation: { hot: [], cold: [] },
      },
      signals: [],
      briefing: t('marketSentiment.engineUnavailable'),
    };
  };

  useEffect(() => {
    fetchMarketData();
    const interval = autoRefresh ? setInterval(fetchMarketData, 300000) : null;
    return () => { if (interval) clearInterval(interval); };
  }, [fetchMarketData, autoRefresh]);

  const getSentimentStyle = (sentiment: string) => {
    switch (sentiment) {
      case 'very_bullish': return 'from-emerald-900/80 to-cyan-900/60 border-emerald-500';
      case 'bullish': return 'from-green-900/70 to-emerald-900/50 border-green-500';
      case 'neutral': return 'from-amber-900/60 to-yellow-900/40 border-amber-500';
      case 'bearish': return 'from-orange-900/60 to-red-900/40 border-orange-500';
      case 'very_bearish': return 'from-red-900/80 to-rose-900/60 border-red-500';
      default: return 'from-gray-900 to-slate-900 border-gray-600';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-emerald-400';
    if (score >= 55) return 'text-green-400';
    if (score >= 45) return 'text-yellow-400';
    if (score >= 30) return 'text-orange-400';
    return 'text-red-400';
  };

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-2xl font-light text-purple-400">{t('marketSentiment.analyzing')}</p>
          <p className="text-gray-500 mt-2">{t('marketSentiment.processingData')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 to-slate-950 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-400 mb-4">{t('marketSentiment.error')}</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={fetchMarketData}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition"
          >
            {t('marketSentiment.retry')}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 pb-20">
      <Header />
      {/* Sub-Header Premium */}
      <header className="border-b border-gray-800 bg-black/70 backdrop-blur-lg mt-16">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo size="md" />
            <div>
              <div className="text-xl font-bold text-white">Market Pulse</div>
              <div className="text-[10px] text-purple-400 font-mono tracking-[3px] uppercase">
                NEURAL v{data.version}
              </div>
            </div>
            {backendStatus === 'connected' ? (
              <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                🟢 {t('marketSentiment.neuralEngine')}
              </span>
            ) : (
              <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30">
                ⚠️ {t('marketSentiment.fallback')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-6">
            {lastUpdate && (
              <div className="text-xs text-gray-500">
                {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                {data.processingTime > 0 && ` • ${data.processingTime}s`}
              </div>
            )}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-4 py-2 text-xs rounded-full border transition-all ${
                autoRefresh
                  ? 'bg-green-500/10 border-green-500 text-green-400'
                  : 'bg-gray-800 border-gray-700 text-gray-500'
              }`}
            >
              {autoRefresh ? `🔄 ${t('marketSentiment.autoOn')}` : `⏸️ ${t('marketSentiment.autoOff')}`}
            </button>
            <button
              onClick={fetchMarketData}
              disabled={loading}
              className="bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
            >
              {loading ? t('common.analyzing') : `🔄 ${t('marketSentiment.update')}`}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-10 space-y-10">
        {/* HERO - Main Sentiment Card */}
        <div className={`rounded-[2.25rem] p-10 md:p-16 border-2 bg-gradient-to-br ${getSentimentStyle(data.overallSentiment)} relative overflow-hidden`}>
          <div className="absolute inset-0 bg-[radial-gradient(at_top_right,#ffffff08_0%,transparent_50%)]"></div>
          <div className="relative z-10 text-center">
            <div className="text-7xl mb-4">{data.sentimentEmoji}</div>
            <h1 className="text-4xl md:text-6xl font-black text-white mb-3 tracking-tighter">
              {data.recommendation}
            </h1>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
              {data.recommendationDescription}
            </p>
            <div className="mt-10 flex justify-center">
              <div className="bg-black/40 backdrop-blur-xl rounded-3xl px-10 py-6 border border-white/10">
                <div className="text-sm text-gray-400 mb-1">{t('marketSentiment.compositeScore')}</div>
                <div className={`text-6xl font-black ${getScoreColor(data.compositeScore)}`}>
                  {data.compositeScore}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BRIEFING */}
        <div className="bg-gray-900/70 border border-gray-700 rounded-3xl p-8">
          <h3 className="text-lg font-bold text-purple-400 mb-4 flex items-center gap-2">
            🧠 {t('marketSentiment.neuralAnalysis')}
          </h3>
          <p className="text-lg leading-relaxed text-gray-200">{data.briefing}</p>
        </div>

        {/* ACTIONABLE ADVICE */}
        {data.actionableAdvice && (
          <div className="bg-gradient-to-br from-indigo-950/50 to-purple-950/30 border border-indigo-600/40 rounded-3xl p-8">
            <h3 className="text-lg font-bold text-indigo-400 mb-4 flex items-center gap-2">
              🎯 {t('marketSentiment.actionableAdvice')}
            </h3>
            <p className="text-lg leading-relaxed text-gray-100 font-medium">{data.actionableAdvice}</p>
          </div>
        )}

        {/* MACRO ANALYSIS */}
        {data.macroAnalysis && (
          <div className="bg-gray-900/60 border border-gray-700 rounded-3xl p-8">
            <h3 className="text-lg font-bold text-teal-400 mb-6 flex items-center gap-2">
              🌐 {t('marketSentiment.macroAnalysis')}
            </h3>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Sector & Industry Breadth */}
              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-2xl p-5 border border-gray-700">
                  <div className="text-xs text-gray-500 uppercase mb-2">{t('marketSentiment.sectorBreadth')}</div>
                  <div className={`text-3xl font-bold ${getScoreColor(data.macroAnalysis.sectorBreadth)}`}>
                    {data.macroAnalysis.sectorBreadth.toFixed(0)}%
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${data.macroAnalysis.sectorBreadth >= 50 ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${data.macroAnalysis.sectorBreadth}%` }} />
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-2xl p-5 border border-gray-700">
                  <div className="text-xs text-gray-500 uppercase mb-2">{t('marketSentiment.industryBreadth')}</div>
                  <div className={`text-3xl font-bold ${getScoreColor(data.macroAnalysis.industryBreadth)}`}>
                    {data.macroAnalysis.industryBreadth.toFixed(0)}%
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${data.macroAnalysis.industryBreadth >= 50 ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${data.macroAnalysis.industryBreadth}%` }} />
                  </div>
                </div>
              </div>

              {/* Hot & Cold Sectors */}
              <div className="space-y-4">
                {data.macroAnalysis.hotSectors.length > 0 && (
                  <div className="bg-green-900/20 border border-green-800/30 rounded-2xl p-5">
                    <div className="text-xs text-green-400 uppercase mb-3 font-semibold">🔥 {t('marketSentiment.hotSectors')}</div>
                    <div className="space-y-2">
                      {data.macroAnalysis.hotSectors.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-green-300 text-sm">{s.sector}</span>
                          <span className="text-green-400 text-sm font-mono">+{s.change?.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.macroAnalysis.coldSectors.length > 0 && (
                  <div className="bg-red-900/20 border border-red-800/30 rounded-2xl p-5">
                    <div className="text-xs text-red-400 uppercase mb-3 font-semibold">❄️ {t('marketSentiment.coldSectors')}</div>
                    <div className="space-y-2">
                      {data.macroAnalysis.coldSectors.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex justify-between items-center">
                          <span className="text-red-300 text-sm">{s.sector}</span>
                          <span className="text-red-400 text-sm font-mono">{s.change?.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Major Indices */}
            {(data.macroAnalysis.majorIndicesUp.length > 0 || data.macroAnalysis.majorIndicesDown.length > 0) && (
              <div className="mt-6 flex flex-wrap gap-3">
                {data.macroAnalysis.majorIndicesUp.map((idx, i) => (
                  <span key={`up-${i}`} className="px-3 py-1.5 bg-green-900/30 border border-green-700/40 rounded-full text-green-400 text-sm">
                    ▲ {idx}
                  </span>
                ))}
                {data.macroAnalysis.majorIndicesDown.map((idx, i) => (
                  <span key={`dn-${i}`} className="px-3 py-1.5 bg-red-900/30 border border-red-700/40 rounded-full text-red-400 text-sm">
                    ▼ {idx}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SCORE BREAKDOWN */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(data.scores).map(([key, value]) => (
            <div key={key} className="bg-gray-800/50 rounded-2xl p-5 text-center border border-gray-700">
              <div className="text-xs text-gray-500 uppercase mb-2">{key}</div>
              <div className={`text-3xl font-bold ${getScoreColor(value)}`}>{value.toFixed(0)}</div>
              <div className="h-1.5 bg-gray-700 rounded-full mt-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    value >= 55 ? 'bg-green-500' : value >= 45 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* SIGNALS */}
        {data.signals.length > 0 && (
          <div className="bg-gray-900/60 border border-gray-700 rounded-3xl p-8">
            <h3 className="text-lg font-bold text-cyan-400 mb-6 flex items-center gap-2">
              📡 {t('marketSentiment.signalsDetected')} ({data.signals.length})
            </h3>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.signals.map((signal, i) => (
                <div
                  key={i}
                  className={`p-5 rounded-2xl border ${
                    signal.type === 'bullish'
                      ? 'bg-emerald-900/30 border-emerald-700'
                      : signal.type === 'bearish'
                        ? 'bg-red-900/30 border-red-700'
                        : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  <div className="text-2xl mb-2">{signal.emoji}</div>
                  <p className="font-medium text-white">{signal.description}</p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-gray-500 uppercase">{signal.source}</span>
                    <span className={`text-xs font-medium ${
                      signal.type === 'bullish' ? 'text-green-400' : signal.type === 'bearish' ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {(signal.strength * 100).toFixed(0)}% {t('marketSentiment.strength')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GAINERS & LOSERS */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Top Gainers */}
          <div className="bg-gradient-to-br from-green-950/30 to-emerald-950/20 rounded-3xl p-6 border border-green-700/50">
            <h3 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
              🚀 {t('marketSentiment.topGainers')}
              <span className="text-sm font-normal text-gray-500">({data.moversAnalysis.gainersCount})</span>
            </h3>
            {data.moversAnalysis.topGainers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('marketSentiment.noDataAvailable')}</p>
            ) : (
              <div className="space-y-2">
                {data.moversAnalysis.topGainers.slice(0, 8).map((stock, idx) => (
                  <Link
                    key={idx}
                    href={`/analizar?ticker=${stock.symbol}`}
                    className="flex items-center justify-between bg-gray-900/50 p-3 rounded-xl hover:bg-gray-800/50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-600 text-sm w-5">{idx + 1}</span>
                      <div>
                        <span className="font-bold text-green-400">{stock.symbol}</span>
                        <p className="text-gray-500 text-xs truncate max-w-[120px]">{stock.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-green-400 font-bold">+{stock.change?.toFixed(2)}%</span>
                      <p className="text-gray-500 text-sm">${stock.price?.toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Top Losers */}
          <div className="bg-gradient-to-br from-red-950/30 to-rose-950/20 rounded-3xl p-6 border border-red-700/50">
            <h3 className="text-xl font-bold text-red-400 mb-4 flex items-center gap-2">
              📉 {t('marketSentiment.topLosers')}
              <span className="text-sm font-normal text-gray-500">({data.moversAnalysis.losersCount})</span>
            </h3>
            {data.moversAnalysis.topLosers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('marketSentiment.noDataAvailable')}</p>
            ) : (
              <div className="space-y-2">
                {data.moversAnalysis.topLosers.slice(0, 8).map((stock, idx) => (
                  <Link
                    key={idx}
                    href={`/analizar?ticker=${stock.symbol}`}
                    className="flex items-center justify-between bg-gray-900/50 p-3 rounded-xl hover:bg-gray-800/50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-600 text-sm w-5">{idx + 1}</span>
                      <div>
                        <span className="font-bold text-red-400">{stock.symbol}</span>
                        <p className="text-gray-500 text-xs truncate max-w-[120px]">{stock.name}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-red-400 font-bold">{stock.change?.toFixed(2)}%</span>
                      <p className="text-gray-500 text-sm">${stock.price?.toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SECTOR ROTATION */}
        {(data.moversAnalysis.sectorRotation.hot.length > 0 || data.moversAnalysis.sectorRotation.cold.length > 0) && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Hot Sectors */}
            <div className="bg-gray-900/60 border border-gray-700 rounded-3xl p-6">
              <h3 className="text-green-400 font-bold mb-4 flex items-center gap-2">
                🔥 {t('marketSentiment.hotSectorsRotation')}
              </h3>
              {data.moversAnalysis.sectorRotation.hot.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('marketSentiment.noHotSectors')}</p>
              ) : (
                <div className="space-y-3">
                  {data.moversAnalysis.sectorRotation.hot.map((s, i) => (
                    <div key={i} className="bg-green-900/20 border border-green-800/30 rounded-2xl p-4 flex justify-between items-center">
                      <span className="font-semibold text-green-300">{s.sector}</span>
                      <span className="text-green-400 text-sm">{s.gainers}↑ / {s.losers}↓</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cold Sectors */}
            <div className="bg-gray-900/60 border border-gray-700 rounded-3xl p-6">
              <h3 className="text-red-400 font-bold mb-4 flex items-center gap-2">
                ❄️ {t('marketSentiment.coldSectorsRotation')}
              </h3>
              {data.moversAnalysis.sectorRotation.cold.length === 0 ? (
                <p className="text-gray-500 text-sm">{t('marketSentiment.noColdSectors')}</p>
              ) : (
                <div className="space-y-3">
                  {data.moversAnalysis.sectorRotation.cold.map((s, i) => (
                    <div key={i} className="bg-red-900/20 border border-red-800/30 rounded-2xl p-4 flex justify-between items-center">
                      <span className="font-semibold text-red-300">{s.sector}</span>
                      <span className="text-red-400 text-sm">{s.gainers}↑ / {s.losers}↓</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* BREADTH INDICATOR */}
        <div className="bg-gray-900/60 border border-gray-700 rounded-3xl p-6">
          <h3 className="text-lg font-bold text-amber-400 mb-4">📊 {t('marketSentiment.marketBreadth')}</h3>
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <div className="h-4 bg-gray-800 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all"
                  style={{ width: `${data.moversAnalysis.breadthRatio * 100}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-red-500 to-rose-400"
                  style={{ width: `${(1 - data.moversAnalysis.breadthRatio) * 100}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-sm">
                <span className="text-green-400">{t('marketSentiment.gainers')}: {data.moversAnalysis.gainersCount}</span>
                <span className="text-gray-400 font-bold">{(data.moversAnalysis.breadthRatio * 100).toFixed(0)}%</span>
                <span className="text-red-400">{t('marketSentiment.losers')}: {data.moversAnalysis.losersCount}</span>
              </div>
            </div>
            <div className="text-center px-6">
              <div className="text-3xl font-bold text-white">{data.moversAnalysis.breadthLabel}</div>
              <div className="text-xs text-gray-500">{t('marketSentiment.breadth')}</div>
            </div>
          </div>
        </div>

        {/* REASONING CHAIN */}
        {data.reasoningChain && data.reasoningChain.length > 0 && (
          <div className="bg-gray-900/60 border border-gray-700 rounded-3xl p-8">
            <h3 className="text-lg font-bold text-amber-400 mb-6 flex items-center gap-2">
              🔗 {t('marketSentiment.reasoningChain')}
            </h3>
            <div className="space-y-3">
              {data.reasoningChain.map((step, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="shrink-0 w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-sm font-bold">
                    {i + 1}
                  </div>
                  <p className="text-gray-300 leading-relaxed pt-1">{step}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FOOTER */}
        <div className="text-center pt-8 border-t border-gray-800">
          <p className="text-gray-500 text-sm mb-4">
            Neural Market Pulse v{data.version} • {t('marketSentiment.realTimeAnalysis')} • {t('marketSentiment.autoRefreshEvery5')}
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/"
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition"
            >
              ← {t('marketSentiment.backToHome')}
            </Link>
            <Link
              href="/analizar"
              className="px-6 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white rounded-lg transition"
            >
              {t('marketSentiment.analyzeStock')} →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
