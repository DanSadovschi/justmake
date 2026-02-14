/**
 * Binance public API client — fetches daily OHLCV candles for BTCUSDT.
 *
 * Endpoint: GET https://api.binance.com/api/v3/klines
 * Docs: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
 *
 * No API key required for public market data.
 */

export interface BinanceKline {
  openTime: number;   // Unix ms
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

const BASE_URL = 'https://api.binance.com/api/v3/klines';
const SYMBOL = 'BTCUSDT';
const INTERVAL = '1d';
const MAX_LIMIT = 1000;

/**
 * Fetch daily candles from Binance.
 * @param startTime - Unix ms, inclusive. If omitted, fetches the latest `limit` candles.
 * @param limit - Number of candles (max 1000).
 */
export async function fetchDailyCandles(
  startTime?: number,
  limit: number = MAX_LIMIT,
): Promise<BinanceKline[]> {
  const params = new URLSearchParams({
    symbol: SYMBOL,
    interval: INTERVAL,
    limit: String(Math.min(limit, MAX_LIMIT)),
  });

  if (startTime !== undefined) {
    params.set('startTime', String(startTime));
  }

  const url = `${BASE_URL}?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance API error ${res.status}: ${text}`);
  }

  const raw = (await res.json()) as unknown[][];

  return raw.map((k) => ({
    openTime: k[0] as number,
    open: k[1] as string,
    high: k[2] as string,
    low: k[3] as string,
    close: k[4] as string,
    volume: k[5] as string,
  }));
}

/**
 * Fetch all candles from `startTime` to now, paginating in chunks of 1000.
 */
export async function fetchAllCandlesSince(startTime: number): Promise<BinanceKline[]> {
  const all: BinanceKline[] = [];
  let cursor = startTime;

  while (true) {
    const batch = await fetchDailyCandles(cursor, MAX_LIMIT);
    if (batch.length === 0) break;

    all.push(...batch);

    // Next page starts 1ms after the last candle's open_time
    const lastOpenTime = batch[batch.length - 1].openTime;
    cursor = lastOpenTime + 1;

    // If we got fewer than MAX_LIMIT, we've reached the end
    if (batch.length < MAX_LIMIT) break;
  }

  return all;
}
