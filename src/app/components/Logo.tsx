'use client';

import Link from 'next/link';
import Image from 'next/image';

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

  // Check if custom logo exists - replace with actual logo path when available
  const hasCustomLogo = false; // Set to true when logo is added to /public/logo.png
  const logoPath = '/logo.png';

  const LogoContent = () => (
    <div className={`flex items-center gap-3 ${className}`}>
      {hasCustomLogo ? (
        <Image
          src={logoPath}
          alt="Prismo"
          width={size === 'sm' ? 32 : size === 'md' ? 40 : size === 'lg' ? 48 : 64}
          height={size === 'sm' ? 32 : size === 'md' ? 40 : size === 'lg' ? 48 : 64}
          className={`${icon} rounded-xl`}
        />
      ) : (
        <div className={`${icon} rounded-xl bg-gradient-to-br from-green-600 via-green-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/30`}>
          <span className={`${iconInner} font-black text-white tracking-tighter`}>P</span>
        </div>
      )}
      {showText && (
        <span className={`${text} font-black bg-gradient-to-r from-green-600 via-green-500 to-emerald-400 bg-clip-text text-transparent tracking-tight`}>
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

// Compact version for tight spaces
export function LogoCompact({ className = '' }: { className?: string }) {
  return (
    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br from-green-600 via-green-500 to-emerald-400 flex items-center justify-center ${className}`}>
      <span className="text-xs font-black text-white">P</span>
    </div>
  );
}
