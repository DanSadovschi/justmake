/**
 * Market Regime Detection Module (HTF).
 *
 * Uses higher-timeframe candles to determine directional bias:
 *   LONG  — EMA50 > EMA200, EMA50 slope positive, ADX > threshold
 *   SHORT — EMA50 < EMA200, EMA50 slope negative, ADX > threshold
 *   RANGE — ADX < range threshold
 *   NEUTRAL — ADX between range and trend thresholds (no trading)
 */

import type { IntradayConfig } from './config.js';
import type { Candle, Regime, RegimePoint } from './types.js';
import { emaClose, adx as calcAdx } from './indicators.js';

/**
 * Compute regime for every HTF candle.
 * Returns an array aligned with htfCandles.
 */
export function computeRegimes(
  htfCandles: Candle[],
  cfg: IntradayConfig,
): RegimePoint[] {
  const n = htfCandles.length;
  const ema50 = emaClose(htfCandles, cfg.htfEmaFast);
  const ema200 = emaClose(htfCandles, cfg.htfEmaSlow);
  const { adx: adxArr } = calcAdx(htfCandles, cfg.htfAdxPeriod);

  const regimes: RegimePoint[] = [];

  for (let i = 0; i < n; i++) {
    // EMA50 slope: positive if current EMA50 > EMA50 N bars ago
    const slopeRef = Math.max(0, i - cfg.htfEmaSlopeBars);
    const slope = ema50[i] - ema50[slopeRef];

    let regime: Regime;

    if (adxArr[i] < cfg.adxRangeThreshold) {
      regime = 'RANGE';
    } else if (adxArr[i] < cfg.adxTrendThreshold) {
      // Dead zone between 18–20 — no trading
      regime = 'NEUTRAL';
    } else if (ema50[i] > ema200[i] && slope > 0) {
      regime = 'LONG';
    } else if (ema50[i] < ema200[i] && slope < 0) {
      regime = 'SHORT';
    } else {
      // ADX > threshold but EMAs don't confirm direction
      regime = 'NEUTRAL';
    }

    regimes.push({
      openTime: htfCandles[i].openTime,
      regime,
      ema50: ema50[i],
      ema200: ema200[i],
      adx: adxArr[i],
      ema50Slope: slope,
    });
  }

  return regimes;
}

/**
 * For a given LTF candle timestamp, find the last CLOSED HTF regime.
 * The current (unclosed) HTF candle is excluded — no lookahead.
 */
export function getRegimeAtTime(
  regimes: RegimePoint[],
  ltfOpenTime: number,
  htfIntervalMs: number,
): RegimePoint | null {
  // The HTF candle that contains this LTF candle is:
  //   currentHtfOpen = floor(ltfOpenTime / htfIntervalMs) * htfIntervalMs
  // The last CLOSED HTF candle opened before currentHtfOpen.
  const currentHtfOpen = Math.floor(ltfOpenTime / htfIntervalMs) * htfIntervalMs;

  // Binary search for the last regime with openTime < currentHtfOpen
  let lo = 0, hi = regimes.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (regimes[mid].openTime < currentHtfOpen) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result >= 0 ? regimes[result] : null;
}
