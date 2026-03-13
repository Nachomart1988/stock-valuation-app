# backend/supply_chain_engine.py
# Real Supply Chain Analysis Engine
# Uses curated relationships + FMP data + price correlation to map true supply chains

from __future__ import annotations
import logging
import numpy as np
import os
import requests
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timedelta
from collections import defaultdict

logger = logging.getLogger(__name__)

try:
    from scipy import stats as scipy_stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


# ══════════════════════════════════════════════════════════════════════
# CURATED SUPPLY CHAIN DATABASE
# Real-world supplier/customer relationships for major companies.
# Format: ticker → { suppliers: [(symbol, name, exposure_est%)], customers: [...] }
# ══════════════════════════════════════════════════════════════════════

KNOWN_SUPPLY_CHAINS: Dict[str, Dict[str, List[Tuple[str, str, float]]]] = {
    # ── TECHNOLOGY ──────────────────────────────────────────────────
    'AAPL': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 25.0), ('AVGO', 'Broadcom', 8.0),
            ('QCOM', 'Qualcomm', 6.0), ('TXN', 'Texas Instruments', 4.0),
            ('STM', 'STMicroelectronics', 3.5), ('SWKS', 'Skyworks Solutions', 5.0),
            ('CRUS', 'Cirrus Logic', 7.0), ('LRCX', 'Lam Research', 2.0),
            ('GLW', 'Corning Inc', 4.0), ('NXPI', 'NXP Semiconductors', 3.0),
        ],
        'customers': [
            ('VZ', 'Verizon', 5.0), ('T', 'AT&T', 5.0), ('TMUS', 'T-Mobile', 4.0),
            ('BBY', 'Best Buy', 8.0), ('AMZN', 'Amazon', 6.0),
        ],
    },
    'MSFT': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 5.0), ('NVDA', 'NVIDIA', 4.0),
            ('INTC', 'Intel', 3.0), ('AMD', 'AMD', 3.0),
            ('CRM', 'Salesforce', 2.0), ('ORCL', 'Oracle', 2.0),
        ],
        'customers': [
            ('AMZN', 'Amazon', 3.0), ('GOOGL', 'Alphabet', 2.0),
            ('JPM', 'JPMorgan Chase', 4.0), ('BAC', 'Bank of America', 3.0),
            ('WMT', 'Walmart', 3.0), ('UNH', 'UnitedHealth', 2.5),
        ],
    },
    'NVDA': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 30.0), ('AVGO', 'Broadcom', 5.0),
            ('MU', 'Micron Technology', 6.0), ('KLAC', 'KLA Corp', 2.0),
            ('LRCX', 'Lam Research', 2.5), ('ASML', 'ASML Holding', 3.0),
            ('AMKR', 'Amkor Technology', 4.0), ('MRVL', 'Marvell Tech', 3.0),
        ],
        'customers': [
            ('MSFT', 'Microsoft', 15.0), ('META', 'Meta Platforms', 10.0),
            ('AMZN', 'Amazon (AWS)', 12.0), ('GOOGL', 'Alphabet', 8.0),
            ('TSLA', 'Tesla', 5.0), ('ORCL', 'Oracle', 4.0),
        ],
    },
    'GOOGL': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 5.0), ('NVDA', 'NVIDIA', 4.0),
            ('AVGO', 'Broadcom', 3.0), ('MU', 'Micron Technology', 2.0),
        ],
        'customers': [
            ('WMT', 'Walmart', 2.0), ('AMZN', 'Amazon', 3.0),
            ('DIS', 'Walt Disney', 2.0), ('NFLX', 'Netflix', 1.5),
        ],
    },
    'META': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 5.0), ('NVDA', 'NVIDIA', 8.0),
            ('AVGO', 'Broadcom', 3.0), ('QCOM', 'Qualcomm', 2.5),
        ],
        'customers': [
            ('WMT', 'Walmart', 1.5), ('PG', 'Procter & Gamble', 2.0),
            ('AMZN', 'Amazon', 3.0), ('NKE', 'Nike', 1.5),
        ],
    },
    'AMZN': {
        'suppliers': [
            ('NVDA', 'NVIDIA', 5.0), ('INTC', 'Intel', 4.0),
            ('AMD', 'AMD', 3.0), ('UPS', 'United Parcel Service', 6.0),
            ('FDX', 'FedEx', 5.0), ('AVGO', 'Broadcom', 2.0),
        ],
        'customers': [
            ('PG', 'Procter & Gamble', 3.0), ('AAPL', 'Apple', 2.0),
            ('NKE', 'Nike', 2.5), ('KO', 'Coca-Cola', 1.5),
        ],
    },
    'TSLA': {
        'suppliers': [
            ('PCRFY', 'Panasonic (ADR)', 15.0), ('ALB', 'Albemarle', 8.0),
            ('SQM', 'SQM', 5.0), ('TSM', 'Taiwan Semiconductor', 4.0),
            ('NVDA', 'NVIDIA', 5.0), ('APTV', 'Aptiv', 3.5),
            ('ON', 'ON Semiconductor', 4.0), ('STLA', 'Stellantis', 2.0),
            ('NXPI', 'NXP Semiconductors', 3.0), ('STM', 'STMicroelectronics', 3.0),
        ],
        'customers': [
            ('HTZ', 'Hertz', 4.0), ('UBER', 'Uber', 2.0),
        ],
    },
    'AMD': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 35.0), ('ASML', 'ASML Holding', 3.0),
            ('KLAC', 'KLA Corp', 2.0), ('LRCX', 'Lam Research', 2.0),
        ],
        'customers': [
            ('MSFT', 'Microsoft', 10.0), ('AMZN', 'Amazon', 8.0),
            ('GOOGL', 'Alphabet', 5.0), ('META', 'Meta Platforms', 5.0),
            ('HPQ', 'HP Inc', 4.0), ('DELL', 'Dell Technologies', 4.0),
        ],
    },
    'CRM': {
        'suppliers': [
            ('AMZN', 'Amazon (AWS)', 10.0), ('GOOGL', 'Google Cloud', 5.0),
            ('MSFT', 'Microsoft Azure', 4.0),
        ],
        'customers': [
            ('JPM', 'JPMorgan Chase', 3.0), ('WMT', 'Walmart', 2.0),
            ('UNH', 'UnitedHealth', 2.0), ('AMZN', 'Amazon', 2.5),
        ],
    },
    # ── SEMICONDUCTORS ─────────────────────────────────────────────
    'TSM': {
        'suppliers': [
            ('ASML', 'ASML Holding', 15.0), ('LRCX', 'Lam Research', 8.0),
            ('KLAC', 'KLA Corp', 5.0), ('AMAT', 'Applied Materials', 7.0),
            ('ENTG', 'Entegris', 3.0),
        ],
        'customers': [
            ('AAPL', 'Apple', 25.0), ('NVDA', 'NVIDIA', 12.0),
            ('AMD', 'AMD', 8.0), ('QCOM', 'Qualcomm', 7.0),
            ('AVGO', 'Broadcom', 5.0), ('INTC', 'Intel', 4.0),
            ('MRVL', 'Marvell Tech', 3.0), ('META', 'Meta Platforms', 3.0),
        ],
    },
    'AVGO': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 20.0), ('ASML', 'ASML Holding', 3.0),
        ],
        'customers': [
            ('AAPL', 'Apple', 20.0), ('GOOGL', 'Alphabet', 5.0),
            ('MSFT', 'Microsoft', 4.0), ('CSCO', 'Cisco Systems', 5.0),
        ],
    },
    'INTC': {
        'suppliers': [
            ('ASML', 'ASML Holding', 10.0), ('LRCX', 'Lam Research', 6.0),
            ('AMAT', 'Applied Materials', 5.0), ('KLAC', 'KLA Corp', 4.0),
        ],
        'customers': [
            ('DELL', 'Dell Technologies', 8.0), ('HPQ', 'HP Inc', 7.0),
            ('MSFT', 'Microsoft', 5.0), ('AMZN', 'Amazon', 4.0),
            ('GOOGL', 'Alphabet', 3.0), ('LENOVO', 'Lenovo', 5.0),
        ],
    },
    'QCOM': {
        'suppliers': [
            ('TSM', 'Taiwan Semiconductor', 25.0), ('ASML', 'ASML Holding', 2.0),
        ],
        'customers': [
            ('AAPL', 'Apple', 20.0), ('SSNLF', 'Samsung', 15.0),
            ('GOOGL', 'Alphabet (Pixel)', 3.0),
        ],
    },
    # ── HEALTHCARE ─────────────────────────────────────────────────
    'UNH': {
        'suppliers': [
            ('CVS', 'CVS Health', 8.0), ('CI', 'Cigna Group', 5.0),
            ('CAH', 'Cardinal Health', 6.0), ('MCK', 'McKesson', 7.0),
            ('ABC', 'Cencora', 5.0), ('MSFT', 'Microsoft', 3.0),
        ],
        'customers': [
            ('HCA', 'HCA Healthcare', 5.0), ('THC', 'Tenet Healthcare', 3.0),
            ('WMT', 'Walmart (pharmacy)', 2.5),
        ],
    },
    'JNJ': {
        'suppliers': [
            ('TMO', 'Thermo Fisher', 5.0), ('DHR', 'Danaher', 4.0),
            ('CTVA', 'Corteva', 2.0), ('DD', 'DuPont', 3.0),
        ],
        'customers': [
            ('MCK', 'McKesson', 10.0), ('ABC', 'Cencora', 8.0),
            ('CAH', 'Cardinal Health', 7.0), ('CVS', 'CVS Health', 6.0),
            ('WBA', 'Walgreens', 5.0), ('WMT', 'Walmart', 3.0),
        ],
    },
    'PFE': {
        'suppliers': [
            ('TMO', 'Thermo Fisher', 5.0), ('DHR', 'Danaher', 4.0),
            ('A', 'Agilent Technologies', 3.0),
        ],
        'customers': [
            ('MCK', 'McKesson', 12.0), ('ABC', 'Cencora', 10.0),
            ('CAH', 'Cardinal Health', 8.0), ('CVS', 'CVS Health', 7.0),
            ('WBA', 'Walgreens', 5.0), ('UNH', 'UnitedHealth', 4.0),
        ],
    },
    'LLY': {
        'suppliers': [
            ('TMO', 'Thermo Fisher', 4.0), ('DHR', 'Danaher', 3.5),
            ('LONZA', 'Lonza Group', 5.0),
        ],
        'customers': [
            ('MCK', 'McKesson', 10.0), ('ABC', 'Cencora', 8.0),
            ('CAH', 'Cardinal Health', 7.0), ('CVS', 'CVS Health', 6.0),
            ('WBA', 'Walgreens', 4.0),
        ],
    },
    'ABBV': {
        'suppliers': [
            ('TMO', 'Thermo Fisher', 4.0), ('DHR', 'Danaher', 3.0),
            ('A', 'Agilent Technologies', 2.0),
        ],
        'customers': [
            ('MCK', 'McKesson', 11.0), ('ABC', 'Cencora', 9.0),
            ('CAH', 'Cardinal Health', 8.0), ('CVS', 'CVS Health', 6.0),
        ],
    },
    # ── FINANCIALS ─────────────────────────────────────────────────
    'JPM': {
        'suppliers': [
            ('MSFT', 'Microsoft', 4.0), ('CRM', 'Salesforce', 2.0),
            ('ORCL', 'Oracle', 3.0), ('IBM', 'IBM', 2.5),
            ('FIS', 'Fidelity Natl Info', 3.5), ('FISV', 'Fiserv', 3.0),
        ],
        'customers': [
            ('BLK', 'BlackRock', 3.0), ('BRK-B', 'Berkshire Hathaway', 2.0),
        ],
    },
    'V': {
        'suppliers': [
            ('MSFT', 'Microsoft', 3.0), ('IBM', 'IBM', 2.0),
            ('FIS', 'Fidelity Natl Info', 4.0),
        ],
        'customers': [
            ('JPM', 'JPMorgan Chase', 8.0), ('BAC', 'Bank of America', 7.0),
            ('WFC', 'Wells Fargo', 5.0), ('C', 'Citigroup', 4.0),
            ('SQ', 'Block (Square)', 3.0), ('PYPL', 'PayPal', 3.0),
        ],
    },
    'MA': {
        'suppliers': [
            ('MSFT', 'Microsoft', 3.0), ('IBM', 'IBM', 2.0),
        ],
        'customers': [
            ('JPM', 'JPMorgan Chase', 7.0), ('BAC', 'Bank of America', 6.0),
            ('C', 'Citigroup', 5.0), ('WFC', 'Wells Fargo', 4.0),
            ('SQ', 'Block (Square)', 3.0), ('PYPL', 'PayPal', 3.0),
        ],
    },
    # ── CONSUMER ───────────────────────────────────────────────────
    'WMT': {
        'suppliers': [
            ('PG', 'Procter & Gamble', 10.0), ('KO', 'Coca-Cola', 5.0),
            ('PEP', 'PepsiCo', 5.0), ('UL', 'Unilever', 4.0),
            ('KHC', 'Kraft Heinz', 4.0), ('CL', 'Colgate-Palmolive', 3.0),
            ('GIS', 'General Mills', 3.0), ('K', 'Kellanova', 2.5),
        ],
        'customers': [],
    },
    'KO': {
        'suppliers': [
            ('BLL', 'Ball Corp', 6.0), ('IP', 'International Paper', 3.0),
            ('ADM', 'Archer-Daniels-Midland', 4.0),
        ],
        'customers': [
            ('WMT', 'Walmart', 12.0), ('MCD', 'McDonald\'s', 8.0),
            ('COST', 'Costco', 5.0), ('KR', 'Kroger', 4.0),
            ('YUM', 'Yum! Brands', 3.0), ('SBUX', 'Starbucks', 2.0),
        ],
    },
    'PG': {
        'suppliers': [
            ('ADM', 'Archer-Daniels-Midland', 3.0),
            ('DOW', 'Dow Inc', 4.0), ('IP', 'International Paper', 3.0),
        ],
        'customers': [
            ('WMT', 'Walmart', 15.0), ('COST', 'Costco', 7.0),
            ('TGT', 'Target', 5.0), ('KR', 'Kroger', 4.0),
            ('AMZN', 'Amazon', 6.0),
        ],
    },
    'NKE': {
        'suppliers': [
            ('PUMA.DE', 'Puma (materials)', 2.0),
        ],
        'customers': [
            ('FL', 'Foot Locker', 10.0), ('DKS', 'Dick\'s Sporting', 8.0),
            ('AMZN', 'Amazon', 5.0), ('JD', 'JD.com', 4.0),
        ],
    },
    # ── ENERGY ─────────────────────────────────────────────────────
    'XOM': {
        'suppliers': [
            ('SLB', 'Schlumberger', 8.0), ('HAL', 'Halliburton', 6.0),
            ('BKR', 'Baker Hughes', 5.0), ('NOV', 'NOV Inc', 3.0),
        ],
        'customers': [
            ('VLO', 'Valero Energy', 5.0), ('PSX', 'Phillips 66', 4.0),
            ('MPC', 'Marathon Petroleum', 4.0),
        ],
    },
    'CVX': {
        'suppliers': [
            ('SLB', 'Schlumberger', 7.0), ('HAL', 'Halliburton', 5.0),
            ('BKR', 'Baker Hughes', 4.0),
        ],
        'customers': [
            ('VLO', 'Valero Energy', 4.0), ('PSX', 'Phillips 66', 3.0),
        ],
    },
    # ── INDUSTRIALS ────────────────────────────────────────────────
    'BA': {
        'suppliers': [
            ('GE', 'GE Aerospace', 15.0), ('RTX', 'RTX Corp', 8.0),
            ('HWM', 'Howmet Aerospace', 5.0), ('SPR', 'Spirit AeroSystems', 10.0),
            ('TDG', 'TransDigm', 4.0), ('HEI', 'HEICO', 3.0),
        ],
        'customers': [
            ('DAL', 'Delta Air Lines', 8.0), ('UAL', 'United Airlines', 7.0),
            ('AAL', 'American Airlines', 6.0), ('LUV', 'Southwest Airlines', 5.0),
            ('RYAAY', 'Ryanair', 4.0),
        ],
    },
    'CAT': {
        'suppliers': [
            ('CMI', 'Cummins', 6.0), ('DE', 'Deere & Co', 3.0),
            ('X', 'US Steel', 5.0), ('NUE', 'Nucor', 4.0),
        ],
        'customers': [
            ('URI', 'United Rentals', 8.0), ('FLR', 'Fluor Corp', 5.0),
        ],
    },
}

