import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createAdminClient } from '@/lib/supabase';

// GET /api/diary — load all diary data for the current user
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createAdminClient();
    if (!db) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const detail = !url ? 'missing SUPABASE_URL' : !key ? 'missing SERVICE_ROLE_KEY' : 'invalid URL';
      console.error('[Diary API] DB client null —', detail);
      return NextResponse.json({ error: `Database not configured (${detail})` }, { status: 503 });
    }

    // select('*') es seguro aunque falten columnas nuevas (p. ej. cash_flows aún sin migrar)
    const { data, error } = await db
      .from('diary_data')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = row not found (normal for new users)
      console.error('[Diary API] GET error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      trades: data?.trades ?? [],
      weekly_pl: data?.weekly_pl ?? [],
      pta: data?.pta ?? [],
      balance: data?.balance ?? 10000,
      watchlist: data?.watchlist ?? [],
      cash_flows: data?.cash_flows ?? [],
    });
  } catch (e: any) {
    console.error('[Diary API] GET exception:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/diary — save all diary data for the current user (upsert)
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = createAdminClient();
    if (!db) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const detail = !url ? 'missing SUPABASE_URL' : !key ? 'missing SERVICE_ROLE_KEY' : 'invalid URL';
      console.error('[Diary API] DB client null —', detail);
      return NextResponse.json({ error: `Database not configured (${detail})` }, { status: 503 });
    }

    const body = await req.json();
    const { trades, weekly_pl, pta, balance, watchlist, cash_flows } = body;

    const baseRow = {
      user_id: userId,
      trades: trades ?? [],
      weekly_pl: weekly_pl ?? [],
      pta: pta ?? [],
      balance: balance ?? 10000,
      watchlist: watchlist ?? [],
      updated_at: new Date().toISOString(),
    };

    // Intento incluyendo cash_flows. Si la columna no existe todavía (sin migrar),
    // reintentamos sin ese campo para que el guardado NO falle nunca por eso.
    let { error } = await db
      .from('diary_data')
      .upsert({ ...baseRow, cash_flows: cash_flows ?? [] }, { onConflict: 'user_id' });

    if (error && /cash_flows/i.test(error.message || '')) {
      console.warn('[Diary API] columna cash_flows ausente — guardando sin ella (agregá la columna para sync cross-device)');
      ({ error } = await db
        .from('diary_data')
        .upsert(baseRow, { onConflict: 'user_id' }));
    }

    if (error) {
      console.error('[Diary API] PUT error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[Diary API] PUT exception:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
