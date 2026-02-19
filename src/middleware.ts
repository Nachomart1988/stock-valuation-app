import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  '/',
  '/login(.*)',
  '/register(.*)',
  '/admin(.*)',
  '/pricing(.*)',
  '/sso-callback(.*)',
  '/api/stripe/webhook(.*)',
  '/market-sentiment(.*)',
  '/analizar(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // All routes are public — we handle access control in the components
  // No routes are force-protected here
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
