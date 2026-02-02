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
  onAverageValChange,
}: Props) {
  // ────────────────────────────────────────────────
  // Estados para parámetros del modelo
  // ────────────────────────────────────────────────
  const [h, setH] = useState<number>(5);
  const [glong, setGlong] = useState<number>(0.04);
  const [n, setN] = useState<number>(5);
  const [sharePriceT5, setSharePriceT5] = useState<number>(0);
  const [sharePriceT5CAGR, setSharePriceT5CAGR] = useState<number>(0.1);

  // Parámetros adicionales para modelos avanzados
  const [discountRate, setDiscountRate] = useState<number>(10); // WACC en %
  const [exitMultiple, setExitMultiple] = useState<number>(12);
  const [projectedGrowthRate, setProjectedGrowthRate] = useState<number>(5);

  // Parámetros Ohlson RIM
  const [omega, setOmega] = useState<number>(0.62); // Persistencia de abnormal earnings
  const [gamma, setGamma] = useState<number>(0.32); // Persistencia de "other info"

  // Parámetros Stochastic DCF
  const [volatility, setVolatility] = useState<number>(0.25); // sigma
  const [lambda, setLambda] = useState<number>(0.5); // risk aversion

  // Parámetros NK DSGE (Bayesian)
  const [phi_pi, setPhi_pi] = useState<number>(1.5); // Taylor rule inflation response
  const [phi_y, setPhi_y] = useState<number>(0.5); // Taylor rule output gap response
  const [betaDSGE, setBetaDSGE] = useState<number>(0.99); // Discount factor
  const [kappa, setKappa] = useState<number>(0.3); // Phillips curve slope

  // Parámetros HJM
  const [hjmSigma, setHjmSigma] = useState<number>(0.01); // Volatility of forward rate
  const [hjmMeanReversion, setHjmMeanReversion] = useState<number>(0.1); // Mean reversion speed

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
      const discountFactor = 1 / Math.pow(1 + discountRate / 100, i);
      cumulativeDiscountedFCF += unleveredFCF * discountFactor;
      lastRevenue = revenue;
      lastEbitda = ebitda;
    }

    // Terminal value
    const terminalValue = lastEbitda * exitMultiple;
    const pvTerminalValue = terminalValue / Math.pow(1 + discountRate / 100, 5);
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
  }, [income, balance, cashFlow, quote, profile, discountRate, exitMultiple, projectedGrowthRate]);

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
        const d0 = Math.abs(lastCashFlow.dividendsPaid || 0) / (lastIncome.weightedAverageShsOutDil || 1);
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
        const alpha1 = omega / (1 + r - omega);
        const alpha2 = (1 + r) / ((1 + r - omega) * (1 + r - gamma));
        const alpha3 = gamma / (1 + r - gamma);

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
        const stochasticAdjustment = Math.exp(-lambda * Math.pow(volatility, 2) / 2);

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
        const impliedInflation = kappa * outputGap;
        const dsgeRiskPremium = Math.abs(kappa * outputGap) + 0.02; // Base 2% risk premium

        // Policy rate from Taylor rule
        const rNatural = 0.02; // Natural rate
        const policyRate = rNatural + phi_pi * impliedInflation + phi_y * outputGap;

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
        const a = hjmMeanReversion;
        const sigma = hjmSigma;

        // Initial forward rate (use 10Y treasury as proxy)
        const f0 = 0.04; // Initial forward rate

        // Calculate HJM drift (no-arbitrage)
        // α(t,T) = σ² * (1 - e^(-a(T-t))) / a
        const T = 5; // 5-year horizon
        const hjmDrift = Math.pow(sigma, 2) * (1 - Math.exp(-a * T)) / a;

        // Forward rate at time T
        const forwardRate = f0 + hjmDrift;

        // Bond price factor (discount based on term structure)
        // P(0,T) = exp(-∫[0,T] f(0,s)ds) adjusted for convexity
        const convexityAdjustment = 0.5 * Math.pow(sigma, 2) * T * T;
        const bondPrice = Math.exp(-forwardRate * T + convexityAdjustment);

        // HJM valuation: FCF stream discounted with stochastic rates
        let hjmPV = 0;
        for (let t = 1; t <= 5; t++) {
          const fRate = f0 + sigma * sigma * (1 - Math.exp(-a * t)) / a;
          const discount = Math.exp(-fRate * t);
          const projectedFCF = fcfo * Math.pow(1 + glong, t);
          hjmPV += projectedFCF * discount;
        }

        // Terminal value with HJM discount
        const hjmTerminalValue = fcfo * Math.pow(1 + glong, 5) * (1 + glong) / (forwardRate - glong);
        const hjmPVTerminal = hjmTerminalValue * bondPrice;
        const hjmValue = hjmPV + hjmPVTerminal;

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
            description: `Residual Income Model - Ohlson (ω=${omega}, γ=${gamma})`,
          },
          {
            name: 'DCF',
            value: dcfValue > 0 && isFinite(dcfValue) ? dcfValue : null,
            enabled: true,
            description: `DCF interno (WACC=${discountRate}%, Exit=${exitMultiple}x)`,
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
            description: `DCF con ajuste estocástico (σ=${volatility}, λ=${lambda})`,
          },
          {
            name: 'Bayesian (NK DSGE)',
            value: bayesianValue > 0 && isFinite(bayesianValue) ? bayesianValue : null,
            enabled: true,
            description: `New Keynesian DSGE (φπ=${phi_pi}, φy=${phi_y})`,
          },
          {
            name: 'HJM',
            value: hjmValue > 0 && isFinite(hjmValue) ? hjmValue : null,
            enabled: true,
            description: `Heath-Jarrow-Morton (σ=${hjmSigma}, a=${hjmMeanReversion})`,
          },
          // Métodos placeholder para futuras implementaciones
          { name: '2 Stages FCFF', value: 0, enabled: false, description: 'FCFF 2 etapas (no implementado)' },
          { name: '3 Stages FCFE', value: 0, enabled: false, description: 'FCFE 3 etapas (no implementado)' },
          { name: '3 Stages FCFF', value: 0, enabled: false, description: 'FCFF 3 etapas (no implementado)' },
          { name: 'Graham Method 2', value: 0, enabled: false, description: 'Graham alternativo (no implementado)' },
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
    h, glong, n, sharePriceT5, sharePriceT5CAGR,
    income, balance, cashFlow, priceTarget, profile, quote,
    omega, gamma, // RIM params
    discountRate, exitMultiple, projectedGrowthRate, // DCF params
    volatility, lambda, // Stochastic params
    phi_pi, phi_y, betaDSGE, kappa, // DSGE params
    hjmSigma, hjmMeanReversion, // HJM params
    peerPE, dcfCalculation,
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
        <h4 className="text-xl font-bold text-gray-100 mb-4 text-left">Parámetros Básicos (DDM/FCF)</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">H (años transición)</label>
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
            <label className="block text-sm font-medium text-gray-300 mb-1">N (años proyección)</label>
            <input
              type="number"
              value={n}
              onChange={(e) => setN(Number(e.target.value) || 5)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Share Price t5</label>
            <input
              type="number"
              value={sharePriceT5}
              onChange={(e) => setSharePriceT5(Number(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">T5 CAGR</label>
            <input
              type="number"
              step="0.01"
              value={sharePriceT5CAGR}
              onChange={(e) => setSharePriceT5CAGR(Number(e.target.value) || 0.1)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────
          Parámetros DCF
          ──────────────────────────────────────────────── */}
      <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
        <h4 className="text-xl font-bold text-gray-100 mb-4 text-left">Parámetros DCF</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Discount Rate (WACC) %</label>
            <input
              type="number"
              step="0.5"
              value={discountRate}
              onChange={(e) => setDiscountRate(Number(e.target.value) || 10)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
            />
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">ω (persistencia earnings)</label>
              <input
                type="number"
                step="0.01"
                value={omega}
                onChange={(e) => setOmega(Number(e.target.value) || 0.62)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">γ (persistencia other info)</label>
              <input
                type="number"
                step="0.01"
                value={gamma}
                onChange={(e) => setGamma(Number(e.target.value) || 0.32)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
          </div>
        </div>

        {/* Stochastic DCF */}
        <div className="mb-6">
          <h5 className="text-lg font-semibold text-purple-400 mb-3 text-left">Stochastic DCF</h5>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">σ (volatilidad)</label>
              <input
                type="number"
                step="0.01"
                value={volatility}
                onChange={(e) => setVolatility(Number(e.target.value) || 0.25)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">λ (risk aversion)</label>
              <input
                type="number"
                step="0.1"
                value={lambda}
                onChange={(e) => setLambda(Number(e.target.value) || 0.5)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
          </div>
        </div>

        {/* NK DSGE */}
        <div className="mb-6">
          <h5 className="text-lg font-semibold text-green-400 mb-3 text-left">Bayesian (NK DSGE)</h5>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">φπ (Taylor inflation)</label>
              <input
                type="number"
                step="0.1"
                value={phi_pi}
                onChange={(e) => setPhi_pi(Number(e.target.value) || 1.5)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">φy (Taylor output)</label>
              <input
                type="number"
                step="0.1"
                value={phi_y}
                onChange={(e) => setPhi_y(Number(e.target.value) || 0.5)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">κ (Phillips slope)</label>
              <input
                type="number"
                step="0.05"
                value={kappa}
                onChange={(e) => setKappa(Number(e.target.value) || 0.3)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">β (discount factor)</label>
              <input
                type="number"
                step="0.01"
                value={betaDSGE}
                onChange={(e) => setBetaDSGE(Number(e.target.value) || 0.99)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
          </div>
        </div>

        {/* HJM */}
        <div>
          <h5 className="text-lg font-semibold text-orange-400 mb-3 text-left">HJM (Heath-Jarrow-Morton)</h5>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">σ (forward rate vol)</label>
              <input
                type="number"
                step="0.001"
                value={hjmSigma}
                onChange={(e) => setHjmSigma(Number(e.target.value) || 0.01)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">a (mean reversion)</label>
              <input
                type="number"
                step="0.01"
                value={hjmMeanReversion}
                onChange={(e) => setHjmMeanReversion(Number(e.target.value) || 0.1)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-900 text-gray-100"
              />
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
