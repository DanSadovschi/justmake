-- Intraday Trading System — Supabase migration
-- Run this in the Supabase SQL Editor to create tables for the intraday system.
-- The backtest engine runs in-memory; these tables store results for the dashboard.

-- Backtest run metadata
CREATE TABLE IF NOT EXISTS intraday_runs (
  id              SERIAL PRIMARY KEY,
  config          JSONB NOT NULL,                -- full config used
  ltf_interval    TEXT NOT NULL,                 -- '15m', '1h', etc.
  htf_interval    TEXT NOT NULL,                 -- '4h', '1d', etc.
  segment         TEXT NOT NULL DEFAULT 'full',  -- 'full', 'in_sample', 'out_of_sample'
  total_trades    INTEGER NOT NULL,
  win_rate        DOUBLE PRECISION,
  profit_factor   DOUBLE PRECISION,
  sharpe_ratio    DOUBLE PRECISION,
  sortino_ratio   DOUBLE PRECISION,
  max_drawdown_pct DOUBLE PRECISION,
  total_return_pct DOUBLE PRECISION,
  total_pnl       DOUBLE PRECISION,
  metrics         JSONB NOT NULL,                -- full PerformanceMetrics object
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Individual trades from backtest
CREATE TABLE IF NOT EXISTS intraday_trades (
  id              SERIAL PRIMARY KEY,
  run_id          INTEGER REFERENCES intraday_runs (id) ON DELETE CASCADE,
  trade_id        INTEGER NOT NULL,
  direction       TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  strategy        TEXT NOT NULL CHECK (strategy IN ('trend_pullback', 'mean_reversion')),
  entry_time      BIGINT NOT NULL,
  entry_price     DOUBLE PRECISION NOT NULL,
  exit_time       BIGINT NOT NULL,
  exit_price      DOUBLE PRECISION NOT NULL,
  stop_loss       DOUBLE PRECISION NOT NULL,
  position_size   DOUBLE PRECISION NOT NULL,
  pnl             DOUBLE PRECISION NOT NULL,
  pnl_pct         DOUBLE PRECISION NOT NULL,
  fees            DOUBLE PRECISION NOT NULL,
  funding_paid    DOUBLE PRECISION NOT NULL DEFAULT 0,
  r_multiple      DOUBLE PRECISION NOT NULL,
  hold_candles    INTEGER NOT NULL,
  exit_reason     TEXT NOT NULL,
  regime          TEXT NOT NULL,
  max_adverse_pct DOUBLE PRECISION,
  max_favorable_pct DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intraday_trades_run ON intraday_trades (run_id);
CREATE INDEX IF NOT EXISTS idx_intraday_trades_direction ON intraday_trades (direction);
CREATE INDEX IF NOT EXISTS idx_intraday_trades_strategy ON intraday_trades (strategy);
