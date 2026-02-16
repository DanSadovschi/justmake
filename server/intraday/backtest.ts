/**
 * Simple bar-by-bar backtest — LONG only, single timeframe.
 * No walk-forward, no comparison splits.
 */

import type { Config } from './config.js';
import type { Candle, Trade, Indicators, Metrics, BacktestResult, ExitReason } from './types.js';
import { emaClose, rsi as calcRsi, atr as calcAtr, volumeSma } from './indicators.js';
import { checkSignal } from './strategy.js';

// Need 200+ bars for EMA200 warmup
const WARMUP = 210;

export function computeIndicators(candles: Candle[], cfg: Config): Indicators {
  return {
    ema20: emaClose(candles, cfg.emaFast),
    ema50: emaClose(candles, cfg.emaSlow),
    ema200: emaClose(candles, cfg.emaTrend),
    rsi14: calcRsi(candles, cfg.rsiPeriod),
    atr14: calcAtr(candles, cfg.atrPeriod),
    volumeSma20: volumeSma(candles, 20),
  };
}

export function runBacktest(candles: Candle[], cfg: Config): BacktestResult {
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
  let posSize = 0;
  let peakPrice = 0;
  let trailActive = false;
  let trailStop = -Infinity;

  let pendingAtr = 0;
  let hasPending = false;
  let cooldownUntil = 0;

  for (let i = WARMUP; i < candles.length; i++) {
    const c = candles[i];

    // 1. Open pending position at this candle's open
    if (hasPending && !inPosition) {
      entryPrice = c.open;
      entryTime = c.openTime;
      entryIdx = i;
      atrAtEntry = pendingAtr;
      // Recalculate SL from actual entry price (not signal candle close)
      stopLoss = entryPrice - cfg.slAtrMultiple * atrAtEntry;

      const riskUsd = capital * cfg.riskPerTrade;
      const riskPerUnit = Math.abs(entryPrice - stopLoss);
      qty = riskPerUnit > 0 ? riskUsd / riskPerUnit : 0;
      posSize = qty * entryPrice;

      peakPrice = entryPrice;
      trailActive = false;
      trailStop = -Infinity;
      inPosition = qty > 0;
      hasPending = false;
    }

    // 2. Manage open position
    if (inPosition) {
      let exitPrice = 0;
      let exitReason: ExitReason | null = null;

      // Stop loss (account for gaps: if open is below stop, fill at open)
      if (c.low <= stopLoss) {
        exitPrice = c.open <= stopLoss ? c.open : stopLoss;
        exitReason = 'stop_loss';
      }
      // Trailing stop (account for gaps)
      else if (trailActive && c.low <= trailStop) {
        exitPrice = c.open <= trailStop ? c.open : trailStop;
        exitReason = 'trailing_stop';
      }
      // Timeout
      else if (i - entryIdx >= cfg.maxHoldBars) {
        exitPrice = c.close;
        exitReason = 'timeout';
      }

      if (exitReason) {
        const rawPnl = (exitPrice - entryPrice) * qty;
        const fees = posSize * cfg.feeRate * 2;
        const netPnl = rawPnl - fees;
        const initialRisk = Math.abs(entryPrice - stopLoss) * qty;

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
      const signal = checkSignal(candles, ind, i, cfg);
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
