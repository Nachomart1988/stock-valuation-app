'use client';

import Link from 'next/link';
import Header from '../components/Header';

const faqs = [
  {
    q: '¿Qué datos se usan para el análisis?',
    a: 'Prismo usa datos de Financial Modeling Prep (FMP) para estados financieros, precios, y datos fundamentales. Para análisis técnico intraday usamos Yahoo Finance.',
  },
  {
    q: '¿Con qué frecuencia se actualizan los datos?',
    a: 'Los datos de mercado y precios se actualizan en tiempo real. Los estados financieros se actualizan trimestralmente siguiendo el ciclo de reportes.',
  },
  {
    q: '¿Puedo analizar acciones internacionales?',
    a: 'Actualmente Prismo está optimizado para acciones listadas en NYSE y NASDAQ. El soporte para mercados internacionales está en desarrollo.',
  },
  {
    q: '¿Cómo cancelo mi suscripción?',
    a: 'Puedes cancelar desde el panel de tu cuenta en cualquier momento. El acceso continúa hasta el fin del período facturado.',
  },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 via-gray-800 to-gray-900 text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">Soporte</h1>
          <p className="text-gray-400 text-lg">¿Necesitas ayuda? Estamos aquí para ti.</p>
        </div>

        {/* Contact options */}
        <div className="grid md:grid-cols-3 gap-4 mb-12">
          <div className="p-6 rounded-2xl bg-gray-800/60 border border-gray-700/50 text-center">
            <div className="text-3xl mb-3">📧</div>
            <div className="font-bold mb-2">Email</div>
            <a href="mailto:support@prismo.app" className="text-emerald-400 hover:text-emerald-300 text-sm transition">
              support@prismo.app
            </a>
            <div className="text-xs text-gray-500 mt-2">Respuesta en 24-48h (Free/Pro)</div>
          </div>
          <div className="p-6 rounded-2xl bg-emerald-900/20 border border-emerald-700/30 text-center">
            <div className="text-3xl mb-3">⚡</div>
            <div className="font-bold mb-2">Soporte Prioritario</div>
            <a href="mailto:vip@prismo.app" className="text-emerald-400 hover:text-emerald-300 text-sm transition">
              vip@prismo.app
            </a>
            <div className="text-xs text-gray-500 mt-2">Elite / Gold — respuesta &lt;2h</div>
          </div>
          <div className="p-6 rounded-2xl bg-gray-800/60 border border-gray-700/50 text-center">
            <div className="text-3xl mb-3">📖</div>
            <div className="font-bold mb-2">Documentación</div>
            <Link href="/docs" className="text-emerald-400 hover:text-emerald-300 text-sm transition">
              Ver guías y docs →
            </Link>
            <div className="text-xs text-gray-500 mt-2">Fórmulas, tutoriales, FAQ</div>
          </div>
        </div>

        {/* Common questions */}
        <h2 className="text-xl font-bold mb-6">Preguntas Frecuentes</h2>
        <div className="space-y-4 mb-12">
          {faqs.map((faq) => (
            <div key={faq.q} className="p-5 rounded-2xl bg-gray-800/50 border border-gray-700/50">
              <div className="font-semibold mb-2 text-white">{faq.q}</div>
              <div className="text-sm text-gray-400">{faq.a}</div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <Link href="/faq" className="text-emerald-400 hover:text-emerald-300 transition inline-flex items-center gap-2">
            Ver todas las preguntas frecuentes →
          </Link>
        </div>
      </main>
    </div>
  );
}
