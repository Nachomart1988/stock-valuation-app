// src/app/utils/generateAnalysisPDF.ts
// Institutional-Grade Equity Research Report — Goldman Sachs / Morgan Stanley style
// White background, navy accent, serif headings, narrative analysis, ~40 pages

export interface PDFBranding {
  bgColor?:          [number, number, number];
  accentColor?:      [number, number, number];
  fontFamily?:       string;
  logoBase64?:       string;
  customDisclaimer?: string;
  userCompany?:      string;
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
  keyMetrics?: any[];
  keyMetricsTTM?: any;
  ratios?: any[];
  ratiosTTM?: any;
  estimates?: any[];
  dcfCustom?: any;
  dividends?: any[];
  incomeGrowth?: any[];
  financialGrowth?: any[];
  enterpriseValue?: any[];
  ownerEarnings?: any[];
  balanceTTM?: any;
  cashFlowTTM?: any;
  newsData?: any[];
  holdersData?: any;
  sections?:  string[];
  branding?:  PDFBranding;
  preview?:   boolean;
}

type RGB = [number, number, number];

// ── Format helpers ──────────────────────────────────────────────────────
const f  = (v: any, d = 2) => (v == null || isNaN(+v)) ? '—' : (+v).toFixed(d);
const fp = (v: any, d = 1) => (v == null || isNaN(+v)) ? '—' : (+v).toFixed(d) + '%';
const fl = (v: any) => {
  if (v == null || isNaN(+v)) return '—';
  const n = +v;
  if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(2)+'T';
  if (Math.abs(n) >= 1e9)  return (n/1e9).toFixed(2)+'B';
  if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(1)+'M';
  if (Math.abs(n) >= 1e3)  return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
};
const fc = (v: any, d = 2) => (v == null || isNaN(+v)) ? '—' : `$${(+v).toFixed(d)}`;

function filterRows(rows: string[][], valueCols?: number[]): string[][] {
  return rows.filter(row => {
    const cols = valueCols || row.slice(1).map((_, i) => i + 1);
    return cols.some(i => row[i] != null && row[i] !== '—' && row[i] !== '$—' && row[i] !== '—%' && row[i] !== '0.0%');
  });
}

// ── Self-sufficient computation helpers ────────────────────────────────
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
  const sectorPE = Math.max(km?.peRatio ?? quote?.pe ?? 15, 10);
  if (eps > 0) models.push({ name: `P/E Multiple (${sectorPE.toFixed(0)}x)`, val: eps * sectorPE });
  if (bvps > 0) models.push({ name: 'Book Value × 1.5', val: bvps * 1.5 });
  if (fcfps > 0) models.push({ name: 'FCF Yield (6%)', val: fcfps / 0.06 });
  const div = quote?.dividendYield && quote.price ? quote.price * quote.dividendYield : 0;
  const wacc = dcfCustom?.wacc;
  const ddmDenom = wacc ? (wacc / 100 - 0.03) : 0;
  if (div > 0 && ddmDenom > 0.005) models.push({ name: 'Dividend Discount Model', val: div / ddmDenom });
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

// ── Narrative generators (deterministic, data-driven prose) ─────────────
function narrativeOverview(co: string, sect: string, ind: string, mktCap: any, employees: any): string {
  const sz = mktCap > 200e9 ? 'mega-cap' : mktCap > 10e9 ? 'large-cap' : mktCap > 2e9 ? 'mid-cap' : mktCap > 300e6 ? 'small-cap' : 'micro-cap';
  const empStr = employees ? ` and a workforce of approximately ${(+employees).toLocaleString()} employees` : '';
  return `${co} operates within the ${sect} sector, specifically in the ${ind} industry. The company is classified as a ${sz} issuer with a market capitalization of ${fl(mktCap)}${empStr}. This report synthesizes financial performance, valuation, quality metrics, and forward-looking analyst expectations to inform an investment view.`;
}

function narrativeThesis(co: string, upside: number, avgVal: number, quality: any, cagr: number | null): string {
  const dir = upside > 30 ? 'a meaningful asymmetry to the upside' :
              upside > 10 ? 'a positive expected return profile' :
              upside > -10 ? 'a fair-value distribution' :
              upside > -30 ? 'a negative skew with limited margin of safety' :
                            'a material disconnect between price and estimated intrinsic value';
  const qStr = quality?.rating ? `, supported by an overall quality rating of "${quality.rating}" (${(quality.totalScore * 100).toFixed(0)}/100)` : '';
  const cagrStr = cagr != null ? `. Top-line growth has compounded at ${cagr.toFixed(1)}% per annum on a blended basis` : '';
  return `Our blended intrinsic value estimate for ${co} stands at ${fc(avgVal, 0)} per share, implying ${dir} of ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% versus the current market price${qStr}${cagrStr}.`;
}

function narrativeMargins(grossM: number, opM: number, netM: number): string {
  const gQual = grossM > 0.5 ? 'robust' : grossM > 0.3 ? 'healthy' : grossM > 0.15 ? 'moderate' : 'thin';
  const oQual = opM > 0.2 ? 'strong operating leverage' : opM > 0.1 ? 'reasonable operating discipline' : opM > 0 ? 'modest operating profitability' : 'operating losses';
  return `Gross margin of ${(grossM * 100).toFixed(1)}% indicates a ${gQual} unit-economics profile. The company displays ${oQual} with an operating margin of ${(opM * 100).toFixed(1)}%, ultimately translating into a net margin of ${(netM * 100).toFixed(1)}%.`;
}

function narrativeBalance(bal: any): string {
  if (!bal) return '';
  const cash = bal.cashAndCashEquivalents || 0;
  const debt = bal.totalDebt || 0;
  const eq = bal.totalStockholdersEquity || bal.totalEquity || 0;
  const netDebt = bal.netDebt || 0;
  const stance = netDebt < 0 ? 'a net-cash position' : debt / Math.max(eq, 1) > 1.5 ? 'a leveraged balance sheet' : debt / Math.max(eq, 1) > 0.5 ? 'a moderately levered capital structure' : 'a conservatively financed balance sheet';
  return `The balance sheet exhibits ${stance}. Cash and equivalents stand at ${fl(cash)} against ${fl(debt)} of total debt, yielding a net debt position of ${fl(netDebt)}. Shareholders' equity totals ${fl(eq)}.`;
}

function narrativeQuality(quality: any): string {
  if (!quality?.scores) return '';
  const sc = quality.scores;
  const strongest = Object.entries(sc).sort((a: any, b: any) => b[1] - a[1])[0];
  const weakest = Object.entries(sc).sort((a: any, b: any) => a[1] - b[1])[0];
  const fmtName = (k: string) => k.replace(/_/g, ' ').toLowerCase();
  return `On a five-dimensional quality framework, the company scores ${(quality.totalScore * 100).toFixed(0)}/100 overall, qualifying as "${quality.rating}". The strongest pillar is ${fmtName(strongest[0])} (${((strongest[1] as number) * 100).toFixed(0)}/100), while ${fmtName(weakest[0])} (${((weakest[1] as number) * 100).toFixed(0)}/100) represents the relative weakness in the framework.`;
}

function narrativeValuation(models: { name: string; val: number }[], price: number, avgVal: number): string {
  if (models.length === 0) return '';
  const sorted = [...models].sort((a, b) => a.val - b.val);
  const lo = sorted[0].val, hi = sorted[sorted.length - 1].val;
  const inRange = price >= lo && price <= hi ? 'falls within' : price < lo ? 'sits below' : 'trades above';
  return `We triangulate intrinsic value across ${models.length} independent methodologies, yielding a dispersion from ${fc(lo, 0)} (low) to ${fc(hi, 0)} (high) with a central estimate of ${fc(avgVal, 0)}. The current market price of ${fc(price, 0)} ${inRange} the estimated value range, anchoring our valuation conclusion.`;
}

function narrativeRisks(co: string, beta: any, debt: any, eq: any, netM: number): string[] {
  const risks: string[] = [];
  if (beta > 1.3) risks.push(`Elevated market beta (${f(beta)}) implies ${co} amplifies broad market drawdowns; investors should expect higher realized volatility versus the benchmark during risk-off regimes.`);
  if (debt && eq && debt / eq > 1.5) risks.push(`A leveraged capital structure (D/E of ${f(debt / eq)}) constrains financial flexibility and increases sensitivity to interest-rate movements; refinancing risk warrants monitoring.`);
  if (netM < 0.05 && netM > 0) risks.push(`Thin net margins (${(netM * 100).toFixed(1)}%) leave limited buffer for cost inflation or pricing pressure, raising earnings-quality concerns.`);
  if (netM < 0) risks.push(`Negative net margins indicate the business is not currently profitable on a GAAP basis; the path to sustained profitability is a key monitorable.`);
  risks.push('Macroeconomic headwinds including monetary policy shifts, inflation, and consumer-demand softness could compress demand and margins across the sector.');
  risks.push('Competitive intensity and disruption risk: incumbents in adjacent verticals or new entrants may erode market share and pricing power over the forecast horizon.');
  risks.push('Regulatory and geopolitical exposure: changes in tax policy, trade restrictions, or industry-specific regulation could impair earnings outlook.');
  risks.push('Execution risk: forecasts assume management delivers on strategic initiatives, capital allocation, and operational targets without material disruption.');
  return risks;
}

function narrativeCatalysts(co: string, cagr: number | null, quality: any, divYield: number): string[] {
  const catalysts: string[] = [];
  if (cagr && cagr > 8) catalysts.push(`Sustained revenue compounding at ${cagr.toFixed(1)}% CAGR signals durable secular demand; continuation of this trajectory would support multiple expansion.`);
  if (quality?.scores?.profitability > 0.7) catalysts.push(`High-quality profitability metrics (top-quartile profitability score) suggest pricing power and operational moats that can be re-rated by the market.`);
  if (divYield > 0.025) catalysts.push(`A dividend yield of ${(divYield * 100).toFixed(2)}% provides a baseline total-return contribution and signals capital-return discipline.`);
  catalysts.push('Operating leverage realization: incremental revenue dropping through at higher margins as fixed-cost absorption improves can drive consensus EPS upgrades.');
  catalysts.push('Capital allocation events including share buybacks, M&A integration synergies, or accretive divestitures can unlock shareholder value.');
  catalysts.push('Analyst coverage initiation or rating upgrades following earnings catalysts may shift positioning and broaden the investor base.');
  catalysts.push('Sector rotation: a shift in macro regime favoring the issuer\'s sector could drive multiple expansion independent of fundamental change.');
  catalysts.push('Product-cycle inflection, geographic expansion, or new business-line monetization represent structural growth optionality embedded in the current price.');
  return catalysts;
}

