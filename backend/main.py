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
from probability_engine import probability_engine
from gap_analysis_engine import analyze_gaps
from portfolio_optimizer import optimize_portfolio, PortfolioOptimizer
from ml_prediction_engine import predict_price, MLPredictionEngine, TORCH_AVAILABLE
from options_strategy_simulator import (
    options_simulator, fetch_options_chain, analyze_options_strategy,
    auto_analyze_options_strategy, suggest_options_strategies, get_iv_surface,
    scan_options_combinations,
)

app = FastAPI(
    title="Stock Analysis AI API",
    description="Neural Ensemble for Stock Valuation & Company Quality Assessment",
    version="1.1.0"
)

# CORS - allow requests from Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.vercel\.app|https://(www\.)?prismo\.us|http://localhost:\d+|http://127\.0\.0\.1:\d+",
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
    averageValuation: Optional[float] = None  # Average of all frontend valuation methods
    profile: Optional[Dict[str, Any]] = None      # FMP company profile (sector, mktCap, …)
    ratiosTTM: Optional[Dict[str, Any]] = None    # FMP ratios-ttm (PE, dividend yield, P/B, …)


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
            'averageValuation': req.averageValuation,
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
# Probability - Binomial Tree Price Probability Calculator
# ════════════════════════════════════════════════════════════════════

class ProbabilityRequest(BaseModel):
    """Request body for binomial tree probability calculation"""
    ticker: str
    currentPrice: float
    targetPrice: float
    riskFreeRate: float = 0.042       # Annual rate as decimal
    dividendYield: float = 0.0        # Annual DY as decimal
    days: int = 252                    # Calendar days
    steps: Optional[int] = None        # Tree steps (default = min(days, 252))
    useImpliedVol: bool = True         # Try Yahoo Finance for IV


@app.post("/probability/calculate")
async def probability_calculate(req: ProbabilityRequest):
    """
    Calculate the probability of a stock reaching a target price
    using the CRR Binomial Tree model.

    Uses historical volatility from FMP and optionally implied volatility
    from Yahoo Finance options chain.
    """
    try:
        print(f"[Probability] Calculating for {req.ticker}: "
              f"target=${req.targetPrice}, days={req.days}")

        result = probability_engine.calculate(
            ticker=req.ticker,
            current_price=req.currentPrice,
            target_price=req.targetPrice,
            risk_free_rate=req.riskFreeRate,
            dividend_yield=req.dividendYield,
            days=req.days,
            steps=req.steps,
            use_implied_vol=req.useImpliedVol,
            fmp_api_key=os.environ.get('FMP_API_KEY'),
        )

        if result.get('error'):
            raise HTTPException(status_code=500, detail=result['error'])

        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Probability] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Market Sentiment - Market-wide Sentiment Analysis
# ════════════════════════════════════════════════════════════════════

