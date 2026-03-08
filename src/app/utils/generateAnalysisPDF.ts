// src/app/utils/generateAnalysisPDF.ts
// Institutional-Grade Investment Analysis PDF — Prismo v2
// Redesigned for hedge-fund level presentation

export interface PDFBranding {
  bgColor?:          [number, number, number];  // default [0,0,0]
  accentColor?:      [number, number, number];  // default [0,166,81]
  fontFamily?:       string;                    // default 'helvetica'
  logoBase64?:       string;                    // optional base64 data URL
  customDisclaimer?: string;                    // optional replacement disclaimer text
  userCompany?:      string;                    // user's firm name for branded reports
}

export interface PDFData {
  ticker: string;
  profile: any;
  quote: any;
  income: any[];
  balance: any[];
  cashFlow: any[];
  incomeTTM: any;
  priceTarget: any;
  sharedAverageVal: number | null;
  sharedWACC: number | null;
  sharedAvgCAPM: number | null;
  sharedForecasts: any[];
  sharedAdvanceValueNet: any;
  sharedCompanyQualityNet: any;
  sharedCagrStats: { avgCagr: number | null; minCagr: number | null; maxCagr: number | null } | null;
  sharedPivotAnalysis: any;
  // Raw FMP data (primary source — doesn't depend on backend or tab navigation)
  keyMetrics?: any[];
  keyMetricsTTM?: any;
  ratios?: any[];
  ratiosTTM?: any;
  estimates?: any[];
  dcfCustom?: any;
  // Additional raw data for comprehensive report
  dividends?: any[];
  incomeGrowth?: any[];
  financialGrowth?: any[];
  enterpriseValue?: any[];
  ownerEarnings?: any[];
  balanceTTM?: any;
  cashFlowTTM?: any;
  // Pre-loaded data (avoids live fmpFetch during PDF generation)
  newsData?: any[];
  holdersData?: any;       // { institutionalHolders, positionsSummary, etc. }
  // Optional config
  sections?:  string[];    // which pages to include
  branding?:  PDFBranding;
  preview?:   boolean;     // if true → return blob URL instead of saving
}

const f  = (v: any, d = 2) => (v == null || isNaN(+v)) ? '-' : (+v).toFixed(d);
const fp = (v: any, d = 1) => (v == null || isNaN(+v)) ? '-' : (+v).toFixed(d) + '%';
const fl = (v: any) => {
  if (v == null || isNaN(+v)) return '-';
  const n = +v;
  if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(1)+'T';
  if (Math.abs(n) >= 1e9)  return (n/1e9).toFixed(1)+'B';
  if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(1)+'M';
  if (Math.abs(n) >= 1e3)  return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
};

type RGB = [number, number, number];

// Filter out rows where ALL value columns are '-' (empty data)
function filterRows(rows: string[][], valueCols?: number[]): string[][] {
  return rows.filter(row => {
    const cols = valueCols || row.slice(1).map((_, i) => i + 1);
    return cols.some(i => row[i] != null && row[i] !== '-' && row[i] !== '$-' && row[i] !== '-%' && row[i] !== '0.0%');
  });
}

// ── Self-sufficient computation helpers (no tab dependency) ──────────────
function computeCAGR(income: any[]): { avgCagr: number|null; minCagr: number|null; maxCagr: number|null } {
  if (!income?.length) return { avgCagr: null, minCagr: null, maxCagr: null };
  const sorted = [...income].filter((i: any) => i?.revenue > 0).sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
  const cagrs: number[] = [];
  for (const span of [3, 5, 10]) {
    if (sorted.length >= span + 1) {
      const old = sorted[sorted.length - span - 1]?.revenue;
      const cur = sorted[sorted.length - 1]?.revenue;
      if (old > 0 && cur > 0) {
        const cagr = (Math.pow(cur / old, 1 / span) - 1) * 100;
        if (isFinite(cagr)) cagrs.push(cagr);
      }
    }
  }
  if (cagrs.length === 0) return { avgCagr: null, minCagr: null, maxCagr: null };
  return {
    avgCagr: cagrs.reduce((a, b) => a + b, 0) / cagrs.length,
    minCagr: Math.min(...cagrs),
    maxCagr: Math.max(...cagrs),
  };
}

function computeValuationModels(dcfCustom: any, quote: any, km: any): { name: string; val: number }[] {
  const models: { name: string; val: number }[] = [];
  if (dcfCustom?.dcf > 0) models.push({ name: 'DCF Intrinsic', val: +dcfCustom.dcf });
  const eps = quote?.eps, bvps = km?.bookValuePerShare, fcfps = km?.freeCashFlowPerShare;
  if (eps > 0 && bvps > 0) models.push({ name: 'Graham Number', val: Math.sqrt(22.5 * eps * bvps) });
  // Use sector-appropriate PE (actual PE or 15 as floor)
  const sectorPE = Math.max(km?.peRatio ?? quote?.pe ?? 15, 10);
  if (eps > 0) models.push({ name: `PE Fair Value (${sectorPE.toFixed(0)}x)`, val: eps * sectorPE });
  if (bvps > 0) models.push({ name: 'Book Value x1.5', val: bvps * 1.5 });
  if (fcfps > 0) models.push({ name: 'FCF Yield (6%)', val: fcfps / 0.06 });
  const div = quote?.dividendYield && quote.price ? quote.price * quote.dividendYield : 0;
  const wacc = dcfCustom?.wacc;
  // DDM: guard against division by zero (wacc/100 - growth must be > 0.005)
  const ddmDenom = wacc ? (wacc / 100 - 0.03) : 0;
  if (div > 0 && ddmDenom > 0.005) models.push({ name: 'DDM', val: div / ddmDenom });
  // Filter out any Infinity/NaN values
  return models.filter(m => isFinite(m.val) && m.val > 0);
}

function computeAverageValuation(dcfCustom: any, quote: any, km: any): number | null {
  const models = computeValuationModels(dcfCustom, quote, km);
  if (models.length === 0) return null;
  return models.reduce((a, m) => a + m.val, 0) / models.length;
}

function computeQualityScore(km: any, income: any[], balance: any[]): { scores: Record<string, number>; totalScore: number; rating: string } | null {
  if (!km || !income?.length || !balance?.length) return null;
  const inc = income[0], bal = balance[0];
  if (!inc || !bal) return null;
  const s = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

  const profitability = (
    s((km.roe ?? km.returnOnEquity ?? 0), 0, 0.3) +
    s((km.grossProfitMargin ?? inc.grossProfitRatio ?? 0), 0, 0.6) +
    s((km.netProfitMargin ?? inc.netIncomeRatio ?? 0), 0, 0.25) +
    s((km.returnOnAssets ?? km.roa ?? 0), 0, 0.15)
  ) / 4;

  const financial_strength = (
    s(1 / Math.max(Math.abs(km.debtToEquity ?? km.debtEquityRatio ?? 1), 0.01), 0, 2) +
    s(Math.min(km.currentRatio ?? 0, 4) / 4, 0, 1) +
    s(Math.min(km.interestCoverage ?? 0, 20) / 20, 0, 1)
  ) / 3;

  const efficiency = (
    s(km.assetTurnover ?? (inc.revenue / (bal.totalAssets || 1)), 0, 2) +
    s((km.freeCashFlowMargin ?? 0), 0, 0.25)
  ) / 2;

  const growth = (() => {
    const rev = income.slice(0, 5).reverse().map((i: any) => i.revenue).filter(Boolean);
    if (rev.length < 2) return 0.5;
    const cagr = Math.pow(rev[rev.length - 1] / rev[0], 1 / (rev.length - 1)) - 1;
    return s(cagr, -0.05, 0.25);
  })();

  const valuation = (
    s(1 / Math.max(km.peRatio ?? 30, 1), 0, 0.1) +
    s((km.earningsYield ?? 0), 0, 0.12)
  ) / 2;

  const scores: Record<string, number> = { profitability, financial_strength, efficiency, growth, valuation };
  const total = (profitability + financial_strength + efficiency + growth + valuation) / 5;
  const rating = total >= 0.75 ? 'Excellent' : total >= 0.6 ? 'Good' : total >= 0.4 ? 'Fair' : 'Weak';
  return { scores, totalScore: total, rating };
}

// ── FMP fetch helper (client-side, through /api/fmp proxy) ─────────────
async function fmpFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  try {
    const search = new URLSearchParams();
    search.set('path', path);
    for (const [k, v] of Object.entries(params)) search.set(k, v);
    const res = await fetch(`/api/fmp?${search.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`[PDF] fmpFetch ${path} failed: HTTP ${res.status}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn(`[PDF] fmpFetch ${path} error:`, err);
    return null;
  }
}

