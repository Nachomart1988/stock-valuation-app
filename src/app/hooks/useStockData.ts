import { useState, useEffect, useCallback } from 'react';
import { fetchFmp } from '@/lib/fmpClient';

interface StockData {
  quote: any;
  profile: any;
  income: any[];
  balance: any[];
  cashFlow: any[];
  priceTarget: any;
  estimates: any[];
  dcfStandard: any;
  dcfCustom: any;
}

interface UseStockDataReturn {
  data: StockData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStockData(ticker: string): UseStockDataReturn {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!ticker) return;

    setLoading(true);
    setError(null);

    try {
      const [
        quoteData,
        profileData,
        incomeData,
        balanceData,
        cashFlowData,
        priceTargetData,
        estimatesData,
      ] = await Promise.all([
        fetchFmp('stable/quote', { symbol: ticker }),
        fetchFmp('stable/profile', { symbol: ticker }),
        fetchFmp('stable/income-statement', { symbol: ticker, limit: 10 }),
        fetchFmp('stable/balance-sheet-statement', { symbol: ticker, limit: 10 }),
        fetchFmp('stable/cash-flow-statement', { symbol: ticker, limit: 10 }),
        fetchFmp('stable/price-target-summary', { symbol: ticker }),
        fetchFmp('stable/analyst-estimates', { symbol: ticker, period: 'annual', limit: 10 }),
      ]);

      let dcfStandardData: any = [];
      let dcfCustomData: any = [];

      try {
        dcfStandardData = await fetchFmp('stable/discounted-cash-flow', { symbol: ticker });
      } catch (err) {
        console.warn('DCF Standard data unavailable:', err);
      }

      try {
        dcfCustomData = await fetchFmp('stable/custom-discounted-cash-flow', { symbol: ticker });
      } catch (err) {
        console.warn('DCF Custom data unavailable:', err);
      }

      setData({
        quote: quoteData[0] || {},
        profile: profileData[0] || {},
        income: incomeData || [],
        balance: balanceData || [],
        cashFlow: cashFlowData || [],
        priceTarget: priceTargetData[0] || {},
        estimates: estimatesData || [],
        dcfStandard: dcfStandardData[0] || dcfStandardData,
        dcfCustom: dcfCustomData[0] || dcfCustomData,
      });
    } catch (err) {
      setError((err as Error).message || 'Error al cargar datos');
      console.error('Error fetching stock data:', err);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}