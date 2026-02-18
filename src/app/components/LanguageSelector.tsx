'use client';

import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Locale } from '@/i18n';

export default function LanguageSelector() {
  const { locale, setLocale, localeNames, localeFlags } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (newLocale: Locale) => {
    setLocale(newLocale);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition border border-white/[0.06]"
      >
        <span className="text-lg">{localeFlags[locale]}</span>
        <span className="text-sm text-gray-300">{locale.toUpperCase()}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-40 bg-gray-800 border border-white/[0.06] rounded-xl shadow-xl z-20 overflow-hidden">
            {(Object.keys(localeNames) as Locale[]).map((loc) => (
              <button
                key={loc}
                onClick={() => handleSelect(loc)}
                className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 transition text-left ${
                  locale === loc ? 'bg-gray-700/50' : ''
                }`}
              >
                <span className="text-lg">{localeFlags[loc]}</span>
                <span className="text-gray-200">{localeNames[loc]}</span>
                {locale === loc && (
                  <svg className="w-4 h-4 text-green-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
