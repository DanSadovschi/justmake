import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/price — returns current BTC/USD price from CryptoCompare.
 * Lightweight endpoint for live price display.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const r = await fetch(
      'https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD'
    );
    if (!r.ok) throw new Error(`CryptoCompare error ${r.status}`);

    const json = (await r.json()) as { USD: number };
    return res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60').json({
      price: json.USD,
      timestamp: Date.now(),
    });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
