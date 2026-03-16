import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FMP_BASE = 'https://financialmodelingprep.com';
const BATCH_SIZE = 10; // FMP comma-separated batch limit

/* ── Squeeze score tiers ─────────────────────────────────────── */
type SqueezeTier = 'POWER' | 'EXTREME' | 'STRONG' | 'MODERATE';

function squeezeTier(rotation: number, floatShares: number): SqueezeTier | null {
  const fM = floatShares / 1e6;
  if (rotation >= 30 && fM <= 10) return 'POWER';
  if (rotation >= 20 && fM <= 25) return 'EXTREME';
  if (rotation >= 15 && fM <= 50) return 'STRONG';
  if (rotation >= 10 && fM <= 100) return 'MODERATE';
  if (rotation >= 40) return 'POWER';
  if (rotation >= 25) return 'EXTREME';
  if (rotation >= 15) return 'STRONG';
  if (rotation >= 8) return 'MODERATE';
  return null;
}

function squeezeScore(rotation: number, floatShares: number): number {
  const fM = floatShares / 1e6;
  let score = Math.min(60, Math.log2(rotation + 1) * 10);
  if (fM <= 5) score += 30;
  else if (fM <= 15) score += 22;
  else if (fM <= 30) score += 15;
  else if (fM <= 50) score += 10;
  else if (fM <= 100) score += 5;
  if (rotation >= 30 && fM <= 10) score += 10;
  return Math.min(100, Math.round(score));
}

/* ── Batch-fetch helper ──────────────────────────────────────── */
async function batchFetch(
  symbols: string[],
  endpoint: string,
  apiKey: string,
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  // Process in chunks of BATCH_SIZE using comma-separated symbols
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const chunk = symbols.slice(i, i + BATCH_SIZE);
    const joined = chunk.join(',');
    try {
      const res = await fetch(
        `${FMP_BASE}${endpoint}?symbol=${joined}&apikey=${apiKey}`,
        { cache: 'no-store' },
      );
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data) ? data : [data];
        for (const item of arr) {
          if (item?.symbol) map.set(item.symbol, item);
        }
      }
    } catch { /* skip failed batch */ }
  }
  return map;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
  }

  const sp = new URL(req.url).searchParams;
  const priceMin = sp.get('priceMin') || '0.5';
  const priceMax = sp.get('priceMax') || '50';
  const marketCapMax = sp.get('marketCapMax') || '2000000000';
  const country = sp.get('country') || 'US';
  const sector = sp.get('sector') || '';
  const minRotation = parseFloat(sp.get('minRotation') || '8');
  const maxFloat = parseFloat(sp.get('maxFloat') || '100000000');

  // ── 1. Fetch FULL universe from FMP screener (no artificial cap) ──
  const screenerParams = new URLSearchParams({
    priceMoreThan: priceMin,
    priceLowerThan: priceMax,
    marketCapLowerThan: marketCapMax,
    country,
    ...(sector ? { sector } : {}),
    exchange: 'NYSE,NASDAQ,AMEX',
    isActivelyTrading: 'true',
    isEtf: 'false',
    isFund: 'false',
    limit: '10000',
    apikey: apiKey,
  });

  let stocks: any[] = [];
  try {
    const res = await fetch(
      `${FMP_BASE}/stable/company-screener?${screenerParams}`,
      { cache: 'no-store' },
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) stocks = data;
    }
  } catch { /* skip */ }

  // Deduplicate & validate — screener already gives us volume + price
  const seen = new Set<string>();
  const valid = stocks.filter((s: any) => {
    if (!s.symbol || !s.price || s.price <= 0 || s.isEtf || s.isFund) return false;
    if (s.symbol.includes('.') || s.symbol.includes('-')) return false;
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  if (valid.length === 0) {
    return NextResponse.json({ results: [], total: 0, scanned: 0 });
  }

  const allSymbols = valid.map((s: any) => s.symbol);

  // ── 2. Batch-fetch profiles (floatShares) + quotes (dayHigh, avgVolume) ──
  const [profileMap, quoteMap] = await Promise.all([
    batchFetch(allSymbols, '/stable/profile', apiKey),
    batchFetch(allSymbols, '/stable/quote', apiKey),
  ]);

  // ── 3. Calculate squeeze metrics for every stock ──
  interface SqueezeResult {
    symbol: string;
    companyName: string;
    sector: string;
    price: number;
    marketCap: number;
    floatShares: number;
    volume: number;
    avgVolume: number;
    rotation: number;
    triggerPrice: number;
    triggeredAt: string;
    squeezeTier: SqueezeTier;
    squeezeScore: number;
    volSurge: number;
  }

  const now = new Date();
  const triggeredAt = now.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const results: SqueezeResult[] = [];
  let scanned = 0;

  for (const stock of valid) {
    const sym = stock.symbol;
    const profile = profileMap.get(sym);
    const quote = quoteMap.get(sym);

    // Get float: profile → quote → skip
    const floatShares =
      profile?.floatShares || profile?.sharesFloat ||
      quote?.sharesOutstanding || 0;

    if (!floatShares || floatShares <= 0 || floatShares > maxFloat) continue;

    // Get volume: quote (real-time) → screener (delayed)
    const volume = quote?.volume || stock.volume || 0;
    const avgVolume = quote?.avgVolume || 0;
    const currentPrice = quote?.price || stock.price;
    const dayHigh = quote?.dayHigh || currentPrice;

    scanned++;
    if (volume <= 0) continue;

    const rotation = volume / floatShares;
    if (rotation < minRotation) continue;

    const tier = squeezeTier(rotation, floatShares);
    if (!tier) continue;

    const score = squeezeScore(rotation, floatShares);
    const volSurge = avgVolume > 0 ? volume / avgVolume : 0;

    results.push({
      symbol: sym,
      companyName: stock.companyName || profile?.companyName || sym,
      sector: stock.sector || profile?.sector || '',
      price: currentPrice,
      marketCap: stock.marketCap || profile?.mktCap || 0,
      floatShares,
      volume,
      avgVolume,
      rotation,
      triggerPrice: dayHigh,
      triggeredAt,
      squeezeTier: tier,
      squeezeScore: score,
      volSurge,
    });
  }

  // Sort by squeeze score desc, then rotation desc
  results.sort((a, b) => b.squeezeScore - a.squeezeScore || b.rotation - a.rotation);

  return NextResponse.json({
    results,          // NO cap — return all qualifying squeezes
    total: valid.length,
    scanned,
  });
}
