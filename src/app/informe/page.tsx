'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import Header from '@/app/components/Header';
import { useLanguage } from '@/i18n/LanguageContext';
import { postBackend, getBackend } from '@/lib/backendClient';

/* ------------------------------------------------------------------ */
/*  Types (mirror weekly_report_engine.py compose() output)            */
/* ------------------------------------------------------------------ */
interface DailyPoint { date: string; close: number; chg_pct: number }
interface IndexRow { symbol: string; label: string; ret_pct: number; close: number; daily: DailyPoint[] }
interface SectorRow { etf: string; label: string; ret_pct: number }
interface MoverRow { symbol: string; name: string; sector: string; ret_pct: number }
interface EarningsRow {
  symbol: string; name: string; sector: string; date: string; mktcap: number | null;
  eps_actual: number | null; eps_estimated: number | null; surprise_pct: number | null;
  reaction_pct: number | null; reaction_day: 'same_day' | 'next_day' | null;
}
interface FxRow { pair: string; label: string; close: number; ret_pct: number; usd_ret: number }
interface MacroRow { symbol: string; label: string; close: number; ret_pct: number; chg_bps?: number | null }
interface ThemeRow { id: string; label: string; count: number; avg_sentiment: number; impact: number }
interface StoryRow { title: string; site: string; url: string; date: string; sentiment: number; themes: string[] }
interface AnalystRow { id: string; name: string; score: number; confidence: number }
interface ProxyRow { id: string; label: string; value_pct: number }
interface KPI { id: string; label: string; value: string; delta?: string; tone: 'up' | 'down' | 'flat' }

interface BreadthStats {
  total: number; advancers?: number; decliners?: number; flat?: number;
  pct_up?: number; avg_ret?: number; median_ret?: number; index_ret?: number;
  concentration_gap?: number; pct_beat_index?: number;
  buckets?: { label: string; count: number }[];
}

interface ReportSection {
  id: string; title: string; paragraphs: string[];
  indices?: IndexRow[]; vix?: { level: number; chg_pct: number } | null;
  sectors?: SectorRow[]; cyc_def_spread?: number;
  stats?: any; winners?: MoverRow[]; losers?: MoverRow[];
  notables?: EarningsRow[];
  fx?: FxRow[]; macro?: MacroRow[]; usd_composite?: number;
  proxies?: ProxyRow[]; verdict?: string;
  themes?: ThemeRow[]; top_stories?: StoryRow[]; digestion?: string;
  analysts?: AnalystRow[]; consensus?: number; dispersion?: number;
  regime?: { id: string; label: string; description: string };
  divergences?: string[]; drivers?: string[];
}

interface WeeklyReport {
  meta: {
    week_start: string; week_end: string; label: string; language: string;
    generated_at: string; trading_days: number; engine_version: string;
    coverage: Record<string, any>; warnings: string[]; sources: string;
  };
  headline: string; dek: string;
  executive_summary: string[]; key_takeaways: string[];
  kpis: KPI[]; sections: ReportSection[];
}

interface JobStatus {
  job_id: string; status: 'queued' | 'running' | 'done' | 'error';
  progress: number; stage: string; error?: string | null; result?: WeeklyReport | null;
}

/* ------------------------------------------------------------------ */
/*  Week helpers (Monday–Friday, fully past weeks only)                */
/* ------------------------------------------------------------------ */
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function pastWeeks(count = 56): { monday: string; friday: string }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
  const out: { monday: string; friday: string }[] = [];
  for (let i = 1; i <= count + 1 && out.length < count; i++) {
    const m = new Date(thisMonday);
    m.setDate(thisMonday.getDate() - 7 * i);
    const f = new Date(m);
    f.setDate(m.getDate() + 4);
    if (f >= today) continue; // only fully finished weeks
    out.push({ monday: isoLocal(m), friday: isoLocal(f) });
  }
  return out;
}

