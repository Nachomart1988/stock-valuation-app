'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchFmp } from '@/lib/fmpClient';

/* ───────────────────────────────────────────────────────────
   SUPPLY CHAIN ANALYSIS TAB
   Bloomberg Terminal-inspired supply chain visualization.
   Shows suppliers → Company → customers in an interactive graph.
   ─────────────────────────────────────────────────────────── */

interface CompanyNode {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  mktCap: number;
  price: number;
  change: number;
  description?: string;
  country?: string;
  relationship: 'supplier' | 'customer' | 'competitor' | 'center';
  relevance?: number; // 0-100, how relevant the connection is
  revenueExposure?: string; // e.g. "Rev: 12.5%"
}

interface SupplyChainTabProps {
  ticker: string;
  profile?: any;
}

// ── Industry-level supply chain map ──
// Maps each FMP industry to its typical supplier and customer industries.
// Used to query FMP screener for companies in related industries.
const SUPPLY_CHAIN_MAP: Record<string, { suppliers: string[]; customers: string[] }> = {
  // TECHNOLOGY
  'Software—Application': { suppliers: ['Semiconductors', 'Software—Infrastructure', 'Information Technology Services'], customers: ['Banks—Diversified', 'Healthcare Plans', 'Telecom Services', 'Insurance—Diversified'] },
  'Software—Infrastructure': { suppliers: ['Semiconductors', 'Electronic Components'], customers: ['Software—Application', 'Banks—Diversified', 'Internet Content & Information', 'Information Technology Services'] },
  'Semiconductors': { suppliers: ['Semiconductor Equipment & Materials', 'Specialty Chemicals'], customers: ['Consumer Electronics', 'Communication Equipment', 'Auto Manufacturers', 'Aerospace & Defense'] },
  'Semiconductor Equipment & Materials': { suppliers: ['Specialty Chemicals', 'Scientific & Technical Instruments'], customers: ['Semiconductors'] },
  'Consumer Electronics': { suppliers: ['Semiconductors', 'Electronic Components', 'Communication Equipment'], customers: ['Specialty Retail', 'Internet Retail', 'Telecom Services'] },
  'Communication Equipment': { suppliers: ['Semiconductors', 'Electronic Components'], customers: ['Telecom Services', 'Aerospace & Defense', 'Internet Content & Information'] },
  'Information Technology Services': { suppliers: ['Software—Infrastructure', 'Semiconductors'], customers: ['Banks—Diversified', 'Oil & Gas Integrated', 'Drug Manufacturers—General', 'Insurance—Diversified'] },
  'Electronic Components': { suppliers: ['Specialty Chemicals', 'Copper', 'Aluminum'], customers: ['Semiconductors', 'Consumer Electronics', 'Auto Manufacturers', 'Medical Devices'] },
  'Solar': { suppliers: ['Semiconductors', 'Specialty Chemicals', 'Electronic Components'], customers: ['Utilities—Regulated Electric', 'Utilities—Renewable'] },
  // COMMUNICATION SERVICES
  'Telecom Services': { suppliers: ['Communication Equipment', 'Semiconductors', 'Software—Infrastructure', 'Information Technology Services'], customers: ['Internet Content & Information', 'Entertainment', 'Advertising Agencies'] },
  'Internet Content & Information': { suppliers: ['Software—Infrastructure', 'Information Technology Services', 'Semiconductors'], customers: ['Advertising Agencies', 'Internet Retail', 'Entertainment'] },
  'Entertainment': { suppliers: ['Software—Application', 'Internet Content & Information'], customers: ['Internet Retail', 'Specialty Retail', 'Telecom Services'] },
  'Advertising Agencies': { suppliers: ['Internet Content & Information', 'Entertainment', 'Software—Application'], customers: ['Packaged Foods', 'Auto Manufacturers', 'Household & Personal Products'] },
  // CONSUMER CYCLICAL
  'Auto Manufacturers': { suppliers: ['Auto Parts', 'Semiconductors', 'Steel', 'Specialty Chemicals', 'Aluminum'], customers: ['Auto & Truck Dealerships', 'Rental & Leasing Services'] },
  'Auto Parts': { suppliers: ['Steel', 'Specialty Chemicals', 'Electronic Components', 'Aluminum'], customers: ['Auto Manufacturers'] },
  'Internet Retail': { suppliers: ['Software—Infrastructure', 'Integrated Freight & Logistics', 'Information Technology Services'], customers: ['Packaged Foods', 'Consumer Electronics', 'Household & Personal Products'] },
  'Specialty Retail': { suppliers: ['Packaged Foods', 'Apparel Manufacturing', 'Household & Personal Products'], customers: [] },
  'Restaurants': { suppliers: ['Farm Products', 'Packaged Foods', 'Packaging & Containers', 'Food Distribution'], customers: [] },
  'Apparel Manufacturing': { suppliers: ['Specialty Chemicals', 'Textile Manufacturing'], customers: ['Specialty Retail', 'Internet Retail', 'Department Stores'] },
  'Lodging': { suppliers: ['Software—Application', 'Food Distribution', 'Building Materials'], customers: [] },
  // HEALTHCARE
  'Drug Manufacturers—General': { suppliers: ['Specialty Chemicals', 'Diagnostics & Research', 'Scientific & Technical Instruments'], customers: ['Medical Distribution', 'Pharmaceutical Retailers', 'Healthcare Plans'] },
  'Drug Manufacturers—Specialty & Generic': { suppliers: ['Specialty Chemicals', 'Diagnostics & Research'], customers: ['Medical Distribution', 'Healthcare Plans'] },
  'Biotechnology': { suppliers: ['Diagnostics & Research', 'Scientific & Technical Instruments', 'Specialty Chemicals'], customers: ['Drug Manufacturers—General', 'Medical Distribution'] },
  'Medical Devices': { suppliers: ['Electronic Components', 'Semiconductors', 'Specialty Chemicals'], customers: ['Healthcare Plans', 'Medical Care Facilities'] },
  'Healthcare Plans': { suppliers: ['Software—Application', 'Information Technology Services'], customers: [] },
  'Diagnostics & Research': { suppliers: ['Scientific & Technical Instruments', 'Specialty Chemicals'], customers: ['Drug Manufacturers—General', 'Biotechnology', 'Medical Devices'] },
  // FINANCIAL SERVICES
  'Banks—Diversified': { suppliers: ['Software—Application', 'Software—Infrastructure', 'Information Technology Services'], customers: ['Real Estate Services', 'Capital Markets', 'Insurance—Diversified'] },
  'Banks—Regional': { suppliers: ['Software—Application', 'Information Technology Services'], customers: ['Real Estate Services'] },
  'Insurance—Diversified': { suppliers: ['Software—Application', 'Information Technology Services'], customers: [] },
  'Capital Markets': { suppliers: ['Software—Infrastructure', 'Information Technology Services'], customers: ['Banks—Diversified', 'Insurance—Diversified'] },
  'Financial Data & Stock Exchanges': { suppliers: ['Software—Infrastructure', 'Information Technology Services'], customers: ['Banks—Diversified', 'Capital Markets', 'Insurance—Diversified'] },
  // ENERGY
  'Oil & Gas Integrated': { suppliers: ['Oil & Gas Equipment & Services', 'Steel', 'Engineering & Construction'], customers: ['Oil & Gas Refining & Marketing', 'Utilities—Regulated Electric', 'Airlines', 'Specialty Chemicals'] },
  'Oil & Gas Exploration & Production': { suppliers: ['Oil & Gas Equipment & Services', 'Oil & Gas Drilling'], customers: ['Oil & Gas Midstream', 'Oil & Gas Refining & Marketing'] },
  'Oil & Gas Refining & Marketing': { suppliers: ['Oil & Gas Integrated', 'Oil & Gas Exploration & Production'], customers: ['Airlines', 'Trucking', 'Specialty Chemicals', 'Utilities—Regulated Electric'] },
  'Oil & Gas Equipment & Services': { suppliers: ['Steel', 'Electronic Components', 'Specialty Chemicals'], customers: ['Oil & Gas Integrated', 'Oil & Gas Exploration & Production'] },
  'Oil & Gas Midstream': { suppliers: ['Steel', 'Engineering & Construction'], customers: ['Oil & Gas Refining & Marketing', 'Utilities—Regulated Electric'] },
  // INDUSTRIALS
  'Aerospace & Defense': { suppliers: ['Semiconductors', 'Steel', 'Electronic Components', 'Specialty Chemicals'], customers: ['Airlines'] },
  'Airlines': { suppliers: ['Aerospace & Defense', 'Oil & Gas Refining & Marketing'], customers: [] },
  'Trucking': { suppliers: ['Auto Manufacturers', 'Oil & Gas Refining & Marketing'], customers: ['Internet Retail', 'Packaged Foods', 'Specialty Retail'] },
  'Integrated Freight & Logistics': { suppliers: ['Airlines', 'Trucking', 'Software—Application'], customers: ['Internet Retail', 'Auto Manufacturers', 'Specialty Retail'] },
  'Engineering & Construction': { suppliers: ['Steel', 'Building Materials', 'Specialty Chemicals'], customers: ['Oil & Gas Integrated', 'Utilities—Regulated Electric'] },
  'Farm & Heavy Construction Machinery': { suppliers: ['Steel', 'Electronic Components', 'Semiconductors'], customers: ['Farm Products', 'Engineering & Construction'] },
  'Industrial Distribution': { suppliers: ['Steel', 'Electronic Components', 'Specialty Chemicals'], customers: ['Engineering & Construction', 'Auto Manufacturers'] },
  // BASIC MATERIALS
  'Steel': { suppliers: ['Coal'], customers: ['Auto Manufacturers', 'Aerospace & Defense', 'Engineering & Construction', 'Auto Parts'] },
  'Specialty Chemicals': { suppliers: ['Oil & Gas Refining & Marketing'], customers: ['Semiconductors', 'Drug Manufacturers—General', 'Auto Parts', 'Packaged Foods'] },
  'Aluminum': { suppliers: ['Utilities—Regulated Electric'], customers: ['Auto Manufacturers', 'Aerospace & Defense', 'Packaging & Containers'] },
  'Copper': { suppliers: [], customers: ['Electronic Components', 'Engineering & Construction', 'Auto Parts'] },
  'Gold': { suppliers: [], customers: ['Capital Markets', 'Specialty Retail'] },
  'Building Materials': { suppliers: ['Steel', 'Specialty Chemicals'], customers: ['Engineering & Construction'] },
  'Packaging & Containers': { suppliers: ['Aluminum', 'Paper & Paper Products', 'Specialty Chemicals'], customers: ['Packaged Foods', 'Beverages—Non-Alcoholic', 'Household & Personal Products'] },
  // CONSUMER DEFENSIVE
  'Packaged Foods': { suppliers: ['Farm Products', 'Packaging & Containers', 'Specialty Chemicals'], customers: ['Grocery Stores', 'Discount Stores', 'Internet Retail'] },
  'Household & Personal Products': { suppliers: ['Specialty Chemicals', 'Packaging & Containers'], customers: ['Grocery Stores', 'Discount Stores', 'Internet Retail'] },
  'Beverages—Non-Alcoholic': { suppliers: ['Packaging & Containers', 'Farm Products', 'Specialty Chemicals'], customers: ['Grocery Stores', 'Restaurants', 'Discount Stores'] },
  'Beverages—Brewers': { suppliers: ['Packaging & Containers', 'Farm Products'], customers: ['Grocery Stores', 'Restaurants'] },
  'Discount Stores': { suppliers: ['Packaged Foods', 'Household & Personal Products', 'Apparel Manufacturing'], customers: [] },
  'Grocery Stores': { suppliers: ['Packaged Foods', 'Farm Products', 'Beverages—Non-Alcoholic'], customers: [] },
  'Farm Products': { suppliers: ['Farm & Heavy Construction Machinery', 'Specialty Chemicals'], customers: ['Packaged Foods', 'Restaurants', 'Grocery Stores'] },
  // UTILITIES
  'Utilities—Regulated Electric': { suppliers: ['Oil & Gas Integrated', 'Solar', 'Engineering & Construction'], customers: [] },
  'Utilities—Renewable': { suppliers: ['Solar', 'Engineering & Construction'], customers: ['Utilities—Regulated Electric'] },
  'Utilities—Regulated Gas': { suppliers: ['Oil & Gas Midstream', 'Engineering & Construction'], customers: [] },
  // REAL ESTATE
  'REIT—Specialty': { suppliers: ['Engineering & Construction', 'Building Materials'], customers: ['Telecom Services'] },
  'REIT—Industrial': { suppliers: ['Engineering & Construction', 'Building Materials'], customers: ['Internet Retail', 'Integrated Freight & Logistics'] },
  'REIT—Retail': { suppliers: ['Engineering & Construction', 'Building Materials'], customers: ['Specialty Retail', 'Restaurants'] },
};

