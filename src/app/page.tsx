'use client';

import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo, { PrismoIcon } from './components/Logo';

export default function ComingSoonPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const plan = (user?.publicMetadata?.plan as string) ?? 'free';
  const hasAccess = plan !== 'free';

  // If user has a plan > free, redirect to /analizar
  useEffect(() => {
    if (isLoaded && user && hasAccess) {
      router.replace('/analizar');
    }
  }, [isLoaded, user, hasAccess, router]);

  const isWaitlisted = isLoaded && user && !hasAccess;

  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // silent — show success regardless
    }
    setSubmitted(true);
    setSubmitting(false);
  };

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
            <>
              {/* Waitlist email capture */}
              {!submitted ? (
                <form onSubmit={handleWaitlist} className="flex gap-2 mb-6 max-w-sm mx-auto">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    className="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition text-sm disabled:opacity-50"
                  >
                    {submitting ? '...' : 'Unirse'}
                  </button>
                </form>
              ) : (
                <p className="text-emerald-400 text-sm mb-6 font-medium">
                  Listo, te avisamos cuando abra el acceso.
                </p>
              )}

              {/* Auth CTAs */}
              {isLoaded && !user && (
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href="/register"
                    className="px-6 py-3 bg-linear-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-semibold rounded-xl transition text-sm"
                  >
                    Crear cuenta
                  </Link>
                  <Link
                    href="/login"
                    className="px-6 py-3 border border-gray-700 hover:border-gray-600 text-gray-300 hover:text-white rounded-xl transition text-sm"
                  >
                    Ya tengo cuenta
                  </Link>
                </div>
              )}
            </>
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
        </p>
      </footer>
    </div>
  );
}
