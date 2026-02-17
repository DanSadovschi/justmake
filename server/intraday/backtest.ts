/**
 * Simple bar-by-bar backtest — LONG only, single timeframe.
 * No walk-forward, no comparison splits.
 */

import type { Config } from './config.js';
import type { Candle, Trade, Indicators, Metrics, BacktestResult, ExitReason } from './types.js';
import {
  emaClose, rsi as calcRsi, atr as calcAtr, volumeSma,
  adx as calcAdx, macd as calcMacd, bollingerBands, stochRsi as calcStochRsi,
} from './indicators.js';
import { checkSignal, type HtfData } from './strategy.js';

// Need 200+ bars for EMA200 warmup
const WARMUP = 210;

export function computeIndicators(candles: Candle[], cfg: Config): Indicators {
  const m = calcMacd(candles, cfg.macdFast, cfg.macdSlow, cfg.macdSignalPeriod);
  const bb = bollingerBands(candles, cfg.bbPeriod, cfg.bbStdDev);
  const sr = calcStochRsi(candles, cfg.rsiPeriod, 14, 3);

  return {
    ema20: emaClose(candles, cfg.emaFast),
    ema50: emaClose(candles, cfg.emaSlow),
    ema200: emaClose(candles, cfg.emaTrend),
    rsi14: calcRsi(candles, cfg.rsiPeriod),
    atr14: calcAtr(candles, cfg.atrPeriod),
    volumeSma20: volumeSma(candles, 20),
    adx: calcAdx(candles, cfg.adxPeriod),
    macdLine: m.line,
    macdSignal: m.signal,
    macdHist: m.histogram,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbMiddle: bb.middle,
    bbWidth: bb.width,
    stochRsiK: sr.k,
    stochRsiD: sr.d,
  };
}

export function runBacktest(candles: Candle[], cfg: Config, htf?: HtfData): BacktestResult {
  const ind = computeIndicators(candles, cfg);

  const trades: Trade[] = [];
  const equity: BacktestResult['equity'] = [];
  let capital = cfg.initialCapital;
  let peak = capital;
  let tradeId = 0;

  // Position state
  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;
  let entryIdx = 0;
  let stopLoss = 0;
  let atrAtEntry = 0;
  let qty = 0;
  let peakPrice = 0;
  let trailActive = false;
  let trailStop = -Infinity;

  // Partial TP state
  let partialTaken = false;
  let partialPnl = 0;
  let partialFees = 0;
  const usePartial = cfg.partialTpR > 0 && cfg.partialTpPct > 0 && cfg.partialTpPct < 1;

  let pendingAtr = 0;
  let hasPending = false;
  let cooldownUntil = 0;

  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i];

    // 1. Open pending position at this candle's open
    if (hasPending && !inPosition) {
      // Apply slippage: LONG entry fills worse (higher)
      entryPrice = c.open * (1 + cfg.slippageBps / 10_000);
      entryTime = c.openTime;
      entryIdx = i;
      atrAtEntry = pendingAtr;
      // Recalculate SL from actual entry price (not signal candle close)
      stopLoss = entryPrice - cfg.slAtrMultiple * atrAtEntry;

      const riskUsd = capital * cfg.riskPerTrade;
      const riskPerUnit = Math.abs(entryPrice - stopLoss);
      qty = riskPerUnit > 0 ? riskUsd / riskPerUnit : 0;

      peakPrice = entryPrice;
      trailActive = false;
      trailStop = -Infinity;
      partialTaken = false;
      partialPnl = 0;
      partialFees = 0;
      inPosition = qty > 0;
      hasPending = false;
    }

    // 2. Manage open position
    if (inPosition) {
      let exitPrice = 0;
      let exitReason: ExitReason | null = null;

      const slip = cfg.slippageBps / 10_000;

      // Stop loss (account for gaps: if open is below stop, fill at open)
      // Worst-case fill: apply negative slippage to SL fill
      if (c.low <= stopLoss) {
        const base = c.open <= stopLoss ? c.open : stopLoss;
        exitPrice = base * (1 - slip);
        exitReason = 'stop_loss';
      }
      // Trailing stop (account for gaps)
      else if (trailActive && c.low <= trailStop) {
        const base = c.open <= trailStop ? c.open : trailStop;
        exitPrice = base * (1 - slip);
        exitReason = 'trailing_stop';
      }
      // Timeout — exit at close with slippage
      else if (i - entryIdx >= cfg.maxHoldBars) {
        exitPrice = c.close * (1 - slip);
        exitReason = 'timeout';
      }

      if (exitReason) {
        // Final exit: remaining qty PnL + any partial PnL already taken
        const rawPnl = (exitPrice - entryPrice) * qty;
        const exitFee  = qty * exitPrice  * cfg.feeRate;
        // Entry fee only on remaining qty (partial already deducted its share)
        const entryFee = partialTaken ? 0 : qty * entryPrice * cfg.feeRate;
        const fees = entryFee + exitFee + partialFees;
        const netPnl = rawPnl + partialPnl - fees;
        // initialRisk based on original qty (before partial) for consistent R calc
        const origQty = partialTaken ? qty / (1 - cfg.partialTpPct) : qty;
        const initialRisk = Math.abs(entryPrice - stopLoss) * origQty;

        trades.push({
          id: ++tradeId,
          entryTime,
          entryPrice: rd(entryPrice),
          exitTime: c.openTime,
          exitPrice: rd(exitPrice),
          pnl: rd(netPnl),
          pnlPct: rd((netPnl / capital) * 100),
          rMultiple: initialRisk > 0 ? rd(netPnl / initialRisk) : 0,
          holdBars: i - entryIdx,
          exitReason,
        });

        capital += netPnl;
        if (capital <= 0) capital = 0;
        inPosition = false;
        cooldownUntil = i + cfg.cooldownBars;
      } else {
        // Update trailing stop
        if (c.high > peakPrice) peakPrice = c.high;
        const initialRisk = Math.abs(entryPrice - stopLoss);
        const unrealizedR = initialRisk > 0 ? (peakPrice - entryPrice) / initialRisk : 0;

        // Partial take-profit: close partialTpPct of position at current close
        if (usePartial && !partialTaken && unrealizedR >= cfg.partialTpR) {
          const closeQty = qty * cfg.partialTpPct;
          const partialExitPrice = c.close * (1 - cfg.slippageBps / 10_000);
          const rawPartial = (partialExitPrice - entryPrice) * closeQty;
          const pEntryFee = closeQty * entryPrice * cfg.feeRate;
          const pExitFee  = closeQty * partialExitPrice * cfg.feeRate;
          partialPnl = rawPartial;
          partialFees = pEntryFee + pExitFee;
          qty -= closeQty;
          partialTaken = true;

          // Record the partial exit as a separate trade for transparency
          const origQty = qty + closeQty;
          const totalRisk = Math.abs(entryPrice - stopLoss) * origQty;
          trades.push({
            id: ++tradeId,
            entryTime,
            entryPrice: rd(entryPrice),
            exitTime: c.openTime,
            exitPrice: rd(partialExitPrice),
            pnl: rd(rawPartial - pEntryFee - pExitFee),
            pnlPct: rd(((rawPartial - pEntryFee - pExitFee) / capital) * 100),
            rMultiple: totalRisk > 0 ? rd((rawPartial - pEntryFee - pExitFee) / totalRisk) : 0,
            holdBars: i - entryIdx,
            exitReason: 'partial_tp',
          });

          capital += rawPartial - pEntryFee - pExitFee;
          // Reset partial tracking — PnL already booked
          partialPnl = 0;
          partialFees = 0;
        }

        if (!trailActive && unrealizedR >= cfg.trailActivateR) {
          trailActive = true;
        }
        if (trailActive) {
          const newStop = peakPrice - cfg.trailAtrMultiple * atrAtEntry;
          if (newStop > trailStop) trailStop = newStop;
          if (trailStop < stopLoss) trailStop = stopLoss;
        }
      }
    }

    // 3. Generate signals (with cooldown + confidence filter)
    if (!inPosition && !hasPending && i >= cooldownUntil && capital > 0) {
      const signal = checkSignal(candles, ind, i, cfg, htf);
      if (signal && signal.confidence >= cfg.minConfidence) {
        pendingAtr = signal.atr;
        hasPending = true;
      }
    }

    // 4. Record equity
    if (capital > peak) peak = capital;
    const dd = peak > 0 ? ((peak - capital) / peak) * 100 : 0;
    equity.push({ time: c.openTime, equity: rd(capital), drawdownPct: rd(dd) });
  }

  return {
    trades,
    metrics: computeMetrics(trades, cfg.initialCapital, capital),
    equity,
  };
}

