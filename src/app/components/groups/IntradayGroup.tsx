// src/app/components/groups/IntradayGroup.tsx
'use client';

import { Tab } from '@headlessui/react';
import { useLanguage } from '@/i18n/LanguageContext';

interface IntradayGroupProps {
  PivotsTab:   React.ReactNode;
  GapsTab:     React.ReactNode;
  MomentumTab: React.ReactNode;
}

export default function IntradayGroup({
  PivotsTab,
  GapsTab,
  MomentumTab,
}: IntradayGroupProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';

  const subtabs = [
    'Pivots',
    'Gaps',
    es ? 'Momentum (Beta)' : 'Momentum (Beta)',
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-purple-400">
        {es ? '⚡ Intradiario & Análisis Técnico' : '⚡ Intraday & Technical Analysis'}
      </h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-black/60 backdrop-blur-sm border border-green-900/20 p-1.5 rounded-xl">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? 'bg-green-900/30 text-green-400 border border-green-500/40 shadow-[0_0_12px_rgba(0,166,81,0.15)]'
                    : 'text-gray-500 hover:text-green-400/70 hover:bg-green-900/10 border border-transparent'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{PivotsTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{GapsTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{MomentumTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
