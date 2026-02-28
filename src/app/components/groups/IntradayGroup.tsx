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

  const tabColor = (tab: string, selected: boolean) => {
    if (!selected) return 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white';
    if (tab === 'Gaps')     return 'bg-purple-600 text-white shadow-lg';
    if (tab === 'Momentum (Beta)') return 'bg-emerald-600 text-white shadow-lg';
    return 'bg-emerald-600 text-white shadow-lg';
  };

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-purple-400">
        {es ? '⚡ Intradiario & Análisis Técnico' : '⚡ Intraday & Technical Analysis'}
      </h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${tabColor(tab, selected)}`
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
