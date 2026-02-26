import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public paths — always accessible
const isPublicPath = createRouteMatcher([
  '/',
  '/login(.*)',
  '/register(.*)',
  '/admin(.*)',
  '/sso-callback(.*)',
  '/marketing(.*)',
  '/privacy(.*)',
  '/terms(.*)',
  '/cookies(.*)',
  '/api/(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Public paths: always allow
  if (isPublicPath(req)) return NextResponse.next();

  // Everything else requires login + plan > free
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  // Clerk exposes publicMetadata in session claims
  const meta = (sessionClaims as any)?.metadata ?? (sessionClaims as any)?.publicMetadata ?? {};
  const plan = (meta?.plan as string) ?? 'free';

  if (plan === 'free') {
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
