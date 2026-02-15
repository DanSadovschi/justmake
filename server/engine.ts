/**
 * Signal engine — EMA crossover strategy on daily BTC closes.
 *
 * Entry rules:
 *   - EMA(20) crosses above EMA(50)
 *   - Close > EMA(50)
 *   - Entry at next-day open
 *
 * Exit rules (checked daily, first match wins):
 *   1. Stop Loss:    close <= entry * 0.95  (-5%)
 *   2. Take Profit:  close >= entry * 1.15  (+15%)
 *   3. Trailing Stop: once +8% reached, exit if close drops 3% from peak close
 *   4. Death Cross:  EMA20 crosses below EMA50
 *   5. Timeout:      30 days max hold
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

// ---------- Constants ----------

const SL_PCT = -5;         // Stop Loss at -5%
const TP_PCT = 15;         // Take Profit at +15%
const TRAIL_ACTIVATE = 8;  // Trailing stop activates at +8%
const TRAIL_DROP = 3;      // Trailing stop triggers on 3% drop from peak
const MAX_HOLD_DAYS = 30;  // Maximum hold period
const COOLDOWN_DAYS = 30;  // Minimum gap between signals
const EMA_WARMUP = 50;     // Skip first 50 candles for EMA stability

type ExitReason = 'stop_loss' | 'take_profit' | 'trailing_stop' | 'death_cross' | 'timeout';

// ---------- Signal detection ----------

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

    // Track cooldown for existing signals too (fix: was skipping without updating)
    if (existingSignalDates.has(curr.open_time)) {
      lastSignalIdx = i;
      continue;
    }

    // Skip if we're still within the cooldown of a previous signal
    if (i - lastSignalIdx <= COOLDOWN_DAYS) continue;

    // Check crossover conditions
    const prevEma20BelowOrEqual = prev.ema20 <= prev.ema50;
    const currEma20Above = curr.ema20 > curr.ema50;
    const closeAboveEma50 = curr.close > curr.ema50;

    if (prevEma20BelowOrEqual && currEma20Above && closeAboveEma50) {
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

// ---------- Smart Evaluation ----------

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
  exit_reason: ExitReason;
  hold_days: number;
}

function evaluateSignals(
  signalsToEval: SignalRow[],
  emaData: EmaPoint[],
): EvalResult[] {
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < emaData.length; i++) {
    timeToIdx.set(emaData[i].open_time, i);
  }

  const results: EvalResult[] = [];

  for (const sig of signalsToEval) {
    if (sig.entry_price == null) continue;

    const sigIdx = timeToIdx.get(sig.signal_date);
    if (sigIdx === undefined) continue;

    const entryIdx = sigIdx + 1;
    const entryPrice = sig.entry_price;

    // Need at least a few candles after entry
    if (entryIdx + 1 >= emaData.length) continue;

    const slPrice = entryPrice * (1 + SL_PCT / 100);
    const tpPrice = entryPrice * (1 + TP_PCT / 100);
    const trailActivatePrice = entryPrice * (1 + TRAIL_ACTIVATE / 100);

    let exitReason: ExitReason | null = null;
    let exitIdx = -1;
    let peakClose = entryPrice;
    let trailActive = false;
    let maxAdverse = 0;
    let maxFavorable = 0;

    const maxIdx = Math.min(entryIdx + MAX_HOLD_DAYS, emaData.length - 1);

    for (let j = entryIdx; j <= maxIdx; j++) {
      const candle = emaData[j];

      // Track max adverse / favorable
      const advPct = ((candle.low - entryPrice) / entryPrice) * 100;
      const favPct = ((candle.high - entryPrice) / entryPrice) * 100;
      if (advPct < maxAdverse) maxAdverse = advPct;
      if (favPct > maxFavorable) maxFavorable = favPct;

      // Track peak close for trailing stop
      if (candle.close > peakClose) peakClose = candle.close;

      // 1. Stop Loss — close dropped to SL level
      if (candle.close <= slPrice) {
        exitReason = 'stop_loss';
        exitIdx = j;
        break;
      }

      // 2. Take Profit — close reached TP level
      if (candle.close >= tpPrice) {
        exitReason = 'take_profit';
        exitIdx = j;
        break;
      }

      // 3. Trailing Stop — activate once +8%, trigger on 3% drop from peak
      if (!trailActive && candle.close >= trailActivatePrice) {
        trailActive = true;
      }
      if (trailActive) {
        const dropFromPeak = ((peakClose - candle.close) / peakClose) * 100;
        if (dropFromPeak >= TRAIL_DROP) {
          exitReason = 'trailing_stop';
          exitIdx = j;
          break;
        }
      }

      // 4. Death Cross — EMA20 crosses below EMA50 (skip entry day)
      if (j > entryIdx) {
        const prevDay = emaData[j - 1];
        if (prevDay.ema20 >= prevDay.ema50 && candle.ema20 < candle.ema50) {
          exitReason = 'death_cross';
          exitIdx = j;
          break;
        }
      }
    }

    // 5. Timeout — reached max hold days without any other exit
    if (exitReason === null) {
      if (maxIdx >= emaData.length) continue; // not enough data yet
      exitReason = 'timeout';
      exitIdx = maxIdx;
    }

    const exitCandle = emaData[exitIdx];
    const exitPrice = exitCandle.close;
    const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const holdDays = exitIdx - entryIdx;

    results.push({
      signal_id: sig.id,
      entry_price: entryPrice,
      exit_price: exitPrice,
      exit_date: exitCandle.open_time,
      return_pct: Math.round(returnPct * 100) / 100,
      max_adverse_pct: Math.round(maxAdverse * 100) / 100,
      max_favorable_pct: Math.round(maxFavorable * 100) / 100,
      exit_reason: exitReason,
      hold_days: holdDays,
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
  // Coerce all numeric fields — Supabase returns BIGINT as strings
  const rawCandles = await fetchAllRows<Record<string, unknown>>('candles', '*', 'open_time', true);
  const candles: CandleRow[] = rawCandles.map((c) => ({
    open_time: Number(c.open_time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));

  if (candles.length < EMA_WARMUP + 2) {
    return { generated: 0, evaluated: 0 };
  }

  const emaData = buildEmaData(candles);

  // 2. Load existing signal dates to avoid duplicates
  const { data: existingSignals, error: sigErr } = await supabase
    .from('signals')
    .select('id, signal_date, entry_price');

  if (sigErr) throw new Error(sigErr.message);

  const existingDates = new Set((existingSignals ?? []).map((s) => Number(s.signal_date)));

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
  const timeToCandle = new Map<number, CandleRow>();
  for (const c of candles) {
    timeToCandle.set(c.open_time, c);
  }

  const { data: allSignals, error: allSigErr } = await supabase
    .from('signals')
    .select('id, signal_date, entry_price');

  if (allSigErr) throw new Error(allSigErr.message);

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
      const nextOpen = timeToNextOpen.get(Number(sig.signal_date));
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

  const evaluatedSet = new Set((evaluatedIds ?? []).map((e) => Number(e.signal_id)));

  const { data: freshSignals, error: freshErr } = await supabase
    .from('signals')
    .select('id, signal_date, entry_price');

  if (freshErr) throw new Error(freshErr.message);

  const signalsToEval = (freshSignals ?? [])
    .filter((s) => !evaluatedSet.has(Number(s.id)) && s.entry_price != null)
    .map((s) => ({
      id: Number(s.id),
      signal_date: Number(s.signal_date),
      entry_price: Number(s.entry_price),
    })) as SignalRow[];

  console.log(`[engine] ${candles.length} candles, ${signalsToEval.length} signals to evaluate`);
  if (signalsToEval.length > 0) {
    const sample = signalsToEval[0];
    console.log(`[engine] sample signal: id=${sample.id} date=${sample.signal_date} entry=${sample.entry_price}`);
  }

  const evalResults = evaluateSignals(signalsToEval, emaData);
  console.log(`[engine] evaluation results: ${evalResults.length}`);

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
