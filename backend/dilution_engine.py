# backend/dilution_engine.py
# Dilution Tracking Engine — combina SEC EDGAR (filings, XBRL company facts)
# con FMP (cash trimestral, float, precios) para reconstruir el perfil de
# dilución de una compañía: shelfs, ATMs, equity lines, convertibles,
# offerings completados, historial de shares outstanding, cash runway y
# scores de riesgo de dilución.
#
# Fuentes:
#   - https://www.sec.gov/files/company_tickers.json        (ticker → CIK)
#   - https://data.sec.gov/submissions/CIK##########.json   (lista de filings)
#   - https://data.sec.gov/api/xbrl/companyfacts/CIK#.json  (XBRL facts)
#   - https://www.sec.gov/Archives/edgar/data/...           (documentos)
#   - FMP /stable: quote, shares-float, balance-sheet, cash-flow, prices

from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

logger = logging.getLogger(__name__)

SEC_HEADERS = {
    "User-Agent": "AnalizadorAcciones/1.0 (ignaciomart88@gmail.com)",
    "Accept-Encoding": "gzip, deflate",
}

_MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

# Formularios SEC relevantes
_SHELF_FORMS = {"S-3", "S-3/A", "S-3ASR", "F-3", "F-3/A", "F-3ASR", "S-3MEF", "F-3MEF"}
_PROSPECTUS_FORMS = {"424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8"}
_REGISTRATION_FORMS = {"S-1", "S-1/A", "F-1", "F-1/A"}

# Presupuesto de descargas de documentos por análisis (cortesía con SEC)
_MAX_SHELF_DOCS = 6
_MAX_PROSPECTUS_DOCS = 16
_DOC_MAX_BYTES = 1_500_000
_SEC_REQUEST_DELAY = 0.12  # ~8 req/s, debajo del límite de 10/s de SEC

# Bancos / placement agents conocidos (small-cap dilution underwriters)
_KNOWN_BANKS = [
    "H.C. Wainwright", "Aegis Capital", "Maxim Group", "Roth Capital",
    "ThinkEquity", "A.G.P.", "Alliance Global Partners", "EF Hutton",
    "Titan Partners", "Craig-Hallum", "Canaccord", "B. Riley", "Jefferies",
    "Cantor Fitzgerald", "Leerink", "Oppenheimer", "Piper Sandler",
    "Goldman Sachs", "Morgan Stanley", "J.P. Morgan", "JPMorgan",
    "BofA Securities", "Citigroup", "Wells Fargo", "Truist", "Stifel",
    "Needham", "Lake Street", "Benchmark Company", "Northland",
    "Dawson James", "Univest", "Spartan Capital", "Joseph Gunnar",
    "Laidlaw", "Ladenburg Thalmann", "BTIG", "Cowen", "TD Cowen",
    "Evercore", "Guggenheim", "Raymond James", "RBC Capital", "UBS",
    "Barclays", "Deutsche Bank", "Macquarie", "Mizuho", "William Blair",
    "JMP Securities", "Wedbush", "Chardan", "Brookline Capital",
    "Newbridge Securities", "Boustead Securities", "Prime Number Capital",
    "US Tiger Securities", "Kingswood", "Revere Securities", "WestPark Capital",
    "Rodman & Renshaw", "R.F. Lafferty", "ViewTrade", "BMO Capital",
    "Leede Financial", "Clear Street", "Lucid Capital", "D. Boral",
    "Seaport Global", "AC Sunshine",
]

# Firmas dedicadas a equity lines (ELOC) — su presencia + purchase agreement
# es señal fuerte de ELOC
_ELOC_PARTIES = [
    "Lincoln Park Capital", "B. Riley Principal Capital", "Keystone Capital",
    "White Lion Capital", "Tumim Stone Capital", "YA II PN", "Yorkville",
    "Ionic Ventures", "Arena Business", "Alumni Capital", "Triton Funds",
    "C/M Capital", "ClearThink", "Coventry Enterprises",
    "GHS Investments", "Mast Hill", "1800 Diagonal",
]

# Hedge funds que hacen PIPEs/registered directs/convertibles (no ELOCs):
# sirven para identificar tenedores, no para clasificar equity lines
_PIPE_FUNDS = [
    "Hudson Bay", "Anson Investments", "Sabby", "Armistice", "L1 Capital",
    "Helena Global", "Intracoastal Capital", "Bigger Capital", "District 2",
    "Alto Opportunity", "Ayrton Capital", "CVI Investments", "Heights Capital",
    "Empery", "Iroquois", "Lind Global", "3i, LP", "Streeterville",
]

# Cache simple en memoria (las llamadas SEC son costosas)
_CACHE: Dict[str, Tuple[float, Dict]] = {}
_CACHE_TTL = 15 * 60  # 15 minutos
_TICKER_MAP_CACHE: Dict[str, Any] = {"ts": 0.0, "map": {}}


def _now() -> float:
    return time.time()


def _fmt_name(date_str: str, suffix: str) -> str:
    """'2024-07-15', 'Convertible Notes' → 'July 2024 Convertible Notes'"""
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d")
        return f"{_MONTH_NAMES[d.month]} {d.year} {suffix}"
    except Exception:
        return suffix


def _parse_money(num: str, scale: Optional[str]) -> Optional[float]:
    try:
        val = float(num.replace(",", ""))
    except Exception:
        return None
    if scale:
        s = scale.lower()
        if s.startswith("billion"):
            val *= 1e9
        elif s.startswith("million"):
            val *= 1e6
    return val


def _find_money(text: str, patterns: List[str]) -> Optional[float]:
    """Busca el primer monto en dólares que matchee alguno de los patrones."""
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            scale = m.group(2) if m.lastindex and m.lastindex >= 2 else None
            val = _parse_money(m.group(1), scale)
            if val and val > 1000:
                return val
    return None


