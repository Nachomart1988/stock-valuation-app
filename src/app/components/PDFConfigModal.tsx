'use client';

import { useState, useRef } from 'react';

export interface PDFBranding {
  bgColor: [number, number, number];
  accentColor: [number, number, number];
  fontFamily: string;
  logoBase64?: string;
}

export interface PDFConfig {
  sections: string[];
  branding: PDFBranding;
}

const ALL_SECTIONS = [
  { key: 'cover',      label: 'Portada' },
  { key: 'financial',  label: 'Highlights Financieros' },
  { key: 'valuation',  label: 'Valuación' },
  { key: 'forecasts',  label: 'Forecasts de Analistas' },
  { key: 'technical',  label: 'Análisis Técnico' },
  { key: 'disclaimer', label: 'Disclaimer' },
];

const FONTS = ['helvetica', 'times', 'courier'] as const;

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: PDFConfig) => void;
  generating: boolean;
}

export default function PDFConfigModal({ isOpen, onClose, onGenerate, generating }: Props) {
  const [selectedSections, setSelectedSections] = useState<Set<string>>(
    new Set(ALL_SECTIONS.map((s) => s.key))
  );
  const [bgHex, setBgHex] = useState('#000000');
  const [accentHex, setAccentHex] = useState('#00A651');
  const [font, setFont] = useState<string>('helvetica');
  const [logoBase64, setLogoBase64] = useState<string | undefined>(undefined);
  const [logoName, setLogoName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const toggleSection = (key: string) => {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoBase64(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = () => {
    onGenerate({
      sections: ALL_SECTIONS.map((s) => s.key).filter((k) => selectedSections.has(k)),
      branding: {
        bgColor: hexToRgb(bgHex),
        accentColor: hexToRgb(accentHex),
        fontFamily: font,
        logoBase64,
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h2 className="text-lg font-bold text-white">Configurar PDF</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 grid sm:grid-cols-2 gap-6">
          {/* Left: Section selector */}
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">Secciones a incluir</h3>
            <div className="space-y-2">
              {ALL_SECTIONS.map((s) => (
                <label key={s.key} className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition group">
                  <input
                    type="checkbox"
                    checked={selectedSections.has(s.key)}
                    onChange={() => toggleSection(s.key)}
                    className="w-4 h-4 rounded accent-emerald-500"
                  />
                  <span className={`text-sm transition ${selectedSections.has(s.key) ? 'text-white' : 'text-gray-500'}`}>
                    {s.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Right: Branding */}
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Personalización</h3>

            {/* Background color */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Color de fondo</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={bgHex}
                  onChange={(e) => setBgHex(e.target.value)}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-600 bg-transparent"
                />
                <span className="text-sm text-gray-300 font-mono">{bgHex.toUpperCase()}</span>
              </div>
            </div>

            {/* Accent color */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Color de acento</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentHex}
                  onChange={(e) => setAccentHex(e.target.value)}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-600 bg-transparent"
                />
                <span className="text-sm text-gray-300 font-mono">{accentHex.toUpperCase()}</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: accentHex }} />
              </div>
            </div>

            {/* Font */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Tipografía</label>
              <div className="flex gap-2">
                {FONTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFont(f)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition capitalize ${
                      font === f
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Logo upload */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Logo (opcional)</label>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition border border-gray-700 w-full"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="truncate">{logoName || 'Subir imagen...'}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              {logoBase64 && (
                <div className="flex items-center gap-2 mt-2">
                  <img src={logoBase64} alt="logo preview" className="h-8 rounded object-contain bg-gray-800 p-1" />
                  <button
                    onClick={() => { setLogoBase64(undefined); setLogoName(''); }}
                    className="text-xs text-gray-500 hover:text-red-400 transition"
                  >
                    Quitar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-900/50">
          <p className="text-xs text-gray-500">
            {selectedSections.size} sección{selectedSections.size !== 1 ? 'es' : ''} seleccionada{selectedSections.size !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-bold transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generando...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Generar PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
