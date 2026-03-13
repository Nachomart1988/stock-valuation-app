'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/* ───────────────────────────────────────────────────────────
   SUPPLY CHAIN ANALYSIS TAB  v2
   Bloomberg Terminal-inspired supply chain visualization.
   Now backed by real curated + inferred data from backend engine.
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
  exposure: number;       // estimated revenue exposure %
  correlation: number;    // price correlation with center
  relevance: number;      // 0-100 composite score
  isCurated: boolean;     // from curated database vs inferred
}

interface SupplyChainStats {
  total_suppliers: number;
  total_customers: number;
  total_competitors: number;
  avg_supplier_correlation: number;
  avg_customer_correlation: number;
  total_supplier_exposure: number;
  total_customer_exposure: number;
  data_quality: 'high' | 'medium' | 'low';
}

interface SupplyChainResult {
  center: CompanyNode;
  suppliers: CompanyNode[];
  customers: CompanyNode[];
  competitors: CompanyNode[];
  data_source: 'curated' | 'industry_inferred' | 'peer_fallback';
  stats: SupplyChainStats;
}

interface SupplyChainTabProps {
  ticker: string;
  profile?: any;
}

function fmtMktCap(v: number): string {
  if (!v) return '–';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtCorr(c: number): string {
  return c.toFixed(2);
}

const DATA_QUALITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high:   { bg: 'bg-emerald-900/30', text: 'text-emerald-400', label: 'Curated Data' },
  medium: { bg: 'bg-yellow-900/30',  text: 'text-yellow-400',  label: 'Industry Inferred' },
  low:    { bg: 'bg-red-900/30',     text: 'text-red-400',     label: 'Peer Fallback' },
};

