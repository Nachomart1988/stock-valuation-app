// src/app/components/tabs/OptionsTab.tsx
'use client';

import { useState, useCallback } from 'react';
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

interface StrategyAnalysis {
  name: string;
  legs: OptionLeg[];
  payoffDiagram: { price: number; pnl: number }[];
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  probabilityOfProfit: number;
  costBasis: number;
  greeks: { delta: number; gamma: number; theta: number; vega: number };
}

interface ChainData {
  expirations: string[];
  calls: Record<string, any[]>;
  puts: Record<string, any[]>;
}

interface Suggestion {
  name: string;
  description: string;
  outlook: string;
  maxProfit: string;
  maxLoss: string;
  legs: any[];
}

const STRATEGIES = [
  { value: 'covered_call', label: 'Covered Call' },
  { value: 'protective_put', label: 'Protective Put' },
  { value: 'bull_call_spread', label: 'Bull Call Spread' },
  { value: 'bear_put_spread', label: 'Bear Put Spread' },
  { value: 'iron_condor', label: 'Iron Condor' },
  { value: 'straddle', label: 'Straddle' },
  { value: 'strangle', label: 'Strangle' },
  { value: 'butterfly', label: 'Butterfly' },
  { value: 'collar', label: 'Collar' },
];

const OUTLOOKS = [
  { value: 'bullish', label: 'Bullish', labelEs: 'Alcista', color: 'text-green-400' },
  { value: 'bearish', label: 'Bearish', labelEs: 'Bajista', color: 'text-red-400' },
  { value: 'neutral', label: 'Neutral', labelEs: 'Neutral', color: 'text-yellow-400' },
  { value: 'volatile', label: 'Volatile', labelEs: 'Volátil', color: 'text-purple-400' },
];

