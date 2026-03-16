import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Guias de Uso - Prismo | Aprende a Analizar Acciones',
  description: 'Guias paso a paso para usar Prismo: modelos de valuacion, screener, forecasts, analisis neural y mas.',
  alternates: { canonical: 'https://www.prismo.us/guides' },
  openGraph: {
    title: 'Guias - Prismo',
    description: 'Aprende a sacar el maximo provecho de los 20+ modelos de valuacion de Prismo.',
    url: 'https://www.prismo.us/guides',
  },
};

export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
