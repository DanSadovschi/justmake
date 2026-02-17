/**
 * Multi-timeframe, multi-strategy parameter grid search.
 * Run: npx tsx optimize.ts [lookbackDays]
 *
 * Tests 15m, 1h, 4h × 8 strategies × param grid.
 * Includes per-year breakdown, stability analysis, EMA200 A/B test.
 *
 * Scoring: conservative — penalizes drawdown, rewards trade count logarithmically.
 *   score = (ReturnPct / max(1, MaxDDPct)) * ln(1 + trades)
 */

import { DEFAULT_CONFIG, type Config, type StrategyType } from './server/intraday/config.js';
import { fetchCandles, htfInterval, type Interval } from './server/intraday/data-fetcher.js';
import { runBacktest, computeIndicators } from './server/intraday/backtest.js';
import type { HtfData } from './server/intraday/strategy.js';
import type { Candle, Metrics, Trade } from './server/intraday/types.js';

const INTERVALS: Interval[] = ['15m', '1h', '4h'];
const STRATEGIES: StrategyType[] = ['breakout', 'momentum', 'pullback', 'momentum_adx', 'macd_zero', 'bband_squeeze', 'scoring', 'scoring_simple'];

// Shared params (all strategies)
const SHARED = {
  slAtrMultiple:    [2.0, 2.5, 3.0],
  trailActivateR:   [1.5, 2.0, 2.5],
  trailAtrMultiple: [1.5, 2.0, 2.5],
  maxHoldBars:      [48, 72, 96],
  rsiMax:           [60, 65, 70],
};

// Strategy-specific — kept small per instructions
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
  momentum_adx: {
    emaFast:       [10, 20],
    emaSlow:       [30, 50],
    adxThreshold:  [20, 25, 30],
  },
  macd_zero: {
    macdFast: [10, 12],
    macdSlow: [24, 26],
  },
  bband_squeeze: {
    bbSqueezePctile: [10, 15, 20],
  },
  scoring: {
    scoreThreshold: [3, 4],
    adxThreshold:   [20, 25],
    breakoutPeriod:  [10, 20],
  },
  scoring_simple: {
    emaFast:        [10, 20],
    emaSlow:        [30, 50],
    adxThreshold:   [20, 25, 30],
    rsiMax:         [60, 65, 70],
    scoreThreshold: [2, 3],
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

// ── Conservative scoring ──
// Penalizes drawdown via division (not subtraction).
// Rewards trade count logarithmically to avoid rewarding overtrading.
function score(m: Metrics): number {
  if (m.totalTrades < 10) return -999;
  const dd = Math.max(1, m.maxDrawdownPct);
  return (m.totalReturnPct / dd) * Math.log(1 + m.totalTrades);
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

// ── Warnings ──

function getWarnings(m: Metrics): string[] {
  const w: string[] = [];
  if (m.profitFactor > 4 && m.totalTrades < 20)
    w.push('HIGH PF + LOW SAMPLE');
  if (m.totalTrades < 15)
    w.push('LOW SAMPLE');
  if (m.maxDrawdownPct > 10)
    w.push('HIGH DD');
  return w;
}

// ── Multi-year robustness check ──

function multiYearCheck(trades: Trade[]): { profitYears: number; totalYears: number; bearOk: boolean } {
  const years = yearBreakdown(trades);
  let profitYears = 0;
  let totalYears = 0;
  let bearOk = true;

  for (const [year, data] of years) {
    totalYears++;
    if (data.pnl > 0) profitYears++;
    // 2022 bear: loss > 5% of initial capital is a red flag
    if (year === 2022 && data.pnl < -500) bearOk = false;
  }

  return { profitYears, totalYears, bearOk };
}

// ── Factor hit-rate for scoring strategy ──

function scoringFactorHitRate(
  candles: Candle[],
  cfg: Config,
  trades: Trade[],
): Record<string, number> | null {
  if (cfg.strategy !== 'scoring' && cfg.strategy !== 'scoring_simple') return null;
  if (trades.length === 0) return null;
  const ind = computeIndicators(candles, cfg);
  const isSimple = cfg.strategy === 'scoring_simple';
  const hits = { A_trend: 0, B_adx: 0, C_rsi: 0, D_breakout: 0, E_atrPct: 0 };
  let matched = 0;

  for (const t of trades) {
    let sigIdx = -1;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].openTime === t.entryTime) { sigIdx = i - 1; break; }
    }
    if (sigIdx < 2) continue;
    if (!isSimple && sigIdx < cfg.breakoutPeriod) continue;
    matched++;

    if (ind.ema20[sigIdx] > ind.ema50[sigIdx]) hits.A_trend++;
    if (ind.adx[sigIdx] >= cfg.adxThreshold) hits.B_adx++;
    if (ind.rsi14[sigIdx] < cfg.rsiMax) hits.C_rsi++;

    if (!isSimple) {
      let hh = -Infinity;
      for (let j = sigIdx - cfg.breakoutPeriod; j < sigIdx; j++) {
        if (candles[j].high > hh) hh = candles[j].high;
      }
      if (candles[sigIdx].close > hh) hits.D_breakout++;

      const atrPct = ind.atr14[sigIdx] > 0 ? (ind.atr14[sigIdx] / candles[sigIdx].close) * 100 : 0;
      if (atrPct >= cfg.minAtrPct && atrPct <= cfg.maxAtrPct) hits.E_atrPct++;
    }
  }

  if (matched === 0) return null;

  const result: Record<string, number> = {
    A_trend: rd((hits.A_trend / matched) * 100),
    B_adx: rd((hits.B_adx / matched) * 100),
    C_rsi: rd((hits.C_rsi / matched) * 100),
  };
  if (!isSimple) {
    result.D_breakout = rd((hits.D_breakout / matched) * 100);
    result.E_atrPct = rd((hits.E_atrPct / matched) * 100);
  }
  return result;
}

