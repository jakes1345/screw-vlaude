const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

// Tool definitions for AI
const TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        content: { type: 'string', description: 'Full file content to write' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'edit_file',
    description: 'Edit a specific section of a file by replacing old text with new text',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to workspace root' },
        old_text: { type: 'string', description: 'Exact text to find and replace' },
        new_text: { type: 'string', description: 'Text to replace it with' }
      },
      required: ['path', 'old_text', 'new_text']
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace directory',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
        timeout: { type: 'number', description: 'Timeout in seconds (default 30)' }
      },
      required: ['command']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to workspace root (default ".")' }
      },
      required: []
    }
  },
  {
    name: 'search_files',
    description: 'Search for text across all files in the workspace',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        file_pattern: { type: 'string', description: 'Optional glob pattern like "*.py" or "*.js"' }
      },
      required: ['query']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete' }
      },
      required: ['path']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a directory',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to create' }
      },
      required: ['path']
    }
  },
  {
    name: 'get_file_tree',
    description: 'Get the full file tree of the workspace or a subdirectory',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Root path to tree from (default ".")' },
        depth: { type: 'number', description: 'Max depth (default 3)' }
      },
      required: []
    }
  }
];

// Google Vertex AI tool format
const TOOLS_VERTEX = TOOLS.map(t => ({
  functionDeclarations: [{
    name: t.name,
    description: t.description,
    parameters: t.input_schema
  }]
}));

