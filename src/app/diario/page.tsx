'use client';

import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';
import Header from '@/app/components/Header';
import DiarioInversorTab from '@/app/components/tabs/DiarioInversorTab';

export default function DiarioPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />
      <SignedOut>
        <RedirectToSignIn redirectUrl="/diario" />
      </SignedOut>
      <SignedIn>
        <div className="pt-16">
          <DiarioInversorTab />
        </div>
      </SignedIn>
    </div>
  );
}
