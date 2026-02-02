import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  color?: 'blue' | 'teal' | 'gold' | 'red' | 'purple';
  icon?: React.ReactNode;
}

export function StatCard({ label, value, subtitle, color = 'blue', icon }: StatCardProps) {
  const colorClasses = {
    blue: 'from-accent-blue/20 to-accent-blue/5 border-accent-blue/30',
    teal: 'from-accent-teal/20 to-accent-teal/5 border-accent-teal/30',
    gold: 'from-accent-gold/20 to-accent-gold/5 border-accent-gold/30',
    red: 'from-accent-red/20 to-accent-red/5 border-accent-red/30',
    purple: 'from-accent-purple/20 to-accent-purple/5 border-accent-purple/30',
  };

  const textColorClasses = {
    blue: 'text-accent-blue',
    teal: 'text-accent-teal',
    gold: 'text-accent-gold',
    red: 'text-accent-red',
    purple: 'text-accent-purple',
  };

  return (
  <div className={`relative overflow-hidden rounded-2xl border bg-linear-to-br ${colorClasses[color]} p-6`}>
      {icon && (
        <div className="absolute top-4 right-4 opacity-20">
          <div className="w-12 h-12">{icon}</div>
        </div>
      )}
      <div className="relative">
        <p className="text-sm font-medium text-neutral-300 mb-2">{label}</p>
        <p className={`text-4xl font-bold ${textColorClasses[color]} mb-1`}>
          {value}
        </p>
        {subtitle && (
          <p className="text-sm text-neutral-400">{subtitle}</p>
        )}
      </div>
    </div>
  );
}