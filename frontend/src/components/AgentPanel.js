import React, { useState, useRef, useEffect, useCallback } from 'react';
import './AgentPanel.css';

const AGENT_MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', icon: '🔮', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', icon: '⚡', provider: 'anthropic' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', icon: '💎', provider: 'google' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', icon: '🚀', provider: 'google' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', icon: '💎', provider: 'google' },
];

const PRESET_TASKS = [
  'Explore this codebase and give me a full overview of the architecture',
  'Find all bugs and security issues in this project',
  'Refactor the code for better performance and readability',
  'Add comprehensive error handling throughout',
  'Write tests for the main functionality',
  'Analyze and optimize the most expensive functions',
];

function ToolCallBlock({ tool, input, result }) {
  const [expanded, setExpanded] = useState(false);
  const TOOL_ICONS = {
    read_file: '📖', write_file: '✏️', edit_file: '🔧',
    run_command: '⚡', list_directory: '📂', search_files: '🔍',
    delete_file: '🗑', create_directory: '📁', get_file_tree: '🌲'
  };

  return (
    <div className={`tool-block ${result?.success === false ? 'tool-block--error' : 'tool-block--success'}`}>
      <div className="tool-block__header" onClick={() => setExpanded(e => !e)}>
        <span className="tool-block__icon">{TOOL_ICONS[tool] || '🔧'}</span>
        <span className="tool-block__name">{tool}</span>
        <span className="tool-block__summary">
          {tool === 'run_command' && input?.command}
          {(tool === 'read_file' || tool === 'write_file' || tool === 'edit_file' || tool === 'delete_file') && input?.path}
          {tool === 'search_files' && input?.query}
          {tool === 'list_directory' && (input?.path || '.')}
        </span>
        {result && (
          <span className={`tool-block__status ${result.success ? 'ok' : 'err'}`}>
            {result.success ? '✓' : '✗'}
          </span>
        )}
        <span className="tool-block__toggle">{expanded ? '▾' : '▸'}</span>
      </div>

      {expanded && (
        <div className="tool-block__detail">
          {input && (
            <div className="tool-block__section">
              <div className="tool-block__label">INPUT</div>
              <pre>{JSON.stringify(input, null, 2)}</pre>
            </div>
          )}
          {result && (
            <div className="tool-block__section">
              <div className="tool-block__label">OUTPUT</div>
              <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentPanel({ notify, workspace }) {
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [iterations, setIterations] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const eventsRef = useRef(null);
  const abortRef = useRef(null);
  const pendingToolRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (eventsRef.current) eventsRef.current.scrollTop = eventsRef.current.scrollHeight;
  }, []);

  useEffect(() => { scrollToBottom(); }, [events, scrollToBottom]);

  const addEvent = useCallback((event) => {
    setEvents(prev => [...prev, { ...event, id: Date.now() + Math.random() }]);
  }, []);

  const run = useCallback(async () => {
    if (!task.trim() || running) return;
    setRunning(true);
    setEvents([]);
    setIterations(0);
    pendingToolRef.current = null;

    addEvent({ type: 'start', task, model });

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, message: task, systemPrompt: systemPrompt || undefined }),
        signal: controller.signal
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'thinking') {
              setIterations(event.iteration);
              addEvent(event);
            } else if (event.type === 'text') {
              addEvent(event);
            } else if (event.type === 'tool_call') {
              pendingToolRef.current = { tool: event.tool, input: event.input, id: event.id };
              addEvent({ ...event, pending: true });
            } else if (event.type === 'tool_result') {
              // Update the pending tool call with result
              setEvents(prev => {
                const updated = [...prev];
                const idx = updated.findLastIndex(e => e.type === 'tool_call' && e.tool === event.tool && e.pending);
                if (idx !== -1) {
                  updated[idx] = { ...updated[idx], pending: false, result: event.result };
                }
                return updated;
              });
            } else if (event.type === 'done') {
              addEvent(event);
            } else if (event.type === 'error') {
              addEvent(event);
              notify(event.message, 'error');
            } else if (event.type === 'max_iterations') {
              addEvent(event);
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        addEvent({ type: 'error', message: err.message });
        notify(`Agent error: ${err.message}`, 'error');
      }
    }

    setRunning(false);
    abortRef.current = null;
  }, [task, model, running, systemPrompt, addEvent, notify]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setRunning(false);
    addEvent({ type: 'stopped' });
  }, [addEvent]);

  const clear = useCallback(() => {
    setEvents([]);
    setIterations(0);
  }, []);

  const renderEvent = useCallback((event) => {
    switch (event.type) {
      case 'start':
        return (
          <div className="agent-event agent-event--start">
            <span className="agent-event__icon">🎯</span>
            <div>
              <div className="agent-event__title">Task started</div>
              <div className="agent-event__body">{event.task}</div>
              <div className="agent-event__meta">Model: {event.model}</div>
            </div>
          </div>
        );
      case 'thinking':
        return (
          <div className="agent-event agent-event--thinking">
            <span className="agent-event__icon">🧠</span>
            <span>Iteration {event.iteration}</span>
          </div>
        );
      case 'text':
        return (
          <div className="agent-event agent-event--text">
            <div className="agent-event__body agent-text">{event.text}</div>
          </div>
        );
      case 'tool_call':
        return (
          <ToolCallBlock
            tool={event.tool}
            input={event.input}
            result={event.result}
          />
        );
      case 'done':
        return (
          <div className="agent-event agent-event--done">
            <span className="agent-event__icon">✅</span>
            <span>Done in {event.iterations} iteration{event.iterations !== 1 ? 's' : ''}</span>
          </div>
        );
      case 'stopped':
        return (
          <div className="agent-event agent-event--stopped">
            <span className="agent-event__icon">⏹</span>
            <span>Stopped by user</span>
          </div>
        );
      case 'error':
        return (
          <div className="agent-event agent-event--error">
            <span className="agent-event__icon">❌</span>
            <span>{event.message}</span>
          </div>
        );
      case 'max_iterations':
        return (
          <div className="agent-event agent-event--warn">
            <span className="agent-event__icon">⚠️</span>
            <span>Hit max iterations ({event.iterations})</span>
          </div>
        );
      default:
        return null;
    }
  }, []);

  return (
    <div className="agent-panel">
      <div className="agent-toolbar">
        <select value={model} onChange={e => setModel(e.target.value)} className="agent-model-select" disabled={running}>
          {AGENT_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.icon} {m.name}</option>
          ))}
        </select>

        <button className="btn" onClick={() => setShowSystem(s => !s)} title="System prompt">⚙</button>
        <button className="btn" onClick={clear} disabled={running}>🗑</button>

        {running && (
          <div className="agent-running">
            <span className="agent-pulse" />
            <span>Running · iter {iterations}</span>
          </div>
        )}
      </div>

      {showSystem && (
        <div className="agent-system">
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Custom system prompt (leave empty for default agentic prompt)..."
            rows={4}
          />
        </div>
      )}

      <div className="agent-events" ref={eventsRef}>
        {events.length === 0 && !running && (
          <div className="agent-empty">
            <div className="agent-empty__icon">🤖</div>
            <div className="agent-empty__title">Agentic Mode</div>
            <div className="agent-empty__sub">AI reads, writes, and runs code autonomously</div>
            <div className="agent-presets">
              {PRESET_TASKS.map((t, i) => (
                <button key={i} className="agent-preset" onClick={() => setTask(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {events.map(event => (
          <div key={event.id}>{renderEvent(event)}</div>
        ))}
      </div>

      <div className="agent-input-area">
        <textarea
          value={task}
          onChange={e => setTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) run(); }}
          placeholder="Describe your task... (Ctrl+Enter to run)"
          rows={3}
          className="agent-input"
          disabled={running}
        />
        {running ? (
          <button className="agent-run-btn agent-run-btn--stop" onClick={stop}>⏹ Stop</button>
        ) : (
          <button className="agent-run-btn" onClick={run} disabled={!task.trim()}>▶ Run</button>
        )}
      </div>
    </div>
  );
}
