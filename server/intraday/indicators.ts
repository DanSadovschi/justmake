/**
 * Technical indicator calculations — pure functions, no side effects.
 *
 * Conventions:
 *   - All functions return arrays aligned with the input (same length).
 *   - Warmup values where data is insufficient are filled with reasonable defaults.
 *   - Wilder's smoothing is used for ATR (industry standard).
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

// ────────────────────── Volume SMA ──────────────────────

export function volumeSma(candles: Candle[], period = 20): number[] {
  return sma(candles.map(c => c.volume), period);
}

// ────────────────────── ADX ──────────────────────

/**
 * Average Directional Index — trend strength (0–100).
 * Wilder's smoothing. Higher = stronger trend (direction-agnostic).
 */
export function adx(candles: Candle[], period: number = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(0);
  if (n < period * 2 + 1) return out;

  // +DM, -DM, TR
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hpc, lpc);
  }

  // Wilder's smoothing for first period
  let sPlusDM = 0, sMinusDM = 0, sTR = 0;
  for (let i = 1; i <= period; i++) {
    sPlusDM += plusDM[i];
    sMinusDM += minusDM[i];
    sTR += tr[i];
  }

  // DX series
  const dx: number[] = new Array(n).fill(0);
  const calcDx = (): number => {
    const pDI = sTR > 0 ? (sPlusDM / sTR) * 100 : 0;
    const mDI = sTR > 0 ? (sMinusDM / sTR) * 100 : 0;
    const sum = pDI + mDI;
    return sum > 0 ? (Math.abs(pDI - mDI) / sum) * 100 : 0;
  };

  dx[period] = calcDx();
  for (let i = period + 1; i < n; i++) {
    sPlusDM = sPlusDM - sPlusDM / period + plusDM[i];
    sMinusDM = sMinusDM - sMinusDM / period + minusDM[i];
    sTR = sTR - sTR / period + tr[i];
    dx[i] = calcDx();
  }

  // ADX = Wilder's smoothed DX
  let adxSum = 0;
  for (let i = period; i < period * 2; i++) adxSum += dx[i];
  out[period * 2 - 1] = adxSum / period;
  for (let i = period * 2; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
  }
  // Backfill warmup with first valid value
  const firstValid = out[period * 2 - 1];
  for (let i = 0; i < period * 2 - 1; i++) out[i] = firstValid;

  return out;
}

// ────────────────────── MACD ──────────────────────

/**
 * MACD — Moving Average Convergence Divergence.
 * Returns { line, signal, histogram } arrays aligned with input.
 */
export function macd(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { line: number[]; signal: number[]; histogram: number[] } {
  const closes = candles.map(c => c.close);
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const line = fastEma.map((f, i) => f - slowEma[i]);
  const signal = ema(line, signalPeriod);
  const histogram = line.map((l, i) => l - signal[i]);
  return { line, signal, histogram };
}

// ────────────────────── Bollinger Bands ──────────────────────

/**
 * Bollinger Bands — middle (SMA), upper/lower (±stdDev), bandwidth %.
 */
export function bollingerBands(
  candles: Candle[],
  period = 20,
  stdDevMult = 2,
): { upper: number[]; middle: number[]; lower: number[]; width: number[] } {
  const closes = candles.map(c => c.close);
  const n = closes.length;
  const middle = sma(closes, period);
  const upper: number[] = new Array(n);
  const lower: number[] = new Array(n);
  const width: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const len = Math.min(i + 1, period);
    const start = Math.max(0, i - period + 1);
    let sumSq = 0;
    for (let j = start; j <= i; j++) {
      const diff = closes[j] - middle[i];
      sumSq += diff * diff;
    }
    const sd = Math.sqrt(sumSq / len);
    upper[i] = middle[i] + stdDevMult * sd;
    lower[i] = middle[i] - stdDevMult * sd;
    width[i] = middle[i] > 0 ? ((upper[i] - lower[i]) / middle[i]) * 100 : 0;
  }

  return { upper, middle, lower, width };
}

// ────────────────────── Stochastic RSI ──────────────────────

/**
 * Stochastic RSI — applies stochastic oscillator to RSI values.
 * K = smoothed stochastic of RSI, D = smoothed K.
 * Returns values 0–100.
 */
export function stochRsi(
  candles: Candle[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
): { k: number[]; d: number[] } {
  const rsiValues = rsi(candles, rsiPeriod);
  const n = rsiValues.length;
  const rawK: number[] = new Array(n).fill(50);

  for (let i = stochPeriod - 1; i < n; i++) {
    let minR = Infinity, maxR = -Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsiValues[j] < minR) minR = rsiValues[j];
      if (rsiValues[j] > maxR) maxR = rsiValues[j];
    }
    const range = maxR - minR;
    rawK[i] = range > 0 ? ((rsiValues[i] - minR) / range) * 100 : 50;
  }

  const k = sma(rawK, kSmooth);
  const d = sma(k, kSmooth);
  return { k, d };
}
