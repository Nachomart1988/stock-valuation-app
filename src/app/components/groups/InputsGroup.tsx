// src/app/components/groups/InputsGroup.tsx
'use client';

import { Tab } from '@headlessui/react';
import { LockedSubTab } from '@/app/components/LockedTab';
import type { PlanTier } from '@/lib/plans';

interface InputsGroupProps {
  SustainableGrowthTab: React.ReactNode;
  BetaTab: React.ReactNode;
  CAGRTab: React.ReactNode;
  WACCTab: React.ReactNode;
  lockedSubtabs?: number[];
  requiredPlan?: PlanTier;
  currentPlan?: PlanTier;
}

export default function InputsGroup({
  SustainableGrowthTab,
  BetaTab,
  CAGRTab,
  WACCTab,
  lockedSubtabs = [],
  requiredPlan = 'pro',
  currentPlan = 'free',
}: InputsGroupProps) {
  const subtabs = ['Sustainable Growth', 'Beta', 'CAGR', 'WACC'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-indigo-400">📊 Inputs & Análisis Fundamental</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-black/60 backdrop-blur-sm border border-green-900/20 p-1.5 rounded-xl">
          {subtabs.map((tab, i) => (
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
            {lockedSubtabs.includes(3) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : WACCTab}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
