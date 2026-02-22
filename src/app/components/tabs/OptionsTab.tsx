// src/app/components/tabs/OptionsTab.tsx
'use client';

import { useState, useCallback, useMemo } from 'react';
import { Tab } from '@headlessui/react';
import { useLanguage } from '@/i18n/LanguageContext';

interface OptionsTabProps {
  ticker: string;
  currentPrice: number;
}

interface OptionLeg {
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  premium: number;
  quantity: number;
  iv: number;
}

interface ScanCombo {
  description: string;
  legs: OptionLeg[];
  maxProfit: number | string;
  maxLoss: number | string;
  probabilityOfProfit: number;
  riskReward: number;
  costBasis: number;
  score: number;
  optimal?: boolean;
}

interface StrategyAnalysis {
  name: string;
  legs: OptionLeg[];
  payoffDiagram: { price: number; pnl: number }[];
  maxProfit: number | string | null;
  maxLoss: number | string | null;
  breakevens: number[];
  probabilityOfProfit: number;
  costBasis: number;
  greeks: { delta: number; gamma: number; theta: number; vega: number };
}

interface ChainData {
  expirations: string[];
  allExpirations?: string[];
  calls: Record<string, any[]>;
  puts: Record<string, any[]>;
}

interface Suggestion {
  name: string;
  description: string;
  outlook: string;
  maxRisk: string;
  maxReward: string;
  rationale?: string;
  riskProfile?: string;
  idealIV?: string;
  template?: string;
  nearestExpiration?: string;
}

const STRATEGIES = [
  { value: 'covered_call',    label: 'Covered Call' },
  { value: 'protective_put',  label: 'Protective Put' },
  { value: 'bull_call_spread',label: 'Bull Call Spread' },
  { value: 'bear_put_spread', label: 'Bear Put Spread' },
  { value: 'iron_condor',     label: 'Iron Condor' },
  { value: 'straddle',        label: 'Straddle' },
  { value: 'strangle',        label: 'Strangle' },
  { value: 'butterfly',       label: 'Butterfly' },
  { value: 'collar',          label: 'Collar' },
];

const OUTLOOKS = [
  { value: 'bullish',  label: 'Bullish',  labelEs: 'Alcista', color: 'text-green-400' },
  { value: 'bearish',  label: 'Bearish',  labelEs: 'Bajista', color: 'text-red-400' },
  { value: 'neutral',  label: 'Neutral',  labelEs: 'Neutral',  color: 'text-yellow-400' },
  { value: 'volatile', label: 'Volatile', labelEs: 'Volátil',  color: 'text-purple-400' },
];

