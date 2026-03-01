'use client';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import { fetchFmp } from '@/lib/fmpClient';

interface ChainOfThoughtStep {
  step: number;
  layer: string;
  analysis: string;
  score: number;
  confidence: number;
  key_signals: string[];
}

interface SynthesisDetails {
  componentScores: Record<string, number>;
  appliedWeights: Record<string, number>;
  rawScore: number;
  finalScore: number;
  confidence: number;
}

interface DataQuality {
  completeness: number;
  sourcesUsed: number;
  totalSources: number;
}

interface SpectralCycleData {
  phase?: string;
  score?: number;
  cycleStrength?: number;
  phasePosition?: number;
  atrPct?: number;
  rsi?: number;
  tradingRegime?: string;
  dominantCycles?: { period_days: number; amplitude: number; phase_degrees: number; contribution_pct: number }[];
  rollingCurve?: { date: string; price: number; reconstructed: number; aboveRecon: boolean; position?: number }[];
  complexComponents?: { freq_index: number; period_days: number; magnitude: number; phase_rad: number; phase_deg: number; real: number; imag: number; contribution_pct: number }[];
  currentSignal?: 'bullish' | 'bearish' | 'neutral';
  windowSize?: number;
  numFreqKept?: number;
  thresholdPct?: number;
}

interface ResumenData {
  finalRecommendation: string;
  conviction: number;
  targetPrice: number;
  targetRange: [number, number];
  upsidePct: number;
  timeHorizon: string;
  marginOfSafety: string;
  overallRisk: string;
  riskLevel: string;
  keyRisks: string[];
  catalysts: string[];
  dimensionScores: Record<string, number>;
  summaryText: string;
  actionableAdvice: string;
  chainOfThought: ChainOfThoughtStep[];
  synthesisDetails: SynthesisDetails;
  dataQuality: DataQuality;
  spectralCycles?: SpectralCycleData | null;
  companyType?: 'growth' | 'value' | 'dividend' | 'blend';
  typeConfidence?: number;
  moatScore?: number;
  growthPremium?: boolean;
  scoreHistory?: { ts: string; finalScore: number; recommendation: string; targetPrice: number; upsidePct: number }[];
  scoreDelta?: number | null;
  scoreTrend?: 'improving' | 'deteriorating' | 'stable';
  causalInsight?: string;
  causalInsightEs?: string;
  rfType?: string;
  rfConf?: number;
  kmType?: string;
  gnnScores?: Record<string, number>;
  rfImportances?: Record<string, number>;
  graphCentrality?: Record<string, number>;
}

interface ResumenTabProps {
  ticker: string;
  currentPrice: number;
  advanceValueNet: any;
  companyQualityNet: any;
  keyMetricsSummary: any;
  sustainableGrowthRate: number | null;
  wacc: number | null;
  dcfValuation: number | null;
  monteCarlo: any;
  pivotAnalysis: any;
  holdersData: any;
  forecasts: any;
  diarioStats?: any;
  news?: any[];  // News articles for sentiment analysis
  averageValuation?: number | null;  // Average of all frontend valuation methods
  profile?: any;      // FMP company profile (sector, mktCap, …)
  ratiosTTM?: any;    // FMP ratios-ttm (priceEarningsRatio, dividendYield, priceToBookRatio, …)
}

