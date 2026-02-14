import { useEffect, useState } from 'react';
import { api, type Signal } from '../lib/api';

function formatDate(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
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
    if (filter === 'evaluated') return s.evaluations.length > 0;
    if (filter === 'pending') return s.evaluations.length === 0;
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
                <th className="px-3 py-2">Direction</th>
                <th className="px-3 py-2">Entry</th>
                <th className="px-3 py-2">EMA20</th>
                <th className="px-3 py-2">EMA50</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Return</th>
                <th className="px-3 py-2">Max Drawdown</th>
                <th className="px-3 py-2">Max Run-up</th>
                <th className="px-3 py-2">Exit Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const ev = s.evaluations.length > 0 ? s.evaluations[0] : null;
                return (
                  <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(s.signal_date)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-400">
                        {s.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {s.entry_price ? formatUsd(s.entry_price) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{s.ema20.toFixed(0)}</td>
                    <td className="px-3 py-2 text-gray-400">{s.ema50.toFixed(0)}</td>
                    <td className="px-3 py-2">
                      {ev ? (
                        <span className="text-xs text-blue-400">Evaluated</span>
                      ) : (
                        <span className="text-xs text-yellow-400">Pending</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {ev ? (
                        <span className={ev.return_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {formatPct(ev.return_pct)}
                        </span>
                      ) : '—'}
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
                    <td className="px-3 py-2 text-gray-400">
                      {ev ? formatDate(ev.exit_date) : '—'}
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
