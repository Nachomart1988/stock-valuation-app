// src/app/components/tabs/WACCTab.tsx
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface WACCTabProps {
  ticker: string;
  income: any[];
  balance: any[];
  quote: any;
  profile: any;
  onWACCChange?: (wacc: number | null) => void; // Callback for ResumenTab
}

// Tabla de Damodaran para mapear ICR a rating sintético y spread
const ICR_RATING_TABLE = [
  { minICR: -100000, maxICR: 0.2, rating: 'D', spread: 14.00 },
  { minICR: 0.2, maxICR: 0.65, rating: 'C', spread: 12.00 },
  { minICR: 0.65, maxICR: 0.8, rating: 'CC', spread: 10.00 },
  { minICR: 0.8, maxICR: 1.25, rating: 'CCC', spread: 8.50 },
  { minICR: 1.25, maxICR: 1.5, rating: 'B-', spread: 6.50 },
  { minICR: 1.5, maxICR: 1.75, rating: 'B', spread: 5.50 },
  { minICR: 1.75, maxICR: 2.0, rating: 'B+', spread: 4.75 },
  { minICR: 2.0, maxICR: 2.25, rating: 'BB-', spread: 4.00 },
  { minICR: 2.25, maxICR: 2.5, rating: 'BB', spread: 3.50 },
  { minICR: 2.5, maxICR: 3.0, rating: 'BB+', spread: 3.00 },
  { minICR: 3.0, maxICR: 3.5, rating: 'BBB-', spread: 2.50 },
  { minICR: 3.5, maxICR: 4.0, rating: 'BBB', spread: 2.00 },
  { minICR: 4.0, maxICR: 4.5, rating: 'BBB+', spread: 1.75 },
  { minICR: 4.5, maxICR: 6.0, rating: 'A-', spread: 1.50 },
  { minICR: 6.0, maxICR: 7.5, rating: 'A', spread: 1.25 },
  { minICR: 7.5, maxICR: 9.5, rating: 'A+', spread: 1.10 },
  { minICR: 9.5, maxICR: 12.5, rating: 'AA', spread: 1.00 },
  { minICR: 12.5, maxICR: 100000, rating: 'AAA', spread: 0.75 },
];

