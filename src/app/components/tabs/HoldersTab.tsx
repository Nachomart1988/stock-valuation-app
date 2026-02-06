// src/app/components/tabs/HoldersTab.tsx
'use client';

import { useEffect, useState } from 'react';

interface HoldersTabProps {
  ticker: string;
}

interface InstitutionalHolder {
  holder: string;
  shares: number;
  dateReported: string;
  change: number;
  changePercentage: number;
  value: number;
}

interface MutualFundHolder {
  holder: string;
  shares: number;
  dateReported: string;
  change: number;
  changePercentage: number;
  weightPercentage: number;
}

interface InsiderHolder {
  name: string;
  position: string;
  shares: number;
  lastDate: string;
  transactionType: string;
}

interface OwnershipSummary {
  institutionalOwnership: number;
  insiderOwnership: number;
  institutionalHolders: number;
  institutionalSharesHeld: number;
}

export default function HoldersTab({ ticker }: HoldersTabProps) {
  const [institutionalHolders, setInstitutionalHolders] = useState<InstitutionalHolder[]>([]);
  const [mutualFundHolders, setMutualFundHolders] = useState<MutualFundHolder[]>([]);
  const [ownershipSummary, setOwnershipSummary] = useState<OwnershipSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'institutional' | 'mutualfunds'>('institutional');

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;

      setLoading(true);
      setError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('API key not found');

        const [instRes, fundRes, summaryRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/institutional-holder?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/mutual-fund-holder?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/institutional-ownership/symbol-ownership-percent?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        if (instRes.ok) {
          const text = await instRes.text();
          console.log('[HoldersTab] Institutional raw response:', text.substring(0, 500));
          try {
            const data = JSON.parse(text);
            console.log('[HoldersTab] Institutional holders parsed:', Array.isArray(data) ? data.length : 'not array');
            setInstitutionalHolders(Array.isArray(data) ? data.slice(0, 25) : []);
          } catch (e) {
            console.error('[HoldersTab] Failed to parse institutional data:', e);
          }
        } else {
          console.error('[HoldersTab] Institutional fetch failed:', instRes.status);
        }

        if (fundRes.ok) {
          const text = await fundRes.text();
          console.log('[HoldersTab] Mutual fund raw response:', text.substring(0, 500));
          try {
            const data = JSON.parse(text);
            console.log('[HoldersTab] Mutual fund holders parsed:', Array.isArray(data) ? data.length : 'not array');
            setMutualFundHolders(Array.isArray(data) ? data.slice(0, 25) : []);
          } catch (e) {
            console.error('[HoldersTab] Failed to parse mutual fund data:', e);
          }
        } else {
          console.error('[HoldersTab] Mutual fund fetch failed:', fundRes.status);
        }

        if (summaryRes.ok) {
          const text = await summaryRes.text();
          console.log('[HoldersTab] Ownership summary raw:', text.substring(0, 500));
          try {
            const data = JSON.parse(text);
            console.log('[HoldersTab] Ownership summary parsed:', Array.isArray(data) ? data.length : 'not array');
            if (Array.isArray(data) && data.length > 0) {
              const latest = data[0];
              setOwnershipSummary({
                institutionalOwnership: latest.institutionalOwnershipPercentage || latest.ownershipPercent || 0,
                insiderOwnership: 0, // Not available from this endpoint
                institutionalHolders: latest.investorsHolding || 0,
                institutionalSharesHeld: latest.totalInvested || 0,
              });
            }
          } catch (e) {
            console.error('[HoldersTab] Failed to parse ownership data:', e);
          }
        } else {
          console.error('[HoldersTab] Ownership summary fetch failed:', summaryRes.status);
        }
      } catch (err: any) {
        setError(err.message || 'Error loading data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'N/A';
    return value.toLocaleString('en-US');
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'N/A';
    if (Math.abs(value) >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
    if (Math.abs(value) >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (Math.abs(value) >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
    return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'N/A';
    return value.toFixed(2) + '%';
  };

  const getChangeColor = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'text-gray-400';
    return value >= 0 ? 'text-green-400' : 'text-red-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400 text-center py-10">Error: {error}</p>;
  }

  // Show a message if no data is available at all
  const hasNoData = institutionalHolders.length === 0 && mutualFundHolders.length === 0 && !ownershipSummary;
  if (hasNoData) {
    return (
      <div className="space-y-6">
        <h3 className="text-3xl font-bold text-gray-100">Shareholders & Ownership - {ticker}</h3>
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl p-8 text-center">
          <p className="text-2xl text-amber-400 mb-4">No ownership data available</p>
          <p className="text-gray-400">
            Institutional and mutual fund holder data is not available for this ticker.
            This may happen for smaller companies, ADRs, or companies that haven't filed recent 13F forms.
          </p>
          <p className="text-gray-500 mt-4 text-sm">
            Check the browser console for API response details.
          </p>
        </div>
      </div>
    );
  }

  const totalInstitutionalValue = institutionalHolders.reduce((sum, h) => sum + (h.value || 0), 0);
  const totalInstitutionalShares = institutionalHolders.reduce((sum, h) => sum + (h.shares || 0), 0);

  return (
    <div className="space-y-10">
      <h3 className="text-3xl font-bold text-gray-100">Shareholders & Ownership - {ticker}</h3>

      {/* Ownership Summary */}
      {ownershipSummary && (
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 p-6 rounded-xl border border-blue-600">
          <h4 className="text-2xl font-bold text-blue-400 mb-6">Ownership Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-gray-800/50 p-6 rounded-xl text-center">
              <p className="text-4xl font-bold text-blue-400">
                {formatPercent(ownershipSummary.institutionalOwnership)}
              </p>
              <p className="text-sm text-gray-400 mt-2">Institutional Ownership</p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center">
              <p className="text-4xl font-bold text-purple-400">
                {formatPercent(ownershipSummary.insiderOwnership)}
              </p>
              <p className="text-sm text-gray-400 mt-2">Insider Ownership</p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center">
              <p className="text-4xl font-bold text-green-400">
                {formatNumber(ownershipSummary.institutionalHolders)}
              </p>
              <p className="text-sm text-gray-400 mt-2">Institutional Holders</p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center">
              <p className="text-4xl font-bold text-amber-400">
                {formatNumber(ownershipSummary.institutionalSharesHeld)}
              </p>
              <p className="text-sm text-gray-400 mt-2">Shares Held</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-4 border-b border-gray-700 pb-2">
        <button
          onClick={() => setActiveView('institutional')}
          className={`px-6 py-3 rounded-t-xl font-semibold text-lg transition-all ${
            activeView === 'institutional'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          Institutional ({institutionalHolders.length})
        </button>
        <button
          onClick={() => setActiveView('mutualfunds')}
          className={`px-6 py-3 rounded-t-xl font-semibold text-lg transition-all ${
            activeView === 'mutualfunds'
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          Mutual Funds ({mutualFundHolders.length})
        </button>
      </div>

      {/* Institutional Holders */}
      {activeView === 'institutional' && (
        <div className="space-y-6">
          {institutionalHolders.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No institutional holder data available</p>
          ) : (
            <>
              <div className="bg-gray-800/50 p-4 rounded-xl flex justify-between items-center">
                <span className="text-gray-400">Top {institutionalHolders.length} Institutional Holders</span>
                <div className="flex gap-6">
                  <span className="text-gray-300">
                    Total Shares: <span className="text-blue-400 font-semibold">{formatNumber(totalInstitutionalShares)}</span>
                  </span>
                  <span className="text-gray-300">
                    Total Value: <span className="text-green-400 font-semibold">{formatCurrency(totalInstitutionalValue)}</span>
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="py-3 px-4 text-gray-400 font-semibold">#</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold">Holder</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">Shares</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">Value</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">Change</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">Change %</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {institutionalHolders.map((holder, idx) => (
                      <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-3 px-4 text-gray-500">{idx + 1}</td>
                        <td className="py-3 px-4 text-gray-200 font-medium">{holder.holder}</td>
                        <td className="py-3 px-4 text-right text-gray-100">{formatNumber(holder.shares)}</td>
                        <td className="py-3 px-4 text-right text-green-400">{formatCurrency(holder.value)}</td>
                        <td className={`py-3 px-4 text-right ${getChangeColor(holder.change)}`}>
                          {holder.change > 0 ? '+' : ''}{formatNumber(holder.change)}
                        </td>
                        <td className={`py-3 px-4 text-right ${getChangeColor(holder.changePercentage)}`}>
                          {holder.changePercentage > 0 ? '+' : ''}{formatPercent(holder.changePercentage)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-400">{holder.dateReported}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Mutual Fund Holders */}
      {activeView === 'mutualfunds' && (
        <div className="space-y-6">
          {mutualFundHolders.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No mutual fund holder data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="py-3 px-4 text-gray-400 font-semibold">#</th>
                    <th className="py-3 px-4 text-gray-400 font-semibold">Fund</th>
                    <th className="py-3 px-4 text-gray-400 font-semibold text-right">Shares</th>
                    <th className="py-3 px-4 text-gray-400 font-semibold text-right">Weight %</th>
                    <th className="py-3 px-4 text-gray-400 font-semibold text-right">Change</th>
                    <th className="py-3 px-4 text-gray-400 font-semibold text-right">Change %</th>
                    <th className="py-3 px-4 text-gray-400 font-semibold text-right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {mutualFundHolders.map((holder, idx) => (
                    <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                      <td className="py-3 px-4 text-gray-500">{idx + 1}</td>
                      <td className="py-3 px-4 text-gray-200 font-medium">{holder.holder}</td>
                      <td className="py-3 px-4 text-right text-gray-100">{formatNumber(holder.shares)}</td>
                      <td className="py-3 px-4 text-right text-purple-400">{formatPercent(holder.weightPercentage)}</td>
                      <td className={`py-3 px-4 text-right ${getChangeColor(holder.change)}`}>
                        {holder.change > 0 ? '+' : ''}{formatNumber(holder.change)}
                      </td>
                      <td className={`py-3 px-4 text-right ${getChangeColor(holder.changePercentage)}`}>
                        {holder.changePercentage > 0 ? '+' : ''}{formatPercent(holder.changePercentage)}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400">{holder.dateReported}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Summary Stats */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h4 className="text-lg font-semibold text-gray-200 mb-4">Holder Summary</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-blue-400">{institutionalHolders.length}</p>
            <p className="text-sm text-gray-400">Institutional Holders</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-green-400">{mutualFundHolders.length}</p>
            <p className="text-sm text-gray-400">Mutual Fund Holders</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{formatCurrency(totalInstitutionalValue)}</p>
            <p className="text-sm text-gray-400">Total Inst. Value</p>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        Ownership data based on SEC filings and may have a reporting lag.
      </p>
    </div>
  );
}
