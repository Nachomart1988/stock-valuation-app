'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
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

interface HTFScanResult {
  symbol: string;
  companyName: string;
  sector: string;
  currentPrice: number;
  marketCap: number;
  score: number;
  bestPattern: {
    surge_pct: number;
    flag_range_pct: number | null;
    flag_weeks: number | null;
    vol_dryup: number | null;
    ml_probability: number;
    breakout_status: string;
  } | null;
  narrative: string;
  patternsCount: number;
}

interface EPScanResult {
  symbol: string;
  companyName: string;
  sector: string;
  currentPrice: number;
  marketCap: number;
  score: number;
  bestEpisode: {
    date: string;
    gap_pct: number;
    vol_spike: number;
    holds_support: boolean;
    has_followthrough: boolean;
    catalyst_type: string;
    action: string;
    ml_probability: number;
  } | null;
  narrative: string;
  episodesCount: number;
  fundamentals: {
    accelerating: boolean;
    latest_growth: number;
  } | null;
}

interface MABounceScanResult {
  symbol: string;
  companyName: string;
  sector: string;
  currentPrice: number;
  marketCap: number;
  score: number;
  bounceCount: number;
  surgePct: number;
  surgeWindow: string;
  currentMa: number;
  maDistancePct: number;
  maPeriod: number;
  avgQuality: number;
  avgRecoveryPct: number;
  narrative: string;
  bestBounce: {
    date: string;
    bounce_low: number;
    ma_value: number;
    recovery_date: string;
    recovery_price: number;
    recovery_pct: number;
    bars_to_recover: number;
    quality: number;
  } | null;
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
  const { user } = useUser();
  const isGodMode = (user?.publicMetadata?.plan as string) === 'godmode';

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

  // HTF Scanner state (GODMODE only)
  const [htfResults, setHtfResults] = useState<HTFScanResult[]>([]);
  const [htfLoading, setHtfLoading] = useState(false);
  const [htfError, setHtfError] = useState<string | null>(null);
  const [htfStats, setHtfStats] = useState({ total: 0, scanned: 0 });
  const [htfFilters, setHtfFilters] = useState({
    priceMin: '5',
    priceMax: '500',
    marketCapMin: '500000000',
    country: 'US',
    sector: '',
    minSurge: '80',
    maxFlagRange: '15',
    surgeLookbackMonths: '3',
  });

  // EP Scanner state (GODMODE only)
  const [epResults, setEpResults] = useState<EPScanResult[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const [epError, setEpError] = useState<string | null>(null);
  const [epStats, setEpStats] = useState({ total: 0, scanned: 0 });
  const [epFilters, setEpFilters] = useState({
    priceMin: '5',
    priceMax: '500',
    marketCapMin: '500000000',
    country: 'US',
    sector: '',
    minGap: '15',
    lookbackDays: '504',
  });

  // MA Bounce Scanner state (GODMODE only)
  const [mabResults, setMabResults] = useState<MABounceScanResult[]>([]);
  const [mabLoading, setMabLoading] = useState(false);
  const [mabError, setMabError] = useState<string | null>(null);
  const [mabStats, setMabStats] = useState({ total: 0, scanned: 0 });
  const [mabFilters, setMabFilters] = useState({
    priceMin: '5',
    priceMax: '500',
    marketCapMin: '500000000',
    country: 'US',
    sector: '',
    minSurge: '50',
    surgeLookbackMonths: '6',
    maPeriod: '20',
  });

  // ── Watchlist add helper (accumulates array in localStorage) ──
  const [watchlistAdded, setWatchlistAdded] = useState<Set<string>>(new Set());
  const foamTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const addToWatchlist = useCallback((symbol: string, companyName: string, strategy: string) => {
    // Accumulate pending items as array
    const existing = localStorage.getItem('watchlist_pending_add');
    let pending: any[] = [];
    try { if (existing) pending = JSON.parse(existing); } catch { pending = []; }
    if (!Array.isArray(pending)) pending = [];
    if (!pending.some((p: any) => p.symbol === symbol)) {
      pending.push({ symbol, companyName, strategy });
      localStorage.setItem('watchlist_pending_add', JSON.stringify(pending));
    }
    setWatchlistAdded(prev => new Set(prev).add(symbol));
  }, []);

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

  const scanHTF = useCallback(async () => {
    setHtfLoading(true);
    setHtfError(null);
    setHtfResults([]);
    setHtfStats({ total: 0, scanned: 0 });

    try {
      const params = new URLSearchParams({
        priceMin: htfFilters.priceMin || '5',
        priceMax: htfFilters.priceMax || '500',
        marketCapMin: htfFilters.marketCapMin || '500000000',
        country: htfFilters.country || 'US',
        ...(htfFilters.sector ? { sector: htfFilters.sector } : {}),
        minSurge: String(parseFloat(htfFilters.minSurge || '80') / 100),
        maxFlagRange: String(parseFloat(htfFilters.maxFlagRange || '15') / 100),
        surgeLookbackMonths: htfFilters.surgeLookbackMonths || '3',
      });

      const res = await fetch(`/api/htf-scan?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error (HTTP ${res.status})`);
      }

      const data = await res.json();
      setHtfStats({ total: data.total || 0, scanned: data.scanned || 0 });

      if (!data.results?.length) {
        setHtfError('No HTF patterns detected in the current filter range.');
      } else {
        setHtfResults(data.results);
      }
    } catch (err: any) {
      setHtfError(err.message || 'Error scanning for HTF patterns');
    } finally {
      setHtfLoading(false);
    }
  }, [htfFilters]);

