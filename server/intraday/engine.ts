/**
 * Intraday Engine — main orchestrator.
 *
 * Ties together data fetching, backtesting, and comparison.
 * Exposes a single entry point for the API routes.
 */

import type { IntradayConfig } from './config.js';
import { DEFAULT_CONFIG } from './config.js';
import type { BacktestResult } from './types.js';
import { fetchBacktestData } from './data-fetcher.js';
import { runBacktest, runComparison, type ComparisonResult } from './backtest.js';

// Cache the last comparison result in memory
let lastResult: ComparisonResult | null = null;
let lastRunTime = 0;

/**
 * Run a full backtest comparison with data fetching.
 * Fetches fresh data from CryptoCompare, runs all backtest variants.
 */
export async function runFullBacktest(
  configOverrides?: Partial<IntradayConfig>,
): Promise<ComparisonResult> {
  const cfg: IntradayConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  console.log(`[engine] Starting intraday backtest...`);
  console.log(`[engine] Config: LTF=${cfg.ltfInterval}, HTF=${cfg.htfInterval}, lookback=${cfg.lookbackDays}d`);
  console.log(`[engine] Market: ${cfg.marketType}, risk=${cfg.riskPerTrade * 100}%, SL=${cfg.slAtrMultiple}×ATR`);

  // Fetch data
  const { ltfCandles, htfCandles } = await fetchBacktestData(
    cfg.lookbackDays,
    cfg.ltfInterval,
    cfg.htfInterval,
  );

  if (ltfCandles.length < 200) {
    throw new Error(`Insufficient data: only ${ltfCandles.length} LTF candles (need 200+)`);
  }

  // Run comparison
  console.log(`[engine] Running backtest comparison...`);
  const result = runComparison(ltfCandles, htfCandles, cfg);

  console.log(`[engine] Backtest complete!`);
  console.log(`[engine] Combined: ${result.full.trades.length} trades, ${result.full.metrics.totalReturnPct}% return`);
  console.log(`[engine] In-sample: ${result.inSample.trades.length} trades, ${result.inSample.metrics.totalReturnPct}% return`);
  console.log(`[engine] OOS: ${result.outOfSample.trades.length} trades, ${result.outOfSample.metrics.totalReturnPct}% return`);
  console.log(`[engine] Trend-only: ${result.trendOnly.trades.length} trades, ${result.trendOnly.metrics.totalReturnPct}% return`);
  console.log(`[engine] MR-only: ${result.mrOnly.trades.length} trades, ${result.mrOnly.metrics.totalReturnPct}% return`);

  lastResult = result;
  lastRunTime = Date.now();

  return result;
}

/**
 * Run a quick single backtest (no comparison, no data fetch — uses provided data).
 */
export function runQuickBacktest(
  ltfCandles: { openTime: number; open: number; high: number; low: number; close: number; volume: number }[],
  htfCandles: { openTime: number; open: number; high: number; low: number; close: number; volume: number }[] | null,
  configOverrides?: Partial<IntradayConfig>,
): BacktestResult {
  const cfg: IntradayConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  return runBacktest(ltfCandles, htfCandles, cfg, 'full');
}

/** Get the cached last result (if any). */
export function getLastResult(): ComparisonResult | null {
  return lastResult;
}

/** Get the last run timestamp. */
export function getLastRunTime(): number {
  return lastRunTime;
}

/** Get default config for the frontend to display. */
export function getDefaultConfig(): IntradayConfig {
  return { ...DEFAULT_CONFIG };
}
