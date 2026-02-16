/**
 * Multi-timeframe, multi-strategy parameter grid search.
 * Run: npx tsx optimize.ts [lookbackDays]
 *
 * Tests 15m, 1h, 4h × breakout/momentum/pullback × param grid.
 */

import { DEFAULT_CONFIG, type Config, type StrategyType } from './server/intraday/config.js';
import { fetchCandles, type Interval } from './server/intraday/data-fetcher.js';
import { runBacktest } from './server/intraday/backtest.js';
import type { Candle, Metrics } from './server/intraday/types.js';

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
          score: s,
        });
        totalTested++;
      }
    }
  }

  console.log(`\nTotal: ${totalTested} combinations tested.\n`);

  results.sort((a, b) => b.score - a.score);

  // Top 25
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  TOP 25 — ALL TIMEFRAMES × ALL STRATEGIES');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  const top = results.slice(0, 25);
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
    console.log(`        Exits: SL=${m.exitReasons['stop_loss'] ?? 0} Trail=${m.exitReasons['trailing_stop'] ?? 0} Timeout=${m.exitReasons['timeout'] ?? 0}`);
    console.log('');
  }

  // Best per interval
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  BEST PER TIMEFRAME');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  for (const interval of INTERVALS) {
    const best = results.find(r => r.interval === interval && r.score > -999);
    if (!best) { console.log(`  [${interval}] No valid results\n`); continue; }
    const m = best.metrics;
    console.log(`  [${interval.toUpperCase()} / ${best.strategy.toUpperCase()}]  Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}`);
    const args = Object.entries(best.params).map(([k, v]) => `--${k}=${v}`).join(' ');
    console.log(`  Run:  npx tsx run.ts ${args}`);
    console.log('');
  }

  // Best per strategy (across all timeframes)
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
    console.log('');
  }
}

main();
