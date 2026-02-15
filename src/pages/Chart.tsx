import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  type IChartApi,
  ColorType,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import { api, type Candle, type Signal } from '../lib/api';

function toChartTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function computeEma(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) ema.push(closes[i]);
    else ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function formatUsd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const REFRESH_INTERVAL = 60_000; // 60 seconds

export default function Chart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ema20SeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ema50SeriesRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const buildChart = useCallback(async (isUpdate = false) => {
    const [candles, signals] = await Promise.all([
      api.getCandles(),
      api.getSignals(),
    ]);

    if (!containerRef.current) return;

    if (!isUpdate) {
      setLoading(false);
    }

    if (candles.length === 0) {
      setEmpty(true);
      return;
    }
    setEmpty(false);

    // Update timestamp
    const latest = candles[candles.length - 1];
    setLastUpdate(new Date(latest.open_time).toISOString().slice(0, 10));

    // If chart exists and this is an update, just update data
    if (isUpdate && chartRef.current && candleSeriesRef.current) {
      updateSeriesData(candles, signals);
      return;
    }

    // Remove old chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      width: containerRef.current.clientWidth,
      height: 500,
      crosshair: { mode: 0 },
      timeScale: { borderColor: '#374151' },
      rightPriceScale: { borderColor: '#374151' },
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    // EMA lines
    const ema20Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      title: 'EMA20',
    });
    ema20SeriesRef.current = ema20Series;

    const ema50Series = chart.addSeries(LineSeries, {
      color: '#8b5cf6',
      lineWidth: 1,
      title: 'EMA50',
    });
    ema50SeriesRef.current = ema50Series;

    updateSeriesData(candles, signals);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  function updateSeriesData(candles: Candle[], signals: Signal[]) {
    if (!candleSeriesRef.current || !ema20SeriesRef.current || !ema50SeriesRef.current) return;

    candleSeriesRef.current.setData(
      candles.map((c: Candle) => ({
        time: toChartTime(c.open_time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const closes = candles.map((c: Candle) => c.close);
    const ema20Values = computeEma(closes, 20);
    const ema50Values = computeEma(closes, 50);

    ema20SeriesRef.current.setData(
      candles.map((c: Candle, i: number) => ({
        time: toChartTime(c.open_time),
        value: ema20Values[i],
      }))
    );

    ema50SeriesRef.current.setData(
      candles.map((c: Candle, i: number) => ({
        time: toChartTime(c.open_time),
        value: ema50Values[i],
      }))
    );

    // Signal markers
    const signalDates = new Set(signals.map((s: Signal) => toChartTime(s.signal_date)));
    const markers = candles
      .filter((c: Candle) => signalDates.has(toChartTime(c.open_time)))
      .map((c: Candle) => {
        const sig = signals.find(
          (s: Signal) => toChartTime(s.signal_date) === toChartTime(c.open_time)
        );
        const evaluated = sig && sig.evaluations.length > 0;
        const won = evaluated && sig.evaluations[0].return_pct > 0;
        return {
          time: toChartTime(c.open_time),
          position: 'belowBar' as const,
          color: evaluated ? (won ? '#22c55e' : '#ef4444') : '#f59e0b',
          shape: 'arrowUp' as const,
          text: evaluated
            ? `L ${sig!.evaluations[0].return_pct >= 0 ? '+' : ''}${sig!.evaluations[0].return_pct.toFixed(1)}%`
            : 'LONG',
        };
      });

    if (markers.length > 0) {
      createSeriesMarkers(candleSeriesRef.current, markers);
    }
  }

  // Fetch live price
  const fetchLivePrice = useCallback(async () => {
    try {
      const data = await api.getLivePrice();
      setLivePrice(data.price);
    } catch {
      // ignore
    }
  }, []);

  // Initial chart build
  useEffect(() => {
    let cleanupFn: (() => void) | undefined;

    async function init() {
      const cleanup = await buildChart(false);
      if (typeof cleanup === 'function') cleanupFn = cleanup;
      fetchLivePrice();
    }
    init();

    return () => {
      cleanupFn?.();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [buildChart, fetchLivePrice]);

  // Auto-refresh: poll data + live price
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(async () => {
      await Promise.all([
        buildChart(true),
        fetchLivePrice(),
      ]);
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [autoRefresh, buildChart, fetchLivePrice]);

  // Also poll live price more frequently (every 15s)
  useEffect(() => {
    const interval = setInterval(fetchLivePrice, 15_000);
    return () => clearInterval(interval);
  }, [fetchLivePrice]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">BTC/USD Daily Chart</h2>
          <div className="flex items-center gap-3 mt-1">
            {livePrice && (
              <span className="text-sm font-medium text-amber-400">
                Live: {formatUsd(livePrice)}
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse ml-1.5 align-middle" />
              </span>
            )}
            {lastUpdate && (
              <span className="text-xs text-gray-500">
                Data through: {lastUpdate}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`rounded px-3 py-1 text-xs font-medium ${
            autoRefresh
              ? 'bg-green-900/50 text-green-400 border border-green-800'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
          }`}
        >
          {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
        </button>
      </div>

      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-amber-500" /> EMA20
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-violet-500" /> EMA50
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Signal (pending)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" /> Win
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" /> Loss
        </span>
      </div>
      {loading && <p className="text-gray-500">Loading chart data...</p>}
      {empty && <p className="text-gray-500">No data yet. Click "Update Data" on the Dashboard.</p>}
      <div ref={containerRef} className="rounded border border-gray-800" />
    </div>
  );
}
