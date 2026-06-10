// src/app/components/tabs/CycleModelsTab.tsx
// MODELOS AVANZADOS DE CICLOS — Fase 1
// Modelo 1: MS Unobserved Components + filtro de Kim (2 regímenes)
// Modelo 6: Unobserved Components (raíz unitaria + ciclo AR(2))
'use client';

import { useMemo, useState } from 'react';
import { Tab } from '@headlessui/react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { useLanguage } from '@/i18n/LanguageContext';
import { postBackend } from '@/lib/backendClient';

// ── Tipos del payload del backend ───────────────────────────────────────────
interface RegimeParam {
  label: string;
  beta: number;
  phi1: number;
  phi2: number;
  sigma_eta: number;
  sigma_kappa: number;
  sigma_eps: number;
  cycle_period_years: number | null;
}

interface MsUcModel {
  available: boolean;
  error?: string;
  trend?: (number | null)[];
  cycle?: (number | null)[];
  regime_prob_bull_filtered?: (number | null)[];
  regime_prob_bull_smoothed?: (number | null)[];
  current_regime?: string;
  current_regime_prob?: number;
  cycle_phase?: string;
  cycle_phase_position?: number | null;
  cycle_period_years?: number | null;
  transition_matrix?: number[][];
  regime_params?: RegimeParam[];
  log_likelihood?: number;
  converged?: boolean;
}

interface UcModel {
  available: boolean;
  error?: string;
  trend?: (number | null)[];
  cycle?: (number | null)[];
  phi1?: number;
  phi2?: number;
  cycle_period_years?: number | null;
  log_likelihood?: number;
  aic?: number;
  converged?: boolean;
}

interface SpectralPeak {
  period_years: number;
  power: number;
  contribution_pct: number;
}

interface SpectralRegime {
  label: string;
  available: boolean;
  dominant_period_years?: number;
  dominant_power?: number;
  total_power?: number;
  peaks?: SpectralPeak[];
  spectrum?: { period_years: number; power: number }[];
}

interface SpectralModel {
  available: boolean;
  error?: string;
  signal_description?: string;
  window?: string;
  regimes?: SpectralRegime[];
  comparison?: {
    bull_dominant_period_years?: number;
    bear_dominant_period_years?: number;
    bull_dominant_power?: number;
    bear_dominant_power?: number;
    stronger_regime?: string;
    power_ratio?: number | null;
    ratio_degenerate?: boolean;
  };
  narrative?: string;
}

interface VecmRegime {
  label: string;
  alpha: number | null;
  sigma: number | null;
  half_life_weeks: number | null;
  half_life_years: number | null;
}

interface VecmModel {
  available: boolean;
  error?: string;
  cointegrated?: boolean;
  rank?: number;
  system?: string[];
  johansen?: { trace_stat: number[]; crit_95: number[]; rank: number };
  beta?: { ticker: string; coef: number }[];
  ect?: { current: number; mean: number; std: number; zscore: number; series: (number | null)[] };
  regimes?: VecmRegime[];
  regime_prob_primary_filtered?: (number | null)[];
  regime_prob_primary_smoothed?: (number | null)[];
  primary_label?: string;
  current_regime?: string;
  current_regime_prob?: number;
  dates?: string[];
  log_likelihood?: number;
  narrative?: string;
}

interface TvpCoefficient {
  name: string;
  label: string;
  series: (number | null)[];
  std: (number | null)[];
  current: number;
  current_std: number;
  year_ago: number;
  is_self: boolean;
}

interface TvpModel {
  available: boolean;
  error?: string;
  system?: string[];
  dates?: string[];
  n_obs?: number;
  coefficients?: TvpCoefficient[];
  obs_var?: number;
  log_likelihood?: number;
  converged?: boolean;
  narrative?: string;
}

interface GarchRegime {
  label: string;
  mu: number;
  omega: number;
  alpha: number;
  beta: number;
  persistence: number;
  uncond_vol_annual: number;
}

interface GarchModel {
  available: boolean;
  error?: string;
  frequency?: string;
  n_obs?: number;
  dates?: string[];
  cond_vol_annual?: (number | null)[];
  regime_prob_highvol_filtered?: (number | null)[];
  regime_prob_highvol_smoothed?: (number | null)[];
  current_regime?: string;
  current_regime_prob?: number;
  current_vol_annual?: number;
  regimes?: GarchRegime[];
  transition_matrix?: number[][];
  nu?: number;
  forecast?: { horizon_days: number; vol_annual: number }[];
  var?: { var_95_1d: number; var_99_1d: number; cvar_95_1d: number };
  log_likelihood?: number;
  converged?: boolean;
  narrative?: string;
}

