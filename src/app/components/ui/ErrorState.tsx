import React from 'react';

interface ErrorStateProps {
  title?: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ErrorState({ title = 'Error', message, action }: ErrorStateProps) {
  return (
    <div className="min-h-screen bg-primary-900 flex items-center justify-center p-8">
      <div className="text-center max-w-2xl">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-danger-light/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-danger-light" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold text-danger-light mb-4">{title}</h1>
        <p className="text-xl text-neutral-300 mb-6">{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="px-6 py-3 bg-accent-blue text-white font-semibold rounded-xl hover:bg-accent-blue/90 transition-colors"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}