import { useEffect, useRef, useState } from 'react';
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

export default function Chart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const [candles, signals] = await Promise.all([
        api.getCandles(),
        api.getSignals(),
      ]);

      if (!mounted || !containerRef.current) return;
      setLoading(false);

      if (candles.length === 0) {
        setEmpty(true);
        return;
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

      candleSeries.setData(
        candles.map((c: Candle) => ({
          time: toChartTime(c.open_time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

      // EMA lines
      const closes = candles.map((c: Candle) => c.close);
      const ema20Values = computeEma(closes, 20);
      const ema50Values = computeEma(closes, 50);

      const ema20Series = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 1,
        title: 'EMA20',
      });
      ema20Series.setData(
        candles.map((c: Candle, i: number) => ({
          time: toChartTime(c.open_time),
          value: ema20Values[i],
        }))
      );

      const ema50Series = chart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 1,
        title: 'EMA50',
      });
      ema50Series.setData(
        candles.map((c: Candle, i: number) => ({
          time: toChartTime(c.open_time),
          value: ema50Values[i],
        }))
      );

      // Signal markers on candlestick series
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
        createSeriesMarkers(candleSeries, markers);
      }

      chart.timeScale().fitContent();

      const handleResize = () => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    }

    const cleanup = init();

    return () => {
      mounted = false;
      cleanup.then((fn) => fn?.());
    };
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">BTC/USDT Daily Chart</h2>
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
