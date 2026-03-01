import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.prismo.us';
  return [
    { url: base,                    lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${base}/analizar`,      lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${base}/screener`,      lastModified: new Date(), changeFrequency: 'daily',   priority: 0.8 },
    { url: `${base}/market-sentiment`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: `${base}/diario`,        lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${base}/pricing`,       lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/docs`,          lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/faq`,           lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/blog`,          lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.6 },
    { url: `${base}/guides`,        lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/privacy`,       lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${base}/terms`,         lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.3 },
  ];
}