export default function OptionsTab({ ticker, currentPrice }: OptionsTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const [chain, setChain] = useState<ChainData | null>(null);
  const [chainLoading, setChainLoading] = useState(false);
  const [selectedExp, setSelectedExp] = useState('');
  const [strategy, setStrategy] = useState('covered_call');
  const [outlook, setOutlook] = useState('bullish');
  const [analysis, setAnalysis] = useState<StrategyAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const fetchChain = useCallback(async () => {
    setChainLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/chain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChain(data);
      if (data.expirations?.length > 0) setSelectedExp(data.expirations[0]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChainLoading(false);
    }
  }, [ticker, backendUrl]);

  const analyzeStrategy = useCallback(async () => {
    if (!selectedExp) return;
    setAnalysisLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          strategyName: strategy,
          expiration: selectedExp,
          currentPrice,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAnalysis(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [ticker, strategy, selectedExp, currentPrice, backendUrl]);

  const getSuggestions = useCallback(async () => {
    setSuggestLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/options/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, outlook }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuggestions(Array.isArray(data) ? data : data.suggestions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSuggestLoading(false);
    }
  }, [ticker, outlook, backendUrl]);

  const fmtPrice = (v: number | null) => v !== null ? `$${v.toFixed(2)}` : 'Unlimited';

  const subtabs = [
    es ? 'Cadena de Opciones' : 'Options Chain',
    es ? 'Simulador de Estrategias' : 'Strategy Simulator',
    es ? 'Sugerencias' : 'Suggestions',
  ];

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
                  selected
                    ? 'bg-amber-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          {/* Options Chain */}
          <Tab.Panel>
            <div className="space-y-4">
              <button
                onClick={fetchChain}
                disabled={chainLoading}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {chainLoading ? (es ? 'Cargando...' : 'Loading...') : (es ? 'Cargar Cadena de Opciones' : 'Load Options Chain')}
              </button>

              {chain && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {chain.expirations.slice(0, 8).map((exp) => (
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

                  {selectedExp && chain.calls[selectedExp] && (
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
                              {chain.calls[selectedExp].map((c: any, i: number) => {
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
                              {chain.puts[selectedExp].map((p: any, i: number) => {
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

          {/* Strategy Simulator */}
          <Tab.Panel>
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">{es ? 'Estrategia' : 'Strategy'}</label>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value)}
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
                    onChange={(e) => setSelectedExp(e.target.value)}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  >
                    {chain?.expirations.map((exp) => (
                      <option key={exp} value={exp}>{exp}</option>
                    )) || <option value="">{es ? 'Carga la cadena primero' : 'Load chain first'}</option>}
                  </select>
                </div>
                <button
                  onClick={analyzeStrategy}
                  disabled={analysisLoading || !selectedExp}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm transition-all disabled:opacity-50"
                >
                  {analysisLoading ? (es ? 'Analizando...' : 'Analyzing...') : (es ? 'Analizar' : 'Analyze')}
                </button>
              </div>

              {analysis && (
                <>
                  <div className="bg-gray-700/30 rounded-xl p-5">
                    <h4 className="text-lg font-bold text-amber-400 mb-3">{analysis.name}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div>
                        <div className="text-xs text-gray-500">{es ? 'Ganancia Máx.' : 'Max Profit'}</div>
                        <div className="text-lg font-semibold text-green-400">{fmtPrice(analysis.maxProfit)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">{es ? 'Pérdida Máx.' : 'Max Loss'}</div>
                        <div className="text-lg font-semibold text-red-400">{fmtPrice(analysis.maxLoss)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Breakeven{analysis.breakevens.length > 1 ? 's' : ''}</div>
                        <div className="text-lg font-semibold text-yellow-400">
                          {analysis.breakevens.map(b => `$${b.toFixed(2)}`).join(', ')}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">{es ? 'Prob. Ganancia' : 'P(Profit)'}</div>
                        <div className="text-lg font-semibold text-cyan-400">{analysis.probabilityOfProfit.toFixed(1)}%</div>
                      </div>
                    </div>

                    {/* Payoff Diagram */}
                    <div className="bg-gray-800/60 rounded-lg p-3">
                      <h5 className="text-xs text-gray-500 mb-2">{es ? 'Diagrama de Payoff' : 'Payoff Diagram'}</h5>
                      <div className="h-48 flex items-end gap-px">
                        {analysis.payoffDiagram
                          .filter((_, i) => i % 2 === 0) // Show every other point
                          .map((point, i) => {
                            const maxAbs = Math.max(...analysis.payoffDiagram.map(p => Math.abs(p.pnl)), 1);
                            const height = Math.abs(point.pnl) / maxAbs * 100;
                            const isProfit = point.pnl >= 0;
                            return (
                              <div
                                key={i}
                                className="flex-1 relative group"
                                title={`$${point.price.toFixed(0)}: ${point.pnl >= 0 ? '+' : ''}$${point.pnl.toFixed(2)}`}
                              >
                                {isProfit ? (
                                  <div
                                    className="absolute bottom-1/2 w-full bg-green-500/60 rounded-t-sm"
                                    style={{ height: `${height}%` }}
                                  />
                                ) : (
                                  <div
                                    className="absolute top-1/2 w-full bg-red-500/60 rounded-b-sm"
                                    style={{ height: `${height}%` }}
                                  />
                                )}
                              </div>
                            );
                          })}
                      </div>
                      <div className="h-px bg-gray-600 w-full" />
                    </div>

                    {/* Greeks */}
                    <div className="grid grid-cols-4 gap-3 mt-3">
                      {['delta', 'gamma', 'theta', 'vega'].map((g) => (
                        <div key={g} className="text-center">
                          <div className="text-xs text-gray-500 uppercase">{g}</div>
                          <div className="text-sm font-semibold text-gray-200">
                            {((analysis.greeks as any)[g] || 0).toFixed(4)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Legs detail */}
                  <div className="bg-gray-700/30 rounded-xl p-4">
                    <h5 className="text-sm font-semibold text-gray-300 mb-2">Legs</h5>
                    <div className="space-y-2">
                      {analysis.legs.map((leg, i) => (
                        <div key={i} className="flex items-center gap-4 text-sm">
                          <span className={`font-semibold ${leg.quantity > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {leg.quantity > 0 ? 'BUY' : 'SELL'}
                          </span>
                          <span className="text-gray-300">{Math.abs(leg.quantity)}x</span>
                          <span className={leg.type === 'call' ? 'text-green-400' : 'text-red-400'}>
                            {leg.type.toUpperCase()}
                          </span>
                          <span className="text-gray-300">${leg.strike}</span>
                          <span className="text-gray-500">{leg.expiration}</span>
                          <span className="text-yellow-400">${leg.premium.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-sm text-gray-400">
                      {es ? 'Costo neto' : 'Net cost'}: <span className="text-white font-semibold">${analysis.costBasis.toFixed(2)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Tab.Panel>

          {/* Suggestions */}
          <Tab.Panel>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400">{es ? 'Perspectiva' : 'Outlook'}:</label>
                <div className="flex gap-2">
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
                  {suggestLoading ? '...' : (es ? 'Obtener Sugerencias' : 'Get Suggestions')}
                </button>
              </div>

              {suggestions && suggestions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {suggestions.map((s, i) => (
                    <div key={i} className="bg-gray-700/30 rounded-xl p-4 border border-gray-600/50">
                      <h4 className="font-semibold text-amber-400">{s.name}</h4>
                      <p className="text-sm text-gray-400 mt-1">{s.description}</p>
                      <div className="flex gap-4 mt-3 text-xs">
                        <span className="text-green-400">{es ? 'Gan. Máx.' : 'Max Profit'}: {s.maxProfit}</span>
                        <span className="text-red-400">{es ? 'Pérd. Máx.' : 'Max Loss'}: {s.maxLoss}</span>
                      </div>
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
