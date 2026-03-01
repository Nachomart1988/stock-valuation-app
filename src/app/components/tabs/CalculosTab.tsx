// src/app/components/tabs/CalculosTab.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

type Projection = {
  year: number;
  revenue: number;
  revenueGrowth: number | null;
  ebitda: number;
  ebitdaMargin: number;
  depreciation: number;
  netOpProfitAfterTax: number;
  capex: number;
  changeInWC: number;
  unleveredFCF: number;
  discountFactor: number;
  discountedFCF: number;
  isProjected: boolean;
};

interface CalculosTabProps {
  ticker: string;
  quote: any;
  profile: any;
  income: any[];
  balance: any[];
  cashFlow: any[];
  dcfCustom?: any; // Para obtener WACC del Advance DCF
  estimates?: any[]; // Para obtener revenue forecast
  calculatedWacc?: number; // WACC calculado en WACCTab
  keyMetricsTTM?: any; // TTM Key Metrics — used for EV/EBITDA exit multiple
  onValorIntrinsecoChange?: (value: number | null) => void; // Callback to pass Valor Intrínseco to parent
}

export default function CalculosTab({
  ticker,
  quote,
  profile,
  income,
  balance,
  cashFlow,
  dcfCustom,
  estimates,
  calculatedWacc,
  keyMetricsTTM,
  onValorIntrinsecoChange,
}: CalculosTabProps) {
  const { t } = useLanguage();
  const [calculations, setCalculations] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // ────────────────────────────────────────────────
  // Calcular revenue growth usando Holt y Regression (como en RevenueForecastTab)
  // ────────────────────────────────────────────────
  const getAverageRevenueGrowth = (yearsToForecast: number = 1) => {
    if (!income || income.length < 3) return 5; // Default 5%

    // Preparar datos historicos ordenados cronologicamente
    const historical = [...income]
      .filter((item) => item.date && item.revenue && item.revenue > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((item) => item.revenue);

    if (historical.length < 3) return 5;

    // ═══════════════════════════════════════════════════════════════
    // HOLT'S LINEAR TREND
    // ═══════════════════════════════════════════════════════════════
    const calculateHolt = (revenues: number[], alpha: number, beta: number) => {
      if (revenues.length < 2) return { level: 0, trend: 0 };
      let level = revenues[0];
      let trend = revenues[1] - revenues[0];

      for (let t = 1; t < revenues.length; t++) {
        const prevLevel = level;
        level = alpha * revenues[t] + (1 - alpha) * (prevLevel + trend);
        trend = beta * (level - prevLevel) + (1 - beta) * trend;
      }
      return { level, trend };
    };

    // Optimizar alpha y beta (simplificado)
    let bestAlpha = 0.5;
    let bestBeta = 0.5;
    let bestMSE = Infinity;

    for (let alpha = 0.1; alpha <= 0.9; alpha += 0.1) {
      for (let beta = 0.1; beta <= 0.9; beta += 0.1) {
        const { level, trend } = calculateHolt(historical, alpha, beta);
        // Simple MSE calculation
        let mse = 0;
        let tempLevel = historical[0];
        let tempTrend = historical[1] - historical[0];
        for (let t = 1; t < historical.length; t++) {
          const pred = tempLevel + tempTrend;
          mse += Math.pow(historical[t] - pred, 2);
          const prevLevel = tempLevel;
          tempLevel = alpha * historical[t] + (1 - alpha) * (prevLevel + tempTrend);
          tempTrend = beta * (tempLevel - prevLevel) + (1 - beta) * tempTrend;
        }
        if (mse < bestMSE) {
          bestMSE = mse;
          bestAlpha = alpha;
          bestBeta = beta;
        }
      }
    }

    const { level: holtLevel, trend: holtTrend } = calculateHolt(historical, bestAlpha, bestBeta);

    // Forecast con Holt
    let holtForecast = holtLevel + holtTrend * yearsToForecast;

    // ═══════════════════════════════════════════════════════════════
    // REGRESSION LINEAL
    // ═══════════════════════════════════════════════════════════════
    const n = historical.length;
    const x = historical.map((_, i) => i);
    const y = historical;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Forecast con Regression
    const nextX = n - 1 + yearsToForecast;
    const regressionForecast = intercept + slope * nextX;

    // ═══════════════════════════════════════════════════════════════
    // PROMEDIO DE GROWTH RATES
    // ═══════════════════════════════════════════════════════════════
    const lastRevenue = historical[historical.length - 1];

    // Growth rate de Holt
    const holtGrowthRate = lastRevenue > 0 ? ((holtForecast - lastRevenue) / lastRevenue) * 100 : 0;

    // Growth rate de Regression
    const regressionGrowthRate = lastRevenue > 0 ? ((regressionForecast - lastRevenue) / lastRevenue) * 100 : 0;

    // Promedio de ambos metodos
    const avgGrowthRate = (holtGrowthRate + regressionGrowthRate) / 2;

    // Clamp to reasonable range [-20%, 50%]
    return Math.max(-20, Math.min(50, avgGrowthRate));
  };

  // Calcular average forecast revenue para proyecciones
  const getAverageForecastRevenue = () => {
    if (!estimates || estimates.length === 0) return null;

    const futureEstimates = estimates.filter(e => {
      const estYear = new Date(e.date).getFullYear();
      const currentYear = new Date().getFullYear();
      return estYear >= currentYear && e.estimatedRevenueAvg;
    });

    if (futureEstimates.length > 0) {
      return futureEstimates[0].estimatedRevenueAvg; // Next year forecast
    }
    return null;
  };

  // Estados para inputs del usuario
  const [userWacc, setUserWacc] = useState<number | null>(null);
  const [exitMultiple, setExitMultiple] = useState<number>(() => {
    const fromKeyMetrics = keyMetricsTTM?.evToEbitda;
    return typeof fromKeyMetrics === 'number' && isFinite(fromKeyMetrics) && fromKeyMetrics !== 0
      ? Math.round(fromKeyMetrics * 10) / 10
      : 12;
  });
  const exitMultipleUserEdited = useRef(false);
  const [projectedGrowthRate, setProjectedGrowthRate] = useState<number>(getAverageRevenueGrowth());
  const [yearsToProject, setYearsToProject] = useState<number>(5);

  // Update projected growth rate when estimates change
  useEffect(() => {
    const avgGrowth = getAverageRevenueGrowth();
    setProjectedGrowthRate(avgGrowth);
  }, [estimates, income]);

  // Calcular WACC promedio entre el WACC Tab y Advance DCF
  const getAverageWacc = () => {
    // WACC del Advance DCF (normalizar si viene en decimal)
    let advanceDcfWacc = dcfCustom?.wacc;
    if (advanceDcfWacc !== undefined && advanceDcfWacc !== null) {
      // Si es menor a 1, está en decimal, convertir a porcentaje
      if (Math.abs(advanceDcfWacc) < 1) {
        advanceDcfWacc = advanceDcfWacc * 100;
      }
    }

    // Si el usuario especificó un WACC manual, usarlo
    if (userWacc !== null) {
      return userWacc / 100;
    }

    // Calcular promedio entre WACC Tab y Advance DCF
    const waccValues: number[] = [];

    if (calculatedWacc && calculatedWacc > 0 && calculatedWacc < 50) {
      waccValues.push(calculatedWacc);
    }

    if (advanceDcfWacc && advanceDcfWacc > 0 && advanceDcfWacc < 50) {
      waccValues.push(advanceDcfWacc);
    }

    if (waccValues.length > 0) {
      return (waccValues.reduce((sum, w) => sum + w, 0) / waccValues.length) / 100;
    }

    // Default: 10%
    return 0.10;
  };

  useEffect(() => {
    if (!income.length || !balance.length || !cashFlow.length) {
      setLoading(false);
      return;
    }

    // Ordenar arrays por fecha descendente (más reciente primero)
    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const wacc = getAverageWacc();
    const projections: Projection[] = [];
    const yearsToShow = Math.min(5, sortedIncome.length); // Mostrar hasta 5 años históricos

    // Año base para referencia del discount factor
    const baseYear = new Date(sortedIncome[0]?.date).getFullYear();

    // ────────────────────────────────────────────────
    // Datos históricos
    // ────────────────────────────────────────────────
    for (let i = yearsToShow - 1; i >= 0; i--) {
      const inc = sortedIncome[i] || {};
      const bal = sortedBalance[i] || {};
      const cf = sortedCashFlow[i] || {};
      const prevInc = sortedIncome[i + 1];

      const year = new Date(inc.date).getFullYear();
      const revenue = inc.revenue || 0;
      const prevRevenue = prevInc?.revenue || 0;
      const revenueGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;

      const ebitda = inc.ebitda || (inc.operatingIncome || 0) + (inc.depreciationAndAmortization || 0);
      const ebitdaMargin = revenue > 0 ? (ebitda / revenue) * 100 : 0;
      const depreciation = inc.depreciationAndAmortization || cf.depreciationAndAmortization || 0;

      // NOPAT = EBIT * (1 - tax rate)
      const taxRate = inc.incomeTaxExpense && inc.incomeBeforeTax
        ? inc.incomeTaxExpense / inc.incomeBeforeTax
        : 0.25;
      const ebit = inc.operatingIncome || inc.ebit || (ebitda - depreciation);
      const netOpProfitAfterTax = ebit * (1 - taxRate);

      const capex = Math.abs(cf.capitalExpenditure || cf.investmentsInPropertyPlantAndEquipment || 0);

      // Change in Working Capital
      const prevBal = sortedBalance[i + 1];
      const currentWC = (bal.totalCurrentAssets || 0) - (bal.totalCurrentLiabilities || 0);
      const prevWC = prevBal ? (prevBal.totalCurrentAssets || 0) - (prevBal.totalCurrentLiabilities || 0) : currentWC;
      const changeInWC = currentWC - prevWC;

      // Unlevered FCF = NOPAT + D&A - CapEx - Change in WC
      const unleveredFCF = netOpProfitAfterTax + depreciation - capex - changeInWC;

      projections.push({
        year,
        revenue,
        revenueGrowth,
        ebitda,
        ebitdaMargin,
        depreciation,
        netOpProfitAfterTax,
        capex,
        changeInWC,
        unleveredFCF,
        discountFactor: 1, // No descuento para históricos
        discountedFCF: 0, // No se cuenta para históricos
        isProjected: false,
      });
    }

    // ────────────────────────────────────────────────
    // Proyecciones futuras
    // ────────────────────────────────────────────────
    const lastHistorical = projections[projections.length - 1];
    if (!lastHistorical) {
      setLoading(false);
      return;
    }

    let lastRevenue = lastHistorical.revenue;
    const avgEbitdaMargin = projections.reduce((sum, p) => sum + p.ebitdaMargin, 0) / projections.length;
    const avgCapexToRevenue = projections.reduce((sum, p) => sum + (p.revenue > 0 ? p.capex / p.revenue : 0), 0) / projections.length;
    const avgDnAToRevenue = projections.reduce((sum, p) => sum + (p.revenue > 0 ? p.depreciation / p.revenue : 0), 0) / projections.length;
    const avgWCToRevenue = projections.reduce((sum, p) => sum + (p.revenue > 0 ? Math.abs(p.changeInWC) / p.revenue : 0), 0) / projections.length;

    // Tax rate promedio
    const avgTaxRate = 0.25;

    let cumulativeDiscountedFCF = 0;

    for (let i = 1; i <= yearsToProject; i++) {
      const year = lastHistorical.year + i;
      const growthRate = projectedGrowthRate / 100;
      const revenue = lastRevenue * (1 + growthRate);
      const ebitda = revenue * (avgEbitdaMargin / 100);
      const depreciation = revenue * avgDnAToRevenue;
      const ebit = ebitda - depreciation;
      const netOpProfitAfterTax = ebit * (1 - avgTaxRate);
      const capex = revenue * avgCapexToRevenue;
      const changeInWC = revenue * avgWCToRevenue * growthRate;

      const unleveredFCF = netOpProfitAfterTax + depreciation - capex - changeInWC;

      // Discount Factor correcto: 1/(1+WACC)^(year - baseYear)
      const yearsFromBase = year - baseYear;
      const discountFactor = 1 / Math.pow(1 + wacc, yearsFromBase);
      const discountedFCF = unleveredFCF * discountFactor;

      cumulativeDiscountedFCF += discountedFCF;

      projections.push({
        year,
        revenue,
        revenueGrowth: projectedGrowthRate,
        ebitda,
        ebitdaMargin: avgEbitdaMargin,
        depreciation,
        netOpProfitAfterTax,
        capex,
        changeInWC,
        unleveredFCF,
        discountFactor,
        discountedFCF,
        isProjected: true,
      });

      lastRevenue = revenue;
    }

    // ────────────────────────────────────────────────
    // TTM Multiple = Current EV / TTM EBITDA
    // ────────────────────────────────────────────────
    const recentBalance = sortedBalance[0] || {};
    const totalDebt = recentBalance.totalDebt || recentBalance.longTermDebt || 0;
    const cashAndEquivalents = recentBalance.cashAndCashEquivalents || recentBalance.cashAndShortTermInvestments || 0;
    const marketCap = quote?.marketCap || 0;
    const currentEV = marketCap + totalDebt - cashAndEquivalents;
    const ttmEbitda = sortedIncome[0]?.ebitda || lastHistorical.ebitda;

    // TTM Multiple calculado correctamente
    const calculatedTTMMultiple = ttmEbitda > 0 ? currentEV / ttmEbitda : exitMultiple;

    // Auto-initialize exit multiple: prefer keyMetricsTTM.evToEbitda (same value as Key Metrics tab)
    if (!exitMultipleUserEdited.current) {
      const kmEvEbitda = keyMetricsTTM?.evToEbitda;
      if (typeof kmEvEbitda === 'number' && isFinite(kmEvEbitda) && kmEvEbitda !== 0) {
        setExitMultiple(Math.round(kmEvEbitda * 10) / 10);
      } else if (ttmEbitda > 0 && isFinite(calculatedTTMMultiple) && calculatedTTMMultiple !== 0) {
        setExitMultiple(Math.round(calculatedTTMMultiple * 10) / 10);
      }
    }

    // ────────────────────────────────────────────────
    // Terminal Value
    // ────────────────────────────────────────────────
    const lastProjection = projections[projections.length - 1];
    const terminalEBITDA = lastProjection.ebitda;
    const terminalValue = terminalEBITDA * exitMultiple;
    const pvTerminalValue = terminalValue * lastProjection.discountFactor;

    // Total Enterprise Value
    const totalEV = cumulativeDiscountedFCF + pvTerminalValue;

    // Equity Value
    const impliedEquityValue = totalEV - totalDebt + cashAndEquivalents;

    // Per Share
    const sharesOutstanding =
      quote?.sharesOutstanding ||
      profile?.sharesOutstanding ||
      (quote?.marketCap && quote?.price ? quote.marketCap / quote.price : 0) ||
      sortedIncome[0]?.weightedAverageShsOut ||
      sortedIncome[0]?.weightedAverageShsOutDil ||
      1;

    const impliedValuePerShare = sharesOutstanding > 0 ? impliedEquityValue / sharesOutstanding : 0;
    const currentPrice = quote?.price || 0;
    const premium = currentPrice > 0 ? ((impliedValuePerShare / currentPrice) - 1) * 100 : 0;

    setCalculations({
      projections,
      terminalValue,
      pvTerminalValue,
      totalEV,
      cumulativeDiscountedFCF,
      sharesOutstanding,
      currentPrice,
      totalDebt,
      cashAndEquivalents,
      currentEV,
      impliedEquityValue,
      impliedValuePerShare,
      premium,
      avgEbitdaMargin,
      avgCapexToRevenue: avgCapexToRevenue * 100,
      avgDnAToRevenue: avgDnAToRevenue * 100,
      wacc: wacc * 100,
      ttmEbitda,
      calculatedTTMMultiple,
      baseYear,
    });

    setLoading(false);
  }, [ticker, quote, profile, income, balance, cashFlow, dcfCustom, userWacc, exitMultiple, projectedGrowthRate, yearsToProject]);

  // Notify parent when Valor Intrínseco (impliedValuePerShare) changes
  useEffect(() => {
    if (onValorIntrinsecoChange && calculations?.impliedValuePerShare) {
      onValorIntrinsecoChange(calculations.impliedValuePerShare);
    }
  }, [calculations?.impliedValuePerShare, onValorIntrinsecoChange]);

  if (loading) {
    return <p className="text-xl text-gray-400 py-10 text-center">{t('calculosTab.loading')}</p>;
  }

  if (!calculations || !calculations.projections || calculations.projections.length === 0) {
    return <p className="text-xl text-gray-400 py-10 text-center">{t('calculosTab.insufficientData')}</p>;
  }

  const {
    projections,
    terminalValue,
    pvTerminalValue,
    totalEV,
    cumulativeDiscountedFCF,
    sharesOutstanding,
    currentPrice,
    totalDebt,
    cashAndEquivalents,
    currentEV,
    impliedEquityValue,
    impliedValuePerShare,
    premium,
    avgEbitdaMargin,
    avgCapexToRevenue,
    avgDnAToRevenue,
    wacc,
    ttmEbitda,
    calculatedTTMMultiple,
    baseYear,
  } = calculations;

  const formatValue = (val: number | null | undefined, suffix = ''): string => {
    if (val === null || val === undefined || isNaN(val)) return '—';
    if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B${suffix}`;
    if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(2)}M${suffix}`;
    return `$${val.toFixed(2)}${suffix}`;
  };

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-teal-400 to-emerald-400 bg-clip-text text-transparent">
            {t('calculosTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('calculosTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          {impliedValuePerShare && impliedValuePerShare > 0 && (
            <div className="text-right bg-gradient-to-r from-teal-900/40 to-emerald-900/40 px-4 py-2 rounded-xl border border-teal-600">
              <p className="text-xs text-teal-400">{t('calculosTab.intrinsicValue')}</p>
              <p className="text-xl font-bold text-teal-400">${impliedValuePerShare.toFixed(2)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Controles de supuestos */}
      <div className="bg-black/50 p-6 rounded-xl border border-white/[0.08]">
        <h4 className="text-xl font-bold text-gray-100 mb-4">{t('calculosTab.inputParameters')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block text-gray-300 mb-2">{t('calculosTab.wacc')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min="1"
                max="25"
                value={userWacc !== null ? userWacc : wacc}
                onChange={(e) => setUserWacc(parseFloat(e.target.value) || null)}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">%</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {t('calculosTab.waccSource')}
            </p>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">{t('calculosTab.exitMultiple')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min="1"
                max="50"
                value={exitMultiple}
                onChange={(e) => { exitMultipleUserEdited.current = true; setExitMultiple(parseFloat(e.target.value) || 12); }}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">x</span>
            </div>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">{t('calculosTab.projectedGrowthRate')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                min="-20"
                max="50"
                value={projectedGrowthRate}
                onChange={(e) => setProjectedGrowthRate(parseFloat(e.target.value) || 5)}
                className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
              />
              <span className="text-gray-400">%</span>
            </div>
            <p className="text-xs text-green-400 mt-1">Avg Holt + Regression</p>
          </div>
          <div>
            <label className="block text-gray-300 mb-2">{t('calculosTab.yearsToProject')}</label>
            <input
              type="number"
              step="1"
              min="1"
              max="10"
              value={yearsToProject}
              onChange={(e) => setYearsToProject(parseInt(e.target.value) || 5)}
              className="w-full bg-black/80 border border-white/[0.08] rounded-lg px-4 py-2 text-white"
            />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-black/60 p-3 rounded-lg">
            <p className="text-gray-400">EBITDA Margin (avg)</p>
            <p className="text-gray-200 font-semibold">{avgEbitdaMargin?.toFixed(1)}%</p>
          </div>
          <div className="bg-black/60 p-3 rounded-lg">
            <p className="text-gray-400">CapEx/Revenue (avg)</p>
            <p className="text-gray-200 font-semibold">{avgCapexToRevenue?.toFixed(1)}%</p>
          </div>
          <div className="bg-black/60 p-3 rounded-lg">
            <p className="text-gray-400">D&A/Revenue (avg)</p>
            <p className="text-gray-200 font-semibold">{avgDnAToRevenue?.toFixed(1)}%</p>
          </div>
          <div className="bg-black/60 p-3 rounded-lg">
            <p className="text-gray-400">TTM EV/EBITDA (calculado)</p>
            <p className="text-gray-200 font-semibold">{calculatedTTMMultiple?.toFixed(1)}x</p>
          </div>
        </div>
      </div>

      {/* Tabla de proyecciones */}
      <div className="overflow-x-auto">
        <table className="min-w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-black/60">
            <tr>
              <th className="px-4 py-4 text-left text-gray-200 font-bold sticky left-0 bg-black/60 z-10 min-w-[180px]">
                {t('calculosTab.projectionTable')}
              </th>
              {projections.map((p: Projection) => (
                <th
                  key={p.year}
                  className={`px-4 py-4 text-center font-bold min-w-[120px] ${p.isProjected ? 'text-green-300 bg-green-900/10' : 'text-gray-200'}`}
                >
                  {p.year}{p.isProjected ? 'E' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-green-900/15">
            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.revenue')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {formatValue(p.revenue)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.growth')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {p.revenueGrowth !== null ? `${p.revenueGrowth.toFixed(1)}%` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                EBITDA
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {formatValue(p.ebitda)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.margin')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {p.ebitdaMargin ? `${p.ebitdaMargin.toFixed(1)}%` : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.depreciation')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {formatValue(p.depreciation)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.nopat')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {formatValue(p.netOpProfitAfterTax)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.capex')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {formatValue(-p.capex)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.changeInWC')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-300'}`}>
                  {formatValue(-p.changeInWC)}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60 bg-black/40">
              <td className="px-4 py-3 font-bold sticky left-0 bg-black/60 z-10 border-r border-white/[0.06] text-gray-100">
                {t('calculosTab.fcfUnlevered')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right font-bold ${p.isProjected ? 'text-green-300' : 'text-gray-100'}`}>
                  {formatValue(p.unleveredFCF)}
                </td>
              ))}
            </tr>

            {/* Discount factor y discounted FCF solo para proyecciones */}
            <tr className="hover:bg-black/60">
              <td className="px-4 py-3 font-medium sticky left-0 bg-black/80 z-10 border-r border-white/[0.06] text-gray-300">
                {t('calculosTab.discountFactor')} (WACC={wacc?.toFixed(1)}%)
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right ${p.isProjected ? 'text-green-300' : 'text-gray-500'}`}>
                  {p.isProjected ? p.discountFactor.toFixed(4) : '—'}
                </td>
              ))}
            </tr>

            <tr className="hover:bg-black/60 bg-black/40">
              <td className="px-4 py-3 font-bold sticky left-0 bg-black/60 z-10 border-r border-white/[0.06] text-gray-100">
                {t('calculosTab.discountedFcf')}
              </td>
              {projections.map((p: Projection, i: number) => (
                <td key={i} className={`px-4 py-3 text-right font-bold ${p.isProjected ? 'text-green-400' : 'text-gray-500'}`}>
                  {p.isProjected ? formatValue(p.discountedFCF) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Resumen de valoración */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-black/60 p-6 rounded-xl border border-white/[0.06]">
          <h4 className="text-xl font-bold text-gray-100 mb-4">{t('calculosTab.valuationSummary')}</h4>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.pvOfProjectedFcf')}</span>
              <span className="text-gray-200">{formatValue(cumulativeDiscountedFCF)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Terminal EBITDA ({projections[projections.length - 1]?.year})</span>
              <span className="text-gray-200">{formatValue(projections[projections.length - 1]?.ebitda)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.exitMultiple')}</span>
              <span className="text-gray-200">{exitMultiple}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.terminalValue')}</span>
              <span className="text-gray-200">{formatValue(terminalValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.pvOfTerminalValue')}</span>
              <span className="text-gray-200">{formatValue(pvTerminalValue)}</span>
            </div>
            <div className="flex justify-between border-t border-white/[0.08] pt-3">
              <span className="text-gray-100 font-bold">{t('calculosTab.enterpriseValue')}</span>
              <span className="text-green-400 font-bold">{formatValue(totalEV)}</span>
            </div>
          </div>
        </div>

        <div className="bg-black/60 p-6 rounded-xl border border-white/[0.06]">
          <h4 className="text-xl font-bold text-gray-100 mb-4">{t('calculosTab.valuationSummary')}</h4>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.enterpriseValue')}</span>
              <span className="text-gray-200">{formatValue(totalEV)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.netDebt')}</span>
              <span className="text-red-400">({formatValue(totalDebt)})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Cash & Equivalents</span>
              <span className="text-green-400">{formatValue(cashAndEquivalents)}</span>
            </div>
            <div className="flex justify-between border-t border-white/[0.08] pt-3">
              <span className="text-gray-100 font-bold">{t('calculosTab.equityValue')}</span>
              <span className="text-green-400 font-bold">{formatValue(impliedEquityValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">{t('calculosTab.sharesOutstanding')}</span>
              <span className="text-gray-200">{sharesOutstanding ? (sharesOutstanding / 1e9).toFixed(3) + 'B' : 'N/A'}</span>
            </div>
            <div className="flex justify-between border-t border-white/[0.08] pt-3">
              <span className="text-gray-100 font-bold">{t('calculosTab.intrinsicValuePerShare')}</span>
              <span className="text-green-400 font-bold text-xl">${impliedValuePerShare?.toFixed(2) || 'N/A'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Comparación con mercado */}
      <div className="bg-black/60 p-6 rounded-xl border border-white/[0.06]">
        <h4 className="text-xl font-bold text-gray-100 mb-4">{t('calculosTab.valuationSummary')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-1">{t('calculosTab.currentPrice')}</p>
            <p className="text-2xl font-bold text-green-400">${currentPrice?.toFixed(2) || 'N/A'}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-1">{t('calculosTab.intrinsicValue')}</p>
            <p className="text-2xl font-bold text-green-400">${impliedValuePerShare?.toFixed(2) || 'N/A'}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-1">{t('calculosTab.upsideDownside')}</p>
            <p className={`text-2xl font-bold ${premium > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {premium > 0 ? '+' : ''}{premium?.toFixed(1) || 'N/A'}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-1">EV Actual (Mercado)</p>
            <p className="text-2xl font-bold text-gray-300">{formatValue(currentEV)}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-1">TTM EV/EBITDA</p>
            <p className="text-2xl font-bold text-emerald-400">{calculatedTTMMultiple?.toFixed(1)}x</p>
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-500 text-center">
        WACC usado: {wacc?.toFixed(2)}% • Exit Multiple: {exitMultiple}x • TTM Multiple (EV/EBITDA): {calculatedTTMMultiple?.toFixed(1)}x
      </p>
    </div>
  );
}