  const scanEP = useCallback(async () => {
    setEpLoading(true);
    setEpError(null);
    setEpResults([]);
    setEpStats({ total: 0, scanned: 0 });

    try {
      const params = new URLSearchParams({
        priceMin: epFilters.priceMin || '5',
        priceMax: epFilters.priceMax || '500',
        marketCapMin: epFilters.marketCapMin || '500000000',
        country: epFilters.country || 'US',
        ...(epFilters.sector ? { sector: epFilters.sector } : {}),
        minGap: String(parseFloat(epFilters.minGap || '15') / 100),
        lookbackDays: epFilters.lookbackDays || '504',
      });

      const res = await fetch(`/api/ep-scan?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error (HTTP ${res.status})`);
      }

      const data = await res.json();
      setEpStats({ total: data.total || 0, scanned: data.scanned || 0 });

      if (!data.results?.length) {
        setEpError('No Episodic Pivot patterns detected in the current filter range.');
      } else {
        setEpResults(data.results);
      }
    } catch (err: any) {
      setEpError(err.message || 'Error scanning for Episodic Pivots');
    } finally {
      setEpLoading(false);
    }
  }, [epFilters]);

  const scanMABounce = useCallback(async () => {
    setMabLoading(true);
    setMabError(null);
    setMabResults([]);
    setMabStats({ total: 0, scanned: 0 });

    try {
      const params = new URLSearchParams({
        priceMin: mabFilters.priceMin || '5',
        priceMax: mabFilters.priceMax || '500',
        marketCapMin: mabFilters.marketCapMin || '500000000',
        country: mabFilters.country || 'US',
        ...(mabFilters.sector ? { sector: mabFilters.sector } : {}),
        minSurge: String(parseFloat(mabFilters.minSurge || '50') / 100),
        surgeLookbackMonths: mabFilters.surgeLookbackMonths || '6',
        maPeriod: mabFilters.maPeriod || '20',
      });

      const res = await fetch(`/api/ma-bounce-scan?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error (HTTP ${res.status})`);
      }

      const data = await res.json();
      setMabStats({ total: data.total || 0, scanned: data.scanned || 0 });

      if (!data.results?.length) {
        setMabError('No MA Bounce patterns detected in the current filter range.');
      } else {
        setMabResults(data.results);
      }
    } catch (err: any) {
      setMabError(err.message || 'Error scanning for MA Bounces');
    } finally {
      setMabLoading(false);
    }
  }, [mabFilters]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />
      <div className="max-w-7xl mx-auto px-4 pt-28 pb-20">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-6">
            <span className="text-gray-400 text-[11px] font-medium tracking-widest uppercase">Stock Screener</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-black mb-3">
            {t('screener.title')}{' '}
            <span className="text-white">{t('screener.titleHighlight')}</span>
          </h1>
          <p className="text-gray-500 max-w-xl mx-auto text-sm">
            {t('screener.subtitle')}
          </p>
        </div>

        {/* ═══════ Prismo Top Opportunities ═══════ */}
        <div className="relative mb-8 rounded-xl border border-amber-500/20 bg-gray-900/60 overflow-hidden">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 p-3 bg-gray-900/30 rounded-xl border border-amber-900/15">
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">{t('screener.priceMin')}</label>
                <input type="number" min="0" placeholder="5"
                  value={prismoFilters.priceMin}
                  onChange={e => setPrismoFilters(f => ({ ...f, priceMin: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-gray-900/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">{t('screener.priceMax')}</label>
                <input type="number" min="0" placeholder="500"
                  value={prismoFilters.priceMax}
                  onChange={e => setPrismoFilters(f => ({ ...f, priceMax: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-gray-900/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[10px] text-amber-400/60 uppercase tracking-wider mb-1">Mkt Cap min</label>
                <select
                  value={prismoFilters.marketCapMin}
                  onChange={e => setPrismoFilters(f => ({ ...f, marketCapMin: e.target.value }))}
                  disabled={prismoLoading}
                  className="w-full bg-gray-900/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
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
                  className="w-full bg-gray-900/60 border border-amber-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-amber-500 disabled:opacity-50"
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
                <div className="flex-1 h-1.5 bg-gray-900/40 rounded-full overflow-hidden ml-2">
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
                          className={`border-t border-amber-900/15 hover:bg-amber-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
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
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => router.push(`/analizar?ticker=${opp.symbol}`)}
                                className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/25 rounded-lg text-amber-300 text-xs font-semibold transition"
                              >
                                {t('screener.analyze')}
                              </button>
                              <button
                                onClick={(e) => {
                                  addToWatchlist(opp.symbol, opp.companyName, 'Others');
                                  const btn = e.currentTarget;
                                  btn.classList.remove('animate-foam-press');
                                  void btn.offsetWidth;
                                  btn.classList.add('animate-foam-press');
                                  if (foamTimers.current[opp.symbol]) clearTimeout(foamTimers.current[opp.symbol]);
                                  foamTimers.current[opp.symbol] = setTimeout(() => btn.classList.remove('animate-foam-press'), 800);
                                }}
                                className={`px-2 py-1.5 border rounded-lg text-[10px] font-semibold transition-colors ${
                                  watchlistAdded.has(opp.symbol)
                                    ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                    : 'bg-cyan-500/10 hover:bg-cyan-500/25 border-cyan-500/20 text-cyan-400'
                                }`}
                                title="Add to Watchlist"
                              >
                                {watchlistAdded.has(opp.symbol) ? 'Added' : '+ Watch'}
                              </button>
                            </div>
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

        {/* ═══════ HTF Scanner (GODMODE ONLY) ═══════ */}
        {isGodMode && (
          <div className="relative mb-8 rounded-xl border border-rose-500/20 bg-gray-900/60 overflow-hidden">
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-rose-500/[0.03] to-transparent" />
            <div className="relative p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-2">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-rose-300 flex items-center gap-2">
                    <svg className="w-6 h-6 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    HTF Scanner
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-wider">
                      God Mode
                    </span>
                  </h2>
                  <p className="text-gray-400 text-sm mt-1 max-w-xl">
                    Scan for High-Tight Flag patterns (Qullamaggie). Find stocks with explosive surges in your chosen timeframe followed by tight consolidation.
                  </p>
                </div>
                <button
                  onClick={scanHTF}
                  disabled={htfLoading}
                  className="shrink-0 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-bold rounded-xl shadow-lg shadow-rose-500/20 disabled:opacity-50 transition-all text-sm"
                >
                  {htfLoading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  )}
                  {htfLoading ? 'Scanning...' : 'Scan HTF'}
                </button>
              </div>

              {/* HTF Filters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-4 p-3 bg-gray-900/30 rounded-xl border border-rose-900/15">
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Price Min</label>
                  <input type="number" min="0" placeholder="5"
                    value={htfFilters.priceMin}
                    onChange={e => setHtfFilters(f => ({ ...f, priceMin: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Price Max</label>
                  <input type="number" min="0" placeholder="500"
                    value={htfFilters.priceMax}
                    onChange={e => setHtfFilters(f => ({ ...f, priceMax: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Mkt Cap Min</label>
                  <select
                    value={htfFilters.marketCapMin}
                    onChange={e => setHtfFilters(f => ({ ...f, marketCapMin: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
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
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Country</label>
                  <select
                    value={htfFilters.country}
                    onChange={e => setHtfFilters(f => ({ ...f, country: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  >
                    {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Sector</label>
                  <select
                    value={htfFilters.sector}
                    onChange={e => setHtfFilters(f => ({ ...f, sector: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  >
                    {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Min Surge %</label>
                  <input type="number" min="50" max="200" step="10" placeholder="80"
                    value={htfFilters.minSurge}
                    onChange={e => setHtfFilters(f => ({ ...f, minSurge: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Surge Window</label>
                  <select
                    value={htfFilters.surgeLookbackMonths}
                    onChange={e => setHtfFilters(f => ({ ...f, surgeLookbackMonths: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  >
                    <option value="3">Last 3 months</option>
                    <option value="6">Last 6 months</option>
                    <option value="9">Last 9 months</option>
                    <option value="12">Last 12 months</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-rose-400/60 uppercase tracking-wider mb-1">Max Flag %</label>
                  <input type="number" min="5" max="25" step="1" placeholder="15"
                    value={htfFilters.maxFlagRange}
                    onChange={e => setHtfFilters(f => ({ ...f, maxFlagRange: e.target.value }))}
                    disabled={htfLoading}
                    className="w-full bg-gray-900/60 border border-rose-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-rose-500 disabled:opacity-50"
                  />
                </div>
              </div>

              {htfLoading && (
                <div className="mt-4 flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-rose-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <span className="text-xs text-rose-400/70">Analyzing patterns across all filtered stocks... this may take 1-2 minutes</span>
                  <div className="flex-1 h-1.5 bg-gray-900/40 rounded-full overflow-hidden ml-2">
                    <div className="h-full bg-rose-500/50 animate-pulse rounded-full w-full" />
                  </div>
                </div>
              )}

              {!htfLoading && htfStats.total > 0 && (
                <div className="mt-3 text-[11px] text-rose-400/50">
                  {htfStats.total} stocks screened · {htfStats.scanned} analyzed for HTF patterns
                </div>
              )}

              {htfError && (
                <div className="mt-4 bg-rose-900/20 border border-rose-700/30 rounded-xl px-4 py-3 text-rose-300 text-sm">
                  {htfError}
                </div>
              )}

              {htfResults.length > 0 && (
                <div className="mt-5 rounded-xl border border-rose-500/15 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-rose-900/20 text-rose-400/80 text-xs uppercase tracking-wider">
                          <th className="text-center px-3 py-2.5 w-10">#</th>
                          <th className="text-left px-3 py-2.5">Ticker</th>
                          <th className="text-left px-3 py-2.5">Company</th>
                          <th className="text-center px-3 py-2.5">Score</th>
                          <th className="text-right px-3 py-2.5">Surge %</th>
                          <th className="text-right px-3 py-2.5 hidden sm:table-cell">Flag Range</th>
                          <th className="text-right px-3 py-2.5 hidden md:table-cell">ML Prob</th>
                          <th className="text-center px-3 py-2.5 hidden sm:table-cell">Breakout</th>
                          <th className="text-right px-3 py-2.5">Price</th>
                          <th className="text-center px-3 py-2.5">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {htfResults.map((r, i) => (
                          <tr
                            key={r.symbol}
                            className={`border-t border-rose-900/15 hover:bg-rose-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                          >
                            <td className="text-center px-3 py-2.5">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                i < 3 ? 'bg-rose-500/20 text-rose-300' : 'bg-gray-800 text-gray-400'
                              }`}>
                                {i + 1}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="font-data font-bold text-rose-300">{r.symbol}</span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-200 max-w-[160px] truncate">{r.companyName}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                r.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' :
                                r.score >= 40 ? 'bg-yellow-500/20 text-yellow-300' :
                                'bg-gray-700/50 text-gray-400'
                              }`}>
                                {r.score}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-rose-200">
                              {r.bestPattern ? `${(r.bestPattern.surge_pct * 100).toFixed(0)}%` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-400 hidden sm:table-cell">
                              {r.bestPattern?.flag_range_pct != null ? `${(r.bestPattern.flag_range_pct * 100).toFixed(1)}%` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-400 hidden md:table-cell">
                              {r.bestPattern ? `${(r.bestPattern.ml_probability * 100).toFixed(0)}%` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                              {r.bestPattern?.breakout_status && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  r.bestPattern.breakout_status === 'confirmed' ? 'bg-emerald-500/20 text-emerald-400' :
                                  r.bestPattern.breakout_status === 'approaching' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-gray-700/40 text-gray-500'
                                }`}>
                                  {r.bestPattern.breakout_status}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-300">${r.currentPrice.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => router.push(`/analizar?ticker=${r.symbol}`)}
                                  className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/25 rounded-lg text-rose-300 text-xs font-semibold transition"
                                >
                                  Analyze
                                </button>
                                <button
                                  onClick={(e) => {
                                    addToWatchlist(r.symbol, r.companyName, 'HTF');
                                    const btn = e.currentTarget;
                                    btn.classList.remove('animate-foam-press');
                                    void btn.offsetWidth;
                                    btn.classList.add('animate-foam-press');
                                    if (foamTimers.current[r.symbol]) clearTimeout(foamTimers.current[r.symbol]);
                                    foamTimers.current[r.symbol] = setTimeout(() => btn.classList.remove('animate-foam-press'), 800);
                                  }}
                                  className={`px-2 py-1.5 border rounded-lg text-[10px] font-semibold transition-colors ${
                                    watchlistAdded.has(r.symbol)
                                      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                      : 'bg-cyan-500/10 hover:bg-cyan-500/25 border-cyan-500/20 text-cyan-400'
                                  }`}
                                  title="Add to Watchlist"
                                >
                                  {watchlistAdded.has(r.symbol) ? 'Added' : '+ Watch'}
                                </button>
                              </div>
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
        )}

        {/* ═══════ EP Scanner (GODMODE ONLY) ═══════ */}
        {isGodMode && (
          <div className="relative mb-8 rounded-xl border border-violet-500/20 bg-gray-900/60 overflow-hidden">
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-violet-500/[0.03] to-transparent" />
            <div className="relative p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-2">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-violet-300 flex items-center gap-2">
                    <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    Episodic Pivot Scanner
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30 uppercase tracking-wider">
                      God Mode
                    </span>
                  </h2>
                  <p className="text-gray-400 text-sm mt-1 max-w-xl">
                    Scan for Episodic Pivots (Qullamaggie). Explosive gap-ups on earnings catalysts with support holds and follow-through.
                  </p>
                </div>
                <button
                  onClick={scanEP}
                  disabled={epLoading}
                  className="shrink-0 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white font-bold rounded-xl shadow-lg shadow-violet-500/20 disabled:opacity-50 transition-all text-sm"
                >
                  {epLoading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  )}
                  {epLoading ? 'Scanning...' : 'Scan EP'}
                </button>
              </div>

              {/* EP Filters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4 p-3 bg-gray-900/30 rounded-xl border border-violet-900/15">
                <div>
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Price Min</label>
                  <input type="number" min="0" placeholder="5"
                    value={epFilters.priceMin}
                    onChange={e => setEpFilters(f => ({ ...f, priceMin: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Price Max</label>
                  <input type="number" min="0" placeholder="500"
                    value={epFilters.priceMax}
                    onChange={e => setEpFilters(f => ({ ...f, priceMax: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Mkt Cap Min</label>
                  <select
                    value={epFilters.marketCapMin}
                    onChange={e => setEpFilters(f => ({ ...f, marketCapMin: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
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
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Country</label>
                  <select
                    value={epFilters.country}
                    onChange={e => setEpFilters(f => ({ ...f, country: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  >
                    {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Sector</label>
                  <select
                    value={epFilters.sector}
                    onChange={e => setEpFilters(f => ({ ...f, sector: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  >
                    {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Min Gap %</label>
                  <input type="number" min="10" max="50" step="5" placeholder="15"
                    value={epFilters.minGap}
                    onChange={e => setEpFilters(f => ({ ...f, minGap: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-violet-400/60 uppercase tracking-wider mb-1">Lookback</label>
                  <select
                    value={epFilters.lookbackDays}
                    onChange={e => setEpFilters(f => ({ ...f, lookbackDays: e.target.value }))}
                    disabled={epLoading}
                    className="w-full bg-gray-900/60 border border-violet-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-violet-500 disabled:opacity-50"
                  >
                    <option value="252">1 Year</option>
                    <option value="504">2 Years</option>
                    <option value="756">3 Years</option>
                  </select>
                </div>
              </div>

              {epLoading && (
                <div className="mt-4 flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <span className="text-xs text-violet-400/70">Scanning for Episodic Pivots across all filtered stocks... this may take 1-2 minutes</span>
                  <div className="flex-1 h-1.5 bg-gray-900/40 rounded-full overflow-hidden ml-2">
                    <div className="h-full bg-violet-500/50 animate-pulse rounded-full w-full" />
                  </div>
                </div>
              )}

              {!epLoading && epStats.total > 0 && (
                <div className="mt-3 text-[11px] text-violet-400/50">
                  {epStats.total} stocks screened · {epStats.scanned} analyzed for Episodic Pivots
                </div>
              )}

              {epError && (
                <div className="mt-4 bg-violet-900/20 border border-violet-700/30 rounded-xl px-4 py-3 text-violet-300 text-sm">
                  {epError}
                </div>
              )}

              {epResults.length > 0 && (
                <div className="mt-5 rounded-xl border border-violet-500/15 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-violet-900/20 text-violet-400/80 text-xs uppercase tracking-wider">
                          <th className="text-center px-3 py-2.5 w-10">#</th>
                          <th className="text-left px-3 py-2.5">Ticker</th>
                          <th className="text-left px-3 py-2.5">Company</th>
                          <th className="text-center px-3 py-2.5">Score</th>
                          <th className="text-right px-3 py-2.5">Gap %</th>
                          <th className="text-right px-3 py-2.5 hidden sm:table-cell">Vol Spike</th>
                          <th className="text-center px-3 py-2.5 hidden sm:table-cell">Support</th>
                          <th className="text-center px-3 py-2.5 hidden md:table-cell">Follow-Thru</th>
                          <th className="text-center px-3 py-2.5">Action</th>
                          <th className="text-right px-3 py-2.5">Price</th>
                          <th className="text-center px-3 py-2.5">Go</th>
                        </tr>
                      </thead>
                      <tbody>
                        {epResults.map((r, i) => (
                          <tr
                            key={r.symbol}
                            className={`border-t border-violet-900/15 hover:bg-violet-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                          >
                            <td className="text-center px-3 py-2.5">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                i < 3 ? 'bg-violet-500/20 text-violet-300' : 'bg-gray-800 text-gray-400'
                              }`}>
                                {i + 1}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="font-data font-bold text-violet-300">{r.symbol}</span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-200 max-w-[160px] truncate">{r.companyName}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                r.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' :
                                r.score >= 40 ? 'bg-yellow-500/20 text-yellow-300' :
                                'bg-gray-700/50 text-gray-400'
                              }`}>
                                {r.score}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-violet-200">
                              {r.bestEpisode ? `${(r.bestEpisode.gap_pct * 100).toFixed(0)}%` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-400 hidden sm:table-cell">
                              {r.bestEpisode ? `${r.bestEpisode.vol_spike.toFixed(1)}x` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                              {r.bestEpisode && (
                                <span className={r.bestEpisode.holds_support ? 'text-emerald-400' : 'text-red-400'}>
                                  {r.bestEpisode.holds_support ? 'HOLDS' : 'BROKEN'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center hidden md:table-cell">
                              {r.bestEpisode && (
                                <span className={r.bestEpisode.has_followthrough ? 'text-emerald-400' : 'text-gray-600'}>
                                  {r.bestEpisode.has_followthrough ? 'YES' : 'NO'}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {r.bestEpisode?.action && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  r.bestEpisode.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' :
                                  r.bestEpisode.action === 'watch' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-gray-700/40 text-gray-500'
                                }`}>
                                  {r.bestEpisode.action}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-300">${r.currentPrice.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => router.push(`/analizar?ticker=${r.symbol}`)}
                                  className="px-3 py-1.5 bg-violet-500/15 hover:bg-violet-500/30 border border-violet-500/25 rounded-lg text-violet-300 text-xs font-semibold transition"
                                >
                                  Analyze
                                </button>
                                <button
                                  onClick={(e) => {
                                    addToWatchlist(r.symbol, r.companyName, 'Episodic Pivot');
                                    const btn = e.currentTarget;
                                    btn.classList.remove('animate-foam-press');
                                    void btn.offsetWidth;
                                    btn.classList.add('animate-foam-press');
                                    if (foamTimers.current[r.symbol]) clearTimeout(foamTimers.current[r.symbol]);
                                    foamTimers.current[r.symbol] = setTimeout(() => btn.classList.remove('animate-foam-press'), 800);
                                  }}
                                  className={`px-2 py-1.5 border rounded-lg text-[10px] font-semibold transition-colors ${
                                    watchlistAdded.has(r.symbol)
                                      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                      : 'bg-cyan-500/10 hover:bg-cyan-500/25 border-cyan-500/20 text-cyan-400'
                                  }`}
                                  title="Add to Watchlist"
                                >
                                  {watchlistAdded.has(r.symbol) ? 'Added' : '+ Watch'}
                                </button>
                              </div>
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
        )}

        {/* ═══════ MA Bounce Scanner (GODMODE ONLY) ═══════ */}
        {isGodMode && (
          <div className="relative mb-8 rounded-xl border border-teal-500/20 bg-gray-900/60 overflow-hidden">
            <div className="absolute inset-0 pointer-events-none bg-gradient-to-br from-teal-500/[0.03] to-transparent" />
            <div className="relative p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-2">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black text-teal-300 flex items-center gap-2">
                    <svg className="w-6 h-6 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l4-4 4 4 4-8 4 4" />
                    </svg>
                    MA Bounce Scanner
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500/30 uppercase tracking-wider">
                      God Mode
                    </span>
                  </h2>
                  <p className="text-gray-400 text-sm mt-1 max-w-xl">
                    Find surging stocks that repeatedly bounce off their moving average. Sorted by bounce count — the more bounces, the stronger the MA support.
                  </p>
                </div>
                <button
                  onClick={scanMABounce}
                  disabled={mabLoading}
                  className="shrink-0 flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 hover:from-teal-600 hover:to-cyan-700 text-white font-bold rounded-xl shadow-lg shadow-teal-500/20 disabled:opacity-50 transition-all text-sm"
                >
                  {mabLoading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l4-4 4 4 4-8 4 4" />
                    </svg>
                  )}
                  {mabLoading ? 'Scanning...' : 'Scan Bounces'}
                </button>
              </div>

              {/* MA Bounce Filters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-4 p-3 bg-gray-900/30 rounded-xl border border-teal-900/15">
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Price Min</label>
                  <input type="number" min="0" placeholder="5"
                    value={mabFilters.priceMin}
                    onChange={e => setMabFilters(f => ({ ...f, priceMin: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Price Max</label>
                  <input type="number" min="0" placeholder="500"
                    value={mabFilters.priceMax}
                    onChange={e => setMabFilters(f => ({ ...f, priceMax: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Mkt Cap Min</label>
                  <select
                    value={mabFilters.marketCapMin}
                    onChange={e => setMabFilters(f => ({ ...f, marketCapMin: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
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
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Country</label>
                  <select
                    value={mabFilters.country}
                    onChange={e => setMabFilters(f => ({ ...f, country: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Sector</label>
                  <select
                    value={mabFilters.sector}
                    onChange={e => setMabFilters(f => ({ ...f, sector: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Min Surge %</label>
                  <input type="number" min="20" max="200" step="10" placeholder="50"
                    value={mabFilters.minSurge}
                    onChange={e => setMabFilters(f => ({ ...f, minSurge: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">Surge Window</label>
                  <select
                    value={mabFilters.surgeLookbackMonths}
                    onChange={e => setMabFilters(f => ({ ...f, surgeLookbackMonths: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    <option value="3">Last 3 months</option>
                    <option value="6">Last 6 months</option>
                    <option value="9">Last 9 months</option>
                    <option value="12">Last 12 months</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-teal-400/60 uppercase tracking-wider mb-1">MA Period</label>
                  <select
                    value={mabFilters.maPeriod}
                    onChange={e => setMabFilters(f => ({ ...f, maPeriod: e.target.value }))}
                    disabled={mabLoading}
                    className="w-full bg-gray-900/60 border border-teal-900/20 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    <option value="20">MA 20</option>
                    <option value="50">MA 50</option>
                  </select>
                </div>
              </div>

              {mabLoading && (
                <div className="mt-4 flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-teal-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  <span className="text-xs text-teal-400/70">Scanning for MA Bounce patterns across all filtered stocks... this may take 1-2 minutes</span>
                  <div className="flex-1 h-1.5 bg-gray-900/40 rounded-full overflow-hidden ml-2">
                    <div className="h-full bg-teal-500/50 animate-pulse rounded-full w-full" />
                  </div>
                </div>
              )}

              {!mabLoading && mabStats.total > 0 && (
                <div className="mt-3 text-[11px] text-teal-400/50">
                  {mabStats.total} stocks screened · {mabStats.scanned} analyzed for MA Bounce patterns
                </div>
              )}

              {mabError && (
                <div className="mt-4 bg-teal-900/20 border border-teal-700/30 rounded-xl px-4 py-3 text-teal-300 text-sm">
                  {mabError}
                </div>
              )}

              {mabResults.length > 0 && (
                <div className="mt-5 rounded-xl border border-teal-500/15 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-teal-900/20 text-teal-400/80 text-xs uppercase tracking-wider">
                          <th className="text-center px-3 py-2.5 w-10">#</th>
                          <th className="text-left px-3 py-2.5">Ticker</th>
                          <th className="text-left px-3 py-2.5">Company</th>
                          <th className="text-center px-3 py-2.5">Bounces</th>
                          <th className="text-center px-3 py-2.5">Score</th>
                          <th className="text-right px-3 py-2.5">Surge %</th>
                          <th className="text-right px-3 py-2.5 hidden sm:table-cell">Avg Recovery</th>
                          <th className="text-right px-3 py-2.5 hidden md:table-cell">MA Dist</th>
                          <th className="text-right px-3 py-2.5">Price</th>
                          <th className="text-center px-3 py-2.5">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mabResults.map((r, i) => (
                          <tr
                            key={r.symbol}
                            className={`border-t border-teal-900/15 hover:bg-teal-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                          >
                            <td className="text-center px-3 py-2.5">
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                i < 3 ? 'bg-teal-500/20 text-teal-300' : 'bg-gray-800 text-gray-400'
                              }`}>
                                {i + 1}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="font-data font-bold text-teal-300">{r.symbol}</span>
                            </td>
                            <td className="px-3 py-2.5 text-gray-200 max-w-[160px] truncate">{r.companyName}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-black ${
                                r.bounceCount >= 6 ? 'bg-emerald-500/20 text-emerald-300' :
                                r.bounceCount >= 3 ? 'bg-yellow-500/20 text-yellow-300' :
                                'bg-gray-700/50 text-gray-400'
                              }`}>
                                {r.bounceCount}x
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                r.score >= 70 ? 'bg-emerald-500/20 text-emerald-300' :
                                r.score >= 40 ? 'bg-yellow-500/20 text-yellow-300' :
                                'bg-gray-700/50 text-gray-400'
                              }`}>
                                {r.score}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-teal-200">
                              {r.surgePct ? `+${(r.surgePct * 100).toFixed(0)}%` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-400 hidden sm:table-cell">
                              {r.avgRecoveryPct ? `${r.avgRecoveryPct.toFixed(1)}%` : '–'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-data hidden md:table-cell">
                              <span className={r.maDistancePct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {r.maDistancePct >= 0 ? '+' : ''}{r.maDistancePct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-data text-gray-300">${r.currentPrice.toFixed(2)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => router.push(`/analizar?ticker=${r.symbol}`)}
                                  className="px-3 py-1.5 bg-teal-500/15 hover:bg-teal-500/30 border border-teal-500/25 rounded-lg text-teal-300 text-xs font-semibold transition"
                                >
                                  Analyze
                                </button>
                                <button
                                  onClick={(e) => {
                                    addToWatchlist(r.symbol, r.companyName, 'MA Bounce');
                                    const btn = e.currentTarget;
                                    btn.classList.remove('animate-foam-press');
                                    void btn.offsetWidth;
                                    btn.classList.add('animate-foam-press');
                                    if (foamTimers.current[r.symbol]) clearTimeout(foamTimers.current[r.symbol]);
                                    foamTimers.current[r.symbol] = setTimeout(() => btn.classList.remove('animate-foam-press'), 800);
                                  }}
                                  className={`px-2 py-1.5 border rounded-lg text-[10px] font-semibold transition-colors ${
                                    watchlistAdded.has(r.symbol)
                                      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                      : 'bg-cyan-500/10 hover:bg-cyan-500/25 border-cyan-500/20 text-cyan-400'
                                  }`}
                                  title="Add to Watchlist"
                                >
                                  {watchlistAdded.has(r.symbol) ? 'Added' : '+ Watch'}
                                </button>
                              </div>
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
        )}

        {/* ═══════ Filter Panel ═══════ */}
        <div className="bg-gray-900/50 rounded-xl border border-white/[0.06] p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.sector')}</label>
              <select
                value={screenerFilters.sector}
                onChange={e => setScreenerFilters(f => ({ ...f, sector: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.exchange')}</label>
              <select
                value={screenerFilters.exchange}
                onChange={e => setScreenerFilters(f => ({ ...f, exchange: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {EXCHANGES.map(e => <option key={e} value={e}>{e || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.country')}</label>
              <select
                value={screenerFilters.country}
                onChange={e => setScreenerFilters(f => ({ ...f, country: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.priceMin')}</label>
              <input type="number" min="0" placeholder="0"
                value={screenerFilters.priceMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, priceMoreThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.priceMax')}</label>
              <input type="number" min="0" placeholder="∞"
                value={screenerFilters.priceLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, priceLowerThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.mktCapMin')}</label>
              <input type="number" min="0" placeholder="e.g. 1000000000"
                value={screenerFilters.marketCapMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, marketCapMoreThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.mktCapMax')}</label>
              <input type="number" min="0" placeholder="∞"
                value={screenerFilters.marketCapLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, marketCapLowerThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.betaMin')}</label>
              <input type="number" step="0.1" placeholder="0"
                value={screenerFilters.betaMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, betaMoreThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.betaMax')}</label>
              <input type="number" step="0.1" placeholder="∞"
                value={screenerFilters.betaLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, betaLowerThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.volMin')}</label>
              <input type="number" min="0" placeholder="e.g. 100000"
                value={screenerFilters.volumeMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, volumeMoreThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.divYieldMin')}</label>
              <input type="number" step="0.1" min="0" placeholder="e.g. 1"
                value={screenerFilters.dividendMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, dividendMoreThan: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">{t('screener.industry')}</label>
              <input type="text" placeholder="e.g. Semiconductors"
                value={screenerFilters.industry}
                onChange={e => setScreenerFilters(f => ({ ...f, industry: e.target.value }))}
                className="w-full bg-gray-900/80 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
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
          <div className="bg-gray-900/50 rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900/50 text-gray-500 text-xs uppercase tracking-wider">
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
                      className={`border-t border-white/[0.06] hover:bg-emerald-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
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
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => router.push(`/analizar?ticker=${stock.symbol}`)}
                            className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs font-semibold transition"
                          >
                            {t('screener.analyze')}
                          </button>
                          <button
                            onClick={(e) => {
                              addToWatchlist(stock.symbol, stock.companyName, 'Others');
                              const btn = e.currentTarget;
                              btn.classList.remove('animate-foam-press');
                              void btn.offsetWidth;
                              btn.classList.add('animate-foam-press');
                              if (foamTimers.current[stock.symbol]) clearTimeout(foamTimers.current[stock.symbol]);
                              foamTimers.current[stock.symbol] = setTimeout(() => btn.classList.remove('animate-foam-press'), 800);
                            }}
                            className={`px-2 py-1.5 border rounded-lg text-[10px] font-semibold transition-colors ${
                              watchlistAdded.has(stock.symbol)
                                ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                : 'bg-cyan-500/10 hover:bg-cyan-500/25 border-cyan-500/20 text-cyan-400'
                            }`}
                            title="Add to Watchlist"
                          >
                            {watchlistAdded.has(stock.symbol) ? 'Added' : '+ Watch'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
              <button
                onClick={() => runScreener(screenerPage - 1)}
                disabled={screenerPage === 0 || screenerLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900/40 hover:bg-gray-900/50 disabled:opacity-40 rounded-lg text-sm transition"
              >
                ← {t('screener.prev')}
              </button>
              <span className="text-xs text-gray-500">{t('screener.page')} {screenerPage + 1}</span>
              <button
                onClick={() => runScreener(screenerPage + 1)}
                disabled={screenerResults.length < SCREENER_LIMIT || screenerLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900/40 hover:bg-gray-900/50 disabled:opacity-40 rounded-lg text-sm transition"
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
