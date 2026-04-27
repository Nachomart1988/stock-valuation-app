import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * POST /api/earnings-alarm
 * Save an earnings alarm to Supabase.
 * Body: { email, symbol, date, epsEstimated?, revenueEstimated? }
 */
export async function POST(req: NextRequest) {
  try {
    const { email, symbol, date, epsEstimated, revenueEstimated } = await req.json();

    if (!email || !symbol || !date) {
      return NextResponse.json({ error: 'email, symbol, and date are required' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
      // No Supabase configured — log and return success silently
      console.log('[earnings-alarm] alarm saved (no DB):', { email, symbol, date });
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase.from('earnings_alarms').upsert(
      {
        email: email.toLowerCase().trim(),
        symbol: symbol.toUpperCase().trim(),
        earnings_date: date,
        eps_estimated: epsEstimated ?? null,
        revenue_estimated: revenueEstimated ?? null,
        notified: false,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'email,symbol,earnings_date' }
    );

    if (error) {
      console.error('[earnings-alarm] Supabase error:', error);
      // Still return success to not leak internals
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[earnings-alarm] Error:', err);
    return NextResponse.json({ ok: true }); // silent success
  }
}
