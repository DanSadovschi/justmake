/**
 * Configuration for the intraday trading system.
 * All parameters are configurable — no magic numbers in strategy code.
 */

export interface IntradayConfig {
  // ── General ──
  symbol: string;
  marketType: 'spot' | 'perpetual';
  ltfInterval: '5m' | '15m' | '1h';
  htfInterval: '1h' | '4h';

  // ── HTF Regime Detection ──
  htfEmaFast: number;          // 50
  htfEmaSlow: number;          // 200
  htfAdxPeriod: number;        // 14
  adxTrendThreshold: number;   // 20 — above this = trending
  adxRangeThreshold: number;   // 18 — below this = ranging
  htfEmaSlopeBars: number;     // bars back for slope calculation

  // ── Trend Pullback Strategy (LTF) ──
  ltfEmaFast: number;          // 20
  ltfEmaSlow: number;          // 50
  pullbackMinPct: number;      // 0.5% — min distance to EMA20
  pullbackMaxPct: number;      // 1.0% — max distance to EMA20
  tpRsiMin: number;            // 40
  tpRsiMax: number;            // 60
  rsiPeriod: number;           // 14

  // ── Mean Reversion Strategy (LTF) ──
  mrRsiOversold: number;       // 30
  mrRsiOverbought: number;     // 70
  bbPeriod: number;            // 20
  bbStdDev: number;            // 2.0
  mrRsiExit: number;           // 50 — exit when RSI crosses back
  mrTargetR: number;           // 1.5R target

  // ── Risk Management ──
  atrPeriod: number;           // 14
  slAtrMultiple: number;       // 1.5 × ATR
  riskPerTrade: number;        // 0.01 = 1% of capital
  trailActivateR: number;      // activate trailing after +1R
  trailAtrMultiple: number;    // trail by 1 × ATR
  maxHoldCandles: number;      // max position duration in LTF candles

  // ── Fees ──
  feeRate: number;             // per side (0.001 = 0.1%)
  fundingRate8h: number;       // per 8h for perpetual (0.0001 = 0.01%)

  // ── Backtesting ──
  initialCapital: number;
  inSamplePct: number;         // 0.7 = 70%

  // ── Data ──
  lookbackDays: number;        // history to fetch
}

/** Interval duration in milliseconds */
export function intervalMs(interval: string): number {
  const map: Record<string, number> = {
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
  };
  return map[interval] ?? 60_000;
}

export const DEFAULT_CONFIG: IntradayConfig = {
  symbol: 'BTCUSDT',
  marketType: 'spot',
  ltfInterval: '15m',
  htfInterval: '4h',

  htfEmaFast: 50,
  htfEmaSlow: 200,
  htfAdxPeriod: 14,
  adxTrendThreshold: 20,
  adxRangeThreshold: 18,
  htfEmaSlopeBars: 5,

  ltfEmaFast: 20,
  ltfEmaSlow: 50,
  pullbackMinPct: 0.5,
  pullbackMaxPct: 1.0,
  tpRsiMin: 40,
  tpRsiMax: 60,
  rsiPeriod: 14,

  mrRsiOversold: 30,
  mrRsiOverbought: 70,
  bbPeriod: 20,
  bbStdDev: 2.0,
  mrRsiExit: 50,
  mrTargetR: 1.5,

  atrPeriod: 14,
  slAtrMultiple: 1.5,
  riskPerTrade: 0.01,
  trailActivateR: 1.0,
  trailAtrMultiple: 1.0,
  maxHoldCandles: 192,  // e.g. 192 × 15m = 48h

  feeRate: 0.001,
  fundingRate8h: 0.0001,

  initialCapital: 10_000,
  inSamplePct: 0.70,

  lookbackDays: 730,
};
