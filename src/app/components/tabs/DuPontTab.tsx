'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface DuPontTabProps {
  income: any[];
  balance: any[];
  ticker: string;
}


function getArrow(current: string, previous: string) {
  const curr = parseFloat(current);
  const prev = parseFloat(previous);
  if (curr > prev) return <span className="text-green-400 ml-2">▲</span>;
  if (curr < prev) return <span className="text-red-400 ml-2">▼</span>;
  return <span className="text-gray-400 ml-2">―</span>;
}

export default function DuPontTab({ income, balance, ticker }: DuPontTabProps) {
  const { t } = useLanguage();

  if (income.length < 2 || balance.length < 2) {
    return <p className="text-2xl text-gray-400 text-center py-10">{t('dupontTab.insufficientData')}</p>;
  }

  const rows = income.map((inc, i) => {
    const bal = balance[i] || {};
    const netIncome = inc.netIncome || 0;
    const revenue = inc.revenue || 1;
    const assets = bal.totalAssets || 1;
    const equity = bal.totalStockholdersEquity || 1;

    const margin = (netIncome / revenue) * 100;
    const turnover = revenue / assets;
    const multiplier = assets / equity;
    const roe = margin * turnover * multiplier;

    return {
      date: inc.date,
      roe: roe.toFixed(2),
      margin: margin.toFixed(2),
      turnover: turnover.toFixed(2),
      multiplier: multiplier.toFixed(2),
    };
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {t('dupontTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('dupontTab.subtitle')} {ticker}</p>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="text-right bg-black/80 px-4 py-2 rounded-xl border border-green-600">
              <p className="text-xs text-green-400">{t('dupontTab.currentRoe')}</p>
              <p className="text-xl font-bold text-green-400">{rows[0]?.roe || '—'}</p>
            </div>
          </div>
        )}
      </div>

      {/* DuPont Analysis Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-black/60">
            <tr>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.date')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.roe')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.netMargin')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.assetTurnover')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.equityMultiplier')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-green-900/15">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-black/50 transition">
                <td className="px-8 py-5 text-gray-300 text-lg">{row.date}</td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.roe} {i < rows.length - 1 && getArrow(row.roe, rows[i + 1].roe)}
                </td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.margin} {i < rows.length - 1 && getArrow(row.margin, rows[i + 1].margin)}
                </td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.turnover} {i < rows.length - 1 && getArrow(row.turnover, rows[i + 1].turnover)}
                </td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.multiplier} {i < rows.length - 1 && getArrow(row.multiplier, rows[i + 1].multiplier)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
