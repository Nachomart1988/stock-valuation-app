// src/app/components/Header.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/i18n/LanguageContext';
import LanguageSelector from './LanguageSelector';
import Logo from './Logo';
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const pathname = usePathname();
  const { t } = useLanguage();

  const isLanding = pathname === '/';
  const isAnalizar = pathname === '/analizar';

  // Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-green-900/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/">
            <Logo size="md" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            {isLanding ? (
              <>
                <a href="#features" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.features')}</a>
                <a href="#market" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.market')}</a>
                <a href="#pricing" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.pricing')}</a>
                <a href="#about" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.about')}</a>
                <Link href="/screener" className="text-gray-400 hover:text-green-400/80 transition text-sm">Screener</Link>
                <Link href="/diario" className="text-gray-400 hover:text-green-400/80 transition text-sm">Diario</Link>
              </>
            ) : (
              <>
                <Link href="/" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.home')}</Link>
                <Link href="/analizar" className={`text-sm transition ${isAnalizar ? 'text-green-400 font-semibold' : 'text-gray-300 hover:text-white'}`}>
                  {t('common.analyze')}
                </Link>
                <Link href="/market-sentiment" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.market')}</Link>
                <Link href="/screener" className="text-gray-400 hover:text-green-400/80 transition text-sm">Screener</Link>
                <Link href="/diario" className="text-gray-400 hover:text-green-400/80 transition text-sm">Diario</Link>
                <Link href="/pricing" className="text-gray-400 hover:text-green-400/80 transition text-sm">{t('nav.pricing')}</Link>
              </>
            )}
          </div>

          {/* Clock + Auth + Language */}
          <div className="hidden md:flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs text-green-400/70 font-data tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-600/50">&gt;_</span>
              <span className="tabular-nums">{currentTime}</span>
            </span>

            <LanguageSelector />

            <SignedOut>
              <Link
                href="/login"
                className="px-4 py-2 text-gray-400 hover:text-green-400/80 transition text-sm"
              >
                {t('nav.login')}
              </Link>
              <Link
                href="/register"
                className="px-4 py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition text-sm"
              >
                {t('nav.register')}
              </Link>
            </SignedOut>
            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-green-400/70 font-data tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="tabular-nums">{currentTime}</span>
            </span>
            <button
              className="p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-green-900/30">
            <div className="flex flex-col gap-4">
              {isLanding ? (
                <>
                  <a href="#features" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.features')}</a>
                  <a href="#market" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.market')}</a>
                  <a href="#pricing" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.pricing')}</a>
                  <a href="#about" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.about')}</a>
                  <Link href="/screener" className="text-gray-400 hover:text-green-400/80 transition">Screener</Link>
                  <Link href="/diario" className="text-gray-400 hover:text-green-400/80 transition">Diario</Link>
                </>
              ) : (
                <>
                  <Link href="/" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.home')}</Link>
                  <Link href="/analizar" className="text-gray-400 hover:text-green-400/80 transition">{t('common.analyze')}</Link>
                  <Link href="/market-sentiment" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.market')}</Link>
                  <Link href="/screener" className="text-gray-400 hover:text-green-400/80 transition">Screener</Link>
                  <Link href="/diario" className="text-gray-400 hover:text-green-400/80 transition">Diario</Link>
                  <Link href="/pricing" className="text-gray-400 hover:text-green-400/80 transition">{t('nav.pricing')}</Link>
                </>
              )}
              <hr className="border-green-900/20" />
              <LanguageSelector />
              <SignedOut>
                <Link href="/login" className="text-gray-400 hover:text-green-400/80 transition text-left">
                  {t('nav.login')}
                </Link>
                <Link
                  href="/register"
                  className="w-full px-5 py-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg font-semibold text-center block"
                >
                  {t('nav.register')}
                </Link>
              </SignedOut>
              <SignedIn>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