export default function SupplyChainTab({ ticker, profile }: SupplyChainTabProps) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SupplyChainResult | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1200, height: 700 });
  const [sortBy, setSortBy] = useState<'relevance' | 'exposure' | 'mktCap' | 'correlation'>('relevance');

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

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
      setResult(null);

      try {
        const resp = await fetch(`${backendUrl}/supply-chain/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: 'Unknown error' }));
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        if (!cancelled) {
          setResult(data);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load supply chain data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSupplyChain();
    return () => { cancelled = true; };
  }, [ticker, backendUrl]);

  const navigateToAnalysis = useCallback((symbol: string) => {
    router.push(`/analizar?ticker=${symbol}`);
  }, [router]);

  // Sort nodes
  const sortFn = useCallback((a: CompanyNode, b: CompanyNode) => {
    switch (sortBy) {
      case 'exposure': return (b.exposure || 0) - (a.exposure || 0);
      case 'mktCap': return (b.mktCap || 0) - (a.mktCap || 0);
      case 'correlation': return Math.abs(b.correlation || 0) - Math.abs(a.correlation || 0);
      default: return (b.relevance || 0) - (a.relevance || 0);
    }
  }, [sortBy]);

  const suppliers = useMemo(() => [...(result?.suppliers || [])].sort(sortFn), [result?.suppliers, sortFn]);
  const customers = useMemo(() => [...(result?.customers || [])].sort(sortFn), [result?.customers, sortFn]);
  const competitors = useMemo(() => [...(result?.competitors || [])].sort(sortFn), [result?.competitors, sortFn]);

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
  }, [competitors, W, H, centerX]);

  const selectedCompany = useMemo(() => {
    if (!selectedNode) return null;
    return [...suppliers, ...customers, ...competitors].find(n => n.symbol === selectedNode) || null;
  }, [selectedNode, suppliers, customers, competitors]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading real supply chain data for {ticker}...</p>
        <p className="text-gray-600 text-xs">Fetching profiles, correlations & exposure data</p>
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

  if (!result) return null;

  const { center } = result;
  const stats = result.stats;
  const quality = DATA_QUALITY_STYLES[stats.data_quality] || DATA_QUALITY_STYLES.low;

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
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${quality.bg} ${quality.text} border border-current/20`}>
              {quality.label}
            </span>
          </h2>
          <p className="text-gray-500 text-xs mt-1">
            {center.name} — Real supply chain exposure with price correlation
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

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Supplier Exposure', value: `${stats.total_supplier_exposure.toFixed(1)}%`, sub: `${stats.total_suppliers} companies` },
          { label: 'Customer Exposure', value: `${stats.total_customer_exposure.toFixed(1)}%`, sub: `${stats.total_customers} companies` },
          { label: 'Avg Supplier Corr', value: fmtCorr(stats.avg_supplier_correlation), sub: 'Pearson (1Y)' },
          { label: 'Avg Customer Corr', value: fmtCorr(stats.avg_customer_correlation), sub: 'Pearson (1Y)' },
          { label: 'Data Source', value: result.data_source.replace('_', ' '), sub: stats.data_quality + ' quality' },
        ].map(item => (
          <div key={item.label} className="bg-black/30 rounded-xl border border-green-900/15 p-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider">{item.label}</p>
            <p className="text-lg font-bold text-white mt-1 font-data">{item.value}</p>
            <p className="text-[10px] text-gray-600">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* Graph Container */}
      <div ref={containerRef} className="relative rounded-xl border border-white/[0.06] bg-gray-900/40 overflow-hidden">
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minHeight: 500 }}
        >
          <defs>
            <linearGradient id="grad-supplier" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(6,182,212,0.5)" />
              <stop offset="100%" stopColor="rgba(6,182,212,0.08)" />
            </linearGradient>
            <linearGradient id="grad-customer" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(245,158,11,0.08)" />
              <stop offset="100%" stopColor="rgba(245,158,11,0.5)" />
            </linearGradient>
            <filter id="glow-center" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ── Connection Lines — weighted by relevance ── */}
          {suppliers.map((s, i) => {
            const pos = supplierPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === s.symbol;
            const lineWidth = Math.max(0.5, Math.min(3, s.relevance / 30));
            return (
              <g key={`line-s-${s.symbol}`}>
                <path
                  d={`M ${pos.x + 60} ${pos.y} C ${centerX * 0.5} ${pos.y}, ${centerX * 0.5} ${centerY}, ${centerX - 80} ${centerY}`}
                  fill="none"
                  stroke={isHovered ? 'rgba(6,182,212,0.7)' : 'url(#grad-supplier)'}
                  strokeWidth={isHovered ? lineWidth + 1 : lineWidth}
                  className="transition-all duration-200"
                />
                {/* Exposure label on line */}
                {s.exposure > 0 && (
                  <text
                    x={(pos.x + 60 + centerX - 80) / 2}
                    y={pos.y + (centerY - pos.y) * 0.3 - 6}
                    textAnchor="middle"
                    fill="rgba(6,182,212,0.4)"
                    fontSize={8}
                    fontWeight={600}
                  >
                    {s.exposure.toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
          {customers.map((c, i) => {
            const pos = customerPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === c.symbol;
            const lineWidth = Math.max(0.5, Math.min(3, c.relevance / 30));
            return (
              <g key={`line-c-${c.symbol}`}>
                <path
                  d={`M ${centerX + 80} ${centerY} C ${centerX + (W - centerX) * 0.5} ${centerY}, ${centerX + (W - centerX) * 0.5} ${pos.y}, ${pos.x - 60} ${pos.y}`}
                  fill="none"
                  stroke={isHovered ? 'rgba(245,158,11,0.7)' : 'url(#grad-customer)'}
                  strokeWidth={isHovered ? lineWidth + 1 : lineWidth}
                  className="transition-all duration-200"
                />
                {c.exposure > 0 && (
                  <text
                    x={(centerX + 80 + pos.x - 60) / 2}
                    y={centerY + (pos.y - centerY) * 0.3 - 6}
                    textAnchor="middle"
                    fill="rgba(245,158,11,0.4)"
                    fontSize={8}
                    fontWeight={600}
                  >
                    {c.exposure.toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
          {competitors.map((c, i) => {
            const pos = competitorPositions[i];
            if (!pos) return null;
            const isHovered = hoveredNode === c.symbol;
            return (
              <line
                key={`line-comp-${c.symbol}`}
                x1={centerX} y1={centerY + 30}
                x2={pos.x} y2={pos.y - 18}
                stroke={isHovered ? 'rgba(139,92,246,0.6)' : 'rgba(139,92,246,0.12)'}
                strokeWidth={isHovered ? 1.5 : 0.7}
                strokeDasharray={isHovered ? 'none' : '4 4'}
                className="transition-all duration-200"
              />
            );
          })}

          {/* Flow labels */}
          {suppliers.length > 0 && (
            <g>
              <rect x={centerX * 0.38 - 40} y={centerY - 10} width={80} height={20} rx={10} fill="rgba(6,182,212,0.08)" stroke="rgba(6,182,212,0.2)" strokeWidth={0.5} />
              <text x={centerX * 0.38} y={centerY + 4} textAnchor="middle" fill="rgba(6,182,212,0.6)" fontSize={10} fontWeight={600}>
                {suppliers.length} Suppliers
              </text>
            </g>
          )}
          {customers.length > 0 && (
            <g>
              <rect x={centerX + (W - centerX) * 0.62 - 42} y={centerY - 10} width={84} height={20} rx={10} fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.2)" strokeWidth={0.5} />
              <text x={centerX + (W - centerX) * 0.62} y={centerY + 4} textAnchor="middle" fill="rgba(245,158,11,0.6)" fontSize={10} fontWeight={600}>
                {customers.length} Customers
              </text>
            </g>
          )}
          {competitors.length > 0 && (
            <text x={centerX} y={H - 8} textAnchor="middle" fill="rgba(139,92,246,0.5)" fontSize={10} fontWeight={600}>
              {competitors.length} Comps
            </text>
          )}

          {/* ── CENTER NODE ── */}
          <g filter="url(#glow-center)">
            <rect x={centerX - 78} y={centerY - 32} width={156} height={64} rx={8}
              fill="#064e3b" stroke="#10b981" strokeWidth={1.5} />
            <text x={centerX} y={centerY - 10} textAnchor="middle" fill="#34d399" fontSize={14} fontWeight={800}>
              {center.symbol}
            </text>
            <text x={centerX} y={centerY + 8} textAnchor="middle" fill="#a7f3d0" fontSize={9}>
              {center.name.length > 22 ? center.name.slice(0, 22) + '…' : center.name}
            </text>
            <text x={centerX} y={centerY + 22} textAnchor="middle" fill="#6ee7b7" fontSize={8} fontWeight={600}>
              {fmtMktCap(center.mktCap)}
            </text>
          </g>

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
                onClick={() => setSelectedNode(s.symbol === selectedNode ? null : s.symbol)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={pos.x - 55} y={pos.y - 18} width={110} height={36} rx={6}
                  fill={isHovered || isSelected ? 'rgba(6,182,212,0.15)' : 'rgba(6,182,212,0.06)'}
                  stroke={isHovered || isSelected ? 'rgba(6,182,212,0.5)' : 'rgba(6,182,212,0.15)'}
                  strokeWidth={isHovered ? 1.5 : 0.7}
                  className="transition-all duration-150"
                />
                <text x={pos.x} y={pos.y - 3} textAnchor="middle" fill={isHovered ? '#22d3ee' : '#67e8f9'} fontSize={11} fontWeight={700}>
                  {s.symbol}
                </text>
                <text x={pos.x} y={pos.y + 10} textAnchor="middle" fill="rgba(6,182,212,0.5)" fontSize={7.5}>
                  {fmtMktCap(s.mktCap)}{s.exposure > 0 ? ` · ${s.exposure}%` : ''}
                </text>
                {s.isCurated && (
                  <circle cx={pos.x + 50} cy={pos.y - 14} r={3} fill="#22d3ee" opacity={0.6} />
                )}
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
                onClick={() => setSelectedNode(c.symbol === selectedNode ? null : c.symbol)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={pos.x - 55} y={pos.y - 18} width={110} height={36} rx={6}
                  fill={isHovered || isSelected ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.06)'}
                  stroke={isHovered || isSelected ? 'rgba(245,158,11,0.5)' : 'rgba(245,158,11,0.15)'}
                  strokeWidth={isHovered ? 1.5 : 0.7}
                  className="transition-all duration-150"
                />
                <text x={pos.x} y={pos.y - 3} textAnchor="middle" fill={isHovered ? '#fbbf24' : '#fcd34d'} fontSize={11} fontWeight={700}>
                  {c.symbol}
                </text>
                <text x={pos.x} y={pos.y + 10} textAnchor="middle" fill="rgba(245,158,11,0.5)" fontSize={7.5}>
                  {fmtMktCap(c.mktCap)}{c.exposure > 0 ? ` · ${c.exposure}%` : ''}
                </text>
                {c.isCurated && (
                  <circle cx={pos.x + 50} cy={pos.y - 14} r={3} fill="#fbbf24" opacity={0.6} />
                )}
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
                onClick={() => setSelectedNode(c.symbol === selectedNode ? null : c.symbol)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={pos.x - 42} y={pos.y - 16} width={84} height={32} rx={6}
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
          Sort by: {sortBy}
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
                {selectedCompany.isCurated && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-500/20">
                    VERIFIED
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-3">
                {[
                  { label: 'Price', value: `$${selectedCompany.price?.toFixed(2)}` },
                  { label: 'Change', value: `${(selectedCompany.change || 0) >= 0 ? '+' : ''}${(selectedCompany.change || 0).toFixed(2)}%`, color: (selectedCompany.change || 0) >= 0 ? 'text-green-400' : 'text-red-400' },
                  { label: 'Mkt Cap', value: fmtMktCap(selectedCompany.mktCap) },
                  { label: 'Exposure', value: selectedCompany.exposure > 0 ? `${selectedCompany.exposure}%` : '–' },
                  { label: 'Correlation', value: fmtCorr(selectedCompany.correlation) },
                  { label: 'Relevance', value: `${selectedCompany.relevance}/100` },
                  { label: 'Country', value: selectedCompany.country || '–' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="text-[10px] text-gray-600 uppercase">{item.label}</div>
                    <div className={`text-sm font-semibold font-mono ${(item as any).color || 'text-white'}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              {selectedCompany.description && (
                <p className="text-xs text-gray-500 mt-3 leading-relaxed">{selectedCompany.description}</p>
              )}
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

      {/* ── Sort controls ── */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">Sort by:</span>
        {(['relevance', 'exposure', 'mktCap', 'correlation'] as const).map(key => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            className={`px-2.5 py-1 rounded-lg transition capitalize ${
              sortBy === key
                ? 'bg-green-900/30 text-green-400 border border-green-500/30'
                : 'bg-black/30 text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            {key === 'mktCap' ? 'Market Cap' : key}
          </button>
        ))}
      </div>

      {/* ── Relationship Tables ── */}
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
                className="flex items-center justify-between px-4 py-2.5 hover:bg-cyan-500/[0.04] transition cursor-pointer"
                onClick={() => navigateToAnalysis(s.symbol)}
                onMouseEnter={() => setHoveredNode(s.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-cyan-300 font-mono">{s.symbol}</span>
                    {s.isCurated && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" title="Verified" />}
                  </div>
                  <span className="text-[10px] text-gray-600 truncate block">{s.name}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-[10px] text-gray-500 font-mono">{fmtMktCap(s.mktCap)}</div>
                  <div className="flex items-center gap-2 text-[9px]">
                    {s.exposure > 0 && <span className="text-cyan-400">{s.exposure}%</span>}
                    <span className="text-gray-600">r={fmtCorr(s.correlation)}</span>
                  </div>
                </div>
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
                className="flex items-center justify-between px-4 py-2.5 hover:bg-amber-500/[0.04] transition cursor-pointer"
                onClick={() => navigateToAnalysis(c.symbol)}
                onMouseEnter={() => setHoveredNode(c.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-amber-300 font-mono">{c.symbol}</span>
                    {c.isCurated && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Verified" />}
                  </div>
                  <span className="text-[10px] text-gray-600 truncate block">{c.name}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-[10px] text-gray-500 font-mono">{fmtMktCap(c.mktCap)}</div>
                  <div className="flex items-center gap-2 text-[9px]">
                    {c.exposure > 0 && <span className="text-amber-400">{c.exposure}%</span>}
                    <span className="text-gray-600">r={fmtCorr(c.correlation)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Competitors Table */}
        <div className="rounded-xl border border-violet-500/10 bg-gray-900/30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-violet-500/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-violet-500" />
            <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Competitors</span>
            <span className="text-[10px] text-gray-600 ml-auto">{competitors.length}</span>
          </div>
          <div className="divide-y divide-white/[0.03]">
            {competitors.length === 0 ? (
              <p className="text-gray-600 text-xs text-center py-4">No competitors identified</p>
            ) : competitors.map(c => (
              <div
                key={c.symbol}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-violet-500/[0.04] transition cursor-pointer"
                onClick={() => navigateToAnalysis(c.symbol)}
                onMouseEnter={() => setHoveredNode(c.symbol)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div className="min-w-0">
                  <span className="font-semibold text-xs text-violet-300 font-mono">{c.symbol}</span>
                  <span className="text-[10px] text-gray-600 truncate block">{c.name}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-[10px] text-gray-500 font-mono">{fmtMktCap(c.mktCap)}</div>
                  <span className="text-[9px] text-gray-600">r={fmtCorr(c.correlation)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-gray-700 text-center">
        {result.data_source === 'curated'
          ? 'Supply chain data from curated database of verified relationships. Exposure estimates based on public filings and analyst reports.'
          : result.data_source === 'industry_inferred'
          ? 'Relationships inferred from GICS industry classification. Companies are major players in related industries ranked by market cap. Actual contractual relationships may differ.'
          : 'Relationships based on peer classification. For more accurate data, curated relationships are available for major companies.'}
        {' '}Price correlations computed over 1-year daily returns (Pearson r).
      </p>
    </div>
  );
}
