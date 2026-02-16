/**
 * Config — LONG only, 3 strategies, multiple timeframes.
 */

import type { Interval } from './data-fetcher.js';

export type StrategyType = 'pullback' | 'breakout' | 'momentum' | 'momentum_adx' | 'macd_zero' | 'bband_squeeze' | 'scoring';

export interface Config {
  symbol: string;
  interval: Interval;
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

  // ADX
  adxPeriod: number;      // 14
  adxThreshold: number;   // 25 — min ADX for trend strength

  // MACD
  macdFast: number;       // 12
  macdSlow: number;       // 26
  macdSignalPeriod: number; // 9

  // Bollinger
  bbPeriod: number;       // 20
  bbStdDev: number;       // 2
  bbSqueezePctile: number; // 15 — bandwidth percentile for squeeze

  // EMA200 filter
  useEma200Filter: boolean; // true — toggle trend regime filter

  // Scoring strategy
  scoreThreshold: number;  // 3 — min factors required (out of 5)
  minAtrPct: number;       // 0.3 — min ATR as % of price
  maxAtrPct: number;       // 3.0 — max ATR as % of price

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

  adxPeriod: 14,
  adxThreshold: 25,

  macdFast: 12,
  macdSlow: 26,
  macdSignalPeriod: 9,

  bbPeriod: 20,
  bbStdDev: 2,
  bbSqueezePctile: 15,

  useEma200Filter: true,

  scoreThreshold: 3,
  minAtrPct: 0.3,
  maxAtrPct: 3.0,

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
