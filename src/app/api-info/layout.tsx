import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API - Prismo | Documentacion de la API',
  description: 'Documentacion de la API de Prismo para integraciones y acceso programatico a modelos de valuacion.',
  alternates: { canonical: 'https://www.prismo.us/api-info' },
  openGraph: {
    title: 'API - Prismo',
    description: 'Integra los modelos de valuacion de Prismo en tu aplicacion.',
    url: 'https://www.prismo.us/api-info',
  },
};

export default function ApiInfoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
