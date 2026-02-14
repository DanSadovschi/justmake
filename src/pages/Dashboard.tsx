import { useEffect, useState } from 'react';
import { api, type Candle, type Signal, type Stats } from '../lib/api';

function formatDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatPct(n: number | null) {
  if (n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function Dashboard() {
  const [latestCandle, setLatestCandle] = useState<Candle | null>(null);
  const [latestSignal, setLatestSignal] = useState<Signal | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const [candles, signals, statsData] = await Promise.all([
        api.getCandles(),
        api.getSignals(),
        api.getStats(),
      ]);
      setLatestCandle(candles.length > 0 ? candles[candles.length - 1] : null);
      setLatestSignal(signals.length > 0 ? signals[0] : null);
      setStats(statsData);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate() {
    setUpdating(true);
    setMessage('');
    try {
      const candleResult = await api.updateData();
      const signalResult = await api.generateSignals();
      setMessage(
        `Fetched ${candleResult.inserted} candles. Generated ${signalResult.generated} signals, evaluated ${signalResult.evaluated}.`
      );
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {updating ? 'Updating...' : 'Update Data'}
        </button>
      </div>

      {message && (
        <div className="rounded border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300">
          {message}
        </div>
      )}

      <div className="rounded border border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-400">
        Educational demo. Not financial advice. No real trading.
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          {/* Price card */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="BTC Daily Close">
              {latestCandle ? (
                <>
                  <p className="text-2xl font-bold">{formatUsd(latestCandle.close)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDate(latestCandle.open_time)} UTC
                  </p>
                </>
              ) : (
                <p className="text-gray-500">No data — click Update Data</p>
              )}
            </Card>

            <Card title="Latest Signal">
              {latestSignal ? (
                <>
                  <p className="text-lg font-bold text-green-400">{latestSignal.direction}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDate(latestSignal.signal_date)}
                    {latestSignal.entry_price
                      ? ` · Entry: ${formatUsd(latestSignal.entry_price)}`
                      : ' · Entry pending'}
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    EMA20: {latestSignal.ema20.toFixed(0)} / EMA50: {latestSignal.ema50.toFixed(0)}
                  </p>
                </>
              ) : (
                <p className="text-gray-500">No signals yet</p>
              )}
            </Card>

            <Card title="Signals">
              {stats ? (
                <>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {stats.evaluated} evaluated · {stats.pending} pending
                  </p>
                </>
              ) : (
                <p className="text-gray-500">—</p>
              )}
            </Card>

            <Card title="Win Rate">
              {stats && stats.winRate !== null ? (
                <>
                  <p className="text-2xl font-bold">{stats.winRate}%</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Avg: {formatPct(stats.avgReturn)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Best: {formatPct(stats.bestReturn)} · Worst: {formatPct(stats.worstReturn)}
                  </p>
                </>
              ) : (
                <p className="text-gray-500">No evaluations yet</p>
              )}
            </Card>
          </div>

          {/* Latest signal detail */}
          {latestSignal && latestSignal.evaluations.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-900 p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Latest Signal Outcome</h3>
              {(() => {
                const ev = latestSignal.evaluations[0];
                return (
                  <div className="grid gap-2 sm:grid-cols-4 text-sm">
                    <div>
                      <span className="text-gray-500">Return: </span>
                      <span className={ev.return_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatPct(ev.return_pct)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Exit: </span>
                      {formatUsd(ev.exit_price)} on {formatDate(ev.exit_date)}
                    </div>
                    <div>
                      <span className="text-gray-500">Max Drawdown: </span>
                      <span className="text-red-400">{formatPct(ev.max_adverse_pct)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Max Run-up: </span>
                      <span className="text-green-400">{formatPct(ev.max_favorable_pct)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
      {children}
    </div>
  );
}
