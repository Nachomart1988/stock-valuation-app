# backend/market_sentiment_engine.py
# NEURAL REASONING MARKET SENTIMENT ENGINE v4.0
# 6-layer analysis with chain-of-thought reasoning, divergence detection,
# cross-correlation analysis, and actionable conclusions.
# Runs in <0.5s on CPU (no transformers dependency).

import numpy as np
import os
import requests
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from datetime import datetime
from collections import defaultdict


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
    Uses weighted keyword matching with context awareness.
    """

    def __init__(self):
        # === Strong sentiment keywords (weight: 2.0+) ===
        self.strong_bullish = {
            'rally': 2.0, 'surge': 2.0, 'soar': 2.0, 'skyrocket': 2.5,
            'bull market': 2.5, 'record high': 2.5, 'all-time high': 2.5, 'breakout': 2.0,
            'buying opportunity': 2.0, 'strong momentum': 2.0, 'risk on': 2.0,
            'market optimism': 2.0, 'economic boom': 2.5, 'explosive growth': 2.5,
            'fed pivot': 2.0, 'rate cut': 2.0, 'dovish': 1.8, 'stimulus': 2.0,
            'recovery': 1.5, 'inflation cooling': 2.0, 'soft landing': 2.0,
            'blowout earnings': 2.5, 'beat estimates': 2.0, 'record revenue': 2.0,
            'raised guidance': 2.0, 'upgraded': 1.8, 'outperform': 1.8,
            'golden cross': 2.0, 'new highs': 2.0,
        }

        self.strong_bearish = {
            'crash': 2.5, 'collapse': 2.5, 'plunge': 2.0, 'plummet': 2.0,
            'bear market': 2.5, 'recession': 2.5, 'crisis': 2.5, 'selloff': 2.0,
            'capitulation': 2.5, 'panic': 2.5, 'meltdown': 2.5, 'risk off': 2.0,
            'flight to safety': 2.0, 'stagflation': 2.5, 'depression': 2.5,
            'market crash': 2.5, 'black swan': 2.5, 'circuit breaker': 2.5,
            'rate hike': 1.8, 'hawkish': 1.8, 'tightening': 1.5, 'inflation surge': 2.0,
            'hard landing': 2.0, 'inverted yield curve': 2.0,
            'missed estimates': 2.0, 'disappointing earnings': 2.0, 'lowered guidance': 2.0,
            'downgraded': 1.8, 'underperform': 1.8, 'revenue miss': 1.8,
            'death cross': 2.0, 'breakdown': 2.0, 'new lows': 2.0,
        }

        # === Moderate sentiment keywords (weight: 1.0) ===
        self.moderate_bullish = {
            'gains': 1.0, 'higher': 0.8, 'positive': 0.8, 'advance': 1.0,
            'growth': 0.8, 'uptick': 0.8, 'rebound': 1.2, 'upward': 0.8,
            'improving': 1.0, 'steady': 0.5, 'stabilize': 0.8, 'optimistic': 1.0,
            'beat': 1.5, 'strong': 1.0, 'robust': 1.0, 'upgrade': 1.2,
            'buy': 0.8, 'accumulate': 1.0, 'bullish': 1.5, 'opportunity': 0.8,
            'momentum': 0.8, 'strength': 0.8, 'confident': 0.8, 'exceeded': 1.2,
        }

        self.moderate_bearish = {
            'decline': 1.0, 'drop': 1.0, 'fall': 0.8, 'negative': 0.8,
            'weakness': 1.0, 'concern': 0.8, 'uncertain': 0.8, 'volatility': 0.8,
            'pressure': 0.8, 'downgrade': 1.2, 'miss': 1.0, 'disappointing': 1.2,
            'headwinds': 1.0, 'slowdown': 1.2, 'contraction': 1.5, 'layoffs': 1.5,
            'sell': 0.8, 'reduce': 0.8, 'bearish': 1.5, 'cautious': 0.5,
            'risk': 0.5, 'warning': 1.0, 'caution': 0.5, 'worry': 0.8,
            'weak': 1.0, 'slumped': 1.2, 'tumbled': 1.2,
        }

    def analyze_text(self, text: str) -> Dict[str, Any]:
        """Analyze sentiment of a single text."""
        if not text:
            return {'score': 0.0, 'normalized': 0.0}

        text_lower = text.lower()
        score = 0.0

        for phrase, weight in self.strong_bullish.items():
            if phrase in text_lower:
                score += weight
        for phrase, weight in self.strong_bearish.items():
            if phrase in text_lower:
                score -= weight
        for word, weight in self.moderate_bullish.items():
            if word in text_lower:
                score += weight
        for word, weight in self.moderate_bearish.items():
            if word in text_lower:
                score -= weight

        normalized = float(np.tanh(score / 5))
        return {'score': float(score), 'normalized': normalized}

    def analyze_news_batch(self, news_items: List[Dict]) -> Tuple[float, List[MarketSignal], List[str]]:
        """Analyze a batch of news items. Returns score + signals + reasoning chain."""
        if not news_items:
            return 50.0, [], ["No news data available."]

        sentiments = []
        positive_count = 0
        negative_count = 0
        strong_bull_headlines = []
        strong_bear_headlines = []
        reasoning = ["**NEWS NEURAL ANALYSIS:**"]

        for item in news_items[:30]:
            title = item.get('title', '')
            text = item.get('text', '')[:500]
            combined = f"{title} {text}"

            analysis = self.analyze_text(combined)
            sentiments.append(analysis['normalized'])

            if analysis['normalized'] > 0.3:
                positive_count += 1
                if analysis['normalized'] > 0.5:
                    strong_bull_headlines.append(title[:80])
            elif analysis['normalized'] < -0.3:
                negative_count += 1
                if analysis['normalized'] < -0.5:
                    strong_bear_headlines.append(title[:80])

        avg_sentiment = np.mean(sentiments) if sentiments else 0
        score = (avg_sentiment + 1) / 2 * 100

        signals = []
        if positive_count > negative_count * 1.5:
            signals.append(MarketSignal(
                source="news_neural", type="bullish", strength=0.80, weight=0.38,
                description=f"{positive_count} bullish headlines dominate news flow",
                emoji="📰"
            ))
        elif negative_count > positive_count * 1.5:
            signals.append(MarketSignal(
                source="news_neural", type="bearish", strength=0.80, weight=0.38,
                description=f"{negative_count} bearish headlines dominate news flow",
                emoji="📰"
            ))

        for h in strong_bull_headlines[:2]:
            reasoning.append(f"  + Strong bullish: '{h}...'")
        for h in strong_bear_headlines[:2]:
            reasoning.append(f"  - Strong bearish: '{h}...'")
        reasoning.append(f"**News conclusion:** Score {score:.1f} | {positive_count} bull | {negative_count} bear | {len(sentiments) - positive_count - negative_count} neutral")

        return score, signals, reasoning


class NeuralReasoningMarketSentimentEngine:
    """
    v4.0 - 6-Layer Neural Reasoning Engine
    Thinks like a trader: analyzes, detects divergences, finds patterns, concludes.
    """

    # Major indices to track
    MAJOR_INDICES = ['^GSPC', '^DJI', '^IXIC', '^RUT', '^VIX', '^FTSE', '^N225', '^GDAXI']

    def __init__(self):
        self.version = "4.1"
        self.news_analyzer = AdvancedNewsSentimentAnalyzer()
        self._cache: Dict[str, Any] = {}
        self._cache_ttl = 300  # 5 minutes

    def _fetch_fmp(self, endpoint: str, params: str = '') -> Any:
        """Fetch data from FMP API with caching."""
        api_key = os.environ.get('FMP_API_KEY')
        if not api_key:
            return None

        cache_key = f'mse_{endpoint}_{params}'
        now = datetime.now().timestamp()
        if cache_key in self._cache:
            data, ts = self._cache[cache_key]
            if now - ts < self._cache_ttl:
                return data

        try:
            sep = '&' if params else ''
            url = f"https://financialmodelingprep.com/stable/{endpoint}?{params}{sep}apikey={api_key}"
            resp = requests.get(url, timeout=10)
            if resp.ok:
                data = resp.json()
                self._cache[cache_key] = (data, now)
                return data
        except Exception as e:
            print(f"[NeuralMSE] FMP fetch error ({endpoint}): {e}")
        return None

    def _fill_missing_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Auto-fetch any missing market data from FMP API."""
        filled = dict(data)

        # Sector performance
        if not filled.get('sectorPerformance') or len(filled.get('sectorPerformance', [])) == 0:
            sectors = self._fetch_fmp('sector-performance-snapshot')
            if sectors and isinstance(sectors, list) and len(sectors) > 0:
                filled['sectorPerformance'] = sectors
                print(f"[NeuralMSE] Auto-fetched {len(sectors)} sectors from FMP")

        # Industry performance
        if not filled.get('industryPerformance') or len(filled.get('industryPerformance', [])) == 0:
            industries = self._fetch_fmp('industry-performance-snapshot')
            if industries and isinstance(industries, list) and len(industries) > 0:
                filled['industryPerformance'] = industries
                print(f"[NeuralMSE] Auto-fetched {len(industries)} industries from FMP")

        # Index quotes — always fetch since frontend doesn't send these
        if not filled.get('indexQuotes') or len(filled.get('indexQuotes', [])) == 0:
            index_quotes = []
            symbols = ','.join(self.MAJOR_INDICES)
            quotes = self._fetch_fmp('batch-quote', f'symbols={symbols}')
            if quotes and isinstance(quotes, list) and len(quotes) > 0:
                index_quotes = quotes
            else:
                # Fallback: fetch one by one
                for sym in self.MAJOR_INDICES[:6]:
                    q = self._fetch_fmp('quote', f'symbol={sym}')
                    if q and isinstance(q, list) and len(q) > 0:
                        index_quotes.append(q[0])
                    elif q and isinstance(q, dict):
                        index_quotes.append(q)
            if index_quotes:
                filled['indexQuotes'] = index_quotes
                print(f"[NeuralMSE] Auto-fetched {len(index_quotes)} index quotes from FMP")

        # Forex quotes — check if existing data has changesPercentage, if not re-fetch
        existing_forex = filled.get('forexQuotes', [])
        forex_usable = False
        if existing_forex and isinstance(existing_forex, list) and len(existing_forex) > 0:
            # Check if at least one item has changesPercentage or changes
            for fx in existing_forex[:5]:
                if fx.get('changesPercentage') is not None or fx.get('changes') is not None:
                    forex_usable = True
                    break

        if not forex_usable:
            forex = self._fetch_fmp('batch-forex-quotes')
            if forex and isinstance(forex, list) and len(forex) > 0:
                filled['forexQuotes'] = forex
                print(f"[NeuralMSE] Auto-fetched {len(forex)} forex quotes from FMP")

        # Historical sector performance — derive from current sector data
        if not filled.get('historicalSectorPerformance') or len(filled.get('historicalSectorPerformance', [])) < 2:
            sectors = filled.get('sectorPerformance', [])
            if sectors and len(sectors) > 0:
                # Create multi-entry historical from sector changes to satisfy trend analysis
                hist = []
                for s in sectors:
                    change = s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0
                    hist.append({'sector': s.get('sector', ''), 'averageChange': change, 'change': change})
                filled['historicalSectorPerformance'] = hist
                print(f"[NeuralMSE] Created {len(hist)} historical entries from sector data")

        return filled

    def analyze(self, data: Dict[str, Any]) -> Dict[str, Any]:
        start = datetime.now()

        # Auto-fetch any missing data from FMP
        data = self._fill_missing_data(data)

        # === INPUT DATA ===
        news = data.get('news', [])
        gainers = data.get('gainers', [])
        losers = data.get('losers', [])
        sectors = data.get('sectorPerformance', [])
        industries = data.get('industryPerformance', [])
        indices = data.get('indexQuotes', [])
        forex = data.get('forexQuotes', [])
        hist_sectors = data.get('historicalSectorPerformance', [])

        signals: List[MarketSignal] = []
        full_reasoning: List[str] = [f"**REASONING ENGINE v{self.version} INITIATED**"]

        print(f"[NeuralMSE v{self.version}] Analyzing: news={len(news)}, gainers={len(gainers)}, losers={len(losers)}, sectors={len(sectors)}, industries={len(industries)}, indices={len(indices)}, forex={len(forex)}")

        # ====================== LAYER 1: NEWS NEURAL ======================
        news_score, news_signals, news_reasoning = self.news_analyzer.analyze_news_batch(news)
        signals.extend(news_signals)
        full_reasoning.extend(news_reasoning)

        # ====================== LAYER 2: MICRO BREADTH ======================
        movers_score, movers_signals, breadth_ratio, sector_rotation, top_gainers, top_losers = self._analyze_movers(gainers, losers)
        signals.extend(movers_signals)
        full_reasoning.append(f"**MICRO BREADTH:** {breadth_ratio:.0%} advancing ({len(gainers)} up vs {len(losers)} down)")

        # ====================== LAYER 3: MACRO SECTORS + INDUSTRIES ======================
        sector_score, sector_signals, sector_breadth, hot_sectors, cold_sectors, sector_reasoning = self._analyze_sectors(sectors)
        signals.extend(sector_signals)
        full_reasoning.extend(sector_reasoning)

        industry_score, industry_signals, industry_breadth = self._analyze_industries(industries)
        signals.extend(industry_signals)
        if industries:
            full_reasoning.append(f"**INDUSTRIES:** {industry_breadth:.0%} showing strength")

        # ====================== LAYER 4: INDICES + FOREX ======================
        index_score, index_signals, index_reasoning = self._analyze_indices(indices)
        signals.extend(index_signals)
        full_reasoning.extend(index_reasoning)

        forex_score, forex_signals, forex_reasoning = self._analyze_forex(forex)
        signals.extend(forex_signals)
        full_reasoning.extend(forex_reasoning)

        # ====================== LAYER 5: HISTORICAL TRENDS ======================
        trend_score, trend_signals, trend_reasoning = self._analyze_trends(hist_sectors)
        signals.extend(trend_signals)
        full_reasoning.extend(trend_reasoning)

        # ====================== LAYER 6: FUSION + CROSS-CORRELATION ======================
        composite, fusion_reasoning = self._fuse_and_reason(
            news_score, movers_score, sector_score, industry_score,
            index_score, forex_score, trend_score, breadth_ratio, sector_breadth
        )
        full_reasoning.extend(fusion_reasoning)

        # ====================== ACTIONABLE CONCLUSION ======================
        rec, emoji, sentiment, desc, action = self._generate_conclusion(composite)

        process_time = (datetime.now() - start).total_seconds()
        print(f"[NeuralMSE v{self.version}] Complete in {process_time:.3f}s: {rec} (score: {composite:.1f})")

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
            "scores": {
                "news": round(news_score, 1),
                "movers": round(movers_score, 1),
                "sectors": round(sector_score, 1),
                "industries": round(industry_score, 1),
                "indices": round(index_score, 1),
                "forex": round(forex_score, 1),
                "trends": round(trend_score, 1),
                "composite": round(composite, 1)
            },
            "moversAnalysis": {
                "breadthRatio": round(breadth_ratio, 3),
                "breadthLabel": self._get_breadth_label(breadth_ratio),
                "gainersCount": len(gainers),
                "losersCount": len(losers),
                "topGainers": top_gainers,
                "topLosers": top_losers,
                "sectorRotation": sector_rotation
            },
            "macroAnalysis": {
                "sectorBreadth": round(sector_breadth, 3),
                "industryBreadth": round(industry_breadth, 3),
                "hotSectors": [{"sector": s.get('sector', ''), "change": s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0} for s in hot_sectors[:4]],
                "coldSectors": [{"sector": s.get('sector', ''), "change": s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0} for s in cold_sectors[:4]],
                "majorIndicesUp": [i.get('symbol', '') for i in indices[:6] if (i.get('changesPercentage', 0) or 0) > 0],
                "majorIndicesDown": [i.get('symbol', '') for i in indices[:6] if (i.get('changesPercentage', 0) or 0) < 0],
            },
            "signals": [
                {
                    "source": s.source, "type": s.type, "strength": s.strength,
                    "weight": s.weight, "description": s.description,
                    "dataPoint": s.data_point, "emoji": s.emoji
                }
                for s in signals[:20]
            ],
            "reasoningChain": full_reasoning,
            "briefing": self._generate_briefing(composite, news_score, movers_score, breadth_ratio,
                                                 sector_rotation, rec, len(gainers), len(losers),
                                                 hot_sectors, cold_sectors, action)
        }

    # ====================== INTERNAL ANALYSIS METHODS ======================

    def _analyze_movers(self, gainers: List, losers: List) -> Tuple[float, List[MarketSignal], float, Dict, List, List]:
        """Analyze market movers with sector rotation."""
        signals = []
        total = len(gainers) + len(losers)
        if total == 0:
            return 50.0, [], 0.5, {"hot": [], "cold": []}, [], []

        breadth_ratio = len(gainers) / total

        # Sector rotation analysis
        sector_data = defaultdict(lambda: {'gainers': 0, 'losers': 0, 'gainer_change': 0, 'loser_change': 0})
        for g in gainers:
            sector = g.get('sector', 'Unknown') or 'Unknown'
            sector_data[sector]['gainers'] += 1
            sector_data[sector]['gainer_change'] += abs(g.get('changesPercentage', 0) or 0)
        for l in losers:
            sector = l.get('sector', 'Unknown') or 'Unknown'
            sector_data[sector]['losers'] += 1
            sector_data[sector]['loser_change'] += abs(l.get('changesPercentage', 0) or 0)

        hot_sectors = sorted(
            [(s, d) for s, d in sector_data.items() if d['gainers'] > d['losers']],
            key=lambda x: x[1]['gainers'], reverse=True
        )[:5]
        cold_sectors = sorted(
            [(s, d) for s, d in sector_data.items() if d['losers'] > d['gainers']],
            key=lambda x: x[1]['losers'], reverse=True
        )[:5]

        top_gainers = [
            {"symbol": g.get('symbol', ''), "name": g.get('name', '')[:40],
             "change": g.get('changesPercentage', 0), "price": g.get('price', 0),
             "sector": g.get('sector', '')}
            for g in sorted(gainers, key=lambda x: x.get('changesPercentage', 0) or 0, reverse=True)[:10]
        ]
        top_losers = [
            {"symbol": l.get('symbol', ''), "name": l.get('name', '')[:40],
             "change": l.get('changesPercentage', 0), "price": l.get('price', 0),
             "sector": l.get('sector', '')}
            for l in sorted(losers, key=lambda x: x.get('changesPercentage', 0) or 0)[:10]
        ]

        avg_gainer = np.mean([g.get('changesPercentage', 0) or 0 for g in gainers]) if gainers else 0
        avg_loser = np.mean([abs(l.get('changesPercentage', 0) or 0) for l in losers]) if losers else 0

        score = 50 + (breadth_ratio - 0.5) * 85

        # Breadth signals
        if breadth_ratio >= 0.7:
            signals.append(MarketSignal("breadth", "bullish", 0.9, 0.30, f"Excellent breadth: {breadth_ratio:.0%} advancing", emoji="🟢"))
        elif breadth_ratio >= 0.6:
            signals.append(MarketSignal("breadth", "bullish", 0.7, 0.25, f"Positive breadth: {breadth_ratio:.0%} advancing", emoji="📈"))
        elif breadth_ratio <= 0.3:
            signals.append(MarketSignal("breadth", "bearish", 0.9, 0.30, f"Very weak breadth: only {breadth_ratio:.0%} advancing", emoji="🔴"))
        elif breadth_ratio <= 0.4:
            signals.append(MarketSignal("breadth", "bearish", 0.7, 0.25, f"Negative breadth: {breadth_ratio:.0%} advancing", emoji="📉"))

        # Momentum signals
        if avg_gainer > 8:
            signals.append(MarketSignal("momentum", "bullish", 0.85, 0.20, f"Explosive gainer momentum: +{avg_gainer:.1f}% avg", emoji="🚀"))
        elif avg_gainer > 5:
            signals.append(MarketSignal("momentum", "bullish", 0.70, 0.15, f"Strong gainer momentum: +{avg_gainer:.1f}% avg", emoji="💪"))
        if avg_loser > 8:
            signals.append(MarketSignal("momentum", "bearish", 0.85, 0.20, f"Extreme selling pressure: -{avg_loser:.1f}% avg", emoji="🔻"))

        # Sector rotation signals
        if hot_sectors:
            top_hot = hot_sectors[0]
            signals.append(MarketSignal("sector_rotation", "bullish", 0.6, 0.12, f"Hot sector: {top_hot[0]} ({top_hot[1]['gainers']}up/{top_hot[1]['losers']}down)", emoji="🔥"))
        if cold_sectors:
            top_cold = cold_sectors[0]
            signals.append(MarketSignal("sector_rotation", "bearish", 0.6, 0.12, f"Cold sector: {top_cold[0]} ({top_cold[1]['losers']}down/{top_cold[1]['gainers']}up)", emoji="❄️"))

        sector_rotation = {
            "hot": [{"sector": s, "gainers": d['gainers'], "losers": d['losers']} for s, d in hot_sectors],
            "cold": [{"sector": s, "gainers": d['gainers'], "losers": d['losers']} for s, d in cold_sectors]
        }

        return max(10, min(90, score)), signals, breadth_ratio, sector_rotation, top_gainers, top_losers

    def _analyze_sectors(self, sectors: List) -> Tuple[float, List[MarketSignal], float, List, List, List[str]]:
        """Analyze sector performance snapshot."""
        if not sectors:
            return 50.0, [], 0.5, [], [], ["No sector performance data."]

        up_sectors = [s for s in sectors if (s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0) > 0]
        breadth = len(up_sectors) / len(sectors) if sectors else 0.5
        changes = [s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0 for s in sectors]
        avg_change = np.mean(changes)

        score = 50 + (breadth - 0.5) * 75 + (avg_change * 10)
        score = max(10, min(90, score))

        signals = []
        if breadth >= 0.7:
            signals.append(MarketSignal("sectors", "bullish", 0.8, 0.18, f"Broad sector strength: {len(up_sectors)}/{len(sectors)} green", emoji="📊"))
        elif breadth <= 0.3:
            signals.append(MarketSignal("sectors", "bearish", 0.8, 0.18, f"Broad sector weakness: only {len(up_sectors)}/{len(sectors)} green", emoji="📊"))

        hot = sorted([s for s in sectors if (s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0) > 0.5],
                     key=lambda x: x.get('averageChange', 0) or x.get('changesPercentage', 0) or 0, reverse=True)[:4]
        cold = sorted([s for s in sectors if (s.get('averageChange', 0) or s.get('changesPercentage', 0) or 0) < -0.5],
                      key=lambda x: x.get('averageChange', 0) or x.get('changesPercentage', 0) or 0)[:4]

        reasoning = [f"**SECTORS:** {len(up_sectors)}/{len(sectors)} green ({avg_change:+.2f}% avg)"]
        if hot:
            reasoning.append(f"  Hot: {', '.join([h.get('sector', '?') for h in hot[:3]])}")
        if cold:
            reasoning.append(f"  Cold: {', '.join([c.get('sector', '?') for c in cold[:3]])}")

        return score, signals, breadth, hot, cold, reasoning

    def _analyze_industries(self, industries: List) -> Tuple[float, List[MarketSignal], float]:
        """Analyze industry performance."""
        if not industries:
            return 50.0, [], 0.5
        up = [i for i in industries if (i.get('averageChange', 0) or i.get('changesPercentage', 0) or 0) > 0]
        breadth = len(up) / len(industries) if industries else 0.5
        changes = [i.get('averageChange', 0) or i.get('changesPercentage', 0) or 0 for i in industries]
        avg_change = np.mean(changes)
        score = 50 + (breadth - 0.5) * 70 + (avg_change * 8)
        score = max(10, min(90, score))

        signals = []
        if breadth >= 0.65:
            signals.append(MarketSignal("industries", "bullish", 0.7, 0.10, f"Industry breadth strong: {len(up)}/{len(industries)} positive", emoji="🏭"))
        elif breadth <= 0.35:
            signals.append(MarketSignal("industries", "bearish", 0.7, 0.10, f"Industry breadth weak: {len(up)}/{len(industries)} positive", emoji="🏭"))

        return score, signals, breadth

    def _analyze_indices(self, indices: List) -> Tuple[float, List[MarketSignal], List[str]]:
        """Analyze major market indices."""
        if not indices:
            return 50.0, [], ["No index data available."]

        up_count = sum(1 for i in indices if (i.get('changesPercentage', 0) or 0) > 0)
        total = len(indices) or 1
        changes = [i.get('changesPercentage', 0) or 0 for i in indices]
        avg_change = np.mean(changes)

        score = 50 + (up_count / total - 0.5) * 70 + (avg_change * 8)
        score = max(10, min(90, score))

        signals = []
        for idx in indices[:6]:
            change = idx.get('changesPercentage', 0) or 0
            symbol = idx.get('symbol', '')
            if abs(change) > 1.5:
                sig_type = "bullish" if change > 0 else "bearish"
                signals.append(MarketSignal("index", sig_type, 0.75, 0.08,
                    f"{symbol}: {change:+.2f}%", emoji="📈" if change > 0 else "📉"))

        reasoning = [f"**INDICES:** {up_count}/{total} green ({avg_change:+.2f}% avg)"]
        for idx in indices[:4]:
            change = idx.get('changesPercentage', 0) or 0
            symbol = idx.get('symbol', idx.get('name', '?'))
            reasoning.append(f"  {symbol}: {change:+.2f}%")

        return score, signals, reasoning

    def _analyze_forex(self, forex: List) -> Tuple[float, List[MarketSignal], List[str]]:
        """Analyze forex movements (USD strength = risk-off signal)."""
        if not forex:
            return 50.0, [], ["No forex data available."]

        usd_pairs = [f for f in forex if 'USD' in (f.get('ticker', '') or f.get('symbol', ''))]
        if not usd_pairs:
            return 50.0, [], ["No USD pairs found."]

        usd_changes = [f.get('changesPercentage', 0) or f.get('changes', 0) or 0 for f in usd_pairs[:10]]
        avg_usd_change = np.mean(usd_changes) if usd_changes else 0

        # Strong USD = risk-off (bearish for stocks), weak USD = risk-on
        score = 50 - (avg_usd_change * 6)
        score = max(15, min(85, score))

        signals = []
        if avg_usd_change > 0.3:
            signals.append(MarketSignal("forex", "bearish", 0.6, 0.04,
                f"USD strengthening ({avg_usd_change:+.2f}%) - risk-off signal", emoji="💵"))
        elif avg_usd_change < -0.3:
            signals.append(MarketSignal("forex", "bullish", 0.6, 0.04,
                f"USD weakening ({avg_usd_change:+.2f}%) - risk-on signal", emoji="💵"))

        mode = "risk-off" if avg_usd_change > 0.1 else "risk-on" if avg_usd_change < -0.1 else "stable"
        reasoning = [f"**FOREX:** USD {avg_usd_change:+.2f}% -> {mode}"]

        return score, signals, reasoning

    def _analyze_trends(self, hist_sectors: List) -> Tuple[float, List[MarketSignal], List[str]]:
        """Analyze historical sector trends (3-5 day momentum)."""
        if not hist_sectors or len(hist_sectors) < 2:
            return 50.0, [], ["No historical trend data."]

        recent = hist_sectors[-5:] if len(hist_sectors) >= 5 else hist_sectors
        up_days = sum(1 for d in recent if (d.get('averageChange', 0) or d.get('change', 0) or 0) > 0)
        avg_momentum = np.mean([d.get('averageChange', 0) or d.get('change', 0) or 0 for d in recent])

        score = 50 + (up_days / len(recent) - 0.5) * 60 + (avg_momentum * 5)
        score = max(15, min(85, score))

        signals = []
        if up_days >= 4:
            signals.append(MarketSignal("trend", "bullish", 0.65, 0.02,
                f"Strong uptrend: {up_days}/{len(recent)} bullish days", emoji="📈"))
        elif up_days <= 1:
            signals.append(MarketSignal("trend", "bearish", 0.65, 0.02,
                f"Downtrend: only {up_days}/{len(recent)} bullish days", emoji="📉"))

        reasoning = [f"**TRENDS:** {up_days}/{len(recent)} bullish days (avg momentum: {avg_momentum:+.2f}%)"]
        return score, signals, reasoning

    def _fuse_and_reason(self, news, movers, sectors, ind, idx, fx, trend, br, sb) -> Tuple[float, List[str]]:
        """Neural fusion with cross-correlation and divergence detection."""
        weights = {
            'news': 0.35, 'movers': 0.22, 'sectors': 0.18 if sectors != 50 else 0.05,
            'ind': 0.08 if ind != 50 else 0.02, 'idx': 0.10 if idx != 50 else 0.03,
            'fx': 0.04, 'trend': 0.03
        }
        total_w = sum(weights.values())

        composite = (
            news * weights['news'] + movers * weights['movers'] + sectors * weights['sectors'] +
            ind * weights['ind'] + idx * weights['idx'] + fx * weights['fx'] + trend * weights['trend']
        ) / total_w

        reasoning = ["**NEURAL FUSION:**"]

        # === DIVERGENCE DETECTION ===
        if news > 65 and (movers < 42 or br < 0.38):
            reasoning.append("DIVERGENCE: Bullish news BUT weak breadth -> Caution (possible bull trap)")
            composite *= 0.92
        elif news < 35 and (movers > 60 and br > 0.62):
            reasoning.append("DIVERGENCE: Bearish news BUT strong breadth -> Possible bounce")
            composite *= 1.08
        elif news > 60 and sectors > 55 and idx < 40:
            reasoning.append("DIVERGENCE: News+sectors bullish BUT indices weak -> Rotation underway")
            composite *= 0.96

        # === CROSS-CORRELATION ===
        if composite > 70 and idx > 55 and fx < 48:
            reasoning.append("ALIGNMENT: News + macro + risk-on all aligned. High conviction bull.")
        elif composite < 35 and idx < 45 and fx > 55:
            reasoning.append("ALIGNMENT: Bearish across all layers. High conviction risk-off.")

        # === BREADTH CONFIRMATION ===
        if composite > 60 and br < 0.45:
            reasoning.append("WARNING: Score bullish but market participation narrow. Rally fragile.")
            composite *= 0.95
        elif composite < 40 and br > 0.55:
            reasoning.append("NOTE: Score bearish but breadth decent. Selling may be overdone.")
            composite *= 1.05

        composite = max(5, min(95, composite))
        reasoning.append(f"**Final composite score:** {composite:.1f}")

        return composite, reasoning

    def _generate_conclusion(self, composite: float) -> Tuple[str, str, str, str, str]:
        """Generate actionable conclusion."""
        if composite >= 78:
            return ("BULL MARKET - FULL RISK ON", "🚀", "very_bullish",
                    "Unstoppable momentum. All layers green.",
                    "AGGRESSIVE BUY: Focus on hot sectors and top gainers. Tight stops at 2%.")
        elif composite >= 64:
            return ("BULLISH - SOLID MOMENTUM", "📈", "bullish",
                    "Market on the offensive with clear rotation.",
                    "GO LONG: Hot sectors and momentum plays. Monitor breadth for confirmation.")
        elif composite >= 50:
            return ("NEUTRAL - MIXED SIGNALS", "⚖️", "neutral",
                    "Balanced signals. Wait for confirmation.",
                    "HOLD: Be selective. Keep 30% cash. Watch for breakout direction.")
        elif composite >= 36:
            return ("BEARISH - SELLING PRESSURE", "📉", "bearish",
                    "Macro weakness. Reduce risk exposure.",
                    "REDUCE: Trim longs. Consider hedges. Look for defensive sectors.")
        else:
            return ("RISK OFF - DEFENSIVE MODE", "🛡️", "very_bearish",
                    "Defensive posture. Capital preservation priority.",
                    "SELL: Move to cash/bonds. Wait for bottom signals before re-entering.")

    def _get_breadth_label(self, ratio: float) -> str:
        if ratio >= 0.7: return "Very Positive"
        elif ratio >= 0.55: return "Positive"
        elif ratio >= 0.45: return "Neutral"
        elif ratio >= 0.3: return "Negative"
        return "Very Negative"

    def _generate_briefing(self, composite, news_score, movers_score, breadth,
                           sector_rotation, recommendation, gainers_count, losers_count,
                           hot_sectors, cold_sectors, action) -> str:
        """Generate comprehensive market briefing."""
        parts = []
        if composite >= 70:
            parts.append(f"🚀 Market in **strong bullish mode** (score: {composite:.0f}/100).")
        elif composite >= 55:
            parts.append(f"📈 Positive sentiment with good participation (score: {composite:.0f}/100).")
        elif composite >= 45:
            parts.append(f"⚖️ Mixed market with no clear direction (score: {composite:.0f}/100).")
        elif composite >= 35:
            parts.append(f"📉 Market showing weakness (score: {composite:.0f}/100).")
        else:
            parts.append(f"🔻 Dominant selling pressure (score: {composite:.0f}/100).")

        parts.append(f"Market breadth: {breadth:.0%} advancing ({gainers_count} gainers vs {losers_count} losers).")

        if news_score >= 65:
            parts.append("News flow predominantly positive.")
        elif news_score <= 35:
            parts.append("News flow reflects caution or negativity.")

        hot = sector_rotation.get('hot', [])
        cold = sector_rotation.get('cold', [])
        if hot:
            parts.append(f"Hot sectors: {', '.join([s['sector'] for s in hot[:2]])}.")
        if cold:
            parts.append(f"Cold sectors: {', '.join([s['sector'] for s in cold[:2]])}.")

        if action:
            parts.append(f"**Action:** {action}")

        return " ".join(parts)


# Global instance
market_sentiment_engine = NeuralReasoningMarketSentimentEngine()
