# ⚡ Screw Claude IDE

A full local IDE with multi-provider AI integration. Runs entirely on your machine.

## Supported Models

| Model | Provider | Cost/1M tokens |
|-------|----------|----------------|
| Claude Opus 4.6 | Anthropic | $15/$75 in/out |
| Claude Sonnet 4.6 | Anthropic | $3/$15 in/out |
| Claude Sonnet 4 | Anthropic | $3/$15 in/out |
| Claude Haiku 4.5 | Anthropic | $0.80/$4 in/out |
| Gemini 2.5 Pro | Google | $1.25/$10 in/out |
| Gemini 2.5 Flash | Google | $0.075/$0.30 in/out |
| Gemini 2.0 Flash | Google | $0.10/$0.40 in/out |
| Local Model | TabbyAPI/TGWUI | Free |

## Features

- **Real code editor** — CodeMirror 6, syntax highlighting for 12+ languages
- **Multi-provider AI** — Switch between Claude, Gemini, or your local model per-request
- **Smart AI modes** — Code, Security, Explain, Refactor, Custom system prompts
- **File context** — Include current file in AI requests with one click
- **Token tracking** — Real-time cost estimation before you send, monthly budget alerts
- **Live terminal** — Full PTY terminal (bash/zsh) with xterm.js
- **Git integration** — Stage, commit, push, pull, branches, log, stash
- **File manager** — Tree view, create/delete/rename, search across files
- **File watching** — Auto-refreshes when files change on disk

## Setup

### Requirements
- Node.js 18+
- Linux (Debian/Ubuntu/Mint)

### Install
```bash
git clone https://github.com/Jakes1345/screw-claude
cd screw-claude
chmod +x setup.sh run.sh
./setup.sh
```

### Configure
Edit `backend/.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=AIza...
LOCAL_MODEL_URL=http://localhost:5000   # TabbyAPI port
WORKSPACE_ROOT=/home/yourname/projects  # Your projects directory
MONTHLY_BUDGET=5.00                     # Hard spend cap
WARN_AT_PERCENT=80                      # Warn at 80% of budget
```

### Run
```bash
./run.sh
```

Opens at `http://localhost:3000`

## Budget Tips

- Use **Haiku 4.5** or **Gemini 2.5 Flash** for quick iteration (10-20x cheaper than Opus)
- Enable **"Include file"** only when the AI actually needs the context
- Use **Local model** for basic edits and completions (free)
- The token estimator shows cost **before** you send — use it
- Monthly budget cap prevents surprise bills

## Local Model Setup

If you have TabbyAPI or Text-Generation-WebUI running:
```env
LOCAL_MODEL_URL=http://localhost:5000  # TabbyAPI default
# or
LOCAL_MODEL_URL=http://localhost:5001  # TGWUI API extension
```

The IDE will automatically route to your local model when you select "Local Model (Free)".
