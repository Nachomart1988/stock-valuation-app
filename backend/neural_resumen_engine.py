# backend/neural_resumen_engine.py
# Advanced Neural Reasoning Engine v2.0
# Full multi-source analysis with NLP, technical analysis, institutional flow, and Monte Carlo

import numpy as np
from typing import Dict, List, Optional, Tuple, Any, Union
from dataclasses import dataclass, field
from enum import Enum
import re
from collections import defaultdict
import math

# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS AND DATA STRUCTURES
# ═══════════════════════════════════════════════════════════════════════════════

class SignalType(Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"
    CAUTIONARY = "cautionary"

class Conviction(Enum):
    VERY_HIGH = 5
    HIGH = 4
    MODERATE = 3
    LOW = 2
    VERY_LOW = 1

@dataclass
class Signal:
    """A detected signal from any analysis layer"""
    source: str  # Which layer/source generated this
    signal_type: SignalType
    strength: float  # 0-1
    description: str
    data_point: Optional[str] = None  # The underlying data that triggered this

@dataclass
class LayerResult:
    """Result from a single reasoning layer"""
    layer_name: str
    layer_number: int
    score: float  # 0-100
    confidence: float  # 0-1
    weight: float  # How much this layer contributes
    signals: List[Signal] = field(default_factory=list)
    sub_scores: Dict[str, float] = field(default_factory=dict)
    reasoning: str = ""
    data_used: List[str] = field(default_factory=list)

# ═══════════════════════════════════════════════════════════════════════════════
# NLP SENTIMENT ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

class NewsSentimentAnalyzer:
    """
    Rule-based sentiment analyzer for financial news.
    Uses domain-specific lexicons and pattern matching.
    """

    def __init__(self):
        # Financial domain sentiment lexicons
        self.strong_positive = {
            'surge', 'soar', 'skyrocket', 'breakthrough', 'outperform', 'beat',
            'exceed', 'record', 'outstanding', 'exceptional', 'remarkable',
            'accelerate', 'boom', 'rally', 'upgrade', 'bullish', 'strong buy',
            'overweight', 'expansion', 'acquisition', 'buyback', 'dividend increase',
            'margin expansion', 'market share gain', 'blockbuster', 'blowout'
        }

        self.positive = {
            'grow', 'growth', 'increase', 'improve', 'positive', 'gain', 'profit',
            'revenue', 'earnings', 'beat', 'solid', 'stable', 'recovery', 'rebound',
            'upturn', 'momentum', 'opportunity', 'innovation', 'launch', 'partnership',
            'deal', 'contract', 'award', 'approval', 'expansion', 'hire', 'invest'
        }

        self.strong_negative = {
            'crash', 'collapse', 'plunge', 'plummet', 'disaster', 'bankruptcy',
            'fraud', 'scandal', 'investigation', 'lawsuit', 'downgrade', 'sell',
            'underperform', 'bearish', 'warning', 'miss', 'shortfall', 'layoff',
            'restructuring', 'writedown', 'impairment', 'default', 'recession'
        }

        self.negative = {
            'decline', 'decrease', 'loss', 'drop', 'fall', 'weak', 'concern',
            'risk', 'uncertainty', 'volatility', 'challenge', 'pressure', 'threat',
            'competition', 'delay', 'cut', 'reduce', 'suspend', 'terminate',
            'disappointing', 'below', 'miss', 'struggle', 'slowdown', 'headwind'
        }

        # Negation words that flip sentiment
        self.negations = {'not', 'no', 'never', 'neither', 'nobody', 'nothing',
                          'nowhere', 'hardly', 'barely', 'doesn\'t', 'don\'t',
                          'didn\'t', 'won\'t', 'wouldn\'t', 'couldn\'t', 'shouldn\'t'}

        # Intensifiers
        self.intensifiers = {'very', 'extremely', 'highly', 'significantly',
                             'substantially', 'dramatically', 'sharply', 'strongly'}

    def analyze_text(self, text: str) -> Tuple[float, float, List[str]]:
        """
        Analyze sentiment of a text.
        Returns: (sentiment_score -1 to 1, confidence 0-1, key_phrases)
        """
        if not text:
            return 0.0, 0.0, []

        text_lower = text.lower()
        words = re.findall(r'\b\w+\b', text_lower)

        score = 0.0
        matches = 0
        key_phrases = []

        # Check for multi-word phrases first
        for phrase in self.strong_positive:
            if phrase in text_lower:
                score += 2.0
                matches += 1
                key_phrases.append(f"+++ {phrase}")

        for phrase in self.strong_negative:
            if phrase in text_lower:
                score -= 2.0
                matches += 1
                key_phrases.append(f"--- {phrase}")

        # Single word analysis with context
        for i, word in enumerate(words):
            multiplier = 1.0

            # Check for negation in previous 3 words
            start_idx = max(0, i - 3)
            context = words[start_idx:i]
            if any(neg in context for neg in self.negations):
                multiplier = -0.8  # Flip and reduce confidence

            # Check for intensifiers
            if any(intens in context for intens in self.intensifiers):
                multiplier *= 1.5

            if word in self.positive:
                score += 1.0 * multiplier
                matches += 1
            elif word in self.negative:
                score -= 1.0 * multiplier
                matches += 1

        # Normalize score
        if matches > 0:
            normalized_score = np.tanh(score / (matches ** 0.5))  # Bounded -1 to 1
            confidence = min(1.0, matches / 10)  # More matches = more confident
        else:
            normalized_score = 0.0
            confidence = 0.0

        return normalized_score, confidence, key_phrases[:5]

    def analyze_news_batch(self, news_items: List[Dict]) -> Dict[str, Any]:
        """
        Analyze a batch of news items.
        Returns aggregate sentiment metrics.
        """
        if not news_items:
            return {
                'overall_sentiment': 0.0,
                'confidence': 0.0,
                'positive_count': 0,
                'negative_count': 0,
                'neutral_count': 0,
                'key_themes': [],
                'sentiment_trend': 'neutral',
                'news_count': 0
            }

        sentiments = []
        confidences = []
        all_phrases = []

        for item in news_items:
            title = item.get('title', '')
            text = item.get('text', '')[:500]  # Limit text length
            combined = f"{title} {text}"

            sentiment, conf, phrases = self.analyze_text(combined)
            sentiments.append(sentiment)
            confidences.append(conf)
            all_phrases.extend(phrases)

        avg_sentiment = np.mean(sentiments)
        avg_confidence = np.mean(confidences)

        positive_count = sum(1 for s in sentiments if s > 0.2)
        negative_count = sum(1 for s in sentiments if s < -0.2)
        neutral_count = len(sentiments) - positive_count - negative_count

        # Determine trend (are recent news more positive or negative?)
        if len(sentiments) >= 3:
            recent = np.mean(sentiments[:3])
            older = np.mean(sentiments[3:]) if len(sentiments) > 3 else avg_sentiment
            if recent > older + 0.1:
                trend = 'improving'
            elif recent < older - 0.1:
                trend = 'deteriorating'
            else:
                trend = 'stable'
        else:
            trend = 'insufficient_data'

        return {
            'overall_sentiment': float(avg_sentiment),
            'confidence': float(avg_confidence),
            'positive_count': positive_count,
            'negative_count': negative_count,
            'neutral_count': neutral_count,
            'key_themes': list(set(all_phrases))[:10],
            'sentiment_trend': trend,
            'news_count': len(news_items)
        }


# ═══════════════════════════════════════════════════════════════════════════════
# INSTITUTIONAL FLOW ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

class InstitutionalFlowAnalyzer:
    """
    Analyzes institutional and mutual fund holder data to detect
    smart money movements and conviction signals.

    Now enhanced to process:
    - symbol-positions-summary (quarterly 13F data)
    - insider-trading/statistics
    - institutional-ownership/extract-analytics
    """

    def analyze(self, holders_data: Dict) -> Dict[str, Any]:
        """
        Analyze holder data for institutional momentum signals.
        Enhanced to process new endpoint data formats.
        """
        if not holders_data:
            return {
                'institutional_score': 50,
                'signals': [],
                'net_flow': 'neutral',
                'conviction_level': 'unknown',
                'insider_sentiment': 'neutral',
                'quarterly_trend': 'unknown'
            }

        signals = []
        score = 50  # Base neutral score
        net_flow = 'unknown'

        # ═══════════════════════════════════════════════════════════════
        # SECTION 1: Process Symbol Positions Summary (13F Quarterly Data)
        # ═══════════════════════════════════════════════════════════════
        positions_summary = holders_data.get('positionsSummary', [])
        quarterly_trend = 'unknown'

        if positions_summary and len(positions_summary) > 0:
            # Analyze quarterly trends
            quarters_data = []
            for q_data in positions_summary:
                quarters_data.append({
                    'quarter': q_data.get('quarter', ''),
                    'investors': q_data.get('investorsHolding', 0),
                    'shares': q_data.get('totalShares', 0),
                    'put_call_ratio': q_data.get('putCallRatio', 1.0),
                    'total_invested': q_data.get('totalInvested', 0)
                })

            if len(quarters_data) >= 2:
                latest = quarters_data[0]
                previous = quarters_data[1]

                # Investor count trend
                investor_change = latest['investors'] - previous['investors']
                investor_change_pct = (investor_change / previous['investors'] * 100) if previous['investors'] > 0 else 0

                # Shares trend
                shares_change = latest['shares'] - previous['shares']
                shares_change_pct = (shares_change / previous['shares'] * 100) if previous['shares'] > 0 else 0

                # Put/Call ratio analysis (< 1 = bullish, > 1 = bearish)
                put_call = latest.get('put_call_ratio', 1.0)

                # Determine quarterly trend
                if investor_change_pct > 5 and shares_change_pct > 3:
                    quarterly_trend = 'strong_accumulation'
                    score += 20
                    signals.append(Signal(
                        source="Institutional-13F",
                        signal_type=SignalType.BULLISH,
                        strength=0.9,
                        description=f"Strong Q/Q accumulation: +{investor_change_pct:.1f}% investors, +{shares_change_pct:.1f}% shares",
                        data_point=f"Q: {latest['quarter']}"
                    ))
                elif investor_change_pct > 0 and shares_change_pct > 0:
                    quarterly_trend = 'accumulation'
                    score += 12
                    signals.append(Signal(
                        source="Institutional-13F",
                        signal_type=SignalType.BULLISH,
                        strength=0.7,
                        description=f"Q/Q accumulation: +{investor_change_pct:.1f}% investors"
                    ))
                elif investor_change_pct < -5 and shares_change_pct < -3:
                    quarterly_trend = 'strong_distribution'
                    score -= 18
                    signals.append(Signal(
                        source="Institutional-13F",
                        signal_type=SignalType.BEARISH,
                        strength=0.85,
                        description=f"Strong Q/Q distribution: {investor_change_pct:.1f}% investors, {shares_change_pct:.1f}% shares"
                    ))
                elif investor_change_pct < 0 or shares_change_pct < 0:
                    quarterly_trend = 'distribution'
                    score -= 10
                    signals.append(Signal(
                        source="Institutional-13F",
                        signal_type=SignalType.BEARISH,
                        strength=0.6,
                        description=f"Q/Q distribution: {investor_change_pct:.1f}% investors"
                    ))
                else:
                    quarterly_trend = 'stable'

                # Put/Call ratio signal
                if put_call < 0.7:
                    score += 8
                    signals.append(Signal(
                        source="Institutional-13F",
                        signal_type=SignalType.BULLISH,
                        strength=0.7,
                        description=f"Bullish options positioning (Put/Call: {put_call:.2f})"
                    ))
                elif put_call > 1.5:
                    score -= 8
                    signals.append(Signal(
                        source="Institutional-13F",
                        signal_type=SignalType.BEARISH,
                        strength=0.65,
                        description=f"Bearish options positioning (Put/Call: {put_call:.2f})"
                    ))

                # Multi-quarter trend (if 4 quarters available)
                if len(quarters_data) >= 4:
                    oldest = quarters_data[-1]
                    long_term_investor_change = ((latest['investors'] - oldest['investors']) / oldest['investors'] * 100) if oldest['investors'] > 0 else 0

                    if long_term_investor_change > 15:
                        score += 10
                        signals.append(Signal(
                            source="Institutional-13F",
                            signal_type=SignalType.BULLISH,
                            strength=0.85,
                            description=f"Strong YoY institutional growth: +{long_term_investor_change:.0f}% more investors"
                        ))
                    elif long_term_investor_change < -15:
                        score -= 10
                        signals.append(Signal(
                            source="Institutional-13F",
                            signal_type=SignalType.BEARISH,
                            strength=0.8,
                            description=f"Significant YoY institutional exodus: {long_term_investor_change:.0f}% investors"
                        ))

        # ═══════════════════════════════════════════════════════════════
        # SECTION 2: Process Insider Trading Statistics
        # ═══════════════════════════════════════════════════════════════
        insider_stats = holders_data.get('insiderStats', {})
        insider_sentiment = 'neutral'

        if insider_stats:
            buy_count = insider_stats.get('totalBought', 0)
            sell_count = insider_stats.get('totalSold', 0)
            buy_value = insider_stats.get('totalBoughtValue', 0)
            sell_value = insider_stats.get('totalSoldValue', 0)

            # Calculate net insider activity
            if buy_count + sell_count > 0:
                buy_ratio = buy_count / (buy_count + sell_count)

                if buy_ratio > 0.6:
                    insider_sentiment = 'bullish'
                    score += 15
                    signals.append(Signal(
                        source="Insider-Trading",
                        signal_type=SignalType.BULLISH,
                        strength=0.85,
                        description=f"Net insider buying: {buy_count} buys vs {sell_count} sells (${buy_value/1e6:.1f}M bought)",
                        data_point=f"Buy ratio: {buy_ratio:.0%}"
                    ))
                elif buy_ratio < 0.3:
                    insider_sentiment = 'bearish'
                    score -= 12
                    signals.append(Signal(
                        source="Insider-Trading",
                        signal_type=SignalType.BEARISH,
                        strength=0.75,
                        description=f"Net insider selling: {sell_count} sells vs {buy_count} buys (${sell_value/1e6:.1f}M sold)"
                    ))
                elif buy_ratio > 0.45:
                    insider_sentiment = 'mildly_bullish'
                    score += 5
                else:
                    insider_sentiment = 'mildly_bearish'
                    score -= 5

        # ═══════════════════════════════════════════════════════════════
        # SECTION 3: Process Institutional Ownership Analytics
        # ═══════════════════════════════════════════════════════════════
        ownership_analytics = holders_data.get('ownershipAnalytics', {})

        if ownership_analytics:
            ownership_pct = ownership_analytics.get('ownershipPercent', 0) or 0
            avg_holding_period = ownership_analytics.get('averageHoldingPeriod', 0)
            new_positions = ownership_analytics.get('newPositions', 0)
            increased_positions = ownership_analytics.get('increasedPositions', 0)
            decreased_positions = ownership_analytics.get('decreasedPositions', 0)
            sold_out = ownership_analytics.get('soldOutPositions', 0)

            # Ownership percentage signal
            if ownership_pct > 80:
                score += 12
                signals.append(Signal(
                    source="Institutional-Analytics",
                    signal_type=SignalType.BULLISH,
                    strength=0.8,
                    description=f"Very high institutional ownership ({ownership_pct:.1f}%)",
                    data_point=f"{ownership_pct:.1f}% institutional"
                ))
            elif ownership_pct > 60:
                score += 8
                signals.append(Signal(
                    source="Institutional-Analytics",
                    signal_type=SignalType.BULLISH,
                    strength=0.6,
                    description=f"Strong institutional backing ({ownership_pct:.1f}%)"
                ))
            elif ownership_pct < 20:
                score -= 8
                signals.append(Signal(
                    source="Institutional-Analytics",
                    signal_type=SignalType.CAUTIONARY,
                    strength=0.5,
                    description=f"Low institutional interest ({ownership_pct:.1f}%)"
                ))

            # Position changes analysis
            total_changes = new_positions + increased_positions + decreased_positions + sold_out
            if total_changes > 0:
                bullish_actions = new_positions + increased_positions
                bearish_actions = decreased_positions + sold_out

                if bullish_actions > bearish_actions * 1.5:
                    net_flow = 'accumulation'
                    score += 10
                    signals.append(Signal(
                        source="Institutional-Analytics",
                        signal_type=SignalType.BULLISH,
                        strength=0.75,
                        description=f"Net accumulation: {new_positions} new + {increased_positions} increased vs {decreased_positions} decreased + {sold_out} sold"
                    ))
                elif bearish_actions > bullish_actions * 1.5:
                    net_flow = 'distribution'
                    score -= 10
                    signals.append(Signal(
                        source="Institutional-Analytics",
                        signal_type=SignalType.BEARISH,
                        strength=0.7,
                        description=f"Net distribution: {decreased_positions} decreased + {sold_out} sold vs {new_positions} new + {increased_positions} increased"
                    ))
                else:
                    net_flow = 'mixed'

            # Holding period insight (longer = more conviction)
            if avg_holding_period > 365 * 3:  # > 3 years
                score += 5
                signals.append(Signal(
                    source="Institutional-Analytics",
                    signal_type=SignalType.BULLISH,
                    strength=0.5,
                    description=f"Long-term institutional commitment (avg {avg_holding_period/365:.1f} year holding)"
                ))
        else:
            # Fallback to old format if new analytics not available
            institutional = holders_data.get('institutional', []) or holders_data.get('institutionalHolders', [])
            summary = holders_data.get('summary', {}) or holders_data.get('ownershipSummary', {}) or {}

            ownership_pct = summary.get('institutionalOwnershipPercentage', 0) or summary.get('institutionalOwnership', 0) or 0
            if ownership_pct > 80:
                score += 12
                signals.append(Signal(
                    source="Institutional",
                    signal_type=SignalType.BULLISH,
                    strength=0.8,
                    description=f"Very high institutional ownership ({ownership_pct:.1f}%)"
                ))
            elif ownership_pct > 60:
                score += 8
            elif ownership_pct < 20:
                score -= 8

            # Analyze changes in holdings
            if institutional:
                increases = 0
                decreases = 0
                for holder in institutional[:20]:
                    change = holder.get('change', 0)
                    if change > 0:
                        increases += 1
                    elif change < 0:
                        decreases += 1

                net_flow = 'accumulation' if increases > decreases * 1.5 else \
                           'distribution' if decreases > increases * 1.5 else 'mixed'

        # ═══════════════════════════════════════════════════════════════
        # FINAL SCORING AND CONVICTION
        # ═══════════════════════════════════════════════════════════════

        # Clamp score
        score = max(0, min(100, score))

        # Determine conviction level
        if score >= 78:
            conviction = 'very_high'
        elif score >= 62:
            conviction = 'high'
        elif score >= 45:
            conviction = 'moderate'
        elif score >= 30:
            conviction = 'low'
        else:
            conviction = 'very_low'

        return {
            'institutional_score': score,
            'signals': signals,
            'net_flow': net_flow,
            'conviction_level': conviction,
            'insider_sentiment': insider_sentiment,
            'quarterly_trend': quarterly_trend,
            'ownership_pct': ownership_analytics.get('ownershipPercent', 0) if ownership_analytics else 0,
            'data_sources': {
                'has_13f_data': len(positions_summary) > 0,
                'has_insider_data': bool(insider_stats),
                'has_analytics': bool(ownership_analytics)
            }
        }


# ═══════════════════════════════════════════════════════════════════════════════
# TECHNICAL ANALYSIS ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class TechnicalAnalysisEngine:
    """
    Analyzes pivot points, support/resistance, and price position
    to generate technical signals.
    """

    def analyze(self, pivot_data: Dict, current_price: float) -> Dict[str, Any]:
        """
        Analyze technical setup based on pivot analysis.
        """
        if not pivot_data or not current_price:
            return {
                'technical_score': 50,
                'signals': [],
                'position_in_range': 0.5,
                'nearest_support': None,
                'nearest_resistance': None,
                'setup_quality': 'unknown'
            }

        signals = []
        score = 50

        # Extract pivot levels (handle different formats)
        support_levels = []
        resistance_levels = []

        # Format 1: standard pivot format
        if 'standard' in pivot_data:
            std = pivot_data['standard']
            support_levels.extend([std.get('s1'), std.get('s2'), std.get('s3')])
            resistance_levels.extend([std.get('r1'), std.get('r2'), std.get('r3')])

        # Format 2: support/resistance dict format (from page.tsx)
        if 'support' in pivot_data and isinstance(pivot_data['support'], dict):
            supp = pivot_data['support']
            support_levels.extend([supp.get('S1'), supp.get('S2'), supp.get('S3')])
        if 'resistance' in pivot_data and isinstance(pivot_data['resistance'], dict):
            res = pivot_data['resistance']
            resistance_levels.extend([res.get('R1'), res.get('R2'), res.get('R3')])

        # Format 3: 52-week high/low
        if 'high52Week' in pivot_data:
            resistance_levels.append(pivot_data['high52Week'])
        if 'low52Week' in pivot_data:
            support_levels.append(pivot_data['low52Week'])

        # Format 4: Fibonacci levels
        if 'fibonacci' in pivot_data and isinstance(pivot_data['fibonacci'], dict):
            fib = pivot_data['fibonacci']
            for key, val in fib.items():
                if val and val > 0:
                    if val < current_price:
                        support_levels.append(val)
                    else:
                        resistance_levels.append(val)

        # Try historical levels format
        if 'historicalLevels' in pivot_data:
            for level in pivot_data['historicalLevels']:
                price = level.get('price', 0)
                if price < current_price:
                    support_levels.append(price)
                else:
                    resistance_levels.append(price)

        # Clean and sort levels
        support_levels = sorted([s for s in support_levels if s and s > 0], reverse=True)
        resistance_levels = sorted([r for r in resistance_levels if r and r > 0])

        # Find nearest support and resistance
        nearest_support = support_levels[0] if support_levels else current_price * 0.95
        nearest_resistance = resistance_levels[0] if resistance_levels else current_price * 1.05

        # Calculate position within range
        range_size = nearest_resistance - nearest_support
        if range_size > 0:
            position = (current_price - nearest_support) / range_size
        else:
            position = 0.5

        # Score based on position
        if position < 0.2:  # Near support
            score += 20
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.BULLISH,
                strength=0.8,
                description=f"Trading near support (${nearest_support:.2f})",
                data_point=f"Position: {position*100:.0f}% of range"
            ))
        elif position < 0.35:
            score += 10
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.BULLISH,
                strength=0.5,
                description="In lower third of trading range"
            ))
        elif position > 0.8:  # Near resistance
            score -= 15
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.BEARISH,
                strength=0.6,
                description=f"Testing resistance at ${nearest_resistance:.2f}",
                data_point=f"Position: {position*100:.0f}% of range"
            ))
        elif position > 0.65:
            score -= 5
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.CAUTIONARY,
                strength=0.4,
                description="In upper third of trading range"
            ))

        # Risk/Reward ratio
        upside_to_resistance = (nearest_resistance - current_price) / current_price
        downside_to_support = (current_price - nearest_support) / current_price

        if downside_to_support > 0:
            risk_reward = upside_to_resistance / downside_to_support
        else:
            risk_reward = float('inf')

        if risk_reward > 3:
            score += 15
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.BULLISH,
                strength=0.9,
                description=f"Excellent risk/reward ratio ({risk_reward:.1f}:1)"
            ))
        elif risk_reward > 2:
            score += 8
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.BULLISH,
                strength=0.6,
                description=f"Favorable risk/reward ({risk_reward:.1f}:1)"
            ))
        elif risk_reward < 0.5:
            score -= 10
            signals.append(Signal(
                source="Technical",
                signal_type=SignalType.BEARISH,
                strength=0.5,
                description=f"Poor risk/reward ({risk_reward:.1f}:1)"
            ))

        # Fibonacci levels (if available)
        if 'fibonacci' in pivot_data:
            fib = pivot_data['fibonacci']
            fib_382 = fib.get('level_382')
            fib_618 = fib.get('level_618')

            if fib_382 and abs(current_price - fib_382) / current_price < 0.02:
                signals.append(Signal(
                    source="Technical",
                    signal_type=SignalType.BULLISH,
                    strength=0.7,
                    description="At 38.2% Fibonacci retracement level"
                ))
            elif fib_618 and abs(current_price - fib_618) / current_price < 0.02:
                signals.append(Signal(
                    source="Technical",
                    signal_type=SignalType.BULLISH,
                    strength=0.8,
                    description="At 61.8% Fibonacci golden ratio level"
                ))

        # Determine setup quality
        if score >= 70:
            setup_quality = 'excellent'
        elif score >= 58:
            setup_quality = 'good'
        elif score >= 45:
            setup_quality = 'neutral'
        elif score >= 35:
            setup_quality = 'weak'
        else:
            setup_quality = 'poor'

        return {
            'technical_score': max(0, min(100, score)),
            'signals': signals,
            'position_in_range': position,
            'nearest_support': nearest_support,
            'nearest_resistance': nearest_resistance,
            'risk_reward_ratio': risk_reward if risk_reward != float('inf') else 10.0,
            'setup_quality': setup_quality
        }


