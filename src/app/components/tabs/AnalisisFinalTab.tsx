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
  const [margenSeguridad, setMargenSeguridad] = useState(15)
  const [años, setAños] = useState(3)
  const [historical, setHistorical] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const precioEstimado = sharedAverageVal ? sharedAverageVal * (1 - margenSeguridad / 100) : null
  const currentPrice = quote?.price || null
  const upside = precioEstimado && currentPrice
    ? ((precioEstimado - currentPrice) / currentPrice) * 100
    : null

  let veredicto = 'Sin datos'
  let color = 'text-gray-400'

  if (upside !== null) {
    if (upside > 20) {
      veredicto = 'Barata'
      color = 'text-green-400'
    } else if (upside > -5) {
      veredicto = 'Justa'
      color = 'text-yellow-400'
    } else {
      veredicto = 'Cara'
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
    <div className="space-y-8">
      <h2 className="text-3xl font-bold text-gray-100">Análisis Final - {ticker}</h2>

      {/* Mensaje si no hay averageVal */}
      {!sharedAverageVal && (
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-xl p-4 text-center">
          <p className="text-yellow-400">
            Ve a la pestaña <strong>Valuaciones</strong> para calcular el promedio de valuación. Los valores se actualizarán automáticamente aquí.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Margen de seguridad (%)</label>
          <input
            type="number"
            value={margenSeguridad}
            onChange={e => setMargenSeguridad(Number(e.target.value) || 15)}
            className="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-lg"
          />
        </div>

        <div>
          <label className="block text-lg font-medium text-gray-300 mb-2">Años históricos</label>
          <input
            type="number"
            min={1}
            max={5}
            value={años}
            onChange={e => setAños(Math.max(1, Math.min(5, Number(e.target.value) || 3)))}
            className="w-full p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-lg"
          />
        </div>
      </div>

      {/* Resumen de análisis */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-gray-700 p-5 rounded-xl border border-gray-600 text-center">
          <p className="text-sm text-gray-400 mb-1">Precio Actual</p>
          <p className="text-2xl font-bold text-blue-400">
            {currentPrice ? `$${currentPrice.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl border border-gray-600 text-center">
          <p className="text-sm text-gray-400 mb-1">Valuación Promedio</p>
          <p className="text-2xl font-bold text-purple-400">
            {sharedAverageVal ? `$${sharedAverageVal.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl border border-gray-600 text-center">
          <p className="text-sm text-gray-400 mb-1">Precio Compra Sugerido</p>
          <p className="text-2xl font-bold text-green-400">
            {precioEstimado ? `$${precioEstimado.toFixed(2)}` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl border border-gray-600 text-center">
          <p className="text-sm text-gray-400 mb-1">Upside/Downside</p>
          <p className={`text-2xl font-bold ${upside !== null && upside > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {upside !== null ? `${upside.toFixed(1)}%` : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-700 p-5 rounded-xl border border-gray-600 text-center">
          <p className="text-sm text-gray-400 mb-1">Veredicto</p>
          <p className={`text-2xl font-bold ${color}`}>
            {veredicto}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando gráfico...</div>
      ) : historical.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No hay datos históricos disponibles</div>
      ) : (
        <div className="p-6 bg-gray-700 rounded-xl border border-gray-600">
          <h4 className="text-xl font-semibold text-gray-200 mb-4">
            Precio histórico ({años} {años === 1 ? 'año' : 'años'})
          </h4>
          <div className="h-96">
            <Line
              data={chartData}
              options={{
                maintainAspectRatio: false,
                responsive: true,
                scales: {
                  y: {
                    ticks: { color: '#e5e7eb' },
                    grid: { color: '#4b5563' },
                  },
                  x: {
                    ticks: { color: '#e5e7eb', maxTicksLimit: 12 },
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

      <p className="text-sm text-gray-500 text-center italic">
        Los valores se actualizan automáticamente cuando cambias los métodos de valuación en la pestaña Valuaciones.
      </p>
    </div>
  )
}
