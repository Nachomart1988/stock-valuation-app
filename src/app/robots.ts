import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/sso-callback', '/subscription/', '/diario'],
      },
    ],
    sitemap: 'https://www.prismo.us/sitemap.xml',
  };
}
