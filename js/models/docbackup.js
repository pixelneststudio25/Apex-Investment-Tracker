// The documents backup (Phase 8b). Your records backup holds the records that point at documents, not the files.
// This is the other half: one `.apexdocs` file holding every document exactly as it is stored on the server, still
// locked with your key. Nothing in it is readable without your password or recovery key.
//
// Layout: the text "APEXDOCS1" and a newline, 4 bytes giving the length of the header, the header (JSON: who it is
// for, when it was made, and each file's path and size), then the locked files one after another in that order.
import { decryptFile } from '../core/doccrypt.js';
import { BackupError } from '../core/backup.js';

export const DOCS_FORMAT = 'apex-documents';
const MAGIC = new TextEncoder().encode('APEXDOCS1\n');
const MAX_HEADER = 5 * 1024 * 1024;

export async function createDocumentsBackup({ store, files, userId, onProgress = () => {}, now = () => new Date().toISOString() }) {
  // Deleted (not yet erased) documents are included, because they can still be restored.
  const docs = (await store.list('document', { includeDeleted: true })).filter((d) => !d.purged);
  const listed = [], parts = [], missing = [];
  let done = 0;
  for (const d of docs) {
    onProgress(done++, docs.length);
    let sealed;
    try { sealed = await files.download(d.storagePath); } catch (e) { if (e.code === 'MISSING') { missing.push(d.storagePath); continue; } throw e; }
    listed.push({ path: d.storagePath, size: sealed.length });
    parts.push(sealed);
  }
  onProgress(docs.length, docs.length);
  const exportedAt = now();
  const header = new TextEncoder().encode(JSON.stringify({ format: DOCS_FORMAT, version: 1, userId, exportedAt, note: 'Locked Apex documents. Only your password or recovery key can open them.', files: listed, missing }));
  const length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, header.length);
  const blob = new Blob([MAGIC, length, header, ...parts], { type: 'application/octet-stream' });
  return { blob, filename: `apex-documents-${exportedAt.slice(0, 10)}.apexdocs`, files: listed.length, missing: missing.length, bytes: blob.size };
}

// bytes: Uint8Array of the whole file. Throws BackupError (with a sentence for the person) if it is not usable.
export function parseDocumentsBackup(bytes, { userId }) {
  const bad = (m) => { throw new BackupError(m); };
  if (!(bytes instanceof Uint8Array) || bytes.length < MAGIC.length + 4) bad('That is not an Apex documents backup.');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) bad('That is not an Apex documents backup.');
  const hlen = new DataView(bytes.buffer, bytes.byteOffset + MAGIC.length, 4).getUint32(0);
  const start = MAGIC.length + 4;
  if (hlen === 0 || hlen > MAX_HEADER || start + hlen > bytes.length) bad('This documents backup is damaged or was cut short.');
  let header;
  try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + hlen))); } catch { bad('This documents backup is damaged or was cut short.'); }
  if (!header || header.format !== DOCS_FORMAT || header.version !== 1 || !Array.isArray(header.files)) bad('That is not an Apex documents backup.');
  if (header.userId !== userId) bad('This documents backup belongs to a different Apex account.');
  let at = start + hlen;
  const items = [];
  for (const f of header.files) {
    const parts = typeof f?.path === 'string' ? f.path.split('/') : [];
    if (!Number.isInteger(f?.size) || f.size < 0 || parts.length !== 3 || parts[0] !== userId || parts.some((x) => !x)) bad('This documents backup is damaged.');
    if (at + f.size > bytes.length) bad('This documents backup is damaged or was cut short.');
    items.push({ path: f.path, docId: parts[2], sealed: bytes.subarray(at, at + f.size) });
    at += f.size;
  }
  if (at !== bytes.length) bad('This documents backup is damaged: it has extra data at the end.');
  return { exportedAt: header.exportedAt || null, items, missing: Array.isArray(header.missing) ? header.missing.length : 0 };
}

// Puts back every file the server does not have. A file that is already there is left alone. A file that does not
// open with your key (damaged, or from another account) is skipped and counted, never uploaded.
export async function restoreDocuments({ bytes, files, getDek, userId, onProgress = () => {} }) {
  const { items, exportedAt } = parseDocumentsBackup(bytes, { userId });
  const result = { restored: 0, alreadyThere: 0, damaged: 0, total: items.length, exportedAt };
  let done = 0;
  for (const it of items) {
    onProgress(done++, items.length);
    try { await decryptFile(getDek(), userId, it.docId, it.sealed); } catch { result.damaged++; continue; }
    try { await files.upload(it.path, it.sealed); result.restored++; } catch (e) { if (e.code === 'EXISTS') result.alreadyThere++; else throw e; }
  }
  onProgress(items.length, items.length);
  return result;
}
