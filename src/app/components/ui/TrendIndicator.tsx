import React from 'react';

interface TrendIndicatorProps {
  trend: 'up' | 'down' | 'neutral';
  change?: number;
  showPercentage?: boolean;
}

export function TrendIndicator({ trend, change, showPercentage = true }: TrendIndicatorProps) {
  const getColor = () => {
    switch (trend) {
      case 'up': return 'text-accent-teal';
      case 'down': return 'text-accent-red';
      default: return 'text-neutral-400';
    }
  };

  const getIcon = () => {
    switch (trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return '→';
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 ${getColor()}`}>
      <span className="text-xl font-bold">{getIcon()}</span>
      {showPercentage && change !== undefined && (
        <span className="text-sm font-mono font-semibold">
          {Math.abs(change).toFixed(2)}%
        </span>
      )}
    </div>
  );
}