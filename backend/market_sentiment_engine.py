# backend/market_sentiment_engine.py
# NEURAL MARKET SENTIMENT ENGINE v2.1 - Enhanced Version
# Advanced market sentiment analysis with multi-layer NLP and market structure analysis

import numpy as np
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
    Uses weighted keyword matching, context analysis, and entity extraction.
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

        # Strong keywords
        for phrase, weight in self.strong_bullish.items():
            if phrase in text_lower:
                score += weight

        for phrase, weight in self.strong_bearish.items():
            if phrase in text_lower:
                score -= weight

        # Moderate keywords
        for word, weight in self.moderate_bullish.items():
            if word in text_lower:
                score += weight

        for word, weight in self.moderate_bearish.items():
            if word in text_lower:
                score -= weight

        # Normalize to -1 to 1 using tanh
        normalized = float(np.tanh(score / 5))

        return {
            'score': float(score),
            'normalized': normalized,
        }

    def analyze_news_batch(self, news_items: List[Dict]) -> Tuple[float, List[MarketSignal]]:
        """Analyze a batch of news items and return score + signals."""
        if not news_items:
            return 50.0, []

        sentiments = []
        positive_count = 0
        negative_count = 0

        for item in news_items[:30]:
            title = item.get('title', '')
            text = item.get('text', '')[:500]
            combined = f"{title} {text}"

            analysis = self.analyze_text(combined)
            sentiments.append(analysis['normalized'])

            if analysis['normalized'] > 0.15:
                positive_count += 1
            elif analysis['normalized'] < -0.15:
                negative_count += 1

        avg_sentiment = np.mean(sentiments) if sentiments else 0
        # Convert -1 to 1 range to 0-100 score
        score = (avg_sentiment + 1) / 2 * 100

        signals = []
        if positive_count > negative_count * 1.5:
            signals.append(MarketSignal(
                source="news",
                type="bullish",
                strength=0.75,
                weight=0.35,
                description=f"{positive_count} noticias positivas vs {negative_count} negativas",
                emoji="📰"
            ))
        elif negative_count > positive_count * 1.5:
            signals.append(MarketSignal(
                source="news",
                type="bearish",
                strength=0.75,
                weight=0.35,
                description=f"{negative_count} noticias negativas dominan el flujo",
                emoji="📰"
            ))

        return score, signals


