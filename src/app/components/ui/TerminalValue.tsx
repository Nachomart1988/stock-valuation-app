import React from 'react';

interface TerminalValueProps {
  value: string | number;
  prefix?: string;
  suffix?: string;
  trend?: 'up' | 'down' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
};

const trendColors = {
  up: 'text-green-400',
  down: 'text-red-400',
  neutral: 'text-gray-200',
};

export function TerminalValue({
  value,
  prefix = '',
  suffix = '',
  trend = 'neutral',
  size = 'md',
  className = '',
}: TerminalValueProps) {
  return (
    <span
      className={`font-data font-bold tracking-tight tabular-nums ${trendColors[trend]} ${sizeClasses[size]} ${className}`}
      style={{ textShadow: trend === 'up' ? '0 0 8px rgba(0,166,81,0.3)' : trend === 'down' ? '0 0 8px rgba(239,68,68,0.3)' : 'none' }}
    >
      {prefix && <span className="text-gray-500 mr-0.5">{prefix}</span>}
      {value}
      {suffix && <span className="text-gray-500 ml-0.5 text-[0.7em]">{suffix}</span>}
    </span>
  );
}
