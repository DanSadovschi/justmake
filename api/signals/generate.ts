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

interface DataPoint {
  open_time: number;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  ema20: number;
  ema50: number;
  rsi14: number;
  macd_line: number;
  macd_signal: number;
  macd_histogram: number;
  volume_ratio: number;
}

// ---------- Constants ----------

const SL_PCT = -5;
const TP_PCT = 15;
const TRAIL_ACTIVATE = 8;
const TRAIL_DROP = 3;
const MAX_HOLD_DAYS = 30;
const COOLDOWN_DAYS = 30;
const EMA_WARMUP = 50;

type ExitReason = 'stop_loss' | 'take_profit' | 'trailing_stop' | 'death_cross' | 'timeout';

// ---------- Indicators ----------

function computeEmaValues(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < values.length; i++) {
    ema.push(i === 0 ? values[i] : values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeEma(candles: CandleRow[], period: number): number[] {
  return computeEmaValues(candles.map((c) => c.close), period);
}

function computeRsi(candles: CandleRow[], period = 14): number[] {
  const rsi: number[] = new Array(candles.length).fill(50);
  if (candles.length < period + 1) return rsi;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function computeMacd(candles: CandleRow[]) {
  const ema12 = computeEma(candles, 12);
  const ema26 = computeEma(candles, 26);
  const line = ema12.map((v, i) => v - ema26[i]);
  const signal = computeEmaValues(line, 9);
  const histogram = line.map((v, i) => v - signal[i]);
  return { line, signal, histogram };
}

function computeVolumeRatio(candles: CandleRow[], period = 20): number[] {
  const ratio: number[] = new Array(candles.length).fill(1);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].volume;
    if (i >= period) sum -= candles[i - period].volume;
    const avg = i >= period - 1 ? sum / Math.min(i + 1, period) : candles[i].volume;
    ratio[i] = avg > 0 ? candles[i].volume / avg : 1;
  }
  return ratio;
}

function buildDataPoints(candles: CandleRow[]): DataPoint[] {
  const ema20 = computeEma(candles, 20);
  const ema50 = computeEma(candles, 50);
  const rsi14 = computeRsi(candles, 14);
  const macd = computeMacd(candles);
  const volRatio = computeVolumeRatio(candles, 20);

  return candles.map((c, i) => ({
    open_time: c.open_time,
    close: c.close,
    open: c.open,
    high: c.high,
    low: c.low,
    volume: c.volume,
    ema20: ema20[i],
    ema50: ema50[i],
    rsi14: Math.round(rsi14[i] * 100) / 100,
    macd_line: Math.round(macd.line[i] * 100) / 100,
    macd_signal: Math.round(macd.signal[i] * 100) / 100,
    macd_histogram: Math.round(macd.histogram[i] * 100) / 100,
    volume_ratio: Math.round(volRatio[i] * 100) / 100,
  }));
}

// ---------- Confidence ----------

function computeConfidence(dp: DataPoint): number {
  let score = 0;

  if (dp.rsi14 >= 30 && dp.rsi14 <= 50) score += 30;
  else if (dp.rsi14 > 50 && dp.rsi14 <= 60) score += 20;
  else if (dp.rsi14 > 60 && dp.rsi14 <= 70) score += 10;

  if (dp.macd_histogram > 0) score += 15;
  if (dp.macd_line > dp.macd_signal) score += 15;

  if (dp.volume_ratio >= 1.5) score += 20;
  else if (dp.volume_ratio >= 1.0) score += 10;

  const emaSpread = ((dp.ema20 - dp.ema50) / dp.ema50) * 100;
  if (emaSpread > 2) score += 20;
  else if (emaSpread > 0.5) score += 10;
  else score += 5;

  return score;
}

// ---------- Signal detection ----------

interface NewSignal {
  signal_date: number;
  direction: 'LONG';
  entry_price: number | null;
  ema20: number;
  ema50: number;
  rsi14: number;
  macd_line: number;
  macd_signal: number;
  macd_histogram: number;
  volume_ratio: number;
  confidence: number;
  reasoning: Record<string, unknown>;
}

function detectSignals(data: DataPoint[], existingDates: Set<number>): NewSignal[] {
  const signals: NewSignal[] = [];
  let lastSignalIdx = -Infinity;

  for (let i = EMA_WARMUP; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];

    if (existingDates.has(curr.open_time)) { lastSignalIdx = i; continue; }
    if (i - lastSignalIdx <= COOLDOWN_DAYS) continue;

    if (prev.ema20 <= prev.ema50 && curr.ema20 > curr.ema50 && curr.close > curr.ema50) {
      const nextCandle = i + 1 < data.length ? data[i + 1] : null;
      const confidence = computeConfidence(curr);

      signals.push({
        signal_date: curr.open_time,
        direction: 'LONG',
        entry_price: nextCandle ? nextCandle.open : null,
        ema20: curr.ema20,
        ema50: curr.ema50,
        rsi14: curr.rsi14,
        macd_line: curr.macd_line,
        macd_signal: curr.macd_signal,
        macd_histogram: curr.macd_histogram,
        volume_ratio: curr.volume_ratio,
        confidence,
        reasoning: {
          crossover: 'EMA20 crossed above EMA50',
          close_condition: 'Close > EMA50',
          rsi14: curr.rsi14,
          macd_histogram: curr.macd_histogram,
          volume_ratio: curr.volume_ratio,
          confidence,
        },
      });
      lastSignalIdx = i;
    }
  }
  return signals;
}

