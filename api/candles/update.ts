import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * CryptoCompare public API — daily OHLCV for BTC/USD.
 * Endpoint: GET https://min-api.cryptocompare.com/data/v2/histoday
 * No API key required. No geo-restrictions.
 */

const BASE_URL = 'https://min-api.cryptocompare.com/data/v2/histoday';
const MAX_LIMIT = 2000;

interface CryptoCompareResponse {
  Response: string;
  Message: string;
  Data: {
    Data: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volumefrom: number;
    }>;
  };
}

interface DailyCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchDailyCandles(limit = MAX_LIMIT, toTs?: number): Promise<DailyCandle[]> {
  const params = new URLSearchParams({
    fsym: 'BTC',
    tsym: 'USD',
    limit: String(Math.min(limit, MAX_LIMIT)),
  });
  if (toTs !== undefined) params.set('toTs', String(toTs));

  const r = await fetch(`${BASE_URL}?${params}`);
  if (!r.ok) throw new Error(`CryptoCompare error ${r.status}: ${await r.text()}`);

  const json = (await r.json()) as CryptoCompareResponse;
  if (json.Response === 'Error') throw new Error(`CryptoCompare: ${json.Message}`);

  return json.Data.Data
    .filter((d) => d.close > 0)
    .map((d) => ({
      openTime: d.time * 1000,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volumefrom,
    }));
}

async function fetchAllCandlesSince(startTimeMs: number): Promise<DailyCandle[]> {
  const all: DailyCandle[] = [];
  let toTs: number | undefined = undefined;

  while (true) {
    const batch = await fetchDailyCandles(MAX_LIMIT, toTs);
    if (batch.length === 0) break;

    const relevant = batch.filter((c) => c.openTime >= startTimeMs);
    all.push(...relevant);

    const oldestInBatch = batch[0].openTime;
    if (oldestInBatch <= startTimeMs || batch.length < MAX_LIMIT) break;
    toTs = Math.floor(oldestInBatch / 1000) - 1;
  }

  const seen = new Set<number>();
  return all
    .filter((c) => { if (seen.has(c.openTime)) return false; seen.add(c.openTime); return true; })
    .sort((a, b) => a.openTime - b.openTime);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: latest, error: latestErr } = await supabase
      .from('candles')
      .select('open_time')
      .order('open_time', { ascending: false })
      .limit(1);

    if (latestErr) return res.status(500).json({ error: latestErr.message });

    let candles;
    if (latest && latest.length > 0) {
      candles = await fetchAllCandlesSince(latest[0].open_time + 1);
    } else {
      candles = await fetchDailyCandles();
    }

    if (candles.length === 0) return res.json({ inserted: 0, message: 'Already up to date' });

    const rows = candles.map((k) => ({
      open_time: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      fetched_at: new Date().toISOString(),
    }));

    let totalInserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error: upsertErr } = await supabase
        .from('candles')
        .upsert(batch, { onConflict: 'open_time' });
      if (upsertErr) return res.status(500).json({ error: upsertErr.message, inserted: totalInserted });
      totalInserted += batch.length;
    }

    return res.json({ inserted: totalInserted });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
