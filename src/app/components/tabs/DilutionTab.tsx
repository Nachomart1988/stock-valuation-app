// src/app/components/tabs/DilutionTab.tsx
// Subpestaña Dilution — perfil de dilución completo (SEC EDGAR + FMP):
// risk gauges, historial O/S, cash runway, convertibles, ATMs, equity lines,
// shelfs (con baby shelf / IB6) y offerings completados.
'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

interface RiskScore { score: number; label: 'Low' | 'Medium' | 'High' }

interface DilutionResult {
  ticker: string;
  cik: number;
  companyName: string | null;
  price: number | null;
  sharesOutstanding: number | null;
  floatShares: number | null;
  riskScores: {
    overallRisk: RiskScore;
    offeringAbility: RiskScore;
    overheadSupply: RiskScore;
    historical: RiskScore;
    cashNeed: RiskScore;
    dilutionPct1Y: number | null;
  };
  sharesHistory: { date: string; shares: number; current?: boolean }[];
  potentialDilution: {
    warrants: number | null;
    options: number | null;
    rsus: number | null;
    convertiblePrincipal: number | null;
    convertiblePrice: number | null;
    convertibleSharesEst: number | null;
    totalPotentialShares: number | null;
    asOf: string | null;
  };
  cashPosition: {
    quarters: { date: string; cash: number | null }[];
    lastReportedCash: number | null;
    lastReportDate: string | null;
    lastQuarterOpCF: number | null;
    avgQuarterlyOpCF: number | null;
    estimatedCurrentCash: number | null;
    monthsOfCashLeft: number | null;
    cashFlowPositive: boolean;
  };
  babyShelf: {
    isRestricted: boolean;
    floatValue: number;
    highest60DayClose: number;
    priceToExceedBabyShelf: number;
    maxRaisableIB6: number;
  } | null;
  instruments: {
    convertibleNotes: any[];
    atms: any[];
    equityLines: any[];
    shelfs: any[];
    registrations: any[];
  };
  completedOfferings: any[];
  asOf: string;
  sources: string[];
}

interface DilutionTabProps {
  ticker: string;
}

const fmtNum = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US');

const fmtMoney = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

const fmtMoneyFull = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '—' : `$${Math.round(v).toLocaleString('en-US')}`;

const fmtPrice = (v: number | null | undefined): string =>
  v == null || !isFinite(v) ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const riskColor = (label: string) =>
  label === 'High'
    ? 'bg-red-900/30 text-red-400 border-red-500/40'
    : label === 'Medium'
      ? 'bg-yellow-900/30 text-yellow-400 border-yellow-500/40'
      : 'bg-green-900/30 text-green-400 border-green-500/40';

const statusColor = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s.includes('effective') || s.includes('registered') || s.includes('active'))
    return 'bg-green-900/30 text-green-400 border-green-500/40';
  if (s.includes('pending') || s.includes('filed'))
    return 'bg-yellow-900/30 text-yellow-400 border-yellow-500/40';
  return 'bg-gray-800/60 text-gray-400 border-gray-600/40'; // expired / withdrawn / superseded
};

