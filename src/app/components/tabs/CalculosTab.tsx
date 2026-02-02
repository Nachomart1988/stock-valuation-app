// src/app/components/tabs/CalculosTab.tsx
'use client';

import { useEffect, useState } from 'react';

type Projection = {
  year: number;
  revenue: number;
  revenueGrowth: number;
  ebitda: number;
  ebitdaMargin: number;
  depreciation: number;
  netOpProfitAfterTax: number;
  capex: number;
  incrementalWC: number;
  unleveredFCF: number;
  discountFactor: number;
  discountedFCF: number;
};

export default function CalculosTab({
  ticker,
  quote,
  profile,
  income,
  balance,
  cashFlow,
}: {
  ticker: string;
  quote: any;
  profile: any;
  income: any[];
  balance: any[];
  cashFlow: any[];
}) {
  const [calculations, setCalculations] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!income.length || !balance.length || !cashFlow.length) {
      setLoading(false);
      return;
    }

    const baseYear = 2024; // Año corriente
    const yearsBack = 3; // 3 años atrás (2021-2023)
    const yearsForward = 3; // 3 años adelante (2025-2027)

    const discountRate = 0.12; // 12%
    const exitMultiple = 24.2; // EV/EBITDA exit multiple

    // Ordenar arrays por fecha descendente
    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const projections = [];

    let cumulativeDiscountedFCF = 0;

    // Años pasados (2021-2023)
    for (let yearOffset = -yearsBack; yearOffset < 0; yearOffset++) {
      const year = baseYear + yearOffset;
      const index = -yearOffset; // 1 para 2023, 2 para 2022, 3 para 2021

      const inc = sortedIncome[index] || {};
      const bal = sortedBalance[index] || {};
      const cf = sortedCashFlow[index] || {};

      const revenue = inc.revenue || 0;
      const revenueGrowth = 0; // No calculado para pasado
      const ebitda = inc.ebitda || 0;
      const ebitdaMargin = revenue ? (ebitda / revenue) * 100 : 0;
      const depreciation = inc.depreciationAndAmortization || 0;
      const netOpProfitAfterTax = inc.netIncome || 0;
      const capex = cf.capitalExpenditure || 0;
      const incrementalWC = 0; // Placeholder, calcular si tenés datos previos

      const unleveredFCF = netOpProfitAfterTax + depreciation - capex - incrementalWC;

      const discountFactor = 1; // Para pasado, no se descuenta

      const discountedFCF = unleveredFCF * discountFactor;
      cumulativeDiscountedFCF += discountedFCF;

      projections.push({
        year,
        revenue,
        revenueGrowth,
        ebitda,
        ebitdaMargin,
        depreciation,
        netOpProfitAfterTax,
        capex,
        incrementalWC,
        unleveredFCF,
        discountFactor,
        discountedFCF,
      });
    }

    // Año corriente (2024)
    const recentIncome = sortedIncome[0] || {};
    const recentBalance = sortedBalance[0] || {};
    const recentCashFlow = sortedCashFlow[0] || {};

    const revenue2024 = recentIncome.revenue || 0;
    const revenueGrowth2024 = 0; // No calculado
    const ebitda2024 = recentIncome.ebitda || 0;
    const ebitdaMargin2024 = revenue2024 ? (ebitda2024 / revenue2024) * 100 : 0;
    const depreciation2024 = recentIncome.depreciationAndAmortization || 0;
    const netOpProfitAfterTax2024 = recentIncome.netIncome || 0;
    const capex2024 = recentCashFlow.capitalExpenditure || 0;
    const incrementalWC2024 = 0; // Placeholder

    const unleveredFCF2024 = netOpProfitAfterTax2024 + depreciation2024 - capex2024 - incrementalWC2024;

    const discountFactor2024 = 1;

    const discountedFCF2024 = unleveredFCF2024 * discountFactor2024;
    cumulativeDiscountedFCF += discountedFCF2024;

    projections.push({
      year: baseYear,
      revenue: revenue2024,
      revenueGrowth: revenueGrowth2024,
      ebitda: ebitda2024,
      ebitdaMargin: ebitdaMargin2024,
      depreciation: depreciation2024,
      netOpProfitAfterTax: netOpProfitAfterTax2024,
      capex: capex2024,
      incrementalWC: incrementalWC2024,
      unleveredFCF: unleveredFCF2024,
      discountFactor: discountFactor2024,
      discountedFCF: discountedFCF2024,
    });

    // Años futuros (2025-2027)
    let lastRevenue = revenue2024;
    let lastEbitda = ebitda2024;
    const growthRate = 0.165; // 16.5%
    const ebitdaMargin = 0.173; // 17.3%

    for (let yearOffset = 1; yearOffset <= yearsForward; yearOffset++) {
      const year = baseYear + yearOffset;

      const revenue = lastRevenue * (1 + growthRate);
      const ebitda = revenue * ebitdaMargin;
      const depreciation = 0; // Asumido 0 como en tu Excel
      const netOpProfitAfterTax = ebitda * 0.8; // Asumiendo tax 20%
      const capex = -86255398.40; // Constante
      const incrementalWC = -19727152.4 * Math.pow(1.1, yearOffset - 1); // Crecimiento aproximado

      const unleveredFCF = netOpProfitAfterTax + depreciation - capex - incrementalWC;

      const discountFactor = 1 / Math.pow(1 + discountRate, yearOffset);

      const discountedFCF = unleveredFCF * discountFactor;
      cumulativeDiscountedFCF += discountedFCF;

      projections.push({
        year,
        revenue,
        revenueGrowth: growthRate * 100,
        ebitda,
        ebitdaMargin: ebitdaMargin * 100,
        depreciation,
        netOpProfitAfterTax,
        capex,
        incrementalWC,
        unleveredFCF,
        discountFactor,
        discountedFCF,
      });

      lastRevenue = revenue;
      lastEbitda = ebitda;
    }

    // Terminal Value
    const terminalEBITDA = projections[projections.length - 1].ebitda;
    const terminalValue = terminalEBITDA * exitMultiple;
    const pvTerminalValue = terminalValue * projections[projections.length - 1].discountFactor;

    // Total PV
    const totalPV = cumulativeDiscountedFCF + pvTerminalValue;

    // Shares Outstanding, Current Price, Current EV
    const sharesOutstanding = quote.sharesOutstanding || 44045600;
    const currentPrice = quote.price || 66.46;
    const totalDebt = recentBalance.totalDebt || 0;
    const cashAndSTInvestments = recentBalance.cashAndShortTermInvestments || 0;
    const currentEV = quote.marketCap + totalDebt - cashAndSTInvestments;

    const impliedEquityValue = totalPV - totalDebt + cashAndSTInvestments;
    const impliedValuePerShare = impliedEquityValue / sharesOutstanding;
    const premium = ((impliedValuePerShare / currentPrice) - 1) * 100;

    setCalculations({
      projections,
      terminalValue,
      pvTerminalValue,
      totalPV,
      cumulativeDiscountedFCF,
      sharesOutstanding,
      currentPrice,
      totalDebt,
      cashAndSTInvestments,
      currentEV,
      impliedEquityValue,
      impliedValuePerShare,
      premium,
    });

    setLoading(false);
  }, [ticker, quote, profile, income, balance, cashFlow]);

  if (loading) {
    return <p className="text-xl text-gray-400 py-10 text-center">Calculando valoración...</p>;
  }

  const { projections, terminalValue, pvTerminalValue, totalPV, cumulativeDiscountedFCF, sharesOutstanding, currentPrice, totalDebt, cashAndSTInvestments, currentEV, impliedEquityValue, impliedValuePerShare, premium } = calculations;

  return (
    <div className="space-y-10">
      <h3 className="text-3xl font-bold text-gray-100">
        Cálculos para {ticker}
      </h3>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-6 py-4 text-left text-gray-200 font-bold sticky left-0 bg-gray-800 z-10 min-w-55">
                Free Cash Flow Calculation:
              </th>
              {projections.map((p: Projection) => (
                <th key={p.year} className="px-6 py-4 text-center text-gray-200 font-bold min-w-35">
                  {p.year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Total Revenue
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.revenue ? `$${(p.revenue / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Total Revenue Growth Rate
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.revenueGrowth ? `${p.revenueGrowth.toFixed(1)}%` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EBITDA
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.ebitda ? `$${(p.ebitda / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                EBITDA Margin
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.ebitdaMargin ? `${p.ebitdaMargin.toFixed(1)}%` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Depreciation & Amortization
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.depreciation ? `$${(p.depreciation / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Net Operating Profit After-Tax (1)
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.netOpProfitAfterTax ? `$${(p.netOpProfitAfterTax / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Plus: Depreciation & Amortization
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.depreciation ? `$${(p.depreciation / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Less: Capital Expenditure
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.capex ? `$${(p.capex / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Less: Incremental Working Capital
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.incrementalWC ? `$${(p.incrementalWC / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Unlevered Free Cash Flow
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.unleveredFCF ? `$${(p.unleveredFCF / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Discount Rate
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.discountFactor ? '12.0%' : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Discount Factor
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.discountFactor ? p.discountFactor.toFixed(2) : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-gray-800">
              <td className="px-6 py-4 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700 text-gray-300">
                Discounted Free Cash Flow
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className="px-6 py-4 text-right text-gray-300">
                  {p.discountedFCF ? `$${(p.discountedFCF / 1e9).toFixed(2)}B` : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* PV Calculation */}
      <div className="mt-12 overflow-x-auto">
        <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-6 py-4 text-left text-gray-200 font-bold">PV Calculation w/ EV/EBITDA Exit Multiple</th>
              <th className="px-6 py-4 text-center text-gray-200 font-bold">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Projected 2027 EBITDA</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {projections.find((p: Projection) => p.year === 2027)?.ebitda ? `$${(projections.find((p: Projection) => p.year === 2027)!.ebitda / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Selected TTM Multiple</td>
              <td className="px-6 py-4 text-right text-gray-300">24.2x</td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Discount Factor</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {projections.find((p: { year: number; }) => p.year === 2027)?.discountFactor?.toFixed(2) || '—'}
            
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Implied Terminal Value</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {terminalValue ? `$${(terminalValue / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Sum of Discounted Cash Flows</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {cumulativeDiscountedFCF ? `$${(cumulativeDiscountedFCF / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Total Enterprise Valuation</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {totalPV ? `$${(totalPV / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Less: Total Debt</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {totalDebt ? `$${(totalDebt / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 text-gray-300 font-medium">Plus: Cash & ST Investments</td>
              <td className="px-6 py-4 text-right text-gray-300">
                {cashAndSTInvestments ? `$${(cashAndSTInvestments / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 font-medium text-gray-100">Total Equity Valuation</td>
              <td className="px-6 py-4 text-right font-bold text-green-400">
                {impliedEquityValue ? `$${(impliedEquityValue / 1e9).toFixed(2)}B` : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 font-medium text-gray-100">Implied Value Per Share</td>
              <td className="px-6 py-4 text-right font-bold text-green-400">
                {impliedValuePerShare ? impliedValuePerShare.toFixed(2) : '—'}
              </td>
            </tr>
            <tr>
              <td className="px-6 py-4 font-medium text-gray-100">Premium to Current Stock Price</td>
              <td className="px-6 py-4 text-right font-bold text-green-400">
                {premium ? `${premium.toFixed(1)}%` : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-sm text-gray-500 text-center mt-6">
        Cálculos basados en datos de FMP • Discount Rate: 12% • Exit Multiple: 24.2x
      </p>
    </div>
  );
}