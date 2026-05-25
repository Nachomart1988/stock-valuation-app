// src/app/components/tabs/EarningsTranscriptsTab.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { LogoLoader } from '@/app/components/ui/LogoLoader';
import { fetchFmp } from '@/lib/fmpClient';

interface EarningsTranscriptsTabProps {
  ticker: string;
}

interface AvailableTranscript {
  year: number;
  quarter: number;
  date?: string;
}

interface TranscriptContent {
  symbol: string;
  quarter: number;
  year: number;
  date: string;
  content: string;
}

// Normalize one row from the FMP list endpoints. Several shapes exist depending
// on the API version / plan tier:
//   • stable/earning-call-transcript-dates → { symbol, period: "Q4", fiscalYear: 2024, date }
//   • api/v4/earning_call_transcript        → [quarter, year, date]
//   • api/v3 batch endpoints                → { symbol, quarter, year, date }
function normalizeListRow(row: any): AvailableTranscript | null {
  if (!row) return null;

  if (Array.isArray(row)) {
    const [q, y, d] = row;
    if (typeof q === 'number' && typeof y === 'number') {
      return { quarter: q, year: y, date: typeof d === 'string' ? d : undefined };
    }
    return null;
  }

  if (typeof row === 'object') {
    // Quarter can be 1..4 OR a string like "Q4"
    let q: number | null = null;
    const rawQ = row.quarter ?? row.q ?? row.period;
    if (typeof rawQ === 'number' && Number.isFinite(rawQ)) {
      q = rawQ;
    } else if (typeof rawQ === 'string') {
      const m = rawQ.match(/Q?(\d)/i);
      if (m) q = Number(m[1]);
    }

    const rawY = row.year ?? row.fiscalYear ?? row.y;
    const y = Number(rawY);

    if (q !== null && Number.isFinite(y)) {
      return { quarter: q, year: y, date: typeof row.date === 'string' ? row.date : undefined };
    }
  }

  return null;
}

function splitTranscriptByParagraphs(content: string): string[] {
  if (!content) return [];
  const chunks = content.includes('\n\n')
    ? content.split(/\n\n+/)
    : content.split(/\n+/);
  return chunks.map(c => c.trim()).filter(Boolean);
}

function extractSpeaker(paragraph: string): { speaker: string | null; body: string } {
  // Common FMP format: "Tim Cook -- Chief Executive Officer\nThanks, ..."
  const dashMatch = paragraph.match(/^([^\n]{2,80}?)\s+--\s+([^\n]{2,120})\n([\s\S]*)$/);
  if (dashMatch) {
    return { speaker: `${dashMatch[1]} — ${dashMatch[2]}`, body: dashMatch[3].trim() };
  }
  const colonMatch = paragraph.match(/^([A-Z][^\n:]{1,80}):\s+([\s\S]*)$/);
  if (colonMatch && colonMatch[1].split(' ').length <= 6) {
    return { speaker: colonMatch[1], body: colonMatch[2].trim() };
  }
  return { speaker: null, body: paragraph };
}

// Try multiple FMP endpoint variants for listing transcripts. Returns the first
// non-empty response, or [] if all fail (caller falls back to a generic range).
async function loadTranscriptList(ticker: string): Promise<AvailableTranscript[]> {
  const attempts: Array<{ path: string; params?: Record<string, string | number> }> = [
    { path: 'stable/earning-call-transcript-dates', params: { symbol: ticker } },
    { path: 'api/v4/earning_call_transcript', params: { symbol: ticker } },
  ];

  for (const a of attempts) {
    try {
      const raw = await fetchFmp(a.path, a.params);
      const normalized = (Array.isArray(raw) ? raw : [])
        .map(normalizeListRow)
        .filter((r): r is AvailableTranscript => r !== null);
      if (normalized.length > 0) return normalized;
    } catch (err) {
      // Try next variant on 403 / 404 / network error
      console.warn(`[EarningsTranscripts] List attempt failed for ${a.path}:`, (err as Error)?.message);
    }
  }
  return [];
}

