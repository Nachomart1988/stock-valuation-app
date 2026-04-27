'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchFmpRaw } from '@/lib/fmpClient';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import { useLanguage } from '@/i18n/LanguageContext';
import Header from '@/app/components/Header';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface EarningsEntry {
  symbol: string;
  date: string;
  epsActual: number | null;
  epsEstimated: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
}

interface PrevQuarterResult {
  beat: boolean;
  epsActual: number;
  epsEstimated: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const FMP_IMG = (symbol: string) =>
  `https://financialmodelingprep.com/image-stock/${symbol}.png`;

function getMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDateShort(d: Date, locale: string): string {
  return d.toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtRevenue(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

const BIG_TICKERS = new Set([
  'AAPL','MSFT','AMZN','GOOGL','GOOG','META','TSLA','NVDA','BRK-A','BRK-B',
  'JPM','V','JNJ','WMT','UNH','MA','PG','HD','DIS','BAC','XOM','ADBE',
  'NFLX','CRM','COST','AMD','INTC','QCOM','PYPL','ABNB','COIN','SHOP',
  'UBER','SNAP','PLTR','RIVN','SOFI','NET','DDOG','SNOW','MDB','CRWD',
  'VZ','T','TMUS','KO','PEP','MCD','NKE','SBUX','LLY','ABBV','MRK',
  'PFE','TMO','ABT','CVX','COP','SLB','GM','F','BKNG','ABNB','NOW',
  'PANW','ZS','FTNT','WDAY','TEAM','DOCU','OKTA','TTD','ROKU','SQ',
  'HOOD','MARA','RIOT','CLSK','ARM','SMCI','AVGO','MRVL','ON','LRCX',
]);

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function EarningsPage() {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const router = useRouter();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmtDate(today);

  const [weekOffset, setWeekOffset] = useState(0);
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [prevQMap, setPrevQMap] = useState<Record<string, PrevQuarterResult>>({});
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [alarmModal, setAlarmModal] = useState<EarningsEntry | null>(null);
  const [alarmEmail, setAlarmEmail] = useState('');
  const [alarmSending, setAlarmSending] = useState(false);
  const [alarmSuccess, setAlarmSuccess] = useState(false);
  const [savedAlarms, setSavedAlarms] = useState<Set<string>>(new Set());
  const [showAllSymbols, setShowAllSymbols] = useState(false);

  const monday = addDays(getMonday(today), weekOffset * 7);
  const friday = addDays(monday, 4);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));

  /* ---------- Fetch earnings + historical beat/miss ---------- */
  const fetchEarnings = useCallback(async () => {
    setLoading(true);
    try {
      const from = fmtDate(monday);
      const to = fmtDate(friday);

      // Fetch current week earnings
      const data: EarningsEntry[] = await fetchFmpRaw(
        'stable/earnings-calendar',
        { from, to }
      ).catch(() => []);

      const all = Array.isArray(data) ? data : [];
      setEarnings(all);

      // Fetch beat/miss per-symbol via stable/earnings (only for US tickers)
      // Limit concurrency to 6 to avoid rate limiting
      const symbols = [...new Set(all.map((e) => e.symbol).filter((s) => !s.includes('.')))];
      const map: Record<string, PrevQuarterResult> = {};

      const fetchOne = async (symbol: string) => {
        try {
          const history: EarningsEntry[] = await fetchFmpRaw(
            'stable/earnings',
            { symbol }
          );
          // Find most recent entry with both epsActual and epsEstimated
          const arr = Array.isArray(history) ? history : [];
          const past = arr
            .filter((h) => h.epsActual != null && h.epsEstimated != null)
            .sort((a, b) => b.date.localeCompare(a.date));
          if (past.length > 0) {
            const recent = past[0];
            map[symbol] = {
              beat: recent.epsActual! >= recent.epsEstimated!,
              epsActual: recent.epsActual!,
              epsEstimated: recent.epsEstimated!,
            };
          }
        } catch {}
      };

      // Process in batches of 6
      const BATCH = 6;
      for (let i = 0; i < symbols.length; i += BATCH) {
        await Promise.all(symbols.slice(i, i + BATCH).map(fetchOne));
        // Update progressively so user sees badges appear as they load
        setPrevQMap({ ...map });
      }
    } catch (err) {
      console.error('Earnings calendar fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchEarnings(); }, [fetchEarnings]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('earnings_alarms');
      if (stored) setSavedAlarms(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  /* ---------- Group & sort by date ---------- */
  const byDate: Record<string, EarningsEntry[]> = {};
  for (const e of earnings) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  // Filter: show only non-foreign symbols unless toggled
  const filterEarnings = (list: EarningsEntry[]) => {
    let filtered = showAllSymbols ? list : list.filter((e) => !e.symbol.includes('.'));
    // Sort: big tickers first, then those with estimates, then alphabetically
    filtered.sort((a, b) => {
      const aBig = BIG_TICKERS.has(a.symbol) ? 0 : 1;
      const bBig = BIG_TICKERS.has(b.symbol) ? 0 : 1;
      if (aBig !== bBig) return aBig - bBig;
      const aEst = (a.epsEstimated != null || a.revenueEstimated != null) ? 0 : 1;
      const bEst = (b.epsEstimated != null || b.revenueEstimated != null) ? 0 : 1;
      if (aEst !== bEst) return aEst - bEst;
      return a.symbol.localeCompare(b.symbol);
    });
    return filtered;
  };

  /* ---------- Alarm save ---------- */
  const handleSaveAlarm = async () => {
    if (!alarmModal || !alarmEmail) return;
    setAlarmSending(true);
    try {
      await fetch('/api/earnings-alarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: alarmEmail,
          symbol: alarmModal.symbol,
          date: alarmModal.date,
          epsEstimated: alarmModal.epsEstimated,
          revenueEstimated: alarmModal.revenueEstimated,
        }),
      });
      const newAlarms = new Set(savedAlarms);
      newAlarms.add(`${alarmModal.symbol}_${alarmModal.date}`);
      setSavedAlarms(newAlarms);
      localStorage.setItem('earnings_alarms', JSON.stringify([...newAlarms]));
      setAlarmSuccess(true);
      setTimeout(() => { setAlarmModal(null); setAlarmSuccess(false); }, 2000);
    } catch (err) {
      console.error('Error saving alarm:', err);
    } finally {
      setAlarmSending(false);
    }
  };

  const weekLabel = es
    ? `${monday.toLocaleDateString('es-ES', { month: 'long', day: 'numeric' })} — ${friday.toLocaleDateString('es-ES', { month: 'long', day: 'numeric', year: 'numeric' })}`
    : `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} — ${friday.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />

      <main className="pt-20 pb-16 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/[0.08] border border-amber-500/20 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-medium text-amber-400 tracking-wide">
                {es ? 'Calendario en vivo' : 'Live Calendar'}
              </span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-black mb-3">
              Earnings Calendar
            </h1>
            <p className="text-gray-500 max-w-2xl mx-auto text-sm">
              {es
                ? 'Reportes de ganancias semanales. Estimados de analistas, resultados del trimestre anterior y alertas por email.'
                : 'Weekly earnings reports. Analyst estimates, previous quarter results, and email alerts.'}
            </p>
          </div>

          {/* Controls bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
            {/* Week navigation */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setWeekOffset((w) => w - 1)}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition text-gray-400 hover:text-white"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-center min-w-[260px]">
                <span className="text-sm font-semibold text-gray-200">{weekLabel}</span>
              </div>
              <button
                onClick={() => setWeekOffset((w) => w + 1)}
                className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition text-gray-400 hover:text-white"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {weekOffset !== 0 && (
                <button
                  onClick={() => setWeekOffset(0)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 hover:bg-amber-500/30 transition font-medium"
                >
                  {es ? 'Esta semana' : 'This week'}
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllSymbols}
                  onChange={(e) => setShowAllSymbols(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-amber-500 focus:ring-amber-500/50"
                />
                <span className="text-xs text-gray-400">
                  {es ? 'Incluir mercados internacionales' : 'Include international markets'}
                </span>
              </label>
            </div>
          </div>

          {/* Calendar grid */}
          {loading ? (
            <div className="flex justify-center py-20">
              <LogoLoader size="md" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
              {weekDays.map((day) => {
                const dateStr = fmtDate(day);
                const isToday = dateStr === todayStr;
                const dayEarnings = filterEarnings(byDate[dateStr] || []);
                const totalRaw = (byDate[dateStr] || []).length;
                const isExpanded = expandedDay === dateStr;
                const PREVIEW_COUNT = 20;
                const displayEarnings = isExpanded ? dayEarnings : dayEarnings.slice(0, PREVIEW_COUNT);
                const remaining = dayEarnings.length - PREVIEW_COUNT;

                return (
                  <div
                    key={dateStr}
                    className={`rounded-xl border flex flex-col transition-all ${
                      isToday
                        ? 'bg-amber-500/[0.06] border-amber-500/30 shadow-[0_0_40px_rgba(245,158,11,0.10)]'
                        : 'bg-gray-900/40 border-white/[0.06]'
                    }`}
                  >
                    {/* Day header */}
                    <div className={`flex items-center justify-between p-3 border-b ${isToday ? 'border-amber-500/20' : 'border-white/[0.06]'}`}>
                      <div>
                        <div className={`text-xs font-bold uppercase tracking-wider ${isToday ? 'text-amber-400' : 'text-gray-400'}`}>
                          {fmtDateShort(day, locale)}
                        </div>
                        {isToday && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-[10px] text-amber-500 font-bold tracking-wider">
                              {es ? 'HOY' : 'TODAY'}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`text-sm font-bold font-mono ${isToday ? 'text-amber-300' : 'text-gray-400'}`}>
                          {dayEarnings.length}
                        </span>
                        <div className="text-[9px] text-gray-600">
                          {!showAllSymbols && totalRaw > dayEarnings.length && `/ ${totalRaw} total`}
                        </div>
                      </div>
                    </div>

                    {/* Earnings list */}
                    <div className="flex-1 p-2 overflow-y-auto max-h-[600px] space-y-1">
                      {dayEarnings.length === 0 ? (
                        <p className="text-gray-700 text-xs text-center py-8">
                          {es ? 'Sin reportes' : 'No reports'}
                        </p>
                      ) : (
                        <>
                          {displayEarnings.map((e) => {
                            const isBig = BIG_TICKERS.has(e.symbol);
                            const prev = prevQMap[e.symbol];
                            const hasAlarm = savedAlarms.has(`${e.symbol}_${e.date}`);

                            return (
                              <div
                                key={e.symbol}
                                className={`group rounded-lg border transition-all ${
                                  isBig
                                    ? 'bg-white/[0.05] border-white/[0.12] hover:border-white/[0.20] p-2.5'
                                    : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.10] p-2'
                                }`}
                              >
                                {/* Top row */}
                                <div className="flex items-center justify-between mb-1">
                                  <div
                                    className="flex items-center gap-2 cursor-pointer min-w-0"
                                    onClick={() => router.push(`/earnings/${e.symbol}`)}
                                    title={es ? 'Ver prediccion neural' : 'View neural prediction'}
                                  >
                                    <img
                                      src={FMP_IMG(e.symbol)}
                                      alt=""
                                      className={`rounded-md object-contain bg-white/[0.08] flex-shrink-0 ${isBig ? 'w-8 h-8' : 'w-5 h-5'}`}
                                      onError={(ev) => {
                                        (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                    <span className={`font-bold tracking-tight truncate ${isBig ? 'text-sm text-white' : 'text-[11px] text-gray-300'}`}>
                                      {e.symbol}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    {prev && (
                                      <span
                                        className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-full leading-none ${
                                          prev.beat
                                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                                        }`}
                                        title={`Prev Qt: ${prev.epsActual.toFixed(2)} vs ${prev.epsEstimated.toFixed(2)} est.`}
                                      >
                                        {prev.beat ? 'BEAT' : 'MISS'}
                                      </span>
                                    )}

                                    <button
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        if (!hasAlarm) setAlarmModal(e);
                                      }}
                                      className={`p-0.5 rounded transition ${
                                        hasAlarm
                                          ? 'text-amber-400'
                                          : 'text-gray-700 hover:text-amber-400 opacity-0 group-hover:opacity-100'
                                      }`}
                                      title={hasAlarm ? (es ? 'Alarma activa' : 'Alarm set') : (es ? 'Poner alarma' : 'Set alarm')}
                                    >
                                      <svg className="w-3 h-3" fill={hasAlarm ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>

                                {/* Estimates */}
                                <div className="flex items-center gap-2 text-[9px] flex-wrap">
                                  {e.epsEstimated != null && (
                                    <span>
                                      <span className="text-gray-600">EPS </span>
                                      <span className="text-gray-300 font-semibold font-mono">
                                        ${e.epsEstimated.toFixed(2)}
                                      </span>
                                    </span>
                                  )}
                                  {e.revenueEstimated != null && (
                                    <span>
                                      <span className="text-gray-600">Rev </span>
                                      <span className="text-gray-300 font-semibold font-mono">
                                        {fmtRevenue(e.revenueEstimated)}
                                      </span>
                                    </span>
                                  )}
                                  {e.epsActual != null && (
                                    <span>
                                      <span className="text-gray-600">Act </span>
                                      <span className={`font-semibold font-mono ${
                                        e.epsEstimated != null && e.epsActual >= e.epsEstimated
                                          ? 'text-green-400'
                                          : e.epsEstimated != null
                                            ? 'text-red-400'
                                            : 'text-gray-300'
                                      }`}>
                                        ${e.epsActual.toFixed(2)}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          {!isExpanded && remaining > 0 && (
                            <button
                              onClick={() => setExpandedDay(dateStr)}
                              className="w-full text-center text-[11px] text-amber-400/80 hover:text-amber-400 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] transition font-medium"
                            >
                              {es ? `Ver ${remaining} más` : `Show ${remaining} more`}
                            </button>
                          )}
                          {isExpanded && dayEarnings.length > PREVIEW_COUNT && (
                            <button
                              onClick={() => setExpandedDay(null)}
                              className="w-full text-center text-[11px] text-gray-500 hover:text-gray-300 py-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] transition font-medium"
                            >
                              {es ? 'Mostrar menos' : 'Show less'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-5 mt-8 text-[11px] text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-3 rounded bg-amber-500/[0.06] border border-amber-500/30" />
              {es ? 'Hoy' : 'Today'}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[8px] font-bold border border-green-500/30">BEAT</span>
              {es ? 'Supero estimado Qt anterior' : 'Beat estimate prev Qt'}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[8px] font-bold border border-red-500/30">MISS</span>
              {es ? 'No alcanzo estimado Qt anterior' : 'Missed estimate prev Qt'}
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="w-3 h-3 text-amber-400" fill="currentColor" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {es ? 'Alarma por email' : 'Email alarm'}
            </div>
          </div>
        </div>
      </main>

      {/* Alarm Modal */}
      {alarmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/[0.10] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            {alarmSuccess ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-white font-semibold text-lg mb-1">
                  {es ? 'Alarma guardada' : 'Alarm saved'}
                </p>
                <p className="text-gray-400 text-sm">
                  {es
                    ? `Te notificaremos antes de los earnings de ${alarmModal.symbol}`
                    : `We'll notify you before ${alarmModal.symbol}'s earnings`}
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                      <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-base">
                        {es ? 'Alerta de Earnings' : 'Earnings Alert'}
                      </h3>
                      <p className="text-gray-500 text-xs">
                        {alarmModal.symbol} &bull; {alarmModal.date}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAlarmModal(null)}
                    className="text-gray-600 hover:text-white transition p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 mb-5 flex items-center gap-4">
                  <img
                    src={FMP_IMG(alarmModal.symbol)}
                    alt=""
                    className="w-12 h-12 rounded-lg bg-white/[0.06] object-contain"
                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="flex-1">
                    <div className="text-white font-bold text-lg">{alarmModal.symbol}</div>
                    <div className="flex gap-4 mt-1 text-xs">
                      {alarmModal.epsEstimated != null && (
                        <span>
                          <span className="text-gray-500">EPS Est: </span>
                          <span className="text-gray-300 font-mono">${alarmModal.epsEstimated.toFixed(2)}</span>
                        </span>
                      )}
                      {alarmModal.revenueEstimated != null && (
                        <span>
                          <span className="text-gray-500">Rev Est: </span>
                          <span className="text-gray-300 font-mono">{fmtRevenue(alarmModal.revenueEstimated)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mb-5">
                  <label className="text-xs text-gray-400 mb-1.5 block font-medium">
                    {es ? 'Tu email para la notificacion' : 'Your email for notification'}
                  </label>
                  <input
                    type="email"
                    value={alarmEmail}
                    onChange={(e) => setAlarmEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-4 py-2.5 bg-white/[0.04] border border-white/[0.10] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/50 transition"
                  />
                  <p className="text-[11px] text-gray-600 mt-1.5">
                    {es
                      ? 'Recibiras un email recordatorio el dia del reporte de earnings.'
                      : "You'll receive a reminder email on the day of the earnings report."}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setAlarmModal(null)}
                    className="flex-1 py-2.5 rounded-lg border border-white/[0.08] text-gray-400 text-sm font-medium hover:bg-white/[0.04] transition"
                  >
                    {es ? 'Cancelar' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleSaveAlarm}
                    disabled={!alarmEmail || alarmSending}
                    className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {alarmSending
                      ? (es ? 'Guardando...' : 'Saving...')
                      : (es ? 'Activar Alarma' : 'Activate Alarm')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
