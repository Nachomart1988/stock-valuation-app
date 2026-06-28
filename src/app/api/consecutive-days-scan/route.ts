import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const sp = new URL(req.url).searchParams;

  const direction = (sp.get('direction') || 'red') === 'green' ? 'green' : 'red';
  const params = new URLSearchParams({
    direction,
    min_streak: String(Math.max(1, parseInt(sp.get('minStreak') || '5', 10) || 5)),
  });
  if (sp.get('priceMin')) params.set('price_min', sp.get('priceMin')!);
  if (sp.get('priceMax')) params.set('price_max', sp.get('priceMax')!);
  if (sp.get('marketCapMin')) params.set('mcap_min', sp.get('marketCapMin')!);
  if (sp.get('marketCapMax')) params.set('mcap_max', sp.get('marketCapMax')!);
  if (sp.get('sector')) params.set('sector', sp.get('sector')!);

  let data: any;
  try {
    const res = await fetch(`${backendUrl}/scanner-cache/consecutive-days?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json({ error: body.detail || `Backend error (HTTP ${res.status})` }, { status: res.status });
    }
    data = await res.json();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backend unreachable' }, { status: 502 });
  }

  const status = data.status || {};
  if (!status.ready) {
    return NextResponse.json({
      results: [], total: 0, scanned: 0,
      building: !!status.building,
      message: status.building ? 'cache_building' : 'cache_empty',
    });
  }

  const results = (data.results || []).map((r: any) => ({
    symbol: r.symbol,
    companyName: r.company_name || r.symbol,
    sector: r.sector || '',
    exchange: r.exchange || '',
    marketCap: r.market_cap || 0,
    currentPrice: r.price,
    direction: r.direction,
    streak: r.streak,
    atr: r.atr,
    atrPct: r.atr_pct,
    zscore: r.zscore,
    meanPrice: r.mean_price,
  }));

  return NextResponse.json({
    results,
    total: status.row_count || results.length,
    scanned: status.row_count || results.length,
    lastRefresh: status.last_refresh || null,
    ageHours: status.age_hours ?? null,
  });
}