// Try stable first, fall back to v3. Returns null if no content is available.
async function loadTranscriptContent(
  ticker: string,
  year: number,
  quarter: number
): Promise<TranscriptContent | null> {
  const attempts: Array<{ path: string; params: Record<string, string | number> }> = [
    { path: 'stable/earning-call-transcript', params: { symbol: ticker, year, quarter } },
    { path: `api/v3/earning_call_transcript/${ticker}`, params: { year, quarter } },
  ];

  let lastError: Error | null = null;
  for (const a of attempts) {
    try {
      const raw = await fetchFmp(a.path, a.params);
      const item = Array.isArray(raw) ? raw[0] : raw;
      if (item && typeof item.content === 'string' && item.content.trim().length > 0) {
        return {
          symbol: item.symbol ?? ticker,
          quarter: Number(item.quarter ?? quarter),
          year: Number(item.year ?? year),
          date: item.date ?? '',
          content: item.content,
        };
      }
    } catch (err) {
      lastError = err as Error;
      console.warn(`[EarningsTranscripts] Content attempt failed for ${a.path}:`, lastError?.message);
    }
  }

  if (lastError) throw lastError;
  return null;
}

// Generate a generic year/quarter grid for when the list endpoint isn't accessible
// (e.g. FMP plan doesn't include the dates endpoint). We only show quarters that
// could plausibly have already been reported.
function buildFallbackRange(): AvailableTranscript[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1..12
  const rows: AvailableTranscript[] = [];

  // 6 years back × 4 quarters
  for (let y = currentYear; y >= currentYear - 5; y--) {
    for (let q = 4; q >= 1; q--) {
      if (y === currentYear) {
        // Earnings for Qn are usually reported ~1 month after the quarter ends
        // Q1 ends Mar → reported Apr, Q2 ends Jun → reported Jul, etc.
        const reportMonth = q * 3 + 1;
        if (currentMonth < reportMonth) continue;
      }
      rows.push({ year: y, quarter: q });
    }
  }
  return rows;
}

