/**
 * Runtime validation for Config using Zod.
 * Catches invalid CLI args before they silently corrupt backtests.
 */

import { z } from 'zod';
import type { Config } from './config.js';

const ALLOWED_INTERVALS = ['15m', '1h', '4h'] as const;
const ALLOWED_STRATEGIES = [
  'pullback', 'breakout', 'momentum', 'momentum_adx',
  'macd_zero', 'bband_squeeze', 'scoring', 'scoring_simple',
] as const;

export const configSchema = z.object({
  symbol: z.string().min(1, 'symbol must be a non-empty string'),
  interval: z.enum(ALLOWED_INTERVALS, { message: `interval must be one of: ${ALLOWED_INTERVALS.join(', ')}` }),
  strategy: z.enum(ALLOWED_STRATEGIES, { message: `strategy must be one of: ${ALLOWED_STRATEGIES.join(', ')}` }),

  emaFast: z.number().int().positive(),
  emaSlow: z.number().int().positive(),
  emaTrend: z.number().int().positive(),

  rsiPeriod: z.number().int().positive(),
  rsiMin: z.number().min(1).max(90),
  rsiMax: z.number().min(1).max(90),

  atrPeriod: z.number().int().positive(),
  slAtrMultiple: z.number().positive('slAtrMultiple must be > 0'),

  pullbackMaxPct: z.number().positive(),

  breakoutPeriod: z.number().int().positive(),
  breakoutVolMult: z.number().positive(),

  adxPeriod: z.number().int().positive(),
  adxThreshold: z.number().min(1).max(60),

  macdFast: z.number().int().positive(),
  macdSlow: z.number().int().positive(),
  macdSignalPeriod: z.number().int().positive(),

  bbPeriod: z.number().int().positive(),
  bbStdDev: z.number().positive(),
  bbSqueezePctile: z.number().min(1).max(99),

  useEma200Filter: z.boolean(),

  scoreThreshold: z.number().int().min(1),
  minAtrPct: z.number().nonnegative(),
  maxAtrPct: z.number().positive(),

  riskPerTrade: z.number().positive().max(1),
  minRiskReward: z.number().positive(),

  trailActivateR: z.number().positive('trailActivateR must be > 0'),
  trailAtrMultiple: z.number().positive('trailAtrMultiple must be > 0'),

  maxHoldBars: z.number().int().positive(),
  cooldownBars: z.number().int().nonnegative(),
  minConfidence: z.number().min(0).max(100),

  feeRate: z.number().nonnegative(),
  slippageBps: z.number().nonnegative(),

  initialCapital: z.number().positive(),
  lookbackDays: z.number().int().min(31, 'lookbackDays must be > 30'),
}).refine(d => d.emaFast < d.emaSlow, {
  message: 'emaFast must be < emaSlow',
  path: ['emaFast'],
}).refine(d => {
  if (d.strategy === 'scoring') return d.scoreThreshold >= 1 && d.scoreThreshold <= 5;
  if (d.strategy === 'scoring_simple') return d.scoreThreshold >= 1 && d.scoreThreshold <= 3;
  return true;
}, {
  message: 'scoreThreshold out of range for chosen strategy',
  path: ['scoreThreshold'],
});

/**
 * Validate a merged Config object. Throws readable error and exits on failure.
 */
export function validateConfig(cfg: Config): Config {
  const result = configSchema.safeParse(cfg);
  if (!result.success) {
    console.error('\n[CONFIG ERROR] Invalid configuration:\n');
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      console.error(`  ${path}: ${issue.message}`);
    }
    console.error('');
    process.exit(1);
  }
  return result.data as Config;
}
