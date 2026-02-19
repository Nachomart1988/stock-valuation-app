// src/app/components/tabs/PivotsTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin
);

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PivotLevel {
  name: string;
  value: number;
  type: 'support' | 'resistance' | 'pivot';
}

interface HistoricalPivot {
  price: number;
  count: number;
  dates: string[];
  strength: number; // 1-5 based on touches
  type: 'support' | 'resistance';
}

interface FibonacciLevel {
  level: string;
  price: number;
  percentage: number;
}

interface CamarillaPivots {
  H4: number;
  H3: number;
  H2: number;
  H1: number;
  L1: number;
  L2: number;
  L3: number;
  L4: number;
}

interface WoodiePivots {
  PP: number;
  R1: number;
  R2: number;
  S1: number;
  S2: number;
}

interface DeMarkPivots {
  PP: number;
  R1: number;
  S1: number;
}

interface PivotsTabProps {
  ticker: string;
}

export default function PivotsTab({ ticker }: PivotsTabProps) {
  const { t } = useLanguage();
  // Estado para datos de precios
  const [priceData, setPriceData] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);

  // Configuración de usuario
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [lookbackPeriods, setLookbackPeriods] = useState<number>(252); // 1 year default
  const [lookbackInput, setLookbackInput] = useState<string>('252');
  const [pivotMethod, setPivotMethod] = useState<'standard' | 'fibonacci' | 'camarilla' | 'woodie' | 'demark'>('standard');
  const [showHistoricalLevels, setShowHistoricalLevels] = useState(true);
  const [volumeWeighted, setVolumeWeighted] = useState(false);
  const [tolerancePercent, setTolerancePercent] = useState<number>(1.5);
  const [toleranceInput, setToleranceInput] = useState<string>('1.5');

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

        // Fetch 3 years of data
        const today = new Date();
        const threeYearsAgo = new Date(today.getFullYear() - 3, today.getMonth(), today.getDate());
        const fromDate = threeYearsAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${ticker}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const json = await res.json();
        if (!Array.isArray(json) || json.length === 0) {
          setError('No historical data available');
          return;
        }

        // Sort from newest to oldest (descending)
        const sorted: PriceData[] = json
          .map((item: any) => ({
            date: item.date,
            open: item.open || item.price,
            high: item.high || item.price,
            low: item.low || item.price,
            close: item.close || item.price,
            volume: item.volume || 0,
          }))
          .sort((a: PriceData, b: PriceData) => new Date(b.date).getTime() - new Date(a.date).getTime());

        setPriceData(sorted);
        setCurrentPrice(sorted[0]?.close || 0);

      } catch (err: any) {
        setError(err.message || 'Error fetching data');
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, [ticker]);

  // Convert to weekly/monthly if needed
  const aggregatedData = useMemo(() => {
    if (priceData.length === 0) return [];

    if (timeframe === 'daily') {
      return priceData.slice(0, lookbackPeriods);
    }

    const grouped: Map<string, PriceData[]> = new Map();

    priceData.forEach(d => {
      const date = new Date(d.date);
      let key: string;

      if (timeframe === 'weekly') {
        // Get week number
        const startOfYear = new Date(date.getFullYear(), 0, 1);
        const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
        const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
        key = `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
      } else {
        // Monthly
        key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      }

      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(d);
    });

    // Aggregate each group
    const result: PriceData[] = [];
    grouped.forEach((items, key) => {
      if (items.length === 0) return;
      result.push({
        date: key,
        open: items[items.length - 1].open, // First day's open
        high: Math.max(...items.map(i => i.high)),
        low: Math.min(...items.map(i => i.low)),
        close: items[0].close, // Last day's close
        volume: items.reduce((sum, i) => sum + i.volume, 0),
      });
    });

    // Sort descending
    result.sort((a, b) => b.date.localeCompare(a.date));

    const periodsToReturn = timeframe === 'weekly' ? Math.ceil(lookbackPeriods / 5) : Math.ceil(lookbackPeriods / 21);
    return result.slice(0, periodsToReturn);
  }, [priceData, timeframe, lookbackPeriods]);

  // Build pivot base bar from the PREVIOUS completed period only (standard pivot point methodology)
  // Pivot PP = (H + L + C) / 3 uses the single prior period's OHLC — NOT the aggregate of all periods
  const pivotBaseBar = useMemo(() => {
    if (aggregatedData.length < 2) return null;
    const prev = aggregatedData[1]; // index 0 = current in-progress period, index 1 = last completed
    return {
      high: prev.high,
      low: prev.low,
      close: prev.close,
      open: prev.open,
    };
  }, [aggregatedData]);

  // Calculate Standard Pivot Points (Classic)
  const standardPivots = useMemo((): PivotLevel[] | null => {
    if (!pivotBaseBar) return null;

    const { high, low, close } = pivotBaseBar;

    const PP = (high + low + close) / 3;
    const R1 = 2 * PP - low;
    const S1 = 2 * PP - high;
    const R2 = PP + (high - low);
    const S2 = PP - (high - low);
    const R3 = high + 2 * (PP - low);
    const S3 = low - 2 * (high - PP);
    const R4 = R3 + (high - low);
    const S4 = S3 - (high - low);

    return [
      { name: 'R4', value: R4, type: 'resistance' },
      { name: 'R3', value: R3, type: 'resistance' },
      { name: 'R2', value: R2, type: 'resistance' },
      { name: 'R1', value: R1, type: 'resistance' },
      { name: 'PP', value: PP, type: 'pivot' },
      { name: 'S1', value: S1, type: 'support' },
      { name: 'S2', value: S2, type: 'support' },
      { name: 'S3', value: S3, type: 'support' },
      { name: 'S4', value: S4, type: 'support' },
    ];
  }, [aggregatedData]);

  // Calculate Fibonacci Pivot Points
  const fibonacciPivots = useMemo((): PivotLevel[] | null => {
    if (!pivotBaseBar) return null;

    const { high, low, close } = pivotBaseBar;

    const PP = (high + low + close) / 3;
    const range = high - low;

    return [
      { name: 'R3 (100%)', value: PP + range, type: 'resistance' },
      { name: 'R2 (61.8%)', value: PP + range * 0.618, type: 'resistance' },
      { name: 'R1 (38.2%)', value: PP + range * 0.382, type: 'resistance' },
      { name: 'PP', value: PP, type: 'pivot' },
      { name: 'S1 (38.2%)', value: PP - range * 0.382, type: 'support' },
      { name: 'S2 (61.8%)', value: PP - range * 0.618, type: 'support' },
      { name: 'S3 (100%)', value: PP - range, type: 'support' },
    ];
  }, [aggregatedData]);

  // Calculate Camarilla Pivot Points
  const camarillaPivots = useMemo((): PivotLevel[] | null => {
    if (!pivotBaseBar) return null;

    const { high, low, close } = pivotBaseBar;
    const range = high - low;

    // Camarilla formula
    const H4 = close + range * 1.1 / 2;
    const H3 = close + range * 1.1 / 4;
    const H2 = close + range * 1.1 / 6;
    const H1 = close + range * 1.1 / 12;
    const L1 = close - range * 1.1 / 12;
    const L2 = close - range * 1.1 / 6;
    const L3 = close - range * 1.1 / 4;
    const L4 = close - range * 1.1 / 2;

    return [
      { name: 'H4 (Breakout)', value: H4, type: 'resistance' },
      { name: 'H3 (Sell)', value: H3, type: 'resistance' },
      { name: 'H2', value: H2, type: 'resistance' },
      { name: 'H1', value: H1, type: 'resistance' },
      { name: 'L1', value: L1, type: 'support' },
      { name: 'L2', value: L2, type: 'support' },
      { name: 'L3 (Buy)', value: L3, type: 'support' },
      { name: 'L4 (Breakout)', value: L4, type: 'support' },
    ];
  }, [aggregatedData]);

  // Calculate Woodie Pivot Points
  const woodiePivots = useMemo((): PivotLevel[] | null => {
    if (!pivotBaseBar || aggregatedData.length < 1) return null;

    const { high, low } = pivotBaseBar;
    const openToday = aggregatedData[0]?.open || pivotBaseBar.close;

    // Woodie uses today's open, giving more weight to current trading
    const PP = (high + low + 2 * openToday) / 4;
    const R1 = 2 * PP - low;
    const R2 = PP + high - low;
    const R3 = high + 2 * (PP - low);
    const S1 = 2 * PP - high;
    const S2 = PP - high + low;
    const S3 = low - 2 * (high - PP);

    return [
      { name: 'R3', value: R3, type: 'resistance' },
      { name: 'R2', value: R2, type: 'resistance' },
      { name: 'R1', value: R1, type: 'resistance' },
      { name: 'PP', value: PP, type: 'pivot' },
      { name: 'S1', value: S1, type: 'support' },
      { name: 'S2', value: S2, type: 'support' },
      { name: 'S3', value: S3, type: 'support' },
    ];
  }, [aggregatedData]);

  // Calculate DeMark Pivot Points
  const demarkPivots = useMemo((): PivotLevel[] | null => {
    if (!pivotBaseBar) return null;

    const { high, low, close, open } = pivotBaseBar;

    let X: number;
    if (close < open) {
      X = high + 2 * low + close;
    } else if (close > open) {
      X = 2 * high + low + close;
    } else {
      X = high + low + 2 * close;
    }

    const PP = X / 4;
    const R1 = X / 2 - low;
    const S1 = X / 2 - high;

    return [
      { name: 'R1', value: R1, type: 'resistance' },
      { name: 'PP', value: PP, type: 'pivot' },
      { name: 'S1', value: S1, type: 'support' },
    ];
  }, [aggregatedData]);

  // Get current pivot method
  const currentPivots = useMemo(() => {
    switch (pivotMethod) {
      case 'fibonacci': return fibonacciPivots;
      case 'camarilla': return camarillaPivots;
      case 'woodie': return woodiePivots;
      case 'demark': return demarkPivots;
      default: return standardPivots;
    }
  }, [pivotMethod, standardPivots, fibonacciPivots, camarillaPivots, woodiePivots, demarkPivots]);

  // Calculate Historical Pivot Points (price levels with multiple touches)
  const historicalPivots = useMemo((): HistoricalPivot[] => {
    if (aggregatedData.length < 20) return [];

    const tolerance = tolerancePercent / 100;
    const pivots: HistoricalPivot[] = [];
    const priceLevels: Map<number, { count: number; dates: string[]; volumes: number[] }> = new Map();

    // Find local minima and maxima
    for (let i = 2; i < aggregatedData.length - 2; i++) {
      const prev2 = aggregatedData[i + 2];
      const prev1 = aggregatedData[i + 1];
      const curr = aggregatedData[i];
      const next1 = aggregatedData[i - 1];
      const next2 = aggregatedData[i - 2];

      // Check for local minimum (support)
      if (curr.low < prev1.low && curr.low < prev2.low && curr.low < next1.low && curr.low < next2.low) {
        const price = curr.low;
        addToLevel(price, curr.date, curr.volume, priceLevels, tolerance);
      }

      // Check for local maximum (resistance)
      if (curr.high > prev1.high && curr.high > prev2.high && curr.high > next1.high && curr.high > next2.high) {
        const price = curr.high;
        addToLevel(price, curr.date, curr.volume, priceLevels, tolerance);
      }
    }

    // Convert to HistoricalPivot array
    priceLevels.forEach((data, price) => {
      if (data.count >= 2) {
        const avgVolume = data.volumes.reduce((a, b) => a + b, 0) / data.volumes.length;
        const maxVolume = Math.max(...aggregatedData.map(d => d.volume));
        const volumeStrength = maxVolume > 0 ? avgVolume / maxVolume : 0;

        // Strength based on count and volume
        let strength = Math.min(5, Math.ceil(data.count / 2));
        if (volumeWeighted && volumeStrength > 0.5) strength = Math.min(5, strength + 1);

        pivots.push({
          price,
          count: data.count,
          dates: data.dates,
          strength,
          type: price < currentPrice ? 'support' : 'resistance',
        });
      }
    });

    // Sort by count descending
    return pivots.sort((a, b) => b.count - a.count).slice(0, 15);
  }, [aggregatedData, tolerancePercent, currentPrice, volumeWeighted]);

  // Helper function to add price to level
  function addToLevel(
    price: number,
    date: string,
    volume: number,
    levels: Map<number, { count: number; dates: string[]; volumes: number[] }>,
    tolerance: number
  ) {
    // Find existing level within tolerance
    for (const [level, data] of levels) {
      if (Math.abs(level - price) / level <= tolerance) {
        data.count++;
        data.dates.push(date);
        data.volumes.push(volume);
        return;
      }
    }
    // Create new level
    levels.set(price, { count: 1, dates: [date], volumes: [volume] });
  }

  // Calculate Fibonacci Retracement Levels
  const fibonacciLevels = useMemo((): FibonacciLevel[] => {
    if (aggregatedData.length === 0) return [];

    // Find swing high and swing low in the lookback period
    const highs = aggregatedData.map(d => d.high);
    const lows = aggregatedData.map(d => d.low);

    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);
    const range = swingHigh - swingLow;

    const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

    return fibLevels.map(level => ({
      level: level === 0 ? '0%' : level === 1 ? '100%' : `${(level * 100).toFixed(1)}%`,
      price: swingHigh - range * level,
      percentage: level,
    }));
  }, [aggregatedData]);

  // Calculate distance from current price to each level
  const calculateDistance = (price: number) => {
    if (!currentPrice || currentPrice === 0) return 0;
    return ((price - currentPrice) / currentPrice) * 100;
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (aggregatedData.length === 0 || !currentPivots) return null;

    const dataToShow = aggregatedData.slice(0, 60).reverse();
    const labels = dataToShow.map(d => d.date);

    const annotations: any = {};

    // Add pivot level lines
    currentPivots.forEach((pivot, i) => {
      annotations[`line${i}`] = {
        type: 'line',
        yMin: pivot.value,
        yMax: pivot.value,
        borderColor: pivot.type === 'support' ? 'rgba(34, 197, 94, 0.7)' :
                     pivot.type === 'resistance' ? 'rgba(239, 68, 68, 0.7)' :
                     'rgba(59, 130, 246, 0.9)',
        borderWidth: pivot.name === 'PP' ? 3 : 2,
        borderDash: pivot.name === 'PP' ? [] : [5, 5],
        label: {
          display: true,
          content: `${pivot.name}: $${pivot.value.toFixed(2)}`,
          position: 'start',
          backgroundColor: 'rgba(0,0,0,0.7)',
          color: pivot.type === 'support' ? '#22c55e' : pivot.type === 'resistance' ? '#ef4444' : '#3b82f6',
          font: { size: 10 },
        },
      };
    });

    // Add current price line
    annotations['currentPrice'] = {
      type: 'line',
      yMin: currentPrice,
      yMax: currentPrice,
      borderColor: 'rgba(251, 191, 36, 0.9)',
      borderWidth: 2,
      label: {
        display: true,
        content: `Current: $${currentPrice.toFixed(2)}`,
        position: 'end',
        backgroundColor: 'rgba(251, 191, 36, 0.9)',
        color: '#000',
        font: { size: 11, weight: 'bold' },
      },
    };

    return {
      labels,
      datasets: [
        {
          label: 'Price',
          data: dataToShow.map(d => d.close),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.1,
          fill: true,
          pointRadius: 1,
        },
      ],
      annotations,
    };
  }, [aggregatedData, currentPivots, currentPrice]);

  // Volume Profile Data
  const volumeProfile = useMemo(() => {
    if (aggregatedData.length === 0) return null;

    const priceMin = Math.min(...aggregatedData.map(d => d.low));
    const priceMax = Math.max(...aggregatedData.map(d => d.high));
    const range = priceMax - priceMin;
    const bucketSize = range / 20; // 20 buckets

    const buckets: { priceLevel: number; volume: number }[] = [];

    for (let i = 0; i < 20; i++) {
      const bucketLow = priceMin + i * bucketSize;
      const bucketHigh = bucketLow + bucketSize;

      let totalVolume = 0;
      aggregatedData.forEach(d => {
        // Distribute volume based on how much of the candle is in this bucket
        if (d.high >= bucketLow && d.low <= bucketHigh) {
          const overlap = Math.min(d.high, bucketHigh) - Math.max(d.low, bucketLow);
          const candleRange = d.high - d.low || 1;
          totalVolume += d.volume * (overlap / candleRange);
        }
      });

      buckets.push({
        priceLevel: (bucketLow + bucketHigh) / 2,
        volume: totalVolume,
      });
    }

    return buckets;
  }, [aggregatedData]);

  // Find Point of Control (POC) - price level with highest volume
  const pocLevel = useMemo(() => {
    if (!volumeProfile) return null;
    return volumeProfile.reduce((max, bucket) => bucket.volume > max.volume ? bucket : max, volumeProfile[0]);
  }, [volumeProfile]);

  if (loading) {
    return <p className="text-xl text-gray-400 py-10 text-center">{t('pivotsTab.loading')}</p>;
  }

  if (error) {
    return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-400 bg-clip-text text-transparent">
            {t('pivotsTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('pivotsTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-yellow-900/40 to-amber-900/40 px-4 py-2 rounded-xl border border-yellow-600">
            <p className="text-xs text-yellow-400">{t('pivotsTab.currentPrice')}</p>
            <p className="text-xl font-bold text-yellow-400">${currentPrice.toFixed(2)}</p>
          </div>
          {standardPivots && standardPivots.length > 0 && (
            <div className="text-right bg-gradient-to-r bg-gray-900 px-4 py-2 rounded-xl border border-emerald-600">
              <p className="text-xs text-emerald-400">{t('pivotsTab.pivotPoint')}</p>
              <p className="text-xl font-bold text-emerald-400">
                ${standardPivots.find(p => p.name === 'PP')?.value.toFixed(2) || '—'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="bg-gray-950 p-6 rounded-2xl border border-emerald-600">
        <h4 className="text-xl font-bold text-emerald-300 mb-4">{t('pivotsTab.configuration')}</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm text-gray-300 mb-2">{t('pivotsTab.pivotMethod')}</label>
            <select
              value={pivotMethod}
              onChange={(e) => setPivotMethod(e.target.value as any)}
              className="w-full px-3 py-2 bg-gray-800 border border-emerald-500/50 rounded-lg text-gray-100 focus:border-emerald-400"
            >
              <option value="standard">{t('pivotsTab.standard')}</option>
              <option value="fibonacci">{t('pivotsTab.fibonacci')}</option>
              <option value="camarilla">{t('pivotsTab.camarilla')}</option>
              <option value="woodie">{t('pivotsTab.woodie')}</option>
              <option value="demark">{t('pivotsTab.demark')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">{t('pivotsTab.timeframe')}</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as any)}
              className="w-full px-3 py-2 bg-gray-800 border border-emerald-500/50 rounded-lg text-gray-100 focus:border-emerald-400"
            >
              <option value="daily">{t('pivotsTab.daily')}</option>
              <option value="weekly">{t('pivotsTab.weekly')}</option>
              <option value="monthly">{t('pivotsTab.monthly')}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">{t('pivotsTab.historicalPeriods')}</label>
            <input
              type="number"
              min="20"
              max="756"
              value={lookbackInput}
              onChange={(e) => {
                setLookbackInput(e.target.value);
                const parsed = parseInt(e.target.value);
                if (!isNaN(parsed) && parsed >= 20 && parsed <= 756) {
                  setLookbackPeriods(parsed);
                }
              }}
              onBlur={() => {
                const parsed = parseInt(lookbackInput);
                if (isNaN(parsed) || parsed < 20) {
                  setLookbackPeriods(20);
                  setLookbackInput('20');
                } else if (parsed > 756) {
                  setLookbackPeriods(756);
                  setLookbackInput('756');
                } else {
                  setLookbackPeriods(parsed);
                  setLookbackInput(String(parsed));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-full px-3 py-2 bg-gray-800 border border-emerald-500/50 rounded-lg text-gray-100 focus:border-emerald-400"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-2">{t('pivotsTab.tolerance')}</label>
            <input
              type="number"
              min="0.5"
              max="5"
              step="0.1"
              value={toleranceInput}
              onChange={(e) => setToleranceInput(e.target.value)}
              onBlur={() => {
                const parsed = parseFloat(toleranceInput);
                if (isNaN(parsed) || parsed < 0.5) {
                  setTolerancePercent(0.5);
                  setToleranceInput('0.5');
                } else if (parsed > 5) {
                  setTolerancePercent(5);
                  setToleranceInput('5');
                } else {
                  setTolerancePercent(parsed);
                  setToleranceInput(String(parsed));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-full px-3 py-2 bg-gray-800 border border-emerald-500/50 rounded-lg text-gray-100 focus:border-emerald-400"
            />
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={volumeWeighted}
                onChange={(e) => setVolumeWeighted(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
              {t('pivotsTab.volumeWeighted')}
            </label>
          </div>
        </div>
      </div>

      {/* Current Pivot Levels */}
      {currentPivots && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.06]">
          <h4 className="text-xl font-bold text-gray-100 mb-4">
            {pivotMethod.charAt(0).toUpperCase() + pivotMethod.slice(1)} Pivot Points ({timeframe})
          </h4>
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
            {currentPivots.map((pivot, i) => {
              const distance = calculateDistance(pivot.value);
              const isAbove = distance > 0;
              return (
                <div
                  key={i}
                  className={`p-4 rounded-xl border text-center ${
                    pivot.type === 'support' ? 'bg-green-900/30 border-green-700' :
                    pivot.type === 'resistance' ? 'bg-red-900/30 border-red-700' :
                    'bg-green-900/40 border-green-500'
                  }`}
                >
                  <p className={`text-sm mb-1 ${
                    pivot.type === 'support' ? 'text-green-300' :
                    pivot.type === 'resistance' ? 'text-red-300' :
                    'text-green-300'
                  }`}>{pivot.name}</p>
                  <p className={`text-xl font-bold ${
                    pivot.type === 'support' ? 'text-green-400' :
                    pivot.type === 'resistance' ? 'text-red-400' :
                    'text-green-400'
                  }`}>${pivot.value.toFixed(2)}</p>
                  <p className={`text-xs mt-1 ${isAbove ? 'text-green-400' : 'text-red-400'}`}>
                    {isAbove ? '+' : ''}{distance.toFixed(2)}%
                  </p>
                </div>
              );
            })}
          </div>

          {/* Method Description */}
          <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-white/[0.06]">
            <p className="text-sm text-gray-400">
              {pivotMethod === 'standard' && t('pivotsTab.standardDesc')}
              {pivotMethod === 'fibonacci' && t('pivotsTab.fibonacciDesc')}
              {pivotMethod === 'camarilla' && t('pivotsTab.camarillaDesc')}
              {pivotMethod === 'woodie' && t('pivotsTab.woodieDesc')}
              {pivotMethod === 'demark' && t('pivotsTab.demarkDesc')}
            </p>
          </div>
        </div>
      )}

      {/* Chart with Pivot Lines */}
      {chartData && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.06]">
          <h4 className="text-xl font-bold text-gray-100 mb-4">{t('pivotsTab.chartTitle')}</h4>
          <div className="h-[500px]">
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    ticks: { color: '#9ca3af', callback: (v: any) => '$' + v.toFixed(0) },
                    grid: { color: '#374151' },
                  },
                  x: {
                    ticks: { color: '#9ca3af', maxTicksLimit: 10 },
                    grid: { color: '#374151', lineWidth: 0.5 },
                  },
                },
                plugins: {
                  legend: { display: false },
                  annotation: { annotations: chartData.annotations },
                  tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#f3f4f6',
                    bodyColor: '#d1d5db',
                    callbacks: {
                      label: (ctx: any) => `Price: $${ctx.raw.toFixed(2)}`,
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      )}

      {/* Historical Support/Resistance Levels */}
      {showHistoricalLevels && historicalPivots.length > 0 && (
        <div className="bg-gradient-to-r bg-gray-950 to-teal-900/30 p-6 rounded-2xl border border-emerald-600">
          <h4 className="text-xl font-bold text-emerald-400 mb-4">
            {t('pivotsTab.historicalLevels')}
          </h4>
          <p className="text-sm text-gray-400 mb-4">
            {t('pivotsTab.basedOnPeriods')} {lookbackPeriods} ({timeframe}). {t('pivotsTab.tolerance')} {tolerancePercent}%
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {historicalPivots.map((pivot, i) => {
              const distance = calculateDistance(pivot.price);
              return (
                <div
                  key={i}
                  className={`p-4 rounded-xl border ${
                    pivot.type === 'support' ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-xs px-2 py-1 rounded ${
                      pivot.type === 'support' ? 'bg-green-700 text-green-200' : 'bg-red-700 text-red-200'
                    }`}>
                      {pivot.type === 'support' ? t('pivotsTab.support') : t('pivotsTab.resistance')}
                    </span>
                    <span className="text-xs text-gray-400">
                      {'⭐'.repeat(pivot.strength)}
                    </span>
                  </div>
                  <p className={`text-2xl font-bold ${
                    pivot.type === 'support' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    ${pivot.price.toFixed(2)}
                  </p>
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-gray-400">{pivot.count} {t('pivotsTab.touches')}</span>
                    <span className={distance > 0 ? 'text-green-400' : 'text-red-400'}>
                      {distance > 0 ? '+' : ''}{distance.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fibonacci Retracement */}
      {fibonacciLevels.length > 0 && (
        <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/30 p-6 rounded-2xl border border-amber-600">
          <h4 className="text-xl font-bold text-amber-400 mb-4">{t('pivotsTab.fibRetracement')}</h4>
          <p className="text-sm text-gray-400 mb-4">
            {t('pivotsTab.swingHigh')}: ${Math.max(...aggregatedData.map(d => d.high)).toFixed(2)} →
            {t('pivotsTab.swingLow')}: ${Math.min(...aggregatedData.map(d => d.low)).toFixed(2)}
          </p>

          <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
            {fibonacciLevels.map((level, i) => {
              const distance = calculateDistance(level.price);
              const intensity = level.percentage * 255;
              return (
                <div
                  key={i}
                  className="p-3 rounded-lg border border-amber-700 bg-amber-900/20 text-center"
                  style={{ opacity: 0.6 + level.percentage * 0.4 }}
                >
                  <p className="text-xs text-amber-300 mb-1">{level.level}</p>
                  <p className="text-lg font-bold text-amber-400">${level.price.toFixed(2)}</p>
                  <p className={`text-xs ${distance > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {distance > 0 ? '+' : ''}{distance.toFixed(1)}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Volume Profile & POC */}
      {volumeProfile && pocLevel && (
        <div className="bg-gray-950 p-6 rounded-2xl border border-green-600">
          <h4 className="text-xl font-bold text-green-400 mb-4">{t('pivotsTab.volumeProfile')}</h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* POC Card */}
            <div className="bg-green-900/40 p-6 rounded-xl border-2 border-green-500 text-center">
              <p className="text-sm text-green-300 mb-2">{t('pivotsTab.pocLabel')}</p>
              <p className="text-4xl font-bold text-green-400">${pocLevel.priceLevel.toFixed(2)}</p>
              <p className="text-sm text-gray-400 mt-2">
                {t('pivotsTab.pocDescription')}
              </p>
              <p className={`text-lg font-semibold mt-2 ${
                calculateDistance(pocLevel.priceLevel) > 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {calculateDistance(pocLevel.priceLevel) > 0 ? '+' : ''}
                {calculateDistance(pocLevel.priceLevel).toFixed(2)}% {t('pivotsTab.fromCurrentPrice')}
              </p>
            </div>

            {/* Volume Profile Chart */}
            <div className="col-span-2">
              <div className="h-[250px]">
                <Bar
                  data={{
                    labels: volumeProfile.map(b => `$${b.priceLevel.toFixed(0)}`),
                    datasets: [{
                      label: t('pivotsTab.volume'),
                      data: volumeProfile.map(b => b.volume),
                      backgroundColor: volumeProfile.map(b =>
                        b.priceLevel === pocLevel.priceLevel
                          ? 'rgba(139, 92, 246, 0.9)'
                          : 'rgba(139, 92, 246, 0.4)'
                      ),
                      borderColor: 'rgba(139, 92, 246, 0.8)',
                      borderWidth: 1,
                    }],
                  }}
                  options={{
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                      x: {
                        ticks: { color: '#9ca3af' },
                        grid: { color: '#374151' },
                      },
                      y: {
                        ticks: { color: '#9ca3af', font: { size: 10 } },
                        grid: { display: false },
                      },
                    },
                    plugins: {
                      legend: { display: false },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary / Signal */}
      {currentPivots && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.08]">
          <h4 className="text-xl font-bold text-gray-100 mb-4">{t('pivotsTab.analysisSummary')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Nearest Support */}
            <div className="bg-green-900/30 p-4 rounded-xl border border-green-700">
              <p className="text-sm text-green-300 mb-2">{t('pivotsTab.nearestSupport')}</p>
              {(() => {
                const supports = currentPivots.filter(p => p.type === 'support' && p.value < currentPrice);
                const nearest = supports.sort((a, b) => b.value - a.value)[0];
                if (!nearest) return <p className="text-gray-400">N/A</p>;
                return (
                  <>
                    <p className="text-2xl font-bold text-green-400">${nearest.value.toFixed(2)}</p>
                    <p className="text-sm text-gray-400">{nearest.name} ({calculateDistance(nearest.value).toFixed(2)}%)</p>
                  </>
                );
              })()}
            </div>

            {/* Current Position */}
            <div className="bg-green-900/40 p-4 rounded-xl border-2 border-green-500">
              <p className="text-sm text-green-300 mb-2">{t('pivotsTab.currentPrice')}</p>
              <p className="text-3xl font-bold text-yellow-400">${currentPrice.toFixed(2)}</p>
              {(() => {
                const pp = currentPivots.find(p => p.name === 'PP');
                if (!pp) return null;
                const isAbovePP = currentPrice > pp.value;
                return (
                  <p className={`text-sm mt-2 ${isAbovePP ? 'text-green-400' : 'text-red-400'}`}>
                    {isAbovePP ? `↑ ${t('pivotsTab.abovePivot')}` : `↓ ${t('pivotsTab.belowPivot')}`}
                  </p>
                );
              })()}
            </div>

            {/* Nearest Resistance */}
            <div className="bg-red-900/30 p-4 rounded-xl border border-red-700">
              <p className="text-sm text-red-300 mb-2">{t('pivotsTab.nearestResistance')}</p>
              {(() => {
                const resistances = currentPivots.filter(p => p.type === 'resistance' && p.value > currentPrice);
                const nearest = resistances.sort((a, b) => a.value - b.value)[0];
                if (!nearest) return <p className="text-gray-400">N/A</p>;
                return (
                  <>
                    <p className="text-2xl font-bold text-red-400">${nearest.value.toFixed(2)}</p>
                    <p className="text-sm text-gray-400">{nearest.name} (+{calculateDistance(nearest.value).toFixed(2)}%)</p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Info Footer */}
      <div className="text-center text-sm text-gray-500 space-y-1">
        <p>
          {t('pivotsTab.footerExplanation')}
        </p>
        <p>
          {t('pivotsTab.footerDataInfo')} {aggregatedData.length} ({timeframe}). {priceData[0]?.date || 'N/A'}
        </p>
      </div>
    </div>
  );
}
