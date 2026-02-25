import { LogoLoader } from './LogoLoader';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Cargando datos...' }: LoadingStateProps) {
  return <LogoLoader size="xl" message={message} fullPage />;
}
