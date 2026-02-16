/**
 * Three strategies: Pullback, Breakout, Momentum.
 * All LONG only. Entry at NEXT candle open. No lookahead.
 */

import type { Config } from './config.js';
import type { Candle, Indicators, Signal } from './types.js';

// ── Dispatcher ──

export function checkSignal(
  candles: Candle[],
  ind: Indicators,
  idx: number,
  cfg: Config,
): Signal | null {
  switch (cfg.strategy) {
    case 'pullback':  return checkPullback(candles, ind, idx, cfg);
    case 'breakout':  return checkBreakout(candles, ind, idx, cfg);
    case 'momentum':  return checkMomentum(candles, ind, idx, cfg);
  }
}

// ══════════════════════════════════════════════════════════
// 1. EMA PULLBACK
//    Price > EMA200, EMA20 > EMA50, low touches EMA20 zone,
//    close bounces above EMA20, RSI neutral, close > prev high.
// ══════════════════════════════════════════════════════════

function checkPullback(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < 2) return null;
  const curr = candles[idx];
  const prev = candles[idx - 1];
  const ema20 = ind.ema20[idx], ema50 = ind.ema50[idx], ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx], atrVal = ind.atr14[idx];

  if (curr.close <= ema200) return null;
  if (ema20 <= ema50) return null;

  const lowToEma = ((curr.low - ema20) / ema20) * 100;
  if (lowToEma > cfg.pullbackMaxPct || lowToEma < -cfg.pullbackMaxPct) return null;
  if (curr.close <= ema20) return null;
  if (rsiVal < cfg.rsiMin || rsiVal > cfg.rsiMax) return null;
  if (curr.close <= prev.high) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// 2. BREAKOUT
//    Price breaks above highest high of last N bars.
//    Volume > X × average. Price > EMA200.
//    RSI not overbought (< rsiMax).
// ══════════════════════════════════════════════════════════

function checkBreakout(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < cfg.breakoutPeriod + 1) return null;
  const curr = candles[idx];
  const ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx], atrVal = ind.atr14[idx];

  // Trend filter
  if (curr.close <= ema200) return null;

  // RSI not overbought
  if (rsiVal > cfg.rsiMax) return null;

  // Find highest high in lookback (excluding current bar)
  let hh = -Infinity;
  for (let i = idx - cfg.breakoutPeriod; i < idx; i++) {
    if (candles[i].high > hh) hh = candles[i].high;
  }

  // Close must break above the high
  if (curr.close <= hh) return null;

  // Volume confirmation
  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 1;
  if (volRatio < cfg.breakoutVolMult) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// 3. EMA MOMENTUM (Cross)
//    EMA20 crosses above EMA50 (was below prev bar, now above).
//    Price > EMA200. Volume above average.
//    RSI > 50 but < rsiMax (momentum but not exhausted).
// ══════════════════════════════════════════════════════════

function checkMomentum(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < 2) return null;
  const curr = candles[idx];
  const ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx], atrVal = ind.atr14[idx];

  // Trend filter
  if (curr.close <= ema200) return null;

  // EMA cross: ema20 was <= ema50 on prev bar, now ema20 > ema50
  const crossedUp = ind.ema20[idx - 1] <= ind.ema50[idx - 1] && ind.ema20[idx] > ind.ema50[idx];
  if (!crossedUp) return null;

  // RSI momentum zone (above 50 but not overbought)
  if (rsiVal <= 50 || rsiVal > cfg.rsiMax) return null;

  // Volume confirmation
  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 1;
  if (volRatio < 1.0) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// Shared: build signal + confidence
// ══════════════════════════════════════════════════════════

function buildSignal(
  curr: Candle, ind: Indicators, idx: number, atrVal: number, cfg: Config,
): Signal | null {
  const stopLoss = curr.close - cfg.slAtrMultiple * atrVal;
  const risk = curr.close - stopLoss;
  if (risk <= 0) return null;
  const takeProfit = curr.close + risk * cfg.minRiskReward;

  const confidence = computeConfidence(curr, ind, idx);

  return {
    entryZone: rd(curr.close),
    stopLoss: rd(stopLoss),
    takeProfit: rd(takeProfit),
    atr: rd(atrVal),
    confidence,
    reasoning: {
      strategy: cfg.strategy,
      ema20: rd(ind.ema20[idx]),
      ema50: rd(ind.ema50[idx]),
      ema200: rd(ind.ema200[idx]),
      rsi: rd(ind.rsi14[idx]),
      atr: rd(atrVal),
      rr: `1:${cfg.minRiskReward}`,
    },
  };
}

function computeConfidence(candle: Candle, ind: Indicators, idx: number): number {
  let score = 0;

  const spread = Math.abs(ind.ema20[idx] - ind.ema50[idx]) / ind.ema50[idx] * 100;
  if (spread > 2.0) score += 30;
  else if (spread > 1.0) score += 20;
  else if (spread > 0.3) score += 10;

  const rsi = ind.rsi14[idx];
  if (rsi >= 45 && rsi <= 65) score += 30;
  else if (rsi >= 35 && rsi <= 70) score += 20;
  else score += 10;

  const volRatio = ind.volumeSma20[idx] > 0 ? candle.volume / ind.volumeSma20[idx] : 1;
  if (volRatio >= 1.5) score += 20;
  else if (volRatio >= 1.0) score += 10;

  const atrPct = (ind.atr14[idx] / ind.ema20[idx]) * 100;
  if (atrPct >= 0.3 && atrPct <= 2.0) score += 20;
  else score += 5;

  return Math.min(100, score);
}

function rd(v: number): number {
  return Math.round(v * 100) / 100;
}
