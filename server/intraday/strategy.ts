/**
 * Single strategy: EMA Pullback LONG.
 *
 * Conditions (all on CLOSED candle):
 *   1. Price > EMA200 (macro trend bullish)
 *   2. EMA20 > EMA50 (local trend bullish)
 *   3. Candle low pulled back to EMA20 zone (within pullbackMaxPct)
 *   4. Close > EMA20 (bounced back up)
 *   5. RSI 40-60 (neutral — not overbought)
 *   6. Close > prev candle high (confirmation)
 *   7. R:R >= minRiskReward
 *
 * Entry at NEXT candle open. No lookahead.
 */

import type { Config } from './config.js';
import type { Candle, Indicators, Signal } from './types.js';

export function checkSignal(
  candles: Candle[],
  ind: Indicators,
  idx: number,
  cfg: Config,
): Signal | null {
  if (idx < 2) return null;

  const curr = candles[idx];
  const prev = candles[idx - 1];
  const ema20 = ind.ema20[idx];
  const ema50 = ind.ema50[idx];
  const ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx];
  const atrVal = ind.atr14[idx];

  // 1. Macro trend: price above EMA200
  if (curr.close <= ema200) return null;

  // 2. Local trend: EMA20 > EMA50
  if (ema20 <= ema50) return null;

  // 3. Pullback: candle low near EMA20
  const lowToEma = ((curr.low - ema20) / ema20) * 100;
  if (lowToEma > cfg.pullbackMaxPct) return null;   // didn't pull back enough
  if (lowToEma < -cfg.pullbackMaxPct) return null;   // broke too far below

  // 4. Bounce: close above EMA20
  if (curr.close <= ema20) return null;

  // 5. RSI neutral
  if (rsiVal < cfg.rsiMin || rsiVal > cfg.rsiMax) return null;

  // 6. Confirmation: close > prev high
  if (curr.close <= prev.high) return null;

  // 7. Stop loss & risk/reward
  const stopLoss = curr.close - cfg.slAtrMultiple * atrVal;
  const risk = curr.close - stopLoss;
  if (risk <= 0) return null;
  const takeProfit = curr.close + risk * cfg.minRiskReward;

  // Confidence
  const confidence = computeConfidence(curr, ind, idx);

  return {
    entryZone: rd(curr.close),
    stopLoss: rd(stopLoss),
    takeProfit: rd(takeProfit),
    atr: rd(atrVal),
    confidence,
    reasoning: {
      ema20: rd(ema20),
      ema50: rd(ema50),
      ema200: rd(ema200),
      rsi: rd(rsiVal),
      pullbackPct: rd(lowToEma),
      atr: rd(atrVal),
      rr: `1:${cfg.minRiskReward}`,
    },
  };
}

function computeConfidence(
  candle: Candle,
  ind: Indicators,
  idx: number,
): number {
  let score = 0;

  // EMA spread strength (0-30)
  const spread = Math.abs(ind.ema20[idx] - ind.ema50[idx]) / ind.ema50[idx] * 100;
  if (spread > 2.0) score += 30;
  else if (spread > 1.0) score += 20;
  else if (spread > 0.3) score += 10;

  // RSI sweet spot (0-30)
  const rsi = ind.rsi14[idx];
  if (rsi >= 40 && rsi <= 55) score += 30;
  else if (rsi >= 35 && rsi <= 60) score += 20;
  else score += 10;

  // Volume (0-20)
  const volRatio = ind.volumeSma20[idx] > 0 ? candle.volume / ind.volumeSma20[idx] : 1;
  if (volRatio >= 1.5) score += 20;
  else if (volRatio >= 1.0) score += 10;

  // ATR moderate volatility (0-20)
  const atrPct = (ind.atr14[idx] / ind.ema20[idx]) * 100;
  if (atrPct >= 0.3 && atrPct <= 2.0) score += 20;
  else score += 5;

  return Math.min(100, score);
}

function rd(v: number): number {
  return Math.round(v * 100) / 100;
}
