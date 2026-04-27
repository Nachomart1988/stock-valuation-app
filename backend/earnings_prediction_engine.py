"""
Earnings Prediction Engine
==========================

Computes the probability that a stock will move UP after its earnings report,
under two scenarios: BEAT (beats estimates) and MISS (misses estimates).

The model is a transparent multi-factor scoring system that aggregates:
  - Quality factors (profitability, financial strength, moat)
  - Valuation factors (P/E vs sector, P/B, expected return)
  - Growth factors (SGR, revenue growth)
  - Historical reaction pattern (beat rate of last 8 quarters)
  - Sentiment factors (analyst recommendations, sector momentum)

Output:
  - beatScenario: { upProbability, expectedMagnitude, drivers[] }
  - missScenario: { upProbability, expectedMagnitude, drivers[] }
  - overallScore: 0-100 (combined post-earnings outlook)
  - factors: detailed breakdown
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional
import math


SECTOR_BASE_BEAT_REACTION = {
    'Technology':              {'up_on_beat': 0.62, 'up_on_miss': 0.32, 'magnitude_beat': 4.5, 'magnitude_miss': -6.0},
    'Communication Services':  {'up_on_beat': 0.58, 'up_on_miss': 0.30, 'magnitude_beat': 4.0, 'magnitude_miss': -7.0},
    'Healthcare':              {'up_on_beat': 0.55, 'up_on_miss': 0.38, 'magnitude_beat': 3.0, 'magnitude_miss': -4.5},
    'Financial Services':      {'up_on_beat': 0.60, 'up_on_miss': 0.40, 'magnitude_beat': 2.5, 'magnitude_miss': -3.5},
    'Consumer Cyclical':       {'up_on_beat': 0.57, 'up_on_miss': 0.32, 'magnitude_beat': 4.0, 'magnitude_miss': -6.5},
    'Consumer Defensive':      {'up_on_beat': 0.55, 'up_on_miss': 0.42, 'magnitude_beat': 2.0, 'magnitude_miss': -3.0},
    'Energy':                  {'up_on_beat': 0.55, 'up_on_miss': 0.40, 'magnitude_beat': 3.0, 'magnitude_miss': -4.0},
    'Industrials':             {'up_on_beat': 0.58, 'up_on_miss': 0.38, 'magnitude_beat': 3.0, 'magnitude_miss': -4.5},
    'Basic Materials':         {'up_on_beat': 0.55, 'up_on_miss': 0.40, 'magnitude_beat': 3.0, 'magnitude_miss': -4.0},
    'Real Estate':             {'up_on_beat': 0.52, 'up_on_miss': 0.42, 'magnitude_beat': 2.0, 'magnitude_miss': -3.0},
    'Utilities':               {'up_on_beat': 0.50, 'up_on_miss': 0.45, 'magnitude_beat': 1.5, 'magnitude_miss': -2.5},
}

DEFAULT_SECTOR = {'up_on_beat': 0.57, 'up_on_miss': 0.35, 'magnitude_beat': 3.5, 'magnitude_miss': -5.0}


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def compute_quality_factor(quality: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """Quality score: 0-100. Higher quality → better post-earnings reaction."""
    if not quality:
        return {'score': 50.0, 'normalized': 0.0, 'note': 'no_data'}

    raw = quality.get('overallScore') or quality.get('overall_score')
    if raw is None:
        scores = quality.get('dimensions') or {}
        if scores:
            try:
                vals = [float(v.get('score', 0)) if isinstance(v, dict) else float(v) for v in scores.values()]
                raw = sum(vals) / len(vals) if vals else 50.0
            except Exception:
                raw = 50.0
        else:
            raw = 50.0

    score = float(raw)
    normalized = (score - 50.0) / 25.0  # -2..+2
    return {'score': score, 'normalized': clamp(normalized, -2.0, 2.0), 'note': 'ok'}


def compute_valuation_factor(advance: Optional[Dict[str, Any]], current_price: Optional[float]) -> Dict[str, float]:
    """Valuation factor based on expected return from intrinsic value."""
    if not advance or not current_price or current_price <= 0:
        return {'expectedReturn': 0.0, 'normalized': 0.0, 'note': 'no_data'}

    iv = (
        advance.get('intrinsicValue')
        or advance.get('intrinsic_value')
        or advance.get('predictedValue')
    )
    if iv is None:
        return {'expectedReturn': 0.0, 'normalized': 0.0, 'note': 'no_iv'}

    try:
        iv_val = float(iv)
        expected_return = (iv_val - current_price) / current_price
    except Exception:
        return {'expectedReturn': 0.0, 'normalized': 0.0, 'note': 'parse_error'}

    # Cheap stocks (positive expected return) tend to react well to BEATS
    # Expensive stocks (negative expected return) tend to react harshly to MISSES
    normalized = clamp(expected_return * 2.0, -1.5, 1.5)
    return {'expectedReturn': expected_return, 'normalized': normalized, 'note': 'ok'}


def compute_growth_factor(sgr: Optional[float], ratios_ttm: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """Growth factor — high growth → bigger reaction (in either direction)."""
    growth_pct = 0.0
    if sgr is not None:
        try:
            growth_pct = float(sgr) * 100 if abs(float(sgr)) < 1 else float(sgr)
        except Exception:
            pass

    if growth_pct == 0.0 and ratios_ttm:
        try:
            growth_pct = float(ratios_ttm.get('netIncomeGrowth') or 0) * 100
        except Exception:
            pass

    # Growth premium: each 5% above 10% adds 0.1 to sensitivity
    sensitivity = clamp((growth_pct - 10.0) / 50.0, -0.5, 1.5)
    return {'growthRate': growth_pct, 'sensitivity': sensitivity}


def compute_historical_beat_factor(history: Optional[List[Dict[str, Any]]]) -> Dict[str, float]:
    """
    Compute beat rate over last 8 quarters.
    history: list of {epsActual, epsEstimated} (newer first)
    """
    if not history:
        return {'beatRate': 0.5, 'normalized': 0.0, 'sample': 0, 'note': 'no_history'}

    valid = [
        h for h in history[:8]
        if h.get('epsActual') is not None and h.get('epsEstimated') is not None
    ]
    if not valid:
        return {'beatRate': 0.5, 'normalized': 0.0, 'sample': 0, 'note': 'no_valid'}

    beats = sum(1 for h in valid if float(h['epsActual']) >= float(h['epsEstimated']))
    rate = beats / len(valid)
    # 0.5 is neutral; >0.75 is strong consistent beater
    normalized = (rate - 0.5) * 2.0  # -1..+1
    return {'beatRate': rate, 'normalized': normalized, 'sample': len(valid), 'note': 'ok'}


def compute_sentiment_factor(forecasts: Optional[List[Dict[str, Any]]], news: Optional[List[Dict[str, Any]]]) -> Dict[str, float]:
    """Aggregate analyst sentiment + news sentiment."""
    score = 0.0

    if forecasts and len(forecasts) > 0:
        # Use revenue growth implied by forecasts
        try:
            growths = []
            sorted_f = sorted(forecasts, key=lambda x: x.get('date', ''))
            for i in range(1, min(len(sorted_f), 5)):
                prev = float(sorted_f[i-1].get('revenueAvg') or sorted_f[i-1].get('estimatedRevenueAvg') or 0)
                curr = float(sorted_f[i].get('revenueAvg') or sorted_f[i].get('estimatedRevenueAvg') or 0)
                if prev > 0:
                    growths.append((curr - prev) / prev)
            avg_growth = sum(growths) / len(growths) if growths else 0
            score += clamp(avg_growth * 5.0, -0.5, 0.5)
        except Exception:
            pass

    if news and len(news) > 0:
        # Heuristic news sentiment from titles
        positive_keywords = ['beat', 'surge', 'outperform', 'upgrade', 'record', 'strong', 'growth', 'raise']
        negative_keywords = ['miss', 'downgrade', 'cut', 'plunge', 'weak', 'decline', 'lawsuit', 'fraud']
        pos = neg = 0
        for n in news[:20]:
            title = (n.get('title') or '').lower()
            pos += sum(1 for k in positive_keywords if k in title)
            neg += sum(1 for k in negative_keywords if k in title)
        if pos + neg > 0:
            score += clamp((pos - neg) / (pos + neg) * 0.3, -0.3, 0.3)

    return {'normalized': clamp(score, -0.8, 0.8)}


def compute_volatility_factor(probability_data: Optional[Dict[str, Any]], current_price: Optional[float]) -> Dict[str, float]:
    """Use implied volatility or historical vol to scale magnitude."""
    if not probability_data:
        return {'sigma': 0.30, 'multiplier': 1.0}
    try:
        sigma = float(probability_data.get('volatility') or probability_data.get('sigma') or 0.30)
        # Higher vol → bigger magnitude both ways
        multiplier = clamp(sigma / 0.30, 0.6, 2.5)
        return {'sigma': sigma, 'multiplier': multiplier}
    except Exception:
        return {'sigma': 0.30, 'multiplier': 1.0}


def predict_earnings_outcome(
    ticker: str,
    profile: Optional[Dict[str, Any]] = None,
    quality: Optional[Dict[str, Any]] = None,
    advance: Optional[Dict[str, Any]] = None,
    sgr: Optional[float] = None,
    ratios_ttm: Optional[Dict[str, Any]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    forecasts: Optional[List[Dict[str, Any]]] = None,
    news: Optional[List[Dict[str, Any]]] = None,
    probability_data: Optional[Dict[str, Any]] = None,
    current_price: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Run the multi-factor earnings prediction.

    Returns:
      {
        ticker, sector,
        beatScenario:  { upProbability, expectedMagnitude, drivers[] },
        missScenario:  { upProbability, expectedMagnitude, drivers[] },
        overallScore: 0-100,
        factors: { quality, valuation, growth, history, sentiment, volatility },
        consensus: 'BULLISH'|'NEUTRAL'|'BEARISH',
        commentary: str,
      }
    """
    sector = (profile or {}).get('sector') or 'Technology'
    base = SECTOR_BASE_BEAT_REACTION.get(sector, DEFAULT_SECTOR)

    # Compute factors
    f_quality = compute_quality_factor(quality)
    f_value = compute_valuation_factor(advance, current_price)
    f_growth = compute_growth_factor(sgr, ratios_ttm)
    f_history = compute_historical_beat_factor(history)
    f_sentiment = compute_sentiment_factor(forecasts, news)
    f_vol = compute_volatility_factor(probability_data, current_price)

    # ─── BEAT scenario ─────────────────────────────────────────
    # Up-probability adjustment (additive, in probability points)
    beat_up_adj = (
        f_quality['normalized'] * 0.04        # quality: ±8 pp
        + f_value['normalized'] * 0.05        # valuation: ±7.5 pp (cheap → bigger pop)
        + f_history['normalized'] * 0.06      # consistent beater → +6 pp
        + f_sentiment['normalized'] * 0.05    # sentiment: ±4 pp
    )
    beat_up_prob = clamp(base['up_on_beat'] + beat_up_adj, 0.20, 0.92)

    # Magnitude adjustment (multiplicative)
    beat_magnitude = (
        base['magnitude_beat']
        * (1 + f_growth['sensitivity'] * 0.4)
        * f_vol['multiplier']
        * (1 + max(0, f_value['normalized']) * 0.3)
    )

    # ─── MISS scenario ─────────────────────────────────────────
    miss_up_adj = (
        f_quality['normalized'] * 0.05        # quality: forgiveness on misses
        + f_value['normalized'] * (-0.04)     # already cheap → less downside
        + f_history['normalized'] * 0.03
        + f_sentiment['normalized'] * 0.03
    )
    miss_up_prob = clamp(base['up_on_miss'] + miss_up_adj, 0.08, 0.65)

    miss_magnitude = (
        base['magnitude_miss']
        * (1 + f_growth['sensitivity'] * 0.5)
        * f_vol['multiplier']
        * (1 - min(0, f_quality['normalized']) * 0.2)
    )

    # Overall combined score (0-100)
    # Probability of beating × beat_up_prob + (1-prob_beat) × miss_up_prob
    prob_beat_estimate = clamp(0.55 + f_history['normalized'] * 0.15 + f_quality['normalized'] * 0.05, 0.25, 0.85)
    expected_up_prob = prob_beat_estimate * beat_up_prob + (1 - prob_beat_estimate) * miss_up_prob
    overall_score = round(expected_up_prob * 100)

    if overall_score >= 65:
        consensus = 'BULLISH'
    elif overall_score >= 50:
        consensus = 'CAUTIOUS_BULLISH'
    elif overall_score >= 40:
        consensus = 'NEUTRAL'
    elif overall_score >= 30:
        consensus = 'CAUTIOUS_BEARISH'
    else:
        consensus = 'BEARISH'

    # Drivers for each scenario
    def build_drivers(scenario: str) -> List[Dict[str, Any]]:
        drivers = []
        if f_quality['note'] != 'no_data':
            sign = '+' if f_quality['normalized'] > 0 else ('=' if abs(f_quality['normalized']) < 0.2 else '-')
            drivers.append({
                'factor': 'Quality',
                'value': round(f_quality['score'], 1),
                'impact': sign,
                'description': f"Quality score {round(f_quality['score'])}/100 — " +
                    ('strong fundamentals support price defense' if f_quality['normalized'] > 0.5
                     else 'average fundamentals' if abs(f_quality['normalized']) < 0.5
                     else 'weak fundamentals add downside risk')
            })
        if f_value['note'] == 'ok':
            er_pct = f_value['expectedReturn'] * 100
            sign = '+' if (er_pct > 5 if scenario == 'beat' else er_pct < -5) else '='
            drivers.append({
                'factor': 'Valuation',
                'value': f"{er_pct:+.1f}%",
                'impact': '+' if er_pct > 5 else ('-' if er_pct < -10 else '='),
                'description': f"{'Undervalued by' if er_pct > 0 else 'Overvalued by'} {abs(er_pct):.1f}% vs intrinsic value"
            })
        if f_history['note'] == 'ok':
            drivers.append({
                'factor': 'Track Record',
                'value': f"{round(f_history['beatRate']*100)}% beat rate",
                'impact': '+' if f_history['normalized'] > 0.25 else ('-' if f_history['normalized'] < -0.25 else '='),
                'description': f"Beat estimates in {int(f_history['beatRate'] * f_history['sample'])}/{f_history['sample']} of last quarters"
            })
        drivers.append({
            'factor': 'Growth',
            'value': f"{f_growth['growthRate']:.1f}%",
            'impact': '+' if f_growth['sensitivity'] > 0.3 else ('=' if f_growth['sensitivity'] > -0.1 else '-'),
            'description': f"{'High' if f_growth['sensitivity'] > 0.3 else 'Moderate' if f_growth['sensitivity'] > -0.1 else 'Low'} growth rate amplifies reaction"
        })
        if abs(f_sentiment['normalized']) > 0.1:
            drivers.append({
                'factor': 'Sentiment',
                'value': 'positive' if f_sentiment['normalized'] > 0 else 'negative',
                'impact': '+' if f_sentiment['normalized'] > 0 else '-',
                'description': 'Analyst forecasts and news flow ' + ('lean positive' if f_sentiment['normalized'] > 0 else 'lean negative')
            })
        return drivers

    # Commentary
    commentary_parts = [
        f"{ticker} ({sector}): expected post-earnings outcome is {consensus.replace('_', ' ').lower()} ({overall_score}/100).",
    ]
    if f_quality['note'] != 'no_data' and f_quality['score'] > 70:
        commentary_parts.append(f"High quality score ({round(f_quality['score'])}) provides downside protection.")
    if f_history['note'] == 'ok' and f_history['beatRate'] > 0.7:
        commentary_parts.append(f"Strong historical beat pattern ({round(f_history['beatRate']*100)}%) suggests continued execution.")
    if f_value['note'] == 'ok' and f_value['expectedReturn'] > 0.15:
        commentary_parts.append(f"Stock trades {round(f_value['expectedReturn']*100)}% below intrinsic value — beat would unlock significant upside.")
    elif f_value['note'] == 'ok' and f_value['expectedReturn'] < -0.15:
        commentary_parts.append(f"Trading {round(abs(f_value['expectedReturn'])*100)}% above intrinsic value — miss likely punished severely.")

    return {
        'ticker': ticker,
        'sector': sector,
        'beatScenario': {
            'upProbability': round(beat_up_prob * 100, 1),
            'expectedMagnitude': round(beat_magnitude, 2),
            'drivers': build_drivers('beat'),
        },
        'missScenario': {
            'upProbability': round(miss_up_prob * 100, 1),
            'expectedMagnitude': round(miss_magnitude, 2),
            'drivers': build_drivers('miss'),
        },
        'probBeatEstimate': round(prob_beat_estimate * 100, 1),
        'overallScore': overall_score,
        'consensus': consensus,
        'factors': {
            'quality': f_quality,
            'valuation': f_value,
            'growth': f_growth,
            'history': f_history,
            'sentiment': f_sentiment,
            'volatility': f_vol,
        },
        'commentary': ' '.join(commentary_parts),
    }
