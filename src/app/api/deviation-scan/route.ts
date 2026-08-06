import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const MA_PERIODS = [10, 20, 50, 100, 200];

export async function GET(req: NextRequest) {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
  const sp = new URL(req.url).searchParams;

  const rawMa = parseInt(sp.get('maPeriod') || '20', 10);
  const maPeriod = MA_PERIODS.includes(rawMa) ? rawMa : 20;
  const rawDir = sp.get('direction') || 'above';
  const direction = ['above', 'below', 'both'].includes(rawDir) ? rawDir : 'above';

  const params = new URLSearchParams({
    ma_period: String(maPeriod),
    direction,
    min_sigma: String(Math.abs(parseFloat(sp.get('minSigma') || '0') || 0)),
  });
  if (sp.get('priceMin')) params.set('price_min', sp.get('priceMin')!);
  if (sp.get('priceMax')) params.set('price_max', sp.get('priceMax')!);
  if (sp.get('marketCapMin')) params.set('mcap_min', sp.get('marketCapMin')!);
  if (sp.get('marketCapMax')) params.set('mcap_max', sp.get('marketCapMax')!);
  if (sp.get('sector')) params.set('sector', sp.get('sector')!);

  let data: any;
  try {
    const res = await fetch(`${backendUrl}/scanner-cache/deviation?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json({ error: body.detail || `Backend error (HTTP ${res.status})` }, { status: res.status });
    }
    data = await res.json();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backend unreachable' }, { status: 502 });
  }

  const status = data.status || {};
  if (!status.ready || !status.deviation_ready) {
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
    maPeriod: r.ma_period,
    ma: r.ma ?? 0,
    devSigma: r.dev_sigma ?? 0,
    devPct: r.dev_pct ?? 0,
    devAtr: r.dev_atr ?? null,
    maSlope: r.ma_slope ?? null,
    atr: r.atr ?? 0,
    atrPct: r.atr_pct ?? 0,
    rvol: r.rvol ?? 0,
    volume: r.volume ?? 0,
    avgVolume: r.avg_volume ?? 0,
    high52w: r.high_52w ?? 0,
    dropFromHighPct: r.drop_from_high_pct ?? 0,
    low52w: r.low_52w ?? 0,
    riseFromLowPct: r.rise_from_low_pct ?? 0,
  }));

  return NextResponse.json({
    results,
    total: status.row_count || results.length,
    scanned: status.row_count || results.length,
    lastRefresh: status.last_refresh || null,
    ageHours: status.age_hours ?? null,
  });
}
