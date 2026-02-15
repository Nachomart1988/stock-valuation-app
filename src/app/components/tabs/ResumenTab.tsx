'use client';
import { useEffect, useState } from 'react';

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
}: ResumenTabProps) {
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChainOfThought, setShowChainOfThought] = useState(false);
  const [showSynthesis, setShowSynthesis] = useState(false);

  useEffect(() => {
    const generarResumen = async () => {
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
        };

        console.log('[ResumenTab] Sending payload to multi-layer engine:', payload);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

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
        let errorMsg = err.message || 'Error al generar el Resumen Maestro';
        if (err.name === 'AbortError') {
          errorMsg = 'Timeout: El servidor tardó demasiado en responder';
        } else if (err.message === 'Failed to fetch') {
          errorMsg = 'No se pudo conectar al servidor backend. Verifica que esté corriendo';
        }
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };

    generarResumen();
  }, [ticker, currentPrice, advanceValueNet, companyQualityNet, keyMetricsSummary, sustainableGrowthRate, wacc, dcfValuation, monteCarlo, pivotAnalysis, holdersData, forecasts, diarioStats, news]);

  if (loading) {
    return (
      <div className="min-h-[600px] flex flex-col items-center justify-center">
        <div className="relative w-24 h-24">
          {/* Multi-layer animation */}
          <div className="absolute inset-0 border-4 border-purple-500/20 rounded-full animate-ping"></div>
          <div className="absolute inset-2 border-4 border-cyan-500/30 rounded-full animate-ping" style={{ animationDelay: '0.2s' }}></div>
          <div className="absolute inset-4 border-4 border-emerald-500/40 rounded-full animate-ping" style={{ animationDelay: '0.4s' }}></div>
          <div className="absolute inset-0 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="absolute inset-4 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }}></div>
        </div>
        <p className="mt-8 text-2xl font-light text-purple-400">Ejecutando Motor de Razonamiento...</p>
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
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 transition"
          >
            Reintentar
          </button>
          <a
            href={`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/health`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-gray-600 text-gray-300 rounded-xl font-semibold hover:bg-gray-800 transition"
          >
            Verificar Backend
          </a>
        </div>
      </div>
    );
  }

  if (!resumen) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-6">🧠</div>
        <p className="text-gray-400 text-xl">Motor de Razonamiento Multi-Capa</p>
        <p className="text-gray-600 text-sm mt-2">Esperando datos de AdvanceValue Net, CompanyQuality Net o DCF...</p>
        <div className="mt-8 grid grid-cols-6 gap-2 max-w-2xl mx-auto">
          {['Ingesta', 'Sentiment', 'Institucional', 'Técnico', 'Valuación', 'Calidad', 'Growth', 'Forecasts', 'MonteCarlo', 'Correlación', 'Síntesis', 'Output'].map((layer, i) => (
            <div key={layer} className="text-center">
              <div className="w-8 h-8 mx-auto rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-600 text-[10px]">
                L{i + 1}
              </div>
              <p className="text-[8px] text-gray-600 mt-1">{layer}</p>
            </div>
          ))}
        </div>
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
  } = resumen;

  // Determine colors based on recommendation
  const getRecommendationStyle = () => {
    if (finalRecommendation.includes('Strong Buy')) {
      return 'border-emerald-400 bg-gradient-to-br from-emerald-950/80 via-cyan-950/60 to-teal-950/40';
    }
    if (finalRecommendation.includes('Buy')) {
      return 'border-green-400 bg-gradient-to-br from-green-950/70 to-emerald-950/40';
    }
    if (finalRecommendation.includes('Strong Sell')) {
      return 'border-red-400 bg-gradient-to-br from-red-950/80 to-rose-950/40';
    }
    if (finalRecommendation.includes('Sell')) {
      return 'border-rose-400 bg-gradient-to-br from-rose-950/60 to-red-950/30';
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
    if (score >= 75) return 'from-emerald-500 to-cyan-400';
    if (score >= 60) return 'from-green-500 to-emerald-400';
    if (score >= 45) return 'from-yellow-500 to-amber-400';
    if (score >= 30) return 'from-orange-500 to-amber-400';
    return 'from-red-500 to-rose-400';
  };

  return (
    <div className="space-y-8">
      {/* Data Quality Indicator */}
      {dataQuality && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50 rounded-xl border border-gray-800">
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Calidad de Datos</span>
            <div className="flex items-center gap-2">
              <div className="w-32 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-cyan-400 rounded-full transition-all"
                  style={{ width: `${dataQuality.completeness}%` }}
                />
              </div>
              <span className="text-sm text-gray-400">{dataQuality.completeness}%</span>
            </div>
          </div>
          <span className="text-xs text-gray-600">
            {dataQuality.sourcesUsed}/{dataQuality.totalSources} fuentes
          </span>
        </div>
      )}

      {/* Hero Section */}
      <div className={`rounded-3xl p-8 md:p-12 border-2 ${getRecommendationStyle()} relative overflow-hidden`}>
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-white/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>

        <div className="relative text-center">
          <div className="text-7xl mb-4">{getRecommendationEmoji()}</div>
          <p className="text-5xl md:text-6xl font-black text-white mb-2">{finalRecommendation}</p>
          <div className="flex items-center justify-center gap-6 mt-4">
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Convicción</p>
              <p className="text-3xl font-bold text-white">{conviction}%</p>
            </div>
            <div className="w-px h-12 bg-gray-600"></div>
            <div className="text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wider">Confianza Motor</p>
              <p className="text-3xl font-bold text-purple-400">{synthesisDetails?.confidence?.toFixed(0) || '--'}%</p>
            </div>
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
            <p className={`text-3xl font-bold ${upsidePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
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

      {/* Chain of Thought Section */}
      {chainOfThought && chainOfThought.length > 0 && (
        <div className="bg-gray-900/80 rounded-3xl border border-gray-700/50 overflow-hidden">
          <button
            onClick={() => setShowChainOfThought(!showChainOfThought)}
            className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-purple-900/30 to-cyan-900/30 hover:from-purple-900/50 hover:to-cyan-900/50 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🧠</span>
              <span className="text-lg font-semibold text-gray-100">Chain of Thought</span>
              <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-400 text-xs">
                {chainOfThought.length} capas procesadas
              </span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transform transition-transform ${showChainOfThought ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showChainOfThought && (
            <div className="p-6 space-y-4">
              {chainOfThought.map((step, idx) => (
                <div
                  key={idx}
                  className="relative pl-8 pb-4 border-l-2 border-purple-500/30 last:border-0"
                >
                  {/* Step indicator */}
                  <div className="absolute left-0 -translate-x-1/2 w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center text-xs font-bold text-white">
                    {step.step}
                  </div>

                  <div className="bg-gray-800/50 rounded-xl p-4 ml-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-purple-400">{step.layer}</h4>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-bold ${getScoreColor(step.score)}`}>
                          Score: {step.score.toFixed(1)}
                        </span>
                        <span className="text-xs text-gray-500">
                          Conf: {step.confidence}%
                        </span>
                      </div>
                    </div>
                    <p className="text-gray-300 text-sm">{step.analysis}</p>

                    {step.key_signals && step.key_signals.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {step.key_signals.map((signal, sIdx) => (
                          <span
                            key={sIdx}
                            className={`px-2 py-1 rounded text-xs ${
                              signal.includes('RISK') || signal.includes('CONCERN') || signal.includes('WEAK')
                                ? 'bg-red-900/30 text-red-400 border border-red-800/50'
                                : signal.includes('STRONG') || signal.includes('HIGH') || signal.includes('POSITIVE')
                                ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/50'
                                : 'bg-gray-800 text-gray-400 border border-gray-700'
                            }`}
                          >
                            {signal}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Synthesis Details */}
      {synthesisDetails && (
        <div className="bg-gray-900/80 rounded-3xl border border-gray-700/50 overflow-hidden">
          <button
            onClick={() => setShowSynthesis(!showSynthesis)}
            className="w-full px-6 py-4 flex items-center justify-between bg-gradient-to-r from-cyan-900/30 to-emerald-900/30 hover:from-cyan-900/50 hover:to-emerald-900/50 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚡</span>
              <span className="text-lg font-semibold text-gray-100">Síntesis de Componentes</span>
              <span className="px-2 py-1 rounded-full bg-cyan-500/20 text-cyan-400 text-xs">
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
                  <p className="text-2xl font-bold text-purple-400">{synthesisDetails.confidence}%</p>
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
            <span className="text-purple-400">📊</span> Puntuación por Dimensión
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Object.entries(dimensionScores).map(([dim, score]) => {
              const numScore = score as number;
              return (
                <div
                  key={dim}
                  className="bg-gray-900/80 p-4 rounded-2xl border border-gray-700/50 hover:border-purple-500/50 transition-all group"
                >
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 truncate">
                    {dim.replace(/([A-Z])/g, ' $1').trim()}
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
      <div className="bg-gray-900/80 p-8 rounded-3xl border border-gray-700/50">
        <h4 className="text-lg font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <span className="text-purple-400">📝</span> Análisis Narrativo
        </h4>
        <p className="text-lg leading-relaxed text-gray-200">{summaryText}</p>

        {actionableAdvice && (
          <div className="mt-8 bg-gradient-to-r from-emerald-900/40 via-cyan-900/40 to-emerald-900/40 p-6 rounded-2xl border border-emerald-500/30">
            <p className="uppercase text-emerald-400 text-xs tracking-[3px] mb-2 flex items-center gap-2">
              <span>🎯</span> PLAN DE ACCIÓN
            </p>
            <p className="text-xl font-medium text-white leading-relaxed">{actionableAdvice}</p>
          </div>
        )}
      </div>

      {/* Risks & Catalysts */}
      <div className="grid md:grid-cols-2 gap-6">
        {keyRisks && keyRisks.length > 0 && (
          <div className="bg-gradient-to-br from-red-950/30 to-rose-950/20 border border-red-900/40 p-6 rounded-2xl">
            <h5 className="text-red-400 font-semibold mb-4 flex items-center gap-2">
              <span>⚠️</span> Riesgos Identificados
            </h5>
            <ul className="space-y-3">
              {keyRisks.map((risk: string, i: number) => (
                <li key={i} className="flex gap-3 text-gray-300 text-sm">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {catalysts && catalysts.length > 0 && (
          <div className="bg-gradient-to-br from-emerald-950/30 to-cyan-950/20 border border-emerald-900/40 p-6 rounded-2xl">
            <h5 className="text-emerald-400 font-semibold mb-4 flex items-center gap-2">
              <span>🚀</span> Catalizadores
            </h5>
            <ul className="space-y-3">
              {catalysts.map((cat: string, i: number) => (
                <li key={i} className="flex gap-3 text-gray-300 text-sm">
                  <span className="text-emerald-500 mt-0.5">•</span>
                  <span>{cat}</span>
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
            <span className="font-bold">{riskLevel}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 pt-4 border-t border-gray-800">
        <p>Motor de Razonamiento Multi-Capa v1.0 | {chainOfThought?.length || 0} capas procesadas | Confianza: {synthesisDetails?.confidence || '--'}%</p>
      </div>
    </div>
  );
}
