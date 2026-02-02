import { useState, useEffect, useCallback } from 'react';

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
      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      if (!apiKey) throw new Error('FMP_API_KEY no está configurada');

      const base = 'https://financialmodelingprep.com/stable';
      const params = `?symbol=${ticker}&apikey=${apiKey}`;

      const fetchJson = async (endpoint: string, extra = '') => {
        const res = await fetch(`${base}/${endpoint}${params}${extra}`, { 
          cache: 'no-store' 
        });
        
        if (!res.ok) {
          throw new Error(`${endpoint} falló: ${res.status}`);
        }
        
        const json = await res.json();
        return Array.isArray(json) ? json : [json];
      };

      const [
        quoteData,
        profileData,
        incomeData,
        balanceData,
        cashFlowData,
        priceTargetData,
        estimatesData,
      ] = await Promise.all([
        fetchJson('quote'),
        fetchJson('profile'),
        fetchJson('income-statement', '&limit=10'),
        fetchJson('balance-sheet-statement', '&limit=10'),
        fetchJson('cash-flow-statement', '&limit=10'),
        fetchJson('price-target-summary'),
        fetchJson('analyst-estimates', '&period=annual&limit=10'),
      ]);

      let dcfStandardData: any = [];
      let dcfCustomData: any = [];

      try {
        const dcfStandardRes = await fetch(`${base}/discounted-cash-flow${params}`, { 
          cache: 'no-store' 
        });
        if (dcfStandardRes.ok) {
          dcfStandardData = await dcfStandardRes.json();
        }
      } catch (err) {
        console.warn('DCF Standard data unavailable:', err);
      }

      try {
        const dcfCustomRes = await fetch(`${base}/custom-discounted-cash-flow${params}`, { 
          cache: 'no-store' 
        });
        if (dcfCustomRes.ok) {
          dcfCustomData = await dcfCustomRes.json();
        }
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