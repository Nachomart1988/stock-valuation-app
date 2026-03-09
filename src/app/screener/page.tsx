'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/app/components/Header';
import { useLanguage } from '@/i18n/LanguageContext';

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

interface TopOpportunity {
  symbol: string;
  companyName: string;
  sector: string;
  currentPrice: number;
  intrinsicValue: number;
  upside: number;
  marketCap: number;
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
const SCREENER_LIMIT = 20;

const fmtMktCap = (v: number) => {
  if (!v) return '–';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
};

export default function ScreenerPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [screenerResults, setScreenerResults] = useState<ScreenerResult[]>([]);
  const [screenerLoading, setScreenerLoading] = useState(false);
  const [screenerError, setScreenerError] = useState<string | null>(null);
  const [screenerPage, setScreenerPage] = useState(0);
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

  // Prismo Top Opportunities state
  const [topOpportunities, setTopOpportunities] = useState<TopOpportunity[]>([]);
  const [prismoLoading, setPrismoLoading] = useState(false);
  const [prismoError, setPrismoError] = useState<string | null>(null);
  const [prismoStats, setPrismoStats] = useState({ total: 0, analyzed: 0 });
  const [prismoFilters, setPrismoFilters] = useState({
    priceMin: '5',
    priceMax: '500',
    marketCapMin: '500000000',
    country: 'US',
  });

