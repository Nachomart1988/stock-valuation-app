import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog de Inversiones - Prismo | Analisis y Tesis',
  description: 'Lee y publica tesis de inversion, analisis de acciones y estrategias. Comunidad de inversores compartiendo ideas con datos reales.',
  alternates: { canonical: 'https://www.prismo.us/blog' },
  openGraph: {
    title: 'Blog de Inversiones - Prismo',
    description: 'Tesis de inversion y analisis de acciones por la comunidad Prismo.',
    url: 'https://www.prismo.us/blog',
  },
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
