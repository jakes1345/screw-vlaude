import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const SESSION_ID = 'main-terminal';

export default function Terminal({ socket, workspace }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const initializedRef = useRef(false);

  const initTerminal = useCallback(() => {
    if (!containerRef.current || !socket || initializedRef.current) return;
    initializedRef.current = true;

    const term = new XTerm({
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor: '#00d4ff',
        cursorAccent: '#0a0a0f',
        black: '#0a0a0f',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#7c3aed',
        cyan: '#00d4ff',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#a78bfa',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 100);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create PTY session
    socket.emit('terminal:create', { sessionId: SESSION_ID, cwd: workspace });

    // Send input to backend
    term.onData(data => {
      socket.emit('terminal:input', { sessionId: SESSION_ID, data });
    });

    // Receive output from backend
    socket.on('terminal:data', ({ sessionId, data }) => {
      if (sessionId === SESSION_ID) {
        term.write(data);
      }
    });

    socket.on('terminal:exit', ({ sessionId }) => {
      if (sessionId === SESSION_ID) {
        term.writeln('\r\n\x1b[33m[Process exited]\x1b[0m');
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        socket.emit('terminal:resize', {
          sessionId: SESSION_ID,
          cols: term.cols,
          rows: term.rows
        });
      } catch {}
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      socket.off('terminal:data');
      socket.off('terminal:exit');
      socket.emit('terminal:destroy', { sessionId: SESSION_ID });
      term.dispose();
      initializedRef.current = false;
    };
  }, [socket, workspace]);

  useEffect(() => {
    const cleanup = initTerminal();
    return cleanup;
  }, [initTerminal]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        height: '100%',
        padding: '4px',
        background: '#0a0a0f',
        overflow: 'hidden'
      }}
    />
  );
}