# ═══════════════════════════════════════════════════════════════════════════════
# MONTE CARLO SIMULATOR
# ═══════════════════════════════════════════════════════════════════════════════

class MonteCarloSimulator:
    """
    Monte Carlo simulation for price scenarios and probability analysis.
    """

    def __init__(self, n_simulations: int = 5000):
        self.n_simulations = n_simulations

    def simulate(self, current_price: float, target_price: float,
                 volatility: float = 0.25, time_horizon_years: float = 1.0,
                 drift: float = None) -> Dict[str, Any]:
        """
        Run Monte Carlo simulation for price scenarios.

        Args:
            current_price: Current stock price
            target_price: Target/fair value price
            volatility: Annual volatility (default 25%)
            time_horizon_years: Time horizon in years
            drift: Expected annual return (if None, calculated from target)
        """
        if current_price <= 0:
            return {
                'probability_reaching_target': 0.5,
                'expected_return': 0,
                'var_95': 0,
                'cvar_95': 0,
                'signals': []
            }

        # Calculate drift from target if not provided
        if drift is None:
            drift = np.log(target_price / current_price) / time_horizon_years

        # Time steps (monthly)
        n_steps = int(12 * time_horizon_years)
        dt = 1 / 12

        # Generate random paths using Geometric Brownian Motion
        np.random.seed(42)  # For reproducibility
        random_shocks = np.random.normal(0, 1, (self.n_simulations, n_steps))

        # Simulate paths
        price_paths = np.zeros((self.n_simulations, n_steps + 1))
        price_paths[:, 0] = current_price

        for t in range(n_steps):
            price_paths[:, t + 1] = price_paths[:, t] * np.exp(
                (drift - 0.5 * volatility ** 2) * dt +
                volatility * np.sqrt(dt) * random_shocks[:, t]
            )

        final_prices = price_paths[:, -1]

        # Calculate statistics
        returns = (final_prices - current_price) / current_price
        mean_return = np.mean(returns)
        std_return = np.std(returns)

        # Probability of reaching target
        prob_target = np.mean(final_prices >= target_price)

        # Probability of positive return
        prob_positive = np.mean(returns > 0)

        # Value at Risk (95%)
        var_95 = np.percentile(returns, 5)

        # Conditional VaR (Expected Shortfall)
        cvar_95 = np.mean(returns[returns <= var_95])

        # Percentiles
        p10 = np.percentile(final_prices, 10)
        p25 = np.percentile(final_prices, 25)
        p50 = np.percentile(final_prices, 50)
        p75 = np.percentile(final_prices, 75)
        p90 = np.percentile(final_prices, 90)

        signals = []

        if prob_target > 0.7:
            signals.append(Signal(
                source="MonteCarlo",
                signal_type=SignalType.BULLISH,
                strength=0.85,
                description=f"High probability ({prob_target*100:.0f}%) of reaching target"
            ))
        elif prob_target > 0.5:
            signals.append(Signal(
                source="MonteCarlo",
                signal_type=SignalType.BULLISH,
                strength=0.6,
                description=f"Favorable odds ({prob_target*100:.0f}%) of reaching target"
            ))
        elif prob_target < 0.3:
            signals.append(Signal(
                source="MonteCarlo",
                signal_type=SignalType.BEARISH,
                strength=0.6,
                description=f"Low probability ({prob_target*100:.0f}%) of reaching target"
            ))

        if var_95 < -0.3:
            signals.append(Signal(
                source="MonteCarlo",
                signal_type=SignalType.CAUTIONARY,
                strength=0.7,
                description=f"High downside risk (VaR 95%: {var_95*100:.0f}%)"
            ))

        return {
            'probability_reaching_target': float(prob_target),
            'probability_positive': float(prob_positive),
            'expected_return': float(mean_return),
            'return_std': float(std_return),
            'var_95': float(var_95),
            'cvar_95': float(cvar_95),
            'price_percentiles': {
                'p10': float(p10),
                'p25': float(p25),
                'p50': float(p50),
                'p75': float(p75),
                'p90': float(p90)
            },
            'signals': signals,
            'simulations_run': self.n_simulations
        }


