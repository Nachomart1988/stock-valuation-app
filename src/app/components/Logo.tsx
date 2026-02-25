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
  sm: { icon: 'w-8 h-8', text: 'text-lg', px: 32 },
  md: { icon: 'w-10 h-10', text: 'text-xl', px: 40 },
  lg: { icon: 'w-12 h-12', text: 'text-2xl', px: 48 },
  xl: { icon: 'w-16 h-16', text: 'text-3xl', px: 64 },
};

export default function Logo({
  size = 'md',
  showText = true,
  linkTo = '/',
  className = ''
}: LogoProps) {
  const { icon, text, px } = sizes[size];

  const LogoContent = () => (
    <div className={`flex items-center gap-3 ${className}`}>
      <Image
        src="/Logo P.png"
        alt="Prismo"
        width={px}
        height={px}
        className={`${icon} object-contain`}
      />
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

// Compact version for tight spaces
export function LogoCompact({ className = '' }: { className?: string }) {
  return (
    <Image
      src="/Logo P.png"
      alt="Prismo"
      width={32}
      height={32}
      className={`w-8 h-8 object-contain ${className}`}
    />
  );
}
