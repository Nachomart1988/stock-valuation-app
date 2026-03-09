import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public paths — always accessible (no Clerk auth required)
const isPublicPath = createRouteMatcher([
  '/',
  '/login(.*)',
  '/register(.*)',
  '/sso-callback(.*)',
  '/market-sentiment(.*)',
  '/marketing(.*)',
  '/privacy(.*)',
  '/terms(.*)',
  '/cookies(.*)',
  '/pricing(.*)',
  '/docs(.*)',
  '/faq(.*)',
  '/guides(.*)',
  '/blog(.*)',
  '/careers(.*)',
  '/press(.*)',
  '/support(.*)',
  '/licenses(.*)',
  '/api-info(.*)',
  // Public API routes
  '/api/waitlist',
  '/api/fmp',
  '/api/screener',
  '/api/prismo-top',
  '/api/stripe/webhook',
]);

export default clerkMiddleware(async (auth, req) => {
  // Public paths: always allow
  if (isPublicPath(req)) return NextResponse.next();

  // Protected paths: require authentication only.
  // Plan-level gating is handled client-side in page.tsx (avoids
  // a slow Clerk API round-trip on every navigation that was causing ~2.9s TTFB).
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