// Sector-level fallback for industries not in the map
const SECTOR_FALLBACK: Record<string, { supplierSectors: string[]; customerSectors: string[] }> = {
  'Technology': { supplierSectors: ['Basic Materials'], customerSectors: ['Financial Services', 'Healthcare', 'Communication Services'] },
  'Communication Services': { supplierSectors: ['Technology'], customerSectors: ['Consumer Cyclical'] },
  'Consumer Cyclical': { supplierSectors: ['Technology', 'Industrials', 'Basic Materials'], customerSectors: [] },
  'Consumer Defensive': { supplierSectors: ['Basic Materials', 'Industrials'], customerSectors: [] },
  'Healthcare': { supplierSectors: ['Technology', 'Basic Materials'], customerSectors: [] },
  'Financial Services': { supplierSectors: ['Technology'], customerSectors: ['Real Estate'] },
  'Industrials': { supplierSectors: ['Basic Materials', 'Energy'], customerSectors: ['Consumer Cyclical'] },
  'Basic Materials': { supplierSectors: ['Energy'], customerSectors: ['Industrials', 'Technology'] },
  'Energy': { supplierSectors: ['Industrials'], customerSectors: ['Utilities', 'Basic Materials'] },
  'Utilities': { supplierSectors: ['Energy', 'Industrials'], customerSectors: [] },
  'Real Estate': { supplierSectors: ['Industrials', 'Basic Materials', 'Financial Services'], customerSectors: [] },
};

