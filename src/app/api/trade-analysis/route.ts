import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// La llamada a Claude + los fetch a FMP pueden superar los 10s default.
// Vercel Hobby permite hasta 300s.
export const maxDuration = 60;

const FMP_BASE = 'https://financialmodelingprep.com';

interface TradePartial { id: string; date: string; qty: number; price: number }

interface TradePayload {
  id: string;
  name: string;
  symbol: string;
  side: 'Long' | 'Short';
  date: string;
  qty: number;
  entryPrice: number;
  commission: number;
  sl: number;
  initialSL: number;
  initialRisk: number;
  pt1Price: number | null;
  setup: string;
  characteristic?: string | null;
  sellReason: string | null;
  postAnalysis: string;
  industry: string;
  partials?: TradePartial[];
  exitPrice: number | null;
  exitDate: string | null;
}

interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number }

async function fmp(path: string, params: Record<string, string>): Promise<any> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return null;
  const search = new URLSearchParams(params);
  search.set('apikey', apiKey);
  try {
    const res = await fetch(`${FMP_BASE}/${path}?${search.toString()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const fmtUsd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

/**
 * Junta todos los hechos cuantitativos del trade a partir de los datos del
 * diario + velas diarias de FMP (ticker y SPY) + perfil de la compañía.
 * Estos hechos alimentan tanto el prompt de la IA como el análisis de reglas.
 */
async function buildFacts(trade: TradePayload, metrics: any, accountBalance: number) {
  const entry = trade.entryPrice;
  const exit = trade.exitPrice ?? entry;
  const sideMult = trade.side === 'Long' ? 1 : -1;
  const exitDate = trade.exitDate ?? trade.date;

  const from = addDays(trade.date, -10);
  const to = addDays(exitDate, 5);

  const [candlesRaw, spyRaw, profileRaw] = await Promise.all([
    fmp('stable/historical-price-eod/full', { symbol: trade.symbol, from, to }),
    fmp('stable/historical-price-eod/full', { symbol: 'SPY', from, to }),
    fmp('stable/profile', { symbol: trade.symbol }),
  ]);

  const toCandles = (raw: any): Candle[] => {
    const arr = Array.isArray(raw) ? raw : raw?.historical ?? [];
    return (arr as Candle[])
      .filter(c => c && c.date && isFinite(c.close))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const candles = toCandles(candlesRaw);
  const spy = toCandles(spyRaw);
  const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;

  const holding = candles.filter(c => c.date >= trade.date && c.date <= exitDate);
  const preEntry = candles.filter(c => c.date < trade.date);
  const postExit = candles.filter(c => c.date > exitDate);

  // Excursión máxima a favor (MFE) y en contra (MAE) durante el trade, por acción
  let mfe: number | null = null;
  let mae: number | null = null;
  if (holding.length) {
    const highest = Math.max(...holding.map(c => c.high));
    const lowest = Math.min(...holding.map(c => c.low));
    mfe = trade.side === 'Long' ? highest - entry : entry - lowest;
    mae = trade.side === 'Long' ? entry - lowest : highest - entry;
  }

  const riskPerShare = Math.abs(entry - (trade.initialSL || trade.sl));
  const rMultiple = riskPerShare > 0 ? (sideMult * (exit - entry)) / riskPerShare : null;
  const mfeR = mfe != null && riskPerShare > 0 ? mfe / riskPerShare : null;
  const maeR = mae != null && riskPerShare > 0 ? mae / riskPerShare : null;

  // Gap / contexto del día de entrada
  const prevClose = preEntry.length ? preEntry[preEntry.length - 1].close : null;
  const entryDayCandle = holding.find(c => c.date === trade.date) ?? holding[0] ?? null;
  const gapPct = prevClose && entryDayCandle ? (entryDayCandle.open - prevClose) / prevClose : null;

  // Tendencia previa: días verdes/rojos consecutivos antes de la entrada
  let consecPrev = 0;
  let prevColor: 'verdes' | 'rojos' | null = null;
  for (let i = preEntry.length - 1; i >= 0; i--) {
    const green = preEntry[i].close >= preEntry[i].open;
    const color = green ? 'verdes' : 'rojos';
    if (prevColor === null) prevColor = color;
    if (color !== prevColor) break;
    consecPrev++;
  }

  // Qué pasó DESPUÉS de la salida (para juzgar si la salida fue buena)
  let postExitMove: number | null = null;
  if (postExit.length && exit > 0) {
    const lastClose = postExit[Math.min(postExit.length, 5) - 1].close;
    postExitMove = (lastClose - exit) / exit;
  }

  // Mercado (SPY) durante el trade
  const spyHolding = spy.filter(c => c.date >= trade.date && c.date <= exitDate);
  let spyMove: number | null = null;
  if (spyHolding.length >= 1) {
    spyMove = (spyHolding[spyHolding.length - 1].close - spyHolding[0].open) / spyHolding[0].open;
  }

  const partials = trade.partials ?? [];
  const partialsQty = partials.reduce((s, p) => s + p.qty, 0);

  const pnl = metrics?.pnl ?? sideMult * (exit - entry) * trade.qty - (trade.commission || 0);
  const pnlPct = metrics?.pnlPct ?? (entry > 0 ? pnl / (entry * trade.qty) : 0);
  const daysHeld = Math.max(0, Math.ceil((new Date(exitDate).getTime() - new Date(trade.date).getTime()) / 86400000));
  const riskPctOfAccount = accountBalance > 0 && trade.initialRisk ? trade.initialRisk / accountBalance : null;
  const slRespected = riskPerShare > 0 && rMultiple != null ? rMultiple >= -1.3 : null;

  return {
    entry, exit, sideMult, exitDate, pnl, pnlPct, daysHeld,
    riskPerShare, rMultiple, mfe, mae, mfeR, maeR,
    gapPct, consecPrev, prevColor, postExitMove, spyMove,
    partials, partialsQty, riskPctOfAccount, slRespected,
    profile: profile ? {
      companyName: profile.companyName || trade.name,
      sector: profile.sector, industry: profile.industry || trade.industry,
      mktCap: profile.marketCap ?? profile.mktCap, beta: profile.beta,
      avgVolume: profile.averageVolume ?? profile.volAvg, description: profile.description,
    } : null,
    hasCandles: holding.length > 0,
  };
}

type Facts = Awaited<ReturnType<typeof buildFacts>>;

/** Resumen de hechos en texto — es el contexto del prompt de la IA. */
function factsToText(trade: TradePayload, facts: Facts): string {
  const L: string[] = [];
  L.push(`Ticker: ${trade.symbol} (${facts.profile?.companyName || trade.name || 'N/D'})`);
  if (facts.profile?.sector) L.push(`Sector/Industria: ${facts.profile.sector} / ${facts.profile.industry || 'N/D'}`);
  if (facts.profile?.mktCap) L.push(`Market cap: ${fmtUsd(facts.profile.mktCap)}${facts.profile.beta ? ` · Beta: ${facts.profile.beta}` : ''}`);
  L.push(`Dirección: ${trade.side} · Setup: ${trade.setup}${trade.characteristic ? ` · Característica: ${trade.characteristic}` : ''}`);
  L.push(`Entrada: ${trade.date} @ ${fmtUsd(facts.entry)} · ${trade.qty} acciones (valor ${fmtUsd(facts.entry * trade.qty)})`);
  L.push(`Stop inicial: ${fmtUsd(trade.initialSL || trade.sl)} (riesgo/acción ${fmtUsd(facts.riskPerShare)})${facts.riskPctOfAccount != null ? ` · Riesgo: ${fmtPct(facts.riskPctOfAccount)} de la cuenta` : ''}`);
  if (trade.pt1Price) L.push(`Price target 1: ${fmtUsd(trade.pt1Price)}`);
  if (facts.partials.length) {
    L.push(`Cierres parciales: ${facts.partials.map(p => `${p.qty} @ ${fmtUsd(p.price)} (${p.date})`).join(', ')}`);
  }
  L.push(`Salida final: ${facts.exitDate} @ ${fmtUsd(facts.exit)}${trade.sellReason ? ` · Motivo: ${trade.sellReason}` : ''}`);
  L.push(`Resultado: ${fmtUsd(facts.pnl)} (${fmtPct(facts.pnlPct)})${facts.rMultiple != null ? ` · ${facts.rMultiple.toFixed(2)}R` : ''} · ${facts.daysHeld} día(s)`);
  if (facts.gapPct != null) L.push(`Gap de apertura el día de entrada: ${fmtPct(facts.gapPct)}`);
  if (facts.consecPrev > 0 && facts.prevColor) L.push(`Antes de la entrada venía de ${facts.consecPrev} día(s) ${facts.prevColor} consecutivo(s)`);
  if (facts.mfeR != null && facts.maeR != null) {
    L.push(`Durante el trade: máxima excursión a favor ${facts.mfeR.toFixed(2)}R · máxima en contra ${facts.maeR.toFixed(2)}R`);
  }
  if (facts.postExitMove != null) L.push(`Movimiento del precio en los ~5 días posteriores a la salida: ${fmtPct(facts.postExitMove)} desde el precio de salida`);
  if (facts.spyMove != null) L.push(`SPY durante el período del trade: ${fmtPct(facts.spyMove)}`);
  if (trade.postAnalysis) L.push(`Notas del trader: ${trade.postAnalysis}`);
  return L.join('\n');
}

/** Fallback determinístico (sin API key de Anthropic): análisis cuantitativo en español. */
function rulesAnalysis(trade: TradePayload, facts: Facts): string {
  const win = facts.pnl >= 0;
  const P: string[] = [];

  // Veredicto
  P.push(
    `${win ? '✅' : '❌'} ${trade.symbol} ${trade.side} — ${fmtUsd(facts.pnl)} (${fmtPct(facts.pnlPct)})` +
    (facts.rMultiple != null ? `, equivalente a ${facts.rMultiple.toFixed(2)}R` : '') +
    ` en ${facts.daysHeld} día(s). Setup: ${trade.setup}${trade.characteristic ? ` (${trade.characteristic})` : ''}.`
  );

  // Estrategia / contexto
  const ctx: string[] = [];
  if (facts.gapPct != null && Math.abs(facts.gapPct) >= 0.02) {
    ctx.push(`la acción abrió con un gap de ${fmtPct(facts.gapPct)} el día de entrada, lo que aumentaba la volatilidad esperada`);
  }
  if (facts.consecPrev >= 3 && facts.prevColor) {
    ctx.push(`venía de ${facts.consecPrev} días ${facts.prevColor} consecutivos, un contexto ${facts.prevColor === 'verdes' ? 'extendido al alza (riesgo de reversión para longs, favorable para fades)' : 'de debilidad sostenida'}`);
  }
  if (facts.spyMove != null) {
    const aligned = (facts.spyMove >= 0) === (trade.side === 'Long');
    ctx.push(`el mercado (SPY) se movió ${fmtPct(facts.spyMove)} durante el trade, es decir ${aligned ? 'a favor' : 'en contra'} de la dirección elegida`);
  }
  if (facts.profile?.beta && facts.profile.beta > 1.5) {
    ctx.push(`es un papel de beta alta (${facts.profile.beta}), donde los stops sufren más ruido`);
  }
  P.push(`📌 Estrategia y contexto: ${ctx.length ? ctx.join('; ') + '.' : 'no se detectaron señales de contexto extremas en los datos disponibles.'}`);

  // Entrada
  const ent: string[] = [];
  if (facts.riskPctOfAccount != null) {
    if (facts.riskPctOfAccount > 0.02) ent.push(`el riesgo inicial fue ${fmtPct(facts.riskPctOfAccount)} de la cuenta — por encima del 1-2% recomendado`);
    else ent.push(`el sizing fue correcto (${fmtPct(facts.riskPctOfAccount)} de la cuenta en riesgo)`);
  }
  if (facts.maeR != null) {
    if (facts.maeR > 0.8 && win) ent.push(`el precio llegó a ir ${facts.maeR.toFixed(2)}R en contra antes de dar ganancia: la entrada fue temprana o el stop demasiado justo, y el trade sobrevivió por poco`);
    else if (facts.maeR <= 0.35) ent.push(`la máxima excursión en contra fue de solo ${facts.maeR.toFixed(2)}R — la entrada estuvo bien sincronizada`);
    else if (!win && facts.maeR > 1.05) ent.push(`la pérdida superó 1R (${facts.maeR.toFixed(2)}R en contra), señal de que el stop no se respetó con precisión o hubo slippage`);
  }
  P.push(`🎯 Entrada: ${ent.length ? ent.join('; ') + '.' : 'sin datos intradiarios suficientes para evaluar el timing fino de la entrada.'}`);

  // Salida
  const sal: string[] = [];
  if (facts.mfeR != null && facts.rMultiple != null) {
    const captured = facts.mfeR > 0 ? facts.rMultiple / facts.mfeR : null;
    if (facts.mfeR >= 1 && facts.rMultiple < 0) {
      sal.push(`el trade llegó a estar ${facts.mfeR.toFixed(2)}R a favor y terminó en pérdida: faltó proteger ganancias (mover el stop a breakeven o tomar un parcial)`);
    } else if (captured != null && captured < 0.5 && facts.mfeR >= 1.5) {
      sal.push(`se capturó solo ${(captured * 100).toFixed(0)}% del movimiento máximo disponible (${facts.mfeR.toFixed(2)}R): la salida dejó bastante sobre la mesa`);
    } else if (captured != null && captured >= 0.7) {
      sal.push(`se capturó ${(captured * 100).toFixed(0)}% del máximo movimiento a favor — muy buena gestión de la salida`);
    }
  }
  if (facts.postExitMove != null) {
    const post = facts.postExitMove * facts.sideMult;
    if (post > 0.05) sal.push(`tras la salida el precio siguió ${trade.side === 'Long' ? 'subiendo' : 'cayendo'} ${fmtPct(Math.abs(facts.postExitMove))}: la salida fue anticipada`);
    else if (post < -0.05) sal.push(`tras la salida el precio se dio vuelta ${fmtPct(Math.abs(facts.postExitMove))} en contra: la salida fue oportuna`);
  }
  if (facts.partials.length) {
    sal.push(`se escalonó la salida en ${facts.partials.length + 1} tramos, lo que redujo la varianza del resultado`);
  }
  if (trade.sellReason === 'Stopped' && !win) sal.push('la salida fue por stop — ejecución disciplinada de la regla, la pérdida estaba planificada');
  P.push(`🚪 Salida: ${sal.length ? sal.join('; ') + '.' : 'sin señales claras sobre la calidad de la salida con los datos disponibles.'}`);

  // Lección
  const lesson = win
    ? (facts.maeR != null && facts.maeR > 0.8
        ? 'Ganador, pero con demasiado sufrimiento intermedio: revisar si la entrada puede esperar una confirmación más clara del setup.'
        : 'Trade bien ejecutado dentro del plan. Repetir este proceso: mismo sizing, mismo tipo de setup, misma gestión.')
    : (facts.mfeR != null && facts.mfeR >= 1
        ? 'La principal falla no fue la selección sino la gestión: con ≥1R a favor, proteger con breakeven o parcial es obligatorio.'
        : 'Pérdida dentro del riesgo planificado. Verificar que el setup tuviera todas las condiciones antes de la entrada; si las tenía, es varianza normal del sistema.');
  P.push(`📚 Lección: ${lesson}`);

  return P.join('\n\n');
}

export async function POST(req: NextRequest) {
  let body: { trade: TradePayload; metrics?: any; accountBalance?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const { trade, metrics, accountBalance = 0 } = body || ({} as any);
  if (!trade?.symbol || !trade?.entryPrice) {
    return NextResponse.json({ error: 'Falta el trade (symbol/entryPrice)' }, { status: 400 });
  }
  if (trade.exitPrice == null) {
    return NextResponse.json({ error: 'El trade tiene que estar cerrado para evaluarlo' }, { status: 400 });
  }

  const facts = await buildFacts(trade, metrics, accountBalance);

  // Con ANTHROPIC_API_KEY → análisis profundo con Claude; sin key → motor de reglas.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic();
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system:
          'Sos un coach de trading profesional que escribe en español rioplatense, directo y sin adornos. ' +
          'Analizás trades ya cerrados de un trader retail de swing trading. Tu análisis debe ser accionable y honesto: ' +
          'decí qué funcionó y qué no, sin suavizar. Basate únicamente en los datos provistos; si un dato falta, no lo inventes. ' +
          'Estructura fija (usá exactamente estos encabezados en líneas separadas): ' +
          '"📌 Estrategia y contexto:", "🎯 Entrada:", "🚪 Salida:", "📚 Lección:". ' +
          'Antes de los encabezados, una primera línea con el veredicto en una oración. ' +
          'Longitud total: 150 a 300 palabras. Sin markdown de títulos (#), sin listas con viñetas.',
        messages: [{
          role: 'user',
          content:
            `Analizá este trade cerrado (estrategia, entrada y salida) considerando el setup, los datos de la compañía y el contexto de mercado:\n\n${factsToText(trade, facts)}`,
        }],
      });

      if (response.stop_reason !== 'refusal') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n')
          .trim();
        if (text) {
          return NextResponse.json({ analysis: text, source: 'ai' });
        }
      }
      // Refusal o respuesta vacía → caemos al motor de reglas
    } catch (e) {
      console.error('[trade-analysis] Claude falló, usando motor de reglas:', e);
    }
  }

  return NextResponse.json({ analysis: rulesAnalysis(trade, facts), source: 'rules' });
}
