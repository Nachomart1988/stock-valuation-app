// src/app/components/tabs/HoldersTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { LogoLoader } from '@/app/components/ui/LogoLoader';

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

interface InsiderTradingStats {
  symbol: string;
  year: number;
  quarter: number;
  purchases: number;
  sales: number;
  buySellRatio: number;
  totalBought: number;
  totalSold: number;
  averageBought: number;
  averageSold: number;
  pPurchases: number;
  sSales: number;
}

interface PositionsSummary {
  symbol: string;
  year: number;
  quarter: number;
  investorsHolding: number;
  lastQuarterInvestorsHolding: number;
  investorsHoldingChange: number;
  numberOf13FShares: number;
  lastQuarterNumberOf13FShares: number;
  numberOf13FSharesChange: number;
  totalInvested: number;
  lastQuarterTotalInvested: number;
  totalInvestedChange: number;
  ownershipPercent: number;
  lastQuarterOwnershipPercent: number;
  ownershipPercentChange: number;
  newPositions: number;
  lastQuarterNewPositions: number;
  newPositionsChange: number;
  increasedPositions: number;
  lastQuarterIncreasedPositions: number;
  increasedPositionsChange: number;
  closedPositions: number;
  lastQuarterClosedPositions: number;
  closedPositionsChange: number;
  reducedPositions: number;
  lastQuarterReducedPositions: number;
  reducedPositionsChange: number;
  totalCalls: number;
  lastQuarterTotalCalls: number;
  totalCallsChange: number;
  totalPuts: number;
  lastQuarterTotalPuts: number;
  totalPutsChange: number;
  putCallRatio: number;
  lastQuarterPutCallRatio: number;
  putCallRatioChange: number;
}

interface InstitutionalOwnershipAnalytics {
  cik: string;
  investorName: string;
  shares: number;
  sharesLastQuarter: number;
  changeInSharesPercentage: number;
  avgPricePaid: number;
  dateReported: string;
  isNew: boolean;
  isSoldOut: boolean;
  ownership: number;
  lastOwnership: number;
  changeInOwnership: number;
  holdingPeriod: number;
  firstAdded: string;
  performance: number;
  performancePercentage: number;
  portfolioPercent: number;
  lastPortfolioPercent: number;
  changeInPortfolioPercent: number;
  totalInvested: number;
  totalInvestedChange: number;
  totalInvestedChangePercent: number;
}

interface OwnershipSummary {
  institutionalOwnership: number;
  insiderOwnership: number;
  institutionalHolders: number;
  institutionalSharesHeld: number;
}

interface QuarterData {
  year: number;
  quarter: number;
}

// Helper to get last 4 quarters
function getLast4Quarters(): QuarterData[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

  const quarters: QuarterData[] = [];
  let y = currentYear;
  let q = currentQuarter - 1; // Start from previous quarter (current may not have data)

  if (q <= 0) {
    q = 4;
    y = y - 1;
  }

  for (let i = 0; i < 4; i++) {
    quarters.push({ year: y, quarter: q });
    q--;
    if (q <= 0) {
      q = 4;
      y--;
    }
  }

  return quarters;
}

