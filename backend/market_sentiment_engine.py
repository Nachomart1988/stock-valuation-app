# backend/market_sentiment_engine.py
# NEURAL REASONING MARKET SENTIMENT ENGINE v5.0
# 8-layer analysis: news NLP, market breadth, sector/industry rotation,
# index internals, forex risk, volatility regime (VIX), Fear&Greed scoring,
# cross-correlation fusion with divergence detection.
# Runs in <1s on CPU. Self-sufficient via FMP auto-fetch.

from __future__ import annotations

import logging
import math
import numpy as np
import os
import sqlite3
import requests
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime, timedelta
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False
    logger.warning("yfinance not available — technical analysis layer disabled")


@dataclass
class MarketSignal:
    """A signal detected from market analysis"""
    source: str
    type: str          # bullish, bearish, neutral, cautionary
    strength: float    # 0-1
    weight: float
    description: str
    data_point: Optional[str] = None
    emoji: str = ""


class AdvancedNewsSentimentAnalyzer:
    """
    Multi-layer NLP sentiment analyzer for financial news.
    Uses weighted keyword matching with context, negation, and intensity modifiers.
    """

    def __init__(self):
        self.strong_bullish = {
            'rally': 2.0, 'surge': 2.0, 'soar': 2.0, 'skyrocket': 2.5,
            'bull market': 2.5, 'record high': 2.5, 'all-time high': 2.5, 'breakout': 2.0,
            'buying opportunity': 2.0, 'strong momentum': 2.0, 'risk on': 2.0,
            'market optimism': 2.0, 'economic boom': 2.5, 'explosive growth': 2.5,
            'fed pivot': 2.0, 'rate cut': 2.0, 'dovish': 1.8, 'stimulus': 2.0,
            'recovery': 1.5, 'inflation cooling': 2.0, 'soft landing': 2.0,
            'blowout earnings': 2.5, 'beat estimates': 2.0, 'record revenue': 2.0,
            'raised guidance': 2.0, 'upgraded': 1.8, 'outperform': 1.8,
            'golden cross': 2.0, 'new highs': 2.0, 'buyback': 1.5, 'dividend hike': 1.8,
            'strong gdp': 2.0, 'jobs beat': 1.8, 'consumer confidence': 1.2,
            'ai boom': 2.0, 'deregulation': 1.5, 'tax cut': 1.5, 'ipo surge': 1.5,
        }
        self.strong_bearish = {
            'crash': 2.5, 'collapse': 2.5, 'plunge': 2.0, 'plummet': 2.0,
            'bear market': 2.5, 'recession': 2.5, 'crisis': 2.5, 'selloff': 2.0,
            'capitulation': 2.5, 'panic': 2.5, 'meltdown': 2.5, 'risk off': 2.0,
            'flight to safety': 2.0, 'stagflation': 2.5, 'depression': 2.5,
            'market crash': 2.5, 'black swan': 2.5, 'circuit breaker': 2.5,
            'rate hike': 1.8, 'hawkish': 1.8, 'tightening': 1.5, 'inflation surge': 2.0,
            'hard landing': 2.0, 'inverted yield curve': 2.0, 'bank failure': 2.5,
            'missed estimates': 2.0, 'disappointing earnings': 2.0, 'lowered guidance': 2.0,
            'downgraded': 1.8, 'underperform': 1.8, 'revenue miss': 1.8,
            'death cross': 2.0, 'breakdown': 2.0, 'new lows': 2.0,
            'tariff': 1.5, 'trade war': 2.0, 'sanctions': 1.8, 'war': 2.0,
            'default': 2.0, 'bankruptcy': 2.5, 'layoffs': 1.5, 'mass layoffs': 2.0,
        }
        self.moderate_bullish = {
            'gains': 1.0, 'higher': 0.8, 'positive': 0.8, 'advance': 1.0,
            'growth': 0.8, 'uptick': 0.8, 'rebound': 1.2, 'upward': 0.8,
            'improving': 1.0, 'steady': 0.5, 'stabilize': 0.8, 'optimistic': 1.0,
            'beat': 1.5, 'strong': 1.0, 'robust': 1.0, 'upgrade': 1.2,
            'buy': 0.8, 'accumulate': 1.0, 'bullish': 1.5, 'opportunity': 0.8,
            'momentum': 0.8, 'strength': 0.8, 'confident': 0.8, 'exceeded': 1.2,
            'partnership': 0.6, 'contract win': 1.0, 'approval': 1.0, 'deal': 0.8,
        }
        self.moderate_bearish = {
            'decline': 1.0, 'drop': 1.0, 'fall': 0.8, 'negative': 0.8,
            'weakness': 1.0, 'concern': 0.8, 'uncertain': 0.8, 'volatility': 0.8,
            'pressure': 0.8, 'downgrade': 1.2, 'miss': 1.0, 'disappointing': 1.2,
            'headwinds': 1.0, 'slowdown': 1.2, 'contraction': 1.5, 'layoffs': 1.5,
            'sell': 0.8, 'reduce': 0.8, 'bearish': 1.5, 'cautious': 0.5,
            'risk': 0.5, 'warning': 1.0, 'caution': 0.5, 'worry': 0.8,
            'weak': 1.0, 'slumped': 1.2, 'tumbled': 1.2, 'competition': 0.6,
            'recall': 0.8, 'investigation': 0.8, 'lawsuit': 0.8, 'fine': 0.6,
        }
        self.negations = ['not', "n't", 'no', 'never', 'without', 'hardly', 'barely']
        self.intensifiers = {'very': 1.3, 'extremely': 1.5, 'highly': 1.2, 'massive': 1.4, 'huge': 1.3}

    def analyze_text(self, text: str) -> Dict[str, Any]:
        if not text:
            return {'score': 0.0, 'normalized': 0.0}
        text_lower = text.lower()
        score = 0.0
        words = text_lower.split()

        for phrase, weight in self.strong_bullish.items():
            if phrase in text_lower:
                # Check for nearby negation
                pos = text_lower.find(phrase)
                prefix = text_lower[max(0, pos-30):pos]
                neg_factor = -1 if any(neg in prefix for neg in self.negations) else 1
                score += weight * neg_factor
        for phrase, weight in self.strong_bearish.items():
            if phrase in text_lower:
                pos = text_lower.find(phrase)
                prefix = text_lower[max(0, pos-30):pos]
                neg_factor = -1 if any(neg in prefix for neg in self.negations) else 1
                score -= weight * neg_factor
        for word, weight in self.moderate_bullish.items():
            if word in text_lower:
                score += weight
        for word, weight in self.moderate_bearish.items():
            if word in text_lower:
                score -= weight

        # Intensity modifiers
        for i, word in enumerate(words):
            if word in self.intensifiers:
                factor = self.intensifiers[word]
                score = score * factor if score != 0 else score

        normalized = float(np.tanh(score / 5))
        return {'score': float(score), 'normalized': normalized}

    def _compute_tfidf_weights(self, texts: List[str]) -> Dict[str, float]:
        """
        Compute TF-IDF inspired weights for all keywords across the article batch.
        Words appearing in many articles get downweighted (high DF = low IDF).
        Returns a dict mapping keyword -> IDF weight (0..1 scale, 1 = rare/important).
        """
        if not texts:
            return {}
        n_docs = len(texts)
        all_keywords = set()
        for cat in [self.strong_bullish, self.strong_bearish, self.moderate_bullish, self.moderate_bearish]:
            all_keywords.update(cat.keys())

        # Count document frequency for each keyword
        doc_freq: Dict[str, int] = defaultdict(int)
        for text in texts:
            text_lower = text.lower()
            for kw in all_keywords:
                if kw in text_lower:
                    doc_freq[kw] += 1

        # Compute IDF: log(N / df), normalized to [0.3, 1.0] range
        # Keywords in ALL docs get 0.3 weight; keywords in 1 doc get ~1.0
        idf_weights: Dict[str, float] = {}
        for kw in all_keywords:
            df = doc_freq.get(kw, 0)
            if df == 0:
                idf_weights[kw] = 1.0
            else:
                raw_idf = math.log(n_docs / df) / math.log(max(n_docs, 2))
                idf_weights[kw] = max(0.3, min(1.0, 0.3 + 0.7 * raw_idf))
        return idf_weights

    def analyze_text_with_tfidf(self, text: str, idf_weights: Dict[str, float]) -> Dict[str, Any]:
        """Analyze a single text using TF-IDF weights to downweight common keywords."""
        if not text:
            return {'score': 0.0, 'normalized': 0.0}
        text_lower = text.lower()
        score = 0.0
        words = text_lower.split()

        for phrase, weight in self.strong_bullish.items():
            if phrase in text_lower:
                pos = text_lower.find(phrase)
                prefix = text_lower[max(0, pos-30):pos]
                neg_factor = -1 if any(neg in prefix for neg in self.negations) else 1
                score += weight * neg_factor * idf_weights.get(phrase, 1.0)
        for phrase, weight in self.strong_bearish.items():
            if phrase in text_lower:
                pos = text_lower.find(phrase)
                prefix = text_lower[max(0, pos-30):pos]
                neg_factor = -1 if any(neg in prefix for neg in self.negations) else 1
                score -= weight * neg_factor * idf_weights.get(phrase, 1.0)
        for word, weight in self.moderate_bullish.items():
            if word in text_lower:
                score += weight * idf_weights.get(word, 1.0)
        for word, weight in self.moderate_bearish.items():
            if word in text_lower:
                score -= weight * idf_weights.get(word, 1.0)

        for i, word in enumerate(words):
            if word in self.intensifiers:
                factor = self.intensifiers[word]
                score = score * factor if score != 0 else score

        normalized = float(np.tanh(score / 5))
        return {'score': float(score), 'normalized': normalized}

    def analyze_news_batch(self, news_items: List[Dict]) -> Tuple[float, List[MarketSignal], List[str]]:
        if not news_items:
            return 50.0, [], ["No news data available."]

        # Pre-compute TF-IDF weights across the entire batch
        batch_texts = []
        for item in news_items[:30]:
            title = item.get('title', '')
            text = item.get('text', '')[:500]
            batch_texts.append(f"{title} {text}")
        idf_weights = self._compute_tfidf_weights(batch_texts)

        sentiments = []
        positive_count, negative_count = 0, 0
        strong_bull_headlines, strong_bear_headlines = [], []
        reasoning = ["**LAYER 1 — NEWS NEURAL (NLP + TF-IDF):**"]

        for i, item in enumerate(news_items[:30]):
            combined = batch_texts[i] if i < len(batch_texts) else f"{item.get('title', '')} {item.get('text', '')[:500]}"
            analysis = self.analyze_text_with_tfidf(combined, idf_weights)
            sentiments.append(analysis['normalized'])
            if analysis['normalized'] > 0.3:
                positive_count += 1
                if analysis['normalized'] > 0.5:
                    strong_bull_headlines.append(item.get('title', '')[:80])
            elif analysis['normalized'] < -0.3:
                negative_count += 1
                if analysis['normalized'] < -0.5:
                    strong_bear_headlines.append(item.get('title', '')[:80])

        avg_sentiment = np.mean(sentiments) if sentiments else 0
        std_sentiment = np.std(sentiments) if len(sentiments) > 1 else 0
        score = (avg_sentiment + 1) / 2 * 100

        signals = []
        bull_ratio = positive_count / len(sentiments) if sentiments else 0.5
        if bull_ratio >= 0.65:
            signals.append(MarketSignal("news_nlp", "bullish", min(0.9, bull_ratio), 0.35,
                f"{positive_count}/{len(sentiments)} headlines bullish ({bull_ratio:.0%})", emoji="📰"))
        elif bull_ratio <= 0.35:
            bear_ratio = negative_count / len(sentiments) if sentiments else 0.5
            signals.append(MarketSignal("news_nlp", "bearish", min(0.9, bear_ratio), 0.35,
                f"{negative_count}/{len(sentiments)} headlines bearish ({bear_ratio:.0%})", emoji="📰"))

        # High dispersion = uncertain/volatile market
        if std_sentiment > 0.5:
            signals.append(MarketSignal("news_volatility", "cautionary", 0.6, 0.08,
                f"High sentiment dispersion (σ={std_sentiment:.2f}) — market uncertainty", emoji="⚡"))

        for h in strong_bull_headlines[:2]:
            reasoning.append(f"  + Bullish: '{h}'")
        for h in strong_bear_headlines[:2]:
            reasoning.append(f"  - Bearish: '{h}'")
        reasoning.append(f"  Score: {score:.1f} | {positive_count}↑ {negative_count}↓ {len(sentiments)-positive_count-negative_count}= | σ={std_sentiment:.2f}")

        return score, signals, reasoning


