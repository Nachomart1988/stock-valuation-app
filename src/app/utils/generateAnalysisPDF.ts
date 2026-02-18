// src/app/utils/generateAnalysisPDF.ts
// Professional financial analysis PDF generator using jsPDF + jsPDF-AutoTable

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
}

function fmt(val: any, decimals = 2): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '-';
  return Number(val).toFixed(decimals);
}
function fmtPct(val: any, decimals = 2): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '-';
  return Number(val).toFixed(decimals) + '%';
}
function fmtLarge(val: any): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '-';
  const n = Number(val);
  if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (Math.abs(n) >= 1e9)  return '$' + (n / 1e9).toFixed(2)  + 'B';
  if (Math.abs(n) >= 1e6)  return '$' + (n / 1e6).toFixed(2)  + 'M';
  return '$' + n.toFixed(2);
}

export async function generateAnalysisPDF(data: PDFData): Promise<void> {
  // Dynamic imports — must await both before using
  const { default: jsPDF } = await import('jspdf');
  const autoTableModule = await import('jspdf-autotable');
  // jspdf-autotable v5 exports a default function OR patches prototype
  const autoTable: any = autoTableModule.default || autoTableModule;

  const doc: any = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Helper to call autoTable regardless of API style
  const table = (opts: any) => {
    if (typeof doc.autoTable === 'function') {
      doc.autoTable(opts);
    } else if (typeof autoTable === 'function') {
      autoTable(doc, opts);
    }
  };

  const PW = 210;
  const PH = 297;
  const M  = 15;
  const CW = PW - 2 * M;

  const today   = new Date();
  const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const { ticker, profile, quote, income, balance, cashFlow, incomeTTM,
          priceTarget, sharedAverageVal, sharedWACC, sharedAvgCAPM,
          sharedForecasts, sharedKeyMetricsSummary, sharedAdvanceValueNet,
          sharedCompanyQualityNet, sharedCagrStats, sharedPivotAnalysis } = data;

  const companyName = profile?.companyName || ticker;
  const sector      = profile?.sector   || '-';
  const industry    = profile?.industry || '-';
  const exchange    = profile?.exchangeShortName || profile?.exchange || '-';

  // ── Color helpers ────────────────────────────────────────────────────────
  const G  = { r: 0,   g: 166, b: 81  }; // Deutsche Bank Green #00A651
  const DG = { r: 0,   g: 100, b: 48  };
  const W  = { r: 255, g: 255, b: 255 };
  const BK = { r: 0,   g: 0,   b: 0   };
  const LG = { r: 240, g: 242, b: 244 };
  const TX = { r: 20,  g: 20,  b: 20  };

  const setFill   = (c: {r:number,g:number,b:number}) => doc.setFillColor(c.r, c.g, c.b);
  const setStroke = (c: {r:number,g:number,b:number}) => doc.setDrawColor(c.r, c.g, c.b);
  const setTxt    = (c: {r:number,g:number,b:number}) => doc.setTextColor(c.r, c.g, c.b);

  // ── Helpers ───────────────────────────────────────────────────────────────
  let currentPage = 1;

  function addFooter(y_ignore?: number) {
    doc.setFontSize(7);
    setTxt({ r: 120, g: 120, b: 120 });
    doc.setFont('helvetica', 'normal');
    doc.text(`${companyName} (${ticker})  |  Investment Analysis  |  ${dateStr}`, M, PH - 8);
    doc.text(`${currentPage}`, PW - M, PH - 8, { align: 'right' });
    setStroke(G);
    doc.setLineWidth(0.4);
    doc.line(M, PH - 13, PW - M, PH - 13);
    setTxt(TX);
  }

  function addHeader() {
    setFill(BK);
    doc.rect(0, 0, PW, 11, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setTxt(G);
    doc.text('INVESTMENT ANALYSIS REPORT', M, 7.5);
    setTxt({ r: 160, g: 160, b: 160 });
    doc.text(`${ticker}  |  ${companyName}`, PW - M, 7.5, { align: 'right' });
    setTxt(TX);
  }

  function newPage() {
    addFooter();
    doc.addPage();
    currentPage++;
    addHeader();
    return 20;
  }

  function checkY(y: number, needed = 30): number {
    return y + needed > PH - 20 ? newPage() : y;
  }

  function sectionHeader(y: number, title: string): number {
    setFill(G);
    doc.rect(M, y, CW, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    setTxt(W);
    doc.text(title, M + 4, y + 5.2);
    setTxt(TX);
    return y + 11;
  }

  function twoColRow(y: number, rows: [string, string, string, string][]): number {
    table({
      startY: y,
      head: [],
      body: rows,
      theme: 'plain',
      styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [20, 20, 20] },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [240, 242, 244], cellWidth: 47 },
        1: { cellWidth: 43 },
        2: { fontStyle: 'bold', fillColor: [240, 242, 244], cellWidth: 47 },
        3: { cellWidth: 43 },
      },
      margin: { left: M, right: M },
    });
    return doc.lastAutoTable?.finalY + 8 || y + 30;
  }

  function striped(y: number, head: string[], rows: any[][], colWidths?: number[]): number {
    const colStyles: any = {};
    if (colWidths) colWidths.forEach((w, i) => { colStyles[i] = { cellWidth: w }; });
    colStyles[0] = { ...colStyles[0], fontStyle: 'bold' };
    table({
      startY: y,
      head: [head],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [G.r, G.g, G.b], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: colStyles,
      margin: { left: M, right: M },
    });
    return doc.lastAutoTable?.finalY + 8 || y + 30;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 1: COVER
  // ════════════════════════════════════════════════════════════════════════
  setFill(BK);
  doc.rect(0, 0, PW, PH, 'F');

  // Green top bar
  setFill(G);
  doc.rect(0, 0, PW, 2.5, 'F');

  // Green left accent
  setFill(G);
  doc.rect(0, 0, 3, PH, 'F');

  // Try to load company logo
  if (profile?.image) {
    try {
      const res = await fetch(profile.image);
      if (res.ok) {
        const blob = await res.blob();
        const logoUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        doc.addImage(logoUrl, 'JPEG', PW - M - 42, 18, 38, 38, '', 'FAST');
      }
    } catch { /* logo optional */ }
  }

  // Company name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  setTxt(W);
  const nameLines: string[] = doc.splitTextToSize(companyName, 125);
  doc.text(nameLines, 18, 46);

  // Badges
  const badgeY = 46 + nameLines.length * 12;
  setFill(G);
  doc.roundedRect(18, badgeY, 34, 11, 1.5, 1.5, 'F');
  doc.setFontSize(10);
  setTxt(W);
  doc.text(ticker, 35, badgeY + 7.5, { align: 'center' });

  setFill({ r: 40, g: 40, b: 40 });
  doc.roundedRect(56, badgeY, 34, 11, 1.5, 1.5, 'F');
  setTxt({ r: 180, g: 180, b: 180 });
  doc.text(exchange, 73, badgeY + 7.5, { align: 'center' });

  // Report title
  doc.setFontSize(15);
  doc.setFont('helvetica', 'normal');
  setTxt(G);
  doc.text('INVESTMENT ANALYSIS REPORT', 18, badgeY + 24);
  setStroke(G);
  doc.setLineWidth(0.5);
  doc.line(18, badgeY + 27, PW - 18, badgeY + 27);

  // Summary boxes
  const boxY = badgeY + 34;
  const bw   = (CW - 12) / 4;
  const boxes = [
    { label: 'Current Price',   val: `$${fmt(quote?.price)}` },
    { label: 'Market Cap',      val: fmtLarge(quote?.marketCap) },
    { label: 'P/E Ratio',       val: fmt(quote?.pe) },
    { label: 'Avg Valuation',   val: sharedAverageVal ? `$${fmt(sharedAverageVal)}` : '-' },
  ];
  boxes.forEach((b, i) => {
    const bx = 18 + i * (bw + 4);
    setFill({ r: 15, g: 15, b: 15 });
    doc.roundedRect(bx, boxY, bw, 20, 1.5, 1.5, 'F');
    setStroke(G);
    doc.setLineWidth(0.25);
    doc.roundedRect(bx, boxY, bw, 20, 1.5, 1.5, 'S');
    doc.setFontSize(6.5);
    setTxt({ r: 120, g: 120, b: 120 });
    doc.setFont('helvetica', 'normal');
    doc.text(b.label, bx + bw / 2, boxY + 7, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    setTxt(G);
    doc.text(b.val, bx + bw / 2, boxY + 15.5, { align: 'center' });
  });

  // Sector / date
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTxt({ r: 160, g: 160, b: 160 });
  doc.text(`Sector: ${sector}   |   Industry: ${industry}   |   ${dateStr}`, 18, boxY + 28);

  // Description
  if (profile?.description) {
    const desc = profile.description.substring(0, 360) + (profile.description.length > 360 ? '...' : '');
    doc.setFontSize(7.5);
    setTxt({ r: 140, g: 140, b: 140 });
    const dl: string[] = doc.splitTextToSize(desc, CW - 8);
    doc.text(dl.slice(0, 7), 18, boxY + 37);
  }

  // Upside/downside badge
  if (sharedAverageVal && quote?.price) {
    const up = ((sharedAverageVal - quote.price) / quote.price) * 100;
    const isUp = up >= 0;
    const uy = PH - 68;
    setFill(isUp ? { r: 0, g: 80, b: 35 } : { r: 100, g: 0, b: 0 });
    doc.roundedRect(18, uy, 78, 28, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setTxt(W);
    doc.text(isUp ? 'POTENTIAL UPSIDE' : 'POTENTIAL DOWNSIDE', 57, uy + 9, { align: 'center' });
    doc.setFontSize(18);
    setTxt(isUp ? { r: 100, g: 255, b: 150 } : { r: 255, g: 120, b: 120 });
    doc.text(`${isUp ? '+' : ''}${up.toFixed(1)}%`, 57, uy + 21, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setTxt({ r: 160, g: 160, b: 160 });
    doc.text(`vs. avg. model valuation of $${fmt(sharedAverageVal)}`, 18, uy + 32);
  }

  // Cover footer
  setStroke(G);
  doc.setLineWidth(0.5);
  doc.line(18, PH - 18, PW - 18, PH - 18);
  doc.setFontSize(6.5);
  setTxt({ r: 80, g: 80, b: 80 });
  doc.text('For informational purposes only. Not financial advice.', PW / 2, PH - 11, { align: 'center' });

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 2: FINANCIAL HIGHLIGHTS
  // ════════════════════════════════════════════════════════════════════════
  let y = newPage();

  // Price & Market Data
  y = sectionHeader(y, 'PRICE & MARKET DATA');
  y = twoColRow(y, [
    ['Current Price',   `$${fmt(quote?.price)}`,        'Day Change',    fmtPct(quote?.changesPercentage)],
    ['52-Week High',    `$${fmt(quote?.yearHigh)}`,      '52-Week Low',   `$${fmt(quote?.yearLow)}`],
    ['MA 50-Day',       `$${fmt(quote?.priceAvg50)}`,    'MA 200-Day',    `$${fmt(quote?.priceAvg200)}`],
    ['Market Cap',      fmtLarge(quote?.marketCap),      'Volume',        (quote?.volume ? Number(quote.volume).toLocaleString() : '-')],
    ['P/E Ratio',       fmt(quote?.pe),                  'EPS (TTM)',     `$${fmt(quote?.eps)}`],
    ['Dividend Yield',  fmtPct(quote?.dividendYield ? quote.dividendYield * 100 : 0), 'Beta', fmt(quote?.beta)],
  ]);

  // Income Statement
  y = checkY(y, 55);
  y = sectionHeader(y, 'INCOME STATEMENT — LAST 3 YEARS');
  const inc = (income || []).slice(0, 3);
  if (inc.length > 0) {
    const hd = ['Metric', ...inc.map((i: any) => i.date?.substring(0, 4) || 'N/A')];
    y = striped(y, hd, [
      ['Revenue',        ...inc.map((i: any) => fmtLarge(i.revenue))],
      ['Gross Profit',   ...inc.map((i: any) => fmtLarge(i.grossProfit))],
      ['Gross Margin',   ...inc.map((i: any) => fmtPct((i.grossProfitRatio || 0) * 100))],
      ['Operating Income',...inc.map((i: any) => fmtLarge(i.operatingIncome))],
      ['Net Income',     ...inc.map((i: any) => fmtLarge(i.netIncome))],
      ['Net Margin',     ...inc.map((i: any) => fmtPct((i.netIncomeRatio || 0) * 100))],
      ['EBITDA',         ...inc.map((i: any) => fmtLarge(i.ebitda))],
      ['EPS Diluted',    ...inc.map((i: any) => `$${fmt(i.epsdiluted || i.eps)}`)],
    ], [55, 42, 42, 42]);
  }

  // Balance Sheet
  y = checkY(y, 45);
  y = sectionHeader(y, 'BALANCE SHEET — LATEST YEAR');
  const bal = (balance || [])[0] || {};
  y = twoColRow(y, [
    ['Total Assets',        fmtLarge(bal.totalAssets),                                        'Total Liabilities',    fmtLarge(bal.totalLiabilities)],
    ['Total Equity',        fmtLarge(bal.totalStockholdersEquity || bal.totalEquity),          'Total Debt',           fmtLarge(bal.totalDebt)],
    ['Cash & Equivalents',  fmtLarge(bal.cashAndCashEquivalents),                             'Net Debt',             fmtLarge(bal.netDebt)],
    ['Current Assets',      fmtLarge(bal.totalCurrentAssets),                                 'Current Liabilities',  fmtLarge(bal.totalCurrentLiabilities)],
    ['Goodwill + Intang.',  fmtLarge((bal.goodwill || 0) + (bal.intangibleAssets || 0)),       'PP&E',                 fmtLarge(bal.propertyPlantEquipmentNet)],
  ]);

  // Cash Flow
  y = checkY(y, 40);
  y = sectionHeader(y, 'CASH FLOW — LAST 3 YEARS');
  const cf = (cashFlow || []).slice(0, 3);
  if (cf.length > 0) {
    const hd2 = ['Metric', ...cf.map((c: any) => c.date?.substring(0, 4) || 'N/A')];
    y = striped(y, hd2, [
      ['Operating Cash Flow', ...cf.map((c: any) => fmtLarge(c.operatingCashFlow || c.netCashProvidedByOperatingActivities))],
      ['Free Cash Flow',      ...cf.map((c: any) => fmtLarge(c.freeCashFlow))],
      ['Capital Expenditure', ...cf.map((c: any) => fmtLarge(c.capitalExpenditure))],
      ['Dividends Paid',      ...cf.map((c: any) => fmtLarge(c.dividendsPaid))],
    ], [55, 42, 42, 42]);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 3: VALUATION & KEY METRICS
  // ════════════════════════════════════════════════════════════════════════
  y = newPage();

  // Valuation Summary
  y = sectionHeader(y, 'VALUATION SUMMARY');
  const valRows: [string, string, string, string][] = [];
  if (sharedAverageVal && quote?.price) {
    const upside = ((sharedAverageVal - quote.price) / quote.price * 100).toFixed(1);
    valRows.push(['Avg Model Valuation', `$${fmt(sharedAverageVal)}`, 'vs. Current Price', `${Number(upside) >= 0 ? '+' : ''}${upside}%`]);
  }
  if (sharedWACC) valRows.push(['WACC', fmtPct(sharedWACC), 'Cost of Equity (CAPM)', fmtPct(sharedAvgCAPM)]);
  if (sharedCagrStats) valRows.push(['Avg CAGR', fmtPct(sharedCagrStats.avgCagr), 'CAGR Range', `${fmtPct(sharedCagrStats.minCagr)} - ${fmtPct(sharedCagrStats.maxCagr)}`]);
  if (priceTarget?.priceTarget || priceTarget?.priceTargetAvg) {
    valRows.push(['Analyst Target (Avg)', `$${fmt(priceTarget.priceTarget || priceTarget.priceTargetAvg)}`,
                  'Target Range', `$${fmt(priceTarget.priceTargetLow)} - $${fmt(priceTarget.priceTargetHigh)}`]);
  }
  if (valRows.length > 0) y = twoColRow(y, valRows);

  // AdvanceValueNet breakdown
  if (sharedAdvanceValueNet?.valuations) {
    y = checkY(y, 50);
    y = sectionHeader(y, 'MULTI-MODEL VALUATION (AdvanceValueNet)');
    const avnRows = Object.entries(sharedAdvanceValueNet.valuations)
      .filter(([, v]) => typeof v === 'number')
      .map(([model, val]: any) => [
        model.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        `$${fmt(val)}`,
        quote?.price ? `${((val / quote.price - 1) * 100).toFixed(1)}%` : '-',
      ]);
    if (avnRows.length > 0) {
      y = striped(y, ['Valuation Model', 'Intrinsic Value', 'vs. Market Price'], avnRows, [85, 45, 45]);
    }
  }

  // Company Quality Net
  if (sharedCompanyQualityNet?.scores) {
    y = checkY(y, 50);
    y = sectionHeader(y, 'COMPANY QUALITY SCORE (CompanyQualityNet)');
    const scoreRows = Object.entries(sharedCompanyQualityNet.scores).map(([dim, score]: any) => {
      const pct = typeof score === 'number' ? Math.round(score * 100) : 0;
      const bars = pct >= 70 ? '●●●●●' : pct >= 50 ? '●●●●○' : pct >= 30 ? '●●●○○' : '●●○○○';
      return [
        dim.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        `${pct}/100`,
        bars,
      ];
    });
    const total = sharedCompanyQualityNet.totalScore;
    if (total !== undefined) scoreRows.push(['TOTAL SCORE', `${Math.round(total * 100)}/100`, sharedCompanyQualityNet.rating || '']);
    y = striped(y, ['Dimension', 'Score', 'Visual'], scoreRows, [75, 35, 65]);
  }

  // Key Ratios
  y = checkY(y, 45);
  y = sectionHeader(y, 'KEY FINANCIAL RATIOS');
  const km = sharedKeyMetricsSummary || {};
  y = twoColRow(y, [
    ['Return on Equity (ROE)', fmtPct((km.roe || 0) * 100),          'Return on Assets (ROA)', fmtPct((km.roa || 0) * 100)],
    ['Debt / Equity',          fmt(km.debtToEquity),                   'Current Ratio',          fmt(km.currentRatio)],
    ['Gross Margin',           fmtPct((income?.[0]?.grossProfitRatio || 0) * 100), 'Net Margin', fmtPct((income?.[0]?.netIncomeRatio || 0) * 100)],
    ['P/E Ratio',              fmt(quote?.pe),                         'P/B Ratio',              fmt(km.priceToBook)],
    ['EV/EBITDA',              fmt(km.evToEbitda),                     'Interest Coverage',      fmt(km.interestCoverage)],
  ]);

  // Pivot Analysis
  if (sharedPivotAnalysis) {
    y = checkY(y, 50);
    y = sectionHeader(y, 'TECHNICAL — PIVOT POINTS & FIBONACCI');
    const pa = sharedPivotAnalysis;
    y = twoColRow(y, [
      ['Pivot Point',    `$${fmt(pa.pivotPoint)}`,              'Current Price',     `$${fmt(pa.currentPrice)}`],
      ['Resistance R1',  `$${fmt(pa.resistance?.R1)}`,          'Resistance R2',     `$${fmt(pa.resistance?.R2)}`],
      ['Support S1',     `$${fmt(pa.support?.S1)}`,             'Support S2',        `$${fmt(pa.support?.S2)}`],
      ['52-Week High',   `$${fmt(pa.high52Week)}`,              '52-Week Low',       `$${fmt(pa.low52Week)}`],
      ['Fib 38.2%',      `$${fmt(pa.fibonacci?.level382)}`,     'Fib 61.8%',         `$${fmt(pa.fibonacci?.level618)}`],
      ['% from 52W High',fmtPct(pa.priceVsHigh),                '% from 52W Low',   fmtPct(pa.priceVsLow)],
    ]);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 4: ANALYST FORECASTS (only if data exists)
  // ════════════════════════════════════════════════════════════════════════
  if (sharedForecasts && sharedForecasts.length > 0) {
    y = newPage();
    y = sectionHeader(y, 'ANALYST CONSENSUS ESTIMATES');
    y = striped(y,
      ['Year', 'Revenue (Est.)', 'EPS (Est.)', 'Net Income (Est.)', 'EBITDA (Est.)'],
      sharedForecasts.slice(0, 5).map((f: any) => [
        f.date?.substring(0, 4) || '-',
        fmtLarge(f.estimatedRevenueAvg),
        `$${fmt(f.estimatedEpsAvg)}`,
        fmtLarge(f.estimatedNetIncomeAvg),
        fmtLarge(f.estimatedEbitdaAvg),
      ]),
      [20, 45, 35, 45, 45]
    );

    // Price target
    if (priceTarget?.priceTarget || priceTarget?.priceTargetAvg) {
      y = checkY(y, 35);
      y = sectionHeader(y, 'ANALYST PRICE TARGET');
      y = twoColRow(y, [
        ['Average Target', `$${fmt(priceTarget.priceTarget || priceTarget.priceTargetAvg)}`, 'Median Target', `$${fmt(priceTarget.priceTargetMedian)}`],
        ['High Target',    `$${fmt(priceTarget.priceTargetHigh)}`,                           'Low Target',    `$${fmt(priceTarget.priceTargetLow)}`],
        ['# of Analysts',  fmt(priceTarget.numberOfAnalysts || priceTarget.lastMonthNumberOfAnalysts, 0), 'Consensus', priceTarget.consensus || '-'],
      ]);
    }

    // TTM
    const ttm = Array.isArray(incomeTTM) ? incomeTTM[0] : incomeTTM;
    if (ttm) {
      y = checkY(y, 40);
      y = sectionHeader(y, 'TRAILING TWELVE MONTHS (TTM)');
      y = twoColRow(y, [
        ['Revenue (TTM)',        fmtLarge(ttm.revenue),                                  'Gross Profit (TTM)',    fmtLarge(ttm.grossProfit)],
        ['EBITDA (TTM)',         fmtLarge(ttm.ebitda),                                   'Net Income (TTM)',      fmtLarge(ttm.netIncome)],
        ['EPS Diluted (TTM)',    `$${fmt(ttm.epsdiluted || ttm.eps)}`,                   'Gross Margin (TTM)',    fmtPct((ttm.grossProfitRatio || 0) * 100)],
        ['Operating Margin TTM',fmtPct((ttm.operatingIncomeRatio || 0) * 100),           'Net Margin (TTM)',      fmtPct((ttm.netIncomeRatio || 0) * 100)],
      ]);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // LAST PAGE: DISCLAIMER
  // ════════════════════════════════════════════════════════════════════════
  y = newPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setTxt(G);
  doc.text('DISCLAIMER & IMPORTANT DISCLOSURES', M, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTxt({ r: 50, g: 50, b: 50 });
  const disclaimer = [
    'This Investment Analysis Report has been generated automatically by an AI-powered financial analysis',
    'platform for informational and educational purposes only. It does not constitute financial advice,',
    'investment recommendations, or an offer to buy or sell any security.',
    '',
    'All data is sourced from Financial Modeling Prep (FMP) API and third-party providers. No guarantee',
    'is made regarding accuracy, completeness, or timeliness. Investing involves risk including possible',
    'loss of principal. Past performance does not guarantee future results.',
    '',
    'Valuation models (DCF, DDM, Graham Number, etc.) rely on assumptions that may not reflect actual',
    'future performance. Different analysts using different assumptions may reach different conclusions.',
    '',
    'Consult a qualified financial advisor before making any investment decision.',
    '',
    `Report generated: ${dateStr}   |   ${companyName} (${ticker})`,
  ];
  disclaimer.forEach(line => {
    doc.text(line, M, y);
    y += 5.5;
  });

  addFooter();

  // ── Save ──────────────────────────────────────────────────────────────────
  const filename = `${ticker}_Analysis_${today.toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
