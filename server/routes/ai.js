const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const NodeCache = require('node-cache');
const crypto = require('crypto');

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

let anthropic = null;
let googleAI = null;

function getAnthropic() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function getGoogle() {
  if (!googleAI && process.env.GOOGLE_API_KEY) {
    googleAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return googleAI;
}

// Spending tracker
let sessionSpend = 0;
let totalSpend = parseFloat(process.env.SPEND_CAP || '5.00');

function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

function estimateCost(inputTokens, outputTokens, model) {
  const costs = {
    'claude-opus-4-5-20251101':     { input: 15,    output: 75   },
    'claude-sonnet-4-5-20251022':   { input: 3,     output: 15   },
    'claude-haiku-4-5-20251001':    { input: 0.25,  output: 1.25 },
    'gemini-2.0-flash-exp':         { input: 0.075, output: 0.30 },
    'gemini-1.5-pro-latest':        { input: 1.25,  output: 5.00 },
    'gemini-1.5-flash-latest':      { input: 0.075, output: 0.30 },
    'tabby-local':                  { input: 0,     output: 0    }
  };
  const c = costs[model] || { input: 3, output: 15 };
  return ((inputTokens * c.input) + (outputTokens * c.output)) / 1_000_000;
}

function getCacheKey(messages, model, systemPrompt) {
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ messages, model, systemPrompt }))
    .digest('hex');
  return hash;
}

// Auto-route to cheapest capable model based on task complexity
function autoRoute(prompt, preferredModel) {
  if (preferredModel && preferredModel !== 'auto') return preferredModel;
  const len = prompt.length;
  const hasComplexKeywords = /refactor|architecture|security|vulnerability|exploit|reverse|deobfuscat|autonomous|agent/i.test(prompt);
  if (len < 500 && !hasComplexKeywords) {
    if (process.env.TABBY_API_URL) return 'tabby-local';
    if (process.env.GOOGLE_API_KEY) return 'gemini-2.0-flash-exp';
    return 'claude-haiku-4-5-20251001';
  }
  if (len < 2000 && !hasComplexKeywords) {
    if (process.env.GOOGLE_API_KEY) return 'gemini-1.5-flash-latest';
    return 'claude-sonnet-4-5-20251022';
  }
  if (process.env.ANTHROPIC_API_KEY) return 'claude-sonnet-4-5-20251022';
  if (process.env.GOOGLE_API_KEY) return 'gemini-1.5-pro-latest';
  return 'tabby-local';
}

async function callAnthropic(model, messages, systemPrompt, maxTokens = 4096) {
  const client = getAnthropic();
  if (!client) throw new Error('Anthropic API key not configured');
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt || 'You are an expert software engineer and security researcher. Provide precise, working code. No placeholders.',
    messages
  });
  return {
    content: response.content[0].text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model
  };
}

async function callGoogle(model, messages, systemPrompt) {
  const client = getGoogle();
  if (!client) throw new Error('Google API key not configured');
  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemPrompt || 'You are an expert software engineer and security researcher. Provide precise, working code. No placeholders.'
  });
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const chat = genModel.startChat({ history });
  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  const text = result.response.text();
  const inputTokens = estimateTokens(messages.map(m => m.content).join(''));
  const outputTokens = estimateTokens(text);
  return { content: text, inputTokens, outputTokens, model };
}

