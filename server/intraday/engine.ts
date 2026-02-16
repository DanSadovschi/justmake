/**
 * Intraday Engine — main orchestrator.
 *
 * Ties together data fetching, backtesting, comparison, and live signal scanning.
 */

import type { IntradayConfig } from './config.js';
import { DEFAULT_CONFIG, intervalMs } from './config.js';
import type { BacktestResult, Candle, LtfIndicators, Regime } from './types.js';
import { fetchBacktestData } from './data-fetcher.js';
import { runBacktest, runComparison, type ComparisonResult } from './backtest.js';
import { computeRegimes, getRegimeAtTime } from './regime.js';
import { checkTrendPullback, checkMeanReversion } from './signals.js';
import {
  emaClose,
  rsi as calcRsi,
  atr as calcAtr,
  bollingerBands,
  volumeSma,
  aggregateCandles,
} from './indicators.js';

// ────────────────────── Cache ──────────────────────

let lastResult: ComparisonResult | null = null;
let lastRunTime = 0;

// ────────────────────── Backtest ──────────────────────

export async function runFullBacktest(
  configOverrides?: Partial<IntradayConfig>,
): Promise<ComparisonResult> {
  const cfg: IntradayConfig = { ...DEFAULT_CONFIG, ...configOverrides };

  console.log(`[engine] Starting backtest: LTF=${cfg.ltfInterval}, HTF=${cfg.htfInterval}, lookback=${cfg.lookbackDays}d`);
  console.log(`[engine] Risk=${cfg.riskPerTrade * 100}%, SL=${cfg.slAtrMultiple}×ATR, cooldown=${cfg.cooldownBars}, minConf=${cfg.minConfidence}`);

  const { ltfCandles, htfCandles } = await fetchBacktestData(cfg.lookbackDays, cfg.ltfInterval, cfg.htfInterval);

  if (ltfCandles.length < 200) {
    throw new Error(`Insufficient data: only ${ltfCandles.length} LTF candles (need 200+)`);
  }

  const result = runComparison(ltfCandles, htfCandles, cfg);

  console.log(`[engine] Done! ${result.full.trades.length} trades, ${result.full.metrics.totalReturnPct}% return, WR ${result.full.metrics.winRate}%`);

  lastResult = result;
  lastRunTime = Date.now();
  return result;
}

export function runQuickBacktest(
  ltfCandles: Candle[],
  htfCandles: Candle[] | null,
  configOverrides?: Partial<IntradayConfig>,
): BacktestResult {
  const cfg: IntradayConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  return runBacktest(ltfCandles, htfCandles, cfg, 'full');
}

export function getLastResult(): ComparisonResult | null { return lastResult; }
export function getLastRunTime(): number { return lastRunTime; }
export function getDefaultConfig(): IntradayConfig { return { ...DEFAULT_CONFIG }; }

// ────────────────────── Live Signal Scanner ──────────────────────

export interface LiveSignalResult {
  timestamp: number;
  regime: Regime;
  regimeDetails: {
    ema50: number;
    ema200: number;
    adx: number;
    slope: number;
  };
  signal: {
    active: boolean;
    direction: 'LONG' | 'SHORT' | null;
    strategy: string | null;
    confidence: number;
    entryZone: number;       // approximate entry (last close)
    stopLoss: number | null;
    takeProfit: number | null;  // 1.5R target
    riskReward: string;
    atr: number;
    reasoning: Record<string, unknown>;
  };
  indicators: {
    price: number;
    ema20: number;
    ema50: number;
    rsi: number;
    atr: number;
    bbUpper: number;
    bbLower: number;
  };
}

/**
 * Scan current market for a live signal.
 * Fetches the last ~500 candles, computes indicators, checks signal conditions.
 * Returns a simple actionable result.
 */