export default function DilutionTab({ ticker }: DilutionTabProps) {
  const { locale } = useLanguage();
  const es = locale === 'es';
  const t = (en: string, esp: string) => (es ? esp : en);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DilutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const res = await fetch(`${backendUrl}/dilution/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Error from server');
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ticker) analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // ───────────────────────── helpers de render ─────────────────────────

  const Field = ({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) => (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-800/60 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-right ${mono ? 'font-mono' : ''} text-gray-200`}>{value}</span>
    </div>
  );

  const EdgarLink = ({ url }: { url: string }) => (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs px-2 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-900/20 transition-colors"
    >
      EDGAR ↗
    </a>
  );

  const StatusChip = ({ status }: { status: string }) => (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColor(status)}`}>{status}</span>
  );

  const SectionTitle = ({ icon, title, count }: { icon: string; title: string; count?: number }) => (
    <h4 className="text-lg font-bold text-green-400 flex items-center gap-2">
      <span>{icon}</span> {title}
      {count !== undefined && (
        <span className="text-xs font-normal text-gray-500 bg-gray-800/80 px-2 py-0.5 rounded-full">{count}</span>
      )}
    </h4>
  );

  // ───────────────────────── estados de carga ─────────────────────────

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-green-500 border-t-transparent" />
        <p className="text-gray-400 text-sm">
          {t(
            'Querying SEC EDGAR filings (S-3, 424B, XBRL)… this can take up to a minute on first load.',
            'Consultando filings de SEC EDGAR (S-3, 424B, XBRL)… puede tardar hasta un minuto la primera vez.',
          )}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-900/20 border border-red-500/40 text-red-400">
        <p className="font-semibold">{t('Error', 'Error')}</p>
        <p className="text-sm mt-1">{error}</p>
        <button
          onClick={analyze}
          className="mt-3 px-4 py-1.5 rounded-lg bg-red-900/40 border border-red-500/40 text-sm hover:bg-red-900/60"
        >
          {t('Retry', 'Reintentar')}
        </button>
      </div>
    );
  }

  if (!result) {
    return <p className="text-gray-500 py-8 text-center">{t('Select a ticker to analyze dilution.', 'Seleccioná un ticker para analizar la dilución.')}</p>;
  }

  const { riskScores: rs, cashPosition: cp, potentialDilution: pd, instruments: ins, babyShelf } = result;

  // datos del chart O/S (+ barra de dilución potencial)
  const osData: { date: string; shares: number; kind: 'hist' | 'current' | 'potential' }[] =
    result.sharesHistory.map((p) => ({
      date: p.date,
      shares: p.shares,
      kind: p.current ? 'current' : 'hist',
    }));
  if (pd.totalPotentialShares && result.sharesOutstanding) {
    osData.push({
      date: t('Fully diluted', 'Diluido total'),
      shares: result.sharesOutstanding + pd.totalPotentialShares,
      kind: 'potential',
    });
  }

  // datos del chart de cash (+ OpCF + estimado actual)
  const cashData: { date: string; value: number; kind: 'hist' | 'opcf' | 'est' }[] = cp.quarters
    .filter((q) => q.cash != null)
    .map((q) => ({ date: q.date, value: q.cash as number, kind: 'hist' as const }));
  if (cp.avgQuarterlyOpCF != null) cashData.push({ date: 'OpCF', value: Math.abs(cp.avgQuarterlyOpCF), kind: 'opcf' });
  if (cp.estimatedCurrentCash != null) cashData.push({ date: t('Current Est', 'Est. Actual'), value: cp.estimatedCurrentCash, kind: 'est' });

  const gauges: { name: string; rs: RiskScore }[] = [
    { name: t('Overall Risk', 'Riesgo Global'), rs: rs.overallRisk },
    { name: t('Offering Ability', 'Capacidad de Emisión'), rs: rs.offeringAbility },
    { name: t('Overhead Supply', 'Supply Latente'), rs: rs.overheadSupply },
    { name: t('Historical', 'Histórico'), rs: rs.historical },
    { name: t('Cash Need', 'Necesidad de Cash'), rs: rs.cashNeed },
  ];

  const labelEs = (l: string) => (es ? ({ Low: 'Bajo', Medium: 'Medio', High: 'Alto' } as any)[l] || l : l);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-green-400">
            💧 {t('Dilution Profile', 'Perfil de Dilución')} — {result.ticker}
          </h3>
          <p className="text-sm text-gray-500">
            {result.companyName} · CIK {result.cik} · {t('Price', 'Precio')}: {fmtPrice(result.price)} · O/S: {fmtNum(result.sharesOutstanding)} · Float: {fmtNum(result.floatShares)}
          </p>
        </div>
        <button
          onClick={analyze}
          className="px-4 py-1.5 rounded-lg bg-green-900/30 border border-green-500/40 text-green-400 text-sm hover:bg-green-900/50"
        >
          🔄 {t('Refresh', 'Actualizar')}
        </button>
      </div>

      {/* Risk gauges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {gauges.map((g) => (
          <div key={g.name} className="bg-black/40 border border-gray-800 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 mb-2">{g.name}</p>
            <span className={`inline-block px-3 py-1 rounded-full border text-sm font-semibold ${riskColor(g.rs.label)}`}>
              {labelEs(g.rs.label)} · {g.rs.score}
            </span>
          </div>
        ))}
      </div>
      {rs.dilutionPct1Y != null && (
        <p className="text-sm text-gray-400 -mt-4">
          {t('Share count change last 12 months:', 'Variación de acciones en los últimos 12 meses:')}{' '}
          <span className={`font-mono ${rs.dilutionPct1Y > 10 ? 'text-red-400' : 'text-green-400'}`}>
            {rs.dilutionPct1Y >= 0 ? '+' : ''}{rs.dilutionPct1Y.toFixed(1)}%
          </span>
        </p>
      )}

      {/* Historical O/S & Potential Dilution */}
      <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
        <SectionTitle icon="📊" title={t('Historical O/S & Potential Dilution', 'O/S Histórico y Dilución Potencial')} />
        <p className="text-xs text-gray-500 mt-1 mb-3">
          {t('As-reported shares outstanding from SEC cover pages (10-K/10-Q).', 'Acciones en circulación as-reported desde las portadas de 10-K/10-Q en SEC.')}
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={osData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v: any) => [Number(v).toLocaleString('en-US'), t('Shares', 'Acciones')]}
              />
              <Bar dataKey="shares">
                {osData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.kind === 'potential' ? '#f59e0b' : d.kind === 'current' ? '#22c55e' : '#1d4ed8'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 mt-2 text-xs text-gray-500">
          <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#1d4ed8' }} />{t('Reported O/S', 'O/S reportado')}</span>
          <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#22c55e' }} />{t('Current O/S', 'O/S actual')}</span>
          {pd.totalPotentialShares != null && (
            <span><span className="inline-block w-3 h-3 rounded-sm align-middle mr-1" style={{ background: '#f59e0b' }} />{t('Fully diluted (warrants+options+converts)', 'Diluido total (warrants+opciones+convertibles)')}</span>
          )}
        </div>
      </div>

      {/* Potential dilution breakdown */}
      <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
        <SectionTitle icon="⚠️" title={t('Potential Dilution Sources (latest XBRL)', 'Fuentes de Dilución Potencial (XBRL más reciente)')} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          {[
            { label: 'Warrants', value: fmtNum(pd.warrants) },
            { label: t('Options', 'Opciones'), value: fmtNum(pd.options) },
            { label: 'RSUs', value: fmtNum(pd.rsus) },
            {
              label: t('Convertible (est. shares)', 'Convertibles (acciones est.)'),
              value: pd.convertibleSharesEst != null
                ? fmtNum(pd.convertibleSharesEst)
                : pd.convertiblePrincipal != null
                  ? `${fmtMoney(pd.convertiblePrincipal)} ppal.`
                  : '—',
            },
          ].map((c) => (
            <div key={c.label} className="bg-gray-900/60 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="font-mono text-amber-400 mt-1">{c.value}</p>
            </div>
          ))}
        </div>
        {pd.asOf && <p className="text-xs text-gray-600 mt-2">{t('As of', 'Al')} {pd.asOf}</p>}
      </div>

      {/* Cash Position */}
      <div className="bg-black/40 border border-gray-800 rounded-xl p-4">
        <SectionTitle icon="💰" title={t('Cash Position', 'Posición de Cash')} />
        <p className="text-sm text-gray-400 mt-1 mb-3">
          {cp.cashFlowPositive ? (
            t('The company is operating cash flow positive.', 'La compañía tiene flujo de caja operativo positivo.')
          ) : cp.monthsOfCashLeft != null ? (
            <>
              {t('The company has', 'La compañía tiene')}{' '}
              <span className="font-bold text-gray-200">{cp.monthsOfCashLeft} {t('months', 'meses')}</span>{' '}
              {t('of cash left based on quarterly cash burn of', 'de cash restante según un burn trimestral de')}{' '}
              <span className="font-bold text-red-400">{fmtMoney(cp.avgQuarterlyOpCF)}</span>{' '}
              {t('and estimated current cash of', 'y un cash actual estimado de')}{' '}
              <span className="font-bold text-gray-200">{fmtMoney(cp.estimatedCurrentCash)}</span>.
            </>
          ) : (
            t('Insufficient data to estimate cash runway.', 'Datos insuficientes para estimar el runway de cash.')
          )}
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cashData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v)} />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v: any, _n: any, item: any) => [
                  fmtMoney(item?.payload?.kind === 'opcf' ? -Number(v) : Number(v)),
                  item?.payload?.kind === 'opcf'
                    ? t('Avg quarterly OpCF', 'OpCF trimestral prom.')
                    : item?.payload?.kind === 'est'
                      ? t('Estimated current cash', 'Cash actual estimado')
                      : t('Cash + ST investments', 'Cash + inversiones CP'),
                ]}
              />
              <Bar dataKey="value">
                {cashData.map((d, i) => (
                  <Cell key={i} fill={d.kind === 'opcf' ? '#be185d' : d.kind === 'est' ? '#7dd3fc' : '#1d4ed8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          {t('Last reported', 'Último reporte')}: {cp.lastReportDate || '—'} · {fmtMoney(cp.lastReportedCash)}
        </p>
      </div>

      {/* Baby shelf */}
      {babyShelf && (
        <div className={`rounded-xl p-4 border ${babyShelf.isRestricted ? 'bg-red-900/10 border-red-500/30' : 'bg-black/40 border-gray-800'}`}>
          <SectionTitle icon="🍼" title={t('Baby Shelf Status (Instruction I.B.6)', 'Estado Baby Shelf (Instrucción I.B.6)')} />
          <div className="grid sm:grid-cols-2 gap-x-8 mt-3">
            <Field label={t('Restricted (public float < $75M)', 'Restringida (float público < $75M)')} value={babyShelf.isRestricted ? t('Yes', 'Sí') : 'No'} />
            <Field label={t('Public float value', 'Valor del float público')} value={fmtMoney(babyShelf.floatValue)} />
            <Field label={t('Highest 60-day close', 'Cierre máximo 60 días')} value={fmtPrice(babyShelf.highest60DayClose)} />
            <Field label={t('Price to exceed baby shelf', 'Precio para superar baby shelf')} value={fmtPrice(babyShelf.priceToExceedBabyShelf)} />
            <Field label={t('Max raisable under IB6 (1/3 float)', 'Máximo emitible bajo IB6 (1/3 float)')} value={fmtMoney(babyShelf.maxRaisableIB6)} />
          </div>
        </div>
      )}

      {/* Convertible Notes */}
      {ins.convertibleNotes.length > 0 && (
        <div className="space-y-3">
          <SectionTitle icon="📜" title={t('Convertible Notes', 'Notas Convertibles')} count={ins.convertibleNotes.length} />
          <div className="grid md:grid-cols-2 gap-4">
            {ins.convertibleNotes.map((c, i) => (
              <div key={i} className="bg-black/40 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-200">{c.name}</p>
                  <div className="flex items-center gap-2">
                    <StatusChip status={c.status} />
                    <EdgarLink url={c.edgarUrl} />
                  </div>
                </div>
                <Field label={t('Total principal amount', 'Principal total')} value={fmtMoneyFull(c.principalAmount)} />
                <Field label={t('Conversion price', 'Precio de conversión')} value={fmtPrice(c.conversionPrice)} />
                <Field label={t('Shares issued when converted', 'Acciones al convertir')} value={fmtNum(c.sharesWhenConverted)} />
                <Field label={t('Maturity year', 'Año de vencimiento')} value={c.maturityYear || '—'} />
                <Field label={t('Prospectus date', 'Fecha del prospecto')} value={c.fileDate} />
                {c.knownOwners && <Field label={t('Known owners', 'Tenedores conocidos')} value={c.knownOwners} mono={false} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ATMs */}
      {ins.atms.length > 0 && (
        <div className="space-y-3">
          <SectionTitle icon="🏧" title="ATM (At-The-Market)" count={ins.atms.length} />
          <div className="grid md:grid-cols-2 gap-4">
            {ins.atms.map((a, i) => (
              <div key={i} className="bg-black/40 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-200">{a.name}</p>
                  <div className="flex items-center gap-2">
                    <StatusChip status={a.status} />
                    <EdgarLink url={a.edgarUrl} />
                  </div>
                </div>
                <Field label={t('Total ATM capacity', 'Capacidad total del ATM')} value={fmtMoneyFull(a.totalCapacity)} />
                <Field label={t('Placement agent', 'Agente de colocación')} value={a.agent || '—'} mono={false} />
                <Field label={t('Agreement start date', 'Inicio del acuerdo')} value={a.agreementStartDate} />
                {babyShelf && (
                  <Field label={t('Limited by baby shelf', 'Limitado por baby shelf')} value={babyShelf.isRestricted ? t('Yes', 'Sí') : 'No'} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Equity Lines */}
      {ins.equityLines.length > 0 && (
        <div className="space-y-3">
          <SectionTitle icon="📈" title="Equity Lines (ELOC)" count={ins.equityLines.length} />
          <div className="grid md:grid-cols-2 gap-4">
            {ins.equityLines.map((e, i) => (
              <div key={i} className="bg-black/40 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-200">{e.name}</p>
                  <div className="flex items-center gap-2">
                    <StatusChip status={e.status} />
                    <EdgarLink url={e.edgarUrl} />
                  </div>
                </div>
                <Field label={t('Total equity line capacity', 'Capacidad total del equity line')} value={fmtMoneyFull(e.totalCapacity)} />
                <Field label={t('Counterparty', 'Contraparte')} value={e.counterparty || '—'} mono={false} />
                <Field label={t('Agreement start date', 'Inicio del acuerdo')} value={e.agreementStartDate} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shelfs */}
      {ins.shelfs.length > 0 && (
        <div className="space-y-3">
          <SectionTitle icon="🗄️" title={t('Shelf Registrations (S-3 / F-3)', 'Registros Shelf (S-3 / F-3)')} count={ins.shelfs.length} />
          <div className="grid md:grid-cols-2 gap-4">
            {ins.shelfs.map((s, i) => (
              <div key={i} className="bg-black/40 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-200">{s.name} <span className="text-xs text-gray-500">({s.formType})</span></p>
                  <div className="flex items-center gap-2">
                    <StatusChip status={s.status} />
                    <EdgarLink url={s.edgarUrl} />
                  </div>
                </div>
                <Field label={t('Total shelf capacity', 'Capacidad total del shelf')} value={fmtMoneyFull(s.totalShelfCapacity)} />
                <Field label={t('Baby shelf restriction', 'Restricción baby shelf')} value={s.babyShelfRestriction == null ? '—' : s.babyShelfRestriction ? t('Yes', 'Sí') : 'No'} />
                <Field label={t('Outstanding shares', 'Acciones en circulación')} value={fmtNum(s.outstandingShares)} />
                <Field label="Float" value={fmtNum(s.float)} />
                <Field label={t('Highest 60-day close', 'Cierre máximo 60 días')} value={fmtPrice(s.highest60DayClose)} />
                <Field label={t('Price to exceed baby shelf', 'Precio para superar baby shelf')} value={fmtPrice(s.priceToExceedBabyShelf)} />
                <Field label={t('IB6 float value (1/3)', 'Valor float IB6 (1/3)')} value={fmtMoney(s.ib6FloatValue)} />
                <Field label={t('File date', 'Fecha de presentación')} value={s.fileDate} />
                <Field label={t('Effect date', 'Fecha de efectividad')} value={s.effectDate || '—'} />
                <Field label={t('Expiration date', 'Fecha de expiración')} value={s.expirationDate || '—'} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Offerings */}
      <div className="space-y-3">
        <SectionTitle icon="✅" title={t('Completed Offerings', 'Offerings Completados')} count={result.completedOfferings.length} />
        {result.completedOfferings.length === 0 ? (
          <p className="text-sm text-gray-500">{t('No completed offerings detected in recent prospectuses.', 'No se detectaron offerings completados en los prospectos recientes.')}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900/80 text-gray-400 text-xs uppercase">
                  <th className="px-3 py-2 text-left">{t('Type', 'Tipo')}</th>
                  <th className="px-3 py-2 text-left">{t('Method', 'Método')}</th>
                  <th className="px-3 py-2 text-right">{t('Shares', 'Acciones')}</th>
                  <th className="px-3 py-2 text-right">{t('Price', 'Precio')}</th>
                  <th className="px-3 py-2 text-right">Warrants</th>
                  <th className="px-3 py-2 text-right">{t('Offering Amt', 'Monto')}</th>
                  <th className="px-3 py-2 text-left">{t('Bank', 'Banco')}</th>
                  <th className="px-3 py-2 text-left">{t('Date', 'Fecha')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {result.completedOfferings.map((o, i) => (
                  <tr key={i} className="border-t border-gray-800/60 hover:bg-gray-900/40">
                    <td className="px-3 py-2 text-gray-300">{o.type}</td>
                    <td className="px-3 py-2 text-gray-400">{o.method}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">{fmtNum(o.shares)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">{fmtPrice(o.price)}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-400/80">{fmtNum(o.warrants)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-200">{fmtMoneyFull(o.offeringAmount)}</td>
                    <td className="px-3 py-2 text-gray-400">{o.bank || '—'}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{o.date}</td>
                    <td className="px-3 py-2"><EdgarLink url={o.edgarUrl} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-600 border-t border-gray-800 pt-3 space-y-1">
        <p>
          {t('Sources', 'Fuentes')}: {result.sources.join(' · ')} · {t('Generated', 'Generado')}: {result.asOf}
        </p>
        <p>
          ⚠️ {t(
            'Dollar amounts, conversion prices and share counts are extracted automatically from SEC filings via text parsing — verify against the linked EDGAR documents before trading. Remaining capacities (ATM/shelf usage) require manual review of 10-Q/10-K.',
            'Los montos, precios de conversión y cantidades de acciones se extraen automáticamente de los filings de la SEC mediante parsing de texto — verificá contra los documentos de EDGAR enlazados antes de operar. Las capacidades remanentes (uso de ATM/shelf) requieren revisión manual de los 10-Q/10-K.',
          )}
        </p>
      </div>
    </div>
  );
}
