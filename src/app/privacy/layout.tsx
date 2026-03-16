import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Politica de Privacidad - Prismo',
  description: 'Como Prismo recopila, usa y protege tus datos personales. Politica de privacidad completa.',
  alternates: { canonical: 'https://www.prismo.us/privacy' },
  openGraph: {
    title: 'Privacidad - Prismo',
    description: 'Politica de privacidad de Prismo.',
    url: 'https://www.prismo.us/privacy',
  },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
