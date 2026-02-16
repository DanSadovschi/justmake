/**
 * Data Fetcher — Binance public API, no key needed.
 * Single export: fetchCandles(lookbackDays, interval)
 */

import type { Candle } from './types.js';

const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines';
const LIMIT = 1000;

type BinanceKline = [
  number, string, string, string, string, string,
  number, string, number, string, string, string,
];

const INTERVAL_MS: Record<string, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

async function fetchPage(
  symbol: string,
  interval: string,
  startTime: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    startTime: String(startTime),
    limit: String(LIMIT),
  });

  const res = await fetch(`${BINANCE_KLINES}?${params}`);
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as BinanceKline[];
  return data.map(k => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/**
 * Fetch BTCUSDT candles from Binance.
 * Paginates automatically. ~3 req/s to stay within rate limits.
 */
export async function fetchCandles(
  lookbackDays: number,
  interval: string,
): Promise<Candle[]> {
  const startMs = Date.now() - lookbackDays * 86_400_000;
  const intMs = INTERVAL_MS[interval] ?? 3_600_000;
  const all: Candle[] = [];
  let cursor = startMs;

  console.log(`[data] Fetching BTCUSDT ${interval} from Binance...`);

  for (let page = 0; page < 250; page++) {
    const batch = await fetchPage('BTCUSDT', interval, cursor);
    if (batch.length === 0) break;

    all.push(...batch);
    cursor = batch[batch.length - 1].openTime + intMs;
    if (batch.length < LIMIT || cursor >= Date.now()) break;

    await new Promise(r => setTimeout(r, 350));
    if ((page + 1) % 20 === 0) {
      console.log(`[data] page ${page + 1}, ${all.length} candles...`);
    }
  }

  console.log(`[data] Fetched ${all.length} candles`);

  // Deduplicate
  const seen = new Set<number>();
  return all.filter(c => {
    if (seen.has(c.openTime)) return false;
    seen.add(c.openTime);
    return true;
  });
}
