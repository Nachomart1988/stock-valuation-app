// src/app/components/groups/FinancialStatementsGroup.tsx
'use client';

import { Tab } from '@headlessui/react';

interface FinancialStatementsGroupProps {
  IncomeTab: React.ReactNode;
  BalanceTab: React.ReactNode;
  CashFlowTab: React.ReactNode;
}

export default function FinancialStatementsGroup({
  IncomeTab,
  BalanceTab,
  CashFlowTab,
}: FinancialStatementsGroupProps) {
  const subtabs = ['Income Statement', 'Balance Sheet', 'Cash Flow'];

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-bold text-blue-400">Financial Statements</h3>

      <Tab.Group>
        <Tab.List className="flex gap-2 bg-gray-700/50 p-2 rounded-lg">
          {subtabs.map((tab) => (
            <Tab
              key={tab}
              className={({ selected }) =>
                `flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  selected
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-600 text-gray-300 hover:bg-gray-500 hover:text-white'
                }`
              }
            >
              {tab}
            </Tab>
          ))}
        </Tab.List>

        <Tab.Panels className="mt-4">
          <Tab.Panel unmount={false}>{IncomeTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{BalanceTab}</Tab.Panel>
          <Tab.Panel unmount={false}>{CashFlowTab}</Tab.Panel>
        </Tab.Panels>
      </Tab.Group>
    </div>
  );
}
