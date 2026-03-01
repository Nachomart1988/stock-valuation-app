'use client';

import { useState } from 'react';
import Header from '../components/Header';

const sections = [
  {
    id: 'dcf',
    title: 'DCF — Discounted Cash Flow',
    color: 'text-violet-400',
    border: 'border-violet-700/40',
    content: `
## DCF Multi-Stage

El modelo de Flujo de Caja Descontado proyecta los FCF futuros y los descuenta al presente usando el WACC.

### Fórmula Principal
**Valor Intrínseco = Σ [ FCF_t / (1+WACC)^t ] + Valor Terminal / (1+WACC)^N**

Donde:
- **FCF_t** = Free Cash Flow en el año t = EBIT × (1-Tax) + D&A - CapEx - ΔWorkingCapital
- **WACC** = Weighted Average Cost of Capital
- **Valor Terminal** = FCF_N × (1+g) / (WACC - g) [Gordon Growth]
- **g** = tasa de crecimiento perpetua (default: 2.5%)
- **N** = número de años de proyección (default: 10)

### Etapas
- **2-Stage**: Crecimiento alto por N años, luego perpetuidad
- **3-Stage**: Crecimiento alto → transición → perpetuidad

### Fuentes de Datos
- **FCF histórico**: FMP /income-statement + /cash-flow-statement
- **WACC**: Calculado en tab WACC (CAPM + costo deuda)
- **Crecimiento**: Promedio FCF histórico + ajuste analista
`,
  },
  {
    id: 'ddm',
    title: 'DDM — Dividend Discount Model',
    color: 'text-blue-400',
    border: 'border-blue-700/40',
    content: `
## DDM 2-Stage

**P = Σ [D_t / (1+r)^t] + P_N / (1+r)^N**

- **D_t** = Dividendo esperado en año t
- **r** = Tasa de descuento (costo del equity = r_f + β × ERP)
- **P_N** = D_N+1 / (r - g_L) [precio terminal]
- **g_H** = tasa de crecimiento alto (stage 1)
- **g_L** = tasa de crecimiento largo plazo (stage 2)

## DDM 3-Stage

Añade una fase de transición lineal entre g_H y g_L.

## H-Model

**P = D_0 × [(1+g_L) + H × (g_H - g_L)] / (r - g_L)**

Donde H = duración del período de alto crecimiento / 2.
Asume decaimiento lineal del crecimiento.

### Fuentes de Datos
- **Dividendos**: FMP /historical-price-full/stock_dividend
- **Beta**: FMP /profile (o calculado con regresión 60M)
- **ERP**: 5.5% (default, editable)
- **Risk-Free Rate**: 10Y Treasury yield
`,
  },
  {
    id: 'graham',
    title: 'Graham',
    color: 'text-amber-400',
    border: 'border-amber-700/40',
    content: `
## Graham Number

**Graham Number = √(22.5 × EPS × BVPS)**

- **EPS** = Earnings Per Share (últimos 12 meses)
- **BVPS** = Book Value Per Share
- El 22.5 = 15 (P/E máximo Graham) × 1.5 (P/B máximo Graham)

## Graham Method (Fórmula Revisada)

**V = EPS × (8.5 + 2g) × 4.4 / Y**

- **8.5** = P/E base para empresa sin crecimiento
- **g** = tasa de crecimiento esperada a 7-10 años (%)
- **4.4** = tasa corporativa AAA en los años 60
- **Y** = tasa actual de bonos corporativos AAA

## Graham Net-Net

**NCAV = Activo Corriente − Pasivo Total**
**NCAV per Share = NCAV / Shares Outstanding**

Si precio < NCAV/share × 0.67 → candidato Graham Net-Net

### Fuentes de Datos
- EPS, BVPS: FMP /income-statement, /balance-sheet
- AAA Bond Rate: FMP o US Federal Reserve (default ~5%)
`,
  },
  {
    id: 'wacc',
    title: 'WACC',
    color: 'text-emerald-400',
    border: 'border-emerald-700/40',
    content: `
## WACC — Weighted Average Cost of Capital

**WACC = (E/V) × Ke + (D/V) × Kd × (1 - Tax)**

### Costo del Equity (CAPM)
**Ke = Rf + β × ERP**

- **Rf** = Risk-Free Rate (10Y Treasury, ~4.2%)
- **β** = Beta (regresión 60M o FMP /profile)
- **ERP** = Equity Risk Premium (default 5.5%)

### Costo de la Deuda
**Kd = Interest Expense / Total Debt**

### Pesos
- **E** = Market Cap
- **D** = Total Debt (balance sheet)
- **V** = E + D

### Ajuste por Tamaño (Small Cap)
Se puede añadir una prima por tamaño (default 0%) para empresas < $2B market cap.

### Fuentes de Datos
- Beta, Market Cap: FMP /profile
- Interest Expense, Total Debt: FMP /balance-sheet, /income-statement
- Rf: FMP /economic-indicator/10y-treasury
`,
  },
  {
    id: 'cagr',
    title: 'CAGR',
    color: 'text-teal-400',
    border: 'border-teal-700/40',
    content: `
## CAGR — Compound Annual Growth Rate

**CAGR = (EV / BV)^(1/n) − 1**

- **EV** = Ending Value
- **BV** = Beginning Value
- **n** = número de años

### Aplicaciones en Prismo
- **Revenue CAGR**: crecimiento de ingresos 1/3/5 años
- **EPS CAGR**: crecimiento de ganancias por acción
- **FCF CAGR**: crecimiento de flujo de caja libre
- **Price CAGR**: retorno histórico del precio

### Escenarios de Proyección
El tab CAGR proyecta el precio en rangos de −10% a +10% CAGR durante 1/3/5/10 años usando:
**Precio Proyectado = P₀ × (1 + CAGR)^n**

### Fuentes de Datos
- Datos históricos: FMP /income-statement (5 períodos)
- Precio actual: FMP /quote
`,
  },
  {
    id: 'sgr',
    title: 'SGR — Sustainable Growth Rate',
    color: 'text-rose-400',
    border: 'border-rose-700/40',
    content: `
## SGR — Sustainable Growth Rate

**SGR = ROE × Retention Rate**
**SGR = ROE × (1 − Payout Ratio)**

### Variables
- **ROE** = Net Income / Shareholders' Equity
- **Payout Ratio** = Dividends / Net Income
- **Retention Rate** = 1 − Payout Ratio

### Interpretación
El SGR es la máxima tasa a la que una empresa puede crecer sin aumentar su apalancamiento financiero (asumiendo financiamiento solo con retención de ganancias).

### Modelo Higgins Extendido
Considera también el apalancamiento:
**SGR = [ROE × b] / [1 − ROE × b]**

donde b = Retention Rate.

### Fuentes de Datos
- ROE: FMP /financial-ratios o calculado desde /income-statement + /balance-sheet
- Dividendos: FMP /dividends
`,
  },
  {
    id: 'prismo',
    title: 'Prismo Score (Momentum)',
    color: 'text-orange-400',
    border: 'border-orange-700/40',
    content: `
## Prismo Momentum Score

Inspirado en el concepto de líderes en compresión (post-run squeeze).

### Componentes del Score (Total: 100 puntos)

| Componente | Peso |
|------------|------|
| Leader Score | 30% |
| Compression Score | 35% |
| Breakout Proximity | 25% |
| Fundamentals | 10% |

### Leader Score
Mide el rendimiento relativo vs SPY (benchmark):
- **r3m excess**: retorno 3 meses − retorno SPY 3 meses
- **r6m excess**: retorno 6 meses − retorno SPY 6 meses
- **r12m excess**: retorno 12 meses − retorno SPY 12 meses

Score máximo si exceso > +10% en los 3 períodos.

### Compression Score
Detecta la "base apretada" post-corrida:
- **big_run_pct**: corrida alcista ≥ 30% desde mínimos
- **bullish_run_valid**: la corrida fue alcista (min_idx < max_idx) Y precio actual ≥ 70% del pico
- **compression_ratio**: amplitud promedio últimas 4 semanas vs 12 semanas (< 0.7 = compresión)
- **volume_dry**: volumen seco (volumen actual < 80% del promedio 12 semanas)
- **diagonal_ceiling**: techo diagonal (resistencia bajista)

### Disqualificadores (Score = 0)
- r12m < −10%: stock en tendencia bajista fuerte
- bullish_run_valid = False: la "corrida" fue en realidad una caída (crash)

### Fuentes de Datos
- Precios históricos diarios: yfinance (1 año)
- Datos intraday: yfinance (1m/5m/15m)
- Float, EPS: FMP /api/v4/shares_float + yfinance fallback
`,
  },
  {
    id: 'monte-carlo',
    title: 'Monte Carlo DCF',
    color: 'text-pink-400',
    border: 'border-pink-700/40',
    content: `
## Monte Carlo DCF

Ejecuta 5000 simulaciones del DCF con distribuciones de probabilidad para los inputs clave.

### Variables Estocásticas
- **Tasa de crecimiento FCF**: Normal(μ=g_histórico, σ=desv estándar histórica)
- **WACC**: Normal(μ=WACC_base, σ=0.5%)
- **Tasa terminal**: Uniforme(1.5%, 3.5%)

### Algoritmo
Para cada simulación i:
1. Muestrear g_i, WACC_i, g_terminal_i
2. Calcular DCF con esos inputs
3. Registrar Valor Intrínseco_i

### Outputs
- **Distribución de precios objetivo**: histograma de las 5000 valuaciones
- **Percentiles**: P10, P25, P50 (mediana), P75, P90
- **Probabilidad de upside**: % simulaciones donde VI > Precio Actual

### Interpretación
El P50 es la estimación central. P10−P90 representa el "rango de incertidumbre razonable" dado el historial de la empresa.
`,
  },
];

