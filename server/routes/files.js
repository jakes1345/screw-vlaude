const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chokidar = require('chokidar');

function getWorkspace() {
  const dir = process.env.WORKSPACE_DIR || path.join(process.env.HOME, 'screw-claude-workspace');
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
  return dir;
}

function safePath(workspace, filePath) {
  const resolved = path.resolve(workspace, filePath);
  if (!resolved.startsWith(workspace)) throw new Error('Path traversal not allowed');
  return resolved;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
    '.java': 'java', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
    '.md': 'markdown', '.html': 'html', '.css': 'css', '.scss': 'scss',
    '.sql': 'sql', '.xml': 'xml', '.env': 'plaintext', '.txt': 'plaintext'
  };
  return map[ext] || 'plaintext';
}

async function getTree(dirPath, workspace, maxDepth = 6, depth = 0) {
  if (depth > maxDepth) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result = [];
  const ignored = new Set(['.git', 'node_modules', '__pycache__', '.cache', 'dist', 'build', '.next', 'target', 'venv', '.venv']);
  for (const entry of entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(workspace, fullPath);
    if (entry.isDirectory()) {
      const children = await getTree(fullPath, workspace, maxDepth, depth + 1);
      result.push({ name: entry.name, path: relativePath, type: 'directory', children });
    } else {
      const stat = await fs.stat(fullPath);
      result.push({ name: entry.name, path: relativePath, type: 'file', language: getMimeType(fullPath), size: stat.size });
    }
  }
  return result;
}

router.get('/tree', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const tree = await getTree(workspace, workspace);
    res.json({ workspace, tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/read', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const filePath = safePath(workspace, req.query.path);
    const content = await fs.readFile(filePath, 'utf-8');
    const stat = await fs.stat(filePath);
    res.json({ content, language: getMimeType(filePath), size: stat.size, modified: stat.mtime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/write', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const { path: filePath, content } = req.body;
    const fullPath = safePath(workspace, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const { path: filePath, isDirectory = false } = req.body;
    const fullPath = safePath(workspace, filePath);
    if (isDirectory) {
      await fs.mkdir(fullPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, '', 'utf-8');
    }
    res.json({ success: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/delete', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const fullPath = safePath(workspace, req.query.path);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await fs.rm(fullPath, { recursive: true });
    } else {
      await fs.unlink(fullPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rename', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const { oldPath, newPath } = req.body;
    const oldFull = safePath(workspace, oldPath);
    const newFull = safePath(workspace, newPath);
    await fs.rename(oldFull, newFull);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const { query, filePattern } = req.query;
    if (!query) return res.json({ results: [] });
    const results = [];
    async function searchDir(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const ignored = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build']);
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else {
          try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (line.toLowerCase().includes(query.toLowerCase())) {
                results.push({ file: path.relative(workspace, fullPath), line: i + 1, content: line.trim(), context: lines.slice(Math.max(0, i - 1), i + 2).join('\n') });
              }
            });
          } catch {}
        }
      }
    }
    await searchDir(workspace);
    res.json({ results: results.slice(0, 200) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workspace', (req, res) => {
  res.json({ path: getWorkspace() });
});

router.post('/workspace', async (req, res) => {
  try {
    const { path: newPath } = req.body;
    if (!fsSync.existsSync(newPath)) {
      await fs.mkdir(newPath, { recursive: true });
    }
    process.env.WORKSPACE_DIR = newPath;
    res.json({ success: true, path: newPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
