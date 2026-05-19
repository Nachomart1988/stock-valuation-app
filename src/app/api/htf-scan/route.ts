import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FMP_BASE = 'https://financialmodelingprep.com';
const MAX_STOCKS = 10000;
// Leave headroom under Vercel's 300s maxDuration for FMP screener call + response serialization.
const BACKEND_SCAN_TIMEOUT_MS = 285_000;

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
  const sector = sp.get('sector') || '';
  const minSurge = parseFloat(sp.get('minSurge') || '0.80');
  const maxFlagRange = parseFloat(sp.get('maxFlagRange') || '0.15');
  const surgeLookbackMonths = parseInt(sp.get('surgeLookbackMonths') || '0');

  // 1. Fetch stocks from FMP screener
  const params = new URLSearchParams({
    priceMoreThan: priceMin,
    priceLowerThan: priceMax,
    marketCapMoreThan: marketCapMin,
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
    const res = await fetch(`${FMP_BASE}/stable/company-screener?${params}`, { cache: 'no-store' });
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

  // 2. Single batch scan on the backend (Railway). The backend fans out across
  //    tickers internally with a thread pool, so we don't hit Vercel's 300s cap
  //    by issuing thousands of per-ticker HTTPS requests from this function.
  try {
    const scanRes = await fetch(`${backendUrl}/htf/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers: valid.map((s: any) => ({
          symbol: s.symbol,
          companyName: s.companyName || s.symbol,
          sector: s.sector || '',
          price: s.price,
          marketCap: s.marketCap || 0,
        })),
        min_surge: minSurge,
        max_flag_range: maxFlagRange,
        surge_lookback_months: surgeLookbackMonths,
        ignore_vol_dryup: true,
        max_workers: 28,
        top_n: 25,
      }),
      signal: AbortSignal.timeout(BACKEND_SCAN_TIMEOUT_MS),
    });

    if (!scanRes.ok) {
      return NextResponse.json(
        { error: `backend scan failed (${scanRes.status})`, results: [], total: valid.length, scanned: 0 },
        { status: 502 },
      );
    }

    const data = await scanRes.json();
    return NextResponse.json({
      results: data.results || [],
      total: data.total ?? valid.length,
      scanned: data.scanned ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `backend scan error: ${e?.message || 'unknown'}`, results: [], total: valid.length, scanned: 0 },
      { status: 502 },
    );
  }
}
