'use client';

import { useState } from 'react';
import Link from 'next/link';
import Header from '../components/Header';

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    annualPrice: 0,
    color: 'border-gray-700',
    badge: null as string | null,
    badgeColor: '',
    features: [
      'Inicio y Estados Financieros completos',
      'Info General (análisis general)',
      'Competidores',
      'Inputs básicos (SGR y Beta)',
      'DCF básico + DDMs, Advance DCF',
    ],
    cta: 'Empezar gratis',
    ctaHref: '/register',
    ctaStyle: 'bg-gray-800 hover:bg-gray-700 text-white',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 29,
    annualPrice: 290,
    color: 'border-emerald-500',
    badge: 'MÁS POPULAR',
    badgeColor: 'bg-emerald-600',
    features: [
      'Todo lo de Free',
      'Todas las pestañas de análisis',
      '20+ modelos de valuación completos',
      'Forecasts, Noticias, Holders, WACC, CAGR',
      'Probabilidad y árbol binomial',
      'Market Sentiment Analysis',
      'Soporte prioritario',
    ],
    cta: 'Empezar con Pro',
    ctaHref: '/register?plan=pro',
    ctaStyle: 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-lg shadow-emerald-500/25',
  },
  {
    key: 'elite',
    name: 'Elite',
    price: 59,
    annualPrice: 590,
    color: 'border-violet-500',
    badge: null as string | null,
    badgeColor: '',
    features: [
      'Todo lo de Pro',
      'Diario del Inversor',
      'Resumen Maestro Neural (IA)',
      'Descarga de análisis en PDF',
      'Soporte VIP (respuesta <2h)',
    ],
    cta: 'Empezar con Elite',
    ctaHref: '/register?plan=elite',
    ctaStyle: 'bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 text-white',
  },
  {
    key: 'gold',
    name: 'Gold',
    price: 100,
    annualPrice: 1000,
    color: 'border-yellow-500',
    badge: '⭐ VIP',
    badgeColor: 'bg-yellow-600',
    features: [
      'Todo lo de Elite',
      'Acceso Early Beta (nuevas features)',
      'Resumen mensual del mercado',
      'Soporte VIP <2h garantizado',
    ],
    cta: 'Empezar con Gold',
    ctaHref: '/register?plan=gold',
    ctaStyle: 'bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white',
  },
];

const COMPARISON = [
  { feature: 'Inicio + Estados Financieros',     free: true,  pro: true,  elite: true,  gold: true },
  { feature: 'Info General (solo análisis)',      free: true,  pro: true,  elite: true,  gold: true },
  { feature: 'Competidores',                      free: true,  pro: true,  elite: true,  gold: true },
  { feature: 'Inputs SGR + Beta',                 free: true,  pro: true,  elite: true,  gold: true },
  { feature: 'DDMs + Advance DCF básico',         free: true,  pro: true,  elite: true,  gold: true },
  { feature: 'Forecasts + Noticias',              free: false, pro: true,  elite: true,  gold: true },
  { feature: 'WACC + CAGR + Pivots',              free: false, pro: true,  elite: true,  gold: true },
  { feature: 'Probabilidad / Árbol binomial',     free: false, pro: true,  elite: true,  gold: true },
  { feature: 'Todos los modelos de valuación',    free: false, pro: true,  elite: true,  gold: true },
  { feature: 'Key Metrics + DuPont + Analistas',  free: false, pro: true,  elite: true,  gold: true },
  { feature: 'Industry + Segmentation + Holders', free: false, pro: true,  elite: true,  gold: true },
  { feature: 'Diario del Inversor',               free: false, pro: false, elite: true,  gold: true },
  { feature: 'Resumen Maestro Neural (IA)',        free: false, pro: false, elite: true,  gold: true },
  { feature: 'Exportar análisis en PDF',          free: false, pro: false, elite: true,  gold: true },
  { feature: 'Acceso Early Beta',                 free: false, pro: false, elite: false, gold: true },
  { feature: 'Resumen mensual del mercado',       free: false, pro: false, elite: false, gold: true },
  { feature: 'Soporte',                           free: 'Email', pro: 'Prior.', elite: 'VIP', gold: 'VIP <2h' },
];

function Check({ ok }: { ok: boolean | string }) {
  if (typeof ok === 'string') return <span className="text-gray-300 text-xs font-semibold">{ok}</span>;
  if (ok) return <svg className="w-5 h-5 text-emerald-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
  return <span className="text-gray-600">—</span>;
}

