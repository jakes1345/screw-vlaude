require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const aiRouter = require('./routes/ai');
const filesRouter = require('./routes/files');
const gitRouter = require('./routes/git');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/ai', aiRouter);
app.use('/api/files', filesRouter);
app.use('/api/git', gitRouter);

app.get('/api/config', (req, res) => {
  res.json({
    hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
    hasGoogle: !!process.env.GOOGLE_API_KEY,
    tabbyApiUrl: process.env.TABBY_API_URL || null,
    workspaceDir: process.env.WORKSPACE_DIR || path.join(process.env.HOME, 'screw-claude-workspace')
  });
});

app.get('/api/models', (req, res) => {
  const models = [];
  if (process.env.ANTHROPIC_API_KEY) {
    models.push(
      { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', provider: 'anthropic', tier: 'premium', costPer1M: { input: 15, output: 75 } },
      { id: 'claude-sonnet-4-5-20251022', name: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'standard', costPer1M: { input: 3, output: 15 } },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'fast', costPer1M: { input: 0.25, output: 1.25 } }
    );
  }
  if (process.env.GOOGLE_API_KEY) {
    models.push(
      { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', provider: 'google', tier: 'fast', costPer1M: { input: 0.075, output: 0.30 } },
      { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro', provider: 'google', tier: 'standard', costPer1M: { input: 1.25, output: 5.00 } },
      { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash', provider: 'google', tier: 'fast', costPer1M: { input: 0.075, output: 0.30 } }
    );
  }
  if (process.env.TABBY_API_URL) {
    models.push(
      { id: 'tabby-local', name: 'Local (TabbyAPI)', provider: 'local', tier: 'free', costPer1M: { input: 0, output: 0 } }
    );
  }
  res.json(models);
});

// WebSocket for real-time streaming
wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'stream') {
        const { streamAI } = require('./routes/ai');
        await streamAI(ws, data);
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Screw Claude IDE running at http://localhost:${PORT}`);
  console.log(`📁 Workspace: ${process.env.WORKSPACE_DIR || path.join(process.env.HOME, 'screw-claude-workspace')}`);
  console.log(`🤖 Anthropic: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌ (add to .env)'}`);
  console.log(`🔷 Google:    ${process.env.GOOGLE_API_KEY ? '✅' : '❌ (add to .env)'}`);
  console.log(`💻 Local:     ${process.env.TABBY_API_URL ? '✅ ' + process.env.TABBY_API_URL : '❌ (optional)'}\n`);
});
