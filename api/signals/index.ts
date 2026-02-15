import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const { data, error } = await supabase
    .from('signals')
    .select('*, evaluations(*)')
    .order('signal_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
}
