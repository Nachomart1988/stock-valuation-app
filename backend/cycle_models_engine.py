from __future__ import annotations

# backend/cycle_models_engine.py
# ════════════════════════════════════════════════════════════════════════════
# MODELOS AVANZADOS DE CICLOS  —  Fase 1
# Basado en Kim & Nelson (1999), "State-Space Models with Regime Switching".
#
# Fase 1 implementa:
#   • Modelo 6 — Unobserved Components (raíz unitaria + ciclo AR(2)), vía statsmodels.
#                Provee una descomposición tendencia/ciclo limpia y sirve de
#                inicializador del Modelo 1.
#   • Modelo 1 — Markov-Switching Unobserved Components + filtro de Kim (2 regímenes).
#                Filtro de Kim (Kalman condicional por par de regímenes + filtro de
#                Hamilton + collapsing) implementado a mano sobre numpy. Estimación
#                por máxima verosimilitud con reparametrización que garantiza
#                β₁>β₂, raíces AR(2) estacionarias y varianzas libres por régimen.
#
# Principios (del brief): 2 regímenes; estimación semanal; probabilidades
# suavizadas para histórico y filtradas para tiempo real; inicialización con un
# MS simple media+varianza como starting values.
# ════════════════════════════════════════════════════════════════════════════

import logging
import math
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Dependencias opcionales (el engine degrada con gracia si faltan) ────────────
try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except Exception:  # pragma: no cover
    PANDAS_AVAILABLE = False

try:
    from scipy.optimize import minimize
    from scipy.signal import hilbert as _scipy_hilbert
    from scipy.signal import find_peaks as _find_peaks
    from scipy.signal.windows import parzen as _parzen_window
    from scipy.stats import t as _student_t
    SCIPY_AVAILABLE = True
except Exception:  # pragma: no cover
    SCIPY_AVAILABLE = False

try:
    from statsmodels.tsa.statespace.structural import UnobservedComponents
    from statsmodels.tsa.regime_switching.markov_regression import MarkovRegression
    STATSMODELS_AVAILABLE = True
except Exception:  # pragma: no cover
    STATSMODELS_AVAILABLE = False

# Reutilizamos el fetcher FMP ya existente del analizador espectral.
try:
    from spectral_cycle_analyzer import HistoricalDataFetcher
    FETCHER_AVAILABLE = True
except Exception:  # pragma: no cover
    FETCHER_AVAILABLE = False
    HistoricalDataFetcher = None  # type: ignore


WEEKS_PER_YEAR = 52.0
MIN_WEEKLY_OBS = 150  # guarda de datos mínimos (≈3 años semanales)


# ════════════════════════════════════════════════════════════════════════════
# Helpers de reparametrización (garantizan restricciones del brief)
# ════════════════════════════════════════════════════════════════════════════

def _softplus(x: float) -> float:
    # log(1+e^x) estable
    if x > 30:
        return x
    return math.log1p(math.exp(x))


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _pacf_to_ar2(p1: float, p2: float) -> Tuple[float, float]:
    """Durbin-Levinson inverso para AR(2): parciales (p1,p2)∈(-1,1) → (φ1,φ2).
    Garantiza raíces dentro del círculo unitario (estacionariedad)."""
    phi2 = p2
    phi1 = p1 * (1.0 - p2)
    return phi1, phi2


def _ar2_to_pacf(phi1: float, phi2: float) -> Tuple[float, float]:
    """Inverso aproximado, para inicializar desde φ estimados por el Modelo 6."""
    p2 = phi2
    denom = (1.0 - p2)
    p1 = phi1 / denom if abs(denom) > 1e-6 else 0.0
    return float(np.clip(p1, -0.95, 0.95)), float(np.clip(p2, -0.95, 0.95))


def _ar2_period_weeks(phi1: float, phi2: float) -> Optional[float]:
    """Período del ciclo (semanas) de un AR(2) con raíces complejas, o None."""
    disc = phi1 * phi1 + 4.0 * phi2
    if disc >= 0 or phi2 >= 0:
        return None  # raíces reales → sin ciclo pseudo-periódico
    r = math.sqrt(-phi2)
    if r <= 1e-9:
        return None
    cos_theta = phi1 / (2.0 * r)
    cos_theta = max(-0.999999, min(0.999999, cos_theta))
    theta = math.acos(cos_theta)
    if theta <= 1e-9:
        return None
    return 2.0 * math.pi / theta


# ════════════════════════════════════════════════════════════════════════════
# Modelo 1 — Filtro de Kim para MS-Unobserved-Components (2 regímenes)
# ════════════════════════════════════════════════════════════════════════════
#
# Vector de estado  α_t = [μ_t, c_t, c_{t-1}]ᵀ
#   Medición:    y_t = Z·α_t + ε_t,            ε_t ~ N(0, σ²_ε,s)
#   Transición:  μ_t = μ_{t-1} + β_s + η_t,    η_t ~ N(0, σ²_η,s)
#                c_t = φ1_s·c_{t-1} + φ2_s·c_{t-2} + κ_t,  κ_t ~ N(0, σ²_κ,s)
# Markov:  P[i,j] = P(s_t=j | s_{t-1}=i)
# ════════════════════════════════════════════════════════════════════════════

Z_VEC = np.array([1.0, 1.0, 0.0])
N_STATE = 3
N_REGIME = 2


@dataclass
class _RegimeParams:
    beta: float                 # drift de la tendencia
    phi1: float                 # AR(2) ciclo
    phi2: float
    sig2_eta: float             # var shock tendencia
    sig2_kappa: float           # var shock ciclo
    sig2_eps: float             # var medición (irregular)


