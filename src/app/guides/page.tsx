'use client';

import { useState } from 'react';
import Link from 'next/link';
import Header from '../components/Header';

const guides = [
  {
    id: 'start',
    icon: '🚀',
    title: 'Cómo Empezar',
    time: '3 min',
    steps: [
      { title: 'Ingresa un ticker', body: 'En la página principal, escribe el símbolo de la acción (ej: AAPL, MSFT, TSLA) y haz clic en "Analizar". No necesitas una cuenta para el análisis básico.' },
      { title: 'Explora los tabs', body: 'Verás tabs organizados por categoría: General, Métricas, Valuaciones, Técnico, etc. Navega entre ellos para ver distintas perspectivas del mismo activo.' },
      { title: 'Edita los inputs', body: 'Casi todos los campos son editables. Cambia la tasa de crecimiento, el WACC, o el horizonte de tiempo para ver cómo cambia la valuación en tiempo real.' },
      { title: 'Lee el resumen', body: 'En el tab "Análisis Final" → "Resumen Maestro" encontrarás la conclusión consolidada del análisis (requiere plan Elite o Gold).' },
    ],
  },
  {
    id: 'valuations',
    icon: '💰',
    title: 'Tab: Valuaciones',
    time: '5 min',
    steps: [
      { title: 'Modelos disponibles', body: 'El tab Valuaciones incluye: DDM (2-Stage, 3-Stage, H-Model), FCF/FCFF/FCFE (2 y 3 etapas), DCF Multi-Etapa, Graham, RIM Ohlson, Monte Carlo DCF, y más.' },
      { title: 'Promedio de consenso', body: 'En la parte superior verás el "Precio Promedio Consenso" — el promedio de todos los modelos activos. Es el número clave de toda la valuación.' },
      { title: 'Editar un modelo', body: 'Haz clic en cualquier tarjeta de modelo para expandir sus inputs: tasa de crecimiento, WACC, años de proyección, etc. Los cambios actualizan el cálculo instantáneamente.' },
      { title: 'Interpretar resultados', body: 'Compara el precio objetivo de cada modelo con el precio actual. Si la mayoría de modelos están por encima del precio actual, la acción puede estar subvaluada.' },
    ],
  },
  {
    id: 'wacc',
    icon: '📐',
    title: 'Tab: WACC',
    time: '4 min',
    steps: [
      { title: 'Qué es el WACC', body: 'El WACC es la tasa de descuento usada en los modelos DCF. Representa el costo promedio ponderado del capital (deuda + equity) de la empresa.' },
      { title: 'Inputs clave', body: 'Tasa libre de riesgo (10Y Treasury), Beta (regresión 60M), ERP (5.5% default), Costo de deuda (intereses/deuda total), Tax rate, y los pesos deuda/equity.' },
      { title: 'Ajustar por tamaño', body: 'Para small caps (< $2B market cap), considera agregar una prima de tamaño (1-3%) al WACC calculado para reflejar el riesgo adicional.' },
      { title: 'Impacto en valuación', body: 'Un WACC más bajo → valuación más alta (descuenta menos). Compara el WACC calculado con el sector para validar si es razonable.' },
    ],
  },
  {
    id: 'cagr',
    icon: '📈',
    title: 'Tab: CAGR',
    time: '3 min',
    steps: [
      { title: 'CAGR histórico', body: 'Muestra el crecimiento anual compuesto de Revenue, EPS, y FCF en períodos 1/3/5 años. Un buen negocio suele mostrar CAGR positivo en las 3 métricas.' },
      { title: 'Proyección de precios', body: 'Ingresa un rango de CAGR esperado (ej: −10% a +10%) y el número de años. La tabla muestra el precio proyectado en cada escenario.' },
      { title: 'Escenarios', body: 'Usa −10% a +10% para análisis moderado. Para empresas de alto crecimiento, puede tener sentido proyectar 15-25% CAGR en el escenario optimista.' },
    ],
  },
  {
    id: 'pivots',
    icon: '📊',
    title: 'Tab: Pivots (Intraday)',
    time: '4 min',
    steps: [
      { title: 'Niveles de soporte/resistencia', body: 'El tab Pivots calcula automáticamente los niveles clave del día: Pivot Central, R1/R2/R3 (resistencias), S1/S2/S3 (soportes), y niveles Fibonacci.' },
      { title: 'Cambiar período histórico', body: 'Usa los controles de período para ver pivots semanales o mensuales en lugar de diarios. Usa las flechas para avanzar/retroceder períodos.' },
      { title: 'Interpretar niveles', body: 'Si el precio está entre el Pivot y R1, el sesgo es alcista para el día. Si está entre S1 y el Pivot, el sesgo es bajista. Los niveles son zonas de reacción probables.' },
      { title: 'Fibonacci', body: 'Los niveles Fibonacci (23.6%, 38.2%, 50%, 61.8%, 78.6%) se calculan sobre el rango alto-bajo del período seleccionado.' },
    ],
  },
  {
    id: 'momentum',
    icon: '⚡',
    title: 'Tab: Momentum (Prismo Score)',
    time: '5 min',
    steps: [
      { title: 'Qué busca el Prismo Score', body: 'El Prismo Score busca acciones que son LÍDERES del mercado (top performance 3/6/12m vs SPY) que han tenido una corrida alcista significativa y ahora están en una compresión de volatilidad, acercándose a un breakout.' },
      { title: 'Leader Score', body: 'Muestra el rendimiento de la acción vs SPY en 3/6/12 meses. Verde = outperformance. Para ser candidato Prismo, la acción debe haber superado al benchmark.' },
      { title: 'Compression Score', body: 'Detecta si el precio está "apretado": amplitud entre máximos y mínimos reducida, volumen seco, y un techo diagonal formándose. Un score alto indica compresión real.' },
      { title: 'Stocks descalificados', body: 'Una acción con retorno 12 meses < −10% automáticamente obtiene Score 0. Prismo busca líderes, no acciones en caída libre.' },
    ],
  },
  {
    id: 'diario',
    icon: '📔',
    title: 'Diario del Inversor',
    time: '3 min',
    steps: [
      { title: 'Registrar una operación', body: 'Ingresa ticker, fecha, tipo (compra/venta), precio, cantidad y notas. El diario calcula automáticamente P&L en $ y %.' },
      { title: 'Portafolio virtual', body: 'El diario suma todas tus posiciones abiertas para mostrar tu portafolio actual con el valor de mercado en tiempo real.' },
      { title: 'Historial y métricas', body: 'Accede al historial completo de operaciones con filtros por fecha y ticker. Ve métricas agregadas: P&L total, operaciones ganadoras/perdedoras, promedio por trade.' },
      { title: 'Exportar', body: 'Exporta tu historial a CSV para análisis adicional en Excel o Google Sheets.' },
    ],
  },
  {
    id: 'pdf',
    icon: '📄',
    title: 'Exportar a PDF',
    time: '2 min',
    steps: [
      { title: 'Acceso (Elite/Gold)', body: 'El botón "Exportar PDF" aparece en la barra superior de la página de análisis para usuarios Elite y Gold.' },
      { title: 'Modal de configuración', body: 'Al hacer clic, se abre un modal donde puedes: seleccionar secciones (portada, valuación, forecasts, etc.), cambiar colores, fuente, y cargar tu logo.' },
      { title: 'Generar', body: 'Haz clic en "Generar PDF". El PDF se descarga directamente en tu navegador. Incluye todas las secciones seleccionadas con los datos del análisis actual.' },
    ],
  },
];

