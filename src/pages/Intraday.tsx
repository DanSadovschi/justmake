import { useState } from 'react';
import { fetchJson } from '../lib/api';

// ────────────────────── Types ──────────────────────

interface Metrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  expectancy: number;
  avgRMultiple: number;
  totalReturnPct: number;
  totalPnl: number;
  avgHoldCandles: number;
  maxConsecutiveLosses: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  longPnl: number;
  shortPnl: number;
  trendTrades: number;
  mrTrades: number;
  trendWinRate: number;
  mrWinRate: number;
  trendPnl: number;
  mrPnl: number;
  exitReasonCounts: Record<string, number>;
}

interface SegmentResult {
  metrics: Metrics;
  tradeCount: number;
  trades?: Trade[];
}

interface BacktestResponse {
  success: boolean;
  error?: string;
  timestamp: number;
  full: SegmentResult;
  inSample: SegmentResult;
  outOfSample: SegmentResult;
  trendOnly: SegmentResult;
  mrOnly: SegmentResult;
}

interface Trade {
  id: number;
  direction: 'LONG' | 'SHORT';
  strategy: 'trend_pullback' | 'mean_reversion';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  rMultiple: number;
  holdCandles: number;
  exitReason: string;
  regime: string;
  fees: number;
  fundingPaid: number;
}

interface EquityResponse {
  success: boolean;
  equity: { time: number; equity: number; drawdownPct: number }[];
}

// ────────────────────── Config Form Values ──────────────────────

interface FormConfig {
  ltfInterval: string;
  htfInterval: string;
  marketType: string;
  lookbackDays: number;
  riskPerTrade: number;
  slAtrMultiple: number;
  maxHoldCandles: number;
  initialCapital: number;
}

const defaultForm: FormConfig = {
  ltfInterval: '15m',
  htfInterval: '4h',
  marketType: 'spot',
  lookbackDays: 730,
  riskPerTrade: 1,
  slAtrMultiple: 1.5,
  maxHoldCandles: 192,
  initialCapital: 10000,
};

// ────────────────────── Component ──────────────────────

export default function Intraday() {
  const [form, setForm] = useState<FormConfig>(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [equity, setEquity] = useState<EquityResponse['equity']>([]);
  const [tab, setTab] = useState<'overview' | 'comparison' | 'trades' | 'equity'>('overview');

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJson<BacktestResponse>('/intraday/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ltfInterval: form.ltfInterval,
          htfInterval: form.htfInterval,
          marketType: form.marketType,
          lookbackDays: form.lookbackDays,
          riskPerTrade: form.riskPerTrade / 100,
          slAtrMultiple: form.slAtrMultiple,
          maxHoldCandles: form.maxHoldCandles,
          initialCapital: form.initialCapital,
        }),
      });
      setData(result);

      // Fetch equity curve
      const eq = await fetchJson<EquityResponse>('/intraday/equity');
      if (eq.success) setEquity(eq.equity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Intraday Trading System</h2>
        <span className="text-xs text-gray-500">BTCUSDT | Multi-Timeframe | LONG + SHORT</span>
      </div>

      {/* Config Form */}
      <ConfigForm form={form} setForm={setForm} onRun={runBacktest} loading={loading} />

      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-800 p-4 text-red-300">{error}</div>
      )}

      {data && data.success && (
        <>
          {/* Tab Navigation */}
          <div className="flex gap-1 border-b border-gray-800">
            {(['overview', 'comparison', 'trades', 'equity'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                {t === 'overview' ? 'Overview' : t === 'comparison' ? 'Comparison' : t === 'trades' ? 'Trades' : 'Equity'}
              </button>
            ))}
          </div>

          {tab === 'overview' && <OverviewTab data={data} />}
          {tab === 'comparison' && <ComparisonTab data={data} />}
          {tab === 'trades' && <TradesTab trades={data.full.trades ?? []} />}
          {tab === 'equity' && <EquityTab equity={equity} />}
        </>
      )}
    </div>
  );
}

// ────────────────────── Config Form ──────────────────────

