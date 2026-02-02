// src/app/components/tabs/CompetidoresTab.tsx
'use client';

import { useEffect, useState } from 'react';

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
  const [peerData, setPeerData] = useState<PeerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPeersAndData = async () => {
      try {
        setLoading(true);
        setError(null);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('FMP_API_KEY no configurada');

        let peerSymbols: string[] = [];

        try {
          const peersRes = await fetch(
            `https://financialmodelingprep.com/stable/stock-peers?symbol=${ticker}&apikey=${apiKey}`
          );
          if (peersRes.ok) {
            const peersJson = await peersRes.json();
            if (Array.isArray(peersJson)) {
              peerSymbols = peersJson.map((p: any) => p.symbol).filter(Boolean).slice(0, 8);
            }
          }
        } catch (e) {
          console.warn('Peers falló, usando fallback');
        }

        if (peerSymbols.length === 0) {
          peerSymbols = ['MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AVGO', 'COST'];
        }

        console.log('Peers usados:', peerSymbols);

        const symbolsToFetch = [ticker, ...peerSymbols];
        const uniqueSymbols = [...new Set(symbolsToFetch)];

        // Quote (marketCap)
        const quotesPromises = uniqueSymbols.map(async (symbol) => {
          try {
            const res = await fetch(
              `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`
            );
            if (!res.ok) return { symbol, name: symbol, marketCap: null };
            const json = await res.json();
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
            const res = await fetch(
              `https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${apiKey}`
            );
            if (!res.ok) return { symbol, beta: null };
            const json = await res.json();
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
            const res = await fetch(
              `https://financialmodelingprep.com/stable/balance-sheet-statement?symbol=${symbol}&limit=1&apikey=${apiKey}`
            );
            if (!res.ok) return { symbol };
            const json = await res.json();
            return Array.isArray(json) && json[0] ? json[0] : {};
          } catch {
            return {};
          }
        });

        const balanceArray = await Promise.all(balancePromises);
        const balanceMap = new Map(balanceArray.map(b => [b.symbol || '', b]));

        // Armar results
        const results: PeerData[] = uniqueSymbols.map((symbol) => {
          const q = (quotesMap.get(symbol) as QuoteResponse | undefined) ?? {};
          const p = (profilesMap.get(symbol) as ProfileResponse | undefined) ?? {};
          const b = (balanceMap.get(symbol) as BalanceSheetResponse | undefined) ?? {};

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
    return <p className="text-xl text-gray-600 py-10 text-center">Cargando competidores...</p>;
  }

  if (error) {
    return <p className="text-xl text-red-600 py-10 text-center">Error: {error}</p>;
  }

  if (peerData.length === 0) {
    return <p className="text-xl text-gray-600 py-10 text-center">No hay datos de competidores</p>;
  }

  const validPeerData = peerData.filter(
    (peer): peer is PeerData => peer && typeof peer.symbol === 'string' && peer.symbol.trim() !== ''
  );

  return (
    <div className="space-y-6">
      <h3 className="text-3xl font-bold text-gray-900">
        Competidores de {ticker}
      </h3>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 rounded-xl shadow-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-6 py-4 text-left font-bold text-gray-800 sticky left-0 bg-gray-100 z-10 min-w-[220px]">
                Empresa
              </th>
              <th className="px-6 py-4 text-center font-bold text-gray-800">Levered Beta</th>
              <th className="px-6 py-4 text-right font-bold text-gray-800">Mkt. Val. (Equity)</th>
              <th className="px-6 py-4 text-right font-bold text-gray-800">Deuda Total</th>
              <th className="px-6 py-4 text-right font-bold text-gray-800">Debt / Mkt Cap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {validPeerData.map((peer) => {
              // Cálculo manual de Debt / Mkt Cap
              let debtToMktCap: number | null = null;
              if (peer.totalDebt !== null && peer.marketCap !== null && peer.marketCap > 0) {
                debtToMktCap = peer.totalDebt / peer.marketCap;
              }

              return (
                <tr
                  key={peer.symbol}
                  className={`hover:bg-blue-50 transition-colors ${
                    peer.marketCap === null ? 'bg-gray-50 opacity-70' : ''
                  }`}
                >
                  <td className="px-6 py-4 font-medium sticky left-0 bg-white z-10 border-r border-gray-200">
                    <span className="font-semibold text-gray-900">{peer.symbol}</span>
                    <span className="text-gray-600 text-sm ml-2">
                      ({peer.companyName || 'N/A'})
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center text-gray-700 font-medium">
                    {peer.beta !== null ? peer.beta.toFixed(2) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-6 py-4 text-right font-semibold">
                    {peer.marketCap !== null ? (
                      <span className="text-indigo-700">
                        ${(peer.marketCap / 1e9).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {peer.totalDebt !== null ? (
                      `$${(peer.totalDebt / 1e9).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right font-medium">
                    {debtToMktCap !== null ? (
                      <span className={debtToMktCap > 0.5 ? 'text-red-600' : 'text-green-600'}>
                        {(debtToMktCap * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 text-center mt-4">
        Datos de Financial Modeling Prep • Ticker principal + hasta 8 competidores
      </p>
    </div>
  );
}