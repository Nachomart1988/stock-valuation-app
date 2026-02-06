// src/app/components/tabs/CAGRTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';

interface PriceData {
  date: string;
  price: number;
}

interface PivotPoint {
  price: number;
  count: number;
  dates: string[];
}

interface CAGRTabProps {
  ticker: string;
}

export default function CAGRTab({ ticker }: CAGRTabProps) {
  // Estados para inputs del usuario
  const [minCagr, setMinCagr] = useState<number>(-10);
  const [maxCagr, setMaxCagr] = useState<number>(10);
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
          setError('API key not configured');
          return;
        }

        // Fetch 10 years of data to have flexibility
        const today = new Date();
        const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
        const fromDate = tenYearsAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${ticker}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) {
          setError('No historical data available');
          return;
        }

        // Sort from newest to oldest (descending)
        const sorted = json
          .map((item: any) => ({
            date: item.date,
            price: item.price || item.close,
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

  // Calculate pivot points (price levels where price has bounced multiple times)
  const pivotPoints = useMemo(() => {
    if (historicalPrices.length === 0) return [];

    // Use last 2 years (504 trading days)
    const prices2Years = historicalPrices.slice(0, 504);
    if (prices2Years.length < 100) return [];

    // Find local minima and maxima
    const pivots: PivotPoint[] = [];
    const tolerance = 0.02; // 2% tolerance for price levels

    // Group prices by levels
    const priceLevels: Map<number, { count: number; dates: string[] }> = new Map();

    for (let i = 2; i < prices2Years.length - 2; i++) {
      const prev2 = prices2Years[i + 2].price;
      const prev1 = prices2Years[i + 1].price;
      const curr = prices2Years[i].price;
      const next1 = prices2Years[i - 1].price;
      const next2 = prices2Years[i - 2].price;

      // Check if it's a local minimum (support)
      const isSupport = curr < prev1 && curr < prev2 && curr < next1 && curr < next2;

      // Check if it's a local maximum (resistance)
      const isResistance = curr > prev1 && curr > prev2 && curr > next1 && curr > next2;

      if (isSupport || isResistance) {
        // Round to nearest level
        const roundedPrice = Math.round(curr * 100) / 100;

        // Find existing level within tolerance
        let foundLevel = false;
        for (const [level, data] of priceLevels) {
          if (Math.abs(level - roundedPrice) / level <= tolerance) {
            data.count++;
            data.dates.push(prices2Years[i].date);
            foundLevel = true;
            break;
          }
        }

        if (!foundLevel) {
          priceLevels.set(roundedPrice, {
            count: 1,
            dates: [prices2Years[i].date],
          });
        }
      }
    }

    // Filter levels with multiple touches
    for (const [price, data] of priceLevels) {
      if (data.count >= 2) {
        pivots.push({
          price,
          count: data.count,
          dates: data.dates,
        });
      }
    }

    // Sort by count descending
    return pivots.sort((a, b) => b.count - a.count).slice(0, 10);
  }, [historicalPrices]);

  // Prepare chart data
  const chartData = useMemo(() => {
    if (cagrResults.length === 0) return null;

    // Get last 2 years for chart
    const dataToShow = cagrResults.slice(0, 504).reverse();

    return {
      labels: dataToShow.map(d => d.date),
      datasets: [
        {
          label: 'Precio',
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
    return <p className="text-xl text-gray-400 py-10 text-center">Cargando datos históricos...</p>;
  }

  if (error) {
    return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;
  }

  return (
    <div className="space-y-8">
      <h3 className="text-3xl font-bold text-gray-100">
        CAGR Analysis - {ticker}
      </h3>

      {/* Input Controls */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-600 shadow-lg">
        <h4 className="text-2xl font-bold text-gray-100 mb-6">Parámetros de Análisis</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block text-gray-300 mb-2 font-medium">Min CAGR (%)</label>
            <input
              type="number"
              step="1"
              value={minCagr}
              onChange={(e) => setMinCagr(parseFloat(e.target.value) || -10)}
              className="w-full bg-gray-900/80 border-2 border-red-500/50 rounded-xl px-4 py-3 text-xl font-bold text-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-400/30 focus:outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2 font-medium">Max CAGR (%)</label>
            <input
              type="number"
              step="1"
              value={maxCagr}
              onChange={(e) => setMaxCagr(parseFloat(e.target.value) || 10)}
              className="w-full bg-gray-900/80 border-2 border-green-500/50 rounded-xl px-4 py-3 text-xl font-bold text-green-400 focus:border-green-400 focus:ring-2 focus:ring-green-400/30 focus:outline-none transition-all"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2 font-medium">Años a Analizar</label>
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
              Max disponible: {maxYearsAvailable} años
            </p>
          </div>
          <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-600 flex flex-col justify-center">
            <label className="block text-gray-400 text-sm mb-1">Datos disponibles</label>
            <p className="text-3xl font-bold text-blue-400">
              {historicalPrices.length.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">días de trading</p>
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      {statistics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-gradient-to-br from-green-800/50 to-green-900/50 p-5 rounded-2xl border border-green-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">52 Week High</p>
            <p className="text-3xl font-bold text-green-400">${statistics.week52High?.toFixed(2)}</p>
          </div>
          <div className="bg-gradient-to-br from-red-800/50 to-red-900/50 p-5 rounded-2xl border border-red-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">52 Week Low</p>
            <p className="text-3xl font-bold text-red-400">${statistics.week52Low?.toFixed(2)}</p>
          </div>
          <div className="bg-gradient-to-br from-emerald-800/50 to-emerald-900/50 p-5 rounded-2xl border border-emerald-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">104 Week High</p>
            <p className="text-3xl font-bold text-emerald-400">
              {statistics.week104High ? `$${statistics.week104High.toFixed(2)}` : 'N/A'}
            </p>
          </div>
          <div className="bg-gradient-to-br from-rose-800/50 to-rose-900/50 p-5 rounded-2xl border border-rose-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">104 Week Low</p>
            <p className="text-3xl font-bold text-rose-400">
              {statistics.week104Low ? `$${statistics.week104Low.toFixed(2)}` : 'N/A'}
            </p>
          </div>
          <div className="bg-gradient-to-br from-gray-700 to-gray-800 p-5 rounded-2xl border border-gray-600 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Avg Daily Return</p>
            <p className={`text-2xl font-bold ${statistics.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics.avgReturn.toFixed(4)}%
            </p>
          </div>
          <div className="bg-gradient-to-br from-blue-800/50 to-blue-900/50 p-5 rounded-2xl border border-blue-700 text-center flex flex-col justify-center min-h-[120px]">
            <p className="text-sm text-gray-300 mb-2">Annual Return</p>
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
          <h4 className="text-2xl font-bold text-blue-400 mb-6 text-center">CAGR Range Analysis ({yearsToAnalyze} años)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-gray-800/50 p-6 rounded-xl text-center border border-red-700/50">
              <p className="text-gray-300 mb-3 font-medium">Min CAGR Encontrado</p>
              <p className={`text-5xl font-black ${(statistics.minCagrFound || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.minCagrFound !== null ? `${statistics.minCagrFound.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center border border-blue-600/50">
              <p className="text-gray-300 mb-3 font-medium">Promedio CAGR</p>
              <p className={`text-5xl font-black ${(statistics.avgCagr || 0) >= 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                {statistics.avgCagr !== null ? `${statistics.avgCagr.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-center border border-green-700/50">
              <p className="text-gray-300 mb-3 font-medium">Max CAGR Encontrado</p>
              <p className={`text-5xl font-black ${(statistics.maxCagrFound || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.maxCagrFound !== null ? `${statistics.maxCagrFound.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-400 mt-6 text-center">
            Filtrado: CAGR entre <span className="text-red-400 font-semibold">{minCagr}%</span> y <span className="text-green-400 font-semibold">{maxCagr}%</span> • <span className="text-blue-400 font-semibold">{statistics.validCagrCount}</span> períodos válidos encontrados
          </p>
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-700 shadow-xl">
          <h4 className="text-2xl font-bold text-gray-100 mb-6">Precio y CAGR (últimos 2 años)</h4>
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
            Eje izquierdo (azul): Precio • Eje derecho (verde): CAGR {yearsToAnalyze}Y
          </p>
        </div>
      )}

      {/* Pivot Points */}
      {pivotPoints.length > 0 && (
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h4 className="text-xl font-bold text-gray-100 mb-4">Pivot Points Estimados (últimos 2 años)</h4>
          <p className="text-sm text-gray-400 mb-4">
            Niveles de precio donde el precio ha rebotado múltiples veces (soporte/resistencia)
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {pivotPoints.map((pivot, i) => {
              const currentPrice = statistics?.lastPrice || 0;
              const isSupport = pivot.price < currentPrice;
              return (
                <div
                  key={i}
                  className={`p-4 rounded-xl border text-center ${
                    isSupport
                      ? 'bg-green-900/30 border-green-700'
                      : 'bg-red-900/30 border-red-700'
                  }`}
                >
                  <p className="text-sm text-gray-400 mb-1">
                    {isSupport ? 'Soporte' : 'Resistencia'}
                  </p>
                  <p className={`text-2xl font-bold ${isSupport ? 'text-green-400' : 'text-red-400'}`}>
                    ${pivot.price.toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {pivot.count} toques
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-4 text-center">
            Los pivot points son niveles de precio históricos donde el precio ha mostrado reversión.
            Tolerancia: 2% para agrupar niveles similares.
          </p>
        </div>
      )}

      <p className="text-sm text-gray-500 text-center">
        Fórmula CAGR: (Precio_actual / Precio_hace_{yearsToAnalyze}_años)^(1/{yearsToAnalyze}) - 1 •
        Sólo se muestran períodos con CAGR entre {minCagr}% y {maxCagr}%
      </p>
    </div>
  );
}
