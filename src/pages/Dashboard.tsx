import { useEffect, useState, useRef, useCallback } from 'react';
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

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Compute exit reason breakdown from signals
function computeExitBreakdown(signals: Signal[]) {
  const breakdown: Record<string, { count: number; totalReturn: number; wins: number }> = {};

  for (const s of signals) {
    const ev = s.evaluations?.length > 0 ? s.evaluations[0] : null;
    if (!ev || !ev.exit_reason) continue;
    if (!breakdown[ev.exit_reason]) breakdown[ev.exit_reason] = { count: 0, totalReturn: 0, wins: 0 };
    breakdown[ev.exit_reason].count++;
    breakdown[ev.exit_reason].totalReturn += ev.return_pct;
    if (ev.return_pct > 0) breakdown[ev.exit_reason].wins++;
  }

  return Object.entries(breakdown).map(([reason, data]) => ({
    reason,
    count: data.count,
    avgReturn: Math.round((data.totalReturn / data.count) * 100) / 100,
    winRate: Math.round((data.wins / data.count) * 100),
  })).sort((a, b) => b.count - a.count);
}

// Compute equity curve (cumulative return)
function computeEquityCurve(signals: Signal[]) {
  const evaluated = signals
    .filter((s) => (s.evaluations?.length ?? 0) > 0)
    .sort((a, b) => a.signal_date - b.signal_date);

  let cumulative = 0;
  return evaluated.map((s) => {
    const ret = s.evaluations[0].return_pct;
    cumulative += ret;
    return {
      date: s.signal_date,
      returnPct: ret,
      cumulative: Math.round(cumulative * 100) / 100,
    };
  });
}

// Compute confidence band analysis
function computeConfidenceAnalysis(signals: Signal[]) {
  const bands = [
    { label: '75-100', min: 75, max: 100 },
    { label: '50-74', min: 50, max: 74 },
    { label: '25-49', min: 25, max: 49 },
    { label: '0-24', min: 0, max: 24 },
  ];

  return bands.map(({ label, min, max }) => {
    const inBand = signals.filter((s) => {
      const c = s.confidence;
      return c != null && c >= min && c <= max && (s.evaluations?.length ?? 0) > 0;
    });
    if (inBand.length === 0) return { label, count: 0, winRate: 0, avgReturn: 0 };

    const wins = inBand.filter((s) => s.evaluations[0].return_pct > 0).length;
    const totalReturn = inBand.reduce((sum, s) => sum + s.evaluations[0].return_pct, 0);

    return {
      label,
      count: inBand.length,
      winRate: Math.round((wins / inBand.length) * 100),
      avgReturn: Math.round((totalReturn / inBand.length) * 100) / 100,
    };
  });
}

const EXIT_COLORS: Record<string, string> = {
  stop_loss: 'bg-red-500',
  take_profit: 'bg-green-500',
  trailing_stop: 'bg-amber-500',
  death_cross: 'bg-purple-500',
  timeout: 'bg-gray-500',
};

const EXIT_LABELS: Record<string, string> = {
  stop_loss: 'Stop Loss',
  take_profit: 'Take Profit',
  trailing_stop: 'Trailing Stop',
  death_cross: 'Death Cross',
  timeout: 'Timeout',
};

