// src/app/components/PlanBadge.tsx
import type { PlanTier } from '@/lib/plans';

const BADGE_STYLES: Record<PlanTier, { background: string; color: string; border: string; textShadow: string }> = {
  free: {
    background: 'linear-gradient(180deg, #6ee7b7 0%, #10b981 45%, #059669 100%)',
    color: '#fff',
    border: '1px solid #34d399',
    textShadow: '0 1px 1px rgba(0,0,0,0.3)',
  },
  pro: {
    background: 'linear-gradient(180deg, #93c5fd 0%, #3b82f6 45%, #1d4ed8 100%)',
    color: '#fff',
    border: '1px solid #60a5fa',
    textShadow: '0 1px 1px rgba(0,0,0,0.35)',
  },
  elite: {
    background: 'linear-gradient(180deg, #f8fafc 0%, #fecdd3 25%, #e2e8f0 60%, #94a3b8 100%)',
    color: '#475569',
    border: '1px solid #fda4af',
    textShadow: '0 1px 0 rgba(255,255,255,0.8)',
  },
  gold: {
    background: 'linear-gradient(180deg, #fef08a 0%, #facc15 30%, #d97706 65%, #92400e 100%)',
    color: '#1c1917',
    border: '1px solid #fbbf24',
    textShadow: '0 1px 0 rgba(255,255,255,0.5)',
  },
};

const RELIEF_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 6px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)';

interface PlanBadgeProps {
  plan: PlanTier;
  size?: 'sm' | 'md';
  className?: string;
}

export default function PlanBadge({ plan, size = 'sm', className = '' }: PlanBadgeProps) {
  const style = BADGE_STYLES[plan] ?? BADGE_STYLES.free;
  const padding = size === 'md' ? '4px 12px' : '2px 8px';
  const fontSize = size === 'md' ? '0.75rem' : '0.65rem';

  return (
    <span
      className={`inline-block font-extrabold uppercase tracking-widest rounded-full select-none ${className}`}
      style={{
        background: style.background,
        color: style.color,
        border: style.border,
        textShadow: style.textShadow,
        boxShadow: RELIEF_SHADOW,
        padding,
        fontSize,
        letterSpacing: '0.12em',
      }}
    >
      {plan}
    </span>
  );
}
