const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { glob } = require('glob');
const chokidar = require('chokidar');

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.bin', '.so', '.dylib', '.dll',
  '.mp3', '.mp4', '.wav', '.avi', '.mkv',
  '.ttf', '.woff', '.woff2', '.eot'
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

class FileManager {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot || process.env.WORKSPACE_ROOT || process.cwd();
    this.watcher = null;
    this.watchers = new Map();
  }

  resolvePath(filePath) {
    const resolved = path.resolve(this.workspaceRoot, filePath);
    // Security: ensure path stays within workspace
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  async readFile(filePath) {
    const fullPath = this.resolvePath(filePath);
    const ext = path.extname(filePath).toLowerCase();

    if (BINARY_EXTENSIONS.has(ext)) {
      throw new Error(`Binary file: ${ext}`);
    }

    const stat = await fs.stat(fullPath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${(stat.size / 1024).toFixed(1)}KB (max 1MB)`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    return { content, size: stat.size, modified: stat.mtime };
  }

  async writeFile(filePath, content) {
    const fullPath = this.resolvePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    return { success: true, path: filePath };
  }

  async deleteFile(filePath) {
    const fullPath = this.resolvePath(filePath);
    await fs.unlink(fullPath);
    return { success: true };
  }

  async renameFile(oldPath, newPath) {
    const fullOld = this.resolvePath(oldPath);
    const fullNew = this.resolvePath(newPath);
    await fs.mkdir(path.dirname(fullNew), { recursive: true });
    await fs.rename(fullOld, fullNew);
    return { success: true };
  }

  async createDirectory(dirPath) {
    const fullPath = this.resolvePath(dirPath);
    await fs.mkdir(fullPath, { recursive: true });
    return { success: true };
  }

  async listDirectory(dirPath = '.') {
    const fullPath = this.resolvePath(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const items = await Promise.all(entries.map(async entry => {
      const entryPath = path.join(dirPath, entry.name);
      const isBinary = BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
      let size = 0;

      try {
        if (entry.isFile()) {
          const stat = await fs.stat(this.resolvePath(entryPath));
          size = stat.size;
        }
      } catch {}

      return {
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        binary: isBinary,
        size,
        ext: path.extname(entry.name)
      };
    }));

    return items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getFileTree(dirPath = '.', depth = 4) {
    const fullPath = this.resolvePath(dirPath);

    const buildTree = async (dir, currentDepth) => {
      if (currentDepth > depth) return [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const items = [];

        for (const entry of entries) {
          // Skip common ignore patterns
          if (['.git', 'node_modules', '__pycache__', '.venv', 'dist', 'build', '.next'].includes(entry.name)) {
            continue;
          }

          const fullEntryPath = path.join(dir, entry.name);
          const relPath = path.relative(this.workspaceRoot, fullEntryPath);
          const isBinary = BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase());

          if (entry.isDirectory()) {
            const children = await buildTree(fullEntryPath, currentDepth + 1);
            items.push({ name: entry.name, path: relPath, type: 'directory', children });
          } else {
            items.push({ name: entry.name, path: relPath, type: 'file', binary: isBinary, ext: path.extname(entry.name) });
          }
        }

        return items.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      } catch {
        return [];
      }
    };

    return buildTree(fullPath, 0);
  }

  async searchInFiles(query, dirPath = '.', extensions = null) {
    const fullPath = this.resolvePath(dirPath);
    const pattern = extensions
      ? `**/*.{${extensions.join(',')}}`
      : '**/*';

    const files = await glob(pattern, {
      cwd: fullPath,
      ignore: ['node_modules/**', '.git/**', '__pycache__/**'],
      nodir: true
    });

    const results = [];
    for (const file of files.slice(0, 100)) {
      const ext = path.extname(file).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      try {
        const content = await fs.readFile(path.join(fullPath, file), 'utf-8');
        const lines = content.split('\n');
        const matches = [];

        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            matches.push({ line: idx + 1, content: line.trim() });
          }
        });

        if (matches.length > 0) {
          results.push({ file, matches: matches.slice(0, 10) });
        }
      } catch {}
    }

    return results;
  }

  watchWorkspace(onChange) {
    if (this.watcher) {
      this.watcher.close();
    }

    this.watcher = chokidar.watch(this.workspaceRoot, {
      ignored: /(^|[\/\\])\.(git)|node_modules|__pycache__/,
      persistent: true,
      ignoreInitial: true
    });

    this.watcher
      .on('add', p => onChange({ type: 'add', path: path.relative(this.workspaceRoot, p) }))
      .on('change', p => onChange({ type: 'change', path: path.relative(this.workspaceRoot, p) }))
      .on('unlink', p => onChange({ type: 'delete', path: path.relative(this.workspaceRoot, p) }))
      .on('addDir', p => onChange({ type: 'addDir', path: path.relative(this.workspaceRoot, p) }))
      .on('unlinkDir', p => onChange({ type: 'deleteDir', path: path.relative(this.workspaceRoot, p) }));

    return this.watcher;
  }

  setWorkspaceRoot(newRoot) {
    this.workspaceRoot = newRoot;
  }

  getWorkspaceRoot() {
    return this.workspaceRoot;
  }
}

module.exports = FileManager;
