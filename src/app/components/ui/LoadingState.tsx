import React from 'react';

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Cargando datos...' }: LoadingStateProps) {
  return (
    <div className="min-h-screen bg-primary-900 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 mb-6">
          <div className="w-16 h-16 border-4 border-accent-blue border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-xl font-semibold text-neutral-100 mb-2">{message}</p>
        <p className="text-sm text-neutral-400">Esto puede tomar unos segundos</p>
      </div>
    </div>
  );
}