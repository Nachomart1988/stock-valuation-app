// Stripe configuration and utilities
// Install: npm install stripe @stripe/stripe-js

import Stripe from 'stripe';

// Server-side Stripe instance (lazy initialization to avoid build errors)
let stripeInstance: Stripe | null = null;

export function getStripeInstance(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripeInstance = new Stripe(secretKey, {
      apiVersion: '2026-01-28.clover',
      typescript: true,
    });
  }
  return stripeInstance;
}

// For backward compatibility
export const stripe = {
  get checkout() { return getStripeInstance().checkout; },
  get billingPortal() { return getStripeInstance().billingPortal; },
  get subscriptions() { return getStripeInstance().subscriptions; },
  get webhooks() { return getStripeInstance().webhooks; },
};

// Plan configuration with Stripe Price IDs
export const PLANS = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    stripePriceIdMonthly: null,
    stripePriceIdAnnual: null,
    features: [
      'Inicio y Estados Financieros completos',
      'Info General (análisis general)',
      'Competidores',
      'Inputs básicos (SGR y Beta)',
      'DCF básico + DDMs, Advance DCF',
    ],
  },
  pro: {
    name: 'Pro',
    priceMonthly: 29,
    priceAnnual: 290,
    stripePriceIdMonthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || 'price_pro_monthly',
    stripePriceIdAnnual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || 'price_pro_annual',
    features: [
      'Todo lo de Free',
      'Todas las pestañas de análisis',
      '20+ modelos de valuación completos',
      'Forecasts, Noticias, Holders, WACC, CAGR',
      'Probabilidad y árbol binomial',
      'Market Sentiment Analysis',
      'Soporte prioritario',
    ],
  },
  elite: {
    name: 'Elite',
    priceMonthly: 59,
    priceAnnual: 590,
    stripePriceIdMonthly: process.env.STRIPE_ELITE_MONTHLY_PRICE_ID || 'price_elite_monthly',
    stripePriceIdAnnual: process.env.STRIPE_ELITE_ANNUAL_PRICE_ID || 'price_elite_annual',
    features: [
      'Todo lo de Pro',
      'Diario del Inversor',
      'Resumen Maestro Neural (IA)',
      'Descarga de análisis en PDF',
      'Soporte VIP (respuesta <2h)',
    ],
  },
  gold: {
    name: 'Gold',
    priceMonthly: 100,
    priceAnnual: 1000,
    stripePriceIdMonthly: process.env.STRIPE_GOLD_MONTHLY_PRICE_ID || 'price_gold_monthly',
    stripePriceIdAnnual: process.env.STRIPE_GOLD_ANNUAL_PRICE_ID || 'price_gold_annual',
    features: [
      'Todo lo de Elite',
      'Acceso Early Beta (nuevas features)',
      'Resumen mensual del mercado',
      'Soporte VIP <2h garantizado',
    ],
  },
} as const;

export type PlanType = keyof typeof PLANS;

// Helper to get plan by Stripe price ID
export function getPlanByPriceId(priceId: string): PlanType | null {
  for (const [planKey, plan] of Object.entries(PLANS)) {
    if (
      plan.stripePriceIdMonthly === priceId ||
      plan.stripePriceIdAnnual === priceId
    ) {
      return planKey as PlanType;
    }
  }
  return null;
}

// Create Stripe Checkout Session
export async function createCheckoutSession({
  priceId,
  customerId,
  successUrl,
  cancelUrl,
}: {
  priceId: string;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    customer: customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'required',
  });

  return session;
}

// Create Stripe Customer Portal Session
export async function createPortalSession({
  customerId,
  returnUrl,
}: {
  customerId: string;
  returnUrl: string;
}) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session;
}

// Get subscription status
export async function getSubscription(subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return subscription;
}

// Cancel subscription
export async function cancelSubscription(subscriptionId: string) {
  const subscription = await stripe.subscriptions.cancel(subscriptionId);
  return subscription;
}
