# backend/mcp_integration_engine.py
# MCP Integration Engine — Exposes FMP + Nuestros Engines como tools MCP

from __future__ import annotations
import logging
import os
from typing import Dict, List, Any

logger = logging.getLogger(__name__)

class MCPIntegrationEngine:
    """
    Motor MCP para Prismo.
    Genera URL personalizada de FMP y expone nuestros engines (HTF, EP, Sentiment, etc.) como tools MCP.
    """

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')

    def get_fmp_mcp_url(self) -> str:
        if not self.api_key:
            return "https://financialmodelingprep.com/mcp?apikey=YOUR_API_KEY"
        return f"https://financialmodelingprep.com/mcp?apikey={self.api_key}"

    def get_available_tools(self) -> List[Dict[str, Any]]:
        tools = [
            # FMP Oficiales
            {
                "name": "quote",
                "description": "Obtener precio actual, cambio y datos básicos de una acción",
                "input_schema": {"symbol": "str (e.g. AAPL)"},
            },
            {
                "name": "historical_price",
                "description": "Datos OHLCV históricos de una acción",
                "input_schema": {"symbol": "str", "days": "int (opcional)"},
            },
            {
                "name": "earnings_surprises",
                "description": "Últimos earnings y sorpresas EPS",
                "input_schema": {"symbol": "str"},
            },
            {
                "name": "balance_sheet",
                "description": "Balance general más reciente",
                "input_schema": {"symbol": "str"},
            },
            # Tools Custom de Prismo
            {
                "name": "detect_htf",
                "description": "Detectar High-Tight Flag (setup Quillamaggie)",
                "input_schema": {"symbol": "str"},
            },
            {
                "name": "detect_ep",
                "description": "Detectar Episodic Pivot (gap explosivo + catalyst)",
                "input_schema": {"symbol": "str"},
            },
            {
                "name": "market_sentiment",
                "description": "Análisis completo de sentimiento de mercado (8 layers)",
                "input_schema": {"symbol": "str"},
            },
            {
                "name": "quantum_risk",
                "description": "VaR/CVaR cuántico + alt data fusion",
                "input_schema": {"symbol": "str"},
            },
            {
                "name": "supply_chain",
                "description": "Análisis de cadena de suministro (suppliers + customers)",
                "input_schema": {"symbol": "str"},
            },
        ]
        return tools

    def get_connection_guide(self) -> Dict[str, str]:
        return {
            "claude": "1. Abre Settings → Connectors\n2. Add custom connector\n3. Pega la URL de arriba\n4. Empieza a preguntar: 'Analiza el HTF de TSLA'",
            "cursor": "Pega la URL en Cursor MCP settings → el agente tendrá acceso directo a quote, HTF, EP, etc.",
            "python": "from fastmcp import Client\nclient = Client(mcp_url)\nprint(await client.call_tool('detect_htf', {'symbol': 'AAPL'}))",
            "cloudflare": "Pega la URL en Workers AI Playground → MCP Servers",
        }

    def get_status(self) -> Dict[str, Any]:
        return {
            "connected": bool(self.api_key),
            "fmp_mcp_url": self.get_fmp_mcp_url(),
            "total_tools": len(self.get_available_tools()),
            "custom_prismo_tools": 5,
        }


# Singleton
_engine: MCPIntegrationEngine | None = None

def get_mcp_engine(api_key: str = None) -> MCPIntegrationEngine:
    global _engine
    if _engine is None:
        _engine = MCPIntegrationEngine(api_key)
    return _engine
