'use client';

import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { PrismoIcon } from './Logo';

/**
 * Lightweight client island for the landing page.
 * Only this component ships Clerk's client JS — the rest of the page is server-rendered.
 */
export default function LandingAuthSection({ section }: { section: 'header' | 'cta' }) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const plan = (user?.publicMetadata?.plan as string) ?? 'free';
  const hasAccess = plan !== 'free';

  useEffect(() => {
    if (isLoaded && user && hasAccess) {
      router.replace('/analizar');
    }
  }, [isLoaded, user, hasAccess, router]);

  const isWaitlisted = isLoaded && user && !hasAccess;

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
  return isWaitlisted ? (
    <div className="bg-black/80 border border-green-900/20 rounded-2xl p-8 text-center">
      <div className="w-12 h-12 mx-auto mb-4">
        <PrismoIcon className="w-12 h-12" innerClassName="text-base" />
      </div>
      <p className="text-white font-semibold mb-1">
        Hola, {user.firstName || user.emailAddresses[0]?.emailAddress}
      </p>
      <p className="text-gray-400 text-sm mb-6">
        Estas en la lista de espera. Te notificaremos cuando tu acceso este listo.
      </p>
      <button
        onClick={() => signOut()}
        className="text-xs text-gray-600 hover:text-gray-400 transition"
      >
        Cerrar sesion
      </button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-4">
      <Link
        href="/register"
        className="px-8 py-3.5 bg-linear-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold rounded-xl transition text-sm shadow-lg shadow-emerald-500/20"
      >
        Unirse a la lista de espera
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