function weekLabel(monday: string, friday: string, es: boolean): string {
  const loc = es ? 'es-ES' : 'en-US';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const m = new Date(`${monday}T12:00:00`);
  const f = new Date(`${friday}T12:00:00`);
  const my = f.getFullYear();
  return `${es ? 'Lun' : 'Mon'} ${m.toLocaleDateString(loc, opts)} — ${es ? 'Vie' : 'Fri'} ${f.toLocaleDateString(loc, opts)} ${my}`;
}

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                       */
/* ------------------------------------------------------------------ */
function Pct({ v, decimals = 1, className = '' }: { v: number | null | undefined; decimals?: number; className?: string }) {
  if (v == null) return <span className="text-gray-600">—</span>;
  const color = v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
  return (
    <span className={`font-mono font-semibold ${color} ${className}`}>
      {v > 0 ? '+' : ''}{v.toFixed(decimals)}%
    </span>
  );
}

function fmtMktCap(v: number | null): string {
  if (!v) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

/** Signed horizontal bar centered at zero — used for sectors, flows and council scores. */
function SignedBar({ value, max, height = 8 }: { value: number; max: number; height?: number }) {
  const pct = Math.min(Math.abs(value) / (max || 1), 1) * 50;
  const pos = value >= 0;
  return (
    <div className="relative w-full rounded-full bg-white/[0.05]" style={{ height }}>
      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/[0.15]" />
      <div
        className={`absolute top-0 bottom-0 rounded-full ${pos ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
        style={pos ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }}
      />
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-gray-900/40 p-5 sm:p-7">
      <h2 className="text-lg sm:text-xl font-bold text-white mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Paragraphs({ items }: { items: string[] }) {
  return (
    <div className="space-y-3 mb-5">
      {items.map((p, i) => (
        <p key={i} className="text-[15px] leading-relaxed text-gray-300">{p}</p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section renderers                                                  */
/* ------------------------------------------------------------------ */
function OverviewSection({ s, es }: { s: ReportSection; es: boolean }) {
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-gray-500 text-xs uppercase tracking-wider">
              <th className="text-left py-2 pr-3">{es ? 'Índice' : 'Index'}</th>
              <th className="text-right py-2 px-3">{es ? 'Semana' : 'Week'}</th>
              <th className="text-right py-2 px-3">{es ? 'Cierre' : 'Close'}</th>
              <th className="text-left py-2 pl-3 hidden sm:table-cell">{es ? 'Día a día' : 'Day by day'}</th>
            </tr>
          </thead>
          <tbody>
            {(s.indices ?? []).map((ix) => (
              <tr key={ix.symbol} className="border-b border-white/[0.04]">
                <td className="py-2.5 pr-3 text-gray-200 font-medium">{ix.label}</td>
                <td className="py-2.5 px-3 text-right"><Pct v={ix.ret_pct} /></td>
                <td className="py-2.5 px-3 text-right font-mono text-gray-400">
                  {ix.close.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </td>
                <td className="py-2.5 pl-3 hidden sm:table-cell">
                  <div className="flex items-center gap-1.5">
                    {ix.daily.map((d) => (
                      <span
                        key={d.date}
                        title={`${d.date}: ${d.chg_pct > 0 ? '+' : ''}${d.chg_pct.toFixed(2)}%`}
                        className={`inline-block w-6 text-center text-[10px] font-mono rounded py-0.5 ${
                          d.chg_pct > 0.05 ? 'bg-emerald-500/15 text-emerald-400'
                          : d.chg_pct < -0.05 ? 'bg-red-500/15 text-red-400'
                          : 'bg-white/[0.05] text-gray-500'
                        }`}
                      >
                        {d.chg_pct > 0 ? '+' : d.chg_pct < 0 ? '−' : '·'}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.vix && (
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-xs text-gray-400">
          VIX <span className="font-mono font-bold text-gray-200">{s.vix.level.toFixed(1)}</span>
          <Pct v={s.vix.chg_pct} className="text-xs" />
        </div>
      )}
    </SectionCard>
  );
}

function SectorsSection({ s }: { s: ReportSection; es: boolean }) {
  const sectors = s.sectors ?? [];
  const max = Math.max(...sectors.map((x) => Math.abs(x.ret_pct)), 0.1);
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      <div className="space-y-2">
        {sectors.map((sec) => (
          <div key={sec.etf} className="grid grid-cols-[minmax(110px,180px)_1fr_64px] items-center gap-3">
            <span className="text-[13px] text-gray-300 truncate">
              {sec.label} <span className="text-gray-600 text-[11px] font-mono">{sec.etf}</span>
            </span>
            <SignedBar value={sec.ret_pct} max={max} />
            <span className="text-right"><Pct v={sec.ret_pct} className="text-[13px]" /></span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function BreadthSection({ s, es }: { s: ReportSection; es: boolean }) {
  const st: BreadthStats = s.stats ?? { total: 0 };
  const maxBucket = Math.max(...(st.buckets ?? []).map((b) => b.count), 1);
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      {st.total > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { l: es ? 'Suben' : 'Advancers', v: String(st.advancers ?? '—'), c: 'text-emerald-400' },
              { l: es ? 'Bajan' : 'Decliners', v: String(st.decliners ?? '—'), c: 'text-red-400' },
              { l: es ? 'Prom. componente' : 'Avg member', v: `${(st.avg_ret ?? 0) > 0 ? '+' : ''}${st.avg_ret?.toFixed(2)}%`, c: 'text-gray-200' },
              { l: es ? 'Índice' : 'Index', v: `${(st.index_ret ?? 0) > 0 ? '+' : ''}${st.index_ret?.toFixed(2)}%`, c: 'text-gray-200' },
            ].map((k) => (
              <div key={k.l} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
                <div className={`text-xl font-black font-mono ${k.c}`}>{k.v}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{k.l}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            {es ? 'Distribución de retornos semanales (S&P 500)' : 'Weekly return distribution (S&P 500)'}
          </div>
          <div className="flex items-end gap-2 h-28">
            {(st.buckets ?? []).map((b, i) => (
              <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                <span className="text-[10px] font-mono text-gray-400">{b.count}</span>
                <div
                  className={`w-full rounded-t ${i < 3 ? 'bg-red-500/50' : 'bg-emerald-500/50'}`}
                  style={{ height: `${Math.max((b.count / maxBucket) * 100, 2)}%` }}
                />
                <span className="text-[9px] text-gray-600 whitespace-nowrap">{b.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

function MoversSection({ s, es }: { s: ReportSection; es: boolean }) {
  const Table = ({ rows, title, positive }: { rows: MoverRow[]; title: string; positive: boolean }) => (
    <div className="flex-1 min-w-0">
      <div className={`text-xs font-bold uppercase tracking-wider mb-2 ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((m, i) => (
              <tr key={m.symbol} className="border-b border-white/[0.04]">
                <td className="py-2 pr-2 text-gray-600 font-mono text-xs w-5">{i + 1}</td>
                <td className="py-2 pr-3">
                  <span className="text-white font-semibold">{m.symbol}</span>
                  <span className="block text-[11px] text-gray-500 truncate max-w-[180px]">{m.name}</span>
                </td>
                <td className="py-2 pr-3 text-[11px] text-gray-500 hidden md:table-cell">{m.sector}</td>
                <td className="py-2 text-right"><Pct v={m.ret_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      <div className="flex flex-col lg:flex-row gap-8">
        <Table rows={s.winners ?? []} title={es ? 'Mayores subas' : 'Top gainers'} positive />
        <Table rows={s.losers ?? []} title={es ? 'Mayores bajas' : 'Top losers'} positive={false} />
      </div>
    </SectionCard>
  );
}

function EarningsSection({ s, es }: { s: ReportSection; es: boolean }) {
  const st = s.stats ?? {};
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      {(s.notables ?? []).length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { l: es ? 'Reportes S&P 500' : 'S&P 500 prints', v: st.sp_count },
              { l: 'Beats', v: st.beats },
              { l: 'Misses', v: st.misses },
              { l: es ? 'Tasa de beats' : 'Beat rate', v: st.beat_rate != null ? `${st.beat_rate}%` : '—' },
              { l: es ? 'Reacción media' : 'Avg reaction', v: st.avg_reaction != null ? `${st.avg_reaction > 0 ? '+' : ''}${st.avg_reaction}%` : '—' },
            ].map((c) => (
              <span key={c.l} className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] text-xs text-gray-400">
                {c.l}: <span className="text-gray-200 font-semibold font-mono">{c.v ?? '—'}</span>
              </span>
            ))}
          </div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            {es ? 'Reportes destacados (por capitalización)' : 'Notable reports (by market cap)'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-gray-500 text-xs uppercase tracking-wider">
                  <th className="text-left py-2 pr-3">{es ? 'Empresa' : 'Company'}</th>
                  <th className="text-right py-2 px-2">{es ? 'Cap.' : 'Mkt cap'}</th>
                  <th className="text-right py-2 px-2">{es ? 'Fecha' : 'Date'}</th>
                  <th className="text-right py-2 px-2">EPS</th>
                  <th className="text-right py-2 px-2">{es ? 'Estimado' : 'Estimate'}</th>
                  <th className="text-right py-2 px-2">{es ? 'Sorpresa' : 'Surprise'}</th>
                  <th className="text-right py-2 pl-2">{es ? 'Reacción' : 'Reaction'}</th>
                </tr>
              </thead>
              <tbody>
                {(s.notables ?? []).map((r) => (
                  <tr key={`${r.symbol}-${r.date}`} className="border-b border-white/[0.04]">
                    <td className="py-2 pr-3">
                      <span className="text-white font-semibold">{r.symbol}</span>
                      <span className="block text-[11px] text-gray-500 truncate max-w-[170px]">{r.name}</span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-400">{fmtMktCap(r.mktcap)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500 text-xs">{r.date?.slice(5)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-200">
                      {r.eps_actual != null ? `$${r.eps_actual.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-gray-500">
                      {r.eps_estimated != null ? `$${r.eps_estimated.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2 px-2 text-right"><Pct v={r.surprise_pct} /></td>
                    <td className="py-2 pl-2 text-right">
                      <Pct v={r.reaction_pct} />
                      {r.reaction_day && (
                        <span className="block text-[9px] text-gray-600">
                          {r.reaction_day === 'same_day' ? (es ? 'mismo día' : 'same day') : (es ? 'día sig.' : 'next day')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function CurrenciesSection({ s, es }: { s: ReportSection; es: boolean }) {
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="overflow-x-auto">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{es ? 'Divisas' : 'Currencies'}</div>
          <table className="w-full text-sm">
            <tbody>
              {(s.fx ?? []).map((f) => (
                <tr key={f.pair} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3">
                    <span className="text-gray-200">{f.label}</span>
                    <span className="ml-2 text-[10px] text-gray-600 font-mono">{f.pair}</span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-gray-400">{f.close.toFixed(4)}</td>
                  <td className="py-2 pl-2 text-right"><Pct v={f.ret_pct} decimals={2} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Macro</div>
          <table className="w-full text-sm">
            <tbody>
              {(s.macro ?? []).map((m) => (
                <tr key={m.symbol} className="border-b border-white/[0.04]">
                  <td className="py-2 pr-3 text-gray-200">{m.label}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-400">
                    {m.close.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    {m.chg_bps != null
                      ? <span className={`font-mono font-semibold ${m.chg_bps > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{m.chg_bps > 0 ? '+' : ''}{m.chg_bps.toFixed(0)} bps</span>
                      : <Pct v={m.ret_pct} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

function FlowsSection({ s }: { s: ReportSection; es: boolean }) {
  const proxies = s.proxies ?? [];
  const max = Math.max(...proxies.map((p) => Math.abs(p.value_pct)), 0.1);
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      <div className="space-y-2.5">
        {proxies.map((p) => (
          <div key={p.id} className="grid grid-cols-[minmax(150px,260px)_1fr_64px] items-center gap-3">
            <span className="text-[13px] text-gray-300 truncate">{p.label}</span>
            <SignedBar value={p.value_pct} max={max} />
            <span className="text-right"><Pct v={p.value_pct} className="text-[13px]" /></span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function NewsSection({ s, es }: { s: ReportSection; es: boolean }) {
  return (
    <SectionCard title={s.title}>
      <Paragraphs items={s.paragraphs} />
      {(s.themes ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {(s.themes ?? []).map((t) => (
            <span
              key={t.id}
              className={`px-3 py-1.5 rounded-full text-xs border ${
                t.avg_sentiment > 0.1 ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300'
                : t.avg_sentiment < -0.1 ? 'border-red-500/25 bg-red-500/[0.06] text-red-300'
                : 'border-white/[0.08] bg-white/[0.03] text-gray-400'
              }`}
            >
              {t.label} <span className="opacity-60 font-mono">×{t.count}</span>
            </span>
          ))}
        </div>
      )}
      {(s.top_stories ?? []).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            {es ? 'Titulares destacados' : 'Notable headlines'}
          </div>
          {(s.top_stories ?? []).map((n, i) => (
            <a
              key={i}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-3 py-2 rounded-lg hover:bg-white/[0.03] border border-transparent hover:border-white/[0.06] transition"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                  n.sentiment > 0.1 ? 'bg-emerald-400' : n.sentiment < -0.1 ? 'bg-red-400' : 'bg-gray-500'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm text-gray-300 leading-snug">{n.title}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">{n.site} · {n.date}</p>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SynthesisSection({ s, es }: { s: ReportSection; es: boolean }) {
  const analysts = s.analysts ?? [];
  return (
    <SectionCard title={s.title}>
      {s.regime && (
        <div className="mb-5 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] p-4">
          <div className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1">
            {es ? 'Régimen de la semana' : 'Weekly regime'}
          </div>
          <div className="text-lg font-bold text-white">{s.regime.label}</div>
          <p className="text-sm text-gray-400 mt-1">{s.regime.description}</p>
        </div>
      )}
      <Paragraphs items={s.paragraphs} />
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">
            {es ? 'Consejo de analistas neuronales' : 'Neural analyst council'}
          </div>
          <div className="space-y-2.5">
            {analysts.map((a) => (
              <div key={a.id} className="grid grid-cols-[minmax(130px,190px)_1fr_50px] items-center gap-3">
                <span className="text-[13px] text-gray-300 truncate" title={`${es ? 'confianza' : 'confidence'} ${(a.confidence * 100).toFixed(0)}%`}>
                  {a.name}
                </span>
                <SignedBar value={a.score} max={100} />
                <span className={`text-right font-mono text-[13px] font-semibold ${a.score > 10 ? 'text-emerald-400' : a.score < -10 ? 'text-red-400' : 'text-gray-400'}`}>
                  {a.score > 0 ? '+' : ''}{a.score.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
          {s.consensus != null && (
            <div className="mt-4 text-sm text-gray-400">
              {es ? 'Consenso' : 'Consensus'}:{' '}
              <span className={`font-mono font-bold ${s.consensus > 10 ? 'text-emerald-400' : s.consensus < -10 ? 'text-red-400' : 'text-gray-200'}`}>
                {s.consensus > 0 ? '+' : ''}{s.consensus.toFixed(0)}
              </span>
              <span className="text-gray-600"> / ±100 · {es ? 'dispersión' : 'dispersion'} {s.dispersion?.toFixed(0)}</span>
            </div>
          )}
        </div>
        <div className="space-y-5">
          {(s.divergences ?? []).length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                {es ? 'Divergencias detectadas' : 'Detected divergences'}
              </div>
              <ul className="space-y-2">
                {(s.divergences ?? []).map((d, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-gray-300">
                    <span className="text-amber-400 shrink-0 mt-0.5">⚠</span>
                    <span className="leading-snug">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(s.drivers ?? []).length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                {es ? 'Motores de la semana' : 'Drivers of the week'}
              </div>
              <ol className="space-y-2">
                {(s.drivers ?? []).map((d, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-gray-300">
                    <span className="text-gray-600 font-mono shrink-0">{i + 1}.</span>
                    <span className="leading-snug">{d}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function InformePage() {
  const { user, isLoaded } = useUser();
  const isGodMode = (user?.publicMetadata?.plan as string) === 'godmode';
  const { locale } = useLanguage();
  const es = locale === 'es';

  const weeks = useMemo(() => pastWeeks(56), []);
  const [selectedWeek, setSelectedWeek] = useState('');
  const [job, setJob] = useState<JobStatus | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!selectedWeek && weeks.length) setSelectedWeek(weeks[0].monday);
  }, [weeks, selectedWeek]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPolling(), [stopPolling]);

  const generate = useCallback(async () => {
    if (!selectedWeek) return;
    setError(''); setReport(null); setJob(null); setRunning(true);
    stopPolling();
    try {
      const { job_id } = await postBackend<{ job_id: string }>(
        '/report/weekly/start',
        { week_start: selectedWeek, language: locale },
        15000,
      );
      pollRef.current = setInterval(async () => {
        try {
          const snap = await getBackend<JobStatus>(`/report/weekly/status/${job_id}`, 15000);
          setJob(snap);
          if (snap.status === 'done') {
            stopPolling(); setRunning(false);
            setReport(snap.result ?? null);
          } else if (snap.status === 'error') {
            stopPolling(); setRunning(false);
            setError(snap.error || (es ? 'Error generando el informe' : 'Error generating the report'));
          }
        } catch (e: any) {
          stopPolling(); setRunning(false);
          setError(e?.message || (es ? 'Error consultando el estado del informe' : 'Error polling the report status'));
        }
      }, 2000);
    } catch (e: any) {
      setRunning(false);
      setError(e?.message || (es ? 'No se pudo iniciar el informe' : 'Could not start the report'));
    }
  }, [selectedWeek, locale, es, stopPolling]);

  const downloadJSON = useCallback(() => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `informe-semanal-${report.meta.week_start}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  /* ---- Gating (same pattern as /backtest) ---- */
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-gray-950"><Header />
        <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-400">
          {es ? 'Cargando…' : 'Loading…'}
        </div>
      </div>
    );
  }
  if (!isGodMode) {
    return (
      <div className="min-h-screen bg-gray-950"><Header />
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-bold uppercase tracking-wider mb-4">
            God Mode
          </div>
          <h1 className="text-3xl font-black text-white mb-3">{es ? 'Informe Semanal' : 'Weekly Report'}</h1>
          <p className="text-gray-400">
            {es ? 'Esta herramienta está disponible únicamente para cuentas ' : 'This tool is available only for '}
            <span className="text-rose-300 font-semibold">God Mode</span>
            {es ? '.' : ' accounts.'}
          </p>
          <Link href="/" className="inline-block mt-6 px-5 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 font-semibold hover:bg-rose-500/30 transition">
            {es ? 'Volver al inicio' : 'Back to home'}
          </Link>
        </div>
      </div>
    );
  }

  const sectionRenderers: Record<string, (s: ReportSection) => React.ReactNode> = {
    overview: (s) => <OverviewSection s={s} es={es} />,
    sectors: (s) => <SectorsSection s={s} es={es} />,
    breadth: (s) => <BreadthSection s={s} es={es} />,
    movers: (s) => <MoversSection s={s} es={es} />,
    earnings: (s) => <EarningsSection s={s} es={es} />,
    currencies: (s) => <CurrenciesSection s={s} es={es} />,
    flows: (s) => <FlowsSection s={s} es={es} />,
    news: (s) => <NewsSection s={s} es={es} />,
    synthesis: (s) => <SynthesisSection s={s} es={es} />,
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-24 pb-16">
        {/* Heading */}
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl sm:text-3xl font-black text-rose-300">
            {es ? 'Informe Semanal' : 'Weekly Report'}
          </h1>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 uppercase tracking-wider">
            God Mode
          </span>
        </div>
        <p className="text-gray-400 text-sm mb-8 max-w-3xl">
          {es
            ? 'Informe institucional de una semana pasada del mercado: índices, rotación sectorial, amplitud real del S&P 500, earnings, divisas, flujos y una síntesis cruzada de analistas neuronales.'
            : 'Institutional review of a past market week: indices, sector rotation, true S&P 500 breadth, earnings, currencies, flows and a cross-signal synthesis by neural analysts.'}
        </p>

        {/* Week selector + run */}
        <div className="rounded-2xl border border-rose-500/15 bg-gray-900/40 p-5 sm:p-6 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
                {es ? 'Semana a analizar (lunes a viernes)' : 'Week to analyze (Monday to Friday)'}
              </label>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                disabled={running}
                className="w-full px-4 py-2.5 bg-gray-950 border border-white/[0.1] rounded-xl text-sm text-gray-200 focus:outline-none focus:border-rose-500/40"
              >
                {weeks.map((w, i) => (
                  <option key={w.monday} value={w.monday}>
                    {weekLabel(w.monday, w.friday, es)}
                    {i === 0 ? (es ? '  ·  (semana pasada)' : '  ·  (last week)') : ''}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={generate}
              disabled={running || !selectedWeek}
              className="px-6 py-2.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-200 font-bold text-sm hover:bg-rose-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {running ? (es ? 'Generando…' : 'Generating…') : (es ? 'Crear informe' : 'Create report')}
            </button>
          </div>

          {/* Progress */}
          {running && (
            <div className="mt-5">
              <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                <span>{job?.stage || (es ? 'Iniciando…' : 'Starting…')}</span>
                <span className="font-mono">{job?.progress ?? 0}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-rose-500/70 transition-all duration-700"
                  style={{ width: `${job?.progress ?? 2}%` }}
                />
              </div>
            </div>
          )}
          {error && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* ---- Report ---- */}
        {report && (
          <article className="space-y-6">
            {/* Masthead */}
            <div className="rounded-2xl border border-white/[0.08] bg-gray-900/50 p-6 sm:p-9">
              <div className="flex items-center justify-between gap-4 mb-5">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
                  {es ? 'Informe semanal de mercado' : 'Weekly market report'}
                </span>
                <button
                  onClick={downloadJSON}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:text-gray-200 transition"
                >
                  JSON ↓
                </button>
              </div>
              <div className="text-xs text-gray-500 mb-2">{report.meta.label}</div>
              <h2 className="text-2xl sm:text-4xl font-black text-white leading-tight tracking-tight mb-3">
                {report.headline}
              </h2>
              <p className="text-base text-gray-400 leading-relaxed max-w-3xl">{report.dek}</p>

              {/* KPI strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-7">
                {report.kpis.map((k) => (
                  <div key={k.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{k.label}</div>
                    <div className={`text-sm font-bold font-mono mt-0.5 truncate ${
                      k.tone === 'up' ? 'text-emerald-400' : k.tone === 'down' ? 'text-red-400' : 'text-gray-200'
                    }`}>
                      {k.value}
                    </div>
                    {k.delta && <div className="text-[10px] text-gray-500 font-mono">{k.delta}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Executive summary */}
            <div className="rounded-2xl border border-white/[0.07] bg-gray-900/40 p-5 sm:p-7">
              <h2 className="text-lg sm:text-xl font-bold text-white mb-4 tracking-tight">
                {es ? 'Resumen ejecutivo' : 'Executive summary'}
              </h2>
              <div className="space-y-3 mb-6">
                {report.executive_summary.map((p, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-gray-300">{p}</p>
                ))}
              </div>
              <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
                {report.key_takeaways.map((t, i) => (
                  <div key={i} className="flex gap-2.5 text-sm text-gray-400">
                    <span className="text-rose-400 shrink-0">▸</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sections */}
            {report.sections.map((s) => (
              <div key={s.id}>
                {sectionRenderers[s.id]
                  ? sectionRenderers[s.id](s)
                  : (
                    <SectionCard title={s.title}>
                      <Paragraphs items={s.paragraphs} />
                    </SectionCard>
                  )}
              </div>
            ))}

            {/* Footer: coverage, warnings, sources */}
            <div className="rounded-2xl border border-white/[0.06] bg-gray-900/30 p-5 text-xs text-gray-600 space-y-2">
              {report.meta.warnings?.length > 0 && (
                <div className="text-amber-500/80">
                  {report.meta.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                </div>
              )}
              <p>
                {es ? 'Cobertura' : 'Coverage'}: {report.meta.coverage.sp500_members_with_data} S&P 500 ·{' '}
                {report.meta.coverage.earnings_reports_sp500} earnings ·{' '}
                {report.meta.coverage.news_headlines} {es ? 'titulares' : 'headlines'} ·{' '}
                {report.meta.coverage.fx_pairs} FX · NLP: {report.meta.coverage.nlp_engine}
              </p>
              <p>{report.meta.sources}</p>
              <p>
                {es ? 'Generado' : 'Generated'}: {new Date(report.meta.generated_at).toLocaleString(es ? 'es-ES' : 'en-US')} ·
                Engine v{report.meta.engine_version}
              </p>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
