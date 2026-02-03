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
      <div className="bg-gray-700 p-6 rounded-xl border border-gray-600">
        <h4 className="text-xl font-bold text-gray-100 mb-4">Parámetros de Análisis</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block text-gray-300 mb-2">Min CAGR (%)</label>
            <input
              type="number"
              step="1"
              value={minCagr}
              onChange={(e) => setMinCagr(parseFloat(e.target.value) || -10)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2">Max CAGR (%)</label>
            <input
              type="number"
              step="1"
              value={maxCagr}
              onChange={(e) => setMaxCagr(parseFloat(e.target.value) || 10)}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-2">Años a Analizar</label>
            <input
              type="number"
              step="1"
              min="1"
              max={maxYearsAvailable}
              value={yearsToAnalyze}
              onChange={(e) => setYearsToAnalyze(Math.min(parseInt(e.target.value) || 5, maxYearsAvailable))}
              className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
            />
            <p className="text-xs text-gray-500 mt-1">
              Max disponible: {maxYearsAvailable} años
            </p>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">Datos disponibles</label>
            <p className="text-2xl font-bold text-blue-400 pt-2">
              {historicalPrices.length.toLocaleString()} días
            </p>
          </div>
        </div>
      </div>

      {/* Statistics Grid */}
      {statistics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">52 Week High</p>
            <p className="text-xl font-bold text-green-400">${statistics.week52High?.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">52 Week Low</p>
            <p className="text-xl font-bold text-red-400">${statistics.week52Low?.toFixed(2)}</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">104 Week High</p>
            <p className="text-xl font-bold text-green-400">
              {statistics.week104High ? `$${statistics.week104High.toFixed(2)}` : 'N/A'}
            </p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">104 Week Low</p>
            <p className="text-xl font-bold text-red-400">
              {statistics.week104Low ? `$${statistics.week104Low.toFixed(2)}` : 'N/A'}
            </p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Avg Daily Return</p>
            <p className={`text-xl font-bold ${statistics.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics.avgReturn.toFixed(4)}%
            </p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Annual Return</p>
            <p className={`text-xl font-bold ${statistics.annualReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics.annualReturn.toFixed(2)}%
            </p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Daily Variance</p>
            <p className="text-xl font-bold text-purple-400">{statistics.variance.toFixed(4)}%²</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Annual Variance</p>
            <p className="text-xl font-bold text-purple-400">{statistics.annualVariance.toFixed(2)}%²</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Daily Std Dev</p>
            <p className="text-xl font-bold text-orange-400">{statistics.stdDev.toFixed(4)}%</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Annual Std Dev</p>
            <p className="text-xl font-bold text-orange-400">{statistics.annualStdDev.toFixed(2)}%</p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">CAGR {yearsToAnalyze}Y (Avg)</p>
            <p className={`text-xl font-bold ${(statistics.avgCagr || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {statistics.avgCagr !== null ? `${statistics.avgCagr.toFixed(2)}%` : 'N/A'}
            </p>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 text-center">
            <p className="text-sm text-gray-400 mb-1">Valid CAGR Periods</p>
            <p className="text-xl font-bold text-blue-400">{statistics.validCagrCount}</p>
          </div>
        </div>
      )}

      {/* CAGR Range Analysis */}
      {statistics && (
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h4 className="text-xl font-bold text-gray-100 mb-4">CAGR Range ({yearsToAnalyze} años)</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <p className="text-gray-400 mb-2">Min CAGR Encontrado</p>
              <p className={`text-3xl font-bold ${(statistics.minCagrFound || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.minCagrFound !== null ? `${statistics.minCagrFound.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 mb-2">Promedio CAGR</p>
              <p className={`text-3xl font-bold ${(statistics.avgCagr || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.avgCagr !== null ? `${statistics.avgCagr.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 mb-2">Max CAGR Encontrado</p>
              <p className={`text-3xl font-bold ${(statistics.maxCagrFound || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {statistics.maxCagrFound !== null ? `${statistics.maxCagrFound.toFixed(2)}%` : 'N/A'}
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">
            Filtrado: CAGR entre {minCagr}% y {maxCagr}% • {statistics.validCagrCount} períodos válidos encontrados
          </p>
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <h4 className="text-xl font-bold text-gray-100 mb-4">Precio y CAGR (últimos 2 años)</h4>
          <div className="h-96">
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
                      color: '#9ca3af',
                    },
                    ticks: { color: '#9ca3af' },
                    grid: { color: '#374151' },
                  },
                  y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                      display: true,
                      text: 'CAGR (%)',
                      color: '#9ca3af',
                    },
                    ticks: { color: '#9ca3af' },
                    grid: { drawOnChartArea: false },
                  },
                  x: {
                    ticks: {
                      color: '#9ca3af',
                      maxTicksLimit: 12,
                    },
                    grid: { color: '#374151' },
                  },
                },
                plugins: {
                  legend: {
                    labels: { color: '#e5e7eb' },
                  },
                },
              }}
            />
          </div>
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
