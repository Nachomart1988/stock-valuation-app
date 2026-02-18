'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/i18n/LanguageContext';
import Header from './components/Header';
import Logo from './components/Logo';

interface NewsItem {
  title: string;
  text: string;
  url: string;
  image: string;
  publishedDate: string;
  site: string;
  symbol?: string;
}

interface StockMover {
  symbol: string;
  name: string;
  change: number;
  price: number;
  changesPercentage: number;
}

interface ScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  industry: string;
  beta: number;
  price: number;
  lastAnnualDividend: number;
  volume: number;
  exchange: string;
  exchangeShortName: string;
  country: string;
  isEtf: boolean;
  isActivelyTrading: boolean;
}

interface ScreenerFilters {
  marketCapMoreThan: string;
  marketCapLowerThan: string;
  priceMoreThan: string;
  priceLowerThan: string;
  betaMoreThan: string;
  betaLowerThan: string;
  volumeMoreThan: string;
  dividendMoreThan: string;
  sector: string;
  industry: string;
  country: string;
  exchange: string;
}

const SECTORS = ['', 'Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical',
  'Industrials', 'Communication Services', 'Consumer Defensive', 'Energy',
  'Basic Materials', 'Real Estate', 'Utilities'];
const EXCHANGES = ['', 'NYSE', 'NASDAQ', 'AMEX', 'TSX', 'LSE'];
const COUNTRIES = ['', 'US', 'CA', 'GB', 'DE', 'JP', 'CN', 'AU', 'FR', 'IN'];

