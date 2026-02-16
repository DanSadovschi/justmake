/**
 * Parameter Grid Search — finds best parameter combinations.
 * Run: npx tsx optimize.ts
 */

import { DEFAULT_CONFIG, type Config } from './server/intraday/config.js';
import { fetchCandles } from './server/intraday/data-fetcher.js';
import { runBacktest } from './server/intraday/backtest.js';
import type { Metrics } from './server/intraday/types.js';

// ── Parameter grid ──
const GRID = {
  slAtrMultiple:    [2.0, 2.5, 3.0],
  trailActivateR:   [1.5, 2.0, 2.5],
  trailAtrMultiple: [1.5, 2.0, 2.5],
  rsiMin:           [30, 35, 40],
  rsiMax:           [60, 65, 70],
  maxHoldBars:      [48, 72, 96],
  pullbackMaxPct:   [1.5, 2.0, 2.5],
};

interface Result {
  params: Record<string, number>;
  metrics: Metrics;
  score: number;
}

// Score function: balance return, drawdown, and trade count
function score(m: Metrics): number {
  if (m.totalTrades < 15) return -999;
  // Reward: return and profit factor
  // Penalize: drawdown and low trade count
  return (
    m.totalReturnPct * 0.4 +
    m.profitFactor * 20 +
    m.avgRMultiple * 30 -
    m.maxDrawdownPct * 0.3
  );
}

// Generate all combos from grid
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
  console.log(`Fetching ${lookback}d of data...\n`);
  const candles = await fetchCandles(lookback);
  console.log(`\nGot ${candles.length} candles. Starting grid search...\n`);

  const allCombos = [...combos(GRID)];
  console.log(`Testing ${allCombos.length} parameter combinations...\n`);

  const results: Result[] = [];
  let done = 0;

  for (const params of allCombos) {
    const cfg: Config = { ...DEFAULT_CONFIG, ...params } as Config;
    const result = runBacktest(candles, cfg);
    const s = score(result.metrics);
    results.push({ params, metrics: result.metrics, score: s });

    done++;
    if (done % 500 === 0) {
      console.log(`  ${done}/${allCombos.length} tested...`);
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Print top 15
  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log('  TOP 15 PARAMETER COMBINATIONS');
  console.log('══════════════════════════════════════════════════════════════════════════════\n');

  const top = results.slice(0, 15);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const m = r.metrics;
    console.log(`  #${i + 1}  Score: ${r.score.toFixed(1)}  |  Return: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}`);
    console.log(`      SL: ${r.params.slAtrMultiple}xATR  Trail: ${r.params.trailActivateR}R/${r.params.trailAtrMultiple}xATR  RSI: ${r.params.rsiMin}-${r.params.rsiMax}  Hold: ${r.params.maxHoldBars}h  Pullback: ${r.params.pullbackMaxPct}%`);
    console.log(`      Exits: SL=${m.exitReasons['stop_loss'] ?? 0} Trail=${m.exitReasons['trailing_stop'] ?? 0} Timeout=${m.exitReasons['timeout'] ?? 0}`);
    console.log('');
  }

  // Print worst 3 for contrast
  console.log('── WORST 3 ──\n');
  const worst = results.slice(-3).reverse();
  for (const r of worst) {
    const m = r.metrics;
    console.log(`  Score: ${r.score.toFixed(1)}  |  Return: ${m.totalReturnPct}%  PF: ${m.profitFactor}  Trades: ${m.totalTrades}`);
    console.log(`      SL: ${r.params.slAtrMultiple}xATR  Trail: ${r.params.trailActivateR}R/${r.params.trailAtrMultiple}xATR  RSI: ${r.params.rsiMin}-${r.params.rsiMax}  Hold: ${r.params.maxHoldBars}h  Pullback: ${r.params.pullbackMaxPct}%`);
    console.log('');
  }

  // Print the winning config as CLI command
  const best = top[0];
  const args = Object.entries(best.params).map(([k, v]) => `--${k}=${v}`).join(' ');
  console.log('── RUN BEST CONFIG ──');
  console.log(`  npx tsx run.ts ${args}\n`);
}

main();
