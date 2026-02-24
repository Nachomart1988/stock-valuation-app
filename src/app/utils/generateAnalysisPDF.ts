// src/app/utils/generateAnalysisPDF.ts
// Professional Financial Analysis PDF — Black + Deutsche Bank Green #00A651

export interface PDFBranding {
  bgColor?:          [number, number, number];  // default [0,0,0]
  accentColor?:      [number, number, number];  // default [0,166,81]
  fontFamily?:       string;                    // default 'helvetica'
  logoBase64?:       string;                    // optional base64 data URL
  customDisclaimer?: string;                    // optional replacement disclaimer text
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
  sharedKeyMetricsSummary: any;
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
      'cover', 'market_summary', 'income_statement', 'balance_sheet', 'cash_flow',
      'key_metrics', 'dupont', 'quality_score', 'wacc_cagr', 'sgr',
      'valuation_models', 'analyst_forecasts', 'price_target', 'ttm_snapshot',
      'technical_52w', 'pivots_fibonacci', 'disclaimer',
    ]
  );
  const FONT = d.branding?.fontFamily ?? 'helvetica';

  // ── Palette ────────────────────────────────────────────────────────────
  const G:  RGB = d.branding?.accentColor ?? [0,  166, 81];  // accent (default: #00A651)
  const G2: RGB = [Math.max(0, G[0]-0), Math.max(0, Math.round(G[1]*0.6)), Math.max(0, Math.round(G[2]*0.54))]; // darker accent
  const W:  RGB = [255,255,255];
  const BK: RGB = d.branding?.bgColor    ?? [0,  0,  0];     // background (default: black)
  const D1: RGB = BK[0]+BK[1]+BK[2] === 0 ? [8,8,8]   : [Math.min(255,BK[0]+8), Math.min(255,BK[1]+8), Math.min(255,BK[2]+8)];
  const D3: RGB = BK[0]+BK[1]+BK[2] === 0 ? [22,22,22] : [Math.min(255,BK[0]+22),Math.min(255,BK[1]+22),Math.min(255,BK[2]+22)];
  const TW: RGB = [220,220,220];   // main text
  const TG: RGB = [130,130,130];   // muted text
  const RD: RGB = [220, 50, 50];   // negative/red

  const sf = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const ss = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const st = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

  const PW = 210, PH = 297, M = 14, CW = PW - 2*M;
  const today = new Date();
  const date  = today.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

  const { ticker, profile, quote, income, balance, cashFlow, incomeTTM,
          priceTarget, sharedAverageVal, sharedWACC, sharedAvgCAPM,
          sharedForecasts, sharedKeyMetricsSummary, sharedAdvanceValueNet,
          sharedCompanyQualityNet, sharedCagrStats, sharedPivotAnalysis,
          keyMetrics, keyMetricsTTM, ratios, ratiosTTM, estimates, dcfCustom } = d;

  // ── Resolve key metrics: raw FMP > shared state ──────────────────────
  const km0  = (keyMetrics || [])[0] || keyMetricsTTM || {};
  const rat0 = (ratios || [])[0] || ratiosTTM || {};
  // Merge raw metrics into a single lookup (raw FMP fields take priority)
  const KM: any = { ...rat0, ...km0, ...sharedKeyMetricsSummary };

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

  const co    = profile?.companyName || ticker;
  const sect  = profile?.sector   || '-';
  const ind   = profile?.industry || '-';
  const exch  = profile?.exchangeShortName || '-';
  const price = quote?.price;

  let pg = 1;

  // ── App Logo (green square "P") ────────────────────────────────────────
  function appLogo(x: number, y: number, sz = 8) {
    sf(G); doc.roundedRect(x, y, sz, sz, 1.2, 1.2, 'F');
    doc.setFont(FONT,'bold'); doc.setFontSize(sz * 0.8);
    st(W); doc.text('P', x + sz/2, y + sz*0.72, { align:'center' });
  }

  // ── Page header ────────────────────────────────────────────────────────
  function pageHeader() {
    sf(BK); doc.rect(0, 0, PW, 11, 'F');
    ss(G);  doc.setLineWidth(0.25); doc.line(0, 11, PW, 11);
    appLogo(M, 2, 7);
    doc.setFont(FONT,'bold'); doc.setFontSize(7); st(G);
    doc.text('Prismo', M+9.5, 7);
    doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TG);
    doc.text(`${ticker}  ·  ${co}`, M+22, 7);
    doc.text(`p.${pg}  ·  ${date}`, PW-M, 7, { align:'right' });
  }

  // ── Page footer ────────────────────────────────────────────────────────
  function pageFooter() {
    ss(D3); doc.setLineWidth(0.2); doc.line(M, PH-11, PW-M, PH-11);
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    doc.text('Prismo Investment Intelligence  ·  For informational purposes only  ·  Not financial advice', PW/2, PH-6.5, { align:'center' });
  }

  function newPage(): number {
    pageFooter();
    doc.addPage(); pg++;
    sf(BK); doc.rect(0, 0, PW, PH, 'F');
    pageHeader();
    return 18;
  }

  function checkY(y: number, need = 28): number {
    return y+need > PH-15 ? newPage() : y;
  }

  // ── Section heading ────────────────────────────────────────────────────
  function section(y: number, title: string): number {
    doc.setFont(FONT,'bold'); doc.setFontSize(7.5); st(G);
    doc.text(title.toUpperCase(), M, y);
    ss(G); doc.setLineWidth(0.25); doc.line(M, y+1.8, PW-M, y+1.8);
    return y+7;
  }

  // ── Small metric pill ──────────────────────────────────────────────────
  function pill(x: number, y: number, w: number, label: string, val: string, vc?: RGB) {
    sf(D1); doc.roundedRect(x, y, w, 13, 1.5, 1.5, 'F');
    ss(D3); doc.setLineWidth(0.15); doc.roundedRect(x, y, w, 13, 1.5, 1.5, 'S');
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    doc.text(label, x+w/2, y+5, { align:'center' });
    doc.setFont(FONT,'bold'); doc.setFontSize(9); st(vc||TW);
    doc.text(val, x+w/2, y+11, { align:'center' });
  }

  // ── Bar chart ─────────────────────────────────────────────────────────
  function barChart(x: number, y: number, w: number, h: number,
                    labels: string[], values: number[], color: RGB, isPct = false) {
    const n   = labels.length;
    if (n === 0) return;
    const bw  = (w - (n-1)*1.5) / n;
    const maxV = Math.max(...values.filter(isFinite), 1);
    const minV = Math.min(...values.filter(isFinite), 0);
    const span = maxV - Math.min(minV, 0) || 1;

    // Grid
    ss(D3); doc.setLineWidth(0.12);
    for (let i=0; i<=4; i++) {
      const gy = y + h*(1 - i/4);
      doc.line(x, gy, x+w, gy);
    }

    labels.forEach((lbl, i) => {
      const v  = isFinite(values[i]) ? values[i] : 0;
      const bh = Math.max(0.5, (Math.abs(v) / span) * h);
      const bx = x + i*(bw+1.5);
      const by = v >= 0 ? y+h-bh : y+h;

      sf(v < 0 ? RD : color);
      doc.roundedRect(bx, by, bw, bh, 0.8, 0.8, 'F');

      doc.setFont(FONT,'bold'); doc.setFontSize(5); st(v<0 ? RD : G);
      const lv = isPct ? fp(v) : fl(v);
      doc.text(lv, bx+bw/2, by-(v>=0?1.5:-1.5), { align:'center' });

      doc.setFont(FONT,'normal'); doc.setFontSize(5.5); st(TG);
      doc.text(lbl, bx+bw/2, y+h+4, { align:'center' });
    });
  }

  // ── Horizontal score bar ──────────────────────────────────────────────
  function scoreBar(x: number, y: number, w: number, label: string, pct: number) {
    const c: RGB = pct>=70 ? G : pct>=45 ? [190,140,0] : RD;
    doc.setFont(FONT,'normal'); doc.setFontSize(7); st(TW);
    doc.text(label, x, y+3.5);
    const bx = x+55, bw = w-65;
    sf(D3); doc.roundedRect(bx, y, bw, 4.5, 1, 1, 'F');
    const fw = Math.max(1.5, bw*pct/100);
    sf(c); doc.roundedRect(bx, y, fw, 4.5, 1, 1, 'F');
    doc.setFont(FONT,'bold'); doc.setFontSize(6.5); st(c);
    doc.text(`${pct.toFixed(0)}%`, bx+bw+3, y+3.5);
  }

  // ── autoTable helper ───────────────────────────────────────────────────
  function atable(opts: any): number {
    doc.autoTable({
      theme: 'plain',
      styles: { fontSize: 7.5, cellPadding:[1.8,3], textColor:TW, fillColor:D1 },
      headStyles: { fillColor:G, textColor:W, fontStyle:'bold', fontSize:7.5, cellPadding:[2,3] },
      alternateRowStyles: { fillColor:[12,12,12] },
      tableLineColor: D3, tableLineWidth: 0,
      margin: { left:M, right:M },
      ...opts,
    });
    return (doc.lastAutoTable?.finalY || opts.startY+20) + 6;
  }

  let y = 0; // shared Y cursor across pages

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('cover')) {
  sf(BK); doc.rect(0, 0, PW, PH, 'F');
  // Green left edge
  sf(G); doc.rect(0, 0, 2.5, PH, 'F');
  // Green top edge
  sf(G); doc.rect(0, 0, PW, 1.5, 'F');

  // App branding top-left
  appLogo(M+2, 14, 11);
  doc.setFont(FONT,'black'); doc.setFontSize(14); st(G);
  doc.text('Prismo', M+16, 21.5);
  doc.setFont(FONT,'normal'); doc.setFontSize(7.5); st(TG);
  doc.text('Investment Intelligence Platform', M+16, 27);

  // Thin divider
  ss(D3); doc.setLineWidth(0.3); doc.line(M+2, 32, PW-M, 32);

  // User uploaded logo (top-right, replaces company logo)
  if (d.branding?.logoBase64) {
    try {
      sf(W); doc.circle(PW-M-15, 22, 14, 'F');
      doc.addImage(d.branding.logoBase64, PW-M-26, 11, 22, 22, '', 'FAST');
    } catch { /* skip */ }
  } else if (profile?.image) {
    // Company logo (right side)
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
        // White bg circle for logo
        sf(W); doc.circle(PW-M-15, 22, 14, 'F');
        doc.addImage(url, 'JPEG', PW-M-26, 11, 22, 22, '', 'FAST');
      }
    } catch { /* skip */ }
  }

  // Company name
  doc.setFont(FONT,'black'); doc.setFontSize(24); st(W);
  const nameLn: string[] = doc.splitTextToSize(co, 140);
  doc.text(nameLn, M+2, 47);
  const afterName = 47 + nameLn.length*11;

  // Ticker + exchange
  sf(G); doc.roundedRect(M+2, afterName, 30, 10, 2, 2, 'F');
  sf([28,28,28]); doc.roundedRect(M+35, afterName, 26, 10, 2, 2, 'F');
  doc.setFont(FONT,'bold'); doc.setFontSize(10); st(W);
  doc.text(ticker, M+17, afterName+7, { align:'center' });
  doc.setFontSize(8); st(TG);
  doc.text(exch, M+48, afterName+7, { align:'center' });

  // Sector / industry
  doc.setFont(FONT,'normal'); doc.setFontSize(7.5); st(TG);
  doc.text(`${sect}  ·  ${ind}`, M+2, afterName+17);

  // ── 4 KPI cards ──────────────────────────────────────────────────────
  const kY  = afterName+23;
  const kW  = (CW-9)/4;
  [
    { l:'Current Price',  v:`$${f(price)}`,                           c:TW },
    { l:'Market Cap',     v:fl(quote?.marketCap),                     c:TW },
    { l:'P/E Ratio',      v:f(quote?.pe),                             c:TW },
    { l:'Avg Valuation',  v:sharedAverageVal?`$${f(sharedAverageVal)}`:'-', c:G },
  ].forEach((k, i) => {
    const bx = M + i*(kW+3);
    sf(D1); doc.roundedRect(bx, kY, kW, 20, 2, 2, 'F');
    ss(i===3 ? G : D3); doc.setLineWidth(i===3 ? 0.4 : 0.15);
    doc.roundedRect(bx, kY, kW, 20, 2, 2, 'S');
    doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
    doc.text(k.l, bx+kW/2, kY+6, { align:'center' });
    doc.setFont(FONT,'black'); doc.setFontSize(11); st(k.c as RGB);
    doc.text(k.v, bx+kW/2, kY+14.5, { align:'center' });
  });

  // ── Upside/downside ───────────────────────────────────────────────────
  if (sharedAverageVal && price) {
    const up   = (sharedAverageVal - price) / price * 100;
    const isUp = up >= 0;
    const uy   = kY + 26;
    sf(isUp ? [0,45,22] as RGB : [60,5,5] as RGB);
    doc.roundedRect(M+2, uy, 58, 14, 2, 2, 'F');
    doc.setFont(FONT,'bold'); doc.setFontSize(6.5); st(TG);
    doc.text(isUp ? 'POTENTIAL UPSIDE' : 'POTENTIAL DOWNSIDE', M+31, uy+4.5, { align:'center' });
    doc.setFont(FONT,'black'); doc.setFontSize(13);
    st(isUp ? [90,255,150] as RGB : [255,110,110] as RGB);
    doc.text(`${isUp?'+':''}${up.toFixed(1)}%`, M+31, uy+12, { align:'center' });
    doc.setFont(FONT,'normal'); doc.setFontSize(6.5); st(TG);
    doc.text(`vs avg model valuation $${f(sharedAverageVal)}`, M+64, uy+9);
  }

  // ── Revenue preview chart on cover ───────────────────────────────────
  const covInc = (income||[]).slice(0,5).reverse();
  if (covInc.length >= 2) {
    const cchY = kY + 48;
    doc.setFont(FONT,'bold'); doc.setFontSize(6.5); st(TG);
    doc.text('REVENUE TREND', M+2, cchY-2);
    barChart(M+2, cchY, CW-4, 36,
      covInc.map((i:any) => i.date?.substring(0,4)||''),
      covInc.map((i:any) => i.revenue||0), G);
  }

  // ── Description ──────────────────────────────────────────────────────
  if (profile?.description) {
    const dY = kY + 93;
    const desc = profile.description.substring(0, 350)+(profile.description.length>350?'...':'');
    doc.setFont(FONT,'normal'); doc.setFontSize(7); st(TG);
    const dl:string[] = doc.splitTextToSize(desc, CW-4);
    doc.text(dl.slice(0,5), M+2, dY);
  }

  // Cover footer
  ss(G); doc.setLineWidth(0.5); doc.line(M, PH-20, PW-M, PH-20);
  doc.setFont(FONT,'normal'); doc.setFontSize(6); st(TG);
  doc.text('For informational purposes only · Not financial advice · Generated by Prismo', PW/2, PH-14, { align:'center' });
  doc.setFontSize(7); st(TG);
  doc.text(date, PW/2, PH-8.5, { align:'center' });
  } // end cover

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 2 — FINANCIAL HIGHLIGHTS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('market_summary')) {
  y = newPage();

  // Market summary pills
  y = section(y, 'Market Summary');
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
      y = section(y, 'Income Statement — Annual Detail');
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
      y = section(y, 'Balance Sheet — Annual Detail');
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
      y = section(y, 'Cash Flow Statement — Annual Detail');
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
  y = section(y, 'Valuation Model Comparison vs Current Price');
  const avnVals = sharedAdvanceValueNet?.valuations;
  const models: {name:string; val:number}[] = [];
  if (avnVals) {
    Object.entries(avnVals).forEach(([k,v]) => {
      if (typeof v==='number' && isFinite(v) && v>0) {
        models.push({ name:k.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase()).substring(0,18), val:+v });
      }
    });
  }
  // Fallback: use raw DCF data if no backend valuations available
  if (models.length === 0 && dcfCustom) {
    if (dcfCustom.dcf && isFinite(dcfCustom.dcf) && dcfCustom.dcf > 0)
      models.push({ name: 'DCF Intrinsic', val: +dcfCustom.dcf });
    if (dcfCustom.stockPrice && isFinite(dcfCustom.stockPrice))
      models.push({ name: 'Stock Price', val: +dcfCustom.stockPrice });
  }
  if (sharedAverageVal) models.push({ name:'Average', val:sharedAverageVal });

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
      y = section(y, 'DuPont Analysis — 3-Factor Decomposition');

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
  if (activeSections.has('quality_score') && sharedCompanyQualityNet?.scores) {
    y = newPage();
    y = section(y, 'Company Quality Score');
    const sc = sharedCompanyQualityNet.scores;
    Object.entries(sc).forEach(([dim, score]:any) => {
      const pct = typeof score==='number' ? +(score*100).toFixed(0) : 0;
      const lbl = dim.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase());
      y = checkY(y, 9);
      scoreBar(M, y, CW, lbl, pct);
      y += 8;
    });
    const total = sharedCompanyQualityNet.totalScore;
    if (total != null) {
      ss(D3); doc.setLineWidth(0.2); doc.line(M, y+1, PW-M, y+1);
      doc.setFont(FONT,'bold'); doc.setFontSize(9); st(G);
      doc.text(`Overall: ${(total*100).toFixed(0)}/100  ·  ${sharedCompanyQualityNet.rating||''}`, M, y+8);
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
    if (sharedCagrStats?.avgCagr != null) capRows.push(['Historical Revenue CAGR (Avg)', fp(sharedCagrStats.avgCagr)]);
    if (sharedCagrStats?.minCagr != null) capRows.push(['CAGR Range (Min – Max)', `${fp(sharedCagrStats.minCagr)} – ${fp(sharedCagrStats.maxCagr)}`]);
    if (capRows.length > 0) {
      y = checkY(y, 35);
      y = section(y, 'Cost of Capital — WACC & CAGR');
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
      y = section(y, 'Sustainable Growth Rate (SGR)');

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
      y = section(y, 'Key Metrics — Extended Analysis');
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
      y = section(y, 'Analyst Consensus Estimates');
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
      y = section(y, 'Analyst Price Target');

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
      y = section(y, 'Trailing Twelve Months (TTM)');
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
      y = section(y, '52-Week Price Position');
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
    y = section(y, 'Pivot Points & Fibonacci Levels');
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
  // FINAL PAGE — DISCLAIMER
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('disclaimer')) {
  y = newPage();

  // Centered branding
  appLogo(PW/2 - 6, y, 12);
  doc.setFont(FONT,'black'); doc.setFontSize(18); st(G);
  doc.text('Prismo', PW/2, y+22, { align:'center' });
  doc.setFont(FONT,'normal'); doc.setFontSize(8.5); st(TG);
  doc.text('Investment Intelligence Platform', PW/2, y+29, { align:'center' });

  y += 38;
  ss(G); doc.setLineWidth(0.3); doc.line(M+20, y, PW-M-20, y);
  y += 8;

  doc.setFont(FONT,'bold'); doc.setFontSize(10); st(TW);
  doc.text('Disclaimer & Important Disclosures', PW/2, y, { align:'center' });
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

  pageFooter();
  } // end disclaimer

  // ── Save or preview ───────────────────────────────────────────────────
  if (d.preview) {
    const blob: Blob = doc.output('blob');
    return URL.createObjectURL(blob);
  }
  doc.save(`${ticker}_Prismo_${today.toISOString().split('T')[0]}.pdf`);
}
