/**
 * Portability Test — Run identical strategy params across multiple symbols.
 *
 * Usage:
 *   npx tsx portability.ts --symbols=BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT [--perYear] [--strategy=momentum] [--interval=4h] [--lookbackDays=1460] [...other params]
 *
 * Prints a comparison table showing how the same config performs per symbol.
 * Optional --perYear flag adds year-by-year breakdown.
 */

import { DEFAULT_CONFIG, type Config } from './server/intraday/config.js';
import { fetchCandles, htfInterval } from './server/intraday/data-fetcher.js';
import { runBacktest, computeIndicators } from './server/intraday/backtest.js';
import type { HtfData } from './server/intraday/strategy.js';
import type { Trade, Metrics } from './server/intraday/types.js';

// ── Parse CLI args ──

function parseArgs(): { symbols: string[]; perYear: boolean; config: Config } {
  const overrides: Record<string, unknown> = {};
  let symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
  let perYear = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === '--perYear') {
      perYear = true;
      continue;
    }
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (!m) continue;
    const [, key, val] = m;

    if (key === 'symbols') {
      symbols = val.split(',').map(s => s.trim().toUpperCase());
      continue;
    }

    if (val === 'true') overrides[key] = true;
    else if (val === 'false') overrides[key] = false;
    else overrides[key] = isNaN(Number(val)) ? val : Number(val);
  }

  // --feePct=0.04 → feeRate=0.0004 (convenience alias)
  if ('feePct' in overrides) {
    overrides['feeRate'] = (overrides['feePct'] as number) / 100;
    delete overrides['feePct'];
  }
  const config: Config = { ...DEFAULT_CONFIG, ...overrides } as Config;
  return { symbols, perYear, config };
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
    const avgR = yTrades.length > 0 ? yTrades.reduce((s, t) => s + t.rMultiple, 0) / yTrades.length : 0;
    result.set(year, { trades: yTrades.length, wins, pnl: rd(pnl), avgR: rd(avgR) });
  }
  return result;
}

// ── Main ──

async function main() {
  const { symbols, perYear, config } = parseArgs();

  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  PORTABILITY TEST — Same params across multiple symbols');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  console.log(`  Strategy:  ${config.strategy.toUpperCase()}`);
  console.log(`  Interval:  ${config.interval}`);
  console.log(`  Lookback:  ${config.lookbackDays} days`);
  console.log(`  Symbols:   ${symbols.join(', ')}`);
  console.log(`  Fee:       ${(config.feeRate * 100).toFixed(3)}%/side  Slippage: ${config.slippageBps}bps`);

  const paramKeys = Object.entries(config)
    .filter(([k]) => !['symbol', 'interval', 'strategy', 'lookbackDays', 'initialCapital', 'feeRate', 'slippageBps'].includes(k))
    .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
  console.log(`  Params:    ${paramKeys}\n`);

  // Fetch and run for each symbol
  const results: { symbol: string; metrics: Metrics; trades: Trade[] }[] = [];

  for (const symbol of symbols) {
    try {
      const candles = await fetchCandles(config.lookbackDays, config.interval, symbol);
      if (candles.length < 220) {
        console.log(`  [${symbol}] Only ${candles.length} candles — skipping (need 220+)\n`);
        continue;
      }

      // Build HTF data if needed
      let htf: HtfData | undefined;
      if (config.useHtfConfirm) {
        const htfInt = htfInterval(config.interval);
        if (htfInt) {
          const htfCandles = await fetchCandles(config.lookbackDays, htfInt, symbol);
          if (htfCandles.length >= 220) {
            htf = { candles: htfCandles, ind: computeIndicators(htfCandles, config) };
          }
        }
      }

      const cfg: Config = { ...config, symbol };
      const result = runBacktest(candles, cfg, htf);
      results.push({ symbol, metrics: result.metrics, trades: result.trades });
    } catch (err) {
      console.log(`  [${symbol}] ERROR: ${(err as Error).message}\n`);
    }
  }

  // ── Comparison table ──
  console.log('\n══════════════════════════════════════════════════════════════════════════════════');
  console.log('  COMPARISON TABLE');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  const header = '  Symbol'.padEnd(14) +
    'Ret%'.padStart(8) +
    'PF'.padStart(7) +
    'WR%'.padStart(7) +
    'DD%'.padStart(7) +
    'Trades'.padStart(8) +
    'AvgR'.padStart(7) +
    'Expect'.padStart(9);
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  for (const r of results) {
    const m = r.metrics;
    const row = `  ${r.symbol.padEnd(12)}` +
      `${String(m.totalReturnPct).padStart(8)}` +
      `${String(m.profitFactor).padStart(7)}` +
      `${String(m.winRate).padStart(7)}` +
      `${String(m.maxDrawdownPct).padStart(7)}` +
      `${String(m.totalTrades).padStart(8)}` +
      `${String(m.avgRMultiple).padStart(7)}` +
      `${('$' + m.expectancy).padStart(9)}`;
    console.log(row);
  }

  // ── Portability verdict ──
  const profitable = results.filter(r => r.metrics.totalReturnPct > 0);
  const total = results.length;
  console.log('');
  console.log(`  Profitable: ${profitable.length}/${total} symbols`);

  if (profitable.length === total && total > 1) {
    console.log('  ✓ Strategy is PORTABLE — profitable across all tested symbols.');
  } else if (profitable.length >= total * 0.5) {
    console.log('  ~ Strategy is PARTIALLY PORTABLE — profitable on majority of symbols.');
  } else {
    console.log('  ✗ Strategy is NOT PORTABLE — fails on most symbols. Likely overfit to a single asset.');
  }

  // ── Per-year breakdown (optional) ──
  if (perYear) {
    console.log('\n══════════════════════════════════════════════════════════════════════════════════');
    console.log('  PER-YEAR BREAKDOWN');
    console.log('══════════════════════════════════════════════════════════════════════════════════\n');

    for (const r of results) {
      console.log(`  ${r.symbol}`);
      const years = yearBreakdown(r.trades);

      if (years.size === 0) {
        console.log('    No trades\n');
        continue;
      }

      for (const [year, s] of years) {
        const wr = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
        const sign = s.pnl >= 0 ? '+' : '';
        console.log(`    ${year}:  ${String(s.trades).padStart(3)} trades  WR ${String(wr).padStart(2)}%  PnL ${sign}$${s.pnl}  avgR ${s.avgR}`);
      }
      console.log('');
    }
  }
}

main();
