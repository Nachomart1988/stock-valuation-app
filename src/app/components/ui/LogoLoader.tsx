'use client';

import Image from 'next/image';

interface LogoLoaderProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  message?: string;
  fullPage?: boolean;
}

const dims = {
  sm: { px: 40, ring: 'w-14 h-14' },
  md: { px: 56, ring: 'w-20 h-20' },
  lg: { px: 72, ring: 'w-24 h-24' },
  xl: { px: 96, ring: 'w-32 h-32' },
};

export function LogoLoader({ size = 'md', message, fullPage = false }: LogoLoaderProps) {
  const { px, ring } = dims[size];

  const Loader = () => (
    <div className="flex flex-col items-center gap-5">
      <div className="relative flex items-center justify-center">
        {/* outer ping ring */}
        <div className={`absolute ${ring} rounded-2xl bg-emerald-500/15 animate-ping`} style={{ animationDuration: '1.8s' }} />
        {/* inner glow ring */}
        <div className={`absolute ${ring} rounded-2xl bg-emerald-400/10 animate-pulse`} style={{ animationDuration: '1.2s' }} />
        {/* logo */}
        <Image
          src="/Logo P.png"
          alt="Prismo"
          width={px}
          height={px}
          className="relative z-10 object-contain drop-shadow-[0_0_12px_rgba(52,211,153,0.5)] animate-pulse"
          style={{ animationDuration: '1.5s' }}
        />
      </div>
      {message && <p className="text-sm text-neutral-400">{message}</p>}
    </div>
  );

  if (fullPage) {
    return (
      <div className="min-h-screen bg-primary-900 flex items-center justify-center">
        <div className="text-center">
          <Loader />
          {!message && <p className="text-sm text-neutral-400 mt-6">Esto puede tomar unos segundos</p>}
        </div>
      </div>
    );
  }

  return <Loader />;
}
