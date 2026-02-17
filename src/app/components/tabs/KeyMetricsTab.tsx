// src/app/components/tabs/KeyMetricsTab.tsx
'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface KeyMetricsTabProps {
  ticker: string;
  industry?: string;
  onCompanyQualityNetChange?: (data: any) => void; // Callback for ResumenTab
}

// Industry benchmarks data - extensive mapping
const INDUSTRY_BENCHMARKS: Record<string, Record<string, { range: [number, number]; direction_better: 'higher' | 'lower' }>> = {
  "Advertising Agencies": {
    "P/E Ratio": { range: [35, 55], direction_better: "lower" },
    "ROE": { range: [-2, 10], direction_better: "higher" },
    "ROA": { range: [-1, 5], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [2, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Aerospace & Defense": {
    "P/E Ratio": { range: [20, 35], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [5, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 1.8], direction_better: "higher" }
  },
  "Agricultural Inputs": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [10, 20], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Airlines": {
    "P/E Ratio": { range: [5, 15], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [3, 8], direction_better: "higher" },
    "Debt/Equity": { range: [2.0, 5.0], direction_better: "lower" },
    "Net Margin": { range: [2, 8], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.0], direction_better: "higher" }
  },
  "Airports & Air Services": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [8, 18], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 3.0], direction_better: "lower" },
    "Net Margin": { range: [10, 25], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Apparel Manufacturing": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [6, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Apparel Retail": {
    "P/E Ratio": { range: [10, 25], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [4, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Asset Management": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [2, 8], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 1.0], direction_better: "lower" },
    "Net Margin": { range: [20, 40], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Auto Manufacturers": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [10, 20], direction_better: "higher" },
    "ROA": { range: [3, 8], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [3, 8], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Auto Parts": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [10, 22], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [4, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Banks - Diversified": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [10, 18], direction_better: "higher" },
    "ROA": { range: [0.8, 1.5], direction_better: "higher" },
    "Debt/Equity": { range: [8, 15], direction_better: "lower" },
    "Net Margin": { range: [20, 35], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Banks - Regional": {
    "P/E Ratio": { range: [8, 14], direction_better: "lower" },
    "ROE": { range: [8, 15], direction_better: "higher" },
    "ROA": { range: [0.8, 1.3], direction_better: "higher" },
    "Debt/Equity": { range: [6, 12], direction_better: "lower" },
    "Net Margin": { range: [25, 40], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Beverages - Non-Alcoholic": {
    "P/E Ratio": { range: [20, 35], direction_better: "lower" },
    "ROE": { range: [25, 50], direction_better: "higher" },
    "ROA": { range: [8, 15], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [15, 25], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.3], direction_better: "higher" }
  },
  "Beverages - Wineries & Distilleries": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [10, 20], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Biotechnology": {
    "P/E Ratio": { range: [20, 50], direction_better: "lower" },
    "ROE": { range: [-20, 25], direction_better: "higher" },
    "ROA": { range: [-15, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.8], direction_better: "lower" },
    "Net Margin": { range: [-50, 30], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 6.0], direction_better: "higher" }
  },
  "Broadcasting": {
    "P/E Ratio": { range: [8, 18], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 3.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Building Materials": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [6, 14], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Building Products & Equipment": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [8, 16], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Capital Markets": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [2, 6], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 3.0], direction_better: "lower" },
    "Net Margin": { range: [15, 30], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Chemicals": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.4, 1.2], direction_better: "lower" },
    "Net Margin": { range: [6, 14], direction_better: "higher" },
    "Current Ratio": { range: [1.3, 2.2], direction_better: "higher" }
  },
  "Communication Equipment": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [5, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Computer Hardware": {
    "P/E Ratio": { range: [15, 35], direction_better: "lower" },
    "ROE": { range: [15, 40], direction_better: "higher" },
    "ROA": { range: [8, 20], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.2], direction_better: "lower" },
    "Net Margin": { range: [5, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.5], direction_better: "higher" }
  },
  "Confectioners": {
    "P/E Ratio": { range: [18, 30], direction_better: "lower" },
    "ROE": { range: [20, 40], direction_better: "higher" },
    "ROA": { range: [8, 16], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Conglomerates": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [10, 20], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [6, 14], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Consulting Services": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [20, 45], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Consumer Electronics": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [30, 80], direction_better: "higher" },
    "ROA": { range: [12, 25], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [15, 28], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Credit Services": {
    "P/E Ratio": { range: [10, 18], direction_better: "lower" },
    "ROE": { range: [18, 35], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [5, 12], direction_better: "lower" },
    "Net Margin": { range: [15, 30], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Department Stores": {
    "P/E Ratio": { range: [8, 18], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [2, 8], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Diagnostics & Research": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [10, 22], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Discount Stores": {
    "P/E Ratio": { range: [18, 32], direction_better: "lower" },
    "ROE": { range: [18, 35], direction_better: "higher" },
    "ROA": { range: [6, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [2, 5], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Drug Manufacturers - General": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [12, 25], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Drug Manufacturers - Specialty & Generic": {
    "P/E Ratio": { range: [8, 20], direction_better: "lower" },
    "ROE": { range: [8, 22], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [5, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.5], direction_better: "higher" }
  },
  "Education & Training Services": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [12, 30], direction_better: "higher" },
    "ROA": { range: [5, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.5], direction_better: "lower" },
    "Net Margin": { range: [8, 20], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Electrical Equipment & Parts": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [6, 14], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Electronic Components": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [6, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.8, 3.0], direction_better: "higher" }
  },
  "Electronic Gaming & Multimedia": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [8, 20], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.5], direction_better: "lower" },
    "Net Margin": { range: [15, 30], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.5], direction_better: "higher" }
  },
  "Engineering & Construction": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [3, 8], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 1.8], direction_better: "higher" }
  },
  "Entertainment": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [8, 22], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Farm Products": {
    "P/E Ratio": { range: [10, 22], direction_better: "lower" },
    "ROE": { range: [8, 18], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [3, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Financial Data & Stock Exchanges": {
    "P/E Ratio": { range: [25, 45], direction_better: "lower" },
    "ROE": { range: [20, 45], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [25, 45], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Food Distribution": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [1, 3], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Footwear & Accessories": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [20, 45], direction_better: "higher" },
    "ROA": { range: [10, 22], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 3.5], direction_better: "higher" }
  },
  "Furnishings, Fixtures & Appliances": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Gambling": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [2.0, 5.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Gold": {
    "P/E Ratio": { range: [15, 35], direction_better: "lower" },
    "ROE": { range: [5, 18], direction_better: "higher" },
    "ROA": { range: [3, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [10, 30], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Grocery Stores": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [1.5, 4], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Health Care Plans": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [2, 6], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Health Information Services": {
    "P/E Ratio": { range: [25, 50], direction_better: "lower" },
    "ROE": { range: [8, 22], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Healthcare Providers": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.5], direction_better: "lower" },
    "Net Margin": { range: [3, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Home Improvement Retail": {
    "P/E Ratio": { range: [18, 30], direction_better: "lower" },
    "ROE": { range: [35, 80], direction_better: "higher" },
    "ROA": { range: [12, 22], direction_better: "higher" },
    "Debt/Equity": { range: [1.5, 4.0], direction_better: "lower" },
    "Net Margin": { range: [8, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Household & Personal Products": {
    "P/E Ratio": { range: [20, 35], direction_better: "lower" },
    "ROE": { range: [20, 50], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [10, 20], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Industrial Distribution": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [20, 40], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Information Technology Services": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Insurance - Diversified": {
    "P/E Ratio": { range: [10, 18], direction_better: "lower" },
    "ROE": { range: [10, 18], direction_better: "higher" },
    "ROA": { range: [1, 3], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Insurance - Life": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [8, 15], direction_better: "higher" },
    "ROA": { range: [0.5, 1.5], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.6], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Insurance - Property & Casualty": {
    "P/E Ratio": { range: [10, 18], direction_better: "lower" },
    "ROE": { range: [10, 18], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.5], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Insurance - Reinsurance": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [8, 15], direction_better: "higher" },
    "ROA": { range: [1, 3], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.5], direction_better: "lower" },
    "Net Margin": { range: [6, 12], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Insurance - Specialty": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [12, 22], direction_better: "higher" },
    "ROA": { range: [3, 8], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.6], direction_better: "lower" },
    "Net Margin": { range: [10, 20], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  },
  "Insurance Brokers": {
    "P/E Ratio": { range: [20, 35], direction_better: "lower" },
    "ROE": { range: [20, 40], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [12, 22], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Integrated Freight & Logistics": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [4, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Internet Content & Information": {
    "P/E Ratio": { range: [25, 50], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [8, 20], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.5], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 4.0], direction_better: "higher" }
  },
  "Internet Retail": {
    "P/E Ratio": { range: [30, 80], direction_better: "lower" },
    "ROE": { range: [10, 30], direction_better: "higher" },
    "ROA": { range: [3, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [2, 8], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Leisure": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Lodging": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [15, 40], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [1.5, 4.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.2], direction_better: "higher" }
  },
  "Luxury Goods": {
    "P/E Ratio": { range: [25, 45], direction_better: "lower" },
    "ROE": { range: [20, 40], direction_better: "higher" },
    "ROA": { range: [10, 22], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [15, 28], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Marine Shipping": {
    "P/E Ratio": { range: [5, 15], direction_better: "lower" },
    "ROE": { range: [8, 25], direction_better: "higher" },
    "ROA": { range: [3, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [10, 30], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Medical Care Facilities": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 3.0], direction_better: "lower" },
    "Net Margin": { range: [3, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Medical Devices": {
    "P/E Ratio": { range: [25, 45], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [12, 25], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 4.0], direction_better: "higher" }
  },
  "Medical Distribution": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [20, 45], direction_better: "higher" },
    "ROA": { range: [3, 8], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [0.5, 2], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.3], direction_better: "higher" }
  },
  "Medical Instruments & Supplies": {
    "P/E Ratio": { range: [22, 40], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [10, 22], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 4.0], direction_better: "higher" }
  },
  "Metal Fabrication": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Oil & Gas Drilling": {
    "P/E Ratio": { range: [8, 18], direction_better: "lower" },
    "ROE": { range: [5, 20], direction_better: "higher" },
    "ROA": { range: [2, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 20], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Oil & Gas E&P": {
    "P/E Ratio": { range: [6, 15], direction_better: "lower" },
    "ROE": { range: [10, 30], direction_better: "higher" },
    "ROA": { range: [5, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Oil & Gas Equipment & Services": {
    "P/E Ratio": { range: [10, 22], direction_better: "lower" },
    "ROE": { range: [8, 22], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Oil & Gas Integrated": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [12, 25], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Oil & Gas Midstream": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [8, 18], direction_better: "higher" },
    "ROA": { range: [3, 8], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [10, 25], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Oil & Gas Refining & Marketing": {
    "P/E Ratio": { range: [5, 12], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [2, 8], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Other Industrial Metals & Mining": {
    "P/E Ratio": { range: [8, 18], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [5, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [8, 22], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Other Precious Metals & Mining": {
    "P/E Ratio": { range: [12, 30], direction_better: "lower" },
    "ROE": { range: [5, 18], direction_better: "higher" },
    "ROA": { range: [3, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 25], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.5], direction_better: "higher" }
  },
  "Packaged Foods": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [6, 14], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Packaging & Containers": {
    "P/E Ratio": { range: [12, 22], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Paper & Paper Products": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [10, 22], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [4, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Personal Services": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Pharmaceutical Retailers": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [2, 5], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.5], direction_better: "higher" }
  },
  "Publishing": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Railroads": {
    "P/E Ratio": { range: [15, 25], direction_better: "lower" },
    "ROE": { range: [18, 35], direction_better: "higher" },
    "ROA": { range: [6, 12], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.0], direction_better: "lower" },
    "Net Margin": { range: [20, 35], direction_better: "higher" },
    "Current Ratio": { range: [0.6, 1.2], direction_better: "higher" }
  },
  "Real Estate - Development": {
    "P/E Ratio": { range: [8, 18], direction_better: "lower" },
    "ROE": { range: [8, 18], direction_better: "higher" },
    "ROA": { range: [3, 8], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [10, 25], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Real Estate - Diversified": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [5, 15], direction_better: "higher" },
    "ROA": { range: [2, 6], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Real Estate Services": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Recreational Vehicles": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "REIT - Diversified": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [5, 12], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [20, 40], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Healthcare Facilities": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [4, 10], direction_better: "higher" },
    "ROA": { range: [1, 4], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 1.8], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Hotel & Motel": {
    "P/E Ratio": { range: [12, 28], direction_better: "lower" },
    "ROE": { range: [5, 15], direction_better: "higher" },
    "ROA": { range: [2, 6], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 2.0], direction_better: "lower" },
    "Net Margin": { range: [10, 25], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Industrial": {
    "P/E Ratio": { range: [25, 50], direction_better: "lower" },
    "ROE": { range: [5, 12], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.2], direction_better: "lower" },
    "Net Margin": { range: [25, 50], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Mortgage": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [8, 15], direction_better: "higher" },
    "ROA": { range: [1, 3], direction_better: "higher" },
    "Debt/Equity": { range: [4, 10], direction_better: "lower" },
    "Net Margin": { range: [30, 60], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Office": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [4, 10], direction_better: "higher" },
    "ROA": { range: [1, 4], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 1.8], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Residential": {
    "P/E Ratio": { range: [25, 50], direction_better: "lower" },
    "ROE": { range: [5, 12], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [0.6, 1.5], direction_better: "lower" },
    "Net Margin": { range: [20, 40], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Retail": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [5, 12], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 1.8], direction_better: "lower" },
    "Net Margin": { range: [20, 40], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "REIT - Specialty": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [6, 15], direction_better: "higher" },
    "ROA": { range: [2, 6], direction_better: "higher" },
    "Debt/Equity": { range: [0.6, 1.5], direction_better: "lower" },
    "Net Margin": { range: [25, 50], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.5], direction_better: "higher" }
  },
  "Rental & Leasing Services": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [1.5, 4.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Residential Construction": {
    "P/E Ratio": { range: [6, 14], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Resorts & Casinos": {
    "P/E Ratio": { range: [15, 30], direction_better: "lower" },
    "ROE": { range: [12, 30], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [2.0, 5.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Restaurants": {
    "P/E Ratio": { range: [20, 35], direction_better: "lower" },
    "ROE": { range: [20, 50], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 3.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.2], direction_better: "higher" }
  },
  "Scientific & Technical Instruments": {
    "P/E Ratio": { range: [25, 45], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [10, 22], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 4.0], direction_better: "higher" }
  },
  "Security & Protection Services": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Semiconductor Equipment & Materials": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [18, 40], direction_better: "higher" },
    "ROA": { range: [10, 25], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.5], direction_better: "lower" },
    "Net Margin": { range: [18, 35], direction_better: "higher" },
    "Current Ratio": { range: [2.5, 5.0], direction_better: "higher" }
  },
  "Semiconductors": {
    "P/E Ratio": { range: [18, 40], direction_better: "lower" },
    "ROE": { range: [15, 40], direction_better: "higher" },
    "ROA": { range: [8, 22], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.6], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 4.5], direction_better: "higher" }
  },
  "Shell Companies": {
    "P/E Ratio": { range: [0, 0], direction_better: "lower" },
    "ROE": { range: [0, 0], direction_better: "higher" },
    "ROA": { range: [0, 0], direction_better: "higher" },
    "Debt/Equity": { range: [0, 0], direction_better: "lower" },
    "Net Margin": { range: [0, 0], direction_better: "higher" },
    "Current Ratio": { range: [0, 0], direction_better: "higher" }
  },
  "Software - Application": {
    "P/E Ratio": { range: [30, 60], direction_better: "lower" },
    "ROE": { range: [15, 40], direction_better: "higher" },
    "ROA": { range: [8, 22], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.6], direction_better: "lower" },
    "Net Margin": { range: [15, 35], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 4.0], direction_better: "higher" }
  },
  "Software - Infrastructure": {
    "P/E Ratio": { range: [35, 70], direction_better: "lower" },
    "ROE": { range: [12, 35], direction_better: "higher" },
    "ROA": { range: [6, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 1.0], direction_better: "lower" },
    "Net Margin": { range: [12, 30], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.5], direction_better: "higher" }
  },
  "Solar": {
    "P/E Ratio": { range: [15, 40], direction_better: "lower" },
    "ROE": { range: [8, 22], direction_better: "higher" },
    "ROA": { range: [4, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.5], direction_better: "higher" }
  },
  "Specialty Business Services": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.2], direction_better: "higher" }
  },
  "Specialty Chemicals": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [12, 28], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Specialty Industrial Machinery": {
    "P/E Ratio": { range: [18, 35], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 3.0], direction_better: "higher" }
  },
  "Specialty Retail": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [4, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Staffing & Employment Services": {
    "P/E Ratio": { range: [12, 25], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [2, 6], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" }
  },
  "Steel": {
    "P/E Ratio": { range: [5, 12], direction_better: "lower" },
    "ROE": { range: [12, 30], direction_better: "higher" },
    "ROA": { range: [6, 15], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Telecom Services": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [10, 25], direction_better: "higher" },
    "ROA": { range: [4, 10], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.6, 1.2], direction_better: "higher" }
  },
  "Textile Manufacturing": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [10, 22], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [4, 10], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Thermal Coal": {
    "P/E Ratio": { range: [3, 10], direction_better: "lower" },
    "ROE": { range: [15, 40], direction_better: "higher" },
    "ROA": { range: [8, 22], direction_better: "higher" },
    "Debt/Equity": { range: [0.2, 0.8], direction_better: "lower" },
    "Net Margin": { range: [10, 30], direction_better: "higher" },
    "Current Ratio": { range: [1.2, 2.5], direction_better: "higher" }
  },
  "Tobacco": {
    "P/E Ratio": { range: [8, 15], direction_better: "lower" },
    "ROE": { range: [30, 80], direction_better: "higher" },
    "ROA": { range: [10, 25], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 3.0], direction_better: "lower" },
    "Net Margin": { range: [20, 35], direction_better: "higher" },
    "Current Ratio": { range: [0.6, 1.2], direction_better: "higher" }
  },
  "Tools & Accessories": {
    "P/E Ratio": { range: [15, 28], direction_better: "lower" },
    "ROE": { range: [15, 35], direction_better: "higher" },
    "ROA": { range: [8, 18], direction_better: "higher" },
    "Debt/Equity": { range: [0.3, 1.0], direction_better: "lower" },
    "Net Margin": { range: [8, 16], direction_better: "higher" },
    "Current Ratio": { range: [1.5, 2.5], direction_better: "higher" }
  },
  "Travel Services": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [20, 50], direction_better: "higher" },
    "ROA": { range: [8, 20], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 2.0], direction_better: "lower" },
    "Net Margin": { range: [10, 25], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 2.0], direction_better: "higher" }
  },
  "Trucking": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [15, 30], direction_better: "higher" },
    "ROA": { range: [6, 14], direction_better: "higher" },
    "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
    "Net Margin": { range: [5, 12], direction_better: "higher" },
    "Current Ratio": { range: [1.0, 1.8], direction_better: "higher" }
  },
  "Uranium": {
    "P/E Ratio": { range: [20, 50], direction_better: "lower" },
    "ROE": { range: [5, 18], direction_better: "higher" },
    "ROA": { range: [3, 12], direction_better: "higher" },
    "Debt/Equity": { range: [0.1, 0.5], direction_better: "lower" },
    "Net Margin": { range: [10, 30], direction_better: "higher" },
    "Current Ratio": { range: [2.0, 5.0], direction_better: "higher" }
  },
  "Utilities - Diversified": {
    "P/E Ratio": { range: [15, 25], direction_better: "lower" },
    "ROE": { range: [8, 15], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.0], direction_better: "lower" },
    "Net Margin": { range: [8, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.6, 1.2], direction_better: "higher" }
  },
  "Utilities - Independent Power Producers": {
    "P/E Ratio": { range: [10, 20], direction_better: "lower" },
    "ROE": { range: [8, 18], direction_better: "higher" },
    "ROA": { range: [2, 6], direction_better: "higher" },
    "Debt/Equity": { range: [1.5, 3.5], direction_better: "lower" },
    "Net Margin": { range: [5, 15], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.5], direction_better: "higher" }
  },
  "Utilities - Regulated Electric": {
    "P/E Ratio": { range: [15, 25], direction_better: "lower" },
    "ROE": { range: [8, 12], direction_better: "higher" },
    "ROA": { range: [2, 4], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.0], direction_better: "lower" },
    "Net Margin": { range: [10, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.0], direction_better: "higher" }
  },
  "Utilities - Regulated Gas": {
    "P/E Ratio": { range: [15, 22], direction_better: "lower" },
    "ROE": { range: [8, 12], direction_better: "higher" },
    "ROA": { range: [2, 4], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 1.5], direction_better: "lower" },
    "Net Margin": { range: [8, 15], direction_better: "higher" },
    "Current Ratio": { range: [0.5, 1.0], direction_better: "higher" }
  },
  "Utilities - Regulated Water": {
    "P/E Ratio": { range: [25, 40], direction_better: "lower" },
    "ROE": { range: [8, 12], direction_better: "higher" },
    "ROA": { range: [2, 4], direction_better: "higher" },
    "Debt/Equity": { range: [0.8, 1.5], direction_better: "lower" },
    "Net Margin": { range: [15, 28], direction_better: "higher" },
    "Current Ratio": { range: [0.4, 0.8], direction_better: "higher" }
  },
  "Utilities - Renewable": {
    "P/E Ratio": { range: [20, 40], direction_better: "lower" },
    "ROE": { range: [5, 12], direction_better: "higher" },
    "ROA": { range: [2, 5], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [10, 25], direction_better: "higher" },
    "Current Ratio": { range: [0.6, 1.2], direction_better: "higher" }
  },
  "Waste Management": {
    "P/E Ratio": { range: [25, 40], direction_better: "lower" },
    "ROE": { range: [20, 40], direction_better: "higher" },
    "ROA": { range: [5, 12], direction_better: "higher" },
    "Debt/Equity": { range: [1.0, 2.5], direction_better: "lower" },
    "Net Margin": { range: [10, 18], direction_better: "higher" },
    "Current Ratio": { range: [0.8, 1.2], direction_better: "higher" }
  }
};

