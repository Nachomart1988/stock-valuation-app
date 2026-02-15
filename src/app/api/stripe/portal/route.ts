import { NextRequest, NextResponse } from 'next/server';
import { createPortalSession } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    // TODO: Get customer ID from authenticated user session
    // const session = await getServerSession(authOptions);
    // const customerId = session?.user?.stripeCustomerId;

    const { customerId } = await request.json();

    if (!customerId) {
      return NextResponse.json(
        { error: 'Customer ID is required' },
        { status: 400 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const portalSession = await createPortalSession({
      customerId,
      returnUrl: `${baseUrl}/account`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error: any) {
    console.error('Portal session error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
