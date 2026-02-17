# backend/main.py
# FastAPI server for AdvanceValue Net & CompanyQuality Net

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import numpy as np
import os

from model import predictor
from quality_model import quality_predictor
from neural_resumen_engine import neural_engine
from market_sentiment_engine import market_sentiment_engine

app = FastAPI(
    title="Stock Analysis AI API",
    description="Neural Ensemble for Stock Valuation & Company Quality Assessment",
    version="1.1.0"
)

# CORS - allow requests from Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.vercel\.app|http://localhost:\d+|http://127\.0\.0\.1:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictionRequest(BaseModel):
    """Request body for valuation prediction"""
    ticker: str
    current_price: float
    expert_valuations: list[Optional[float]]  # Values from DDM, DCF, etc.
    tabular_features: list[Optional[float]]   # ROE, margins, growth rates, etc.

    class Config:
        json_schema_extra = {
            "example": {
                "ticker": "AAPL",
                "current_price": 175.50,
                "expert_valuations": [180.5, 165.2, 190.0, 172.3, 185.0, None, 168.9],
                "tabular_features": [0.15, 0.25, 0.08, 1.2, 0.45, 0.12]
            }
        }


class PredictionResponse(BaseModel):
    """Response with valuation prediction"""
    ticker: str
    fair_value: float
    confidence_interval: list[float]  # [q10, q90]
    signal: str  # SUBVALUADO, SOBREVALUADO, EN LINEA
    upside_pct: float
    experts_used: int
    base_ensemble: float


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "AdvanceValue Net API",
        "version": "1.0.0"
    }


@app.get("/health")
async def health():
    """Health check for monitoring"""
    return {"status": "healthy"}


# ════════════════════════════════════════════════════════════════════
# CompanyQuality Net - Company Quality Assessment
# ════════════════════════════════════════════════════════════════════

class QualityRequest(BaseModel):
    """Request body for company quality assessment"""
    ticker: str
    features: List[Optional[float]]  # ~45 financial metrics
    industry: str = "Unknown"

    class Config:
        json_schema_extra = {
            "example": {
                "ticker": "AAPL",
                "features": [0.15, 0.08, 0.12, 0.25, 0.30, 0.22],
                "industry": "Consumer Electronics"
            }
        }


class QualityResponse(BaseModel):
    """Response with company quality assessment"""
    ticker: str
    overallScore: float        # 0-100
    profitability: float       # 0-100
    financialStrength: float   # 0-100
    efficiency: float          # 0-100
    growth: float              # 0-100
    moat: float                # 0-100
    riskLevel: str             # Low, Medium, High
    recommendation: str        # Excellent, Strong, Average, Weak, Poor


