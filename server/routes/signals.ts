import { Router } from 'express';
import { supabase } from '../supabase.js';
import { generateAndEvaluateSignals } from '../engine.js';

export const signalsRouter = Router();

// GET /api/signals — return all signals with their evaluations
signalsRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('signals')
    .select('*, evaluations(*)')
    .order('signal_date', { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});

// GET /api/signals/stats — summary statistics
signalsRouter.get('/stats', async (_req, res) => {
  const { data: signals, error } = await supabase
    .from('signals')
    .select('*, evaluations(*)');

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  const total = signals?.length ?? 0;
  const evaluated = signals?.filter(
    (s) => Array.isArray(s.evaluations) && s.evaluations.length > 0
  ) ?? [];
  const pending = total - evaluated.length;

  const returns = evaluated.map((s) => s.evaluations[0].return_pct);
  const wins = returns.filter((r: number) => r > 0).length;

  res.json({
    total,
    evaluated: evaluated.length,
    pending,
    winRate: evaluated.length > 0 ? Math.round((wins / evaluated.length) * 10000) / 100 : null,
    avgReturn: returns.length > 0
      ? Math.round((returns.reduce((a: number, b: number) => a + b, 0) / returns.length) * 100) / 100
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
