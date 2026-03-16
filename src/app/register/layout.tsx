import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crear Cuenta - Prismo | Registro Gratuito',
  description: 'Crea tu cuenta gratuita en Prismo y accede a 20+ modelos de valuacion, screener de acciones y analisis con IA.',
  alternates: { canonical: 'https://www.prismo.us/register' },
  openGraph: {
    title: 'Registrate en Prismo - Gratis',
    description: 'Analiza acciones con 20+ modelos de valuacion. Crea tu cuenta gratis.',
    url: 'https://www.prismo.us/register',
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
