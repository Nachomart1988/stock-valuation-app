'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Logo from '../components/Logo';

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

interface MarketSentimentData {
  version: string;
  timestamp: string;
  processingTime: number;
  compositeScore: number;
  overallSentiment: string;
  sentimentEmoji: string;
  recommendation: string;
  recommendationDescription: string;
  scores: {
    news: number;
    movers: number;
    breadth: number;
    institutional: number;
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
  signals: MarketSignal[];
  briefing: string;
}

export default function MarketSentimentPage() {
  const [data, setData] = useState<MarketSentimentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  const fetchMarketData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      if (!apiKey) throw new Error('API key not found');

      console.log('[MarketSentiment] Fetching market data...');

      const [newsRes, gainersRes, losersRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/api/v3/stock_news?limit=30&apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/biggest-losers?apikey=${apiKey}`),
      ]);

      const [newsData, gainersData, losersData] = await Promise.all([
        newsRes.ok ? newsRes.json() : [],
        gainersRes.ok ? gainersRes.json() : [],
        losersRes.ok ? losersRes.json() : [],
      ]);

      console.log('[MarketSentiment] Data fetched:', {
        news: newsData?.length || 0,
        gainers: gainersData?.length || 0,
        losers: losersData?.length || 0
      });

      // Try backend first
      try {
        console.log('[MarketSentiment] Calling backend with:', {
          newsCount: (newsData || []).length,
          gainersCount: (gainersData || []).length,
          losersCount: (losersData || []).length,
        });

        const res = await fetch('http://localhost:8000/market-sentiment/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            news: newsData || [],
            gainers: gainersData || [],
            losers: losersData || [],
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
      setError(err.message || 'Error al analizar el mercado');
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
      recommendation: 'Backend desconectado',
      recommendationDescription: 'Ejecuta: cd backend && python main.py',
      scores: {
        news: 50,
        movers: Math.round(composite),
        breadth: Math.round(breadthRatio * 100),
        institutional: 50,
        composite: Math.round(composite),
      },
      moversAnalysis: {
        breadthRatio,
        breadthLabel: breadthRatio > 0.55 ? 'Positiva' : breadthRatio < 0.45 ? 'Negativa' : 'Neutral',
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
      briefing: 'El motor neural no está disponible. Inicia el backend para análisis completo.',
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
          <p className="text-2xl font-light text-purple-400">Analizando Sentimiento del Mercado...</p>
          <p className="text-gray-500 mt-2">Neural Engine v2.1 procesando datos</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 to-slate-950 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-400 mb-4">Error</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={fetchMarketData}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 pb-20">
      {/* Header Premium */}
      <header className="border-b border-gray-800 bg-black/70 backdrop-blur-lg sticky top-0 z-50">
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
                🟢 Neural Engine
              </span>
            ) : (
              <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded-full border border-yellow-500/30">
                ⚠️ Fallback
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
              {autoRefresh ? '🔄 Auto ON' : '⏸️ Auto OFF'}
            </button>
            <button
              onClick={fetchMarketData}
              disabled={loading}
              className="bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
            >
              {loading ? 'Analizando...' : '🔄 Actualizar'}
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
                <div className="text-sm text-gray-400 mb-1">COMPOSITE SCORE</div>
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
            🧠 Análisis Neural del Mercado
          </h3>
          <p className="text-lg leading-relaxed text-gray-200">{data.briefing}</p>
        </div>

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
              📡 Señales Detectadas ({data.signals.length})
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
                      {(signal.strength * 100).toFixed(0)}% fuerza
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
              🚀 Top Gainers
              <span className="text-sm font-normal text-gray-500">({data.moversAnalysis.gainersCount})</span>
            </h3>
            {data.moversAnalysis.topGainers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No data available</p>
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
              📉 Top Losers
              <span className="text-sm font-normal text-gray-500">({data.moversAnalysis.losersCount})</span>
            </h3>
            {data.moversAnalysis.topLosers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No data available</p>
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
                🔥 Sectores Calientes
              </h3>
              {data.moversAnalysis.sectorRotation.hot.length === 0 ? (
                <p className="text-gray-500 text-sm">Sin sectores destacados</p>
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
                ❄️ Sectores Débiles
              </h3>
              {data.moversAnalysis.sectorRotation.cold.length === 0 ? (
                <p className="text-gray-500 text-sm">Sin sectores débiles</p>
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
          <h3 className="text-lg font-bold text-amber-400 mb-4">📊 Amplitud del Mercado</h3>
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
                <span className="text-green-400">Gainers: {data.moversAnalysis.gainersCount}</span>
                <span className="text-gray-400 font-bold">{(data.moversAnalysis.breadthRatio * 100).toFixed(0)}%</span>
                <span className="text-red-400">Losers: {data.moversAnalysis.losersCount}</span>
              </div>
            </div>
            <div className="text-center px-6">
              <div className="text-3xl font-bold text-white">{data.moversAnalysis.breadthLabel}</div>
              <div className="text-xs text-gray-500">BREADTH</div>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="text-center pt-8 border-t border-gray-800">
          <p className="text-gray-500 text-sm mb-4">
            Neural Market Pulse v{data.version} • Análisis en tiempo real • Auto-refresh cada 5 min
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/"
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition"
            >
              ← Volver al Inicio
            </Link>
            <Link
              href="/analizar"
              className="px-6 py-2 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white rounded-lg transition"
            >
              Analizar Acción →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
