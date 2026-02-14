import { Router } from 'express';
import { supabase } from '../supabase.js';

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
