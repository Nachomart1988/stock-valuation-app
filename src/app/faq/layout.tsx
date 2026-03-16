import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Preguntas Frecuentes - Prismo | FAQ',
  description: 'Respuestas a las preguntas mas frecuentes sobre Prismo: modelos de valuacion, planes, datos financieros, IA y mas.',
  alternates: { canonical: 'https://www.prismo.us/faq' },
  openGraph: {
    title: 'FAQ - Prismo',
    description: 'Todo lo que necesitas saber sobre Prismo y sus modelos de valuacion.',
    url: 'https://www.prismo.us/faq',
  },
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: '¿Necesito registrarme para usar Prismo?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. Puedes analizar cualquier acción sin cuenta. Sin embargo, funciones como el Diario del Inversor, el Resumen Maestro Neural y la exportación a PDF requieren una cuenta activa con el plan correspondiente.',
      },
    },
    {
      '@type': 'Question',
      name: '¿Cuáles son las diferencias entre los planes?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Free da acceso a estados financieros, info general, DDM y DCF básico. Pro desbloquea todos los modelos de valuación, WACC, CAGR, Forecasts, Noticias y más. Elite añade el Diario del Inversor, Resumen Maestro Neural y exportación PDF. Gold incluye todo lo anterior más acceso early beta y soporte VIP.',
      },
    },
    {
      '@type': 'Question',
      name: '¿De dónde vienen los datos financieros?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Usamos Financial Modeling Prep (FMP) para datos fundamentales, precios históricos, estados financieros y datos de analistas.',
      },
    },
    {
      '@type': 'Question',
      name: '¿Qué modelos de valuación están incluidos?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Más de 20 modelos: DDM 2-Stage/3-Stage/H-Model, FCF 2-Stage/3-Stage, FCFF/FCFE, DCF Multi-Etapa, Monte Carlo DCF, Stochastic DCF, Graham Method/Number/Net-Net, RIM Ohlson, Bayesian NK DSGE, HJM, PrismoValue Neural, EPS × Benchmark, y más.',
      },
    },
    {
      '@type': 'Question',
      name: '¿Los inputs son editables?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Sí. El 100% de los inputs en todos los modelos son editables: tasa de crecimiento, WACC, perpetuidad, beta, tasa libre de riesgo, y más. Puedes ajustar cada parámetro a tu tesis de inversión.',
      },
    },
    {
      '@type': 'Question',
      name: '¿Qué es el Resumen Maestro Neural?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Un análisis de 12 capas que combina NLP de noticias, flujo institucional, análisis técnico, valuaciones, análisis de calidad, forecasts de analistas, Monte Carlo y más para generar una conclusión final con precio objetivo.',
      },
    },
    {
      '@type': 'Question',
      name: '¿Cómo protegen mis datos?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Usamos Clerk para autenticación (estándares enterprise). Los datos de tu cuenta se transmiten siempre por HTTPS. No vendemos ni compartimos datos de usuarios con terceros.',
      },
    },
  ],
};

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {children}
    </>
  );
}
