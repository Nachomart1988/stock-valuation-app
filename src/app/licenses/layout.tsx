import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Licencias Open Source - Prismo',
  description: 'Licencias de las dependencias y librerias open source utilizadas en Prismo.',
  alternates: { canonical: 'https://www.prismo.us/licenses' },
  robots: { index: false, follow: true },
};

export default function LicensesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
