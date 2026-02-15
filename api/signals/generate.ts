import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---------- Types ----------

interface CandleRow {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface EmaPoint {
  open_time: number;
  close: number;
  open: number;
  high: number;
  low: number;
  ema20: number;
  ema50: number;
}

// ---------- EMA ----------

function computeEma(candles: CandleRow[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    ema.push(i === 0 ? candles[i].close : candles[i].close * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function buildEmaData(candles: CandleRow[]): EmaPoint[] {
  const ema20 = computeEma(candles, 20);
  const ema50 = computeEma(candles, 50);
  return candles.map((c, i) => ({
    open_time: c.open_time,
    close: c.close,
    open: c.open,
    high: c.high,
    low: c.low,
    ema20: ema20[i],
    ema50: ema50[i],
  }));
}

// ---------- Signal detection ----------

const HORIZON_DAYS = 14;
const EMA_WARMUP = 50;

interface NewSignal {
  signal_date: number;
  direction: 'LONG';
  entry_price: number | null;
  ema20: number;
  ema50: number;
  reasoning: Record<string, unknown>;
}

function detectSignals(emaData: EmaPoint[], existingDates: Set<number>): NewSignal[] {
  const signals: NewSignal[] = [];
  let lastSignalIdx = -Infinity;

  for (let i = EMA_WARMUP; i < emaData.length; i++) {
    const prev = emaData[i - 1];
    const curr = emaData[i];

    if (existingDates.has(curr.open_time)) continue;
    if (i - lastSignalIdx <= HORIZON_DAYS) continue;

    if (prev.ema20 <= prev.ema50 && curr.ema20 > curr.ema50 && curr.close > curr.ema50) {
      const nextCandle = i + 1 < emaData.length ? emaData[i + 1] : null;
      signals.push({
        signal_date: curr.open_time,
        direction: 'LONG',
        entry_price: nextCandle ? nextCandle.open : null,
        ema20: curr.ema20,
        ema50: curr.ema50,
        reasoning: {
          prev_ema20: prev.ema20,
          prev_ema50: prev.ema50,
          curr_ema20: curr.ema20,
          curr_ema50: curr.ema50,
          curr_close: curr.close,
          crossover: 'EMA20 crossed above EMA50',
          close_condition: 'Close > EMA50',
        },
      });
      lastSignalIdx = i;
    }
  }
  return signals;
}

// ---------- Evaluation ----------

interface EvalResult {
  signal_id: number;
  entry_price: number;
  exit_price: number;
  exit_date: number;
  return_pct: number;
  max_adverse_pct: number;
  max_favorable_pct: number;
}

function evaluateSignals(
  signalsToEval: { id: number; signal_date: number; entry_price: number }[],
  emaData: EmaPoint[],
): EvalResult[] {
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < emaData.length; i++) timeToIdx.set(emaData[i].open_time, i);

  const results: EvalResult[] = [];
  for (const sig of signalsToEval) {
    const sigIdx = timeToIdx.get(sig.signal_date);
    if (sigIdx === undefined) continue;

    const entryIdx = sigIdx + 1;
    const exitIdx = entryIdx + HORIZON_DAYS;
    if (exitIdx >= emaData.length) continue;

    const entryPrice = sig.entry_price;
    const exitCandle = emaData[exitIdx];
    const returnPct = ((exitCandle.close - entryPrice) / entryPrice) * 100;

    let maxAdverse = 0;
    let maxFavorable = 0;
    for (let j = entryIdx; j <= exitIdx; j++) {
      const adv = ((emaData[j].low - entryPrice) / entryPrice) * 100;
      const fav = ((emaData[j].high - entryPrice) / entryPrice) * 100;
      if (adv < maxAdverse) maxAdverse = adv;
      if (fav > maxFavorable) maxFavorable = fav;
    }

    results.push({
      signal_id: sig.id,
      entry_price: entryPrice,
      exit_price: exitCandle.close,
      exit_date: exitCandle.open_time,
      return_pct: Math.round(returnPct * 100) / 100,
      max_adverse_pct: Math.round(maxAdverse * 100) / 100,
      max_favorable_pct: Math.round(maxFavorable * 100) / 100,
    });
  }
  return results;
}

// ---------- Handler ----------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Load candles
    const { data: candles, error: candleErr } = await supabase
      .from('candles')
      .select('*')
      .order('open_time', { ascending: true });

    if (candleErr) throw new Error(candleErr.message);
    if (!candles || candles.length < EMA_WARMUP + 2) {
      return res.json({ generated: 0, evaluated: 0 });
    }

    const emaData = buildEmaData(candles as CandleRow[]);

    // 2. Existing signal dates
    const { data: existingSignals, error: sigErr } = await supabase
      .from('signals')
      .select('id, signal_date, entry_price');
    if (sigErr) throw new Error(sigErr.message);

    const existingDates = new Set((existingSignals ?? []).map((s) => s.signal_date as number));

    // 3. Detect new signals
    const newSignals = detectSignals(emaData, existingDates);

    if (newSignals.length > 0) {
      const { error: insertErr } = await supabase
        .from('signals')
        .insert(newSignals.map((s) => ({ ...s, created_at: new Date().toISOString() })));
      if (insertErr) throw new Error(insertErr.message);
    }

    // 4. Backfill entry prices
    const sortedTimes = (candles as CandleRow[]).map((c) => c.open_time);
    const timeToCandle = new Map<number, CandleRow>();
    for (const c of candles as CandleRow[]) timeToCandle.set(c.open_time, c);

    const timeToNextOpen = new Map<number, number>();
    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const next = timeToCandle.get(sortedTimes[i + 1]);
      if (next) timeToNextOpen.set(sortedTimes[i], next.open);
    }

    const { data: allSignals, error: allSigErr } = await supabase
      .from('signals')
      .select('id, signal_date, entry_price');
    if (allSigErr) throw new Error(allSigErr.message);

    for (const sig of allSignals ?? []) {
      if (sig.entry_price == null) {
        const nextOpen = timeToNextOpen.get(sig.signal_date as number);
        if (nextOpen !== undefined) {
          await supabase.from('signals').update({ entry_price: nextOpen }).eq('id', sig.id);
        }
      }
    }

    // 5. Evaluate
    const { data: evaluatedIds, error: evalErr } = await supabase
      .from('evaluations')
      .select('signal_id');
    if (evalErr) throw new Error(evalErr.message);

    const evaluatedSet = new Set((evaluatedIds ?? []).map((e) => e.signal_id as number));

    const { data: freshSignals, error: freshErr } = await supabase
      .from('signals')
      .select('id, signal_date, entry_price');
    if (freshErr) throw new Error(freshErr.message);

    const signalsToEval = (freshSignals ?? [])
      .filter((s) => !evaluatedSet.has(s.id as number) && s.entry_price != null) as {
        id: number; signal_date: number; entry_price: number;
      }[];

    const evalResults = evaluateSignals(signalsToEval, emaData);

    if (evalResults.length > 0) {
      const { error: evalInsertErr } = await supabase
        .from('evaluations')
        .insert(evalResults.map((e) => ({ ...e, evaluated_at: new Date().toISOString() })));
      if (evalInsertErr) throw new Error(evalInsertErr.message);
    }

    return res.json({ generated: newSignals.length, evaluated: evalResults.length });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
