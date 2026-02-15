# backend/quality_model.py
# CompanyQuality Net - Neural Ensemble for Company Quality Assessment

import numpy as np
from typing import List, Dict, Optional

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    print("[WARNING] PyTorch not available - using fallback quality predictor")


class CompanyQualityNet(nn.Module):
    """
    Neural network for company quality assessment.

    Takes ~45 financial metrics and outputs:
    - Overall quality score (0-100)
    - 5 dimension subscores
    - Risk classification
    - Quality recommendation
    """

    def __init__(self, input_dim: int = 45):
        super().__init__()

        # Feature processing layers
        self.fc1 = nn.Linear(input_dim, 256)
        self.bn1 = nn.BatchNorm1d(256)
        self.drop1 = nn.Dropout(0.2)

        self.fc2 = nn.Linear(256, 128)
        self.bn2 = nn.BatchNorm1d(128)
        self.drop2 = nn.Dropout(0.2)

        self.fc3 = nn.Linear(128, 64)
        self.bn3 = nn.BatchNorm1d(64)

        # Output heads
        self.overall_head = nn.Linear(64, 1)           # Overall score 0-100
        self.subscores_head = nn.Linear(64, 5)         # 5 dimension scores
        self.risk_head = nn.Linear(64, 3)              # Low/Medium/High
        self.recommendation_head = nn.Linear(64, 5)    # Excellent/Strong/Average/Weak/Poor

    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        # Feature extraction
        x = F.relu(self.bn1(self.fc1(x)))
        x = self.drop1(x)

        x = F.relu(self.bn2(self.fc2(x)))
        x = self.drop2(x)

        x = F.relu(self.bn3(self.fc3(x)))

        # Generate outputs
        overall = torch.sigmoid(self.overall_head(x)) * 100
        subscores = torch.sigmoid(self.subscores_head(x)) * 100
        risk = F.softmax(self.risk_head(x), dim=-1)
        recommendation = F.softmax(self.recommendation_head(x), dim=-1)

        return {
            'overall': overall,
            'subscores': subscores,
            'risk': risk,
            'recommendation': recommendation
        }


