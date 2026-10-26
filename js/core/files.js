// The storage side of documents: the private Supabase bucket "vault". Only sealed (already encrypted) bytes pass
// through here. Row Level Security on storage.objects limits every call to the signed-in person's own folder, so
// paths always start with their user id. This is the only file that knows Storage's request shapes.
export const BUCKET = 'vault';

export class FilesError extends Error { constructor(code, message) { super(message); this.code = code; } } // OFFLINE | AUTH | SERVER | MISSING

function toFilesError(err) {
  const msg = String(err?.message || err || '');
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg)) return new FilesError('OFFLINE', 'You are offline. Connect to the internet and try again.');
  if (err?.status === 401 || err?.statusCode === '401' || /jwt|not authenticated|invalid token/i.test(msg)) return new FilesError('AUTH', 'Your sign-in expired. Unlock Apex again and retry.');
  if (err?.status === 404 || err?.statusCode === '404' || /not found|object not found/i.test(msg)) return new FilesError('MISSING', 'The stored file could not be found.');
  return new FilesError('SERVER', 'The server refused the request. Nothing was changed.');
}

export function createFiles({ supabase }) {
  const bucket = () => supabase.storage.from(BUCKET);
  const run = async (fn) => { try { return await fn(); } catch (e) { throw e instanceof FilesError ? e : toFilesError(e); } };
  return {
    upload: (path, sealed) => run(async () => {
      const { error } = await bucket().upload(path, new Blob([sealed], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: false });
      if (error) throw toFilesError(error);
    }),
    download: (path) => run(async () => {
      const { data, error } = await bucket().download(path);
      if (error) throw toFilesError(error);
      return new Uint8Array(await data.arrayBuffer());
    }),
    remove: (path) => run(async () => {
      const { error } = await bucket().remove([path]);
      if (error) throw toFilesError(error);
    }),
  };
}
