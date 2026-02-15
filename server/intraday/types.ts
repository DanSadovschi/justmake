/**
 * Shared type definitions for the intraday trading system.
 */

// ────────────────────── Market Data ──────────────────────

export interface Candle {
  openTime: number;   // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ────────────────────── Regime ──────────────────────

export type Regime = 'LONG' | 'SHORT' | 'RANGE' | 'NEUTRAL';

export interface RegimePoint {
  openTime: number;
  regime: Regime;
  ema50: number;
  ema200: number;
  adx: number;
  ema50Slope: number;
}

// ────────────────────── Signals & Trades ──────────────────────

export type Direction = 'LONG' | 'SHORT';
export type StrategyType = 'trend_pullback' | 'mean_reversion';

export type ExitReason =
  | 'stop_loss'
  | 'take_profit'
  | 'trailing_stop'
  | 'opposite_regime'
  | 'timeout'
  | 'mr_rsi_exit'
  | 'mr_target';

export interface PendingSignal {
  direction: Direction;
  strategy: StrategyType;
  stopLoss: number;
  atr: number;
  regime: Regime;
  confidence: number;
  reasoning: Record<string, unknown>;
}

export interface Trade {
  id: number;
  direction: Direction;
  strategy: StrategyType;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  stopLoss: number;
  positionSizeUsd: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  fees: number;
  fundingPaid: number;
  rMultiple: number;
  holdCandles: number;
  exitReason: ExitReason;
  regime: Regime;
  maxAdversePct: number;
  maxFavorablePct: number;
}

// ────────────────────── Analytics ──────────────────────

export interface EquityPoint {
  time: number;
  equity: number;
  drawdownPct: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  expectancy: number;
  avgRMultiple: number;
  totalReturnPct: number;
  totalPnl: number;
  avgHoldCandles: number;
  maxConsecutiveLosses: number;
  // Directional breakdown
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  longPnl: number;
  shortPnl: number;
  // Strategy breakdown
  trendTrades: number;
  mrTrades: number;
  trendWinRate: number;
  mrWinRate: number;
  trendPnl: number;
  mrPnl: number;
  // Exit reasons
  exitReasonCounts: Record<string, number>;
}

export interface BacktestResult {
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: PerformanceMetrics;
  config: Record<string, unknown>;
  segment: 'full' | 'in_sample' | 'out_of_sample';
}

// ────────────────────── Indicator Arrays ──────────────────────

export interface LtfIndicators {
  ema20: number[];
  ema50: number[];
  rsi14: number[];
  atr14: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  volumeSma20: number[];
}

export interface HtfIndicators {
  ema50: number[];
  ema200: number[];
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}
