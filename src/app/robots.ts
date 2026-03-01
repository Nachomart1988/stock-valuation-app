import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/sso-callback', '/subscription/'],
      },
    ],
    sitemap: 'https://www.prismo.us/sitemap.xml',
  };
}
