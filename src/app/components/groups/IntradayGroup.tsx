// src/app/components/groups/IntradayGroup.tsx
'use client';

import { Tab } from '@headlessui/react';

interface IntradayGroupProps {
  PivotsTab: React.ReactNode;
  GapsTab: React.ReactNode;
}

export default function IntradayGroup({
  PivotsTab,
  GapsTab,
}: IntradayGroupProps) {
  const subtabs = ['Pivots', 'Gaps'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-purple-400">⚡ Intraday & Análisis Técnico</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? tab === 'Gaps'
                      ? 'bg-purple-600 text-white shadow-lg'
                      : 'bg-emerald-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
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
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
