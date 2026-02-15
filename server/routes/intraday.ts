/**
 * API routes for the intraday trading system.
 *
 * POST /api/intraday/backtest   — run full backtest comparison
 * GET  /api/intraday/results    — get cached results
 * GET  /api/intraday/config     — get default config
 */

import { Router } from 'express';
import {
  runFullBacktest,
  getLastResult,
  getLastRunTime,
  getDefaultConfig,
} from '../intraday/engine.js';

export const intradayRouter = Router();

// POST /api/intraday/backtest — run full backtest with optional config overrides
intradayRouter.post('/backtest', async (req, res) => {
  try {
    const overrides = req.body ?? {};
    console.log('[intraday] Starting backtest with overrides:', JSON.stringify(overrides));

    const result = await runFullBacktest(overrides);

    // Return summary (not the full equity curve — too large for JSON)
    res.json({
      success: true,
      timestamp: Date.now(),
      full: {
        metrics: result.full.metrics,
        tradeCount: result.full.trades.length,
        trades: result.full.trades.slice(0, 200),  // cap at 200 trades for response size
      },
      inSample: {
        metrics: result.inSample.metrics,
        tradeCount: result.inSample.trades.length,
      },
      outOfSample: {
        metrics: result.outOfSample.metrics,
        tradeCount: result.outOfSample.trades.length,
      },
      trendOnly: {
        metrics: result.trendOnly.metrics,
        tradeCount: result.trendOnly.trades.length,
      },
      mrOnly: {
        metrics: result.mrOnly.metrics,
        tradeCount: result.mrOnly.trades.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[intraday] Backtest error:', message);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/intraday/results — get cached results without re-running
intradayRouter.get('/results', (_req, res) => {
  const result = getLastResult();
  if (!result) {
    res.json({ success: false, message: 'No backtest results cached. Run a backtest first.' });
    return;
  }

  res.json({
    success: true,
    timestamp: getLastRunTime(),
    full: {
      metrics: result.full.metrics,
      tradeCount: result.full.trades.length,
      trades: result.full.trades.slice(0, 200),
    },
    inSample: {
      metrics: result.inSample.metrics,
      tradeCount: result.inSample.trades.length,
    },
    outOfSample: {
      metrics: result.outOfSample.metrics,
      tradeCount: result.outOfSample.trades.length,
    },
    trendOnly: {
      metrics: result.trendOnly.metrics,
      tradeCount: result.trendOnly.trades.length,
    },
    mrOnly: {
      metrics: result.mrOnly.metrics,
      tradeCount: result.mrOnly.trades.length,
    },
  });
});

// GET /api/intraday/trades — get all trades from last run
intradayRouter.get('/trades', (_req, res) => {
  const result = getLastResult();
  if (!result) {
    res.json({ success: false, trades: [] });
    return;
  }
  res.json({ success: true, trades: result.full.trades });
});

// GET /api/intraday/equity — get equity curve from last run
intradayRouter.get('/equity', (_req, res) => {
  const result = getLastResult();
  if (!result) {
    res.json({ success: false, equity: [] });
    return;
  }

  // Downsample equity curve for frontend (every 24th point ≈ 1 day for hourly)
  const curve = result.full.equityCurve;
  const step = Math.max(1, Math.floor(curve.length / 500));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);

  res.json({ success: true, equity: sampled });
});

// GET /api/intraday/config — get default config
intradayRouter.get('/config', (_req, res) => {
  res.json(getDefaultConfig());
});
