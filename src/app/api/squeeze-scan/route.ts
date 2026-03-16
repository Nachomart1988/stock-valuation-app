import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FMP_BASE = 'https://financialmodelingprep.com';
const SCAN_CONCURRENCY = 8;
const MAX_STOCKS = 800;

/* ── Squeeze score tiers ─────────────────────────────────────── */
type SqueezeTier = 'POWER' | 'EXTREME' | 'STRONG' | 'MODERATE';

function squeezeTier(rotation: number, floatShares: number): SqueezeTier | null {
  const fM = floatShares / 1e6; // float in millions
  if (rotation >= 30 && fM <= 10) return 'POWER';
  if (rotation >= 20 && fM <= 25) return 'EXTREME';
  if (rotation >= 15 && fM <= 50) return 'STRONG';
  if (rotation >= 10 && fM <= 100) return 'MODERATE';
  // fallback: extremely high rotation alone qualifies
  if (rotation >= 40) return 'POWER';
  if (rotation >= 25) return 'EXTREME';
  if (rotation >= 15) return 'STRONG';
  if (rotation >= 8) return 'MODERATE';
  return null;
}

function squeezeScore(rotation: number, floatShares: number): number {
  const fM = floatShares / 1e6;
  // Base score from rotation (log scale to avoid huge outliers)
  let score = Math.min(60, Math.log2(rotation + 1) * 10);
  // Float bonus: smaller float → higher score
  if (fM <= 5) score += 30;
  else if (fM <= 15) score += 22;
  else if (fM <= 30) score += 15;
  else if (fM <= 50) score += 10;
  else if (fM <= 100) score += 5;
  // Extra bonus for extreme combos
  if (rotation >= 30 && fM <= 10) score += 10;
  return Math.min(100, Math.round(score));
}

/* ── Helpers ──────────────────────────────────────────────────── */
function fmtFloat(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
  }

  const sp = new URL(req.url).searchParams;
  const priceMin = sp.get('priceMin') || '0.5';
  const priceMax = sp.get('priceMax') || '50';
  const marketCapMax = sp.get('marketCapMax') || '2000000000'; // default $2B cap
  const country = sp.get('country') || 'US';
  const sector = sp.get('sector') || '';
  const minRotation = parseFloat(sp.get('minRotation') || '8');
  const maxFloat = sp.get('maxFloat') || '100000000'; // 100M shares default

  // 1. Get universe of small/micro-cap stocks (squeeze candidates)
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
    if (s.symbol.includes('.') || s.symbol.includes('-')) return false;
    if (seen.has(s.symbol)) return false;
    seen.add(s.symbol);
    return true;
  });

  if (valid.length === 0) {
    return NextResponse.json({ results: [], total: 0, scanned: 0 });
  }

  // 2. For each stock, fetch float + quote (volume) and compute squeeze metrics
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
    volSurge: number; // volume vs avg volume ratio
  }

  const results: SqueezeResult[] = [];
  let scanned = 0;

  const analyzeStock = async (stock: any) => {
    try {
      // Fetch float data
      const floatRes = await fetch(
        `${FMP_BASE}/api/v4/shares_float?symbol=${stock.symbol}&apikey=${apiKey}`,
        { cache: 'no-store' }
      );
      let floatShares = 0;
      if (floatRes.ok) {
        const floatData = await floatRes.json();
        if (Array.isArray(floatData) && floatData.length > 0) {
          floatShares = floatData[0].floatShares || floatData[0].float || 0;
        } else if (floatData && typeof floatData === 'object') {
          floatShares = floatData.floatShares || floatData.float || 0;
        }
      }

      // If no float data from shares_float, try profile
      if (!floatShares) {
        const profileRes = await fetch(
          `${FMP_BASE}/stable/profile?symbol=${stock.symbol}&apikey=${apiKey}`,
          { cache: 'no-store' }
        );
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          const p = Array.isArray(profileData) ? profileData[0] : profileData;
          if (p) floatShares = p.floatShares || p.sharesFloat || 0;
        }
      }

      if (!floatShares || floatShares <= 0) return;
      if (floatShares > parseFloat(maxFloat)) return;

      // Fetch quote for current volume + avg volume
      const quoteRes = await fetch(
        `${FMP_BASE}/stable/quote?symbol=${stock.symbol}&apikey=${apiKey}`,
        { cache: 'no-store' }
      );
      let volume = 0;
      let avgVolume = 0;
      let currentPrice = stock.price;
      let dayHigh = stock.price;
      if (quoteRes.ok) {
        const quoteData = await quoteRes.json();
        const q = Array.isArray(quoteData) ? quoteData[0] : quoteData;
        if (q) {
          volume = q.volume || 0;
          avgVolume = q.avgVolume || 0;
          currentPrice = q.price || stock.price;
          dayHigh = q.dayHigh || currentPrice;
        }
      }

      scanned++;

      if (volume <= 0) return;

      const rotation = volume / floatShares;
      if (rotation < minRotation) return;

      const tier = squeezeTier(rotation, floatShares);
      if (!tier) return;

      const score = squeezeScore(rotation, floatShares);
      const volSurge = avgVolume > 0 ? volume / avgVolume : 0;

      // Trigger price = day high (the breakout level)
      // Triggered at = now (when the scan detects it)
      const now = new Date();
      const triggeredAt = now.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      results.push({
        symbol: stock.symbol,
        companyName: stock.companyName || stock.symbol,
        sector: stock.sector || '',
        price: currentPrice,
        marketCap: stock.marketCap || 0,
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
    } catch { /* skip failed tickers */ }
  };

  // Process in waves
  for (let i = 0; i < valid.length; i += SCAN_CONCURRENCY) {
    const wave = valid.slice(i, i + SCAN_CONCURRENCY);
    await Promise.all(wave.map(analyzeStock));
  }

  // Sort by squeeze score descending
  results.sort((a, b) => b.squeezeScore - a.squeezeScore || b.rotation - a.rotation);

  return NextResponse.json({
    results: results.slice(0, 50),
    total: valid.length,
    scanned,
  });
}
