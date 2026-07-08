// src/app/informe/generateWeeklyReportPDF.ts
// Weekly Market Report → institutional-grade PDF (white background, navy accent,
// FactSet/Morningstar-style layout). Consumes the JSON produced by
// backend/weekly_report_engine.py exactly as rendered on /informe.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type RGB = [number, number, number];

const INK: RGB = [17, 24, 39];        // near-black text
const GRAY: RGB = [107, 114, 128];    // secondary text
const FAINT: RGB = [156, 163, 175];   // tertiary text
const LINE: RGB = [229, 231, 235];    // hairlines
const HEAD_BG: RGB = [241, 245, 249]; // table head fill
const BOX_BG: RGB = [248, 250, 252];  // soft panels
const NAVY: RGB = [30, 58, 95];       // accent
const GREEN: RGB = [5, 150, 105];
const RED: RGB = [220, 38, 38];

const PW = 210;                        // A4 portrait (mm)
const PH = 297;
const ML = 16;
const MR = 16;
const MT = 18;
const MB = 20;
const CW = PW - ML - MR;               // content width

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Replace characters outside jsPDF's WinAnsi (CP1252) standard fonts. */
function tx(s: any): string {
  return String(s ?? '')
    .replace(/−/g, '-')   // minus sign
    .replace(/⚠️?/g, '!')
    .replace(/▸|▪|‣/g, '•')
    .replace(/[→←]/g, '-')
    .replace(/’/g, "'");
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(+v)) return '—';
  return `${v > 0 ? '+' : ''}${(+v).toFixed(decimals)}%`;
}

function pctColor(v: number | null | undefined): RGB {
  if (v == null || isNaN(+v)) return GRAY;
  return v > 0 ? GREEN : v < 0 ? RED : GRAY;
}

function fmtMktCap(v: number | null | undefined): string {
  if (!v) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

interface Ctx { doc: jsPDF; y: number }

function ensureSpace(c: Ctx, needed: number) {
  if (c.y + needed > PH - MB) {
    c.doc.addPage();
    c.y = MT;
  }
}

function paragraphs(c: Ctx, items: string[] | undefined, size = 9.3) {
  const { doc } = c;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...INK);
  for (const p of items ?? []) {
    const lines: string[] = doc.splitTextToSize(tx(p), CW);
    ensureSpace(c, lines.length * 4.3 + 3);
    doc.text(lines, ML, c.y);
    c.y += lines.length * 4.3 + 2.6;
  }
  c.y += 1;
}

let sectionNo = 0;
function sectionTitle(c: Ctx, title: string) {
  const { doc } = c;
  sectionNo += 1;
  ensureSpace(c, 26);
  c.y += 4;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.7);
  doc.line(ML, c.y, ML + 8, c.y);
  c.y += 5.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...NAVY);
  doc.text(`${String(sectionNo).padStart(2, '0')}   ${tx(title).toUpperCase()}`, ML, c.y);
  c.y += 6.5;
}

const BASE_TABLE = {
  margin: { left: ML, right: MR, top: MT, bottom: MB },
  styles: {
    font: 'helvetica', fontSize: 8.3, cellPadding: 1.9,
    textColor: INK as any, lineColor: LINE as any, lineWidth: 0.15,
  },
  headStyles: {
    fillColor: HEAD_BG as any, textColor: GRAY as any,
    fontStyle: 'bold' as const, fontSize: 7.4,
  },
  alternateRowStyles: { fillColor: [252, 253, 254] as any },
  theme: 'grid' as const,
};

function tableDone(c: Ctx) {
  c.y = ((c.doc as any).lastAutoTable?.finalY ?? c.y) + 5;
}

/** Draw a signed horizontal bar centered at zero inside a table cell. */
function drawSignedBar(doc: jsPDF, cell: any, value: number, max: number) {
  const pad = 1.6;
  const x0 = cell.x + pad;
  const w = cell.width - pad * 2;
  const cy = cell.y + cell.height / 2;
  const mid = x0 + w / 2;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(mid, cell.y + 1.2, mid, cell.y + cell.height - 1.2);
  const frac = Math.min(Math.abs(value) / (max || 1), 1);
  const bw = (w / 2) * frac;
  const col = value >= 0 ? GREEN : RED;
  doc.setFillColor(col[0], col[1], col[2]);
  if (bw > 0.3) {
    doc.rect(value >= 0 ? mid : mid - bw, cy - 1.1, bw, 2.2, 'F');
  }
}