// ── SVG Payoff Diagram ────────────────────────────────────────────────────────
function PayoffSVG({ diagram, contracts }: { diagram: { price: number; pnl: number }[]; contracts: number }) {
  const W = 500, H = 180, PAD = { l: 55, r: 10, t: 10, b: 30 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const scaledDiagram = useMemo(
    () => diagram.map(p => ({ price: p.price, pnl: p.pnl * contracts * 100 })),
    [diagram, contracts]
  );

  const prices = scaledDiagram.map(p => p.price);
  const pnls   = scaledDiagram.map(p => p.pnl);
  const minP = prices[0], maxP = prices[prices.length - 1];
  const rawMin = Math.min(...pnls), rawMax = Math.max(...pnls);
  // Asymmetric Y-axis: show actual P&L range, not symmetric ±absMax
  const range = Math.max(rawMax - rawMin, 1);
  const yPad = range * 0.08;
  const yMax = rawMax + yPad;
  const yMin = rawMin - yPad;

  const sx = (p: number) => PAD.l + ((p - minP) / (maxP - minP)) * iW;
  const sy = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * iH;

  const zeroY = sy(0);

  const above: string[] = [], below: string[] = [];
  scaledDiagram.forEach(({ price, pnl }) => {
    const px = sx(price).toFixed(1), py = sy(pnl).toFixed(1);
    above.push(`${px},${py}`);
    below.push(`${px},${py}`);
  });
  const linePath = scaledDiagram
    .map(({ price, pnl }, i) => `${i === 0 ? 'M' : 'L'}${sx(price).toFixed(1)},${sy(pnl).toFixed(1)}`)
    .join(' ');

  const tickStep = (yMax - yMin) / 4;
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + i * tickStep);
  const fmt = (v: number) => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : v > 0 ? '+' : '';
    return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(1)}k` : `${sign}$${abs.toFixed(0)}`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      <rect x={PAD.l} y={PAD.t} width={iW} height={iH} fill="rgba(255,255,255,0.02)" rx={4} />

      {ticks.map((v, i) => {
        const y = sy(v);
        if (y < PAD.t || y > PAD.t + iH) return null;
        return (
          <g key={i}>
            <line x1={PAD.l} y1={y} x2={PAD.l + iW} y2={y}
              stroke={v === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.07)'}
              strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={PAD.l - 4} y={y + 4} textAnchor="end" fontSize={9}
              fill={v > 0 ? '#4ade80' : v < 0 ? '#f87171' : '#9ca3af'}>
              {fmt(v)}
            </text>
          </g>
        );
      })}

      <clipPath id="above-clip">
        <rect x={PAD.l} y={PAD.t} width={iW} height={Math.max(0, zeroY - PAD.t)} />
      </clipPath>
      <polyline points={above.join(' ')} fill="none" stroke="#4ade80" strokeWidth={2}
        clipPath="url(#above-clip)" />
      <polygon
        points={`${PAD.l},${zeroY} ${above.join(' ')} ${PAD.l + iW},${zeroY}`}
        fill="rgba(74,222,128,0.12)" clipPath="url(#above-clip)" />

      <clipPath id="below-clip">
        <rect x={PAD.l} y={zeroY} width={iW} height={Math.max(0, PAD.t + iH - zeroY)} />
      </clipPath>
      <polyline points={below.join(' ')} fill="none" stroke="#f87171" strokeWidth={2}
        clipPath="url(#below-clip)" />
      <polygon
        points={`${PAD.l},${zeroY} ${below.join(' ')} ${PAD.l + iW},${zeroY}`}
        fill="rgba(248,113,113,0.12)" clipPath="url(#below-clip)" />

      <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
      <text x={PAD.l - 4} y={zeroY + 4} textAnchor="end" fontSize={9} fill="#9ca3af">$0</text>

      {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
        const price = minP + t * (maxP - minP);
        const x = PAD.l + t * iW;
        return (
          <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize={9} fill="#6b7280">
            ${price.toFixed(0)}
          </text>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function OptionsTab({ ticker, currentPrice }: OptionsTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  // Chain state
  const [chain, setChain]               = useState<ChainData | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [selectedExp, setSelectedExp]   = useState('');

  // Strategy state
  const [strategy, setStrategy]   = useState('covered_call');
  const [outlook, setOutlook]     = useState('bullish');
  const [contracts, setContracts] = useState(1);

  // Scan state
  const [scanResults, setScanResults]         = useState<ScanCombo[] | null>(null);
  const [scanTotal, setScanTotal]             = useState(0);
  const [scanLoading, setScanLoading]         = useState(false);
  const [selectedComboIdx, setSelectedComboIdx] = useState(0);

  // Analysis state
  const [analysis, setAnalysis]               = useState<StrategyAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Suggestions
  const [suggestions, setSuggestions]       = useState<Suggestion[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // ── Fetch chain ────────────────────────────────────────────────
  const fetchChain = useCallback(async () => {
    setChainLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/chain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Backend HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChain(data);
      if (data.expirations?.length > 0) setSelectedExp(data.expirations[0]);
    } catch (err: any) {
      const msg = err.message || 'Unknown error';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError(es
          ? `No se pudo conectar al backend (${backendUrl}).`
          : `Cannot connect to backend (${backendUrl}).`);
      } else {
        setError(msg);
      }
    } finally {
      setChainLoading(false);
    }
  }, [ticker, backendUrl, es]);

  // ── Scan all strike combinations ───────────────────────────────
  const scanCombinations = useCallback(async () => {
    if (!selectedExp) {
      setError(es ? 'Selecciona un vencimiento primero.' : 'Select an expiration first.');
      return;
    }
    setScanLoading(true);
    setScanResults(null);
    setAnalysis(null);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          strategyName: strategy,
          expiration: selectedExp,
          currentPrice,
          topN: 12,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const combos: ScanCombo[] = data.combinations ?? [];
      setScanResults(combos);
      setScanTotal(data.total ?? combos.length);
      const optIdx = combos.findIndex((c) => c.optimal);
      setSelectedComboIdx(optIdx >= 0 ? optIdx : 0);
    } catch (err: any) {
      const msg = err.message || 'Unknown error';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError(es ? 'No se pudo conectar al backend.' : 'Cannot connect to backend.');
      } else {
        setError(msg);
      }
    } finally {
      setScanLoading(false);
    }
  }, [ticker, strategy, selectedExp, currentPrice, backendUrl, es]);

  // ── Analyze selected combo (with legs from scan) ───────────────
  const analyzeSelected = useCallback(async () => {
    if (!scanResults || scanResults.length === 0) return;
    const combo = scanResults[selectedComboIdx];
    setAnalysisLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, legs: combo.legs, currentPrice }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [ticker, scanResults, selectedComboIdx, currentPrice, backendUrl]);

  // ── Get suggestions ────────────────────────────────────────────
  const getSuggestions = useCallback(async () => {
    setSuggestLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, outlook, lang: locale }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const list = Array.isArray(data) ? data : (data.strategies ?? data.suggestions ?? []);
      setSuggestions(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSuggestLoading(false);
    }
  }, [ticker, outlook, locale, backendUrl]);

  // ── Helpers ────────────────────────────────────────────────────
  const fmtDollar = (v: number | string | null) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v;
    const scaled = v * contracts * 100;
    return scaled >= 0 ? `+$${scaled.toFixed(2)}` : `-$${Math.abs(scaled).toFixed(2)}`;
  };

  // Format scan table values: backend returns per-share amounts → multiply by 100 for 1 contract
  const fmtScan = (v: number | string | null | undefined) => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return v; // "unlimited"
    const scaled = v * 100; // per contract (100 shares)
    return scaled >= 0 ? `+$${scaled.toFixed(0)}` : `-$${Math.abs(scaled).toFixed(0)}`;
  };

  const scoreColor = (s: number) =>
    s >= 0.65 ? 'text-green-400' : s >= 0.45 ? 'text-yellow-400' : 'text-red-400';

  const subtabs = [
    es ? 'Cadena de Opciones' : 'Options Chain',
    es ? 'Simulador de Estrategias' : 'Strategy Simulator',
    es ? 'Sugerencias' : 'Suggestions',
  ];

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-amber-400">
          {es ? 'Análisis de Opciones' : 'Options Analysis'} — {ticker}
        </h3>
        <span className="text-sm text-gray-400">{es ? 'Precio actual' : 'Current'}: ${currentPrice.toFixed(2)}</span>
      </div>

      {error && (
        <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300 text-sm">{error}</div>
      )}

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected ? 'bg-amber-600 text-white shadow-lg' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">

          {/* ══ Options Chain ══════════════════════════════════════════════ */}
          <Tab.Panel>
            <div className="space-y-4">
              <button
                onClick={fetchChain}
                disabled={chainLoading}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {chainLoading
                  ? (es ? 'Cargando... (5-10 seg)' : 'Loading... (5-10 sec)')
                  : (es ? 'Cargar Cadena de Opciones' : 'Load Options Chain')}
              </button>

              {chain && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {chain.expirations.map((exp) => (
                      <button
                        key={exp}
                        onClick={() => setSelectedExp(exp)}
                        className={`px-3 py-1 rounded-lg text-sm transition-all ${
                          selectedExp === exp
                            ? 'bg-amber-600 text-white'
                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                      >
                        {exp}
                      </button>
                    ))}
                  </div>

                  {selectedExp && chain?.calls?.[selectedExp] && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Calls */}
                      <div className="bg-gray-700/30 rounded-xl p-3">
                        <h4 className="text-sm font-semibold text-green-400 mb-2">CALLS</h4>
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-gray-800">
                              <tr className="text-gray-500">
                                <th className="py-1 text-left">Strike</th>
                                <th className="py-1 text-right">Last</th>
                                <th className="py-1 text-right">Bid</th>
                                <th className="py-1 text-right">Ask</th>
                                <th className="py-1 text-right">IV</th>
                                <th className="py-1 text-right">Vol</th>
                                <th className="py-1 text-right">OI</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(chain.calls[selectedExp] ?? []).map((c: any, i: number) => {
                                const itm = c.strike <= currentPrice;
                                return (
                                  <tr key={i} className={`border-t border-gray-700/30 ${itm ? 'bg-green-900/10' : ''}`}>
                                    <td className={`py-1 font-semibold ${itm ? 'text-green-400' : 'text-gray-300'}`}>{c.strike}</td>
                                    <td className="py-1 text-right text-gray-300">{c.lastPrice?.toFixed(2)}</td>
                                    <td className="py-1 text-right text-gray-400">{c.bid?.toFixed(2)}</td>
                                    <td className="py-1 text-right text-gray-400">{c.ask?.toFixed(2)}</td>
                                    <td className="py-1 text-right text-yellow-400">{c.iv ? (c.iv * 100).toFixed(1) + '%' : '-'}</td>
                                    <td className="py-1 text-right text-gray-500">{c.volume || '-'}</td>
                                    <td className="py-1 text-right text-gray-500">{c.openInterest || '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Puts */}
                      <div className="bg-gray-700/30 rounded-xl p-3">
                        <h4 className="text-sm font-semibold text-red-400 mb-2">PUTS</h4>
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-gray-800">
                              <tr className="text-gray-500">
                                <th className="py-1 text-left">Strike</th>
                                <th className="py-1 text-right">Last</th>
                                <th className="py-1 text-right">Bid</th>
                                <th className="py-1 text-right">Ask</th>
                                <th className="py-1 text-right">IV</th>
                                <th className="py-1 text-right">Vol</th>
                                <th className="py-1 text-right">OI</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(chain?.puts?.[selectedExp] ?? []).map((p: any, i: number) => {
                                const itm = p.strike >= currentPrice;
                                return (
                                  <tr key={i} className={`border-t border-gray-700/30 ${itm ? 'bg-red-900/10' : ''}`}>
                                    <td className={`py-1 font-semibold ${itm ? 'text-red-400' : 'text-gray-300'}`}>{p.strike}</td>
                                    <td className="py-1 text-right text-gray-300">{p.lastPrice?.toFixed(2)}</td>
                                    <td className="py-1 text-right text-gray-400">{p.bid?.toFixed(2)}</td>
                                    <td className="py-1 text-right text-gray-400">{p.ask?.toFixed(2)}</td>
                                    <td className="py-1 text-right text-yellow-400">{p.iv ? (p.iv * 100).toFixed(1) + '%' : '-'}</td>
                                    <td className="py-1 text-right text-gray-500">{p.volume || '-'}</td>
                                    <td className="py-1 text-right text-gray-500">{p.openInterest || '-'}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Tab.Panel>

          {/* ══ Strategy Simulator ═════════════════════════════════════════ */}
          <Tab.Panel>
            <div className="space-y-4">

              {/* Controls row */}
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">{es ? 'Estrategia' : 'Strategy'}</label>
                  <select
                    value={strategy}
                    onChange={(e) => { setStrategy(e.target.value); setScanResults(null); setAnalysis(null); }}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    {STRATEGIES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">{es ? 'Vencimiento' : 'Expiration'}</label>
                  <select
                    value={selectedExp}
                    onChange={(e) => { setSelectedExp(e.target.value); setScanResults(null); setAnalysis(null); }}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    {(chain?.allExpirations ?? chain?.expirations)?.map((exp) => (
                      <option key={exp} value={exp}>{exp}</option>
                    )) ?? <option value="">{es ? 'Carga la cadena primero' : 'Load chain first'}</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {es ? 'Contratos' : 'Contracts'}
                    <span className="ml-1 text-gray-600 text-xs">(×100 {es ? 'acciones' : 'shares'})</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={contracts}
                    onChange={(e) => setContracts(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm text-center"
                  />
                </div>

                {/* Scan button */}
                <button
                  onClick={scanCombinations}
                  disabled={scanLoading || !selectedExp}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {scanLoading
                    ? <><span className="inline-block animate-spin">↻</span> {es ? 'Escaneando...' : 'Scanning...'}</>
                    : <>{es ? '🔍 Escanear Combinaciones' : '🔍 Scan Combinations'}</>
                  }
                </button>
              </div>

              {!chain && (
                <p className="text-xs text-gray-500 italic">
                  {es
                    ? 'Tip: Carga la cadena de opciones (pestaña izquierda) para ver todas las expirations.'
                    : 'Tip: Load the options chain (left tab) to see all available expirations.'}
                </p>
              )}

              {/* ── Scan results table ───────────────────────────────────── */}
              {scanResults !== null && (
                <div className="bg-gray-700/30 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-sm font-semibold text-amber-400">
                      {es
                        ? `Top ${scanResults.length} combinaciones`
                        : `Top ${scanResults.length} Combinations`}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {es ? `de ${scanTotal} evaluadas` : `of ${scanTotal} evaluated`}
                      </span>
                    </h4>
                    <span className="text-xs text-gray-500 italic">
                      {es ? '★ = Óptima  ·  Haz clic en una fila para seleccionar' : '★ = Optimal  ·  Click a row to select'}
                    </span>
                  </div>

                  {scanResults.length === 0 ? (
                    <p className="text-sm text-gray-400 py-2">
                      {es
                        ? 'No se encontraron combinaciones válidas para esta estrategia y vencimiento.'
                        : 'No valid combinations found for this strategy and expiration.'}
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-600 bg-gray-800/50">
                            <th className="py-2 px-2 text-left w-6">#</th>
                            <th className="py-2 px-2 text-left">{es ? 'Descripción' : 'Description'}</th>
                            <th className="py-2 px-2 text-right whitespace-nowrap">{es ? 'Max Gan.' : 'Max Profit'}</th>
                            <th className="py-2 px-2 text-right whitespace-nowrap">{es ? 'Max Pérd.' : 'Max Loss'}</th>
                            <th className="py-2 px-2 text-right whitespace-nowrap">{es ? 'P(Gan.)' : 'P(Profit)'}</th>
                            <th className="py-2 px-2 text-right">R/R</th>
                            <th className="py-2 px-2 text-right">{es ? 'Costo' : 'Cost'}</th>
                            <th className="py-2 px-2 text-right">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanResults.map((combo, i) => {
                            const isSelected = i === selectedComboIdx;
                            const isOptimal  = combo.optimal;
                            const pop = combo.probabilityOfProfit != null
                              ? combo.probabilityOfProfit * (combo.probabilityOfProfit <= 1 ? 100 : 1)
                              : null;
                            const scoreDisp = combo.score != null ? (combo.score * 10).toFixed(1) : '—';
                            return (
                              <tr
                                key={i}
                                onClick={() => setSelectedComboIdx(i)}
                                className={`border-t border-gray-700/30 cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-amber-900/25 ring-1 ring-inset ring-amber-500/50'
                                    : 'hover:bg-gray-700/40'
                                }`}
                              >
                                <td className="py-2 px-2 text-gray-500 font-mono">{i + 1}</td>
                                <td className="py-2 px-2">
                                  {isOptimal && <span className="text-amber-400 mr-1 font-bold">★</span>}
                                  <span className={isSelected ? 'text-white font-medium' : 'text-gray-200'}>
                                    {combo.description}
                                  </span>
                                </td>
                                <td className="py-2 px-2 text-right text-green-400 font-mono">
                                  {fmtScan(combo.maxProfit)}
                                </td>
                                <td className="py-2 px-2 text-right text-red-400 font-mono">
                                  {typeof combo.maxLoss === 'number'
                                    ? fmtScan(-Math.abs(combo.maxLoss))
                                    : combo.maxLoss ?? '—'}
                                </td>
                                <td className="py-2 px-2 text-right text-cyan-400">
                                  {pop != null ? `${pop.toFixed(1)}%` : '—'}
                                </td>
                                <td className="py-2 px-2 text-right text-yellow-400">
                                  {combo.riskReward != null ? `${combo.riskReward.toFixed(2)}x` : '—'}
                                </td>
                                <td className="py-2 px-2 text-right text-gray-300 font-mono">
                                  {combo.costBasis != null ? `$${Math.abs(combo.costBasis).toFixed(2)}` : '—'}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  <span className={`font-bold ${scoreColor(combo.score)}`}>
                                    {scoreDisp}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Selected summary + Analyze button */}
                  {scanResults.length > 0 && (
                    <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
                      <div className="text-xs text-gray-400">
                        {es ? 'Seleccionada' : 'Selected'}:{' '}
                        <span className="text-amber-300 font-medium">
                          {scanResults[selectedComboIdx]?.description ?? '—'}
                        </span>
                      </div>
                      <button
                        onClick={analyzeSelected}
                        disabled={analysisLoading}
                        className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
                      >
                        {analysisLoading
                          ? (es ? 'Analizando...' : 'Analyzing...')
                          : (es ? '📊 Analizar Seleccionada' : '📊 Analyze Selected')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Full analysis result ─────────────────────────────────── */}
              {analysis && (
                <>
                  <div className="bg-gray-700/30 rounded-xl p-5 space-y-4">
                    <h4 className="text-lg font-bold text-amber-400">
                      {analysis.name || strategy.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      {contracts > 1 && (
                        <span className="ml-2 text-sm font-normal text-gray-400">× {contracts} {es ? 'contratos' : 'contracts'}</span>
                      )}
                    </h4>

                    {/* Stock strategy note */}
                    {analysis.legs?.some((l: any) => l.type === 'stock') && (
                      <div className="text-xs text-blue-400/80 bg-blue-900/20 rounded px-3 py-1.5">
                        ℹ️ {es
                          ? `Los montos incluyen P&L de las ${contracts * 100} acciones subyacentes + prima de opciones.`
                          : `Amounts include P&L of ${contracts * 100} underlying shares + options premium.`}
                      </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-gray-500 uppercase">{es ? 'Ganancia Máx.' : 'Max Profit'}</div>
                        <div className="text-lg font-semibold text-green-400">{fmtDollar(analysis.maxProfit)}</div>
                        {contracts > 1 && typeof analysis.maxProfit === 'number' && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {analysis.maxProfit >= 0 ? '+' : ''}${(Math.abs(analysis.maxProfit) * 100).toFixed(0)}/{es ? 'contrato' : 'contract'}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase">{es ? 'Pérdida Máx.' : 'Max Loss'}</div>
                        <div className="text-lg font-semibold text-red-400">{fmtDollar(analysis.maxLoss)}</div>
                        {contracts > 1 && typeof analysis.maxLoss === 'number' && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {analysis.maxLoss >= 0 ? '+' : '-'}${(Math.abs(analysis.maxLoss) * 100).toFixed(0)}/{es ? 'contrato' : 'contract'}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase">Breakeven{analysis.breakevens.length > 1 ? 's' : ''}</div>
                        <div className="text-base font-semibold text-yellow-400">
                          {analysis.breakevens.map((b) => `$${b.toFixed(2)}`).join(' / ') || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase">{es ? 'Prob. Ganancia' : 'P(Profit)'}</div>
                        <div className="text-lg font-semibold text-cyan-400">
                          {(analysis.probabilityOfProfit * (analysis.probabilityOfProfit <= 1 ? 100 : 1)).toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* SVG Payoff Diagram */}
                    {analysis.payoffDiagram?.length > 0 && (
                      <div className="bg-gray-800/60 rounded-lg p-3">
                        <div className="text-xs text-gray-500 mb-2">
                          {es ? 'Diagrama de Payoff' : 'Payoff Diagram'}
                          {contracts > 1 && (
                            <span className="ml-1 text-amber-500">({contracts} × 100 {es ? 'acciones' : 'shares'})</span>
                          )}
                        </div>
                        <PayoffSVG diagram={analysis.payoffDiagram} contracts={contracts} />
                        <div className="flex justify-between text-xs text-gray-600 mt-1 px-1">
                          <span>◼ {es ? 'Ganancia' : 'Profit'}</span>
                          <span>{es ? 'Precio al vencimiento →' : 'Price at expiration →'}</span>
                          <span>◼ {es ? 'Pérdida' : 'Loss'}</span>
                        </div>
                      </div>
                    )}

                    {/* Greeks */}
                    <div className="grid grid-cols-4 gap-3">
                      {(['delta', 'gamma', 'theta', 'vega'] as const).map((g) => (
                        <div key={g} className="text-center bg-gray-800/40 rounded-lg p-2">
                          <div className="text-xs text-gray-500 uppercase">{g}</div>
                          <div className="text-sm font-semibold text-gray-200">
                            {((analysis.greeks as any)[g] ?? 0).toFixed(4)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Legs detail */}
                  <div className="bg-gray-700/30 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="text-sm font-semibold text-gray-300">Legs</h5>
                      <span className="text-xs text-gray-500">
                        {es ? 'Ajusta "Contratos" arriba para escalar' : 'Adjust "Contracts" above to scale'}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-500 border-b border-gray-700">
                            <th className="py-1 text-left">{es ? 'Acción' : 'Action'}</th>
                            <th className="py-1 text-right">{es ? 'Tipo' : 'Type'}</th>
                            <th className="py-1 text-right">Strike</th>
                            <th className="py-1 text-right">{es ? 'Vto.' : 'Exp.'}</th>
                            <th className="py-1 text-right">Premium/sh</th>
                            <th className="py-1 text-right">IV</th>
                            <th className="py-1 text-right">{es ? 'Costo total' : 'Total cost'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.legs.map((leg: any, i: number) => {
                            const qty = leg.quantity * contracts;

                            // Stock leg: show the share position, not an option premium
                            if (leg.type === 'stock') {
                              const stockCost = leg.strike * Math.abs(qty) * 100;
                              return (
                                <tr key={i} className="border-t border-gray-700/40 bg-blue-900/10">
                                  <td className="py-2 font-bold text-blue-400">
                                    ▲ LONG {Math.abs(qty) * 100} {es ? 'acciones' : 'shares'}
                                  </td>
                                  <td className="py-2 text-right text-blue-300 font-semibold">STOCK</td>
                                  <td className="py-2 text-right text-white font-semibold">${leg.strike?.toFixed(2)}</td>
                                  <td className="py-2 text-right text-gray-400 text-xs">—</td>
                                  <td className="py-2 text-right text-blue-400">${leg.strike?.toFixed(2)}/sh</td>
                                  <td className="py-2 text-right text-gray-500">—</td>
                                  <td className="py-2 text-right font-semibold text-blue-400">
                                    ~${stockCost.toFixed(0)} {es ? 'inversión' : 'invested'}
                                  </td>
                                </tr>
                              );
                            }

                            const totalCost = leg.premium * leg.quantity * contracts * 100;
                            return (
                              <tr key={i} className="border-t border-gray-700/40">
                                <td className={`py-2 font-bold ${qty > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {qty > 0 ? '▲ BUY' : '▼ SELL'} {Math.abs(qty)}
                                </td>
                                <td className={`py-2 text-right ${leg.type === 'call' ? 'text-green-300' : 'text-red-300'}`}>
                                  {leg.type?.toUpperCase()}
                                </td>
                                <td className="py-2 text-right text-white font-semibold">${leg.strike}</td>
                                <td className="py-2 text-right text-gray-400 text-xs">{leg.expiration}</td>
                                <td className="py-2 text-right text-yellow-400">${(leg.premium || 0).toFixed(2)}</td>
                                <td className="py-2 text-right text-gray-400">
                                  {leg.iv ? (leg.iv * 100).toFixed(1) + '%' : '—'}
                                </td>
                                <td className={`py-2 text-right font-semibold ${totalCost > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                  {totalCost > 0 ? `-$${totalCost.toFixed(2)}` : `+$${Math.abs(totalCost).toFixed(2)}`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center justify-between text-sm">
                      <span className="text-gray-400">{es ? 'Costo neto total' : 'Net total cost'}:</span>
                      <span className={`font-bold text-base ${analysis.costBasis * contracts * 100 > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {analysis.costBasis * contracts * 100 > 0
                          ? `-$${(analysis.costBasis * contracts * 100).toFixed(2)}`
                          : `+$${Math.abs(analysis.costBasis * contracts * 100).toFixed(2)}`}
                        {contracts > 1 && (
                          <span className="ml-1 text-xs font-normal text-gray-500">
                            (${(analysis.costBasis * 100).toFixed(2)} {es ? 'por contrato' : 'per contract'})
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Tab.Panel>

          {/* ══ Suggestions ═══════════════════════════════════════════════ */}
          <Tab.Panel>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-400">{es ? 'Perspectiva' : 'Outlook'}:</label>
                <div className="flex gap-2 flex-wrap">
                  {OUTLOOKS.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setOutlook(o.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        outlook === o.value
                          ? `bg-gray-700 ${o.color} ring-1 ring-gray-500`
                          : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}
                    >
                      {es ? o.labelEs : o.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={getSuggestions}
                  disabled={suggestLoading}
                  className="ml-auto px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
                >
                  {suggestLoading ? (es ? 'Cargando...' : 'Loading...') : (es ? 'Obtener Sugerencias' : 'Get Suggestions')}
                </button>
              </div>

              {suggestions !== null && suggestions.length === 0 && (
                <div className="p-4 bg-gray-700/30 rounded-xl text-gray-400 text-sm">
                  {es ? 'No se encontraron sugerencias para esta perspectiva.' : 'No suggestions found for this outlook.'}
                </div>
              )}

              {suggestions && suggestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {suggestions.map((s, i) => (
                    <div key={i} className="bg-gray-700/30 rounded-xl p-4 border border-gray-600/50 space-y-2">
                      <div className="flex items-start justify-between">
                        <h4 className="font-semibold text-amber-400">{s.name}</h4>
                        {s.riskProfile && (
                          <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">{s.riskProfile}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-300">{s.description}</p>
                      {s.rationale && (
                        <p className="text-xs text-gray-500 italic">{s.rationale}</p>
                      )}
                      <div className="flex flex-wrap gap-3 pt-1 text-xs">
                        <span className="text-green-400">
                          ▲ {es ? 'Ganancia Máx.' : 'Max Reward'}: {s.maxReward}
                        </span>
                        <span className="text-red-400">
                          ▼ {es ? 'Riesgo Máx.' : 'Max Risk'}: {s.maxRisk}
                        </span>
                        {s.idealIV && (
                          <span className="text-yellow-400">IV ideal: {s.idealIV}</span>
                        )}
                      </div>
                      {s.nearestExpiration && (
                        <div className="text-xs text-gray-500">
                          {es ? 'Próx. vencimiento' : 'Nearest exp.'}: <span className="text-gray-300">{s.nearestExpiration}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Tab.Panel>

        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
