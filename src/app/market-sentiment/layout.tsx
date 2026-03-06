import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Market Sentiment - Prismo | Sentimiento del Mercado en Tiempo Real',
  description: 'Analisis de sentimiento del mercado con Fear & Greed Index, indices principales, sectores y tendencias macro en tiempo real.',
  alternates: { canonical: 'https://www.prismo.us/market-sentiment' },
  openGraph: {
    title: 'Market Sentiment - Prismo',
    description: 'Sentimiento del mercado, Fear & Greed, sectores y macro en tiempo real.',
    url: 'https://www.prismo.us/market-sentiment',
  },
};

export default function MarketSentimentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
