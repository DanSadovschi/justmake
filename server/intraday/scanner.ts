/**
 * Live Signal Scanner — fetches recent data and checks for actionable signal.
 */

import type { Config } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import type { Signal } from './types.js';
import { fetchCandles } from './data-fetcher.js';
import { computeIndicators } from './backtest.js';
import { checkSignal } from './strategy.js';

export interface LiveScanResult {
  timestamp: number;
  signal:
    | (Signal & { active: true })
    | { active: false };
  indicators: {
    price: number;
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    atr: number;
  };
  trendBullish: boolean;
}

export async function scanLiveSignal(
  overrides?: Partial<Config>,
): Promise<LiveScanResult> {
  const cfg: Config = { ...DEFAULT_CONFIG, ...overrides };

  // 60 days of 1H = ~1440 candles, enough for EMA200 warmup
  const candles = await fetchCandles(60, cfg.interval);
  if (candles.length < 210) {
    throw new Error(`Not enough data: ${candles.length} candles (need 210+)`);
  }

  const ind = computeIndicators(candles, cfg);
  const lastIdx = candles.length - 1;
  const last = candles[lastIdx];

  const signal = checkSignal(candles, ind, lastIdx, cfg);
  const hasSignal = signal !== null && signal.confidence >= cfg.minConfidence;

  return {
    timestamp: Date.now(),
    signal: hasSignal && signal
      ? { active: true, ...signal }
      : { active: false },
    indicators: {
      price: r(last.close),
      ema20: r(ind.ema20[lastIdx]),
      ema50: r(ind.ema50[lastIdx]),
      ema200: r(ind.ema200[lastIdx]),
      rsi: r(ind.rsi14[lastIdx]),
      atr: r(ind.atr14[lastIdx]),
    },
    trendBullish: last.close > ind.ema200[lastIdx] && ind.ema20[lastIdx] > ind.ema50[lastIdx],
  };
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}
