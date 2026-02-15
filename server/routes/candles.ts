import { Router } from 'express';
import { supabase } from '../supabase.js';
import { fetchAllCandlesSince, fetchDailyCandles } from '../binance.js';

export const candlesRouter = Router();

// GET /api/candles — return all stored candles ordered by date (paginated)
candlesRouter.get('/', async (_req, res) => {
  const PAGE = 1000;
  const all: unknown[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('candles')
      .select('*')
      .order('open_time', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  res.json(all);
});

// POST /api/candles/update — fetch new candles from Binance and upsert into DB
candlesRouter.post('/update', async (_req, res) => {
  try {
    // Find the latest candle we already have
    const { data: latest, error: latestErr } = await supabase
      .from('candles')
      .select('open_time')
      .order('open_time', { ascending: false })
      .limit(1);

    if (latestErr) {
      res.status(500).json({ error: latestErr.message });
      return;
    }

    let klines;
    if (latest && latest.length > 0) {
      // Fetch from 1ms after our latest candle
      const startTime = latest[0].open_time + 1;
      klines = await fetchAllCandlesSince(startTime);
    } else {
      // First run — fetch up to 1000 most recent daily candles
      klines = await fetchDailyCandles();
    }

    if (klines.length === 0) {
      res.json({ inserted: 0, message: 'Already up to date' });
      return;
    }

    // Map to DB rows
    const rows = klines.map((k) => ({
      open_time: k.openTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      fetched_at: new Date().toISOString(),
    }));

    // Upsert in batches of 500 (Supabase limit-friendly)
    const BATCH_SIZE = 500;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: upsertErr } = await supabase
        .from('candles')
        .upsert(batch, { onConflict: 'open_time' });

      if (upsertErr) {
        res.status(500).json({ error: upsertErr.message, inserted: totalInserted });
        return;
      }
      totalInserted += batch.length;
    }

    res.json({ inserted: totalInserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
