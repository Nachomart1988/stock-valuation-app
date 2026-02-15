// src/app/components/groups/CompanyGroup.tsx
'use client';

import { Tab } from '@headlessui/react';

interface CompanyGroupProps {
  CompetidoresTab: React.ReactNode;
  IndustryTab: React.ReactNode;
  SegmentationTab: React.ReactNode;
  HoldersTab: React.ReactNode;
}

export default function CompanyGroup({
  CompetidoresTab,
  IndustryTab,
  SegmentationTab,
  HoldersTab,
}: CompanyGroupProps) {
  const subtabs = ['Competidores', 'Industry', 'Segmentation', 'Holders'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-cyan-400">Compañía</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? 'bg-cyan-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{CompetidoresTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{IndustryTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{SegmentationTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{HoldersTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
