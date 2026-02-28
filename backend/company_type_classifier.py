# backend/company_type_classifier.py
"""
HybridCompanyClassifier — RF + KMeans + networkx (PageRank) + QUBO-inspired ensemble
for company type classification (growth / value / dividend / blend).

No external LLMs required. Trains once at startup on synthetic archetype data.
"""

from __future__ import annotations

import logging
import math
from typing import Dict, List, Tuple, Any

import numpy as np

logger = logging.getLogger(__name__)

# ── Feature order ──────────────────────────────────────────────────────────────
FEATURES = ['pe_z', 'gr_z', 'yield_z', 'pb_z', 'cap_log_norm', 'moat', 'growth_dim', 'quality_dim']
CLASSES  = ['growth', 'value', 'dividend', 'blend']

# Archetype feature vectors (mean per class)
# pe_z, gr_z, yield_z, pb_z, cap_log_norm, moat, growth_dim, quality_dim
_ARCHETYPES: Dict[str, List[float]] = {
    'growth':   [ 1.2,  1.5, -1.0,  1.0, 0.45, 0.70, 0.75, 0.70],
    'value':    [-1.2, -0.8,  0.5, -1.0, 0.60, 0.45, 0.35, 0.55],
    'dividend': [-0.3, -0.8,  2.5,  0.0, 0.70, 0.52, 0.38, 0.62],
    'blend':    [ 0.1,  0.3,  0.3,  0.1, 0.65, 0.55, 0.52, 0.58],
}

# Per-feature noise for synthetic data generation
_NOISE: List[float] = [0.6, 0.7, 0.6, 0.5, 0.15, 0.12, 0.12, 0.10]


def _build_synthetic_dataset(n_per_class: int = 120) -> Tuple[np.ndarray, np.ndarray]:
    """Generate synthetic labelled samples around each archetype."""
    rng = np.random.default_rng(42)
    Xs, ys = [], []
    for label_idx, cls in enumerate(CLASSES):
        mean  = np.array(_ARCHETYPES[cls])
        noise = np.array(_NOISE)
        X = rng.normal(loc=mean, scale=noise, size=(n_per_class, len(FEATURES)))
        X[:, :4] = np.clip(X[:, :4], -3.0, 3.0)   # z-scores
        X[:, 4:] = np.clip(X[:, 4:],  0.0, 1.0)   # 0–1 features
        Xs.append(X)
        ys.append(np.full(n_per_class, label_idx, dtype=int))
    return np.vstack(Xs), np.concatenate(ys)


def _build_causal_graph():
    """
    Build a causal DiGraph representing feature relationships and return
    (G, pagerank_dict).  Returns (None, None) if networkx is unavailable.
    """
    try:
        import networkx as nx
    except ImportError:
        return None, None

    G = nx.DiGraph()
    for f in FEATURES:
        G.add_node(f)

    # Causal edges: (source, target, strength)
    edges = [
        ('gr_z',       'pe_z',        0.70),   # high growth → higher P/E
        ('gr_z',       'yield_z',    -0.60),   # high growth → lower yield
        ('moat',       'pe_z',        0.50),   # durable moat → premium P/E
        ('moat',       'gr_z',        0.40),   # moat often correlates with sustained growth
        ('yield_z',    'pb_z',       -0.30),   # high yield → lower P/B (typical)
        ('pb_z',       'pe_z',        0.50),   # high P/B and high P/E co-move
        ('growth_dim', 'gr_z',        0.60),   # quality growth dimension → actual SGR
        ('quality_dim','moat',        0.55),   # profitability quality → moat
    ]
    for src, tgt, w in edges:
        G.add_edge(src, tgt, weight=abs(w))

    pr = nx.pagerank(G, weight='weight')
    return G, pr


