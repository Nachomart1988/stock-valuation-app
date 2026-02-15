'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/i18n/LanguageContext';
import LanguageSelector from './components/LanguageSelector';
import Logo from './components/Logo';
import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [gainers, setGainers] = useState<StockMover[]>([]);
  const [losers, setLosers] = useState<StockMover[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(true);
  const router = useRouter();
  const { t } = useLanguage();

  useEffect(() => {
    const fetchMarketData = async () => {
      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      if (!apiKey) return;

      setLoadingMarket(true);

      try {
        const [newsRes, gainersRes, losersRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/api/v3/stock_news?limit=6&apikey=${apiKey}`),
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
      alert('Ingresa un ticker válido (ej: AAPL)');
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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Logo size="md" />

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-gray-300 hover:text-white transition">{t('nav.features')}</a>
              <a href="#market" className="text-gray-300 hover:text-white transition">{t('nav.market')}</a>
              <a href="#pricing" className="text-gray-300 hover:text-white transition">{t('nav.pricing')}</a>
              <a href="#about" className="text-gray-300 hover:text-white transition">{t('nav.about')}</a>
            </div>

            {/* Auth Buttons + Language Selector */}
            <div className="hidden md:flex items-center gap-4">
              <LanguageSelector />
              <SignedOut>
                <SignInButton mode="modal">
                  <button className="px-4 py-2 text-gray-300 hover:text-white transition">
                    {t('nav.login')}
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="px-5 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-semibold hover:from-blue-600 hover:to-purple-700 transition">
                    {t('nav.register')}
                  </button>
                </SignUpButton>
              </SignedOut>
              <SignedIn>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </div>

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-gray-800">
              <div className="flex flex-col gap-4">
                <a href="#features" className="text-gray-300 hover:text-white transition">Características</a>
                <a href="#market" className="text-gray-300 hover:text-white transition">Mercado</a>
                <a href="#pricing" className="text-gray-300 hover:text-white transition">Precios</a>
                <a href="#about" className="text-gray-300 hover:text-white transition">Nosotros</a>
                <hr className="border-gray-800" />
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="text-gray-300 hover:text-white transition text-left">Iniciar Sesión</button>
                  </SignInButton>
                  <SignUpButton mode="modal">
                    <button className="px-5 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-semibold text-center">
                      Registrarse
                    </button>
                  </SignUpButton>
                </SignedOut>
                <SignedIn>
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-6xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 mb-8">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
            <span className="text-sm text-blue-400">{t('hero.badge')}</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-black mb-6 leading-tight">
            {t('hero.title')}
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              {t('hero.titleHighlight')}
            </span>
          </h1>

          <p className="text-xl text-gray-400 max-w-3xl mx-auto mb-12">
            {t('hero.description')}
            <span className="text-blue-400 font-semibold"> {t('hero.descriptionHighlight')}</span> {t('hero.descriptionEnd')}
          </p>

          {/* Quick Analysis Form */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-xl mx-auto mb-8">
            <input
              type="text"
              placeholder={t('hero.placeholder')}
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleAnalizar()}
              className="flex-1 px-6 py-4 bg-gray-800/50 border border-gray-700 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500"
            />
            <button
              onClick={handleAnalizar}
              className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl text-lg font-bold hover:from-blue-600 hover:to-purple-700 transition transform hover:scale-105 shadow-lg shadow-blue-500/25"
            >
              {t('hero.analyzeButton')}
            </button>
          </div>

          <p className="text-sm text-gray-500">
            {t('hero.noRegister')}
          </p>

          {/* Stats - Focus on Valuation Models */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-16 max-w-4xl mx-auto">
            {[
              { number: '20+', label: t('stats.models') },
              { number: '100%', label: t('stats.editableInputs') },
              { number: '21', label: t('stats.analysisTabs') },
              { number: '5000', label: t('stats.monteCarloSims') },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  {stat.number}
                </div>
                <div className="text-sm text-gray-500 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Valuation Models Showcase */}
          <div className="mt-16 p-6 bg-gray-800/30 rounded-2xl border border-gray-700">
            <h3 className="text-lg font-semibold text-gray-300 mb-4">Modelos de Valuación Incluidos</h3>
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
                  className="px-3 py-1.5 bg-gray-700/50 text-gray-300 text-sm rounded-lg border border-gray-600 hover:border-blue-500 hover:text-blue-400 transition cursor-default"
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
            <h2 className="text-4xl font-bold mb-4">{t('market.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto mb-6">
              {t('market.description')}
            </p>
            <Link
              href="/market-sentiment"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-500/25"
            >
              <span className="text-xl">🧠</span>
              Ver Análisis Neural del Mercado
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          {loadingMarket ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
            </div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Top Gainers */}
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">📈</span>
                  <h3 className="text-xl font-bold text-green-400">Top Gainers</h3>
                </div>
                {gainers.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No data available</p>
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
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">📉</span>
                  <h3 className="text-xl font-bold text-red-400">Top Losers</h3>
                </div>
                {losers.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No data available</p>
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
              <div className="bg-gray-800/50 rounded-2xl border border-gray-700 p-6 lg:row-span-1">
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-2xl">📰</span>
                  <h3 className="text-xl font-bold text-blue-400">Latest News</h3>
                </div>
                {news.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No news available</p>
                ) : (
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                    {news.map((item, idx) => (
                      <a
                        key={idx}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 rounded-xl bg-gray-700/30 border border-gray-600/30 hover:border-blue-500/50 transition"
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
                            <p className="text-sm font-medium text-gray-200 line-clamp-2 hover:text-blue-400 transition">
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
            <h2 className="text-4xl font-bold mb-4">Características Principales</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Herramientas profesionales de análisis financiero al alcance de todos
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: '🧠',
                title: 'Motor Neural de 12 Capas',
                description: 'Análisis profundo que combina NLP, Monte Carlo, flujo institucional y más para recomendaciones precisas.'
              },
              {
                icon: '📊',
                title: 'Valuaciones Múltiples',
                description: 'DCF, DDM, Graham, Owner Earnings, EV/EBITDA, PEG y más modelos de valuación integrados.'
              },
              {
                icon: '🎯',
                title: 'Análisis de Calidad',
                description: '5 dimensiones: Rentabilidad, Fortaleza Financiera, Eficiencia, Crecimiento y Moat competitivo.'
              },
              {
                icon: '📰',
                title: 'Sentimiento de Noticias',
                description: 'Análisis NLP de noticias financieras con lexicons especializados bullish/bearish.'
              },
              {
                icon: '🎲',
                title: 'Simulación Monte Carlo',
                description: '5000 simulaciones para estimar probabilidades y rangos de precios objetivo.'
              },
              {
                icon: '📈',
                title: 'Análisis Técnico',
                description: 'Pivots, soportes, resistencias, Fibonacci y patrones de precio automatizados.'
              },
              {
                icon: '🏛️',
                title: 'Flujo Institucional',
                description: 'Seguimiento de movimientos de fondos institucionales y "smart money".'
              },
              {
                icon: '📋',
                title: 'Diario del Inversor',
                description: 'Registra tus operaciones, calcula P&L y analiza tu rendimiento histórico.'
              },
              {
                icon: '🔮',
                title: 'Forecasts de Analistas',
                description: 'Consenso de analistas de Wall Street con estimaciones de revenue y EPS.'
              },
            ].map((feature) => (
              <div key={feature.title} className="p-6 rounded-2xl bg-gray-800/50 border border-gray-700/50 hover:border-blue-500/50 transition group">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-xl font-bold mb-2 group-hover:text-blue-400 transition">{feature.title}</h3>
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
            <h2 className="text-4xl font-bold mb-4">Cómo Funciona</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Tres simples pasos para obtener análisis profesionales
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Ingresa el Ticker',
                description: 'Escribe el símbolo de la acción que deseas analizar (ej: AAPL, TSLA, MELI).',
                color: 'from-blue-500 to-cyan-500'
              },
              {
                step: '02',
                title: 'Análisis Automático',
                description: 'Nuestro motor neural procesa 12 capas de análisis en segundos.',
                color: 'from-purple-500 to-pink-500'
              },
              {
                step: '03',
                title: 'Recomendación Final',
                description: 'Recibe una recomendación clara con precio objetivo, riesgos y catalizadores.',
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
            <h2 className="text-4xl font-bold mb-4">21 Módulos de Análisis</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Cada módulo está diseñado para darte una perspectiva única de la empresa
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              'Inicio', 'General', 'Cálculos', 'Beta', 'WACC', 'CAGR', 'SGR',
              'Valuaciones', 'Key Metrics', 'DuPont', 'Forecasts', 'Revenue Forecast',
              'Competidores', 'Industry', 'Holders', 'Pivots', 'Noticias',
              'Segmentation', 'Análisis Final', 'Diario Inversor', 'Resumen Maestro'
            ].map((module, i) => (
              <div
                key={module}
                className="px-4 py-3 rounded-xl bg-gray-800/50 border border-gray-700/50 text-center hover:border-purple-500/50 hover:bg-purple-500/10 transition cursor-pointer"
              >
                <span className="text-xs text-gray-500 mr-2">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-gray-300">{module}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-4 bg-gray-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Planes y Precios</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              Elige el plan que mejor se adapte a tus necesidades
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className="p-8 rounded-2xl bg-gray-800/50 border border-gray-700/50">
              <div className="text-lg font-semibold text-gray-400 mb-2">Free</div>
              <div className="text-4xl font-bold mb-6">$0<span className="text-lg text-gray-500">/mes</span></div>
              <ul className="space-y-3 mb-8">
                {['5 análisis por día', 'Pestañas básicas', 'Datos en tiempo real', 'Soporte por email'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-400">
                    <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/analizar" className="block w-full py-3 rounded-xl border border-gray-600 text-gray-300 font-semibold hover:bg-gray-700/50 transition text-center">
                Empezar Gratis
              </Link>
            </div>

            {/* Pro Plan */}
            <div className="p-8 rounded-2xl bg-gradient-to-b from-blue-900/50 to-purple-900/50 border-2 border-blue-500/50 relative">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full text-sm font-semibold">
                Más Popular
              </div>
              <div className="text-lg font-semibold text-blue-400 mb-2">Pro</div>
              <div className="text-4xl font-bold mb-6">$29<span className="text-lg text-gray-500">/mes</span></div>
              <ul className="space-y-3 mb-8">
                {['Análisis ilimitados', 'Todas las 21+ pestañas', 'Resumen Neural con IA', '20+ modelos de valuación', 'Inputs personalizables', 'Exportación PDF + Excel'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-300">
                    <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/pricing" className="block w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 font-semibold hover:from-blue-600 hover:to-purple-700 transition text-center">
                Elegir Pro
              </Link>
            </div>

            {/* Elite Plan */}
            <div className="p-8 rounded-2xl bg-gray-800/50 border border-gray-700/50">
              <div className="text-lg font-semibold text-gray-400 mb-2">Elite</div>
              <div className="text-4xl font-bold mb-6">$79<span className="text-lg text-gray-500">/mes</span></div>
              <ul className="space-y-3 mb-8">
                {['Todo lo de Pro', 'API de acceso', 'Reportes personalizados', 'Soporte VIP (<2h)', 'Webinars privados', 'Consultoría 1-on-1'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-400">
                    <svg className="w-5 h-5 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/pricing" className="block w-full py-3 rounded-xl border border-gray-600 text-gray-300 font-semibold hover:bg-gray-700/50 transition text-center">
                Elegir Elite
              </Link>
            </div>
          </div>

          {/* Link to full pricing page */}
          <div className="text-center mt-8">
            <Link href="/pricing" className="text-blue-400 hover:text-blue-300 transition inline-flex items-center gap-2">
              Ver comparación completa de planes
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
              <h2 className="text-4xl font-bold mb-6">Quiénes Somos</h2>
              <p className="text-gray-400 mb-4">
                Somos un equipo de ingenieros financieros y desarrolladores de software apasionados
                por democratizar el acceso a herramientas de análisis profesional.
              </p>
              <p className="text-gray-400 mb-4">
                Nuestra misión es proporcionar a inversores individuales las mismas herramientas
                analíticas que utilizan los fondos de inversión institucionales, pero de una manera
                accesible y fácil de entender.
              </p>
              <p className="text-gray-400">
                Combinamos inteligencia artificial, análisis fundamental y técnico para ofrecer
                recomendaciones de inversión respaldadas por datos y metodologías probadas.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: '🎯', title: 'Misión', desc: 'Democratizar el análisis financiero profesional' },
                { icon: '👁️', title: 'Visión', desc: 'Ser la plataforma #1 de análisis para retail' },
                { icon: '💡', title: 'Innovación', desc: 'IA y machine learning aplicados a finanzas' },
                { icon: '🤝', title: 'Confianza', desc: 'Transparencia en metodologías y datos' },
              ].map((item) => (
                <div key={item.title} className="p-4 rounded-xl bg-gray-800/50 border border-gray-700/50">
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
          <h2 className="text-4xl font-bold mb-6">
            Comienza a Analizar Hoy
          </h2>
          <p className="text-xl text-gray-400 mb-8">
            Únete a miles de inversores que ya utilizan StockAnalyzer para tomar decisiones informadas.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl text-lg font-bold hover:from-blue-600 hover:to-purple-700 transition"
            >
              Crear Cuenta Gratis
            </Link>
            <Link
              href="/analizar"
              className="px-8 py-4 border border-gray-600 rounded-xl text-lg font-semibold hover:bg-gray-800 transition"
            >
              Probar Sin Registro
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
              <h4 className="font-semibold mb-4">Compañía</h4>
              <ul className="space-y-2">
                <li><a href="#about" className="text-gray-400 hover:text-white transition">Nosotros</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Blog</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Careers</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Prensa</a></li>
              </ul>
            </div>

            {/* Product */}
            <div>
              <h4 className="font-semibold mb-4">Producto</h4>
              <ul className="space-y-2">
                <li><a href="#features" className="text-gray-400 hover:text-white transition">Características</a></li>
                <li><a href="#pricing" className="text-gray-400 hover:text-white transition">Precios</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">API</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Integraciones</a></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <h4 className="font-semibold mb-4">Recursos</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition">Documentación</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Guías</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">FAQ</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Soporte</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white transition">Privacidad</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Términos</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Cookies</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white transition">Licencias</a></li>
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
              <strong>Disclaimer:</strong> La información proporcionada por StockAnalyzer es únicamente con fines educativos e informativos.
              No constituye asesoramiento financiero, de inversión o de cualquier otro tipo. Siempre consulta con un profesional
              financiero antes de tomar decisiones de inversión.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
