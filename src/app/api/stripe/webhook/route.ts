import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPlanByPriceId } from '@/lib/stripe';
import Stripe from 'stripe';

export const runtime = 'nodejs';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

/** Update Clerk user's publicMetadata.plan via Clerk Backend API */
async function updateClerkUserPlan(clerkUserId: string, plan: string) {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey || !clerkUserId) return;

  await fetch(`https://api.clerk.com/v1/users/${clerkUserId}/metadata`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ public_metadata: { plan } }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const clerkUserId = session.metadata?.clerkUserId || session.client_reference_id;

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0].price.id;
        const plan = getPlanByPriceId(priceId) || 'pro';

        console.log('[Webhook] checkout.session.completed:', { clerkUserId, plan });
        if (clerkUserId) {
          await updateClerkUserPlan(clerkUserId, plan);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const clerkUserId = subscription.metadata?.clerkUserId;
        const priceId = subscription.items.data[0].price.id;
        const plan = getPlanByPriceId(priceId) || 'pro';

        console.log('[Webhook] subscription.updated:', { clerkUserId, plan, status: subscription.status });
        if (clerkUserId && subscription.status === 'active') {
          await updateClerkUserPlan(clerkUserId, plan);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const clerkUserId = subscription.metadata?.clerkUserId;

        console.log('[Webhook] subscription.deleted:', { clerkUserId });
        if (clerkUserId) {
          await updateClerkUserPlan(clerkUserId, 'free');
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log('[Webhook] payment_failed:', { customerId: invoice.customer });
        // Optionally notify user — plan stays active until subscription.deleted
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('[Webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }
}
