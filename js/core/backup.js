// Encrypted backup file. It holds the records exactly as they are stored (ciphertext), so the file is safe to keep
// anywhere and is useless without your password or recovery key. Restoring adds back anything this device lacks or
// has an older version of; it never deletes or overwrites newer work. Restored rows are backed up on the next sync.

export const BACKUP_FORMAT = 'apex-backup';
export class BackupError extends Error { constructor(message) { super(message); this.code = 'BACKUP'; } }

const REF = /^[A-Za-z0-9_-]{1,64}$/;
const isInt = (n) => Number.isSafeInteger(n) && n >= 1;
const MAX_BYTES = 60 * 1024 * 1024;

export async function createBackup(store, { userId, now = () => new Date().toISOString() }) {
  const { records, history } = await store.sync.exportRows();
  const pick = ({ id, payload, schemaVersion, version, createdAt, updatedAt, deletedAt }) => ({ id, payload, schemaVersion, version, createdAt, updatedAt, deletedAt: deletedAt ?? null });
  const exportedAt = now();
  const text = JSON.stringify({
    format: BACKUP_FORMAT, version: 1, userId, exportedAt, note: 'Encrypted Apex backup. Only your password or recovery key can open it.',
    records: records.map(pick), history: history.map(({ recordId, version, payload, savedAt }) => ({ recordId, version, payload, savedAt })),
  });
  return { text, filename: `apex-backup-${exportedAt.slice(0, 10)}.json`, records: records.length };
}

export function parseBackup(text, { userId }) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new BackupError('This file is too large to be an Apex backup.');
  let data; try { data = JSON.parse(text); } catch { throw new BackupError('This file is not an Apex backup (it could not be read).'); }
  if (!data || data.format !== BACKUP_FORMAT || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.history)) throw new BackupError('This file is not an Apex backup.');
  if (data.userId !== userId) throw new BackupError('This backup belongs to a different account, so it cannot be restored here.');
  for (const r of data.records) {
    if (!r || !REF.test(r.id || '') || typeof r.payload !== 'string' || !isInt(r.version) || !isInt(r.schemaVersion) || typeof r.createdAt !== 'string' || typeof r.updatedAt !== 'string' || !(r.deletedAt === null || typeof r.deletedAt === 'string')) {
      throw new BackupError('This backup file is damaged (a record is not in the expected form). Nothing was restored.');
    }
  }
  for (const h of data.history) {
    if (!h || !REF.test(h.recordId || '') || typeof h.payload !== 'string' || !isInt(h.version) || typeof h.savedAt !== 'string') throw new BackupError('This backup file is damaged (a history entry is not in the expected form). Nothing was restored.');
  }
  return { records: data.records, history: data.history, exportedAt: data.exportedAt };
}

export async function restoreBackup(store, text, { userId }) {
  const data = parseBackup(text, { userId });
  const res = await store.sync.importRows(data);
  return { ...res, total: data.records.length, exportedAt: data.exportedAt };
}
