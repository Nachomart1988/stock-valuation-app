# backend/model.py
# AdvanceValue Net - Neural Ensemble for Stock Valuation
# Simplified version that works without pre-training

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    print("[WARNING] PyTorch not available - AdvanceValueNet will use fallback predictor")


if TORCH_AVAILABLE:
    class VariableSelectionNetwork(nn.Module):
        """Learns which input features are most important"""
        def __init__(self, input_dim: int):
            super().__init__()
            self.grn = nn.Sequential(
                nn.Linear(input_dim, 64),
                nn.GELU(),
                nn.Linear(64, input_dim),
                nn.Softmax(dim=-1)
            )

        def forward(self, x: torch.Tensor) -> torch.Tensor:
            weights = self.grn(x)
            return x * weights


    class AdvanceValueNet(nn.Module):
        """
        Neural Ensemble for Stock Valuation
        Combines:
        - Expert valuations (DDM, DCF, etc.)
        - Tabular financial metrics
        - Simple ensemble averaging with learned weights
        """
        def __init__(self, expert_dim: int = 20, tabular_dim: int = 30):
            super().__init__()

            # Variable selection for tabular features
            self.var_selection = VariableSelectionNetwork(tabular_dim)

            # Tabular encoder
            self.tabular_encoder = nn.Sequential(
                nn.Linear(tabular_dim, 128),
                nn.BatchNorm1d(128),
                nn.GELU(),
                nn.Dropout(0.2),
                nn.Linear(128, 64),
                nn.GELU()
            )

            # Expert valuations encoder
            self.expert_encoder = nn.Sequential(
                nn.Linear(expert_dim, 64),
                nn.GELU(),
                nn.Dropout(0.2),
                nn.Linear(64, 64),
                nn.GELU()
            )

            # Fusion layer
            self.fusion = nn.Sequential(
                nn.Linear(128, 64),
                nn.GELU(),
                nn.Dropout(0.15)
            )

            # Output heads
            self.fair_value_head = nn.Linear(64, 1)
            self.uncertainty_head = nn.Linear(64, 2)  # q10 and q90

            # Initialize weights for reasonable outputs
            self._init_weights()

        def _init_weights(self):
            """Initialize to produce reasonable initial outputs"""
            for m in self.modules():
                if isinstance(m, nn.Linear):
                    nn.init.xavier_uniform_(m.weight, gain=0.5)
                    if m.bias is not None:
                        nn.init.zeros_(m.bias)

        def forward(self, expert_vals: torch.Tensor, tabular: torch.Tensor) -> dict:
            # Encode tabular features with variable selection
            tab_selected = self.var_selection(tabular)
            tab_emb = self.tabular_encoder(tab_selected)

            # Encode expert valuations
            exp_emb = self.expert_encoder(expert_vals)

            # Fuse embeddings
            combined = torch.cat([tab_emb, exp_emb], dim=1)
            fused = self.fusion(combined)

            # Compute outputs
            fair_value_raw = self.fair_value_head(fused)
            uncertainty = self.uncertainty_head(fused)

            return {
                'fair_value_adjustment': fair_value_raw.squeeze(-1),
                'uncertainty': uncertainty  # [q10_adj, q90_adj]
            }


class AdvanceValuePredictor:
    """
    Wrapper that combines the neural network with heuristic ensemble
    Works without pre-training by using expert valuations as base
    Falls back to pure heuristic ensemble if PyTorch is not available
    """
    def __init__(self):
        if TORCH_AVAILABLE:
            self.model = AdvanceValueNet(expert_dim=20, tabular_dim=30)
            self.model.eval()
        else:
            self.model = None

    def predict(
        self,
        expert_valuations: list[float],
        tabular_features: list[float],
        current_price: float
    ) -> dict:
        """
        Generate fair value prediction using neural ensemble

        Args:
            expert_valuations: List of valuation estimates from different models
            tabular_features: Financial metrics (ROE, margins, growth, etc.)
            current_price: Current stock price

        Returns:
            dict with fair_value, confidence_interval, signal
        """
        # Filter valid expert valuations (positive, finite, reasonable)
        valid_experts = [
            v for v in expert_valuations
            if v is not None and v > 0 and np.isfinite(v) and v < current_price * 10
        ]

        if len(valid_experts) < 3:
            return None

        # Calculate base ensemble (weighted average of experts)
        # Give more weight to values closer to median
        median_val = np.median(valid_experts)
        weights = []
        for v in valid_experts:
            # Weight inversely proportional to distance from median
            dist = abs(v - median_val) / (median_val + 1e-6)
            weight = 1.0 / (1.0 + dist * 2)
            weights.append(weight)

        weights = np.array(weights)
        weights = weights / weights.sum()
        base_value = np.sum(np.array(valid_experts) * weights)

        # Neural network adjustment (only if torch available)
        adjustment = 0.0
        if TORCH_AVAILABLE and self.model is not None:
            expert_tensor = torch.zeros(1, 20)
            for i, v in enumerate(valid_experts[:20]):
                expert_tensor[0, i] = v / current_price  # Normalize by price

            tabular_tensor = torch.zeros(1, 30)
            for i, v in enumerate(tabular_features[:30]):
                if v is not None and np.isfinite(v):
                    tabular_tensor[0, i] = float(v)

            with torch.no_grad():
                output = self.model(expert_tensor, tabular_tensor)
                adjustment = output['fair_value_adjustment'].item()

        # Apply adjustment (small, bounded)
        adjustment = np.clip(adjustment, -0.15, 0.15)  # Max 15% adjustment
        fair_value = base_value * (1 + adjustment)

        # Calculate confidence interval
        # Use standard deviation of expert valuations
        std_val = np.std(valid_experts)
        q10 = fair_value - 1.28 * std_val  # 10th percentile
        q90 = fair_value + 1.28 * std_val  # 90th percentile

        # Ensure reasonable bounds
        q10 = max(q10, fair_value * 0.7)
        q90 = min(q90, fair_value * 1.4)

        # Determine signal
        upside = (fair_value / current_price - 1) * 100
        if upside > 15:
            signal = "SUBVALUADO"
        elif upside < -15:
            signal = "SOBREVALUADO"
        else:
            signal = "EN LINEA"

        return {
            "fair_value": round(float(fair_value), 2),
            "confidence_interval": [round(float(q10), 2), round(float(q90), 2)],
            "signal": signal,
            "upside_pct": round(upside, 1),
            "experts_used": len(valid_experts),
            "base_ensemble": round(float(base_value), 2)
        }


# Singleton instance
predictor = AdvanceValuePredictor()