export default function Home() {
  const [ticker, setTicker] = useState('');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [gainers, setGainers] = useState<StockMover[]>([]);
  const [losers, setLosers] = useState<StockMover[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const router = useRouter();
  const { t } = useLanguage();

  // ── Stock Screener ──
  const [screenerResults, setScreenerResults] = useState<ScreenerResult[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerError, setScreenerError] = useState<string | null>(null);
  const [screenerPage, setScreenerPage] = useState(0);
  const SCREENER_LIMIT = 20;
  const [screenerFilters, setScreenerFilters] = useState<ScreenerFilters>({
    marketCapMoreThan: '',
    marketCapLowerThan: '',
    priceMoreThan: '',
    priceLowerThan: '',
    betaMoreThan: '',
    betaLowerThan: '',
    volumeMoreThan: '',
    dividendMoreThan: '',
    sector: '',
    industry: '',
    country: 'US',
    exchange: '',
  });

  const runScreener = async (page = 0) => {
    const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
    if (!apiKey) { setScreenerError('API key not configured'); return; }
    setScreenerLoading(true);
    setScreenerError(null);
    try {
      const params = new URLSearchParams({ apikey: apiKey, limit: String(SCREENER_LIMIT), offset: String(page * SCREENER_LIMIT) });
      const f = screenerFilters;
      if (f.marketCapMoreThan) params.set('marketCapMoreThan', f.marketCapMoreThan);
      if (f.marketCapLowerThan) params.set('marketCapLowerThan', f.marketCapLowerThan);
      if (f.priceMoreThan) params.set('priceMoreThan', f.priceMoreThan);
      if (f.priceLowerThan) params.set('priceLowerThan', f.priceLowerThan);
      if (f.betaMoreThan) params.set('betaMoreThan', f.betaMoreThan);
      if (f.betaLowerThan) params.set('betaLowerThan', f.betaLowerThan);
      if (f.volumeMoreThan) params.set('volumeMoreThan', f.volumeMoreThan);
      if (f.dividendMoreThan) params.set('dividendMoreThan', f.dividendMoreThan);
      if (f.sector) params.set('sector', f.sector);
      if (f.industry) params.set('industry', f.industry);
      if (f.country) params.set('country', f.country);
      if (f.exchange) params.set('exchange', f.exchange);

      const res = await fetch(`https://financialmodelingprep.com/stable/company-screener?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setScreenerResults(Array.isArray(data) ? data : []);
      setScreenerPage(page);
    } catch (err: any) {
      setScreenerError(err.message || 'Error fetching screener results');
    } finally {
      setScreenerLoading(false);
    }
  };

  const fmtMktCap = (v: number) => {
    if (!v) return '–';
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${v.toLocaleString()}`;
  };

  useEffect(() => {
    const fetchMarketData = async () => {
      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      if (!apiKey) return;

      setLoadingMarket(true);

      try {
        const [newsRes, gainersRes, losersRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=6&apikey=${apiKey}`),
          fetch(`https://financialmodelingprep.com/stable/biggest-gainers?apikey=${apiKey}`),
          fetch(`https://financialmodelingprep.com/stable/biggest-losers?apikey=${apiKey}`),
        ]);

        if (newsRes.ok) {
          const data = await newsRes.json();
          setNews(Array.isArray(data) ? data.slice(0, 6) : []);
        }

        if (gainersRes.ok) {
          const data = await gainersRes.json();
          setGainers(Array.isArray(data) ? data.slice(0, 5) : []);
        }

        if (losersRes.ok) {
          const data = await losersRes.json();
          setLosers(Array.isArray(data) ? data.slice(0, 5) : []);
        }
      } catch (err) {
        console.error('Error fetching market data:', err);
      } finally {
        setLoadingMarket(false);
      }
    };

    fetchMarketData();
  }, []);

  const handleAnalizar = () => {
    if (ticker.trim() === '') {
      alert(t('landing.enterValidTicker'));
      return;
    }
    router.push(`/analizar?ticker=${ticker.trim().toUpperCase()}`);
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      {/* Navigation */}
      <Header />

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-6xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
            <span className="text-sm text-green-400">{t('hero.badge')}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-7xl font-black mb-6 leading-tight">
            {t('hero.title')}
            <br />
            <span className="bg-gradient-to-r from-green-600 via-emerald-500 to-green-400 bg-clip-text text-transparent">
              {t('hero.titleHighlight')}
            </span>
          </h1>

          <p className="text-base sm:text-xl text-gray-400 max-w-3xl mx-auto mb-8 sm:mb-12">
            {t('hero.description')}
            <span className="text-green-400 font-semibold"> {t('hero.descriptionHighlight')}</span> {t('hero.descriptionEnd')}
          </p>

          {/* Quick Analysis Form */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-xl mx-auto mb-8">
            <input
              type="text"
              placeholder={t('hero.placeholder')}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalizar()}
              className="flex-1 px-6 py-4 bg-gray-800/50 border border-white/[0.06] rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent placeholder-gray-500"
            />
            <button
              onClick={handleAnalizar}
              className="px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl text-lg font-bold hover:from-green-600 hover:to-emerald-700 transition transform hover:scale-105 shadow-lg shadow-green-500/25"
            >
              {t('hero.analyzeButton')}
            </button>
          </div>

          <p className="text-sm text-gray-500">
            {t('hero.noRegister')}
          </p>

          {/* Stats - Focus on Valuation Models */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8 mt-10 sm:mt-16 max-w-4xl mx-auto">
            {[
              { number: '20+', label: t('stats.models') },
              { number: '100%', label: t('stats.editableInputs') },
              { number: '21', label: t('stats.analysisTabs') },
              { number: '5000', label: t('stats.monteCarloSims') },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                  {stat.number}
                </div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Valuation Models Showcase */}
          <div className="mt-16 p-6 bg-gray-800/30 rounded-2xl border border-white/[0.06]">
            <h3 className="text-lg font-semibold text-gray-300 mb-4">{t('landing.valuationModelsIncluded')}</h3>
            <div className="flex flex-wrap justify-center gap-3">
              {[
                'DDM 2-Stage', 'DDM 3-Stage', 'H-Model', 'DCF Multi-Etapa',
                '2-Stage FCF', '3-Stage FCF', 'Graham Method', 'RIM Ohlson',
                '2-Stage FCFE', '3-Stage FCFE', '2-Stage FCFF', '3-Stage FCFF',
                'Monte Carlo DCF', 'Stochastic DCF', 'NK DSGE', 'HJM',
                'Owner Earnings', 'EPS*Benchmark', 'Graham Number', 'Graham Net-Net'
              ].map((model) => (
                <span
                  key={model}
                  className="px-3 py-1.5 bg-gray-700/50 text-gray-300 text-sm rounded-lg border border-white/[0.08] hover:border-green-500 hover:text-green-400 transition cursor-default"
                >
                  {model}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Market Movers Section - NEW */}
      <section id="market" className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('market.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto mb-6">
              {t('market.description')}
            </p>
            <Link
              href="/market-sentiment"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-500 hover:to-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/25"
            >
              <span className="text-xl">🧠</span>
              {t('market.neuralAnalysis')}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          {loadingMarket ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent"></div>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Top Gainers */}
              <div className="bg-gray-800/50 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">📈</span>
                  <h3 className="text-xl font-bold text-green-400">{t('market.topGainers')}</h3>
                </div>
                {gainers.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">{t('market.noData')}</p>
                ) : (
                  <div className="space-y-3">
                    {gainers.map((stock, idx) => (
                      <div
                        key={stock.symbol}
                        className="flex items-center justify-between p-3 rounded-xl bg-green-900/20 border border-green-800/30 hover:border-green-600/50 transition cursor-pointer"
                        onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-gray-500 text-sm w-5">{idx + 1}</span>
                          <div>
                            <p className="font-bold text-white">{stock.symbol}</p>
                            <p className="text-xs text-gray-400 truncate max-w-[120px]">{stock.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">${stock.price?.toFixed(2)}</p>
                          <p className="text-sm text-green-400 font-bold">
                            +{stock.changesPercentage?.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top Losers */}
              <div className="bg-gray-800/50 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">📉</span>
                  <h3 className="text-xl font-bold text-red-400">{t('market.topLosers')}</h3>
                </div>
                {losers.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">{t('market.noData')}</p>
                ) : (
                  <div className="space-y-3">
                    {losers.map((stock, idx) => (
                      <div
                        key={stock.symbol}
                        className="flex items-center justify-between p-3 rounded-xl bg-red-900/20 border border-red-800/30 hover:border-red-600/50 transition cursor-pointer"
                        onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-gray-500 text-sm w-5">{idx + 1}</span>
                          <div>
                            <p className="font-bold text-white">{stock.symbol}</p>
                            <p className="text-xs text-gray-400 truncate max-w-[120px]">{stock.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-white">${stock.price?.toFixed(2)}</p>
                          <p className="text-sm text-red-400 font-bold">
                            {stock.changesPercentage?.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Latest News */}
              <div className="bg-gray-800/50 rounded-2xl border border-white/[0.06] p-6 lg:row-span-1">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">📰</span>
                  <h3 className="text-xl font-bold text-green-400">{t('market.latestNews')}</h3>
                </div>
                {news.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">{t('landing.noNewsAvailable')}</p>
                ) : (
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                    {news.map((item, idx) => (
                      <a
                        key={idx}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 rounded-xl bg-gray-700/30 border border-white/[0.08]/30 hover:border-green-500/50 transition"
                      >
                        <div className="flex gap-3">
                          {item.image && (
                            <img
                              src={item.image}
                              alt=""
                              className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-200 line-clamp-2 hover:text-green-400 transition">
                              {item.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-500">{item.site}</span>
                              <span className="text-xs text-gray-600">•</span>
                              <span className="text-xs text-gray-500">{formatTimeAgo(item.publishedDate)}</span>
                            </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('features.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('features.description')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: '🧠',
                title: t('features.neuralEngine.title'),
                description: t('features.neuralEngine.description')
              },
              {
                icon: '📊',
                title: t('features.valuations.title'),
                description: t('features.valuations.description')
              },
              {
                icon: '🎯',
                title: t('features.quality.title'),
                description: t('features.quality.description')
              },
              {
                icon: '📰',
                title: t('features.sentiment.title'),
                description: t('features.sentiment.description')
              },
              {
                icon: '🎲',
                title: t('features.monteCarlo.title'),
                description: t('features.monteCarlo.description')
              },
              {
                icon: '📈',
                title: t('features.technical.title'),
                description: t('features.technical.description')
              },
              {
                icon: '🏛️',
                title: t('features.institutional.title'),
                description: t('features.institutional.description')
              },
              {
                icon: '📋',
                title: t('features.journal.title'),
                description: t('features.journal.description')
              },
              {
                icon: '🔮',
                title: t('features.forecasts.title'),
                description: t('features.forecasts.description')
              },
            ].map((feature) => (
              <div key={feature.title} className="p-6 rounded-2xl bg-gray-800/50 border border-white/[0.06]/50 hover:border-green-500/50 transition group">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-green-400 transition">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('howItWorks.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('howItWorks.description')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: t('howItWorks.step1.title'),
                description: t('howItWorks.step1.description'),
                color: 'from-green-500 to-emerald-500'
              },
              {
                step: '02',
                title: t('howItWorks.step2.title'),
                description: t('howItWorks.step2.description'),
                color: 'from-green-600 to-emerald-400'
              },
              {
                step: '03',
                title: t('howItWorks.step3.title'),
                description: t('howItWorks.step3.description'),
                color: 'from-orange-500 to-red-500'
              },
            ].map((item, i) => (
              <div key={item.step} className="relative">
                <div className={`text-8xl font-black bg-gradient-to-r ${item.color} bg-clip-text text-transparent opacity-20 absolute -top-4 -left-2`}>
                  {item.step}
                </div>
                <div className="relative pt-12">
                  <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                  <p className="text-gray-400">{item.description}</p>
                </div>
                {i < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 w-8 text-gray-600">
                    →
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules/Sitemap Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('modules.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('modules.description')}
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              t('tabs.inicio'), t('tabs.general'), t('tabs.calculos'), t('tabs.beta'), t('tabs.wacc'), t('tabs.cagr'), t('tabs.sgr'),
              t('tabs.valuaciones'), t('tabs.keyMetrics'), t('tabs.dupont'), t('tabs.forecasts'), t('tabs.revenueForecast'),
              t('tabs.competidores'), t('tabs.industry'), t('tabs.holders'), t('tabs.pivots'), t('tabs.noticias'),
              t('tabs.segmentation'), t('tabs.analisisFinal'), t('tabs.diarioInversor'), t('tabs.resumenMaestro')
            ].map((module, i) => (
              <div
                key={module}
                className="px-4 py-3 rounded-xl bg-gray-800/50 border border-white/[0.06]/50 text-center hover:border-emerald-500/50 hover:bg-emerald-500/10 transition cursor-pointer"
              >
                <span className="text-xs text-gray-500 mr-2">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-gray-300">{module}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Diario del Inversor Feature Section */}
      <section className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            {/* Left: Description */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 mb-6">
                <span className="text-green-400 text-xs font-semibold tracking-widest uppercase">Nuevo</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                Diario del{' '}
                <span className="bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                  Inversor
                </span>
              </h2>
              <p className="text-gray-400 mb-6 leading-relaxed">
                Lleva un registro profesional de cada operación. Registra entradas, salidas, niveles de stop, price targets y análisis post-trade — todo en un solo lugar.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  { icon: '📋', text: 'Tabla maestra de swings con P&L automático' },
                  { icon: '📊', text: 'Seguimiento semanal de rendimiento y drawdown' },
                  { icon: '🎯', text: 'Múltiples price targets y ventas parciales' },
                  { icon: '🔒', text: 'Datos privados por usuario — sincronizados en la nube' },
                  { icon: '📝', text: 'Post-análisis y notas por operación' },
                ].map((item) => (
                  <li key={item.text} className="flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">{item.icon}</span>
                    <span className="text-gray-300 text-sm">{item.text}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/analizar"
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 transition"
              >
                Acceder al Diario
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>

            {/* Right: Preview Card */}
            <div className="relative">
              <div className="absolute inset-0 bg-green-500/5 rounded-3xl blur-3xl"></div>
              <div className="relative bg-gray-900 border border-white/[0.06] rounded-2xl p-6 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                  <span className="text-sm font-semibold text-gray-300">📒 Mis Operaciones</span>
                  <span className="text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded-full">3 abiertas</span>
                </div>
                {/* Mock trade rows */}
                {[
                  { sym: 'AAPL', side: 'Long', entry: 185.40, current: 194.20, pnl: '+4.75%', pnlColor: 'text-green-400', setup: 'Breakout' },
                  { sym: 'NVDA', side: 'Long', entry: 870.00, current: 912.50, pnl: '+4.89%', pnlColor: 'text-green-400', setup: 'WB' },
                  { sym: 'META', side: 'Long', entry: 510.00, current: 498.30, pnl: '-2.29%', pnlColor: 'text-red-400', setup: 'BORS' },
                ].map((trade) => (
                  <div key={trade.sym} className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-green-400">{trade.sym[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-100">{trade.sym}</p>
                        <p className="text-xs text-gray-500">{trade.setup} · {trade.side}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${trade.pnlColor}`}>{trade.pnl}</p>
                      <p className="text-xs text-gray-500">${trade.current}</p>
                    </div>
                  </div>
                ))}
                {/* Weekly P&L */}
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-500">Semana actual</span>
                  <span className="text-sm font-bold text-green-400">+$1,240 (+3.2%)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stock Screener */}
      <section id="screener" className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
              <span className="text-emerald-400 text-xs font-semibold tracking-widest uppercase">Stock Screener</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Encuentra tu{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">próxima inversión</span>
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Filtra entre miles de empresas usando métricas fundamentales. Haz clic en cualquier ticker para analizarlo al instante.
            </p>
          </div>

          {/* Filter Panel */}
          <div className="bg-gray-800/60 rounded-2xl border border-white/[0.06] p-6 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {/* Sector */}
              <div className="col-span-2 md:col-span-1">
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Sector</label>
                <select
                  value={screenerFilters.sector}
                  onChange={e => setScreenerFilters(f => ({ ...f, sector: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                >
                  {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
                </select>
              </div>

              {/* Exchange */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Exchange</label>
                <select
                  value={screenerFilters.exchange}
                  onChange={e => setScreenerFilters(f => ({ ...f, exchange: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                >
                  {EXCHANGES.map(e => <option key={e} value={e}>{e || 'All'}</option>)}
                </select>
              </div>

              {/* Country */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">País</label>
                <select
                  value={screenerFilters.country}
                  onChange={e => setScreenerFilters(f => ({ ...f, country: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                >
                  {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
                </select>
              </div>

              {/* Price range */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Precio min ($)</label>
                <input
                  type="number" min="0" placeholder="0"
                  value={screenerFilters.priceMoreThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, priceMoreThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Precio max ($)</label>
                <input
                  type="number" min="0" placeholder="∞"
                  value={screenerFilters.priceLowerThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, priceLowerThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Market Cap */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Mkt Cap min ($)</label>
                <input
                  type="number" min="0" placeholder="e.g. 1000000000"
                  value={screenerFilters.marketCapMoreThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, marketCapMoreThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Mkt Cap max ($)</label>
                <input
                  type="number" min="0" placeholder="∞"
                  value={screenerFilters.marketCapLowerThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, marketCapLowerThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Beta */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Beta min</label>
                <input
                  type="number" step="0.1" placeholder="0"
                  value={screenerFilters.betaMoreThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, betaMoreThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Beta max</label>
                <input
                  type="number" step="0.1" placeholder="∞"
                  value={screenerFilters.betaLowerThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, betaLowerThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Volume */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Vol. min</label>
                <input
                  type="number" min="0" placeholder="e.g. 100000"
                  value={screenerFilters.volumeMoreThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, volumeMoreThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Dividend */}
              <div>
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Div. Yield min</label>
                <input
                  type="number" step="0.1" min="0" placeholder="e.g. 1"
                  value={screenerFilters.dividendMoreThan}
                  onChange={e => setScreenerFilters(f => ({ ...f, dividendMoreThan: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Industry keyword */}
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Industria (keyword)</label>
                <input
                  type="text" placeholder="e.g. Semiconductors"
                  value={screenerFilters.industry}
                  onChange={e => setScreenerFilters(f => ({ ...f, industry: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Run button */}
            <div className="flex items-center justify-between mt-5">
              <button
                onClick={() => { setScreenerFilters(f => ({ ...f })); runScreener(0); }}
                disabled={screenerLoading}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl font-semibold text-sm hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 transition"
              >
                {screenerLoading ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                )}
                {screenerLoading ? 'Buscando…' : 'Buscar Acciones'}
              </button>
              {screenerResults.length > 0 && (
                <span className="text-xs text-gray-500">{screenerResults.length} resultado{screenerResults.length !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>

          {/* Error */}
          {screenerError && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
              {screenerError}
            </div>
          )}

          {/* Results Table */}
          {screenerResults.length > 0 && (
            <div className="bg-gray-800/60 rounded-2xl border border-white/[0.06] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-900/60 text-gray-500 text-xs uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Ticker</th>
                      <th className="text-left px-4 py-3">Empresa</th>
                      <th className="text-right px-4 py-3">Precio</th>
                      <th className="text-right px-4 py-3">Mkt Cap</th>
                      <th className="text-right px-4 py-3">Beta</th>
                      <th className="text-right px-4 py-3">Div.</th>
                      <th className="text-right px-4 py-3">Volumen</th>
                      <th className="text-left px-4 py-3">Sector</th>
                      <th className="text-left px-4 py-3">País</th>
                      <th className="text-center px-4 py-3">Analizar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {screenerResults.map((stock, i) => (
                      <tr
                        key={stock.symbol}
                        className={`border-t border-gray-700/40 hover:bg-emerald-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-emerald-400">{stock.symbol}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-200 max-w-[200px] truncate">{stock.companyName}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-200">
                          ${stock.price?.toFixed(2) ?? '–'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">{fmtMktCap(stock.marketCap)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={stock.beta > 1.5 ? 'text-red-400' : stock.beta < 0.7 ? 'text-emerald-400' : 'text-gray-300'}>
                            {stock.beta?.toFixed(2) ?? '–'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">
                          {stock.lastAnnualDividend ? `${stock.lastAnnualDividend.toFixed(2)}%` : '–'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                          {stock.volume ? (stock.volume >= 1e6 ? `${(stock.volume / 1e6).toFixed(1)}M` : stock.volume.toLocaleString()) : '–'}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[140px] truncate">{stock.sector || '–'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{stock.country || '–'}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                            className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs font-semibold transition"
                          >
                            Analizar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/40">
                <button
                  onClick={() => runScreener(screenerPage - 1)}
                  disabled={screenerPage === 0 || screenerLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-sm transition"
                >
                  ← Anterior
                </button>
                <span className="text-xs text-gray-500">Página {screenerPage + 1}</span>
                <button
                  onClick={() => runScreener(screenerPage + 1)}
                  disabled={screenerResults.length < SCREENER_LIMIT || screenerLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-700/50 hover:bg-gray-700 disabled:opacity-40 rounded-lg text-sm transition"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!screenerLoading && screenerResults.length === 0 && !screenerError && (
            <div className="text-center py-16 text-gray-600">
              <div className="text-5xl mb-4">🔍</div>
              <p className="text-lg">Configura los filtros y haz clic en <strong className="text-gray-400">Buscar Acciones</strong></p>
            </div>
          )}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('pricing.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('pricing.description')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className="p-8 rounded-2xl bg-gray-800/50 border border-white/[0.06]/50">
              <div className="text-lg font-semibold text-gray-400 mb-2">Free</div>
              <div className="text-4xl font-bold mb-6">$0<span className="text-lg text-gray-500">{t('pricing.perMonth')}</span></div>
              <ul className="space-y-3 mb-8">
                {[t('pricing.features.fiveAnalyses'), t('pricing.features.basicTabs'), t('pricing.features.realTimeData'), t('pricing.features.emailSupport')].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-400">
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/analizar" className="block w-full py-3 rounded-xl border border-white/[0.08] text-gray-300 font-semibold hover:bg-gray-700/50 transition text-center">
                {t('pricing.free.cta')}
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="p-8 rounded-2xl bg-gray-950 border-2 border-green-500/50 relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full text-sm font-semibold">
                {t('pricing.mostPopular')}
              </div>
              <div className="text-lg font-semibold text-green-400 mb-2">Pro</div>
              <div className="text-4xl font-bold mb-6">$29<span className="text-lg text-gray-500">{t('pricing.perMonth')}</span></div>
              <ul className="space-y-3 mb-8">
                {[t('pricing.features.unlimitedAnalyses'), t('pricing.features.allTabs'), t('pricing.features.neuralSummary'), t('pricing.features.valuationModels'), t('pricing.features.customInputs'), t('pricing.features.exportPdfExcel')].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-300">
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/pricing" className="block w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 font-semibold hover:from-green-600 hover:to-emerald-700 transition text-center">
                {t('pricing.pro.cta')}
              </Link>
            </div>

            {/* Elite Plan */}
            <div className="p-8 rounded-2xl bg-gray-800/50 border border-white/[0.06]/50">
              <div className="text-lg font-semibold text-gray-400 mb-2">Elite</div>
              <div className="text-4xl font-bold mb-6">$79<span className="text-lg text-gray-500">{t('pricing.perMonth')}</span></div>
              <ul className="space-y-3 mb-8">
                {[t('pricing.features.everythingInPro'), t('pricing.features.apiAccess'), t('pricing.features.customReports'), t('pricing.features.vipSupport'), t('pricing.features.privateWebinars'), t('pricing.features.consulting')].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-400">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/pricing" className="block w-full py-3 rounded-xl border border-white/[0.08] text-gray-300 font-semibold hover:bg-gray-700/50 transition text-center">
                {t('pricing.elite.cta')}
              </Link>
            </div>
          </div>

          {/* Link to full pricing page */}
          <div className="text-center mt-8">
            <Link href="/pricing" className="text-green-400 hover:text-green-300 transition inline-flex items-center gap-2">
              {t('pricing.viewFullComparison')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* About Us */}
      <section id="about" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-2xl sm:text-4xl font-bold mb-6">{t('about.title')}</h2>
              <p className="text-gray-400 mb-4">
                {t('about.description1')}
              </p>
              <p className="text-gray-400 mb-4">
                {t('about.description2')}
              </p>
              <p className="text-gray-400">
                {t('about.description3')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: '🎯', title: t('about.mission.title'), desc: t('about.mission.description') },
                { icon: '👁️', title: t('about.vision.title'), desc: t('about.vision.description') },
                { icon: '💡', title: t('about.innovation.title'), desc: t('about.innovation.description') },
                { icon: '🤝', title: t('about.trust.title'), desc: t('about.trust.description') },
              ].map((item) => (
                <div key={item.title} className="p-4 rounded-xl bg-gray-800/50 border border-white/[0.06]/50">
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <div className="font-semibold mb-1">{item.title}</div>
                  <div className="text-sm text-gray-500">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-4xl font-bold mb-6">
            {t('cta.title')}
          </h2>
          <p className="text-base sm:text-xl text-gray-400 mb-8">
            {t('cta.description')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl text-lg font-bold hover:from-green-600 hover:to-emerald-700 transition"
            >
              {t('cta.createAccount')}
            </Link>
            <Link
              href="/analizar"
              className="px-8 py-4 border border-white/[0.08] rounded-xl text-lg font-semibold hover:bg-gray-800 transition"
            >
              {t('cta.tryWithoutRegister')}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t border-gray-800">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            {/* Company */}
            <div>
              <h4 className="font-semibold mb-4">{t('footer.company')}</h4>
              <ul className="space-y-2">
                <li><a href="#about" className="text-gray-400 hover:text-white transition">{t('footer.aboutUs')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.blog')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.careers')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.press')}</a></li>
              </ul>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold mb-4">{t('footer.product')}</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="text-gray-400 hover:text-white transition">{t('footer.features')}</a></li>
                <li><a href="#pricing" className="text-gray-400 hover:text-white transition">{t('footer.pricing')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.api')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.integrations')}</a></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="font-semibold mb-4">{t('footer.resources')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.documentation')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.guides')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.faq')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.support')}</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold mb-4">{t('footer.legal')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.privacy')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.terms')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.cookies')}</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">{t('footer.licenses')}</a></li>
              </ul>
            </div>
          </div>

          {/* Bottom Footer */}
          <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-gray-800">
            <div className="flex items-center gap-3 mb-4 md:mb-0">
              <Logo size="sm" showText={false} linkTo="/" />
              <span className="text-gray-400">© 2024 StockAnalyzer. {t('footer.copyright')}</span>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-4">
              {['Twitter', 'LinkedIn', 'GitHub', 'YouTube'].map((social) => (
                <a key={social} href="#" className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 transition">
                  {social[0]}
                </a>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-8 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
            <p className="text-xs text-yellow-500/80 text-center">
              <strong>Disclaimer:</strong> {t('footer.disclaimer')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