function DocSection({ section }: { section: typeof sections[0] }) {
  const [open, setOpen] = useState(false);

  const renderContent = (text: string) => {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('## ')) return <h3 key={i} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('## ', '')}</h3>;
      if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-bold text-gray-300 mt-3 mb-1">{line.replace('### ', '')}</h4>;
      if (line.startsWith('**') && line.endsWith('**')) {
        return <p key={i} className="text-sm text-gray-200 font-semibold my-1">{line.replace(/\*\*/g, '')}</p>;
      }
      if (line.startsWith('- **')) {
        const match = line.match(/^- \*\*(.+?)\*\*(.*)$/);
        if (match) return <p key={i} className="text-sm text-gray-400 ml-4 my-0.5">• <strong className="text-gray-200">{match[1]}</strong>{match[2]}</p>;
      }
      if (line.startsWith('- ')) return <p key={i} className="text-sm text-gray-400 ml-4 my-0.5">• {line.replace('- ', '')}</p>;
      if (line.startsWith('|')) return <p key={i} className="text-sm text-gray-400 font-data my-0.5">{line}</p>;
      if (line.trim() === '') return <div key={i} className="h-1" />;
      return <p key={i} className="text-sm text-gray-400 my-1">{line}</p>;
    });
  };

  return (
    <div className={`rounded-2xl border ${section.border} overflow-hidden`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-black/60/30 transition"
      >
        <div>
          <span className={`text-xs font-bold uppercase tracking-wider ${section.color} block mb-0.5`}>{section.id.toUpperCase()}</span>
          <span className="font-bold text-white">{section.title}</span>
        </div>
        <span className={`text-xl transition-transform ${open ? 'rotate-45' : ''} ${section.color}`}>+</span>
      </button>
      {open && (
        <div className="px-6 pb-6 bg-black/60/20 border-t border-green-900/20/30">
          <div className="pt-4">{renderContent(section.content)}</div>
        </div>
      )}
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">Documentación</h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Fórmulas, metodologías y fuentes de datos para todos los modelos de análisis de Prismo.
          </p>
        </div>

        {/* Data sources summary */}
        <div className="p-5 rounded-2xl bg-black/40 border border-green-900/15 mb-10">
          <h2 className="font-bold mb-3">Fuentes de Datos Principales</h2>
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            {[
              { name: 'Financial Modeling Prep (FMP)', scope: 'Estados financieros, precios, perfiles, dividendos, forecasts, ratios', color: 'text-emerald-400' },
              { name: 'Yahoo Finance (yfinance)', scope: 'Datos intraday (1m/5m/15m), histórico diario, opciones, Float fallback', color: 'text-blue-400' },
              { name: 'US Federal Reserve / FRED', scope: 'Tasas 10Y Treasury, ERP, tasas corporativas AAA (usados como defaults)', color: 'text-amber-400' },
            ].map((s) => (
              <div key={s.name}>
                <div className={`font-semibold ${s.color} mb-1`}>{s.name}</div>
                <div className="text-gray-400">{s.scope}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {sections.map((section) => (
            <DocSection key={section.id} section={section} />
          ))}
        </div>

        <div className="mt-10 p-5 rounded-2xl bg-black/60/40 border border-green-900/15 text-sm text-gray-400">
          <strong className="text-white">Disclaimer:</strong> Los modelos de valuación producen estimaciones, no certezas.
          Los resultados dependen de la calidad de los datos históricos y de los supuestos elegidos.
          Prismo es una herramienta educativa e informativa. No constituye asesoramiento de inversión.
        </div>
      </main>
    </div>
  );
}
