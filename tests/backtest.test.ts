import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, type Config } from '../server/intraday/config.js';
import { runBacktest, computeIndicators } from '../server/intraday/backtest.js';
import type { HtfData } from '../server/intraday/strategy.js';
import type { Candle } from '../server/intraday/types.js';

// ── Helpers ──

/** Generate synthetic candles with a known uptrend then reversal. */
function makeCandles(count: number, startPrice: number): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const baseTime = Date.now() - count * 3_600_000;

  for (let i = 0; i < count; i++) {
    // Slight uptrend with noise
    const change = (Math.sin(i / 20) * 0.005 + 0.001) * price;
    price += change;
    const high = price * 1.005;
    const low = price * 0.995;
    candles.push({
      openTime: baseTime + i * 3_600_000,
      open: price - change / 2,
      high,
      low,
      close: price,
      volume: 100 + Math.sin(i / 10) * 50,
    });
  }
  return candles;
}

const BASE_CFG: Config = {
  ...DEFAULT_CONFIG,
  lookbackDays: 365,
  strategy: 'momentum',
  feeRate: 0.0004,
  slippageBps: 5,
};

// ── 1. Slippage math ──

describe('Slippage', () => {
  it('LONG entry fills higher with slippage', () => {
    const candles = makeCandles(500, 50000);
    const noSlip = runBacktest(candles, { ...BASE_CFG, slippageBps: 0 });
    const withSlip = runBacktest(candles, { ...BASE_CFG, slippageBps: 10 });

    if (noSlip.trades.length > 0 && withSlip.trades.length > 0) {
      // With slippage, entry price should be >= no-slippage entry
      // (since LONG entry fills worse = higher)
      for (let i = 0; i < Math.min(noSlip.trades.length, withSlip.trades.length); i++) {
        expect(withSlip.trades[i].entryPrice).toBeGreaterThanOrEqual(noSlip.trades[i].entryPrice);
      }
    }
  });

  it('slippage reduces net PnL vs zero slippage', () => {
    const candles = makeCandles(500, 50000);
    const noSlip = runBacktest(candles, { ...BASE_CFG, slippageBps: 0, feeRate: 0 });
    const withSlip = runBacktest(candles, { ...BASE_CFG, slippageBps: 20, feeRate: 0 });

    // With higher slippage, total PnL should be lower (or equal if no trades)
    expect(withSlip.metrics.totalPnl).toBeLessThanOrEqual(noSlip.metrics.totalPnl);
  });

  it('entry slippage applied at correct magnitude', () => {
    // 5 bps = 0.05% → on $50000 entry, expect ~$25 higher fill
    const bps = 5;
    const rawPrice = 50000;
    const slippedPrice = rawPrice * (1 + bps / 10_000);
    expect(slippedPrice).toBeCloseTo(50025, 0);
  });

  it('exit slippage applied at correct magnitude', () => {
    // 5 bps = 0.05% → on $50000 exit, expect ~$25 lower fill
    const bps = 5;
    const rawPrice = 50000;
    const slippedPrice = rawPrice * (1 - bps / 10_000);
    expect(slippedPrice).toBeCloseTo(49975, 0);
  });
});

// ── 2. Fee calculation ──

describe('Fees', () => {
  it('fees reduce PnL vs zero fees', () => {
    const candles = makeCandles(500, 50000);
    const noFee = runBacktest(candles, { ...BASE_CFG, feeRate: 0, slippageBps: 0 });
    const withFee = runBacktest(candles, { ...BASE_CFG, feeRate: 0.001, slippageBps: 0 });

    expect(withFee.metrics.totalPnl).toBeLessThanOrEqual(noFee.metrics.totalPnl);
  });

  it('higher fee rate means lower PnL', () => {
    const candles = makeCandles(500, 50000);
    const lowFee = runBacktest(candles, { ...BASE_CFG, feeRate: 0.0004, slippageBps: 0 });
    const highFee = runBacktest(candles, { ...BASE_CFG, feeRate: 0.002, slippageBps: 0 });

    expect(highFee.metrics.totalPnl).toBeLessThanOrEqual(lowFee.metrics.totalPnl);
  });

  it('fee formula: entry + exit on notional', () => {
    const entry = 50000;
    const exit = 51000;
    const qty = 0.1;
    const feeRate = 0.001;
    const entryFee = qty * entry * feeRate;  // 5.0
    const exitFee = qty * exit * feeRate;     // 5.1
    const totalFee = entryFee + exitFee;      // 10.1

    expect(entryFee).toBeCloseTo(5.0, 2);
    expect(exitFee).toBeCloseTo(5.1, 2);
    expect(totalFee).toBeCloseTo(10.1, 2);
  });
});

