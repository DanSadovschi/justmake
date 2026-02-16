/**
 * Seven strategies: Pullback, Breakout, Momentum, Momentum+ADX, MACD Zero, BBand Squeeze, Scoring.
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
    case 'pullback':      return checkPullback(candles, ind, idx, cfg);
    case 'breakout':      return checkBreakout(candles, ind, idx, cfg);
    case 'momentum':      return checkMomentum(candles, ind, idx, cfg);
    case 'momentum_adx':  return checkMomentumAdx(candles, ind, idx, cfg);
    case 'macd_zero':     return checkMacdZero(candles, ind, idx, cfg);
    case 'bband_squeeze': return checkBbandSqueeze(candles, ind, idx, cfg);
    case 'scoring':       return checkScoring(candles, ind, idx, cfg);
  }
}

// ── Shared: EMA200 trend gate ──

function trendGate(close: number, ema200: number, cfg: Config): boolean {
  return !cfg.useEma200Filter || close > ema200;
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

  if (!trendGate(curr.close, ema200, cfg)) return null;
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

  if (!trendGate(curr.close, ema200, cfg)) return null;
  if (rsiVal > cfg.rsiMax) return null;

  let hh = -Infinity;
  for (let i = idx - cfg.breakoutPeriod; i < idx; i++) {
    if (candles[i].high > hh) hh = candles[i].high;
  }
  if (curr.close <= hh) return null;

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

  if (!trendGate(curr.close, ema200, cfg)) return null;

  const crossedUp = ind.ema20[idx - 1] <= ind.ema50[idx - 1] && ind.ema20[idx] > ind.ema50[idx];
  if (!crossedUp) return null;

  if (rsiVal <= 50 || rsiVal > cfg.rsiMax) return null;

  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 1;
  if (volRatio < 1.0) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// 4. MOMENTUM + ADX
//    Same EMA cross as momentum, but only in strong trends
//    (ADX above threshold). Filters out choppy regimes.
// ══════════════════════════════════════════════════════════

function checkMomentumAdx(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < 2) return null;
  const curr = candles[idx];
  const ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx], atrVal = ind.atr14[idx];

  if (!trendGate(curr.close, ema200, cfg)) return null;

  // ADX filter — only trade when trend is strong
  if (ind.adx[idx] < cfg.adxThreshold) return null;

  // EMA cross
  const crossedUp = ind.ema20[idx - 1] <= ind.ema50[idx - 1] && ind.ema20[idx] > ind.ema50[idx];
  if (!crossedUp) return null;

  if (rsiVal <= 50 || rsiVal > cfg.rsiMax) return null;

  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 1;
  if (volRatio < 1.0) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// 5. MACD ZERO-LINE MOMENTUM
//    MACD line crosses above signal line while both > 0.
//    Captures bullish momentum in confirmed uptrends.
//    Price > EMA200. RSI not overbought.
// ══════════════════════════════════════════════════════════

function checkMacdZero(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < 2) return null;
  const curr = candles[idx];
  const ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx], atrVal = ind.atr14[idx];

  if (!trendGate(curr.close, ema200, cfg)) return null;

  // MACD cross: line was <= signal on prev bar, now line > signal
  const crossedUp =
    ind.macdLine[idx - 1] <= ind.macdSignal[idx - 1] &&
    ind.macdLine[idx] > ind.macdSignal[idx];
  if (!crossedUp) return null;

  // MACD line above zero (bullish territory)
  if (ind.macdLine[idx] <= 0) return null;

  if (rsiVal > cfg.rsiMax) return null;

  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 1;
  if (volRatio < 1.0) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// 6. BOLLINGER SQUEEZE BREAKOUT
//    Detects low-volatility squeeze (bandwidth in bottom N percentile
//    of recent 100 bars), then enters on expansion when close breaks
//    above upper band. Classic vol-contraction → expansion setup.
// ══════════════════════════════════════════════════════════

function checkBbandSqueeze(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < 101) return null;
  const curr = candles[idx];
  const ema200 = ind.ema200[idx];
  const rsiVal = ind.rsi14[idx], atrVal = ind.atr14[idx];

  if (!trendGate(curr.close, ema200, cfg)) return null;

  // Calculate bandwidth percentile over last 100 bars
  const widths: number[] = [];
  for (let j = idx - 100; j < idx; j++) widths.push(ind.bbWidth[j]);
  widths.sort((a, b) => a - b);
  const threshold = widths[Math.floor(widths.length * cfg.bbSqueezePctile / 100)];

  // Was in squeeze on previous bar
  if (ind.bbWidth[idx - 1] > threshold) return null;

  // Expansion: current bandwidth above threshold AND close above upper band
  if (ind.bbWidth[idx] <= threshold) return null;
  if (curr.close <= ind.bbUpper[idx]) return null;

  if (rsiVal > cfg.rsiMax) return null;

  return buildSignal(curr, ind, idx, atrVal, cfg);
}

// ══════════════════════════════════════════════════════════
// 7. MULTI-FACTOR SCORING
//    Regime gate: price > EMA200 (toggleable).
//    Five independent factors, each +1 or 0.
//    Enter LONG only if sum >= scoreThreshold.
//    A) Trend direction:  emaFast > emaSlow
//    B) Trend strength:   ADX > adxThreshold
//    C) Momentum safe:    RSI < rsiMax (not overbought)
//    D) Breakout confirm: close > highest high (breakoutPeriod)
//    E) Volatility sane:  ATR% within [minAtrPct, maxAtrPct]
// ══════════════════════════════════════════════════════════

function checkScoring(
  candles: Candle[], ind: Indicators, idx: number, cfg: Config,
): Signal | null {
  if (idx < cfg.breakoutPeriod + 1) return null;
  const curr = candles[idx];
  const ema200 = ind.ema200[idx];
  const atrVal = ind.atr14[idx];

  // Regime gate
  if (!trendGate(curr.close, ema200, cfg)) return null;

  // Factor A: trend direction
  const fA = ind.ema20[idx] > ind.ema50[idx] ? 1 : 0;

  // Factor B: trend strength
  const fB = ind.adx[idx] >= cfg.adxThreshold ? 1 : 0;

  // Factor C: momentum not overextended
  const fC = ind.rsi14[idx] < cfg.rsiMax ? 1 : 0;

  // Factor D: breakout confirmation
  let hh = -Infinity;
  for (let i = idx - cfg.breakoutPeriod; i < idx; i++) {
    if (candles[i].high > hh) hh = candles[i].high;
  }
  const fD = curr.close > hh ? 1 : 0;

  // Factor E: volatility sanity
  const atrPct = atrVal > 0 ? (atrVal / curr.close) * 100 : 0;
  const fE = atrPct >= cfg.minAtrPct && atrPct <= cfg.maxAtrPct ? 1 : 0;

  const total = fA + fB + fC + fD + fE;
  if (total < cfg.scoreThreshold) return null;

  // Build signal with factor breakdown in reasoning
  const stopLoss = curr.close - cfg.slAtrMultiple * atrVal;
  const risk = curr.close - stopLoss;
  if (risk <= 0) return null;
  const takeProfit = curr.close + risk * cfg.minRiskReward;

  return {
    entryZone: rd(curr.close),
    stopLoss: rd(stopLoss),
    takeProfit: rd(takeProfit),
    atr: rd(atrVal),
    confidence: total * 20, // 0-100 scale: 5 factors × 20
    reasoning: {
      strategy: 'scoring',
      score: total,
      scoreThreshold: cfg.scoreThreshold,
      fA_trend: fA, fB_adx: fB, fC_rsi: fC, fD_breakout: fD, fE_atrPct: fE,
      adx: rd(ind.adx[idx]),
      rsi: rd(ind.rsi14[idx]),
      atrPct: rd(atrPct),
      ema200: rd(ema200),
    },
  };
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
