import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Politica de Cookies - Prismo',
  description: 'Informacion sobre el uso de cookies y tecnologias de almacenamiento en Prismo.',
  alternates: { canonical: 'https://www.prismo.us/cookies' },
  openGraph: {
    title: 'Politica de Cookies - Prismo',
    description: 'Como usamos cookies para mejorar tu experiencia en Prismo.',
    url: 'https://www.prismo.us/cookies',
  },
};

export default function CookiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
