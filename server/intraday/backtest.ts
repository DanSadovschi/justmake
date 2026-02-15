/**
 * Backtesting Engine.
 *
 * Walks forward through LTF candles, evaluating signals and managing positions.
 * Guarantees no lookahead bias:
 *   - HTF regime uses last CLOSED HTF candle
 *   - Signal conditions checked on closed LTF candle
 *   - Entry at next candle's open
 *   - Stops checked against intra-candle high/low
 *
 * Supports running on subsets (in-sample / out-of-sample).
 */

import type { IntradayConfig } from './config.js';
import { intervalMs } from './config.js';
import type {
  Candle,
  Trade,
  EquityPoint,
  PendingSignal,
  LtfIndicators,
  BacktestResult,
} from './types.js';
import {
  emaClose,
  rsi as calcRsi,
  atr as calcAtr,
  bollingerBands,
  volumeSma,
  aggregateCandles,
} from './indicators.js';
import { computeRegimes, getRegimeAtTime } from './regime.js';
import { checkTrendPullback, checkMeanReversion } from './signals.js';
import {
  calculatePositionSize,
  calculateFees,
  calculateFunding,
  checkExits,
  updateTrailingStop,
  type OpenPosition,
} from './risk.js';
import { computeMetrics } from './analytics.js';

// Warmup: need enough bars for the slowest indicator (EMA50 on LTF)
const MIN_WARMUP = 60;

/**
 * Run a backtest on the given LTF candles with HTF candles for regime detection.
 * If htfCandles is null, aggregates from ltfCandles.
 */
export function runBacktest(
  ltfCandles: Candle[],
  htfCandles: Candle[] | null,
  cfg: IntradayConfig,
  segment: 'full' | 'in_sample' | 'out_of_sample' = 'full',
): BacktestResult {
  const htfMs = intervalMs(cfg.htfInterval);

  // Aggregate HTF candles from LTF if not provided
  const htf = htfCandles ?? aggregateCandles(ltfCandles, htfMs);

  // Compute HTF regime
  const regimes = computeRegimes(htf, cfg);

  // Compute LTF indicators
  const ind = computeLtfIndicators(ltfCandles, cfg);

  // Walk forward
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  let capital = cfg.initialCapital;
  let peakCapital = capital;
  let tradeId = 0;

  let openPos: OpenPosition | null = null;
  let pendingSignal: PendingSignal | null = null;

  for (let i = MIN_WARMUP; i < ltfCandles.length; i++) {
    const candle = ltfCandles[i];

    // ── 1. Open pending position at this candle's open ──
    if (pendingSignal && !openPos) {
      const entryPrice = candle.open;
      const pos = calculatePositionSize(capital, entryPrice, pendingSignal.stopLoss, cfg);

      if (pos.qty > 0 && pos.positionSizeUsd > 0) {
        openPos = {
          direction: pendingSignal.direction,
          strategy: pendingSignal.strategy,
          entryPrice,
          entryTime: candle.openTime,
          entryIdx: i,
          stopLoss: pendingSignal.stopLoss,
          atr: pendingSignal.atr,
          positionSizeUsd: pos.positionSizeUsd,
          qty: pos.qty,
          riskUsd: pos.riskUsd,
          regime: pendingSignal.regime,
          confidence: pendingSignal.confidence,
          reasoning: pendingSignal.reasoning,
          peakPrice: entryPrice,
          trailActive: false,
          trailStop: pendingSignal.direction === 'LONG' ? -Infinity : Infinity,
          maxAdverse: 0,
          maxFavorable: 0,
        };
      }
      pendingSignal = null;
    }

    // ── 2. Manage open position ──
    if (openPos) {
      const regime = getRegimeAtTime(regimes, candle.openTime, htfMs);
      const currentRegime = regime?.regime ?? 'NEUTRAL';

      const exitCheck = checkExits(
        openPos,
        candle.high,
        candle.low,
        candle.close,
        ind.rsi14[i],
        currentRegime,
        i,
        cfg,
      );

      if (exitCheck?.shouldExit) {
        // Close position
        const exitPrice = exitCheck.exitPrice;
        const isLong = openPos.direction === 'LONG';
        const rawPnl = isLong
          ? (exitPrice - openPos.entryPrice) * openPos.qty
          : (openPos.entryPrice - exitPrice) * openPos.qty;

        const fees = calculateFees(openPos.positionSizeUsd, cfg);
        const funding = calculateFunding(
          openPos.positionSizeUsd,
          openPos.entryTime,
          candle.openTime,
          openPos.direction,
          cfg,
        );
        const netPnl = rawPnl - fees - funding;
        const pnlPct = (netPnl / capital) * 100;
        const initialRisk = Math.abs(openPos.entryPrice - openPos.stopLoss) * openPos.qty;
        const rMultiple = initialRisk > 0 ? netPnl / initialRisk : 0;

        trades.push({
          id: ++tradeId,
          direction: openPos.direction,
          strategy: openPos.strategy,
          entryTime: openPos.entryTime,
          entryPrice: openPos.entryPrice,
          exitTime: candle.openTime,
          exitPrice,
          stopLoss: openPos.stopLoss,
          positionSizeUsd: openPos.positionSizeUsd,
          qty: openPos.qty,
          pnl: round(netPnl),
          pnlPct: round(pnlPct),
          fees: round(fees),
          fundingPaid: round(funding),
          rMultiple: round(rMultiple),
          holdCandles: i - openPos.entryIdx,
          exitReason: exitCheck.reason,
          regime: openPos.regime,
          maxAdversePct: round(openPos.maxAdverse),
          maxFavorablePct: round(openPos.maxFavorable),
        });

        capital += netPnl;
        openPos = null;
      } else {
        // Position still open — update trailing stop
        updateTrailingStop(openPos, candle.high, candle.low, cfg);
      }
    }

    // ── 3. Generate signals (only if no open position and no pending signal) ──
    if (!openPos && !pendingSignal) {
      const regime = getRegimeAtTime(regimes, candle.openTime, htfMs);
      const currentRegime = regime?.regime ?? 'NEUTRAL';

      // Try trend pullback first, then mean reversion
      const signal =
        checkTrendPullback(ltfCandles, ind, i, currentRegime, cfg) ??
        checkMeanReversion(ltfCandles, ind, i, currentRegime, cfg);

      if (signal) {
        pendingSignal = signal;
      }
    }

    // ── 4. Record equity ──
    if (capital > peakCapital) peakCapital = capital;
    const dd = peakCapital > 0 ? ((peakCapital - capital) / peakCapital) * 100 : 0;
    equity.push({
      time: candle.openTime,
      equity: round(capital),
      drawdownPct: round(dd),
    });
  }

  // Compute metrics
  const metrics = computeMetrics(trades, cfg.initialCapital, capital);

  return { trades, equityCurve: equity, metrics, config: cfg as unknown as Record<string, unknown>, segment };
}

