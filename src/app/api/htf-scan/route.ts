import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FMP_BASE = 'https://financialmodelingprep.com';
const SCAN_CONCURRENCY = 15;
const MAX_STOCKS = 10000;

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
  const minSurge = parseFloat(sp.get('minSurge') || '0.80');
  const maxFlagRange = parseFloat(sp.get('maxFlagRange') || '0.15');
  const surgeLookbackMonths = parseInt(sp.get('surgeLookbackMonths') || '0');

  // 1. Fetch stocks from FMP screener — split by market-cap bands to bypass
  //    the screener's silent per-call response cap. Each band must stay
  //    under the cap; results are merged and deduplicated below.
  const fetchBand = async (capLo: string, capHi: string | null): Promise<any[]> => {
    const params = new URLSearchParams({
      priceMoreThan: priceMin,
      priceLowerThan: priceMax,
      marketCapMoreThan: capLo,
      ...(capHi ? { marketCapLowerThan: capHi } : {}),
      country,
      ...(sector ? { sector } : {}),
      exchange: 'NYSE,NASDAQ,AMEX',
      isActivelyTrading: 'true',
      isEtf: 'false',
      isFund: 'false',
      limit: String(MAX_STOCKS),
      apikey: apiKey,
    });
    try {
      const res = await fetch(`${FMP_BASE}/stable/company-screener?${params}`, { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };

  // Dense logarithmic bands relative to user's marketCapMin floor.
  // Bottom bands are tighter because that's where most stocks live and where
  // we previously hit FMP's per-call cap. Boundaries are shared; dedup drops overlap.
  const floor = Math.max(1, parseFloat(marketCapMin) || 0);
  const bands: Array<[string, string | null]> = [
    [String(floor),           String(floor * 1.5)],
    [String(floor * 1.5),     String(floor * 2.25)],
    [String(floor * 2.25),    String(floor * 3.5)],
    [String(floor * 3.5),     String(floor * 5)],
    [String(floor * 5),       String(floor * 10)],
    [String(floor * 10),      String(floor * 25)],
    [String(floor * 25),      String(floor * 100)],
    [String(floor * 100),     String(floor * 500)],
    [String(floor * 500),     null],
  ];

  const banded = await Promise.all(bands.map(([lo, hi]) => fetchBand(lo, hi)));
  const bandCounts = banded.map((arr, i) => ({ band: i, lo: bands[i][0], hi: bands[i][1], n: arr.length }));
  const stocks: any[] = banded.flat();

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

  // 2. Scan each stock for HTF patterns via backend
  const results: any[] = [];
  let scanned = 0;

  const scanHTF = async (stock: any) => {
    try {
      const res = await fetch(`${backendUrl}/htf/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: stock.symbol,
          min_surge: minSurge,
          max_flag_range: maxFlagRange,
          surge_lookback_months: surgeLookbackMonths,
          ignore_vol_dryup: true,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      scanned++;
      // Backend returns best_pattern as a nested dict: { surge: {...}, flag: {...} | null, breakout: {...}, ml_probability, fusion_score, ... }
      // Frontend expects a flat shape — flatten + map fields here.
      const bp = data.best_pattern;
      if (!bp || !bp.surge || !bp.flag) return; // require both a surge AND a flag (real HTF)

      const breakout = bp.breakout || {};
      const breakoutStatus = breakout.breakout_triggered
        ? (breakout.vol_confirmation ? 'confirmed' : 'triggered')
        : (typeof breakout.proximity_pct === 'number' && breakout.proximity_pct > -3 ? 'approaching' : 'watching');

      const flatBestPattern = {
        surge_pct: bp.surge.surge_pct,                          // already a fraction (e.g. 1.05)
        flag_range_pct: bp.flag.flag_range_pct != null ? bp.flag.flag_range_pct / 100 : null, // backend returns 12.5 → frontend wants 0.125
        flag_weeks: bp.flag.weeks ?? null,
        vol_dryup: bp.flag.vol_dryup_ratio ?? null,
        ml_probability: bp.ml_probability ?? 0,
        breakout_status: breakoutStatus,
        // Pattern coordinates for charting
        surge_start_date: bp.surge.start_date ?? null,
        surge_peak_date: bp.surge.peak_date ?? null,
        surge_low_price: bp.surge.low_price ?? null,
        surge_high_price: bp.surge.high_price ?? null,
        flag_start_date: bp.flag.start_date ?? null,
        flag_end_date: bp.flag.end_date ?? null,
        flag_high: bp.flag.flag_high ?? null,
        flag_low: bp.flag.flag_low ?? null,
      };

      if (data.score > 0) {
        results.push({
          symbol: stock.symbol,
          companyName: stock.companyName || stock.symbol,
          sector: stock.sector || '',
          currentPrice: stock.price,
          marketCap: stock.marketCap || 0,
          score: data.score,
          detected: data.detected,
          bestPattern: flatBestPattern,
          narrative: (data.narrative || '').slice(0, 200),
          patternsCount: data.patterns?.length || 0,
        });
      }
    } catch { /* skip failed tickers */ }
  };

  // Process in waves of SCAN_CONCURRENCY
  for (let i = 0; i < valid.length; i += SCAN_CONCURRENCY) {
    const wave = valid.slice(i, i + SCAN_CONCURRENCY);
    await Promise.all(wave.map(scanHTF));
  }

  // Sort by score descending, return top 25
  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    results: results.slice(0, 25),
    total: valid.length,
    scanned,
    bandCounts,
  });
}
