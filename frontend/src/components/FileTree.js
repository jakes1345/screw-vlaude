import React, { useState, useEffect, useCallback } from 'react';
import './FileTree.css';

const FILE_ICONS = {
  '.js': '🟨', '.jsx': '🟨', '.ts': '🔷', '.tsx': '🔷',
  '.py': '🐍', '.rs': '🦀', '.go': '🔵', '.java': '☕',
  '.css': '🎨', '.html': '🌐', '.json': '📋', '.md': '📝',
  '.sh': '⚡', '.env': '🔒', '.gitignore': '🙈', '.sql': '🗃',
  '.cpp': '⚙', '.c': '⚙', '.h': '⚙', '.php': '🐘',
  '.yml': '⚙', '.yaml': '⚙', '.toml': '⚙', '.xml': '📄',
};

function getIcon(name, type) {
  if (type === 'directory') return null;
  const ext = name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  return FILE_ICONS[ext] || '📄';
}

function TreeNode({ node, depth, onOpen, activeFile, dirtyFiles, onRefresh }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  const loadChildren = useCallback(async () => {
    if (node.type !== 'directory') return;
    setLoading(true);
    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(node.path)}`);
      const data = await res.json();
      setChildren(data);
    } catch {}
    setLoading(false);
  }, [node.path, node.type]);

  const toggle = useCallback(async () => {
    if (node.type !== 'directory') {
      if (!node.binary) onOpen(node.path);
      return;
    }
    if (!expanded && !children) await loadChildren();
    setExpanded(e => !e);
  }, [node, expanded, children, loadChildren, onOpen]);

  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleAction = useCallback(async (action) => {
    setContextMenu(null);
    if (action === 'delete') {
      if (!window.confirm(`Delete ${node.name}?`)) return;
      await fetch(`/api/files?path=${encodeURIComponent(node.path)}`, { method: 'DELETE' });
      onRefresh();
    } else if (action === 'rename') {
      const newName = prompt('New name:', node.name);
      if (!newName || newName === node.name) return;
      const newPath = node.path.replace(node.name, newName);
      await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: node.path, newPath })
      });
      onRefresh();
    } else if (action === 'newFile') {
      const name = prompt('File name:');
      if (!name) return;
      const filePath = node.type === 'directory' ? `${node.path}/${name}` : `${node.path.split('/').slice(0, -1).join('/')}/${name}`;
      await fetch('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content: '' })
      });
      onRefresh();
      onOpen(filePath);
    } else if (action === 'newDir') {
      const name = prompt('Directory name:');
      if (!name) return;
      const dirPath = node.type === 'directory' ? `${node.path}/${name}` : `${node.path.split('/').slice(0, -1).join('/')}/${name}`;
      await fetch('/api/files/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
      });
      onRefresh();
    }
  }, [node, onRefresh, onOpen]);

  const isActive = activeFile === node.path;
  const isDirty = dirtyFiles?.has(node.path);
  const icon = getIcon(node.name, node.type);

  return (
    <div className="tree-node-wrap">
      <div
        className={`tree-node ${isActive ? 'tree-node--active' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={toggle}
        onContextMenu={handleContextMenu}
      >
        {node.type === 'directory' ? (
          <span className="tree-node__arrow">{expanded ? '▾' : '▸'}</span>
        ) : (
          <span className="tree-node__icon">{icon}</span>
        )}
        {node.type === 'directory' && (
          <span className="tree-node__folder">{expanded ? '📂' : '📁'}</span>
        )}
        <span className={`tree-node__name ${isDirty ? 'tree-node__name--dirty' : ''} ${node.binary ? 'tree-node__name--binary' : ''}`}>
          {node.name}
        </span>
        {isDirty && <span className="tree-node__dot" />}
      </div>

      {expanded && node.type === 'directory' && (
        <div className="tree-children">
          {loading && <div className="tree-loading">loading...</div>}
          {children?.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpen={onOpen}
              activeFile={activeFile}
              dirtyFiles={dirtyFiles}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      {contextMenu && (
        <>
          <div className="context-overlay" onClick={() => setContextMenu(null)} />
          <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {node.type === 'directory' && (
              <>
                <div className="context-item" onClick={() => handleAction('newFile')}>New File</div>
                <div className="context-item" onClick={() => handleAction('newDir')}>New Folder</div>
                <div className="context-divider" />
              </>
            )}
            <div className="context-item" onClick={() => handleAction('rename')}>Rename</div>
            <div className="context-item context-item--danger" onClick={() => handleAction('delete')}>Delete</div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FileTree({ workspace, onOpen, activeFile, dirtyFiles, onRefresh }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/files/tree?path=.');
      const data = await res.json();
      setTree(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadTree(); }, [workspace, loadTree]);

  return (
    <div className="file-tree">
      <div className="file-tree__header">
        <span>EXPLORER</span>
        <button className="file-tree__refresh" onClick={loadTree} title="Refresh">↻</button>
      </div>
      {loading && <div className="file-tree__loading">Loading...</div>}
      <div className="file-tree__content">
        {tree.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            onOpen={onOpen}
            activeFile={activeFile}
            dirtyFiles={dirtyFiles}
            onRefresh={loadTree}
          />
        ))}
      </div>
    </div>
  );
}
