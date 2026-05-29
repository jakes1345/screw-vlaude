import React, { useCallback, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { autocompletion } from '@codemirror/autocomplete';
import { search } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';

const EXT_LANG_MAP = {
  '.js': () => javascript(),
  '.jsx': () => javascript({ jsx: true }),
  '.ts': () => javascript({ typescript: true }),
  '.tsx': () => javascript({ jsx: true, typescript: true }),
  '.py': () => python(),
  '.css': () => css(),
  '.html': () => html(),
  '.htm': () => html(),
  '.json': () => json(),
  '.md': () => markdown(),
  '.rs': () => rust(),
  '.sql': () => sql(),
  '.c': () => cpp(),
  '.cpp': () => cpp(),
  '.cc': () => cpp(),
  '.h': () => cpp(),
  '.hpp': () => cpp(),
  '.java': () => java(),
  '.php': () => php(),
};

function getLanguage(filePath) {
  if (!filePath) return [];
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase();
  const factory = EXT_LANG_MAP[ext];
  return factory ? [factory()] : [];
}

export default function Editor({ filePath, content, onChange, onSave }) {
  const extensions = useMemo(() => [
    ...getLanguage(filePath),
    autocompletion(),
    search({ top: true }),
    keymap.of([indentWithTab]),
  ], [filePath]);

  const handleChange = useCallback((value) => {
    onChange(value);
  }, [onChange]);

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <CodeMirror
        value={content}
        height="100%"
        theme={oneDark}
        extensions={extensions}
        onChange={handleChange}
        style={{ height: '100%', fontSize: '13px', fontFamily: 'JetBrains Mono, monospace' }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}
