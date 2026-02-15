import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const { data: signals, error } = await supabase
    .from('signals')
    .select('*, evaluations(*)');

  if (error) return res.status(500).json({ error: error.message });

  const total = signals?.length ?? 0;
  const evaluated = signals?.filter(
    (s) => Array.isArray(s.evaluations) && s.evaluations.length > 0
  ) ?? [];
  const pending = total - evaluated.length;

  const returns = evaluated.map((s) => s.evaluations[0].return_pct as number);
  const wins = returns.filter((r) => r > 0).length;

  return res.json({
    total,
    evaluated: evaluated.length,
    pending,
    winRate: evaluated.length > 0 ? Math.round((wins / evaluated.length) * 10000) / 100 : null,
    avgReturn: returns.length > 0
      ? Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100
      : null,
    bestReturn: returns.length > 0 ? Math.max(...returns) : null,
    worstReturn: returns.length > 0 ? Math.min(...returns) : null,
  });
}
