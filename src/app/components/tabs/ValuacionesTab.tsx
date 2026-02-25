// src/app/components/tabs/ValuacionesTab.tsx
'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

// ────────────────────────────────────────────────
// HELPER FUNCTIONS FOR MULTI-STAGE VALUATION MODELS
// These are pure functions, defined outside the component to avoid re-creation
// ────────────────────────────────────────────────

// Calculate Present Value of a Growing Annuity (works for any g, even g > k)
// Formula: V = Σ(t=1 to n)[CF₀×(1+g)^t / (1+k)^t]
// Using geometric series: CF₀ × (1+g)/(k-g) × [1 - ((1+g)/(1+k))^n]
// Special case when k ≈ g: CF₀ × n × (1+g)/(1+k)
function calcPVGrowingAnnuity(cf0: number, g: number, k: number, periods: number): number {
  if (Math.abs(k - g) < 0.0001) {
    // When k ≈ g, use simplified formula
    return cf0 * periods * (1 + g) / (1 + k);
  }
  // Standard formula
  const growthFactor = (1 + g) / (1 + k);
  return cf0 * (1 + g) / (k - g) * (1 - Math.pow(growthFactor, periods));
}

// Calculate Terminal Value PV using Gordon Growth Model (requires k > gTerminal)
function calcTerminalValuePV(cfAtN: number, gTerminal: number, k: number, periods: number): number {
  if (k <= gTerminal) return 0; // Invalid - would be infinite
  // Safe denominator clamp to avoid extreme values when k is very close to gTerminal
  const safeDenom = Math.max(k - gTerminal, 0.005); // Minimum 0.5% spread
  const terminalValue = cfAtN * (1 + gTerminal) / safeDenom;
  return terminalValue / Math.pow(1 + k, periods);
}

// Collapsible Section Component
function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-gray-800/50 backdrop-blur">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between bg-gray-900 hover:from-gray-700 hover:to-gray-800 transition-all"
      >
        <div className="flex items-center gap-3">
          {icon && <span className="text-xl">{icon}</span>}
          <span className="text-lg font-semibold text-gray-100">{title}</span>
          {badge}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        className={`transition-all duration-300 ease-in-out ${
          isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
        }`}
      >
        <div className="p-5 bg-gray-900/30">{children}</div>
      </div>
    </div>
  );
}

