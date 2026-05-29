import React from 'react';

export default function StatusBar({ activeFile, gitStatus, selectedModel, tokenStats }) {
  const ext = activeFile?.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';
  const langMap = {
    '.js': 'JavaScript', '.jsx': 'JSX', '.ts': 'TypeScript', '.tsx': 'TSX',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java',
    '.css': 'CSS', '.html': 'HTML', '.json': 'JSON', '.md': 'Markdown',
    '.sh': 'Shell', '.sql': 'SQL', '.cpp': 'C++', '.c': 'C', '.php': 'PHP',
  };
  const lang = langMap[ext] || (ext ? ext.slice(1).toUpperCase() : 'Plain Text');

  const modelNames = {
    'claude-opus-4-6': 'Opus 4.6',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-sonnet-4-20250514': 'Sonnet 4',
    'claude-haiku-4-5-20251001': 'Haiku 4.5',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'local': 'Local (Free)',
  };

  return (
    <div className="statusbar">
      {gitStatus?.isRepo && (
        <div className="statusbar__item">
          ⎇ {gitStatus.currentBranch || gitStatus.branch}
          {gitStatus.modified?.length > 0 && ` · ${gitStatus.modified.length}M`}
          {gitStatus.staged?.length > 0 && ` · ${gitStatus.staged.length}S`}
        </div>
      )}
      {activeFile && (
        <div className="statusbar__item">
          {activeFile.split('/').pop()}
        </div>
      )}
      <div className="statusbar__item">
        {lang}
      </div>
      <div className="statusbar__item statusbar__item--right">
        🤖 {modelNames[selectedModel] || selectedModel}
      </div>
      {tokenStats && (
        <div className="statusbar__item">
          💰 ${parseFloat(tokenStats.monthlySpend).toFixed(4)} used
        </div>
      )}
    </div>
  );
}
