// src/app/components/tabs/ValuacionesTab.tsx
'use client';

import { useEffect, useState } from 'react';

interface ValuationMethod {
  name: string;
  value: number | null;
  enabled: boolean;
}

export default function ValuacionesTab({
  income,
  balance,
  cashFlow,
  priceTarget,
  profile,
}: {
  income: any[];
  balance: any[];
  cashFlow: any[];
  priceTarget: any;
  profile: any;
}) {
  const [h, setH] = useState<number>(5);
  const [glong, setGlong] = useState<number>(0.04);
  const [n, setN] = useState<number>(5);
  const [sharePriceT5, setSharePriceT5] = useState<number>(0);
  const [sharePriceT5CAGR, setSharePriceT5CAGR] = useState<number>(0.1);
  const [methods, setMethods] = useState<ValuationMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const calculate = () => {
      setLoading(true);
      setError(null);

      try {
        // Últimos datos (más reciente primero)
        const lastIncome = income[0] || {};
        const lastBalance = balance[0] || {};
        const lastCashFlow = cashFlow[0] || {};

        // D0 = último dividends paid (absoluto)
        const d0 = Math.abs(lastCashFlow.dividendsPaid || 0);

        // Gs = promedio de sustainable growth (placeholder 0.103, reemplaza con real de SustainableGrowthTab)
        const gs = 0.103;

        // Ks = promedio CAPM de BetaTab (placeholder 0.0544, reemplaza con real)
        const ks = 0.0544;

        // Beta = de profile
        const beta = profile.beta || 1;

        // FCFO = free cash flow per share
        const fcfo = (lastCashFlow.freeCashFlow || 0) / (lastIncome.weightedAverageShsOutDil || 1);

        // Book value per share
        const bookValue = (lastBalance.totalStockholdersEquity || 0) / (lastIncome.weightedAverageShsOutDil || 1);

        // EPS TTM
        const epsTTM = lastIncome.epsdiluted || (lastIncome.netIncome / lastIncome.weightedAverageShsOutDil) || 0;

        // Mean Target Price (último trimestre)
        const meanTarget = priceTarget.lastQuarterAvgPriceTarget || 0;

        const calculatedMethods: ValuationMethod[] = [
          {
            name: '2-Stage DDM',
            value: d0 * (1 + gs) / (ks - gs) * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) + sharePriceT5 / Math.pow(1 + ks, n),
            enabled: true,
          },
          {
            name: '3-Stage DDM',
            value: d0 * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) / (ks - gs) + d0 * Math.pow(1 + gs, n) * (1 + glong) / (ks - glong),
            enabled: true,
          },
          {
            name: 'H Model',
            value: (d0 * (1 + glong) + d0 * (gs - glong) * h) / (ks - glong),
            enabled: true,
          },
          {
            name: '2-Stage FCF',
            value: fcfo * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) / (ks - gs) + sharePriceT5 / Math.pow(1 + ks, n),
            enabled: true,
          },
          {
            name: '3-stage FCF',
            value: fcfo * (1 - Math.pow(1 + gs, n)) / (ks - gs) + fcfo * h * (gs - glong) / ((ks - glong) * Math.pow(1 + ks, n)) + sharePriceT5 / Math.pow(1 + ks, 2 * n),
            enabled: true,
          },
          {
            name: '2-Stage DDM (2)',
            value: d0 * (1 + gs) / (ks - gs) * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) + sharePriceT5 / Math.pow(1 + ks, n),
            enabled: true,
          },
          {
            name: '3-Stage DDM (2)',
            value: d0 * (1 + gs) / (ks - gs) * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) + d0 * Math.pow(1 + gs, 5) * (1 + glong) + d0 * Math.pow(1 + gs, 5) * h * (gs - glong) / ((ks - glong) * Math.pow(1 + ks, 5)),
            enabled: true,
          },
          {
            name: 'H Model (2)',
            value: d0 * ((1 + glong) + h * (gs - glong)) / (ks - glong),
            enabled: true,
          },
          {
            name: '2-Stage FCF (2)',
            value: fcfo * (1 + gs) / (ks - gs) * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) + sharePriceT5 / Math.pow(1 + ks, n),
            enabled: true,
          },
          {
            name: '3-stage FCF (2)',
            value: fcfo * (1 + gs) / (ks - gs) * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) + fcfo * Math.pow(1 + gs, 5) * (1 + glong) + fcfo * Math.pow(1 + gs, 5) * h * (gs - glong) / ((ks - glong) * Math.pow(1 + ks, 5)),
            enabled: true,
          },
          {
            name: 'Mean Target',
            value: meanTarget,
            enabled: true,
          },
          {
            name: 'Graham Method',
            value: Math.sqrt(22.5 * bookValue * epsTTM),
            enabled: true,
          },
          // Los otros (RIM, Stochastic DCF, etc.) los dejamos como placeholder 0 por ahora
          { name: 'DCF', value: 0, enabled: true },
          { name: '2 Stages FCFF', value: 0, enabled: true },
          { name: '3 Stages FCFE', value: 0, enabled: true },
          { name: '3 Stages FCFF', value: 0, enabled: true },
          { name: 'EPS*Benchmark', value: 0, enabled: true },
          { name: 'Graham Method 2', value: 0, enabled: true },
          { name: 'RIM', value: 0, enabled: true },
          { name: 'Stochastic DCF', value: 0, enabled: true },
          { name: 'HJM', value: 0, enabled: true },
          { name: 'Bayesian Valuation', value: 0, enabled: true },
        ];

        setMethods(calculatedMethods);
      } catch (err: any) {
        setError(err.message || 'Error al calcular valuaciones');
      } finally {
        setLoading(false);
      }
    };

    calculate();
  }, [h, glong, n, sharePriceT5, sharePriceT5CAGR, income, balance, cashFlow, priceTarget, profile]);

  const toggleMethod = (index: number) => {
    setMethods(prev =>
      prev.map((m, i) => i === index ? { ...m, enabled: !m.enabled } : m)
    );
  };

  const averageVal = methods
    .filter(m => m.enabled && m.value !== null)
    .reduce((sum, m) => sum + (m.value || 0), 0) / 
    methods.filter(m => m.enabled && m.value !== null).length || null;

  if (loading) return <p className="text-xl text-gray-300 py-10 text-center">Calculando valuaciones...</p>;
  if (error) return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;

  return (
    <div className="space-y-10 text-center">
      <h3 className="text-3xl font-bold text-gray-100">
        Valuaciones
      </h3>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-gray-800 p-6 rounded-xl border border-gray-700">
        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">H</label>
          <input
            type="number"
            value={h}
            onChange={(e) => setH(Number(e.target.value) || 5)}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg bg-gray-900 text-gray-100 text-lg"
          />
        </div>

        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Glong</label>
          <input
            type="number"
            step="0.001"
            value={glong}
            onChange={(e) => setGlong(Number(e.target.value) || 0.04)}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg bg-gray-900 text-gray-100 text-lg"
          />
        </div>

        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">N</label>
          <input
            type="number"
            value={n}
            onChange={(e) => setN(Number(e.target.value) || 5)}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg bg-gray-900 text-gray-100 text-lg"
          />
        </div>

        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Share Price t5</label>
          <input
            type="number"
            value={sharePriceT5}
            onChange={(e) => setSharePriceT5(Number(e.target.value) || 0)}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg bg-gray-900 text-gray-100 text-lg"
          />
        </div>

        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Share Price T5 CAGR</label>
          <input
            type="number"
            step="0.001"
            value={sharePriceT5CAGR}
            onChange={(e) => setSharePriceT5CAGR(Number(e.target.value) || 0.1)}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg bg-gray-900 text-gray-100 text-lg"
          />
        </div>
      </div>

      {/* Métodos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {methods.map((method, index) => (
          <div key={index} className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-sm text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <input
                type="checkbox"
                checked={method.enabled}
                onChange={() => toggleMethod(index)}
                className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-600 rounded"
              />
              <h4 className="text-xl font-semibold text-gray-100">
                {method.name}
              </h4>
            </div>
            <p className="text-4xl font-bold text-blue-400">
              {method.value !== null ? method.value.toFixed(2) : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Average */}
      <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl mt-12 text-center">
        <h4 className="text-3xl font-bold text-gray-100 mb-4">
          Average Valuaciones
        </h4>
        <p className="text-7xl font-black text-blue-400 tracking-tight">
          {averageVal !== null ? averageVal.toFixed(2) : '—'}
        </p>
        <p className="text-xl text-blue-300 mt-4">
          (basado en {methods.filter(m => m.enabled).length} métodos activos)
        </p>
      </div>

      <p className="text-sm text-gray-500 text-center italic">
        Desmarca métodos o cambia inputs para recalcular.
      </p>
    </div>
  );
}