// Default benchmark for industries not in the list - EXTENDED with all key metrics
const DEFAULT_BENCHMARK: Record<string, { range: [number, number]; direction_better: 'higher' | 'lower' }> = {
  // Valuation
  "P/E Ratio": { range: [15, 25], direction_better: "lower" },
  "PEG Ratio": { range: [0.8, 1.5], direction_better: "lower" },
  "P/B Ratio": { range: [1, 3], direction_better: "lower" },
  "P/S Ratio": { range: [1, 3], direction_better: "lower" },
  "P/FCF Ratio": { range: [10, 20], direction_better: "lower" },
  "EV/EBITDA": { range: [8, 15], direction_better: "lower" },
  "EV/Sales": { range: [1, 4], direction_better: "lower" },
  "EV/FCF": { range: [10, 25], direction_better: "lower" },
  "Earnings Yield": { range: [4, 8], direction_better: "higher" },
  "FCF Yield": { range: [4, 8], direction_better: "higher" },
  "Dividend Yield": { range: [1.5, 4], direction_better: "higher" },
  "Dividend Payout": { range: [25, 60], direction_better: "lower" },
  // Profitability
  "Gross Margin": { range: [30, 50], direction_better: "higher" },
  "Operating Margin": { range: [10, 20], direction_better: "higher" },
  "Net Margin": { range: [8, 15], direction_better: "higher" },
  "EBITDA Margin": { range: [15, 25], direction_better: "higher" },
  "ROA": { range: [5, 10], direction_better: "higher" },
  "ROE": { range: [12, 20], direction_better: "higher" },
  "ROIC": { range: [10, 18], direction_better: "higher" },
  "ROCE": { range: [12, 20], direction_better: "higher" },
  // Liquidity & Solvency
  "Current Ratio": { range: [1.2, 2.0], direction_better: "higher" },
  "Quick Ratio": { range: [0.8, 1.5], direction_better: "higher" },
  "Cash Ratio": { range: [0.2, 0.5], direction_better: "higher" },
  "Debt/Equity": { range: [0.5, 1.5], direction_better: "lower" },
  "Debt/Assets": { range: [0.3, 0.5], direction_better: "lower" },
  "Net Debt/EBITDA": { range: [1, 3], direction_better: "lower" },
  "Interest Coverage": { range: [5, 15], direction_better: "higher" },
  "Financial Leverage": { range: [1.5, 3], direction_better: "lower" },
  // Efficiency
  "Asset Turnover": { range: [0.5, 1.5], direction_better: "higher" },
  "Inventory Turnover": { range: [5, 12], direction_better: "higher" },
  "Receivables Turnover": { range: [6, 12], direction_better: "higher" },
  "Payables Turnover": { range: [6, 12], direction_better: "lower" },
  "Days Sales Out": { range: [30, 60], direction_better: "lower" },
  "Days Inventory": { range: [30, 60], direction_better: "lower" },
  "Days Payables": { range: [30, 60], direction_better: "higher" },
  "Cash Conversion": { range: [20, 60], direction_better: "lower" },
  // Other
  "Income Quality": { range: [1, 1.5], direction_better: "higher" },
  "CapEx/OCF": { range: [10, 30], direction_better: "lower" },
  "CapEx/Revenue": { range: [3, 8], direction_better: "lower" },
};