// ---------- Smart Evaluation ----------

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
  signalsToEval: { id: number; signal_date: number; entry_price: number }[],
  data: DataPoint[],
): EvalResult[] {
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < data.length; i++) timeToIdx.set(data[i].open_time, i);

  const results: EvalResult[] = [];
  for (const sig of signalsToEval) {
    const sigIdx = timeToIdx.get(sig.signal_date);
    if (sigIdx === undefined) continue;

    const entryIdx = sigIdx + 1;
    const entryPrice = sig.entry_price;
    if (entryIdx + 1 >= data.length) continue;

    const slPrice = entryPrice * (1 + SL_PCT / 100);
    const tpPrice = entryPrice * (1 + TP_PCT / 100);
    const trailActivatePrice = entryPrice * (1 + TRAIL_ACTIVATE / 100);

    let exitReason: ExitReason | null = null;
    let exitIdx = -1;
    let peakClose = entryPrice;
    let trailActive = false;
    let maxAdverse = 0;
    let maxFavorable = 0;

    const maxIdx = Math.min(entryIdx + MAX_HOLD_DAYS, data.length - 1);

    for (let j = entryIdx; j <= maxIdx; j++) {
      const candle = data[j];
      const advPct = ((candle.low - entryPrice) / entryPrice) * 100;
      const favPct = ((candle.high - entryPrice) / entryPrice) * 100;
      if (advPct < maxAdverse) maxAdverse = advPct;
      if (favPct > maxFavorable) maxFavorable = favPct;
      if (candle.close > peakClose) peakClose = candle.close;

      if (candle.close <= slPrice) { exitReason = 'stop_loss'; exitIdx = j; break; }
      if (candle.close >= tpPrice) { exitReason = 'take_profit'; exitIdx = j; break; }

      if (!trailActive && candle.close >= trailActivatePrice) trailActive = true;
      if (trailActive) {
        const dropFromPeak = ((peakClose - candle.close) / peakClose) * 100;
        if (dropFromPeak >= TRAIL_DROP) { exitReason = 'trailing_stop'; exitIdx = j; break; }
      }

      if (j > entryIdx) {
        const prevDay = data[j - 1];
        if (prevDay.ema20 >= prevDay.ema50 && candle.ema20 < candle.ema50) {
          exitReason = 'death_cross'; exitIdx = j; break;
        }
      }
    }

    if (exitReason === null) {
      if (maxIdx >= data.length) continue;
      exitReason = 'timeout';
      exitIdx = maxIdx;
    }

    const exitCandle = data[exitIdx];
    const returnPct = ((exitCandle.close - entryPrice) / entryPrice) * 100;

    results.push({
      signal_id: sig.id,
      entry_price: entryPrice,
      exit_price: exitCandle.close,
      exit_date: exitCandle.open_time,
      return_pct: Math.round(returnPct * 100) / 100,
      max_adverse_pct: Math.round(maxAdverse * 100) / 100,
      max_favorable_pct: Math.round(maxFavorable * 100) / 100,
      exit_reason: exitReason,
      hold_days: exitIdx - entryIdx,
    });
  }
  return results;
}

