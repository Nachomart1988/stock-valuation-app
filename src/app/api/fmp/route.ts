import { NextRequest, NextResponse } from 'next/server';

const FMP_BASE = 'https://financialmodelingprep.com';

export async function GET(req: NextRequest) {
  const apiKey = process.env.FMP_API_KEY;
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
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return NextResponse.json(data, { status: res.status });
    } catch {
      // FMP returned non-JSON (e.g. plain-text error message)
      return NextResponse.json({ error: text || 'FMP returned non-JSON response' }, { status: res.ok ? 200 : 502 });
    }
  } catch {
    return NextResponse.json({ error: 'FMP request failed' }, { status: 502 });
  }
}