export default function KeyMetricsTab({ ticker, industry, onCompanyQualityNetChange }: KeyMetricsTabProps) {
  const { t } = useLanguage();
  const [keyMetrics, setKeyMetrics] = useState<any>(null);
  const [ratios, setRatios] = useState<any>(null);
  const [scores, setScores] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // CompanyQuality Net - Neural Ensemble for quality assessment
  const [companyQualityNet, setCompanyQualityNet] = useState<{
    overallScore: number;
    profitability: number;
    financialStrength: number;
    efficiency: number;
    growth: number;
    moat: number;
    riskLevel: 'Low' | 'Medium' | 'High';
    recommendation: string;
  } | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState<string | null>(null);

  // Get benchmark for current industry - MERGE industry-specific with defaults
  // Industry benchmarks override defaults for specific metrics, but defaults cover ALL metrics
  const benchmark = useMemo(() => {
    const industryBenchmark = industry && INDUSTRY_BENCHMARKS[industry]
      ? INDUSTRY_BENCHMARKS[industry]
      : {};
    // Merge: DEFAULT_BENCHMARK as base, industry-specific overrides
    return { ...DEFAULT_BENCHMARK, ...industryBenchmark };
  }, [industry]);

  useEffect(() => {
    const fetchData = async () => {
      if (!ticker) return;

      setLoading(true);
      setError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) throw new Error('API key not found');

        const [metricsRes, ratiosRes, scoresRes] = await Promise.all([
          fetch(`https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
          fetch(`https://financialmodelingprep.com/stable/financial-scores?symbol=${ticker}&apikey=${apiKey}`, { cache: 'no-store' }),
        ]);

        if (metricsRes.ok) {
          const data = await metricsRes.json();
          setKeyMetrics(Array.isArray(data) ? data[0] : data);
        }

        if (ratiosRes.ok) {
          const data = await ratiosRes.json();
          setRatios(Array.isArray(data) ? data[0] : data);
        }

        if (scoresRes.ok) {
          const data = await scoresRes.json();
          setScores(Array.isArray(data) ? data[0] : data);
        }
      } catch (err: any) {
        setError(err.message || 'Error loading data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  // ────────────────────────────────────────────────
  // CompanyQuality Net - Call backend API when data is ready
  // ────────────────────────────────────────────────
  useEffect(() => {
    const fetchCompanyQuality = async () => {
      // Need keyMetrics and ratios to be loaded (don't check loading state here)
      if (!keyMetrics || !ratios) {
        console.log('[CompanyQualityNet] Waiting for data...', { keyMetrics: !!keyMetrics, ratios: !!ratios });
        return;
      }

      console.log('[CompanyQualityNet] Starting fetch with data:', {
        ticker,
        hasKeyMetrics: !!keyMetrics,
        hasRatios: !!ratios,
        hasScores: !!scores
      });
      setQualityLoading(true);
      setQualityError(null);

      try {
        // Prepare features for the neural network
        const features = [
          // Core profitability metrics
          keyMetrics.returnOnEquityTTM || 0,
          keyMetrics.returnOnAssetsTTM || 0,
          keyMetrics.roicTTM || 0,
          ratios.netProfitMarginTTM || 0,
          ratios.grossProfitMarginTTM || 0,
          ratios.operatingProfitMarginTTM || 0,
          ratios.ebitdaMarginTTM || 0,

          // Leverage & Solvency
          ratios.debtToEquityRatioTTM || 0,
          ratios.debtToAssetsRatioTTM || 0,
          ratios.currentRatioTTM || 0,
          ratios.quickRatioTTM || 0,
          ratios.cashRatioTTM || 0,
          ratios.interestCoverageRatioTTM || 0,

          // Efficiency
          ratios.assetTurnoverTTM || 0,
          ratios.inventoryTurnoverTTM || 0,
          ratios.receivablesTurnoverTTM || 0,
          ratios.payablesTurnoverTTM || 0,
          keyMetrics.cashConversionCycleTTM || 0,

          // Valuation
          ratios.priceToEarningsRatioTTM || 0,
          ratios.priceToBookRatioTTM || 0,
          ratios.priceToSalesRatioTTM || 0,
          ratios.priceToFreeCashFlowRatioTTM || 0,
          keyMetrics.evToEBITDATTM || 0,
          keyMetrics.evToSalesTTM || 0,

          // Yield & Returns
          keyMetrics.freeCashFlowYieldTTM || 0,
          keyMetrics.earningsYieldTTM || 0,
          keyMetrics.dividendYieldTTM || 0,
          keyMetrics.payoutRatioTTM || 0,

          // Financial Scores
          scores?.altmanZScore || 0,
          scores?.piotroskiScore || 0,

          // Market metrics
          keyMetrics.peRatioTTM || 0,
          keyMetrics.pegRatioTTM || 0,
          keyMetrics.marketCapTTM || 0,
          keyMetrics.enterpriseValueTTM || 0,

          // Per share metrics
          keyMetrics.revenuePerShareTTM || 0,
          keyMetrics.netIncomePerShareTTM || 0,
          keyMetrics.bookValuePerShareTTM || 0,
          keyMetrics.freeCashFlowPerShareTTM || 0,
          keyMetrics.cashPerShareTTM || 0,
          keyMetrics.operatingCashFlowPerShareTTM || 0,

          // Industry code (for context)
          industry ? Object.keys(INDUSTRY_BENCHMARKS).indexOf(industry) : -1,
        ];

        // Debug: Log the actual features being sent
        console.log('[CompanyQualityNet] Features being sent:', {
          profitability: features.slice(0, 7),
          solvency: features.slice(7, 13),
          efficiency: features.slice(13, 18),
          valuation: features.slice(18, 24),
          yields: features.slice(24, 28),
          scores: features.slice(28, 30),
        });

        const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'}/companyquality/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker,
            features,
            industry: industry || 'Unknown',
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('[CompanyQualityNet] ✅ Raw response:', JSON.stringify(data));

        const qualityData = {
          overallScore: data.overallScore ?? 0,
          profitability: data.profitability ?? 0,
          financialStrength: data.financialStrength ?? 0,
          efficiency: data.efficiency ?? 0,
          growth: data.growth ?? 0,
          moat: data.moat ?? 0,
          riskLevel: (data.riskLevel as 'Low' | 'Medium' | 'High') || 'Medium',
          recommendation: data.recommendation || 'Average',
        };
        console.log(`[CompanyQualityNet] 📊 SCORES: Overall=${qualityData.overallScore}, Prof=${qualityData.profitability}, Fin=${qualityData.financialStrength}`);
        setCompanyQualityNet(qualityData);
        // Notify parent component for ResumenTab
        if (onCompanyQualityNetChange) {
          onCompanyQualityNetChange(qualityData);
        }
      } catch (err: any) {
        console.error('[CompanyQualityNet] ❌ Error:', err.message);
        setQualityError(err.message);
        setCompanyQualityNet(null);
      } finally {
        setQualityLoading(false);
      }
    };

    fetchCompanyQuality();
  }, [keyMetrics, ratios, scores, industry, ticker]);

  const formatValue = (value: any, type: 'percent' | 'ratio' | 'currency' | 'number' | 'days' = 'number') => {
    if (value === null || value === undefined || !isFinite(value)) return 'N/A';

    switch (type) {
      case 'percent':
        return (value * 100).toFixed(2) + '%';
      case 'ratio':
        return value.toFixed(2) + 'x';
      case 'currency':
        if (Math.abs(value) >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
        if (Math.abs(value) >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
        if (Math.abs(value) >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
        return '$' + value.toFixed(2);
      case 'days':
        return value.toFixed(1) + ' days';
      default:
        return value.toFixed(2);
    }
  };

  const getScoreColor = (score: number, type: 'altman' | 'piotroski') => {
    if (type === 'altman') {
      if (score > 2.99) return 'text-green-400';
      if (score > 1.81) return 'text-yellow-400';
      return 'text-red-400';
    } else {
      if (score >= 7) return 'text-green-400';
      if (score >= 4) return 'text-yellow-400';
      return 'text-red-400';
    }
  };

  // Compare value against benchmark
  const getBenchmarkComparison = (
    metricName: string,
    value: number | null | undefined,
    isPercent: boolean = false
  ): { color: string; indicator: string; tooltip: string; status: 'good' | 'neutral' | 'bad' | 'na' } => {
    if (value === null || value === undefined || !isFinite(value)) {
      return { color: 'text-gray-400', indicator: '', tooltip: 'N/A', status: 'na' };
    }

    const benchmarkData = benchmark[metricName];
    if (!benchmarkData) {
      return { color: 'text-gray-100', indicator: '', tooltip: 'No benchmark available', status: 'na' };
    }

    const [low, high] = benchmarkData.range;
    const compareValue = isPercent ? value * 100 : value;
    const direction = benchmarkData.direction_better;

    let status: 'good' | 'neutral' | 'bad';

    if (direction === 'higher') {
      if (compareValue > high) status = 'good';
      else if (compareValue >= low) status = 'neutral';
      else status = 'bad';
    } else {
      if (compareValue < low) status = 'good';
      else if (compareValue <= high) status = 'neutral';
      else status = 'bad';
    }

    const rangeStr = isPercent ? `${low}% - ${high}%` : `${low} - ${high}`;
    const tooltip = `Industry range: ${rangeStr} (${direction} is better)`;

    switch (status) {
      case 'good':
        return { color: 'text-green-400', indicator: '●', tooltip, status };
      case 'neutral':
        return { color: 'text-yellow-400', indicator: '●', tooltip, status };
      case 'bad':
        return { color: 'text-red-400', indicator: '●', tooltip, status };
    }
  };

  // Calculate benchmark summary counts
  const benchmarkSummary = useMemo(() => {
    if (!ratios && !keyMetrics) return { good: 0, neutral: 0, bad: 0, total: 0 };

    const checkMetric = (metricName: string, value: number | null | undefined, isPercent: boolean = false) => {
      if (value === null || value === undefined || !isFinite(value)) return 'na';

      const benchmarkData = benchmark[metricName];
      if (!benchmarkData) return 'na';

      const [low, high] = benchmarkData.range;
      const compareValue = isPercent ? value * 100 : value;
      const direction = benchmarkData.direction_better;

      if (direction === 'higher') {
        if (compareValue > high) return 'good';
        if (compareValue >= low) return 'neutral';
        return 'bad';
      } else {
        if (compareValue < low) return 'good';
        if (compareValue <= high) return 'neutral';
        return 'bad';
      }
    };

    const metricsToCheck = [
      // Valuation
      { name: 'P/E Ratio', value: ratios?.priceToEarningsRatioTTM, isPercent: false },
      { name: 'PEG Ratio', value: ratios?.priceToEarningsGrowthRatioTTM, isPercent: false },
      { name: 'P/B Ratio', value: ratios?.priceToBookRatioTTM, isPercent: false },
      { name: 'P/S Ratio', value: ratios?.priceToSalesRatioTTM, isPercent: false },
      { name: 'P/FCF Ratio', value: ratios?.priceToFreeCashFlowRatioTTM, isPercent: false },
      { name: 'EV/EBITDA', value: keyMetrics?.evToEBITDATTM, isPercent: false },
      { name: 'EV/Sales', value: keyMetrics?.evToSalesTTM, isPercent: false },
      { name: 'EV/FCF', value: keyMetrics?.evToFreeCashFlowTTM, isPercent: false },
      { name: 'Earnings Yield', value: keyMetrics?.earningsYieldTTM, isPercent: true },
      { name: 'FCF Yield', value: keyMetrics?.freeCashFlowYieldTTM, isPercent: true },
      { name: 'Dividend Yield', value: ratios?.dividendYieldTTM, isPercent: true },
      { name: 'Dividend Payout', value: ratios?.dividendPayoutRatioTTM, isPercent: true },
      // Profitability
      { name: 'Gross Margin', value: ratios?.grossProfitMarginTTM, isPercent: true },
      { name: 'Operating Margin', value: ratios?.operatingProfitMarginTTM, isPercent: true },
      { name: 'Net Margin', value: ratios?.netProfitMarginTTM, isPercent: true },
      { name: 'EBITDA Margin', value: ratios?.ebitdaMarginTTM, isPercent: true },
      { name: 'ROA', value: keyMetrics?.returnOnAssetsTTM, isPercent: true },
      { name: 'ROE', value: keyMetrics?.returnOnEquityTTM, isPercent: true },
      { name: 'ROIC', value: keyMetrics?.returnOnInvestedCapitalTTM, isPercent: true },
      { name: 'ROCE', value: keyMetrics?.returnOnCapitalEmployedTTM, isPercent: true },
      // Liquidity & Solvency
      { name: 'Current Ratio', value: ratios?.currentRatioTTM, isPercent: false },
      { name: 'Quick Ratio', value: ratios?.quickRatioTTM, isPercent: false },
      { name: 'Cash Ratio', value: ratios?.cashRatioTTM, isPercent: false },
      { name: 'Debt/Equity', value: ratios?.debtToEquityRatioTTM, isPercent: false },
      { name: 'Debt/Assets', value: ratios?.debtToAssetsRatioTTM, isPercent: true },
      { name: 'Net Debt/EBITDA', value: keyMetrics?.netDebtToEBITDATTM, isPercent: false },
      { name: 'Interest Coverage', value: ratios?.interestCoverageRatioTTM, isPercent: false },
      { name: 'Financial Leverage', value: ratios?.financialLeverageRatioTTM, isPercent: false },
      // Efficiency
      { name: 'Asset Turnover', value: ratios?.assetTurnoverTTM, isPercent: false },
      { name: 'Inventory Turnover', value: ratios?.inventoryTurnoverTTM, isPercent: false },
      { name: 'Receivables Turnover', value: ratios?.receivablesTurnoverTTM, isPercent: false },
      { name: 'Payables Turnover', value: ratios?.payablesTurnoverTTM, isPercent: false },
      { name: 'Days Sales Out', value: keyMetrics?.daysOfSalesOutstandingTTM, isPercent: false },
      { name: 'Days Inventory', value: keyMetrics?.daysOfInventoryOutstandingTTM, isPercent: false },
      { name: 'Days Payables', value: keyMetrics?.daysOfPayablesOutstandingTTM, isPercent: false },
      { name: 'Cash Conversion', value: keyMetrics?.cashConversionCycleTTM, isPercent: false },
      // Other
      { name: 'Income Quality', value: keyMetrics?.incomeQualityTTM, isPercent: false },
      { name: 'CapEx/OCF', value: keyMetrics?.capexToOperatingCashFlowTTM, isPercent: true },
      { name: 'CapEx/Revenue', value: keyMetrics?.capexToRevenueTTM, isPercent: true },
    ];

    let good = 0, neutral = 0, bad = 0;

    metricsToCheck.forEach(m => {
      const result = checkMetric(m.name, m.value, m.isPercent);
      if (result === 'good') good++;
      else if (result === 'neutral') neutral++;
      else if (result === 'bad') bad++;
    });

    return { good, neutral, bad, total: good + neutral + bad };
  }, [ratios, keyMetrics, benchmark]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="relative">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-emerald-500 border-t-transparent"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-bold text-emerald-400">📈</span>
          </div>
        </div>
        <p className="text-xl text-gray-300">{t('keyMetricsTab.loading')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500 rounded-xl p-6 text-center">
        <p className="text-xl text-red-400">❌ Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t('keyMetricsTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('keyMetricsTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          {industry && (
            <span className="px-4 py-2 bg-purple-600/30 text-purple-400 rounded-full text-sm border border-purple-500/50">
              {industry}
            </span>
          )}
          <div className="text-right bg-gradient-to-r from-emerald-900/40 to-teal-900/40 px-4 py-2 rounded-xl border border-emerald-600">
            <p className="text-xs text-emerald-400">Benchmark Score</p>
            <p className="text-xl font-bold text-emerald-400">
              {benchmarkSummary.good}/{benchmarkSummary.good + benchmarkSummary.neutral + benchmarkSummary.bad}
            </p>
          </div>
        </div>
      </div>

      {/* Industry Benchmark Summary & Legend */}
      <div className="bg-gradient-to-r from-gray-800/80 to-gray-900/80 p-6 rounded-xl border border-gray-600">
        <div className="flex flex-wrap justify-between items-start gap-6">
          {/* Summary Score */}
          <div className="flex-1 min-w-[250px]">
            <h4 className="text-lg font-semibold text-gray-200 mb-3">📊 Benchmark Summary</h4>
            <div className="flex gap-4">
              <div className="text-center bg-green-900/30 px-4 py-3 rounded-lg border border-green-600">
                <div className="text-3xl font-bold text-green-400">{benchmarkSummary.good}</div>
                <div className="text-xs text-green-300">Above Standard</div>
              </div>
              <div className="text-center bg-yellow-900/30 px-4 py-3 rounded-lg border border-yellow-600">
                <div className="text-3xl font-bold text-yellow-400">{benchmarkSummary.neutral}</div>
                <div className="text-xs text-yellow-300">Within Range</div>
              </div>
              <div className="text-center bg-red-900/30 px-4 py-3 rounded-lg border border-red-600">
                <div className="text-3xl font-bold text-red-400">{benchmarkSummary.bad}</div>
                <div className="text-xs text-red-300">Below Standard</div>
              </div>
            </div>
            <p className="text-sm text-gray-400 mt-3">
              {benchmarkSummary.total > 0 && (
                <>
                  <span className={benchmarkSummary.good >= benchmarkSummary.bad ? 'text-green-400' : 'text-red-400'}>
                    {Math.round((benchmarkSummary.good / benchmarkSummary.total) * 100)}% of metrics above standard
                  </span>
                </>
              )}
            </p>
          </div>

          {/* Legend */}
          <div className="flex-1 min-w-[200px]">
            <h4 className="text-lg font-semibold text-gray-200 mb-3">Legend</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-lg">●</span>
                <span className="text-gray-300">Better than industry range</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-yellow-400 text-lg">●</span>
                <span className="text-gray-300">Within industry range</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-red-400 text-lg">●</span>
                <span className="text-gray-300">Below industry range</span>
              </div>
            </div>
            <p className="text-gray-500 text-xs mt-3">
              Comparing against: <span className="text-blue-400">{industry && INDUSTRY_BENCHMARKS[industry] ? industry : 'Default benchmarks'}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          CompanyQuality Net - AI-Powered Quality Assessment
          ═══════════════════════════════════════════════════ */}
      {(keyMetrics || ratios) && (
        <div className="bg-gradient-to-br from-indigo-950 via-purple-950 to-gray-900 p-8 rounded-3xl border-2 border-purple-500/50 shadow-2xl">
          {qualityLoading && (
            <div className="flex items-center justify-center py-8 gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-purple-500 border-t-transparent"></div>
              <p className="text-purple-400 text-lg">Analizando calidad con IA...</p>
            </div>
          )}
          {qualityError && !qualityLoading && (
            <div className="text-center py-4">
              <p className="text-red-400 text-sm">⚠️ Error: {qualityError}</p>
              <p className="text-gray-500 text-xs mt-1">Asegúrate de que el servidor backend esté corriendo</p>
            </div>
          )}
          {!qualityLoading && !qualityError && !companyQualityNet && (
            <div className="text-center py-6">
              <p className="text-gray-400">Esperando análisis de calidad...</p>
            </div>
          )}
          {companyQualityNet && (
            <>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-3">
                    <span className="text-3xl">🧠</span> Company Score
                  </h4>
                  <p className="text-purple-300 mt-1">Análisis neuronal de calidad empresarial</p>
                </div>
                <div className="text-right">
                  <div className={`text-7xl font-black ${
                    companyQualityNet.overallScore >= 70 ? 'text-green-400' :
                    companyQualityNet.overallScore >= 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {companyQualityNet.overallScore.toFixed(0)}
                  </div>
                  <div className="text-sm text-purple-400">/ 100 Quality Score</div>
                </div>
              </div>

              {/* Quality Dimension Bars */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <QualityBar label="Profitability" score={companyQualityNet.profitability} />
                <QualityBar label="Financial Strength" score={companyQualityNet.financialStrength} />
                <QualityBar label="Efficiency" score={companyQualityNet.efficiency} />
                <QualityBar label="Growth Sustainability" score={companyQualityNet.growth} />
                <QualityBar label="Moat Strength" score={companyQualityNet.moat} />
              </div>

              {/* Risk Level & Recommendation */}
              <div className="flex items-center justify-between bg-gray-800/50 p-4 rounded-xl">
                <div className="flex items-center gap-4">
                  <span className="text-lg font-semibold text-gray-300">Nivel de Riesgo:</span>
                  <span className={`px-4 py-2 rounded-full text-sm font-bold ${
                    companyQualityNet.riskLevel === 'Low'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                      : companyQualityNet.riskLevel === 'Medium'
                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                        : 'bg-red-500/20 text-red-400 border border-red-500/50'
                  }`}>
                    {companyQualityNet.riskLevel === 'Low' ? '🟢 Bajo' :
                     companyQualityNet.riskLevel === 'Medium' ? '🟡 Medio' : '🔴 Alto'}
                  </span>
                </div>
                <div className={`px-6 py-2 rounded-xl text-lg font-bold ${
                  companyQualityNet.recommendation.includes('Excellent') || companyQualityNet.recommendation.includes('Strong')
                    ? 'bg-green-600/30 text-green-400 border border-green-500/50'
                    : companyQualityNet.recommendation.includes('Average')
                      ? 'bg-yellow-600/30 text-yellow-400 border border-yellow-500/50'
                      : 'bg-red-600/30 text-red-400 border border-red-500/50'
                }`}>
                  {companyQualityNet.recommendation}
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-4 text-center">
                Neural Ensemble analiza +40 métricas financieras para evaluar la calidad integral del negocio
              </p>
            </>
          )}
        </div>
      )}

      {/* Financial Scores */}
      {scores && (
        <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 p-6 rounded-xl border border-purple-600">
          <h4 className="text-2xl font-bold text-purple-400 mb-6">Financial Health Scores</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Altman Z-Score */}
            <div className="bg-gray-800/50 p-6 rounded-xl">
              <h5 className="text-lg font-semibold text-gray-200 mb-2">Altman Z-Score</h5>
              <p className={`text-5xl font-bold ${getScoreColor(scores.altmanZScore, 'altman')}`}>
                {scores.altmanZScore?.toFixed(2) || 'N/A'}
              </p>
              <div className="mt-4 text-sm text-gray-400">
                <p><span className="text-green-400">{'>'}2.99:</span> Safe Zone</p>
                <p><span className="text-yellow-400">1.81-2.99:</span> Grey Zone</p>
                <p><span className="text-red-400">{'<'}1.81:</span> Distress Zone</p>
              </div>
            </div>

            {/* Piotroski Score */}
            <div className="bg-gray-800/50 p-6 rounded-xl">
              <h5 className="text-lg font-semibold text-gray-200 mb-2">Piotroski F-Score</h5>
              <p className={`text-5xl font-bold ${getScoreColor(scores.piotroskiScore, 'piotroski')}`}>
                {scores.piotroskiScore || 'N/A'} <span className="text-2xl text-gray-500">/ 9</span>
              </p>
              <div className="mt-4 text-sm text-gray-400">
                <p><span className="text-green-400">7-9:</span> Strong</p>
                <p><span className="text-yellow-400">4-6:</span> Average</p>
                <p><span className="text-red-400">0-3:</span> Weak</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Valuation Ratios */}
      {ratios && (
        <div>
          <h4 className="text-xl font-bold text-gray-200 mb-4">{t('keyMetricsTab.categories.valuation')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCardWithBenchmark
              label="P/E Ratio"
              value={formatValue(ratios.priceToEarningsRatioTTM, 'ratio')}
              comparison={getBenchmarkComparison('P/E Ratio', ratios.priceToEarningsRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="PEG Ratio"
              value={formatValue(ratios.priceToEarningsGrowthRatioTTM, 'ratio')}
              comparison={getBenchmarkComparison('PEG Ratio', ratios.priceToEarningsGrowthRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="P/B Ratio"
              value={formatValue(ratios.priceToBookRatioTTM, 'ratio')}
              comparison={getBenchmarkComparison('P/B Ratio', ratios.priceToBookRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="P/S Ratio"
              value={formatValue(ratios.priceToSalesRatioTTM, 'ratio')}
              comparison={getBenchmarkComparison('P/S Ratio', ratios.priceToSalesRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="P/FCF Ratio"
              value={formatValue(ratios.priceToFreeCashFlowRatioTTM, 'ratio')}
              comparison={getBenchmarkComparison('P/FCF Ratio', ratios.priceToFreeCashFlowRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="EV/EBITDA"
              value={formatValue(keyMetrics?.evToEBITDATTM, 'ratio')}
              comparison={getBenchmarkComparison('EV/EBITDA', keyMetrics?.evToEBITDATTM)}
            />
            <MetricCardWithBenchmark
              label="EV/Sales"
              value={formatValue(keyMetrics?.evToSalesTTM, 'ratio')}
              comparison={getBenchmarkComparison('EV/Sales', keyMetrics?.evToSalesTTM)}
            />
            <MetricCardWithBenchmark
              label="EV/FCF"
              value={formatValue(keyMetrics?.evToFreeCashFlowTTM, 'ratio')}
              comparison={getBenchmarkComparison('EV/FCF', keyMetrics?.evToFreeCashFlowTTM)}
            />
            <MetricCardWithBenchmark
              label="Earnings Yield"
              value={formatValue(keyMetrics?.earningsYieldTTM, 'percent')}
              comparison={getBenchmarkComparison('Earnings Yield', keyMetrics?.earningsYieldTTM, true)}
            />
            <MetricCardWithBenchmark
              label="FCF Yield"
              value={formatValue(keyMetrics?.freeCashFlowYieldTTM, 'percent')}
              comparison={getBenchmarkComparison('FCF Yield', keyMetrics?.freeCashFlowYieldTTM, true)}
            />
            <MetricCardWithBenchmark
              label="Dividend Yield"
              value={formatValue(ratios.dividendYieldTTM, 'percent')}
              comparison={getBenchmarkComparison('Dividend Yield', ratios.dividendYieldTTM, true)}
            />
            <MetricCardWithBenchmark
              label="Dividend Payout"
              value={formatValue(ratios.dividendPayoutRatioTTM, 'percent')}
              comparison={getBenchmarkComparison('Dividend Payout', ratios.dividendPayoutRatioTTM, true)}
            />
          </div>
        </div>
      )}

      {/* Profitability Ratios */}
      {ratios && (
        <div>
          <h4 className="text-xl font-bold text-gray-200 mb-4">{t('keyMetricsTab.categories.profitability')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCardWithBenchmark
              label="Gross Margin"
              value={formatValue(ratios.grossProfitMarginTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('Gross Margin', ratios.grossProfitMarginTTM, true)}
            />
            <MetricCardWithBenchmark
              label="Operating Margin"
              value={formatValue(ratios.operatingProfitMarginTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('Operating Margin', ratios.operatingProfitMarginTTM, true)}
            />
            <MetricCardWithBenchmark
              label="Net Margin"
              value={formatValue(ratios.netProfitMarginTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('Net Margin', ratios.netProfitMarginTTM, true)}
            />
            <MetricCardWithBenchmark
              label="EBITDA Margin"
              value={formatValue(ratios.ebitdaMarginTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('EBITDA Margin', ratios.ebitdaMarginTTM, true)}
            />
            <MetricCardWithBenchmark
              label="ROA"
              value={formatValue(keyMetrics?.returnOnAssetsTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('ROA', keyMetrics?.returnOnAssetsTTM, true)}
            />
            <MetricCardWithBenchmark
              label="ROE"
              value={formatValue(keyMetrics?.returnOnEquityTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('ROE', keyMetrics?.returnOnEquityTTM, true)}
            />
            <MetricCardWithBenchmark
              label="ROIC"
              value={formatValue(keyMetrics?.returnOnInvestedCapitalTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('ROIC', keyMetrics?.returnOnInvestedCapitalTTM, true)}
            />
            <MetricCardWithBenchmark
              label="ROCE"
              value={formatValue(keyMetrics?.returnOnCapitalEmployedTTM, 'percent')}
              color="green"
              comparison={getBenchmarkComparison('ROCE', keyMetrics?.returnOnCapitalEmployedTTM, true)}
            />
          </div>
        </div>
      )}

      {/* Liquidity & Solvency */}
      {ratios && keyMetrics && (
        <div>
          <h4 className="text-xl font-bold text-gray-200 mb-4">{t('keyMetricsTab.categories.liquidity')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCardWithBenchmark
              label="Current Ratio"
              value={formatValue(ratios.currentRatioTTM, 'ratio')}
              color="blue"
              comparison={getBenchmarkComparison('Current Ratio', ratios.currentRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="Quick Ratio"
              value={formatValue(ratios.quickRatioTTM, 'ratio')}
              color="blue"
              comparison={getBenchmarkComparison('Quick Ratio', ratios.quickRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="Cash Ratio"
              value={formatValue(ratios.cashRatioTTM, 'ratio')}
              color="blue"
              comparison={getBenchmarkComparison('Cash Ratio', ratios.cashRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="Debt/Equity"
              value={formatValue(ratios.debtToEquityRatioTTM, 'ratio')}
              color="amber"
              comparison={getBenchmarkComparison('Debt/Equity', ratios.debtToEquityRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="Debt/Assets"
              value={formatValue(ratios.debtToAssetsRatioTTM, 'percent')}
              color="amber"
              comparison={getBenchmarkComparison('Debt/Assets', ratios.debtToAssetsRatioTTM, true)}
            />
            <MetricCardWithBenchmark
              label="Net Debt/EBITDA"
              value={formatValue(keyMetrics.netDebtToEBITDATTM, 'ratio')}
              color="amber"
              comparison={getBenchmarkComparison('Net Debt/EBITDA', keyMetrics.netDebtToEBITDATTM)}
            />
            <MetricCardWithBenchmark
              label="Interest Coverage"
              value={formatValue(ratios.interestCoverageRatioTTM, 'ratio')}
              color="blue"
              comparison={getBenchmarkComparison('Interest Coverage', ratios.interestCoverageRatioTTM)}
            />
            <MetricCardWithBenchmark
              label="Financial Leverage"
              value={formatValue(ratios.financialLeverageRatioTTM, 'ratio')}
              color="amber"
              comparison={getBenchmarkComparison('Financial Leverage', ratios.financialLeverageRatioTTM)}
            />
          </div>
        </div>
      )}

      {/* Efficiency */}
      {keyMetrics && ratios && (
        <div>
          <h4 className="text-xl font-bold text-gray-200 mb-4">{t('keyMetricsTab.categories.efficiency')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCardWithBenchmark
              label="Asset Turnover"
              value={formatValue(ratios.assetTurnoverTTM, 'ratio')}
              color="cyan"
              comparison={getBenchmarkComparison('Asset Turnover', ratios.assetTurnoverTTM)}
            />
            <MetricCardWithBenchmark
              label="Inventory Turnover"
              value={formatValue(ratios.inventoryTurnoverTTM, 'ratio')}
              color="cyan"
              comparison={getBenchmarkComparison('Inventory Turnover', ratios.inventoryTurnoverTTM)}
            />
            <MetricCardWithBenchmark
              label="Receivables Turnover"
              value={formatValue(ratios.receivablesTurnoverTTM, 'ratio')}
              color="cyan"
              comparison={getBenchmarkComparison('Receivables Turnover', ratios.receivablesTurnoverTTM)}
            />
            <MetricCardWithBenchmark
              label="Payables Turnover"
              value={formatValue(ratios.payablesTurnoverTTM, 'ratio')}
              color="cyan"
              comparison={getBenchmarkComparison('Payables Turnover', ratios.payablesTurnoverTTM)}
            />
            <MetricCardWithBenchmark
              label="Days Sales Out"
              value={formatValue(keyMetrics.daysOfSalesOutstandingTTM, 'days')}
              color="purple"
              comparison={getBenchmarkComparison('Days Sales Out', keyMetrics.daysOfSalesOutstandingTTM)}
            />
            <MetricCardWithBenchmark
              label="Days Inventory"
              value={formatValue(keyMetrics.daysOfInventoryOutstandingTTM, 'days')}
              color="purple"
              comparison={getBenchmarkComparison('Days Inventory', keyMetrics.daysOfInventoryOutstandingTTM)}
            />
            <MetricCardWithBenchmark
              label="Days Payables"
              value={formatValue(keyMetrics.daysOfPayablesOutstandingTTM, 'days')}
              color="purple"
              comparison={getBenchmarkComparison('Days Payables', keyMetrics.daysOfPayablesOutstandingTTM)}
            />
            <MetricCardWithBenchmark
              label="Cash Conversion"
              value={formatValue(keyMetrics.cashConversionCycleTTM, 'days')}
              color="purple"
              comparison={getBenchmarkComparison('Cash Conversion', keyMetrics.cashConversionCycleTTM)}
            />
          </div>
        </div>
      )}

      {/* Per Share Data */}
      {ratios && (
        <div>
          <h4 className="text-xl font-bold text-gray-200 mb-4">{t('keyMetricsTab.categories.perShare')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCard label="Revenue/Share" value={formatValue(ratios.revenuePerShareTTM, 'currency')} color="teal" />
            <MetricCard label="EPS" value={formatValue(ratios.netIncomePerShareTTM, 'currency')} color="teal" />
            <MetricCard label="Book Value/Share" value={formatValue(ratios.bookValuePerShareTTM, 'currency')} color="teal" />
            <MetricCard label="Cash/Share" value={formatValue(ratios.cashPerShareTTM, 'currency')} color="teal" />
            <MetricCard label="FCF/Share" value={formatValue(ratios.freeCashFlowPerShareTTM, 'currency')} color="teal" />
            <MetricCard label="OCF/Share" value={formatValue(ratios.operatingCashFlowPerShareTTM, 'currency')} color="teal" />
          </div>
        </div>
      )}

      {/* Other Metrics */}
      {keyMetrics && (
        <div>
          <h4 className="text-xl font-bold text-gray-200 mb-4">Other Key Metrics</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCard label="Market Cap" value={formatValue(keyMetrics.marketCap, 'currency')} />
            <MetricCard label="Enterprise Value" value={formatValue(keyMetrics.enterpriseValueTTM, 'currency')} />
            <MetricCard label="Invested Capital" value={formatValue(keyMetrics.investedCapitalTTM, 'currency')} />
            <MetricCard label="Working Capital" value={formatValue(keyMetrics.workingCapitalTTM, 'currency')} />
            <MetricCard label="Graham Number" value={formatValue(keyMetrics.grahamNumberTTM, 'currency')} color="emerald" />
            <MetricCardWithBenchmark
              label="Income Quality"
              value={formatValue(keyMetrics.incomeQualityTTM, 'ratio')}
              comparison={getBenchmarkComparison('Income Quality', keyMetrics.incomeQualityTTM)}
            />
            <MetricCardWithBenchmark
              label="CapEx/OCF"
              value={formatValue(keyMetrics.capexToOperatingCashFlowTTM, 'percent')}
              comparison={getBenchmarkComparison('CapEx/OCF', keyMetrics.capexToOperatingCashFlowTTM, true)}
            />
            <MetricCardWithBenchmark
              label="CapEx/Revenue"
              value={formatValue(keyMetrics.capexToRevenueTTM, 'percent')}
              comparison={getBenchmarkComparison('CapEx/Revenue', keyMetrics.capexToRevenueTTM, true)}
            />
            <MetricCard label="R&D/Revenue" value={formatValue(keyMetrics.researchAndDevelopementToRevenueTTM, 'percent')} />
            <MetricCard label="SBC/Revenue" value={formatValue(keyMetrics.stockBasedCompensationToRevenueTTM, 'percent')} />
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  color = 'gray'
}: {
  label: string;
  value: string;
  color?: 'gray' | 'green' | 'blue' | 'amber' | 'cyan' | 'purple' | 'teal' | 'emerald';
}) {
  const colorClasses = {
    gray: 'text-gray-100',
    green: 'text-green-400',
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    teal: 'text-teal-400',
    emerald: 'text-emerald-400',
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}

function MetricCardWithBenchmark({
  label,
  value,
  color = 'gray',
  comparison
}: {
  label: string;
  value: string;
  color?: 'gray' | 'green' | 'blue' | 'amber' | 'cyan' | 'purple' | 'teal' | 'emerald';
  comparison: { color: string; indicator: string; tooltip: string };
}) {
  const colorClasses = {
    gray: 'text-gray-100',
    green: 'text-green-400',
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    teal: 'text-teal-400',
    emerald: 'text-emerald-400',
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 relative group">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        {comparison.indicator && (
          <span className={`${comparison.color} text-sm`} title={comparison.tooltip}>
            {comparison.indicator}
          </span>
        )}
      </div>
      <p className={`text-xl font-bold ${colorClasses[color]}`}>{value}</p>
      {/* Tooltip on hover */}
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-gray-300 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 border border-gray-600">
        {comparison.tooltip}
      </div>
    </div>
  );
}

// Quality Bar component for CompanyQuality Net
function QualityBar({ label, score }: { label: string; score: number }) {
  const getColor = (s: number) => {
    if (s >= 80) return 'bg-green-500';
    if (s >= 60) return 'bg-emerald-500';
    if (s >= 40) return 'bg-yellow-500';
    if (s >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getTextColor = (s: number) => {
    if (s >= 80) return 'text-green-400';
    if (s >= 60) return 'text-emerald-400';
    if (s >= 40) return 'text-yellow-400';
    if (s >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  return (
    <div className="bg-gray-800/60 p-3 rounded-xl">
      <div className="text-xs text-gray-400 mb-2 truncate" title={label}>{label}</div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden mb-1">
        <div
          className={`h-full ${getColor(score)} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
      <div className={`text-right text-lg font-bold ${getTextColor(score)}`}>
        {score.toFixed(0)}
      </div>
    </div>
  );
}
