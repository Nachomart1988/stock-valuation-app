import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FMP_BASE = 'https://financialmodelingprep.com';
const SCAN_CONCURRENCY = 5;
const MAX_STOCKS = 1000;

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
  }

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const sp = new URL(req.url).searchParams;
  const priceMin = sp.get('priceMin') || '5';
  const priceMax = sp.get('priceMax') || '500';
  const marketCapMin = sp.get('marketCapMin') || '500000000';
  const country = sp.get('country') || 'US';
  const sector = sp.get('sector') || '';
  const minSurge = parseFloat(sp.get('minSurge') || '0.50');
  const surgeLookbackMonths = parseInt(sp.get('surgeLookbackMonths') || '6');
  const maPeriod = parseInt(sp.get('maPeriod') || '20');

  // 1. Fetch stocks from FMP screener
  const screenerParams = new URLSearchParams({
    priceMoreThan: priceMin,
    priceLowerThan: priceMax,
    marketCapMoreThan: marketCapMin,
    country,
    ...(sector ? { sector } : {}),
    exchange: 'NYSE,NASDAQ,AMEX',
    isActivelyTrading: 'true',
    isEtf: 'false',
    isFund: 'false',
    limit: String(MAX_STOCKS),
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

  // Deduplicate & validate
  const seen = new Set<string>();
  const valid = stocks.filter((s: any) => {
    if (!s.symbol || !s.price || s.price <= 0 || s.isEtf || s.isFund) return false;
    if (s.symbol.includes('.')) return false;
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  if (valid.length === 0) {
    return NextResponse.json({ results: [], total: 0, scanned: 0 });
  }

  // 2. Scan each stock for MA bounces via backend
  const results: any[] = [];
  let scanned = 0;

  const scanBounce = async (stock: any) => {
    try {
      const res = await fetch(`${backendUrl}/ma-bounce/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: stock.symbol,
          min_surge: minSurge,
          surge_lookback_months: surgeLookbackMonths,
          ma_period: maPeriod,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      scanned++;
      // Only include stocks with at least 1 bounce
      if (data.detected && data.bounce_count > 0) {
        results.push({
          symbol: stock.symbol,
          companyName: stock.companyName || stock.symbol,
          sector: stock.sector || '',
          currentPrice: stock.price,
          marketCap: stock.marketCap || 0,
          score: data.score,
          bounceCount: data.bounce_count,
          surgePct: data.surge?.surge_pct || 0,
          surgeWindow: `${data.surge?.low_date || ''} → ${data.surge?.high_date || ''}`,
          currentMa: data.current_ma || 0,
          maDistancePct: data.ma_distance_pct || 0,
          maPeriod: data.ma_period,
          avgQuality: data.avg_quality || 0,
          avgRecoveryPct: data.avg_recovery_pct || 0,
          narrative: (data.narrative || '').slice(0, 250),
          bestBounce: data.bounces?.[0] || null,
        });
      }
    } catch { /* skip failed tickers */ }
  };

  // Process in waves
  for (let i = 0; i < valid.length; i += SCAN_CONCURRENCY) {
    const wave = valid.slice(i, i + SCAN_CONCURRENCY);
    await Promise.all(wave.map(scanBounce));
  }

  // Sort by bounce count descending (primary), then score (secondary)
  results.sort((a, b) => b.bounceCount - a.bounceCount || b.score - a.score);

  return NextResponse.json({
    results,
    total: valid.length,
    scanned,
  });
}