# ═══════════════════════════════════════════════════════════════════════════════
# VALUATION ENSEMBLE
# ═══════════════════════════════════════════════════════════════════════════════

class ValuationEnsemble:
    """
    Combines multiple valuation models with dynamic weighting.
    """

    def analyze(self, valuation_data: Dict, current_price: float) -> Dict[str, Any]:
        """
        Analyze valuation from multiple models.
        """
        if not valuation_data:
            return {
                'ensemble_value': current_price,
                'upside_pct': 0,
                'valuation_score': 50,
                'signals': [],
                'model_agreement': 'unknown'
            }

        signals = []
        fair_value = valuation_data.get('fair_value', current_price)
        experts_used = valuation_data.get('experts_used', 1)
        confidence_interval = valuation_data.get('confidence_interval', [fair_value * 0.9, fair_value * 1.1])

        upside = (fair_value - current_price) / current_price if current_price > 0 else 0

        # Score based on upside
        score = 50 + (upside * 100)  # Base: 50, +1 per 1% upside
        score = max(0, min(100, score))

        # Signals based on upside magnitude
        if upside > 0.4:
            signals.append(Signal(
                source="Valuation",
                signal_type=SignalType.BULLISH,
                strength=0.95,
                description=f"Significantly undervalued ({upside*100:.0f}% upside)",
                data_point=f"Fair value: ${fair_value:.2f}"
            ))
        elif upside > 0.2:
            signals.append(Signal(
                source="Valuation",
                signal_type=SignalType.BULLISH,
                strength=0.75,
                description=f"Undervalued ({upside*100:.0f}% upside)"
            ))
        elif upside > 0.1:
            signals.append(Signal(
                source="Valuation",
                signal_type=SignalType.BULLISH,
                strength=0.5,
                description=f"Mildly undervalued ({upside*100:.0f}% upside)"
            ))
        elif upside < -0.2:
            signals.append(Signal(
                source="Valuation",
                signal_type=SignalType.BEARISH,
                strength=0.8,
                description=f"Overvalued ({abs(upside)*100:.0f}% downside risk)"
            ))
        elif upside < -0.1:
            signals.append(Signal(
                source="Valuation",
                signal_type=SignalType.CAUTIONARY,
                strength=0.5,
                description=f"Slightly overvalued ({abs(upside)*100:.0f}% premium)"
            ))

        # Model agreement/dispersion
        if confidence_interval and len(confidence_interval) >= 2:
            low, high = confidence_interval[0], confidence_interval[1]
            spread = (high - low) / fair_value if fair_value > 0 else 0

            if spread < 0.15:
                model_agreement = 'strong'
                signals.append(Signal(
                    source="Valuation",
                    signal_type=SignalType.BULLISH,
                    strength=0.6,
                    description="High model agreement (tight confidence interval)"
                ))
            elif spread > 0.4:
                model_agreement = 'weak'
                signals.append(Signal(
                    source="Valuation",
                    signal_type=SignalType.CAUTIONARY,
                    strength=0.5,
                    description="High valuation uncertainty (wide confidence interval)"
                ))
            else:
                model_agreement = 'moderate'
        else:
            model_agreement = 'unknown'

        # Experts used confidence boost
        if experts_used >= 5:
            score += 5
            signals.append(Signal(
                source="Valuation",
                signal_type=SignalType.NEUTRAL,
                strength=0.4,
                description=f"Robust analysis ({experts_used} valuation models used)"
            ))

        return {
            'ensemble_value': fair_value,
            'upside_pct': upside * 100,
            'valuation_score': max(0, min(100, score)),
            'confidence_interval': confidence_interval,
            'signals': signals,
            'model_agreement': model_agreement,
            'experts_used': experts_used
        }


