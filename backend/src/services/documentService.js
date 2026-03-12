import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../utils/logger.js';

/**
 * Parse various document types to plain text
 */
export async function parseDocument(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  logger.info(`Parsing document: ${path.basename(filePath)} (${ext})`);

  try {
    switch (ext) {
      case 'pdf':
        return await parsePDF(filePath);
      case 'docx':
      case 'doc':
        return await parseWord(filePath);
      case 'txt':
      case 'md':
        return await parsePlainText(filePath);
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    logger.error(`Failed to parse document ${filePath}:`, error);
    throw error;
  }
}

async function parsePDF(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    metadata: {
      pages: data.numpages,
      info: data.info || {}
    }
  };
}

async function parseWord(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value,
    metadata: {
      messages: result.messages
    }
  };
}

async function parsePlainText(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return {
    text,
    metadata: {}
  };
}

/**
 * Split text into overlapping chunks for better context retrieval
 */
export function chunkText(text, options = {}) {
  const {
    chunkSize = parseInt(process.env.CHUNK_SIZE) || 500,
    chunkOverlap = parseInt(process.env.CHUNK_OVERLAP) || 50,
  } = options;

  // Clean text
  const cleanedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (cleanedText.length <= chunkSize) {
    return [{ text: cleanedText, index: 0 }];
  }

  const chunks = [];
  const sentences = splitIntoSentences(cleanedText);
  
  let currentChunk = '';
  let chunkIndex = 0;

  for (const sentence of sentences) {
    if ((currentChunk + ' ' + sentence).trim().length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        index: chunkIndex,
        charStart: cleanedText.indexOf(currentChunk.trim())
      });
      
      // Overlap: keep last N chars of current chunk
      const words = currentChunk.trim().split(' ');
      const overlapWords = Math.floor(chunkOverlap / 6); // ~6 chars per word
      currentChunk = words.slice(-overlapWords).join(' ') + ' ' + sentence;
      chunkIndex++;
    } else {
      currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunkIndex,
      charStart: cleanedText.lastIndexOf(currentChunk.trim())
    });
  }

  logger.info(`Split document into ${chunks.length} chunks (size: ${chunkSize}, overlap: ${chunkOverlap})`);
  return chunks;
}

function splitIntoSentences(text) {
  // Split on sentence boundaries while preserving meaningful structure
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n)\s*(?=\n)|(?<=:)\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}
