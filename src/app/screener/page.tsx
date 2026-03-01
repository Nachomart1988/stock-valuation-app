'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/app/components/Header';

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

  const runScreener = async (page = 0) => {
    setScreenerLoading(true);
    setScreenerError(null);
    try {
      // Build params WITHOUT apikey — server-side proxy adds it
      const params = new URLSearchParams({ limit: String(SCREENER_LIMIT), offset: String(page * SCREENER_LIMIT) });
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

      const res = await fetch(`/api/screener?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Error al cargar el screener (HTTP ${res.status}). Intenta de nuevo.`);
      }
      const data = await res.json();
      setScreenerResults(Array.isArray(data) ? data : []);
      setScreenerPage(page);
    } catch (err: any) {
      setScreenerError(err.message || 'Error al cargar el screener. Intenta de nuevo.');
    } finally {
      setScreenerLoading(false);
    }
  };

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
            Encuentra tu{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">próxima inversión</span>
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Filtra entre miles de empresas usando métricas fundamentales. Haz clic en cualquier ticker para analizarlo al instante.
          </p>
        </div>

        {/* Filter Panel */}
        <div className="bg-black/50 rounded-2xl border border-white/[0.06] p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Sector</label>
              <select
                value={screenerFilters.sector}
                onChange={e => setScreenerFilters(f => ({ ...f, sector: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {SECTORS.map(s => <option key={s} value={s}>{s || 'All Sectors'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Exchange</label>
              <select
                value={screenerFilters.exchange}
                onChange={e => setScreenerFilters(f => ({ ...f, exchange: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {EXCHANGES.map(e => <option key={e} value={e}>{e || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">País</label>
              <select
                value={screenerFilters.country}
                onChange={e => setScreenerFilters(f => ({ ...f, country: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {COUNTRIES.map(c => <option key={c} value={c}>{c || 'All'}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Precio min ($)</label>
              <input type="number" min="0" placeholder="0"
                value={screenerFilters.priceMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, priceMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Precio max ($)</label>
              <input type="number" min="0" placeholder="∞"
                value={screenerFilters.priceLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, priceLowerThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Mkt Cap min ($)</label>
              <input type="number" min="0" placeholder="e.g. 1000000000"
                value={screenerFilters.marketCapMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, marketCapMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Mkt Cap max ($)</label>
              <input type="number" min="0" placeholder="∞"
                value={screenerFilters.marketCapLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, marketCapLowerThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Beta min</label>
              <input type="number" step="0.1" placeholder="0"
                value={screenerFilters.betaMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, betaMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Beta max</label>
              <input type="number" step="0.1" placeholder="∞"
                value={screenerFilters.betaLowerThan}
                onChange={e => setScreenerFilters(f => ({ ...f, betaLowerThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Vol. min</label>
              <input type="number" min="0" placeholder="e.g. 100000"
                value={screenerFilters.volumeMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, volumeMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Div. Yield min</label>
              <input type="number" step="0.1" min="0" placeholder="e.g. 1"
                value={screenerFilters.dividendMoreThan}
                onChange={e => setScreenerFilters(f => ({ ...f, dividendMoreThan: e.target.value }))}
                className="w-full bg-black/80 border border-green-900/20 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Industria (keyword)</label>
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
              {screenerLoading ? 'Buscando…' : 'Buscar Acciones'}
            </button>
            {screenerResults.length > 0 && (
              <span className="text-xs text-gray-500">{screenerResults.length} resultado{screenerResults.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {screenerError && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
            {screenerError}
          </div>
        )}

        {screenerResults.length > 0 && (
          <div className="bg-black/50 rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-black/50 text-gray-500 text-xs uppercase tracking-wider">
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
                      className={`border-t border-green-900/20/40 hover:bg-emerald-900/10 transition-colors ${i % 2 === 0 ? '' : 'bg-black/80/20'}`}
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
                          Analizar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-green-900/20/40">
              <button
                onClick={() => runScreener(screenerPage - 1)}
                disabled={screenerPage === 0 || screenerLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-black/40 hover:bg-black/50 disabled:opacity-40 rounded-lg text-sm transition"
              >
                ← Anterior
              </button>
              <span className="text-xs text-gray-500">Página {screenerPage + 1}</span>
              <button
                onClick={() => runScreener(screenerPage + 1)}
                disabled={screenerResults.length < SCREENER_LIMIT || screenerLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-black/40 hover:bg-black/50 disabled:opacity-40 rounded-lg text-sm transition"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}

        {!screenerLoading && screenerResults.length === 0 && !screenerError && (
          <div className="text-center py-16 text-gray-600">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <p className="text-lg">Configura los filtros y haz clic en <strong className="text-gray-400">Buscar Acciones</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}
