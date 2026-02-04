'use client';

import { Tab } from '@headlessui/react';
import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
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
import AnalisisFinalTab from '@/app/components/tabs/AnalisisFinalTab';
import WACCTab from '@/app/components/tabs/WACCTab';
import CAGRTab from '@/app/components/tabs/CAGRTab';
import NoticiasTab from '@/app/components/tabs/NoticiasTab';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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
    console.log('[SEC Data] Processing year:', year);

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
  const [ticker, setTicker] = useState('');
  const [activeTicker, setActiveTicker] = useState(''); // El ticker activo para el cual se cargaron los datos
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharedAverageVal, setSharedAverageVal] = useState<number | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

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
        const secReportsPromises = [];
        for (let year = currentYear; year >= currentYear - 5; year--) {
          secReportsPromises.push(
            fetch(`${base}/financial-reports-json?symbol=${activeTicker}&year=${year}&period=FY&apikey=${apiKey}`, { cache: 'no-store' })
              .then(res => res.ok ? res.json() : null)
              .catch(() => null)
          );
        }
        const secReportsData = await Promise.all(secReportsPromises);

        // Extract SEC supplemental data
        const secSupplementalData = extractSECData(secReportsData.filter(Boolean));

        console.log('[AnalizarContent] Data loaded for', activeTicker, '- Income records:', incomeData.length, '- Balance records:', balanceData.length);
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
          // TTM data
          incomeTTM: incomeTTMData[0] || null,
          balanceTTM: balanceTTMData[0] || null,
          cashFlowTTM: cashFlowTTMData[0] || null,
          // SEC supplemental data
          secData: secSupplementalData,
        });
      } catch (err) {
        setError((err as Error).message || 'Error al cargar datos');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [activeTicker]);

  // Estado inicial - mostrar formulario de búsqueda
  if (!activeTicker || !data) {
    return (
      <main className="min-h-screen bg-gray-900 p-8 text-gray-100">
        <div className="max-w-2xl mx-auto mt-20">
          <h1 className="text-5xl font-extrabold text-blue-400 mb-8 text-center">
            Analizador de Acciones
          </h1>
          <div className="bg-gray-800 p-10 rounded-2xl shadow-2xl border border-gray-700">
            <label className="block text-2xl font-semibold text-gray-200 mb-4">
              Ingresa el Ticker
            </label>
            <div className="flex gap-4">
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalizar(ticker)}
                placeholder="Ej: AAPL, MSFT, GOOGL"
                className="flex-1 px-6 py-4 text-2xl border-2 border-gray-600 rounded-xl bg-gray-900 text-gray-100 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
              />
              <button
                onClick={() => handleAnalizar(ticker)}
                disabled={!ticker.trim() || loading}
                className="px-8 py-4 bg-blue-600 text-white text-xl font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Cargando...' : 'Analizar'}
              </button>
            </div>
            {loading && (
              <p className="mt-6 text-center text-blue-400 text-lg">Cargando datos para {activeTicker}...</p>
            )}
            {error && (
              <div className="mt-6 p-4 bg-red-900/30 border border-red-600 rounded-xl">
                <p className="text-red-400 text-center">{error}</p>
                <p className="text-gray-400 text-center text-sm mt-2">Revisa el ticker o intenta de nuevo.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <p className="text-2xl font-bold text-blue-400">Cargando datos para {activeTicker}...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center max-w-2xl">
          <h1 className="text-5xl font-bold text-red-500 mb-6">Error</h1>
          <p className="text-xl text-gray-300">{error}</p>
          <p className="mt-4 text-lg text-gray-400">Revisa tu API key o prueba otro ticker.</p>
        </div>
      </main>
    );
  }

  const { quote, profile, income, balance, cashFlow, priceTarget, estimates, dcfStandard, dcfCustom, incomeTTM, balanceTTM, cashFlowTTM, secData } = data;

  const categories = [
    'Inicio',
    'Noticias',
    'DuPont Analysis',
    'Analisis General',
    'Income Statement',
    'Balance Sheet',
    'Cash Flow',
    'Analistas',
    'Competidores',
    'Beta',
    'Forecasts',
    'Calculos',
    'Revenue Forecast',
    'Sustainable Growth',
    'WACC',
    'CAGR',
    'Valuaciones',
    'Analisis Final',
    'DCF',
  ];

  return (
    <main className="min-h-screen bg-gray-900 p-8 text-gray-100">
      <div className="max-w-[1600px] mx-auto">
        <h1 className="text-5xl font-extrabold text-blue-400 mb-4">
          Resultados para {activeTicker}
        </h1>
        <h2 className="text-3xl font-bold text-gray-300 mb-12">
          {profile.companyName || 'Compañía'}
        </h2>

        <Tab.Group>
          <Tab.List className="flex flex-wrap gap-3 rounded-xl bg-gray-800 p-3 mb-10 shadow-sm">
            {categories.map((category) => (
              <Tab
                key={category}
                className={({ selected }) =>
                  classNames(
                    'flex-1 min-w-35 rounded-xl py-4 px-6 text-lg font-semibold transition-all',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900',
                    selected
                      ? 'bg-gray-700 text-white shadow-lg border-b-4 border-blue-500'
                      : 'text-gray-400 hover:bg-gray-700 hover:text-white hover:shadow'
                  )
                }
              >
                {category}
              </Tab>
            ))}
          </Tab.List>

<Tab.Panels className="mt-2">
  {/* Inicio (antes Inputs) */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <InicioTab
      ticker={activeTicker}
      quote={quote}
      profile={profile}
      sharedAverageVal={sharedAverageVal}
      onAnalizar={handleAnalizar}
    />
  </Tab.Panel>

  {/* Noticias */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <NoticiasTab ticker={activeTicker} />
  </Tab.Panel>

  {/* DuPont Analysis */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <DuPontTab income={income} balance={balance} />
  </Tab.Panel>

  {/* Analisis General */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <GeneralTab profile={profile} quote={quote} />
  </Tab.Panel>

  {/* Income Statement */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <FinancialStatementTab title="Income Statement" data={income} type="income" ttmData={incomeTTM} secData={secData} />
  </Tab.Panel>

  {/* Balance Sheet */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <FinancialStatementTab title="Balance Sheet" data={balance} type="balance" ttmData={balanceTTM} secData={secData} />
  </Tab.Panel>

  {/* Cash Flow */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <FinancialStatementTab title="Cash Flow Statement" data={cashFlow} type="cashFlow" ttmData={cashFlowTTM} secData={secData} />
  </Tab.Panel>

  {/* Analistas */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <AnalistasTab priceTarget={priceTarget} ticker={activeTicker} />
  </Tab.Panel>

  {/* Competidores */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <CompetidoresTab ticker={ticker} />
  </Tab.Panel>

  {/* Beta */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <BetaTab ticker={ticker} />
  </Tab.Panel>

  {/* Forecasts */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <ForecastsTab ticker={ticker} />
  </Tab.Panel>

  {/* Cálculos */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <CalculosTab
      ticker={ticker}
      quote={quote}
      profile={profile}
      income={income}
      balance={balance}
      cashFlow={cashFlow}
      dcfCustom={dcfCustom}
      estimates={estimates}
    />
  </Tab.Panel>

  {/* Revenue Forecast */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <RevenueForecastTab income={income} />
  </Tab.Panel>

  {/* Sustainable Growth */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <SustainableGrowthTab
      income={income}
      balance={balance}
      cashFlow={cashFlow}
      estimates={estimates}
      dcfCustom={dcfCustom}
    />
  </Tab.Panel>

  {/* WACC */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <WACCTab
      ticker={activeTicker}
      income={income}
      balance={balance}
      quote={quote}
      profile={profile}
    />
  </Tab.Panel>

  {/* CAGR */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <CAGRTab ticker={activeTicker} />
  </Tab.Panel>

  {/* Valuaciones → Esta es la más importante para ti */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <ValuacionesTab
      ticker={activeTicker}
      income={income}
      balance={balance}
      cashFlow={cashFlow}
      priceTarget={priceTarget}
      profile={profile}
      quote={quote}
      dcfCustom={dcfCustom}
      onAverageValChange={setSharedAverageVal}
    />
  </Tab.Panel>

{/* Analisis Final */}
<Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
  <AnalisisFinalTab
    ticker={ticker}
    quote={quote}
    sharedAverageVal={sharedAverageVal}
  />
</Tab.Panel>

  {/* DCF */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <DCFTab dcfStandard={dcfStandard} dcfCustom={dcfCustom} quote={quote} income={income} />
  </Tab.Panel>
</Tab.Panels>
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
          <p className="text-2xl font-bold text-blue-400">Cargando...</p>
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
  sharedAverageVal,
  onAnalizar,
}: {
  ticker: string;
  quote: any;
  profile: any;
  sharedAverageVal: number | null;
  onAnalizar: (ticker: string) => void;
}) {
  const [inputTicker, setInputTicker] = useState(ticker);
  const [margenSeguridad, setMargenSeguridad] = useState('15');
  const [historical, setHistorical] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
          const sorted = json
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((item: any) => ({
              date: item.date,
              close: item.price || item.close,
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
  }, [ticker]);

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
    <div className="space-y-8">
      {/* Header con company info */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Company Info Card */}
        <div className="flex-1 bg-gradient-to-br from-gray-700 to-gray-800 p-6 rounded-2xl border border-gray-600">
          <div className="flex items-center gap-4 mb-4">
            {profile?.image && (
              <img
                src={profile.image}
                alt={ticker}
                className="w-16 h-16 rounded-xl bg-white p-1"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div>
              <h2 className="text-3xl font-bold text-white">{ticker}</h2>
              <p className="text-gray-400">{profile?.companyName || 'Compania'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 bg-blue-600/30 text-blue-400 rounded-full text-sm">{profile?.sector || 'N/A'}</span>
            <span className="px-3 py-1 bg-purple-600/30 text-purple-400 rounded-full text-sm">{profile?.industry || 'N/A'}</span>
            <span className="px-3 py-1 bg-green-600/30 text-green-400 rounded-full text-sm">{profile?.exchangeShortName || 'N/A'}</span>
          </div>
        </div>

        {/* Ticker Search */}
        <div className="w-full md:w-auto bg-gray-700 p-4 rounded-xl border border-gray-600">
          <div className="flex gap-3">
            <input
              type="text"
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && onAnalizar(inputTicker)}
              placeholder="Buscar ticker..."
              className="w-40 px-4 py-3 border border-gray-600 rounded-xl text-gray-100 text-lg bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
            />
            <button
              onClick={() => onAnalizar(inputTicker)}
              disabled={!inputTicker.trim()}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              Analizar
            </button>
          </div>
        </div>
      </div>

      {/* Price Hero Section */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-blue-600 to-blue-800 p-6 rounded-2xl text-center">
          <p className="text-blue-200 text-base mb-1">Precio Actual</p>
          <p className="text-4xl font-bold text-white">${currentPrice?.toFixed(2) || 'N/A'}</p>
          {priceStats && (
            <p className={`text-base mt-2 ${priceStats.ytdChange >= 0 ? 'text-green-300' : 'text-red-300'}`}>
              {priceStats.ytdChange >= 0 ? '+' : ''}{priceStats.ytdChange.toFixed(1)}% (1A)
            </p>
          )}
        </div>
        <div className="bg-gray-700 p-5 rounded-xl text-center border border-gray-600">
          <p className="text-gray-400 text-sm mb-1">Valor Intrinseco</p>
          <p className="text-3xl font-bold text-purple-400">
            {sharedAverageVal ? `$${sharedAverageVal.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl text-center border border-gray-600">
          <p className="text-gray-400 text-sm mb-1">Compra Sugerida</p>
          <p className="text-3xl font-bold text-green-400">
            {precioCompraSugerido ? `$${precioCompraSugerido.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl text-center border border-gray-600">
          <p className="text-gray-400 text-sm mb-1">Upside</p>
          <p className={`text-3xl font-bold ${sharedAverageVal && currentPrice && sharedAverageVal > currentPrice ? 'text-green-400' : 'text-red-400'}`}>
            {sharedAverageVal && currentPrice ? `${(((sharedAverageVal - currentPrice) / currentPrice) * 100).toFixed(1)}%` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl text-center border border-gray-600">
          <p className="text-gray-400 text-sm mb-1">P/E Ratio</p>
          <p className="text-3xl font-bold text-cyan-400">
            {(() => {
              // Calculate P/E from current price / TTM EPS
              const ttmEPS = quote?.eps || (profile?.ttmEPS);
              if (currentPrice && ttmEPS && ttmEPS > 0) {
                return (currentPrice / ttmEPS).toFixed(1);
              }
              return quote?.pe?.toFixed(1) || 'N/A';
            })()}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl text-center border border-gray-600">
          <p className="text-gray-400 text-sm mb-1">Margen Seguridad</p>
          <input
            type="number"
            value={margenSeguridad}
            onChange={(e) => setMargenSeguridad(e.target.value)}
            className="w-full text-center text-2xl font-bold text-amber-400 bg-transparent border-none focus:outline-none focus:ring-0"
          />
          <p className="text-gray-500 text-sm">%</p>
        </div>
      </div>

      {/* Aviso si no hay valuacion */}
      {!sharedAverageVal && (
        <div className="bg-amber-900/20 border border-amber-600/50 rounded-xl p-4 flex items-center gap-4">
          <div className="text-amber-500 text-3xl">!</div>
          <div>
            <p className="text-amber-400 font-medium">Valor Intrinseco no calculado</p>
            <p className="text-amber-400/70 text-sm">Ve a la pestana "Valuaciones" para calcular el valor intrinseco promedio.</p>
          </div>
        </div>
      )}

      {/* Main Chart */}
      {loading ? (
        <div className="h-[500px] bg-gray-700/50 rounded-2xl flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4"></div>
            <p className="text-gray-400">Cargando grafico...</p>
          </div>
        </div>
      ) : historical.length === 0 ? (
        <div className="h-[500px] bg-gray-700/50 rounded-2xl flex items-center justify-center">
          <p className="text-gray-400 text-xl">No hay datos historicos disponibles</p>
        </div>
      ) : (
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-700 shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold text-gray-100">Precio Historico (Ultimo Ano)</h3>
            {priceStats && (
              <div className="flex gap-4 text-sm">
                <span className="text-gray-400">Min: <span className="text-red-400 font-medium">${priceStats.min.toFixed(2)}</span></span>
                <span className="text-gray-400">Max: <span className="text-green-400 font-medium">${priceStats.max.toFixed(2)}</span></span>
                <span className="text-gray-400">Prom: <span className="text-blue-400 font-medium">${priceStats.avg.toFixed(2)}</span></span>
              </div>
            )}
          </div>
          <div className="h-[450px]">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Market Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-gray-700/50 p-5 rounded-xl border border-gray-600">
          <p className="text-gray-400 text-base">Market Cap</p>
          <p className="text-2xl font-semibold text-gray-100">
            {quote?.marketCap ? `$${(quote.marketCap / 1e9).toFixed(1)}B` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700/50 p-5 rounded-xl border border-gray-600">
          <p className="text-gray-400 text-base">EPS (TTM)</p>
          <p className="text-2xl font-semibold text-gray-100">
            {quote?.eps ? `$${quote.eps.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700/50 p-5 rounded-xl border border-gray-600">
          <p className="text-gray-400 text-base">Beta</p>
          <p className="text-2xl font-semibold text-gray-100">
            {profile?.beta ? profile.beta.toFixed(2) : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700/50 p-5 rounded-xl border border-gray-600">
          <p className="text-gray-400 text-base">Div Yield</p>
          <p className="text-2xl font-semibold text-gray-100">
            {profile?.lastDiv && currentPrice ? `${((profile.lastDiv / currentPrice) * 100).toFixed(2)}%` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700/50 p-5 rounded-xl border border-gray-600">
          <p className="text-gray-400 text-base">Volumen</p>
          <p className="text-2xl font-semibold text-gray-100">
            {quote?.volume ? (quote.volume / 1e6).toFixed(1) + 'M' : 'N/A'}
          </p>
        </div>
      </div>
    </div>
  );
}

function DuPontTab({ income, balance }: { income: any[]; balance: any[] }) {
  if (income.length < 2 || balance.length < 2) {
    return <p className="text-2xl text-gray-400 text-center py-10">Datos insuficientes para DuPont</p>;
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
    <div className="overflow-x-auto">
      <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
        <thead className="bg-gray-800">
          <tr>
            <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">Fecha</th>
            <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">ROE (%)</th>
            <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">Net Margin (%)</th>
            <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">Asset Turnover</th>
            <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">Equity Multiplier</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-700 transition">
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
  );
}

function GeneralTab({ profile, quote }: { profile: any; quote: any }) {
  return (
    <div className="space-y-12">
      <section className="bg-gray-800 p-10 rounded-2xl shadow-2xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-8">Información Básica</h3>
        <p className="text-xl text-gray-300 leading-relaxed mb-8">
          {profile.description || 'No hay descripción disponible.'}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-xl">
          <p><strong className="text-gray-200">Sector:</strong> {profile.sector || 'N/A'}</p>
          <p><strong className="text-gray-200">Industria:</strong> {profile.industry || 'N/A'}</p>
          <p><strong className="text-gray-200">CEO:</strong> {profile.ceo || 'N/A'}</p>
          <p>
            <strong className="text-gray-200">Sitio web:</strong>{' '}
            {profile.website ? (
              <a href={profile.website} className="text-blue-400 hover:underline text-xl" target="_blank" rel="noopener noreferrer">
                {profile.website}
              </a>
            ) : 'N/A'}
          </p>
        </div>
      </section>

      <section className="bg-gray-800 p-10 rounded-2xl shadow-2xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-8">Datos de Mercado</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 text-center">
          <div>
            <p className="text-xl text-gray-400 mb-3">Precio Actual</p>
            <p className="text-5xl font-bold text-green-400">
              ${quote.price?.toFixed(2) || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-xl text-gray-400 mb-3">Market Cap</p>
            <p className="text-5xl font-bold text-indigo-400">
              ${(quote.marketCap / 1e9)?.toFixed(1) || 'N/A'}B
            </p>
          </div>
          <div>
            <p className="text-xl text-gray-400 mb-3">Volumen</p>
            <p className="text-4xl font-bold text-gray-200">
              {quote.volume?.toLocaleString() || 'N/A'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function FinancialStatementTab({ title, data, type, ttmData, secData }: { title: string; data: any[]; type: 'income' | 'balance' | 'cashFlow'; ttmData?: any; secData?: any }) {
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
        return secValue * 1000000; // SEC data is in millions
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
      { key: 'researchAndDevelopmentExpenses', label: 'R&D Expenses' },
      { key: 'sellingGeneralAndAdministrativeExpenses', label: 'SG&A Expenses' },
      { key: 'operatingExpenses', label: 'Operating Expenses' },
      { key: 'operatingIncome', label: 'Operating Income' },
      { key: 'interestExpense', label: 'Interest Expense' },
      { key: 'interestIncome', label: 'Interest Income' },
      { key: 'depreciationAndAmortization', label: 'D&A' },
      { key: 'ebitda', label: 'EBITDA' },
      { key: 'ebit', label: 'EBIT' },
      { key: 'incomeBeforeTax', label: 'Income Before Tax' },
      { key: 'incomeTaxExpense', label: 'Income Tax Expense' },
      { key: 'netIncome', label: 'Net Income' },
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
      { key: 'netReceivables', label: 'Net Receivables' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'totalCurrentAssets', label: 'Total Current Assets' },
      { key: 'propertyPlantEquipmentNet', label: 'PP&E Net' },
      { key: 'goodwill', label: 'Goodwill' },
      { key: 'intangibleAssets', label: 'Intangible Assets' },
      { key: 'longTermInvestments', label: 'Long Term Investments' },
      // Lease Assets (from SEC data)
      { key: 'operatingLeaseROU', label: 'Operating Lease ROU Assets', isSEC: true },
      { key: 'financeLeaseROU', label: 'Finance Lease ROU Assets', isSEC: true },
      { key: 'totalNonCurrentAssets', label: 'Total Non-Current Assets' },
      { key: 'totalAssets', label: 'Total Assets' },
      // Liabilities
      { key: 'accountPayables', label: 'Accounts Payable' },
      { key: 'shortTermDebt', label: 'Short Term Debt' },
      { key: 'totalCurrentLiabilities', label: 'Total Current Liabilities' },
      { key: 'longTermDebt', label: 'Long Term Debt' },
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
      { key: 'totalStockholdersEquity', label: 'Total Equity' },
      // Calculated
      { key: 'netDebt', label: 'Net Debt' },
      { key: 'workingCapital', label: 'Working Capital' },
    ];
  } else if (type === 'cashFlow') {
    metrics = [
      // Operating
      { key: 'netIncome', label: 'Net Income' },
      { key: 'depreciationAndAmortization', label: 'D&A' },
      { key: 'stockBasedCompensation', label: 'Stock Based Compensation' },
      { key: 'changeInWorkingCapital', label: 'Change in Working Capital' },
      { key: 'netCashProvidedByOperatingActivities', label: 'Operating Cash Flow' },
      // Investing
      { key: 'capitalExpenditure', label: 'Capital Expenditure' },
      { key: 'acquisitionsNet', label: 'Acquisitions' },
      { key: 'purchasesOfInvestments', label: 'Purchases of Investments' },
      { key: 'salesMaturitiesOfInvestments', label: 'Sales of Investments' },
      { key: 'netCashProvidedByInvestingActivities', label: 'Investing Cash Flow' },
      // Financing
      { key: 'netDebtIssuance', label: 'Net Debt Issuance' },
      { key: 'commonStockRepurchased', label: 'Stock Repurchased' },
      { key: 'dividendsPaid', label: 'Dividends Paid' },
      { key: 'dividendsPerShare', label: 'Dividends Per Share (SEC)', isPerShare: true, isSEC: true },
      { key: 'netCashProvidedByFinancingActivities', label: 'Financing Cash Flow' },
      // Summary
      { key: 'netChangeInCash', label: 'Net Change in Cash' },
      { key: 'freeCashFlow', label: 'Free Cash Flow' },
    ];
  }

  // Función para formatear valores inteligentemente
  const formatValue = (value: number | null | undefined, metric: { key: string; isRatio?: boolean; isPerShare?: boolean }): string => {
    if (value === undefined || value === null) return '—';

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
        <table className="w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg sticky left-0 bg-gray-800 z-10 min-w-[280px]">
                Métrica
              </th>
              {allData.map((row, i) => (
                <th
                  key={row.date || i}
                  className={`px-6 py-5 text-center font-bold text-lg min-w-[140px] ${
                    row.isTTM ? 'text-blue-400 bg-blue-900/30' : 'text-gray-200'
                  }`}
                >
                  {row.isTTM ? 'TTM' : new Date(row.date).getFullYear()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {metrics.map((metric) => (
              <tr key={metric.key} className={`hover:bg-gray-700/50 transition ${metric.isSEC ? 'bg-purple-900/10' : ''}`}>
                <td className={`px-8 py-4 font-medium text-base sticky left-0 z-10 border-r border-gray-700 ${metric.isSEC ? 'bg-purple-900/20 text-purple-300' : 'bg-gray-900 text-gray-200'}`}>
                  {metric.label}
                  {metric.isSEC && <span className="ml-2 text-xs text-purple-400" title="Data from SEC 10-K/10-Q filings">*</span>}
                </td>
                {allData.map((row, i) => {
                  // Get the year for SEC data lookup
                  const itemYear = row.isTTM ? new Date().getFullYear() : new Date(row.date).getFullYear();
                  return (
                    <td
                      key={i}
                      className={`px-6 py-4 text-center text-base font-medium ${
                        row.isTTM ? 'text-blue-300 bg-blue-900/10' : metric.isSEC ? 'text-purple-200' : 'text-gray-100'
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
        <p className="text-purple-400 text-sm">* Datos adicionales de SEC 10-K filings</p>
      </div>
    </div>
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
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Price Targets de Analistas</h3>
        {priceTarget && Object.keys(priceTarget).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden">
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
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Calificaciones de Analistas (Grades)</h3>

        {loadingGrades ? (
          <div className="text-center py-10">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
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
              <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden">
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
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">DCF Valuation (Estándar)</h3>
        {dcfStandard && Object.keys(dcfStandard).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
              <p className="text-lg text-gray-400 mb-2">Valor Intrínseco (DCF)</p>
              <p className="text-4xl font-bold text-green-400">
                ${dcfStandard.dcf?.toFixed(2) || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
              <p className="text-lg text-gray-400 mb-2">Precio Actual del Mercado</p>
              <p className="text-4xl font-bold text-blue-400">
                {currentPrice ? `$${currentPrice.toFixed(2)}` : 'N/A'}
              </p>
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
              <p className="text-lg text-gray-400 mb-2">Upside/Downside</p>
              {dcfStandard.dcf && currentPrice ? (
                <p className={`text-4xl font-bold ${dcfStandard.dcf > currentPrice ? 'text-green-400' : 'text-red-400'}`}>
                  {(((dcfStandard.dcf - currentPrice) / currentPrice) * 100).toFixed(1)}%
                </p>
              ) : (
                <p className="text-4xl font-bold text-gray-400">N/A</p>
              )}
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
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

      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Custom DCF Advanced</h3>
        {dcfCustom && Object.keys(dcfCustom).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-gray-100">Métrica</th>
                  <th className="px-6 py-4 text-right font-bold text-gray-100">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">WACC (Cost of Capital)</td>
                  <td className="px-6 py-4 text-right text-indigo-400 font-bold">
                    {formatPercent(dcfCustom.wacc)}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Crecimiento a Largo Plazo</td>
                  <td className="px-6 py-4 text-right text-indigo-400 font-bold">
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
          <div className="mt-6 bg-gray-700 p-6 rounded-xl border border-gray-600">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
              <div>
                <p className="text-sm text-gray-400 mb-1">Equity Value Per Share (Custom DCF)</p>
                <p className="text-3xl font-bold text-green-400">
                  ${(dcfCustom.equityValue / sharesOutstanding).toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400 mb-1">Precio Actual</p>
                <p className="text-3xl font-bold text-blue-400">
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