  const buildScreenerParams = (limit: number, offset: number) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
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
    return params;
  };

  const runScreener = async (page = 0) => {
    setScreenerLoading(true);
    setScreenerError(null);
    try {
      const params = buildScreenerParams(SCREENER_LIMIT, page * SCREENER_LIMIT);
      const res = await fetch(`/api/screener?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Screener error (HTTP ${res.status})`);
      }
      const data = await res.json();
      setScreenerResults(Array.isArray(data) ? data : []);
      setScreenerPage(page);
    } catch (err: any) {
      setScreenerError(err.message || 'Screener error');
    } finally {
      setScreenerLoading(false);
    }
  };

  const discoverTopOpportunities = useCallback(async () => {
    setPrismoLoading(true);
    setPrismoError(null);
    setTopOpportunities([]);
    setPrismoStats({ total: 0, analyzed: 0 });

    try {
      const params = new URLSearchParams({
        priceMin: prismoFilters.priceMin || '5',
        priceMax: prismoFilters.priceMax || '500',
        marketCapMin: prismoFilters.marketCapMin || '500000000',
        country: prismoFilters.country || 'US',
      });

      const res = await fetch(`/api/prismo-top?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error (HTTP ${res.status})`);
      }

      const data = await res.json();
      setPrismoStats({ total: data.total || 0, analyzed: data.analyzed || 0 });

      if (!data.opportunities?.length) {
        const debugMsg = data.debug ? ` (${data.debug})` : '';
        setPrismoError(
          data.total === 0
            ? `${t('screener.prismo.noResults')}${debugMsg}`
            : t('screener.prismo.noResults')
        );
      } else {
        setTopOpportunities(data.opportunities);
      }
    } catch (err: any) {
      setPrismoError(err.message || 'Error discovering opportunities');
    } finally {
      setPrismoLoading(false);
    }
  }, [prismoFilters, t]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />
      <div className="max-w-7xl mx-auto px-4 pt-28 pb-20">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
            <span className="text-emerald-400 text-xs font-semibold tracking-widest uppercase">Stock Screener</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black mb-4">
            {t('screener.title')}{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">{t('screener.titleHighlight')}</span>
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            {t('screener.subtitle')}
          </p>
        </div>

        {/* ═══════ Prismo Top Opportunities ═══════ */}
        <div className="relative mb-8 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-900/10 via-black/60 to-amber-900/5 overflow-hidden">
          {/* Shimmer overlay */}
          <div className="absolute inset-0 pointer-events-none liquid-gold-shimmer" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-2">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-amber-300 flex items-center gap-2">
                  <svg className="w-6 h-6 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {t('screener.prismo.title')}
                </h2>
                <p className="text-gray-400 text-sm mt-1 max-w-xl">
                  {t('screener.prismo.subtitle')}
                </p>
              </div>
              <button
                onClick={discoverTopOpportunities}
                disabled={prismoLoading}
                className="shrink-0 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 text-black font-bold rounded-xl shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all text-sm"
              >
                {prismoLoading ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                )}
                {prismoLoading ? t('screener.prismo.discovering') : t('screener.prismo.discover')}
              </button>
            </div>

            {/* Prismo filters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 p-3 bg-black/30 rounded-xl border border-amber-900/15">
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">{t('screener.priceMin')}</label>
                <input type="number" min="0" placeholder="5"
                  value={prismoFilters.priceMin}
                  onChange={e => setPrismoFilters(f => ({ ...f, priceMin: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-black/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">{t('screener.priceMax')}</label>
                <input type="number" min="0" placeholder="500"
                  value={prismoFilters.priceMax}
                  onChange={e => setPrismoFilters(f => ({ ...f, priceMax: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-black/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">Mkt Cap min</label>
                <select
                  value={prismoFilters.marketCapMin}
                  onChange={e => setPrismoFilters(f => ({ ...f, marketCapMin: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-black/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                >
                  <option value="100000000">$100M+</option>
                  <option value="500000000">$500M+</option>
                  <option value="1000000000">$1B+</option>
                  <option value="10000000000">$10B+</option>
                  <option value="50000000000">$50B+</option>
                  <option value="200000000000">$200B+</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">{t('screener.country')}</label>
                <select
                  value={prismoFilters.country}
                  onChange={e => setPrismoFilters(f => ({ ...f, country: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-black/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                >
                  {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
                </select>
              </div>
            </div>

            {/* Loading indicator */}
            {prismoLoading && (
              <div className="mt-4 flex items-center gap-2">
                <svg className="animate-spin w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-xs text-amber-400/70">{t('screener.prismo.discovering')}</span>
                <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden ml-2">
                  <div className="h-full bg-amber-500/50 animate-pulse rounded-full w-full" />
                </div>
              </div>
            )}

            {/* Stats after results */}
            {!prismoLoading && prismoStats.total > 0 && (
              <div className="mt-3 text-[11px] text-amber-400/50">
                {t('screener.prismo.stats')
                  .replace('{total}', String(prismoStats.total))
                  .replace('{analyzed}', String(prismoStats.analyzed))}
              </div>
            )}

            {prismoError && (
              <div className="mt-4 bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3 text-amber-300 text-sm">
                {prismoError}
              </div>
            )}

            {/* Results table */}
            {topOpportunities.length > 0 && (
              <div className="mt-5 rounded-xl border border-amber-500/15 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-amber-900/20 text-amber-400/80 text-xs uppercase tracking-wider">
                        <th className="text-center px-3 py-2.5 w-10">{t('screener.prismo.rank')}</th>
                        <th className="text-left px-3 py-2.5">{t('screener.ticker')}</th>
                        <th className="text-left px-3 py-2.5">{t('screener.company')}</th>
                        <th className="text-left px-3 py-2.5 hidden sm:table-cell">{t('screener.sector')}</th>
                        <th className="text-right px-3 py-2.5">{t('screener.prismo.currentPrice')}</th>
                        <th className="text-right px-3 py-2.5">{t('screener.prismo.intrinsicValue')}</th>
                        <th className="text-right px-3 py-2.5">{t('screener.prismo.upside')}</th>
                        <th className="text-center px-3 py-2.5">{t('screener.analyze')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topOpportunities.map((opp, i) => (
                        <tr
                          key={opp.symbol}
                          className={`border-t border-amber-900/15 hover:bg-amber-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-black/20'}`}
                        >
                          <td className="text-center px-3 py-2.5">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                              i < 3 ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-800 text-gray-400'
                            }`}>
                              {i + 1}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-data font-bold text-amber-300">{opp.symbol}</span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-200 max-w-[180px] truncate">{opp.companyName}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs hidden sm:table-cell max-w-[120px] truncate">{opp.sector || '–'}</td>
                          <td className="px-3 py-2.5 text-right font-data text-gray-300">${opp.currentPrice.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-data text-emerald-400 font-semibold">${opp.intrinsicValue.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                              opp.upside >= 100 ? 'bg-emerald-500/20 text-emerald-300' :
                              opp.upside >= 50 ? 'bg-green-500/20 text-green-300' :
                              'bg-teal-500/15 text-teal-300'
                            }`}>
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                              </svg>
                              {opp.upside.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => router.push(`/analizar?ticker=${opp.symbol}`)}
                              className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/25 rounded-lg text-amber-300 text-xs font-semibold transition"
                            >
                              {t('screener.analyze')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══════ Filter Panel ═══════ */}
        <div className="bg-black/50 rounded-2xl border border-white/[0.06] p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.sector')}</label>
              <select
                value={screenerFilters.sector}
                onChange={e => setScreenerFilters(f => ({ ...f, sector: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.exchange')}</label>
              <select
                value={screenerFilters.exchange}
                onChange={e => setScreenerFilters(f => ({ ...f, exchange: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {EXCHANGES.map(e => <option key={e} value={e}>{e || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.country')}</label>
              <select
                value={screenerFilters.country}
                onChange={e => setScreenerFilters(f => ({ ...f, country: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.priceMin')}</label>
              <input type="number" min="0" placeholder="0"
                value={screenerFilters.priceMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, priceMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.priceMax')}</label>
              <input type="number" min="0" placeholder="∞"
                value={screenerFilters.priceLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, priceLowerThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.mktCapMin')}</label>
              <input type="number" min="0" placeholder="e.g. 1000000000"
                value={screenerFilters.marketCapMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, marketCapMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.mktCapMax')}</label>
              <input type="number" min="0" placeholder="∞"
                value={screenerFilters.marketCapLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, marketCapLowerThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.betaMin')}</label>
              <input type="number" step="0.1" placeholder="0"
                value={screenerFilters.betaMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, betaMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.betaMax')}</label>
              <input type="number" step="0.1" placeholder="∞"
                value={screenerFilters.betaLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, betaLowerThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.volMin')}</label>
              <input type="number" min="0" placeholder="e.g. 100000"
                value={screenerFilters.volumeMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, volumeMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.divYieldMin')}</label>
              <input type="number" step="0.1" min="0" placeholder="e.g. 1"
                value={screenerFilters.dividendMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, dividendMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.industry')}</label>
              <input type="text" placeholder="e.g. Semiconductors"
                value={screenerFilters.industry}
                onChange={e => setScreenerFilters(f => ({ ...f, industry: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="flex items-center justify-between mt-5">
            <button
              onClick={() => runScreener(0)}
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
              {screenerLoading ? t('screener.searching') : t('screener.searchBtn')}
            </button>
            {screenerResults.length > 0 && (
              <span className="text-xs text-gray-500">
                {screenerResults.length} {screenerResults.length !== 1 ? t('screener.results') : t('screener.result')}
              </span>
            )}
          </div>
        </div>

        {screenerError && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
            {screenerError}
          </div>
        )}

        {/* ═══════ Screener Results Table ═══════ */}
        {screenerResults.length > 0 && (
          <div className="bg-black/50 rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-black/50 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3">{t('screener.ticker')}</th>
                    <th className="text-left px-4 py-3">{t('screener.company')}</th>
                    <th className="text-right px-4 py-3">{t('screener.price')}</th>
                    <th className="text-right px-4 py-3">{t('screener.mktCap')}</th>
                    <th className="text-right px-4 py-3">{t('screener.beta')}</th>
                    <th className="text-right px-4 py-3">{t('screener.div')}</th>
                    <th className="text-right px-4 py-3">{t('screener.volume')}</th>
                    <th className="text-left px-4 py-3">{t('screener.sector')}</th>
                    <th className="text-left px-4 py-3">{t('screener.country')}</th>
                    <th className="text-center px-4 py-3">{t('screener.analyze')}</th>
                  </tr>
                </thead>
                <tbody>
                  {screenerResults.map((stock, i) => (
                    <tr
                      key={stock.symbol}
                      className={`border-t border-green-900/20 hover:bg-emerald-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-black/20'}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-data font-bold text-emerald-400">{stock.symbol}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-200 max-w-[200px] truncate">{stock.companyName}</td>
                      <td className="px-4 py-3 text-right font-data text-gray-200">${stock.price?.toFixed(2) ?? '–'}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{fmtMktCap(stock.marketCap)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={stock.beta > 1.5 ? 'text-red-400' : stock.beta < 0.7 ? 'text-emerald-400' : 'text-gray-300'}>
                          {stock.beta?.toFixed(2) ?? '–'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">
                        {stock.lastAnnualDividend ? `${stock.lastAnnualDividend.toFixed(2)}%` : '–'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 font-data text-xs">
                        {stock.volume ? (stock.volume >= 1e6 ? `${(stock.volume / 1e6).toFixed(1)}M` : stock.volume.toLocaleString()) : '–'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs max-w-[140px] truncate">{stock.sector || '–'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{stock.country || '–'}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                          className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs font-semibold transition"
                        >
                          {t('screener.analyze')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-green-900/20">
              <button
                onClick={() => runScreener(screenerPage - 1)}
                disabled={screenerPage === 0 || screenerLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-black/40 hover:bg-black/50 disabled:opacity-40 rounded-lg text-sm transition"
              >
                ← {t('screener.prev')}
              </button>
              <span className="text-xs text-gray-500">{t('screener.page')} {screenerPage + 1}</span>
              <button
                onClick={() => runScreener(screenerPage + 1)}
                disabled={screenerResults.length < SCREENER_LIMIT || screenerLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-black/40 hover:bg-black/50 disabled:opacity-40 rounded-lg text-sm transition"
              >
                {t('screener.next')} →
              </button>
            </div>
          </div>
        )}

        {!screenerLoading && screenerResults.length === 0 && !screenerError && (
          <div className="text-center py-16 text-gray-600">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <p className="text-lg">{t('screener.emptyState')} <strong className="text-gray-400">{t('screener.emptyStateCta')}</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}
