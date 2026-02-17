// src/app/components/tabs/CAGRTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useLanguage } from '@/i18n/LanguageContext';

interface PriceData {
  date: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}

interface CAGRTabProps {
  ticker: string;
  onCagrStatsChange?: (stats: { avgCagr: number | null; minCagr: number | null; maxCagr: number | null }) => void;
}

export default function CAGRTab({ ticker, onCagrStatsChange }: CAGRTabProps) {
  const { t } = useLanguage();
  // Estados para inputs del usuario
  const [minCagr, setMinCagr] = useState<number>(-50);
  const [maxCagr, setMaxCagr] = useState<number>(100);
  const [yearsToAnalyze, setYearsToAnalyze] = useState<number>(5);

  // Estados para datos
  const [historicalPrices, setHistoricalPrices] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [maxYearsAvailable, setMaxYearsAvailable] = useState<number>(5);

  // Fetch historical prices
  useEffect(() => {
    const fetchPrices = async () => {
      if (!ticker) return;

      try {
        setLoading(true);
        setError(null);

        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) {
          setError(t('common.error'));
          return;
        }

        // Fetch 10 years of data to have flexibility
        const today = new Date();
        const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
        const fromDate = tenYearsAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        // Use full endpoint for OHLC data needed for pivot points
        const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${ticker}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) {
          setError(t('cagrTab.loading'));
          return;
        }

        // Sort from newest to oldest (descending)
        const sorted = json
          .map((item: any) => ({
            date: item.date,
            price: item.price || item.close,
            open: item.open,
            high: item.high,
            low: item.low,
            close: item.close,
          }))
          .sort((a: PriceData, b: PriceData) => new Date(b.date).getTime() - new Date(a.date).getTime());

        setHistoricalPrices(sorted);

        // Calculate max years available
        const firstDate = new Date(sorted[sorted.length - 1].date);
        const lastDate = new Date(sorted[0].date);
        const yearsOfData = (lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        setMaxYearsAvailable(Math.floor(yearsOfData));

      } catch (err: any) {
        setError(err.message || 'Error fetching data');
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, [ticker]);

  // Calculate CAGR for each day in range
  const cagrResults = useMemo(() => {
    if (historicalPrices.length === 0) return [];

    // Trading days per year approximately 252
    const tradingDaysPerYear = 252;
    const lookbackDays = yearsToAnalyze * tradingDaysPerYear;

    const results: { date: string; cagr: number | null; price: number }[] = [];

    for (let i = 0; i < historicalPrices.length; i++) {
      const currentPrice = historicalPrices[i].price;
      const currentDate = historicalPrices[i].date;

      // Look back approximately N years (using trading days)
      // Find the index that's approximately N years ago
      const targetIndex = i + lookbackDays;

      if (targetIndex >= historicalPrices.length) {
        results.push({ date: currentDate, cagr: null, price: currentPrice });
        continue;
      }

      const pastPrice = historicalPrices[targetIndex]?.price;
      if (!pastPrice || pastPrice <= 0) {
        results.push({ date: currentDate, cagr: null, price: currentPrice });
        continue;
      }

      // CAGR formula: (P_current / P_past)^(1/years) - 1
      const cagr = Math.pow(currentPrice / pastPrice, 1 / yearsToAnalyze) - 1;
      const cagrPercent = cagr * 100;

      // Filter by min/max CAGR
      if (cagrPercent >= minCagr && cagrPercent <= maxCagr) {
        results.push({ date: currentDate, cagr: cagrPercent, price: currentPrice });
      } else {
        results.push({ date: currentDate, cagr: null, price: currentPrice });
      }
    }

    return results;
  }, [historicalPrices, yearsToAnalyze, minCagr, maxCagr]);

  // Calculate statistics
  const statistics = useMemo(() => {
    if (historicalPrices.length === 0) return null;

    const prices = historicalPrices.map(p => p.price);
    const lastPrice = prices[0];

    // 52 weeks (252 trading days)
    const week52Prices = prices.slice(0, 252);
    const week52High = Math.max(...week52Prices);
    const week52Low = Math.min(...week52Prices);

    // 104 weeks (504 trading days)
    const week104Prices = prices.slice(0, 504);
    const week104High = week104Prices.length >= 252 ? Math.max(...week104Prices) : null;
    const week104Low = week104Prices.length >= 252 ? Math.min(...week104Prices) : null;

    // Daily returns
    const dailyReturns: number[] = [];
    for (let i = 0; i < prices.length - 1; i++) {
      if (prices[i + 1] > 0) {
        dailyReturns.push((prices[i] - prices[i + 1]) / prices[i + 1]);
      }
    }

    // Average return (daily)
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length
      : 0;

    // Annualized return (252 trading days)
    const annualReturn = avgReturn * 252;

    // Variance (daily)
    const variance = dailyReturns.length > 1
      ? dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length - 1)
      : 0;

    // Annualized variance
    const annualVariance = variance * 252;

    // Standard deviation (daily)
    const stdDev = Math.sqrt(variance);

    // Annualized standard deviation
    const annualStdDev = stdDev * Math.sqrt(252);

    // CAGR statistics from filtered results
    const validCagrs = cagrResults.filter(r => r.cagr !== null).map(r => r.cagr as number);
    const avgCagr = validCagrs.length > 0
      ? validCagrs.reduce((sum, c) => sum + c, 0) / validCagrs.length
      : null;
    const minCagrFound = validCagrs.length > 0 ? Math.min(...validCagrs) : null;
    const maxCagrFound = validCagrs.length > 0 ? Math.max(...validCagrs) : null;

    return {
      lastPrice,
      week52High,
      week52Low,
      week104High,
      week104Low,
      avgReturn: avgReturn * 100,
      annualReturn: annualReturn * 100,
      variance: variance * 10000, // Convert to percentage squared
      annualVariance: annualVariance * 10000,
      stdDev: stdDev * 100,
      annualStdDev: annualStdDev * 100,
      avgCagr,
      minCagrFound,
      maxCagrFound,
      validCagrCount: validCagrs.length,
    };
  }, [historicalPrices, cagrResults]);

  // Notify parent of CAGR stats changes
  useEffect(() => {
    if (onCagrStatsChange && statistics) {
      onCagrStatsChange({
        avgCagr: statistics.avgCagr,
        minCagr: statistics.minCagrFound,
        maxCagr: statistics.maxCagrFound,
      });
    }
  }, [statistics?.avgCagr, statistics?.minCagrFound, statistics?.maxCagrFound]);

  // Prepare chart data
  const chartData = useMemo(() => {
    if (cagrResults.length === 0) return null;

    // Get last 2 years for chart
    const dataToShow = cagrResults.slice(0, 504).reverse();

    return {
      labels: dataToShow.map(d => d.date),
      datasets: [
        {
          label: t('cagrTab.price'),
          data: dataToShow.map(d => d.price),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.1,
          fill: true,
          pointRadius: 0,
          yAxisID: 'y',
        },
        {
          label: `CAGR ${yearsToAnalyze}Y (%)`,
          data: dataToShow.map(d => d.cagr),
          borderColor: 'rgb(34, 197, 94)',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          tension: 0.1,
          pointRadius: 0,
          yAxisID: 'y1',
        },
      ],
    };
  }, [cagrResults, yearsToAnalyze]);

  if (loading) {
    return <p className="text-xl text-gray-400 py-10 text-center">{t('cagrTab.loading')}</p>;
  }

  if (error) {
    return <p className="text-xl text-red-400 py-10 text-center">{t('common.error')}: {error}</p>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-sky-400 bg-clip-text text-transparent">
            {t('cagrTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('cagrTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-indigo-900/40 to-sky-900/40 px-4 py-2 rounded-xl border border-indigo-600">
            <p className="text-xs text-indigo-400">{t('cagrTab.daysOfData')}</p>
            <p className="text-xl font-bold text-indigo-400">{historicalPrices.length.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Input Controls */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-600 shadow-lg">
        <h4 className="text-2xl font-bold text-gray-100 mb-6">{t('cagrTab.parameters')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block text-gray-300 mb-2 font-medium">{t('cagrTab.minCagr')}</label>
            <input
              type="number"
              step="1"
              value={minCagr}
              onChange={(e) => setMinCagr(parseFloat(e.target.value) || -10)}
              className="w-full bg-gray-900/80 border-2 border-red-500/50 rounded-xl px-4 py-3 text-xl font-bold text-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-400/30 focus:outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2 font-medium">{t('cagrTab.maxCagr')}</label>
            <input
              type="number"
              step="1"
              value={maxCagr}
              onChange={(e) => setMaxCagr(parseFloat(e.target.value) || 10)}
              className="w-full bg-gray-900/80 border-2 border-green-500/50 rounded-xl px-4 py-3 text-xl font-bold text-green-400 focus:border-green-400 focus:ring-2 focus:ring-green-400/30 focus:outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2 font-medium">{t('cagrTab.yearsToAnalyze')}</label>
            <input
              type="number"
              step="1"
              min="1"
              max={maxYearsAvailable}
              value={yearsToAnalyze}
              onChange={(e) => setYearsToAnalyze(Math.min(parseInt(e.target.value) || 5, maxYearsAvailable))}
              className="w-full bg-gray-900/80 border-2 border-blue-500/50 rounded-xl px-4 py-3 text-xl font-bold text-blue-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 focus:outline-none transition-all"
            />
            <p className="text-xs text-gray-500 mt-2">
              {maxYearsAvailable} {t('cagrTab.available')}
            </p>
          </div>
          <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-600 flex flex-col justify-center">
            <label className="block text-gray-400 text-sm mb-1">{t('cagrTab.daysOfData')}</label>
            <p className="text-3xl font-bold text-blue-400">
              {historicalPrices.length.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">days</p>
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      {statistics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-gradient-to-br from-green-800/50 to-green-900/50 p-5 rounded-2xl border border-green-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">{t('cagrTab.week52High')}</p>
            <p className="text-3xl font-bold text-green-400">${statistics.week52High?.toFixed(2)}</p>
          </div>
          <div className="bg-gradient-to-br from-red-800/50 to-red-900/50 p-5 rounded-2xl border border-red-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">{t('cagrTab.week52Low')}</p>
            <p className="text-3xl font-bold text-red-400">${statistics.week52Low?.toFixed(2)}</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-800/50 to-emerald-900/50 p-5 rounded-2xl border border-emerald-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">{t('cagrTab.week104High')}</p>
            <p className="text-3xl font-bold text-emerald-400">
              {statistics.week104High ? `$${statistics.week104High.toFixed(2)}` : 'N/A'}
            </p>
          </div>
          <div className="bg-gradient-to-br from-rose-800/50 to-rose-900/50 p-5 rounded-2xl border border-rose-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">{t('cagrTab.week104Low')}</p>
            <p className="text-3xl font-bold text-rose-400">
              {statistics.week104Low ? `$${statistics.week104Low.toFixed(2)}` : 'N/A'}
            </p>
          </div>
          <div className="bg-gradient-to-br from-gray-700 to-gray-800 p-5 rounded-2xl border border-gray-600 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">{t('cagrTab.avgDailyReturn')}</p>
            <p className={`text-2xl font-bold ${statistics.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics.avgReturn.toFixed(4)}%
            </p>
          </div>
          <div className="bg-gradient-to-br from-blue-800/50 to-blue-900/50 p-5 rounded-2xl border border-blue-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">{t('cagrTab.annualReturn')}</p>
            <p className={`text-3xl font-bold ${statistics.annualReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics.annualReturn.toFixed(2)}%
            </p>
          </div>
          <div className="bg-gradient-to-br from-purple-800/50 to-purple-900/50 p-5 rounded-2xl border border-purple-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Daily Variance</p>
            <p className="text-2xl font-bold text-purple-400">{statistics.variance.toFixed(4)}%²</p>
          </div>
          <div className="bg-gradient-to-br from-violet-800/50 to-violet-900/50 p-5 rounded-2xl border border-violet-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Annual Variance</p>
            <p className="text-2xl font-bold text-violet-400">{statistics.annualVariance.toFixed(2)}%²</p>
          </div>
          <div className="bg-gradient-to-br from-orange-800/50 to-orange-900/50 p-5 rounded-2xl border border-orange-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Daily Std Dev</p>
            <p className="text-2xl font-bold text-orange-400">{statistics.stdDev.toFixed(4)}%</p>
          </div>
          <div className="bg-gradient-to-br from-amber-800/50 to-amber-900/50 p-5 rounded-2xl border border-amber-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Annual Std Dev</p>
            <p className="text-2xl font-bold text-amber-400">{statistics.annualStdDev.toFixed(2)}%</p>
          </div>
          <div className="bg-gradient-to-br from-cyan-800/50 to-cyan-900/50 p-5 rounded-2xl border border-cyan-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">CAGR {yearsToAnalyze}Y (Avg)</p>
            <p className={`text-3xl font-bold ${(statistics.avgCagr || 0) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
              {statistics.avgCagr !== null ? `${statistics.avgCagr.toFixed(2)}%` : 'N/A'}
            </p>
          </div>
          <div className="bg-gradient-to-br from-indigo-800/50 to-indigo-900/50 p-5 rounded-2xl border border-indigo-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Valid CAGR Periods</p>
            <p className="text-3xl font-bold text-indigo-400">{statistics.validCagrCount}</p>
          </div>
        </div>
      )}

      {/* CAGR Range Analysis */}
      {statistics && (
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 p-8 rounded-2xl border border-blue-500 shadow-xl">
          <h4 className="text-2xl font-bold text-blue-400 mb-6 text-center">{t('cagrTab.title')} ({yearsToAnalyze}Y)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-gray-800/50 p-6 rounded-xl text-center border border-red-700/50">
              <p className="text-gray-300 mb-3 font-medium">{t('cagrTab.cagrMin')}</p>
              <p className={`text-5xl font-black ${(statistics.minCagrFound || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.minCagrFound !== null ? `${statistics.minCagrFound.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center border border-blue-600/50">
              <p className="text-gray-300 mb-3 font-medium">{t('cagrTab.avgCagr')}</p>
              <p className={`text-5xl font-black ${(statistics.avgCagr || 0) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                {statistics.avgCagr !== null ? `${statistics.avgCagr.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center border border-green-700/50">
              <p className="text-gray-300 mb-3 font-medium">{t('cagrTab.cagrMax')}</p>
              <p className={`text-5xl font-black ${(statistics.maxCagrFound || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.maxCagrFound !== null ? `${statistics.maxCagrFound.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-400 mt-6 text-center">
            {minCagr}% - {maxCagr}% • {statistics.validCagrCount} {t('cagrTab.validDays')}
          </p>
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-700 shadow-xl">
          <h4 className="text-2xl font-bold text-gray-100 mb-6">{t('cagrTab.chartTitle')}</h4>
          <div className="h-[500px]">
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                  mode: 'index',
                  intersect: false,
                },
                scales: {
                  y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                      display: true,
                      text: 'Precio ($)',
                      color: '#60a5fa',
                      font: { size: 14, weight: 'bold' },
                    },
                    ticks: {
                      color: '#60a5fa',
                      callback: (value: any) => '$' + value.toFixed(0),
                    },
                    grid: { color: '#374151' },
                    // Let Chart.js auto-calculate min/max based on data
                  },
                  y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                      display: true,
                      text: 'CAGR (%)',
                      color: '#22c55e',
                      font: { size: 14, weight: 'bold' },
                    },
                    ticks: {
                      color: '#22c55e',
                      callback: (value: any) => value.toFixed(1) + '%',
                    },
                    grid: { drawOnChartArea: false },
                    // Explicitly set min/max based on CAGR filter range
                    min: minCagr - 5,
                    max: maxCagr + 5,
                  },
                  x: {
                    ticks: {
                      color: '#9ca3af',
                      maxTicksLimit: 12,
                      font: { size: 11 },
                    },
                    grid: { color: '#374151', lineWidth: 0.5 },
                  },
                },
                plugins: {
                  legend: {
                    labels: {
                      color: '#e5e7eb',
                      font: { size: 13 },
                      usePointStyle: true,
                      padding: 20,
                    },
                    position: 'top',
                  },
                  tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#f3f4f6',
                    bodyColor: '#d1d5db',
                    borderColor: '#4b5563',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                      label: (context: any) => {
                        const label = context.dataset.label || '';
                        const value = context.parsed.y;
                        if (label.includes('CAGR')) {
                          return value !== null ? `${label}: ${value.toFixed(2)}%` : `${label}: N/A`;
                        }
                        return `${label}: $${value.toFixed(2)}`;
                      },
                    },
                  },
                },
              }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">
            {t('cagrTab.price')} • CAGR {yearsToAnalyze}Y
          </p>
        </div>
      )}

      <p className="text-sm text-gray-500 text-center">
        {t('cagrTab.footerExplanation')}
      </p>
    </div>
  );
}