export default function EarningsTranscriptsTab({ ticker }: EarningsTranscriptsTabProps) {
  const [available, setAvailable] = useState<AvailableTranscript[]>([]);
  const [usingFallbackRange, setUsingFallbackRange] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<number | null>(null);

  const [transcript, setTranscript] = useState<TranscriptContent | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Step 1: load list (with fallback to a generic year/quarter grid).
  useEffect(() => {
    let cancelled = false;

    const loadList = async () => {
      if (!ticker) return;
      setLoadingList(true);
      setAvailable([]);
      setSelectedYear(null);
      setSelectedQuarter(null);
      setTranscript(null);
      setTranscriptError(null);

      const fromApi = await loadTranscriptList(ticker);
      if (cancelled) return;

      let rows = fromApi;
      let fallback = false;
      if (rows.length === 0) {
        rows = buildFallbackRange();
        fallback = true;
      }

      // Newest first
      rows.sort((a, b) => (b.year - a.year) || (b.quarter - a.quarter));

      setAvailable(rows);
      setUsingFallbackRange(fallback);
      if (rows.length > 0) {
        setSelectedYear(rows[0].year);
        setSelectedQuarter(rows[0].quarter);
      }
      setLoadingList(false);
    };

    loadList();
    return () => { cancelled = true; };
  }, [ticker]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const a of available) set.add(a.year);
    return [...set].sort((a, b) => b - a);
  }, [available]);

  const quartersForYear = useMemo(() => {
    if (selectedYear === null) return [];
    return available
      .filter(a => a.year === selectedYear)
      .map(a => a.quarter)
      .sort((a, b) => a - b);
  }, [available, selectedYear]);

  // If the selected quarter is not valid for the chosen year, snap to the latest available.
  useEffect(() => {
    if (selectedYear === null) return;
    if (quartersForYear.length === 0) {
      setSelectedQuarter(null);
      return;
    }
    if (selectedQuarter === null || !quartersForYear.includes(selectedQuarter)) {
      setSelectedQuarter(quartersForYear[quartersForYear.length - 1]);
    }
  }, [selectedYear, quartersForYear, selectedQuarter]);

  // Step 2: fetch content whenever selection changes.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!ticker || selectedYear === null || selectedQuarter === null) return;
      setLoadingTranscript(true);
      setTranscriptError(null);
      setTranscript(null);

      try {
        const content = await loadTranscriptContent(ticker, selectedYear, selectedQuarter);
        if (cancelled) return;
        if (!content) {
          setTranscriptError('No hay transcript disponible para este trimestre.');
        } else {
          setTranscript(content);
        }
      } catch (err: any) {
        if (cancelled) return;
        const msg = String(err?.message || '');
        if (msg.includes(' 403')) {
          setTranscriptError('Tu plan de FMP no incluye acceso a earnings transcripts.');
        } else if (msg.includes(' 404')) {
          setTranscriptError('No hay transcript disponible para este trimestre.');
        } else {
          setTranscriptError(msg || 'No se pudo cargar el transcript');
        }
      } finally {
        if (!cancelled) setLoadingTranscript(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [ticker, selectedYear, selectedQuarter]);

  const paragraphs = useMemo(
    () => (transcript ? splitTranscriptByParagraphs(transcript.content) : []),
    [transcript]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-2xl font-bold text-emerald-400">Earnings Transcripts</h3>
          <p className="text-sm text-gray-500 mt-1">
            Transcripts de earnings calls de <span className="text-gray-300 font-semibold">{ticker}</span>.
            Elegí el año y trimestre.
          </p>
        </div>
      </div>

      {loadingList ? (
        <div className="flex justify-center py-16">
          <LogoLoader size="md" message="Cargando transcripts disponibles..." />
        </div>
      ) : (
        <>
          {usingFallbackRange && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-amber-200/70 text-xs">
              No se pudo obtener la lista oficial de transcripts (puede que tu plan FMP no la exponga).
              Mostramos un rango genérico — algunos trimestres pueden no tener transcript.
            </div>
          )}

          {/* Selectors */}
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Año</label>
              <select
                value={selectedYear ?? ''}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-black/60 border border-emerald-900/40 hover:border-emerald-700/60 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition min-w-[110px]"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Trimestre</label>
              <select
                value={selectedQuarter ?? ''}
                onChange={(e) => setSelectedQuarter(Number(e.target.value))}
                className="bg-black/60 border border-emerald-900/40 hover:border-emerald-700/60 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition min-w-[110px]"
              >
                {quartersForYear.map(q => (
                  <option key={q} value={q}>Q{q}</option>
                ))}
              </select>
            </div>
            {transcript?.date && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Fecha de la call</label>
                <div className="bg-black/40 border border-white/[0.06] text-gray-300 rounded-lg px-3 py-2 text-sm">
                  {new Date(transcript.date).toLocaleDateString('es-ES', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          {loadingTranscript ? (
            <div className="flex justify-center py-20">
              <LogoLoader size="md" message={`Cargando ${ticker} Q${selectedQuarter} ${selectedYear}...`} />
            </div>
          ) : transcriptError ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-amber-200/80 text-sm">
              {transcriptError}
            </div>
          ) : transcript ? (
            <div className="rounded-2xl bg-black/40 border border-white/[0.06] p-5 sm:p-8 shadow-inner">
              <div className="flex flex-wrap items-baseline gap-3 mb-6 pb-4 border-b border-white/[0.06]">
                <h4 className="text-xl font-bold text-gray-100">
                  {transcript.symbol} · Q{transcript.quarter} {transcript.year}
                </h4>
                <span className="text-xs text-gray-500">Earnings Call Transcript</span>
              </div>
              <div className="space-y-5 text-[15px] leading-relaxed text-gray-300 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                {paragraphs.map((p, i) => {
                  const { speaker, body } = extractSpeaker(p);
                  return (
                    <div key={i}>
                      {speaker && (
                        <div className="text-emerald-400 font-semibold text-sm mb-1.5 tracking-wide">
                          {speaker}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
