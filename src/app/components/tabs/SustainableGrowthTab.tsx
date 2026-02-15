// src/app/components/tabs/SustainableGrowthTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';

interface SGRMethod {
  name: string;
  value: number | null;
  enabled: boolean;
  formula: string;
  inputs: { label: string; value: string }[];
  category: 'topdown' | 'bottomup' | 'roe' | 'roic' | 'retention' | 'historical';
}

interface SustainableGrowthTabProps {
  ticker: string;
  income: any[];
  balance: any[];
  cashFlow: any[];
  cashFlowAsReported?: any[];
  estimates: any[];
  dcfCustom?: any;
  calculatedWacc?: number;
  profile?: any;
  onSGRChange?: (sgr: number | null) => void;
}

export default function SustainableGrowthTab({
  ticker,
  income,
  balance,
  cashFlow,
  cashFlowAsReported,
  estimates,
  dcfCustom,
  calculatedWacc,
  profile,
  onSGRChange,
}: SustainableGrowthTabProps) {
  // Get WACC - API returns it already as percentage (e.g., 8.88 means 8.88%)
  const getDefaultWacc = () => {
    const waccValues: number[] = [];

    // WACC del Advance DCF - already in percentage form
    const advanceDcfWacc = dcfCustom?.wacc;
    if (advanceDcfWacc !== undefined && advanceDcfWacc !== null) {
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
            const asReportedRecord = cashFlowAsReported.find((ar: any) =>
              ar.fiscalYear === cfYear || ar.fiscalYear === cfYear + 1
            );
            if (asReportedRecord?.data?.paymentsofdividends) {
              return asReportedRecord.data.paymentsofdividends;
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
        // Calculate all intermediate values per year
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

        // ROE per year = Net Income / Equity
        const roePerYear = selectedIncome.map((inc, i) => {
          const equity = selectedBalance[i]?.totalStockholdersEquity;
          if (!equity || equity <= 0) return null;
          return inc.netIncome / equity;
        });
        const avgROE = avg(roePerYear);

        // Dividends per year
        const dividendValues = selectedCashFlow.map(cf => getDividendsPaid(cf, cf?.date));
        const avgDividends = avg(dividendValues);

        // Retention Ratio per year = 1 - (Dividends / Net Income)
        const retentionPerYear = selectedIncome.map((inc, i) => {
          const cf = selectedCashFlow[i];
          const dividends = getDividendsPaid(cf, cf?.date);
          const netIncome = inc.netIncome;
          if (!netIncome || netIncome <= 0) return null;
          const payout = dividends / netIncome;
          if (payout < 0 || payout > 2) return null;
          return 1 - payout;
        });
        const avgRetention = avg(retentionPerYear);

        // Payout for display
        const avgPayout = avgRetention !== null ? 1 - avgRetention : null;

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

        // Financial Leverage = Assets / Equity
        const leverageValues = selectedBalance.map(bal => {
          if (!bal.totalStockholdersEquity || bal.totalStockholdersEquity <= 0) return null;
          return bal.totalAssets / bal.totalStockholdersEquity;
        });
        const avgLeverage = avg(leverageValues);

        // Tax Rate per year
        const taxRateValues = selectedIncome.map(inc => {
          if (!inc.incomeBeforeTax || inc.incomeBeforeTax <= 0) return 0.21;
          return Math.max(0, Math.min(0.5, inc.incomeTaxExpense / inc.incomeBeforeTax));
        });
        const avgTaxRate = avg(taxRateValues) ?? 0.21;

        // NOPAT per year = Operating Income * (1 - Tax Rate)
        const nopatPerYear = selectedIncome.map((inc, i) => {
          const taxRate = taxRateValues[i] ?? 0.21;
          return (inc.operatingIncome || 0) * (1 - taxRate);
        });
        const avgNOPAT = avg(nopatPerYear);

        // Invested Capital per year = Total Assets - Current Liabilities
        const investedCapitalPerYear = selectedBalance.map(bal => {
          return bal.totalAssets - (bal.totalCurrentLiabilities || 0);
        });
        const avgInvestedCapital = avg(investedCapitalPerYear.filter(ic => ic > 0));

        // ROIC per year = NOPAT / Invested Capital
        const roicPerYear = selectedIncome.map((inc, i) => {
          const ic = investedCapitalPerYear[i];
          const nopat = nopatPerYear[i];
          if (!ic || ic <= 0) return null;
          return nopat / ic;
        });
        const avgROIC = avg(roicPerYear);

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

        // ═══════════════════════════════════════════════════════════════
        // NEW SGR CALCULATIONS
        // ═══════════════════════════════════════════════════════════════

        // A) ROE Methods
        // Method 1: Avg RR × Avg ROE
        const sgrRoeMethod1 = (avgRetention !== null && avgROE !== null)
          ? avgRetention * avgROE
          : null;

        // Method 2: Avg(RR_year × ROE_year) - year by year calculation
        const roeTimesRetentionPerYear = selectedIncome.map((_, i) => {
          const roe = roePerYear[i];
          const rr = retentionPerYear[i];
          if (roe === null || rr === null) return null;
          return roe * rr;
        });
        const sgrRoeMethod2 = avg(roeTimesRetentionPerYear);

        // B) ROIC Methods
        // Method 1: Avg RR × Avg ROIC
        const sgrRoicMethod1 = (avgRetention !== null && avgROIC !== null)
          ? avgRetention * avgROIC
          : null;

        // Method 2: Avg(RR_year × ROIC_year) - year by year calculation
        const roicTimesRetentionPerYear = selectedIncome.map((_, i) => {
          const roic = roicPerYear[i];
          const rr = retentionPerYear[i];
          if (roic === null || rr === null) return null;
          return roic * rr;
        });
        const sgrRoicMethod2 = avg(roicTimesRetentionPerYear);

        // SGR Full Retention (if 100% retained)
        const sgrFullRetentionROE = avgROE;
        const sgrFullRetentionROIC = avgROIC;

        // DuPont = Net Margin × Asset Turnover × Leverage × Retention
        const sgrDupont = avgNetMargin !== null && avgAssetTurnover !== null && avgLeverage !== null && avgRetention !== null
          ? avgNetMargin * avgAssetTurnover * avgLeverage * avgRetention
          : null;

        // Historical CAGR
        const sgrHistorical = revenueCAGR;

        // Store intermediate values
        setIntermediateValues({
          avgROE,
          avgPayout,
          avgRetention,
          avgNetMargin,
          avgAssetTurnover,
          avgLeverage,
          avgROIC,
          avgNOPAT,
          avgInvestedCapital,
          avgTaxRate,
          revenueCAGR,
          avgNetIncome,
          avgEquity,
          avgDividends,
          avgRevenue,
          avgAssets,
          wacc,
          roePerYear,
          roicPerYear,
          retentionPerYear,
          roeTimesRetentionPerYear,
          roicTimesRetentionPerYear,
          years: selectedIncome.length,
        });

        // ═══════════════════════════════════════════════════════════════
        // Build Methods Array
        // ═══════════════════════════════════════════════════════════════

        const calculatedMethods: SGRMethod[] = [
          // Top-Down Analysis (DuPont breakdown for context)
          {
            name: 'Top-Down (ROE × Retention)',
            value: sgrRoeMethod1,
            enabled: true,
            category: 'topdown',
            formula: `Avg RR × Avg ROE [${years}Y]`,
            inputs: [
              { label: `ROE Promedio (${years}Y)`, value: formatPercent(avgROE) },
              { label: 'Retention Promedio', value: formatPercent(avgRetention) },
              { label: 'Net Income Prom', value: formatMoney(avgNetIncome) },
              { label: 'Equity Promedio', value: formatMoney(avgEquity) },
            ],
          },
          // Bottom-Up Analysis (DuPont)
          {
            name: 'Bottom-Up (DuPont)',
            value: sgrDupont,
            enabled: true,
            category: 'bottomup',
            formula: `Margin × Turn × Leverage × Ret [${years}Y]`,
            inputs: [
              { label: 'Net Margin Prom', value: formatPercent(avgNetMargin) },
              { label: 'Asset Turnover', value: formatNumber(avgAssetTurnover) + 'x' },
              { label: 'Leverage Prom', value: formatNumber(avgLeverage) + 'x' },
              { label: 'Retention Prom', value: formatPercent(avgRetention) },
            ],
          },
          // ROE Method 1: Avg RR × Avg ROE
          {
            name: 'ROE: Avg(RR) × Avg(ROE)',
            value: sgrRoeMethod1,
            enabled: true,
            category: 'roe',
            formula: `Promedio RR × Promedio ROE [${years}Y]`,
            inputs: [
              { label: `Avg Retention (${years}Y)`, value: formatPercent(avgRetention) },
              { label: `Avg ROE (${years}Y)`, value: formatPercent(avgROE) },
              { label: 'Net Income Prom', value: formatMoney(avgNetIncome) },
              { label: 'Equity Promedio', value: formatMoney(avgEquity) },
            ],
          },
          // ROE Method 2: Avg(RR_year × ROE_year)
          {
            name: 'ROE: Avg(RR×ROE) año a año',
            value: sgrRoeMethod2,
            enabled: true,
            category: 'roe',
            formula: `Avg(RR_i × ROE_i) para i=1..${years}`,
            inputs: roeTimesRetentionPerYear.map((val, i) => ({
              label: `Año ${i + 1}: RR×ROE`,
              value: formatPercent(val),
            })),
          },
          // ROIC Method 1: Avg RR × Avg ROIC
          {
            name: 'ROIC: Avg(RR) × Avg(ROIC)',
            value: sgrRoicMethod1,
            enabled: true,
            category: 'roic',
            formula: `Promedio RR × Promedio ROIC [${years}Y]`,
            inputs: [
              { label: `Avg Retention (${years}Y)`, value: formatPercent(avgRetention) },
              { label: `Avg ROIC (${years}Y)`, value: formatPercent(avgROIC) },
              { label: 'NOPAT Promedio', value: formatMoney(avgNOPAT) },
              { label: 'Invested Capital Prom', value: formatMoney(avgInvestedCapital) },
            ],
          },
          // ROIC Method 2: Avg(RR_year × ROIC_year)
          {
            name: 'ROIC: Avg(RR×ROIC) año a año',
            value: sgrRoicMethod2,
            enabled: true,
            category: 'roic',
            formula: `Avg(RR_i × ROIC_i) para i=1..${years}`,
            inputs: roicTimesRetentionPerYear.map((val, i) => ({
              label: `Año ${i + 1}: RR×ROIC`,
              value: formatPercent(val),
            })),
          },
          // Full Retention ROE
          {
            name: 'SGR Ret. Total (ROE)',
            value: sgrFullRetentionROE,
            enabled: true,
            category: 'retention',
            formula: `ROE promedio si Payout=0% [${years}Y]`,
            inputs: [
              { label: `ROE Promedio (${years}Y)`, value: formatPercent(avgROE) },
              { label: 'Supuesto', value: 'Payout = 0%' },
            ],
          },
          // Full Retention ROIC
          {
            name: 'SGR Ret. Total (ROIC)',
            value: sgrFullRetentionROIC,
            enabled: true,
            category: 'retention',
            formula: `ROIC promedio si Payout=0% [${years}Y]`,
            inputs: [
              { label: `ROIC Promedio (${years}Y)`, value: formatPercent(avgROIC) },
              { label: 'Supuesto', value: 'Payout = 0%' },
            ],
          },
          // Historical CAGR
          {
            name: `CAGR Revenue (${years}Y)`,
            value: sgrHistorical,
            enabled: true,
            category: 'historical',
            formula: `(Rev_final / Rev_inicial)^(1/${years - 1}) - 1`,
            inputs: [
              { label: 'Revenue Inicial', value: formatMoney(selectedIncome[0]?.revenue) },
              { label: 'Revenue Final', value: formatMoney(selectedIncome[selectedIncome.length - 1]?.revenue) },
              { label: 'Períodos', value: (selectedIncome.length - 1).toString() + ' años' },
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
  }, [years, waccPercent, income, balance, cashFlow, estimates, cashFlowAsReported]);

  const toggleMethod = (index: number) => {
    setMethods(prev =>
      prev.map((m, i) => i === index ? { ...m, enabled: !m.enabled } : m)
    );
  };

  const activeMethods = methods.filter(m => m.enabled && m.value !== null && isFinite(m.value || 0));
  const averageSGR = activeMethods.length > 0
    ? activeMethods.reduce((sum, m) => sum + (m.value || 0), 0) / activeMethods.length
    : null;

  // Notify parent of SGR change
  useEffect(() => {
    if (onSGRChange) {
      onSGRChange(averageSGR);
    }
  }, [averageSGR, onSGRChange]);

  // Group methods by category
  const topdownMethods = methods.filter(m => m.category === 'topdown');
  const bottomupMethods = methods.filter(m => m.category === 'bottomup');
  const roeMethods = methods.filter(m => m.category === 'roe');
  const roicMethods = methods.filter(m => m.category === 'roic');
  const retentionMethods = methods.filter(m => m.category === 'retention');
  const historicalMethods = methods.filter(m => m.category === 'historical');

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="relative">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-green-500 border-t-transparent"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-green-400">📈</span>
          </div>
        </div>
        <p className="text-xl text-gray-300">Calculando tasa de crecimiento sostenible...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-xl p-6 text-center">
        <p className="text-xl text-red-400">❌ Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            Sustainable Growth Rate
          </h3>
          <p className="text-sm text-gray-400 mt-1">Análisis de tasa de crecimiento sostenible para {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-green-900/40 to-emerald-900/40 px-4 py-2 rounded-xl border border-green-600">
            <p className="text-xs text-green-400">Avg SGR</p>
            <p className="text-xl font-bold text-green-400">
              {averageSGR !== null ? (averageSGR * 100).toFixed(2) + '%' : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Periodo histórico (años)</label>
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
          TOP-DOWN ANALYSIS
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`bg-gradient-to-r from-blue-900/30 to-purple-900/30 p-6 rounded-xl border ${topdownMethods[0]?.enabled ? 'border-blue-500' : 'border-gray-600 opacity-60'}`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-2xl font-bold text-blue-400">Análisis Top-Down</h4>
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
          Partimos desde la rentabilidad total de la empresa (ROE) y vemos cuánto puede crecer reinvirtiendo sus ganancias.
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
            <p className="text-sm text-gray-500">SGR Clásico</p>
          </div>
          <div className="bg-blue-900/50 p-4 rounded-lg text-center border border-blue-600">
            <p className="text-sm text-blue-300">SGR Top-Down</p>
            <p className="text-3xl font-bold text-blue-400">
              {topdownMethods[0]?.value !== null
                ? ((topdownMethods[0].value || 0) * 100).toFixed(1) + '%'
                : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          BOTTOM-UP ANALYSIS (DuPont)
          ═══════════════════════════════════════════════════════════════ */}
      <div className={`bg-gradient-to-r from-green-900/30 to-emerald-900/30 p-6 rounded-xl border ${bottomupMethods[0]?.enabled ? 'border-green-500' : 'border-gray-600 opacity-60'}`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-2xl font-bold text-green-400">Análisis Bottom-Up (DuPont Extendido)</h4>
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
          Descomponemos el crecimiento en sus componentes operativos para identificar drivers y áreas de mejora.
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
            <p className="text-xs text-gray-500">Reinversión</p>
          </div>
          <div className="bg-green-900/50 p-3 rounded-lg text-center border border-green-600">
            <p className="text-xs text-green-300">= SGR DuPont</p>
            <p className="text-2xl font-bold text-green-400">
              {bottomupMethods[0]?.value !== null
                ? ((bottomupMethods[0].value || 0) * 100).toFixed(1) + '%'
                : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROE METHODS (2 variants)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-r from-indigo-900/30 to-violet-900/30 p-6 rounded-xl border border-indigo-600">
        <h4 className="text-2xl font-bold text-indigo-400 mb-4">Métodos basados en ROE</h4>
        <p className="text-gray-400 mb-4">
          SGR = Retention Rate × ROE. Dos variantes: usando promedios o calculando año por año.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {roeMethods.map((method) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
              color="indigo"
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROIC METHODS (2 variants)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-r from-amber-900/30 to-orange-900/30 p-6 rounded-xl border border-amber-600">
        <h4 className="text-2xl font-bold text-amber-400 mb-4">Métodos basados en ROIC</h4>
        <p className="text-gray-400 mb-4">
          SGR = Retention Rate × ROIC. Mismas variantes que ROE pero usando ROIC (retorno sobre capital invertido).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {roicMethods.map((method) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
              color="amber"
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          FULL RETENTION METHODS
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 p-6 rounded-xl border border-purple-600">
        <h4 className="text-2xl font-bold text-purple-400 mb-4">SGR con Retención Total (Payout = 0%)</h4>
        <p className="text-gray-400 mb-4">
          Crecimiento máximo teórico si la empresa reinvierte el 100% de sus ganancias.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {retentionMethods.map((method) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
              color="purple"
            />
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          HISTORICAL CAGR
          ═══════════════════════════════════════════════════════════════ */}
      <div className="bg-gradient-to-r from-cyan-900/30 to-teal-900/30 p-6 rounded-xl border border-cyan-600">
        <h4 className="text-2xl font-bold text-cyan-400 mb-4">Crecimiento Histórico</h4>
        <p className="text-gray-400 mb-4">
          CAGR real de ingresos en el período analizado.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {historicalMethods.map((method) => (
            <MethodCard
              key={method.name}
              method={method}
              index={methods.indexOf(method)}
              onToggle={toggleMethod}
              color="cyan"
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
          (basado en {activeMethods.length} métodos activos)
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
        Desmarca métodos para excluirlos del promedio. Cada tarjeta muestra los inputs usados en el cálculo.
      </p>
    </div>
  );
}

// MethodCard Component
function MethodCard({
  method,
  index,
  onToggle,
  color = 'blue'
}: {
  method: SGRMethod;
  index: number;
  onToggle: (index: number) => void;
  color?: 'blue' | 'green' | 'indigo' | 'amber' | 'purple' | 'cyan';
}) {
  const [showDetails, setShowDetails] = useState(false);

  const colorClasses = {
    blue: 'text-blue-400 border-blue-600',
    green: 'text-green-400 border-green-600',
    indigo: 'text-indigo-400 border-indigo-600',
    amber: 'text-amber-400 border-amber-600',
    purple: 'text-purple-400 border-purple-600',
    cyan: 'text-cyan-400 border-cyan-600',
  };

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
            className={`w-4 h-4 focus:ring-2 border-gray-600 rounded cursor-pointer`}
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

      <p className={`text-4xl font-bold ${colorClasses[color].split(' ')[0]} text-center mb-2`}>
        {method.value !== null && isFinite(method.value) ? (method.value * 100).toFixed(2) + '%' : '—'}
      </p>

      <p className="text-xs text-gray-500 text-center mb-2 font-mono">
        {method.formula}
      </p>

      {showDetails && (
        <div className="mt-3 pt-3 border-t border-gray-700 space-y-1 max-h-40 overflow-y-auto">
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
