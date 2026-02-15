// Client-side Stripe utilities
// This file should only be imported in client components

import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null>;

export const getStripe = () => {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');
  }
  return stripePromise;
};

// Redirect to Stripe Checkout using URL (recommended approach)
// The checkout session URL is returned from the server API
export async function redirectToCheckout(checkoutUrl: string) {
  window.location.href = checkoutUrl;
}