export default function WACCTab({ ticker, income, balance, quote, profile, onWACCChange }: WACCTabProps) {
  const { t } = useLanguage();
  // Estados para inputs manuales
  const [riskFreeRate, setRiskFreeRate] = useState(4.5); // %
  const [equityRiskPremium, setEquityRiskPremium] = useState(5.5); // %
  const [marginalTaxRate, setMarginalTaxRate] = useState(25); // %
  const [selectedBetaSource, setSelectedBetaSource] = useState<'levered' | 'unlevered' | 'custom'>('levered');
  const [customBeta, setCustomBeta] = useState(1.0);
  const [preferredEquityRate, setPreferredEquityRate] = useState<number | null>(null); // % cost of preferred - null means auto-calculate

  // Obtener datos más recientes
  const latestIncome = useMemo(() => {
    if (!income.length) return null;
    return [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [income]);

  const latestBalance = useMemo(() => {
    if (!balance.length) return null;
    return [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [balance]);

  // ═══════════════════════════════════════════════════════════════
  // CÁLCULO DEL COST OF DEBT (Synthetic Rating Approach)
  // ═══════════════════════════════════════════════════════════════

  const costOfDebtCalc = useMemo(() => {
    if (!latestIncome || !latestBalance) {
      return { icr: 0, rating: 'N/A', spread: 0, preTaxCostOfDebt: 0, afterTaxCostOfDebt: 0 };
    }

    const ebit = latestIncome.operatingIncome || latestIncome.ebit || 0;
    const interestExpense = latestIncome.interestExpense || 1; // Avoid division by zero

    // Step 1: Calculate Interest Coverage Ratio (ICR)
    const icr = Math.abs(interestExpense) > 0 ? ebit / Math.abs(interestExpense) : 100;

    // Step 2: Map ICR to synthetic rating
    const ratingData = ICR_RATING_TABLE.find(r => icr > r.minICR && icr <= r.maxICR) || ICR_RATING_TABLE[ICR_RATING_TABLE.length - 1];

    // Step 3: Get default spread for that rating
    const spread = ratingData.spread;

    // Step 4: Calculate pre-tax cost of debt = Rf + spread
    const preTaxCostOfDebt = riskFreeRate + spread;

    // Step 5: Apply tax shield = (Rf + spread) * (1 - tax rate)
    const afterTaxCostOfDebt = preTaxCostOfDebt * (1 - marginalTaxRate / 100);

    return {
      icr,
      rating: ratingData.rating,
      spread,
      preTaxCostOfDebt,
      afterTaxCostOfDebt,
    };
  }, [latestIncome, latestBalance, riskFreeRate, marginalTaxRate]);

  // ═══════════════════════════════════════════════════════════════
  // CÁLCULO DEL COST OF EQUITY (CAPM)
  // ═══════════════════════════════════════════════════════════════

  const costOfEquityCalc = useMemo(() => {
    // Beta from profile or manual
    let beta = 1.0;
    if (selectedBetaSource === 'custom') {
      beta = customBeta;
    } else if (selectedBetaSource === 'levered') {
      beta = profile?.beta || 1.0;
    } else {
      // Unlevered beta calculation: Beta_U = Beta_L / (1 + (1-t) * D/E)
      const leveredBeta = profile?.beta || 1.0;
      const marketCap = quote?.marketCap || 1;
      const totalDebt = latestBalance?.totalDebt || 0;
      const debtToEquity = marketCap > 0 ? totalDebt / marketCap : 0;
      beta = leveredBeta / (1 + (1 - marginalTaxRate / 100) * debtToEquity);
    }

    // CAPM: Cost of Equity = Rf + Beta * ERP
    const costOfEquity = riskFreeRate + beta * equityRiskPremium;

    return {
      beta,
      costOfEquity,
    };
  }, [selectedBetaSource, customBeta, profile, quote, latestBalance, riskFreeRate, equityRiskPremium, marginalTaxRate]);

  // ═══════════════════════════════════════════════════════════════
  // CAPITAL STRUCTURE (% Debt, % Equity, % Preferred)
  // ═══════════════════════════════════════════════════════════════

  const capitalStructure = useMemo(() => {
    const marketCap = quote?.marketCap || 0;
    const totalDebt = latestBalance?.totalDebt || latestBalance?.longTermDebt || 0;

    // FMP API can return preferred stock under different field names
    // Try multiple possible field names for preferred stock
    const preferredStock =
      latestBalance?.preferredStock ||
      latestBalance?.preferredEquity ||
      latestBalance?.redeemablePreferredStock ||
      latestBalance?.convertiblePreferredStock ||
      // Some APIs store it in total equity breakdown
      latestBalance?.preferenceShareCapital ||
      latestBalance?.preferredSecurities ||
      // Calculate from total equity if available (totalStockholdersEquity = common + preferred)
      // If there's a big gap between totalEquity and commonStock, it might be preferred
      (latestBalance?.totalEquity && latestBalance?.commonStock && latestBalance?.retainedEarnings
        ? Math.max(0, (latestBalance.totalEquity || 0) - (latestBalance.commonStock || 0) - (latestBalance.retainedEarnings || 0) - (latestBalance.accumulatedOtherComprehensiveIncomeLoss || 0))
        : 0) ||
      0;

    const totalCapital = marketCap + totalDebt + preferredStock;

    if (totalCapital === 0) {
      return { debtPct: 0, equityPct: 100, preferredPct: 0, totalCapital: 0, marketCap, totalDebt, preferredStock };
    }

    return {
      debtPct: (totalDebt / totalCapital) * 100,
      equityPct: (marketCap / totalCapital) * 100,
      preferredPct: (preferredStock / totalCapital) * 100,
      totalCapital,
      marketCap,
      totalDebt,
      preferredStock,
    };
  }, [quote, latestBalance]);

  // ═══════════════════════════════════════════════════════════════
  // COST OF PREFERRED STOCK CALCULATION
  // Cost of Preferred = Preferred Dividend / Preferred Stock Price
  // If we don't have preferred price, use: Preferred Dividend / Book Value of Preferred
  // Typical range: 5-9% for investment grade preferred
  // ═══════════════════════════════════════════════════════════════

  const calculatedCostOfPreferred = useMemo(() => {
    // If user manually set a value, use that
    if (preferredEquityRate !== null) {
      return preferredEquityRate;
    }

    // If no preferred stock, return 0
    if (capitalStructure.preferredStock === 0) {
      return 0;
    }

    // Try to estimate cost of preferred
    // Method 1: If we have preferred dividends from cash flow
    const preferredDividends = Math.abs(
      latestBalance?.preferredDividends ||
      latestBalance?.dividendsPreferred ||
      0
    );

    if (preferredDividends > 0 && capitalStructure.preferredStock > 0) {
      return (preferredDividends / capitalStructure.preferredStock) * 100;
    }

    // Method 2: Use industry average for preferred stock cost
    // Preferred stock typically yields between 5-8% for stable companies
    // Use cost of debt + spread as proxy (preferred is between debt and equity in risk)
    const estimatedCostOfPreferred = costOfDebtCalc.preTaxCostOfDebt + 1.5; // Add 1.5% spread over debt

    // Cap at reasonable range (4-12%)
    return Math.min(12, Math.max(4, estimatedCostOfPreferred));
  }, [preferredEquityRate, capitalStructure.preferredStock, latestBalance, costOfDebtCalc.preTaxCostOfDebt]);

  // ═══════════════════════════════════════════════════════════════
  // WEIGHTED COSTS
  // ═══════════════════════════════════════════════════════════════

  const weightedCostOfDebt = (capitalStructure.debtPct / 100) * costOfDebtCalc.afterTaxCostOfDebt;
  const weightedCostOfEquity = (capitalStructure.equityPct / 100) * costOfEquityCalc.costOfEquity;
  const weightedCostOfPreferred = (capitalStructure.preferredPct / 100) * calculatedCostOfPreferred;

  // ═══════════════════════════════════════════════════════════════
  // WACC FINAL
  // ═══════════════════════════════════════════════════════════════

  const wacc = weightedCostOfDebt + weightedCostOfEquity + weightedCostOfPreferred;

  // Notify parent component of WACC changes
  useEffect(() => {
    if (onWACCChange && wacc && isFinite(wacc)) {
      // WACC is already in percentage form (e.g., 8.5 means 8.5%)
      // Convert to decimal for consistency with other rate values
      onWACCChange(wacc / 100);
    }
  }, [wacc, onWACCChange]);

  // Format helpers
  const formatPct = (val: number) => `${val.toFixed(2)}%`;
  const formatMoney = (val: number) => {
    if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
    if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
    if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
    return `$${val.toFixed(0)}`;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
            {t('waccTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('waccTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-amber-900/40 to-orange-900/40 px-4 py-2 rounded-xl border border-amber-600">
            <p className="text-xs text-amber-400">{t('waccTab.wacc')}</p>
            <p className="text-xl font-bold text-amber-400">{wacc.toFixed(2)}%</p>
          </div>
        </div>
      </div>

      {/* Input Parameters */}
      <div className="bg-black/50 p-6 rounded-xl border border-white/[0.08]">
        <h4 className="text-xl font-bold text-gray-100 mb-6">{t('waccTab.inputParameters')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label className="block text-gray-300 mb-2">{t('waccTab.riskFreeRate')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={riskFreeRate}
                onChange={(e) => setRiskFreeRate(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">%</span>
            </div>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">{t('waccTab.equityRiskPremium')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={equityRiskPremium}
                onChange={(e) => setEquityRiskPremium(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">%</span>
            </div>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">{t('waccTab.marginalTaxRate')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="1"
                value={marginalTaxRate}
                onChange={(e) => setMarginalTaxRate(parseFloat(e.target.value) || 0)}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">%</span>
            </div>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">{t('waccTab.costOfPreferredEquity')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={preferredEquityRate !== null ? preferredEquityRate : calculatedCostOfPreferred}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setPreferredEquityRate(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedCostOfPreferred.toFixed(2)}%`}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">%</span>
            </div>
            {capitalStructure.preferredStock > 0 && preferredEquityRate === null && (
              <p className="text-xs text-green-400 mt-1">{t('waccTab.autoCalculated')}</p>
            )}
          </div>
        </div>

        {/* Beta Selection */}
        <div className="mt-6">
          <label className="block text-gray-300 mb-2">{t('waccTab.betaSource')}</label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={selectedBetaSource === 'levered'}
                onChange={() => setSelectedBetaSource('levered')}
                className="text-green-500"
              />
              <span className="text-gray-300">{t('waccTab.leveredBeta')} ({profile?.beta?.toFixed(2) || 'N/A'})</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={selectedBetaSource === 'unlevered'}
                onChange={() => setSelectedBetaSource('unlevered')}
                className="text-green-500"
              />
              <span className="text-gray-300">{t('waccTab.unleveredBeta')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={selectedBetaSource === 'custom'}
                onChange={() => setSelectedBetaSource('custom')}
                className="text-green-500"
              />
              <span className="text-gray-300">{t('waccTab.customBeta')}</span>
              <input
                type="number"
                step="0.05"
                value={customBeta}
                onChange={(e) => setCustomBeta(parseFloat(e.target.value) || 1)}
                disabled={selectedBetaSource !== 'custom'}
                className="w-20 bg-black/80 border border-white/[0.08] rounded-lg px-2 py-1 text-white disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      </div>

      {/* WACC Tree Visualization */}
      <div className="bg-black/60 p-8 rounded-xl border border-white/[0.06]">
        <h4 className="text-2xl font-bold text-gray-100 mb-8 text-center">{t('waccTab.title')}</h4>

        <div className="flex flex-col items-center gap-8">
          {/* Top Level - Component Costs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
            {/* Cost of Debt Branch */}
            <div className="space-y-4">
              <div className="bg-black/50 p-4 rounded-lg border border-white/[0.08]">
                <h5 className="text-lg font-bold text-green-400 mb-3">{t('waccTab.costOfDebt')}</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('waccTab.ebit')}</span>
                    <span className="text-gray-200">{formatMoney(latestIncome?.operatingIncome || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('waccTab.interestExpense')}</span>
                    <span className="text-gray-200">{formatMoney(Math.abs(latestIncome?.interestExpense || 0))}</span>
                  </div>
                  <div className="flex justify-between border-t border-white/[0.08] pt-2">
                    <span className="text-gray-300 font-medium">{t('waccTab.icr')}</span>
                    <span className="text-yellow-400 font-bold">{costOfDebtCalc.icr.toFixed(2)}x</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('waccTab.syntheticRating')}</span>
                    <span className="text-emerald-400 font-bold">{costOfDebtCalc.rating}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('waccTab.defaultSpread')}</span>
                    <span className="text-gray-200">{formatPct(costOfDebtCalc.spread)}</span>
                  </div>
                </div>
              </div>
              <div className="text-center text-2xl text-gray-500">↓</div>
              <div className="bg-green-900/30 p-4 rounded-lg border border-green-600">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">{t('waccTab.preTaxCost')}</span>
                  <span className="text-green-400 font-bold text-xl">{formatPct(costOfDebtCalc.preTaxCostOfDebt)}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">Rf ({formatPct(riskFreeRate)}) + Spread ({formatPct(costOfDebtCalc.spread)})</div>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="text-gray-400 text-sm">× (1 - {formatPct(marginalTaxRate)})</span>
              </div>
              <div className="text-center text-2xl text-gray-500">↓</div>
              <div className="bg-green-900/30 p-4 rounded-lg border border-green-600">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">{t('waccTab.afterTaxCost')}</span>
                  <span className="text-green-400 font-bold text-xl">{formatPct(costOfDebtCalc.afterTaxCostOfDebt)}</span>
                </div>
              </div>
            </div>

            {/* Cost of Equity Branch */}
            <div className="space-y-4">
              <div className="bg-black/50 p-4 rounded-lg border border-white/[0.08]">
                <h5 className="text-lg font-bold text-emerald-400 mb-3">{t('waccTab.costOfEquity')}</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Risk Free Rate (Rf)</span>
                    <span className="text-gray-200">{formatPct(riskFreeRate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Beta (β)</span>
                    <span className="text-yellow-400 font-bold">{costOfEquityCalc.beta.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Equity Risk Premium</span>
                    <span className="text-gray-200">{formatPct(equityRiskPremium)}</span>
                  </div>
                </div>
              </div>
              <div className="text-center text-2xl text-gray-500">↓</div>
              <div className="bg-emerald-900/30 p-4 rounded-lg border border-emerald-600">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">{t('waccTab.costOfEquity')}</span>
                  <span className="text-emerald-400 font-bold text-xl">{formatPct(costOfEquityCalc.costOfEquity)}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">Rf + β × ERP = {formatPct(riskFreeRate)} + {costOfEquityCalc.beta.toFixed(2)} × {formatPct(equityRiskPremium)}</div>
              </div>
            </div>

            {/* Preferred Equity Branch */}
            <div className="space-y-4">
              <div className="bg-black/50 p-4 rounded-lg border border-white/[0.08]">
                <h5 className="text-lg font-bold text-orange-400 mb-3">{t('waccTab.preferredEquity')}</h5>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('waccTab.preferredStock')}</span>
                    <span className="text-gray-200">{formatMoney(capitalStructure.preferredStock)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">{t('waccTab.costOfPreferred')}</span>
                    <span className="text-gray-200">{formatPct(calculatedCostOfPreferred)}</span>
                  </div>
                </div>
              </div>
              <div className="text-center text-2xl text-gray-500">↓</div>
              <div className="bg-orange-900/30 p-4 rounded-lg border border-orange-600">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">{t('waccTab.costOfPreferred')}</span>
                  <span className="text-orange-400 font-bold text-xl">{formatPct(calculatedCostOfPreferred)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Capital Structure Weights */}
          <div className="text-center text-2xl text-gray-500">↓ {t('waccTab.applyWeights')} ↓</div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
            <div className="bg-black/40 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm">{t('waccTab.debtWeight')}</p>
              <p className="text-2xl font-bold text-green-400">{formatPct(capitalStructure.debtPct)}</p>
              <p className="text-xs text-gray-500">{formatMoney(capitalStructure.totalDebt)} / {formatMoney(capitalStructure.totalCapital)}</p>
            </div>
            <div className="bg-black/40 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm">{t('waccTab.equityWeight')}</p>
              <p className="text-2xl font-bold text-emerald-400">{formatPct(capitalStructure.equityPct)}</p>
              <p className="text-xs text-gray-500">{formatMoney(capitalStructure.marketCap)} / {formatMoney(capitalStructure.totalCapital)}</p>
            </div>
            <div className="bg-black/40 p-4 rounded-lg text-center">
              <p className="text-gray-400 text-sm">{t('waccTab.preferredWeight')}</p>
              <p className="text-2xl font-bold text-orange-400">{formatPct(capitalStructure.preferredPct)}</p>
              <p className="text-xs text-gray-500">{formatMoney(capitalStructure.preferredStock)} / {formatMoney(capitalStructure.totalCapital)}</p>
            </div>
          </div>

          {/* Weighted Costs */}
          <div className="text-center text-2xl text-gray-500">↓</div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
            <div className="bg-green-900/20 p-4 rounded-lg text-center border border-green-700">
              <p className="text-gray-400 text-sm">{t('waccTab.weightedCostOfDebt')}</p>
              <p className="text-2xl font-bold text-green-400">{formatPct(weightedCostOfDebt)}</p>
              <p className="text-xs text-gray-500">{formatPct(capitalStructure.debtPct)} × {formatPct(costOfDebtCalc.afterTaxCostOfDebt)}</p>
            </div>
            <div className="bg-emerald-900/20 p-4 rounded-lg text-center border border-emerald-700">
              <p className="text-gray-400 text-sm">{t('waccTab.weightedCostOfEquity')}</p>
              <p className="text-2xl font-bold text-emerald-400">{formatPct(weightedCostOfEquity)}</p>
              <p className="text-xs text-gray-500">{formatPct(capitalStructure.equityPct)} × {formatPct(costOfEquityCalc.costOfEquity)}</p>
            </div>
            <div className="bg-orange-900/20 p-4 rounded-lg text-center border border-orange-700">
              <p className="text-gray-400 text-sm">{t('waccTab.weightedCostOfPreferred')}</p>
              <p className="text-2xl font-bold text-orange-400">{formatPct(weightedCostOfPreferred)}</p>
              <p className="text-xs text-gray-500">{formatPct(capitalStructure.preferredPct)} × {formatPct(calculatedCostOfPreferred)}</p>
            </div>
          </div>

          {/* Final WACC */}
          <div className="text-center text-3xl text-gray-500">↓</div>

          <div className="bg-black/80 p-8 rounded-2xl border-2 border-green-500 text-center max-w-md">
            <p className="text-xl text-gray-300 mb-2">{t('waccTab.finalWacc')}</p>
            <p className="text-6xl font-bold text-green-400">{formatPct(wacc)}</p>
            <p className="text-sm text-gray-400 mt-4">
              WACC = (Wd × Rd × (1-t)) + (We × Re) + (Wp × Rp)
            </p>
          </div>
        </div>
      </div>

      {/* Summary Table */}
      <div className="bg-black/60 p-6 rounded-xl border border-white/[0.06]">
        <h4 className="text-xl font-bold text-gray-100 mb-4">{t('waccTab.summaryTitle')}</h4>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-3 text-left text-gray-300">{t('waccTab.component')}</th>
                <th className="px-4 py-3 text-right text-gray-300">{t('waccTab.cost')}</th>
                <th className="px-4 py-3 text-right text-gray-300">{t('waccTab.weight')}</th>
                <th className="px-4 py-3 text-right text-gray-300">{t('waccTab.contribution')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-green-900/15">
              <tr>
                <td className="px-4 py-3 text-gray-200">{t('waccTab.debtAfterTax')}</td>
                <td className="px-4 py-3 text-right text-green-400">{formatPct(costOfDebtCalc.afterTaxCostOfDebt)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatPct(capitalStructure.debtPct)}</td>
                <td className="px-4 py-3 text-right text-green-400 font-bold">{formatPct(weightedCostOfDebt)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-gray-200">{t('waccTab.equity')}</td>
                <td className="px-4 py-3 text-right text-emerald-400">{formatPct(costOfEquityCalc.costOfEquity)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatPct(capitalStructure.equityPct)}</td>
                <td className="px-4 py-3 text-right text-emerald-400 font-bold">{formatPct(weightedCostOfEquity)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-gray-200">{t('waccTab.preferred')}</td>
                <td className="px-4 py-3 text-right text-orange-400">{formatPct(calculatedCostOfPreferred)}</td>
                <td className="px-4 py-3 text-right text-gray-300">{formatPct(capitalStructure.preferredPct)}</td>
                <td className="px-4 py-3 text-right text-orange-400 font-bold">{formatPct(weightedCostOfPreferred)}</td>
              </tr>
              <tr className="bg-black/40">
                <td className="px-4 py-3 text-gray-100 font-bold">WACC</td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right text-gray-300">100%</td>
                <td className="px-4 py-3 text-right text-green-400 font-bold text-xl">{formatPct(wacc)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-sm text-gray-500 text-center">
        {t('waccTab.footer')}
      </p>
    </div>
  );
}
