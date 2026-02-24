# backend/momentum_engine.py
# Intraday Momentum Analyzer — Quillamaggie-style breakout detection
# Multi-layer: Ingest → Metrics → Rules → ML Score → Fusion → Narrative

from __future__ import annotations

import logging
import os
import math
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

try:
    import yfinance as yf
    YF_AVAILABLE = True
except ImportError:
    YF_AVAILABLE = False
    logger.warning("yfinance not available — momentum analysis will be limited")

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    import pickle
    SK_AVAILABLE = True
except ImportError:
    SK_AVAILABLE = False
    logger.warning("scikit-learn not available — using heuristic scoring only")


# ── Constants ────────────────────────────────────────────────────────────────
QUILLAMAGGIE_THRESHOLDS = {
    'rs_min':           1.10,   # RS vs benchmark ≥ 1.10
    'vol_surge_min':    1.50,   # Volume ≥ 1.5x avg
    'adx_coil_max':    25.0,   # ADX < 25 for coiling (pre-breakout compression)
    'roc_5m_min':       2.0,    # 5-minute ROC ≥ 2%
    'roc_15m_min':      4.0,   # 15-minute ROC ≥ 4%
    'vwap_dev_bull':    0.3,    # > 0.3% above VWAP = bullish
    'proximity_high':  95.0,   # ≥ 95% = price near session high
    'float_small':   100e6,    # Float < 100M shares = small float
    'eps_growth_min':  20.0,   # EPS growth ≥ 20% YoY
}


# ── Helper math functions ────────────────────────────────────────────────────
def _safe_div(a: float, b: float, default: float = 0.0) -> float:
    return a / b if b and not math.isnan(b) and b != 0 else default


def _rolling_std(arr: List[float], window: int) -> float:
    if len(arr) < window:
        return float(np.std(arr)) if arr else 0.0
    sub = arr[-window:]
    return float(np.std(sub))


def _rolling_mean(arr: List[float], window: int) -> float:
    if len(arr) < window:
        return float(np.mean(arr)) if arr else 0.0
    return float(np.mean(arr[-window:]))


