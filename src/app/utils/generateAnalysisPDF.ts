// src/app/utils/generateAnalysisPDF.ts
// Professional Financial Analysis PDF — Black + Deutsche Bank Green #00A651

export interface PDFBranding {
  bgColor?:     [number, number, number];  // default [0,0,0]
  accentColor?: [number, number, number];  // default [0,166,81]
  fontFamily?:  string;                    // default 'helvetica'
  logoBase64?:  string;                    // optional base64 data URL
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
  // Optional config
  sections?: string[];   // which pages to include; default: all
  branding?: PDFBranding;
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

export async function generateAnalysisPDF(d: PDFData): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const atMod = await import('jspdf-autotable');
  if (typeof (atMod as any).applyPlugin === 'function') {
    (atMod as any).applyPlugin(jsPDF);
  }
  const doc: any = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Sections & branding (from config or defaults) ─────────────────────
  const activeSections = new Set(
    d.sections ?? ['cover', 'financial', 'valuation', 'forecasts', 'technical', 'disclaimer']
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
          sharedCompanyQualityNet, sharedCagrStats, sharedPivotAnalysis } = d;

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
  if (activeSections.has('financial')) {
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
  } // end financial

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 3 — VALUATION
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('valuation')) {
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
  y = checkY(y, 45);
  y = section(y, 'Key Financial Ratios');
  const km = sharedKeyMetricsSummary || {};
  y = atable({
    startY: y,
    head: [['Metric','Value','Metric','Value']],
    body: [
      ['P/E Ratio',         f(quote?.pe),               'P/B Ratio',          f(km.priceToBook)],
      ['EV/EBITDA',         f(km.evToEbitda),            'P/FCF',              f(km.priceToFCF)],
      ['ROE',               fp((km.roe||0)*100),         'ROA',                fp((km.roa||0)*100)],
      ['Debt / Equity',     f(km.debtToEquity),          'Current Ratio',      f(km.currentRatio)],
      ['Gross Margin',      fp((income?.[0]?.grossProfitRatio||0)*100), 'Net Margin', fp((income?.[0]?.netIncomeRatio||0)*100)],
      ['Interest Coverage', f(km.interestCoverage),      'Quick Ratio',        f(km.quickRatio)],
    ],
    columnStyles:{
      0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:46},
      1:{cellWidth:42},
      2:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:46},
      3:{cellWidth:46},
    },
  });

  // Quality score bars
  if (sharedCompanyQualityNet?.scores) {
    y = checkY(y, 65);
    y = section(y, 'Company Quality Score — CompanyQualityNet AI');
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

  // Cost of Capital
  y = checkY(y, 35);
  y = section(y, 'Cost of Capital');
  const capRows:any[] = [];
  if (sharedWACC)     capRows.push(['WACC (Weighted Avg Cost of Capital)',      fp(sharedWACC)]);
  if (sharedAvgCAPM)  capRows.push(['Cost of Equity — CAPM Average',            fp(sharedAvgCAPM)]);
  if (sharedCagrStats?.avgCagr != null) capRows.push(['Historical Revenue CAGR (Avg)', fp(sharedCagrStats.avgCagr)]);
  if (sharedCagrStats?.minCagr != null) capRows.push(['CAGR Range (Min – Max)', `${fp(sharedCagrStats.minCagr)} – ${fp(sharedCagrStats.maxCagr)}`]);
  if (capRows.length>0) {
    y = atable({ startY:y, head:[['Metric','Value']], body:capRows,
      columnStyles:{0:{fontStyle:'bold',fillColor:[14,14,14],cellWidth:120},1:{cellWidth:60}} });
  }
  } // end valuation

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 4 — ANALYST FORECASTS
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('forecasts') && sharedForecasts?.length) {
    y = newPage();
    y = section(y, 'Analyst Consensus Estimates');
    y = atable({
      startY: y,
      head: [['Year','Revenue Est.','EPS Est.','Net Income','EBITDA Est.']],
      body: sharedForecasts.slice(0,6).map((fc:any) => [
        fc.date?.substring(0,4)||'-',
        fl(fc.estimatedRevenueAvg),
        `$${f(fc.estimatedEpsAvg)}`,
        fl(fc.estimatedNetIncomeAvg),
        fl(fc.estimatedEbitdaAvg),
      ]),
    });

    // Revenue forecast bar chart
    if (sharedForecasts.length >= 2) {
      y = checkY(y, 58);
      y = section(y, 'Revenue Forecast Chart (Analyst Consensus)');
      const fcD = sharedForecasts.slice(0,6);
      barChart(M, y, CW, 42,
        fcD.map((fc:any)=>fc.date?.substring(0,4)||''),
        fcD.map((fc:any)=>fc.estimatedRevenueAvg||0), G);
      y += 50;
    }

    // Price target visual
    const tgt  = priceTarget?.priceTarget || priceTarget?.priceTargetAvg;
    const tgtH = priceTarget?.priceTargetHigh;
    const tgtL = priceTarget?.priceTargetLow;

    if (tgt && tgtL && tgtH && price) {
      y = checkY(y, 45);
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

    // TTM snapshot
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
  // PAGE 5 — TECHNICAL
  // ════════════════════════════════════════════════════════════════════════
  if (activeSections.has('technical') && sharedPivotAnalysis) {
    y = newPage();
    const pa = sharedPivotAnalysis;

    // 52-week price position visual
    if (pa.low52Week && pa.high52Week && price) {
      y = section(y, '52-Week Price Position');
      const lo = +pa.low52Week*0.96, hi = +pa.high52Week*1.04;
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
      doc.text(`$${f(pa.low52Week,0)}  52W Low`, M+10, tY+13);
      doc.text(`52W High  $${f(pa.high52Week,0)}`, PW-M-10, tY+13, { align:'right' });

      // % from high
      doc.setFont(FONT,'bold'); doc.setFontSize(8);
      const fromHigh = ((price/pa.high52Week)-1)*100;
      st(fromHigh < -20 ? RD : fromHigh < -5 ? [200,150,0] as RGB : G);
      doc.text(`${fromHigh.toFixed(1)}% from 52W High`, PW/2, tY+21, { align:'center' });

      y = tY + 27;
    }

    y = section(y, 'Pivot Points & Fibonacci Levels');
    y = atable({
      startY: y,
      head:[['Level','Price','Level','Price']],
      body:[
        ['Pivot Point',    `$${f(pa.pivotPoint)}`,          'Current Price',   `$${f(pa.currentPrice)}`],
        ['Resistance R1',  `$${f(pa.resistance?.R1)}`,      'Resistance R2',   `$${f(pa.resistance?.R2)}`],
        ['Support S1',     `$${f(pa.support?.S1)}`,         'Support S2',      `$${f(pa.support?.S2)}`],
        ['Fibonacci 23.6%',`$${f(pa.fibonacci?.level236)}`, 'Fibonacci 38.2%', `$${f(pa.fibonacci?.level382)}`],
        ['Fibonacci 50.0%',`$${f(pa.fibonacci?.level500)}`, 'Fibonacci 61.8%', `$${f(pa.fibonacci?.level618)}`],
        ['Fibonacci 78.6%',`$${f(pa.fibonacci?.level786)}`, '% from 52W Low',  fp(pa.priceVsLow)],
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

  doc.setFont(FONT,'normal'); doc.setFontSize(7.5); st(TW);
  disc.forEach(line => {
    st(line==='' ? TG : TW);
    if (line !== '') doc.text(line, PW/2, y, { align:'center' });
    y += line==='' ? 4 : 5.5;
  });

  y += 6;
  ss(D3); doc.setLineWidth(0.2); doc.line(M+30, y, PW-M-30, y);
  y += 6;
  doc.setFontSize(7); st(TG);
  doc.text(`${co}  (${ticker})  ·  ${date}`, PW/2, y, { align:'center' });

  pageFooter();
  } // end disclaimer

  // ── Save ──────────────────────────────────────────────────────────────
  doc.save(`${ticker}_Prismo_${today.toISOString().split('T')[0]}.pdf`);
}