export default function Dashboard() {
  const [latestCandle, setLatestCandle] = useState<Candle | null>(null);
  const [latestSignal, setLatestSignal] = useState<Signal | null>(null);
  const [allSignals, setAllSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [livePriceTime, setLivePriceTime] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState('');
  const [lastDataUpdate, setLastDataUpdate] = useState<number | null>(null);
  const autoUpdated = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [candles, signals, statsData] = await Promise.all([
        api.getCandles(),
        api.getSignals(),
        api.getStats(),
      ]);
      setLatestCandle(candles.length > 0 ? candles[candles.length - 1] : null);
      setLatestSignal(signals.length > 0 ? signals[0] : null);
      setAllSignals(signals);
      setStats(statsData);
      return candles.length > 0 ? candles[candles.length - 1] : null;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load data');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleUpdate() {
    setUpdating(true);
    setMessage('');
    try {
      const candleResult = await api.updateData();
      const signalResult = await api.generateSignals();
      setMessage(
        `Fetched ${candleResult.inserted} candles. Generated ${signalResult.generated} signals, evaluated ${signalResult.evaluated}.`
      );
      setLastDataUpdate(Date.now());
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  }

  const fetchLivePrice = useCallback(async () => {
    try {
      const data = await api.getLivePrice();
      setLivePrice(data.price);
      setLivePriceTime(data.timestamp);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    async function init() {
      const latest = await loadData();
      fetchLivePrice();

      if (!autoUpdated.current) {
        autoUpdated.current = true;
        const staleThreshold = 24 * 60 * 60 * 1000;
        if (!latest || Date.now() - latest.open_time > staleThreshold) {
          setMessage('Data is outdated. Auto-updating...');
          setUpdating(true);
          try {
            const candleResult = await api.updateData();
            const signalResult = await api.generateSignals();
            setMessage(
              `Auto-updated: ${candleResult.inserted} candles, ${signalResult.generated} signals, ${signalResult.evaluated} evaluated.`
            );
            setLastDataUpdate(Date.now());
            await loadData();
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Auto-update failed');
          } finally {
            setUpdating(false);
          }
        }
      }
    }
    init();
  }, [loadData, fetchLivePrice]);

  useEffect(() => {
    const interval = setInterval(fetchLivePrice, 30_000);
    return () => clearInterval(interval);
  }, [fetchLivePrice]);

  const priceChange = latestCandle && livePrice
    ? ((livePrice - latestCandle.close) / latestCandle.close) * 100
    : null;

  const exitBreakdown = computeExitBreakdown(allSignals);
  const equityCurve = computeEquityCurve(allSignals);
  const confidenceAnalysis = computeConfidenceAnalysis(allSignals);
  const maxCumulative = equityCurve.length > 0
    ? Math.max(...equityCurve.map((e) => Math.abs(e.cumulative)), 1)
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Dashboard</h2>
          {lastDataUpdate && (
            <p className="text-xs text-gray-500 mt-0.5">
              Last update: {timeAgo(lastDataUpdate)}
            </p>
          )}
        </div>
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
          {/* Top cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card title="BTC Live Price">
              {livePrice ? (
                <>
                  <p className="text-2xl font-bold">{formatUsd(livePrice)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {priceChange !== null && (
                      <span className={`text-xs font-medium ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% vs close
                      </span>
                    )}
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-gray-500">
                      {livePriceTime ? timeAgo(livePriceTime) : ''}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-gray-500">Loading...</p>
              )}
            </Card>

            <Card title="BTC Daily Close">
              {latestCandle ? (
                <>
                  <p className="text-2xl font-bold">{formatUsd(latestCandle.close)}</p>
                  <p className="text-xs text-gray-500 mt-1">{formatDate(latestCandle.open_time)} UTC</p>
                </>
              ) : (
                <p className="text-gray-500">No data — click Update Data</p>
              )}
            </Card>

            <Card title="Latest Signal">
              {latestSignal ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-green-400">{latestSignal.direction}</span>
                    {latestSignal.confidence != null && (
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        latestSignal.confidence >= 75 ? 'text-green-400 bg-green-900/30' :
                        latestSignal.confidence >= 50 ? 'text-amber-400 bg-amber-900/30' :
                        'text-red-400 bg-red-900/30'
                      }`}>
                        {latestSignal.confidence}/100
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDate(latestSignal.signal_date)}
                    {latestSignal.entry_price ? ` · ${formatUsd(latestSignal.entry_price)}` : ' · Entry pending'}
                  </p>
                  {latestSignal.rsi14 != null && (
                    <p className="text-xs text-gray-600 mt-1">
                      RSI: {latestSignal.rsi14} · MACD: {latestSignal.macd_histogram} · Vol: {latestSignal.volume_ratio}x
                    </p>
                  )}
                </>
              ) : (
                <p className="text-gray-500">No signals yet</p>
              )}
            </Card>

            <Card title="Win Rate">
              {stats && stats.winRate !== null ? (
                <>
                  <p className="text-2xl font-bold">{stats.winRate}%</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {stats.total} signals · {stats.evaluated} evaluated
                  </p>
                  <p className="text-xs text-gray-500">
                    Avg: {formatPct(stats.avgReturn)} · Best: {formatPct(stats.bestReturn)}
                  </p>
                </>
              ) : (
                <p className="text-gray-500">No evaluations yet</p>
              )}
            </Card>
          </div>

          {/* Latest signal detail */}
          {latestSignal && (latestSignal.evaluations?.length ?? 0) > 0 && (
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

          {/* Analytics section */}
          {exitBreakdown.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Exit Reason Breakdown */}
              <div className="rounded border border-gray-800 bg-gray-900 p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Exit Reason Breakdown</h3>
                <div className="space-y-2">
                  {exitBreakdown.map((item) => {
                    const totalEvaluated = exitBreakdown.reduce((s, e) => s + e.count, 0);
                    const pct = totalEvaluated > 0 ? (item.count / totalEvaluated) * 100 : 0;
                    return (
                      <div key={item.reason} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-300">{EXIT_LABELS[item.reason] ?? item.reason}</span>
                          <span className="text-gray-500">
                            {item.count} ({pct.toFixed(0)}%) · WR: {item.winRate}% · Avg: {formatPct(item.avgReturn)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${EXIT_COLORS[item.reason] ?? 'bg-gray-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Confidence Analysis */}
              <div className="rounded border border-gray-800 bg-gray-900 p-4">
                <h3 className="text-sm font-medium text-gray-400 mb-3">Confidence Analysis</h3>
                <div className="space-y-3">
                  {confidenceAnalysis.map((band) => (
                    <div key={band.label} className="flex items-center gap-3 text-sm">
                      <span className="text-gray-500 w-12 text-xs">{band.label}</span>
                      <div className="flex-1 h-6 rounded bg-gray-800 overflow-hidden relative">
                        {band.count > 0 && (
                          <div
                            className={`h-full rounded ${band.avgReturn >= 0 ? 'bg-green-600/50' : 'bg-red-600/50'}`}
                            style={{ width: `${Math.min(Math.abs(band.winRate), 100)}%` }}
                          />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center text-xs text-gray-300">
                          {band.count > 0
                            ? `${band.count} trades · WR ${band.winRate}% · Avg ${formatPct(band.avgReturn)}`
                            : 'No trades'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Equity Curve */}
          {equityCurve.length > 0 && (
            <div className="rounded border border-gray-800 bg-gray-900 p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3">
                Equity Curve (Cumulative Return: {formatPct(equityCurve[equityCurve.length - 1].cumulative)})
              </h3>
              <div className="flex items-end gap-1 h-32">
                {equityCurve.map((point, i) => {
                  const height = (Math.abs(point.cumulative) / maxCumulative) * 100;
                  const isPositive = point.cumulative >= 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 flex flex-col justify-end items-center group relative"
                      style={{ height: '100%' }}
                    >
                      <div
                        className={`w-full rounded-t-sm ${isPositive ? 'bg-green-500/70' : 'bg-red-500/70'} transition-all hover:opacity-100 opacity-80`}
                        style={{ height: `${Math.max(height, 2)}%` }}
                      />
                      <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-300 whitespace-nowrap">
                        {formatDate(point.date)}: {formatPct(point.returnPct)} (Cum: {formatPct(point.cumulative)})
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{equityCurve.length > 0 ? formatDate(equityCurve[0].date) : ''}</span>
                <span>{equityCurve.length > 0 ? formatDate(equityCurve[equityCurve.length - 1].date) : ''}</span>
              </div>
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
