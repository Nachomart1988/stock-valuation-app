import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Prismo - Analisis de Acciones',
    short_name: 'Prismo',
    description: 'El primer multimodelo de valuacion fully customizable.',
    start_url: '/',
    display: 'standalone',
    background_color: '#030712',
    theme_color: '#10b981',
    orientation: 'portrait',
    categories: ['finance', 'business'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
