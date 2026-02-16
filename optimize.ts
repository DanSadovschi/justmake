/**
 * Multi-timeframe, multi-strategy parameter grid search.
 * Run: npx tsx optimize.ts [lookbackDays]
 *
 * Tests 15m, 1h, 4h × breakout/momentum/pullback × param grid.
 * Includes per-year breakdown to detect regime dependence.
 */

import { DEFAULT_CONFIG, type Config, type StrategyType } from './server/intraday/config.js';
import { fetchCandles, type Interval } from './server/intraday/data-fetcher.js';
import { runBacktest } from './server/intraday/backtest.js';
import type { Candle, Metrics, Trade } from './server/intraday/types.js';

const INTERVALS: Interval[] = ['15m', '1h', '4h'];
const STRATEGIES: StrategyType[] = ['breakout', 'momentum', 'pullback'];

// Shared params
const SHARED = {
  slAtrMultiple:    [2.0, 2.5, 3.0],
  trailActivateR:   [1.5, 2.0, 2.5],
  trailAtrMultiple: [1.5, 2.0, 2.5],
  maxHoldBars:      [48, 72, 96],
  rsiMax:           [60, 65, 70],
};

// Strategy-specific
const SPECIFIC: Record<StrategyType, Record<string, number[]>> = {
  breakout: {
    breakoutPeriod:  [10, 15, 20, 30],
    breakoutVolMult: [1.0, 1.2, 1.5],
  },
  momentum: {
    emaFast: [10, 20],
    emaSlow: [30, 50],
  },
  pullback: {
    pullbackMaxPct: [1.5, 2.0, 2.5],
    rsiMin:         [30, 35, 40],
  },
};

interface Result {
  interval: Interval;
  strategy: StrategyType;
  params: Record<string, number | string>;
  metrics: Metrics;
  trades: Trade[];
  score: number;
}

function score(m: Metrics): number {
  if (m.totalTrades < 10) return -999;
  return (
    m.totalReturnPct * 0.4 +
    m.profitFactor * 20 +
    m.avgRMultiple * 30 -
    m.maxDrawdownPct * 0.3
  );
}

function* combos(grid: Record<string, number[]>): Generator<Record<string, number>> {
  const keys = Object.keys(grid);
  const values = keys.map(k => grid[k]);
  const total = values.reduce((a, v) => a * v.length, 1);
  for (let i = 0; i < total; i++) {
    const combo: Record<string, number> = {};
    let idx = i;
    for (let k = keys.length - 1; k >= 0; k--) {
      combo[keys[k]] = values[k][idx % values[k].length];
      idx = Math.floor(idx / values[k].length);
    }
    yield combo;
  }
}

function rd(v: number): number {
  return Math.round(v * 100) / 100;
}

function yearBreakdown(trades: Trade[]): Map<number, { trades: number; wins: number; pnl: number; avgR: number }> {
  const byYear = new Map<number, Trade[]>();
  for (const t of trades) {
    const year = new Date(t.entryTime).getFullYear();
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(t);
  }

  const result = new Map<number, { trades: number; wins: number; pnl: number; avgR: number }>();
  for (const [year, yTrades] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const wins = yTrades.filter(t => t.pnl > 0).length;
    const pnl = yTrades.reduce((s, t) => s + t.pnl, 0);
    const avgR = yTrades.reduce((s, t) => s + t.rMultiple, 0) / yTrades.length;
    result.set(year, { trades: yTrades.length, wins, pnl: rd(pnl), avgR: rd(avgR) });
  }
  return result;
}