function fmtMktCap(v: number): string {
  if (!v) return '–';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

export default function SupplyChainTab({ ticker, profile }: SupplyChainTabProps) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [centerCompany, setCenterCompany] = useState<CompanyNode | null>(null);
  const [suppliers, setSuppliers] = useState<CompanyNode[]>([]);
  const [customers, setCustomers] = useState<CompanyNode[]>([]);
  const [competitors, setCompetitors] = useState<CompanyNode[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 700 });

  // Responsive sizing
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        setDimensions({ width: Math.max(w, 600), height: Math.max(500, Math.min(700, w * 0.55)) });
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;

    async function fetchSupplyChain() {
      setLoading(true);
      setError(null);

      try {
        // 1. Fetch company profile and peers in parallel
        const [peersData, profileData] = await Promise.all([
          fetchFmp('stable/stock-peers', { symbol: ticker }).catch(() => []),
          profile
            ? Promise.resolve(profile)
            : fetchFmp('stable/profile', { symbol: ticker })
                .then((d: any) => (Array.isArray(d) ? d[0] : d))
                .catch(() => null),
        ]);

        if (cancelled) return;

        const companyProfile = Array.isArray(profileData) ? profileData[0] : profileData;
        if (!companyProfile) {
          setError('Could not load company profile');
          setLoading(false);
          return;
        }

        const center: CompanyNode = {
          symbol: companyProfile.symbol || ticker,
          name: companyProfile.companyName || ticker,
          sector: companyProfile.sector || '',
          industry: companyProfile.industry || '',
          mktCap: companyProfile.mktCap || 0,
          price: companyProfile.price || 0,
          change: companyProfile.changes || 0,
          description: companyProfile.description || '',
          country: companyProfile.country || '',
          relationship: 'center',
        };
        setCenterCompany(center);

        // 2. Peers → Competitors
        // stable/stock-peers returns [{symbol: "T", peersList: ["VZ","TMUS",...]}]
        console.log('[SupplyChain] Raw peers data:', JSON.stringify(peersData)?.slice(0, 500));
        let peerSymbols: string[] = [];
        if (Array.isArray(peersData)) {
          // Try peersList format first (standard FMP response)
          const peersList = peersData[0]?.peersList;
          if (Array.isArray(peersList)) {
            peerSymbols = peersList.filter((s: string) => s && s !== ticker);
          } else {
            // Fallback: each item has a symbol
            peerSymbols = peersData.map((p: any) => p.symbol).filter((s: string) => s && s !== ticker);
          }
        }
        console.log('[SupplyChain] Parsed peer symbols:', peerSymbols);
        const comps: CompanyNode[] = [];
        if (peerSymbols.length > 0) {
          const peerProfileResults = await Promise.all(
            peerSymbols.slice(0, 10).map(sym =>
              fetchFmp('stable/profile', { symbol: sym })
                .then((d: any) => (Array.isArray(d) ? d[0] : d))
                .catch(() => null)
            )
          );
          if (!cancelled) {
            for (const p of peerProfileResults) {
              if (p?.symbol && p.symbol !== ticker) {
                comps.push({
                  symbol: p.symbol,
                  name: p.companyName || p.symbol,
                  sector: p.sector || '',
                  industry: p.industry || '',
                  mktCap: p.mktCap || 0,
                  price: p.price || 0,
                  change: p.changes || 0,
                  country: p.country || '',
                  relationship: 'competitor',
                });
              }
            }
          }
        }
        if (cancelled) return;

        // 3. Determine supplier & customer industries from supply chain map
        const chainEntry = SUPPLY_CHAIN_MAP[center.industry];
        const useSectorFallback = !chainEntry;

        const sups: CompanyNode[] = [];
        const custs: CompanyNode[] = [];
        const seenSymbols = new Set([ticker, ...comps.map(c => c.symbol)]);
        const minMktCap = Math.max(5e8, (center.mktCap || 1e10) * 0.002);

        const buildNode = (p: any, rel: 'supplier' | 'customer'): CompanyNode => ({
          symbol: p.symbol,
          name: p.companyName || p.symbol,
          sector: p.sector || '',
          industry: p.industry || '',
          mktCap: p.marketCap || p.mktCap || 0,
          price: p.price || 0,
          change: p.changes || p.changesPercentage || 0,
          country: p.country || '',
          relationship: rel,
        });

        if (!useSectorFallback) {
          // 4a. Industry-level search — query FMP screener for each related industry
          console.log('[SupplyChain] Industry match:', center.industry, '| Suppliers:', chainEntry.suppliers, '| Customers:', chainEntry.customers);
          const [supResults, custResults] = await Promise.all([
            Promise.all(
              chainEntry.suppliers.map(ind =>
                fetchFmp('api/v3/stock-screener', { industry: ind, marketCapMoreThan: minMktCap, limit: 8 })
                  .then(r => { console.log(`[SupplyChain] Supplier industry "${ind}":`, r?.length || 0, 'results'); return r; })
                  .catch(e => { console.warn(`[SupplyChain] Screener failed for "${ind}":`, e.message); return []; })
              )
            ),
            Promise.all(
              chainEntry.customers.map(ind =>
                fetchFmp('api/v3/stock-screener', { industry: ind, marketCapMoreThan: minMktCap, limit: 8 })
                  .then(r => { console.log(`[SupplyChain] Customer industry "${ind}":`, r?.length || 0, 'results'); return r; })
                  .catch(e => { console.warn(`[SupplyChain] Screener failed for "${ind}":`, e.message); return []; })
              )
            ),
          ]);

          if (cancelled) return;

          for (const batch of supResults) {
            for (const p of (batch || [])) {
              if (p?.symbol && !seenSymbols.has(p.symbol)) {
                seenSymbols.add(p.symbol);
                sups.push(buildNode(p, 'supplier'));
              }
            }
          }
          for (const batch of custResults) {
            for (const p of (batch || [])) {
              if (p?.symbol && !seenSymbols.has(p.symbol)) {
                seenSymbols.add(p.symbol);
                custs.push(buildNode(p, 'customer'));
              }
            }
          }
        } else {
          // 4b. Sector-level fallback — query screener by sector
          console.log('[SupplyChain] No industry match, using sector fallback for:', center.sector);
          const sectorEntry = SECTOR_FALLBACK[center.sector];
          if (sectorEntry) {
            const [supResults, custResults] = await Promise.all([
              Promise.all(
                sectorEntry.supplierSectors.slice(0, 2).map(sec =>
                  fetchFmp('api/v3/stock-screener', { sector: sec, marketCapMoreThan: minMktCap, limit: 10 }).catch(() => [])
                )
              ),
              Promise.all(
                sectorEntry.customerSectors.slice(0, 2).map(sec =>
                  fetchFmp('api/v3/stock-screener', { sector: sec, marketCapMoreThan: minMktCap, limit: 10 }).catch(() => [])
                )
              ),
            ]);

            if (cancelled) return;

            for (const batch of supResults) {
              for (const p of (batch || [])) {
                if (p?.symbol && !seenSymbols.has(p.symbol)) {
                  seenSymbols.add(p.symbol);
                  sups.push(buildNode(p, 'supplier'));
                }
              }
            }
            for (const batch of custResults) {
              for (const p of (batch || [])) {
                if (p?.symbol && !seenSymbols.has(p.symbol)) {
                  seenSymbols.add(p.symbol);
                  custs.push(buildNode(p, 'customer'));
                }
              }
            }
          }
        }

        // Sort by market cap (largest = most relevant first)
        sups.sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0));
        custs.sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0));
        comps.sort((a, b) => (b.mktCap || 0) - (a.mktCap || 0));

        setSuppliers(sups.slice(0, 8));
        setCustomers(custs.slice(0, 8));
        setCompetitors(comps.slice(0, 6));
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load supply chain data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSupplyChain();
    return () => { cancelled = true; };
  }, [ticker, profile]);

  const handleNodeClick = useCallback((symbol: string) => {
    if (symbol === ticker) return;
    setSelectedNode(symbol);
  }, [ticker]);

  const navigateToAnalysis = useCallback((symbol: string) => {
    router.push(`/analizar?ticker=${symbol}`);
  }, [router]);

  // ── SVG Graph Rendering ──
  const { width: W, height: H } = dimensions;
  const centerX = W / 2;
  const centerY = H / 2 - 20;

  const supplierPositions = useMemo(() => {
    const count = suppliers.length;
    if (count === 0) return [];
    const startY = centerY - Math.min(count * 30, H * 0.38);
    const gap = count > 1 ? Math.min(60, (H * 0.76) / (count - 1)) : 0;
    return suppliers.map((_, i) => ({
      x: W * 0.12,
      y: count === 1 ? centerY : startY + i * gap,
    }));
  }, [suppliers, W, H, centerY]);

  const customerPositions = useMemo(() => {
    const count = customers.length;
    if (count === 0) return [];
    const startY = centerY - Math.min(count * 30, H * 0.38);
    const gap = count > 1 ? Math.min(60, (H * 0.76) / (count - 1)) : 0;
    return customers.map((_, i) => ({
      x: W * 0.88,
      y: count === 1 ? centerY : startY + i * gap,
    }));
  }, [customers, W, H, centerY]);

  const competitorPositions = useMemo(() => {
    const count = competitors.length;
    if (count === 0) return [];
    const startX = centerX - Math.min(count * 50, W * 0.3);
    const gap = count > 1 ? Math.min(100, (W * 0.6) / (count - 1)) : 0;
    return competitors.map((_, i) => ({
      x: count === 1 ? centerX : startX + i * gap,
      y: H - 55,
    }));
  }, [competitors, W, H, centerX, centerY]);

  const selectedCompany = useMemo(() => {
    if (!selectedNode) return null;
    return [...suppliers, ...customers, ...competitors].find(n => n.symbol === selectedNode) || null;
  }, [selectedNode, suppliers, customers, competitors]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading supply chain data for {ticker}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-red-400 text-sm mb-2">Error loading supply chain</p>
        <p className="text-gray-500 text-xs">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Supply Chain Analysis
          </h2>
          <p className="text-gray-500 text-xs mt-1">
            {centerCompany?.name} — Exposure to related companies (suppliers, customers, competitors)
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> Suppliers ({suppliers.length})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Customers ({customers.length})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> Competitors ({competitors.length})
          </span>
        </div>
      </div>

      {/* Graph Container */}
      <div ref={containerRef} className="relative rounded-xl border border-white/[0.06] bg-gray-900/40 overflow-hidden">
        {/* SVG Graph */}
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minHeight: 500 }}
        >
          <defs>
            {/* Connection line gradients */}
            <linearGradient id="grad-supplier" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(6,182,212,0.5)" />
              <stop offset="100%" stopColor="rgba(6,182,212,0.08)" />
            </linearGradient>
            <linearGradient id="grad-customer" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(245,158,11,0.08)" />
              <stop offset="100%" stopColor="rgba(245,158,11,0.5)" />
            </linearGradient>
            <linearGradient id="grad-competitor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(139,92,246,0.08)" />
              <stop offset="100%" stopColor="rgba(139,92,246,0.5)" />
            </linearGradient>
            {/* Glow filters */}
            <filter id="glow-center" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ── Connection Lines ── */}
          {/* Supplier → Center */}
          {suppliers.map((s, i) => {
            const pos = supplierPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === s.symbol;
            return (
              <path
                key={`line-s-${s.symbol}`}
                d={`M ${pos.x + 60} ${pos.y} C ${centerX * 0.5} ${pos.y}, ${centerX * 0.5} ${centerY}, ${centerX - 80} ${centerY}`}
                fill="none"
                stroke={isHovered ? 'rgba(6,182,212,0.7)' : 'url(#grad-supplier)'}
                strokeWidth={isHovered ? 2 : 1}
                className="transition-all duration-200"
              />
            );
          })}
          {/* Center → Customer */}
          {customers.map((c, i) => {
            const pos = customerPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === c.symbol;
            return (
              <path
                key={`line-c-${c.symbol}`}
                d={`M ${centerX + 80} ${centerY} C ${centerX + (W - centerX) * 0.5} ${centerY}, ${centerX + (W - centerX) * 0.5} ${pos.y}, ${pos.x - 60} ${pos.y}`}
                fill="none"
                stroke={isHovered ? 'rgba(245,158,11,0.7)' : 'url(#grad-customer)'}
                strokeWidth={isHovered ? 2 : 1}
                className="transition-all duration-200"
              />
            );
          })}
          {/* Center → Competitor */}
          {competitors.map((c, i) => {
            const pos = competitorPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === c.symbol;
            return (
              <line
                key={`line-comp-${c.symbol}`}
                x1={centerX}
                y1={centerY + 30}
                x2={pos.x}
                y2={pos.y - 18}
                stroke={isHovered ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.12)'}
                strokeWidth={isHovered ? 1.5 : 0.7}
                strokeDasharray={isHovered ? 'none' : '4 4'}
                className="transition-all duration-200"
              />
            );
          })}

          {/* ── Supplier count label ── */}
          {suppliers.length > 0 && (
            <g>
              <rect x={centerX * 0.38 - 40} y={centerY - 10} width={80} height={20} rx={10} fill="rgba(6,182,212,0.08)" stroke="rgba(6,182,212,0.2)" strokeWidth={0.5} />
              <text x={centerX * 0.38} y={centerY + 4} textAnchor="middle" fill="rgba(6,182,212,0.6)" fontSize={10} fontWeight={600}>
                {suppliers.length} Suppliers
              </text>
            </g>
          )}

          {/* ── Customer count label ── */}
          {customers.length > 0 && (
            <g>
              <rect x={centerX + (W - centerX) * 0.62 - 42} y={centerY - 10} width={84} height={20} rx={10} fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.2)" strokeWidth={0.5} />
              <text x={centerX + (W - centerX) * 0.62} y={centerY + 4} textAnchor="middle" fill="rgba(245,158,11,0.6)" fontSize={10} fontWeight={600}>
                {customers.length} Customers
              </text>
            </g>
          )}

          {/* ── Competitor label ── */}
          {competitors.length > 0 && (
            <text x={centerX} y={H - 8} textAnchor="middle" fill="rgba(139,92,246,0.5)" fontSize={10} fontWeight={600}>
              {competitors.length} Comps
            </text>
          )}

          {/* ── CENTER NODE ── */}
          {centerCompany && (
            <g filter="url(#glow-center)">
              <rect
                x={centerX - 78}
                y={centerY - 32}
                width={156}
                height={64}
                rx={8}
                fill="#064e3b"
                stroke="#10b981"
                strokeWidth={1.5}
              />
              <text x={centerX} y={centerY - 10} textAnchor="middle" fill="#34d399" fontSize={14} fontWeight={800}>
                {centerCompany.symbol}
              </text>
              <text x={centerX} y={centerY + 8} textAnchor="middle" fill="#a7f3d0" fontSize={9}>
                {centerCompany.name.length > 22 ? centerCompany.name.slice(0, 22) + '…' : centerCompany.name}
              </text>
              <text x={centerX} y={centerY + 22} textAnchor="middle" fill="#6ee7b7" fontSize={8} fontWeight={600}>
                {fmtMktCap(centerCompany.mktCap)}
              </text>
            </g>
          )}

          {/* ── SUPPLIER NODES ── */}
          {suppliers.map((s, i) => {
            const pos = supplierPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === s.symbol;
            const isSelected = selectedNode === s.symbol;
            return (
              <g
                key={`node-s-${s.symbol}`}
                onMouseEnter={() => setHoveredNode(s.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => handleNodeClick(s.symbol)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={pos.x - 55}
                  y={pos.y - 16}
                  width={110}
                  height={32}
                  rx={6}
                  fill={isHovered || isSelected ? 'rgba(6,182,212,0.15)' : 'rgba(6,182,212,0.06)'}
                  stroke={isHovered || isSelected ? 'rgba(6,182,212,0.5)' : 'rgba(6,182,212,0.15)'}
                  strokeWidth={isHovered ? 1.5 : 0.7}
                  className="transition-all duration-150"
                />
                <text x={pos.x} y={pos.y - 2} textAnchor="middle" fill={isHovered ? '#22d3ee' : '#67e8f9'} fontSize={11} fontWeight={700}>
                  {s.symbol}
                </text>
                <text x={pos.x} y={pos.y + 11} textAnchor="middle" fill="rgba(6,182,212,0.5)" fontSize={7.5}>
                  {fmtMktCap(s.mktCap)}
                </text>
              </g>
            );
          })}

          {/* ── CUSTOMER NODES ── */}
          {customers.map((c, i) => {
            const pos = customerPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === c.symbol;
            const isSelected = selectedNode === c.symbol;
            return (
              <g
                key={`node-c-${c.symbol}`}
                onMouseEnter={() => setHoveredNode(c.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => handleNodeClick(c.symbol)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={pos.x - 55}
                  y={pos.y - 16}
                  width={110}
                  height={32}
                  rx={6}
                  fill={isHovered || isSelected ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.06)'}
                  stroke={isHovered || isSelected ? 'rgba(245,158,11,0.5)' : 'rgba(245,158,11,0.15)'}
                  strokeWidth={isHovered ? 1.5 : 0.7}
                  className="transition-all duration-150"
                />
                <text x={pos.x} y={pos.y - 2} textAnchor="middle" fill={isHovered ? '#fbbf24' : '#fcd34d'} fontSize={11} fontWeight={700}>
                  {c.symbol}
                </text>
                <text x={pos.x} y={pos.y + 11} textAnchor="middle" fill="rgba(245,158,11,0.5)" fontSize={7.5}>
                  {fmtMktCap(c.mktCap)}
                </text>
              </g>
            );
          })}

          {/* ── COMPETITOR NODES ── */}
          {competitors.map((c, i) => {
            const pos = competitorPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === c.symbol;
            const isSelected = selectedNode === c.symbol;
            return (
              <g
                key={`node-comp-${c.symbol}`}
                onMouseEnter={() => setHoveredNode(c.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => handleNodeClick(c.symbol)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={pos.x - 42}
                  y={pos.y - 16}
                  width={84}
                  height={32}
                  rx={6}
                  fill={isHovered || isSelected ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.06)'}
                  stroke={isHovered || isSelected ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.15)'}
                  strokeWidth={isHovered ? 1.5 : 0.7}
                  className="transition-all duration-150"
                />
                <text x={pos.x} y={pos.y - 2} textAnchor="middle" fill={isHovered ? '#a78bfa' : '#c4b5fd'} fontSize={10} fontWeight={700}>
                  {c.symbol}
                </text>
                <text x={pos.x} y={pos.y + 11} textAnchor="middle" fill="rgba(139,92,246,0.45)" fontSize={7}>
                  {fmtMktCap(c.mktCap)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Title overlay */}
        <div className="absolute top-3 left-3 text-[10px] text-gray-600 uppercase tracking-wider font-mono">
          {ticker} — Supply Chain Exposure
        </div>
        <div className="absolute top-3 right-3 text-[10px] text-gray-600 font-mono">
          Sort by: Company Exposure
        </div>
      </div>

      {/* ── Selected Company Detail Panel ── */}
      {selectedCompany && (
        <div className="rounded-xl border border-white/[0.06] bg-gray-900/50 p-5 animate-fade-in-up">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  selectedCompany.relationship === 'supplier' ? 'bg-cyan-500' :
                  selectedCompany.relationship === 'customer' ? 'bg-amber-500' :
                  'bg-violet-500'
                }`} />
                <h3 className="text-base font-bold text-white">{selectedCompany.symbol}</h3>
                <span className="text-xs text-gray-500">{selectedCompany.name}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  selectedCompany.relationship === 'supplier' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
                  selectedCompany.relationship === 'customer' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                  'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                }`}>
                  {selectedCompany.relationship.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <div className="text-[10px] text-gray-600 uppercase">Price</div>
                  <div className="text-sm font-semibold text-white font-mono">${selectedCompany.price?.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase">Change</div>
                  <div className={`text-sm font-semibold font-mono ${(selectedCompany.change || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {(selectedCompany.change || 0) >= 0 ? '+' : ''}{(selectedCompany.change || 0).toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase">Mkt Cap</div>
                  <div className="text-sm font-semibold text-white">{fmtMktCap(selectedCompany.mktCap)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase">Sector</div>
                  <div className="text-xs text-gray-400 truncate">{selectedCompany.sector || '–'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-600 uppercase">Industry</div>
                  <div className="text-xs text-gray-400 truncate">{selectedCompany.industry || '–'}</div>
                </div>
              </div>
            </div>
            <button
              onClick={() => navigateToAnalysis(selectedCompany.symbol)}
              className="shrink-0 px-4 py-2 bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] rounded-lg text-xs font-semibold text-gray-300 transition"
            >
              Analyze {selectedCompany.symbol} →
            </button>
          </div>
        </div>
      )}

      {/* ── Relationship Table ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Suppliers Table */}
        <div className="rounded-xl border border-cyan-500/10 bg-gray-900/30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-cyan-500/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500" />
            <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Suppliers</span>
            <span className="text-[10px] text-gray-600 ml-auto">{suppliers.length}</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {suppliers.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-4">No suppliers identified</p>
            ) : suppliers.map(s => (
              <div
                key={s.symbol}
                className="flex items-center justify-between px-4 py-2 hover:bg-cyan-500/[0.04] transition cursor-pointer"
                onClick={() => navigateToAnalysis(s.symbol)}
                onMouseEnter={() => setHoveredNode(s.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div>
                  <span className="font-semibold text-xs text-cyan-300 font-mono">{s.symbol}</span>
                  <span className="text-[10px] text-gray-500 ml-2 hidden sm:inline">{s.industry}</span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">{fmtMktCap(s.mktCap)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Customers Table */}
        <div className="rounded-xl border border-amber-500/10 bg-gray-900/30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-amber-500/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Customers</span>
            <span className="text-[10px] text-gray-600 ml-auto">{customers.length}</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {customers.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-4">No customers identified</p>
            ) : customers.map(c => (
              <div
                key={c.symbol}
                className="flex items-center justify-between px-4 py-2 hover:bg-amber-500/[0.04] transition cursor-pointer"
                onClick={() => navigateToAnalysis(c.symbol)}
                onMouseEnter={() => setHoveredNode(c.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div>
                  <span className="font-semibold text-xs text-amber-300 font-mono">{c.symbol}</span>
                  <span className="text-[10px] text-gray-500 ml-2 hidden sm:inline">{c.industry}</span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">{fmtMktCap(c.mktCap)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Competitors Table */}
        <div className="rounded-xl border border-violet-500/10 bg-gray-900/30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-violet-500/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-500" />
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Comps</span>
            <span className="text-[10px] text-gray-600 ml-auto">{competitors.length}</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {competitors.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-4">No comps identified</p>
            ) : competitors.map(c => (
              <div
                key={c.symbol}
                className="flex items-center justify-between px-4 py-2 hover:bg-violet-500/[0.04] transition cursor-pointer"
                onClick={() => navigateToAnalysis(c.symbol)}
                onMouseEnter={() => setHoveredNode(c.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div>
                  <span className="font-semibold text-xs text-violet-300 font-mono">{c.symbol}</span>
                  <span className="text-[10px] text-gray-500 ml-2 hidden sm:inline">{c.industry}</span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">{fmtMktCap(c.mktCap)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-gray-700 text-center">
        Supply chain relationships are derived from GICS industry classification. Companies shown are major
        players in related industries ranked by market cap. Actual contractual relationships may differ.
      </p>
    </div>
  );
}
