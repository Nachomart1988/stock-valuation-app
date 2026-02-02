// src/app/components/tabs/RevenueForecastTab.tsx
'use client';

import { useMemo, useState } from 'react';
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
  const [alpha, setAlpha] = useState(0.6);
  const [beta, setBeta] = useState(0.3);
  const [forecastYears, setForecastYears] = useState(5);

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

  if (historical.length < 3) {
    return (
      <div className="text-center py-16 text-gray-400 text-xl">
        No hay suficientes datos históricos de revenue para realizar proyecciones confiables.
      </div>
    );
  }

  // ────────────────────────────────────────────────
  // 1. Holt's Linear Trend
  // ────────────────────────────────────────────────
  const holtForecast = useMemo(() => {
    const revenues = historical.map((d) => d.revenue);
    if (revenues.length < 2) return [];

    let level = revenues[0];
    let trend = revenues[1] - revenues[0];

    // Entrenamos con todos los datos históricos
    for (let t = 1; t < revenues.length; t++) {
      const prevLevel = level;
      level = alpha * revenues[t] + (1 - alpha) * (prevLevel + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    // Forecast para los próximos años
    const forecasts: number[] = [];
    let currentLevel = level;
    let currentTrend = trend;

    for (let i = 1; i <= forecastYears; i++) {
      currentLevel = currentLevel + currentTrend;
      forecasts.push(currentLevel);
    }

    return forecasts;
  }, [historical, alpha, beta, forecastYears]);

  // ────────────────────────────────────────────────
  // 2. Regresión lineal simple (por año)
  // ────────────────────────────────────────────────
  const regressionForecast = useMemo(() => {
    const n = historical.length;
    if (n < 3) return [];

    const x = historical.map((_, i) => i); // 0,1,2,...
    const y = historical.map((d) => d.revenue);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Predecir próximos años
    const forecasts: number[] = [];
    for (let i = 1; i <= forecastYears; i++) {
      const nextX = n - 1 + i;
      forecasts.push(intercept + slope * nextX);
    }

    return forecasts;
  }, [historical, forecastYears]);

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
        label: 'Revenue Histórico ($B)',
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
        label: 'Holt Linear Trend Forecast',
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
        label: 'Regresión Lineal Forecast',
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

  // ────────────────────────────────────────────────
  // Tabla comparativa
  // ────────────────────────────────────────────────
  const lastHistorical = historical[historical.length - 1]?.revenue || 0;

  return (
    <div className="space-y-10">
      {/* Controles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div>
          <label className="block text-gray-300 mb-2">Años a proyectar</label>
          <input
            type="number"
            min="1"
            max="10"
            value={forecastYears}
            onChange={(e) => setForecastYears(Math.max(1, parseInt(e.target.value) || 5))}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
          />
        </div>

        <div>
          <label className="block text-gray-300 mb-2">Alpha (Holt) — suavizado nivel</label>
          <input
            type="number"
            step="0.05"
            min="0.1"
            max="0.9"
            value={alpha}
            onChange={(e) => setAlpha(parseFloat(e.target.value) || 0.6)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
          />
        </div>

        <div>
          <label className="block text-gray-300 mb-2">Beta (Holt) — suavizado tendencia</label>
          <input
            type="number"
            step="0.05"
            min="0.01"
            max="0.5"
            value={beta}
            onChange={(e) => setBeta(parseFloat(e.target.value) || 0.3)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => {
              setAlpha(0.6);
              setBeta(0.3);
              setForecastYears(5);
            }}
            className="bg-gray-700 hover:bg-gray-600 px-5 py-2 rounded-lg text-sm"
          >
            Reset valores
          </button>
        </div>
      </div>

      {/* Gráfico */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h3 className="text-2xl font-bold text-blue-400 mb-6 text-center">
          Revenue Histórico vs Forecast ({forecastYears} años)
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
              <th className="px-6 py-4 text-left">Año</th>
              <th className="px-6 py-4 text-right">Revenue Histórico ($B)</th>
              <th className="px-6 py-4 text-right">Holt Forecast ($B)</th>
              <th className="px-6 py-4 text-right">Regresión Forecast ($B)</th>
              <th className="px-6 py-4 text-right">Crecimiento Holt</th>
              <th className="px-6 py-4 text-right">Crecimiento Regresión</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {years.map((year, idx) => {
              const isHistorical = idx < historical.length;
              const histRev = isHistorical ? historical[idx].revenue : null;
              const holtVal = idx >= historical.length ? holtForecast[idx - historical.length] : null;
              const regVal = idx >= historical.length ? regressionForecast[idx - historical.length] : null;

              const holtGrowth =
                idx > historical.length
                  ? ((holtForecast[idx - historical.length] / holtForecast[idx - historical.length - 1] - 1) * 100).toFixed(1)
                  : null;

              const regGrowth =
                idx > historical.length
                  ? ((regressionForecast[idx - historical.length] / regressionForecast[idx - historical.length - 1] - 1) * 100).toFixed(1)
                  : null;

              return (
                <tr key={year} className={isHistorical ? '' : 'bg-gray-900/50'}>
                  <td className="px-6 py-4 font-medium">{year}</td>
                  <td className="px-6 py-4 text-right">
                    {isHistorical ? histRev?.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-emerald-400">
                    {holtVal ? holtVal.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-amber-400">
                    {regVal ? regVal.toFixed(2) : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-emerald-300">
                    {holtGrowth ? `${holtGrowth}%` : '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-amber-300">
                    {regGrowth ? `${regGrowth}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-center text-sm text-gray-500 mt-4">
        Proyecciones en billones de dólares ($B). Modelos simples con fines ilustrativos.
      </p>
    </div>
  );
}