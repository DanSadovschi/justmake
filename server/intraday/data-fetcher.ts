/**
 * Data Fetcher — Binance public API (no key needed).
 * Fetches BTC/USDT klines for any interval.
 */

import type { Candle } from './types.js';

const BINANCE_LIMIT = 1000;

export type Interval = '15m' | '1h' | '4h';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${BINANCE_LIMIT}`;

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
 * Fetch BTC/USDT candles from Binance.
 * Paginates forward from startTime.
 */
export async function fetchCandles(
  lookbackDays: number,
  interval: Interval = '1h',
): Promise<Candle[]> {
  const now = Date.now();
  const startMs = now - lookbackDays * 86_400_000;
  const all: Candle[] = [];
  let cursor = startMs;

  console.log(`[data] Fetching BTCUSDT ${interval} from Binance (${lookbackDays} days)...`);

  const maxPages = 200; // 200 × 1000 = 200K candles (enough for 4yr of 15m)
  for (let p = 0; p < maxPages; p++) {
    if (p > 0) await sleep(300);

    const batch = await fetchPage(interval, cursor, now);
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
  return candles;
}
