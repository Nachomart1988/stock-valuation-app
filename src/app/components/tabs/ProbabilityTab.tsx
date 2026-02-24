// src/app/components/tabs/ProbabilityTab.tsx
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface ProbabilityTabProps {
  ticker: string;
  quote: any;
  dcfCustom?: any;
  sharedAverageVal: number | null;
  profile: any;
  dividends?: any[];
}

interface ProbabilityResult {
  probability: number;
  upFactor: number;
  downFactor: number;
  upProbability: number;
  downProbability: number;
  historicalVolatility: number | null;
  impliedVolatility: number | null;
  volatilityUsed: number;
  volatilitySource: string;
  expectedPrice: number;
  steps: number;
  days: number;
  deltaT: number;
  deltaTPerStep: number;
  priceDistribution: Array<{
    priceRange: string;
    center: number;
    probability: number;
    aboveTarget: boolean;
  }>;
  treePreview: Array<Array<{
    price: number;
    reachesTarget: boolean;
    step: number;
    ups: number;
  }>>;
  optionsChain: Array<{
    strike: number;
    lastPrice: number;
    bid: number;
    ask: number;
    impliedVolatility: number;
    volume: number;
    openInterest: number;
    expiration: string;
  }> | null;
  currentPrice: number;
  targetPrice: number;
}

