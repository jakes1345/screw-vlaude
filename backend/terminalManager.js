const pty = require('node-pty');
const os = require('os');

class TerminalManager {
  constructor() {
    this.sessions = new Map();
    this.shell = process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash');
  }

  createSession(sessionId, workspaceRoot, socket) {
    if (this.sessions.has(sessionId)) {
      this.destroySession(sessionId);
    }

    const term = pty.spawn(this.shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: workspaceRoot,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });

    term.onData(data => {
      socket.emit('terminal:data', { sessionId, data });
    });

    term.onExit(({ exitCode }) => {
      socket.emit('terminal:exit', { sessionId, exitCode });
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, { term, socket });
    return sessionId;
  }

  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.term.write(data);
    }
  }

  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.term.resize(cols, rows);
    }
  }

  destroySession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.term.kill();
      } catch {}
      this.sessions.delete(sessionId);
    }
  }

  destroyAll() {
    for (const [id] of this.sessions) {
      this.destroySession(id);
    }
  }
}

module.exports = TerminalManager;
