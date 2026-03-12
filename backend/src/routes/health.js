import express from 'express';
import { getCollectionStats } from '../services/vectorDBService.js';

export const healthRoutes = express.Router();

function keyStatus(value, prefix) {
  if (!value || value.includes('your_') || value.includes('_here')) return '❌ not set';
  if (value.startsWith(prefix)) return '✅ configured';
  return '⚠️  check key format';
}

healthRoutes.get('/', async (req, res) => {
  const llmProvider       = process.env.LLM_PROVIDER       || 'groq';
  const embeddingProvider = process.env.EMBEDDING_PROVIDER || 'ollama';

  const providerStatus = {
    active: llmProvider,
    groq: {
      status:   keyStatus(process.env.GROQ_API_KEY, 'gsk_'),
      model:    process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      isActive: llmProvider === 'groq',
    },
    anthropic: {
      status:   keyStatus(process.env.ANTHROPIC_API_KEY, 'sk-ant'),
      model:    process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      isActive: llmProvider === 'anthropic',
    },
    ollama: {
      status:   llmProvider === 'ollama' ? '🔧 local' : '⏸ standby',
      model:    process.env.OLLAMA_MODEL || 'llama3.2',
      isActive: llmProvider === 'ollama',
    }
  };

  try {
    const stats = await getCollectionStats();
    res.json({
      status:    'healthy',
      timestamp: new Date().toISOString(),
      version:   '1.0.0',
      services: {
        vectorDB: { status: 'connected', ...stats },
        llm: providerStatus,
        embedding: {
          provider: embeddingProvider,
          model:    embeddingProvider === 'ollama'
            ? (process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text')
            : (process.env.HUGGINGFACE_EMBEDDING_MODEL || 'all-MiniLM-L6-v2'),
          dim: process.env.EMBEDDING_DIM || '768',
        }
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded', error: error.message,
      timestamp: new Date().toISOString(),
      services: { llm: providerStatus }
    });
  }
});

// POST /api/health/provider — switch provider without restart
healthRoutes.post('/provider', (req, res) => {
  const { provider } = req.body;
  const valid = ['groq', 'anthropic', 'ollama', 'openai_compatible'];
  if (!valid.includes(provider)) {
    return res.status(400).json({ error: `Invalid provider. Use: ${valid.join(', ')}` });
  }
  process.env.LLM_PROVIDER = provider;
  res.json({
    success:  true,
    message:  `Switched to ${provider} for this session`,
    provider,
    warning:  'Temporary only — update LLM_PROVIDER in .env to make permanent'
  });
});