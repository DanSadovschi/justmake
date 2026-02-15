/**
 * CryptoCompare public API client — fetches daily OHLCV candles for BTC/USD.
 *
 * Endpoint: GET https://min-api.cryptocompare.com/data/v2/histoday
 * Docs: https://min-api.cryptocompare.com/documentation?key=Historical&cat=dataHistoday
 *
 * No API key required for basic usage. No geo-restrictions.
 * Note: uses BTC/USD (not USDT) — acceptable for a demo.
 */

export interface DailyCandle {
  openTime: number;   // Unix ms (converted from CryptoCompare's Unix seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BASE_URL = 'https://min-api.cryptocompare.com/data/v2/histoday';
const MAX_LIMIT = 2000;

interface CryptoCompareResponse {
  Response: string;
  Message: string;
  Data: {
    Data: Array<{
      time: number;      // Unix seconds
      open: number;
      high: number;
      low: number;
      close: number;
      volumefrom: number; // BTC volume
    }>;
  };
}

/**
 * Fetch daily candles from CryptoCompare.
 * @param limit - Number of candles (max 2000).
 * @param toTs - Unix seconds, fetch candles ending at this time. Omit for latest.
 */
export async function fetchDailyCandles(
  limit: number = MAX_LIMIT,
  toTs?: number,
): Promise<DailyCandle[]> {
  const params = new URLSearchParams({
    fsym: 'BTC',
    tsym: 'USD',
    limit: String(Math.min(limit, MAX_LIMIT)),
  });

  if (toTs !== undefined) {
    params.set('toTs', String(toTs));
  }

  const url = `${BASE_URL}?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CryptoCompare API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as CryptoCompareResponse;

  if (json.Response === 'Error') {
    throw new Error(`CryptoCompare: ${json.Message}`);
  }

  return json.Data.Data
    .filter((d) => d.close > 0) // filter out empty/zero candles
    .map((d) => ({
      openTime: d.time * 1000,    // convert seconds → ms for our schema
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volumefrom,
    }));
}

/**
 * Fetch all candles from a given startTime (Unix ms) to now, paginating backwards.
 */
export async function fetchAllCandlesSince(startTimeMs: number): Promise<DailyCandle[]> {
  // CryptoCompare paginates backwards with `toTs`.
  // Strategy: fetch latest 2000, then keep going back if needed.
  const all: DailyCandle[] = [];
  let toTs: number | undefined = undefined;

  while (true) {
    const batch = await fetchDailyCandles(MAX_LIMIT, toTs);
    if (batch.length === 0) break;

    // Filter to only candles >= startTimeMs
    const relevant = batch.filter((c) => c.openTime >= startTimeMs);
    all.push(...relevant);

    // If the oldest candle in this batch is still newer than startTime,
    // we need to go further back
    const oldestInBatch = batch[0].openTime;
    if (oldestInBatch <= startTimeMs || batch.length < MAX_LIMIT) break;

    // Next page ends 1 second before the oldest candle
    toTs = Math.floor(oldestInBatch / 1000) - 1;
  }

  // Deduplicate and sort ascending
  const seen = new Set<number>();
  const unique = all.filter((c) => {
    if (seen.has(c.openTime)) return false;
    seen.add(c.openTime);
    return true;
  });

  return unique.sort((a, b) => a.openTime - b.openTime);
}
