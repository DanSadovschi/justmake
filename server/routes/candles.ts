import { Router } from 'express';
import { supabase } from '../supabase.js';

export const candlesRouter = Router();

// GET /api/candles — return all stored candles ordered by date
candlesRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('candles')
    .select('*')
    .order('open_time', { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data);
});
