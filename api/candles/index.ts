import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // Supabase returns max 1000 rows by default — paginate to get all candles
  const PAGE_SIZE = 1000;
  const allCandles: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('candles')
      .select('*')
      .order('open_time', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) break;

    allCandles.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return res.json(allCandles);
}
