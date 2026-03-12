/**
 * Document metadata store
 * In production, replace with a persistent database (PostgreSQL, MongoDB, etc.)
 */
const documentStore = new Map();

export function saveDocument(doc) {
  documentStore.set(doc.id, doc);
  return doc;
}

export function getDocument(id) {
  return documentStore.get(id) || null;
}

export function getAllDocuments() {
  return Array.from(documentStore.values());
}

export function deleteDocument(id) {
  return documentStore.delete(id);
}

export function documentExists(id) {
  return documentStore.has(id);
}
