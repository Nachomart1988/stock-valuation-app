'use client'

import { useEffect, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useLanguage } from '@/i18n/LanguageContext'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
)

interface Props {
  ticker: string
  quote: any
  sharedAverageVal: number | null
}

export default function AnalisisFinalTab({
  ticker,
  quote,
  sharedAverageVal,
}: Props) {
  const { t } = useLanguage();
  const [margenSeguridad, setMargenSeguridad] = useState(15)
  const [años, setAños] = useState(3)
  const [historical, setHistorical] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const precioEstimado = sharedAverageVal ? sharedAverageVal * (1 - margenSeguridad / 100) : null
  const currentPrice = quote?.price || null
  const upside = precioEstimado && currentPrice
    ? ((precioEstimado - currentPrice) / currentPrice) * 100
    : null

  let veredicto = t('analisisFinalTab.noData')
  let color = 'text-gray-400'

  if (upside !== null) {
    if (upside > 20) {
      veredicto = t('analisisFinalTab.cheap') || 'Barata'
      color = 'text-green-400'
    } else if (upside > -5) {
      veredicto = t('analisisFinalTab.fair') || 'Justa'
      color = 'text-yellow-400'
    } else {
      veredicto = t('analisisFinalTab.expensive') || 'Cara'
      color = 'text-red-400'
    }
  }

  useEffect(() => {
    async function fetchHistory() {
      try {
        setLoading(true)
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY
        if (!apiKey) {
          console.error('[AnalisisFinal] No API key found')
          return
        }

        // Calcular fechas según años seleccionados
        const today = new Date()
        const yearsAgo = new Date(today.getFullYear() - años, today.getMonth(), today.getDate())
        const fromDate = yearsAgo.toISOString().split('T')[0]
        const toDate = today.toISOString().split('T')[0]

        const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${ticker}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`
        console.log('[AnalisisFinal] Fetching historical data...')

        const res = await fetch(url)
        if (!res.ok) {
          console.error('[AnalisisFinal] API error:', res.status)
          return
        }

        const json = await res.json()
        console.log('[AnalisisFinal] Data received:', json.length, 'records')

        if (Array.isArray(json) && json.length > 0) {
          const sorted = json
            .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((item: any) => ({
              date: item.date,
              close: item.price || item.close,
            }))
          setHistorical(sorted)
        }
      } catch (err) {
        console.error('[AnalisisFinal] Error:', err)
      } finally {
        setLoading(false)
      }
    }

    if (ticker) fetchHistory()
  }, [ticker, años])

  const chartData = {
    labels: historical.map(d => d.date),
    datasets: [
      {
        label: 'Precio cierre',
        data: historical.map(d => d.close),
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.1)',
        tension: 0.1,
        fill: true,
        pointRadius: 0,
      },
      ...(sharedAverageVal ? [{
        label: 'Valuación promedio',
        data: new Array(historical.length).fill(sharedAverageVal),
        borderColor: 'rgb(168, 85, 247)',
        borderDash: [5, 5],
        pointRadius: 0,
      }] : []),
      ...(precioEstimado ? [{
        label: `Precio compra sugerido (${margenSeguridad}% margen)`,
        data: new Array(historical.length).fill(precioEstimado),
        borderColor: 'rgb(34, 197, 94)',
        borderDash: [10, 5],
        pointRadius: 0,
        borderWidth: 2,
      }] : []),
      {
        label: 'Precio actual',
        data: new Array(historical.length).fill(currentPrice),
        borderColor: 'rgb(239, 68, 68)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
    ],
  }

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-rose-400 to-pink-400 bg-clip-text text-transparent">
            {t('analisisFinalTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('analisisFinalTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          {currentPrice && (
            <div className="text-right bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-2 rounded-xl border border-gray-600">
              <p className="text-xs text-gray-400">{t('analisisFinalTab.currentPrice')}</p>
              <p className="text-xl font-bold text-gray-100">${currentPrice.toFixed(2)}</p>
            </div>
          )}
          {precioEstimado && (
            <div className="text-right bg-gradient-to-r from-rose-900/40 to-pink-900/40 px-4 py-2 rounded-xl border border-rose-600">
              <p className="text-xs text-rose-400">{t('analisisFinalTab.estimatedPrice')}</p>
              <p className="text-xl font-bold text-rose-400">${precioEstimado.toFixed(2)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Mensaje si no hay averageVal */}
      {!sharedAverageVal && (
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-2xl p-6 text-center">
          <p className="text-yellow-400 text-lg">
            {t('analisisFinalTab.goToValuations')}
          </p>
        </div>
      )}

      {/* Hero Section - Veredicto Principal */}
      <div className={`rounded-2xl p-8 text-center border-2 ${
        veredicto === t('analisisFinalTab.cheap') ? 'bg-green-900/20 border-green-500' :
        veredicto === t('analisisFinalTab.fair') ? 'bg-yellow-900/20 border-yellow-500' :
        veredicto === t('analisisFinalTab.expensive') ? 'bg-red-900/20 border-red-500' :
        'bg-gray-800 border-gray-600'
      }`}>
        <p className="text-xl text-gray-400 mb-2">{t('analisisFinalTab.verdict')}</p>
        <p className={`text-6xl font-black mb-4 ${color}`}>
          {veredicto}
        </p>
        {upside !== null && (
          <p className={`text-3xl font-bold ${upside > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {upside > 0 ? '+' : ''}{upside.toFixed(1)}% {t('analisisFinalTab.potential')}
          </p>
        )}
      </div>

      {/* Inputs */}
      <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
        <h4 className="text-xl font-bold text-gray-200 mb-4">{t('analisisFinalTab.parameters')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-lg font-medium text-gray-300 mb-2">{t('analisisFinalTab.marginOfSafety')}</label>
            <input
              type="number"
              value={margenSeguridad}
              onChange={e => setMargenSeguridad(Number(e.target.value) || 15)}
              className="w-full p-4 bg-gray-900 border border-gray-600 rounded-xl text-gray-100 text-xl font-semibold"
            />
          </div>

          <div>
            <label className="block text-lg font-medium text-gray-300 mb-2">{t('analisisFinalTab.historicalYears')}</label>
            <input
              type="number"
              min={1}
              max={5}
              value={años}
              onChange={e => setAños(Math.max(1, Math.min(5, Number(e.target.value) || 3)))}
              className="w-full p-4 bg-gray-900 border border-gray-600 rounded-xl text-gray-100 text-xl font-semibold"
            />
          </div>
        </div>
      </div>

      {/* Resumen de análisis - Larger cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-green-900/40 to-green-800/20 p-6 rounded-2xl border border-green-600/50 text-center">
          <p className="text-lg text-green-300 mb-2">{t('analisisFinalTab.currentPrice')}</p>
          <p className="text-4xl font-black text-green-400">
            {currentPrice ? `$${currentPrice.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-800/20 p-6 rounded-2xl border border-emerald-600/50 text-center">
          <p className="text-lg text-emerald-300 mb-2">{t('analisisFinalTab.avgValuation')}</p>
          <p className="text-4xl font-black text-emerald-400">
            {sharedAverageVal ? `$${sharedAverageVal.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gradient-to-br from-green-900/40 to-green-800/20 p-6 rounded-2xl border border-green-600/50 text-center">
          <p className="text-lg text-green-300 mb-2">{t('analisisFinalTab.suggestedBuyPrice')}</p>
          <p className="text-4xl font-black text-green-400">
            {precioEstimado ? `$${precioEstimado.toFixed(2)}` : 'N/A'}
          </p>
          <p className="text-sm text-gray-500 mt-1">({margenSeguridad}% {t('analisisFinalTab.marginOfSafety').toLowerCase()})</p>
        </div>
        <div className={`p-6 rounded-2xl border text-center ${
          upside !== null && upside > 0
            ? 'bg-gradient-to-br from-green-900/40 to-emerald-800/20 border-green-600/50'
            : 'bg-gradient-to-br from-red-900/40 to-rose-800/20 border-red-600/50'
        }`}>
          <p className="text-lg text-gray-300 mb-2">{t('analisisFinalTab.upsideDownside')}</p>
          <p className={`text-4xl font-black ${upside !== null && upside > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {upside !== null ? `${upside > 0 ? '+' : ''}${upside.toFixed(1)}%` : 'N/A'}
          </p>
        </div>
      </div>

      {/* Chart Section */}
      {loading ? (
        <div className="text-center py-16">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent"></div>
          <p className="mt-4 text-gray-400 text-lg">{t('analisisFinalTab.loading')}</p>
        </div>
      ) : historical.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-2xl">{t('analisisFinalTab.noHistoricalData')}</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-2xl border border-gray-700 p-8">
          <h4 className="text-2xl font-bold text-gray-200 mb-6">
            {t('analisisFinalTab.historicalPrice')} ({años} {años === 1 ? t('analisisFinalTab.year') : t('analisisFinalTab.years')})
          </h4>
          <div className="h-[450px]">
            <Line
              data={chartData}
              options={{
                maintainAspectRatio: false,
                responsive: true,
                interaction: {
                  mode: 'index',
                  intersect: false,
                },
                scales: {
                  y: {
                    ticks: {
                      color: '#9ca3af',
                      font: { size: 12 },
                      callback: (value) => `$${value}`,
                    },
                    grid: { color: '#374151' },
                  },
                  x: {
                    ticks: {
                      color: '#9ca3af',
                      maxTicksLimit: 12,
                      font: { size: 11 },
                    },
                    grid: { color: '#374151' },
                  },
                },
                plugins: {
                  legend: {
                    labels: {
                      color: '#e5e7eb',
                      font: { size: 13 },
                      padding: 20,
                    },
                    position: 'top',
                  },
                  tooltip: {
                    backgroundColor: '#1f2937',
                    titleColor: '#f9fafb',
                    bodyColor: '#d1d5db',
                    borderColor: '#4b5563',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                      label: (context) => `${context.dataset.label}: $${context.parsed.y?.toFixed(2) ?? 'N/A'}`,
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      )}

      {/* Legend explanation */}
      <div className="bg-gray-800 rounded-2xl border border-gray-700 p-6">
        <h4 className="text-xl font-bold text-gray-200 mb-4">{t('analisisFinalTab.interpretation')}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-base">
          <div className="flex items-center gap-3">
            <div className="w-6 h-1 bg-emerald-400 rounded"></div>
            <span className="text-gray-300">{t('analisisFinalTab.closingPrice')}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-1 bg-emerald-500 rounded" style={{ borderStyle: 'dashed' }}></div>
            <span className="text-gray-300">{t('analisisFinalTab.avgValuationDesc')}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-1 bg-green-500 rounded" style={{ borderStyle: 'dashed' }}></div>
            <span className="text-gray-300">{t('analisisFinalTab.buyPriceDesc')}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-6 h-1 bg-red-500 rounded" style={{ borderStyle: 'dashed' }}></div>
            <span className="text-gray-300">{t('analisisFinalTab.currentPriceDesc')}</span>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        {t('analisisFinalTab.footer')}
      </p>
    </div>
  )
}
