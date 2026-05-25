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

// FMP's v4 list endpoint returns rows shaped as [quarter, year, date] tuples
// OR as objects {symbol, quarter, year, date}. Normalize both.
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
    const q = Number(row.quarter ?? row.q);
    const y = Number(row.year ?? row.y);
    if (Number.isFinite(q) && Number.isFinite(y)) {
      return { quarter: q, year: y, date: row.date };
    }
  }
  return null;
}

// Heuristic speaker-detection so the transcript reads as a dialog instead of a wall of text.
// FMP returns the content as a single string with patterns like "John Doe -- CFO\n...".
function splitTranscriptByParagraphs(content: string): string[] {
  if (!content) return [];
  // FMP usually separates speaker turns with double newlines. Fall back to single \n.
  const chunks = content.includes('\n\n')
    ? content.split(/\n\n+/)
    : content.split(/\n+/);
  return chunks.map(c => c.trim()).filter(Boolean);
}

function extractSpeaker(paragraph: string): { speaker: string | null; body: string } {
  // Common FMP format: "Tim Cook -- Chief Executive Officer\nThanks, ..."
  // Or inline: "Operator: Thank you..."
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

export default function EarningsTranscriptsTab({ ticker }: EarningsTranscriptsTabProps) {
  const [available, setAvailable] = useState<AvailableTranscript[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<number | null>(null);

  const [transcript, setTranscript] = useState<TranscriptContent | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // Step 1: load the list of available year/quarter pairs for the ticker.
  useEffect(() => {
    let cancelled = false;

    const loadList = async () => {
      if (!ticker) return;
      setLoadingList(true);
      setListError(null);
      setAvailable([]);
      setSelectedYear(null);
      setSelectedQuarter(null);
      setTranscript(null);
      setTranscriptError(null);

      try {
        const raw = await fetchFmp('api/v4/earning_call_transcript', { symbol: ticker });
        if (cancelled) return;

        const normalized = (Array.isArray(raw) ? raw : [])
          .map(normalizeListRow)
          .filter((r): r is AvailableTranscript => r !== null)
          // newest first
          .sort((a, b) => (b.year - a.year) || (b.quarter - a.quarter));

        setAvailable(normalized);
        if (normalized.length > 0) {
          setSelectedYear(normalized[0].year);
          setSelectedQuarter(normalized[0].quarter);
        }
      } catch (err: any) {
        if (!cancelled) {
          setListError(err?.message || 'No se pudo obtener la lista de transcripts');
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    };

    loadList();
    return () => { cancelled = true; };
  }, [ticker]);

  // Years (descending) — derived from `available`
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const a of available) set.add(a.year);
    return [...set].sort((a, b) => b - a);
  }, [available]);

  // Quarters available for the selected year (1..4 ascending)
  const quartersForYear = useMemo(() => {
    if (selectedYear === null) return [];
    return available
      .filter(a => a.year === selectedYear)
      .map(a => a.quarter)
      .sort((a, b) => a - b);
  }, [available, selectedYear]);

  // If the selected quarter is not valid for the newly chosen year, snap to the latest available.
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

  // Step 2: fetch transcript content whenever year/quarter selection changes.
  useEffect(() => {
    let cancelled = false;

    const loadTranscript = async () => {
      if (!ticker || selectedYear === null || selectedQuarter === null) return;
      setLoadingTranscript(true);
      setTranscriptError(null);
      setTranscript(null);

      try {
        const raw = await fetchFmp(`api/v3/earning_call_transcript/${ticker}`, {
          year: selectedYear,
          quarter: selectedQuarter,
        });
        if (cancelled) return;

        const item = Array.isArray(raw) ? raw[0] : raw;
        if (!item || typeof item.content !== 'string' || item.content.trim().length === 0) {
          setTranscriptError('No hay transcript disponible para este trimestre.');
        } else {
          setTranscript(item as TranscriptContent);
        }
      } catch (err: any) {
        if (!cancelled) {
          setTranscriptError(err?.message || 'No se pudo cargar el transcript');
        }
      } finally {
        if (!cancelled) setLoadingTranscript(false);
      }
    };

    loadTranscript();
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

      {/* Selectors */}
      {loadingList ? (
        <div className="flex justify-center py-16">
          <LogoLoader size="md" message="Cargando transcripts disponibles..." />
        </div>
      ) : listError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-300 text-sm">
          {listError}
        </div>
      ) : available.length === 0 ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-amber-200/80 text-sm">
          No se encontraron earnings transcripts para <span className="font-semibold">{ticker}</span>.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Año</label>
              <select
                value={selectedYear ?? ''}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-black/60 border border-emerald-900/40 hover:border-emerald-700/60 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition"
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
                className="bg-black/60 border border-emerald-900/40 hover:border-emerald-700/60 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition"
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

          {/* Transcript content */}
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
