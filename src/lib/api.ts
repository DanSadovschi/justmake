const BASE = '/api';

export async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface Candle {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
  id: number;
  signal_date: number;
  direction: 'LONG';
  entry_price: number | null;
  ema20: number;
  ema50: number;
  reasoning: Record<string, unknown>;
  created_at: string;
  evaluations: Evaluation[];
}

export interface Evaluation {
  id: number;
  signal_id: number;
  entry_price: number;
  exit_price: number;
  exit_date: number;
  return_pct: number;
  max_adverse_pct: number;
  max_favorable_pct: number;
}

export interface Stats {
  total: number;
  evaluated: number;
  pending: number;
  winRate: number | null;
  avgReturn: number | null;
  bestReturn: number | null;
  worstReturn: number | null;
}

export interface LivePrice {
  price: number;
  timestamp: number;
}

export const api = {
  getCandles: () => fetchJson<Candle[]>('/candles'),
  getSignals: () => fetchJson<Signal[]>('/signals'),
  getStats: () => fetchJson<Stats>('/signals/stats'),
  getLivePrice: () => fetchJson<LivePrice>('/price'),
  updateData: () => fetchJson<{ inserted: number }>('/candles/update', { method: 'POST' }),
  generateSignals: () => fetchJson<{ generated: number; evaluated: number }>('/signals/generate', { method: 'POST' }),
};
