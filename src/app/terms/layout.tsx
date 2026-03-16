import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terminos de Servicio - Prismo',
  description: 'Terminos y condiciones de uso de la plataforma Prismo de analisis de acciones.',
  alternates: { canonical: 'https://www.prismo.us/terms' },
  openGraph: {
    title: 'Terminos de Servicio - Prismo',
    description: 'Terminos y condiciones de Prismo.',
    url: 'https://www.prismo.us/terms',
  },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
