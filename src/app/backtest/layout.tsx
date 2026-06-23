import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Backtest - Prismo | God Mode',
  description: 'Backtesting de estrategias intradiarias. Short selling de small caps en gap ups con simulación de 1 minuto.',
  alternates: { canonical: 'https://www.prismo.us/backtest' },
  robots: { index: false, follow: false },
};

export default function BacktestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
