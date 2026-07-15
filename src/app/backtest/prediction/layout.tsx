import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prediction - Prismo | God Mode',
  description: 'Edge Predictor: candidatos a breakout que replican el patrón previo de los surges históricos encontrados por el Edge Finder.',
  alternates: { canonical: 'https://www.prismo.us/backtest/prediction' },
  robots: { index: false, follow: false },
};

export default function PredictionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
