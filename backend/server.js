require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { routeToProvider, getAvailableProviders } = require('./providers');
const { TokenTracker } = require('./tokenTracker');
const FileManager = require('./fileManager');
const GitManager = require('./gitManager');
const TerminalManager = require('./terminalManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../frontend/build')));

const tokenTracker = new TokenTracker();
const workspaceRoot = process.env.WORKSPACE_ROOT || process.env.HOME + '/workspace';
const fileManager = new FileManager(workspaceRoot);
const gitManager = new GitManager(workspaceRoot);
const terminalManager = new TerminalManager();

// ─── Health / Status ────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    providers: getAvailableProviders(),
    workspace: fileManager.getWorkspaceRoot(),
    budget: tokenTracker.getStats()
  });
});

// ─── Models ─────────────────────────────────────────────────────────────────
app.get('/api/models', (req, res) => {
  res.json(tokenTracker.getModelList());
});

// ─── Token stats ────────────────────────────────────────────────────────────
app.get('/api/tokens', (req, res) => {
  res.json(tokenTracker.getStats());
});

app.post('/api/tokens/reset', (req, res) => {
  tokenTracker.resetMonthly();
  res.json({ success: true });
});

// ─── Cost estimate (before sending) ─────────────────────────────────────────
app.post('/api/estimate', (req, res) => {
  const { model, text } = req.body;
  const tokens = tokenTracker.estimateTokens(text || '');
  const estimate = tokenTracker.estimateCost(model, tokens, tokens * 0.5); // rough output estimate
  res.json({ inputTokens: tokens, estimatedCost: estimate });
});

// ─── AI Chat (streaming) ─────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { model, messages, systemPrompt, sessionId } = req.body;

  if (!model || !messages) {
    return res.status(400).json({ error: 'model and messages required' });
  }

  if (tokenTracker.isOverBudget()) {
    return res.status(402).json({
      error: 'Monthly budget exceeded',
      stats: tokenTracker.getStats()
    });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await routeToProvider(
      model,
      messages,
      systemPrompt,
      true,
      (chunk) => sendEvent({ type: 'chunk', text: chunk })
    );

    const usage = tokenTracker.recordUsage(
      model,
      result.inputTokens,
      result.outputTokens,
      sessionId || 'default'
    );

    sendEvent({ type: 'done', usage });
    res.end();
  } catch (err) {
    sendEvent({ type: 'error', message: err.message });
    res.end();
  }
});

// ─── AI Chat (non-streaming) ─────────────────────────────────────────────────
app.post('/api/chat/sync', async (req, res) => {
  const { model, messages, systemPrompt, sessionId } = req.body;

  if (tokenTracker.isOverBudget()) {
    return res.status(402).json({ error: 'Monthly budget exceeded' });
  }

  try {
    const result = await routeToProvider(model, messages, systemPrompt, false);
    const usage = tokenTracker.recordUsage(
      model,
      result.inputTokens,
      result.outputTokens,
      sessionId || 'default'
    );
    res.json({ text: result.text, usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── File operations ─────────────────────────────────────────────────────────
app.get('/api/files/tree', async (req, res) => {
  try {
    const tree = await fileManager.getFileTree(req.query.path || '.');
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/list', async (req, res) => {
  try {
    const items = await fileManager.listDirectory(req.query.path || '.');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/read', async (req, res) => {
  try {
    const result = await fileManager.readFile(req.query.path);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files/write', async (req, res) => {
  try {
    const result = await fileManager.writeFile(req.body.path, req.body.content);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files', async (req, res) => {
  try {
    const result = await fileManager.deleteFile(req.query.path);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files/rename', async (req, res) => {
  try {
    const result = await fileManager.renameFile(req.body.oldPath, req.body.newPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files/mkdir', async (req, res) => {
  try {
    const result = await fileManager.createDirectory(req.body.path);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/search', async (req, res) => {
  try {
    const results = await fileManager.searchInFiles(
      req.query.q,
      req.query.dir || '.',
      req.query.ext ? req.query.ext.split(',') : null
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspace', (req, res) => {
  const { path: newPath } = req.body;
  fileManager.setWorkspaceRoot(newPath);
  gitManager.updateRoot(newPath);
  res.json({ success: true, workspace: newPath });
});

// ─── Git operations ──────────────────────────────────────────────────────────
app.get('/api/git/status', async (req, res) => {
  try {
    const isRepo = await gitManager.isRepo();
    if (!isRepo) return res.json({ isRepo: false });
    const status = await gitManager.status();
    res.json({ isRepo: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/git/diff', async (req, res) => {
  try {
    const diff = await gitManager.diff(req.query.file || null);
    res.json(diff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/init', async (req, res) => {
  try {
    const result = await gitManager.init();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/stage', async (req, res) => {
  try {
    const result = await gitManager.stage(req.body.files);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/stage-all', async (req, res) => {
  try {
    const result = await gitManager.stageAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/commit', async (req, res) => {
  try {
    const result = await gitManager.commit(req.body.message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/push', async (req, res) => {
  try {
    const result = await gitManager.push(req.body.remote, req.body.branch);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/pull', async (req, res) => {
  try {
    const result = await gitManager.pull(req.body.remote, req.body.branch);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/branch', async (req, res) => {
  try {
    const result = await gitManager.createBranch(req.body.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/checkout', async (req, res) => {
  try {
    const result = await gitManager.switchBranch(req.body.branch);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/git/log', async (req, res) => {
  try {
    const log = await gitManager.log(parseInt(req.query.count) || 50, req.query.file);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/stash', async (req, res) => {
  try {
    const result = await gitManager.stash(req.body.message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/stash-pop', async (req, res) => {
  try {
    const result = await gitManager.stashPop();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/add-remote', async (req, res) => {
  try {
    const result = await gitManager.addRemote(req.body.name, req.body.url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/git/clone', async (req, res) => {
  try {
    const result = await gitManager.clone(req.body.url, req.body.dir);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Socket.IO (terminal + file watch) ───────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Terminal
  socket.on('terminal:create', ({ sessionId, cwd }) => {
    terminalManager.createSession(
      sessionId || socket.id,
      cwd || fileManager.getWorkspaceRoot(),
      socket
    );
  });

  socket.on('terminal:input', ({ sessionId, data }) => {
    terminalManager.write(sessionId || socket.id, data);
  });

  socket.on('terminal:resize', ({ sessionId, cols, rows }) => {
    terminalManager.resize(sessionId || socket.id, cols, rows);
  });

  socket.on('terminal:destroy', ({ sessionId }) => {
    terminalManager.destroySession(sessionId || socket.id);
  });

  // File watching
  socket.on('watch:start', () => {
    fileManager.watchWorkspace((event) => {
      socket.emit('file:change', event);
    });
  });

  socket.on('disconnect', () => {
    terminalManager.destroySession(socket.id);
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ─── Catch-all: serve React app ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Screw Claude IDE running on http://localhost:${PORT}`);
  console.log(`📁 Workspace: ${fileManager.getWorkspaceRoot()}`);
  console.log(`💰 Budget: $${tokenTracker.getStats().monthlyBudget}/month\n`);
});

process.on('SIGINT', () => {
  terminalManager.destroyAll();
  process.exit(0);
});
