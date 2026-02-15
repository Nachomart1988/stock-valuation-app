import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession, PLANS, PlanType } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const { plan, billingPeriod } = await request.json();

    // Validate plan
    if (!plan || !['pro', 'elite'].includes(plan)) {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      );
    }

    // Validate billing period
    if (!billingPeriod || !['monthly', 'annual'].includes(billingPeriod)) {
      return NextResponse.json(
        { error: 'Invalid billing period' },
        { status: 400 }
      );
    }

    const selectedPlan = PLANS[plan as PlanType];
    const priceId = billingPeriod === 'monthly'
      ? selectedPlan.stripePriceIdMonthly
      : selectedPlan.stripePriceIdAnnual;

    if (!priceId) {
      return NextResponse.json(
        { error: 'Price ID not configured' },
        { status: 500 }
      );
    }

    // TODO: Get customer ID from authenticated user session
    // const session = await getServerSession(authOptions);
    // const customerId = session?.user?.stripeCustomerId;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const checkoutSession = await createCheckoutSession({
      priceId,
      // customerId, // Uncomment when auth is implemented
      successUrl: `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/pricing`,
    });

    return NextResponse.json({ sessionId: checkoutSession.id, url: checkoutSession.url });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
