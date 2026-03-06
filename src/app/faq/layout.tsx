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

export default function FaqLayout({ children }: { children: React.ReactNode }) {
  return children;
}
