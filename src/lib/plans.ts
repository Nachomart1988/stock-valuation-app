// ============================================================
// PLAN DEFINITIONS & TAB ACCESS CONTROL
// ============================================================
// Tab indices (from analizar/page.tsx categories array):
//  0 - Inicio
//  1 - Financial Statements
//  2 - Forecasts          (sub-tabs: Analyst, Revenue, ML Prediction)
//  3 - General Analysis   (merged: Analysis + Company + News — sub-tab gating inline)
//  4 - Inputs & DCF       (merged: Inputs + DCF — sub-tab gating inline)
//  5 - Intraday           (sub-tabs: Pivots, Gaps, Momentum)
//  6 - Valuaciones
//  7 - Probability
//  8 - Options            (sub-tabs: Chain, Strategy Simulator, Suggestions)
//  9 - Resumen Maestro
// 10 - Quantum Risk Model
// 11 - Quantum Portfolio  (GOD MODE only — hidden for other plans)
// 12 - DRL Trading        (GOD MODE only — hidden for other plans)
// last - Investor Journal (sub-tabs: Diario, Portfolio Optimization) — dynamic index

export type PlanTier = 'free' | 'pro' | 'elite' | 'gold' | 'godmode';

export const PLAN_METADATA: Record<PlanTier, { name: string; price: number; color: string; badge: string }> = {
  free:    { name: 'Free',     price: 0,   color: 'text-gray-400',   badge: 'bg-gray-700' },
  pro:     { name: 'Pro',      price: 29,  color: 'text-emerald-400', badge: 'bg-emerald-700' },
  elite:   { name: 'Elite',    price: 59,  color: 'text-violet-400',  badge: 'bg-violet-700' },
  gold:    { name: 'Gold',     price: 100, color: 'text-yellow-400',  badge: 'bg-yellow-700' },
  godmode: { name: 'GOD MODE', price: 0,   color: 'text-red-400',     badge: 'bg-red-700' },
};

// ── Main tab access ──────────────────────────────────────────
// Maps tab index → minimum plan required
// Tabs NOT listed are accessible to all (free+)
export const TAB_MIN_PLAN: Record<number, PlanTier> = {
  2:  'pro',   // Forecasts (incl. ML Prediction)
  5:  'pro',   // Intraday (Pivots + Gaps + Momentum)
  7:  'pro',   // Probability
  8:  'pro',   // Options
  9:  'elite', // Resumen Maestro
  10: 'gold',  // Quantum Risk Model
  // Quantum Portfolio & DRL Trading are hidden (not in categories) for non-GODMODE
  // Investor Journal (elite) is gated inline since its index is dynamic
};

// ── Sub-tab access ───────────────────────────────────────────
// For tabs with partial free access, list which sub-tab indices are allowed per plan.
// Sub-tab indices that are NOT listed for a plan require an upgrade.
// 'all' means no restriction for that plan.

export type SubTabAccess = number[] | 'all';

export interface TabSubAccess {
  [plan: string]: SubTabAccess;
}

// Tab 3 (sub-tab: Analysis) — General Info: [0=AnalisisGeneral, 1=KeyMetrics, 2=Analistas, 3=DuPont]
export const GENERAL_INFO_ACCESS: TabSubAccess = {
  free:    [0],      // Only Análisis General
  pro:     'all',
  elite:   'all',
  gold:    'all',
  godmode: 'all',
};

// Tab 3 (sub-tab: Company) — Company: [0=Competidores, 1=Industry, 2=Segmentation, 3=Holders]
export const COMPANY_ACCESS: TabSubAccess = {
  free:    [0],      // Only Competidores
  pro:     'all',
  elite:   'all',
  gold:    'all',
  godmode: 'all',
};

// Tab 4 (sub-tab: Inputs) — Inputs: [0=SGR, 1=Beta, 2=CAGR, 3=WACC]
// Free: only SGR top-down/bottom-up (=SGR tab index 0) and Beta (=index 1)
export const INPUTS_ACCESS: TabSubAccess = {
  free:    [0, 1],   // SGR and Beta only
  pro:     'all',
  elite:   'all',
  gold:    'all',
  godmode: 'all',
};

// Tab 4 (sub-tab: DCF) — DCF: [0=Calculos, 1=DCF Models]
// Free: only second sub-tab (DCF Models)
export const DCF_ACCESS: TabSubAccess = {
  free:    [1],      // Only DCF Models (2nd sub-tab)
  pro:     'all',
  elite:   'all',
  gold:    'all',
  godmode: 'all',
};

// ── Helpers ─────────────────────────────────────────────────

const PLAN_ORDER: PlanTier[] = ['free', 'pro', 'elite', 'gold', 'godmode'];

export function planRank(plan: PlanTier): number {
  return PLAN_ORDER.indexOf(plan);
}

/** Returns true if the user's plan meets the minimum requirement */
export function canAccessTab(userPlan: PlanTier, tabIndex: number): boolean {
  const required = TAB_MIN_PLAN[tabIndex];
  if (!required) return true; // no restriction
  return planRank(userPlan) >= planRank(required);
}

/** Returns true if the user's plan can access a specific sub-tab */
export function canAccessSubTab(userPlan: PlanTier, access: TabSubAccess): (subIndex: number) => boolean {
  const allowed = access[userPlan] ?? 'all';
  return (subIndex: number) => {
    if (allowed === 'all') return true;
    return (allowed as number[]).includes(subIndex);
  };
}

/** Returns the minimum plan name required to access a tab */
export function minPlanForTab(tabIndex: number): string {
  const tier = TAB_MIN_PLAN[tabIndex];
  if (!tier) return '';
  return PLAN_METADATA[tier].name;
}

/** PDF export is available for Elite and Gold only */
export function canExportPDF(userPlan: PlanTier): boolean {
  return planRank(userPlan) >= planRank('elite');
}
