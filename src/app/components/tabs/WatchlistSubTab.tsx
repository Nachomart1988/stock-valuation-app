// src/app/components/tabs/WatchlistSubTab.tsx
'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { fetchFmp } from '@/lib/fmpClient';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-luxon';
import { CandlestickController, CandlestickElement, OhlcElement } from 'chartjs-chart-financial';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin,
  CandlestickController,
  CandlestickElement,
  OhlcElement
);

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type WatchlistStrategy = 'Episodic Pivot' | 'HTF' | 'Overextension' | 'Others';

interface WatchlistItem {
  id: string;
  symbol: string;
  description: string;
  strategy: WatchlistStrategy;
  alertPrice: number | null;
  alertDirection: 'above' | 'below';
  alertTriggered: boolean;
  addedAt: string;
  companyName: string;
  currentPrice?: number | null;
  volume?: number | null;
  change?: number | null;
  changePct?: number | null;
}

interface WatchlistTabProps {
  items: WatchlistItem[];
  setItems: React.Dispatch<React.SetStateAction<WatchlistItem[]>>;
}

const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

const STRATEGIES: WatchlistStrategy[] = ['Episodic Pivot', 'HTF', 'Overextension', 'Others'];

const strategyColors: Record<WatchlistStrategy, string> = {
  'Episodic Pivot': 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  'HTF': 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  'Overextension': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Others': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// ═══════════════════════════════════════════════════════════════
// ALERT SOUND (Web Audio API — no file needed)
// ═══════════════════════════════════════════════════════════════

const playAlertSound = () => {
  try {
    const ctx = new AudioContext();
    // Play two beeps
    [0, 0.35].forEach(offset => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.25);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.25);
    });
  } catch {
    // AudioContext may not be available
  }
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function WatchlistTab({ items, setItems }: WatchlistTabProps) {
  // UI State
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<WatchlistItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<WatchlistItem | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<3 | 6 | 9 | 12>(6);
  const [chartData, setChartData] = useState<any[] | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [alertPopup, setAlertPopup] = useState<WatchlistItem | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  // Form state
  const [formSymbol, setFormSymbol] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStrategy, setFormStrategy] = useState<WatchlistStrategy>('Others');
  const [formAlertPrice, setFormAlertPrice] = useState('');
  const [formAlertDirection, setFormAlertDirection] = useState<'above' | 'below'>('above');
  const [formCompanyName, setFormCompanyName] = useState('');

  const priceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // ── Request notification permission ──────────────────────────
  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  }, []);

  // ── Listen for pending add from screener (supports array of items) ──
  useEffect(() => {
    const processPending = () => {
      const raw = localStorage.getItem('watchlist_pending_add');
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        // Support both single object (legacy) and array format
        const pendingList: any[] = Array.isArray(parsed) ? parsed : (parsed?.symbol ? [parsed] : []);
        if (pendingList.length === 0) {
          localStorage.removeItem('watchlist_pending_add');
          return;
        }
        const added: string[] = [];
        setItems(prev => {
          let updated = [...prev];
          for (const p of pendingList) {
            if (!p.symbol) continue;
            const sym = p.symbol.toUpperCase();
            if (updated.some(i => i.symbol === sym)) continue;
            updated.push({
              id: generateId(),
              symbol: sym,
              companyName: p.companyName || p.symbol,
              description: '',
              strategy: p.strategy || 'Others',
              alertPrice: null,
              alertDirection: 'above',
              alertTriggered: false,
              addedAt: new Date().toISOString(),
            });
            added.push(sym);
          }
          return updated;
        });
        if (added.length > 0) {
          setToast({ type: 'success', message: added.length === 1
            ? `${added[0]} added to watchlist`
            : `${added.length} stocks added to watchlist` });
        }
        localStorage.removeItem('watchlist_pending_add');
      } catch { localStorage.removeItem('watchlist_pending_add'); }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'watchlist_pending_add' && e.newValue) {
        processPending();
      }
    };

    // Re-check pending items when tab/page becomes visible again
    // (StorageEvent only fires cross-tab, so same-tab navigation needs this)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') processPending();
    };
    const handleFocus = () => processPending();

    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    // Poll localStorage every 2s to catch same-tab writes from screener
    const pollInterval = setInterval(processPending, 2000);

    // Also check on mount for pending items
    processPending();

    return () => {
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      clearInterval(pollInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch real-time prices ───────────────────────────────────
  const fetchPrices = useCallback(async () => {
    const currentItems = itemsRef.current;
    if (currentItems.length === 0) return;
    setLoadingPrices(true);
    try {
      const symbols = currentItems.map(i => i.symbol).join(',');
      const quotes = await fetchFmp('stable/quote', { symbol: symbols });
      if (!Array.isArray(quotes)) return;

      const priceMap = new Map<string, { price: number; volume: number; change: number; changePct: number; name: string }>();
      for (const q of quotes) {
        priceMap.set(q.symbol, {
          price: q.price ?? q.previousClose,
          volume: q.volume ?? 0,
          change: q.change ?? 0,
          changePct: q.changesPercentage ?? 0,
          name: q.name || q.symbol,
        });
      }

      setItems(prev => prev.map(item => {
        const q = priceMap.get(item.symbol);
        if (!q) return item;
        return {
          ...item,
          currentPrice: q.price,
          volume: q.volume,
          change: q.change,
          changePct: q.changePct,
          companyName: item.companyName || q.name,
        };
      }));
    } catch (err) {
      console.error('[Watchlist] Price fetch error:', err);
    } finally {
      setLoadingPrices(false);
    }
  }, [setItems]);

  // Initial price fetch + interval
  useEffect(() => {
    if (items.length > 0) fetchPrices();
    priceIntervalRef.current = setInterval(fetchPrices, 15000);
    return () => {
      if (priceIntervalRef.current) clearInterval(priceIntervalRef.current);
    };
  }, [items.length, fetchPrices]);

  // ── Alert checking ───────────────────────────────────────────
  useEffect(() => {
    for (const item of items) {
      if (item.alertTriggered || !item.alertPrice || !item.currentPrice) continue;
      const triggered = item.alertDirection === 'above'
        ? item.currentPrice >= item.alertPrice
        : item.currentPrice <= item.alertPrice;

      if (triggered) {
        // Mark as triggered
        setItems(prev => prev.map(i =>
          i.id === item.id ? { ...i, alertTriggered: true } : i
        ));

        // Play sound
        playAlertSound();

        // Show in-app popup
        setAlertPopup(item);

        // Browser notification
        if (notifPermission === 'granted') {
          try {
            new Notification(`Price Alert: ${item.symbol}`, {
              body: `${item.symbol} reached $${item.currentPrice.toFixed(2)} (alert: ${item.alertDirection} $${item.alertPrice.toFixed(2)})`,
              icon: '/favicon.ico',
            });
          } catch { /* ignore */ }
        }
      }
    }
  }, [items, setItems, notifPermission]);

  // ── Fetch chart data ─────────────────────────────────────────
  const fetchChartData = useCallback(async (symbol: string, months: number) => {
    setLoadingChart(true);
    try {
      const today = new Date();
      const from = new Date(today);
      from.setMonth(from.getMonth() - months);
      const fromStr = from.toISOString().split('T')[0];
      const toStr = today.toISOString().split('T')[0];

      const json = await fetchFmp('stable/historical-price-eod/full', {
        symbol,
        from: fromStr,
        to: toStr,
      });

      if (!Array.isArray(json) || json.length === 0) {
        setChartData(null);
        return;
      }

      const sorted = json
        .map((d: any) => ({
          x: new Date(d.date).getTime(),
          o: d.open,
          h: d.high,
          l: d.low,
          c: d.close,
          volume: d.volume || 0,
        }))
        .sort((a: any, b: any) => a.x - b.x);

      setChartData(sorted);
    } catch (err) {
      console.error('[Watchlist] Chart fetch error:', err);
      setChartData(null);
    } finally {
      setLoadingChart(false);
    }
  }, []);

  // Fetch chart when selectedItem or timeframe changes
  useEffect(() => {
    if (selectedItem) {
      fetchChartData(selectedItem.symbol, chartTimeframe);
    }
  }, [selectedItem, chartTimeframe, fetchChartData]);

  // ── Chart.js config ──────────────────────────────────────────
  const candlestickConfig = useMemo(() => {
    if (!chartData || !selectedItem) return null;

    const annotations: any = {};

    // Alert price line
    if (selectedItem.alertPrice) {
      annotations['alertLine'] = {
        type: 'line' as const,
        yMin: selectedItem.alertPrice,
        yMax: selectedItem.alertPrice,
        borderColor: selectedItem.alertTriggered
          ? 'rgba(34, 197, 94, 0.9)'
          : 'rgba(251, 146, 60, 0.9)',
        borderWidth: 2,
        borderDash: [6, 4],
        label: {
          display: true,
          content: `Alert: $${selectedItem.alertPrice.toFixed(2)}`,
          position: 'start' as const,
          backgroundColor: selectedItem.alertTriggered
            ? 'rgba(34, 197, 94, 0.9)'
            : 'rgba(251, 146, 60, 0.9)',
          color: '#000',
          font: { size: 11, weight: 'bold' as const },
        },
      };
    }

    // Current price line
    if (selectedItem.currentPrice) {
      annotations['currentPrice'] = {
        type: 'line' as const,
        yMin: selectedItem.currentPrice,
        yMax: selectedItem.currentPrice,
        borderColor: 'rgba(251, 191, 36, 0.9)',
        borderWidth: 2,
        label: {
          display: true,
          content: `Now: $${selectedItem.currentPrice.toFixed(2)}`,
          position: 'end' as const,
          backgroundColor: 'rgba(251, 191, 36, 0.9)',
          color: '#000',
          font: { size: 11, weight: 'bold' as const },
        },
      };
    }

    return {
      data: {
        datasets: [
          {
            label: selectedItem.symbol,
            data: chartData,
            color: {
              up: 'rgba(34, 197, 94, 1)',
              down: 'rgba(239, 68, 68, 1)',
              unchanged: 'rgba(156, 163, 175, 1)',
            },
            borderColor: {
              up: 'rgba(34, 197, 94, 1)',
              down: 'rgba(239, 68, 68, 1)',
              unchanged: 'rgba(156, 163, 175, 1)',
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: any) => {
                const d = ctx.raw;
                return [
                  `O: $${d.o?.toFixed(2)}`,
                  `H: $${d.h?.toFixed(2)}`,
                  `L: $${d.l?.toFixed(2)}`,
                  `C: $${d.c?.toFixed(2)}`,
                ];
              },
            },
          },
          annotation: { annotations },
        },
        scales: {
          x: {
            type: 'time' as const,
            time: { unit: 'week' as const, displayFormats: { week: 'MMM dd' } },
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#6b7280', maxTicksLimit: 12 },
          },
          y: {
            position: 'right' as const,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#6b7280',
              callback: (v: any) => `$${Number(v).toFixed(2)}`,
            },
          },
        },
      },
    };
  }, [chartData, selectedItem]);

  // ── Form handlers ────────────────────────────────────────────
  const resetForm = () => {
    setFormSymbol('');
    setFormDescription('');
    setFormStrategy('Others');
    setFormAlertPrice('');
    setFormAlertDirection('above');
    setFormCompanyName('');
    setEditingItem(null);
    setShowAddForm(false);
  };

  const openEditForm = (item: WatchlistItem) => {
    setEditingItem(item);
    setFormSymbol(item.symbol);
    setFormDescription(item.description);
    setFormStrategy(item.strategy);
    setFormAlertPrice(item.alertPrice?.toString() ?? '');
    setFormAlertDirection(item.alertDirection);
    setFormCompanyName(item.companyName);
    setShowAddForm(true);
  };

  const handleSave = () => {
    const symbol = formSymbol.trim().toUpperCase();
    if (!symbol) return;

    if (editingItem) {
      setItems(prev => prev.map(item =>
        item.id === editingItem.id
          ? {
              ...item,
              symbol,
              description: formDescription,
              strategy: formStrategy,
              alertPrice: formAlertPrice ? parseFloat(formAlertPrice) : null,
              alertDirection: formAlertDirection,
              alertTriggered: item.alertPrice !== (formAlertPrice ? parseFloat(formAlertPrice) : null)
                ? false : item.alertTriggered,
              companyName: formCompanyName || symbol,
            }
          : item
      ));
    } else {
      const newItem: WatchlistItem = {
        id: generateId(),
        symbol,
        description: formDescription,
        strategy: formStrategy,
        alertPrice: formAlertPrice ? parseFloat(formAlertPrice) : null,
        alertDirection: formAlertDirection,
        alertTriggered: false,
        addedAt: new Date().toISOString(),
        companyName: formCompanyName || symbol,
      };
      setItems(prev => [...prev, newItem]);
    }

    // Request notification permission on first alert price
    if (formAlertPrice && notifPermission === 'default') {
      requestNotifPermission();
    }

    resetForm();
    setToast({ type: 'success', message: editingItem ? 'Item updated' : 'Added to watchlist' });
  };

  const deleteItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    if (selectedItem?.id === id) {
      setSelectedItem(null);
      setChartData(null);
    }
  };

  const resetAlert = (id: string) => {
    setItems(prev => prev.map(i =>
      i.id === id ? { ...i, alertTriggered: false } : i
    ));
  };

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-semibold shadow-lg animate-fadeIn ${
          toast.type === 'success' ? 'bg-green-600 text-white' :
          toast.type === 'error' ? 'bg-red-600 text-white' :
          'bg-blue-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Alert Popup */}
      {alertPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-amber-500/40 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="text-4xl mb-3">🔔</div>
              <h3 className="text-xl font-bold text-amber-400 mb-2">Price Alert!</h3>
              <p className="text-white text-lg font-semibold">{alertPopup.symbol}</p>
              <p className="text-gray-300 text-sm mt-1">{alertPopup.companyName}</p>
              <div className="mt-4 p-3 bg-black/40 rounded-xl">
                <p className="text-gray-400 text-xs">Current Price</p>
                <p className="text-2xl font-bold text-white">${alertPopup.currentPrice?.toFixed(2)}</p>
                <p className="text-amber-400 text-sm mt-1">
                  Alert: {alertPopup.alertDirection} ${alertPopup.alertPrice?.toFixed(2)}
                </p>
              </div>
              <button
                onClick={() => setAlertPopup(null)}
                className="mt-4 px-6 py-2 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-lg transition"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">Watchlist</h2>
          <span className="text-xs text-gray-500">
            {items.length} item{items.length !== 1 ? 's' : ''}
          </span>
          {loadingPrices && (
            <span className="text-xs text-blue-400 animate-pulse">Updating...</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {notifPermission !== 'granted' && (
            <button
              onClick={requestNotifPermission}
              className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg text-gray-300 transition"
              title="Enable browser notifications for price alerts"
            >
              🔔 Enable Alerts
            </button>
          )}
          <button
            onClick={() => { resetForm(); setShowAddForm(true); }}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Stock
          </button>
        </div>
      </div>

      {/* Add/Edit Form Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">
              {editingItem ? 'Edit Watchlist Item' : 'Add to Watchlist'}
            </h3>

            <div className="space-y-3">
              {/* Symbol */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Symbol *</label>
                <input
                  type="text"
                  value={formSymbol}
                  onChange={e => setFormSymbol(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:border-green-500 focus:outline-none"
                  autoFocus
                />
              </div>

              {/* Company Name */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Company Name</label>
                <input
                  type="text"
                  value={formCompanyName}
                  onChange={e => setFormCompanyName(e.target.value)}
                  placeholder="Apple Inc."
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:border-green-500 focus:outline-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Description / Notes</label>
                <textarea
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Watching for breakout above 200 DMA..."
                  rows={2}
                  className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:border-green-500 focus:outline-none resize-none"
                />
              </div>

              {/* Strategy */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Strategy</label>
                <div className="grid grid-cols-2 gap-2">
                  {STRATEGIES.map(s => (
                    <button
                      key={s}
                      onClick={() => setFormStrategy(s)}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                        formStrategy === s
                          ? strategyColors[s] + ' ring-1 ring-white/20'
                          : 'bg-black/30 text-gray-500 border-white/5 hover:border-white/15'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alert Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Alert Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formAlertPrice}
                    onChange={e => setFormAlertPrice(e.target.value)}
                    placeholder="150.00"
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Direction</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFormAlertDirection('above')}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${
                        formAlertDirection === 'above'
                          ? 'bg-green-500/20 text-green-400 border-green-500/30'
                          : 'bg-black/30 text-gray-500 border-white/5'
                      }`}
                    >
                      ↑ Above
                    </button>
                    <button
                      onClick={() => setFormAlertDirection('below')}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition ${
                        formAlertDirection === 'below'
                          ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : 'bg-black/30 text-gray-500 border-white/5'
                      }`}
                    >
                      ↓ Below
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={resetForm}
                className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-semibold transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formSymbol.trim()}
                className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg text-sm font-bold transition"
              >
                {editingItem ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="text-center py-16 bg-black/30 rounded-xl border border-white/5">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-400 text-sm">Your watchlist is empty</p>
          <p className="text-gray-600 text-xs mt-1">
            Add stocks manually or use the + Watchlist button in the screener
          </p>
        </div>
      )}

      {/* Watchlist Table */}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/60 border-b border-white/[0.06]">
                <th className="px-3 py-2.5 text-left text-xs text-gray-500 font-semibold">Symbol</th>
                <th className="px-3 py-2.5 text-left text-xs text-gray-500 font-semibold">Strategy</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-semibold">Price</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-semibold">Change</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-semibold">Volume</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-500 font-semibold">Alert</th>
                <th className="px-3 py-2.5 text-center text-xs text-gray-500 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-center text-xs text-gray-500 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isUp = (item.change ?? 0) >= 0;
                const isSelected = selectedItem?.id === item.id;
                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedItem(isSelected ? null : item)}
                    className={`border-b border-white/[0.03] cursor-pointer transition ${
                      isSelected
                        ? 'bg-green-900/20 border-green-500/20'
                        : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <div>
                        <span className="font-bold text-white">{item.symbol}</span>
                        <p className="text-[10px] text-gray-500 truncate max-w-[120px]">
                          {item.companyName}
                        </p>
                        {item.description && (
                          <p className="text-[10px] text-gray-600 truncate max-w-[120px]" title={item.description}>
                            {item.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${strategyColors[item.strategy]}`}>
                        {item.strategy}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-data text-white">
                      {item.currentPrice ? `$${item.currentPrice.toFixed(2)}` : '–'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-data ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                      {item.changePct != null
                        ? `${isUp ? '+' : ''}${item.changePct.toFixed(2)}%`
                        : '–'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-data text-gray-400 text-xs">
                      {item.volume
                        ? item.volume >= 1e6
                          ? `${(item.volume / 1e6).toFixed(1)}M`
                          : item.volume.toLocaleString()
                        : '–'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {item.alertPrice ? (
                        <div className="text-xs">
                          <span className={item.alertDirection === 'above' ? 'text-green-400' : 'text-red-400'}>
                            {item.alertDirection === 'above' ? '↑' : '↓'} ${item.alertPrice.toFixed(2)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-600 text-xs">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.alertTriggered ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          TRIGGERED
                        </span>
                      ) : item.alertPrice ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">–</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEditForm(item)}
                          className="p-1 hover:bg-white/10 rounded transition"
                          title="Edit"
                        >
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {item.alertTriggered && (
                          <button
                            onClick={() => resetAlert(item.id)}
                            className="p-1 hover:bg-white/10 rounded transition"
                            title="Reset alert"
                          >
                            <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="p-1 hover:bg-red-500/20 rounded transition"
                          title="Remove"
                        >
                          <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Chart Section */}
      {selectedItem && (
        <div className="bg-black/40 rounded-xl border border-white/[0.06] p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-bold">
                {selectedItem.symbol}
                <span className="text-gray-500 font-normal text-sm ml-2">{selectedItem.companyName}</span>
              </h3>
            </div>
            <div className="flex gap-1">
              {([3, 6, 9, 12] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setChartTimeframe(m)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                    chartTimeframe === m
                      ? 'bg-green-600 text-white'
                      : 'bg-black/50 text-gray-400 hover:bg-white/10'
                  }`}
                >
                  {m}M
                </button>
              ))}
            </div>
          </div>

          {loadingChart ? (
            <div className="h-[600px] flex items-center justify-center">
              <div className="text-gray-500 text-sm animate-pulse">Loading chart...</div>
            </div>
          ) : candlestickConfig ? (
            <div className="h-[600px]">
              <Chart
                type="candlestick"
                data={candlestickConfig.data as any}
                options={candlestickConfig.options as any}
              />
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-gray-600 text-sm">No chart data available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
