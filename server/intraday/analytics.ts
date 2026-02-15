/**
 * Performance Analytics Module.
 *
 * Computes all backtest metrics from a list of trades.
 * No market data needed — purely statistical.
 */

import type { Trade, PerformanceMetrics } from './types.js';

/**
 * Compute comprehensive performance metrics from a list of trades.
 */
export function computeMetrics(
  trades: Trade[],
  initialCapital: number,
  finalCapital: number,
): PerformanceMetrics {
  const n = trades.length;

  if (n === 0) return emptyMetrics();

  // Basic
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = (wins.length / n) * 100;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Returns for Sharpe/Sortino
  const returns = trades.map(t => t.pnlPct);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / n;
  const stdDev = Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / n);
  const downsideDev = Math.sqrt(
    returns.filter(r => r < 0).reduce((s, r) => s + r ** 2, 0) / n,
  );

  // Annualize: assume ~250 trading days, ~16 trades/month as baseline
  // Use sqrt(n) scaling since trades aren't equally spaced
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(n) : 0;
  const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(n) : 0;

  // Max drawdown from equity curve (using cumulative PnL)
  let cumPnl = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    cumPnl += t.pnl;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDd) maxDd = dd;
  }
  const maxDrawdownPct = initialCapital > 0 ? (maxDd / (initialCapital + peak)) * 100 : 0;

  // Expectancy (average PnL per trade)
  const expectancy = trades.reduce((s, t) => s + t.pnl, 0) / n;

  // Average R multiple
  const avgR = trades.reduce((s, t) => s + t.rMultiple, 0) / n;

  // Total return
  const totalPnl = finalCapital - initialCapital;
  const totalReturnPct = (totalPnl / initialCapital) * 100;

  // Average hold time
  const avgHold = trades.reduce((s, t) => s + t.holdCandles, 0) / n;

  // Max consecutive losses
  let maxConsecLosses = 0;
  let currentStreak = 0;
  for (const t of trades) {
    if (t.pnl <= 0) {
      currentStreak++;
      if (currentStreak > maxConsecLosses) maxConsecLosses = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  // Directional breakdown
  const longs = trades.filter(t => t.direction === 'LONG');
  const shorts = trades.filter(t => t.direction === 'SHORT');
  const longWins = longs.filter(t => t.pnl > 0);
  const shortWins = shorts.filter(t => t.pnl > 0);

  // Strategy breakdown
  const trendTrades = trades.filter(t => t.strategy === 'trend_pullback');
  const mrTrades = trades.filter(t => t.strategy === 'mean_reversion');
  const trendWins = trendTrades.filter(t => t.pnl > 0);
  const mrWins = mrTrades.filter(t => t.pnl > 0);

  // Exit reasons
  const exitReasonCounts: Record<string, number> = {};
  for (const t of trades) {
    exitReasonCounts[t.exitReason] = (exitReasonCounts[t.exitReason] ?? 0) + 1;
  }

  return {
    totalTrades: n,
    winRate: r(winRate),
    profitFactor: r(profitFactor),
    sharpeRatio: r(sharpeRatio),
    sortinoRatio: r(sortinoRatio),
    maxDrawdownPct: r(maxDrawdownPct),
    expectancy: r(expectancy),
    avgRMultiple: r(avgR),
    totalReturnPct: r(totalReturnPct),
    totalPnl: r(totalPnl),
    avgHoldCandles: r(avgHold),
    maxConsecutiveLosses: maxConsecLosses,

    longTrades: longs.length,
    shortTrades: shorts.length,
    longWinRate: longs.length > 0 ? r((longWins.length / longs.length) * 100) : 0,
    shortWinRate: shorts.length > 0 ? r((shortWins.length / shorts.length) * 100) : 0,
    longPnl: r(longs.reduce((s, t) => s + t.pnl, 0)),
    shortPnl: r(shorts.reduce((s, t) => s + t.pnl, 0)),

    trendTrades: trendTrades.length,
    mrTrades: mrTrades.length,
    trendWinRate: trendTrades.length > 0 ? r((trendWins.length / trendTrades.length) * 100) : 0,
    mrWinRate: mrTrades.length > 0 ? r((mrWins.length / mrTrades.length) * 100) : 0,
    trendPnl: r(trendTrades.reduce((s, t) => s + t.pnl, 0)),
    mrPnl: r(mrTrades.reduce((s, t) => s + t.pnl, 0)),

    exitReasonCounts,
  };
}

function emptyMetrics(): PerformanceMetrics {
  return {
    totalTrades: 0, winRate: 0, profitFactor: 0, sharpeRatio: 0, sortinoRatio: 0,
    maxDrawdownPct: 0, expectancy: 0, avgRMultiple: 0, totalReturnPct: 0, totalPnl: 0,
    avgHoldCandles: 0, maxConsecutiveLosses: 0,
    longTrades: 0, shortTrades: 0, longWinRate: 0, shortWinRate: 0, longPnl: 0, shortPnl: 0,
    trendTrades: 0, mrTrades: 0, trendWinRate: 0, mrWinRate: 0, trendPnl: 0, mrPnl: 0,
    exitReasonCounts: {},
  };
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}
