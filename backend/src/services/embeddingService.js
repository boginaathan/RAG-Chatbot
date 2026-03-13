import { logger } from '../utils/logger.js';

/**
 * Embeddings Service
 * Supports multiple embedding providers:
 * 1. Ollama (local) - nomic-embed-text (768-dim), mxbai-embed-large (1024-dim)
 * 2. HuggingFace Inference API - sentence-transformers (384-dim)
 * 3. OpenAI-compatible (LMStudio, etc.)
 * 4. TF-IDF fallback (matches detected dimension to prevent ChromaDB 422 errors)
 *
 * ROOT CAUSE OF 422 ERROR:
 * ChromaDB rejects upsert if embedding dimensions don't match what the
 * collection was created with. nomic-embed-text = 768-dim, but the old
 * TF-IDF fallback used 384-dim. If Ollama failed silently and fell back
 * to TF-IDF, ChromaDB would get mixed dimensions → 422 Unprocessable Entity.
 *
 * FIX: Detect dimension from first real embedding call and use it everywhere.
 */

const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';

// Default dimension per model:
//   nomic-embed-text  → 768   ← Ollama default
//   mxbai-embed-large → 1024
//   all-MiniLM-L6-v2  → 384
//   text-embedding-ada-002 → 1536
export const EMBEDDING_DIM = parseInt(process.env.EMBEDDING_DIM) || 768;

// Tracks the actual dimension after first successful embedding call
let detectedDim = null;

export async function generateEmbedding(text) {
  try {
    let embedding;

    switch (EMBEDDING_PROVIDER) {
      case 'ollama':
        embedding = await ollamaEmbedding(text);
        break;
      case 'huggingface':
        embedding = await huggingfaceEmbedding(text);
        break;
      case 'openai_compatible':
        embedding = await openaiCompatibleEmbedding(text);
        break;
      default:
        embedding = await ollamaEmbedding(text);
    }

    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Embedding provider returned empty or invalid vector');
    }

    // Cache actual dimension on first successful call
    if (!detectedDim) {
      detectedDim = embedding.length;
      logger.info(`✅ Embedding dimension detected: ${detectedDim} (provider: ${EMBEDDING_PROVIDER}, model: ${process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'})`);
    }

    return embedding;
  } catch (error) {
    logger.warn(`Primary embedding failed (${EMBEDDING_PROVIDER}), using TF-IDF fallback. Error: ${error.message}`);
    // Use detected dim so fallback matches real embeddings already in ChromaDB
    return tfidfEmbedding(text, detectedDim || EMBEDDING_DIM);
  }
}

export async function generateBatchEmbeddings(texts) {
  logger.info(`Generating ${texts.length} embeddings via ${EMBEDDING_PROVIDER}...`);
  const embeddings = [];

  for (let i = 0; i < texts.length; i++) {
    const embedding = await generateEmbedding(texts[i]);
    embeddings.push(embedding);

    if ((i + 1) % 10 === 0 || i === texts.length - 1) {
      logger.info(`  Progress: ${i + 1}/${texts.length} chunks embedded`);
    }

    // Small throttle to avoid overloading local Ollama
    if (i < texts.length - 1) await sleep(50);
  }

  // Validate consistent dimensions — mixed dims = ChromaDB 422
  const dims = [...new Set(embeddings.map(e => e?.length).filter(Boolean))];
  if (dims.length > 1) {
    throw new Error(
      `Embedding dimension mismatch in batch: got dimensions [${dims.join(', ')}]. ` +
      `All vectors must have the same size. Check your embedding model configuration.`
    );
  }

  logger.info(`✅ All ${embeddings.length} embeddings generated (dim: ${dims[0]})`);
  return embeddings;
}

/** Returns detected dimension (populated after first embedding call) */
export function getEmbeddingDim() {
  return detectedDim || EMBEDDING_DIM;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding Provider Implementations
// ─────────────────────────────────────────────────────────────────────────────

async function ollamaEmbedding(text) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

  // Try new /api/embed endpoint first (Ollama >= 0.1.26 — recommended)
  let response = await fetch(`${baseUrl}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text })
  });

  if (response.status === 404) {
    // Fallback: legacy /api/embeddings for older Ollama installs
    response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama (legacy) failed: ${response.status} ${response.statusText}. Body: ${body}`);
    }

    const data = await response.json();
    if (Array.isArray(data.embedding)) return data.embedding;
    throw new Error('Ollama legacy endpoint returned unexpected format');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Ollama /api/embed failed: ${response.status} ${response.statusText}. Body: ${body}. ` +
      `Make sure Ollama is running and the model "${model}" is pulled (run: ollama pull ${model})`
    );
  }

  const data = await response.json();

  // /api/embed returns { embeddings: [[float, ...]] }
  if (Array.isArray(data.embeddings?.[0])) return data.embeddings[0];

  // Some builds return { embedding: [...] } flat
  if (Array.isArray(data.embedding)) return data.embedding;

  throw new Error(`Unexpected Ollama response shape: ${JSON.stringify(Object.keys(data))}`);
}

async function huggingfaceEmbedding(text) {
  const model = process.env.HUGGINGFACE_EMBEDDING_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!apiKey) throw new Error('HUGGINGFACE_API_KEY not set in .env');

  const response = await fetch(
    `https://router.huggingface.co/pipeline/feature-extraction/${model}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } })
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HuggingFace embedding failed: ${response.status} — ${body}`);
  }

  const data = await response.json();
  // sentence-transformers returns [[...]] (nested array)
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0];
  if (Array.isArray(data)) return data;

  throw new Error(`Unexpected HuggingFace response format`);
}

async function openaiCompatibleEmbedding(text) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text })
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible embedding failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.data?.[0]?.embedding) {
    throw new Error('Invalid OpenAI-compatible embedding response — missing data[0].embedding');
  }
  return data.data[0].embedding;
}

// ─────────────────────────────────────────────────────────────────────────────
// TF-IDF Fallback Embedding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure local TF-IDF embedding. No API required.
 * Dim matches whatever the primary provider produces (prevents 422 from ChromaDB).
 */
function tfidfEmbedding(text, dim = EMBEDDING_DIM) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return new Array(dim).fill(0);

  const vector = new Array(dim).fill(0);
  const wordFreq = {};
  for (const word of words) wordFreq[word] = (wordFreq[word] || 0) + 1;

  for (const [word, freq] of Object.entries(wordFreq)) {
    let h = 5381;
    for (let i = 0; i < word.length; i++) {
      h = Math.imul(31, h) + word.charCodeAt(i) | 0;
    }
    const tfidf = freq / words.length;
    // Spread each word across 3 positions for better coverage
    const p0 = Math.abs(h) % dim;
    const p1 = Math.abs(Math.imul(h, 2654435761) | 0) % dim;
    const p2 = Math.abs(Math.imul(h, 40503) | 0) % dim;
    vector[p0] += tfidf;
    vector[p1] += tfidf * 0.7;
    vector[p2] += tfidf * 0.4;
  }

  // L2 normalize
  const mag = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map(v => v / mag);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
