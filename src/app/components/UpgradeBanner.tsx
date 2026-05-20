'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/i18n/LanguageContext';

const FEATURE_LABELS_ES: Record<string, string> = {
  analizar: 'el analizador de acciones',
  diario: 'el Diario del Inversor',
  screener: 'el Screener',
  'market-sentiment': 'el análisis de mercado',
  earnings: 'el calendario de earnings',
};

const FEATURE_LABELS_EN: Record<string, string> = {
  analizar: 'the stock analyzer',
  diario: 'the Investor Journal',
  screener: 'the Screener',
  'market-sentiment': 'market sentiment analysis',
  earnings: 'the earnings calendar',
};

export default function UpgradeBanner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useLanguage();
  const es = locale === 'es';

  const upgrade = searchParams.get('upgrade');
  const from = searchParams.get('from') || '';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(upgrade === '1');
  }, [upgrade]);

  if (!visible) return null;

  const featureLabel = es
    ? (FEATURE_LABELS_ES[from] || 'esta funcionalidad')
    : (FEATURE_LABELS_EN[from] || 'this feature');

  const dismiss = () => {
    setVisible(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('upgrade');
    params.delete('from');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname || '/');
  };

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,640px)] px-4">
      <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/90 to-yellow-950/90 backdrop-blur-md shadow-[0_0_30px_rgba(245,158,11,0.15)] p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <span className="text-lg">🔒</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-100">
              {es
                ? `Necesitas un plan de pago para usar ${featureLabel}.`
                : `You need a paid plan to use ${featureLabel}.`}
            </p>
            <p className="text-xs text-amber-200/70 mt-1">
              {es
                ? 'El plan Free solo da acceso a la página de inicio. Actualiza para desbloquear el análisis completo.'
                : 'The Free plan only includes the home page. Upgrade to unlock the full analyzer.'}
            </p>
            <div className="flex gap-2 mt-3">
              <Link
                href="/pricing"
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 text-xs font-bold transition"
              >
                {es ? 'Ver planes' : 'View plans'}
              </Link>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded-lg text-amber-200/80 hover:text-amber-100 text-xs font-medium transition"
              >
                {es ? 'Cerrar' : 'Dismiss'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
