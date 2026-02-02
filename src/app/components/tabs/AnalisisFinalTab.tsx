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
  averageVal: number | null
}

export default function AnalisisFinalTab({ ticker, quote, averageVal }: Props) {
  const [margenError, setMargenError] = useState(15)
  const [años, setAños] = useState(3)
  const [historical, setHistorical] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const precioEstimado = averageVal ? averageVal * (1 - margenError / 100) : null
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
        if (!apiKey) return

        const res = await fetch(
          `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=${años * 365}&apikey=${apiKey}`
        )
        const json = await res.json()
        if (json.historical) {
          setHistorical(json.historical.reverse()) // más reciente a la derecha
        }
      } catch (err) {
        console.error(err)
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
        tension: 0.1,
      },
      {
        label: 'Precio target promedio',
        data: new Array(historical.length).fill(averageVal),
        borderColor: 'rgb(0, 255, 0)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
      {
        label: `Estimado conservador (${margenError}%)`,
        data: new Array(historical.length).fill(precioEstimado),
        borderColor: 'rgb(0, 100, 255)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
      {
        label: 'Precio actual',
        data: new Array(historical.length).fill(currentPrice),
        borderColor: 'rgb(255, 99, 132)',
        borderDash: [5, 5],
        pointRadius: 0,
      },
    ],
  }

  return (
    <div className="p-6 bg-gray-900 rounded-xl">
      <h2 className="text-2xl font-bold mb-6">Análisis Final - {ticker}</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div>
          <label className="block text-sm mb-1">Margen de seguridad (%)</label>
          <input
            type="number"
            value={margenError}
            onChange={e => setMargenError(Number(e.target.value) || 15)}
            className="w-full p-2 bg-gray-800 border border-gray-700 rounded"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Años históricos</label>
          <input
            type="number"
            min={1}
            max={5}
            value={años}
            onChange={e => setAños(Math.max(1, Math.min(5, Number(e.target.value) || 3)))}
            className="w-full p-2 bg-gray-800 border border-gray-700 rounded"
          />
        </div>

        <div className="flex flex-col justify-center">
          <div className={`text-3xl font-bold ${color}`}>
            {veredicto}
          </div>
          {upside !== null && (
            <div className="text-sm mt-1">
              Upside/Downside: {upside.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">Cargando gráfico...</div>
      ) : historical.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No hay datos históricos disponibles</div>
      ) : (
        <div className="h-96">
          <Line data={chartData} options={{ maintainAspectRatio: false }} />
        </div>
      )}
    </div>
  )
}