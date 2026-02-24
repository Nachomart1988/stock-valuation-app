'use client';

import { useState, useRef, useEffect } from 'react';

export interface PDFBranding {
  bgColor: [number, number, number];
  accentColor: [number, number, number];
  fontFamily: string;
  logoBase64?: string;
  customDisclaimer?: string;
}

export interface PDFConfig {
  sections: string[];
  branding: PDFBranding;
  preview?: boolean;
}

// ── Every sub-tab from the app, grouped by category ─────────────────────
interface SectionItem { key: string; label: string }
interface SectionGroup { label: string; color: string; sections: SectionItem[] }

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: 'Portada & Disclaimer',
    color: 'text-emerald-400',
    sections: [
      { key: 'cover',            label: 'Portada' },
      { key: 'disclaimer',       label: 'Disclaimer' },
    ],
  },
  {
    label: 'Resumen de Mercado',
    color: 'text-emerald-400',
    sections: [
      { key: 'market_summary',   label: 'Market Summary (precios, pills)' },
    ],
  },
  {
    label: 'Estados Financieros',
    color: 'text-blue-400',
    sections: [
      { key: 'income_statement', label: 'Estado de Resultados' },
      { key: 'balance_sheet',    label: 'Balance General' },
      { key: 'cash_flow',        label: 'Flujo de Caja' },
    ],
  },
  {
    label: 'Info General',
    color: 'text-cyan-400',
    sections: [
      { key: 'key_metrics',      label: 'Key Metrics' },
      { key: 'dupont',           label: 'DuPont Analysis' },
      { key: 'quality_score',    label: 'Company Quality Score' },
    ],
  },
  {
    label: 'Inputs & Fundamentals',
    color: 'text-teal-400',
    sections: [
      { key: 'wacc_cagr',        label: 'WACC & CAGR' },
      { key: 'sgr',              label: 'Sustainable Growth Rate' },
    ],
  },
  {
    label: 'Valuación',
    color: 'text-yellow-400',
    sections: [
      { key: 'valuation_models', label: 'Modelos de Valuación' },
    ],
  },
  {
    label: 'Forecasts',
    color: 'text-orange-400',
    sections: [
      { key: 'analyst_forecasts', label: 'Forecasts de Analistas' },
      { key: 'price_target',      label: 'Price Target' },
      { key: 'ttm_snapshot',      label: 'TTM Snapshot' },
    ],
  },
  {
    label: 'Técnico',
    color: 'text-purple-400',
    sections: [
      { key: 'technical_52w',    label: 'Posición 52 Semanas' },
      { key: 'pivots_fibonacci', label: 'Pivots & Fibonacci' },
    ],
  },
];

const ALL_SECTION_KEYS = SECTION_GROUPS.flatMap(g => g.sections.map(s => s.key));
const DEFAULT_SECTIONS = new Set(ALL_SECTION_KEYS);

const FONTS = ['helvetica', 'times', 'courier'] as const;
const PRESETS_KEY = 'prismo_pdf_presets';

interface Preset {
  name: string;
  sections: string[];
  bgHex: string;
  accentHex: string;
  font: string;
  customDisclaimer?: string;
  savedAt: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

async function compressLogo(file: File, maxPx = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')); };
    img.src = url;
  });
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: PDFConfig) => void;
  generating: boolean;
  ticker?: string;
}

