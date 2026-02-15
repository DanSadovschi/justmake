import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

const BASE_URL = 'https://api.binance.com/api/v3/klines';

async function fetchDailyCandles(startTime?: number, limit = 1000): Promise<BinanceKline[]> {
  const params = new URLSearchParams({
    symbol: 'BTCUSDT',
    interval: '1d',
    limit: String(Math.min(limit, 1000)),
  });
  if (startTime !== undefined) params.set('startTime', String(startTime));

  const r = await fetch(`${BASE_URL}?${params}`);
  if (!r.ok) throw new Error(`Binance API error ${r.status}: ${await r.text()}`);

  const raw = (await r.json()) as unknown[][];
  return raw.map((k) => ({
    openTime: k[0] as number,
    open: k[1] as string,
    high: k[2] as string,
    low: k[3] as string,
    close: k[4] as string,
    volume: k[5] as string,
  }));
}

async function fetchAllCandlesSince(startTime: number): Promise<BinanceKline[]> {
  const all: BinanceKline[] = [];
  let cursor = startTime;
  while (true) {
    const batch = await fetchDailyCandles(cursor, 1000);
    if (batch.length === 0) break;
    all.push(...batch);
    cursor = batch[batch.length - 1].openTime + 1;
    if (batch.length < 1000) break;
  }
  return all;
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

    let klines;
    if (latest && latest.length > 0) {
      klines = await fetchAllCandlesSince(latest[0].open_time + 1);
    } else {
      klines = await fetchDailyCandles();
    }

    if (klines.length === 0) return res.json({ inserted: 0, message: 'Already up to date' });

    const rows = klines.map((k) => ({
      open_time: k.openTime,
      open: parseFloat(k.open),
      high: parseFloat(k.high),
      low: parseFloat(k.low),
      close: parseFloat(k.close),
      volume: parseFloat(k.volume),
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
