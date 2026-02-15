// src/app/components/groups/ForecastsGroup.tsx
'use client';

import { Tab } from '@headlessui/react';

interface ForecastsGroupProps {
  ForecastsTab: React.ReactNode;
  RevenueForecastTab: React.ReactNode;
}

export default function ForecastsGroup({
  ForecastsTab,
  RevenueForecastTab,
}: ForecastsGroupProps) {
  const subtabs = ['Analyst Forecasts', 'Revenue Forecast'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-green-400">Forecasts & Estimates</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? 'bg-green-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{ForecastsTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{RevenueForecastTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
