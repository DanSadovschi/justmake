/**
 * Data Fetcher — Binance public API (no key needed).
 * Fetches BTC/USDT klines for any interval.
 */

import type { Candle } from './types.js';
import { loadCachedCandles, saveCachedCandles } from './cache.js';

const BINANCE_LIMIT = 1000;

export type Interval = '15m' | '1h' | '4h';

/** Map interval → its higher timeframe. Returns null for 4h (highest supported). */
export function htfInterval(interval: Interval): Interval | null {
  if (interval === '15m') return '1h';
  if (interval === '1h') return '4h';
  return null; // 4h has no HTF
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(symbol: string, interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${BINANCE_LIMIT}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);

    if (res.status === 429) {
      const wait = (attempt + 1) * 3000;
      console.log(`[data] Rate limited, waiting ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }

    if (!res.ok) throw new Error(`Binance HTTP ${res.status}: ${res.statusText}`);

    const data = (await res.json()) as unknown[][];
    return data.map(k => ({
      openTime: k[0] as number,
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
    }));
  }
  throw new Error('Binance rate limit exceeded after retries');
}

/**
 * Fetch candles from Binance for any symbol.
 * Paginates forward from startTime.
 */
export async function fetchCandles(
  lookbackDays: number,
  interval: Interval = '1h',
  symbol: string = 'BTCUSDT',
): Promise<Candle[]> {
  const now = Date.now();
  const startMs = now - lookbackDays * 86_400_000;

  console.log(`[DATA] symbol=${symbol} interval=${interval} days=${lookbackDays}`);

  // Check cache first (keyed by rounded hour boundaries for reasonable cache hits)
  const cacheStart = Math.floor(startMs / 3_600_000) * 3_600_000;
  const cacheEnd   = Math.floor(now / 3_600_000) * 3_600_000;
  const cached = loadCachedCandles(symbol, interval, cacheStart, cacheEnd);
  if (cached) return cached;

  console.log(`[data] Fetching ${symbol} ${interval} from Binance (${lookbackDays} days)...`);

  const all: Candle[] = [];
  let cursor = startMs;

  const maxPages = 200; // 200 × 1000 = 200K candles (enough for 4yr of 15m)
  for (let p = 0; p < maxPages; p++) {
    if (p > 0) await sleep(300);

    const batch = await fetchPage(symbol, interval, cursor, now);
    if (batch.length === 0) break;

    all.push(...batch);
    cursor = batch[batch.length - 1].openTime + 1;

    if (batch.length < BINANCE_LIMIT) break;
    if (p > 0) console.log(`[data] page ${p + 1}, ${all.length} candles...`);
  }

  // Deduplicate + sort
  const seen = new Set<number>();
  const candles = all
    .filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
    .sort((a, b) => a.openTime - b.openTime);

  console.log(`[data] Got ${candles.length} ${interval} candles`);

  // Save to cache
  saveCachedCandles(symbol, interval, cacheStart, cacheEnd, candles);

  return candles;
}
