import React from 'react';
import { TrendIndicator } from '../../../app/components/ui/TrendIndicator';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  change?: number;
  format?: 'currency' | 'percentage' | 'number';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  description?: string;
}

export function MetricCard({
  label,
  value,
  trend,
  change,
  format = 'number',
  size = 'md',
  icon,
  description,
}: MetricCardProps) {
  const formatValue = (val: string | number) => {
    const numValue = typeof val === 'string' ? parseFloat(val) : val;
    
    if (isNaN(numValue)) return val;
    
    switch (format) {
      case 'currency':
        if (numValue >= 1e9) return `$${(numValue / 1e9).toFixed(2)}B`;
        if (numValue >= 1e6) return `$${(numValue / 1e6).toFixed(2)}M`;
        return `$${numValue.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      
      case 'percentage':
        return `${numValue.toFixed(2)}%`;
      
      default:
        return numValue.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    }
  };

  const sizeClasses = {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  const valueSizeClasses = {
    sm: 'text-2xl',
    md: 'text-3xl',
    lg: 'text-4xl',
  };

  return (
    <div className={`bg-black/60 backdrop-blur-sm rounded-xl border border-green-900/25 border-l-2 border-l-green-600/50 hover:border-green-900/50 hover:shadow-[0_0_24px_rgba(0,166,81,0.08)] transition-all duration-300 animate-fade-in-up ${sizeClasses[size]}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center text-accent-blue">
              {icon}
            </div>
          )}
          <p className="text-sm font-medium text-neutral-300">{label}</p>
        </div>
        {trend && change !== undefined && (
          <TrendIndicator trend={trend} change={change} />
        )}
      </div>

      <div className="mb-2">
        <p className={`font-bold font-data text-neutral-100 ${valueSizeClasses[size]}`}>
          {formatValue(value)}
        </p>
      </div>

      {description && (
        <p className="text-xs text-neutral-400 mt-2">{description}</p>
      )}
    </div>
  );
}