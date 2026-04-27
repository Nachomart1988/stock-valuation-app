import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * GET /api/earnings-alarm/send
 * Cron-compatible endpoint: finds all alarms for today that haven't been
 * notified yet and sends reminder emails via Resend.
 *
 * Protect with a CRON_SECRET query param in production.
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const resend = new Resend(resendKey);
  const today = new Date().toISOString().slice(0, 10);

  // Fetch pending alarms for today
  const { data: alarms, error } = await supabase
    .from('earnings_alarms')
    .select('*')
    .eq('earnings_date', today)
    .eq('notified', false);

  if (error) {
    console.error('[earnings-alarm/send] Fetch error:', error);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!alarms || alarms.length === 0) {
    return NextResponse.json({ sent: 0, message: 'No pending alarms for today' });
  }

  let sentCount = 0;
  const errors: string[] = [];

  for (const alarm of alarms) {
    try {
      const epsLine = alarm.eps_estimated != null
        ? `EPS Estimated: $${Number(alarm.eps_estimated).toFixed(2)}`
        : '';
      const revLine = alarm.revenue_estimated != null
        ? `Revenue Estimated: $${(Number(alarm.revenue_estimated) / 1e6).toFixed(0)}M`
        : '';

      await resend.emails.send({
        from: 'Prismo Alerts <alerts@prismo.us>',
        to: alarm.email,
        subject: `Earnings Alert: ${alarm.symbol} reports today`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0a0a0a; color: #e5e5e5; border-radius: 12px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="font-size: 24px; font-weight: 800; color: #fff; margin: 0;">PRISMO</h1>
              <p style="font-size: 12px; color: #737373; margin-top: 4px;">Earnings Alert</p>
            </div>
            <div style="background: #171717; border: 1px solid #262626; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <h2 style="font-size: 20px; font-weight: 700; color: #f59e0b; margin: 0 0 8px;">
                ${alarm.symbol}
              </h2>
              <p style="font-size: 14px; color: #a3a3a3; margin: 0 0 12px;">
                Reports earnings today — ${alarm.earnings_date}
              </p>
              ${epsLine ? `<p style="font-size: 13px; color: #d4d4d4; margin: 4px 0;"><strong>EPS Est:</strong> $${Number(alarm.eps_estimated).toFixed(2)}</p>` : ''}
              ${revLine ? `<p style="font-size: 13px; color: #d4d4d4; margin: 4px 0;"><strong>Rev Est:</strong> $${(Number(alarm.revenue_estimated) / 1e6).toFixed(0)}M</p>` : ''}
            </div>
            <div style="text-align: center;">
              <a href="https://prismo.us/analizar?ticker=${alarm.symbol}" style="display: inline-block; padding: 10px 24px; background: #f59e0b; color: #000; font-weight: 700; font-size: 13px; border-radius: 8px; text-decoration: none;">
                Analyze ${alarm.symbol} on Prismo
              </a>
            </div>
            <p style="font-size: 11px; color: #525252; text-align: center; margin-top: 24px;">
              You received this because you set an earnings alert on Prismo.
            </p>
          </div>
        `,
      });

      // Mark as notified
      await supabase
        .from('earnings_alarms')
        .update({ notified: true })
        .eq('email', alarm.email)
        .eq('symbol', alarm.symbol)
        .eq('earnings_date', alarm.earnings_date);

      sentCount++;
    } catch (err: any) {
      errors.push(`${alarm.symbol}→${alarm.email}: ${err.message}`);
    }
  }

  return NextResponse.json({
    sent: sentCount,
    total: alarms.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
