import { useState, useEffect, useCallback } from 'react';
import { fetchJson } from '../lib/api';

// ────────────────────── Types ──────────────────────

interface LiveSignalResponse {
  success: boolean;
  error?: string;
  timestamp: number;
  signal: {
    active: boolean;
    entryZone?: number;
    stopLoss?: number;
    takeProfit?: number;
    confidence?: number;
    reasoning?: Record<string, unknown>;
  };
  indicators: {
    price: number;
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    atr: number;
  };
  trendBullish: boolean;
}

interface Metrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  totalReturnPct: number;
  totalPnl: number;
  avgRMultiple: number;
  maxConsecutiveLosses: number;
  expectancy: number;
  avgHoldBars: number;
  exitReasons: Record<string, number>;
}

interface Trade {
  id: number;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  rMultiple: number;
  holdBars: number;
  exitReason: string;
}

interface BacktestResponse {
  success: boolean;
  error?: string;
  metrics: Metrics;
  trades: Trade[];
  tradeCount: number;
}

// ────────────────────── Component ──────────────────────

export default function Intraday() {
  // Live signal state
  const [liveData, setLiveData] = useState<LiveSignalResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  // Backtest state
  const [btData, setBtData] = useState<BacktestResponse | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [lookbackDays, setLookbackDays] = useState(365);
  const [showBacktest, setShowBacktest] = useState(false);

  // Fetch live signal
  const fetchLive = useCallback(async () => {
    setLiveLoading(true);
    setLiveError(null);
    try {
      const res = await fetchJson<LiveSignalResponse>('/intraday/live-signal');
      setLiveData(res);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Failed to scan');
    } finally {
      setLiveLoading(false);
    }
  }, []);

  // Auto-fetch on mount
  useEffect(() => { fetchLive(); }, [fetchLive]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const timer = setInterval(fetchLive, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchLive]);

  // Run backtest
  const runBacktest = async () => {
    setBtLoading(true);
    setBtError(null);
    try {
      const res = await fetchJson<BacktestResponse>('/intraday/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackDays }),
      });
      setBtData(res);
    } catch (e) {
      setBtError(e instanceof Error ? e.message : 'Backtest failed');
    } finally {
      setBtLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">BTCUSDT LONG</h2>
        <span className="text-xs text-gray-500">EMA Pullback | 1H | Auto-refresh 5min</span>
      </div>

      {/* ── LIVE SIGNAL PANEL ── */}
      <LiveSignalPanel
        data={liveData}
        loading={liveLoading}
        error={liveError}
        onRefresh={fetchLive}
      />

      {/* ── BACKTEST SECTION (collapsible) ── */}
      <div className="rounded-lg bg-gray-900 border border-gray-800">
        <button
          onClick={() => setShowBacktest(!showBacktest)}
          className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-300 hover:text-gray-100"
        >
          <span>Backtest</span>
          <span className="text-gray-500">{showBacktest ? '−' : '+'}</span>
        </button>

        {showBacktest && (
          <div className="px-4 pb-4 space-y-4 border-t border-gray-800">
            {/* Minimal form */}
            <div className="flex items-end gap-3 pt-3">
              <label className="space-y-1">
                <span className="text-xs text-gray-400">Lookback (days)</span>
                <input
                  type="number"
                  value={lookbackDays}
                  onChange={e => setLookbackDays(Number(e.target.value))}
                  className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100"
                />
              </label>
              <button
                onClick={runBacktest}
                disabled={btLoading}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-medium rounded transition-colors"
              >
                {btLoading ? 'Running...' : 'Run'}
              </button>
            </div>

            {btError && (
              <div className="text-sm text-red-400">{btError}</div>
            )}

            {btData?.success && (
              <>
                <MetricsGrid metrics={btData.metrics} />
                <TradesTable trades={btData.trades} total={btData.tradeCount} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────── Live Signal Panel ──────────────────────

function LiveSignalPanel({
  data, loading, error, onRefresh,
}: {
  data: LiveSignalResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (loading && !data) {
    return (
      <div className="rounded-lg bg-gray-900 border border-gray-800 p-6 text-center text-gray-400">
        Scanning market...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 border border-red-800 p-4">
        <div className="text-red-400 text-sm">{error}</div>
        <button onClick={onRefresh} className="mt-2 text-xs text-amber-400 hover:text-amber-300">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { signal, indicators, trendBullish } = data;
  const hasSignal = signal.active;

  return (
    <div className={`rounded-lg border p-5 ${
      hasSignal
        ? 'bg-green-950/30 border-green-800'
        : 'bg-gray-900 border-gray-800'
    }`}>
      {/* Top row: status + refresh */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${hasSignal ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className={`text-lg font-bold ${hasSignal ? 'text-green-400' : 'text-gray-400'}`}>
            {hasSignal ? 'LONG SIGNAL' : 'No Signal'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-0.5 rounded ${
            trendBullish ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
          }`}>
            {trendBullish ? 'BULLISH' : 'BEARISH'}
          </span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Signal details */}
      {hasSignal && signal.entryZone && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <SignalCard label="Entry" value={`$${fmt(signal.entryZone)}`} color="text-green-400" />
          <SignalCard label="Stop Loss" value={`$${fmt(signal.stopLoss!)}`} color="text-red-400" />
          <SignalCard label="Take Profit" value={`$${fmt(signal.takeProfit!)}`} color="text-amber-400" />
          <SignalCard label="Confidence" value={`${signal.confidence}%`} color={
            (signal.confidence ?? 0) >= 70 ? 'text-green-400' : 'text-amber-400'
          } />
        </div>
      )}

      {/* Indicators */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Indicator label="Price" value={fmt(indicators.price)} />
        <Indicator label="EMA20" value={fmt(indicators.ema20)} />
        <Indicator label="EMA50" value={fmt(indicators.ema50)} />
        <Indicator label="EMA200" value={fmt(indicators.ema200)} />
        <Indicator label="RSI" value={indicators.rsi.toFixed(1)} />
        <Indicator label="ATR" value={fmt(indicators.atr)} />
      </div>

      {/* Last updated */}
      <div className="mt-3 text-xs text-gray-600">
        Updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

function SignalCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-black/30 rounded px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-mono text-gray-200">{value}</div>
    </div>
  );
}

// ────────────────────── Metrics Grid ──────────────────────

function MetricsGrid({ metrics }: { metrics: Metrics }) {
  const m = metrics;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <MCard label="Return" value={`${m.totalReturnPct}%`} ok={m.totalReturnPct > 0} />
      <MCard label="Win Rate" value={`${m.winRate}%`} ok={m.winRate >= 45} />
      <MCard label="Profit Factor" value={m.profitFactor.toFixed(2)} ok={m.profitFactor >= 1.3} />
      <MCard label="Max DD" value={`${m.maxDrawdownPct}%`} ok={m.maxDrawdownPct <= 20} />
      <MCard label="Trades" value={String(m.totalTrades)} ok={true} />
      <MCard label="Avg R" value={m.avgRMultiple.toFixed(2)} ok={m.avgRMultiple > 0} />
      <MCard label="Expectancy" value={`$${m.expectancy.toFixed(2)}`} ok={m.expectancy > 0} />
      <MCard label="Max Losses" value={String(m.maxConsecutiveLosses)} ok={m.maxConsecutiveLosses <= 10} />
      <MCard label="Avg Hold" value={`${m.avgHoldBars.toFixed(0)}h`} ok={true} />
      {Object.entries(m.exitReasons).map(([reason, count]) => (
        <MCard key={reason} label={fmtReason(reason)} value={String(count)} ok={true} />
      ))}
    </div>
  );
}

function MCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="bg-gray-800 rounded px-2 py-1.5">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-mono font-bold ${ok ? 'text-green-400' : 'text-red-400'}`}>{value}</div>
    </div>
  );
}

// ────────────────────── Trades Table ──────────────────────

function TradesTable({ trades, total }: { trades: Trade[]; total: number }) {
  if (trades.length === 0) return null;

  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">
        Last {trades.length} of {total} trades
      </div>
      <div className="rounded border border-gray-800 overflow-x-auto max-h-[300px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900">
            <tr className="border-b border-gray-800 text-gray-500">
              <th className="text-left px-2 py-1">#</th>
              <th className="text-left px-2 py-1">Entry</th>
              <th className="text-right px-2 py-1">Entry $</th>
              <th className="text-right px-2 py-1">Exit $</th>
              <th className="text-right px-2 py-1">PnL</th>
              <th className="text-right px-2 py-1">R</th>
              <th className="text-right px-2 py-1">Hold</th>
              <th className="text-left px-2 py-1">Exit</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                <td className="px-2 py-1 text-gray-600">{t.id}</td>
                <td className="px-2 py-1 text-gray-400">{new Date(t.entryTime).toLocaleDateString()}</td>
                <td className="px-2 py-1 text-right font-mono">{t.entryPrice.toFixed(0)}</td>
                <td className="px-2 py-1 text-right font-mono">{t.exitPrice.toFixed(0)}</td>
                <td className={`px-2 py-1 text-right font-mono ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${t.pnl.toFixed(2)}
                </td>
                <td className={`px-2 py-1 text-right font-mono ${t.rMultiple >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {t.rMultiple.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-gray-400">{t.holdBars}h</td>
                <td className="px-2 py-1 text-gray-400">{fmtReason(t.exitReason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────── Utils ──────────────────────

function fmt(n: number): string {
  return n >= 1000 ? n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : n.toFixed(2);
}

function fmtReason(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
