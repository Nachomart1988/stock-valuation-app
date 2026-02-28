'use client';

import { useState } from 'react';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/nextjs';
import Header from '@/app/components/Header';
import DiarioInversorTab from '@/app/components/tabs/DiarioInversorTab';
import PortfolioOptimizerTab from '@/app/components/tabs/PortfolioOptimizerTab';
import { useLanguage } from '@/i18n/LanguageContext';

export default function DiarioPage() {
  const [activeTab, setActiveTab] = useState<'diario' | 'portfolio'>('diario');
  const { locale } = useLanguage();
  const es = locale === 'es';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />
      <SignedOut>
        <RedirectToSignIn redirectUrl="/diario" />
      </SignedOut>
      <SignedIn>
        <div className="pt-16">
          {/* Tab switcher */}
          <div className="flex gap-2 px-4 pt-4 border-b border-gray-800">
            <button
              onClick={() => setActiveTab('diario')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === 'diario'
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {es ? '📓 Diario del Inversor' : '📓 Investor Journal'}
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === 'portfolio'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {es ? '📊 Optimizador de Portfolio' : '📊 Portfolio Optimizer'}
            </button>
          </div>

          {/* Tab content */}
          <div className={activeTab === 'diario' ? '' : 'hidden'}>
            <DiarioInversorTab />
          </div>
          <div className={activeTab === 'portfolio' ? '' : 'hidden'}>
            <PortfolioOptimizerTab />
          </div>
        </div>
      </SignedIn>
    </div>
  );
}
