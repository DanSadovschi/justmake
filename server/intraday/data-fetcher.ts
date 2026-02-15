/**
 * Data Fetcher — retrieves intraday OHLCV candles from external APIs.
 *
 * Strategy:
 *   1. Try CryptoCompare histohour (free, reliable, good history)
 *   2. Aggregate hourly candles into desired LTF/HTF intervals
 *
 * CryptoCompare histohour:
 *   - Max 2000 candles per request
 *   - Paginate backwards with `toTs` parameter
 *   - Uses BTC/USD (close enough for backtesting)
 */

import type { Candle } from './types.js';

const CC_BASE_HOUR = 'https://min-api.cryptocompare.com/data/v2/histohour';
const CC_MAX_LIMIT = 2000;

interface CryptoCompareResponse {
  Response: string;
  Message: string;
  Data: {
    Data: Array<{
      time: number;       // Unix seconds
      open: number;
      high: number;
      low: number;
      close: number;
      volumefrom: number; // BTC volume
    }>;
  };
}

/**
 * Fetch a single page of hourly candles from CryptoCompare.
 */
async function fetchCcHourPage(
  limit: number = CC_MAX_LIMIT,
  toTs?: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    fsym: 'BTC',
    tsym: 'USD',
    limit: String(Math.min(limit, CC_MAX_LIMIT)),
  });
  if (toTs !== undefined) params.set('toTs', String(toTs));

  const url = `${CC_BASE_HOUR}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CryptoCompare error ${res.status}`);

  const json = (await res.json()) as CryptoCompareResponse;
  if (json.Response === 'Error') throw new Error(`CryptoCompare: ${json.Message}`);

  return json.Data.Data
    .filter(d => d.close > 0)
    .map(d => ({
      openTime: d.time * 1000,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volumefrom,
    }));
}

/**
 * Fetch all hourly candles from `startTimeMs` to now.
 * Paginates backwards automatically.
 */
export async function fetchHourlyCandles(startTimeMs: number): Promise<Candle[]> {
  const all: Candle[] = [];
  let toTs: number | undefined;
  let pages = 0;
  const MAX_PAGES = 20; // Safety limit: 20 × 2000 = 40,000 hours ≈ 4.5 years

  while (pages < MAX_PAGES) {
    const batch = await fetchCcHourPage(CC_MAX_LIMIT, toTs);
    if (batch.length === 0) break;

    const relevant = batch.filter(c => c.openTime >= startTimeMs);
    all.push(...relevant);

    const oldest = batch[0].openTime;
    if (oldest <= startTimeMs || batch.length < CC_MAX_LIMIT) break;

    // Next page ends before the oldest candle
    toTs = Math.floor(oldest / 1000) - 1;
    pages++;

    // Small delay to respect rate limits
    await sleep(300);
  }

  // Deduplicate and sort ascending
  const seen = new Set<number>();
  return all
    .filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
    .sort((a, b) => a.openTime - b.openTime);
}

/**
 * Aggregate hourly candles to a target interval.
 * For example, 1h candles → 4h candles.
 */
export function aggregateToInterval(candles: Candle[], targetMs: number): Candle[] {
  if (targetMs <= 3600_000) return candles; // Already hourly or finer

  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    const key = Math.floor(c.openTime / targetMs) * targetMs;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(c);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([key, g]) => ({
      openTime: key,
      open: g[0].open,
      high: Math.max(...g.map(c => c.high)),
      low: Math.min(...g.map(c => c.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((s, c) => s + c.volume, 0),
    }));
}

/**
 * Main entry: fetch all data needed for backtesting.
 * Returns LTF and HTF candle arrays.
 */
export async function fetchBacktestData(
  lookbackDays: number,
  ltfInterval: string,
  htfInterval: string,
): Promise<{ ltfCandles: Candle[]; htfCandles: Candle[] }> {
  const startMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  console.log(`[data-fetcher] Fetching hourly candles from ${new Date(startMs).toISOString()}...`);
  const hourly = await fetchHourlyCandles(startMs);
  console.log(`[data-fetcher] Fetched ${hourly.length} hourly candles`);

  if (hourly.length === 0) {
    throw new Error('No candle data fetched. Check network connectivity.');
  }

  // LTF: hourly candles used directly (1h is the minimum available resolution)
  // For 5m/15m: hourly is the best we can get for free — strategy still works,
  // just fewer signals. The architecture supports any interval.
  const ltfMs = intervalToMs(ltfInterval);
  const htfMs = intervalToMs(htfInterval);

  const ltfCandles = ltfMs <= 3600_000 ? hourly : aggregateToInterval(hourly, ltfMs);
  const htfCandles = aggregateToInterval(hourly, htfMs);

  console.log(`[data-fetcher] LTF (${ltfInterval}): ${ltfCandles.length} candles`);
  console.log(`[data-fetcher] HTF (${htfInterval}): ${htfCandles.length} candles`);

  return { ltfCandles, htfCandles };
}

function intervalToMs(interval: string): number {
  const map: Record<string, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000,
    '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
  };
  return map[interval] ?? 3_600_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
