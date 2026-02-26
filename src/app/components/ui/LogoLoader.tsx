'use client';

interface LogoLoaderProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  message?: string;
  fullPage?: boolean;
}

const dims = {
  sm: { icon: 'w-10 h-10', inner: 'text-sm', ring: 'w-14 h-14' },
  md: { icon: 'w-14 h-14', inner: 'text-lg', ring: 'w-20 h-20' },
  lg: { icon: 'w-18 h-18', inner: 'text-2xl', ring: 'w-24 h-24' },
  xl: { icon: 'w-24 h-24', inner: 'text-3xl', ring: 'w-32 h-32' },
};

export function LogoLoader({ size = 'md', message, fullPage = false }: LogoLoaderProps) {
  const { icon, inner, ring } = dims[size];

  const Loader = () => (
    <div className="flex flex-col items-center gap-5">
      <div className="relative flex items-center justify-center">
        {/* outer ping ring */}
        <div className={`absolute ${ring} rounded-2xl bg-emerald-500/15 animate-ping`} style={{ animationDuration: '1.8s' }} />
        {/* inner glow ring */}
        <div className={`absolute ${ring} rounded-2xl bg-emerald-400/10 animate-pulse`} style={{ animationDuration: '1.2s' }} />
        {/* P icon */}
        <div className={`relative z-10 ${icon} rounded-xl bg-black flex items-center justify-center shadow-lg shadow-emerald-500/30 border border-emerald-500/30 animate-pulse`} style={{ animationDuration: '1.5s' }}>
          <span className={`${inner} font-black bg-linear-to-b from-green-400 to-emerald-500 bg-clip-text text-transparent tracking-tighter`}>
            P
          </span>
        </div>
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
