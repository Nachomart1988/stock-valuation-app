import { useMemo } from 'react';

interface DuPontMetrics {
  date: string;
  roe: number;
  margin: number;
  turnover: number;
  multiplier: number;
}

export function useDuPontAnalysis(income: any[], balance: any[]): DuPontMetrics[] {
  return useMemo(() => {
    if (!income || !balance || income.length < 2 || balance.length < 2) {
      return [];
    }

    return income.map((inc, i) => {
      const bal = balance[i] || {};
      const netIncome = inc.netIncome || 0;
      const revenue = inc.revenue || 1;
      const assets = bal.totalAssets || 1;
      const equity = bal.totalStockholdersEquity || 1;

      const margin = (netIncome / revenue) * 100;
      const turnover = revenue / assets;
      const multiplier = assets / equity;
      const roe = (netIncome / equity) * 100;

      return {
        date: inc.date,
        roe: parseFloat(roe.toFixed(2)),
        margin: parseFloat(margin.toFixed(2)),
        turnover: parseFloat(turnover.toFixed(2)),
        multiplier: parseFloat(multiplier.toFixed(2)),
      };
    });
  }, [income, balance]);
}