// src/app/components/groups/InputsGroup.tsx
'use client';

import { Tab } from '@headlessui/react';

interface InputsGroupProps {
  SustainableGrowthTab: React.ReactNode;
  BetaTab: React.ReactNode;
  CAGRTab: React.ReactNode;
  PivotsTab: React.ReactNode;
  WACCTab: React.ReactNode;
}

export default function InputsGroup({
  SustainableGrowthTab,
  BetaTab,
  CAGRTab,
  PivotsTab,
  WACCTab,
}: InputsGroupProps) {
  const subtabs = ['Sustainable Growth', 'Beta', 'CAGR', 'Pivots', 'WACC'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-yellow-400">Inputs & Análisis Técnico</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? tab === 'Pivots'
                      ? 'bg-purple-600 text-white shadow-lg'
                      : 'bg-yellow-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{SustainableGrowthTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{BetaTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{CAGRTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{PivotsTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{WACCTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
