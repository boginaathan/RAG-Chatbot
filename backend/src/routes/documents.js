import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { parseDocument, chunkText } from '../services/documentService.js';
import { storeDocumentChunks, deleteDocumentChunks, getCollectionStats, resetCollection } from '../services/vectorDBService.js';
import { saveDocument, getAllDocuments, getDocument, deleteDocument } from '../services/documentStore.js';
import { logger } from '../utils/logger.js';

export const documentRoutes = express.Router();

const ALLOWED_EXTENSIONS = (process.env.ALLOWED_EXTENSIONS || 'pdf,txt,doc,docx,md').split(',');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 52428800; // 50MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type .${ext} not allowed. Supported: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }
  }
});

// Upload and process document
documentRoutes.post('/upload', upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const documentId = uuidv4();
  const startTime = Date.now();

  try {
    logger.info(`Processing upload: ${req.file.originalname}`);

    // Step 1: Parse document
    const parsed = await parseDocument(req.file.path, req.file.mimetype);

    if (!parsed.text || parsed.text.trim().length < 10) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Document appears to be empty or unreadable' });
    }

    // Step 2: Chunk text
    const chunks = chunkText(parsed.text, {
      chunkSize: parseInt(req.body.chunkSize) || undefined,
      chunkOverlap: parseInt(req.body.chunkOverlap) || undefined
    });

    // Step 3: Store in vector DB (embeddings generated here)
    const documentMetadata = {
      fileName: req.file.originalname,
      fileType: path.extname(req.file.originalname).replace('.', '').toLowerCase(),
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString()
    };

    await storeDocumentChunks(documentId, chunks, documentMetadata);

    // Step 4: Save document metadata
    const document = saveDocument({
      id: documentId,
      fileName: req.file.originalname,
      fileType: documentMetadata.fileType,
      fileSize: req.file.size,
      uploadedAt: documentMetadata.uploadedAt,
      chunkCount: chunks.length,
      charCount: parsed.text.length,
      wordCount: parsed.text.split(/\s+/).length,
      pages: parsed.metadata?.pages,
      processingTimeMs: Date.now() - startTime,
      status: 'ready'
    });

    // Clean up temp file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    logger.info(`✅ Document processed: ${req.file.originalname} → ${chunks.length} chunks in ${Date.now() - startTime}ms`);

    res.status(201).json({
      success: true,
      document,
      processing: {
        chunks: chunks.length,
        characters: parsed.text.length,
        processingTimeMs: document.processingTimeMs
      }
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Document upload failed:', error);
    next(error);
  }
});

// Get all documents
documentRoutes.get('/', async (req, res) => {
  const documents = getAllDocuments();
  const stats = await getCollectionStats();

  res.json({ documents, stats });
});

// Get single document
documentRoutes.get('/:id', (req, res) => {
  const doc = getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
});

// Delete document
documentRoutes.delete('/:id', async (req, res, next) => {
  try {
    const doc = getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await deleteDocumentChunks(req.params.id);
    deleteDocument(req.params.id);

    logger.info(`Deleted document: ${doc.fileName}`);
    res.json({ success: true, message: `Document "${doc.fileName}" deleted` });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/documents/reset-collection
 *
 * USE THIS when you see ChromaDB 422 errors after switching embedding models.
 * It deletes and recreates the ChromaDB collection with the correct dimension.
 * WARNING: This deletes ALL stored document vectors. Re-upload documents after calling this.
 */
documentRoutes.post('/reset-collection', async (req, res, next) => {
  try {
    logger.warn('⚠️  Resetting vector collection — all embeddings will be deleted!');
    await resetCollection();
    logger.info('✅ Collection reset successfully');
    res.json({
      success: true,
      message: 'Vector collection reset. All documents have been removed from the vector store. Please re-upload your documents.'
    });
  } catch (error) {
    next(error);
  }
});