export default function PDFConfigModal({ isOpen, onClose, onGenerate, generating, ticker }: Props) {
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set(DEFAULT_SECTIONS));
  const [bgHex,         setBgHex]         = useState('#000000');
  const [accentHex,     setAccentHex]     = useState('#00A651');
  const [bgInput,       setBgInput]       = useState('#000000');
  const [accentInput,   setAccentInput]   = useState('#00A651');
  const [font,          setFont]          = useState<string>('helvetica');
  const [logoBase64,    setLogoBase64]    = useState<string | undefined>(undefined);
  const [logoName,      setLogoName]      = useState('');
  const [customDisc,    setCustomDisc]    = useState('');
  const [toast,         setToast]         = useState<string | null>(null);
  const [showPresets,   setShowPresets]   = useState(false);
  const [presets,       setPresets]       = useState<Preset[]>([]);
  const [presetName,    setPresetName]    = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      if (raw) setPresets(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  if (!isOpen) return null;

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const toggleSection = (key: string) => {
    setSelectedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) { flash('Debes seleccionar al menos una sección.'); return prev; }
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { flash('El archivo debe ser una imagen (PNG, JPG…)'); return; }
    if (file.size > 2 * 1024 * 1024) { flash('La imagen debe ser menor a 2 MB.'); return; }
    try {
      const b64 = await compressLogo(file, 200);
      setLogoBase64(b64);
      setLogoName(file.name);
    } catch { flash('Error al procesar la imagen.'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const onBgInput = (v: string) => { setBgInput(v); if (isValidHex(v)) setBgHex(v); };
  const onAccentInput = (v: string) => { setAccentInput(v); if (isValidHex(v)) setAccentHex(v); };

  const buildConfig = (preview = false): PDFConfig => ({
    sections: ALL_SECTION_KEYS.filter(k => selectedSections.has(k)),
    branding: {
      bgColor:          hexToRgb(bgHex),
      accentColor:      hexToRgb(accentHex),
      fontFamily:       font,
      logoBase64,
      customDisclaimer: customDisc.trim() || undefined,
    },
    preview,
  });

  const handleGenerate = () => {
    if (generating) return;
    onGenerate(buildConfig(false));
  };

  const handlePreview = () => {
    if (generating) return;
    onGenerate(buildConfig(true));
  };

  // ── Presets ─────────────────────────────────────────────────────────────
  const savePreset = () => {
    const name = presetName.trim() || `Preset ${new Date().toLocaleDateString('es-AR')}`;
    const p: Preset = {
      name, sections: Array.from(selectedSections), bgHex, accentHex, font,
      customDisclaimer: customDisc.trim() || undefined, savedAt: new Date().toISOString(),
    };
    const updated = [p, ...presets].slice(0, 5);
    setPresets(updated);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(updated)); } catch {}
    setPresetName('');
    flash(`Preset "${name}" guardado.`);
  };

  const loadPreset = (p: Preset) => {
    setSelectedSections(new Set(p.sections));
    setBgHex(p.bgHex); setBgInput(p.bgHex);
    setAccentHex(p.accentHex); setAccentInput(p.accentHex);
    setFont(p.font);
    setCustomDisc(p.customDisclaimer || '');
    setShowPresets(false);
    flash(`Preset "${p.name}" cargado.`);
  };

  const deletePreset = (idx: number) => {
    const updated = presets.filter((_, i) => i !== idx);
    setPresets(updated);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(updated)); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Configurar PDF">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h2 className="text-lg font-bold text-white">
              Configurar PDF
              {ticker && <span className="text-emerald-400 font-normal ml-1.5">— {ticker}</span>}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPresets(v => !v)}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-emerald-400 transition"
              aria-label="Gestionar presets"
            >
              Presets {presets.length > 0 && <span className="text-emerald-500">({presets.length})</span>}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition" aria-label="Cerrar">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-yellow-900/50 border border-yellow-700/60 text-yellow-300 text-sm shrink-0" role="alert">
            {toast}
          </div>
        )}

        {/* Presets panel */}
        {showPresets && (
          <div className="mx-6 mt-3 p-4 rounded-xl bg-gray-800/70 border border-gray-700 shrink-0">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Presets guardados</p>
            {presets.length === 0 ? (
              <p className="text-xs text-gray-500 mb-3">No hay presets aún.</p>
            ) : (
              <div className="space-y-1.5 mb-3">
                {presets.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-gray-900/60">
                    <button onClick={() => loadPreset(p)} className="flex-1 text-left text-sm text-gray-200 hover:text-emerald-400 transition truncate">{p.name}</button>
                    <span className="text-xs text-gray-600 shrink-0">{new Date(p.savedAt).toLocaleDateString('es-AR')}</span>
                    <button onClick={() => deletePreset(i)} className="text-gray-600 hover:text-red-400 transition text-xs shrink-0" aria-label={`Eliminar ${p.name}`}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={presetName} onChange={e => setPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && savePreset()}
                placeholder="Nombre del preset..."
                className="flex-1 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                aria-label="Nombre del nuevo preset"
              />
              <button onClick={savePreset} className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium transition">Guardar</button>
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-6">
          <div className="grid sm:grid-cols-2 gap-6">
            {/* Left — Section selector (all sub-tabs) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Pestañas a incluir</h3>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setSelectedSections(new Set(ALL_SECTION_KEYS))} className="text-gray-400 hover:text-emerald-400 transition" aria-label="Seleccionar todas">Todas</button>
                  <span className="text-gray-700">·</span>
                  <button onClick={() => setSelectedSections(new Set(['cover']))} className="text-gray-400 hover:text-red-400 transition" aria-label="Deseleccionar todas">Ninguna</button>
                </div>
              </div>

              <div className="space-y-3">
                {SECTION_GROUPS.map(group => (
                  <div key={group.label}>
                    <p className={`text-xs font-semibold uppercase tracking-widest mb-1 pl-1 ${group.color}`}>{group.label}</p>
                    <div className="space-y-1">
                      {group.sections.map(s => (
                        <label key={s.key} className="flex items-center gap-3 p-2 rounded-lg bg-gray-800/50 hover:bg-gray-800 cursor-pointer transition">
                          <input
                            type="checkbox"
                            checked={selectedSections.has(s.key)}
                            onChange={() => toggleSection(s.key)}
                            className="w-3.5 h-3.5 rounded accent-emerald-500 shrink-0"
                            aria-label={`Incluir ${s.label}`}
                          />
                          <span className={`text-sm transition ${selectedSections.has(s.key) ? 'text-white' : 'text-gray-500'}`}>{s.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-xs text-gray-600">{selectedSections.size} de {ALL_SECTION_KEYS.length} secciones</p>
            </div>

            {/* Right — Branding */}
            <div className="space-y-5">
              <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Personalización</h3>

              {/* Background color */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Color de fondo</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={bgHex} onChange={e => { setBgHex(e.target.value); setBgInput(e.target.value); }}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-gray-600 bg-transparent shrink-0" aria-label="Color de fondo" />
                  <input value={bgInput} onChange={e => onBgInput(e.target.value)} maxLength={7}
                    className={`w-28 px-2.5 py-1.5 rounded-lg text-sm font-mono bg-gray-800 border focus:outline-none ${isValidHex(bgInput) ? 'border-gray-600 text-gray-200' : 'border-red-600 text-red-400'}`}
                    aria-label="Hex del color de fondo" />
                </div>
              </div>

              {/* Accent color */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Color de acento</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={accentHex} onChange={e => { setAccentHex(e.target.value); setAccentInput(e.target.value); }}
                    className="w-10 h-10 rounded-lg cursor-pointer border border-gray-600 bg-transparent shrink-0" aria-label="Color de acento" />
                  <input value={accentInput} onChange={e => onAccentInput(e.target.value)} maxLength={7}
                    className={`w-28 px-2.5 py-1.5 rounded-lg text-sm font-mono bg-gray-800 border focus:outline-none ${isValidHex(accentInput) ? 'border-gray-600 text-gray-200' : 'border-red-600 text-red-400'}`}
                    aria-label="Hex del color de acento" />
                  <div className="flex-1 h-2.5 rounded-full" style={{ background: isValidHex(accentHex) ? accentHex : '#00A651' }} aria-hidden="true" />
                </div>
              </div>

              {/* Font */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Tipografía</label>
                <div className="flex gap-2" role="radiogroup" aria-label="Tipografía del PDF">
                  {FONTS.map(f => (
                    <button key={f} onClick={() => setFont(f)} role="radio" aria-checked={font === f}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition capitalize ${font === f ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>{f}</button>
                  ))}
                </div>
              </div>

              {/* Logo */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Logo (opcional, máx. 2 MB)</label>
                <button onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition border border-gray-700 w-full" aria-label="Subir logo">
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="truncate">{logoName || 'Subir imagen…'}</span>
                </button>
                <input ref={fileRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" aria-label="Archivo de logo" />
                {logoBase64 && (
                  <div className="flex items-center gap-2 mt-2">
                    <img src={logoBase64} alt="Vista previa del logo" className="h-8 rounded object-contain bg-gray-800 p-1" />
                    <button onClick={() => { setLogoBase64(undefined); setLogoName(''); }}
                      className="text-xs text-gray-500 hover:text-red-400 transition" aria-label="Quitar logo">Quitar</button>
                  </div>
                )}
              </div>

              {/* Custom disclaimer */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Disclaimer personalizado <span className="text-gray-600">(opcional)</span></label>
                <textarea value={customDisc} onChange={e => setCustomDisc(e.target.value)}
                  placeholder="Dejar vacío para usar el disclaimer estándar…" rows={3}
                  className="w-full px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500 resize-none"
                  aria-label="Disclaimer personalizado" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-900/50 shrink-0">
          <p className="text-xs text-gray-600">
            {selectedSections.size} sección{selectedSections.size !== 1 ? 'es' : ''}
            {ticker && <> · <span className="text-gray-500">{ticker}</span></>}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition" aria-label="Cancelar">Cancelar</button>
            <button onClick={handlePreview} disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Vista previa">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Preview
            </button>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Generar PDF">
              {generating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generando…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