class NeuralReasoningMarketSentimentEngine:
    """
    v5.0 — 8-Layer Neural Reasoning Engine
    Self-sufficient: auto-fetches all data from FMP when missing.
    Layers: News NLP → Breadth → Sectors/Industries → Indices →
            VIX Regime → Forex Risk → Fear&Greed → Neural Fusion
    """

    MAJOR_INDICES = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^FTSE', '^N225', '^GDAXI']
    VIX_SYMBOL = '^VIX'

    # Sector semantic classification for qualitative reasoning
    SECTOR_SEMANTICS = {
        'Technology': ('growth', 'Risk-ON: Tech rally signals growth appetite & AI/innovation premium'),
        'Consumer Cyclical': ('cyclical', 'Risk-ON: Discretionary strength = consumer confidence & spending'),
        'Financial Services': ('cyclical', 'Rate-sensitive: Financials up = yield curve favorable or credit expanding'),
        'Industrials': ('cyclical', 'Risk-ON: Industrial strength = capex recovery & supply chain health'),
        'Basic Materials': ('cyclical', 'Cyclical: Materials demand rising with global economic activity'),
        'Energy': ('inflation', 'Inflationary/geopolitical: Energy rally drives input cost pressures'),
        'Utilities': ('defensive', 'Risk-OFF: Flight to yield/safety — investors seeking stable dividends'),
        'Consumer Defensive': ('defensive', 'Risk-OFF: Staples outperforming = defensive positioning underway'),
        'Healthcare': ('defensive', 'Defensive/Secular: Healthcare is non-cyclical, recession-resilient'),
        'Real Estate': ('rate_sensitive', 'Rate-sensitive: REITs inversely correlated with interest rates'),
        'Communication Services': ('mixed', 'Mixed: Growth tech (GOOGL/META) + defensive telecom (T/VZ)'),
    }

    # Variable TTL by data type: volatile data refreshes faster
    CACHE_TTL_MAP = {
        'vix': 60,         # VIX changes rapidly
        'indices': 60,     # Index quotes move fast
        'sectors': 300,    # Sector perf: 5 min
        'industries': 300, # Industry perf: 5 min
        'forex': 600,      # Forex: 10 min (less volatile intraday)
        'default': 300,    # Fallback
    }

    def __init__(self, db_path: str = 'sentiment.db'):
        self.version = "6.0"
        self.news_analyzer = AdvancedNewsSentimentAnalyzer()
        self._cache: Dict[str, Any] = {}
        self._cache_ttl = 300  # default 5 min cache (used by _fetch_stable/_fetch_v3)
        self._session = requests.Session()
        self._db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize SQLite DB for historical snapshot persistence."""
        try:
            with sqlite3.connect(self._db_path) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS sentiment_snapshots (
                        id        INTEGER PRIMARY KEY AUTOINCREMENT,
                        ts        TEXT NOT NULL,
                        composite REAL NOT NULL,
                        news      REAL,
                        movers    REAL,
                        sectors   REAL,
                        indices   REAL,
                        vix       REAL,
                        fg        REAL,
                        ema       REAL
                    )
                """)
                conn.commit()
        except Exception as e:
            logger.warning(f"[MSE] DB init failed: {e}")

    def _store_snapshot(self, composite: float, scores: Dict[str, float], ema: float):
        """Persist a sentiment snapshot to SQLite."""
        try:
            ts = datetime.now().isoformat()
            with sqlite3.connect(self._db_path) as conn:
                conn.execute(
                    """INSERT INTO sentiment_snapshots
                       (ts, composite, news, movers, sectors, indices, vix, fg, ema)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (
                        ts,
                        round(composite, 2),
                        round(scores.get('news', 50), 2),
                        round(scores.get('movers', 50), 2),
                        round(scores.get('sectors', 50), 2),
                        round(scores.get('indices', 50), 2),
                        round(scores.get('vix', 50), 2),
                        round(scores.get('fearGreed', 50), 2),
                        round(ema, 2),
                    )
                )
                conn.commit()
        except Exception as e:
            logger.warning(f"[MSE] Snapshot store failed: {e}")

    def _load_history(self, days: int = 30) -> List[Dict]:
        """Load recent snapshots from SQLite (last N days)."""
        try:
            cutoff = (datetime.now() - timedelta(days=days)).isoformat()
            with sqlite3.connect(self._db_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    """SELECT ts, composite, ema FROM sentiment_snapshots
                       WHERE ts >= ? ORDER BY ts DESC LIMIT 720""",
                    (cutoff,)
                ).fetchall()
            return [{"ts": r["ts"], "composite": r["composite"], "ema": r["ema"]} for r in rows]
        except Exception as e:
            logger.warning(f"[MSE] History load failed: {e}")
            return []

    def _compute_trends(self, history: List[Dict], current: float) -> Dict:
        """
        Compute temporal trends from historical snapshots.
        Returns daily_delta, weekly_mean, monthly_delta, weekly_trend, ema_score.
        """
        if not history:
            return {
                "daily_delta": None,
                "weekly_mean": None,
                "monthly_delta": None,
                "weekly_trend": None,
                "ema_score": current,
                "momentum_streak": 0,
                "anomaly": False,
                "note": "Inicial — trends disponibles post 2+ runs",
            }

        now = datetime.now()
        snapshots = []
        for h in history:
            try:
                ts = datetime.fromisoformat(h["ts"])
                snapshots.append({"ts": ts, "composite": h["composite"], "ema": h.get("ema", h["composite"])})
            except Exception:
                continue

        if not snapshots:
            return {"daily_delta": None, "weekly_mean": None, "monthly_delta": None,
                    "weekly_trend": None, "ema_score": current, "momentum_streak": 0,
                    "anomaly": False, "note": "Sin historial válido"}

        # Sort newest first (already from DB ORDER BY ts DESC)
        snapshots.sort(key=lambda x: x["ts"], reverse=True)

        # EMA smoothing: alpha=0.3
        prev_ema = snapshots[0]["ema"] if snapshots[0]["ema"] else snapshots[0]["composite"]
        ema_score = round(0.3 * current + 0.7 * prev_ema, 1)

        # Daily delta: vs the most recent snapshot before now
        daily_delta = None
        one_day_ago = now - timedelta(hours=20)  # flexible: within 20h–28h
        day_old = [s for s in snapshots if s["ts"] < one_day_ago]
        if day_old:
            daily_delta = round(current - day_old[0]["composite"], 1)

        # Anomaly: sudden large change within last 2 hours
        two_hours_ago = now - timedelta(hours=2)
        recent = [s for s in snapshots if s["ts"] >= two_hours_ago]
        anomaly = False
        if recent:
            delta_1h = abs(current - recent[-1]["composite"])
            if delta_1h > 30:
                anomaly = True
                logger.warning(f"[MSE] ANOMALY: composite changed {delta_1h:.1f} pts in <2h")

        # Weekly mean: snapshots in last 7 days
        seven_days_ago = now - timedelta(days=7)
        week_snaps = [s["composite"] for s in snapshots if s["ts"] >= seven_days_ago]
        weekly_mean = round(float(np.mean(week_snaps)), 1) if len(week_snaps) >= 2 else None

        # Weekly trend label
        weekly_trend = None
        if weekly_mean is not None:
            diff = current - weekly_mean
            if diff > 5:
                weekly_trend = "mejorando"
            elif diff < -5:
                weekly_trend = "deteriorando"
            else:
                weekly_trend = "estable"

        # Monthly delta: vs oldest snapshot within last 30 days
        thirty_days_ago = now - timedelta(days=30)
        month_snaps = [s for s in snapshots if s["ts"] >= thirty_days_ago]
        monthly_delta = None
        if month_snaps:
            oldest_month = min(month_snaps, key=lambda x: x["ts"])
            monthly_delta = round(current - oldest_month["composite"], 1)

        # Momentum streak: consecutive sessions moving same direction
        streak = 0
        if len(snapshots) >= 2:
            direction = 1 if current > snapshots[0]["composite"] else -1
            for i in range(len(snapshots) - 1):
                d = 1 if snapshots[i]["composite"] > snapshots[i+1]["composite"] else -1
                if d == direction:
                    streak += 1
                else:
                    break

        return {
            "daily_delta": daily_delta,
            "weekly_mean": weekly_mean,
            "monthly_delta": monthly_delta,
            "weekly_trend": weekly_trend,
            "ema_score": ema_score,
            "momentum_streak": streak,
            "anomaly": anomaly,
        }

    # ====================== FMP FETCH HELPERS ======================

    def _get_api_key(self) -> Optional[str]:
        return os.environ.get('FMP_API_KEY')

    def _get_ttl(self, category: str = 'default') -> int:
        """Get cache TTL in seconds for a given data category."""
        return self.CACHE_TTL_MAP.get(category, self.CACHE_TTL_MAP['default'])

    def _fetch_stable(self, endpoint: str, params: str = '', ttl_category: str = 'default') -> Any:
        """Fetch from /stable/ base path with variable-TTL caching."""
        api_key = self._get_api_key()
        if not api_key:
            return None
        cache_key = f'mse_stable_{endpoint}_{params}'
        cached = self._cache.get(cache_key)
        ttl = self._get_ttl(ttl_category)
        if cached:
            data, ts = cached
            if datetime.now().timestamp() - ts < ttl:
                return data
        try:
            sep = '&' if params else ''
            url = f"https://financialmodelingprep.com/stable/{endpoint}?{params}{sep}apikey={api_key}"
            logger.debug(f"Fetching: {url[:100]}...")
            resp = self._session.get(url, timeout=12)
            logger.debug(f"Response {endpoint}: {resp.status_code}")
            if resp.ok:
                data = resp.json()
                self._cache[cache_key] = (data, datetime.now().timestamp())
                return data
        except Exception as e:
            logger.warning(f"Fetch error ({endpoint}): {e}")
        return None

    def _fetch_v3(self, path: str, params: str = '', ttl_category: str = 'default') -> Any:
        """Fetch from /api/v3/ base path (legacy endpoints like batch quote)."""
        api_key = self._get_api_key()
        if not api_key:
            return None
        cache_key = f'mse_v3_{path}_{params}'
        cached = self._cache.get(cache_key)
        ttl = self._get_ttl(ttl_category)
        if cached:
            data, ts = cached
            if datetime.now().timestamp() - ts < ttl:
                return data
        try:
            sep = '&' if params else ''
            url = f"https://financialmodelingprep.com/api/v3/{path}?{params}{sep}apikey={api_key}"
            logger.debug(f"Fetching v3: {url[:100]}...")
            resp = self._session.get(url, timeout=12)
            logger.debug(f"Response v3/{path}: {resp.status_code}")
            if resp.ok:
                data = resp.json()
                self._cache[cache_key] = (data, datetime.now().timestamp())
                return data
        except Exception as e:
            logger.warning(f"v3 fetch error ({path}): {e}")
        return None

    def _prev_trading_day(self, offset: int = 1) -> str:
        """Get a recent trading day date string (skip weekends)."""
        d = datetime.now() - timedelta(days=offset)
        while d.weekday() >= 5:  # 5=Sat, 6=Sun
            d -= timedelta(days=1)
        return d.strftime('%Y-%m-%d')

    def _calc_rsi(self, prices, period: int = 14) -> float:
        """Calculate RSI(14) from a pandas price series."""
        try:
            delta = prices.diff().dropna()
            gain = delta.clip(lower=0).rolling(window=period).mean()
            loss = (-delta.clip(upper=0)).rolling(window=period).mean()
            last_loss = loss.iloc[-1]
            if last_loss == 0:
                return 100.0
            rs = gain.iloc[-1] / last_loss
            return float(100 - (100 / (1 + rs)))
        except Exception:
            return 50.0

    def _fetch_yfinance_data(self) -> Dict[str, Any]:
        """
        Fetch index/ETF data via yfinance for technical analysis.
        Uses yf.download() with multiple tickers at once for speed.
        Returns RSI, moving averages, and price context for SPY, QQQ, IWM, DIA, VIX, 10Y yield.
        """
        if not YF_AVAILABLE:
            return {}
        result = {}
        targets = {
            'SPY': 'spy',    # S&P 500 ETF
            'QQQ': 'qqq',    # Nasdaq-100 ETF
            'IWM': 'iwm',    # Russell 2000 small caps
            'DIA': 'dia',    # Dow Jones ETF
            '^VIX': 'vix',   # Volatility Index
            '^TNX': 'tnx',   # 10-Year Treasury Yield
        }

        # Batch download all tickers at once for speed
        all_symbols = list(targets.keys())
        try:
            batch_data = yf.download(all_symbols, period='1y', interval='1d',
                                     auto_adjust=True, group_by='ticker',
                                     threads=True, progress=False)
        except Exception as e:
            logger.warning(f"[MSE v6] yfinance batch download failed: {e}, falling back to individual")
            batch_data = None

        for sym, key in targets.items():
            try:
                # Extract this ticker's data from the batch result
                if batch_data is not None and not batch_data.empty:
                    if len(all_symbols) > 1 and sym in batch_data.columns.get_level_values(0):
                        hist = batch_data[sym].dropna(how='all')
                    elif len(all_symbols) == 1:
                        hist = batch_data.dropna(how='all')
                    else:
                        hist = None
                else:
                    hist = None

                # Fallback to individual Ticker if batch didn't work for this symbol
                if hist is None or hist.empty or len(hist) < 5:
                    ticker = yf.Ticker(sym)
                    hist = ticker.history(period='1y', interval='1d', auto_adjust=True)

                if hist.empty or len(hist) < 5:
                    continue
                closes = hist['Close']
                price = float(closes.iloc[-1])
                prev = float(closes.iloc[-2]) if len(closes) > 1 else price
                change_pct = (price / prev - 1) * 100 if prev != 0 else 0
                ma20 = float(closes.tail(20).mean()) if len(closes) >= 20 else None
                ma50 = float(closes.tail(50).mean()) if len(closes) >= 50 else None
                ma200 = float(closes.tail(200).mean()) if len(closes) >= 200 else None
                rsi = self._calc_rsi(closes)
                high_52w = float(hist['High'].max())
                low_52w = float(hist['Low'].min())
                pct_from_high = (price - high_52w) / high_52w * 100 if high_52w else 0
                result[key] = {
                    'price': price,
                    'change_1d': round(change_pct, 2),
                    'rsi': round(rsi, 1),
                    'ma20': round(ma20, 2) if ma20 else None,
                    'ma50': round(ma50, 2) if ma50 else None,
                    'ma200': round(ma200, 2) if ma200 else None,
                    'high_52w': round(high_52w, 2),
                    'low_52w': round(low_52w, 2),
                    'pct_from_high': round(pct_from_high, 1),
                }
                logger.info(f"[MSE v6] yfinance {sym}: ${price:.2f} RSI={rsi:.0f}"
                      + (f" vs 200DMA ${ma200:.0f}" if ma200 else ""))
            except Exception as e:
                logger.info(f"[MSE v6] yfinance {sym} error: {e}")

        # ── Market Breadth Indicators ─────────────────────────────────────
        # Try multiple symbol variants — Yahoo Finance changes these periodically
        breadth_targets = [
            ('^NYAD',  'ad_line'),    # NYSE Advance-Decline Issues (most reliable)
            ('^ADD',   'ad_line'),    # NYSE A/D cumulative line (alternate)
            ('^ADVN',  'ad_line'),    # NYSE Advancing Issues
            ('^NAHL',  'nhl_index'),  # NYSE New Highs - New Lows
            ('^NYSHL', 'nhl_index'),  # NYSE New Highs-Lows (alternate)
        ]
        fetched_keys: set = set()
        for sym, key in breadth_targets:
            if key in fetched_keys:
                continue
            try:
                t = yf.Ticker(sym)
                hist = t.history(period='3mo', interval='1d', auto_adjust=True)
                if hist.empty or len(hist) < 5:
                    continue
                closes = hist['Close']
                current = float(closes.iloc[-1])
                prev = float(closes.iloc[-2]) if len(closes) > 1 else current
                ma10 = float(closes.tail(10).mean()) if len(closes) >= 10 else None
                ma20 = float(closes.tail(20).mean()) if len(closes) >= 20 else None
                change_1d = current - prev
                result[key] = {
                    'value': round(current, 0),
                    'change_1d': round(change_1d, 0),
                    'ma10': round(ma10, 0) if ma10 else None,
                    'ma20': round(ma20, 0) if ma20 else None,
                    'trend': 'up' if ma10 and current > ma10 else 'down' if ma10 else 'neutral',
                }
                fetched_keys.add(key)
                logger.info(f"[MSE v6] Breadth {sym}: {current:.0f} (1d: {change_1d:+.0f})")
            except Exception as e:
                logger.info(f"[MSE v6] Breadth {sym} error: {e}")

        return result

    def _fill_missing_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Auto-fetch any missing market data from FMP API and yfinance.
        Uses ThreadPoolExecutor to fetch independent data sources in parallel.
        """
        filled = dict(data)

        # ── Identify which fetches are needed ────────────────────────────
        need_sectors = not filled.get('sectorPerformance')
        need_industries = not filled.get('industryPerformance')
        need_indices = not filled.get('indexQuotes')
        need_vix = not filled.get('vixQuote')
        existing_forex = filled.get('forexQuotes', [])
        forex_has_changes = any(
            fx.get('changesPercentage') is not None or fx.get('changes') is not None
            for fx in (existing_forex or [])[:5]
        )
        need_forex = not existing_forex or not forex_has_changes

        # ── Define fetch tasks ───────────────────────────────────────────
        def fetch_sectors():
            for offset in range(0, 4):
                date_str = self._prev_trading_day(offset)
                sectors = self._fetch_stable('sector-performance-snapshot', f'date={date_str}', ttl_category='sectors')
                if sectors and isinstance(sectors, list) and len(sectors) > 0:
                    logger.info(f"[MSE] Got {len(sectors)} sectors for {date_str}")
                    # Attach fetch timestamp for staleness detection
                    for s in sectors:
                        s['_fetch_date'] = date_str
                    return ('sectorPerformance', sectors)
            return None

        def fetch_industries():
            for offset in range(0, 4):
                date_str = self._prev_trading_day(offset)
                industries = self._fetch_stable('industry-performance-snapshot', f'date={date_str}', ttl_category='industries')
                if industries and isinstance(industries, list) and len(industries) > 0:
                    logger.info(f"[MSE] Got {len(industries)} industries for {date_str}")
                    for ind in industries:
                        ind['_fetch_date'] = date_str
                    return ('industryPerformance', industries)
            return None

        def fetch_indices():
            symbols_str = ','.join(self.MAJOR_INDICES)
            quotes = self._fetch_v3(f'quote/{symbols_str}', ttl_category='indices')
            if quotes and isinstance(quotes, list) and len(quotes) > 0:
                logger.info(f"[MSE] Got {len(quotes)} index quotes")
                return ('indexQuotes', quotes)
            all_idx = self._fetch_stable('full-index-quotes', ttl_category='indices')
            if all_idx and isinstance(all_idx, list):
                wanted = set(self.MAJOR_INDICES + [self.VIX_SYMBOL])
                filtered = [q for q in all_idx if q.get('symbol', '') in wanted]
                if filtered:
                    logger.info(f"[MSE] Got {len(filtered)} major index quotes (full-index-quotes)")
                    return ('indexQuotes', filtered)
            return None

        def fetch_vix():
            vix = self._fetch_v3(f'quote/{self.VIX_SYMBOL}', ttl_category='vix')
            if vix and isinstance(vix, list) and len(vix) > 0:
                logger.info(f"[MSE] Got VIX: {vix[0].get('price', 'N/A')}")
                return ('vixQuote', vix[0])
            return None

        def fetch_forex():
            forex = self._fetch_stable('fx', ttl_category='forex')
            if forex and isinstance(forex, list) and len(forex) > 0:
                logger.info(f"[MSE] Got {len(forex)} forex pairs from /stable/fx")
                return ('forexQuotes', forex)
            forex2 = self._fetch_stable('batch-forex-quotes', ttl_category='forex')
            if forex2 and isinstance(forex2, list) and len(forex2) > 0:
                logger.info(f"[MSE] Got {len(forex2)} forex pairs from batch-forex-quotes")
                return ('forexQuotes', forex2)
            return None

        def fetch_yfinance():
            yf_data = self._fetch_yfinance_data()
            if yf_data:
                return ('yfinanceData', yf_data)
            return None

        # ── Submit all needed fetches in parallel ────────────────────────
        tasks = []
        task_names = []
        if need_sectors:
            tasks.append(fetch_sectors); task_names.append('sectors')
        if need_industries:
            tasks.append(fetch_industries); task_names.append('industries')
        if need_indices:
            tasks.append(fetch_indices); task_names.append('indices')
        if need_vix:
            tasks.append(fetch_vix); task_names.append('vix')
        if need_forex:
            tasks.append(fetch_forex); task_names.append('forex')
        tasks.append(fetch_yfinance); task_names.append('yfinance')

        if tasks:
            logger.info(f"[MSE] Parallel fetch: {', '.join(task_names)}")
            with ThreadPoolExecutor(max_workers=min(len(tasks), 6)) as executor:
                futures = {executor.submit(fn): name for fn, name in zip(tasks, task_names)}
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        result = future.result(timeout=15)
                        if result:
                            key, value = result
                            filled[key] = value
                    except Exception as e:
                        logger.warning(f"[MSE] Parallel fetch '{name}' failed: {e}")

        # ── VIX fallback from indexQuotes ─────────────────────────────────
        if not filled.get('vixQuote') and filled.get('indexQuotes'):
            for q in filled['indexQuotes']:
                if q.get('symbol') == self.VIX_SYMBOL:
                    filled['vixQuote'] = q
                    break

        # ── Historical trend proxy from sector changes ───────────────────
        if not filled.get('historicalSectorPerformance'):
            sectors = filled.get('sectorPerformance', [])
            if sectors:
                hist = [
                    {'sector': s.get('sector', ''), 'averageChange': s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0}
                    for s in sectors
                ]
                filled['historicalSectorPerformance'] = hist

        # ── Fear & Greed components: market momentum ─────────────────────
        if not filled.get('sp500History') and filled.get('indexQuotes'):
            for q in filled['indexQuotes']:
                if q.get('symbol') in ('^GSPC', 'SPY'):
                    filled['sp500Change'] = q.get('changesPercentage', 0) or 0
                    filled['sp500Price'] = q.get('price', 0) or 0
                    filled['sp500YearHigh'] = q.get('yearHigh', 0) or 0
                    filled['sp500YearLow'] = q.get('yearLow', 0) or 0
                    break

        # ── yfinance VIX/index fallbacks ─────────────────────────────────
        yf_data = filled.get('yfinanceData')
        if yf_data:
            if (not filled.get('vixQuote') or not (filled['vixQuote'] or {}).get('price')) and yf_data.get('vix'):
                vd = yf_data['vix']
                filled['vixQuote'] = {'price': vd['price'], 'changesPercentage': vd['change_1d']}
                logger.info(f"[MSE v6] VIX from yfinance: {vd['price']:.1f} ({vd['change_1d']:+.2f}%)")
            if not filled.get('indexQuotes') and yf_data.get('spy'):
                spy = yf_data['spy']
                filled['indexQuotes'] = [
                    {'symbol': 'SPY', 'name': 'S&P 500 ETF', 'price': spy['price'],
                     'changesPercentage': spy['change_1d'], 'yearHigh': spy['high_52w'], 'yearLow': spy['low_52w']},
                ]
                if yf_data.get('qqq'):
                    q = yf_data['qqq']
                    filled['indexQuotes'].append({'symbol': 'QQQ', 'name': 'Nasdaq-100 ETF',
                        'price': q['price'], 'changesPercentage': q['change_1d']})
                if yf_data.get('iwm'):
                    r = yf_data['iwm']
                    filled['indexQuotes'].append({'symbol': '^RUT', 'name': 'Russell 2000',
                        'price': r['price'], 'changesPercentage': r['change_1d']})

        return filled

    # ====================== 8 ANALYSIS LAYERS ======================

    def analyze(self, data: Dict[str, Any], language: str = 'en') -> Dict[str, Any]:
        start = datetime.now()

        if not isinstance(data, dict):
            logger.error("[MSE] analyze() received non-dict data, using empty dict")
            data = {}

        # Self-sufficient data fill
        data = self._fill_missing_data(data)

        news = data.get('news', [])
        gainers = data.get('gainers', [])
        losers = data.get('losers', [])
        sectors = data.get('sectorPerformance', [])
        industries = data.get('industryPerformance', [])
        indices = data.get('indexQuotes', [])
        forex = data.get('forexQuotes', [])
        hist_sectors = data.get('historicalSectorPerformance', [])
        vix_quote = data.get('vixQuote')
        yf_data = data.get('yfinanceData', {})
        index_breadth = data.get('indexBreadth') or {}

        signals: List[MarketSignal] = []
        full_reasoning: List[str] = [f"**NEURAL ENGINE v{self.version} — ANALYSIS INITIATED**"]

        logger.info(f"[MSE v{self.version}] Data: news={len(news)}, gainers={len(gainers)}, losers={len(losers)}, "
              f"sectors={len(sectors)}, industries={len(industries)}, indices={len(indices)}, "
              f"forex={len(forex)}, vix={'YES' if vix_quote else 'NO'}")

        # LAYER 1 — NEWS NLP
        news_score, news_signals, news_reasoning = self.news_analyzer.analyze_news_batch(news)
        signals.extend(news_signals)
        full_reasoning.extend(news_reasoning)

        # LAYER 2 — MARKET BREADTH (Gainers vs Losers + A/D Line + New Highs/Lows)
        movers_score, movers_signals, breadth_ratio, sector_rotation, top_gainers, top_losers = self._layer2_breadth(gainers, losers, yf_data, index_breadth)
        signals.extend(movers_signals)

        # Real advancing/declining counts from SP500 index breadth (same sanity check as _layer2_breadth)
        sp500_b = index_breadth.get('sp500') or {}
        _total_real = sp500_b.get('total', 0)
        _adv = sp500_b.get('advancing', 0)
        _dec = sp500_b.get('declining', 0)
        _use_real = _total_real > 100 and (_adv + _dec) >= _total_real * 0.20
        real_advancing = _adv if _use_real else len(gainers)
        real_declining = _dec if _use_real else len(losers)
        ad_info = ""
        nhl_info = ""
        if yf_data.get('ad_line'):
            ad = yf_data['ad_line']
            ad_info = f" | A/D Line: {ad.get('value', 0):,.0f} ({ad.get('trend', '?')})"
        if yf_data.get('nhl_index'):
            nhl = yf_data['nhl_index']
            nhl_info = f" | NHL: {nhl.get('value', 0):+.0f}"
        full_reasoning.append(f"**LAYER 2 — BREADTH:** {breadth_ratio:.0%} advancing | {len(gainers)}↑ {len(losers)}↓{ad_info}{nhl_info}")

        # LAYER 3 — SECTOR & INDUSTRY MACRO
        sector_score, sector_signals, sector_breadth, hot_sectors, cold_sectors, sector_reasoning = self._layer3_sectors(sectors)
        signals.extend(sector_signals)
        full_reasoning.extend(sector_reasoning)

        industry_score, industry_signals, industry_breadth = self._layer3b_industries(industries)
        signals.extend(industry_signals)

        # LAYER 4 — MAJOR INDICES + TECHNICAL (yfinance)
        index_score, index_signals, index_reasoning, sp500_change = self._layer4_indices(indices, yf_data)
        signals.extend(index_signals)
        full_reasoning.extend(index_reasoning)

        # LAYER 5 — VIX VOLATILITY REGIME
        vix_score, vix_signals, vix_value, vix_reasoning = self._layer5_vix(vix_quote, indices)
        signals.extend(vix_signals)
        full_reasoning.extend(vix_reasoning)

        # LAYER 6 — FOREX (USD RISK)
        forex_score, forex_signals, forex_reasoning = self._layer6_forex(forex)
        signals.extend(forex_signals)
        full_reasoning.extend(forex_reasoning)

        # LAYER 7 — FEAR & GREED COMPOSITE
        fg_score, fg_label, fg_signals, fg_reasoning = self._layer7_fear_greed(
            news_score, breadth_ratio, vix_value, sector_breadth, industry_breadth,
            sp500_change, sector_score, index_score
        )
        signals.extend(fg_signals)
        full_reasoning.extend(fg_reasoning)

        # LAYER 8 — NEURAL FUSION + CROSS-CORRELATION
        composite, fusion_reasoning = self._layer8_fusion(
            news_score, movers_score, sector_score, industry_score,
            index_score, vix_score, forex_score, fg_score,
            breadth_ratio, sector_breadth, vix_value
        )
        full_reasoning.extend(fusion_reasoning)

        # CONCLUSION
        rec, emoji, sentiment, desc, action = self._generate_conclusion(composite, vix_value, breadth_ratio)

        process_time = (datetime.now() - start).total_seconds()
        logger.info(f"Done in {process_time:.3f}s → {rec} (score: {composite:.1f})")

        # TEMPORAL ANALYSIS + EMA LEARNING
        scores_dict = {
            "news": news_score, "movers": movers_score, "sectors": sector_score,
            "indices": index_score, "vix": vix_score, "fearGreed": fg_score,
        }
        history = self._load_history(days=30)
        trends = self._compute_trends(history, composite)
        self._store_snapshot(composite, scores_dict, trends["ema_score"])

        return {
            "version": self.version,
            "timestamp": datetime.now().isoformat(),
            "processingTime": round(process_time, 3),
            "compositeScore": round(composite, 1),
            "overallSentiment": sentiment,
            "sentimentEmoji": emoji,
            "recommendation": rec,
            "recommendationDescription": desc,
            "actionableAdvice": action,
            "fearGreedScore": round(fg_score, 1),
            "fearGreedLabel": fg_label,
            "vixValue": round(vix_value, 2) if vix_value else None,
            "scores": {
                "news": round(news_score, 1),
                "movers": round(movers_score, 1),
                "sectors": round(sector_score, 1),
                "industries": round(industry_score, 1),
                "indices": round(index_score, 1),
                "vix": round(vix_score, 1),
                "forex": round(forex_score, 1),
                "fearGreed": round(fg_score, 1),
                "composite": round(composite, 1),
            },
            "moversAnalysis": {
                "breadthRatio": round(breadth_ratio, 3),
                "breadthLabel": self._breadth_label(breadth_ratio),
                "gainersCount": real_advancing,
                "losersCount": real_declining,
                "topGainers": top_gainers,
                "topLosers": top_losers,
                "sectorRotation": sector_rotation,
            },
            "macroAnalysis": {
                "sectorBreadth": round(sector_breadth * 100, 1),
                "industryBreadth": round(industry_breadth * 100, 1),
                "hotSectors": [{"sector": s.get('sector', ''), "change": round(s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0, 2)} for s in hot_sectors[:5]],
                "coldSectors": [{"sector": s.get('sector', ''), "change": round(s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0, 2)} for s in cold_sectors[:5]],
                "majorIndicesUp": [i.get('symbol', '') for i in indices if (i.get('changesPercentage', 0) or 0) > 0],
                "majorIndicesDown": [i.get('symbol', '') for i in indices if (i.get('changesPercentage', 0) or 0) < 0],
                "vixRegime": self._vix_regime_label(vix_value),
            },
            "signals": [
                {
                    "source": s.source, "type": s.type, "strength": s.strength,
                    "weight": s.weight, "description": s.description,
                    "dataPoint": s.data_point, "emoji": s.emoji
                }
                for s in signals[:25]
            ],
            "reasoningChain": full_reasoning,
            "briefing": self._generate_briefing(
                composite, news_score, movers_score, breadth_ratio,
                sector_rotation, rec, real_advancing, real_declining,
                hot_sectors, cold_sectors, action, vix_value, fg_score, fg_label,
                language=language
            ),
            "trends": trends,
        }

    # ====================== LAYER IMPLEMENTATIONS ======================

    def _layer2_breadth(self, gainers, losers, yf_data: Dict[str, Any] = None, index_breadth: Dict[str, Any] = None):
        """Layer 2: Market breadth — Zweig Breadth Thrust + A/D Line + New Highs/Lows."""
        signals = []
        yf_data = yf_data or {}
        index_breadth = index_breadth or {}

        # Use real SP500 constituent breadth when available (>100 stocks counted)
        sp500_b = index_breadth.get('sp500') or {}
        total_real = sp500_b.get('total', 0)
        advancing = sp500_b.get('advancing', 0)
        declining = sp500_b.get('declining', 0)
        # Sanity check: at least 20% of stocks must have non-zero change (avoids pre-market/stale data)
        use_real_breadth = (
            total_real > 100 and
            (advancing + declining) >= total_real * 0.20
        )
        if use_real_breadth:
            breadth_ratio = advancing / total_real
            logger.info(f"[MSE] SP500 real breadth: {advancing}↑ {declining}↓ of {total_real} ({breadth_ratio:.1%})")
        else:
            if total_real > 0:
                logger.info(f"[MSE] SP500 breadth data stale or pre-market ({advancing+declining}/{total_real} with movement), falling back to gainers/losers")
            total = len(gainers) + len(losers)
            if total == 0:
                return 50.0, [], 0.5, {"hot": [], "cold": []}, [], []
            breadth_ratio = len(gainers) / total

        avg_gainer = np.mean([g.get('changesPercentage', 0) or 0 for g in gainers]) if gainers else 0
        avg_loser = np.mean([abs(l.get('changesPercentage', 0) or 0) for l in losers]) if losers else 0

        # Volume-weighted breadth: if volume data available, weight up/down by volume
        gainer_vols = [g.get('volume', 0) or 0 for g in gainers]
        loser_vols = [l.get('volume', 0) or 0 for l in losers]
        total_gainer_vol = sum(gainer_vols)
        total_loser_vol = sum(loser_vols)
        if total_gainer_vol + total_loser_vol > 0:
            vol_breadth_ratio = total_gainer_vol / (total_gainer_vol + total_loser_vol)
            # Blend: 60% volume-weighted, 40% count-based for robustness
            breadth_ratio = 0.6 * vol_breadth_ratio + 0.4 * breadth_ratio
            logger.info(f"[MSE] Volume-weighted breadth: vol_ratio={vol_breadth_ratio:.3f}, blended={breadth_ratio:.3f}")

        # Zweig-style: up volume / total volume proxy via breadth
        score = 50 + (breadth_ratio - 0.5) * 90

        # Breadth thrust — very strong signal when ≥61.5% advance in any 10-day window
        if breadth_ratio >= 0.72:
            signals.append(MarketSignal("breadth_thrust", "bullish", 0.95, 0.28,
                f"BREADTH THRUST: {breadth_ratio:.0%} advancing — extreme bull signal", emoji="🚀"))
        elif breadth_ratio >= 0.62:
            signals.append(MarketSignal("breadth", "bullish", 0.80, 0.22,
                f"Strong breadth: {breadth_ratio:.0%} advancing", emoji="📈"))
        elif breadth_ratio <= 0.28:
            signals.append(MarketSignal("breadth_collapse", "bearish", 0.95, 0.28,
                f"BREADTH COLLAPSE: only {breadth_ratio:.0%} advancing — extreme bear signal", emoji="🔻"))
        elif breadth_ratio <= 0.40:
            signals.append(MarketSignal("breadth", "bearish", 0.80, 0.22,
                f"Weak breadth: {breadth_ratio:.0%} advancing", emoji="📉"))
        else:
            signals.append(MarketSignal("breadth", "neutral", 0.50, 0.10,
                f"Neutral breadth: {breadth_ratio:.0%} advancing", emoji="⚖️"))

        # ── A/D Line: NYSE Advance-Decline cumulative trend ───────────────
        # If yfinance failed to get ^NYAD/^ADD, synthesize from FMP gainers/losers
        ad_data = yf_data.get('ad_line')
        if not ad_data and len(gainers) + len(losers) > 10:
            net = len(gainers) - len(losers)
            total_mover = len(gainers) + len(losers)
            synth_trend = 'up' if net > 0 else 'down' if net < 0 else 'neutral'
            ad_data = {
                'value': round(net / total_mover * 1000, 0),
                'change_1d': net,
                'ma10': None,
                'ma20': None,
                'trend': synth_trend,
                'synthetic': True,
            }
            logger.info(f"[MSE v6] A/D synthetic: {net:+d} net movers ({len(gainers)}G/{len(losers)}L)")
        if ad_data:
            ad_trend = ad_data.get('trend', 'neutral')
            ad_change = ad_data.get('change_1d', 0)
            if ad_trend == 'up' and ad_change > 0:
                signals.append(MarketSignal("ad_line", "bullish", 0.75, 0.18,
                    f"A/D Line rising (+{ad_change:,.0f} today, above 10DMA) — broad market participation", emoji="📊"))
                score += 8
            elif ad_trend == 'down' and ad_change < 0:
                signals.append(MarketSignal("ad_line", "bearish", 0.75, 0.18,
                    f"A/D Line declining ({ad_change:,.0f} today, below 10DMA) — narrow leadership, market weakness", emoji="📉"))
                score -= 8
            elif ad_trend == 'up' and ad_change < 0:
                signals.append(MarketSignal("ad_line", "cautionary", 0.50, 0.08,
                    f"A/D Line above 10DMA but pulled back today ({ad_change:,.0f}) — watch for momentum shift", emoji="⚠️"))
            logger.info(f"[MSE v6] A/D Line: {ad_data.get('value', 0):,.0f} trend={ad_trend} 1d={ad_change:+,.0f}")

        # ── New Highs / New Lows: Market internal strength ────────────────
        nhl_data = yf_data.get('nhl_index')
        if nhl_data:
            nhl_value = nhl_data.get('value', 0)
            nhl_trend = nhl_data.get('trend', 'neutral')
            nhl_ma10 = nhl_data.get('ma10')
            if nhl_value > 100 and nhl_trend == 'up':
                signals.append(MarketSignal("new_highs", "bullish", 0.70, 0.15,
                    f"New Highs dominating ({nhl_value:+.0f} NHL index) — expanding market leadership", emoji="🏔️"))
                score += 6
            elif nhl_value < -100 and nhl_trend == 'down':
                signals.append(MarketSignal("new_lows", "bearish", 0.70, 0.15,
                    f"New Lows dominating ({nhl_value:+.0f} NHL index) — distribution phase underway", emoji="🕳️"))
                score -= 6
            elif nhl_value < 0 and nhl_trend == 'down' and nhl_ma10 and nhl_value < nhl_ma10:
                signals.append(MarketSignal("new_lows", "cautionary", 0.55, 0.08,
                    f"New Lows outpacing New Highs ({nhl_value:+.0f}) — breadth deteriorating", emoji="⚠️"))
                score -= 3
            logger.info(f"[MSE v6] NHL Index: {nhl_value:+.0f} trend={nhl_trend}")

        # Momentum asymmetry
        if avg_gainer > 0 and avg_loser > 0:
            momentum_ratio = avg_gainer / avg_loser
            if momentum_ratio > 2.0:
                signals.append(MarketSignal("momentum", "bullish", 0.80, 0.15,
                    f"Gainer momentum {momentum_ratio:.1f}x stronger than losers ({avg_gainer:.1f}% vs {avg_loser:.1f}%)", emoji="💪"))
            elif momentum_ratio < 0.5:
                signals.append(MarketSignal("momentum", "bearish", 0.80, 0.15,
                    f"Loser momentum {1/momentum_ratio:.1f}x stronger ({avg_loser:.1f}% drops vs {avg_gainer:.1f}% gains)", emoji="⚠️"))

        # Sector rotation from movers
        sector_data = defaultdict(lambda: {'g': 0, 'l': 0})
        for g in gainers:
            sector_data[g.get('sector', 'Unknown') or 'Unknown']['g'] += 1
        for l in losers:
            sector_data[l.get('sector', 'Unknown') or 'Unknown']['l'] += 1

        hot = sorted([(s, d) for s, d in sector_data.items() if d['g'] > d['l']], key=lambda x: x[1]['g'], reverse=True)[:5]
        cold = sorted([(s, d) for s, d in sector_data.items() if d['l'] > d['g']], key=lambda x: x[1]['l'], reverse=True)[:5]

        top_gainers = [
            {"symbol": g.get('symbol', ''), "name": g.get('name', '')[:40],
             "change": g.get('changesPercentage', 0), "price": g.get('price', 0), "sector": g.get('sector', '')}
            for g in sorted(gainers, key=lambda x: x.get('changesPercentage', 0) or 0, reverse=True)[:10]
        ]
        top_losers = [
            {"symbol": l.get('symbol', ''), "name": l.get('name', '')[:40],
             "change": l.get('changesPercentage', 0), "price": l.get('price', 0), "sector": l.get('sector', '')}
            for l in sorted(losers, key=lambda x: x.get('changesPercentage', 0) or 0)[:10]
        ]

        sector_rotation = {
            "hot": [{"sector": s, "gainers": d['g'], "losers": d['l']} for s, d in hot],
            "cold": [{"sector": s, "gainers": d['g'], "losers": d['l']} for s, d in cold],
        }

        return max(5, min(95, score)), signals, breadth_ratio, sector_rotation, top_gainers, top_losers

    def _data_staleness_factor(self, items: List[Dict]) -> float:
        """
        Check if data is stale (>1 day old). Returns a multiplier:
        1.0 = fresh data, 0.85 = stale (>1 day old).
        Uses '_fetch_date' metadata attached during fetch.
        """
        if not items:
            return 1.0
        sample = items[0]
        fetch_date_str = sample.get('_fetch_date', '')
        if not fetch_date_str:
            return 1.0  # No metadata, assume fresh
        try:
            fetch_date = datetime.strptime(fetch_date_str, '%Y-%m-%d')
            age_days = (datetime.now() - fetch_date).days
            if age_days > 1:
                logger.info(f"[MSE] Data staleness penalty: data is {age_days} days old (factor=0.85)")
                return 0.85
        except (ValueError, TypeError):
            pass
        return 1.0

    def _layer3_sectors(self, sectors):
        """Layer 3: Sector macro breadth and rotation."""
        if not sectors:
            return 50.0, [], 0.5, [], [], ["**LAYER 3 — SECTORS:** No data"]

        # Staleness penalty: reduce confidence if sector data is >1 day old
        staleness = self._data_staleness_factor(sectors)

        changes = [s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0 for s in sectors]
        up = [s for s, c in zip(sectors, changes) if c > 0]
        breadth = len(up) / len(sectors)
        avg_change = np.mean(changes)
        max_change = max(changes)
        min_change = min(changes)
        dispersion = max_change - min_change  # rotation strength

        score = 50 + (breadth - 0.5) * 80 + (avg_change * 12)
        # Apply staleness penalty: stale data pulls score toward neutral (50)
        if staleness < 1.0:
            score = 50 + (score - 50) * staleness
        score = max(5, min(95, score))

        hot = sorted([s for s in sectors if (s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0) > 0.3],
                     key=lambda x: x.get('averageChange', 0) or x.get('changesPercentage', 0) or 0, reverse=True)[:5]
        cold = sorted([s for s in sectors if (s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0) < -0.3],
                      key=lambda x: x.get('averageChange', 0) or x.get('changesPercentage', 0) or 0)[:5]

        signals = []
        if breadth >= 0.73:
            signals.append(MarketSignal("sector_breadth", "bullish", 0.85, 0.18,
                f"Broad sector strength: {len(up)}/{len(sectors)} green ({avg_change:+.2f}% avg)", emoji="📊"))
        elif breadth >= 0.60:
            signals.append(MarketSignal("sector_breadth", "bullish", 0.65, 0.12,
                f"Positive sector breadth: {len(up)}/{len(sectors)} green", emoji="📊"))
        elif breadth <= 0.27:
            signals.append(MarketSignal("sector_breadth", "bearish", 0.85, 0.18,
                f"Sector weakness: only {len(up)}/{len(sectors)} green ({avg_change:+.2f}% avg)", emoji="📊"))
        elif breadth <= 0.40:
            signals.append(MarketSignal("sector_breadth", "bearish", 0.65, 0.12,
                f"Negative sector breadth: {len(up)}/{len(sectors)} green", emoji="📊"))

        # Sector rotation speed
        if dispersion > 3.0:
            signals.append(MarketSignal("sector_rotation", "cautionary", 0.60, 0.06,
                f"High sector rotation (spread: {dispersion:.1f}%) — defensive/cyclical divergence", emoji="🔄"))

        # Defensive vs Cyclical
        defensive = ['Utilities', 'Consumer Defensive', 'Healthcare', 'Real Estate']
        cyclical = ['Technology', 'Consumer Cyclical', 'Industrials', 'Financial Services', 'Energy']
        def_change = np.mean([c for s, c in zip(sectors, changes) if any(d in (s.get('sector') or '') for d in defensive)] or [0])
        cyc_change = np.mean([c for s, c in zip(sectors, changes) if any(cy in (s.get('sector') or '') for cy in cyclical)] or [0])
        if cyc_change > def_change + 1.0:
            signals.append(MarketSignal("risk_on_rotation", "bullish", 0.70, 0.08,
                f"Risk-ON rotation: cyclicals {cyc_change:+.2f}% vs defensives {def_change:+.2f}%", emoji="🔥"))
        elif def_change > cyc_change + 1.0:
            signals.append(MarketSignal("risk_off_rotation", "bearish", 0.70, 0.08,
                f"Risk-OFF rotation: defensives {def_change:+.2f}% vs cyclicals {cyc_change:+.2f}%", emoji="🛡️"))

        # ── Semantic sector interpretation ────────────────────────────────
        hot_types = []
        cold_types = []
        for sector in hot[:5]:
            name = sector.get('sector', '')
            chg = sector.get('averageChange', 0) or sector.get('changesPercentage', 0) or 0
            for key, (stype, _) in self.SECTOR_SEMANTICS.items():
                if key.lower() in name.lower():
                    hot_types.append(stype)
                    break
        for sector in cold[:5]:
            name = sector.get('sector', '')
            for key, (stype, _) in self.SECTOR_SEMANTICS.items():
                if key.lower() in name.lower():
                    cold_types.append(stype)
                    break

        defensive_hot = hot_types.count('defensive')
        cyclical_hot = hot_types.count('cyclical') + hot_types.count('growth')
        defensive_cold = cold_types.count('defensive')
        cyclical_cold = cold_types.count('cyclical') + cold_types.count('growth')

        if defensive_hot >= 2 and cyclical_cold >= 1:
            signals.append(MarketSignal("defensive_bid", "bearish", 0.75, 0.10,
                "DEFENSIVE BID: Multiple safe-haven sectors leading — institutional risk-off positioning", emoji="🛡️"))
        elif cyclical_hot >= 2 and defensive_cold >= 1:
            signals.append(MarketSignal("cyclical_leadership", "bullish", 0.75, 0.10,
                "CYCLICAL LEADERSHIP: Growth & cyclical sectors dominating — genuine risk-on environment", emoji="🔥"))
        hot_energy = any('Energy' in (s.get('sector', '') or '') for s in hot[:3])
        if hot_energy and cyclical_hot < 2:
            signals.append(MarketSignal("energy_solo", "cautionary", 0.55, 0.05,
                "Energy rallying in isolation — possible inflation pressure or geopolitical tension", emoji="⛽"))

        reasoning = [f"**LAYER 3 — SECTORS ({len(sectors)}):** {len(up)}/{len(sectors)} green | avg {avg_change:+.2f}% | spread {dispersion:.1f}%"]
        if hot:
            hot_parts = [h.get('sector', '?') + ' ({:+.1f}%)'.format(h.get('averageChange', 0) or 0) for h in hot[:3]]
            reasoning.append(f"  Hot: {', '.join(hot_parts)}")
        if cold:
            cold_parts = [c.get('sector', '?') + ' ({:+.1f}%)'.format(c.get('averageChange', 0) or 0) for c in cold[:3]]
            reasoning.append(f"  Cold: {', '.join(cold_parts)}")

        # Add qualitative interpretation for top 3 hot sectors
        for sector in hot[:3]:
            name = sector.get('sector', '')
            chg = sector.get('averageChange', 0) or sector.get('changesPercentage', 0) or 0
            for key, (stype, desc) in self.SECTOR_SEMANTICS.items():
                if key.lower() in name.lower():
                    reasoning.append(f"  📌 {name} ({chg:+.1f}%): {desc}")
                    break

        rotation_summary = []
        if cyc_change > def_change + 0.5:
            rotation_summary.append(f"Cyclicals outperforming defensives by {cyc_change - def_change:.1f}% → risk-on rotation")
        elif def_change > cyc_change + 0.5:
            rotation_summary.append(f"Defensives outperforming cyclicals by {def_change - cyc_change:.1f}% → defensive rotation")
        if rotation_summary:
            reasoning.append("  🔄 " + rotation_summary[0])

        return score, signals, breadth, hot, cold, reasoning

    def _layer3b_industries(self, industries):
        """Layer 3b: Industry granular breadth."""
        if not industries:
            return 50.0, [], 0.5
        staleness = self._data_staleness_factor(industries)
        changes = [i.get('averageChange', 0) or i.get('changesPercentage', 0) or 0 for i in industries]
        up = [c for c in changes if c > 0]
        breadth = len(up) / len(industries)
        avg_change = np.mean(changes)
        score = 50 + (breadth - 0.5) * 70 + (avg_change * 8)
        if staleness < 1.0:
            score = 50 + (score - 50) * staleness
        score = max(5, min(95, score))

        signals = []
        if breadth >= 0.68:
            signals.append(MarketSignal("industry_breadth", "bullish", 0.72, 0.10,
                f"Broad industry participation: {len(up)}/{len(industries)} positive", emoji="🏭"))
        elif breadth <= 0.32:
            signals.append(MarketSignal("industry_breadth", "bearish", 0.72, 0.10,
                f"Industry weakness: only {len(up)}/{len(industries)} positive", emoji="🏭"))
        return score, signals, breadth

    def _layer4_indices(self, indices, yf_data: Dict = None):
        """Layer 4: Major indices analysis — S&P500, Dow, Nasdaq, Russell + Technical via yfinance."""
        yf_data = yf_data or {}
        if not indices and not yf_data:
            return 50.0, [], ["**LAYER 4 — INDICES:** No data available"], 0.0
        if not indices:
            indices = []

        # Exclude VIX from scoring (it's inverse)
        price_indices = [i for i in indices if 'VIX' not in (i.get('symbol', '') + i.get('name', ''))]
        if not price_indices:
            price_indices = indices

        changes = [i.get('changesPercentage', 0) or 0 for i in price_indices]
        up_count = sum(1 for c in changes if c > 0)
        avg_change = np.mean(changes) if changes else 0
        sp500_change = 0.0

        signals = []
        for idx in price_indices:
            sym = idx.get('symbol', '')
            change = idx.get('changesPercentage', 0) or 0
            price = idx.get('price', 0) or 0
            year_high = idx.get('yearHigh', 0) or 0
            year_low = idx.get('yearLow', 0) or 0

            if '^GSPC' in sym or 'SPX' in sym or 'SPY' in sym:
                sp500_change = change
                if year_high > 0 and price > 0:
                    pct_from_high = (price - year_high) / year_high * 100
                    if pct_from_high >= -2:
                        signals.append(MarketSignal("sp500_highs", "bullish", 0.85, 0.12,
                            f"S&P500 near 52-week high ({pct_from_high:+.1f}% from high)", emoji="🏔️"))
                    elif pct_from_high <= -15:
                        signals.append(MarketSignal("sp500_correction", "bearish", 0.85, 0.12,
                            f"S&P500 in correction ({pct_from_high:.1f}% from 52W high)", emoji="⛰️"))

            if abs(change) > 1.5:
                sig_type = "bullish" if change > 0 else "bearish"
                signals.append(MarketSignal("index", sig_type, min(0.90, abs(change) / 3),
                    0.08, f"{sym}: {change:+.2f}%", emoji="📈" if change > 0 else "📉"))

        # Nasdaq vs Russell divergence (growth vs small cap)
        nasdaq_change = next((i.get('changesPercentage', 0) or 0 for i in price_indices if '^IXIC' in (i.get('symbol', '') or '')), None)
        russell_change = next((i.get('changesPercentage', 0) or 0 for i in price_indices if '^RUT' in (i.get('symbol', '') or '')), None)
        if nasdaq_change is not None and russell_change is not None:
            if nasdaq_change > russell_change + 1.5:
                signals.append(MarketSignal("growth_dominance", "neutral", 0.60, 0.05,
                    f"Growth (Nasdaq {nasdaq_change:+.1f}%) outpacing small caps (Russell {russell_change:+.1f}%) — narrow rally", emoji="💻"))
            elif russell_change > nasdaq_change + 1.5:
                signals.append(MarketSignal("small_cap_leadership", "bullish", 0.70, 0.07,
                    f"Small caps leading (Russell {russell_change:+.1f}% vs Nasdaq {nasdaq_change:+.1f}%) — broad risk-on", emoji="🏃"))

        score = 50 + (up_count / max(len(price_indices), 1) - 0.5) * 70 + (avg_change * 10)
        score = max(5, min(95, score))

        reasoning = [f"**LAYER 4 — INDICES:** {up_count}/{len(price_indices)} green | avg {avg_change:+.2f}%"]
        for idx in price_indices[:5]:
            reasoning.append(f"  {idx.get('symbol','?')}: {idx.get('changesPercentage', 0) or 0:+.2f}%")

        # ── yfinance Technical Analysis ─────────────────────────────────
        if yf_data:
            reasoning.append("**LAYER 4b — TECHNICAL ANALYSIS (yfinance):**")
            spy = yf_data.get('spy', {})
            qqq = yf_data.get('qqq', {})
            iwm = yf_data.get('iwm', {})
            tnx = yf_data.get('tnx', {})

            if spy:
                price = spy.get('price', 0)
                ma50 = spy.get('ma50')
                ma200 = spy.get('ma200')
                rsi = spy.get('rsi', 50)
                pct_high = spy.get('pct_from_high', 0)
                reasoning.append(f"  SPY ${price:.2f} | RSI={rsi:.0f}"
                    + (f" | vs 50DMA ${ma50:.0f} ({'✅ ABOVE' if price > ma50 else '❌ BELOW'})" if ma50 else "")
                    + (f" | vs 200DMA ${ma200:.0f} ({'🐂 BULL' if price > ma200 else '🐻 BEAR'})" if ma200 else ""))
                if ma200:
                    if price > ma200 * 1.002:
                        signals.append(MarketSignal("spy_above_200dma", "bullish", 0.82, 0.14,
                            f"SPY ${price:.0f} ABOVE 200DMA ${ma200:.0f} — Secular bull market regime confirmed", emoji="🐂"))
                        if price > ma50 * 1.002 and ma50 > ma200:
                            signals.append(MarketSignal("golden_cross_intact", "bullish", 0.70, 0.08,
                                f"50DMA ${ma50:.0f} > 200DMA ${ma200:.0f} — Golden Cross structure intact", emoji="⭐"))
                    else:
                        signals.append(MarketSignal("spy_below_200dma", "bearish", 0.88, 0.16,
                            f"SPY ${price:.0f} BELOW 200DMA ${ma200:.0f} — Bear market risk elevated, reduce exposure", emoji="🐻"))
                        if ma50 < ma200:
                            signals.append(MarketSignal("death_cross", "bearish", 0.80, 0.10,
                                f"Death Cross: 50DMA ${ma50:.0f} < 200DMA ${ma200:.0f} — Bearish long-term structure", emoji="💀"))

                if rsi >= 75:
                    signals.append(MarketSignal("spy_rsi_overbought", "cautionary", 0.75, 0.08,
                        f"SPY RSI={rsi:.0f} — Extreme overbought, high pullback risk", emoji="🔴"))
                    reasoning.append(f"  ⚠️ SPY RSI={rsi:.0f} — Overbought (>75), contrarian caution advised")
                elif rsi >= 65:
                    reasoning.append(f"  ⚠️ SPY RSI={rsi:.0f} — Elevated, monitor for distribution")
                elif rsi <= 28:
                    signals.append(MarketSignal("spy_rsi_oversold", "bullish", 0.78, 0.10,
                        f"SPY RSI={rsi:.0f} — Deeply oversold, mean reversion opportunity", emoji="💚"))
                    reasoning.append(f"  ✅ SPY RSI={rsi:.0f} — Oversold (<30), high mean reversion probability")
                elif rsi <= 40:
                    reasoning.append(f"  ✅ SPY RSI={rsi:.0f} — Approaching oversold territory")
                else:
                    reasoning.append(f"  ✅ SPY RSI={rsi:.0f} — Healthy momentum range")

                if pct_high <= -20:
                    signals.append(MarketSignal("bear_market_confirmed", "bearish", 0.90, 0.12,
                        f"SPY in bear market territory: {pct_high:.1f}% from 52W high", emoji="🔻"))
                elif pct_high <= -10:
                    signals.append(MarketSignal("correction_zone", "bearish", 0.65, 0.07,
                        f"SPY correction: {pct_high:.1f}% from 52W high", emoji="📉"))
                elif pct_high >= -2:
                    signals.append(MarketSignal("new_highs_territory", "bullish", 0.72, 0.07,
                        f"SPY near 52W high ({pct_high:.1f}%) — strong momentum", emoji="🏔️"))

            if qqq and iwm:
                qqq_chg = qqq.get('change_1d', 0)
                iwm_chg = iwm.get('change_1d', 0)
                qqq_rsi = qqq.get('rsi', 50)
                iwm_rsi = iwm.get('rsi', 50)
                reasoning.append(f"  QQQ (Nasdaq-100): {qqq_chg:+.2f}% | RSI={qqq_rsi:.0f}")
                reasoning.append(f"  IWM (Russell 2000): {iwm_chg:+.2f}% | RSI={iwm_rsi:.0f}")
                if iwm_chg > qqq_chg + 0.8:
                    signals.append(MarketSignal("small_cap_leadership", "bullish", 0.68, 0.07,
                        f"Small caps (IWM {iwm_chg:+.1f}%) > Nasdaq (QQQ {qqq_chg:+.1f}%) — broad risk-on rally", emoji="🏃"))
                    reasoning.append("  ✅ Small-cap leadership confirms broad risk appetite (not just mega-cap driven)")
                elif qqq_chg > iwm_chg + 1.5:
                    reasoning.append("  ⚠️ Narrow rally: Mega-cap tech leading, small caps lagging — watch for breadth divergence")

            if tnx:
                tnx_price = tnx.get('price', 0)
                tnx_chg = tnx.get('change_1d', 0)
                tnx_rsi = tnx.get('rsi', 50)
                reasoning.append(f"  10Y Treasury Yield: {tnx_price:.2f}% ({tnx_chg:+.3f}% today | RSI={tnx_rsi:.0f})")
                if tnx_chg > 0.04:
                    signals.append(MarketSignal("yields_rising", "bearish", 0.58, 0.06,
                        f"10Y yield rising to {tnx_price:.2f}% — higher cost of capital pressures growth valuations", emoji="📈💰"))
                    reasoning.append(f"  ⚠️ Rising yields ({tnx_price:.2f}%) = pressure on growth/tech multiples & REIT sector")
                elif tnx_chg < -0.04:
                    signals.append(MarketSignal("yields_falling", "bullish", 0.55, 0.05,
                        f"10Y yield falling to {tnx_price:.2f}% — rate relief for equities & growth stocks", emoji="📉💰"))
                    reasoning.append(f"  ✅ Falling yields ({tnx_price:.2f}%) = positive for growth/tech multiples & dividend stocks")
                if tnx_price > 5.0:
                    reasoning.append(f"  🔴 Yield at {tnx_price:.2f}% — historically high level competes with equity risk premium")
                elif tnx_price < 3.5:
                    reasoning.append(f"  🟢 Yield at {tnx_price:.2f}% — supportive for equity valuations (TINA regime)")

            # Score adjustment based on technical regime
            spy_above_200 = spy and spy.get('ma200') and spy.get('price', 0) > spy.get('ma200', 0)
            spy_rsi_val = spy.get('rsi', 50) if spy else 50
            if spy_above_200 and spy_rsi_val < 70:
                score = min(95, score * 1.05)  # Bull regime bonus
            elif not spy_above_200:
                score = max(5, score * 0.90)  # Bear regime penalty

        return score, signals, reasoning, sp500_change

    def _layer5_vix(self, vix_quote, indices) -> Tuple[float, List[MarketSignal], float, List[str]]:
        """Layer 5: VIX Volatility Regime — fear thermometer."""
        vix_val = 0.0
        if vix_quote:
            vix_val = vix_quote.get('price', 0) or vix_quote.get('bid', 0) or 0
        if not vix_val and indices:
            for i in indices:
                if 'VIX' in (i.get('symbol', '') + i.get('name', '')):
                    vix_val = i.get('price', 0) or 0
                    break

        if not vix_val:
            return 50.0, [], 0.0, ["**LAYER 5 — VIX:** No VIX data available"]

        vix_change = 0.0
        if vix_quote:
            vix_change = vix_quote.get('changesPercentage', 0) or 0

        signals = []
        regime_label = self._vix_regime_label(vix_val)

        if vix_val < 12:
            score = 80.0
            signals.append(MarketSignal("vix_regime", "bullish", 0.85, 0.15,
                f"VIX={vix_val:.1f} — Extreme Complacency (ultra-low fear)", emoji="😴"))
        elif vix_val < 16:
            score = 72.0
            signals.append(MarketSignal("vix_regime", "bullish", 0.75, 0.13,
                f"VIX={vix_val:.1f} — Low Volatility regime (calm market)", emoji="🟢"))
        elif vix_val < 20:
            score = 62.0
            signals.append(MarketSignal("vix_regime", "bullish", 0.60, 0.10,
                f"VIX={vix_val:.1f} — Normal volatility (stable environment)", emoji="🟡"))
        elif vix_val < 25:
            score = 48.0
            signals.append(MarketSignal("vix_regime", "neutral", 0.55, 0.10,
                f"VIX={vix_val:.1f} — Elevated volatility (some uncertainty)", emoji="🟠"))
        elif vix_val < 30:
            score = 35.0
            signals.append(MarketSignal("vix_regime", "bearish", 0.75, 0.14,
                f"VIX={vix_val:.1f} — High Fear zone — market stress", emoji="🔴"))
        elif vix_val < 40:
            score = 20.0
            signals.append(MarketSignal("vix_spike", "bearish", 0.90, 0.18,
                f"VIX={vix_val:.1f} — FEAR SPIKE — panic conditions", emoji="😱"))
        else:
            score = 8.0
            signals.append(MarketSignal("vix_extreme", "bearish", 0.98, 0.20,
                f"VIX={vix_val:.1f} — EXTREME FEAR — market dislocation (possible capitulation)", emoji="🆘"))

        # VIX direction
        if vix_change > 8:
            signals.append(MarketSignal("vix_surging", "bearish", 0.80, 0.10,
                f"VIX surging +{vix_change:.1f}% — fear accelerating", emoji="⬆️"))
        elif vix_change > 4:
            signals.append(MarketSignal("vix_rising", "bearish", 0.60, 0.07,
                f"VIX rising +{vix_change:.1f}% — increasing concern", emoji="📈"))
        elif vix_change < -8:
            signals.append(MarketSignal("vix_falling", "bullish", 0.80, 0.10,
                f"VIX falling {vix_change:.1f}% — fear subsiding rapidly", emoji="⬇️"))
        elif vix_change < -4:
            signals.append(MarketSignal("vix_easing", "bullish", 0.60, 0.07,
                f"VIX easing {vix_change:.1f}% — market calming", emoji="📉"))

        reasoning = [f"**LAYER 5 — VIX REGIME:** {vix_val:.1f} ({regime_label}) | change: {vix_change:+.1f}%"]

        return score, signals, vix_val, reasoning

    def _layer6_forex(self, forex) -> Tuple[float, List[MarketSignal], List[str]]:
        """Layer 6: Forex risk — USD strength/weakness as risk-on/off proxy."""
        if not forex:
            return 50.0, [], ["**LAYER 6 — FOREX:** No data available"]

        # Find USD pairs - handle different formats from FMP /stable/fx
        usd_pairs = []
        for fx in forex:
            ticker = fx.get('ticker', '') or fx.get('symbol', '') or fx.get('name', '')
            if 'USD' in ticker.upper():
                change = fx.get('changesPercentage', None) or fx.get('changes', None) or fx.get('change', None)
                if change is not None:
                    try:
                        usd_pairs.append({'ticker': ticker, 'change': float(change)})
                    except (ValueError, TypeError):
                        pass

        if not usd_pairs:
            return 50.0, [], ["**LAYER 6 — FOREX:** USD pairs found but no change data"]

        # Pairs where USD is BASE (e.g., USDEUR) = USD strengthening when positive
        # Pairs where USD is QUOTE (e.g., EURUSD) = USD weakening when positive
        usd_base = [p['change'] for p in usd_pairs if p['ticker'].upper().startswith('USD')]
        usd_quote = [-p['change'] for p in usd_pairs if not p['ticker'].upper().startswith('USD')]
        all_usd = usd_base + usd_quote

        avg_usd_strength = np.mean(all_usd) if all_usd else 0.0

        # Strong USD = capital fleeing to safety (bearish for risk assets)
        score = 50 - (avg_usd_strength * 8)
        score = max(15, min(85, score))

        signals = []
        if avg_usd_strength > 0.5:
            signals.append(MarketSignal("forex_usd", "bearish", min(0.85, avg_usd_strength * 0.5),
                0.06, f"USD strengthening ({avg_usd_strength:+.2f}%) — risk-off signal", emoji="💵↑"))
        elif avg_usd_strength > 0.2:
            signals.append(MarketSignal("forex_usd", "bearish", 0.45, 0.04,
                f"USD mildly strong ({avg_usd_strength:+.2f}%)", emoji="💵"))
        elif avg_usd_strength < -0.5:
            signals.append(MarketSignal("forex_usd", "bullish", min(0.85, abs(avg_usd_strength) * 0.5),
                0.06, f"USD weakening ({avg_usd_strength:+.2f}%) — risk-on signal", emoji="💵↓"))
        elif avg_usd_strength < -0.2:
            signals.append(MarketSignal("forex_usd", "bullish", 0.45, 0.04,
                f"USD mildly weak ({avg_usd_strength:+.2f}%)", emoji="💵"))

        mode = "RISK-OFF" if avg_usd_strength > 0.2 else "RISK-ON" if avg_usd_strength < -0.2 else "NEUTRAL"
        reasoning = [f"**LAYER 6 — FOREX:** USD {avg_usd_strength:+.2f}% → {mode} ({len(usd_pairs)} USD pairs)"]

        return score, signals, reasoning

    def _layer7_fear_greed(self, news_score, breadth_ratio, vix_val, sector_breadth,
                           industry_breadth, sp500_change, sector_score, index_score):
        """Layer 7: Fear & Greed composite index (0=Extreme Fear, 100=Extreme Greed)."""
        # Weighted components
        components = {
            'market_breadth': (breadth_ratio * 100, 0.25),         # breadth
            'news_sentiment': (news_score, 0.20),                    # news
            'sector_breadth': (sector_breadth * 100, 0.15),         # sector health
            'industry_breadth': (industry_breadth * 100, 0.10),     # industry health
            'price_momentum': (50 + sp500_change * 5, 0.15),        # S&P momentum
            'sector_strength': (sector_score, 0.15),                 # overall sector score
        }

        # Invert VIX contribution (high VIX = fear)
        if vix_val:
            vix_fear = max(0, min(100, 100 - (vix_val - 10) * 3))
            components['vix_fear'] = (vix_fear, 0.15)
            # Reduce other weights
            for k in components:
                components[k] = (components[k][0], components[k][1] * 0.85)

        total_w = sum(w for _, w in components.values())
        fg_score = sum(v * w for v, w in components.values()) / total_w
        fg_score = max(0, min(100, fg_score))

        if fg_score >= 75:
            label = "Extreme Greed"
        elif fg_score >= 60:
            label = "Greed"
        elif fg_score >= 45:
            label = "Neutral"
        elif fg_score >= 30:
            label = "Fear"
        else:
            label = "Extreme Fear"

        signals = []
        if fg_score >= 80:
            signals.append(MarketSignal("fear_greed", "cautionary", 0.80, 0.08,
                f"Fear & Greed = {fg_score:.0f} (Extreme Greed) — contrarian caution warranted", emoji="🤑"))
        elif fg_score >= 65:
            signals.append(MarketSignal("fear_greed", "bullish", 0.70, 0.07,
                f"Fear & Greed = {fg_score:.0f} (Greed) — positive sentiment dominates", emoji="😀"))
        elif fg_score <= 20:
            signals.append(MarketSignal("fear_greed", "bullish", 0.75, 0.10,
                f"Fear & Greed = {fg_score:.0f} (Extreme Fear) — contrarian BUY signal", emoji="😱→📈"))
        elif fg_score <= 35:
            signals.append(MarketSignal("fear_greed", "bearish", 0.70, 0.07,
                f"Fear & Greed = {fg_score:.0f} (Fear) — risk-off dominant", emoji="😨"))

        reasoning = [f"**LAYER 7 — FEAR & GREED:** {fg_score:.0f}/100 — {label}"]

        return fg_score, label, signals, reasoning

    def _layer8_fusion(self, news, movers, sectors, ind, idx, vix, fx, fg,
                       br, sb, vix_val):
        """Layer 8: Neural fusion with divergence detection, cross-correlation, and uncertainty estimation."""
        # Dynamic weights based on data quality
        w = {
            'news': 0.28,
            'movers': 0.20,
            'sectors': 0.16 if sectors != 50 else 0.05,
            'ind': 0.08 if ind != 50 else 0.02,
            'idx': 0.12 if idx != 50 else 0.03,
            'vix': 0.10 if vix != 50 else 0.01,
            'fx': 0.04,
            'fg': 0.06,
        }
        total_w = sum(w.values())
        composite = (
            news * w['news'] + movers * w['movers'] + sectors * w['sectors'] +
            ind * w['ind'] + idx * w['idx'] + vix * w['vix'] + fx * w['fx'] + fg * w['fg']
        ) / total_w

        # === UNCERTAINTY ESTIMATION ===
        # Compute std dev across layer scores; high disagreement = low confidence
        layer_scores = [news, movers, sectors, ind, idx, vix, fx, fg]
        score_std = float(np.std(layer_scores))
        score_mean = float(np.mean(layer_scores))
        # Confidence interval: std > 20 = high disagreement → pull toward neutral
        confidence = max(0.3, 1.0 - (score_std - 10) / 40)  # 1.0 at std=10, 0.55 at std=28
        confidence = min(1.0, confidence)

        reasoning = ["**LAYER 8 — NEURAL FUSION + CROSS-CORRELATION:**"]
        reasoning.append(f"  Layer std={score_std:.1f} | confidence={confidence:.2f} | raw composite={composite:.1f}")

        # Apply uncertainty: high disagreement pulls composite toward neutral 50
        if score_std > 15:
            composite = 50 + (composite - 50) * confidence
            reasoning.append(f"  ⚠️ High inter-layer disagreement (σ={score_std:.1f}) → confidence-adjusted composite={composite:.1f}")

        # === DIVERGENCE PATTERNS ===
        # Pattern 1: News pumping but breadth poor
        if news > 65 and br < 0.40:
            reasoning.append("⚠️ DIVERGENCE: Bullish news BUT narrow breadth → possible bull trap / momentum divergence")
            composite *= 0.91
        # Pattern 2: Bearish news but strong breadth
        if news < 35 and br > 0.60:
            reasoning.append("💡 DIVERGENCE: Bearish headlines BUT market participation strong → oversold bounce likely")
            composite *= 1.09
        # Pattern 3: News+sectors bullish but indices weak
        if news > 62 and sectors > 57 and idx < 42:
            reasoning.append("⚠️ DIVERGENCE: News & sectors bullish BUT indices weak → rotation without leadership")
            composite *= 0.95
        # Pattern 4: VIX elevated despite bullish sentiment
        if vix_val and vix_val > 22 and composite > 60:
            reasoning.append("⚠️ DIVERGENCE: Bullish score BUT elevated VIX → hedging demand signals uncertainty")
            composite *= 0.93
        # Pattern 5: VIX falling + broad breadth = strong buy
        if vix_val and vix_val < 18 and br > 0.60 and sectors > 58:
            reasoning.append("✅ ALIGNMENT: Low VIX + broad breadth + strong sectors → high-conviction bullish")
            composite *= 1.04
        # Pattern 6: News bullish + VIX rising = Complacency risk
        if news > 60 and vix_val and vix_val > 20 and vix > 55:
            reasoning.append("⚠️ COMPLACENCY RISK: Bullish news BUT VIX rising → market may be underpricing risk")
            composite *= 0.95
        # Pattern 7: Sectors rotating to defensives + indices flat = Hidden distribution
        if sb > 0.5 and sectors < 48 and 45 < idx < 55:
            reasoning.append("⚠️ HIDDEN DISTRIBUTION: Defensive rotation with flat indices → institutional selling beneath the surface")
            composite *= 0.93
        # Pattern 8: Forex risk-off + breadth strong = divergence
        if fx > 58 and br > 0.58:
            reasoning.append("⚠️ DIVERGENCE: USD strengthening (risk-off) BUT breadth strong → mixed macro signals, watch for resolution")
        # Pattern 9: All layers bearish alignment = high conviction sell
        bearish_layers = sum(1 for s in [news, movers, sectors, idx, vix] if s < 40)
        if bearish_layers >= 4 and composite < 35:
            reasoning.append("🔴 MULTI-LAYER BEARISH ALIGNMENT: 4+ layers bearish → high-conviction risk-off")
            composite *= 0.95
        # Pattern 10: Fear & Greed extreme + VIX spike = capitulation signal
        if fg < 20 and vix_val and vix_val > 30:
            reasoning.append("💡 CAPITULATION SIGNAL: Extreme Fear + VIX spike → contrarian bottom watch (but confirm with breadth reversal)")

        # === CROSS-CORRELATION PATTERNS ===
        if composite > 70 and idx > 60 and fx < 48 and br > 0.60:
            reasoning.append("✅ TRIPLE LOCK: Index strength + risk-on forex + broad breadth → premium bull signal")
        elif composite < 35 and idx < 42 and fx > 54 and vix_val and vix_val > 25:
            reasoning.append("🔴 RISK-OFF LOCK: Weak indices + strong USD + high VIX → defensive mode confirmed")
        elif br > 0.55 and sectors < 45:
            reasoning.append("⚠️ SECTOR/BREADTH GAP: Movers advancing but sectors weak → quality leadership thin")

        # === BREADTH CONFIRMATION ===
        if composite > 60 and br < 0.42:
            reasoning.append("⚠️ NARROWING RALLY: Score bullish but market participation thin → fragile")
            composite *= 0.94
        elif composite < 40 and br > 0.58:
            reasoning.append("💡 SELLING MAY BE OVERDONE: Breadth decent despite bearish score")
            composite *= 1.06

        composite = max(3, min(97, composite))
        reasoning.append(f"  Final composite: {composite:.1f}/100 (confidence: {confidence:.0%}, σ={score_std:.1f})")

        return composite, reasoning

    # ====================== CONCLUSION + LABELS ======================

    def _vix_regime_label(self, vix_val) -> str:
        if not vix_val:
            return "Unknown"
        if vix_val < 12: return "Extreme Complacency"
        if vix_val < 16: return "Low Volatility"
        if vix_val < 20: return "Normal"
        if vix_val < 25: return "Elevated"
        if vix_val < 30: return "High Fear"
        if vix_val < 40: return "Fear Spike"
        return "Extreme Dislocation"

    def _breadth_label(self, ratio: float) -> str:
        if ratio >= 0.72: return "Extreme Breadth"
        if ratio >= 0.60: return "Positive"
        if ratio >= 0.45: return "Neutral"
        if ratio >= 0.32: return "Negative"
        return "Extreme Weakness"

    def _generate_conclusion(self, composite, vix_val, breadth_ratio):
        # Adjust for VIX regime
        vix_regime = ""
        if vix_val:
            if vix_val > 35 and composite > 50:
                composite = min(composite, 50)  # cap at neutral in crisis
                vix_regime = " | High VIX caution"
            elif vix_val < 14 and composite < 60:
                composite = max(composite, 45)  # floor at near-neutral in ultra-calm markets

        if composite >= 80:
            return ("BULL MARKET — FULL RISK ON", "🚀", "very_bullish",
                    f"All neural layers aligned bullish. Maximum conviction{vix_regime}.",
                    "AGGRESSIVE BUY: Add to winners, focus on hot sectors & momentum plays. Tight 2% stops.")
        elif composite >= 67:
            return ("BULLISH — SOLID MOMENTUM", "📈", "bullish",
                    f"Market on the offensive with broad participation{vix_regime}.",
                    "GO LONG: Rotate into strength. Sector leaders and breakouts. Monitor VIX for regime shift.")
        elif composite >= 54:
            return ("NEUTRAL — MIXED SIGNALS", "⚖️", "neutral",
                    f"Balanced data — no clear directional conviction{vix_regime}.",
                    "SELECTIVE: Quality over quantity. 30-40% cash buffer. Wait for volume confirmation.")
        elif composite >= 40:
            return ("BEARISH — SELLING PRESSURE", "📉", "bearish",
                    f"Macro deteriorating. Reduce risk exposure{vix_regime}.",
                    "REDUCE: Trim longs 30-50%. Sector rotation to defensives. Hedge with inverse ETFs.")
        elif composite >= 25:
            return ("RISK OFF — DEFENSIVE MODE", "🛡️", "very_bearish",
                    f"Bear market conditions emerging. Capital preservation{vix_regime}.",
                    "SELL: Move 60%+ to cash/bonds. Wait for VIX<25 and breadth>55% before re-entering.")
        else:
            return ("EXTREME FEAR — POSSIBLE CAPITULATION", "🆘", "very_bearish",
                    f"Panic conditions. Maximum fear = possible contrarian bottom{vix_regime}.",
                    "SURVIVE FIRST: 80%+ cash. Watch for VIX spike + reversal as capitulation signal → aggressive re-entry.")

    def _generate_briefing(self, composite, news_score, movers_score, breadth,
                           sector_rotation, recommendation, gainers_count, losers_count,
                           hot_sectors, cold_sectors, action, vix_val, fg_score, fg_label,
                           language: str = 'en') -> str:
        parts = []
        es = (language == 'es')

        if composite >= 75:
            parts.append(f"🚀 {'Mercado en **modo alcista fuerte**' if es else 'Market in **strong bullish mode**'} ({'puntuación neural' if es else 'neural score'}: {composite:.0f}/100).")
        elif composite >= 58:
            parts.append(f"📈 **{'Mercado positivo' if es else 'Positive market'}** {'con amplia participación' if es else 'with solid participation'} ({'puntuación' if es else 'score'}: {composite:.0f}/100).")
        elif composite >= 47:
            parts.append(f"⚖️ **{'Señales mixtas' if es else 'Mixed signals'}** — {'el mercado carece de dirección clara' if es else 'market lacks clear direction'} ({'puntuación' if es else 'score'}: {composite:.0f}/100).")
        elif composite >= 35:
            parts.append(f"📉 **{'Mercado bajo presión' if es else 'Market under pressure'}** — {'postura defensiva recomendada' if es else 'defensive posture recommended'} ({'puntuación' if es else 'score'}: {composite:.0f}/100).")
        else:
            parts.append(f"🔻 **{'Presión vendedora dominante' if es else 'Dominant selling pressure'}** — {'extrema cautela' if es else 'extreme caution'} ({'puntuación' if es else 'score'}: {composite:.0f}/100).")

        if es:
            parts.append(f"Amplitud: {breadth:.0%} avanzando ({gainers_count} ganadores vs {losers_count} perdedores).")
        else:
            parts.append(f"Breadth: {breadth:.0%} advancing ({gainers_count} gainers vs {losers_count} losers).")

        if vix_val:
            vix_regime = self._vix_regime_label(vix_val)
            if es:
                vix_labels_es = {
                    'Extreme Complacency': 'Complacencia Extrema', 'Low Volatility': 'Baja Volatilidad',
                    'Normal': 'Normal', 'Elevated': 'Elevada', 'High Fear': 'Alto Miedo',
                    'Fear Spike': 'Pico de Miedo', 'Extreme Dislocation': 'Dislocación Extrema',
                }
                vix_regime_str = vix_labels_es.get(vix_regime, vix_regime)
                parts.append(f"VIX en {vix_val:.1f} ({vix_regime_str}).")
            else:
                parts.append(f"VIX at {vix_val:.1f} ({vix_regime}).")

        if es:
            fg_labels_es = {
                'Extreme Greed': 'Codicia Extrema', 'Greed': 'Codicia', 'Neutral': 'Neutral',
                'Fear': 'Miedo', 'Extreme Fear': 'Miedo Extremo',
            }
            fg_label_str = fg_labels_es.get(fg_label, fg_label)
            parts.append(f"Índice Miedo & Codicia: **{fg_score:.0f}/100** ({fg_label_str}).")
        else:
            parts.append(f"Fear & Greed Index: **{fg_score:.0f}/100** ({fg_label}).")

        if news_score >= 65:
            parts.append("Flujo de noticias predominantemente positivo." if es else "News flow predominantly positive.")
        elif news_score <= 35:
            parts.append("Flujo de noticias refleja cautela o negatividad." if es else "News flow reflects caution or negativity.")

        hot = sector_rotation.get('hot', [])
        cold = sector_rotation.get('cold', [])
        if hot:
            parts.append(f"{'Sectores calientes' if es else 'Hot sectors'}: {', '.join([s['sector'] for s in hot[:2]])}.")
        if cold:
            parts.append(f"{'Sectores fríos' if es else 'Cold sectors'}: {', '.join([s['sector'] for s in cold[:2]])}.")

        if action:
            parts.append(f"**{'Acción' if es else 'Action'}:** {action}")

        return " ".join(parts)


# Global singleton
market_sentiment_engine = NeuralReasoningMarketSentimentEngine()
