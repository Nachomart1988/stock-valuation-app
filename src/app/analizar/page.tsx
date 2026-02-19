'use client';

import { Tab } from '@headlessui/react';
import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import Header from '@/app/components/Header';
import { useLanguage } from '@/i18n/LanguageContext';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import CompetidoresTab from '@/app/components/tabs/CompetidoresTab';
import BetaTab from '@/app/components/tabs/BetaTab';
import ForecastsTab from '@/app/components/tabs/ForecastsTab';
import CalculosTab from '@/app/components/tabs/CalculosTab';
import RevenueForecastTab from '@/app/components/tabs/RevenueForecastTab';
import SustainableGrowthTab from '@/app/components/tabs/SustainableGrowthTab';
import ValuacionesTab from '@/app/components/tabs/ValuacionesTab';
import ProbabilityTab from '@/app/components/tabs/ProbabilityTab';
// AnalisisFinalTab removed as per user request
import WACCTab from '@/app/components/tabs/WACCTab';
import CAGRTab from '@/app/components/tabs/CAGRTab';
import NoticiasTab from '@/app/components/tabs/NoticiasTab';
import KeyMetricsTab from '@/app/components/tabs/KeyMetricsTab';
import SegmentationTab from '@/app/components/tabs/SegmentationTab';
import IndustryTab from '@/app/components/tabs/IndustryTab';
import HoldersTab from '@/app/components/tabs/HoldersTab';
import DuPontTab from '@/app/components/tabs/DuPontTab';
import DiarioInversorTab from '@/app/components/tabs/DiarioInversorTab';
import PivotsTab from '@/app/components/tabs/PivotsTab';
import ResumenTab from '@/app/components/tabs/ResumenTab';

// Group components for reorganized layout
import FinancialStatementsGroup from '@/app/components/groups/FinancialStatementsGroup';
import ForecastsGroup from '@/app/components/groups/ForecastsGroup';
import GeneralInfoGroup from '@/app/components/groups/GeneralInfoGroup';
import CompanyGroup from '@/app/components/groups/CompanyGroup';
import InputsGroup from '@/app/components/groups/InputsGroup';
import DCFGroup from '@/app/components/groups/DCFGroup';

// Plan access control
import LockedTab from '@/app/components/LockedTab';
import PlanBadge from '@/app/components/PlanBadge';
import {
  type PlanTier,
  TAB_MIN_PLAN,
  GENERAL_INFO_ACCESS,
  COMPANY_ACCESS,
  INPUTS_ACCESS,
  DCF_ACCESS,
  canAccessTab,
  canAccessSubTab,
} from '@/lib/plans';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// ===== Currency Conversion to USD =====
// Fields that are absolute monetary values (need conversion)
const MONETARY_FIELDS = new Set([
  // Quote
  'price', 'previousClose', 'dayHigh', 'dayLow', 'yearHigh', 'yearLow',
  'marketCap', 'open', 'priceAvg50', 'priceAvg200', 'eps',
  // Income Statement
  'revenue', 'costOfRevenue', 'grossProfit', 'operatingExpenses',
  'costAndExpenses', 'operatingIncome', 'interestExpense', 'interestIncome',
  'ebitda', 'netIncome', 'incomeBeforeTax', 'incomeTaxExpense',
  'sellingAndMarketingExpenses', 'generalAndAdministrativeExpenses',
  'researchAndDevelopmentExpenses', 'depreciationAndAmortization',
  'weightedAverageShsOut', 'weightedAverageShsOutDil',
  'epsdiluted', 'operatingIncomeRatio',
  // Balance Sheet
  'totalAssets', 'totalLiabilities', 'totalEquity', 'totalStockholdersEquity',
  'cashAndCashEquivalents', 'cashAndShortTermInvestments', 'shortTermInvestments',
  'netReceivables', 'inventory', 'totalCurrentAssets', 'totalCurrentLiabilities',
  'propertyPlantEquipmentNet', 'goodwill', 'intangibleAssets', 'longTermDebt',
  'shortTermDebt', 'totalDebt', 'netDebt', 'otherAssets', 'otherLiabilities',
  'retainedEarnings', 'commonStock', 'totalInvestments', 'capitalLeaseObligations',
  'accumulatedOtherComprehensiveIncomeLoss', 'othertotalStockholdersEquity',
  'taxPayables', 'deferredRevenue', 'otherCurrentAssets', 'otherCurrentLiabilities',
  'otherNonCurrentAssets', 'otherNonCurrentLiabilities', 'longTermInvestments',
  'taxAssets', 'preferredStock', 'minorityInterest',
  // Cash Flow
  'operatingCashFlow', 'freeCashFlow', 'capitalExpenditure',
  'netCashUsedForInvestingActivites', 'netCashUsedProvidedByFinancingActivities',
  'netCashProvidedByOperatingActivities', 'netChangeInCash',
  'dividendsPaid', 'commonStockRepurchased', 'commonStockIssued',
  'debtRepayment', 'purchasesOfInvestments', 'salesMaturitiesOfInvestments',
  'acquisitionsNet', 'changeInWorkingCapital',
  // Key Metrics
  'revenuePerShare', 'netIncomePerShare', 'operatingCashFlowPerShare',
  'freeCashFlowPerShare', 'cashPerShare', 'bookValuePerShare',
  'tangibleBookValuePerShare', 'interestDebtPerShare',
  'marketCap', 'enterpriseValue', 'workingCapital',
  'tangibleAssetValue', 'netCurrentAssetValue',
  // Enterprise Value
  'stockPrice', 'addTotalDebt', 'minusCashAndCashEquivalents',
  // DCF
  'dcf', 'stockPrice',
  // Price Target
  'priceTarget', 'priceTargetHigh', 'priceTargetLow', 'priceTargetAvg', 'priceTargetMedian',
  'lastPrice', 'lastPriceAvg',
  // Owner Earnings
  'ownerEarnings', 'growthCapex', 'maintenanceCapex', 'averageOwnerEarnings',
  // Dividends
  'dividend', 'adjDividend',
  // Estimates
  'estimatedRevenueLow', 'estimatedRevenueHigh', 'estimatedRevenueAvg',
  'estimatedEbitdaLow', 'estimatedEbitdaHigh', 'estimatedEbitdaAvg',
  'estimatedEpsLow', 'estimatedEpsHigh', 'estimatedEpsAvg',
  'estimatedNetIncomeLow', 'estimatedNetIncomeHigh', 'estimatedNetIncomeAvg',
  'estimatedSgaExpenseLow', 'estimatedSgaExpenseHigh', 'estimatedSgaExpenseAvg',
  // Profile
  'mktCap', 'lastDiv', 'volAvg',
]);

// Fields that are ratios/percentages and should NOT be converted
const RATIO_FIELDS = new Set([
  'pe', 'peRatio', 'priceToBookRatio', 'priceToSalesRatio', 'priceEarningsRatio',
  'priceToFreeCashFlowsRatio', 'priceEarningsToGrowthRatio',
  'enterpriseValueOverEBITDA', 'evToSales', 'evToOperatingCashFlow', 'evToFreeCashFlow',
  'debtToEquity', 'debtToAssets', 'debtRatio', 'currentRatio', 'quickRatio', 'cashRatio',
  'grossProfitMargin', 'operatingProfitMargin', 'netProfitMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapitalEmployed', 'roic',
  'dividendYield', 'payoutRatio', 'beta', 'change', 'changesPercentage',
  'grossProfitRatio', 'operatingIncomeRatio', 'incomeBeforeTaxRatio', 'netIncomeRatio',
  'effectiveTaxRate', 'interestCoverage',
]);

function convertMonetaryValue(value: any, rate: number): any {
  if (typeof value !== 'number' || isNaN(value)) return value;
  return value * rate;
}

function convertObjectToUSD(obj: any, rate: number): any {
  if (!obj || typeof obj !== 'object' || rate === 1) return obj;
  const converted = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(converted)) {
    if (RATIO_FIELDS.has(key)) continue; // Skip ratios
    if (MONETARY_FIELDS.has(key)) {
      converted[key] = convertMonetaryValue(converted[key], rate);
    }
  }
  return converted;
}

function convertArrayToUSD(arr: any[], rate: number): any[] {
  if (!arr || rate === 1) return arr;
  return arr.map(item => convertObjectToUSD(item, rate));
}

async function fetchExchangeRate(fromCurrency: string, apiKey: string): Promise<number> {
  if (!fromCurrency || fromCurrency === 'USD') return 1;
  try {
    // FMP stable/fx returns: { ticker: "EURUSD", bid, ask, open, ... } — no "price" field
    const res = await fetch(
      `https://financialmodelingprep.com/stable/fx?apikey=${apiKey}`,
      { cache: 'no-store' }
    );
    if (!res.ok) {
      console.warn(`[Currency] Failed to fetch FX rates: ${res.status}`);
      return 1;
    }
    const fxData = await res.json();
    // Helper to extract rate from FMP fx object — close is the settled daily price
    const extractRate = (p: any): number | null => {
      const v = p?.close ?? p?.bid ?? p?.ask ?? p?.open ?? p?.price ?? p?.last;
      return typeof v === 'number' && v > 0 ? v : null;
    };
    // Look for direct pair, e.g. EURUSD or EUR/USD
    const pair = fxData.find?.((p: any) =>
      p.ticker === `${fromCurrency}USD` || p.ticker === `${fromCurrency}/USD` ||
      p.name === `${fromCurrency}/USD`
    );
    const directRate = extractRate(pair);
    if (directRate) {
      console.log(`[Currency] ${fromCurrency}/USD rate: ${directRate}`);
      return directRate;
    }
    // Try inverse pair USD/XXX
    const inversePair = fxData.find?.((p: any) =>
      p.ticker === `USD${fromCurrency}` || p.ticker === `USD/${fromCurrency}` ||
      p.name === `USD/${fromCurrency}`
    );
    const inverseRate = extractRate(inversePair);
    if (inverseRate) {
      const rate = 1 / inverseRate;
      console.log(`[Currency] ${fromCurrency}/USD rate (inverse of USD${fromCurrency}): ${rate}`);
      return rate;
    }
    console.warn(`[Currency] Could not find FX pair for ${fromCurrency}/USD in ${fxData?.length ?? 0} records`);
    return 1;
  } catch (err) {
    console.error('[Currency] Error fetching exchange rate:', err);
    return 1;
  }
}

// Helper function to extract ALL values from SEC JSON structure for a given key
function extractAllSECValues(data: any[], key: string): number[] {
  const values: number[] = [];
  if (!data) return values;
  for (const item of data) {
    if (item[key]) {
      const itemValues = item[key];
      if (Array.isArray(itemValues)) {
        for (const val of itemValues) {
          if (typeof val === 'number') {
            values.push(val);
          } else if (typeof val === 'string' && !isNaN(parseFloat(val)) && val.trim() !== '' && val.trim() !== ' ') {
            values.push(parseFloat(val));
          }
        }
      }
    }
  }
  return values;
}

// Helper function to extract first value from SEC JSON structure
function extractSECValue(data: any[], key: string): number | null {
  const values = extractAllSECValues(data, key);
  return values.length > 0 ? values[0] : null;
}

// Extract supplemental data from SEC Financial Reports
function extractSECData(reports: any[]): any {
  const result: any = {
    dividendsPerShare: {},
    dividendsPaid: {},
    leaseData: {},
    revenueBySegment: {},
    additionalMetrics: {},
  };

  console.log('[SEC Data] Processing', reports.length, 'reports');

  for (const report of reports) {
    if (!report || !report.year) continue;
    const year = report.year;
    const symbol = report.symbol || 'unknown';
    console.log(`[SEC Data] Processing year: ${year}, symbol: ${symbol}`);

    // Extract Dividends per share from various sections
    // Look in CONSOLIDATED STATEMENTS OF SHAREHOLDERS EQUITY or specific dividend sections
    const sections = Object.keys(report);

    for (const section of sections) {
      const sectionData = report[section];
      if (!Array.isArray(sectionData)) continue;

      // Dividends per share - get the MAX value (annual total from all quarters)
      const allDpsValues = extractAllSECValues(sectionData, 'Dividends and dividend equivalents declared per share or RSU (in dollars per share or RSU)');
      if (allDpsValues.length > 0) {
        // Take the highest value which is typically the annual dividend
        const maxDps = Math.max(...allDpsValues);
        if (!result.dividendsPerShare[year] || maxDps > result.dividendsPerShare[year]) {
          result.dividendsPerShare[year] = maxDps;
          console.log(`[SEC Data] Year ${year} - Dividends per share: $${maxDps}`);
        }
      }

      // Payments for dividends (from Cash Flow section) - get the value with largest absolute value
      const allDivPaidValues = extractAllSECValues(sectionData, 'Payments for dividends and dividend equivalents');
      if (allDivPaidValues.length > 0) {
        // Take the largest absolute value (dividends paid is negative in cash flow)
        const maxAbsDivPaid = Math.max(...allDivPaidValues.map(v => Math.abs(v)));
        if (!result.dividendsPaid[year] || maxAbsDivPaid > result.dividendsPaid[year]) {
          result.dividendsPaid[year] = maxAbsDivPaid;
          console.log(`[SEC Data] Year ${year} - Dividends paid: $${maxAbsDivPaid}M`);
        }
      }

      // Operating lease ROU assets
      const operatingLeaseROU = extractSECValue(sectionData, 'Operating lease right-of-use assets');
      if (operatingLeaseROU !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].operatingLeaseROU = operatingLeaseROU;
      }

      // Finance lease ROU assets
      const financeLeaseROU = extractSECValue(sectionData, 'Finance lease right-of-use assets');
      if (financeLeaseROU !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].financeLeaseROU = financeLeaseROU;
      }

      // Operating lease liabilities (current)
      const operatingLeaseLiabCurrent = extractSECValue(sectionData, 'Operating lease liabilities, current');
      if (operatingLeaseLiabCurrent !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].operatingLeaseLiabilitiesCurrent = operatingLeaseLiabCurrent;
      }

      // Operating lease liabilities (non-current)
      const operatingLeaseLiabNonCurrent = extractSECValue(sectionData, 'Operating lease liabilities, non-current');
      if (operatingLeaseLiabNonCurrent !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].operatingLeaseLiabilitiesNonCurrent = operatingLeaseLiabNonCurrent;
      }

      // Finance lease liabilities (current)
      const financeLeaseLiabCurrent = extractSECValue(sectionData, 'Finance lease liabilities, current');
      if (financeLeaseLiabCurrent !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].financeLeaseLiabilitiesCurrent = financeLeaseLiabCurrent;
      }

      // Finance lease liabilities (non-current)
      const financeLeaseLiabNonCurrent = extractSECValue(sectionData, 'Finance lease liabilities, non-current');
      if (financeLeaseLiabNonCurrent !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].financeLeaseLiabilitiesNonCurrent = financeLeaseLiabNonCurrent;
      }

      // Total lease liabilities
      const totalLeaseLiab = extractSECValue(sectionData, 'Total lease liabilities');
      if (totalLeaseLiab !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].totalLeaseLiabilities = totalLeaseLiab;
      }

      // Fixed operating lease costs
      const fixedLeaseCosts = extractSECValue(sectionData, 'Fixed operating lease costs');
      if (fixedLeaseCosts !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].fixedOperatingLeaseCosts = fixedLeaseCosts;
      }

      // Variable lease costs
      const variableLeaseCosts = extractSECValue(sectionData, 'Variable lease costs');
      if (variableLeaseCosts !== null) {
        if (!result.leaseData[year]) result.leaseData[year] = {};
        result.leaseData[year].variableLeaseCosts = variableLeaseCosts;
      }

      // Revenue by segment (Products vs Services)
      if (section.includes('STATEMENTS OF OPER')) {
        const productsRevenue = extractSECValue(sectionData, 'Net sales');
        // Look for Products section specifically
        let inProducts = false;
        let inServices = false;
        for (const item of sectionData) {
          if (item['Products']) inProducts = true;
          if (item['Services']) {
            inProducts = false;
            inServices = true;
          }
          if (inProducts && item['Net sales']) {
            const vals = item['Net sales'];
            if (Array.isArray(vals) && typeof vals[0] === 'number') {
              if (!result.revenueBySegment[year]) result.revenueBySegment[year] = {};
              result.revenueBySegment[year].products = vals[0];
            }
          }
          if (inServices && item['Net sales']) {
            const vals = item['Net sales'];
            if (Array.isArray(vals) && typeof vals[0] === 'number') {
              if (!result.revenueBySegment[year]) result.revenueBySegment[year] = {};
              result.revenueBySegment[year].services = vals[0];
            }
          }
        }
      }

      // Interest and dividend income
      const interestDividendIncome = extractSECValue(sectionData, 'Interest and dividend income');
      if (interestDividendIncome !== null) {
        if (!result.additionalMetrics[year]) result.additionalMetrics[year] = {};
        result.additionalMetrics[year].interestAndDividendIncome = interestDividendIncome;
      }
    }
  }

  return result;
}

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

