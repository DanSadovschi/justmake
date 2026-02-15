/**
 * Risk Management Module.
 *
 * Responsibilities:
 *   - Position sizing (risk 1% of capital per trade)
 *   - Stop loss placement (1.5 × ATR)
 *   - Trailing stop management (activate after +1R, trail by 1 × ATR)
 *   - Fee calculation
 *   - Funding fee calculation (perpetual only)
 */

import type { IntradayConfig } from './config.js';
import type { Direction, ExitReason } from './types.js';

// ────────────────────── Position Sizing ──────────────────────

export interface PositionSize {
  positionSizeUsd: number;  // total position value in USD
  qty: number;              // quantity in base asset (BTC)
  riskUsd: number;          // dollar risk per trade
}

/**
 * Calculate position size based on fixed-percentage risk.
 * Risk = riskPerTrade × capital.
 * Position size = risk / |entry - stop| × entry.
 */
export function calculatePositionSize(
  capital: number,
  entryPrice: number,
  stopLoss: number,
  cfg: IntradayConfig,
): PositionSize {
  const riskUsd = capital * cfg.riskPerTrade;
  const riskPerUnit = Math.abs(entryPrice - stopLoss);

  if (riskPerUnit <= 0) {
    return { positionSizeUsd: 0, qty: 0, riskUsd };
  }

  const qty = riskUsd / riskPerUnit;
  const positionSizeUsd = qty * entryPrice;

  return { positionSizeUsd, qty, riskUsd };
}

// ────────────────────── Fee Calculation ──────────────────────

/** Round-trip fee for entry + exit. */
export function calculateFees(
  positionSizeUsd: number,
  cfg: IntradayConfig,
): number {
  return positionSizeUsd * cfg.feeRate * 2; // entry + exit
}

/**
 * Calculate funding fees for perpetual contracts.
 * Funding is charged every 8 hours.
 * For simplicity: count how many 8h boundaries the position crosses.
 */
export function calculateFunding(
  positionSizeUsd: number,
  entryTime: number,
  exitTime: number,
  direction: Direction,
  cfg: IntradayConfig,
): number {
  if (cfg.marketType !== 'perpetual') return 0;

  const EIGHT_HOURS = 8 * 60 * 60 * 1000;
  const entrySlot = Math.floor(entryTime / EIGHT_HOURS);
  const exitSlot = Math.floor(exitTime / EIGHT_HOURS);
  const periods = Math.max(0, exitSlot - entrySlot);

  // Long pays funding, short receives (in a positive funding rate environment)
  // Simplified: longs pay, shorts receive the same rate
  const sign = direction === 'LONG' ? 1 : -1;
  return positionSizeUsd * cfg.fundingRate8h * periods * sign;
}

// ────────────────────── Exit Management ──────────────────────

export interface OpenPosition {
  direction: Direction;
  strategy: 'trend_pullback' | 'mean_reversion';
  entryPrice: number;
  entryTime: number;
  entryIdx: number;
  stopLoss: number;
  atr: number;
  positionSizeUsd: number;
  qty: number;
  riskUsd: number;
  regime: 'LONG' | 'SHORT' | 'RANGE' | 'NEUTRAL';
  confidence: number;
  reasoning: Record<string, unknown>;
  // Trailing stop state
  peakPrice: number;       // best favorable price seen
  trailActive: boolean;
  trailStop: number;
  // Tracking
  maxAdverse: number;      // worst adverse move (negative for long)
  maxFavorable: number;    // best favorable move
}

export interface ExitCheck {
  shouldExit: boolean;
  reason: ExitReason;
  exitPrice: number;
}

/**
 * Check all exit conditions for an open position against the current candle.
 * Order of priority: stop loss → trailing stop → MR targets → opposite regime → timeout.
 *
 * Uses intra-candle high/low for stop detection (realistic fill).
 */