def _find_bank(text: str, candidates: List[str]) -> Optional[str]:
    best: Optional[Tuple[int, str]] = None
    for bank in candidates:
        idx = text.find(bank)
        if idx == -1:
            idx = text.lower().find(bank.lower())
        if idx != -1 and (best is None or idx < best[0]):
            best = (idx, bank)
    return best[1] if best else None


class DilutionEngine:
    """Motor de análisis de dilución basado en SEC EDGAR + FMP."""

    def __init__(self, fmp_api_key: str) -> None:
        self.fmp_api_key = fmp_api_key or ""
        self._last_sec_request = 0.0

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    def _sec_get(self, url: str, timeout: int = 25) -> Optional[requests.Response]:
        if not REQUESTS_AVAILABLE:
            return None
        # throttle: SEC pide <10 req/s
        elapsed = _now() - self._last_sec_request
        if elapsed < _SEC_REQUEST_DELAY:
            time.sleep(_SEC_REQUEST_DELAY - elapsed)
        try:
            resp = requests.get(url, headers=SEC_HEADERS, timeout=timeout)
            self._last_sec_request = _now()
            if resp.ok:
                return resp
            logger.warning("[Dilution] SEC %s → HTTP %s", url, resp.status_code)
        except Exception as e:
            logger.warning("[Dilution] SEC fetch error %s: %s", url, e)
        return None

    def _sec_json(self, url: str) -> Optional[Dict]:
        resp = self._sec_get(url)
        if resp is None:
            return None
        try:
            return resp.json()
        except Exception:
            return None

    def _fmp_json(self, path: str, params: str = "") -> Any:
        if not REQUESTS_AVAILABLE or not self.fmp_api_key:
            return None
        url = f"https://financialmodelingprep.com/stable/{path}?{params}&apikey={self.fmp_api_key}"
        try:
            resp = requests.get(url, timeout=20)
            if resp.ok:
                return resp.json()
        except Exception as e:
            logger.warning("[Dilution] FMP %s error: %s", path, e)
        return None

    # ------------------------------------------------------------------
    # SEC: ticker → CIK
    # ------------------------------------------------------------------
    def _get_cik(self, ticker: str) -> Optional[int]:
        global _TICKER_MAP_CACHE
        if _now() - _TICKER_MAP_CACHE["ts"] > 24 * 3600 or not _TICKER_MAP_CACHE["map"]:
            data = self._sec_json("https://www.sec.gov/files/company_tickers.json")
            if data:
                tmap = {}
                for entry in data.values():
                    tmap[str(entry.get("ticker", "")).upper()] = int(entry.get("cik_str", 0))
                _TICKER_MAP_CACHE = {"ts": _now(), "map": tmap}
        return _TICKER_MAP_CACHE["map"].get(ticker.upper())

    # ------------------------------------------------------------------
    # SEC: XBRL company facts
    # ------------------------------------------------------------------
    @staticmethod
    def _latest_fact(facts: Dict, taxonomy: str, tag: str,
                     max_age_days: int = 600) -> Optional[Dict]:
        """Devuelve el fact instantáneo más reciente {end, val}."""
        try:
            units = facts["facts"][taxonomy][tag]["units"]
        except (KeyError, TypeError):
            return None
        best = None
        cutoff = (datetime.utcnow() - timedelta(days=max_age_days)).strftime("%Y-%m-%d")
        for vals in units.values():
            for item in vals:
                end = item.get("end", "")
                if not end or end < cutoff:
                    continue
                key = (end, item.get("filed", ""))
                if best is None or key > (best["end"], best.get("filed", "")):
                    best = item
        return best

    @staticmethod
    def _shares_history_from_facts(facts: Dict, max_points: int = 44) -> List[Dict]:
        """Historial de shares outstanding (cover pages de 10-K/10-Q), as-reported."""
        try:
            units = facts["facts"]["dei"]["EntityCommonStockSharesOutstanding"]["units"]
        except (KeyError, TypeError):
            return []
        by_end: Dict[str, Dict] = {}
        for vals in units.values():
            for item in vals:
                end = item.get("end")
                val = item.get("val")
                if not end or not isinstance(val, (int, float)) or val <= 0:
                    continue
                prev = by_end.get(end)
                if prev is None or item.get("filed", "") > prev.get("filed", ""):
                    by_end[end] = item
        history = [
            {"date": end, "shares": int(item["val"])}
            for end, item in sorted(by_end.items())
        ]
        return history[-max_points:]

    # ------------------------------------------------------------------
    # SEC: documentos de filings
    # ------------------------------------------------------------------
    def _fetch_filing_text(self, cik: int, accession: str, primary_doc: str) -> str:
        accn = accession.replace("-", "")
        url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn}/{primary_doc}"
        resp = self._sec_get(url)
        if resp is None:
            return ""
        html = resp.text[:_DOC_MAX_BYTES]
        # strip básico de HTML
        html = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", html)
        text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#8217;", "'")
        text = re.sub(r"\s+", " ", text)
        return text

    def _fetch_ex107_capacity(self, cik: int, accession: str) -> Optional[float]:
        """Desde 2022 la fee table vive en el exhibit 107 (EX-FILING FEES),
        no en el prospecto. Busca 'Maximum Aggregate Offering Price' ahí."""
        accn = accession.replace("-", "")
        idx = self._sec_json(f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn}/index.json")
        if not idx:
            return None
        for item in idx.get("directory", {}).get("item", []):
            name = str(item.get("name", "")).lower()
            if not re.search(r"(ex[\-_.]?107(?!\d)|filingfee)", name):
                continue
            if not name.endswith((".htm", ".html", ".txt")):
                continue
            text = self._fetch_filing_text(cik, accession, item["name"])
            if not text:
                continue
            cap = _find_money(text, [
                r"maximum aggregate offering price[^$]{0,300}\$([\d,]+(?:\.\d+)?)",
            ])
            if cap:
                return cap
            # fallback: el monto más grande del exhibit (suele ser el total)
            amounts = [
                _parse_money(m.group(1), None)
                for m in re.finditer(r"\$\s?([\d,]{7,}(?:\.\d+)?)", text)
            ]
            amounts = [a for a in amounts if a and a >= 1_000_000]
            if amounts:
                return max(amounts)
        return None

    @staticmethod
    def _edgar_index_url(cik: int, accession: str) -> str:
        accn = accession.replace("-", "")
        return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn}/{accession}-index.htm"

    # ------------------------------------------------------------------
    # Clasificación de prospectos 424B
    # ------------------------------------------------------------------
    def _classify_prospectus(self, text: str, filing: Dict, cik: int) -> Optional[Dict]:
        low = text.lower()
        base = {
            "fileDate": filing["filingDate"],
            "formType": filing["form"],
            "edgarUrl": self._edgar_index_url(cik, filing["accessionNumber"]),
        }

        # ATM: frase fuerte "at-the-market offering" + un agreement de ventas.
        # Se evalúa primero porque el boilerplate "convertible" aparece en casi
        # todos los prospectos y no debe bloquear la detección de ATMs.
        is_atm = bool(
            re.search(r"at[\s‐-]the[\s‐-]market offering", low)
            and re.search(r"(sales|equity distribution|distribution|open market sale[s]?) agreement", low)
        )
        # Convertible: requiere el bigrama específico + precio de conversión o
        # principal agregado (el boilerplate genérico no los tiene juntos).
        is_convert = bool(
            re.search(r"convertible (?:senior |promissory |secured |subordinated )?(?:notes?|debentures?)", low)
            and ("conversion price of $" in low or re.search(r"aggregate principal amount of \$", low))
        ) and not is_atm
        is_eloc = bool(
            ("equity line" in low or "committed equity" in low
             or "equity purchase agreement" in low
             or (any(p.lower() in low for p in _ELOC_PARTIES) and "purchase agreement" in low))
        ) and not is_atm and not is_convert

        if is_atm:
            capacity = _find_money(text, [
                r"aggregate offering price of up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*(?:of (?:our|shares))",
                r"maximum aggregate offering price of \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"having an aggregate (?:gross sales|offering) price of up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
            ])
            agent = _find_bank(text, _KNOWN_BANKS)
            return {
                **base,
                "category": "atm",
                "name": _fmt_name(filing["filingDate"], f"{agent} ATM" if agent else "ATM"),
                "totalCapacity": capacity,
                "agent": agent,
                "agreementStartDate": filing["filingDate"],
            }

        if is_convert:
            principal = _find_money(text, [
                r"aggregate principal amount of (?:up to )?\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"\$([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*(?:in )?aggregate principal amount",
                r"original principal amount of \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"principal amount of (?:up to )?\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"\$([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*(?:of|in) (?:senior |secured )?convertible",
                r"convertible (?:promissory )?notes?[^.]{0,80}\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
            ])
            conv_price = None
            m = re.search(r"conversion price of \$([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
            if not m:
                m = re.search(r"conversion price (?:equal to|of)[^$]{0,60}\$([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
            if m:
                conv_price = _parse_money(m.group(1), None)
            # vencimiento: fecha completa si existe, año si no
            maturity = None
            m = re.search(
                r"(?:due|mature[s]? on|maturity date (?:of|is|will be))[^.]{0,40}?"
                r"([A-Z][a-z]+ \d{1,2}, (?:19|20)\d{2})", text)
            if m:
                try:
                    maturity = datetime.strptime(m.group(1), "%B %d, %Y").strftime("%Y-%m-%d")
                except Exception:
                    maturity = None
            if not maturity:
                m = re.search(r"(?:notes? due|due in|maturity (?:date )?(?:of|in))\s*((?:19|20)\d{2})", text, re.IGNORECASE)
                if m:
                    maturity = m.group(1)
            # acciones a emitir al convertir: explícito en el prospecto o derivado
            shares_converted = None
            for pat in (
                r"([\d,]{4,})\s+shares[^.]{0,100}?issuable upon (?:the )?conversion",
                r"(?:upon )?conversion of (?:the |our )?(?:convertible )?notes?[^.]{0,80}?(?:up to |aggregate of )?([\d,]{4,})\s+shares",
                r"up to ([\d,]{4,})\s+shares of (?:our )?common stock issuable upon conversion",
                r"resale of (?:up to )?([\d,]{4,})\s+shares[^.]{0,100}conver",
            ):
                m = re.search(pat, text, re.IGNORECASE)
                if m:
                    try:
                        shares_converted = int(m.group(1).replace(",", ""))
                        break
                    except Exception:
                        pass
            if shares_converted is None and principal and conv_price and conv_price > 0:
                shares_converted = int(principal / conv_price)
            if principal is None and shares_converted and conv_price:
                principal = shares_converted * conv_price
            return {
                **base,
                "category": "convertible",
                "name": _fmt_name(filing["filingDate"], "Convertible Notes"),
                "principalAmount": principal,
                "conversionPrice": conv_price,
                "sharesWhenConverted": shares_converted,
                "maturityDate": maturity,
                "issueDate": filing["filingDate"],
                "knownOwners": _find_bank(text, _PIPE_FUNDS + _ELOC_PARTIES),
            }

        if is_eloc:
            capacity = _find_money(text, [
                r"up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"aggregate (?:gross purchase|purchase) price of up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
            ])
            party = _find_bank(text, _ELOC_PARTIES) or _find_bank(text, _KNOWN_BANKS)
            return {
                **base,
                "category": "equityLine",
                "name": _fmt_name(filing["filingDate"], f"{party} Equity Line" if party else "Equity Line"),
                "totalCapacity": capacity,
                "counterparty": party,
                "agreementStartDate": filing["filingDate"],
            }

        # Offering "normal" (underwritten / placement / registered direct / units)
        shares = None
        m = re.search(r"(?:we are offering|offering of|offering)\s+(?:up to\s+)?(?:an aggregate of\s+)?([\d,]{4,})\s+shares", text, re.IGNORECASE)
        if not m:
            # fallback: descarta matches de "X shares ... outstanding" (capitalización)
            for cand in re.finditer(r"([\d,]{4,})\s+shares of (?:our )?common stock(.{0,40})", text, re.IGNORECASE):
                if not re.search(r"outstanding|issued", cand.group(2), re.IGNORECASE):
                    m = cand
                    break
        if m:
            try:
                shares = int(m.group(1).replace(",", ""))
            except Exception:
                shares = None
        price = None
        m = re.search(r"(?:offering|purchase|public offering) price of \$([\d,]+(?:\.\d+)?)\s*per", text, re.IGNORECASE)
        if not m:
            m = re.search(r"price (?:to the public )?of \$([\d,]+(?:\.\d+)?)\s*per share", text, re.IGNORECASE)
        if m:
            price = _parse_money(m.group(1), None)
        gross = _find_money(text, [
            r"gross proceeds (?:to us )?(?:of|will be) (?:approximately )?\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
            r"aggregate gross proceeds of (?:approximately )?\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
        ])
        warrants = None
        m = re.search(r"warrants to purchase (?:up to )?(?:an aggregate of )?([\d,]{4,})\s+shares", text, re.IGNORECASE)
        if m:
            try:
                warrants = int(m.group(1).replace(",", ""))
            except Exception:
                warrants = None
        warrant_px = None
        m = re.search(r"warrants?[^.]{0,160}?exercise price of \$([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
        if m:
            warrant_px = _parse_money(m.group(1), None)
        low2 = low
        if "registered direct" in low2:
            method = "Registered Direct"
        elif "best efforts" in low2:
            method = "Best Efforts"
        elif "placement agent" in low2:
            method = "Placement"
        elif "underwritten" in low2 or "underwriter" in low2:
            method = "Underwritten"
        else:
            method = "Offering"
        otype = "Units" if warrants else ("IPO" if filing["form"] == "424B4" else "Common Stock")
        if not (shares or gross or price):
            return None  # no pudimos extraer nada útil → descartar
        if gross is None and shares and price:
            gross = shares * price
        return {
            **base,
            "category": "offering",
            "type": otype,
            "method": method,
            "shares": shares,
            "price": price,
            "warrants": warrants,
            "warrantExercisePrice": warrant_px,
            "offeringAmount": gross,
            "bank": _find_bank(text, _KNOWN_BANKS),
            "date": filing["filingDate"],
        }

    # ------------------------------------------------------------------
    # Shelfs (S-3 / F-3)
    # ------------------------------------------------------------------
    def _build_shelfs(self, cik: int, filings: List[Dict],
                      shares_out: Optional[int], float_shares: Optional[int],
                      highest_60d_close: Optional[float]) -> List[Dict]:
        # EFFECT y withdrawals indexados por fileNumber
        effects: Dict[str, str] = {}
        withdrawals: Dict[str, str] = {}
        for f in filings:
            fn = f.get("fileNumber") or ""
            if not fn:
                continue
            if f["form"] == "EFFECT" and fn not in effects:
                effects[fn] = f["filingDate"]
            if f["form"] in ("RW", "AW") and fn not in withdrawals:
                withdrawals[fn] = f["filingDate"]

        base_shelfs = [f for f in filings if f["form"] in ("S-3", "F-3", "S-3ASR", "F-3ASR")]
        base_shelfs = base_shelfs[:_MAX_SHELF_DOCS]

        today = datetime.utcnow().strftime("%Y-%m-%d")
        results = []
        for f in base_shelfs:
            fn = f.get("fileNumber") or ""
            effect_date = effects.get(fn)
            if f["form"].endswith("ASR"):
                effect_date = effect_date or f["filingDate"]
            expiration = None
            if effect_date:
                try:
                    d = datetime.strptime(effect_date, "%Y-%m-%d")
                    expiration = (d + timedelta(days=3 * 365)).strftime("%Y-%m-%d")
                except Exception:
                    pass

            if fn in withdrawals:
                status = "Withdrawn"
            elif expiration and expiration < today:
                status = "Expired"
            elif effect_date:
                status = "Effective"
            else:
                status = "Filed / Pending"

            text = self._fetch_filing_text(cik, f["accessionNumber"], f.get("primaryDocument", ""))
            capacity = _find_money(text, [
                r"aggregate offering price of (?:the securities )?(?:registered hereby )?(?:up to )?\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"aggregate (?:initial )?offering price[^$.]{0,80}\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*(?:of|in) (?:the )?(?:securities|aggregate|our)",
                r"maximum aggregate offering price[^$]{0,60}\$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"\$([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*aggregate offering price",
                r"offer and sell[^$.]{0,200}up to \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
                r"shall not exceed \$([\d,]+(?:\.\d+)?)\s*(million|billion)?",
            ]) if text else None
            if capacity is None:
                capacity = self._fetch_ex107_capacity(cik, f["accessionNumber"])

            # Baby shelf (Instruction I.B.6): float pública < $75M
            float_value = None
            baby_shelf = None
            price_to_exceed = None
            ib6_third = None
            if float_shares and highest_60d_close:
                float_value = float_shares * highest_60d_close
                baby_shelf = float_value < 75_000_000
                ib6_third = float_value / 3.0
                price_to_exceed = 75_000_000 / float_shares

            results.append({
                "category": "shelf",
                "name": _fmt_name(f["filingDate"], "Shelf"),
                "formType": f["form"],
                "status": status,
                "totalShelfCapacity": capacity,
                "babyShelfRestriction": baby_shelf,
                "outstandingShares": shares_out,
                "float": float_shares,
                "highest60DayClose": highest_60d_close,
                "priceToExceedBabyShelf": price_to_exceed,
                "ib6FloatValue": ib6_third,
                "fileDate": f["filingDate"],
                "effectDate": effect_date,
                "expirationDate": expiration,
                "fileNumber": fn,
                "edgarUrl": self._edgar_index_url(cik, f["accessionNumber"]),
            })
        return results

    # ------------------------------------------------------------------
    # FMP: cash position & burn
    # ------------------------------------------------------------------
    def _build_cash_position(self, ticker: str) -> Dict:
        bs = self._fmp_json("balance-sheet-statement", f"symbol={ticker}&period=quarter&limit=24")
        cf = self._fmp_json("cash-flow-statement", f"symbol={ticker}&period=quarter&limit=24")
        bs = bs if isinstance(bs, list) else []
        cf = cf if isinstance(cf, list) else []

        quarters = []
        for row in reversed(bs):  # más viejo → más nuevo
            cash = row.get("cashAndShortTermInvestments")
            if cash is None:
                cash = (row.get("cashAndCashEquivalents") or 0) + (row.get("shortTermInvestments") or 0)
            quarters.append({"date": row.get("date"), "cash": cash})

        opcf_by_date = {}
        for row in cf:
            v = row.get("operatingCashFlow")
            if v is None:
                v = row.get("netCashProvidedByOperatingActivities")
            if row.get("date"):
                opcf_by_date[row["date"]] = v

        opcf_series = [opcf_by_date.get(q["date"]) for q in quarters]
        recent_opcf = [v for v in opcf_series[-4:] if isinstance(v, (int, float))]
        avg_q_opcf = sum(recent_opcf) / len(recent_opcf) if recent_opcf else None
        last_opcf = next((v for v in reversed(opcf_series) if isinstance(v, (int, float))), None)

        last_cash = quarters[-1]["cash"] if quarters else None
        last_date = quarters[-1]["date"] if quarters else None

        est_current_cash = None
        months_left = None
        cash_flow_positive = bool(avg_q_opcf is not None and avg_q_opcf >= 0)
        if last_cash is not None and last_date and avg_q_opcf is not None:
            try:
                d = datetime.strptime(last_date, "%Y-%m-%d")
                months_since = max(0.0, (datetime.utcnow() - d).days / 30.44)
                monthly_opcf = avg_q_opcf / 3.0
                est_current_cash = max(0.0, last_cash + months_since * monthly_opcf)
                if monthly_opcf < 0:
                    months_left = est_current_cash / abs(monthly_opcf)
            except Exception:
                pass

        return {
            "quarters": quarters,
            "lastReportedCash": last_cash,
            "lastReportDate": last_date,
            "lastQuarterOpCF": last_opcf,
            "avgQuarterlyOpCF": avg_q_opcf,
            "estimatedCurrentCash": est_current_cash,
            "monthsOfCashLeft": round(months_left, 1) if months_left is not None else None,
            "cashFlowPositive": cash_flow_positive,
        }

    # ------------------------------------------------------------------
    # Scores de riesgo (0-100, mayor = más riesgo de dilución)
    # ------------------------------------------------------------------
    @staticmethod
    def _label(score: float) -> str:
        if score >= 70:
            return "High"
        if score >= 40:
            return "Medium"
        return "Low"

    def _build_risk_scores(self, cash: Dict, shelfs: List[Dict], atms: List[Dict],
                           elocs: List[Dict], converts: List[Dict],
                           offerings: List[Dict], potential: Dict,
                           shares_out: Optional[int], shares_history: List[Dict],
                           price: Optional[float]) -> Dict:
        # 1) Cash need
        months = cash.get("monthsOfCashLeft")
        if cash.get("cashFlowPositive"):
            cash_need = 5.0
        elif months is None:
            cash_need = 50.0
        elif months < 6:
            cash_need = 95.0
        elif months < 12:
            cash_need = 80.0
        elif months < 18:
            cash_need = 62.0
        elif months < 24:
            cash_need = 45.0
        elif months < 36:
            cash_need = 30.0
        else:
            cash_need = 15.0

        # 2) Offering ability (instrumentos activos = capacidad de diluir ya)
        ability = 10.0
        active_shelf = any(s["status"] == "Effective" for s in shelfs)
        if active_shelf:
            ability += 30
        if atms:
            ability += 30
        if elocs:
            ability += 18
        if any(s.get("babyShelfRestriction") for s in shelfs if s["status"] == "Effective"):
            ability -= 12
        ability = max(0.0, min(100.0, ability))

        # 3) Overhead supply (dilución potencial vs O/S, ITM boost)
        overhead = 10.0
        total_potential = potential.get("totalPotentialShares") or 0
        if shares_out and total_potential:
            ratio = total_potential / shares_out
            overhead = min(100.0, ratio * 120.0)
            conv_prices = [c.get("conversionPrice") for c in converts if c.get("conversionPrice")]
            if price and conv_prices and any(cp <= price for cp in conv_prices):
                overhead = min(100.0, overhead + 15)

        # 4) Historical (frecuencia de offerings + crecimiento O/S)
        cutoff = (datetime.utcnow() - timedelta(days=3 * 365)).strftime("%Y-%m-%d")
        recent_offerings = [o for o in offerings if (o.get("date") or "") >= cutoff]
        n = len(recent_offerings)
        historical = {0: 10.0, 1: 35.0, 2: 55.0, 3: 70.0}.get(n, 85.0)
        dilution_1y = None
        if len(shares_history) >= 2 and shares_out:
            year_ago = (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
            older = [p for p in shares_history if p["date"] <= year_ago]
            ref = older[-1]["shares"] if older else shares_history[0]["shares"]
            if ref and ref > 0:
                dilution_1y = (shares_out / ref - 1.0) * 100.0
                if dilution_1y > 50:
                    historical = min(100.0, historical + 15)

        overall = 0.30 * cash_need + 0.20 * ability + 0.20 * overhead + 0.30 * historical

        def pack(score: float) -> Dict:
            return {"score": round(score), "label": self._label(score)}

        return {
            "overallRisk": pack(overall),
            "offeringAbility": pack(ability),
            "overheadSupply": pack(overhead),
            "historical": pack(historical),
            "cashNeed": pack(cash_need),
            "dilutionPct1Y": round(dilution_1y, 1) if dilution_1y is not None else None,
        }

    # ------------------------------------------------------------------
    # Análisis principal
    # ------------------------------------------------------------------
    def analyze(self, ticker: str) -> Dict:
        ticker = ticker.upper().strip()
        cached = _CACHE.get(ticker)
        if cached and _now() - cached[0] < _CACHE_TTL:
            return cached[1]

        if not REQUESTS_AVAILABLE:
            return {"error": "requests library not available on backend"}

        cik = self._get_cik(ticker)
        if not cik:
            return {"error": f"No se encontró CIK en SEC EDGAR para '{ticker}' (¿es un ticker de EE.UU.?)"}

        subs = self._sec_json(f"https://data.sec.gov/submissions/CIK{cik:010d}.json")
        if not subs:
            return {"error": f"No se pudieron obtener los filings SEC para {ticker}"}

        facts_resp = self._sec_get(
            f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", timeout=45)
        facts = {}
        if facts_resp is not None:
            try:
                facts = facts_resp.json()
            except Exception:
                facts = {}

        # --- FMP: quote, float, precios 60d ---
        quote = self._fmp_json("quote", f"symbol={ticker}")
        quote = quote[0] if isinstance(quote, list) and quote else (quote or {})
        price = quote.get("price")
        shares_out = quote.get("sharesOutstanding")

        float_data = self._fmp_json("shares-float", f"symbol={ticker}")
        float_data = float_data[0] if isinstance(float_data, list) and float_data else (float_data or {})
        float_shares = float_data.get("floatShares")
        if not shares_out:
            shares_out = float_data.get("outstandingShares")

        highest_60d = None
        hist = self._fmp_json("historical-price-eod/full", f"symbol={ticker}")
        if isinstance(hist, dict):
            hist = hist.get("historical", [])
        if isinstance(hist, list) and hist:
            closes = [row.get("close") for row in hist[:60] if isinstance(row.get("close"), (int, float))]
            if closes:
                highest_60d = max(closes)

        # --- Historial de shares outstanding (XBRL cover pages) ---
        shares_history = self._shares_history_from_facts(facts)
        if shares_out:
            today = datetime.utcnow().strftime("%Y-%m-%d")
            if not shares_history or shares_history[-1]["date"] < today:
                shares_history = shares_history + [{"date": today, "shares": int(shares_out), "current": True}]
        elif shares_history:
            shares_out = shares_history[-1]["shares"]

        # --- Dilución potencial desde XBRL ---
        warrants_fact = None
        for tag in ("ClassOfWarrantOrRightNumberOfSecuritiesCalledByWarrantsOrRights",
                    "ClassOfWarrantOrRightOutstanding",
                    "ClassOfWarrantOrRightNumberOfSecuritiesCalledByEachWarrantOrRight"):
            warrants_fact = self._latest_fact(facts, "us-gaap", tag, max_age_days=800)
            if warrants_fact and warrants_fact.get("val", 0) > 1000:
                break
            warrants_fact = None
        warrant_px_fact = self._latest_fact(
            facts, "us-gaap", "ClassOfWarrantOrRightExercisePriceOfWarrantsOrRights1", max_age_days=800)
        options_fact = self._latest_fact(
            facts, "us-gaap",
            "ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingNumber",
            max_age_days=800)
        options_px_fact = self._latest_fact(
            facts, "us-gaap",
            "ShareBasedCompensationArrangementByShareBasedPaymentAwardOptionsOutstandingWeightedAverageExercisePrice",
            max_age_days=800)
        rsu_fact = self._latest_fact(
            facts, "us-gaap",
            "ShareBasedCompensationArrangementByShareBasedPaymentAwardEquityInstrumentsOtherThanOptionsNonvestedNumber",
            max_age_days=800)
        conv_principal_fact = None
        for tag in ("ConvertibleNotesPayable", "ConvertibleDebt", "ConvertibleDebtNoncurrent",
                    "ConvertibleNotesPayableCurrent", "ConvertibleDebtCurrent"):
            conv_principal_fact = self._latest_fact(facts, "us-gaap", tag)
            if conv_principal_fact:
                break
        conv_price_fact = self._latest_fact(facts, "us-gaap", "DebtInstrumentConvertibleConversionPrice1")

        warrants_n = int(warrants_fact["val"]) if warrants_fact else None
        options_n = int(options_fact["val"]) if options_fact else None
        rsu_n = int(rsu_fact["val"]) if rsu_fact else None
        conv_shares_est = None
        if conv_principal_fact and conv_price_fact and conv_price_fact["val"]:
            try:
                conv_shares_est = int(conv_principal_fact["val"] / conv_price_fact["val"])
            except Exception:
                conv_shares_est = None
        potential = {
            "warrants": warrants_n,
            "warrantsExercisePrice": warrant_px_fact["val"] if warrant_px_fact else None,
            "options": options_n,
            "optionsExercisePrice": options_px_fact["val"] if options_px_fact else None,
            "rsus": rsu_n,
            "convertiblePrincipal": conv_principal_fact["val"] if conv_principal_fact else None,
            "convertiblePrice": conv_price_fact["val"] if conv_price_fact else None,
            "convertibleSharesEst": conv_shares_est,
            "totalPotentialShares": None,  # se completa tras parsear filings (fallbacks)
            "asOf": warrants_fact.get("end") if warrants_fact else None,
            "source": "xbrl",
        }

        # --- Filings recientes ---
        recent = subs.get("filings", {}).get("recent", {})
        keys = ["accessionNumber", "filingDate", "form", "primaryDocument", "fileNumber"]
        n_filings = len(recent.get("form", []))
        filings = [
            {k: (recent.get(k) or [None] * n_filings)[i] for k in keys}
            for i in range(n_filings)
        ]

        # --- Shelfs ---
        shelfs = self._build_shelfs(cik, filings, shares_out, float_shares, highest_60d)

        # --- Prospectos 424B → ATM / convertibles / equity lines / offerings ---
        prospectuses = [f for f in filings if f["form"] in _PROSPECTUS_FORMS][:_MAX_PROSPECTUS_DOCS]
        atms: List[Dict] = []
        converts: List[Dict] = []
        elocs: List[Dict] = []
        offerings: List[Dict] = []
        for f in prospectuses:
            if not f.get("primaryDocument"):
                continue
            text = self._fetch_filing_text(cik, f["accessionNumber"], f["primaryDocument"])
            if not text:
                continue
            item = self._classify_prospectus(text, f, cik)
            if not item:
                continue
            cat = item.pop("category")
            if cat == "atm":
                atms.append(item)
            elif cat == "convertible":
                converts.append(item)
            elif cat == "equityLine":
                elocs.append(item)
            else:
                offerings.append(item)

        # dedupe: prospecto preliminar + final del mismo deal (mismo banco,
        # fechas a <=10 días). filings vienen newest-first → conservamos el final.
        deduped: List[Dict] = []
        for o in offerings:
            try:
                d_o = datetime.strptime(o["date"], "%Y-%m-%d")
            except Exception:
                deduped.append(o)
                continue
            is_dup = False
            for kept in deduped:
                try:
                    d_k = datetime.strptime(kept["date"], "%Y-%m-%d")
                except Exception:
                    continue
                if kept.get("bank") == o.get("bank") and abs((d_k - d_o).days) <= 10:
                    is_dup = True
                    break
            if not is_dup:
                deduped.append(o)
        offerings = deduped

        # dedupe ATMs/ELOCs: amendments del mismo acuerdo (misma contraparte y
        # misma capacidad) aparecen como múltiples 424B — conservar el más nuevo
        def _dedupe_agreements(items: List[Dict], party_key: str) -> List[Dict]:
            seen = set()
            out = []
            for it in items:  # newest first
                key = (it.get(party_key), it.get("totalCapacity"))
                if key in seen:
                    continue
                seen.add(key)
                out.append(it)
            return out

        atms = _dedupe_agreements(atms, "agent")
        elocs = _dedupe_agreements(elocs, "counterparty")

        # marcar ATMs viejos como superseded (solo el más reciente se asume activo)
        for i, a in enumerate(atms):
            a["status"] = "Registered" if i == 0 else "Superseded"
        for e in elocs:
            e["status"] = "Registered"
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        for c in converts:
            mat = c.get("maturityDate") or ""
            matured = (len(mat) == 10 and mat < today_str) or (len(mat) == 4 and mat < today_str[:4])
            c["status"] = "Matured" if matured else "Registered"

        # Registros S-1/F-1 recientes (contexto)
        cutoff_2y = (datetime.utcnow() - timedelta(days=730)).strftime("%Y-%m-%d")
        registrations = [
            {
                "formType": f["form"],
                "fileDate": f["filingDate"],
                "edgarUrl": self._edgar_index_url(cik, f["accessionNumber"]),
            }
            for f in filings
            if f["form"] in _REGISTRATION_FORMS and f["filingDate"] >= cutoff_2y
        ][:6]

        # --- Fallbacks: si XBRL no trae warrants/converts, derivarlos de los filings ---
        cutoff_3y = (datetime.utcnow() - timedelta(days=3 * 365)).strftime("%Y-%m-%d")
        if not potential["warrants"]:
            offering_warrants = [
                o for o in offerings
                if o.get("warrants") and (o.get("date") or "") >= cutoff_3y
            ]
            total_w = sum(o["warrants"] for o in offering_warrants)
            if total_w:
                potential["warrants"] = total_w
                potential["source"] = "filings"
                px_list = [o["warrantExercisePrice"] for o in offering_warrants if o.get("warrantExercisePrice")]
                if px_list and not potential["warrantsExercisePrice"]:
                    potential["warrantsExercisePrice"] = sum(px_list) / len(px_list)
        if not potential["convertibleSharesEst"]:
            live_convert_shares = sum(
                c["sharesWhenConverted"] for c in converts
                if c.get("sharesWhenConverted") and c.get("status") != "Matured"
            )
            if live_convert_shares:
                potential["convertibleSharesEst"] = live_convert_shares
                potential["source"] = "filings" if potential["source"] == "xbrl" and not potential["warrants"] else potential["source"]
                if not potential["convertiblePrice"]:
                    px_list = [c["conversionPrice"] for c in converts
                               if c.get("conversionPrice") and c.get("status") != "Matured"]
                    if px_list:
                        potential["convertiblePrice"] = sum(px_list) / len(px_list)
        potential["totalPotentialShares"] = sum(
            v for v in (potential["warrants"], potential["options"], potential["rsus"],
                        potential["convertibleSharesEst"]) if v
        ) or None

        # --- Niveles de precio con dilución latente (overhead supply por precio) ---
        dilution_levels: List[Dict] = []
        for c in converts:
            if c.get("status") == "Matured" or not c.get("conversionPrice"):
                continue
            dilution_levels.append({
                "type": "convertible",
                "name": c["name"],
                "price": c["conversionPrice"],
                "shares": c.get("sharesWhenConverted"),
                "date": c.get("fileDate"),
            })
        seen_warrant_offerings = False
        for o in offerings:
            if o.get("warrants") and o.get("warrantExercisePrice") and (o.get("date") or "") >= cutoff_3y:
                seen_warrant_offerings = True
                dilution_levels.append({
                    "type": "warrant",
                    "name": _fmt_name(o["date"], f"Warrants ({o.get('bank') or 'offering'})"),
                    "price": o["warrantExercisePrice"],
                    "shares": o["warrants"],
                    "date": o.get("date"),
                })
        if not seen_warrant_offerings and potential["warrants"] and potential["warrantsExercisePrice"]:
            dilution_levels.append({
                "type": "warrant",
                "name": "Warrants (XBRL aggregate)",
                "price": potential["warrantsExercisePrice"],
                "shares": potential["warrants"],
                "date": potential.get("asOf"),
            })
        if potential["options"] and potential["optionsExercisePrice"]:
            dilution_levels.append({
                "type": "options",
                "name": "Stock options (avg. exercise price)",
                "price": potential["optionsExercisePrice"],
                "shares": potential["options"],
                "date": potential.get("asOf"),
            })
        for a in atms:
            if a.get("status") == "Registered":
                est_shares = int(a["totalCapacity"] / price) if (a.get("totalCapacity") and price) else None
                dilution_levels.append({
                    "type": "atm",
                    "name": a["name"],
                    "price": None,  # vende a precio de mercado
                    "shares": est_shares,
                    "date": a.get("fileDate"),
                })
        for e in elocs:
            est_shares = int(e["totalCapacity"] / price) if (e.get("totalCapacity") and price) else None
            dilution_levels.append({
                "type": "equityLine",
                "name": e["name"],
                "price": None,  # vende a precio de mercado (usualmente con descuento)
                "shares": est_shares,
                "date": e.get("fileDate"),
            })
        for lvl in dilution_levels:
            lvl["pctOfOS"] = round(lvl["shares"] / shares_out * 100, 1) if (lvl.get("shares") and shares_out) else None
            lvl["inTheMoney"] = (lvl["price"] is None) or (price is not None and lvl["price"] <= price)
        dilution_levels.sort(key=lambda x: (x["price"] is None, x["price"] or 0))

        # --- Capacidad disponible para diluir (estimada) ---
        effective_shelfs = [s for s in shelfs if s["status"] == "Effective"]
        shelf_remaining_total = None
        for s in effective_shelfs:
            cap = s.get("totalShelfCapacity")
            if not cap or not s.get("effectDate"):
                s["estimatedRemainingCapacity"] = None
                continue
            used = sum(
                o["offeringAmount"] for o in offerings
                if o.get("offeringAmount") and (o.get("date") or "") >= s["effectDate"]
            )
            s["estimatedRemainingCapacity"] = max(0.0, cap - used)
            shelf_remaining_total = (shelf_remaining_total or 0.0) + s["estimatedRemainingCapacity"]

        cutoff_12m = (datetime.utcnow() - timedelta(days=365)).strftime("%Y-%m-%d")
        raised_12m = sum(
            o["offeringAmount"] for o in offerings
            if o.get("offeringAmount") and (o.get("date") or "") >= cutoff_12m
        ) or None

        # --- Cash position ---
        cash = self._build_cash_position(ticker)

        # --- Baby shelf global ---
        baby_shelf = None
        if float_shares and highest_60d:
            fv = float_shares * highest_60d
            baby_shelf = {
                "isRestricted": fv < 75_000_000,
                "floatValue": fv,
                "highest60DayClose": highest_60d,
                "priceToExceedBabyShelf": 75_000_000 / float_shares,
                "maxRaisableIB6": fv / 3.0,
            }

        # --- Resumen: cuánto puede diluir ya mismo ---
        active_atm_capacity = sum(
            a["totalCapacity"] for a in atms
            if a.get("status") == "Registered" and a.get("totalCapacity")
        ) or None
        eloc_capacity = sum(e["totalCapacity"] for e in elocs if e.get("totalCapacity")) or None
        ib6_available = None
        if baby_shelf and baby_shelf["isRestricted"]:
            ib6_available = max(0.0, baby_shelf["maxRaisableIB6"] - (raised_12m or 0.0))
        available_to_dilute = {
            "shelfRemainingEst": shelf_remaining_total,
            "atmCapacity": active_atm_capacity,
            "equityLineCapacity": eloc_capacity,
            "raisedLast12Months": raised_12m,
            "ib6AvailableNow": ib6_available,  # tope real si hay baby shelf
            "babyShelfRestricted": bool(baby_shelf and baby_shelf["isRestricted"]),
        }

        # --- Risk scores ---
        risk = self._build_risk_scores(
            cash, shelfs, [a for a in atms if a.get("status") == "Registered"],
            elocs, converts, offerings, potential, shares_out, shares_history, price)

        result = {
            "ticker": ticker,
            "cik": cik,
            "companyName": subs.get("name"),
            "price": price,
            "sharesOutstanding": shares_out,
            "floatShares": float_shares,
            "riskScores": risk,
            "sharesHistory": shares_history,
            "potentialDilution": potential,
            "dilutionLevels": dilution_levels,
            "availableToDilute": available_to_dilute,
            "cashPosition": cash,
            "babyShelf": baby_shelf,
            "instruments": {
                "convertibleNotes": converts,
                "atms": atms,
                "equityLines": elocs,
                "shelfs": shelfs,
                "registrations": registrations,
            },
            "completedOfferings": offerings,
            "asOf": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
            "sources": ["SEC EDGAR (submissions, XBRL company facts, filing documents)", "FMP (quote, float, balance sheet, cash flow, prices)"],
        }
        _CACHE[ticker] = (_now(), result)
        return result


_ENGINE: Optional[DilutionEngine] = None


def get_dilution_engine(fmp_api_key: str) -> DilutionEngine:
    global _ENGINE
    if _ENGINE is None or _ENGINE.fmp_api_key != fmp_api_key:
        _ENGINE = DilutionEngine(fmp_api_key)
    return _ENGINE
