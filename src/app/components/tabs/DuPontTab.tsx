'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';

interface DuPontTabProps {
  income: any[];
  balance: any[];
  ticker: string;
}

interface CompanyNote {
  symbol: string;
  title: string;
  exchange: string;
  cik: string;
}

function getArrow(current: string, previous: string) {
  const curr = parseFloat(current);
  const prev = parseFloat(previous);
  if (curr > prev) return <span className="text-green-400 ml-2">▲</span>;
  if (curr < prev) return <span className="text-red-400 ml-2">▼</span>;
  return <span className="text-gray-400 ml-2">―</span>;
}

export default function DuPontTab({ income, balance, ticker }: DuPontTabProps) {
  const { t } = useLanguage();
  const [notes, setNotes] = useState<CompanyNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNotes = async () => {
      if (!ticker) return;
      setNotesLoading(true);
      setNotesError(null);

      try {
        const apiKey = process.env.NEXT_PUBLIC_FMP_API_KEY;
        if (!apiKey) {
          setNotesError(t('dupontTab.apiKeyError'));
          return;
        }

        const res = await fetch(
          `https://financialmodelingprep.com/stable/company-notes?symbol=${ticker}&apikey=${apiKey}`
        );

        if (!res.ok) {
          throw new Error(`Error ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        console.log('[DuPontTab] Company Notes data:', data);

        if (Array.isArray(data)) {
          setNotes(data);
        } else {
          setNotes([]);
        }
      } catch (err) {
        console.error('[DuPontTab] Error fetching notes:', err);
        setNotesError(err instanceof Error ? err.message : t('dupontTab.loadingNotes'));
      } finally {
        setNotesLoading(false);
      }
    };

    fetchNotes();
  }, [ticker]);

  if (income.length < 2 || balance.length < 2) {
    return <p className="text-2xl text-gray-400 text-center py-10">{t('dupontTab.insufficientData')}</p>;
  }

  const rows = income.map((inc, i) => {
    const bal = balance[i] || {};
    const netIncome = inc.netIncome || 0;
    const revenue = inc.revenue || 1;
    const assets = bal.totalAssets || 1;
    const equity = bal.totalStockholdersEquity || 1;

    const margin = (netIncome / revenue) * 100;
    const turnover = revenue / assets;
    const multiplier = assets / equity;
    const roe = margin * turnover * multiplier;

    return {
      date: inc.date,
      roe: roe.toFixed(2),
      margin: margin.toFixed(2),
      turnover: turnover.toFixed(2),
      multiplier: multiplier.toFixed(2),
    };
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-gray-700">
        <div>
          <h3 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {t('dupontTab.title')}
          </h3>
          <p className="text-sm text-gray-400 mt-1">{t('dupontTab.subtitle')} {ticker}</p>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-4">
            <div className="text-right bg-gradient-to-r from-green-900/40 to-emerald-900/40 px-4 py-2 rounded-xl border border-green-600">
              <p className="text-xs text-green-400">{t('dupontTab.currentRoe')}</p>
              <p className="text-xl font-bold text-green-400">{rows[0]?.roe || '—'}</p>
            </div>
          </div>
        )}
      </div>

      {/* DuPont Analysis Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-700 rounded-xl overflow-hidden shadow-lg">
          <thead className="bg-gray-800">
            <tr>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.date')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.roe')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.netMargin')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.assetTurnover')}</th>
              <th className="px-8 py-5 text-left text-gray-200 font-bold text-lg">{t('dupontTab.equityMultiplier')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-700 transition">
                <td className="px-8 py-5 text-gray-300 text-lg">{row.date}</td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.roe} {i < rows.length - 1 && getArrow(row.roe, rows[i + 1].roe)}
                </td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.margin} {i < rows.length - 1 && getArrow(row.margin, rows[i + 1].margin)}
                </td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.turnover} {i < rows.length - 1 && getArrow(row.turnover, rows[i + 1].turnover)}
                </td>
                <td className="px-8 py-5 text-gray-300 text-lg">
                  {row.multiplier} {i < rows.length - 1 && getArrow(row.multiplier, rows[i + 1].multiplier)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Company Notes/Bonds Section */}
      <div className="bg-gray-800/50 rounded-xl p-8 border border-gray-700">
        <h3 className="text-2xl font-bold text-gray-100 mb-6 flex items-center gap-3">
          <span className="text-yellow-400">📜</span>
          {t('dupontTab.companyNotes')}
        </h3>

        {notesLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-400"></div>
            <span className="ml-4 text-gray-400 text-lg">{t('dupontTab.loadingNotes')}</span>
          </div>
        ) : notesError ? (
          <div className="text-center py-10">
            <p className="text-red-400 text-lg">{notesError}</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-gray-400 text-lg">{t('dupontTab.noNotes')} {ticker}</p>
            <p className="text-gray-500 text-sm mt-2">
              {t('dupontTab.noNotesExplanation')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-600 rounded-lg overflow-hidden">
              <thead className="bg-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left text-gray-200 font-bold">{t('dupontTab.bondTitle')}</th>
                  <th className="px-6 py-4 text-left text-gray-200 font-bold">{t('dupontTab.exchange')}</th>
                  <th className="px-6 py-4 text-left text-gray-200 font-bold">{t('dupontTab.cik')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-600">
                {notes.map((note, i) => (
                  <tr key={i} className="hover:bg-gray-700/50 transition">
                    <td className="px-6 py-4 text-gray-300">
                      <span className="font-medium">{note.title || 'N/A'}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {note.exchange || 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-gray-400 font-mono text-sm">
                      {note.cik || 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-gray-500 text-sm mt-4 text-right">
              {t('dupontTab.totalNotes')}: {notes.length} {t('dupontTab.notesBonds')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