export async function generateAnalysisPDF(d: PDFData): Promise<string | void> {
  const { default: jsPDF } = await import('jspdf');
  const atMod = await import('jspdf-autotable');
  if (typeof (atMod as any).applyPlugin === 'function') {
    (atMod as any).applyPlugin(jsPDF);
  }
  const doc: any = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Sections & branding (from config or defaults) ─────────────────────
  const activeSections = new Set(
    d.sections ?? [
      'cover', 'company_overview', 'market_summary', 'income_statement', 'balance_sheet', 'cash_flow',
      'key_metrics', 'dupont', 'quality_score', 'wacc_cagr', 'beta_capm', 'sgr',
      'valuation_models', 'analyst_forecasts', 'revenue_forecast', 'price_target',
      'growth_analysis', 'enterprise_value', 'dividends', 'owner_earnings',
      'ttm_snapshot', 'technical_52w', 'pivots_fibonacci',
      'competitors', 'industry_overview', 'holders', 'segmentation', 'news',
      'analisis_final', 'disclaimer',
    ]
  );
  const FONT = d.branding?.fontFamily ?? 'helvetica';

  // ── Palette (v2 — richer, more nuanced) ──────────────────────────────
  const G:  RGB = d.branding?.accentColor ?? [0,  166, 81];  // accent (default: #00A651)
  const G2: RGB = [Math.max(0, Math.round(G[0]*0.7)), Math.max(0, Math.round(G[1]*0.55)), Math.max(0, Math.round(G[2]*0.45))]; // darker accent
  const GL: RGB = [Math.min(255, G[0]+60), Math.min(255, G[1]+40), Math.min(255, G[2]+40)]; // lighter accent
  const W:  RGB = [255,255,255];
  const BK: RGB = d.branding?.bgColor    ?? [0,  0,  0];     // background (default: black)
  const isBlack = BK[0]+BK[1]+BK[2] < 30;
  const D1: RGB = isBlack ? [10,10,10]  : [Math.min(255,BK[0]+10), Math.min(255,BK[1]+10), Math.min(255,BK[2]+10)];
  const D2: RGB = isBlack ? [16,16,16]  : [Math.min(255,BK[0]+16), Math.min(255,BK[1]+16), Math.min(255,BK[2]+16)];
  const D3: RGB = isBlack ? [24,24,24]  : [Math.min(255,BK[0]+24), Math.min(255,BK[1]+24), Math.min(255,BK[2]+24)];
  const D4: RGB = isBlack ? [32,32,32]  : [Math.min(255,BK[0]+32), Math.min(255,BK[1]+32), Math.min(255,BK[2]+32)];
  const TW: RGB = [230,230,230];   // main text (brighter)
  const TG: RGB = [120,120,120];   // muted text
  const TL: RGB = [170,170,170];   // light secondary text
  const RD: RGB = [230, 60, 60];   // negative/red
  const GN: RGB = [60, 210, 120];  // positive/green (for values)
  const YW: RGB = [220, 180, 40];  // caution/yellow
  const BL: RGB = [70, 160, 230];  // info/blue

  const sf = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const ss = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const st = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

  const PW = 210, PH = 297, M = 14, CW = PW - 2*M;
  const today = new Date();
  const date  = today.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const { ticker, profile, quote, income, balance, cashFlow, incomeTTM,
          priceTarget, sharedAverageVal, sharedWACC, sharedAvgCAPM,
          sharedForecasts, sharedAdvanceValueNet,
          sharedCompanyQualityNet, sharedCagrStats, sharedPivotAnalysis,
          keyMetrics, keyMetricsTTM, ratios, ratiosTTM, estimates, dcfCustom,
          dividends, incomeGrowth, financialGrowth, enterpriseValue, ownerEarnings,
          balanceTTM, cashFlowTTM,
          newsData: preloadedNews, holdersData: preloadedHolders } = d;

  // ── Resolve key metrics: raw FMP > shared state ──────────────────────
  const km0  = (keyMetrics || [])[0] || keyMetricsTTM || {};
  const rat0 = (ratios || [])[0] || ratiosTTM || {};
  // Merge raw metrics into a single lookup (raw FMP fields take priority)
  const KM: any = { ...rat0, ...km0 };

  // ── Resolve forecasts: raw estimates > shared state ──────────────────
  const forecasts = (sharedForecasts?.length ? sharedForecasts : estimates) || [];

  // ── Resolve pivot/52w: shared state > quote fallback ─────────────────
  const pivot = sharedPivotAnalysis || (quote ? {
    currentPrice: quote.price,
    high52Week: quote.yearHigh,
    low52Week: quote.yearLow,
    pivotPoint: quote.yearHigh && quote.yearLow ? +((+quote.yearHigh + +quote.yearLow + quote.price) / 3).toFixed(2) : null,
    resistance: { R1: null, R2: null },
    support: { S1: null, S2: null },
    fibonacci: { level236: null, level382: null, level500: null, level618: null, level786: null },
    priceVsLow: quote.yearLow ? +((quote.price / quote.yearLow - 1) * 100).toFixed(1) : null,
    priceVsHigh: quote.yearHigh ? +((quote.price / quote.yearHigh - 1) * 100).toFixed(1) : null,
  } : null);

  // ── Self-sufficient: compute from raw FMP data (no tab dependency) ──
  const cagrStats   = sharedCagrStats ?? computeCAGR(income);
  const avgVal      = sharedAverageVal ?? computeAverageValuation(dcfCustom, quote, KM);
  const qualityNet  = sharedCompanyQualityNet ?? computeQualityScore(KM, income, balance);

  const co    = profile?.companyName || ticker;
  const sect  = profile?.sector   || '-';
  const ind   = profile?.industry || '-';
  const exch  = profile?.exchangeShortName || '-';
  const price = quote?.price;

  let pg = 1;

  // ── App Logo (accent rounded square "P") ───────────────────────────────
  function appLogo(x: number, y: number, sz = 8) {
    sf(G); doc.roundedRect(x, y, sz, sz, 1.5, 1.5, 'F');
    doc.setFont(FONT,'bold'); doc.setFontSize(sz * 0.75);
    st(W); doc.text('P', x + sz/2, y + sz*0.7, { align:'center' });
  }

  // ── Page header (v2: accent strip + ticker bar) ────────────────────────
  const userCo = d.branding?.userCompany?.trim() || '';
  function pageHeader() {
    // Accent top strip
    sf(G); doc.rect(0, 0, PW, 1.2, 'F');
    // Dark header bar
    sf(D2); doc.rect(0, 1.2, PW, 10.5, 'F');
    // Bottom accent line
    ss(G); doc.setLineWidth(0.3); doc.line(0, 11.7, PW, 11.7);

    // Left: logo + ticker
    appLogo(M-1, 2.2, 7.5);
    doc.setFont(FONT,'bold'); doc.setFontSize(7.5); st(G);
    doc.text(ticker, M+9, 7.8);
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    const coShort = co.length > 40 ? co.substring(0, 38) + '…' : co;
    doc.text(`  ${coShort}`, M+9+doc.getTextWidth(ticker)+1, 7.8);

    // Right: page + date + firm
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    const headerRight = userCo ? `${userCo}  ·  p.${pg}  ·  ${date}` : `p.${pg}  ·  ${date}`;
    doc.text(headerRight, PW-M, 7.8, { align:'right' });
  }

  // ── Page footer (v2: subtle with accent) ───────────────────────────────
  function pageFooter() {
    const fy = PH - 9;
    sf(D2); doc.rect(0, fy, PW, 9, 'F');
    sf(G); doc.rect(0, fy, PW, 0.4, 'F');
    doc.setFont(FONT,'normal'); doc.setFontSize(5); st(TG);
    doc.text('Analysis by Prismo  ·  prismo.us  ·  For informational purposes only', PW/2, fy+5.5, { align:'center' });
    doc.setFontSize(4.5);
    doc.text(`Generated ${date}`, PW-M, fy+5.5, { align:'right' });
  }

  function newPage(): number {
    pageFooter();
    doc.addPage(); pg++;
    sf(BK); doc.rect(0, 0, PW, PH, 'F');
    pageHeader();
    return 18;
  }

  function checkY(y: number, need = 28): number {
    return y+need > PH-14 ? newPage() : y;
  }

  // ── Section heading (v2: accent bar + optional subtitle) ───────────────
  function section(y: number, title: string, summary?: string): number {
    // Accent bar left of title
    sf(G); doc.rect(M, y-1, 2, summary ? 9 : 6, 'F');
    doc.setFont(FONT,'bold'); doc.setFontSize(8); st(TW);
    doc.text(title.toUpperCase(), M+5, y+3);
    // Subtle underline
    ss(D4); doc.setLineWidth(0.15); doc.line(M+5, y+5, PW-M, y+5);
    if (summary) {
      doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TG);
      doc.text(summary, M+5, y+9.5);
      return y+15;
    }
    return y+9;
  }

  // ── Subsection heading (lighter, no bar) ───────────────────────────────
  function subsection(y: number, title: string): number {
    doc.setFont(FONT,'bold'); doc.setFontSize(7); st(G);
    doc.text(title, M+2, y+2.5);
    ss(D3); doc.setLineWidth(0.1); doc.line(M+2, y+4, PW-M, y+4);
    return y+7;
  }

  // ── Small metric pill (v2: accent border option) ───────────────────────
  function pill(x: number, y: number, w: number, label: string, val: string, vc?: RGB, accent = false) {
    sf(D1); doc.roundedRect(x, y, w, 14, 2, 2, 'F');
    ss(accent ? G : D3); doc.setLineWidth(accent ? 0.4 : 0.15);
    doc.roundedRect(x, y, w, 14, 2, 2, 'S');
    doc.setFont(FONT,'normal'); doc.setFontSize(5.5); st(TG);
    doc.text(label.toUpperCase(), x+w/2, y+5, { align:'center' });
    doc.setFont(FONT,'bold'); doc.setFontSize(10); st(vc||TW);
    doc.text(val, x+w/2, y+12, { align:'center' });
  }

  // ── Value color helper (green for positive, red for negative) ──────────
  function valColor(v: any): RGB {
    if (v == null || isNaN(+v)) return TW;
    const n = typeof v === 'string' ? parseFloat(v.replace(/[%$,]/g, '')) : +v;
    if (isNaN(n)) return TW;
    return n > 0 ? GN : n < 0 ? RD : TW;
  }

  // ── Bar chart (v2: gradient fills, cleaner labels) ─────────────────────
  function barChart(x: number, y: number, w: number, h: number,
                    labels: string[], values: number[], color: RGB, isPct = false) {
    const n = labels.length;
    if (n === 0) return;
    const gap = Math.max(1, Math.min(2, 20/n));
    const bw  = (w - (n-1)*gap) / n;
    const maxV = Math.max(...values.filter(isFinite), 1);
    const minV = Math.min(...values.filter(isFinite), 0);
    const span = maxV - Math.min(minV, 0) || 1;

    // Background panel
    sf(D1); doc.roundedRect(x-2, y-3, w+4, h+12, 2, 2, 'F');

    // Grid lines with labels
    ss(D3); doc.setLineWidth(0.08);
    for (let i=0; i<=4; i++) {
      const gy = y + h*(1 - i/4);
      doc.line(x, gy, x+w, gy);
      // Grid value labels
      if (i > 0 && i < 4) {
        const gv = (minV < 0 ? Math.min(minV,0) : 0) + span * (i/4);
        doc.setFont(FONT,'normal'); doc.setFontSize(4); st(D4);
        doc.text(isPct ? fp(gv) : fl(gv), x-1, gy+1, { align:'right' });
      }
    }

    labels.forEach((lbl, i) => {
      const v  = isFinite(values[i]) ? values[i] : 0;
      const bh = Math.max(1, (Math.abs(v) / span) * h);
      const bx = x + i*(bw+gap);
      const by = v >= 0 ? y+h-bh : y+h;
      const isNeg = v < 0;

      // Bar with slightly rounded top
      sf(isNeg ? RD : color);
      doc.roundedRect(bx, by, bw, bh, Math.min(1, bw/4), Math.min(1, bw/4), 'F');

      // Value above bar
      doc.setFont(FONT,'bold'); doc.setFontSize(5); st(isNeg ? RD : GL);
      const lv = isPct ? fp(v) : fl(v);
      doc.text(lv, bx+bw/2, by - (v>=0 ? 1.5 : -(bh+4)), { align:'center' });

      // Label below
      doc.setFont(FONT,'normal'); doc.setFontSize(5); st(TG);
      doc.text(lbl, bx+bw/2, y+h+5, { align:'center' });
    });
  }

  // ── Horizontal score bar (v2: smoother, with score text) ───────────────
  function scoreBar(x: number, y: number, w: number, label: string, pct: number) {
    const c: RGB = pct>=70 ? G : pct>=45 ? YW : RD;
    doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TL);
    doc.text(label, x, y+3.5);
    const bx = x+58, bw = w-72;
    // Track background
    sf(D3); doc.roundedRect(bx, y+0.5, bw, 4, 1.2, 1.2, 'F');
    // Filled portion
    const fw = Math.max(2, bw*Math.min(pct, 100)/100);
    sf(c); doc.roundedRect(bx, y+0.5, fw, 4, 1.2, 1.2, 'F');
    // Score text
    doc.setFont(FONT,'bold'); doc.setFontSize(6.5); st(c);
    doc.text(`${pct.toFixed(0)}%`, bx+bw+3, y+3.8);
  }

  // ── autoTable helper (v2: cleaner styling, accent header) ──────────────
  function atable(opts: any): number {
    doc.autoTable({
      theme: 'plain',
      styles: {
        fontSize: 7,
        cellPadding: [2, 3],
        textColor: TW,
        fillColor: D1,
        lineColor: D3,
        lineWidth: 0,
      },
      headStyles: {
        fillColor: G2,
        textColor: W,
        fontStyle: 'bold',
        fontSize: 7,
        cellPadding: [2.5, 3],
      },
      alternateRowStyles: { fillColor: D2 },
      tableLineColor: D3,
      tableLineWidth: 0,
      margin: { left: M, right: M },
      // Conditional coloring for value cells
      didParseCell: (data: any) => {
        if (data.section === 'body') {
          const txt = data.cell.raw;
          if (typeof txt === 'string') {
            const num = parseFloat(txt.replace(/[%$,]/g, ''));
            if (!isNaN(num) && txt.includes('%')) {
              data.cell.styles.textColor = num > 0 ? GN : num < 0 ? RD : TW;
            }
          }
        }
      },
      ...opts,
      // Merge user didParseCell with default
      ...(opts.didParseCell ? {
        didParseCell: (data: any) => {
          // Default: color % values
          if (data.section === 'body') {
            const txt = data.cell.raw;
            if (typeof txt === 'string') {
              const num = parseFloat(txt.replace(/[%$,]/g, ''));
              if (!isNaN(num) && txt.includes('%')) {
                data.cell.styles.textColor = num > 0 ? GN : num < 0 ? RD : TW;
              }
            }
          }
          // User override
          opts.didParseCell(data);
        },
      } : {}),
    });
    return (doc.lastAutoTable?.finalY || opts.startY+20) + 6;
  }

  // ── KPI card row (horizontal metric cards) ─────────────────────────────
  function kpiRow(y: number, items: { label: string; value: string; color?: RGB; accent?: boolean }[]): number {
    const count = items.length;
    const gap = 3;
    const cardW = (CW - (count-1)*gap) / count;
    items.forEach((item, i) => {
      pill(M + i*(cardW+gap), y, cardW, item.label, item.value, item.color, item.accent);
    });
    return y + 18;
  }

  let y = 0; // shared Y cursor across pages

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER (v2: institutional-grade design)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('cover')) {
  sf(BK); doc.rect(0, 0, PW, PH, 'F');

  // Top accent bar
  sf(G); doc.rect(0, 0, PW, 2, 'F');

  // Left accent strip
  sf(G); doc.rect(0, 0, 3, PH, 'F');

  // ── Top section: Report type + logo ───────────────────────────────────
  const topY = 14;
  if (userCo) {
    // User firm branding
    doc.setFont(FONT,'bold'); doc.setFontSize(9); st(G);
    doc.text(userCo.toUpperCase(), M+4, topY);
    doc.setFont(FONT,'normal'); doc.setFontSize(7); st(TG);
    doc.text('EQUITY RESEARCH  ·  INVESTMENT ANALYSIS REPORT', M+4, topY+6);
  } else {
    doc.setFont(FONT,'bold'); doc.setFontSize(8); st(TG);
    doc.text('EQUITY RESEARCH  ·  INVESTMENT ANALYSIS REPORT', M+4, topY);
  }

  // Logo (right side)
  const logoY = 10;
  if (d.branding?.logoBase64) {
    try {
      sf(D2); doc.roundedRect(PW-M-24, logoY, 22, 22, 2, 2, 'F');
      ss(G); doc.setLineWidth(0.3); doc.roundedRect(PW-M-24, logoY, 22, 22, 2, 2, 'S');
      doc.addImage(d.branding.logoBase64, PW-M-23, logoY+1, 20, 20, '', 'FAST');
    } catch { /* skip */ }
  } else if (profile?.image) {
    try {
      const res = await fetch(profile.image);
      if (res.ok) {
        const blob = await res.blob();
        const url  = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload  = () => resolve(r.result as string);
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        sf(D2); doc.roundedRect(PW-M-24, logoY, 22, 22, 2, 2, 'F');
        ss(G); doc.setLineWidth(0.3); doc.roundedRect(PW-M-24, logoY, 22, 22, 2, 2, 'S');
        doc.addImage(url, 'JPEG', PW-M-23, logoY+1, 20, 20, '', 'FAST');
      }
    } catch { /* skip */ }
  }

  // Divider line
  const divY = userCo ? topY + 12 : topY + 6;
  sf(D3); doc.rect(M+4, divY, CW-8, 0.3, 'F');
  sf(G); doc.rect(M+4, divY, 40, 0.3, 'F'); // accent portion

  // ── Company name (large, bold) ────────────────────────────────────────
  const nameY = divY + 12;
  doc.setFont(FONT,'bold'); doc.setFontSize(28); st(W);
  const nameLn: string[] = doc.splitTextToSize(co, CW - 10);
  doc.text(nameLn.slice(0, 2), M+4, nameY);
  const afterName = nameY + Math.min(nameLn.length, 2) * 12;

  // ── Ticker badge + Exchange badge + Date ──────────────────────────────
  const badgeY = afterName + 2;
  // Ticker pill
  sf(G); doc.roundedRect(M+4, badgeY, 32, 9, 2, 2, 'F');
  doc.setFont(FONT,'bold'); doc.setFontSize(10); st(W);
  doc.text(ticker, M+20, badgeY+6.5, { align:'center' });
  // Exchange pill
  sf(D3); doc.roundedRect(M+40, badgeY, 26, 9, 2, 2, 'F');
  doc.setFont(FONT,'bold'); doc.setFontSize(7.5); st(TL);
  doc.text(exch, M+53, badgeY+6, { align:'center' });
  // Date
  doc.setFont(FONT,'normal'); doc.setFontSize(7); st(TG);
  doc.text(date, M+72, badgeY+6);

  // Sector / Industry line
  doc.setFont(FONT,'normal'); doc.setFontSize(7.5); st(TG);
  doc.text(`${sect}  ·  ${ind}`, M+4, badgeY + 16);

  // ── 4 KPI cards ──────────────────────────────────────────────────────
  const kY = badgeY + 25;
  y = kpiRow(kY, [
    { label: 'Current Price', value: `$${f(price)}` },
    { label: 'Market Cap',    value: fl(quote?.marketCap) },
    { label: 'P/E Ratio',     value: f(quote?.pe) },
    { label: 'Avg Valuation', value: avgVal ? `$${f(avgVal)}` : '-', color: G, accent: true },
  ]);

  // ── Upside/Downside highlight card ────────────────────────────────────
  if (avgVal && price) {
    const up   = (avgVal - price) / price * 100;
    const isUp = up >= 0;
    const uColor: RGB = isUp ? G : RD;
    const ubg: RGB = isUp ? [0, 50, 25] : [60, 8, 8];

    sf(ubg); doc.roundedRect(M, y, CW, 16, 2.5, 2.5, 'F');
    ss(uColor); doc.setLineWidth(0.4); doc.roundedRect(M, y, CW, 16, 2.5, 2.5, 'S');

    // Left: label
    doc.setFont(FONT,'bold'); doc.setFontSize(7); st(TL);
    doc.text(isUp ? 'POTENTIAL UPSIDE' : 'POTENTIAL DOWNSIDE', M+8, y+7);
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    doc.text(`vs avg model valuation $${f(avgVal)}`, M+8, y+12.5);

    // Right: big percentage
    doc.setFont(FONT,'bold'); doc.setFontSize(18); st(uColor);
    doc.text(`${isUp?'+':''}${up.toFixed(1)}%`, PW-M-8, y+11, { align:'right' });

    y += 22;
  }

  // ── Revenue preview chart ─────────────────────────────────────────────
  const covInc = (income||[]).slice(0,5).reverse();
  if (covInc.length >= 2) {
    doc.setFont(FONT,'bold'); doc.setFontSize(6.5); st(TG);
    doc.text('REVENUE TREND', M+4, y+1);
    barChart(M+4, y+4, CW-8, 34,
      covInc.map((i:any) => i.date?.substring(0,4)||''),
      covInc.map((i:any) => i.revenue||0), G);
    y += 52;
  }

  // ── Description ──────────────────────────────────────────────────────
  if (profile?.description) {
    const desc = profile.description.substring(0, 400)+(profile.description.length>400?'…':'');
    doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TG);
    const dl:string[] = doc.splitTextToSize(desc, CW-8);
    doc.text(dl.slice(0,6), M+4, y);
  }

  // ── Cover footer ──────────────────────────────────────────────────────
  // Bottom accent bar
  sf(G); doc.rect(0, PH-2, PW, 2, 'F');
  // Footer text
  sf(D2); doc.rect(M, PH-18, CW, 14, 'F');
  doc.setFont(FONT,'normal'); doc.setFontSize(5.5); st(TG);
  doc.text('For informational purposes only  ·  Not financial advice  ·  Generated by Prismo', PW/2, PH-10, { align:'center' });
  appLogo(PW/2 - 4, PH-24, 8);

  } // end cover

  // ════════════════════════════════════════════════════════════════════════
  // COMPANY OVERVIEW (General tab)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('company_overview') && profile) {
    y = newPage();
    y = section(y, 'Company Overview', 'Perfil corporativo, descripción y datos clave de la empresa.');

    // Profile pills
    const profPills: [string, string][] = [
      ['Sector',    sect],
      ['Industry',  ind],
      ['Exchange',  exch],
      ['Country',   profile.country || '-'],
      ['CEO',       profile.ceo || '-'],
      ['Employees', profile.fullTimeEmployees ? (+profile.fullTimeEmployees).toLocaleString() : '-'],
      ['IPO Date',  profile.ipoDate || '-'],
      ['Currency',  profile.currency || '-'],
    ];
    const ppW = (CW - 3*3) / 4;
    profPills.forEach(([l, v], i) => {
      const row = Math.floor(i/4), col = i%4;
      pill(M + col*(ppW+3), y + row*16, ppW, l, v.length > 12 ? v.substring(0,11)+'…' : v);
    });
    y += 34;

    // Description
    if (profile.description) {
      y = checkY(y, 50);
      y = section(y, 'Business Description');
      doc.setFont(FONT,'normal'); doc.setFontSize(7.5); st(TW);
      const desc = profile.description.substring(0, 1200) + (profile.description.length > 1200 ? '...' : '');
      const dl: string[] = doc.splitTextToSize(desc, CW - 4);
      const maxLines = Math.min(dl.length, 28);
      for (let i = 0; i < maxLines; i++) {
        if (y > PH - 18) y = newPage();
        doc.text(dl[i], M, y);
        y += 4.5;
      }
      y += 4;
    }

    // Key financial highlights table
    y = checkY(y, 40);
    y = section(y, 'Key Financial Highlights');
    const highRows = filterRows([
      ['Market Cap',       fl(quote?.marketCap),          'Enterprise Value',  fl(KM.enterpriseValue)],
      ['Revenue (TTM)',    fl(incomeTTM?.revenue),         'Net Income (TTM)',  fl(incomeTTM?.netIncome)],
      ['EPS (Diluted)',    `$${f(quote?.eps)}`,            'P/E Ratio',         f(quote?.pe)],
      ['52W High',         `$${f(quote?.yearHigh)}`,       '52W Low',           `$${f(quote?.yearLow)}`],
      ['Dividend Yield',   fp((quote?.dividendYield||0)*100), 'Beta',           f(profile.beta)],
      ['Avg Volume',       fl(quote?.avgVolume),           'Shares Out.',       fl(quote?.sharesOutstanding)],
    ], [1, 3]);
    if (highRows.length > 0) {
      y = atable({
        startY: y,
        body: highRows,
        columnStyles: {
          0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
          1:{cellWidth:42},
          2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
          3:{cellWidth:42},
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE — FINANCIAL HIGHLIGHTS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('market_summary') && quote) {
  y = newPage();

  // Market summary pills
  y = section(y, 'Market Summary', 'Resumen de los indicadores clave de precio y mercado.');
  const pills = [
    ['Price',    `$${f(price)}`],
    ['Day Chg',  fp(quote?.changesPercentage)],
    ['Mkt Cap',  fl(quote?.marketCap)],
    ['52W High', `$${f(quote?.yearHigh)}`],
    ['52W Low',  `$${f(quote?.yearLow)}`],
    ['Vol',      fl(quote?.volume)],
    ['MA50',     `$${f(quote?.priceAvg50)}`],
    ['MA200',    `$${f(quote?.priceAvg200)}`],
    ['P/E',      f(quote?.pe)],
    ['EPS',      `$${f(quote?.eps)}`],
    ['Div Yld',  fp((quote?.dividendYield||0)*100)],
    ['Beta',     f(quote?.beta)],
  ];
  const pW = (CW - 5*2) / 6;
  pills.forEach(([l, v], i) => {
    const row = Math.floor(i/6), col = i%6;
    const vc = l==='Day Chg' && quote?.changesPercentage<0 ? RD : undefined;
    pill(M + col*(pW+2), y + row*16, pW, l, v, vc);
  });
  y += 34;

  // Charts: Revenue + Net Income side by side
  const inc5 = (income||[]).slice(0,5).reverse();
  if (inc5.length >= 2) {
    y = checkY(y, 58);
    y = section(y, 'Revenue & Net Income Trend');
    const hw = (CW/2) - 4;
    barChart(M, y, hw, 40, inc5.map((i:any)=>i.date?.substring(0,4)||''), inc5.map((i:any)=>i.revenue||0), G);
    barChart(M+hw+8, y, hw, 40, inc5.map((i:any)=>i.date?.substring(0,4)||''), inc5.map((i:any)=>i.netIncome||0), [80,190,130] as RGB);
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    doc.text('Revenue', M+hw/2, y+47, { align:'center' });
    doc.text('Net Income', M+hw+8+hw/2, y+47, { align:'center' });
    y += 52;
  }

  // Margins chart
  if (inc5.length >= 2) {
    y = checkY(y, 50);
    y = section(y, 'Profit Margins (%)');
    const mW = (CW-8)/3;
    const margins = [
      { label:'Gross Margin',    key:'grossProfitRatio',      color:G },
      { label:'Operating Margin',key:'operatingIncomeRatio',  color:[0,140,200] as RGB },
      { label:'Net Margin',      key:'netIncomeRatio',        color:[80,190,130] as RGB },
    ];
    margins.forEach((m, mi) => {
      barChart(M+mi*(mW+4), y, mW, 30,
        inc5.map((i:any)=>i.date?.substring(0,4)||''),
        inc5.map((i:any)=>(i[m.key]||0)*100),
        m.color, true);
      doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
      doc.text(m.label, M+mi*(mW+4)+mW/2, y+37, { align:'center' });
    });
    y += 43;
  }

  // Balance sheet table
  y = checkY(y, 45);
  y = section(y, 'Balance Sheet — Latest Year');
  const bal = (balance||[])[0] || {};
  y = atable({
    startY: y,
    body: [
      ['Total Assets',       fl(bal.totalAssets),                              'Total Liabilities',  fl(bal.totalLiabilities)],
      ['Shareholders Equity',fl(bal.totalStockholdersEquity||bal.totalEquity), 'Total Debt',         fl(bal.totalDebt)],
      ['Cash & Equiv.',      fl(bal.cashAndCashEquivalents),                   'Net Debt',           fl(bal.netDebt)],
      ['Current Assets',     fl(bal.totalCurrentAssets),                       'Current Liabilities',fl(bal.totalCurrentLiabilities)],
    ],
    columnStyles: {
      0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
      1:{cellWidth:42},
      2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
      3:{cellWidth:42},
    },
  });

  // Cash flow highlights
  const cf3 = (cashFlow||[]).slice(0,3).reverse();
  if (cf3.length > 0) {
    y = checkY(y, 45);
    y = section(y, 'Cash Flow Statement');
    const cfH = ['',  ...cf3.map((c:any)=>c.date?.substring(0,4)||'')];
    y = atable({
      startY: y,
      head: [cfH],
      body: [
        ['Operating Cash Flow', ...cf3.map((c:any)=>fl(c.operatingCashFlow||c.netCashProvidedByOperatingActivities))],
        ['Free Cash Flow',      ...cf3.map((c:any)=>fl(c.freeCashFlow))],
        ['CapEx',               ...cf3.map((c:any)=>fl(c.capitalExpenditure))],
        ['Dividends Paid',      ...cf3.map((c:any)=>fl(c.dividendsPaid))],
      ],
      columnStyles: {0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:52}},
    });
  }
  } // end market_summary

  // ════════════════════════════════════════════════════════════════════════
  // INCOME STATEMENT — DETAILED 5-YEAR TABLE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('income_statement')) {
    const inc5 = (income||[]).slice(0,5).reverse();
    if (inc5.length > 0) {
      y = newPage();
      y = section(y, 'Income Statement — Annual Detail', 'Estado de resultados de los últimos 5 años fiscales.');
      const yrs = inc5.map((i:any) => i.date?.substring(0,4)||'');
      y = atable({
        startY: y,
        head:  [['', ...yrs]],
        body: [
          ['Revenue',             ...inc5.map((i:any) => fl(i.revenue))],
          ['Cost of Revenue',     ...inc5.map((i:any) => fl(i.costOfRevenue))],
          ['Gross Profit',        ...inc5.map((i:any) => fl(i.grossProfit))],
          ['Gross Margin %',      ...inc5.map((i:any) => fp((i.grossProfitRatio||0)*100))],
          ['R&D Expenses',        ...inc5.map((i:any) => fl(i.researchAndDevelopmentExpenses))],
          ['SG&A Expenses',       ...inc5.map((i:any) => fl(i.sellingGeneralAndAdministrativeExpenses))],
          ['Operating Income',    ...inc5.map((i:any) => fl(i.operatingIncome))],
          ['Operating Margin %',  ...inc5.map((i:any) => fp((i.operatingIncomeRatio||0)*100))],
          ['EBITDA',              ...inc5.map((i:any) => fl(i.ebitda))],
          ['Interest Expense',    ...inc5.map((i:any) => fl(i.interestExpense))],
          ['Income Before Tax',   ...inc5.map((i:any) => fl(i.incomeBeforeTax))],
          ['Income Tax',          ...inc5.map((i:any) => fl(i.incomeTaxExpense))],
          ['Net Income',          ...inc5.map((i:any) => fl(i.netIncome))],
          ['Net Margin %',        ...inc5.map((i:any) => fp((i.netIncomeRatio||0)*100))],
          ['EPS (Diluted)',        ...inc5.map((i:any) => `$${f(i.epsdiluted||i.eps)}`)],
        ],
        columnStyles: { 0:{ fontStyle:'bold', fillColor:[14,14,14], cellWidth:52 } },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // BALANCE SHEET — DETAILED 5-YEAR TABLE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('balance_sheet')) {
    const bal5 = (balance||[]).slice(0,5).reverse();
    if (bal5.length > 0) {
      y = newPage();
      y = section(y, 'Balance Sheet — Annual Detail', 'Composición de activos, pasivos y patrimonio.');
      const yrs = bal5.map((b:any) => b.date?.substring(0,4)||'');
      y = atable({
        startY: y,
        head:  [['ASSETS', ...yrs]],
        body: [
          ['Cash & Equivalents',      ...bal5.map((b:any) => fl(b.cashAndCashEquivalents))],
          ['Short-term Investments',  ...bal5.map((b:any) => fl(b.shortTermInvestments))],
          ['Receivables',             ...bal5.map((b:any) => fl(b.netReceivables))],
          ['Inventory',               ...bal5.map((b:any) => fl(b.inventory))],
          ['Total Current Assets',    ...bal5.map((b:any) => fl(b.totalCurrentAssets))],
          ['PP&E (Net)',               ...bal5.map((b:any) => fl(b.propertyPlantEquipmentNet))],
          ['Goodwill',                ...bal5.map((b:any) => fl(b.goodwill))],
          ['Total Assets',            ...bal5.map((b:any) => fl(b.totalAssets))],
        ],
        columnStyles: { 0:{ fontStyle:'bold', fillColor:[14,14,14], cellWidth:52 } },
      });
      y = atable({
        startY: y,
        head:  [['LIABILITIES & EQUITY', ...yrs]],
        body: [
          ['Accounts Payable',            ...bal5.map((b:any) => fl(b.accountPayables))],
          ['Short-term Debt',             ...bal5.map((b:any) => fl(b.shortTermDebt))],
          ['Total Current Liabilities',   ...bal5.map((b:any) => fl(b.totalCurrentLiabilities))],
          ['Long-term Debt',              ...bal5.map((b:any) => fl(b.longTermDebt))],
          ['Total Liabilities',           ...bal5.map((b:any) => fl(b.totalLiabilities))],
          ["Shareholders' Equity",        ...bal5.map((b:any) => fl(b.totalStockholdersEquity||b.totalEquity))],
          ['Net Debt',                    ...bal5.map((b:any) => fl(b.netDebt))],
        ],
        columnStyles: { 0:{ fontStyle:'bold', fillColor:[14,14,14], cellWidth:52 } },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // CASH FLOW — DETAILED 5-YEAR TABLE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('cash_flow')) {
    const cf5 = (cashFlow||[]).slice(0,5).reverse();
    if (cf5.length > 0) {
      y = newPage();
      y = section(y, 'Cash Flow Statement — Annual Detail', 'Flujo de caja operativo, de inversión y financiamiento.');
      const yrs = cf5.map((c:any) => c.date?.substring(0,4)||'');
      y = atable({
        startY: y,
        head:  [['', ...yrs]],
        body: [
          ['Net Income',              ...cf5.map((c:any) => fl(c.netIncome))],
          ['D&A',                     ...cf5.map((c:any) => fl(c.depreciationAndAmortization))],
          ['Stock-Based Comp.',       ...cf5.map((c:any) => fl(c.stockBasedCompensation))],
          ['Working Capital Chg.',    ...cf5.map((c:any) => fl(c.changeInWorkingCapital))],
          ['Operating Cash Flow',     ...cf5.map((c:any) => fl(c.operatingCashFlow||c.netCashProvidedByOperatingActivities))],
          ['CapEx',                   ...cf5.map((c:any) => fl(c.capitalExpenditure))],
          ['Free Cash Flow',          ...cf5.map((c:any) => fl(c.freeCashFlow))],
          ['Acquisitions (Net)',       ...cf5.map((c:any) => fl(c.acquisitionsNet))],
          ['Investing Cash Flow',     ...cf5.map((c:any) => fl(c.netCashUsedForInvestingActivites))],
          ['Debt Issuance/Repayment', ...cf5.map((c:any) => fl(c.debtRepayment))],
          ['Dividends Paid',          ...cf5.map((c:any) => fl(c.dividendsPaid))],
          ['Stock Buybacks',          ...cf5.map((c:any) => fl(c.commonStockRepurchased))],
          ['Financing Cash Flow',     ...cf5.map((c:any) => fl(c.netCashUsedProvidedByFinancingActivities))],
          ['Net Change in Cash',      ...cf5.map((c:any) => fl(c.netChangeInCash))],
        ],
        columnStyles: { 0:{ fontStyle:'bold', fillColor:[14,14,14], cellWidth:52 } },
      });
      // FCF trend chart
      if (cf5.length >= 2) {
        y = checkY(y, 55);
        y = section(y, 'Free Cash Flow Trend');
        barChart(M, y, CW, 40, yrs, cf5.map((c:any) => c.freeCashFlow||0), G);
        y += 50;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // VALUATION MODELS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('valuation_models')) {
  y = newPage();

  // Valuation model visual bars
  y = section(y, 'Valuation Model Comparison vs Current Price', 'Valuación intrínseca estimada por múltiples modelos.');
  // Use ML-backed valuations if available, otherwise compute from raw FMP data
  const avnVals = sharedAdvanceValueNet?.valuations;
  const models: {name:string; val:number}[] = [];
  if (avnVals) {
    Object.entries(avnVals).forEach(([k,v]) => {
      if (typeof v==='number' && isFinite(v) && v>0) {
        models.push({ name:k.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase()).substring(0,18), val:+v });
      }
    });
  }
  // Fallback: compute valuation models from raw data
  if (models.length === 0) {
    const computed = computeValuationModels(dcfCustom, quote, KM);
    models.push(...computed);
  }
  if (avgVal) models.push({ name:'Average', val:avgVal });

  if (models.length>0 && price) {
    const maxV = Math.max(...models.map(m=>m.val), price)*1.08;
    const bH=5, bSp=8, barMaxW=CW-42;
    const pLine = M+36 + (price/maxV)*barMaxW;

    models.slice(0,10).forEach((m,i) => {
      const by = y + i*bSp;
      const bw = Math.max(2, (m.val/maxV)*barMaxW);
      // Label
      doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TG);
      doc.text(m.name, M, by+bH-0.5);
      // Bar
      sf(m.name==='Average' ? G : [20,60,35] as RGB);
      doc.roundedRect(M+36, by, bw, bH, 0.8, 0.8, 'F');
      // Value
      doc.setFont(FONT,'bold'); doc.setFontSize(6);
      st(m.name==='Average' ? G : TW);
      doc.text(`$${f(m.val,0)}`, M+36+bw+2, by+bH-0.5);
    });

    // Current price vertical line
    ss(W); doc.setLineWidth(0.5);
    doc.line(pLine, y-2, pLine, y + Math.min(models.length,10)*bSp+2);
    // Price label
    sf(W); doc.roundedRect(pLine-8, y-7, 16, 5, 1, 1, 'F');
    doc.setFont(FONT,'bold'); doc.setFontSize(6); st(BK);
    doc.text(`$${f(price,0)}`, pLine, y-3.5, { align:'center' });

    y += Math.min(models.length,10)*bSp + 10;
  }

  // Key Ratios
  const ratioRows = filterRows([
    ['P/E Ratio',         f(KM.peRatio ?? quote?.pe),          'P/B Ratio',          f(KM.priceToBook ?? KM.pbRatio)],
    ['EV/EBITDA',         f(KM.evToEbitda ?? KM.enterpriseValueOverEBITDA), 'P/FCF', f(KM.priceToFCF ?? KM.pfcfRatio)],
    ['ROE',               fp((KM.roe ?? KM.returnOnEquity ?? 0)*100),  'ROA',        fp((KM.roa ?? KM.returnOnAssets ?? 0)*100)],
    ['Debt / Equity',     f(KM.debtToEquity ?? KM.debtEquityRatio),    'Current Ratio', f(KM.currentRatio)],
    ['Gross Margin',      fp((KM.grossProfitMargin ?? income?.[0]?.grossProfitRatio ?? 0)*100), 'Net Margin', fp((KM.netProfitMargin ?? income?.[0]?.netIncomeRatio ?? 0)*100)],
    ['Interest Coverage', f(KM.interestCoverage),                       'Quick Ratio', f(KM.quickRatio)],
  ], [1, 3]);
  if (ratioRows.length > 0) {
    y = checkY(y, 45);
    y = section(y, 'Key Financial Ratios');
    y = atable({
      startY: y,
      head: [['Metric','Value','Metric','Value']],
      body: ratioRows,
      columnStyles:{
        0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:46},
        1:{cellWidth:42},
        2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:46},
        3:{cellWidth:46},
      },
    });
  }
  } // end valuation_models

  // ════════════════════════════════════════════════════════════════════════
  // DUPONT ANALYSIS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('dupont')) {
    const incLatest = (income||[])[0];
    const balLatest = (balance||[])[0];
    if (incLatest && balLatest) {
      y = newPage();
      y = section(y, 'DuPont Analysis — 3-Factor Decomposition', 'Descomposición del ROE en sus 3 factores.');

      const rev    = incLatest.revenue || 0;
      const ni     = incLatest.netIncome || 0;
      const ta     = balLatest.totalAssets || 1;
      const te     = balLatest.totalStockholdersEquity || balLatest.totalEquity || 1;

      const netMargin     = rev ? ni / rev : 0;
      const assetTurnover = ta  ? rev / ta : 0;
      const equityMult    = te  ? ta / te : 0;
      const roe           = netMargin * assetTurnover * equityMult;

      y = atable({
        startY: y,
        head: [['Component', 'Formula', 'Value']],
        body: [
          ['Net Profit Margin',  'Net Income / Revenue',        fp(netMargin * 100)],
          ['Asset Turnover',     'Revenue / Total Assets',      f(assetTurnover)],
          ['Equity Multiplier',  'Total Assets / Equity',       f(equityMult)],
          ['ROE (DuPont)',       'Margin × Turnover × Multiplier', fp(roe * 100)],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [14,14,14], cellWidth: 55 },
          1: { cellWidth: 70 },
          2: { cellWidth: 55 },
        },
      });

      // Visual bars for the 3 components
      y = checkY(y, 45);
      y = section(y, 'DuPont Component Breakdown');
      scoreBar(M, y, CW, 'Net Profit Margin', Math.min(100, Math.max(0, +(netMargin*100).toFixed(0))));
      y += 10;
      scoreBar(M, y, CW, 'Asset Turnover (×100)', Math.min(100, Math.max(0, +(assetTurnover*100).toFixed(0))));
      y += 10;
      scoreBar(M, y, CW, 'Equity Multiplier (×10)', Math.min(100, Math.max(0, +(equityMult*10).toFixed(0))));
      y += 10;

      ss(D3); doc.setLineWidth(0.2); doc.line(M, y+1, PW-M, y+1);
      doc.setFont(FONT,'bold'); doc.setFontSize(9); st(G);
      doc.text(`DuPont ROE: ${fp(roe*100)}`, M, y+8);
      y += 13;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMPANY QUALITY SCORE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('quality_score') && qualityNet?.scores) {
    y = newPage();
    y = section(y, 'Company Quality Score', 'Scoring de calidad empresarial en 5 dimensiones.');
    const sc = qualityNet.scores;
    Object.entries(sc).forEach(([dim, score]:any) => {
      const pct = typeof score==='number' ? +(score*100).toFixed(0) : 0;
      const lbl = dim.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());
      y = checkY(y, 9);
      scoreBar(M, y, CW, lbl, pct);
      y += 8;
    });
    const total = qualityNet.totalScore;
    if (total != null) {
      ss(D3); doc.setLineWidth(0.2); doc.line(M, y+1, PW-M, y+1);
      doc.setFont(FONT,'bold'); doc.setFontSize(9); st(G);
      doc.text(`Overall: ${(total*100).toFixed(0)}/100  ·  ${qualityNet.rating||''}`, M, y+8);
      y += 13;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // WACC & CAGR
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('wacc_cagr')) {
    const capRows: any[] = [];
    const waccVal = sharedWACC ?? dcfCustom?.wacc;
    const capmVal = sharedAvgCAPM ?? dcfCustom?.costOfEquity;
    if (waccVal)    capRows.push(['WACC (Weighted Avg Cost of Capital)', fp(waccVal)]);
    if (capmVal)    capRows.push(['Cost of Equity — CAPM', fp(capmVal)]);
    if (dcfCustom?.costOfDebt) capRows.push(['Cost of Debt', fp(dcfCustom.costOfDebt)]);
    if (dcfCustom?.riskFreeRate) capRows.push(['Risk-Free Rate', fp(dcfCustom.riskFreeRate)]);
    if (cagrStats?.avgCagr != null) capRows.push(['Historical Revenue CAGR (Avg)', fp(cagrStats.avgCagr)]);
    if (cagrStats?.minCagr != null) capRows.push(['CAGR Range (Min – Max)', `${fp(cagrStats.minCagr)} – ${fp(cagrStats.maxCagr)}`]);
    if (capRows.length > 0) {
      y = checkY(y, 35);
      y = section(y, 'Cost of Capital — WACC & CAGR', 'Costo promedio ponderado de capital y tasas de crecimiento compuesto.');
      y = atable({ startY: y, head: [['Metric', 'Value']], body: capRows,
        columnStyles: { 0: { fontStyle: 'bold', fillColor: [14, 14, 14], cellWidth: 120 }, 1: { cellWidth: 60 } } });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUSTAINABLE GROWTH RATE (SGR)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('sgr')) {
    const incSgr = (income||[])[0];
    const balSgr = (balance||[])[0];
    const cfSgr  = (cashFlow||[])[0];
    if (incSgr && balSgr) {
      y = checkY(y, 55);
      y = section(y, 'Sustainable Growth Rate (SGR)', 'Tasa de crecimiento sostenible basada en retención de ganancias.');

      const niSgr  = incSgr.netIncome || 0;
      const eqSgr  = balSgr.totalStockholdersEquity || balSgr.totalEquity || 1;
      const divP   = Math.abs(cfSgr?.dividendsPaid || 0);
      const roeSgr = niSgr / eqSgr;
      const payR   = niSgr ? divP / niSgr : 0;
      const retR   = 1 - payR;
      const sgr    = roeSgr * retR;

      y = atable({
        startY: y,
        head: [['Component', 'Value']],
        body: [
          ['Return on Equity (ROE)',   fp(roeSgr * 100)],
          ['Dividends Paid',           fl(divP)],
          ['Net Income',               fl(niSgr)],
          ['Payout Ratio',             fp(payR * 100)],
          ['Retention Ratio (b)',      fp(retR * 100)],
          ['SGR = ROE × b',           fp(sgr * 100)],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [14,14,14], cellWidth: 120 },
          1: { cellWidth: 60 },
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // KEY METRICS — EXTENDED TABLE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('key_metrics')) {
    const kmRows = filterRows([
      ['P/E Ratio',             f(KM.peRatio ?? quote?.pe),             'P/B Ratio',             f(KM.priceToBook ?? KM.pbRatio)],
      ['P/S Ratio',             f(KM.priceToSalesRatio ?? KM.priceToSales), 'P/FCF',             f(KM.priceToFCF ?? KM.pfcfRatio)],
      ['EV/EBITDA',             f(KM.evToEbitda ?? KM.enterpriseValueOverEBITDA), 'EV/Sales',     f(KM.evToSales ?? KM.evToRevenue)],
      ['ROE',                   fp((KM.roe ?? KM.returnOnEquity ?? 0)*100),       'ROA',          fp((KM.roa ?? KM.returnOnAssets ?? 0)*100)],
      ['ROIC',                  fp((KM.roic ?? KM.returnOnCapitalEmployed ?? 0)*100), 'Ret. on Capital', fp((KM.returnOnCapitalEmployed ?? 0)*100)],
      ['Gross Margin',          fp((KM.grossProfitMargin ?? income?.[0]?.grossProfitRatio ?? 0)*100), 'Operating Margin', fp((KM.operatingProfitMargin ?? income?.[0]?.operatingIncomeRatio ?? 0)*100)],
      ['Net Margin',            fp((KM.netProfitMargin ?? income?.[0]?.netIncomeRatio ?? 0)*100), 'FCF Margin', fp((KM.freeCashFlowMargin ?? 0)*100)],
      ['Debt / Equity',         f(KM.debtToEquity ?? KM.debtEquityRatio),  'Net Debt / EBITDA',  f(KM.netDebtToEBITDA)],
      ['Current Ratio',         f(KM.currentRatio),                         'Quick Ratio',         f(KM.quickRatio)],
      ['Interest Coverage',     f(KM.interestCoverage),                     'Payout Ratio',        fp((KM.payoutRatio ?? 0)*100)],
      ['Book Value / Share',    `$${f(KM.bookValuePerShare)}`,              'Revenue / Share',     `$${f(KM.revenuePerShare)}`],
      ['FCF / Share',           `$${f(KM.freeCashFlowPerShare)}`,           'Earnings Yield',      fp((KM.earningsYield ?? 0)*100)],
      ['Dividend Yield',        fp((KM.dividendYield ?? quote?.dividendYield ?? 0)*100), 'Enterprise Value', fl(KM.enterpriseValue)],
    ], [1, 3]);
    if (kmRows.length > 0) {
      y = newPage();
      y = section(y, 'Key Metrics — Extended Analysis', 'Ratios financieros fundamentales y métricas de eficiencia.');
      y = atable({
        startY: y,
        head: [['Metric','Value','Metric','Value']],
        body: kmRows,
        columnStyles: {
          0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:50},
          1:{cellWidth:36},
          2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:50},
          3:{cellWidth:44},
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ANALYST FORECASTS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('analyst_forecasts') && forecasts.length > 0) {
    const fcSlice = forecasts.slice(0, 6);
    const fcRows = filterRows(
      fcSlice.map((fc: any) => [
        fc.date?.substring(0, 4) || '-',
        fl(fc.estimatedRevenueAvg),
        `$${f(fc.estimatedEpsAvg)}`,
        fl(fc.estimatedNetIncomeAvg),
        fl(fc.estimatedEbitdaAvg),
      ]),
      [1, 2, 3, 4],
    );
    if (fcRows.length > 0) {
      y = newPage();
      y = section(y, 'Analyst Consensus Estimates', 'Estimaciones de analistas para los próximos años.');
      y = atable({
        startY: y,
        head: [['Year', 'Revenue Est.', 'EPS Est.', 'Net Income', 'EBITDA Est.']],
        body: fcRows,
      });

      // Revenue forecast bar chart
      const revData = fcSlice.filter((fc: any) => fc.estimatedRevenueAvg);
      if (revData.length >= 2) {
        y = checkY(y, 58);
        y = section(y, 'Revenue Forecast Chart (Analyst Consensus)');
        barChart(M, y, CW, 42,
          revData.map((fc: any) => fc.date?.substring(0, 4) || ''),
          revData.map((fc: any) => fc.estimatedRevenueAvg || 0), G);
        y += 50;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRICE TARGET
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('price_target')) {
    const tgt  = priceTarget?.priceTarget || priceTarget?.priceTargetAvg;
    const tgtH = priceTarget?.priceTargetHigh;
    const tgtL = priceTarget?.priceTargetLow;

    if (tgt && tgtL && tgtH && price) {
      y = newPage();
      y = section(y, 'Analyst Price Target', 'Rango de precio objetivo según consenso de analistas.');

      const mn  = Math.min(+price, +tgtL)*0.94;
      const mx  = Math.max(+price, +tgtH)*1.06;
      const rng = mx - mn;
      const scl = (CW-20) / rng;
      const tY  = y + 12;

      // Track
      sf(D3); doc.roundedRect(M+10, tY, CW-20, 5, 1.5, 1.5, 'F');
      // Range band (green)
      sf([0,55,28] as RGB);
      doc.roundedRect(M+10+(tgtL-mn)*scl, tY, (tgtH-tgtL)*scl, 5, 1, 1, 'F');
      // Current price dot
      const pX = M+10+(price-mn)*scl;
      sf(W); doc.circle(pX, tY+2.5, 2.5, 'F');
      // Target dot
      const tX2 = M+10+(tgt-mn)*scl;
      sf(G); doc.circle(tX2, tY+2.5, 2.5, 'F');

      doc.setFont(FONT,'bold'); doc.setFontSize(6.5);
      st(W); doc.text(`$${f(price,0)}`, pX, tY+11, { align:'center' });
      st(G); doc.text(`$${f(tgt,0)}\nTarget`, tX2, tY+11, { align:'center' });
      st(TG); doc.setFontSize(5.5);
      doc.text(`L $${f(tgtL,0)}`, M+10+(tgtL-mn)*scl, tY-2, { align:'center' });
      doc.text(`H $${f(tgtH,0)}`, M+10+(tgtH-mn)*scl, tY-2, { align:'center' });

      y = tY + 22;
      y = atable({
        startY: y,
        head:[['Metric','Value']],
        body:[
          ['Average Price Target', `$${f(tgt)}`],
          ['Median Target',        `$${f(priceTarget.priceTargetMedian)}`],
          ['High / Low Target',    `$${f(tgtH)} / $${f(tgtL)}`],
          ['Number of Analysts',   f(priceTarget.numberOfAnalysts||priceTarget.lastMonthNumberOfAnalysts,0)],
          ['Consensus Rating',     priceTarget.consensus||priceTarget.lastMonthConsensus||'-'],
        ],
        columnStyles:{0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:90},1:{cellWidth:90}},
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // TTM SNAPSHOT
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('ttm_snapshot')) {
    const ttm = Array.isArray(incomeTTM) ? incomeTTM[0] : incomeTTM;
    if (ttm) {
      y = checkY(y, 42);
      y = section(y, 'Trailing Twelve Months (TTM)', 'Métricas trailing twelve months más recientes.');
      y = atable({
        startY: y,
        body:[
          ['Revenue TTM',        fl(ttm.revenue),                          'Gross Profit TTM',  fl(ttm.grossProfit)],
          ['EBITDA TTM',         fl(ttm.ebitda),                           'Net Income TTM',    fl(ttm.netIncome)],
          ['EPS Diluted TTM',    `$${f(ttm.epsdiluted||ttm.eps)}`,         'Gross Margin TTM',  fp((ttm.grossProfitRatio||0)*100)],
          ['Oper Margin TTM',    fp((ttm.operatingIncomeRatio||0)*100),     'Net Margin TTM',    fp((ttm.netIncomeRatio||0)*100)],
        ],
        columnStyles:{
          0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
          1:{cellWidth:42},
          2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
          3:{cellWidth:42},
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 52-WEEK PRICE POSITION
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('technical_52w') && pivot) {
    const pa52 = pivot;

    if (pa52.low52Week && pa52.high52Week && price) {
      y = newPage();
      y = section(y, '52-Week Price Position', 'Posición del precio relativa al rango de 52 semanas.');
      const lo = +pa52.low52Week*0.96, hi = +pa52.high52Week*1.04;
      const sp = hi-lo, sc = (CW-20)/sp;
      const tY = y+10;

      // Track
      sf(D3); doc.roundedRect(M+10, tY, CW-20, 6, 2, 2, 'F');
      // Fill to price
      const ppos = M+10+(price-lo)*sc;
      sf(G); doc.roundedRect(M+10, tY, ppos-(M+10), 6, 2, 2, 'F');

      // Dot
      sf(W); doc.circle(ppos, tY+3, 3, 'F');

      doc.setFont(FONT,'bold'); doc.setFontSize(7); st(W);
      doc.text(`$${f(price,0)}`, ppos, tY+13, { align:'center' });
      st(TG); doc.setFontSize(6);
      doc.text(`$${f(pa52.low52Week,0)}  52W Low`, M+10, tY+13);
      doc.text(`52W High  $${f(pa52.high52Week,0)}`, PW-M-10, tY+13, { align:'right' });

      // % from high
      doc.setFont(FONT,'bold'); doc.setFontSize(8);
      const fromHigh = ((price/pa52.high52Week)-1)*100;
      st(fromHigh < -20 ? RD : fromHigh < -5 ? [200,150,0] as RGB : G);
      doc.text(`${fromHigh.toFixed(1)}% from 52W High`, PW/2, tY+21, { align:'center' });

      y = tY + 27;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PIVOTS & FIBONACCI
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('pivots_fibonacci') && pivot?.pivotPoint) {
    const paFib = pivot;
    y = checkY(y, 50);
    y = section(y, 'Pivot Points & Fibonacci Levels', 'Niveles de soporte, resistencia y retrocesos Fibonacci.');
    y = atable({
      startY: y,
      head:[['Level','Price','Level','Price']],
      body:[
        ['Pivot Point',    `$${f(paFib.pivotPoint)}`,          'Current Price',   `$${f(paFib.currentPrice)}`],
        ['Resistance R1',  `$${f(paFib.resistance?.R1)}`,      'Resistance R2',   `$${f(paFib.resistance?.R2)}`],
        ['Support S1',     `$${f(paFib.support?.S1)}`,         'Support S2',      `$${f(paFib.support?.S2)}`],
        ['Fibonacci 23.6%',`$${f(paFib.fibonacci?.level236)}`, 'Fibonacci 38.2%', `$${f(paFib.fibonacci?.level382)}`],
        ['Fibonacci 50.0%',`$${f(paFib.fibonacci?.level500)}`, 'Fibonacci 61.8%', `$${f(paFib.fibonacci?.level618)}`],
        ['Fibonacci 78.6%',`$${f(paFib.fibonacci?.level786)}`, '% from 52W Low',  fp(paFib.priceVsLow)],
      ],
      columnStyles:{
        0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
        1:{cellWidth:42},
        2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48},
        3:{cellWidth:42},
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // BETA & CAPM
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('beta_capm')) {
    const beta = profile?.beta;
    const riskFree = dcfCustom?.riskFreeRate ?? 4.25;
    const erp = 5.5; // standard US ERP
    if (beta != null) {
      y = checkY(y, 60);
      y = section(y, 'Beta & Cost of Equity (CAPM)', 'Análisis de riesgo sistemático y costo del capital propio.');

      const capm = riskFree + beta * erp;

      y = atable({
        startY: y,
        head: [['Parameter', 'Value']],
        body: [
          ['Levered Beta (FMP)',  f(beta)],
          ['Risk-Free Rate',     fp(riskFree)],
          ['Equity Risk Premium', fp(erp)],
          ['Cost of Equity (CAPM)', fp(capm)],
          ['CAPM Formula',       `Ke = ${f(riskFree,1)}% + ${f(beta)} × ${f(erp,1)}% = ${fp(capm)}`],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: [14,14,14], cellWidth: 100 },
          1: { cellWidth: 80 },
        },
      });

      // Beta interpretation
      y = checkY(y, 18);
      const betaInt = beta > 1.3 ? 'High volatility — stock amplifies market moves' :
                      beta > 0.8 ? 'Moderate volatility — moves roughly with the market' :
                      beta > 0 ? 'Low volatility — defensive, less sensitive to market' :
                      'Negative beta — inversely correlated with market';
      doc.setFont(FONT,'italic'); doc.setFontSize(7); st(TG);
      doc.text(`Interpretation: β = ${f(beta)} → ${betaInt}`, M, y);
      y += 8;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // REVENUE FORECAST (Holt's + Regression)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('revenue_forecast') && income?.length >= 3) {
    y = newPage();
    y = section(y, 'Revenue Forecast — Holt\'s & Regression', 'Proyección de ingresos usando suavizado exponencial y regresión lineal.');

    // Compute Holt's forecast
    const revSorted = [...income].filter((i:any) => i.revenue > 0)
      .sort((a:any,b:any) => (a.date||'').localeCompare(b.date||''));
    const revData = revSorted.map((i:any) => i.revenue);

    if (revData.length >= 3) {
      const alpha = 0.6, betaH = 0.3;
      let level = revData[0], trend = revData[1] - revData[0];
      const fitted: number[] = [level];
      for (let t = 1; t < revData.length; t++) {
        const prevLevel = level;
        const prevTrend = trend;
        level = alpha * revData[t] + (1 - alpha) * (prevLevel + prevTrend);
        trend = betaH * (level - prevLevel) + (1 - betaH) * prevTrend;
        fitted.push(level);
      }
      // Forecast 3 years
      const holtForecast: number[] = [];
      for (let h = 1; h <= 3; h++) holtForecast.push(level + trend * h);

      // Linear regression
      const n = revData.length;
      const xMean = (n - 1) / 2, yMean = revData.reduce((a:number,b:number) => a+b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (i - xMean) * (revData[i] - yMean); den += (i - xMean) ** 2; }
      const slope = den ? num / den : 0, intercept = yMean - slope * xMean;
      const regForecast: number[] = [];
      for (let h = 0; h < 3; h++) regForecast.push(intercept + slope * (n + h));

      // Build table
      const lastYear = parseInt(revSorted[revSorted.length-1]?.date?.substring(0,4) || '2024');
      const tBody: string[][] = [];
      // Historical
      revSorted.slice(-5).forEach((r:any) => {
        tBody.push([r.date?.substring(0,4)||'', fl(r.revenue), '-', '-']);
      });
      // Forecasted
      for (let h = 0; h < 3; h++) {
        tBody.push([
          String(lastYear + h + 1),
          '-',
          fl(holtForecast[h]),
          fl(regForecast[h]),
        ]);
      }
      y = atable({
        startY: y,
        head: [['Year', 'Actual Revenue', 'Holt\'s Forecast', 'Regression Forecast']],
        body: tBody,
        columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:35} },
      });

      // Bar chart: historical + Holt forecast
      y = checkY(y, 55);
      y = section(y, 'Revenue Projection Chart');
      const allLabels = [...revSorted.slice(-5).map((r:any)=>r.date?.substring(0,4)||''), ...Array.from({length:3},(_,i)=>String(lastYear+i+1)+'E')];
      const allValues = [...revSorted.slice(-5).map((r:any)=>r.revenue||0), ...holtForecast];
      barChart(M, y, CW, 42, allLabels, allValues, G);
      y += 50;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // GROWTH ANALYSIS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('growth_analysis')) {
    const fg = (financialGrowth || [])[0];
    const ig = (incomeGrowth || [])[0];
    const growthRows = filterRows([
      ['Revenue Growth',        fp((fg?.revenueGrowth ?? ig?.growthRevenue ?? 0)*100),      'Net Income Growth',   fp((fg?.netIncomeGrowth ?? ig?.growthNetIncome ?? 0)*100)],
      ['EPS Growth',            fp((fg?.epsgrowth ?? fg?.epsGrowth ?? 0)*100),               'EBITDA Growth',       fp((fg?.ebitdagrowth ?? 0)*100)],
      ['Operating Income Gr.',  fp((fg?.operatingIncomeGrowth ?? ig?.growthOperatingIncome ?? 0)*100), 'Gross Profit Growth', fp((fg?.grossProfitGrowth ?? ig?.growthGrossProfit ?? 0)*100)],
      ['FCF Growth',            fp((fg?.freeCashFlowGrowth ?? 0)*100),                       'Book Value Growth',   fp((fg?.bookValueperShareGrowth ?? 0)*100)],
      ['Debt Growth',           fp((fg?.debtGrowth ?? 0)*100),                               'R&D Growth',          fp((fg?.rdexpenseGrowth ?? 0)*100)],
      ['Dividend / Share Gr.',  fp((fg?.dividendsperShareGrowth ?? 0)*100),                   'SGA Growth',          fp((fg?.sgaexpensesGrowth ?? 0)*100)],
      ['Asset Growth',          fp((fg?.assetGrowth ?? 0)*100),                               'Receivables Growth',  fp((fg?.receivablesGrowth ?? 0)*100)],
      ['Inventory Growth',      fp((fg?.inventoryGrowth ?? 0)*100),                           'Operating CF Growth',  fp((fg?.operatingCashFlowGrowth ?? 0)*100)],
    ], [1, 3]);
    if (growthRows.length > 0) {
      y = newPage();
      y = section(y, 'Growth Analysis — Year-over-Year', 'Análisis de crecimiento interanual en métricas clave.');
      y = atable({
        startY: y,
        head: [['Metric','YoY %','Metric','YoY %']],
        body: growthRows,
        columnStyles: {
          0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:52},
          1:{cellWidth:34},
          2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:52},
          3:{cellWidth:42},
        },
      });

      // CAGR summary
      if (cagrStats?.avgCagr != null) {
        y = checkY(y, 25);
        y = section(y, 'Revenue CAGR Summary');
        y = atable({
          startY: y,
          head: [['Metric', 'Value']],
          body: [
            ['Average CAGR (3/5/10Y)', fp(cagrStats.avgCagr)],
            ['Min CAGR', fp(cagrStats.minCagr)],
            ['Max CAGR', fp(cagrStats.maxCagr)],
          ],
          columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:120}, 1:{cellWidth:60} },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ENTERPRISE VALUE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('enterprise_value') && enterpriseValue?.length) {
    const ev5 = (enterpriseValue || []).slice(0, 5).reverse();
    if (ev5.length > 0) {
      y = checkY(y, 50);
      y = section(y, 'Enterprise Value Decomposition', 'Desglose del valor de empresa a lo largo del tiempo.');
      const evYrs = ev5.map((e:any) => e.date?.substring(0,4)||'');
      y = atable({
        startY: y,
        head: [['', ...evYrs]],
        body: [
          ['Market Cap',          ...ev5.map((e:any) => fl(e.marketCapitalization))],
          ['+ Total Debt',        ...ev5.map((e:any) => fl(e.addTotalDebt))],
          ['- Cash & Equiv.',     ...ev5.map((e:any) => fl(e.minusCashAndCashEquivalents))],
          ['= Enterprise Value',  ...ev5.map((e:any) => fl(e.enterpriseValue))],
          ['Shares Outstanding',  ...ev5.map((e:any) => fl(e.numberOfShares))],
          ['Stock Price',         ...ev5.map((e:any) => `$${f(e.stockPrice)}`)],
        ],
        columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:48} },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // DIVIDENDS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('dividends') && dividends?.length) {
    y = checkY(y, 50);
    y = section(y, 'Dividend History', 'Historial de pagos de dividendos por acción.');
    const divSlice = (dividends || []).slice(0, 12);
    const divRows = divSlice.map((dv:any) => [
      dv.date || dv.paymentDate || '-',
      `$${f(dv.dividend ?? dv.adjDividend, 4)}`,
      dv.recordDate || '-',
      dv.declarationDate || '-',
    ]);
    if (divRows.length > 0) {
      y = atable({
        startY: y,
        head: [['Date', 'Dividend/Share', 'Record Date', 'Declaration Date']],
        body: divRows,
        columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:42} },
      });
    }

    // Dividend summary
    const divYield = (quote?.dividendYield || 0) * 100;
    const payoutR = (KM.payoutRatio || 0) * 100;
    if (divYield > 0 || payoutR > 0) {
      y = checkY(y, 25);
      const divSumRows = [
        ['Annual Dividend Yield', fp(divYield)],
        ['Payout Ratio', fp(payoutR)],
      ];
      if (KM.dividendPerShare) divSumRows.push(['Dividend Per Share (TTM)', `$${f(KM.dividendPerShare)}`]);
      y = atable({
        startY: y,
        head: [['Metric', 'Value']],
        body: divSumRows,
        columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:120}, 1:{cellWidth:60} },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // OWNER EARNINGS (Buffett method)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('owner_earnings') && ownerEarnings?.length) {
    const oe5 = (ownerEarnings || []).slice(0, 5).reverse();
    if (oe5.length > 0) {
      y = newPage();
      y = section(y, 'Owner Earnings — Buffett Method', 'Ganancias del propietario: flujo real de caja disponible.');
      const oeYrs = oe5.map((o:any) => o.date?.substring(0,4)||'');
      y = atable({
        startY: y,
        head: [['', ...oeYrs]],
        body: filterRows([
          ['Net Income',           ...oe5.map((o:any) => fl(o.netIncome))],
          ['+ D&A',                ...oe5.map((o:any) => fl(o.depreciationAndAmortization))],
          ['- Maintenance CapEx',  ...oe5.map((o:any) => fl(o.maintenanceCapex))],
          ['- Working Capital Chg',...oe5.map((o:any) => fl(o.workingCapital))],
          ['= Owner Earnings',     ...oe5.map((o:any) => fl(o.ownerEarnings))],
          ['Owner Earnings / Share',...oe5.map((o:any) => `$${f(o.ownerEarningsPerShare)}`)],
          ['Growth CapEx',         ...oe5.map((o:any) => fl(o.growthCapex))],
        ], oeYrs.map((_:any,i:number) => i+1)),
        columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:50} },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMPETITORS (fetched from FMP)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('competitors')) {
    const peersRaw = await fmpFetch(`stable/stock-peers`, { symbol: ticker });
    const peers: string[] = (Array.isArray(peersRaw) ? peersRaw[0]?.peersList : peersRaw?.peersList) || [];
    if (peers.length > 0) {
      // Fetch quotes for peers
      const peerSymbols = peers.slice(0, 8).join(',');
      const peerQuotes = await fmpFetch(`stable/quote`, { symbol: peerSymbols });
      const allQuotes = Array.isArray(peerQuotes) ? peerQuotes : [peerQuotes];

      if (allQuotes.length > 0) {
        y = newPage();
        y = section(y, 'Peer Comparison — Competitors', 'Comparación con empresas del mismo sector.');

        const compRows = allQuotes.filter(Boolean).map((pq:any) => [
          pq.symbol || '-',
          pq.name?.substring(0, 25) || '-',
          fl(pq.marketCap),
          f(pq.pe),
          `$${f(pq.price)}`,
          fp(pq.changesPercentage),
        ]);

        // Add our company as first row
        compRows.unshift([
          ticker,
          co.substring(0, 25),
          fl(quote?.marketCap),
          f(quote?.pe),
          `$${f(price)}`,
          fp(quote?.changesPercentage),
        ]);

        y = atable({
          startY: y,
          head: [['Symbol', 'Company', 'Market Cap', 'P/E', 'Price', 'Change %']],
          body: compRows,
          columnStyles: {
            0:{fontStyle:'bold',cellWidth:22},
            1:{cellWidth:50},
          },
          didParseCell: (data:any) => {
            if (data.row.index === 0 && data.section === 'body') {
              data.cell.styles.fillColor = [0, 40, 20];
              data.cell.styles.textColor = G;
            }
          },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // INDUSTRY OVERVIEW
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('industry_overview')) {
    const [sectorPerf, sectorPE] = await Promise.all([
      fmpFetch('stable/sector-performance'),
      fmpFetch('stable/sector-pe-ratio', { exchange: 'NYSE' }),
    ]);

    const hasSector = Array.isArray(sectorPerf) && sectorPerf.length > 0;
    const hasPE = Array.isArray(sectorPE) && sectorPE.length > 0;

    if (hasSector || hasPE) {
      y = newPage();
      y = section(y, 'Industry & Sector Overview', 'Rendimiento y valoración relativa del sector.');

      // Company sector info
      y = checkY(y, 12);
      doc.setFont(FONT,'bold'); doc.setFontSize(7.5); st(G);
      doc.text(`Company Classification:  ${sect}  ·  ${ind}`, M, y);
      y += 8;

      if (hasSector) {
        y = section(y, 'Sector Performance');
        const sRows = (sectorPerf as any[]).sort((a:any,b:any) => {
          const av = parseFloat(String(a.changesPercentage||'0').replace('%',''));
          const bv = parseFloat(String(b.changesPercentage||'0').replace('%',''));
          return bv - av;
        }).map((s:any) => {
          const ch = parseFloat(String(s.changesPercentage||'0').replace('%',''));
          return [
            s.sector || '-',
            `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`,
          ];
        });
        y = atable({
          startY: y,
          head: [['Sector', 'Performance']],
          body: sRows,
          columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:110} },
          didParseCell: (data:any) => {
            if (data.section === 'body' && data.row.raw?.[0] === sect) {
              data.cell.styles.fillColor = [0, 40, 20];
              data.cell.styles.textColor = G;
            }
          },
        });
      }

      if (hasPE) {
        y = checkY(y, 40);
        y = section(y, 'Sector P/E Ratios');
        const peRows = (sectorPE as any[]).slice(0, 15).map((s:any) => [
          s.sector || '-',
          f(s.pe),
          s.exchange || '-',
        ]);
        y = atable({
          startY: y,
          head: [['Sector', 'P/E Ratio', 'Exchange']],
          body: peRows,
          columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:80} },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // HOLDERS (Institutional + Insider)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('holders')) {
    // Use pre-loaded holders from page.tsx when available
    const instHolders = preloadedHolders?.institutionalHolders?.length
      ? preloadedHolders.institutionalHolders
      : await fmpFetch(`stable/institutional-holder`, { symbol: ticker });
    const mutualHolders = await fmpFetch(`stable/mutual-fund-holder`, { symbol: ticker });
    const insiderTrades = await fmpFetch(`stable/insider-trading`, { symbol: ticker, limit: '15' });

    const hasInst = Array.isArray(instHolders) && instHolders.length > 0;
    const hasMutual = Array.isArray(mutualHolders) && mutualHolders.length > 0;
    const hasInsider = Array.isArray(insiderTrades) && insiderTrades.length > 0;

    if (hasInst || hasMutual || hasInsider) {
      y = newPage();
      y = section(y, 'Ownership & Holders', 'Principales accionistas institucionales, fondos mutuos y operaciones de insiders.');

      if (hasInst) {
        y = section(y, 'Top Institutional Holders');
        const instRows = (instHolders as any[]).slice(0, 10).map((h:any) => [
          (h.holder || h.investorName || '-').substring(0, 30),
          fl(h.shares),
          fl(h.value),
          h.dateReported?.substring(0,10) || '-',
        ]);
        y = atable({
          startY: y,
          head: [['Holder', 'Shares', 'Value', 'Date']],
          body: instRows,
          columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:60} },
        });
      }

      if (hasMutual) {
        y = checkY(y, 40);
        y = section(y, 'Top Mutual Fund Holders');
        const mfRows = (mutualHolders as any[]).slice(0, 10).map((h:any) => [
          (h.holder || '-').substring(0, 30),
          fl(h.shares),
          fl(h.value),
          fp((h.weightedAveragePercentage||0)),
        ]);
        y = atable({
          startY: y,
          head: [['Fund', 'Shares', 'Value', 'Weight %']],
          body: mfRows,
          columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:60} },
        });
      }

      if (hasInsider) {
        y = checkY(y, 40);
        y = section(y, 'Recent Insider Trading');
        const insRows = (insiderTrades as any[]).slice(0, 12).map((t:any) => [
          t.reportingName?.substring(0, 22) || '-',
          t.transactionType || '-',
          fl(t.securitiesTransacted),
          `$${f(t.price)}`,
          t.transactionDate?.substring(0,10) || '-',
        ]);
        y = atable({
          startY: y,
          head: [['Insider', 'Type', 'Shares', 'Price', 'Date']],
          body: insRows,
          columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:45} },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SEGMENTATION (Revenue by product + geography)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('segmentation')) {
    const [prodSeg, geoSeg] = await Promise.all([
      fmpFetch(`stable/revenue-product-segmentation`, { symbol: ticker }),
      fmpFetch(`stable/revenue-geographic-segmentation`, { symbol: ticker }),
    ]);

    const hasProd = Array.isArray(prodSeg) && prodSeg.length > 0;
    const hasGeo = Array.isArray(geoSeg) && geoSeg.length > 0;

    if (hasProd || hasGeo) {
      y = newPage();
      y = section(y, 'Revenue Segmentation', 'Desglose de ingresos por producto/servicio y por región geográfica.');

      if (hasProd) {
        // Get latest period
        const latest = prodSeg[0];
        const segments = typeof latest === 'object' ? latest : {};
        const dateKey = Object.keys(segments)[0];
        const segData = dateKey ? segments[dateKey] : segments;
        if (segData && typeof segData === 'object') {
          y = section(y, 'Product / Business Segments');
          const entries = Object.entries(segData).filter(([,v]) => typeof v === 'number' && (v as number) > 0);
          const total = entries.reduce((s, [,v]) => s + (v as number), 0);
          const segRows = entries
            .sort(([,a],[,b]) => (b as number) - (a as number))
            .map(([name, val]) => [
              name.substring(0, 35),
              fl(val),
              total > 0 ? fp(((val as number) / total) * 100) : '-',
            ]);
          if (segRows.length > 0) {
            y = atable({
              startY: y,
              head: [['Segment', 'Revenue', '% of Total']],
              body: segRows,
              columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:70} },
            });
          }
        }
      }

      if (hasGeo) {
        const latest = geoSeg[0];
        const segments = typeof latest === 'object' ? latest : {};
        const dateKey = Object.keys(segments)[0];
        const segData = dateKey ? segments[dateKey] : segments;
        if (segData && typeof segData === 'object') {
          y = checkY(y, 40);
          y = section(y, 'Geographic Segments');
          const entries = Object.entries(segData).filter(([,v]) => typeof v === 'number' && (v as number) > 0);
          const total = entries.reduce((s, [,v]) => s + (v as number), 0);
          const geoRows = entries
            .sort(([,a],[,b]) => (b as number) - (a as number))
            .map(([name, val]) => [
              name.substring(0, 35),
              fl(val),
              total > 0 ? fp(((val as number) / total) * 100) : '-',
            ]);
          if (geoRows.length > 0) {
            y = atable({
              startY: y,
              head: [['Region', 'Revenue', '% of Total']],
              body: geoRows,
              columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:70} },
            });
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // NEWS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('news')) {
    // Use pre-loaded news from page.tsx (avoids live fetch failures)
    const newsRaw = preloadedNews?.length ? preloadedNews : await fmpFetch(`stable/news/stock`, { symbol: ticker, limit: '15' });
    const newsData = Array.isArray(newsRaw) ? newsRaw : [];
    if (newsData.length > 0) {
      y = newPage();
      y = section(y, 'Latest News', 'Noticias recientes del mercado sobre la empresa.');

      newsData.slice(0, 15).forEach((article:any, idx:number) => {
        y = checkY(y, 18);
        // Title
        doc.setFont(FONT,'bold'); doc.setFontSize(7.5); st(TW);
        const title = (article.title || 'No title').substring(0, 90);
        doc.text(`${idx+1}. ${title}`, M, y);
        y += 4.5;
        // Meta
        doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TG);
        const meta = `${article.site || article.publishedDate?.substring(0,10) || '-'}  ·  ${article.publishedDate?.substring(0,10) || ''}`;
        doc.text(meta, M + 3, y);
        y += 3.5;
        // Snippet
        if (article.text) {
          doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st([170,170,170] as RGB);
          const snippet = article.text.substring(0, 150) + (article.text.length > 150 ? '...' : '');
          const sl: string[] = doc.splitTextToSize(snippet, CW - 6);
          sl.slice(0, 2).forEach((line:string) => {
            doc.text(line, M + 3, y);
            y += 3.5;
          });
        }
        y += 3;
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ANALISIS FINAL (Investment Verdict)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('analisis_final') && avgVal && price) {
    y = newPage();
    y = section(y, 'Investment Analysis — Final Verdict', 'Veredicto final basado en la valuación promedio vs precio actual.');

    const upside = ((avgVal - price) / price) * 100;
    const marginOfSafety = 0.15;
    const buyPrice = avgVal * (1 - marginOfSafety);
    const verdict = upside > 30 ? 'SIGNIFICANTLY UNDERVALUED' :
                    upside > 10 ? 'UNDERVALUED' :
                    upside > -10 ? 'FAIRLY VALUED' :
                    upside > -30 ? 'OVERVALUED' : 'SIGNIFICANTLY OVERVALUED';
    const vColor: RGB = upside > 10 ? G : upside > -10 ? [200,180,0] : RD;

    // Big verdict card
    sf(D1); doc.roundedRect(M, y, CW, 28, 3, 3, 'F');
    ss(vColor); doc.setLineWidth(0.5); doc.roundedRect(M, y, CW, 28, 3, 3, 'S');
    doc.setFont(FONT,'black'); doc.setFontSize(14); st(vColor);
    doc.text(verdict, PW/2, y+12, { align:'center' });
    doc.setFont(FONT,'bold'); doc.setFontSize(9); st(TW);
    doc.text(`Upside: ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%  ·  Avg Valuation: $${f(avgVal)}  ·  Current: $${f(price)}`, PW/2, y+21, { align:'center' });
    y += 34;

    // Key stats
    const vW = (CW - 9) / 4;
    [
      { l:'Current Price',     v:`$${f(price)}`,    c:TW },
      { l:'Avg Valuation',     v:`$${f(avgVal)}`,   c:G  },
      { l:'Buy Price (15% MoS)',v:`$${f(buyPrice)}`, c:[100,200,150] as RGB },
      { l:'Upside / Downside', v:`${upside>=0?'+':''}${upside.toFixed(1)}%`, c:vColor },
    ].forEach((k, i) => {
      pill(M + i*(vW+3), y, vW, k.l, k.v, k.c as RGB);
    });
    y += 18;

    // Valuation models summary table
    y = checkY(y, 40);
    y = section(y, 'Valuation Models Summary');
    const avnVals2 = sharedAdvanceValueNet?.valuations;
    const modelList: {name:string; val:number}[] = [];
    if (avnVals2) {
      Object.entries(avnVals2).forEach(([k,v]) => {
        if (typeof v==='number' && isFinite(v) && v>0) {
          modelList.push({ name:k.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase()), val:+v });
        }
      });
    }
    if (modelList.length === 0) {
      const computed = computeValuationModels(dcfCustom, quote, KM);
      modelList.push(...computed);
    }
    if (modelList.length > 0) {
      const modelRows = modelList.map(m => {
        const mUp = ((m.val - price) / price * 100);
        return [m.name.substring(0, 25), `$${f(m.val)}`, `${mUp >= 0 ? '+' : ''}${mUp.toFixed(1)}%`];
      });
      modelRows.push(['AVERAGE', `$${f(avgVal)}`, `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`]);
      y = atable({
        startY: y,
        head: [['Model', 'Fair Value', 'vs Price']],
        body: modelRows,
        columnStyles: { 0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:65} },
        didParseCell: (data:any) => {
          if (data.row.index === modelRows.length - 1 && data.section === 'body') {
            data.cell.styles.fillColor = [0, 40, 20];
            data.cell.styles.textColor = G;
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
    }

    // Quality score summary
    if (qualityNet?.totalScore != null) {
      y = checkY(y, 25);
      y = section(y, 'Quality Assessment');
      doc.setFont(FONT,'bold'); doc.setFontSize(8); st(TW);
      doc.text(`Overall Quality: ${(qualityNet.totalScore*100).toFixed(0)}/100 — ${qualityNet.rating}`, M, y);
      y += 6;
      if (qualityNet.scores) {
        Object.entries(qualityNet.scores).forEach(([dim, score]:any) => {
          const pct = typeof score==='number' ? +(score*100).toFixed(0) : 0;
          const lbl = dim.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());
          y = checkY(y, 9);
          scoreBar(M, y, CW, lbl, pct);
          y += 8;
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // FINAL PAGE — DISCLAIMER
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('disclaimer')) {
  y = newPage();

  // Title
  doc.setFont(FONT,'bold'); doc.setFontSize(10); st(TW);
  doc.text('Disclaimer & Important Disclosures', PW/2, y+4, { align:'center' });
  y += 16;
  ss(G); doc.setLineWidth(0.3); doc.line(M+20, y, PW-M-20, y);
  y += 10;

  doc.setFont(FONT,'normal'); doc.setFontSize(7.5); st(TW);
  if (d.branding?.customDisclaimer) {
    const customLines: string[] = doc.splitTextToSize(d.branding.customDisclaimer, CW - 10);
    customLines.forEach((line: string) => {
      doc.text(line, PW/2, y, { align:'center' });
      y += 5.5;
    });
  } else {
    const disc = [
      'This Investment Analysis Report has been generated automatically by the Prismo platform for',
      'informational and educational purposes only. It does not constitute financial advice, investment',
      'recommendations, or an offer to buy or sell any security.',
      '',
      'All data is sourced from Financial Modeling Prep (FMP) and third-party data providers. No guarantee',
      'is made regarding accuracy, completeness, or timeliness. Investing in securities involves risk,',
      'including possible loss of principal. Past performance does not guarantee future results.',
      '',
      'Valuation models (DCF, DDM, Graham Number, Multiples, etc.) rely on assumptions and estimates',
      'that may not reflect actual future performance. Different analysts may reach different conclusions.',
      '',
      'Always consult a qualified financial advisor before making any investment decisions.',
    ];
    disc.forEach(line => {
      st(line==='' ? TG : TW);
      if (line !== '') doc.text(line, PW/2, y, { align:'center' });
      y += line==='' ? 4 : 5.5;
    });
  }

  y += 6;
  ss(D3); doc.setLineWidth(0.2); doc.line(M+30, y, PW-M-30, y);
  y += 6;
  doc.setFontSize(7); st(TG);
  doc.text(`${co}  (${ticker})  ·  ${date}`, PW/2, y, { align:'center' });
  y += 8;
  doc.setFontSize(5.5); st(TG);
  doc.text('Analysis by Prismo  ·  prismo.us', PW/2, y, { align:'center' });

  pageFooter();
  } // end disclaimer

  // ── Save or preview ───────────────────────────────────────────────────
  if (d.preview) {
    const blob: Blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }
  const filePrefix = userCo ? `${ticker}_${userCo.replace(/[^a-zA-Z0-9]/g, '_')}` : `${ticker}_Analysis`;
  doc.save(`${filePrefix}_${today.toISOString().split('T')[0]}.pdf`);
}
