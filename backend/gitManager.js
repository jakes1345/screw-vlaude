const simpleGit = require('simple-git');
const path = require('path');

class GitManager {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.git = simpleGit(workspaceRoot);
  }

  updateRoot(newRoot) {
    this.workspaceRoot = newRoot;
    this.git = simpleGit(newRoot);
  }

  async isRepo() {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async init() {
    await this.git.init();
    return { success: true, message: 'Git repository initialized' };
  }

  async status() {
    const status = await this.git.status();
    const log = await this.git.log({ maxCount: 10 }).catch(() => ({ all: [] }));
    const branches = await this.git.branchLocal().catch(() => ({ all: [], current: 'main' }));

    return {
      branch: status.current,
      staged: status.staged,
      modified: status.modified,
      untracked: status.not_added,
      deleted: status.deleted,
      conflicted: status.conflicted,
      ahead: status.ahead,
      behind: status.behind,
      recentCommits: log.all.slice(0, 10).map(c => ({
        hash: c.hash.slice(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date
      })),
      branches: branches.all,
      currentBranch: branches.current
    };
  }

  async diff(filePath = null) {
    if (filePath) {
      const diff = await this.git.diff([filePath]);
      const stagedDiff = await this.git.diff(['--staged', filePath]);
      return { unstaged: diff, staged: stagedDiff };
    }
    const diff = await this.git.diff();
    const stagedDiff = await this.git.diff(['--staged']);
    return { unstaged: diff, staged: stagedDiff };
  }

  async stage(files) {
    if (Array.isArray(files)) {
      await this.git.add(files);
    } else {
      await this.git.add(files);
    }
    return { success: true };
  }

  async unstage(files) {
    if (Array.isArray(files)) {
      await this.git.reset(files);
    } else {
      await this.git.reset([files]);
    }
    return { success: true };
  }

  async stageAll() {
    await this.git.add('.');
    return { success: true };
  }

  async commit(message) {
    const result = await this.git.commit(message);
    return {
      success: true,
      hash: result.commit,
      summary: result.summary
    };
  }

  async push(remote = 'origin', branch = null) {
    const currentBranch = branch || (await this.git.branchLocal()).current;
    await this.git.push(remote, currentBranch);
    return { success: true, remote, branch: currentBranch };
  }

  async pull(remote = 'origin', branch = null) {
    const currentBranch = branch || (await this.git.branchLocal()).current;
    const result = await this.git.pull(remote, currentBranch);
    return { success: true, result };
  }

  async createBranch(name, checkout = true) {
    await this.git.checkoutLocalBranch(name);
    return { success: true, branch: name };
  }

  async switchBranch(name) {
    await this.git.checkout(name);
    return { success: true, branch: name };
  }

  async deleteBranch(name, force = false) {
    await this.git.deleteLocalBranch(name, force);
    return { success: true };
  }

  async merge(branch) {
    const result = await this.git.merge([branch]);
    return { success: true, result };
  }

  async stash(message = null) {
    if (message) {
      await this.git.stash(['save', message]);
    } else {
      await this.git.stash();
    }
    return { success: true };
  }

  async stashPop() {
    await this.git.stash(['pop']);
    return { success: true };
  }

  async stashList() {
    const list = await this.git.stashList();
    return list.all;
  }

  async log(maxCount = 50, filePath = null) {
    const options = { maxCount };
    if (filePath) options.file = filePath;
    const log = await this.git.log(options);
    return log.all.map(c => ({
      hash: c.hash,
      shortHash: c.hash.slice(0, 7),
      message: c.message,
      author: c.author_name,
      email: c.author_email,
      date: c.date
    }));
  }

  async remotes() {
    const remotes = await this.git.getRemotes(true);
    return remotes;
  }

  async addRemote(name, url) {
    await this.git.addRemote(name, url);
    return { success: true };
  }

  async clone(url, targetDir) {
    await simpleGit().clone(url, path.join(this.workspaceRoot, targetDir));
    return { success: true, path: targetDir };
  }
}

module.exports = GitManager;
