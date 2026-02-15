// src/app/components/groups/DCFGroup.tsx
'use client';

import { Tab } from '@headlessui/react';
import { useMemo, useEffect } from 'react';

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
}

export default function DCFGroup({
  CalculosTab,
  DCFTab,
  dcfStandard,
  dcfCustom,
  quote,
  valorIntrinseco,
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

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-orange-400">DCF & Valuation Models</h3>

      {/* Intrinsic Values Header - 3 DCF sources + Average */}
      <div className="bg-gradient-to-r from-orange-900/40 to-red-900/40 p-4 rounded-xl border border-orange-500">
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

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? 'bg-orange-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{CalculosTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{DCFTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