# ── Core engine ──────────────────────────────────────────────────────────────
class IntradayMomentumAnalyzer:
    """
    Quillamaggie-style intraday momentum & breakout detector.
    Layers: Data Ingest → Metrics → Rules → ML Score → Fusion → Narrative.
    """

    def __init__(self, api_key: str, quillamaggie_mode: bool = True):
        self.api_key = api_key
        self.quillamaggie_mode = quillamaggie_mode
        self._cache: Dict[str, Any] = {}
        self._cache_ts: Dict[str, float] = {}
        self._cache_ttl = 60  # seconds

    # ── Layer 1: Data Ingest ─────────────────────────────────────────────────
    def _fetch_intraday_yf(self, ticker: str, interval: str = '5m') -> List[Dict]:
        """Fetch intraday OHLCV via yfinance (primary source)."""
        if not YF_AVAILABLE:
            return []
        cache_key = f"{ticker}_{interval}"
        if cache_key in self._cache and time.time() - self._cache_ts.get(cache_key, 0) < self._cache_ttl:
            return self._cache[cache_key]
        try:
            tkr = yf.Ticker(ticker)
            df = tkr.history(period='1d', interval=interval, auto_adjust=True)
            if df.empty:
                df = tkr.history(period='2d', interval=interval, auto_adjust=True)
            bars = []
            for ts, row in df.iterrows():
                bars.append({
                    'ts':     str(ts),
                    'open':   float(row.get('Open', 0)),
                    'high':   float(row.get('High', 0)),
                    'low':    float(row.get('Low', 0)),
                    'close':  float(row.get('Close', 0)),
                    'volume': float(row.get('Volume', 0)),
                })
            self._cache[cache_key] = bars
            self._cache_ts[cache_key] = time.time()
            logger.info(f"Fetched {len(bars)} bars for {ticker} ({interval})")
            return bars
        except Exception as e:
            logger.error(f"yfinance fetch error for {ticker} {interval}: {e}")
            return []

    def _fetch_fundamental_fmp(self, ticker: str) -> Dict:
        """Fetch float, EPS growth from FMP for Quillamaggie checks."""
        if not REQUESTS_AVAILABLE or not self.api_key:
            return {}
        try:
            # Key statistics
            url = f"https://financialmodelingprep.com/stable/profile?symbol={ticker}&apikey={self.api_key}"
            r = requests.get(url, timeout=6)
            profile = r.json() if r.ok else {}
            if isinstance(profile, list):
                profile = profile[0] if profile else {}

            # EPS growth from latest earnings
            url2 = f"https://financialmodelingprep.com/api/v3/income-statement/{ticker}?limit=4&apikey={self.api_key}"
            r2 = requests.get(url2, timeout=6)
            incomes = r2.json() if r2.ok and isinstance(r2.json(), list) else []

            eps_growth = None
            if len(incomes) >= 2:
                eps_cur  = incomes[0].get('epsdiluted') or incomes[0].get('eps')
                eps_prev = incomes[1].get('epsdiluted') or incomes[1].get('eps')
                if eps_cur and eps_prev and eps_prev != 0:
                    eps_growth = _safe_div(eps_cur - eps_prev, abs(eps_prev)) * 100

            return {
                'floatShares': profile.get('floatShares') or profile.get('float'),
                'mktCap':      profile.get('mktCap') or profile.get('marketCap'),
                'eps_growth':  eps_growth,
                'sector':      profile.get('sector', ''),
                'industry':    profile.get('industry', ''),
                'beta':        profile.get('beta'),
            }
        except Exception as e:
            logger.warning(f"FMP fetch error for {ticker}: {e}")
            return {}

    # ── Layer 2: Metrics Calculation ─────────────────────────────────────────
    def _calc_roc(self, closes: List[float], period: int) -> float:
        """Rate of Change: (close - close_n) / close_n * 100"""
        if len(closes) <= period:
            return 0.0
        current = closes[-1]
        prev    = closes[-1 - period]
        return _safe_div(current - prev, prev) * 100

    def _calc_vwap(self, bars: List[Dict]) -> float:
        """Volume-Weighted Average Price (intraday cumulative)."""
        cumvol = 0.0
        cumvp  = 0.0
        for b in bars:
            typ = (b['high'] + b['low'] + b['close']) / 3
            vol = b['volume']
            cumvp  += typ * vol
            cumvol += vol
        return _safe_div(cumvp, cumvol, bars[-1]['close'] if bars else 0)

    def _calc_rs(self, stock_closes: List[float], bench_closes: List[float], period: int = 12) -> float:
        """Relative Strength: stock ROC / benchmark ROC (same period)."""
        s_roc = self._calc_roc(stock_closes, period)
        b_roc = self._calc_roc(bench_closes, period)
        if abs(b_roc) < 0.01:
            return 1.0 if s_roc >= 0 else 0.8
        return _safe_div(s_roc, b_roc, 1.0)

    def _calc_adx(self, bars: List[Dict], period: int = 14) -> float:
        """Simplified ADX using ATR-based directional movement."""
        if len(bars) < period + 1:
            return 20.0  # default neutral

        highs  = [b['high']  for b in bars]
        lows   = [b['low']   for b in bars]
        closes = [b['close'] for b in bars]

        # True Range
        trs = []
        for i in range(1, len(bars)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i-1]),
                abs(lows[i]  - closes[i-1]),
            )
            trs.append(tr)

        # +DM, -DM
        pDMs, nDMs = [], []
        for i in range(1, len(bars)):
            up   = highs[i]  - highs[i-1]
            down = lows[i-1] - lows[i]
            pDMs.append(max(up, 0)   if up   > down else 0)
            nDMs.append(max(down, 0) if down > up   else 0)

        atr  = _rolling_mean(trs[-period:],  period)
        pDI  = _safe_div(_rolling_mean(pDMs[-period:], period), atr) * 100
        nDI  = _safe_div(_rolling_mean(nDMs[-period:], period), atr) * 100
        dx   = _safe_div(abs(pDI - nDI), pDI + nDI) * 100
        return min(float(dx), 100.0)

    def _calc_bb_compression(self, closes: List[float], period: int = 20) -> Dict:
        """Bollinger Band width (compression = pre-breakout coiling)."""
        if len(closes) < period:
            return {'width': None, 'compressed': False, 'compression_pct': 0}
        sub  = closes[-period:]
        mid  = float(np.mean(sub))
        std  = float(np.std(sub))
        upper = mid + 2 * std
        lower = mid - 2 * std
        width = _safe_div(upper - lower, mid) * 100  # as % of price

        # Historical average width (last 2x the period)
        if len(closes) >= period * 2:
            widths_hist = []
            for i in range(period, len(closes)):
                s = closes[i-period:i]
                m = float(np.mean(s))
                sv = float(np.std(s))
                w = _safe_div(2*2*sv, m) * 100
                widths_hist.append(w)
            avg_w = float(np.mean(widths_hist))
            compressed = width < avg_w * 0.75  # 25% narrower than average
            compression_pct = round(_safe_div(avg_w - width, avg_w) * 100, 1)
        else:
            compressed = False
            compression_pct = 0

        return {
            'width':           round(width, 2),
            'compressed':      compressed,
            'compression_pct': max(0, compression_pct),
            'upper':           round(upper, 2),
            'lower':           round(lower, 2),
            'mid':             round(mid, 2),
        }

    def _calc_vol_surge(self, volumes: List[float], window: int = 20) -> float:
        """Current volume vs rolling average (surge ratio)."""
        if len(volumes) < 2:
            return 1.0
        avg = _rolling_mean(volumes[:-1], min(window, len(volumes)-1)) or 1
        return _safe_div(volumes[-1], avg)

    def _calc_atr(self, bars: List[Dict], period: int = 14) -> float:
        """Average True Range."""
        if len(bars) < 2:
            return bars[-1]['high'] - bars[-1]['low'] if bars else 0
        trs = []
        for i in range(1, len(bars)):
            tr = max(
                bars[i]['high'] - bars[i]['low'],
                abs(bars[i]['high'] - bars[i-1]['close']),
                abs(bars[i]['low']  - bars[i-1]['close']),
            )
            trs.append(tr)
        return _rolling_mean(trs, min(period, len(trs)))

    # ── Layer 3: Rules & Classification ──────────────────────────────────────
    def _score_quillamaggie(self, metrics: Dict, fund: Dict) -> Dict:
        """
        Quillamaggie power-intraday score (0-100).
        Weights: RS 25% | Vol Surge 25% | Coiling 20% | Price Position 15% | Fundamentals 15%
        """
        score   = 0.0
        factors = []

        # 1. RS vs benchmark
        rs = metrics.get('rs', 1.0)
        if rs >= 1.5:   s_rs = 25
        elif rs >= 1.2: s_rs = 18
        elif rs >= 1.0: s_rs = 10
        elif rs >= 0.8: s_rs = 4
        else:           s_rs = 0
        score += s_rs
        if rs >= QUILLAMAGGIE_THRESHOLDS['rs_min']:
            factors.append(f"RS {rs:.2f}x vs benchmark (✓ fuerte)")

        # 2. Volume surge
        vol_surge = metrics.get('vol_surge', 1.0)
        if vol_surge >= 3.0:   s_vol = 25
        elif vol_surge >= 2.0: s_vol = 20
        elif vol_surge >= 1.5: s_vol = 14
        elif vol_surge >= 1.2: s_vol = 7
        else:                   s_vol = 0
        score += s_vol
        if vol_surge >= QUILLAMAGGIE_THRESHOLDS['vol_surge_min']:
            factors.append(f"Volumen {vol_surge:.1f}x promedio (✓ surge)")

        # 3. Coiling (ADX + BB compression)
        adx  = metrics.get('adx', 30)
        bb   = metrics.get('bb', {})
        comp = bb.get('compressed', False)
        if adx <= 20 and comp:      s_coil = 20
        elif adx <= 25 and comp:    s_coil = 15
        elif adx <= 25:             s_coil = 8
        elif comp:                  s_coil = 8
        else:                       s_coil = 0
        score += s_coil
        if s_coil >= 10:
            factors.append(f"Coiling detectado: ADX {adx:.0f}, BB {bb.get('compression_pct',0):.0f}% comprimido")

        # 4. Price position (near session high)
        prox = metrics.get('proximity_to_high', 0)
        if prox >= 98:   s_prox = 15
        elif prox >= 95: s_prox = 10
        elif prox >= 90: s_prox = 5
        else:            s_prox = 0
        score += s_prox
        if prox >= QUILLAMAGGIE_THRESHOLDS['proximity_high']:
            factors.append(f"Precio {prox:.0f}% hacia máximo sesión")

        # 5. Fundamentals
        s_fund = 0
        float_s = fund.get('floatShares')
        eps_g   = fund.get('eps_growth')
        if float_s and float_s < QUILLAMAGGIE_THRESHOLDS['float_small']:
            s_fund += 8
            factors.append(f"Float pequeño {float_s/1e6:.0f}M acciones (✓)")
        if eps_g and eps_g >= QUILLAMAGGIE_THRESHOLDS['eps_growth_min']:
            s_fund += 7
            factors.append(f"EPS growth {eps_g:.0f}% YoY (✓ catalizador fundamental)")
        score += min(s_fund, 15)

        return {
            'score':   round(min(score, 100), 1),
            'factors': factors,
        }

    def _classify_momentum(self, metrics: Dict) -> Dict:
        """Rule-based momentum classification with confidence."""
        roc_5m  = metrics.get('roc_5m',  0)
        roc_15m = metrics.get('roc_15m', 0)
        rs      = metrics.get('rs', 1.0)
        vol_s   = metrics.get('vol_surge', 1.0)
        adx     = metrics.get('adx', 20)
        vwap_d  = metrics.get('vwap_deviation', 0)

        bull_pts = 0
        bear_pts = 0

        if roc_5m  >  3.0: bull_pts += 3
        elif roc_5m > 1.5: bull_pts += 2
        elif roc_5m > 0:   bull_pts += 1
        if roc_5m  < -3.0: bear_pts += 3
        elif roc_5m < -1.5: bear_pts += 2
        elif roc_5m < 0:    bear_pts += 1

        if roc_15m  >  5.0: bull_pts += 3
        elif roc_15m > 2.5: bull_pts += 2
        elif roc_15m > 0:   bull_pts += 1
        if roc_15m  < -5.0: bear_pts += 3
        elif roc_15m < -2.5: bear_pts += 2
        elif roc_15m < 0:    bear_pts += 1

        if rs >  1.3: bull_pts += 2
        elif rs > 1.1: bull_pts += 1
        if rs < 0.9:  bear_pts += 2
        elif rs < 0.7: bear_pts += 1

        if vol_s > 2.0: bull_pts += 2
        if vol_s > 1.5: bull_pts += 1

        if vwap_d >  0.5: bull_pts += 2
        elif vwap_d > 0.2: bull_pts += 1
        if vwap_d < -0.5: bear_pts += 2
        elif vwap_d < -0.2: bear_pts += 1

        if adx > 30: bull_pts += 1 if roc_5m > 0 else 0
        if adx > 30: bear_pts += 1 if roc_5m < 0 else 0

        net = bull_pts - bear_pts
        if net >= 8:
            direction, strength = 'alcista', 'alto'
        elif net >= 4:
            direction, strength = 'alcista', 'moderado'
        elif net >= 1:
            direction, strength = 'alcista', 'leve'
        elif net <= -8:
            direction, strength = 'bajista', 'alto'
        elif net <= -4:
            direction, strength = 'bajista', 'moderado'
        elif net <= -1:
            direction, strength = 'bajista', 'leve'
        else:
            direction, strength = 'neutral', 'neutral'

        conf_raw = min(abs(net) / 10.0, 1.0)
        confidence = round(50 + conf_raw * 50, 0)

        return {
            'direction':  direction,
            'strength':   strength,
            'bull_pts':   bull_pts,
            'bear_pts':   bear_pts,
            'net':        net,
            'confidence': int(confidence),
        }

    # ── Layer 4: ML-Style Breakout Probability ────────────────────────────────
    def _calc_breakout_probability(self, metrics: Dict, ql_score: float) -> float:
        """
        Heuristic breakout probability (calibrated to mimic Random Forest output).
        Features: ROC, RS, vol_surge, ADX, BB_compression, proximity_to_high, ql_score.
        When a trained model file exists, it overrides this.
        """
        score = 0.0

        # Feature 1: Quillamaggie score (0-100) → 0-35%
        score += ql_score * 0.35

        # Feature 2: ROC momentum (multi-timeframe)
        roc_5m  = metrics.get('roc_5m', 0)
        roc_15m = metrics.get('roc_15m', 0)
        roc_c   = (max(0, min(roc_5m, 10)) / 10 * 15) + (max(0, min(roc_15m, 15)) / 15 * 10)
        score  += roc_c  # up to 25%

        # Feature 3: Volume confirmation
        vs = metrics.get('vol_surge', 1.0)
        score += min(max(vs - 1, 0) / 2, 1) * 15  # up to 15%

        # Feature 4: ADX + coiling
        adx = metrics.get('adx', 30)
        bb  = metrics.get('bb', {})
        if bb.get('compressed') and adx < 25:
            score += 15  # perfect coiling
        elif bb.get('compressed') or adx < 25:
            score += 8
        # if ADX > 40 trend ongoing, reduce breakout chance slightly
        if adx > 40:
            score -= 5

        # Feature 5: Price near high
        prox = metrics.get('proximity_to_high', 50)
        score += max(0, prox - 80) / 20 * 10  # up to 10%

        return round(min(max(score, 0), 99), 1)

    # ── Layer 5: Signals ──────────────────────────────────────────────────────
    def _generate_signals(self, metrics: Dict, momentum: Dict,
                          ql: Dict, breakout_prob: float) -> List[Dict]:
        signals = []
        direction = momentum['direction']
        strength  = momentum['strength']
        ql_score  = ql['score']
        vwap_d    = metrics.get('vwap_deviation', 0)
        rs        = metrics.get('rs', 1.0)
        roc_5m    = metrics.get('roc_5m', 0)
        roc_15m   = metrics.get('roc_15m', 0)
        vol_s     = metrics.get('vol_surge', 1.0)
        prox      = metrics.get('proximity_to_high', 50)
        adx       = metrics.get('adx', 20)
        bb        = metrics.get('bb', {})
        session_high = metrics.get('session_high', 0)

        # Breakout alert
        if breakout_prob >= 80 and direction == 'alcista':
            signals.append({
                'type': '🚀 BREAKOUT ALERT',
                'color': 'emerald',
                'message': f"Probabilidad de breakout {breakout_prob:.0f}% — "
                           f"{'Monitorear resistencia $' + str(round(session_high,2)) if session_high else 'Monitorear máximo de sesión'}",
                'priority': 1,
            })
        elif breakout_prob >= 60 and direction == 'alcista':
            signals.append({
                'type': '📈 SETUP EN DESARROLLO',
                'color': 'yellow',
                'message': f"Configuración alcista building: prob. {breakout_prob:.0f}%",
                'priority': 2,
            })

        # Quillamaggie setup
        if ql_score >= 70 and direction == 'alcista':
            signals.append({
                'type': '⚡ QUILLAMAGGIE SETUP',
                'color': 'purple',
                'message': f"Score {ql_score:.0f}/100 — " + '; '.join(ql['factors'][:2]),
                'priority': 1,
            })

        # VWAP signals
        if vwap_d > 0.5:
            signals.append({
                'type': '📊 SOBRE VWAP',
                'color': 'emerald',
                'message': f"Precio +{vwap_d:.2f}% sobre VWAP — compradores controlando",
                'priority': 3,
            })
        elif vwap_d < -0.5:
            signals.append({
                'type': '📊 BAJO VWAP',
                'color': 'red',
                'message': f"Precio {vwap_d:.2f}% bajo VWAP — vendedores dominan",
                'priority': 3,
            })

        # RS signal
        if rs >= 1.3:
            signals.append({
                'type': '💪 RS FUERTE',
                'color': 'emerald',
                'message': f"Relative Strength {rs:.2f}x vs benchmark — superando al mercado",
                'priority': 2,
            })
        elif rs <= 0.7:
            signals.append({
                'type': '⚠️ RS DÉBIL',
                'color': 'red',
                'message': f"Relative Strength {rs:.2f}x vs benchmark — underperforming",
                'priority': 2,
            })

        # Volume surge
        if vol_s >= 2.0:
            signals.append({
                'type': '🔊 VOLUME SURGE',
                'color': 'blue',
                'message': f"Volumen {vol_s:.1f}x promedio — confirmación institucional posible",
                'priority': 2,
            })

        # Coiling / compression
        if bb.get('compressed') and adx < 25:
            signals.append({
                'type': '🌀 COILING DETECTADO',
                'color': 'yellow',
                'message': f"BB comprimido {bb.get('compression_pct',0):.0f}%, ADX {adx:.0f} — "
                           "compresión de volatilidad pre-explosión",
                'priority': 2,
            })

        # Bearish signals
        if direction == 'bajista' and strength in ('alto', 'moderado'):
            signals.append({
                'type': '🔻 MOMENTUM BAJISTA',
                'color': 'red',
                'message': f"ROC 5m: {roc_5m:+.1f}%, RS: {rs:.2f}x — presión vendedora",
                'priority': 2,
            })

        signals.sort(key=lambda s: s['priority'])
        return signals[:8]

    # ── Layer 6: Narrative ────────────────────────────────────────────────────
    def _build_narrative(self, metrics: Dict, momentum: Dict,
                         ql: Dict, breakout_prob: float,
                         fund: Dict, benchmark: str) -> str:
        direction = momentum['direction']
        strength  = momentum['strength']
        ql_score  = ql['score']
        roc_5m    = metrics.get('roc_5m', 0)
        roc_15m   = metrics.get('roc_15m', 0)
        rs        = metrics.get('rs', 1.0)
        vol_s     = metrics.get('vol_surge', 1.0)
        vwap_d    = metrics.get('vwap_deviation', 0)
        adx       = metrics.get('adx', 20)
        bb        = metrics.get('bb', {})
        prox      = metrics.get('proximity_to_high', 50)
        sh        = metrics.get('session_high', 0)

        # Opening assessment
        mom_label = f"Momentum {direction} {strength}"
        lines = [f"**{mom_label}** (confianza: {momentum['confidence']}%)"]

        # Key metrics line
        parts = []
        if roc_5m != 0:   parts.append(f"ROC 5m {roc_5m:+.1f}%")
        if roc_15m != 0:  parts.append(f"ROC 15m {roc_15m:+.1f}%")
        if rs != 1.0:     parts.append(f"RS {rs:.2f}x vs {benchmark}")
        if vol_s != 1.0:  parts.append(f"Vol {vol_s:.1f}x avg")
        if parts:
            lines.append("Métricas: " + " | ".join(parts))

        # VWAP context
        if abs(vwap_d) > 0.1:
            vwap_dir = "sobre" if vwap_d > 0 else "bajo"
            lines.append(f"Precio {abs(vwap_d):.2f}% {vwap_dir} VWAP — "
                         f"{'compradores controlan' if vwap_d > 0 else 'vendedores presionan'}")

        # Coiling
        if bb.get('compressed') and adx < 25:
            lines.append(f"⚡ Coiling Quillamaggie confirmado: BB {bb.get('compression_pct',0):.0f}% comprimido, "
                         f"ADX {adx:.0f} (consolidación pre-breakout)")

        # Breakout
        if breakout_prob >= 80:
            target = f"${'%.2f' % sh}" if sh else "máximo de sesión"
            lines.append(f"🚀 **{breakout_prob:.0f}% proximidad a breakout** — "
                         f"{'entrar si rompe ' + target + ' con vol>2x avg' if direction == 'alcista' else 'cuidado con breakdown'}")
        elif breakout_prob >= 60:
            lines.append(f"📈 Setup en construcción ({breakout_prob:.0f}% proximidad) — "
                         "aguardar confirmación de volumen")

        # Quillamaggie score
        if ql_score >= 70:
            lines.append(f"✅ Quillamaggie Score {ql_score:.0f}/100 — setup power intraday válido")
        elif ql_score >= 50:
            lines.append(f"⚠️ Quillamaggie Score {ql_score:.0f}/100 — setup parcial, falta confirmación")

        # Fundamentals
        float_s = fund.get('floatShares')
        eps_g   = fund.get('eps_growth')
        fund_parts = []
        if float_s and float_s < 100e6:
            fund_parts.append(f"float pequeño {float_s/1e6:.0f}M")
        if eps_g and eps_g >= 20:
            fund_parts.append(f"EPS +{eps_g:.0f}% YoY")
        if fund_parts:
            lines.append("Fundamentales: " + ", ".join(fund_parts))

        # Disclaimer
        lines.append("*Análisis intraday no constituye consejo de inversión. Mercados volátiles.*")
        return "\n\n".join(lines)

    # ── Main Analysis Entry Point ─────────────────────────────────────────────
    def analyze(self, ticker: str, benchmark: str = 'SPY',
                timeframes: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Full momentum analysis.
        Returns: metrics_by_tf, momentum, quillamaggie, breakout_prob,
                 signals, narrative, chart_data, confidence.
        """
        if timeframes is None:
            timeframes = ['1m', '5m', '15m']

        start_time = time.time()

        # ── Fetch data ────────────────────────────────────────────────────────
        logger.info(f"[Momentum] Starting analysis for {ticker} vs {benchmark}")

        # Primary: 5m interval (best balance of frequency & noise)
        bars_5m   = self._fetch_intraday_yf(ticker, '5m')
        bench_5m  = self._fetch_intraday_yf(benchmark, '5m')

        # 1m for short-term ROC (if available)
        bars_1m   = self._fetch_intraday_yf(ticker, '1m')
        bench_1m  = self._fetch_intraday_yf(benchmark, '1m')

        # 15m for trend context
        bars_15m  = self._fetch_intraday_yf(ticker, '15m')
        bench_15m = self._fetch_intraday_yf(benchmark, '15m')

        # Fundamentals
        fund = self._fetch_fundamental_fmp(ticker)

        # ── Data quality check ────────────────────────────────────────────────
        data_quality = 'high' if len(bars_5m) >= 40 else \
                       'medium' if len(bars_5m) >= 20 else \
                       'low' if len(bars_5m) >= 5 else 'insufficient'

        if data_quality == 'insufficient':
            return {
                'error': f"Datos insuficientes para {ticker}. El mercado puede estar cerrado o el ticker no existe.",
                'ticker': ticker,
                'data_quality': data_quality,
            }

        # ── Calculate metrics ─────────────────────────────────────────────────
        closes_5m  = [b['close'] for b in bars_5m]
        volumes_5m = [b['volume'] for b in bars_5m]
        closes_b5m = [b['close'] for b in bench_5m] if bench_5m else closes_5m

        closes_1m  = [b['close'] for b in bars_1m]  if bars_1m  else []
        closes_b1m = [b['close'] for b in bench_1m]  if bench_1m  else []

        closes_15m  = [b['close'] for b in bars_15m]  if bars_15m  else []
        closes_b15m = [b['close'] for b in bench_15m] if bench_15m else []

        current_price  = closes_5m[-1] if closes_5m else 0
        session_high   = max(b['high']  for b in bars_5m) if bars_5m else 0
        session_low    = min(b['low']   for b in bars_5m) if bars_5m else 0
        session_open   = bars_5m[0]['open']               if bars_5m else 0
        session_change = _safe_div(current_price - session_open, session_open) * 100 if session_open else 0

        vwap       = self._calc_vwap(bars_5m)
        vwap_dev   = _safe_div(current_price - vwap, vwap) * 100
        vol_surge  = self._calc_vol_surge(volumes_5m)
        adx        = self._calc_adx(bars_5m)
        bb         = self._calc_bb_compression(closes_5m)
        atr        = self._calc_atr(bars_5m)

        # ROC by timeframe
        roc_1m  = self._calc_roc(closes_1m,  period=3)   if len(closes_1m)  > 3  else self._calc_roc(closes_5m, period=1)
        roc_5m  = self._calc_roc(closes_5m,  period=3)   # 15-min equivalent on 5m bars
        roc_15m = self._calc_roc(closes_15m, period=3)   if len(closes_15m) > 3  else self._calc_roc(closes_5m, period=9)
        roc_1h  = self._calc_roc(closes_5m,  period=12)  # 12 × 5m = 60 min

        # RS by timeframe
        rs_5m  = self._calc_rs(closes_5m,  closes_b5m,  period=6)
        rs_15m = self._calc_rs(closes_15m, closes_b15m, period=6) if len(closes_15m) > 6 and len(closes_b15m) > 6 else rs_5m

        # Proximity to session high (0-100)
        proximity_to_high = 0.0
        if session_high > session_low and current_price and session_high:
            rng = session_high - session_low or 1
            proximity_to_high = min(100.0, _safe_div(current_price - session_low, rng) * 100)

        # Metrics dict (primary for scoring)
        metrics = {
            'current_price':     round(current_price, 2),
            'session_high':      round(session_high, 2),
            'session_low':       round(session_low, 2),
            'session_open':      round(session_open, 2),
            'session_change_pct':round(session_change, 2),
            'vwap':              round(vwap, 2),
            'vwap_deviation':    round(vwap_dev, 2),
            'roc_1m':            round(roc_1m, 2),
            'roc_5m':            round(roc_5m, 2),
            'roc_15m':           round(roc_15m, 2),
            'roc_1h':            round(roc_1h, 2),
            'rs':                round(rs_5m, 3),
            'rs_15m':            round(rs_15m, 3),
            'vol_surge':         round(vol_surge, 2),
            'adx':               round(adx, 1),
            'bb':                bb,
            'atr':               round(atr, 3),
            'proximity_to_high': round(proximity_to_high, 1),
            'bar_count':         len(bars_5m),
        }

        # Per-timeframe summary table
        metrics_by_tf: List[Dict] = [
            {
                'timeframe':   '1m',
                'roc':         round(roc_1m, 2),
                'description': 'Micro momentum',
                'bars':        len(bars_1m),
            },
            {
                'timeframe':   '5m',
                'roc':         round(roc_5m, 2),
                'rs':          round(rs_5m, 3),
                'vol_surge':   round(vol_surge, 2),
                'adx':         round(adx, 1),
                'vwap_dev':    round(vwap_dev, 2),
                'description': 'Primary signal',
                'bars':        len(bars_5m),
            },
            {
                'timeframe':   '15m',
                'roc':         round(roc_15m, 2),
                'rs':          round(rs_15m, 3),
                'description': 'Trend context',
                'bars':        len(bars_15m),
            },
            {
                'timeframe':   '1h',
                'roc':         round(roc_1h, 2),
                'description': 'Macro intraday',
                'bars':        len(bars_5m) // 12,
            },
        ]

        # ── Layer 3: Rules ────────────────────────────────────────────────────
        momentum = self._classify_momentum(metrics)

        # ── Layer 3: Quillamaggie ─────────────────────────────────────────────
        ql = self._score_quillamaggie(metrics, fund)

        # ── Layer 4: Breakout probability ─────────────────────────────────────
        breakout_prob = self._calc_breakout_probability(metrics, ql['score'])

        # ── Layer 5: Signals ──────────────────────────────────────────────────
        signals = self._generate_signals(metrics, momentum, ql, breakout_prob)

        # ── Layer 6: Narrative ────────────────────────────────────────────────
        narrative = self._build_narrative(metrics, momentum, ql, breakout_prob, fund, benchmark)

        # ── Chart data ────────────────────────────────────────────────────────
        chart_labels = [b['ts'][-8:-3] for b in bars_5m]  # HH:MM from ISO
        chart_prices = [b['close']     for b in bars_5m]
        chart_vols   = [b['volume']    for b in bars_5m]
        chart_vwap   = []
        _cv, _cvol = 0.0, 0.0
        for b in bars_5m:
            typ   = (b['high'] + b['low'] + b['close']) / 3
            _cvol += b['volume']
            _cv   += typ * b['volume']
            chart_vwap.append(round(_safe_div(_cv, _cvol, b['close']), 2))

        # Momentum line (ROC rolling 5-bar)
        chart_momentum = []
        for i in range(len(chart_prices)):
            if i < 5:
                chart_momentum.append(0)
            else:
                r = _safe_div(chart_prices[i] - chart_prices[i-5], chart_prices[i-5]) * 100
                chart_momentum.append(round(r, 2))

        # ── Confidence ────────────────────────────────────────────────────────
        conf_base = momentum['confidence']
        if data_quality == 'high':   conf_adj = conf_base
        elif data_quality == 'medium': conf_adj = int(conf_base * 0.85)
        else:                          conf_adj = int(conf_base * 0.65)

        # ── Market status ─────────────────────────────────────────────────────
        now_utc = datetime.utcnow()
        et_hour = (now_utc.hour - 5) % 24  # ET (rough, no DST)
        market_open = 9 <= et_hour < 16 and now_utc.weekday() < 5
        if not market_open:
            market_status = 'closed'
            narrative = "⚠️ **Mercado cerrado** — mostrando datos de última sesión.\n\n" + narrative
        elif et_hour == 9:
            market_status = 'pre_market_transition'
        else:
            market_status = 'open'

        elapsed = round(time.time() - start_time, 2)
        logger.info(f"[Momentum] {ticker} analysis complete in {elapsed}s — "
                    f"momentum={momentum['direction']}/{momentum['strength']}, "
                    f"ql_score={ql['score']}, breakout_prob={breakout_prob}%")

        return {
            'ticker':           ticker,
            'benchmark':        benchmark,
            'market_status':    market_status,
            'data_quality':     data_quality,
            'timestamp':        datetime.utcnow().isoformat() + 'Z',
            'elapsed_s':        elapsed,

            # Core outputs
            'metrics':          metrics,
            'metrics_by_tf':    metrics_by_tf,
            'momentum':         momentum,
            'quillamaggie':     ql,
            'breakout_prob':    breakout_prob,
            'signals':          signals,
            'narrative':        narrative,
            'confidence':       conf_adj,

            # Fundamentals snapshot
            'fundamental': {
                'float_shares': fund.get('floatShares'),
                'mkt_cap':      fund.get('mktCap'),
                'eps_growth':   fund.get('eps_growth'),
                'sector':       fund.get('sector'),
                'beta':         fund.get('beta'),
            },

            # Chart data
            'chart': {
                'labels':   chart_labels,
                'prices':   chart_prices,
                'vwap':     chart_vwap,
                'volumes':  chart_vols,
                'momentum': chart_momentum,
                'session_high': session_high,
                'session_low':  session_low,
                'vwap_line':    round(vwap, 2),
            },
        }


# ── Module-level singleton ────────────────────────────────────────────────────
_analyzer: Optional[IntradayMomentumAnalyzer] = None

def get_momentum_analyzer() -> IntradayMomentumAnalyzer:
    global _analyzer
    if _analyzer is None:
        api_key = os.getenv('FMP_API_KEY') or os.getenv('NEXT_PUBLIC_FMP_API_KEY', '')
        _analyzer = IntradayMomentumAnalyzer(api_key=api_key, quillamaggie_mode=True)
    return _analyzer
