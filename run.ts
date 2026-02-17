/**
 * CLI Backtest Runner — run with: npx tsx run.ts
 *
 * Override config via CLI args:
 *   npx tsx run.ts --lookbackDays=180 --slAtrMultiple=2.5 --rsiMax=65
 */

import { execSync } from 'node:child_process';
import { DEFAULT_CONFIG, type Config } from './server/intraday/config.js';
import { validateConfig } from './server/intraday/configSchema.js';
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
    if (val === 'true') overrides[key] = true;
    else if (val === 'false') overrides[key] = false;
    else overrides[key] = isNaN(Number(val)) ? val : Number(val);
  }
  // --feePct=0.04 → feeRate=0.0004 (convenience alias)
  if ('feePct' in overrides) {
    overrides['feeRate'] = (overrides['feePct'] as number) / 100;
    delete overrides['feePct'];
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
  console.log(`  Strategy: ${cfg.strategy.toUpperCase()}`);
  console.log(`  EMA: ${cfg.emaFast}/${cfg.emaSlow}/${cfg.emaTrend}  RSI: ${cfg.rsiPeriod} [${cfg.rsiMin}-${cfg.rsiMax}]`);
  console.log(`  SL: ${cfg.slAtrMultiple}xATR  Trail: activate ${cfg.trailActivateR}R, ${cfg.trailAtrMultiple}xATR`);
  if (cfg.strategy === 'breakout') console.log(`  Breakout: period=${cfg.breakoutPeriod} volMult=${cfg.breakoutVolMult}`);
  if (cfg.strategy === 'pullback') console.log(`  Pullback: ${cfg.pullbackMaxPct}%`);
  if (cfg.strategy === 'momentum_adx') console.log(`  ADX threshold: ${cfg.adxThreshold}`);
  if (cfg.strategy === 'macd_zero') console.log(`  MACD: ${cfg.macdFast}/${cfg.macdSlow}/${cfg.macdSignalPeriod}`);
  if (cfg.strategy === 'bband_squeeze') console.log(`  BBand: period=${cfg.bbPeriod} stdDev=${cfg.bbStdDev} squeezePctile=${cfg.bbSqueezePctile}%`);
  if (cfg.strategy === 'scoring') console.log(`  Scoring: threshold=${cfg.scoreThreshold}/5  ADX>=${cfg.adxThreshold}  breakout=${cfg.breakoutPeriod}  ATR%=[${cfg.minAtrPct}-${cfg.maxAtrPct}]  EMA200=${cfg.useEma200Filter}`);
  if (cfg.strategy === 'scoring_simple') console.log(`  Scoring Simple: threshold=${cfg.scoreThreshold}/3  ADX>=${cfg.adxThreshold}  RSI<${cfg.rsiMax}  EMA200=${cfg.useEma200Filter}`);
  console.log(`  Risk: ${cfg.riskPerTrade * 100}%/trade  Min R:R: 1:${cfg.minRiskReward}`);
  console.log(`  MaxHold: ${cfg.maxHoldBars}bars  Cooldown: ${cfg.cooldownBars}bars  MinConf: ${cfg.minConfidence}`);
  console.log(`  Fees: ${(cfg.feeRate * 100).toFixed(3)}%/side  Slippage: ${cfg.slippageBps}bps  Capital: $${cfg.initialCapital}`);
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

function printMetadata(cfg: Config): void {
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim(); } catch { /* no git */ }

  console.log('\n── Run Metadata ──');
  console.log(`  timestamp:    ${new Date().toISOString()}`);
  console.log(`  commit:       ${commit}`);
  console.log(`  symbol:       ${cfg.symbol}`);
  console.log(`  interval:     ${cfg.interval}`);
  console.log(`  lookbackDays: ${cfg.lookbackDays}`);
  console.log(`  strategy:     ${cfg.strategy}`);
  console.log(`  feeRate:      ${(cfg.feeRate * 100).toFixed(3)}%/side`);
  console.log(`  slippageBps:  ${cfg.slippageBps}`);
  console.log(`  slAtrMultiple:    ${cfg.slAtrMultiple}`);
  console.log(`  trailActivateR:   ${cfg.trailActivateR}`);
  console.log(`  trailAtrMultiple: ${cfg.trailAtrMultiple}`);
  console.log(`  rsiMax:       ${cfg.rsiMax}`);
  console.log(`  maxHoldBars:  ${cfg.maxHoldBars}`);
}

// ── Main ──
async function main() {
  const overrides = parseArgs();
  const cfg: Config = validateConfig({ ...DEFAULT_CONFIG, ...overrides });

  printMetadata(cfg);
  printConfig(cfg);

  console.log('\nFetching data...');
  const candles = await fetchCandles(cfg.lookbackDays, cfg.interval, cfg.symbol);

  if (candles.length < 220) {
    console.error(`Not enough candles: ${candles.length} (need 220+)`);
    process.exit(1);
  }

  console.log(`Running backtest on ${candles.length} candles...`);
  const result = runBacktest(candles, cfg);

  printMetrics(result.metrics, cfg);
  printTrades(result.trades);
}

main();
