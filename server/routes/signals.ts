import { Router } from 'express';
import { supabase } from '../supabase.js';
import { generateAndEvaluateSignals } from '../engine.js';

export const signalsRouter = Router();

// GET /api/signals — return all signals with their evaluations
signalsRouter.get('/', async (_req, res) => {
  const [sigRes, evalRes] = await Promise.all([
    supabase.from('signals').select('*').order('signal_date', { ascending: false }),
    supabase.from('evaluations').select('*'),
  ]);

  if (sigRes.error) { res.status(500).json({ error: sigRes.error.message }); return; }
  if (evalRes.error) { res.status(500).json({ error: evalRes.error.message }); return; }

  const evalMap = new Map<number, typeof evalRes.data>();
  for (const ev of evalRes.data ?? []) {
    const sid = Number(ev.signal_id);
    if (!evalMap.has(sid)) evalMap.set(sid, []);
    evalMap.get(sid)!.push(ev);
  }

  const merged = (sigRes.data ?? []).map((s) => ({
    ...s,
    evaluations: evalMap.get(Number(s.id)) ?? [],
  }));

  res.json(merged);
});

// GET /api/signals/stats — summary statistics
signalsRouter.get('/stats', async (_req, res) => {
  const [sigRes, evalRes] = await Promise.all([
    supabase.from('signals').select('*'),
    supabase.from('evaluations').select('*'),
  ]);

  if (sigRes.error) { res.status(500).json({ error: sigRes.error.message }); return; }
  if (evalRes.error) { res.status(500).json({ error: evalRes.error.message }); return; }

  const evalMap = new Map<number, (typeof evalRes.data)[number]>();
  for (const ev of evalRes.data ?? []) evalMap.set(Number(ev.signal_id), ev);

  const total = sigRes.data?.length ?? 0;
  const evaluated = (sigRes.data ?? []).filter((s) => evalMap.has(Number(s.id)));
  const pending = total - evaluated.length;

  const returns = evaluated.map((s) => evalMap.get(Number(s.id))!.return_pct as number);
  const wins = returns.filter((r) => r > 0).length;

  res.json({
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
});

// POST /api/signals/generate — run signal engine + evaluation
signalsRouter.post('/generate', async (_req, res) => {
  try {
    const result = await generateAndEvaluateSignals();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
