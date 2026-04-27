'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchFmpRaw } from '@/lib/fmpClient';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import { useLanguage } from '@/i18n/LanguageContext';

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
  beat: boolean | null; // null = no data
  epsActual: number | null;
  epsEstimated: number | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const FMP_IMG = (symbol: string) =>
  `https://financialmodelingprep.com/image-stock/${symbol}.png`;

/** Monday of the week containing `d` */
function getMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0=Sun … 6=Sat
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
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

/** Big US tickers we want to feature prominently */
const BIG_TICKERS = new Set([
  'AAPL','MSFT','AMZN','GOOGL','GOOG','META','TSLA','NVDA','BRK-A','BRK-B',
  'JPM','V','JNJ','WMT','UNH','MA','PG','HD','DIS','BAC','XOM','ADBE',
  'NFLX','CRM','COST','AMD','INTC','QCOM','PYPL','ABNB','COIN','SHOP',
  'UBER','SNAP','PLTR','RIVN','SOFI','NET','DDOG','SNOW','MDB','CRWD',
]);

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function EarningsCalendarSection() {
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
  const [alarmModal, setAlarmModal] = useState<EarningsEntry | null>(null);
  const [alarmEmail, setAlarmEmail] = useState('');
  const [alarmSending, setAlarmSending] = useState(false);
  const [alarmSuccess, setAlarmSuccess] = useState(false);
  const [savedAlarms, setSavedAlarms] = useState<Set<string>>(new Set());

  // Compute week boundaries
  const monday = addDays(getMonday(today), weekOffset * 7);
  const friday = addDays(monday, 4);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));

  // Fetch earnings for visible week
  const fetchEarnings = useCallback(async () => {
    setLoading(true);
    try {
      const from = fmtDate(monday);
      const to = fmtDate(friday);
      const data: EarningsEntry[] = await fetchFmpRaw(
        'stable/earnings-calendar',
        { from, to }
      );
      // Filter to only US-like symbols (no dots = not foreign exchanges)
      const filtered = (Array.isArray(data) ? data : []).filter(
        (e) => e.symbol && !e.symbol.includes('.')
      );
      setEarnings(filtered);

      // Fetch previous quarter data for beat/miss
      // Get unique symbols, fetch last quarter (3 months ago)
      const symbols = [...new Set(filtered.map((e) => e.symbol))];
      if (symbols.length > 0) {
        const prevFrom = fmtDate(addDays(monday, -100));
        const prevTo = fmtDate(addDays(monday, -1));
        const prevData: EarningsEntry[] = await fetchFmpRaw(
          'stable/earnings-calendar',
          { from: prevFrom, to: prevTo }
        ).catch(() => []);

        const map: Record<string, PrevQuarterResult> = {};
        const symbolSet = new Set(symbols);
        for (const e of Array.isArray(prevData) ? prevData : []) {
          if (
            symbolSet.has(e.symbol) &&
            e.epsActual != null &&
            e.epsEstimated != null &&
            !map[e.symbol] // take the most recent (first encountered)
          ) {
            map[e.symbol] = {
              beat: e.epsActual >= e.epsEstimated,
              epsActual: e.epsActual,
              epsEstimated: e.epsEstimated,
            };
          }
        }
        setPrevQMap(map);
      }
    } catch (err) {
      console.error('Earnings calendar fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  // Load saved alarms from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('earnings_alarms');
      if (stored) setSavedAlarms(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  // Group earnings by date
  const byDate: Record<string, EarningsEntry[]> = {};
  for (const e of earnings) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }
  // Sort each day: big tickers first, then by whether they have estimates
  for (const date of Object.keys(byDate)) {
    byDate[date].sort((a, b) => {
      const aBig = BIG_TICKERS.has(a.symbol) ? 0 : 1;
      const bBig = BIG_TICKERS.has(b.symbol) ? 0 : 1;
      if (aBig !== bBig) return aBig - bBig;
      const aEst = a.epsEstimated != null ? 0 : 1;
      const bEst = b.epsEstimated != null ? 0 : 1;
      return aEst - bEst;
    });
  }

  // Handle alarm save
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
      // Save locally
      const newAlarms = new Set(savedAlarms);
      newAlarms.add(`${alarmModal.symbol}_${alarmModal.date}`);
      setSavedAlarms(newAlarms);
      localStorage.setItem('earnings_alarms', JSON.stringify([...newAlarms]));
      setAlarmSuccess(true);
      setTimeout(() => {
        setAlarmModal(null);
        setAlarmSuccess(false);
      }, 2000);
    } catch (err) {
      console.error('Error saving alarm:', err);
    } finally {
      setAlarmSending(false);
    }
  };

  const weekLabel = es
    ? `${monday.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })} — ${friday.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' })}`
    : `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${friday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <section id="earnings" className="py-20 px-4 border-t border-white/[0.04]">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/[0.08] border border-amber-500/20 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-medium text-amber-400 tracking-wide">
              {es ? 'Calendario en vivo' : 'Live Calendar'}
            </span>
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold mb-3">
            {es ? 'Earnings Calendar' : 'Earnings Calendar'}
          </h2>
          <p className="text-gray-500 max-w-xl mx-auto text-sm">
            {es
              ? 'Todos los reportes de ganancias de la semana. Estimados de analistas, resultados anteriores y alertas por email.'
              : 'All weekly earnings reports. Analyst estimates, previous results, and email alerts.'}
          </p>
        </div>

        {/* Week navigation */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition text-gray-400 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-200">{weekLabel}</span>
            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-[11px] px-2 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-gray-400 hover:text-white transition"
              >
                {es ? 'Hoy' : 'Today'}
              </button>
            )}
          </div>

          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition text-gray-400 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="flex justify-center py-16">
            <LogoLoader size="md" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {weekDays.map((day) => {
              const dateStr = fmtDate(day);
              const isToday = dateStr === todayStr;
              const dayEarnings = byDate[dateStr] || [];
              const displayEarnings = dayEarnings.slice(0, 12);
              const remaining = dayEarnings.length - displayEarnings.length;

              return (
                <div
                  key={dateStr}
                  className={`rounded-xl border p-3 min-h-[200px] flex flex-col transition-all ${
                    isToday
                      ? 'bg-amber-500/[0.06] border-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.08)]'
                      : 'bg-gray-900/40 border-white/[0.06]'
                  }`}
                >
                  {/* Day header */}
                  <div className={`flex items-center justify-between mb-3 pb-2 border-b ${isToday ? 'border-amber-500/20' : 'border-white/[0.06]'}`}>
                    <div>
                      <div className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-amber-400' : 'text-gray-500'}`}>
                        {fmtDateShort(day, locale)}
                      </div>
                      {isToday && (
                        <div className="text-[10px] text-amber-500/80 font-medium mt-0.5">
                          {es ? 'HOY' : 'TODAY'}
                        </div>
                      )}
                    </div>
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${isToday ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.04] text-gray-600'}`}>
                      {dayEarnings.length}
                    </span>
                  </div>

                  {/* Earnings list */}
                  <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[400px] pr-0.5 custom-scrollbar">
                    {displayEarnings.length === 0 ? (
                      <p className="text-gray-700 text-xs text-center py-6">
                        {es ? 'Sin reportes' : 'No reports'}
                      </p>
                    ) : (
                      displayEarnings.map((e) => {
                        const isBig = BIG_TICKERS.has(e.symbol);
                        const prev = prevQMap[e.symbol];
                        const hasAlarm = savedAlarms.has(`${e.symbol}_${e.date}`);

                        return (
                          <div
                            key={e.symbol}
                            className={`group rounded-lg border transition-all ${
                              isBig
                                ? 'bg-white/[0.04] border-white/[0.10] hover:border-white/[0.18] p-2.5'
                                : 'bg-white/[0.02] border-white/[0.05] hover:border-white/[0.10] p-2'
                            }`}
                          >
                            {/* Top row: logo + symbol + alarm */}
                            <div className="flex items-center justify-between mb-1.5">
                              <div
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={() => router.push(`/analizar?ticker=${e.symbol}`)}
                              >
                                <img
                                  src={FMP_IMG(e.symbol)}
                                  alt={e.symbol}
                                  className={`rounded-md object-contain bg-white/[0.06] ${isBig ? 'w-8 h-8' : 'w-6 h-6'}`}
                                  onError={(ev) => {
                                    (ev.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                                <span className={`font-bold tracking-tight ${isBig ? 'text-sm text-white' : 'text-xs text-gray-300'}`}>
                                  {e.symbol}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {/* Beat/Miss badge */}
                                {prev && prev.beat !== null && (
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                      prev.beat
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-red-500/20 text-red-400'
                                    }`}
                                    title={
                                      prev.beat
                                        ? `Prev Qt: Beat (${prev.epsActual} vs ${prev.epsEstimated} est.)`
                                        : `Prev Qt: Miss (${prev.epsActual} vs ${prev.epsEstimated} est.)`
                                    }
                                  >
                                    {prev.beat ? 'BEAT' : 'MISS'}
                                  </span>
                                )}

                                {/* Alarm button */}
                                <button
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    if (!hasAlarm) setAlarmModal(e);
                                  }}
                                  className={`p-1 rounded transition ${
                                    hasAlarm
                                      ? 'text-amber-400'
                                      : 'text-gray-600 hover:text-amber-400 opacity-0 group-hover:opacity-100'
                                  }`}
                                  title={hasAlarm ? (es ? 'Alarma activa' : 'Alarm active') : (es ? 'Poner alarma' : 'Set alarm')}
                                >
                                  <svg className="w-3.5 h-3.5" fill={hasAlarm ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {/* Estimates row */}
                            <div className="flex items-center gap-3 text-[10px]">
                              {e.epsEstimated != null && (
                                <div>
                                  <span className="text-gray-600">EPS Est: </span>
                                  <span className="text-gray-300 font-semibold font-mono">
                                    ${e.epsEstimated.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {e.revenueEstimated != null && (
                                <div>
                                  <span className="text-gray-600">Rev Est: </span>
                                  <span className="text-gray-300 font-semibold font-mono">
                                    {fmtRevenue(e.revenueEstimated)}
                                  </span>
                                </div>
                              )}
                              {e.epsEstimated == null && e.revenueEstimated == null && (
                                <span className="text-gray-700 italic">
                                  {es ? 'Sin estimados' : 'No estimates'}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}

                    {remaining > 0 && (
                      <div className="text-center text-[11px] text-gray-600 py-1">
                        +{remaining} {es ? 'más' : 'more'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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

                {/* Earnings info summary */}
                <div className="bg-white/[0.03] rounded-lg border border-white/[0.06] p-3 mb-5 flex items-center gap-4">
                  <img
                    src={FMP_IMG(alarmModal.symbol)}
                    alt={alarmModal.symbol}
                    className="w-12 h-12 rounded-lg bg-white/[0.06] object-contain"
                    onError={(ev) => {
                      (ev.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
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

                {/* Email input */}
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

                {/* Action buttons */}
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
    </section>
  );
}
