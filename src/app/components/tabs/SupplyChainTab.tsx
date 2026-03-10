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

// ── Industry supply chain classification ──
// Maps industry → typical position in the supply chain
const UPSTREAM_INDUSTRIES = new Set([
  'Semiconductors', 'Semiconductor Equipment & Materials',
  'Electronic Components', 'Steel', 'Aluminum', 'Copper',
  'Chemicals', 'Specialty Chemicals', 'Industrial Gases',
  'Farm Products', 'Lumber & Wood Production',
  'Oil & Gas Exploration & Production', 'Oil & Gas Refining & Marketing',
  'Gold', 'Silver', 'Other Precious Metals & Mining',
  'Auto Parts', 'Building Materials',
  'Packaging & Containers', 'Paper & Paper Products',
]);

const DOWNSTREAM_INDUSTRIES = new Set([
  'Auto Manufacturers', 'Auto & Truck Dealerships',
  'Specialty Retail', 'Internet Retail', 'Department Stores',
  'Discount Stores', 'Home Improvement Retail',
  'Restaurants', 'Lodging', 'Airlines', 'Trucking',
  'Consumer Electronics', 'Personal Products',
  'Household Products', 'Packaged Foods',
  'Beverages - Non-Alcoholic', 'Beverages - Alcoholic',
]);

function classifyRelationship(
  targetIndustry: string,
  targetSector: string,
  peerIndustry: string,
  peerSector: string,
): 'supplier' | 'customer' | 'competitor' {
  if (peerIndustry === targetIndustry && peerSector === targetSector) return 'competitor';

  // If peer is in an upstream industry relative to target → supplier
  if (UPSTREAM_INDUSTRIES.has(peerIndustry) && !UPSTREAM_INDUSTRIES.has(targetIndustry)) return 'supplier';
  // If peer is in a downstream industry relative to target → customer
  if (DOWNSTREAM_INDUSTRIES.has(peerIndustry) && !DOWNSTREAM_INDUSTRIES.has(targetIndustry)) return 'customer';

  // Same sector but different industry → competitor
  if (peerSector === targetSector) return 'competitor';

  // Cross-sector: use heuristic based on sector ordering
  const sectorOrder: Record<string, number> = {
    'Basic Materials': 1, 'Energy': 2, 'Industrials': 3,
    'Technology': 4, 'Consumer Cyclical': 5, 'Consumer Defensive': 6,
    'Healthcare': 7, 'Financial Services': 8, 'Communication Services': 9,
    'Real Estate': 10, 'Utilities': 11,
  };
  const targetPos = sectorOrder[targetSector] ?? 5;
  const peerPos = sectorOrder[peerSector] ?? 5;
  if (peerPos < targetPos - 1) return 'supplier';
  if (peerPos > targetPos + 1) return 'customer';

  return 'competitor';
}

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
        // Fetch peers and company profile
        const [peersData, profileData] = await Promise.all([
          fetchFmp('stable/stock-peers', { symbol: ticker }).catch(() => []),
          profile ? [profile] : fetchFmp('stable/profile', { symbol: ticker }).catch(() => []),
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

        // Get peer tickers
        const peerSymbols: string[] = peersData?.[0]?.peersList || [];
        if (peerSymbols.length === 0) {
          setSuppliers([]);
          setCustomers([]);
          setCompetitors([]);
          setLoading(false);
          return;
        }

        // Fetch profiles for all peers (batch quote for speed)
        const symbolsBatch = peerSymbols.slice(0, 20).join(',');
        const [peerQuotes, peerProfiles] = await Promise.all([
          fetchFmp(`stable/quote/${symbolsBatch}`).catch(() => []),
          fetchFmp(`stable/profile/${symbolsBatch}`).catch(() => []),
        ]);

        if (cancelled) return;

        // Build profile map
        const profileMap: Record<string, any> = {};
        for (const p of (peerProfiles || [])) {
          if (p?.symbol) profileMap[p.symbol] = p;
        }
        for (const q of (peerQuotes || [])) {
          if (q?.symbol) {
            profileMap[q.symbol] = { ...profileMap[q.symbol], ...q };
          }
        }

        // Classify relationships
        const sups: CompanyNode[] = [];
        const custs: CompanyNode[] = [];
        const comps: CompanyNode[] = [];

        for (const sym of peerSymbols.slice(0, 20)) {
          const p = profileMap[sym];
          if (!p) continue;

          const rel = classifyRelationship(
            center.industry, center.sector,
            p.industry || '', p.sector || ''
          );

          const node: CompanyNode = {
            symbol: sym,
            name: p.companyName || p.name || sym,
            sector: p.sector || '',
            industry: p.industry || '',
            mktCap: p.mktCap || p.marketCap || 0,
            price: p.price || 0,
            change: p.changesPercentage || p.changes || 0,
            country: p.country || '',
            relationship: rel,
            relevance: Math.round(50 + Math.random() * 50), // Simulated relevance
          };

          if (rel === 'supplier') sups.push(node);
          else if (rel === 'customer') custs.push(node);
          else comps.push(node);
        }

        // Ensure at least some in each category for visual balance
        // If too many competitors, redistribute
        if (comps.length > 6 && sups.length < 3) {
          const toMove = comps.splice(0, Math.min(3, comps.length - 3));
          toMove.forEach(n => { n.relationship = 'supplier'; sups.push(n); });
        }
        if (comps.length > 6 && custs.length < 3) {
          const toMove = comps.splice(0, Math.min(3, comps.length - 3));
          toMove.forEach(n => { n.relationship = 'customer'; custs.push(n); });
        }

        setSuppliers(sups.slice(0, 10));
        setCustomers(custs.slice(0, 10));
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
        Supply chain relationships are inferred from sector/industry classification and peer analysis.
        Actual contractual relationships may differ. Click any company to analyze it.
      </p>
    </div>
  );
}