/* ------------------------------------------------------------------ */
/*  Blocks                                                             */
/* ------------------------------------------------------------------ */

function masthead(c: Ctx, report: any, es: boolean) {
  const { doc } = c;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.1);
  doc.line(ML, c.y, PW - MR, c.y);
  c.y += 7;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...NAVY);
  doc.text(es ? 'INFORME SEMANAL DE MERCADO' : 'WEEKLY MARKET REPORT', ML, c.y);
  c.y += 6;

  doc.setFontSize(8.6);
  doc.setTextColor(...GRAY);
  doc.text(tx(report.meta.label), ML, c.y);
  c.y += 8;

  doc.setFont('times', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...INK);
  const hl: string[] = doc.splitTextToSize(tx(report.headline), CW);
  doc.text(hl, ML, c.y);
  c.y += hl.length * 8 + 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.8);
  doc.setTextColor(...GRAY);
  const dek: string[] = doc.splitTextToSize(tx(report.dek), CW - 10);
  doc.text(dek, ML, c.y);
  c.y += dek.length * 4.6 + 6;

  // KPI strip
  const kpis: any[] = (report.kpis ?? []).slice(0, 6);
  if (kpis.length) {
    const gap = 2.5;
    const bw = (CW - gap * (kpis.length - 1)) / kpis.length;
    const bh = 15;
    ensureSpace(c, bh + 6);
    kpis.forEach((k, i) => {
      const x = ML + i * (bw + gap);
      doc.setFillColor(...BOX_BG);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, c.y, bw, bh, 1.2, 1.2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(...FAINT);
      doc.text(tx(k.label).toUpperCase().slice(0, 22), x + 2.2, c.y + 4);
      const tone: RGB = k.tone === 'up' ? GREEN : k.tone === 'down' ? RED : INK;
      doc.setFontSize(9);
      doc.setTextColor(...tone);
      doc.text(tx(k.value).slice(0, 20), x + 2.2, c.y + 9.2);
      if (k.delta) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(...GRAY);
        doc.text(tx(k.delta), x + 2.2, c.y + 13);
      }
    });
    c.y += bh + 8;
  }
}

function executiveSummary(c: Ctx, report: any, es: boolean) {
  sectionTitle(c, es ? 'Resumen ejecutivo' : 'Executive summary');
  paragraphs(c, report.executive_summary, 9.6);

  const takeaways: string[] = report.key_takeaways ?? [];
  if (!takeaways.length) return;
  const { doc } = c;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  const wrapped = takeaways.map((t) => doc.splitTextToSize(tx(t), CW - 14) as string[]);
  const boxH = wrapped.reduce((a, w) => a + w.length * 4 + 1.6, 0) + 8;
  ensureSpace(c, boxH + 4);
  doc.setFillColor(...BOX_BG);
  doc.setDrawColor(...LINE);
  doc.roundedRect(ML, c.y, CW, boxH, 1.5, 1.5, 'FD');
  let yy = c.y + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(...NAVY);
  doc.text(es ? 'CLAVES DE LA SEMANA' : 'KEY TAKEAWAYS', ML + 4, yy - 1.4);
  yy += 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  doc.setTextColor(...INK);
  for (const w of wrapped) {
    doc.setTextColor(...NAVY);
    doc.text('•', ML + 4, yy);
    doc.setTextColor(...INK);
    doc.text(w, ML + 8, yy);
    yy += w.length * 4 + 1.6;
  }
  c.y += boxH + 6;
}

function overviewSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const rows = (s.indices ?? []).map((ix: any) => [
    tx(ix.label),
    fmtPct(ix.ret_pct),
    (+ix.close).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    (ix.daily ?? []).map((d: any) => (d.chg_pct > 0.05 ? '+' : d.chg_pct < -0.05 ? '-' : '·')).join('  '),
  ]);
  autoTable(c.doc, {
    ...BASE_TABLE,
    startY: c.y,
    head: [[es ? 'Índice' : 'Index', es ? 'Semana' : 'Week', es ? 'Cierre' : 'Close', es ? 'Día a día (L a V)' : 'Day by day (Mon-Fri)']],
    body: rows,
    columnStyles: {
      1: { halign: 'right', fontStyle: 'bold' },
      2: { halign: 'right' },
      3: { halign: 'center', textColor: GRAY as any },
    },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 1) {
        d.cell.styles.textColor = pctColor(s.indices?.[d.row.index]?.ret_pct) as any;
      }
    },
  });
  tableDone(c);
  if (s.vix) {
    c.doc.setFont('helvetica', 'normal');
    c.doc.setFontSize(8.2);
    c.doc.setTextColor(...GRAY);
    ensureSpace(c, 6);
    c.doc.text(`VIX: ${s.vix.level.toFixed(1)}  (${fmtPct(s.vix.chg_pct)} ${es ? 'en la semana' : 'on the week'})`, ML, c.y);
    c.y += 6;
  }
}

function sectorsSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const sectors: any[] = s.sectors ?? [];
  const max = Math.max(...sectors.map((x) => Math.abs(x.ret_pct)), 0.1);
  autoTable(c.doc, {
    ...BASE_TABLE,
    startY: c.y,
    head: [[es ? 'Sector' : 'Sector', 'ETF', '', es ? 'Semana' : 'Week']],
    body: sectors.map((x) => [tx(x.label), x.etf, '', fmtPct(x.ret_pct)]),
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 14, textColor: FAINT as any },
      2: { cellWidth: 78 },
      3: { halign: 'right', fontStyle: 'bold', cellWidth: 22 },
    },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 3) {
        d.cell.styles.textColor = pctColor(sectors[d.row.index]?.ret_pct) as any;
      }
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 2) {
        drawSignedBar(c.doc, d.cell, sectors[d.row.index]?.ret_pct ?? 0, max);
      }
    },
  });
  tableDone(c);
}

function breadthSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const st = s.stats ?? {};
  if (!st.total) return;
  autoTable(c.doc, {
    ...BASE_TABLE,
    startY: c.y,
    head: [[
      es ? 'Suben' : 'Advancers', es ? 'Bajan' : 'Decliners', es ? 'Planos' : 'Flat',
      es ? 'Amplitud' : 'Breadth', es ? 'Prom. compañía' : 'Avg company',
      es ? 'Mediana' : 'Median', es ? 'Índice' : 'Index',
    ]],
    body: [[
      String(st.advancers ?? '—'), String(st.decliners ?? '—'), String(st.flat ?? '—'),
      st.pct_up != null ? `${st.pct_up}%` : '—',
      fmtPct(st.avg_ret, 2), fmtPct(st.median_ret, 2), fmtPct(st.index_ret, 2),
    ]],
    styles: { ...BASE_TABLE.styles, halign: 'center' },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      if (d.column.index === 0) d.cell.styles.textColor = GREEN as any;
      if (d.column.index === 1) d.cell.styles.textColor = RED as any;
    },
  });
  tableDone(c);

  // Trend participation: average daily breadth + companies above/below EMAs
  if (st.avg_daily_breadth != null || st.ema50_pct_above != null || st.ema200_pct_above != null) {
    autoTable(c.doc, {
      ...BASE_TABLE,
      startY: c.y,
      head: [[
        es ? 'Amplitud media diaria' : 'Avg daily breadth',
        es ? 'Sobre EMA 50' : 'Above 50-day EMA',
        es ? 'Bajo EMA 50' : 'Below 50-day EMA',
        es ? 'Sobre EMA 200' : 'Above 200-day EMA',
        es ? 'Bajo EMA 200' : 'Below 200-day EMA',
      ]],
      body: [[
        st.avg_daily_breadth != null ? `${st.avg_daily_breadth.toFixed(0)}%` : '—',
        st.ema50_pct_above != null ? `${st.ema50_above} (${st.ema50_pct_above.toFixed(0)}%)` : '—',
        st.ema50_pct_above != null ? `${st.ema50_below} (${(100 - st.ema50_pct_above).toFixed(0)}%)` : '—',
        st.ema200_pct_above != null ? `${st.ema200_above} (${st.ema200_pct_above.toFixed(0)}%)` : '—',
        st.ema200_pct_above != null ? `${st.ema200_below} (${(100 - st.ema200_pct_above).toFixed(0)}%)` : '—',
      ]],
      styles: { ...BASE_TABLE.styles, halign: 'center' },
      didParseCell: (d) => {
        if (d.section !== 'body') return;
        if (d.column.index === 1 || d.column.index === 3) d.cell.styles.textColor = GREEN as any;
        if (d.column.index === 2 || d.column.index === 4) d.cell.styles.textColor = RED as any;
      },
    });
    tableDone(c);
  }

  // Distribution histogram
  const buckets: any[] = st.buckets ?? [];
  if (buckets.length) {
    const chartH = 26;
    ensureSpace(c, chartH + 16);
    c.doc.setFont('helvetica', 'bold');
    c.doc.setFontSize(6.6);
    c.doc.setTextColor(...FAINT);
    c.doc.text(
      (es ? 'DISTRIBUCIÓN DE RETORNOS SEMANALES (S&P 500)' : 'WEEKLY RETURN DISTRIBUTION (S&P 500)'),
      ML, c.y,
    );
    c.y += 3.5;
    const maxCount = Math.max(...buckets.map((b) => b.count), 1);
    const gap = 3;
    const bw = (CW - gap * (buckets.length - 1)) / buckets.length;
    const base = c.y + chartH;
    buckets.forEach((b, i) => {
      const x = ML + i * (bw + gap);
      const h = Math.max((b.count / maxCount) * chartH, 0.6);
      const col = i < 3 ? RED : GREEN;
      c.doc.setFillColor(col[0], col[1], col[2]);
      c.doc.rect(x, base - h, bw, h, 'F');
      c.doc.setFont('helvetica', 'normal');
      c.doc.setFontSize(6.4);
      c.doc.setTextColor(...GRAY);
      c.doc.text(String(b.count), x + bw / 2, base - h - 1.2, { align: 'center' });
      c.doc.setTextColor(...FAINT);
      c.doc.text(tx(b.label), x + bw / 2, base + 3.4, { align: 'center' });
    });
    c.doc.setDrawColor(...LINE);
    c.doc.setLineWidth(0.2);
    c.doc.line(ML, base, ML + CW, base);
    c.y = base + 8;
  }
}

function moversSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const winners: any[] = s.winners ?? [];
  const losers: any[] = s.losers ?? [];
  const n = Math.max(winners.length, losers.length);
  const rows = Array.from({ length: n }, (_, i) => {
    const w = winners[i];
    const l = losers[i];
    return [
      String(i + 1),
      w ? `${w.symbol}  ${tx(w.name).slice(0, 26)}` : '',
      w ? fmtPct(w.ret_pct) : '',
      l ? `${l.symbol}  ${tx(l.name).slice(0, 26)}` : '',
      l ? fmtPct(l.ret_pct) : '',
    ];
  });
  autoTable(c.doc, {
    ...BASE_TABLE,
    startY: c.y,
    head: [['#', es ? 'Mayores subas' : 'Top gainers', '%', es ? 'Mayores bajas' : 'Top losers', '%']],
    body: rows,
    columnStyles: {
      0: { cellWidth: 7, textColor: FAINT as any },
      1: { cellWidth: 66 },
      2: { cellWidth: 17, halign: 'right', fontStyle: 'bold', textColor: GREEN as any },
      3: { cellWidth: 66 },
      4: { cellWidth: 17, halign: 'right', fontStyle: 'bold', textColor: RED as any },
    },
  });
  tableDone(c);
}

function earningsSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const notables: any[] = s.notables ?? [];
  if (!notables.length) return;
  autoTable(c.doc, {
    ...BASE_TABLE,
    startY: c.y,
    head: [[
      es ? 'Empresa' : 'Company', es ? 'Cap.' : 'Mkt cap', es ? 'Fecha' : 'Date',
      'EPS', es ? 'Estimado' : 'Estimate', es ? 'Sorpresa' : 'Surprise', es ? 'Reacción' : 'Reaction',
    ]],
    body: notables.map((r) => [
      `${r.symbol}  ${tx(r.name).slice(0, 24)}`,
      fmtMktCap(r.mktcap),
      (r.date || '').slice(5),
      r.eps_actual != null ? `$${(+r.eps_actual).toFixed(2)}` : '—',
      r.eps_estimated != null ? `$${(+r.eps_estimated).toFixed(2)}` : '—',
      fmtPct(r.surprise_pct),
      r.reaction_pct != null
        ? `${fmtPct(r.reaction_pct)} (${r.reaction_day === 'same_day' ? (es ? 'mismo día' : 'same day') : (es ? 'día sig.' : 'next day')})`
        : '—',
    ]),
    columnStyles: {
      1: { halign: 'right' }, 2: { halign: 'right', textColor: GRAY as any },
      3: { halign: 'right' }, 4: { halign: 'right', textColor: GRAY as any },
      5: { halign: 'right', fontStyle: 'bold' }, 6: { halign: 'right' },
    },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      if (d.column.index === 5) d.cell.styles.textColor = pctColor(notables[d.row.index]?.surprise_pct) as any;
      if (d.column.index === 6) d.cell.styles.textColor = pctColor(notables[d.row.index]?.reaction_pct) as any;
    },
  });
  tableDone(c);
}

function currenciesSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const fx: any[] = s.fx ?? [];
  if (fx.length) {
    autoTable(c.doc, {
      ...BASE_TABLE,
      startY: c.y,
      head: [[es ? 'Divisa' : 'Currency', 'Par', es ? 'Cierre' : 'Close', es ? 'Semana' : 'Week']],
      body: fx.map((f) => [tx(f.label), f.pair, (+f.close).toFixed(4), fmtPct(f.ret_pct, 2)]),
      columnStyles: {
        1: { textColor: FAINT as any }, 2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 3) {
          d.cell.styles.textColor = pctColor(fx[d.row.index]?.ret_pct) as any;
        }
      },
    });
    tableDone(c);
  }
  const macro: any[] = s.macro ?? [];
  if (macro.length) {
    autoTable(c.doc, {
      ...BASE_TABLE,
      startY: c.y,
      head: [['Macro', es ? 'Cierre' : 'Close', es ? 'Semana' : 'Week']],
      body: macro.map((m) => [
        tx(m.label),
        (+m.close).toLocaleString('en-US', { maximumFractionDigits: 2 }),
        m.chg_bps != null ? `${m.chg_bps > 0 ? '+' : ''}${(+m.chg_bps).toFixed(0)} bps` : fmtPct(m.ret_pct),
      ]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 2) {
          const m = macro[d.row.index];
          const v = m?.chg_bps != null ? -m.chg_bps : m?.ret_pct; // rising yields shown red
          d.cell.styles.textColor = pctColor(v) as any;
        }
      },
    });
    tableDone(c);
  }
}

function flowsSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const proxies: any[] = s.proxies ?? [];
  if (!proxies.length) return;
  const max = Math.max(...proxies.map((p) => Math.abs(p.value_pct)), 0.1);
  autoTable(c.doc, {
    ...BASE_TABLE,
    startY: c.y,
    head: [[es ? 'Proxy de posicionamiento' : 'Positioning proxy', '', es ? 'Spread semanal' : 'Weekly spread']],
    body: proxies.map((p) => [tx(p.label), '', fmtPct(p.value_pct, 2)]),
    columnStyles: {
      0: { cellWidth: 74 },
      1: { cellWidth: 72 },
      2: { halign: 'right', fontStyle: 'bold', cellWidth: 28 },
    },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 2) {
        d.cell.styles.textColor = pctColor(proxies[d.row.index]?.value_pct) as any;
      }
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 1) {
        drawSignedBar(c.doc, d.cell, proxies[d.row.index]?.value_pct ?? 0, max);
      }
    },
  });
  tableDone(c);
}

function newsSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);
  paragraphs(c, s.paragraphs);
  const themes: any[] = s.themes ?? [];
  if (themes.length) {
    autoTable(c.doc, {
      ...BASE_TABLE,
      startY: c.y,
      head: [[es ? 'Tema' : 'Theme', es ? 'Menciones' : 'Mentions', es ? 'Sentimiento' : 'Sentiment']],
      body: themes.map((t) => [
        tx(t.label), String(t.count),
        `${t.avg_sentiment > 0 ? '+' : ''}${(+t.avg_sentiment).toFixed(2)}`,
      ]),
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 2) {
          d.cell.styles.textColor = pctColor(themes[d.row.index]?.avg_sentiment) as any;
        }
      },
    });
    tableDone(c);
  }
  const stories: any[] = s.top_stories ?? [];
  if (stories.length) {
    ensureSpace(c, 12);
    c.doc.setFont('helvetica', 'bold');
    c.doc.setFontSize(6.6);
    c.doc.setTextColor(...FAINT);
    c.doc.text(es ? 'TITULARES DESTACADOS' : 'NOTABLE HEADLINES', ML, c.y);
    c.y += 4;
    c.doc.setFont('helvetica', 'normal');
    for (const n of stories) {
      const lines: string[] = c.doc.splitTextToSize(tx(n.title), CW - 8);
      ensureSpace(c, lines.length * 3.9 + 6);
      const dot = pctColor(n.sentiment);
      c.doc.setFillColor(dot[0], dot[1], dot[2]);
      c.doc.circle(ML + 1.4, c.y - 1.1, 0.9, 'F');
      c.doc.setFontSize(8.4);
      c.doc.setTextColor(...INK);
      c.doc.text(lines, ML + 5, c.y);
      c.y += lines.length * 3.9;
      c.doc.setFontSize(6.8);
      c.doc.setTextColor(...FAINT);
      c.doc.text(`${tx(n.site)} · ${n.date}`, ML + 5, c.y);
      c.y += 4.4;
    }
    c.y += 2;
  }
}

function synthesisSection(c: Ctx, s: any, es: boolean) {
  sectionTitle(c, s.title);

  // Regime panel
  if (s.regime) {
    const desc: string[] = c.doc.splitTextToSize(tx(s.regime.description), CW - 10);
    const boxH = 13 + desc.length * 4;
    ensureSpace(c, boxH + 4);
    c.doc.setFillColor(238, 242, 248);
    c.doc.setDrawColor(...NAVY);
    c.doc.setLineWidth(0.3);
    c.doc.roundedRect(ML, c.y, CW, boxH, 1.5, 1.5, 'FD');
    c.doc.setFont('helvetica', 'bold');
    c.doc.setFontSize(6.4);
    c.doc.setTextColor(...NAVY);
    c.doc.text(es ? 'RÉGIMEN DE LA SEMANA' : 'WEEKLY REGIME', ML + 4, c.y + 4.6);
    c.doc.setFontSize(10.5);
    c.doc.setTextColor(...INK);
    c.doc.text(tx(s.regime.label), ML + 4, c.y + 9.6);
    c.doc.setFont('helvetica', 'normal');
    c.doc.setFontSize(8.2);
    c.doc.setTextColor(...GRAY);
    c.doc.text(desc, ML + 4, c.y + 13.8);
    c.y += boxH + 6;
  }

  paragraphs(c, s.paragraphs);

  // Analyst council table
  const analysts: any[] = s.analysts ?? [];
  if (analysts.length) {
    autoTable(c.doc, {
      ...BASE_TABLE,
      startY: c.y,
      head: [[
        es ? 'Dimensión' : 'Dimension', '',
        es ? 'Lectura' : 'Reading', es ? 'Cobertura' : 'Coverage',
      ]],
      body: analysts.map((a) => [
        tx(a.name), '',
        `${a.score > 0 ? '+' : ''}${(+a.score).toFixed(0)}`,
        `${Math.round((a.confidence ?? 0) * 100)}%`,
      ]),
      columnStyles: {
        0: { cellWidth: 52 },
        1: { cellWidth: 80 },
        2: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
        3: { cellWidth: 22, halign: 'right', textColor: GRAY as any },
      },
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 2) {
          d.cell.styles.textColor = pctColor(analysts[d.row.index]?.score) as any;
        }
      },
      didDrawCell: (d) => {
        if (d.section === 'body' && d.column.index === 1) {
          drawSignedBar(c.doc, d.cell, analysts[d.row.index]?.score ?? 0, 100);
        }
      },
    });
    tableDone(c);
    if (s.consensus != null) {
      ensureSpace(c, 6);
      c.doc.setFont('helvetica', 'normal');
      c.doc.setFontSize(8.4);
      c.doc.setTextColor(...GRAY);
      c.doc.text(
        `${es ? 'Balance agregado' : 'Aggregate balance'}: ${s.consensus > 0 ? '+' : ''}${(+s.consensus).toFixed(0)} / ±100  ·  ${es ? 'dispersión' : 'dispersion'}: ${(+(s.dispersion ?? 0)).toFixed(0)}`,
        ML, c.y,
      );
      c.y += 7;
    }
  }

  const bulletList = (title: string, items: string[], numbered: boolean) => {
    if (!items.length) return;
    ensureSpace(c, 12);
    c.doc.setFont('helvetica', 'bold');
    c.doc.setFontSize(6.6);
    c.doc.setTextColor(...FAINT);
    c.doc.text(title, ML, c.y);
    c.y += 4;
    c.doc.setFont('helvetica', 'normal');
    c.doc.setFontSize(8.8);
    items.forEach((it, i) => {
      const lines: string[] = c.doc.splitTextToSize(tx(it), CW - 8);
      ensureSpace(c, lines.length * 4 + 2);
      c.doc.setTextColor(...NAVY);
      c.doc.text(numbered ? `${i + 1}.` : '•', ML + 1, c.y);
      c.doc.setTextColor(...INK);
      c.doc.text(lines, ML + 6, c.y);
      c.y += lines.length * 4 + 1.6;
    });
    c.y += 3;
  };
  bulletList(es ? 'DIVERGENCIAS DETECTADAS' : 'DETECTED DIVERGENCES', s.divergences ?? [], false);
  bulletList(es ? 'MOTORES DE LA SEMANA' : 'DRIVERS OF THE WEEK', s.drivers ?? [], true);
}