export async function scanLiveSignal(
  configOverrides?: Partial<IntradayConfig>,
): Promise<LiveSignalResult> {
  const cfg: IntradayConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const htfMs = intervalMs(cfg.htfInterval);

  // Fetch recent data (30 days is enough for indicators to warm up)
  const { ltfCandles, htfCandles } = await fetchBacktestData(30, cfg.ltfInterval, cfg.htfInterval);

  if (ltfCandles.length < 60) {
    throw new Error(`Not enough data for scanning: ${ltfCandles.length} candles`);
  }

  // Compute HTF regime
  const htf = htfCandles.length > 0 ? htfCandles : aggregateCandles(ltfCandles, htfMs);
  const regimes = computeRegimes(htf, cfg);

  // Compute LTF indicators
  const ind = computeLtfIndicators(ltfCandles, cfg);

  // Get current state (last closed candle)
  const lastIdx = ltfCandles.length - 1;
  const lastCandle = ltfCandles[lastIdx];
  const regimePoint = getRegimeAtTime(regimes, lastCandle.openTime, htfMs);
  const currentRegime: Regime = regimePoint?.regime ?? 'NEUTRAL';

  // Check for signals
  const signal =
    checkTrendPullback(ltfCandles, ind, lastIdx, currentRegime, cfg) ??
    checkMeanReversion(ltfCandles, ind, lastIdx, currentRegime, cfg);

  // Build result
  const hasSignal = signal !== null && signal.confidence >= cfg.minConfidence;
  let takeProfit: number | null = null;
  let rr = '—';

  if (hasSignal && signal) {
    const risk = Math.abs(lastCandle.close - signal.stopLoss);
    takeProfit = signal.direction === 'LONG'
      ? lastCandle.close + risk * 1.5
      : lastCandle.close - risk * 1.5;
    rr = `1:${(1.5).toFixed(1)}`;
  }

  return {
    timestamp: Date.now(),
    regime: currentRegime,
    regimeDetails: {
      ema50: r(regimePoint?.ema50 ?? 0),
      ema200: r(regimePoint?.ema200 ?? 0),
      adx: r(regimePoint?.adx ?? 0),
      slope: r(regimePoint?.ema50Slope ?? 0),
    },
    signal: {
      active: hasSignal,
      direction: hasSignal && signal ? signal.direction : null,
      strategy: hasSignal && signal ? signal.strategy : null,
      confidence: hasSignal && signal ? signal.confidence : 0,
      entryZone: r(lastCandle.close),
      stopLoss: hasSignal && signal ? r(signal.stopLoss) : null,
      takeProfit: takeProfit ? r(takeProfit) : null,
      riskReward: rr,
      atr: r(ind.atr14[lastIdx]),
      reasoning: hasSignal && signal ? signal.reasoning : {},
    },
    indicators: {
      price: r(lastCandle.close),
      ema20: r(ind.ema20[lastIdx]),
      ema50: r(ind.ema50[lastIdx]),
      rsi: r(ind.rsi14[lastIdx]),
      atr: r(ind.atr14[lastIdx]),
      bbUpper: r(ind.bbUpper[lastIdx]),
      bbLower: r(ind.bbLower[lastIdx]),
    },
  };
}

function computeLtfIndicators(candles: Candle[], cfg: IntradayConfig): LtfIndicators {
  return {
    ema20: emaClose(candles, cfg.ltfEmaFast),
    ema50: emaClose(candles, cfg.ltfEmaSlow),
    rsi14: calcRsi(candles, cfg.rsiPeriod),
    atr14: calcAtr(candles, cfg.atrPeriod),
    ...bollingerBands(candles, cfg.bbPeriod, cfg.bbStdDev),
    bbUpper: bollingerBands(candles, cfg.bbPeriod, cfg.bbStdDev).upper,
    bbMiddle: bollingerBands(candles, cfg.bbPeriod, cfg.bbStdDev).middle,
    bbLower: bollingerBands(candles, cfg.bbPeriod, cfg.bbStdDev).lower,
    volumeSma20: volumeSma(candles, 20),
  };
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}
