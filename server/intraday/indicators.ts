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
function sma(values: number[], period: number): number[] {
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
