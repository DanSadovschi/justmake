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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
