'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/app/components/Header';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import { fetchFmp, fetchFmpRaw } from '@/lib/fmpClient';
import { useLanguage } from '@/i18n/LanguageContext';

const FMP_IMG = (s: string) => `https://financialmodelingprep.com/image-stock/${s}.png`;
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface Driver {
  factor: string;
  value: any;
  impact: '+' | '-' | '=';
  description: string;
}

interface ScenarioResult {
  upProbability: number;
  expectedMagnitude: number;
  drivers: Driver[];
}

interface PredictionResult {
  ticker: string;
  sector: string;
  beatScenario: ScenarioResult;
  missScenario: ScenarioResult;
  probBeatEstimate: number;
  overallScore: number;
  consensus: string;
  factors: any;
  commentary: string;
}

function fmtRevenue(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

export default function EarningsPredictionPage() {
  const params = useParams();
  const router = useRouter();
  const { locale } = useLanguage();
  const es = locale === 'es';
  const ticker = (params?.ticker as string)?.toUpperCase() || '';

  const [loading, setLoading] = useState(true);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [nextEarning, setNextEarning] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch all the data we need (parallel)
      const [
        profileData,
        quoteData,
        ratiosData,
        keyMetricsData,
        earningsHist,
        forecastData,
        newsData,
      ] = await Promise.all([
        fetchFmp('stable/profile', { symbol: ticker }).catch(() => []),
        fetchFmp('stable/quote', { symbol: ticker }).catch(() => []),
        fetchFmp('stable/ratios-ttm', { symbol: ticker }).catch(() => []),
        fetchFmp('stable/key-metrics-ttm', { symbol: ticker }).catch(() => []),
        fetchFmp('stable/earnings', { symbol: ticker }).catch(() => []),
        fetchFmp('stable/analyst-estimates', { symbol: ticker, period: 'annual', limit: 5 }).catch(() => []),
        fetchFmp('stable/news/stock', { symbols: ticker, limit: 20 }).catch(() => []),
      ]);

      const prof = Array.isArray(profileData) ? profileData[0] : profileData;
      const qu = Array.isArray(quoteData) ? quoteData[0] : quoteData;
      const rat = Array.isArray(ratiosData) ? ratiosData[0] : ratiosData;
      const km = Array.isArray(keyMetricsData) ? keyMetricsData[0] : keyMetricsData;

      setProfile(prof);
      setQuote(qu);

      const histArr = Array.isArray(earningsHist) ? earningsHist : [];
      const upcoming = histArr.find((h: any) => h.epsActual == null && h.epsEstimated != null);
      setNextEarning(upcoming);
      const past = histArr
        .filter((h: any) => h.epsActual != null && h.epsEstimated != null)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
        .slice(0, 8);
      setHistory(past);

      const currentPrice = qu?.price || prof?.price;

      // 2. Quick quality heuristic from ratios
      const qualityHeuristic = {
        overallScore: (() => {
          if (!rat) return 50;
          let score = 50;
          const roe = rat.returnOnEquityTTM;
          if (roe != null) score += Math.min(20, roe * 100);
          const roic = rat.returnOnInvestedCapitalTTM;
          if (roic != null) score += Math.min(15, roic * 80);
          const debtEq = rat.debtToEquityTTM;
          if (debtEq != null) score += debtEq < 0.5 ? 5 : (debtEq > 2 ? -10 : 0);
          const grossMargin = rat.grossProfitMarginTTM;
          if (grossMargin != null) score += Math.min(10, grossMargin * 20);
          return Math.max(0, Math.min(100, score));
        })(),
      };

      // 3. Quick valuation heuristic
      let advanceHeuristic: any = null;
      if (km?.bookValuePerShareTTM && currentPrice && rat?.priceEarningsRatioTTM) {
        // Simple Graham number as proxy intrinsic value
        const eps = rat.priceEarningsRatioTTM > 0 ? currentPrice / rat.priceEarningsRatioTTM : 0;
        const bvps = km.bookValuePerShareTTM;
        if (eps > 0 && bvps > 0) {
          const grahamNumber = Math.sqrt(22.5 * eps * bvps);
          advanceHeuristic = { intrinsicValue: grahamNumber };
        }
      }

      // 4. SGR estimate from forecasts
      let sgr = null;
      if (forecastData && Array.isArray(forecastData) && forecastData.length >= 2) {
        const sorted = [...forecastData].sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
        const last = sorted[sorted.length - 1];
        const prev = sorted[sorted.length - 2];
        const lastRev = last?.revenueAvg || last?.estimatedRevenueAvg;
        const prevRev = prev?.revenueAvg || prev?.estimatedRevenueAvg;
        if (lastRev && prevRev && prevRev > 0) {
          sgr = (lastRev - prevRev) / prevRev;
        }
      }

      // 5. Call backend prediction endpoint
      const predRes = await fetch(`${BACKEND}/earnings-prediction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          currentPrice,
          profile: prof || {},
          quality: qualityHeuristic,
          advance: advanceHeuristic,
          sgr,
          ratiosTTM: rat || {},
          history: past,
          forecasts: Array.isArray(forecastData) ? forecastData : [],
          news: Array.isArray(newsData) ? newsData : [],
          probability: { volatility: rat?.priceToSalesRatioTTM ? 0.30 : 0.30 },
        }),
      });

      if (!predRes.ok) {
        const text = await predRes.text();
        throw new Error(`Prediction failed: ${predRes.status} - ${text}`);
      }

      const predResult = await predRes.json();
      setPrediction(predResult);
    } catch (err: any) {
      console.error('Earnings prediction error:', err);
      setError(err.message || 'Error running prediction');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const consensusColor = (c: string) => {
    if (c?.includes('BULLISH')) return 'text-green-400 border-green-500/30 bg-green-500/10';
    if (c?.includes('BEARISH')) return 'text-red-400 border-red-500/30 bg-red-500/10';
    return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
  };

  const impactColor = (impact: string) => {
    if (impact === '+') return 'text-green-400';
    if (impact === '-') return 'text-red-400';
    return 'text-gray-400';
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />

      <main className="pt-20 pb-16 px-4">
        <div className="max-w-5xl mx-auto">
          {/* Back link */}
          <Link
            href="/earnings"
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition mb-6"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {es ? 'Volver al calendario' : 'Back to calendar'}
          </Link>

          {/* Header card */}
          <div className="flex items-start gap-5 mb-8">
            <img
              src={FMP_IMG(ticker)}
              alt={ticker}
              className="w-16 h-16 rounded-xl bg-white/[0.06] object-contain flex-shrink-0"
              onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-3xl font-black tracking-tight">{ticker}</h1>
                {profile?.companyName && (
                  <span className="text-sm text-gray-500 truncate">{profile.companyName}</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs">
                {profile?.sector && (
                  <span className="text-gray-400">{profile.sector}</span>
                )}
                {quote?.price && (
                  <>
                    <span className="text-gray-700">&bull;</span>
                    <span className="text-gray-300 font-mono">${quote.price.toFixed(2)}</span>
                  </>
                )}
                {quote?.changesPercentage != null && (
                  <span className={`font-mono ${quote.changesPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {quote.changesPercentage >= 0 ? '+' : ''}{quote.changesPercentage.toFixed(2)}%
                  </span>
                )}
                {nextEarning?.date && (
                  <>
                    <span className="text-gray-700">&bull;</span>
                    <span className="text-amber-400 font-medium">
                      {es ? 'Reporta' : 'Reports'} {nextEarning.date}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <LogoLoader size="md" />
              <p className="text-sm text-gray-500">
                {es ? 'Analizando con red neuronal...' : 'Running neural analysis...'}
              </p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.05] p-6 text-center">
              <p className="text-red-400 font-medium mb-2">{error}</p>
              <button
                onClick={runAnalysis}
                className="text-xs px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 transition"
              >
                {es ? 'Reintentar' : 'Retry'}
              </button>
            </div>
          ) : prediction ? (
            <>
              {/* Overall score banner */}
              <div className={`rounded-2xl border p-6 mb-6 ${consensusColor(prediction.consensus)}`}>
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-widest font-semibold mb-1 opacity-70">
                      {es ? 'Score Post-Earnings' : 'Post-Earnings Score'}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-black">{prediction.overallScore}</span>
                      <span className="text-lg text-gray-400">/100</span>
                    </div>
                    <div className="mt-1 font-bold tracking-wider">
                      {prediction.consensus.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-gray-500 mb-1">
                      {es ? 'Probabilidad de BEAT estimada' : 'Estimated BEAT probability'}
                    </div>
                    <div className="text-3xl font-bold font-mono">{prediction.probBeatEstimate}%</div>
                  </div>
                </div>
                <p className="text-sm mt-4 leading-relaxed opacity-90">
                  {prediction.commentary}
                </p>
              </div>

              {/* BEAT vs MISS scenarios */}
              <div className="grid md:grid-cols-2 gap-4 mb-8">
                {/* BEAT */}
                <div className="rounded-xl border border-green-500/20 bg-green-500/[0.04] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider bg-green-500 text-black">
                        BEAT
                      </span>
                      <h3 className="text-sm font-semibold text-gray-200">
                        {es ? 'Si supera estimados' : 'If beats estimates'}
                      </h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
                        {es ? 'Prob. de subir' : 'Up probability'}
                      </div>
                      <div className="text-3xl font-black text-green-400">
                        {prediction.beatScenario.upProbability}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
                        {es ? 'Magnitud esperada' : 'Expected move'}
                      </div>
                      <div className="text-2xl font-bold text-gray-200 font-mono">
                        +{prediction.beatScenario.expectedMagnitude.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      {es ? 'Drivers' : 'Drivers'}
                    </div>
                    {prediction.beatScenario.drivers.map((d, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`font-mono font-bold w-3 text-center ${impactColor(d.impact)}`}>
                          {d.impact}
                        </span>
                        <div className="flex-1">
                          <span className="font-semibold text-gray-300">{d.factor}: </span>
                          <span className="text-gray-400">{d.description}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* MISS */}
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wider bg-red-500 text-black">
                        MISS
                      </span>
                      <h3 className="text-sm font-semibold text-gray-200">
                        {es ? 'Si no alcanza estimados' : 'If misses estimates'}
                      </h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
                        {es ? 'Prob. de subir' : 'Up probability'}
                      </div>
                      <div className="text-3xl font-black text-yellow-400">
                        {prediction.missScenario.upProbability}%
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 uppercase tracking-wider mb-1">
                        {es ? 'Magnitud esperada' : 'Expected move'}
                      </div>
                      <div className="text-2xl font-bold text-gray-200 font-mono">
                        {prediction.missScenario.expectedMagnitude.toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                      {es ? 'Drivers' : 'Drivers'}
                    </div>
                    {prediction.missScenario.drivers.map((d, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`font-mono font-bold w-3 text-center ${impactColor(d.impact)}`}>
                          {d.impact}
                        </span>
                        <div className="flex-1">
                          <span className="font-semibold text-gray-300">{d.factor}: </span>
                          <span className="text-gray-400">{d.description}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Historical earnings table */}
              {history.length > 0 && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden mb-6">
                  <div className="px-5 py-3 border-b border-white/[0.06]">
                    <h3 className="text-sm font-semibold text-gray-200">
                      {es ? 'Historial de Earnings' : 'Earnings History'}
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {es ? 'Ultimos trimestres reportados' : 'Last reported quarters'}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-white/[0.02] text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="text-left p-3">Date</th>
                          <th className="text-right p-3">EPS Est.</th>
                          <th className="text-right p-3">EPS Actual</th>
                          <th className="text-right p-3">Surprise</th>
                          <th className="text-center p-3">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((h, i) => {
                          const surprise = h.epsActual - h.epsEstimated;
                          const surprisePct = h.epsEstimated !== 0 ? (surprise / Math.abs(h.epsEstimated)) * 100 : 0;
                          const beat = h.epsActual >= h.epsEstimated;
                          return (
                            <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                              <td className="p-3 text-gray-400 font-mono">{h.date}</td>
                              <td className="p-3 text-right text-gray-400 font-mono">${h.epsEstimated.toFixed(2)}</td>
                              <td className="p-3 text-right text-gray-200 font-mono font-semibold">${h.epsActual.toFixed(2)}</td>
                              <td className={`p-3 text-right font-mono ${beat ? 'text-green-400' : 'text-red-400'}`}>
                                {surprise >= 0 ? '+' : ''}{surprisePct.toFixed(1)}%
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${beat ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                  {beat ? 'BEAT' : 'MISS'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Factors breakdown */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 mb-6">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">
                  {es ? 'Factores del Modelo' : 'Model Factors'}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {prediction.factors.quality?.note !== 'no_data' && (
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">Quality</div>
                      <div className="text-lg font-bold text-white">{Math.round(prediction.factors.quality.score)}/100</div>
                    </div>
                  )}
                  {prediction.factors.valuation?.note === 'ok' && (
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">{es ? 'Retorno Esperado' : 'Expected Return'}</div>
                      <div className={`text-lg font-bold ${prediction.factors.valuation.expectedReturn > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {(prediction.factors.valuation.expectedReturn * 100).toFixed(1)}%
                      </div>
                    </div>
                  )}
                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">{es ? 'Crecimiento' : 'Growth'}</div>
                    <div className="text-lg font-bold text-white">{prediction.factors.growth.growthRate.toFixed(1)}%</div>
                  </div>
                  {prediction.factors.history?.note === 'ok' && (
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">{es ? 'Tasa de Beat' : 'Beat Rate'}</div>
                      <div className="text-lg font-bold text-white">
                        {Math.round(prediction.factors.history.beatRate * 100)}%
                        <span className="text-[10px] text-gray-500 ml-1">({prediction.factors.history.sample}Q)</span>
                      </div>
                    </div>
                  )}
                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">{es ? 'Volatilidad' : 'Volatility'}</div>
                    <div className="text-lg font-bold text-white">{(prediction.factors.volatility.sigma * 100).toFixed(0)}%</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                    <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">{es ? 'Sentimiento' : 'Sentiment'}</div>
                    <div className={`text-lg font-bold ${prediction.factors.sentiment.normalized > 0.1 ? 'text-green-400' : prediction.factors.sentiment.normalized < -0.1 ? 'text-red-400' : 'text-gray-300'}`}>
                      {prediction.factors.sentiment.normalized > 0.1 ? '+' : prediction.factors.sentiment.normalized < -0.1 ? '−' : '='}
                    </div>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <div className="flex justify-center gap-3">
                <Link
                  href={`/analizar?ticker=${ticker}`}
                  className="px-5 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-sm text-gray-300 hover:text-white transition font-medium"
                >
                  {es ? 'Ver analisis completo' : 'View full analysis'} →
                </Link>
              </div>

              {/* Disclaimer */}
              <p className="text-[10px] text-gray-700 text-center mt-8 max-w-2xl mx-auto leading-relaxed">
                {es
                  ? 'Este score es generado por un modelo multi-factor y no constituye consejo de inversion. Las probabilidades son estimaciones basadas en datos historicos y fundamentales.'
                  : 'This score is generated by a multi-factor model and does not constitute investment advice. Probabilities are estimates based on historical and fundamental data.'}
              </p>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
