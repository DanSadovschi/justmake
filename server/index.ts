import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { candlesRouter } from './routes/candles.js';
import { signalsRouter } from './routes/signals.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/candles', candlesRouter);
app.use('/api/signals', signalsRouter);

// GET /api/price — live BTC price from CryptoCompare
app.get('/api/price', async (_req, res) => {
  try {
    const r = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD');
    if (!r.ok) throw new Error(`CryptoCompare error ${r.status}`);
    const json = (await r.json()) as { USD: number };
    res.json({ price: json.USD, timestamp: Date.now() });
  } catch {
    res.status(500).json({ error: 'Failed to fetch live price' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