export default function ProbabilityTab({
  ticker,
  quote,
  dcfCustom,
  sharedAverageVal,
  profile,
  dividends,
}: ProbabilityTabProps) {
  const { t } = useLanguage();

  // ── Input States ──
  const currentPrice = quote?.price || 0;
  const defaultRiskFreeRate = dcfCustom?.riskFreeRate || 4.2;
  const defaultDY = useMemo(() => {
    if (dividends && dividends.length > 0 && currentPrice > 0) {
      const recent = dividends.slice(0, 4);
      const annualDiv = recent.reduce((sum: number, d: any) => sum + (d.dividend || d.adjDividend || 0), 0);
      return (annualDiv / currentPrice) * 100;
    }
    return 0;
  }, [dividends, currentPrice]);

  const [targetPrice, setTargetPrice] = useState<string>('');
  const [riskFreeRate, setRiskFreeRate] = useState<string>(defaultRiskFreeRate.toFixed(2));
  const [dividendYield, setDividendYield] = useState<string>(defaultDY.toFixed(2));
  const [days, setDays] = useState<string>('252');
  const [steps, setSteps] = useState<string>('');
  const [useImpliedVol, setUseImpliedVol] = useState(true);
  const [volOverride, setVolOverride] = useState<string>('');

  // ── Result States ──
  const [result, setResult] = useState<ProbabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // Set target price from sharedAverageVal when it becomes available
  useEffect(() => {
    if (sharedAverageVal && !targetPrice) {
      setTargetPrice(sharedAverageVal.toFixed(2));
    }
  }, [sharedAverageVal, targetPrice]);

  // Update DY when dividends change
  useEffect(() => {
    if (defaultDY > 0 && dividendYield === '0.00') {
      setDividendYield(defaultDY.toFixed(2));
    }
  }, [defaultDY, dividendYield]);

  // ── Calculate ──
  const handleCalculate = useCallback(async () => {
    const tp = parseFloat(targetPrice);
    const rf = parseFloat(riskFreeRate);
    const dy = parseFloat(dividendYield);
    const d = parseInt(days);

    if (!tp || !currentPrice || !d) {
      setError(t('probabilityTab.missingInputs'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: any = {
        ticker,
        currentPrice,
        targetPrice: tp,
        riskFreeRate: rf / 100,
        dividendYield: dy / 100,
        days: d,
        useImpliedVol,
      };

      if (steps) {
        payload.steps = parseInt(steps);
      }

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/probability/calculate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      const data: ProbabilityResult = await res.json();
      setResult(data);
    } catch (err: any) {
      console.error('[ProbabilityTab] Error:', err);
      setError(err.message || 'Error calculating probability');
    } finally {
      setLoading(false);
    }
  }, [ticker, currentPrice, targetPrice, riskFreeRate, dividendYield, days, steps, useImpliedVol, t]);

  // Auto-calculate when key inputs change
  useEffect(() => {
    if (currentPrice > 0 && targetPrice && parseFloat(targetPrice) > 0) {
      const timer = setTimeout(() => {
        handleCalculate();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [ticker, currentPrice, targetPrice, riskFreeRate, dividendYield, days, useImpliedVol]);

  // ── Helper functions ──
  const getProbabilityColor = (prob: number) => {
    if (prob >= 70) return 'text-green-400';
    if (prob >= 50) return 'text-yellow-400';
    if (prob >= 30) return 'text-orange-400';
    return 'text-red-400';
  };

  const getProbabilityBg = (prob: number) => {
    if (prob >= 70) return 'from-green-500/20 to-green-600/5';
    if (prob >= 50) return 'from-yellow-500/20 to-yellow-600/5';
    if (prob >= 30) return 'from-orange-500/20 to-orange-600/5';
    return 'from-red-500/20 to-red-600/5';
  };

  const upside = currentPrice > 0 && targetPrice
    ? ((parseFloat(targetPrice) - currentPrice) / currentPrice * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
          📊 {t('probabilityTab.title')}
        </h2>
        <p className="text-gray-400 mt-2">
          {t('probabilityTab.subtitle')} {ticker}
        </p>
      </div>

      {/* ── Input Panel ── */}
      <div className="bg-gray-900/60 rounded-xl p-6 border border-emerald-500/20">
        <h3 className="text-lg font-semibold text-emerald-400 mb-4">
          {t('probabilityTab.parameters')}
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Current Price (read-only) */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('probabilityTab.currentPrice')}
            </label>
            <div className="px-3 py-2 bg-gray-800/50 border border-white/[0.08] rounded-lg text-gray-300 text-sm">
              ${currentPrice.toFixed(2)}
            </div>
          </div>

          {/* Target Price */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('probabilityTab.targetPrice')} 🎯
            </label>
            <input
              type="number"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-emerald-500/50 rounded-lg text-gray-100 text-sm focus:border-emerald-400 focus:outline-none"
              placeholder={sharedAverageVal?.toFixed(2) || '0.00'}
              step="0.01"
            />
            {upside !== 0 && (
              <span className={`text-xs ${upside > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {upside > 0 ? '↑' : '↓'} {Math.abs(upside).toFixed(1)}%
              </span>
            )}
          </div>

          {/* Risk Free Rate */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('probabilityTab.riskFreeRate')} (%)
            </label>
            <input
              type="number"
              value={riskFreeRate}
              onChange={(e) => setRiskFreeRate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-white/[0.08] rounded-lg text-gray-100 text-sm focus:border-emerald-400 focus:outline-none"
              step="0.01"
            />
          </div>

          {/* Dividend Yield */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('probabilityTab.dividendYield')} (%)
            </label>
            <input
              type="number"
              value={dividendYield}
              onChange={(e) => setDividendYield(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-white/[0.08] rounded-lg text-gray-100 text-sm focus:border-emerald-400 focus:outline-none"
              step="0.01"
              min="0"
            />
          </div>

          {/* Days */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('probabilityTab.timePeriod')} ({t('probabilityTab.days')})
            </label>
            <input
              type="number"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-emerald-500/50 rounded-lg text-gray-100 text-sm focus:border-emerald-400 focus:outline-none"
              min="5"
              max="1000"
            />
          </div>

          {/* Steps */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              {t('probabilityTab.steps')}
            </label>
            <input
              type="number"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-white/[0.08] rounded-lg text-gray-100 text-sm focus:border-emerald-400 focus:outline-none"
              placeholder={`Auto (${Math.min(parseInt(days) || 252, 252)})`}
              min="10"
              max="500"
            />
          </div>

          {/* Volatility Source Toggle */}
          <div className="col-span-2 flex items-center gap-4">
            <label className="block text-xs text-gray-500">
              {t('probabilityTab.volatilitySource')}
            </label>
            <button
              onClick={() => setUseImpliedVol(!useImpliedVol)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                useImpliedVol
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                  : 'bg-gray-700 text-gray-400 border border-white/[0.08]'
              }`}
            >
              {t('probabilityTab.implied')}
            </button>
            <button
              onClick={() => setUseImpliedVol(false)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                !useImpliedVol
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                  : 'bg-gray-700 text-gray-400 border border-white/[0.08]'
              }`}
            >
              {t('probabilityTab.historical')}
            </button>
          </div>
        </div>

        {/* Calculate Button */}
        <div className="mt-4 text-center">
          <button
            onClick={handleCalculate}
            disabled={loading || !currentPrice || !targetPrice}
            className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg font-medium hover:from-emerald-400 hover:to-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? '⏳ ' + t('probabilityTab.calculating') : '🔬 ' + t('probabilityTab.calculate')}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-400"></div>
        </div>
      )}

      {/* ── Results ── */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Main Probability Display */}
          <div className={`bg-gradient-to-br ${getProbabilityBg(result.probability)} rounded-xl p-8 border border-white/[0.06] text-center`}>
            <div className="text-sm text-gray-400 mb-2">
              {t('probabilityTab.probabilityOfReaching')} ${result.targetPrice.toFixed(2)}
            </div>
            <div className={`text-6xl font-black ${getProbabilityColor(result.probability)}`}>
              {result.probability.toFixed(2)}%
            </div>
            <div className="text-sm text-gray-500 mt-2">
              {t('probabilityTab.in')} {result.days} {t('probabilityTab.days')} ({result.steps} {t('probabilityTab.steps')})
            </div>
          </div>

          {/* Model Parameters Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Up Factor */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.upFactor')} (u)</div>
              <div className="text-xl font-bold text-green-400">{result.upFactor.toFixed(6)}</div>
              <div className="text-xs text-gray-600">e^(σ√ΔT)</div>
            </div>

            {/* Down Factor */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.downFactor')} (d)</div>
              <div className="text-xl font-bold text-red-400">{result.downFactor.toFixed(6)}</div>
              <div className="text-xs text-gray-600">1/u</div>
            </div>

            {/* Up Probability */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.upProbability')} (p)</div>
              <div className="text-xl font-bold text-green-400">{result.upProbability.toFixed(2)}%</div>
              <div className="text-xs text-gray-600">(e^((r-DY)ΔT) - d) / (u - d)</div>
            </div>

            {/* Down Probability */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.downProbability')} (1-p)</div>
              <div className="text-xl font-bold text-red-400">{result.downProbability.toFixed(2)}%</div>
              <div className="text-xs text-gray-600">1 - p</div>
            </div>

            {/* Volatility Used */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.volatilityUsed')} (σ)</div>
              <div className="text-xl font-bold text-emerald-400">{result.volatilityUsed.toFixed(2)}%</div>
              <div className="text-xs text-gray-600">{t('probabilityTab.source')}: {result.volatilitySource}</div>
            </div>

            {/* Historical Vol */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.historicalVol')}</div>
              <div className="text-xl font-bold text-gray-300">
                {result.historicalVolatility != null ? `${result.historicalVolatility.toFixed(2)}%` : 'N/A'}
              </div>
            </div>

            {/* Implied Vol */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.impliedVol')}</div>
              <div className="text-xl font-bold text-gray-300">
                {result.impliedVolatility != null ? `${result.impliedVolatility.toFixed(2)}%` : 'N/A'}
              </div>
            </div>

            {/* Expected Price */}
            <div className="bg-gray-900/60 rounded-lg p-4 border border-white/[0.06]">
              <div className="text-xs text-gray-500">{t('probabilityTab.expectedPrice')}</div>
              <div className="text-xl font-bold text-green-400">${result.expectedPrice.toFixed(2)}</div>
              <div className="text-xs text-gray-600">
                ΔT = {result.deltaT.toFixed(4)}
              </div>
            </div>
          </div>

          {/* Price Distribution Chart */}
          {result.priceDistribution && result.priceDistribution.length > 0 && (
            <div className="bg-gray-900/60 rounded-xl p-6 border border-white/[0.06]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-emerald-400">
                  {t('probabilityTab.priceDistribution')}
                </h3>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5">
                    <span className="w-8 h-0.5 bg-green-500 inline-block rounded"></span>
                    {t('probabilityTab.aboveTarget')} ({result.probability.toFixed(1)}%)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-8 h-0.5 bg-red-500 inline-block rounded"></span>
                    {t('probabilityTab.belowTarget')} ({(100 - result.probability).toFixed(1)}%)
                  </span>
                </div>
              </div>
              {(() => {
                const dist = result.priceDistribution;
                const W = 600, H = 200, padL = 40, padR = 12, padTop = 20, padBot = 28;
                const chartW = W - padL - padR;
                const chartH = H - padTop - padBot;
                // X-axis: use ONLY the distribution range so the bell curve fills the chart.
                // currentPrice and targetPrice lines are clamped to chart edges if outside.
                const distMin = dist[0].center;
                const distMax = dist[dist.length - 1].center;
                const distRange = distMax - distMin || 1;
                const padding = distRange * 0.04; // 4% padding so curve isn't cut at edges
                const minPrice = distMin - padding;
                const maxPrice = distMax + padding;
                const priceRange = maxPrice - minPrice || 1;
                const maxProb = Math.max(...dist.map((b: any) => b.probability));

                const toX = (price: number) => padL + ((price - minPrice) / priceRange) * chartW;
                const toY = (prob: number) => padTop + chartH - (maxProb > 0 ? (prob / maxProb) * chartH : 0);

                const pts = dist.map((b: any) => ({
                  x: toX(b.center),
                  y: toY(b.probability),
                  above: b.aboveTarget,
                  center: b.center,
                  prob: b.probability,
                }));

                // Smooth bezier path
                const smooth = (points: typeof pts) => {
                  if (points.length < 2) return '';
                  let d = `M ${points[0].x} ${points[0].y}`;
                  for (let i = 1; i < points.length; i++) {
                    const p0 = points[i - 1], p1 = points[i];
                    const cpx = (p0.x + p1.x) / 2;
                    d += ` C ${cpx} ${p0.y} ${cpx} ${p1.y} ${p1.x} ${p1.y}`;
                  }
                  return d;
                };

                const pathStr = smooth(pts);
                const areaPath = `${pathStr} L ${pts[pts.length - 1].x} ${padTop + chartH} L ${pts[0].x} ${padTop + chartH} Z`;

                // X positions for key prices — clamped to chart edges
                const targetXRaw = toX(result.targetPrice);
                const currentXRaw = toX(result.currentPrice);
                const targetX = Math.max(padL, Math.min(padL + chartW, targetXRaw));
                const currentX = Math.max(padL, Math.min(padL + chartW, currentXRaw));
                const targetOutside = targetXRaw < padL || targetXRaw > padL + chartW;
                const currentOutside = currentXRaw < padL || currentXRaw > padL + chartW;

                // Y-axis grid labels (25%, 50%, 75%, 100% of max)
                const yLabels = [0.25, 0.5, 0.75, 1.0].map(pct => ({
                  y: padTop + chartH - pct * chartH,
                  label: `${(maxProb * pct).toFixed(2)}%`,
                }));

                // X-axis labels: min, 25%, 50%, 75%, max
                const xLabels = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
                  x: padL + pct * chartW,
                  label: `$${(minPrice + pct * priceRange).toFixed(0)}`,
                }));

                return (
                  <div className="relative w-full overflow-x-auto">
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 220 }}>
                      <defs>
                        <linearGradient id="probGradGreen2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.45"/>
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.03"/>
                        </linearGradient>
                        <linearGradient id="probGradRed2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35"/>
                          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.03"/>
                        </linearGradient>
                        <clipPath id="clipBelowT">
                          <rect x={padL} y={padTop} width={Math.max(0, targetX - padL)} height={chartH}/>
                        </clipPath>
                        <clipPath id="clipAboveT">
                          <rect x={targetX} y={padTop} width={Math.max(0, padL + chartW - targetX)} height={chartH}/>
                        </clipPath>
                      </defs>

                      {/* Y-axis grid lines */}
                      {yLabels.map((gl, i) => (
                        <g key={i}>
                          <line x1={padL} y1={gl.y} x2={padL + chartW} y2={gl.y} stroke="#374151" strokeWidth="0.5" strokeDasharray="3,3"/>
                          <text x={padL - 3} y={gl.y + 3} fill="#6b7280" fontSize="7" textAnchor="end" fontFamily="monospace">{gl.label}</text>
                        </g>
                      ))}

                      {/* Area fills */}
                      <path d={areaPath} fill="url(#probGradRed2)" clipPath="url(#clipBelowT)"/>
                      <path d={areaPath} fill="url(#probGradGreen2)" clipPath="url(#clipAboveT)"/>

                      {/* Lines */}
                      <path d={pathStr} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" clipPath="url(#clipBelowT)" opacity="0.85"/>
                      <path d={pathStr} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" clipPath="url(#clipAboveT)" opacity="0.9"/>

                      {/* Current price marker */}
                      <line x1={currentX} y1={padTop} x2={currentX} y2={padTop + chartH} stroke="#facc15" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.7"/>
                      <text x={currentX} y={padTop - 4} fill="#facc15" fontSize="8" textAnchor="middle" fontFamily="monospace">
                        {currentOutside ? (currentXRaw < padL ? '◀ ' : ' ▶') : ''}${result.currentPrice.toFixed(0)} ▼
                      </text>

                      {/* Target price marker */}
                      <line x1={targetX} y1={padTop} x2={targetX} y2={padTop + chartH} stroke="#34d399" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.9"/>
                      <text x={targetX} y={padTop - 4} fill="#34d399" fontSize="8" textAnchor="middle" fontFamily="monospace">
                        {targetOutside ? (targetXRaw < padL ? '◀ ' : ' ▶') : ''}${result.targetPrice.toFixed(0)} 🎯
                      </text>

                      {/* Probability label at target */}
                      <rect x={targetX + 3} y={padTop + chartH / 2 - 8} width={52} height={14} rx="3" fill="#065f46" opacity="0.85"/>
                      <text x={targetX + 7} y={padTop + chartH / 2 + 3} fill="#34d399" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                        {result.probability.toFixed(1)}%
                      </text>

                      {/* X-axis labels */}
                      {xLabels.map((xl, i) => (
                        <text key={i} x={xl.x} y={H - 6} fill="#6b7280" fontSize="8" textAnchor="middle" fontFamily="monospace">{xl.label}</text>
                      ))}

                      {/* X-axis line */}
                      <line x1={padL} y1={padTop + chartH} x2={padL + chartW} y2={padTop + chartH} stroke="#374151" strokeWidth="0.8"/>
                    </svg>
                  </div>
                );
              })()}
              <p className="text-xs text-gray-600 mt-1 text-center">
                Distribución de precios terminales · {result.steps} pasos · σ={result.volatilityUsed.toFixed(1)}%
              </p>
            </div>
          )}

          {/* Binomial Tree Preview (Collapsible) */}
          {result.treePreview && result.treePreview.length > 0 && (
            <div className="bg-gray-900/60 rounded-xl border border-white/[0.06] overflow-hidden">
              <button
                onClick={() => setShowTree(!showTree)}
                className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-800/50 transition-colors"
              >
                <h3 className="text-lg font-semibold text-emerald-400">
                  🌳 {t('probabilityTab.binomialTree')}
                </h3>
                <span className="text-gray-500">{showTree ? '▲' : '▼'}</span>
              </button>

              {showTree && (
                <div className="px-6 pb-6 overflow-x-auto">
                  <div className="flex flex-col items-center gap-2 min-w-fit">
                    {result.treePreview.map((level, stepIdx) => (
                      <div key={stepIdx} className="flex gap-2 items-center">
                        <span className="text-xs text-gray-600 w-8">t{stepIdx}</span>
                        <div className="flex gap-1">
                          {level.map((node, nodeIdx) => (
                            <div
                              key={nodeIdx}
                              className={`px-2 py-1 rounded text-xs font-mono ${
                                node.reachesTarget
                                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
                              }`}
                            >
                              ${node.price.toFixed(1)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-3 text-xs justify-center">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-green-500/20 border border-green-500/30 rounded"></span>
                      ≥ {t('probabilityTab.target')}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-red-500/10 border border-red-500/20 rounded"></span>
                      &lt; {t('probabilityTab.target')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Options Chain (Collapsible) */}
          {result.optionsChain && result.optionsChain.length > 0 && (
            <div className="bg-gray-900/60 rounded-xl border border-white/[0.06] overflow-hidden">
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="w-full px-6 py-4 flex justify-between items-center text-left hover:bg-gray-800/50 transition-colors"
              >
                <h3 className="text-lg font-semibold text-emerald-400">
                  📋 {t('probabilityTab.optionsChain')} ({result.optionsChain[0].expiration})
                </h3>
                <span className="text-gray-500">{showOptions ? '▲' : '▼'}</span>
              </button>

              {showOptions && (
                <div className="px-6 pb-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="py-2 px-3 text-left text-gray-400">Strike</th>
                        <th className="py-2 px-3 text-right text-gray-400">Last</th>
                        <th className="py-2 px-3 text-right text-gray-400">Bid</th>
                        <th className="py-2 px-3 text-right text-gray-400">Ask</th>
                        <th className="py-2 px-3 text-right text-gray-400">IV</th>
                        <th className="py-2 px-3 text-right text-gray-400">Volume</th>
                        <th className="py-2 px-3 text-right text-gray-400">OI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.optionsChain.map((opt, i) => (
                        <tr
                          key={i}
                          className={`border-b border-gray-800 ${
                            Math.abs(opt.strike - currentPrice) < currentPrice * 0.02
                              ? 'bg-emerald-500/10'
                              : ''
                          }`}
                        >
                          <td className="py-2 px-3 text-gray-200 font-mono">${opt.strike.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-gray-300">${opt.lastPrice.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-green-400">${opt.bid.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-red-400">${opt.ask.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right text-emerald-400">{opt.impliedVolatility.toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right text-gray-400">{opt.volume.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-gray-400">{opt.openInterest.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Formula Reference */}
          <div className="bg-gray-900/40 rounded-xl p-4 border border-gray-800 text-xs text-gray-500">
            <div className="font-semibold text-gray-400 mb-2">{t('probabilityTab.formulaReference')}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 font-mono">
              <div>ΔT = {result.days}/{365} = {result.deltaT.toFixed(6)}</div>
              <div>ΔT/step = {result.deltaTPerStep.toFixed(6)}</div>
              <div>u = e^(σ√ΔT) = {result.upFactor.toFixed(6)}</div>
              <div>d = 1/u = {result.downFactor.toFixed(6)}</div>
              <div>p = (e^((r-DY)ΔT) - d) / (u - d) = {(result.upProbability / 100).toFixed(6)}</div>
              <div>P(S ≥ T) = Σ C(n,j)·p^j·(1-p)^(n-j) = {(result.probability / 100).toFixed(6)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
