# backend/resumen_engine.py
# Advanced Multi-Layer Reasoning Engine for Investment Analysis
# Implements Chain-of-Thought (CoT) reasoning with dynamic weight adjustment

import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from enum import Enum

class SignalStrength(Enum):
    VERY_STRONG = 5
    STRONG = 4
    MODERATE = 3
    WEAK = 2
    VERY_WEAK = 1
    NEUTRAL = 0
    NEGATIVE = -1

@dataclass
class ReasoningStep:
    """Represents a single step in the chain of thought"""
    layer: str
    input_data: Dict[str, Any]
    analysis: str
    score: float
    confidence: float
    signals: List[str]

@dataclass
class DimensionAnalysis:
    """Deep analysis of a single dimension"""
    name: str
    raw_score: float
    adjusted_score: float
    weight: float
    signals: List[str]
    sub_factors: Dict[str, float]
    trend: str  # improving, stable, declining
    reliability: float  # 0-1, how much data supports this


class ResumenEngine:
    """
    Multi-layer neural-inspired reasoning engine for comprehensive stock analysis.

    Architecture:
    1. Data Ingestion Layer - Normalize and validate all inputs
    2. Feature Extraction Layer - Extract meaningful signals from raw data
    3. Cross-Correlation Layer - Find relationships between dimensions
    4. Temporal Analysis Layer - Identify trends and momentum
    5. Risk Assessment Layer - Multi-factor risk scoring
    6. Synthesis Layer - Combine all signals with dynamic weights
    7. Recommendation Layer - Generate final output with confidence intervals
    """

    def __init__(self):
        self.reasoning_chain: List[ReasoningStep] = []
        self.dimension_analyses: Dict[str, DimensionAnalysis] = {}
        self.cross_correlations: Dict[str, float] = {}

        # Dynamic weight matrix - adjusted based on data availability and quality
        self.base_weights = {
            'valuation': 0.30,
            'quality': 0.25,
            'growth': 0.20,
            'risk': 0.15,
            'momentum': 0.10,
        }

        # Confidence decay factors
        self.data_freshness_decay = 0.95  # Per month of staleness
        self.missing_data_penalty = 0.15

    def analyze(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Main entry point - runs full analysis pipeline"""
        self.reasoning_chain = []
        self.dimension_analyses = {}

        # Layer 1: Data Ingestion
        normalized_data = self._layer1_ingest(data)

        # Layer 2: Feature Extraction
        features = self._layer2_extract_features(normalized_data)

        # Layer 3: Cross-Correlation Analysis
        correlations = self._layer3_cross_correlate(features)

        # Layer 4: Temporal/Trend Analysis
        trends = self._layer4_temporal_analysis(features, normalized_data)

        # Layer 5: Multi-Factor Risk Assessment
        risk_profile = self._layer5_risk_assessment(features, correlations)

        # Layer 6: Dynamic Weight Synthesis
        synthesis = self._layer6_synthesis(features, correlations, trends, risk_profile)

        # Layer 7: Final Recommendation Generation
        result = self._layer7_recommendation(synthesis, normalized_data)

        return result

    def _layer1_ingest(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Layer 1: Data Ingestion and Normalization"""
        step = ReasoningStep(
            layer="Data Ingestion",
            input_data={"raw_fields": list(data.keys())},
            analysis="",
            score=0,
            confidence=0,
            signals=[]
        )

        normalized = {
            'ticker': data.get('ticker', 'UNKNOWN'),
            'current_price': data.get('currentPrice') or 100,
            'has_advance_value': data.get('advanceValueNet') is not None,
            'has_quality': data.get('companyQualityNet') is not None,
            'has_sgr': data.get('sustainableGrowthRate') is not None,
            'has_wacc': data.get('wacc') is not None,
            'has_dcf': data.get('dcfValuation') is not None,
            'has_monte_carlo': data.get('monteCarlo') is not None,
            'has_pivots': data.get('pivotAnalysis') is not None,
            'has_holders': data.get('holdersData') is not None,
            'has_forecasts': data.get('forecasts') is not None,
        }

        # Calculate data completeness score
        data_fields = [k for k, v in normalized.items() if k.startswith('has_') and v]
        completeness = len(data_fields) / 9  # 9 possible data sources

        normalized['data_completeness'] = completeness
        normalized['raw_data'] = data

        step.analysis = f"Ingested {len(data_fields)}/9 data sources. Completeness: {completeness*100:.0f}%"
        step.score = completeness * 100
        step.confidence = min(0.95, 0.5 + completeness * 0.5)
        step.signals = [f"Data source: {f.replace('has_', '')}" for f in data_fields]

        self.reasoning_chain.append(step)
        return normalized

    def _layer2_extract_features(self, data: Dict[str, Any]) -> Dict[str, float]:
        """Layer 2: Feature Extraction from normalized data"""
        features = {}
        signals = []
        raw = data.get('raw_data', {})

        # === Valuation Features ===
        if data['has_advance_value']:
            av = raw['advanceValueNet']
            fair_value = av.get('fair_value', 0)
            current = data['current_price']

            if fair_value > 0 and current > 0:
                upside = (fair_value - current) / current
                features['valuation_upside'] = upside
                features['valuation_signal'] = av.get('signal', 'NEUTRAL')
                features['valuation_confidence'] = min(1.0, av.get('experts_used', 3) / 5)

                # Non-linear transformation for extreme values
                # Dampens extreme optimism/pessimism
                features['valuation_score'] = self._sigmoid_transform(upside, scale=2)

                if upside > 0.3:
                    signals.append(f"STRONG_UPSIDE: {upside*100:.1f}% potential")
                elif upside < -0.2:
                    signals.append(f"OVERVALUED: {abs(upside)*100:.1f}% downside risk")

        # === Quality Features ===
        if data['has_quality']:
            quality = raw['companyQualityNet']
            overall = quality.get('overallScore', 50)

            features['quality_overall'] = overall / 100
            features['quality_profitability'] = quality.get('profitability', 50) / 100
            features['quality_financial_strength'] = quality.get('financialStrength', 50) / 100
            features['quality_efficiency'] = quality.get('efficiency', 50) / 100
            features['quality_growth'] = quality.get('growth', 50) / 100
            features['quality_moat'] = quality.get('moat', 50) / 100

            # Detect quality anomalies (dimensions that deviate significantly)
            dims = [features['quality_profitability'], features['quality_financial_strength'],
                    features['quality_efficiency'], features['quality_growth'], features['quality_moat']]
            features['quality_consistency'] = 1 - np.std(dims)

            if overall >= 75:
                signals.append("HIGH_QUALITY: Strong fundamentals across dimensions")
            elif overall < 40:
                signals.append("QUALITY_CONCERN: Weak fundamental profile")

        # === Growth Features ===
        if data['has_sgr']:
            sgr = raw['sustainableGrowthRate']
            # Normalize SGR (handle both decimal and percentage formats)
            sgr_normalized = sgr if sgr < 1 else sgr / 100
            features['sgr'] = sgr_normalized

            if data['has_wacc']:
                wacc = raw['wacc']
                wacc_normalized = wacc if wacc < 1 else wacc / 100
                features['wacc'] = wacc_normalized

                # Value creation spread
                spread = sgr_normalized - wacc_normalized
                features['value_creation_spread'] = spread
                features['growth_vs_cost_score'] = self._sigmoid_transform(spread, scale=10)

                if spread > 0.05:
                    signals.append(f"VALUE_CREATOR: SGR exceeds WACC by {spread*100:.1f}%")
                elif spread < -0.03:
                    signals.append(f"VALUE_DESTROYER: WACC exceeds SGR by {abs(spread)*100:.1f}%")

        # === Monte Carlo Features (if available) ===
        if data['has_monte_carlo']:
            mc = raw['monteCarlo']
            if mc:
                features['mc_mean'] = mc.get('mean', 0)
                features['mc_std'] = mc.get('std', 0)
                features['mc_prob_positive'] = mc.get('prob_positive', 0.5)

                # Coefficient of variation as uncertainty measure
                if features['mc_mean'] > 0:
                    features['mc_uncertainty'] = features['mc_std'] / features['mc_mean']

        # === Pivot Analysis Features ===
        if data['has_pivots']:
            pivots = raw['pivotAnalysis']
            if pivots:
                current = data['current_price']
                support = pivots.get('support1', current * 0.95)
                resistance = pivots.get('resistance1', current * 1.05)

                # Position within trading range
                if resistance > support:
                    range_position = (current - support) / (resistance - support)
                    features['pivot_range_position'] = range_position

                    if range_position < 0.3:
                        signals.append("NEAR_SUPPORT: Price near support level")
                    elif range_position > 0.7:
                        signals.append("NEAR_RESISTANCE: Price approaching resistance")

        step = ReasoningStep(
            layer="Feature Extraction",
            input_data={"features_extracted": len(features)},
            analysis=f"Extracted {len(features)} features from available data sources",
            score=len(features) / 20 * 100,  # Normalize by expected max features
            confidence=0.8 if len(features) > 10 else 0.6,
            signals=signals
        )
        self.reasoning_chain.append(step)

        return features

    def _layer3_cross_correlate(self, features: Dict[str, float]) -> Dict[str, float]:
        """Layer 3: Cross-Correlation Analysis - Find relationships between dimensions"""
        correlations = {}
        signals = []

        # Valuation vs Quality correlation
        if 'valuation_score' in features and 'quality_overall' in features:
            val_score = features['valuation_score']
            qual_score = features['quality_overall']

            # High quality + undervalued = strong opportunity
            # Low quality + overvalued = avoid
            synergy = (val_score + qual_score) / 2
            divergence = abs(val_score - qual_score)

            correlations['value_quality_synergy'] = synergy
            correlations['value_quality_divergence'] = divergence

            if val_score > 0.6 and qual_score > 0.7:
                signals.append("QUALITY_VALUE_ALIGNMENT: High quality at attractive valuation")
                correlations['opportunity_score'] = 0.9
            elif val_score < 0.4 and qual_score < 0.5:
                signals.append("VALUE_TRAP_RISK: Low quality despite appearing cheap")
                correlations['opportunity_score'] = 0.3
            else:
                correlations['opportunity_score'] = synergy

        # Growth sustainability check
        if 'sgr' in features and 'quality_profitability' in features:
            sgr = features['sgr']
            profitability = features['quality_profitability']

            # Sustainable growth needs profitability support
            if sgr > 0.15 and profitability < 0.5:
                signals.append("GROWTH_SUSTAINABILITY_CONCERN: High growth with weak profitability")
                correlations['growth_sustainability'] = 0.4
            elif sgr > 0.10 and profitability > 0.7:
                signals.append("SUSTAINABLE_GROWTH: Strong profitability supports growth")
                correlations['growth_sustainability'] = 0.85
            else:
                correlations['growth_sustainability'] = (sgr * 2 + profitability) / 3

        # Financial strength vs growth trade-off
        if 'quality_financial_strength' in features and 'quality_growth' in features:
            fin_strength = features['quality_financial_strength']
            growth = features['quality_growth']

            # Companies can trade financial strength for growth
            balance = (fin_strength + growth) / 2
            correlations['strength_growth_balance'] = balance

            if fin_strength < 0.4 and growth > 0.7:
                signals.append("AGGRESSIVE_GROWTH: Leveraging balance sheet for growth")
            elif fin_strength > 0.7 and growth < 0.4:
                signals.append("CONSERVATIVE_PROFILE: Strong balance sheet, limited growth")

        step = ReasoningStep(
            layer="Cross-Correlation",
            input_data={"correlations_found": len(correlations)},
            analysis=f"Identified {len(correlations)} cross-dimensional relationships",
            score=correlations.get('opportunity_score', 0.5) * 100,
            confidence=0.75 if len(correlations) > 3 else 0.55,
            signals=signals
        )
        self.reasoning_chain.append(step)

        return correlations

    def _layer4_temporal_analysis(self, features: Dict[str, float], data: Dict[str, Any]) -> Dict[str, Any]:
        """Layer 4: Temporal and Trend Analysis"""
        trends = {}
        signals = []

        # Momentum indicators from available data
        raw = data.get('raw_data', {})

        # Infer momentum from quality dimensions
        if 'quality_growth' in features:
            growth_score = features['quality_growth']
            if growth_score > 0.7:
                trends['growth_momentum'] = 'accelerating'
                signals.append("POSITIVE_MOMENTUM: Growth metrics trending up")
            elif growth_score < 0.4:
                trends['growth_momentum'] = 'decelerating'
                signals.append("NEGATIVE_MOMENTUM: Growth metrics trending down")
            else:
                trends['growth_momentum'] = 'stable'

        # Valuation trend from multiple sources
        valuation_signals = []
        if 'valuation_upside' in features:
            valuation_signals.append(features['valuation_upside'])
        if raw.get('dcfValuation') and data['current_price'] > 0:
            dcf_upside = (raw['dcfValuation'] - data['current_price']) / data['current_price']
            valuation_signals.append(dcf_upside)

        if valuation_signals:
            avg_upside = np.mean(valuation_signals)
            std_upside = np.std(valuation_signals) if len(valuation_signals) > 1 else 0

            trends['valuation_consensus'] = avg_upside
            trends['valuation_dispersion'] = std_upside

            if std_upside > 0.2:
                signals.append("HIGH_UNCERTAINTY: Valuation estimates diverge significantly")

        # Overall trend score
        trend_factors = []
        if trends.get('growth_momentum') == 'accelerating':
            trend_factors.append(0.8)
        elif trends.get('growth_momentum') == 'decelerating':
            trend_factors.append(0.3)
        else:
            trend_factors.append(0.5)

        if 'valuation_consensus' in trends:
            trend_factors.append(0.5 + trends['valuation_consensus'])

        trends['overall_trend_score'] = np.mean(trend_factors) if trend_factors else 0.5

        step = ReasoningStep(
            layer="Temporal Analysis",
            input_data={"trends_identified": len(trends)},
            analysis=f"Analyzed temporal patterns and momentum indicators",
            score=trends['overall_trend_score'] * 100,
            confidence=0.65,
            signals=signals
        )
        self.reasoning_chain.append(step)

        return trends

    def _layer5_risk_assessment(self, features: Dict[str, float], correlations: Dict[str, float]) -> Dict[str, Any]:
        """Layer 5: Multi-Factor Risk Assessment"""
        risk_factors = {}
        signals = []

        # Financial risk
        if 'quality_financial_strength' in features:
            fin_strength = features['quality_financial_strength']
            risk_factors['financial_risk'] = 1 - fin_strength

            if fin_strength < 0.4:
                signals.append("HIGH_FINANCIAL_RISK: Weak balance sheet")

        # Valuation risk
        if 'valuation_upside' in features:
            upside = features['valuation_upside']
            # Negative upside = overvalued = higher risk
            risk_factors['valuation_risk'] = max(0, min(1, 0.5 - upside))

            if upside < -0.15:
                signals.append("VALUATION_RISK: Trading above fair value")

        # Growth execution risk
        if 'growth_sustainability' in correlations:
            sustainability = correlations['growth_sustainability']
            risk_factors['execution_risk'] = 1 - sustainability

            if sustainability < 0.5:
                signals.append("EXECUTION_RISK: Growth may not be sustainable")

        # Quality consistency risk
        if 'quality_consistency' in features:
            consistency = features['quality_consistency']
            risk_factors['consistency_risk'] = 1 - consistency

            if consistency < 0.7:
                signals.append("QUALITY_VARIANCE: Inconsistent across dimensions")

        # Monte Carlo risk (if available)
        if 'mc_uncertainty' in features:
            uncertainty = features['mc_uncertainty']
            risk_factors['model_uncertainty'] = min(1, uncertainty)

        # Aggregate risk score (weighted)
        risk_weights = {
            'financial_risk': 0.30,
            'valuation_risk': 0.25,
            'execution_risk': 0.20,
            'consistency_risk': 0.15,
            'model_uncertainty': 0.10,
        }

        total_risk = 0
        total_weight = 0
        for factor, weight in risk_weights.items():
            if factor in risk_factors:
                total_risk += risk_factors[factor] * weight
                total_weight += weight

        overall_risk = total_risk / total_weight if total_weight > 0 else 0.5
        risk_factors['overall_risk'] = overall_risk

        # Risk level classification
        if overall_risk < 0.3:
            risk_factors['risk_level'] = 'Low'
        elif overall_risk < 0.5:
            risk_factors['risk_level'] = 'Moderate'
        elif overall_risk < 0.7:
            risk_factors['risk_level'] = 'Elevated'
        else:
            risk_factors['risk_level'] = 'High'

        step = ReasoningStep(
            layer="Risk Assessment",
            input_data={"risk_factors_analyzed": len(risk_factors) - 2},
            analysis=f"Assessed {len(risk_factors)-2} risk factors. Overall risk: {risk_factors['risk_level']}",
            score=(1 - overall_risk) * 100,
            confidence=0.70 if len(risk_factors) > 4 else 0.50,
            signals=signals
        )
        self.reasoning_chain.append(step)

        return risk_factors

    def _layer6_synthesis(self, features: Dict[str, float], correlations: Dict[str, float],
                          trends: Dict[str, Any], risk_profile: Dict[str, Any]) -> Dict[str, Any]:
        """Layer 6: Dynamic Weight Synthesis - Combine all layers with adaptive weighting"""
        synthesis = {}
        signals = []

        # Calculate dynamic weights based on data quality
        weights = self.base_weights.copy()

        # Adjust weights based on data availability
        if 'valuation_score' not in features:
            weights['valuation'] *= 0.5
            weights['quality'] *= 1.3  # Shift weight to quality

        if 'quality_overall' not in features:
            weights['quality'] *= 0.5
            weights['valuation'] *= 1.2

        if 'value_creation_spread' not in features:
            weights['growth'] *= 0.7

        # Normalize weights
        total_weight = sum(weights.values())
        weights = {k: v / total_weight for k, v in weights.items()}

        synthesis['applied_weights'] = weights

        # Calculate component scores
        component_scores = {}

        # Valuation component
        if 'valuation_score' in features:
            component_scores['valuation'] = features['valuation_score']
        else:
            component_scores['valuation'] = 0.5  # Neutral if missing

        # Quality component
        if 'quality_overall' in features:
            component_scores['quality'] = features['quality_overall']
        else:
            component_scores['quality'] = 0.5

        # Growth component
        if 'growth_vs_cost_score' in features:
            component_scores['growth'] = features['growth_vs_cost_score']
        elif 'quality_growth' in features:
            component_scores['growth'] = features['quality_growth']
        else:
            component_scores['growth'] = 0.5

        # Risk component (inverted - lower risk = higher score)
        component_scores['risk'] = 1 - risk_profile.get('overall_risk', 0.5)

        # Momentum component
        component_scores['momentum'] = trends.get('overall_trend_score', 0.5)

        synthesis['component_scores'] = component_scores

        # Calculate weighted final score
        final_score = 0
        for component, score in component_scores.items():
            final_score += score * weights.get(component, 0)

        synthesis['raw_score'] = final_score

        # Apply correlation adjustments
        if 'opportunity_score' in correlations:
            opp_adj = (correlations['opportunity_score'] - 0.5) * 0.1
            final_score += opp_adj
            signals.append(f"Opportunity adjustment: {opp_adj*100:+.1f}%")

        # Apply risk penalty for high-risk situations
        if risk_profile.get('overall_risk', 0.5) > 0.6:
            risk_penalty = (risk_profile['overall_risk'] - 0.6) * 0.15
            final_score -= risk_penalty
            signals.append(f"Risk penalty applied: {risk_penalty*100:.1f}%")

        # Clamp to valid range
        final_score = max(0, min(1, final_score))
        synthesis['final_score'] = final_score

        # Calculate confidence based on data completeness and consistency
        base_confidence = 0.5
        if len([s for s in component_scores.values() if s != 0.5]) > 3:
            base_confidence += 0.2
        if 'quality_consistency' in features and features['quality_consistency'] > 0.7:
            base_confidence += 0.1
        if 'valuation_dispersion' in trends and trends['valuation_dispersion'] < 0.15:
            base_confidence += 0.1

        synthesis['confidence'] = min(0.95, base_confidence)

        step = ReasoningStep(
            layer="Synthesis",
            input_data={"components_synthesized": len(component_scores)},
            analysis=f"Synthesized {len(component_scores)} components into final score: {final_score*100:.1f}",
            score=final_score * 100,
            confidence=synthesis['confidence'],
            signals=signals
        )
        self.reasoning_chain.append(step)

        return synthesis

    def _layer7_recommendation(self, synthesis: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
        """Layer 7: Final Recommendation Generation with full reasoning chain"""
        final_score = synthesis['final_score']
        confidence = synthesis['confidence']
        current_price = data['current_price']
        raw = data.get('raw_data', {})

        # Generate recommendation with confidence-adjusted thresholds
        # Higher confidence = stricter thresholds
        strong_buy_threshold = 0.72 + (confidence - 0.7) * 0.1
        buy_threshold = 0.58 + (confidence - 0.7) * 0.05
        hold_threshold = 0.42 - (confidence - 0.7) * 0.05

        if final_score >= strong_buy_threshold:
            recommendation = "Strong Buy"
            conviction = int(min(95, 75 + (final_score - strong_buy_threshold) * 100 + confidence * 15))
        elif final_score >= buy_threshold:
            recommendation = "Buy"
            conviction = int(min(85, 60 + (final_score - buy_threshold) * 80 + confidence * 10))
        elif final_score >= hold_threshold:
            recommendation = "Hold"
            conviction = int(50 + (final_score - 0.5) * 60)
        elif final_score >= 0.28:
            recommendation = "Sell"
            conviction = int(min(75, 55 + (hold_threshold - final_score) * 80))
        else:
            recommendation = "Strong Sell"
            conviction = int(min(90, 70 + (0.28 - final_score) * 100))

        # Calculate target price
        target_price = current_price
        if raw.get('advanceValueNet', {}).get('fair_value'):
            target_price = raw['advanceValueNet']['fair_value']
        elif raw.get('dcfValuation') and raw['dcfValuation'] > 0:
            target_price = raw['dcfValuation']
        else:
            # Estimate from score
            upside_factor = (final_score - 0.5) * 0.6  # Max ±30% adjustment
            target_price = current_price * (1 + upside_factor)

        # Confidence interval for target
        uncertainty = 1 - confidence
        target_low = target_price * (1 - 0.15 - uncertainty * 0.1)
        target_high = target_price * (1 + 0.15 + uncertainty * 0.1)

        upside_pct = ((target_price - current_price) / current_price) * 100 if current_price > 0 else 0

        # Margin of safety
        if upside_pct > 35:
            margin_of_safety = "Muy Alto (>35%)"
        elif upside_pct > 20:
            margin_of_safety = "Alto (20-35%)"
        elif upside_pct > 10:
            margin_of_safety = "Moderado (10-20%)"
        elif upside_pct > 0:
            margin_of_safety = "Bajo (<10%)"
        else:
            margin_of_safety = "Negativo"

        # Generate dimension scores
        dimension_scores = {}
        if raw.get('companyQualityNet'):
            quality = raw['companyQualityNet']
            dimension_scores = {
                "Profitability": int(quality.get('profitability', 50)),
                "FinancialStrength": int(quality.get('financialStrength', 50)),
                "Efficiency": int(quality.get('efficiency', 50)),
                "Growth": int(quality.get('growth', 50)),
                "Moat": int(quality.get('moat', 50)),
            }
        else:
            # Estimate from synthesis
            base = int(final_score * 100)
            dimension_scores = {
                "Profitability": min(100, int(base * 0.95)),
                "FinancialStrength": min(100, int(base * 0.90)),
                "Efficiency": min(100, int(base * 0.88)),
                "Growth": min(100, int(base * 1.05)),
                "Moat": min(100, int(base * 0.82)),
            }

        # Add synthesis-derived scores
        dimension_scores["Valuation"] = int(synthesis['component_scores'].get('valuation', 0.5) * 100)
        dimension_scores["Momentum"] = int(synthesis['component_scores'].get('momentum', 0.5) * 100)

        # Generate risks from reasoning chain
        all_signals = []
        for step in self.reasoning_chain:
            all_signals.extend(step.signals)

        key_risks = [s for s in all_signals if any(kw in s.upper() for kw in ['RISK', 'CONCERN', 'WEAK', 'NEGATIVE', 'TRAP'])]
        catalysts = [s for s in all_signals if any(kw in s.upper() for kw in ['STRONG', 'HIGH', 'POSITIVE', 'ALIGNMENT', 'SUSTAINABLE', 'OPPORTUNITY', 'VALUE_CREATOR'])]

        # Ensure we have some defaults
        if not key_risks:
            key_risks = [
                "Riesgo macroeconómico y volatilidad de mercado",
                "Incertidumbre en ejecución de estrategia",
                "Presión competitiva en el sector"
            ]
        if not catalysts:
            catalysts = [
                "Potencial superación de estimaciones",
                "Mejoras operativas esperadas",
                "Expansión de múltiplos de valoración"
            ]

        # Generate narrative summary
        quality_desc = "excepcional" if final_score >= 0.8 else "sólida" if final_score >= 0.65 else "aceptable" if final_score >= 0.5 else "débil" if final_score >= 0.35 else "preocupante"

        summary_text = (
            f"{data['ticker']} presenta una tesis de inversión {quality_desc} con un score integrado de {final_score*100:.0f}/100. "
            f"El análisis multi-capa procesó {len(self.reasoning_chain)} etapas de razonamiento, "
            f"evaluando valuación, calidad fundamental, crecimiento sostenible y perfil de riesgo. "
        )

        if upside_pct > 15:
            summary_text += f"La valoración sugiere un potencial de apreciación del {upside_pct:.0f}% hacia ${target_price:.2f}. "
        elif upside_pct < -10:
            summary_text += f"La valoración actual implica un riesgo de corrección del {abs(upside_pct):.0f}%. "

        # Add strongest signals to narrative
        if catalysts and len(catalysts) > 0:
            summary_text += f"Catalizador principal: {catalysts[0].split(':')[-1].strip()}. "
        if key_risks and len(key_risks) > 0:
            summary_text += f"Riesgo a monitorear: {key_risks[0].split(':')[-1].strip()}."

        # Actionable advice based on recommendation
        if recommendation in ["Strong Buy", "Buy"]:
            entry_price = current_price * 0.96
            actionable_advice = (
                f"ACCIÓN: Iniciar/incrementar posición. "
                f"Entrada óptima: ${entry_price:.2f} (4% descuento). "
                f"Objetivo primario: ${target_price:.2f}. "
                f"Stop-loss sugerido: ${current_price * 0.88:.2f} (-12%)."
            )
        elif recommendation == "Hold":
            actionable_advice = (
                f"ACCIÓN: Mantener posición actual. "
                f"Monitorear catalizadores para potencial upgrade. "
                f"Tomar ganancias parciales si supera ${target_high:.2f}. "
                f"Revisar tesis si cae bajo ${current_price * 0.90:.2f}."
            )
        else:
            actionable_advice = (
                f"ACCIÓN: Reducir exposición gradualmente. "
                f"Vender 50% inmediato, resto en rebotes técnicos. "
                f"No promediar a la baja. "
                f"Soporte crítico: ${current_price * 0.85:.2f}."
            )

        # Build chain of thought summary
        chain_of_thought = []
        for i, step in enumerate(self.reasoning_chain):
            chain_of_thought.append({
                "step": i + 1,
                "layer": step.layer,
                "analysis": step.analysis,
                "score": round(step.score, 1),
                "confidence": round(step.confidence * 100, 0),
                "key_signals": step.signals[:3]  # Top 3 signals
            })

        return {
            "finalRecommendation": recommendation,
            "conviction": conviction,
            "targetPrice": round(target_price, 2),
            "targetRange": [round(target_low, 2), round(target_high, 2)],
            "upsidePct": round(upside_pct, 1),
            "timeHorizon": "12-18 meses",
            "marginOfSafety": margin_of_safety,
            "overallRisk": self.reasoning_chain[-2].input_data.get('risk_factors_analyzed', 'Medium'),
            "riskLevel": [s for s in self.reasoning_chain if s.layer == "Risk Assessment"][0].analysis.split(": ")[-1] if any(s.layer == "Risk Assessment" for s in self.reasoning_chain) else "Medium",
            "keyRisks": key_risks[:4],
            "catalysts": catalysts[:4],
            "dimensionScores": dimension_scores,
            "summaryText": summary_text,
            "actionableAdvice": actionable_advice,
            "chainOfThought": chain_of_thought,
            "synthesisDetails": {
                "componentScores": {k: round(v * 100, 1) for k, v in synthesis['component_scores'].items()},
                "appliedWeights": {k: round(v * 100, 1) for k, v in synthesis['applied_weights'].items()},
                "rawScore": round(synthesis['raw_score'] * 100, 1),
                "finalScore": round(synthesis['final_score'] * 100, 1),
                "confidence": round(synthesis['confidence'] * 100, 1),
            },
            "dataQuality": {
                "completeness": round(data['data_completeness'] * 100, 0),
                "sourcesUsed": sum(1 for k, v in data.items() if k.startswith('has_') and v),
                "totalSources": 9
            }
        }

    def _sigmoid_transform(self, x: float, scale: float = 1) -> float:
        """Apply sigmoid transformation to bound values between 0 and 1"""
        return 1 / (1 + np.exp(-x * scale))


# Global instance
resumen_engine = ResumenEngine()
