'use client';

import { Tab } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

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

export default function AnalizarPage() {
  const searchParams = useSearchParams();
  const [ticker, setTicker] = useState('AAPL');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urlTicker = searchParams.get('ticker');
    if (urlTicker && urlTicker.toUpperCase() !== ticker) {
      setTicker(urlTicker.toUpperCase());
      setData(null);
      setLoading(true);
    }
  }, [searchParams, ticker]);

  useEffect(() => {
    if (!ticker) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('FMP_API_KEY no está configurada');

        const base = 'https://financialmodelingprep.com/stable';
        const params = `?symbol=${ticker}&apikey=${apiKey}`;

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
        ] = await Promise.all([
          fetchJson('quote'),
          fetchJson('profile'),
          fetchJson('income-statement', '&limit=10'),
          fetchJson('balance-sheet-statement', '&limit=10'),
          fetchJson('cash-flow-statement', '&limit=10'),
          fetchJson('price-target-summary'),
          fetchJson('analyst-estimates', '&period=annual&limit=10'),
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
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <p className="text-2xl font-bold text-blue-400">Cargando datos...</p>
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

  const { quote, profile, income, balance, cashFlow, priceTarget, estimates, dcfStandard, dcfCustom } = data;

  const categories = [
    'Inputs',
    'DuPont Analysis',
    'Análisis General',
    'Income Statement',
    'Balance Sheet',
    'Cash Flow',
    'Analistas',
    'Competidores',
    'Beta',
    'Forecasts',
    'Cálculos',
    'Revenue Forecast',
    'Sustainable Growth',
    'Valuaciones',
    'Analisis Final',
    'DCF',
  ];

  return (
    <main className="min-h-screen bg-gray-900 p-8 text-gray-100">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-5xl font-extrabold text-blue-400 mb-4">
          Resultados para {ticker}
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
  {/* Inputs */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <InputsTab quote={quote} />
  </Tab.Panel>

  {/* DuPont Analysis */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <DuPontTab income={income} balance={balance} />
  </Tab.Panel>

  {/* Análisis General */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <GeneralTab profile={profile} quote={quote} />
  </Tab.Panel>

  {/* Income Statement */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <FinancialStatementTab title="Income Statement" data={income} type="income" />
  </Tab.Panel>

  {/* Balance Sheet */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <FinancialStatementTab title="Balance Sheet" data={balance} type="balance" />
  </Tab.Panel>

  {/* Cash Flow */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <FinancialStatementTab title="Cash Flow Statement" data={cashFlow} type="cashFlow" />
  </Tab.Panel>

  {/* Analistas */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <AnalistasTab priceTarget={priceTarget} estimates={estimates} />
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
    />
  </Tab.Panel>

  {/* Valuaciones → Esta es la más importante para ti */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <ValuacionesTab
      income={income}
      balance={balance}
      cashFlow={cashFlow}
      priceTarget={priceTarget}
      profile={profile}
    />
  </Tab.Panel>

{/* averageVal vendrá del estado compartido o del callback de ValuacionesTab */}
<AnalisisFinalTab 
  ticker={ticker} 
  quote={quote} 
  averageVal={null}
/>

  {/* DCF */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <DCFTab dcfStandard={dcfStandard} dcfCustom={dcfCustom} />
  </Tab.Panel>
</Tab.Panels>
        </Tab.Group>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────
// Componentes auxiliares
// ────────────────────────────────────────────────

function InputsTab({ quote }: { quote: any }) {
  const [longTermGrowth, setLongTermGrowth] = useState('');
  const [periodos, setPeriodos] = useState('');
  const [horizonte, setHorizonte] = useState('');
  const [margenSeguridad, setMargenSeguridad] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [chartData, setChartData] = useState<any>(null);

  const handleCalcular = () => {
    const isValue = Math.random() > 0.5 ? 'VALUE' : 'NOT VALUE';
    setResult(isValue);

    const currentPrice = quote.price || 0;
    const buyPrice = currentPrice * 0.85;
    const safetyPrice = currentPrice * (1 - (parseFloat(margenSeguridad) || 0) / 100);

    setChartData({
      labels: ['Precio Compra Sugerido', 'Precio Actual', 'Precio Margen Seguridad'],
      datasets: [{
        label: 'Precios ($)',
        data: [buyPrice, currentPrice, safetyPrice],
        backgroundColor: ['#22c55e', '#3b82f6', '#ef4444'],
        borderColor: ['#15803d', '#1d4ed8', '#b91c1c'],
        borderWidth: 2,
      }],
    });
  };

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <label className="block text-xl font-medium text-gray-300 mb-3">
            Long Term Growth Rate (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={longTermGrowth}
            onChange={(e) => setLongTermGrowth(e.target.value)}
            className="w-full px-5 py-4 border-2 border-gray-700 rounded-xl text-gray-100 text-xl bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
            placeholder="Ej: 4.5"
          />
          <p className="mt-3 text-base text-gray-400">
            Recomendamos: Tasa de crecimiento USA + inflación (~3-5%)
          </p>
        </div>

        <div>
          <label className="block text-xl font-medium text-gray-300 mb-3">
            Periodos a Analizar
          </label>
          <input
            type="number"
            value={periodos}
            onChange={(e) => setPeriodos(e.target.value)}
            className="w-full px-5 py-4 border-2 border-gray-700 rounded-xl text-gray-100 text-xl bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
            placeholder="Ej: 5"
          />
        </div>

        <div>
          <label className="block text-xl font-medium text-gray-300 mb-3">
            Horizonte Temporal (años)
          </label>
          <input
            type="number"
            value={horizonte}
            onChange={(e) => setHorizonte(e.target.value)}
            className="w-full px-5 py-4 border-2 border-gray-700 rounded-xl text-gray-100 text-xl bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
            placeholder="Ej: 10"
          />
        </div>

        <div>
          <label className="block text-xl font-medium text-gray-300 mb-3">
            Margen de Seguridad (%)
          </label>
          <input
            type="number"
            value={margenSeguridad}
            onChange={(e) => setMargenSeguridad(e.target.value)}
            className="w-full px-5 py-4 border-2 border-gray-700 rounded-xl text-gray-100 text-xl bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
            placeholder="Ej: 30"
          />
        </div>
      </div>

      <button
        onClick={handleCalcular}
        className="w-full py-5 bg-blue-600 text-white text-2xl font-bold rounded-xl hover:bg-blue-500 transition shadow-lg"
      >
        Calcular Valoración
      </button>

      {result && (
        <div className="mt-12 p-10 bg-gray-800 border-2 border-gray-700 rounded-2xl text-center shadow-inner">
          <p className="text-5xl font-extrabold text-gray-100">
            Resultado: <span className={result === 'VALUE' ? 'text-green-400' : 'text-red-400'}>{result}</span>
          </p>
        </div>
      )}

      {chartData && (
        <div className="mt-12 p-8 bg-gray-800 rounded-2xl shadow-xl border border-gray-700">
          <Bar
            data={chartData}
            options={{
              responsive: true,
              scales: {
                y: { ticks: { color: '#e5e7eb' }, grid: { color: '#4b5563' } },
                x: { ticks: { color: '#e5e7eb' }, grid: { color: '#4b5563' } },
              },
              plugins: {
                legend: { labels: { color: '#e5e7eb' } },
              },
            }}
          />
        </div>
      )}
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

function FinancialStatementTab({ title, data, type }: { title: string; data: any[]; type: 'income' | 'balance' | 'cashFlow' }) {
  if (data.length === 0) {
    return <p className="text-2xl text-gray-400 text-center py-10">No hay datos disponibles para {title}</p>;
  }

  const sortedData = [...data].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let metrics: { key: string; label: string }[] = [];

  if (type === 'income') {
    metrics = [
      { key: 'revenue', label: 'Revenue' },
      { key: 'costOfRevenue', label: 'Cost of Revenue' },
      { key: 'grossProfit', label: 'Gross Profit' },
      { key: 'grossProfitMarginTTM', label: 'Gross Profit Margin (TTM)' },
      { key: 'researchAndDevelopmentExpenses', label: 'Research and Development Expenses' },
      { key: 'generalAndAdministrativeExpenses', label: 'General and Administrative Expenses' },
      { key: 'sellingAndMarketingExpenses', label: 'Selling and Marketing Expenses' },
      { key: 'sellingGeneralAndAdministrativeExpenses', label: 'Selling General and Administrative Expenses' },
      { key: 'salesGeneralAndAdministrativeToRevenue', label: 'Sales General and Administrative to Revenue' },
      { key: 'otherExpenses', label: 'Other Expenses' },
      { key: 'operatingExpenses', label: 'Operating Expenses' },
      { key: 'costAndExpenses', label: 'Cost and Expenses' },
      { key: 'netInterestIncome', label: 'Net Interest Income' },
      { key: 'interestIncome', label: 'Interest Income' },
      { key: 'interestExpense', label: 'Interest Expense' },
      { key: 'depreciationAndAmortization', label: 'Depreciation and Amortization' },
      { key: 'ebitda', label: 'EBITDA' },
      { key: 'ebitdaMarginTTM', label: 'EBITDA Margin (TTM)' },
      { key: 'ebit', label: 'EBIT' },
      { key: 'ebitMarginTTM', label: 'EBIT Margin (TTM)' },
      { key: 'nonOperatingIncomeExcludingInterest', label: 'Non Operating Income Excluding Interest' },
      { key: 'operatingIncome', label: 'Operating Income' },
      { key: 'operatingProfitMarginTTM', label: 'Operating Profit Margin (TTM)' },
      { key: 'totalOtherIncomeExpensesNet', label: 'Total Other Income Expenses Net' },
      { key: 'incomeBeforeTax', label: 'Income Before Tax' },
      { key: 'pretaxProfitMarginTTM', label: 'Pretax Profit Margin (TTM)' },
      { key: 'incomeTaxExpense', label: 'Income Tax Expense' },
      { key: 'netIncomeFromContinuingOperations', label: 'Net Income From Continuing Operations' },
      { key: 'continuousOperationsProfitMarginTTM', label: 'Continuous Operations Profit Margin (TTM)' },
      { key: 'netIncomeFromDiscontinuedOperations', label: 'Net Income From Discontinued Operations' },
      { key: 'otherAdjustmentsToNetIncome', label: 'Other Adjustments To Net Income' },
      { key: 'netIncome', label: 'Net Income' },
      { key: 'netIncomeDeductions', label: 'Net Income Deductions' },
      { key: 'bottomLineNetIncome', label: 'Bottom Line Net Income' },
      { key: 'bottomLineProfitMarginTTM', label: 'Bottom Line Profit Margin (TTM)' },
      { key: 'netProfitMarginTTM', label: 'Net Profit Margin (TTM)' },
      { key: 'eps', label: 'EPS' },
      { key: 'epsDiluted', label: 'EPS Diluted' },
      { key: 'weightedAverageShsOut', label: 'Weighted Average Shs Out' },
      { key: 'weightedAverageShsOutDil', label: 'Weighted Average Shs Out Dil' },
      { key: 'researchAndDevelopementToRevenue', label: 'Research And Development To Revenue' },
      { key: 'stockBasedCompensationToRevenue', label: 'Stock Based Compensation To Revenue' },
      { key: 'returnOnAssets', label: 'Return On Assets' },
      { key: 'operatingReturnOnAssets', label: 'Operating Return On Assets' },
      { key: 'returnOnTangibleAssets', label: 'Return On Tangible Assets' },
      { key: 'returnOnEquity', label: 'Return On Equity' },
      { key: 'returnOnInvestedCapital', label: 'Return On Invested Capital' },
      { key: 'returnOnCapitalEmployed', label: 'Return On Capital Employed' },
      { key: 'incomeQuality', label: 'Income Quality' },
      { key: 'taxBurden', label: 'Tax Burden' },
      { key: 'interestBurden', label: 'Interest Burden' },
      { key: 'effectiveTaxRateTTM', label: 'Effective Tax Rate (TTM)' },
      { key: 'netIncomePerEBTTTM', label: 'Net Income Per EBT (TTM)' },
      { key: 'ebtPerEbitTTM', label: 'EBT Per EBIT (TTM)' },
      { key: 'receivablesTurnoverTTM', label: 'Receivables Turnover (TTM)' },
      { key: 'payablesTurnoverTTM', label: 'Payables Turnover (TTM)' },
      { key: 'inventoryTurnoverTTM', label: 'Inventory Turnover (TTM)' },
      { key: 'fixedAssetTurnoverTTM', label: 'Fixed Asset Turnover (TTM)' },
      { key: 'assetTurnoverTTM', label: 'Asset Turnover (TTM)' },
      { key: 'averageReceivables', label: 'Average Receivables' },
      { key: 'averagePayables', label: 'Average Payables' },
      { key: 'averageInventory', label: 'Average Inventory' },
      { key: 'daysOfSalesOutstanding', label: 'Days Of Sales Outstanding' },
      { key: 'daysOfPayablesOutstanding', label: 'Days Of Payables Outstanding' },
      { key: 'daysOfInventoryOutstanding', label: 'Days Of Inventory Outstanding' },
      { key: 'operatingCycle', label: 'Operating Cycle' },
      { key: 'cashConversionCycle', label: 'Cash Conversion Cycle' },
      { key: 'revenuePerShareTTM', label: 'Revenue Per Share (TTM)' },
      { key: 'netIncomePerShareTTM', label: 'Net Income Per Share (TTM)' },
    ];
  } else if (type === 'balance') {
    metrics = [
      { key: 'totalAssets', label: 'Total Assets' },
      { key: 'totalLiabilities', label: 'Total Liabilities' },
      { key: 'totalStockholdersEquity', label: 'Total Equity' },
      { key: 'cashAndCashEquivalents', label: 'Cash & Equivalents' },
      { key: 'totalDebt', label: 'Total Debt' },
      { key: 'shortTermInvestments', label: 'Short Term Investments' },
      { key: 'cashAndShortTermInvestments', label: 'Cash And Short Term Investments' },
      { key: 'netReceivables', label: 'Net Receivables' },
      { key: 'accountsReceivables', label: 'Accounts Receivables' },
      { key: 'otherReceivables', label: 'Other Receivables' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'prepaids', label: 'Prepaids' },
      { key: 'otherCurrentAssets', label: 'Other Current Assets' },
      { key: 'totalCurrentAssets', label: 'Total Current Assets' },
      { key: 'propertyPlantEquipmentNet', label: 'Property Plant Equipment Net' },
      { key: 'goodwill', label: 'Goodwill' },
      { key: 'intangibleAssets', label: 'Intangible Assets' },
      { key: 'goodwillAndIntangibleAssets', label: 'Goodwill And Intangible Assets' },
      { key: 'longTermInvestments', label: 'Long Term Investments' },
      { key: 'taxAssets', label: 'Tax Assets' },
      { key: 'otherNonCurrentAssets', label: 'Other Non Current Assets' },
      { key: 'totalNonCurrentAssets', label: 'Total Non Current Assets' },
      { key: 'otherAssets', label: 'Other Assets' },
      { key: 'totalPayables', label: 'Total Payables' },
      { key: 'accountPayables', label: 'Account Payables' },
      { key: 'otherPayables', label: 'Other Payables' },
      { key: 'accruedExpenses', label: 'Accrued Expenses' },
      { key: 'shortTermDebt', label: 'Short Term Debt' },
      { key: 'capitalLeaseObligationsCurrent', label: 'Capital Lease Obligations Current' },
      { key: 'taxPayables', label: 'Tax Payables' },
      { key: 'deferredRevenue', label: 'Deferred Revenue' },
      { key: 'otherCurrentLiabilities', label: 'Other Current Liabilities' },
      { key: 'totalCurrentLiabilities', label: 'Total Current Liabilities' },
      { key: 'longTermDebt', label: 'Long Term Debt' },
      { key: 'capitalLeaseObligationsNonCurrent', label: 'Capital Lease Obligations Non Current' },
      { key: 'deferredRevenueNonCurrent', label: 'Deferred Revenue Non Current' },
      { key: 'deferredTaxLiabilitiesNonCurrent', label: 'Deferred Tax Liabilities Non Current' },
      { key: 'otherNonCurrentLiabilities', label: 'Other Non Current Liabilities' },
      { key: 'totalNonCurrentLiabilities', label: 'Total Non Current Liabilities' },
      { key: 'otherLiabilities', label: 'Other Liabilities' },
      { key: 'capitalLeaseObligations', label: 'Capital Lease Obligations' },
      { key: 'treasuryStock', label: 'Treasury Stock' },
      { key: 'preferredStock', label: 'Preferred Stock' },
      { key: 'commonStock', label: 'Common Stock' },
      { key: 'retainedEarnings', label: 'Retained Earnings' },
      { key: 'additionalPaidInCapital', label: 'Additional Paid In Capital' },
      { key: 'accumulatedOtherComprehensiveIncomeLoss', label: 'Accumulated Other Comprehensive Income Loss' },
      { key: 'otherTotalStockholdersEquity', label: 'Other Total Stockholders Equity' },
      { key: 'totalEquity', label: 'Total Equity' },
      { key: 'minorityInterest', label: 'Minority Interest' },
      { key: 'totalLiabilitiesAndTotalEquity', label: 'Total Liabilities And Total Equity' },
      { key: 'totalInvestments', label: 'Total Investments' },
      { key: 'netDebt', label: 'Net Debt' },
      { key: 'workingCapital', label: 'Working Capital' },
      { key: 'investedCapital', label: 'Invested Capital' },
      { key: 'tangibleAssetValue', label: 'Tangible Asset Value' },
      { key: 'netCurrentAssetValue', label: 'Net Current Asset Value' },
      { key: 'intangiblesToTotalAssets', label: 'Intangibles To Total Assets' },
      { key: 'currentRatio', label: 'Current Ratio' },
      { key: 'currentRatioTTM', label: 'Current Ratio (TTM)' },
      { key: 'quickRatioTTM', label: 'Quick Ratio (TTM)' },
      { key: 'solvencyRatioTTM', label: 'Solvency Ratio (TTM)' },
      { key: 'cashRatioTTM', label: 'Cash Ratio (TTM)' },
      { key: 'debtToAssetsRatioTTM', label: 'Debt To Assets Ratio (TTM)' },
      { key: 'debtToEquityRatioTTM', label: 'Debt To Equity Ratio (TTM)' },
      { key: 'debtToCapitalRatioTTM', label: 'Debt To Capital Ratio (TTM)' },
      { key: 'longTermDebtToCapitalRatioTTM', label: 'Long Term Debt To Capital Ratio (TTM)' },
      { key: 'financialLeverageRatioTTM', label: 'Financial Leverage Ratio (TTM)' },
      { key: 'workingCapitalTurnoverRatioTTM', label: 'Working Capital Turnover Ratio (TTM)' },
      { key: 'debtToMarketCapTTM', label: 'Debt To Market Cap (TTM)' },
      { key: 'grahamNumber', label: 'Graham Number' },
      { key: 'grahamNetNet', label: 'Graham Net Net' },
      { key: 'bookValuePerShareTTM', label: 'Book Value Per Share (TTM)' },
      { key: 'tangibleBookValuePerShareTTM', label: 'Tangible Book Value Per Share (TTM)' },
      { key: 'shareholdersEquityPerShareTTM', label: 'Shareholders Equity Per Share (TTM)' },
      { key: 'cashPerShareTTM', label: 'Cash Per Share (TTM)' },
      { key: 'interestDebtPerShareTTM', label: 'Interest Debt Per Share (TTM)' },
    ];
  } else if (type === 'cashFlow') {
    metrics = [
      { key: 'operatingCashFlow', label: 'Operating Cash Flow' },
      { key: 'freeCashFlow', label: 'Free Cash Flow' },
      { key: 'capitalExpenditure', label: 'Capital Expenditure' },
      { key: 'dividendsPaid', label: 'Dividends Paid' },
      { key: 'netChangeInCash', label: 'Net Change in Cash' },
      { key: 'netIncome', label: 'Net Income' },
      { key: 'depreciationAndAmortization', label: 'Depreciation And Amortization' },
      { key: 'deferredIncomeTax', label: 'Deferred Income Tax' },
      { key: 'stockBasedCompensation', label: 'Stock Based Compensation' },
      { key: 'changeInWorkingCapital', label: 'Change In Working Capital' },
      { key: 'accountsReceivables', label: 'Accounts Receivables' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'accountsPayables', label: 'Accounts Payables' },
      { key: 'otherWorkingCapital', label: 'Other Working Capital' },
      { key: 'otherNonCashItems', label: 'Other Non Cash Items' },
      { key: 'netCashProvidedByOperatingActivities', label: 'Net Cash Provided By Operating Activities' },
      { key: 'investmentsInPropertyPlantAndEquipment', label: 'Investments In Property Plant And Equipment' },
      { key: 'acquisitionsNet', label: 'Acquisitions Net' },
      { key: 'purchasesOfInvestments', label: 'Purchases Of Investments' },
      { key: 'salesMaturitiesOfInvestments', label: 'Sales Maturities Of Investments' },
      { key: 'otherInvestingActivities', label: 'Other Investing Activities' },
      { key: 'netCashProvidedByInvestingActivities', label: 'Net Cash Provided By Investing Activities' },
      { key: 'netDebtIssuance', label: 'Net Debt Issuance' },
      { key: 'longTermNetDebtIssuance', label: 'Long Term Net Debt Issuance' },
      { key: 'shortTermNetDebtIssuance', label: 'Short Term Net Debt Issuance' },
      { key: 'netStockIssuance', label: 'Net Stock Issuance' },
      { key: 'netCommonStockIssuance', label: 'Net Common Stock Issuance' },
      { key: 'commonStockIssuance', label: 'Common Stock Issuance' },
      { key: 'commonStockRepurchased', label: 'Common Stock Repurchased' },
      { key: 'netPreferredStockIssuance', label: 'Net Preferred Stock Issuance' },
      { key: 'netDividendsPaid', label: 'Net Dividends Paid' },
      { key: 'commonDividendsPaid', label: 'Common Dividends Paid' },
      { key: 'preferredDividendsPaid', label: 'Preferred Dividends Paid' },
      { key: 'otherFinancingActivities', label: 'Other Financing Activities' },
      { key: 'netCashProvidedByFinancingActivities', label: 'Net Cash Provided By Financing Activities' },
      { key: 'effectOfForexChangesOnCash', label: 'Effect Of Forex Changes On Cash' },
      { key: 'cashAtEndOfPeriod', label: 'Cash At End Of Period' },
      { key: 'cashAtBeginningOfPeriod', label: 'Cash At Beginning Of Period' },
      { key: 'incomeTaxesPaid', label: 'Income Taxes Paid' },
      { key: 'interestPaid', label: 'Interest Paid' },
      { key: 'capexToOperatingCashFlow', label: 'Capex To Operating Cash Flow' },
      { key: 'capexToDepreciation', label: 'Capex To Depreciation' },
      { key: 'capexToRevenue', label: 'Capex To Revenue' },
      { key: 'freeCashFlowToEquity', label: 'Free Cash Flow To Equity' },
      { key: 'freeCashFlowToFirm', label: 'Free Cash Flow To Firm' },
      { key: 'operatingCashFlowRatioTTM', label: 'Operating Cash Flow Ratio (TTM)' },
      { key: 'operatingCashFlowSalesRatioTTM', label: 'Operating Cash Flow Sales Ratio (TTM)' },
      { key: 'freeCashFlowOperatingCashFlowRatioTTM', label: 'Free Cash Flow Operating Cash Flow Ratio (TTM)' },
      { key: 'debtServiceCoverageRatioTTM', label: 'Debt Service Coverage Ratio (TTM)' },
      { key: 'interestCoverageRatioTTM', label: 'Interest Coverage Ratio (TTM)' },
      { key: 'shortTermOperatingCashFlowCoverageRatioTTM', label: 'Short Term Operating Cash Flow Coverage Ratio (TTM)' },
      { key: 'operatingCashFlowCoverageRatioTTM', label: 'Operating Cash Flow Coverage Ratio (TTM)' },
      { key: 'capitalExpenditureCoverageRatioTTM', label: 'Capital Expenditure Coverage Ratio (TTM)' },
      { key: 'dividendPaidAndCapexCoverageRatioTTM', label: 'Dividend Paid And Capex Coverage Ratio (TTM)' },
      { key: 'operatingCashFlowPerShareTTM', label: 'Operating Cash Flow Per Share (TTM)' },
      { key: 'capexPerShareTTM', label: 'Capex Per Share (TTM)' },
      { key: 'freeCashFlowPerShareTTM', label: 'Free Cash Flow Per Share (TTM)' },
      { key: 'marketCap', label: 'Market Cap' },
      { key: 'enterpriseValue', label: 'Enterprise Value' },
      { key: 'enterpriseValueTTM', label: 'Enterprise Value (TTM)' },
      { key: 'evToSales', label: 'EV To Sales' },
      { key: 'evToOperatingCashFlow', label: 'EV To Operating Cash Flow' },
      { key: 'evToFreeCashFlow', label: 'EV To Free Cash Flow' },
      { key: 'evToEBITDA', label: 'EV To EBITDA' },
      { key: 'netDebtToEBITDA', label: 'Net Debt To EBITDA' },
      { key: 'earningsYield', label: 'Earnings Yield' },
      { key: 'freeCashFlowYield', label: 'Free Cash Flow Yield' },
      { key: 'priceToEarningsRatioTTM', label: 'Price To Earnings Ratio (TTM)' },
      { key: 'priceToEarningsGrowthRatioTTM', label: 'Price To Earnings Growth Ratio (TTM)' },
      { key: 'forwardPriceToEarningsGrowthRatioTTM', label: 'Forward Price To Earnings Growth Ratio (TTM)' },
      { key: 'priceToBookRatioTTM', label: 'Price To Book Ratio (TTM)' },
      { key: 'priceToSalesRatioTTM', label: 'Price To Sales Ratio (TTM)' },
      { key: 'priceToFreeCashFlowRatioTTM', label: 'Price To Free Cash Flow Ratio (TTM)' },
      { key: 'priceToOperatingCashFlowRatioTTM', label: 'Price To Operating Cash Flow Ratio (TTM)' },
      { key: 'priceToFairValueTTM', label: 'Price To Fair Value (TTM)' },
      { key: 'enterpriseValueMultipleTTM', label: 'Enterprise Value Multiple (TTM)' },
      { key: 'dividendPayoutRatioTTM', label: 'Dividend Payout Ratio (TTM)' },
      { key: 'dividendYieldTTM', label: 'Dividend Yield (TTM)' },
      { key: 'dividendPerShareTTM', label: 'Dividend Per Share (TTM)' },
    ];
  }

  return (
    <div className="space-y-8">
      <h3 className="text-3xl font-bold text-gray-100 mb-6">{title} (Últimos 10 Periodos)</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-6 py-4 text-left text-gray-200 font-bold text-base sticky left-0 bg-gray-800 z-10 min-w-45">
                Métrica
              </th>
              {sortedData.map((row) => (
                <th key={row.date} className="px-6 py-4 text-center text-gray-200 font-bold text-base min-w-35">
                  {row.date}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {metrics.map((metric) => (
              <tr key={metric.key} className="hover:bg-gray-800 transition">
                <td className="px-6 py-4 text-gray-300 font-medium sticky left-0 bg-gray-900 z-10 border-r border-gray-700">
                  {metric.label}
                </td>
                {sortedData.map((row, i) => (
                  <td key={i} className="px-6 py-4 text-center text-gray-300">
                    {row[metric.key] !== undefined && row[metric.key] !== null
                      ? `$${(row[metric.key] / 1e9).toFixed(2)}B`
                      : 'N/A'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-gray-500 text-center">
        Valores en billones de dólares ($B). Ordenado del más reciente (izquierda) al más antiguo (derecha).
      </p>
    </div>
  );
}

function AnalistasTab({ priceTarget, estimates }: { priceTarget: any; estimates: any[] }) {
  return (
    <div className="space-y-12">
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Resumen de Price Targets (Analistas)</h3>
        {priceTarget && Object.keys(priceTarget).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-gray-100">Período</th>
                  <th className="px-6 py-4 text-center font-bold text-gray-100">Cantidad de Analistas</th>
                  <th className="px-6 py-4 text-center font-bold text-gray-100">Precio Objetivo Promedio ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Último Mes</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.lastMonthCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.lastMonthAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Último Trimestre</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.lastQuarterCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.lastQuarterAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Último Año</td>
                  <td className="px-6 py-4 text-center text-gray-300">{priceTarget.lastYearCount || 'N/A'}</td>
                  <td className="px-6 py-4 text-center text-green-400 font-bold">
                    ${priceTarget.lastYearAvgPriceTarget?.toFixed(2) || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Histórico (All Time)</td>
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
        <p className="mt-4 text-sm text-gray-500 text-center">
          Fuentes: {priceTarget.publishers || 'Benzinga, TipRanks, MarketWatch, etc.'}
        </p>
      </section>

      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">Estimaciones Financieras (Analyst Forecasts)</h3>
        {estimates && estimates.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-6 py-4 text-left text-gray-100 font-bold text-base sticky left-0 bg-gray-700 z-10 min-w-55">
                      Métrica
                    </th>
                    {estimates.slice(0, 5).map((row: any) => (
                      <th key={row.date} className="px-6 py-4 text-center text-gray-100 font-bold text-base min-w-40">
                        {row.date?.slice(0, 7) || 'N/A'} ({row.period || 'Annual'})
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {[
                    { key: 'revenueAvg', label: 'Revenue (Avg)' },
                    { key: 'revenueLow', label: 'Revenue (Low)' },
                    { key: 'revenueHigh', label: 'Revenue (High)' },
                    { key: 'epsAvg', label: 'EPS (Avg)' },
                    { key: 'epsLow', label: 'EPS (Low)' },
                    { key: 'epsHigh', label: 'EPS (High)' },
                    { key: 'ebitdaAvg', label: 'EBITDA (Avg)' },
                    { key: 'ebitdaLow', label: 'EBITDA (Low)' },
                    { key: 'ebitdaHigh', label: 'EBITDA (High)' },
                    { key: 'netIncomeAvg', label: 'Net Income (Avg)' },
                    { key: 'netIncomeLow', label: 'Net Income (Low)' },
                    { key: 'netIncomeHigh', label: 'Net Income (High)' },
                    { key: 'sgaExpenseAvg', label: 'SG&A Expense (Avg)' },
                  ].map((metric) => (
                    <tr key={metric.key} className="hover:bg-gray-800 transition">
                      <td className="px-6 py-4 text-gray-300 font-medium sticky left-0 bg-gray-800 z-10 border-r border-gray-700">
                        {metric.label}
                      </td>
                      {estimates.slice(0, 5).map((row: any, i: number) => (
                        <td key={i} className="px-6 py-4 text-center text-gray-300">
                          {row[metric.key] !== undefined && row[metric.key] !== null
                            ? row[metric.key] > 1e9
                              ? `$${(row[metric.key] / 1e9).toFixed(2)}B`
                              : `$${(row[metric.key] / 1e6).toFixed(2)}M`
                            : 'N/A'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm text-gray-500 text-center">
              Valores en billones ($B) o millones ($M). Mostrando hasta 5 periodos más recientes.
            </p>
          </>
        ) : (
          <p className="text-xl text-gray-400 text-center py-10">No hay datos de estimaciones disponibles</p>
        )}
      </section>
    </div>
  );
}

function DCFTab({ dcfStandard, dcfCustom }: { dcfStandard: any; dcfCustom: any }) {
  return (
    <div className="space-y-12">
      <section className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700">
        <h3 className="text-3xl font-bold text-gray-100 mb-6">DCF Valuation (Estándar)</h3>
        {dcfStandard && Object.keys(dcfStandard).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
              <p className="text-lg text-gray-400 mb-2">Valor Intrínseco (DCF)</p>
              <p className="text-4xl font-bold text-green-400">
                ${dcfStandard.dcf?.toLocaleString() || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
              <p className="text-lg text-gray-400 mb-2">Precio Actual del Mercado</p>
              <p className="text-4xl font-bold text-blue-400">
                ${dcfStandard.stockPrice?.toFixed(2) || 'N/A'}
              </p>
            </div>

            <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
              <p className="text-lg text-gray-400 mb-2">Fecha de Cálculo</p>
              <p className="text-3xl font-semibold text-gray-300">
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
                    {(dcfCustom.wacc * 100)?.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Crecimiento a Largo Plazo</td>
                  <td className="px-6 py-4 text-right text-indigo-400 font-bold">
                    {(dcfCustom.longTermGrowthRate * 100)?.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Beta</td>
                  <td className="px-6 py-4 text-right text-gray-300">{dcfCustom.beta?.toFixed(2) || 'N/A'}</td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Cost of Debt (después de impuestos)</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {(dcfCustom.afterTaxCostOfDebt * 100)?.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Cost of Equity</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {(dcfCustom.costOfEquity * 100)?.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Market Risk Premium</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {(dcfCustom.marketRiskPremium * 100)?.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Risk Free Rate</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    {(dcfCustom.riskFreeRate * 100)?.toFixed(2)}%
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Deuda Total</td>
                  <td className="px-6 py-4 text-right text-gray-300">
                    ${dcfCustom.totalDebt?.toLocaleString() || 'N/A'}
                  </td>
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium text-gray-300">Equity Value (Intrinsic)</td>
                  <td className="px-6 py-4 text-right font-bold text-green-400">
                    ${dcfCustom.equityValue?.toLocaleString() || 'N/A'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xl text-gray-400 text-center py-10">No hay datos de Custom DCF disponibles</p>
        )}
        <p className="mt-4 text-sm text-gray-500 text-center">
          Cálculo avanzado con supuestos detallados (WACC, beta, crecimiento, etc.)
        </p>
      </section>
    </div>
  );
}import React from 'react';