# 🤖 RAG AI Chatbot

A full-stack **Retrieval-Augmented Generation (RAG) chatbot** that lets you upload documents and ask questions about them using AI. Upload any PDF, Word, or text file and get accurate, cited answers in 1–3 seconds.

![RAG Architecture](https://img.shields.io/badge/Architecture-RAG-blue)
![Angular](https://img.shields.io/badge/Frontend-Angular%2017-red)
![Node.js](https://img.shields.io/badge/Backend-Node.js-green)
![ChromaDB](https://img.shields.io/badge/VectorDB-ChromaDB-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

- 📄 **Multi-format support** — Upload PDF, DOCX, TXT, MD files
- ⚡ **Fast responses** — 1–3 seconds via Groq or Anthropic API
- 🔀 **Dual LLM provider** — Switch between Groq (free) and Anthropic (Claude) with one line in `.env`
- 📌 **Source citations** — Every answer references the exact document and section
- 💬 **Conversation history** — Remembers context across multiple questions
- 🌊 **Streaming responses** — Real-time token streaming via Server-Sent Events
- 🗄️ **Persistent storage** — ChromaDB keeps embeddings between sessions
- 🔒 **Secure** — Rate limiting, CORS protection, Helmet security headers

---

## 🏗️ Architecture

```
User
 │
 ▼
Angular Frontend (port 4200)
 │  HTTP / SSE
 ▼
Node.js + Express Backend (port 3000)
 │                    │
 ▼                    ▼
ChromaDB            Groq API / Anthropic API
(Vector Store)      (LLM Response)
 │
 ▼
Ollama
(Embeddings — nomic-embed-text)
```

### How It Works

1. **Upload** — User uploads a document (PDF, DOCX, TXT)
2. **Chunk** — Document is split into overlapping chunks (400 chars, 40 overlap)
3. **Embed** — Each chunk is converted to a 768-dim vector via `nomic-embed-text`
4. **Store** — Vectors stored in ChromaDB with metadata
5. **Query** — User asks a question → question is embedded → cosine similarity search finds top 5 relevant chunks
6. **Answer** — LLM reads the chunks and generates a cited answer

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Angular 17 |
| Backend | Node.js + Express |
| Vector Database | ChromaDB |
| Embeddings | Ollama (`nomic-embed-text`, 768-dim) |
| LLM (Primary) | Groq — Llama 3.1 8B Instant (FREE) |
| LLM (Secondary) | Anthropic — Claude Haiku |
| Document Parsing | `pdf-parse`, `mammoth` |
| Logging | Winston |
| Security | Helmet, CORS, express-rate-limit |

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Ollama](https://ollama.ai/) (for embeddings)
- [ChromaDB](https://www.trychroma.com/)
- A free [Groq API key](https://console.groq.com) or [Anthropic API key](https://console.anthropic.com)

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/rag-chatbot.git
cd rag-chatbot
```

### 2. Install Ollama & Pull Embedding Model

```bash
# Install Ollama from https://ollama.ai
ollama pull nomic-embed-text
```

### 3. Start ChromaDB

```bash
pip install chromadb
chroma run --host localhost --port 8000
```

### 4. Setup Backend

```bash
cd backend
npm install
```

Copy `.env.example` to `.env` and fill in your API keys:

```env
LLM_PROVIDER=groq                          # or: anthropic

GROQ_API_KEY=gsk_your_key_here             # https://console.groq.com
GROQ_MODEL=llama-3.1-8b-instant

ANTHROPIC_API_KEY=sk-ant-your-key-here     # https://console.anthropic.com
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Start the backend:

```bash
npm run dev
```

### 5. Setup Frontend

```bash
cd frontend
npm install
npm start
```

### 6. Open the App

Visit **http://localhost:4200** in your browser.

---

## ⚙️ Configuration

All configuration is in `backend/.env`. The most important settings:

### Switch LLM Provider (one line change)

```env
LLM_PROVIDER=groq       # FREE — Llama 3.1 via Groq cloud
LLM_PROVIDER=anthropic  # Paid — Claude Haiku via Anthropic
LLM_PROVIDER=ollama     # Local — any model via Ollama
```

### Available Groq Models

```env
GROQ_MODEL=llama-3.1-8b-instant      # fastest ⚡⚡⚡⚡⚡
GROQ_MODEL=llama-3.3-70b-versatile   # best quality ⭐⭐⭐⭐⭐
GROQ_MODEL=mixtral-8x7b-32768        # best for long documents
```

### Available Anthropic Models

```env
ANTHROPIC_MODEL=claude-haiku-4-5-20251001    # fastest, cheapest
ANTHROPIC_MODEL=claude-sonnet-4-5-20251022   # balanced
```

### RAG Settings

```env
TOP_K_RESULTS=5          # number of chunks retrieved per query
MAX_CONTEXT_LENGTH=3000  # max characters sent to LLM
MAX_TOKENS=1024          # max tokens in LLM response
CHUNK_SIZE=400           # document chunk size in characters
CHUNK_OVERLAP=40         # overlap between chunks
```

---

## 📡 API Endpoints

### Health

```
GET  /api/health                  — Server status + provider info
POST /api/health/provider         — Switch LLM provider at runtime
```

### Documents

```
POST   /api/documents/upload      — Upload and process a document
GET    /api/documents             — List all uploaded documents
DELETE /api/documents/:id         — Delete a document
POST   /api/documents/reset-collection  — Reset ChromaDB collection
```

### Chat

```
POST /api/chat                    — Ask a question (non-streaming)
POST /api/chat/stream             — Ask a question (streaming SSE)
GET  /api/chat/suggestions        — Get suggested questions
```

### Example Chat Request

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the main topics in the document?",
    "conversationHistory": []
  }'
```

### Example Response

```json
{
  "answer": "The document covers three main topics: [Source 1]...",
  "sources": [
    {
      "fileName": "document.pdf",
      "relevanceScore": 0.92,
      "textPreview": "..."
    }
  ],
  "meta": {
    "responseTimeMs": 1243,
    "chunksRetrieved": 5,
    "model": "llama-3.1-8b-instant"
  }
}
```

---

## 🌐 Deployment

### Free Hosting Stack

| Service | Platform | Free Tier |
|---------|----------|-----------|
| Frontend | [Vercel](https://vercel.com) | ✅ Free |
| Backend | [Render](https://render.com) | ✅ 750 hrs/month |
| ChromaDB | [Render](https://render.com) | ✅ Docker deploy |

### Environment Variables for Production

```env
NODE_ENV=production
FRONTEND_URL=https://your-app.vercel.app
ALLOWED_ORIGINS=https://your-app.vercel.app
```

---

## 🔧 Troubleshooting

| Problem | Solution |
|---------|----------|
| `ChromaDB 422 error` | Call `POST /api/documents/reset-collection` then re-upload |
| `Ollama not found` | Run `ollama serve` and `ollama pull nomic-embed-text` |
| `Groq API key invalid` | Check key starts with `gsk_` at console.groq.com |
| `Anthropic API key invalid` | Check key starts with `sk-ant` at console.anthropic.com |
| Backend still uses old provider | `LLM_PROVIDER` was a `const` — fixed to read dynamically |
| CORS error in production | Set `FRONTEND_URL` in backend `.env` |

---

## 📁 Project Structure

```
rag-chatbot/
├── frontend/                    # Angular 17 app
│   └── src/
│       ├── app/
│       │   ├── components/      # Chat, Upload, Document list
│       │   └── services/        # API service
│       └── environments/
│
└── backend/                     # Node.js + Express API
    ├── src/
    │   ├── routes/
    │   │   ├── chat.js          # Chat endpoints
    │   │   ├── documents.js     # Document upload/delete
    │   │   └── health.js        # Health + provider status
    │   ├── services/
    │   │   ├── llmService.js    # Groq / Anthropic / Ollama
    │   │   ├── embeddingService.js  # nomic-embed-text
    │   │   ├── vectorDBService.js   # ChromaDB operations
    │   │   ├── documentService.js   # Parse + chunk documents
    │   │   └── documentStore.js     # In-memory document registry
    │   ├── middleware/
    │   │   └── errorHandler.js
    │   └── server.js
    └── .env                     # Configuration
```

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

## 🙏 Acknowledgements

- [Ollama](https://ollama.ai) — local embedding models
- [ChromaDB](https://www.trychroma.com) — vector database
- [Groq](https://groq.com) — ultra-fast free LLM inference
- [Anthropic](https://anthropic.com) — Claude AI models
