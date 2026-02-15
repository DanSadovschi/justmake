/**
 * Signal engine — EMA crossover strategy on daily BTC closes.
 *
 * Rules:
 *   - Compute EMA(20) and EMA(50) on daily close prices.
 *   - LONG signal when:
 *       1. Previous candle: EMA20 <= EMA50
 *       2. Current candle:  EMA20 > EMA50
 *       3. Current close > EMA50
 *   - Entry price: next-day open (set when available).
 *   - Evaluation horizon: 14 calendar days (14 candles).
 *   - One signal per crossover: no new LONG while a prior signal's horizon is still open.
 */

import { supabase } from './supabase.js';

// ---------- Helpers ----------

/** Paginated query — Supabase returns max 1000 rows by default. */
async function fetchAllRows<T>(
  table: string,
  select: string,
  orderCol: string,
  ascending = true,
): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderCol, { ascending })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }

  return rows;
}

// ---------- EMA calculation ----------

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

function computeEma(candles: CandleRow[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      ema.push(candles[i].close);
    } else {
      ema.push(candles[i].close * k + ema[i - 1] * (1 - k));
    }
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
const EMA_WARMUP = 50; // Skip first 50 candles for EMA stability

interface NewSignal {
  signal_date: number;
  direction: 'LONG';
  entry_price: number | null;
  ema20: number;
  ema50: number;
  reasoning: Record<string, unknown>;
}

function detectSignals(emaData: EmaPoint[], existingSignalDates: Set<number>): NewSignal[] {
  const signals: NewSignal[] = [];
  let lastSignalIdx = -Infinity;

  for (let i = EMA_WARMUP; i < emaData.length; i++) {
    const prev = emaData[i - 1];
    const curr = emaData[i];

    // Skip if we already have a signal for this date
    if (existingSignalDates.has(curr.open_time)) continue;

    // Skip if we're still within the horizon of a previous signal
    if (i - lastSignalIdx <= HORIZON_DAYS) continue;

    // Check crossover conditions
    const prevEma20BelowOrEqual = prev.ema20 <= prev.ema50;
    const currEma20Above = curr.ema20 > curr.ema50;
    const closeAboveEma50 = curr.close > curr.ema50;

    if (prevEma20BelowOrEqual && currEma20Above && closeAboveEma50) {
      // Entry price = next-day open (if available)
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

interface SignalRow {
  id: number;
  signal_date: number;
  entry_price: number | null;
}

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
  signalsToEval: SignalRow[],
  emaData: EmaPoint[],
): EvalResult[] {
  // Build a map from open_time to index for fast lookup
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < emaData.length; i++) {
    timeToIdx.set(emaData[i].open_time, i);
  }

  const results: EvalResult[] = [];

  for (const sig of signalsToEval) {
    if (sig.entry_price == null) continue;

    const sigIdx = timeToIdx.get(sig.signal_date);
    if (sigIdx === undefined) continue;

    // Entry is at next-day open, so horizon starts at sigIdx + 1
    const entryIdx = sigIdx + 1;
    const exitIdx = entryIdx + HORIZON_DAYS;

    // Need at least exitIdx candles
    if (exitIdx >= emaData.length) continue;

    const entryPrice = sig.entry_price;
    const exitCandle = emaData[exitIdx];
    const exitPrice = exitCandle.close;
    const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    // Compute max adverse and favorable during horizon (entry candle through exit candle)
    let maxAdverse = 0;
    let maxFavorable = 0;

    for (let j = entryIdx; j <= exitIdx; j++) {
      const low = emaData[j].low;
      const high = emaData[j].high;
      const adversePct = ((low - entryPrice) / entryPrice) * 100;
      const favorablePct = ((high - entryPrice) / entryPrice) * 100;

      if (adversePct < maxAdverse) maxAdverse = adversePct;
      if (favorablePct > maxFavorable) maxFavorable = favorablePct;
    }

    results.push({
      signal_id: sig.id,
      entry_price: entryPrice,
      exit_price: exitPrice,
      exit_date: exitCandle.open_time,
      return_pct: Math.round(returnPct * 100) / 100,
      max_adverse_pct: Math.round(maxAdverse * 100) / 100,
      max_favorable_pct: Math.round(maxFavorable * 100) / 100,
    });
  }

  return results;
}

// ---------- Orchestrator ----------

export async function generateAndEvaluateSignals(): Promise<{
  generated: number;
  evaluated: number;
}> {
  // 1. Load all candles (paginated to avoid 1000-row limit)
  const candles = await fetchAllRows<CandleRow>('candles', '*', 'open_time', true);

  if (candles.length < EMA_WARMUP + 2) {
    return { generated: 0, evaluated: 0 };
  }

  const emaData = buildEmaData(candles);

  // 2. Load existing signal dates to avoid duplicates
  const { data: existingSignals, error: sigErr } = await supabase
    .from('signals')
    .select('id, signal_date, entry_price');

  if (sigErr) throw new Error(sigErr.message);

  const existingDates = new Set((existingSignals ?? []).map((s) => s.signal_date));

  // 3. Detect new signals
  const newSignals = detectSignals(emaData, existingDates);

  // 4. Insert new signals
  if (newSignals.length > 0) {
    const { error: insertErr } = await supabase
      .from('signals')
      .insert(newSignals.map((s) => ({
        ...s,
        reasoning: s.reasoning,
        created_at: new Date().toISOString(),
      })));

    if (insertErr) throw new Error(insertErr.message);
  }

  // 5. Update entry_price for signals that were missing it
  //    (signal was on the latest candle at the time, now next-day exists)
  const timeToCandle = new Map<number, CandleRow>();
  for (const c of candles) {
    timeToCandle.set(c.open_time, c);
  }

  const { data: allSignals, error: allSigErr } = await supabase
    .from('signals')
    .select('id, signal_date, entry_price');

  if (allSigErr) throw new Error(allSigErr.message);

  // Find candles sorted by time to get "next candle" lookup
  const sortedTimes = candles.map((c) => c.open_time);
  const timeToNextOpen = new Map<number, number>();
  for (let i = 0; i < sortedTimes.length - 1; i++) {
    const nextCandle = timeToCandle.get(sortedTimes[i + 1]);
    if (nextCandle) {
      timeToNextOpen.set(sortedTimes[i], nextCandle.open);
    }
  }

  for (const sig of allSignals ?? []) {
    if (sig.entry_price == null) {
      const nextOpen = timeToNextOpen.get(sig.signal_date);
      if (nextOpen !== undefined) {
        await supabase
          .from('signals')
          .update({ entry_price: nextOpen })
          .eq('id', sig.id);
      }
    }
  }

  // 6. Evaluate signals that haven't been evaluated yet
  const { data: evaluatedIds, error: evalErr } = await supabase
    .from('evaluations')
    .select('signal_id');

  if (evalErr) throw new Error(evalErr.message);

  const evaluatedSet = new Set((evaluatedIds ?? []).map((e) => e.signal_id));

  // Reload signals with updated entry_prices
  const { data: freshSignals, error: freshErr } = await supabase
    .from('signals')
    .select('id, signal_date, entry_price');

  if (freshErr) throw new Error(freshErr.message);

  const signalsToEval = (freshSignals ?? [])
    .filter((s) => !evaluatedSet.has(s.id) && s.entry_price != null) as SignalRow[];

  const evalResults = evaluateSignals(signalsToEval, emaData);

  if (evalResults.length > 0) {
    const { error: evalInsertErr } = await supabase
      .from('evaluations')
      .insert(evalResults.map((e) => ({
        ...e,
        evaluated_at: new Date().toISOString(),
      })));

    if (evalInsertErr) throw new Error(evalInsertErr.message);
  }

  return {
    generated: newSignals.length,
    evaluated: evalResults.length,
  };
}
