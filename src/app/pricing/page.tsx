'use client';

import { useState } from 'react';
import Link from 'next/link';
import Logo from '../components/Logo';
import LanguageSelector from '../components/LanguageSelector';
import { useLanguage } from '@/i18n/LanguageContext';

const plans = [
  {
    name: "Free",
    price: 0,
    annualPrice: 0,
    popular: false,
    features: [
      "5 análisis por día",
      "Pestañas básicas (General, Cálculos, Beta)",
      "Datos en tiempo real",
      "Soporte por email",
    ],
    limitations: [
      "Límite diario de 5 análisis",
      "Sin acceso a Resumen Neural",
      "Sin exportación PDF/Excel",
    ],
    cta: "Empezar Gratis",
    ctaLink: "/analizar",
  },
  {
    name: "Pro",
    price: 29,
    annualPrice: 290,
    popular: true,
    features: [
      "Análisis ilimitados",
      "Todas las 21+ pestañas",
      "Resumen Neural con IA",
      "20+ modelos de valuación",
      "Inputs personalizables en cada modelo",
      "Exportación PDF + Excel",
      "Market Sentiment Analysis",
      "Soporte prioritario",
    ],
    limitations: [],
    cta: "Elegir Pro",
    ctaLink: "/auth/sign-up?plan=pro",
  },
  {
    name: "Elite",
    price: 79,
    annualPrice: 790,
    popular: false,
    features: [
      "Todo lo del plan Pro",
      "API de acceso para integración",
      "Reportes mensuales personalizados",
      "Soporte VIP (respuesta <2h)",
      "Invitaciones a webinars privados",
      "Acceso anticipado a nuevas features",
      "Consultoría 1-on-1 mensual",
    ],
    limitations: [],
    cta: "Elegir Elite",
    ctaLink: "/auth/sign-up?plan=elite",
  },
];

