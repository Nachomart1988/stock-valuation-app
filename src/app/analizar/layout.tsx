import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analizar Acciones - Prismo | 20+ Modelos de Valuacion',
  description: 'Analiza cualquier accion con 20+ modelos de valuacion: DCF, DDM, Graham, Monte Carlo, analisis neural y mas. Inputs 100% personalizables.',
  alternates: { canonical: 'https://www.prismo.us/analizar' },
  openGraph: {
    title: 'Analizar Acciones - Prismo',
    description: 'Valuacion profesional con 20+ modelos, Monte Carlo, IA multimodelo y clasificador hibrido.',
    url: 'https://www.prismo.us/analizar',
  },
};

export default function AnalizarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
