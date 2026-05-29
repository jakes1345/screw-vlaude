require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');

let anthropicClient = null;
let googleClient = null;
let groqClient = null;

function getAnthropicClient() {
  if (!anthropicClient && process.env.ANTHROPIC_API_KEY) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function getGoogleClient() {
  if (!googleClient && process.env.GOOGLE_API_KEY) {
    googleClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return googleClient;
}

function getGroqClient() {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'deepseek-r1-distill-llama-70b',
];

const ANTHROPIC_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001'
];

const GOOGLE_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

async function callAnthropic(model, messages, systemPrompt, stream, onChunk) {
  const client = getAnthropicClient();
  if (!client) throw new Error('Anthropic API key not configured');

  const params = {
    model,
    max_tokens: 8192,
    messages,
    ...(systemPrompt && { system: systemPrompt })
  };

  if (stream) {
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const streamResponse = await client.messages.stream(params);

    for await (const event of streamResponse) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text;
        if (onChunk) onChunk(event.delta.text);
      }
      if (event.type === 'message_start' && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens;
      }
      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens;
      }
    }

    return { text: fullText, inputTokens, outputTokens };
  } else {
    const response = await client.messages.create(params);
    return {
      text: response.content[0].text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    };
  }
}

async function callGoogle(model, messages, systemPrompt, stream, onChunk) {
  const client = getGoogleClient();
  if (!client) throw new Error('Google API key not configured');

  const genModel = client.getGenerativeModel({
    model,
    ...(systemPrompt && { systemInstruction: systemPrompt })
  });

  // Convert messages to Google format
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const lastMessage = messages[messages.length - 1];
  const chat = genModel.startChat({ history });

  if (stream) {
    let fullText = '';
    const result = await chat.sendMessageStream(lastMessage.content);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      fullText += text;
      if (onChunk) onChunk(text);
    }
    // Google doesn't give exact token counts in stream, estimate
    const inputTokens = Math.ceil(messages.map(m => m.content).join('').length / 4);
    const outputTokens = Math.ceil(fullText.length / 4);
    return { text: fullText, inputTokens, outputTokens };
  } else {
    const result = await chat.sendMessage(lastMessage.content);
    const text = result.response.text();
    const inputTokens = Math.ceil(messages.map(m => m.content).join('').length / 4);
    const outputTokens = Math.ceil(text.length / 4);
    return { text, inputTokens, outputTokens };
  }
}

async function callLocalModel(messages, systemPrompt, stream, onChunk) {
  const baseUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:5000';
  const apiKey = process.env.LOCAL_MODEL_API_KEY || 'none';

  const body = {
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages
    ],
    stream,
    max_tokens: 4096,
    temperature: 0.7
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Local model error: ${response.status} ${response.statusText}`);
  }

  if (stream) {
    let fullText = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta);
          }
        } catch {}
      }
    }

    return {
      text: fullText,
      inputTokens: Math.ceil(messages.map(m => m.content).join('').length / 4),
      outputTokens: Math.ceil(fullText.length / 4)
    };
  } else {
    const data = await response.json();
    const text = data.choices[0].message.content;
    return {
      text,
      inputTokens: data.usage?.prompt_tokens || Math.ceil(messages.map(m => m.content).join('').length / 4),
      outputTokens: data.usage?.completion_tokens || Math.ceil(text.length / 4)
    };
  }
}

async function callGroq(model, messages, systemPrompt, stream, onChunk) {
  const client = getGroqClient();
  if (!client) throw new Error('Groq API key not configured');

  const params = {
    model,
    max_tokens: 8192,
    messages: [
      ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
      ...messages
    ],
    stream,
  };

  if (stream) {
    let fullText = '';
    const streamResp = await client.chat.completions.create(params);
    for await (const chunk of streamResp) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        if (onChunk) onChunk(delta);
      }
    }
    const inputTokens = Math.ceil(messages.map(m => m.content).join('').length / 4);
    const outputTokens = Math.ceil(fullText.length / 4);
    return { text: fullText, inputTokens, outputTokens };
  } else {
    const resp = await client.chat.completions.create(params);
    const text = resp.choices[0].message.content;
    return {
      text,
      inputTokens: resp.usage?.prompt_tokens || 0,
      outputTokens: resp.usage?.completion_tokens || 0
    };
  }
}

async function routeToProvider(model, messages, systemPrompt, stream = false, onChunk = null) {
  if (GROQ_MODELS.includes(model)) {
    return callGroq(model, messages, systemPrompt, stream, onChunk);
  } else if (model === 'local') {
    return callLocalModel(messages, systemPrompt, stream, onChunk);
  } else if (ANTHROPIC_MODELS.includes(model)) {
    return callAnthropic(model, messages, systemPrompt, stream, onChunk);
  } else if (GOOGLE_MODELS.includes(model)) {
    return callGoogle(model, messages, systemPrompt, stream, onChunk);
  } else {
    throw new Error(`Unknown model: ${model}`);
  }
}

function getAvailableProviders() {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    google: !!process.env.GOOGLE_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    local: true // always try
  };
}

module.exports = { routeToProvider, getAvailableProviders, ANTHROPIC_MODELS, GOOGLE_MODELS, GROQ_MODELS };
