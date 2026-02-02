// src/app/components/tabs/BetaTab.tsx
'use client';

import { useEffect, useState } from 'react';

export default function BetaTab({ ticker }: { ticker: string }) {
  const [betaApi, setBetaApi] = useState<number | null>(null);
  const [betaUser, setBetaUser] = useState<number>(0);
  const [betaCalculated, setBetaCalculated] = useState<number | null>(null);

  const [riskFreeRate, setRiskFreeRate] = useState<number | null>(null);
  const [marketRiskPremium, setMarketRiskPremium] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBetaData = async () => {
      try {
        setLoading(true);
        setError(null);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('FMP_API_KEY no configurada');

        // 1. Beta oficial (de profile)
        const profileRes = await fetch(
          `https://financialmodelingprep.com/stable/profile?symbol=${ticker}&apikey=${apiKey}`
        );
        if (profileRes.ok) {
          const json = await profileRes.json();
          if (Array.isArray(json) && json[0]?.beta !== undefined) {
            setBetaApi(json[0].beta);
          }
        }

        // 2. Beta calculado manual
        const calculated = await calculateManualBeta(ticker, apiKey);
        setBetaCalculated(calculated);

        // 3. Risk Free Rate (10Y Treasury)
        const treasuryRes = await fetch(
          `https://financialmodelingprep.com/stable/treasury-rates?apikey=${apiKey}`
        );
        if (treasuryRes.ok) {
          const treasuryJson = await treasuryRes.json();
          console.log('[RFR] Respuesta completa treasury-rates:', treasuryJson);

          let rfrValue = null;
          if (Array.isArray(treasuryJson) && treasuryJson.length > 0) {
            const latest = treasuryJson[0];
            rfrValue = latest.year10;
            console.log('[RFR] Valor year10 encontrado:', rfrValue);
          }

          if (rfrValue !== null && !isNaN(Number(rfrValue))) {
            setRiskFreeRate(Number(rfrValue));
          } else {
            console.warn('[RFR] No se encontró year10 válido');
            setRiskFreeRate(4.2);
          }
        } else {
          console.warn('[RFR] Treasury fetch falló:', treasuryRes.status);
          setRiskFreeRate(4.2);
        }

        // 4. Market Risk Premium
        const mrpRes = await fetch(
          `https://financialmodelingprep.com/stable/market-risk-premium?apikey=${apiKey}`
        );
        if (mrpRes.ok) {
          const mrpJson = await mrpRes.json();
          console.log('[MRP] Respuesta completa market-risk-premium:', mrpJson);

          let mrpValue = null;
          if (Array.isArray(mrpJson)) {
            const usEntry = mrpJson.find((item: any) =>
              item.country === 'United States' ||
              item.country === 'USA' ||
              item.country === 'US' ||
              item.countryCode === 'US'
            );
            if (usEntry) {
              mrpValue = usEntry.totalEquityRiskPremium ||
                         usEntry.equityRiskPremium ||
                         usEntry.marketRiskPremium ||
                         usEntry.premium ||
                         usEntry.value;
              console.log('[MRP] Valor encontrado para US:', mrpValue);
            }
          }

          if (mrpValue !== null && !isNaN(Number(mrpValue))) {
            setMarketRiskPremium(Number(mrpValue));
          } else {
            console.warn('[MRP] No se encontró valor válido para US');
            setMarketRiskPremium(5.5);
          }
        } else {
          console.warn('[MRP] MRP fetch falló:', mrpRes.status);
          setMarketRiskPremium(5.5);
        }

      } catch (err: any) {
        console.error('Error en BetaTab:', err);
        setError(err.message || 'Error al cargar datos');
      } finally {
        setLoading(false);
      }
    };

    fetchBetaData();
  }, [ticker]);

  const calculateManualBeta = async (symbol: string, apiKey: string): Promise<number | null> => {
    try {
      const today = new Date();
      const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
      const fromDate = fiveYearsAgo.toISOString().split('T')[0];
      const toDate = today.toISOString().split('T')[0];

      console.log(`[BetaCalc] Calculando beta ${symbol} vs SPY (${fromDate} → ${toDate})`);

      const [stockRes, marketRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=SPY&from=${fromDate}&to=${toDate}&apikey=${apiKey}`),
      ]);

      if (!stockRes.ok || !marketRes.ok) {
        console.error('[BetaCalc] Fetch falló:', stockRes.status, marketRes.status);
        return null;
      }

      const stockData = await stockRes.json();
      const marketData = await marketRes.json();

      const normalizeDate = (date: any): string | null => {
        if (!date || typeof date !== 'string') return null;
        const match = date.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : null;
      };

      const stockPrices = new Map<string, number>();
      stockData.forEach((item: any) => {
        const date = normalizeDate(item.date);
        const price = Number(item.price);
        if (date && !isNaN(price) && price > 0) {
          stockPrices.set(date, price);
        }
      });

      const spyPrices = new Map<string, number>();
      marketData.forEach((item: any) => {
        const date = normalizeDate(item.date);
        const price = Number(item.price);
        if (date && !isNaN(price) && price > 0) {
          spyPrices.set(date, price);
        }
      });

      const commonDates = [...stockPrices.keys()]
        .filter(date => spyPrices.has(date))
        .sort((a, b) => a.localeCompare(b));

      if (commonDates.length < 100) {
        console.warn('[BetaCalc] Insuficientes fechas comunes válidas (mínimo 100)');
        return null;
      }

      const stockCloses = commonDates.map(date => stockPrices.get(date)!);
      const spyCloses = commonDates.map(date => spyPrices.get(date)!);

      const stockReturns: number[] = [];
      const spyReturns: number[] = [];

      for (let i = 1; i < stockCloses.length; i++) {
        const sRet = (stockCloses[i] - stockCloses[i - 1]) / stockCloses[i - 1];
        const mRet = (spyCloses[i] - spyCloses[i - 1]) / spyCloses[i - 1];
        if (isFinite(sRet) && isFinite(mRet)) {
          stockReturns.push(sRet);
          spyReturns.push(mRet);
        }
      }

      if (stockReturns.length < 50) return null;

      const meanStock = stockReturns.reduce((a, b) => a + b, 0) / stockReturns.length;
      const meanSpy = spyReturns.reduce((a, b) => a + b, 0) / spyReturns.length;

      let cov = 0;
      let varSpy = 0;
      for (let i = 0; i < stockReturns.length; i++) {
        const ds = stockReturns[i] - meanStock;
        const dm = spyReturns[i] - meanSpy;
        cov += ds * dm;
        varSpy += dm * dm;
      }
      cov /= stockReturns.length - 1;
      varSpy /= stockReturns.length - 1;

      if (varSpy <= 0 || !isFinite(cov)) return null;

      return cov / varSpy;

    } catch (err) {
      console.error('[BetaCalc] Error:', err);
      return null;
    }
  };

  const calculateCAPM = (beta: number | null) => {
    if (beta === null || riskFreeRate === null || marketRiskPremium === null) return '—';
    const capm = riskFreeRate + beta * (marketRiskPremium - riskFreeRate);
    return capm.toFixed(2) + '%';
  };

  if (loading) {
    return <p className="text-xl text-gray-600 py-10 text-center">Cargando betas y CAPM...</p>;
  }

  if (error) {
    return <p className="text-xl text-red-600 py-10 text-center">Error: {error}</p>;
  }

  return (
    <div className="space-y-10">
      <h3 className="text-3xl font-bold text-gray-900">
        Beta de {ticker}
      </h3>

      {/* Risk Free Rate y Market Risk Premium arriba */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-blue-100/70 p-6 rounded-xl border border-blue-300 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center">
          <h4 className="text-xl font-semibold text-gray-800 mb-2">Risk Free Rate (10Y Treasury)</h4>
          <p className="text-5xl font-extrabold text-blue-950">
            {riskFreeRate !== null ? riskFreeRate.toFixed(2) + '%' : '—'}
          </p>
        </div>

        <div className="bg-purple-100/70 p-6 rounded-xl border border-purple-300 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center">
          <h4 className="text-xl font-semibold text-gray-800 mb-2">Market Risk Premium</h4>
          <p className="text-5xl font-extrabold text-purple-950">
            {marketRiskPremium !== null ? marketRiskPremium.toFixed(2) + '%' : '—'}
          </p>
        </div>
      </div>

      {/* Betas + CAPM */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-indigo-100/70 p-6 rounded-xl border border-indigo-300 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center">
          <h4 className="text-xl font-semibold text-gray-800 mb-3">Beta Oficial (FMP)</h4>
          <p className="text-5xl font-extrabold text-indigo-950 mb-4">
            {betaApi !== null ? betaApi.toFixed(2) : '—'}
          </p>
          <p className="text-lg font-medium text-gray-700">
            CAPM: {calculateCAPM(betaApi)}
          </p>
        </div>

        <div className="bg-gray-100/70 p-6 rounded-xl border border-gray-300 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center">
          <h4 className="text-xl font-semibold text-gray-800 mb-3">Beta Usuario</h4>
          <input
            type="number"
            step="0.01"
            value={betaUser}
            onChange={(e) => setBetaUser(parseFloat(e.target.value) || 0)}
            className="w-full px-4 py-3 text-2xl text-center border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-indigo-500 mb-4 bg-white text-gray-900"
            placeholder="0.00"
          />
          <p className="text-5xl font-extrabold text-gray-900">
            {betaUser.toFixed(2)}
          </p>
          <p className="text-lg font-medium text-gray-700 text-center">
            CAPM: {calculateCAPM(betaUser)}
          </p>
        </div>

        <div className="bg-green-100/70 p-6 rounded-xl border border-green-300 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center">
          <h4 className="text-xl font-semibold text-gray-800 mb-3">Beta Calculado (5 años vs SPY)</h4>
          <p className="text-5xl font-extrabold text-green-950 mb-4">
            {betaCalculated !== null ? betaCalculated.toFixed(2) : '—'}
          </p>
          <p className="text-lg font-medium text-gray-700">
            CAPM: {calculateCAPM(betaCalculated)}
          </p>
        </div>
      </div>

      <p className="text-sm text-gray-500 text-center">
        CAPM = Risk Free Rate + Beta × (Market Risk Premium - Risk Free Rate)
      </p>
    </div>
  );
}