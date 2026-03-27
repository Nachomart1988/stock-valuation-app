'use client';

import { useState, useEffect, useCallback } from 'react';

interface MCPStatus {
  connected: boolean;
  fmp_mcp_url: string;
  total_tools: number;
  custom_prismo_tools: number;
}

interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, string>;
}

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export default function MCPIntegrationTab() {
  const [status, setStatus] = useState<MCPStatus | null>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [guide, setGuide] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMCPData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/mcp/status`);
      if (!res.ok) throw new Error('MCP engine not available');
      const data = await res.json();
      setStatus(data.status);
      setTools(data.tools || []);
      setGuide(data.guide || {});
    } catch (err: any) {
      setError(err.message || 'Error connecting to MCP engine');
      // Fallback: show static data
      setTools([
        { name: "quote", description: "Obtener precio actual, cambio y datos básicos de una acción", input_schema: { symbol: "str" } },
        { name: "historical_price", description: "Datos OHLCV históricos de una acción", input_schema: { symbol: "str", days: "int" } },
        { name: "earnings_surprises", description: "Últimos earnings y sorpresas EPS", input_schema: { symbol: "str" } },
        { name: "balance_sheet", description: "Balance general más reciente", input_schema: { symbol: "str" } },
        { name: "detect_htf", description: "Detectar High-Tight Flag (setup Quillamaggie)", input_schema: { symbol: "str" } },
        { name: "detect_ep", description: "Detectar Episodic Pivot (gap explosivo + catalyst)", input_schema: { symbol: "str" } },
        { name: "market_sentiment", description: "Análisis completo de sentimiento de mercado (8 layers)", input_schema: { symbol: "str" } },
        { name: "quantum_risk", description: "VaR/CVaR cuántico + alt data fusion", input_schema: { symbol: "str" } },
        { name: "supply_chain", description: "Análisis de cadena de suministro (suppliers + customers)", input_schema: { symbol: "str" } },
      ]);
      setStatus({
        connected: false,
        fmp_mcp_url: "https://financialmodelingprep.com/mcp?apikey=YOUR_API_KEY",
        total_tools: 9,
        custom_prismo_tools: 5,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMCPData();
  }, [fetchMCPData]);

  const mcpUrl = status?.fmp_mcp_url || 'https://financialmodelingprep.com/mcp?apikey=YOUR_API_KEY';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-2xl flex items-center justify-center text-white font-bold text-xs">MCP</div>
        <h2 className="text-2xl font-bold text-white">Model Context Protocol (MCP)</h2>
        <span className="px-3 py-1 text-xs bg-cyan-500/10 text-cyan-400 rounded-full font-mono">USB-C para IA</span>
      </div>

      <p className="text-gray-400 max-w-2xl">
        MCP es el estándar abierto de Anthropic que convierte cualquier fuente de datos en una herramienta universal para IA.
        Conecta tu clave FMP y cualquier agente (Claude, Cursor, Python, etc.) accede directamente a precios, earnings, HTF, EP, sentiment y más — sin código pegajoso.
      </p>

      {error && (
        <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-sm">
          Backend no disponible — mostrando configuración estática. {error}
        </div>
      )}

      {/* URL Personalizada */}
      <div className="bg-gray-900/70 border border-cyan-500/30 rounded-2xl p-6">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-semibold text-cyan-400">TU URL MCP PERSONALIZADA</div>
          <button
            onClick={copyToClipboard}
            className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-sm rounded-xl transition flex items-center gap-2"
          >
            {copied ? 'Copiado!' : 'Copiar URL'}
          </button>
        </div>
        <div className="font-mono text-sm break-all bg-black/50 p-4 rounded-xl border border-cyan-500/20 text-cyan-300">
          {mcpUrl}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Estado</p>
          <p className={`text-lg font-bold ${status?.connected ? 'text-emerald-400' : 'text-amber-400'}`}>
            {status?.connected ? 'Conectado' : 'Pendiente'}
          </p>
        </div>
        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Tools Totales</p>
          <p className="text-lg font-bold text-white">{status?.total_tools || tools.length}</p>
        </div>
        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Tools Prismo</p>
          <p className="text-lg font-bold text-violet-400">{status?.custom_prismo_tools || 5}</p>
        </div>
        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-5 text-center">
          <p className="text-xs text-gray-400 mb-1">Protocolo</p>
          <p className="text-lg font-bold text-cyan-400">MCP v1</p>
        </div>
      </div>

      {/* Guías Paso a Paso */}
      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-cyan-400">Claude Desktop / Web</span>
          </h3>
          <ol className="text-sm text-gray-300 space-y-3 list-decimal pl-5">
            <li>Settings → Connectors → Add custom connector</li>
            <li>Pega la URL de arriba</li>
            <li>Pregunta: &quot;Analiza el HTF de TSLA&quot;</li>
          </ol>
        </div>

        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-amber-400">Cursor / Cloudflare Workers AI</span>
          </h3>
          <ol className="text-sm text-gray-300 space-y-3 list-decimal pl-5">
            <li>Ve a MCP Servers</li>
            <li>Pega la URL</li>
            <li>El agente ya tiene acceso a quote, HTF, EP, etc.</li>
          </ol>
        </div>

        <div className="bg-gray-900/70 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <span className="text-violet-400">Python (FastMCP)</span>
          </h3>
          <pre className="bg-black/80 text-[10px] p-4 rounded-xl overflow-auto text-violet-300">
{`client = Client("${mcpUrl}")
await client.call_tool("detect_htf", {"symbol": "AAPL"})`}
          </pre>
        </div>
      </div>

      {/* Tools Disponibles */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Tools Disponibles ({tools.length})</h3>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => (
            <div key={tool.name} className="bg-gray-900/70 border border-white/10 rounded-2xl p-5 hover:border-cyan-500/30 transition">
              <div className="font-mono text-cyan-400 text-sm mb-1">{tool.name}</div>
              <p className="text-sm text-gray-400">{tool.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Use Cases Financieros */}
      <div className="bg-gradient-to-br from-gray-900 to-black border border-cyan-500/20 rounded-3xl p-8">
        <h3 className="text-xl font-semibold mb-6 text-white">Casos de Uso Financieros</h3>
        <div className="grid md:grid-cols-3 gap-6 text-sm">
          <div className="space-y-2">
            <div className="text-cyan-400">Junior Analyst Bot</div>
            <p className="text-gray-400">&quot;Compara el P/E de AAPL vs MSFT en 5 años&quot; → respuesta instantánea con datos reales</p>
          </div>
          <div className="space-y-2">
            <div className="text-cyan-400">Due Diligence Automática</div>
            <p className="text-gray-400">Agente que se activa con caídas &gt;5% y envía reporte con HTF/EP + risk cuántico</p>
          </div>
          <div className="space-y-2">
            <div className="text-cyan-400">Investigación en IDE</div>
            <p className="text-gray-400">Dentro de Cursor: &quot;¿Hay un HTF en NVDA?&quot; → respuesta directa sin copiar API docs</p>
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-gray-600 text-center">
        El MCP Server de FMP cuenta contra tus límites de API normales. No se requiere cuenta adicional.
      </p>
    </div>
  );
}
