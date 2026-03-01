// src/app/components/tabs/CompetidoresTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { fetchFmp } from '@/lib/fmpClient';

interface PeerData {
  symbol: string;
  companyName?: string;
  beta: number | null;
  marketCap: number | null;
  totalDebt: number | null;
}

type QuoteResponse = {
  symbol: string;
  name?: string;
  companyName?: string;
  marketCap?: number | null;
};

type ProfileResponse = {
  symbol: string;
  companyName?: string;
  beta?: number | null;
};

type BalanceSheetResponse = {
  symbol: string;
  totalDebt?: number | null;
};

export default function CompetidoresTab({ ticker }: { ticker: string }) {
  const { t } = useLanguage();
  const [peerData, setPeerData] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPeersAndData = async () => {
      try {
        setLoading(true);
        setError(null);

        let peerSymbols: string[] = [];

        try {
          const peersJson = await fetchFmp('stable/stock-peers', { symbol: ticker });
          if (Array.isArray(peersJson)) {
            peerSymbols = peersJson.map((p: any) => p.symbol).filter(Boolean).slice(0, 8);
          }
        } catch (e) {
          console.warn('Peers falló, usando fallback');
        }

        if (peerSymbols.length === 0) {
          peerSymbols = ['MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AVGO', 'COST'];
        }

        const symbolsToFetch = [ticker, ...peerSymbols];
        const uniqueSymbols = [...new Set(symbolsToFetch)];

        // Quote (marketCap)
        const quotesPromises = uniqueSymbols.map(async (symbol) => {
          try {
            const json = await fetchFmp('stable/quote', { symbol });
            return Array.isArray(json) && json[0] ? json[0] : { symbol, name: symbol, marketCap: null };
          } catch {
            return { symbol, name: symbol, marketCap: null };
          }
        });

        const quotesArray = await Promise.all(quotesPromises);
        const quotesMap = new Map(quotesArray.map(q => [q.symbol || '', q]));

        // Profile (beta + companyName)
        const profilePromises = uniqueSymbols.map(async (symbol) => {
          try {
            const json = await fetchFmp('stable/profile', { symbol });
            return Array.isArray(json) && json[0] ? json[0] : { symbol, beta: null };
          } catch {
            return { symbol, beta: null };
          }
        });

        const profilesArray = await Promise.all(profilePromises);
        const profilesMap = new Map(profilesArray.map(p => [p.symbol || '', p]));

        // Balance sheet (totalDebt)
        const balancePromises = uniqueSymbols.map(async (symbol) => {
          try {
            const json = await fetchFmp('stable/balance-sheet-statement', { symbol, limit: 1 });
            return Array.isArray(json) && json[0] ? json[0] : {};
          } catch {
            return {};
          }
        });

        const balanceArray = await Promise.all(balancePromises);
        const balanceMap = new Map(balanceArray.map(b => [b.symbol || '', b]));

        // Armar results
        const results: PeerData[] = uniqueSymbols.map((symbol) => {
          const q = quotesMap.get(symbol) as QuoteResponse | undefined;
          const p = profilesMap.get(symbol) as ProfileResponse | undefined;
          const b = balanceMap.get(symbol) as BalanceSheetResponse | undefined;

          return {
            symbol,
            companyName: q?.name || q?.companyName || p?.companyName || symbol,
            beta: p?.beta ?? null,
            marketCap: q?.marketCap ?? null,
            totalDebt: b?.totalDebt ?? null,
          };
        });

        setPeerData(results);
      } catch (err: any) {
        console.error('Error global:', err);
        setError(err.message || 'Error al cargar competidores');
      } finally {
        setLoading(false);
      }
    };

    fetchPeersAndData();
  }, [ticker]);

  if (loading) {
    return <p className="text-xl text-gray-300 py-10 text-center">{t('competidoresTab.loading')}</p>;
  }

  if (error) {
    return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;
  }

  if (peerData.length === 0) {
    return <p className="text-xl text-gray-400 py-10 text-center">{t('competidoresTab.noData')}</p>;
  }

  const validPeerData = peerData.filter(
    (peer): peer is PeerData => peer && typeof peer.symbol === 'string' && peer.symbol.trim() !== ''
  );

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">
            {t('competidoresTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('competidoresTab.subtitle')} {ticker} {t('competidoresTab.vsCompetitors')}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-orange-900/40 to-red-900/40 px-4 py-2 rounded-xl border border-orange-600">
            <p className="text-xs text-orange-400">{t('competidoresTab.companies')}</p>
            <p className="text-xl font-bold text-orange-400">{validPeerData.length}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-black/60">
            <tr>
              <th className="px-6 py-4 text-left font-bold text-gray-200 sticky left-0 bg-black/60 z-10 min-w-[220px]">
                {t('competidoresTab.company')}
              </th>
              <th className="px-6 py-4 text-center font-bold text-gray-200">{t('competidoresTab.leveredBeta')}</th>
              <th className="px-6 py-4 text-right font-bold text-gray-200">{t('competidoresTab.marketValue')}</th>
              <th className="px-6 py-4 text-right font-bold text-gray-200">{t('competidoresTab.totalDebt')}</th>
              <th className="px-6 py-4 text-right font-bold text-gray-200">{t('competidoresTab.debtToMktCap')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-900/15">
            {validPeerData.map((peer, index) => {
              let debtToMktCap: number | null = null;
              if (peer.totalDebt !== null && peer.marketCap !== null && peer.marketCap > 0) {
                debtToMktCap = peer.totalDebt / peer.marketCap;
              }

              const isMainTicker = peer.symbol === ticker;

              return (
                <tr
                  key={peer.symbol}
                  className={`hover:bg-black/50 transition-colors ${
                    isMainTicker ? 'bg-green-900/30 border-l-4 border-green-500' : ''
                  }`}
                >
                  <td className={`px-6 py-4 font-medium sticky left-0 z-10 border-r border-white/[0.06] ${
                    isMainTicker ? 'bg-green-900/30' : 'bg-black/80'
                  }`}>
                    <span className={`font-semibold ${isMainTicker ? 'text-green-400' : 'text-gray-100'}`}>
                      {peer.symbol}
                    </span>
                    <span className="text-gray-400 text-sm ml-2">
                      ({peer.companyName || 'N/A'})
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center text-gray-300 font-medium">
                    {peer.beta !== null ? peer.beta.toFixed(2) : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold">
                    {peer.marketCap !== null ? (
                      <span className="text-green-400">
                        ${(peer.marketCap / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {peer.totalDebt !== null ? (
                      `$${(peer.totalDebt / 1e9).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right font-medium">
                    {debtToMktCap !== null ? (
                      <span className={debtToMktCap > 0.5 ? 'text-red-400' : 'text-green-400'}>
                        {(debtToMktCap * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 text-center">
        Data from Financial Modeling Prep. Main ticker + up to 8 competitors.
      </p>
    </div>
  );
}
