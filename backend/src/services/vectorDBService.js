import { logger } from '../utils/logger.js';
import { generateEmbedding, generateBatchEmbeddings, getEmbeddingDim } from './embeddingService.js';

/**
 * Vector Database Service
 * Primary:  ChromaDB (supports both v1 and v2 API)
 * Fallback: In-memory cosine similarity store
 *
 * FIXES vs original:
 * 1. ChromaDB v2 client uses { host, port, ssl } not { path }
 * 2. Collection creation now uses embeddingFunction: null to prevent
 *    ChromaDB from re-embedding (we supply our own vectors)
 * 3. Old collections with wrong dimensions are deleted and recreated
 * 4. Better error messages pointing to root causes
 */

let vectorStore = null;   // ChromaDB client
let useInMemory = false;

const COLLECTION_NAME = () => process.env.CHROMA_COLLECTION_NAME || 'rag_documents';

// ─── In-memory fallback store ────────────────────────────────────────────────
const memoryStore = {
  collections: new Map(),
  getOrCreate(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, {
        documents: [], embeddings: [], metadatas: [], ids: [], dim: null
      });
    }
    return this.collections.get(name);
  }
};

// ─── Init ────────────────────────────────────────────────────────────────────
export async function initVectorDB() {
  const host = process.env.CHROMA_HOST || 'localhost';
  const port = parseInt(process.env.CHROMA_PORT) || 8000;
  const ssl  = process.env.CHROMA_SSL === 'true';

  try {
    const { ChromaClient } = await import('chromadb');

    const client = ssl
      ? new ChromaClient({ path: `https://${host}` })
      : new ChromaClient({ host, port });

    await client.heartbeat();
    vectorStore = client;
    logger.info(`✅ Connected to ChromaDB at ${host}`);
    await getOrCreateCollection();
  } catch (error) {
    logger.warn(`⚠️  ChromaDB not available: ${error.message}. Using in-memory store.`);
    useInMemory = true;
  }
}

// ─── Collection management ───────────────────────────────────────────────────
async function getOrCreateCollection() {
  if (useInMemory) return memoryStore.getOrCreate(COLLECTION_NAME());

  try {
    // Use getOrCreateCollection with no embeddingFunction so ChromaDB stores
    // vectors exactly as we provide them (no re-embedding on its side).
    const collection = await vectorStore.getOrCreateCollection({
      name: COLLECTION_NAME(),
      metadata: { 'hnsw:space': 'cosine' },
      // Explicitly no embedding function — we supply vectors ourselves
      embeddingFunction: null
    });
    return collection;
  } catch (error) {
    logger.error('Failed to get/create ChromaDB collection:', error.message);
    throw error;
  }
}

/**
 * Delete and recreate the collection.
 * Needed when embedding dimensions change (e.g. switching models).
 */
export async function resetCollection() {
  if (useInMemory) {
    memoryStore.collections.delete(COLLECTION_NAME());
    return memoryStore.getOrCreate(COLLECTION_NAME());
  }
  try {
    await vectorStore.deleteCollection({ name: COLLECTION_NAME() });
    logger.info(`Deleted collection "${COLLECTION_NAME()}"`);
  } catch {}
  return getOrCreateCollection();
}

// ─── Store ───────────────────────────────────────────────────────────────────
export async function storeDocumentChunks(documentId, chunks, documentMetadata) {
  logger.info(`Storing ${chunks.length} chunks for document: ${documentMetadata.fileName}`);

  const texts = chunks.map(c => c.text);
  let embeddings;

  try {
    embeddings = await generateBatchEmbeddings(texts);
  } catch (error) {
    logger.error('Embedding generation failed:', error.message);
    throw error;
  }

  // Validate every embedding is a non-empty array of numbers
  for (let i = 0; i < embeddings.length; i++) {
    const e = embeddings[i];
    if (!Array.isArray(e) || e.length === 0) {
      throw new Error(`Embedding ${i} is invalid (${typeof e}). Cannot store in ChromaDB.`);
    }
    if (e.some(v => typeof v !== 'number' || isNaN(v) || !isFinite(v))) {
      throw new Error(`Embedding ${i} contains NaN or Infinity values.`);
    }
  }

  const ids = chunks.map((_, i) => `${documentId}_chunk_${i}`);
  const metadatas = chunks.map((chunk, i) => ({
    documentId,
    chunkIndex: chunk.index ?? i,
    fileName: documentMetadata.fileName,
    fileType: documentMetadata.fileType,
    uploadedAt: documentMetadata.uploadedAt,
    charStart: chunk.charStart ?? 0,
    textPreview: chunk.text.substring(0, 100)
  }));

  // ── In-memory path ────────────────────────────────────────────────────────
  if (useInMemory) {
    const col = memoryStore.getOrCreate(COLLECTION_NAME());
    for (let i = 0; i < ids.length; i++) {
      const existing = col.ids.indexOf(ids[i]);
      if (existing !== -1) {
        col.ids.splice(existing, 1);
        col.documents.splice(existing, 1);
        col.embeddings.splice(existing, 1);
        col.metadatas.splice(existing, 1);
      }
      col.ids.push(ids[i]);
      col.documents.push(texts[i]);
      col.embeddings.push(embeddings[i]);
      col.metadatas.push(metadatas[i]);
    }
    col.dim = embeddings[0].length;
    logger.info(`✅ Stored ${ids.length} chunks in memory (dim: ${col.dim})`);
    return { stored: ids.length };
  }

  // ── ChromaDB path ─────────────────────────────────────────────────────────
  const collection = await getOrCreateCollection();
  const BATCH_SIZE = 50; // Smaller batches = more stable with large docs

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);
    const batchDocs = texts.slice(i, i + BATCH_SIZE);
    const batchMeta = metadatas.slice(i, i + BATCH_SIZE);

    try {
      await collection.upsert({
        ids: batchIds,
        embeddings: batchEmbeddings,
        documents: batchDocs,
        metadatas: batchMeta
      });
      logger.info(`  Stored batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ids.length / BATCH_SIZE)} (${batchIds.length} chunks)`);
    } catch (error) {
      // Provide a helpful error message for the most common failure
      if (error.message?.includes('422') || error.message?.includes('Unprocessable')) {
        const dim = batchEmbeddings[0]?.length;
        logger.error(
          `ChromaDB 422 error! Embedding dimension mismatch.\n` +
          `  Current embedding dim: ${dim}\n` +
          `  This happens when you switch embedding models but the collection already\n` +
          `  exists with a different dimension.\n` +
          `  FIX: Call DELETE /api/documents/reset-collection to recreate the collection,\n` +
          `  OR delete ChromaDB data folder and restart.`
        );
        throw new Error(
          `ChromaDB rejected embeddings (dim: ${dim}). ` +
          `The collection was created with a different embedding dimension. ` +
          `Call POST /api/documents/reset-collection to fix this.`
        );
      }
      throw error;
    }
  }

  logger.info(`✅ Stored ${ids.length} chunks in ChromaDB (dim: ${embeddings[0].length})`);
  return { stored: ids.length };
}

