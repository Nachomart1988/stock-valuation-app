// src/app/components/groups/DCFGroup.tsx
'use client';

import { Tab } from '@headlessui/react';
import { useMemo, useEffect } from 'react';
import { LockedSubTab } from '@/app/components/LockedTab';
import type { PlanTier } from '@/lib/plans';

interface DCFGroupProps {
  CalculosTab: React.ReactNode;
  DCFTab: React.ReactNode;
  dcfStandard: any;
  dcfCustom: any;
  quote: any;
  valorIntrinseco?: number | null; // Valor Intrínseco from CalculosTab
  income?: any[];
  balance?: any[];
  cashFlow?: any[];
  lockedSubtabs?: number[];
  requiredPlan?: PlanTier;
  currentPlan?: PlanTier;
}

export default function DCFGroup({
  CalculosTab,
  DCFTab,
  dcfStandard,
  dcfCustom,
  quote,
  valorIntrinseco,
  lockedSubtabs = [],
  requiredPlan = 'pro',
  currentPlan = 'free',
}: DCFGroupProps) {
  const subtabs = ['Cálculos', 'DCF Models'];

  // Debug: Log the actual API values
  useEffect(() => {
    console.log('[DCFGroup] dcfStandard:', dcfStandard);
    console.log('[DCFGroup] dcfCustom:', dcfCustom);
  }, [dcfStandard, dcfCustom]);

  // Extract intrinsic values from different sources:
  // 1. Standard DCF: /stable/discounted-cash-flow returns { dcf: 120.25 } (already per share)
  const standardDCF = dcfStandard?.dcf || null;

  // 2. Custom DCF (Advanced): /stable/custom-discounted-cash-flow returns array
  // First element (most recent year) has equityValuePerShare
  const customDCF = dcfCustom?.equityValuePerShare || null;

  // 3. Valor Intrínseco: from CalculosTab (impliedValuePerShare from internal DCF calculation)
  // This is passed as a prop from CalculosTab

  const currentPrice = quote?.price || 0;

  // Average of ALL THREE DCF values (Standard, Custom/Advanced, and Valor Intrínseco from Cálculos)
  const avgIntrinsic = useMemo(() => {
    const values = [standardDCF, customDCF, valorIntrinseco].filter(v => v && isFinite(v) && v > 0);
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [standardDCF, customDCF, valorIntrinseco]);

  const formatValue = (value: number | null) => {
    if (!value || !isFinite(value)) return 'N/A';
    return '$' + value.toFixed(2);
  };

  const getUpsideColor = (intrinsic: number | null) => {
    if (!intrinsic || !currentPrice) return 'text-gray-400';
    const upside = ((intrinsic - currentPrice) / currentPrice) * 100;
    if (upside > 20) return 'text-green-400';
    if (upside > 0) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getUpside = (intrinsic: number | null) => {
    if (!intrinsic || !currentPrice) return null;
    return ((intrinsic - currentPrice) / currentPrice) * 100;
  };

  // Start at first unlocked sub-tab
  const defaultIndex = lockedSubtabs.includes(0) ? 1 : 0;

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-orange-400">DCF & Valuation Models</h3>

      {/* Intrinsic Values Header - 3 DCF sources + Average */}
      <div className="bg-gradient-to-r from-orange-900/20 to-red-900/20 p-4 rounded-xl border border-green-900/30 backdrop-blur-sm">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          <div>
            <div className="text-sm text-gray-400">Current Price</div>
            <div className="text-xl font-bold text-white">{formatValue(currentPrice)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-400">Standard DCF</div>
            <div className={`text-xl font-bold ${getUpsideColor(standardDCF)}`}>
              {formatValue(standardDCF)}
            </div>
            {standardDCF && currentPrice > 0 && (
              <div className="text-xs text-gray-500">
                {getUpside(standardDCF)?.toFixed(1)}% upside
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-gray-400">Advanced DCF</div>
            <div className={`text-xl font-bold ${getUpsideColor(customDCF)}`}>
              {formatValue(customDCF)}
            </div>
            {customDCF && currentPrice > 0 && (
              <div className="text-xs text-gray-500">
                {getUpside(customDCF)?.toFixed(1)}% upside
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-gray-400">Valor Intrínseco</div>
            <div className={`text-xl font-bold ${getUpsideColor(valorIntrinseco || null)}`}>
              {formatValue(valorIntrinseco || null)}
            </div>
            {valorIntrinseco && currentPrice > 0 && (
              <div className="text-xs text-gray-500">
                {getUpside(valorIntrinseco)?.toFixed(1)}% upside
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-gray-400">Avg Intrinsic</div>
            <div className={`text-xl font-bold ${getUpsideColor(avgIntrinsic)}`}>
              {formatValue(avgIntrinsic)}
            </div>
            {avgIntrinsic && currentPrice > 0 && (
              <div className="text-xs text-gray-500">
                {getUpside(avgIntrinsic)?.toFixed(1)}% upside
              </div>
            )}
          </div>
        </div>
      </div>

      <Tab.Group defaultIndex={defaultIndex}>
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
          <Tab.Panel unmount={false}>
            {lockedSubtabs.includes(0) ? <LockedSubTab requiredPlan={requiredPlan} currentPlan={currentPlan} /> : CalculosTab}
          </Tab.Panel>
          <Tab.Panel unmount={false}>{DCFTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