const faqs = [
  { q: '¿Puedo cambiar de plan en cualquier momento?', a: 'Sí, puedes subir o bajar de plan desde tu perfil. Los cambios se aplican de inmediato.' },
  { q: '¿Hay período de prueba?', a: 'El plan Free no tiene límite de tiempo. Úsalo indefinidamente para explorar las funciones básicas.' },
  { q: '¿Qué pasa si cancelo mi suscripción?', a: 'Mantendrás el acceso hasta el final del período pagado, luego tu cuenta vuelve al plan Free automáticamente.' },
  { q: '¿Los precios incluyen impuestos?', a: 'Los precios son en USD y no incluyen impuestos locales que puedan aplicarse según tu ubicación.' },
  { q: '¿Cómo funciona el pago anual?', a: 'Con el plan anual pagas por adelantado y obtienes ~2 meses gratis (17% de descuento sobre el precio mensual).' },
];

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 text-white">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-16 pt-20 sm:pt-24">
        {/* Hero */}
        <div className="text-center mb-10 sm:mb-14">
          <h1 className="text-3xl sm:text-5xl font-black mb-4 bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
            Elige tu plan
          </h1>
          <p className="text-base sm:text-lg text-gray-400 max-w-2xl mx-auto">
            Desde análisis básico gratuito hasta herramientas de nivel institucional
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-10">
          <div className="bg-gray-900 rounded-full p-1.5 flex border border-gray-800">
            <button onClick={() => setIsAnnual(false)} className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all ${!isAnnual ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'}`}>
              Mensual
            </button>
            <button onClick={() => setIsAnnual(true)} className={`px-6 py-2.5 rounded-full text-sm font-semibold flex items-center gap-2 transition-all ${isAnnual ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'}`}>
              Anual <span className="px-2 py-0.5 bg-emerald-500 text-white text-xs rounded-full">-17%</span>
            </button>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-16">
          {PLANS.map((plan) => (
            <div key={plan.key} className={`relative bg-gray-900/80 backdrop-blur rounded-2xl p-6 border-2 transition-all hover:scale-[1.02] ${plan.color}`}>
              {plan.badge && (
                <div className={`absolute -top-4 left-1/2 -translate-x-1/2 ${plan.badgeColor} text-white text-xs font-bold px-5 py-1.5 rounded-full`}>
                  {plan.badge}
                </div>
              )}
              <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
              <div className="mb-5">
                <span className="text-4xl font-black">${isAnnual ? plan.annualPrice : plan.price}</span>
                <span className="text-gray-400 text-sm">/{isAnnual ? 'año' : 'mes'}</span>
                {isAnnual && plan.price > 0 && (
                  <p className="text-emerald-400 text-xs mt-1">Ahorras ${plan.price * 12 - plan.annualPrice}/año</p>
                )}
              </div>
              <ul className="space-y-2 mb-7">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-300">
                    <svg className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={plan.ctaHref} className={`block w-full py-3 rounded-xl font-bold text-sm text-center transition-all ${plan.ctaStyle}`}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Comparison */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-8">Comparación detallada</h2>
          <div className="bg-gray-900/50 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left p-4 text-gray-400 font-semibold min-w-[220px]">Feature</th>
                    <th className="p-4 text-center text-gray-400 font-semibold">Free</th>
                    <th className="p-4 text-center text-emerald-400 font-semibold bg-emerald-500/5">Pro</th>
                    <th className="p-4 text-center text-violet-400 font-semibold">Elite</th>
                    <th className="p-4 text-center text-yellow-400 font-semibold">Gold</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="p-4 text-gray-300 text-sm">{row.feature}</td>
                      <td className="p-4 text-center"><Check ok={row.free} /></td>
                      <td className="p-4 text-center bg-emerald-500/5"><Check ok={row.pro} /></td>
                      <td className="p-4 text-center"><Check ok={row.elite} /></td>
                      <td className="p-4 text-center"><Check ok={row.gold} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mb-16 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-8">Preguntas frecuentes</h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full p-5 text-left flex items-center justify-between hover:bg-gray-800/30 transition">
                  <span className="font-semibold text-gray-200 text-sm">{faq.q}</span>
                  <svg className={`w-4 h-4 text-gray-400 shrink-0 ml-4 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </button>
                {openFaq === i && <div className="px-5 pb-5 text-gray-400 text-sm">{faq.a}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center bg-gray-900/60 rounded-3xl p-8 sm:p-12 border border-emerald-500/20">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">¿Listo para empezar?</h2>
          <p className="text-gray-400 mb-8 max-w-lg mx-auto">Únete a la comunidad de inversores que toman decisiones basadas en datos reales.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register" className="px-8 py-3 bg-gray-800 hover:bg-gray-700 text-white font-bold rounded-xl transition">Empezar gratis</Link>
            <Link href="/register?plan=pro" className="px-8 py-3 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold rounded-xl transition shadow-lg shadow-emerald-500/20">
              Empezar con Pro — $29/mes
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 mt-16 py-10">
        <div className="max-w-7xl mx-auto px-6 text-center text-gray-500 text-sm">
          <p>&copy; 2025 StockAnalyzer Pro. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