interface CycleResult {
  ticker: string;
  variable_used: string;
  frequency: string;
  n_obs: number;
  dates: string[];
  series: (number | null)[];
  price: (number | null)[];
  models: {
    ms_uc?: MsUcModel;
    uc?: UcModel;
    spectral?: SpectralModel;
    ms_vecm?: VecmModel;
    tvp_var?: TvpModel;
    ms_garch?: GarchModel;
  };
  narrative: string;
}

interface CycleModelsTabProps {
  ticker: string;
}

const PHASE_LABEL: Record<string, { en: string; es: string; color: string }> = {
  peak: { en: 'Peak', es: 'Pico', color: 'text-red-400' },
  falling: { en: 'Falling', es: 'Bajando', color: 'text-orange-400' },
  trough: { en: 'Trough', es: 'Valle', color: 'text-emerald-400' },
  rising: { en: 'Rising', es: 'Subiendo', color: 'text-green-400' },
  unknown: { en: 'Unknown', es: 'Indeterminada', color: 'text-gray-400' },
};

export default function CycleModelsTab({ ticker }: CycleModelsTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const t = (en: string, esp: string) => (es ? esp : en);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CycleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemTickers, setSystemTickers] = useState('SPY, TLT');

  const analyze = async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const partners = systemTickers
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      // La estimación ML del MS-UC puede tardar — timeout amplio (4 min)
      const data = await postBackend<CycleResult>(
        '/cycle-models/analyze',
        {
          ticker,
          variable: 'log_price',
          frequency: 'weekly',
          models: ['ms_uc', 'spectral', 'ms_vecm', 'tvp_var', 'ms_garch', 'uc'],
          system_tickers: partners.length ? partners : null,
        },
        240000,
      );
      setResult(data);
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const subtabs = [
    t('Model 1 · MS-UC', 'Modelo 1 · MS-UC'),
    t('Model 2 · Spectral', 'Modelo 2 · Espectral'),
    t('Model 3 · MS-VECM', 'Modelo 3 · MS-VECM'),
    t('Model 4 · TVP-VAR', 'Modelo 4 · TVP-VAR'),
    t('Model 5 · MS-GARCH', 'Modelo 5 · MS-GARCH'),
    t('Model 6 · UC', 'Modelo 6 · UC'),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold text-indigo-300">
            {t('🌀 Advanced Cycle Models', '🌀 Modelos Avanzados de Ciclos')}
          </h3>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            {t(
              'Regime-switching + cycle decomposition (Kim & Nelson). Weekly estimation, log-price. Heavy ML estimation — runs on demand.',
              'Regímenes + descomposición de ciclo (Kim & Nelson). Estimación semanal sobre log-precio. La estimación ML es pesada — corre a pedido.',
            )}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col text-[11px] text-gray-500">
            {t('VECM system (tickers)', 'Sistema VECM (tickers)')}
            <input
              value={systemTickers}
              onChange={(e) => setSystemTickers(e.target.value)}
              disabled={loading}
              placeholder="SPY, TLT"
              className="mt-1 w-40 px-2 py-2 rounded-lg bg-black/40 border border-indigo-900/40 text-sm text-gray-200 focus:outline-none focus:border-indigo-500/60"
            />
          </label>
          <button
            onClick={analyze}
            disabled={loading || !ticker}
            className="shrink-0 px-5 py-2.5 rounded-lg font-semibold text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all shadow-lg"
          >
            {loading
              ? t('Estimating…', 'Estimando…')
              : t(`Analyze ${ticker || ''}`, `Analizar ${ticker || ''}`)}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-10 text-indigo-300 animate-pulse">
          {t('Running Kim filter + ML estimation… this can take up to a minute.',
             'Corriendo filtro de Kim + estimación ML… puede tardar hasta un minuto.')}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-4 text-red-300 text-sm">
          {t('Error: ', 'Error: ')}{error}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-8 text-center text-gray-500">
          {t('Press "Analyze" to estimate the cycle/regime models for ',
             'Presioná "Analizar" para estimar los modelos de ciclo/régimen de ')}
          <span className="text-indigo-300 font-semibold">{ticker || '—'}</span>.
        </div>
      )}

      {result && (
        <>
          {result.narrative && (
            <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/20 p-4 text-sm text-indigo-100">
              {result.narrative}
            </div>
          )}

          <Tab.Group>
            <div className="overflow-x-auto -mx-1 px-1">
              <Tab.List className="flex gap-1.5 sm:gap-2 bg-black/60 border border-indigo-900/20 p-1.5 rounded-xl min-w-max sm:min-w-0">
                {subtabs.map((tab) => (
                  <Tab
                    key={tab}
                    className={({ selected }) =>
                      `shrink-0 sm:flex-1 py-2 px-3 sm:px-4 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                        selected
                          ? 'bg-indigo-900/40 text-indigo-300 border border-indigo-500/40'
                          : 'text-gray-500 hover:text-indigo-300/70 hover:bg-indigo-900/10 border border-transparent'
                      }`
                    }
                  >
                    {tab}
                  </Tab>
                ))}
              </Tab.List>
            </div>

            <Tab.Panels className="mt-4">
              <Tab.Panel unmount={false}>
                <MsUcPanel result={result} t={t} />
              </Tab.Panel>
              <Tab.Panel unmount={false}>
                <SpectralPanel result={result} t={t} />
              </Tab.Panel>
              <Tab.Panel unmount={false}>
                <VecmPanel result={result} t={t} />
              </Tab.Panel>
              <Tab.Panel unmount={false}>
                <TvpPanel result={result} t={t} />
              </Tab.Panel>
              <Tab.Panel unmount={false}>
                <GarchPanel result={result} t={t} />
              </Tab.Panel>
              <Tab.Panel unmount={false}>
                <UcPanel result={result} t={t} />
              </Tab.Panel>
            </Tab.Panels>
          </Tab.Group>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Panel Modelo 1 — MS-UC
// ════════════════════════════════════════════════════════════════════════════
function MsUcPanel({ result, t }: { result: CycleResult; t: (en: string, es: string) => string }) {
  const ms = result.models.ms_uc;

  const regimeData = useMemo(() => {
    if (!ms?.available) return [];
    const f = ms.regime_prob_bull_filtered || [];
    const s = ms.regime_prob_bull_smoothed || [];
    return result.dates.map((d, i) => ({
      date: d,
      filtered: f[i] ?? null,
      smoothed: s[i] ?? null,
    }));
  }, [ms, result.dates]);

  const decompData = useMemo(() => {
    if (!ms?.available) return [];
    const trend = ms.trend || [];
    return result.dates.map((d, i) => ({
      date: d,
      series: result.series[i] ?? null,
      trend: trend[i] ?? null,
    }));
  }, [ms, result.dates, result.series]);

  const cycleData = useMemo(() => {
    if (!ms?.available) return [];
    const cyc = ms.cycle || [];
    return result.dates.map((d, i) => ({ date: d, cycle: cyc[i] ?? null }));
  }, [ms, result.dates]);

  if (!ms?.available) {
    return <DegradedNotice msg={ms?.error} t={t} />;
  }

  const isBull = ms.current_regime === 'Bull';
  const phase = PHASE_LABEL[ms.cycle_phase || 'unknown'];

  return (
    <div className="space-y-5">
      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label={t('Current regime', 'Régimen actual')}
          value={isBull ? t('Bull', 'Alcista') : t('Bear', 'Bajista')}
          valueClass={isBull ? 'text-emerald-400' : 'text-red-400'}
          sub={`${((ms.current_regime_prob ?? 0) * 100).toFixed(0)}% ${t('prob (filtered)', 'prob (filtrada)')}`}
        />
        <Stat
          label={t('Cycle phase', 'Fase del ciclo')}
          value={es(t) ? phase.es : phase.en}
          valueClass={phase.color}
          sub={ms.cycle_phase_position != null ? `pos ${(ms.cycle_phase_position * 100).toFixed(0)}%` : ''}
        />
        <Stat
          label={t('Cycle period', 'Período del ciclo')}
          value={ms.cycle_period_years ? `${ms.cycle_period_years.toFixed(1)} ${t('yr', 'años')}` : 'N/A'}
          valueClass="text-indigo-300"
        />
        <Stat
          label={t('Log-likelihood', 'Log-verosimilitud')}
          value={ms.log_likelihood != null ? ms.log_likelihood.toFixed(1) : 'N/A'}
          valueClass="text-gray-200"
          sub={ms.converged ? t('converged', 'convergió') : '⚠ ' + t('not converged', 'no convergió')}
        />
      </div>

      {/* Banda de régimen */}
      <ChartCard title={t('Bull-regime probability (P[Bull])', 'Probabilidad de régimen alcista (P[Alcista])')}>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={regimeData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (v == null ? '—' : Number(v).toFixed(2))} />
            <ReferenceLine y={0.5} stroke="#52525b" strokeDasharray="4 4" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="smoothed" name={t('Smoothed', 'Suavizada')}
                  stroke="#34d399" fill="#34d39933" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="filtered" name={t('Filtered', 'Filtrada')}
                  stroke="#818cf8" strokeWidth={1} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Descomposición tendencia */}
      <ChartCard title={t('Series vs. stochastic trend (μ̂)', 'Serie vs. tendencia estocástica (μ̂)')}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={decompData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (v == null ? '—' : Number(v).toFixed(3))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="series" name={t('log price', 'log precio')}
                  stroke="#9ca3af" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="trend" name="μ̂" stroke="#fbbf24" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Ciclo */}
      <ChartCard title={t('Cyclical component (ĉ)', 'Componente cíclico (ĉ)')}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={cycleData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (v == null ? '—' : Number(v).toFixed(4))} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Line type="monotone" dataKey="cycle" name="ĉ" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Matriz de transición + params por régimen */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
          <h4 className="text-sm font-semibold text-indigo-300 mb-3">
            {t('Transition matrix P[i→j]', 'Matriz de transición P[i→j]')}
          </h4>
          {ms.transition_matrix && (
            <table className="text-sm w-full">
              <thead>
                <tr className="text-gray-500">
                  <th className="text-left py-1"></th>
                  <th className="text-right py-1">→ {t('Bull', 'Alcista')}</th>
                  <th className="text-right py-1">→ {t('Bear', 'Bajista')}</th>
                </tr>
              </thead>
              <tbody>
                {['Bull', 'Bear'].map((rowLabel, i) => (
                  <tr key={rowLabel} className="border-t border-gray-800">
                    <td className="py-1 text-gray-400">{es(t) ? (i === 0 ? 'Alcista' : 'Bajista') : rowLabel}</td>
                    <td className="py-1 text-right text-gray-200">{ms.transition_matrix![i][0].toFixed(3)}</td>
                    <td className="py-1 text-right text-gray-200">{ms.transition_matrix![i][1].toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
          <h4 className="text-sm font-semibold text-indigo-300 mb-3">
            {t('Per-regime parameters', 'Parámetros por régimen')}
          </h4>
          <div className="space-y-3">
            {(ms.regime_params || []).map((rp) => (
              <div key={rp.label} className="text-xs">
                <div className={`font-semibold mb-1 ${rp.label === 'Bull' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {rp.label === 'Bull' ? t('Bull', 'Alcista') : t('Bear', 'Bajista')}
                </div>
                <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-gray-400">
                  <span>β = <span className="text-gray-200">{rp.beta.toExponential(2)}</span></span>
                  <span>φ₁ = <span className="text-gray-200">{rp.phi1.toFixed(3)}</span></span>
                  <span>φ₂ = <span className="text-gray-200">{rp.phi2.toFixed(3)}</span></span>
                  <span>σ_η = <span className="text-gray-200">{rp.sigma_eta.toExponential(2)}</span></span>
                  <span>σ_κ = <span className="text-gray-200">{rp.sigma_kappa.toExponential(2)}</span></span>
                  <span>σ_ε = <span className="text-gray-200">{rp.sigma_eps.toExponential(2)}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Panel Modelo 2 — Análisis Espectral por Régimen
// ════════════════════════════════════════════════════════════════════════════
function SpectralPanel({ result, t }: { result: CycleResult; t: (en: string, es: string) => string }) {
  const sp = result.models.spectral;

  const chartData = useMemo(() => {
    if (!sp?.available) return [];
    const bull = sp.regimes?.find((r) => r.label === 'Bull');
    const bear = sp.regimes?.find((r) => r.label === 'Bear');
    const bs = bull?.spectrum || [];
    const rs = bear?.spectrum || [];
    const rows = bs.map((pt, i) => ({
      period: pt.period_years,
      bull: pt.power,
      bear: rs[i]?.power ?? null,
    }));
    // orden ascendente por período para un eje X legible
    return rows.sort((a, b) => a.period - b.period);
  }, [sp]);

  if (!sp?.available) {
    return <DegradedNotice msg={sp?.error} t={t} />;
  }

  const bull = sp.regimes?.find((r) => r.label === 'Bull');
  const bear = sp.regimes?.find((r) => r.label === 'Bear');
  const cmp = sp.comparison;
  const strongerBull = cmp?.stronger_regime === 'Bull';

  return (
    <div className="space-y-5">
      {sp.narrative && (
        <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/20 p-3 text-sm text-indigo-100">
          {sp.narrative}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('Bull dominant cycle', 'Ciclo dominante alcista')}
              value={bull?.dominant_period_years ? `${bull.dominant_period_years.toFixed(1)} ${t('yr', 'años')}` : 'N/A'}
              valueClass="text-emerald-400" />
        <Stat label={t('Bear dominant cycle', 'Ciclo dominante bajista')}
              value={bear?.dominant_period_years ? `${bear.dominant_period_years.toFixed(1)} ${t('yr', 'años')}` : 'N/A'}
              valueClass="text-red-400" />
        <Stat label={t('Stronger cycles in', 'Ciclos más fuertes en')}
              value={strongerBull ? t('Bull', 'Alcista') : t('Bear', 'Bajista')}
              valueClass={strongerBull ? 'text-emerald-400' : 'text-red-400'} />
        <Stat label={t('Power ratio (bull/bear)', 'Ratio potencia (bull/bear)')}
              value={cmp?.ratio_degenerate
                ? '≫ 99×'
                : (cmp?.power_ratio != null ? `×${cmp.power_ratio.toFixed(1)}` : 'N/A')}
              valueClass="text-indigo-300"
              sub={cmp?.ratio_degenerate ? t('one regime barely occurs', 'un régimen apenas ocurre') : ''} />
      </div>

      <ChartCard title={t('Spectral density by regime (power vs. period)', 'Densidad espectral por régimen (potencia vs. período)')}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="period" type="number" domain={[0.25, 8]}
                   tick={{ fontSize: 10, fill: '#6b7280' }}
                   tickFormatter={(v: number) => `${v.toFixed(1)}y`}
                   label={{ value: t('cycle period (yr)', 'período del ciclo (años)'), position: 'insideBottom', offset: -2, fontSize: 10, fill: '#6b7280' }} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => v.toExponential(0)} />
            <Tooltip contentStyle={tooltipStyle}
                     labelFormatter={(v: any) => `${Number(v).toFixed(2)} ${t('yr', 'años')}`}
                     formatter={(val: any) => (val == null ? '—' : Number(val).toExponential(2))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="bull" name={t('Bull', 'Alcista')}
                  stroke="#34d399" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="bear" name={t('Bear', 'Bajista')}
                  stroke="#f87171" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-gray-500 mt-1">{sp.signal_description} · {sp.window}</p>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[bull, bear].map((rg) => rg && (
          <div key={rg.label} className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
            <h4 className={`text-sm font-semibold mb-3 ${rg.label === 'Bull' ? 'text-emerald-400' : 'text-red-400'}`}>
              {t('Top spectral peaks', 'Picos espectrales')} — {rg.label === 'Bull' ? t('Bull', 'Alcista') : t('Bear', 'Bajista')}
            </h4>
            <table className="text-xs w-full">
              <thead>
                <tr className="text-gray-500">
                  <th className="text-left py-1">{t('Period', 'Período')}</th>
                  <th className="text-right py-1">{t('Power', 'Potencia')}</th>
                  <th className="text-right py-1">{t('Contribution', 'Contribución')}</th>
                </tr>
              </thead>
              <tbody>
                {(rg.peaks || []).map((pk, i) => (
                  <tr key={i} className="border-t border-gray-800">
                    <td className="py-1 text-gray-300">{pk.period_years.toFixed(1)} {t('yr', 'años')}</td>
                    <td className="py-1 text-right text-gray-400">{pk.power.toExponential(2)}</td>
                    <td className="py-1 text-right text-gray-400">{pk.contribution_pct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Panel Modelo 3 — MS-VECM cointegrado
// ════════════════════════════════════════════════════════════════════════════
function fmtHalfLife(weeks: number | null, t: (en: string, es: string) => string): string {
  if (weeks == null) return 'N/A';
  return weeks >= 26 ? `${(weeks / 52).toFixed(1)} ${t('yr', 'años')}` : `${weeks.toFixed(0)} ${t('wk', 'sem')}`;
}

function VecmPanel({ result, t }: { result: CycleResult; t: (en: string, es: string) => string }) {
  const v = result.models.ms_vecm;

  const chartData = useMemo(() => {
    if (!v?.available || !v.dates) return [];
    const ect = v.ect?.series || [];
    const pr = v.regime_prob_primary_smoothed || [];
    return v.dates.map((d, i) => ({ date: d, ect: ect[i] ?? null, prob: pr[i] ?? null }));
  }, [v]);

  if (!v?.available) return <DegradedNotice msg={v?.error} t={t} />;

  const z = v.ect?.zscore ?? 0;
  const rich = z > 1.5, cheap = z < -1.5;
  const mr = v.regimes?.find((r) => r.label === 'Mean-reverting');
  const primaryIsMR = v.primary_label === 'Mean-reverting';

  return (
    <div className="space-y-5">
      {v.narrative && (
        <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/20 p-3 text-sm text-indigo-100">
          {v.narrative}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('Cointegration', 'Cointegración')}
              value={v.cointegrated ? `rank ${v.rank}` : t('none', 'ninguna')}
              valueClass={v.cointegrated ? 'text-emerald-400' : 'text-gray-400'}
              sub={(v.system || []).join(' · ')} />
        <Stat label={t('Relative value (ECT z)', 'Valor relativo (ECT z)')}
              value={`${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`}
              valueClass={rich ? 'text-red-400' : cheap ? 'text-emerald-400' : 'text-gray-200'}
              sub={rich ? t('rich vs. equilibrium', 'caro vs. equilibrio')
                 : cheap ? t('cheap vs. equilibrium', 'barato vs. equilibrio')
                 : t('near equilibrium', 'cerca del equilibrio')} />
        <Stat label={t('Current regime', 'Régimen actual')}
              value={v.current_regime || '—'}
              valueClass="text-indigo-300"
              sub={`${((v.current_regime_prob ?? 0) * 100).toFixed(0)}% ${t('prob', 'prob')}`} />
        <Stat label={t('Reversion half-life', 'Vida media reversión')}
              value={fmtHalfLife(mr?.half_life_weeks ?? null, t)}
              valueClass="text-gray-200" />
      </div>

      {/* Banda de equilibrio (ECT) + probabilidad del régimen primario */}
      <ChartCard title={t('Deviation from long-run equilibrium (ECT) & regime probability',
                          'Desvío del equilibrio de largo plazo (ECT) y probabilidad de régimen')}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis yAxisId="ect" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis yAxisId="prob" orientation="right" domain={[0, 1]} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(val: any) => (val == null ? '—' : Number(val).toFixed(3))} />
            <ReferenceLine yAxisId="ect" y={v.ect?.mean ?? 0} stroke="#52525b" strokeDasharray="4 4" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="ect" type="monotone" dataKey="ect" name="ECT (β′Y)"
                  stroke="#fbbf24" strokeWidth={1.5} dot={false} />
            <Line yAxisId="prob" type="monotone" dataKey="prob"
                  name={`P[${primaryIsMR ? t('Mean-rev', 'Reversión') : t('Low-vol', 'Baja-vol')}]`}
                  stroke="#34d399" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Relación de largo plazo (β) */}
        <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
          <h4 className="text-sm font-semibold text-indigo-300 mb-3">
            {t('Long-run relationship (β)', 'Relación de largo plazo (β)')}
          </h4>
          <table className="text-sm w-full">
            <tbody>
              {(v.beta || []).map((b) => (
                <tr key={b.ticker} className="border-t border-gray-800">
                  <td className="py-1 text-gray-400">{b.ticker}</td>
                  <td className="py-1 text-right text-gray-200">{b.coef.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!v.cointegrated && (
            <p className="text-[11px] text-amber-400/70 mt-2">
              {t('No cointegration evidence — MS-VAR in differences (no ECT).',
                 'Sin evidencia de cointegración — MS-VAR en diferencias (sin ECT).')}
            </p>
          )}
        </div>

        {/* Parámetros por régimen */}
        <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
          <h4 className="text-sm font-semibold text-indigo-300 mb-3">
            {t('Per-regime adjustment', 'Ajuste por régimen')}
          </h4>
          <table className="text-xs w-full">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-1">{t('Regime', 'Régimen')}</th>
                <th className="text-right py-1">α</th>
                <th className="text-right py-1">σ</th>
                <th className="text-right py-1">{t('Half-life', 'Vida media')}</th>
              </tr>
            </thead>
            <tbody>
              {(v.regimes || []).map((r) => (
                <tr key={r.label} className="border-t border-gray-800">
                  <td className="py-1 text-gray-300">{r.label}</td>
                  <td className="py-1 text-right text-gray-400">{r.alpha != null ? r.alpha.toFixed(3) : '—'}</td>
                  <td className="py-1 text-right text-gray-400">{r.sigma != null ? r.sigma.toExponential(1) : '—'}</td>
                  <td className="py-1 text-right text-gray-400">{fmtHalfLife(r.half_life_weeks, t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Panel Modelo 4 — TVP-VAR (coeficientes variables)
// ════════════════════════════════════════════════════════════════════════════
const TVP_COLORS = ['#fbbf24', '#34d399', '#f87171', '#a78bfa', '#38bdf8', '#fb923c'];

function TvpPanel({ result, t }: { result: CycleResult; t: (en: string, es: string) => string }) {
  const v = result.models.tvp_var;

  // Trayectorias de las sensibilidades (excluye el intercepto)
  const plotted = useMemo(
    () => (v?.coefficients || []).filter((c) => c.name !== 'const'),
    [v],
  );

  const chartData = useMemo(() => {
    if (!v?.available || !v.dates) return [];
    return v.dates.map((d, i) => {
      const row: Record<string, any> = { date: d };
      plotted.forEach((c) => { row[c.label] = c.series[i] ?? null; });
      return row;
    });
  }, [v, plotted]);

  if (!v?.available) return <DegradedNotice msg={v?.error} t={t} />;

  return (
    <div className="space-y-5">
      {v.narrative && (
        <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/20 p-3 text-sm text-indigo-100">
          {v.narrative}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {plotted.map((c, i) => {
          const delta = c.current - c.year_ago;
          const arrow = delta > 0.05 ? '▲' : delta < -0.05 ? '▼' : '→';
          return (
            <Stat key={c.name}
                  label={c.label}
                  value={`${c.current >= 0 ? '+' : ''}${c.current.toFixed(2)}`}
                  valueClass=""
                  sub={`${arrow} ${t('1y ago', 'hace 1a')} ${c.year_ago >= 0 ? '+' : ''}${c.year_ago.toFixed(2)} · ±${c.current_std.toFixed(2)}`} />
          );
        })}
      </div>

      <ChartCard title={t('Time-varying coefficients (Kalman-smoothed)',
                          'Coeficientes variables en el tiempo (suavizado Kalman)')}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(val: any) => (val == null ? '—' : Number(val).toFixed(2))} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {plotted.map((c, i) => (
              <Line key={c.name} type="monotone" dataKey={c.label} name={c.label}
                    stroke={TVP_COLORS[i % TVP_COLORS.length]} strokeWidth={1.8} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-gray-500 mt-1">
          {t('System: ', 'Sistema: ')}{(v.system || []).join(' · ')} · {t('contemporaneous betas + own AR(1); random-walk coefficients.',
             'betas contemporáneas + AR(1) propio; coeficientes random-walk.')}
        </p>
      </ChartCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Panel Modelo 6 — UC
// ════════════════════════════════════════════════════════════════════════════
function UcPanel({ result, t }: { result: CycleResult; t: (en: string, es: string) => string }) {
  const uc = result.models.uc;

  const decompData = useMemo(() => {
    if (!uc?.available) return [];
    const trend = uc.trend || [];
    const cycle = uc.cycle || [];
    return result.dates.map((d, i) => ({
      date: d,
      series: result.series[i] ?? null,
      trend: trend[i] ?? null,
      cycle: cycle[i] ?? null,
    }));
  }, [uc, result.dates, result.series]);

  if (!uc?.available) {
    return <DegradedNotice msg={uc?.error} t={t} />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('Cycle period', 'Período del ciclo')}
              value={uc.cycle_period_years ? `${uc.cycle_period_years.toFixed(1)} ${t('yr', 'años')}` : 'N/A'}
              valueClass="text-indigo-300" />
        <Stat label="φ₁" value={uc.phi1 != null ? uc.phi1.toFixed(3) : 'N/A'} valueClass="text-gray-200" />
        <Stat label="φ₂" value={uc.phi2 != null ? uc.phi2.toFixed(3) : 'N/A'} valueClass="text-gray-200" />
        <Stat label="AIC" value={uc.aic != null ? uc.aic.toFixed(1) : 'N/A'} valueClass="text-gray-200" />
      </div>

      <ChartCard title={t('Series vs. trend (μ̂)', 'Serie vs. tendencia (μ̂)')}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={decompData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (v == null ? '—' : Number(v).toFixed(3))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="series" name={t('log price', 'log precio')}
                  stroke="#9ca3af" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="trend" name="μ̂" stroke="#fbbf24" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={t('Cyclical component (ĉ) — AR(2)', 'Componente cíclico (ĉ) — AR(2)')}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={decompData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => (v == null ? '—' : Number(v).toFixed(4))} />
            <ReferenceLine y={0} stroke="#52525b" />
            <Line type="monotone" dataKey="cycle" name="ĉ" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Panel Modelo 5 — MS-GARCH (volatilidad por régimen)
// ════════════════════════════════════════════════════════════════════════════
function GarchPanel({ result, t }: { result: CycleResult; t: (en: string, es: string) => string }) {
  const g = result.models.ms_garch;

  const chartData = useMemo(() => {
    if (!g?.available || !g.dates) return [];
    const vol = g.cond_vol_annual || [];
    const pr = g.regime_prob_highvol_smoothed || [];
    return g.dates.map((d, i) => ({ date: d, vol: vol[i] ?? null, prob: pr[i] ?? null }));
  }, [g]);

  if (!g?.available) return <DegradedNotice msg={g?.error} t={t} />;

  const isHigh = g.current_regime === 'High-vol';
  const v95 = g.var?.var_95_1d, v99 = g.var?.var_99_1d, cv = g.var?.cvar_95_1d;

  return (
    <div className="space-y-5">
      {g.narrative && (
        <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/20 p-3 text-sm text-indigo-100">
          {g.narrative}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t('Volatility regime', 'Régimen de volatilidad')}
              value={isHigh ? t('High', 'Alta') : t('Low', 'Baja')}
              valueClass={isHigh ? 'text-red-400' : 'text-emerald-400'}
              sub={`${((g.current_regime_prob ?? 0) * 100).toFixed(0)}% ${t('prob', 'prob')}`} />
        <Stat label={t('Conditional vol (annual)', 'Vol condicional (anual)')}
              value={`${((g.current_vol_annual ?? 0) * 100).toFixed(0)}%`}
              valueClass="text-indigo-300" />
        <Stat label={t('1-day VaR 95% / 99%', 'VaR 1-día 95% / 99%')}
              value={v95 != null && v99 != null ? `${(v95 * 100).toFixed(1)}% / ${(v99 * 100).toFixed(1)}%` : 'N/A'}
              valueClass="text-amber-300"
              sub={cv != null ? `CVaR ${(cv * 100).toFixed(1)}%` : ''} />
        <Stat label={t('Fat tails (Student-t ν)', 'Colas pesadas (Student-t ν)')}
              value={g.nu != null ? g.nu.toFixed(1) : 'N/A'}
              valueClass="text-gray-200" />
      </div>

      {/* Volatilidad condicional + probabilidad de alta-vol */}
      <ChartCard title={t('Conditional volatility (annualized) & high-vol regime probability',
                          'Volatilidad condicional (anualizada) y probabilidad de régimen de alta-vol')}>
        <ResponsiveContainer width="100%" height={270}>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} minTickGap={48} />
            <YAxis yAxisId="vol" tick={{ fontSize: 10, fill: '#6b7280' }}
                   tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
            <YAxis yAxisId="prob" orientation="right" domain={[0, 1]} tick={{ fontSize: 10, fill: '#6b7280' }} />
            <Tooltip contentStyle={tooltipStyle}
                     formatter={(val: any, name: any) => (val == null ? '—'
                       : name === 'vol' ? `${(Number(val) * 100).toFixed(1)}%` : Number(val).toFixed(2))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="vol" type="monotone" dataKey="vol" name={t('Cond. vol', 'Vol cond.')}
                  stroke="#fbbf24" strokeWidth={1.5} dot={false} />
            <Line yAxisId="prob" type="monotone" dataKey="prob" name={t('P[High-vol]', 'P[Alta-vol]')}
                  stroke="#f87171" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Term structure del pronóstico de vol */}
        <ChartCard title={t('Volatility forecast (term structure)', 'Pronóstico de volatilidad (term structure)')}>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={(g.forecast || []).map((f) => ({ h: f.horizon_days, vol: f.vol_annual }))}
                       margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="h" type="number" tick={{ fontSize: 10, fill: '#6b7280' }}
                     tickFormatter={(v: number) => `${v}d`} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={tooltipStyle}
                       labelFormatter={(v: any) => `${v} ${t('days', 'días')}`}
                       formatter={(val: any) => `${(Number(val) * 100).toFixed(1)}%`} />
              <Line type="monotone" dataKey="vol" name={t('Forecast vol', 'Vol pronóstico')}
                    stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Parámetros por régimen + transición */}
        <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
          <h4 className="text-sm font-semibold text-indigo-300 mb-3">
            {t('Per-regime GARCH parameters', 'Parámetros GARCH por régimen')}
          </h4>
          <table className="text-xs w-full">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left py-1">{t('Regime', 'Régimen')}</th>
                <th className="text-right py-1">α</th>
                <th className="text-right py-1">β</th>
                <th className="text-right py-1">{t('Persist.', 'Persist.')}</th>
                <th className="text-right py-1">{t('Uncond. vol', 'Vol incond.')}</th>
              </tr>
            </thead>
            <tbody>
              {(g.regimes || []).map((rg) => (
                <tr key={rg.label} className="border-t border-gray-800">
                  <td className={`py-1 ${rg.label === 'High-vol' ? 'text-red-400' : 'text-emerald-400'}`}>
                    {rg.label === 'High-vol' ? t('High-vol', 'Alta-vol') : t('Low-vol', 'Baja-vol')}
                  </td>
                  <td className="py-1 text-right text-gray-400">{rg.alpha.toFixed(3)}</td>
                  <td className="py-1 text-right text-gray-400">{rg.beta.toFixed(3)}</td>
                  <td className="py-1 text-right text-gray-400">{rg.persistence.toFixed(3)}</td>
                  <td className="py-1 text-right text-gray-200">{(rg.uncond_vol_annual * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.transition_matrix && (
            <p className="text-[11px] text-gray-500 mt-3">
              {t('Persistence', 'Persistencia')}: P[stay low]={g.transition_matrix[0][0].toFixed(2)} · P[stay high]={g.transition_matrix[1][1].toFixed(2)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponentes UI ────────────────────────────────────────────────────────
function Stat({ label, value, valueClass, sub }: {
  label: string; value: string; valueClass?: string; sub?: string;
}) {
  return (
    <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueClass || 'text-gray-200'}`}>{value}</div>
      {sub ? <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-indigo-900/30 bg-black/30 p-4">
      <h4 className="text-sm font-semibold text-indigo-300 mb-2">{title}</h4>
      {children}
    </div>
  );
}

function DegradedNotice({ msg, t }: { msg?: string; t: (en: string, es: string) => string }) {
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 text-sm text-amber-200">
      {t('This model is not available for this run.', 'Este modelo no está disponible en esta corrida.')}
      {msg ? <span className="block text-amber-400/70 mt-1 text-xs">{msg}</span> : null}
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: '#0a0a0a',
  border: '1px solid #312e81',
  borderRadius: 8,
  fontSize: 12,
} as const;

// helper para saber el idioma dentro de los paneles (t encapsula el locale)
function es(t: (en: string, es: string) => string): boolean {
  return t('x', 'y') === 'y';
}