export default function HoldersTab({ ticker }: HoldersTabProps) {
  const { t } = useLanguage();
  const [institutionalHolders, setInstitutionalHolders] = useState<InstitutionalHolder[]>([]);
  const [mutualFundHolders, setMutualFundHolders] = useState<MutualFundHolder[]>([]);
  const [ownershipSummary, setOwnershipSummary] = useState<OwnershipSummary | null>(null);
  const [insiderStats, setInsiderStats] = useState<InsiderTradingStats | null>(null);
  const [positionsSummary, setPositionsSummary] = useState<PositionsSummary | null>(null);
  const [positionsHistory, setPositionsHistory] = useState<PositionsSummary[]>([]);
  const [institutionalAnalytics, setInstitutionalAnalytics] = useState<InstitutionalOwnershipAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'summary' | 'institutional' | 'mutualfunds' | 'analytics'>('summary');

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;

      setLoading(true);
      setError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('API key not found');

        // Get last 4 quarters for historical data
        const quarters = getLast4Quarters();
        const latestQuarter = quarters[0];

        // Parallel fetch all data
        const [instRes, fundRes, summaryRes, insiderStatsRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/institutional-holder?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/mutual-fund-holder?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/institutional-ownership/symbol-ownership-percent?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/insider-trading/statistics?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        // Fetch positions summary for all 4 quarters in parallel
        const positionsPromises = quarters.map(q =>
          fetch(`https://financialmodelingprep.com/stable/institutional-ownership/symbol-positions-summary?symbol=${ticker}&year=${q.year}&quarter=${q.quarter}&apikey=${apiKey}`, { cache: 'no-store' })
        );

        // Fetch analytics for latest quarter
        const analyticsRes = await fetch(
          `https://financialmodelingprep.com/stable/institutional-ownership/extract-analytics/holder?symbol=${ticker}&year=${latestQuarter.year}&quarter=${latestQuarter.quarter}&page=0&limit=25&apikey=${apiKey}`,
          { cache: 'no-store' }
        );

        const positionsResponses = await Promise.all(positionsPromises);

        // Handle institutional holders
        let instCount = 0;
        if (instRes.ok) {
          try {
            const data = await instRes.json();
            const arr = Array.isArray(data) ? data.slice(0, 25) : [];
            instCount = arr.length;
            console.log('[HoldersTab] Institutional holders:', instCount);
            setInstitutionalHolders(arr);
          } catch {
            console.log('[HoldersTab] Institutional holders parse error');
          }
        }

        // Handle mutual fund holders
        let fundCount = 0;
        if (fundRes.ok) {
          try {
            const data = await fundRes.json();
            const arr = Array.isArray(data) ? data.slice(0, 25) : [];
            fundCount = arr.length;
            console.log('[HoldersTab] Mutual fund holders:', fundCount);
            setMutualFundHolders(arr);
          } catch {
            console.log('[HoldersTab] Mutual fund holders parse error');
          }
        }

        // Handle ownership summary
        if (summaryRes.ok) {
          try {
            const data = await summaryRes.json();
            console.log('[HoldersTab] Ownership summary:', data);
            if (Array.isArray(data) && data.length > 0) {
              const latest = data[0];
              setOwnershipSummary({
                institutionalOwnership: latest.institutionalOwnershipPercentage || latest.ownershipPercent || 0,
                insiderOwnership: 0,
                institutionalHolders: latest.investorsHolding || 0,
                institutionalSharesHeld: latest.totalInvested || 0,
              });
            }
          } catch {
            console.log('[HoldersTab] Ownership summary parse error');
          }
        }

        // Handle insider trading statistics
        if (insiderStatsRes.ok) {
          try {
            const data = await insiderStatsRes.json();
            console.log('[HoldersTab] Insider trading stats:', data);
            if (Array.isArray(data) && data.length > 0) {
              const sorted = data.sort((a: InsiderTradingStats, b: InsiderTradingStats) => {
                if (b.year !== a.year) return b.year - a.year;
                return b.quarter - a.quarter;
              });
              setInsiderStats(sorted[0]);
            } else if (data && typeof data === 'object' && !Array.isArray(data)) {
              setInsiderStats(data);
            }
          } catch {
            console.log('[HoldersTab] Insider stats parse error');
          }
        }

        // Handle positions summary (all quarters) — inject year/quarter from query params
        const positionsData: PositionsSummary[] = [];
        for (let i = 0; i < positionsResponses.length; i++) {
          const res = positionsResponses[i];
          const qInfo = quarters[i]; // matches the fetch order
          if (res.ok) {
            try {
              const data = await res.json();
              let record: PositionsSummary | null = null;
              if (Array.isArray(data) && data.length > 0) {
                record = data[0];
              } else if (data && typeof data === 'object' && !Array.isArray(data) && data.symbol) {
                record = data;
              }
              if (record) {
                // Ensure year/quarter are set from query params if API doesn't return them
                positionsData.push({
                  ...record,
                  year: record.year || qInfo.year,
                  quarter: record.quarter || qInfo.quarter,
                });
              }
            } catch {
              console.log('[HoldersTab] Positions summary parse error');
            }
          }
        }

        console.log('[HoldersTab] Positions history:', positionsData.length, 'quarters');
        setPositionsHistory(positionsData);
        if (positionsData.length > 0) {
          setPositionsSummary(positionsData[0]); // Latest quarter
        }

        // Handle institutional analytics
        let analyticsCount = 0;
        if (analyticsRes.ok) {
          try {
            const data = await analyticsRes.json();
            console.log('[HoldersTab] Institutional analytics:', data?.length || 0);
            if (Array.isArray(data) && data.length > 0) {
              setInstitutionalAnalytics(data.slice(0, 25));
              analyticsCount = data.length;
            }
          } catch {
            console.log('[HoldersTab] Analytics parse error');
          }
        }

        // Auto-switch: if institutional and mutual fund data are both empty, show analytics
        if (analyticsCount > 0 && instCount === 0 && fundCount === 0) {
          setActiveView('analytics');
        }

      } catch (err: any) {
        console.error('[HoldersTab] Error:', err);
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
    if (Math.abs(value) >= 1e3) return '$' + (value / 1e3).toFixed(2) + 'K';
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

  const formatShares = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value)) return 'N/A';
    if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(2) + 'B';
    if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(2) + 'K';
    return value.toLocaleString('en-US');
  };

  const formatChangeArrow = (value: number | null | undefined) => {
    if (value === null || value === undefined || !isFinite(value) || value === 0) return '';
    return value > 0 ? '▲' : '▼';
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <LogoLoader size="lg" message={t('holdersTab.loading')} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-xl p-6 text-center">
        <p className="text-xl text-red-400">❌ Error: {error}</p>
      </div>
    );
  }

  const hasNoData = institutionalHolders.length === 0 && mutualFundHolders.length === 0 && !ownershipSummary && !insiderStats && !positionsSummary;
  if (hasNoData) {
    return (
      <div className="space-y-6">
        <h3 className="text-3xl font-bold text-gray-100">{t('holdersTab.title')} - {ticker}</h3>
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl p-8 text-center">
          <p className="text-2xl text-amber-400 mb-4">{t('holdersTab.noData')}</p>
          <p className="text-gray-400">
            Institutional and mutual fund holder data is not available for this ticker.
            This may happen for smaller companies, ADRs, or companies that haven't filed recent 13F forms.
          </p>
        </div>
      </div>
    );
  }

  const totalInstitutionalValue = institutionalHolders.reduce((sum, h) => sum + (h.value || 0), 0);
  const totalInstitutionalShares = institutionalHolders.reduce((sum, h) => sum + (h.shares || 0), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {t('holdersTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('holdersTab.subtitle')} {ticker}</p>
        </div>
        {(positionsSummary || ownershipSummary) && (
          <div className="flex items-center gap-4">
            <div className="text-right bg-gray-950 px-4 py-2 rounded-xl border border-green-600">
              <p className="text-xs text-green-400">{t('holdersTab.institutionalOwnership')}</p>
              <p className="text-xl font-bold text-green-400">
                {formatPercent(positionsSummary?.ownershipPercent || ownershipSummary?.institutionalOwnership)}
              </p>
            </div>
            {positionsSummary && (
              <div className="text-right bg-gradient-to-r bg-gray-900 px-4 py-2 rounded-xl border border-emerald-600">
                <p className="text-xs text-emerald-400">Q{positionsSummary.quarter} {positionsSummary.year}</p>
                <p className="text-xl font-bold text-emerald-400">
                  {formatNumber(positionsSummary.investorsHolding)} {t('holdersTab.institutionalHolders')}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Positions Summary Cards - NEW */}
      {positionsSummary && (
        <div className="bg-gray-950 p-6 rounded-xl border border-green-600">
          <h4 className="text-2xl font-bold text-green-400 mb-6 flex items-center gap-3">
            <span>🏛️</span> {t('holdersTab.positionsSummary')}
            <span className="text-sm font-normal text-gray-400">
              Q{positionsSummary.quarter} {positionsSummary.year}
            </span>
          </h4>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {/* Investors Holding */}
            <div className="bg-gray-800/50 p-4 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">{t('holdersTab.investorsHolding')}</p>
              <p className="text-2xl font-bold text-white">{formatNumber(positionsSummary.investorsHolding)}</p>
              <p className={`text-sm ${getChangeColor(positionsSummary.investorsHoldingChange)}`}>
                {formatChangeArrow(positionsSummary.investorsHoldingChange)} {formatNumber(Math.abs(positionsSummary.investorsHoldingChange || 0))}
              </p>
            </div>

            {/* Total Invested */}
            <div className="bg-gray-800/50 p-4 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">{t('holdersTab.totalInvested')}</p>
              <p className="text-2xl font-bold text-green-400">{formatCurrency(positionsSummary.totalInvested)}</p>
              <p className={`text-sm ${getChangeColor(positionsSummary.totalInvestedChange)}`}>
                {formatChangeArrow(positionsSummary.totalInvestedChange)} {formatCurrency(Math.abs(positionsSummary.totalInvestedChange || 0))}
              </p>
            </div>

            {/* 13F Shares */}
            <div className="bg-gray-800/50 p-4 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">{t('holdersTab.thirteenFShares')}</p>
              <p className="text-2xl font-bold text-green-400">{formatShares(positionsSummary.numberOf13FShares)}</p>
              <p className={`text-sm ${getChangeColor(positionsSummary.numberOf13FSharesChange)}`}>
                {formatChangeArrow(positionsSummary.numberOf13FSharesChange)} {formatShares(Math.abs(positionsSummary.numberOf13FSharesChange || 0))}
              </p>
            </div>

            {/* Ownership % */}
            <div className="bg-gray-800/50 p-4 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">{t('holdersTab.ownershipPercent')}</p>
              <p className="text-2xl font-bold text-emerald-400">{formatPercent(positionsSummary.ownershipPercent)}</p>
              <p className={`text-sm ${getChangeColor(positionsSummary.ownershipPercentChange)}`}>
                {formatChangeArrow(positionsSummary.ownershipPercentChange)} {formatPercent(Math.abs(positionsSummary.ownershipPercentChange || 0))}
              </p>
            </div>

            {/* Put/Call Ratio */}
            <div className="bg-gray-800/50 p-4 rounded-xl">
              <p className="text-xs text-gray-400 mb-1">{t('holdersTab.putCallRatio')}</p>
              <p className={`text-2xl font-bold ${(positionsSummary.putCallRatio || 0) > 1 ? 'text-red-400' : 'text-green-400'}`}>
                {positionsSummary.putCallRatio?.toFixed(2) || 'N/A'}
              </p>
              <p className={`text-sm ${getChangeColor(-positionsSummary.putCallRatioChange)}`}>
                {formatChangeArrow(-positionsSummary.putCallRatioChange)} {Math.abs(positionsSummary.putCallRatioChange || 0).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Position Changes Grid */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-green-900/30 p-4 rounded-xl border border-green-700/50">
              <div className="flex items-center justify-between">
                <span className="text-green-400 text-sm">{t('holdersTab.newPositions')}</span>
                <span className="text-2xl">🆕</span>
              </div>
              <p className="text-3xl font-bold text-green-400 mt-2">{positionsSummary.newPositions || 0}</p>
              <p className={`text-sm ${getChangeColor(positionsSummary.newPositionsChange)}`}>
                vs last: {positionsSummary.lastQuarterNewPositions || 0}
              </p>
            </div>

            <div className="bg-green-900/30 p-4 rounded-xl border border-green-700/50">
              <div className="flex items-center justify-between">
                <span className="text-green-400 text-sm">{t('holdersTab.increasedPositions')}</span>
                <span className="text-2xl">📈</span>
              </div>
              <p className="text-3xl font-bold text-green-400 mt-2">{positionsSummary.increasedPositions || 0}</p>
              <p className={`text-sm ${getChangeColor(positionsSummary.increasedPositionsChange)}`}>
                vs last: {positionsSummary.lastQuarterIncreasedPositions || 0}
              </p>
            </div>

            <div className="bg-amber-900/30 p-4 rounded-xl border border-amber-700/50">
              <div className="flex items-center justify-between">
                <span className="text-amber-400 text-sm">{t('holdersTab.reducedPositions')}</span>
                <span className="text-2xl">📉</span>
              </div>
              <p className="text-3xl font-bold text-amber-400 mt-2">{positionsSummary.reducedPositions || 0}</p>
              <p className={`text-sm ${getChangeColor(-positionsSummary.reducedPositionsChange)}`}>
                vs last: {positionsSummary.lastQuarterReducedPositions || 0}
              </p>
            </div>

            <div className="bg-red-900/30 p-4 rounded-xl border border-red-700/50">
              <div className="flex items-center justify-between">
                <span className="text-red-400 text-sm">{t('holdersTab.closedPositions')}</span>
                <span className="text-2xl">🚪</span>
              </div>
              <p className="text-3xl font-bold text-red-400 mt-2">{positionsSummary.closedPositions || 0}</p>
              <p className={`text-sm ${getChangeColor(-positionsSummary.closedPositionsChange)}`}>
                vs last: {positionsSummary.lastQuarterClosedPositions || 0}
              </p>
            </div>
          </div>

          {/* Options Activity */}
          {(positionsSummary.totalCalls > 0 || positionsSummary.totalPuts > 0) && (
            <div className="mt-6 bg-gray-800/50 p-4 rounded-xl">
              <h5 className="text-sm font-semibold text-gray-300 mb-3">Options Activity (13F)</h5>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-xs text-gray-400">Total Calls</p>
                  <p className="text-xl font-bold text-green-400">{formatShares(positionsSummary.totalCalls)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Total Puts</p>
                  <p className="text-xl font-bold text-red-400">{formatShares(positionsSummary.totalPuts)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-gray-400">Put/Call Ratio</p>
                  <p className={`text-xl font-bold ${(positionsSummary.putCallRatio || 0) > 1 ? 'text-red-400' : 'text-green-400'}`}>
                    {positionsSummary.putCallRatio?.toFixed(2) || 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quarterly Trend Chart */}
      {positionsHistory.length > 1 && (
        <div className="bg-gradient-to-r from-gray-950 to-teal-900/30 p-6 rounded-xl border border-emerald-600">
          <h4 className="text-xl font-bold text-emerald-400 mb-4">📊 Quarterly Ownership Trend</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="py-2 px-3 text-left text-gray-400">Quarter</th>
                  <th className="py-2 px-3 text-right text-gray-400">Investors</th>
                  <th className="py-2 px-3 text-right text-gray-400">Ownership %</th>
                  <th className="py-2 px-3 text-right text-gray-400">Total Invested</th>
                  <th className="py-2 px-3 text-right text-gray-400">New</th>
                  <th className="py-2 px-3 text-right text-gray-400">Increased</th>
                  <th className="py-2 px-3 text-right text-gray-400">Reduced</th>
                  <th className="py-2 px-3 text-right text-gray-400">Closed</th>
                </tr>
              </thead>
              <tbody>
                {positionsHistory.map((q, idx) => (
                  <tr key={`${q.year}-${q.quarter}`} className={`border-b border-gray-800 ${idx === 0 ? 'bg-emerald-900/20' : ''}`}>
                    <td className="py-2 px-3 font-medium text-gray-200">
                      Q{q.quarter} {q.year}
                      {idx === 0 && <span className="ml-2 text-xs text-emerald-400">(Latest)</span>}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-100">{formatNumber(q.investorsHolding)}</td>
                    <td className="py-2 px-3 text-right text-green-400">{formatPercent(q.ownershipPercent)}</td>
                    <td className="py-2 px-3 text-right text-green-400">{formatCurrency(q.totalInvested)}</td>
                    <td className="py-2 px-3 text-right text-green-400">{q.newPositions || 0}</td>
                    <td className="py-2 px-3 text-right text-green-400">{q.increasedPositions || 0}</td>
                    <td className="py-2 px-3 text-right text-amber-400">{q.reducedPositions || 0}</td>
                    <td className="py-2 px-3 text-right text-red-400">{q.closedPositions || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Insider Trading Statistics */}
      {insiderStats && (
        <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/30 p-6 rounded-xl border border-amber-600">
          <h4 className="text-2xl font-bold text-amber-400 mb-6 flex items-center gap-3">
            <span>🔍</span> {t('holdersTab.insiderTrading')}
            <span className="text-sm font-normal text-gray-400">
              Q{insiderStats.quarter} {insiderStats.year}
            </span>
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-gray-800/50 p-4 rounded-xl text-center">
              <p className="text-3xl font-bold text-green-400">{insiderStats.purchases || 0}</p>
              <p className="text-sm text-gray-400 mt-1">{t('holdersTab.purchases')}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-xl text-center">
              <p className="text-3xl font-bold text-red-400">{insiderStats.sales || 0}</p>
              <p className="text-sm text-gray-400 mt-1">{t('holdersTab.sales')}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-xl text-center">
              <p className={`text-3xl font-bold ${(insiderStats.buySellRatio || 0) >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                {insiderStats.buySellRatio?.toFixed(2) || 'N/A'}
              </p>
              <p className="text-sm text-gray-400 mt-1">{t('holdersTab.buySellRatio')}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-xl text-center">
              <p className="text-3xl font-bold text-green-400">{formatCurrency(insiderStats.totalBought)}</p>
              <p className="text-sm text-gray-400 mt-1">{t('holdersTab.totalBought')}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-xl text-center">
              <p className="text-3xl font-bold text-red-400">{formatCurrency(insiderStats.totalSold)}</p>
              <p className="text-sm text-gray-400 mt-1">{t('holdersTab.totalSold')}</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-xl text-center">
              <p className={`text-3xl font-bold ${(insiderStats.totalBought || 0) >= (insiderStats.totalSold || 0) ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency((insiderStats.totalBought || 0) - (insiderStats.totalSold || 0))}
              </p>
              <p className="text-sm text-gray-400 mt-1">Net Activity</p>
            </div>
          </div>
          {/* Insider Sentiment Bar */}
          <div className="mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-green-400">Buying Activity</span>
              <span className="text-red-400">Selling Activity</span>
            </div>
            <div className="h-4 bg-gray-700 rounded-full overflow-hidden flex">
              {(() => {
                const total = (insiderStats.totalBought || 0) + (insiderStats.totalSold || 0);
                const buyPercent = total > 0 ? ((insiderStats.totalBought || 0) / total) * 100 : 50;
                return (
                  <>
                    <div className="bg-gradient-to-r from-green-500 to-green-400 h-full transition-all" style={{ width: `${buyPercent}%` }} />
                    <div className="bg-gradient-to-r from-red-400 to-red-500 h-full transition-all" style={{ width: `${100 - buyPercent}%` }} />
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/[0.06] pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveView('summary')}
          className={`px-4 py-2 rounded-t-xl font-semibold transition-all whitespace-nowrap ${
            activeView === 'summary'
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          {t('holdersTab.summary')}
        </button>
        {institutionalHolders.length > 0 && (
          <button
            onClick={() => setActiveView('institutional')}
            className={`px-4 py-2 rounded-t-xl font-semibold transition-all whitespace-nowrap ${
              activeView === 'institutional'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
            }`}
          >
            {t('holdersTab.institutional')} ({institutionalHolders.length})
          </button>
        )}
        {mutualFundHolders.length > 0 && (
          <button
            onClick={() => setActiveView('mutualfunds')}
            className={`px-4 py-2 rounded-t-xl font-semibold transition-all whitespace-nowrap ${
              activeView === 'mutualfunds'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
            }`}
          >
            {t('holdersTab.mutualFunds')} ({mutualFundHolders.length})
          </button>
        )}
        {institutionalAnalytics.length > 0 && (
          <button
            onClick={() => setActiveView('analytics')}
            className={`px-4 py-2 rounded-t-xl font-semibold transition-all whitespace-nowrap ${
              activeView === 'analytics'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
            }`}
          >
            {t('holdersTab.analytics')} ({institutionalAnalytics.length})
          </button>
        )}
      </div>

      {/* Summary View */}
      {activeView === 'summary' && (
        <div className="bg-gray-800 rounded-xl border border-white/[0.06] p-6">
          <h4 className="text-lg font-semibold text-gray-200 mb-4">Quick Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-700 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-green-400">{institutionalHolders.length}</p>
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
            {insiderStats && (
              <div className="bg-gray-700 rounded-lg p-4 text-center">
                <p className={`text-2xl font-bold ${(insiderStats.buySellRatio || 0) >= 1 ? 'text-green-400' : 'text-red-400'}`}>
                  {insiderStats.buySellRatio?.toFixed(2) || 'N/A'}x
                </p>
                <p className="text-sm text-gray-400">Insider Buy/Sell</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Institutional Holders */}
      {activeView === 'institutional' && (
        <div className="space-y-6">
          {institutionalHolders.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No institutional holder data available</p>
          ) : (
            <>
              <div className="bg-gray-800/50 p-4 rounded-xl flex justify-between items-center flex-wrap gap-4">
                <span className="text-gray-400">Top {institutionalHolders.length} Institutional Holders</span>
                <div className="flex gap-6">
                  <span className="text-gray-300">
                    Total Shares: <span className="text-green-400 font-semibold">{formatShares(totalInstitutionalShares)}</span>
                  </span>
                  <span className="text-gray-300">
                    Total Value: <span className="text-green-400 font-semibold">{formatCurrency(totalInstitutionalValue)}</span>
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="py-3 px-4 text-gray-400 font-semibold">#</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold">{t('holdersTab.holder')}</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">{t('holdersTab.shares')}</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">{t('holdersTab.value')}</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">{t('holdersTab.change')}</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">{t('holdersTab.changePercent')}</th>
                      <th className="py-3 px-4 text-gray-400 font-semibold text-right">{t('holdersTab.dateReported')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {institutionalHolders.map((holder, idx) => (
                      <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-3 px-4 text-gray-500">{idx + 1}</td>
                        <td className="py-3 px-4 text-gray-200 font-medium">{holder.holder}</td>
                        <td className="py-3 px-4 text-right text-gray-100">{formatShares(holder.shares)}</td>
                        <td className="py-3 px-4 text-right text-green-400">{formatCurrency(holder.value)}</td>
                        <td className={`py-3 px-4 text-right ${getChangeColor(holder.change)}`}>
                          {holder.change > 0 ? '+' : ''}{formatShares(holder.change)}
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
                  <tr className="border-b border-white/[0.06]">
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
                      <td className="py-3 px-4 text-right text-gray-100">{formatShares(holder.shares)}</td>
                      <td className="py-3 px-4 text-right text-emerald-400">{formatPercent(holder.weightPercentage)}</td>
                      <td className={`py-3 px-4 text-right ${getChangeColor(holder.change)}`}>
                        {holder.change > 0 ? '+' : ''}{formatShares(holder.change)}
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

      {/* Institutional Analytics */}
      {activeView === 'analytics' && (
        <div className="space-y-6">
          {institutionalAnalytics.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No institutional analytics data available</p>
          ) : (
            <>
              <div className="bg-gray-800/50 p-4 rounded-xl">
                <p className="text-gray-400">
                  Detailed analytics for {institutionalAnalytics.length} institutional holders showing performance, holding period, and portfolio changes.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="py-3 px-3 text-gray-400 font-semibold">Investor</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-right">Shares</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-right">Change %</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-right">Ownership %</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-right">Avg Price</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-right">Performance</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-right">Holding (Q)</th>
                      <th className="py-3 px-3 text-gray-400 font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {institutionalAnalytics.map((holder, idx) => (
                      <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800/50">
                        <td className="py-3 px-3 text-gray-200 font-medium max-w-[200px] truncate" title={holder.investorName}>
                          {holder.investorName}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-100">{formatShares(holder.shares)}</td>
                        <td className={`py-3 px-3 text-right ${getChangeColor(holder.changeInSharesPercentage)}`}>
                          {holder.changeInSharesPercentage > 0 ? '+' : ''}{formatPercent(holder.changeInSharesPercentage)}
                        </td>
                        <td className="py-3 px-3 text-right text-green-400">{formatPercent(holder.ownership)}</td>
                        <td className="py-3 px-3 text-right text-gray-300">${holder.avgPricePaid?.toFixed(2) || 'N/A'}</td>
                        <td className={`py-3 px-3 text-right ${getChangeColor(holder.performancePercentage)}`}>
                          {holder.performancePercentage > 0 ? '+' : ''}{formatPercent(holder.performancePercentage)}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-400">{holder.holdingPeriod || 'N/A'}</td>
                        <td className="py-3 px-3 text-center">
                          {holder.isNew && (
                            <span className="px-2 py-1 bg-green-600 text-white text-xs rounded-full">NEW</span>
                          )}
                          {holder.isSoldOut && (
                            <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">SOLD</span>
                          )}
                          {!holder.isNew && !holder.isSoldOut && (
                            <span className="px-2 py-1 bg-gray-600 text-gray-300 text-xs rounded-full">HOLD</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <p className="text-center text-sm text-gray-500">
        Ownership data based on SEC 13F filings. Data may have a 45-day reporting lag from quarter end.
      </p>
    </div>
  );
}
