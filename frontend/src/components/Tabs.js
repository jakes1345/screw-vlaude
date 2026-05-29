// Tabs.js
import React from 'react';

export default function Tabs({ files, active, dirty, onSelect, onClose, onSave }) {
  if (files.length === 0) return <div style={{ height: 36, background: 'var(--bg-1)', borderBottom: '1px solid var(--border)' }} />;

  return (
    <div className="tabs">
      {files.map(f => {
        const name = f.split('/').pop();
        const isDirty = dirty.has(f);
        return (
          <div
            key={f}
            className={`tab ${active === f ? 'active' : ''}`}
            onClick={() => onSelect(f)}
          >
            <span className="tab__name" title={f}>{name}</span>
            {isDirty && <span className="tab__dirty">●</span>}
            <button
              className="tab__close"
              onClick={(e) => { e.stopPropagation(); if (isDirty && !window.confirm(`Unsaved changes in ${name}. Close anyway?`)) return; onClose(f); }}
            >✕</button>
          </div>
        );
      })}
    </div>
  );
}
