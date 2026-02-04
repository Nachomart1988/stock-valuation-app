// src/app/components/tabs/ValuacionesTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';

interface ValuationMethod {
  name: string;
  value: number | null;
  enabled: boolean;
  description?: string;
}

interface PeerData {
  symbol: string;
  pe: number | null;
}

interface Props {
  ticker: string;
  income: any[];
  balance: any[];
  cashFlow: any[];
  priceTarget: any;
  profile: any;
  quote: any;
  dcfCustom?: any; // Para obtener Advance DCF equity value per share
  onAverageValChange?: (val: number | null) => void;
}

export default function ValuacionesTab({
  ticker,
  income,
  balance,
  cashFlow,
  priceTarget,
  profile,
  quote,
  dcfCustom,
  onAverageValChange,
}: Props) {
  // ────────────────────────────────────────────────
  // Estados para parámetros del modelo
  // ────────────────────────────────────────────────
  const [h, setH] = useState<number>(5);
  const [glong, setGlong] = useState<number>(0.04);
  const [n, setN] = useState<number>(5);
  const [sharePriceTxCAGR, setSharePriceTxCAGR] = useState<number>(10); // CAGR in % for terminal share price

  // Parámetros adicionales para modelos avanzados
  const [discountRate, setDiscountRate] = useState<number | null>(null); // WACC en %, null = auto-calculate
  const [exitMultiple, setExitMultiple] = useState<number>(12);
  const [projectedGrowthRate, setProjectedGrowthRate] = useState<number>(5);

  // Calculate Share Price TX based on current price and CAGR
  const currentPrice = quote?.price || 0;
  const sharePriceT5 = currentPrice * Math.pow(1 + sharePriceTxCAGR / 100, n);

  // Calculate default WACC as average of WACC tab calculation and Advance DCF WACC
  const calculatedDefaultWACC = useMemo(() => {
    // Get WACC from dcfCustom (Advance DCF) - API returns WACC already as percentage (e.g., 8.88 means 8.88%)
    // Do NOT multiply by 100, it's already in percentage form
    const advanceDcfWacc = dcfCustom?.wacc ? dcfCustom.wacc : null;

    // Simple WACC calculation (similar to WACCTab)
    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const lastIncome = sortedIncome[0] || {};
    const lastBalance = sortedBalance[0] || {};

    // Cost of equity using CAPM: Re = Rf + β(Rm - Rf)
    const riskFreeRate = 0.04; // 4% default
    const marketReturn = 0.10; // 10% default
    const beta = profile?.beta || 1;
    const costOfEquity = riskFreeRate + beta * (marketReturn - riskFreeRate);

    // Cost of debt
    const interestExpense = Math.abs(lastIncome.interestExpense || 0);
    const totalDebt = lastBalance.totalDebt || lastBalance.longTermDebt || 0;
    const costOfDebt = totalDebt > 0 ? interestExpense / totalDebt : 0.05;

    // Tax rate
    const taxRate = lastIncome.incomeTaxExpense && lastIncome.incomeBeforeTax
      ? Math.max(0, Math.min(0.4, lastIncome.incomeTaxExpense / lastIncome.incomeBeforeTax))
      : 0.25;

    // Market value of equity
    const marketCap = quote?.marketCap || (quote?.price && quote?.sharesOutstanding ? quote.price * quote.sharesOutstanding : 0);

    // Weights
    const totalValue = marketCap + totalDebt;
    const weightEquity = totalValue > 0 ? marketCap / totalValue : 0.7;
    const weightDebt = totalValue > 0 ? totalDebt / totalValue : 0.3;

    // WACC calculation
    const calculatedWacc = (weightEquity * costOfEquity + weightDebt * costOfDebt * (1 - taxRate)) * 100;

    // Average of calculated WACC and Advance DCF WACC
    if (advanceDcfWacc && calculatedWacc > 0) {
      return (advanceDcfWacc + calculatedWacc) / 2;
    } else if (advanceDcfWacc) {
      return advanceDcfWacc;
    } else if (calculatedWacc > 0) {
      return calculatedWacc;
    }
    return 10; // Fallback default
  }, [income, balance, quote, profile, dcfCustom]);

  // Effective WACC (user input or auto-calculated)
  const effectiveDiscountRate = discountRate ?? calculatedDefaultWACC;

  // ────────────────────────────────────────────────
  // Cálculo de parámetros por defecto basados en datos históricos
  // ────────────────────────────────────────────────

  const calculatedDefaults = useMemo(() => {
    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // ═══════════════════════════════════════════════════════════════
    // RIM OHLSON: ω (omega) y γ (gamma) via AR(1) regression
    // ω = persistence of abnormal earnings: ROE_t = α + ω·ROE_{t-1} + ε
    // γ = persistence of other information (analyst revisions proxy)
    // ═══════════════════════════════════════════════════════════════

    // Calculate ROE series for AR(1) regression
    const roeSeries: number[] = [];
    for (let i = 0; i < Math.min(sortedIncome.length, sortedBalance.length); i++) {
      const netIncome = sortedIncome[i]?.netIncome || 0;
      const equity = sortedBalance[i]?.totalStockholdersEquity || 1;
      if (equity > 0 && netIncome !== 0) {
        roeSeries.push(netIncome / equity);
      }
    }

    // Simple AR(1) estimation: ω = Cov(ROE_t, ROE_{t-1}) / Var(ROE_{t-1})
    let omega = 0.62; // Default
    if (roeSeries.length >= 3) {
      const n = roeSeries.length - 1;
      let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        const x = roeSeries[i + 1]; // ROE_{t-1}
        const y = roeSeries[i];     // ROE_t
        sumXY += x * y;
        sumX += x;
        sumY += y;
        sumX2 += x * x;
      }
      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) > 0.0001) {
        omega = (n * sumXY - sumX * sumY) / denom;
        // Clamp omega to [0, 1] as it's a persistence parameter
        omega = Math.max(0, Math.min(1, omega));
      }
    }

    // Gamma: persistence of "other information"
    // Use analyst estimate revisions as proxy, or default based on sector
    // Tech companies tend to have lower gamma (more volatile info)
    // Stable industries have higher gamma
    const beta = profile?.beta || 1;
    let gamma = 0.32; // Default
    if (beta > 1.5) {
      gamma = 0.2; // High beta = less persistent other info
    } else if (beta < 0.8) {
      gamma = 0.5; // Low beta = more persistent
    }

    // ═══════════════════════════════════════════════════════════════
    // STOCHASTIC DCF: σ (volatility) y λ (market price of risk)
    // σ = std dev of FCF growth rates
    // λ = Sharpe ratio = (E[R] - Rf) / σ_market ≈ beta * ERP / σ_stock
    // ═══════════════════════════════════════════════════════════════

    // Calculate FCF growth rates
    const fcfGrowthRates: number[] = [];
    for (let i = 0; i < sortedCashFlow.length - 1; i++) {
      const fcfCurrent = sortedCashFlow[i]?.freeCashFlow || 0;
      const fcfPrev = sortedCashFlow[i + 1]?.freeCashFlow || 0;
      if (fcfPrev !== 0 && fcfCurrent !== 0) {
        const growthRate = (fcfCurrent - fcfPrev) / Math.abs(fcfPrev);
        // Filter out extreme values
        if (Math.abs(growthRate) < 5) {
          fcfGrowthRates.push(growthRate);
        }
      }
    }

    // Calculate standard deviation of FCF growth
    let sigmaFCF = 0.25; // Default
    if (fcfGrowthRates.length >= 2) {
      const mean = fcfGrowthRates.reduce((s, v) => s + v, 0) / fcfGrowthRates.length;
      const variance = fcfGrowthRates.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / fcfGrowthRates.length;
      sigmaFCF = Math.sqrt(variance);
      // Clamp to reasonable range [0.05, 1.0]
      sigmaFCF = Math.max(0.05, Math.min(1.0, sigmaFCF));
    }

    // Lambda (market price of risk) ≈ Sharpe ratio
    // λ = β × ERP / σ_stock where ERP ≈ 5.5%
    const stockBeta = profile?.beta || 1;
    const erp = 0.055; // Equity risk premium
    const stockVolatility = sigmaFCF; // Use FCF vol as proxy for stock vol
    let lambdaRisk = stockVolatility > 0 ? (stockBeta * erp) / stockVolatility : 0.5;
    // Clamp to reasonable range [0.1, 1.5]
    lambdaRisk = Math.max(0.1, Math.min(1.5, lambdaRisk));

    // ═══════════════════════════════════════════════════════════════
    // BAYESIAN NK DSGE: φπ, φy, κ, β
    // φπ (Taylor inflation): typically 1.5-2.0 based on Fed behavior
    // φy (Taylor output): typically 0.1-0.5
    // κ (Phillips curve slope): 0.01-0.05, inversely related to market power
    // β (discount factor): ~0.99 for quarterly, ~0.96 for annual
    // ═══════════════════════════════════════════════════════════════

    // φπ: Use market volatility as proxy - higher vol → more aggressive Fed
    let phiPi = 1.5;
    if (stockBeta > 1.3) {
      phiPi = 1.8; // More aggressive for volatile sectors
    } else if (stockBeta < 0.7) {
      phiPi = 1.3; // Less aggressive for stable sectors
    }

    // φy: Output gap response - cyclical companies need higher φy
    const sector = profile?.sector?.toLowerCase() || '';
    let phiY = 0.25;
    if (sector.includes('consumer') || sector.includes('industrial') || sector.includes('financial')) {
      phiY = 0.4; // Cyclical sectors
    } else if (sector.includes('health') || sector.includes('utilities') || sector.includes('consumer defensive')) {
      phiY = 0.15; // Defensive sectors
    }

    // κ (Phillips curve slope): Related to pricing power
    // Higher profit margin → more market power → lower κ
    const latestIncome = sortedIncome[0] || {};
    const grossMargin = latestIncome.revenue > 0
      ? (latestIncome.grossProfit || 0) / latestIncome.revenue
      : 0.3;
    let kappaDSGE = 0.03; // Default
    if (grossMargin > 0.5) {
      kappaDSGE = 0.01; // High margin = high pricing power = low κ
    } else if (grossMargin < 0.25) {
      kappaDSGE = 0.05; // Low margin = low pricing power = high κ
    }

    // β (discount factor): Standard value for annual data
    const betaDSGECalc = 0.99;

    // ═══════════════════════════════════════════════════════════════
    // HJM: σ (forward rate volatility) y a (mean reversion)
    // σ: typically 0.01-0.02 for interest rates
    // a: mean reversion speed, higher for short rates (0.1-0.5)
    // ═══════════════════════════════════════════════════════════════

    // Use dcfCustom risk-free rate if available, otherwise estimate
    // API returns riskFreeRate as percentage (e.g., 3.83 = 3.83%), convert to decimal
    const riskFreeRate = dcfCustom?.riskFreeRate ? dcfCustom.riskFreeRate / 100 : 0.04;

    // HJM sigma: Forward rate volatility (basis points / 100)
    // Typically between 0.5-2% for developed markets
    let hjmSigmaCalc = 0.015; // 1.5% default
    if (riskFreeRate > 0.05) { // 5%
      hjmSigmaCalc = 0.02; // Higher rates = higher vol
    } else if (riskFreeRate < 0.02) { // 2%
      hjmSigmaCalc = 0.01; // Lower rates = lower vol
    }

    // Mean reversion (a): Speed at which rates revert to long-term mean
    // Higher a = faster reversion, typically 0.1-0.5 for annual data
    // Use stock beta as proxy - high beta companies more sensitive to rate changes
    let hjmMeanReversionCalc = 0.2; // Default
    if (stockBeta > 1.3) {
      hjmMeanReversionCalc = 0.1; // Slower reversion for volatile stocks
    } else if (stockBeta < 0.7) {
      hjmMeanReversionCalc = 0.4; // Faster reversion for stable stocks
    }

    return {
      omega,
      gamma,
      sigmaFCF,
      lambdaRisk,
      phiPi,
      phiY,
      kappaDSGE,
      betaDSGE: betaDSGECalc,
      hjmSigma: hjmSigmaCalc,
      hjmMeanReversion: hjmMeanReversionCalc,
    };
  }, [income, balance, cashFlow, profile, dcfCustom]);

  // Parámetros Ohlson RIM - inicializar con valores calculados
  const [omega, setOmega] = useState<number | null>(null);
  const [gamma, setGamma] = useState<number | null>(null);

  // Parámetros Stochastic DCF
  const [volatility, setVolatility] = useState<number | null>(null);
  const [lambda, setLambda] = useState<number | null>(null);

  // Parámetros NK DSGE (Bayesian)
  const [phi_pi, setPhi_pi] = useState<number | null>(null);
  const [phi_y, setPhi_y] = useState<number | null>(null);
  const [betaDSGE, setBetaDSGE] = useState<number | null>(null);
  const [kappa, setKappa] = useState<number | null>(null);

  // Parámetros HJM
  const [hjmSigma, setHjmSigma] = useState<number | null>(null);
  const [hjmMeanReversion, setHjmMeanReversion] = useState<number | null>(null);

  // Use calculated defaults when state is null
  const effectiveOmega = omega ?? calculatedDefaults.omega;
  const effectiveGamma = gamma ?? calculatedDefaults.gamma;
  const effectiveVolatility = volatility ?? calculatedDefaults.sigmaFCF;
  const effectiveLambda = lambda ?? calculatedDefaults.lambdaRisk;
  const effectivePhiPi = phi_pi ?? calculatedDefaults.phiPi;
  const effectivePhiY = phi_y ?? calculatedDefaults.phiY;
  const effectiveBetaDSGE = betaDSGE ?? calculatedDefaults.betaDSGE;
  const effectiveKappa = kappa ?? calculatedDefaults.kappaDSGE;
  const effectiveHjmSigma = hjmSigma ?? calculatedDefaults.hjmSigma;
  const effectiveHjmMeanReversion = hjmMeanReversion ?? calculatedDefaults.hjmMeanReversion;

  const [methods, setMethods] = useState<ValuationMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado para P/E de competidores
  const [peerPE, setPeerPE] = useState<PeerData[]>([]);
  const [loadingPeers, setLoadingPeers] = useState(true);

  // ────────────────────────────────────────────────
  // Fetch P/E de competidores para EPS*Benchmark
  // ────────────────────────────────────────────────
  useEffect(() => {
    const fetchPeerPE = async () => {
      if (!ticker) return;

      try {
        setLoadingPeers(true);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        // Obtener peers
        const peersRes = await fetch(
          `https://financialmodelingprep.com/stable/stock-peers?symbol=${ticker}&apikey=${apiKey}`
        );

        let peerSymbols: string[] = [];
        if (peersRes.ok) {
          const peersJson = await peersRes.json();
          if (Array.isArray(peersJson)) {
            peerSymbols = peersJson.map((p: any) => p.symbol).filter(Boolean).slice(0, 8);
          }
        }

        if (peerSymbols.length === 0) {
          peerSymbols = ['MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'];
        }

        // Obtener P/E de cada peer
        const peData: PeerData[] = [];
        for (const symbol of peerSymbols) {
          try {
            const quoteRes = await fetch(
              `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`
            );
            if (quoteRes.ok) {
              const quoteJson = await quoteRes.json();
              const q = Array.isArray(quoteJson) ? quoteJson[0] : quoteJson;
              if (q && q.pe && q.pe > 0 && q.pe < 100) { // Filtrar P/E razonables
                peData.push({ symbol, pe: q.pe });
              }
            }
          } catch {
            // Skip this peer
          }
        }

        setPeerPE(peData);
      } catch (err) {
        console.error('Error fetching peer P/E:', err);
      } finally {
        setLoadingPeers(false);
      }
    };

    fetchPeerPE();
  }, [ticker]);

  // ────────────────────────────────────────────────
  // Calcular DCF interno (similar a CalculosTab)
  // ────────────────────────────────────────────────
  const dcfCalculation = useMemo(() => {
    if (!income.length || !balance.length || !cashFlow.length) return null;

    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Promedios históricos
    const historicalData = sortedIncome.slice(0, 5).map((inc, i) => {
      const cf = sortedCashFlow[i] || {};
      const revenue = inc.revenue || 0;
      const ebitda = inc.ebitda || (inc.operatingIncome || 0) + (inc.depreciationAndAmortization || 0);
      const depreciation = inc.depreciationAndAmortization || cf.depreciationAndAmortization || 0;
      const taxRate = inc.incomeTaxExpense && inc.incomeBeforeTax ? inc.incomeTaxExpense / inc.incomeBeforeTax : 0.25;
      const ebit = inc.operatingIncome || (ebitda - depreciation);
      const nopat = ebit * (1 - taxRate);
      const capex = Math.abs(cf.capitalExpenditure || 0);

      return {
        revenue,
        ebitda,
        ebitdaMargin: revenue > 0 ? ebitda / revenue : 0,
        depreciation,
        nopat,
        capex,
        capexToRevenue: revenue > 0 ? capex / revenue : 0,
        dnaToRevenue: revenue > 0 ? depreciation / revenue : 0,
      };
    });

    const avgEbitdaMargin = historicalData.reduce((sum, d) => sum + d.ebitdaMargin, 0) / historicalData.length;
    const avgCapexToRevenue = historicalData.reduce((sum, d) => sum + d.capexToRevenue, 0) / historicalData.length;
    const avgDnaToRevenue = historicalData.reduce((sum, d) => sum + d.dnaToRevenue, 0) / historicalData.length;
    const avgTaxRate = 0.25;

    // Proyección
    let lastRevenue = sortedIncome[0]?.revenue || 0;
    let cumulativeDiscountedFCF = 0;
    let lastEbitda = 0;

    for (let i = 1; i <= 5; i++) {
      const revenue = lastRevenue * (1 + projectedGrowthRate / 100);
      const ebitda = revenue * avgEbitdaMargin;
      const depreciation = revenue * avgDnaToRevenue;
      const ebit = ebitda - depreciation;
      const nopat = ebit * (1 - avgTaxRate);
      const capex = revenue * avgCapexToRevenue;
      const unleveredFCF = nopat + depreciation - capex;
      const discountFactor = 1 / Math.pow(1 + effectiveDiscountRate / 100, i);
      cumulativeDiscountedFCF += unleveredFCF * discountFactor;
      lastRevenue = revenue;
      lastEbitda = ebitda;
    }

    // Terminal value
    const terminalValue = lastEbitda * exitMultiple;
    const pvTerminalValue = terminalValue / Math.pow(1 + effectiveDiscountRate / 100, 5);
    const totalEV = cumulativeDiscountedFCF + pvTerminalValue;

    // Equity value
    const recentBalance = sortedBalance[0] || {};
    const totalDebt = recentBalance.totalDebt || recentBalance.longTermDebt || 0;
    const cash = recentBalance.cashAndCashEquivalents || 0;
    const equityValue = totalEV - totalDebt + cash;

    const sharesOutstanding =
      quote?.sharesOutstanding ||
      profile?.sharesOutstanding ||
      (quote?.marketCap && quote?.price ? quote.marketCap / quote.price : 0) ||
      sortedIncome[0]?.weightedAverageShsOut ||
      sortedIncome[0]?.weightedAverageShsOutDil ||
      1;

    return {
      equityValue,
      valuePerShare: equityValue / sharesOutstanding,
      totalEV,
    };
  }, [income, balance, cashFlow, quote, profile, effectiveDiscountRate, exitMultiple, projectedGrowthRate]);

  // ────────────────────────────────────────────────
  // Cálculo principal de valuaciones
  // ────────────────────────────────────────────────
  useEffect(() => {
    const calculate = () => {
      setLoading(true);
      setError(null);

      try {
        // Ordenar datos
        const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const lastIncome = sortedIncome[0] || {};
        const lastBalance = sortedBalance[0] || {};
        const lastCashFlow = sortedCashFlow[0] || {};
        const prevBalance = sortedBalance[1] || {};

        // ────────────────────────────────────────────────
        // Variables base
        // ────────────────────────────────────────────────
        // Get dividends with fallback field names
        const dividendsPaid = Math.abs(
          lastCashFlow.dividendsPaid ||
          lastCashFlow.paymentOfDividends ||
          lastCashFlow.commonStockDividendsPaid ||
          lastCashFlow.dividendsPaidOnCommonStock ||
          lastCashFlow.dividendsCommonStock ||
          0
        );
        const d0 = dividendsPaid / (lastIncome.weightedAverageShsOutDil || 1);
        const gs = 0.103; // Sustainable growth (placeholder)
        const ks = 0.0544; // Cost of equity (placeholder)
        const beta = profile.beta || 1;
        const fcfo = (lastCashFlow.freeCashFlow || 0) / (lastIncome.weightedAverageShsOutDil || 1);
        const bookValue = (lastBalance.totalStockholdersEquity || 0) / (lastIncome.weightedAverageShsOutDil || 1);
        const epsTTM = lastIncome.epsdiluted || lastIncome.eps || (lastIncome.netIncome / lastIncome.weightedAverageShsOutDil) || 0;
        const meanTarget = priceTarget?.lastQuarterAvgPriceTarget || 0;
        const currentPrice = quote?.price || 0;
        const sharesOutstanding = lastIncome.weightedAverageShsOutDil || quote?.sharesOutstanding || 1;

        // ────────────────────────────────────────────────
        // 1. RIM (Residual Income Model) - Ohlson Model
        // Pt = bt + α1·ox_t^a + α2·oa_t + α3·vt
        // Donde:
        // - bt = book value per share
        // - ox_t^a = abnormal earnings = (ROE - r) * book value
        // - oa_t = other information (usamos analyst growth estimate como proxy)
        // - α1, α2, α3 son funciones de omega y gamma
        // ────────────────────────────────────────────────
        const roe = lastBalance.totalStockholdersEquity > 0
          ? lastIncome.netIncome / lastBalance.totalStockholdersEquity
          : 0;
        const r = ks; // required return
        const abnormalEarnings = (roe - r) * bookValue;

        // Analyst growth estimate como proxy para "other information"
        const analystGrowth = (priceTarget?.lastQuarterAvgPriceTarget && currentPrice > 0)
          ? (priceTarget.lastQuarterAvgPriceTarget / currentPrice - 1)
          : 0.05;

        // Ohlson model coefficients
        // α1 = ω / (1 + r - ω)
        // α2 = (1 + r) / ((1 + r - ω)(1 + r - γ))
        // α3 = γ / (1 + r - γ)
        const alpha1 = effectiveOmega / (1 + r - effectiveOmega);
        const alpha2 = (1 + r) / ((1 + r - effectiveOmega) * (1 + r - effectiveGamma));
        const alpha3 = effectiveGamma / (1 + r - effectiveGamma);

        const rimValue = bookValue + alpha1 * abnormalEarnings + alpha2 * analystGrowth * epsTTM + alpha3 * analystGrowth;

        // ────────────────────────────────────────────────
        // 2. DCF (from internal calculation)
        // ────────────────────────────────────────────────
        const dcfValue = dcfCalculation?.valuePerShare || 0;

        // ────────────────────────────────────────────────
        // 3. EPS * Benchmark (TTM EPS × avg competitor P/E)
        // ────────────────────────────────────────────────
        const avgPeerPE = peerPE.length > 0
          ? peerPE.reduce((sum, p) => sum + (p.pe || 0), 0) / peerPE.length
          : 20; // Default P/E if no peers
        const epsBenchmarkValue = epsTTM * avgPeerPE;

        // ────────────────────────────────────────────────
        // 4. Stochastic DCF
        // Terminal Value con ajuste estocástico:
        // TV = FCF_n × (1 + g) / (r - g) × exp(-λσ²/2)
        // Donde λ es risk aversion y σ es volatility
        // ────────────────────────────────────────────────
        const fcfLast = lastCashFlow.freeCashFlow || 0;
        const terminalGrowth = glong;
        const stochasticAdjustment = Math.exp(-effectiveLambda * Math.pow(effectiveVolatility, 2) / 2);

        // Base DCF terminal value
        const baseTVPerShare = dcfCalculation?.valuePerShare || 0;
        const stochasticDCFValue = baseTVPerShare * stochasticAdjustment;

        // ────────────────────────────────────────────────
        // 5. Bayesian Valuation (NK DSGE Model)
        // Sistema simplificado:
        // IS Curve: yt = E[yt+1] - (1/σ)(it - E[πt+1] - rn)
        // Phillips Curve: πt = β·E[πt+1] + κ·yt
        // Taylor Rule: it = rn + φπ·πt + φy·yt
        //
        // Valuación: P = E[CF] / (r + risk_premium)
        // Risk premium derivado del DSGE
        // ────────────────────────────────────────────────

        // Estimación de output gap basado en revenue growth
        const revenueGrowth = sortedIncome.length > 1 && sortedIncome[1].revenue > 0
          ? (sortedIncome[0].revenue - sortedIncome[1].revenue) / sortedIncome[1].revenue
          : 0.05;

        // Simplified DSGE-implied risk premium
        // En estado estacionario: π* = 0, y* = 0
        // Risk premium = κ * |output_gap| + inflation_uncertainty
        const outputGap = revenueGrowth - 0.03; // Assuming 3% trend growth
        const impliedInflation = effectiveKappa * outputGap;
        const dsgeRiskPremium = Math.abs(effectiveKappa * outputGap) + 0.02; // Base 2% risk premium

        // Policy rate from Taylor rule
        const rNatural = 0.02; // Natural rate
        const policyRate = rNatural + effectivePhiPi * impliedInflation + effectivePhiY * outputGap;

        // Discount rate adjusted for DSGE risk
        const dsgeDiscountRate = Math.max(0.05, policyRate + dsgeRiskPremium);

        // Gordon Growth Model with DSGE discount rate
        const expectedCashFlow = fcfo * (1 + glong);
        const bayesianValue = expectedCashFlow > 0 && dsgeDiscountRate > glong
          ? expectedCashFlow / (dsgeDiscountRate - glong)
          : bookValue; // Fallback to book value

        // ────────────────────────────────────────────────
        // 6. HJM (Heath-Jarrow-Morton) Model
        // Forward rate dynamics: df(t,T) = α(t,T)dt + σ(t,T)dW(t)
        // No-arbitrage condition: α(t,T) = σ(t,T) ∫[t,T] σ(t,s)ds
        //
        // Para valuación: usamos forward rates para descontar
        // y ajustamos por volatilidad del term structure
        // ────────────────────────────────────────────────

        // Simplified HJM implementation
        // Assume Vasicek-type volatility structure: σ(t,T) = σ * e^(-a(T-t))
        const a = Math.max(0.01, effectiveHjmMeanReversion); // Ensure a > 0
        const sigma = effectiveHjmSigma;

        // Initial forward rate (use risk-free rate as base)
        // API returns riskFreeRate as percentage (e.g., 3.83 = 3.83%), convert to decimal
        const apiRiskFreeRate = dcfCustom?.riskFreeRate;
        const f0 = apiRiskFreeRate ? apiRiskFreeRate / 100 : 0.04;

        // Calculate HJM drift (no-arbitrage)
        // α(t,T) = σ² * (1 - e^(-a(T-t))) / a
        const T = n; // Use projection years
        const hjmDrift = Math.pow(sigma, 2) * (1 - Math.exp(-a * T)) / a;

        // Forward rate at time T (capped to reasonable range)
        const forwardRate = Math.min(0.15, Math.max(0.02, f0 + hjmDrift));

        // For HJM valuation, we use the DCF approach but with stochastic rate adjustment
        // The key insight: HJM adjusts the discount rate based on term structure dynamics

        // HJM-adjusted discount rate = base rate + cost of equity premium
        // For equities, we need to add equity risk premium to the risk-free rate
        const equityRiskPremium = (profile?.beta || 1) * 0.055; // Beta * market risk premium (~5.5%)
        const hjmEquityRate = forwardRate + equityRiskPremium;

        // Ensure the discount rate is materially higher than growth rate
        const effectiveHjmDiscountRate = Math.max(hjmEquityRate, glong + 0.03);

        // HJM valuation: FCF stream discounted with HJM-derived rates
        // Use the same FCF growth rate as DCF model for consistency
        const hjmGrowthRate = projectedGrowthRate / 100;
        let hjmPV = 0;
        for (let t = 1; t <= n; t++) {
          // Time-varying forward rate with equity premium
          const fRate = f0 + sigma * sigma * (1 - Math.exp(-a * t)) / a + equityRiskPremium;
          const adjustedRate = Math.max(fRate, 0.05); // Minimum 5% discount rate for equities
          const discount = 1 / Math.pow(1 + adjustedRate, t);
          const projectedFCF = fcfo * Math.pow(1 + hjmGrowthRate, t);
          hjmPV += projectedFCF * discount;
        }

        // Terminal value with HJM discount
        // Use Gordon Growth with HJM-derived discount rate
        const terminalDenom = Math.max(effectiveHjmDiscountRate - glong, 0.02);
        const hjmTerminalFCF = fcfo * Math.pow(1 + hjmGrowthRate, n) * (1 + glong);
        const hjmTerminalValue = hjmTerminalFCF / terminalDenom;

        // Discount terminal value back to present
        const hjmPVTerminal = hjmTerminalValue / Math.pow(1 + effectiveHjmDiscountRate, n);

        const hjmValue = hjmPV + hjmPVTerminal;

        // ────────────────────────────────────────────────
        // FCFE (Free Cash Flow to Equity) Valuation
        // FCFE = Net Income + D&A - CapEx - ΔNWC + Net Borrowing
        // Pₜ = FCFE_{t+1} / (r_e - g) / Shares Outstanding
        // ────────────────────────────────────────────────
        const netIncome = lastIncome.netIncome || 0;
        const dna = lastIncome.depreciationAndAmortization || lastCashFlow.depreciationAndAmortization || 0;
        const capex = Math.abs(lastCashFlow.capitalExpenditure || 0);
        const prevTotalDebt = prevBalance.totalDebt || prevBalance.longTermDebt || 0;
        const currentTotalDebt = lastBalance.totalDebt || lastBalance.longTermDebt || 0;
        const netBorrowing = currentTotalDebt - prevTotalDebt;
        const prevWC = (prevBalance.totalCurrentAssets || 0) - (prevBalance.totalCurrentLiabilities || 0);
        const currWC = (lastBalance.totalCurrentAssets || 0) - (lastBalance.totalCurrentLiabilities || 0);
        const deltaWC = currWC - prevWC;

        // FCFE aggregate
        const fcfeAggregate = netIncome + dna - capex - deltaWC + netBorrowing;
        const fcfePerShare = fcfeAggregate / sharesOutstanding;

        // FCFE 2-Stage: Gordon Growth on FCFE per share
        const fcfeGrowth1 = projectedGrowthRate / 100; // High growth period
        const re = effectiveDiscountRate / 100; // Cost of equity

        // 2-Stage FCFE: Explicit forecast + Terminal
        let fcfe2StageValue = 0;
        let lastFCFE = fcfePerShare;
        for (let t = 1; t <= n; t++) {
          const projFCFE = lastFCFE * (1 + fcfeGrowth1);
          const discountedFCFE = projFCFE / Math.pow(1 + re, t);
          fcfe2StageValue += discountedFCFE;
          lastFCFE = projFCFE;
        }
        // Terminal value for FCFE
        const fcfeTerminal = re > glong ? (lastFCFE * (1 + glong)) / (re - glong) : 0;
        const fcfeTerminalPV = fcfeTerminal / Math.pow(1 + re, n);
        fcfe2StageValue += fcfeTerminalPV;

        // 3-Stage FCFE (high growth -> transition -> stable)
        let fcfe3StageValue = 0;
        lastFCFE = fcfePerShare;
        const transitionYears = h;
        // Phase 1: High growth
        for (let t = 1; t <= n; t++) {
          const projFCFE = lastFCFE * (1 + fcfeGrowth1);
          const discountedFCFE = projFCFE / Math.pow(1 + re, t);
          fcfe3StageValue += discountedFCFE;
          lastFCFE = projFCFE;
        }
        // Phase 2: Transition (declining growth from high to glong)
        for (let t = 1; t <= transitionYears; t++) {
          const transGrowth = fcfeGrowth1 - (fcfeGrowth1 - glong) * (t / transitionYears);
          const projFCFE = lastFCFE * (1 + transGrowth);
          const discountedFCFE = projFCFE / Math.pow(1 + re, n + t);
          fcfe3StageValue += discountedFCFE;
          lastFCFE = projFCFE;
        }
        // Phase 3: Terminal stable growth
        const fcfe3Terminal = re > glong ? (lastFCFE * (1 + glong)) / (re - glong) : 0;
        const fcfe3TerminalPV = fcfe3Terminal / Math.pow(1 + re, n + transitionYears);
        fcfe3StageValue += fcfe3TerminalPV;

        // ────────────────────────────────────────────────
        // FCFF (Free Cash Flow to Firm) Valuation
        // FCFF = NOPAT + D&A - CapEx - ΔNWC
        // Pₜ = [FCFF_{t+1} / (WACC - g) - Net Debt] / Shares Outstanding
        // ────────────────────────────────────────────────
        const taxRate = lastIncome.incomeTaxExpense && lastIncome.incomeBeforeTax
          ? lastIncome.incomeTaxExpense / lastIncome.incomeBeforeTax
          : 0.25;
        const ebit = lastIncome.operatingIncome || lastIncome.ebit || 0;
        const nopat = ebit * (1 - taxRate);

        // FCFF aggregate
        const fcffAggregate = nopat + dna - capex - deltaWC;
        const wacc = effectiveDiscountRate / 100;
        const netDebt = currentTotalDebt - (lastBalance.cashAndCashEquivalents || 0);

        // 2-Stage FCFF: Explicit forecast + Terminal
        let fcff2StageEV = 0;
        let lastFCFF = fcffAggregate;
        for (let t = 1; t <= n; t++) {
          const projFCFF = lastFCFF * (1 + fcfeGrowth1);
          const discountedFCFF = projFCFF / Math.pow(1 + wacc, t);
          fcff2StageEV += discountedFCFF;
          lastFCFF = projFCFF;
        }
        // Terminal value for FCFF
        const fcffTerminal = wacc > glong ? (lastFCFF * (1 + glong)) / (wacc - glong) : 0;
        const fcffTerminalPV = fcffTerminal / Math.pow(1 + wacc, n);
        fcff2StageEV += fcffTerminalPV;
        // Convert to equity value per share
        const fcff2StageEquityValue = fcff2StageEV - netDebt;
        const fcff2StageValue = fcff2StageEquityValue / sharesOutstanding;

        // 3-Stage FCFF
        let fcff3StageEV = 0;
        lastFCFF = fcffAggregate;
        // Phase 1: High growth
        for (let t = 1; t <= n; t++) {
          const projFCFF = lastFCFF * (1 + fcfeGrowth1);
          const discountedFCFF = projFCFF / Math.pow(1 + wacc, t);
          fcff3StageEV += discountedFCFF;
          lastFCFF = projFCFF;
        }
        // Phase 2: Transition
        for (let t = 1; t <= transitionYears; t++) {
          const transGrowth = fcfeGrowth1 - (fcfeGrowth1 - glong) * (t / transitionYears);
          const projFCFF = lastFCFF * (1 + transGrowth);
          const discountedFCFF = projFCFF / Math.pow(1 + wacc, n + t);
          fcff3StageEV += discountedFCFF;
          lastFCFF = projFCFF;
        }
        // Phase 3: Terminal
        const fcff3Terminal = wacc > glong ? (lastFCFF * (1 + glong)) / (wacc - glong) : 0;
        const fcff3TerminalPV = fcff3Terminal / Math.pow(1 + wacc, n + transitionYears);
        fcff3StageEV += fcff3TerminalPV;
        const fcff3StageEquityValue = fcff3StageEV - netDebt;
        const fcff3StageValue = fcff3StageEquityValue / sharesOutstanding;

        // ────────────────────────────────────────────────
        // Custom Advance DCF (from API)
        // ────────────────────────────────────────────────
        const advanceDCFValue = dcfCustom?.equityValue && quote?.sharesOutstanding
          ? dcfCustom.equityValue / quote.sharesOutstanding
          : null;

        // ────────────────────────────────────────────────
        // Métodos tradicionales (existentes)
        // ────────────────────────────────────────────────
        const calculatedMethods: ValuationMethod[] = [
          {
            name: '2-Stage DDM',
            value: d0 * (1 + gs) / (ks - gs) * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) + sharePriceT5 / Math.pow(1 + ks, n),
            enabled: true,
            description: 'Dividend Discount Model - 2 etapas',
          },
          {
            name: '3-Stage DDM',
            value: d0 * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) / (ks - gs) + d0 * Math.pow(1 + gs, n) * (1 + glong) / (ks - glong),
            enabled: true,
            description: 'Dividend Discount Model - 3 etapas',
          },
          {
            name: 'H Model',
            value: (d0 * (1 + glong) + d0 * (gs - glong) * h) / (ks - glong),
            enabled: true,
            description: 'H-Model para crecimiento decreciente',
          },
          {
            name: '2-Stage FCF',
            value: fcfo * (1 - Math.pow(1 + gs, n) / Math.pow(1 + ks, n)) / (ks - gs) + sharePriceT5 / Math.pow(1 + ks, n),
            enabled: true,
            description: 'Free Cash Flow - 2 etapas',
          },
          {
            name: '3-stage FCF',
            value: fcfo * (1 - Math.pow(1 + gs, n)) / (ks - gs) + fcfo * h * (gs - glong) / ((ks - glong) * Math.pow(1 + ks, n)) + sharePriceT5 / Math.pow(1 + ks, 2 * n),
            enabled: true,
            description: 'Free Cash Flow - 3 etapas',
          },
          {
            name: 'Mean Target',
            value: meanTarget,
            enabled: true,
            description: 'Precio objetivo promedio de analistas',
          },
          {
            name: 'Graham Method',
            value: Math.sqrt(22.5 * bookValue * epsTTM),
            enabled: true,
            description: 'V = sqrt(22.5 * BV * EPS)',
          },
          // ────────────────────────────────────────────────
          // Métodos avanzados
          // ────────────────────────────────────────────────
          {
            name: 'RIM (Ohlson)',
            value: rimValue > 0 && isFinite(rimValue) ? rimValue : null,
            enabled: true,
            description: `Residual Income Model - Ohlson (ω=${effectiveOmega.toFixed(2)}, γ=${effectiveGamma.toFixed(2)})`,
          },
          {
            name: 'DCF',
            value: dcfValue > 0 && isFinite(dcfValue) ? dcfValue : null,
            enabled: true,
            description: `DCF interno (WACC=${effectiveDiscountRate.toFixed(1)}%, Exit=${exitMultiple}x)`,
          },
          {
            name: 'EPS*Benchmark',
            value: epsBenchmarkValue > 0 && isFinite(epsBenchmarkValue) ? epsBenchmarkValue : null,
            enabled: true,
            description: `EPS TTM ($${epsTTM.toFixed(2)}) × Avg Peer P/E (${avgPeerPE.toFixed(1)}x)`,
          },
          {
            name: 'Stochastic DCF',
            value: stochasticDCFValue > 0 && isFinite(stochasticDCFValue) ? stochasticDCFValue : null,
            enabled: true,
            description: `DCF con ajuste estocástico (σ=${effectiveVolatility.toFixed(2)}, λ=${effectiveLambda.toFixed(2)})`,
          },
          {
            name: 'Bayesian (NK DSGE)',
            value: bayesianValue > 0 && isFinite(bayesianValue) ? bayesianValue : null,
            enabled: true,
            description: `New Keynesian DSGE (φπ=${effectivePhiPi.toFixed(2)}, φy=${effectivePhiY.toFixed(2)}, κ=${effectiveKappa.toFixed(3)})`,
          },
          {
            name: 'HJM',
            value: hjmValue > 0 && isFinite(hjmValue) ? hjmValue : null,
            enabled: true,
            description: `Heath-Jarrow-Morton (σ=${effectiveHjmSigma.toFixed(3)}, a=${effectiveHjmMeanReversion.toFixed(2)})`,
          },
          // ────────────────────────────────────────────────
          // FCFE Methods
          // ────────────────────────────────────────────────
          {
            name: '2-Stage FCFE',
            value: fcfe2StageValue > 0 && isFinite(fcfe2StageValue) ? fcfe2StageValue : null,
            enabled: true,
            description: `FCFE 2 etapas (Re=${(re * 100).toFixed(1)}%, g1=${(fcfeGrowth1 * 100).toFixed(1)}%)`,
          },
          {
            name: '3-Stage FCFE',
            value: fcfe3StageValue > 0 && isFinite(fcfe3StageValue) ? fcfe3StageValue : null,
            enabled: true,
            description: `FCFE 3 etapas (H=${transitionYears} años transición)`,
          },
          // ────────────────────────────────────────────────
          // FCFF Methods
          // ────────────────────────────────────────────────
          {
            name: '2-Stage FCFF',
            value: fcff2StageValue > 0 && isFinite(fcff2StageValue) ? fcff2StageValue : null,
            enabled: true,
            description: `FCFF 2 etapas (WACC=${(wacc * 100).toFixed(1)}%, Net Debt=${(netDebt / 1e9).toFixed(1)}B)`,
          },
          {
            name: '3-Stage FCFF',
            value: fcff3StageValue > 0 && isFinite(fcff3StageValue) ? fcff3StageValue : null,
            enabled: true,
            description: `FCFF 3 etapas (WACC=${(wacc * 100).toFixed(1)}%)`,
          },
          // ────────────────────────────────────────────────
          // External DCF Values
          // ────────────────────────────────────────────────
          {
            name: 'Advance DCF (API)',
            value: advanceDCFValue && advanceDCFValue > 0 && isFinite(advanceDCFValue) ? advanceDCFValue : null,
            enabled: true,
            description: 'Equity Value Per Share from FMP Custom DCF',
          },
        ];

        setMethods(calculatedMethods);
      } catch (err: any) {
        setError(err.message || 'Error al calcular valuaciones');
      } finally {
        setLoading(false);
      }
    };

    calculate();
  }, [
    h, glong, n, sharePriceT5, sharePriceTxCAGR,
    income, balance, cashFlow, priceTarget, profile, quote,
    effectiveOmega, effectiveGamma, // RIM params
    effectiveDiscountRate, exitMultiple, projectedGrowthRate, // DCF params
    effectiveVolatility, effectiveLambda, // Stochastic params
    effectivePhiPi, effectivePhiY, effectiveBetaDSGE, effectiveKappa, // DSGE params
    effectiveHjmSigma, effectiveHjmMeanReversion, // HJM params
    peerPE, dcfCalculation, dcfCustom, // Include dcfCustom for Advance DCF
  ]);

  const toggleMethod = (index: number) => {
    setMethods(prev =>
      prev.map((m, i) => i === index ? { ...m, enabled: !m.enabled } : m)
    );
  };

  // Calcular promedio solo de métodos habilitados con valores válidos
  const enabledMethods = methods.filter(m => m.enabled && m.value !== null && m.value > 0 && isFinite(m.value));
  const averageVal = enabledMethods.length > 0
    ? enabledMethods.reduce((sum, m) => sum + (m.value || 0), 0) / enabledMethods.length
    : null;

  // Notificar al padre cuando cambie el averageVal
  useEffect(() => {
    if (onAverageValChange) {
      onAverageValChange(averageVal);
    }
  }, [averageVal, onAverageValChange]);

  if (loading) return <p className="text-xl text-gray-300 py-10 text-center">Calculando valuaciones...</p>;
  if (error) return <p className="text-xl text-red-400 py-10 text-center">Error: {error}</p>;

  return (
    <div className="space-y-10 text-center">
      <h3 className="text-3xl font-bold text-gray-100">
        Valuaciones - {ticker}
      </h3>

      {/* ────────────────────────────────────────────────
          Inputs básicos
          ──────────────────────────────────────────────── */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h4 className="text-xl font-bold text-gray-100 mb-4 text-left">Parametros Basicos (DDM/FCF)</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">H (anos transicion)</label>
            <input
              type="number"
              value={h}
              onChange={(e) => setH(Number(e.target.value) || 5)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Glong (crecimiento LP)</label>
            <input
              type="number"
              step="0.01"
              value={glong}
              onChange={(e) => setGlong(Number(e.target.value) || 0.04)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">N (anos proyeccion)</label>
            <input
              type="number"
              value={n}
              onChange={(e) => setN(Number(e.target.value) || 5)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">CAGR Share Price TX (%)</label>
            <input
              type="number"
              step="1"
              value={sharePriceTxCAGR}
              onChange={(e) => setSharePriceTxCAGR(Number(e.target.value) || 10)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
            <p className="text-xs text-gray-500 mt-1">Crecimiento anual esperado del precio</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Share Price T{n}</label>
            <div className="px-3 py-2 border border-gray-600 rounded-lg bg-gray-700 text-gray-100 font-semibold">
              ${sharePriceT5.toFixed(2)}
            </div>
            <p className="text-xs text-blue-400 mt-1">= ${currentPrice.toFixed(2)} × (1+{sharePriceTxCAGR}%)^{n}</p>
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────
          Parámetros DCF
          ──────────────────────────────────────────────── */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h4 className="text-xl font-bold text-gray-100 mb-4 text-left">Parametros DCF</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Discount Rate (WACC) %</label>
            <input
              type="number"
              step="0.5"
              value={discountRate ?? effectiveDiscountRate}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setDiscountRate(isNaN(val) ? null : val);
              }}
              placeholder={`Auto: ${calculatedDefaultWACC.toFixed(2)}%`}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
            {discountRate === null && (
              <p className="text-xs text-blue-400 mt-1">
                Auto: Promedio WACC Tab ({((calculatedDefaultWACC * 2 - (dcfCustom?.wacc || calculatedDefaultWACC))).toFixed(1)}%) + Advance DCF ({dcfCustom?.wacc ? dcfCustom.wacc.toFixed(1) : 'N/A'}%)
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Exit Multiple (EV/EBITDA)</label>
            <input
              type="number"
              step="0.5"
              value={exitMultiple}
              onChange={(e) => setExitMultiple(Number(e.target.value) || 12)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Revenue Growth % (proyectado)</label>
            <input
              type="number"
              step="0.5"
              value={projectedGrowthRate}
              onChange={(e) => setProjectedGrowthRate(Number(e.target.value) || 5)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────
          Parámetros Modelos Avanzados
          ──────────────────────────────────────────────── */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h4 className="text-xl font-bold text-gray-100 mb-4 text-left">Parámetros Modelos Avanzados</h4>

        {/* RIM Ohlson */}
        <div className="mb-6">
          <h5 className="text-lg font-semibold text-blue-400 mb-3 text-left">RIM (Ohlson Model)</h5>
          <p className="text-xs text-gray-500 mb-2 text-left">ω calculado via AR(1) en ROE histórico. γ basado en beta y sector.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">ω (persistencia earnings)</label>
              <input
                type="number"
                step="0.01"
                value={omega ?? effectiveOmega}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setOmega(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.omega.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {omega === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">γ (persistencia other info)</label>
              <input
                type="number"
                step="0.01"
                value={gamma ?? effectiveGamma}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setGamma(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.gamma.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {gamma === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
          </div>
        </div>

        {/* Stochastic DCF */}
        <div className="mb-6">
          <h5 className="text-lg font-semibold text-purple-400 mb-3 text-left">Stochastic DCF</h5>
          <p className="text-xs text-gray-500 mb-2 text-left">σ = desv. estándar del crecimiento FCF. λ = precio de riesgo (Sharpe ratio estimado).</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">σ (volatilidad FCF)</label>
              <input
                type="number"
                step="0.01"
                value={volatility ?? effectiveVolatility}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolatility(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.sigmaFCF.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {volatility === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">λ (market price of risk)</label>
              <input
                type="number"
                step="0.1"
                value={lambda ?? effectiveLambda}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setLambda(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.lambdaRisk.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {lambda === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
          </div>
        </div>

        {/* NK DSGE */}
        <div className="mb-6">
          <h5 className="text-lg font-semibold text-green-400 mb-3 text-left">Bayesian (NK DSGE)</h5>
          <p className="text-xs text-gray-500 mb-2 text-left">Parámetros de política monetaria (Taylor rule) y curva de Phillips. κ basado en margen bruto.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">φπ (Taylor inflation)</label>
              <input
                type="number"
                step="0.1"
                value={phi_pi ?? effectivePhiPi}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setPhi_pi(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.phiPi.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {phi_pi === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">φy (Taylor output)</label>
              <input
                type="number"
                step="0.1"
                value={phi_y ?? effectivePhiY}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setPhi_y(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.phiY.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {phi_y === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">κ (Phillips slope)</label>
              <input
                type="number"
                step="0.01"
                value={kappa ?? effectiveKappa}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setKappa(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.kappaDSGE.toFixed(3)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {kappa === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">β (discount factor)</label>
              <input
                type="number"
                step="0.01"
                value={betaDSGE ?? effectiveBetaDSGE}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setBetaDSGE(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.betaDSGE.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {betaDSGE === null && <p className="text-xs text-blue-400 mt-1">Estándar: 0.99</p>}
            </div>
          </div>
        </div>

        {/* HJM */}
        <div>
          <h5 className="text-lg font-semibold text-orange-400 mb-3 text-left">HJM (Heath-Jarrow-Morton)</h5>
          <p className="text-xs text-gray-500 mb-2 text-left">Dinámica de tasas forward. σ basado en nivel de tasas, a basado en beta del stock.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">σ (forward rate vol)</label>
              <input
                type="number"
                step="0.001"
                value={hjmSigma ?? effectiveHjmSigma}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setHjmSigma(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.hjmSigma.toFixed(3)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {hjmSigma === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">a (mean reversion)</label>
              <input
                type="number"
                step="0.01"
                value={hjmMeanReversion ?? effectiveHjmMeanReversion}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setHjmMeanReversion(isNaN(val) ? null : val);
                }}
                placeholder={`Auto: ${calculatedDefaults.hjmMeanReversion.toFixed(2)}`}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
              {hjmMeanReversion === null && <p className="text-xs text-blue-400 mt-1">Auto-calculado</p>}
            </div>
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────
          Info de Peers (para EPS*Benchmark)
          ──────────────────────────────────────────────── */}
      {peerPE.length > 0 && (
        <div className="bg-gray-800 p-4 rounded-xl border border-gray-700">
          <h5 className="text-lg font-semibold text-gray-200 mb-2 text-left">P/E de Competidores (para EPS*Benchmark)</h5>
          <div className="flex flex-wrap gap-3">
            {peerPE.map((peer) => (
              <span key={peer.symbol} className="px-3 py-1 bg-gray-700 rounded-lg text-sm text-gray-300">
                {peer.symbol}: {peer.pe?.toFixed(1)}x
              </span>
            ))}
            <span className="px-3 py-1 bg-blue-900 rounded-lg text-sm text-blue-300 font-semibold">
              Promedio: {(peerPE.reduce((s, p) => s + (p.pe || 0), 0) / peerPE.length).toFixed(1)}x
            </span>
          </div>
        </div>
      )}

      {/* ────────────────────────────────────────────────
          Grid de métodos
          ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {methods.map((method, index) => (
          <div
            key={index}
            className={`p-4 rounded-xl border shadow-sm text-center transition-all ${
              method.enabled
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-900 border-gray-800 opacity-50'
            }`}
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={method.enabled}
                onChange={() => toggleMethod(index)}
                className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-600 rounded cursor-pointer"
              />
              <h4 className="text-lg font-semibold text-gray-100">
                {method.name}
              </h4>
            </div>
            <p className={`text-3xl font-bold ${method.enabled ? 'text-blue-400' : 'text-gray-600'}`}>
              {method.value !== null && method.value > 0 && isFinite(method.value) ? `$${method.value.toFixed(2)}` : '—'}
            </p>
            {method.description && (
              <p className="text-xs text-gray-500 mt-2 truncate" title={method.description}>
                {method.description}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ────────────────────────────────────────────────
          Average
          ──────────────────────────────────────────────── */}
      <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700 shadow-xl mt-8 text-center">
        <h4 className="text-3xl font-bold text-gray-100 mb-4">
          Average Valuaciones
        </h4>
        <p className="text-6xl font-black text-blue-400 tracking-tight">
          {averageVal !== null ? `$${averageVal.toFixed(2)}` : '—'}
        </p>
        <p className="text-xl text-blue-300 mt-4">
          (basado en {enabledMethods.length} métodos activos)
        </p>

        {/* Comparación con precio actual */}
        {quote?.price && averageVal && (
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="bg-gray-700 p-4 rounded-xl">
              <p className="text-sm text-gray-400">Precio Actual</p>
              <p className="text-2xl font-bold text-gray-200">${quote.price.toFixed(2)}</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-xl">
              <p className="text-sm text-gray-400">Valor Intrínseco</p>
              <p className="text-2xl font-bold text-blue-400">${averageVal.toFixed(2)}</p>
            </div>
            <div className="bg-gray-700 p-4 rounded-xl">
              <p className="text-sm text-gray-400">Upside/Downside</p>
              <p className={`text-2xl font-bold ${averageVal > quote.price ? 'text-green-400' : 'text-red-400'}`}>
                {((averageVal / quote.price - 1) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500 text-center italic">
        Desmarca métodos o cambia inputs para recalcular. Los cambios se reflejan automáticamente en Inputs y Análisis Final.
      </p>
    </div>
  );
}
