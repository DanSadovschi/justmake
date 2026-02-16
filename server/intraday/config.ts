/**
 * Config — LONG only, single 1H timeframe, 3 strategies.
 */

export type StrategyType = 'pullback' | 'breakout' | 'momentum';

export interface Config {
  symbol: string;
  interval: '1h';
  strategy: StrategyType;

  // EMAs
  emaFast: number;        // 20
  emaSlow: number;        // 50
  emaTrend: number;       // 200

  // RSI
  rsiPeriod: number;      // 14
  rsiMin: number;         // 40
  rsiMax: number;         // 60

  // ATR
  atrPeriod: number;      // 14
  slAtrMultiple: number;  // 2.0 × ATR for stop loss

  // Pullback-specific
  pullbackMaxPct: number; // 1.5% — max distance from EMA20

  // Breakout-specific
  breakoutPeriod: number; // 20 — lookback for highest high
  breakoutVolMult: number; // 1.2 — min volume vs SMA

  // Risk
  riskPerTrade: number;   // 0.01 = 1%
  minRiskReward: number;  // 2.0 = min 1:2 R:R

  // Trailing
  trailActivateR: number;   // 1.0 — activate after +1R
  trailAtrMultiple: number; // 1.0 — trail by 1×ATR

  // Limits
  maxHoldBars: number;    // 48 = 2 days on 1H
  cooldownBars: number;   // 6 = 6 hours
  minConfidence: number;  // 50

  // Fees
  feeRate: number;        // 0.001 = 0.1% per side

  // Backtest
  initialCapital: number;
  lookbackDays: number;
}

export const DEFAULT_CONFIG: Config = {
  symbol: 'BTCUSDT',
  interval: '1h',
  strategy: 'breakout',

  emaFast: 20,
  emaSlow: 50,
  emaTrend: 200,

  rsiPeriod: 14,
  rsiMin: 40,
  rsiMax: 60,

  atrPeriod: 14,
  slAtrMultiple: 2.0,

  pullbackMaxPct: 1.5,

  breakoutPeriod: 20,
  breakoutVolMult: 1.2,

  riskPerTrade: 0.01,
  minRiskReward: 2.0,

  trailActivateR: 1.0,
  trailAtrMultiple: 1.0,

  maxHoldBars: 48,
  cooldownBars: 6,
  minConfidence: 50,

  feeRate: 0.001,

  initialCapital: 10_000,
  lookbackDays: 365,
};