function ConfigForm({
  form, setForm, onRun, loading,
}: {
  form: FormConfig;
  setForm: (f: FormConfig) => void;
  onRun: () => void;
  loading: boolean;
}) {
  const upd = (k: keyof FormConfig, v: string | number) =>
    setForm({ ...form, [k]: typeof form[k] === 'number' ? Number(v) : v });

  return (
    <div className="rounded-lg bg-gray-900 border border-gray-800 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <label className="space-y-1">
          <span className="text-gray-400">LTF Interval</span>
          <select value={form.ltfInterval} onChange={e => upd('ltfInterval', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100">
            <option value="5m">5M (Binance)</option>
            <option value="15m">15M (Binance)</option>
            <option value="1h">1H</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">HTF Interval</span>
          <select value={form.htfInterval} onChange={e => upd('htfInterval', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100">
            <option value="1h">1H</option>
            <option value="4h">4H</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Market Type</span>
          <select value={form.marketType} onChange={e => upd('marketType', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100">
            <option value="spot">Spot</option>
            <option value="perpetual">Perpetual</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Lookback (days)</span>
          <input type="number" value={form.lookbackDays} onChange={e => upd('lookbackDays', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100" />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Risk per Trade (%)</span>
          <input type="number" step="0.1" value={form.riskPerTrade} onChange={e => upd('riskPerTrade', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100" />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">SL (ATR mult)</span>
          <input type="number" step="0.1" value={form.slAtrMultiple} onChange={e => upd('slAtrMultiple', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100" />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Max Hold (candles)</span>
          <input type="number" value={form.maxHoldCandles} onChange={e => upd('maxHoldCandles', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100" />
        </label>
        <label className="space-y-1">
          <span className="text-gray-400">Initial Capital ($)</span>
          <input type="number" value={form.initialCapital} onChange={e => upd('initialCapital', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-100" />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onRun}
          disabled={loading}
          className="px-6 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-medium rounded-lg transition-colors"
        >
          {loading ? 'Running Backtest...' : 'Run Backtest'}
        </button>
      </div>
    </div>
  );
}

// ────────────────────── Overview Tab ──────────────────────

function OverviewTab({ data }: { data: BacktestResponse }) {
  const m = data.full.metrics;
  return (
    <div className="space-y-4">
      {/* Key Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Total Return" value={`${m.totalReturnPct}%`} color={m.totalReturnPct >= 0 ? 'green' : 'red'} />
        <MetricCard label="Win Rate" value={`${m.winRate}%`} color={m.winRate >= 50 ? 'green' : 'amber'} />
        <MetricCard label="Profit Factor" value={m.profitFactor.toFixed(2)} color={m.profitFactor >= 1.5 ? 'green' : 'amber'} />
        <MetricCard label="Total Trades" value={String(m.totalTrades)} color="gray" />
        <MetricCard label="Sharpe Ratio" value={m.sharpeRatio.toFixed(2)} color={m.sharpeRatio >= 1 ? 'green' : 'amber'} />
        <MetricCard label="Sortino Ratio" value={m.sortinoRatio.toFixed(2)} color={m.sortinoRatio >= 1.5 ? 'green' : 'amber'} />
        <MetricCard label="Max Drawdown" value={`${m.maxDrawdownPct}%`} color={m.maxDrawdownPct <= 10 ? 'green' : 'red'} />
        <MetricCard label="Expectancy" value={`$${m.expectancy.toFixed(2)}`} color={m.expectancy > 0 ? 'green' : 'red'} />
        <MetricCard label="Avg R Multiple" value={m.avgRMultiple.toFixed(2)} color={m.avgRMultiple > 0 ? 'green' : 'red'} />
        <MetricCard label="Avg Hold" value={`${m.avgHoldCandles.toFixed(0)} bars`} color="gray" />
        <MetricCard label="Max Consec Losses" value={String(m.maxConsecutiveLosses)} color={m.maxConsecutiveLosses <= 5 ? 'green' : 'red'} />
        <MetricCard label="Total PnL" value={`$${m.totalPnl.toFixed(2)}`} color={m.totalPnl >= 0 ? 'green' : 'red'} />
      </div>

      {/* Long vs Short */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-gray-900 border border-gray-800 p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Long Performance</h3>
          <div className="space-y-2 text-sm">
            <Row label="Trades" value={String(m.longTrades)} />
            <Row label="Win Rate" value={`${m.longWinRate}%`} />
            <Row label="PnL" value={`$${m.longPnl.toFixed(2)}`} color={m.longPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
          </div>
        </div>
        <div className="rounded-lg bg-gray-900 border border-gray-800 p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Short Performance</h3>
          <div className="space-y-2 text-sm">
            <Row label="Trades" value={String(m.shortTrades)} />
            <Row label="Win Rate" value={`${m.shortWinRate}%`} />
            <Row label="PnL" value={`$${m.shortPnl.toFixed(2)}`} color={m.shortPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
          </div>
        </div>
      </div>

      {/* Exit Reasons */}
      <div className="rounded-lg bg-gray-900 border border-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Exit Reasons</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {Object.entries(m.exitReasonCounts).map(([reason, count]) => (
            <div key={reason} className="flex justify-between bg-gray-800 rounded px-3 py-1.5">
              <span className="text-gray-300">{formatExitReason(reason)}</span>
              <span className="font-mono text-gray-100">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────── Comparison Tab ──────────────────────

function ComparisonTab({ data }: { data: BacktestResponse }) {
  const segments = [
    { label: 'Combined (Full)', m: data.full.metrics, count: data.full.tradeCount },
    { label: 'In-Sample (70%)', m: data.inSample.metrics, count: data.inSample.tradeCount },
    { label: 'Out-of-Sample (30%)', m: data.outOfSample.metrics, count: data.outOfSample.tradeCount },
    { label: 'Trend Pullback Only', m: data.trendOnly.metrics, count: data.trendOnly.tradeCount },
    { label: 'Mean Reversion Only', m: data.mrOnly.metrics, count: data.mrOnly.tradeCount },
  ];

  const cols = ['Trades', 'Win%', 'PF', 'Sharpe', 'Sortino', 'MaxDD%', 'Return%', 'PnL', 'AvgR'];

  return (
    <div className="rounded-lg bg-gray-900 border border-gray-800 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-gray-400">
            <th className="text-left px-3 py-2">Segment</th>
            {cols.map(c => <th key={c} className="text-right px-3 py-2">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {segments.map(({ label, m }) => (
            <tr key={label} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="px-3 py-2 font-medium text-gray-200">{label}</td>
              <td className="text-right px-3 py-2 font-mono">{m.totalTrades}</td>
              <td className="text-right px-3 py-2 font-mono">{m.winRate}</td>
              <td className="text-right px-3 py-2 font-mono">{m.profitFactor.toFixed(2)}</td>
              <td className="text-right px-3 py-2 font-mono">{m.sharpeRatio.toFixed(2)}</td>
              <td className="text-right px-3 py-2 font-mono">{m.sortinoRatio.toFixed(2)}</td>
              <td className="text-right px-3 py-2 font-mono text-red-400">{m.maxDrawdownPct}</td>
              <td className={`text-right px-3 py-2 font-mono ${m.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {m.totalReturnPct}%
              </td>
              <td className={`text-right px-3 py-2 font-mono ${m.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${m.totalPnl.toFixed(0)}
              </td>
              <td className="text-right px-3 py-2 font-mono">{m.avgRMultiple.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────── Trades Tab ──────────────────────

function TradesTab({ trades }: { trades: Trade[] }) {
  const [filter, setFilter] = useState<'all' | 'LONG' | 'SHORT' | 'trend_pullback' | 'mean_reversion'>('all');
  const filtered = trades.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'LONG' || filter === 'SHORT') return t.direction === filter;
    return t.strategy === filter;
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['all', 'LONG', 'SHORT', 'trend_pullback', 'mean_reversion'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full border ${
              filter === f ? 'border-amber-400 text-amber-400' : 'border-gray-700 text-gray-400 hover:text-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : f === 'trend_pullback' ? 'Trend' : f === 'mean_reversion' ? 'MR' : f}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500">{filtered.length} trades</span>
      </div>

      <div className="rounded-lg bg-gray-900 border border-gray-800 overflow-x-auto max-h-[500px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 z-10">
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="text-left px-2 py-1.5">#</th>
              <th className="text-left px-2 py-1.5">Dir</th>
              <th className="text-left px-2 py-1.5">Strategy</th>
              <th className="text-left px-2 py-1.5">Entry</th>
              <th className="text-right px-2 py-1.5">Entry $</th>
              <th className="text-right px-2 py-1.5">Exit $</th>
              <th className="text-right px-2 py-1.5">PnL</th>
              <th className="text-right px-2 py-1.5">R</th>
              <th className="text-right px-2 py-1.5">Hold</th>
              <th className="text-left px-2 py-1.5">Exit</th>
              <th className="text-left px-2 py-1.5">Regime</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id} className="border-b border-gray-800/30 hover:bg-gray-800/20">
                <td className="px-2 py-1 text-gray-500">{t.id}</td>
                <td className="px-2 py-1">
                  <span className={`font-medium ${t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                    {t.direction}
                  </span>
                </td>
                <td className="px-2 py-1 text-gray-300">
                  {t.strategy === 'trend_pullback' ? 'Trend' : 'MR'}
                </td>
                <td className="px-2 py-1 text-gray-400">{new Date(t.entryTime).toLocaleDateString()}</td>
                <td className="px-2 py-1 text-right font-mono">{t.entryPrice.toFixed(0)}</td>
                <td className="px-2 py-1 text-right font-mono">{t.exitPrice.toFixed(0)}</td>
                <td className={`px-2 py-1 text-right font-mono ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${t.pnl.toFixed(2)}
                </td>
                <td className={`px-2 py-1 text-right font-mono ${t.rMultiple >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {t.rMultiple.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-gray-400">{t.holdCandles}</td>
                <td className="px-2 py-1 text-gray-300">{formatExitReason(t.exitReason)}</td>
                <td className="px-2 py-1 text-gray-500">{t.regime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────── Equity Tab ──────────────────────

function EquityTab({ equity }: { equity: { time: number; equity: number; drawdownPct: number }[] }) {
  if (equity.length === 0) {
    return <div className="text-gray-500 text-sm">No equity data available.</div>;
  }

  const maxEquity = Math.max(...equity.map(e => e.equity));
  const minEquity = Math.min(...equity.map(e => e.equity));
  const range = maxEquity - minEquity || 1;
  const maxDd = Math.max(...equity.map(e => e.drawdownPct));

  // SVG chart
  const w = 800, h = 300, pad = 40;
  const chartW = w - pad * 2;
  const chartH = h - pad * 2;

  const points = equity.map((e, i) => {
    const x = pad + (i / (equity.length - 1)) * chartW;
    const y = pad + chartH - ((e.equity - minEquity) / range) * chartH;
    return `${x},${y}`;
  }).join(' ');

  // Drawdown area
  const ddPoints = equity.map((e, i) => {
    const x = pad + (i / (equity.length - 1)) * chartW;
    const y = pad + (e.drawdownPct / (maxDd || 1)) * (chartH * 0.3);
    return `${x},${y}`;
  });
  const ddPath = `M${pad},${pad} ` + ddPoints.join(' L') + ` L${pad + chartW},${pad} Z`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Final Equity" value={`$${equity[equity.length - 1].equity.toFixed(0)}`} color="green" />
        <MetricCard label="Peak Equity" value={`$${maxEquity.toFixed(0)}`} color="gray" />
        <MetricCard label="Max Drawdown" value={`${maxDd.toFixed(2)}%`} color="red" />
      </div>

      <div className="rounded-lg bg-gray-900 border border-gray-800 p-4">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Equity Curve</h3>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 350 }}>
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = pad + chartH * (1 - pct);
            const val = minEquity + range * pct;
            return (
              <g key={pct}>
                <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#374151" strokeWidth="0.5" />
                <text x={pad - 4} y={y + 3} textAnchor="end" fill="#6b7280" fontSize="9">
                  ${val.toFixed(0)}
                </text>
              </g>
            );
          })}
          {/* Drawdown area */}
          <path d={ddPath} fill="#991b1b" opacity="0.2" />
          {/* Equity line */}
          <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

// ────────────────────── Shared Components ──────────────────────

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    gray: 'text-gray-100',
  };
  return (
    <div className="rounded-lg bg-gray-900 border border-gray-800 p-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-lg font-bold font-mono ${colorMap[color] ?? 'text-gray-100'}`}>{value}</div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={`font-mono ${color ?? 'text-gray-100'}`}>{value}</span>
    </div>
  );
}

function formatExitReason(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