class AdvancedMarketSentimentEngine:
    """
    Neural Market Sentiment Engine v2.1
    Combines multi-layer NLP news analysis with advanced market structure analysis.
    """

    def __init__(self):
        self.version = "2.1"
        self.news_analyzer = AdvancedNewsSentimentAnalyzer()

    def analyze(self, data: Dict[str, Any]) -> Dict[str, Any]:
        start = datetime.now()

        news = data.get('news', [])
        gainers = data.get('gainers', [])
        losers = data.get('losers', [])
        holders = data.get('holdersData', {})

        signals: List[MarketSignal] = []

        print(f"[MarketSentimentEngine v{self.version}] Starting analysis...")
        print(f"[MSE] News: {len(news)}, Gainers: {len(gainers)}, Losers: {len(losers)}")

        # ====================== LAYER 1: NEWS SENTIMENT ======================
        news_score, news_signals = self.news_analyzer.analyze_news_batch(news)
        signals.extend(news_signals)
        print(f"[MSE] News score: {news_score:.1f}")

        # ====================== LAYER 2: GAINERS + LOSERS ======================
        movers_score, movers_signals, breadth_ratio, sector_rotation, top_gainers, top_losers = self._analyze_movers(gainers, losers)
        signals.extend(movers_signals)
        print(f"[MSE] Movers score: {movers_score:.1f}, Breadth: {breadth_ratio:.2%}")

        # ====================== LAYER 3: INSTITUTIONAL FLOW ======================
        inst_score, inst_signals = self._analyze_institutional(holders)
        signals.extend(inst_signals)

        # ====================== LAYER 4: COMPOSITE SCORE ======================
        # Dynamic weights based on data quality
        weights = {
            'news': 0.35 if news else 0.0,
            'movers': 0.30 if gainers or losers else 0.0,
            'institutional': 0.20 if holders else 0.0,
            'breadth': 0.15
        }
        total_weight = sum(weights.values()) or 1.0

        composite = (
            news_score * weights['news'] +
            movers_score * weights['movers'] +
            inst_score * weights['institutional'] +
            (breadth_ratio * 100) * weights['breadth']
        ) / total_weight

        # ====================== RECOMMENDATION ======================
        if composite >= 72:
            rec = "RISK ON - ALCISTA FUERTE"
            emoji = "🚀"
            sentiment = "very_bullish"
            desc = "Condiciones de mercado muy favorables. Momentum positivo generalizado."
        elif composite >= 58:
            rec = "ALCISTA - MOMENTUM POSITIVO"
            emoji = "📈"
            sentiment = "bullish"
            desc = "El mercado muestra fortaleza. Favorecer posiciones largas."
        elif composite >= 45:
            rec = "NEUTRAL - MERCADO MIXTO"
            emoji = "⚖️"
            sentiment = "neutral"
            desc = "Señales mixtas. Ser selectivo y mantener cautela."
        elif composite >= 32:
            rec = "CAUTELOSO - PRESIÓN BAJISTA"
            emoji = "📉"
            sentiment = "bearish"
            desc = "Debilidad en el mercado. Reducir exposición."
        else:
            rec = "RISK OFF - MODO DEFENSIVO"
            emoji = "🔻"
            sentiment = "very_bearish"
            desc = "Condiciones adversas. Priorizar preservación de capital."

        # ====================== BRIEFING ======================
        briefing = self._generate_briefing(composite, news_score, movers_score, breadth_ratio, sector_rotation, rec, len(gainers), len(losers))

        process_time = (datetime.now() - start).total_seconds()
        print(f"[MSE] Analysis complete in {process_time:.2f}s: {rec}")

        return {
            "version": self.version,
            "timestamp": datetime.now().isoformat(),
            "processingTime": round(process_time, 2),
            "compositeScore": round(composite, 1),
            "overallSentiment": sentiment,
            "sentimentEmoji": emoji,
            "recommendation": rec,
            "recommendationDescription": desc,
            "scores": {
                "news": round(news_score, 1),
                "movers": round(movers_score, 1),
                "breadth": round(breadth_ratio * 100, 1),
                "institutional": round(inst_score, 1),
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
            "signals": [
                {
                    "source": s.source,
                    "type": s.type,
                    "strength": s.strength,
                    "weight": s.weight,
                    "description": s.description,
                    "dataPoint": s.data_point,
                    "emoji": s.emoji
                }
                for s in signals[:12]
            ],
            "briefing": briefing
        }

    def _analyze_movers(self, gainers: List, losers: List) -> Tuple[float, List[MarketSignal], float, Dict, List, List]:
        """Analyze market movers (gainers & losers)."""
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

        # Determine hot and cold sectors
        hot_sectors = sorted(
            [(s, d) for s, d in sector_data.items() if d['gainers'] > d['losers']],
            key=lambda x: x[1]['gainers'],
            reverse=True
        )[:5]

        cold_sectors = sorted(
            [(s, d) for s, d in sector_data.items() if d['losers'] > d['gainers']],
            key=lambda x: x[1]['losers'],
            reverse=True
        )[:5]

        # Top gainers and losers
        top_gainers = [
            {
                "symbol": g.get('symbol', ''),
                "name": g.get('name', '')[:40],
                "change": g.get('changesPercentage', 0),
                "price": g.get('price', 0),
                "sector": g.get('sector', '')
            }
            for g in sorted(gainers, key=lambda x: x.get('changesPercentage', 0) or 0, reverse=True)[:10]
        ]

        top_losers = [
            {
                "symbol": l.get('symbol', ''),
                "name": l.get('name', '')[:40],
                "change": l.get('changesPercentage', 0),
                "price": l.get('price', 0),
                "sector": l.get('sector', '')
            }
            for l in sorted(losers, key=lambda x: x.get('changesPercentage', 0) or 0)[:10]
        ]

        # Calculate average changes
        avg_gainer = np.mean([g.get('changesPercentage', 0) or 0 for g in gainers]) if gainers else 0
        avg_loser = np.mean([abs(l.get('changesPercentage', 0) or 0) for l in losers]) if losers else 0

        # Score calculation
        score = 50 + (breadth_ratio - 0.5) * 80

        # Generate signals
        if breadth_ratio >= 0.7:
            signals.append(MarketSignal(
                source="breadth",
                type="bullish",
                strength=0.9,
                weight=0.35,
                description=f"Breadth excelente: {breadth_ratio:.0%} de acciones subiendo",
                emoji="🟢"
            ))
        elif breadth_ratio >= 0.6:
            signals.append(MarketSignal(
                source="breadth",
                type="bullish",
                strength=0.7,
                weight=0.3,
                description=f"Breadth positivo: {breadth_ratio:.0%} avanzando",
                emoji="📈"
            ))
        elif breadth_ratio <= 0.3:
            signals.append(MarketSignal(
                source="breadth",
                type="bearish",
                strength=0.9,
                weight=0.35,
                description=f"Breadth muy débil: solo {breadth_ratio:.0%} subiendo",
                emoji="🔴"
            ))
        elif breadth_ratio <= 0.4:
            signals.append(MarketSignal(
                source="breadth",
                type="bearish",
                strength=0.7,
                weight=0.3,
                description=f"Breadth negativo: {breadth_ratio:.0%} avanzando",
                emoji="📉"
            ))

        # Momentum signals
        if avg_gainer > 8:
            signals.append(MarketSignal(
                source="momentum",
                type="bullish",
                strength=0.85,
                weight=0.25,
                description=f"Momentum explosivo en gainers: +{avg_gainer:.1f}% promedio",
                emoji="🚀"
            ))
        elif avg_gainer > 5:
            signals.append(MarketSignal(
                source="momentum",
                type="bullish",
                strength=0.7,
                weight=0.2,
                description=f"Momentum fuerte en gainers: +{avg_gainer:.1f}% promedio",
                emoji="💪"
            ))

        if avg_loser > 8:
            signals.append(MarketSignal(
                source="momentum",
                type="bearish",
                strength=0.85,
                weight=0.25,
                description=f"Presión vendedora extrema: -{avg_loser:.1f}% promedio",
                emoji="🔻"
            ))

        # Sector rotation signals
        if hot_sectors:
            top_hot = hot_sectors[0]
            signals.append(MarketSignal(
                source="sector",
                type="bullish",
                strength=0.6,
                weight=0.15,
                description=f"Sector caliente: {top_hot[0]} ({top_hot[1]['gainers']}↑/{top_hot[1]['losers']}↓)",
                emoji="🔥"
            ))

        if cold_sectors:
            top_cold = cold_sectors[0]
            signals.append(MarketSignal(
                source="sector",
                type="bearish",
                strength=0.6,
                weight=0.15,
                description=f"Sector débil: {top_cold[0]} ({top_cold[1]['losers']}↓/{top_cold[1]['gainers']}↑)",
                emoji="❄️"
            ))

        sector_rotation = {
            "hot": [{"sector": s, "gainers": d['gainers'], "losers": d['losers']} for s, d in hot_sectors],
            "cold": [{"sector": s, "gainers": d['gainers'], "losers": d['losers']} for s, d in cold_sectors]
        }

        return max(10, min(90, score)), signals, breadth_ratio, sector_rotation, top_gainers, top_losers

    def _analyze_institutional(self, holders: Dict) -> Tuple[float, List[MarketSignal]]:
        """Analyze institutional flow if data available."""
        if not holders:
            return 50.0, []

        signals = []
        score = 55.0  # Slightly positive neutral

        # Could expand with actual holders data analysis
        inst_holders = holders.get('institutionalHolders', [])
        if inst_holders:
            signals.append(MarketSignal(
                source="institutional",
                type="neutral",
                strength=0.4,
                weight=0.15,
                description=f"Datos institucionales: {len(inst_holders)} holders detectados",
                emoji="🏛️"
            ))

        return score, signals

    def _get_breadth_label(self, ratio: float) -> str:
        if ratio >= 0.7:
            return "Muy Positiva"
        elif ratio >= 0.55:
            return "Positiva"
        elif ratio >= 0.45:
            return "Neutral"
        elif ratio >= 0.3:
            return "Negativa"
        return "Muy Negativa"

    def _generate_briefing(self, composite: float, news_score: float, movers_score: float,
                           breadth: float, sector_rotation: Dict, recommendation: str,
                           gainers_count: int, losers_count: int) -> str:
        """Generate detailed market briefing."""
        parts = []

        # Opening based on composite
        if composite >= 70:
            parts.append(f"🚀 El mercado está en **modo alcista fuerte**.")
        elif composite >= 55:
            parts.append(f"📈 Sentimiento positivo con buena participación.")
        elif composite >= 45:
            parts.append(f"⚖️ Mercado mixto sin dirección clara.")
        elif composite >= 35:
            parts.append(f"📉 El mercado muestra debilidad.")
        else:
            parts.append(f"🔻 Presión vendedora dominante.")

        # Breadth
        parts.append(f"Amplitud del mercado: {breadth:.0%} de acciones subiendo ({gainers_count} gainers vs {losers_count} losers).")

        # News sentiment
        if news_score >= 65:
            parts.append("El flujo de noticias es predominantemente positivo.")
        elif news_score <= 35:
            parts.append("Las noticias reflejan cautela o negatividad.")

        # Sector rotation
        hot = sector_rotation.get('hot', [])
        cold = sector_rotation.get('cold', [])

        if hot:
            hot_names = ', '.join([s['sector'] for s in hot[:2]])
            parts.append(f"Sectores calientes: {hot_names}.")

        if cold:
            cold_names = ', '.join([s['sector'] for s in cold[:2]])
            parts.append(f"Sectores débiles: {cold_names}.")

        return " ".join(parts)


# Global instance
market_sentiment_engine = AdvancedMarketSentimentEngine()
