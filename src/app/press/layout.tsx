import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prensa - Prismo | Press Kit y Recursos de Medios',
  description: 'Kit de prensa, logos, y recursos para medios sobre Prismo, la plataforma de analisis de acciones con IA.',
  alternates: { canonical: 'https://www.prismo.us/press' },
  openGraph: {
    title: 'Press Kit - Prismo',
    description: 'Recursos de prensa y medios de Prismo.',
    url: 'https://www.prismo.us/press',
  },
};

export default function PressLayout({ children }: { children: React.ReactNode }) {
  return children;
}
