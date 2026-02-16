/**
 * Signal Generation Module (LTF).
 *
 * Two strategies:
 *   1. Trend Pullback — active when HTF regime is LONG or SHORT
 *   2. Mean Reversion — active when HTF regime is RANGE
 *
 * All conditions evaluated on CLOSED candles only.
 * Entry at next candle's open — no lookahead.
 */

import type { IntradayConfig } from './config.js';
import type { Candle, Direction, LtfIndicators, PendingSignal, Regime } from './types.js';

// ────────────────────── Trend Pullback ──────────────────────

/**
 * Trend Pullback LONG:
 *   1. HTF bias = LONG
 *   2. LTF: EMA20 > EMA50 (local trend alignment)
 *   3. Candle's low touched or came within pullbackMaxPct of EMA20
 *   4. RSI in neutral zone (40–60) — not overbought
 *   5. Close > previous candle's high (bounce confirmation)
 *
 * Trend Pullback SHORT:
 *   Mirror conditions.
 */
export function checkTrendPullback(
  candles: Candle[],
  ind: LtfIndicators,
  idx: number,
  regime: Regime,
  cfg: IntradayConfig,
): PendingSignal | null {
  if (idx < 2) return null;
  if (regime !== 'LONG' && regime !== 'SHORT') return null;

  const curr = candles[idx];
  const prev = candles[idx - 1];
  const ema20 = ind.ema20[idx];
  const ema50 = ind.ema50[idx];

  if (regime === 'LONG') {
    // Local trend: EMA20 > EMA50
    if (ema20 <= ema50) return null;

    // Pullback: candle's low came close to EMA20 from above
    // Distance = how far the low is from EMA20 (as % of EMA20)
    const lowToEma = ((curr.low - ema20) / ema20) * 100;

    // Low should be within [-maxPct, +maxPct] of EMA20
    // Negative = dipped below EMA20 slightly, Positive = stayed above
    if (lowToEma > cfg.pullbackMaxPct) return null;   // didn't pull back enough
    if (lowToEma < -cfg.pullbackMaxPct) return null;   // broke too far below

    // Close must be ABOVE EMA20 (bounce back up)
    if (curr.close <= ema20) return null;

    // RSI in neutral zone
    if (ind.rsi14[idx] < cfg.tpRsiMin || ind.rsi14[idx] > cfg.tpRsiMax) return null;

    // Confirmation: close > previous candle's high
    if (curr.close <= prev.high) return null;

    // Stop loss: 2.0 × ATR below entry
    const atr = ind.atr14[idx];
    const stop = curr.close - cfg.slAtrMultiple * atr;

    const confidence = computeConfidence(candles, ind, idx, 'LONG', cfg);

    return {
      direction: 'LONG',
      strategy: 'trend_pullback',
      stopLoss: stop,
      atr,
      regime,
      confidence,
      reasoning: {
        strategy: 'trend_pullback',
        direction: 'LONG',
        ema20: r(ema20),
        ema50: r(ema50),
        rsi: r(ind.rsi14[idx]),
        pullbackPct: r(lowToEma),
        atr: r(atr),
        close: r(curr.close),
        prevHigh: r(prev.high),
      },
    };
  }

  if (regime === 'SHORT') {
    if (ema20 >= ema50) return null;

    // Pullback: candle's high came close to EMA20 from below
    const highToEma = ((ema20 - curr.high) / ema20) * 100;

    if (highToEma > cfg.pullbackMaxPct) return null;
    if (highToEma < -cfg.pullbackMaxPct) return null;

    // Close must be BELOW EMA20
    if (curr.close >= ema20) return null;

    if (ind.rsi14[idx] < cfg.tpRsiMin || ind.rsi14[idx] > cfg.tpRsiMax) return null;

    // Confirmation: close < previous candle's low
    if (curr.close >= prev.low) return null;

    const atr = ind.atr14[idx];
    const stop = curr.close + cfg.slAtrMultiple * atr;

    const confidence = computeConfidence(candles, ind, idx, 'SHORT', cfg);

    return {
      direction: 'SHORT',
      strategy: 'trend_pullback',
      stopLoss: stop,
      atr,
      regime,
      confidence,
      reasoning: {
        strategy: 'trend_pullback',
        direction: 'SHORT',
        ema20: r(ema20),
        ema50: r(ema50),
        rsi: r(ind.rsi14[idx]),
        pullbackPct: r(highToEma),
        atr: r(atr),
        close: r(curr.close),
        prevLow: r(prev.low),
      },
    };
  }

  return null;
}