class AgentEngine {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.maxIterations = 30;
  }

  resolvePath(p) {
    const resolved = path.resolve(this.workspaceRoot, p || '.');
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error('Path traversal blocked');
    }
    return resolved;
  }

  async executeTool(name, input) {
    try {
      switch (name) {
        case 'read_file': {
          const content = await fs.readFile(this.resolvePath(input.path), 'utf-8');
          return { success: true, content: content.slice(0, 50000) }; // cap at 50k chars
        }

        case 'write_file': {
          const fullPath = this.resolvePath(input.path);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, input.content, 'utf-8');
          return { success: true, message: `Written: ${input.path}` };
        }

        case 'edit_file': {
          const fullPath = this.resolvePath(input.path);
          const content = await fs.readFile(fullPath, 'utf-8');
          if (!content.includes(input.old_text)) {
            return { success: false, error: 'old_text not found in file' };
          }
          const newContent = content.replace(input.old_text, input.new_text);
          await fs.writeFile(fullPath, newContent, 'utf-8');
          return { success: true, message: `Edited: ${input.path}` };
        }

        case 'run_command': {
          return new Promise((resolve) => {
            const timeout = (input.timeout || 30) * 1000;
            let output = '';
            let error = '';

            const proc = spawn('bash', ['-c', input.command], {
              cwd: this.workspaceRoot,
              env: { ...process.env }
            });

            const timer = setTimeout(() => {
              proc.kill();
              resolve({ success: false, error: 'Command timed out', output });
            }, timeout);

            proc.stdout.on('data', d => { output += d.toString(); });
            proc.stderr.on('data', d => { error += d.toString(); });

            proc.on('close', (code) => {
              clearTimeout(timer);
              resolve({
                success: code === 0,
                exit_code: code,
                output: output.slice(0, 10000),
                error: error.slice(0, 2000)
              });
            });
          });
        }

        case 'list_directory': {
          const fullPath = this.resolvePath(input.path || '.');
          const entries = await fs.readdir(fullPath, { withFileTypes: true });
          const items = entries
            .filter(e => !['node_modules', '.git', '__pycache__', '.venv'].includes(e.name))
            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
          return { success: true, items };
        }

        case 'search_files': {
          const pattern = input.file_pattern ? `--include="${input.file_pattern}"` : '';
          return new Promise((resolve) => {
            const cmd = `grep -r ${pattern} -l "${input.query.replace(/"/g, '\\"')}" . 2>/dev/null | head -20`;
            const proc = spawn('bash', ['-c', cmd], { cwd: this.workspaceRoot });
            let output = '';
            proc.stdout.on('data', d => { output += d.toString(); });
            proc.on('close', () => {
              const files = output.trim().split('\n').filter(Boolean);
              resolve({ success: true, files, count: files.length });
            });
          });
        }

        case 'delete_file': {
          await fs.unlink(this.resolvePath(input.path));
          return { success: true, message: `Deleted: ${input.path}` };
        }

        case 'create_directory': {
          await fs.mkdir(this.resolvePath(input.path), { recursive: true });
          return { success: true, message: `Created: ${input.path}` };
        }

        case 'get_file_tree': {
          const buildTree = async (dir, depth, maxDepth) => {
            if (depth > maxDepth) return [];
            try {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              const items = [];
              for (const e of entries) {
                if (['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build'].includes(e.name)) continue;
                if (e.isDirectory()) {
                  const children = await buildTree(path.join(dir, e.name), depth + 1, maxDepth);
                  items.push(`${'  '.repeat(depth)}📁 ${e.name}/`);
                  items.push(...children);
                } else {
                  items.push(`${'  '.repeat(depth)}📄 ${e.name}`);
                }
              }
              return items;
            } catch { return []; }
          };
          const tree = await buildTree(this.resolvePath(input.path || '.'), 0, input.depth || 3);
          return { success: true, tree: tree.join('\n') };
        }

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Run agentic loop with Anthropic
  async runAnthropic(client, model, systemPrompt, userMessage, onEvent) {
    const Anthropic = require('@anthropic-ai/sdk');
    const messages = [{ role: 'user', content: userMessage }];
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      onEvent({ type: 'thinking', iteration: iterations });

      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        tools: TOOLS,
        messages
      });

      // Emit text blocks as they come
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          onEvent({ type: 'text', text: block.text });
        }
      }

      // Check stop reason
      if (response.stop_reason === 'end_turn') {
        onEvent({ type: 'done', iterations });
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(b => b.type === 'tool_use');
        const toolResults = [];

        for (const toolUse of toolUses) {
          onEvent({ type: 'tool_call', tool: toolUse.name, input: toolUse.input });
          const result = await this.executeTool(toolUse.name, toolUse.input);
          onEvent({ type: 'tool_result', tool: toolUse.name, result });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });
        }

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      } else {
        onEvent({ type: 'done', iterations });
        break;
      }
    }

    if (iterations >= this.maxIterations) {
      onEvent({ type: 'max_iterations', iterations });
    }
  }

  // Run agentic loop with Google Vertex AI
  async runGoogle(model, systemPrompt, userMessage, onEvent) {
    const { VertexAI } = require('@google-cloud/vertexai');
    const vertexAI = new VertexAI({
      project: process.env.GOOGLE_CLOUD_PROJECT || 'phazeai-ide',
      location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1'
    });

    const generativeModel = vertexAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      tools: TOOLS_VERTEX
    });

    const chat = generativeModel.startChat();
    let iterations = 0;
    let currentMessage = userMessage;

    while (iterations < this.maxIterations) {
      iterations++;
      onEvent({ type: 'thinking', iteration: iterations });

      const result = await chat.sendMessage(currentMessage);
      const response = result.response;
      const candidate = response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      let hasFunctionCalls = false;
      const functionResponses = [];

      for (const part of parts) {
        if (part.text) {
          onEvent({ type: 'text', text: part.text });
        }
        if (part.functionCall) {
          hasFunctionCalls = true;
          const { name, args } = part.functionCall;
          onEvent({ type: 'tool_call', tool: name, input: args });
          const toolResult = await this.executeTool(name, args);
          onEvent({ type: 'tool_result', tool: name, result: toolResult });
          functionResponses.push({
            functionResponse: {
              name,
              response: toolResult
            }
          });
        }
      }

      if (!hasFunctionCalls) {
        onEvent({ type: 'done', iterations });
        break;
      }

      currentMessage = functionResponses;
    }

    if (iterations >= this.maxIterations) {
      onEvent({ type: 'max_iterations', iterations });
    }
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
  }
}

module.exports = { AgentEngine, TOOLS };
