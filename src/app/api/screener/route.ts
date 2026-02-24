import { NextRequest, NextResponse } from 'next/server';

// GET /api/screener?[filters without apikey]
// Server-side proxy to FMP — keeps API key server-only and avoids CORS/plan issues
export async function GET(req: NextRequest) {
  const apiKey =
    process.env.FMP_API_KEY ??
    process.env.NEXT_PUBLIC_FMP_API_KEY ??
    '';

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  // Forward all query params from the client and inject the key server-side
  const incoming = new URL(req.url).searchParams;
  const params = new URLSearchParams(incoming);
  params.set('apikey', apiKey);

  const endpoints = [
    `https://financialmodelingprep.com/api/v3/stock-screener?${params}`,
    `https://financialmodelingprep.com/stable/company-screener?${params}`,
    `https://financialmodelingprep.com/stable/stock-screener?${params}`,
  ];

  let lastStatus = 0;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // try next endpoint
    }
  }

  return NextResponse.json(
    { error: `FMP screener returned HTTP ${lastStatus}` },
    { status: lastStatus || 502 }
  );
}
