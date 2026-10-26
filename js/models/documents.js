// Documents: files attached to an investment (a title deed, a contract, a receipt). The file is encrypted on this
// device and stored in the private "vault" bucket; a small encrypted record (name, size, label, where it is stored)
// goes through the normal store and sync like everything else. The screens live in js/ui/document-views.js.
import { decryptFile, encryptFile } from '../core/doccrypt.js';
import { InputError } from './inputs.js';

export const MAX_BYTES = 10 * 1024 * 1024; // matches the bucket limit in tests/supabase/schema.sql and the record schema
export const MAX_PER_INVESTMENT = 20;
export const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.txt,.doc,.docx,.xls,.xlsx,.csv';
const OK_EXT = new Set(ACCEPTED.split(',').map((e) => e.slice(1)));

// The steps shown while a file is being added, in order. The screen ticks them off as they finish.
export const UPLOAD_STAGES = Object.freeze([
  { id: 'read', label: 'Reading the file' },
  { id: 'lock', label: 'Locking it with your key' },
  { id: 'upload', label: 'Uploading it' },
  { id: 'save', label: 'Saving the record' },
]);

export const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i < 0 ? '' : String(name).slice(i + 1).toLowerCase(); };

// A short, plain name for the kind of file, shown on the file card. Unknown kinds are just "File".
const KINDS = { pdf: 'PDF', png: 'Photo', jpg: 'Photo', jpeg: 'Photo', webp: 'Photo', heic: 'Photo', txt: 'Text', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel', csv: 'CSV' };
export const fileKind = (name) => KINDS[extOf(name)] || 'File';

// A name that is safe to save as: no folders, no control characters, never empty.
export function safeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').trim().slice(0, 200);
  return base || 'document';
}

export function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function checkFile(file, existingCount = 0) {
  if (!file || !file.name) throw new InputError('Choose a file first.');
  if (existingCount >= MAX_PER_INVESTMENT) throw new InputError(`An investment can hold up to ${MAX_PER_INVESTMENT} documents. Delete one to add another.`);
  if (file.size === 0) throw new InputError('That file is empty.');
  if (file.size > MAX_BYTES) throw new InputError(`That file is ${sizeText(file.size)}. The limit is ${sizeText(MAX_BYTES)}.`);
  if (!OK_EXT.has(extOf(file.name))) throw new InputError('This kind of file is not supported. Use a PDF, a photo, a text file, or a Word, Excel or CSV file.');
}

// Where the sealed file lives. The first folder must be the user id: the bucket's access rule checks it.
export const storagePath = (userId, investmentId, docId) => `${userId}/${investmentId}/${docId}`;

// A document may point at one ledger entry of the same investment (a receipt for a cost, a signed rent agreement).
// The entry must exist, must not be deleted, and must belong to this investment. No link is also fine.
async function checkEntryLink(store, investmentId, entryId) {
  if (!entryId) return null;
  const e = await store.get(entryId);
  if (!e || e.type !== 'entry' || e.investmentId !== investmentId) throw new InputError('That ledger entry could not be found on this investment. Choose another, or leave it unlinked.');
  return entryId;
}

// file: { name, size, type, bytes: Uint8Array }. Upload first, then save the record; if saving fails the upload is
// removed again so nothing is left behind. Returns the saved document record. onStage('lock' | 'upload' | 'save')
// tells the screen which step has started (the screen itself announces 'read' before it reads the file).
export async function addDocument({ store, files, getDek, userId, investmentId, file, label = '', entryId = null, today, existingCount = 0, onStage = () => {}, uuid = () => globalThis.crypto.randomUUID() }) {
  checkFile(file, existingCount);
  const linked = await checkEntryLink(store, investmentId, entryId);
  const id = uuid(), path = storagePath(userId, investmentId, id);
  onStage('lock');
  const sealed = await encryptFile(getDek(), userId, id, file.bytes);
  onStage('upload');
  await files.upload(path, sealed);
  try {
    onStage('save');
    return await store.create('document', { investmentId, filename: safeFilename(file.name), mime: String(file.type || '').slice(0, 100), size: file.size, storagePath: path, uploadedOn: today, label: String(label || '').trim().slice(0, 120), entryId: linked }, { id });
  } catch (e) {
    try { await files.remove(path); } catch { /* the stray sealed file is unreadable and harmless; the original error matters more */ }
    throw e;
  }
}

// Change a saved document's label and/or its ledger entry link in one save. An unchanged link is never re-checked,
// so a document whose entry was deleted later can still have its label edited. entryId '' clears the link.
export async function updateDocument(store, doc, { label = doc.label, entryId = doc.entryId ?? null } = {}) {
  const was = doc.entryId ?? null, next = entryId || null;
  const linked = next === was ? was : await checkEntryLink(store, doc.investmentId, next);
  return store.update(doc.id, { label: String(label || '').trim().slice(0, 120), entryId: linked });
}

// Link a saved document to a ledger entry, or clear the link (entryId empty).
export const setDocumentEntry = (store, doc, entryId) => updateDocument(store, doc, { entryId });

// The documents attached to one ledger entry, newest first.
export const documentsForEntry = (documents, entryId) => documents.filter((d) => d.entryId === entryId).sort((a, b) => (a.uploadedOn < b.uploadedOn ? 1 : -1));

// Downloads and opens the file. Fails clearly if it is damaged, belongs to someone else, or is gone.
export async function readDocument({ files, getDek, userId, doc }) {
  const sealed = await files.download(doc.storagePath);
  const bytes = await decryptFile(getDek(), userId, doc.id, sealed);
  return { bytes, filename: doc.filename, mime: doc.mime || 'application/octet-stream' };
}

export const renameDocument = (store, doc, label) => store.update(doc.id, { label: String(label || '').trim().slice(0, 120) });

export const documentTitle = (d) => d.label || d.filename;
