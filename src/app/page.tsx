'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/i18n/LanguageContext';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import Header from '@/app/components/Header';
import Logo from '@/app/components/Logo';
import { fetchFmp } from '@/lib/fmpClient';
import EarningsCalendarSection from '@/app/components/EarningsCalendarSection';

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
      setLoadingMarket(true);

      try {
        const [newsData, gainersData, losersData] = await Promise.all([
          fetchFmp('stable/news/general-latest', { page: 0, limit: 6 }).catch(() => []),
          fetchFmp('stable/biggest-gainers').catch(() => []),
          fetchFmp('stable/biggest-losers').catch(() => []),
        ]);

        setNews(Array.isArray(newsData) ? newsData.slice(0, 6) : []);
        setGainers(Array.isArray(gainersData) ? gainersData.slice(0, 5) : []);
        setLosers(Array.isArray(losersData) ? losersData.slice(0, 5) : []);
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
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Navigation */}
      <Header />

      {/* Hero Section */}
      <section className="pt-36 pb-24 px-4">
        <div className="max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-10">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
            <span className="text-xs font-medium text-gray-400 tracking-wide">{t('hero.badge')}</span>
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-8xl font-black mb-6 leading-[0.9] tracking-tight">
            <span className="bg-gradient-to-b from-white via-white to-gray-400 bg-clip-text text-transparent">
              PRISMO
            </span>
          </h1>

          <p className="text-base sm:text-lg text-gray-400 max-w-lg mx-auto mb-10 sm:mb-14 leading-relaxed">
            {es
              ? <>El primer multimodelo de valuaci&oacute;n, <span className="text-white font-semibold">fully customizable</span></>
              : <>The first valuation multi-model, <span className="text-white font-semibold">fully customizable</span></>
            }
          </p>

          {/* Quick Analysis Form */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto mb-6">
            <input
              type="text"
              placeholder={t('hero.placeholder')}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalizar()}
              className="flex-1 px-5 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-base focus:outline-none focus:border-white/[0.2] placeholder-gray-600 transition-colors"
            />
            <button
              onClick={handleAnalizar}
              className="px-7 py-3.5 bg-white text-gray-950 rounded-lg text-sm font-bold hover:bg-gray-100 transition-colors"
            >
              {t('hero.analyzeButton')}
            </button>
          </div>

          <p className="text-xs text-gray-600 mb-16">
            {t('hero.noRegister')}
          </p>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-10 max-w-3xl mx-auto">
            {[
              { number: '20+', label: t('stats.models') },
              { number: '100%', label: t('stats.editableInputs') },
              { number: '21', label: t('stats.analysisTabs') },
              { number: '5000', label: t('stats.monteCarloSims') },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-black text-white">
                  {stat.number}
                </div>
                <div className="text-xs text-gray-500 mt-1 tracking-wide">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Neural Market Analysis CTA */}
          <div className="mt-14 mb-4">
            <Link
              href="/market-sentiment"
              className="inline-flex items-center gap-2.5 px-6 py-3 bg-white/[0.06] hover:bg-white/[0.10] text-gray-200 font-semibold text-sm rounded-lg transition-all border border-white/[0.08]"
            >
              {t('market.neuralAnalysis')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

        </div>
      </section>

      {/* Market Movers Section */}
      <section id="market" className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-4xl font-bold mb-3">{t('market.title')}</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm mb-6">
              {t('market.description')}
            </p>
            <Link
              href="/market-sentiment"
              className="inline-flex items-center gap-2 px-5 py-2 bg-white/[0.04] hover:bg-white/[0.07] text-gray-300 font-medium rounded-lg transition-all border border-white/[0.08] text-xs tracking-wide"
            >
              {t('market.neuralAnalysis')}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          {loadingMarket ? (
            <div className="flex justify-center py-12">
              <LogoLoader size="md" />
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-5">
              {/* Top Gainers */}
              <div className="bg-gray-900/40 rounded-xl border border-white/[0.06] p-5">
                <div className="flex items-center gap-2.5 mb-5">
                  <div className="w-2 h-2 rounded-full bg-green-400"></div>
                  <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{t('market.topGainers')}</h3>
                </div>
                {gainers.length === 0 ? (
                  <p className="text-gray-600 text-center py-4 text-sm">{t('market.noData')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {gainers.map((stock, idx) => (
                      <div
                        key={stock.symbol}
                        className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition cursor-pointer border border-transparent hover:border-white/[0.06]"
                        onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-gray-600 text-xs font-mono w-4">{idx + 1}</span>
                          <div>
                            <p className="font-semibold text-sm text-white">{stock.symbol}</p>
                            <p className="text-[11px] text-gray-500 truncate max-w-[120px]">{stock.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-300 font-mono">${stock.price?.toFixed(2)}</p>
                          <p className="text-xs text-green-400 font-semibold font-mono">
                            +{stock.changesPercentage?.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top Losers */}
              <div className="bg-gray-900/40 rounded-xl border border-white/[0.06] p-5">
                <div className="flex items-center gap-2.5 mb-5">
                  <div className="w-2 h-2 rounded-full bg-red-400"></div>
                  <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{t('market.topLosers')}</h3>
                </div>
                {losers.length === 0 ? (
                  <p className="text-gray-600 text-center py-4 text-sm">{t('market.noData')}</p>
                ) : (
                  <div className="space-y-1.5">
                    {losers.map((stock, idx) => (
                      <div
                        key={stock.symbol}
                        className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/[0.03] transition cursor-pointer border border-transparent hover:border-white/[0.06]"
                        onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-gray-600 text-xs font-mono w-4">{idx + 1}</span>
                          <div>
                            <p className="font-semibold text-sm text-white">{stock.symbol}</p>
                            <p className="text-[11px] text-gray-500 truncate max-w-[120px]">{stock.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-300 font-mono">${stock.price?.toFixed(2)}</p>
                          <p className="text-xs text-red-400 font-semibold font-mono">
                            {stock.changesPercentage?.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Latest News */}
              <div className="bg-gray-900/40 rounded-xl border border-white/[0.06] p-5 lg:row-span-1">
                <div className="flex items-center gap-2.5 mb-5">
                  <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                  <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">{t('market.latestNews')}</h3>
                </div>
                {news.length === 0 ? (
                  <p className="text-gray-600 text-center py-4 text-sm">{t('landing.noNewsAvailable')}</p>
                ) : (
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {news.map((item, idx) => (
                      <a
                        key={idx}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block px-3 py-2.5 rounded-lg hover:bg-white/[0.03] border border-transparent hover:border-white/[0.06] transition"
                      >
                        <div className="flex gap-3">
                          {item.image && (
                            <img
                              src={item.image}
                              alt=""
                              className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-300 line-clamp-2 leading-snug">
                              {item.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11px] text-gray-600">{item.site}</span>
                              <span className="text-[11px] text-gray-700">&bull;</span>
                              <span className="text-[11px] text-gray-600">{formatTimeAgo(item.publishedDate)}</span>
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

      {/* Earnings Calendar */}
      <EarningsCalendarSection />

      {/* Features Section */}
      <section id="features" className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-4xl font-bold mb-3">{t('features.title')}</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm">
              {t('features.description')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              <div key={feature.title} className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition group">
                <h3 className="text-sm font-semibold mb-1.5 text-gray-200 group-hover:text-white transition">{feature.title}</h3>
                <p className="text-gray-500 text-xs leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-2xl sm:text-4xl font-bold mb-3">{t('howItWorks.title')}</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm">
              {t('howItWorks.description')}
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                title: t('howItWorks.step1.title'),
                description: t('howItWorks.step1.description'),
              },
              {
                step: '02',
                title: t('howItWorks.step2.title'),
                description: t('howItWorks.step2.description'),
              },
              {
                step: '03',
                title: t('howItWorks.step3.title'),
                description: t('howItWorks.step3.description'),
              },
            ].map((item, i) => (
              <div key={item.step} className="relative p-5 rounded-xl border border-white/[0.06]">
                <span className="text-[11px] font-mono text-gray-600 tracking-wider">{item.step}</span>
                <h3 className="text-base font-semibold mt-2 mb-2 text-white">{item.title}</h3>
                <p className="text-gray-500 text-xs leading-relaxed">{item.description}</p>
                {i < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 text-gray-700 text-sm">
                    &rarr;
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-4xl font-bold mb-3">{t('pricing.title')}</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm">
              {t('pricing.description')}
            </p>
          </div>

          {/* Plan headers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {/* Free */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] flex flex-col items-center text-center">
              <div className="text-xs font-medium text-gray-500 mb-1">Free</div>
              <div className="text-2xl font-black mb-0.5">$0</div>
              <div className="text-[11px] text-gray-600 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/register" className="w-full py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 text-xs font-semibold transition text-center block border border-white/[0.06]">
                {t('pricing.free.cta')}
              </Link>
            </div>

            {/* Pro */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-emerald-500/40 relative flex flex-col items-center text-center">
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap">
                {t('pricing.mostPopular')}
              </div>
              <div className="text-xs font-medium text-emerald-400 mb-1">Pro</div>
              <div className="text-2xl font-black mb-0.5">$29</div>
              <div className="text-[11px] text-gray-600 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/pricing" className="w-full py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold transition text-center block">
                {t('pricing.pro.cta')}
              </Link>
            </div>

            {/* Elite */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-violet-500/40 flex flex-col items-center text-center">
              <div className="text-xs font-medium text-violet-400 mb-1">Elite</div>
              <div className="text-2xl font-black mb-0.5">$59</div>
              <div className="text-[11px] text-gray-600 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/pricing" className="w-full py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-white text-xs font-bold transition text-center block">
                {t('pricing.elite.cta')}
              </Link>
            </div>

            {/* Gold */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-amber-500/40 flex flex-col items-center text-center">
              <div className="text-xs font-medium text-amber-400 mb-1">Gold</div>
              <div className="text-2xl font-black mb-0.5">$100</div>
              <div className="text-[11px] text-gray-600 mb-4">{t('pricing.perMonth')}</div>
              <Link href="/pricing" className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition text-center block">
                {es ? 'Empezar con Gold' : 'Start with Gold'}
              </Link>
            </div>
          </div>

          {/* Comparison table */}
          <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left p-3 text-gray-500 font-medium text-xs uppercase tracking-wider min-w-[180px]">
                      {es ? 'Funci\u00f3n' : 'Feature'}
                    </th>
                    <th className="p-3 text-center text-gray-500 font-medium text-xs">Free</th>
                    <th className="p-3 text-center text-emerald-400/80 font-medium text-xs bg-emerald-500/[0.03]">Pro</th>
                    <th className="p-3 text-center text-violet-400/80 font-medium text-xs">Elite</th>
                    <th className="p-3 text-center text-amber-400/80 font-medium text-xs">Gold</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { feature: es ? 'Estados Financieros + Info General' : 'Financial Statements + General Info', free: true,  pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Competidores + Beta + SGR'           : 'Competitors + Beta + SGR',           free: true,  pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'DDMs + DCF b\u00e1sico'              : 'DDMs + Basic DCF',                   free: true,  pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Forecasts + Noticias'                : 'Forecasts + News',                   free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'WACC + CAGR + Probabilidad'          : 'WACC + CAGR + Probability',          free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Todos los modelos de valuaci\u00f3n' : 'All valuation models',               free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Key Metrics + DuPont + Holders'      : 'Key Metrics + DuPont + Holders',     free: false, pro: true,  elite: true,  gold: true  },
                    { feature: es ? 'Diario del Inversor'                 : 'Investor Diary',                     free: false, pro: false, elite: true,  gold: true  },
                    { feature: es ? 'Resumen Maestro Neural (IA)'         : 'Neural Master Summary (AI)',          free: false, pro: false, elite: true,  gold: true  },
                    { feature: es ? 'Exportar PDF'                        : 'Export PDF',                         free: false, pro: false, elite: true,  gold: true  },
                    { feature: es ? 'Acceso Early Beta'                   : 'Early Beta Access',                  free: false, pro: false, elite: false, gold: true  },
                    { feature: es ? 'Soporte'                             : 'Support',                            free: 'Email', pro: es ? 'Prior.' : 'Priority', elite: 'VIP', gold: 'VIP <2h' },
                  ] as { feature: string; free: boolean | string; pro: boolean | string; elite: boolean | string; gold: boolean | string }[]).map((row, i) => (
                    <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                      <td className="p-3 text-gray-400 text-xs">{row.feature}</td>
                      <td className="p-3 text-center">{typeof row.free === 'string' ? <span className="text-gray-400 text-[11px] font-medium">{row.free}</span> : row.free ? <svg className="w-3.5 h-3.5 text-emerald-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-700">&mdash;</span>}</td>
                      <td className="p-3 text-center bg-emerald-500/[0.03]">{typeof row.pro === 'string' ? <span className="text-gray-400 text-[11px] font-medium">{row.pro}</span> : row.pro ? <svg className="w-3.5 h-3.5 text-emerald-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-700">&mdash;</span>}</td>
                      <td className="p-3 text-center">{typeof row.elite === 'string' ? <span className="text-gray-400 text-[11px] font-medium">{row.elite}</span> : row.elite ? <svg className="w-3.5 h-3.5 text-violet-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-700">&mdash;</span>}</td>
                      <td className="p-3 text-center">{typeof row.gold === 'string' ? <span className="text-gray-400 text-[11px] font-medium">{row.gold}</span> : row.gold ? <svg className="w-3.5 h-3.5 text-amber-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg> : <span className="text-gray-700">&mdash;</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Link to full pricing page */}
          <div className="text-center">
            <Link href="/pricing" className="text-gray-400 hover:text-white transition inline-flex items-center gap-1.5 text-xs font-medium">
              {t('pricing.viewFullComparison')}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Valuation Models Section */}
      <section id="models" className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-4xl font-bold mb-3">{t('landing.valuationModelsIncluded')}</h2>
            <p className="text-gray-500 max-w-xl mx-auto text-sm">
              {t('landing.valuationModelsDesc') || (es ? '20+ modelos profesionales, completamente editables, organizados por metodolog\u00eda' : '20+ professional models, fully editable, organized by methodology')}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              {
                category: 'DDM',
                accent: 'text-blue-400',
                dot: 'bg-blue-400',
                models: ['DDM 2-Stage', 'DDM 3-Stage', 'H-Model'],
              },
              {
                category: 'FCF',
                accent: 'text-emerald-400',
                dot: 'bg-emerald-400',
                models: ['2-Stage FCF', '3-Stage FCF', '2-Stage FCFF', '3-Stage FCFF', '2-Stage FCFE', '3-Stage FCFE'],
              },
              {
                category: 'DCF',
                accent: 'text-violet-400',
                dot: 'bg-violet-400',
                models: ['DCF Multi-Etapa', 'Monte Carlo DCF', 'Stochastic DCF'],
              },
              {
                category: 'Graham',
                accent: 'text-amber-400',
                dot: 'bg-amber-400',
                models: ['Graham Method', 'Graham Number', 'Graham Net-Net'],
              },
              {
                category: es ? 'Avanzados' : 'Advanced',
                accent: 'text-rose-400',
                dot: 'bg-rose-400',
                models: ['RIM Ohlson', 'Bayesian NK DSGE', 'HJM', 'PrismoValue Neural', 'EPS x Benchmark'],
              },
            ].map((group) => (
              <div key={group.category} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <div className={`text-[10px] font-bold uppercase tracking-widest ${group.accent} mb-3`}>{group.category}</div>
                <ul className="space-y-1.5">
                  {group.models.map((m) => (
                    <li key={m} className="flex items-center gap-2 text-xs text-gray-400">
                      <span className={`w-1 h-1 rounded-full ${group.dot} shrink-0`} />
                      {m}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <Link href="/analizar" className="inline-flex items-center gap-2 px-6 py-2.5 bg-white text-gray-950 rounded-lg text-sm font-bold hover:bg-gray-200 transition">
              {t('hero.analyzeButton')}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* About Us */}
      <section id="about" className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 items-start">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">{t('about.title')}</h2>
              <p className="text-gray-400 text-sm mb-3 leading-relaxed">
                {es
                  ? 'Somos un equipo de profesionales de finanzas con experiencia tanto en el \u00e1mbito institucional como en el retail. Hemos trabajado en la valoraci\u00f3n de activos, an\u00e1lisis fundamental y gesti\u00f3n de portafolios durante m\u00e1s de una d\u00e9cada.'
                  : 'We are a team of finance professionals with experience in both institutional and retail markets. We have worked in asset valuation, fundamental analysis, and portfolio management for over a decade.'}
              </p>
              <p className="text-gray-500 text-sm mb-3 leading-relaxed">
                {es
                  ? 'Nuestra misi\u00f3n es simple: democratizar el acceso a herramientas de an\u00e1lisis que antes estaban reservadas solo para grandes instituciones. Con Prismo, cualquier inversor puede acceder a modelos de valuaci\u00f3n de nivel profesional \u2014 sin barreras de entrada.'
                  : 'Our mission is simple: democratize access to analysis tools that were previously reserved for large institutions. With Prismo, any investor can access professional-grade valuation models \u2014 with no barriers to entry.'}
              </p>
              <p className="text-gray-500 text-sm leading-relaxed">
                {es
                  ? 'Creemos que la informaci\u00f3n de calidad, bien interpretada, es el activo m\u00e1s valioso de un inversor. Prismo es nuestra forma de poner eso en tus manos.'
                  : 'We believe that quality information, well interpreted, is an investor\'s most valuable asset. Prismo is our way of putting that in your hands.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { title: es ? 'Experiencia Institucional' : 'Institutional Experience', desc: es ? 'Metodolog\u00edas usadas en fondos de inversi\u00f3n y asset managers de primer nivel.' : 'Methodologies used by top-tier investment funds and asset managers.' },
                { title: es ? 'Enfoque Retail' : 'Retail Focus', desc: es ? 'Dise\u00f1ado para ser claro, accesible y accionable para el inversor individual.' : 'Designed to be clear, accessible, and actionable for the individual investor.' },
                { title: es ? 'Rigor Anal\u00edtico' : 'Analytical Rigor', desc: es ? 'Cada modelo fue validado contra datos reales para garantizar precisi\u00f3n.' : 'Every model was validated against real data to ensure accuracy.' },
                { title: es ? 'Sin Conflictos' : 'No Conflicts', desc: es ? 'No damos consejos de inversi\u00f3n. Solo proveemos las herramientas para que decidas vos.' : 'We don\'t give investment advice. We only provide the tools for you to decide.' },
              ].map((item) => (
                <div key={item.title} className="p-4 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                  <div className="font-semibold text-xs mb-1.5 text-gray-200">{item.title}</div>
                  <div className="text-[11px] text-gray-500 leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 border-t border-white/[0.04]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            {t('cta.title')}
          </h2>
          <p className="text-sm text-gray-500 mb-8 max-w-lg mx-auto">
            {t('cta.description')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/register"
              className="px-7 py-3 bg-white text-gray-950 rounded-lg text-sm font-bold hover:bg-gray-200 transition"
            >
              {t('cta.createAccount')}
            </Link>
            <Link
              href="/analizar"
              className="px-7 py-3 border border-white/[0.08] rounded-lg text-sm font-medium text-gray-300 hover:bg-white/[0.04] transition"
            >
              {t('cta.tryWithoutRegister')}
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-4 border-t border-white/[0.06]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {/* Company */}
            <div>
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">{t('footer.company')}</h4>
              <ul className="space-y-2">
                <li><a href="#about" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.aboutUs')}</a></li>
                <li><Link href="/blog" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.blog')}</Link></li>
                <li><Link href="/careers" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.careers')}</Link></li>
                <li><Link href="/press" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.press')}</Link></li>
              </ul>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">{t('footer.product')}</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.features')}</a></li>
                <li><Link href="/pricing" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.pricing')}</Link></li>
                <li><Link href="/api-info" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.api')}</Link></li>
                <li><Link href="/api-info" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.integrations')}</Link></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">{t('footer.resources')}</h4>
              <ul className="space-y-2">
                <li><Link href="/docs" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.documentation')}</Link></li>
                <li><Link href="/guides" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.guides')}</Link></li>
                <li><Link href="/faq" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.faq')}</Link></li>
                <li><Link href="/support" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.support')}</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3">{t('footer.legal')}</h4>
              <ul className="space-y-2">
                <li><Link href="/privacy" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.privacy')}</Link></li>
                <li><Link href="/terms" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.terms')}</Link></li>
                <li><Link href="/cookies" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.cookies')}</Link></li>
                <li><Link href="/licenses" className="text-xs text-gray-500 hover:text-gray-300 transition">{t('footer.licenses')}</Link></li>
              </ul>
            </div>
          </div>

          {/* Bottom Footer */}
          <div className="flex flex-col md:flex-row items-center justify-between pt-6 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 mb-4 md:mb-0">
              <Logo size="sm" showText={false} linkTo="/" />
              <span className="text-xs text-gray-600">&copy; 2025 Prismo. {t('footer.copyright')}</span>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-2">
              {['Twitter', 'LinkedIn', 'GitHub', 'YouTube'].map((social) => (
                <a key={social} href="#" className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-gray-600 hover:text-gray-300 hover:border-white/[0.12] transition text-xs font-medium">
                  {social[0]}
                </a>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-6 px-4 py-3 rounded-lg border border-white/[0.06]">
            <p className="text-[11px] text-gray-600 text-center">
              <strong className="text-gray-500">Disclaimer:</strong> {t('footer.disclaimer')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
