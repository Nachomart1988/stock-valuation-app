import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Stock Screener - Prismo | Filtro de Acciones Avanzado',
  description: 'Filtra acciones por market cap, P/E, dividend yield, sector y mas. Screener avanzado con datos en tiempo real de Financial Modeling Prep.',
  alternates: { canonical: 'https://www.prismo.us/screener' },
  openGraph: {
    title: 'Stock Screener - Prismo',
    description: 'Screener avanzado para filtrar acciones por fundamentales, ratios y sector.',
    url: 'https://www.prismo.us/screener',
  },
};

export default function ScreenerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
