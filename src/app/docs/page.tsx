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
    id: 'quantum-portfolio',
    title: 'Quantum Portfolio Optimizer (Beta)',
    color: 'text-cyan-400',
    border: 'border-cyan-700/40',
    content: `
## Quantum Portfolio Optimizer — QAOA

Optimiza la selección y pesos de un portfolio usando el algoritmo QAOA (Quantum Approximate Optimization Algorithm), simulado clásicamente via PennyLane.

### ¿Qué problema resuelve?

La selección óptima de activos es un problema NP-difícil: dado un conjunto de n activos, hay 2^n combinaciones posibles. Los computadores cuánticos (y sus simuladores) pueden explorar ese espacio exponencial más eficientemente que los métodos clásicos greedy.

### Formulación QUBO

El problema se codifica como QUBO (Quadratic Unconstrained Binary Optimization):

**min x^T Q x**

- **x_i ∈ {0, 1}**: incluir o excluir el activo i
- **Q_ii = −return_i + penalty × (1 − 2k)**: diagonal (retorno esperado)
- **Q_ij = λ × Cov(i,j) + penalty**: off-diagonal (riesgo de covarianza)
- **k** = número objetivo de activos a seleccionar (~n/2)
- **penalty** = coeficiente que fuerza la restricción presupuestal

### Circuito QAOA

Un circuito QAOA de p capas alterna dos unitarios:

1. **Unitario de costo**: exp(−i γ H_C) — aplica la función objetivo como Hamiltoniano
2. **Unitario mixer**: ∏ RX(2β, qubit_i) — mezcla los estados para explorar el espacio

Los parámetros γ = (γ₁,...,γ_p) y β = (β₁,...,β_p) se optimizan clásicamente con COBYLA (200 iteraciones) minimizando el valor esperado ⟨ψ|H_C|ψ⟩.

### Comparación con Markowitz Clásico

| Aspecto | QAOA (Cuántico) | Markowitz (Clásico) |
|---------|-----------------|---------------------|
| Variables | Binarias (0/1) | Continuas (0 a 1) |
| Método | Circuito cuántico + COBYLA | SLSQP (scipy) |
| Restricción | Penalización QUBO | Restricción explícita Σw=1 |
| Escala | ≤10 qubits / 10 activos | Sin límite |

### Métricas de Salida
- **Sharpe ratio**: (Retorno − Rf) / Volatilidad, donde Rf = 4.2%
- **Retorno anualizado**: retorno logarítmico medio × 252
- **Riesgo anualizado**: desviación estándar × √252
- **Ventaja cuántica**: diferencia de Sharpe entre ambos métodos

### Fuentes de Datos
- Precios históricos ajustados: FMP /stable/historical-price-eod/full
- Período: 3 años (756 días de trading)
- Límite: 2-10 activos (>10 qubits = complejidad prohibitiva)

### Modo Fallback
Si PennyLane no está disponible, usa fuerza bruta clásica: itera los 2^n estados y encuentra el mínimo de x^T Q x directamente.
`,
  },
  {
    id: 'drl-trading',
    title: 'DRL Trading Simulator — PPO / A2C (Beta)',
    color: 'text-violet-400',
    border: 'border-violet-700/40',
    content: `
## Deep Reinforcement Learning Trading Simulator

Entrena un agente de RL (PPO o A2C) sobre datos históricos reales y lo evalúa en un conjunto de test, comparando vs Buy & Hold.

### Arquitectura del Ambiente (Gymnasium)

El ambiente implementa la interfaz OpenAI Gymnasium con:

- **Estado (observación)**: vector de 23 features
- **Acciones**: Discrete(3) → 0=Hold, 1=Buy, 2=Sell
- **Recompensa**: cambio porcentual en valor del portfolio en cada step
- **Comisión**: 0.1% por operación (lado compra y venta)

### Las 23 Features del Estado

| # | Feature | Descripción |
|---|---------|-------------|
| 0 | Close normalizado | Z-score vs ventana 50d |
| 1 | Volumen normalizado | Z-score vs ventana 20d |
| 2 | Retorno 1d | log(P_t / P_{t-1}) |
| 3 | Retorno 5d | log(P_t / P_{t-5}) |
| 4 | Retorno 20d | log(P_t / P_{t-20}) |
| 5 | RSI(14) | Normalizado a [-1, 1] |
| 6 | MACD signal | (EMA12 − EMA26 − Signal) / σ |
| 7 | Bollinger position | (P − SMA20) / (2 × σ20) |
| 8-11 | SMA ratios | P/SMA5, P/SMA10, P/SMA20, P/SMA50 − 1 |
| 12 | Volatilidad 20d | σ_log_returns × √252 |
| 13 | Trend de volumen | Vol_t / mean(Vol_{t-10}) − 1 |
| 14-16 | Momentum | ROC 5d, 10d, 20d |
| 17 | Rango H-L | (max − min) / mean (ventana 5d) |
| 18 | Gap overnight | (P_t − P_{t-1}) / P_{t-1} |
| 19 | Retorno acumulado | P_t / P_0 − 1 |
| 20 | Posición actual | 1 si comprado, 0 si efectivo |
| 21 | Ratio de efectivo | Cash / Capital inicial |
| 22 | Ratio de portfolio | Valor total / Capital inicial |

### Algoritmos Disponibles

**PPO (Proximal Policy Optimization)**
- Policy gradient con clipping del ratio de política para estabilidad
- n_steps=256, batch_size=64, lr=3e-4
- Más estable y ampliamente usado

**A2C (Advantage Actor-Critic)**
- Actualiza en cada step (on-policy, sin buffer de replay)
- Generalmente más rápido para converger pero más variable

### Split Train / Test
- **Entrenamiento**: 70% de los datos históricos (≈532 días de 3 años)
- **Evaluación**: 30% restante (≈224 días)
- El agente nunca ve datos del test durante el entrenamiento

### Métricas de Evaluación
- **Retorno total**: (Valor Final / Capital Inicial) − 1
- **Alpha**: Retorno Agente − Retorno Buy & Hold
- **Sharpe**: (retorno medio / desv estándar) × √252 (sobre PnL diario del test)
- **Max Drawdown**: máx caída desde pico (peak-to-trough)
- **Win Rate**: % de round-trips (compra+venta) con ganancia

### Fuentes de Datos
- Precios históricos + volumen: FMP /stable/historical-price-eod/full
- Período: 3 años (756 días de trading)
- Mínimo requerido: 100 días de datos

### Modo Fallback
Sin stable-baselines3, usa un agente de momentum RSI:
- Compra cuando RSI < −0.3 y momentum 20d > 0
- Vende cuando RSI > 0.3 y tiene posición
`,
  },
  {
    id: 'quantum-risk',
    title: 'Quantum Risk Model + Alt Data (Beta)',
    color: 'text-rose-400',
    border: 'border-rose-700/40',
    content: `
## Quantum Risk Model + Alt Data Fusion

Combina 5 señales de datos alternativos con modelado de riesgo cuántico para calcular VaR y CVaR con mayor precisión que métodos paramétricos clásicos.

### Parte 1: Alt Data Fusion (5 Señales)

Cada señal se normaliza a [-1, 1] y se combina con pesos fijos:

| Señal | Peso | Fuente | Descripción |
|-------|------|--------|-------------|
| Sentimiento de mercado | 25% | Momentum precio | Proxy: retorno 20d × 5 |
| Anomalía de volumen | 20% | FMP histórico | Z-score del volumen reciente vs 30d |
| Flujo de opciones | 20% | FMP put-call-ratio | Ratio Put/Call — alto = bajista |
| Actividad insider | 15% | FMP insider-trading | Balance compras vs ventas últimas 20 trans. |
| Revisiones analistas | 20% | FMP analyst-estimates | Cambio % en EPS estimado (período actual vs anterior) |

**Score compuesto** = Σ (señal_i × peso_i), clippeado a [-1, 1]

- Muy Favorable: score > 0.50
- Favorable: 0.15 < score ≤ 0.50
- Neutral: −0.15 ≤ score ≤ 0.15
- Desfavorable: −0.50 ≤ score < −0.15
- Muy Desfavorable: score < −0.50

### Parte 2: VaR y CVaR (Value at Risk / Conditional VaR)

Se calculan tres versiones de VaR para el nivel de confianza elegido (90%, 95%, 99%):

**VaR Histórico**
- Percentil α de los retornos históricos observados
- Ejemplo al 95%: el 5% peor de los días históricos

**VaR Paramétrico (Normal)**
- VaR = μ + z_α × σ
- CVaR = μ − σ × φ(z_α) / α
- z_α = cuantil normal estándar, φ = densidad normal

**VaR t-Student**
- Ajusta por colas pesadas (fat tails) — más realista para retornos financieros
- Fit de df, loc, scale con scipy.stats.t.fit()

### Parte 3: Quantum VaR (Qiskit)

Con Qiskit disponible, usa Quantum Amplitude Estimation:

1. Discretiza la distribución de retornos en 2^4 = 16 bins (4 qubits)
2. Codifica las probabilidades como amplitudes en un circuito cuántico con QuantumCircuit.initialize()
3. Encuentra el bin cuyo cumulative probability cruza el umbral α → ese bin center es el Quantum VaR
4. CVaR cuántico = media ponderada de todos los bins en la cola inferior

### Ajuste por Alt Data

El VaR cuántico se ajusta según el score de alt data:

**VaR_ajustado = VaR_cuántico × (1 + score_altdata × 0.15)**

- Score positivo (señales favorables) → reduce el VaR (menor riesgo percibido)
- Score negativo (señales adversas) → aumenta el VaR (mayor riesgo percibido)

### Estadísticas de Salida
- **Retorno anualizado**: media(log_returns) × 252
- **Volatilidad anualizada**: std(log_returns) × √252
- **Comparación quantum vs clásico**: diferencia entre métodos

### Fuentes de Datos
- Precios históricos: FMP /stable/historical-price-eod/full
- Ratio put/call: FMP /stable/put-call-ratio
- Insider trading: FMP /stable/insider-trading
- Estimaciones analistas: FMP /stable/analyst-estimates
- Período: 2 años (504 días de trading)

### Modo Fallback
Sin Qiskit, usa Monte Carlo (10,000 simulaciones) con distribución t ajustada a los retornos reales.
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
