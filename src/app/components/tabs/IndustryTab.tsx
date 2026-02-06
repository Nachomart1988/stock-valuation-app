// src/app/components/tabs/IndustryTab.tsx
'use client';

import { useEffect, useState } from 'react';

interface IndustryTabProps {
  ticker: string;
}

interface SectorPerformance {
  sector: string;
  changesPercentage?: number;
  averageChange?: number;
  exchange?: string;
  date?: string;
}

interface IndustryPerformance {
  industry: string;
  changesPercentage?: number;
  averageChange?: number;
  exchange?: string;
  date?: string;
}

interface IndustryPE {
  date: string;
  sector: string;
  exchange: string;
  pe: number;
}

interface IndustryPESnapshot {
  date: string;
  industry: string;
  exchange: string;
  pe: number;
}

interface MarketSummary {
  indexName: string;
  price: number;
  change: number;
  changesPercentage: number;
  symbol: string;
}

export default function IndustryTab({ ticker }: IndustryTabProps) {
  const [sectorPerformance, setSectorPerformance] = useState<SectorPerformance[]>([]);
  const [industryPerformance, setIndustryPerformance] = useState<IndustryPerformance[]>([]);
  const [industryPE, setIndustryPE] = useState<IndustryPE[]>([]);
  const [industryPESnapshot, setIndustryPESnapshot] = useState<IndustryPESnapshot[]>([]);
  const [marketSummary, setMarketSummary] = useState<MarketSummary[]>([]);
  const [companyProfile, setCompanyProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;

      setLoading(true);
      setError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('API key not found');

        // Use yesterday's date since today's data might not be available yet
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];

        const [sectorRes, sectorPERes, industryPerfRes, industryPERes, marketRes, profileRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/sector-performance-snapshot?date=${dateStr}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/sector-pe-snapshot?date=${dateStr}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/industry-performance-snapshot?date=${dateStr}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/industry-pe-snapshot?date=${dateStr}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/batch-quote?symbols=%5EGSPC,%5EDJI,%5EIXIC,%5ERUT,%5EVIX&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        if (sectorRes.ok) {
          const data = await sectorRes.json();
          console.log('[IndustryTab] Sector performance:', data);
          setSectorPerformance(Array.isArray(data) ? data : []);
        }

        if (sectorPERes.ok) {
          const data = await sectorPERes.json();
          console.log('[IndustryTab] Sector PE:', data);
          setIndustryPE(Array.isArray(data) ? data : []);
        }

        if (industryPerfRes.ok) {
          const data = await industryPerfRes.json();
          console.log('[IndustryTab] Industry performance:', data);
          setIndustryPerformance(Array.isArray(data) ? data : []);
        }

        if (industryPERes.ok) {
          const data = await industryPERes.json();
          console.log('[IndustryTab] Industry PE snapshot:', data);
          setIndustryPESnapshot(Array.isArray(data) ? data : []);
        }

        if (marketRes.ok) {
          const data = await marketRes.json();
          console.log('[IndustryTab] Market indexes:', data);
          // Filter to major indices
          const majorIndices = (Array.isArray(data) ? data : []).filter((item: any) =>
            ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX'].includes(item.symbol)
          );
          setMarketSummary(majorIndices);
        }

        if (profileRes.ok) {
          const data = await profileRes.json();
          setCompanyProfile(Array.isArray(data) ? data[0] : data);
        }
      } catch (err: any) {
        setError(err.message || 'Error loading data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'N/A';
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
  };

  const getPercentColor = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'text-gray-400';
    return value >= 0 ? 'text-green-400' : 'text-red-400';
  };

  const companySector = companyProfile?.sector || '';
  const companyIndustry = companyProfile?.industry || '';

  // Find sector PE for the company's sector
  const sectorPE = industryPE.find(
    (item) => item.sector?.toLowerCase() === companySector?.toLowerCase()
  );

  // Find industry PE for the company's industry
  const companyIndustryPE = industryPESnapshot.find(
    (item) => item.industry?.toLowerCase() === companyIndustry?.toLowerCase()
  );

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

  return (
    <div className="space-y-10">
      <h3 className="text-3xl font-bold text-gray-100">Industry & Market Performance - {ticker}</h3>

      {/* Company Info */}
      {companyProfile && (
        <div className="bg-gradient-to-r from-blue-900/30 to-cyan-900/30 p-6 rounded-xl border border-blue-600">
          <h4 className="text-2xl font-bold text-blue-400 mb-4">Company Classification</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <p className="text-sm text-gray-400">Sector</p>
              <p className="text-xl font-bold text-gray-100">{companySector || 'N/A'}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <p className="text-sm text-gray-400">Industry</p>
              <p className="text-xl font-bold text-gray-100">{companyIndustry || 'N/A'}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <p className="text-sm text-gray-400">Sector P/E Ratio</p>
              <p className="text-xl font-bold text-purple-400">
                {sectorPE ? sectorPE.pe.toFixed(2) + 'x' : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg">
              <p className="text-sm text-gray-400">Industry P/E Ratio</p>
              <p className="text-xl font-bold text-cyan-400">
                {companyIndustryPE ? companyIndustryPE.pe.toFixed(2) + 'x' : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Market Indices */}
      {marketSummary.length > 0 && (
        <div className="bg-gradient-to-r from-gray-900/50 to-gray-800/50 p-6 rounded-xl border border-gray-600">
          <h4 className="text-2xl font-bold text-gray-200 mb-6">Major Market Indices</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {marketSummary.map((index, idx) => (
              <div key={idx} className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                <p className="text-xs text-gray-400 mb-1">{index.symbol}</p>
                <p className="text-sm font-semibold text-gray-200 mb-2">
                  {index.indexName || index.symbol}
                </p>
                <p className="text-xl font-bold text-gray-100">
                  {index.price?.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </p>
                <p className={`text-sm font-semibold ${getPercentColor(index.changesPercentage)}`}>
                  {formatPercent(index.changesPercentage)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector Performance */}
      {sectorPerformance.length > 0 && (
        <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 p-6 rounded-xl border border-green-600">
          <h4 className="text-2xl font-bold text-green-400 mb-6">Sector Performance</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {sectorPerformance
              .sort((a, b) => ((b.averageChange || b.changesPercentage) || 0) - ((a.averageChange || a.changesPercentage) || 0))
              .map((sector, idx) => {
                const isCompanySector = sector.sector?.toLowerCase() === companySector?.toLowerCase();
                const changeValue = sector.averageChange || sector.changesPercentage || 0;
                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border ${
                      isCompanySector
                        ? 'bg-blue-900/50 border-blue-500'
                        : 'bg-gray-800/50 border-gray-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className={`text-sm font-semibold ${isCompanySector ? 'text-blue-400' : 'text-gray-200'}`}>
                        {sector.sector}
                      </p>
                      {isCompanySector && (
                        <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                          Your Sector
                        </span>
                      )}
                    </div>
                    <p className={`text-2xl font-bold ${getPercentColor(changeValue)}`}>
                      {formatPercent(changeValue)}
                    </p>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Sector P/E Ratios */}
      {industryPE.length > 0 && (
        <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 p-6 rounded-xl border border-purple-600">
          <h4 className="text-2xl font-bold text-purple-400 mb-6">Sector P/E Ratios (NYSE)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="py-3 px-4 text-gray-400 font-semibold">Sector</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">P/E Ratio</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Exchange</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {industryPE
                  .filter((item) => item.exchange === 'NYSE')
                  .sort((a, b) => a.pe - b.pe)
                  .map((item, idx) => {
                    const isCompanySector = item.sector?.toLowerCase() === companySector?.toLowerCase();
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-gray-800 ${
                          isCompanySector ? 'bg-purple-900/30' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={isCompanySector ? 'text-purple-400 font-semibold' : 'text-gray-200'}>
                              {item.sector}
                            </span>
                            {isCompanySector && (
                              <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full">
                                {ticker}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          isCompanySector ? 'text-purple-400' : 'text-gray-100'
                        }`}>
                          {item.pe?.toFixed(2)}x
                        </td>
                        <td className="py-3 px-4 text-right text-gray-400">{item.exchange}</td>
                        <td className="py-3 px-4 text-right text-gray-400">{item.date}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Industry Performance */}
      {industryPerformance.length > 0 && (
        <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/30 p-6 rounded-xl border border-amber-600">
          <h4 className="text-2xl font-bold text-amber-400 mb-6">Industry Performance</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[400px] overflow-y-auto">
            {industryPerformance
              .sort((a, b) => ((b.averageChange || b.changesPercentage) || 0) - ((a.averageChange || a.changesPercentage) || 0))
              .slice(0, 24)
              .map((ind, idx) => {
                const isCompanyIndustry = ind.industry?.toLowerCase() === companyIndustry?.toLowerCase();
                const changeValue = ind.averageChange || ind.changesPercentage || 0;
                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border ${
                      isCompanyIndustry
                        ? 'bg-amber-900/50 border-amber-500'
                        : 'bg-gray-800/50 border-gray-700'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <p className={`text-xs font-semibold ${isCompanyIndustry ? 'text-amber-400' : 'text-gray-300'}`}>
                        {ind.industry}
                      </p>
                      {isCompanyIndustry && (
                        <span className="px-2 py-0.5 bg-amber-600 text-white text-xs rounded-full">
                          Your Industry
                        </span>
                      )}
                    </div>
                    <p className={`text-xl font-bold ${getPercentColor(changeValue)}`}>
                      {formatPercent(changeValue)}
                    </p>
                  </div>
                );
              })}
          </div>
          {industryPerformance.length > 24 && (
            <p className="text-xs text-gray-500 mt-4 text-center">
              Showing top 24 of {industryPerformance.length} industries
            </p>
          )}
        </div>
      )}

      {/* Industry P/E Ratios */}
      {industryPESnapshot.length > 0 && (
        <div className="bg-gradient-to-r from-cyan-900/30 to-teal-900/30 p-6 rounded-xl border border-cyan-600">
          <h4 className="text-2xl font-bold text-cyan-400 mb-6">Industry P/E Ratios</h4>
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="border-b border-gray-700">
                  <th className="py-3 px-4 text-gray-400 font-semibold">Industry</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">P/E Ratio</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Exchange</th>
                </tr>
              </thead>
              <tbody>
                {industryPESnapshot
                  .sort((a, b) => a.pe - b.pe)
                  .slice(0, 30)
                  .map((item, idx) => {
                    const isCompanyIndustry = item.industry?.toLowerCase() === companyIndustry?.toLowerCase();
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-gray-800 ${
                          isCompanyIndustry ? 'bg-cyan-900/30' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={isCompanyIndustry ? 'text-cyan-400 font-semibold' : 'text-gray-200'}>
                              {item.industry}
                            </span>
                            {isCompanyIndustry && (
                              <span className="px-2 py-0.5 bg-cyan-600 text-white text-xs rounded-full">
                                {ticker}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          isCompanyIndustry ? 'text-cyan-400' : 'text-gray-100'
                        }`}>
                          {item.pe?.toFixed(2)}x
                        </td>
                        <td className="py-3 px-4 text-right text-gray-400">{item.exchange}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {industryPESnapshot.length > 30 && (
            <p className="text-xs text-gray-500 mt-4 text-center">
              Showing {Math.min(30, industryPESnapshot.length)} of {industryPESnapshot.length} industries
            </p>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h4 className="text-lg font-semibold text-gray-200 mb-4">Market Summary</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-blue-400">{sectorPerformance.length}</p>
            <p className="text-sm text-gray-400">Sectors Tracked</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">{industryPerformance.length}</p>
            <p className="text-sm text-gray-400">Industries Tracked</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-green-400">
              {sectorPerformance.filter((s) => ((s.averageChange || s.changesPercentage) || 0) > 0).length}
            </p>
            <p className="text-sm text-gray-400">Sectors Up</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-red-400">
              {sectorPerformance.filter((s) => ((s.averageChange || s.changesPercentage) || 0) < 0).length}
            </p>
            <p className="text-sm text-gray-400">Sectors Down</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-purple-400">
              {sectorPE ? sectorPE.pe.toFixed(1) + 'x' : 'N/A'}
            </p>
            <p className="text-sm text-gray-400">{companySector} P/E</p>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        Market data and sector performance updated in real-time.
      </p>
    </div>
  );
}
