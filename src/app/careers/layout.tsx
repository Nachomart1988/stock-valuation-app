import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Careers - Prismo | Trabaja con Nosotros',
  description: 'Unite al equipo de Prismo. Posiciones abiertas en ingenieria, data science y finanzas cuantitativas.',
  alternates: { canonical: 'https://www.prismo.us/careers' },
  openGraph: {
    title: 'Careers - Prismo',
    description: 'Posiciones abiertas en Prismo: ingenieria, data science y finanzas cuantitativas.',
    url: 'https://www.prismo.us/careers',
  },
};

export default function CareersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