function GuideCard({ guide }: { guide: typeof guides[0] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-green-900/15 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-900/60/30 transition"
      >
        <span className="text-2xl">{guide.icon}</span>
        <div className="flex-1">
          <div className="font-bold text-white">{guide.title}</div>
          <div className="text-xs text-gray-500 mt-0.5">Lectura: {guide.time}</div>
        </div>
        <span className={`text-xl transition-transform text-emerald-400 ${open ? 'rotate-45' : ''}`}>+</span>
      </button>

      {open && (
        <div className="px-6 pb-6 bg-gray-900/60/20 border-t border-green-900/20/30">
          <div className="space-y-4 pt-4">
            {guide.steps.map((step, i) => (
              <div key={i} className="flex gap-4">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-900/50 border border-emerald-700/50 flex items-center justify-center text-xs font-bold text-emerald-400">
                  {i + 1}
                </div>
                <div>
                  <div className="font-semibold text-sm text-white mb-1">{step.title}</div>
                  <div className="text-sm text-gray-400 leading-relaxed">{step.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function GuidesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-gray-800 to-black text-white">
      <Header />

      <main className="pt-28 pb-20 px-4 max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">Guías de Uso</h1>
          <p className="text-gray-400 text-lg max-w-2xl">
            Aprende a sacar el máximo provecho de cada tab y herramienta de Prismo.
          </p>
        </div>

        <div className="space-y-3">
          {guides.map((guide) => (
            <GuideCard key={guide.id} guide={guide} />
          ))}
        </div>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Link
            href="/docs"
            className="flex-1 p-5 rounded-2xl bg-gray-900/40 border border-green-900/15 hover:border-emerald-500/40 transition text-center"
          >
            <div className="text-2xl mb-2">📋</div>
            <div className="font-bold">Documentación Técnica</div>
            <div className="text-sm text-gray-400">Fórmulas y fuentes de datos</div>
          </Link>
          <Link
            href="/faq"
            className="flex-1 p-5 rounded-2xl bg-gray-900/40 border border-green-900/15 hover:border-emerald-500/40 transition text-center"
          >
            <div className="text-2xl mb-2">❓</div>
            <div className="font-bold">Preguntas Frecuentes</div>
            <div className="text-sm text-gray-400">Respuestas rápidas</div>
          </Link>
          <Link
            href="/support"
            className="flex-1 p-5 rounded-2xl bg-gray-900/40 border border-green-900/15 hover:border-emerald-500/40 transition text-center"
          >
            <div className="text-2xl mb-2">💬</div>
            <div className="font-bold">Soporte</div>
            <div className="text-sm text-gray-400">Contacta al equipo</div>
          </Link>
        </div>
      </main>
    </div>
  );
}
