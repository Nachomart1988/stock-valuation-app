import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.prismo.us';
  const now = new Date();
  return [
    { url: base,                          lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${base}/analizar`,            lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${base}/screener`,            lastModified: now, changeFrequency: 'daily',   priority: 0.8 },
    { url: `${base}/market-sentiment`,    lastModified: now, changeFrequency: 'daily',   priority: 0.7 },
    { url: `${base}/pricing`,             lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/blog`,                lastModified: now, changeFrequency: 'weekly',  priority: 0.7 },
    { url: `${base}/diario`,              lastModified: now, changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${base}/docs`,                lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/faq`,                 lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/guides`,              lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/careers`,             lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/support`,             lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/press`,               lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${base}/privacy`,             lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
    { url: `${base}/terms`,               lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
    { url: `${base}/cookies`,             lastModified: now, changeFrequency: 'yearly',  priority: 0.2 },
    { url: `${base}/licenses`,            lastModified: now, changeFrequency: 'yearly',  priority: 0.1 },
  ];
}
