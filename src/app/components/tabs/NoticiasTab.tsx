// src/app/components/tabs/NoticiasTab.tsx
'use client';

import { useEffect, useState } from 'react';

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
  const [companyNews, setCompanyNews] = useState<NewsItem[]>([]);
  const [pressReleases, setPressReleases] = useState<PressRelease[]>([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [loadingPRs, setLoadingPRs] = useState(true);
  const [activeTab, setActiveTab] = useState<'news' | 'prs'>('news');

  // Fetch company news
  useEffect(() => {
    const fetchCompanyNews = async () => {
      if (!ticker) return;

      try {
        setLoadingNews(true);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        // Get stock-specific news
        const res = await fetch(
          `https://financialmodelingprep.com/stable/news/stock?symbol=${ticker}&page=0&limit=20&apikey=${apiKey}`
        );

        if (res.ok) {
          const data = await res.json();
          setCompanyNews(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Error fetching company news:', err);
      } finally {
        setLoadingNews(false);
      }
    };

    fetchCompanyNews();
  }, [ticker]);

  // Fetch press releases
  useEffect(() => {
    const fetchPressReleases = async () => {
      if (!ticker) return;

      try {
        setLoadingPRs(true);
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) return;

        // Get press releases for the specific stock
        const res = await fetch(
          `https://financialmodelingprep.com/stable/news/press-releases?symbol=${ticker}&page=0&limit=15&apikey=${apiKey}`
        );

        if (res.ok) {
          const data = await res.json();
          setPressReleases(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Error fetching press releases:', err);
      } finally {
        setLoadingPRs(false);
      }
    };

    fetchPressReleases();
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
      <h3 className="text-4xl font-bold text-gray-100">
        Noticias y Press Releases - {ticker}
      </h3>

      {/* Tab Selector */}
      <div className="flex gap-4 border-b border-gray-700 pb-2">
        <button
          onClick={() => setActiveTab('news')}
          className={`px-6 py-3 rounded-t-xl font-semibold text-lg transition-all ${
            activeTab === 'news'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          Noticias de la Compania ({companyNews.length})
        </button>
        <button
          onClick={() => setActiveTab('prs')}
          className={`px-6 py-3 rounded-t-xl font-semibold text-lg transition-all ${
            activeTab === 'prs'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
          }`}
        >
          Press Releases ({pressReleases.length})
        </button>
      </div>

      {/* Company News Tab */}
      {activeTab === 'news' && (
        <div className="space-y-6">
          {loadingNews ? (
            <div className="text-center py-16">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
              <p className="mt-4 text-gray-400 text-lg">Cargando noticias...</p>
            </div>
          ) : companyNews.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-2xl">No hay noticias disponibles para {ticker}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {companyNews.map((news, idx) => (
                <a
                  key={idx}
                  href={news.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-gray-700 rounded-xl border border-gray-600 hover:border-blue-500 transition-all hover:shadow-lg hover:shadow-blue-500/10 overflow-hidden group"
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
                        <span className="px-2 py-0.5 bg-blue-600/30 text-blue-400 text-xs rounded-full font-medium">
                          {news.symbol || ticker}
                        </span>
                        {news.site && (
                          <span className="text-xs text-gray-500">{news.site}</span>
                        )}
                      </div>
                      <h4 className="text-lg font-semibold text-gray-100 group-hover:text-blue-400 transition-colors line-clamp-2 mb-2">
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
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-500 border-t-transparent"></div>
              <p className="mt-4 text-gray-400 text-lg">Cargando press releases...</p>
            </div>
          ) : pressReleases.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-2xl">No hay press releases disponibles para {ticker}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pressReleases.map((pr, idx) => (
                <div
                  key={idx}
                  className="bg-gray-700 rounded-xl border border-gray-600 p-6 hover:border-purple-500 transition-all"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="px-3 py-1 bg-purple-600/30 text-purple-400 text-sm rounded-full font-medium">
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
        <h4 className="text-lg font-semibold text-gray-200 mb-4">Resumen de Cobertura</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-blue-400">{companyNews.length}</p>
            <p className="text-sm text-gray-400">Noticias Recientes</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-purple-400">{pressReleases.length}</p>
            <p className="text-sm text-gray-400">Press Releases</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-green-400">
              {companyNews.length > 0
                ? new Set(companyNews.map((n) => n.site).filter(Boolean)).size
                : 0}
            </p>
            <p className="text-sm text-gray-400">Fuentes</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">
              {companyNews.length > 0 || pressReleases.length > 0
                ? formatDate(
                    companyNews[0]?.publishedDate || pressReleases[0]?.date || new Date().toISOString()
                  ).split(',')[0]
                : 'N/A'}
            </p>
            <p className="text-sm text-gray-400">Ultima Actualizacion</p>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-gray-500">
        Las noticias y press releases se actualizan en tiempo real desde multiples fuentes financieras.
      </p>
    </div>
  );
}
