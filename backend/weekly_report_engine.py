"""
Weekly Market Report Engine — "Informe" (GOD MODE)
==================================================

Generates an institutional-grade weekly market report (FactSet / Morningstar style)
for a **past** Monday–Friday week chosen by the user.

Architecture (three stages, mirroring the async job pattern of the backtest engines):

  1. COLLECT  — parallel FMP fetch: index/sector/flow/FX/commodity daily bars,
                the full S&P 500 constituent list with per-symbol weekly bars,
                the earnings calendar for the week (+ quotes to rank by size),
                and the week's general news flow.
  2. ANALYZE  — a *council* of specialist analyst networks, each producing a
                bounded score (-100..+100), confidence and structured facts:
                  market · sector rotation · breadth · leaders/laggards ·
                  earnings · macro/FX · flows (institutional vs retail) · news.
                Reuses the NLP sentiment analyzer from market_sentiment_engine
                (cross-backend analysis) when available.
  3. SYNTHESIZE + COMPOSE — a cross-signal layer compares the analysts against
                each other (consensus, dispersion, canonical divergences such as
                narrow leadership or sell-the-news), classifies the weekly regime
                and ranks the week's dominant drivers; the composer then writes
                the full bilingual (es/en) narrative report.

Exposed via POST /report/weekly/start and GET /report/weekly/status/{job_id}.
GOD MODE only (gated in the frontend /informe page).

Documented limitations (also surfaced in the UI):
  - Sector performance uses SPDR Select Sector ETFs as proxies.
  - S&P 500 membership is point-in-time (current constituents applied to a past
    week) -> minor survivorship bias for old weeks.
  - Earnings reaction uses daily closes; when the report time (BMO/AMC) is
    unknown, the larger of same-day / next-day move is reported.
  - News coverage degrades for weeks far in the past (FMP pagination limits).
"""

from __future__ import annotations

import logging
import os
import statistics
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# ── Cross-backend reuse: NLP news sentiment from the market sentiment engine ──
try:
    from market_sentiment_engine import AdvancedNewsSentimentAnalyzer
    _NEWS_NLP_AVAILABLE = True
except Exception:  # noqa: BLE001 — any import failure falls back to lexicon-lite
    AdvancedNewsSentimentAnalyzer = None
    _NEWS_NLP_AVAILABLE = False


# ═══════════════════════════════════════════════════════════════════════════
#  Job registry (in-process; same pattern as gap_short_backtest_engine)
# ═══════════════════════════════════════════════════════════════════════════
_JOBS: Dict[str, Dict[str, Any]] = {}
_JOBS_LOCK = threading.Lock()
_JOB_TTL_SECONDS = 60 * 60

# Finished reports cached per (week_start, language) so re-opening is instant.
_REPORT_CACHE: Dict[Tuple[str, str], Dict[str, Any]] = {}
_REPORT_CACHE_LOCK = threading.Lock()


def _set_job(job_id: str, **fields: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id, {})
        job.update(fields)
        _JOBS[job_id] = job


def _prune_jobs() -> None:
    now = time.time()
    with _JOBS_LOCK:
        stale = [jid for jid, j in _JOBS.items()
                 if now - j.get("created_at", now) > _JOB_TTL_SECONDS]
        for jid in stale:
            _JOBS.pop(jid, None)


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is None:
            return None
        snap = {
            "job_id": job_id,
            "status": job.get("status"),
            "progress": job.get("progress", 0),
            "stage": job.get("stage", ""),
            "error": job.get("error"),
        }
        if job.get("status") == "done":
            snap["result"] = job.get("result")
        return snap


# ═══════════════════════════════════════════════════════════════════════════
#  Static universes
# ═══════════════════════════════════════════════════════════════════════════

INDICES = [
    ("^GSPC", "SPY", {"es": "S&P 500", "en": "S&P 500"}),
    ("^IXIC", "QQQ", {"es": "Nasdaq Composite", "en": "Nasdaq Composite"}),
    ("^DJI",  "DIA", {"es": "Dow Jones Industrial", "en": "Dow Jones Industrial"}),
    ("^RUT",  "IWM", {"es": "Russell 2000", "en": "Russell 2000"}),
]

SECTOR_ETFS = [
    ("XLK",  {"es": "Tecnología",             "en": "Technology"}),
    ("XLF",  {"es": "Financieros",            "en": "Financials"}),
    ("XLE",  {"es": "Energía",                "en": "Energy"}),
    ("XLV",  {"es": "Salud",                  "en": "Health Care"}),
    ("XLY",  {"es": "Consumo discrecional",   "en": "Consumer Discretionary"}),
    ("XLP",  {"es": "Consumo básico",         "en": "Consumer Staples"}),
    ("XLI",  {"es": "Industriales",           "en": "Industrials"}),
    ("XLB",  {"es": "Materiales",             "en": "Materials"}),
    ("XLU",  {"es": "Servicios públicos",     "en": "Utilities"}),
    ("XLRE", {"es": "Inmobiliario",           "en": "Real Estate"}),
    ("XLC",  {"es": "Comunicaciones",         "en": "Communication Services"}),
]
CYCLICAL_ETFS = ("XLY", "XLF", "XLI", "XLB")
DEFENSIVE_ETFS = ("XLP", "XLU", "XLV")

FLOW_PROXIES = [
    ("SPY",  {"es": "S&P 500 (cap-ponderado)", "en": "S&P 500 (cap-weighted)"}),
    ("RSP",  {"es": "S&P 500 equiponderado",   "en": "S&P 500 equal-weight"}),
    ("IWM",  {"es": "Small caps (Russell 2000)", "en": "Small caps (Russell 2000)"}),
    ("SPHB", {"es": "Alta beta",               "en": "High beta"}),
    ("SPLV", {"es": "Baja volatilidad",        "en": "Low volatility"}),
    ("ARKK", {"es": "Growth especulativo (ARKK)", "en": "Speculative growth (ARKK)"}),
    ("HYG",  {"es": "Crédito high yield",      "en": "High-yield credit"}),
    ("TLT",  {"es": "Bonos del Tesoro 20+ años", "en": "20+ yr Treasuries"}),
]

# vs-USD sign: +1 means a rising quote implies a STRONGER dollar (USD is base).
FX_PAIRS = [
    ("EURUSD", {"es": "Euro",             "en": "Euro"},              -1),
    ("GBPUSD", {"es": "Libra esterlina",  "en": "British pound"},     -1),
    ("USDJPY", {"es": "Yen japonés",      "en": "Japanese yen"},      +1),
    ("USDCHF", {"es": "Franco suizo",     "en": "Swiss franc"},       +1),
    ("AUDUSD", {"es": "Dólar australiano", "en": "Australian dollar"}, -1),
    ("USDCAD", {"es": "Dólar canadiense", "en": "Canadian dollar"},   +1),
    ("USDCNY", {"es": "Yuan chino",       "en": "Chinese yuan"},      +1),
    ("USDMXN", {"es": "Peso mexicano",    "en": "Mexican peso"},      +1),
    ("USDBRL", {"es": "Real brasileño",   "en": "Brazilian real"},    +1),
]

MACRO_ASSETS = [
    ("GCUSD",  {"es": "Oro",              "en": "Gold"}),
    ("CLUSD",  {"es": "Petróleo WTI",     "en": "WTI crude oil"}),
    ("BTCUSD", {"es": "Bitcoin",          "en": "Bitcoin"}),
    ("^VIX",   {"es": "VIX (volatilidad)", "en": "VIX (volatility)"}),
    ("^TNX",   {"es": "Tasa 10 años EE.UU.", "en": "US 10-yr yield"}),
]

NEWS_THEMES = {
    "fed_rates":   {"es": "Fed y tasas de interés", "en": "Fed & interest rates",
                    "kw": ["fed", "federal reserve", "rate cut", "rate hike", "powell",
                           "interest rate", "fomc", "monetary policy", "dovish", "hawkish"]},
    "inflation":   {"es": "Inflación", "en": "Inflation",
                    "kw": ["inflation", "cpi", "pce", "price pressures", "disinflation"]},
    "trade":       {"es": "Comercio y aranceles", "en": "Trade & tariffs",
                    "kw": ["tariff", "trade war", "trade deal", "import", "export ban", "sanction"]},
    "ai_tech":     {"es": "Inteligencia artificial y tecnología", "en": "AI & technology",
                    "kw": ["artificial intelligence", " ai ", "chip", "semiconductor", "nvidia",
                           "data center", "cloud", "openai"]},
    "earnings":    {"es": "Resultados corporativos", "en": "Corporate earnings",
                    "kw": ["earnings", "quarterly results", "guidance", "revenue beat",
                           "profit", "eps"]},
    "energy":      {"es": "Energía y petróleo", "en": "Energy & oil",
                    "kw": ["oil", "crude", "opec", "natural gas", "energy prices", "barrel"]},
    "geopolitics": {"es": "Geopolítica", "en": "Geopolitics",
                    "kw": ["war", "ukraine", "middle east", "israel", "iran", "russia",
                           "military", "conflict", "geopolitic"]},
    "china":       {"es": "China", "en": "China",
                    "kw": ["china", "chinese", "beijing", "yuan"]},
    "economy":     {"es": "Economía y empleo", "en": "Economy & jobs",
                    "kw": ["jobs report", "payrolls", "unemployment", "gdp", "recession",
                           "consumer confidence", "retail sales", "ism", "pmi"]},
    "crypto":      {"es": "Criptomonedas", "en": "Crypto",
                    "kw": ["bitcoin", "crypto", "ethereum", "stablecoin"]},
    "ma_deals":    {"es": "Fusiones y adquisiciones", "en": "M&A / deals",
                    "kw": ["acquisition", "merger", "takeover", "buyout", "ipo"]},
}

_ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
              "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
_ES_WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_EN_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ═══════════════════════════════════════════════════════════════════════════
#  Formatting helpers
# ═══════════════════════════════════════════════════════════════════════════

