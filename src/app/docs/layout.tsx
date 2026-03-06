import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Documentacion - Prismo | Guia de Modelos de Valuacion',
  description: 'Documentacion completa de los 20+ modelos de valuacion de Prismo: DCF, DDM, Graham Number, Peter Lynch, Residual Income y mas.',
  alternates: { canonical: 'https://www.prismo.us/docs' },
  openGraph: {
    title: 'Documentacion - Prismo',
    description: 'Guia detallada de cada modelo de valuacion, formulas, inputs y metodologia.',
    url: 'https://www.prismo.us/docs',
  },
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