// ── Stability check ──
// For each top result, check if ±1 step neighbors in parameter space
// have scores within 70% of the top. Dense neighborhood = stable.

function makeKey(interval: Interval, strategy: StrategyType, numericParams: Record<string, number>): string {
  const p = Object.entries(numericParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${interval}|${strategy}|${p}`;
}

function checkStability(
  r: Result,
  lookup: Map<string, number>,
  allResults: Result[],
): 'STABLE' | 'MODERATE' | 'UNSTABLE' {
  const grid: Record<string, number[]> = { ...SHARED, ...SPECIFIC[r.strategy] };
  const numericParams: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.params)) {
    if (k !== 'interval' && k !== 'strategy' && typeof v === 'number') {
      numericParams[k] = v;
    }
  }

  let totalNeighbors = 0;
  let stableNeighbors = 0;

  for (const [paramName, gridValues] of Object.entries(grid)) {
    const currentVal = numericParams[paramName];
    if (currentVal === undefined) continue;
    const currentIdx = gridValues.indexOf(currentVal);
    if (currentIdx < 0) continue;

    for (const delta of [-1, 1]) {
      const nIdx = currentIdx + delta;
      if (nIdx < 0 || nIdx >= gridValues.length) continue;

      const neighborParams = { ...numericParams, [paramName]: gridValues[nIdx] };
      const key = makeKey(r.interval, r.strategy, neighborParams);
      const resultIdx = lookup.get(key);

      totalNeighbors++;
      if (resultIdx !== undefined) {
        const neighborScore = allResults[resultIdx].score;
        if (neighborScore >= r.score * 0.7) stableNeighbors++;
      }
    }
  }

  if (totalNeighbors === 0) return 'UNSTABLE';
  const ratio = stableNeighbors / totalNeighbors;
  if (ratio >= 0.6) return 'STABLE';
  if (ratio >= 0.3) return 'MODERATE';
  return 'UNSTABLE';
}

async function main() {
  const lookback = Number(process.argv[2]) || 365;

  // Fetch all timeframes upfront
  const candlesByInterval = new Map<Interval, Candle[]>();
  for (const interval of INTERVALS) {
    console.log('');
    const candles = await fetchCandles(lookback, interval, DEFAULT_CONFIG.symbol);
    candlesByInterval.set(interval, candles);
  }

  // Pre-compute HTF data for each interval
  const htfByInterval = new Map<Interval, HtfData | undefined>();
  for (const interval of INTERVALS) {
    const htfInt = htfInterval(interval);
    if (htfInt) {
      const htfCandles = candlesByInterval.get(htfInt);
      if (htfCandles && htfCandles.length >= 220) {
        htfByInterval.set(interval, { candles: htfCandles, ind: computeIndicators(htfCandles, DEFAULT_CONFIG) });
      }
    }
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

    const htfData = htfByInterval.get(interval);

    for (const strategy of STRATEGIES) {
      const grid = { ...SHARED, ...SPECIFIC[strategy] };
      const allCombos = [...combos(grid)];
      console.log(`[${interval}/${strategy}] ${allCombos.length} combos...`);

      for (const params of allCombos) {
        const cfg: Config = { ...DEFAULT_CONFIG, interval, strategy, ...params } as Config;
        // Pass HTF data only if useHtfConfirm is on for this combo
        const htf = cfg.useHtfConfirm ? htfData : undefined;
        const result = runBacktest(candles, cfg, htf);
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

  // Build lookup for stability analysis
  const lookup = new Map<string, number>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const numericParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.params)) {
      if (k !== 'interval' && k !== 'strategy' && typeof v === 'number') {
        numericParams[k] = v;
      }
    }
    lookup.set(makeKey(r.interval, r.strategy, numericParams), i);
  }

  // ════════════════════════════════════════════════════════
  // TOP 15 with stability, warnings, multi-year check
  // ════════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  TOP 15 — WITH PER-YEAR BREAKDOWN');
  console.log('  Scoring: (Return% / max(1,DD%)) × ln(1+trades)  — conservative, DD-penalized');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  const top = results.filter(r => r.score > -999).slice(0, 15);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const m = r.metrics;
    const label = `${r.interval}/${r.strategy}`.toUpperCase().padEnd(20);
    const stability = checkStability(r, lookup, results);
    const warnings = getWarnings(m);
    const myc = multiYearCheck(r.trades);
    const yearTag = `${myc.profitYears}/${myc.totalYears}yr+`;
    const bearTag = myc.bearOk ? '' : ' BEAR-RISK';

    let flags = `[${stability}] [${yearTag}]`;
    if (bearTag) flags += bearTag;
    if (warnings.length > 0) flags += '  !! ' + warnings.join(', ');

    console.log(
      `  #${String(i + 1).padStart(2)}  [${label}]  Score: ${r.score.toFixed(1).padStart(6)}  |  ` +
      `Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  ` +
      `Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}`,
    );
    console.log(`        ${flags}`);

    const paramStr = Object.entries(r.params)
      .filter(([k]) => k !== 'strategy' && k !== 'interval')
      .map(([k, v]) => `${k}=${v}`)
      .join('  ');
    console.log(`        ${paramStr}`);

    const years = yearBreakdown(r.trades);
    const yearParts: string[] = [];
    for (const [year, s] of years) {
      const wr = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      const sign = s.pnl >= 0 ? '+' : '';
      yearParts.push(`${year}: ${s.trades}T ${wr}%WR ${sign}$${s.pnl} avgR=${s.avgR}`);
    }
    console.log(`        ${yearParts.join('  |  ')}`);

    // Factor hit-rate for scoring strategies
    if (r.strategy === 'scoring' || r.strategy === 'scoring_simple') {
      const candles = candlesByInterval.get(r.interval)!;
      const numP: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.params)) {
        if (k !== 'interval' && k !== 'strategy' && typeof v === 'number') numP[k] = v;
      }
      const cfgForHit: Config = { ...DEFAULT_CONFIG, interval: r.interval, strategy: r.strategy, ...numP } as Config;
      const hitRates = scoringFactorHitRate(candles, cfgForHit, r.trades);
      if (hitRates) {
        const parts = Object.entries(hitRates).map(([k, v]) => `${k}:${v}%`).join('  ');
        console.log(`        Factors at entry: ${parts}`);
        // Redundant factor warning: >=95% hit rate means the factor is not filtering
        const redundant = Object.entries(hitRates).filter(([, v]) => v >= 95);
        if (redundant.length > 0) {
          const names = redundant.map(([k, v]) => `${k}(${v}%)`).join(', ');
          console.log(`        ⚠ REDUNDANT FACTORS (>=95% always true): ${names}`);
        }
      }
    }

    console.log('');
  }

  // ════════════════════════════════════════════════════════
  // EMA200 FILTER A/B TEST (top 5 unique strategy+interval combos)
  // ════════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  EMA200 FILTER A/B TEST');
  console.log('  For each top config: compare WITH vs WITHOUT EMA200 trend filter');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  const abSeen = new Set<string>();
  let abCount = 0;
  for (const r of top) {
    if (abCount >= 5) break;
    const key = `${r.interval}|${r.strategy}`;
    if (abSeen.has(key)) continue;
    abSeen.add(key);
    abCount++;

    const candles = candlesByInterval.get(r.interval)!;
    const numericParams: Record<string, number> = {};
    for (const [k, v] of Object.entries(r.params)) {
      if (k !== 'interval' && k !== 'strategy' && typeof v === 'number') {
        numericParams[k] = v;
      }
    }

    // Run without EMA200 filter
    const cfgNoFilter: Config = {
      ...DEFAULT_CONFIG,
      interval: r.interval,
      strategy: r.strategy,
      ...numericParams,
      useEma200Filter: false,
    } as Config;
    const htfAb = cfgNoFilter.useHtfConfirm ? htfByInterval.get(r.interval) : undefined;
    const noFilterResult = runBacktest(candles, cfgNoFilter, htfAb);
    const mWith = r.metrics;
    const mWithout = noFilterResult.metrics;

    const label = `${r.interval}/${r.strategy}`.toUpperCase();
    console.log(`  ${label}`);
    console.log(`    WITH EMA200:    Ret: ${mWith.totalReturnPct}%  PF: ${mWith.profitFactor}  DD: ${mWith.maxDrawdownPct}%  Trades: ${mWith.totalTrades}  WR: ${mWith.winRate}%`);
    console.log(`    WITHOUT EMA200: Ret: ${mWithout.totalReturnPct}%  PF: ${mWithout.profitFactor}  DD: ${mWithout.maxDrawdownPct}%  Trades: ${mWithout.totalTrades}  WR: ${mWithout.winRate}%`);

    const dRet = rd(mWithout.totalReturnPct - mWith.totalReturnPct);
    const dPF = rd(mWithout.profitFactor - mWith.profitFactor);
    const dDD = rd(mWithout.maxDrawdownPct - mWith.maxDrawdownPct);
    const dTrades = mWithout.totalTrades - mWith.totalTrades;
    const sign = (v: number) => (v >= 0 ? '+' : '') + v;
    console.log(`    DELTA:          Ret: ${sign(dRet)}%  PF: ${sign(dPF)}  DD: ${sign(dDD)}%  Trades: ${sign(dTrades)}`);

    if (mWithout.maxDrawdownPct > mWith.maxDrawdownPct * 2) {
      console.log('    >> EMA200 filter significantly reduces drawdown. Keep it ON.');
    } else if (mWithout.totalReturnPct > mWith.totalReturnPct * 1.3 && mWithout.maxDrawdownPct < mWith.maxDrawdownPct * 1.5) {
      console.log('    >> Removing EMA200 boosts return with acceptable DD increase. Worth investigating.');
    } else {
      console.log('    >> Marginal difference. EMA200 filter adds safety with modest cost.');
    }
    console.log('');
  }

  // ════════════════════════════════════════════════════════
  // Best per interval with year breakdown
  // ════════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  BEST PER TIMEFRAME — WITH PER-YEAR BREAKDOWN');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  for (const interval of INTERVALS) {
    const best = results.find(r => r.interval === interval && r.score > -999);
    if (!best) { console.log(`  [${interval}] No valid results\n`); continue; }
    const m = best.metrics;
    const stability = checkStability(best, lookup, results);
    console.log(`  [${interval.toUpperCase()} / ${best.strategy.toUpperCase()}]  Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}  [${stability}]`);
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

  // ════════════════════════════════════════════════════════
  // Best per strategy
  // ════════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════════════════════════════════════════════');
  console.log('  BEST PER STRATEGY (any timeframe)');
  console.log('══════════════════════════════════════════════════════════════════════════════════\n');

  for (const strategy of STRATEGIES) {
    const best = results.find(r => r.strategy === strategy && r.score > -999);
    if (!best) continue;
    const m = best.metrics;
    const stability = checkStability(best, lookup, results);
    const warnings = getWarnings(m);
    const warnStr = warnings.length > 0 ? '  !! ' + warnings.join(', ') : '';
    console.log(`  [${best.interval.toUpperCase()} / ${strategy.toUpperCase()}]  Ret: ${m.totalReturnPct}%  PF: ${m.profitFactor}  WR: ${m.winRate}%  DD: ${m.maxDrawdownPct}%  Trades: ${m.totalTrades}  AvgR: ${m.avgRMultiple}  [${stability}]${warnStr}`);
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
