import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'email required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      // Supabase not configured — log and return success silently
      console.log('[waitlist] email captured (no DB):', email);
      return NextResponse.json({ ok: true });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase
      .from('waitlist')
      .upsert({ email: email.toLowerCase().trim() }, { onConflict: 'email' });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // silent success to prevent enumeration
  }
}
