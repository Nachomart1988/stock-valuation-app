// src/app/components/groups/GeneralInfoGroup.tsx
'use client';

import { Tab } from '@headlessui/react';

interface GeneralInfoGroupProps {
  AnalisisGeneralTab: React.ReactNode;
  KeyMetricsTab: React.ReactNode;
  AnalistasTab: React.ReactNode;
  DuPontTab: React.ReactNode;
}

export default function GeneralInfoGroup({
  AnalisisGeneralTab,
  KeyMetricsTab,
  AnalistasTab,
  DuPontTab,
}: GeneralInfoGroupProps) {
  const subtabs = ['Análisis General', 'Key Metrics', 'Analistas', 'DuPont Analysis'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-emerald-400">Información General</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? 'bg-emerald-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{AnalisisGeneralTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{KeyMetricsTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{AnalistasTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{DuPontTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