// Model Card Component with explanation for null values AND collapsible inputs editor
function ModelCard({
  name,
  value,
  enabled,
  description,
  onToggle,
  nullReason,
  highlight = false,
  inputs,
  onInputChange,
}: {
  name: string;
  value: number | null;
  enabled: boolean;
  description?: string;
  onToggle: () => void;
  nullReason?: string;
  highlight?: boolean;
  inputs?: { label: string; key: string; value: number; step?: number; min?: number; max?: number }[];
  onInputChange?: (key: string, value: number) => void;
}) {
  const [showInputs, setShowInputs] = useState(false);
  // Local string state for each input to handle decimal typing without value being reset
  const [localInputs, setLocalInputs] = useState<Record<string, string>>({});
  const isValidValue = value !== null && value > 0 && isFinite(value);

  return (
    <div
      className={`relative p-5 rounded-2xl border-2 transition-all duration-200 ${
        enabled
          ? highlight
            ? 'bg-gray-950 border-green-500 shadow-lg shadow-green-500/20'
            : 'bg-gray-900 border-white/[0.08] hover:border-gray-500'
          : 'bg-gray-900/50 border-gray-800 opacity-60'
      }`}
    >
      {/* Toggle checkbox */}
      <div className="absolute top-3 right-3 flex items-center gap-2">
        {inputs && inputs.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowInputs(!showInputs); }}
            className={`p-1 rounded transition-all ${showInputs ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
            title="Editar inputs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="w-5 h-5 text-green-600 focus:ring-green-500 border-white/[0.08] rounded cursor-pointer accent-green-500"
        />
      </div>

      {/* Name */}
      <h4 className={`text-sm font-medium mb-3 pr-16 ${enabled ? 'text-gray-200' : 'text-gray-500'}`}>
        {name}
      </h4>

      {/* Value */}
      <p className={`text-3xl font-bold ${enabled ? isValidValue ? 'text-green-400' : 'text-gray-600' : 'text-gray-700'}`}>
        {isValidValue ? `$${value.toFixed(2)}` : '—'}
      </p>

      {/* Null reason or description */}
      {!isValidValue && nullReason && enabled && (
        <p className="text-xs text-amber-400 mt-2 bg-amber-900/30 px-2 py-1 rounded-lg">
          ⚠️ {nullReason}
        </p>
      )}
      {isValidValue && description && !showInputs && (
        <p className="text-xs text-gray-500 mt-2 truncate" title={description}>
          {description}
        </p>
      )}

      {/* Collapsible Inputs Editor */}
      {showInputs && inputs && inputs.length > 0 && onInputChange && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
          <p className="text-xs text-green-400 font-semibold mb-2">📝 Ajustar Inputs:</p>
          {inputs.map((input) => (
            <div key={input.key} className="flex items-center gap-2">
              <label className="text-xs text-gray-400 flex-1 truncate" title={input.label}>
                {input.label}
              </label>
              <input
                type="number"
                step={input.step || 0.01}
                min={input.min}
                max={input.max}
                value={input.key in localInputs ? localInputs[input.key] : String(input.value)}
                onChange={(e) => setLocalInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                onBlur={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) onInputChange(input.key, val);
                  setLocalInputs(prev => { const n = { ...prev }; delete n[input.key]; return n; });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="w-20 px-2 py-1 text-xs bg-gray-800 border border-white/[0.08] rounded text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ValuationMethod {
  name: string;
  value: number | null;
  enabled: boolean;
  description?: string;
}

interface PeerData {
  symbol: string;
  pe: number | null;
}

interface Props {
  ticker: string;
  income: any[];
  balance: any[];
  cashFlow: any[];
  cashFlowAsReported?: any[]; // For accurate dividend data
  dividends?: any[]; // Dividend history per share from /dividends endpoint
  priceTarget: any;
  profile: any;
  quote: any;
  dcfCustom?: any; // Para obtener Advance DCF equity value per share
  sustainableGrowthRate?: number | null; // SGR promedio del SustainableGrowthTab
  avgCAPMFromBeta?: number | null; // Average CAPM from BetaTab - THIS IS THE Ks TO USE!
  onAverageValChange?: (val: number | null) => void;
  onAdvanceValueNetChange?: (data: any) => void; // Callback for ResumenTab
  keyMetricsTTM?: any; // TTM Key Metrics from FMP (includes grahamNumber, grahamNetNet, etc.)
  ownerEarnings?: any[]; // Owner Earnings (Buffett method) from FMP
  cagrStats?: { avgCagr: number | null; minCagr: number | null; maxCagr: number | null } | null;
  dcfFromCalculos?: number | null; // Intrinsic value from Calculo tab
}

// ────────────────────────────────────────────────
// INDUSTRY WEIGHTS LOOKUP TABLE
// Maps (industry, paysDividends) → optimal model weights (relative, normalized at runtime)
// ────────────────────────────────────────────────
type WeightSet = Record<string, number>;

// Model name aliases
const MN = {
  DDM2:  '2-Stage DDM',
  DDM3:  '3-Stage DDM',
  HMOD:  'H Model',
  FCF2:  '2-Stage FCF',
  FCF3:  '3-Stage FCF',
  MTGT:  'Mean Target',
  GRM:   'Graham Method',
  RIM:   'RIM (Ohlson)',
  DCF:   'DCF',
  EPS:   'EPS*Benchmark',
  SDCF:  'Stochastic DCF',
  DSGE:  'Bayesian (NK DSGE)',
  HJM:   'HJM',
  FCFE2: '2-Stage FCFE',
  FCFE3: '3-Stage FCFE',
  FCFF2: '2-Stage FCFF',
  FCFF3: '3-Stage FCFF',
  ADCF:  'Advance DCF (API)',
  MCDCF: 'Monte Carlo DCF',
  DCFC:  'DCF (Cálculos)',
  GN:    'Graham Number (API)',
  GNN:   'Graham Net-Net (API)',
  OE:    'Owner Earnings (Buffett)',
  PR:    'Price Return (T5)',
} as const;

const ALL_MODEL_NAMES: string[] = Object.values(MN);

// Index [0] = no dividend, [1] = pays dividend
const INDUSTRY_WEIGHTS: Record<string, [WeightSet, WeightSet]> = {
  // ── Technology ──
  'Software - Application':      [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.FCF3]:10,[MN.MCDCF]:10,[MN.MTGT]:10,[MN.OE]:5,[MN.SDCF]:5 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:10 }],
  'Software - Infrastructure':   [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.FCF3]:10,[MN.MCDCF]:10,[MN.MTGT]:10,[MN.OE]:5,[MN.SDCF]:5 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:10 }],
  'Semiconductors':               [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:10,[MN.EPS]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:10,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:10,[MN.EPS]:5 }],
  'Semiconductor Equipment':      [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:10,[MN.EPS]:10 },{ [MN.DDM2]:10,[MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:10 }],
  'Consumer Electronics':         [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.EPS]:15,[MN.MTGT]:10,[MN.GRM]:10 },{ [MN.DDM2]:15,[MN.DCF]:15,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15,[MN.EPS]:10 }],
  'Internet Content & Information':[{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:20,[MN.MCDCF]:15,[MN.MTGT]:15,[MN.SDCF]:5 },{ [MN.DDM2]:10,[MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:20,[MN.MCDCF]:15,[MN.MTGT]:15 }],
  'Electronic Components':        [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.EPS]:20,[MN.GRM]:15,[MN.MTGT]:15 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.EPS]:15,[MN.GRM]:15,[MN.MTGT]:15 }],
  'Information Technology Services':[{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15,[MN.EPS]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:20 }],
  // ── Healthcare ──
  'Biotechnology':                [{ [MN.DCF]:30,[MN.ADCF]:25,[MN.MCDCF]:20,[MN.SDCF]:15,[MN.MTGT]:10 },{ [MN.DDM2]:10,[MN.DCF]:25,[MN.ADCF]:20,[MN.MCDCF]:20,[MN.SDCF]:15,[MN.MTGT]:10 }],
  'Drug Manufacturers - General': [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:15,[MN.MTGT]:15,[MN.OE]:10 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:5 }],
  'Drug Manufacturers - Specialty & Generic':[{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:15,[MN.MTGT]:15,[MN.OE]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.MTGT]:15,[MN.OE]:5 }],
  'Medical Devices':              [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15,[MN.EPS]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15,[MN.EPS]:5 }],
  'Medical Instruments & Supplies':[{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15,[MN.EPS]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15,[MN.EPS]:5 }],
  'Health Care Plans':            [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:20,[MN.EPS]:20,[MN.MTGT]:15,[MN.OE]:5 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Hospitals':                    [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:20,[MN.FCFF2]:15,[MN.EPS]:15,[MN.MTGT]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.FCFF2]:15,[MN.MTGT]:15 }],
  // ── Financial ──
  'Banks - Regional':             [{ [MN.RIM]:25,[MN.EPS]:20,[MN.GRM]:15,[MN.GN]:15,[MN.MTGT]:15,[MN.DCFC]:10 },{ [MN.DDM2]:25,[MN.DDM3]:15,[MN.RIM]:20,[MN.EPS]:15,[MN.GN]:10,[MN.MTGT]:15 }],
  'Banks - Diversified':          [{ [MN.RIM]:25,[MN.EPS]:20,[MN.GRM]:15,[MN.GN]:15,[MN.MTGT]:15,[MN.DCFC]:10 },{ [MN.DDM2]:25,[MN.DDM3]:15,[MN.RIM]:20,[MN.EPS]:15,[MN.GN]:10,[MN.MTGT]:15 }],
  'Insurance - Life':             [{ [MN.RIM]:20,[MN.DCF]:20,[MN.EPS]:20,[MN.GN]:15,[MN.MTGT]:15,[MN.DSGE]:10 },{ [MN.DDM2]:25,[MN.RIM]:20,[MN.DCF]:15,[MN.EPS]:15,[MN.GN]:10,[MN.MTGT]:15 }],
  'Insurance - Property & Casualty':[{ [MN.RIM]:20,[MN.DCF]:20,[MN.EPS]:20,[MN.GN]:15,[MN.MTGT]:15,[MN.DSGE]:10 },{ [MN.DDM2]:25,[MN.RIM]:20,[MN.DCF]:15,[MN.EPS]:15,[MN.GN]:10,[MN.MTGT]:15 }],
  'Insurance - Diversified':      [{ [MN.RIM]:20,[MN.DCF]:20,[MN.EPS]:20,[MN.GN]:15,[MN.MTGT]:15,[MN.DSGE]:10 },{ [MN.DDM2]:25,[MN.RIM]:20,[MN.DCF]:15,[MN.EPS]:15,[MN.GN]:10,[MN.MTGT]:15 }],
  'Asset Management':             [{ [MN.RIM]:20,[MN.DCF]:20,[MN.FCF2]:20,[MN.EPS]:20,[MN.MTGT]:20 },{ [MN.DDM2]:25,[MN.DDM3]:10,[MN.RIM]:20,[MN.DCF]:15,[MN.FCF2]:15,[MN.MTGT]:15 }],
  'Capital Markets':              [{ [MN.RIM]:20,[MN.DCF]:20,[MN.FCF2]:20,[MN.EPS]:20,[MN.MTGT]:20 },{ [MN.DDM2]:20,[MN.RIM]:20,[MN.DCF]:15,[MN.FCF2]:20,[MN.EPS]:15,[MN.MTGT]:10 }],
  'Real Estate Investment Trusts (REITs)':[{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFE2]:20,[MN.MTGT]:20,[MN.GN]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.FCFE2]:15,[MN.MTGT]:15 }],
  'REIT - Diversified':           [{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFE2]:20,[MN.MTGT]:20,[MN.GN]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.FCFE2]:15,[MN.MTGT]:15 }],
  'REIT - Office':                [{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFE2]:20,[MN.MTGT]:20,[MN.GN]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.FCFE2]:15,[MN.MTGT]:15 }],
  'REIT - Retail':                [{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFE2]:20,[MN.MTGT]:20,[MN.GN]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.FCFE2]:15,[MN.MTGT]:15 }],
  'REIT - Residential':           [{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFE2]:20,[MN.MTGT]:20,[MN.GN]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.FCFE2]:15,[MN.MTGT]:15 }],
  // ── Energy ──
  'Oil & Gas E&P':                [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MCDCF]:15,[MN.MTGT]:10,[MN.OE]:10 },{ [MN.DDM2]:10,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:15,[MN.MTGT]:10,[MN.OE]:10 }],
  'Oil & Gas Integrated':         [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MCDCF]:15,[MN.MTGT]:15,[MN.OE]:10 },{ [MN.DDM2]:20,[MN.DDM3]:10,[MN.DCF]:15,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:10,[MN.MTGT]:10 }],
  'Oil & Gas Midstream':          [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MTGT]:20,[MN.OE]:15 },{ [MN.DDM2]:25,[MN.DDM3]:10,[MN.DCF]:20,[MN.FCFF2]:20,[MN.MTGT]:15,[MN.OE]:10 }],
  'Oil & Gas Refining & Marketing':[{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.EPS]:15,[MN.MTGT]:20 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.EPS]:10,[MN.MTGT]:15 }],
  'Utilities - Regulated Electric':[{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MTGT]:20,[MN.DSGE]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.MTGT]:15 }],
  'Utilities - Regulated Gas':    [{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MTGT]:20,[MN.DSGE]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.MTGT]:15 }],
  'Utilities - Regulated Water':  [{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MTGT]:20,[MN.DSGE]:10 },{ [MN.DDM2]:35,[MN.DDM3]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.MTGT]:15 }],
  'Utilities - Diversified':      [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MTGT]:20,[MN.DSGE]:15 },{ [MN.DDM2]:30,[MN.DDM3]:10,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:15,[MN.MTGT]:10 }],
  'Utilities - Independent Power Producers':[{ [MN.DCF]:30,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.MCDCF]:15,[MN.MTGT]:15 },{ [MN.DDM2]:25,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:10,[MN.MTGT]:10 }],
  // ── Consumer Staples ──
  'Grocery Stores':               [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:25,[MN.DCF]:15,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15 }],
  'Beverages - Non-Alcoholic':    [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.OE]:20,[MN.FCF2]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:25,[MN.DDM3]:10,[MN.DCF]:15,[MN.OE]:20,[MN.FCF2]:15,[MN.MTGT]:15 }],
  'Beverages - Alcoholic':        [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.OE]:20,[MN.FCF2]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:20,[MN.DDM3]:10,[MN.DCF]:15,[MN.OE]:20,[MN.FCF2]:15,[MN.MTGT]:20 }],
  'Packaged Foods':               [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.OE]:20,[MN.FCF2]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:25,[MN.DDM3]:10,[MN.DCF]:15,[MN.OE]:15,[MN.FCF2]:15,[MN.MTGT]:20 }],
  'Household & Personal Products':[{ [MN.DCF]:20,[MN.ADCF]:20,[MN.OE]:15,[MN.FCF2]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:25,[MN.DDM3]:10,[MN.DCF]:15,[MN.OE]:15,[MN.FCF2]:15,[MN.MTGT]:20 }],
  'Tobacco':                      [{ [MN.DCF]:15,[MN.ADCF]:15,[MN.OE]:20,[MN.FCF2]:20,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:30,[MN.DDM3]:15,[MN.DCF]:15,[MN.OE]:20,[MN.FCF2]:10,[MN.MTGT]:10 }],
  // ── Consumer Discretionary ──
  'Auto Manufacturers':           [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.EPS]:20,[MN.GRM]:10,[MN.MTGT]:15 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Auto Parts':                   [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.EPS]:20,[MN.GRM]:10,[MN.MTGT]:15 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Restaurants':                  [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:20,[MN.EPS]:20,[MN.MTGT]:20 },{ [MN.DDM2]:15,[MN.DDM3]:5,[MN.DCF]:20,[MN.FCF2]:20,[MN.EPS]:20,[MN.MTGT]:20 }],
  'Specialty Retail':             [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.OE]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.OE]:10,[MN.EPS]:10,[MN.MTGT]:10 }],
  'Department Stores':            [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.GN]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.GN]:10,[MN.EPS]:10,[MN.MTGT]:10 }],
  'Luxury Goods':                 [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.EPS]:15,[MN.MTGT]:10 },{ [MN.DDM2]:15,[MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15 }],
  'Internet Retail':              [{ [MN.DCF]:30,[MN.ADCF]:25,[MN.FCF2]:20,[MN.MCDCF]:15,[MN.MTGT]:10 },{ [MN.DDM2]:10,[MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:20,[MN.MCDCF]:15,[MN.MTGT]:10 }],
  'Home Improvement Retail':      [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:20,[MN.OE]:15,[MN.EPS]:15,[MN.MTGT]:10 },{ [MN.DDM2]:20,[MN.DCF]:15,[MN.ADCF]:15,[MN.FCF2]:20,[MN.OE]:15,[MN.MTGT]:15 }],
  // ── Industrial ──
  'Aerospace & Defense':          [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.OE]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:15,[MN.DDM3]:5,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:15,[MN.MTGT]:15 }],
  'Industrial Machinery':         [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.FCFF2]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.FCFF2]:10,[MN.EPS]:10,[MN.MTGT]:10 }],
  'Specialty Industrial Machinery':[{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.FCFF2]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.FCFF2]:10,[MN.EPS]:10,[MN.MTGT]:10 }],
  'Airlines':                     [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:25,[MN.MCDCF]:15,[MN.EPS]:15,[MN.MTGT]:10 },{ [MN.DDM2]:10,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:25,[MN.MCDCF]:15,[MN.EPS]:10,[MN.MTGT]:5 }],
  'Trucking':                     [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:20,[MN.EPS]:20,[MN.MTGT]:20 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Railroads':                    [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.OE]:20,[MN.MTGT]:20 },{ [MN.DDM2]:25,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:15,[MN.OE]:15,[MN.MTGT]:10 }],
  // ── Telecom ──
  'Telecom Services':             [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.EPS]:15,[MN.MTGT]:20 },{ [MN.DDM2]:30,[MN.DDM3]:10,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:15,[MN.MTGT]:10 }],
  'Communication Services':       [{ [MN.DCF]:25,[MN.ADCF]:20,[MN.FCF2]:20,[MN.MTGT]:20,[MN.MCDCF]:15 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:20,[MN.MTGT]:15,[MN.MCDCF]:10 }],
  // ── Materials ──
  'Gold':                         [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:25,[MN.MTGT]:20 },{ [MN.DDM2]:10,[MN.DCF]:15,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:25,[MN.MTGT]:15 }],
  'Silver':                       [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:25,[MN.MTGT]:20 },{ [MN.DDM2]:10,[MN.DCF]:15,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.MCDCF]:25,[MN.MTGT]:15 }],
  'Steel':                        [{ [MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:20,[MN.EPS]:20,[MN.GN]:10,[MN.MTGT]:15 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:15,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Chemicals':                    [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.EPS]:20,[MN.MTGT]:20 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:15,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Specialty Chemicals':          [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCFF2]:20,[MN.EPS]:20,[MN.MTGT]:20 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCFF2]:15,[MN.EPS]:15,[MN.MTGT]:15 }],
  'Building Materials':           [{ [MN.DCF]:20,[MN.ADCF]:20,[MN.FCFF2]:15,[MN.GN]:15,[MN.EPS]:15,[MN.MTGT]:15 },{ [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.GN]:10,[MN.EPS]:10,[MN.MTGT]:10 }],
};

const DEFAULT_WEIGHTS: [WeightSet, WeightSet] = [
  { [MN.DCF]:20,[MN.ADCF]:20,[MN.FCF2]:15,[MN.MCDCF]:10,[MN.OE]:10,[MN.EPS]:10,[MN.MTGT]:15 },
  { [MN.DDM2]:20,[MN.DCF]:20,[MN.ADCF]:15,[MN.FCF2]:15,[MN.OE]:10,[MN.EPS]:10,[MN.MTGT]:10 },
];

function getOptimalWeights(industry: string | undefined, paysDividends: boolean): Record<string, number> {
  const entry = (industry && INDUSTRY_WEIGHTS[industry]) ? INDUSTRY_WEIGHTS[industry] : DEFAULT_WEIGHTS;
  const partial: WeightSet = paysDividends ? entry[1] : entry[0];
  const result: Record<string, number> = {};
  ALL_MODEL_NAMES.forEach(name => { result[name] = partial[name] ?? 0; });
  return result;
}

export default function ValuacionesTab({
  ticker,
  income,
  balance,
  cashFlow,
  cashFlowAsReported,
  dividends,
  priceTarget,
  profile,
  quote,
  dcfCustom,
  sustainableGrowthRate,
  avgCAPMFromBeta,
  onAverageValChange,
  onAdvanceValueNetChange,
  keyMetricsTTM,
  ownerEarnings,
  cagrStats,
  dcfFromCalculos,
}: Props) {
  const { t } = useLanguage();

  // ────────────────────────────────────────────────
  // WEIGHTED AVERAGE STATE
  // ────────────────────────────────────────────────
  const paysDividends = Boolean(
    (dividends && dividends.length > 0 && dividends.some((d: any) => d.dividend > 0)) ||
    (profile?.lastDiv && profile.lastDiv > 0)
  );
  const [modelWeights, setModelWeights] = useState<Record<string, number>>(() =>
    getOptimalWeights(profile?.industry, paysDividends)
  );
  const [weightsCustomized, setWeightsCustomized] = useState(false);

  // Auto-reset weights when industry or dividend status changes (only if not customized)
  useEffect(() => {
    if (!weightsCustomized) {
      setModelWeights(getOptimalWeights(profile?.industry, paysDividends));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.industry, paysDividends]);

  const resetToOptimalWeights = () => {
    setModelWeights(getOptimalWeights(profile?.industry, paysDividends));
    setWeightsCustomized(false);
  };

  // ────────────────────────────────────────────────
  // Estados para parámetros del modelo
  // ────────────────────────────────────────────────
  const [h, setH] = useState<number>(5);
  const [glong, setGlong] = useState<number>(0.04);
  const [n, setN] = useState<number>(5);
  const [sharePriceTxCAGR, setSharePriceTxCAGR] = useState<number>(10); // CAGR in % for terminal share price
  const [manualSharePriceT5, setManualSharePriceT5] = useState<number | null>(null); // null = auto-calculate

  // Parámetros adicionales para modelos avanzados
  const [discountRate, setDiscountRate] = useState<number | null>(null); // WACC en %, null = auto-calculate
  const [exitMultiple, setExitMultiple] = useState<number>(12);
  const [projectedGrowthRate, setProjectedGrowthRate] = useState<number>(5);

  // Estados adicionales para inputs editables de modelos de valuación
  const [userD0, setUserD0] = useState<number | null>(null); // Override for D0 (dividend)
  const [userKs, setUserKs] = useState<number | null>(null); // Override for Ks (cost of equity) as decimal
  const [userGs, setUserGs] = useState<number | null>(null); // Override for gs (short-term growth) as decimal
  const [userEps, setUserEps] = useState<number | null>(null); // Override for EPS
  const [userBookValue, setUserBookValue] = useState<number | null>(null); // Override for Book Value
  const [userPeerPE, setUserPeerPE] = useState<number | null>(null); // Override for Peer P/E
  const [userNetDebt, setUserNetDebt] = useState<number | null>(null); // Override for Net Debt (in billions)
  const [userFcfo, setUserFcfo] = useState<number | null>(null); // Override for FCF0 per share

  // Estados para variables calculadas (usadas en getModelInputs)
  const [calcD0, setCalcD0] = useState<number>(0);
  const [calcKs, setCalcKs] = useState<number>(0.10);
  const [calcGs, setCalcGs] = useState<number>(0.08);
  const [calcFcfo, setCalcFcfo] = useState<number>(0);
  const [calcEpsTTM, setCalcEpsTTM] = useState<number>(0);
  const [calcBookValue, setCalcBookValue] = useState<number>(0);
  const [calcRoe, setCalcRoe] = useState<number>(0);
  const [calcFcfe, setCalcFcfe] = useState<number>(0);
  const [calcFcff, setCalcFcff] = useState<number>(0);
  const [calcNetDebt, setCalcNetDebt] = useState<number>(0);
  const [calcNetIncome, setCalcNetIncome] = useState<number>(0);
  const [calcDA, setCalcDA] = useState<number>(0);
  const [calcCapex, setCalcCapex] = useState<number>(0);
  const [calcAvgPeerPE, setCalcAvgPeerPE] = useState<number>(20);

  // Calculate Share Price TX based on avg of max/min CAGR from CAGR tab, fallback to manual input
  const currentPrice = quote?.price || 0;
  const effectiveCAGR = (cagrStats?.maxCagr != null && cagrStats?.minCagr != null)
    ? (cagrStats.maxCagr + cagrStats.minCagr) / 2
    : sharePriceTxCAGR;
  const autoSharePriceT5 = currentPrice * Math.pow(1 + effectiveCAGR / 100, n);
  const sharePriceT5 = manualSharePriceT5 !== null ? manualSharePriceT5 : autoSharePriceT5;

  // Calculate default WACC as average of WACC tab calculation and Advance DCF WACC
  const calculatedDefaultWACC = useMemo(() => {
    // Get WACC from dcfCustom (Advance DCF) - API returns WACC already as percentage (e.g., 8.88 means 8.88%)
    // Do NOT multiply by 100, it's already in percentage form
    const advanceDcfWacc = dcfCustom?.wacc ? dcfCustom.wacc : null;

    // Simple WACC calculation (similar to WACCTab)
    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const lastIncome = sortedIncome[0] || {};
    const lastBalance = sortedBalance[0] || {};

    // Cost of equity using CAPM: Re = Rf + β(Rm - Rf)
    const riskFreeRate = 0.04; // 4% default
    const marketReturn = 0.10; // 10% default
    const beta = profile?.beta || 1;
    const costOfEquity = riskFreeRate + beta * (marketReturn - riskFreeRate);

    // Cost of debt
    const interestExpense = Math.abs(lastIncome.interestExpense || 0);
    const totalDebt = lastBalance.totalDebt || lastBalance.longTermDebt || 0;
    const costOfDebt = totalDebt > 0 ? interestExpense / totalDebt : 0.05;

    // Tax rate
    const taxRate = lastIncome.incomeTaxExpense && lastIncome.incomeBeforeTax
      ? Math.max(0, Math.min(0.4, lastIncome.incomeTaxExpense / lastIncome.incomeBeforeTax))
      : 0.25;

    // Market value of equity
    const marketCap = quote?.marketCap || (quote?.price && quote?.sharesOutstanding ? quote.price * quote.sharesOutstanding : 0);

    // Weights
    const totalValue = marketCap + totalDebt;
    const weightEquity = totalValue > 0 ? marketCap / totalValue : 0.7;
    const weightDebt = totalValue > 0 ? totalDebt / totalValue : 0.3;

    // WACC calculation
    const calculatedWacc = (weightEquity * costOfEquity + weightDebt * costOfDebt * (1 - taxRate)) * 100;

    // Average of calculated WACC and Advance DCF WACC
    if (advanceDcfWacc && calculatedWacc > 0) {
      return (advanceDcfWacc + calculatedWacc) / 2;
    } else if (advanceDcfWacc) {
      return advanceDcfWacc;
    } else if (calculatedWacc > 0) {
      return calculatedWacc;
    }
    return 10; // Fallback default
  }, [income, balance, quote, profile, dcfCustom]);

  // Effective WACC (user input or auto-calculated)
  const effectiveDiscountRate = discountRate ?? calculatedDefaultWACC;

  // ────────────────────────────────────────────────
  // Cálculo de parámetros por defecto basados en datos históricos
  // ────────────────────────────────────────────────

  const calculatedDefaults = useMemo(() => {
    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // ═══════════════════════════════════════════════════════════════
    // RIM OHLSON: ω (omega) y γ (gamma) via AR(1) regression
    // ω = persistence of abnormal earnings: ROE_t = α + ω·ROE_{t-1} + ε
    // γ = persistence of other information (analyst revisions proxy)
    // ═══════════════════════════════════════════════════════════════

    // Calculate ROE series for AR(1) regression
    const roeSeries: number[] = [];
    for (let i = 0; i < Math.min(sortedIncome.length, sortedBalance.length); i++) {
      const netIncome = sortedIncome[i]?.netIncome || 0;
      const equity = sortedBalance[i]?.totalStockholdersEquity || 1;
      if (equity > 0 && netIncome !== 0) {
        roeSeries.push(netIncome / equity);
      }
    }

    // Simple AR(1) estimation: ω = Cov(ROE_t, ROE_{t-1}) / Var(ROE_{t-1})
    let omega = 0.62; // Default
    if (roeSeries.length >= 3) {
      const n = roeSeries.length - 1;
      let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        const x = roeSeries[i + 1]; // ROE_{t-1}
        const y = roeSeries[i];     // ROE_t
        sumXY += x * y;
        sumX += x;
        sumY += y;
        sumX2 += x * x;
      }
      const denom = n * sumX2 - sumX * sumX;
      if (Math.abs(denom) > 0.0001) {
        omega = (n * sumXY - sumX * sumY) / denom;
        // Clamp omega to [0, 1] as it's a persistence parameter
        omega = Math.max(0, Math.min(1, omega));
      }
    }

    // Gamma: persistence of "other information"
    // Use analyst estimate revisions as proxy, or default based on sector
    // Tech companies tend to have lower gamma (more volatile info)
    // Stable industries have higher gamma
    const beta = profile?.beta || 1;
    let gamma = 0.32; // Default
    if (beta > 1.5) {
      gamma = 0.2; // High beta = less persistent other info
    } else if (beta < 0.8) {
      gamma = 0.5; // Low beta = more persistent
    }

    // ═══════════════════════════════════════════════════════════════
    // STOCHASTIC DCF: σ (volatility) y λ (market price of risk)
    // σ = std dev of FCF growth rates
    // λ = Sharpe ratio = (E[R] - Rf) / σ_market ≈ beta * ERP / σ_stock
    // ═══════════════════════════════════════════════════════════════

    // Calculate FCF growth rates
    const fcfGrowthRates: number[] = [];
    for (let i = 0; i < sortedCashFlow.length - 1; i++) {
      const fcfCurrent = sortedCashFlow[i]?.freeCashFlow || 0;
      const fcfPrev = sortedCashFlow[i + 1]?.freeCashFlow || 0;
      if (fcfPrev !== 0 && fcfCurrent !== 0) {
        const growthRate = (fcfCurrent - fcfPrev) / Math.abs(fcfPrev);
        // Filter out extreme values
        if (Math.abs(growthRate) < 5) {
          fcfGrowthRates.push(growthRate);
        }
      }
    }

    // Calculate standard deviation of FCF growth
    let sigmaFCF = 0.25; // Default
    if (fcfGrowthRates.length >= 2) {
      const mean = fcfGrowthRates.reduce((s, v) => s + v, 0) / fcfGrowthRates.length;
      const variance = fcfGrowthRates.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / fcfGrowthRates.length;
      sigmaFCF = Math.sqrt(variance);
      // Clamp to reasonable range [0.05, 1.0]
      sigmaFCF = Math.max(0.05, Math.min(1.0, sigmaFCF));
    }

    // Lambda (market price of risk) ≈ Sharpe ratio
    // λ = β × ERP / σ_stock where ERP ≈ 5.5%
    const stockBeta = profile?.beta || 1;
    const erp = 0.055; // Equity risk premium
    const stockVolatility = sigmaFCF; // Use FCF vol as proxy for stock vol
    let lambdaRisk = stockVolatility > 0 ? (stockBeta * erp) / stockVolatility : 0.5;
    // Clamp to reasonable range [0.1, 1.5]
    lambdaRisk = Math.max(0.1, Math.min(1.5, lambdaRisk));

    // ═══════════════════════════════════════════════════════════════
    // BAYESIAN NK DSGE: φπ, φy, κ, β
    // φπ (Taylor inflation): typically 1.5-2.0 based on Fed behavior
    // φy (Taylor output): typically 0.1-0.5
    // κ (Phillips curve slope): 0.01-0.05, inversely related to market power
    // β (discount factor): ~0.99 for quarterly, ~0.96 for annual
    // ═══════════════════════════════════════════════════════════════

    // φπ: Use market volatility as proxy - higher vol → more aggressive Fed
    let phiPi = 1.5;
    if (stockBeta > 1.3) {
      phiPi = 1.8; // More aggressive for volatile sectors
    } else if (stockBeta < 0.7) {
      phiPi = 1.3; // Less aggressive for stable sectors
    }

    // φy: Output gap response - cyclical companies need higher φy
    const sector = profile?.sector?.toLowerCase() || '';
    let phiY = 0.25;
    if (sector.includes('consumer') || sector.includes('industrial') || sector.includes('financial')) {
      phiY = 0.4; // Cyclical sectors
    } else if (sector.includes('health') || sector.includes('utilities') || sector.includes('consumer defensive')) {
      phiY = 0.15; // Defensive sectors
    }

    // κ (Phillips curve slope): Related to pricing power
    // Higher profit margin → more market power → lower κ
    const latestIncome = sortedIncome[0] || {};
    const grossMargin = latestIncome.revenue > 0
      ? (latestIncome.grossProfit || 0) / latestIncome.revenue
      : 0.3;
    let kappaDSGE = 0.03; // Default
    if (grossMargin > 0.5) {
      kappaDSGE = 0.01; // High margin = high pricing power = low κ
    } else if (grossMargin < 0.25) {
      kappaDSGE = 0.05; // Low margin = low pricing power = high κ
    }

    // β (discount factor): Standard value for annual data
    const betaDSGECalc = 0.99;

    // ═══════════════════════════════════════════════════════════════
    // HJM: σ (forward rate volatility) y a (mean reversion)
    // σ: typically 0.01-0.02 for interest rates
    // a: mean reversion speed, higher for short rates (0.1-0.5)
    // ═══════════════════════════════════════════════════════════════

    // Use dcfCustom risk-free rate if available, otherwise estimate
    // API returns riskFreeRate as percentage (e.g., 3.83 = 3.83%), convert to decimal
    const riskFreeRate = dcfCustom?.riskFreeRate ? dcfCustom.riskFreeRate / 100 : 0.04;

    // HJM sigma: Forward rate volatility (basis points / 100)
    // Typically between 0.5-2% for developed markets
    let hjmSigmaCalc = 0.015; // 1.5% default
    if (riskFreeRate > 0.05) { // 5%
      hjmSigmaCalc = 0.02; // Higher rates = higher vol
    } else if (riskFreeRate < 0.02) { // 2%
      hjmSigmaCalc = 0.01; // Lower rates = lower vol
    }

    // Mean reversion (a): Speed at which rates revert to long-term mean
    // Higher a = faster reversion, typically 0.1-0.5 for annual data
    // Use stock beta as proxy - high beta companies more sensitive to rate changes
    let hjmMeanReversionCalc = 0.2; // Default
    if (stockBeta > 1.3) {
      hjmMeanReversionCalc = 0.1; // Slower reversion for volatile stocks
    } else if (stockBeta < 0.7) {
      hjmMeanReversionCalc = 0.4; // Faster reversion for stable stocks
    }

    return {
      omega,
      gamma,
      sigmaFCF,
      lambdaRisk,
      phiPi,
      phiY,
      kappaDSGE,
      betaDSGE: betaDSGECalc,
      hjmSigma: hjmSigmaCalc,
      hjmMeanReversion: hjmMeanReversionCalc,
    };
  }, [income, balance, cashFlow, profile, dcfCustom]);

  // Parámetros Ohlson RIM - inicializar con valores calculados
  const [omega, setOmega] = useState<number | null>(null);
  const [gamma, setGamma] = useState<number | null>(null);

  // Parámetros Stochastic DCF
  const [volatility, setVolatility] = useState<number | null>(null);
  const [lambda, setLambda] = useState<number | null>(null);

  // Parámetros NK DSGE (Bayesian)
  const [phi_pi, setPhi_pi] = useState<number | null>(null);
  const [phi_y, setPhi_y] = useState<number | null>(null);
  const [betaDSGE, setBetaDSGE] = useState<number | null>(null);
  const [kappa, setKappa] = useState<number | null>(null);

  // Parámetros HJM
  const [hjmSigma, setHjmSigma] = useState<number | null>(null);
  const [hjmMeanReversion, setHjmMeanReversion] = useState<number | null>(null);

  // Use calculated defaults when state is null
  const effectiveOmega = omega ?? calculatedDefaults.omega;
  const effectiveGamma = gamma ?? calculatedDefaults.gamma;
  const effectiveVolatility = volatility ?? calculatedDefaults.sigmaFCF;
  const effectiveLambda = lambda ?? calculatedDefaults.lambdaRisk;
  const effectivePhiPi = phi_pi ?? calculatedDefaults.phiPi;
  const effectivePhiY = phi_y ?? calculatedDefaults.phiY;
  const effectiveBetaDSGE = betaDSGE ?? calculatedDefaults.betaDSGE;
  const effectiveKappa = kappa ?? calculatedDefaults.kappaDSGE;
  const effectiveHjmSigma = hjmSigma ?? calculatedDefaults.hjmSigma;
  const effectiveHjmMeanReversion = hjmMeanReversion ?? calculatedDefaults.hjmMeanReversion;

  const [methods, setMethods] = useState<ValuationMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado para P/E de competidores
  const [peerPE, setPeerPE] = useState<PeerData[]>([]);
  const [loadingPeers, setLoadingPeers] = useState(true);

  // ────────────────────────────────────────────────
  // AdvanceValue Net (Neural Ensemble)
  // Connects to FastAPI backend running PyTorch model
  // ────────────────────────────────────────────────
  const [advanceValueNet, setAdvanceValueNet] = useState<{
    fair_value: number;
    confidence_interval: [number, number];
    signal: string;
    upside_pct?: number;
    experts_used?: number;
    base_ensemble?: number;
  } | null>(null);
  const [advanceValueNetLoading, setAdvanceValueNetLoading] = useState(false);
  const [advanceValueNetError, setAdvanceValueNetError] = useState<string | null>(null);
  const [includePrismoValue, setIncludePrismoValue] = useState(false);

  // ────────────────────────────────────────────────
  // Fetch P/E de competidores para EPS*Benchmark
  // ────────────────────────────────────────────────
  useEffect(() => {
    const fetchPeerPE = async () => {
      if (!ticker) return;

      try {
        setLoadingPeers(true);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        // Obtener peers
        const peersRes = await fetch(
          `https://financialmodelingprep.com/stable/stock-peers?symbol=${ticker}&apikey=${apiKey}`
        );

        let peerSymbols: string[] = [];
        if (peersRes.ok) {
          const peersJson = await peersRes.json();
          if (Array.isArray(peersJson)) {
            peerSymbols = peersJson.map((p: any) => p.symbol).filter(Boolean).slice(0, 8);
          }
        }

        if (peerSymbols.length === 0) {
          peerSymbols = ['MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META'];
        }

        // Obtener P/E de cada peer
        const peData: PeerData[] = [];
        for (const symbol of peerSymbols) {
          try {
            const quoteRes = await fetch(
              `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${apiKey}`
            );
            if (quoteRes.ok) {
              const quoteJson = await quoteRes.json();
              const q = Array.isArray(quoteJson) ? quoteJson[0] : quoteJson;
              if (q && q.pe && q.pe > 0 && q.pe < 100) { // Filtrar P/E razonables
                peData.push({ symbol, pe: q.pe });
              }
            }
          } catch {
            // Skip this peer
          }
        }

        setPeerPE(peData);
      } catch (err) {
        console.error('Error fetching peer P/E:', err);
      } finally {
        setLoadingPeers(false);
      }
    };

    fetchPeerPE();
  }, [ticker]);

  // ────────────────────────────────────────────────
  // Calcular DCF interno (similar a CalculosTab)
  // ────────────────────────────────────────────────
  const dcfCalculation = useMemo(() => {
    if (!income.length || !balance.length || !cashFlow.length) return null;

    const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Promedios históricos
    const historicalData = sortedIncome.slice(0, 5).map((inc, i) => {
      const cf = sortedCashFlow[i] || {};
      const revenue = inc.revenue || 0;
      const ebitda = inc.ebitda || (inc.operatingIncome || 0) + (inc.depreciationAndAmortization || 0);
      const depreciation = inc.depreciationAndAmortization || cf.depreciationAndAmortization || 0;
      const taxRate = inc.incomeTaxExpense && inc.incomeBeforeTax ? inc.incomeTaxExpense / inc.incomeBeforeTax : 0.25;
      const ebit = inc.operatingIncome || (ebitda - depreciation);
      const nopat = ebit * (1 - taxRate);
      const capex = Math.abs(cf.capitalExpenditure || 0);

      return {
        revenue,
        ebitda,
        ebitdaMargin: revenue > 0 ? ebitda / revenue : 0,
        depreciation,
        nopat,
        capex,
        capexToRevenue: revenue > 0 ? capex / revenue : 0,
        dnaToRevenue: revenue > 0 ? depreciation / revenue : 0,
      };
    });

    const avgEbitdaMargin = historicalData.reduce((sum, d) => sum + d.ebitdaMargin, 0) / historicalData.length;
    const avgCapexToRevenue = historicalData.reduce((sum, d) => sum + d.capexToRevenue, 0) / historicalData.length;
    const avgDnaToRevenue = historicalData.reduce((sum, d) => sum + d.dnaToRevenue, 0) / historicalData.length;
    const avgTaxRate = 0.25;

    // Proyección
    let lastRevenue = sortedIncome[0]?.revenue || 0;
    let cumulativeDiscountedFCF = 0;
    let lastEbitda = 0;

    for (let i = 1; i <= 5; i++) {
      const revenue = lastRevenue * (1 + projectedGrowthRate / 100);
      const ebitda = revenue * avgEbitdaMargin;
      const depreciation = revenue * avgDnaToRevenue;
      const ebit = ebitda - depreciation;
      const nopat = ebit * (1 - avgTaxRate);
      const capex = revenue * avgCapexToRevenue;
      const unleveredFCF = nopat + depreciation - capex;
      const discountFactor = 1 / Math.pow(1 + effectiveDiscountRate / 100, i);
      cumulativeDiscountedFCF += unleveredFCF * discountFactor;
      lastRevenue = revenue;
      lastEbitda = ebitda;
    }

    // Terminal value
    const terminalValue = lastEbitda * exitMultiple;
    const pvTerminalValue = terminalValue / Math.pow(1 + effectiveDiscountRate / 100, 5);
    const totalEV = cumulativeDiscountedFCF + pvTerminalValue;

    // Equity value
    const recentBalance = sortedBalance[0] || {};
    const totalDebt = recentBalance.totalDebt || recentBalance.longTermDebt || 0;
    const cash = recentBalance.cashAndCashEquivalents || 0;
    const equityValue = totalEV - totalDebt + cash;

    const sharesOutstanding =
      quote?.sharesOutstanding ||
      profile?.sharesOutstanding ||
      (quote?.marketCap && quote?.price ? quote.marketCap / quote.price : 0) ||
      sortedIncome[0]?.weightedAverageShsOut ||
      sortedIncome[0]?.weightedAverageShsOutDil ||
      1;

    return {
      equityValue,
      valuePerShare: equityValue / sharesOutstanding,
      totalEV,
    };
  }, [income, balance, cashFlow, quote, profile, effectiveDiscountRate, exitMultiple, projectedGrowthRate]);

  // ────────────────────────────────────────────────
  // Monte Carlo DCF Simulation
  // Runs 2000 simulations with random noise on growth and WACC
  // ────────────────────────────────────────────────
  const monteCarloDCF = useMemo(() => {
    if (!dcfCalculation || !dcfCalculation.valuePerShare) return null;

    const simulations = 2000;
    const results: number[] = [];
    const baseValuePerShare = dcfCalculation.valuePerShare;

    // Get base parameters
    const baseGrowth = projectedGrowthRate / 100;
    const baseWacc = effectiveDiscountRate / 100;
    const terminalGrowth = glong;

    for (let i = 0; i < simulations; i++) {
      // Add random noise: ±4% on growth, ±1.5% on WACC
      const gNoise = (Math.random() - 0.5) * 0.04;
      const waccNoise = (Math.random() - 0.5) * 0.015;

      const simulatedG = Math.max(0.01, baseGrowth + gNoise);
      const simulatedWacc = Math.max(0.06, baseWacc + waccNoise);
      const simulatedTerminalG = Math.max(0.01, Math.min(terminalGrowth + (Math.random() - 0.5) * 0.02, simulatedWacc - 0.01));

      // Simple DCF adjustment based on parameter changes
      // Approximate impact: value scales inversely with (WACC - g)
      const baseDenom = Math.max(baseWacc - terminalGrowth, 0.01);
      const simDenom = Math.max(simulatedWacc - simulatedTerminalG, 0.01);
      const growthAdjustment = Math.pow((1 + simulatedG) / (1 + baseGrowth), 5);
      const waccAdjustment = baseDenom / simDenom;

      const simulatedValue = baseValuePerShare * growthAdjustment * waccAdjustment;
      if (simulatedValue > 0 && isFinite(simulatedValue) && simulatedValue < baseValuePerShare * 5) {
        results.push(simulatedValue);
      }
    }

    if (results.length < 100) return null; // Not enough valid simulations

    results.sort((a, b) => a - b);
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    const p10 = results[Math.floor(results.length * 0.1)];
    const p50 = results[Math.floor(results.length * 0.5)];
    const p90 = results[Math.floor(results.length * 0.9)];

    return { mean, p10, p50, p90, simCount: results.length };
  }, [dcfCalculation, projectedGrowthRate, effectiveDiscountRate, glong]);

  // ────────────────────────────────────────────────
  // Cálculo principal de valuaciones
  // ────────────────────────────────────────────────
  useEffect(() => {
    const calculate = () => {
      setLoading(true);
      setError(null);

      try {
        // Ordenar datos
        const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const sortedCashFlow = [...cashFlow].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const lastIncome = sortedIncome[0] || {};
        const lastBalance = sortedBalance[0] || {};
        const lastCashFlow = sortedCashFlow[0] || {};
        const prevBalance = sortedBalance[1] || {};

        // ────────────────────────────────────────────────
        // Variables base - D0 (Annual Dividend Per Share)
        // ────────────────────────────────────────────────
        // PRIORITY: Use /dividends endpoint (most accurate for per-share data)
        let d0 = 0;
        let dividendYield = 0;

        if (dividends && dividends.length > 0) {
          // Sort by date descending
          const sortedDividends = [...dividends].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          );

          // Get the frequency to determine how many payments make up annual dividend
          const frequency = sortedDividends[0]?.frequency || 'Quarterly';
          const paymentsPerYear = frequency === 'Quarterly' ? 4 : frequency === 'Monthly' ? 12 : frequency === 'Semi-Annual' ? 2 : 1;

          // Sum last N quarterly dividends to get annual dividend
          const recentDividends = sortedDividends.slice(0, paymentsPerYear);
          d0 = recentDividends.reduce((sum, div) => sum + (div.dividend || div.adjDividend || 0), 0);

          // Get latest yield
          dividendYield = sortedDividends[0]?.yield || 0;

          console.log(`[Valuaciones] D0 from /dividends endpoint: $${d0.toFixed(4)} (${paymentsPerYear} ${frequency} payments)`);
          console.log(`[Valuaciones] Dividend yield: ${(dividendYield).toFixed(2)}%`);
        }

        // Fallback: Calculate from cash flow if /dividends not available
        if (d0 === 0) {
          let dividendsPaid = 0;

          // Try cashFlowAsReported first
          if (cashFlowAsReported && cashFlowAsReported.length > 0) {
            const sortedAsReported = [...cashFlowAsReported].sort((a, b) => b.fiscalYear - a.fiscalYear);
            const latestAsReported = sortedAsReported[0];
            if (latestAsReported?.data?.paymentsofdividends) {
              dividendsPaid = latestAsReported.data.paymentsofdividends;
              console.log(`[Valuaciones] Fallback: Dividends from as-reported (FY${latestAsReported.fiscalYear}): $${(dividendsPaid / 1e9).toFixed(2)}B`);
            }
          }

          // Final fallback to regular cash flow
          if (dividendsPaid === 0) {
            dividendsPaid = Math.abs(
              lastCashFlow.dividendsPaid ||
              lastCashFlow.paymentOfDividends ||
              lastCashFlow.commonStockDividendsPaid ||
              0
            );
          }

          const sharesForDividend = lastIncome.weightedAverageShsOutDil || quote?.sharesOutstanding || 1;
          d0 = dividendsPaid / sharesForDividend;
          console.log(`[Valuaciones] Fallback D0: $${d0.toFixed(4)} (Total: $${(dividendsPaid / 1e9).toFixed(2)}B / ${(sharesForDividend / 1e9).toFixed(2)}B shares)`);
        }
        // Use SGR from SustainableGrowthTab if available, otherwise calculate fallback
        // NOTE: gs CAN be > ks in multi-stage models because it's only for a finite period (n years)
        // Only the terminal growth rate (glong) must be < ks for the perpetuity formula
        const gs = sustainableGrowthRate !== null && sustainableGrowthRate !== undefined
          ? sustainableGrowthRate
          : 0.08; // Fallback 8% if SGR not calculated yet

        // Cost of equity (Ks) from CAPM
        // PRIORITY: Use avgCAPMFromBeta which is the AVERAGE CAPM calculated in BetaTab
        // This includes: Official Beta (FMP), User Beta, and Calculated Beta (5Y vs SPY)
        // avgCAPMFromBeta is in percentage format (e.g., 10.5 = 10.5%), convert to decimal

        // Fallback chain:
        // 1. avgCAPMFromBeta (best - average of all CAPM sources from BetaTab)
        // 2. dcfCustom.costOfEquity (FMP API value)
        // 3. Manual CAPM calculation
        const riskFreeRateForKs = dcfCustom?.riskFreeRate ? dcfCustom.riskFreeRate / 100 : 0.04;
        const marketRiskPremiumFromApi = dcfCustom?.marketRiskPremium ? dcfCustom.marketRiskPremium / 100 : 0.055;
        const betaForKs = profile?.beta || 1;

        let ks: number;
        let ksSource: string;

        if (avgCAPMFromBeta !== null && avgCAPMFromBeta !== undefined && avgCAPMFromBeta > 0) {
          // Use the average CAPM from BetaTab (already in percentage, convert to decimal)
          ks = avgCAPMFromBeta / 100;
          ksSource = 'BetaTab Avg CAPM';
        } else if (dcfCustom?.costOfEquity) {
          // Fallback to FMP API costOfEquity
          ks = dcfCustom.costOfEquity / 100;
          ksSource = 'FMP API';
        } else {
          // Final fallback: manual CAPM calculation
          ks = riskFreeRateForKs + betaForKs * marketRiskPremiumFromApi;
          ksSource = 'manual CAPM';
        }

        console.log('[Valuaciones] Ks (Cost of Equity):', (ks * 100).toFixed(2) + '%', 'from', ksSource);
        console.log('[Valuaciones] gs (SGR):', (gs * 100).toFixed(2) + '%', 'sustainableGrowthRate:', sustainableGrowthRate);
        console.log('[Valuaciones] glong (terminal):', (glong * 100).toFixed(2) + '%');
        console.log('[Valuaciones] Ks > glong (required for terminal)?', ks > glong, `(${(ks * 100).toFixed(2)}% vs ${(glong * 100).toFixed(2)}%)`);
        const beta = profile.beta || 1;
        const fcfo = (lastCashFlow.freeCashFlow || 0) / (lastIncome.weightedAverageShsOutDil || 1);
        const effectiveFcfo = userFcfo !== null ? userFcfo : fcfo;
        const bookValue = (lastBalance.totalStockholdersEquity || 0) / (lastIncome.weightedAverageShsOutDil || 1);
        const epsTTM = lastIncome.epsdiluted || lastIncome.eps || (lastIncome.netIncome / lastIncome.weightedAverageShsOutDil) || 0;
        const meanTarget = priceTarget?.lastQuarterAvgPriceTarget || 0;
        const currentPrice = quote?.price || 0;
        const sharesOutstanding = lastIncome.weightedAverageShsOutDil || quote?.sharesOutstanding || 1;

        // ────────────────────────────────────────────────
        // 1. RIM (Residual Income Model) - Ohlson Model
        // Pt = bt + α1·ox_t^a + α2·oa_t + α3·vt
        // Donde:
        // - bt = book value per share
        // - ox_t^a = abnormal earnings = (ROE - r) * book value
        // - oa_t = other information (usamos analyst growth estimate como proxy)
        // - α1, α2, α3 son funciones de omega y gamma
        // ────────────────────────────────────────────────
        const roe = lastBalance.totalStockholdersEquity > 0
          ? lastIncome.netIncome / lastBalance.totalStockholdersEquity
          : 0;
        const r = ks; // required return
        const abnormalEarnings = (roe - r) * bookValue;

        // Analyst growth estimate como proxy para "other information"
        const analystGrowth = (priceTarget?.lastQuarterAvgPriceTarget && currentPrice > 0)
          ? (priceTarget.lastQuarterAvgPriceTarget / currentPrice - 1)
          : 0.05;

        // Ohlson model coefficients
        // α1 = ω / (1 + r - ω)
        // α2 = (1 + r) / ((1 + r - ω)(1 + r - γ))
        // α3 = γ / (1 + r - γ)
        const alpha1 = effectiveOmega / (1 + r - effectiveOmega);
        const alpha2 = (1 + r) / ((1 + r - effectiveOmega) * (1 + r - effectiveGamma));
        const alpha3 = effectiveGamma / (1 + r - effectiveGamma);

        const rimValue = bookValue + alpha1 * abnormalEarnings + alpha2 * analystGrowth * epsTTM + alpha3 * analystGrowth;

        // ────────────────────────────────────────────────
        // 2. DCF (from internal calculation)
        // ────────────────────────────────────────────────
        const dcfValue = dcfCalculation?.valuePerShare || 0;

        // ────────────────────────────────────────────────
        // 3. EPS * Benchmark (TTM EPS × avg competitor P/E)
        // ────────────────────────────────────────────────
        const avgPeerPE = peerPE.length > 0
          ? peerPE.reduce((sum, p) => sum + (p.pe || 0), 0) / peerPE.length
          : 20; // Default P/E if no peers
        const epsBenchmarkValue = epsTTM * avgPeerPE;

        // ────────────────────────────────────────────────
        // 4. Stochastic DCF
        // Terminal Value con ajuste estocástico:
        // TV = FCF_n × (1 + g) / (r - g) × exp(-λσ²/2)
        // Donde λ es risk aversion y σ es volatility
        // ────────────────────────────────────────────────
        const fcfLast = lastCashFlow.freeCashFlow || 0;
        const terminalGrowth = glong;
        const stochasticAdjustment = Math.exp(-effectiveLambda * Math.pow(effectiveVolatility, 2) / 2);

        // Base DCF terminal value
        const baseTVPerShare = dcfCalculation?.valuePerShare || 0;
        const stochasticDCFValue = baseTVPerShare * stochasticAdjustment;

        // ────────────────────────────────────────────────
        // 5. Bayesian Valuation (NK DSGE Model)
        // Sistema simplificado:
        // IS Curve: yt = E[yt+1] - (1/σ)(it - E[πt+1] - rn)
        // Phillips Curve: πt = β·E[πt+1] + κ·yt
        // Taylor Rule: it = rn + φπ·πt + φy·yt
        //
        // Valuación: P = E[CF] / (r + risk_premium)
        // Risk premium derivado del DSGE
        // ────────────────────────────────────────────────

        // Estimación de output gap basado en revenue growth
        const revenueGrowth = sortedIncome.length > 1 && sortedIncome[1].revenue > 0
          ? (sortedIncome[0].revenue - sortedIncome[1].revenue) / sortedIncome[1].revenue
          : 0.05;

        // Simplified DSGE-implied risk premium
        // En estado estacionario: π* = 0, y* = 0
        // Risk premium = κ * |output_gap| + inflation_uncertainty
        const outputGap = revenueGrowth - 0.03; // Assuming 3% trend growth
        const impliedInflation = effectiveKappa * outputGap;
        const dsgeRiskPremium = Math.abs(effectiveKappa * outputGap) + 0.02; // Base 2% risk premium

        // Policy rate from Taylor rule
        const rNatural = 0.02; // Natural rate
        const policyRate = rNatural + effectivePhiPi * impliedInflation + effectivePhiY * outputGap;

        // Discount rate adjusted for DSGE risk
        const dsgeDiscountRate = Math.max(0.05, policyRate + dsgeRiskPremium);

        // Gordon Growth Model with DSGE discount rate
        const expectedCashFlow = effectiveFcfo * (1 + glong);
        const bayesianValue = expectedCashFlow > 0 && dsgeDiscountRate > glong
          ? expectedCashFlow / (dsgeDiscountRate - glong)
          : bookValue; // Fallback to book value

        // ────────────────────────────────────────────────
        // 6. HJM (Heath-Jarrow-Morton) Model
        // Forward rate dynamics: df(t,T) = α(t,T)dt + σ(t,T)dW(t)
        // No-arbitrage condition: α(t,T) = σ(t,T) ∫[t,T] σ(t,s)ds
        //
        // Para valuación: usamos forward rates para descontar
        // y ajustamos por volatilidad del term structure
        // ────────────────────────────────────────────────

        // Simplified HJM implementation
        // Assume Vasicek-type volatility structure: σ(t,T) = σ * e^(-a(T-t))
        const a = Math.max(0.01, effectiveHjmMeanReversion); // Ensure a > 0
        const sigma = effectiveHjmSigma;

        // Initial forward rate (use risk-free rate as base)
        // API returns riskFreeRate as percentage (e.g., 3.83 = 3.83%), convert to decimal
        const apiRiskFreeRate = dcfCustom?.riskFreeRate;
        const f0 = apiRiskFreeRate ? apiRiskFreeRate / 100 : 0.04;

        // Calculate HJM drift (no-arbitrage)
        // α(t,T) = σ² * (1 - e^(-a(T-t))) / a
        const T = n; // Use projection years
        const hjmDrift = Math.pow(sigma, 2) * (1 - Math.exp(-a * T)) / a;

        // Forward rate at time T (capped to reasonable range)
        const forwardRate = Math.min(0.15, Math.max(0.02, f0 + hjmDrift));

        // For HJM valuation, we use the DCF approach but with stochastic rate adjustment
        // The key insight: HJM adjusts the discount rate based on term structure dynamics

        // HJM-adjusted discount rate = base rate + cost of equity premium
        // For equities, we need to add equity risk premium to the risk-free rate
        const equityRiskPremium = (profile?.beta || 1) * 0.055; // Beta * market risk premium (~5.5%)
        const hjmEquityRate = forwardRate + equityRiskPremium;

        // Ensure the discount rate is materially higher than growth rate
        const effectiveHjmDiscountRate = Math.max(hjmEquityRate, glong + 0.03);

        // HJM valuation: FCF stream discounted with HJM-derived rates
        // Use the same FCF growth rate as DCF model for consistency
        const hjmGrowthRate = projectedGrowthRate / 100;

        // Use fcfo if positive, otherwise try to use a normalized FCF based on earnings
        const hjmBaseFCF = effectiveFcfo > 0
          ? effectiveFcfo
          : epsTTM > 0
            ? epsTTM * 0.8 // Approximate FCF as 80% of EPS if direct FCF is negative
            : bookValue * 0.05; // Or 5% of book value as last resort

        let hjmPV = 0;
        if (hjmBaseFCF > 0) {
          for (let t = 1; t <= n; t++) {
            // Time-varying forward rate with equity premium
            const fRate = f0 + sigma * sigma * (1 - Math.exp(-a * t)) / a + equityRiskPremium;
            const adjustedRate = Math.max(fRate, 0.05); // Minimum 5% discount rate for equities
            const discount = 1 / Math.pow(1 + adjustedRate, t);
            const projectedFCF = hjmBaseFCF * Math.pow(1 + hjmGrowthRate, t);
            hjmPV += projectedFCF * discount;
          }
        }

        // Terminal value with HJM discount
        // Use Gordon Growth with HJM-derived discount rate
        const terminalDenom = Math.max(effectiveHjmDiscountRate - glong, 0.02);
        const hjmTerminalFCF = hjmBaseFCF * Math.pow(1 + hjmGrowthRate, n) * (1 + glong);
        const hjmTerminalValue = hjmBaseFCF > 0 ? hjmTerminalFCF / terminalDenom : 0;

        // Discount terminal value back to present
        const hjmPVTerminal = hjmTerminalValue / Math.pow(1 + effectiveHjmDiscountRate, n);

        const hjmValue = hjmPV + hjmPVTerminal;

        // ────────────────────────────────────────────────
        // FCFE (Free Cash Flow to Equity) Valuation
        // FCFE = Net Income + D&A - CapEx - ΔNWC + Net Borrowing
        // Pₜ = FCFE_{t+1} / (r_e - g) / Shares Outstanding
        // ────────────────────────────────────────────────
        const netIncome = lastIncome.netIncome || 0;
        const dna = lastIncome.depreciationAndAmortization || lastCashFlow.depreciationAndAmortization || 0;
        const capex = Math.abs(lastCashFlow.capitalExpenditure || 0);
        const prevTotalDebt = prevBalance.totalDebt || prevBalance.longTermDebt || 0;
        const currentTotalDebt = lastBalance.totalDebt || lastBalance.longTermDebt || 0;
        const netBorrowing = currentTotalDebt - prevTotalDebt;
        const prevWC = (prevBalance.totalCurrentAssets || 0) - (prevBalance.totalCurrentLiabilities || 0);
        const currWC = (lastBalance.totalCurrentAssets || 0) - (lastBalance.totalCurrentLiabilities || 0);
        const deltaWC = currWC - prevWC;

        // FCFE aggregate
        const fcfeAggregate = netIncome + dna - capex - deltaWC + netBorrowing;
        const fcfePerShareRaw = fcfeAggregate / sharesOutstanding;

        // Use FCFE if positive, otherwise use a normalized estimate
        const fcfePerShare = fcfePerShareRaw > 0
          ? fcfePerShareRaw
          : epsTTM > 0
            ? epsTTM * 0.7 // 70% of EPS as approximation
            : (netIncome / sharesOutstanding) * 0.5; // Or 50% of earnings per share

        // FCFE 2-Stage: Gordon Growth on FCFE per share
        const fcfeGrowth1 = projectedGrowthRate / 100; // High growth period
        // BUG FIX: FCFE must use Cost of Equity (ks), NOT WACC
        // FCFE is equity cash flow, so discount with equity rate
        const re = ks; // Cost of equity from CAPM (was incorrectly using WACC)

        // 2-Stage FCFE: Explicit forecast + Terminal
        let fcfe2StageValue = 0;
        let lastFCFE = Math.max(fcfePerShare, 0.01); // Ensure positive base
        for (let t = 1; t <= n; t++) {
          const projFCFE = lastFCFE * (1 + fcfeGrowth1);
          const discountedFCFE = projFCFE / Math.pow(1 + re, t);
          fcfe2StageValue += discountedFCFE;
          lastFCFE = projFCFE;
        }
        // Terminal value for FCFE
        const fcfeTerminal = re > glong ? (lastFCFE * (1 + glong)) / (re - glong) : 0;
        const fcfeTerminalPV = fcfeTerminal / Math.pow(1 + re, n);
        fcfe2StageValue += fcfeTerminalPV;

        // 3-Stage FCFE (high growth -> transition -> stable)
        let fcfe3StageValue = 0;
        lastFCFE = Math.max(fcfePerShare, 0.01); // Ensure positive base
        const transitionYears = h;
        // Phase 1: High growth
        for (let t = 1; t <= n; t++) {
          const projFCFE = lastFCFE * (1 + fcfeGrowth1);
          const discountedFCFE = projFCFE / Math.pow(1 + re, t);
          fcfe3StageValue += discountedFCFE;
          lastFCFE = projFCFE;
        }
        // Phase 2: Transition (declining growth from high to glong)
        for (let t = 1; t <= transitionYears; t++) {
          const transGrowth = fcfeGrowth1 - (fcfeGrowth1 - glong) * (t / transitionYears);
          const projFCFE = lastFCFE * (1 + transGrowth);
          const discountedFCFE = projFCFE / Math.pow(1 + re, n + t);
          fcfe3StageValue += discountedFCFE;
          lastFCFE = projFCFE;
        }
        // Phase 3: Terminal stable growth
        const fcfe3Terminal = re > glong ? (lastFCFE * (1 + glong)) / (re - glong) : 0;
        const fcfe3TerminalPV = fcfe3Terminal / Math.pow(1 + re, n + transitionYears);
        fcfe3StageValue += fcfe3TerminalPV;

        // ────────────────────────────────────────────────
        // FCFF (Free Cash Flow to Firm) Valuation
        // FCFF = NOPAT + D&A - CapEx - ΔNWC
        // Pₜ = [FCFF_{t+1} / (WACC - g) - Net Debt] / Shares Outstanding
        // ────────────────────────────────────────────────
        const taxRate = lastIncome.incomeTaxExpense && lastIncome.incomeBeforeTax
          ? lastIncome.incomeTaxExpense / lastIncome.incomeBeforeTax
          : 0.25;
        const ebit = lastIncome.operatingIncome || lastIncome.ebit || 0;
        const nopat = ebit * (1 - taxRate);

        // FCFF aggregate
        const fcffAggregate = nopat + dna - capex - deltaWC;
        const wacc = effectiveDiscountRate / 100;
        const netDebt = currentTotalDebt - (lastBalance.cashAndCashEquivalents || 0);

        // Use FCFF if positive, otherwise try alternative calculation
        // Some companies have temporary negative FCFF, use normalized value
        const fcffBase = fcffAggregate > 0
          ? fcffAggregate
          : nopat > 0
            ? nopat * 0.7 // Use 70% of NOPAT as approximation
            : (lastIncome.netIncome || 0) * 0.5; // Or 50% of net income

        // 2-Stage FCFF: Explicit forecast + Terminal
        let fcff2StageEV = 0;
        let lastFCFF = fcffBase;
        for (let t = 1; t <= n; t++) {
          const projFCFF = lastFCFF * (1 + fcfeGrowth1);
          const discountedFCFF = projFCFF / Math.pow(1 + wacc, t);
          fcff2StageEV += discountedFCFF;
          lastFCFF = projFCFF;
        }
        // Terminal value for FCFF
        const fcffTerminal = wacc > glong ? (lastFCFF * (1 + glong)) / (wacc - glong) : 0;
        const fcffTerminalPV = fcffTerminal / Math.pow(1 + wacc, n);
        fcff2StageEV += fcffTerminalPV;
        // Convert to equity value per share
        const fcff2StageEquityValue = fcff2StageEV - netDebt;
        const fcff2StageValue = fcff2StageEquityValue / sharesOutstanding;

        // 3-Stage FCFF
        let fcff3StageEV = 0;
        lastFCFF = fcffBase;
        // Phase 1: High growth
        for (let t = 1; t <= n; t++) {
          const projFCFF = lastFCFF * (1 + fcfeGrowth1);
          const discountedFCFF = projFCFF / Math.pow(1 + wacc, t);
          fcff3StageEV += discountedFCFF;
          lastFCFF = projFCFF;
        }
        // Phase 2: Transition
        for (let t = 1; t <= transitionYears; t++) {
          const transGrowth = fcfeGrowth1 - (fcfeGrowth1 - glong) * (t / transitionYears);
          const projFCFF = lastFCFF * (1 + transGrowth);
          const discountedFCFF = projFCFF / Math.pow(1 + wacc, n + t);
          fcff3StageEV += discountedFCFF;
          lastFCFF = projFCFF;
        }
        // Phase 3: Terminal
        const fcff3Terminal = wacc > glong ? (lastFCFF * (1 + glong)) / (wacc - glong) : 0;
        const fcff3TerminalPV = fcff3Terminal / Math.pow(1 + wacc, n + transitionYears);
        fcff3StageEV += fcff3TerminalPV;
        const fcff3StageEquityValue = fcff3StageEV - netDebt;
        const fcff3StageValue = fcff3StageEquityValue / sharesOutstanding;

        // ────────────────────────────────────────────────
        // Custom Advance DCF (from API) - use equityValuePerShare directly
        // ────────────────────────────────────────────────
        const advanceDCFValue = dcfCustom?.equityValuePerShare || null;
        console.log('[Valuaciones] Advance DCF equityValuePerShare:', advanceDCFValue);

        // ────────────────────────────────────────────────
        // Métodos tradicionales (existentes)
        // ────────────────────────────────────────────────

        // Safe calculation helper - ONLY for terminal value (perpetuity formula requires ks > glong)
        const safeKsMinusGlong = Math.max(ks - glong, 0.01);

        // Use positive FCF base for traditional models
        const fcfoPositive = effectiveFcfo > 0 ? effectiveFcfo : epsTTM > 0 ? epsTTM * 0.8 : 0;

        // ────────────────────────────────────────────────
        // MULTI-STAGE VALUATION MODELS
        // Stage 1: High growth (gs) for n years - gs CAN be > ks (finite period)
        // Stage 2: Transition period (for 3-stage models) over h years
        // Stage 3/Terminal: Perpetuity at glong - REQUIRES ks > glong
        // ────────────────────────────────────────────────

        const calculatedMethods: ValuationMethod[] = [
          {
            name: '2-Stage DDM',
            value: (() => {
              if (d0 <= 0 || ks <= glong) return null;
              // Stage 1: PV of dividends growing at gs for n years
              const stage1PV = calcPVGrowingAnnuity(d0, gs, ks, n);
              // Dividend at end of stage 1
              const dN = d0 * Math.pow(1 + gs, n);
              // Stage 2: Terminal value (perpetuity at glong)
              const stage2PV = calcTerminalValuePV(dN, glong, ks, n);
              const result = stage1PV + stage2PV;
              return result > 0 && isFinite(result) ? result : null;
            })(),
            enabled: true,
            description: `DDM 2-Stage (D0=$${d0.toFixed(2)}, g=${(gs * 100).toFixed(1)}%, glong=${(glong * 100).toFixed(1)}%, Ks=${(ks * 100).toFixed(1)}%)`,
          },
          {
            name: '3-Stage DDM',
            value: (() => {
              if (d0 <= 0 || ks <= glong) return null;
              // Stage 1: High growth (gs) for n years
              const stage1PV = calcPVGrowingAnnuity(d0, gs, ks, n);
              // Stage 2: Transition - linear decline from gs to glong over h years
              let stage2PV = 0;
              let lastD = d0 * Math.pow(1 + gs, n);
              for (let t = 1; t <= h; t++) {
                const transitionG = gs - (gs - glong) * (t / h);
                lastD = lastD * (1 + transitionG);
                stage2PV += lastD / Math.pow(1 + ks, n + t);
              }
              // Stage 3: Terminal value at glong
              const stage3PV = calcTerminalValuePV(lastD, glong, ks, n + h);
              const result = stage1PV + stage2PV + stage3PV;
              return result > 0 && isFinite(result) ? result : null;
            })(),
            enabled: true,
            description: `DDM 3-Stage (g=${(gs * 100).toFixed(1)}%→${(glong * 100).toFixed(1)}%, H=${h}y transition)`,
          },
          {
            name: 'H Model',
            value: d0 > 0 && ks > glong
              ? (d0 * (1 + glong) + d0 * h / 2 * (gs - glong)) / safeKsMinusGlong
              : null,
            enabled: true,
            description: `H-Model (g=${(gs * 100).toFixed(1)}%→${(glong * 100).toFixed(1)}%, H=${h}y)`,
          },
          {
            name: '2-Stage FCF',
            value: (() => {
              if (fcfoPositive <= 0 || ks <= glong) return null;
              // Stage 1: PV of FCF growing at gs for n years
              const stage1PV = calcPVGrowingAnnuity(fcfoPositive, gs, ks, n);
              // FCF at end of stage 1
              const fcfN = fcfoPositive * Math.pow(1 + gs, n);
              // Stage 2: Terminal value (perpetuity at glong)
              const stage2PV = calcTerminalValuePV(fcfN, glong, ks, n);
              const result = stage1PV + stage2PV;
              return result > 0 && isFinite(result) ? result : null;
            })(),
            enabled: true,
            description: `FCF 2-Stage (FCF=$${fcfoPositive.toFixed(2)}, g=${(gs * 100).toFixed(1)}%, glong=${(glong * 100).toFixed(1)}%, Ks=${(ks * 100).toFixed(1)}%)`,
          },
          {
            name: '3-Stage FCF',
            value: (() => {
              if (fcfoPositive <= 0 || ks <= glong) return null;
              // Stage 1: High growth (gs) for n years
              const stage1PV = calcPVGrowingAnnuity(fcfoPositive, gs, ks, n);
              // Stage 2: Transition - linear decline from gs to glong over h years
              let stage2PV = 0;
              let lastFCF = fcfoPositive * Math.pow(1 + gs, n);
              for (let t = 1; t <= h; t++) {
                const transitionG = gs - (gs - glong) * (t / h);
                lastFCF = lastFCF * (1 + transitionG);
                stage2PV += lastFCF / Math.pow(1 + ks, n + t);
              }
              // Stage 3: Terminal value at glong
              const stage3PV = calcTerminalValuePV(lastFCF, glong, ks, n + h);
              const result = stage1PV + stage2PV + stage3PV;
              return result > 0 && isFinite(result) ? result : null;
            })(),
            enabled: true,
            description: `FCF 3-Stage (g=${(gs * 100).toFixed(1)}%→${(glong * 100).toFixed(1)}%, H=${h}y transition)`,
          },
          {
            name: 'Mean Target',
            value: meanTarget,
            enabled: true,
            description: 'Precio objetivo promedio de analistas',
          },
          {
            name: 'Graham Method',
            value: Math.sqrt(22.5 * bookValue * epsTTM),
            enabled: true,
            description: 'V = sqrt(22.5 * BV * EPS)',
          },
          // ────────────────────────────────────────────────
          // Métodos avanzados
          // ────────────────────────────────────────────────
          {
            name: 'RIM (Ohlson)',
            value: rimValue > 0 && isFinite(rimValue) ? rimValue : null,
            enabled: true,
            description: `Residual Income Model - Ohlson (ω=${effectiveOmega.toFixed(2)}, γ=${effectiveGamma.toFixed(2)})`,
          },
          {
            name: 'DCF',
            value: dcfValue > 0 && isFinite(dcfValue) ? dcfValue : null,
            enabled: true,
            description: `DCF interno (WACC=${effectiveDiscountRate.toFixed(1)}%, Exit=${exitMultiple}x)`,
          },
          {
            name: 'EPS*Benchmark',
            value: epsBenchmarkValue > 0 && isFinite(epsBenchmarkValue) ? epsBenchmarkValue : null,
            enabled: true,
            description: `EPS TTM ($${epsTTM.toFixed(2)}) × Avg Peer P/E (${avgPeerPE.toFixed(1)}x)`,
          },
          {
            name: 'Stochastic DCF',
            value: stochasticDCFValue > 0 && isFinite(stochasticDCFValue) ? stochasticDCFValue : null,
            enabled: true,
            description: `DCF con ajuste estocástico (σ=${effectiveVolatility.toFixed(2)}, λ=${effectiveLambda.toFixed(2)})`,
          },
          {
            name: 'Bayesian (NK DSGE)',
            value: bayesianValue > 0 && isFinite(bayesianValue) ? bayesianValue : null,
            enabled: true,
            description: `New Keynesian DSGE (φπ=${effectivePhiPi.toFixed(2)}, φy=${effectivePhiY.toFixed(2)}, κ=${effectiveKappa.toFixed(3)})`,
          },
          {
            name: 'HJM',
            value: hjmValue > 0 && isFinite(hjmValue) ? hjmValue : null,
            enabled: true,
            description: `Heath-Jarrow-Morton (σ=${effectiveHjmSigma.toFixed(3)}, a=${effectiveHjmMeanReversion.toFixed(2)})`,
          },
          // ────────────────────────────────────────────────
          // FCFE Methods
          // ────────────────────────────────────────────────
          {
            name: '2-Stage FCFE',
            value: fcfe2StageValue > 0 && isFinite(fcfe2StageValue) ? fcfe2StageValue : null,
            enabled: true,
            description: `FCFE 2 etapas (Re=${(re * 100).toFixed(1)}%, g1=${(fcfeGrowth1 * 100).toFixed(1)}%)`,
          },
          {
            name: '3-Stage FCFE',
            value: fcfe3StageValue > 0 && isFinite(fcfe3StageValue) ? fcfe3StageValue : null,
            enabled: true,
            description: `FCFE 3 etapas (H=${transitionYears} años transición)`,
          },
          // ────────────────────────────────────────────────
          // FCFF Methods
          // ────────────────────────────────────────────────
          {
            name: '2-Stage FCFF',
            value: fcff2StageValue > 0 && isFinite(fcff2StageValue) ? fcff2StageValue : null,
            enabled: true,
            description: `FCFF 2 etapas (WACC=${(wacc * 100).toFixed(1)}%, Net Debt=${(netDebt / 1e9).toFixed(1)}B)`,
          },
          {
            name: '3-Stage FCFF',
            value: fcff3StageValue > 0 && isFinite(fcff3StageValue) ? fcff3StageValue : null,
            enabled: true,
            description: `FCFF 3 etapas (WACC=${(wacc * 100).toFixed(1)}%)`,
          },
          // ────────────────────────────────────────────────
          // External DCF Values
          // ────────────────────────────────────────────────
          {
            name: 'Advance DCF (API)',
            value: advanceDCFValue && advanceDCFValue > 0 && isFinite(advanceDCFValue) ? advanceDCFValue : null,
            enabled: true,
            description: 'Equity Value Per Share from FMP Custom DCF',
          },
          // ────────────────────────────────────────────────
          // Monte Carlo DCF (Stochastic Simulation)
          // ────────────────────────────────────────────────
          {
            name: 'Monte Carlo DCF',
            value: monteCarloDCF?.mean && monteCarloDCF.mean > 0 && isFinite(monteCarloDCF.mean)
              ? monteCarloDCF.mean
              : null,
            enabled: true,
            description: monteCarloDCF
              ? `${monteCarloDCF.simCount} sims → P10: $${monteCarloDCF.p10.toFixed(2)} | P50: $${monteCarloDCF.p50.toFixed(2)} | P90: $${monteCarloDCF.p90.toFixed(2)}`
              : 'Monte Carlo simulation - requires DCF base',
          },
          // ────────────────────────────────────────────────
          // DCF from Cálculos Tab
          // ────────────────────────────────────────────────
          {
            name: 'DCF (Cálculos)',
            value: dcfFromCalculos && dcfFromCalculos > 0 && isFinite(dcfFromCalculos) ? dcfFromCalculos : null,
            enabled: true,
            description: 'Valor intrínseco calculado en la pestaña Cálculos (DCF multi-etapa)',
          },
          // ────────────────────────────────────────────────
          // FMP Key Metrics Based Valuations
          // ────────────────────────────────────────────────
          {
            name: 'Graham Number (API)',
            value: (() => {
              // FMP TTM endpoint may return grahamNumber or grahamNumberTTM
              const v = keyMetricsTTM?.grahamNumber ?? keyMetricsTTM?.grahamNumberTTM;
              return v && v > 0 && isFinite(v) ? v : null;
            })(),
            enabled: true,
            description: 'Graham Number from FMP: sqrt(22.5 × EPS × BVPS)',
          },
          {
            name: 'Graham Net-Net (API)',
            value: (() => {
              // FMP TTM endpoint may return grahamNetNet or grahamNetNetTTM
              const v = keyMetricsTTM?.grahamNetNet ?? keyMetricsTTM?.grahamNetNetTTM;
              if (v != null && isFinite(v)) return v; // null/undefined filtered, 0 and negatives are valid
              // Fallback: calculate Net-Net from balance sheet (value can be negative)
              const currentAssets = lastBalance.totalCurrentAssets || 0;
              const totalLiabilities = lastBalance.totalLiabilities || 0;
              const shares = lastIncome.weightedAverageShsOutDil || lastIncome.weightedAverageShsOut || quote?.sharesOutstanding || 0;
              if (currentAssets > 0 && shares > 0) {
                const netNet = (currentAssets - totalLiabilities) / shares;
                return isFinite(netNet) ? netNet : null;
              }
              return null;
            })(),
            enabled: true,
            description: 'Net-Net Working Capital: (Current Assets - Total Liabilities) / Shares',
          },
          // ────────────────────────────────────────────────
          // Owner Earnings (Buffett Method)
          // ────────────────────────────────────────────────
          {
            name: 'Owner Earnings (Buffett)',
            value: ownerEarnings && ownerEarnings.length > 0 && ownerEarnings[0]?.ownersEarningsPerShare > 0
              ? (() => {
                  // Gordon Growth Model using Owner Earnings
                  const oePS = ownerEarnings[0].ownersEarningsPerShare;
                  const discRate = ks > 0 ? ks : 0.10;
                  const growthRate = glong;
                  if (discRate > growthRate) {
                    return (oePS * (1 + growthRate)) / (discRate - growthRate);
                  }
                  return null;
                })()
              : null,
            enabled: true,
            description: ownerEarnings && ownerEarnings.length > 0
              ? `Owner Earnings GGM (OE/Share=$${ownerEarnings[0]?.ownersEarningsPerShare?.toFixed(2) || 0})`
              : 'Owner Earnings (Buffett method) - data not available',
          },
          // ────────────────────────────────────────────────
          // Price Return Model (uses sharePriceT5 target)
          // PV = sharePriceT5 / (1+ks)^n + PV of dividends over period
          // ────────────────────────────────────────────────
          {
            name: 'Price Return (T5)',
            value: (() => {
              if (sharePriceT5 <= 0 || ks <= 0) return null;
              const pvTerminalPrice = sharePriceT5 / Math.pow(1 + ks, n);
              const pvDividends = d0 > 0 && ks > gs ? calcPVGrowingAnnuity(d0, gs, ks, n) : 0;
              const result = pvTerminalPrice + pvDividends;
              return result > 0 && isFinite(result) ? result : null;
            })(),
            enabled: true,
            description: `PV of T${n} target $${sharePriceT5.toFixed(2)} discounted at Ks=${(ks * 100).toFixed(1)}%`,
          },
          // NOTE: AdvanceValue Net is rendered separately to avoid infinite loop
        ];

        // Update calculated state variables for getModelInputs
        setCalcD0(d0);
        setCalcKs(ks);
        setCalcGs(gs);
        setCalcFcfo(fcfo);
        setCalcEpsTTM(epsTTM);
        setCalcBookValue(bookValue);
        setCalcRoe(roe);
        setCalcFcfe(fcfePerShare);
        setCalcFcff(fcffBase / sharesOutstanding);
        setCalcNetDebt(netDebt);
        setCalcNetIncome(netIncome / sharesOutstanding);
        setCalcDA(dna / sharesOutstanding);
        setCalcCapex(capex / sharesOutstanding);
        setCalcAvgPeerPE(avgPeerPE);

        setMethods(calculatedMethods);
      } catch (err: any) {
        console.error('[ValuacionesTab] Error:', err);
        setError(err.message || 'Error al calcular valuaciones');
      } finally {
        setLoading(false);
      }
    };

    calculate();
  }, [
    h, glong, n, sharePriceT5, sharePriceTxCAGR,
    income, balance, cashFlow, priceTarget, profile, quote,
    effectiveOmega, effectiveGamma, // RIM params
    effectiveDiscountRate, exitMultiple, projectedGrowthRate, // DCF params
    effectiveVolatility, effectiveLambda, // Stochastic params
    effectivePhiPi, effectivePhiY, effectiveBetaDSGE, effectiveKappa, // DSGE params
    effectiveHjmSigma, effectiveHjmMeanReversion, // HJM params
    peerPE, dcfCalculation, dcfCustom, dividends, cashFlowAsReported, // Include dividend sources
    userFcfo, // User override for FCF0
    sustainableGrowthRate, // SGR from SustainableGrowthTab
    avgCAPMFromBeta, // Average CAPM from BetaTab for Ks
    keyMetricsTTM, // FMP Key Metrics TTM (Graham Number, Net-Net, etc.)
    ownerEarnings, // FMP Owner Earnings (Buffett method)
    monteCarloDCF, // Monte Carlo simulation results
    // NOTE: advanceValueNet is NOT included here to avoid infinite loop
    // The neural model is fetched separately and updates its own state
  ]);

  const toggleMethod = (index: number) => {
    setMethods(prev =>
      prev.map((m, i) => i === index ? { ...m, enabled: !m.enabled } : m)
    );
  };

  // Calcular promedio ponderado de métodos habilitados con valores válidos
  const enabledMethods = methods.filter(m => m.enabled && m.value !== null && m.value > 0 && isFinite(m.value));
  const averageVal = (() => {
    // Build weighted items: each enabled model + optional Prismo
    const items: Array<{ value: number; weight: number }> = [];
    enabledMethods.forEach(m => {
      const w = modelWeights[m.name] ?? 0;
      if (w > 0) items.push({ value: m.value!, weight: w });
    });
    if (includePrismoValue && advanceValueNet?.fair_value && advanceValueNet.fair_value > 0) {
      // Prismo uses the same weight as Advance DCF (API) or a minimum of 10
      const prismoW = Math.max(modelWeights[MN.ADCF] ?? 0, 10);
      items.push({ value: advanceValueNet.fair_value, weight: prismoW });
    }
    if (items.length === 0) {
      // Fallback: if all weights are 0, use equal-weight arithmetic mean
      const vals = enabledMethods.map(m => m.value!);
      if (includePrismoValue && advanceValueNet?.fair_value && advanceValueNet.fair_value > 0) vals.push(advanceValueNet.fair_value);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    const totalW = items.reduce((s, i) => s + i.weight, 0);
    return totalW > 0 ? items.reduce((s, i) => s + i.value * i.weight, 0) / totalW : null;
  })();

  // Notificar al padre cuando cambie el averageVal
  useEffect(() => {
    if (onAverageValChange) {
      onAverageValChange(averageVal);
    }
  }, [averageVal, onAverageValChange]);

  // ────────────────────────────────────────────────
  // AdvanceValue Net - Call backend API when methods are ready
  // ────────────────────────────────────────────────
  useEffect(() => {
    const fetchAdvanceValueNet = async () => {
      // Need at least some valid methods and a current price
      const validMethods = methods.filter(m => m.value !== null && m.value > 0 && isFinite(m.value));
      const currentPrice = quote?.price;

      console.log('[AdvanceValueNet] Checking conditions:', {
        validMethodsCount: validMethods.length,
        currentPrice,
        methodsTotal: methods.length
      });

      if (validMethods.length < 3 || !currentPrice || currentPrice <= 0) {
        console.log('[AdvanceValueNet] Conditions not met, skipping fetch');
        return;
      }

      console.log('[AdvanceValueNet] Starting fetch to backend...');
      setAdvanceValueNetLoading(true);
      setAdvanceValueNetError(null);

      try {
        // Prepare expert valuations (all method values)
        const expertValuations = methods
          .filter(m => m.name !== 'AdvanceValue Net (Neural)') // Exclude self
          .map(m => m.value);

        // Prepare tabular features from financial data
        const sortedIncome = [...income].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const sortedBalance = [...balance].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastIncome = sortedIncome[0] || {};
        const lastBalance = sortedBalance[0] || {};

        const tabularFeatures = [
          // Profitability
          lastIncome.netIncome && lastBalance.totalStockholdersEquity
            ? lastIncome.netIncome / lastBalance.totalStockholdersEquity : 0, // ROE
          lastIncome.grossProfitRatio || 0,
          lastIncome.operatingIncomeRatio || 0,
          lastIncome.netIncomeRatio || 0,
          // Growth
          sustainableGrowthRate || 0,
          // Valuation
          profile?.beta || 1,
          avgCAPMFromBeta ? avgCAPMFromBeta / 100 : 0.10, // Cost of equity
          // Leverage
          lastBalance.totalDebt && lastBalance.totalStockholdersEquity
            ? lastBalance.totalDebt / lastBalance.totalStockholdersEquity : 0,
          // Size
          Math.log10(Math.max(lastBalance.totalAssets || 1, 1)),
          // Efficiency
          lastIncome.revenue && lastBalance.totalAssets
            ? lastIncome.revenue / lastBalance.totalAssets : 0,
        ];

        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/advancevalue/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker,
            current_price: currentPrice,
            expert_valuations: expertValuations,
            tabular_features: tabularFeatures,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[AdvanceValueNet] Success! Response:', data);
        const advanceData = {
          fair_value: data.fair_value,
          confidence_interval: data.confidence_interval,
          signal: data.signal,
          upside_pct: data.upside_pct,
          experts_used: data.experts_used,
          base_ensemble: data.base_ensemble,
          current_price: quote?.price || 0,
        };
        setAdvanceValueNet(advanceData);
        // Notify parent component for ResumenTab
        if (onAdvanceValueNetChange) {
          onAdvanceValueNetChange(advanceData);
        }
      } catch (err: any) {
        console.error('[AdvanceValueNet] Error:', err.message);
        setAdvanceValueNetError(err.message);
        setAdvanceValueNet(null);
      } finally {
        setAdvanceValueNetLoading(false);
      }
    };

    // Only fetch if we have methods calculated
    if (methods.length > 0 && !loading) {
      fetchAdvanceValueNet();
    }
  }, [methods, loading, quote, income, balance, profile, sustainableGrowthRate, avgCAPMFromBeta, ticker]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="relative">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-green-500 border-t-transparent"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-green-400">$</span>
        </div>
      </div>
      <p className="text-xl text-gray-300">{t('valuacionesTab.loading')}</p>
    </div>
  );

  if (error) return (
    <div className="bg-red-900/30 border border-red-500 rounded-xl p-6 text-center">
      <p className="text-xl text-red-400">❌ Error: {error}</p>
    </div>
  );

  // ── Section 1: DDM — Dividend Discount Models ──
  const ddmMethods = methods.filter(m =>
    m.name.includes('DDM') || m.name.includes('Gordon') || m.name === 'H Model' || m.name.includes('H-Model')
  );

  // ── Section 2: FCF — Free Cash Flow models (FCF / FCFF / FCFE) ──
  const fcfMethods = methods.filter(m => m.name.includes('FCF'));

  // ── Section 3: DCF — Discounted Cash Flow models (DCF, Monte Carlo, Stochastic) ──
  const dcfOnlyMethods = methods.filter(m => m.name.includes('DCF') && !m.name.includes('FCF'));

  // ── Section 4: Relative — Graham + EPS/P/E benchmarks ──
  const grahamRelativeMethods = methods.filter(m =>
    m.name.includes('Graham') || m.name.includes('Net-Net') ||
    m.name.includes('EPS') || m.name.includes('P/E') || m.name.includes('Analyst') ||
    m.name === 'Mean Target'
  );

  // ── Section 5: Advanced quant models ──
  const advancedMethods = methods.filter(m =>
    m.name.includes('RIM') || m.name.includes('DSGE') || m.name.includes('Bayesian') ||
    m.name.includes('HJM') || m.name.includes('Merton') ||
    m.name.includes('Owner Earnings') || m.name.includes('Buffett')
  );

  // Get null reasons for models - More detailed explanations
  const getNullReason = (methodName: string): string | undefined => {
    const hasDividends = dividends && dividends.length > 0 && dividends.some(d => d.dividend > 0);
    const latestCashFlow = cashFlow?.[0];
    const hasPositiveFCF = latestCashFlow?.freeCashFlow > 0;
    const hasPositiveOCF = latestCashFlow?.operatingCashFlow > 0;
    const hasPositiveEarnings = income?.[0]?.netIncome > 0;
    const hasAnalystTargets = priceTarget?.targetHigh > 0;

    // DDM Models - require dividends
    if (methodName.includes('DDM') || methodName.includes('Gordon') || methodName.includes('H-Model') || methodName === 'H Model') {
      if (!hasDividends) return 'No paga dividendos';
    }

    // FCF/FCFE/FCFF Models - require positive cash flows or valid parameters
    if (methodName.includes('FCF') || methodName.includes('FCFE') || methodName.includes('FCFF')) {
      if (!latestCashFlow) return 'Sin datos de cash flow';
      if (!hasPositiveFCF && !hasPositiveOCF) return 'Cash flow negativo (FCF y OCF)';
      if (!hasPositiveFCF) return 'FCF negativo - usando aproximación de earnings';
      // If value is still null, it might be due to rate constraints (ks <= gs)
      // This happens when growth rate exceeds cost of equity
      return 'Parámetros inválidos (ks ≤ g) - ajustar tasas';
    }

    // Analyst/Target Price
    if (methodName.includes('Analyst')) {
      if (!hasAnalystTargets) return 'Sin estimaciones de analistas';
    }

    // EPS-based models
    if (methodName.includes('EPS') || methodName.includes('P/E')) {
      if (!hasPositiveEarnings) return 'Ganancias (EPS) negativas';
    }

    // Stochastic/Advanced models
    if (methodName.includes('Stochastic') || methodName.includes('Merton')) {
      if (!hasPositiveFCF) return 'Requiere FCF positivo para modelo estocástico';
    }

    // RIM/DSGE/HJM models
    if (methodName.includes('RIM') || methodName.includes('DSGE') || methodName.includes('HJM')) {
      if (!hasPositiveEarnings) return 'Requiere ganancias positivas';
    }

    return undefined;
  };

  // ────────────────────────────────────────────────
  // Función para obtener los inputs editables de cada modelo
  // ALL valuation models with ALL their relevant inputs
  // Uses state variables (calcD0, calcKs, etc.) to access calculated values
  // ────────────────────────────────────────────────
  const getModelInputs = (methodName: string): { label: string; key: string; value: number; step?: number; min?: number; max?: number }[] | undefined => {
    // Use user overrides if available, otherwise use calculated values
    const d0Val = userD0 !== null ? userD0 : calcD0;
    const ksVal = userKs !== null ? userKs : calcKs;
    const gsVal = userGs !== null ? userGs : calcGs;
    const epsVal = userEps !== null ? userEps : calcEpsTTM;
    const bvVal = userBookValue !== null ? userBookValue : calcBookValue;
    const peerPEVal = userPeerPE !== null ? userPeerPE : calcAvgPeerPE;

    // 2-Stage DDM
    if (methodName === '2-Stage DDM') {
      return [
        { label: 'D0 (Dividend)', key: 'd0', value: d0Val, step: 0.01, min: 0 },
        { label: 'Ks (Cost Eq) %', key: 'ks', value: ksVal * 100, step: 0.1, min: 0.1 },
        { label: 'gs (Growth S1) %', key: 'gs', value: gsVal * 100, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
      ];
    }

    // 3-Stage DDM
    if (methodName === '3-Stage DDM') {
      return [
        { label: 'D0 (Dividend)', key: 'd0', value: d0Val, step: 0.01, min: 0 },
        { label: 'Ks (Cost Eq) %', key: 'ks', value: ksVal * 100, step: 0.1, min: 0.1 },
        { label: 'gs (Growth S1) %', key: 'gs', value: gsVal * 100, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
        { label: 'H (Transition)', key: 'h', value: h, step: 1, min: 1, max: 15 },
      ];
    }

    // H Model DDM
    if (methodName === 'H Model') {
      return [
        { label: 'D0 (Dividend)', key: 'd0', value: d0Val, step: 0.01, min: 0 },
        { label: 'Ks (Cost Eq) %', key: 'ks', value: ksVal * 100, step: 0.1, min: 0.1 },
        { label: 'gs (High Growth) %', key: 'gs', value: gsVal * 100, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'H (Half-life)', key: 'h', value: h, step: 1, min: 1, max: 20 },
      ];
    }

    // 2-Stage FCF
    if (methodName === '2-Stage FCF') {
      return [
        { label: 'FCF0 (Base)', key: 'fcf0', value: userFcfo !== null ? userFcfo : calcFcfo, step: 0.1 },
        { label: 'Ks (Discount) %', key: 'ks', value: ksVal * 100, step: 0.1, min: 0.1 },
        { label: 'gs (Growth S1) %', key: 'gs', value: gsVal * 100, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
      ];
    }

    // 3-Stage FCF
    if (methodName === '3-Stage FCF') {
      return [
        { label: 'FCF0 (Base)', key: 'fcf0', value: userFcfo !== null ? userFcfo : calcFcfo, step: 0.1 },
        { label: 'Ks (Discount) %', key: 'ks', value: ksVal * 100, step: 0.1, min: 0.1 },
        { label: 'gs (Growth S1) %', key: 'gs', value: gsVal * 100, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
        { label: 'H (Transition)', key: 'h', value: h, step: 1, min: 1, max: 15 },
      ];
    }

    // Graham Method
    if (methodName === 'Graham Method') {
      return [
        { label: 'EPS (TTM)', key: 'eps', value: epsVal, step: 0.01 },
        { label: 'Book Value', key: 'bookValue', value: bvVal, step: 0.1 },
      ];
    }

    // RIM Ohlson
    if (methodName.includes('RIM')) {
      return [
        { label: 'Book Value', key: 'bookValue', value: bvVal, step: 0.1 },
        { label: 'ROE %', key: 'roe', value: calcRoe * 100, step: 0.1 },
        { label: 'Ks (Cost Eq) %', key: 'ks', value: ksVal * 100, step: 0.1 },
        { label: 'ω (Persistence)', key: 'omega', value: effectiveOmega, step: 0.01, min: 0, max: 1 },
        { label: 'γ (Other Info)', key: 'gamma', value: effectiveGamma, step: 0.01 },
      ];
    }

    // DCF general
    if (methodName === 'DCF') {
      return [
        { label: 'FCF (Base)', key: 'fcf0', value: userFcfo !== null ? userFcfo : calcFcfo, step: 0.1 },
        { label: 'WACC %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25, min: 0.1 },
        { label: 'Exit Multiple', key: 'exitMultiple', value: exitMultiple, step: 0.5, min: 1, max: 50 },
        { label: 'Growth %', key: 'projectedGrowthRate', value: projectedGrowthRate, step: 0.5 },
        { label: 'N (Years)', key: 'n', value: n, step: 1, min: 1, max: 20 },
      ];
    }

    // EPS*Benchmark
    if (methodName === 'EPS*Benchmark') {
      return [
        { label: 'EPS (TTM)', key: 'eps', value: epsVal, step: 0.01 },
        { label: 'Avg Peer P/E', key: 'peerPE', value: peerPEVal, step: 0.5, min: 1, max: 100 },
      ];
    }

    // Stochastic DCF
    if (methodName.includes('Stochastic')) {
      return [
        { label: 'FCF (Base)', key: 'fcf0', value: userFcfo !== null ? userFcfo : calcFcfo, step: 0.1 },
        { label: 'WACC %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25 },
        { label: 'σ (FCF Vol)', key: 'volatility', value: effectiveVolatility, step: 0.01, min: 0, max: 1 },
        { label: 'λ (Risk Price)', key: 'lambda', value: effectiveLambda, step: 0.1 },
        { label: 'N (Years)', key: 'n', value: n, step: 1, min: 1, max: 20 },
      ];
    }

    // NK DSGE Bayesian
    if (methodName.includes('DSGE') || methodName.includes('Bayesian')) {
      return [
        { label: 'EPS (Base)', key: 'eps', value: epsVal, step: 0.01 },
        { label: 'Ks (Discount) %', key: 'ks', value: ksVal * 100, step: 0.1 },
        { label: 'φπ (Taylor Infl)', key: 'phi_pi', value: effectivePhiPi, step: 0.1, min: 1 },
        { label: 'φy (Taylor Out)', key: 'phi_y', value: effectivePhiY, step: 0.05 },
        { label: 'κ (Phillips)', key: 'kappa', value: effectiveKappa, step: 0.01, min: 0 },
      ];
    }

    // HJM
    if (methodName.includes('HJM')) {
      return [
        { label: 'FCF (Base)', key: 'fcf0', value: userFcfo !== null ? userFcfo : calcFcfo, step: 0.1 },
        { label: 'Ks (Discount) %', key: 'ks', value: ksVal * 100, step: 0.1 },
        { label: 'σ (Fwd Vol)', key: 'hjmSigma', value: effectiveHjmSigma, step: 0.001, min: 0 },
        { label: 'a (Mean Rev)', key: 'hjmMeanReversion', value: effectiveHjmMeanReversion, step: 0.01, min: 0 },
        { label: 'N (Years)', key: 'n', value: n, step: 1, min: 1, max: 20 },
      ];
    }

    // 2-Stage FCFE
    if (methodName === '2-Stage FCFE') {
      return [
        { label: 'FCFE (Base)', key: 'fcfe0', value: calcFcfe, step: 0.1 },
        { label: 'Re (Cost Eq) %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25, min: 0.1 },
        { label: 'g1 (Growth S1) %', key: 'projectedGrowthRate', value: projectedGrowthRate, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
      ];
    }

    // 3-Stage FCFE
    if (methodName === '3-Stage FCFE') {
      return [
        { label: 'FCFE (Base)', key: 'fcfe0', value: calcFcfe, step: 0.1 },
        { label: 'Re (Cost Eq) %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25, min: 0.1 },
        { label: 'g1 (Growth S1) %', key: 'projectedGrowthRate', value: projectedGrowthRate, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
        { label: 'H (Transition)', key: 'h', value: h, step: 1, min: 1, max: 15 },
      ];
    }

    // 2-Stage FCFF
    if (methodName === '2-Stage FCFF') {
      return [
        { label: 'FCFF (Base)', key: 'fcff0', value: calcFcff, step: 0.1 },
        { label: 'WACC %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25, min: 0.1 },
        { label: 'g1 (Growth S1) %', key: 'projectedGrowthRate', value: projectedGrowthRate, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
        { label: 'Net Debt ($B)', key: 'netDebt', value: calcNetDebt / 1e9, step: 0.1 },
      ];
    }

    // 3-Stage FCFF
    if (methodName === '3-Stage FCFF') {
      return [
        { label: 'FCFF (Base)', key: 'fcff0', value: calcFcff, step: 0.1 },
        { label: 'WACC %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25, min: 0.1 },
        { label: 'g1 (Growth S1) %', key: 'projectedGrowthRate', value: projectedGrowthRate, step: 0.5 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
        { label: 'N (Years S1)', key: 'n', value: n, step: 1, min: 1, max: 20 },
        { label: 'H (Transition)', key: 'h', value: h, step: 1, min: 1, max: 15 },
        { label: 'Net Debt ($B)', key: 'netDebt', value: calcNetDebt / 1e9, step: 0.1 },
      ];
    }

    // Monte Carlo DCF
    if (methodName.includes('Monte Carlo')) {
      return [
        { label: 'FCF (Base)', key: 'fcf0', value: userFcfo !== null ? userFcfo : calcFcfo, step: 0.1 },
        { label: 'WACC %', key: 'discountRate', value: effectiveDiscountRate, step: 0.25, min: 0.1 },
        { label: 'Exit Multiple', key: 'exitMultiple', value: exitMultiple, step: 0.5, min: 1, max: 50 },
        { label: 'Growth %', key: 'projectedGrowthRate', value: projectedGrowthRate, step: 0.5 },
        { label: 'Simulations', key: 'simCount', value: 5000, step: 1000, min: 1000, max: 10000 },
      ];
    }

    // Owner Earnings (Buffett)
    if (methodName.includes('Owner Earnings')) {
      return [
        { label: 'Net Income', key: 'netIncome', value: calcNetIncome, step: 0.1 },
        { label: 'D&A', key: 'da', value: calcDA, step: 0.1 },
        { label: 'CapEx', key: 'capex', value: calcCapex, step: 0.1 },
        { label: 'Ks (Discount) %', key: 'ks', value: ksVal * 100, step: 0.1 },
        { label: 'g∞ (Long-term) %', key: 'glong', value: glong * 100, step: 0.1 },
      ];
    }

    // Mean Target - from analysts (read-only conceptually, but allow adjustment)
    if (methodName === 'Mean Target') {
      return undefined; // Analyst target, no user inputs
    }

    // API-based methods (Graham Number, Graham Net-Net, Advance DCF) - no local inputs
    if (methodName.includes('(API)')) {
      return undefined;
    }

    return undefined;
  };

  // Handler para cambios en inputs de modelos
  const handleModelInputChange = (key: string, value: number) => {
    switch (key) {
      // Core model parameters
      case 'n': setN(Math.max(1, Math.round(value))); break;
      case 'h': setH(Math.max(1, Math.round(value))); break;
      case 'glong': setGlong(value / 100); break;
      case 'discountRate': setDiscountRate(value); break;
      case 'exitMultiple': setExitMultiple(value); break;
      case 'projectedGrowthRate': setProjectedGrowthRate(value); break;

      // DDM specific
      case 'd0': setUserD0(value); break;
      case 'ks': setUserKs(value / 100); break;
      case 'gs': setUserGs(value / 100); break;

      // Fundamental inputs
      case 'eps': setUserEps(value); break;
      case 'bookValue': setUserBookValue(value); break;
      case 'peerPE': setUserPeerPE(value); break;
      case 'netDebt': setUserNetDebt(value); break;
      case 'fcf0': setUserFcfo(value); break;

      // RIM/Ohlson
      case 'omega': setOmega(value); break;
      case 'gamma': setGamma(value); break;

      // Stochastic DCF
      case 'volatility': setVolatility(value); break;
      case 'lambda': setLambda(value); break;

      // NK DSGE
      case 'phi_pi': setPhi_pi(value); break;
      case 'phi_y': setPhi_y(value); break;
      case 'kappa': setKappa(value); break;

      // HJM
      case 'hjmSigma': setHjmSigma(value); break;
      case 'hjmMeanReversion': setHjmMeanReversion(value); break;

      default:
        console.log(`[ValuacionesTab] Unhandled input key: ${key}`);
        break;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.06]">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {t('valuacionesTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('valuacionesTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-500">{t('valuacionesTab.currentPrice')}</p>
            <p className="text-2xl font-bold text-gray-100">${quote?.price?.toFixed(2) || 'N/A'}</p>
          </div>
          <div className="text-right bg-gray-950 px-4 py-2 rounded-xl border border-green-600">
            <p className="text-xs text-green-400">SGR</p>
            <p className="text-xl font-bold text-green-400">
              {sustainableGrowthRate != null && sustainableGrowthRate !== undefined ? `${(sustainableGrowthRate * 100).toFixed(1)}%` : '8%'}
            </p>
          </div>
        </div>
      </div>

      {/* Collapsible DCF Parameters Section */}
      <CollapsibleSection
        title="Parámetros DCF"
        icon="📊"
        defaultOpen={false}
        badge={
          <span className="px-2 py-1 text-xs bg-green-600/30 text-green-400 rounded-full">
            WACC: {effectiveDiscountRate.toFixed(1)}%
          </span>
        }
      >
        <div className="space-y-6">
          {/* Basic Parameters */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">H (años transición)</label>
              <input
                type="number"
                value={h}
                onChange={(e) => setH(Number(e.target.value) || 5)}
                className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Glong (crecimiento LP)</label>
              <input
                type="number"
                step="0.01"
                value={glong}
                onChange={(e) => setGlong(Number(e.target.value) || 0.04)}
                className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">N (años proyección)</label>
              <input
                type="number"
                value={n}
                onChange={(e) => setN(Number(e.target.value) || 5)}
                className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                CAGR Share Price (%)
                {cagrStats?.maxCagr != null && cagrStats?.minCagr != null && (
                  <span className="text-green-400 ml-1">
                    [Avg: {((cagrStats.maxCagr + cagrStats.minCagr) / 2).toFixed(2)}%]
                  </span>
                )}
              </label>
              <input
                type="number"
                step="1"
                value={cagrStats?.maxCagr != null && cagrStats?.minCagr != null
                  ? Number(((cagrStats.maxCagr + cagrStats.minCagr) / 2).toFixed(2))
                  : sharePriceTxCAGR}
                onChange={(e) => setSharePriceTxCAGR(Number(e.target.value) || 10)}
                className={`w-full px-3 py-2 border rounded-lg text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500 ${
                  cagrStats?.maxCagr != null ? 'border-green-600 bg-green-900/20' : 'border-white/[0.08] bg-gray-900'
                }`}
                readOnly={cagrStats?.maxCagr != null && cagrStats?.minCagr != null}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 flex items-center justify-between">
                <span>Share Price T{n}</span>
                {manualSharePriceT5 !== null && (
                  <button
                    onClick={() => setManualSharePriceT5(null)}
                    className="text-[10px] text-yellow-400 hover:text-yellow-300 border border-yellow-600/40 rounded px-1.5 py-0.5 transition"
                    title="Reset to auto-calculated value"
                  >
                    ↺ Auto (${autoSharePriceT5.toFixed(2)})
                  </button>
                )}
              </label>
              <input
                type="number"
                step="0.01"
                value={manualSharePriceT5 !== null ? manualSharePriceT5 : Number(autoSharePriceT5.toFixed(2))}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setManualSharePriceT5(isNaN(val) ? null : val);
                }}
                className={`w-full px-3 py-2 border rounded-lg text-center font-semibold focus:ring-1 focus:ring-green-500 ${
                  manualSharePriceT5 !== null
                    ? 'border-yellow-500 bg-yellow-900/20 text-yellow-300'
                    : 'border-green-600 bg-green-900/30 text-green-400'
                }`}
              />
            </div>
          </div>

          {/* DCF Specific */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Discount Rate (WACC) %</label>
              <input
                type="number"
                step="0.5"
                value={discountRate ?? effectiveDiscountRate}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setDiscountRate(isNaN(val) ? null : val);
                }}
                className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Exit Multiple (EV/EBITDA)</label>
              <input
                type="number"
                step="0.5"
                value={exitMultiple}
                onChange={(e) => setExitMultiple(Number(e.target.value) || 12)}
                className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Revenue Growth % (proyectado)</label>
              <input
                type="number"
                step="0.5"
                value={projectedGrowthRate}
                onChange={(e) => setProjectedGrowthRate(Number(e.target.value) || 5)}
                className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
              />
            </div>
          </div>

          {/* WACC Breakdown */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-gray-800 rounded-xl border border-white/[0.06]">
            <div className="text-center">
              <p className="text-xs text-gray-500">Advance DCF (API)</p>
              <p className="text-lg font-bold text-emerald-400">{dcfCustom?.wacc ? `${dcfCustom.wacc.toFixed(2)}%` : 'N/A'}</p>
            </div>
            <div className="text-center border-x border-white/[0.06]">
              <p className="text-xs text-gray-500">WACC Calculado</p>
              <p className="text-lg font-bold text-emerald-400">{calculatedDefaultWACC.toFixed(2)}%</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">WACC Usado</p>
              <p className="text-lg font-bold text-green-400">{effectiveDiscountRate.toFixed(2)}%</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Collapsible Advanced Models Parameters */}
      <CollapsibleSection
        title="Parámetros Modelos Avanzados"
        icon="🔬"
        defaultOpen={false}
        badge={
          <span className="px-2 py-1 text-xs bg-emerald-600/30 text-emerald-400 rounded-full">
            Quant Models
          </span>
        }
      >
        <div className="space-y-6">
          {/* RIM Ohlson */}
          <div className="p-4 bg-green-900/20 rounded-xl border border-green-700/50">
            <h5 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
              📘 RIM (Ohlson Model)
            </h5>
            <p className="text-xs text-gray-500 mb-3">ω calculado via AR(1) en ROE histórico. γ basado en beta y sector.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">ω (persistencia)</label>
                <input type="number" step="0.01" value={omega ?? effectiveOmega}
                  onChange={(e) => setOmega(parseFloat(e.target.value) || null)}
                  className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 text-sm focus:border-green-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">γ (other info)</label>
                <input type="number" step="0.01" value={gamma ?? effectiveGamma}
                  onChange={(e) => setGamma(parseFloat(e.target.value) || null)}
                  className="w-full px-3 py-2 border border-white/[0.08] rounded-lg bg-gray-900 text-gray-100 text-sm focus:border-green-500"
                />
              </div>
            </div>
          </div>

          {/* Stochastic + NK DSGE + HJM in a grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Stochastic DCF */}
            <div className="p-4 bg-emerald-900/20 rounded-xl border border-emerald-700/50">
              <h5 className="text-sm font-semibold text-emerald-400 mb-2">📈 Stochastic DCF</h5>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">σ (vol FCF)</label>
                  <input type="number" step="0.01" value={volatility ?? effectiveVolatility}
                    onChange={(e) => setVolatility(parseFloat(e.target.value) || null)}
                    className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">λ (risk price)</label>
                  <input type="number" step="0.1" value={lambda ?? effectiveLambda}
                    onChange={(e) => setLambda(parseFloat(e.target.value) || null)}
                    className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* NK DSGE */}
            <div className="p-4 bg-green-900/20 rounded-xl border border-green-700/50">
              <h5 className="text-sm font-semibold text-green-400 mb-2">🏛️ NK DSGE</h5>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">φπ</label>
                    <input type="number" step="0.1" value={phi_pi ?? effectivePhiPi}
                      onChange={(e) => setPhi_pi(parseFloat(e.target.value) || null)}
                      className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">φy</label>
                    <input type="number" step="0.1" value={phi_y ?? effectivePhiY}
                      onChange={(e) => setPhi_y(parseFloat(e.target.value) || null)}
                      className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">κ</label>
                    <input type="number" step="0.01" value={kappa ?? effectiveKappa}
                      onChange={(e) => setKappa(parseFloat(e.target.value) || null)}
                      className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">β</label>
                    <input type="number" step="0.01" value={betaDSGE ?? effectiveBetaDSGE}
                      onChange={(e) => setBetaDSGE(parseFloat(e.target.value) || null)}
                      className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* HJM */}
            <div className="p-4 bg-orange-900/20 rounded-xl border border-orange-700/50">
              <h5 className="text-sm font-semibold text-orange-400 mb-2">📉 HJM</h5>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">σ (fwd rate vol)</label>
                  <input type="number" step="0.001" value={hjmSigma ?? effectiveHjmSigma}
                    onChange={(e) => setHjmSigma(parseFloat(e.target.value) || null)}
                    className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">a (mean rev)</label>
                  <input type="number" step="0.01" value={hjmMeanReversion ?? effectiveHjmMeanReversion}
                    onChange={(e) => setHjmMeanReversion(parseFloat(e.target.value) || null)}
                    className="w-full px-2 py-1.5 border border-white/[0.08] rounded bg-gray-900 text-gray-100 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ═══════════════════════════════════════════════════
          WEIGHTS CONFIG PANEL — Dynamic weighted average
          ═══════════════════════════════════════════════════ */}
      <CollapsibleSection
        title="Pesos del Promedio Ponderado"
        icon="⚖️"
        defaultOpen={false}
        badge={
          <span className={`px-2 py-1 text-xs rounded-full ${weightsCustomized ? 'bg-amber-600/30 text-amber-400' : 'bg-blue-600/30 text-blue-400'}`}>
            {weightsCustomized ? 'Personalizado' : `Óptimo · ${profile?.industry ?? 'General'}`}
          </span>
        }
      >
        <div className="space-y-4">
          {/* Info bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-400">
              <span className="text-gray-300 font-medium">Industria detectada: </span>
              <span className="text-blue-400">{profile?.industry ?? 'Desconocida'}</span>
              <span className="mx-2 text-gray-600">·</span>
              <span className={paysDividends ? 'text-green-400' : 'text-gray-500'}>
                {paysDividends ? '✓ Paga dividendos' : '✗ Sin dividendos'}
              </span>
              <span className="mx-2 text-gray-600">·</span>
              <span className="text-gray-400">Peso 0 = excluido del promedio</span>
            </div>
            <button
              onClick={resetToOptimalWeights}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-600/40 rounded-lg hover:bg-blue-600/30 transition-all"
            >
              ↺ Restaurar Óptimos
            </button>
          </div>

          {/* Model weights grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ALL_MODEL_NAMES.map(modelName => {
              const w = modelWeights[modelName] ?? 0;
              const isActive = w > 0;
              const method = methods.find(m => m.name === modelName);
              const hasValue = method ? (method.value !== null && method.value > 0) : false;
              return (
                <div
                  key={modelName}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    isActive
                      ? 'bg-gray-800/80 border-green-600/40'
                      : 'bg-gray-900/40 border-gray-700/40 opacity-60'
                  }`}
                >
                  <span className={`flex-1 text-xs truncate ${hasValue ? 'text-gray-200' : 'text-gray-500'}`} title={modelName}>
                    {modelName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${Math.min(w, 100)}%` }}
                      />
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={w}
                      onChange={e => {
                        const val = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                        setModelWeights(prev => ({ ...prev, [modelName]: val }));
                        setWeightsCustomized(true);
                      }}
                      className="w-12 px-1.5 py-0.5 text-xs text-center bg-gray-900 border border-white/[0.08] rounded text-gray-100 focus:border-green-500 focus:ring-1 focus:ring-green-500"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total weight & active models summary */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-1 border-t border-white/[0.06]">
            <span>
              Modelos activos (peso &gt; 0): <span className="text-green-400 font-medium">{ALL_MODEL_NAMES.filter(n => (modelWeights[n] ?? 0) > 0).length}</span>
            </span>
            <span>
              Peso total: <span className="text-blue-400 font-medium">{ALL_MODEL_NAMES.reduce((s, n) => s + (modelWeights[n] ?? 0), 0)}</span>
              <span className="text-gray-600 ml-1">(normalizado automáticamente)</span>
            </span>
          </div>
        </div>
      </CollapsibleSection>

      {/* Peer P/E for benchmarking */}
      {peerPE.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-800/50 rounded-xl border border-white/[0.06]">
          <span className="text-xs text-gray-500">P/E Peers:</span>
          {peerPE.slice(0, 5).map((peer) => (
            <span key={peer.symbol} className="px-2 py-1 bg-gray-700/50 rounded text-xs text-gray-400">
              {peer.symbol}: {peer.pe?.toFixed(1)}x
            </span>
          ))}
          <span className="px-2 py-1 bg-green-900/50 rounded text-xs text-green-400 font-semibold">
            Avg: {(peerPE.reduce((s, p) => s + (p.pe || 0), 0) / peerPE.length).toFixed(1)}x
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          VALUATION MODELS GRID - Professional Design
          ═══════════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* DDM Models Section */}
        {ddmMethods.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full"></span>
              Dividend Discount Models (DDM)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {ddmMethods.map((method, i) => (
                <ModelCard
                  key={`ddm-${i}`}
                  name={method.name}
                  value={method.value}
                  enabled={method.enabled}
                  description={method.description}
                  onToggle={() => toggleMethod(methods.indexOf(method))}
                  nullReason={getNullReason(method.name)}
                  inputs={getModelInputs(method.name)}
                  onInputChange={handleModelInputChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section 2: FCF Models */}
        {fcfMethods.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
              Free Cash Flow Models (FCF / FCFF / FCFE)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {fcfMethods.map((method: ValuationMethod, i: number) => (
                <ModelCard
                  key={`fcf-${i}`}
                  name={method.name}
                  value={method.value}
                  enabled={method.enabled}
                  description={method.description}
                  onToggle={() => toggleMethod(methods.indexOf(method))}
                  nullReason={getNullReason(method.name)}
                  inputs={getModelInputs(method.name)}
                  onInputChange={handleModelInputChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section 3: DCF Models */}
        {dcfOnlyMethods.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
              Discounted Cash Flow Models (DCF)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {dcfOnlyMethods.map((method: ValuationMethod, i: number) => (
                <ModelCard
                  key={`dcf-${i}`}
                  name={method.name}
                  value={method.value}
                  enabled={method.enabled}
                  description={method.description}
                  onToggle={() => toggleMethod(methods.indexOf(method))}
                  nullReason={getNullReason(method.name)}
                  inputs={getModelInputs(method.name)}
                  onInputChange={handleModelInputChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section 4: Relative Valuations (Graham + EPS/P/E) */}
        {grahamRelativeMethods.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-amber-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
              Relative Valuations (Graham & Benchmarks)
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {grahamRelativeMethods.map((method: ValuationMethod, i: number) => (
                <ModelCard
                  key={`rel-${i}`}
                  name={method.name}
                  value={method.value}
                  enabled={method.enabled}
                  description={method.description}
                  onToggle={() => toggleMethod(methods.indexOf(method))}
                  nullReason={getNullReason(method.name)}
                  inputs={getModelInputs(method.name)}
                  onInputChange={handleModelInputChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* Advanced/Quant Models Section */}
        {advancedMethods.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
              Advanced Quantitative Models
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {advancedMethods.map((method, i) => (
                <ModelCard
                  key={`adv-${i}`}
                  name={method.name}
                  value={method.value}
                  enabled={method.enabled}
                  description={method.description}
                  onToggle={() => toggleMethod(methods.indexOf(method))}
                  nullReason={getNullReason(method.name)}
                  inputs={getModelInputs(method.name)}
                  onInputChange={handleModelInputChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* PrismoValue - Neural Ensemble Section */}
        {(advanceValueNet || advanceValueNetLoading) && (
          <div>
            <h4 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                🧠 PrismoValue — Neural Ensemble
              </span>
              <label className="flex items-center gap-2 text-xs font-normal text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePrismoValue}
                  onChange={e => setIncludePrismoValue(e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500"
                />
                Incluir en promedio
              </label>
            </h4>
            <div className="bg-gradient-to-br from-gray-950 via-gray-800 to-emerald-900/30 p-5 rounded-2xl border-2 border-emerald-500/40 shadow-lg">
              {advanceValueNetLoading && !advanceValueNet && (
                <div className="flex items-center justify-center py-6 gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500 border-t-transparent"></div>
                  <p className="text-emerald-400">Consultando Neural Ensemble...</p>
                </div>
              )}
              {advanceValueNetError && (
                <div className="text-center py-4">
                  <p className="text-red-400 text-sm">⚠️ Error: {advanceValueNetError}</p>
                  <p className="text-gray-500 text-xs mt-1">Asegúrate de que el servidor backend esté corriendo</p>
                </div>
              )}
              {advanceValueNet && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs text-emerald-400 uppercase tracking-wide mb-1">Fair Value (AI)</p>
                      <p className="text-4xl font-black text-emerald-300">
                        ${advanceValueNet.fair_value.toFixed(2)}
                      </p>
                    </div>
                    <div className={`px-4 py-2 rounded-xl text-sm font-bold ${
                      advanceValueNet.signal === 'SUBVALUADO'
                        ? 'bg-green-600/30 text-green-400 border border-green-500/50'
                        : advanceValueNet.signal === 'SOBREVALUADO'
                          ? 'bg-red-600/30 text-red-400 border border-red-500/50'
                          : 'bg-yellow-600/30 text-yellow-400 border border-yellow-500/50'
                    }`}>
                      {advanceValueNet.signal === 'SUBVALUADO' ? '📈' : advanceValueNet.signal === 'SOBREVALUADO' ? '📉' : '➡️'} {advanceValueNet.signal}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-gray-800/60 p-3 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Intervalo Confianza</p>
                      <p className="text-sm font-semibold text-gray-300">
                        ${advanceValueNet.confidence_interval[0].toFixed(2)} - ${advanceValueNet.confidence_interval[1].toFixed(2)}
                      </p>
                    </div>
                    <div className="bg-gray-800/60 p-3 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Upside/Downside</p>
                      <p className={`text-sm font-semibold ${
                        (advanceValueNet.upside_pct ?? 0) > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {(advanceValueNet.upside_pct ?? 0) > 0 ? '+' : ''}{(advanceValueNet.upside_pct ?? 0).toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-gray-800/60 p-3 rounded-xl">
                      <p className="text-xs text-gray-500 mb-1">Modelos Usados</p>
                      <p className="text-sm font-semibold text-gray-300">{advanceValueNet.experts_used}</p>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 mt-3 text-center">
                    Base Ensemble: ${(advanceValueNet.base_ensemble ?? 0).toFixed(2)} | Neural Ensemble combina {advanceValueNet.experts_used ?? 0} valuaciones con métricas financieras
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════
          FINAL VALUATION SUMMARY - Premium Design
          ═══════════════════════════════════════════════════ */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8 rounded-3xl border-2 border-green-500/30 shadow-2xl">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-gradient-to-r from-green-600/5 via-emerald-600/5 to-green-600/5"></div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl"></div>

        <div className="relative z-10">
          <div className="text-center mb-6">
            <h4 className="text-lg font-medium text-gray-400 mb-2">{t('valuacionesTab.avgIntrinsicValue')}</h4>
            <p className="text-7xl font-black bg-gradient-to-r from-green-400 via-green-300 to-emerald-400 bg-clip-text text-transparent tracking-tight">
              {averageVal !== null ? `$${averageVal.toFixed(2)}` : '—'}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Promedio ponderado · {enabledMethods.filter(m => (modelWeights[m.name] ?? 0) > 0).length} modelos con peso &gt; 0
            </p>
          </div>

          {/* Comparison Grid */}
          {quote?.price && averageVal && (
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="bg-gray-800/80 backdrop-blur p-5 rounded-2xl border border-white/[0.06] text-center">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Precio de Mercado</p>
                <p className="text-3xl font-bold text-gray-100">${quote.price.toFixed(2)}</p>
              </div>
              <div className="bg-green-900/40 backdrop-blur p-5 rounded-2xl border-2 border-green-500/50 text-center">
                <p className="text-xs text-green-400 uppercase tracking-wide mb-1">Valor Intrínseco</p>
                <p className="text-3xl font-bold text-green-400">${averageVal.toFixed(2)}</p>
              </div>
              <div className={`backdrop-blur p-5 rounded-2xl border text-center ${
                averageVal > quote.price
                  ? 'bg-green-900/40 border-green-500/50'
                  : 'bg-red-900/40 border-red-500/50'
              }`}>
                <p className={`text-xs uppercase tracking-wide mb-1 ${
                  averageVal > quote.price ? 'text-green-400' : 'text-red-400'
                }`}>
                  {averageVal > quote.price ? t('valuacionesTab.upside') : 'Downside'}
                </p>
                <p className={`text-3xl font-bold ${
                  averageVal > quote.price ? 'text-green-400' : 'text-red-400'
                }`}>
                  {((averageVal / quote.price - 1) * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          )}

          {/* Signal Indicator */}
          {quote?.price && averageVal && (
            <div className={`mt-6 p-4 rounded-xl border text-center ${
              averageVal > quote.price * 1.2
                ? 'bg-green-900/30 border-green-600'
                : averageVal < quote.price * 0.8
                  ? 'bg-red-900/30 border-red-600'
                  : 'bg-yellow-900/30 border-yellow-600'
            }`}>
              <p className={`text-sm font-semibold ${
                averageVal > quote.price * 1.2
                  ? 'text-green-400'
                  : averageVal < quote.price * 0.8
                    ? 'text-red-400'
                    : 'text-yellow-400'
              }`}>
                {averageVal > quote.price * 1.2
                  ? '📈 Potencialmente SUBVALUADO (+20% upside o más)'
                  : averageVal < quote.price * 0.8
                    ? '📉 Potencialmente SOBREVALUADO (-20% o más)'
                    : '➡️ Valor aproximadamente en línea con el mercado'
                }
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-600 text-center">
        Modifica los parámetros en las secciones colapsables o desmarca modelos para ajustar el cálculo.
      </p>
    </div>
  );
}