// ════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ════════════════════════════════════════════════════════════════════════
export async function generateAnalysisPDF(d: PDFData): Promise<string | void> {
  const { default: jsPDF } = await import('jspdf');
  const atMod = await import('jspdf-autotable');
  if (typeof (atMod as any).applyPlugin === 'function') {
    (atMod as any).applyPlugin(jsPDF);
  }
  const doc: any = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const activeSections = new Set(
    d.sections ?? [
      'cover', 'executive_summary', 'investment_thesis',
      'company_overview', 'market_summary',
      'income_statement', 'balance_sheet', 'cash_flow',
      'key_metrics', 'dupont', 'quality_score',
      'wacc_cagr', 'beta_capm', 'sgr',
      'valuation_models', 'analyst_forecasts', 'revenue_forecast', 'price_target',
      'growth_analysis', 'enterprise_value', 'dividends', 'owner_earnings',
      'ttm_snapshot', 'technical_52w', 'pivots_fibonacci',
      'competitors', 'industry_overview', 'holders', 'segmentation', 'news',
      'risk_factors', 'catalysts', 'analisis_final', 'disclaimer',
    ]
  );

  // ── Goldman Sachs–style palette ───────────────────────────────────────
  const SANS = d.branding?.fontFamily ?? 'helvetica';
  const SERIF = 'times';

  const NAVY: RGB = d.branding?.accentColor ?? [11, 45, 94];
  const NAVY_D: RGB = [Math.max(0, Math.round(NAVY[0]*0.6)), Math.max(0, Math.round(NAVY[1]*0.6)), Math.max(0, Math.round(NAVY[2]*0.6))];
  const NAVY_L: RGB = [225, 232, 245];
  const BLACK: RGB = [0, 0, 0];
  const WHITE: RGB = [255, 255, 255];
  const G1: RGB = [250, 250, 250];   // lightest gray — alternating rows
  const G2: RGB = [240, 240, 242];   // light gray panel
  const G3: RGB = [220, 220, 224];   // border
  const TX_D: RGB = [25, 25, 32];    // primary text
  const TX_M: RGB = [85, 85, 95];    // secondary text
  const TX_L: RGB = [140, 140, 150]; // muted text
  const POS: RGB = [25, 100, 55];    // positive (dark green)
  const NEG: RGB = [165, 30, 35];    // negative (dark red)
  const WARN: RGB = [170, 130, 25];  // warning gold

  const sf = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const ss = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const st = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

  // Page dimensions
  const PW = 210, PH = 297, M = 14, CW = PW - 2*M;
  const today = new Date();
  const date = today.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const dateShort = today.toISOString().split('T')[0];

  const { ticker, profile, quote, income, balance, cashFlow, incomeTTM,
          priceTarget, sharedAverageVal, sharedWACC, sharedAvgCAPM,
          sharedForecasts, sharedAdvanceValueNet,
          sharedCompanyQualityNet, sharedCagrStats, sharedPivotAnalysis,
          keyMetrics, keyMetricsTTM, ratios, ratiosTTM, estimates, dcfCustom,
          dividends, incomeGrowth, financialGrowth, enterpriseValue, ownerEarnings,
          newsData: preloadedNews, holdersData: preloadedHolders } = d;

  const km0  = (keyMetrics || [])[0] || keyMetricsTTM || {};
  const rat0 = (ratios || [])[0] || ratiosTTM || {};
  const KM: any = { ...rat0, ...km0 };

  const forecasts = (sharedForecasts?.length ? sharedForecasts : estimates) || [];

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

  const cagrStats  = sharedCagrStats ?? computeCAGR(income);
  const avgVal     = sharedAverageVal ?? computeAverageValuation(dcfCustom, quote, KM);
  const qualityNet = sharedCompanyQualityNet ?? computeQualityScore(KM, income, balance);

  const co    = profile?.companyName || ticker;
  const sect  = profile?.sector   || '—';
  const ind   = profile?.industry || '—';
  const exch  = profile?.exchangeShortName || '—';
  const price = quote?.price;

  const userCo = d.branding?.userCompany?.trim() || 'PRISMO RESEARCH';

  let pg = 1;

  // ── Header (Goldman style: black bar with firm name + report type) ───
  function pageHeader() {
    // Black bar
    sf(BLACK); doc.rect(0, 0, PW, 11, 'F');
    // Navy strip below bar
    sf(NAVY); doc.rect(0, 11, PW, 0.6, 'F');

    // Left: firm name
    doc.setFont(SANS, 'bold'); doc.setFontSize(7.5); st(WHITE);
    doc.text(userCo.toUpperCase(), M, 7.2);

    // Center: report type
    doc.setFont(SANS, 'normal'); doc.setFontSize(6.5); st([200, 200, 210] as RGB);
    doc.text('EQUITY RESEARCH  ·  INVESTMENT ANALYSIS', PW/2, 7.2, { align: 'center' });

    // Right: ticker + date
    doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(WHITE);
    doc.text(`${ticker}  ·  ${date}`, PW - M, 7.2, { align: 'right' });
  }

  // ── Footer (gray rule + page number + meta) ──────────────────────────
  function pageFooter() {
    const fy = PH - 9;
    // Gray rule
    ss(G3); doc.setLineWidth(0.2); doc.line(M, fy, PW - M, fy);
    // Navy thin accent
    sf(NAVY); doc.rect(M, fy, 30, 0.4, 'F');

    doc.setFont(SANS, 'normal'); doc.setFontSize(6); st(TX_M);
    doc.text(`${co}  ·  ${ticker}`, M, fy + 4.5);
    doc.text('For informational purposes only — not investment advice', PW/2, fy + 4.5, { align: 'center' });
    doc.setFont(SANS, 'bold');
    doc.text(`Page ${pg}`, PW - M, fy + 4.5, { align: 'right' });
  }

  function newPage(): number {
    pageFooter();
    doc.addPage(); pg++;
    sf(WHITE); doc.rect(0, 0, PW, PH, 'F');
    pageHeader();
    return 18;
  }

  function checkY(y: number, need = 28): number {
    return y + need > PH - 14 ? newPage() : y;
  }

  // ── Section heading (serif title + navy bar + subtitle + thin rule) ──
  function section(y: number, title: string, summary?: string): number {
    // Navy accent bar
    sf(NAVY); doc.rect(M, y - 0.5, 2.5, summary ? 11 : 7.5, 'F');
    // Title (serif)
    doc.setFont(SERIF, 'bold'); doc.setFontSize(13); st(BLACK);
    doc.text(title, M + 6, y + 5);
    // Thin double rule
    ss(NAVY); doc.setLineWidth(0.4); doc.line(M + 6, y + 7, PW - M, y + 7);
    ss(G3); doc.setLineWidth(0.15); doc.line(M + 6, y + 7.7, PW - M, y + 7.7);

    if (summary) {
      doc.setFont(SANS, 'italic'); doc.setFontSize(7.5); st(TX_M);
      const sl: string[] = doc.splitTextToSize(summary, CW - 8);
      sl.slice(0, 2).forEach((line, i) => doc.text(line, M + 6, y + 11.5 + i * 3.8));
      return y + 11.5 + Math.min(sl.length, 2) * 3.8 + 2;
    }
    return y + 11;
  }

  // ── Subsection heading ───────────────────────────────────────────────
  function subsection(y: number, title: string): number {
    doc.setFont(SERIF, 'bold'); doc.setFontSize(9.5); st(NAVY);
    doc.text(title, M, y + 3.5);
    ss(G3); doc.setLineWidth(0.15); doc.line(M, y + 5.2, PW - M, y + 5.2);
    return y + 9;
  }

  // ── Narrative paragraph (justified, serif body for long-form) ────────
  function paragraph(y: number, text: string | null | undefined, opts: { italic?: boolean; size?: number; color?: RGB; serif?: boolean } = {}): number {
    if (!text || typeof text !== 'string' || !text.trim()) return y;
    const size = opts.size ?? 8.5;
    const color = opts.color ?? TX_D;
    const font = opts.serif ? SERIF : SANS;
    const style = opts.italic ? 'italic' : 'normal';
    const applyStyle = () => { doc.setFont(font, style); doc.setFontSize(size); st(color); };
    applyStyle();
    let lines: string[];
    try {
      lines = doc.splitTextToSize(text, CW);
    } catch {
      return y;
    }
    if (!Array.isArray(lines) || lines.length === 0) return y;
    for (const ln of lines) {
      if (!ln) continue;
      if (y > PH - 18) { y = newPage(); applyStyle(); }
      doc.text(ln, M, y);
      y += size * 0.55;
    }
    return y + 2;
  }

  // ── Pill / KPI card (white bg, navy border, navy value) ──────────────
  function pill(x: number, y: number, w: number, label: string, val: string, vc?: RGB, accent = false) {
    // White card with subtle border
    sf(WHITE); doc.roundedRect(x, y, w, 14, 1, 1, 'F');
    ss(accent ? NAVY : G3); doc.setLineWidth(accent ? 0.6 : 0.2);
    doc.roundedRect(x, y, w, 14, 1, 1, 'S');
    // Top navy accent strip if accent
    if (accent) { sf(NAVY); doc.rect(x, y, w, 1.2, 'F'); }
    // Label
    doc.setFont(SANS, 'normal'); doc.setFontSize(5.5); st(TX_M);
    doc.text(label.toUpperCase(), x + w/2, y + 5.5, { align: 'center' });
    // Value
    doc.setFont(SANS, 'bold'); doc.setFontSize(10); st(vc || (accent ? NAVY : TX_D));
    doc.text(val, x + w/2, y + 11.5, { align: 'center' });
  }

  function kpiRow(y: number, items: { label: string; value: string; color?: RGB; accent?: boolean }[]): number {
    const count = items.length;
    const gap = 2.5;
    const cardW = (CW - (count - 1) * gap) / count;
    items.forEach((item, i) => pill(M + i * (cardW + gap), y, cardW, item.label, item.value, item.color, item.accent));
    return y + 18;
  }

  // ── Bar chart (white bg, navy bars, gray grid) ───────────────────────
  function barChart(x: number, y: number, w: number, h: number,
                    labels: string[], values: number[], color: RGB = NAVY, isPct = false) {
    const n = labels.length;
    if (n === 0) return;
    const gap = Math.max(1, Math.min(2.5, 20/n));
    const bw = (w - (n - 1) * gap) / n;
    const validVals = values.filter(isFinite);
    const maxV = Math.max(...validVals, 1);
    const minV = Math.min(...validVals, 0);
    const span = (maxV - Math.min(minV, 0)) || 1;

    // Light panel bg
    sf(G1); doc.rect(x - 2, y - 4, w + 4, h + 14, 'F');
    ss(G3); doc.setLineWidth(0.2); doc.rect(x - 2, y - 4, w + 4, h + 14, 'S');

    // Grid lines + y-axis labels
    ss(G3); doc.setLineWidth(0.1);
    for (let i = 0; i <= 4; i++) {
      const gy = y + h * (1 - i / 4);
      doc.line(x, gy, x + w, gy);
      if (i > 0) {
        const gv = (minV < 0 ? Math.min(minV, 0) : 0) + span * (i / 4);
        doc.setFont(SANS, 'normal'); doc.setFontSize(4.5); st(TX_L);
        doc.text(isPct ? fp(gv, 0) : fl(gv), x - 1, gy + 1, { align: 'right' });
      }
    }

    labels.forEach((lbl, i) => {
      const v = isFinite(values[i]) ? values[i] : 0;
      const bh = Math.max(0.8, (Math.abs(v) / span) * h);
      const bx = x + i * (bw + gap);
      const by = v >= 0 ? y + h - bh : y + h;
      const isNeg = v < 0;

      // Bar
      sf(isNeg ? NEG : color);
      doc.rect(bx, by, bw, bh, 'F');
      // Slight darker top strip
      sf(isNeg ? [120, 25, 28] as RGB : [Math.max(0, color[0] - 30), Math.max(0, color[1] - 30), Math.max(0, color[2] - 30)] as RGB);
      doc.rect(bx, by, bw, 0.6, 'F');

      // Value label above
      doc.setFont(SANS, 'bold'); doc.setFontSize(5.5); st(isNeg ? NEG : NAVY_D);
      doc.text(isPct ? fp(v) : fl(v), bx + bw/2, by - 1.2, { align: 'center' });

      // X-axis label
      doc.setFont(SANS, 'normal'); doc.setFontSize(5.5); st(TX_M);
      doc.text(lbl, bx + bw/2, y + h + 4, { align: 'center' });
    });
  }

  // ── Score bar (horizontal progress bar with label and value) ─────────
  function scoreBar(x: number, y: number, w: number, label: string, pct: number) {
    const c: RGB = pct >= 70 ? POS : pct >= 45 ? WARN : NEG;
    doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(TX_D);
    doc.text(label, x, y + 3.5);
    const bx = x + 60, bw = w - 78;
    // Track
    sf(G2); doc.roundedRect(bx, y + 0.5, bw, 4.5, 0.5, 0.5, 'F');
    // Fill
    const fw = Math.max(2, bw * Math.min(pct, 100) / 100);
    sf(c); doc.roundedRect(bx, y + 0.5, fw, 4.5, 0.5, 0.5, 'F');
    // Value
    doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(c);
    doc.text(`${pct.toFixed(0)}/100`, bx + bw + 3, y + 3.8);
  }

  // ── autoTable wrapper (Goldman style: black header, white body, gray rules) ──
  function atableV2(opts: any): number {
    const userDidParse = opts.didParseCell;
    doc.autoTable({
      theme: 'plain',
      styles: {
        font: SANS,
        fontSize: 7.5,
        cellPadding: [2.2, 3],
        textColor: TX_D,
        fillColor: WHITE,
        lineColor: G3,
        lineWidth: 0,
      },
      headStyles: {
        fillColor: BLACK,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 7.5,
        cellPadding: [2.8, 3],
      },
      alternateRowStyles: { fillColor: G1 },
      margin: { left: M, right: M },
      ...opts,
      didParseCell: (data: any) => {
        if (data.section === 'body') {
          const txt = data.cell.raw;
          if (typeof txt === 'string') {
            const num = parseFloat(txt.replace(/[%$,]/g, ''));
            if (!isNaN(num) && txt.includes('%')) {
              data.cell.styles.textColor = num > 0 ? POS : num < 0 ? NEG : TX_D;
            }
          }
        }
        if (userDidParse) userDidParse(data);
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 0 && data.row.index < data.table.body.length - 1) {
          ss(G3); doc.setLineWidth(0.08);
          doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.table.width, data.cell.y + data.cell.height);
        }
        if (opts.didDrawCell) opts.didDrawCell(data);
      },
    });
    return (doc.lastAutoTable?.finalY || opts.startY + 20) + 5;
  }

  let y = 0;

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER (Goldman style)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('cover')) {
    sf(WHITE); doc.rect(0, 0, PW, PH, 'F');

    // ── Top black bar with firm branding ────────────────────────────────
    sf(BLACK); doc.rect(0, 0, PW, 22, 'F');
    sf(NAVY); doc.rect(0, 22, PW, 0.8, 'F');

    doc.setFont(SANS, 'bold'); doc.setFontSize(11); st(WHITE);
    doc.text(userCo.toUpperCase(), M, 10);
    doc.setFont(SANS, 'normal'); doc.setFontSize(7.5); st([200, 200, 210] as RGB);
    doc.text('EQUITY RESEARCH  ·  INVESTMENT ANALYSIS REPORT', M, 16);

    // Right: logo placeholder + date
    if (d.branding?.logoBase64) {
      try {
        doc.addImage(d.branding.logoBase64, PW - M - 16, 4, 14, 14, '', 'FAST');
      } catch { /* ignore */ }
    } else if (profile?.image) {
      try {
        const res = await fetch(profile.image);
        if (res.ok) {
          const blob = await res.blob();
          const url = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
          doc.addImage(url, 'JPEG', PW - M - 16, 4, 14, 14, '', 'FAST');
        }
      } catch { /* ignore */ }
    }
    doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(WHITE);
    doc.text(date, PW - M, 19, { align: 'right' });

    // ── Company name block ───────────────────────────────────────────────
    let cy = 38;
    // Sector / industry label
    doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NAVY);
    doc.text(`${sect.toUpperCase()}  ·  ${ind.toUpperCase()}`, M, cy);
    cy += 8;

    // Big company name (serif)
    doc.setFont(SERIF, 'bold'); doc.setFontSize(30); st(BLACK);
    const nameLn: string[] = doc.splitTextToSize(co, CW);
    doc.text(nameLn.slice(0, 2), M, cy + 6);
    cy += Math.min(nameLn.length, 2) * 11 + 4;

    // Ticker · Exchange · Date row
    doc.setFont(SANS, 'normal'); doc.setFontSize(9); st(TX_M);
    doc.text(`${exch}: `, M, cy);
    const exchWidth = doc.getTextWidth(`${exch}: `);
    doc.setFont(SANS, 'bold'); st(NAVY);
    doc.text(ticker, M + exchWidth, cy);
    cy += 3;

    // Heavy navy rule
    sf(NAVY); doc.rect(M, cy, 50, 1.5, 'F');
    cy += 8;

    // ── Investment Thesis box ────────────────────────────────────────────
    const upside = (avgVal && price) ? ((avgVal - price) / price) * 100 : null;
    const rating = upside == null ? 'NOT RATED' :
                   upside > 25 ? 'STRONG BUY' :
                   upside > 10 ? 'BUY' :
                   upside > -10 ? 'HOLD' :
                   upside > -25 ? 'SELL' : 'STRONG SELL';
    const rColor: RGB = upside == null ? TX_M :
                       upside > 10 ? POS :
                       upside > -10 ? WARN : NEG;

    // Box
    sf(G1); doc.rect(M, cy, CW, 50, 'F');
    sf(NAVY); doc.rect(M, cy, 3, 50, 'F'); // left accent
    ss(G3); doc.setLineWidth(0.3); doc.rect(M, cy, CW, 50, 'S');

    // "INVESTMENT THESIS" label
    doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NAVY);
    doc.text('INVESTMENT THESIS', M + 7, cy + 6);

    // Rating big
    doc.setFont(SERIF, 'bold'); doc.setFontSize(22); st(rColor);
    doc.text(rating, M + 7, cy + 17);

    // Price target line
    if (upside != null) {
      doc.setFont(SANS, 'normal'); doc.setFontSize(8); st(TX_D);
      doc.text(`Price Target  ${fc(avgVal!, 2)}`, M + 7, cy + 23);
      doc.text(`Current Price  ${fc(price, 2)}`, M + 7, cy + 28);
      doc.setFont(SANS, 'bold'); doc.setFontSize(11); st(rColor);
      doc.text(`Expected Return:  ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`, M + 7, cy + 36);
    }

    // Right side of thesis box: 4 mini-stats stacked
    const rsX = M + CW - 78;
    const rsStats = [
      ['MARKET CAP', fl(quote?.marketCap)],
      ['P/E RATIO', f(quote?.pe)],
      ['DIVIDEND YIELD', fp((quote?.dividendYield || 0) * 100, 2)],
      ['BETA', f(profile?.beta)],
    ];
    rsStats.forEach((s, i) => {
      const sy = cy + 6 + i * 10.5;
      doc.setFont(SANS, 'normal'); doc.setFontSize(5.5); st(TX_M);
      doc.text(s[0], rsX, sy);
      doc.setFont(SANS, 'bold'); doc.setFontSize(10); st(TX_D);
      doc.text(s[1], rsX, sy + 6);
    });

    cy += 56;

    // ── Revenue chart preview ────────────────────────────────────────────
    const covInc = (income || []).slice(0, 5).reverse();
    if (covInc.length >= 2) {
      doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NAVY);
      doc.text('REVENUE — 5-YEAR TREND', M, cy);
      barChart(M, cy + 5, CW, 32,
        covInc.map((i: any) => i.date?.substring(0, 4) || ''),
        covInc.map((i: any) => i.revenue || 0), NAVY);
      cy += 50;
    }

    // ── Brief description ────────────────────────────────────────────────
    if (profile?.description) {
      doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NAVY);
      doc.text('BUSINESS DESCRIPTION', M, cy);
      cy += 5;
      doc.setFont(SERIF, 'normal'); doc.setFontSize(8); st(TX_D);
      const desc = profile.description.substring(0, 480) + (profile.description.length > 480 ? '…' : '');
      const dl: string[] = doc.splitTextToSize(desc, CW);
      dl.slice(0, 6).forEach((line, i) => {
        doc.text(line, M, cy + i * 4);
      });
      cy += Math.min(dl.length, 6) * 4 + 4;
    }

    // ── Cover footer (black bar) ─────────────────────────────────────────
    sf(BLACK); doc.rect(0, PH - 14, PW, 14, 'F');
    sf(NAVY); doc.rect(0, PH - 14, PW, 0.5, 'F');
    doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(WHITE);
    doc.text(`${ticker}  ·  ${co.substring(0, 50)}`, M, PH - 7);
    doc.setFont(SANS, 'normal'); doc.setFontSize(6.5); st([200, 200, 210] as RGB);
    doc.text('For informational purposes only — not investment advice', PW/2, PH - 7, { align: 'center' });
    doc.setFont(SANS, 'bold'); doc.setFontSize(6.5); st(WHITE);
    doc.text(`${userCo}  ·  ${date}`, PW - M, PH - 7, { align: 'right' });
  }

  // ════════════════════════════════════════════════════════════════════════
  // EXECUTIVE SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('executive_summary')) {
    y = newPage();
    y = section(y, 'Executive Summary', 'Síntesis institucional del análisis: valuación, calidad, riesgos y conclusiones.');

    // Opening narrative
    y = paragraph(y, narrativeOverview(co, sect, ind, quote?.marketCap, profile?.fullTimeEmployees), { serif: true, size: 9 });

    // Investment thesis narrative
    if (avgVal != null && price) {
      const up = ((avgVal - price) / price) * 100;
      y = paragraph(y, narrativeThesis(co, up, avgVal, qualityNet, cagrStats?.avgCagr ?? null), { serif: true, size: 9 });
    }

    // KPI row
    y = checkY(y, 24);
    y = kpiRow(y, [
      { label: 'Current Price', value: fc(price, 2) },
      { label: 'Target Price',  value: avgVal ? fc(avgVal, 2) : '—', accent: true },
      { label: 'Expected Return', value: (avgVal && price) ? `${((avgVal - price) / price * 100).toFixed(1)}%` : '—',
        color: (avgVal && price) ? (avgVal > price ? POS : NEG) : TX_D },
      { label: 'Market Cap',    value: fl(quote?.marketCap) },
    ]);

    // Key takeaways
    y = checkY(y, 80);
    y = subsection(y, 'Key Takeaways');

    const takeaways: string[] = [];
    if (avgVal != null && price) {
      const up = ((avgVal - price) / price) * 100;
      takeaways.push(`Valuation: blended fair value of ${fc(avgVal, 2)} implies ${up >= 0 ? '+' : ''}${up.toFixed(1)}% return vs current ${fc(price, 2)}.`);
    }
    if (qualityNet?.rating) {
      takeaways.push(`Quality: scored ${(qualityNet.totalScore * 100).toFixed(0)}/100 ("${qualityNet.rating}") across profitability, financial strength, efficiency, growth, and valuation.`);
    }
    if (cagrStats?.avgCagr != null) {
      takeaways.push(`Growth: revenue has compounded at ${cagrStats.avgCagr.toFixed(1)}% per annum (blended 3/5/10-year CAGR), with a historical range of ${cagrStats.minCagr?.toFixed(1)}% to ${cagrStats.maxCagr?.toFixed(1)}%.`);
    }
    const fcInc = income?.[0];
    if (fcInc?.netIncomeRatio != null) {
      takeaways.push(`Profitability: latest net margin of ${(fcInc.netIncomeRatio * 100).toFixed(1)}% and gross margin of ${((fcInc.grossProfitRatio || 0) * 100).toFixed(1)}% define the unit-economics profile.`);
    }
    if (sharedWACC != null || dcfCustom?.wacc) {
      takeaways.push(`Cost of Capital: estimated WACC of ${fp(sharedWACC ?? dcfCustom?.wacc)} serves as the discount rate for DCF valuation.`);
    }
    if (profile?.beta != null) {
      takeaways.push(`Risk: beta of ${f(profile.beta)} implies ${+profile.beta > 1.2 ? 'above-market' : +profile.beta > 0.8 ? 'market-level' : 'below-market'} systematic risk relative to the benchmark.`);
    }

    takeaways.forEach((t, i) => {
      y = checkY(y, 12);
      sf(NAVY); doc.circle(M + 1.5, y + 1.8, 0.9, 'F');
      doc.setFont(SANS, 'bold'); doc.setFontSize(8); st(NAVY);
      doc.text(`${i + 1}.`, M + 4, y + 2.5);
      doc.setFont(SERIF, 'normal'); doc.setFontSize(8.5); st(TX_D);
      const lines: string[] = doc.splitTextToSize(t, CW - 12);
      lines.forEach((ln, li) => doc.text(ln, M + 10, y + 2.5 + li * 4));
      y += Math.max(6, lines.length * 4 + 3);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // INVESTMENT THESIS (long form)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('investment_thesis')) {
    y = newPage();
    y = section(y, 'Investment Thesis', 'Tesis de inversión: argumentos centrales que respaldan la recomendación.');

    if (avgVal != null && price) {
      const up = ((avgVal - price) / price) * 100;
      // Thesis statement
      const thesisIntro = up > 10
        ? `Our investment view on ${co} is constructive. The convergence of fundamental performance metrics, valuation triangulation across multiple methodologies, and a reasonable forward growth profile supports a positive expected-return outlook over the medium term.`
        : up > -10
        ? `Our view on ${co} is balanced. Current price levels appear approximately consistent with our triangulated intrinsic value estimate, suggesting limited mispricing in either direction; we await clearer catalysts or pullbacks to take a directional view.`
        : `Our investment stance on ${co} is cautious. The current market price embeds expectations that exceed our triangulated intrinsic value estimate, suggesting limited margin of safety and the potential for negative price discovery should fundamentals decelerate.`;

      y = paragraph(y, thesisIntro, { serif: true, size: 9 });
    }

    // Pillars
    y = checkY(y, 80);
    y = subsection(y, 'Pillar I — Business Quality');
    const incPil = (income || [])[0];
    const balPil = (balance || [])[0];
    if (incPil && balPil) {
      y = paragraph(y, narrativeMargins(incPil.grossProfitRatio || 0, incPil.operatingIncomeRatio || 0, incPil.netIncomeRatio || 0), { serif: true });
      y = paragraph(y, narrativeBalance(balPil), { serif: true });
      if (qualityNet) y = paragraph(y, narrativeQuality(qualityNet), { serif: true });
    }

    y = checkY(y, 60);
    y = subsection(y, 'Pillar II — Growth Trajectory');
    if (cagrStats?.avgCagr != null) {
      y = paragraph(y, `Top-line growth has compounded at ${cagrStats.avgCagr.toFixed(1)}% per annum on a blended basis, with a historical band spanning ${cagrStats.minCagr?.toFixed(1)}% (trough) to ${cagrStats.maxCagr?.toFixed(1)}% (peak). The stability of this growth profile is a key consideration in our valuation framework.`, { serif: true });
    }
    if (forecasts && forecasts.length > 0) {
      const yr1 = forecasts[0];
      if (yr1?.estimatedRevenueAvg) {
        y = paragraph(y, `Forward analyst consensus projects ${yr1.date?.substring(0, 4) || 'next-year'} revenue of approximately ${fl(yr1.estimatedRevenueAvg)}, with EPS estimates of ${fc(yr1.estimatedEpsAvg)}, providing a baseline trajectory for our forecasting models.`, { serif: true });
      }
    }

    y = checkY(y, 60);
    y = subsection(y, 'Pillar III — Valuation Triangulation');
    const models = computeValuationModels(dcfCustom, quote, KM);
    if (models.length > 0 && avgVal != null && price) {
      y = paragraph(y, narrativeValuation(models, price, avgVal), { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMPANY OVERVIEW
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('company_overview') && profile) {
    y = newPage();
    y = section(y, 'Company Overview', 'Perfil corporativo, descripción del negocio y datos clave.');

    // Profile pills (2 rows)
    const profPills: [string, string][] = [
      ['Sector',    sect.substring(0, 18)],
      ['Industry',  ind.substring(0, 18)],
      ['Exchange',  exch],
      ['Country',   profile.country || '—'],
      ['CEO',       (profile.ceo || '—').substring(0, 18)],
      ['Employees', profile.fullTimeEmployees ? (+profile.fullTimeEmployees).toLocaleString() : '—'],
      ['IPO Date',  profile.ipoDate || '—'],
      ['Currency',  profile.currency || '—'],
    ];
    const ppW = (CW - 3 * 2.5) / 4;
    profPills.forEach(([l, v], i) => {
      const row = Math.floor(i / 4), col = i % 4;
      pill(M + col * (ppW + 2.5), y + row * 16, ppW, l, v);
    });
    y += 34;

    if (profile.description) {
      y = checkY(y, 50);
      y = subsection(y, 'Business Description');
      const desc = profile.description.substring(0, 1600) + (profile.description.length > 1600 ? '…' : '');
      y = paragraph(y, desc, { serif: true, size: 8.5 });
    }

    y = checkY(y, 50);
    y = subsection(y, 'Key Financial Highlights');
    const highRows = filterRows([
      ['Market Capitalization', fl(quote?.marketCap),           'Enterprise Value',  fl(KM.enterpriseValue)],
      ['Revenue (TTM)',         fl(incomeTTM?.revenue),         'Net Income (TTM)',  fl(incomeTTM?.netIncome)],
      ['EPS (Diluted)',         fc(quote?.eps),                 'P/E Ratio',         f(quote?.pe)],
      ['52-Week High',          fc(quote?.yearHigh),            '52-Week Low',       fc(quote?.yearLow)],
      ['Dividend Yield',        fp((quote?.dividendYield || 0) * 100), 'Beta',       f(profile.beta)],
      ['Avg Volume',            fl(quote?.avgVolume),           'Shares Outstanding',fl(quote?.sharesOutstanding)],
    ], [1, 3]);
    if (highRows.length > 0) {
      y = atableV2({
        startY: y,
        body: highRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 48, textColor: TX_D },
          1: { cellWidth: 42, halign: 'right' },
          2: { fontStyle: 'bold', cellWidth: 48, textColor: TX_D },
          3: { cellWidth: 42, halign: 'right' },
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // MARKET SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('market_summary') && quote) {
    y = newPage();
    y = section(y, 'Market Summary', 'Indicadores clave de precio, mercado y momentum técnico.');

    const pills = [
      ['Price',    fc(price)],
      ['Day Chg',  fp(quote?.changesPercentage)],
      ['Mkt Cap',  fl(quote?.marketCap)],
      ['52W High', fc(quote?.yearHigh)],
      ['52W Low',  fc(quote?.yearLow)],
      ['Volume',   fl(quote?.volume)],
      ['MA 50',    fc(quote?.priceAvg50)],
      ['MA 200',   fc(quote?.priceAvg200)],
      ['P/E',      f(quote?.pe)],
      ['EPS',      fc(quote?.eps)],
      ['Div Yld',  fp((quote?.dividendYield || 0) * 100)],
      ['Beta',     f(quote?.beta)],
    ];
    const pW = (CW - 5 * 2) / 6;
    pills.forEach(([l, v], i) => {
      const row = Math.floor(i / 6), col = i % 6;
      const vc = l === 'Day Chg' && quote?.changesPercentage < 0 ? NEG :
                 l === 'Day Chg' && quote?.changesPercentage > 0 ? POS : undefined;
      pill(M + col * (pW + 2), y + row * 16, pW, l, v, vc);
    });
    y += 34;

    // Revenue & Net Income side by side
    const inc5 = (income || []).slice(0, 5).reverse();
    if (inc5.length >= 2) {
      y = checkY(y, 60);
      y = subsection(y, 'Revenue & Net Income — 5-Year Trend');
      const hw = (CW / 2) - 4;
      barChart(M, y + 2, hw, 38, inc5.map((i: any) => i.date?.substring(0, 4) || ''), inc5.map((i: any) => i.revenue || 0), NAVY);
      barChart(M + hw + 8, y + 2, hw, 38, inc5.map((i: any) => i.date?.substring(0, 4) || ''), inc5.map((i: any) => i.netIncome || 0), NAVY_D);
      doc.setFont(SANS, 'bold'); doc.setFontSize(6.5); st(NAVY);
      doc.text('Revenue', M + hw/2, y + 52, { align: 'center' });
      doc.text('Net Income', M + hw + 8 + hw/2, y + 52, { align: 'center' });
      y += 58;
    }

    // Margins
    if (inc5.length >= 2) {
      y = checkY(y, 50);
      y = subsection(y, 'Profitability Margins (%)');
      const mW = (CW - 8) / 3;
      const margins = [
        { label: 'Gross', key: 'grossProfitRatio' },
        { label: 'Operating', key: 'operatingIncomeRatio' },
        { label: 'Net', key: 'netIncomeRatio' },
      ];
      margins.forEach((m, mi) => {
        barChart(M + mi * (mW + 4), y + 2, mW, 30,
          inc5.map((i: any) => i.date?.substring(0, 4) || ''),
          inc5.map((i: any) => (i[m.key] || 0) * 100), NAVY, true);
        doc.setFont(SANS, 'bold'); doc.setFontSize(6.5); st(NAVY);
        doc.text(`${m.label} Margin`, M + mi * (mW + 4) + mW/2, y + 42, { align: 'center' });
      });
      y += 50;

      const latest = inc5[inc5.length - 1];
      y = paragraph(y, narrativeMargins(latest.grossProfitRatio || 0, latest.operatingIncomeRatio || 0, latest.netIncomeRatio || 0), { italic: true, size: 7.5, color: TX_M });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // INCOME STATEMENT
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('income_statement')) {
    const inc5 = (income || []).slice(0, 5).reverse();
    if (inc5.length > 0) {
      y = newPage();
      y = section(y, 'Income Statement', 'Estado de resultados consolidado de los últimos cinco años fiscales.');
      const yrs = inc5.map((i: any) => i.date?.substring(0, 4) || '');
      y = atableV2({
        startY: y,
        head: [['', ...yrs]],
        body: [
          ['Revenue',             ...inc5.map((i: any) => fl(i.revenue))],
          ['Cost of Revenue',     ...inc5.map((i: any) => fl(i.costOfRevenue))],
          ['Gross Profit',        ...inc5.map((i: any) => fl(i.grossProfit))],
          ['Gross Margin %',      ...inc5.map((i: any) => fp((i.grossProfitRatio || 0) * 100))],
          ['R&D Expenses',        ...inc5.map((i: any) => fl(i.researchAndDevelopmentExpenses))],
          ['SG&A Expenses',       ...inc5.map((i: any) => fl(i.sellingGeneralAndAdministrativeExpenses))],
          ['Operating Income',    ...inc5.map((i: any) => fl(i.operatingIncome))],
          ['Operating Margin %',  ...inc5.map((i: any) => fp((i.operatingIncomeRatio || 0) * 100))],
          ['EBITDA',              ...inc5.map((i: any) => fl(i.ebitda))],
          ['Interest Expense',    ...inc5.map((i: any) => fl(i.interestExpense))],
          ['Income Before Tax',   ...inc5.map((i: any) => fl(i.incomeBeforeTax))],
          ['Income Tax',          ...inc5.map((i: any) => fl(i.incomeTaxExpense))],
          ['Net Income',          ...inc5.map((i: any) => fl(i.netIncome))],
          ['Net Margin %',        ...inc5.map((i: any) => fp((i.netIncomeRatio || 0) * 100))],
          ['EPS (Diluted)',       ...inc5.map((i: any) => fc(i.epsdiluted || i.eps))],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 52, textColor: TX_D } },
      });

      // Narrative
      y = checkY(y, 20);
      const latest = inc5[inc5.length - 1];
      const first = inc5[0];
      const revGrowth = first?.revenue ? ((latest.revenue / first.revenue) ** (1 / Math.max(1, inc5.length - 1)) - 1) * 100 : 0;
      y = paragraph(y, `Over the ${inc5.length}-year period from ${yrs[0]} to ${yrs[yrs.length - 1]}, revenue compounded at approximately ${revGrowth.toFixed(1)}% per annum. ${narrativeMargins(latest.grossProfitRatio || 0, latest.operatingIncomeRatio || 0, latest.netIncomeRatio || 0)}`, { serif: true, size: 8.5 });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // BALANCE SHEET
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('balance_sheet')) {
    const bal5 = (balance || []).slice(0, 5).reverse();
    if (bal5.length > 0) {
      y = newPage();
      y = section(y, 'Balance Sheet', 'Composición de activos, pasivos y patrimonio de los últimos cinco años.');
      const yrs = bal5.map((b: any) => b.date?.substring(0, 4) || '');

      y = atableV2({
        startY: y,
        head: [['ASSETS', ...yrs]],
        body: [
          ['Cash & Equivalents',      ...bal5.map((b: any) => fl(b.cashAndCashEquivalents))],
          ['Short-term Investments',  ...bal5.map((b: any) => fl(b.shortTermInvestments))],
          ['Accounts Receivable',     ...bal5.map((b: any) => fl(b.netReceivables))],
          ['Inventory',               ...bal5.map((b: any) => fl(b.inventory))],
          ['Total Current Assets',    ...bal5.map((b: any) => fl(b.totalCurrentAssets))],
          ['Property, Plant & Equip. (Net)', ...bal5.map((b: any) => fl(b.propertyPlantEquipmentNet))],
          ['Goodwill',                ...bal5.map((b: any) => fl(b.goodwill))],
          ['Intangible Assets',       ...bal5.map((b: any) => fl(b.intangibleAssets))],
          ['Total Assets',            ...bal5.map((b: any) => fl(b.totalAssets))],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, textColor: TX_D } },
      });

      y = atableV2({
        startY: y,
        head: [['LIABILITIES & EQUITY', ...yrs]],
        body: [
          ['Accounts Payable',            ...bal5.map((b: any) => fl(b.accountPayables))],
          ['Short-term Debt',             ...bal5.map((b: any) => fl(b.shortTermDebt))],
          ['Total Current Liabilities',   ...bal5.map((b: any) => fl(b.totalCurrentLiabilities))],
          ['Long-term Debt',              ...bal5.map((b: any) => fl(b.longTermDebt))],
          ['Total Liabilities',           ...bal5.map((b: any) => fl(b.totalLiabilities))],
          ["Shareholders' Equity",        ...bal5.map((b: any) => fl(b.totalStockholdersEquity || b.totalEquity))],
          ['Net Debt',                    ...bal5.map((b: any) => fl(b.netDebt))],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, textColor: TX_D } },
      });

      // Narrative
      y = checkY(y, 20);
      y = paragraph(y, narrativeBalance(bal5[bal5.length - 1]), { serif: true, size: 8.5 });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // CASH FLOW
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('cash_flow')) {
    const cf5 = (cashFlow || []).slice(0, 5).reverse();
    if (cf5.length > 0) {
      y = newPage();
      y = section(y, 'Cash Flow Statement', 'Flujo de caja operativo, de inversión y financiamiento.');
      const yrs = cf5.map((c: any) => c.date?.substring(0, 4) || '');
      y = atableV2({
        startY: y,
        head: [['', ...yrs]],
        body: [
          ['Net Income',              ...cf5.map((c: any) => fl(c.netIncome))],
          ['Depreciation & Amort.',   ...cf5.map((c: any) => fl(c.depreciationAndAmortization))],
          ['Stock-Based Comp.',       ...cf5.map((c: any) => fl(c.stockBasedCompensation))],
          ['Working Capital Δ',       ...cf5.map((c: any) => fl(c.changeInWorkingCapital))],
          ['Operating Cash Flow',     ...cf5.map((c: any) => fl(c.operatingCashFlow || c.netCashProvidedByOperatingActivities))],
          ['Capital Expenditures',    ...cf5.map((c: any) => fl(c.capitalExpenditure))],
          ['Free Cash Flow',          ...cf5.map((c: any) => fl(c.freeCashFlow))],
          ['Acquisitions (Net)',      ...cf5.map((c: any) => fl(c.acquisitionsNet))],
          ['Investing Cash Flow',     ...cf5.map((c: any) => fl(c.netCashUsedForInvestingActivites))],
          ['Debt Issuance/Repayment', ...cf5.map((c: any) => fl(c.debtRepayment))],
          ['Dividends Paid',          ...cf5.map((c: any) => fl(c.dividendsPaid))],
          ['Stock Buybacks',          ...cf5.map((c: any) => fl(c.commonStockRepurchased))],
          ['Financing Cash Flow',     ...cf5.map((c: any) => fl(c.netCashUsedProvidedByFinancingActivities))],
          ['Net Change in Cash',      ...cf5.map((c: any) => fl(c.netChangeInCash))],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 52, textColor: TX_D } },
      });

      // FCF trend chart
      if (cf5.length >= 2) {
        y = checkY(y, 55);
        y = subsection(y, 'Free Cash Flow Trend');
        barChart(M, y + 2, CW, 38, yrs, cf5.map((c: any) => c.freeCashFlow || 0), NAVY);
        y += 46;
      }

      // Narrative
      const latestCF = cf5[cf5.length - 1];
      if (latestCF) {
        const fcfMargin = latestCF.freeCashFlow && (income || [])[0]?.revenue
          ? (latestCF.freeCashFlow / income[0].revenue) * 100
          : null;
        y = paragraph(y, `Operating cash flow generation reached ${fl(latestCF.operatingCashFlow || latestCF.netCashProvidedByOperatingActivities)} in the most recent period, supporting capital expenditures of ${fl(latestCF.capitalExpenditure)} and producing free cash flow of ${fl(latestCF.freeCashFlow)}${fcfMargin != null ? ` (FCF margin of ${fcfMargin.toFixed(1)}%)` : ''}. Capital return to shareholders included dividends of ${fl(latestCF.dividendsPaid)} and share repurchases of ${fl(latestCF.commonStockRepurchased)}.`, { serif: true, size: 8.5 });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // KEY METRICS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('key_metrics')) {
    const kmRows = filterRows([
      ['P/E Ratio',             f(KM.peRatio ?? quote?.pe),             'P/B Ratio',             f(KM.priceToBook ?? KM.pbRatio)],
      ['P/S Ratio',             f(KM.priceToSalesRatio ?? KM.priceToSales), 'P/FCF',             f(KM.priceToFCF ?? KM.pfcfRatio)],
      ['EV / EBITDA',           f(KM.evToEbitda ?? KM.enterpriseValueOverEBITDA), 'EV / Sales',  f(KM.evToSales ?? KM.evToRevenue)],
      ['ROE',                   fp((KM.roe ?? KM.returnOnEquity ?? 0) * 100), 'ROA',            fp((KM.roa ?? KM.returnOnAssets ?? 0) * 100)],
      ['ROIC',                  fp((KM.roic ?? KM.returnOnCapitalEmployed ?? 0) * 100), 'Return on Capital Employed', fp((KM.returnOnCapitalEmployed ?? 0) * 100)],
      ['Gross Margin',          fp((KM.grossProfitMargin ?? income?.[0]?.grossProfitRatio ?? 0) * 100), 'Operating Margin', fp((KM.operatingProfitMargin ?? income?.[0]?.operatingIncomeRatio ?? 0) * 100)],
      ['Net Margin',            fp((KM.netProfitMargin ?? income?.[0]?.netIncomeRatio ?? 0) * 100), 'FCF Margin', fp((KM.freeCashFlowMargin ?? 0) * 100)],
      ['Debt / Equity',         f(KM.debtToEquity ?? KM.debtEquityRatio),  'Net Debt / EBITDA',  f(KM.netDebtToEBITDA)],
      ['Current Ratio',         f(KM.currentRatio),                         'Quick Ratio',         f(KM.quickRatio)],
      ['Interest Coverage',     f(KM.interestCoverage),                     'Payout Ratio',        fp((KM.payoutRatio ?? 0) * 100)],
      ['Book Value / Share',    fc(KM.bookValuePerShare),                   'Revenue / Share',     fc(KM.revenuePerShare)],
      ['FCF / Share',           fc(KM.freeCashFlowPerShare),                'Earnings Yield',      fp((KM.earningsYield ?? 0) * 100)],
      ['Dividend Yield',        fp((KM.dividendYield ?? quote?.dividendYield ?? 0) * 100), 'Enterprise Value', fl(KM.enterpriseValue)],
    ], [1, 3]);
    if (kmRows.length > 0) {
      y = newPage();
      y = section(y, 'Key Metrics — Extended', 'Ratios financieros fundamentales agrupados por categoría.');
      y = atableV2({
        startY: y,
        head: [['Metric', 'Value', 'Metric', 'Value']],
        body: kmRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 50, textColor: TX_D },
          1: { cellWidth: 36, halign: 'right' },
          2: { fontStyle: 'bold', cellWidth: 50, textColor: TX_D },
          3: { cellWidth: 44, halign: 'right' },
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // DUPONT ANALYSIS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('dupont')) {
    const incLatest = (income || [])[0];
    const balLatest = (balance || [])[0];
    if (incLatest && balLatest) {
      y = newPage();
      y = section(y, 'DuPont Analysis', 'Descomposición del retorno sobre el patrimonio (ROE) en sus tres factores constitutivos.');

      const rev = incLatest.revenue || 0;
      const ni = incLatest.netIncome || 0;
      const ta = balLatest.totalAssets || 1;
      const te = balLatest.totalStockholdersEquity || balLatest.totalEquity || 1;

      const netMargin = rev ? ni / rev : 0;
      const assetTurnover = ta ? rev / ta : 0;
      const equityMult = te ? ta / te : 0;
      const roe = netMargin * assetTurnover * equityMult;

      y = atableV2({
        startY: y,
        head: [['Component', 'Formula', 'Value']],
        body: [
          ['Net Profit Margin',  'Net Income / Revenue',         fp(netMargin * 100)],
          ['Asset Turnover',     'Revenue / Total Assets',       f(assetTurnover)],
          ['Equity Multiplier',  'Total Assets / Equity',        f(equityMult)],
          ['ROE (DuPont)',       'Margin × Turnover × Multiplier', fp(roe * 100)],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 55, textColor: TX_D },
          1: { cellWidth: 75, textColor: TX_M, fontStyle: 'italic' },
          2: { cellWidth: 50, halign: 'right', fontStyle: 'bold' },
        },
      });

      y = checkY(y, 50);
      y = subsection(y, 'Component Breakdown');
      scoreBar(M, y, CW, 'Net Profit Margin', Math.min(100, Math.max(0, +(netMargin * 100).toFixed(0))));
      y += 10;
      scoreBar(M, y, CW, 'Asset Turnover (×50)', Math.min(100, Math.max(0, +(assetTurnover * 50).toFixed(0))));
      y += 10;
      scoreBar(M, y, CW, 'Equity Multiplier (×10)', Math.min(100, Math.max(0, +(equityMult * 10).toFixed(0))));
      y += 12;

      y = paragraph(y, `The DuPont decomposition reveals that ${co}'s ROE of ${(roe * 100).toFixed(1)}% is driven by a net profit margin of ${(netMargin * 100).toFixed(1)}%, asset turnover of ${assetTurnover.toFixed(2)}x, and an equity multiplier of ${equityMult.toFixed(2)}x. ${netMargin > 0.15 ? 'Margins are the dominant ROE driver' : assetTurnover > 1.5 ? 'Asset efficiency is the primary ROE driver' : equityMult > 2 ? 'Financial leverage is the primary ROE driver' : 'The components contribute in balanced proportions'} in the latest fiscal year.`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // QUALITY SCORE
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('quality_score') && qualityNet?.scores) {
    y = newPage();
    y = section(y, 'Company Quality Assessment', 'Scoring de calidad empresarial en cinco dimensiones estandarizadas.');

    if (qualityNet.totalScore != null) {
      // Big overall score card
      sf(G1); doc.rect(M, y, CW, 26, 'F');
      sf(NAVY); doc.rect(M, y, 3, 26, 'F');
      ss(G3); doc.setLineWidth(0.3); doc.rect(M, y, CW, 26, 'S');
      doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NAVY);
      doc.text('OVERALL QUALITY SCORE', M + 7, y + 6);
      doc.setFont(SERIF, 'bold'); doc.setFontSize(28); st(BLACK);
      doc.text(`${(qualityNet.totalScore * 100).toFixed(0)}`, M + 7, y + 21);
      doc.setFont(SERIF, 'normal'); doc.setFontSize(12); st(TX_M);
      doc.text(' / 100', M + 7 + doc.getTextWidth(`${(qualityNet.totalScore * 100).toFixed(0)}`), y + 21);
      // Rating
      const rColor = qualityNet.totalScore >= 0.6 ? POS : qualityNet.totalScore >= 0.4 ? WARN : NEG;
      doc.setFont(SANS, 'bold'); doc.setFontSize(14); st(rColor);
      doc.text(qualityNet.rating || '—', PW - M - 7, y + 18, { align: 'right' });
      y += 32;
    }

    y = subsection(y, 'Dimensional Breakdown');
    const sc = qualityNet.scores;
    Object.entries(sc).forEach(([dim, score]: any) => {
      const pct = typeof score === 'number' ? +(score * 100).toFixed(0) : 0;
      const lbl = dim.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      y = checkY(y, 11);
      scoreBar(M, y, CW, lbl, pct);
      y += 10;
    });

    y = paragraph(y + 4, narrativeQuality(qualityNet), { serif: true });
  }

  // ════════════════════════════════════════════════════════════════════════
  // WACC & CAGR
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('wacc_cagr')) {
    const capRows: any[] = [];
    const waccVal = sharedWACC ?? dcfCustom?.wacc;
    const capmVal = sharedAvgCAPM ?? dcfCustom?.costOfEquity;
    if (waccVal)    capRows.push(['WACC (Weighted Average Cost of Capital)', fp(waccVal)]);
    if (capmVal)    capRows.push(['Cost of Equity — CAPM', fp(capmVal)]);
    if (dcfCustom?.costOfDebt) capRows.push(['Cost of Debt', fp(dcfCustom.costOfDebt)]);
    if (dcfCustom?.riskFreeRate) capRows.push(['Risk-Free Rate (10Y Treasury)', fp(dcfCustom.riskFreeRate)]);
    if (cagrStats?.avgCagr != null) capRows.push(['Historical Revenue CAGR (Avg)', fp(cagrStats.avgCagr)]);
    if (cagrStats?.minCagr != null) capRows.push(['CAGR Range (Min – Max)', `${fp(cagrStats.minCagr)} – ${fp(cagrStats.maxCagr)}`]);
    if (capRows.length > 0) {
      y = newPage();
      y = section(y, 'Cost of Capital & Growth Rates', 'Costo promedio ponderado de capital y tasas de crecimiento histórico compuesto.');
      y = atableV2({
        startY: y,
        head: [['Metric', 'Value']],
        body: capRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 110, textColor: TX_D },
          1: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
        },
      });

      // Narrative
      if (waccVal) {
        y = paragraph(y, `The estimated weighted average cost of capital (WACC) of ${fp(waccVal)} represents the blended return required by all capital providers — both debt and equity — to compensate for the risk of holding ${co}'s securities. This rate serves as the discount factor in our discounted cash flow valuation framework and the hurdle rate against which incremental capital-allocation decisions should be evaluated.`, { serif: true });
      }
      if (cagrStats?.avgCagr != null) {
        y = paragraph(y, `Top-line growth has compounded at a blended ${fp(cagrStats.avgCagr)} across the 3-, 5-, and 10-year horizons, with cyclicality ranging from ${fp(cagrStats.minCagr)} to ${fp(cagrStats.maxCagr)}. The dispersion provides an empirical anchor for our forward growth assumptions.`, { serif: true });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // BETA & CAPM
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('beta_capm')) {
    const beta = profile?.beta;
    const riskFree = dcfCustom?.riskFreeRate ?? 4.25;
    const erp = 5.5;
    if (beta != null) {
      y = checkY(y, 70);
      if (y < 30) y = newPage();
      y = section(y, 'Beta & Cost of Equity (CAPM)', 'Análisis de riesgo sistemático y costo del capital propio bajo el modelo CAPM.');

      const capm = riskFree + beta * erp;

      y = atableV2({
        startY: y,
        head: [['Parameter', 'Value']],
        body: [
          ['Levered Beta',              f(beta)],
          ['Risk-Free Rate (Rf)',       fp(riskFree)],
          ['Equity Risk Premium (ERP)', fp(erp)],
          ['Cost of Equity (Ke)',       fp(capm)],
          ['CAPM Formula',              `Ke = ${f(riskFree, 1)}% + ${f(beta)} × ${f(erp, 1)}% = ${fp(capm)}`],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 90, textColor: TX_D },
          1: { cellWidth: 90, halign: 'right' },
        },
      });

      const betaInt = beta > 1.3 ? 'high volatility — the stock historically amplifies broad market movements, implying greater drawdowns in risk-off regimes'
        : beta > 0.8 ? 'moderate volatility — moves approximately in line with the broad market'
        : beta > 0 ? 'low volatility — defensive characteristics, less sensitive to market beta'
        : 'negative correlation with the market — a rare profile that may provide diversification benefits';
      y = paragraph(y, `Beta of ${f(beta)} implies ${betaInt}. Under the Capital Asset Pricing Model, this translates to a required equity return of ${fp(capm)}, which forms the equity component of our weighted average cost of capital calculation.`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SGR
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('sgr')) {
    const incSgr = (income || [])[0];
    const balSgr = (balance || [])[0];
    const cfSgr = (cashFlow || [])[0];
    if (incSgr && balSgr) {
      y = checkY(y, 60);
      if (y < 30) y = newPage();
      y = section(y, 'Sustainable Growth Rate (SGR)', 'Tasa de crecimiento sostenible: el ritmo que la empresa puede sostener sin emitir capital nuevo.');

      const niSgr = incSgr.netIncome || 0;
      const eqSgr = balSgr.totalStockholdersEquity || balSgr.totalEquity || 1;
      const divP = Math.abs(cfSgr?.dividendsPaid || 0);
      const roeSgr = niSgr / eqSgr;
      const payR = niSgr ? divP / niSgr : 0;
      const retR = 1 - payR;
      const sgr = roeSgr * retR;

      y = atableV2({
        startY: y,
        head: [['Component', 'Value']],
        body: [
          ['Return on Equity (ROE)',  fp(roeSgr * 100)],
          ['Net Income',              fl(niSgr)],
          ['Dividends Paid',          fl(divP)],
          ['Payout Ratio',            fp(payR * 100)],
          ['Retention Ratio (b)',     fp(retR * 100)],
          ['SGR = ROE × b',          fp(sgr * 100)],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 110, textColor: TX_D },
          1: { cellWidth: 70, halign: 'right' },
        },
      });

      y = paragraph(y, `The sustainable growth rate of ${fp(sgr * 100)} represents the maximum pace at which ${co} can grow its book equity organically — that is, without resorting to new equity issuance or balance-sheet leverage expansion. ${sgr * 100 > 15 ? 'This is a robust internal compounding profile' : sgr * 100 > 8 ? 'This represents a healthy organic growth runway' : 'This suggests reliance on external financing or buyback-driven EPS growth for above-SGR growth'}.`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // VALUATION MODELS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('valuation_models')) {
    y = newPage();
    y = section(y, 'Valuation Model Triangulation', 'Triangulación de valuación intrínseca usando múltiples metodologías independientes.');

    const avnVals = sharedAdvanceValueNet?.valuations;
    const models: { name: string; val: number }[] = [];
    if (avnVals) {
      Object.entries(avnVals).forEach(([k, v]) => {
        if (typeof v === 'number' && isFinite(v) && v > 0) {
          models.push({ name: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).substring(0, 24), val: +v });
        }
      });
    }
    if (models.length === 0) models.push(...computeValuationModels(dcfCustom, quote, KM));
    if (avgVal) models.push({ name: 'Blended Average', val: avgVal });

    if (models.length > 0 && price) {
      const maxV = Math.max(...models.map(m => m.val), price) * 1.08;
      const bH = 6, bSp = 9, barMaxW = CW - 56;
      const pLine = M + 50 + (price / maxV) * barMaxW;

      models.slice(0, 10).forEach((m, i) => {
        const by = y + i * bSp;
        const bw = Math.max(2, (m.val / maxV) * barMaxW);
        // Label
        doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(TX_D);
        doc.text(m.name.substring(0, 28), M, by + bH - 0.5);
        // Bar
        sf(m.name === 'Blended Average' ? NAVY : NAVY_L);
        doc.rect(M + 50, by, bw, bH, 'F');
        ss(NAVY); doc.setLineWidth(0.2); doc.rect(M + 50, by, bw, bH, 'S');
        // Value at end
        doc.setFont(SANS, 'bold'); doc.setFontSize(7);
        st(m.name === 'Blended Average' ? NAVY : TX_D);
        doc.text(fc(m.val, 0), M + 50 + bw + 2, by + bH - 0.5);
      });

      // Current price line
      ss(NEG); doc.setLineWidth(0.8);
      doc.line(pLine, y - 3, pLine, y + Math.min(models.length, 10) * bSp + 2);
      sf(NEG); doc.rect(pLine - 12, y - 9, 24, 5, 'F');
      doc.setFont(SANS, 'bold'); doc.setFontSize(6.5); st(WHITE);
      doc.text(`Price ${fc(price, 0)}`, pLine, y - 5.5, { align: 'center' });

      y += Math.min(models.length, 10) * bSp + 8;

      // Narrative
      if (avgVal != null) {
        y = paragraph(y, narrativeValuation(models.filter(m => m.name !== 'Blended Average'), price, avgVal), { serif: true });
      }
    }

    // Ratios summary
    const ratioRows = filterRows([
      ['P/E Ratio',         f(KM.peRatio ?? quote?.pe),                 'P/B Ratio',          f(KM.priceToBook ?? KM.pbRatio)],
      ['EV / EBITDA',       f(KM.evToEbitda ?? KM.enterpriseValueOverEBITDA), 'P/FCF', f(KM.priceToFCF ?? KM.pfcfRatio)],
      ['ROE',               fp((KM.roe ?? KM.returnOnEquity ?? 0) * 100), 'ROA',          fp((KM.roa ?? KM.returnOnAssets ?? 0) * 100)],
      ['Debt / Equity',     f(KM.debtToEquity ?? KM.debtEquityRatio),    'Current Ratio', f(KM.currentRatio)],
    ], [1, 3]);
    if (ratioRows.length > 0) {
      y = checkY(y, 45);
      y = subsection(y, 'Valuation Ratios Summary');
      y = atableV2({
        startY: y,
        head: [['Metric', 'Value', 'Metric', 'Value']],
        body: ratioRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 46, textColor: TX_D },
          1: { cellWidth: 42, halign: 'right' },
          2: { fontStyle: 'bold', cellWidth: 46, textColor: TX_D },
          3: { cellWidth: 46, halign: 'right' },
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
      fcSlice.map((fcRow: any) => [
        fcRow.date?.substring(0, 4) || '—',
        fl(fcRow.estimatedRevenueAvg),
        fc(fcRow.estimatedEpsAvg),
        fl(fcRow.estimatedNetIncomeAvg),
        fl(fcRow.estimatedEbitdaAvg),
      ]),
      [1, 2, 3, 4],
    );
    if (fcRows.length > 0) {
      y = newPage();
      y = section(y, 'Analyst Consensus Estimates', 'Estimaciones agregadas de la comunidad de analistas para los próximos años.');
      y = atableV2({
        startY: y,
        head: [['Year', 'Revenue Est.', 'EPS Est.', 'Net Income Est.', 'EBITDA Est.']],
        body: fcRows,
      });

      const revData = fcSlice.filter((rd: any) => rd.estimatedRevenueAvg);
      if (revData.length >= 2) {
        y = checkY(y, 58);
        y = subsection(y, 'Revenue Forecast — Analyst Consensus');
        barChart(M, y + 2, CW, 40,
          revData.map((rd: any) => rd.date?.substring(0, 4) || ''),
          revData.map((rd: any) => rd.estimatedRevenueAvg || 0), NAVY);
        y += 50;
      }

      // Narrative
      const first = fcSlice[0], last = fcSlice[fcSlice.length - 1];
      if (first?.estimatedRevenueAvg && last?.estimatedRevenueAvg && fcSlice.length > 1) {
        const fwdGrowth = ((last.estimatedRevenueAvg / first.estimatedRevenueAvg) ** (1 / (fcSlice.length - 1)) - 1) * 100;
        y = paragraph(y, `Analyst consensus implies forward revenue growth of approximately ${fwdGrowth.toFixed(1)}% per annum over the ${fcSlice.length - 1}-year horizon, from ${fl(first.estimatedRevenueAvg)} in ${first.date?.substring(0, 4)} to ${fl(last.estimatedRevenueAvg)} in ${last.date?.substring(0, 4)}. These forecasts form the baseline assumption set for our forward-looking valuation models.`, { serif: true });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // REVENUE FORECAST (Holt's + Regression)
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('revenue_forecast') && income?.length >= 3) {
    y = newPage();
    y = section(y, 'Revenue Forecast Models', 'Proyección de ingresos usando suavizado exponencial de Holt y regresión lineal.');

    const revSorted = [...income].filter((i: any) => i.revenue > 0)
      .sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
    const revData = revSorted.map((i: any) => i.revenue);

    if (revData.length >= 3) {
      const alpha = 0.6, betaH = 0.3;
      let level = revData[0], trend = revData[1] - revData[0];
      const fitted: number[] = [level];
      for (let t = 1; t < revData.length; t++) {
        const prevLevel = level, prevTrend = trend;
        level = alpha * revData[t] + (1 - alpha) * (prevLevel + prevTrend);
        trend = betaH * (level - prevLevel) + (1 - betaH) * prevTrend;
        fitted.push(level);
      }
      const holtForecast: number[] = [];
      for (let h = 1; h <= 3; h++) holtForecast.push(level + trend * h);

      const n = revData.length;
      const xMean = (n - 1) / 2, yMean = revData.reduce((a: number, b: number) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) { num += (i - xMean) * (revData[i] - yMean); den += (i - xMean) ** 2; }
      const slope = den ? num / den : 0, intercept = yMean - slope * xMean;
      const regForecast: number[] = [];
      for (let h = 0; h < 3; h++) regForecast.push(intercept + slope * (n + h));

      const lastYear = parseInt(revSorted[revSorted.length - 1]?.date?.substring(0, 4) || '2024');
      const tBody: string[][] = [];
      revSorted.slice(-5).forEach((r: any) => {
        tBody.push([r.date?.substring(0, 4) || '', fl(r.revenue), '—', '—']);
      });
      for (let h = 0; h < 3; h++) {
        tBody.push([
          String(lastYear + h + 1) + 'E',
          '—',
          fl(holtForecast[h]),
          fl(regForecast[h]),
        ]);
      }
      y = atableV2({
        startY: y,
        head: [['Year', 'Actual Revenue', "Holt's Forecast", 'Linear Regression']],
        body: tBody,
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 35, textColor: TX_D } },
      });

      y = checkY(y, 55);
      y = subsection(y, 'Revenue Projection — Historical + Forecasted');
      const allLabels = [
        ...revSorted.slice(-5).map((r: any) => r.date?.substring(0, 4) || ''),
        ...Array.from({ length: 3 }, (_, i) => String(lastYear + i + 1) + 'E'),
      ];
      const allValues = [...revSorted.slice(-5).map((r: any) => r.revenue || 0), ...holtForecast];
      barChart(M, y + 2, CW, 42, allLabels, allValues, NAVY);
      y += 52;

      y = paragraph(y, `Two complementary methodologies are presented: Holt's double exponential smoothing (which captures level and trend dynamics) and ordinary least squares regression (which fits a linear time trend). The convergence or divergence of these forecasts provides a sense of forecast uncertainty: holt projects ${fl(holtForecast[2])} for ${lastYear + 3}E while linear regression projects ${fl(regForecast[2])} — a ${Math.abs(((holtForecast[2] - regForecast[2]) / regForecast[2]) * 100).toFixed(1)}% gap that reflects model-selection sensitivity.`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PRICE TARGET
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('price_target')) {
    const tgt = priceTarget?.priceTarget || priceTarget?.priceTargetAvg;
    const tgtH = priceTarget?.priceTargetHigh;
    const tgtL = priceTarget?.priceTargetLow;

    if (tgt && tgtL && tgtH && price) {
      y = newPage();
      y = section(y, 'Analyst Price Target', 'Rango de precio objetivo según el consenso de analistas que cubren la acción.');

      const mn = Math.min(+price, +tgtL) * 0.94;
      const mx = Math.max(+price, +tgtH) * 1.06;
      const rng = mx - mn;
      const scl = (CW - 20) / rng;
      const tY = y + 12;

      // Track
      sf(G2); doc.rect(M + 10, tY, CW - 20, 6, 'F');
      ss(G3); doc.setLineWidth(0.2); doc.rect(M + 10, tY, CW - 20, 6, 'S');
      // Range band
      sf(NAVY_L);
      doc.rect(M + 10 + (tgtL - mn) * scl, tY, (tgtH - tgtL) * scl, 6, 'F');
      ss(NAVY); doc.setLineWidth(0.3);
      doc.rect(M + 10 + (tgtL - mn) * scl, tY, (tgtH - tgtL) * scl, 6, 'S');

      // Current price marker
      const pX = M + 10 + (price - mn) * scl;
      ss(NEG); doc.setLineWidth(0.6);
      doc.line(pX, tY - 2, pX, tY + 8);
      sf(NEG); doc.circle(pX, tY + 3, 1.8, 'F');
      // Target marker
      const tX2 = M + 10 + (tgt - mn) * scl;
      sf(NAVY); doc.circle(tX2, tY + 3, 2.2, 'F');
      ss(WHITE); doc.setLineWidth(0.4); doc.circle(tX2, tY + 3, 2.2, 'S');

      // Labels
      doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NEG);
      doc.text(`Current ${fc(price, 0)}`, pX, tY + 13, { align: 'center' });
      st(NAVY);
      doc.text(`Target ${fc(tgt, 0)}`, tX2, tY - 3, { align: 'center' });
      st(TX_M); doc.setFontSize(6); doc.setFont(SANS, 'normal');
      doc.text(`Low ${fc(tgtL, 0)}`, M + 10 + (tgtL - mn) * scl, tY + 13, { align: 'center' });
      doc.text(`High ${fc(tgtH, 0)}`, M + 10 + (tgtH - mn) * scl, tY + 13, { align: 'center' });

      y = tY + 22;
      y = atableV2({
        startY: y,
        head: [['Metric', 'Value']],
        body: [
          ['Average Price Target', fc(tgt)],
          ['Median Target',        fc(priceTarget.priceTargetMedian)],
          ['High Target',          fc(tgtH)],
          ['Low Target',           fc(tgtL)],
          ['Number of Analysts',   f(priceTarget.numberOfAnalysts || priceTarget.lastMonthNumberOfAnalysts, 0)],
          ['Consensus Rating',     priceTarget.consensus || priceTarget.lastMonthConsensus || '—'],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 100, textColor: TX_D },
          1: { cellWidth: 80, halign: 'right' },
        },
      });

      const upside = ((tgt - price) / price) * 100;
      y = paragraph(y, `The analyst community has established a consensus price target of ${fc(tgt)} with a range spanning ${fc(tgtL)} (low) to ${fc(tgtH)} (high), implying an expected return of ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% versus the current market price. ${priceTarget.consensus ? `The aggregate consensus rating is currently "${priceTarget.consensus}".` : ''}`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // GROWTH ANALYSIS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('growth_analysis')) {
    const fg = (financialGrowth || [])[0];
    const ig = (incomeGrowth || [])[0];
    const growthRows = filterRows([
      ['Revenue Growth',         fp((fg?.revenueGrowth ?? ig?.growthRevenue ?? 0) * 100),         'Net Income Growth',   fp((fg?.netIncomeGrowth ?? ig?.growthNetIncome ?? 0) * 100)],
      ['EPS Growth',             fp((fg?.epsgrowth ?? fg?.epsGrowth ?? 0) * 100),                  'EBITDA Growth',       fp((fg?.ebitdagrowth ?? 0) * 100)],
      ['Operating Income Growth', fp((fg?.operatingIncomeGrowth ?? ig?.growthOperatingIncome ?? 0) * 100), 'Gross Profit Growth', fp((fg?.grossProfitGrowth ?? ig?.growthGrossProfit ?? 0) * 100)],
      ['FCF Growth',             fp((fg?.freeCashFlowGrowth ?? 0) * 100),                          'Book Value Growth',   fp((fg?.bookValueperShareGrowth ?? 0) * 100)],
      ['Debt Growth',            fp((fg?.debtGrowth ?? 0) * 100),                                  'R&D Growth',          fp((fg?.rdexpenseGrowth ?? 0) * 100)],
      ['Dividend / Share Growth', fp((fg?.dividendsperShareGrowth ?? 0) * 100),                    'SG&A Growth',         fp((fg?.sgaexpensesGrowth ?? 0) * 100)],
      ['Asset Growth',           fp((fg?.assetGrowth ?? 0) * 100),                                 'Receivables Growth',  fp((fg?.receivablesGrowth ?? 0) * 100)],
      ['Inventory Growth',       fp((fg?.inventoryGrowth ?? 0) * 100),                             'Operating CF Growth', fp((fg?.operatingCashFlowGrowth ?? 0) * 100)],
    ], [1, 3]);
    if (growthRows.length > 0) {
      y = newPage();
      y = section(y, 'Growth Analysis — Year-over-Year', 'Análisis de crecimiento interanual en métricas operativas y financieras clave.');
      y = atableV2({
        startY: y,
        head: [['Metric', 'YoY %', 'Metric', 'YoY %']],
        body: growthRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 56, textColor: TX_D },
          1: { cellWidth: 34, halign: 'right' },
          2: { fontStyle: 'bold', cellWidth: 56, textColor: TX_D },
          3: { cellWidth: 34, halign: 'right' },
        },
      });

      if (cagrStats?.avgCagr != null) {
        y = checkY(y, 30);
        y = subsection(y, 'Revenue CAGR Summary');
        y = atableV2({
          startY: y,
          head: [['Metric', 'Value']],
          body: [
            ['Average CAGR (3/5/10Y blended)', fp(cagrStats.avgCagr)],
            ['Minimum CAGR (trough)',          fp(cagrStats.minCagr)],
            ['Maximum CAGR (peak)',            fp(cagrStats.maxCagr)],
          ],
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 110, textColor: TX_D },
            1: { cellWidth: 70, halign: 'right' },
          },
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
      y = checkY(y, 60);
      if (y < 30) y = newPage();
      y = section(y, 'Enterprise Value Decomposition', 'Desglose del valor de empresa en sus componentes a lo largo del tiempo.');
      const evYrs = ev5.map((e: any) => e.date?.substring(0, 4) || '');
      y = atableV2({
        startY: y,
        head: [['', ...evYrs]],
        body: [
          ['Market Capitalization',  ...ev5.map((e: any) => fl(e.marketCapitalization))],
          ['+ Total Debt',           ...ev5.map((e: any) => fl(e.addTotalDebt))],
          ['− Cash & Equivalents',   ...ev5.map((e: any) => fl(e.minusCashAndCashEquivalents))],
          ['= Enterprise Value',     ...ev5.map((e: any) => fl(e.enterpriseValue))],
          ['Shares Outstanding',     ...ev5.map((e: any) => fl(e.numberOfShares))],
          ['Stock Price',            ...ev5.map((e: any) => fc(e.stockPrice))],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, textColor: TX_D } },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // DIVIDENDS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('dividends') && dividends?.length) {
    y = newPage();
    y = section(y, 'Dividend History', 'Historial de pagos de dividendos por acción y métricas de capital return.');

    const divSlice = (dividends || []).slice(0, 16);
    const divRows = divSlice.map((dv: any) => [
      dv.date || dv.paymentDate || '—',
      fc(dv.dividend ?? dv.adjDividend, 4),
      dv.recordDate || '—',
      dv.declarationDate || '—',
    ]);
    if (divRows.length > 0) {
      y = atableV2({
        startY: y,
        head: [['Payment Date', 'Dividend / Share', 'Record Date', 'Declaration Date']],
        body: divRows,
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42, textColor: TX_D } },
      });
    }

    const divYield = (quote?.dividendYield || 0) * 100;
    const payoutR = (KM.payoutRatio || 0) * 100;
    if (divYield > 0 || payoutR > 0) {
      y = checkY(y, 30);
      y = subsection(y, 'Dividend Summary');
      const divSumRows: string[][] = [
        ['Annual Dividend Yield', fp(divYield)],
        ['Payout Ratio',          fp(payoutR)],
      ];
      if (KM.dividendPerShare) divSumRows.push(['Dividend Per Share (TTM)', fc(KM.dividendPerShare)]);
      y = atableV2({
        startY: y,
        head: [['Metric', 'Value']],
        body: divSumRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 110, textColor: TX_D },
          1: { cellWidth: 70, halign: 'right' },
        },
      });

      if (divYield > 0) {
        y = paragraph(y, `${co} returns capital to shareholders through a ${fp(divYield)} dividend yield, with ${fp(payoutR)} of net income distributed as dividends. ${payoutR > 80 ? 'The high payout ratio constrains reinvestment capacity and elevates sensitivity to earnings volatility.' : payoutR > 50 ? 'The payout ratio reflects a balanced approach to capital return and reinvestment.' : 'The conservative payout ratio preserves substantial reinvestment optionality.'}`, { serif: true });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // OWNER EARNINGS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('owner_earnings') && ownerEarnings?.length) {
    const oe5 = (ownerEarnings || []).slice(0, 5).reverse();
    if (oe5.length > 0) {
      y = newPage();
      y = section(y, 'Owner Earnings — Buffett Methodology', 'Ganancias del propietario: aproximación de Warren Buffett al flujo de caja económico real.');
      const oeYrs = oe5.map((o: any) => o.date?.substring(0, 4) || '');
      y = atableV2({
        startY: y,
        head: [['', ...oeYrs]],
        body: filterRows([
          ['Net Income',                ...oe5.map((o: any) => fl(o.netIncome))],
          ['+ Depreciation & Amort.',   ...oe5.map((o: any) => fl(o.depreciationAndAmortization))],
          ['− Maintenance CapEx',       ...oe5.map((o: any) => fl(o.maintenanceCapex))],
          ['− Working Capital Δ',       ...oe5.map((o: any) => fl(o.workingCapital))],
          ['= Owner Earnings',          ...oe5.map((o: any) => fl(o.ownerEarnings))],
          ['Owner Earnings / Share',    ...oe5.map((o: any) => fc(o.ownerEarningsPerShare))],
          ['Growth CapEx',              ...oe5.map((o: any) => fl(o.growthCapex))],
        ], oeYrs.map((_: any, i: number) => i + 1)),
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 56, textColor: TX_D } },
      });

      y = paragraph(y, `Owner earnings — the cash that an owner could extract without impairing the business's competitive position — provide a more economically realistic measure of cash-generative capacity than reported GAAP net income, particularly for capital-intensive businesses. The framework subtracts maintenance capital expenditures (required to sustain the asset base) and working-capital build, isolating the residual cash available for distribution, reinvestment in growth, or balance-sheet deleveraging.`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // TTM SNAPSHOT
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('ttm_snapshot')) {
    const ttm = Array.isArray(incomeTTM) ? incomeTTM[0] : incomeTTM;
    if (ttm) {
      y = checkY(y, 50);
      if (y < 30) y = newPage();
      y = section(y, 'Trailing Twelve Months (TTM)', 'Métricas trailing twelve months más recientes — el período más relevante para análisis fundamental.');
      y = atableV2({
        startY: y,
        body: [
          ['Revenue TTM',        fl(ttm.revenue),                            'Gross Profit TTM',   fl(ttm.grossProfit)],
          ['EBITDA TTM',         fl(ttm.ebitda),                             'Net Income TTM',     fl(ttm.netIncome)],
          ['EPS Diluted TTM',    fc(ttm.epsdiluted || ttm.eps),              'Gross Margin TTM',   fp((ttm.grossProfitRatio || 0) * 100)],
          ['Operating Margin TTM', fp((ttm.operatingIncomeRatio || 0) * 100), 'Net Margin TTM',     fp((ttm.netIncomeRatio || 0) * 100)],
        ],
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 48, textColor: TX_D },
          1: { cellWidth: 42, halign: 'right' },
          2: { fontStyle: 'bold', cellWidth: 48, textColor: TX_D },
          3: { cellWidth: 42, halign: 'right' },
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
      y = section(y, '52-Week Price Position', 'Posición del precio actual relativa al rango de 52 semanas y momentum técnico.');
      const lo = +pa52.low52Week * 0.96, hi = +pa52.high52Week * 1.04;
      const sp = hi - lo, sc = (CW - 20) / sp;
      const tY = y + 12;

      // Track
      sf(G2); doc.rect(M + 10, tY, CW - 20, 7, 'F');
      ss(G3); doc.setLineWidth(0.2); doc.rect(M + 10, tY, CW - 20, 7, 'S');
      // Fill to price
      const ppos = M + 10 + (price - lo) * sc;
      sf(NAVY_L); doc.rect(M + 10, tY, ppos - (M + 10), 7, 'F');
      // Dot at price
      sf(NAVY); doc.circle(ppos, tY + 3.5, 2.5, 'F');
      ss(WHITE); doc.setLineWidth(0.5); doc.circle(ppos, tY + 3.5, 2.5, 'S');

      doc.setFont(SANS, 'bold'); doc.setFontSize(8); st(NAVY);
      doc.text(fc(price, 0), ppos, tY + 14, { align: 'center' });
      doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(TX_M);
      doc.text(`52W Low: ${fc(pa52.low52Week, 0)}`, M + 10, tY + 14);
      doc.text(`52W High: ${fc(pa52.high52Week, 0)}`, PW - M - 10, tY + 14, { align: 'right' });

      const fromHigh = ((price / pa52.high52Week) - 1) * 100;
      const fromLow = ((price / pa52.low52Week) - 1) * 100;
      y = tY + 22;
      doc.setFont(SANS, 'bold'); doc.setFontSize(9);
      st(fromHigh < -20 ? NEG : fromHigh < -5 ? WARN : POS);
      doc.text(`${fromHigh.toFixed(1)}% from 52W High  ·  ${fromLow >= 0 ? '+' : ''}${fromLow.toFixed(1)}% from 52W Low`, PW/2, y, { align: 'center' });
      y += 10;

      const techRead = fromHigh > -5 ? 'trading near the 52-week peak, implying strong momentum and bullish positioning'
        : fromHigh > -15 ? 'within striking distance of the 52-week high, with constructive technical setup'
        : fromHigh > -30 ? 'consolidating below the 52-week high, with mixed technical signals'
        : 'in a meaningful drawdown from the 52-week high, potentially offering value or signaling negative momentum';
      y = paragraph(y, `${co} is currently ${techRead}. The stock has retraced ${fromHigh.toFixed(1)}% from its 52-week peak of ${fc(pa52.high52Week, 0)} and has appreciated ${fromLow.toFixed(1)}% from its trough of ${fc(pa52.low52Week, 0)}.`, { serif: true });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PIVOTS & FIBONACCI
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('pivots_fibonacci') && pivot?.pivotPoint) {
    const paFib = pivot;
    y = checkY(y, 50);
    if (y < 30) y = newPage();
    y = section(y, 'Pivot Points & Fibonacci Levels', 'Niveles técnicos de soporte, resistencia y retrocesos Fibonacci para timing de entrada.');
    y = atableV2({
      startY: y,
      head: [['Level', 'Price', 'Level', 'Price']],
      body: [
        ['Pivot Point',     fc(paFib.pivotPoint),       'Current Price',   fc(paFib.currentPrice)],
        ['Resistance R1',   fc(paFib.resistance?.R1),   'Resistance R2',   fc(paFib.resistance?.R2)],
        ['Support S1',      fc(paFib.support?.S1),      'Support S2',      fc(paFib.support?.S2)],
        ['Fib 23.6%',       fc(paFib.fibonacci?.level236), 'Fib 38.2%',    fc(paFib.fibonacci?.level382)],
        ['Fib 50.0%',       fc(paFib.fibonacci?.level500), 'Fib 61.8%',    fc(paFib.fibonacci?.level618)],
        ['Fib 78.6%',       fc(paFib.fibonacci?.level786), '% from 52W Low', fp(paFib.priceVsLow)],
      ],
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 48, textColor: TX_D },
        1: { cellWidth: 42, halign: 'right' },
        2: { fontStyle: 'bold', cellWidth: 48, textColor: TX_D },
        3: { cellWidth: 42, halign: 'right' },
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMPETITORS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('competitors')) {
    const peersRaw = await fmpFetch(`stable/stock-peers`, { symbol: ticker });
    const peers: string[] = (Array.isArray(peersRaw) ? peersRaw[0]?.peersList : peersRaw?.peersList) || [];
    if (peers.length > 0) {
      const peerSymbols = peers.slice(0, 8).join(',');
      const peerQuotes = await fmpFetch(`stable/quote`, { symbol: peerSymbols });
      const allQuotes = Array.isArray(peerQuotes) ? peerQuotes : [peerQuotes];

      if (allQuotes.length > 0) {
        y = newPage();
        y = section(y, 'Peer Comparison', 'Comparación con compañías comparables del mismo sector e industria.');

        const compRows = allQuotes.filter(Boolean).map((pq: any) => [
          pq.symbol || '—',
          (pq.name || '—').substring(0, 28),
          fl(pq.marketCap),
          f(pq.pe),
          fc(pq.price),
          fp(pq.changesPercentage),
        ]);

        compRows.unshift([
          ticker,
          co.substring(0, 28),
          fl(quote?.marketCap),
          f(quote?.pe),
          fc(price),
          fp(quote?.changesPercentage),
        ]);

        y = atableV2({
          startY: y,
          head: [['Symbol', 'Company', 'Market Cap', 'P/E', 'Price', 'Δ %']],
          body: compRows,
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 22, textColor: TX_D },
            1: { cellWidth: 50 },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'right' },
          },
          didParseCell: (data: any) => {
            if (data.row.index === 0 && data.section === 'body') {
              data.cell.styles.fillColor = NAVY_L;
              data.cell.styles.textColor = NAVY_D;
              data.cell.styles.fontStyle = 'bold';
            }
          },
        });

        y = paragraph(y, `The peer set above represents the closest comparables based on FMP's classification. The highlighted row identifies ${co}, allowing for at-a-glance benchmarking on size, valuation multiples, and recent price action. Cross-sectional comparison contextualizes the current valuation relative to a relevant cohort.`, { serif: true });
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
      y = section(y, 'Industry & Sector Overview', 'Rendimiento agregado del sector y valoración relativa por industria.');

      doc.setFont(SANS, 'bold'); doc.setFontSize(8); st(NAVY);
      doc.text(`Classification:  ${sect}  ·  ${ind}`, M, y);
      y += 8;

      if (hasSector) {
        y = subsection(y, 'Sector Performance (% change)');
        const sRows = (sectorPerf as any[]).sort((a: any, b: any) => {
          const av = parseFloat(String(a.changesPercentage || '0').replace('%', ''));
          const bv = parseFloat(String(b.changesPercentage || '0').replace('%', ''));
          return bv - av;
        }).map((s: any) => {
          const ch = parseFloat(String(s.changesPercentage || '0').replace('%', ''));
          return [s.sector || '—', `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%`];
        });
        y = atableV2({
          startY: y,
          head: [['Sector', 'Performance']],
          body: sRows,
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 110, textColor: TX_D },
            1: { cellWidth: 70, halign: 'right' },
          },
          didParseCell: (data: any) => {
            if (data.section === 'body' && data.row.raw?.[0] === sect) {
              data.cell.styles.fillColor = NAVY_L;
              data.cell.styles.textColor = NAVY_D;
              data.cell.styles.fontStyle = 'bold';
            }
          },
        });
      }

      if (hasPE) {
        y = checkY(y, 50);
        y = subsection(y, 'Sector P/E Ratios');
        const peRows = (sectorPE as any[]).slice(0, 15).map((s: any) => [
          s.sector || '—',
          f(s.pe),
          s.exchange || '—',
        ]);
        y = atableV2({
          startY: y,
          head: [['Sector', 'P/E Ratio', 'Exchange']],
          body: peRows,
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 80, textColor: TX_D } },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // HOLDERS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('holders')) {
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
      y = section(y, 'Ownership Structure', 'Composición accionarial: principales holders institucionales, fondos mutuos y operaciones de insiders.');

      if (hasInst) {
        y = subsection(y, 'Top Institutional Holders');
        const instRows = (instHolders as any[]).slice(0, 10).map((h: any) => [
          (h.holder || h.investorName || '—').substring(0, 32),
          fl(h.shares),
          fl(h.value),
          h.dateReported?.substring(0, 10) || '—',
        ]);
        y = atableV2({
          startY: y,
          head: [['Holder', 'Shares', 'Value', 'Date']],
          body: instRows,
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70, textColor: TX_D } },
        });
      }

      if (hasMutual) {
        y = checkY(y, 50);
        y = subsection(y, 'Top Mutual Fund Holders');
        const mfRows = (mutualHolders as any[]).slice(0, 10).map((h: any) => [
          (h.holder || '—').substring(0, 32),
          fl(h.shares),
          fl(h.value),
          fp((h.weightedAveragePercentage || 0)),
        ]);
        y = atableV2({
          startY: y,
          head: [['Fund', 'Shares', 'Value', 'Weight %']],
          body: mfRows,
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70, textColor: TX_D } },
        });
      }

      if (hasInsider) {
        y = checkY(y, 50);
        y = subsection(y, 'Recent Insider Transactions');
        const insRows = (insiderTrades as any[]).slice(0, 12).map((t: any) => [
          (t.reportingName || '—').substring(0, 26),
          t.transactionType || '—',
          fl(t.securitiesTransacted),
          fc(t.price),
          t.transactionDate?.substring(0, 10) || '—',
        ]);
        y = atableV2({
          startY: y,
          head: [['Insider', 'Type', 'Shares', 'Price', 'Date']],
          body: insRows,
          columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, textColor: TX_D } },
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SEGMENTATION
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
      y = section(y, 'Revenue Segmentation', 'Desglose de ingresos por línea de producto/servicio y por región geográfica.');

      if (hasProd) {
        const latest = prodSeg[0];
        const segments = typeof latest === 'object' ? latest : {};
        const dateKey = Object.keys(segments)[0];
        const segData = dateKey ? segments[dateKey] : segments;
        if (segData && typeof segData === 'object') {
          y = subsection(y, 'Product / Business Segments');
          const entries = Object.entries(segData).filter(([, v]) => typeof v === 'number' && (v as number) > 0);
          const total = entries.reduce((s, [, v]) => s + (v as number), 0);
          const segRows = entries
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([name, val]) => [
              name.substring(0, 40),
              fl(val),
              total > 0 ? fp(((val as number) / total) * 100) : '—',
            ]);
          if (segRows.length > 0) {
            y = atableV2({
              startY: y,
              head: [['Segment', 'Revenue', '% of Total']],
              body: segRows,
              columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90, textColor: TX_D } },
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
          y = checkY(y, 50);
          y = subsection(y, 'Geographic Segments');
          const entries = Object.entries(segData).filter(([, v]) => typeof v === 'number' && (v as number) > 0);
          const total = entries.reduce((s, [, v]) => s + (v as number), 0);
          const geoRows = entries
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .map(([name, val]) => [
              name.substring(0, 40),
              fl(val),
              total > 0 ? fp(((val as number) / total) * 100) : '—',
            ]);
          if (geoRows.length > 0) {
            y = atableV2({
              startY: y,
              head: [['Region', 'Revenue', '% of Total']],
              body: geoRows,
              columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90, textColor: TX_D } },
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
    const newsRaw = preloadedNews?.length ? preloadedNews : await fmpFetch(`stable/news/stock`, { symbol: ticker, limit: '15' });
    const newsData = Array.isArray(newsRaw) ? newsRaw : [];
    if (newsData.length > 0) {
      y = newPage();
      y = section(y, 'Recent News & Catalysts', 'Noticias recientes y eventos relevantes que pueden impactar la tesis de inversión.');

      newsData.slice(0, 12).forEach((article: any, idx: number) => {
        y = checkY(y, 22);
        // Number badge
        sf(NAVY); doc.rect(M, y, 5, 5, 'F');
        doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(WHITE);
        doc.text(String(idx + 1), M + 2.5, y + 3.7, { align: 'center' });
        // Title
        doc.setFont(SERIF, 'bold'); doc.setFontSize(8.5); st(BLACK);
        const title = (article.title || 'No title').substring(0, 100);
        const tl: string[] = doc.splitTextToSize(title, CW - 8);
        tl.slice(0, 2).forEach((line, li) => doc.text(line, M + 8, y + 3.5 + li * 4));
        y += Math.min(tl.length, 2) * 4 + 3;
        // Meta
        doc.setFont(SANS, 'italic'); doc.setFontSize(6.5); st(TX_M);
        const meta = `${article.site || '—'}  ·  ${article.publishedDate?.substring(0, 10) || ''}`;
        doc.text(meta, M + 8, y);
        y += 3.5;
        // Snippet
        if (article.text) {
          doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(TX_D);
          const snippet = article.text.substring(0, 180) + (article.text.length > 180 ? '…' : '');
          const sl: string[] = doc.splitTextToSize(snippet, CW - 10);
          sl.slice(0, 2).forEach((line: string, li: number) => doc.text(line, M + 8, y + li * 3.8));
          y += Math.min(sl.length, 2) * 3.8;
        }
        // Separator
        ss(G3); doc.setLineWidth(0.1); doc.line(M, y + 2, PW - M, y + 2);
        y += 5;
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // RISK FACTORS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('risk_factors')) {
    y = newPage();
    y = section(y, 'Risk Factors', 'Factores de riesgo materiales que podrían impactar negativamente la tesis de inversión.');

    y = paragraph(y, `An investment in ${co} entails certain risks that warrant explicit consideration. The following section enumerates material risk factors identified through fundamental analysis. This list is illustrative rather than exhaustive; investors should conduct their own due diligence and consult primary disclosures.`, { serif: true });

    const beta = profile?.beta;
    const latestBal = (balance || [])[0];
    const latestInc = (income || [])[0];
    const risks = narrativeRisks(co, beta, latestBal?.totalDebt, latestBal?.totalStockholdersEquity || latestBal?.totalEquity, latestInc?.netIncomeRatio || 0);

    risks.forEach((risk, i) => {
      y = checkY(y, 18);
      // Risk header
      sf(NEG); doc.rect(M, y, 3, 11, 'F');
      doc.setFont(SANS, 'bold'); doc.setFontSize(8); st(NEG);
      doc.text(`RISK ${i + 1}`, M + 6, y + 5);
      doc.setFont(SERIF, 'normal'); doc.setFontSize(8.5); st(TX_D);
      const lines: string[] = doc.splitTextToSize(risk, CW - 10);
      lines.forEach((ln, li) => doc.text(ln, M + 6, y + 9.5 + li * 4));
      y += Math.max(13, 9.5 + lines.length * 4 + 3);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // GROWTH CATALYSTS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('catalysts')) {
    y = newPage();
    y = section(y, 'Growth Catalysts', 'Catalizadores potenciales que podrían acelerar la realización de valor.');

    y = paragraph(y, `Beyond steady-state operations, several identifiable catalysts could meaningfully alter ${co}'s trajectory and re-rate the equity. The following catalysts are organized by likelihood and potential impact, drawing on fundamental signals embedded in the historical financials and forward analyst expectations.`, { serif: true });

    const divYield = quote?.dividendYield || 0;
    const catalysts = narrativeCatalysts(co, cagrStats?.avgCagr ?? null, qualityNet, divYield);

    catalysts.forEach((cat, i) => {
      y = checkY(y, 18);
      sf(POS); doc.rect(M, y, 3, 11, 'F');
      doc.setFont(SANS, 'bold'); doc.setFontSize(8); st(POS);
      doc.text(`CATALYST ${i + 1}`, M + 6, y + 5);
      doc.setFont(SERIF, 'normal'); doc.setFontSize(8.5); st(TX_D);
      const lines: string[] = doc.splitTextToSize(cat, CW - 10);
      lines.forEach((ln, li) => doc.text(ln, M + 6, y + 9.5 + li * 4));
      y += Math.max(13, 9.5 + lines.length * 4 + 3);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // ANALISIS FINAL — INVESTMENT VERDICT
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('analisis_final') && avgVal != null && price) {
    y = newPage();
    y = section(y, 'Investment Analysis — Final Verdict', 'Veredicto final consolidando valuación, calidad y perspectiva.');

    const upside = ((avgVal - price) / price) * 100;
    const marginOfSafety = 0.15;
    const buyPrice = avgVal * (1 - marginOfSafety);
    const verdict = upside > 30 ? 'STRONG BUY' :
                    upside > 15 ? 'BUY' :
                    upside > -10 ? 'HOLD' :
                    upside > -25 ? 'SELL' : 'STRONG SELL';
    const vColor: RGB = upside > 15 ? POS : upside > -10 ? WARN : NEG;

    // Big verdict card
    sf(G1); doc.rect(M, y, CW, 36, 'F');
    sf(vColor); doc.rect(M, y, 4, 36, 'F');
    ss(G3); doc.setLineWidth(0.3); doc.rect(M, y, CW, 36, 'S');

    doc.setFont(SANS, 'bold'); doc.setFontSize(7); st(NAVY);
    doc.text('FINAL RECOMMENDATION', M + 10, y + 8);
    doc.setFont(SERIF, 'bold'); doc.setFontSize(26); st(vColor);
    doc.text(verdict, M + 10, y + 22);

    // Right: stats
    doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(TX_M);
    doc.text('FAIR VALUE', PW - M - 70, y + 8);
    doc.setFont(SANS, 'bold'); doc.setFontSize(14); st(TX_D);
    doc.text(fc(avgVal, 2), PW - M - 70, y + 16);

    doc.setFont(SANS, 'normal'); doc.setFontSize(7); st(TX_M);
    doc.text('EXPECTED RETURN', PW - M - 70, y + 22);
    doc.setFont(SANS, 'bold'); doc.setFontSize(14); st(vColor);
    doc.text(`${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`, PW - M - 70, y + 30);

    y += 42;

    // KPI row
    y = kpiRow(y, [
      { label: 'Current Price',       value: fc(price) },
      { label: 'Avg Valuation',       value: fc(avgVal), accent: true },
      { label: 'Buy Price (15% MoS)', value: fc(buyPrice), color: POS },
      { label: 'Expected Return',     value: `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`, color: vColor },
    ]);

    // Valuation models table
    y = checkY(y, 50);
    y = subsection(y, 'Valuation Models Summary');
    const avnVals2 = sharedAdvanceValueNet?.valuations;
    const modelList: { name: string; val: number }[] = [];
    if (avnVals2) {
      Object.entries(avnVals2).forEach(([k, v]) => {
        if (typeof v === 'number' && isFinite(v) && v > 0) {
          modelList.push({ name: k.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()), val: +v });
        }
      });
    }
    if (modelList.length === 0) modelList.push(...computeValuationModels(dcfCustom, quote, KM));
    if (modelList.length > 0) {
      const modelRows = modelList.map(m => {
        const mUp = ((m.val - price) / price * 100);
        return [m.name.substring(0, 28), fc(m.val), `${mUp >= 0 ? '+' : ''}${mUp.toFixed(1)}%`];
      });
      modelRows.push(['BLENDED AVERAGE', fc(avgVal), `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`]);
      y = atableV2({
        startY: y,
        head: [['Model', 'Fair Value', 'vs Current Price']],
        body: modelRows,
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 70, textColor: TX_D },
          1: { cellWidth: 50, halign: 'right' },
          2: { cellWidth: 50, halign: 'right', fontStyle: 'bold' },
        },
        didParseCell: (data: any) => {
          if (data.row.index === modelRows.length - 1 && data.section === 'body') {
            data.cell.styles.fillColor = NAVY_L;
            data.cell.styles.textColor = NAVY_D;
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });
    }

    // Quality assessment summary
    if (qualityNet?.totalScore != null) {
      y = checkY(y, 40);
      y = subsection(y, 'Quality Assessment');
      doc.setFont(SERIF, 'bold'); doc.setFontSize(10); st(NAVY);
      doc.text(`Overall Quality: ${(qualityNet.totalScore * 100).toFixed(0)} / 100 — "${qualityNet.rating}"`, M, y);
      y += 8;
      if (qualityNet.scores) {
        Object.entries(qualityNet.scores).forEach(([dim, score]: any) => {
          const pct = typeof score === 'number' ? +(score * 100).toFixed(0) : 0;
          const lbl = dim.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          y = checkY(y, 10);
          scoreBar(M, y, CW, lbl, pct);
          y += 9;
        });
      }
    }

    // Final narrative
    y = checkY(y, 30);
    y = paragraph(y + 4, `In summary, our blended valuation of ${fc(avgVal)} per share, combined with the quality assessment and forward-growth profile, supports a "${verdict}" recommendation. The implied expected return of ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% versus the current ${fc(price)} reflects the synthesized view across all analytical frameworks presented in this report. Investors should integrate this analysis with their own due diligence, portfolio context, and risk tolerance.`, { serif: true });
  }

  // ════════════════════════════════════════════════════════════════════════
  // DISCLAIMER
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('disclaimer')) {
    y = newPage();

    doc.setFont(SERIF, 'bold'); doc.setFontSize(16); st(BLACK);
    doc.text('Disclaimer & Important Disclosures', PW/2, y + 4, { align: 'center' });
    y += 12;
    ss(NAVY); doc.setLineWidth(0.5); doc.line(M + 30, y, PW - M - 30, y);
    y += 12;

    if (d.branding?.customDisclaimer) {
      y = paragraph(y, d.branding.customDisclaimer, { serif: true, size: 9 });
    } else {
      const disc = [
        `This Equity Research Report has been generated by ${userCo} for informational and educational purposes only. It does not constitute financial advice, investment recommendations, an offer to buy or sell any security, or a solicitation of any kind.`,
        `All financial data is sourced from Financial Modeling Prep (FMP) and other third-party data providers. While we strive for accuracy, no guarantee is made regarding the accuracy, completeness, or timeliness of the information presented. Past performance is not indicative of future results.`,
        `Valuation models, including but not limited to discounted cash flow (DCF), dividend discount models (DDM), Graham Number, multiples analysis, and Holt's exponential smoothing forecasts, rely on assumptions and estimates that may not reflect actual future performance. Different analysts using different assumptions may reach materially different conclusions.`,
        `Investing in securities involves substantial risk, including possible loss of principal. Forward-looking statements, including price targets and growth estimates, are subject to significant uncertainty. Investors should perform their own due diligence and consult with a qualified financial advisor before making any investment decision.`,
        `${userCo} and its analysts may or may not hold positions in the securities discussed in this report. This report is provided "as is" without warranties of any kind, either express or implied.`,
      ];

      disc.forEach(p => {
        y = paragraph(y, p, { serif: true, size: 8.5 });
        y += 2;
      });
    }

    y += 8;
    ss(G3); doc.setLineWidth(0.3); doc.line(M + 40, y, PW - M - 40, y);
    y += 8;

    doc.setFont(SERIF, 'bold'); doc.setFontSize(9); st(NAVY);
    doc.text(`${co}  (${ticker})`, PW/2, y, { align: 'center' });
    y += 5;
    doc.setFont(SANS, 'normal'); doc.setFontSize(7.5); st(TX_M);
    doc.text(date, PW/2, y, { align: 'center' });
    y += 5;
    doc.setFontSize(6.5); st(TX_L);
    doc.text(`Generated by ${userCo} — Equity Research Analytics`, PW/2, y, { align: 'center' });

    pageFooter();
  }

  // ── Save or preview ──────────────────────────────────────────────────
  if (d.preview) {
    const blob: Blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }
  const filePrefix = d.branding?.userCompany ? `${ticker}_${d.branding.userCompany.replace(/[^a-zA-Z0-9]/g, '_')}` : `${ticker}_Equity_Research`;
  doc.save(`${filePrefix}_${dateShort}.pdf`);
}