async function callTabby(messages, systemPrompt) {
  const url = process.env.TABBY_API_URL;
  if (!url) throw new Error('TabbyAPI URL not configured');
  const formatted = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const prompt = systemPrompt ? `${systemPrompt}\n\n${formatted}\nAssistant:` : `${formatted}\nAssistant:`;
  const response = await fetch(`${url}/v1/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.TABBY_API_KEY ? { 'Authorization': `Bearer ${process.env.TABBY_API_KEY}` } : {}) },
    body: JSON.stringify({ prompt, max_tokens: 2048, temperature: 0.7, stop: ['\nUser:', '\nHuman:'] })
  });
  if (!response.ok) throw new Error(`TabbyAPI error: ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.text || '';
  return { content, inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(content), model: 'tabby-local' };
}

// Estimate cost before sending
router.post('/estimate', (req, res) => {
  const { messages, model, systemPrompt } = req.body;
  const allText = (systemPrompt || '') + messages.map(m => m.content).join('');
  const inputTokens = estimateTokens(allText);
  const outputTokens = 1024; // estimated output
  const cost = estimateCost(inputTokens, outputTokens, model);
  const remainingBudget = totalSpend - sessionSpend;
  res.json({
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCost: cost,
    sessionSpend,
    remainingBudget,
    willExceedBudget: cost > remainingBudget,
    suggestedModel: autoRoute(messages[messages.length - 1]?.content || '', null)
  });
});

// Main completion endpoint
router.post('/complete', async (req, res) => {
  try {
    const { messages, model: requestedModel, systemPrompt, useCache = true, maxTokens = 4096 } = req.body;
    const model = autoRoute(messages[messages.length - 1]?.content || '', requestedModel);

    // Check cache
    if (useCache) {
      const key = getCacheKey(messages, model, systemPrompt);
      const cached = cache.get(key);
      if (cached) {
        return res.json({ ...cached, cached: true });
      }
    }

    // Budget check
    const inputTokens = estimateTokens((systemPrompt || '') + messages.map(m => m.content).join(''));
    const estimatedCost = estimateCost(inputTokens, 1024, model);
    if (sessionSpend + estimatedCost > totalSpend * 1.1) {
      return res.status(402).json({ error: 'Budget limit reached', sessionSpend, limit: totalSpend });
    }

    let result;
    const provider = model.startsWith('claude') ? 'anthropic' : model.startsWith('gemini') ? 'google' : 'local';

    if (provider === 'anthropic') result = await callAnthropic(model, messages, systemPrompt, maxTokens);
    else if (provider === 'google') result = await callGoogle(model, messages, systemPrompt);
    else result = await callTabby(messages, systemPrompt);

    const actualCost = estimateCost(result.inputTokens, result.outputTokens, model);
    sessionSpend += actualCost;

    const response = { ...result, cost: actualCost, sessionSpend, remainingBudget: totalSpend - sessionSpend, cached: false };

    if (useCache) {
      const key = getCacheKey(messages, model, systemPrompt);
      cache.set(key, response);
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming via WebSocket
async function streamAI(ws, data) {
  const { messages, model: requestedModel, systemPrompt, requestId } = data;
  const model = autoRoute(messages[messages.length - 1]?.content || '', requestedModel);
  const send = (payload) => ws.send(JSON.stringify({ requestId, ...payload }));

  try {
    if (model.startsWith('claude')) {
      const client = getAnthropic();
      if (!client) throw new Error('Anthropic API key not configured');
      const stream = await client.messages.stream({
        model,
        max_tokens: 4096,
        system: systemPrompt || 'You are an expert software engineer. Provide precise, working code. No placeholders.',
        messages
      });
      let totalOutput = 0;
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          totalOutput += chunk.delta.text.length;
          send({ type: 'chunk', content: chunk.delta.text });
        }
      }
      const final = await stream.finalMessage();
      const cost = estimateCost(final.usage.input_tokens, final.usage.output_tokens, model);
      sessionSpend += cost;
      send({ type: 'done', model, cost, sessionSpend, remainingBudget: totalSpend - sessionSpend });
    } else if (model.startsWith('gemini')) {
      const client = getGoogle();
      if (!client) throw new Error('Google API key not configured');
      const genModel = client.getGenerativeModel({ model });
      const history = messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const chat = genModel.startChat({ history });
      const result = await chat.sendMessageStream(messages[messages.length - 1].content);
      let fullText = '';
      for await (const chunk of result.stream) {
        const text = chunk.text();
        fullText += text;
        send({ type: 'chunk', content: text });
      }
      const cost = estimateCost(estimateTokens(messages.map(m => m.content).join('')), estimateTokens(fullText), model);
      sessionSpend += cost;
      send({ type: 'done', model, cost, sessionSpend, remainingBudget: totalSpend - sessionSpend });
    } else {
      const result = await callTabby(messages, systemPrompt);
      send({ type: 'chunk', content: result.content });
      send({ type: 'done', model, cost: 0, sessionSpend, remainingBudget: totalSpend - sessionSpend });
    }
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
}

router.get('/spend', (req, res) => {
  res.json({ sessionSpend, totalSpend, remaining: totalSpend - sessionSpend, cacheSize: cache.keys().length });
});

router.post('/spend/reset', (req, res) => {
  sessionSpend = 0;
  res.json({ message: 'Session spend reset', sessionSpend });
});

router.post('/spend/cap', (req, res) => {
  const { cap } = req.body;
  if (cap && cap > 0) totalSpend = parseFloat(cap);
  res.json({ totalSpend });
});

router.post('/cache/clear', (req, res) => {
  cache.flushAll();
  res.json({ message: 'Cache cleared' });
});

module.exports = router;
module.exports.streamAI = streamAI;
