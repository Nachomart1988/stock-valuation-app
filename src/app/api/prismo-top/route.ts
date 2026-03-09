import { NextRequest, NextResponse } from 'next/server';

// Allow up to 60s on Vercel Pro (hobby plan is capped at 10s)
export const maxDuration = 60;

const FMP_BASE = 'https://financialmodelingprep.com';
const DCF_CONCURRENCY = 20;   // parallel individual DCF requests
const MAX_STOCKS = 250;       // keep fast — top 250 by market cap

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
  }

  const sp = new URL(req.url).searchParams;
  const priceMin = sp.get('priceMin') || '5';
  const priceMax = sp.get('priceMax') || '500';
  const marketCapMin = sp.get('marketCapMin') || '500000000';
  const country = sp.get('country') || 'US';

  // 1. Fetch stocks from screener using the stable endpoint
  //    Filter to major exchanges to avoid .NE/.TO duplicates
  const screenerParams = new URLSearchParams({
    priceMoreThan: priceMin,
    priceLowerThan: priceMax,
    marketCapMoreThan: marketCapMin,
    country,
    exchange: 'NYSE,NASDAQ,AMEX',
    isActivelyTrading: 'true',
    isEtf: 'false',
    isFund: 'false',
    limit: String(MAX_STOCKS),
    apikey: apiKey,
  });

  let stocks: any[] = [];
  let screenerDebug = '';

  try {
    const url = `${FMP_BASE}/stable/company-screener?${screenerParams}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        stocks = data;
        screenerDebug = `${data.length} stocks from company-screener`;
      } else {
        screenerDebug = `company-screener returned empty (status ${res.status})`;
      }
    } else {
      screenerDebug = `company-screener HTTP ${res.status}`;
    }
  } catch (e: any) {
    screenerDebug = `company-screener error: ${e.message}`;
  }

  if (stocks.length === 0) {
    return NextResponse.json({
      opportunities: [],
      total: 0,
      analyzed: 0,
      debug: screenerDebug,
    });
  }

  // Deduplicate & remove ETFs/zero-price
  const seen = new Set<string>();
  const valid = stocks.filter((s: any) => {
    if (!s.symbol || !s.price || s.price <= 0 || s.isEtf || s.isFund) return false;
    // Skip symbols with dots (cross-listings like AAPL.NE)
    if (s.symbol.includes('.')) return false;
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  // 2. Fetch DCF for each symbol individually using the STABLE endpoint
  const dcfMap = new Map<string, number>();

  const fetchDCF = async (symbol: string) => {
    try {
      const url = `${FMP_BASE}/stable/discounted-cash-flow?symbol=${symbol}&apikey=${apiKey}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const d = data[0];
        if (d?.dcf && isFinite(Number(d.dcf)) && Number(d.dcf) > 0) {
          dcfMap.set(symbol, Number(d.dcf));
        }
      }
    } catch { /* skip */ }
  };

  // Process in waves of DCF_CONCURRENCY
  for (let i = 0; i < valid.length; i += DCF_CONCURRENCY) {
    const wave = valid.slice(i, i + DCF_CONCURRENCY);
    await Promise.all(wave.map((s: any) => fetchDCF(s.symbol)));
  }

  // 3. Build opportunities: price < intrinsic value
  const opportunities = [];
  for (const stock of valid) {
    const intrinsic = dcfMap.get(stock.symbol);
    if (!intrinsic || intrinsic <= stock.price) continue;
    // Sanity: skip if intrinsic > 20x price (data anomaly)
    if (intrinsic > stock.price * 20) continue;
    const upside = ((intrinsic - stock.price) / stock.price) * 100;
    opportunities.push({
      symbol: stock.symbol,
      companyName: stock.companyName || stock.symbol,
      sector: stock.sector || '',
      currentPrice: stock.price,
      intrinsicValue: Math.round(intrinsic * 100) / 100,
      upside: Math.round(upside * 10) / 10,
      marketCap: stock.marketCap || 0,
    });
  }

  // Sort by upside descending, take top 25
  opportunities.sort((a, b) => b.upside - a.upside);
  const top25 = opportunities.slice(0, 25);

  return NextResponse.json({
    opportunities: top25,
    total: valid.length,
    analyzed: dcfMap.size,
  });
}