function getArrow(curr: string, prev: string) {
  const c = parseFloat(curr);
  const p = parseFloat(prev);
  if (c > p) return <span className="text-green-400 font-bold ml-3 text-xl">↑</span>;
  if (c < p) return <span className="text-red-400 font-bold ml-3 text-xl">↓</span>;
  return <span className="text-gray-500 ml-3 text-xl">→</span>;
}

function AnalizarContent() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const { user, isSignedIn } = useUser();

  // Force-refresh user data on mount so publicMetadata is never stale after a plan change
  useEffect(() => {
    user?.reload();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const userPlan = ((user?.publicMetadata?.plan as PlanTier) || 'free');
  const [ticker, setTicker] = useState('');
  const [activeTicker, setActiveTicker] = useState(''); // El ticker activo para el cual se cargaron los datos
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedAverageVal, setSharedAverageVal] = useState<number | null>(null);
  const [sharedSGR, setSharedSGR] = useState<number | null>(null);
  const [sharedAvgCAPM, setSharedAvgCAPM] = useState<number | null>(null);
  const [sharedValorIntrinseco, setSharedValorIntrinseco] = useState<number | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  // States for ResumenTab
  const [sharedAdvanceValueNet, setSharedAdvanceValueNet] = useState<any>(null);
  const [sharedCagrStats, setSharedCagrStats] = useState<{ avgCagr: number | null; minCagr: number | null; maxCagr: number | null } | null>(null);
  const [sharedCompanyQualityNet, setSharedCompanyQualityNet] = useState<any>(null);
  const [sharedWACC, setSharedWACC] = useState<number | null>(null);
  const [sharedNews, setSharedNews] = useState<any[]>([]);
  const [sharedHoldersData, setSharedHoldersData] = useState<any>(null);
  const [sharedPivotAnalysis, setSharedPivotAnalysis] = useState<any>(null);
  const [sharedForecasts, setSharedForecasts] = useState<any[]>([]);
  const [sharedKeyMetricsSummary, setSharedKeyMetricsSummary] = useState<any>(null);
  const [sharedMonteCarlo, setSharedMonteCarlo] = useState<any>(null);
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [currencyInfo, setCurrencyInfo] = useState<{ original: string; rate: number } | null>(null);

  // Cargar ticker desde URL solo al inicio
  useEffect(() => {
    const urlTicker = searchParams.get('ticker');
    if (urlTicker && initialLoad) {
      const upperTicker = urlTicker.toUpperCase();
      setTicker(upperTicker);
      setActiveTicker(upperTicker);
      setInitialLoad(false);
    }
  }, [searchParams, initialLoad]);

  // Handle ?tab= query param to jump to a specific tab on load
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (!urlTab) return;
    const tabMap: Record<string, number> = {
      diario: 10,       // Investor Journal
      summary: 11,      // Resumen Maestro
      valuaciones: 8,   // Valuaciones
      inicio: 0,
    };
    const idx = tabMap[urlTab.toLowerCase()];
    if (idx !== undefined) setSelectedTabIndex(idx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Función para analizar un ticker (llamada desde InputsTab)
  const handleAnalizar = (newTicker: string) => {
    const upperTicker = newTicker.toUpperCase().trim();
    if (!upperTicker) return;
    setActiveTicker(upperTicker);
    setTicker(upperTicker);
    setData(null);
    setSharedAverageVal(null);
  };

  useEffect(() => {
    if (!activeTicker) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setSharedAverageVal(null); // Reset averageVal cuando se cargan nuevos datos
      console.log('[AnalizarContent] Fetching data for ticker:', activeTicker);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('FMP_API_KEY no está configurada');

        const base = 'https://financialmodelingprep.com/stable';
        const params = `?symbol=${activeTicker}&apikey=${apiKey}`;

        const fetchJson = async (endpoint: string, extra = '') => {
          const res = await fetch(`${base}/${endpoint}${params}${extra}`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`${endpoint} falló: ${res.status}`);
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
          // TTM data
          incomeTTMData,
          balanceTTMData,
          cashFlowTTMData,
          // As-reported data for dividends
          cashFlowAsReportedData,
          // Dividend history for per-share calculations
          dividendsData,
        ] = await Promise.all([
          fetchJson('quote'),
          fetchJson('profile'),
          fetchJson('income-statement', '&limit=10'),
          fetchJson('balance-sheet-statement', '&limit=10'),
          fetchJson('cash-flow-statement', '&limit=10'),
          fetchJson('price-target-summary'),
          fetchJson('analyst-estimates', '&period=annual&limit=10'),
          // Fetch TTM statements
          fetchJson('income-statement-ttm').catch(() => []),
          fetchJson('balance-sheet-statement-ttm').catch(() => []),
          fetchJson('cash-flow-statement-ttm').catch(() => []),
          // Fetch as-reported cash flow for accurate dividends data
          fetchJson('cash-flow-statement-as-reported', '&limit=10').catch(() => []),
          // Fetch dividend history for per-share dividend data
          fetchJson('dividends', '&limit=20').catch(() => []),
        ]);

        // Fetch additional as-reported statements and growth data
        const [
          incomeAsReportedData,
          balanceAsReportedData,
          incomeGrowthData,
          balanceGrowthData,
          cashFlowGrowthData,
          financialGrowthData,
        ] = await Promise.all([
          fetchJson('income-statement-as-reported', '&limit=10').catch(() => []),
          fetchJson('balance-sheet-statement-as-reported', '&limit=10').catch(() => []),
          fetchJson('income-statement-growth', '&limit=10').catch(() => []),
          fetchJson('balance-sheet-statement-growth', '&limit=10').catch(() => []),
          fetchJson('cash-flow-statement-growth', '&limit=10').catch(() => []),
          fetchJson('financial-growth', '&limit=10').catch(() => []),
        ]);

        // Fetch additional financial metrics (key-metrics, ratios, enterprise-value)
        const [
          keyMetricsData,
          keyMetricsTTMData,
          ratiosData,
          ratiosTTMData,
          enterpriseValueData,
          ownerEarningsData,
        ] = await Promise.all([
          fetchJson('key-metrics', '&limit=10').catch(() => []),
          fetchJson('key-metrics-ttm').catch(() => []),
          fetchJson('ratios', '&limit=10').catch(() => []),
          fetchJson('ratios-ttm').catch(() => []),
          fetchJson('enterprise-value', '&limit=10').catch(() => []),
          fetchJson('owner-earnings', '&limit=10').catch(() => []),
        ]);

        const dcfStandardRes = await fetch(`${base}/discounted-cash-flow${params}`, { cache: 'no-store' });
        let dcfStandardData: any = [];
        if (dcfStandardRes.ok) {
          try {
            dcfStandardData = await dcfStandardRes.json();
          } catch (parseErr) {
            console.error('Error parsing DCF Standard:', parseErr);
          }
        }

        const dcfCustomRes = await fetch(`${base}/custom-discounted-cash-flow${params}`, { cache: 'no-store' });
        let dcfCustomData: any = [];
        if (dcfCustomRes.ok) {
          try {
            dcfCustomData = await dcfCustomRes.json();
          } catch (parseErr) {
            console.error('Error parsing DCF Custom:', parseErr);
          }
        }

        // Fetch SEC Financial Reports for additional data (dividends per share, leases, etc.)
        // Fetch for last 5 years
        const currentYear = new Date().getFullYear();
        console.log(`[SEC Fetch] Fetching SEC data for ticker: ${activeTicker}, years: ${currentYear} to ${currentYear - 5}`);
        const secReportsPromises = [];
        for (let year = currentYear; year >= currentYear - 5; year--) {
          const secUrl = `${base}/financial-reports-json?symbol=${activeTicker}&year=${year}&period=FY&apikey=${apiKey}`;
          console.log(`[SEC Fetch] URL: ${secUrl.replace(apiKey, 'API_KEY_HIDDEN')}`);
          secReportsPromises.push(
            fetch(secUrl, { cache: 'no-store' })
              .then(res => res.ok ? res.json() : null)
              .catch(() => null)
          );
        }
        const secReportsData = await Promise.all(secReportsPromises);

        // Extract SEC supplemental data
        const secSupplementalData = extractSECData(secReportsData.filter(Boolean));

        console.log('[AnalizarContent] Data loaded for', activeTicker, '- Income records:', incomeData.length, '- Balance records:', balanceData.length);
        console.log('[AnalizarContent] Cash Flow As-Reported records:', cashFlowAsReportedData?.length || 0);
        console.log('[AnalizarContent] Dividends records:', dividendsData?.length || 0);
        if (dividendsData?.length > 0) {
          console.log('[AnalizarContent] Latest dividend:', dividendsData[0]);
        }
        // Store raw SEC reports for detailed display
        const secReportsRaw = secReportsData.filter(Boolean);
        console.log('[AnalizarContent] Raw SEC reports loaded:', secReportsRaw.length);

        console.log('[AnalizarContent] Key Metrics records:', keyMetricsData?.length || 0);
        console.log('[AnalizarContent] Ratios records:', ratiosData?.length || 0);
        console.log('[AnalizarContent] Enterprise Value records:', enterpriseValueData?.length || 0);
        console.log('[AnalizarContent] Owner Earnings records:', ownerEarningsData?.length || 0);

        // ===== Currency Conversion =====
        // Profile/quote currency — used for market prices (quote, priceTarget, profile)
        const profileCurrency = (profileData[0]?.currency || 'USD').toUpperCase();
        // Statement-level currency — may differ from profile (e.g. ADRs report in home currency)
        const statementCurrency = (
          incomeData[0]?.reportedCurrency ||
          incomeData[0]?.currency ||
          profileCurrency
        ).toUpperCase();

        let profileFxRate = 1;
        let stmtFxRate = 1;

        if (profileCurrency !== 'USD') {
          console.log(`[Currency] Profile currency: ${profileCurrency}, fetching rate...`);
          profileFxRate = await fetchExchangeRate(profileCurrency, apiKey);
        }
        if (statementCurrency !== 'USD') {
          if (statementCurrency === profileCurrency) {
            stmtFxRate = profileFxRate;
          } else {
            console.log(`[Currency] Statement currency: ${statementCurrency} (differs from profile ${profileCurrency}), fetching rate...`);
            stmtFxRate = await fetchExchangeRate(statementCurrency, apiKey);
          }
        }

        if (statementCurrency !== 'USD' || profileCurrency !== 'USD') {
          const displayCurrency = statementCurrency !== 'USD' ? statementCurrency : profileCurrency;
          const displayRate = statementCurrency !== 'USD' ? stmtFxRate : profileFxRate;
          setCurrencyInfo({ original: displayCurrency, rate: displayRate });
        } else {
          setCurrencyInfo(null);
        }

        // cx: for market price data (quote, profile, priceTarget)
        const cx = (obj: any) => convertObjectToUSD(obj, profileFxRate);
        // cxArr: for financial statement arrays (income, balance, cashFlow, etc.)
        const cxArr = (arr: any[]) => convertArrayToUSD(arr, stmtFxRate);
        // cxStmt: for single statement objects
        const cxStmt = (obj: any) => convertObjectToUSD(obj, stmtFxRate);

        setData({
          // Market price data — use profile/trading currency
          quote: cx(quoteData[0] || {}),
          profile: cx(profileData[0] || {}),
          priceTarget: cx(priceTargetData[0] || {}),
          dcfStandard: cx(dcfStandardData[0] || dcfStandardData),
          dcfCustom: cx(dcfCustomData[0] || dcfCustomData),
          // Financial statements — use reportedCurrency (may differ for ADRs)
          income: cxArr(incomeData || []),
          balance: cxArr(balanceData || []),
          cashFlow: cxArr(cashFlowData || []),
          estimates: cxArr(estimatesData || []),
          incomeTTM: cxStmt(incomeTTMData[0] || null),
          balanceTTM: cxStmt(balanceTTMData[0] || null),
          cashFlowTTM: cxStmt(cashFlowTTMData[0] || null),
          cashFlowAsReported: cxArr(cashFlowAsReportedData || []),
          dividends: cxArr(dividendsData || []),
          incomeAsReported: cxArr(incomeAsReportedData || []),
          balanceAsReported: cxArr(balanceAsReportedData || []),
          keyMetrics: cxArr(keyMetricsData || []),
          keyMetricsTTM: cxStmt(keyMetricsTTMData[0] || null),
          enterpriseValue: cxArr(enterpriseValueData || []),
          ownerEarnings: cxArr(ownerEarningsData || []),
          // Growth data (mostly ratios — no conversion needed)
          incomeGrowth: incomeGrowthData || [],
          balanceGrowth: balanceGrowthData || [],
          cashFlowGrowth: cashFlowGrowthData || [],
          financialGrowth: financialGrowthData || [],
          ratios: ratiosData || [],
          ratiosTTM: ratiosTTMData[0] || null,
          // SEC data (raw, not converted)
          secData: secSupplementalData,
          secReportsRaw: secReportsRaw,
        });
      } catch (err) {
        setError((err as Error).message || 'Error al cargar datos');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTicker]);

  // Fetch additional data for ResumenTab (news, holders, pivots, forecasts)
  useEffect(() => {
    if (!activeTicker) return;

    const fetchResumenData = async () => {
      const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
      if (!apiKey) return;

      try {
        // Fetch news
        const newsRes = await fetch(
          `https://financialmodelingprep.com/stable/news/stock?symbols=${activeTicker}&limit=20&apikey=${apiKey}`,
          { cache: 'no-store' }
        );
        if (newsRes.ok) {
          const newsData = await newsRes.json();
          setSharedNews(Array.isArray(newsData) ? newsData : []);
        }

        // Fetch comprehensive institutional holders data for Neural Resumen Engine
        // Including new endpoints: positions-summary, insider-stats, ownership-analytics
        const getLast4Quarters = () => {
          const quarters: string[] = [];
          const now = new Date();
          for (let i = 0; i < 4; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - (i * 3), 1);
            const year = date.getFullYear();
            const quarter = Math.floor(date.getMonth() / 3) + 1;
            quarters.push(`${year}-Q${quarter}`);
          }
          return quarters;
        };

        const quarters = getLast4Quarters();
        const [instRes, summaryRes, insiderStatsRes, analyticsRes, ...positionsResponses] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/institutional-holder?symbol=${activeTicker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/institutional-ownership/symbol-ownership-percent?symbol=${activeTicker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/insider-trading/statistics?symbol=${activeTicker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/institutional-ownership/extract-analytics/holder?symbol=${activeTicker}&apikey=${apiKey}`, { cache: 'no-store' }),
          ...quarters.map(q =>
            fetch(`https://financialmodelingprep.com/stable/symbol-positions-summary?symbol=${activeTicker}&quarter=${q}&apikey=${apiKey}`, { cache: 'no-store' })
          )
        ]);

        let holdersData: any = {
          institutionalHolders: [],
          ownershipSummary: null,
          positionsSummary: [],
          insiderStats: null,
          ownershipAnalytics: null
        };

        if (instRes.ok) {
          const instData = await instRes.json();
          holdersData.institutionalHolders = Array.isArray(instData) ? instData.slice(0, 25) : [];
        }
        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          holdersData.ownershipSummary = Array.isArray(summaryData) && summaryData.length > 0 ? summaryData[0] : null;
        }
        if (insiderStatsRes.ok) {
          const insiderData = await insiderStatsRes.json();
          holdersData.insiderStats = Array.isArray(insiderData) && insiderData.length > 0 ? insiderData[0] : insiderData;
        }
        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          holdersData.ownershipAnalytics = Array.isArray(analyticsData) && analyticsData.length > 0 ? analyticsData[0] : analyticsData;
        }

        // Process quarterly positions data
        for (let i = 0; i < positionsResponses.length; i++) {
          const res = positionsResponses[i];
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              holdersData.positionsSummary.push({
                quarter: quarters[i],
                ...data[0]
              });
            } else if (data && typeof data === 'object' && !Array.isArray(data)) {
              holdersData.positionsSummary.push({
                quarter: quarters[i],
                ...data
              });
            }
          }
        }

        console.log('[ResumenData] Enhanced holdersData for Neural Engine:', {
          hasInstitutional: holdersData.institutionalHolders?.length > 0,
          hasPositionsSummary: holdersData.positionsSummary?.length > 0,
          hasInsiderStats: !!holdersData.insiderStats,
          hasOwnershipAnalytics: !!holdersData.ownershipAnalytics
        });

        setSharedHoldersData(holdersData);

        // Fetch analyst forecasts
        const forecastRes = await fetch(
          `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${activeTicker}&period=annual&limit=10&apikey=${apiKey}`,
          { cache: 'no-store' }
        );
        if (forecastRes.ok) {
          const forecastData = await forecastRes.json();
          // Filter for future estimates
          const futureEstimates = (forecastData || [])
            .filter((est: any) => new Date(est.date) > new Date())
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
          setSharedForecasts(futureEstimates);
        }

        // Fetch historical prices for pivot analysis
        const priceRes = await fetch(
          `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${activeTicker}&apikey=${apiKey}`,
          { cache: 'no-store' }
        );
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          const historical = priceData?.historical || priceData || [];
          if (historical.length > 0) {
            // Calculate pivot points from recent data
            const recent = historical.slice(0, 252); // Last year
            const lastDay = recent[0];

            // Standard Pivot Point calculation
            const pivotPoint = (lastDay.high + lastDay.low + lastDay.close) / 3;
            const r1 = 2 * pivotPoint - lastDay.low;
            const s1 = 2 * pivotPoint - lastDay.high;
            const r2 = pivotPoint + (lastDay.high - lastDay.low);
            const s2 = pivotPoint - (lastDay.high - lastDay.low);

            // Calculate 52-week high/low
            const high52w = Math.max(...recent.map((d: any) => d.high));
            const low52w = Math.min(...recent.map((d: any) => d.low));

            // Fibonacci retracement levels
            const range = high52w - low52w;
            const fib236 = high52w - range * 0.236;
            const fib382 = high52w - range * 0.382;
            const fib500 = high52w - range * 0.500;
            const fib618 = high52w - range * 0.618;
            const fib786 = high52w - range * 0.786;

            setSharedPivotAnalysis({
              currentPrice: lastDay.close,
              pivotPoint,
              resistance: { R1: r1, R2: r2 },
              support: { S1: s1, S2: s2 },
              high52Week: high52w,
              low52Week: low52w,
              fibonacci: {
                level236: fib236,
                level382: fib382,
                level500: fib500,
                level618: fib618,
                level786: fib786,
              },
              priceVsHigh: ((lastDay.close / high52w) - 1) * 100,
              priceVsLow: ((lastDay.close / low52w) - 1) * 100,
            });
          }
        }

        console.log('[ResumenData] Fetched additional data for neural engine');
      } catch (err) {
        console.warn('[ResumenData] Error fetching additional data:', err);
      }
    };

    fetchResumenData();
  }, [activeTicker]);

  // Convert pivot analysis data to USD if needed
  const convertedPivotAnalysis = useMemo(() => {
    if (!sharedPivotAnalysis || !currencyInfo?.rate || currencyInfo.rate === 1) return sharedPivotAnalysis;
    const r = currencyInfo.rate;
    return {
      ...sharedPivotAnalysis,
      currentPrice: (sharedPivotAnalysis.currentPrice || 0) * r,
      pivotPoint: (sharedPivotAnalysis.pivotPoint || 0) * r,
      resistance: {
        R1: (sharedPivotAnalysis.resistance?.R1 || 0) * r,
        R2: (sharedPivotAnalysis.resistance?.R2 || 0) * r,
      },
      support: {
        S1: (sharedPivotAnalysis.support?.S1 || 0) * r,
        S2: (sharedPivotAnalysis.support?.S2 || 0) * r,
      },
      high52Week: (sharedPivotAnalysis.high52Week || 0) * r,
      low52Week: (sharedPivotAnalysis.low52Week || 0) * r,
      fibonacci: {
        level236: (sharedPivotAnalysis.fibonacci?.level236 || 0) * r,
        level382: (sharedPivotAnalysis.fibonacci?.level382 || 0) * r,
        level500: (sharedPivotAnalysis.fibonacci?.level500 || 0) * r,
        level618: (sharedPivotAnalysis.fibonacci?.level618 || 0) * r,
        level786: (sharedPivotAnalysis.fibonacci?.level786 || 0) * r,
      },
      // These are percentages - don't convert
      priceVsHigh: sharedPivotAnalysis.priceVsHigh,
      priceVsLow: sharedPivotAnalysis.priceVsLow,
    };
  }, [sharedPivotAnalysis, currencyInfo?.rate]);

  // Estado inicial - mostrar formulario de búsqueda
  if (!activeTicker || !data) {
    return (
      <main className="min-h-screen bg-gray-900 text-gray-100">
        <Header />
        <div className="max-w-2xl mx-auto pt-20 sm:pt-24 px-4 sm:px-8">
          <h1 className="text-3xl sm:text-5xl font-extrabold text-green-400 mb-6 sm:mb-8 text-center">
            Analizador de Acciones
          </h1>
          <div className="bg-gray-800 p-5 sm:p-8 md:p-10 rounded-2xl shadow-2xl border border-white/[0.06]">
            <label className="block text-base sm:text-xl font-semibold text-gray-200 mb-3 sm:mb-4">
              Ingresa el Ticker
            </label>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalizar(ticker)}
                placeholder="Ej: AAPL, MSFT, GOOGL"
                className="flex-1 px-4 sm:px-6 py-3 sm:py-4 text-lg sm:text-2xl border-2 border-white/[0.08] rounded-xl bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-green-500 placeholder-gray-500"
              />
              <button
                onClick={() => handleAnalizar(ticker)}
                disabled={!ticker.trim() || loading}
                className="px-6 sm:px-8 py-3 sm:py-4 bg-green-600 text-white text-base sm:text-xl font-bold rounded-xl hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Cargando...' : 'Analizar'}
              </button>
            </div>
            {loading && (
              <p className="mt-4 sm:mt-6 text-center text-green-400 text-base sm:text-lg">Cargando datos para {activeTicker}...</p>
            )}
            {error && (
              <div className="mt-4 sm:mt-6 p-4 bg-red-900/30 border border-red-600 rounded-xl">
                <p className="text-red-400 text-center text-sm sm:text-base">{error}</p>
                <p className="text-gray-400 text-center text-xs sm:text-sm mt-2">Revisa el ticker o intenta de nuevo.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-900">
        <Header />
        <div className="flex items-center justify-center pt-20 sm:pt-24 min-h-[80vh] px-4">
          <p className="text-lg sm:text-2xl font-bold text-green-400 text-center">{t('analysis.loadingData')} {activeTicker}...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-900">
        <Header />
        <div className="flex items-center justify-center pt-20 sm:pt-24 min-h-[80vh] px-4">
          <div className="text-center max-w-2xl">
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold text-red-500 mb-4 sm:mb-6">{t('common.error')}</h1>
            <p className="text-base sm:text-xl text-gray-300">{error}</p>
            <p className="mt-3 sm:mt-4 text-sm sm:text-lg text-gray-400">{t('analysis.errorLoadingData')}</p>
          </div>
        </div>
      </main>
    );
  }

  const { quote, profile, income, balance, cashFlow, priceTarget, estimates, dcfStandard, dcfCustom, incomeTTM, balanceTTM, cashFlowTTM, secData, secReportsRaw, cashFlowAsReported, dividends, incomeAsReported, balanceAsReported, incomeGrowth, balanceGrowth, cashFlowGrowth, financialGrowth, keyMetrics, keyMetricsTTM, ratios, ratiosTTM, enterpriseValue, ownerEarnings } = data;

  // PDF Export handler
  const handleExportPDF = async () => {
    if (pdfExporting) return;
    setPdfExporting(true);
    try {
      const { generateAnalysisPDF } = await import('@/app/utils/generateAnalysisPDF');
      await generateAnalysisPDF({
        ticker: activeTicker,
        profile,
        quote,
        income: income || [],
        balance: balance || [],
        cashFlow: cashFlow || [],
        incomeTTM,
        priceTarget: priceTarget || {},
        sharedAverageVal,
        sharedWACC,
        sharedAvgCAPM,
        sharedForecasts,
        sharedKeyMetricsSummary,
        sharedAdvanceValueNet,
        sharedCompanyQualityNet,
        sharedCagrStats,
        sharedPivotAnalysis,
      });
    } catch (err) {
      console.error('[PDF] Export error:', err);
      alert('Error al generar el PDF. Por favor intenta de nuevo.');
    } finally {
      setPdfExporting(false);
    }
  };

  // New simplified category structure
  const categories = [
    t('analysis.categories.inicio'),
    t('analysis.categories.financialStatements'),
    t('analysis.categories.forecasts'),
    t('analysis.categories.generalInfo'),
    t('analysis.categories.company'),
    t('analysis.categories.news'),
    t('analysis.categories.inputs'),
    t('analysis.categories.dcf'),
    t('analysis.categories.valuations'),
    t('analysis.categories.probability'),
    t('analysis.categories.summary'),
    t('analysis.categories.investorJournal'),
  ];

  return (
    <main className="min-h-screen bg-gray-900 text-gray-100">
      <Header />
      <div className="max-w-[1600px] mx-auto px-3 sm:px-5 md:px-8 pt-20 sm:pt-24 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5 sm:mb-8 md:mb-12">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-1 sm:mb-2">
              <h1 className="text-xl sm:text-3xl md:text-5xl font-extrabold text-green-400">
                {t('analysis.resultsFor')} {activeTicker}
              </h1>
              {/* Plan badge */}
              {isSignedIn && (
                <PlanBadge plan={userPlan} size="sm" className="shrink-0 self-center" />
              )}
            </div>
            <h2 className="text-base sm:text-xl md:text-3xl font-bold text-gray-300 truncate">
              {profile.companyName || t('analysis.company')}
            </h2>
          </div>
          {/* PDF Export Button — shown to all signed-in users */}
          {isSignedIn && (
            <button
              onClick={handleExportPDF}
              disabled={pdfExporting}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-700 to-emerald-700 hover:from-green-600 hover:to-emerald-600 text-white font-semibold rounded-xl border border-green-500 shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed shrink-0 text-sm"
              title="Download full investment analysis as PDF"
            >
              {pdfExporting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating PDF...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download PDF Report
                </>
              )}
            </button>
          )}
        </div>

        <Tab.Group selectedIndex={selectedTabIndex} onChange={setSelectedTabIndex}>
          {/* Tab bar: horizontal scroll on mobile, wrap on desktop */}
          <div className="relative mb-6 sm:mb-10">
            <div className="overflow-x-auto pb-1">
              <Tab.List className="flex gap-1.5 sm:gap-2 rounded-xl bg-gray-800 p-2 sm:p-3 min-w-max sm:min-w-0 sm:flex-wrap shadow-sm">
                {categories.map((category) => (
                  <Tab
                    key={category}
                    className={({ selected }) =>
                      classNames(
                        'shrink-0 rounded-lg sm:rounded-xl py-2 px-3 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold transition-all whitespace-nowrap',
                        'focus:outline-none focus:ring-2 focus:ring-green-500',
                        selected
                          ? 'bg-gray-700 text-white shadow-lg border-b-4 border-green-500'
                          : 'text-gray-400 hover:bg-gray-700 hover:text-white hover:shadow'
                      )
                    }
                  >
                    {category}
                  </Tab>
                ))}
              </Tab.List>
            </div>
          </div>

<Tab.Panels className="mt-2">
  {/* 1. Inicio */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <InicioTab
      ticker={activeTicker}
      quote={quote}
      profile={profile}
      incomeTTM={incomeTTM}
      dividends={dividends}
      sharedAverageVal={sharedAverageVal}
      onAnalizar={handleAnalizar}
      currencyInfo={currencyInfo}
    />
  </Tab.Panel>

  {/* 2. Financial Statements (Income, Balance, CashFlow) */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <FinancialStatementsGroup
      IncomeTab={<FinancialStatementTab title="Income Statement" data={income} type="income" ttmData={incomeTTM} secData={secData} growthData={incomeGrowth} asReportedData={incomeAsReported} financialGrowth={financialGrowth} secReportsRaw={secReportsRaw} keyMetrics={keyMetrics} keyMetricsTTM={keyMetricsTTM} ratios={ratios} ratiosTTM={ratiosTTM} />}
      BalanceTab={<FinancialStatementTab title="Balance Sheet" data={balance} type="balance" ttmData={balanceTTM} secData={secData} growthData={balanceGrowth} asReportedData={balanceAsReported} secReportsRaw={secReportsRaw} keyMetrics={keyMetrics} keyMetricsTTM={keyMetricsTTM} ratios={ratios} ratiosTTM={ratiosTTM} enterpriseValue={enterpriseValue} />}
      CashFlowTab={<FinancialStatementTab title="Cash Flow Statement" data={cashFlow} type="cashFlow" ttmData={cashFlowTTM} secData={secData} cashFlowAsReported={cashFlowAsReported} growthData={cashFlowGrowth} secReportsRaw={secReportsRaw} keyMetrics={keyMetrics} keyMetricsTTM={keyMetricsTTM} />}
    />
  </Tab.Panel>

  {/* 3. Forecasts (Forecasts + Revenue Forecast) */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    {canAccessTab(userPlan, 2) ? (
      <ForecastsGroup
        ForecastsTab={<ForecastsTab ticker={ticker} />}
        RevenueForecastTab={<RevenueForecastTab income={income} />}
      />
    ) : (
      <LockedTab requiredPlan={TAB_MIN_PLAN[2]} currentPlan={userPlan} tabName="Forecasts" />
    )}
  </Tab.Panel>

  {/* 4. Info General (Analisis General, Key Metrics, Analistas, DuPont) */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <GeneralInfoGroup
      AnalisisGeneralTab={<GeneralTab profile={profile} quote={quote} ticker={activeTicker} />}
      KeyMetricsTab={<KeyMetricsTab ticker={activeTicker} industry={profile?.industry} onCompanyQualityNetChange={setSharedCompanyQualityNet} ownerEarnings={ownerEarnings} />}
      AnalistasTab={<AnalistasTab priceTarget={priceTarget} ticker={activeTicker} />}
      DuPontTab={<DuPontTab income={income} balance={balance} ticker={activeTicker} />}
      lockedSubtabs={[0,1,2,3].filter(i => !canAccessSubTab(userPlan, GENERAL_INFO_ACCESS)(i))}
      requiredPlan="pro"
      currentPlan={userPlan}
    />
  </Tab.Panel>

  {/* 5. Compañía (Competidores, Industry, Segmentation, Holders) */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <CompanyGroup
      CompetidoresTab={<CompetidoresTab ticker={ticker} />}
      IndustryTab={<IndustryTab ticker={activeTicker} />}
      SegmentationTab={<SegmentationTab ticker={activeTicker} />}
      HoldersTab={<HoldersTab ticker={activeTicker} />}
      lockedSubtabs={[0,1,2,3].filter(i => !canAccessSubTab(userPlan, COMPANY_ACCESS)(i))}
      requiredPlan="pro"
      currentPlan={userPlan}
    />
  </Tab.Panel>

  {/* 6. Noticias */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    {canAccessTab(userPlan, 5) ? (
      <NoticiasTab ticker={activeTicker} />
    ) : (
      <LockedTab requiredPlan={TAB_MIN_PLAN[5]} currentPlan={userPlan} tabName="Noticias" />
    )}
  </Tab.Panel>

  {/* 7. Inputs (Sustainable Growth, Beta, CAGR, Pivots, WACC) */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <InputsGroup
      SustainableGrowthTab={
        <SustainableGrowthTab
          ticker={activeTicker}
          income={income}
          balance={balance}
          cashFlow={cashFlow}
          cashFlowAsReported={cashFlowAsReported}
          estimates={estimates}
          dcfCustom={dcfCustom}
          onSGRChange={setSharedSGR}
        />
      }
      BetaTab={<BetaTab ticker={ticker} onAvgCAPMChange={setSharedAvgCAPM} />}
      CAGRTab={<CAGRTab ticker={activeTicker} onCagrStatsChange={setSharedCagrStats} />}
      PivotsTab={<PivotsTab ticker={activeTicker} />}
      WACCTab={
        <WACCTab
          ticker={activeTicker}
          income={income}
          balance={balance}
          quote={quote}
          profile={profile}
          onWACCChange={setSharedWACC}
        />
      }
      lockedSubtabs={[0,1,2,3,4].filter(i => !canAccessSubTab(userPlan, INPUTS_ACCESS)(i))}
      requiredPlan="pro"
      currentPlan={userPlan}
    />
  </Tab.Panel>

  {/* 8. DCF (Cálculos, DCF Models) con valores intrínsecos en header */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <DCFGroup
      CalculosTab={
        <CalculosTab
          ticker={ticker}
          quote={quote}
          profile={profile}
          income={income}
          balance={balance}
          cashFlow={cashFlow}
          dcfCustom={dcfCustom}
          estimates={estimates}
          onValorIntrinsecoChange={setSharedValorIntrinseco}
        />
      }
      DCFTab={<DCFTab dcfStandard={dcfStandard} dcfCustom={dcfCustom} quote={quote} income={income} />}
      dcfStandard={dcfStandard}
      dcfCustom={dcfCustom}
      quote={quote}
      valorIntrinseco={sharedValorIntrinseco}
      income={income}
      balance={balance}
      cashFlow={cashFlow}
      lockedSubtabs={[0,1].filter(i => !canAccessSubTab(userPlan, DCF_ACCESS)(i))}
      requiredPlan="pro"
      currentPlan={userPlan}
    />
  </Tab.Panel>

  {/* 9. Valuaciones */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    <ValuacionesTab
      ticker={activeTicker}
      income={income}
      balance={balance}
      cashFlow={cashFlow}
      cashFlowAsReported={cashFlowAsReported}
      dividends={dividends}
      priceTarget={priceTarget}
      profile={profile}
      quote={quote}
      dcfCustom={dcfCustom}
      sustainableGrowthRate={sharedSGR}
      avgCAPMFromBeta={sharedAvgCAPM}
      onAverageValChange={setSharedAverageVal}
      onAdvanceValueNetChange={setSharedAdvanceValueNet}
      keyMetricsTTM={keyMetricsTTM}
      ownerEarnings={ownerEarnings}
      cagrStats={sharedCagrStats}
    />
  </Tab.Panel>

  {/* 10. Probability */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    {canAccessTab(userPlan, 9) ? (
      <ProbabilityTab
        ticker={activeTicker}
        quote={quote}
        dcfCustom={dcfCustom}
        sharedAverageVal={sharedAverageVal}
        profile={profile}
        dividends={dividends}
      />
    ) : (
      <LockedTab requiredPlan={TAB_MIN_PLAN[9]} currentPlan={userPlan} tabName="Probability" />
    )}
  </Tab.Panel>

  {/* 11. Resumen Maestro */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    {canAccessTab(userPlan, 10) ? (
      <ResumenTab
        ticker={activeTicker}
        currentPrice={quote?.price || 0}
        advanceValueNet={sharedAdvanceValueNet}
        companyQualityNet={sharedCompanyQualityNet}
        keyMetricsSummary={sharedKeyMetricsSummary}
        sustainableGrowthRate={sharedSGR}
        wacc={sharedWACC}
        dcfValuation={sharedValorIntrinseco}
        monteCarlo={sharedMonteCarlo}
        pivotAnalysis={convertedPivotAnalysis}
        holdersData={sharedHoldersData}
        forecasts={sharedForecasts}
        news={sharedNews}
        averageValuation={sharedAverageVal}
      />
    ) : (
      <LockedTab requiredPlan={TAB_MIN_PLAN[10]} currentPlan={userPlan} tabName="Resumen Maestro" />
    )}
  </Tab.Panel>

  {/* 12. Diario Inversor */}
  <Tab.Panel unmount={false} className="rounded-xl sm:rounded-2xl bg-gray-800 p-3 sm:p-6 md:p-10 shadow-2xl border border-white/[0.06]">
    {canAccessTab(userPlan, 11) ? (
      <DiarioInversorTab />
    ) : (
      <LockedTab requiredPlan={TAB_MIN_PLAN[11]} currentPlan={userPlan} tabName="Diario Inversor" />
    )}
  </Tab.Panel>
</Tab.Panels>

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between mt-8 px-4">
            <button
              onClick={() => setSelectedTabIndex(Math.max(0, selectedTabIndex - 1))}
              disabled={selectedTabIndex === 0}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
                selectedTabIndex === 0
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-700 text-white hover:bg-gray-600 hover:shadow-lg'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="hidden sm:inline">Anterior</span>
              <span className="sm:hidden">←</span>
            </button>

            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">
                {selectedTabIndex + 1} / {categories.length}
              </span>
              <span className="hidden sm:inline text-gray-400">|</span>
              <span className="hidden sm:inline text-green-400 font-medium">
                {categories[selectedTabIndex]}
              </span>
            </div>

            <button
              onClick={() => setSelectedTabIndex(Math.min(categories.length - 1, selectedTabIndex + 1))}
              disabled={selectedTabIndex === categories.length - 1}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all ${
                selectedTabIndex === categories.length - 1
                  ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-500 hover:shadow-lg shadow-green-500/25'
              }`}
            >
              <span className="hidden sm:inline">Siguiente</span>
              <span className="sm:hidden">→</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </Tab.Group>
      </div>
    </main>
  );
}

export default function AnalizarPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <p className="text-2xl font-bold text-green-400">Cargando...</p>
        </div>
      </main>
    }>
      <AnalizarContent />
    </Suspense>
  );
}

// ────────────────────────────────────────────────
// Componentes auxiliares
// ────────────────────────────────────────────────

function InicioTab({
  ticker,
  quote,
  profile,
  incomeTTM,
  dividends,
  sharedAverageVal,
  onAnalizar,
  currencyInfo,
}: {
  ticker: string;
  quote: any;
  profile: any;
  incomeTTM: any;
  dividends: any[];
  sharedAverageVal: number | null;
  onAnalizar: (ticker: string) => void;
  currencyInfo?: { original: string; rate: number } | null;
}) {
  const [inputTicker, setInputTicker] = useState(ticker);
  const [margenSeguridad, setMargenSeguridad] = useState('15');
  const [historical, setHistorical] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [technicalIndicators, setTechnicalIndicators] = useState<any>({});

  const { t } = useLanguage();

  // Sincronizar inputTicker cuando cambia el ticker activo
  useEffect(() => {
    setInputTicker(ticker);
  }, [ticker]);

  const currentPrice = quote?.price || 0;
  const margenPct = parseFloat(margenSeguridad) || 15;
  const precioCompraSugerido = sharedAverageVal ? sharedAverageVal * (1 - margenPct / 100) : null;

  useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) {
          console.error('[InicioTab] No API key found');
          return;
        }

        // Calcular fechas para el ultimo ano
        const today = new Date();
        const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        const fromDate = oneYearAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${ticker}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`;

        const res = await fetch(url);
        if (!res.ok) {
          console.error('[InicioTab] API error:', res.status);
          return;
        }

        const json = await res.json();

        if (Array.isArray(json) && json.length > 0) {
          const fxRate = currencyInfo?.rate || 1;
          const sorted = json
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((item: any) => ({
              date: item.date,
              close: (item.price || item.close) * fxRate,
            }));
          setHistorical(sorted);
        }
      } catch (err) {
        console.error('[InicioTab] Error fetching history:', err);
      } finally {
        setLoading(false);
      }
    }

    if (ticker) fetchHistory();
  }, [ticker, currencyInfo?.rate]);

  // Fetch technical indicators
  useEffect(() => {
    async function fetchIndicators() {
      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        // Fetch RSI, Williams %R, and ADX indicators with correct FMP API parameters
        const [rsiRes, williamsRes, adxRes, stddevRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/technical-indicators/rsi?symbol=${ticker}&periodLength=14&timeframe=1day&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/technical-indicators/williams?symbol=${ticker}&periodLength=14&timeframe=1day&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/technical-indicators/adx?symbol=${ticker}&periodLength=14&timeframe=1day&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/technical-indicators/standardDeviation?symbol=${ticker}&periodLength=20&timeframe=1day&apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        const indicators: any = {};

        if (rsiRes.ok) {
          const data = await rsiRes.json();
          console.log('[InicioTab] RSI response:', data);
          if (Array.isArray(data) && data.length > 0) {
            indicators.rsi = data[0].rsi;
          }
        }

        if (williamsRes.ok) {
          const data = await williamsRes.json();
          console.log('[InicioTab] Williams response:', data);
          if (Array.isArray(data) && data.length > 0) {
            indicators.williamsR = data[0].williams;
          }
        }

        if (adxRes.ok) {
          const data = await adxRes.json();
          console.log('[InicioTab] ADX response:', data);
          if (Array.isArray(data) && data.length > 0) {
            indicators.adx = data[0].adx;
          }
        }

        if (stddevRes.ok) {
          const data = await stddevRes.json();
          console.log('[InicioTab] StdDev response:', data);
          if (Array.isArray(data) && data.length > 0) {
            indicators.stdDev = data[0].standardDeviation;
          }
        }

        console.log('[InicioTab] Technical indicators:', indicators);
        setTechnicalIndicators(indicators);
      } catch (err) {
        console.error('[InicioTab] Error fetching technical indicators:', err);
      }
    }

    if (ticker) fetchIndicators();
  }, [ticker]);

  // Calculate annual dividend yield from dividends data
  const annualDividendYield = useMemo(() => {
    if (!dividends || dividends.length === 0 || !currentPrice || currentPrice <= 0) return null;

    // Sort dividends by date descending
    const sortedDividends = [...dividends].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // Get dividend frequency (quarterly, monthly, etc.)
    const frequency = sortedDividends[0]?.frequency || 'Quarterly';
    const paymentsPerYear = frequency === 'Quarterly' ? 4 :
                          frequency === 'Monthly' ? 12 :
                          frequency === 'Semi-Annual' ? 2 : 4;

    // Sum the most recent dividends to get annual total
    const recentDividends = sortedDividends.slice(0, paymentsPerYear);
    const annualDividend = recentDividends.reduce((sum, div) => sum + (div.dividend || div.adjDividend || 0), 0);

    return (annualDividend / currentPrice) * 100;
  }, [dividends, currentPrice]);

  // Calculate price statistics
  const priceStats = useMemo(() => {
    if (historical.length === 0) return null;
    const prices = historical.map(d => d.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const yearAgoPrice = prices[0];
    const ytdChange = ((currentPrice - yearAgoPrice) / yearAgoPrice) * 100;
    return { min, max, avg, ytdChange, yearAgoPrice };
  }, [historical, currentPrice]);

  // Improved chart configuration
  const chartData = {
    labels: historical.map(d => {
      const date = new Date(d.date);
      return date.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
    }),
    datasets: [
      {
        label: 'Precio',
        data: historical.map(d => d.close),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: (context: any) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 400);
          gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
          return gradient;
        },
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: 'rgb(59, 130, 246)',
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        borderWidth: 3,
      },
      ...(sharedAverageVal ? [{
        label: 'Valor Intrinseco',
        data: new Array(historical.length).fill(sharedAverageVal),
        borderColor: 'rgb(168, 85, 247)',
        borderDash: [8, 4],
        pointRadius: 0,
        borderWidth: 2,
        fill: false,
      }] : []),
      ...(precioCompraSugerido ? [{
        label: `Compra Sugerida (-${margenPct}%)`,
        data: new Array(historical.length).fill(precioCompraSugerido),
        borderColor: 'rgb(34, 197, 94)',
        borderDash: [4, 4],
        pointRadius: 0,
        borderWidth: 2,
        fill: false,
      }] : []),
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      y: {
        position: 'right' as const,
        ticks: {
          color: '#9ca3af',
          font: { size: 12 },
          callback: (value: any) => `$${value.toFixed(0)}`,
        },
        grid: {
          color: 'rgba(75, 85, 99, 0.3)',
          drawBorder: false,
        },
        border: { display: false },
      },
      x: {
        ticks: {
          color: '#9ca3af',
          maxTicksLimit: 12,
          font: { size: 11 },
        },
        grid: { display: false },
        border: { display: false },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        align: 'end' as const,
        labels: {
          color: '#e5e7eb',
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 20,
          font: { size: 12 },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        titleColor: '#f3f4f6',
        bodyColor: '#d1d5db',
        borderColor: 'rgba(75, 85, 99, 0.5)',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (context: any) => `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`,
        },
      },
    },
  };

  return (
    <div className="space-y-6 sm:space-y-10">
      {/* Header con company info */}
      <div className="flex flex-col md:flex-row gap-4 sm:gap-8 items-start">
        {/* Company Info Card */}
        <div className="flex-1 bg-gray-800 p-4 sm:p-6 md:p-8 rounded-2xl border border-white/[0.08]">
          <div className="flex items-center gap-3 sm:gap-6 mb-4 sm:mb-6">
            {profile?.image && (
              <img
                src={profile.image}
                alt={ticker}
                className="w-14 h-14 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-xl bg-white p-1.5 sm:p-2 shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div className="min-w-0">
              <h2 className="text-2xl sm:text-4xl md:text-5xl font-bold text-white">{ticker}</h2>
              <p className="text-sm sm:text-lg text-gray-400 truncate">{profile?.companyName || t('analysis.company')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {profile?.sector && <span className="px-2 sm:px-4 py-1 sm:py-2 bg-green-600/30 text-green-400 rounded-full text-xs sm:text-sm">{profile.sector}</span>}
            {profile?.industry && <span className="px-2 sm:px-4 py-1 sm:py-2 bg-emerald-600/30 text-emerald-400 rounded-full text-xs sm:text-sm">{profile.industry}</span>}
            {profile?.exchangeShortName && <span className="px-2 sm:px-4 py-1 sm:py-2 bg-green-600/30 text-green-400 rounded-full text-xs sm:text-sm">{profile.exchangeShortName}</span>}
            {currencyInfo && (
              <span className="px-2 sm:px-4 py-1 sm:py-2 bg-amber-600/30 text-amber-400 rounded-full text-xs sm:text-sm" title={`Original: ${currencyInfo.original} → USD (rate: ${currencyInfo.rate.toFixed(4)})`}>
                {currencyInfo.original} → USD
              </span>
            )}
          </div>
        </div>

        {/* Ticker Search */}
        <div className="w-full md:w-auto bg-gray-700 p-4 sm:p-6 rounded-xl border border-white/[0.08]">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <input
              type="text"
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && onAnalizar(inputTicker)}
              placeholder={t('analysis.searchTicker')}
              className="w-full sm:w-44 md:w-48 px-4 sm:px-5 py-3 sm:py-4 border border-white/[0.08] rounded-xl text-gray-100 text-base sm:text-xl bg-gray-900 focus:border-green-500 focus:ring-green-500 placeholder-gray-500"
            />
            <button
              onClick={() => onAnalizar(inputTicker)}
              disabled={!inputTicker.trim()}
              className="px-6 sm:px-8 py-3 sm:py-4 bg-green-600 text-white text-base sm:text-lg font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              Analizar
            </button>
          </div>
        </div>
      </div>

      {/* Price Hero Section */}
      <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-4">
        <div className="col-span-3 sm:col-span-1 bg-gradient-to-br from-green-600 to-green-800 p-3 sm:p-5 md:p-6 rounded-xl sm:rounded-2xl text-center flex flex-col justify-center min-h-[90px] sm:min-h-[120px] md:min-h-[140px]">
          <p className="text-green-200 text-xs mb-1">{t('analysis.precio.actual')}</p>
          <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">${currentPrice?.toFixed(2) || 'N/A'}</p>
          {priceStats && (
            <p className={`text-xs mt-1 ${priceStats.ytdChange >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {priceStats.ytdChange >= 0 ? '+' : ''}{priceStats.ytdChange.toFixed(1)}% (1A)
            </p>
          )}
        </div>
        {[
          { label: t('analysis.precio.intrinseco'), value: sharedAverageVal ? `$${sharedAverageVal.toFixed(2)}` : 'N/A', color: 'text-emerald-400' },
          { label: t('analysis.precio.compraSugerida'), value: precioCompraSugerido ? `$${precioCompraSugerido.toFixed(2)}` : 'N/A', color: 'text-green-400' },
          { label: t('analysis.precio.upside'), value: sharedAverageVal && currentPrice ? `${(((sharedAverageVal - currentPrice) / currentPrice) * 100).toFixed(1)}%` : 'N/A', color: sharedAverageVal && currentPrice && sharedAverageVal > currentPrice ? 'text-green-400' : 'text-red-400' },
          { label: t('analysis.precio.peRatio'), value: (() => { const ttmEPS = incomeTTM?.eps || incomeTTM?.epsdiluted || quote?.eps || profile?.ttmEPS; if (currentPrice && ttmEPS && ttmEPS > 0) return (currentPrice / ttmEPS).toFixed(1); return quote?.pe?.toFixed(1) || 'N/A'; })(), color: 'text-emerald-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-gray-800 p-3 sm:p-5 md:p-6 rounded-xl sm:rounded-2xl text-center border border-white/[0.08] flex flex-col justify-center min-h-[90px] sm:min-h-[120px] md:min-h-[140px]">
            <p className="text-gray-400 text-[10px] sm:text-xs mb-1 leading-tight">{label}</p>
            <p className={`text-lg sm:text-2xl md:text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
        <div className="bg-gray-800 p-3 sm:p-5 md:p-6 rounded-xl sm:rounded-2xl text-center border border-white/[0.08] flex flex-col justify-center min-h-[90px] sm:min-h-[120px] md:min-h-[140px]">
          <p className="text-gray-400 text-[10px] sm:text-xs mb-1">{t('analysis.precio.margenSeguridad')}</p>
          <input
            type="number"
            value={margenSeguridad}
            onChange={(e) => setMargenSeguridad(e.target.value)}
            className="w-full text-center text-lg sm:text-2xl md:text-3xl font-bold text-amber-400 bg-transparent border-none focus:outline-none focus:ring-0"
          />
          <p className="text-gray-500 text-xs">%</p>
        </div>
      </div>

      {/* Aviso si no hay valuacion */}
      {!sharedAverageVal && (
        <div className="bg-amber-900/20 border border-amber-600/50 rounded-xl p-4 sm:p-6 flex items-center gap-3 sm:gap-6">
          <div className="text-amber-500 text-2xl sm:text-4xl shrink-0">!</div>
          <div>
            <p className="text-amber-400 font-semibold text-sm sm:text-xl">Valor Intrinseco no calculado</p>
            <p className="text-amber-400/70 text-xs sm:text-base">Ve a la pestana "Valuaciones" para calcular el valor intrinseco promedio.</p>
          </div>
        </div>
      )}

      {/* Main Chart */}
      {loading ? (
        <div className="h-[260px] sm:h-[400px] md:h-[550px] bg-gray-700/50 rounded-2xl flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-4 border-green-500 border-t-transparent mb-4 sm:mb-6"></div>
            <p className="text-gray-400 text-base sm:text-xl">Cargando grafico...</p>
          </div>
        </div>
      ) : historical.length === 0 ? (
        <div className="h-[260px] sm:h-[400px] md:h-[550px] bg-gray-700/50 rounded-2xl flex items-center justify-center">
          <p className="text-gray-400 text-base sm:text-2xl">No hay datos historicos disponibles</p>
        </div>
      ) : (
        <div className="bg-gray-900 p-4 sm:p-6 md:p-8 rounded-2xl border border-white/[0.06] shadow-2xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0 mb-4 sm:mb-8">
            <h3 className="text-base sm:text-xl md:text-2xl font-semibold text-gray-100">Precio Historico (Ultimo Ano)</h3>
            {priceStats && (
              <div className="flex flex-wrap gap-3 sm:gap-6 text-xs sm:text-base">
                <span className="text-gray-400">Min: <span className="text-red-400 font-semibold">${priceStats.min.toFixed(2)}</span></span>
                <span className="text-gray-400">Max: <span className="text-green-400 font-semibold">${priceStats.max.toFixed(2)}</span></span>
                <span className="text-gray-400">Prom: <span className="text-green-400 font-semibold">${priceStats.avg.toFixed(2)}</span></span>
              </div>
            )}
          </div>
          <div className="h-[240px] sm:h-[380px] md:h-[500px]">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Market Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-5 md:gap-6">
        {[
          { label: 'Market Cap', value: quote?.marketCap ? `$${(quote.marketCap / 1e9).toFixed(1)}B` : 'N/A' },
          { label: 'EPS (TTM)', value: incomeTTM?.eps ? `$${incomeTTM.eps.toFixed(2)}` : (quote?.eps ? `$${quote.eps.toFixed(2)}` : 'N/A') },
          { label: 'Beta', value: profile?.beta ? profile.beta.toFixed(2) : 'N/A' },
          { label: 'Div Yield', value: annualDividendYield !== null ? `${annualDividendYield.toFixed(2)}%` : (profile?.lastDiv && currentPrice ? `${((profile.lastDiv * 4 / currentPrice) * 100).toFixed(2)}%` : 'N/A') },
          { label: 'Volumen', value: quote?.volume ? (quote.volume / 1e6).toFixed(1) + 'M' : 'N/A' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-700/50 p-3 sm:p-5 md:p-6 rounded-xl border border-white/[0.08]">
            <p className="text-gray-400 text-xs sm:text-sm md:text-lg mb-1">{label}</p>
            <p className="text-lg sm:text-2xl md:text-3xl font-semibold text-gray-100 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Technical Indicators */}
      <div className="bg-gray-950 p-4 sm:p-6 rounded-xl border border-green-600">
        <h4 className="text-base sm:text-xl md:text-2xl font-bold text-green-400 mb-4 sm:mb-6">Technical Indicators</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          {/* RSI */}
          <div className="bg-gray-800/50 p-3 sm:p-5 rounded-xl">
            <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">RSI (14)</p>
            <p className={`text-2xl sm:text-4xl font-bold ${
              technicalIndicators.rsi !== undefined
                ? technicalIndicators.rsi > 70 ? 'text-red-400'
                : technicalIndicators.rsi < 30 ? 'text-green-400'
                : 'text-gray-100'
                : 'text-gray-500'
            }`}>
              {technicalIndicators.rsi?.toFixed(1) || 'N/A'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {technicalIndicators.rsi > 70 ? 'Overbought' : technicalIndicators.rsi < 30 ? 'Oversold' : 'Neutral'}
            </p>
          </div>

          {/* Williams %R */}
          <div className="bg-gray-800/50 p-3 sm:p-5 rounded-xl">
            <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">Williams %R (14)</p>
            <p className={`text-2xl sm:text-4xl font-bold ${
              technicalIndicators.williamsR !== undefined
                ? technicalIndicators.williamsR < -80 ? 'text-green-400'
                : technicalIndicators.williamsR > -20 ? 'text-red-400'
                : 'text-gray-100'
                : 'text-gray-500'
            }`}>
              {technicalIndicators.williamsR?.toFixed(1) || 'N/A'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {technicalIndicators.williamsR < -80 ? 'Oversold' : technicalIndicators.williamsR > -20 ? 'Overbought' : 'Neutral'}
            </p>
          </div>

          {/* ADX */}
          <div className="bg-gray-800/50 p-3 sm:p-5 rounded-xl">
            <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">ADX (14)</p>
            <p className={`text-2xl sm:text-4xl font-bold ${
              technicalIndicators.adx !== undefined
                ? technicalIndicators.adx > 25 ? 'text-green-400'
                : 'text-amber-400'
                : 'text-gray-500'
            }`}>
              {technicalIndicators.adx?.toFixed(1) || 'N/A'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {technicalIndicators.adx > 25 ? 'Strong Trend' : 'Weak Trend'}
            </p>
          </div>

          {/* Standard Deviation */}
          <div className="bg-gray-800/50 p-3 sm:p-5 rounded-xl">
            <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">Std Dev (20)</p>
            <p className="text-2xl sm:text-4xl font-bold text-gray-100">
              {technicalIndicators.stdDev?.toFixed(2) || 'N/A'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Volatility Measure
            </p>
          </div>
        </div>

        {/* Indicator Legend */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-green-400 font-semibold mb-1">RSI</p>
            <p className="text-gray-400">&gt;70 = Overbought, &lt;30 = Oversold</p>
          </div>
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-green-400 font-semibold mb-1">Williams %R</p>
            <p className="text-gray-400">&gt;-20 = Overbought, &lt;-80 = Oversold</p>
          </div>
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-green-400 font-semibold mb-1">ADX</p>
            <p className="text-gray-400">&gt;25 = Strong Trend, &lt;25 = Weak</p>
          </div>
          <div className="bg-gray-800/30 p-3 rounded-lg">
            <p className="text-green-400 font-semibold mb-1">Std Dev</p>
            <p className="text-gray-400">Higher = More Volatile</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralTab({ profile, quote, ticker }: { profile: any; quote: any; ticker: string }) {
  const [floatData, setFloatData] = useState<any>(null);
  const [executives, setExecutives] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;
      setLoading(true);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        const [floatRes, execRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/shares-float?symbol=${ticker}&apikey=${apiKey}`),
          fetch(`https://financialmodelingprep.com/stable/key-executives?symbol=${ticker}&apikey=${apiKey}`),
        ]);

        if (floatRes.ok) {
          const data = await floatRes.json();
          console.log('[GeneralTab] Float data:', data);
          setFloatData(Array.isArray(data) ? data[0] : data);
        }

        if (execRes.ok) {
          const data = await execRes.json();
          console.log('[GeneralTab] Executives data:', data);
          setExecutives(Array.isArray(data) ? data.slice(0, 10) : []);
        }
      } catch (err) {
        console.error('[GeneralTab] Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  const formatNumber = (num: number | null | undefined) => {
    if (num === null || num === undefined) return 'N/A';
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    return num.toLocaleString();
  };

  return (
    <div className="space-y-6 sm:space-y-12">
      <section className="bg-gray-800 p-4 sm:p-6 md:p-10 rounded-2xl shadow-2xl border border-white/[0.06]">
        <h3 className="text-xl sm:text-3xl font-bold text-gray-100 mb-4 sm:mb-8">Información Básica</h3>
        <p className="text-sm sm:text-xl text-gray-300 leading-relaxed mb-4 sm:mb-8">
          {profile.description || 'No hay descripción disponible.'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8 text-sm sm:text-xl">
          <p><strong className="text-gray-200">Sector:</strong> {profile.sector || 'N/A'}</p>
          <p><strong className="text-gray-200">Industria:</strong> {profile.industry || 'N/A'}</p>
          <p><strong className="text-gray-200">CEO:</strong> {profile.ceo || 'N/A'}</p>
          <p>
            <strong className="text-gray-200">Sitio web:</strong>{' '}
            {profile.website ? (
              <a href={profile.website} className="text-green-400 hover:underline text-sm sm:text-xl break-all" target="_blank" rel="noopener noreferrer">
                {profile.website}
              </a>
            ) : 'N/A'}
          </p>
        </div>
      </section>

      <section className="bg-gray-800 p-4 sm:p-6 md:p-10 rounded-2xl shadow-2xl border border-white/[0.06]">
        <h3 className="text-xl sm:text-3xl font-bold text-gray-100 mb-4 sm:mb-8">Datos de Mercado</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-10 text-center">
          <div>
            <p className="text-sm sm:text-xl text-gray-400 mb-2 sm:mb-3">Precio Actual</p>
            <p className="text-3xl sm:text-5xl font-bold text-green-400">
              ${quote.price?.toFixed(2) || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm sm:text-xl text-gray-400 mb-2 sm:mb-3">Market Cap</p>
            <p className="text-3xl sm:text-5xl font-bold text-green-400">
              ${(quote.marketCap / 1e9)?.toFixed(1) || 'N/A'}B
            </p>
          </div>
          <div>
            <p className="text-sm sm:text-xl text-gray-400 mb-2 sm:mb-3">Volumen</p>
            <p className="text-2xl sm:text-4xl font-bold text-gray-200">
              {quote.volume?.toLocaleString() || 'N/A'}
            </p>
          </div>
        </div>
      </section>

      {/* Float & Liquidity Section */}
      <section className="bg-gray-950 p-4 sm:p-6 md:p-10 rounded-2xl shadow-2xl border border-green-600">
        <h3 className="text-xl sm:text-3xl font-bold text-green-400 mb-4 sm:mb-8">Float & Liquidity</h3>
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-green-500 border-t-transparent"></div>
          </div>
        ) : floatData ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
            <div className="bg-gray-800/50 p-3 sm:p-6 rounded-xl text-center">
              <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">Float Shares</p>
              <p className="text-xl sm:text-3xl font-bold text-green-400">{formatNumber(floatData.floatShares)}</p>
            </div>
            <div className="bg-gray-800/50 p-3 sm:p-6 rounded-xl text-center">
              <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">Outstanding Shares</p>
              <p className="text-xl sm:text-3xl font-bold text-emerald-400">{formatNumber(floatData.outstandingShares)}</p>
            </div>
            <div className="bg-gray-800/50 p-3 sm:p-6 rounded-xl text-center">
              <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">Free Float %</p>
              <p className="text-xl sm:text-3xl font-bold text-green-400">
                {floatData.freeFloat ? floatData.freeFloat.toFixed(2) + '%' : 'N/A'}
              </p>
            </div>
            <div className="bg-gray-800/50 p-3 sm:p-6 rounded-xl text-center">
              <p className="text-gray-400 text-xs sm:text-base mb-1 sm:mb-2">Avg Volume</p>
              <p className="text-xl sm:text-3xl font-bold text-emerald-400">{formatNumber(quote.avgVolume)}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-center">No hay datos de float disponibles</p>
        )}
      </section>

      {/* Executives Section */}
      <section className="bg-gradient-to-r bg-gray-900 p-4 sm:p-6 md:p-10 rounded-2xl shadow-2xl border border-emerald-600">
        <h3 className="text-xl sm:text-3xl font-bold text-emerald-400 mb-4 sm:mb-8">Key Executives</h3>
        {loading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent"></div>
          </div>
        ) : executives.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {executives.map((exec, idx) => (
              <div key={idx} className="bg-gray-800/50 p-5 rounded-xl flex items-center gap-4 border border-white/[0.06]">
                <div className="w-12 h-12 bg-emerald-600/30 rounded-full flex items-center justify-center text-emerald-400 text-xl font-bold">
                  {exec.name?.charAt(0) || '?'}
                </div>
                <div className="flex-1">
                  <p className="text-lg font-semibold text-gray-100">{exec.name || 'N/A'}</p>
                  <p className="text-sm text-gray-400">{exec.title || 'N/A'}</p>
                  {exec.pay && (
                    <p className="text-sm text-green-400">Compensation: ${formatNumber(exec.pay)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-400 text-center">No hay datos de ejecutivos disponibles</p>
        )}
      </section>
    </div>
  );
}

// Helper function to format SEC values intelligently
function formatSECValue(value: number): string {
  if (value === undefined || value === null || !isFinite(value)) return '—';

  // For very small values (likely percentages or ratios)
  if (Math.abs(value) < 1 && value !== 0) {
    return value.toFixed(4);
  }
  // For per-share values (typically between 0 and 100)
  if (Math.abs(value) < 100 && Math.abs(value) >= 1) {
    return `$${value.toFixed(2)}`;
  }
  // For large monetary values
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

function FinancialStatementTab({ title, data, type, ttmData, secData, cashFlowAsReported, growthData, asReportedData, financialGrowth, secReportsRaw, keyMetrics, keyMetricsTTM, ratios, ratiosTTM, enterpriseValue, ownerEarnings }: {
  title: string;
  data: any[];
  type: 'income' | 'balance' | 'cashFlow';
  ttmData?: any;
  secData?: any;
  cashFlowAsReported?: any[];
  growthData?: any[];
  asReportedData?: any[];
  financialGrowth?: any[];
  secReportsRaw?: any[];
  keyMetrics?: any[];
  keyMetricsTTM?: any;
  ratios?: any[];
  ratiosTTM?: any;
  enterpriseValue?: any[];
  ownerEarnings?: any[];
}) {
  const [showSecDetails, setShowSecDetails] = useState(false);
  const [showKeyMetrics, setShowKeyMetrics] = useState(false);
  const [showRatios, setShowRatios] = useState(false);
  const [showEnterpriseValue, setShowEnterpriseValue] = useState(false);
  const [showOwnerEarnings, setShowOwnerEarnings] = useState(false);
  if (data.length === 0 && !ttmData) {
    return <p className="text-2xl text-gray-400 text-center py-10">No hay datos disponibles para {title}</p>;
  }

  const sortedData = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Combine TTM with historical data - TTM first, then historical
  const allData = ttmData ? [{ ...ttmData, date: 'TTM', isTTM: true }, ...sortedData] : sortedData;

  // Helper function to get SEC data by year
  const getSECValue = (year: string | number, dataType: string, field?: string): number | null => {
    if (!secData) {
      return null;
    }
    const yearKey = String(year);
    const typeData = secData[dataType];
    if (!typeData) {
      return null;
    }

    // If field is provided, look for nested object: secData[dataType][year][field]
    if (field) {
      if (typeData[yearKey]?.[field] !== undefined) {
        return typeData[yearKey][field];
      }
    } else {
      // No field, look for direct value: secData[dataType][year]
      if (typeData[yearKey] !== undefined && typeof typeData[yearKey] === 'number') {
        return typeData[yearKey];
      }
    }

    // Try fiscal year offset (e.g., 2023 FY might end in Sep 2023, so data might be stored as 2022 or 2024)
    const nearbyYears = [parseInt(yearKey) - 1, parseInt(yearKey) + 1].map(String);
    for (const nearbyYear of nearbyYears) {
      if (field) {
        if (typeData[nearbyYear]?.[field] !== undefined) {
          return typeData[nearbyYear][field];
        }
      } else {
        if (typeData[nearbyYear] !== undefined && typeof typeData[nearbyYear] === 'number') {
          return typeData[nearbyYear];
        }
      }
    }

    return null;
  };

  // Helper to get dividends from cash-flow-statement-as-reported
  const getDividendsFromAsReported = (itemDate: string): number | null => {
    if (!cashFlowAsReported || cashFlowAsReported.length === 0) {
      return null;
    }

    // Extract year from date (e.g., "2024-09-27" -> 2024)
    const itemYear = new Date(itemDate).getFullYear();

    // Find matching record by fiscal year
    const matchingRecord = cashFlowAsReported.find((cf: any) => {
      return cf.fiscalYear === itemYear || cf.fiscalYear === itemYear + 1;
    });

    if (matchingRecord?.data?.paymentsofdividends) {
      const dividends = matchingRecord.data.paymentsofdividends;
      console.log(`[AsReported] Found dividends for ${itemYear}: $${dividends}`);
      return dividends;
    }

    return null;
  };

  // Helper to get value with fallback field names (FMP can use different names)
  const getValueWithFallback = (item: any, primaryKey: string, itemYear?: string | number): number | null | undefined => {
    // Alternative field mappings for FMP API inconsistencies
    const fieldMappings: Record<string, string[]> = {
      'dividendsPaid': ['dividendsPaid', 'paymentOfDividends', 'commonStockDividendsPaid', 'dividendsPaidOnCommonStock', 'dividendsCommonStock', 'cashDividendsPaid'],
      'preferredStock': ['preferredStock', 'preferredEquity', 'redeemablePreferredStock', 'convertiblePreferredStock', 'preferenceShareCapital'],
      'eps': ['eps', 'epsTTM', 'earningsPerShare'],
      'epsDiluted': ['epsdiluted', 'epsDiluted', 'dilutedEPS', 'earningsPerShareDiluted'],
      'netDebt': ['netDebt'],
    };

    // Calculated fields
    if (primaryKey === 'workingCapital') {
      const currentAssets = item.totalCurrentAssets || 0;
      const currentLiabilities = item.totalCurrentLiabilities || 0;
      if (currentAssets > 0 || currentLiabilities > 0) {
        return currentAssets - currentLiabilities;
      }
      return null;
    }

    if (primaryKey === 'netDebt') {
      const totalDebt = item.totalDebt || item.longTermDebt || 0;
      const cash = item.cashAndCashEquivalents || item.cashAndShortTermInvestments || 0;
      if (totalDebt > 0 || cash > 0) {
        return totalDebt - cash;
      }
      return null;
    }

    // SEC data fields - these come from financial-reports-json endpoint
    if (primaryKey === 'dividendsPerShare' && itemYear) {
      // dividendsPerShare is stored as secData.dividendsPerShare[year] = value
      const secValue = getSECValue(itemYear, 'dividendsPerShare');
      if (secValue !== null) {
        console.log(`[SEC getValueWithFallback] dividendsPerShare for ${itemYear}: $${secValue}`);
        return secValue;
      }
    }

    if (primaryKey === 'secDividendsPaid' && itemYear) {
      // dividendsPaid is stored as secData.dividendsPaid[year] = value (in millions)
      const secValue = getSECValue(itemYear, 'dividendsPaid');
      if (secValue !== null) {
        console.log(`[SEC getValueWithFallback] dividendsPaid for ${itemYear}: $${secValue}M`);
        return secValue * 1000000; // Convert millions to actual value
      }
    }

    // Lease data from SEC
    if (primaryKey === 'operatingLeaseROU' && itemYear) {
      const secValue = getSECValue(itemYear, 'leaseData', 'operatingLeaseROU');
      if (secValue !== null) return secValue;
    }

    if (primaryKey === 'financeLeaseROU' && itemYear) {
      const secValue = getSECValue(itemYear, 'leaseData', 'financeLeaseROU');
      if (secValue !== null) return secValue;
    }

    if (primaryKey === 'totalLeaseLiabilities' && itemYear) {
      const secValue = getSECValue(itemYear, 'leaseData', 'totalLeaseLiabilities');
      if (secValue !== null) return secValue;
    }

    if (primaryKey === 'operatingLeaseLiabilities' && itemYear) {
      const currentVal = getSECValue(itemYear, 'leaseData', 'operatingLeaseLiabilitiesCurrent') || 0;
      const nonCurrentVal = getSECValue(itemYear, 'leaseData', 'operatingLeaseLiabilitiesNonCurrent') || 0;
      if (currentVal > 0 || nonCurrentVal > 0) return currentVal + nonCurrentVal;
    }

    if (primaryKey === 'financeLeaseLiabilities' && itemYear) {
      const currentVal = getSECValue(itemYear, 'leaseData', 'financeLeaseLiabilitiesCurrent') || 0;
      const nonCurrentVal = getSECValue(itemYear, 'leaseData', 'financeLeaseLiabilitiesNonCurrent') || 0;
      if (currentVal > 0 || nonCurrentVal > 0) return currentVal + nonCurrentVal;
    }

    // For dividendsPaid, try as-reported data FIRST (most accurate source)
    if (primaryKey === 'dividendsPaid' && item.date) {
      const asReportedDividends = getDividendsFromAsReported(item.date);
      if (asReportedDividends !== null && asReportedDividends > 0) {
        // Return as negative (cash outflow) to match standard format
        return -asReportedDividends;
      }
    }

    // Try primary key first
    if (item[primaryKey] !== undefined && item[primaryKey] !== null && item[primaryKey] !== 0) {
      return item[primaryKey];
    }

    // Try alternative keys
    const alternatives = fieldMappings[primaryKey];
    if (alternatives) {
      for (const altKey of alternatives) {
        if (item[altKey] !== undefined && item[altKey] !== null && item[altKey] !== 0) {
          return item[altKey];
        }
      }
    }

    // For dividendsPaid, also try SEC data as last resort
    if (primaryKey === 'dividendsPaid' && itemYear) {
      const secValue = getSECValue(itemYear, 'dividendsPaid');
      if (secValue !== null) {
        console.log(`[SEC Fallback] dividendsPaid for ${itemYear}: $${secValue}M`);
        return -secValue * 1000000; // SEC data is in millions, negative for outflow
      }
    }

    // Return 0 instead of undefined if all alternatives are 0 or missing
    return item[primaryKey];
  };

  // Métricas esenciales sin TTM (solo datos que varían por período)
  let metrics: { key: string; label: string; isRatio?: boolean; isPerShare?: boolean; isSEC?: boolean }[] = [];

  if (type === 'income') {
    metrics = [
      { key: 'revenue', label: 'Revenue' },
      { key: 'costOfRevenue', label: 'Cost of Revenue' },
      { key: 'grossProfit', label: 'Gross Profit' },
      { key: 'grossProfitRatio', label: 'Gross Margin', isRatio: true },
      { key: 'researchAndDevelopmentExpenses', label: 'R&D Expenses' },
      { key: 'sellingGeneralAndAdministrativeExpenses', label: 'SG&A Expenses' },
      { key: 'operatingExpenses', label: 'Operating Expenses' },
      { key: 'operatingIncome', label: 'Operating Income' },
      { key: 'operatingIncomeRatio', label: 'Operating Margin', isRatio: true },
      { key: 'interestExpense', label: 'Interest Expense' },
      { key: 'interestIncome', label: 'Interest Income' },
      { key: 'totalOtherIncomeExpensesNet', label: 'Other Income/Expense' },
      { key: 'depreciationAndAmortization', label: 'D&A' },
      { key: 'ebitda', label: 'EBITDA' },
      { key: 'ebitdaratio', label: 'EBITDA Margin', isRatio: true },
      { key: 'ebit', label: 'EBIT' },
      { key: 'incomeBeforeTax', label: 'Income Before Tax' },
      { key: 'incomeBeforeTaxRatio', label: 'Pre-Tax Margin', isRatio: true },
      { key: 'incomeTaxExpense', label: 'Income Tax Expense' },
      { key: 'netIncome', label: 'Net Income' },
      { key: 'netIncomeRatio', label: 'Net Margin', isRatio: true },
      { key: 'eps', label: 'EPS', isPerShare: true },
      { key: 'epsDiluted', label: 'EPS Diluted', isPerShare: true },
      { key: 'weightedAverageShsOut', label: 'Shares Outstanding' },
      { key: 'weightedAverageShsOutDil', label: 'Shares Outstanding (Diluted)' },
    ];
  } else if (type === 'balance') {
    metrics = [
      // Assets
      { key: 'cashAndCashEquivalents', label: 'Cash & Equivalents' },
      { key: 'shortTermInvestments', label: 'Short Term Investments' },
      { key: 'cashAndShortTermInvestments', label: 'Cash + ST Investments' },
      { key: 'netReceivables', label: 'Net Receivables' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'otherCurrentAssets', label: 'Other Current Assets' },
      { key: 'totalCurrentAssets', label: 'Total Current Assets' },
      { key: 'propertyPlantEquipmentNet', label: 'PP&E Net' },
      { key: 'goodwill', label: 'Goodwill' },
      { key: 'intangibleAssets', label: 'Intangible Assets' },
      { key: 'goodwillAndIntangibleAssets', label: 'Goodwill + Intangibles' },
      { key: 'longTermInvestments', label: 'Long Term Investments' },
      { key: 'taxAssets', label: 'Tax Assets' },
      { key: 'otherNonCurrentAssets', label: 'Other Non-Current Assets' },
      // Lease Assets (from SEC data)
      { key: 'operatingLeaseROU', label: 'Operating Lease ROU Assets', isSEC: true },
      { key: 'financeLeaseROU', label: 'Finance Lease ROU Assets', isSEC: true },
      { key: 'totalNonCurrentAssets', label: 'Total Non-Current Assets' },
      { key: 'totalAssets', label: 'Total Assets' },
      // Liabilities
      { key: 'accountPayables', label: 'Accounts Payable' },
      { key: 'shortTermDebt', label: 'Short Term Debt' },
      { key: 'taxPayables', label: 'Tax Payables' },
      { key: 'deferredRevenue', label: 'Deferred Revenue' },
      { key: 'otherCurrentLiabilities', label: 'Other Current Liabilities' },
      { key: 'totalCurrentLiabilities', label: 'Total Current Liabilities' },
      { key: 'longTermDebt', label: 'Long Term Debt' },
      { key: 'deferredRevenueNonCurrent', label: 'Deferred Revenue (NC)' },
      { key: 'deferredTaxLiabilitiesNonCurrent', label: 'Deferred Tax Liabilities' },
      { key: 'otherNonCurrentLiabilities', label: 'Other Non-Current Liab.' },
      // Lease Liabilities (from SEC data)
      { key: 'operatingLeaseLiabilities', label: 'Operating Lease Liabilities', isSEC: true },
      { key: 'financeLeaseLiabilities', label: 'Finance Lease Liabilities', isSEC: true },
      { key: 'totalLeaseLiabilities', label: 'Total Lease Liabilities', isSEC: true },
      { key: 'totalNonCurrentLiabilities', label: 'Total Non-Current Liabilities' },
      { key: 'totalLiabilities', label: 'Total Liabilities' },
      { key: 'totalDebt', label: 'Total Debt' },
      // Equity
      { key: 'commonStock', label: 'Common Stock' },
      { key: 'preferredStock', label: 'Preferred Stock' },
      { key: 'retainedEarnings', label: 'Retained Earnings' },
      { key: 'accumulatedOtherComprehensiveIncomeLoss', label: 'AOCI' },
      { key: 'othertotalStockholdersEquity', label: 'Other Equity' },
      { key: 'totalStockholdersEquity', label: 'Total Equity' },
      { key: 'minorityInterest', label: 'Minority Interest' },
      { key: 'totalEquity', label: 'Total Equity (incl. Minority)' },
      { key: 'totalLiabilitiesAndStockholdersEquity', label: 'Total Liab. + Equity' },
      // Calculated
      { key: 'netDebt', label: 'Net Debt' },
      { key: 'workingCapital', label: 'Working Capital' },
    ];
  } else if (type === 'cashFlow') {
    metrics = [
      // Operating
      { key: 'netIncome', label: 'Net Income' },
      { key: 'depreciationAndAmortization', label: 'D&A' },
      { key: 'deferredIncomeTax', label: 'Deferred Income Tax' },
      { key: 'stockBasedCompensation', label: 'Stock Based Compensation' },
      { key: 'changeInWorkingCapital', label: 'Change in Working Capital' },
      { key: 'accountsReceivables', label: 'Change in Receivables' },
      { key: 'inventory', label: 'Change in Inventory' },
      { key: 'accountsPayables', label: 'Change in Payables' },
      { key: 'otherWorkingCapital', label: 'Other Working Capital' },
      { key: 'otherNonCashItems', label: 'Other Non-Cash Items' },
      { key: 'netCashProvidedByOperatingActivities', label: 'Operating Cash Flow' },
      // Investing
      { key: 'capitalExpenditure', label: 'Capital Expenditure' },
      { key: 'investmentsInPropertyPlantAndEquipment', label: 'PP&E Investments' },
      { key: 'acquisitionsNet', label: 'Acquisitions' },
      { key: 'purchasesOfInvestments', label: 'Purchases of Investments' },
      { key: 'salesMaturitiesOfInvestments', label: 'Sales of Investments' },
      { key: 'otherInvestingActivites', label: 'Other Investing Activities' },
      { key: 'netCashProvidedByInvestingActivities', label: 'Investing Cash Flow' },
      // Financing
      { key: 'debtRepayment', label: 'Debt Repayment' },
      { key: 'commonStockIssued', label: 'Common Stock Issued' },
      { key: 'commonStockRepurchased', label: 'Stock Repurchased' },
      { key: 'dividendsPaid', label: 'Dividends Paid' },
      { key: 'dividendsPerShare', label: 'Dividends Per Share (SEC)', isPerShare: true, isSEC: true },
      { key: 'otherFinancingActivites', label: 'Other Financing Activities' },
      { key: 'netCashProvidedByFinancingActivities', label: 'Financing Cash Flow' },
      // Summary
      { key: 'effectOfForexChangesOnCash', label: 'Effect of Forex on Cash' },
      { key: 'netChangeInCash', label: 'Net Change in Cash' },
      { key: 'cashAtEndOfPeriod', label: 'Cash at End of Period' },
      { key: 'cashAtBeginningOfPeriod', label: 'Cash at Beginning' },
      { key: 'freeCashFlow', label: 'Free Cash Flow' },
      { key: 'operatingCashFlowPerShare', label: 'OCF per Share', isPerShare: true },
      { key: 'capexPerShare', label: 'CapEx per Share', isPerShare: true },
      { key: 'freeCashFlowPerShare', label: 'FCF per Share', isPerShare: true },
    ];
  }

  // Función para formatear valores inteligentemente
  const formatValue = (value: number | null | undefined, metric: { key: string; isRatio?: boolean; isPerShare?: boolean }): string => {
    if (value === undefined || value === null) return '—';

    // Para ratios (márgenes), convertir a porcentaje
    if (metric.isRatio || metric.key.toLowerCase().includes('ratio') || metric.key.toLowerCase().includes('margin')) {
      // Los ratios vienen como decimales (0.45 = 45%)
      return (value * 100).toFixed(1) + '%';
    }

    // Para EPS y valores por acción, mostrar con 2 decimales sin escalar
    if (metric.isPerShare || metric.key.includes('eps') || metric.key.includes('PerShare')) {
      return `$${value.toFixed(2)}`;
    }

    // Para shares outstanding, mostrar en millones/billones
    if (metric.key.includes('weightedAverage') || metric.key.includes('Shs')) {
      if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
      if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
      return value.toLocaleString();
    }

    // Para ratios, mostrar como está
    if (metric.isRatio) {
      return value.toFixed(2);
    }

    // Para valores monetarios grandes
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="space-y-8">
      <h3 className="text-4xl font-bold text-gray-100 mb-8">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg sticky left-0 bg-gray-800 z-10 min-w-[280px]">
                Métrica
              </th>
              {allData.map((row, i) => (
                <th
                  key={row.date || i}
                  className={`px-6 py-5 text-center font-bold text-lg min-w-[140px] ${
                    row.isTTM ? 'text-green-400 bg-green-900/30' : 'text-gray-200'
                  }`}
                >
                  {row.isTTM ? 'TTM' : new Date(row.date).getFullYear()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {metrics.map((metric) => (
              <tr key={metric.key} className={`hover:bg-gray-700/50 transition ${metric.isSEC ? 'bg-emerald-900/10' : ''}`}>
                <td className={`px-8 py-4 font-medium text-base sticky left-0 z-10 border-r border-white/[0.06] ${metric.isSEC ? 'bg-emerald-900/20 text-emerald-300' : 'bg-gray-900 text-gray-200'}`}>
                  {metric.label}
                  {metric.isSEC && <span className="ml-2 text-xs text-emerald-400" title="Data from SEC 10-K/10-Q filings">*</span>}
                </td>
                {allData.map((row, i) => {
                  // Get the year for SEC data lookup
                  const itemYear = row.isTTM ? new Date().getFullYear() : new Date(row.date).getFullYear();
                  return (
                    <td
                      key={i}
                      className={`px-6 py-4 text-center text-base font-medium ${
                        row.isTTM ? 'text-green-300 bg-green-900/10' : metric.isSEC ? 'text-emerald-200' : 'text-gray-100'
                      }`}
                    >
                      {formatValue(getValueWithFallback(row, metric.key, itemYear), metric)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center text-base text-gray-400">
        <p>Datos ordenados del mas reciente (izquierda) al mas antiguo (derecha).</p>
        <p className="text-emerald-400 text-sm">* Datos adicionales de SEC 10-K filings</p>
      </div>

      {/* Growth Rates Section */}
      {growthData && growthData.length > 0 && (
        <div className="mt-10">
          <h4 className="text-3xl font-bold text-green-400 mb-6">📈 Year-over-Year Growth Rates</h4>
          <div className="overflow-x-auto">
            <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
              <thead className="bg-green-900/30">
                <tr>
                  <th className="px-8 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-green-900/30 z-10 min-w-[280px]">
                    Growth Metric
                  </th>
                  {growthData.slice(0, 8).map((row: any, i: number) => (
                    <th key={i} className="px-6 py-4 text-center font-bold text-base min-w-[120px] text-gray-200">
                      {row.date ? new Date(row.date).getFullYear() : `Period ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {type === 'income' && (
                  <>
                    <GrowthRow data={growthData} metricKey="revenueGrowth" label="Revenue Growth" />
                    <GrowthRow data={growthData} metricKey="grossProfitGrowth" label="Gross Profit Growth" />
                    <GrowthRow data={growthData} metricKey="operatingIncomeGrowth" label="Operating Income Growth" />
                    <GrowthRow data={growthData} metricKey="ebitgrowth" label="EBIT Growth" />
                    <GrowthRow data={growthData} metricKey="netIncomeGrowth" label="Net Income Growth" />
                    <GrowthRow data={growthData} metricKey="epsgrowth" label="EPS Growth" />
                    <GrowthRow data={growthData} metricKey="epsdilutedGrowth" label="EPS Diluted Growth" />
                    <GrowthRow data={growthData} metricKey="rdexpenseGrowth" label="R&D Growth" />
                    <GrowthRow data={growthData} metricKey="sgaexpensesGrowth" label="SG&A Growth" />
                  </>
                )}
                {type === 'balance' && (
                  <>
                    <GrowthRow data={growthData} metricKey="totalAssetsGrowth" label="Total Assets Growth" />
                    <GrowthRow data={growthData} metricKey="totalLiabilitiesGrowth" label="Total Liabilities Growth" />
                    <GrowthRow data={growthData} metricKey="totalStockholdersEquityGrowth" label="Total Equity Growth" />
                    <GrowthRow data={growthData} metricKey="cashAndCashEquivalentsGrowth" label="Cash Growth" />
                    <GrowthRow data={growthData} metricKey="totalDebtGrowth" label="Total Debt Growth" />
                    <GrowthRow data={growthData} metricKey="netDebtGrowth" label="Net Debt Growth" />
                    <GrowthRow data={growthData} metricKey="inventoryGrowth" label="Inventory Growth" />
                    <GrowthRow data={growthData} metricKey="receivablesGrowth" label="Receivables Growth" />
                  </>
                )}
                {type === 'cashFlow' && (
                  <>
                    <GrowthRow data={growthData} metricKey="operatingCashFlowGrowth" label="Operating CF Growth" />
                    <GrowthRow data={growthData} metricKey="capitalExpenditureGrowth" label="CapEx Growth" />
                    <GrowthRow data={growthData} metricKey="freeCashFlowGrowth" label="Free Cash Flow Growth" />
                    <GrowthRow data={growthData} metricKey="dividendsPaidGrowth" label="Dividends Growth" />
                    <GrowthRow data={growthData} metricKey="netCashUsedForInvestingActivitesGrowth" label="Investing CF Growth" />
                    <GrowthRow data={growthData} metricKey="netCashUsedProvidedByFinancingActivitiesGrowth" label="Financing CF Growth" />
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-500 mt-4">Growth rates shown as year-over-year percentage change.</p>
        </div>
      )}

      {/* Financial Growth Summary (only for income tab) */}
      {financialGrowth && financialGrowth.length > 0 && type === 'income' && (
        <div className="mt-10">
          <h4 className="text-3xl font-bold text-green-400 mb-6">📊 Financial Growth Summary</h4>
          <div className="overflow-x-auto">
            <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
              <thead className="bg-green-900/30">
                <tr>
                  <th className="px-8 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-green-900/30 z-10 min-w-[280px]">
                    Financial Growth Metric
                  </th>
                  {financialGrowth.slice(0, 8).map((row: any, i: number) => (
                    <th key={i} className="px-6 py-4 text-center font-bold text-base min-w-[120px] text-gray-200">
                      {row.date ? new Date(row.date).getFullYear() : `Period ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <GrowthRow data={financialGrowth} metricKey="revenueGrowth" label="Revenue Growth" />
                <GrowthRow data={financialGrowth} metricKey="netIncomeGrowth" label="Net Income Growth" />
                <GrowthRow data={financialGrowth} metricKey="epsgrowth" label="EPS Growth" />
                <GrowthRow data={financialGrowth} metricKey="epsdilutedGrowth" label="EPS Diluted Growth" />
                <GrowthRow data={financialGrowth} metricKey="freeCashFlowGrowth" label="FCF Growth" />
                <GrowthRow data={financialGrowth} metricKey="operatingCashFlowGrowth" label="Operating CF Growth" />
                <GrowthRow data={financialGrowth} metricKey="bookValueperShareGrowth" label="Book Value/Share Growth" />
                <GrowthRow data={financialGrowth} metricKey="debtGrowth" label="Debt Growth" />
                <GrowthRow data={financialGrowth} metricKey="assetGrowth" label="Asset Growth" />
                <GrowthRow data={financialGrowth} metricKey="receivablesGrowth" label="Receivables Growth" />
                <GrowthRow data={financialGrowth} metricKey="inventoryGrowth" label="Inventory Growth" />
                <GrowthRow data={financialGrowth} metricKey="tenYRevenueGrowthPerShare" label="10Y Revenue Growth/Share" />
                <GrowthRow data={financialGrowth} metricKey="fiveYRevenueGrowthPerShare" label="5Y Revenue Growth/Share" />
                <GrowthRow data={financialGrowth} metricKey="threeYRevenueGrowthPerShare" label="3Y Revenue Growth/Share" />
                <GrowthRow data={financialGrowth} metricKey="tenYNetIncomeGrowthPerShare" label="10Y Net Income Growth/Share" />
                <GrowthRow data={financialGrowth} metricKey="fiveYNetIncomeGrowthPerShare" label="5Y Net Income Growth/Share" />
                <GrowthRow data={financialGrowth} metricKey="threeYNetIncomeGrowthPerShare" label="3Y Net Income Growth/Share" />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SEC Raw Data Details - Expandable Section - Shows ALL data from financial-reports-json */}
      {secReportsRaw && secReportsRaw.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowSecDetails(!showSecDetails)}
            className="flex items-center gap-3 text-2xl font-bold text-emerald-400 mb-6 hover:text-emerald-300 transition"
          >
            <span>{showSecDetails ? '▼' : '▶'}</span>
            <span>📋 SEC 10-K/10-Q Complete Data ({secReportsRaw.length} reports) - Click to expand ALL available data</span>
          </button>

          {showSecDetails && (
            <div className="space-y-8">
              {secReportsRaw.map((report: any, reportIdx: number) => {
                if (!report) return null;

                // Get ALL sections from the report (not filtering by type)
                const allSections = Object.keys(report).filter(key =>
                  typeof report[key] === 'object' &&
                  Array.isArray(report[key]) &&
                  report[key].length > 0 &&
                  !['symbol', 'year', 'period', 'cik', 'id'].includes(key)
                );

                if (allSections.length === 0) return null;

                return (
                  <div key={reportIdx} className="bg-emerald-900/20 rounded-xl border border-emerald-600 p-6">
                    <h5 className="text-xl font-bold text-emerald-300 mb-4">
                      📄 FY {report.year} - {report.symbol} ({report.period || 'Annual'}) - {allSections.length} sections available
                    </h5>

                    {allSections.map((sectionName: string) => {
                      const sectionData = report[sectionName];
                      if (!Array.isArray(sectionData) || sectionData.length === 0) return null;

                      // FMP financial-reports-json returns data like:
                      // [{ "Revenue": [100, 90, 80] }, { "Cost of goods sold": [50, 45, 40] }, ...]
                      // Each object has ONE key which is the metric name, and the value is an array of numbers
                      const extractedItems: { label: string; values: number[] }[] = [];

                      sectionData.forEach((item: any) => {
                        const keys = Object.keys(item);

                        keys.forEach(key => {
                          const value = item[key];

                          // The key IS the metric name, value can be array of numbers or single number
                          if (Array.isArray(value)) {
                            // Filter to only numeric values
                            const numericValues = value.filter((v: any) => typeof v === 'number');
                            if (numericValues.length > 0) {
                              extractedItems.push({ label: key, values: numericValues });
                            }
                          } else if (typeof value === 'number') {
                            extractedItems.push({ label: key, values: [value] });
                          }
                          // Skip string values - they're often section headers like "Products:", "Services:", etc.
                        });
                      });

                      if (extractedItems.length === 0) return null;

                      return (
                        <div key={sectionName} className="mb-6">
                          <h6 className="text-lg font-semibold text-emerald-200 mb-3 bg-emerald-800/30 px-4 py-2 rounded flex justify-between items-center">
                            <span>{sectionName}</span>
                            <span className="text-sm text-emerald-400">({extractedItems.length} metrics)</span>
                          </h6>
                          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-gray-900">
                                <tr>
                                  <th className="py-2 px-4 text-left text-gray-400 font-semibold min-w-[400px]">Metric</th>
                                  <th className="py-2 px-4 text-right text-gray-400 font-semibold min-w-[120px]">Current</th>
                                  <th className="py-2 px-4 text-right text-gray-400 font-semibold min-w-[120px]">Prior 1</th>
                                  <th className="py-2 px-4 text-right text-gray-400 font-semibold min-w-[120px]">Prior 2</th>
                                  <th className="py-2 px-4 text-right text-gray-400 font-semibold min-w-[120px]">Prior 3</th>
                                </tr>
                              </thead>
                              <tbody>
                                {extractedItems.map((item, itemIdx) => (
                                  <tr key={itemIdx} className="border-b border-emerald-800/30 hover:bg-emerald-800/20">
                                    <td className="py-2 px-4 text-gray-300 font-medium">
                                      {item.label}
                                    </td>
                                    {item.values.slice(0, 4).map((val, valIdx) => (
                                      <td key={valIdx} className="py-2 px-4 text-right text-gray-100">
                                        {formatSECValue(val)}
                                      </td>
                                    ))}
                                    {/* Fill empty cells */}
                                    {Array.from({ length: Math.max(0, 4 - item.values.length) }).map((_, i) => (
                                      <td key={`empty-${i}`} className="py-2 px-4 text-right text-gray-600">—</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Key Metrics Section */}
      {keyMetrics && keyMetrics.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowKeyMetrics(!showKeyMetrics)}
            className="flex items-center gap-3 text-2xl font-bold text-green-400 mb-6 hover:text-green-300 transition"
          >
            <span>{showKeyMetrics ? '▼' : '▶'}</span>
            <span>📊 Key Metrics ({keyMetrics.length} periods)</span>
          </button>

          {showKeyMetrics && (
            <div className="overflow-x-auto">
              <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
                <thead className="bg-green-900/30">
                  <tr>
                    <th className="px-6 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-green-900/30 z-10 min-w-[280px]">
                      Key Metric
                    </th>
                    {keyMetricsTTM && (
                      <th className="px-6 py-4 text-center text-green-400 font-bold text-base min-w-[120px] bg-green-900/50">TTM</th>
                    )}
                    {keyMetrics.slice(0, 8).map((row: any, i: number) => (
                      <th key={i} className="px-6 py-4 text-center font-bold text-base min-w-[120px] text-gray-200">
                        {row.date ? new Date(row.date).getFullYear() : `Period ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="revenuePerShare" label="Revenue Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="netIncomePerShare" label="Net Income Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="operatingCashFlowPerShare" label="Operating CF Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="freeCashFlowPerShare" label="Free CF Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="cashPerShare" label="Cash Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="bookValuePerShare" label="Book Value Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="tangibleBookValuePerShare" label="Tangible Book Value Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="shareholdersEquityPerShare" label="Shareholders Equity Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="interestDebtPerShare" label="Interest Debt Per Share" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="marketCap" label="Market Cap" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="enterpriseValue" label="Enterprise Value" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="peRatio" label="P/E Ratio" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="priceToSalesRatio" label="Price to Sales" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="pocfratio" label="P/OCF Ratio" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="pfcfRatio" label="P/FCF Ratio" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="pbRatio" label="P/B Ratio" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="ptbRatio" label="P/TB Ratio" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="evToSales" label="EV/Sales" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="evToOperatingCashFlow" label="EV/Operating CF" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="evToFreeCashFlow" label="EV/FCF" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="earningsYield" label="Earnings Yield" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="freeCashFlowYield" label="FCF Yield" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="debtToEquity" label="Debt to Equity" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="debtToAssets" label="Debt to Assets" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="netDebtToEBITDA" label="Net Debt to EBITDA" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="currentRatio" label="Current Ratio" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="interestCoverage" label="Interest Coverage" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="incomeQuality" label="Income Quality" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="dividendYield" label="Dividend Yield" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="payoutRatio" label="Payout Ratio" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="salesGeneralAndAdministrativeToRevenue" label="SG&A to Revenue" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="researchAndDevelopementToRevenue" label="R&D to Revenue" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="intangiblesToTotalAssets" label="Intangibles to Assets" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="capexToOperatingCashFlow" label="CapEx to OCF" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="capexToRevenue" label="CapEx to Revenue" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="capexToDepreciation" label="CapEx to D&A" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="stockBasedCompensationToRevenue" label="SBC to Revenue" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="grahamNumber" label="Graham Number" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="roic" label="ROIC" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="returnOnTangibleAssets" label="Return on Tangible Assets" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="grahamNetNet" label="Graham Net-Net" isPerShare />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="workingCapital" label="Working Capital" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="tangibleAssetValue" label="Tangible Asset Value" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="netCurrentAssetValue" label="Net Current Asset Value" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="investedCapital" label="Invested Capital" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="averageReceivables" label="Average Receivables" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="averagePayables" label="Average Payables" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="averageInventory" label="Average Inventory" />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="daysSalesOutstanding" label="Days Sales Outstanding" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="daysPayablesOutstanding" label="Days Payables Outstanding" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="daysOfInventoryOnHand" label="Days Inventory On Hand" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="receivablesTurnover" label="Receivables Turnover" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="payablesTurnover" label="Payables Turnover" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="inventoryTurnover" label="Inventory Turnover" isRatio />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="roe" label="ROE" isPercent />
                  <KeyMetricRow data={keyMetrics} ttmData={keyMetricsTTM} metricKey="capexPerShare" label="CapEx Per Share" isPerShare />
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Ratios Section */}
      {ratios && ratios.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowRatios(!showRatios)}
            className="flex items-center gap-3 text-2xl font-bold text-green-400 mb-6 hover:text-green-300 transition"
          >
            <span>{showRatios ? '▼' : '▶'}</span>
            <span>📈 Financial Ratios ({ratios.length} periods)</span>
          </button>

          {showRatios && (
            <div className="overflow-x-auto">
              <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
                <thead className="bg-green-900/30">
                  <tr>
                    <th className="px-6 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-green-900/30 z-10 min-w-[280px]">
                      Ratio
                    </th>
                    {ratiosTTM && (
                      <th className="px-6 py-4 text-center text-green-400 font-bold text-base min-w-[120px] bg-green-900/50">TTM</th>
                    )}
                    {ratios.slice(0, 8).map((row: any, i: number) => (
                      <th key={i} className="px-6 py-4 text-center font-bold text-base min-w-[120px] text-gray-200">
                        {row.date ? new Date(row.date).getFullYear() : `Period ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {/* Profitability Ratios */}
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="grossProfitMargin" label="Gross Profit Margin" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="operatingProfitMargin" label="Operating Profit Margin" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="pretaxProfitMargin" label="Pretax Profit Margin" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="netProfitMargin" label="Net Profit Margin" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="effectiveTaxRate" label="Effective Tax Rate" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="returnOnAssets" label="Return on Assets" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="returnOnEquity" label="Return on Equity" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="returnOnCapitalEmployed" label="Return on Capital Employed" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="netIncomePerEBT" label="Net Income Per EBT" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="ebtPerEbit" label="EBT Per EBIT" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="ebitPerRevenue" label="EBIT Per Revenue" isPercent />
                  {/* Liquidity Ratios */}
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="currentRatio" label="Current Ratio" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="quickRatio" label="Quick Ratio" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="cashRatio" label="Cash Ratio" isRatio />
                  {/* Leverage Ratios */}
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="debtRatio" label="Debt Ratio" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="debtEquityRatio" label="Debt Equity Ratio" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="longTermDebtToCapitalization" label="LT Debt to Capitalization" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="totalDebtToCapitalization" label="Total Debt to Capitalization" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="interestCoverage" label="Interest Coverage" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="cashFlowToDebtRatio" label="Cash Flow to Debt" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="companyEquityMultiplier" label="Equity Multiplier" isRatio />
                  {/* Activity Ratios */}
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="receivablesTurnover" label="Receivables Turnover" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="payablesTurnover" label="Payables Turnover" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="inventoryTurnover" label="Inventory Turnover" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="fixedAssetTurnover" label="Fixed Asset Turnover" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="assetTurnover" label="Asset Turnover" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="operatingCashFlowPerShare" label="OCF Per Share" isPerShare />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="freeCashFlowPerShare" label="FCF Per Share" isPerShare />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="cashPerShare" label="Cash Per Share" isPerShare />
                  {/* Valuation Ratios */}
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceToBookRatio" label="Price to Book" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceToSalesRatio" label="Price to Sales" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceEarningsRatio" label="P/E Ratio" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceToFreeCashFlowsRatio" label="Price to FCF" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceToOperatingCashFlowsRatio" label="Price to OCF" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceCashFlowRatio" label="Price Cash Flow" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceEarningsToGrowthRatio" label="PEG Ratio" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceSalesRatio" label="Price Sales" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="dividendYield" label="Dividend Yield" isPercent />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="enterpriseValueMultiple" label="EV Multiple" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="priceFairValue" label="Price Fair Value" isRatio />
                  <KeyMetricRow data={ratios} ttmData={ratiosTTM} metricKey="dividendPayoutRatio" label="Dividend Payout Ratio" isPercent />
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Enterprise Value Section */}
      {enterpriseValue && enterpriseValue.length > 0 && type === 'balance' && (
        <div className="mt-10">
          <button
            onClick={() => setShowEnterpriseValue(!showEnterpriseValue)}
            className="flex items-center gap-3 text-2xl font-bold text-amber-400 mb-6 hover:text-amber-300 transition"
          >
            <span>{showEnterpriseValue ? '▼' : '▶'}</span>
            <span>🏢 Enterprise Value ({enterpriseValue.length} periods)</span>
          </button>

          {showEnterpriseValue && (
            <div className="overflow-x-auto">
              <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
                <thead className="bg-amber-900/30">
                  <tr>
                    <th className="px-6 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-amber-900/30 z-10 min-w-[280px]">
                      Metric
                    </th>
                    {enterpriseValue.slice(0, 10).map((row: any, i: number) => (
                      <th key={i} className="px-6 py-4 text-center font-bold text-base min-w-[120px] text-gray-200">
                        {row.date ? new Date(row.date).getFullYear() : `Period ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  <KeyMetricRow data={enterpriseValue} metricKey="stockPrice" label="Stock Price" isPerShare />
                  <KeyMetricRow data={enterpriseValue} metricKey="numberOfShares" label="Shares Outstanding" />
                  <KeyMetricRow data={enterpriseValue} metricKey="marketCapitalization" label="Market Cap" />
                  <KeyMetricRow data={enterpriseValue} metricKey="minusCashAndCashEquivalents" label="(-) Cash & Equivalents" />
                  <KeyMetricRow data={enterpriseValue} metricKey="addTotalDebt" label="(+) Total Debt" />
                  <KeyMetricRow data={enterpriseValue} metricKey="enterpriseValue" label="Enterprise Value" />
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Owner Earnings Section */}
      {ownerEarnings && ownerEarnings.length > 0 && type === 'cashFlow' && (
        <div className="mt-10">
          <button
            onClick={() => setShowOwnerEarnings(!showOwnerEarnings)}
            className="flex items-center gap-3 text-2xl font-bold text-emerald-400 mb-6 hover:text-emerald-300 transition"
          >
            <span>{showOwnerEarnings ? '▼' : '▶'}</span>
            <span>💰 Owner Earnings (Buffett) ({ownerEarnings.length} periods)</span>
          </button>

          {showOwnerEarnings && (
            <div className="overflow-x-auto">
              <table className="w-full border border-white/[0.06] rounded-xl overflow-hidden shadow-lg">
                <thead className="bg-emerald-900/30">
                  <tr>
                    <th className="px-6 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-emerald-900/30 z-10 min-w-[280px]">
                      Component
                    </th>
                    {ownerEarnings.slice(0, 10).map((row: any, i: number) => (
                      <th key={i} className="px-6 py-4 text-center font-bold text-base min-w-[120px] text-gray-200">
                        {row.date ? new Date(row.date).getFullYear() : `Period ${i + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  <KeyMetricRow data={ownerEarnings} metricKey="averagePPE" label="Average PP&E" />
                  <KeyMetricRow data={ownerEarnings} metricKey="maintenanceCapex" label="Maintenance CapEx" />
                  <KeyMetricRow data={ownerEarnings} metricKey="ownersEarnings" label="Owner Earnings" />
                  <KeyMetricRow data={ownerEarnings} metricKey="growthCapex" label="Growth CapEx" />
                  <KeyMetricRow data={ownerEarnings} metricKey="ownersEarningsPerShare" label="Owner Earnings Per Share" isPerShare />
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper component for Key Metrics rows
function KeyMetricRow({ data, ttmData, metricKey, label, isPerShare, isRatio, isPercent }: {
  data: any[];
  ttmData?: any;
  metricKey: string;
  label: string;
  isPerShare?: boolean;
  isRatio?: boolean;
  isPercent?: boolean;
}) {
  const formatMetricValue = (value: number | null | undefined): string => {
    if (value === undefined || value === null || !isFinite(value)) return '—';

    if (isPercent) {
      // Values are already decimals (0.25 = 25%)
      return `${(value * 100).toFixed(2)}%`;
    }
    if (isRatio) {
      return value.toFixed(2);
    }
    if (isPerShare) {
      return `$${value.toFixed(2)}`;
    }
    // Large monetary values
    if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return value.toLocaleString();
  };

  // Check if any data has this metric
  const hasData = data.slice(0, 8).some((row: any) => row[metricKey] !== undefined && row[metricKey] !== null) ||
                  (ttmData && ttmData[metricKey] !== undefined && ttmData[metricKey] !== null);
  if (!hasData) return null;

  return (
    <tr className="hover:bg-gray-700/50 transition">
      <td className="px-6 py-3 font-medium text-base sticky left-0 z-10 border-r border-white/[0.06] bg-gray-900 text-gray-200">
        {label}
      </td>
      {ttmData && (
        <td className="px-6 py-3 text-center text-base font-semibold text-green-300 bg-green-900/10">
          {formatMetricValue(ttmData[metricKey])}
        </td>
      )}
      {data.slice(0, 8).map((row: any, i: number) => (
        <td key={i} className="px-6 py-3 text-center text-base font-medium text-gray-100">
          {formatMetricValue(row[metricKey])}
        </td>
      ))}
    </tr>
  );
}

// Helper component for growth rows
function GrowthRow({ data, metricKey, label }: { data: any[]; metricKey: string; label: string }) {
  const formatGrowth = (value: number | null | undefined): string => {
    if (value === undefined || value === null || !isFinite(value)) return '—';
    const percentage = value * 100;
    return percentage >= 0 ? `+${percentage.toFixed(1)}%` : `${percentage.toFixed(1)}%`;
  };

  const getGrowthColor = (value: number | null | undefined): string => {
    if (value === undefined || value === null || !isFinite(value)) return 'text-gray-400';
    return value >= 0 ? 'text-green-400' : 'text-red-400';
  };

  // Check if any data has this metric
  const hasData = data.slice(0, 8).some((row: any) => row[metricKey] !== undefined && row[metricKey] !== null);
  if (!hasData) return null;

  return (
    <tr className="hover:bg-gray-700/50 transition">
      <td className="px-8 py-3 font-medium text-base sticky left-0 z-10 border-r border-white/[0.06] bg-gray-900 text-gray-200">
        {label}
      </td>
      {data.slice(0, 8).map((row: any, i: number) => (
        <td key={i} className={`px-6 py-3 text-center text-base font-semibold ${getGrowthColor(row[metricKey])}`}>
          {formatGrowth(row[metricKey])}
        </td>
      ))}
    </tr>
  );
}

function AnalistasTab({ priceTarget, ticker }: { priceTarget: any; ticker: string }) {
  const [grades, setGrades] = useState<any[]>([]);
  const [loadingGrades, setLoadingGrades] = useState(true);

  // Fetch analyst grades
  useEffect(() => {
    const fetchGrades = async () => {
      if (!ticker) return;

      try {
        setLoadingGrades(true);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        const res = await fetch(
          `https://financialmodelingprep.com/stable/grades?symbol=${ticker}&apikey=${apiKey}`
        );

        if (res.ok) {
          const data = await res.json();
          setGrades(Array.isArray(data) ? data.slice(0, 20) : []);
        }
      } catch (err) {
        console.error('Error fetching grades:', err);
      } finally {
        setLoadingGrades(false);
      }
    };

    fetchGrades();
  }, [ticker]);

  // Count grades by type
  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    grades.forEach((g) => {
      const grade = g.newGrade || g.grade || 'Unknown';
      counts[grade] = (counts[grade] || 0) + 1;
    });
    return counts;
  }, [grades]);

  // Get color for grade
  const getGradeColor = (grade: string) => {
    const g = grade.toLowerCase();
    if (g.includes('buy') || g.includes('outperform') || g.includes('overweight')) return 'text-green-400 bg-green-900/30';
    if (g.includes('sell') || g.includes('underperform') || g.includes('underweight')) return 'text-red-400 bg-red-900/30';
    if (g.includes('hold') || g.includes('neutral') || g.includes('equal')) return 'text-yellow-400 bg-yellow-900/30';
    return 'text-gray-400 bg-gray-700';
  };

  return (
    <div className="space-y-10">
      {/* Price Targets Section */}
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-white/[0.06]">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Price Targets de Analistas</h3>
        {priceTarget && Object.keys(priceTarget).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-white/[0.06] rounded-xl overflow-hidden">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-gray-100">Periodo</th>
                  <th className="px-6 py-4 text-center font-bold text-gray-100">Analistas</th>
                  <th className="px-6 py-4 text-center font-bold text-gray-100">Precio Objetivo Promedio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Ultimo Mes</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.lastMonthCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.lastMonthAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Ultimo Trimestre</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.lastQuarterCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.lastQuarterAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Ultimo Año</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.lastYearCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.lastYearAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Historico (All Time)</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.allTimeCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.allTimeAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xl text-gray-400 text-center py-10">No hay datos de Price Targets disponibles</p>
        )}
      </section>

      {/* Analyst Grades Summary */}
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-white/[0.06]">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Calificaciones de Analistas (Grades)</h3>

        {loadingGrades ? (
          <div className="text-center py-10">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-green-500 border-t-transparent"></div>
            <p className="mt-4 text-gray-400">Cargando calificaciones...</p>
          </div>
        ) : grades.length === 0 ? (
          <p className="text-xl text-gray-400 text-center py-10">No hay calificaciones disponibles</p>
        ) : (
          <>
            {/* Grade Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
              {Object.entries(gradeCounts).sort((a, b) => b[1] - a[1]).map(([grade, count]) => (
                <div key={grade} className={`p-4 rounded-xl text-center ${getGradeColor(grade)}`}>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-sm font-medium">{grade}</p>
                </div>
              ))}
            </div>

            {/* Recent Grades Table */}
            <h4 className="text-xl font-semibold text-gray-200 mb-4">Calificaciones Recientes</h4>
            <div className="overflow-x-auto">
              <table className="min-w-full border border-white/[0.06] rounded-xl overflow-hidden">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-gray-100">Fecha</th>
                    <th className="px-4 py-3 text-left text-gray-100">Firma</th>
                    <th className="px-4 py-3 text-center text-gray-100">Anterior</th>
                    <th className="px-4 py-3 text-center text-gray-100">Nuevo</th>
                    <th className="px-4 py-3 text-center text-gray-100">Accion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {grades.slice(0, 15).map((g, idx) => (
                    <tr key={idx} className="hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-gray-400 text-sm">
                        {new Date(g.date).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-4 py-3 text-gray-200 font-medium">{g.gradingCompany || 'N/A'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${getGradeColor(g.previousGrade || '')}`}>
                          {g.previousGrade || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getGradeColor(g.newGrade || '')}`}>
                          {g.newGrade || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-300 text-sm">{g.action || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <p className="text-sm text-gray-500 text-center">
        Fuentes: {priceTarget?.publishers || 'Benzinga, TipRanks, MarketWatch, etc.'}
      </p>
    </div>
  );
}

function DCFTab({ dcfStandard, dcfCustom, quote, income }: { dcfStandard: any; dcfCustom: any; quote: any; income?: any[] }) {
  // Helper para formatear porcentajes - detecta si ya está en formato % o decimal
  const formatPercent = (value: number | undefined | null): string => {
    if (value === undefined || value === null || isNaN(value)) return 'N/A';
    // Si el valor es mayor a 1, asumimos que ya está en porcentaje
    // Si es menor a 1, lo multiplicamos por 100
    const pct = Math.abs(value) > 1 ? value : value * 100;
    // Sanity check: si sigue siendo ridículo (>100%), probablemente está mal
    if (Math.abs(pct) > 100) {
      // Intentamos dividir, puede que el API devuelva valores muy grandes
      return `${(value / 100).toFixed(2)}%`;
    }
    return `${pct.toFixed(2)}%`;
  };

  // Obtener precio actual de quote o de dcfStandard
  const currentPrice = quote?.price || dcfStandard?.stockPrice || null;

  // Get shares outstanding from multiple sources
  const getSharesOutstanding = () => {
    // Try quote first
    if (quote?.sharesOutstanding && quote.sharesOutstanding > 0) {
      return quote.sharesOutstanding;
    }
    // Try calculating from market cap and price
    if (quote?.marketCap && quote?.price && quote.price > 0) {
      return quote.marketCap / quote.price;
    }
    // Try from income statement (most recent)
    if (income && income.length > 0) {
      const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const latestIncome = sortedIncome[0];
      if (latestIncome?.weightedAverageShsOutDil && latestIncome.weightedAverageShsOutDil > 0) {
        return latestIncome.weightedAverageShsOutDil;
      }
      if (latestIncome?.weightedAverageShsOut && latestIncome.weightedAverageShsOut > 0) {
        return latestIncome.weightedAverageShsOut;
      }
    }
    return null;
  };

  const sharesOutstanding = getSharesOutstanding();

  return (
    <div className="space-y-12">
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-white/[0.06]">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">DCF Valuation (Estándar)</h3>
        {dcfStandard && Object.keys(dcfStandard).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-gray-700 p-6 rounded-xl border border-white/[0.08] text-center">
              <p className="text-lg text-gray-400 mb-2">Valor Intrínseco (DCF)</p>
              <p className="text-4xl font-bold text-green-400">
                ${dcfStandard.dcf?.toFixed(2) || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-white/[0.08] text-center">
              <p className="text-lg text-gray-400 mb-2">Precio Actual del Mercado</p>
              <p className="text-4xl font-bold text-green-400">
                {currentPrice ? `$${currentPrice.toFixed(2)}` : 'N/A'}
              </p>
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-white/[0.08] text-center">
              <p className="text-lg text-gray-400 mb-2">Upside/Downside</p>
              {dcfStandard.dcf && currentPrice ? (
                <p className={`text-4xl font-bold ${dcfStandard.dcf > currentPrice ? 'text-green-400' : 'text-red-400'}`}>
                  {(((dcfStandard.dcf - currentPrice) / currentPrice) * 100).toFixed(1)}%
                </p>
              ) : (
                <p className="text-4xl font-bold text-gray-400">N/A</p>
              )}
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-white/[0.08] text-center">
              <p className="text-lg text-gray-400 mb-2">Fecha de Cálculo</p>
              <p className="text-2xl font-semibold text-gray-300">
                {dcfStandard.date || 'N/A'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xl text-gray-400 text-center py-10">No hay datos de DCF estándar disponibles</p>
        )}
      </section>

      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-white/[0.06]">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Custom DCF Advanced</h3>
        {dcfCustom && Object.keys(dcfCustom).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-white/[0.06] rounded-xl overflow-hidden">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-gray-100">Métrica</th>
                  <th className="px-6 py-4 text-right font-bold text-gray-100">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">WACC (Cost of Capital)</td>
                  <td className="px-6 py-4 text-right text-green-400 font-bold">
                    {formatPercent(dcfCustom.wacc)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Crecimiento a Largo Plazo</td>
                  <td className="px-6 py-4 text-right text-green-400 font-bold">
                    {formatPercent(dcfCustom.longTermGrowthRate)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Beta</td>
                  <td className="px-6 py-4 text-right text-gray-300">{dcfCustom.beta?.toFixed(2) || 'N/A'}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Cost of Debt (después de impuestos)</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {formatPercent(dcfCustom.afterTaxCostOfDebt)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Cost of Equity</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {formatPercent(dcfCustom.costOfEquity)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Market Risk Premium</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {formatPercent(dcfCustom.marketRiskPremium)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Risk Free Rate</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {formatPercent(dcfCustom.riskFreeRate)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Deuda Total</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {dcfCustom.totalDebt ? `$${(dcfCustom.totalDebt / 1e9).toFixed(2)}B` : 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Equity Value (Intrinsic)</td>
                  <td className="px-6 py-4 text-right font-bold text-green-400">
                    {dcfCustom.equityValue ? `$${(dcfCustom.equityValue / 1e9).toFixed(2)}B` : 'N/A'}
                  </td>
                </tr>
                <tr className="bg-gray-800">
                  <td className="px-6 py-4 font-bold text-gray-100">Equity Value Per Share</td>
                  <td className="px-6 py-4 text-right font-bold text-green-400 text-xl">
                    {dcfCustom.equityValue && sharesOutstanding
                      ? `$${(dcfCustom.equityValue / sharesOutstanding).toFixed(2)}`
                      : 'N/A'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xl text-gray-400 text-center py-10">No hay datos de Custom DCF disponibles</p>
        )}

        {/* Resumen destacado de Equity Value Per Share */}
        {dcfCustom?.equityValue && sharesOutstanding && (
          <div className="mt-6 bg-gray-700 p-6 rounded-xl border border-white/[0.08]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-sm text-gray-400 mb-1">Equity Value Per Share (Custom DCF)</p>
                <p className="text-3xl font-bold text-green-400">
                  ${(dcfCustom.equityValue / sharesOutstanding).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-1">Precio Actual</p>
                <p className="text-3xl font-bold text-green-400">
                  ${quote?.price?.toFixed(2) || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-1">Upside/Downside</p>
                {quote?.price && (
                  <p className={`text-3xl font-bold ${(dcfCustom.equityValue / sharesOutstanding) > quote.price ? 'text-green-400' : 'text-red-400'}`}>
                    {(((dcfCustom.equityValue / sharesOutstanding) / quote.price - 1) * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <p className="mt-4 text-sm text-gray-500 text-center">
          Cálculo avanzado con supuestos detallados (WACC, beta, crecimiento, etc.)
        </p>
      </section>
    </div>
  );
}import React from 'react';