@app.post("/companyquality/predict", response_model=QualityResponse)
async def predict_quality(request: QualityRequest):
    """
    Generate company quality assessment using Neural Ensemble

    Analyzes 40+ financial metrics to produce:
    - Overall Quality Score (0-100)
    - 5 dimension scores (Profitability, Financial Strength, Efficiency, Growth, Moat)
    - Risk Level (Low/Medium/High)
    - Quality Recommendation (Excellent to Poor)
    """
    try:
        # Clean features (replace None with 0)
        features = [v if v is not None else 0 for v in request.features]

        # Get prediction
        result = quality_predictor.predict(features=features)

        return QualityResponse(
            ticker=request.ticker,
            **result
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/advancevalue/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    """
    Generate fair value prediction using Neural Ensemble

    Takes expert valuations (from DDM, DCF, Graham, etc.) and tabular
    financial metrics, then produces a weighted ensemble prediction
    with confidence intervals.
    """
    try:
        # Validate inputs
        if request.current_price <= 0:
            raise HTTPException(status_code=400, detail="current_price must be positive")

        # Clean expert valuations (replace None with 0 for filtering)
        expert_vals = [v if v is not None else 0 for v in request.expert_valuations]

        # Clean tabular features
        tabular = [v if v is not None else 0 for v in request.tabular_features]

        # Get prediction
        result = predictor.predict(
            expert_valuations=expert_vals,
            tabular_features=tabular,
            current_price=request.current_price
        )

        if result is None:
            raise HTTPException(
                status_code=400,
                detail="Not enough valid expert valuations (need at least 3)"
            )

        return PredictionResponse(
            ticker=request.ticker,
            **result
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Resumen Maestro - Comprehensive Analysis Summary
# ════════════════════════════════════════════════════════════════════

class ResumenRequest(BaseModel):
    """Request body for master summary generation"""
    ticker: str
    currentPrice: Optional[float] = None
    advanceValueNet: Optional[Dict[str, Any]] = None
    companyQualityNet: Optional[Dict[str, Any]] = None
    keyMetricsSummary: Optional[Dict[str, Any]] = None
    sustainableGrowthRate: Optional[float] = None
    wacc: Optional[float] = None
    dcfValuation: Optional[float] = None
    monteCarlo: Optional[Dict[str, Any]] = None
    pivotAnalysis: Optional[Dict[str, Any]] = None
    holdersData: Optional[Dict[str, Any]] = None
    forecasts: Optional[List[Dict[str, Any]]] = None  # List of analyst forecasts
    diarioStats: Optional[Dict[str, Any]] = None
    news: Optional[List[Dict[str, Any]]] = None  # News articles for sentiment analysis


@app.post("/resumen/predict")
async def resumen_predict(req: ResumenRequest):
    """
    Generate comprehensive master summary using Neural Reasoning Engine v2.1.

    14-Layer Neural Architecture:
    1. Data Ingestion & Validation
    2. News Sentiment Analysis (NLP with financial lexicons)
    3. Institutional Flow Analysis (smart money tracking)
    3A. Sector & Industry Context (macro positioning)
    4. Technical Analysis (pivots, support/resistance)
    4A. Spectral Cycle Analysis (FFT market cycles)
    5. Valuation Ensemble (multi-model integration)
    6. Quality Analysis (5-dimension scoring)
    7. Growth & Value Creation Analysis
    8. Analyst Forecast Analysis
    9. Monte Carlo Simulation (5000 paths)
    10. Cross-Signal Correlation (pattern detection)
    11. Dynamic Weight Synthesis
    12. Final Recommendation Generation

    Returns full chain-of-thought reasoning with actionable investment advice.
    """
    try:
        print(f"[NeuralEngine] Starting 14-layer analysis for {req.ticker}")

        # Convert request to dictionary for the engine
        data = {
            'ticker': req.ticker,
            'currentPrice': req.currentPrice,
            'advanceValueNet': req.advanceValueNet,
            'companyQualityNet': req.companyQualityNet,
            'keyMetricsSummary': req.keyMetricsSummary,
            'sustainableGrowthRate': req.sustainableGrowthRate,
            'wacc': req.wacc,
            'dcfValuation': req.dcfValuation,
            'monteCarlo': req.monteCarlo,
            'pivotAnalysis': req.pivotAnalysis,
            'holdersData': req.holdersData,
            'forecasts': req.forecasts,
            'diarioStats': req.diarioStats,
            'news': req.news,
            'fmp_api_key': os.environ.get('FMP_API_KEY'),
        }

        # Run the 14-layer neural reasoning engine
        result = neural_engine.analyze(data)

        print(f"[NeuralEngine] Analysis complete: {result['finalRecommendation']} ({result['conviction']}%)")
        print(f"[NeuralEngine] Processed {len(result.get('chainOfThought', []))} neural layers")
        print(f"[NeuralEngine] Signals: {result.get('signalSummary', {})}")

        return result

    except Exception as e:
        print(f"[NeuralEngine] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Market Sentiment - Market-wide Sentiment Analysis
# ════════════════════════════════════════════════════════════════════

class MarketSentimentRequest(BaseModel):
    """Request body for market sentiment analysis v4.0"""
    news: Optional[List[Dict[str, Any]]] = None
    gainers: Optional[List[Dict[str, Any]]] = None
    losers: Optional[List[Dict[str, Any]]] = None
    sectorPerformance: Optional[List[Dict[str, Any]]] = None
    industryPerformance: Optional[List[Dict[str, Any]]] = None
    indexQuotes: Optional[List[Dict[str, Any]]] = None
    forexQuotes: Optional[List[Dict[str, Any]]] = None
    historicalSectorPerformance: Optional[List[Dict[str, Any]]] = None


@app.post("/market-sentiment/analyze")
async def analyze_market_sentiment(req: MarketSentimentRequest):
    """
    Analyze overall market sentiment using:
    - Latest market news (NLP sentiment analysis)
    - Top gainers analysis (momentum, sectors)
    - Top losers analysis (weakness, sectors)

    Returns:
    - Composite sentiment score (0-100)
    - Overall market sentiment (very_bullish to very_bearish)
    - Recommendation (RISK ON/OFF, etc.)
    - Detailed analysis breakdown
    - Market briefing narrative
    """
    try:
        print(f"[MarketSentiment] Analyzing market sentiment...")
        print(f"[MarketSentiment] News items: {len(req.news or [])}")
        print(f"[MarketSentiment] Gainers: {len(req.gainers or [])}")
        print(f"[MarketSentiment] Losers: {len(req.losers or [])}")

        data = {
            'news': req.news or [],
            'gainers': req.gainers or [],
            'losers': req.losers or [],
            'sectorPerformance': req.sectorPerformance or [],
            'industryPerformance': req.industryPerformance or [],
            'indexQuotes': req.indexQuotes or [],
            'forexQuotes': req.forexQuotes or [],
            'historicalSectorPerformance': req.historicalSectorPerformance or [],
        }

        result = market_sentiment_engine.analyze(data)

        print(f"[MarketSentiment] Result: {result['overallSentiment']} (score: {result['compositeScore']})")

        return result

    except Exception as e:
        print(f"[MarketSentiment] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    import os

    # Use PORT from environment (Railway) or default to 8000 for local
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
