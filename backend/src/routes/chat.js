import express from 'express';
import { similaritySearch } from '../services/vectorDBService.js';
import { generateRAGResponse, generateRAGResponseStream } from '../services/llmService.js';
import { getAllDocuments } from '../services/documentStore.js';
import { logger } from '../utils/logger.js';

export const chatRoutes = express.Router();

// Non-streaming chat
chatRoutes.post('/', async (req, res, next) => {
  const { query, documentIds, conversationHistory = [] } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    const startTime = Date.now();
    
    // Step 1: Similarity search
    const contextChunks = await similaritySearch(query, {
      topK: parseInt(process.env.TOP_K_RESULTS) || 5,
      documentIds: documentIds?.length ? documentIds : null
    });

    logger.info(`Found ${contextChunks.length} relevant chunks for query: "${query.substring(0, 50)}..."`);

    // Step 2: Generate response
    const result = await generateRAGResponse(query, contextChunks, conversationHistory);

    const responseTime = Date.now() - startTime;

    res.json({
      answer: result.content,
      sources: contextChunks.map(c => ({
        fileName: c.metadata?.fileName,
        documentId: c.metadata?.documentId,
        relevanceScore: c.score,
        textPreview: c.text?.substring(0, 200) + '...',
        chunkIndex: c.metadata?.chunkIndex
      })),
      meta: {
        responseTimeMs: responseTime,
        chunksRetrieved: contextChunks.length,
        model: result.model,
        usage: result.usage
      }
    });
  } catch (error) {
    logger.error('Chat error:', error);
    next(error);
  }
});

// Streaming chat via Server-Sent Events
chatRoutes.post('/stream', async (req, res, next) => {
  const { query, documentIds, conversationHistory = [] } = req.body;

  if (!query?.trim()) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    // Step 1: Retrieve context
    sendEvent('status', { message: 'Searching documents...' });
    
    const contextChunks = await similaritySearch(query, {
      topK: parseInt(process.env.TOP_K_RESULTS) || 5,
      documentIds: documentIds?.length ? documentIds : null
    });

    sendEvent('sources', {
      sources: contextChunks.map(c => ({
        fileName: c.metadata?.fileName,
        documentId: c.metadata?.documentId,
        relevanceScore: c.score,
        textPreview: c.text?.substring(0, 200),
        chunkIndex: c.metadata?.chunkIndex
      }))
    });

    // Step 2: Stream LLM response
    sendEvent('status', { message: 'Generating response...' });
    
    let fullResponse = '';
    for await (const chunk of generateRAGResponseStream(query, contextChunks, conversationHistory)) {
      fullResponse += chunk;
      sendEvent('token', { content: chunk });
    }

    sendEvent('done', {
      fullResponse,
      chunksRetrieved: contextChunks.length
    });

  } catch (error) {
    logger.error('Stream chat error:', error);
    sendEvent('error', { message: error.message || 'Generation failed' });
  } finally {
    res.end();
  }
});

// Get chat suggestions based on uploaded documents
chatRoutes.get('/suggestions', async (req, res) => {
  const documents = getAllDocuments();
  
  const suggestions = documents.length > 0
    ? [
        'What are the main topics covered in the uploaded documents?',
        'Summarize the key points from the documents',
        'What are the most important findings?',
        'Can you explain the main concepts in simple terms?',
        'What questions does this document answer?'
      ]
    : [
        'Upload a document to get started',
        'I can analyze PDFs, Word docs, and text files',
        'Try uploading a research paper or report'
      ];

  res.json({ suggestions, documentCount: documents.length });
});
