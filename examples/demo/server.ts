import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tollbooth, tollboothStats } from '../../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ---- Health ----
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tollbooth-demo', timestamp: new Date().toISOString() });
});

// ---- Tiered paywalls ----

const marketGate = tollbooth({
  price: '0.10',
  currency: 'USDC',
  network: 'base',
  recipient: '0xDemoRecipient',
  description: 'Real-time market data. $0.10 per request.',
  onChallenge: (ch) => console.log(`  ⚡ challenge issued: ${ch.id.slice(0, 8)}… ($0.10)`),
  onPaymentVerified: (r) => console.log(`  ✅ paid $${r.amount} → ${r.recipient.slice(0, 10)}…`),
  onPaymentFailed: (err) => console.log(`  ❌ failed: ${err}`),
});

const analysisGate = tollbooth({
  price: '0.50',
  currency: 'USDC',
  network: 'base',
  recipient: '0xDemoRecipient',
  description: 'AI-powered market analysis. $0.50 per request.',
  onChallenge: (ch) => console.log(`  ⚡ challenge issued: ${ch.id.slice(0, 8)}… ($0.50)`),
  onPaymentVerified: (r) => console.log(`  ✅ paid $${r.amount} → ${r.recipient.slice(0, 10)}…`),
  onPaymentFailed: (err) => console.log(`  ❌ failed: ${err}`),
});

const bulkGate = tollbooth({
  price: '2.00',
  currency: 'USDC',
  network: 'base',
  recipient: '0xDemoRecipient',
  description: 'Bulk historical data export. $2.00 per request.',
  onChallenge: (ch) => console.log(`  ⚡ challenge issued: ${ch.id.slice(0, 8)}… ($2.00)`),
  onPaymentVerified: (r) => console.log(`  ✅ paid $${r.amount} → ${r.recipient.slice(0, 10)}…`),
  onPaymentFailed: (err) => console.log(`  ❌ failed: ${err}`),
});

// ---- Mount paywalled routes ----

app.use('/api/v1/market', marketGate);
app.get('/api/v1/market', (req, res) => {
  res.json({
    data: {
      pair: 'ETH/USD', price: 3847.62, change24h: '+2.4%',
      volume: '1.2B', high24h: 3912.00, low24h: 3781.44,
      timestamp: new Date().toISOString(),
    },
    receipt: req.tollbooth,
  });
});

app.use('/api/v1/analyze', analysisGate);
app.post('/api/v1/analyze', (req, res) => {
  res.json({
    analysis: {
      input: req.body,
      sentiment: 'bullish', confidence: 0.87,
      signals: ['volume breakout', 'RSI oversold recovery', 'MACD crossover'],
      recommendation: 'Accumulate on pullback to $3,780 support',
    },
    receipt: req.tollbooth,
  });
});

app.use('/api/v1/export', bulkGate);
app.get('/api/v1/export', (req, res) => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
    open: +(3700 + Math.random() * 300).toFixed(2),
    close: +(3700 + Math.random() * 300).toFixed(2),
    volume: `${(800 + Math.random() * 600).toFixed(0)}M`,
  }));
  res.json({ data: rows, count: rows.length, receipt: req.tollbooth });
});

// ---- Stats ----
app.get('/_tollbooth/stats', (_req, res) => {
  const m = (marketGate as any).__metrics?.snapshot() ?? {};
  const a = (analysisGate as any).__metrics?.snapshot() ?? {};
  const b = (bulkGate as any).__metrics?.snapshot() ?? {};

  res.json({
    market: m,
    analysis: a,
    export: b,
    combined: {
      totalChallenges: (m.totalChallenges ?? 0) + (a.totalChallenges ?? 0) + (b.totalChallenges ?? 0),
      totalPayments: (m.totalPayments ?? 0) + (a.totalPayments ?? 0) + (b.totalPayments ?? 0),
      totalFailures: (m.totalFailures ?? 0) + (a.totalFailures ?? 0) + (b.totalFailures ?? 0),
      revenue: (parseFloat(m.revenue ?? '0') + parseFloat(a.revenue ?? '0') + parseFloat(b.revenue ?? '0')).toFixed(2),
    },
  });
});

// ---- Available endpoints (for the UI) ----
app.get('/_tollbooth/endpoints', (_req, res) => {
  res.json([
    { path: '/api/v1/market', method: 'GET',  price: '0.10', label: 'Market Data',     desc: 'Real-time ETH/USD price feed' },
    { path: '/api/v1/analyze', method: 'POST', price: '0.50', label: 'AI Analysis',    desc: 'Sentiment & signal analysis' },
    { path: '/api/v1/export',  method: 'GET',  price: '2.00', label: 'Bulk Export',    desc: '30-day historical OHLCV data' },
  ]);
});

// ---- Static UI ----
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 4242;
app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║     Tollbooth Demo — x402 Paywall            ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  http://localhost:${PORT}                        ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║  GET  /api/v1/market   → $0.10 USDC         ║');
  console.log('  ║  POST /api/v1/analyze  → $0.50 USDC         ║');
  console.log('  ║  GET  /api/v1/export   → $2.00 USDC         ║');
  console.log('  ║  GET  /_tollbooth/stats → Live metrics       ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