# ═══════════════════════════════════════════════════════════════════════════════
# QUALITY ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

class QualityAnalyzer:
    """
    Deep analysis of company quality across multiple dimensions.
    """

    def analyze(self, quality_data: Dict) -> Dict[str, Any]:
        """
        Analyze company quality from CompanyQualityNet output.
        """
        if not quality_data:
            return {
                'quality_score': 50,
                'signals': [],
                'dimension_analysis': {},
                'quality_tier': 'unknown'
            }

        signals = []
        overall = quality_data.get('overallScore', 50)

        dimensions = {
            'profitability': quality_data.get('profitability', 50),
            'financialStrength': quality_data.get('financialStrength', 50),
            'efficiency': quality_data.get('efficiency', 50),
            'growth': quality_data.get('growth', 50),
            'moat': quality_data.get('moat', 50)
        }

        # Analyze each dimension
        dimension_analysis = {}
        for dim, score in dimensions.items():
            if score >= 80:
                tier = 'excellent'
                signals.append(Signal(
                    source="Quality",
                    signal_type=SignalType.BULLISH,
                    strength=0.8,
                    description=f"Excellent {dim.replace('financialStrength', 'financial strength')} ({score})"
                ))
            elif score >= 65:
                tier = 'good'
            elif score >= 50:
                tier = 'average'
            elif score >= 35:
                tier = 'weak'
                signals.append(Signal(
                    source="Quality",
                    signal_type=SignalType.CAUTIONARY,
                    strength=0.5,
                    description=f"Weak {dim.replace('financialStrength', 'financial strength')} ({score})"
                ))
            else:
                tier = 'poor'
                signals.append(Signal(
                    source="Quality",
                    signal_type=SignalType.BEARISH,
                    strength=0.7,
                    description=f"Poor {dim.replace('financialStrength', 'financial strength')} ({score})"
                ))

            dimension_analysis[dim] = {'score': score, 'tier': tier}

        # Check for consistency
        dim_values = list(dimensions.values())
        consistency = 1 - (np.std(dim_values) / 50)  # Lower std = more consistent

        if consistency > 0.8:
            signals.append(Signal(
                source="Quality",
                signal_type=SignalType.BULLISH,
                strength=0.5,
                description="Consistent quality across all dimensions"
            ))

        # Determine overall tier
        if overall >= 80:
            tier = 'exceptional'
        elif overall >= 65:
            tier = 'high_quality'
        elif overall >= 50:
            tier = 'average'
        elif overall >= 35:
            tier = 'below_average'
        else:
            tier = 'low_quality'

        return {
            'quality_score': overall,
            'signals': signals,
            'dimension_analysis': dimension_analysis,
            'quality_tier': tier,
            'consistency': consistency,
            'risk_level': quality_data.get('riskLevel', 'Medium')
        }


