// src/app/components/tabs/SegmentationTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import { Pie, Bar } from 'react-chartjs-2';
import { fetchFmp } from '@/lib/fmpClient';
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface SegmentationTabProps {
  ticker: string;
}

interface ProductSegment {
  segment: string;
  revenue: number;
  date: string;
}

interface GeoSegment {
  region: string;
  revenue: number;
  date: string;
}

export default function SegmentationTab({ ticker }: SegmentationTabProps) {
  const { t } = useLanguage();
  const [productSegments, setProductSegments] = useState<ProductSegment[]>([]);
  const [geoSegments, setGeoSegments] = useState<GeoSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;

      setLoading(true);
      setError(null);

      try {
        const [productData, geoData] = await Promise.all([
          fetchFmp('stable/revenue-product-segmentation', { symbol: ticker }),
          fetchFmp('stable/revenue-geographic-segmentation', { symbol: ticker }),
        ]);

        {
          const data = productData;
          console.log('[SegmentationTab] Product segments:', data);
          // FMP returns array with { symbol, fiscalYear, date, data: { segment: value } }
          const processedSegments: ProductSegment[] = [];
          if (Array.isArray(data) && data.length > 0) {
            for (const item of data) {
              const dateKey = item.date || `${item.fiscalYear}`;
              const segments = item.data;
              if (segments && typeof segments === 'object') {
                for (const [segment, revenue] of Object.entries(segments)) {
                  const numRevenue = typeof revenue === 'number' ? revenue : parseFloat(String(revenue));
                  if (!isNaN(numRevenue) && isFinite(numRevenue)) {
                    processedSegments.push({
                      segment,
                      revenue: numRevenue,
                      date: dateKey,
                    });
                  }
                }
              }
            }
          }
          setProductSegments(processedSegments);
        }

        {
          const data = geoData;
          console.log('[SegmentationTab] Geographic segments:', data);
          // FMP returns array with { symbol, fiscalYear, date, data: { region: value } }
          const processedSegments: GeoSegment[] = [];
          if (Array.isArray(data) && data.length > 0) {
            for (const item of data) {
              const dateKey = item.date || `${item.fiscalYear}`;
              const segments = item.data;
              if (segments && typeof segments === 'object') {
                for (const [region, revenue] of Object.entries(segments)) {
                  const numRevenue = typeof revenue === 'number' ? revenue : parseFloat(String(revenue));
                  if (!isNaN(numRevenue) && isFinite(numRevenue)) {
                    processedSegments.push({
                      region,
                      revenue: numRevenue,
                      date: dateKey,
                    });
                  }
                }
              }
            }
          }
          setGeoSegments(processedSegments);
        }
      } catch (err: any) {
        setError(err.message || 'Error loading data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  // Get latest date's data for charts
  const latestProductData = useMemo(() => {
    if (productSegments.length === 0) return [];
    const dates = [...new Set(productSegments.map(s => s.date))].sort().reverse();
    const latestDate = dates[0];
    return productSegments.filter(s => s.date === latestDate);
  }, [productSegments]);

  const latestGeoData = useMemo(() => {
    if (geoSegments.length === 0) return [];
    const dates = [...new Set(geoSegments.map(s => s.date))].sort().reverse();
    const latestDate = dates[0];
    return geoSegments.filter(s => s.date === latestDate);
  }, [geoSegments]);

  // Chart colors
  const chartColors = [
    'rgba(59, 130, 246, 0.8)',   // blue
    'rgba(16, 185, 129, 0.8)',   // green
    'rgba(245, 158, 11, 0.8)',   // amber
    'rgba(239, 68, 68, 0.8)',    // red
    'rgba(139, 92, 246, 0.8)',   // purple
    'rgba(6, 182, 212, 0.8)',    // cyan
    'rgba(0, 166, 81, 0.8)',   // pink
    'rgba(249, 115, 22, 0.8)',   // orange
    'rgba(132, 204, 22, 0.8)',   // lime
    'rgba(99, 102, 241, 0.8)',   // indigo
  ];

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined || typeof value !== 'number' || !isFinite(value)) return 'N/A';
    if (Math.abs(value) >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
    if (Math.abs(value) >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (Math.abs(value) >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
    return '$' + value.toFixed(2);
  };

  const productChartData = {
    labels: latestProductData.map(s => s.segment),
    datasets: [
      {
        data: latestProductData.map(s => s.revenue),
        backgroundColor: chartColors.slice(0, latestProductData.length),
        borderColor: chartColors.slice(0, latestProductData.length).map(c => c.replace('0.8', '1')),
        borderWidth: 2,
      },
    ],
  };

  const geoChartData = {
    labels: latestGeoData.map(s => s.region),
    datasets: [
      {
        data: latestGeoData.map(s => s.revenue),
        backgroundColor: chartColors.slice(0, latestGeoData.length),
        borderColor: chartColors.slice(0, latestGeoData.length).map(c => c.replace('0.8', '1')),
        borderWidth: 2,
      },
    ],
  };

  // Historical data for bar charts
  const productHistoricalData = useMemo(() => {
    const dates = [...new Set(productSegments.map(s => s.date))].sort();
    const segments = [...new Set(productSegments.map(s => s.segment))];

    return {
      labels: dates,
      datasets: segments.map((segment, idx) => ({
        label: segment,
        data: dates.map(date => {
          const found = productSegments.find(s => s.date === date && s.segment === segment);
          return found ? found.revenue : 0;
        }),
        backgroundColor: chartColors[idx % chartColors.length],
        borderColor: chartColors[idx % chartColors.length].replace('0.8', '1'),
        borderWidth: 1,
      })),
    };
  }, [productSegments]);

  const geoHistoricalData = useMemo(() => {
    const dates = [...new Set(geoSegments.map(s => s.date))].sort();
    const regions = [...new Set(geoSegments.map(s => s.region))];

    return {
      labels: dates,
      datasets: regions.map((region, idx) => ({
        label: region,
        data: dates.map(date => {
          const found = geoSegments.find(s => s.date === date && s.region === region);
          return found ? found.revenue : 0;
        }),
        backgroundColor: chartColors[idx % chartColors.length],
        borderColor: chartColors[idx % chartColors.length].replace('0.8', '1'),
        borderWidth: 1,
      })),
    };
  }, [geoSegments]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#9CA3AF',
          padding: 20,
          font: { size: 12 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const value = context.raw;
            return `${context.label}: ${formatCurrency(value)}`;
          },
        },
      },
    },
  };

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true,
        ticks: { color: '#9CA3AF' },
        grid: { color: 'rgba(75, 85, 99, 0.3)' },
      },
      y: {
        stacked: true,
        ticks: {
          color: '#9CA3AF',
          callback: (value: any) => formatCurrency(value),
        },
        grid: { color: 'rgba(75, 85, 99, 0.3)' },
      },
    },
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: '#9CA3AF',
          padding: 15,
          font: { size: 11 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => `${context.dataset.label}: ${formatCurrency(context.raw)}`,
        },
      },
    },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LogoLoader size="md" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-400 text-center py-10">Error: {error}</p>;
  }

  const totalProductRevenue = latestProductData.reduce((sum, s) => sum + s.revenue, 0);
  const totalGeoRevenue = latestGeoData.reduce((sum, s) => sum + s.revenue, 0);

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-400 bg-clip-text text-transparent">
            {t('segmentationTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('segmentationTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r bg-gray-900 px-4 py-2 rounded-xl border border-green-600">
            <p className="text-xs text-green-400">{t('segmentationTab.segments')}</p>
            <p className="text-xl font-bold text-green-400">{latestProductData.length + latestGeoData.length}</p>
          </div>
        </div>
      </div>

      {/* Product Segmentation */}
      <div className="bg-gray-950 p-6 rounded-xl border border-green-600">
        <h4 className="text-2xl font-bold text-green-400 mb-6">{t('segmentationTab.productSegmentation')}</h4>

        {latestProductData.length === 0 ? (
          <p className="text-gray-400 text-center py-8">{t('segmentationTab.noProductData')} {ticker}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Pie Chart */}
            <div className="bg-gray-800/50 p-6 rounded-xl">
              <h5 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.latestPeriod')}</h5>
              <p className="text-sm text-gray-400 mb-4">{t('segmentationTab.date')}: {latestProductData[0]?.date}</p>
              <div className="h-80">
                <Pie data={productChartData} options={chartOptions} />
              </div>
            </div>

            {/* Breakdown Table */}
            <div className="bg-gray-800/50 p-6 rounded-xl">
              <h5 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.revenueBreakdown')}</h5>
              <div className="space-y-3">
                {latestProductData
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((segment, idx) => {
                    const percentage = totalProductRevenue > 0 ? (segment.revenue / totalProductRevenue) * 100 : 0;
                    return (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: chartColors[idx % chartColors.length] }}
                          />
                          <span className="text-gray-200">{segment.segment}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-gray-100 font-semibold">{formatCurrency(segment.revenue)}</p>
                          <p className="text-xs text-gray-400">{percentage.toFixed(1)}%</p>
                        </div>
                      </div>
                    );
                  })}
                <div className="flex items-center justify-between p-3 bg-green-900/30 rounded-lg border border-green-600">
                  <span className="text-green-400 font-semibold">{t('segmentationTab.totalRevenue')}</span>
                  <span className="text-green-400 font-bold">{formatCurrency(totalProductRevenue)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Historical Bar Chart */}
        {productSegments.length > 0 && (
          <div className="mt-8 bg-gray-800/50 p-6 rounded-xl">
            <h5 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.historicalProduct')}</h5>
            <div className="h-80">
              <Bar data={productHistoricalData} options={barChartOptions} />
            </div>
          </div>
        )}
      </div>

      {/* Geographic Segmentation */}
      <div className="bg-gradient-to-r from-gray-950 to-teal-900/30 p-6 rounded-xl border border-green-600">
        <h4 className="text-2xl font-bold text-green-400 mb-6">{t('segmentationTab.geographicSegmentation')}</h4>

        {latestGeoData.length === 0 ? (
          <p className="text-gray-400 text-center py-8">{t('segmentationTab.noGeoData')} {ticker}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Pie Chart */}
            <div className="bg-gray-800/50 p-6 rounded-xl">
              <h5 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.latestPeriod')}</h5>
              <p className="text-sm text-gray-400 mb-4">{t('segmentationTab.date')}: {latestGeoData[0]?.date}</p>
              <div className="h-80">
                <Pie data={geoChartData} options={chartOptions} />
              </div>
            </div>

            {/* Breakdown Table */}
            <div className="bg-gray-800/50 p-6 rounded-xl">
              <h5 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.regionalRevenue')}</h5>
              <div className="space-y-3">
                {latestGeoData
                  .sort((a, b) => b.revenue - a.revenue)
                  .map((segment, idx) => {
                    const percentage = totalGeoRevenue > 0 ? (segment.revenue / totalGeoRevenue) * 100 : 0;
                    return (
                      <div key={idx} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: chartColors[idx % chartColors.length] }}
                          />
                          <span className="text-gray-200">{segment.region}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-gray-100 font-semibold">{formatCurrency(segment.revenue)}</p>
                          <p className="text-xs text-gray-400">{percentage.toFixed(1)}%</p>
                        </div>
                      </div>
                    );
                  })}
                <div className="flex items-center justify-between p-3 bg-green-900/30 rounded-lg border border-green-600">
                  <span className="text-green-400 font-semibold">{t('segmentationTab.totalRevenue')}</span>
                  <span className="text-green-400 font-bold">{formatCurrency(totalGeoRevenue)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Historical Bar Chart */}
        {geoSegments.length > 0 && (
          <div className="mt-8 bg-gray-800/50 p-6 rounded-xl">
            <h5 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.historicalGeographic')}</h5>
            <div className="h-80">
              <Bar data={geoHistoricalData} options={barChartOptions} />
            </div>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {(latestProductData.length > 0 || latestGeoData.length > 0) && (
        <div className="bg-gray-800 rounded-xl border border-white/[0.06] p-6">
          <h4 className="text-lg font-semibold text-gray-200 mb-4">{t('segmentationTab.summaryTitle')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-700 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-green-400">{latestProductData.length}</p>
              <p className="text-sm text-gray-400">{t('segmentationTab.productSegments')}</p>
            </div>
            <div className="bg-gray-700 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-green-400">{latestGeoData.length}</p>
              <p className="text-sm text-gray-400">{t('segmentationTab.geographicRegions')}</p>
            </div>
            <div className="bg-gray-700 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">
                {latestProductData.length > 0 ? latestProductData.sort((a, b) => b.revenue - a.revenue)[0]?.segment : 'N/A'}
              </p>
              <p className="text-sm text-gray-400">{t('segmentationTab.topProduct')}</p>
            </div>
            <div className="bg-gray-700 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">
                {latestGeoData.length > 0 ? latestGeoData.sort((a, b) => b.revenue - a.revenue)[0]?.region : 'N/A'}
              </p>
              <p className="text-sm text-gray-400">{t('segmentationTab.topRegion')}</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-sm text-gray-500">
        {t('segmentationTab.footer')}
      </p>
    </div>
  );
}
