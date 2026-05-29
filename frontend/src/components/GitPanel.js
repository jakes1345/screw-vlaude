import React, { useState, useCallback } from 'react';
import './GitPanel.css';

export default function GitPanel({ gitStatus, onRefresh, notify }) {
  const [commitMsg, setCommitMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('changes'); // changes | log | branches

  const api = useCallback(async (url, method = 'GET', body = null) => {
    setLoading(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : null
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    } catch (err) {
      notify(err.message, 'error');
      return null;
    } finally {
      setLoading(false);
      onRefresh();
    }
  }, [notify, onRefresh]);

  const stageAll = () => api('/api/git/stage-all', 'POST');
  const commit = async () => {
    if (!commitMsg.trim()) { notify('Enter commit message', 'error'); return; }
    const result = await api('/api/git/commit', 'POST', { message: commitMsg });
    if (result) setCommitMsg('');
  };
  const push = () => api('/api/git/push', 'POST', {});
  const pull = () => api('/api/git/pull', 'POST', {});
  const stash = () => api('/api/git/stash', 'POST', {});
  const stashPop = () => api('/api/git/stash-pop', 'POST');
  const init = () => api('/api/git/init', 'POST');

  const stageFile = (file) => api('/api/git/stage', 'POST', { files: [file] });
  const unstageFile = (file) => api('/api/git/unstage', 'POST', { files: [file] });

  const switchBranch = async () => {
    const branch = prompt('Branch name (new or existing):');
    if (!branch) return;
    const exists = gitStatus?.branches?.includes(branch);
    if (exists) {
      await api('/api/git/checkout', 'POST', { branch });
    } else {
      await api('/api/git/branch', 'POST', { name: branch });
    }
  };

  if (!gitStatus) {
    return (
      <div className="git-panel">
        <div className="git-panel__empty">
          <div>No git info</div>
          <button className="btn" onClick={onRefresh}>Refresh</button>
          <button className="btn btn--primary" onClick={init}>Init Repo</button>
        </div>
      </div>
    );
  }

  if (!gitStatus.isRepo) {
    return (
      <div className="git-panel">
        <div className="git-panel__empty">
          <div>Not a git repository</div>
          <button className="btn btn--primary" onClick={init}>Initialize</button>
        </div>
      </div>
    );
  }

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <div className="git-branch" onClick={switchBranch} title="Click to switch branch">
          <span className="git-branch__icon">⎇</span>
          <span>{gitStatus.currentBranch || gitStatus.branch}</span>
          {gitStatus.ahead > 0 && <span className="git-ahead">↑{gitStatus.ahead}</span>}
          {gitStatus.behind > 0 && <span className="git-behind">↓{gitStatus.behind}</span>}
        </div>
        <div className="git-panel__actions">
          <button className="btn" onClick={pull} title="Pull">↓</button>
          <button className="btn" onClick={push} title="Push">↑</button>
          <button className="btn" onClick={onRefresh} title="Refresh">↻</button>
        </div>
      </div>

      <div className="git-panel__tabs">
        <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}>
          Changes {(gitStatus.modified?.length + gitStatus.untracked?.length + gitStatus.staged?.length) > 0 &&
            `(${gitStatus.modified?.length + gitStatus.untracked?.length + gitStatus.staged?.length})`}
        </button>
        <button className={view === 'log' ? 'active' : ''} onClick={() => setView('log')}>Log</button>
        <button className={view === 'branches' ? 'active' : ''} onClick={() => setView('branches')}>Branches</button>
      </div>

      <div className="git-panel__content">
        {view === 'changes' && (
          <>
            {gitStatus.staged?.length > 0 && (
              <div className="git-section">
                <div className="git-section__title">
                  <span>STAGED ({gitStatus.staged.length})</span>
                </div>
                {gitStatus.staged.map(f => (
                  <div key={f} className="git-file git-file--staged">
                    <span className="git-file__status">A</span>
                    <span className="git-file__name">{f}</span>
                    <button className="git-file__action" onClick={() => unstageFile(f)}>−</button>
                  </div>
                ))}
              </div>
            )}

            {(gitStatus.modified?.length > 0 || gitStatus.untracked?.length > 0 || gitStatus.deleted?.length > 0) && (
              <div className="git-section">
                <div className="git-section__title">
                  <span>CHANGES ({(gitStatus.modified?.length || 0) + (gitStatus.untracked?.length || 0) + (gitStatus.deleted?.length || 0)})</span>
                  <button className="git-section__action" onClick={stageAll}>Stage All</button>
                </div>
                {gitStatus.modified?.map(f => (
                  <div key={f} className="git-file git-file--modified">
                    <span className="git-file__status">M</span>
                    <span className="git-file__name">{f}</span>
                    <button className="git-file__action" onClick={() => stageFile(f)}>+</button>
                  </div>
                ))}
                {gitStatus.untracked?.map(f => (
                  <div key={f} className="git-file git-file--untracked">
                    <span className="git-file__status">U</span>
                    <span className="git-file__name">{f}</span>
                    <button className="git-file__action" onClick={() => stageFile(f)}>+</button>
                  </div>
                ))}
                {gitStatus.deleted?.map(f => (
                  <div key={f} className="git-file git-file--deleted">
                    <span className="git-file__status">D</span>
                    <span className="git-file__name">{f}</span>
                    <button className="git-file__action" onClick={() => stageFile(f)}>+</button>
                  </div>
                ))}
              </div>
            )}

            <div className="git-commit">
              <input
                value={commitMsg}
                onChange={e => setCommitMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && commit()}
                placeholder="Commit message..."
                className="git-commit__input"
              />
              <div className="git-commit__actions">
                <button className="btn btn--primary" onClick={commit} disabled={loading || !commitMsg.trim()}>
                  Commit
                </button>
                <button className="btn" onClick={stash} title="Stash">Stash</button>
                <button className="btn" onClick={stashPop} title="Stash Pop">Pop</button>
              </div>
            </div>
          </>
        )}

        {view === 'log' && (
          <div className="git-log">
            {gitStatus.recentCommits?.map(c => (
              <div key={c.hash} className="git-commit-entry">
                <span className="git-commit-hash">{c.hash}</span>
                <span className="git-commit-msg">{c.message}</span>
                <span className="git-commit-author">{c.author}</span>
              </div>
            ))}
          </div>
        )}

        {view === 'branches' && (
          <div className="git-branches">
            <button className="btn btn--primary" onClick={switchBranch} style={{ margin: '8px' }}>+ New / Switch Branch</button>
            {gitStatus.branches?.map(b => (
              <div
                key={b}
                className={`git-branch-item ${b === gitStatus.currentBranch ? 'git-branch-item--active' : ''}`}
                onClick={() => api('/api/git/checkout', 'POST', { branch: b })}
              >
                <span>⎇</span>
                <span>{b}</span>
                {b === gitStatus.currentBranch && <span className="git-current">current</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
