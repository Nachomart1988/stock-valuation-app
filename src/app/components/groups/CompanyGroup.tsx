// src/app/components/groups/CompanyGroup.tsx
'use client';

import { Tab } from '@headlessui/react';
import { LockedSubTab } from '@/app/components/LockedTab';
import type { PlanTier } from '@/lib/plans';

interface CompanyGroupProps {
  CompetidoresTab: React.ReactNode;
  IndustryTab: React.ReactNode;
  SegmentationTab: React.ReactNode;
  HoldersTab: React.ReactNode;
  lockedSubtabs?: number[];
  requiredPlan?: PlanTier;
  currentPlan?: PlanTier;
}

export default function CompanyGroup({
  CompetidoresTab,
  IndustryTab,
  SegmentationTab,
  HoldersTab,
  lockedSubtabs = [],
  requiredPlan = 'pro',
  currentPlan = 'free',
}: CompanyGroupProps) {
  const subtabs = ['Competidores', 'Industry', 'Segmentation', 'Holders'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-emerald-400">Compañía</h3>

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
          <Tab.Panel unmount={false}>{CompetidoresTab}</Tab.Panel>
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(1) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : IndustryTab}
          </Tab.Panel>
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(2) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : SegmentationTab}
          </Tab.Panel>
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(3) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : HoldersTab}
          </Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
