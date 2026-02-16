/**
 * CLI Backtest Runner — run with: npx tsx run.ts
 *
 * Override config via CLI args:
 *   npx tsx run.ts --lookbackDays=180 --slAtrMultiple=2.5 --rsiMax=65
 */

import { DEFAULT_CONFIG, type Config } from './server/intraday/config.js';
import { fetchCandles } from './server/intraday/data-fetcher.js';
import { runBacktest } from './server/intraday/backtest.js';
import type { Trade, Metrics } from './server/intraday/types.js';

// ── Parse CLI overrides ──
function parseArgs(): Partial<Config> {
  const overrides: Record<string, unknown> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    overrides[key] = isNaN(Number(val)) ? val : Number(val);
  }
  return overrides as Partial<Config>;
}

// ── Pretty print ──
function printMetrics(m: Metrics, cfg: Config): void {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║         BACKTEST RESULTS             ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║ Period:        ${cfg.lookbackDays}d (1H candles)`);
  console.log(`║ Symbol:        ${cfg.symbol}`);
  console.log('╠══════════════════════════════════════╣');
  console.log(`║ Total Trades:  ${m.totalTrades}`);
  console.log(`║ Win Rate:      ${m.winRate}%`);
  console.log(`║ Profit Factor: ${m.profitFactor}`);
  console.log(`║ Total Return:  ${m.totalReturnPct}%`);
  console.log(`║ Total PnL:     $${m.totalPnl}`);
  console.log(`║ Max Drawdown:  ${m.maxDrawdownPct}%`);
  console.log(`║ Avg R:         ${m.avgRMultiple}`);
  console.log(`║ Expectancy:    $${m.expectancy}/trade`);
  console.log(`║ Avg Hold:      ${m.avgHoldBars} bars (${Math.round(m.avgHoldBars)}h)`);
  console.log(`║ Max Consec L:  ${m.maxConsecutiveLosses}`);
  console.log('╠══════════════════════════════════════╣');
  console.log('║ Exit Reasons:');
  for (const [reason, count] of Object.entries(m.exitReasons)) {
    const pct = ((count / m.totalTrades) * 100).toFixed(1);
    console.log(`║   ${reason.padEnd(16)} ${count} (${pct}%)`);
  }
  console.log('╚══════════════════════════════════════╝');
}

function printConfig(cfg: Config): void {
  console.log('\n── Config ──');
  console.log(`  EMA: ${cfg.emaFast}/${cfg.emaSlow}/${cfg.emaTrend}  RSI: ${cfg.rsiPeriod} [${cfg.rsiMin}-${cfg.rsiMax}]`);
  console.log(`  SL: ${cfg.slAtrMultiple}xATR  Trail: activate ${cfg.trailActivateR}R, ${cfg.trailAtrMultiple}xATR`);
  console.log(`  Pullback: ${cfg.pullbackMaxPct}%  Risk: ${cfg.riskPerTrade * 100}%/trade  Min R:R: 1:${cfg.minRiskReward}`);
  console.log(`  MaxHold: ${cfg.maxHoldBars}bars  Cooldown: ${cfg.cooldownBars}bars  MinConf: ${cfg.minConfidence}`);
  console.log(`  Fees: ${cfg.feeRate * 100}%/side  Capital: $${cfg.initialCapital}`);
}

function printTrades(trades: Trade[], limit = 20): void {
  if (trades.length === 0) return;
  console.log(`\n── Last ${Math.min(limit, trades.length)} Trades ──`);
  console.log('  #   Entry          Exit           PnL       R     Bars  Reason');
  console.log('  ' + '─'.repeat(70));

  const show = trades.slice(-limit);
  for (const t of show) {
    const pnlStr = (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(2);
    const rStr = (t.rMultiple >= 0 ? '+' : '') + t.rMultiple.toFixed(2);
    const date = new Date(t.entryTime).toISOString().slice(5, 16).replace('T', ' ');
    console.log(
      `  ${String(t.id).padStart(3)}  ` +
      `${date}  $${t.entryPrice.toFixed(0).padStart(6)}  →  $${t.exitPrice.toFixed(0).padStart(6)}  ` +
      `${pnlStr.padStart(8)}  ${rStr.padStart(5)}  ${String(t.holdBars).padStart(3)}h  ${t.exitReason}`
    );
  }
}

// ── Main ──
const overrides = parseArgs();
const cfg: Config = { ...DEFAULT_CONFIG, ...overrides };

printConfig(cfg);

console.log('\nFetching data...');
const candles = fetchCandles(cfg.lookbackDays, cfg.interval);

if (candles.length < 220) {
  console.error(`Not enough candles: ${candles.length} (need 220+)`);
  process.exit(1);
}

console.log(`Running backtest on ${candles.length} candles...`);
const result = runBacktest(candles, cfg);

printMetrics(result.metrics, cfg);
printTrades(result.trades);
