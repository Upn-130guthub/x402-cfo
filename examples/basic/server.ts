import express from 'express';
import { tollbooth, tollboothStats } from '../../src/index.js';

const app = express();
app.use(express.json());

// ---- Free endpoint ----
app.get('/api/free', (_req, res) => {
  res.json({ message: 'This endpoint is free. No payment needed.' });
});

// ---- Paid endpoint — one line ----
const gate = tollbooth({
  price: '0.25',
  currency: 'USDC',
  network: 'base',
  recipient: '0xYourWalletAddress',
  onPaymentVerified: (receipt) => {
    console.log(`  ✅ Received $${receipt.amount} ${receipt.currency}`);
  },
  onChallenge: (ch) => {
    console.log(`  🚧 Challenge issued: ${ch.id.slice(0, 8)}…`);
  },
});

app.use('/api/premium', gate);

app.get('/api/premium/data', (req, res) => {
  res.json({
    message: 'Premium data unlocked!',
    data: { market: 'BTC/USD', price: 67234.50, timestamp: new Date().toISOString() },
    receipt: req.tollbooth,
  });
});

// ---- Stats ----
app.get('/_tollbooth/stats', tollboothStats(gate));

// ---- Start ----
app.listen(4242, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║     Tollbooth — Basic Example            ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log('  ║  http://localhost:4242                    ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log('  ║  GET /api/free           → 200 (free)    ║');
  console.log('  ║  GET /api/premium/data   → 402 (paid)    ║');
  console.log('  ║  GET /_tollbooth/stats   → metrics       ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
