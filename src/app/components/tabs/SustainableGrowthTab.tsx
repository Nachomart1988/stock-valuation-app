// src/app/components/tabs/SustainableGrowthTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';

interface SGRMethod {
  name: string;
  value: number | null;
  enabled: boolean;
  formula: string;
  inputs: { label: string; value: string }[];
  category: 'topdown' | 'bottomup' | 'classic' | 'advanced' | 'analyst';
}

interface SustainableGrowthTabProps {
  income: any[];
  balance: any[];
  cashFlow: any[];
  cashFlowAsReported?: any[];
  estimates: any[];
  dcfCustom?: any;
  calculatedWacc?: number;
  profile?: any;
}

export default function SustainableGrowthTab({
  income,
  balance,
  cashFlow,
  cashFlowAsReported,
  estimates,
  dcfCustom,
  calculatedWacc,
  profile,
}: SustainableGrowthTabProps) {
  // Get WACC - API returns it already as percentage (e.g., 8.88 means 8.88%)
  const getDefaultWacc = () => {
    const waccValues: number[] = [];

    // WACC del Advance DCF - already in percentage form
    const advanceDcfWacc = dcfCustom?.wacc;
    if (advanceDcfWacc !== undefined && advanceDcfWacc !== null) {
      // API returns WACC as percentage (8.88 = 8.88%), no conversion needed
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
  const [waccPercent, setWaccPercent] = useState<number>(getDefaultWacc());
  const [methods, setMethods] = useState<SGRMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Calculated intermediate values for display
  const [intermediateValues, setIntermediateValues] = useState<any>({});

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

        // Sort ascending by date
        const sortedIncome = [...income].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const sortedBalance = [...balance].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Select last N years
        const selectedIncome = sortedIncome.slice(-years);
        const selectedBalance = sortedBalance.slice(-years);
        const selectedCashFlow = sortedCashFlow.slice(-years);

        // Helper functions
        const avg = (values: (number | null)[]) => {
          const valid = values.filter((v): v is number => v !== null && isFinite(v) && !isNaN(v));
          return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
        };

        const formatNumber = (num: number | null, decimals: number = 2) => {
          if (num === null || !isFinite(num)) return 'N/A';
          return num.toFixed(decimals);
        };

        const formatPercent = (num: number | null) => {
          if (num === null || !isFinite(num)) return 'N/A';
          return (num * 100).toFixed(2) + '%';
        };

        const formatMoney = (num: number | null) => {
          if (num === null || !isFinite(num)) return 'N/A';
          if (Math.abs(num) >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
          if (Math.abs(num) >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
          return '$' + num.toFixed(0);
        };

        // Get dividends - FIRST try from as-reported data (most accurate), then fallback
        const getDividendsPaid = (cf: any, cfDate?: string): number => {
          if (!cf) return 0;

          // Try to get from cashFlowAsReported first (most accurate source)
          if (cfDate && cashFlowAsReported && cashFlowAsReported.length > 0) {
            const cfYear = new Date(cfDate).getFullYear();
            // Find matching record by fiscal year (may be +1 due to fiscal year ending)
            const asReportedRecord = cashFlowAsReported.find((ar: any) =>
              ar.fiscalYear === cfYear || ar.fiscalYear === cfYear + 1
            );
            if (asReportedRecord?.data?.paymentsofdividends) {
              const dividends = asReportedRecord.data.paymentsofdividends;
              console.log(`[SGR] Found dividends from as-reported for ${cfYear}: $${(dividends / 1e9).toFixed(2)}B`);
              return dividends;
            }
          }

          // Fallback to regular cash flow fields
          return Math.abs(
            cf.dividendsPaid ||
            cf.paymentOfDividends ||
            cf.commonStockDividendsPaid ||
            cf.dividendsPaidOnCommonStock ||
            cf.dividendsCommonStock ||
            0
          );
        };

        // ═══════════════════════════════════════════════════════════════
        // Calculate all intermediate values
        // ═══════════════════════════════════════════════════════════════

        // Latest values
        const latestIncome = selectedIncome[selectedIncome.length - 1] || {};
        const latestBalance = selectedBalance[selectedBalance.length - 1] || {};
        const latestCashFlow = selectedCashFlow[selectedCashFlow.length - 1] || {};

        // Net Income
        const netIncomeValues = selectedIncome.map(inc => inc.netIncome);
        const avgNetIncome = avg(netIncomeValues);
        const latestNetIncome = latestIncome.netIncome || 0;

        // Equity
        const equityValues = selectedBalance.map(bal => bal.totalStockholdersEquity);
        const avgEquity = avg(equityValues.filter(e => e > 0));
        const latestEquity = latestBalance.totalStockholdersEquity || 0;

        // ROE = Net Income / Equity
        const roeValues = selectedIncome.map((inc, i) => {
          const equity = selectedBalance[i]?.totalStockholdersEquity;
          if (!equity || equity <= 0) return null;
          return inc.netIncome / equity;
        });
        const avgROE = avg(roeValues);
        const latestROE = latestEquity > 0 ? latestNetIncome / latestEquity : null;

        // Dividends - pass date for as-reported lookup
        const dividendValues = selectedCashFlow.map(cf => getDividendsPaid(cf, cf?.date));
        const avgDividends = avg(dividendValues);
        const latestDividends = getDividendsPaid(latestCashFlow, latestCashFlow?.date);

        console.log('[SGR] Dividend values:', dividendValues);
        console.log('[SGR] Latest dividends:', latestDividends, 'Latest Net Income:', latestNetIncome);

        // Payout Ratio = Dividends / Net Income
        const payoutValues = selectedIncome.map((inc, i) => {
          const cf = selectedCashFlow[i];
          const dividends = getDividendsPaid(cf, cf?.date);
          const netIncome = inc.netIncome;
          if (!netIncome || netIncome <= 0) return null;
          const payout = dividends / netIncome;
          return payout >= 0 && payout <= 2 ? payout : null;
        });
        const avgPayout = avg(payoutValues) ?? 0;
        const latestPayout = latestNetIncome > 0 ? latestDividends / latestNetIncome : 0;

        console.log('[SGR] Payout values:', payoutValues);
        console.log('[SGR] Avg Payout:', avgPayout, 'Latest Payout:', latestPayout);

        // Retention Ratio = 1 - Payout
        const avgRetention = 1 - avgPayout;
        const latestRetention = 1 - latestPayout;

        // Revenue
        const revenueValues = selectedIncome.map(inc => inc.revenue);
        const avgRevenue = avg(revenueValues);
        const latestRevenue = latestIncome.revenue || 0;

        // Net Margin = Net Income / Revenue
        const netMarginValues = selectedIncome.map(inc => {
          if (!inc.revenue || inc.revenue <= 0) return null;
          return inc.netIncome / inc.revenue;
        });
        const avgNetMargin = avg(netMarginValues);
        const latestNetMargin = latestRevenue > 0 ? latestNetIncome / latestRevenue : null;

        // Total Assets
        const assetValues = selectedBalance.map(bal => bal.totalAssets);
        const avgAssets = avg(assetValues.filter(a => a > 0));
        const latestAssets = latestBalance.totalAssets || 0;

        // Asset Turnover = Revenue / Assets
        const assetTurnoverValues = selectedIncome.map((inc, i) => {
          const assets = selectedBalance[i]?.totalAssets;
          if (!assets || assets <= 0) return null;
          return inc.revenue / assets;
        });
        const avgAssetTurnover = avg(assetTurnoverValues);
        const latestAssetTurnover = latestAssets > 0 ? latestRevenue / latestAssets : null;

        // Financial Leverage = Assets / Equity
        const leverageValues = selectedBalance.map(bal => {
          if (!bal.totalStockholdersEquity || bal.totalStockholdersEquity <= 0) return null;
          return bal.totalAssets / bal.totalStockholdersEquity;
        });
        const avgLeverage = avg(leverageValues);
        const latestLeverage = latestEquity > 0 ? latestAssets / latestEquity : null;

        // Operating Income and Tax Rate
        const taxRateValues = selectedIncome.map(inc => {
          if (!inc.incomeBeforeTax || inc.incomeBeforeTax <= 0) return 0.21;
          return Math.max(0, Math.min(0.5, inc.incomeTaxExpense / inc.incomeBeforeTax));
        });
        const avgTaxRate = avg(taxRateValues) ?? 0.21;
        const latestTaxRate = latestIncome.incomeBeforeTax > 0
          ? Math.max(0, Math.min(0.5, latestIncome.incomeTaxExpense / latestIncome.incomeBeforeTax))
          : 0.21;

        // NOPAT = Operating Income * (1 - Tax Rate)
        const nopatValues = selectedIncome.map((inc, i) => {
          const taxRate = taxRateValues[i] ?? 0.21;
          return (inc.operatingIncome || 0) * (1 - taxRate);
        });
        const avgNOPAT = avg(nopatValues);
        const latestNOPAT = (latestIncome.operatingIncome || 0) * (1 - latestTaxRate);

        // Invested Capital = Total Assets - Current Liabilities
        const investedCapitalValues = selectedBalance.map(bal => {
          return bal.totalAssets - (bal.totalCurrentLiabilities || 0);
        });
        const avgInvestedCapital = avg(investedCapitalValues.filter(ic => ic > 0));
        const latestInvestedCapital = latestAssets - (latestBalance.totalCurrentLiabilities || 0);

        // ROIC = NOPAT / Invested Capital
        const roicValues = selectedIncome.map((inc, i) => {
          const ic = investedCapitalValues[i];
          const nopat = nopatValues[i];
          if (!ic || ic <= 0) return null;
          return nopat / ic;
        });
        const avgROIC = avg(roicValues);
        const latestROIC = latestInvestedCapital > 0 ? latestNOPAT / latestInvestedCapital : null;

        // Marginal ROIC = ΔNOPAT / ΔInvested Capital
        let marginalROIC: number | null = null;
        let deltaNOPAT = 0;
        let deltaIC = 0;
        if (selectedIncome.length > 1) {
          const firstIdx = 0;
          const lastIdx = selectedIncome.length - 1;
          deltaNOPAT = nopatValues[lastIdx] - nopatValues[firstIdx];
          deltaIC = investedCapitalValues[lastIdx] - investedCapitalValues[firstIdx];
          if (Math.abs(deltaIC) > (avgAssets || 1) * 0.01) {
            marginalROIC = deltaNOPAT / deltaIC;
          }
        }

        // Revenue Growth (CAGR)
        let revenueCAGR: number | null = null;
        if (selectedIncome.length >= 2) {
          const firstRevenue = selectedIncome[0]?.revenue || 0;
          const lastRevenue = selectedIncome[selectedIncome.length - 1]?.revenue || 0;
          if (firstRevenue > 0 && lastRevenue > 0) {
            const periodsCount = selectedIncome.length - 1;
            revenueCAGR = Math.pow(lastRevenue / firstRevenue, 1 / periodsCount) - 1;
          }
        }

        // Analyst Estimates (if available)
        const sortedEstimates = estimates?.length > 0
          ? [...estimates].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          : [];
        const analystGrowthEstimate = sortedEstimates.length > 0
          ? sortedEstimates[sortedEstimates.length - 1]?.estimatedRevenueAvg
            ? (sortedEstimates[sortedEstimates.length - 1].estimatedRevenueAvg / latestRevenue - 1)
            : null
          : null;

        // Store intermediate values
        setIntermediateValues({
          avgROE, latestROE,
          avgPayout, latestPayout,
          avgRetention, latestRetention,
          avgNetMargin, latestNetMargin,
          avgAssetTurnover, latestAssetTurnover,
          avgLeverage, latestLeverage,
          avgROIC, latestROIC,
          avgNOPAT, latestNOPAT,
          avgInvestedCapital, latestInvestedCapital,
          avgTaxRate, latestTaxRate,
          marginalROIC, deltaNOPAT, deltaIC,
          revenueCAGR,
          analystGrowthEstimate,
          avgNetIncome, latestNetIncome,
          avgEquity, latestEquity,
          avgDividends, latestDividends,
          avgRevenue, latestRevenue,
          avgAssets, latestAssets,
          wacc,
        });

        // ═══════════════════════════════════════════════════════════════
        // Calculate SGR Methods
        // ═══════════════════════════════════════════════════════════════

        // 1. Classic SGR = ROE × Retention Ratio (using N-year averages)
        const sgrClassic = avgROE !== null ? avgROE * avgRetention : null;

        // 2. SGR Full Retention (ROE if 100% retained) - using averages
        const sgrFullRetention = avgROE;

        // 4. SGR ROIC-based = ROIC × Retention
        const sgrROIC = avgROIC !== null ? avgROIC * avgRetention : null;

        // 5. SGR DuPont = Net Margin × Asset Turnover × Leverage × Retention
        const sgrDupont = avgNetMargin !== null && avgAssetTurnover !== null && avgLeverage !== null
          ? avgNetMargin * avgAssetTurnover * avgLeverage * avgRetention
          : null;

        // 6. SGR Marginal ROIC
        const sgrMarginal = marginalROIC !== null ? marginalROIC * avgRetention : null;

        // 7. SGR Adjusted for Debt/WACC
        let sgrAdjusted: number | null = null;
        if (avgROIC !== null && wacc > 0) {
          const base = avgROIC * avgRetention;
          const denom = 1 - (base / wacc);
          if (denom > 0 && isFinite(base / denom)) {
            sgrAdjusted = base / denom;
          }
        }

        // 8. Revenue CAGR (historical growth)
        const sgrHistorical = revenueCAGR;

        const calculatedMethods: SGRMethod[] = [
          // Top-Down Analysis (main method) - using N-year averages
          {
            name: 'Top-Down (ROE × Retention)',
            value: sgrClassic,
            enabled: true,
            category: 'topdown',
            formula: `ROE × (1 - Payout Ratio) [Promedio ${years} años]`,
            inputs: [
              { label: `ROE Promedio (${years} años)`, value: formatPercent(avgROE) },
              { label: 'Payout Ratio Promedio', value: formatPercent(avgPayout) },
              { label: 'Retention Ratio Promedio', value: formatPercent(avgRetention) },
              { label: 'Net Income Promedio', value: formatMoney(avgNetIncome) },
              { label: 'Equity Promedio', value: formatMoney(avgEquity) },
            ],
          },
          // Bottom-Up Analysis (DuPont) - using N-year averages
          {
            name: 'Bottom-Up (DuPont)',
            value: sgrDupont,
            enabled: true,
            category: 'bottomup',
            formula: `Net Margin × Asset Turn × Leverage × Ret [Prom ${years}Y]`,
            inputs: [
              { label: `Net Margin Prom (${years}Y)`, value: formatPercent(avgNetMargin) },
              { label: 'Asset Turnover Prom', value: formatNumber(avgAssetTurnover) + 'x' },
              { label: 'Leverage Promedio', value: formatNumber(avgLeverage) + 'x' },
              { label: 'Retention Promedio', value: formatPercent(avgRetention) },
            ],
          },
          {
            name: 'SGR Retencion Total',
            value: sgrFullRetention,
            enabled: true,
            category: 'classic',
            formula: `ROE promedio (si 100% retenido) [${years}Y]`,
            inputs: [
              { label: `ROE Promedio (${years} años)`, value: formatPercent(avgROE) },
              { label: 'Supuesto', value: 'Payout = 0%' },
            ],
          },
          {
            name: 'SGR basado en ROIC',
            value: sgrROIC,
            enabled: true,
            category: 'advanced',
            formula: `ROIC × (1 - Payout) [Promedio ${years}Y]`,
            inputs: [
              { label: `ROIC Promedio (${years}Y)`, value: formatPercent(avgROIC) },
              { label: 'NOPAT Promedio', value: formatMoney(avgNOPAT) },
              { label: 'Invested Capital Prom', value: formatMoney(avgInvestedCapital) },
              { label: 'Retention Promedio', value: formatPercent(avgRetention) },
            ],
          },
          {
            name: 'SGR ROIC Marginal',
            value: sgrMarginal,
            enabled: true,
            category: 'advanced',
            formula: `(ΔNOPAT / ΔIC) × Retention [${years}Y]`,
            inputs: [
              { label: `ROIC Marginal (${years}Y)`, value: formatPercent(marginalROIC) },
              { label: `ΔNOPAT (${years}Y)`, value: formatMoney(deltaNOPAT) },
              { label: `ΔInvested Capital (${years}Y)`, value: formatMoney(deltaIC) },
              { label: 'Retention Promedio', value: formatPercent(avgRetention) },
            ],
          },
          {
            name: 'SGR Ajustada WACC',
            value: sgrAdjusted,
            enabled: true,
            category: 'advanced',
            formula: `g* = g / (1 - g/WACC) [${years}Y promedios]`,
            inputs: [
              { label: 'g base (ROIC×Ret) Prom', value: formatPercent(avgROIC !== null ? avgROIC * avgRetention : null) },
              { label: 'WACC', value: formatPercent(wacc) },
              { label: 'Factor Ajuste', value: formatNumber(avgROIC !== null ? 1 / (1 - (avgROIC * avgRetention) / wacc) : null) + 'x' },
            ],
          },
          {
            name: `CAGR Revenue (${years} años)`,
            value: sgrHistorical,
            enabled: true,
            category: 'analyst',
            formula: `(Rev_final / Rev_inicial)^(1/${years-1}) - 1`,
            inputs: [
              { label: 'Revenue Inicial', value: formatMoney(selectedIncome[0]?.revenue) },
              { label: 'Revenue Final', value: formatMoney(selectedIncome[selectedIncome.length - 1]?.revenue) },
              { label: 'Periodos', value: (selectedIncome.length - 1).toString() + ' años' },
            ],
          },
        ];

        setMethods(calculatedMethods);

      } catch (err: any) {
        console.error('SGR calculation error:', err);
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

  const activeMethods = methods.filter(m => m.enabled && m.value !== null && isFinite(m.value || 0));
  const averageSGR = activeMethods.length > 0
    ? activeMethods.reduce((sum, m) => sum + (m.value || 0), 0) / activeMethods.length
    : null;

  // Group methods by category
  const topdownMethods = methods.filter(m => m.category === 'topdown');
  const bottomupMethods = methods.filter(m => m.category === 'bottomup');
  const classicMethods = methods.filter(m => m.category === 'classic');
  const advancedMethods = methods.filter(m => m.category === 'advanced');
  const analystMethods = methods.filter(m => m.category === 'analyst');

  if (loading) return <p className="text-xl text-gray-300 py-10 text-center">Calculando SGR...</p>;
  if (error) return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;

  return (
    <div className="space-y-10">
      <h3 className="text-3xl font-bold text-gray-100">
        Sustainable Growth Rate Analysis
      </h3>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Periodo historico (anos)</label>
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
          <p className="text-xs text-gray-500 mt-1">
            Fuente: Advance DCF ({dcfCustom?.wacc?.toFixed(1) || 'N/A'}%) + WACC Tab ({calculatedWacc?.toFixed(1) || 'N/A'}%)
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          TOP-DOWN ANALYSIS (with checkbox to include in average)
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`bg-gradient-to-r from-blue-900/30 to-purple-900/30 p-6 rounded-xl border ${topdownMethods[0]?.enabled ? 'border-blue-500' : 'border-gray-600 opacity-60'}`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-2xl font-bold text-blue-400">Analisis Top-Down</h4>
          {topdownMethods[0] && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={topdownMethods[0].enabled}
                onChange={() => toggleMethod(methods.indexOf(topdownMethods[0]))}
                className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-600 rounded"
              />
              <span className="text-sm text-gray-300">Incluir en promedio</span>
            </label>
          )}
        </div>
        <p className="text-gray-400 mb-4">
          Partimos desde la rentabilidad total de la empresa (ROE) y vemos cuanto puede crecer reinvirtiendo sus ganancias.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-gray-800/50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-400">ROE Promedio</p>
            <p className="text-2xl font-bold text-blue-400">
              {intermediateValues.avgROE !== null ? (intermediateValues.avgROE * 100).toFixed(1) + '%' : 'N/A'}
            </p>
          </div>
          <div className="bg-gray-800/50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-400">× Retention</p>
            <p className="text-2xl font-bold text-purple-400">
              {intermediateValues.avgRetention !== null ? (intermediateValues.avgRetention * 100).toFixed(1) + '%' : 'N/A'}
            </p>
          </div>
          <div className="bg-gray-800/50 p-4 rounded-lg text-center">
            <p className="text-sm text-gray-400">=</p>
            <p className="text-sm text-gray-500">SGR Clasico</p>
          </div>
          <div className="bg-blue-900/50 p-4 rounded-lg text-center border border-blue-600">
            <p className="text-sm text-blue-300">SGR Top-Down</p>
            <p className="text-3xl font-bold text-blue-400">
              {intermediateValues.avgROE !== null
                ? ((intermediateValues.avgROE * intermediateValues.avgRetention) * 100).toFixed(1) + '%'
                : 'N/A'}
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Interpretacion: La empresa puede crecer {intermediateValues.avgROE !== null
            ? ((intermediateValues.avgROE * intermediateValues.avgRetention) * 100).toFixed(1)
            : '?'}% anual de forma sostenible sin aumentar su deuda ni emitir acciones.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          BOTTOM-UP ANALYSIS (DuPont) with checkbox
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`bg-gradient-to-r from-green-900/30 to-emerald-900/30 p-6 rounded-xl border ${bottomupMethods[0]?.enabled ? 'border-green-500' : 'border-gray-600 opacity-60'}`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-2xl font-bold text-green-400">Analisis Bottom-Up (DuPont Extendido)</h4>
          {bottomupMethods[0] && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bottomupMethods[0].enabled}
                onChange={() => toggleMethod(methods.indexOf(bottomupMethods[0]))}
                className="w-5 h-5 text-green-600 focus:ring-green-500 border-gray-600 rounded"
              />
              <span className="text-sm text-gray-300">Incluir en promedio</span>
            </label>
          )}
        </div>
        <p className="text-gray-400 mb-4">
          Descomponemos el crecimiento en sus componentes operativos para identificar drivers y areas de mejora.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div className="bg-gray-800/50 p-3 rounded-lg text-center">
            <p className="text-xs text-gray-400">Net Margin</p>
            <p className="text-xl font-bold text-green-400">
              {intermediateValues.avgNetMargin !== null ? (intermediateValues.avgNetMargin * 100).toFixed(1) + '%' : 'N/A'}
            </p>
            <p className="text-xs text-gray-500">Rentabilidad</p>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg text-center">
            <p className="text-xs text-gray-400">× Asset Turn</p>
            <p className="text-xl font-bold text-emerald-400">
              {intermediateValues.avgAssetTurnover !== null ? intermediateValues.avgAssetTurnover.toFixed(2) + 'x' : 'N/A'}
            </p>
            <p className="text-xs text-gray-500">Eficiencia</p>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg text-center">
            <p className="text-xs text-gray-400">× Leverage</p>
            <p className="text-xl font-bold text-teal-400">
              {intermediateValues.avgLeverage !== null ? intermediateValues.avgLeverage.toFixed(2) + 'x' : 'N/A'}
            </p>
            <p className="text-xs text-gray-500">Apalancamiento</p>
          </div>
          <div className="bg-gray-800/50 p-3 rounded-lg text-center">
            <p className="text-xs text-gray-400">× Retention</p>
            <p className="text-xl font-bold text-cyan-400">
              {intermediateValues.avgRetention !== null ? (intermediateValues.avgRetention * 100).toFixed(0) + '%' : 'N/A'}
            </p>
            <p className="text-xs text-gray-500">Reinversion</p>
          </div>
          <div className="bg-green-900/50 p-3 rounded-lg text-center border border-green-600">
            <p className="text-xs text-green-300">= SGR DuPont</p>
            <p className="text-2xl font-bold text-green-400">
              {intermediateValues.avgNetMargin !== null && intermediateValues.avgAssetTurnover !== null && intermediateValues.avgLeverage !== null
                ? ((intermediateValues.avgNetMargin * intermediateValues.avgAssetTurnover * intermediateValues.avgLeverage * intermediateValues.avgRetention) * 100).toFixed(1) + '%'
                : 'N/A'}
            </p>
          </div>
        </div>
        <div className="text-xs text-gray-500 space-y-1">
          <p>• Net Margin: Cuanto beneficio queda de cada dolar de ventas</p>
          <p>• Asset Turnover: Cuantas ventas genera cada dolar de activos</p>
          <p>• Leverage: Cuanto de los activos esta financiado con deuda vs equity</p>
          <p>• Retention: Porcentaje de ganancias reinvertidas (no pagadas como dividendo)</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          CLASSIC METHODS
          ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h4 className="text-xl font-semibold text-gray-200 mb-4">Metodos Clasicos</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {classicMethods.map((method, index) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ADVANCED METHODS
          ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h4 className="text-xl font-semibold text-gray-200 mb-4">Metodos Avanzados</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {advancedMethods.map((method, index) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          HISTORICAL/ANALYST METHODS
          ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h4 className="text-xl font-semibold text-gray-200 mb-4">Crecimiento Historico</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {analystMethods.map((method, index) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          AVERAGE SGR
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl text-center mt-12">
        <h4 className="text-3xl font-bold text-gray-100 mb-4">
          Promedio SGR Seleccionado
        </h4>
        <p className="text-7xl font-black text-blue-400 tracking-tight">
          {averageSGR !== null ? (averageSGR * 100).toFixed(2) + '%' : '—'}
        </p>
        <p className="text-xl text-blue-300 mt-4">
          (basado en {activeMethods.length} metodos activos)
        </p>

        {/* Comparison with WACC */}
        {averageSGR !== null && (
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="bg-gray-700 p-4 rounded-xl">
              <p className="text-sm text-gray-400">SGR Promedio</p>
              <p className="text-2xl font-bold text-blue-400">{(averageSGR * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-xl">
              <p className="text-sm text-gray-400">WACC</p>
              <p className="text-2xl font-bold text-purple-400">{waccPercent.toFixed(1)}%</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-xl">
              <p className="text-sm text-gray-400">Spread (SGR - WACC)</p>
              <p className={`text-2xl font-bold ${(averageSGR * 100) > waccPercent ? 'text-green-400' : 'text-red-400'}`}>
                {((averageSGR * 100) - waccPercent).toFixed(1)}%
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500 text-center italic">
        Desmarca metodos para excluirlos del promedio. Cada tarjeta muestra los inputs usados en el calculo.
      </p>
    </div>
  );
}

// MethodCard Component
function MethodCard({
  method,
  index,
  onToggle
}: {
  method: SGRMethod;
  index: number;
  onToggle: (index: number) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div
      className={`bg-gray-800 p-5 rounded-xl border shadow-sm transition-all ${
        method.enabled ? 'border-gray-700' : 'border-gray-800 opacity-50'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={method.enabled}
            onChange={() => onToggle(index)}
            className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-600 rounded cursor-pointer"
          />
          <h4 className="text-lg font-semibold text-gray-100">{method.name}</h4>
        </div>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-gray-400 hover:text-blue-400"
        >
          {showDetails ? 'Ocultar' : 'Ver inputs'}
        </button>
      </div>

      <p className="text-4xl font-bold text-blue-400 text-center mb-2">
        {method.value !== null && isFinite(method.value) ? (method.value * 100).toFixed(2) + '%' : '—'}
      </p>

      <p className="text-xs text-gray-500 text-center mb-2 font-mono">
        {method.formula}
      </p>

      {showDetails && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-1">
          {method.inputs.map((input, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-gray-400">{input.label}:</span>
              <span className="text-gray-200 font-mono">{input.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
