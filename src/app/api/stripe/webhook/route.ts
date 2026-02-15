import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPlanByPriceId } from '@/lib/stripe';
import Stripe from 'stripe';

// Disable body parsing, we need the raw body for webhook verification
export const runtime = 'nodejs';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return NextResponse.json(
        { error: `Webhook Error: ${err.message}` },
        { status: 400 }
      );
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );

        const priceId = subscription.items.data[0].price.id;
        const plan = getPlanByPriceId(priceId);

        console.log('Checkout completed:', {
          customerId: session.customer,
          subscriptionId: session.subscription,
          plan,
        });

        // TODO: Update user in database with subscription details
        // await updateUserSubscription({
        //   stripeCustomerId: session.customer,
        //   stripeSubscriptionId: session.subscription,
        //   plan,
        //   status: 'active',
        // });

        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const priceId = subscription.items.data[0].price.id;
        const plan = getPlanByPriceId(priceId);

        console.log('Subscription updated:', {
          customerId: subscription.customer,
          subscriptionId: subscription.id,
          status: subscription.status,
          plan,
        });

        // TODO: Update subscription status in database
        // await updateUserSubscription({
        //   stripeSubscriptionId: subscription.id,
        //   plan,
        //   status: subscription.status,
        // });

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        console.log('Subscription cancelled:', {
          customerId: subscription.customer,
          subscriptionId: subscription.id,
        });

        // TODO: Update user to free plan in database
        // await updateUserSubscription({
        //   stripeSubscriptionId: subscription.id,
        //   plan: 'free',
        //   status: 'cancelled',
        // });

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;

        console.log('Payment failed:', {
          customerId: invoice.customer,
          invoiceId: invoice.id,
        });

        // TODO: Notify user of payment failure
        // await sendPaymentFailedEmail(invoice.customer_email);

        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;

        console.log('Payment succeeded:', {
          customerId: invoice.customer,
          invoiceId: invoice.id,
          amountPaid: invoice.amount_paid,
        });

        // TODO: Record payment in database
        // await recordPayment({
        //   stripeCustomerId: invoice.customer,
        //   invoiceId: invoice.id,
        //   amount: invoice.amount_paid,
        // });

        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}