// ────────────────────── Indicator Computation ──────────────────────

function computeLtfIndicators(candles: Candle[], cfg: IntradayConfig): LtfIndicators {
  const ema20 = emaClose(candles, cfg.ltfEmaFast);
  const ema50 = emaClose(candles, cfg.ltfEmaSlow);
  const rsi14 = calcRsi(candles, cfg.rsiPeriod);
  const atr14 = calcAtr(candles, cfg.atrPeriod);
  const bb = bollingerBands(candles, cfg.bbPeriod, cfg.bbStdDev);
  const volSma = volumeSma(candles, 20);

  return {
    ema20,
    ema50,
    rsi14,
    atr14,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    volumeSma20: volSma,
  };
}

// ────────────────────── Comparison Runner ──────────────────────

export interface ComparisonResult {
  full: BacktestResult;
  inSample: BacktestResult;
  outOfSample: BacktestResult;
  trendOnly: BacktestResult;
  mrOnly: BacktestResult;
}

/**
 * Run full comparison: in-sample, out-of-sample, trend-only, MR-only, combined.
 */
export function runComparison(
  ltfCandles: Candle[],
  htfCandles: Candle[] | null,
  cfg: IntradayConfig,
): ComparisonResult {
  const splitIdx = Math.floor(ltfCandles.length * cfg.inSamplePct);
  const inSampleCandles = ltfCandles.slice(0, splitIdx);
  const outOfSampleCandles = ltfCandles.slice(splitIdx);

  // For HTF: we need to compute separately for each segment
  // but we can pass full HTF data and let regime detection handle alignment
  const htfMs = intervalMs(cfg.htfInterval);
  const htf = htfCandles ?? aggregateCandles(ltfCandles, htfMs);

  // Full combined backtest
  const full = runBacktest(ltfCandles, htf, cfg, 'full');

  // In-sample / out-of-sample
  const inSample = runBacktest(inSampleCandles, htf, cfg, 'in_sample');
  const outOfSample = runBacktest(outOfSampleCandles, htf, cfg, 'out_of_sample');

  // Trend-only: set MR thresholds to impossible values
  const trendCfg: IntradayConfig = {
    ...cfg,
    mrRsiOversold: -1,      // never triggers
    mrRsiOverbought: 101,   // never triggers
  };
  const trendOnly = runBacktest(ltfCandles, htf, trendCfg, 'full');

  // MR-only: set trend pullback to impossible values
  const mrCfg: IntradayConfig = {
    ...cfg,
    pullbackMinPct: -100,   // never triggers
    pullbackMaxPct: -100,
    tpRsiMin: 200,          // never triggers
    tpRsiMax: -200,
  };
  const mrOnly = runBacktest(ltfCandles, htf, mrCfg, 'full');

  return { full, inSample, outOfSample, trendOnly, mrOnly };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
