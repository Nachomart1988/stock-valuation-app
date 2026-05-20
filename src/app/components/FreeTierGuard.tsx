'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { type PlanTier } from '@/lib/plans';

interface FreeTierGuardProps {
  children: React.ReactNode;
  /** Identifier of the feature being blocked — surfaces in the upgrade banner copy */
  feature?: string;
}

/**
 * Blocks signed-in users on the FREE plan from rendering the wrapped page.
 * Signed-out users pass through (each page handles its own auth flow).
 * Free users are redirected to `/?upgrade=1&from=<feature>` where the landing
 * page shows an upgrade banner.
 */
export default function FreeTierGuard({ children, feature }: FreeTierGuardProps) {
  const router = useRouter();
  const { user, isLoaded, isSignedIn } = useUser();

  const plan = ((user?.publicMetadata?.plan as PlanTier) || 'free');
  const blocked = isLoaded && isSignedIn && plan === 'free';

  useEffect(() => {
    if (!blocked) return;
    const qs = feature ? `?upgrade=1&from=${encodeURIComponent(feature)}` : '?upgrade=1';
    router.replace(`/${qs}`);
  }, [blocked, feature, router]);

  if (!isLoaded || blocked) return null;
  return <>{children}</>;
}