# ── Industry-level inference for tickers NOT in curated list ─────────
INDUSTRY_SUPPLY_MAP: Dict[str, Dict[str, List[str]]] = {
    'Software—Application': {
        'supplier_industries': ['Semiconductors', 'Software—Infrastructure', 'Information Technology Services'],
        'customer_industries': ['Banks—Diversified', 'Healthcare Plans', 'Insurance—Diversified'],
    },
    'Software—Infrastructure': {
        'supplier_industries': ['Semiconductors', 'Electronic Components'],
        'customer_industries': ['Software—Application', 'Banks—Diversified', 'Internet Content & Information'],
    },
    'Semiconductors': {
        'supplier_industries': ['Semiconductor Equipment & Materials', 'Specialty Chemicals'],
        'customer_industries': ['Consumer Electronics', 'Communication Equipment', 'Auto Manufacturers', 'Software—Application'],
    },
    'Semiconductor Equipment & Materials': {
        'supplier_industries': ['Specialty Chemicals', 'Scientific & Technical Instruments'],
        'customer_industries': ['Semiconductors'],
    },
    'Drug Manufacturers—General': {
        'supplier_industries': ['Diagnostics & Research', 'Scientific & Technical Instruments', 'Specialty Chemicals'],
        'customer_industries': ['Medical Distribution', 'Healthcare Plans'],
    },
    'Biotechnology': {
        'supplier_industries': ['Diagnostics & Research', 'Scientific & Technical Instruments'],
        'customer_industries': ['Drug Manufacturers—General', 'Medical Distribution'],
    },
    'Medical Devices': {
        'supplier_industries': ['Electronic Components', 'Semiconductors', 'Specialty Chemicals'],
        'customer_industries': ['Healthcare Plans', 'Medical Care Facilities'],
    },
    'Banks—Diversified': {
        'supplier_industries': ['Software—Application', 'Software—Infrastructure', 'Information Technology Services'],
        'customer_industries': ['Real Estate Services', 'Capital Markets'],
    },
    'Auto Manufacturers': {
        'supplier_industries': ['Auto Parts', 'Semiconductors', 'Steel', 'Specialty Chemicals'],
        'customer_industries': ['Auto & Truck Dealerships', 'Rental & Leasing Services'],
    },
    'Oil & Gas Integrated': {
        'supplier_industries': ['Oil & Gas Equipment & Services'],
        'customer_industries': ['Oil & Gas Refining & Marketing', 'Utilities—Regulated Electric', 'Airlines'],
    },
    'Aerospace & Defense': {
        'supplier_industries': ['Semiconductors', 'Steel', 'Electronic Components', 'Specialty Chemicals'],
        'customer_industries': ['Airlines'],
    },
    'Restaurants': {
        'supplier_industries': ['Farm Products', 'Packaged Foods', 'Food Distribution'],
        'customer_industries': [],
    },
    'Packaged Foods': {
        'supplier_industries': ['Farm Products', 'Packaging & Containers'],
        'customer_industries': ['Grocery Stores', 'Discount Stores'],
    },
    'Telecom Services': {
        'supplier_industries': ['Communication Equipment', 'Semiconductors', 'Software—Infrastructure'],
        'customer_industries': ['Internet Content & Information', 'Entertainment'],
    },
    'Internet Retail': {
        'supplier_industries': ['Software—Infrastructure', 'Integrated Freight & Logistics'],
        'customer_industries': [],
    },
}


