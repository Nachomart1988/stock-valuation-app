'use client';

import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import Logo, { PrismoIcon } from './components/Logo';

export default function ComingSoonPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const plan = (user?.publicMetadata?.plan as string) ?? 'free';
  const hasAccess = plan !== 'free';

  // If user has a plan > free, redirect to /analizar
  useEffect(() => {
    if (isLoaded && user && hasAccess) {
      router.replace('/analizar');
    }
  }, [isLoaded, user, hasAccess, router]);

  const isWaitlisted = isLoaded && user && !hasAccess;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between border-b border-gray-900">
        <Logo size="md" showText linkTo="/" />
        <div className="flex items-center gap-3">
          {isLoaded && !user && (
            <Link
              href="/login"
              className="text-sm text-gray-400 hover:text-white transition px-4 py-2 rounded-lg hover:bg-gray-800"
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
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-lg w-full text-center">
          {/* Ambient dots */}
          <div className="flex justify-center gap-2 mb-10">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-emerald-500/40"
                style={{ opacity: 0.3 + i * 0.15 }}
              />
            ))}
          </div>

          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-8 text-xs text-emerald-400 font-medium tracking-wide uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Acceso anticipado &middot; Beta privada
          </div>

          {/* Title */}
          <h1 className="text-6xl sm:text-8xl font-black mb-4 bg-linear-to-b from-white to-gray-400 bg-clip-text text-transparent tracking-tight">
            PRISMO
          </h1>
          <p className="text-2xl sm:text-3xl font-bold text-gray-300 mb-4">
            Proximamente
          </p>
          <p className="text-gray-500 mb-10 leading-relaxed max-w-sm mx-auto">
            El primer multimodelo de valuacion{' '}
            <span className="text-emerald-400">fully customizable</span>.
            Acceso anticipado disponible por invitacion.
          </p>

          {/* Conditional: waitlisted user vs anonymous */}
          {isWaitlisted ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
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
              {/* Primary CTA */}
              <Link
                href="/register"
                className="px-8 py-3.5 bg-linear-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold rounded-xl transition text-sm shadow-lg shadow-emerald-500/20"
              >
                Unirse a la lista de espera
              </Link>

              {/* Secondary: already have account */}
              {isLoaded && !user && (
                <Link
                  href="/login"
                  className="text-sm text-gray-500 hover:text-gray-300 transition"
                >
                  Ya tengo cuenta
                </Link>
              )}
            </div>
          )}

          {/* Bottom dots */}
          <div className="flex justify-center gap-2 mt-16">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-gray-700" />
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-gray-900 text-center">
        <p className="text-xs text-gray-700">
          &copy; 2025 Prismo &middot;{' '}
          <Link href="/privacy" className="hover:text-gray-500 transition">Privacidad</Link>
          {' &middot; '}
          <Link href="/terms" className="hover:text-gray-500 transition">Terminos</Link>
          {' &middot; '}
          <Link href="/admin" className="hover:text-gray-500 transition">Admin</Link>
        </p>
      </footer>
    </div>
  );
}
