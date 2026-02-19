import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('x-admin-key');
  if (!ADMIN_SECRET || authHeader !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');

  try {
    const client = await clerkClient();

    const params: any = { limit: 50, orderBy: '-created_at' };
    if (email) params.emailAddress = [email];

    const result = await client.users.getUserList(params);

    const users = result.data.map((u) => ({
      id: u.id,
      email: u.emailAddresses[0]?.emailAddress ?? '—',
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || '—',
      plan: (u.publicMetadata?.plan as string) || 'free',
      createdAt: new Date(u.createdAt).toLocaleDateString('es-AR'),
      imageUrl: u.imageUrl,
    }));

    return NextResponse.json({ users });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