export default function ResumenTab({
  ticker,
  currentPrice,
  advanceValueNet,
  companyQualityNet,
  keyMetricsSummary,
  sustainableGrowthRate,
  wacc,
  dcfValuation,
  monteCarlo,
  pivotAnalysis,
  holdersData,
  forecasts,
  diarioStats,
  news,
  averageValuation,
  profile,
  ratiosTTM,
}: ResumenTabProps) {
  const { t, locale } = useLanguage();
  const es = locale === 'es';

  // Translate finite-set backend strings to Spanish
  const tlRec = (r: string) => {
    if (!es) return r;
    return r
      .replace('Strong Buy', 'Compra Fuerte')
      .replace('Strong Sell', 'Venta Fuerte')
      .replace(/\bBuy\b/, 'Comprar')
      .replace(/\bSell\b/, 'Vender')
      .replace(/\bHold\b/, 'Mantener');
  };

  const tlRisk = (r: string) => {
    if (!es) return r;
    const map: Record<string, string> = {
      Low: 'Bajo', Moderate: 'Moderado', Elevated: 'Elevado', High: 'Alto',
    };
    return map[r] || r;
  };

  const tlSignal = (s: string): string => {
    if (!es) return s;
    return s
      // ── Valuation ──
      .replace('Significantly undervalued', 'Significativamente subvalorado')
      .replace('Mildly undervalued', 'Levemente subvalorado')
      .replace('Undervalued', 'Subvalorado')
      .replace('Slightly overvalued', 'Levemente sobrevalorado')
      .replace('Overvalued', 'Sobrevalorado')
      .replace('High valuation uncertainty', 'Alta incertidumbre de valuación')
      .replace('wide confidence interval', 'intervalo de confianza amplio')
      .replace('tight confidence interval', 'intervalo de confianza estrecho')
      .replace('Robust analysis', 'Análisis robusto')
      .replace('valuation models used', 'modelos de valuación utilizados')
      .replace(/(\d+% )upside\b/g, '$1potencial alcista')
      .replace(/upside\)/g, 'potencial alcista)')
      .replace('downside risk', 'riesgo de caída')
      .replace('premium', 'prima')
      .replace('Blended fair value', 'Valor justo combinado')
      .replace('above current price', 'por encima del precio actual')
      // ── Growth / WACC ──
      .replace('Strong value creator', 'Fuerte creador de valor')
      .replace('Value creator', 'Creador de valor')
      .replace('Growth roughly matches cost of capital', 'Crecimiento alineado con el costo de capital')
      .replace('Marginal value destroyer', 'Destructor marginal de valor')
      .replace('Value destroyer', 'Destructor de valor')
      .replace('SGR exceeds WACC by', 'SGR supera WACC por')
      .replace('WACC exceeds SGR by', 'WACC supera SGR por')
      .replace('High growth may not be sustainable with weak profitability', 'Alto crecimiento puede no ser sostenible con rentabilidad débil')
      // ── Forecasts ──
      .replace('Strong revenue growth forecast', 'Fuerte proyección de ingresos')
      .replace('Healthy revenue growth expected', 'Crecimiento saludable de ingresos esperado')
      .replace('Revenue decline expected', 'Declive de ingresos esperado')
      .replace('Strong revenue growth trend', 'Fuerte tendencia de crecimiento de ingresos')
      .replace('Revenue declining trend', 'Tendencia de declive de ingresos')
      .replace('Strong earnings growth forecast', 'Fuerte proyección de ganancias')
      .replace('Earnings decline expected', 'Declive de ganancias esperado')
      .replace('Well-covered by analysts', 'Bien cubierto por analistas')
      .replace('Limited analyst coverage', 'Cobertura de analistas limitada')
      .replace('slope:', 'pendiente:')
      .replace('/yr,', '/año,')
      // ── Institutional ──
      .replace('Strong Q/Q accumulation', 'Fuerte acumulación trimestral')
      .replace('Q/Q accumulation', 'Acumulación trimestral')
      .replace('Strong Q/Q distribution', 'Fuerte distribución trimestral')
      .replace('Q/Q distribution', 'Distribución trimestral')
      .replace('Institutional distribution', 'Distribución institucional')
      .replace('Bullish options positioning', 'Posicionamiento alcista en opciones')
      .replace('Bearish options positioning', 'Posicionamiento bajista en opciones')
      .replace('Strong YoY institutional growth', 'Fuerte crecimiento institucional anual')
      .replace('more investors', 'más inversores')
      .replace('Significant YoY institutional exodus', 'Éxodo institucional significativo anual')
      .replace('Net insider buying', 'Compras netas de insiders')
      .replace('Net insider selling', 'Ventas netas de insiders')
      .replace('High insider selling', 'Alta venta de insiders')
      .replace('Insider buying detected', 'Compra de insiders detectada')
      .replace('bought)', 'comprado)')
      .replace('sold)', 'vendido)')
      .replace('buys vs', 'compras vs')
      .replace('sells vs', 'ventas vs')
      .replace(/(\d+) buys\b/g, '$1 compras')
      .replace(/(\d+) sells\b/g, '$1 ventas')
      .replace('Very high institutional ownership', 'Propiedad institucional muy alta')
      .replace('Strong institutional backing', 'Fuerte respaldo institucional')
      .replace('Low institutional interest', 'Bajo interés institucional')
      .replace('Long-term institutional commitment', 'Compromiso institucional a largo plazo')
      .replace('avg ', 'prom. ')
      .replace('year holding)', 'año de tenencia)')
      .replace('Net accumulation', 'Acumulación neta')
      .replace('Net distribution', 'Distribución neta')
      .replace('new positions', 'nuevas posiciones')
      .replace('increased positions', 'posiciones incrementadas')
      .replace('decreased positions', 'posiciones reducidas')
      .replace('sold out', 'vendidas')
      // ── Technical ──
      .replace('Trading near support', 'Operando cerca del soporte')
      .replace('In lower third of trading range', 'En el tercio inferior del rango de operación')
      .replace('Testing resistance at', 'Probando resistencia en')
      .replace('In upper third of trading range', 'En el tercio superior del rango de operación')
      .replace('Excellent risk/reward ratio', 'Excelente relación riesgo/beneficio')
      .replace('Favorable risk/reward', 'Relación riesgo/beneficio favorable')
      .replace('Poor risk/reward', 'Pobre relación riesgo/beneficio')
      .replace('Strong technical setup', 'Configuración técnica fuerte')
      .replace('Bearish technical setup', 'Configuración técnica bajista')
      .replace('High model agreement', 'Alta coincidencia de modelos')
      .replace('At 38.2% Fibonacci retracement level', 'En nivel de retroceso Fibonacci 38.2%')
      .replace('At 61.8% Fibonacci golden ratio level', 'En nivel áureo Fibonacci 61.8%')
      .replace('High volatility environment', 'Entorno de alta volatilidad')
      .replace('High volatility', 'Alta volatilidad')
      .replace('of price)', 'del precio)')
      // ── Monte Carlo ──
      .replace('High probability', 'Alta probabilidad')
      .replace('Favorable odds', 'Probabilidades favorables')
      .replace('Low probability', 'Baja probabilidad')
      .replace('of reaching target', 'de alcanzar objetivo')
      .replace('High downside risk', 'Alto riesgo bajista')
      // ── Quality dimensions ──
      .replace('Consistent quality across all dimensions', 'Calidad consistente en todas las dimensiones')
      .replace('Excellent financial strength', 'Excelente solidez financiera')
      .replace('Weak financial strength', 'Débil solidez financiera')
      .replace('Poor financial strength', 'Pobre solidez financiera')
      .replace('Excellent profitability', 'Excelente rentabilidad')
      .replace('Weak profitability', 'Débil rentabilidad')
      .replace('Poor profitability', 'Pobre rentabilidad')
      .replace('Excellent growth', 'Excelente crecimiento')
      .replace('Weak growth', 'Débil crecimiento')
      .replace('Poor growth', 'Pobre crecimiento')
      .replace('Excellent efficiency', 'Excelente eficiencia')
      .replace('Weak efficiency', 'Débil eficiencia')
      .replace('Poor efficiency', 'Pobre eficiencia')
      .replace('Excellent moat', 'Excelente ventaja competitiva')
      .replace('Weak moat', 'Débil ventaja competitiva')
      .replace('Poor moat', 'Pobre ventaja competitiva')
      // ── Correlation layer ──
      .replace('VALUE-QUALITY ALIGNMENT:', 'ALINEACIÓN VALOR-CALIDAD:')
      .replace('Undervalued with strong fundamentals', 'Subvalorado con fundamentos sólidos')
      .replace('VALUE TRAP RISK:', 'RIESGO DE TRAMPA DE VALOR:')
      .replace('Appears cheap but weak fundamentals', 'Parece barato pero con fundamentos débiles')
      .replace('MOMENTUM CONFIRMATION:', 'CONFIRMACIÓN DE MOMENTUM:')
      .replace('Technical and sentiment aligned bullish', 'Técnico y sentimiento alineados al alza')
      .replace('SMART MONEY VALIDATED:', 'VALIDADO POR SMART MONEY:')
      .replace('Strong institutional interest in quality company', 'Fuerte interés institucional en empresa de calidad')
      .replace('UNDISCOVERED GEM:', 'GEMA OCULTA:')
      .replace('High quality but low institutional awareness', 'Alta calidad pero baja visibilidad institucional')
      .replace('SUSTAINABILITY CONCERN:', 'PREOCUPACIÓN DE SOSTENIBILIDAD:')
      .replace('High growth with weak fundamentals', 'Alto crecimiento con fundamentos débiles')
      .replace('SECTOR TAILWIND:', 'VIENTO A FAVOR SECTORIAL:')
      .replace('Company is undervalued in a strong-performing sector', 'Empresa subvalorada en sector con buen desempeño')
      .replace('SECTOR HEADWIND:', 'VIENTO EN CONTRA SECTORIAL:')
      .replace('Overvalued in a weak sector environment', 'Sobrevalorada en entorno sectorial débil')
      .replace('CYCLE-TECHNICAL ALIGNMENT:', 'ALINEACIÓN CICLO-TÉCNICA:')
      .replace('FFT cycle upturn confirmed by technical setup', 'Alza de ciclo FFT confirmada por configuración técnica')
      .replace('CYCLE-TECHNICAL WEAKNESS:', 'DEBILIDAD CICLO-TÉCNICA:')
      .replace('FFT cycle downturn with poor technical setup', 'Baja de ciclo FFT con configuración técnica débil')
      // ── Sector / Industry ──
      .replace("Company's sector", 'El sector de la empresa')
      .replace("Company's industry", 'La industria de la empresa')
      .replace('is rallying', 'está en alza')
      .replace('is declining', 'está en declive')
      .replace('is surging', 'está subiendo fuerte')
      .replace('is falling', 'está cayendo')
      .replace("is among today's top performers", 'es uno de los mejores del día')
      .replace("is among today's worst performers", 'es uno de los peores del día')
      // ── News ──
      .replace('Positive news momentum', 'Impulso noticioso positivo')
      .replace('Positive news sentiment', 'Sentimiento positivo en noticias')
      .replace('Negative news sentiment', 'Sentimiento negativo en noticias')
      .replace('Sentiment trend improving', 'Tendencia de sentimiento mejorando')
      .replace('Sentiment trend deteriorating', 'Tendencia de sentimiento deteriorando')
      .replace(/(\d+) positive\b/g, '$1 positivas')
      .replace(/(\d+) negative\b/g, '$1 negativas')
      .replace('positive vs', 'positivas vs')
      .replace('negative vs', 'negativas vs')
      // ── Spectral / Cycle ──
      .replace('At cycle TROUGH', 'En MÍNIMO de ciclo')
      .replace('At cycle PEAK', 'En MÁXIMO de ciclo')
      .replace('potential entry point', 'posible punto de entrada')
      .replace('consider reducing exposure', 'considerar reducir exposición')
      .replace('In RISING phase of dominant cycle', 'En fase ASCENDENTE del ciclo dominante')
      .replace('In FALLING phase of dominant cycle', 'En fase DESCENDENTE del ciclo dominante')
      .replace('Momentum confirms cycle upturn', 'Momentum confirma alza del ciclo')
      .replace('Momentum confirms cycle downturn', 'Momentum confirma baja del ciclo')
      .replace('Detrended RSI oversold', 'RSI sin tendencia en sobreventa')
      .replace('Detrended RSI overbought', 'RSI sin tendencia en sobrecompra')
      .replace('Strong cyclical regime detected', 'Régimen cíclico fuerte detectado')
      .replace('FFT signals are high-confidence', 'señales FFT son de alta confianza')
      .replace('Noisy/random regime', 'Régimen ruidoso/aleatorio')
      .replace('cycle signals have low reliability', 'señales de ciclo tienen baja fiabilidad')
      // ── Data quality ──
      .replace('Comprehensive data available', 'Datos completos disponibles')
      .replace('Limited data', 'Datos limitados')
      .replace('Data freshness decay applied', 'Decaimiento por antigüedad de datos aplicado')
      .replace('sources)', 'fuentes)')
      .replace('sources', 'fuentes')
      // ── Common fallback words ──
      .replace('investors,', 'inversores,')
      .replace('investors', 'inversores')
      .replace('shares', 'acciones')
      .replace('increased', 'incrementadas')
      .replace('decreased', 'reducidas');
  };

  // Catalysts use the same signal translation + additional catalyst-specific entries
  const tlCatalyst = (c: string): string => {
    if (!es) return c;
    let t = tlSignal(c);
    return t
      .replace('Potential earnings beat', 'Posible superación de estimaciones')
      .replace('Multiple expansion', 'Expansión de múltiplos')
      .replace('Operational improvement', 'Mejora operativa')
      .replace('analyst consensus', 'consenso de analistas');
  };

  const DIM_ES: Record<string, string> = {
    'Valuation':         'Valuación',
    'Quality':           'Calidad',
    'Growth':            'Crecimiento',
    'Technical':         'Técnico',
    'Institutional':     'Institucional',
    'Momentum':          'Momentum',
    'Forecasts':         'Proyecciones',
    'Financial Strength':'Solidez Financiera',
    'Profitability':     'Rentabilidad',
    'Efficiency':        'Eficiencia',
    'Moat':              'Ventaja Comp.',
    'Spectral':          'Espectral',
    'MonteCarlo':        'Monte Carlo',
    'Sector':            'Sector',
    'News':              'Noticias',
    'Correlation':       'Correlación',
  };

  const tlDim = (dim: string) => (es && DIM_ES[dim]) ? DIM_ES[dim] : dim;

  const COMPANY_TYPE_LABEL: Record<string, string> = {
    growth: es ? 'Crecimiento' : 'Growth',
    value: es ? 'Valor' : 'Value',
    dividend: es ? 'Dividendos' : 'Dividend',
    blend: es ? 'Mixto' : 'Blend',
  };

  const TYPE_COLOR: Record<string, string> = {
    growth: 'bg-emerald-500', value: 'bg-blue-500', dividend: 'bg-amber-500', blend: 'bg-violet-500',
  };
  const TYPE_TEXT_COLOR: Record<string, string> = {
    growth: 'text-emerald-400', value: 'text-blue-400', dividend: 'text-amber-400', blend: 'text-violet-400',
  };

  const FEATURE_LABEL: Record<string, string> = {
    pe_z: 'P/E vs Sector',
    gr_z: es ? 'Crecimiento vs Sector' : 'Growth vs Sector',
    yield_z: es ? 'Dividendo vs Sector' : 'Yield vs Sector',
    pb_z: 'P/B vs Sector',
    cap_log_norm: es ? 'Cap. de Mercado' : 'Market Cap',
    moat: 'Moat',
    growth_dim: es ? 'Calidad de Crecimiento' : 'Growth Quality',
    quality_dim: es ? 'Rentabilidad' : 'Profitability',
  };

  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChainOfThought, setShowChainOfThought] = useState(false);
  const [showSynthesis, setShowSynthesis] = useState(false);

  // FFT signal — fetched independently from /fft-signal endpoint
  const [fftData, setFftData] = useState<SpectralCycleData | null>(null);
  const [fftLoading, setFftLoading] = useState(false);

  const generarResumen = async (retryCount = 0) => {
    if (!advanceValueNet && !companyQualityNet && !dcfValuation) {
      console.log('[ResumenTab] Waiting for data...');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        ticker,
        currentPrice,
        advanceValueNet,
        companyQualityNet,
        keyMetricsSummary,
        sustainableGrowthRate,
        wacc,
        dcfValuation,
        monteCarlo,
        pivotAnalysis,
        holdersData,
        forecasts,
        diarioStats,
        news,
        averageValuation,
        profile,
        ratiosTTM,
      };

      console.log('[ResumenTab] Sending payload to multi-layer engine:', payload);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/resumen/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log('[ResumenTab] Multi-layer analysis complete:', data);
      setResumen(data);
    } catch (err: any) {
      console.error('[ResumenTab] Error:', err);

      // Auto-retry once on timeout or transient errors
      if (retryCount < 1 && (err.name === 'AbortError' || err.message === 'Failed to fetch')) {
        console.log('[ResumenTab] Auto-retrying...');
        return generarResumen(retryCount + 1);
      }

      let errorMsg = err.message || 'Error al generar el Resumen Maestro';
      if (err.name === 'AbortError') {
        errorMsg = es
          ? 'El servidor tardó demasiado en responder. Intenta de nuevo.'
          : 'Server took too long to respond. Please retry.';
      } else if (err.message === 'Failed to fetch') {
        errorMsg = es
          ? 'No se pudo conectar al servidor backend. Verifica que esté corriendo.'
          : 'Could not connect to backend server. Check that it is running.';
      }
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generarResumen();
  }, [ticker, currentPrice, advanceValueNet, companyQualityNet, keyMetricsSummary, sustainableGrowthRate, wacc, dcfValuation, monteCarlo, pivotAnalysis, holdersData, forecasts, diarioStats, news, averageValuation]);

  // Client-side DFT for a single window — returns fftSignal at last bar and complex components
  const computeWindowDFT = (prices: number[], numFreq: number) => {
    const N = prices.length;
    const slope = (prices[N - 1] - prices[0]) / (N - 1);
    const detrended = prices.map((p, i) => p - (prices[0] + slope * i));
    const trendLast = prices[0] + slope * (N - 1);
    const windowed = detrended.map((v, i) => v * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))));
    const re: number[] = new Array(numFreq + 1).fill(0);
    const im: number[] = new Array(numFreq + 1).fill(0);
    for (let k = 0; k <= numFreq; k++) {
      for (let n = 0; n < N; n++) {
        const ang = (2 * Math.PI * k * n) / N;
        re[k] += windowed[n] * Math.cos(ang);
        im[k] -= windowed[n] * Math.sin(ang);
      }
    }
    let reconLast = re[0] / N;
    for (let k = 1; k <= numFreq; k++) {
      const ang = (2 * Math.PI * k * (N - 1)) / N;
      reconLast += (2 * (re[k] * Math.cos(ang) - im[k] * Math.sin(ang))) / N;
    }
    const fftSignal = reconLast + trendLast;
    const totalMag = re.slice(1).reduce((s, r, i) => s + Math.sqrt(r * r + (im[i + 1] ?? 0) ** 2), 0) || 1;
    const complexComps = re.slice(1, numFreq + 1).map((r, idx) => {
      const k = idx + 1;
      const img = im[k] ?? 0;
      const magnitude = Math.sqrt(r * r + img * img);
      const phaseRad = Math.atan2(-img, r);
      return {
        freq_index: k,
        period_days: Math.round(N / k),
        magnitude: magnitude / N,
        phase_rad: phaseRad,
        phase_deg: ((phaseRad * 180) / Math.PI + 360) % 360,
        real: r / N,
        imag: img / N,
        contribution_pct: (magnitude / totalMag) * 100,
      };
    });
    return { fftSignal, complexComps };
  };

  // Fetch FFT: tries backend first, falls back to client-side DFT using FMP historical prices
  useEffect(() => {
    if (!ticker) return;
    const fetchFFT = async () => {
      setFftLoading(true);
      try {
        // 1) Try backend /fft-signal
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        const backendRes = await fetch(`${backendUrl}/fft-signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker, window: 256, numFreq: 8, outputBars: 60, thresholdPct: 0.002 }),
        }).catch(() => null);
        if (backendRes?.ok) {
          const data = await backendRes.json();
          setFftData(data);
          return;
        }
        // 2) Fallback: compute DFT client-side via FMP prices
        const today = new Date();
        const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
        const fmpData = await fetchFmp('stable/historical-price-eod/full', {
          symbol: ticker,
          from: twoYearsAgo.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        }).catch(() => null);
        if (!fmpData) return;
        if (!Array.isArray(fmpData) || fmpData.length < 300) return;
        const sorted = [...fmpData].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const allCloses: number[] = sorted.map((d: any) => Number(d.close ?? d.price));
        const WINDOW = 256, NUM_FREQ = 8, OUTPUT_BARS = 60, THRESH = 0.002;
        if (allCloses.length < WINDOW + OUTPUT_BARS) return;
        const rollingCurve: NonNullable<SpectralCycleData['rollingCurve']> = [];
        let lastComplexComps: NonNullable<SpectralCycleData['complexComponents']> = [];
        const startIdx = allCloses.length - OUTPUT_BARS;
        for (let i = startIdx; i < allCloses.length; i++) {
          if (i < WINDOW) continue;
          const windowPrices = allCloses.slice(i - WINDOW, i);
          const { fftSignal, complexComps } = computeWindowDFT(windowPrices, NUM_FREQ);
          const close = allCloses[i];
          const aboveRecon = close > fftSignal * (1 + THRESH);
          rollingCurve.push({
            date: sorted[i]?.date ?? String(i),
            price: close,
            reconstructed: fftSignal,
            aboveRecon,
            position: aboveRecon ? 1 : 0,
          });
          if (i === allCloses.length - 1) lastComplexComps = complexComps;
        }
        const lastBar = rollingCurve[rollingCurve.length - 1];
        const sig: 'bullish' | 'bearish' | 'neutral' = !lastBar ? 'neutral' : lastBar.aboveRecon ? 'bullish' : 'bearish';
        setFftData({ rollingCurve, complexComponents: lastComplexComps, currentSignal: sig, windowSize: WINDOW, numFreqKept: NUM_FREQ, thresholdPct: THRESH });
      } catch (e) {
        console.warn('[FFT] Error:', e);
      } finally {
        setFftLoading(false);
      }
    };
    fetchFFT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  if (loading) {
    return (
      <div className="min-h-[600px] flex flex-col items-center justify-center">
        <LogoLoader size="xl" />
        <p className="mt-8 text-2xl font-light text-emerald-400">Ejecutando Motor de Razonamiento...</p>
        <div className="flex flex-col items-center gap-2 mt-4 text-gray-500 text-sm">
          <p className="animate-pulse">Layer 1: Ingesta de Datos</p>
          <p className="animate-pulse" style={{ animationDelay: '0.3s' }}>Layer 2: Análisis Sentimiento (NLP)</p>
          <p className="animate-pulse" style={{ animationDelay: '0.6s' }}>Layer 3: Flujo Institucional</p>
          <p className="animate-pulse" style={{ animationDelay: '0.9s' }}>Layer 4: Análisis Técnico</p>
          <p className="animate-pulse" style={{ animationDelay: '1.2s' }}>Layer 5: Ensemble Valuación</p>
          <p className="animate-pulse" style={{ animationDelay: '1.5s' }}>Layer 6: Análisis Calidad</p>
          <p className="animate-pulse" style={{ animationDelay: '1.8s' }}>Layer 7: Crecimiento y Valor</p>
          <p className="animate-pulse" style={{ animationDelay: '2.1s' }}>Layer 8: Forecasts Analistas</p>
          <p className="animate-pulse" style={{ animationDelay: '2.4s' }}>Layer 9: Monte Carlo (5000 sim)</p>
          <p className="animate-pulse" style={{ animationDelay: '2.7s' }}>Layer 10: Correlación Cruzada</p>
          <p className="animate-pulse" style={{ animationDelay: '3.0s' }}>Layer 11: Síntesis Dinámica</p>
          <p className="animate-pulse" style={{ animationDelay: '3.3s' }}>Layer 12: Recomendación Final</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">⚠️</div>
        <div className="text-red-400 text-xl mb-4">Error: {error}</div>
        <p className="text-gray-500 mb-6">Verifica que el servidor backend esté corriendo</p>
        <div className="flex justify-center gap-4">
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              // Force re-trigger
              setTimeout(() => {
                setLoading(false);
              }, 100);
            }}
            className="px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-500 transition"
          >
            Reintentar
          </button>
          <a
            href={`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/health`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-white/[0.08] text-gray-300 rounded-xl font-semibold hover:bg-gray-800 transition"
          >
            Verificar Backend
          </a>
        </div>
      </div>
    );
  }

  // Renders the FFT section — available even without resumen (uses independent fftData from client-side DFT)
  const renderFFTSection = () => {
    const activeSpectral: SpectralCycleData | null | undefined = fftData ?? resumen?.spectralCycles;
    if (!activeSpectral && fftLoading) {
      return (
        <div className="bg-gray-900/80 rounded-3xl border border-white/[0.06]/50 p-6 flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Calculando ciclos espectrales FFT...</span>
        </div>
      );
    }
    if (!activeSpectral) return null;
    return (
      <div className="bg-gray-900/80 rounded-3xl border border-white/[0.06]/50 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-violet-950/40 to-indigo-950/30 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">〜</span>
              <span className="text-lg font-semibold text-gray-100">Ciclos Espectrales FFT (Rolling Window)</span>
              {activeSpectral.currentSignal && (
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  activeSpectral.currentSignal === 'bullish'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : activeSpectral.currentSignal === 'bearish'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {activeSpectral.currentSignal === 'bullish' ? '▲ Alcista' : activeSpectral.currentSignal === 'bearish' ? '▼ Bajista' : '— Neutral'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {activeSpectral.windowSize && <span>Ventana: {activeSpectral.windowSize}b</span>}
              {activeSpectral.numFreqKept && <span>Frec. mantenidas: {activeSpectral.numFreqKept}</span>}
              {activeSpectral.tradingRegime && (
                <span>Régimen: <span className={`font-medium ${
                  activeSpectral.tradingRegime === 'cycling' ? 'text-violet-400'
                  : activeSpectral.tradingRegime === 'trending' ? 'text-blue-400'
                  : 'text-gray-400'
                }`}>{activeSpectral.tradingRegime}</span></span>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* KPIs — only show if available (full resumen analysis provides them) */}
          {(activeSpectral.score != null || activeSpectral.cycleStrength != null || activeSpectral.phasePosition != null || activeSpectral.rsi != null || activeSpectral.atrPct != null) && (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {activeSpectral.score != null && (
                <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">FFT Score</p>
                  <p className={`text-xl font-bold ${
                    activeSpectral.score >= 60 ? 'text-emerald-400' : activeSpectral.score >= 40 ? 'text-yellow-400' : 'text-red-400'
                  }`}>{activeSpectral.score.toFixed(0)}</p>
                </div>
              )}
              {activeSpectral.cycleStrength != null && (
                <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Fuerza Ciclo</p>
                  <p className="text-xl font-bold text-violet-400">{activeSpectral.cycleStrength.toFixed(1)}%</p>
                </div>
              )}
              {activeSpectral.phasePosition != null && (
                <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Posición Fase</p>
                  <p className="text-xl font-bold text-indigo-400">{activeSpectral.phasePosition.toFixed(1)}%</p>
                </div>
              )}
              {activeSpectral.rsi != null && (
                <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">RSI Detrend</p>
                  <p className={`text-xl font-bold ${
                    activeSpectral.rsi < 30 ? 'text-emerald-400' : activeSpectral.rsi > 70 ? 'text-red-400' : 'text-gray-300'
                  }`}>{activeSpectral.rsi.toFixed(0)}</p>
                </div>
              )}
              {activeSpectral.atrPct != null && (
                <div className="bg-gray-800/60 rounded-xl p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">ATR %</p>
                  <p className={`text-xl font-bold ${
                    activeSpectral.atrPct > 3 ? 'text-red-400' : 'text-gray-300'
                  }`}>{activeSpectral.atrPct.toFixed(2)}%</p>
                </div>
              )}
            </div>
          )}

          {/* Complex Components Table */}
          {activeSpectral.complexComponents && activeSpectral.complexComponents.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Componentes Complejos FFT — Top {activeSpectral.numFreqKept ?? activeSpectral.complexComponents.length} Frecuencias
              </h5>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-2 pr-4">Período (días)</th>
                      <th className="text-right pr-4">Magnitud |A|</th>
                      <th className="text-right pr-4">Real (cos)</th>
                      <th className="text-right pr-4">Imag (sin)</th>
                      <th className="text-right pr-4">Fase (°)</th>
                      <th className="text-right">Contribución</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeSpectral.complexComponents.map((c, i) => (
                      <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 pr-4 font-mono text-violet-300">{c.period_days}d</td>
                        <td className="text-right pr-4 font-mono text-gray-300">{c.magnitude.toFixed(3)}</td>
                        <td className="text-right pr-4 font-mono">
                          <span className={c.real >= 0 ? 'text-emerald-400' : 'text-red-400'}>{c.real.toFixed(3)}</span>
                        </td>
                        <td className="text-right pr-4 font-mono">
                          <span className={c.imag >= 0 ? 'text-emerald-400' : 'text-red-400'}>{c.imag.toFixed(3)}</span>
                        </td>
                        <td className="text-right pr-4 font-mono text-indigo-300">{c.phase_deg.toFixed(1)}°</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-violet-500 to-indigo-400 rounded-full"
                                style={{ width: `${Math.min(100, c.contribution_pct * 3)}%` }}
                              />
                            </div>
                            <span className="text-violet-400">{c.contribution_pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-600 mt-2">
                Número complejo A = Real + i·Imag → |A| = magnitud (amplitud del ciclo), φ = arg(A) = fase (posición en el ciclo).
                La curva reconstruida irfft(filtrada) = señal suave de ciclos.
              </p>
            </div>
          )}

          {/* Rolling Curve mini-chart */}
          {activeSpectral.rollingCurve && activeSpectral.rollingCurve.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Precio vs Curva FFT Reconstruida (últimas {activeSpectral.rollingCurve.length} barras)
              </h5>
              <div className="bg-gray-950/60 rounded-xl p-3 overflow-x-auto">
                {(() => {
                  const curve = activeSpectral.rollingCurve!;
                  const allVals = curve.flatMap(b => [b.price, b.reconstructed]);
                  const minV = Math.min(...allVals);
                  const maxV = Math.max(...allVals);
                  const range = maxV - minV || 1;
                  const W = 600, H = 100;
                  const toX = (i: number) => (i / (curve.length - 1)) * W;
                  const toY = (v: number) => H - ((v - minV) / range) * H;
                  const pricePath = curve.map((b, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(b.price).toFixed(1)}`).join(' ');
                  const reconPath = curve.map((b, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(b.reconstructed).toFixed(1)}`).join(' ');
                  const lastBar = curve[curve.length - 1];
                  const signalColor = lastBar?.aboveRecon ? '#10b981' : '#f87171';
                  return (
                    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" style={{ height: 120 }}>
                      {[0.25, 0.5, 0.75].map(pct => (
                        <line key={pct} x1="0" y1={H * pct} x2={W} y2={H * pct} stroke="#374151" strokeWidth="0.5" strokeDasharray="4,4" />
                      ))}
                      <path d={pricePath} fill="none" stroke={signalColor} strokeWidth="1.5" />
                      <path d={reconPath} fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4,2" />
                      <line x1="10" y1={H + 14} x2="30" y2={H + 14} stroke={signalColor} strokeWidth="1.5" />
                      <text x="33" y={H + 18} fill="#9ca3af" fontSize="9">Precio</text>
                      <line x1="80" y1={H + 14} x2="100" y2={H + 14} stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4,2" />
                      <text x="103" y={H + 18} fill="#9ca3af" fontSize="9">FFT Reconstruida</text>
                      <text x="2" y="10" fill="#6b7280" fontSize="8">${maxV.toFixed(0)}</text>
                      <text x="2" y={H - 2} fill="#6b7280" fontSize="8">${minV.toFixed(0)}</text>
                    </svg>
                  );
                })()}
              </div>
              <p className="text-[10px] text-gray-600 mt-1 text-center">
                Señal actual: precio {activeSpectral.rollingCurve[activeSpectral.rollingCurve.length - 1]?.aboveRecon ? 'POR ENCIMA' : 'POR DEBAJO'} de la curva FFT
                {activeSpectral.rollingCurve[activeSpectral.rollingCurve.length - 1]?.aboveRecon ? ' → alcista' : ' → bajista'}
              </p>
            </div>
          )}

          {/* Dominant Cycles summary */}
          {activeSpectral.dominantCycles && activeSpectral.dominantCycles.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Ciclos Dominantes Detectados</h5>
              <div className="flex flex-wrap gap-2">
                {activeSpectral.dominantCycles.map((c, i) => (
                  <div key={i} className="bg-violet-900/20 border border-violet-800/40 rounded-lg px-3 py-2 text-xs">
                    <span className="text-violet-300 font-mono font-bold">{c.period_days}d</span>
                    <span className="text-gray-500 mx-1">·</span>
                    <span className="text-gray-400">{c.contribution_pct.toFixed(1)}%</span>
                    <span className="text-gray-500 mx-1">·</span>
                    <span className="text-indigo-400">{c.phase_degrees.toFixed(0)}°</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!resumen) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <div className="text-6xl mb-6">🧠</div>
          <p className="text-gray-400 text-xl">Motor de Razonamiento Multi-Capa</p>
          <p className="text-gray-600 text-sm mt-2">Esperando datos de AdvanceValue Net, CompanyQuality Net o DCF...</p>
          <div className="mt-8 grid grid-cols-6 gap-2 max-w-2xl mx-auto">
            {['Ingesta', 'Sentiment', 'Institucional', 'Técnico', 'Valuación', 'Calidad', 'Growth', 'Forecasts', 'MonteCarlo', 'Correlación', 'Síntesis', 'Output'].map((layer, i) => (
              <div key={layer} className="text-center">
                <div className="w-8 h-8 mx-auto rounded-full bg-gray-800 border border-white/[0.06] flex items-center justify-center text-gray-600 text-[10px]">
                  L{i + 1}
                </div>
                <p className="text-[8px] text-gray-600 mt-1">{layer}</p>
              </div>
            ))}
          </div>
        </div>
        {renderFFTSection()}
      </div>
    );
  }

  const {
    finalRecommendation,
    conviction,
    targetPrice,
    targetRange,
    upsidePct,
    timeHorizon,
    marginOfSafety,
    riskLevel,
    keyRisks,
    catalysts,
    dimensionScores,
    summaryText,
    actionableAdvice,
    chainOfThought,
    synthesisDetails,
    dataQuality,
    spectralCycles,
  } = resumen;

  // Determine colors based on recommendation
  const getRecommendationStyle = () => {
    if (finalRecommendation.includes('Strong Buy')) {
      return 'border-emerald-400 bg-gradient-to-br from-emerald-950/80 via-emerald-950/60 to-teal-950/40';
    }
    if (finalRecommendation.includes('Buy')) {
      return 'border-green-400 bg-gradient-to-br from-green-950/70 to-emerald-950/40';
    }
    if (finalRecommendation.includes('Strong Sell')) {
      return 'border-red-400 bg-gradient-to-br from-red-950/80 to-red-950/40';
    }
    if (finalRecommendation.includes('Sell')) {
      return 'border-red-700 bg-gradient-to-br from-red-950/80 to-red-950/30';
    }
    return 'border-yellow-400 bg-gradient-to-br from-yellow-950/50 to-amber-950/30';
  };

  const getRecommendationEmoji = () => {
    if (finalRecommendation.includes('Strong Buy')) return '🚀';
    if (finalRecommendation.includes('Buy')) return '📈';
    if (finalRecommendation.includes('Strong Sell')) return '🔻';
    if (finalRecommendation.includes('Sell')) return '📉';
    return '⏸️';
  };

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-emerald-400';
    if (score >= 60) return 'text-green-400';
    if (score >= 45) return 'text-yellow-400';
    if (score >= 30) return 'text-orange-400';
    return 'text-red-400';
  };

  const getBarColor = (score: number) => {
    if (score >= 75) return 'from-emerald-500 to-emerald-400';
    if (score >= 60) return 'from-green-500 to-emerald-400';
    if (score >= 45) return 'from-yellow-500 to-amber-400';
    if (score >= 30) return 'from-orange-500 to-amber-400';
    return 'from-red-500 to-rose-400';
  };

  return (
    <div className="space-y-8">
      {/* Header with (Beta) badge */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-gray-100">{es ? 'Resumen Maestro' : 'Master Summary'}</h2>
        <span className="px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-full">Beta</span>
        {resumen?.companyType && (
          <span className="px-2 py-0.5 text-xs font-medium bg-cyan-900/40 text-cyan-400 border border-cyan-700/30 rounded-full">
            {COMPANY_TYPE_LABEL[resumen.companyType] ?? resumen.companyType}
            {resumen.typeConfidence != null && (
              <span className="ml-1 text-cyan-600">({Math.round(resumen.typeConfidence * 100)}%)</span>
            )}
          </span>
        )}
        {resumen?.moatScore != null && resumen.moatScore > 0.50 && (
          <span className="px-2 py-0.5 text-xs font-medium bg-emerald-900/40 text-emerald-400 border border-emerald-700/30 rounded-full">
            🏰 Moat {Math.round(resumen.moatScore * 100)}%
          </span>
        )}
        {resumen?.growthPremium && (
          <span className="px-2 py-0.5 text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/30 rounded-full" title={es ? 'Premium de valoración justificado por moat + crecimiento' : 'Valuation premium justified by moat + growth'}>
            {es ? 'Prima de Crecimiento' : 'Growth Premium'}
          </span>
        )}
      </div>

      {/* ── Hybrid Classifier Panel ──────────────────────────────────────── */}
      {(resumen?.causalInsight || resumen?.gnnScores) && (
        <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl overflow-hidden">
          {/* Panel header */}
          <div className="px-4 py-2.5 border-b border-gray-700/40 flex items-center gap-2">
            <span className="text-cyan-400 text-sm">⚡</span>
            <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              {es ? 'Clasificador Híbrido' : 'Hybrid Classifier'}
            </h3>
            <span className="text-[10px] text-gray-600 ml-auto">RF + KMeans + PageRank + QUBO</span>
          </div>

          <div className="p-4 space-y-4">
            {/* Causal Insight */}
            {(resumen.causalInsight || resumen.causalInsightEs) && (
              <p className="text-xs text-cyan-300/80 leading-relaxed bg-cyan-950/20 border border-cyan-900/30 rounded-lg px-3 py-2">
                {es ? (resumen.causalInsightEs || resumen.causalInsight) : resumen.causalInsight}
              </p>
            )}

            {/* Ensemble Scores — horizontal bar chart */}
            {resumen.gnnScores && Object.keys(resumen.gnnScores).length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  {es ? 'Puntuación del Ensemble' : 'Ensemble Scores'}
                </p>
                <div className="space-y-1.5">
                  {Object.entries(resumen.gnnScores)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cls, score]) => {
                      const pct = Math.round(score * 100);
                      const isWinner = cls === resumen.companyType;
                      return (
                        <div key={cls} className="flex items-center gap-2">
                          <span className={`text-[11px] w-24 text-right ${isWinner ? (TYPE_TEXT_COLOR[cls] || 'text-gray-300') + ' font-semibold' : 'text-gray-500'}`}>
                            {COMPANY_TYPE_LABEL[cls] ?? cls}
                          </span>
                          <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isWinner ? (TYPE_COLOR[cls] || 'bg-gray-500') : 'bg-gray-600'}`}
                              style={{ width: `${Math.max(pct, 2)}%`, opacity: isWinner ? 1 : 0.5 }}
                            />
                          </div>
                          <span className={`text-[11px] w-10 font-mono ${isWinner ? 'text-gray-200 font-semibold' : 'text-gray-600'}`}>
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Model Consensus */}
            {(resumen.rfType || resumen.kmType) && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  {es ? 'Consenso de Modelos' : 'Model Consensus'}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {resumen.rfType && (
                    <div className="flex items-center gap-1.5 bg-gray-800/80 rounded-lg px-2.5 py-1.5 border border-gray-700/50">
                      <span className="text-[10px] text-gray-500">RF</span>
                      <span className={`text-xs font-medium ${TYPE_TEXT_COLOR[resumen.rfType] || 'text-gray-300'}`}>
                        {COMPANY_TYPE_LABEL[resumen.rfType] ?? resumen.rfType}
                      </span>
                      {resumen.rfConf != null && (
                        <span className="text-[10px] text-gray-600">{Math.round(resumen.rfConf * 100)}%</span>
                      )}
                    </div>
                  )}
                  <span className="text-gray-600 text-xs">→</span>
                  {resumen.kmType && (
                    <div className="flex items-center gap-1.5 bg-gray-800/80 rounded-lg px-2.5 py-1.5 border border-gray-700/50">
                      <span className="text-[10px] text-gray-500">KMeans</span>
                      <span className={`text-xs font-medium ${TYPE_TEXT_COLOR[resumen.kmType] || 'text-gray-300'}`}>
                        {COMPANY_TYPE_LABEL[resumen.kmType] ?? resumen.kmType}
                      </span>
                    </div>
                  )}
                  <span className="text-gray-600 text-xs">→</span>
                  {resumen.companyType && (
                    <div className="flex items-center gap-1.5 bg-gray-800/60 rounded-lg px-2.5 py-1.5 border-2 border-cyan-700/50">
                      <span className="text-[10px] text-cyan-500">{es ? 'Final' : 'Final'}</span>
                      <span className={`text-xs font-bold ${TYPE_TEXT_COLOR[resumen.companyType] || 'text-gray-300'}`}>
                        {COMPANY_TYPE_LABEL[resumen.companyType] ?? resumen.companyType}
                      </span>
                      {resumen.typeConfidence != null && (
                        <span className="text-[10px] text-cyan-600">{Math.round(resumen.typeConfidence * 100)}%</span>
                      )}
                    </div>
                  )}
                  {/* Consensus indicator */}
                  {resumen.rfType && resumen.kmType && (
                    <span className={`text-[10px] ml-1 ${
                      resumen.rfType === resumen.kmType && resumen.rfType === resumen.companyType
                        ? 'text-emerald-400' : 'text-yellow-400'
                    }`}>
                      {resumen.rfType === resumen.kmType && resumen.rfType === resumen.companyType
                        ? (es ? '(consenso unánime)' : '(unanimous consensus)')
                        : (es ? '(consenso parcial)' : '(partial consensus)')
                      }
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Feature Importance + Graph Centrality — side by side */}
            {(resumen.rfImportances || resumen.graphCentrality) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* RF Feature Importance */}
                {resumen.rfImportances && Object.keys(resumen.rfImportances).length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      {es ? 'Importancia de Features (RF)' : 'Feature Importance (RF)'}
                    </p>
                    <div className="space-y-1">
                      {Object.entries(resumen.rfImportances)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 6)
                        .map(([feat, imp]) => {
                          const pct = Math.round(imp * 100);
                          const maxImp = Math.max(...Object.values(resumen.rfImportances!));
                          const barW = maxImp > 0 ? Math.round((imp / maxImp) * 100) : 0;
                          return (
                            <div key={feat} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-500 w-28 text-right truncate" title={feat}>
                                {FEATURE_LABEL[feat] ?? feat}
                              </span>
                              <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-cyan-600/70 rounded-full" style={{ width: `${Math.max(barW, 2)}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-600 w-8 font-mono">{pct}%</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Graph Centrality (PageRank) */}
                {resumen.graphCentrality && Object.keys(resumen.graphCentrality).length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      {es ? 'Centralidad Causal (PageRank)' : 'Causal Centrality (PageRank)'}
                    </p>
                    <div className="space-y-1">
                      {Object.entries(resumen.graphCentrality)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 6)
                        .map(([feat, cent]) => {
                          const pct = Math.round(cent * 100);
                          const maxC = Math.max(...Object.values(resumen.graphCentrality!));
                          const barW = maxC > 0 ? Math.round((cent / maxC) * 100) : 0;
                          return (
                            <div key={feat} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-500 w-28 text-right truncate" title={feat}>
                                {FEATURE_LABEL[feat] ?? feat}
                              </span>
                              <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full bg-violet-600/70 rounded-full" style={{ width: `${Math.max(barW, 2)}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-600 w-8 font-mono">{pct}%</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Data Quality Indicator + Refresh Button */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50 rounded-xl border border-gray-800">
        <div className="flex items-center gap-4 flex-wrap">
          {dataQuality && (
            <>
              <span className="text-xs text-gray-500 uppercase tracking-wider">{es ? 'Calidad de Datos' : 'Data Quality'}</span>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                    style={{ width: `${dataQuality.completeness}%` }}
                  />
                </div>
                <span className="text-sm text-gray-400">{dataQuality.completeness}%</span>
              </div>
              <span className="text-xs text-gray-600">
                {dataQuality.sourcesUsed}/{dataQuality.totalSources} {es ? 'fuentes' : 'sources'}
              </span>
            </>
          )}
          {averageValuation != null && averageValuation > 0 && (
            <span className="text-xs text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded-lg border border-violet-700/40">
              Avg Valuaciones: ${averageValuation.toFixed(2)}
            </span>
          )}
          {/* Score history minibar */}
          {resumen?.scoreHistory && resumen.scoreHistory.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-500">{es ? 'Historial' : 'History'}:</span>
              {resumen.scoreHistory.slice(0, 5).map((h, i) => (
                <span key={i} className={`font-mono ${h.finalScore >= 60 ? 'text-emerald-400' : h.finalScore >= 45 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {h.finalScore?.toFixed(0)}
                </span>
              ))}
              {resumen.scoreDelta !== null && resumen.scoreDelta !== undefined && (
                <span className={`font-semibold ${resumen.scoreDelta > 0 ? 'text-emerald-400' : resumen.scoreDelta < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  ({resumen.scoreDelta > 0 ? '+' : ''}{resumen.scoreDelta})
                </span>
              )}
              {resumen.scoreTrend && resumen.scoreTrend !== 'stable' && (
                <span className={resumen.scoreTrend === 'improving' ? 'text-emerald-400' : 'text-red-400'}>
                  {resumen.scoreTrend === 'improving' ? '↑' : '↓'}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => generarResumen()}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          )}
          {es ? 'Actualizar' : 'Refresh'}
        </button>
      </div>

      {/* Hero Section */}
      <div className={`rounded-3xl p-8 md:p-12 border-2 ${getRecommendationStyle()} relative overflow-hidden`}>
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-white/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>

        <div className="relative text-center">
          <div className="text-7xl mb-4">{getRecommendationEmoji()}</div>
          <p className="text-5xl md:text-6xl font-black text-white mb-2">{tlRec(finalRecommendation)}</p>
          <div className="flex items-center justify-center gap-6 mt-4 flex-wrap">
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Convicción</p>
              <p className="text-3xl font-bold text-white">{conviction}%</p>
            </div>
            <div className="w-px h-12 bg-gray-600"></div>
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Confianza Motor</p>
              <p className="text-3xl font-bold text-emerald-400">{synthesisDetails?.confidence?.toFixed(0) || '--'}%</p>
            </div>
            {(fftData || fftLoading) && (
              <>
                <div className="w-px h-12 bg-gray-600"></div>
                <div className="text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Ciclo FFT</p>
                  {fftLoading ? (
                    <div className="w-5 h-5 mx-auto border-2 border-violet-500 border-t-transparent rounded-full animate-spin mt-2" />
                  ) : (
                    <p className={`text-2xl font-bold ${
                      fftData?.currentSignal === 'bullish' ? 'text-emerald-400'
                      : fftData?.currentSignal === 'bearish' ? 'text-red-400'
                      : 'text-yellow-400'
                    }`}>
                      {fftData?.currentSignal === 'bullish' ? '▲ Alcista'
                        : fftData?.currentSignal === 'bearish' ? '▼ Bajista'
                        : '— Neutral'}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
          <div className="text-center bg-black/40 backdrop-blur rounded-2xl p-4 border border-white/10">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Precio Objetivo</p>
            <p className="text-3xl font-bold text-white">${targetPrice?.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-1">
              ${targetRange?.[0]?.toFixed(2)} – ${targetRange?.[1]?.toFixed(2)}
            </p>
          </div>
          <div className="text-center bg-black/40 backdrop-blur rounded-2xl p-4 border border-white/10">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Upside</p>
            <p className={`text-3xl font-bold ${upsidePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {upsidePct >= 0 ? '+' : ''}{upsidePct?.toFixed(1)}%
            </p>
          </div>
          <div className="text-center bg-black/40 backdrop-blur rounded-2xl p-4 border border-white/10">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Horizonte</p>
            <p className="text-2xl font-semibold text-white">{timeHorizon}</p>
          </div>
          <div className="text-center bg-black/40 backdrop-blur rounded-2xl p-4 border border-white/10">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Margen Seguridad</p>
            <p className="text-xl font-bold text-emerald-400">{marginOfSafety}</p>
          </div>
        </div>
      </div>

      {/* Chain of Thought removed per user request */}

      {/* Synthesis Details */}
      {synthesisDetails && (
        <div className="bg-gray-900/80 rounded-3xl border border-white/[0.06]/50 overflow-hidden">
          <button
            onClick={() => setShowSynthesis(!showSynthesis)}
            className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-gray-950 to-emerald-900/30 hover:bg-gray-950 hover:to-emerald-900/50 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚡</span>
              <span className="text-lg font-semibold text-gray-100">Síntesis de Componentes</span>
              <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                Score Final: {synthesisDetails.finalScore}
              </span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transform transition-transform ${showSynthesis ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSynthesis && (
            <div className="p-6">
              <div className="grid md:grid-cols-2 gap-6">
                {/* Component Scores */}
                <div>
                  <h5 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Scores por Componente</h5>
                  <div className="space-y-3">
                    {Object.entries(synthesisDetails.componentScores).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-24 text-sm text-gray-400 capitalize">{key}</span>
                        <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full bg-gradient-to-r ${getBarColor(value)} rounded-full transition-all`}
                            style={{ width: `${value}%` }}
                          />
                        </div>
                        <span className={`w-12 text-right text-sm font-bold ${getScoreColor(value)}`}>
                          {value.toFixed(0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Applied Weights */}
                <div>
                  <h5 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Pesos Dinámicos Aplicados</h5>
                  <div className="space-y-3">
                    {Object.entries(synthesisDetails.appliedWeights).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-24 text-sm text-gray-400 capitalize">{key}</span>
                        <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all"
                            style={{ width: `${value * 2}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-sm text-amber-400">
                          {value.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Score Breakdown */}
              <div className="mt-6 flex items-center justify-center gap-4 p-4 bg-gray-800/50 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-gray-500">Raw Score</p>
                  <p className="text-2xl font-bold text-gray-400">{synthesisDetails.rawScore}</p>
                </div>
                <span className="text-gray-600">→</span>
                <div className="text-center">
                  <p className="text-xs text-gray-500">Ajustado</p>
                  <p className={`text-3xl font-bold ${getScoreColor(synthesisDetails.finalScore)}`}>
                    {synthesisDetails.finalScore}
                  </p>
                </div>
                <span className="text-gray-600">→</span>
                <div className="text-center">
                  <p className="text-xs text-gray-500">Confianza</p>
                  <p className="text-2xl font-bold text-emerald-400">{synthesisDetails.confidence}%</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dimension Scores */}
      {dimensionScores && Object.keys(dimensionScores).length > 0 && (
        <div>
          <h4 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <span className="text-emerald-400">📊</span> {es ? 'Puntuación por Dimensión' : 'Dimension Scores'}
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Object.entries(dimensionScores).map(([dim, score]) => {
              const numScore = score as number;
              return (
                <div
                  key={dim}
                  className="bg-gray-900/80 p-4 rounded-2xl border border-white/[0.06]/50 hover:border-emerald-500/50 transition-all group"
                >
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 truncate">
                    {tlDim(dim.replace(/([A-Z])/g, ' $1').trim())}
                  </p>
                  <p className={`text-3xl font-bold ${getScoreColor(numScore)} group-hover:scale-110 transition-transform`}>
                    {numScore}
                  </p>
                  <div className="h-1.5 bg-gray-800 rounded mt-2 overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${getBarColor(numScore)} rounded transition-all duration-500`}
                      style={{ width: `${numScore}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary Narrative */}
      <div className="bg-gray-900/80 p-8 rounded-3xl border border-white/[0.06]/50">
        <h4 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <span className="text-emerald-400">📝</span> {es ? 'Análisis Narrativo' : 'Narrative Analysis'}
        </h4>
        <p className="text-lg leading-relaxed text-gray-200">{summaryText}</p>

        {actionableAdvice && (
          <div className="mt-8 bg-gradient-to-r from-gray-950 via-emerald-900/40 to-emerald-900/40 p-6 rounded-2xl border border-emerald-500/30">
            <p className="uppercase text-emerald-400 text-xs tracking-[3px] mb-2 flex items-center gap-2">
              <span>🎯</span> {es ? 'PLAN DE ACCIÓN' : 'ACTION PLAN'}
            </p>
            <p className="text-xl font-medium text-white leading-relaxed">{actionableAdvice}</p>
          </div>
        )}

        {/* FFT Timing Integration — integrated into final conclusion */}
        {(fftData || fftLoading) && (
          <div className="mt-6 bg-violet-950/20 border border-violet-800/30 p-5 rounded-2xl">
            <p className="uppercase text-violet-400 text-xs tracking-[3px] mb-3 flex items-center gap-2">
              <span>〜</span> {es ? 'TIMING ESPECTRAL (FFT)' : 'SPECTRAL TIMING (FFT)'}
            </p>
            {fftLoading ? (
              <div className="flex items-center gap-3 text-gray-500 text-sm">
                <div className="w-4 h-4 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                <span>{es ? 'Calculando ciclos espectrales...' : 'Computing spectral cycles...'}</span>
              </div>
            ) : fftData ? (
              <>
                <div className="flex items-center gap-4 flex-wrap mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      fftData.currentSignal === 'bullish' ? 'bg-emerald-400'
                      : fftData.currentSignal === 'bearish' ? 'bg-red-400'
                      : 'bg-yellow-400'
                    }`} />
                    <span className={`font-semibold text-sm ${
                      fftData.currentSignal === 'bullish' ? 'text-emerald-400'
                      : fftData.currentSignal === 'bearish' ? 'text-red-400'
                      : 'text-yellow-400'
                    }`}>
                      {es ? 'Señal' : 'Signal'}: {fftData.currentSignal === 'bullish'
                        ? (es ? 'Alcista' : 'Bullish')
                        : fftData.currentSignal === 'bearish'
                        ? (es ? 'Bajista' : 'Bearish')
                        : 'Neutral'}
                    </span>
                  </div>
                  {fftData.complexComponents && fftData.complexComponents.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{es ? 'Ciclos dominantes:' : 'Dominant cycles:'}</span>
                      {fftData.complexComponents.slice(0, 3).map((c, i) => (
                        <span key={i} className="bg-violet-900/30 border border-violet-800/30 rounded px-2 py-0.5">
                          <span className="text-violet-300 font-mono">{c.period_days}d</span>
                          <span className="text-gray-600 mx-1">·</span>
                          <span className="text-gray-400">{c.contribution_pct.toFixed(1)}%</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-300 leading-relaxed">
                  {fftData.currentSignal === 'bullish'
                    ? (es
                      ? 'El precio se encuentra por encima de la curva espectral reconstruida, confirmando momentum alcista en los ciclos detectados. El timing es favorable para posiciones largas.'
                      : 'Price is above the reconstructed spectral curve, confirming bullish momentum in detected cycles. Timing is favorable for long positions.')
                    : fftData.currentSignal === 'bearish'
                    ? (es
                      ? 'El precio se encuentra por debajo de la curva espectral reconstruida, indicando presión vendedora en los ciclos dominantes. Se recomienda cautela en el timing de entrada.'
                      : 'Price is below the reconstructed spectral curve, indicating selling pressure in dominant cycles. Caution is advised on entry timing.')
                    : (es
                      ? 'El precio se sitúa en zona neutral respecto a los ciclos espectrales, sin señal de timing definida. Esperar confirmación de ruptura.'
                      : 'Price is in a neutral zone relative to spectral cycles, with no defined timing signal. Wait for breakout confirmation.')}
                </p>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Risks & Catalysts */}
      <div className="grid md:grid-cols-2 gap-6">
        {keyRisks && keyRisks.length > 0 && (
          <div className="bg-gradient-to-br from-red-950/30 to-red-950/40 border border-red-900/40 p-6 rounded-2xl">
            <h5 className="text-red-400 font-semibold mb-4 flex items-center gap-2">
              <span>⚠️</span> {es ? 'Riesgos Identificados' : 'Identified Risks'}
            </h5>
            <ul className="space-y-3">
              {keyRisks.map((risk: string, i: number) => (
                <li key={i} className="flex gap-3 text-gray-300 text-sm">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span>{tlSignal(risk)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {catalysts && catalysts.length > 0 && (
          <div className="bg-gradient-to-br from-emerald-950/30 to-emerald-950/20 border border-emerald-900/40 p-6 rounded-2xl">
            <h5 className="text-emerald-400 font-semibold mb-4 flex items-center gap-2">
              <span>🚀</span> {es ? 'Catalizadores' : 'Catalysts'}
            </h5>
            <ul className="space-y-3">
              {catalysts.map((cat: string, i: number) => (
                <li key={i} className="flex gap-3 text-gray-300 text-sm">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>{tlCatalyst(cat)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Risk Level Indicator */}
      {riskLevel && (
        <div className="flex justify-center">
          <div
            className={`px-6 py-3 rounded-full border ${
              riskLevel === 'Low'
                ? 'bg-emerald-900/30 border-emerald-600 text-emerald-400'
                : riskLevel === 'Moderate'
                ? 'bg-yellow-900/30 border-yellow-600 text-yellow-400'
                : riskLevel === 'Elevated'
                ? 'bg-orange-900/30 border-orange-600 text-orange-400'
                : 'bg-red-900/30 border-red-600 text-red-400'
            }`}
          >
            <span className="text-sm font-medium">Nivel de Riesgo: </span>
            <span className="font-bold">{tlRisk(riskLevel)}</span>
          </div>
        </div>
      )}

      {/* FFT Spectral Cycles Section — rendered via renderFFTSection() which works with or without resumen */}
      {renderFFTSection()}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 pt-4 border-t border-gray-800">
        <p>Motor de Razonamiento Multi-Capa v1.0 | {chainOfThought?.length || 0} capas procesadas | Confianza: {synthesisDetails?.confidence || '--'}%</p>
      </div>
    </div>
  );
}