class CompanyQualityPredictor:
    """
    Wrapper class for company quality prediction.
    Uses neural network when available, falls back to heuristic otherwise.
    """

    def __init__(self):
        self.model = None
        # Force heuristic mode - neural network requires trained weights
        # Set to True only when we have a trained model file to load
        self.use_neural = False

        print("[CompanyQualityNet] Using heuristic-based quality assessment")

    def predict(self, features: List[float]) -> Dict:
        """
        Generate quality assessment from financial features.

        Args:
            features: List of ~45 financial metrics

        Returns:
            Dictionary with quality scores and recommendations
        """
        print(f"[Quality] Input features (first 10): {features[:10]}")

        # Pad or truncate features to expected size
        features = self._normalize_features(features)

        print(f"[Quality] After normalization (first 10): {features[:10]}")

        if self.use_neural and self.model is not None:
            return self._neural_predict(features)
        else:
            return self._heuristic_predict(features)

    def _normalize_features(self, features: List[float], target_size: int = 45) -> List[float]:
        """Normalize feature list to expected size"""
        features = [f if f is not None and np.isfinite(f) else 0 for f in features]

        if len(features) < target_size:
            features = features + [0] * (target_size - len(features))
        elif len(features) > target_size:
            features = features[:target_size]

        return features

    def _neural_predict(self, features: List[float]) -> Dict:
        """Use neural network for prediction"""
        with torch.no_grad():
            # Prepare input
            x = torch.tensor([features], dtype=torch.float32)

            # Forward pass
            output = self.model(x)

            # Extract results
            overall = output['overall'].item()
            subscores = output['subscores'].squeeze().tolist()
            risk_probs = output['risk'].squeeze().tolist()
            rec_probs = output['recommendation'].squeeze().tolist()

            # Determine risk level
            risk_labels = ['Low', 'Medium', 'High']
            risk_level = risk_labels[np.argmax(risk_probs)]

            # Determine recommendation
            rec_labels = ['Excellent', 'Strong', 'Average', 'Weak', 'Poor']
            recommendation = rec_labels[np.argmax(rec_probs)]

            return {
                'overallScore': round(overall, 1),
                'profitability': round(subscores[0], 1),
                'financialStrength': round(subscores[1], 1),
                'efficiency': round(subscores[2], 1),
                'growth': round(subscores[3], 1),
                'moat': round(subscores[4], 1),
                'riskLevel': risk_level,
                'recommendation': recommendation
            }

    def _heuristic_predict(self, features: List[float]) -> Dict:
        """
        Fallback heuristic-based prediction when neural network is unavailable.
        Uses weighted scoring based on key metrics.
        """
        # Extract key metrics (assuming standard order)
        # [0-6] Profitability: ROE, ROA, ROIC, net margin, gross margin, op margin, ebitda margin
        # [7-12] Solvency: D/E, D/A, current, quick, cash, interest coverage
        # [13-17] Efficiency: asset turn, inv turn, recv turn, pay turn, CCC
        # [18-23] Valuation: PE, PB, PS, PFCF, EV/EBITDA, EV/Sales
        # [24-27] Yield: FCF yield, earnings yield, div yield, payout
        # [28-29] Scores: Altman Z, Piotroski

        print(f"[Quality] Received {len(features)} features")
        print(f"[Quality] Profitability features[0:7]: {features[0:7]}")
        print(f"[Quality] Solvency features[7:13]: {features[7:13]}")
        print(f"[Quality] Scores features[28:30]: {features[28:30]}")

        # Calculate dimension scores
        profitability = self._score_profitability(features[0:7])
        financial_strength = self._score_solvency(features[7:13], features[28:30])
        efficiency = self._score_efficiency(features[13:18])
        growth = self._score_growth(features)
        moat = self._score_moat(features)

        print(f"[Quality] DIMENSION SCORES: prof={profitability}, fin={financial_strength}, eff={efficiency}, growth={growth}, moat={moat}")

        # Overall score (weighted average)
        overall = float(
            profitability * 0.25 +
            financial_strength * 0.25 +
            efficiency * 0.20 +
            growth * 0.15 +
            moat * 0.15
        )

        print(f"[Quality] OVERALL CALCULATION: {profitability}*0.25 + {financial_strength}*0.25 + {efficiency}*0.20 + {growth}*0.15 + {moat}*0.15 = {overall}")

        # Determine risk level
        if financial_strength >= 70 and overall >= 60:
            risk_level = 'Low'
        elif financial_strength >= 50 and overall >= 40:
            risk_level = 'Medium'
        else:
            risk_level = 'High'

        # Determine recommendation
        if overall >= 80:
            recommendation = 'Excellent'
        elif overall >= 65:
            recommendation = 'Strong'
        elif overall >= 50:
            recommendation = 'Average'
        elif overall >= 35:
            recommendation = 'Weak'
        else:
            recommendation = 'Poor'

        result = {
            'overallScore': round(overall, 1),
            'profitability': round(profitability, 1),
            'financialStrength': round(financial_strength, 1),
            'efficiency': round(efficiency, 1),
            'growth': round(growth, 1),
            'moat': round(moat, 1),
            'riskLevel': risk_level,
            'recommendation': recommendation
        }
        print(f"[Quality] FINAL RESULT: {result}")
        return result

    def _score_profitability(self, metrics: List[float]) -> float:
        """Score profitability metrics (ROE, ROA, margins)"""
        # Metrics come as decimals from FMP (e.g., 0.15 = 15%)
        roe = metrics[0] if len(metrics) > 0 else 0
        roa = metrics[1] if len(metrics) > 1 else 0
        roic = metrics[2] if len(metrics) > 2 else 0
        net_margin = metrics[3] if len(metrics) > 3 else 0
        gross_margin = metrics[4] if len(metrics) > 4 else 0
        op_margin = metrics[5] if len(metrics) > 5 else 0
        ebitda_margin = metrics[6] if len(metrics) > 6 else 0

        score = 50  # Base score

        # ROE scoring (values are decimals: 0.20 = 20%)
        if roe > 0.20: score += 15
        elif roe > 0.15: score += 10
        elif roe > 0.10: score += 5
        elif roe > 0.05: score += 2
        elif roe > 0: score += 0
        elif roe < 0: score -= 15

        # ROA scoring
        if roa > 0.10: score += 10
        elif roa > 0.05: score += 5
        elif roa > 0.02: score += 2
        elif roa < 0: score -= 10

        # ROIC scoring
        if roic > 0.15: score += 10
        elif roic > 0.10: score += 5
        elif roic > 0.05: score += 2

        # Margin scoring
        if net_margin > 0.15: score += 5
        elif net_margin > 0.08: score += 3
        elif net_margin > 0: score += 1
        elif net_margin < 0: score -= 10

        if gross_margin > 0.40: score += 5
        elif gross_margin > 0.25: score += 3

        if op_margin > 0.20: score += 5
        elif op_margin > 0.10: score += 3

        print(f"[Quality] Profitability: ROE={roe:.3f}, ROA={roa:.3f}, ROIC={roic:.3f}, NetMargin={net_margin:.3f} -> Score={score}")
        return max(0, min(100, score))

    def _score_solvency(self, solvency: List[float], scores: List[float]) -> float:
        """Score financial strength (leverage, liquidity, credit scores)"""
        # Safe extraction with defaults
        de_ratio = solvency[0] if len(solvency) > 0 else 1.0
        da_ratio = solvency[1] if len(solvency) > 1 else 0.5
        current = solvency[2] if len(solvency) > 2 else 1.5
        quick = solvency[3] if len(solvency) > 3 else 1.0
        cash = solvency[4] if len(solvency) > 4 else 0.5
        int_cov = solvency[5] if len(solvency) > 5 else 5.0
        altman_z = scores[0] if len(scores) > 0 else 2.5
        piotroski = scores[1] if len(scores) > 1 else 5

        score = 50

        # Debt/Equity scoring (lower is better)
        if de_ratio < 0.5: score += 15
        elif de_ratio < 1.0: score += 10
        elif de_ratio < 2.0: score += 0
        elif de_ratio > 3.0: score -= 15

        # Current ratio scoring
        if current > 2.0: score += 10
        elif current > 1.5: score += 5
        elif current < 1.0: score -= 10

        # Interest coverage
        if int_cov > 10: score += 10
        elif int_cov > 5: score += 5
        elif int_cov < 2: score -= 10

        # Altman Z-Score
        if altman_z > 2.99: score += 10
        elif altman_z > 1.81: score += 0
        else: score -= 15

        # Piotroski Score
        if piotroski >= 7: score += 10
        elif piotroski >= 5: score += 5
        elif piotroski <= 3: score -= 10

        print(f"[Quality] Solvency: D/E={de_ratio:.2f}, Current={current:.2f}, IntCov={int_cov:.2f}, Altman={altman_z:.2f}, Piotroski={piotroski} -> Score={score}")
        return max(0, min(100, score))

    def _score_efficiency(self, metrics: List[float]) -> float:
        """Score operational efficiency"""
        # Safe extraction with defaults
        asset_turn = metrics[0] if len(metrics) > 0 else 0.8
        inv_turn = metrics[1] if len(metrics) > 1 else 5
        recv_turn = metrics[2] if len(metrics) > 2 else 10
        pay_turn = metrics[3] if len(metrics) > 3 else 10
        ccc = metrics[4] if len(metrics) > 4 else 60

        score = 50

        # Asset turnover (higher is better)
        if asset_turn > 1.5: score += 15
        elif asset_turn > 1.0: score += 10
        elif asset_turn > 0.5: score += 5

        # Inventory turnover (higher generally better)
        if inv_turn > 10: score += 10
        elif inv_turn > 5: score += 5

        # Cash conversion cycle (lower is better)
        if ccc < 30: score += 15
        elif ccc < 60: score += 10
        elif ccc < 90: score += 5
        elif ccc > 150: score -= 10

        return max(0, min(100, score))

    def _score_growth(self, features: List[float]) -> float:
        """Score growth sustainability based on available metrics"""
        # Use earnings yield and FCF yield as proxies for sustainable growth
        fcf_yield = features[24] if len(features) > 24 else 0
        earnings_yield = features[25] if len(features) > 25 else 0

        score = 50

        if fcf_yield > 0.08: score += 20
        elif fcf_yield > 0.05: score += 10
        elif fcf_yield < 0: score -= 15

        if earnings_yield > 0.08: score += 15
        elif earnings_yield > 0.05: score += 10

        return max(0, min(100, score))

    def _score_moat(self, features: List[float]) -> float:
        """
        Score competitive moat based on:
        - Consistent high margins
        - High ROIC
        - Strong market position (low valuation multiples suggest established business)
        """
        roic = features[2] if len(features) > 2 else 0
        gross_margin = features[4] if len(features) > 4 else 0
        op_margin = features[5] if len(features) > 5 else 0

        score = 50

        # High ROIC indicates competitive advantage
        if roic > 0.20: score += 20
        elif roic > 0.15: score += 15
        elif roic > 0.10: score += 10

        # High gross margins indicate pricing power
        if gross_margin > 0.50: score += 15
        elif gross_margin > 0.40: score += 10
        elif gross_margin > 0.30: score += 5

        # High operating margins indicate efficiency moat
        if op_margin > 0.25: score += 10
        elif op_margin > 0.15: score += 5

        return max(0, min(100, score))


# Global predictor instance
quality_predictor = CompanyQualityPredictor()
