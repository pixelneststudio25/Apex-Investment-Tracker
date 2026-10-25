// The server side of sync: Supabase tables `records` and `record_history`. Only ciphertext goes through here.
// Row Level Security makes every call touch only the signed-in person's rows; `user_id` is sent so inserts pass
// the "own rows only" check. This file is the only place that knows Supabase's request shapes.
import { SyncError } from './sync.js';

const COLS = 'id,payload,schema_version,version,created_at,updated_at,deleted_at';

export function toSyncError(err) {
  const msg = String(err?.message || err || '');
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) return new SyncError('OFFLINE', 'You are offline.');
  if (err?.status === 401 || err?.code === 'PGRST301' || /jwt|not authenticated|invalid token/i.test(msg)) return new SyncError('AUTH', 'Your sign-in expired.');
  const e = new SyncError('SERVER', msg || 'The server refused the request.');
  e.detail = err?.code;
  return e;
}

export function createRemote({ supabase, getUserId }) {
  const must = ({ data, error }) => { if (error) throw toSyncError(error); return data; };
  const call = async (fn) => { try { return await fn(); } catch (e) { throw e instanceof SyncError ? e : toSyncError(e); } };

  return {
    // Rows changed since `since` (inclusive, oldest first). Repeats are harmless; the store ignores what it has.
    pull: ({ since, limit }) => call(async () => must(await supabase.from('records').select(COLS).gte('updated_at', since).order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(limit))),

    insert: (row) => call(async () => {
      const { data, error } = await supabase.from('records').insert({ ...row, user_id: getUserId() }).select(COLS);
      if (error) { if (error.code === '23505') return { ok: false }; throw toSyncError(error); }
      return { ok: !!data?.length };
    }),

    // Changes a row only if it still has the version this device last saw. Returns the row, or null if nothing matched.
    update: (id, expectedVersion, fields) => call(async () => {
      const data = must(await supabase.from('records').update(fields).eq('id', id).eq('version', expectedVersion).select(COLS));
      return data?.[0] || null;
    }),

    get: (id) => call(async () => must(await supabase.from('records').select(COLS).eq('id', id).maybeSingle())),

    // Duplicates are ignored, so sending the same history twice is safe.
    pushHistory: (rows) => call(async () => {
      if (!rows.length) return;
      must(await supabase.from('record_history').upsert(rows.map((r) => ({ ...r, user_id: getUserId() })), { onConflict: 'user_id,record_id,version', ignoreDuplicates: true }));
    }),

    // Every old version the server holds for one record (for the change history on a device that did not make them).
    getHistory: (recordId) => call(async () => must(await supabase.from('record_history').select('record_id,version,payload,saved_at').eq('record_id', recordId).order('version', { ascending: true }))),

    // id and version of every record the server holds (for "verify my backup").
    listVersions: () => call(async () => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const data = must(await supabase.from('records').select('id,version').order('id', { ascending: true }).range(from, from + 999));
        out.push(...data);
        if (data.length < 1000) return out;
      }
    }),
  };
}
