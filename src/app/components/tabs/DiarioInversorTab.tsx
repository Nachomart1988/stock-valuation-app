// src/app/components/tabs/DiarioInversorTab.tsx
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Tab } from '@headlessui/react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useUser } from '@clerk/nextjs';

// ═══════════════════════════════════════════════════════════════
// TYPES - Estructura principal según especificaciones
// ═══════════════════════════════════════════════════════════════

// Trade Setup Types
type TradeSetup = 'WB' | 'WBPB' | 'BORS' | 'BORL' | 'BO10PB' | 'BO21PB' | 'BO50PB' | 'Breakout' | 'Power Play' | 'Other';
type TradeSide = 'Long' | 'Short';
type TradeState = 'Open' | 'Closed';
type SellReason = 'Stopped' | 'EOD' | 'Sold into Strength' | 'Target Hit' | 'Time Stop' | 'Other';

// Main Trade Interface - Tabla maestra de SWING
interface Trade {
  id: string;
  // Datos de entrada (usuario)
  name: string;           // Nombre de la empresa
  symbol: string;         // Ticker
  side: TradeSide;
  date: string;           // Fecha entrada
  qty: number;            // Cantidad
  entryPrice: number;     // Precio de entrada por acción
  value: number;          // Valor total (Precio entrada × Qty) - calculado
  commission: number;
  pt1Price: number | null;  // Price Target 1
  pt1Qty: number | null;
  pt2Price: number | null;
  pt2Qty: number | null;
  pt3Price: number | null;
  pt3Qty: number | null;
  s1Price: number | null;   // Stop niveles
  s2Price: number | null;
  sfDate: string | null;    // Fecha esperada salida
  sl: number;               // Stop Loss actual
  initialSL: number;        // Stop Loss original
  initialRisk: number;      // Riesgo inicial en $
  setup: TradeSetup;
  sellReason: SellReason | null;
  postAnalysis: string;
  chartLink: string;
  industry: string;

  // Ventas parciales
  partial1Qty: number | null;
  partial1Pct: number | null;
  partial2Qty: number | null;
  partial2Pct: number | null;
  partial3Qty: number | null;
  partial3Pct: number | null;

  // Datos de salida (calculados o al cerrar)
  exitPrice: number | null;
  exitDate: string | null;
  state: TradeState;

  // Precio en tiempo real (solo para abiertos)
  currentPrice: number | null;
}

// P&L Weekly Interface
interface WeeklyPL {
  id: string;
  weekStart: string;
  weekLabel: string;      // S1, S2, etc.
  usdBalance: number;     // Balance inicio semana
  deposit: number;
  profitWeek: number;     // Calculado de trades cerrados
  profitCumul: number;    // Acumulativo
  pctWeek: number;
  pctDD: number;          // Drawdown %
  pctYear: number;
  objectif: number;       // % objetivo
  pctCumul: number;
}

// PTA Journal Entry Interface
interface PTAEntry {
  id: string;
  date: string;
  preMarketPlan: string;
  ptmmSignal: string;
  score: number;
  plDay: number;
  invested: number;
  marketAction: string;
  // System Checklist
  globalBreadth: boolean;
  norIntraday: boolean;    // NOR < 1% intraday
  norEOD: boolean;         // NOR < 0.5% EOD
  positionSizing: boolean;
  plannedTrades: boolean;
  overTrading: boolean;    // N ideal
  sellRulesRespected: boolean;
  goodSleepMindset: boolean;
  respect: boolean;
  executionMistakes: string;
  reasons: string;
  disciplineEmotions: string;
  whatWentGood: string;
  needToImprove: string;
  linkedTradeIds: string[];
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

const generateId = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);

