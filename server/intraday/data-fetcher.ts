/**
 * Data Fetcher — retrieves intraday OHLCV candles for BTCUSDT.
 *
 * Sources (priority order):
 *   1. Binance public API — NO API key needed for market data
 *      GET https://api.binance.com/api/v3/klines
 *      Supports: 1m, 5m, 15m, 1h, 4h natively
 *      Max 1000 candles/request, paginate with startTime
 *      Rate limit: 2400 weight/min (klines = 2 weight each)
 *
 *   2. CryptoCompare histohour — fallback if Binance is unreachable
 *      Hourly only, aggregate for HTF
 *
 * Binance klines response format:
 *   [ openTime, open, high, low, close, volume, closeTime, quoteVol, trades, ... ]
 */

import type { Candle } from './types.js';

// ────────────────────── Binance Public API ──────────────────────

const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines';
const BINANCE_LIMIT = 1000;

type BinanceKline = [
  number, string, string, string, string, string,  // openTime, O, H, L, C, vol
  number, string, number, string, string, string,  // closeTime, quoteVol, trades, ...
];

/** Fetch one page of klines from Binance. */
async function fetchBinancePage(
  symbol: string,
  interval: string,
  startTime: number,
  limit = BINANCE_LIMIT,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    startTime: String(startTime),
    limit: String(Math.min(limit, BINANCE_LIMIT)),
  });

  const res = await fetch(`${BINANCE_KLINES}?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance ${res.status}: ${text}`);
  }

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
 * Fetch all candles from Binance for a given interval, paginating forward.
 *
 * For 2 years of 15m data: ~70,000 candles = ~70 requests.
 * For 2 years of 5m data: ~210,000 candles = ~210 requests.
 * For 2 years of 1h data: ~17,500 candles = ~18 requests.
 */
async function fetchBinanceCandles(
  symbol: string,
  interval: string,
  startTimeMs: number,
): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = startTimeMs;
  const intMs = intervalToMs(interval);
  const MAX_PAGES = 250;

  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchBinancePage(symbol, interval, cursor, BINANCE_LIMIT);
    if (batch.length === 0) break;

    all.push(...batch);

    cursor = batch[batch.length - 1].openTime + intMs;
    if (batch.length < BINANCE_LIMIT || cursor >= Date.now()) break;

    // ~3 req/s to stay within rate limits
    await sleep(350);

    // Progress logging every 20 pages
    if ((page + 1) % 20 === 0) {
      console.log(`[binance] page ${page + 1}, ${all.length} candles so far...`);
    }
  }

  // Deduplicate (shouldn't be needed, but safety)
  const seen = new Set<number>();
  return all.filter(c => {
    if (seen.has(c.openTime)) return false;
    seen.add(c.openTime);
    return true;
  });
}

// ────────────────────── CryptoCompare Fallback ──────────────────────

const CC_BASE = 'https://min-api.cryptocompare.com/data/v2/histohour';
const CC_LIMIT = 2000;

interface CcResponse {
  Response: string;
  Message: string;
  Data: { Data: Array<{ time: number; open: number; high: number; low: number; close: number; volumefrom: number }> };
}

async function fetchCcPage(limit = CC_LIMIT, toTs?: number): Promise<Candle[]> {
  const params = new URLSearchParams({ fsym: 'BTC', tsym: 'USD', limit: String(limit) });
  if (toTs !== undefined) params.set('toTs', String(toTs));

  const res = await fetch(`${CC_BASE}?${params}`);
  if (!res.ok) throw new Error(`CryptoCompare ${res.status}`);

  const json = (await res.json()) as CcResponse;
  if (json.Response === 'Error') throw new Error(`CC: ${json.Message}`);

  return json.Data.Data
    .filter(d => d.close > 0)
    .map(d => ({ openTime: d.time * 1000, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volumefrom }));
}

async function fetchCcHourly(startMs: number): Promise<Candle[]> {
  const all: Candle[] = [];
  let toTs: number | undefined;

  for (let p = 0; p < 20; p++) {
    const batch = await fetchCcPage(CC_LIMIT, toTs);
    if (batch.length === 0) break;
    all.push(...batch.filter(c => c.openTime >= startMs));
    const oldest = batch[0].openTime;
    if (oldest <= startMs || batch.length < CC_LIMIT) break;
    toTs = Math.floor(oldest / 1000) - 1;
    await sleep(300);
  }

  const seen = new Set<number>();
  return all.filter(c => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; }).sort((a, b) => a.openTime - b.openTime);
}

// ────────────────────── Aggregation ──────────────────────

export function aggregateToInterval(candles: Candle[], targetMs: number, sourceMs: number): Candle[] {
  if (targetMs <= sourceMs) return candles;

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

// ────────────────────── Main Entry ──────────────────────

/**
 * Fetch LTF + HTF candle data for backtesting.
 *
 * Tries Binance first (native 5m/15m/1h support).
 * Falls back to CryptoCompare hourly if Binance is blocked.
 */
export async function fetchBacktestData(
  lookbackDays: number,
  ltfInterval: string,
  htfInterval: string,
): Promise<{ ltfCandles: Candle[]; htfCandles: Candle[] }> {
  const startMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const ltfMs = intervalToMs(ltfInterval);
  const htfMs = intervalToMs(htfInterval);

  // ── Attempt 1: Binance ──
  try {
    console.log(`[data-fetcher] Trying Binance public API — BTCUSDT ${ltfInterval}...`);

    const ltfCandles = await fetchBinanceCandles('BTCUSDT', ltfInterval, startMs);
    console.log(`[data-fetcher] Binance LTF (${ltfInterval}): ${ltfCandles.length} candles`);

    if (ltfCandles.length < 200) {
      throw new Error(`Insufficient: only ${ltfCandles.length} candles`);
    }

    // HTF: fetch natively or aggregate from LTF
    let htfCandles: Candle[];
    if (htfMs > ltfMs) {
      try {
        htfCandles = await fetchBinanceCandles('BTCUSDT', htfInterval, startMs);
        console.log(`[data-fetcher] Binance HTF (${htfInterval}): ${htfCandles.length} candles`);
      } catch {
        htfCandles = aggregateToInterval(ltfCandles, htfMs, ltfMs);
        console.log(`[data-fetcher] Aggregated HTF: ${htfCandles.length} candles`);
      }
    } else {
      htfCandles = ltfCandles;
    }

    return { ltfCandles, htfCandles };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[data-fetcher] Binance unavailable: ${msg}`);
    console.log(`[data-fetcher] Falling back to CryptoCompare hourly...`);
  }

  // ── Attempt 2: CryptoCompare hourly (fallback) ──
  const hourly = await fetchCcHourly(startMs);
  console.log(`[data-fetcher] CryptoCompare: ${hourly.length} hourly candles`);

  if (hourly.length === 0) {
    throw new Error('No data from Binance or CryptoCompare. Check network.');
  }

  const H = 3_600_000;
  const ltfCandles = ltfMs < H ? hourly : aggregateToInterval(hourly, ltfMs, H);
  const htfCandles = aggregateToInterval(hourly, htfMs, H);

  const actualLtf = ltfMs < H ? '1h (CC fallback)' : ltfInterval;
  console.log(`[data-fetcher] LTF (${actualLtf}): ${ltfCandles.length} candles`);
  console.log(`[data-fetcher] HTF (${htfInterval}): ${htfCandles.length} candles`);

  return { ltfCandles, htfCandles };
}

// ────────────────────── Utils ──────────────────────

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