def _clamp(x: float, lo: float = -100.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def _pct(x: Optional[float], decimals: int = 1) -> str:
    """Signed percentage: +1.4% / -0.8%."""
    if x is None:
        return "n/d"
    return f"{x:+.{decimals}f}%"


def _pctu(x: Optional[float], decimals: int = 1) -> str:
    """Unsigned percentage."""
    if x is None:
        return "n/d"
    return f"{x:.{decimals}f}%"


def _fmt_mktcap(v: Optional[float]) -> str:
    if not v:
        return "—"
    if v >= 1e12:
        return f"${v / 1e12:.2f}T"
    if v >= 1e9:
        return f"${v / 1e9:.1f}B"
    return f"${v / 1e6:.0f}M"


def _d(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _weekday_name(date_str: str, lang: str) -> str:
    wd = _d(date_str).weekday()
    return _ES_WEEKDAYS[wd] if lang == "es" else _EN_WEEKDAYS[wd]


def _week_label(ws: str, we: str, lang: str) -> str:
    a, b = _d(ws), _d(we)
    if lang == "es":
        if a.month == b.month:
            return (f"Semana del lunes {a.day} al viernes {b.day} "
                    f"de {_ES_MONTHS[b.month - 1]} de {b.year}")
        return (f"Semana del lunes {a.day} de {_ES_MONTHS[a.month - 1]} "
                f"al viernes {b.day} de {_ES_MONTHS[b.month - 1]} de {b.year}")
    return (f"Week of Monday, {a.strftime('%B %d')} – Friday, {b.strftime('%B %d, %Y')}")


def _direction_word(ret: float, lang: str) -> str:
    if lang == "es":
        if ret >= 2.0:
            return "avanzó con fuerza"
        if ret >= 0.5:
            return "avanzó"
        if ret > -0.5:
            return "cerró prácticamente sin cambios"
        if ret > -2.0:
            return "retrocedió"
        return "cayó con fuerza"
    if ret >= 2.0:
        return "rallied sharply"
    if ret >= 0.5:
        return "advanced"
    if ret > -0.5:
        return "finished little changed"
    if ret > -2.0:
        return "pulled back"
    return "sold off sharply"


# ═══════════════════════════════════════════════════════════════════════════
#  Lexicon-lite fallback (used only if market_sentiment_engine is unavailable)
# ═══════════════════════════════════════════════════════════════════════════
class _LiteSentiment:
    POS = ("rally", "surge", "beat", "record", "gain", "strong", "growth", "upgrade",
           "optimism", "recovery", "rate cut", "soft landing", "high")
    NEG = ("crash", "plunge", "miss", "recession", "selloff", "fear", "downgrade",
           "layoff", "tariff", "war", "crisis", "default", "bankruptcy", "low")

    def analyze_text(self, text: str) -> Dict[str, Any]:
        t = (text or "").lower()
        score = sum(1.0 for w in self.POS if w in t) - sum(1.0 for w in self.NEG if w in t)
        return {"score": score, "normalized": _clamp(score / 3.0, -1.0, 1.0)}


# ═══════════════════════════════════════════════════════════════════════════
#  Engine
# ═══════════════════════════════════════════════════════════════════════════
class WeeklyReportEngine:
    FMP_BASE = "https://financialmodelingprep.com/stable"
    MAX_WORKERS = 16

    def __init__(self, api_key: Optional[str] = None) -> None:
        self.version = "1.0"
        self.api_key = api_key or os.environ.get("FMP_API_KEY", "")
        self._session = requests.Session()
        self._nlp = (AdvancedNewsSentimentAnalyzer() if _NEWS_NLP_AVAILABLE
                     else _LiteSentiment())

    # ── FMP fetch with light retry/backoff ──────────────────────────────────
    def _fetch_json(self, endpoint: str, params: Optional[Dict] = None,
                    retries: int = 3) -> Any:
        params = dict(params or {})
        params["apikey"] = self.api_key
        url = f"{self.FMP_BASE}/{endpoint}"
        for attempt in range(retries):
            try:
                r = self._session.get(url, params=params, timeout=25)
                if r.status_code == 429:
                    time.sleep(1.2 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.json()
            except Exception as e:  # noqa: BLE001
                if attempt == retries - 1:
                    logger.warning("[WeeklyReport] fetch failed %s: %s", endpoint, e)
                    return None
                time.sleep(0.5 * (attempt + 1))
        return None

    def _daily_bars(self, symbol: str, date_from: str, date_to: str) -> List[Dict]:
        data = self._fetch_json("historical-price-eod/full",
                                {"symbol": symbol, "from": date_from, "to": date_to})
        hist = data.get("historical", []) if isinstance(data, dict) else data
        if not isinstance(hist, list):
            return []
        return sorted(hist, key=lambda b: b.get("date", ""))

    @staticmethod
    def _corporate_action_gap(bars: List[Dict], ws: str, we: str) -> bool:
        """True if an in-week overnight gap looks like an unadjusted corporate
        action (spin-off / split): the next OPEN lands far from the prior close
        before any trading happens. FMP's stable EOD series is not always
        back-adjusted for spin-offs (e.g. HON June 2026: close 464 → open 241)."""
        prev_close: Optional[float] = None
        for b in bars:
            d = b.get("date", "")
            if d > we:
                break
            o, c = b.get("open"), b.get("close")
            if ws <= d and prev_close and o:
                ratio = o / prev_close
                if ratio < 0.67 or ratio > 1.6:
                    return True
            if c:
                prev_close = c
        return False

    @staticmethod
    def _perf(bars: List[Dict], ws: str, we: str) -> Optional[Dict[str, Any]]:
        """Weekly performance vs the prior session's close (usually prior Friday)."""
        in_week = [b for b in bars if ws <= b.get("date", "") <= we]
        before = [b for b in bars if b.get("date", "") < ws]
        if not in_week or not before:
            return None
        base = before[-1].get("close")
        last = in_week[-1].get("close")
        if not base or last is None:
            return None
        daily = []
        prev = base
        for b in in_week:
            c = b.get("close")
            if c is None:
                continue
            daily.append({"date": b["date"], "close": round(float(c), 4),
                          "chg_pct": round((c / prev - 1) * 100, 3) if prev else 0.0})
            prev = c
        return {
            "ret_pct": round((last / base - 1) * 100, 3),
            "base_close": round(float(base), 4),
            "last_close": round(float(last), 4),
            "daily": daily,
            "avg_volume": (sum(b.get("volume", 0) or 0 for b in in_week) / len(in_week))
                          if in_week else 0,
        }

    # ═══════════════════════════════════════════════════════════════════════
    #  Stage 1 — COLLECT
    # ═══════════════════════════════════════════════════════════════════════
    def collect(self, ws: str, we: str, lang: str,
                progress: Callable[[int, str], None]) -> Dict[str, Any]:
        es = lang == "es"
        d_from = (_d(ws) - timedelta(days=12)).isoformat()
        d_to = (_d(we) + timedelta(days=5)).isoformat()
        raw: Dict[str, Any] = {"warnings": []}

        # --- light universe: indices, sectors, flows, fx, macro (parallel) ---
        progress(4, "Descargando índices, sectores y divisas" if es
                 else "Fetching indices, sectors and currencies")
        light: List[Tuple[str, str]] = []          # (group, symbol)
        light += [("index", sym) for sym, _fb, _l in INDICES]
        light += [("index_fb", fb) for _s, fb, _l in INDICES]
        light += [("sector", s) for s, _l in SECTOR_ETFS]
        light += [("flow", s) for s, _l in FLOW_PROXIES]
        light += [("fx", s) for s, _l, _sign in FX_PAIRS]
        light += [("macro", s) for s, _l in MACRO_ASSETS]
        bars_map: Dict[str, List[Dict]] = {}
        # SPY needs a longer window for the volume baseline of the flows analyst
        spy_from = (_d(ws) - timedelta(days=45)).isoformat()

        def _fetch_light(sym: str) -> Tuple[str, List[Dict]]:
            f = spy_from if sym == "SPY" else d_from
            return sym, self._daily_bars(sym, f, we)

        symbols = sorted({s for _g, s in light})
        with ThreadPoolExecutor(max_workers=self.MAX_WORKERS) as pool:
            futs = {pool.submit(_fetch_light, s): s for s in symbols}
            for fut in as_completed(futs):
                sym, bars = fut.result()
                bars_map[sym] = bars
        raw["bars"] = bars_map

        # --- S&P 500 constituents + weekly bars (the heavy part) -------------
        progress(12, "Descargando integrantes del S&P 500" if es
                 else "Fetching S&P 500 constituents")
        cons = self._fetch_json("sp500-constituent") or []
        constituents = [
            {"symbol": c.get("symbol"), "name": c.get("name"),
             "sector": c.get("sector") or "—"}
            for c in cons if isinstance(c, dict) and c.get("symbol")
        ]
        raw["constituents"] = constituents
        if not constituents:
            raw["warnings"].append(
                "No se pudo obtener la lista de integrantes del S&P 500" if es
                else "Could not fetch the S&P 500 constituent list")

        member_perf: Dict[str, Dict[str, Any]] = {}
        member_bars: Dict[str, List[Dict]] = {}
        suspect_actions: List[str] = []
        total = len(constituents)
        done = 0
        done_lock = threading.Lock()

        def _fetch_member(sym: str) -> Tuple[str, List[Dict]]:
            return sym, self._daily_bars(sym, d_from, d_to)

        if constituents:
            with ThreadPoolExecutor(max_workers=self.MAX_WORKERS) as pool:
                futs = {pool.submit(_fetch_member, c["symbol"]): c["symbol"]
                        for c in constituents}
                for fut in as_completed(futs):
                    sym, bars = fut.result()
                    with done_lock:
                        done += 1
                        n = done
                    if bars:
                        member_bars[sym] = bars
                        if self._corporate_action_gap(bars, ws, we):
                            suspect_actions.append(sym)
                        else:
                            p = self._perf(bars, ws, we)
                            if p:
                                member_perf[sym] = p
                    if n % 40 == 0 or n == total:
                        pct = 14 + int(44 * n / max(total, 1))
                        progress(pct, (f"Analizando S&P 500: {n}/{total} empresas" if es
                                       else f"Scanning S&P 500: {n}/{total} companies"))
        raw["member_perf"] = member_perf
        raw["member_bars"] = member_bars
        if suspect_actions:
            listed = ", ".join(sorted(suspect_actions))
            raw["warnings"].append(
                (f"Excluidos de amplitud y movers por posible acción corporativa sin "
                 f"ajustar (split/spin-off): {listed}") if es else
                (f"Excluded from breadth and movers due to a likely unadjusted "
                 f"corporate action (split/spin-off): {listed}"))

        # --- Earnings calendar + size ranking --------------------------------
        progress(60, "Procesando calendario de earnings" if es
                 else "Processing the earnings calendar")
        cal = self._fetch_json("earnings-calendar", {"from": ws, "to": we}) or []
        cal = [e for e in cal if isinstance(e, dict) and e.get("symbol")]
        raw["earnings_all"] = cal
        member_set = {c["symbol"] for c in constituents}
        sp_reporters = [e for e in cal if e["symbol"] in member_set]
        quotes: Dict[str, Dict] = {}
        rep_syms = sorted({e["symbol"] for e in sp_reporters})[:120]

        def _fetch_quote(sym: str) -> Tuple[str, Optional[Dict]]:
            q = self._fetch_json("quote", {"symbol": sym})
            if isinstance(q, list) and q:
                return sym, q[0]
            return sym, None

        if rep_syms:
            with ThreadPoolExecutor(max_workers=self.MAX_WORKERS) as pool:
                futs = {pool.submit(_fetch_quote, s): s for s in rep_syms}
                for fut in as_completed(futs):
                    sym, q = fut.result()
                    if q:
                        quotes[sym] = q
        raw["earnings_sp"] = sp_reporters
        raw["quotes"] = quotes

        # --- News flow --------------------------------------------------------
        progress(68, "Recopilando el flujo de noticias de la semana" if es
                 else "Collecting the week's news flow")
        news: List[Dict] = []
        seen_titles = set()
        for page in range(8):
            batch = self._fetch_json("news/general-latest",
                                     {"from": ws, "to": we, "page": page, "limit": 100})
            if not isinstance(batch, list) or not batch:
                break
            stop = False
            for n in batch:
                pd = (n.get("publishedDate") or "")[:10]
                title = (n.get("title") or "").strip()
                if not title or title.lower() in seen_titles:
                    continue
                if pd and pd < ws:
                    stop = True
                    continue
                if ws <= pd <= we:
                    seen_titles.add(title.lower())
                    news.append(n)
            if stop or len(batch) < 100:
                break
        raw["news"] = news
        if not news:
            raw["warnings"].append(
                "Cobertura de noticias limitada para esta semana (histórico FMP)" if es
                else "Limited news coverage for this week (FMP history)")
        return raw

    # ═══════════════════════════════════════════════════════════════════════
    #  Stage 2 — ANALYZE (the analyst council)
    # ═══════════════════════════════════════════════════════════════════════
    def analyze(self, raw: Dict[str, Any], ws: str, we: str) -> Dict[str, Any]:
        bars = raw["bars"]
        F: Dict[str, Any] = {}

        # ── Market analyst: indices + VIX ────────────────────────────────────
        indices = []
        for sym, fb, labels in INDICES:
            p = self._perf(bars.get(sym, []), ws, we) or self._perf(bars.get(fb, []), ws, we)
            if p:
                indices.append({"symbol": sym, "labels": labels, **p})
        spx = next((i for i in indices if i["symbol"] == "^GSPC"), None)
        vix_p = self._perf(bars.get("^VIX", []), ws, we)
        vix = ({"level": vix_p["last_close"], "chg_pct": vix_p["ret_pct"]}
               if vix_p else None)
        spx_ret = spx["ret_pct"] if spx else (indices[0]["ret_pct"] if indices else 0.0)
        market_score = _clamp(spx_ret * 18)
        if vix and vix["chg_pct"] > 12:
            market_score -= 15
        elif vix and vix["chg_pct"] < -12:
            market_score += 8
        best_day = worst_day = None
        if spx and spx["daily"]:
            best_day = max(spx["daily"], key=lambda d: d["chg_pct"])
            worst_day = min(spx["daily"], key=lambda d: d["chg_pct"])
        F["market"] = {"indices": indices, "spx_ret": spx_ret, "vix": vix,
                       "best_day": best_day, "worst_day": worst_day,
                       "trading_days": len(spx["daily"]) if spx else 0,
                       "score": round(market_score, 1),
                       "confidence": 0.9 if spx else 0.4}

        # ── Sector rotation analyst ──────────────────────────────────────────
        sectors = []
        for etf, labels in SECTOR_ETFS:
            p = self._perf(bars.get(etf, []), ws, we)
            if p:
                sectors.append({"etf": etf, "labels": labels, "ret_pct": p["ret_pct"]})
        sectors.sort(key=lambda s: s["ret_pct"], reverse=True)
        cyc = [s["ret_pct"] for s in sectors if s["etf"] in CYCLICAL_ETFS]
        dfs = [s["ret_pct"] for s in sectors if s["etf"] in DEFENSIVE_ETFS]
        spread = (statistics.mean(cyc) - statistics.mean(dfs)) if cyc and dfs else 0.0
        pos_sectors = sum(1 for s in sectors if s["ret_pct"] > 0)
        F["sectors"] = {"table": sectors, "cyc_def_spread": round(spread, 2),
                        "positive": pos_sectors, "total": len(sectors),
                        "score": round(_clamp(spread * 28), 1),
                        "confidence": 0.85 if len(sectors) >= 9 else 0.5}

        # ── Breadth analyst (real S&P 500 constituents) ──────────────────────
        mp = raw["member_perf"]
        rets = [p["ret_pct"] for p in mp.values()]
        cons_by_sym = {c["symbol"]: c for c in raw["constituents"]}
        breadth: Dict[str, Any] = {"total": len(rets)}
        if rets:
            adv = sum(1 for r in rets if r > 0.15)
            dec = sum(1 for r in rets if r < -0.15)
            flat = len(rets) - adv - dec
            avg = statistics.mean(rets)
            med = statistics.median(rets)
            buckets = [
                ("< -5%",     sum(1 for r in rets if r < -5)),
                ("-5% a -2%", sum(1 for r in rets if -5 <= r < -2)),
                ("-2% a 0%",  sum(1 for r in rets if -2 <= r < 0)),
                ("0% a +2%",  sum(1 for r in rets if 0 <= r < 2)),
                ("+2% a +5%", sum(1 for r in rets if 2 <= r < 5)),
                ("> +5%",     sum(1 for r in rets if r >= 5)),
            ]
            pct_up = 100 * adv / len(rets)
            breadth.update({
                "advancers": adv, "decliners": dec, "flat": flat,
                "pct_up": round(pct_up, 1), "avg_ret": round(avg, 2),
                "median_ret": round(med, 2), "index_ret": round(spx_ret, 2),
                "concentration_gap": round(spx_ret - avg, 2),
                "buckets": [{"label": b, "count": c} for b, c in buckets],
                "pct_beat_index": round(100 * sum(1 for r in rets if r > spx_ret)
                                        / len(rets), 1),
            })
            breadth["score"] = round(_clamp((pct_up - 50) * 2.4), 1)
            breadth["confidence"] = min(0.95, len(rets) / 450)
        else:
            breadth.update({"score": 0.0, "confidence": 0.1})
        F["breadth"] = breadth

        # ── Leaders / laggards analyst ───────────────────────────────────────
        ranked = sorted(mp.items(), key=lambda kv: kv[1]["ret_pct"], reverse=True)

        def _mover(sym: str, p: Dict) -> Dict:
            c = cons_by_sym.get(sym, {})
            return {"symbol": sym, "name": c.get("name") or sym,
                    "sector": c.get("sector") or "—", "ret_pct": p["ret_pct"]}
        winners = [_mover(s, p) for s, p in ranked[:10]]
        losers = [_mover(s, p) for s, p in ranked[-10:]][::-1]

        def _top_sectors(movers: List[Dict]) -> List[str]:
            counts: Dict[str, int] = {}
            for m in movers:
                counts[m["sector"]] = counts.get(m["sector"], 0) + 1
            return [s for s, _n in sorted(counts.items(), key=lambda kv: -kv[1])[:2]]
        F["movers"] = {"winners": winners, "losers": losers,
                       "winner_sectors": _top_sectors(winners),
                       "loser_sectors": _top_sectors(losers)}

        # ── Earnings analyst ─────────────────────────────────────────────────
        F["earnings"] = self._analyze_earnings(raw, ws, we)

        # ── Macro / FX analyst ───────────────────────────────────────────────
        fx_rows = []
        usd_moves = []
        for pair, labels, sign in FX_PAIRS:
            p = self._perf(bars.get(pair, []), ws, we)
            if not p:
                continue
            usd_ret = p["ret_pct"] * sign      # >0 → dollar stronger vs this ccy
            fx_rows.append({"pair": pair, "labels": labels, "close": p["last_close"],
                            "ret_pct": p["ret_pct"], "usd_ret": round(usd_ret, 2)})
            if pair in ("EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD"):
                usd_moves.append(usd_ret)
        usd_comp = round(statistics.mean(usd_moves), 2) if usd_moves else 0.0
        macro_rows = []
        tnx_bps = None
        for sym, labels in MACRO_ASSETS:
            p = self._perf(bars.get(sym, []), ws, we)
            if not p:
                continue
            row = {"symbol": sym, "labels": labels, "close": p["last_close"],
                   "ret_pct": p["ret_pct"]}
            if sym == "^TNX":
                # ^TNX quotes yield × 10 → convert the weekly move to basis points
                tnx_bps = round((p["last_close"] - p["base_close"]) * 10, 1)
                row["chg_bps"] = tnx_bps
            macro_rows.append(row)
        gold = next((m for m in macro_rows if m["symbol"] == "GCUSD"), None)
        btc = next((m for m in macro_rows if m["symbol"] == "BTCUSD"), None)
        macro_score = -usd_comp * 14
        if tnx_bps is not None:
            macro_score -= max(abs(tnx_bps) - 12, 0) * (0.9 if tnx_bps > 0 else 0.3)
        if btc:
            macro_score += _clamp(btc["ret_pct"] * 0.8, -12, 12)
        F["macrofx"] = {"fx": fx_rows, "usd_composite": usd_comp,
                        "macro": macro_rows, "tnx_bps": tnx_bps,
                        "gold_ret": gold["ret_pct"] if gold else None,
                        "btc_ret": btc["ret_pct"] if btc else None,
                        "score": round(_clamp(macro_score), 1),
                        "confidence": 0.8 if fx_rows else 0.3}

        # ── Flows analyst (institutional vs retail proxies) ──────────────────
        F["flows"] = self._analyze_flows(bars, ws, we, spx_ret)

        # ── News analyst (reuses the market-sentiment NLP) ───────────────────
        F["news"] = self._analyze_news(raw["news"], spx_ret)

        # ── Council synthesis: cross-signal reasoning ────────────────────────
        F["council"] = self._council(F)
        return F

    # ── Earnings sub-analyst ────────────────────────────────────────────────
    def _analyze_earnings(self, raw: Dict[str, Any], ws: str, we: str) -> Dict[str, Any]:
        sp = raw["earnings_sp"]
        quotes = raw["quotes"]
        member_bars = raw["member_bars"]
        cons_by_sym = {c["symbol"]: c for c in raw["constituents"]}
        rows = []
        for e in sp:
            sym = e["symbol"]
            eps_a, eps_e = e.get("epsActual"), e.get("epsEstimated")
            rpt_date = (e.get("date") or "")[:10]
            surprise_pct = None
            if eps_a is not None and eps_e not in (None, 0):
                surprise_pct = round((eps_a - eps_e) / abs(eps_e) * 100, 1)
            reaction = self._earnings_reaction(member_bars.get(sym, []), rpt_date)
            q = quotes.get(sym) or {}
            rows.append({
                "symbol": sym,
                "name": (cons_by_sym.get(sym, {}).get("name") or q.get("name") or sym),
                "sector": cons_by_sym.get(sym, {}).get("sector") or "—",
                "date": rpt_date, "mktcap": q.get("marketCap"),
                "eps_actual": eps_a, "eps_estimated": eps_e,
                "surprise_pct": surprise_pct,
                "reaction_pct": reaction[0], "reaction_day": reaction[1],
            })
        with_both = [r for r in rows if r["surprise_pct"] is not None]
        beats = [r for r in with_both if (r["eps_actual"] or 0) >= (r["eps_estimated"] or 0)]
        reactions = [r["reaction_pct"] for r in rows if r["reaction_pct"] is not None]
        sell_news = [r for r in with_both
                     if r["surprise_pct"] > 0 and (r["reaction_pct"] or 0) < -2]
        miss_rally = [r for r in with_both
                      if r["surprise_pct"] < 0 and (r["reaction_pct"] or 0) > 2]
        rows.sort(key=lambda r: r["mktcap"] or 0, reverse=True)
        beat_rate = round(100 * len(beats) / len(with_both), 1) if with_both else None
        avg_reaction = round(statistics.mean(reactions), 2) if reactions else None
        score = 0.0
        if beat_rate is not None:
            score += (beat_rate - 68) * 1.6      # ~68% is the long-run S&P beat rate
        if avg_reaction is not None:
            score += avg_reaction * 9
        return {
            "total_market": len(raw["earnings_all"]), "sp_count": len(sp),
            "with_eps": len(with_both), "beats": len(beats),
            "misses": len(with_both) - len(beats), "beat_rate": beat_rate,
            "avg_surprise": (round(statistics.mean(
                [r["surprise_pct"] for r in with_both]), 1) if with_both else None),
            "avg_reaction": avg_reaction,
            "notables": rows[:15],
            "sell_news": [r["symbol"] for r in sell_news][:6],
            "miss_rally": [r["symbol"] for r in miss_rally][:6],
            "score": round(_clamp(score), 1) if with_both else 0.0,
            "confidence": min(0.9, len(with_both) / 25) if with_both else 0.15,
        }

    @staticmethod
    def _earnings_reaction(bars: List[Dict],
                           rpt_date: str) -> Tuple[Optional[float], Optional[str]]:
        """Same-day and next-day close moves around the report; when the BMO/AMC
        timing is unknown, report the larger of the two."""
        if not bars or not rpt_date:
            return None, None
        idx = next((i for i, b in enumerate(bars)
                    if b.get("date", "") >= rpt_date), None)
        if idx is None or idx == 0:
            return None, None
        prev_c = bars[idx - 1].get("close")
        day_c = bars[idx].get("close")
        same = (day_c / prev_c - 1) * 100 if prev_c and day_c else None
        nxt = None
        if idx + 1 < len(bars) and day_c:
            nxt_c = bars[idx + 1].get("close")
            nxt = (nxt_c / day_c - 1) * 100 if nxt_c else None
        candidates = [(abs(same), round(same, 2), "same_day")] if same is not None else []
        if nxt is not None:
            candidates.append((abs(nxt), round(nxt, 2), "next_day"))
        if not candidates:
            return None, None
        _mag, val, day = max(candidates, key=lambda c: c[0])
        return val, day

    # ── Flows sub-analyst ───────────────────────────────────────────────────
    def _analyze_flows(self, bars: Dict[str, List[Dict]], ws: str, we: str,
                       spx_ret: float) -> Dict[str, Any]:
        perf = {s: self._perf(bars.get(s, []), ws, we) for s, _l in FLOW_PROXIES}

        def _r(sym: str) -> Optional[float]:
            p = perf.get(sym)
            return p["ret_pct"] if p else None

        spy, rsp, iwm = _r("SPY"), _r("RSP"), _r("IWM")
        sphb, splv, arkk = _r("SPHB"), _r("SPLV"), _r("ARKK")
        hyg, tlt = _r("HYG"), _r("TLT")
        rsp_spy = round(rsp - spy, 2) if (rsp is not None and spy is not None) else None
        iwm_spy = round(iwm - spy, 2) if (iwm is not None and spy is not None) else None
        beta_lv = round(sphb - splv, 2) if (sphb is not None and splv is not None) else None
        credit = round(hyg - tlt, 2) if (hyg is not None and tlt is not None) else None

        # SPY volume vs its ~4-week baseline before the report week
        vol_ratio = None
        spy_bars = bars.get("SPY", [])
        wk = [b.get("volume", 0) or 0 for b in spy_bars if ws <= b.get("date", "") <= we]
        base = [b.get("volume", 0) or 0 for b in spy_bars if b.get("date", "") < ws][-20:]
        if wk and base and statistics.mean(base) > 0:
            vol_ratio = round(statistics.mean(wk) / statistics.mean(base), 2)

        score = 0.0
        for v, w in ((rsp_spy, 16), (iwm_spy, 9), (beta_lv, 9), (credit, 9)):
            if v is not None:
                score += _clamp(v * w, -30, 30)
        if arkk is not None:
            score += _clamp((arkk - spx_ret) * 2.0, -10, 10)

        # Verdict id: what the positioning proxies suggest about who was buying
        if (rsp_spy or 0) > 0.3 and (iwm_spy or 0) > 0.3 and score > 15:
            verdict = "broad_institutional_riskon"
        elif (rsp_spy or 0) < -0.4 and spx_ret > 0:
            verdict = "megacap_concentration"
        elif (arkk or 0) - spx_ret > 2.5 and (beta_lv or 0) > 1.0:
            verdict = "retail_speculative_bid"
        elif (credit or 0) < -0.8 and (beta_lv or 0) < -0.8:
            verdict = "institutional_derisking"
        elif spx_ret < -1.0 and (splv or 0) > (sphb or 0):
            verdict = "defensive_hiding"
        else:
            verdict = "balanced"
        return {"spy": spy, "rsp": rsp, "iwm": iwm, "sphb": sphb, "splv": splv,
                "arkk": arkk, "hyg": hyg, "tlt": tlt,
                "rsp_minus_spy": rsp_spy, "iwm_minus_spy": iwm_spy,
                "beta_minus_lowvol": beta_lv, "credit_minus_duration": credit,
                "volume_ratio": vol_ratio, "verdict": verdict,
                "score": round(_clamp(score), 1),
                "confidence": 0.75 if rsp_spy is not None else 0.3}

    # ── News sub-analyst ────────────────────────────────────────────────────
    def _analyze_news(self, news: List[Dict], spx_ret: float) -> Dict[str, Any]:
        scored = []
        theme_hits: Dict[str, List[float]] = {k: [] for k in NEWS_THEMES}
        for n in news:
            text = f"{n.get('title', '')}. {n.get('text', '')[:400]}"
            s = self._nlp.analyze_text(text)
            sent = float(s.get("normalized", s.get("score", 0)) or 0)
            sent = _clamp(sent, -2.5, 2.5)
            themes = [tid for tid, t in NEWS_THEMES.items()
                      if any(kw in text.lower() for kw in t["kw"])]
            for tid in themes:
                theme_hits[tid].append(sent)
            scored.append({"title": n.get("title"), "site": n.get("site"),
                           "url": n.get("url"),
                           "date": (n.get("publishedDate") or "")[:10],
                           "sentiment": round(sent, 2), "themes": themes})
        themes = []
        for tid, sents in theme_hits.items():
            if not sents:
                continue
            avg = statistics.mean(sents)
            themes.append({"id": tid, "labels": {"es": NEWS_THEMES[tid]["es"],
                                                 "en": NEWS_THEMES[tid]["en"]},
                           "count": len(sents), "avg_sentiment": round(avg, 2),
                           "impact": round(len(sents) * (1 + abs(avg)), 1)})
        themes.sort(key=lambda t: -t["impact"])
        avg_sent = (statistics.mean([s["sentiment"] for s in scored])
                    if scored else 0.0)
        top = sorted(scored, key=lambda s: -abs(s["sentiment"]))[:8]
        top.sort(key=lambda s: s["date"])
        # Did the tape follow the news, or shrug it off?
        digestion = "aligned"
        if scored:
            if avg_sent < -0.15 and spx_ret > 0.3:
                digestion = "shrugged_bad_news"
            elif avg_sent > 0.15 and spx_ret < -0.3:
                digestion = "faded_good_news"
        return {"count": len(scored), "avg_sentiment": round(avg_sent, 2),
                "pct_negative": (round(100 * sum(1 for s in scored if s["sentiment"] < -0.1)
                                       / len(scored), 1) if scored else None),
                "themes": themes[:6], "top_stories": top,
                "digestion": digestion,
                "nlp_engine": ("market_sentiment_engine.AdvancedNewsSentimentAnalyzer"
                               if _NEWS_NLP_AVAILABLE else "lexicon-lite"),
                "score": round(_clamp(avg_sent * 55), 1),
                "confidence": min(0.8, len(scored) / 60) if scored else 0.1}

    # ── Council: cross-signal synthesis ─────────────────────────────────────
    @staticmethod
    def _council(F: Dict[str, Any]) -> Dict[str, Any]:
        members = [
            ("market",   F["market"]["score"],   F["market"]["confidence"],   1.30),
            ("sectors",  F["sectors"]["score"],  F["sectors"]["confidence"],  1.00),
            ("breadth",  F["breadth"]["score"],  F["breadth"]["confidence"],  1.20),
            ("earnings", F["earnings"]["score"], F["earnings"]["confidence"], 0.90),
            ("macrofx",  F["macrofx"]["score"],  F["macrofx"]["confidence"],  0.85),
            ("flows",    F["flows"]["score"],    F["flows"]["confidence"],    1.00),
            ("news",     F["news"]["score"],     F["news"]["confidence"],     0.75),
        ]
        wsum = sum(c * w for _i, _s, c, w in members) or 1.0
        consensus = sum(s * c * w for _i, s, c, w in members) / wsum
        scores = [s for _i, s, _c, _w in members]
        dispersion = statistics.pstdev(scores) if len(scores) > 1 else 0.0
        agree_bull = [i for i, s, _c, _w in members if s > 15]
        agree_bear = [i for i, s, _c, _w in members if s < -15]

        spx = F["market"]["spx_ret"]
        breadth = F["breadth"]
        divergences: List[Dict[str, Any]] = []
        if spx > 0.3 and breadth.get("score", 0) < -10:
            divergences.append({"id": "narrow_leadership",
                                "gap": breadth.get("concentration_gap")})
        if spx > 0.3 and (breadth.get("concentration_gap") or 0) > 0.8:
            divergences.append({"id": "megacap_carry",
                                "gap": breadth.get("concentration_gap")})
        if F["news"]["digestion"] == "shrugged_bad_news":
            divergences.append({"id": "shrugged_bad_news",
                                "avg_sent": F["news"]["avg_sentiment"]})
        if F["news"]["digestion"] == "faded_good_news":
            divergences.append({"id": "faded_good_news",
                                "avg_sent": F["news"]["avg_sentiment"]})
        if len(F["earnings"].get("sell_news", [])) >= 2:
            divergences.append({"id": "sell_the_news",
                                "symbols": F["earnings"]["sell_news"]})
        if spx > 0.3 and F["sectors"]["cyc_def_spread"] < -0.8:
            divergences.append({"id": "defensive_undertone",
                                "spread": F["sectors"]["cyc_def_spread"]})
        if spx > 0.5 and F["macrofx"]["usd_composite"] > 0.6:
            divergences.append({"id": "dollar_equity_both_up",
                                "usd": F["macrofx"]["usd_composite"]})
        if spx > 0.5 and (F["flows"].get("iwm_minus_spy") or 0) < -1.2:
            divergences.append({"id": "smallcap_lag",
                                "gap": F["flows"].get("iwm_minus_spy")})
        if not divergences and abs(spx) > 0.5 and breadth.get("score", 0) * spx > 0:
            divergences.append({"id": "breadth_confirms", "pct_up": breadth.get("pct_up")})

        # Regime classification
        if consensus > 18 and breadth.get("score", 0) > 12:
            regime = "risk_on_broad"
        elif consensus > 10 and breadth.get("score", 0) <= 0:
            regime = "risk_on_narrow"
        elif consensus < -20:
            regime = "risk_off"
        elif spx < 0 and F["sectors"]["cyc_def_spread"] < -0.5:
            regime = "defensive_rotation"
        else:
            regime = "mixed"

        # Rank the week's dominant drivers
        drivers: List[Tuple[float, Dict[str, Any]]] = []
        top_theme = F["news"]["themes"][0] if F["news"]["themes"] else None
        if top_theme:
            drivers.append((top_theme["impact"] * 1.6,
                            {"id": "news_theme", "theme": top_theme}))
        if F["earnings"]["with_eps"] >= 8:
            drivers.append((abs(F["earnings"]["score"]) + F["earnings"]["with_eps"] * 0.4,
                            {"id": "earnings_season", "beat_rate": F["earnings"]["beat_rate"],
                             "avg_reaction": F["earnings"]["avg_reaction"]}))
        drivers.append((abs(F["sectors"]["cyc_def_spread"]) * 10,
                        {"id": "sector_rotation", "spread": F["sectors"]["cyc_def_spread"]}))
        if F["macrofx"]["tnx_bps"] is not None:
            drivers.append((abs(F["macrofx"]["tnx_bps"]) * 0.9,
                            {"id": "rates_move", "bps": F["macrofx"]["tnx_bps"]}))
        drivers.append((abs(F["macrofx"]["usd_composite"]) * 12,
                        {"id": "dollar_move", "usd": F["macrofx"]["usd_composite"]}))
        if F["market"]["vix"]:
            drivers.append((abs(F["market"]["vix"]["chg_pct"]) * 0.7,
                            {"id": "volatility", "vix": F["market"]["vix"]}))
        drivers.sort(key=lambda d: -d[0])
        return {
            "members": [{"id": i, "score": s, "confidence": round(c, 2), "weight": w}
                        for i, s, c, w in members],
            "consensus": round(consensus, 1),
            "dispersion": round(dispersion, 1),
            "bullish_camp": agree_bull, "bearish_camp": agree_bear,
            "divergences": divergences,
            "regime": regime,
            "drivers": [d for _mag, d in drivers[:3]],
        }

    # ═══════════════════════════════════════════════════════════════════════
    #  Stage 3 — COMPOSE (bilingual narrative)
    # ═══════════════════════════════════════════════════════════════════════
    def compose(self, raw: Dict[str, Any], F: Dict[str, Any],
                ws: str, we: str, lang: str) -> Dict[str, Any]:
        es = lang == "es"
        M, S, B = F["market"], F["sectors"], F["breadth"]
        E, X, FL, N, C = F["earnings"], F["macrofx"], F["flows"], F["news"], F["council"]
        spx_ret = M["spx_ret"]

        regime_txt = {
            "risk_on_broad": {
                "es": ("Apetito por riesgo amplio",
                       "Avance generalizado: la mayoría de sectores y componentes participaron de la suba."),
                "en": ("Broad risk-on",
                       "A broad-based advance: most sectors and index members participated in the move higher."),
            },
            "risk_on_narrow": {
                "es": ("Alza con liderazgo estrecho",
                       "El índice subió, pero la participación fue selectiva y concentrada en pocos nombres."),
                "en": ("Narrow risk-on",
                       "The index advanced, but participation was selective and concentrated in a handful of names."),
            },
            "defensive_rotation": {
                "es": ("Rotación defensiva",
                       "El dinero se refugió en sectores defensivos mientras el mercado cedía terreno."),
                "en": ("Defensive rotation",
                       "Money moved toward defensive sectors while the broader market gave back ground."),
            },
            "risk_off": {
                "es": ("Aversión al riesgo",
                       "Semana de reducción de riesgo: ventas extendidas y búsqueda de refugio."),
                "en": ("Risk-off",
                       "A de-risking week: broad selling and a bid for safety."),
            },
            "mixed": {
                "es": ("Semana mixta",
                       "Señales cruzadas entre precio, amplitud y flujos; sin una tendencia dominante clara."),
                "en": ("Mixed week",
                       "Crossed signals between price, breadth and flows; no single dominant trend."),
            },
        }[C["regime"]][lang]

        # ---- Headline & dek -------------------------------------------------
        dir_word = _direction_word(spx_ret, lang)
        best_sec = S["table"][0] if S["table"] else None
        worst_sec = S["table"][-1] if S["table"] else None
        if es:
            headline = f"El S&P 500 {dir_word} ({_pct(spx_ret)}) en una semana de {regime_txt[0].lower()}"
            dek_bits = []
            if best_sec:
                dek_bits.append(f"{best_sec['labels']['es']} lideró ({_pct(best_sec['ret_pct'])})")
            if B.get("pct_up") is not None:
                dek_bits.append(f"el {_pctu(B['pct_up'], 0)} de los componentes cerró en positivo")
            if M["vix"]:
                dek_bits.append(f"el VIX terminó en {M['vix']['level']:.1f} ({_pct(M['vix']['chg_pct'])})")
            dek = ("; ".join(dek_bits) + ".") if dek_bits else regime_txt[1]
            dek = dek[0].upper() + dek[1:]
        else:
            headline = f"S&P 500 {dir_word} ({_pct(spx_ret)}) in a {regime_txt[0].lower()} week"
            dek_bits = []
            if best_sec:
                dek_bits.append(f"{best_sec['labels']['en']} led ({_pct(best_sec['ret_pct'])})")
            if B.get("pct_up") is not None:
                dek_bits.append(f"{_pctu(B['pct_up'], 0)} of index members closed higher")
            if M["vix"]:
                dek_bits.append(f"the VIX ended at {M['vix']['level']:.1f} ({_pct(M['vix']['chg_pct'])})")
            dek = ("; ".join(dek_bits) + ".") if dek_bits else regime_txt[1]

        sections: List[Dict[str, Any]] = []

        # ---- 1. Market overview --------------------------------------------
        paras = []
        if es:
            p1 = (f"La renta variable estadounidense {dir_word} en la semana: el S&P 500 "
                  f"registró una variación de {_pct(spx_ret)}")
            others = [i for i in M["indices"] if i["symbol"] != "^GSPC"]
            if others:
                p1 += ", " + ", ".join(
                    f"el {i['labels']['es']} {_pct(i['ret_pct'])}" for i in others[:3])
            p1 += "."
            if M["best_day"] and M["worst_day"] and M["trading_days"] >= 3:
                p1 += (f" La mejor sesión fue el {_weekday_name(M['best_day']['date'], lang)} "
                       f"({_pct(M['best_day']['chg_pct'])}) y la más débil el "
                       f"{_weekday_name(M['worst_day']['date'], lang)} "
                       f"({_pct(M['worst_day']['chg_pct'])}).")
            paras.append(p1)
            if M["vix"]:
                v = M["vix"]
                calif = ("un nivel de complacencia" if v["level"] < 14 else
                         "un nivel contenido" if v["level"] < 18 else
                         "un nivel de cautela" if v["level"] < 25 else
                         "un nivel de estrés elevado")
                paras.append(
                    f"La volatilidad implícita cerró la semana con el VIX en {v['level']:.1f} "
                    f"({_pct(v['chg_pct'])} en la semana), {calif} en términos históricos. "
                    + ("La compresión de volatilidad acompañó la mejora del apetito por riesgo."
                       if v["chg_pct"] < -5 else
                       "El repunte de la volatilidad sugiere demanda de cobertura pese al comportamiento del contado."
                       if v["chg_pct"] > 5 else
                       "La estabilidad del índice de volatilidad es consistente con una semana sin sobresaltos sistémicos."))
        else:
            p1 = (f"U.S. equities {dir_word} on the week: the S&P 500 returned {_pct(spx_ret)}")
            others = [i for i in M["indices"] if i["symbol"] != "^GSPC"]
            if others:
                p1 += ", with " + ", ".join(
                    f"the {i['labels']['en']} at {_pct(i['ret_pct'])}" for i in others[:3])
            p1 += "."
            if M["best_day"] and M["worst_day"] and M["trading_days"] >= 3:
                p1 += (f" The strongest session was {_weekday_name(M['best_day']['date'], lang)} "
                       f"({_pct(M['best_day']['chg_pct'])}); the weakest was "
                       f"{_weekday_name(M['worst_day']['date'], lang)} "
                       f"({_pct(M['worst_day']['chg_pct'])}).")
            paras.append(p1)
            if M["vix"]:
                v = M["vix"]
                calif = ("complacent" if v["level"] < 14 else "contained"
                         if v["level"] < 18 else "cautious" if v["level"] < 25
                         else "elevated-stress")
                paras.append(
                    f"Implied volatility ended the week with the VIX at {v['level']:.1f} "
                    f"({_pct(v['chg_pct'])} on the week), a {calif} level by historical standards. "
                    + ("The volatility compression accompanied the improvement in risk appetite."
                       if v["chg_pct"] < -5 else
                       "The pickup in volatility points to hedging demand despite the behavior of the cash market."
                       if v["chg_pct"] > 5 else
                       "The stability of the volatility complex is consistent with a week free of systemic scares."))
        sections.append({"id": "overview",
                         "title": "Panorama de mercado" if es else "Market overview",
                         "paragraphs": paras,
                         "indices": [{"symbol": i["symbol"], "label": i["labels"][lang],
                                      "ret_pct": i["ret_pct"], "close": i["last_close"],
                                      "daily": i["daily"]} for i in M["indices"]],
                         "vix": M["vix"]})

        # ---- 2. Sector rotation --------------------------------------------
        paras = []
        if S["table"]:
            top3 = S["table"][:3]
            bot3 = S["table"][-3:]
            spread = S["cyc_def_spread"]
            if es:
                paras.append(
                    f"{S['positive']} de {S['total']} sectores cerraron la semana en terreno positivo. "
                    f"Lideraron {', '.join(s['labels']['es'] for s in top3[:2])} "
                    f"({_pct(top3[0]['ret_pct'])} y {_pct(top3[1]['ret_pct']) if len(top3) > 1 else ''}), "
                    f"mientras que {bot3[-1]['labels']['es']} quedó al fondo de la tabla "
                    f"({_pct(bot3[-1]['ret_pct'])}).")
                paras.append(
                    (f"La lectura de rotación es constructiva: los sectores cíclicos superaron a los "
                     f"defensivos por {_pctu(abs(spread))} en promedio, un patrón típico de fases de "
                     f"apetito por riesgo.") if spread > 0.5 else
                    (f"La rotación tuvo un sesgo defensivo: consumo básico, salud y servicios públicos "
                     f"superaron a los cíclicos por {_pctu(abs(spread))} en promedio, señal de que parte "
                     f"del mercado priorizó protección.") if spread < -0.5 else
                    "La rotación sectorial fue equilibrada, sin un sesgo claro entre cíclicos y defensivos.")
            else:
                paras.append(
                    f"{S['positive']} of {S['total']} sectors finished the week in positive territory. "
                    f"{', '.join(s['labels']['en'] for s in top3[:2])} led "
                    f"({_pct(top3[0]['ret_pct'])} and {_pct(top3[1]['ret_pct']) if len(top3) > 1 else ''}), "
                    f"while {bot3[-1]['labels']['en']} sat at the bottom of the table "
                    f"({_pct(bot3[-1]['ret_pct'])}).")
                paras.append(
                    (f"The rotation read is constructive: cyclical sectors outperformed defensives by "
                     f"{_pctu(abs(spread))} on average, a pattern typical of risk-seeking phases.")
                    if spread > 0.5 else
                    (f"Rotation carried a defensive tilt: staples, health care and utilities beat "
                     f"cyclicals by {_pctu(abs(spread))} on average — a sign part of the market "
                     f"prioritized protection.") if spread < -0.5 else
                    "Sector rotation was balanced, with no clear tilt between cyclicals and defensives.")
        sections.append({"id": "sectors",
                         "title": "Rotación sectorial" if es else "Sector rotation",
                         "paragraphs": paras,
                         "sectors": [{"etf": s["etf"], "label": s["labels"][lang],
                                      "ret_pct": s["ret_pct"]} for s in S["table"]],
                         "cyc_def_spread": S["cyc_def_spread"]})

        # ---- 3. Breadth ------------------------------------------------------
        paras = []
        if B.get("total"):
            gap = B.get("concentration_gap") or 0
            if es:
                paras.append(
                    f"Sobre {B['total']} componentes del S&P 500 con datos, {B['advancers']} avanzaron, "
                    f"{B['decliners']} retrocedieron y {B['flat']} cerraron prácticamente planos: "
                    f"una amplitud del {_pctu(B['pct_up'], 0)}. El retorno promedio del componente fue "
                    f"{_pct(B['avg_ret'])} (mediana {_pct(B['median_ret'])}) frente a {_pct(B['index_ret'])} "
                    f"del índice ponderado por capitalización.")
                paras.append(
                    (f"La diferencia de {_pctu(abs(gap))} a favor del índice indica que las mega-caps "
                     f"explicaron una porción desproporcionada del movimiento; la acción promedio tuvo "
                     f"una semana más modesta de lo que sugiere el titular.") if gap > 0.8 else
                    (f"La acción promedio superó al índice por {_pctu(abs(gap))}: la fortaleza estuvo "
                     f"repartida más allá de las grandes capitalizaciones, una señal de participación "
                     f"saludable.") if gap < -0.8 else
                    "Índice y componente promedio se movieron en línea: no hubo distorsión relevante por concentración.")
            else:
                paras.append(
                    f"Across {B['total']} S&P 500 members with data, {B['advancers']} advanced, "
                    f"{B['decliners']} declined and {B['flat']} closed roughly flat — breadth of "
                    f"{_pctu(B['pct_up'], 0)}. The average member returned {_pct(B['avg_ret'])} "
                    f"(median {_pct(B['median_ret'])}) versus {_pct(B['index_ret'])} for the "
                    f"cap-weighted index.")
                paras.append(
                    (f"The {_pctu(abs(gap))} gap in favor of the index means mega-caps explained a "
                     f"disproportionate share of the move; the average stock had a more modest week "
                     f"than the headline suggests.") if gap > 0.8 else
                    (f"The average stock beat the index by {_pctu(abs(gap))}: strength was distributed "
                     f"beyond the largest capitalizations — a sign of healthy participation.")
                    if gap < -0.8 else
                    "Index and average member moved in line: concentration did not distort the picture.")
        sections.append({"id": "breadth",
                         "title": "Amplitud del mercado" if es else "Market breadth",
                         "paragraphs": paras, "stats": B})

        # ---- 4. Winners & losers ---------------------------------------------
        MV = F["movers"]
        paras = []
        if MV["winners"] and MV["losers"]:
            w0, l0 = MV["winners"][0], MV["losers"][0]
            if es:
                paras.append(
                    f"El mejor desempeño del S&P 500 fue {w0['name']} ({w0['symbol']}) con "
                    f"{_pct(w0['ret_pct'])}; en el extremo opuesto, {l0['name']} ({l0['symbol']}) "
                    f"cedió {_pct(l0['ret_pct'])}. Entre los ganadores predominan nombres de "
                    f"{' y '.join(MV['winner_sectors'])}, mientras que las mayores caídas se "
                    f"concentraron en {' y '.join(MV['loser_sectors'])} — una radiografía coherente "
                    f"con la rotación sectorial descrita arriba.")
            else:
                paras.append(
                    f"The best S&P 500 performer was {w0['name']} ({w0['symbol']}) at "
                    f"{_pct(w0['ret_pct'])}; at the other extreme, {l0['name']} ({l0['symbol']}) "
                    f"gave back {_pct(l0['ret_pct'])}. Winners skewed toward "
                    f"{' and '.join(MV['winner_sectors'])}, while the largest declines clustered in "
                    f"{' and '.join(MV['loser_sectors'])} — consistent with the sector rotation "
                    f"described above.")
        sections.append({"id": "movers",
                         "title": "Ganadores y perdedores de la semana" if es
                                  else "Weekly winners & losers",
                         "paragraphs": paras,
                         "winners": MV["winners"], "losers": MV["losers"]})

        # ---- 5. Earnings ------------------------------------------------------
        paras = []
        if E["sp_count"] > 0:
            if es:
                p = (f"Durante la semana reportaron resultados {E['total_market']} compañías en el "
                     f"mercado estadounidense, de las cuales {E['sp_count']} pertenecen al S&P 500.")
                if E["beat_rate"] is not None:
                    p += (f" Entre las que ya publicaron BPA comparable, el {_pctu(E['beat_rate'], 0)} "
                          f"superó las estimaciones de consenso"
                          + (f", con una sorpresa media de {_pct(E['avg_surprise'])}" if E["avg_surprise"] is not None else "")
                          + ".")
                paras.append(p)
                if E["avg_reaction"] is not None:
                    p2 = (f"La reacción media del precio en torno al reporte fue de "
                          f"{_pct(E['avg_reaction'])}.")
                    if E["sell_news"]:
                        p2 += (f" Se observaron episodios de 'vender la noticia' — resultados por "
                               f"encima de lo esperado recibidos con ventas — en "
                               f"{', '.join(E['sell_news'])}, lo que sugiere expectativas exigentes "
                               f"ya incorporadas en precios.")
                    if E["miss_rally"]:
                        p2 += (f" En sentido inverso, {', '.join(E['miss_rally'])} subieron pese a "
                               f"resultados por debajo del consenso, señal de pesimismo previamente "
                               f"descontado.")
                    paras.append(p2)
            else:
                p = (f"{E['total_market']} U.S.-listed companies reported during the week, "
                     f"{E['sp_count']} of them S&P 500 members.")
                if E["beat_rate"] is not None:
                    p += (f" Among those with comparable EPS, {_pctu(E['beat_rate'], 0)} topped "
                          f"consensus estimates"
                          + (f", with an average surprise of {_pct(E['avg_surprise'])}" if E["avg_surprise"] is not None else "")
                          + ".")
                paras.append(p)
                if E["avg_reaction"] is not None:
                    p2 = f"The average price reaction around the print was {_pct(E['avg_reaction'])}."
                    if E["sell_news"]:
                        p2 += (f" 'Sell-the-news' episodes — better-than-expected results met with "
                               f"selling — showed up in {', '.join(E['sell_news'])}, suggesting "
                               f"demanding expectations were already priced in.")
                    if E["miss_rally"]:
                        p2 += (f" Conversely, {', '.join(E['miss_rally'])} rallied despite missing "
                               f"consensus — a sign pessimism had been pre-discounted.")
                    paras.append(p2)
        else:
            paras.append("Semana sin reportes relevantes de integrantes del S&P 500." if es
                         else "No relevant S&P 500 earnings reports this week.")
        sections.append({"id": "earnings",
                         "title": "Temporada de resultados" if es else "Earnings scorecard",
                         "paragraphs": paras,
                         "stats": {k: E[k] for k in ("total_market", "sp_count", "with_eps",
                                                     "beats", "misses", "beat_rate",
                                                     "avg_surprise", "avg_reaction")},
                         "notables": E["notables"]})

        # ---- 6. Currencies & global macro -------------------------------------
        paras = []
        usd = X["usd_composite"]
        if X["fx"]:
            if es:
                p = (f"El dólar estadounidense se {'fortaleció' if usd > 0.15 else 'debilitó' if usd < -0.15 else 'mantuvo estable'} "
                     f"frente a las principales divisas ({_pct(usd)} promedio ponderado frente a majors).")
                em = [f for f in X["fx"] if f["pair"] in ("USDMXN", "USDBRL", "USDCNY")]
                if em:
                    moves = ", ".join(
                        f"{f['labels']['es']} {_pct(-f['usd_ret'])}" for f in em)
                    p += f" En emergentes, la variación frente al dólar fue: {moves}."
                paras.append(p)
                bits = []
                if X["gold_ret"] is not None:
                    bits.append(f"el oro varió {_pct(X['gold_ret'])}")
                oil = next((m for m in X["macro"] if m["symbol"] == "CLUSD"), None)
                if oil:
                    bits.append(f"el crudo WTI {_pct(oil['ret_pct'])}")
                if X["btc_ret"] is not None:
                    bits.append(f"bitcoin {_pct(X['btc_ret'])}")
                if X["tnx_bps"] is not None:
                    bits.append(f"la tasa del Tesoro a 10 años se movió {X['tnx_bps']:+.0f} puntos básicos")
                if bits:
                    paras.append("En el resto del complejo macro, " + ", ".join(bits) + ".")
                if usd > 0.4 and spx_ret > 0.5:
                    paras.append("La combinación de dólar fuerte y acciones al alza es atípica y suele "
                                 "reflejar entradas de capital hacia activos estadounidenses más que un "
                                 "simple trade reflacionario.")
                elif usd < -0.4 and spx_ret > 0.5:
                    paras.append("El retroceso del dólar actuó como viento de cola adicional para los "
                                 "activos de riesgo y para las multinacionales con ingresos en el exterior.")
            else:
                p = (f"The U.S. dollar {'strengthened' if usd > 0.15 else 'weakened' if usd < -0.15 else 'was broadly stable'} "
                     f"against major currencies ({_pct(usd)} average vs. majors).")
                em = [f for f in X["fx"] if f["pair"] in ("USDMXN", "USDBRL", "USDCNY")]
                if em:
                    moves = ", ".join(
                        f"{f['labels']['en']} {_pct(-f['usd_ret'])}" for f in em)
                    p += f" In EM, moves versus the dollar were: {moves}."
                paras.append(p)
                bits = []
                if X["gold_ret"] is not None:
                    bits.append(f"gold moved {_pct(X['gold_ret'])}")
                oil = next((m for m in X["macro"] if m["symbol"] == "CLUSD"), None)
                if oil:
                    bits.append(f"WTI crude {_pct(oil['ret_pct'])}")
                if X["btc_ret"] is not None:
                    bits.append(f"bitcoin {_pct(X['btc_ret'])}")
                if X["tnx_bps"] is not None:
                    bits.append(f"the 10-year Treasury yield moved {X['tnx_bps']:+.0f} bps")
                if bits:
                    paras.append("Elsewhere in the macro complex, " + ", ".join(bits) + ".")
                if usd > 0.4 and spx_ret > 0.5:
                    paras.append("Dollar strength alongside rising equities is atypical and usually "
                                 "reflects capital inflows into U.S. assets rather than a simple "
                                 "reflation trade.")
                elif usd < -0.4 and spx_ret > 0.5:
                    paras.append("The softer dollar acted as an additional tailwind for risk assets "
                                 "and for multinationals with overseas revenue.")
        sections.append({"id": "currencies",
                         "title": "Divisas y macro global" if es else "Currencies & global macro",
                         "paragraphs": paras,
                         "fx": [{"pair": f["pair"], "label": f["labels"][lang],
                                 "close": f["close"], "ret_pct": f["ret_pct"],
                                 "usd_ret": f["usd_ret"]} for f in X["fx"]],
                         "macro": [{"symbol": m["symbol"], "label": m["labels"][lang],
                                    "close": m["close"], "ret_pct": m["ret_pct"],
                                    "chg_bps": m.get("chg_bps")} for m in X["macro"]],
                         "usd_composite": usd})

        # ---- 7. Flows: institutional vs retail ---------------------------------
        verdict_txt = {
            "broad_institutional_riskon": {
                "es": "Los proxies apuntan a una compra institucional amplia: el índice equiponderado y "
                      "las small caps superaron al S&P 500 ponderado, y la alta beta batió a la baja "
                      "volatilidad. Ese patrón de participación es difícil de sostener solo con flujo minorista.",
                "en": "Proxies point to broad institutional buying: the equal-weight index and small caps "
                      "beat the cap-weighted S&P 500, and high beta outpaced low volatility. That "
                      "participation pattern is hard to sustain on retail flow alone."},
            "megacap_concentration": {
                "es": "El S&P 500 ponderado superó con claridad a su versión equiponderada: el flujo se "
                      "concentró en mega-caps, un sello característico de flujos pasivos e institucionales "
                      "hacia los índices, más que de una toma de riesgo generalizada.",
                "en": "The cap-weighted S&P 500 clearly beat its equal-weight version: flow concentrated "
                      "in mega-caps — a hallmark of passive and institutional index flows rather than "
                      "broad risk-taking."},
            "retail_speculative_bid": {
                "es": "Los segmentos favoritos del inversor minorista (growth especulativo, alta beta, "
                      "cripto) superaron con margen al mercado: la semana tuvo un componente claro de "
                      "apetito minorista por riesgo.",
                "en": "Retail-favorite segments (speculative growth, high beta, crypto) beat the market "
                      "by a wide margin: the week carried a clear retail risk appetite component."},
            "institutional_derisking": {
                "es": "El crédito high yield quedó rezagado frente a los Treasuries largos y la alta beta "
                      "quedó detrás de la baja volatilidad: el patrón clásico de reducción de riesgo "
                      "institucional, aun cuando el índice lo disimule.",
                "en": "High-yield credit lagged long Treasuries and high beta trailed low volatility: the "
                      "classic institutional de-risking pattern, even where the index masks it."},
            "defensive_hiding": {
                "es": "Con el mercado a la baja, la baja volatilidad defendió mejor que la alta beta: "
                      "el posicionamiento buscó refugio dentro de la renta variable antes que salir de ella.",
                "en": "With the market lower, low volatility defended better than high beta: positioning "
                      "sought shelter within equities rather than exiting them."},
            "balanced": {
                "es": "Los proxies de posicionamiento no muestran un sesgo dominante entre flujo "
                      "institucional y minorista esta semana; la señal más honesta es de equilibrio.",
                "en": "Positioning proxies show no dominant tilt between institutional and retail flow "
                      "this week; the most honest read is balance."},
        }[FL["verdict"]][lang]
        paras = [verdict_txt]
        if FL["volume_ratio"] is not None:
            if es:
                paras.append(
                    f"El volumen negociado en el SPY fue {_pctu((FL['volume_ratio'] - 1) * 100, 0)} "
                    f"{'superior' if FL['volume_ratio'] >= 1 else 'inferior'} a su promedio de las "
                    f"cuatro semanas previas, lo que {'da mayor validez a la señal de la semana' if abs(FL['volume_ratio'] - 1) > 0.15 else 'sugiere una semana de convicción normal'}.")
            else:
                paras.append(
                    f"SPY volume ran {_pctu(abs(FL['volume_ratio'] - 1) * 100, 0)} "
                    f"{'above' if FL['volume_ratio'] >= 1 else 'below'} its prior four-week average, "
                    f"which {'adds conviction to the weekly signal' if abs(FL['volume_ratio'] - 1) > 0.15 else 'suggests a week of ordinary conviction'}.")
        proxy_rows = []
        for pid, label_key, val in (
            ("rsp_minus_spy", ("Equiponderado − Cap-ponderado", "Equal-weight − Cap-weight"), FL["rsp_minus_spy"]),
            ("iwm_minus_spy", ("Small caps − S&P 500", "Small caps − S&P 500"), FL["iwm_minus_spy"]),
            ("beta_minus_lowvol", ("Alta beta − Baja volatilidad", "High beta − Low volatility"), FL["beta_minus_lowvol"]),
            ("credit_minus_duration", ("Crédito HY − Treasuries largos", "HY credit − Long Treasuries"), FL["credit_minus_duration"]),
        ):
            if val is not None:
                proxy_rows.append({"id": pid,
                                   "label": label_key[0] if es else label_key[1],
                                   "value_pct": val})
        sections.append({"id": "flows",
                         "title": ("Flujos: institucionales vs. minoristas" if es
                                   else "Flows: institutional vs. retail"),
                         "paragraphs": paras,
                         "proxies": proxy_rows,
                         "raw": {k: FL[k] for k in ("spy", "rsp", "iwm", "sphb", "splv",
                                                    "arkk", "hyg", "tlt", "volume_ratio")},
                         "verdict": FL["verdict"]})

        # ---- 8. News & catalysts ----------------------------------------------
        paras = []
        if N["count"]:
            t0 = N["themes"][0] if N["themes"] else None
            if es:
                p = (f"Se procesaron {N['count']} titulares de la semana con el motor de sentimiento "
                     f"del análisis de mercado. El tono agregado fue "
                     f"{'negativo' if N['avg_sentiment'] < -0.1 else 'positivo' if N['avg_sentiment'] > 0.1 else 'neutro'} "
                     f"({N['avg_sentiment']:+.2f} en escala -1/+1).")
                if t0:
                    p += (f" El tema dominante fue «{t0['labels']['es']}» "
                          f"({t0['count']} menciones), seguido de "
                          + ", ".join(f"«{t['labels']['es']}»" for t in N["themes"][1:3]) + ".")
                paras.append(p)
                dig = {
                    "shrugged_bad_news": "Un dato revelador: pese al tono negativo del flujo informativo, "
                                         "el mercado cerró al alza. Cuando el precio digiere bien las malas "
                                         "noticias, la lectura técnica es de demanda subyacente sólida.",
                    "faded_good_news": "Llamativo: con un flujo de noticias favorable, el mercado cerró a la "
                                       "baja. Cuando el precio no responde a las buenas noticias, la señal "
                                       "es de oferta latente y expectativas ya descontadas.",
                    "aligned": "El comportamiento del precio fue coherente con el tono del flujo "
                               "informativo: sin divergencias relevantes entre narrativa y mercado.",
                }[N["digestion"]]
                paras.append(dig)
            else:
                p = (f"{N['count']} weekly headlines were processed with the market-analysis sentiment "
                     f"engine. Aggregate tone was "
                     f"{'negative' if N['avg_sentiment'] < -0.1 else 'positive' if N['avg_sentiment'] > 0.1 else 'neutral'} "
                     f"({N['avg_sentiment']:+.2f} on a -1/+1 scale).")
                if t0:
                    p += (f" The dominant theme was “{t0['labels']['en']}” ({t0['count']} mentions), "
                          f"followed by "
                          + ", ".join(f"“{t['labels']['en']}”" for t in N["themes"][1:3]) + ".")
                paras.append(p)
                dig = {
                    "shrugged_bad_news": "One revealing detail: despite the negative news flow, the market "
                                         "closed higher. When price digests bad news well, the technical "
                                         "read is one of solid underlying demand.",
                    "faded_good_news": "Notably, with a favorable news flow the market still closed lower. "
                                       "When price fails to respond to good news, the signal is latent "
                                       "supply and expectations already discounted.",
                    "aligned": "Price action was consistent with the tone of the news flow: no relevant "
                               "divergence between narrative and market.",
                }[N["digestion"]]
                paras.append(dig)
        else:
            paras.append("Sin cobertura de noticias suficiente para esta semana." if es
                         else "Insufficient news coverage for this week.")
        sections.append({"id": "news",
                         "title": "Noticias y catalizadores" if es else "News & catalysts",
                         "paragraphs": paras,
                         "themes": [{"id": t["id"], "label": t["labels"][lang],
                                     "count": t["count"], "avg_sentiment": t["avg_sentiment"],
                                     "impact": t["impact"]} for t in N["themes"]],
                         "top_stories": N["top_stories"],
                         "digestion": N["digestion"]})

        # ---- 9. Council synthesis ----------------------------------------------
        member_names = {
            "market":   {"es": "Analista de mercado",   "en": "Market analyst"},
            "sectors":  {"es": "Analista de rotación",  "en": "Rotation analyst"},
            "breadth":  {"es": "Analista de amplitud",  "en": "Breadth analyst"},
            "earnings": {"es": "Analista de resultados", "en": "Earnings analyst"},
            "macrofx":  {"es": "Analista macro/divisas", "en": "Macro/FX analyst"},
            "flows":    {"es": "Analista de flujos",    "en": "Flows analyst"},
            "news":     {"es": "Analista de noticias",  "en": "News analyst"},
        }
        div_txt = {
            "narrow_leadership": {
                "es": "El índice subió con amplitud negativa: liderazgo estrecho, un avance que descansa en pocos nombres.",
                "en": "The index rose on negative breadth: narrow leadership, an advance resting on few names."},
            "megacap_carry": {
                "es": "Las mega-caps cargaron con el índice: la acción promedio quedó claramente detrás del benchmark.",
                "en": "Mega-caps carried the index: the average stock clearly lagged the benchmark."},
            "shrugged_bad_news": {
                "es": "El mercado subió pese a un flujo de noticias negativo — demanda subyacente sólida.",
                "en": "The market rose despite negative news flow — solid underlying demand."},
            "faded_good_news": {
                "es": "El mercado cayó pese a noticias favorables — oferta latente y expectativas descontadas.",
                "en": "The market fell despite favorable news — latent supply and discounted expectations."},
            "sell_the_news": {
                "es": "Varios resultados por encima del consenso fueron vendidos: expectativas exigentes en precios.",
                "en": "Several above-consensus prints were sold: demanding expectations in prices."},
            "defensive_undertone": {
                "es": "El índice subió pero con liderazgo defensivo: trasfondo de cautela bajo la superficie.",
                "en": "The index rose but with defensive leadership: a cautious undertone beneath the surface."},
            "dollar_equity_both_up": {
                "es": "Dólar y acciones subieron a la vez: patrón de entrada de capital hacia activos de EE.UU.",
                "en": "Dollar and equities rose together: a capital-inflow pattern into U.S. assets."},
            "smallcap_lag": {
                "es": "Las small caps quedaron muy rezagadas: el apetito por riesgo no llegó a la parte baja del mercado.",
                "en": "Small caps lagged badly: risk appetite did not reach the lower tiers of the market."},
            "breadth_confirms": {
                "es": "La amplitud confirmó la dirección del índice: el movimiento tiene respaldo interno.",
                "en": "Breadth confirmed the index's direction: the move has internal support."},
        }
        driver_txts = []
        for d in C["drivers"]:
            if d["id"] == "news_theme":
                t = d["theme"]
                driver_txts.append(
                    (f"El tema informativo dominante: {t['labels']['es']} "
                     f"({t['count']} menciones, sentimiento {t['avg_sentiment']:+.2f}).") if es else
                    (f"The dominant news theme: {t['labels']['en']} "
                     f"({t['count']} mentions, sentiment {t['avg_sentiment']:+.2f})."))
            elif d["id"] == "earnings_season":
                driver_txts.append(
                    (f"La temporada de resultados ({_pctu(d['beat_rate'], 0) if d['beat_rate'] is not None else 'n/d'} de beats, "
                     f"reacción media {_pct(d['avg_reaction']) if d['avg_reaction'] is not None else 'n/d'}).") if es else
                    (f"Earnings season ({_pctu(d['beat_rate'], 0) if d['beat_rate'] is not None else 'n/a'} beats, "
                     f"average reaction {_pct(d['avg_reaction']) if d['avg_reaction'] is not None else 'n/a'})."))
            elif d["id"] == "sector_rotation":
                driver_txts.append(
                    (f"La rotación sectorial (spread cíclicos−defensivos de {_pct(d['spread'])}).") if es else
                    (f"Sector rotation (cyclical−defensive spread of {_pct(d['spread'])})."))
            elif d["id"] == "rates_move":
                driver_txts.append(
                    (f"El movimiento de tasas: {d['bps']:+.0f} pb en el Tesoro a 10 años.") if es else
                    (f"The rates move: {d['bps']:+.0f} bps in the 10-year Treasury."))
            elif d["id"] == "dollar_move":
                driver_txts.append(
                    (f"El dólar ({_pct(d['usd'])} frente a majors).") if es else
                    (f"The dollar ({_pct(d['usd'])} vs. majors)."))
            elif d["id"] == "volatility":
                driver_txts.append(
                    (f"El régimen de volatilidad (VIX {_pct(d['vix']['chg_pct'])} hasta {d['vix']['level']:.1f}).") if es else
                    (f"The volatility regime (VIX {_pct(d['vix']['chg_pct'])} to {d['vix']['level']:.1f})."))

        paras = []
        if es:
            paras.append(
                f"Los siete analistas del consejo neuronal arrojaron un consenso de {C['consensus']:+.0f} "
                f"(escala -100/+100) con una dispersión de {C['dispersion']:.0f} puntos: "
                + ("una lectura homogénea, con la mayoría de los modelos apuntando en la misma dirección."
                   if C["dispersion"] < 25 else
                   "una lectura fragmentada — los modelos discrepan y conviene ponderar las divergencias tanto como el consenso."))
            if driver_txts:
                paras.append("Ordenados por impacto estimado, los motores de la semana fueron: "
                             + " ".join(f"({i+1}) {t}" for i, t in enumerate(driver_txts)))
        else:
            paras.append(
                f"The seven analysts of the neural council produced a consensus of {C['consensus']:+.0f} "
                f"(-100/+100 scale) with a dispersion of {C['dispersion']:.0f} points: "
                + ("a homogeneous read, with most models pointing the same way."
                   if C["dispersion"] < 25 else
                   "a fragmented read — the models disagree, and the divergences deserve as much weight as the consensus."))
            if driver_txts:
                paras.append("Ranked by estimated impact, the week's drivers were: "
                             + " ".join(f"({i+1}) {t}" for i, t in enumerate(driver_txts)))
        sections.append({
            "id": "synthesis",
            "title": ("Síntesis del consejo neuronal" if es else "Neural council synthesis"),
            "paragraphs": paras,
            "analysts": [{"id": m["id"], "name": member_names[m["id"]][lang],
                          "score": m["score"], "confidence": m["confidence"]}
                         for m in C["members"]],
            "consensus": C["consensus"], "dispersion": C["dispersion"],
            "regime": {"id": C["regime"], "label": regime_txt[0],
                       "description": regime_txt[1]},
            "divergences": [div_txt[d["id"]][lang] for d in C["divergences"]
                            if d["id"] in div_txt],
            "drivers": driver_txts,
        })

        # ---- Executive summary & takeaways -------------------------------------
        exec_paras = []
        if es:
            e1 = (f"{_week_label(ws, we, lang)}. El S&P 500 {dir_word} {_pct(spx_ret)} en un contexto "
                  f"de {regime_txt[0].lower()}. {regime_txt[1]}")
            exec_paras.append(e1)
            e2_bits = []
            if S["table"]:
                e2_bits.append(f"la rotación favoreció a {S['table'][0]['labels']['es'].lower()} "
                               f"({_pct(S['table'][0]['ret_pct'])}) y castigó a "
                               f"{S['table'][-1]['labels']['es'].lower()} ({_pct(S['table'][-1]['ret_pct'])})")
            if B.get("pct_up") is not None:
                e2_bits.append(f"la amplitud fue del {_pctu(B['pct_up'], 0)}")
            if E["beat_rate"] is not None:
                e2_bits.append(f"el {_pctu(E['beat_rate'], 0)} de los reportes del S&P 500 superó estimaciones")
            if e2_bits:
                exec_paras.append("En los internos, " + "; ".join(e2_bits) + ".")
            e3_bits = []
            if abs(usd) > 0.1:
                e3_bits.append(f"el dólar {'se fortaleció' if usd > 0 else 'se debilitó'} {_pctu(abs(usd))}")
            if X["tnx_bps"] is not None:
                e3_bits.append(f"la tasa a 10 años se movió {X['tnx_bps']:+.0f} pb")
            if N["themes"]:
                e3_bits.append(f"el flujo informativo giró en torno a {N['themes'][0]['labels']['es'].lower()}")
            e3 = ("En el plano global, " + "; ".join(e3_bits) + ". " if e3_bits else "")
            e3 += (f"El consejo neuronal cierra la semana con un consenso de {C['consensus']:+.0f}/100 "
                   f"y {len(C['divergences'])} divergencia(s) señalada(s).")
            exec_paras.append(e3)
        else:
            e1 = (f"{_week_label(ws, we, lang)}. The S&P 500 {dir_word} {_pct(spx_ret)} in a "
                  f"{regime_txt[0].lower()} environment. {regime_txt[1]}")
            exec_paras.append(e1)
            e2_bits = []
            if S["table"]:
                e2_bits.append(f"rotation favored {S['table'][0]['labels']['en']} "
                               f"({_pct(S['table'][0]['ret_pct'])}) and punished "
                               f"{S['table'][-1]['labels']['en']} ({_pct(S['table'][-1]['ret_pct'])})")
            if B.get("pct_up") is not None:
                e2_bits.append(f"breadth ran at {_pctu(B['pct_up'], 0)}")
            if E["beat_rate"] is not None:
                e2_bits.append(f"{_pctu(E['beat_rate'], 0)} of S&P 500 prints beat estimates")
            if e2_bits:
                exec_paras.append("Under the hood, " + "; ".join(e2_bits) + ".")
            e3_bits = []
            if abs(usd) > 0.1:
                e3_bits.append(f"the dollar {'firmed' if usd > 0 else 'softened'} {_pctu(abs(usd))}")
            if X["tnx_bps"] is not None:
                e3_bits.append(f"the 10-year yield moved {X['tnx_bps']:+.0f} bps")
            if N["themes"]:
                e3_bits.append(f"news flow revolved around {N['themes'][0]['labels']['en'].lower()}")
            e3 = ("Globally, " + "; ".join(e3_bits) + ". " if e3_bits else "")
            e3 += (f"The neural council closes the week with a consensus of {C['consensus']:+.0f}/100 "
                   f"and {len(C['divergences'])} flagged divergence(s).")
            exec_paras.append(e3)

        takeaways = []
        for i in M["indices"][:1]:
            takeaways.append(f"{i['labels'][lang]}: {_pct(i['ret_pct'])}")
        if best_sec and worst_sec:
            takeaways.append(
                (f"Mejor sector: {best_sec['labels']['es']} ({_pct(best_sec['ret_pct'])}) · "
                 f"peor: {worst_sec['labels']['es']} ({_pct(worst_sec['ret_pct'])})") if es else
                (f"Best sector: {best_sec['labels']['en']} ({_pct(best_sec['ret_pct'])}) · "
                 f"worst: {worst_sec['labels']['en']} ({_pct(worst_sec['ret_pct'])})"))
        if B.get("pct_up") is not None:
            takeaways.append(
                (f"Amplitud: {B['advancers']} suben / {B['decliners']} bajan "
                 f"({_pctu(B['pct_up'], 0)} positivo)") if es else
                (f"Breadth: {B['advancers']} up / {B['decliners']} down "
                 f"({_pctu(B['pct_up'], 0)} positive)"))
        if E["beat_rate"] is not None:
            takeaways.append(
                (f"Earnings S&P 500: {E['with_eps']} reportes, {_pctu(E['beat_rate'], 0)} de beats") if es else
                (f"S&P 500 earnings: {E['with_eps']} prints, {_pctu(E['beat_rate'], 0)} beats"))
        takeaways.append(
            (f"Dólar {_pct(usd)} vs. majors" + (f" · 10 años {X['tnx_bps']:+.0f} pb" if X["tnx_bps"] is not None else "")) if es else
            (f"Dollar {_pct(usd)} vs. majors" + (f" · 10-yr {X['tnx_bps']:+.0f} bps" if X["tnx_bps"] is not None else "")))
        takeaways.append(
            (f"Régimen: {regime_txt[0]} · consenso del consejo {C['consensus']:+.0f}/100") if es else
            (f"Regime: {regime_txt[0]} · council consensus {C['consensus']:+.0f}/100"))

        # ---- KPI strip ----------------------------------------------------------
        kpis = []
        if M["indices"]:
            kpis.append({"id": "spx", "label": "S&P 500",
                         "value": _pct(spx_ret),
                         "tone": "up" if spx_ret > 0 else "down" if spx_ret < 0 else "flat"})
        if B.get("pct_up") is not None:
            kpis.append({"id": "breadth", "label": "Amplitud" if es else "Breadth",
                         "value": _pctu(B["pct_up"], 0),
                         "tone": "up" if B["pct_up"] >= 55 else "down" if B["pct_up"] <= 45 else "flat"})
        if M["vix"]:
            kpis.append({"id": "vix", "label": "VIX",
                         "value": f"{M['vix']['level']:.1f}",
                         "delta": _pct(M["vix"]["chg_pct"]),
                         "tone": "down" if M["vix"]["chg_pct"] > 5 else "up" if M["vix"]["chg_pct"] < -5 else "flat"})
        kpis.append({"id": "usd", "label": "USD",
                     "value": _pct(usd),
                     "tone": "flat" if abs(usd) < 0.15 else ("up" if usd > 0 else "down")})
        if best_sec:
            kpis.append({"id": "best_sector",
                         "label": "Mejor sector" if es else "Best sector",
                         "value": best_sec["labels"][lang],
                         "delta": _pct(best_sec["ret_pct"]), "tone": "up"})
        if E["beat_rate"] is not None:
            kpis.append({"id": "beats", "label": "EPS beats",
                         "value": _pctu(E["beat_rate"], 0),
                         "tone": "up" if E["beat_rate"] >= 68 else "down" if E["beat_rate"] < 55 else "flat"})

        coverage = {
            "sp500_members_with_data": B.get("total", 0),
            "earnings_reports_sp500": E["sp_count"],
            "news_headlines": N["count"],
            "fx_pairs": len(X["fx"]),
            "nlp_engine": N["nlp_engine"],
        }
        return {
            "meta": {
                "week_start": ws, "week_end": we,
                "label": _week_label(ws, we, lang),
                "language": lang,
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "trading_days": M["trading_days"],
                "engine_version": self.version,
                "coverage": coverage,
                "warnings": raw["warnings"],
                "sources": ("Datos: Financial Modeling Prep. Sectores: SPDR Select Sector ETFs "
                            "(proxies). Este informe es generado por modelos cuantitativos y no "
                            "constituye una recomendación de inversión." if es else
                            "Data: Financial Modeling Prep. Sectors: SPDR Select Sector ETFs "
                            "(proxies). This report is generated by quantitative models and does "
                            "not constitute investment advice."),
            },
            "headline": headline,
            "dek": dek,
            "executive_summary": exec_paras,
            "key_takeaways": takeaways,
            "kpis": kpis,
            "sections": sections,
        }

    # ═══════════════════════════════════════════════════════════════════════
    #  Orchestration
    # ═══════════════════════════════════════════════════════════════════════
    def run_report(self, cfg: Dict[str, Any],
                   progress: Callable[[int, str], None]) -> Dict[str, Any]:
        ws, lang = cfg["week_start"], cfg["language"]
        we = (_d(ws) + timedelta(days=4)).isoformat()
        es = lang == "es"

        cache_key = (ws, lang)
        with _REPORT_CACHE_LOCK:
            cached = _REPORT_CACHE.get(cache_key)
        if cached:
            progress(95, "Informe recuperado de caché" if es else "Report served from cache")
            return cached

        if not self.api_key:
            raise RuntimeError("FMP_API_KEY no configurada en el backend" if es
                               else "FMP_API_KEY is not configured on the backend")

        raw = self.collect(ws, we, lang, progress)
        if not raw["bars"].get("^GSPC") and not raw["bars"].get("SPY"):
            raise RuntimeError(
                "No se pudieron obtener datos de mercado para esa semana (revisá la API key de FMP)"
                if es else
                "Could not fetch market data for that week (check the FMP API key)")

        progress(74, "El consejo neuronal está analizando la semana" if es
                 else "The neural council is analyzing the week")
        facts = self.analyze(raw, ws, we)

        progress(88, "Redactando el informe" if es else "Composing the report")
        report = self.compose(raw, facts, ws, we, lang)

        with _REPORT_CACHE_LOCK:
            _REPORT_CACHE[cache_key] = report
            # keep the cache bounded
            while len(_REPORT_CACHE) > 24:
                _REPORT_CACHE.pop(next(iter(_REPORT_CACHE)))
        return report


# ═══════════════════════════════════════════════════════════════════════════
#  Config normalization + module-level job API
# ═══════════════════════════════════════════════════════════════════════════

def _normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:
    ws_str = str(raw.get("week_start", "")).strip()[:10]
    try:
        ws = _d(ws_str)
    except ValueError:
        raise ValueError("week_start debe tener formato YYYY-MM-DD")
    if ws.weekday() != 0:
        raise ValueError("week_start debe ser un lunes (semana de lunes a viernes)")
    week_end = ws + timedelta(days=4)
    if week_end >= date.today():
        raise ValueError("Solo se pueden analizar semanas completas ya finalizadas")
    if ws < date(2000, 1, 3):
        raise ValueError("Semana demasiado antigua (mínimo: enero de 2000)")
    lang = str(raw.get("language", "es")).lower()
    if lang not in ("es", "en"):
        lang = "es"
    return {"week_start": ws.isoformat(), "language": lang}


_ENGINE: Optional[WeeklyReportEngine] = None


def get_weekly_report_engine() -> WeeklyReportEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = WeeklyReportEngine()
    return _ENGINE


def start_job(raw_config: Dict[str, Any]) -> str:
    """Create a job, generate the report on a background thread, return job_id."""
    _prune_jobs()
    cfg = _normalize_config(raw_config)
    job_id = uuid.uuid4().hex[:16]
    _set_job(job_id, status="queued", progress=0, stage="En cola",
             result=None, error=None, created_at=time.time())

    def _run() -> None:
        def progress(pct: int, stage: str) -> None:
            _set_job(job_id, status="running", progress=int(pct), stage=stage)
        try:
            engine = get_weekly_report_engine()
            result = engine.run_report(cfg, progress)
            _set_job(job_id, status="done", progress=100, stage="Listo", result=result)
        except Exception as e:  # noqa: BLE001
            logger.exception("[WeeklyReport] job %s failed", job_id)
            _set_job(job_id, status="error", error=str(e), stage="Error")

    threading.Thread(target=_run, daemon=True).start()
    return job_id
