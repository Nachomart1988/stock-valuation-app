// src/app/components/tabs/ForecastsTab.tsx
'use client';

import { useEffect, useState } from 'react';

interface Estimate {
  date: string;
  revenueAvg: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  netIncomeAvg: number | null;
  netIncomeLow: number | null;
  netIncomeHigh: number | null;
  ebitdaAvg: number | null;
  ebitdaLow: number | null;
  ebitdaHigh: number | null;
  ebitAvg: number | null;
  ebitLow: number | null;
  ebitHigh: number | null;
  sgaExpenseAvg: number | null;
  sgaExpenseLow: number | null;
  sgaExpenseHigh: number | null;
  numAnalystsRevenue: number | null;
  numAnalystsEps: number | null;
}

export default function ForecastsTab({ ticker }: { ticker: string }) {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchForecasts = async () => {
      try {
        setLoading(true);
        setError(null);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('FMP_API_KEY no configurada');

        const url = `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${ticker}&period=annual&limit=10&apikey=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Error ${res.status}: ${errText}`);
        }

        const json = await res.json();

        const futureEstimates = json
          .filter((est: any) => new Date(est.date) > new Date())
          .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

        setEstimates(futureEstimates);
      } catch (err: any) {
        console.error('[Forecasts] Error:', err);
        setError(err.message || 'Error al cargar forecasts');
      } finally {
        setLoading(false);
      }
    };

    fetchForecasts();
  }, [ticker]);

  const formatNumber = (value: number | null, isRevenue = false) => {
    if (value === null || isNaN(value)) return '—';
    if (isRevenue) {
      if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
      if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
      return `$${(value / 1e6).toFixed(2)}M`;
    }
    return value.toFixed(2);
  };

  if (loading) {
    return <p className="text-xl text-gray-300 py-10 text-center">Cargando forecasts...</p>;
  }

  if (error) {
    return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;
  }

  if (estimates.length === 0) {
    return <p className="text-xl text-gray-400 py-10 text-center">No hay estimaciones disponibles para los próximos años</p>;
  }

  const years = estimates.map(est => new Date(est.date).getFullYear());

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
            Analyst Forecasts
          </h3>
          <p className="text-sm text-gray-400 mt-1">Estimaciones de analistas para {ticker} - Próximos {estimates.length} años</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-cyan-900/40 to-blue-900/40 px-4 py-2 rounded-xl border border-cyan-600">
            <p className="text-xs text-cyan-400">Periodos</p>
            <p className="text-xl font-bold text-cyan-400">{estimates.length}</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-6 py-4 text-left font-bold text-gray-200 sticky left-0 bg-gray-800 z-10 min-w-[220px]">
                Métrica
              </th>
              {years.map(year => (
                <th key={year} className="px-6 py-4 text-center font-bold text-gray-200 min-w-[140px]">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {/* Revenue Avg */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                Revenue (Avg)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-blue-400 font-semibold">
                  {formatNumber(est.revenueAvg, true)}
                </td>
              ))}
            </tr>

            {/* Revenue Low */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Revenue (Low)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.revenueLow, true)}
                </td>
              ))}
            </tr>

            {/* Revenue High */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Revenue (High)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.revenueHigh, true)}
                </td>
              ))}
            </tr>

            {/* EPS Avg */}
            <tr className="hover:bg-gray-700 bg-gray-800/50">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                EPS (Avg)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-green-400 font-semibold">
                  {formatNumber(est.epsAvg)}
                </td>
              ))}
            </tr>

            {/* EPS Low */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EPS (Low)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.epsLow)}
                </td>
              ))}
            </tr>

            {/* EPS High */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EPS (High)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.epsHigh)}
                </td>
              ))}
            </tr>

            {/* Net Income Avg */}
            <tr className="hover:bg-gray-700 bg-gray-800/50">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                Net Income (Avg)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-purple-400 font-semibold">
                  {formatNumber(est.netIncomeAvg, true)}
                </td>
              ))}
            </tr>

            {/* Net Income Low */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Net Income (Low)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.netIncomeLow, true)}
                </td>
              ))}
            </tr>

            {/* Net Income High */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Net Income (High)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.netIncomeHigh, true)}
                </td>
              ))}
            </tr>

            {/* EBITDA Avg */}
            <tr className="hover:bg-gray-700 bg-gray-800/50">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                EBITDA (Avg)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-indigo-400 font-semibold">
                  {formatNumber(est.ebitdaAvg, true)}
                </td>
              ))}
            </tr>

            {/* EBITDA Low */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EBITDA (Low)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.ebitdaLow, true)}
                </td>
              ))}
            </tr>

            {/* EBITDA High */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EBITDA (High)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.ebitdaHigh, true)}
                </td>
              ))}
            </tr>

            {/* EBIT Avg */}
            <tr className="hover:bg-gray-700 bg-gray-800/50">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                EBIT (Avg)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-cyan-400 font-semibold">
                  {formatNumber(est.ebitAvg, true)}
                </td>
              ))}
            </tr>

            {/* EBIT Low */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EBIT (Low)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.ebitLow, true)}
                </td>
              ))}
            </tr>

            {/* EBIT High */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EBIT (High)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.ebitHigh, true)}
                </td>
              ))}
            </tr>

            {/* SGA Expense Avg */}
            <tr className="hover:bg-gray-700 bg-gray-800/50">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                SGA Expense (Avg)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-orange-400 font-semibold">
                  {formatNumber(est.sgaExpenseAvg, true)}
                </td>
              ))}
            </tr>

            {/* SGA Expense Low */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                SGA Expense (Low)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.sgaExpenseLow, true)}
                </td>
              ))}
            </tr>

            {/* SGA Expense High */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                SGA Expense (High)
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-400">
                  {formatNumber(est.sgaExpenseHigh, true)}
                </td>
              ))}
            </tr>

            {/* # Analistas Revenue */}
            <tr className="hover:bg-gray-700 bg-gray-800/50">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                # Analistas Revenue
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-300">
                  {est.numAnalystsRevenue ?? '—'}
                </td>
              ))}
            </tr>

            {/* # Analistas EPS */}
            <tr className="hover:bg-gray-700">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-200">
                # Analistas EPS
              </td>
              {estimates.map((est, idx) => (
                <td key={idx} className="px-6 py-4 text-right text-gray-300">
                  {est.numAnalystsEps ?? '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 text-center italic">
        Estimaciones anuales promedio de analistas. Fuente: Financial Modeling Prep. {estimates.length} años disponibles.
      </p>
    </div>
  );
}
