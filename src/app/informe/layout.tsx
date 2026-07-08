import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Informe Semanal - Prismo | God Mode',
  description: 'Informe semanal institucional del mercado: sectores, amplitud, earnings, divisas, flujos y síntesis de la semana.',
  alternates: { canonical: 'https://www.prismo.us/informe' },
  robots: { index: false, follow: false },
};

export default function InformeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
