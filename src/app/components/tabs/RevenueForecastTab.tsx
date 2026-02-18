// src/app/components/tabs/RevenueForecastTab.tsx
'use client';

import { useMemo, useState, useEffect } from 'react';
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
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { useLanguage } from '@/i18n/LanguageContext';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface RevenueForecastTabProps {
  income: any[];
}

export default function RevenueForecastTab({ income }: RevenueForecastTabProps) {
  const { t } = useLanguage();
  const [forecastYears, setForecastYears] = useState(5);
  const [optimizedParams, setOptimizedParams] = useState<{ alpha: number; beta: number; mse: number } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // ────────────────────────────────────────────────
  // Preparar datos históricos (orden cronológico ascendente)
  // ────────────────────────────────────────────────
  const historical = useMemo(() => {
    if (!income || income.length < 2) return [];

    return [...income]
      .filter((item) => item.date && item.revenue && item.revenue > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((item) => ({
        year: new Date(item.date).getFullYear().toString(),
        revenue: item.revenue / 1e9, // en billones
      }));
  }, [income]);

  // ────────────────────────────────────────────────
  // Función para calcular Holt con alpha y beta dados
  // Retorna los valores fitted (para comparar con histórico) y el MSE
  // ────────────────────────────────────────────────
  const calculateHolt = (revenues: number[], alpha: number, beta: number) => {
    if (revenues.length < 2) return { fitted: [], mse: Infinity, level: 0, trend: 0 };

    // Inicialización
    let level = revenues[0];
    let trend = revenues[1] - revenues[0];

    const fitted: number[] = [level]; // El primer valor fitted es el nivel inicial

    // Calcular valores fitted para cada punto histórico
    for (let t = 1; t < revenues.length; t++) {
      const prevLevel = level;
      // Predicción para este punto (antes de ver el dato real)
      const prediction = prevLevel + trend;
      fitted.push(prediction);

      // Actualizar nivel y tendencia después de ver el dato real
      level = alpha * revenues[t] + (1 - alpha) * (prevLevel + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    // Calcular MSE (Mean Squared Error) entre fitted y actuals
    let sumSquaredError = 0;
    for (let i = 1; i < revenues.length; i++) {
      const error = revenues[i] - fitted[i];
      sumSquaredError += error * error;
    }
    const mse = sumSquaredError / (revenues.length - 1);

    return { fitted, mse, level, trend };
  };

  // ────────────────────────────────────────────────
  // Optimizar alpha y beta para minimizar MSE
  // ────────────────────────────────────────────────
  useEffect(() => {
    if (historical.length < 3) return;

    setIsOptimizing(true);
    const revenues = historical.map((d) => d.revenue);

    let bestAlpha = 0.5;
    let bestBeta = 0.5;
    let bestMSE = Infinity;

    // Grid search: probar combinaciones de alpha y beta
    const step = 0.05;
    for (let alpha = 0.05; alpha <= 0.95; alpha += step) {
      for (let beta = 0.05; beta <= 0.95; beta += step) {
        const { mse } = calculateHolt(revenues, alpha, beta);
        if (mse < bestMSE) {
          bestMSE = mse;
          bestAlpha = alpha;
          bestBeta = beta;
        }
      }
    }

    // Refinamiento con step más pequeño alrededor del mejor encontrado
    const fineStep = 0.01;
    const alphaStart = Math.max(0.01, bestAlpha - 0.1);
    const alphaEnd = Math.min(0.99, bestAlpha + 0.1);
    const betaStart = Math.max(0.01, bestBeta - 0.1);
    const betaEnd = Math.min(0.99, bestBeta + 0.1);

    for (let alpha = alphaStart; alpha <= alphaEnd; alpha += fineStep) {
      for (let beta = betaStart; beta <= betaEnd; beta += fineStep) {
        const { mse } = calculateHolt(revenues, alpha, beta);
        if (mse < bestMSE) {
          bestMSE = mse;
          bestAlpha = alpha;
          bestBeta = beta;
        }
      }
    }

    setOptimizedParams({
      alpha: Math.round(bestAlpha * 100) / 100,
      beta: Math.round(bestBeta * 100) / 100,
      mse: bestMSE,
    });
    setIsOptimizing(false);
  }, [historical]);

  if (historical.length < 3) {
    return (
      <div className="text-center py-16 text-gray-400 text-xl">
        {t('revenueForecastTab.insufficientData')}
      </div>
    );
  }

  const revenues = historical.map((d) => d.revenue);

  // ────────────────────────────────────────────────
  // 1. Holt's Linear Trend con parámetros optimizados
  // ────────────────────────────────────────────────
  const alpha = optimizedParams?.alpha || 0.5;
  const beta = optimizedParams?.beta || 0.5;

  const holtResult = calculateHolt(revenues, alpha, beta);
  const { fitted: holtFitted, level: finalLevel, trend: finalTrend } = holtResult;

  // Forecast para los próximos años
  const holtForecast: number[] = [];
  let currentLevel = finalLevel;
  let currentTrend = finalTrend;

  for (let i = 1; i <= forecastYears; i++) {
    const forecast = currentLevel + currentTrend;
    holtForecast.push(forecast);
    currentLevel = forecast;
  }

  // ────────────────────────────────────────────────
  // 2. Regresión lineal simple (por año)
  // ────────────────────────────────────────────────
  const n = historical.length;
  const x = historical.map((_, i) => i);
  const y = revenues;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Fitted values para regresión (en datos históricos)
  const regressionFitted = x.map((xi) => intercept + slope * xi);

  // Predecir próximos años
  const regressionForecast: number[] = [];
  for (let i = 1; i <= forecastYears; i++) {
    const nextX = n - 1 + i;
    regressionForecast.push(intercept + slope * nextX);
  }

  // Calcular MSE de regresión
  let regressionMSE = 0;
  for (let i = 0; i < revenues.length; i++) {
    const error = revenues[i] - regressionFitted[i];
    regressionMSE += error * error;
  }
  regressionMSE /= revenues.length;

  // ────────────────────────────────────────────────
  // Preparar datos para el gráfico
  // ────────────────────────────────────────────────
  const years = [
    ...historical.map((d) => d.year),
    ...Array.from({ length: forecastYears }, (_, i) => {
      const lastYear = parseInt(historical[historical.length - 1]?.year || '2024');
      return (lastYear + i + 1).toString();
    }),
  ];

  const chartData = {
    labels: years,
    datasets: [
      {
        type: 'bar' as const,
        label: t('revenueForecastTab.revenueHistorical'),
        data: [
          ...historical.map((d) => d.revenue),
          ...Array(forecastYears).fill(null),
        ],
        backgroundColor: 'rgba(59, 130, 246, 0.65)',
        borderColor: 'rgba(59, 130, 246, 0.9)',
        borderWidth: 1,
      },
      {
        type: 'line' as const,
        label: t('revenueForecastTab.holtFitted'),
        data: [
          ...holtFitted,
          ...Array(forecastYears).fill(null),
        ],
        borderColor: 'rgba(16, 185, 129, 0.5)',
        backgroundColor: 'rgba(16, 185, 129, 0.5)',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 3,
        tension: 0.1,
        fill: false,
      },
      {
        type: 'line' as const,
        label: t('revenueForecastTab.holtForecast'),
        data: [
          ...Array(historical.length).fill(null),
          ...holtForecast,
        ],
        borderColor: '#10b981',
        backgroundColor: '#10b981',
        borderWidth: 3,
        pointRadius: 5,
        tension: 0.1,
        fill: false,
      },
      {
        type: 'line' as const,
        label: t('revenueForecastTab.regressionFitted'),
        data: [
          ...regressionFitted,
          ...Array(forecastYears).fill(null),
        ],
        borderColor: 'rgba(245, 158, 11, 0.5)',
        backgroundColor: 'rgba(245, 158, 11, 0.5)',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 3,
        tension: 0.1,
        fill: false,
      },
      {
        type: 'line' as const,
        label: t('revenueForecastTab.regressionForecast'),
        data: [
          ...Array(historical.length).fill(null),
          ...regressionForecast,
        ],
        borderColor: '#f59e0b',
        backgroundColor: '#f59e0b',
        borderWidth: 3,
        pointRadius: 5,
        tension: 0.1,
        fill: false,
      },
    ],
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t('revenueForecastTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('revenueForecastTab.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-emerald-900/40 to-teal-900/40 px-4 py-2 rounded-xl border border-emerald-600">
            <p className="text-xs text-emerald-400">{t('revenueForecastTab.yearsProjected')}</p>
            <p className="text-xl font-bold text-emerald-400">{forecastYears}</p>
          </div>
        </div>
      </div>

      {/* Info de optimización */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h3 className="text-xl font-bold text-emerald-400 mb-4">{t('revenueForecastTab.optimizedParameters')}</h3>
        {isOptimizing ? (
          <p className="text-gray-400">{t('revenueForecastTab.optimizing')}</p>
        ) : optimizedParams ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-gray-700 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm mb-1">{t('revenueForecastTab.alpha')}</p>
              <p className="text-2xl font-bold text-emerald-400">{optimizedParams.alpha.toFixed(2)}</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm mb-1">{t('revenueForecastTab.betaParam')}</p>
              <p className="text-2xl font-bold text-emerald-400">{optimizedParams.beta.toFixed(2)}</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm mb-1">{t('revenueForecastTab.mseHolt')}</p>
              <p className="text-2xl font-bold text-emerald-400">{optimizedParams.mse.toFixed(4)}</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm mb-1">{t('revenueForecastTab.mseRegression')}</p>
              <p className="text-2xl font-bold text-amber-400">{regressionMSE.toFixed(4)}</p>
            </div>
          </div>
        ) : null}
        <p className="text-sm text-gray-500 mt-4">
          {t('revenueForecastTab.paramExplanation')}
        </p>
      </div>

      {/* Control de años */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div className="max-w-xs">
          <label className="block text-gray-300 mb-2">{t('revenueForecastTab.yearsToProject')}</label>
          <input
            type="number"
            min="1"
            max="10"
            value={forecastYears}
            onChange={(e) => setForecastYears(Math.max(1, parseInt(e.target.value) || 5))}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
          />
        </div>
      </div>

      {/* Gráfico */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h3 className="text-2xl font-bold text-green-400 mb-6 text-center">
          {t('revenueForecastTab.chartTitle')} ({forecastYears} {t('revenueForecastTab.yearsToProject')})
        </h3>
        <div className="h-96">
          <Chart
            type="bar"
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: false,
                  title: { display: true, text: 'Revenue en billones de USD ($B)', color: '#e5e7eb' },
                  ticks: { color: '#e5e7eb' },
                  grid: { color: '#4b5563' },
                },
                x: {
                  ticks: { color: '#e5e7eb' },
                  grid: { display: false },
                },
              },
              plugins: {
                legend: {
                  labels: { color: '#e5e7eb', font: { size: 14 } },
                },
                tooltip: {
                  mode: 'index',
                  intersect: false,
                },
              },
            }}
          />
        </div>
      </div>

      {/* Tabla comparativa */}
      <div className="overflow-x-auto">
        <table className="min-w-full bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <thead className="bg-gray-700">
            <tr>
              <th className="px-6 py-4 text-left">{t('revenueForecastTab.yearsProjected').replace('Proyectados', '').replace('Projected', '')}</th>
              <th className="px-6 py-4 text-right">{t('revenueForecastTab.revenueHistorical')}</th>
              <th className="px-6 py-4 text-right">{t('revenueForecastTab.holtFitted')}</th>
              <th className="px-6 py-4 text-right">{t('revenueForecastTab.holtForecast')}</th>
              <th className="px-6 py-4 text-right">{t('revenueForecastTab.regressionFitted')}</th>
              <th className="px-6 py-4 text-right">{t('revenueForecastTab.regressionForecast')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {years.map((year, idx) => {
              const isHistorical = idx < historical.length;
              const histRev = isHistorical ? historical[idx].revenue : null;
              const holtFit = isHistorical ? holtFitted[idx] : null;
              const holtFor = idx >= historical.length ? holtForecast[idx - historical.length] : null;
              const regFit = isHistorical ? regressionFitted[idx] : null;
              const regFor = idx >= historical.length ? regressionForecast[idx - historical.length] : null;

              return (
                <tr key={year} className={isHistorical ? '' : 'bg-gray-900/50'}>
                  <td className="px-6 py-4 font-medium">{year}</td>
                  <td className="px-6 py-4 text-right text-green-400 font-semibold">
                    {histRev ? histRev.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-emerald-300">
                    {holtFit ? holtFit.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-emerald-400 font-semibold">
                    {holtFor ? holtFor.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-amber-300">
                    {regFit ? regFit.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-amber-400 font-semibold">
                    {regFor ? regFor.toFixed(2) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-center text-sm text-gray-500 mt-4">
        {t('revenueForecastTab.footer')}
      </p>
    </div>
  );
}
