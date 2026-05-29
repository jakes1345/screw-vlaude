import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileTree from './components/FileTree';
import Editor from './components/Editor';
import AIPanel from './components/AIPanel';
import Terminal from './components/Terminal';
import GitPanel from './components/GitPanel';
import StatusBar from './components/StatusBar';
import Tabs from './components/Tabs';
import { useSocket } from './hooks/useSocket';
import './App.css';

export default function App() {
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const [dirtyFiles, setDirtyFiles] = useState(new Set());
  const [sidePanel, setSidePanel] = useState('files'); // files | git | search
  const [bottomPanel, setBottomPanel] = useState('terminal'); // terminal | ai
  const [showBottom, setShowBottom] = useState(true);
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-6');
  const [tokenStats, setTokenStats] = useState(null);
  const [status, setStatus] = useState(null);
  const [workspace, setWorkspace] = useState('');
  const [gitStatus, setGitStatus] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [notification, setNotification] = useState(null);

  const socket = useSocket('http://localhost:3001');

  const notify = useCallback((msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Load status on mount
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(data => {
        setStatus(data);
        setWorkspace(data.workspace);
        setTokenStats(data.budget);
      })
      .catch(() => notify('Backend not reachable', 'error'));
  }, []);

  // Refresh token stats every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/tokens').then(r => r.json()).then(setTokenStats).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Refresh git status every 10s
  useEffect(() => {
    const refreshGit = () => {
      fetch('/api/git/status').then(r => r.json()).then(setGitStatus).catch(() => {});
    };
    refreshGit();
    const interval = setInterval(refreshGit, 10000);
    return () => clearInterval(interval);
  }, [workspace]);

  // File watch via socket
  useEffect(() => {
    if (!socket) return;
    socket.emit('watch:start');
    socket.on('file:change', (event) => {
      // Refresh git status on file changes
      fetch('/api/git/status').then(r => r.json()).then(setGitStatus).catch(() => {});
    });
  }, [socket]);

  const openFile = useCallback(async (filePath) => {
    if (openFiles.includes(filePath)) {
      setActiveFile(filePath);
      return;
    }

    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setFileContents(prev => ({ ...prev, [filePath]: data.content }));
      setOpenFiles(prev => [...prev, filePath]);
      setActiveFile(filePath);
    } catch (err) {
      notify(`Cannot open: ${err.message}`, 'error');
    }
  }, [openFiles, notify]);

  const saveFile = useCallback(async (filePath) => {
    const content = fileContents[filePath];
    if (content === undefined) return;

    try {
      await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content })
      });
      setDirtyFiles(prev => { const s = new Set(prev); s.delete(filePath); return s; });
      notify(`Saved: ${filePath.split('/').pop()}`);
      fetch('/api/git/status').then(r => r.json()).then(setGitStatus).catch(() => {});
    } catch (err) {
      notify(`Save failed: ${err.message}`, 'error');
    }
  }, [fileContents, notify]);

  const closeFile = useCallback((filePath) => {
    setOpenFiles(prev => {
      const next = prev.filter(f => f !== filePath);
      if (activeFile === filePath) {
        setActiveFile(next[next.length - 1] || null);
      }
      return next;
    });
    setDirtyFiles(prev => { const s = new Set(prev); s.delete(filePath); return s; });
  }, [activeFile]);

  const updateContent = useCallback((filePath, content) => {
    setFileContents(prev => ({ ...prev, [filePath]: content }));
    setDirtyFiles(prev => new Set([...prev, filePath]));
  }, []);

  // Ctrl+S save
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFile) saveFile(activeFile);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, saveFile]);

  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    const res = await fetch(`/api/files/search?q=${encodeURIComponent(searchQuery)}`);
    const results = await res.json();
    setSearchResults(results);
  }, [searchQuery]);

  const changeWorkspace = useCallback(async () => {
    const newPath = prompt('Enter workspace path:', workspace);
    if (!newPath || newPath === workspace) return;
    await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath })
    });
    setWorkspace(newPath);
    setOpenFiles([]);
    setActiveFile(null);
    setFileContents({});
    notify(`Workspace: ${newPath}`);
  }, [workspace, notify]);

  return (
    <div className="app">
      {notification && (
        <div className={`notification notification--${notification.type}`}>
          {notification.msg}
        </div>
      )}

      {/* Top bar */}
      <div className="topbar">
        <div className="topbar__logo">⚡ SCREW CLAUDE</div>
        <div className="topbar__workspace" onClick={changeWorkspace} title="Click to change workspace">
          📁 {workspace}
        </div>
        <div className="topbar__right">
          {tokenStats && (
            <div className={`topbar__budget ${parseFloat(tokenStats.percentUsed) >= 80 ? 'topbar__budget--warn' : ''}`}>
              💰 ${parseFloat(tokenStats.monthlySpend).toFixed(4)} / ${tokenStats.monthlyBudget}
              <span className="budget-bar">
                <span className="budget-bar__fill" style={{ width: `${Math.min(parseFloat(tokenStats.percentUsed), 100)}%` }} />
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="ide">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="sidebar__icons">
            <button className={`sidebar__icon ${sidePanel === 'files' ? 'active' : ''}`} onClick={() => setSidePanel('files')} title="Files">📂</button>
            <button className={`sidebar__icon ${sidePanel === 'search' ? 'active' : ''}`} onClick={() => setSidePanel('search')} title="Search">🔍</button>
            <button className={`sidebar__icon ${sidePanel === 'git' ? 'active' : ''}`} onClick={() => setSidePanel('git')} title="Git">
              🌿 {gitStatus?.modified?.length > 0 && <span className="badge">{gitStatus.modified.length}</span>}
            </button>
          </div>

          <div className="sidebar__panel">
            {sidePanel === 'files' && (
              <FileTree
                workspace={workspace}
                onOpen={openFile}
                activeFile={activeFile}
                dirtyFiles={dirtyFiles}
                onRefresh={() => {}}
              />
            )}
            {sidePanel === 'search' && (
              <div className="search-panel">
                <div className="search-panel__input">
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runSearch()}
                    placeholder="Search in files..."
                  />
                  <button onClick={runSearch}>→</button>
                </div>
                <div className="search-results">
                  {searchResults.map((r, i) => (
                    <div key={i} className="search-result">
                      <div className="search-result__file" onClick={() => openFile(r.file)}>
                        {r.file}
                      </div>
                      {r.matches.map((m, j) => (
                        <div key={j} className="search-result__match" onClick={() => openFile(r.file)}>
                          <span className="line-num">{m.line}</span>
                          <span className="line-content">{m.content}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sidePanel === 'git' && (
              <GitPanel gitStatus={gitStatus} onRefresh={() => fetch('/api/git/status').then(r => r.json()).then(setGitStatus)} notify={notify} />
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="main">
          <Tabs
            files={openFiles}
            active={activeFile}
            dirty={dirtyFiles}
            onSelect={setActiveFile}
            onClose={closeFile}
            onSave={saveFile}
          />

          <div className="editor-area">
            {activeFile ? (
              <Editor
                filePath={activeFile}
                content={fileContents[activeFile] || ''}
                onChange={(content) => updateContent(activeFile, content)}
                onSave={() => saveFile(activeFile)}
              />
            ) : (
              <div className="editor-empty">
                <div className="editor-empty__content">
                  <div className="editor-empty__icon">⚡</div>
                  <div className="editor-empty__title">SCREW CLAUDE IDE</div>
                  <div className="editor-empty__sub">Open a file from the sidebar to start editing</div>
                  <div className="editor-empty__shortcuts">
                    <span>Ctrl+S Save</span>
                    <span>Ctrl+` Terminal</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom panels */}
          {showBottom && (
            <div className="bottom-panel">
              <div className="bottom-panel__tabs">
                <button className={bottomPanel === 'terminal' ? 'active' : ''} onClick={() => setBottomPanel('terminal')}>TERMINAL</button>
                <button className={bottomPanel === 'ai' ? 'active' : ''} onClick={() => setBottomPanel('ai')}>AI CHAT</button>
                <button className="bottom-panel__close" onClick={() => setShowBottom(false)}>✕</button>
              </div>
              {bottomPanel === 'terminal' && (
                <Terminal socket={socket} workspace={workspace} />
              )}
              {bottomPanel === 'ai' && (
                <AIPanel
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                  activeFile={activeFile}
                  fileContent={activeFile ? fileContents[activeFile] : ''}
                  onInsertCode={(code) => {
                    if (activeFile) {
                      updateContent(activeFile, (fileContents[activeFile] || '') + '\n' + code);
                    }
                  }}
                  onTokenUpdate={setTokenStats}
                  notify={notify}
                />
              )}
            </div>
          )}

          {!showBottom && (
            <button className="show-bottom-btn" onClick={() => setShowBottom(true)}>
              ▲ TERMINAL / AI
            </button>
          )}
        </div>
      </div>

      <StatusBar
        activeFile={activeFile}
        gitStatus={gitStatus}
        selectedModel={selectedModel}
        tokenStats={tokenStats}
      />
    </div>
  );
}
