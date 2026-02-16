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

  // Helper: get recent business dates for fallback
  const getRecentDates = (): string[] => {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 1; i <= 10; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (d.getDay() !== 0 && d.getDay() !== 6) {
        dates.push(d.toISOString().split('T')[0]);
      }
    }
    return dates;
  };

  // Helper: fetch with date fallback (tries multiple dates until data is found)
  const fetchWithDateFallback = async (baseUrl: string, dates: string[], apiKey: string): Promise<any[]> => {
    for (const date of dates) {
      try {
        const res = await fetch(`${baseUrl}?date=${date}&apikey=${apiKey}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            console.log(`[IndustryTab] Found data for ${baseUrl} on ${date}`);
            return data;
          }
        }
      } catch {
        continue;
      }
    }
    return [];
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;

      setLoading(true);
      setError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('API key not found');

        const dates = getRecentDates();

        // Fetch profile and market indices (no date needed)
        const [marketRes, profileRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/api/v3/quote/%5EGSPC,%5EDJI,%5EIXIC,%5ERUT,%5EVIX?apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        if (marketRes.ok) {
          const data = await marketRes.json();
          console.log('[IndustryTab] Market indexes:', data);
          setMarketSummary(Array.isArray(data) ? data : []);
        }

        if (profileRes.ok) {
          const data = await profileRes.json();
          setCompanyProfile(Array.isArray(data) ? data[0] : data);
        }

        // Fetch date-dependent data with fallback (using /stable/ for premium snapshot endpoints)
        const [sectorPerfData, sectorPEData, industryPerfData, industryPEData] = await Promise.all([
          fetchWithDateFallback('https://financialmodelingprep.com/stable/sector-performance-snapshot', dates, apiKey),
          fetchWithDateFallback('https://financialmodelingprep.com/stable/sector-pe-snapshot', dates, apiKey),
          fetchWithDateFallback('https://financialmodelingprep.com/stable/industry-performance-snapshot', dates, apiKey),
          fetchWithDateFallback('https://financialmodelingprep.com/stable/industry-pe-snapshot', dates, apiKey),
        ]);

        console.log('[IndustryTab] Sector performance:', sectorPerfData.length);
        console.log('[IndustryTab] Sector PE:', sectorPEData.length);
        console.log('[IndustryTab] Industry performance:', industryPerfData.length);
        console.log('[IndustryTab] Industry PE:', industryPEData.length);

        setSectorPerformance(sectorPerfData);
        setIndustryPE(sectorPEData);
        setIndustryPerformance(industryPerfData);
        setIndustryPESnapshot(industryPEData);
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
          <h4 className="text-2xl font-bold text-green-400 mb-6">
            Sector Performance - All {sectorPerformance.length} Sectors
          </h4>
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
                        ? 'bg-blue-900/50 border-blue-500 ring-2 ring-blue-400'
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
                    {sector.date && (
                      <p className="text-xs text-gray-500 mt-1">{sector.date}</p>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Sector P/E Ratios */}
      {industryPE.length > 0 && (
        <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 p-6 rounded-xl border border-purple-600">
          <h4 className="text-2xl font-bold text-purple-400 mb-6">
            Sector P/E Ratios - All Exchanges ({industryPE.length} entries)
          </h4>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="border-b border-gray-700">
                  <th className="py-3 px-4 text-gray-400 font-semibold">Sector</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">P/E Ratio</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Exchange</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {industryPE
                  .sort((a, b) => {
                    // First sort by sector (company sector first)
                    const aIsCompany = a.sector?.toLowerCase() === companySector?.toLowerCase();
                    const bIsCompany = b.sector?.toLowerCase() === companySector?.toLowerCase();
                    if (aIsCompany && !bIsCompany) return -1;
                    if (!aIsCompany && bIsCompany) return 1;
                    // Then by exchange (NYSE, NASDAQ, etc.)
                    if (a.exchange !== b.exchange) return a.exchange.localeCompare(b.exchange);
                    // Finally by PE ratio
                    return a.pe - b.pe;
                  })
                  .map((item, idx) => {
                    const isCompanySector = item.sector?.toLowerCase() === companySector?.toLowerCase();
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-gray-800 ${
                          isCompanySector ? 'bg-purple-900/40 ring-2 ring-inset ring-purple-500' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={isCompanySector ? 'text-purple-400 font-bold' : 'text-gray-200'}>
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
                          isCompanySector ? 'text-purple-400 text-lg' : 'text-gray-100'
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
          <h4 className="text-2xl font-bold text-amber-400 mb-6">
            Industry Performance - All {industryPerformance.length} Industries
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto pr-2">
            {industryPerformance
              .sort((a, b) => ((b.averageChange || b.changesPercentage) || 0) - ((a.averageChange || a.changesPercentage) || 0))
              .map((ind, idx) => {
                const isCompanyIndustry = ind.industry?.toLowerCase() === companyIndustry?.toLowerCase();
                const changeValue = ind.averageChange || ind.changesPercentage || 0;
                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border ${
                      isCompanyIndustry
                        ? 'bg-amber-900/50 border-amber-500 ring-2 ring-amber-400'
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
        </div>
      )}

      {/* Industry P/E Ratios */}
      {industryPESnapshot.length > 0 && (
        <div className="bg-gradient-to-r from-cyan-900/30 to-teal-900/30 p-6 rounded-xl border border-cyan-600">
          <h4 className="text-2xl font-bold text-cyan-400 mb-6">
            Industry P/E Ratios - All {industryPESnapshot.length} Industries
          </h4>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="border-b border-gray-700">
                  <th className="py-3 px-4 text-gray-400 font-semibold">Industry</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">P/E Ratio</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Exchange</th>
                  <th className="py-3 px-4 text-gray-400 font-semibold text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {industryPESnapshot
                  .sort((a, b) => a.pe - b.pe)
                  .map((item, idx) => {
                    const isCompanyIndustry = item.industry?.toLowerCase() === companyIndustry?.toLowerCase();
                    return (
                      <tr
                        key={idx}
                        className={`border-b border-gray-800 ${
                          isCompanyIndustry ? 'bg-cyan-900/40 ring-2 ring-inset ring-cyan-500' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={isCompanyIndustry ? 'text-cyan-400 font-bold' : 'text-gray-200'}>
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
                          isCompanyIndustry ? 'text-cyan-400 text-lg' : 'text-gray-100'
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

      {/* Summary */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h4 className="text-lg font-semibold text-gray-200 mb-4">📊 Complete Market Summary</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
            <p className="text-sm text-gray-400">{companySector} Sector P/E</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-cyan-400">
              {companyIndustryPE ? companyIndustryPE.pe.toFixed(1) + 'x' : 'N/A'}
            </p>
            <p className="text-sm text-gray-400">{companyIndustry} Industry P/E</p>
          </div>
        </div>
      </div>

      <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
        <p className="text-center text-sm text-blue-300">
          ✅ <strong>Mostrando TODOS los datos disponibles</strong> - Sector e Industria de {ticker} resaltados
        </p>
        <p className="text-center text-xs text-gray-400 mt-2">
          Datos actualizados automáticamente con las fechas más recientes disponibles
        </p>
      </div>
    </div>
  );
}
