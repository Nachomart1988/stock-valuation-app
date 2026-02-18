'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

function SubscriptionSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate verification - in production, verify session with Stripe
    const timer = setTimeout(() => {
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [sessionId]);

  return (
    <div className="max-w-md w-full text-center">
      {loading ? (
        <div className="space-y-6">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-green-500 border-t-transparent mx-auto"></div>
          <h1 className="text-2xl font-bold">Procesando tu suscripción...</h1>
          <p className="text-gray-400">Por favor espera un momento</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Success Icon */}
          <div className="w-24 h-24 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
            <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <div>
            <h1 className="text-3xl font-bold mb-3">
              ¡Suscripción Activada!
            </h1>
            <p className="text-gray-400">
              Tu pago ha sido procesado exitosamente. Ahora tienes acceso completo a todas las funcionalidades.
            </p>
          </div>

          {/* Features unlocked */}
          <div className="bg-gray-800/50 rounded-2xl p-6 border border-gray-700">
            <h3 className="font-semibold mb-4 text-green-400">Funcionalidades Desbloqueadas:</h3>
            <ul className="space-y-2 text-left">
              {[
                'Análisis ilimitados',
                'Todas las 21+ pestañas',
                'Resumen Neural con IA',
                '20+ modelos de valuación',
                'Exportación PDF + Excel',
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-gray-300">
                  <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/analizar"
              className="px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-green-500/25"
            >
              Comenzar a Analizar
            </Link>
            <Link
              href="/account"
              className="px-8 py-4 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl transition"
            >
              Ver Mi Cuenta
            </Link>
          </div>

          {/* Support note */}
          <p className="text-sm text-gray-500">
            ¿Tienes preguntas? Contacta a nuestro{' '}
            <Link href="/contact" className="text-green-400 hover:text-green-300">
              soporte prioritario
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="max-w-md w-full text-center space-y-6">
      <div className="animate-spin rounded-full h-16 w-16 border-4 border-green-500 border-t-transparent mx-auto"></div>
      <h1 className="text-2xl font-bold">Cargando...</h1>
    </div>
  );
}

export default function SubscriptionSuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 text-white flex items-center justify-center px-4">
      <Suspense fallback={<LoadingFallback />}>
        <SubscriptionSuccessContent />
      </Suspense>
    </div>
  );
}
