import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com';

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY ?? process.env.NEXT_PUBLIC_FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });
  }

  const incoming = new URL(req.url).searchParams;
  const path = incoming.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path param' }, { status: 400 });
  }

  // Forward all params except 'path', inject apikey server-side
  const forwardParams = new URLSearchParams(incoming);
  forwardParams.delete('path');
  forwardParams.set('apikey', apiKey);

  const url = `${FMP_BASE}/${path}?${forwardParams.toString()}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'FMP request failed' }, { status: 502 });
  }
}