// ────────────────────── Metrics ──────────────────────

function computeMetrics(trades: Trade[], initialCapital: number, finalCapital: number): Metrics {
  const n = trades.length;

  if (n === 0) {
    return {
      totalTrades: 0, winRate: 0, profitFactor: 0, maxDrawdownPct: 0,
      totalReturnPct: 0, totalPnl: 0, avgRMultiple: 0, maxConsecutiveLosses: 0,
      expectancy: 0, avgHoldBars: 0, exitReasons: {},
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Max drawdown from cumulative PnL
  let cumPnl = 0, ddPeak = 0, maxDd = 0;
  let maxConsec = 0, streak = 0;
  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > ddPeak) ddPeak = cumPnl;
    const dd = ddPeak - cumPnl;
    if (dd > maxDd) maxDd = dd;
    if (t.pnl <= 0) { streak++; if (streak > maxConsec) maxConsec = streak; }
    else streak = 0;
  }

  const exitReasons: Record<string, number> = {};
  for (const t of trades) exitReasons[t.exitReason] = (exitReasons[t.exitReason] ?? 0) + 1;

  return {
    totalTrades: n,
    winRate: rd((wins.length / n) * 100),
    profitFactor: rd(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0),
    maxDrawdownPct: rd(initialCapital > 0 ? (maxDd / (initialCapital + ddPeak)) * 100 : 0),
    totalReturnPct: rd(((finalCapital - initialCapital) / initialCapital) * 100),
    totalPnl: rd(finalCapital - initialCapital),
    avgRMultiple: rd(trades.reduce((s, t) => s + t.rMultiple, 0) / n),
    maxConsecutiveLosses: maxConsec,
    expectancy: rd(trades.reduce((s, t) => s + t.pnl, 0) / n),
    avgHoldBars: rd(trades.reduce((s, t) => s + t.holdBars, 0) / n),
    exitReasons,
  };
}

function rd(v: number): number {
  return Math.round(v * 100) / 100;
}