const formatCurrency = (value: number | null | undefined) => {
  if (value == null || isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
};

const formatPercent = (value: number | null | undefined) => {
  if (value == null || isNaN(value)) return '0.00%';
  return (value * 100).toFixed(2) + '%';
};

const formatNumber = (value: number | null | undefined, decimals = 2) => {
  if (value == null || isNaN(value)) return '0';
  return value.toFixed(decimals);
};

const getWeekNumber = (date: Date): number => {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.ceil((days + startOfYear.getDay() + 1) / 7);
};

const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function DiarioInversorTab() {
  const { t } = useLanguage();
  const { user, isLoaded: authLoaded } = useUser();
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  // Estado central - Tabla maestra de trades
  const [trades, setTrades] = useState<Trade[]>([]);
  const [weeklyPL, setWeeklyPL] = useState<WeeklyPL[]>([]);
  const [ptaEntries, setPtaEntries] = useState<PTAEntry[]>([]);

  // UI States
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref para mantener trades actualizado en fetchRealTimePrices
  const tradesRef = useRef<Trade[]>(trades);
  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  // ── Save to DB (debounced 1.5s) ──────────────────────────────────
  const saveToDB = useCallback(async (
    t: Trade[], wpl: WeeklyPL[], pta: PTAEntry[], bal: number
  ) => {
    if (!user) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(async () => {
      setSyncStatus('saving');
      try {
        const res = await fetch('/api/diary', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trades: t, weekly_pl: wpl, pta, balance: bal }),
        });
        setSyncStatus(res.ok ? 'saved' : 'error');
        setTimeout(() => setSyncStatus('idle'), 3000);
      } catch {
        setSyncStatus('error');
        setTimeout(() => setSyncStatus('idle'), 4000);
      }
    }, 1500);
  }, [user]);

  // ── Load: DB first (if logged in), fallback to localStorage ──────
  useEffect(() => {
    if (!authLoaded) return;

    const loadFromLocalStorage = () => {
      try {
        const savedTrades = localStorage.getItem('diario_trades_v2');
        const savedWeeklyPL = localStorage.getItem('diario_weeklypl_v2');
        const savedPTA = localStorage.getItem('diario_pta_v2');
        const savedBalance = localStorage.getItem('diario_balance');
        if (savedTrades) {
          const p = JSON.parse(savedTrades);
          setTrades(p);
          tradesRef.current = p;
        }
        if (savedWeeklyPL) setWeeklyPL(JSON.parse(savedWeeklyPL));
        if (savedPTA) setPtaEntries(JSON.parse(savedPTA));
        if (savedBalance) setAccountBalance(JSON.parse(savedBalance));
      } catch (e) {
        console.error('[DiarioInversor] localStorage load error:', e);
      }
      setDataLoaded(true);
    };

    if (user) {
      // Load from database
      fetch('/api/diary')
        .then(res => res.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          const dbTrades: Trade[] = data.trades ?? [];
          const dbWPL: WeeklyPL[] = data.weekly_pl ?? [];
          const dbPTA: PTAEntry[] = data.pta ?? [];
          const dbBalance: number = data.balance ?? 10000;

          // If DB is empty, migrate localStorage data to DB
          const localTrades = localStorage.getItem('diario_trades_v2');
          if (dbTrades.length === 0 && localTrades) {
            const migrated = JSON.parse(localTrades);
            const migratedWPL = JSON.parse(localStorage.getItem('diario_weeklypl_v2') || '[]');
            const migratedPTA = JSON.parse(localStorage.getItem('diario_pta_v2') || '[]');
            const migratedBal = JSON.parse(localStorage.getItem('diario_balance') || '10000');
            setTrades(migrated);
            tradesRef.current = migrated;
            setWeeklyPL(migratedWPL);
            setPtaEntries(migratedPTA);
            setAccountBalance(migratedBal);
            // Push migrated data to DB
            saveToDB(migrated, migratedWPL, migratedPTA, migratedBal);
            console.log('[DiarioInversor] Migrated localStorage data to DB');
          } else {
            setTrades(dbTrades);
            tradesRef.current = dbTrades;
            setWeeklyPL(dbWPL);
            setPtaEntries(dbPTA);
            setAccountBalance(dbBalance);
            console.log('[DiarioInversor] Loaded from DB:', dbTrades.length, 'trades');
          }
          setDataLoaded(true);
        })
        .catch(err => {
          console.error('[DiarioInversor] DB load failed, falling back to localStorage:', err);
          loadFromLocalStorage();
        });
    } else {
      loadFromLocalStorage();
    }
  }, [authLoaded, user, saveToDB]);

  // ── Save to localStorage (always) ────────────────────────────────
  useEffect(() => {
    if (!dataLoaded) return;
    localStorage.setItem('diario_trades_v2', JSON.stringify(trades));
  }, [trades, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    localStorage.setItem('diario_weeklypl_v2', JSON.stringify(weeklyPL));
  }, [weeklyPL, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    localStorage.setItem('diario_pta_v2', JSON.stringify(ptaEntries));
  }, [ptaEntries, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    localStorage.setItem('diario_balance', JSON.stringify(accountBalance));
  }, [accountBalance, dataLoaded]);

  // ── Save to DB whenever data changes (debounced) ─────────────────
  useEffect(() => {
    if (!dataLoaded || !user) return;
    saveToDB(trades, weeklyPL, ptaEntries, accountBalance);
  }, [trades, weeklyPL, ptaEntries, accountBalance, dataLoaded, user, saveToDB]);

  // ═══════════════════════════════════════════════════════════════
  // CALCULATED VALUES - Desde tabla maestra
  // ═══════════════════════════════════════════════════════════════

  // Trades filtrados por año
  const yearTrades = useMemo(() => {
    return trades.filter(t => new Date(t.date).getFullYear() === selectedYear);
  }, [trades, selectedYear]);

  // Trades cerrados
  const closedTrades = useMemo(() => yearTrades.filter(t => t.state === 'Closed'), [yearTrades]);

  // Trades abiertos (para Portfolio)
  const openTrades = useMemo(() => yearTrades.filter(t => t.state === 'Open'), [yearTrades]);

  // Cálculos de Trade
  const calculateTradeMetrics = useCallback((trade: Trade) => {
    // Usar entryPrice directo si existe, sino calcular de value/qty
    const entryPrice = trade.entryPrice || (trade.qty > 0 ? trade.value / trade.qty : 0);
    const sharesRemaining = trade.qty - (trade.partial1Qty || 0) - (trade.partial2Qty || 0) - (trade.partial3Qty || 0);
    const currentValue = trade.currentPrice ? sharesRemaining * trade.currentPrice : sharesRemaining * entryPrice;
    const timeDays = trade.exitDate ? Math.ceil((new Date(trade.exitDate).getTime() - new Date(trade.date).getTime()) / (1000 * 60 * 60 * 24)) : null;

    // P&L
    let pnl = 0;
    const positionValue = entryPrice * trade.qty;
    if (trade.state === 'Closed' && trade.exitPrice) {
      if (trade.side === 'Long') {
        pnl = (trade.exitPrice - entryPrice) * trade.qty - trade.commission;
      } else {
        pnl = (entryPrice - trade.exitPrice) * trade.qty - trade.commission;
      }
    } else if (trade.currentPrice) {
      if (trade.side === 'Long') {
        pnl = (trade.currentPrice - entryPrice) * sharesRemaining;
      } else {
        pnl = (entryPrice - trade.currentPrice) * sharesRemaining;
      }
    }

    const pnlPct = positionValue > 0 ? pnl / positionValue : 0;

    // Risk Reward
    const riskPerShare = Math.abs(entryPrice - trade.sl);
    const rewardPerShare = trade.pt1Price ? Math.abs(trade.pt1Price - entryPrice) : 0;
    const rr = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

    // Open Risk
    const openRisk = trade.state === 'Open' ? sharesRemaining * riskPerShare : 0;

    // Exposure %
    const exposure = accountBalance > 0 ? (currentValue / accountBalance) : 0;

    // Distance to SL and PT1 in %
    const distanceToSL = entryPrice > 0 ? ((trade.sl - entryPrice) / entryPrice) : 0;
    const distanceToPT1 = entryPrice > 0 && trade.pt1Price ? ((trade.pt1Price - entryPrice) / entryPrice) : 0;

    return {
      entryPrice,
      sharesRemaining,
      currentValue,
      positionValue,
      timeDays,
      pnl,
      pnlPct,
      rr,
      openRisk,
      exposure,
      distanceToSL,
      distanceToPT1,
    };
  }, [accountBalance]);

  // ═══════════════════════════════════════════════════════════════
  // ESTADÍSTICAS GLOBALES SWING
  // ═══════════════════════════════════════════════════════════════

  const swingStats = useMemo(() => {
    const closed = closedTrades;
    if (closed.length === 0) return null;

    const withMetrics = closed.map(t => ({ trade: t, metrics: calculateTradeMetrics(t) }));
    const wins = withMetrics.filter(w => w.metrics.pnl > 0);
    const losses = withMetrics.filter(w => w.metrics.pnl < 0);

    const totalPnl = withMetrics.reduce((sum, w) => sum + w.metrics.pnl, 0);
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;

    const avgWinPct = wins.length > 0 ? wins.reduce((s, w) => s + w.metrics.pnlPct, 0) / wins.length : 0;
    const avgLossPct = losses.length > 0 ? losses.reduce((s, w) => s + w.metrics.pnlPct, 0) / losses.length : 0;
    const avgWinDollar = wins.length > 0 ? wins.reduce((s, w) => s + w.metrics.pnl, 0) / wins.length : 0;
    const avgLossDollar = losses.length > 0 ? losses.reduce((s, w) => s + w.metrics.pnl, 0) / losses.length : 0;

    const avgHoldWin = wins.length > 0 ? wins.filter(w => w.metrics.timeDays).reduce((s, w) => s + (w.metrics.timeDays || 0), 0) / wins.filter(w => w.metrics.timeDays).length : 0;
    const avgHoldLoss = losses.length > 0 ? losses.filter(w => w.metrics.timeDays).reduce((s, w) => s + (w.metrics.timeDays || 0), 0) / losses.filter(w => w.metrics.timeDays).length : 0;

    const largestWinPct = wins.length > 0 ? Math.max(...wins.map(w => w.metrics.pnlPct)) : 0;
    const largestLossPct = losses.length > 0 ? Math.min(...losses.map(w => w.metrics.pnlPct)) : 0;
    const largestWinDollar = wins.length > 0 ? Math.max(...wins.map(w => w.metrics.pnl)) : 0;
    const largestLossDollar = losses.length > 0 ? Math.min(...losses.map(w => w.metrics.pnl)) : 0;

    const avgRR = withMetrics.length > 0 ? withMetrics.reduce((s, w) => s + w.metrics.rr, 0) / withMetrics.length : 0;
    const winLossRatio = avgLossPct !== 0 ? Math.abs(avgWinPct / avgLossPct) : 0;

    // Stats por setup
    const setupStats: Record<TradeSetup, { count: number; wins: number; avgGain: number; avgLoss: number; rr: number }> = {} as any;
    const setups: TradeSetup[] = ['WB', 'WBPB', 'BORS', 'BORL', 'BO10PB', 'BO21PB', 'BO50PB', 'Breakout', 'Power Play', 'Other'];
    setups.forEach(setup => {
      const setupTrades = withMetrics.filter(w => w.trade.setup === setup);
      const setupWins = setupTrades.filter(w => w.metrics.pnl > 0);
      const setupLosses = setupTrades.filter(w => w.metrics.pnl < 0);
      setupStats[setup] = {
        count: setupTrades.length,
        wins: setupWins.length,
        avgGain: setupWins.length > 0 ? setupWins.reduce((s, w) => s + w.metrics.pnlPct, 0) / setupWins.length : 0,
        avgLoss: setupLosses.length > 0 ? setupLosses.reduce((s, w) => s + w.metrics.pnlPct, 0) / setupLosses.length : 0,
        rr: setupTrades.length > 0 ? setupTrades.reduce((s, w) => s + w.metrics.rr, 0) / setupTrades.length : 0,
      };
    });

    // Recent performance (últimos N trades)
    const recentPerformance = [10, 20, 30, 40, 50].map(n => {
      const recent = withMetrics.slice(-n);
      const recentWins = recent.filter(w => w.metrics.pnl > 0);
      const recentLosses = recent.filter(w => w.metrics.pnl < 0);
      return {
        n,
        count: recent.length,
        winRate: recent.length > 0 ? recentWins.length / recent.length : 0,
        avgGain: recentWins.length > 0 ? recentWins.reduce((s, w) => s + w.metrics.pnlPct, 0) / recentWins.length : 0,
        avgLoss: recentLosses.length > 0 ? recentLosses.reduce((s, w) => s + w.metrics.pnlPct, 0) / recentLosses.length : 0,
        avgRR: recent.length > 0 ? recent.reduce((s, w) => s + w.metrics.rr, 0) / recent.length : 0,
      };
    });

    return {
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
      avgWinPct,
      avgLossPct,
      avgWinDollar,
      avgLossDollar,
      avgHoldWin,
      avgHoldLoss,
      largestWinPct,
      largestLossPct,
      largestWinDollar,
      largestLossDollar,
      avgRR,
      winLossRatio,
      setupStats,
      recentPerformance,
    };
  }, [closedTrades, calculateTradeMetrics]);

  // ═══════════════════════════════════════════════════════════════
  // PORTFOLIO STATS (Open trades)
  // ═══════════════════════════════════════════════════════════════

  const portfolioStats = useMemo(() => {
    if (openTrades.length === 0) return null;

    const withMetrics = openTrades.map(t => ({ trade: t, metrics: calculateTradeMetrics(t) }));

    const totalOpenProfit = withMetrics.reduce((sum, w) => sum + w.metrics.pnl, 0); // TOP
    const totalOpenRisk = withMetrics.reduce((sum, w) => sum + w.metrics.openRisk, 0); // TOR
    const totalExposure = withMetrics.reduce((sum, w) => sum + w.metrics.exposure, 0);

    // TOH = Total Open Heat (unrealized loss if all hit SL)
    const totalOpenHeat = withMetrics.reduce((sum, w) => {
      const entry = w.trade.value / w.trade.qty;
      const lossIfStopped = w.trade.side === 'Long'
        ? (entry - w.trade.sl) * w.metrics.sharesRemaining
        : (w.trade.sl - entry) * w.metrics.sharesRemaining;
      return sum + Math.max(0, lossIfStopped);
    }, 0);

    // NOR = New Open Risk (risk on new positions today)
    const today = new Date().toISOString().split('T')[0];
    const todayTrades = withMetrics.filter(w => w.trade.date === today);
    const newOpenRisk = todayTrades.reduce((sum, w) => sum + w.metrics.openRisk, 0);

    return {
      positions: withMetrics,
      totalOpenProfit,
      totalOpenRisk,
      totalOpenHeat,
      newOpenRisk,
      totalExposure,
      norPct: accountBalance > 0 ? newOpenRisk / accountBalance : 0,
      torPct: accountBalance > 0 ? totalOpenRisk / accountBalance : 0,
    };
  }, [openTrades, calculateTradeMetrics, accountBalance]);

  // ═══════════════════════════════════════════════════════════════
  // FETCH REAL-TIME PRICES - CRÍTICO PARA PORTFOLIO
  // ═══════════════════════════════════════════════════════════════

  const [lastPriceUpdate, setLastPriceUpdate] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  // Fetch real-time prices for open trades using STABLE endpoint
  // IMPORTANTE: El endpoint /stable/quote NO soporta múltiples símbolos, hay que hacer una llamada por cada uno
  const fetchRealTimePrices = useCallback(async () => {
    const currentTrades = tradesRef.current;
    const openTradesNow = currentTrades.filter(t => t.state === 'Open');

    console.log('[DiarioInversor] fetchRealTimePrices called. Total trades:', currentTrades.length, 'Open:', openTradesNow.length);

    if (openTradesNow.length === 0) {
      console.log('[DiarioInversor] No open trades to fetch prices for');
      return;
    }

    const symbols = [...new Set(openTradesNow.map(t => t.symbol.toUpperCase().trim()).filter(s => s.length > 0))];
    console.log('[DiarioInversor] Symbols to fetch:', symbols);

    if (symbols.length === 0) {
      console.log('[DiarioInversor] No valid symbols found');
      return;
    }

    setLoadingPrices(true);
    setPriceError(null);

    try {
      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;

      // Hacer una llamada por cada símbolo (el endpoint stable no soporta múltiples)
      const priceMap: Record<string, number> = {};

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const url = `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`;
            const response = await fetch(url, { cache: 'no-store' });

            if (response.ok) {
              const data = await response.json();
              const quote = Array.isArray(data) ? data[0] : data;
              if (quote?.price) {
                priceMap[symbol.toUpperCase()] = quote.price;
                console.log(`[DiarioInversor] ✓ ${symbol}: $${quote.price}`);
              }
            }
          } catch (err) {
            console.error(`[DiarioInversor] Error fetching ${symbol}:`, err);
          }
        })
      );

      console.log('[DiarioInversor] Price map:', priceMap);

      if (Object.keys(priceMap).length === 0) {
        setPriceError('No se pudieron obtener precios');
        setLoadingPrices(false);
        return;
      }

      // Update trades with new prices
      setTrades(prev => prev.map(t => {
        const upperSymbol = t.symbol.toUpperCase().trim();
        if (t.state === 'Open' && priceMap[upperSymbol] !== undefined) {
          return { ...t, currentPrice: priceMap[upperSymbol] };
        }
        return t;
      }));

      setLastPriceUpdate(new Date().toLocaleTimeString());
      setPriceError(null);
    } catch (error) {
      console.error('[DiarioInversor] Error fetching prices:', error);
      setPriceError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoadingPrices(false);
    }
  }, []);

  // Auto-fetch prices on load
  useEffect(() => {
    if (!dataLoaded) return;

    const openTradesExist = tradesRef.current.some(t => t.state === 'Open');
    console.log('[DiarioInversor] Data loaded, checking for open trades:', openTradesExist);

    if (openTradesExist) {
      const timeoutId = setTimeout(() => {
        console.log('[DiarioInversor] Auto-fetching prices on load...');
        fetchRealTimePrices();
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [dataLoaded, fetchRealTimePrices]);

  // Auto-refresh prices every 10 seconds when there are open trades
  useEffect(() => {
    if (!dataLoaded) return;

    const openTradesExist = tradesRef.current.some(t => t.state === 'Open');
    if (!openTradesExist) return;

    console.log('[DiarioInversor] Setting up 10-second price refresh interval');
    const intervalId = setInterval(() => {
      console.log('[DiarioInversor] Auto-refresh tick...');
      fetchRealTimePrices();
    }, 10000); // 10 segundos

    return () => {
      console.log('[DiarioInversor] Clearing price refresh interval');
      clearInterval(intervalId);
    };
  }, [dataLoaded, fetchRealTimePrices, trades]); // Re-run when trades change

  // ═══════════════════════════════════════════════════════════════
  // TRADE CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  const createEmptyTrade = (): Trade => ({
    id: generateId(),
    name: '',
    symbol: '',
    side: 'Long',
    date: new Date().toISOString().split('T')[0],
    qty: 0,
    entryPrice: 0,
    value: 0,
    commission: 0,
    pt1Price: null,
    pt1Qty: null,
    pt2Price: null,
    pt2Qty: null,
    pt3Price: null,
    pt3Qty: null,
    s1Price: null,
    s2Price: null,
    sfDate: null,
    sl: 0,
    initialSL: 0,
    initialRisk: 0,
    setup: 'WB',
    sellReason: null,
    postAnalysis: '',
    chartLink: '',
    industry: '',
    partial1Qty: null,
    partial1Pct: null,
    partial2Qty: null,
    partial2Pct: null,
    partial3Qty: null,
    partial3Pct: null,
    exitPrice: null,
    exitDate: null,
    state: 'Open',
    currentPrice: null,
  });

  const saveTrade = (trade: Trade) => {
    setTrades(prev => {
      const idx = prev.findIndex(t => t.id === trade.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = trade;
        return updated;
      }
      return [...prev, trade];
    });
    setEditingTrade(null);
    setShowTradeForm(false);
  };

  const deleteTrade = (id: string) => {
    if (confirm('¿Eliminar este trade?')) {
      setTrades(prev => prev.filter(t => t.id !== id));
    }
  };

  const closeTrade = (trade: Trade, exitPrice: number) => {
    const updated: Trade = {
      ...trade,
      exitPrice,
      exitDate: new Date().toISOString().split('T')[0],
      state: 'Closed',
    };
    saveTrade(updated);
  };

  // ═══════════════════════════════════════════════════════════════
  // PTA CRUD
  // ═══════════════════════════════════════════════════════════════

  const createEmptyPTA = (): PTAEntry => ({
    id: generateId(),
    date: new Date().toISOString().split('T')[0],
    preMarketPlan: '',
    ptmmSignal: '',
    score: 0,
    plDay: 0,
    invested: 0,
    marketAction: '',
    globalBreadth: false,
    norIntraday: false,
    norEOD: false,
    positionSizing: false,
    plannedTrades: false,
    overTrading: false,
    sellRulesRespected: false,
    goodSleepMindset: false,
    respect: false,
    executionMistakes: '',
    reasons: '',
    disciplineEmotions: '',
    whatWentGood: '',
    needToImprove: '',
    linkedTradeIds: [],
  });

  // ═══════════════════════════════════════════════════════════════
  // EXPORT / IMPORT
  // ═══════════════════════════════════════════════════════════════

  const exportData = () => {
    const data = { trades, weeklyPL, ptaEntries, accountBalance, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diario-inversor-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.trades) setTrades(data.trades);
        if (data.weeklyPL) setWeeklyPL(data.weeklyPL);
        if (data.ptaEntries) setPtaEntries(data.ptaEntries);
        if (data.accountBalance) setAccountBalance(data.accountBalance);
        alert('Datos importados correctamente');
      } catch (err) {
        alert('Error al importar datos');
      }
    };
    reader.readAsText(file);
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            📊 {t('diarioTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('diarioTab.subtitle')}</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-gray-400">{t('diarioTab.balance')}:</label>
            <input
              type="number"
              value={accountBalance}
              onChange={(e) => setAccountBalance(Number(e.target.value))}
              className="w-32 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
            />
          </div>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <button onClick={exportData} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white">
            📤 {t('diarioTab.export')}
          </button>

          <label className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white cursor-pointer">
            📥 {t('diarioTab.import')}
            <input type="file" accept=".json" onChange={importData} className="hidden" />
          </label>

          {/* Sync status badge */}
          {user ? (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              syncStatus === 'saving' ? 'bg-blue-900/40 border-blue-500/40 text-blue-300' :
              syncStatus === 'saved'  ? 'bg-green-900/40 border-green-500/40 text-green-300' :
              syncStatus === 'error'  ? 'bg-red-900/40 border-red-500/40 text-red-300' :
              'bg-gray-800 border-gray-600 text-gray-400'
            }`}>
              {syncStatus === 'saving' && <><span className="animate-spin">⏳</span> Saving...</>}
              {syncStatus === 'saved'  && <>✅ Saved to cloud</>}
              {syncStatus === 'error'  && <>❌ Sync error</>}
              {syncStatus === 'idle'   && <>☁️ Cloud sync</>}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-yellow-600/40 bg-yellow-900/20 text-yellow-400">
              ⚠️ Login to save
            </div>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-800 p-2 rounded-lg">
          {['SWING', 'P&L', 'Portfolio', 'PTA'].map(tab => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${
                  selected
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* SWING TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <Tab.Panel>
            <SwingTab
              trades={yearTrades}
              stats={swingStats}
              onAddTrade={() => { setEditingTrade(createEmptyTrade()); setShowTradeForm(true); }}
              onEditTrade={(t) => { setEditingTrade(t); setShowTradeForm(true); }}
              onDeleteTrade={deleteTrade}
              onCloseTrade={closeTrade}
              calculateMetrics={calculateTradeMetrics}
            />
          </Tab.Panel>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* P&L TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <Tab.Panel>
            <PLTab
              trades={closedTrades}
              weeklyPL={weeklyPL}
              setWeeklyPL={setWeeklyPL}
              selectedYear={selectedYear}
              accountBalance={accountBalance}
              calculateMetrics={calculateTradeMetrics}
            />
          </Tab.Panel>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* PORTFOLIO TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <Tab.Panel>
            <PortfolioTab
              openTrades={openTrades}
              portfolioStats={portfolioStats}
              onRefreshPrices={fetchRealTimePrices}
              loadingPrices={loadingPrices}
              calculateMetrics={calculateTradeMetrics}
              accountBalance={accountBalance}
              lastUpdate={lastPriceUpdate}
              priceError={priceError}
            />
          </Tab.Panel>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* PTA TAB */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          <Tab.Panel>
            <PTATab
              entries={ptaEntries}
              setEntries={setPtaEntries}
              trades={yearTrades}
              createEmpty={createEmptyPTA}
            />
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>

      {/* Trade Form Modal */}
      {showTradeForm && editingTrade && (
        <TradeFormModal
          trade={editingTrade}
          onSave={saveTrade}
          onCancel={() => { setShowTradeForm(false); setEditingTrade(null); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SWING SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════

function SwingTab({
  trades,
  stats,
  onAddTrade,
  onEditTrade,
  onDeleteTrade,
  onCloseTrade,
  calculateMetrics,
}: {
  trades: Trade[];
  stats: any;
  onAddTrade: () => void;
  onEditTrade: (t: Trade) => void;
  onDeleteTrade: (id: string) => void;
  onCloseTrade: (t: Trade, price: number) => void;
  calculateMetrics: (t: Trade) => any;
}) {
  const { t } = useLanguage();
  const [closeModal, setCloseModal] = useState<{ trade: Trade; price: string } | null>(null);

  return (
    <div className="space-y-6">
      {/* Stats Summary */}
      {stats && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-bold text-blue-400 mb-4">📈 {t('diarioTab.statistics')}</h3>

          {/* Main stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <StatCard label="Total Trades" value={stats.totalTrades} />
            <StatCard label="Win Rate" value={formatPercent(stats.winRate)} color={stats.winRate >= 0.5 ? 'green' : 'red'} />
            <StatCard label="P&L Total" value={formatCurrency(stats.totalPnl)} color={stats.totalPnl >= 0 ? 'green' : 'red'} />
            <StatCard label="Avg Win %" value={formatPercent(stats.avgWinPct)} color="green" />
            <StatCard label="Avg Loss %" value={formatPercent(stats.avgLossPct)} color="red" />
            <StatCard label="Win/Loss Ratio" value={formatNumber(stats.winLossRatio)} />
            <StatCard label="Avg Win $" value={formatCurrency(stats.avgWinDollar)} color="green" />
            <StatCard label="Avg Loss $" value={formatCurrency(stats.avgLossDollar)} color="red" />
            <StatCard label="Avg Hold Win" value={`${formatNumber(stats.avgHoldWin, 1)}d`} />
            <StatCard label="Avg Hold Loss" value={`${formatNumber(stats.avgHoldLoss, 1)}d`} />
            <StatCard label="Largest Win %" value={formatPercent(stats.largestWinPct)} color="green" />
            <StatCard label="Largest Loss %" value={formatPercent(stats.largestLossPct)} color="red" />
            <StatCard label="Largest Win $" value={formatCurrency(stats.largestWinDollar)} color="green" />
            <StatCard label="Largest Loss $" value={formatCurrency(stats.largestLossDollar)} color="red" />
            <StatCard label="Avg R:R" value={formatNumber(stats.avgRR)} />
          </div>

          {/* Recent Performance */}
          <div className="mb-6">
            <h4 className="text-md font-semibold text-gray-300 mb-2">📊 Recent Trades Performance</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="px-2 py-1 text-left">Last N</th>
                    <th className="px-2 py-1">Count</th>
                    <th className="px-2 py-1">Win %</th>
                    <th className="px-2 py-1">Avg Gain</th>
                    <th className="px-2 py-1">Avg Loss</th>
                    <th className="px-2 py-1">Avg R:R</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentPerformance.map((r: any) => (
                    <tr key={r.n} className="border-b border-gray-800">
                      <td className="px-2 py-1 text-gray-300">Last {r.n}</td>
                      <td className="px-2 py-1 text-center">{r.count}</td>
                      <td className={`px-2 py-1 text-center ${r.winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatPercent(r.winRate)}
                      </td>
                      <td className="px-2 py-1 text-center text-green-400">{formatPercent(r.avgGain)}</td>
                      <td className="px-2 py-1 text-center text-red-400">{formatPercent(r.avgLoss)}</td>
                      <td className="px-2 py-1 text-center">{formatNumber(r.avgRR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Setup Performance */}
          <div>
            <h4 className="text-md font-semibold text-gray-300 mb-2">🎯 Performance by Setup</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(stats.setupStats).map(([setup, data]: [string, any]) => (
                data.count > 0 && (
                  <div key={setup} className="bg-gray-700 rounded p-2 text-sm">
                    <div className="font-semibold text-blue-300">{setup}</div>
                    <div className="text-gray-400">Trades: {data.count}</div>
                    <div className={data.wins / data.count >= 0.5 ? 'text-green-400' : 'text-red-400'}>
                      Win: {formatPercent(data.count > 0 ? data.wins / data.count : 0)}
                    </div>
                    <div className="text-gray-400">R:R: {formatNumber(data.rr)}</div>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={onAddTrade} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold">
          ➕ Nuevo Trade
        </button>
      </div>

      {/* Trades Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700 text-left">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Symbol</th>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Side</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Entry</th>
              <th className="px-2 py-2">Qty</th>
              <th className="px-2 py-2">Value</th>
              <th className="px-2 py-2">SL</th>
              <th className="px-2 py-2">PT1</th>
              <th className="px-2 py-2">Setup</th>
              <th className="px-2 py-2">State</th>
              <th className="px-2 py-2">Exit</th>
              <th className="px-2 py-2">P&L</th>
              <th className="px-2 py-2">P&L %</th>
              <th className="px-2 py-2">R:R</th>
              <th className="px-2 py-2">Days</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, idx) => {
              const metrics = calculateMetrics(trade);
              return (
                <tr key={trade.id} className="border-b border-gray-800 hover:bg-gray-750">
                  <td className="px-2 py-2 text-gray-500">{idx + 1}</td>
                  <td className="px-2 py-2 font-semibold text-blue-300">{trade.symbol}</td>
                  <td className="px-2 py-2 text-gray-300">{trade.name}</td>
                  <td className={`px-2 py-2 ${trade.side === 'Long' ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.side}
                  </td>
                  <td className="px-2 py-2 text-gray-400">{trade.date}</td>
                  <td className="px-2 py-2">{formatCurrency(metrics.entryPrice)}</td>
                  <td className="px-2 py-2">{trade.qty}</td>
                  <td className="px-2 py-2">{formatCurrency(trade.value)}</td>
                  <td className="px-2 py-2 text-red-400">{formatCurrency(trade.sl)}</td>
                  <td className="px-2 py-2 text-green-400">{trade.pt1Price ? formatCurrency(trade.pt1Price) : '-'}</td>
                  <td className="px-2 py-2 text-purple-300">{trade.setup}</td>
                  <td className={`px-2 py-2 font-semibold ${trade.state === 'Open' ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {trade.state}
                  </td>
                  <td className="px-2 py-2">{trade.exitPrice ? formatCurrency(trade.exitPrice) : '-'}</td>
                  <td className={`px-2 py-2 font-semibold ${metrics.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(metrics.pnl)}
                  </td>
                  <td className={`px-2 py-2 ${metrics.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(metrics.pnlPct)}
                  </td>
                  <td className="px-2 py-2">{formatNumber(metrics.rr)}</td>
                  <td className="px-2 py-2">{metrics.timeDays ?? '-'}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <button onClick={() => onEditTrade(trade)} className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs">
                        ✏️
                      </button>
                      {trade.state === 'Open' && (
                        <button
                          onClick={() => setCloseModal({ trade, price: '' })}
                          className="px-2 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-xs"
                        >
                          🔒
                        </button>
                      )}
                      <button onClick={() => onDeleteTrade(trade.id)} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && (
          <div className="text-center py-8 text-gray-500">No hay trades registrados</div>
        )}
      </div>

      {/* Close Trade Modal */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h3 className="text-lg font-bold mb-4">Cerrar Trade: {closeModal.trade.symbol}</h3>
            <input
              type="number"
              step="0.01"
              placeholder="Precio de salida"
              value={closeModal.price}
              onChange={(e) => setCloseModal({ ...closeModal, price: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (closeModal.price) {
                    onCloseTrade(closeModal.trade, Number(closeModal.price));
                    setCloseModal(null);
                  }
                }}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded"
              >
                Cerrar
              </button>
              <button onClick={() => setCloseModal(null)} className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// P&L SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════

function PLTab({
  trades,
  weeklyPL,
  setWeeklyPL,
  selectedYear,
  accountBalance,
  calculateMetrics,
}: {
  trades: Trade[];
  weeklyPL: WeeklyPL[];
  setWeeklyPL: React.Dispatch<React.SetStateAction<WeeklyPL[]>>;
  selectedYear: number;
  accountBalance: number;
  calculateMetrics: (t: Trade) => any;
}) {
  const { t } = useLanguage();
  // Calculate weekly P&L from closed trades
  const weeklyData = useMemo(() => {
    const weeks: Record<string, { trades: Trade[]; pnl: number }> = {};

    trades.forEach(trade => {
      if (trade.exitDate) {
        const weekStart = getWeekStart(new Date(trade.exitDate)).toISOString().split('T')[0];
        if (!weeks[weekStart]) weeks[weekStart] = { trades: [], pnl: 0 };
        const metrics = calculateMetrics(trade);
        weeks[weekStart].trades.push(trade);
        weeks[weekStart].pnl += metrics.pnl;
      }
    });

    // Sort by week
    const sorted = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));

    let cumulative = 0;
    let maxCumulative = 0;

    return sorted.map(([weekStart, data], idx) => {
      cumulative += data.pnl;
      maxCumulative = Math.max(maxCumulative, cumulative);
      const drawdown = maxCumulative > 0 ? (maxCumulative - cumulative) / maxCumulative : 0;

      return {
        weekStart,
        weekLabel: `S${idx + 1}`,
        pnl: data.pnl,
        cumulative,
        pctWeek: accountBalance > 0 ? data.pnl / accountBalance : 0,
        pctCumul: accountBalance > 0 ? cumulative / accountBalance : 0,
        drawdown,
        trades: data.trades.length,
      };
    });
  }, [trades, calculateMetrics, accountBalance]);

  // Monthly summary
  const monthlyData = useMemo(() => {
    const months: Record<string, number> = {};
    trades.forEach(trade => {
      if (trade.exitDate) {
        const month = trade.exitDate.substring(0, 7); // YYYY-MM
        const metrics = calculateMetrics(trade);
        months[month] = (months[month] || 0) + metrics.pnl;
      }
    });
    return Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
  }, [trades, calculateMetrics]);

  // Quarterly summary
  const quarterlyData = useMemo(() => {
    const quarters: Record<string, number> = {};
    trades.forEach(trade => {
      if (trade.exitDate) {
        const date = new Date(trade.exitDate);
        const q = Math.ceil((date.getMonth() + 1) / 3);
        const key = `Q${q}`;
        const metrics = calculateMetrics(trade);
        quarters[key] = (quarters[key] || 0) + metrics.pnl;
      }
    });
    return Object.entries(quarters);
  }, [trades, calculateMetrics]);

  const totalYTD = weeklyData.reduce((sum, w) => sum + w.pnl, 0);
  const ytdPct = accountBalance > 0 ? totalYTD / accountBalance : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="YTD P&L" value={formatCurrency(totalYTD)} color={totalYTD >= 0 ? 'green' : 'red'} />
        <StatCard label="YTD %" value={formatPercent(ytdPct)} color={ytdPct >= 0 ? 'green' : 'red'} />
        <StatCard label="Weeks Traded" value={weeklyData.length} />
        <StatCard label="Trades Closed" value={trades.length} />
      </div>

      {/* Weekly Table */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-lg font-bold text-blue-400 mb-4">📅 Weekly Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="px-2 py-2 text-left">Week</th>
                <th className="px-2 py-2 text-left">Start</th>
                <th className="px-2 py-2">Trades</th>
                <th className="px-2 py-2">P&L Week</th>
                <th className="px-2 py-2">% Week</th>
                <th className="px-2 py-2">Cumulative</th>
                <th className="px-2 py-2">% Cumul</th>
                <th className="px-2 py-2">Drawdown</th>
              </tr>
            </thead>
            <tbody>
              {weeklyData.map(week => (
                <tr key={week.weekStart} className="border-b border-gray-800">
                  <td className="px-2 py-2 font-semibold text-blue-300">{week.weekLabel}</td>
                  <td className="px-2 py-2 text-gray-400">{week.weekStart}</td>
                  <td className="px-2 py-2 text-center">{week.trades}</td>
                  <td className={`px-2 py-2 text-center ${week.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(week.pnl)}
                  </td>
                  <td className={`px-2 py-2 text-center ${week.pctWeek >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(week.pctWeek)}
                  </td>
                  <td className={`px-2 py-2 text-center ${week.cumulative >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(week.cumulative)}
                  </td>
                  <td className={`px-2 py-2 text-center ${week.pctCumul >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(week.pctCumul)}
                  </td>
                  <td className="px-2 py-2 text-center text-red-400">
                    {formatPercent(week.drawdown)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Visual Charts */}
      {weeklyData.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-bold text-blue-400 mb-4">📈 Weekly P&L Chart</h3>
          <div className="h-48 flex items-end justify-center gap-1">
            {(() => {
              const maxAbs = Math.max(...weeklyData.map(w => Math.abs(w.pnl)), 1);
              return weeklyData.slice(-20).map((week, idx) => {
                const heightPct = Math.abs(week.pnl) / maxAbs * 80;
                const isPositive = week.pnl >= 0;
                return (
                  <div key={idx} className="flex flex-col items-center justify-end h-full w-full max-w-8">
                    <div
                      className={`w-full rounded-t transition-all ${isPositive ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ height: `${heightPct}%`, minHeight: week.pnl !== 0 ? '4px' : '1px' }}
                      title={`${week.weekLabel}: ${formatCurrency(week.pnl)}`}
                    />
                    <span className="text-[8px] text-gray-500 mt-1 rotate-45 origin-left">{week.weekLabel}</span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Cumulative Equity Curve */}
      {weeklyData.length > 1 && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-bold text-purple-400 mb-4">📊 Equity Curve (Cumulative)</h3>
          <div className="h-32 flex items-end gap-1">
            {(() => {
              const maxCumul = Math.max(...weeklyData.map(w => Math.abs(w.cumulative)), 1);
              const minCumul = Math.min(...weeklyData.map(w => w.cumulative), 0);
              const range = maxCumul - minCumul;
              return weeklyData.slice(-20).map((week, idx) => {
                const heightPct = range > 0 ? ((week.cumulative - minCumul) / range) * 90 : 50;
                return (
                  <div key={idx} className="flex flex-col items-center justify-end h-full w-full">
                    <div
                      className={`w-full rounded-t transition-all ${week.cumulative >= 0 ? 'bg-gradient-to-t from-purple-600 to-purple-400' : 'bg-gradient-to-t from-red-600 to-red-400'}`}
                      style={{ height: `${Math.max(heightPct, 2)}%` }}
                      title={`${week.weekLabel}: ${formatCurrency(week.cumulative)}`}
                    />
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>Start</span>
            <span className={weeklyData[weeklyData.length - 1]?.cumulative >= 0 ? 'text-green-400' : 'text-red-400'}>
              {formatCurrency(weeklyData[weeklyData.length - 1]?.cumulative || 0)}
            </span>
          </div>
        </div>
      )}

      {/* Monthly & Quarterly with visual bars */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Monthly with bars */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-bold text-blue-400 mb-4">📆 Monthly Summary</h3>
          <div className="space-y-2">
            {(() => {
              const maxMonthAbs = Math.max(...monthlyData.map(([, pnl]) => Math.abs(pnl)), 1);
              return monthlyData.map(([month, pnl]) => {
                const widthPct = Math.abs(pnl) / maxMonthAbs * 100;
                return (
                  <div key={month} className="flex items-center gap-2">
                    <span className="text-gray-400 w-20 text-sm">{month.split('-')[1]}</span>
                    <div className="flex-1 h-5 bg-gray-700 rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all ${pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className={`w-24 text-right text-sm ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(pnl)}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Quarterly with visual blocks */}
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-bold text-blue-400 mb-4">📊 Quarterly Summary</h3>
          <div className="grid grid-cols-4 gap-2">
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => {
              const entry = quarterlyData.find(([quarter]) => quarter === q);
              const pnl = entry ? entry[1] : 0;
              return (
                <div
                  key={q}
                  className={`p-4 rounded-lg text-center border-2 ${
                    pnl > 0 ? 'bg-green-900/30 border-green-500' :
                    pnl < 0 ? 'bg-red-900/30 border-red-500' :
                    'bg-gray-700/30 border-gray-600'
                  }`}
                >
                  <div className="text-lg font-bold text-gray-300">{q}</div>
                  <div className={`text-sm font-semibold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(pnl)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-700 flex justify-between items-center">
            <span className="text-gray-400">YTD Total:</span>
            <span className={`text-xl font-bold ${totalYTD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(totalYTD)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════

function PortfolioTab({
  openTrades,
  portfolioStats,
  onRefreshPrices,
  loadingPrices,
  calculateMetrics,
  accountBalance,
  lastUpdate,
  priceError,
}: {
  openTrades: Trade[];
  portfolioStats: any;
  onRefreshPrices: () => void;
  loadingPrices: boolean;
  calculateMetrics: (t: Trade) => any;
  accountBalance: number;
  lastUpdate: string | null;
  priceError?: string | null;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      {/* Header with refresh button */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h3 className="text-xl font-bold text-blue-400">💼 {t('diarioTab.portfolioRealTime')}</h3>
          {lastUpdate && (
            <p className="text-sm text-green-400">✓ {t('diarioTab.lastUpdate')}: {lastUpdate}</p>
          )}
          {priceError && (
            <p className="text-sm text-red-400">⚠️ Error: {priceError}</p>
          )}
        </div>
        <button
          onClick={onRefreshPrices}
          disabled={loadingPrices}
          className={`px-6 py-3 rounded-lg text-white font-semibold transition-all ${
            loadingPrices
              ? 'bg-gray-600 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 shadow-lg hover:shadow-xl'
          }`}
        >
          {loadingPrices ? `⏳ ${t('diarioTab.updating')}...` : `🔄 ${t('diarioTab.refreshPrices')}`}
        </button>
      </div>

      {/* Portfolio Summary */}
      {portfolioStats ? (
        <div className="space-y-6">
          {/* Main Stats */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-6 border border-gray-700 shadow-xl">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {/* Main P&L Card - Larger */}
              <div className={`col-span-2 p-6 rounded-xl ${portfolioStats.totalOpenProfit >= 0 ? 'bg-green-900/40 border-green-500' : 'bg-red-900/40 border-red-500'} border-2`}>
                <div className="text-sm text-gray-300 mb-1">💰 Total Open Profit (TOP)</div>
                <div className={`text-3xl font-bold ${portfolioStats.totalOpenProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(portfolioStats.totalOpenProfit)}
                </div>
              </div>

              <StatCard
                label="🔥 TOH (Open Heat)"
                value={formatCurrency(portfolioStats.totalOpenHeat)}
                color="red"
              />
              <StatCard
                label="⚠️ TOR (Open Risk)"
                value={formatCurrency(portfolioStats.totalOpenRisk)}
                color="yellow"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard
                label="TOR %"
                value={formatPercent(portfolioStats.torPct)}
                color={portfolioStats.torPct > 0.02 ? 'red' : 'yellow'}
              />
              <StatCard
                label="🆕 NOR (New Risk)"
                value={formatCurrency(portfolioStats.newOpenRisk)}
                color={portfolioStats.norPct > 0.01 ? 'red' : 'green'}
              />
              <StatCard
                label="NOR %"
                value={formatPercent(portfolioStats.norPct)}
                color={portfolioStats.norPct > 0.01 ? 'red' : 'green'}
              />
              <StatCard
                label="📊 Exposure"
                value={formatPercent(portfolioStats.totalExposure)}
                color={portfolioStats.totalExposure > 1 ? 'red' : 'blue'}
              />
              <StatCard
                label="📈 Positions"
                value={openTrades.length}
              />
            </div>
          </div>

          {/* Visual Distribution Charts */}
          {openTrades.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* P&L Distribution by Position */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h3 className="text-lg font-bold text-purple-400 mb-4">📊 P&L by Position</h3>
                <div className="space-y-2">
                  {openTrades.map(trade => {
                    const metrics = calculateMetrics(trade);
                    const maxPnl = Math.max(...openTrades.map(t => Math.abs(calculateMetrics(t).pnl)), 1);
                    const widthPct = Math.abs(metrics.pnl) / maxPnl * 100;
                    return (
                      <div key={trade.id} className="flex items-center gap-2">
                        <span className="text-blue-300 w-16 text-sm font-medium">{trade.symbol}</span>
                        <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all ${metrics.pnl >= 0 ? 'bg-gradient-to-r from-green-600 to-green-400' : 'bg-gradient-to-r from-red-600 to-red-400'}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                        <span className={`w-20 text-right text-sm ${metrics.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatCurrency(metrics.pnl)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Exposure by Setup */}
              <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                <h3 className="text-lg font-bold text-cyan-400 mb-4">🎯 Exposure by Setup</h3>
                <div className="space-y-2">
                  {(() => {
                    const setupExposure: Record<string, number> = {};
                    openTrades.forEach(trade => {
                      const metrics = calculateMetrics(trade);
                      setupExposure[trade.setup] = (setupExposure[trade.setup] || 0) + metrics.currentValue;
                    });
                    const totalExp = Object.values(setupExposure).reduce((a, b) => a + b, 0);
                    const colors = ['bg-blue-500', 'bg-purple-500', 'bg-cyan-500', 'bg-pink-500', 'bg-amber-500', 'bg-green-500'];
                    return Object.entries(setupExposure).map(([setup, value], idx) => {
                      const pct = totalExp > 0 ? (value / totalExp) * 100 : 0;
                      return (
                        <div key={setup} className="flex items-center gap-2">
                          <span className="text-gray-300 w-20 text-sm">{setup}</span>
                          <div className="flex-1 h-4 bg-gray-700 rounded overflow-hidden">
                            <div
                              className={`h-full rounded transition-all ${colors[idx % colors.length]}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-gray-400 w-16 text-right text-sm">{pct.toFixed(1)}%</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
          <div className="text-4xl mb-4">📭</div>
          <p className="text-gray-400 text-lg">{t('diarioTab.noOpenPositions')}</p>
          <p className="text-gray-500 text-sm mt-2">{t('diarioTab.addTradeInSwing')}</p>
        </div>
      )}

      {/* Positions Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700 text-left">
              <th className="px-2 py-2">Ticker</th>
              <th className="px-2 py-2">Industry</th>
              <th className="px-2 py-2">Side</th>
              <th className="px-2 py-2">Entry</th>
              <th className="px-2 py-2">Current</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Weight %</th>
              <th className="px-2 py-2">Shares</th>
              <th className="px-2 py-2">SL</th>
              <th className="px-2 py-2">Open Risk</th>
              <th className="px-2 py-2">PT1</th>
              <th className="px-2 py-2">Setup</th>
              <th className="px-2 py-2">R:R</th>
              <th className="px-2 py-2">P&L</th>
              <th className="px-2 py-2">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {openTrades.map(trade => {
              const metrics = calculateMetrics(trade);
              const weight = accountBalance > 0 ? metrics.currentValue / accountBalance : 0;
              return (
                <tr key={trade.id} className="border-b border-gray-800 hover:bg-gray-750">
                  <td className="px-2 py-2 font-semibold text-blue-300">{trade.symbol}</td>
                  <td className="px-2 py-2 text-gray-400">{trade.industry || '-'}</td>
                  <td className={`px-2 py-2 ${trade.side === 'Long' ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.side}
                  </td>
                  <td className="px-2 py-2">{formatCurrency(metrics.entryPrice)}</td>
                  <td className="px-2 py-2 text-yellow-400">
                    {trade.currentPrice ? formatCurrency(trade.currentPrice) : '-'}
                  </td>
                  <td className="px-2 py-2 text-gray-400">{trade.date}</td>
                  <td className="px-2 py-2">{formatPercent(weight)}</td>
                  <td className="px-2 py-2">{metrics.sharesRemaining}</td>
                  <td className="px-2 py-2 text-red-400">{formatCurrency(trade.sl)}</td>
                  <td className="px-2 py-2 text-yellow-400">{formatCurrency(metrics.openRisk)}</td>
                  <td className="px-2 py-2 text-green-400">{trade.pt1Price ? formatCurrency(trade.pt1Price) : '-'}</td>
                  <td className="px-2 py-2 text-purple-300">{trade.setup}</td>
                  <td className="px-2 py-2">{formatNumber(metrics.rr)}</td>
                  <td className={`px-2 py-2 font-semibold ${metrics.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(metrics.pnl)}
                  </td>
                  <td className={`px-2 py-2 ${metrics.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(metrics.pnlPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {openTrades.length === 0 && (
          <div className="text-center py-8 text-gray-500">No hay posiciones abiertas</div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PTA SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════

function PTATab({
  entries,
  setEntries,
  trades,
  createEmpty,
}: {
  entries: PTAEntry[];
  setEntries: React.Dispatch<React.SetStateAction<PTAEntry[]>>;
  trades: Trade[];
  createEmpty: () => PTAEntry;
}) {
  const { t } = useLanguage();
  const [editingEntry, setEditingEntry] = useState<PTAEntry | null>(null);
  const [showForm, setShowForm] = useState(false);

  const saveEntry = (entry: PTAEntry) => {
    setEntries(prev => {
      const idx = prev.findIndex(e => e.id === entry.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = entry;
        return updated;
      }
      return [...prev, entry];
    });
    setEditingEntry(null);
    setShowForm(false);
  };

  const deleteEntry = (id: string) => {
    if (confirm(t('diarioTab.confirmDelete'))) {
      setEntries(prev => prev.filter(e => e.id !== id));
    }
  };

  return (
    <div className="space-y-6">
      {/* Actions */}
      <button
        onClick={() => { setEditingEntry(createEmpty()); setShowForm(true); }}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold"
      >
        ➕ {t('diarioTab.newPTAEntry')}
      </button>

      {/* Entries List */}
      <div className="space-y-4">
        {entries.sort((a, b) => b.date.localeCompare(a.date)).map(entry => (
          <div key={entry.id} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="text-lg font-semibold text-blue-300">{entry.date}</div>
                <div className="text-sm text-gray-400">Score: {entry.score}/10 | P&L: {formatCurrency(entry.plDay)}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditingEntry(entry); setShowForm(true); }} className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs">
                  ✏️ Editar
                </button>
                <button onClick={() => deleteEntry(entry.id)} className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-xs">
                  🗑️
                </button>
              </div>
            </div>

            {/* Pre-market Plan */}
            {entry.preMarketPlan && (
              <div className="mb-3">
                <div className="text-sm font-semibold text-gray-400">Pre-Market Plan:</div>
                <div className="text-gray-300">{entry.preMarketPlan}</div>
              </div>
            )}

            {/* Checklist Summary */}
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
              <CheckItem label="Breadth" checked={entry.globalBreadth} />
              <CheckItem label="NOR <1%" checked={entry.norIntraday} />
              <CheckItem label="NOR EOD" checked={entry.norEOD} />
              <CheckItem label="Sizing" checked={entry.positionSizing} />
              <CheckItem label="Planned" checked={entry.plannedTrades} />
              <CheckItem label="No OT" checked={!entry.overTrading} />
              <CheckItem label="Sell Rules" checked={entry.sellRulesRespected} />
              <CheckItem label="Mindset" checked={entry.goodSleepMindset} />
            </div>

            {/* What went good / Need to improve */}
            <div className="grid md:grid-cols-2 gap-4">
              {entry.whatWentGood && (
                <div>
                  <div className="text-sm font-semibold text-green-400">What Went Good:</div>
                  <div className="text-gray-300 text-sm">{entry.whatWentGood}</div>
                </div>
              )}
              {entry.needToImprove && (
                <div>
                  <div className="text-sm font-semibold text-yellow-400">Need to Improve:</div>
                  <div className="text-gray-300 text-sm">{entry.needToImprove}</div>
                </div>
              )}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-center py-8 text-gray-500">{t('diarioTab.noPTAEntries')}</div>
        )}
      </div>

      {/* PTA Form Modal */}
      {showForm && editingEntry && (
        <PTAFormModal
          entry={editingEntry}
          trades={trades}
          onSave={saveEntry}
          onCancel={() => { setShowForm(false); setEditingEntry(null); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatCard({
  label,
  value,
  color = 'gray',
}: {
  label: string;
  value: string | number;
  color?: 'gray' | 'green' | 'red' | 'blue' | 'yellow' | 'purple';
}) {
  const colorClasses = {
    gray: 'text-gray-100',
    green: 'text-green-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
    purple: 'text-purple-400',
  };

  return (
    <div className="bg-gray-700 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-bold ${colorClasses[color]}`}>{value}</div>
    </div>
  );
}

function CheckItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className={`text-xs px-2 py-1 rounded ${checked ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>
      {checked ? '✓' : '✗'} {label}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TRADE FORM MODAL
// ═══════════════════════════════════════════════════════════════

function TradeFormModal({
  trade,
  onSave,
  onCancel,
}: {
  trade: Trade;
  onSave: (t: Trade) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<Trade>(trade);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const updateField = <K extends keyof Trade>(key: K, value: Trade[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  // Fetch quote when symbol changes (with debounce)
  useEffect(() => {
    const symbol = form.symbol?.toUpperCase().trim();
    if (!symbol || symbol.length < 1) return;

    const timeoutId = setTimeout(async () => {
      setLoadingQuote(true);
      setQuoteError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('API key not found');

        // Fetch quote for current price and profile for company info
        const [quoteRes, profileRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        let currentPrice = null;
        let companyName = '';
        let industry = '';

        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
          if (quote?.price) {
            currentPrice = quote.price;
            console.log(`[TradeForm] Fetched price for ${symbol}: $${currentPrice}`);
          }
        }

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          const profile = Array.isArray(profileData) ? profileData[0] : profileData;
          if (profile) {
            companyName = profile.companyName || profile.name || '';
            industry = profile.industry || '';
            console.log(`[TradeForm] Fetched profile for ${symbol}: ${companyName}, ${industry}`);
          }
        }

        // Update form with fetched data (only if empty or different symbol)
        setForm(prev => ({
          ...prev,
          currentPrice: currentPrice || prev.currentPrice,
          name: prev.name || companyName,
          industry: prev.industry || industry,
          // Optionally set entryPrice if empty (user can override)
          entryPrice: prev.entryPrice || currentPrice || 0,
        }));

        if (!currentPrice) {
          setQuoteError(`No se encontró precio para ${symbol}`);
        }
      } catch (err) {
        console.error('[TradeForm] Error fetching quote:', err);
        setQuoteError('Error al obtener datos');
      } finally {
        setLoadingQuote(false);
      }
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [form.symbol]);

  // Auto-calculate value when entryPrice or qty changes
  useEffect(() => {
    if (form.entryPrice && form.qty) {
      const calculatedValue = form.entryPrice * form.qty;
      setForm(prev => ({ ...prev, value: calculatedValue }));
    }
  }, [form.entryPrice, form.qty]);

  // Auto-calculate initial risk when SL or entryPrice changes
  useEffect(() => {
    if (form.entryPrice && form.qty && form.sl) {
      const risk = Math.abs(form.entryPrice - form.sl) * form.qty;
      setForm(prev => ({ ...prev, initialRisk: risk }));
    }
  }, [form.entryPrice, form.qty, form.sl]);

  // Set initialSL to sl if not set
  useEffect(() => {
    if (form.sl && !form.initialSL) {
      setForm(prev => ({ ...prev, initialSL: form.sl }));
    }
  }, [form.sl, form.initialSL]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold text-blue-400 mb-6">
          {trade.symbol ? `${t('diarioTab.editTradeTitle')}: ${trade.symbol}` : t('diarioTab.newTrade')}
        </h3>

        {/* Entry Summary Card */}
        {form.entryPrice > 0 && form.qty > 0 && (
          <div className="bg-gray-700/50 rounded-lg p-4 mb-6 border border-gray-600">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
              <div>
                <div className="text-xs text-gray-400">Position Value</div>
                <div className="text-lg font-bold text-blue-400">${(form.entryPrice * form.qty).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Risk per Share</div>
                <div className="text-lg font-bold text-yellow-400">
                  ${form.sl ? Math.abs(form.entryPrice - form.sl).toFixed(2) : '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Total Risk</div>
                <div className="text-lg font-bold text-red-400">
                  ${form.sl ? (Math.abs(form.entryPrice - form.sl) * form.qty).toFixed(2) : '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Risk %</div>
                <div className="text-lg font-bold text-red-400">
                  {form.sl ? ((Math.abs(form.entryPrice - form.sl) / form.entryPrice) * 100).toFixed(2) : '-'}%
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">R:R Ratio</div>
                <div className="text-lg font-bold text-green-400">
                  {form.sl && form.pt1Price ? (Math.abs(form.pt1Price - form.entryPrice) / Math.abs(form.entryPrice - form.sl)).toFixed(2) : '-'}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Basic Info */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Symbol * {loadingQuote && <span className="text-blue-400 animate-pulse">⏳</span>}
            </label>
            <input
              type="text"
              value={form.symbol}
              onChange={(e) => updateField('symbol', e.target.value.toUpperCase())}
              className={`w-full px-3 py-2 bg-gray-700 border rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ${
                quoteError ? 'border-red-500' : form.currentPrice ? 'border-green-500' : 'border-gray-600'
              }`}
              placeholder="AAPL"
            />
            {form.currentPrice && (
              <p className="text-xs text-green-400 mt-1">💰 Precio actual: ${form.currentPrice.toFixed(2)}</p>
            )}
            {quoteError && (
              <p className="text-xs text-red-400 mt-1">⚠️ {quoteError}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded focus:border-blue-500"
              placeholder="Apple Inc"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Side</label>
            <select
              value={form.side}
              onChange={(e) => updateField('side', e.target.value as TradeSide)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            >
              <option value="Long">🟢 Long</option>
              <option value="Short">🔴 Short</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Entry Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>

          {/* Position Size - Entry Price first! */}
          <div className="bg-blue-900/30 p-3 rounded border border-blue-600">
            <label className="block text-sm text-blue-300 mb-1 font-semibold">Entry Price * 💰</label>
            <input
              type="number"
              step="0.01"
              value={form.entryPrice || ''}
              onChange={(e) => updateField('entryPrice', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-blue-500 rounded text-lg font-bold"
              placeholder="150.00"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Quantity *</label>
            <input
              type="number"
              value={form.qty || ''}
              onChange={(e) => updateField('qty', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
              placeholder="100"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Total Value (auto)</label>
            <input
              type="number"
              step="0.01"
              value={form.value || ''}
              readOnly
              className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Commission</label>
            <input
              type="number"
              step="0.01"
              value={form.commission || ''}
              onChange={(e) => updateField('commission', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>

          {/* Stop Loss - Highlighted */}
          <div className="bg-red-900/30 p-3 rounded border border-red-600">
            <label className="block text-sm text-red-300 mb-1 font-semibold">Stop Loss * 🛑</label>
            <input
              type="number"
              step="0.01"
              value={form.sl || ''}
              onChange={(e) => updateField('sl', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-red-500 rounded"
              placeholder="145.00"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial SL</label>
            <input
              type="number"
              step="0.01"
              value={form.initialSL || ''}
              onChange={(e) => updateField('initialSL', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial Risk $ (auto)</label>
            <input
              type="number"
              step="0.01"
              value={form.initialRisk ? form.initialRisk.toFixed(2) : ''}
              readOnly
              className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded text-red-400"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Industry</label>
            <input
              type="text"
              value={form.industry}
              onChange={(e) => updateField('industry', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
              placeholder="Technology"
            />
          </div>

          {/* Setup */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Setup</label>
            <select
              value={form.setup}
              onChange={(e) => updateField('setup', e.target.value as TradeSetup)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            >
              <option value="WB">WB</option>
              <option value="WBPB">WBPB</option>
              <option value="BORS">BORS</option>
              <option value="BORL">BORL</option>
              <option value="BO10PB">BO10PB</option>
              <option value="BO21PB">BO21PB</option>
              <option value="BO50PB">BO50PB</option>
              <option value="Breakout">Breakout</option>
              <option value="Power Play">Power Play</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Price Targets - Green themed */}
          <div className="bg-green-900/30 p-3 rounded border border-green-600">
            <label className="block text-sm text-green-300 mb-1 font-semibold">PT1 Price 🎯</label>
            <input
              type="number"
              step="0.01"
              value={form.pt1Price || ''}
              onChange={(e) => updateField('pt1Price', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-gray-700 border border-green-500 rounded"
              placeholder="160.00"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">PT1 Qty</label>
            <input
              type="number"
              value={form.pt1Qty || ''}
              onChange={(e) => updateField('pt1Qty', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
              placeholder="50"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">PT2 Price</label>
            <input
              type="number"
              step="0.01"
              value={form.pt2Price || ''}
              onChange={(e) => updateField('pt2Price', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
              placeholder="170.00"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">PT2 Qty</label>
            <input
              type="number"
              value={form.pt2Qty || ''}
              onChange={(e) => updateField('pt2Qty', e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
              placeholder="50"
            />
          </div>

          {/* Exit Info (only if closed) */}
          {form.state === 'Closed' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Exit Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.exitPrice || ''}
                  onChange={(e) => updateField('exitPrice', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Exit Date</label>
                <input
                  type="date"
                  value={form.exitDate || ''}
                  onChange={(e) => updateField('exitDate', e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Sell Reason</label>
                <select
                  value={form.sellReason || ''}
                  onChange={(e) => updateField('sellReason', e.target.value as SellReason)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
                >
                  <option value="">-</option>
                  <option value="Stopped">Stopped</option>
                  <option value="EOD">EOD</option>
                  <option value="Sold into Strength">Sold into Strength</option>
                  <option value="Target Hit">Target Hit</option>
                  <option value="Time Stop">Time Stop</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </>
          )}

          {/* State Toggle */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">State</label>
            <select
              value={form.state}
              onChange={(e) => updateField('state', e.target.value as TradeState)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            >
              <option value="Open">Open</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div className="mt-4">
          <label className="block text-sm text-gray-400 mb-1">Post Analysis / Notes</label>
          <textarea
            value={form.postAnalysis}
            onChange={(e) => updateField('postAnalysis', e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded h-24"
            placeholder="Trade notes, lessons learned..."
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm text-gray-400 mb-1">Chart Link</label>
          <input
            type="text"
            value={form.chartLink}
            onChange={(e) => updateField('chartLink', e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            placeholder="TradingView link..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-4 mt-6">
          <button
            onClick={() => onSave(form)}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded font-semibold"
          >
            💾 Guardar
          </button>
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-semibold"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PTA FORM MODAL
// ═══════════════════════════════════════════════════════════════

function PTAFormModal({
  entry,
  trades,
  onSave,
  onCancel,
}: {
  entry: PTAEntry;
  trades: Trade[];
  onSave: (e: PTAEntry) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [form, setForm] = useState<PTAEntry>(entry);

  const updateField = <K extends keyof PTAEntry>(key: K, value: PTAEntry[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold text-blue-400 mb-6">{t('diarioTab.ptaEntry')}</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t('diarioTab.date')}</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => updateField('date', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Score (1-10)</label>
            <input
              type="number"
              min="1"
              max="10"
              value={form.score}
              onChange={(e) => updateField('score', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">P&L Day</label>
            <input
              type="number"
              step="0.01"
              value={form.plDay}
              onChange={(e) => updateField('plDay', Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">PTMM Signal</label>
            <input
              type="text"
              value={form.ptmmSignal}
              onChange={(e) => updateField('ptmmSignal', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded"
            />
          </div>
        </div>

        {/* Pre-market plan */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-1">Pre-Market Plan</label>
          <textarea
            value={form.preMarketPlan}
            onChange={(e) => updateField('preMarketPlan', e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded h-24"
          />
        </div>

        {/* Checklist */}
        <div className="mb-4">
          <label className="block text-sm text-gray-400 mb-2">System Checklist</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <CheckboxField label="Global Breadth > 0" checked={form.globalBreadth} onChange={(v) => updateField('globalBreadth', v)} />
            <CheckboxField label="NOR < 1% Intraday" checked={form.norIntraday} onChange={(v) => updateField('norIntraday', v)} />
            <CheckboxField label="NOR < 0.5% EOD" checked={form.norEOD} onChange={(v) => updateField('norEOD', v)} />
            <CheckboxField label="Position Sizing OK" checked={form.positionSizing} onChange={(v) => updateField('positionSizing', v)} />
            <CheckboxField label="Planned Trades" checked={form.plannedTrades} onChange={(v) => updateField('plannedTrades', v)} />
            <CheckboxField label="Over-Trading" checked={form.overTrading} onChange={(v) => updateField('overTrading', v)} />
            <CheckboxField label="Sell Rules Respected" checked={form.sellRulesRespected} onChange={(v) => updateField('sellRulesRespected', v)} />
            <CheckboxField label="8h+ Sleep & Mindset" checked={form.goodSleepMindset} onChange={(v) => updateField('goodSleepMindset', v)} />
          </div>
        </div>

        {/* Reflections */}
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">What Went Good</label>
            <textarea
              value={form.whatWentGood}
              onChange={(e) => updateField('whatWentGood', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded h-20"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Need to Improve</label>
            <textarea
              value={form.needToImprove}
              onChange={(e) => updateField('needToImprove', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded h-20"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Execution Mistakes</label>
            <textarea
              value={form.executionMistakes}
              onChange={(e) => updateField('executionMistakes', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded h-20"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Discipline & Emotions</label>
            <textarea
              value={form.disciplineEmotions}
              onChange={(e) => updateField('disciplineEmotions', e.target.value)}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded h-20"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4 mt-6">
          <button onClick={() => onSave(form)} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded font-semibold">
            💾 Guardar
          </button>
          <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded font-semibold">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded bg-gray-700 border-gray-600"
      />
      <span className="text-sm text-gray-300">{label}</span>
    </label>
  );
}
