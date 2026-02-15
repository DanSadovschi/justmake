import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

async function fetchDailyCandles(limit = MAX_LIMIT, toTs?: number) {
  const params = new URLSearchParams({
    fsym: 'BTC',
    tsym: 'USD',
    limit: String(Math.min(limit, MAX_LIMIT)),
  });
  if (toTs !== undefined) params.set('toTs', String(toTs));

  const r = await fetch(`${BASE_URL}?${params}`);
  if (!r.ok) throw new Error(`CryptoCompare error ${r.status}`);

  const json = (await r.json()) as CryptoCompareResponse;
  if (json.Response === 'Error') throw new Error(`CryptoCompare: ${json.Message}`);

  return json.Data.Data.filter((d) => d.close > 0).map((d) => ({
    openTime: d.time * 1000,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volumefrom,
  }));
}

/**
 * GET /api/cron/update — called by Vercel Cron every hour.
 * Fetches latest candles and triggers signal generation.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret if set (Vercel sends CRON_SECRET header)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Get latest candle timestamp
    const { data: latest, error: latestErr } = await supabase
      .from('candles')
      .select('open_time')
      .order('open_time', { ascending: false })
      .limit(1);

    if (latestErr) throw new Error(latestErr.message);

    // 2. Fetch new candles
    let candles;
    if (latest && latest.length > 0) {
      const startTime = latest[0].open_time + 1;
      candles = (await fetchDailyCandles(100)).filter((c) => c.openTime >= startTime);
    } else {
      candles = await fetchDailyCandles();
    }

    // 3. Upsert candles
    let totalInserted = 0;
    if (candles.length > 0) {
      const rows = candles.map((k) => ({
        open_time: k.openTime,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        fetched_at: new Date().toISOString(),
      }));

      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: upsertErr } = await supabase
          .from('candles')
          .upsert(batch, { onConflict: 'open_time' });
        if (upsertErr) throw new Error(upsertErr.message);
        totalInserted += batch.length;
      }
    }

    return res.json({
      ok: true,
      inserted: totalInserted,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
