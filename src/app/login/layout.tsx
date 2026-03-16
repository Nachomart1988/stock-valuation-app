import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Iniciar Sesion - Prismo',
  description: 'Inicia sesion en Prismo para acceder a tu portafolio, diario de inversor y analisis guardados.',
  alternates: { canonical: 'https://www.prismo.us/login' },
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
