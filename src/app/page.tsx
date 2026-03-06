import Link from 'next/link';
import Logo from './components/Logo';
import LandingAuthSection from './components/LandingAuthSection';

export default function ComingSoonPage() {
  return (
    <div className="min-h-screen bg-black/80 text-white flex flex-col">
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between border-b border-gray-900">
        <Logo size="md" showText linkTo="/" />
        {/* Auth buttons rendered as client island */}
        <LandingAuthSection section="header" />
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

          {/* Auth-dependent CTA — client island */}
          <LandingAuthSection section="cta" />

          {/* Bottom dots */}
          <div className="flex justify-center gap-2 mt-16">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-black/50" />
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
