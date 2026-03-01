'use client';

import { useState } from 'react';
import Header from '../components/Header';

const sections = [
  {
    title: 'Cuenta y Planes',
    faqs: [
      {
        q: '¿Necesito registrarme para usar Prismo?',
        a: 'No. Puedes analizar cualquier acción sin cuenta. Sin embargo, funciones como el Diario del Inversor, el Resumen Maestro Neural y la exportación a PDF requieren una cuenta activa con el plan correspondiente.',
      },
      {
        q: '¿Cuáles son las diferencias entre los planes?',
        a: 'Free da acceso a estados financieros, info general, DDM y DCF básico. Pro desbloquea todos los modelos de valuación, WACC, CAGR, Forecasts, Noticias y más. Elite añade el Diario del Inversor, Resumen Maestro Neural y exportación PDF. Gold incluye todo lo anterior más acceso early beta y soporte VIP < 2h.',
      },
      {
        q: '¿Puedo cambiar de plan en cualquier momento?',
        a: 'Sí. Los upgrades son inmediatos. Los downgrades aplican al próximo ciclo de facturación.',
      },
      {
        q: '¿Ofrecen reembolsos?',
        a: 'Sí. Ofrecemos reembolso completo dentro de los 7 días siguientes al primer pago si no estás satisfecho.',
      },
    ],
  },
  {
    title: 'Datos y Análisis',
    faqs: [
      {
        q: '¿De dónde vienen los datos financieros?',
        a: 'Usamos Financial Modeling Prep (FMP) para datos fundamentales, precios históricos, estados financieros y datos de analistas. Para datos intraday usamos Yahoo Finance.',
      },
      {
        q: '¿Con qué frecuencia se actualizan los datos?',
        a: 'Precios y datos de mercado: tiempo real. Estados financieros: actualizados tras cada reporte trimestral. Forecasts de analistas: semanalmente.',
      },
      {
        q: '¿Qué modelos de valuación están incluidos?',
        a: 'Más de 20 modelos: DDM 2-Stage/3-Stage/H-Model, FCF 2-Stage/3-Stage, FCFF/FCFE, DCF Multi-Etapa, Monte Carlo DCF, Stochastic DCF, Graham Method/Number/Net-Net, RIM Ohlson, Bayesian NK DSGE, HJM, PrismoValue Neural, EPS × Benchmark, y más.',
      },
      {
        q: '¿Los inputs son editables?',
        a: 'Sí. El 100% de los inputs en todos los modelos son editables: tasa de crecimiento, WACC, perpetuidad, beta, tasa libre de riesgo, y más. Puedes ajustar cada parámetro a tu tesis de inversión.',
      },
      {
        q: '¿Puedo analizar ADRs y acciones internacionales?',
        a: 'Prismo está optimizado para NYSE y NASDAQ. Los ADRs listados en mercados americanos funcionan bien. El soporte para mercados internacionales (BMV, LSE, etc.) está en desarrollo.',
      },
    ],
  },
  {
    title: 'Herramientas Específicas',
    faqs: [
      {
        q: '¿Qué es el Prismo Score (Momentum)?',
        a: 'El Prismo Score evalúa si una acción cumple los criterios de "líderes en compresión": acciones que han liderado el mercado en retornos de 3/6/12 meses, han tenido una corrida alcista significativa, y ahora se encuentran en una compresión de volatilidad con volumen seco, cerca de un techo diagonal. Stock con r12m < -10% automáticamente obtiene 0.',
      },
      {
        q: '¿Qué es el Resumen Maestro Neural?',
        a: 'Un análisis de 12 capas que combina NLP de noticias, flujo institucional, análisis técnico, valuaciones, análisis de calidad, forecasts de analistas, Monte Carlo y más para generar una recomendación final con precio objetivo.',
      },
      {
        q: '¿Cómo funciona el Diario del Inversor?',
        a: 'Permite registrar trades con fecha, ticker, precio de entrada/salida, notas, y calcular P&L. Los registros se guardan de forma segura en tu cuenta.',
      },
      {
        q: '¿Qué incluye el PDF de análisis?',
        a: 'El PDF (Elite/Gold) incluye portada, highlights financieros, valuación con todos los modelos, forecasts de analistas, análisis técnico y disclaimer. Es configurable: eliges secciones, colores, fuente y logo.',
      },
    ],
  },
  {
    title: 'Técnico y Privacidad',
    faqs: [
      {
        q: '¿Cómo protegen mis datos?',
        a: 'Usamos Clerk para autenticación (estándares enterprise). Los datos de tu cuenta se transmiten siempre por HTTPS. No vendemos ni compartimos datos de usuarios con terceros.',
      },
      {
        q: '¿En qué tecnologías está construido Prismo?',
        a: 'Frontend: Next.js 14, TailwindCSS, TypeScript. Backend: FastAPI (Python), PyTorch para modelos neurales. Auth: Clerk. Pagos: Stripe.',
      },
    ],
  },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-green-900/15 last:border-0">
      <button
        className="w-full flex items-center justify-between py-4 text-left gap-4 hover:text-emerald-400 transition"
        onClick={() => setOpen(!open)}
      >
        <span className="font-medium text-sm sm:text-base">{q}</span>
        <span className={`text-xl flex-shrink-0 transition-transform ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      {open && (
        <div className="pb-4 text-sm text-gray-400 leading-relaxed">{a}</div>
      )}
    </div>
  );
}

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-3xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">Preguntas Frecuentes</h1>
          <p className="text-gray-400 text-lg">Todo lo que necesitas saber sobre Prismo.</p>
        </div>

        <div className="space-y-8">
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-4">{section.title}</h2>
              <div className="bg-black/60/40 rounded-2xl border border-green-900/15 px-6">
                {section.faqs.map((faq) => (
                  <FAQItem key={faq.q} {...faq} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 p-6 rounded-2xl bg-black/40 border border-green-900/15 text-center">
          <p className="text-gray-400 mb-3">¿No encontraste tu respuesta?</p>
          <a
            href="mailto:support@prismo.app"
            className="text-emerald-400 hover:text-emerald-300 font-semibold transition"
          >
            support@prismo.app →
          </a>
        </div>
      </main>
    </div>
  );
}
