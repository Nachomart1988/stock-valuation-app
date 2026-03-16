import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Soporte - Prismo | Centro de Ayuda',
  description: 'Necesitas ayuda con Prismo? Encuentra respuestas, contacta soporte y resuelve problemas rapidamente.',
  alternates: { canonical: 'https://www.prismo.us/support' },
  openGraph: {
    title: 'Soporte - Prismo',
    description: 'Centro de ayuda y soporte tecnico de Prismo.',
    url: 'https://www.prismo.us/support',
  },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