const faqs = [
  {
    q: "¿Puedo cambiar de plan en cualquier momento?",
    a: "Sí, puedes actualizar o degradar tu plan cuando quieras. Los cambios se aplican inmediatamente y se prorratea el costo."
  },
  {
    q: "¿Qué métodos de pago aceptan?",
    a: "Aceptamos todas las tarjetas de crédito principales (Visa, Mastercard, American Express) y PayPal."
  },
  {
    q: "¿Hay garantía de devolución?",
    a: "Sí, ofrecemos 14 días de garantía de devolución sin preguntas en los planes pagos."
  },
  {
    q: "¿Cuántos modelos de valuación incluye?",
    a: "Incluimos más de 20 modelos: DDM (2-Stage, 3-Stage, H-Model), DCF, FCFE, FCFF, Graham, RIM Ohlson, Monte Carlo, Stochastic DCF, NK DSGE, HJM, y más."
  },
  {
    q: "¿Puedo exportar mis análisis?",
    a: "Los planes Pro y Elite incluyen exportación a PDF con el reporte completo y a Excel para análisis personalizado."
  },
];

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Logo size="md" />
          <div className="flex items-center gap-4">
            <LanguageSelector />
            <Link href="/" className="text-gray-400 hover:text-white transition">
              {t('nav.home')}
            </Link>
            <Link href="/analizar" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition">
              {t('hero.analyzeButton')}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-5xl md:text-6xl font-black mb-6 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
            Elige tu plan
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Accede al poder de más de 20 modelos de valuación profesionales con inputs totalmente personalizables
          </p>
        </div>

        {/* Toggle Mensual / Anual */}
        <div className="flex justify-center mb-12">
          <div className="bg-gray-900 rounded-full p-1.5 flex shadow-xl border border-gray-800">
            <button
              onClick={() => setIsAnnual(false)}
              className={`px-8 py-3 rounded-full text-sm font-semibold transition-all ${
                !isAnnual ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Mensual
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`px-8 py-3 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
                isAnnual ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Anual
              <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full">
                -16%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8 mb-20">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative bg-gray-900/80 backdrop-blur rounded-3xl p-8 border-2 transition-all hover:scale-[1.02] ${
                plan.popular
                  ? 'border-purple-500 shadow-2xl shadow-purple-500/20 scale-105 md:scale-105'
                  : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-purple-600 to-cyan-600 text-white text-xs font-bold px-6 py-2 rounded-full shadow-lg">
                  MÁS POPULAR
                </div>
              )}

              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <div className="mb-6">
                <span className="text-5xl font-black">
                  ${isAnnual ? plan.annualPrice : plan.price}
                </span>
                <span className="text-gray-400 text-lg">
                  /{isAnnual ? 'año' : 'mes'}
                </span>
                {isAnnual && plan.price > 0 && (
                  <p className="text-green-400 text-sm mt-1">
                    Ahorras ${(plan.price * 12 - plan.annualPrice).toFixed(0)}/año
                  </p>
                )}
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-gray-200">{feature}</span>
                  </li>
                ))}
                {plan.limitations.map((limitation) => (
                  <li key={limitation} className="flex items-start gap-3 text-gray-500">
                    <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>{limitation}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaLink}
                className={`block w-full py-4 rounded-2xl font-bold text-lg text-center transition-all ${
                  plan.popular
                    ? 'bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white shadow-lg shadow-purple-500/25'
                    : plan.price === 0
                    ? 'bg-gray-800 hover:bg-gray-700 text-white'
                    : 'bg-white hover:bg-gray-100 text-black'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Features Comparison */}
        <div className="mb-20">
          <h2 className="text-3xl font-bold text-center mb-12">
            Comparación de Features
          </h2>
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left p-4 text-gray-400 font-semibold">Feature</th>
                    <th className="p-4 text-center text-gray-400 font-semibold">Free</th>
                    <th className="p-4 text-center text-purple-400 font-semibold bg-purple-500/10">Pro</th>
                    <th className="p-4 text-center text-gray-400 font-semibold">Elite</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: "Análisis por día", free: "5", pro: "Ilimitado", elite: "Ilimitado" },
                    { feature: "Modelos de valuación", free: "5 básicos", pro: "20+", elite: "20+" },
                    { feature: "Inputs personalizables", free: "No", pro: "Sí", elite: "Sí" },
                    { feature: "Resumen Neural IA", free: "No", pro: "Sí", elite: "Sí" },
                    { feature: "Market Sentiment", free: "No", pro: "Sí", elite: "Sí" },
                    { feature: "Exportar PDF/Excel", free: "No", pro: "Sí", elite: "Sí" },
                    { feature: "API Access", free: "No", pro: "No", elite: "Sí" },
                    { feature: "Soporte", free: "Email", pro: "Prioritario", elite: "VIP <2h" },
                    { feature: "Webinars exclusivos", free: "No", pro: "No", elite: "Sí" },
                  ].map((row, idx) => (
                    <tr key={idx} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="p-4 text-gray-300">{row.feature}</td>
                      <td className="p-4 text-center">
                        {row.free === "No" ? (
                          <span className="text-gray-600">—</span>
                        ) : row.free === "Sí" ? (
                          <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="text-gray-400">{row.free}</span>
                        )}
                      </td>
                      <td className="p-4 text-center bg-purple-500/5">
                        {row.pro === "No" ? (
                          <span className="text-gray-600">—</span>
                        ) : row.pro === "Sí" ? (
                          <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="text-purple-400 font-semibold">{row.pro}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {row.elite === "No" ? (
                          <span className="text-gray-600">—</span>
                        ) : row.elite === "Sí" ? (
                          <svg className="w-5 h-5 text-green-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="text-gray-400">{row.elite}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-20">
          <h2 className="text-3xl font-bold text-center mb-12">
            Preguntas Frecuentes
          </h2>
          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq, idx) => (
              <div
                key={idx}
                className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between hover:bg-gray-800/30 transition"
                >
                  <span className="font-semibold text-gray-200">{faq.q}</span>
                  <svg
                    className={`w-5 h-5 text-gray-400 transform transition-transform ${openFaq === idx ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === idx && (
                  <div className="px-5 pb-5 text-gray-400">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-gradient-to-r from-purple-900/30 to-cyan-900/30 rounded-3xl p-12 border border-purple-500/30">
          <h2 className="text-3xl font-bold mb-4">
            ¿Listo para empezar?
          </h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Únete a miles de inversores que ya utilizan nuestros modelos de valuación profesionales para tomar mejores decisiones.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/analizar"
              className="px-8 py-4 bg-white text-black font-bold rounded-xl hover:bg-gray-100 transition"
            >
              Probar Gratis
            </Link>
            <Link
              href="/auth/sign-up?plan=pro"
              className="px-8 py-4 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-bold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition"
            >
              Empezar con Pro
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-20 py-12">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-500">
          <p>&copy; 2024 StockAnalyzer Pro. Todos los derechos reservados.</p>
          <div className="flex justify-center gap-6 mt-4">
            <Link href="/terms" className="hover:text-white transition">Términos</Link>
            <Link href="/privacy" className="hover:text-white transition">Privacidad</Link>
            <Link href="/contact" className="hover:text-white transition">Contacto</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
