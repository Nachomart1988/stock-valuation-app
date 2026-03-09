'use client';

import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Lightweight client island for auth-aware landing page elements.
 * Only this component ships Clerk's client JS — the rest of the page is server-rendered.
 */
export default function LandingAuthSection({ section }: { section: 'header' | 'cta' }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  // Authenticated users visiting the landing page get redirected to the app
  useEffect(() => {
    if (isLoaded && user) {
      router.replace('/analizar');
    }
  }, [isLoaded, user, router]);

  if (section === 'header') {
    return (
      <div className="flex items-center gap-3">
        {isLoaded && !user && (
          <Link
            href="/login"
            className="text-sm text-gray-400 hover:text-white transition px-4 py-2 rounded-lg hover:bg-black/60"
          >
            Iniciar sesion
          </Link>
        )}
        {isLoaded && user && (
          <button
            onClick={() => signOut()}
            className="text-sm text-gray-500 hover:text-gray-300 transition"
          >
            Cerrar sesion
          </button>
        )}
      </div>
    );
  }

  // section === 'cta'
  return (
    <div className="flex flex-col items-center gap-4">
      <Link
        href="/register"
        className="px-8 py-3.5 bg-linear-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold rounded-xl transition text-sm shadow-lg shadow-emerald-500/20"
      >
        Crear cuenta
      </Link>
      {isLoaded && !user && (
        <Link
          href="/login"
          className="text-sm text-gray-500 hover:text-gray-300 transition"
        >
          Ya tengo cuenta
        </Link>
      )}
    </div>
  );
}