class SupplyChainEngine:
    """
    Real supply chain analysis engine.

    Priority order:
      1. Curated database (KNOWN_SUPPLY_CHAINS) — most accurate
      2. Industry-level inference from INDUSTRY_SUPPLY_MAP with FMP screener
      3. Peer-based fallback

    For each relationship, enriches with:
      - FMP profile data (price, mktCap, sector, industry, country)
      - Price correlation (Pearson r over 1Y)
      - Estimated revenue exposure
      - Relevance score (0-100)
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get('FMP_API_KEY')
        self._session = requests.Session()

    def _fetch_json(self, endpoint: str, params: Dict = None) -> Any:
        params = params or {}
        params['apikey'] = self.api_key
        try:
            url = f"https://financialmodelingprep.com/stable/{endpoint}"
            resp = self._session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"FMP fetch failed ({endpoint}): {e}")
            return None

    def _fetch_v3(self, endpoint: str, params: Dict = None) -> Any:
        params = params or {}
        params['apikey'] = self.api_key
        try:
            url = f"https://financialmodelingprep.com/api/v3/{endpoint}"
            resp = self._session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning(f"FMP v3 fetch failed ({endpoint}): {e}")
            return None

    def _fetch_profile(self, ticker: str) -> Optional[Dict]:
        data = self._fetch_json('profile', {'symbol': ticker})
        if data and isinstance(data, list) and len(data) > 0:
            return data[0]
        if data and isinstance(data, dict) and data.get('symbol'):
            return data
        return None

    def _fetch_batch_profiles(self, symbols: List[str]) -> Dict[str, Dict]:
        """Fetch profiles in batch (comma-separated) for efficiency."""
        if not symbols:
            return {}

        results = {}
        # FMP allows batch via comma-separated symbols
        for chunk_start in range(0, len(symbols), 10):
            chunk = symbols[chunk_start:chunk_start + 10]
            syms = ','.join(chunk)
            data = self._fetch_json('profile', {'symbol': syms})
            if data and isinstance(data, list):
                for p in data:
                    if p and p.get('symbol'):
                        results[p['symbol']] = p
        return results

    def _fetch_daily_closes(self, ticker: str, days: int = 252) -> Optional[np.ndarray]:
        """Fetch daily closes for correlation analysis."""
        data = self._fetch_json('historical-price-eod/full', {'symbol': ticker})
        if not data:
            return None
        if isinstance(data, dict) and 'historical' in data:
            data = data['historical']
        if not isinstance(data, list) or len(data) < 30:
            return None
        data = sorted(data, key=lambda x: x.get('date', ''))[-days:]
        return np.array([d.get('close', 0) for d in data], dtype=float)

    def _fetch_peers(self, ticker: str) -> List[str]:
        data = self._fetch_json('stock-peers', {'symbol': ticker})
        if data and isinstance(data, list) and data[0].get('peersList'):
            return [s for s in data[0]['peersList'] if s != ticker][:8]
        return []

    def _fetch_screener(self, industry: str, min_mkt_cap: float = 5e8, limit: int = 6) -> List[Dict]:
        data = self._fetch_v3('stock-screener', {
            'industry': industry, 'marketCapMoreThan': int(min_mkt_cap), 'limit': limit
        })
        return data if data and isinstance(data, list) else []

    def _compute_correlation(self, closes_a: np.ndarray, closes_b: np.ndarray) -> float:
        """Pearson correlation of daily returns."""
        min_len = min(len(closes_a), len(closes_b))
        if min_len < 30:
            return 0.0
        a = closes_a[-min_len:]
        b = closes_b[-min_len:]
        ret_a = np.diff(a) / a[:-1]
        ret_b = np.diff(b) / b[:-1]
        # Filter out zeros/nans
        mask = np.isfinite(ret_a) & np.isfinite(ret_b) & (a[:-1] != 0) & (b[:-1] != 0)
        if np.sum(mask) < 20:
            return 0.0
        if SCIPY_AVAILABLE:
            r, _ = scipy_stats.pearsonr(ret_a[mask], ret_b[mask])
            return float(r)
        else:
            return float(np.corrcoef(ret_a[mask], ret_b[mask])[0, 1])

    def _relevance_score(self, exposure: float, correlation: float,
                         mkt_cap: float, center_mkt_cap: float,
                         is_curated: bool) -> float:
        """Compute relevance score 0-100."""
        score = 0.0

        # Curated bonus
        if is_curated:
            score += 30

        # Exposure weight (0-30)
        score += min(exposure / 30.0, 1.0) * 30

        # Correlation weight (0-20) — supply chain partners tend to be correlated
        score += max(0, correlation) * 20

        # Market cap relevance (0-20) — bigger = more relevant
        if center_mkt_cap > 0 and mkt_cap > 0:
            cap_ratio = min(mkt_cap / center_mkt_cap, 1.0)
            score += cap_ratio * 20

        return round(min(score, 100), 1)

    def _build_node(self, profile: Dict, relationship: str,
                    exposure: float, correlation: float,
                    center_mkt_cap: float, is_curated: bool,
                    curated_name: str = '') -> Dict:
        """Build enriched node dict."""
        mkt_cap = profile.get('mktCap', 0)
        relevance = self._relevance_score(exposure, correlation, mkt_cap, center_mkt_cap, is_curated)

        return {
            'symbol': profile.get('symbol', ''),
            'name': curated_name or profile.get('companyName', profile.get('symbol', '')),
            'sector': profile.get('sector', ''),
            'industry': profile.get('industry', ''),
            'mktCap': mkt_cap,
            'price': profile.get('price', 0),
            'change': profile.get('changes', profile.get('changesPercentage', 0)),
            'country': profile.get('country', ''),
            'relationship': relationship,
            'exposure': round(exposure, 1),
            'correlation': round(correlation, 3),
            'relevance': relevance,
            'isCurated': is_curated,
            'description': (profile.get('description', '') or '')[:200],
        }

    def analyze(self, ticker: str) -> Dict[str, Any]:
        """
        Run full supply chain analysis.

        Returns:
          - center: company node
          - suppliers: list of supplier nodes (sorted by relevance)
          - customers: list of customer nodes
          - competitors: list of competitor nodes
          - data_source: 'curated' | 'industry_inferred' | 'peer_fallback'
          - stats: summary statistics
        """
        ticker = ticker.upper().strip()

        # 1. Fetch center company profile
        center_profile = self._fetch_profile(ticker)
        if not center_profile:
            return {'error': f'Could not load profile for {ticker}'}

        center_mkt_cap = center_profile.get('mktCap', 0)
        center_industry = center_profile.get('industry', '')
        center_sector = center_profile.get('sector', '')

        center = {
            'symbol': ticker,
            'name': center_profile.get('companyName', ticker),
            'sector': center_sector,
            'industry': center_industry,
            'mktCap': center_mkt_cap,
            'price': center_profile.get('price', 0),
            'change': center_profile.get('changes', 0),
            'country': center_profile.get('country', ''),
            'description': (center_profile.get('description', '') or '')[:300],
            'relationship': 'center',
        }

        # 2. Fetch center's daily closes for correlation
        center_closes = self._fetch_daily_closes(ticker, 252)

        suppliers = []
        customers = []
        competitors = []
        data_source = 'peer_fallback'

        # 3. Check curated database first
        curated = KNOWN_SUPPLY_CHAINS.get(ticker)
        if curated:
            data_source = 'curated'
            logger.info(f"[SupplyChain] Using curated data for {ticker}")

            # Collect all symbols to fetch in batch
            all_syms = []
            sup_entries = curated.get('suppliers', [])
            cust_entries = curated.get('customers', [])
            for sym, name, exp in sup_entries:
                all_syms.append(sym)
            for sym, name, exp in cust_entries:
                all_syms.append(sym)

            # Batch fetch profiles
            profiles = self._fetch_batch_profiles(all_syms)

            # Build supplier nodes
            for sym, name, exp in sup_entries:
                prof = profiles.get(sym)
                if not prof:
                    # Create minimal profile
                    prof = {'symbol': sym, 'companyName': name, 'mktCap': 0, 'price': 0}

                corr = 0.0
                if center_closes is not None:
                    node_closes = self._fetch_daily_closes(sym, 252)
                    if node_closes is not None:
                        corr = self._compute_correlation(center_closes, node_closes)

                suppliers.append(self._build_node(
                    prof, 'supplier', exp, corr, center_mkt_cap, True, name
                ))

            # Build customer nodes
            for sym, name, exp in cust_entries:
                prof = profiles.get(sym)
                if not prof:
                    prof = {'symbol': sym, 'companyName': name, 'mktCap': 0, 'price': 0}

                corr = 0.0
                if center_closes is not None:
                    node_closes = self._fetch_daily_closes(sym, 252)
                    if node_closes is not None:
                        corr = self._compute_correlation(center_closes, node_closes)

                customers.append(self._build_node(
                    prof, 'customer', exp, corr, center_mkt_cap, True, name
                ))

        else:
            # 4. Industry-level inference
            ind_map = INDUSTRY_SUPPLY_MAP.get(center_industry)
            if ind_map:
                data_source = 'industry_inferred'
                logger.info(f"[SupplyChain] Using industry inference for {ticker} ({center_industry})")

                min_cap = max(5e8, center_mkt_cap * 0.002)
                seen = {ticker}

                for ind in ind_map.get('supplier_industries', [])[:4]:
                    results = self._fetch_screener(ind, min_cap, 5)
                    for r in results:
                        sym = r.get('symbol', '')
                        if sym and sym not in seen:
                            seen.add(sym)
                            prof = r  # screener returns profile-like data
                            corr = 0.0
                            if center_closes is not None and len(suppliers) < 5:
                                nc = self._fetch_daily_closes(sym, 252)
                                if nc is not None:
                                    corr = self._compute_correlation(center_closes, nc)

                            suppliers.append(self._build_node(
                                prof, 'supplier', 0, corr, center_mkt_cap, False
                            ))

                for ind in ind_map.get('customer_industries', [])[:4]:
                    results = self._fetch_screener(ind, min_cap, 5)
                    for r in results:
                        sym = r.get('symbol', '')
                        if sym and sym not in seen:
                            seen.add(sym)
                            prof = r
                            corr = 0.0
                            if center_closes is not None and len(customers) < 5:
                                nc = self._fetch_daily_closes(sym, 252)
                                if nc is not None:
                                    corr = self._compute_correlation(center_closes, nc)

                            customers.append(self._build_node(
                                prof, 'customer', 0, corr, center_mkt_cap, False
                            ))

        # 5. Always fetch competitors (peers)
        peer_syms = self._fetch_peers(ticker)
        if peer_syms:
            peer_profiles = self._fetch_batch_profiles(peer_syms)
            for sym in peer_syms[:6]:
                prof = peer_profiles.get(sym)
                if prof:
                    corr = 0.0
                    if center_closes is not None and len(competitors) < 4:
                        nc = self._fetch_daily_closes(sym, 252)
                        if nc is not None:
                            corr = self._compute_correlation(center_closes, nc)

                    competitors.append(self._build_node(
                        prof, 'competitor', 0, corr, center_mkt_cap, False
                    ))

        # Sort by relevance
        suppliers.sort(key=lambda n: n['relevance'], reverse=True)
        customers.sort(key=lambda n: n['relevance'], reverse=True)
        competitors.sort(key=lambda n: n['relevance'], reverse=True)

        # Cap results
        suppliers = suppliers[:10]
        customers = customers[:10]
        competitors = competitors[:8]

        # Stats
        avg_sup_corr = np.mean([s['correlation'] for s in suppliers]) if suppliers else 0
        avg_cust_corr = np.mean([c['correlation'] for c in customers]) if customers else 0
        total_sup_exposure = sum(s['exposure'] for s in suppliers)
        total_cust_exposure = sum(c['exposure'] for c in customers)

        return {
            'center': center,
            'suppliers': suppliers,
            'customers': customers,
            'competitors': competitors,
            'data_source': data_source,
            'stats': {
                'total_suppliers': len(suppliers),
                'total_customers': len(customers),
                'total_competitors': len(competitors),
                'avg_supplier_correlation': round(float(avg_sup_corr), 3),
                'avg_customer_correlation': round(float(avg_cust_corr), 3),
                'total_supplier_exposure': round(float(total_sup_exposure), 1),
                'total_customer_exposure': round(float(total_cust_exposure), 1),
                'data_quality': 'high' if data_source == 'curated' else 'medium' if data_source == 'industry_inferred' else 'low',
            },
        }


# ── Singleton ────────────────────────────────────────────────────────

_engine_instance: Optional[SupplyChainEngine] = None

def get_supply_chain_engine() -> SupplyChainEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = SupplyChainEngine()
    return _engine_instance
