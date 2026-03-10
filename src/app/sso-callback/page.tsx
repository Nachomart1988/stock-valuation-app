'use client';

import { useEffect } from 'react';
import { useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { LogoLoader } from '@/app/components/ui/LogoLoader';

export default function SSOCallbackPage() {
  const { handleRedirectCallback } = useClerk();
  const router = useRouter();

  useEffect(() => {
    handleRedirectCallback({
      afterSignInUrl: '/',
      afterSignUpUrl: '/',
    }).catch(() => {
      router.push('/login');
    });
  }, [handleRedirectCallback, router]);

  return (
    <div className="min-h-screen bg-gray-900/80 flex items-center justify-center">
      <div className="text-center">
        <LogoLoader size="md" message="Completando autenticación..." />
      </div>
    </div>
  );
}
