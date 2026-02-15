/**
 * Technical indicator calculations — pure functions, no side effects.
 *
 * Conventions:
 *   - All functions return arrays aligned with the input (same length).
 *   - Warmup values where data is insufficient are filled with reasonable defaults.
 *   - Wilder's smoothing is used for ATR and ADX (industry standard).
 */

import type { Candle } from './types.js';

// ────────────────────── EMA ──────────────────────

/** Exponential Moving Average on raw values. Seed = first value. */
export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** EMA on candle closes. */
export function emaClose(candles: Candle[], period: number): number[] {
  return ema(candles.map(c => c.close), period);
}

// ────────────────────── SMA ──────────────────────

/** Simple Moving Average. Uses available data during warmup. */
export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out[i] = sum / Math.min(i + 1, period);
  }
  return out;
}

// ────────────────────── RSI ──────────────────────

/** Wilder-smoothed RSI. Returns 50 during warmup. */
export function rsi(candles: Candle[], period: number = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(50);
  if (n < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < n; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ────────────────────── MACD ──────────────────────

export interface MacdResult {
  line: number[];
  signal: number[];
  histogram: number[];
}

export function macd(
  candles: Candle[],
  fast = 12,
  slow = 26,
  sig = 9,
): MacdResult {
  const closes = candles.map(c => c.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const line = emaFast.map((v, i) => v - emaSlow[i]);
  const signal = ema(line, sig);
  const histogram = line.map((v, i) => v - signal[i]);
  return { line, signal, histogram };
}

// ────────────────────── ATR ──────────────────────

/** True Range for each candle. First candle uses high-low. */
function trueRange(candles: Candle[]): number[] {
  const tr: number[] = new Array(candles.length);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hpc, lpc);
  }
  return tr;
}

/** Average True Range — Wilder's smoothing. */
export function atr(candles: Candle[], period: number = 14): number[] {
  const tr = trueRange(candles);
  const n = candles.length;
  const out: number[] = new Array(n).fill(0);
  if (n < period) {
    // Not enough data — use simple average of available TR
    let s = 0;
    for (let i = 0; i < n; i++) { s += tr[i]; out[i] = s / (i + 1); }
    return out;
  }

  // Seed: SMA of first `period` TR values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;

  // Wilder's smoothing
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }

  // Fill warmup with running average
  let s = 0;
  for (let i = 0; i < period - 1; i++) {
    s += tr[i];
    out[i] = s / (i + 1);
  }
  return out;
}

// ────────────────────── ADX ──────────────────────

export interface AdxResult {
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}

/**
 * Average Directional Index — standard StockCharts calculation.
 *
 * Steps:
 *   1. TR, +DM, -DM for each bar
 *   2. Wilder-smooth TR, +DM, -DM over `period`
 *   3. +DI = smoothed(+DM) / smoothed(TR) × 100
 *   4. DX = |+DI − −DI| / (+DI + −DI) × 100
 *   5. ADX = Wilder-smooth of DX over `period`
 */
export function adx(candles: Candle[], period: number = 14): AdxResult {
  const n = candles.length;
  const adxOut: number[] = new Array(n).fill(0);
  const plusDiOut: number[] = new Array(n).fill(0);
  const minusDiOut: number[] = new Array(n).fill(0);

  if (n < period * 2 + 1) return { adx: adxOut, plusDi: plusDiOut, minusDi: minusDiOut };

  // Step 1: TR, +DM, -DM (from index 1)
  const tr: number[] = [0];
  const plusDm: number[] = [0];
  const minusDm: number[] = [0];

  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const ph = candles[i - 1].high;
    const pl = candles[i - 1].low;
    const pc = candles[i - 1].close;

    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));

    const upMove = h - ph;
    const downMove = pl - l;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Step 2: Wilder-smooth TR, +DM, -DM (first smoothed value at index `period`)
  let sTr = 0, sPdm = 0, sMdm = 0;
  for (let i = 1; i <= period; i++) {
    sTr += tr[i];
    sPdm += plusDm[i];
    sMdm += minusDm[i];
  }

  // Step 3: +DI, -DI, DX
  const dx: number[] = [];

  const computeDi = (idx: number) => {
    const pdi = sTr > 0 ? (sPdm / sTr) * 100 : 0;
    const mdi = sTr > 0 ? (sMdm / sTr) * 100 : 0;
    plusDiOut[idx] = pdi;
    minusDiOut[idx] = mdi;
    const dxVal = (pdi + mdi) > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
    dx.push(dxVal);
  };

  computeDi(period);

  for (let i = period + 1; i < n; i++) {
    sTr = sTr - sTr / period + tr[i];
    sPdm = sPdm - sPdm / period + plusDm[i];
    sMdm = sMdm - sMdm / period + minusDm[i];
    computeDi(i);
  }

  // Step 5: ADX = Wilder-smooth of DX
  // First ADX at index (period + period - 1) = 2*period - 1
  if (dx.length < period) return { adx: adxOut, plusDi: plusDiOut, minusDi: minusDiOut };

  let adxSum = 0;
  for (let i = 0; i < period; i++) adxSum += dx[i];
  let adxVal = adxSum / period;
  adxOut[2 * period - 1] = adxVal;

  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]) / period;
    adxOut[period + i] = adxVal;
  }

  // Forward-fill ADX for indices before 2*period-1
  const firstValid = adxOut[2 * period - 1];
  for (let i = 0; i < 2 * period - 1; i++) adxOut[i] = firstValid;

  return { adx: adxOut, plusDi: plusDiOut, minusDi: minusDiOut };
}

// ────────────────────── Bollinger Bands ──────────────────────

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export function bollingerBands(
  candles: Candle[],
  period = 20,
  mult = 2.0,
): BollingerResult {
  const closes = candles.map(c => c.close);
  const mid = sma(closes, period);
  const upper: number[] = new Array(candles.length);
  const lower: number[] = new Array(candles.length);

  for (let i = 0; i < candles.length; i++) {
    const lookback = Math.min(i + 1, period);
    const start = i - lookback + 1;
    let sumSq = 0;
    for (let j = start; j <= i; j++) {
      sumSq += (closes[j] - mid[i]) ** 2;
    }
    const sd = Math.sqrt(sumSq / lookback);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }

  return { upper, middle: mid, lower };
}

// ────────────────────── Volume SMA ──────────────────────

export function volumeSma(candles: Candle[], period = 20): number[] {
  return sma(candles.map(c => c.volume), period);
}

// ────────────────────── Candle Aggregation ──────────────────────

/**
 * Aggregate lower-timeframe candles into higher-timeframe candles.
 * Groups by `Math.floor(openTime / htfMs) * htfMs`.
 * Only returns groups that have at least `minBarsPerGroup` candles (completeness).
 */
export function aggregateCandles(
  candles: Candle[],
  htfMs: number,
  minBarsPerGroup = 1,
): Candle[] {
  const groups = new Map<number, Candle[]>();

  for (const c of candles) {
    const key = Math.floor(c.openTime / htfMs) * htfMs;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(c);
  }

  return Array.from(groups.entries())
    .filter(([, g]) => g.length >= minBarsPerGroup)
    .sort(([a], [b]) => a - b)
    .map(([key, g]) => ({
      openTime: key,
      open: g[0].open,
      high: Math.max(...g.map(c => c.high)),
      low: Math.min(...g.map(c => c.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((s, c) => s + c.volume, 0),
    }));
}
