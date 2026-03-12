import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

/**
 * LLM Service — Groq as Primary Provider
 * Groq: FREE, no credit card, 1-3 sec responses
 * Get key: https://console.groq.com
 */

const getLLMProvider = () => process.env.LLM_PROVIDER || 'groq';

export async function generateRAGResponse(query, context, conversationHistory = []) {
  const systemPrompt = buildSystemPrompt(context);
  const messages = buildMessages(query, conversationHistory);
  const start = Date.now();
  logger.info(`[LLM] ${getLLMProvider()} | chunks:${context.length} | "${query.substring(0, 60)}"`);
  try {
    let result;
    switch (getLLMProvider()) {
      case 'groq':              result = await groqGenerate(systemPrompt, messages); break;
      case 'anthropic':         result = await anthropicGenerate(systemPrompt, messages); break;
      case 'ollama':            result = await ollamaGenerate(systemPrompt, messages); break;
      case 'openai_compatible': result = await openaiCompatibleGenerate(systemPrompt, messages); break;
      default: throw new Error(`Unknown LLM_PROVIDER: "${getLLMProvider()}". Valid: groq, anthropic, ollama, openai_compatible`);
    }
    logger.info(`[LLM] Done in ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    logger.error(`[LLM] Failed (${getLLMProvider()}): ${error.message}`);
    throw new Error(`Failed to generate response: ${error.message}`);
  }
}

export async function* generateRAGResponseStream(query, context, conversationHistory = []) {
  const systemPrompt = buildSystemPrompt(context);
  const messages = buildMessages(query, conversationHistory);
  logger.info(`[LLM] Stream | ${getLLMProvider()} | chunks:${context.length}`);
  try {
    switch (getLLMProvider()) {
      case 'groq':              yield* groqStream(systemPrompt, messages); break;
      case 'anthropic':         yield* anthropicStream(systemPrompt, messages); break;
      case 'ollama':            yield* ollamaStream(systemPrompt, messages); break;
      case 'openai_compatible': yield* openaiCompatibleStream(systemPrompt, messages); break;
      default: throw new Error(`Unknown LLM_PROVIDER: "${getLLMProvider()}"`);
    }
  } catch (error) {
    logger.error(`[LLM] Stream failed: ${error.message}`);
    throw error;
  }
}

// ── Prompt Builder ────────────────────────────────────────────────────────────

function buildSystemPrompt(contextChunks) {
  const maxContext = parseInt(process.env.MAX_CONTEXT_LENGTH) || 3000;
  const contextText = contextChunks
    .map((chunk, i) =>
      `[Source ${i + 1}] ${chunk.metadata?.fileName || 'Document'} (relevance: ${(chunk.score * 100).toFixed(0)}%)\n${chunk.text}`
    )
    .join('\n\n---\n\n');
  const trimmed = contextText.length > maxContext
    ? contextText.substring(0, maxContext) + '... [truncated]'
    : contextText;

  return `You are an intelligent RAG assistant. Answer questions based ONLY on the context documents below.

GUIDELINES:
- Answer based on the provided context only
- Cite sources like [Source 1], [Source 2]
- If answer not in context, say "I don't have information about that in the uploaded documents"
- Be concise but thorough
- Use markdown formatting when helpful

CONTEXT DOCUMENTS:
${trimmed || 'No documents uploaded yet. Please upload documents first.'}`;
}

function buildMessages(query, history) {
  const messages = [];
  for (const turn of history.slice(-12)) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: query });
  return messages;
}

// ── Groq (FREE — Primary Provider) ───────────────────────────────────────────

async function groqGenerate(systemPrompt, messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env — get free key at https://console.groq.com');

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const max_tokens = parseInt(process.env.MAX_TOKENS) || 1024;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.1,
      max_tokens,
      stream: false
    })
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('Groq API key invalid — check GROQ_API_KEY in .env');
    if (response.status === 429) throw new Error('Groq rate limit hit — wait 1 minute and retry');
    throw new Error(`Groq error ${response.status}: ${err}`);
  }

  const data = await response.json();
  logger.info(`[Groq] ${data.model} | in:${data.usage?.prompt_tokens} out:${data.usage?.completion_tokens} tokens`);
  return { content: data.choices[0].message.content, model: data.model, usage: data.usage };
}

async function* groqStream(systemPrompt, messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const max_tokens = parseInt(process.env.MAX_TOKENS) || 1024;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.1,
      max_tokens,
      stream: true
    })
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('Groq API key invalid');
    if (response.status === 429) throw new Error('Groq rate limit — wait 1 minute');
    throw new Error(`Groq stream error ${response.status}: ${err}`);
  }

  yield* parseSSEStream(response);
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function anthropicGenerate(systemPrompt, messages) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: parseInt(process.env.MAX_TOKENS) || 1024,
    system: systemPrompt,
    messages
  });
  return { content: response.content[0].text, model: response.model, usage: response.usage };
}

async function* anthropicStream(systemPrompt, messages) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = await client.messages.stream({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: parseInt(process.env.MAX_TOKENS) || 1024,
    system: systemPrompt,
    messages
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') yield chunk.delta.text;
  }
}

// ── Ollama (Local Fallback) ───────────────────────────────────────────────────

async function ollamaGenerate(systemPrompt, messages) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: false,
      options: {
        temperature: 0.1,
        num_ctx: parseInt(process.env.OLLAMA_NUM_CTX) || 2048,
        num_predict: parseInt(process.env.OLLAMA_MAX_TOKENS) || 512,
        num_thread: parseInt(process.env.OLLAMA_NUM_THREAD) || 0,
        num_gpu: parseInt(process.env.OLLAMA_NUM_GPU ?? '99'),
        repeat_penalty: 1.1,
      }
    })
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Ollama error ${response.status}: ${err}. Is Ollama running? Run: ollama serve`);
  }
  const data = await response.json();
  const secs = (data.total_duration / 1e9).toFixed(1);
  const tokSec = data.eval_count ? (data.eval_count / (data.eval_duration / 1e9)).toFixed(1) : '?';
  logger.info(`[Ollama] ${secs}s | ${tokSec} tok/s | in=${data.prompt_eval_count} out=${data.eval_count}`);
  return { content: data.message.content, model: data.model, usage: { input_tokens: data.prompt_eval_count, output_tokens: data.eval_count } };
}

