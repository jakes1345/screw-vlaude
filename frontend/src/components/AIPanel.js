import React, { useState, useRef, useEffect, useCallback } from 'react';
import './AIPanel.css';

const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', icon: '🔮' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', icon: '⚡' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', icon: '⚡' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', icon: '🪶' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', icon: '💎' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', icon: '⚡' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', icon: '🚀' },
  { id: 'local', name: 'Local Model (Free)', provider: 'local', icon: '🖥' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', icon: '🦙' },
  { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B (Groq)', provider: 'groq', icon: '🦙' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Groq)', provider: 'groq', icon: '⚡' },
  { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (Groq)', provider: 'groq', icon: '🌀' },
  { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B (Groq)', provider: 'groq', icon: '🧠' },
];

const SYSTEM_PROMPTS = {
  code: 'You are an expert software engineer. Help with code, debugging, architecture, and best practices. Be concise and technical.',
  security: 'You are an expert in cybersecurity, penetration testing, and security research. Help with security analysis, vulnerability research, and defensive security. Provide technical depth.',
  explain: 'You are a technical mentor. Explain concepts clearly, provide examples, and help the user understand what code does.',
  refactor: 'You are a code reviewer. Analyze code quality, suggest improvements, identify bugs, and help refactor for clarity and performance.',
  custom: '',
};

export default function AIPanel({ selectedModel, onModelChange, activeFile, fileContent, onInsertCode, onTokenUpdate, notify }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('code');
  const [customSystem, setCustomSystem] = useState('');
  const [includeFile, setIncludeFile] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const estimateCost = useCallback(async (text) => {
    if (!text.trim()) { setEstimatedCost(null); return; }
    try {
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, text })
      });
      const data = await res.json();
      setEstimatedCost(data);
    } catch {}
  }, [selectedModel]);

  useEffect(() => {
    const t = setTimeout(() => estimateCost(input), 500);
    return () => clearTimeout(t);
  }, [input, estimateCost]);

  const buildContext = useCallback(() => {
    const contextParts = [];
    if (includeFile && activeFile && fileContent) {
      contextParts.push(`Current file: \`${activeFile}\`\n\`\`\`\n${fileContent.slice(0, 8000)}\n\`\`\``);
    }
    if (contextParts.length > 0) {
      return contextParts.join('\n\n') + '\n\n' + input;
    }
    return input;
  }, [includeFile, activeFile, fileContent, input]);

  const send = useCallback(async () => {
    const text = buildContext();
    if (!text.trim() || loading) return;

    const userMsg = { role: 'user', content: text, displayContent: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setEstimatedCost(null);
    setLoading(true);

    const systemPrompt = mode === 'custom' ? customSystem : SYSTEM_PROMPTS[mode];

    // Build API messages (without display overrides)
    const apiMessages = newMessages.map(m => ({ role: m.role, content: m.content }));

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: apiMessages,
          systemPrompt,
          sessionId: 'ai-panel'
        }),
        signal: controller.signal
      });

      const assistantMsg = { role: 'assistant', content: '' };
      setMessages(prev => [...prev, assistantMsg]);

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
            if (event.type === 'chunk') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: updated[updated.length - 1].content + event.text
                };
                return updated;
              });
              scrollToBottom();
            } else if (event.type === 'done') {
              if (onTokenUpdate) {
                fetch('/api/tokens').then(r => r.json()).then(onTokenUpdate).catch(() => {});
              }
            } else if (event.type === 'error') {
              notify(event.message, 'error');
            }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        notify(`AI error: ${err.message}`, 'error');
      }
    }

    setLoading(false);
    abortRef.current = null;
    inputRef.current?.focus();
  }, [buildContext, input, loading, messages, selectedModel, mode, customSystem, onTokenUpdate, notify, scrollToBottom]);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setEstimatedCost(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const extractCode = useCallback((content) => {
    const match = content.match(/```(?:\w+)?\n([\s\S]+?)```/);
    return match ? match[1] : null;
  }, []);

  const renderMessage = useCallback((msg, idx) => {
    const isUser = msg.role === 'user';
    const parts = msg.content.split(/(```(?:\w+)?\n[\s\S]+?```)/g);

    return (
      <div key={idx} className={`ai-msg ai-msg--${isUser ? 'user' : 'assistant'}`}>
        <div className="ai-msg__header">
          <span className="ai-msg__role">{isUser ? '👤 YOU' : '🤖 AI'}</span>
          {!isUser && onInsertCode && extractCode(msg.content) && (
            <button
              className="ai-msg__insert"
              onClick={() => onInsertCode(extractCode(msg.content))}
            >
              ↩ Insert
            </button>
          )}
        </div>
        <div className="ai-msg__content">
          {parts.map((part, i) => {
            if (part.startsWith('```')) {
              const langMatch = part.match(/```(\w+)?\n/);
              const lang = langMatch ? langMatch[1] : '';
              const code = part.replace(/```(?:\w+)?\n/, '').replace(/```$/, '');
              return (
                <div key={i} className="ai-code-block">
                  {lang && <div className="ai-code-block__lang">{lang}</div>}
                  <pre><code>{code}</code></pre>
                  {onInsertCode && (
                    <button className="ai-code-block__copy" onClick={() => onInsertCode(code)}>
                      ↩ Insert
                    </button>
                  )}
                </div>
              );
            }
            return <span key={i} className="ai-msg__text">{part}</span>;
          })}
        </div>
      </div>
    );
  }, [onInsertCode, extractCode]);

  const currentModel = MODELS.find(m => m.id === selectedModel);

  return (
    <div className="ai-panel">
      <div className="ai-panel__toolbar">
        <select
          value={selectedModel}
          onChange={e => onModelChange(e.target.value)}
          className="ai-model-select"
        >
          {MODELS.map(m => (
            <option key={m.id} value={m.id}>
              {m.icon} {m.name}
            </option>
          ))}
        </select>

        <select value={mode} onChange={e => setMode(e.target.value)} className="ai-mode-select">
          <option value="code">💻 Code</option>
          <option value="security">🔐 Security</option>
          <option value="explain">📖 Explain</option>
          <option value="refactor">🔧 Refactor</option>
          <option value="custom">⚙ Custom</option>
        </select>

        {activeFile && (
          <label className="ai-include-file">
            <input
              type="checkbox"
              checked={includeFile}
              onChange={e => setIncludeFile(e.target.checked)}
            />
            <span>Include {activeFile.split('/').pop()}</span>
          </label>
        )}

        <div className="ai-panel__actions">
          <button className="btn" onClick={clearChat} title="Clear chat">🗑</button>
          <button className="btn" onClick={() => setShowSettings(s => !s)} title="Settings">⚙</button>
        </div>
      </div>

      {showSettings && mode === 'custom' && (
        <div className="ai-settings">
          <textarea
            value={customSystem}
            onChange={e => setCustomSystem(e.target.value)}
            placeholder="Custom system prompt..."
            rows={3}
          />
        </div>
      )}

      <div className="ai-messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty__icon">{currentModel?.icon || '🤖'}</div>
            <div className="ai-empty__text">Ask anything about your code</div>
            <div className="ai-empty__model">{currentModel?.name}</div>
          </div>
        )}
        {messages.map(renderMessage)}
        {loading && messages[messages.length - 1]?.role === 'user' && (
          <div className="ai-msg ai-msg--assistant">
            <div className="ai-msg__header"><span className="ai-msg__role">🤖 AI</span></div>
            <div className="ai-thinking"><span /><span /><span /></div>
          </div>
        )}
      </div>

      <div className="ai-input-area">
        {estimatedCost && (
          <div className="ai-cost-estimate">
            ~{estimatedCost.inputTokens} tokens · ~${estimatedCost.estimatedCost.total.toFixed(5)}
          </div>
        )}
        <div className="ai-input-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your code... (Enter to send, Shift+Enter for newline)"
            rows={3}
            className="ai-input"
          />
          {loading ? (
            <button className="ai-send-btn ai-send-btn--stop" onClick={stop}>⏹</button>
          ) : (
            <button className="ai-send-btn" onClick={send} disabled={!input.trim()}>▶</button>
          )}
        </div>
      </div>
    </div>
  );
}
