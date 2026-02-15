import { useEffect, useState } from 'react';
import { api, type Signal, type ExitReason } from '../lib/api';

function formatDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

const EXIT_LABELS: Record<ExitReason, { label: string; color: string }> = {
  stop_loss:     { label: 'Stop Loss',     color: 'text-red-400 bg-red-900/30' },
  take_profit:   { label: 'Take Profit',   color: 'text-green-400 bg-green-900/30' },
  trailing_stop: { label: 'Trailing Stop', color: 'text-amber-400 bg-amber-900/30' },
  death_cross:   { label: 'Death Cross',   color: 'text-purple-400 bg-purple-900/30' },
  timeout:       { label: 'Timeout',       color: 'text-gray-400 bg-gray-800' },
};

function confidenceBadge(score: number | null) {
  if (score == null) return <span className="text-gray-600">—</span>;
  let color = 'text-gray-400 bg-gray-800';
  if (score >= 75) color = 'text-green-400 bg-green-900/30';
  else if (score >= 50) color = 'text-amber-400 bg-amber-900/30';
  else if (score >= 25) color = 'text-orange-400 bg-orange-900/30';
  else color = 'text-red-400 bg-red-900/30';
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{score}</span>;
}

function rsiBadge(rsi: number | null) {
  if (rsi == null) return <span className="text-gray-600">—</span>;
  let color = 'text-gray-400';
  if (rsi >= 70) color = 'text-red-400';
  else if (rsi >= 60) color = 'text-amber-400';
  else if (rsi >= 40) color = 'text-green-400';
  else if (rsi >= 30) color = 'text-blue-400';
  else color = 'text-red-400';
  return <span className={`text-xs ${color}`}>{rsi.toFixed(1)}</span>;
}

type StatusFilter = 'all' | 'evaluated' | 'pending';

export default function Signals() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    api.getSignals().then(setSignals).finally(() => setLoading(false));
  }, []);

  const filtered = signals.filter((s) => {
    if (filter === 'evaluated') return (s.evaluations?.length ?? 0) > 0;
    if (filter === 'pending') return (s.evaluations?.length ?? 0) === 0;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Signals</h2>
        <div className="flex gap-2 text-sm">
          {(['all', 'evaluated', 'pending'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 capitalize ${
                filter === f
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">No signals found. Click "Update Data" on the Dashboard first.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Dir</th>
                <th className="px-3 py-2">Conf</th>
                <th className="px-3 py-2">RSI</th>
                <th className="px-3 py-2">MACD</th>
                <th className="px-3 py-2">Vol</th>
                <th className="px-3 py-2">Entry</th>
                <th className="px-3 py-2">Exit</th>
                <th className="px-3 py-2">Return</th>
                <th className="px-3 py-2">Exit Reason</th>
                <th className="px-3 py-2">Hold</th>
                <th className="px-3 py-2">Drawdown</th>
                <th className="px-3 py-2">Run-up</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const ev = (s.evaluations?.length ?? 0) > 0 ? s.evaluations[0] : null;
                const exitInfo = ev?.exit_reason ? EXIT_LABELS[ev.exit_reason] : null;
                return (
                  <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(s.signal_date)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-400">
                        {s.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2">{confidenceBadge(s.confidence)}</td>
                    <td className="px-3 py-2">{rsiBadge(s.rsi14)}</td>
                    <td className="px-3 py-2">
                      {s.macd_histogram != null ? (
                        <span className={`text-xs ${s.macd_histogram >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {s.macd_histogram >= 0 ? '+' : ''}{s.macd_histogram.toFixed(0)}
                        </span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {s.volume_ratio != null ? (
                        <span className={`text-xs ${s.volume_ratio >= 1.5 ? 'text-green-400' : s.volume_ratio >= 1 ? 'text-gray-300' : 'text-gray-500'}`}>
                          {s.volume_ratio.toFixed(1)}x
                        </span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {s.entry_price ? formatUsd(s.entry_price) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {ev ? formatUsd(ev.exit_price) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {ev ? (
                        <span className={`font-medium ${ev.return_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatPct(ev.return_pct)}
                        </span>
                      ) : (
                        <span className="text-yellow-400 text-xs">Pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {exitInfo ? (
                        <span className={`rounded px-2 py-0.5 text-xs ${exitInfo.color}`}>
                          {exitInfo.label}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {ev?.hold_days != null ? `${ev.hold_days}d` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {ev ? (
                        <span className="text-red-400">{formatPct(ev.max_adverse_pct)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {ev ? (
                        <span className="text-green-400">{formatPct(ev.max_favorable_pct)}</span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
