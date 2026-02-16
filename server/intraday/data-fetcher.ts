/**
 * Data Fetcher — CryptoCompare hourly via curl.
 * Uses curl because Node.js fetch has DNS issues in some environments.
 * Single export: fetchCandles(lookbackDays, interval)
 */

import { execSync } from 'child_process';
import type { Candle } from './types.js';

const CC_LIMIT = 2000;

interface CcResponse {
  Response: string;
  Message: string;
  Data: {
    Data: Array<{
      time: number; open: number; high: number;
      low: number; close: number; volumefrom: number;
    }>;
  };
}

function curlJson<T>(url: string): T {
  const out = execSync(`curl -s "${url}"`, { timeout: 30_000 });
  return JSON.parse(out.toString()) as T;
}

function fetchCcPage(limit = CC_LIMIT, toTs?: number): Candle[] {
  let url = `https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=${limit}`;
  if (toTs !== undefined) url += `&toTs=${toTs}`;

  const json = curlJson<CcResponse>(url);
  if (json.Response === 'Error') throw new Error(`CC: ${json.Message}`);

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
 * Fetch BTC/USD hourly candles from CryptoCompare.
 * Paginates backwards from now. Max ~2000 candles per request.
 */
export function fetchCandles(
  lookbackDays: number,
  _interval: string,
): Candle[] {
  const startMs = Date.now() - lookbackDays * 86_400_000;
  const all: Candle[] = [];
  let toTs: number | undefined;

  console.log(`[data] Fetching BTC/USD hourly from CryptoCompare (${lookbackDays} days)...`);

  for (let p = 0; p < 20; p++) {
    const batch = fetchCcPage(CC_LIMIT, toTs);
    if (batch.length === 0) break;

    all.push(...batch.filter(c => c.openTime >= startMs));
    const oldest = batch[0].openTime;
    if (oldest <= startMs || batch.length < CC_LIMIT) break;
    toTs = Math.floor(oldest / 1000) - 1;

    if (p > 0) console.log(`[data] page ${p + 1}, ${all.length} candles so far...`);
  }

  // Deduplicate + sort
  const seen = new Set<number>();
  const candles = all
    .filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
    .sort((a, b) => a.openTime - b.openTime);

  console.log(`[data] Got ${candles.length} hourly candles`);
  return candles;
}
