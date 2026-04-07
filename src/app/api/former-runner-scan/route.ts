import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FMP_BASE = 'https://financialmodelingprep.com';
const SCAN_CONCURRENCY = 5;

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const sp = new URL(req.url).searchParams;
  const priceMin = sp.get('priceMin') || '0.01';
  const priceMax = sp.get('priceMax') || '10';
  const marketCapMax = sp.get('marketCapMax') || '500000000';
  const country = sp.get('country') || '';
  const sector = sp.get('sector') || '';
  const minPastSurge = parseFloat(sp.get('minPastSurge') || '4.0');
  const minDormancyMonths = parseInt(sp.get('minDormancyMonths') || '6');
  const wakeVolumeMultiplier = parseFloat(sp.get('wakeVolumeMultiplier') || '15');

  // 1. Fetch OTC / small-cap stocks — NO exchange filter to include OTC markets
  const screenerParams = new URLSearchParams({
    priceMoreThan: priceMin,
    priceLowerThan: priceMax,
    marketCapLowerThan: marketCapMax,
    ...(country ? { country } : {}),
    ...(sector ? { sector } : {}),
    // NO exchange filter — include ALL exchanges (NYSE, NASDAQ, AMEX, OTC, PINK, etc.)
    isActivelyTrading: 'true',
    isEtf: 'false',
    isFund: 'false',
    limit: '10000',      // Fetch full universe — no artificial cap
    apikey: apiKey,
  });

  let stocks: any[] = [];
  try {
    const res = await fetch(`${FMP_BASE}/stable/company-screener?${screenerParams}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) stocks = data;
    }
  } catch { /* skip */ }

  // If screener returned few results, also try the v3 stock-screener endpoint
  if (stocks.length < 50) {
    try {
      const v3Params = new URLSearchParams({
        priceMoreThan: priceMin,
        priceLowerThan: priceMax,
        marketCapLowerThan: marketCapMax,
        ...(country ? { country } : {}),
        ...(sector ? { sector } : {}),
        isActivelyTrading: 'true',
        isEtf: 'false',
        isFund: 'false',
        limit: '10000',
        apikey: apiKey,
      });
      const res = await fetch(`${FMP_BASE}/api/v3/stock-screener?${v3Params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          stocks = stocks.concat(data);
        }
      }
    } catch { /* skip */ }
  }

  const seen = new Set<string>();
  const valid = stocks.filter((s: any) => {
    if (!s.symbol || !s.price || s.price <= 0 || s.isEtf || s.isFund) return false;
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  if (valid.length === 0) {
    return NextResponse.json({ results: [], total: 0, scanned: 0 });
  }

  // 2. Scan each stock via backend — no result cap
  const results: any[] = [];
  let scanned = 0;

  const scanFormerRunner = async (stock: any) => {
    try {
      const res = await fetch(`${backendUrl}/former-runner/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: stock.symbol,
          min_past_surge: minPastSurge,
          min_dormancy_months: minDormancyMonths,
          wake_volume_multiplier: wakeVolumeMultiplier,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      scanned++;
      if (data.score > 0 && data.detected) {
        results.push({
          symbol: stock.symbol,
          companyName: stock.companyName || stock.symbol,
          sector: stock.sector || '',
          exchange: stock.exchangeShortName || stock.exchange || '',
          currentPrice: data.current_price || stock.price,
          marketCap: stock.marketCap || 0,
          score: data.score,
          pastSurgePct: data.pattern?.past_surge_pct || 0,
          dormancyMonths: data.pattern?.dormancy_months || 0,
          wakeVolumeMultiplier: data.pattern?.wake_volume_multiplier || 0,
          peakDate: data.pattern?.peak_date || '',
          narrative: (data.narrative || '').slice(0, 200),
        });
      }
    } catch { /* skip failed tickers */ }
  };

  for (let i = 0; i < valid.length; i += SCAN_CONCURRENCY) {
    const wave = valid.slice(i, i + SCAN_CONCURRENCY);
    await Promise.all(wave.map(scanFormerRunner));
  }

  // Sort by score descending — return ALL qualifying results (no cap)
  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    results,
    total: valid.length,
    scanned,
  });
}
