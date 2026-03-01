'use client';

import Link from 'next/link';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  linkTo?: string;
  className?: string;
}

const sizes = {
  sm: { icon: 'w-8 h-8', text: 'text-lg', iconInner: 'text-xs' },
  md: { icon: 'w-10 h-10', text: 'text-xl', iconInner: 'text-sm' },
  lg: { icon: 'w-12 h-12', text: 'text-2xl', iconInner: 'text-base' },
  xl: { icon: 'w-16 h-16', text: 'text-3xl', iconInner: 'text-lg' },
};

export default function Logo({
  size = 'md',
  showText = true,
  linkTo = '/',
  className = ''
}: LogoProps) {
  const { icon, text, iconInner } = sizes[size];

  const LogoContent = () => (
    <div className={`flex items-center gap-3 ${className}`}>
      <PrismoIcon className={icon} innerClassName={iconInner} />
      {showText && (
        <span className={`${text} font-black bg-linear-to-r from-green-600 via-green-500 to-emerald-400 bg-clip-text text-transparent tracking-tight`}>
          Prismo
        </span>
      )}
    </div>
  );

  if (linkTo) {
    return (
      <Link href={linkTo} className="hover:opacity-90 transition">
        <LogoContent />
      </Link>
    );
  }

  return <LogoContent />;
}

// The P icon — black bg, green P
export function PrismoIcon({
  className = 'w-10 h-10',
  innerClassName = 'text-sm',
}: {
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div className={`${className} rounded-xl bg-black flex items-center justify-center shadow-[0_0_15px_rgba(0,166,81,0.3)] border border-emerald-500/30 ring-1 ring-green-500/20 hover:ring-green-500/50 transition-all`}>
      <span className={`${innerClassName} font-black bg-linear-to-b from-green-400 to-emerald-500 bg-clip-text text-transparent tracking-tighter`}>
        P
      </span>
    </div>
  );
}

// Compact version for tight spaces
export function LogoCompact({ className = '' }: { className?: string }) {
  return (
    <div className={`w-8 h-8 rounded-lg bg-black flex items-center justify-center border border-emerald-500/30 ${className}`}>
      <span className="text-xs font-black bg-linear-to-b from-green-400 to-emerald-500 bg-clip-text text-transparent">P</span>
    </div>
  );
}
