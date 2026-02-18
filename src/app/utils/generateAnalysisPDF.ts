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
  if (val === null || val === undefined || isNaN(Number(val))) return '—';
  return Number(val).toFixed(decimals);
}

function fmtPct(val: any, decimals = 2): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '—';
  return Number(val).toFixed(decimals) + '%';
}

function fmtLarge(val: any): string {
  if (val === null || val === undefined || isNaN(Number(val))) return '—';
  const n = Number(val);
  if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toFixed(2);
}

// Deutsche Bank Green
const GREEN = [0, 166, 81] as [number, number, number];   // #00A651
const DARK_GREEN = [0, 120, 60] as [number, number, number];
const GRAY_900 = [17, 24, 39] as [number, number, number];
const GRAY_800 = [31, 41, 55] as [number, number, number];
const GRAY_700 = [55, 65, 81] as [number, number, number];
const WHITE = [255, 255, 255] as [number, number, number];
const LIGHT_GRAY = [240, 242, 244] as [number, number, number];
const TEXT_DARK = [15, 23, 42] as [number, number, number];

export async function generateAnalysisPDF(data: PDFData): Promise<void> {
  // Dynamic import to avoid SSR issues
  const jsPDFModule = await import('jspdf');
  const jsPDF = jsPDFModule.default || (jsPDFModule as any).jsPDF;
  await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) as any;

  const PW = 210; // page width
  const PH = 297; // page height
  const M = 15;  // margin
  const CW = PW - 2 * M; // content width

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const { ticker, profile, quote, income, balance, cashFlow, incomeTTM,
          priceTarget, sharedAverageVal, sharedWACC, sharedAvgCAPM,
          sharedForecasts, sharedKeyMetricsSummary, sharedAdvanceValueNet,
          sharedCompanyQualityNet, sharedCagrStats, sharedPivotAnalysis } = data;

  const companyName = profile?.companyName || ticker;
  const sector = profile?.sector || '—';
  const industry = profile?.industry || '—';
  const exchange = profile?.exchangeShortName || profile?.exchange || '—';

  // ── Helper: draw section header ──────────────────────────────────────────
  function sectionHeader(doc: any, y: number, title: string): number {
    doc.setFillColor(...GREEN);
    doc.rect(M, y, CW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...WHITE);
    doc.text(title, M + 4, y + 5.5);
    doc.setTextColor(...TEXT_DARK);
    return y + 12;
  }

  // ── Helper: add page footer ───────────────────────────────────────────────
  function addFooter(doc: any, pageNum: number) {
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text(`${companyName} (${ticker}) — Investment Analysis Report — ${dateStr}`, M, PH - 8);
    doc.text(`Page ${pageNum}`, PW - M, PH - 8, { align: 'right' });
    // Bottom border line
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.5);
    doc.line(M, PH - 12, PW - M, PH - 12);
    doc.setTextColor(...TEXT_DARK);
  }

  // ── Helper: check if new page needed ─────────────────────────────────────
  let currentPage = 1;
  function checkNewPage(doc: any, y: number, needed = 30): number {
    if (y + needed > PH - 20) {
      addFooter(doc, currentPage);
      doc.addPage();
      currentPage++;
      addHeaderBar(doc);
      return 35;
    }
    return y;
  }

  function addHeaderBar(doc: any) {
    doc.setFillColor(...GRAY_900);
    doc.rect(0, 0, PW, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...GREEN);
    doc.text('INVESTMENT ANALYSIS REPORT', M, 8);
    doc.setTextColor(180, 180, 180);
    doc.text(`${ticker} — ${companyName}`, PW - M, 8, { align: 'right' });
    doc.setTextColor(...TEXT_DARK);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 1: COVER PAGE
  // ════════════════════════════════════════════════════════════════════════

  // Dark background for cover
  doc.setFillColor(...GRAY_900);
  doc.rect(0, 0, PW, PH, 'F');

  // Green accent bar top
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, PW, 3, 'F');

  // Green accent bar left
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, 4, PH, 'F');

  // Try to load company logo
  if (profile?.image) {
    try {
      const logoRes = await fetch(profile.image);
      if (logoRes.ok) {
        const blob = await logoRes.blob();
        const reader = new FileReader();
        const logoDataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        // Draw logo in top-right area
        doc.addImage(logoDataUrl, 'PNG', PW - M - 40, 20, 35, 35, undefined, 'FAST');
      }
    } catch {
      // Logo unavailable, skip
    }
  }

  // Company name - large
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...WHITE);
  const nameLines = doc.splitTextToSize(companyName, 130);
  doc.text(nameLines, 20, 50);

  // Ticker badge
  const tickerY = 50 + nameLines.length * 14;
  doc.setFillColor(...GREEN);
  doc.roundedRect(20, tickerY, 35, 12, 2, 2, 'F');
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text(ticker, 37.5, tickerY + 8, { align: 'center' });

  // Exchange badge
  doc.setFillColor(55, 65, 81);
  doc.roundedRect(60, tickerY, 35, 12, 2, 2, 'F');
  doc.setTextColor(200, 200, 200);
  doc.text(exchange, 77.5, tickerY + 8, { align: 'center' });

  // Report title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GREEN);
  doc.text('INVESTMENT ANALYSIS REPORT', 20, tickerY + 32);

  // Divider line
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1);
  doc.line(20, tickerY + 36, PW - 20, tickerY + 36);

  // Summary boxes on cover
  const boxY = tickerY + 46;
  const boxes = [
    { label: 'Current Price', value: `$${fmt(quote?.price)}` },
    { label: 'Market Cap', value: fmtLarge(quote?.marketCap) },
    { label: 'P/E Ratio', value: fmt(quote?.pe) },
    { label: 'Avg Valuation', value: sharedAverageVal ? `$${fmt(sharedAverageVal)}` : '—' },
  ];

  const boxW = (CW - 15) / 4;
  boxes.forEach((box, i) => {
    const bx = 20 + i * (boxW + 5);
    doc.setFillColor(31, 41, 55);
    doc.roundedRect(bx, boxY, boxW, 22, 2, 2, 'F');
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.3);
    doc.roundedRect(bx, boxY, boxW, 22, 2, 2, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(box.label, bx + boxW / 2, boxY + 7, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...GREEN);
    doc.text(box.value, bx + boxW / 2, boxY + 16, { align: 'center' });
  });

  // Sector / Industry / Date info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 180);
  doc.text(`Sector: ${sector}  |  Industry: ${industry}`, 20, boxY + 32);
  doc.text(`Report Generated: ${dateStr}`, 20, boxY + 40);

  // Description excerpt
  if (profile?.description) {
    const desc = profile.description.substring(0, 300) + (profile.description.length > 300 ? '...' : '');
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    const descLines = doc.splitTextToSize(desc, CW - 10);
    doc.text(descLines.slice(0, 6), 20, boxY + 52);
  }

  // Upside/downside vs valuation
  if (sharedAverageVal && quote?.price) {
    const upside = ((sharedAverageVal - quote.price) / quote.price) * 100;
    const isUp = upside >= 0;
    const upsideY = PH - 60;
    doc.setFillColor(isUp ? 0 : 180, isUp ? 80 : 0, isUp ? 40 : 0);
    doc.roundedRect(20, upsideY, 80, 30, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...WHITE);
    doc.text(isUp ? 'POTENTIAL UPSIDE' : 'POTENTIAL DOWNSIDE', 60, upsideY + 9, { align: 'center' });
    doc.setFontSize(18);
    doc.setTextColor(isUp ? 150 : 255, isUp ? 255 : 100, isUp ? 150 : 100);
    doc.text(`${isUp ? '+' : ''}${upside.toFixed(1)}%`, 60, upsideY + 22, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(`vs. avg. model valuation of $${fmt(sharedAverageVal)}`, 20, upsideY + 36);
  }

  // Footer line on cover
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(1);
  doc.line(20, PH - 18, PW - 20, PH - 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('This report is for informational purposes only. Not financial advice. Past performance does not guarantee future results.', PW / 2, PH - 12, { align: 'center' });

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 2: FINANCIAL HIGHLIGHTS
  // ════════════════════════════════════════════════════════════════════════
  addFooter(doc, currentPage);
  doc.addPage();
  currentPage++;
  addHeaderBar(doc);

  let y = 20;

  // Key Price Metrics
  y = sectionHeader(doc, y, 'PRICE & MARKET DATA');

  const priceRows = [
    ['Current Price', `$${fmt(quote?.price)}`, 'Day Change', `${fmtPct(quote?.changesPercentage)}`],
    ['52-Week High', `$${fmt(quote?.yearHigh)}`, '52-Week Low', `$${fmt(quote?.yearLow)}`],
    ['MA 50-Day', `$${fmt(quote?.priceAvg50)}`, 'MA 200-Day', `$${fmt(quote?.priceAvg200)}`],
    ['Market Cap', fmtLarge(quote?.marketCap), 'Volume', (quote?.volume ? Number(quote.volume).toLocaleString() : '—')],
    ['P/E Ratio', fmt(quote?.pe), 'EPS (TTM)', `$${fmt(quote?.eps)}`],
    ['Dividend Yield', fmtPct((quote?.dividendYield || 0) * 100), 'Beta', fmt(quote?.beta)],
  ];

  doc.autoTable({
    startY: y,
    head: [],
    body: priceRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, textColor: TEXT_DARK },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 40 },
      1: { cellWidth: 45 },
      2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 40 },
      3: { cellWidth: 45 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: M, right: M },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Income Highlights
  y = checkNewPage(doc, y, 50);
  y = sectionHeader(doc, y, 'INCOME STATEMENT HIGHLIGHTS (Last 3 Years)');

  const inc = income?.slice(0, 3) || [];
  const incHead = ['Metric', ...inc.map((i: any) => i.date?.substring(0, 4) || 'N/A')];
  const incRows = [
    ['Revenue', ...inc.map((i: any) => fmtLarge(i.revenue))],
    ['Gross Profit', ...inc.map((i: any) => fmtLarge(i.grossProfit))],
    ['Gross Margin', ...inc.map((i: any) => fmtPct((i.grossProfitRatio || 0) * 100))],
    ['Operating Income', ...inc.map((i: any) => fmtLarge(i.operatingIncome))],
    ['Net Income', ...inc.map((i: any) => fmtLarge(i.netIncome))],
    ['Net Margin', ...inc.map((i: any) => fmtPct((i.netIncomeRatio || 0) * 100))],
    ['EBITDA', ...inc.map((i: any) => fmtLarge(i.ebitda))],
    ['EPS', ...inc.map((i: any) => `$${fmt(i.epsdiluted || i.eps)}`)],
  ];

  doc.autoTable({
    startY: y,
    head: [incHead],
    body: incRows,
    theme: 'striped',
    headStyles: { fillColor: GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: M, right: M },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Balance Sheet Highlights
  y = checkNewPage(doc, y, 50);
  y = sectionHeader(doc, y, 'BALANCE SHEET HIGHLIGHTS (Latest Year)');

  const bal = balance?.[0] || {};
  const balRows = [
    ['Total Assets', fmtLarge(bal.totalAssets), 'Total Liabilities', fmtLarge(bal.totalLiabilities)],
    ['Total Equity', fmtLarge(bal.totalStockholdersEquity || bal.totalEquity), 'Total Debt', fmtLarge(bal.totalDebt)],
    ['Cash & Equivalents', fmtLarge(bal.cashAndCashEquivalents), 'Net Debt', fmtLarge(bal.netDebt)],
    ['Current Assets', fmtLarge(bal.totalCurrentAssets), 'Current Liabilities', fmtLarge(bal.totalCurrentLiabilities)],
    ['Goodwill & Intangibles', fmtLarge((bal.goodwill || 0) + (bal.intangibleAssets || 0)), 'PP&E', fmtLarge(bal.propertyPlantEquipmentNet)],
  ];

  doc.autoTable({
    startY: y,
    head: [],
    body: balRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
      1: { cellWidth: 40 },
      2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
      3: { cellWidth: 40 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: M, right: M },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Cash Flow Highlights
  y = checkNewPage(doc, y, 40);
  y = sectionHeader(doc, y, 'CASH FLOW HIGHLIGHTS (Last 3 Years)');

  const cf = cashFlow?.slice(0, 3) || [];
  const cfHead = ['Metric', ...cf.map((c: any) => c.date?.substring(0, 4) || 'N/A')];
  const cfRows = [
    ['Operating Cash Flow', ...cf.map((c: any) => fmtLarge(c.operatingCashFlow || c.netCashProvidedByOperatingActivities))],
    ['Free Cash Flow', ...cf.map((c: any) => fmtLarge(c.freeCashFlow))],
    ['CapEx', ...cf.map((c: any) => fmtLarge(c.capitalExpenditure))],
    ['Dividends Paid', ...cf.map((c: any) => fmtLarge(c.dividendsPaid))],
  ];

  doc.autoTable({
    startY: y,
    head: [cfHead],
    body: cfRows,
    theme: 'striped',
    headStyles: { fillColor: GRAY_800, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50 } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: M, right: M },
  });

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 3: VALUATION & KEY METRICS
  // ════════════════════════════════════════════════════════════════════════
  addFooter(doc, currentPage);
  doc.addPage();
  currentPage++;
  addHeaderBar(doc);

  y = 20;

  // Valuation Summary
  y = sectionHeader(doc, y, 'VALUATION SUMMARY');

  const valRows: any[] = [];

  if (sharedAverageVal) {
    valRows.push(['Average Model Valuation', `$${fmt(sharedAverageVal)}`, 'vs. Current Price',
      quote?.price ? `${((sharedAverageVal / quote.price - 1) * 100).toFixed(1)}% ${sharedAverageVal > quote.price ? '▲' : '▼'}` : '—']);
  }
  if (sharedWACC) {
    valRows.push(['WACC (Discount Rate)', fmtPct(sharedWACC), 'Cost of Equity (CAPM)', fmtPct(sharedAvgCAPM)]);
  }
  if (sharedCagrStats) {
    valRows.push(['Avg. Historical CAGR', fmtPct(sharedCagrStats.avgCagr), 'CAGR Range', `${fmtPct(sharedCagrStats.minCagr)} – ${fmtPct(sharedCagrStats.maxCagr)}`]);
  }
  if (priceTarget) {
    valRows.push(['Analyst Target (Avg)', `$${fmt(priceTarget.priceTarget || priceTarget.priceTargetAvg)}`,
      'Target Range', `$${fmt(priceTarget.priceTargetLow)} – $${fmt(priceTarget.priceTargetHigh)}`]);
  }

  if (valRows.length > 0) {
    doc.autoTable({
      startY: y,
      head: [],
      body: valRows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [0, 50, 25], textColor: WHITE, cellWidth: 50 },
        1: { textColor: [0, 150, 70], fontStyle: 'bold', cellWidth: 40 },
        2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
        3: { cellWidth: 40 },
      },
      margin: { left: M, right: M },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Advanced Valuation Net results
  if (sharedAdvanceValueNet?.valuations) {
    y = checkNewPage(doc, y, 50);
    y = sectionHeader(doc, y, 'MULTI-MODEL VALUATION BREAKDOWN (AdvanceValueNet)');

    const avnRows = Object.entries(sharedAdvanceValueNet.valuations).map(([model, val]: any) => [
      model.replace(/_/g, ' ').toUpperCase(),
      typeof val === 'number' ? `$${fmt(val)}` : '—',
      quote?.price && typeof val === 'number' ? `${((val / quote.price - 1) * 100).toFixed(1)}%` : '—',
    ]);

    if (avnRows.length > 0) {
      doc.autoTable({
        startY: y,
        head: [['Valuation Model', 'Intrinsic Value', 'vs. Market Price']],
        body: avnRows,
        theme: 'striped',
        headStyles: { fillColor: GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 45, fontStyle: 'bold', textColor: [0, 120, 60] },
          2: { cellWidth: 40 },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: M, right: M },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  // Company Quality Score
  if (sharedCompanyQualityNet?.scores) {
    y = checkNewPage(doc, y, 50);
    y = sectionHeader(doc, y, 'COMPANY QUALITY SCORE (CompanyQualityNet)');

    const scores = sharedCompanyQualityNet.scores;
    const totalScore = sharedCompanyQualityNet.totalScore;
    const rating = sharedCompanyQualityNet.rating;

    const scoreRows = Object.entries(scores).map(([dim, score]: any) => [
      dim.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
      typeof score === 'number' ? `${(score * 100).toFixed(0)}/100` : '—',
      typeof score === 'number' ? (score >= 0.7 ? '●●●●●' : score >= 0.5 ? '●●●●○' : score >= 0.3 ? '●●●○○' : '●●○○○') : '—',
    ]);

    scoreRows.push(['TOTAL SCORE', typeof totalScore === 'number' ? `${(totalScore * 100).toFixed(0)}/100` : '—', rating || '—']);

    doc.autoTable({
      startY: y,
      head: [['Dimension', 'Score', 'Rating']],
      body: scoreRows,
      theme: 'striped',
      headStyles: { fillColor: DARK_GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      columnStyles: {
        0: { cellWidth: 70, fontStyle: 'bold' },
        1: { cellWidth: 35 },
        2: { cellWidth: 70, textColor: [0, 130, 60] },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Key Metrics
  y = checkNewPage(doc, y, 50);
  y = sectionHeader(doc, y, 'KEY FINANCIAL RATIOS & METRICS');

  const km = sharedKeyMetricsSummary || {};
  const metricsRows = [
    ['Return on Equity (ROE)', fmtPct((km.roe || quote?.returnOnEquity || 0) * 100), 'Return on Assets (ROA)', fmtPct((km.roa || quote?.returnOnAssets || 0) * 100)],
    ['Debt / Equity', fmt(km.debtToEquity || quote?.debtToEquity), 'Current Ratio', fmt(km.currentRatio || quote?.currentRatio)],
    ['Gross Margin', fmtPct((income?.[0]?.grossProfitRatio || 0) * 100), 'Net Margin', fmtPct((income?.[0]?.netIncomeRatio || 0) * 100)],
    ['P/E Ratio', fmt(quote?.pe), 'P/B Ratio', fmt(km.priceToBook || quote?.priceToBookRatio)],
    ['EV/EBITDA', fmt(km.evToEbitda), 'P/FCF', fmt(km.priceToFCF)],
    ['Interest Coverage', fmt(km.interestCoverage), 'Quick Ratio', fmt(km.quickRatio)],
  ];

  doc.autoTable({
    startY: y,
    head: [],
    body: metricsRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
      1: { cellWidth: 40 },
      2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
      3: { cellWidth: 40 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: M, right: M },
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // Pivot & Technical Analysis
  if (sharedPivotAnalysis) {
    y = checkNewPage(doc, y, 50);
    y = sectionHeader(doc, y, 'TECHNICAL ANALYSIS — PIVOT POINTS');

    const pa = sharedPivotAnalysis;
    const pivotRows = [
      ['Pivot Point', `$${fmt(pa.pivotPoint)}`, 'Current Price', `$${fmt(pa.currentPrice)}`],
      ['Resistance R1', `$${fmt(pa.resistance?.R1)}`, 'Resistance R2', `$${fmt(pa.resistance?.R2)}`],
      ['Support S1', `$${fmt(pa.support?.S1)}`, 'Support S2', `$${fmt(pa.support?.S2)}`],
      ['52-Week High', `$${fmt(pa.high52Week)}`, '52-Week Low', `$${fmt(pa.low52Week)}`],
      ['Fib 23.6%', `$${fmt(pa.fibonacci?.level236)}`, 'Fib 38.2%', `$${fmt(pa.fibonacci?.level382)}`],
      ['Fib 50.0%', `$${fmt(pa.fibonacci?.level500)}`, 'Fib 61.8%', `$${fmt(pa.fibonacci?.level618)}`],
      ['% from 52W High', fmtPct(pa.priceVsHigh), '% from 52W Low', fmtPct(pa.priceVsLow)],
    ];

    doc.autoTable({
      startY: y,
      head: [],
      body: pivotRows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
        1: { cellWidth: 40 },
        2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
        3: { cellWidth: 40 },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
    });

    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // ════════════════════════════════════════════════════════════════════════
  // PAGE 4: ANALYST FORECASTS
  // ════════════════════════════════════════════════════════════════════════
  if (sharedForecasts && sharedForecasts.length > 0) {
    addFooter(doc, currentPage);
    doc.addPage();
    currentPage++;
    addHeaderBar(doc);

    y = 20;
    y = sectionHeader(doc, y, 'ANALYST CONSENSUS ESTIMATES');

    const fcHead = ['Year', 'Revenue (Est.)', 'EPS (Est.)', 'Net Income (Est.)', 'EBITDA (Est.)'];
    const fcRows = sharedForecasts.slice(0, 5).map((f: any) => [
      f.date?.substring(0, 4) || '—',
      fmtLarge(f.estimatedRevenueAvg),
      `$${fmt(f.estimatedEpsAvg)}`,
      fmtLarge(f.estimatedNetIncomeAvg),
      fmtLarge(f.estimatedEbitdaAvg),
    ]);

    doc.autoTable({
      startY: y,
      head: [fcHead],
      body: fcRows,
      theme: 'striped',
      headStyles: { fillColor: GREEN, textColor: WHITE, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' } },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: M, right: M },
    });

    y = (doc as any).lastAutoTable.finalY + 15;

    // Price target summary
    if (priceTarget) {
      y = checkNewPage(doc, y, 40);
      y = sectionHeader(doc, y, 'ANALYST PRICE TARGET CONSENSUS');

      const ptRows = [
        ['Average Target', `$${fmt(priceTarget.priceTarget || priceTarget.priceTargetAvg)}`,
         'Median Target', `$${fmt(priceTarget.priceTargetMedian)}`],
        ['High Target', `$${fmt(priceTarget.priceTargetHigh)}`,
         'Low Target', `$${fmt(priceTarget.priceTargetLow)}`],
        ['Analysts (#)', fmt(priceTarget.numberOfAnalysts || priceTarget.lastMonthNumberOfAnalysts, 0),
         'Consensus', priceTarget.consensus || priceTarget.lastMonthConsensus || '—'],
      ];

      doc.autoTable({
        startY: y,
        head: [],
        body: ptRows,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
          1: { cellWidth: 40 },
          2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 45 },
          3: { cellWidth: 40 },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: M, right: M },
      });

      y = (doc as any).lastAutoTable.finalY + 15;
    }

    // TTM snapshot
    const ttm = Array.isArray(incomeTTM) ? incomeTTM[0] : incomeTTM;
    if (ttm) {
      y = checkNewPage(doc, y, 40);
      y = sectionHeader(doc, y, 'TRAILING TWELVE MONTHS (TTM) SNAPSHOT');

      const ttmRows = [
        ['Revenue (TTM)', fmtLarge(ttm.revenue), 'Gross Profit (TTM)', fmtLarge(ttm.grossProfit)],
        ['EBITDA (TTM)', fmtLarge(ttm.ebitda), 'Net Income (TTM)', fmtLarge(ttm.netIncome)],
        ['EPS Diluted (TTM)', `$${fmt(ttm.epsdiluted || ttm.eps)}`, 'Gross Margin (TTM)', fmtPct((ttm.grossProfitRatio || 0) * 100)],
        ['Operating Margin (TTM)', fmtPct((ttm.operatingIncomeRatio || 0) * 100), 'Net Margin (TTM)', fmtPct((ttm.netIncomeRatio || 0) * 100)],
      ];

      doc.autoTable({
        startY: y,
        head: [],
        body: ttmRows,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 50 },
          1: { cellWidth: 40 },
          2: { fontStyle: 'bold', fillColor: LIGHT_GRAY, cellWidth: 50 },
          3: { cellWidth: 35 },
        },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: M, right: M },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // LAST PAGE: DISCLAIMER
  // ════════════════════════════════════════════════════════════════════════
  addFooter(doc, currentPage);
  doc.addPage();
  currentPage++;
  addHeaderBar(doc);

  y = 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...GREEN);
  doc.text('DISCLAIMER & IMPORTANT DISCLOSURES', M, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  const disclaimer = `This Investment Analysis Report has been generated automatically by an AI-powered financial analysis platform for informational and educational purposes only. It does not constitute financial advice, investment recommendations, or an offer to buy or sell any security.

All data presented in this report is sourced from Financial Modeling Prep (FMP) API and other third-party providers. While efforts are made to ensure accuracy, no guarantee is made regarding the completeness, accuracy, or timeliness of the information provided.

Investing in securities involves risk, including the possible loss of principal. Past performance does not guarantee future results. The valuation models used (DCF, DDM, Graham Number, etc.) are based on assumptions that may not reflect actual future performance. Different analysts using different assumptions may reach different conclusions.

You should consult with a qualified financial advisor before making any investment decisions. This report is not a substitute for professional financial advice tailored to your individual circumstances, financial situation, and investment objectives.

The company data, financial metrics, and valuation outputs presented herein are based on publicly available information and proprietary analytical models. Actual results may differ materially from the projections and estimates contained in this report.

Report generated on ${dateStr} for ${companyName} (${ticker}).`;

  const disclaimerLines = doc.splitTextToSize(disclaimer, CW);
  doc.text(disclaimerLines, M, y);

  addFooter(doc, currentPage);

  // ── Save PDF ─────────────────────────────────────────────────────────────
  const filename = `${ticker}_Analysis_${today.toISOString().split('T')[0]}.pdf`;
  doc.save(filename);
}
