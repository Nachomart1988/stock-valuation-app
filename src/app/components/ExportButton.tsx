'use client';

import { useState } from 'react';

interface ExportButtonProps {
  onExportPDF: () => Promise<void>;
  onExportExcel?: () => Promise<void>;
  disabled?: boolean;
}

export default function ExportButton({ onExportPDF, onExportExcel, disabled = false }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  const handleExport = async (type: 'pdf' | 'excel') => {
    setExporting(type);
    try {
      if (type === 'pdf') {
        await onExportPDF();
      } else if (onExportExcel) {
        await onExportExcel();
      }
    } catch (error) {
      console.error(`Error exporting ${type}:`, error);
      alert(`Error al exportar ${type.toUpperCase()}`);
    } finally {
      setExporting(null);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Exportar
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-white/[0.06] rounded-xl shadow-xl z-20 overflow-hidden">
            <button
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 transition text-left"
            >
              {exporting === 'pdf' ? (
                <div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
              )}
              <div>
                <p className="font-medium text-white">Exportar PDF</p>
                <p className="text-xs text-gray-400">Reporte completo</p>
              </div>
            </button>

            {onExportExcel && (
              <button
                onClick={() => handleExport('excel')}
                disabled={exporting !== null}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 transition text-left border-t border-white/[0.06]"
              >
                {exporting === 'excel' ? (
                  <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                )}
                <div>
                  <p className="font-medium text-white">Exportar Excel</p>
                  <p className="text-xs text-gray-400">Datos en hojas</p>
                </div>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
