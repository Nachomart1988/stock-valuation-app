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

export default function Home() {
  const [ticker, setTicker] = useState('');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [gainers, setGainers] = useState<StockMover[]>([]);
  const [losers, setLosers] = useState<StockMover[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const router = useRouter();
  const { t, locale } = useLanguage();
  const es = locale === 'es';

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
            <span className="bg-gradient-to-b from-white to-gray-300 bg-clip-text text-transparent">
              PRISMO
            </span>
          </h1>

          <p className="text-base sm:text-xl text-gray-300 max-w-2xl mx-auto mb-8 sm:mb-12">
            El primer multimodelo de valuación, <span className="text-green-400 font-semibold">fully customizable</span>
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

          {/* Neural Market Analysis CTA */}
          <div className="mt-10 mb-4">
            <Link
              href="/market-sentiment"
              className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600 text-white font-bold text-lg rounded-2xl transition-all shadow-xl shadow-emerald-900/40 border border-emerald-500/30"
            >
              {t('market.neuralAnalysis')}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
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
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-xl transition-all border border-gray-700 text-sm"
            >
              {t('market.neuralAnalysis')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: t('features.neuralEngine.title'),
                description: t('features.neuralEngine.description')
              },
              {
                title: t('features.valuations.title'),
                description: t('features.valuations.description')
              },
              {
                title: t('features.quality.title'),
                description: t('features.quality.description')
              },
              {
                title: t('features.sentiment.title'),
                description: t('features.sentiment.description')
              },
              {
                title: t('features.monteCarlo.title'),
                description: t('features.monteCarlo.description')
              },
              {
                title: t('features.technical.title'),
                description: t('features.technical.description')
              },
              {
                title: t('features.institutional.title'),
                description: t('features.institutional.description')
              },
              {
                title: t('features.journal.title'),
                description: t('features.journal.description')
              },
              {
                title: t('features.forecasts.title'),
                description: t('features.forecasts.description')
              },
            ].map((feature) => (
              <div key={feature.title} className="p-6 rounded-2xl bg-gray-800/50 border border-gray-700/60 hover:border-emerald-500/50 transition group">
                <div className="w-1 h-6 bg-gradient-to-b from-emerald-400 to-teal-500 rounded-full mb-4"></div>
                <h3 className="text-lg font-bold mb-2 group-hover:text-emerald-400 transition">{feature.title}</h3>
                <p className="text-gray-400 text-sm">{feature.description}</p>
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

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('pricing.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('pricing.description')}
            </p>
          </div>

          {/* Plan headers — 4 columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto mb-6">
            {/* Free */}
            <div className="p-5 rounded-2xl bg-gray-900/80 border-2 border-gray-700 flex flex-col items-center text-center">
              <div className="text-sm font-semibold text-gray-400 mb-1">Free</div>
              <div className="text-3xl font-black mb-1">$0</div>
              <div className="text-xs text-gray-500 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/analizar" className="w-full py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold transition text-center block">
                {t('pricing.free.cta')}
              </Link>
            </div>

            {/* Pro */}
            <div className="p-5 rounded-2xl bg-gray-900/80 border-2 border-emerald-500 relative flex flex-col items-center text-center">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                {t('pricing.mostPopular')}
              </div>
              <div className="text-sm font-semibold text-emerald-400 mb-1">Pro</div>
              <div className="text-3xl font-black mb-1">$29</div>
              <div className="text-xs text-gray-500 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/pricing" className="w-full py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-bold transition text-center block">
                {t('pricing.pro.cta')}
              </Link>
            </div>

            {/* Elite */}
            <div className="p-5 rounded-2xl bg-gray-900/80 border-2 border-violet-500 flex flex-col items-center text-center">
              <div className="text-sm font-semibold text-violet-400 mb-1">Elite</div>
              <div className="text-3xl font-black mb-1">$59</div>
              <div className="text-xs text-gray-500 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/pricing" className="w-full py-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white text-sm font-bold transition text-center block">
                {t('pricing.elite.cta')}
              </Link>
            </div>

            {/* Gold */}
            <div className="p-5 rounded-2xl bg-gray-900/80 border-2 border-yellow-500 flex flex-col items-center text-center">
              <div className="text-sm font-semibold text-yellow-400 mb-1">⭐ Gold</div>
              <div className="text-3xl font-black mb-1">$100</div>
              <div className="text-xs text-gray-500 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/pricing" className="w-full py-2 rounded-xl bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white text-sm font-bold transition text-center block">
                {es ? 'Empezar con Gold' : 'Start with Gold'}
              </Link>
            </div>
          </div>

          {/* Comparison table */}
          <div className="max-w-5xl mx-auto bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left p-4 text-gray-400 font-semibold min-w-[180px]">
                      {es ? 'Función' : 'Feature'}
                    </th>
                    <th className="p-3 text-center text-gray-400 font-semibold text-sm">Free</th>
                    <th className="p-3 text-center text-emerald-400 font-semibold text-sm bg-emerald-500/5">Pro</th>
                    <th className="p-3 text-center text-violet-400 font-semibold text-sm">Elite</th>
                    <th className="p-3 text-center text-yellow-400 font-semibold text-sm">Gold</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { feature: es ? 'Estados Financieros + Info General' : 'Financial Statements + General Info', free: true,  pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Competidores + Beta + SGR'           : 'Competitors + Beta + SGR',           free: true,  pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'DDMs + DCF básico'                   : 'DDMs + Basic DCF',                   free: true,  pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Forecasts + Noticias'                : 'Forecasts + News',                   free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'WACC + CAGR + Probabilidad'          : 'WACC + CAGR + Probability',          free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Todos los modelos de valuación'      : 'All valuation models',               free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Key Metrics + DuPont + Holders'      : 'Key Metrics + DuPont + Holders',     free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Diario del Inversor'                 : 'Investor Diary',                     free: false, pro: false, elite: true,  gold: true  },
                    { feature: es ? 'Resumen Maestro Neural (IA)'         : 'Neural Master Summary (AI)',          free: false, pro: false, elite: true,  gold: true  },
                    { feature: es ? 'Exportar PDF'                        : 'Export PDF',                         free: false, pro: false, elite: true,  gold: true  },
                    { feature: es ? 'Acceso Early Beta'                   : 'Early Beta Access',                  free: false, pro: false, elite: false, gold: true  },
                    { feature: es ? 'Soporte'                             : 'Support',                            free: 'Email', pro: es ? 'Prior.' : 'Priority', elite: 'VIP', gold: 'VIP <2h' },
                  ] as { feature: string; free: boolean | string; pro: boolean | string; elite: boolean | string; gold: boolean | string }[]).map((row, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="p-3 text-gray-300 text-sm">{row.feature}</td>
                      <td className="p-3 text-center">{typeof row.free === 'string' ? <span className="text-gray-300 text-xs font-semibold">{row.free}</span> : row.free ? <svg className="w-4 h-4 text-emerald-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-600">—</span>}</td>
                      <td className="p-3 text-center bg-emerald-500/5">{typeof row.pro === 'string' ? <span className="text-gray-300 text-xs font-semibold">{row.pro}</span> : row.pro ? <svg className="w-4 h-4 text-emerald-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-600">—</span>}</td>
                      <td className="p-3 text-center">{typeof row.elite === 'string' ? <span className="text-gray-300 text-xs font-semibold">{row.elite}</span> : row.elite ? <svg className="w-4 h-4 text-emerald-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-600">—</span>}</td>
                      <td className="p-3 text-center">{typeof row.gold === 'string' ? <span className="text-gray-300 text-xs font-semibold">{row.gold}</span> : row.gold ? <svg className="w-4 h-4 text-yellow-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Link to full pricing page */}
          <div className="text-center">
            <Link href="/pricing" className="text-green-400 hover:text-green-300 transition inline-flex items-center gap-2">
              {t('pricing.viewFullComparison')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Valuation Models Section */}
      <section id="models" className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-4xl font-bold mb-4">{t('landing.valuationModelsIncluded')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('landing.valuationModelsDesc') || '20+ modelos profesionales, completamente editables, organizados por metodología'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                category: 'DDM',
                color: 'from-blue-500/20 to-blue-600/5',
                border: 'border-blue-800/40',
                label: 'text-blue-400',
                models: ['DDM 2-Stage', 'DDM 3-Stage', 'H-Model'],
              },
              {
                category: 'FCF',
                color: 'from-emerald-500/20 to-emerald-600/5',
                border: 'border-emerald-800/40',
                label: 'text-emerald-400',
                models: ['2-Stage FCF', '3-Stage FCF', '2-Stage FCFF', '3-Stage FCFF', '2-Stage FCFE', '3-Stage FCFE'],
              },
              {
                category: 'DCF',
                color: 'from-violet-500/20 to-violet-600/5',
                border: 'border-violet-800/40',
                label: 'text-violet-400',
                models: ['DCF Multi-Etapa', 'Monte Carlo DCF', 'Stochastic DCF'],
              },
              {
                category: 'Graham',
                color: 'from-amber-500/20 to-amber-600/5',
                border: 'border-amber-800/40',
                label: 'text-amber-400',
                models: ['Graham Method', 'Graham Number', 'Graham Net-Net'],
              },
              {
                category: 'Avanzados',
                color: 'from-rose-500/20 to-rose-600/5',
                border: 'border-rose-800/40',
                label: 'text-rose-400',
                models: ['RIM Ohlson', 'Bayesian NK DSGE', 'HJM', 'PrismoValue Neural', 'EPS × Benchmark'],
              },
            ].map((group) => (
              <div key={group.category} className={`bg-gradient-to-br ${group.color} border ${group.border} rounded-2xl p-5`}>
                <div className={`text-xs font-bold uppercase tracking-widest ${group.label} mb-3`}>{group.category}</div>
                <ul className="space-y-1.5">
                  {group.models.map((m) => (
                    <li key={m} className="flex items-center gap-2 text-sm text-gray-300">
                      <span className={`w-1 h-1 rounded-full ${group.label.replace('text-', 'bg-')}`} />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <Link href="/analizar" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 transition">
              {t('hero.analyzeButton')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
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
              <p className="text-gray-300 mb-4 leading-relaxed">
                Somos un equipo de profesionales de finanzas con experiencia tanto en el ámbito institucional como en el retail. Hemos trabajado en la valoración de activos, análisis fundamental y gestión de portafolios durante más de una década.
              </p>
              <p className="text-gray-400 mb-4 leading-relaxed">
                Nuestra misión es simple: democratizar el acceso a herramientas de análisis que antes estaban reservadas solo para grandes instituciones. Con Prismo, cualquier inversor puede acceder a modelos de valuación de nivel profesional — sin barreras de entrada.
              </p>
              <p className="text-gray-400 leading-relaxed">
                Creemos que la información de calidad, bien interpretada, es el activo más valioso de un inversor. Prismo es nuestra forma de poner eso en tus manos.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { title: 'Experiencia Institucional', desc: 'Metodologías usadas en fondos de inversión y asset managers de primer nivel.' },
                { title: 'Enfoque Retail', desc: 'Diseñado para ser claro, accesible y accionable para el inversor individual.' },
                { title: 'Rigor Analítico', desc: 'Cada modelo fue validado contra datos reales para garantizar precisión.' },
                { title: 'Sin Conflictos', desc: 'No vendemos recomendaciones. Solo proveemos las herramientas para que decidas vos.' },
              ].map((item) => (
                <div key={item.title} className="p-4 rounded-xl bg-gray-800/50 border border-gray-700/60">
                  <div className="w-6 h-0.5 bg-gradient-to-r from-emerald-400 to-teal-400 rounded-full mb-3"></div>
                  <div className="font-semibold text-sm mb-1 text-white">{item.title}</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{item.desc}</div>
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
              <span className="text-gray-400">© 2025 Prismo. {t('footer.copyright')}</span>
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