function footerAndDisclaimer(c: Ctx, report: any, es: boolean) {
  // Closing block: coverage + warnings + sources
  const { doc } = c;
  ensureSpace(c, 30);
  c.y += 2;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(ML, c.y, PW - MR, c.y);
  c.y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...FAINT);
  const cov = report.meta.coverage ?? {};
  const covLine = `${es ? 'Cobertura' : 'Coverage'}: ${cov.sp500_members_with_data ?? 0} S&P 500 · ` +
    `${cov.earnings_reports_sp500 ?? 0} earnings · ${cov.news_headlines ?? 0} ${es ? 'titulares' : 'headlines'} · ` +
    `${cov.fx_pairs ?? 0} FX`;
  doc.text(covLine, ML, c.y);
  c.y += 4;
  for (const w of report.meta.warnings ?? []) {
    const lines: string[] = doc.splitTextToSize(`! ${tx(w)}`, CW);
    ensureSpace(c, lines.length * 3.4 + 2);
    doc.setTextColor(180, 120, 20);
    doc.text(lines, ML, c.y);
    c.y += lines.length * 3.4 + 1;
  }
  doc.setTextColor(...FAINT);
  const src: string[] = doc.splitTextToSize(tx(report.meta.sources), CW);
  ensureSpace(c, src.length * 3.4 + 2);
  doc.text(src, ML, c.y);
  c.y += src.length * 3.4;

  // Per-page footer: rule + label + page numbers
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(ML, PH - 12, PW - MR, PH - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(...FAINT);
    doc.text(tx(report.meta.label), ML, PH - 8);
    doc.text(
      `${es ? 'Página' : 'Page'} ${p} ${es ? 'de' : 'of'} ${pages}`,
      PW - MR, PH - 8, { align: 'right' },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */
export function generateWeeklyReportPDF(report: any): void {
  const es = (report?.meta?.language ?? 'es') === 'es';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const c: Ctx = { doc, y: MT };
  sectionNo = 0;

  masthead(c, report, es);
  executiveSummary(c, report, es);

  const renderers: Record<string, (cc: Ctx, s: any, e: boolean) => void> = {
    overview: overviewSection,
    sectors: sectorsSection,
    breadth: breadthSection,
    movers: moversSection,
    earnings: earningsSection,
    currencies: currenciesSection,
    flows: flowsSection,
    news: newsSection,
    synthesis: synthesisSection,
  };
  for (const s of report.sections ?? []) {
    const fn = renderers[s.id];
    if (fn) {
      fn(c, s, es);
    } else {
      sectionTitle(c, s.title);
      paragraphs(c, s.paragraphs);
    }
  }

  footerAndDisclaimer(c, report, es);

  const name = es ? 'informe-semanal' : 'weekly-report';
  doc.save(`${name}-${report.meta.week_start}.pdf`);
}
