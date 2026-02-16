/**
 * Intraday API routes — simplified.
 *
 * GET  /api/intraday/live-signal  — scan current market
 * POST /api/intraday/backtest     — run backtest
 * GET  /api/intraday/equity       — equity curve from last backtest
 * GET  /api/intraday/config       — default config
 */

import { Router } from 'express';
import { DEFAULT_CONFIG, type Config } from '../intraday/config.js';
import { fetchCandles } from '../intraday/data-fetcher.js';
import { runBacktest } from '../intraday/backtest.js';
import { scanLiveSignal } from '../intraday/scanner.js';
import type { BacktestResult } from '../intraday/types.js';

export const intradayRouter = Router();

let lastResult: BacktestResult | null = null;

// GET /api/intraday/live-signal
intradayRouter.get('/live-signal', async (_req, res) => {
  try {
    const result = await scanLiveSignal();
    res.json({ success: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[intraday] Live signal error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/intraday/backtest
intradayRouter.post('/backtest', async (req, res) => {
  try {
    const overrides = req.body ?? {};
    const cfg: Config = { ...DEFAULT_CONFIG, ...overrides };
    console.log(`[intraday] Backtest: ${cfg.interval}, ${cfg.lookbackDays}d, SL=${cfg.slAtrMultiple}xATR`);

    const candles = await fetchCandles(cfg.lookbackDays, cfg.interval);
    if (candles.length < 220) {
      throw new Error(`Not enough candles: ${candles.length} (need 220+)`);
    }

    const result = runBacktest(candles, cfg);
    lastResult = result;

    console.log(`[intraday] Done: ${result.trades.length} trades, ${result.metrics.totalReturnPct}% return`);

    res.json({
      success: true,
      metrics: result.metrics,
      trades: result.trades.slice(0, 100),
      tradeCount: result.trades.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[intraday] Backtest error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/intraday/equity
intradayRouter.get('/equity', (_req, res) => {
  if (!lastResult) {
    res.json({ success: false, equity: [] });
    return;
  }
  const curve = lastResult.equity;
  const step = Math.max(1, Math.floor(curve.length / 500));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  res.json({ success: true, equity: sampled });
});

// GET /api/intraday/config
intradayRouter.get('/config', (_req, res) => {
  res.json(DEFAULT_CONFIG);
});
