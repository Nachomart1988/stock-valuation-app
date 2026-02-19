import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY;

export async function POST(req: NextRequest) {
  // Verify admin secret
  const authHeader = req.headers.get('x-admin-key');
  if (!ADMIN_SECRET || authHeader !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email, plan } = await req.json();

  if (!email || !plan) {
    return NextResponse.json({ error: 'email and plan are required' }, { status: 400 });
  }

  const validPlans = ['free', 'pro', 'elite', 'gold'];
  if (!validPlans.includes(plan)) {
    return NextResponse.json({ error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` }, { status: 400 });
  }

  try {
    const client = await clerkClient();

    // Find user by email
    const users = await client.users.getUserList({ emailAddress: [email] });
    if (!users.data || users.data.length === 0) {
      return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 });
    }

    const user = users.data[0];

    // Update publicMetadata
    await client.users.updateUserMetadata(user.id, {
      publicMetadata: { plan },
    });

    return NextResponse.json({
      success: true,
      userId: user.id,
      email: user.emailAddresses[0]?.emailAddress,
      plan,
    });
  } catch (err: any) {
    console.error('[admin/set-plan]', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
