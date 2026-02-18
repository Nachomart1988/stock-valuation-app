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
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { data, error } = await db
      .from('diary_data')
      .select('trades, weekly_pl, pta, balance')
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
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await req.json();
    const { trades, weekly_pl, pta, balance } = body;

    const { error } = await db
      .from('diary_data')
      .upsert(
        {
          user_id: userId,
          trades: trades ?? [],
          weekly_pl: weekly_pl ?? [],
          pta: pta ?? [],
          balance: balance ?? 10000,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

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