// ────────────────────── Mean Reversion ──────────────────────

/**
 * Mean Reversion LONG:
 *   - RSI < 25 (deeply oversold)
 *   - Close below lower Bollinger Band
 *   - Volume > 1.2 × SMA(20) volume (conviction)
 *
 * Mean Reversion SHORT:
 *   Mirror conditions.
 */
export function checkMeanReversion(
  candles: Candle[],
  ind: LtfIndicators,
  idx: number,
  regime: Regime,
  cfg: IntradayConfig,
): PendingSignal | null {
  if (regime !== 'RANGE') return null;

  const curr = candles[idx];
  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 0;

  // LONG mean reversion
  if (ind.rsi14[idx] < cfg.mrRsiOversold &&
      curr.close < ind.bbLower[idx] &&
      volRatio > 1.2) {
    const atr = ind.atr14[idx];
    const stop = curr.close - cfg.slAtrMultiple * atr;
    const confidence = computeConfidence(candles, ind, idx, 'LONG', cfg);
    return {
      direction: 'LONG',
      strategy: 'mean_reversion',
      stopLoss: stop,
      atr,
      regime,
      confidence,
      reasoning: {
        strategy: 'mean_reversion',
        direction: 'LONG',
        rsi: r(ind.rsi14[idx]),
        bbLower: r(ind.bbLower[idx]),
        close: r(curr.close),
        volumeRatio: r(volRatio),
      },
    };
  }

  // SHORT mean reversion
  if (ind.rsi14[idx] > cfg.mrRsiOverbought &&
      curr.close > ind.bbUpper[idx] &&
      volRatio > 1.2) {
    const atr = ind.atr14[idx];
    const stop = curr.close + cfg.slAtrMultiple * atr;
    const confidence = computeConfidence(candles, ind, idx, 'SHORT', cfg);
    return {
      direction: 'SHORT',
      strategy: 'mean_reversion',
      stopLoss: stop,
      atr,
      regime,
      confidence,
      reasoning: {
        strategy: 'mean_reversion',
        direction: 'SHORT',
        rsi: r(ind.rsi14[idx]),
        bbUpper: r(ind.bbUpper[idx]),
        close: r(curr.close),
        volumeRatio: r(volRatio),
      },
    };
  }

  return null;
}

// ────────────────────── Confidence Scoring ──────────────────────

/**
 * Unified confidence score (0–100).
 * Uses actual candle data + indicators.
 */
function computeConfidence(
  candles: Candle[],
  ind: LtfIndicators,
  idx: number,
  dir: Direction,
  cfg: IntradayConfig,
): number {
  let score = 0;
  const curr = candles[idx];

  // ── EMA spread strength (0–25) ──
  const spread = Math.abs(ind.ema20[idx] - ind.ema50[idx]) / ind.ema50[idx] * 100;
  if (spread > 2.0) score += 25;
  else if (spread > 1.0) score += 18;
  else if (spread > 0.3) score += 10;

  // ── RSI positioning (0–25) ──
  const rsi = ind.rsi14[idx];
  if (dir === 'LONG') {
    if (rsi >= 40 && rsi <= 55) score += 25;        // sweet spot for long
    else if (rsi >= cfg.tpRsiMin && rsi <= cfg.tpRsiMax) score += 15;
  } else {
    if (rsi >= 45 && rsi <= 60) score += 25;
    else if (rsi >= cfg.tpRsiMin && rsi <= cfg.tpRsiMax) score += 15;
  }

  // ── Volume confirmation (0–25) ──
  const volRatio = ind.volumeSma20[idx] > 0 ? curr.volume / ind.volumeSma20[idx] : 1;
  if (volRatio >= 2.0) score += 25;
  else if (volRatio >= 1.5) score += 20;
  else if (volRatio >= 1.0) score += 10;

  // ── ATR / volatility (0–25) ──
  const atrPct = (ind.atr14[idx] / ind.ema20[idx]) * 100;
  if (atrPct >= 0.3 && atrPct <= 2.0) score += 25;   // moderate vol = best
  else if (atrPct < 0.3) score += 5;                   // too quiet
  else score += 10;                                     // high vol ok but risky

  return Math.min(100, score);
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}