// ---------- Handler ----------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const PAGE_SIZE = 1000;
    const candles: CandleRow[] = [];
    let from = 0;

    while (true) {
      const { data, error: candleErr } = await supabase
        .from('candles')
        .select('*')
        .order('open_time', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (candleErr) throw new Error(candleErr.message);
      if (!data || data.length === 0) break;
      candles.push(...data.map((c) => ({
        open_time: Number(c.open_time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      })));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (candles.length < EMA_WARMUP + 2) {
      return res.json({ generated: 0, evaluated: 0 });
    }

    const data = buildDataPoints(candles);

    const { data: existingSignals, error: sigErr } = await supabase
      .from('signals')
      .select('id, signal_date, entry_price, confidence');
    if (sigErr) throw new Error(sigErr.message);

    const existingDates = new Set((existingSignals ?? []).map((s) => Number(s.signal_date)));
    const newSignals = detectSignals(data, existingDates);

    if (newSignals.length > 0) {
      const { error: insertErr } = await supabase
        .from('signals')
        .insert(newSignals.map((s) => ({ ...s, created_at: new Date().toISOString() })));
      if (insertErr) throw new Error(insertErr.message);
    }

    // Backfill entry prices
    const sortedTimes = candles.map((c) => c.open_time);
    const timeToCandle = new Map<number, CandleRow>();
    for (const c of candles) timeToCandle.set(c.open_time, c);

    const timeToNextOpen = new Map<number, number>();
    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const next = timeToCandle.get(sortedTimes[i + 1]);
      if (next) timeToNextOpen.set(sortedTimes[i], next.open);
    }

    const { data: allSignals, error: allSigErr } = await supabase
      .from('signals')
      .select('id, signal_date, entry_price, confidence');
    if (allSigErr) throw new Error(allSigErr.message);

    for (const sig of allSignals ?? []) {
      if (sig.entry_price == null) {
        const nextOpen = timeToNextOpen.get(Number(sig.signal_date));
        if (nextOpen !== undefined) {
          await supabase.from('signals').update({ entry_price: nextOpen }).eq('id', sig.id);
        }
      }
    }

    // Backfill indicators for existing signals
    const timeToDataIdx = new Map<number, number>();
    for (let i = 0; i < data.length; i++) timeToDataIdx.set(data[i].open_time, i);

    for (const sig of allSignals ?? []) {
      const sigDate = Number(sig.signal_date);
      const idx = timeToDataIdx.get(sigDate);
      if (idx !== undefined && sig.confidence == null) {
        const dp = data[idx];
        const confidence = computeConfidence(dp);
        await supabase
          .from('signals')
          .update({
            rsi14: dp.rsi14,
            macd_line: dp.macd_line,
            macd_signal: dp.macd_signal,
            macd_histogram: dp.macd_histogram,
            volume_ratio: dp.volume_ratio,
            confidence,
            reasoning: {
              crossover: 'EMA20 crossed above EMA50',
              close_condition: 'Close > EMA50',
              rsi14: dp.rsi14,
              macd_histogram: dp.macd_histogram,
              volume_ratio: dp.volume_ratio,
              confidence,
            },
          })
          .eq('id', sig.id);
      }
    }

    // Delete old evaluations without exit_reason (pre-smart-exit)
    await supabase
      .from('evaluations')
      .delete()
      .is('exit_reason', null);

    // Evaluate
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
      }));

    const evalResults = evaluateSignals(signalsToEval, data);

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
