'use client';

import { Tab } from '@headlessui/react';
import { Suspense, useEffect, useState } from 'react';
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

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
    'WACC',
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
  {/* Inputs */}
  <Tab.Panel unmount={false} className="rounded-2xl bg-gray-800 p-10 shadow-2xl border border-gray-700">
    <InputsTab
      ticker={activeTicker}
      quote={quote}
      sharedAverageVal={sharedAverageVal}
      onAnalizar={handleAnalizar}
    />
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
    <AnalistasTab priceTarget={priceTarget} />
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
    <DCFTab dcfStandard={dcfStandard} dcfCustom={dcfCustom} quote={quote} />
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

function InputsTab({
  ticker,
  quote,
  sharedAverageVal,
  onAnalizar,
}: {
  ticker: string;
  quote: any;
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
          console.error('[InputsTab] No API key found');
          return;
        }

        // Calcular fechas para el último año
        const today = new Date();
        const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
        const fromDate = oneYearAgo.toISOString().split('T')[0];
        const toDate = today.toISOString().split('T')[0];

        const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${ticker}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`;
        console.log('[InputsTab] Fetching historical data...');

        const res = await fetch(url);
        if (!res.ok) {
          console.error('[InputsTab] API error:', res.status);
          return;
        }

        const json = await res.json();
        console.log('[InputsTab] Data received:', json.length, 'records');

        if (Array.isArray(json) && json.length > 0) {
          // Ordenar por fecha ascendente y mapear a formato esperado
          const sorted = json
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((item: any) => ({
              date: item.date,
              close: item.price || item.close,
            }));
          setHistorical(sorted);
        }
      } catch (err) {
        console.error('[InputsTab] Error fetching history:', err);
      } finally {
        setLoading(false);
      }
    }

    if (ticker) fetchHistory();
  }, [ticker]);

  const chartData = {
    labels: historical.map(d => d.date),
    datasets: [
      {
        label: 'Precio de cierre',
        data: historical.map(d => d.close),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        tension: 0.1,
        fill: true,
        pointRadius: 0,
      },
      {
        label: 'Precio actual',
        data: new Array(historical.length).fill(currentPrice),
        borderColor: 'rgb(59, 130, 246)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
      ...(precioCompraSugerido ? [{
        label: `Precio compra sugerido (${margenPct}% bajo avg)`,
        data: new Array(historical.length).fill(precioCompraSugerido),
        borderColor: 'rgb(34, 197, 94)',
        borderDash: [10, 5],
        pointRadius: 0,
        borderWidth: 2,
      }] : []),
      ...(sharedAverageVal ? [{
        label: 'Valuación promedio',
        data: new Array(historical.length).fill(sharedAverageVal),
        borderColor: 'rgb(168, 85, 247)',
        borderDash: [3, 3],
        pointRadius: 0,
      }] : []),
    ],
  };

  return (
    <div className="space-y-10">
      {/* Ticker Input + Analizar Button */}
      <div className="bg-gray-700 p-6 rounded-xl border border-gray-600">
        <h3 className="text-2xl font-bold text-gray-100 mb-4">Buscar Ticker</h3>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-lg font-medium text-gray-300 mb-2">
              Ticker
            </label>
            <input
              type="text"
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && onAnalizar(inputTicker)}
              placeholder="Ej: AAPL, MSFT, GOOGL"
              className="w-full px-5 py-4 border-2 border-gray-600 rounded-xl text-gray-100 text-xl bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>
          <button
            onClick={() => onAnalizar(inputTicker)}
            disabled={!inputTicker.trim()}
            className="px-8 py-4 bg-blue-600 text-white text-xl font-bold rounded-xl hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            Analizar
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-400">
          Ingresa un ticker y presiona "Analizar" para cargar los datos de esa acción en todas las pestañas.
        </p>
      </div>

      {/* Mensaje si no hay averageVal */}
      {!sharedAverageVal && (
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-xl p-4 text-center">
          <p className="text-yellow-400">
            Ve a la pestaña <strong>Valuaciones</strong> para calcular el promedio de valuación. Los valores se actualizarán automáticamente aquí.
          </p>
        </div>
      )}

      {/* Solo mostrar Margen de Seguridad */}
      <div className="max-w-md">
        <label className="block text-xl font-medium text-gray-300 mb-3">
          Margen de Seguridad (%)
        </label>
        <input
          type="number"
          value={margenSeguridad}
          onChange={(e) => setMargenSeguridad(e.target.value)}
          className="w-full px-5 py-4 border-2 border-gray-700 rounded-xl text-gray-100 text-xl bg-gray-900 focus:border-blue-500 focus:ring-blue-500 placeholder-gray-500"
          placeholder="Ej: 15"
        />
        <p className="mt-2 text-sm text-gray-400">
          El precio de compra sugerido será {margenPct}% por debajo de la valuación promedio
        </p>
      </div>

      {/* Resumen de precios */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
          <p className="text-lg text-gray-400 mb-2">Precio Actual</p>
          <p className="text-3xl font-bold text-blue-400">
            ${currentPrice?.toFixed(2) || 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
          <p className="text-lg text-gray-400 mb-2">Valuación Promedio</p>
          <p className="text-3xl font-bold text-purple-400">
            {sharedAverageVal ? `$${sharedAverageVal.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
          <p className="text-lg text-gray-400 mb-2">Precio Compra Sugerido</p>
          <p className="text-3xl font-bold text-green-400">
            {precioCompraSugerido ? `$${precioCompraSugerido.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-6 rounded-xl border border-gray-600 text-center">
          <p className="text-lg text-gray-400 mb-2">Upside al Target</p>
          <p className={`text-3xl font-bold ${sharedAverageVal && currentPrice ? (sharedAverageVal > currentPrice ? 'text-green-400' : 'text-red-400') : 'text-gray-400'}`}>
            {sharedAverageVal && currentPrice ? `${(((sharedAverageVal - currentPrice) / currentPrice) * 100).toFixed(1)}%` : 'N/A'}
          </p>
        </div>
      </div>

      {/* Gráfico de línea */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando gráfico de precios...</div>
      ) : historical.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No hay datos históricos disponibles</div>
      ) : (
        <div className="p-8 bg-gray-800 rounded-2xl shadow-xl border border-gray-700">
          <h4 className="text-xl font-semibold text-gray-200 mb-4">Precio histórico (último año)</h4>
          <div className="h-96">
            <Line
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  y: {
                    ticks: { color: '#e5e7eb' },
                    grid: { color: '#4b5563' },
                  },
                  x: {
                    ticks: {
                      color: '#e5e7eb',
                      maxTicksLimit: 12,
                    },
                    grid: { color: '#4b5563' },
                  },
                },
                plugins: {
                  legend: {
                    labels: { color: '#e5e7eb' },
                    position: 'top',
                  },
                },
              }}
            />
          </div>
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

  // Métricas esenciales sin TTM (solo datos que varían por período)
  let metrics: { key: string; label: string; isRatio?: boolean; isPerShare?: boolean }[] = [];

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
      { key: 'totalNonCurrentAssets', label: 'Total Non-Current Assets' },
      { key: 'totalAssets', label: 'Total Assets' },
      // Liabilities
      { key: 'accountPayables', label: 'Accounts Payable' },
      { key: 'shortTermDebt', label: 'Short Term Debt' },
      { key: 'totalCurrentLiabilities', label: 'Total Current Liabilities' },
      { key: 'longTermDebt', label: 'Long Term Debt' },
      { key: 'totalNonCurrentLiabilities', label: 'Total Non-Current Liabilities' },
      { key: 'totalLiabilities', label: 'Total Liabilities' },
      { key: 'totalDebt', label: 'Total Debt' },
      // Equity
      { key: 'commonStock', label: 'Common Stock' },
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
              {sortedData.map((row) => (
                <th key={row.date} className="px-6 py-5 text-center text-gray-200 font-bold text-lg min-w-[140px]">
                  {new Date(row.date).getFullYear()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {metrics.map((metric) => (
              <tr key={metric.key} className="hover:bg-gray-700/50 transition">
                <td className="px-8 py-4 text-gray-200 font-medium text-base sticky left-0 bg-gray-900 z-10 border-r border-gray-700">
                  {metric.label}
                </td>
                {sortedData.map((row, i) => (
                  <td key={i} className="px-6 py-4 text-center text-gray-100 text-base font-medium">
                    {formatValue(row[metric.key], metric)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-base text-gray-400 text-center">
        Datos ordenados del más reciente (izquierda) al más antiguo (derecha).
      </p>
    </div>
  );
}

function AnalistasTab({ priceTarget }: { priceTarget: any }) {
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
    </div>
  );
}

function DCFTab({ dcfStandard, dcfCustom, quote }: { dcfStandard: any; dcfCustom: any; quote: any }) {
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