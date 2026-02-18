// src/app/components/tabs/NoticiasTab.tsx
'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface NoticiasTabProps {
  ticker: string;
}

interface NewsItem {
  symbol?: string;
  publishedDate: string;
  title: string;
  image?: string;
  site?: string;
  text?: string;
  url: string;
}

interface PressRelease {
  symbol: string;
  date: string;
  title: string;
  text: string;
}

export default function NoticiasTab({ ticker }: NoticiasTabProps) {
  const { t } = useLanguage();
  const [companyNews, setCompanyNews] = useState<NewsItem[]>([]);
  const [pressReleases, setPressReleases] = useState<PressRelease[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [loadingPRs, setLoadingPRs] = useState(true);
  const [activeTab, setActiveTab] = useState<'news' | 'prs'>('news');

  // Fetch company news - re-fetch when ticker changes
  useEffect(() => {
    let isMounted = true;

    const fetchCompanyNews = async () => {
      if (!ticker) {
        console.log('[NoticiasTab] No ticker provided');
        setLoadingNews(false);
        return;
      }

      console.log('[NoticiasTab] Fetching news for ticker:', ticker);

      try {
        setLoadingNews(true);
        setCompanyNews([]); // Clear old data immediately

        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) {
          console.error('[NoticiasTab] No API key found');
          setLoadingNews(false);
          return;
        }

        const url = `https://financialmodelingprep.com/stable/news/stock?symbols=${ticker}&limit=20&apikey=${apiKey}`;
        console.log('[NoticiasTab] Fetching URL:', url.replace(apiKey, 'API_KEY'));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const res = await fetch(url, { signal: controller.signal });

        clearTimeout(timeoutId);

        if (!isMounted) return;

        if (res.ok) {
          const data = await res.json();
          console.log('[NoticiasTab] News response for', ticker, ':', data?.length || 0, 'items');
          if (Array.isArray(data)) {
            setCompanyNews(data);
          } else {
            setCompanyNews([]);
          }
        } else {
          setCompanyNews([]);
        }
      } catch (err: any) {
        // Only log if not aborted and component is still mounted
        if (err?.name !== 'AbortError' && isMounted) {
          console.warn('[NoticiasTab] Error fetching company news (non-critical):', err?.message || 'Unknown error');
        }
        if (isMounted) setCompanyNews([]);
      } finally {
        if (isMounted) setLoadingNews(false);
      }
    };

    fetchCompanyNews();

    return () => { isMounted = false; };
  }, [ticker]);

  // Fetch press releases - re-fetch when ticker changes
  useEffect(() => {
    let isMounted = true;

    const fetchPressReleases = async () => {
      if (!ticker) return;

      console.log('[NoticiasTab] Fetching press releases for ticker:', ticker);

      try {
        setLoadingPRs(true);
        setPressReleases([]); // Clear old data immediately

        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        const url = `https://financialmodelingprep.com/stable/news/press-releases?symbol=${ticker}&limit=15&apikey=${apiKey}`;
        console.log('[NoticiasTab] Fetching PR URL:', url.replace(apiKey, 'API_KEY'));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const res = await fetch(url, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok && isMounted) {
          const data = await res.json();
          console.log('[NoticiasTab] PR response for', ticker, ':', data?.length || 0, 'items');
          setPressReleases(Array.isArray(data) ? data : []);
        }
      } catch (err: any) {
        // Only log if not aborted and component is still mounted
        if (err?.name !== 'AbortError' && isMounted) {
          console.warn('[NoticiasTab] Error fetching press releases (non-critical):', err?.message || 'Unknown error');
        }
      } finally {
        if (isMounted) setLoadingPRs(false);
      }
    };

    fetchPressReleases();

    return () => { isMounted = false; };
  }, [ticker]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateText = (text: string, maxLength: number = 200) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {t('noticiasTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('noticiasTab.subtitle')} {ticker}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right bg-gradient-to-r from-green-900/40 to-emerald-900/40 px-4 py-2 rounded-xl border border-green-600">
            <p className="text-xs text-green-400">{t('noticiasTab.total')}</p>
            <p className="text-xl font-bold text-green-400">{companyNews.length + pressReleases.length}</p>
          </div>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex gap-4 border-b border-gray-700 pb-2">
        <button
          onClick={() => setActiveTab('news')}
          className={`px-6 py-3 rounded-t-xl font-semibold text-lg transition-all ${
            activeTab === 'news'
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          {t('noticiasTab.companyNews')} ({companyNews.length})
        </button>
        <button
          onClick={() => setActiveTab('prs')}
          className={`px-6 py-3 rounded-t-xl font-semibold text-lg transition-all ${
            activeTab === 'prs'
              ? 'bg-emerald-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          {t('noticiasTab.pressReleases')} ({pressReleases.length})
        </button>
      </div>

      {/* Company News Tab */}
      {activeTab === 'news' && (
        <div className="space-y-6">
          {loadingNews ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent"></div>
              <p className="mt-4 text-gray-400 text-lg">{t('noticiasTab.loading')}</p>
            </div>
          ) : companyNews.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-2xl">{t('noticiasTab.noNews')} {ticker}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {companyNews.map((news, idx) => (
                <a
                  key={idx}
                  href={news.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-gray-700 rounded-xl border border-gray-600 hover:border-green-500 transition-all hover:shadow-lg hover:shadow-green-500/10 overflow-hidden group"
                >
                  <div className="flex">
                    {news.image && (
                      <div className="w-32 h-32 flex-shrink-0 overflow-hidden">
                        <img
                          src={news.image}
                          alt={news.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <div className="p-4 flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-green-600/30 text-green-400 text-xs rounded-full font-medium">
                          {news.symbol || ticker}
                        </span>
                        {news.site && (
                          <span className="text-xs text-gray-500">{news.site}</span>
                        )}
                      </div>
                      <h4 className="text-lg font-semibold text-gray-100 group-hover:text-green-400 transition-colors line-clamp-2 mb-2">
                        {news.title}
                      </h4>
                      {news.text && (
                        <p className="text-sm text-gray-400 line-clamp-2">
                          {truncateText(news.text, 120)}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">
                        {formatDate(news.publishedDate)}
                      </p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Press Releases Tab */}
      {activeTab === 'prs' && (
        <div className="space-y-6">
          {loadingPRs ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent"></div>
              <p className="mt-4 text-gray-400 text-lg">{t('noticiasTab.loadingPressReleases')}</p>
            </div>
          ) : pressReleases.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-2xl">{t('noticiasTab.noPressReleases')} {ticker}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pressReleases.map((pr, idx) => (
                <div
                  key={idx}
                  className="bg-gray-700 rounded-xl border border-gray-600 p-6 hover:border-emerald-500 transition-all"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 bg-emerald-600/30 text-emerald-400 text-sm rounded-full font-medium">
                      {pr.symbol}
                    </span>
                    <span className="text-sm text-gray-500">
                      {formatDate(pr.date)}
                    </span>
                  </div>
                  <h4 className="text-xl font-semibold text-gray-100 mb-3">
                    {pr.title}
                  </h4>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {truncateText(pr.text, 500)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Summary Stats */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h4 className="text-lg font-semibold text-gray-200 mb-4">{t('noticiasTab.coverageSummary')}</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-green-400">{companyNews.length}</p>
            <p className="text-sm text-gray-400">{t('noticiasTab.recentNews')}</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-emerald-400">{pressReleases.length}</p>
            <p className="text-sm text-gray-400">{t('noticiasTab.pressReleases')}</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-green-400">
              {companyNews.length > 0
                ? new Set(companyNews.map((n) => n.site).filter(Boolean)).size
                : 0}
            </p>
            <p className="text-sm text-gray-400">{t('noticiasTab.sources')}</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">
              {companyNews.length > 0 || pressReleases.length > 0
                ? formatDate(
                    companyNews[0]?.publishedDate || pressReleases[0]?.date || new Date().toISOString()
                  ).split(',')[0]
                : 'N/A'}
            </p>
            <p className="text-sm text-gray-400">{t('noticiasTab.lastUpdate')}</p>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        {t('noticiasTab.footer')}
      </p>
    </div>
  );
}