// ─── Similarity search ────────────────────────────────────────────────────────
export async function similaritySearch(query, options = {}) {
  const {
    topK = parseInt(process.env.TOP_K_RESULTS) || 5,
    documentIds = null,
    minScore = 0.2   // Lowered from 0.3 — TF-IDF scores tend to be lower
  } = options;

  const queryEmbedding = await generateEmbedding(query);

  if (useInMemory) {
    return inMemorySimilaritySearch(queryEmbedding, topK, documentIds, minScore);
  }

  const collection = await getOrCreateCollection();

  const whereFilter = documentIds?.length
    ? { documentId: { '$in': documentIds } }
    : undefined;

  let results;
  try {
    results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(topK * 2, 50),
      where: whereFilter,
      include: ['documents', 'metadatas', 'distances']
    });
  } catch (error) {
    if (error.message?.includes('no results') || error.message?.includes('0 results')) {
      return [];
    }
    throw error;
  }

  if (!results.documents?.[0]?.length) return [];

  return results.documents[0]
    .map((doc, i) => ({
      text: doc,
      metadata: results.metadatas[0][i],
      // ChromaDB cosine distance: 0 = identical, 2 = opposite. Convert to similarity 0→1
      score: Math.max(0, 1 - (results.distances[0][i] / 2)),
      id: results.ids?.[0]?.[i]
    }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function inMemorySimilaritySearch(queryEmbedding, topK, documentIds, minScore) {
  const col = memoryStore.getOrCreate(COLLECTION_NAME());
  if (!col.documents.length) return [];

  return col.documents
    .map((doc, i) => {
      if (documentIds?.length && !documentIds.includes(col.metadatas[i].documentId)) return null;
      return {
        text: doc,
        metadata: col.metadatas[i],
        score: cosineSimilarity(queryEmbedding, col.embeddings[i]),
        id: col.ids[i]
      };
    })
    .filter(r => r && r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ─── Delete ──────────────────────────────────────────────────────────────────
export async function deleteDocumentChunks(documentId) {
  if (useInMemory) {
    const col = memoryStore.getOrCreate(COLLECTION_NAME());
    const keep = col.ids.map((id, i) => !id.startsWith(documentId) ? i : -1).filter(i => i !== -1);
    col.ids = keep.map(i => col.ids[i]);
    col.documents = keep.map(i => col.documents[i]);
    col.embeddings = keep.map(i => col.embeddings[i]);
    col.metadatas = keep.map(i => col.metadatas[i]);
    return;
  }

  const collection = await getOrCreateCollection();
  try {
    const results = await collection.get({ where: { documentId } });
    if (results.ids?.length) {
      await collection.delete({ ids: results.ids });
      logger.info(`Deleted ${results.ids.length} chunks for document ${documentId}`);
    }
  } catch (error) {
    logger.error('Error deleting document chunks:', error.message);
    throw error;
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────
export async function getCollectionStats() {
  if (useInMemory) {
    const col = memoryStore.getOrCreate(COLLECTION_NAME());
    const uniqueDocs = new Set(col.metadatas.map(m => m?.documentId)).size;
    return {
      totalChunks: col.documents.length,
      uniqueDocuments: uniqueDocs,
      embeddingDim: col.dim || getEmbeddingDim(),
      storageType: 'in-memory (no persistence)'
    };
  }

  const collection = await getOrCreateCollection();
  const count = await collection.count();
  return {
    totalChunks: count,
    embeddingDim: getEmbeddingDim(),
    storageType: 'chromadb'
  };
}
