import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Planes y Precios - Prismo | Free, Pro, Elite, Gold',
  description: 'Elige tu plan de analisis de acciones: Free con modelos basicos, Pro con 20+ modelos ($29/mes), Elite con IA y PDF ($59/mes), o Gold VIP ($100/mes).',
  alternates: { canonical: 'https://www.prismo.us/pricing' },
  openGraph: {
    title: 'Planes y Precios - Prismo',
    description: 'Compara planes: Free, Pro, Elite y Gold. 20+ modelos de valuacion, Monte Carlo, IA y mas.',
    url: 'https://www.prismo.us/pricing',
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