class HybridCompanyClassifier:
    """
    Ensemble classifier combining:
      • Random Forest (sklearn) — primary probabilistic classifier
      • KMeans (sklearn)        — distance-based archetype matching
      • networkx PageRank       — feature importance re-weighting
      • QUBO-inspired penalties — conflict penalty for contradictory signals
    """

    def __init__(self) -> None:
        self._rf     = None
        self._km     = None
        self._scaler = None
        self._km_cluster_to_class: Dict[int, int] = {}
        self._pagerank: Dict[str, float] = {}
        self._feature_weights = np.ones(len(FEATURES))
        self._trained = False
        self._train()

    # ── Training ───────────────────────────────────────────────────────────────

    def _train(self) -> None:
        try:
            from sklearn.ensemble import RandomForestClassifier
            from sklearn.cluster import KMeans
            from sklearn.preprocessing import StandardScaler

            X, y = _build_synthetic_dataset(n_per_class=120)

            self._scaler = StandardScaler()
            X_scaled     = self._scaler.fit_transform(X)

            # Random Forest
            self._rf = RandomForestClassifier(
                n_estimators=150,
                max_depth=7,
                min_samples_leaf=2,
                random_state=42,
                class_weight='balanced',
            )
            self._rf.fit(X, y)

            # KMeans initialised at scaled archetypes
            arch_centers        = np.array([_ARCHETYPES[c] for c in CLASSES])
            arch_centers_scaled = self._scaler.transform(arch_centers)
            self._km = KMeans(
                n_clusters=4,
                init=arch_centers_scaled,
                n_init=1,
                random_state=42,
            )
            self._km.fit(X_scaled)

            # Map cluster → class by majority vote
            for cluster_id in range(4):
                mask = self._km.labels_ == cluster_id
                if mask.sum() == 0:
                    self._km_cluster_to_class[cluster_id] = 3  # blend
                    continue
                counts = np.bincount(y[mask], minlength=4)
                self._km_cluster_to_class[cluster_id] = int(counts.argmax())

            # networkx PageRank → feature importance weights
            _, pr = _build_causal_graph()
            if pr:
                self._pagerank = pr
                weights = np.array([pr.get(f, 0.1) for f in FEATURES])
                w_min, w_max = weights.min(), weights.max()
                # Normalise to [0.5, 1.5] so no feature is zeroed out
                self._feature_weights = (
                    0.5 + (weights - w_min) / (w_max - w_min + 1e-9)
                )

            self._trained = True
            logger.info(
                "[HybridClassifier] Trained on %d samples. PR-weights: %s",
                len(X),
                {f: round(float(self._feature_weights[i]), 3)
                 for i, f in enumerate(FEATURES)},
            )

        except Exception as exc:
            logger.warning(
                "[HybridClassifier] Training failed (%s) — using rule-based fallback.", exc
            )
            self._trained = False

    # ── QUBO-inspired conflict penalties ───────────────────────────────────────

    def _qubo_penalties(self, feat: np.ndarray) -> np.ndarray:
        """Return per-class conflict penalties (higher = worse fit)."""
        pe_z, gr_z, yield_z, pb_z, _, moat, growth_dim, _ = feat
        penalties = np.zeros(4)
        idx = {c: i for i, c in enumerate(CLASSES)}

        # Growth: high yield or negative growth are contradictory
        if yield_z > 1.5:
            penalties[idx['growth']] += 0.30
        if gr_z < -0.5:
            penalties[idx['growth']] += 0.25

        # Value: expensive P/E or strong growth dim contradict value label
        if pe_z > 1.0:
            penalties[idx['value']] += 0.30
        if growth_dim > 0.72:
            penalties[idx['value']] += 0.20

        # Dividend: fast growers rarely sustain high dividends
        if gr_z > 1.5:
            penalties[idx['dividend']] += 0.35
        if yield_z < 0.0:
            penalties[idx['dividend']] += 0.25

        return penalties

    # ── Causal insight text ────────────────────────────────────────────────────

    def _causal_insight(self, feat: np.ndarray, company_type: str) -> Dict[str, str]:
        """Generate causal-chain explanations in EN + ES (no LLM)."""
        pe_z, gr_z, yield_z, pb_z, _, moat, growth_dim, quality_dim = feat
        en_lines: List[str] = []
        es_lines: List[str] = []

        if company_type == 'growth':
            gr_en = f"SGR z-score {gr_z:+.2f}σ above sector average" if gr_z > 0 else f"SGR z-score {gr_z:+.2f}σ"
            pe_en = f"P/E premium {pe_z:+.2f}σ vs sector" if pe_z > 0 else "P/E near sector median"
            en_lines.append(f"Growth classification driven by {gr_en} and {pe_en}.")

            gr_es = f"z-score de SGR {gr_z:+.2f}σ sobre el promedio del sector" if gr_z > 0 else f"z-score de SGR {gr_z:+.2f}σ"
            pe_es = f"prima de P/E {pe_z:+.2f}σ vs sector" if pe_z > 0 else "P/E cercano a la mediana del sector"
            es_lines.append(f"Clasificación de crecimiento impulsada por {gr_es} y {pe_es}.")

            if moat > 0.60:
                en_lines.append(f"High moat score ({moat:.2f}) supports sustained premium valuation.")
                es_lines.append(f"Alto moat ({moat:.2f}) respalda una valoración premium sostenida.")

        elif company_type == 'value':
            en_lines.append(f"Value classification: P/E z-score {pe_z:+.2f}σ below sector average.")
            es_lines.append(f"Clasificación valor: z-score de P/E {pe_z:+.2f}σ debajo del promedio del sector.")
            if yield_z > 0:
                en_lines.append(f"Above-sector dividend yield (z={yield_z:+.2f}σ) reinforces value signal.")
                es_lines.append(f"Dividendo por encima del sector (z={yield_z:+.2f}σ) refuerza la señal de valor.")
            if pb_z < -0.5:
                en_lines.append(f"Below-average P/B ratio (z={pb_z:+.2f}σ) confirms value characteristics.")
                es_lines.append(f"P/B bajo (z={pb_z:+.2f}σ) confirma características de valor.")

        elif company_type == 'dividend':
            en_lines.append(f"Dividend classification: high yield (z={yield_z:+.2f}σ above sector average).")
            es_lines.append(f"Clasificación dividendo: alto rendimiento (z={yield_z:+.2f}σ sobre el promedio del sector).")
            if gr_z < 0:
                en_lines.append(f"Below-sector growth (z={gr_z:+.2f}σ) consistent with income-oriented profile.")
                es_lines.append(f"Crecimiento bajo (z={gr_z:+.2f}σ) consistente con perfil orientado a ingresos.")

        else:  # blend
            en_lines.append(
                f"Blend classification: balanced signals "
                f"(gr_z={gr_z:+.2f}, pe_z={pe_z:+.2f}, moat={moat:.2f})."
            )
            es_lines.append(
                f"Clasificación mixta: señales equilibradas "
                f"(gr_z={gr_z:+.2f}, pe_z={pe_z:+.2f}, moat={moat:.2f})."
            )
            if quality_dim > 0.60:
                en_lines.append("Above-average quality metrics suggest a quality compounder.")
                es_lines.append("Métricas de calidad superiores sugieren un compounder de calidad.")

        return {
            'en': " ".join(en_lines),
            'es': " ".join(es_lines),
        }

    # ── Public classify method ─────────────────────────────────────────────────

    def classify(
        self,
        features: Dict[str, float],
        mkt_cap: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Classify company type.

        Parameters
        ----------
        features : dict — keys must match FEATURES list
        mkt_cap  : float — market cap in USD (for mega-cap adjustment)

        Returns
        -------
        dict with keys: companyType, typeConf, rfType, rfConf, kmType,
                        gnnScores, causalInsight, rfImportances, graphCentrality
        """
        feat = np.array([features.get(f, 0.0) for f in FEATURES], dtype=float)

        if not self._trained or self._rf is None:
            return self._rule_based_fallback(feat, mkt_cap)

        try:
            # ── RF probabilities ───────────────────────────────────────────
            rf_probs = self._rf.predict_proba(feat.reshape(1, -1))[0]

            # PageRank-weighted variant (blended 50/50 with raw)
            weighted_feat    = feat * self._feature_weights
            rf_probs_w       = self._rf.predict_proba(weighted_feat.reshape(1, -1))[0]
            rf_probs_blended = 0.5 * rf_probs + 0.5 * rf_probs_w

            # ── KMeans probabilities (distance-based) ──────────────────────
            feat_scaled  = self._scaler.transform(feat.reshape(1, -1))
            km_cluster   = int(self._km.predict(feat_scaled)[0])
            km_class_idx = self._km_cluster_to_class.get(km_cluster, 3)
            km_type      = CLASSES[km_class_idx]

            dists    = np.linalg.norm(self._km.cluster_centers_ - feat_scaled, axis=1)
            km_probs = np.zeros(4)
            for cid, cidx in self._km_cluster_to_class.items():
                inv_d = 1.0 / (dists[cid] + 1e-9)
                km_probs[cidx] = max(km_probs[cidx], inv_d)
            km_probs /= km_probs.sum() + 1e-9

            # ── Ensemble ───────────────────────────────────────────────────
            ensemble_probs = 0.70 * rf_probs_blended + 0.30 * km_probs

            # ── QUBO penalties ─────────────────────────────────────────────
            penalties    = self._qubo_penalties(feat)
            final_scores = ensemble_probs - penalties * 0.25

            # ── Decision ──────────────────────────────────────────────────
            best_idx     = int(final_scores.argmax())
            company_type = CLASSES[best_idx]
            type_conf    = float(np.clip(final_scores[best_idx], 0.0, 0.99))

            # Mega-cap adjustment: very large companies rarely sustain pure-growth label
            if mkt_cap >= 200e9 and company_type == 'growth':
                blend_score = final_scores[CLASSES.index('blend')]
                if blend_score > 0.55 * final_scores[best_idx]:
                    company_type = 'blend'
                    type_conf    = float(np.clip(blend_score, 0.0, 0.99))

            rf_best  = int(rf_probs.argmax())
            rf_type  = CLASSES[rf_best]
            rf_conf  = float(rf_probs[rf_best])

            # Normalise gnnScores to proper 0-1 probabilities for display
            gnn_raw  = np.maximum(final_scores, 0.0)
            gnn_sum  = gnn_raw.sum()
            gnn_norm = gnn_raw / gnn_sum if gnn_sum > 0 else np.ones(4) / 4.0
            gnn_scores = {c: round(float(gnn_norm[i]), 4) for i, c in enumerate(CLASSES)}

            rf_importances = {
                f: round(float(v), 4)
                for f, v in zip(FEATURES, self._rf.feature_importances_)
            }
            graph_centrality = {
                f: round(float(self._pagerank.get(f, 0.0)), 4) for f in FEATURES
            }

            insight = self._causal_insight(feat, company_type)

            return {
                'companyType':     company_type,
                'typeConf':        round(type_conf, 3),
                'rfType':          rf_type,
                'rfConf':          round(rf_conf, 3),
                'kmType':          km_type,
                'gnnScores':       gnn_scores,
                'causalInsight':   insight['en'],
                'causalInsightEs': insight['es'],
                'rfImportances':   rf_importances,
                'graphCentrality': graph_centrality,
            }

        except Exception as exc:
            logger.warning("[HybridClassifier] classify() error: %s", exc)
            return self._rule_based_fallback(feat, mkt_cap)

    # ── Rule-based fallback ────────────────────────────────────────────────────

    def _rule_based_fallback(
        self, feat: np.ndarray, mkt_cap: float
    ) -> Dict[str, Any]:
        pe_z, gr_z, yield_z, pb_z, cap_log_norm, moat, growth_dim, quality_dim = feat

        if growth_dim > 0.60 and gr_z > 0.5:
            company_type, conf = 'growth', 0.65
        elif yield_z > 1.5:
            company_type, conf = 'dividend', 0.65
        elif pe_z < -0.5 and growth_dim < 0.50:
            company_type, conf = 'value', 0.60
        else:
            company_type, conf = 'blend', 0.52

        uniform = (1.0 - conf) / 3.0
        gnn_scores = {c: (conf if c == company_type else uniform) for c in CLASSES}
        insight = self._causal_insight(feat, company_type)

        return {
            'companyType':     company_type,
            'typeConf':        conf,
            'rfType':          company_type,
            'rfConf':          conf,
            'kmType':          company_type,
            'gnnScores':       gnn_scores,
            'causalInsight':   insight['en'],
            'causalInsightEs': insight['es'],
            'rfImportances':   {f: round(1.0 / len(FEATURES), 4) for f in FEATURES},
            'graphCentrality': {f: 0.0 for f in FEATURES},
        }


# ── Module-level singleton ──────────────────────────────────────────────────────
_classifier: HybridCompanyClassifier | None = None


def get_classifier() -> HybridCompanyClassifier:
    """Return the module-level singleton, creating it on first call."""
    global _classifier
    if _classifier is None:
        _classifier = HybridCompanyClassifier()
    return _classifier
