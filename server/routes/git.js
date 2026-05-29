const express = require('express');
const router = express.Router();
const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');

function getWorkspace() {
  return process.env.WORKSPACE_DIR || path.join(process.env.HOME, 'screw-claude-workspace');
}

function git() {
  return simpleGit(getWorkspace());
}

router.get('/status', async (req, res) => {
  try {
    const workspace = getWorkspace();
    const isRepo = fs.existsSync(path.join(workspace, '.git'));
    if (!isRepo) return res.json({ isRepo: false, workspace });
    const status = await git().status();
    const log = await git().log({ maxCount: 20 }).catch(() => ({ all: [] }));
    const branches = await git().branchLocal().catch(() => ({ all: [], current: 'main' }));
    res.json({ isRepo: true, status, log: log.all, branches: branches.all, currentBranch: branches.current, workspace });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/init', async (req, res) => {
  try {
    await git().init();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/add', async (req, res) => {
  try {
    const { files } = req.body;
    if (files && files.length > 0) {
      await git().add(files);
    } else {
      await git().add('.');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/commit', async (req, res) => {
  try {
    const { message, addAll = false } = req.body;
    if (!message) return res.status(400).json({ error: 'Commit message required' });
    if (addAll) await git().add('.');
    const result = await git().commit(message);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/push', async (req, res) => {
  try {
    const { remote = 'origin', branch } = req.body;
    const currentBranch = branch || (await git().branchLocal()).current;
    const result = await git().push(remote, currentBranch);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pull', async (req, res) => {
  try {
    const result = await git().pull();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/branch', async (req, res) => {
  try {
    const { name, checkout = true } = req.body;
    if (!name) return res.status(400).json({ error: 'Branch name required' });
    await git().checkoutLocalBranch(name);
    res.json({ success: true, branch: name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/checkout', async (req, res) => {
  try {
    const { branch } = req.body;
    await git().checkout(branch);
    res.json({ success: true, branch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/diff', async (req, res) => {
  try {
    const { file, staged = false } = req.query;
    let diff;
    if (staged === 'true') {
      diff = file ? await git().diff(['--cached', '--', file]) : await git().diff(['--cached']);
    } else {
      diff = file ? await git().diff(['--', file]) : await git().diff();
    }
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/remote', async (req, res) => {
  try {
    const { name = 'origin', url } = req.body;
    if (!url) return res.status(400).json({ error: 'Remote URL required' });
    const remotes = await git().getRemotes();
    if (remotes.find(r => r.name === name)) {
      await git().remote(['set-url', name, url]);
    } else {
      await git().addRemote(name, url);
    }
    res.json({ success: true, remote: name, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/log', async (req, res) => {
  try {
    const { maxCount = 50, file } = req.query;
    const options = { maxCount: parseInt(maxCount) };
    if (file) options.file = file;
    const log = await git().log(options);
    res.json({ log: log.all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