class MarketSentimentRequest(BaseModel):
    """Request body for market sentiment analysis v5.0"""
    news: Optional[List[Dict[str, Any]]] = None
    gainers: Optional[List[Dict[str, Any]]] = None
    losers: Optional[List[Dict[str, Any]]] = None
    sectorPerformance: Optional[List[Dict[str, Any]]] = None
    industryPerformance: Optional[List[Dict[str, Any]]] = None
    indexQuotes: Optional[List[Dict[str, Any]]] = None
    forexQuotes: Optional[List[Dict[str, Any]]] = None
    historicalSectorPerformance: Optional[List[Dict[str, Any]]] = None
    vixQuote: Optional[Dict[str, Any]] = None
    indexBreadth: Optional[Dict[str, Any]] = None
    language: Optional[str] = 'en'


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
            'vixQuote': req.vixQuote,
            'indexBreadth': req.indexBreadth,
        }

        result = market_sentiment_engine.analyze(data, language=req.language or 'en')

        print(f"[MarketSentiment] Result: {result['overallSentiment']} (score: {result['compositeScore']})")

        return result

    except Exception as e:
        print(f"[MarketSentiment] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# FFT Cycle Signal — Dedicated endpoint (fast, no full resumen analysis)
# ════════════════════════════════════════════════════════════════════

class FFTSignalRequest(BaseModel):
    """Request body for FFT rolling-window cycle signal"""
    ticker: str
    window: int = 256          # rolling window in bars (power of 2 preferred)
    numFreq: int = 8           # low-pass: keep first K frequencies
    outputBars: int = 60       # how many bars to return in rollingCurve
    thresholdPct: float = 0.002  # anti-whipsaw threshold (0.2%)


# ════════════════════════════════════════════════════════════════════
# Prismo Momentum Analysis
# ════════════════════════════════════════════════════════════════════

class MomentumRequest(BaseModel):
    ticker: str
    benchmark: str = 'SPY'
    timeframes: Optional[List[str]] = None


@app.post("/momentum/analyze")
async def momentum_analyze(req: MomentumRequest):
    """Prismo momentum analysis: leader score + post-run compression + breakout detection."""
    try:
        from momentum_engine import get_momentum_analyzer
        analyzer = get_momentum_analyzer()
        result = analyzer.analyze(
            ticker=req.ticker,
            benchmark=req.benchmark,
            timeframes=req.timeframes,
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Gap Analysis
# ════════════════════════════════════════════════════════════════════

class GapAnalysisRequest(BaseModel):
    ticker: str
    days: int = 600
    gapThresholdPct: float = 2.0
    direction: str = 'both'   # 'up', 'down', 'both'


@app.post("/gaps/analyze")
async def gaps_analyze(req: GapAnalysisRequest):
    """Analyze historical price gaps and compute behavioral statistics."""
    try:
        api_key = os.environ.get('FMP_API_KEY', '')
        result = analyze_gaps(
            ticker=req.ticker,
            days=req.days,
            gap_threshold_pct=req.gapThresholdPct,
            direction=req.direction,
            fmp_api_key=api_key,
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/fft-signal")
async def fft_signal(req: FFTSignalRequest):
    """
    Compute FFT rolling-window low-pass filter signal for a stock.

    For each bar in the last `outputBars` period:
      1. Takes `window` bars of closing prices
      2. Detrends (linear), applies Hann window
      3. rfft → complex vector
      4. Low-pass: keeps first `numFreq` complex coefficients
      5. irfft → reconstructed smooth curve
      6. Signal: price > fft_curve*(1+threshold) → long, else flat

    Returns rollingCurve + complexComponents for the most recent window.
    """
    try:
        from spectral_cycle_analyzer import SpectralCycleAnalyzer, HistoricalDataFetcher

        fmp_api_key = os.environ.get('FMP_API_KEY')
        if not fmp_api_key:
            raise HTTPException(status_code=400, detail="FMP_API_KEY not configured on server")

        fetcher = HistoricalDataFetcher(fmp_api_key)
        historical = fetcher.fetch(req.ticker, max_bars=req.window + req.outputBars + 50)

        if not historical or len(historical) < req.window + 5:
            bars = len(historical) if historical else 0
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient data for {req.ticker}: got {bars} bars, need {req.window + 5}"
            )

        analyzer = SpectralCycleAnalyzer()
        result = analyzer.compute_rolling_reconstruction(
            historical_data=historical,
            window=req.window,
            num_freq=req.numFreq,
            output_bars=req.outputBars,
            threshold_pct=req.thresholdPct,
        )

        if result.get('error'):
            raise HTTPException(status_code=500, detail=result['error'])

        return {
            "ticker":        req.ticker,
            "window":        req.window,
            "numFreq":       req.numFreq,
            **result
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Portfolio Optimizer — Markowitz + Monte Carlo + Risk Analytics
# ════════════════════════════════════════════════════════════════════

class PortfolioOptimizeRequest(BaseModel):
    """Request body for portfolio optimization"""
    tickers: List[str]
    objective: str = 'max_sharpe'        # max_sharpe | min_variance | max_return | risk_parity
    maxWeight: float = 0.40
    minWeight: float = 0.0
    periodDays: int = 756                 # ~3 years
    targetReturn: Optional[float] = None
    monteCarloSims: int = 5000
    riskFreeRate: float = 0.042


class FactorRegressionRequest(BaseModel):
    tickers: List[str]
    benchmark: str = 'SPY'
    period_days: int = 756
    risk_free_rate: float = 0.042


class PCARequest(BaseModel):
    tickers: List[str]
    period_days: int = 756
    n_components: int = 5


class MatchExposuresRequest(BaseModel):
    tickers: List[str]
    target_beta: float = 1.0
    benchmark: str = 'SPY'
    period_days: int = 756
    max_weight: float = 0.40
    risk_free_rate: float = 0.042


class BlackLittermanRequest(BaseModel):
    tickers: List[str]
    views: List[dict]
    view_confidence: float = 0.5
    period_days: int = 756
    risk_aversion: float = 2.5
    risk_free_rate: float = 0.042


class RollingOptimizationRequest(BaseModel):
    tickers: List[str]
    objective: str = 'max_sharpe'
    window_days: int = 252
    step_days: int = 21
    period_days: int = 756
    max_weight: float = 0.40
    risk_free_rate: float = 0.042


@app.post("/portfolio/optimize")
async def portfolio_optimize(req: PortfolioOptimizeRequest):
    """
    Optimize a multi-asset portfolio using Markowitz mean-variance framework.

    Objectives:
    - max_sharpe: Maximize risk-adjusted returns (Sharpe ratio)
    - min_variance: Minimize portfolio volatility
    - max_return: Maximize expected return
    - risk_parity: Equal risk contribution from each asset

    Returns optimal weights, efficient frontier, Monte Carlo cloud,
    risk metrics (VaR, CVaR, Sortino, Calmar), correlation matrix, and backtest.
    """
    try:
        print(f"[PortfolioOpt] Optimizing {req.tickers} — objective={req.objective}")

        engine = PortfolioOptimizer(
            api_key=os.environ.get('FMP_API_KEY'),
            risk_free_rate=req.riskFreeRate,
        )

        result = engine.optimize(
            tickers=req.tickers,
            objective=req.objective,
            period_days=req.periodDays,
            max_weight=req.maxWeight,
            min_weight=req.minWeight,
            target_return=req.targetReturn,
            monte_carlo_sims=req.monteCarloSims,
        )

        # ── Transform result to match frontend interface ──────────────
        # 1. correlationMatrix: raw 2D array → {tickers, matrix}
        valid_tickers = result.get('tickers', req.tickers)
        raw_corr = result.get('correlationMatrix', [])
        result['correlationMatrix'] = {
            'tickers': valid_tickers,
            'matrix': raw_corr if isinstance(raw_corr, list) else [],
        }

        # 2. riskMetrics: add var95/cvar aliases expected by frontend
        rm = result.get('riskMetrics', {})
        rm['var95'] = rm.get('var95Annual', rm.get('var95Daily', 0.0))
        rm['var99'] = rm.get('var99Annual', rm.get('var99Daily', 0.0))
        rm['cvar'] = rm.get('cvar95Annual', rm.get('cvar95Daily', 0.0))

        # 3. individualStats: inject weight from optimalWeights
        opt_w = result.get('optimalWeights', {})
        for stat in result.get('individualStats', []):
            stat['weight'] = opt_w.get(stat['ticker'], 0.0)

        print(f"[PortfolioOpt] Done — Sharpe={result['portfolioSharpe']}, "
              f"Return={result['portfolioReturn']:.2%}, Vol={result['portfolioVolatility']:.2%}")

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"[PortfolioOpt] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/factor-regression")
async def portfolio_factor_regression(req: FactorRegressionRequest):
    """
    Run OLS factor regression for each ticker vs a benchmark (default SPY).
    Returns alpha, beta, R², residual vol, information ratio, and risk decomposition.
    """
    try:
        import traceback

        engine = PortfolioOptimizer(
            api_key=os.environ.get('FMP_API_KEY'),
            risk_free_rate=req.risk_free_rate,
        )

        all_tickers = list(dict.fromkeys(req.tickers + [req.benchmark]))
        prices = engine._fetch_prices(all_tickers, req.period_days)

        if req.benchmark not in prices:
            raise HTTPException(status_code=400, detail=f"Could not fetch benchmark data for {req.benchmark}")

        valid_tickers = [t for t in req.tickers if t in prices]
        if not valid_tickers:
            raise HTTPException(status_code=400, detail="Could not fetch price data for any ticker")

        # Align all tickers + benchmark
        all_valid = [t for t in all_tickers if t in prices]
        aligned = engine._align_prices(prices, all_valid)
        log_returns = np.diff(np.log(aligned), axis=0)

        ticker_idx = {t: i for i, t in enumerate(all_valid)}
        bench_idx = ticker_idx[req.benchmark]
        r_bench = log_returns[:, bench_idx]

        var_bench = float(np.var(r_bench, ddof=1))
        mean_bench_annual = float(np.mean(r_bench) * 252)
        vol_bench_annual = float(np.std(r_bench, ddof=1) * np.sqrt(252))
        sharpe_bench = (mean_bench_annual - req.risk_free_rate) / vol_bench_annual if vol_bench_annual > 0 else 0.0

        regressions = []
        for ticker in valid_tickers:
            idx = ticker_idx[ticker]
            r_i = log_returns[:, idx]

            # OLS regression: r_i = alpha + beta * r_bench + epsilon
            cov_matrix = np.cov(r_i, r_bench, ddof=1)
            beta = cov_matrix[0, 1] / var_bench if var_bench > 1e-12 else 0.0
            alpha = float(np.mean(r_i)) - beta * float(np.mean(r_bench))
            alpha_annualized = alpha * 252

            # Residuals
            predicted = alpha + beta * r_bench
            residuals = r_i - predicted
            residual_vol_annual = float(np.std(residuals, ddof=1) * np.sqrt(252))

            # R-squared = correlation^2
            corr = float(np.corrcoef(r_i, r_bench)[0, 1])
            r_squared = corr ** 2

            # Information ratio
            information_ratio = alpha_annualized / residual_vol_annual if residual_vol_annual > 1e-12 else 0.0

            # Risk decomposition
            var_ticker = float(np.var(r_i, ddof=1))
            market_risk_pct = (beta ** 2 * var_bench) / var_ticker * 100 if var_ticker > 1e-12 else 0.0
            idio_risk_pct = max(0.0, 100.0 - market_risk_pct)

            total_vol_annual = float(np.std(r_i, ddof=1) * np.sqrt(252))

            regressions.append({
                "ticker": ticker,
                "alpha_annual": round(alpha_annualized, 6),
                "beta": round(beta, 4),
                "r_squared": round(r_squared, 4),
                "residual_vol_annual": round(residual_vol_annual, 6),
                "information_ratio": round(information_ratio, 4),
                "market_risk_pct": round(market_risk_pct, 2),
                "idio_risk_pct": round(idio_risk_pct, 2),
                "total_vol_annual": round(total_vol_annual, 6),
                "correlation_to_market": round(corr, 4),
            })

        return {
            "benchmark": req.benchmark,
            "period_days": req.period_days,
            "factor_stats": {
                "market_return_annual": round(mean_bench_annual, 6),
                "market_vol_annual": round(vol_bench_annual, 6),
                "market_sharpe": round(sharpe_bench, 4),
            },
            "regressions": regressions,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/pca")
async def portfolio_pca(req: PCARequest):
    """
    Perform PCA on the returns matrix. Returns top n_components principal components
    with variance explained, eigenvalues, and loadings per ticker.
    """
    try:
        engine = PortfolioOptimizer(api_key=os.environ.get('FMP_API_KEY'))
        prices = engine._fetch_prices(req.tickers, req.period_days)
        valid_tickers = [t for t in req.tickers if t in prices]
        if len(valid_tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers with price data")

        aligned = engine._align_prices(prices, valid_tickers)
        log_returns = np.diff(np.log(aligned), axis=0)  # (T-1, n)

        # Standardize
        means = np.mean(log_returns, axis=0)
        stds = np.std(log_returns, axis=0, ddof=1)
        stds = np.where(stds < 1e-12, 1.0, stds)
        standardized = (log_returns - means) / stds

        # Covariance matrix of standardized returns
        cov = np.cov(standardized, rowvar=False)

        # Eigendecomposition
        eigenvalues, eigenvectors = np.linalg.eigh(cov)

        # Sort by descending eigenvalue
        sort_idx = np.argsort(eigenvalues)[::-1]
        eigenvalues = eigenvalues[sort_idx]
        eigenvectors = eigenvectors[:, sort_idx]

        n_components = min(req.n_components, len(valid_tickers))
        total_variance = float(np.sum(eigenvalues))

        components = []
        cumulative_pct = 0.0
        for i in range(n_components):
            variance_pct = float(eigenvalues[i]) / total_variance * 100 if total_variance > 0 else 0.0
            cumulative_pct += variance_pct
            loadings = {valid_tickers[j]: round(float(eigenvectors[j, i]), 4) for j in range(len(valid_tickers))}
            components.append({
                "pc": i + 1,
                "variance_explained_pct": round(variance_pct, 4),
                "cumulative_variance_pct": round(cumulative_pct, 4),
                "eigenvalue": round(float(eigenvalues[i]), 6),
                "loadings": loadings,
            })

        return {
            "tickers": valid_tickers,
            "n_components": n_components,
            "components": components,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/match-exposures")
async def portfolio_match_exposures(req: MatchExposuresRequest):
    """
    Find portfolio weights that minimize deviation from a target beta while maximizing Sharpe.
    """
    try:
        from scipy.optimize import minimize as sp_minimize

        engine = PortfolioOptimizer(
            api_key=os.environ.get('FMP_API_KEY'),
            risk_free_rate=req.risk_free_rate,
        )

        all_tickers = list(dict.fromkeys(req.tickers + [req.benchmark]))
        prices = engine._fetch_prices(all_tickers, req.period_days)

        if req.benchmark not in prices:
            raise HTTPException(status_code=400, detail=f"Could not fetch benchmark data for {req.benchmark}")

        valid_tickers = [t for t in req.tickers if t in prices]
        if len(valid_tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers with price data")

        all_valid = [t for t in all_tickers if t in prices]
        aligned = engine._align_prices(prices, all_valid)
        log_returns = np.diff(np.log(aligned), axis=0)

        ticker_idx = {t: i for i, t in enumerate(all_valid)}
        bench_idx = ticker_idx[req.benchmark]
        r_bench = log_returns[:, bench_idx]
        var_bench = float(np.var(r_bench, ddof=1))

        # Compute individual betas
        n = len(valid_tickers)
        individual_betas = []
        for ticker in valid_tickers:
            idx = ticker_idx[ticker]
            r_i = log_returns[:, idx]
            cov_ib = np.cov(r_i, r_bench, ddof=1)[0, 1]
            beta_i = cov_ib / var_bench if var_bench > 1e-12 else 1.0
            individual_betas.append(float(beta_i))
        betas_arr = np.array(individual_betas)

        # Returns matrix for portfolio tickers only
        port_returns = log_returns[:, [ticker_idx[t] for t in valid_tickers]]
        mean_annual = np.mean(port_returns, axis=0) * 252
        cov_annual = np.cov(port_returns, rowvar=False) * 252

        def objective_fn(w):
            port_beta = float(np.dot(w, betas_arr))
            port_ret = float(np.dot(w, mean_annual))
            port_vol = float(np.sqrt(np.maximum(w @ cov_annual @ w, 1e-12)))
            sharpe = (port_ret - req.risk_free_rate) / port_vol
            return (port_beta - req.target_beta) ** 2 * 10 - sharpe

        w0 = np.ones(n) / n
        bounds = [(0.0, req.max_weight)] * n
        constraints = [{'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0}]

        res = sp_minimize(
            objective_fn, w0,
            method='SLSQP',
            bounds=bounds,
            constraints=constraints,
            options={'maxiter': 1000, 'ftol': 1e-10},
        )

        weights = np.maximum(res.x, 0.0)
        weights /= weights.sum()

        achieved_beta = float(np.dot(weights, betas_arr))
        port_ret = float(np.dot(weights, mean_annual))
        port_vol = float(np.sqrt(weights @ cov_annual @ weights))
        sharpe = (port_ret - req.risk_free_rate) / port_vol if port_vol > 1e-10 else 0.0

        return {
            "tickers": valid_tickers,
            "target_beta": req.target_beta,
            "achieved_beta": round(achieved_beta, 4),
            "weights": {valid_tickers[i]: round(float(weights[i]), 6) for i in range(n)},
            "individual_betas": {valid_tickers[i]: round(individual_betas[i], 4) for i in range(n)},
            "portfolio_metrics": {
                "annual_return": round(port_ret, 6),
                "annual_vol": round(port_vol, 6),
                "sharpe": round(sharpe, 4),
            },
            "converged": bool(res.success),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/black-litterman")
async def portfolio_black_litterman(req: BlackLittermanRequest):
    """
    Black-Litterman portfolio optimization. Combines market equilibrium returns
    with investor views to produce posterior expected returns and optimal weights.
    """
    try:
        import requests as req_lib

        engine = PortfolioOptimizer(
            api_key=os.environ.get('FMP_API_KEY'),
            risk_free_rate=req.risk_free_rate,
        )
        api_key = os.environ.get('FMP_API_KEY')

        prices = engine._fetch_prices(req.tickers, req.period_days)
        valid_tickers = [t for t in req.tickers if t in prices]
        if len(valid_tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers with price data")

        aligned = engine._align_prices(prices, valid_tickers)
        log_returns = np.diff(np.log(aligned), axis=0)
        n = len(valid_tickers)

        mean_annual = np.mean(log_returns, axis=0) * 252
        cov_annual = np.cov(log_returns, rowvar=False) * 252

        # Fetch market caps for prior weights
        market_caps = {}
        for ticker in valid_tickers:
            try:
                url = f"https://financialmodelingprep.com/stable/profile"
                params = {'symbol': ticker, 'apikey': api_key}
                resp = engine._session.get(url, params=params, timeout=10)
                data = resp.json()
                if isinstance(data, list) and data:
                    mc = data[0].get('mktCap') or data[0].get('marketCap', 0)
                    market_caps[ticker] = float(mc) if mc else 1e9
                elif isinstance(data, dict):
                    mc = data.get('mktCap') or data.get('marketCap', 0)
                    market_caps[ticker] = float(mc) if mc else 1e9
                else:
                    market_caps[ticker] = 1e9
            except Exception:
                market_caps[ticker] = 1e9

        total_mc = sum(market_caps[t] for t in valid_tickers)
        w_mkt = np.array([market_caps[t] / total_mc for t in valid_tickers])

        # Implied equilibrium returns: pi = delta * Sigma * w_mkt
        delta = req.risk_aversion
        pi = delta * cov_annual @ w_mkt

        # Filter views to valid tickers
        valid_views = [v for v in req.views if v.get('asset') in valid_tickers]

        tau = 1.0 / req.period_days

        if valid_views:
            k = len(valid_views)
            P = np.zeros((k, n))
            q = np.zeros(k)

            ticker_to_idx = {t: i for i, t in enumerate(valid_tickers)}
            for vi, view in enumerate(valid_views):
                asset_idx = ticker_to_idx[view['asset']]
                P[vi, asset_idx] = 1.0
                q[vi] = float(view.get('return_view', 0.0))

            # Omega: uncertainty matrix
            Omega = req.view_confidence * (P @ cov_annual @ P.T)
            # Add small diagonal to avoid singularity
            Omega += np.eye(k) * 1e-8

            # Posterior BL returns
            try:
                tau_sigma_inv = np.linalg.inv(tau * cov_annual)
                omega_inv = np.linalg.inv(Omega)

                M_inv = tau_sigma_inv + P.T @ omega_inv @ P
                M = np.linalg.inv(M_inv)
                mu_bl = M @ (tau_sigma_inv @ pi + P.T @ omega_inv @ q)
            except np.linalg.LinAlgError:
                # Fallback: use implied returns
                mu_bl = pi.copy()
        else:
            mu_bl = pi.copy()

        # BL optimal weights: w_bl = inv(delta * Sigma) @ mu_bl, normalize
        try:
            cov_inv = np.linalg.inv(delta * cov_annual)
            w_bl_raw = cov_inv @ mu_bl
            # Handle negative weights by clipping
            w_bl_raw = np.maximum(w_bl_raw, 0.0)
            w_sum = w_bl_raw.sum()
            w_bl = w_bl_raw / w_sum if w_sum > 1e-10 else w_mkt.copy()
        except np.linalg.LinAlgError:
            w_bl = w_mkt.copy()

        # Portfolio metrics
        def port_metrics(w, returns, cov, rfr):
            r = float(np.dot(w, returns))
            v = float(np.sqrt(np.maximum(w @ cov @ w, 1e-12)))
            s = (r - rfr) / v if v > 1e-10 else 0.0
            return round(r, 6), round(v, 6), round(s, 4)

        bl_ret, bl_vol, bl_sharpe = port_metrics(w_bl, mu_bl, cov_annual, req.risk_free_rate)
        mkt_ret, mkt_vol, mkt_sharpe = port_metrics(w_mkt, mean_annual, cov_annual, req.risk_free_rate)

        return {
            "tickers": valid_tickers,
            "bl_weights": {valid_tickers[i]: round(float(w_bl[i]), 6) for i in range(n)},
            "market_weights": {valid_tickers[i]: round(float(w_mkt[i]), 6) for i in range(n)},
            "bl_expected_returns": {valid_tickers[i]: round(float(mu_bl[i]), 6) for i in range(n)},
            "implied_returns": {valid_tickers[i]: round(float(pi[i]), 6) for i in range(n)},
            "market_caps": {valid_tickers[i]: round(market_caps[valid_tickers[i]] / 1e9, 3) for i in range(n)},
            "views_applied": len(valid_views),
            "bl_portfolio_metrics": {
                "annual_return": bl_ret,
                "annual_vol": bl_vol,
                "sharpe": bl_sharpe,
            },
            "market_portfolio_metrics": {
                "annual_return": mkt_ret,
                "annual_vol": mkt_vol,
                "sharpe": mkt_sharpe,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/portfolio/rolling")
async def portfolio_rolling(req: RollingOptimizationRequest):
    """
    Rolling window portfolio optimization. Slides a window over historical data,
    running the optimization at each step. Returns weight evolution over time.
    """
    try:
        from datetime import datetime, timedelta

        engine = PortfolioOptimizer(
            api_key=os.environ.get('FMP_API_KEY'),
            risk_free_rate=req.risk_free_rate,
        )

        prices = engine._fetch_prices(req.tickers, req.period_days)
        valid_tickers = [t for t in req.tickers if t in prices]
        if len(valid_tickers) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 tickers with price data")

        aligned = engine._align_prices(prices, valid_tickers)
        log_returns = np.diff(np.log(aligned), axis=0)

        # Build date index using aligned common dates
        all_valid = list(dict.fromkeys(valid_tickers))
        date_sets = [set(d for d, _ in prices[t]) for t in all_valid]
        common_dates = sorted(date_sets[0].intersection(*date_sets[1:]))
        # returns correspond to dates[1:]
        return_dates = common_dates[1:]

        T = log_returns.shape[0]
        n = len(valid_tickers)

        windows = []
        start = 0
        window_count = 0
        MAX_WINDOWS = 36

        while start + req.window_days <= T and window_count < MAX_WINDOWS:
            end = start + req.window_days
            window_returns = log_returns[start:end, :]

            mean_annual = np.mean(window_returns, axis=0) * 252
            cov_annual = np.cov(window_returns, rowvar=False) * 252

            try:
                opt_weights = engine._optimize_weights(
                    mean_annual, cov_annual, req.objective,
                    max_weight=req.max_weight,
                    min_weight=0.0,
                )
            except Exception:
                opt_weights = np.ones(n) / n

            port_ret = float(np.dot(opt_weights, mean_annual))
            port_vol = float(np.sqrt(np.maximum(opt_weights @ cov_annual @ opt_weights, 1e-12)))
            sharpe = (port_ret - req.risk_free_rate) / port_vol if port_vol > 1e-10 else 0.0

            # Use the last date of the window as the snapshot date
            date_idx = min(end - 1, len(return_dates) - 1)
            window_date = return_dates[date_idx] if date_idx >= 0 else f"window_{window_count}"

            windows.append({
                "date": window_date,
                "weights": {valid_tickers[i]: round(float(opt_weights[i]), 4) for i in range(n)},
                "sharpe": round(sharpe, 4),
                "annual_return": round(port_ret, 6),
                "annual_vol": round(port_vol, 6),
            })

            start += req.step_days
            window_count += 1

        return {
            "tickers": valid_tickers,
            "objective": req.objective,
            "window_days": req.window_days,
            "step_days": req.step_days,
            "windows": windows,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# ML Price Prediction — LSTM with Monte Carlo Dropout
# ════════════════════════════════════════════════════════════════════

class MLPredictRequest(BaseModel):
    """Request body for ML price prediction"""
    ticker: str
    horizons: Optional[List[int]] = None  # Trading days [5, 10, 20, 30]


@app.post("/ml/predict")
async def ml_predict(req: MLPredictRequest):
    """
    Generate ML-based stock price predictions using LSTM neural network.

    Features:
    - LSTM with configurable layers, hidden size, and dropout
    - 29 technical indicator features (RSI, MACD, SMA, EMA, Bollinger Bands, ATR, etc.)
    - Monte Carlo dropout for uncertainty estimation (confidence bands)
    - Walk-forward validation with MAE, RMSE, MAPE, directional accuracy
    - Permutation-based feature importance

    Returns predictions for each horizon with confidence bands,
    evaluation metrics, feature importance, and historical backtest.
    """
    if not TORCH_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="ML prediction unavailable: PyTorch not installed on server"
        )

    try:
        print(f"[MLPredict] Predicting for {req.ticker}, horizons={req.horizons or [5,10,20,30]}")

        result = predict_price(
            ticker=req.ticker,
            horizons=req.horizons,
            api_key=os.environ.get('FMP_API_KEY'),
        )

        if result.get('error'):
            print(f"[MLPredict] Error: {result['error']}")
            raise HTTPException(status_code=500, detail=result['error'])

        print(f"[MLPredict] Done for {req.ticker} in {result.get('elapsedSeconds', '?')}s "
              f"— {len(result.get('predictions', []))} horizons predicted")

        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[MLPredict] Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ════════════════════════════════════════════════════════════════════
# Options Strategy Simulator — Chain, Analyze, Suggest, IV Surface
# ════════════════════════════════════════════════════════════════════

class OptionsChainRequest(BaseModel):
    """Request body for fetching options chain"""
    ticker: str


class OptionsAnalyzeRequest(BaseModel):
    """Request body for analyzing an options strategy.

    Two modes:
    - Auto-build: provide strategyName + expiration → backend fetches chain for
      that ONE date and selects strikes automatically (faster, recommended)
    - Manual: provide pre-built legs list
    """
    ticker: str
    currentPrice: float
    riskFreeRate: float = 0.042
    dividendYield: float = 0.0
    # Auto-build mode (frontend sends these)
    strategyName: Optional[str] = None
    expiration: Optional[str] = None
    # Manual mode
    legs: Optional[List[Dict[str, Any]]] = None


class OptionsSuggestRequest(BaseModel):
    """Request body for strategy suggestions"""
    ticker: str
    outlook: str  # bullish, bearish, neutral, volatile
    lang: str = 'en'   # 'en' or 'es'
    budget: Optional[float] = None


class OptionsScanRequest(BaseModel):
    """Request body for scanning all viable strike combinations."""
    ticker: str
    strategyName: str
    expiration: str
    currentPrice: float
    topN: int = 8


class OptionsIVSurfaceRequest(BaseModel):
    """Request body for IV surface data"""
    ticker: str


class OptionsEvaluateRequest(BaseModel):
    """Request body for AI-style strategy evaluation"""
    ticker: str
    legs: List[Dict[str, Any]]
    currentPrice: float
    analysis: Dict[str, Any]
    lang: str = 'en'


@app.post("/options/chain")
async def options_chain(req: OptionsChainRequest):
    """
    Fetch full options chain from Yahoo Finance.

    Returns all available expirations with calls and puts data including
    strike, last price, bid, ask, volume, open interest, and implied volatility.
    """
    try:
        print(f"[Options] Fetching chain for {req.ticker}")
        result = fetch_options_chain(req.ticker)

        if result.get('error'):
            raise HTTPException(status_code=500, detail=result['error'])

        exp_count = len(result.get('expirations', []))
        print(f"[Options] Chain fetched: {exp_count} expirations for {req.ticker}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Options] Error fetching chain: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/options/analyze")
async def options_analyze(req: OptionsAnalyzeRequest):
    """
    Analyze a multi-leg options strategy.

    Two modes:
    - Auto-build (preferred): pass strategyName + expiration. The backend fetches
      only that one expiration from Yahoo Finance (~1-2s), auto-selects strikes
      appropriate for the strategy, and returns the full analysis.
    - Manual: pass a pre-built legs list.
    """
    try:
        if req.strategyName and req.expiration:
            print(f"[Options] Auto-analyze '{req.strategyName}' for {req.ticker} exp={req.expiration}")
            result = auto_analyze_options_strategy(
                ticker=req.ticker,
                strategy_name=req.strategyName,
                expiration=req.expiration,
                current_price=req.currentPrice,
                risk_free_rate=req.riskFreeRate,
                dividend_yield=req.dividendYield,
            )
        elif req.legs:
            print(f"[Options] Manual analyze for {req.ticker}: {len(req.legs)} legs")
            result = analyze_options_strategy(
                ticker=req.ticker,
                legs=req.legs,
                current_price=req.currentPrice,
                risk_free_rate=req.riskFreeRate,
                dividend_yield=req.dividendYield,
            )
        else:
            raise HTTPException(
                status_code=422,
                detail="Provide either (strategyName + expiration) or legs."
            )

        if result.get('error'):
            raise HTTPException(status_code=500, detail=result['error'])

        print(f"[Options] Analysis done — maxProfit={result.get('maxProfit')}, "
              f"maxLoss={result.get('maxLoss')}, PoP={result.get('probabilityOfProfit')}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Options] Error analyzing strategy: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/options/suggest")
async def options_suggest(req: OptionsSuggestRequest):
    """
    Suggest options strategies based on market outlook.

    Accepts outlook: 'bullish', 'bearish', 'neutral', 'volatile'.
    Returns 3-5 strategy suggestions with description, risk profile,
    ideal IV environment, and rationale.
    """
    try:
        print(f"[Options] Suggesting strategies for {req.ticker}, outlook={req.outlook}")

        result = suggest_options_strategies(
            ticker=req.ticker,
            outlook=req.outlook,
            lang=req.lang,
            budget=req.budget,
        )

        print(f"[Options] {len(result)} strategies suggested for {req.outlook} outlook")
        return {"ticker": req.ticker, "outlook": req.outlook, "strategies": result}

    except Exception as e:
        print(f"[Options] Error suggesting strategies: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/options/scan")
async def options_scan(req: OptionsScanRequest):
    """
    Scan ALL viable strike combinations for a strategy on a single expiration.

    Returns up to topN combinations ranked by a composite score that weights
    P(profit) 45%, risk/reward 40%, and cost efficiency 15%.
    The first result is the 'optimal' combination.
    Each combination includes pre-built legs ready to pass to /options/analyze.
    """
    try:
        print(f"[Options] Scanning '{req.strategyName}' for {req.ticker} exp={req.expiration}")
        result = scan_options_combinations(
            ticker=req.ticker,
            strategy_name=req.strategyName,
            expiration=req.expiration,
            current_price=req.currentPrice,
            top_n=req.topN,
        )
        if result.get('error'):
            raise HTTPException(status_code=500, detail=result['error'])
        print(f"[Options] Scan done: {result.get('total', 0)} combos evaluated, "
              f"returning {len(result.get('combinations', []))}")
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Options] Scan error: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/options/iv-surface")
async def options_iv_surface(req: OptionsIVSurfaceRequest):
    """
    Build IV surface data for 3D visualization.

    Returns a grid of implied volatilities indexed by strike price
    and expiration date, suitable for plotting as a 3D surface or heatmap.
    Includes both call IV and put IV matrices.
    """
    try:
        print(f"[Options] Building IV surface for {req.ticker}")
        result = get_iv_surface(req.ticker)

        if result.get('error'):
            raise HTTPException(status_code=500, detail=result['error'])

        strikes_count = len(result.get('strikes', []))
        exp_count = len(result.get('expirations', []))
        print(f"[Options] IV surface built: {strikes_count} strikes x {exp_count} expirations")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Options] Error building IV surface: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/options/evaluate")
async def options_evaluate(req: OptionsEvaluateRequest):
    """
    Rule-based AI evaluation of a custom options strategy.
    Analyzes greeks, risk/reward, and market conditions for the strategy.
    """
    try:
        import math
        legs = req.legs
        analysis = req.analysis
        es = req.lang == 'es'
        S = req.currentPrice

        greeks = analysis.get('greeks', {})
        delta = greeks.get('delta', 0)
        gamma = greeks.get('gamma', 0)
        theta = greeks.get('theta', 0)
        vega = greeks.get('vega', 0)

        max_profit = analysis.get('maxProfit')
        max_loss = analysis.get('maxLoss')
        breakevens = analysis.get('breakevens', [])
        pop = analysis.get('probabilityOfProfit', 0)
        cost_basis = analysis.get('costBasis', 0)

        # ── Classify strategy structure ──
        n_legs = len(legs)
        n_calls = sum(1 for l in legs if l.get('type') == 'call')
        n_puts  = sum(1 for l in legs if l.get('type') == 'put')
        n_stock = sum(1 for l in legs if l.get('type') == 'stock')
        long_legs  = sum(1 for l in legs if int(l.get('quantity', 1)) > 0)
        short_legs = sum(1 for l in legs if int(l.get('quantity', 1)) < 0)

        # ── Directional bias ──
        if delta > 0.5:    bias = 'es Bullish (delta alto)' if es else 'is Bullish (high delta)'
        elif delta > 0.2:  bias = 'es ligeramente Bullish' if es else 'is mildly Bullish'
        elif delta < -0.5: bias = 'es Bearish (delta bajo)' if es else 'is Bearish (low delta)'
        elif delta < -0.2: bias = 'es ligeramente Bearish' if es else 'is mildly Bearish'
        else:              bias = 'es neutral' if es else 'is neutral'

        # ── Theta analysis ──
        if theta < -0.05:
            theta_txt = ('Theta negativo: la estrategia pierde valor con el paso del tiempo. '
                         'Ideal si el movimiento ocurre rápido.' if es else
                         'Negative theta: the strategy loses value with time decay. '
                         'Works best if the move happens quickly.')
        elif theta > 0.05:
            theta_txt = ('Theta positivo: la estrategia se beneficia del paso del tiempo. '
                         'Funciona bien en mercados laterales.' if es else
                         'Positive theta: the strategy benefits from time decay. '
                         'Works well in sideways markets.')
        else:
            theta_txt = ('Theta cercano a cero: exposición al tiempo mínima.' if es else
                         'Theta near zero: minimal time decay exposure.')

        # ── Vega analysis ──
        if vega > 0.05:
            vega_txt = ('Vega positivo: gana con aumento de volatilidad implícita (long vega).' if es else
                        'Positive vega: profits from rising implied volatility (long vega).')
        elif vega < -0.05:
            vega_txt = ('Vega negativo: gana con caída de volatilidad implícita (short vega).' if es else
                        'Negative vega: profits from falling implied volatility (short vega).')
        else:
            vega_txt = ('Vega neutro: poca exposición a cambios de volatilidad.' if es else
                        'Neutral vega: low exposure to volatility changes.')

        # ── Risk/reward score ──
        score = 50  # base
        if isinstance(max_profit, (int, float)) and isinstance(max_loss, (int, float)):
            if max_loss != 0:
                rr = abs(max_profit) / (abs(max_loss) + 1e-9)
                if rr >= 3:    score += 25
                elif rr >= 2:  score += 15
                elif rr >= 1:  score += 5
                else:          score -= 10
        if pop > 0.65: score += 15
        elif pop > 0.50: score += 8
        elif pop < 0.35: score -= 10
        if cost_basis < 0: score += 5   # credit strategy bonus
        score = max(10, min(95, score))

        if score >= 75: rating = 'Excelente' if es else 'Excellent'
        elif score >= 60: rating = 'Buena' if es else 'Good'
        elif score >= 45: rating = 'Moderada' if es else 'Moderate'
        elif score >= 30: rating = 'Riesgosa' if es else 'Risky'
        else: rating = 'Desfavorable' if es else 'Unfavorable'

        # ── Market conditions ──
        conditions = []
        if delta > 0.3:
            conditions.append('mercado alcista o ruptura al alza' if es else 'bullish market or upside breakout')
        elif delta < -0.3:
            conditions.append('mercado bajista o ruptura a la baja' if es else 'bearish market or downside break')
        if theta > 0:
            conditions.append('mercado lateral sin grandes movimientos' if es else 'sideways market with low movement')
        if vega > 0:
            conditions.append('expansión de volatilidad (evento, earnings)' if es else 'volatility expansion (events, earnings)')
        elif vega < 0:
            conditions.append('contracción de volatilidad post-evento' if es else 'volatility contraction post-event')
        if not conditions:
            conditions.append('cualquier entorno de mercado moderado' if es else 'any moderate market environment')

        # ── Suggestions ──
        suggestions = []
        if isinstance(max_loss, (int, float)) and abs(max_loss) > abs(max_profit if isinstance(max_profit, (int, float)) else 0) * 2:
            suggestions.append(('Considera agregar una pierna de cobertura para limitar la pérdida máxima.' if es else
                                 'Consider adding a hedge leg to cap the maximum loss.'))
        if theta < -0.1 and vega < 0.05:
            suggestions.append(('El tiempo juega en tu contra. Asegúrate de tener un catalizador claro.' if es else
                                 'Time decay is working against you. Make sure you have a clear catalyst.'))
        if pop < 0.40:
            suggestions.append(('Probabilidad de ganancia baja (<40%). Evalúa ajustar los strikes.' if es else
                                 'Low probability of profit (<40%). Consider adjusting strikes.'))
        if n_legs > 4:
            suggestions.append(('Estrategia compleja. Mayor número de piernas implica más comisiones y slippage.' if es else
                                 'Complex strategy. More legs mean higher commissions and slippage.'))
        if cost_basis > S * 0.03:
            suggestions.append(('Costo de entrada elevado respecto al precio del subyacente.' if es else
                                 'High entry cost relative to underlying price.'))
        if not suggestions:
            suggestions.append(('Estrategia bien estructurada. Monitorea los greeks al acercarse al vencimiento.' if es else
                                 'Well-structured strategy. Monitor greeks as expiration approaches.'))

        # ── Summary ──
        be_str = ' / '.join(f'${b:.2f}' for b in breakevens[:2]) if breakevens else ('N/A')
        summary = (f'Esta estrategia de {n_legs} piernas {bias}, con delta={delta:.3f}, '
                   f'theta={theta:.4f}, vega={vega:.4f}. '
                   f'Breakeven{"s" if len(breakevens) > 1 else ""}: {be_str}. '
                   f'Probabilidad de ganancia estimada: {pop*100:.1f}%.' if es else
                   f'This {n_legs}-leg strategy {bias}, with delta={delta:.3f}, '
                   f'theta={theta:.4f}, vega={vega:.4f}. '
                   f'Breakeven{"s" if len(breakevens) > 1 else ""}: {be_str}. '
                   f'Estimated probability of profit: {pop*100:.1f}%.')

        return {
            'rating': rating,
            'ratingScore': round(score),
            'summary': summary,
            'greeksAnalysis': f'{theta_txt} {vega_txt}',
            'riskAnalysis': (
                f'Ganancia máx.: {"ilimitada" if not isinstance(max_profit,(int,float)) else f"${max_profit*100:.0f}/ct"}, '
                f'Pérdida máx.: {"ilimitada" if not isinstance(max_loss,(int,float)) else f"${abs(max_loss)*100:.0f}/ct"}. '
                f'Relación R/R: {f"{abs(max_profit/max_loss):.1f}x" if isinstance(max_profit,(int,float)) and isinstance(max_loss,(int,float)) and max_loss != 0 else "N/A"}.' if es else
                f'Max profit: {"unlimited" if not isinstance(max_profit,(int,float)) else f"${max_profit*100:.0f}/ct"}, '
                f'Max loss: {"unlimited" if not isinstance(max_loss,(int,float)) else f"${abs(max_loss)*100:.0f}/ct"}. '
                f'R/R ratio: {f"{abs(max_profit/max_loss):.1f}x" if isinstance(max_profit,(int,float)) and isinstance(max_loss,(int,float)) and max_loss != 0 else "N/A"}.'
            ),
            'marketOutlook': (
                ('Funciona mejor en: ' if es else 'Works best in: ') + (', '.join(conditions))
            ),
            'suggestions': suggestions,
        }

    except Exception as e:
        print(f"[Options] Error evaluating strategy: {e}")
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    import os

    # Use PORT from environment (Railway) or default to 8000 for local
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
