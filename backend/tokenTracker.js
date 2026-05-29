// Token cost per 1M tokens (USD) - updated May 2026
const MODEL_COSTS = {
  // Anthropic
  'claude-opus-4-6': { input: 15.00, output: 75.00, name: 'Claude Opus 4.6' },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, name: 'Claude Sonnet 4.6' },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, name: 'Claude Sonnet 4' },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, name: 'Claude Haiku 4.5' },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10.00, name: 'Gemini 2.5 Pro' },
  'gemini-2.5-flash': { input: 0.075, output: 0.30, name: 'Gemini 2.5 Flash' },
  'gemini-2.0-flash': { input: 0.10, output: 0.40, name: 'Gemini 2.0 Flash' },
  // Local
  'local': { input: 0, output: 0, name: 'Local Model (Free)' }
};

class TokenTracker {
  constructor() {
    this.sessions = {};
    this.monthlySpend = 0;
    this.monthlyBudget = parseFloat(process.env.MONTHLY_BUDGET) || 5.00;
    this.warnAt = parseFloat(process.env.WARN_AT_PERCENT) || 80;
    this.history = [];
  }

  estimateCost(model, inputTokens, outputTokens = 0) {
    const costs = MODEL_COSTS[model] || MODEL_COSTS['claude-sonnet-4-6'];
    const inputCost = (inputTokens / 1_000_000) * costs.input;
    const outputCost = (outputTokens / 1_000_000) * costs.output;
    return {
      input: inputCost,
      output: outputCost,
      total: inputCost + outputCost,
      model: costs.name
    };
  }

  // Rough token estimate before sending (4 chars ≈ 1 token)
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  recordUsage(model, inputTokens, outputTokens, sessionId) {
    const cost = this.estimateCost(model, inputTokens, outputTokens);
    this.monthlySpend += cost.total;

    const record = {
      timestamp: new Date().toISOString(),
      model,
      inputTokens,
      outputTokens,
      cost: cost.total,
      sessionId
    };

    this.history.push(record);

    if (!this.sessions[sessionId]) {
      this.sessions[sessionId] = { spend: 0, requests: 0 };
    }
    this.sessions[sessionId].spend += cost.total;
    this.sessions[sessionId].requests += 1;

    return {
      cost,
      monthlySpend: this.monthlySpend,
      monthlyBudget: this.monthlyBudget,
      percentUsed: (this.monthlySpend / this.monthlyBudget) * 100,
      nearLimit: (this.monthlySpend / this.monthlyBudget) * 100 >= this.warnAt,
      overLimit: this.monthlySpend >= this.monthlyBudget
    };
  }

  getStats() {
    return {
      monthlySpend: this.monthlySpend.toFixed(4),
      monthlyBudget: this.monthlyBudget.toFixed(2),
      percentUsed: ((this.monthlySpend / this.monthlyBudget) * 100).toFixed(1),
      remaining: (this.monthlyBudget - this.monthlySpend).toFixed(4),
      requestCount: this.history.length,
      history: this.history.slice(-50),
      sessions: this.sessions
    };
  }

  isOverBudget() {
    return this.monthlySpend >= this.monthlyBudget;
  }

  resetMonthly() {
    this.monthlySpend = 0;
    this.history = [];
    this.sessions = {};
  }

  getModelList() {
    return Object.entries(MODEL_COSTS).map(([id, info]) => ({
      id,
      name: info.name,
      inputCostPer1M: info.input,
      outputCostPer1M: info.output,
      free: info.input === 0
    }));
  }
}

module.exports = { TokenTracker, MODEL_COSTS };

// Add Groq models to MODEL_COSTS at runtime
const GROQ_COSTS = {
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79, name: 'Llama 3.3 70B (Groq)' },
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79, name: 'Llama 3.1 70B (Groq)' },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08, name: 'Llama 3.1 8B (Groq)' },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24, name: 'Mixtral 8x7B (Groq)' },
  'gemma2-9b-it': { input: 0.20, output: 0.20, name: 'Gemma2 9B (Groq)' },
  'deepseek-r1-distill-llama-70b': { input: 0.75, output: 0.99, name: 'DeepSeek R1 70B (Groq)' },
};
Object.assign(MODEL_COSTS, GROQ_COSTS);