# ═══════════════════════════════════════════════════════════════════════════════
# GROWTH ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

class GrowthAnalyzer:
    """
    Analyzes sustainable growth rate and value creation potential.
    """

    def analyze(self, sgr: float, wacc: float, quality_data: Dict = None) -> Dict[str, Any]:
        """
        Analyze growth sustainability and value creation.
        """
        signals = []

        # Normalize rates
        sgr_pct = sgr * 100 if sgr < 1 else sgr
        wacc_pct = wacc * 100 if wacc < 1 else wacc

        # Value creation spread
        spread = sgr_pct - wacc_pct

        # Score calculation
        score = 50 + (spread * 5)  # +5 per 1% spread
        score = max(0, min(100, score))

        if spread > 5:
            signals.append(Signal(
                source="Growth",
                signal_type=SignalType.BULLISH,
                strength=0.9,
                description=f"Strong value creator (SGR {sgr_pct:.1f}% vs WACC {wacc_pct:.1f}%)",
                data_point=f"Spread: +{spread:.1f}%"
            ))
            value_creation = 'strong_creator'
        elif spread > 2:
            signals.append(Signal(
                source="Growth",
                signal_type=SignalType.BULLISH,
                strength=0.65,
                description=f"Value creator (SGR exceeds WACC by {spread:.1f}%)"
            ))
            value_creation = 'creator'
        elif spread > -2:
            signals.append(Signal(
                source="Growth",
                signal_type=SignalType.NEUTRAL,
                strength=0.4,
                description="Growth roughly matches cost of capital"
            ))
            value_creation = 'neutral'
        elif spread > -5:
            signals.append(Signal(
                source="Growth",
                signal_type=SignalType.CAUTIONARY,
                strength=0.5,
                description=f"Marginal value destroyer (WACC exceeds SGR by {abs(spread):.1f}%)"
            ))
            value_creation = 'marginal_destroyer'
        else:
            signals.append(Signal(
                source="Growth",
                signal_type=SignalType.BEARISH,
                strength=0.75,
                description=f"Value destroyer (WACC exceeds SGR by {abs(spread):.1f}%)"
            ))
            value_creation = 'destroyer'

        # Growth sustainability check
        if quality_data:
            profitability = quality_data.get('profitability', 50)
            if sgr_pct > 15 and profitability < 50:
                signals.append(Signal(
                    source="Growth",
                    signal_type=SignalType.CAUTIONARY,
                    strength=0.6,
                    description="High growth may not be sustainable with weak profitability"
                ))
                score -= 10

        return {
            'growth_score': max(0, min(100, score)),
            'sgr_pct': sgr_pct,
            'wacc_pct': wacc_pct,
            'spread': spread,
            'value_creation': value_creation,
            'signals': signals
        }


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYST FORECASTS ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

