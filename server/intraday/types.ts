/**
 * Simplified types — LONG only, single timeframe.
 */

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ExitReason = 'stop_loss' | 'trailing_stop' | 'timeout';

export interface Signal {
  entryZone: number;
  stopLoss: number;
  takeProfit: number;
  atr: number;
  confidence: number;
  reasoning: Record<string, unknown>;
}

export interface Trade {
  id: number;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  rMultiple: number;
  holdBars: number;
  exitReason: ExitReason;
}

export interface Metrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  totalPnl: number;
  avgRMultiple: number;
  maxConsecutiveLosses: number;
  expectancy: number;
  avgHoldBars: number;
  exitReasons: Record<string, number>;
}

export interface Indicators {
  ema20: number[];
  ema50: number[];
  ema200: number[];
  rsi14: number[];
  atr14: number[];
  volumeSma20: number[];
}

export interface BacktestResult {
  trades: Trade[];
  metrics: Metrics;
  equity: { time: number; equity: number; drawdownPct: number }[];
}
