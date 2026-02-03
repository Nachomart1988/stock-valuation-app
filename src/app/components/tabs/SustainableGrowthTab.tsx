// src/app/components/tabs/SustainableGrowthTab.tsx
'use client';

import { useEffect, useState } from 'react';

interface SGRMethod {
  name: string;
  value: number | null;
  enabled: boolean;
}

interface SustainableGrowthTabProps {
  income: any[];
  balance: any[];
  cashFlow: any[];
  estimates: any[];
  dcfCustom?: any; // Para obtener WACC del Advance DCF
  calculatedWacc?: number; // WACC calculado en WACCTab
}

export default function SustainableGrowthTab({
  income,
  balance,
  cashFlow,
  estimates,
  dcfCustom,
  calculatedWacc,
}: SustainableGrowthTabProps) {
  // Calcular WACC promedio como default
  const getDefaultWacc = () => {
    const waccValues: number[] = [];

    // WACC del Advance DCF
    let advanceDcfWacc = dcfCustom?.wacc;
    if (advanceDcfWacc !== undefined && advanceDcfWacc !== null) {
      if (Math.abs(advanceDcfWacc) < 1) {
        advanceDcfWacc = advanceDcfWacc * 100;
      }
      if (advanceDcfWacc > 0 && advanceDcfWacc < 50) {
        waccValues.push(advanceDcfWacc);
      }
    }

    // WACC calculado del WACCTab
    if (calculatedWacc && calculatedWacc > 0 && calculatedWacc < 50) {
      waccValues.push(calculatedWacc);
    }

    if (waccValues.length > 0) {
      return waccValues.reduce((sum, w) => sum + w, 0) / waccValues.length;
    }

    return 8.5; // Default
  };

  const [years, setYears] = useState<number>(7);
  const [waccPercent, setWaccPercent] = useState<number>(getDefaultWacc()); // en %
  const [methods, setMethods] = useState<SGRMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Update WACC when props change
  useEffect(() => {
    const defaultWacc = getDefaultWacc();
    setWaccPercent(defaultWacc);
  }, [dcfCustom, calculatedWacc]);

  useEffect(() => {
    const calculate = () => {
      setLoading(true);
      setError(null);

      try {
        if (income.length < 2 || balance.length < 2 || cashFlow.length < 2) {
          setError('Datos insuficientes');
          setLoading(false);
          return;
        }

        const wacc = waccPercent / 100;

        // Ordenar ascendente
        const sortedIncome = [...income].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const sortedBalance = [...balance].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Asumir que las fechas alinean; si no, esto fallará sutilmente
        const selectedIncome = sortedIncome.slice(-years);
        const selectedBalance = sortedBalance.slice(-years);
        const selectedCashFlow = sortedCashFlow.slice(-years);

        // Ajustar avg para filtrar inválidos
        const avg = (values: (number | null)[]) => {
          const valid = values.filter((v): v is number => v !== null && isFinite(v) && !isNaN(v));
          return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
        };

        // Calcular avgAssets para thresholds relativos
        const assets = selectedBalance.map(b => b.totalAssets).filter(a => a > 0);
        const avgAssets = assets.length > 0 ? assets.reduce((a, b) => a + b, 0) / assets.length : 1;

        // ROE = netIncome / equity (skip si equity <=0)
        const roes = selectedIncome.map((inc, i) => {
          const equity = selectedBalance[i]?.totalStockholdersEquity;
          if (!equity || equity <= 0) return null;
          const roe = inc.netIncome / equity;
          return isFinite(roe) ? roe : null;
        });
        const avgROE = avg(roes);

        // Helper to get dividends with fallback field names
        const getDividendsPaid = (cf: any): number => {
          if (!cf) return 0;
          return Math.abs(
            cf.dividendsPaid ||
            cf.paymentOfDividends ||
            cf.commonStockDividendsPaid ||
            cf.dividendsPaidOnCommonStock ||
            cf.dividendsCommonStock ||
            0
          );
        };

        // Payout = dividends / netIncome (skip si netIncome <=0, cap 0-2)
        const payouts = selectedIncome.map((inc, i) => {
          const dividends = getDividendsPaid(selectedCashFlow[i]);
          const netIncome = inc.netIncome;
          if (!netIncome || netIncome <= 0) return null;
          const payout = dividends / netIncome;
          return payout >= 0 && payout <= 2 && isFinite(payout) ? payout : null;
        });
        const avgPayout = avg(payouts) ?? 0;

        // Net Margin = netIncome / revenue (skip si revenue <=0)
        const netMargins = selectedIncome.map((inc, i) => {
          const revenue = inc.revenue;
          if (!revenue || revenue <= 0) return null;
          const margin = inc.netIncome / revenue;
          return isFinite(margin) ? margin : null;
        });
        const avgNetMargin = avg(netMargins);

        // Asset Turnover = revenue / totalAssets (skip si totalAssets <=0)
        const assetTurnovers = selectedIncome.map((inc, i) => {
          const totalAssets = selectedBalance[i]?.totalAssets;
          if (!totalAssets || totalAssets <= 0) return null;
          const turnover = inc.revenue / totalAssets;
          return isFinite(turnover) ? turnover : null;
        });
        const avgAssetTurnover = avg(assetTurnovers);

        // Leverage = totalAssets / equity (skip si equity <=0)
        const leverages = selectedBalance.map((bal, i) => {
          const equity = bal.totalStockholdersEquity;
          if (!equity || equity <= 0) return null;
          const leverage = bal.totalAssets / equity;
          return isFinite(leverage) ? leverage : null;
        });
        const avgLeverage = avg(leverages);

        // ROIC = NOPAT / Invested Capital (positivizado, skip si investedCapital <=0)
        const roics = selectedIncome.map((inc, i) => {
          const bal = selectedBalance[i];
          const taxRate = inc.incomeBeforeTax !== 0 ? (inc.incomeTaxExpense / inc.incomeBeforeTax) : 0.21;
          const nopat = inc.operatingIncome * (1 - taxRate);
          const investedCapital = bal.totalAssets - (bal.totalCurrentLiabilities ?? 0);
          if (investedCapital <= 0) return 0;
          const roic = nopat / investedCapital;
          return Math.max(roic, 0); // Si negativo, 0
        }).filter(r => isFinite(r));
        const avgROIC = roics.length > 0 ? roics.reduce((a, b) => a + b, 0) / roics.length : null;

        // Annual SGR = ROIC_t * (1 - payout_t)
        const annualSGRs = selectedIncome.map((inc, i) => {
          const dividends = getDividendsPaid(selectedCashFlow[i]);
          const payout = dividends > 0 ? dividends / (inc.netIncome || 1) : 0;
          const roic = roics[i] ?? 0;
          const sgr = roic * (1 - payout);
          return isFinite(sgr) ? sgr : null;
        });
        const avgAnnualSGR = avg(annualSGRs);

        // Marginal ROIC = ΔNOPAT / ΔIC (positivizado, skip si |deltaIC| pequeño)
        let marginalROIC: number | null = null;
        if (selectedIncome.length > 1) {
          const deltas: number[] = [];
          for (let i = 1; i < selectedIncome.length; i++) {
            const taxRateCurr = selectedIncome[i].incomeBeforeTax !== 0 ? (selectedIncome[i].incomeTaxExpense / selectedIncome[i].incomeBeforeTax) : 0.21;
            const nopatCurr = selectedIncome[i].operatingIncome * (1 - taxRateCurr);
            const taxRatePrev = selectedIncome[i-1].incomeBeforeTax !== 0 ? (selectedIncome[i-1].incomeTaxExpense / selectedIncome[i-1].incomeBeforeTax) : 0.21;
            const nopatPrev = selectedIncome[i-1].operatingIncome * (1 - taxRatePrev);
            const deltaNOPAT = nopatCurr - nopatPrev;

            const icCurr = selectedBalance[i].totalAssets - (selectedBalance[i].totalCurrentLiabilities ?? 0);
            const icPrev = selectedBalance[i-1].totalAssets - (selectedBalance[i-1].totalCurrentLiabilities ?? 0);
            const deltaIC = icCurr - icPrev;

            if (Math.abs(deltaIC) < avgAssets * 0.01 || !isFinite(deltaNOPAT / deltaIC)) continue;
            const marginal = deltaNOPAT / deltaIC;
            deltas.push(Math.max(marginal, 0));
          }
          marginalROIC = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
        }

        // Calcular métodos, set null si inválido
        const sgrClassic = avgROE !== null ? avgROE * (1 - avgPayout) : null;
        const sgrROIC = avgROIC !== null ? avgROIC * (1 - avgPayout) : null;
        const sgrDupont = avgNetMargin !== null && avgAssetTurnover !== null && avgLeverage !== null ? (avgNetMargin * avgAssetTurnover * avgLeverage) * (1 - avgPayout) : null;
        const sgrMarginal = marginalROIC !== null ? marginalROIC * (1 - avgPayout) : null;
        let sgrAdjusted = null;
        if (avgROIC !== null) {
          const base = avgROIC * (1 - avgPayout);
          const denom = 1 - (base / wacc);
          if (denom > 0 && isFinite(base / denom)) {
            sgrAdjusted = base / denom;
          }
        }

        const calculatedMethods: SGRMethod[] = [
          {
            name: 'SGR Clásico',
            value: sgrClassic,
            enabled: true,
          },
          {
            name: 'SGR Histórico Promedio',
            value: sgrClassic, // mismo que clásico
            enabled: true,
          },
          {
            name: 'SGR Retención Total',
            value: avgROE,
            enabled: true,
          },
          {
            name: 'SGR Basado en ROIC',
            value: sgrROIC,
            enabled: true,
          },
          {
            name: 'SGR Anual Promediado',
            value: avgAnnualSGR,
            enabled: true,
          },
          {
            name: 'SGR DuPont Simplificada',
            value: sgrDupont,
            enabled: true,
          },
          {
            name: 'SGR ROIC Marginal',
            value: sgrMarginal,
            enabled: true,
          },
          {
            name: 'SGR Ajustada por Deuda/WACC',
            value: sgrAdjusted,
            enabled: true,
          },
        ];

        setMethods(calculatedMethods);

        // Logging para debug (quitar en prod)
        console.log('Selected Income:', selectedIncome);
        console.log('Selected Balance:', selectedBalance);
        console.log('Selected CashFlow:', selectedCashFlow);
        console.log('Avg ROE:', avgROE);
        console.log('Avg Payout:', avgPayout);
        console.log('Avg ROIC:', avgROIC);
        console.log('Marginal ROIC:', marginalROIC);

      } catch (err: any) {
        setError(err.message || 'Error al calcular');
      } finally {
        setLoading(false);
      }
    };

    calculate();
  }, [years, waccPercent, income, balance, cashFlow, estimates]);

  const toggleMethod = (index: number) => {
    setMethods(prev =>
      prev.map((m, i) => i === index ? { ...m, enabled: !m.enabled } : m)
    );
  };

  const activeMethods = methods.filter(m => m.enabled && m.value !== null);
  const averageSGR = activeMethods.length > 0
    ? activeMethods.reduce((sum, m) => sum + (m.value || 0), 0) / activeMethods.length
    : null;

  if (loading) return <p className="text-xl text-gray-300 py-10 text-center">Calculando SGR...</p>;
  if (error) return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;

  return (
    <div className="space-y-10">
      <h3 className="text-3xl font-bold text-gray-100">
        Sustainable Growth Rates de la empresa
      </h3>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Período histórico (años)</label>
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg focus:border-blue-400 focus:ring-blue-400 bg-gray-800 text-gray-100 text-lg"
          >
            {Array.from({ length: 9 }, (_, i) => i + 2).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">WACC (%)</label>
          <input
            type="number"
            step="0.1"
            value={waccPercent}
            onChange={(e) => setWaccPercent(parseFloat(e.target.value) || 8.5)}
            className="w-full px-4 py-3 border border-gray-600 rounded-lg focus:border-blue-400 focus:ring-blue-400 bg-gray-800 text-gray-100 text-lg"
            placeholder="8.5"
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
              {method.value !== null ? (method.value * 100).toFixed(2) + '%' : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Promedio */}
      <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl text-center mt-12">
        <h4 className="text-3xl font-bold text-gray-100 mb-4">
          Promedio de SGR seleccionadas
        </h4>
        <p className="text-7xl font-black text-blue-400 tracking-tight">
          {averageSGR !== null ? (averageSGR * 100).toFixed(2) + '%' : '—'}
        </p>
        <p className="text-xl text-blue-300 mt-4">
          (basado en {activeMethods.length} métodos activos)
        </p>
      </div>

      <p className="text-sm text-gray-500 text-center italic">
        Cambia valores para recalcular.
      </p>
    </div>
  );
}