async function main() {
  const lookback = Number(process.argv[2]) || 365;

  // Fetch all timeframes upfront
  const candlesByInterval = new Map<Interval, Candle[]>();
  for (const interval of INTERVALS) {
    console.log('');
    const candles = await fetchCandles(lookback, interval);
    candlesByInterval.set(interval, candles);
  }

  console.log('\n── Starting grid search ──\n');

  const results: Result[] = [];
  let totalTested = 0;

  for (const interval of INTERVALS) {
    const candles = candlesByInterval.get(interval)!;
    if (candles.length < 220) {
      console.log(`[${interval}] Only ${candles.length} candles — skipping (need 220+)`);
      continue;
    }

    for (const strategy of STRATEGIES) {
      const grid = { ...SHARED, ...SPECIFIC[strategy] };
      const allCombos = [...combos(grid)];
      console.log(`[${interval}/${strategy}] ${allCombos.length} combos...`);

      for (const params of allCombos) {
        const cfg: Config = { ...DEFAULT_CONFIG, interval, strategy, ...params } as Config;
        const result = runBacktest(candles, cfg);
        const s = score(result.metrics);
        results.push({
          interval,
          strategy,
          params: { interval, strategy, ...params },
          metrics: result.metrics,
          trades: result.trades,
          score: s,
        });
        totalTested++;
      }
    }
  }

  console.log(`\nTotal: ${totalTested} combinations tested.\n`);

  results.sort((a, b) => b.score - a.score);

  // Top 15 with per-year breakdown
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  TOP 15 — WITH PER-YEAR BREAKDOWN');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  const top = results.slice(0, 15);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const m = r.metrics;
    const label = `${r.interval}/${r.strategy}`.toUpperCase().padEnd(16);
    console.log(`  #${String(i + 1).padStart(2)}  [${label}]  Score: ${r.score.toFixed(1).padStart(6)}  |  Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}`);
    const paramStr = Object.entries(r.params)
      .filter(([k]) => k !== 'strategy' && k !== 'interval')
      .map(([k, v]) => `${k}=${v}`)
      .join('  ');
    console.log(`        ${paramStr}`);

    // Per-year breakdown
    const years = yearBreakdown(r.trades);
    const yearParts: string[] = [];
    for (const [year, s] of years) {
      const wr = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      const sign = s.pnl >= 0 ? '+' : '';
      yearParts.push(`${year}: ${s.trades}T ${wr}%WR ${sign}$${s.pnl} avgR=${s.avgR}`);
    }
    console.log(`        ${yearParts.join('  |  ')}`);
    console.log('');
  }

  // Best per interval with year breakdown
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  BEST PER TIMEFRAME — WITH PER-YEAR BREAKDOWN');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  for (const interval of INTERVALS) {
    const best = results.find(r => r.interval === interval && r.score > -999);
    if (!best) { console.log(`  [${interval}] No valid results\n`); continue; }
    const m = best.metrics;
    console.log(`  [${interval.toUpperCase()} / ${best.strategy.toUpperCase()}]  Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}`);
    const args = Object.entries(best.params).map(([k, v]) => `--${k}=${v}`).join(' ');
    console.log(`  Run:  npx tsx run.ts ${args}`);

    const years = yearBreakdown(best.trades);
    for (const [year, s] of years) {
      const wr = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      const sign = s.pnl >= 0 ? '+' : '';
      console.log(`    ${year}:  ${String(s.trades).padStart(3)} trades  WR ${String(wr).padStart(2)}%  PnL ${sign}$${s.pnl}  avgR ${s.avgR}`);
    }
    console.log('');
  }

  // Best per strategy
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  BEST PER STRATEGY (any timeframe)');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  for (const strategy of STRATEGIES) {
    const best = results.find(r => r.strategy === strategy && r.score > -999);
    if (!best) continue;
    const m = best.metrics;
    console.log(`  [${best.interval.toUpperCase()} / ${strategy.toUpperCase()}]  Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}`);
    const args = Object.entries(best.params).map(([k, v]) => `--${k}=${v}`).join(' ');
    console.log(`  Run:  npx tsx run.ts ${args}`);

    const years = yearBreakdown(best.trades);
    for (const [year, s] of years) {
      const wr = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      const sign = s.pnl >= 0 ? '+' : '';
      console.log(`    ${year}:  ${String(s.trades).padStart(3)} trades  WR ${String(wr).padStart(2)}%  PnL ${sign}$${s.pnl}  avgR ${s.avgR}`);
    }
    console.log('');
  }
}

main();