async function* ollamaStream(systemPrompt, messages) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL || 'llama3.2';
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: parseInt(process.env.OLLAMA_NUM_CTX) || 2048,
        num_predict: parseInt(process.env.OLLAMA_MAX_TOKENS) || 512,
        num_thread: parseInt(process.env.OLLAMA_NUM_THREAD) || 0,
        num_gpu: parseInt(process.env.OLLAMA_NUM_GPU ?? '99'),
      }
    })
  });
  if (!response.ok) throw new Error(`Ollama stream error: ${response.statusText}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split('\n').filter(Boolean)) {
      try {
        const data = JSON.parse(line);
        if (data.message?.content) yield data.message.content;
        if (data.done) return;
      } catch {}
    }
  }
}

// ── OpenAI-compatible ─────────────────────────────────────────────────────────

async function openaiCompatibleGenerate(systemPrompt, messages) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'local-model',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.1,
      max_tokens: parseInt(process.env.MAX_TOKENS) || 1024
    })
  });
  if (!response.ok) throw new Error(`OpenAI-compatible error: ${response.statusText}`);
  const data = await response.json();
  return { content: data.choices[0].message.content, model: data.model, usage: data.usage };
}

async function* openaiCompatibleStream(systemPrompt, messages) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'local-model',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.1, stream: true
    })
  });
  if (!response.ok) throw new Error(`Stream error: ${response.statusText}`);
  yield* parseSSEStream(response);
}

// ── Shared SSE Parser ─────────────────────────────────────────────────────────

async function* parseSSEStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === 'data: [DONE]') continue;
      if (t.startsWith('data: ')) {
        try {
          const content = JSON.parse(t.slice(6)).choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {}
      }
    }
  }
}