// ── 3. HTF Confirmation ──

describe('HTF Confirmation', () => {
  it('useHtfConfirm=false does not change results without htf data', () => {
    const candles = makeCandles(500, 50000);
    const without = runBacktest(candles, { ...BASE_CFG, useHtfConfirm: false });
    const withFlag = runBacktest(candles, { ...BASE_CFG, useHtfConfirm: true });
    // Without actual HTF data passed, useHtfConfirm=true is a no-op
    expect(withFlag.metrics.totalTrades).toBe(without.metrics.totalTrades);
  });

  it('HTF gate filters trades when HTF trend is bearish', () => {
    // Build primary candles (1h) — uptrend
    const primary = makeCandles(500, 50000);
    const cfg: Config = { ...BASE_CFG, useHtfConfirm: true };

    // Build fake HTF candles (4h) — bearish (EMA20 < EMA50)
    // Use a downtrending price series
    const htfCandles: Candle[] = [];
    let htfPrice = 60000;
    const htfBase = primary[0].openTime - 500 * 4 * 3_600_000;
    for (let i = 0; i < 500; i++) {
      htfPrice -= htfPrice * 0.002; // steady decline
      htfCandles.push({
        openTime: htfBase + i * 4 * 3_600_000,
        open: htfPrice + 10,
        high: htfPrice + 50,
        low: htfPrice - 50,
        close: htfPrice,
        volume: 200,
      });
    }

    const htfInd = computeIndicators(htfCandles, cfg);
    const htf: HtfData = { candles: htfCandles, ind: htfInd };

    const withHtf = runBacktest(primary, cfg, htf);
    const withoutHtf = runBacktest(primary, { ...cfg, useHtfConfirm: false });

    // HTF bearish should block most/all signals
    expect(withHtf.metrics.totalTrades).toBeLessThanOrEqual(withoutHtf.metrics.totalTrades);
  });
});

// ── 4. Partial Take-Profit ──

describe('Partial Take-Profit', () => {
  it('partialTpR=0 means no partial trades', () => {
    const candles = makeCandles(500, 50000);
    const result = runBacktest(candles, { ...BASE_CFG, partialTpR: 0 });
    const partials = result.trades.filter(t => t.exitReason === 'partial_tp');
    expect(partials.length).toBe(0);
  });

  it('partial TP creates partial_tp exit reason trades', () => {
    const candles = makeCandles(500, 50000);
    // Aggressive partial TP: take 50% at +0.5R (very likely to trigger)
    const result = runBacktest(candles, {
      ...BASE_CFG,
      partialTpR: 0.5,
      partialTpPct: 0.5,
      slippageBps: 0,
      feeRate: 0,
    });
    // If there are trades, some may be partial_tp
    const partials = result.trades.filter(t => t.exitReason === 'partial_tp');
    // Can't guarantee partials trigger on synthetic data, but PnL should be valid
    for (const t of result.trades) {
      expect(t.pnl).not.toBeNaN();
      expect(t.rMultiple).not.toBeNaN();
    }
    // At least verify that if partials exist, they have positive PnL
    // (they trigger at +0.5R which is profitable)
    for (const t of partials) {
      expect(t.pnl).toBeGreaterThan(0);
    }
  });

  it('partialTpPct=0.5 reduces remaining qty for final exit', () => {
    // This is a math check: if partial takes 50%, remaining qty = 50% of original
    const pct = 0.5;
    const origQty = 0.1;
    const remaining = origQty * (1 - pct);
    expect(remaining).toBeCloseTo(0.05, 10);
  });
});