class ForecastAnalyzer:
    """
    Analyzes analyst forecasts and estimates for consensus view.
    """

    def analyze(self, forecasts: Any) -> Dict[str, Any]:
        """
        Analyze analyst forecasts.
        """
        if not forecasts:
            return {
                'forecast_score': 50,
                'signals': [],
                'consensus_view': 'unknown'
            }

        signals = []
        score = 50

        # Handle both list format (from page.tsx) and dict format
        if isinstance(forecasts, list):
            estimates = forecasts
        else:
            estimates = forecasts.get('estimates', [])
        if not estimates:
            return {
                'forecast_score': 50,
                'signals': [],
                'consensus_view': 'no_data'
            }

        # Get current and next year estimates
        current_year = estimates[0] if estimates else {}
        next_year = estimates[1] if len(estimates) > 1 else {}

        # Revenue growth forecast
        rev_current = current_year.get('revenueAvg', 0)
        rev_next = next_year.get('revenueAvg', 0)

        if rev_current > 0 and rev_next > 0:
            rev_growth = (rev_next - rev_current) / rev_current

            if rev_growth > 0.2:
                score += 15
                signals.append(Signal(
                    source="Forecasts",
                    signal_type=SignalType.BULLISH,
                    strength=0.75,
                    description=f"Strong revenue growth forecast ({rev_growth*100:.0f}%)"
                ))
            elif rev_growth > 0.1:
                score += 8
                signals.append(Signal(
                    source="Forecasts",
                    signal_type=SignalType.BULLISH,
                    strength=0.5,
                    description=f"Healthy revenue growth expected ({rev_growth*100:.0f}%)"
                ))
            elif rev_growth < 0:
                score -= 15
                signals.append(Signal(
                    source="Forecasts",
                    signal_type=SignalType.BEARISH,
                    strength=0.6,
                    description=f"Revenue decline expected ({rev_growth*100:.0f}%)"
                ))

        # EPS growth
        eps_current = current_year.get('epsAvg', 0)
        eps_next = next_year.get('epsAvg', 0)

        if eps_current > 0 and eps_next > 0:
            eps_growth = (eps_next - eps_current) / eps_current

            if eps_growth > 0.25:
                score += 15
                signals.append(Signal(
                    source="Forecasts",
                    signal_type=SignalType.BULLISH,
                    strength=0.8,
                    description=f"Strong earnings growth forecast ({eps_growth*100:.0f}%)"
                ))
            elif eps_growth < 0:
                score -= 10
                signals.append(Signal(
                    source="Forecasts",
                    signal_type=SignalType.BEARISH,
                    strength=0.5,
                    description=f"Earnings decline expected ({eps_growth*100:.0f}%)"
                ))

        # Analyst coverage
        num_analysts = current_year.get('numAnalystsRevenue', 0)
        if num_analysts > 20:
            signals.append(Signal(
                source="Forecasts",
                signal_type=SignalType.NEUTRAL,
                strength=0.3,
                description=f"Well-covered by analysts ({num_analysts})"
            ))
        elif num_analysts < 3:
            signals.append(Signal(
                source="Forecasts",
                signal_type=SignalType.CAUTIONARY,
                strength=0.4,
                description="Limited analyst coverage"
            ))

        # Determine consensus view
        if score >= 65:
            consensus = 'bullish'
        elif score >= 55:
            consensus = 'mildly_bullish'
        elif score >= 45:
            consensus = 'neutral'
        elif score >= 35:
            consensus = 'mildly_bearish'
        else:
            consensus = 'bearish'

        return {
            'forecast_score': max(0, min(100, score)),
            'signals': signals,
            'consensus_view': consensus,
            'analyst_count': num_analysts
        }


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN NEURAL REASONING ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class NeuralResumenEngine:
    """
    Advanced multi-layer reasoning engine that integrates all analysis components.

    Architecture (12 Layers):
    1. Data Ingestion & Validation
    2. News Sentiment Analysis (NLP)
    3. Institutional Flow Analysis
    4. Technical Analysis (Pivots)
    5. Valuation Ensemble Analysis
    6. Quality Analysis
    7. Growth & Value Creation Analysis
    8. Analyst Forecast Analysis
    9. Monte Carlo Simulation
    10. Cross-Signal Correlation
    11. Dynamic Weight Synthesis
    12. Final Recommendation Generation
    """

    def __init__(self):
        self.sentiment_analyzer = NewsSentimentAnalyzer()
        self.institutional_analyzer = InstitutionalFlowAnalyzer()
        self.technical_analyzer = TechnicalAnalysisEngine()
        self.monte_carlo = MonteCarloSimulator()
        self.valuation_analyzer = ValuationEnsemble()
        self.quality_analyzer = QualityAnalyzer()
        self.growth_analyzer = GrowthAnalyzer()
        self.forecast_analyzer = ForecastAnalyzer()

        self.layer_results: List[LayerResult] = []

    def analyze(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Main analysis pipeline."""
        self.layer_results = []

        ticker = data.get('ticker', 'UNKNOWN')
        current_price = data.get('currentPrice') or 100

        print(f"[NeuralEngine] Starting 12-layer analysis for {ticker}")

        # Layer 1: Data Ingestion
        ingestion_result = self._layer1_ingest(data)

        # Layer 2: News Sentiment
        news_result = self._layer2_news_sentiment(data.get('news', []))

        # Layer 3: Institutional Flow
        holders_result = self._layer3_institutional(data.get('holdersData'))

        # Layer 4: Technical Analysis
        technical_result = self._layer4_technical(data.get('pivotAnalysis'), current_price)

        # Layer 5: Valuation
        valuation_result = self._layer5_valuation(data.get('advanceValueNet'), current_price)

        # Layer 6: Quality
        quality_result = self._layer6_quality(data.get('companyQualityNet'))

        # Layer 7: Growth
        growth_result = self._layer7_growth(
            data.get('sustainableGrowthRate'),
            data.get('wacc'),
            data.get('companyQualityNet')
        )

        # Layer 8: Forecasts
        forecast_result = self._layer8_forecasts(data.get('forecasts'))

        # Layer 9: Monte Carlo
        target_price = valuation_result.sub_scores.get('fair_value', current_price)
        mc_result = self._layer9_monte_carlo(current_price, target_price)

        # Layer 10: Cross-Signal Correlation
        correlation_result = self._layer10_correlate()

        # Layer 11: Synthesis
        synthesis_result = self._layer11_synthesize()

        # Layer 12: Recommendation
        final_result = self._layer12_recommend(ticker, current_price)

        return final_result

    def _layer1_ingest(self, data: Dict) -> LayerResult:
        """Layer 1: Data Ingestion & Validation"""
        signals = []
        data_sources = []

        checks = [
            ('advanceValueNet', 'Valuation Models'),
            ('companyQualityNet', 'Quality Analysis'),
            ('sustainableGrowthRate', 'Growth Rate'),
            ('wacc', 'Cost of Capital'),
            ('dcfValuation', 'DCF Valuation'),
            ('monteCarlo', 'Monte Carlo'),
            ('pivotAnalysis', 'Technical Pivots'),
            ('holdersData', 'Institutional Data'),
            ('forecasts', 'Analyst Forecasts'),
            ('news', 'News Feed'),
        ]

        for key, name in checks:
            if data.get(key):
                data_sources.append(name)

        completeness = len(data_sources) / len(checks)

        if completeness >= 0.8:
            signals.append(Signal(
                source="Ingestion",
                signal_type=SignalType.BULLISH,
                strength=0.5,
                description=f"Comprehensive data available ({len(data_sources)}/{len(checks)} sources)"
            ))
        elif completeness < 0.4:
            signals.append(Signal(
                source="Ingestion",
                signal_type=SignalType.CAUTIONARY,
                strength=0.4,
                description=f"Limited data ({len(data_sources)}/{len(checks)} sources)"
            ))

        result = LayerResult(
            layer_name="Data Ingestion",
            layer_number=1,
            score=completeness * 100,
            confidence=0.5 + completeness * 0.4,
            weight=0.05,
            signals=signals,
            reasoning=f"Ingested {len(data_sources)} data sources: {', '.join(data_sources)}",
            data_used=data_sources
        )

        self.layer_results.append(result)
        return result

    def _layer2_news_sentiment(self, news: List[Dict]) -> LayerResult:
        """Layer 2: News Sentiment Analysis"""
        if not news:
            result = LayerResult(
                layer_name="News Sentiment",
                layer_number=2,
                score=50,
                confidence=0.0,
                weight=0.08,
                reasoning="No news data available"
            )
            self.layer_results.append(result)
            return result

        analysis = self.sentiment_analyzer.analyze_news_batch(news)

        sentiment = analysis['overall_sentiment']
        score = 50 + (sentiment * 50)  # Map -1,1 to 0-100

        signals = []
        if sentiment > 0.3:
            signals.append(Signal(
                source="News",
                signal_type=SignalType.BULLISH,
                strength=min(0.9, abs(sentiment)),
                description=f"Positive news sentiment ({analysis['positive_count']} positive vs {analysis['negative_count']} negative)"
            ))
        elif sentiment < -0.3:
            signals.append(Signal(
                source="News",
                signal_type=SignalType.BEARISH,
                strength=min(0.9, abs(sentiment)),
                description=f"Negative news sentiment ({analysis['negative_count']} negative vs {analysis['positive_count']} positive)"
            ))

        if analysis['sentiment_trend'] == 'improving':
            signals.append(Signal(
                source="News",
                signal_type=SignalType.BULLISH,
                strength=0.5,
                description="Sentiment trend improving"
            ))
        elif analysis['sentiment_trend'] == 'deteriorating':
            signals.append(Signal(
                source="News",
                signal_type=SignalType.BEARISH,
                strength=0.5,
                description="Sentiment trend deteriorating"
            ))

        result = LayerResult(
            layer_name="News Sentiment",
            layer_number=2,
            score=max(0, min(100, score)),
            confidence=analysis['confidence'],
            weight=0.08,
            signals=signals,
            sub_scores={
                'sentiment': sentiment,
                'positive_ratio': analysis['positive_count'] / max(1, analysis['news_count'])
            },
            reasoning=f"Analyzed {analysis['news_count']} news items. Sentiment: {sentiment:.2f}. Trend: {analysis['sentiment_trend']}",
            data_used=[f"{analysis['news_count']} news articles"]
        )

        self.layer_results.append(result)
        return result

    def _layer3_institutional(self, holders_data: Dict) -> LayerResult:
        """Layer 3: Institutional Flow Analysis"""
        analysis = self.institutional_analyzer.analyze(holders_data)

        result = LayerResult(
            layer_name="Institutional Flow",
            layer_number=3,
            score=analysis['institutional_score'],
            confidence=0.7 if holders_data else 0.0,
            weight=0.10,
            signals=analysis['signals'],
            sub_scores={
                'ownership_pct': analysis.get('ownership_pct', 0),
                'holder_count': analysis.get('holder_count', 0)
            },
            reasoning=f"Net flow: {analysis['net_flow']}. Conviction: {analysis['conviction_level']}",
            data_used=['Institutional holders', 'Mutual fund holders'] if holders_data else []
        )

        self.layer_results.append(result)
        return result

    def _layer4_technical(self, pivot_data: Dict, current_price: float) -> LayerResult:
        """Layer 4: Technical Analysis"""
        analysis = self.technical_analyzer.analyze(pivot_data, current_price)

        result = LayerResult(
            layer_name="Technical Analysis",
            layer_number=4,
            score=analysis['technical_score'],
            confidence=0.65 if pivot_data else 0.0,
            weight=0.08,
            signals=analysis['signals'],
            sub_scores={
                'position_in_range': analysis['position_in_range'],
                'risk_reward': analysis.get('risk_reward_ratio', 1.0)
            },
            reasoning=f"Setup: {analysis['setup_quality']}. Position: {analysis['position_in_range']*100:.0f}% of range",
            data_used=['Pivot points', 'Support/Resistance'] if pivot_data else []
        )

        self.layer_results.append(result)
        return result

    def _layer5_valuation(self, valuation_data: Dict, current_price: float) -> LayerResult:
        """Layer 5: Valuation Ensemble"""
        analysis = self.valuation_analyzer.analyze(valuation_data, current_price)

        result = LayerResult(
            layer_name="Valuation Ensemble",
            layer_number=5,
            score=analysis['valuation_score'],
            confidence=0.85 if valuation_data else 0.0,
            weight=0.20,
            signals=analysis['signals'],
            sub_scores={
                'fair_value': analysis['ensemble_value'],
                'upside_pct': analysis['upside_pct']
            },
            reasoning=f"Fair value: ${analysis['ensemble_value']:.2f}. Upside: {analysis['upside_pct']:.1f}%. Agreement: {analysis['model_agreement']}",
            data_used=[f"{analysis['experts_used']} valuation models"] if valuation_data else []
        )

        self.layer_results.append(result)
        return result

    def _layer6_quality(self, quality_data: Dict) -> LayerResult:
        """Layer 6: Quality Analysis"""
        analysis = self.quality_analyzer.analyze(quality_data)

        result = LayerResult(
            layer_name="Quality Analysis",
            layer_number=6,
            score=analysis['quality_score'],
            confidence=0.8 if quality_data else 0.0,
            weight=0.18,
            signals=analysis['signals'],
            sub_scores=analysis.get('dimension_analysis', {}),
            reasoning=f"Quality tier: {analysis['quality_tier']}. Consistency: {analysis.get('consistency', 0):.2f}",
            data_used=['5-dimension quality model'] if quality_data else []
        )

        self.layer_results.append(result)
        return result

    def _layer7_growth(self, sgr: float, wacc: float, quality_data: Dict) -> LayerResult:
        """Layer 7: Growth Analysis"""
        if sgr is None or wacc is None:
            result = LayerResult(
                layer_name="Growth Analysis",
                layer_number=7,
                score=50,
                confidence=0.0,
                weight=0.12,
                reasoning="Insufficient growth data"
            )
            self.layer_results.append(result)
            return result

        analysis = self.growth_analyzer.analyze(sgr, wacc, quality_data)

        result = LayerResult(
            layer_name="Growth Analysis",
            layer_number=7,
            score=analysis['growth_score'],
            confidence=0.75,
            weight=0.12,
            signals=analysis['signals'],
            sub_scores={
                'sgr': analysis['sgr_pct'],
                'wacc': analysis['wacc_pct'],
                'spread': analysis['spread']
            },
            reasoning=f"Value creation: {analysis['value_creation']}. SGR-WACC spread: {analysis['spread']:.1f}%",
            data_used=['Sustainable growth rate', 'WACC']
        )

        self.layer_results.append(result)
        return result

    def _layer8_forecasts(self, forecasts: Dict) -> LayerResult:
        """Layer 8: Analyst Forecasts"""
        analysis = self.forecast_analyzer.analyze(forecasts)

        result = LayerResult(
            layer_name="Analyst Forecasts",
            layer_number=8,
            score=analysis['forecast_score'],
            confidence=0.6 if forecasts else 0.0,
            weight=0.07,
            signals=analysis['signals'],
            reasoning=f"Consensus: {analysis['consensus_view']}",
            data_used=[f"{analysis.get('analyst_count', 0)} analyst estimates"] if forecasts else []
        )

        self.layer_results.append(result)
        return result

    def _layer9_monte_carlo(self, current_price: float, target_price: float) -> LayerResult:
        """Layer 9: Monte Carlo Simulation"""
        mc = self.monte_carlo.simulate(current_price, target_price)

        score = 50 + (mc['expected_return'] * 100)  # Base 50, adjust by expected return
        score = max(0, min(100, score))

        result = LayerResult(
            layer_name="Monte Carlo Simulation",
            layer_number=9,
            score=score,
            confidence=0.7,
            weight=0.05,
            signals=mc['signals'],
            sub_scores={
                'prob_target': mc['probability_reaching_target'],
                'prob_positive': mc['probability_positive'],
                'var_95': mc['var_95']
            },
            reasoning=f"Prob of reaching target: {mc['probability_reaching_target']*100:.0f}%. VaR 95%: {mc['var_95']*100:.0f}%",
            data_used=[f"{mc['simulations_run']} simulations"]
        )

        self.layer_results.append(result)
        return result

    def _layer10_correlate(self) -> LayerResult:
        """Layer 10: Cross-Signal Correlation"""
        signals = []
        adjustments = {}

        # Get layer results for correlation
        valuation_layer = next((l for l in self.layer_results if l.layer_name == "Valuation Ensemble"), None)
        quality_layer = next((l for l in self.layer_results if l.layer_name == "Quality Analysis"), None)
        growth_layer = next((l for l in self.layer_results if l.layer_name == "Growth Analysis"), None)
        technical_layer = next((l for l in self.layer_results if l.layer_name == "Technical Analysis"), None)
        news_layer = next((l for l in self.layer_results if l.layer_name == "News Sentiment"), None)
        institutional_layer = next((l for l in self.layer_results if l.layer_name == "Institutional Flow"), None)

        score = 50

        # Check valuation + quality alignment
        if valuation_layer and quality_layer:
            val_score = valuation_layer.score
            qual_score = quality_layer.score

            if val_score > 60 and qual_score > 65:
                signals.append(Signal(
                    source="Correlation",
                    signal_type=SignalType.BULLISH,
                    strength=0.85,
                    description="VALUE-QUALITY ALIGNMENT: Undervalued with strong fundamentals"
                ))
                score += 15
                adjustments['value_quality'] = 0.15
            elif val_score > 60 and qual_score < 45:
                signals.append(Signal(
                    source="Correlation",
                    signal_type=SignalType.CAUTIONARY,
                    strength=0.7,
                    description="VALUE TRAP RISK: Appears cheap but weak fundamentals"
                ))
                score -= 10
                adjustments['value_trap'] = -0.10

        # Check technical + momentum alignment
        if technical_layer and news_layer:
            tech_score = technical_layer.score
            news_score = news_layer.score

            if tech_score > 60 and news_score > 60:
                signals.append(Signal(
                    source="Correlation",
                    signal_type=SignalType.BULLISH,
                    strength=0.7,
                    description="MOMENTUM CONFIRMATION: Technical and sentiment aligned bullish"
                ))
                score += 10
                adjustments['momentum'] = 0.10

        # Check institutional + fundamentals alignment
        if institutional_layer and quality_layer:
            inst_score = institutional_layer.score
            qual_score = quality_layer.score

            if inst_score > 65 and qual_score > 65:
                signals.append(Signal(
                    source="Correlation",
                    signal_type=SignalType.BULLISH,
                    strength=0.75,
                    description="SMART MONEY VALIDATED: Strong institutional interest in quality company"
                ))
                score += 10
                adjustments['smart_money'] = 0.10
            elif inst_score < 40 and qual_score > 70:
                signals.append(Signal(
                    source="Correlation",
                    signal_type=SignalType.NEUTRAL,
                    strength=0.5,
                    description="UNDISCOVERED GEM: High quality but low institutional awareness"
                ))
                adjustments['undiscovered'] = 0.05

        # Growth + profitability sustainability check
        if growth_layer and quality_layer:
            growth_score = growth_layer.score
            qual_score = quality_layer.score

            if growth_score > 70 and qual_score < 50:
                signals.append(Signal(
                    source="Correlation",
                    signal_type=SignalType.CAUTIONARY,
                    strength=0.65,
                    description="SUSTAINABILITY CONCERN: High growth with weak fundamentals"
                ))
                score -= 8
                adjustments['sustainability'] = -0.08

        result = LayerResult(
            layer_name="Cross-Signal Correlation",
            layer_number=10,
            score=max(0, min(100, score)),
            confidence=0.8,
            weight=0.07,
            signals=signals,
            sub_scores=adjustments,
            reasoning=f"Found {len(signals)} cross-signal patterns",
            data_used=["All previous layers"]
        )

        self.layer_results.append(result)
        return result

    def _layer11_synthesize(self) -> LayerResult:
        """Layer 11: Dynamic Weight Synthesis"""
        total_score = 0
        total_weight = 0
        component_scores = {}

        for layer in self.layer_results:
            if layer.layer_number < 11:  # Don't include synthesis layer
                weighted_score = layer.score * layer.weight * layer.confidence
                total_score += weighted_score
                total_weight += layer.weight * layer.confidence

                component_scores[layer.layer_name] = {
                    'raw_score': layer.score,
                    'weight': layer.weight,
                    'confidence': layer.confidence,
                    'weighted': weighted_score
                }

        final_score = total_score / total_weight if total_weight > 0 else 50

        result = LayerResult(
            layer_name="Dynamic Synthesis",
            layer_number=11,
            score=final_score,
            confidence=min(0.95, total_weight),
            weight=1.0,
            sub_scores={'components': component_scores},
            reasoning=f"Synthesized {len(component_scores)} components. Total effective weight: {total_weight:.2f}",
            data_used=["All 10 analysis layers"]
        )

        self.layer_results.append(result)
        return result

    def _layer12_recommend(self, ticker: str, current_price: float) -> Dict[str, Any]:
        """Layer 12: Final Recommendation Generation"""
        synthesis = self.layer_results[-1]
        final_score = synthesis.score

        # Gather all signals
        all_signals = []
        for layer in self.layer_results:
            all_signals.extend(layer.signals)

        bullish_signals = [s for s in all_signals if s.signal_type == SignalType.BULLISH]
        bearish_signals = [s for s in all_signals if s.signal_type == SignalType.BEARISH]
        cautionary_signals = [s for s in all_signals if s.signal_type == SignalType.CAUTIONARY]

        # Determine recommendation
        if final_score >= 72:
            recommendation = "Strong Buy"
            conviction = min(95, int(70 + (final_score - 72) * 2))
        elif final_score >= 58:
            recommendation = "Buy"
            conviction = min(85, int(55 + (final_score - 58) * 1.5))
        elif final_score >= 45:
            recommendation = "Hold"
            conviction = int(50 + (final_score - 50) * 0.5)
        elif final_score >= 35:
            recommendation = "Sell"
            conviction = int(60 + (45 - final_score) * 1.5)
        else:
            recommendation = "Strong Sell"
            conviction = min(90, int(70 + (35 - final_score) * 2))

        # Get target price from valuation layer
        valuation_layer = next((l for l in self.layer_results if l.layer_name == "Valuation Ensemble"), None)
        if valuation_layer and 'fair_value' in valuation_layer.sub_scores:
            target_price = valuation_layer.sub_scores['fair_value']
        else:
            target_price = current_price * (1 + (final_score - 50) / 100)

        upside_pct = ((target_price - current_price) / current_price) * 100 if current_price > 0 else 0

        # Target range from Monte Carlo
        mc_layer = next((l for l in self.layer_results if l.layer_name == "Monte Carlo Simulation"), None)
        if mc_layer and 'prob_target' in mc_layer.sub_scores:
            target_low = target_price * 0.85
            target_high = target_price * 1.15
        else:
            target_low = target_price * 0.90
            target_high = target_price * 1.10

        # Risk level from quality analysis
        quality_layer = next((l for l in self.layer_results if l.layer_name == "Quality Analysis"), None)
        if quality_layer:
            if quality_layer.score >= 70:
                risk_level = "Low"
            elif quality_layer.score >= 50:
                risk_level = "Moderate"
            elif quality_layer.score >= 35:
                risk_level = "Elevated"
            else:
                risk_level = "High"
        else:
            risk_level = "Moderate"

        # Margin of safety
        if upside_pct > 40:
            margin = "Muy Alto (>40%)"
        elif upside_pct > 25:
            margin = "Alto (25-40%)"
        elif upside_pct > 15:
            margin = "Moderado (15-25%)"
        elif upside_pct > 5:
            margin = "Bajo (5-15%)"
        else:
            margin = "Mínimo (<5%)" if upside_pct > 0 else "Negativo"

        # Get dimension scores
        dimension_scores = {}
        if quality_layer and quality_layer.sub_scores:
            for dim, data in quality_layer.sub_scores.items():
                if isinstance(data, dict) and 'score' in data:
                    dimension_scores[dim.replace('financialStrength', 'Financial Strength')] = data['score']

        # Add synthesis-derived dimensions
        dimension_scores['Valuation'] = int(valuation_layer.score) if valuation_layer else 50
        dimension_scores['Momentum'] = int(
            next((l.score for l in self.layer_results if l.layer_name == "News Sentiment"), 50)
        )
        dimension_scores['Technical'] = int(
            next((l.score for l in self.layer_results if l.layer_name == "Technical Analysis"), 50)
        )
        dimension_scores['Institutional'] = int(
            next((l.score for l in self.layer_results if l.layer_name == "Institutional Flow"), 50)
        )

        # Generate narrative
        quality_desc = "excepcional" if final_score >= 75 else "sólida" if final_score >= 60 else "aceptable" if final_score >= 45 else "débil"

        summary_text = (
            f"{ticker} presenta una oportunidad de inversión {quality_desc} con un score integrado de {final_score:.0f}/100, "
            f"basado en un análisis de 12 capas neuronales que procesó {sum(1 for l in self.layer_results if l.confidence > 0)} fuentes de datos activas. "
        )

        if bullish_signals:
            top_bullish = sorted(bullish_signals, key=lambda s: s.strength, reverse=True)[:2]
            summary_text += f"Señales positivas: {top_bullish[0].description}. "

        if cautionary_signals:
            summary_text += f"Precaución: {cautionary_signals[0].description}. "

        summary_text += f"El precio objetivo de ${target_price:.2f} implica un {'potencial alcista' if upside_pct > 0 else 'riesgo de caída'} del {abs(upside_pct):.1f}%."

        # Actionable advice
        if recommendation in ["Strong Buy", "Buy"]:
            entry = current_price * 0.97
            stop_loss = current_price * 0.88
            actionable = (
                f"ACUMULAR: Entrada óptima en ${entry:.2f} (3% descuento). "
                f"Objetivo: ${target_price:.2f} (+{upside_pct:.0f}%). "
                f"Stop-loss: ${stop_loss:.2f} (-12%). "
                f"Horizonte: 12-18 meses."
            )
        elif recommendation == "Hold":
            actionable = (
                f"MANTENER: Posición actual justificada. "
                f"Monitorear catalizadores. Tomar ganancias parciales si supera ${target_high:.2f}. "
                f"Re-evaluar si rompe ${current_price * 0.92:.2f}."
            )
        else:
            actionable = (
                f"REDUCIR: Vender {abs(upside_pct):.0f}% de posición inmediatamente. "
                f"Resto en rebotes técnicos hacia ${current_price * 1.05:.2f}. "
                f"No promediar a la baja."
            )

        # Build chain of thought
        chain_of_thought = []
        for layer in self.layer_results:
            chain_of_thought.append({
                "step": layer.layer_number,
                "layer": layer.layer_name,
                "analysis": layer.reasoning,
                "score": round(layer.score, 1),
                "confidence": round(layer.confidence * 100, 0),
                "weight": round(layer.weight * 100, 1),
                "key_signals": [
                    {"type": s.signal_type.value, "description": s.description, "strength": round(s.strength, 2)}
                    for s in layer.signals[:3]
                ],
                "data_used": layer.data_used
            })

        # Synthesis details
        synthesis_details = {
            "componentScores": {},
            "appliedWeights": {},
            "rawScore": round(final_score, 1),
            "finalScore": round(final_score, 1),
            "confidence": round(synthesis.confidence * 100, 1)
        }

        for layer in self.layer_results[:-2]:  # Exclude synthesis and correlation layers
            synthesis_details["componentScores"][layer.layer_name] = round(layer.score, 1)
            synthesis_details["appliedWeights"][layer.layer_name] = round(layer.weight * 100, 1)

        # Data quality
        active_sources = sum(1 for l in self.layer_results if l.confidence > 0)
        data_quality = {
            "completeness": round((active_sources / 12) * 100, 0),
            "sourcesUsed": active_sources,
            "totalSources": 12,
            "layersProcessed": len(self.layer_results)
        }

        # Risks and catalysts
        key_risks = [s.description for s in bearish_signals + cautionary_signals][:5]
        if not key_risks:
            key_risks = [
                "Riesgo macroeconómico general",
                "Volatilidad de mercado",
                "Ejecución de estrategia corporativa"
            ]

        catalysts = [s.description for s in bullish_signals][:5]
        if not catalysts:
            catalysts = [
                "Potencial superación de estimaciones",
                "Expansión de múltiplos",
                "Mejora operativa"
            ]

        return {
            "finalRecommendation": recommendation,
            "conviction": conviction,
            "targetPrice": round(target_price, 2),
            "targetRange": [round(target_low, 2), round(target_high, 2)],
            "upsidePct": round(upside_pct, 1),
            "timeHorizon": "12-18 meses",
            "marginOfSafety": margin,
            "overallRisk": risk_level,
            "riskLevel": risk_level,
            "keyRisks": key_risks,
            "catalysts": catalysts,
            "dimensionScores": dimension_scores,
            "summaryText": summary_text,
            "actionableAdvice": actionable,
            "chainOfThought": chain_of_thought,
            "synthesisDetails": synthesis_details,
            "dataQuality": data_quality,
            "signalSummary": {
                "bullish": len(bullish_signals),
                "bearish": len(bearish_signals),
                "cautionary": len(cautionary_signals),
                "total": len(all_signals)
            }
        }


# Global instance
neural_engine = NeuralResumenEngine()
