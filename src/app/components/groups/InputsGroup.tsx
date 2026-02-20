// src/app/components/groups/InputsGroup.tsx
'use client';

import { Tab } from '@headlessui/react';
import { LockedSubTab } from '@/app/components/LockedTab';
import type { PlanTier } from '@/lib/plans';

interface InputsGroupProps {
  SustainableGrowthTab: React.ReactNode;
  BetaTab: React.ReactNode;
  CAGRTab: React.ReactNode;
  PivotsTab: React.ReactNode;
  WACCTab: React.ReactNode;
  GapsTab?: React.ReactNode;
  lockedSubtabs?: number[];
  requiredPlan?: PlanTier;
  currentPlan?: PlanTier;
}

export default function InputsGroup({
  SustainableGrowthTab,
  BetaTab,
  CAGRTab,
  PivotsTab,
  WACCTab,
  GapsTab,
  lockedSubtabs = [],
  requiredPlan = 'pro',
  currentPlan = 'free',
}: InputsGroupProps) {
  const subtabs = ['Sustainable Growth', 'Beta', 'CAGR', 'Pivots', 'WACC', 'Gaps'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-purple-400">⚡ Intraday & Análisis Técnico</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab, i) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? tab === 'Gaps'
                      ? 'bg-purple-600 text-white shadow-lg'
                      : tab === 'Pivots'
                        ? 'bg-emerald-600 text-white shadow-lg'
                        : 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}{lockedSubtabs.includes(i) ? ' 🔒' : ''}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{SustainableGrowthTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{BetaTab}</Tab.Panel>
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(2) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : CAGRTab}
          </Tab.Panel>
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(3) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : PivotsTab}
          </Tab.Panel>
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(4) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : WACCTab}
          </Tab.Panel>
          <Tab.Panel unmount={false}>
            {GapsTab}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
