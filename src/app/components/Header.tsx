// src/app/components/Header.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTheme } from './ThemeProvider';
import LanguageSelector from './LanguageSelector';
import Logo from './Logo';
import { SignedIn, SignedOut, UserButton } from '@clerk/nextjs';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [themeBounce, setThemeBounce] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

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

  // Scroll detection for header bg
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinkClass = (active?: boolean) =>
    `text-[13px] font-medium transition-colors duration-200 ${
      active
        ? 'text-white'
        : 'text-gray-500 hover:text-gray-200'
    }`;

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
      scrolled
        ? 'bg-[#060608]/95 backdrop-blur-2xl border-b border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.5)]'
        : 'bg-transparent border-b border-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="shrink-0">
            <Logo size="md" />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-7">
            {isLanding ? (
              <>
                <a href="#features" className={navLinkClass()}>{t('nav.features')}</a>
                <a href="#market" className={navLinkClass()}>{t('nav.market')}</a>
                <a href="#pricing" className={navLinkClass()}>{t('nav.pricing')}</a>
                <a href="#about" className={navLinkClass()}>{t('nav.about')}</a>
                <Link href="/screener" className={navLinkClass()}>Screener</Link>
                <Link href="/diario" className={navLinkClass()}>Diario</Link>
              </>
            ) : (
              <>
                <Link href="/" className={navLinkClass()}>{t('nav.home')}</Link>
                <Link href="/analizar" className={navLinkClass(isAnalizar)}>
                  {t('common.analyze')}
                </Link>
                <Link href="/market-sentiment" className={navLinkClass(pathname === '/market-sentiment')}>{t('nav.market')}</Link>
                <Link href="/screener" className={navLinkClass(pathname === '/screener')}>Screener</Link>
                <Link href="/diario" className={navLinkClass(pathname === '/diario')}>Diario</Link>
                <Link href="/pricing" className={navLinkClass(pathname === '/pricing')}>{t('nav.pricing')}</Link>
              </>
            )}
          </div>

          {/* Right side: Clock + Auth + Language */}
          <div className="hidden md:flex items-center gap-3">
            <span className="text-[11px] tabular-nums text-gray-600 font-mono tracking-wide">
              {currentTime}
            </span>

            <div className="w-px h-4 bg-white/[0.08]" />

            <LanguageSelector />

            {/* Theme toggle */}
            <button
              onClick={() => {
                setThemeBounce(true);
                toggleTheme();
                setTimeout(() => setThemeBounce(false), 400);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] transition-all"
              aria-label="Toggle theme"
              style={{
                transform: themeBounce ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <svg
                className="w-[15px] h-[15px] text-amber-400/80 absolute transition-all duration-300"
                style={{
                  opacity: theme === 'dark' ? 1 : 0,
                  transform: theme === 'dark' ? 'rotate(0deg) scale(1)' : 'rotate(90deg) scale(0.5)',
                }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <svg
                className="w-[14px] h-[14px] text-indigo-400 absolute transition-all duration-300"
                style={{
                  opacity: theme === 'light' ? 1 : 0,
                  transform: theme === 'light' ? 'rotate(0deg) scale(1)' : 'rotate(-90deg) scale(0.5)',
                }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </button>

            <div className="w-px h-4 bg-white/[0.08]" />

            <SignedOut>
              <Link
                href="/login"
                className="text-[13px] text-gray-400 hover:text-white transition-colors font-medium"
              >
                {t('nav.login')}
              </Link>
              <Link
                href="/register"
                className="text-[13px] px-4 py-1.5 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-all"
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
            <span className="text-[11px] tabular-nums text-gray-600 font-mono">
              {currentTime}
            </span>
            <button
              className="p-2 rounded-lg hover:bg-white/[0.04] transition"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-white/[0.06]">
            <div className="flex flex-col gap-3">
              {isLanding ? (
                <>
                  <a href="#features" className={navLinkClass()}>{t('nav.features')}</a>
                  <a href="#market" className={navLinkClass()}>{t('nav.market')}</a>
                  <a href="#pricing" className={navLinkClass()}>{t('nav.pricing')}</a>
                  <a href="#about" className={navLinkClass()}>{t('nav.about')}</a>
                  <Link href="/screener" className={navLinkClass()}>Screener</Link>
                  <Link href="/diario" className={navLinkClass()}>Diario</Link>
                </>
              ) : (
                <>
                  <Link href="/" className={navLinkClass()}>{t('nav.home')}</Link>
                  <Link href="/analizar" className={navLinkClass(isAnalizar)}>{t('common.analyze')}</Link>
                  <Link href="/market-sentiment" className={navLinkClass(pathname === '/market-sentiment')}>{t('nav.market')}</Link>
                  <Link href="/screener" className={navLinkClass(pathname === '/screener')}>Screener</Link>
                  <Link href="/diario" className={navLinkClass(pathname === '/diario')}>Diario</Link>
                  <Link href="/pricing" className={navLinkClass(pathname === '/pricing')}>{t('nav.pricing')}</Link>
                </>
              )}
              <hr className="border-white/[0.06]" />
              <div className="flex items-center gap-3">
                <LanguageSelector />
                <button
                  onClick={() => {
                    setThemeBounce(true);
                    toggleTheme();
                    setTimeout(() => setThemeBounce(false), 400);
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] transition-all relative"
                  aria-label="Toggle theme"
                >
                  <svg className="w-[15px] h-[15px] text-amber-400/80 absolute transition-all duration-300"
                    style={{ opacity: theme === 'dark' ? 1 : 0, transform: theme === 'dark' ? 'rotate(0) scale(1)' : 'rotate(90deg) scale(0.5)' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <svg className="w-[14px] h-[14px] text-indigo-400 absolute transition-all duration-300"
                    style={{ opacity: theme === 'light' ? 1 : 0, transform: theme === 'light' ? 'rotate(0) scale(1)' : 'rotate(-90deg) scale(0.5)' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                </button>
              </div>
              <SignedOut>
                <Link href="/login" className="text-gray-400 hover:text-white transition text-[13px]">
                  {t('nav.login')}
                </Link>
                <Link
                  href="/register"
                  className="w-full px-5 py-2 bg-white text-black rounded-lg font-semibold text-center text-[13px]"
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
