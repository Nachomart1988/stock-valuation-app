// src/app/components/tabs/BetaTab.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface BetaTabProps {
  ticker: string;
  onAvgCAPMChange?: (avgCAPM: number | null) => void;
}

export default function BetaTab({ ticker, onAvgCAPMChange }: BetaTabProps) {
  const { t } = useLanguage();
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
        if (!apiKey) throw new Error(t('betaTab.apiKeyError'));

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
          let rfrValue = null;
          if (Array.isArray(treasuryJson) && treasuryJson.length > 0) {
            const latest = treasuryJson[0];
            rfrValue = latest.year10;
          }
          if (rfrValue !== null && !isNaN(Number(rfrValue))) {
            setRiskFreeRate(Number(rfrValue));
          } else {
            setRiskFreeRate(4.2);
          }
        } else {
          setRiskFreeRate(4.2);
        }

        // 4. Market Risk Premium
        const mrpRes = await fetch(
          `https://financialmodelingprep.com/stable/market-risk-premium?apikey=${apiKey}`
        );
        if (mrpRes.ok) {
          const mrpJson = await mrpRes.json();
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
            }
          }
          if (mrpValue !== null && !isNaN(Number(mrpValue))) {
            setMarketRiskPremium(Number(mrpValue));
          } else {
            setMarketRiskPremium(5.5);
          }
        } else {
          setMarketRiskPremium(5.5);
        }

      } catch (err: any) {
        console.error('Error en BetaTab:', err);
        setError(err.message || t('common.error'));
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

      const [stockRes, marketRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`),
        fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=SPY&from=${fromDate}&to=${toDate}&apikey=${apiKey}`),
      ]);

      if (!stockRes.ok || !marketRes.ok) return null;

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

      if (commonDates.length < 100) return null;

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

  // Calculate CAPM display function
  // CAPM Formula: Ke = Rf + β × ERP
  // FMP API returns marketRiskPremium as ERP (Rm - Rf), NOT as Rm
  // So we don't subtract Rf from it again
  const calculateCAPM = (beta: number | null) => {
    if (beta === null || riskFreeRate === null || marketRiskPremium === null) return '—';
    const capm = riskFreeRate + beta * marketRiskPremium;
    return capm.toFixed(2) + '%';
  };

  // Calculate CAPM helper function - must be before useMemo that uses it
  const calculateCAPMValue = (beta: number | null): number | null => {
    if (beta === null || riskFreeRate === null || marketRiskPremium === null) return null;
    // CAPM: Ke = Rf + β × ERP (marketRiskPremium IS the ERP, not Rm)
    return riskFreeRate + beta * marketRiskPremium;
  };

  // Calculate averages using useMemo - MUST be before any conditional returns!
  const { avgBeta, avgCAPM, validBetasCount } = useMemo(() => {
    const validBetas = [betaApi, betaUser || null, betaCalculated].filter(b => b !== null && b !== 0) as number[];
    const calculatedAvgBeta = validBetas.length > 0 ? validBetas.reduce((a, b) => a + b, 0) / validBetas.length : null;

    const validCAPMs = [calculateCAPMValue(betaApi), calculateCAPMValue(betaUser || null), calculateCAPMValue(betaCalculated)]
      .filter(c => c !== null) as number[];
    const calculatedAvgCAPM = validCAPMs.length > 0 ? validCAPMs.reduce((a, b) => a + b, 0) / validCAPMs.length : null;

    return { avgBeta: calculatedAvgBeta, avgCAPM: calculatedAvgCAPM, validBetasCount: validBetas.length };
  }, [betaApi, betaUser, betaCalculated, riskFreeRate, marketRiskPremium]);

  // Notify parent when avgCAPM changes - MUST be before any conditional returns!
  useEffect(() => {
    if (onAvgCAPMChange) {
      onAvgCAPMChange(avgCAPM);
    }
  }, [avgCAPM, onAvgCAPMChange]);

  // Now we can have conditional returns
  if (loading) {
    return <p className="text-xl text-gray-300 py-10 text-center">{t('betaTab.loading')}</p>;
  }

  if (error) {
    return <p className="text-xl text-red-400 py-10 text-center">{t('common.error')}: {error}</p>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-500 to-emerald-500 bg-clip-text text-transparent">
            {t('betaTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('betaTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-pink-900/40 to-emerald-900/40 px-4 py-2 rounded-xl border border-pink-600">
            <p className="text-xs text-pink-400">{t('betaTab.avgCapm')}</p>
            <p className="text-xl font-bold text-pink-400">
              {avgCAPM !== null ? avgCAPM.toFixed(2) + '%' : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Risk Free Rate y Market Risk Premium */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.06] shadow-lg text-center">
          <h4 className="text-lg font-semibold text-gray-400 mb-2">{t('betaTab.riskFreeRate')}</h4>
          <p className="text-5xl font-bold text-green-400">
            {riskFreeRate !== null ? riskFreeRate.toFixed(2) + '%' : '—'}
          </p>
        </div>

        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.06] shadow-lg text-center">
          <h4 className="text-lg font-semibold text-gray-400 mb-2">{t('betaTab.marketRiskPremium')}</h4>
          <p className="text-5xl font-bold text-emerald-400">
            {marketRiskPremium !== null ? marketRiskPremium.toFixed(2) + '%' : '—'}
          </p>
        </div>
      </div>

      {/* Betas + CAPM */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.06] shadow-lg text-center">
          <h4 className="text-lg font-semibold text-gray-400 mb-3">{t('betaTab.betaOfficial')}</h4>
          <p className="text-5xl font-bold text-green-400 mb-4">
            {betaApi !== null ? betaApi.toFixed(2) : '—'}
          </p>
          <p className="text-lg font-medium text-gray-400">
            {t('betaTab.capm')}: <span className="text-green-400">{calculateCAPM(betaApi)}</span>
          </p>
        </div>

        <div className="bg-gradient-to-br from-amber-900/20 to-orange-900/20 p-6 rounded-2xl border border-amber-600/50 shadow-lg text-center">
          <h4 className="text-lg font-semibold text-amber-400 mb-3">{t('betaTab.betaUser')}</h4>
          <div className="relative mb-4">
            <input
              type="number"
              step="0.01"
              value={betaUser || ''}
              onChange={(e) => setBetaUser(parseFloat(e.target.value) || 0)}
              className="w-full px-6 py-4 text-4xl text-center font-bold rounded-xl
                         bg-gray-900/80 border-2 border-amber-500/50
                         text-amber-400 placeholder-gray-600
                         focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 focus:outline-none
                         transition-all duration-200"
              placeholder="0.00"
            />
          </div>
          <p className="text-lg font-medium text-gray-400">
            {t('betaTab.capm')}: <span className="text-green-400">{calculateCAPM(betaUser)}</span>
          </p>
        </div>

        <div className="bg-gray-900 p-6 rounded-2xl border border-white/[0.06] shadow-lg text-center">
          <h4 className="text-lg font-semibold text-gray-400 mb-3">{t('betaTab.betaCalculated')}</h4>
          <p className="text-5xl font-bold text-green-400 mb-4">
            {betaCalculated !== null ? betaCalculated.toFixed(2) : '—'}
          </p>
          <p className="text-lg font-medium text-gray-400">
            {t('betaTab.capm')}: <span className="text-green-400">{calculateCAPM(betaCalculated)}</span>
          </p>
        </div>
      </div>

      {/* Average Beta and CAPM */}
      <div className="bg-gray-950 p-8 rounded-2xl border border-green-500">
        <h4 className="text-2xl font-bold text-green-400 mb-6 text-center">{t('betaTab.avgBeta')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-gray-800/50 p-6 rounded-xl text-center">
            <p className="text-gray-400 text-lg mb-2">{t('betaTab.avgBeta')}</p>
            <p className="text-5xl font-bold text-green-300">
              {avgBeta !== null ? avgBeta.toFixed(2) : '—'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {validBetasCount} beta(s)
            </p>
          </div>
          <div className="bg-gray-800/50 p-6 rounded-xl text-center">
            <p className="text-gray-400 text-lg mb-2">{t('betaTab.avgCapm')}</p>
            <p className="text-5xl font-bold text-pink-400">
              {avgCAPM !== null ? avgCAPM.toFixed(2) + '%' : '—'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Cost of Equity
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-500 text-center italic">
        {t('betaTab.formula')}
      </p>
    </div>
  );
}