export function checkExits(
  pos: OpenPosition,
  candleHigh: number,
  candleLow: number,
  candleClose: number,
  currentRsi: number,
  currentRegime: 'LONG' | 'SHORT' | 'RANGE' | 'NEUTRAL',
  candleIdx: number,
  cfg: IntradayConfig,
): ExitCheck | null {
  const isLong = pos.direction === 'LONG';

  // ── 1. Stop Loss ──
  if (isLong && candleLow <= pos.stopLoss) {
    return { shouldExit: true, reason: 'stop_loss', exitPrice: pos.stopLoss };
  }
  if (!isLong && candleHigh >= pos.stopLoss) {
    return { shouldExit: true, reason: 'stop_loss', exitPrice: pos.stopLoss };
  }

  // ── 2. Trailing Stop ──
  if (pos.trailActive) {
    if (isLong && candleLow <= pos.trailStop) {
      return { shouldExit: true, reason: 'trailing_stop', exitPrice: pos.trailStop };
    }
    if (!isLong && candleHigh >= pos.trailStop) {
      return { shouldExit: true, reason: 'trailing_stop', exitPrice: pos.trailStop };
    }
  }

  // ── 3. Mean Reversion Exits ──
  if (pos.strategy === 'mean_reversion') {
    // RSI exit: RSI returns to 50
    if (isLong && currentRsi >= cfg.mrRsiExit) {
      return { shouldExit: true, reason: 'mr_rsi_exit', exitPrice: candleClose };
    }
    if (!isLong && currentRsi <= cfg.mrRsiExit) {
      return { shouldExit: true, reason: 'mr_rsi_exit', exitPrice: candleClose };
    }

    // R-multiple target
    const initialRisk = Math.abs(pos.entryPrice - pos.stopLoss);
    const targetPrice = isLong
      ? pos.entryPrice + cfg.mrTargetR * initialRisk
      : pos.entryPrice - cfg.mrTargetR * initialRisk;

    if (isLong && candleHigh >= targetPrice) {
      return { shouldExit: true, reason: 'mr_target', exitPrice: targetPrice };
    }
    if (!isLong && candleLow <= targetPrice) {
      return { shouldExit: true, reason: 'mr_target', exitPrice: targetPrice };
    }
  }

  // ── 4. Opposite Regime ──
  if (isLong && currentRegime === 'SHORT') {
    return { shouldExit: true, reason: 'opposite_regime', exitPrice: candleClose };
  }
  if (!isLong && currentRegime === 'LONG') {
    return { shouldExit: true, reason: 'opposite_regime', exitPrice: candleClose };
  }

  // ── 5. Timeout ──
  const holdCandles = candleIdx - pos.entryIdx;
  if (holdCandles >= cfg.maxHoldCandles) {
    return { shouldExit: true, reason: 'timeout', exitPrice: candleClose };
  }

  return null;
}

/**
 * Update trailing stop state after processing a candle.
 * Call this AFTER exit checks (only if position is still open).
 */
export function updateTrailingStop(pos: OpenPosition, candleHigh: number, candleLow: number, cfg: IntradayConfig): void {
  const isLong = pos.direction === 'LONG';
  const initialRisk = Math.abs(pos.entryPrice - pos.stopLoss);

  if (isLong) {
    if (candleHigh > pos.peakPrice) pos.peakPrice = candleHigh;

    // Activate trailing after +1R
    const unrealizedR = (pos.peakPrice - pos.entryPrice) / initialRisk;
    if (!pos.trailActive && unrealizedR >= cfg.trailActivateR) {
      pos.trailActive = true;
    }

    if (pos.trailActive) {
      const newStop = pos.peakPrice - cfg.trailAtrMultiple * pos.atr;
      if (newStop > pos.trailStop) pos.trailStop = newStop;
      // Trail stop can never be below original stop loss
      if (pos.trailStop < pos.stopLoss) pos.trailStop = pos.stopLoss;
    }

    // Track max adverse / favorable
    const advPct = ((candleLow - pos.entryPrice) / pos.entryPrice) * 100;
    const favPct = ((candleHigh - pos.entryPrice) / pos.entryPrice) * 100;
    if (advPct < pos.maxAdverse) pos.maxAdverse = advPct;
    if (favPct > pos.maxFavorable) pos.maxFavorable = favPct;
  } else {
    // SHORT position
    if (candleLow < pos.peakPrice) pos.peakPrice = candleLow;

    const unrealizedR = (pos.entryPrice - pos.peakPrice) / initialRisk;
    if (!pos.trailActive && unrealizedR >= cfg.trailActivateR) {
      pos.trailActive = true;
    }

    if (pos.trailActive) {
      const newStop = pos.peakPrice + cfg.trailAtrMultiple * pos.atr;
      if (newStop < pos.trailStop) pos.trailStop = newStop;
      if (pos.trailStop > pos.stopLoss) pos.trailStop = pos.stopLoss;
    }

    const advPct = ((pos.entryPrice - candleHigh) / pos.entryPrice) * 100;
    const favPct = ((pos.entryPrice - candleLow) / pos.entryPrice) * 100;
    if (advPct < pos.maxAdverse) pos.maxAdverse = advPct;
    if (favPct > pos.maxFavorable) pos.maxFavorable = favPct;
  }
}