def _build_regime_matrices(rp: _RegimeParams) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Devuelve (T, c_intercept, Q) para un régimen."""
    T = np.array([
        [1.0, 0.0,      0.0],
        [0.0, rp.phi1,  rp.phi2],
        [0.0, 1.0,      0.0],
    ])
    c = np.array([rp.beta, 0.0, 0.0])
    Q = np.diag([rp.sig2_eta, rp.sig2_kappa, 0.0])
    return T, c, Q


def _unpack_ms_params(theta: np.ndarray) -> Tuple[List[_RegimeParams], np.ndarray]:
    """Convierte el vector libre `theta` (14,) en params por régimen + matriz de
    transición, aplicando las reparametrizaciones que imponen las restricciones."""
    # Índices del vector:
    # 0: beta0 ; 1: delta (beta1 = beta0 - softplus(delta))  → β0 > β1
    # 2-3: pacf0 (p1,p2) ; 4-6: log varianzas régimen 0 (eta,kappa,eps)
    # 7-8: pacf1 (p1,p2) ; 9-11: log varianzas régimen 1
    # 12: logit p00 ; 13: logit p11
    beta0 = float(theta[0])
    beta1 = beta0 - _softplus(float(theta[1]))

    p1_0 = math.tanh(float(theta[2]))
    p2_0 = math.tanh(float(theta[3]))
    phi1_0, phi2_0 = _pacf_to_ar2(p1_0, p2_0)
    eta0, kap0, eps0 = (math.exp(float(theta[4])), math.exp(float(theta[5])), math.exp(float(theta[6])))

    p1_1 = math.tanh(float(theta[7]))
    p2_1 = math.tanh(float(theta[8]))
    phi1_1, phi2_1 = _pacf_to_ar2(p1_1, p2_1)
    eta1, kap1, eps1 = (math.exp(float(theta[9])), math.exp(float(theta[10])), math.exp(float(theta[11])))

    rp0 = _RegimeParams(beta0, phi1_0, phi2_0, eta0, kap0, eps0)  # régimen 0 = Bull (β mayor)
    rp1 = _RegimeParams(beta1, phi1_1, phi2_1, eta1, kap1, eps1)  # régimen 1 = Bear

    p00 = _sigmoid(float(theta[12]))
    p11 = _sigmoid(float(theta[13]))
    P = np.array([
        [p00,        1.0 - p00],
        [1.0 - p11,  p11],
    ])
    return [rp0, rp1], P


def _stationary_dist(P: np.ndarray) -> np.ndarray:
    """Distribución ergódica de la cadena de Markov (para inicializar probs)."""
    try:
        vals, vecs = np.linalg.eig(P.T)
        idx = int(np.argmin(np.abs(vals - 1.0)))
        v = np.real(vecs[:, idx])
        v = v / v.sum()
        if np.all(v >= -1e-9):
            return np.clip(v, 1e-6, 1.0)
    except Exception:
        pass
    return np.array([0.5, 0.5])


def _kim_filter(y: np.ndarray, regimes: List[_RegimeParams], P: np.ndarray,
                return_states: bool = False):
    """Filtro de Kim. Devuelve (logL, prob_filt[T,2], pred_prob[T,2]) y,
    opcionalmente, los estados colapsados filtrados [T,3].

    pred_prob[t] = P(s_t | Y_{t-1}) (necesario para el smoother de Kim).
    """
    T = len(y)
    mats = [_build_regime_matrices(rp) for rp in regimes]  # (T,c,Q) por régimen

    # Inicialización del estado por régimen (difuso en la tendencia).
    a0 = np.array([y[0], 0.0, 0.0])
    P0 = np.diag([1e4, 1.0, 1.0])
    a_filt = [a0.copy() for _ in range(N_REGIME)]
    P_filt = [P0.copy() for _ in range(N_REGIME)]

    prob = _stationary_dist(P)  # P(s_0 | Y_0)

    logL = 0.0
    prob_filt_hist = np.zeros((T, N_REGIME))
    pred_prob_hist = np.zeros((T, N_REGIME))
    states_hist = np.zeros((T, N_STATE)) if return_states else None

    eye = np.eye(N_STATE)

    for t in range(T):
        # Acumuladores por (i,j)
        a_ij = [[None, None], [None, None]]
        P_ij = [[None, None], [None, None]]
        f_ij = np.zeros((N_REGIME, N_REGIME))           # densidad condicional
        joint_pred = np.zeros((N_REGIME, N_REGIME))     # P(s_{t-1}=i, s_t=j | Y_{t-1})

        pred_prob = P.T @ prob  # P(s_t=j | Y_{t-1}) = Σ_i P[i,j]·prob_i
        pred_prob_hist[t] = pred_prob

        for i in range(N_REGIME):
            for j in range(N_REGIME):
                Tj, cj, Qj = mats[j]
                a_pred = Tj @ a_filt[i] + cj
                P_pred = Tj @ P_filt[i] @ Tj.T + Qj

                v = y[t] - Z_VEC @ a_pred
                F = float(Z_VEC @ P_pred @ Z_VEC + regimes[j].sig2_eps)
                F = max(F, 1e-12)

                K = (P_pred @ Z_VEC) / F
                a_upd = a_pred + K * v
                P_upd = (eye - np.outer(K, Z_VEC)) @ P_pred

                a_ij[i][j] = a_upd
                P_ij[i][j] = P_upd
                f_ij[i, j] = math.exp(-0.5 * (math.log(2 * math.pi * F) + v * v / F))
                joint_pred[i, j] = P[i, j] * prob[i]

        # Filtro de Hamilton
        joint_lik = f_ij * joint_pred                  # P(y_t, s_{t-1}=i, s_t=j | Y_{t-1})
        lik_t = float(joint_lik.sum())
        lik_t = max(lik_t, 1e-300)
        logL += math.log(lik_t)

        joint_post = joint_lik / lik_t                 # P(s_{t-1}=i, s_t=j | Y_t)
        new_prob = joint_post.sum(axis=0)              # P(s_t=j | Y_t)
        new_prob = np.clip(new_prob, 1e-12, 1.0)
        new_prob = new_prob / new_prob.sum()
        prob_filt_hist[t] = new_prob

        # Collapsing de Kim: M² posteriores → M
        a_coll = [np.zeros(N_STATE) for _ in range(N_REGIME)]
        P_coll = [np.zeros((N_STATE, N_STATE)) for _ in range(N_REGIME)]
        for j in range(N_REGIME):
            wsum = new_prob[j]
            acc_a = np.zeros(N_STATE)
            for i in range(N_REGIME):
                w = joint_post[i, j] / wsum if wsum > 1e-12 else 0.0
                acc_a += w * a_ij[i][j]
            a_coll[j] = acc_a
            acc_P = np.zeros((N_STATE, N_STATE))
            for i in range(N_REGIME):
                w = joint_post[i, j] / wsum if wsum > 1e-12 else 0.0
                d = a_coll[j] - a_ij[i][j]
                acc_P += w * (P_ij[i][j] + np.outer(d, d))
            P_coll[j] = acc_P

        a_filt = a_coll
        P_filt = P_coll
        prob = new_prob

        if return_states:
            states_hist[t] = new_prob[0] * a_coll[0] + new_prob[1] * a_coll[1]

    return logL, prob_filt_hist, pred_prob_hist, states_hist


def _kim_smoother(prob_filt: np.ndarray, pred_prob: np.ndarray, P: np.ndarray) -> np.ndarray:
    """Smoother de probabilidades de Kim (1994). Recursión hacia atrás.
    P(s_t=j|Y_T) = Σ_k P(s_t=j|Y_t)·P[j,k]·P(s_{t+1}=k|Y_T) / P(s_{t+1}=k|Y_t)
    """
    T = prob_filt.shape[0]
    smooth = np.zeros_like(prob_filt)
    smooth[-1] = prob_filt[-1]
    for t in range(T - 2, -1, -1):
        for j in range(N_REGIME):
            s = 0.0
            for k in range(N_REGIME):
                denom = pred_prob[t + 1, k]
                if denom > 1e-12:
                    s += P[j, k] * smooth[t + 1, k] / denom
            smooth[t, j] = prob_filt[t, j] * s
        ssum = smooth[t].sum()
        if ssum > 1e-12:
            smooth[t] /= ssum
    return smooth


# ════════════════════════════════════════════════════════════════════════════
# Modelo 4 — Filtro de Kalman + smoother RTS para coeficientes TVP (random walk)
# ════════════════════════════════════════════════════════════════════════════
# Observación:  y_t = X_t · β_t + ε_t,  ε_t ~ N(0, h)
# Estado:       β_t = β_{t-1} + η_t,     η_t ~ N(0, diag(q))   (transición = I)

def _tvp_kalman_filter(y: np.ndarray, X: np.ndarray, q_diag: np.ndarray, h: float):
    """Filtro de Kalman para regresión de coeficientes variables. Devuelve
    (logL, a_filt[T,m], P_filt[T,m,m], a_pred[T,m], P_pred[T,m,m])."""
    T, m = X.shape
    a = np.zeros(m)
    P = np.eye(m) * 1e3            # prior difuso
    Q = np.diag(q_diag)
    logL = 0.0
    a_filt = np.zeros((T, m)); P_filt = np.zeros((T, m, m))
    a_pred = np.zeros((T, m)); P_pred = np.zeros((T, m, m))
    log2pi = math.log(2.0 * math.pi)
    for t in range(T):
        ap = a                      # predicción (random walk)
        Pp = P + Q
        x = X[t]
        v = float(y[t] - x @ ap)
        F = float(x @ Pp @ x + h)
        F = max(F, 1e-12)
        K = (Pp @ x) / F
        a = ap + K * v
        P = Pp - np.outer(K, x) @ Pp
        P = 0.5 * (P + P.T)         # simetriza por estabilidad numérica
        logL += -0.5 * (log2pi + math.log(F) + v * v / F)
        a_filt[t] = a; P_filt[t] = P; a_pred[t] = ap; P_pred[t] = Pp
    return logL, a_filt, P_filt, a_pred, P_pred


def _tvp_rts_smoother(a_filt, P_filt, a_pred, P_pred):
    """Smoother de Rauch-Tung-Striebel (transición = I → J = P_filt[t]·P_pred[t+1]⁻¹)."""
    T, m = a_filt.shape
    a_sm = a_filt.copy(); P_sm = P_filt.copy()
    for t in range(T - 2, -1, -1):
        try:
            J = P_filt[t] @ np.linalg.inv(P_pred[t + 1])
        except np.linalg.LinAlgError:
            J = P_filt[t] @ np.linalg.pinv(P_pred[t + 1])
        a_sm[t] = a_filt[t] + J @ (a_sm[t + 1] - a_pred[t + 1])
        P_sm[t] = P_filt[t] + J @ (P_sm[t + 1] - P_pred[t + 1]) @ J.T
    return a_sm, P_sm


# ════════════════════════════════════════════════════════════════════════════
# Modelo 5 — Markov-Switching GARCH (Haas-Mittnik-Paolella 2004) con Student-t
# ════════════════════════════════════════════════════════════════════════════
# Cada régimen k tiene su propia recursión GARCH(1,1) en PARALELO (sin path-
# dependence): σ²_{k,t} = ω_k + α_k·(r_{t-1}-μ_k)² + β_k·σ²_{k,t-1}.
# Densidad condicional: Student-t (colas pesadas) estandarizada a varianza unitaria.
# Filtro de Hamilton para mezclar regímenes.

@dataclass
class _GarchParams:
    mu: List[float]       # media por régimen
    omega: List[float]    # constante varianza
    alpha: List[float]    # ARCH
    beta: List[float]     # GARCH
    P: np.ndarray         # matriz de transición 2×2
    nu: float             # grados de libertad Student-t (común)


def _unpack_msgarch(theta: np.ndarray) -> _GarchParams:
    """Vector libre (11,) → params, con reparametrización que garantiza ω>0,
    α,β≥0 y α+β<1 (estacionariedad), ν>2."""
    mu = [float(theta[0]), float(theta[1])]
    omega = [math.exp(float(theta[2])), math.exp(float(theta[3]))]
    pers = [_sigmoid(float(theta[4])), _sigmoid(float(theta[5]))]       # α+β ∈ (0,1)
    share = [_sigmoid(float(theta[6])), _sigmoid(float(theta[7]))]      # α/(α+β) ∈ (0,1)
    alpha = [share[k] * pers[k] for k in range(2)]
    beta = [(1.0 - share[k]) * pers[k] for k in range(2)]
    p00, p11 = _sigmoid(float(theta[8])), _sigmoid(float(theta[9]))
    P = np.array([[p00, 1 - p00], [1 - p11, p11]])
    nu = 2.0 + math.exp(float(theta[10]))
    return _GarchParams(mu, omega, alpha, beta, P, nu)


def _msgarch_filter(r: np.ndarray, gp: _GarchParams, return_paths: bool = False):
    """Filtro de Hamilton sobre las recursiones GARCH paralelas. Devuelve
    (logL, prob_filt[T,2], prob_pred[T,2], sigma2[T,2]) y, opcionalmente, la
    varianza un-paso-adelante final y las varianzas incondicionales."""
    T = len(r)
    M = 2
    pers = [gp.alpha[k] + gp.beta[k] for k in range(M)]
    uncond = [gp.omega[k] / max(1e-10, 1.0 - pers[k]) for k in range(M)]
    s2 = [max(uncond[k], 1e-12) for k in range(M)]
    prob = _stationary_dist(gp.P)
    nu = gp.nu
    sf = math.sqrt((nu - 2.0) / nu)                # escala a varianza unitaria
    c_t = math.lgamma((nu + 1) / 2) - math.lgamma(nu / 2) - 0.5 * math.log(nu * math.pi)
    log_sf = math.log(sf)

    logL = 0.0
    prob_filt = np.zeros((T, M)); prob_pred = np.zeros((T, M)); sig2 = np.zeros((T, M))
    for t in range(T):
        pp = gp.P.T @ prob
        prob_pred[t] = pp
        dens = np.empty(M)
        for k in range(M):
            sd = math.sqrt(s2[k])
            tv = ((r[t] - gp.mu[k]) / sd) / sf
            logpdf = c_t - ((nu + 1) / 2) * math.log1p(tv * tv / nu) - log_sf - math.log(sd)
            dens[k] = math.exp(logpdf)
        joint = pp * dens
        lik = max(float(joint.sum()), 1e-300)
        logL += math.log(lik)
        prob = joint / lik
        prob_filt[t] = prob
        sig2[t] = s2
        s2 = [gp.omega[k] + gp.alpha[k] * (r[t] - gp.mu[k]) ** 2 + gp.beta[k] * s2[k]
              for k in range(M)]
    if return_paths:
        return logL, prob_filt, prob_pred, sig2, s2, uncond
    return logL, prob_filt, prob_pred, sig2


# ════════════════════════════════════════════════════════════════════════════
# Engine principal
# ════════════════════════════════════════════════════════════════════════════

class CycleModelsEngine:
    """Orquesta la descarga de datos, el preprocesamiento y la corrida de los
    modelos de ciclos. Mantiene los parámetros estimados del MS-UC para permitir
    actualización en tiempo real (`update_realtime`)."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("FMP_API_KEY")
        self._fetcher = (
            HistoricalDataFetcher(self.api_key)
            if (FETCHER_AVAILABLE and self.api_key) else None
        )
        # Estado para tiempo real (se setea tras estimar el Modelo 1).
        self._rt_regimes: Optional[List[_RegimeParams]] = None
        self._rt_P: Optional[np.ndarray] = None
        # Outputs crudos del Modelo 1 (numpy, sin pasar a JSON) para el Modelo 2.
        self._ms_trend: Optional[np.ndarray] = None
        self._ms_prob_bull_smooth: Optional[np.ndarray] = None

    # ── Datos / preprocesamiento ─────────────────────────────────────────────
    def _build_weekly_series(self, bars: List[Dict], variable: str
                             ) -> Tuple[List[str], np.ndarray, np.ndarray]:
        """Resamplea barras diarias FMP a semanal (W-FRI) y construye la serie.
        Devuelve (fechas_iso, y_serie, precio_semanal)."""
        if not PANDAS_AVAILABLE:
            raise RuntimeError("pandas no disponible")
        df = pd.DataFrame(bars)
        if "date" not in df or "close" not in df:
            raise ValueError("barras sin 'date'/'close'")
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        weekly_close = df["close"].resample("W-FRI").last().dropna()
        price = weekly_close.to_numpy(dtype=float)

        if variable == "log_price":
            y = np.log(price)
        else:
            # earnings_yield u otras quedan para fases posteriores → fallback log_price
            y = np.log(price)

        dates = [d.strftime("%Y-%m-%d") for d in weekly_close.index]
        return dates, y, price

    # ── Modelo 6: Unobserved Components (statsmodels) ────────────────────────
    def fit_unobserved_components(self, y: np.ndarray) -> Dict[str, Any]:
        if not STATSMODELS_AVAILABLE:
            return {"available": False, "error": "statsmodels no instalado"}
        try:
            mod = UnobservedComponents(
                y, level="random walk", autoregressive=2, irregular=True
            )
            res = mod.fit(disp=False, maxiter=200)

            # Extracción robusta de φ1, φ2 del componente autorregresivo.
            # res.params es un ndarray posicional → indexar por posición.
            params_arr = np.asarray(res.params, dtype=float)
            phi = []
            for i, name in enumerate(res.param_names):
                if name.startswith("ar.L") and i < len(params_arr):
                    phi.append(float(params_arr[i]))
            phi1 = phi[0] if len(phi) > 0 else 0.0
            phi2 = phi[1] if len(phi) > 1 else 0.0

            # Tendencia (nivel) y ciclo (componente AR) suavizados
            trend = self._safe_component(res, "level")
            cycle = self._safe_component(res, "autoregressive")

            period_w = _ar2_period_weeks(phi1, phi2)
            period_years = (period_w / WEEKS_PER_YEAR) if period_w else None

            return {
                "available": True,
                "trend": _to_list(trend),
                "cycle": _to_list(cycle),
                "phi1": phi1,
                "phi2": phi2,
                "cycle_period_years": period_years,
                "log_likelihood": float(res.llf),
                "aic": float(res.aic),
                "converged": bool(getattr(res.mle_retvals, "get", lambda *_: True)("converged", True))
                             if hasattr(res, "mle_retvals") else True,
            }
        except Exception as e:  # pragma: no cover
            logger.exception("UC fit falló")
            return {"available": False, "error": str(e)}

    @staticmethod
    def _safe_component(res, name: str) -> Optional[np.ndarray]:
        try:
            comp = getattr(res, name)
            arr = np.asarray(comp.smoothed, dtype=float)
            return arr
        except Exception:
            try:
                return np.asarray(res.states.smoothed[name], dtype=float)
            except Exception:
                return None

    # ── Modelo 1: MS-Unobserved-Components + filtro de Kim ───────────────────
    def _initial_ms_theta(self, y: np.ndarray, uc: Dict[str, Any]) -> np.ndarray:
        """Starting values: MS simple media+varianza sobre Δy para β y transición;
        Modelo 6 para φ y varianzas."""
        dy = np.diff(y)

        beta_hi, beta_lo = float(np.mean(dy)) + 0.5 * float(np.std(dy)), float(np.mean(dy)) - 0.5 * float(np.std(dy))
        p00_init, p11_init = 0.95, 0.95
        if STATSMODELS_AVAILABLE:
            try:
                ms = MarkovRegression(dy, k_regimes=2, trend="c", switching_variance=True)
                msr = ms.fit(disp=False, maxiter=100)
                means = []
                for r in range(2):
                    key = f"const[{r}]"
                    if key in msr.params.index:
                        means.append(float(msr.params[key]))
                if len(means) == 2:
                    beta_hi, beta_lo = max(means), min(means)
                # Probabilidades de permanencia
                try:
                    Pm = msr.regime_transition[:, :, 0]
                    diag = np.diag(Pm)
                    p00_init = float(np.clip(max(diag), 0.5, 0.995))
                    p11_init = float(np.clip(min(diag), 0.5, 0.995))
                except Exception:
                    pass
            except Exception:
                logger.info("MarkovRegression init falló; uso heurística")

        # φ y varianzas desde el Modelo 6 (o defaults coherentes con ciclo ~4 años)
        phi1 = uc.get("phi1") if uc.get("available") else None
        phi2 = uc.get("phi2") if uc.get("available") else None
        if phi1 is None or phi2 is None or _ar2_period_weeks(phi1, phi2) is None:
            # default: ciclo pseudo-periódico ~4 años, persistente
            r0, per0 = 0.95, 4.0 * WEEKS_PER_YEAR
            phi1 = 2.0 * r0 * math.cos(2.0 * math.pi / per0)
            phi2 = -(r0 ** 2)
        p1, p2 = _ar2_to_pacf(phi1, phi2)

        var_dy = max(float(np.var(dy)), 1e-8)
        # repartición inicial de varianza entre tendencia/ciclo/irregular
        log_eta = math.log(var_dy * 0.5)
        log_kap = math.log(var_dy * 0.3)
        log_eps = math.log(var_dy * 0.2)

        atanh = lambda v: 0.5 * math.log((1 + v) / (1 - v))
        p1c, p2c = float(np.clip(p1, -0.97, 0.97)), float(np.clip(p2, -0.97, 0.97))

        delta_init = math.log(math.expm1(max(beta_hi - beta_lo, 1e-4)))  # softplus⁻¹
        logit = lambda q: math.log(q / (1 - q))

        theta0 = np.array([
            beta_hi, delta_init,
            atanh(p1c), atanh(p2c), log_eta, log_kap, log_eps,
            atanh(p1c), atanh(p2c), log_eta, log_kap, log_eps,
            logit(p00_init), logit(p11_init),
        ], dtype=float)
        return theta0

    def fit_ms_unobserved_components(self, y: np.ndarray, dates: List[str],
                                     uc: Dict[str, Any]) -> Dict[str, Any]:
        if not (STATSMODELS_AVAILABLE and SCIPY_AVAILABLE):
            return {"available": False, "error": "statsmodels/scipy no disponibles"}
        try:
            theta0 = self._initial_ms_theta(y, uc)

            def neg_ll(theta: np.ndarray) -> float:
                try:
                    regimes, P = _unpack_ms_params(theta)
                    logL, _, _, _ = _kim_filter(y, regimes, P, return_states=False)
                    if not np.isfinite(logL):
                        return 1e10
                    return -logL
                except Exception:
                    return 1e10

            # L-BFGS-B con presupuesto acotado (gradiente numérico es caro: ~2·k
            # evals del filtro de Kim por iteración). Buenos starting values hacen
            # que un óptimo parcial sea suficiente; reportamos `converged`.
            res = minimize(neg_ll, theta0, method="L-BFGS-B",
                           options={"maxiter": 60, "maxfun": 2000, "ftol": 1e-6, "gtol": 1e-4})
            best = res.x
            best_ll = -res.fun
            converged = bool(res.success)
            # Fallback robusto SOLO si L-BFGS-B falló numéricamente (no por presupuesto)
            if not np.isfinite(best_ll):
                res2 = minimize(neg_ll, theta0, method="Nelder-Mead",
                                options={"maxiter": 500, "xatol": 1e-4, "fatol": 1e-3})
                if np.isfinite(-res2.fun):
                    best, best_ll = res2.x, -res2.fun
                    converged = bool(res2.success)

            regimes, P = _unpack_ms_params(best)
            logL, prob_filt, pred_prob, states = _kim_filter(y, regimes, P, return_states=True)
            prob_smooth = _kim_smoother(prob_filt, pred_prob, P)

            # Guardar para tiempo real
            self._rt_regimes, self._rt_P = regimes, P

            trend = states[:, 0]
            cycle = states[:, 1]

            # Guardar crudos para el Modelo 2 (análisis espectral por régimen)
            self._ms_trend = trend.copy()
            self._ms_prob_bull_smooth = prob_smooth[:, 0].copy()

            # Régimen actual (filtrado) — régimen 0 = Bull por construcción (β0>β1)
            cur_idx = int(np.argmax(prob_filt[-1]))
            cur_label = "Bull" if cur_idx == 0 else "Bear"
            cur_prob = float(prob_filt[-1, cur_idx])

            phase, phase_pos = _cycle_phase(cycle)
            period_w = _ar2_period_weeks(regimes[cur_idx].phi1, regimes[cur_idx].phi2)
            period_years = (period_w / WEEKS_PER_YEAR) if period_w else None

            regime_params = [
                {
                    "label": "Bull" if k == 0 else "Bear",
                    "beta": rp.beta, "phi1": rp.phi1, "phi2": rp.phi2,
                    "sigma_eta": math.sqrt(rp.sig2_eta),
                    "sigma_kappa": math.sqrt(rp.sig2_kappa),
                    "sigma_eps": math.sqrt(rp.sig2_eps),
                    "cycle_period_years": (lambda pw: pw / WEEKS_PER_YEAR if pw else None)(
                        _ar2_period_weeks(rp.phi1, rp.phi2)),
                }
                for k, rp in enumerate(regimes)
            ]

            return {
                "available": True,
                "trend": _to_list(trend),
                "cycle": _to_list(cycle),
                "regime_prob_bull_filtered": _to_list(prob_filt[:, 0]),
                "regime_prob_bull_smoothed": _to_list(prob_smooth[:, 0]),
                "current_regime": cur_label,
                "current_regime_prob": cur_prob,
                "cycle_phase": phase,
                "cycle_phase_position": phase_pos,
                "cycle_period_years": period_years,
                "transition_matrix": [[float(P[0, 0]), float(P[0, 1])],
                                       [float(P[1, 0]), float(P[1, 1])]],
                "regime_params": regime_params,
                "log_likelihood": float(logL),
                "converged": converged,
            }
        except Exception as e:  # pragma: no cover
            logger.exception("MS-UC fit falló")
            return {"available": False, "error": str(e)}

    def update_realtime(self, new_y: np.ndarray) -> Dict[str, Any]:
        """Corre el filtro de Kim con parámetros FIJOS (estimados en batch) sobre
        la serie extendida con la última observación. Devuelve prob filtrada."""
        if self._rt_regimes is None or self._rt_P is None:
            return {"available": False, "error": "modelo no estimado aún"}
        _, prob_filt, _, _ = _kim_filter(new_y, self._rt_regimes, self._rt_P)
        cur_idx = int(np.argmax(prob_filt[-1]))
        return {
            "available": True,
            "current_regime": "Bull" if cur_idx == 0 else "Bear",
            "current_regime_prob": float(prob_filt[-1, cur_idx]),
            "regime_prob_bull_filtered": float(prob_filt[-1, 0]),
        }

    # ── Modelo 2: Análisis Espectral por Régimen ─────────────────────────────
    def regime_spectral_analysis(self, y: np.ndarray) -> Dict[str, Any]:
        """Estima el espectro de la componente cíclica condicional a cada régimen.

        Reutiliza las probabilidades SUAVIZADAS del Modelo 1 (no re-estima nada).
        Señal = serie − tendencia estocástica μ̂ (parte cíclica observada),
        ponderada por la prob. suavizada de cada régimen (enfoque ponderado del
        brief). Periodograma suavizado: taper de Hann + ventana de Parzen sobre el
        periodograma → resolución en baja frecuencia para ciclos plurianuales.
        """
        if not SCIPY_AVAILABLE:
            return {"available": False, "error": "scipy no disponible"}
        if self._ms_prob_bull_smooth is None or self._ms_trend is None:
            return {"available": False, "error": "requiere el Modelo 1 (MS-UC) estimado"}
        try:
            n = len(y)
            trend = np.asarray(self._ms_trend, dtype=float)
            p_bull = np.clip(np.asarray(self._ms_prob_bull_smooth, dtype=float), 0.0, 1.0)
            if len(trend) != n or len(p_bull) != n:
                return {"available": False, "error": "longitudes inconsistentes con el Modelo 1"}

            # Componente cíclico observado, centrado y atenuado en los bordes.
            resid = np.nan_to_num(np.asarray(y, dtype=float) - trend, nan=0.0)
            resid = resid - float(np.mean(resid))
            taper = np.hanning(n)

            freqs = np.fft.rfftfreq(n, d=1.0)  # ciclos por semana
            with np.errstate(divide="ignore"):
                per_years = np.where(freqs > 0, 1.0 / (freqs * WEEKS_PER_YEAR), np.inf)
            # Banda de ciclos plausibles: 3 meses a 8 años.
            band = (per_years >= 0.25) & (per_years <= 8.0)
            band_idx = np.where(band)[0]

            # Ventana de Parzen (impar) para suavizar el periodograma.
            M = max(5, (n // 50) | 1)
            pw = np.asarray(_parzen_window(M), dtype=float)
            pw = pw / pw.sum()

            if len(band_idx) == 0:
                return {"available": False, "error": "sin frecuencias en la banda de ciclos"}

            regimes_out: List[Dict[str, Any]] = []
            for label, p in (("Bull", p_bull), ("Bear", 1.0 - p_bull)):
                x = p * resid
                X = np.fft.rfft(x * taper)
                P = (np.abs(X) ** 2) / n
                P_s = np.convolve(P, pw, mode="same")

                sub = P_s[band_idx]
                total_power = float(np.sum(sub))
                peak_local = int(np.argmax(sub))
                peak_idx = band_idx[peak_local]

                # Picos top dentro de la banda
                pk_local, _ = _find_peaks(sub)
                if len(pk_local):
                    order = np.argsort(sub[pk_local])[::-1][:3]
                    top = [{
                        "period_years": float(per_years[band_idx[pk_local[k]]]),
                        "power": float(sub[pk_local[k]]),
                        "contribution_pct": float(sub[pk_local[k]] / total_power * 100.0)
                                            if total_power > 0 else 0.0,
                    } for k in order]
                else:
                    top = [{
                        "period_years": float(per_years[peak_idx]),
                        "power": float(sub[peak_local]),
                        "contribution_pct": 100.0 if total_power > 0 else 0.0,
                    }]

                spectrum = [{"period_years": float(per_years[i]), "power": float(P_s[i])}
                            for i in band_idx]

                regimes_out.append({
                    "label": label,
                    "available": True,
                    "dominant_period_years": float(per_years[peak_idx]),
                    "dominant_power": float(P_s[peak_idx]),
                    "total_power": total_power,
                    "peaks": top,
                    "spectrum": spectrum,
                })

            comparison = _spectral_comparison(regimes_out)
            return {
                "available": True,
                "signal_description": "serie − tendencia estocástica (μ̂), ponderada por prob. suavizada",
                "window": "Parzen (periodograma) + Hann (taper)",
                "regimes": regimes_out,
                "comparison": comparison,
                "narrative": _spectral_narrative(comparison),
            }
        except Exception as e:  # pragma: no cover
            logger.exception("Spectral por régimen falló")
            return {"available": False, "error": str(e)}

    # ── Modelo 3: MS-VECM cointegrado ────────────────────────────────────────
    def _build_system_matrix(self, tickers: List[str], lookback_weeks: int
                             ) -> Tuple[List[str], np.ndarray, List[str]]:
        """Construye la matriz multivariada de log-niveles semanales alineados
        (inner-join por fecha) para el sistema de tickers dado."""
        if not PANDAS_AVAILABLE:
            raise RuntimeError("pandas no disponible")
        if self._fetcher is None:
            raise RuntimeError("fetcher no disponible (FMP_API_KEY)")
        cols = {}
        for tk in tickers:
            bars = self._fetcher.fetch(tk, max_bars=int(lookback_weeks * 5 + 200))
            if not bars:
                raise ValueError(f"sin datos históricos para {tk}")
            df = pd.DataFrame(bars)
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date").sort_index()
            cols[tk] = np.log(df["close"].resample("W-FRI").last())
        mat = pd.concat(cols, axis=1).dropna()
        if lookback_weeks and len(mat) > lookback_weeks:
            mat = mat.iloc[-lookback_weeks:]
        dates = [d.strftime("%Y-%m-%d") for d in mat.index]
        return dates, mat.to_numpy(dtype=float), list(mat.columns)

    def fit_ms_vecm(self, main_ticker: str, system_tickers: Optional[List[str]] = None,
                    lookback_weeks: int = 520) -> Dict[str, Any]:
        """Modelo 3 — MS-VECM con β común (Johansen) y α (velocidad de ajuste) +
        varianza que cambian por régimen. Empieza testeando cointegración; si no
        hay evidencia (rank 0) degrada a un MS-VAR en diferencias con aviso."""
        if not STATSMODELS_AVAILABLE:
            return {"available": False, "error": "statsmodels no instalado"}
        try:
            main = main_ticker.upper()
            partners = system_tickers if system_tickers else ["SPY", "TLT"]
            tickers = [main] + [p.upper() for p in partners if p and p.upper() != main]
            if len(tickers) < 2:
                return {"available": False, "error": "el sistema requiere ≥2 tickers"}
            dates, Y, names = self._build_system_matrix(tickers, lookback_weeks)
            return self._fit_ms_vecm_core(Y, names, dates)
        except ValueError as e:
            return {"available": False, "error": str(e)}
        except Exception as e:  # pragma: no cover
            logger.exception("MS-VECM falló")
            return {"available": False, "error": str(e)}

    def _fit_ms_vecm_core(self, Y: np.ndarray, names: List[str],
                          dates: List[str]) -> Dict[str, Any]:
        """Núcleo econométrico del MS-VECM (separado para poder testearlo con datos
        sintéticos sin depender de FMP). `Y` = log-niveles [T, k], acción en col 0."""
        from statsmodels.tsa.vector_ar.vecm import coint_johansen

        T, k = Y.shape
        if T < 120:
            return {"available": False, "error": f"sistema con muy pocas obs alineadas ({T})"}
        stock_idx, k_ar_diff = 0, 1

        # Johansen: evidencia de cointegración + vector β (común a los regímenes)
        joh = coint_johansen(Y, det_order=0, k_ar_diff=k_ar_diff)
        trace = [float(x) for x in joh.lr1]
        crit95 = [float(x) for x in joh.cvt[:, 1]]
        rank = int(np.sum(np.asarray(joh.lr1) > np.asarray(joh.cvt[:, 1])))
        cointegrated = rank >= 1

        beta1 = joh.evec[:, 0].astype(float)
        if abs(beta1[stock_idx]) > 1e-9:
            beta1 = beta1 / beta1[stock_idx]    # normaliza coef de la acción = 1
        ect_full = Y @ beta1                     # desviación del equilibrio de largo plazo

        # Ecuación de la acción (ECM):  ΔYstock_t = μ_s + α_s·ect_{t-1} + Γ·ΔY_{t-1} + ε
        dY = Y[1:] - Y[:-1]                       # fila r = ΔY_{r+1}
        y_dep = dY[1:T - 1, stock_idx]           # ΔY_t, t=2..T-1
        ect_lag = ect_full[1:T - 1]             # ect_{t-1}
        dY_lag = dY[0:T - 2, :]                 # ΔY_{t-1} (k columnas)
        eq_dates = dates[2:T]                     # fechas alineadas a la ecuación

        if cointegrated:
            exog = np.column_stack([ect_lag, dY_lag])
            switching_exog = [True] + [False] * dY_lag.shape[1]   # α switch, Γ común
        else:
            exog = dY_lag                                          # MS-VAR en diferencias
            switching_exog = [False] * dY_lag.shape[1]

        mod = MarkovRegression(y_dep, k_regimes=2, exog=exog, trend="c",
                               switching_variance=True, switching_exog=switching_exog)
        res = mod.fit(disp=False, maxiter=150)

        names_p = list(res.model.param_names)
        params = np.asarray(res.params, dtype=float)

        def _by_regime(prefix_root: str) -> List[Optional[float]]:
            out: List[Optional[float]] = []
            for r in range(2):
                nm = f"{prefix_root}[{r}]"
                out.append(float(params[names_p.index(nm)]) if nm in names_p else None)
            return out

        alphas = _by_regime("x1") if cointegrated else [None, None]
        sigmas = _by_regime("sigma2")

        sm = np.asarray(res.smoothed_marginal_probabilities, dtype=float)
        fl = np.asarray(res.filtered_marginal_probabilities, dtype=float)

        # Identificación de regímenes
        if cointegrated and all(a is not None for a in alphas):
            primary_idx = int(np.argmin(alphas))           # α más negativo = corrige más rápido
            labels = {primary_idx: "Mean-reverting", 1 - primary_idx: "Persistent"}
        else:
            primary_idx = int(np.argmin([s if s is not None else np.inf for s in sigmas]))
            labels = {primary_idx: "Low-vol", 1 - primary_idx: "High-vol"}
        other_idx = 1 - primary_idx

        def _halflife(a: Optional[float]) -> Optional[float]:
            if a is None:
                return None
            ar = 1.0 + a
            if 0 < ar < 1:
                return math.log(0.5) / math.log(ar)
            return None

        regimes_out = []
        for idx in (primary_idx, other_idx):
            hl = _halflife(alphas[idx])
            regimes_out.append({
                "label": labels[idx],
                "alpha": alphas[idx],
                "sigma": (math.sqrt(sigmas[idx]) if sigmas[idx] else None),
                "half_life_weeks": hl,
                "half_life_years": (hl / WEEKS_PER_YEAR) if hl else None,
            })

        prob_primary_sm = sm[:, primary_idx]
        prob_primary_fl = fl[:, primary_idx]
        cur_p = float(prob_primary_fl[-1])
        cur_label = labels[primary_idx] if cur_p >= 0.5 else labels[other_idx]
        cur_prob = cur_p if cur_p >= 0.5 else 1.0 - cur_p

        ect_mean, ect_std = float(np.mean(ect_full)), float(np.std(ect_full))
        ect_z = ((float(ect_full[-1]) - ect_mean) / ect_std) if ect_std > 0 else 0.0
        beta_out = [{"ticker": names[i], "coef": float(beta1[i])} for i in range(k)]

        return {
            "available": True,
            "cointegrated": cointegrated,
            "rank": rank,
            "system": names,
            "johansen": {"trace_stat": trace, "crit_95": crit95, "rank": rank},
            "beta": beta_out,
            "ect": {
                "current": float(ect_full[-1]), "mean": ect_mean, "std": ect_std,
                "zscore": ect_z, "series": _to_list(ect_full[2:T]),
            },
            "regimes": regimes_out,
            "regime_prob_primary_filtered": _to_list(prob_primary_fl),
            "regime_prob_primary_smoothed": _to_list(prob_primary_sm),
            "primary_label": labels[primary_idx],
            "current_regime": cur_label,
            "current_regime_prob": cur_prob,
            "dates": eq_dates,
            "log_likelihood": float(res.llf),
            "narrative": _vecm_narrative(cointegrated, rank, names, beta1, ect_z,
                                         cur_label, regimes_out),
        }

    # ── Modelo 4: Time-Varying Parameter VAR (Kalman) ────────────────────────
    def fit_tvp_var(self, main_ticker: str, system_tickers: Optional[List[str]] = None,
                    lookback_weeks: int = 520) -> Dict[str, Any]:
        """Modelo 4 — TVP-VAR: ecuación de la acción con coeficientes que varían
        suavemente (random walk), estimados por filtro de Kalman; hiperparámetros
        (varianzas) por ML. Captura cómo cambia la sensibilidad de la acción al
        mercado/tasas a lo largo del tiempo."""
        if not SCIPY_AVAILABLE:
            return {"available": False, "error": "scipy no disponible"}
        try:
            main = main_ticker.upper()
            partners = system_tickers if system_tickers else ["SPY", "TLT"]
            tickers = [main] + [p.upper() for p in partners if p and p.upper() != main]
            if len(tickers) < 2:
                return {"available": False, "error": "el sistema requiere ≥2 tickers"}
            dates, Y, names = self._build_system_matrix(tickers, lookback_weeks)
            return self._fit_tvp_var_core(Y, names, dates)
        except ValueError as e:
            return {"available": False, "error": str(e)}
        except Exception as e:  # pragma: no cover
            logger.exception("TVP-VAR falló")
            return {"available": False, "error": str(e)}

    def _fit_tvp_var_core(self, Y: np.ndarray, names: List[str],
                          dates: List[str]) -> Dict[str, Any]:
        """Núcleo del TVP-VAR (ecuación de la acción) — separado para testear sin FMP.
        `Y` = log-niveles [T, k], acción en col 0."""
        T, k = Y.shape
        if T < 120:
            return {"available": False, "error": f"sistema con muy pocas obs ({T})"}
        stock_idx = 0

        # Modelo de carga factorial con coeficientes variables (time-varying betas):
        #   Δstock_t = β0_t + β_self_t·Δstock_{t-1} + Σ β_j_t·Δpartner_{j,t} + ε_t
        # → sensibilidad CONTEMPORÁNEA al mercado/macro (beta variable) + persistencia
        #   propia (AR1 rezagada). Es lo que captura "cómo cambia la importancia de las
        #   variables a lo largo del tiempo" (objetivo del brief).
        partner_cols = [j for j in range(k) if j != stock_idx]
        dY = Y[1:] - Y[:-1]                        # log-retornos [T-1, k]
        y = dY[1:, stock_idx]                      # Δstock_t, t=1..T-2
        own_lag = dY[:-1, stock_idx]              # Δstock_{t-1}
        partners_now = dY[1:][:, partner_cols]    # Δpartner_{t} (contemporáneo)
        X = np.column_stack([np.ones(len(y)), own_lag, partners_now])
        eq_dates = dates[2:T]
        m = X.shape[1]                            # 1 + 1 + (k-1) = k+1 coeficientes
        var_y = max(float(np.var(y)), 1e-10)

        # ML de hiperparámetros: q_i = var_y·exp(θ_i) (cota suave q≤var_y), h = var_y·exp(θ_h)
        def _unpack(theta):
            q = var_y * np.exp(np.clip(theta[:m], -16.0, 0.0))   # ratio q/var_y ∈ (0,1]
            h = var_y * float(np.exp(np.clip(theta[m], -8.0, 3.0)))
            return q, max(h, 1e-12)

        def neg_ll(theta):
            q, h = _unpack(theta)
            try:
                ll, *_ = _tvp_kalman_filter(y, X, q, h)
                return -ll if np.isfinite(ll) else 1e10
            except Exception:
                return 1e10

        theta0 = np.array([math.log(0.01)] * m + [math.log(0.5)])
        bounds = [(-16.0, 0.0)] * m + [(-8.0, 3.0)]
        res = minimize(neg_ll, theta0, method="L-BFGS-B", bounds=bounds,
                       options={"maxiter": 120})
        q_hat, h_hat = _unpack(res.x)

        ll, a_filt, P_filt, a_pred, P_pred = _tvp_kalman_filter(y, X, q_hat, h_hat)
        a_sm, P_sm = _tvp_rts_smoother(a_filt, P_filt, a_pred, P_pred)

        coef_names = ["const", f"Δ{names[stock_idx]}(lag)"] + [f"Δ{names[j]}" for j in partner_cols]
        labels = ["Intercepto", "Persistencia propia"] + [f"Sensib. {names[j]}" for j in partner_cols]
        self_col = 1  # columna del rezago propio

        coefs_out = []
        n = len(y)
        idx_yr_ago = max(0, n - int(WEEKS_PER_YEAR))
        for c in range(m):
            series = a_sm[:, c]
            std = np.sqrt(np.clip(P_sm[:, c, c], 0.0, None))
            coefs_out.append({
                "name": coef_names[c],
                "label": labels[c],
                "series": _to_list(series),
                "std": _to_list(std),
                "current": float(series[-1]),
                "current_std": float(std[-1]),
                "year_ago": float(series[idx_yr_ago]),
                "is_self": (c == self_col),
            })

        narrative = _tvp_narrative(coefs_out, names)
        return {
            "available": True,
            "system": names,
            "dates": eq_dates,
            "n_obs": n,
            "coefficients": coefs_out,
            "obs_var": float(h_hat),
            "log_likelihood": float(ll),
            "converged": bool(res.success),
            "narrative": narrative,
        }

    # ── Modelo 5: Markov-Switching GARCH (volatilidad por régimen) ───────────
    def fit_ms_garch(self, ticker: str, lookback_weeks: int = 520) -> Dict[str, Any]:
        """Modelo 5 — MS-GARCH (Haas-Mittnik-Paolella) sobre retornos DIARIOS.
        Volatilidad regime-dependent, pronóstico de vol y VaR. Trabaja en alta
        frecuencia (el brief recomienda diario para este modelo)."""
        if not SCIPY_AVAILABLE:
            return {"available": False, "error": "scipy no disponible"}
        if self._fetcher is None:
            return {"available": False, "error": "fetcher no disponible (FMP_API_KEY)"}
        try:
            # Diario: ~5 barras por semana, tope 1500 (≈6 años) para mantenerlo ágil.
            max_bars = min(int(lookback_weeks * 5 + 50), 1550)
            bars = self._fetcher.fetch(ticker, max_bars=max_bars)
            if not bars or len(bars) < 250:
                return {"available": False,
                        "error": f"datos diarios insuficientes ({len(bars) if bars else 0})"}
            closes = np.array([float(b["close"]) for b in bars], dtype=float)
            r = np.diff(np.log(closes))
            dates = [b["date"] for b in bars][1:]
            return self._fit_ms_garch_core(r, dates)
        except Exception as e:  # pragma: no cover
            logger.exception("MS-GARCH falló")
            return {"available": False, "error": str(e)}

    def _fit_ms_garch_core(self, r: np.ndarray, dates: List[str]) -> Dict[str, Any]:
        """Núcleo del MS-GARCH (separado para testear sin FMP). `r` = retornos
        diarios (decimales)."""
        n = len(r)
        if n < 250:
            return {"available": False, "error": f"muy pocos retornos ({n})"}
        ann = math.sqrt(252.0)
        m = float(np.mean(r)); v = max(float(np.var(r)), 1e-10)

        # Inicialización: régimen 0 baja-vol, régimen 1 alta-vol
        pers0 = 0.97
        share0 = 0.07 / pers0
        uncond0 = [0.5 * v, 2.0 * v]
        omega0 = [uncond0[k] * (1 - pers0) for k in range(2)]
        logit = lambda q: math.log(q / (1 - q))
        theta0 = np.array([
            m, m,
            math.log(omega0[0]), math.log(omega0[1]),
            logit(pers0), logit(pers0),
            logit(share0), logit(share0),
            logit(0.97), logit(0.97),
            math.log(8.0 - 2.0),
        ])
        bounds = [
            (-0.1, 0.1), (-0.1, 0.1),
            (-30.0, -2.0), (-30.0, -2.0),
            (-2.0, 6.0), (-2.0, 6.0),
            (-6.0, 3.0), (-6.0, 3.0),
            (0.0, 6.0), (0.0, 6.0),
            (0.0, 3.7),                      # ν ∈ (3, 42)
        ]

        def neg_ll(theta):
            try:
                gp = _unpack_msgarch(theta)
                ll, *_ = _msgarch_filter(r, gp, return_paths=False)
                return -ll if np.isfinite(ll) else 1e12
            except Exception:
                return 1e12

        res = minimize(neg_ll, theta0, method="L-BFGS-B", bounds=bounds,
                       options={"maxiter": 200})
        gp = _unpack_msgarch(res.x)
        ll, prob_filt, prob_pred, sig2, s2_next, uncond = _msgarch_filter(
            r, gp, return_paths=True)
        prob_smooth = _kim_smoother(prob_filt, prob_pred, gp.P)

        # Identificación: régimen de ALTA volatilidad = mayor varianza incondicional
        hi = int(np.argmax(uncond)); lo = 1 - hi
        labels = {hi: "High-vol", lo: "Low-vol"}

        # Volatilidad condicional esperada (mezcla) anualizada
        exp_var = np.sum(prob_filt * sig2, axis=1)
        cond_vol_ann = np.sqrt(np.clip(exp_var, 0, None)) * ann

        cur_hi_prob = float(prob_filt[-1, hi])
        cur_label = "High-vol" if cur_hi_prob >= 0.5 else "Low-vol"
        cur_prob = cur_hi_prob if cur_hi_prob >= 0.5 else 1.0 - cur_hi_prob

        pers = [gp.alpha[k] + gp.beta[k] for k in range(2)]
        regimes_out = []
        for idx in (lo, hi):
            regimes_out.append({
                "label": labels[idx],
                "mu": gp.mu[idx],
                "omega": gp.omega[idx],
                "alpha": gp.alpha[idx],
                "beta": gp.beta[idx],
                "persistence": pers[idx],
                "uncond_vol_annual": math.sqrt(uncond[idx]) * ann,
            })

        # Pronóstico de vol (term structure) condicional al régimen actual
        forecast = self._msgarch_vol_forecast(prob_filt[-1], s2_next, gp, pers,
                                              horizons=(1, 5, 21, 63))
        # VaR / CVaR 1-día (Monte Carlo desde la mezcla un-paso-adelante)
        var = self._msgarch_var(prob_filt[-1], s2_next, gp)

        return {
            "available": True,
            "frequency": "daily",
            "n_obs": n,
            "dates": dates,
            "cond_vol_annual": _to_list(cond_vol_ann),
            "regime_prob_highvol_filtered": _to_list(prob_filt[:, hi]),
            "regime_prob_highvol_smoothed": _to_list(prob_smooth[:, hi]),
            "current_regime": cur_label,
            "current_regime_prob": cur_prob,
            "current_vol_annual": float(cond_vol_ann[-1]),
            "regimes": regimes_out,
            "transition_matrix": [[float(gp.P[0, 0]), float(gp.P[0, 1])],
                                   [float(gp.P[1, 0]), float(gp.P[1, 1])]],
            "nu": gp.nu,
            "forecast": forecast,
            "var": var,
            "log_likelihood": float(ll),
            "converged": bool(res.success),
            "narrative": _msgarch_narrative(cur_label, cur_prob,
                                            float(cond_vol_ann[-1]), forecast, var, gp.nu),
        }

    @staticmethod
    def _msgarch_vol_forecast(prob_last, s2_next, gp: "_GarchParams", pers,
                              horizons=(1, 5, 21, 63)) -> List[Dict[str, Any]]:
        ann = math.sqrt(252.0)
        M = 2
        piF = np.asarray(prob_last, dtype=float).copy()
        vF = [float(s2_next[k]) for k in range(M)]      # varianza en t+1 por régimen
        maxh = max(horizons)
        evs = []
        for _h in range(maxh):
            piF = gp.P.T @ piF                           # prob de régimen en t+h
            ev = float(sum(piF[k] * vF[k] for k in range(M)))
            evs.append(ev)
            vF = [gp.omega[k] + pers[k] * vF[k] for k in range(M)]   # multi-step GARCH
        out = []
        for hh in horizons:
            avg_var = float(np.mean(evs[:hh]))
            out.append({"horizon_days": hh, "vol_annual": math.sqrt(max(avg_var, 0.0)) * ann})
        return out

    @staticmethod
    def _msgarch_var(prob_last, s2_next, gp: "_GarchParams",
                     n_sim: int = 200000) -> Dict[str, float]:
        """VaR/CVaR 1-día por Monte Carlo desde la mezcla un-paso-adelante."""
        rng = np.random.default_rng(12345)
        pi1 = gp.P.T @ np.asarray(prob_last, dtype=float)
        pi1 = np.clip(pi1, 0, None); pi1 = pi1 / pi1.sum()
        sf = math.sqrt((gp.nu - 2.0) / gp.nu)
        ks = rng.choice(2, size=n_sim, p=pi1)
        z = _student_t.rvs(gp.nu, size=n_sim, random_state=rng) * sf
        mu = np.array(gp.mu)[ks]
        sd = np.sqrt(np.array(s2_next))[ks]
        sims = mu + sd * z
        q5 = float(np.percentile(sims, 5)); q1 = float(np.percentile(sims, 1))
        cvar95 = float(sims[sims <= q5].mean())
        return {
            "var_95_1d": -q5, "var_99_1d": -q1, "cvar_95_1d": -cvar95,
        }

    # ── Orquestador ──────────────────────────────────────────────────────────
    def analyze(self, ticker: str, variable: str = "log_price",
                frequency: str = "weekly", models: Optional[List[str]] = None,
                lookback_weeks: int = 520,
                system_tickers: Optional[List[str]] = None) -> Dict[str, Any]:
        models = models or ["ms_uc", "uc"]
        if self._fetcher is None:
            raise RuntimeError("FMP_API_KEY no configurada o fetcher no disponible")

        # ~lookback_weeks semanas → necesitamos ≈ 5x barras diarias + colchón
        max_bars = int(lookback_weeks * 5 + 200)
        bars = self._fetcher.fetch(ticker, max_bars=max_bars)
        if not bars:
            raise ValueError(f"Sin datos históricos para {ticker}")

        dates, y, price = self._build_weekly_series(bars, variable)
        if lookback_weeks and len(y) > lookback_weeks:
            dates, y, price = dates[-lookback_weeks:], y[-lookback_weeks:], price[-lookback_weeks:]

        if len(y) < MIN_WEEKLY_OBS:
            raise ValueError(
                f"Datos insuficientes para {ticker}: {len(y)} semanas (mínimo {MIN_WEEKLY_OBS})")

        payload: Dict[str, Any] = {
            "ticker": ticker.upper(),
            "variable_used": variable,
            "frequency": frequency,
            "n_obs": len(y),
            "dates": dates,
            "series": _to_list(y),
            "price": _to_list(price),
            "models": {},
        }

        # Modelo 6 primero (también inicializa el Modelo 1)
        uc = {"available": False, "error": "no solicitado"}
        if "uc" in models or "ms_uc" in models:
            uc = self.fit_unobserved_components(y)
        if "uc" in models:
            payload["models"]["uc"] = uc

        # Modelo 1 (requerido por el Modelo 2). Si se pide spectral pero no ms_uc,
        # igual lo estimamos porque el espectral depende de sus probabilidades.
        need_ms = ("ms_uc" in models) or ("spectral" in models)
        if need_ms and "ms_uc" not in payload["models"]:
            ms_res = self.fit_ms_unobserved_components(y, dates, uc)
            if "ms_uc" in models:
                payload["models"]["ms_uc"] = ms_res

        # Modelo 2 — Análisis Espectral por Régimen (reusa el Modelo 1)
        if "spectral" in models:
            payload["models"]["spectral"] = self.regime_spectral_analysis(y)

        # Modelo 3 — MS-VECM cointegrado (sistema multivariado propio)
        if "ms_vecm" in models:
            payload["models"]["ms_vecm"] = self.fit_ms_vecm(
                ticker, system_tickers=system_tickers, lookback_weeks=lookback_weeks)

        # Modelo 4 — TVP-VAR (coeficientes variables vía Kalman)
        if "tvp_var" in models:
            payload["models"]["tvp_var"] = self.fit_tvp_var(
                ticker, system_tickers=system_tickers, lookback_weeks=lookback_weeks)

        # Modelo 5 — MS-GARCH (volatilidad por régimen, datos diarios)
        if "ms_garch" in models:
            payload["models"]["ms_garch"] = self.fit_ms_garch(
                ticker, lookback_weeks=lookback_weeks)

        payload["narrative"] = _build_narrative(payload)
        return payload


# ════════════════════════════════════════════════════════════════════════════
# Utilidades de salida
# ════════════════════════════════════════════════════════════════════════════

def _to_list(arr) -> Optional[List[float]]:
    if arr is None:
        return None
    a = np.asarray(arr, dtype=float)
    a = np.where(np.isfinite(a), a, None)  # NaN/inf → None para JSON
    return [None if (v is None or (isinstance(v, float) and not math.isfinite(v))) else float(v)
            for v in a.tolist()]


def _cycle_phase(cycle: Optional[np.ndarray]) -> Tuple[str, Optional[float]]:
    """Fase del ciclo vía señal analítica de Hilbert. c(t) ≈ A·cos(θ(t)).
    θ≈0 → pico ; θ≈±π → valle ; θ≈-π/2 → subiendo ; θ≈+π/2 → bajando."""
    if cycle is None or len(cycle) < 8 or not SCIPY_AVAILABLE:
        return "unknown", None
    c = np.asarray(cycle, dtype=float)
    c = c - np.mean(c)
    if np.allclose(c, 0):
        return "unknown", None
    try:
        analytic = _scipy_hilbert(c)
        theta = float(np.angle(analytic[-1]))
    except Exception:
        return "unknown", None
    if -math.pi / 4 <= theta <= math.pi / 4:
        phase = "peak"
    elif math.pi / 4 < theta <= 3 * math.pi / 4:
        phase = "falling"
    elif theta > 3 * math.pi / 4 or theta < -3 * math.pi / 4:
        phase = "trough"
    else:
        phase = "rising"
    phase_pos = float((math.cos(theta) + 1.0) / 2.0)  # 0=valle, 1=pico
    return phase, phase_pos


_PHASE_ES = {
    "peak": "pico (máximo del ciclo)",
    "falling": "bajando (post-pico)",
    "trough": "valle (mínimo del ciclo)",
    "rising": "subiendo (post-valle)",
    "unknown": "indeterminada",
}


def _build_narrative(payload: Dict[str, Any]) -> str:
    ms = payload.get("models", {}).get("ms_uc", {})
    parts: List[str] = []
    if ms.get("available"):
        reg = ms.get("current_regime", "?")
        prob = ms.get("current_regime_prob")
        prob_txt = f"{prob * 100:.0f}%" if isinstance(prob, (int, float)) else "?"
        parts.append(
            f"Régimen direccional actual: {reg} (prob. {prob_txt}, filtrada).")
        per = ms.get("cycle_period_years")
        if per:
            parts.append(f"Ciclo dominante ≈ {per:.1f} años.")
        phase = ms.get("cycle_phase", "unknown")
        parts.append(f"Fase del ciclo: {_PHASE_ES.get(phase, phase)}.")
        if not ms.get("converged", True):
            parts.append("⚠ La estimación no convergió plenamente; interpretar con cautela.")
    else:
        parts.append("Modelo MS-UC no disponible en esta corrida.")
    return " ".join(parts)


_RATIO_CAP = 99.0  # tope para evitar ratios absurdos cuando un régimen casi no ocurre


def _spectral_comparison(regimes: List[Dict[str, Any]]) -> Dict[str, Any]:
    by = {r["label"]: r for r in regimes if r.get("available")}
    if "Bull" not in by or "Bear" not in by:
        return {}
    b, r = by["Bull"], by["Bear"]
    bp, rp = b["dominant_power"], r["dominant_power"]
    # Ratio robusto: si un régimen casi no tiene potencia (apenas ocurre en la
    # muestra), el cociente se dispara → lo acotamos y marcamos el caso degenerado.
    eps = max(bp, rp) * 1e-6
    if min(bp, rp) <= eps:
        ratio = None  # un régimen está prácticamente ausente
        degenerate = True
    else:
        raw = bp / rp
        degenerate = raw > _RATIO_CAP or raw < 1.0 / _RATIO_CAP
        ratio = float(min(max(raw, 1.0 / _RATIO_CAP), _RATIO_CAP))
    return {
        "bull_dominant_period_years": b["dominant_period_years"],
        "bear_dominant_period_years": r["dominant_period_years"],
        "bull_dominant_power": bp,
        "bear_dominant_power": rp,
        "stronger_regime": "Bull" if bp >= rp else "Bear",
        "power_ratio": ratio,
        "ratio_degenerate": degenerate,
    }


def _spectral_narrative(comp: Dict[str, Any]) -> str:
    if not comp:
        return "Análisis espectral por régimen no disponible."
    bull_p = comp.get("bull_dominant_period_years")
    bear_p = comp.get("bear_dominant_period_years")
    stronger = comp.get("stronger_regime", "?")
    stronger_es = "alcista" if stronger == "Bull" else "bajista"
    parts = []
    if bull_p:
        parts.append(f"Ciclo dominante en régimen alcista ≈ {bull_p:.1f} años")
    if bear_p:
        parts.append(f"en régimen bajista ≈ {bear_p:.1f} años")
    msg = "; ".join(parts) + "." if parts else ""
    if comp.get("ratio_degenerate"):
        msg += (f" La potencia cíclica se concentra casi por completo en el régimen "
                f"{stronger_es} (el otro régimen apenas ocurre en la muestra).")
    elif comp.get("power_ratio"):
        msg += (f" Los ciclos son más fuertes en el régimen {stronger_es} "
                f"(potencia ×{comp['power_ratio']:.1f} bull/bear).")
    return msg


def _vecm_narrative(cointegrated: bool, rank: int, names: List[str],
                    beta1: np.ndarray, ect_z: float, cur_label: str,
                    regimes: List[Dict[str, Any]]) -> str:
    if not cointegrated:
        return (f"Sin evidencia de cointegración (rank {rank}) entre {', '.join(names)}. "
                "No hay relación de equilibrio de largo plazo estable; el modelo opera "
                "como MS-VAR en diferencias (sin término de corrección de error).")
    parts = []
    # relación de largo plazo (acción ≈ combinación del resto)
    others = ", ".join(f"{-beta1[i]:.2f}·{names[i]}" for i in range(1, len(names)))
    parts.append(f"Relación de largo plazo: {names[0]} ≈ {others} (rank {rank}).")
    # desvío actual
    if ect_z > 1.5:
        parts.append(f"Hoy {names[0]} está CARO vs. su equilibrio (z={ect_z:+.1f}σ).")
    elif ect_z < -1.5:
        parts.append(f"Hoy {names[0]} está BARATO vs. su equilibrio (z={ect_z:+.1f}σ).")
    else:
        parts.append(f"Desvío actual cercano al equilibrio (z={ect_z:+.1f}σ).")
    # régimen + half-life
    mr = next((r for r in regimes if r["label"] == "Mean-reverting"), None)
    parts.append(f"Régimen actual: {cur_label}.")
    if mr and mr.get("half_life_weeks"):
        hl_w = mr["half_life_weeks"]
        hl_txt = (f"{hl_w / WEEKS_PER_YEAR:.1f} años" if hl_w >= 26
                  else f"{hl_w:.0f} semana" + ("s" if round(hl_w) != 1 else ""))
        parts.append("En el régimen de reversión, los desvíos se cierran a la mitad "
                     f"en ≈ {hl_txt}.")
    return " ".join(parts)


def _tvp_narrative(coefs: List[Dict[str, Any]], names: List[str]) -> str:
    parts: List[str] = []
    # sensibilidad al mercado (primer partner, índice 1 del sistema)
    sens = [c for c in coefs if c["name"].startswith("Δ") and not c["is_self"]]
    for c in sens:
        cur, prev = c["current"], c["year_ago"]
        arrow = "subió" if cur > prev + 0.05 else ("bajó" if cur < prev - 0.05 else "estable")
        parts.append(f"{c['label']}: {cur:+.2f} (hace 1 año {prev:+.2f}, {arrow}).")
    # persistencia propia
    self_c = next((c for c in coefs if c["is_self"]), None)
    if self_c:
        parts.append(f"Persistencia propia (AR1): {self_c['current']:+.2f}.")
    return " ".join(parts) if parts else "Trayectorias de coeficientes estimadas."


def _msgarch_narrative(cur_label: str, cur_prob: float, cur_vol_ann: float,
                       forecast: List[Dict[str, Any]], var: Dict[str, float],
                       nu: float) -> str:
    lab_es = "alta volatilidad" if cur_label == "High-vol" else "baja volatilidad"
    parts = [f"Régimen actual: {lab_es} (prob. {cur_prob * 100:.0f}%).",
             f"Volatilidad condicional ≈ {cur_vol_ann * 100:.0f}% anual."]
    f1 = next((f for f in forecast if f["horizon_days"] == 21), None)
    if f1:
        parts.append(f"Pronóstico a 21 días: {f1['vol_annual'] * 100:.0f}% anual.")
    if var:
        parts.append(f"VaR 95% 1-día: {var['var_95_1d'] * 100:.1f}% "
                     f"(99%: {var['var_99_1d'] * 100:.1f}%, colas Student-t ν={nu:.1f}).")
    return " ".join(parts)


# ════════════════════════════════════════════════════════════════════════════
# Singleton
# ════════════════════════════════════════════════════════════════════════════

_ENGINE: Optional[CycleModelsEngine] = None


def get_cycle_models_engine() -> CycleModelsEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = CycleModelsEngine()
    return _ENGINE
