// Phase 8 tests: documents. The sealed file must never hold readable content, must open only for its own owner
// and record, and a failed save must leave nothing behind. A fake storage stands in for Supabase.
import { generateDek } from '../js/core/crypto.js';
import { createMemoryBackend } from '../js/core/db.js';
import { createStore } from '../js/core/store.js';
import { createPortfolio } from '../js/models/portfolio.js';
import { findTemplate } from '../js/models/templates.js';
import { applyTemplate, buildPlan, newDraft, savePlan } from '../js/models/wizard.js';
import { InputError } from '../js/models/inputs.js';
import { deletedItems } from '../js/models/manage.js';
import { decryptFile, encryptFile } from '../js/core/doccrypt.js';
import { FilesError, createFiles } from '../js/core/files.js';
import { MAX_BYTES, MAX_PER_INVESTMENT, UPLOAD_STAGES, addDocument, checkFile, documentsForEntry, fileKind, readDocument, renameDocument, safeFilename, setDocumentEntry, sizeText, storagePath, updateDocument } from '../js/models/documents.js';

const TODAY = '2026-04-15', USER = 'u1';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
const rejects = async (p, test) => { try { await p; } catch (e) { ok(test(e), `unexpected error: ${e.code || ''} ${e.message}`); return e; } throw new Error('expected an error'); };

let n = 0;
async function fresh() {
  const dek = await generateDek();
  const store = createStore({ backend: createMemoryBackend(), getDek: () => dek, userId: USER, uuid: () => `r-${++n}` });
  const d = applyTemplate(newDraft(TODAY), findTemplate('land'), TODAY); Object.assign(d, { name: 'Plot', openedOn: '2025-01-01', capital: { amount: '10,000,000', date: '', note: '' } }); d.income = 'none';
  const inv = (await savePlan(store, buildPlan(d, findTemplate('land'), { today: TODAY }))).investmentId;
  const objects = new Map(), calls = [];
  const files = {
    upload: async (p, b) => { calls.push(['upload', p]); if (objects.has(p)) throw new FilesError('SERVER', 'exists'); objects.set(p, new Uint8Array(b)); },
    download: async (p) => { if (!objects.has(p)) throw new FilesError('MISSING', 'The stored file could not be found.'); return objects.get(p); },
    remove: async (p) => { calls.push(['remove', p]); objects.delete(p); },
  };
  return { dek, store, pf: createPortfolio(store), inv, files, objects, calls, getDek: () => dek };
}
const bytesOf = (text) => new TextEncoder().encode(text);
const file = (name, text, extra = {}) => { const bytes = bytesOf(text); return { name, size: bytes.length, type: 'application/pdf', bytes, ...extra }; };
const add = (s, f, extra = {}) => addDocument({ store: s.store, files: s.files, getDek: s.getDek, userId: USER, investmentId: s.inv, file: f, today: TODAY, ...extra });

test('seal: a file round-trips, the sealed bytes add exactly 28 bytes, and each sealing is different', async () => {
  const dek = await generateDek(), plain = crypto.getRandomValues(new Uint8Array(5000));
  const a = await encryptFile(dek, USER, 'd1', plain), b = await encryptFile(dek, USER, 'd1', plain);
  eq(a.length, plain.length + 28, '12-byte IV + 16-byte tag'); ok(a.some((x, i) => x !== b[i]), 'fresh IV every time');
  eq([...await decryptFile(dek, USER, 'd1', a)], [...plain]);
});
test('seal: another account, another record, a flipped byte or a cut-short file all refuse to open', async () => {
  const dek = await generateDek(), sealed = await encryptFile(dek, USER, 'd1', bytesOf('title deed'));
  const bad = (e) => e.code === 'DECRYPT_FAILED';
  await rejects(decryptFile(dek, 'other-user', 'd1', sealed), bad);
  await rejects(decryptFile(dek, USER, 'd2', sealed), bad);
  await rejects(decryptFile(await generateDek(), USER, 'd1', sealed), bad);
  const flipped = new Uint8Array(sealed); flipped[20] ^= 1; await rejects(decryptFile(dek, USER, 'd1', flipped), bad);
  await rejects(decryptFile(dek, USER, 'd1', sealed.slice(0, 20)), bad); await rejects(decryptFile(dek, USER, 'd1', new Uint8Array(3)), bad);
});
test('rules: empty, oversize, unsupported, missing and the 20-document limit are refused in plain words', () => {
  const msg = (f, c) => { try { checkFile(f, c); } catch (e) { ok(e instanceof InputError, 'InputError'); return e.message; } return null; };
  ok(/Choose a file/.test(msg(null)), 'no file'); ok(/empty/.test(msg({ name: 'a.pdf', size: 0 })), 'empty');
  ok(/limit is 10.0 MB/.test(msg({ name: 'a.pdf', size: MAX_BYTES + 1 })), 'over the limit'); eq(msg({ name: 'a.pdf', size: MAX_BYTES }), null, 'exactly the limit is fine');
  ok(/not supported/.test(msg({ name: 'run.exe', size: 5 })), 'exe'); ok(/not supported/.test(msg({ name: 'noextension', size: 5 })), 'no extension');
  eq(msg({ name: 'SCAN.PDF', size: 5 }), null, 'capital letters are fine'); ok(/up to 20 documents/.test(msg({ name: 'a.pdf', size: 5 }, MAX_PER_INVESTMENT)), 'limit');
  eq(msg({ name: 'a.pdf', size: 5 }, MAX_PER_INVESTMENT - 1), null);
});
test('names: folders, control characters and empty names cannot become a saved file name; sizes read plainly', () => {
  eq(safeFilename('C:\\Users\\me\\deed.pdf'), 'deed.pdf'); eq(safeFilename('../../etc/passwd'), 'passwd'); eq(safeFilename('a\u0000b<c>.pdf'), 'abc.pdf');
  eq(safeFilename('   '), 'document'); eq(safeFilename('x'.repeat(300)).length, 200);
  eq([sizeText(500), sizeText(2048), sizeText(1572864)], ['500 bytes', '2 KB', '1.5 MB']);
  eq(storagePath('u1', 'i1', 'd1'), 'u1/i1/d1', 'the first folder is the account, which the bucket rule checks');
});
test('add: the stored object is sealed (no readable text), sits under the account folder, and opens to the same bytes', async () => {
  const s = await fresh(), secret = 'PLOT 14 CERTIFICATE OF OCCUPANCY 123456';
  const doc = await add(s, file('deed.pdf', secret), { label: ' Title deed ' });
  eq(doc.label, 'Title deed'); eq([doc.filename, doc.size, doc.uploadedOn, doc.investmentId], ['deed.pdf', secret.length, TODAY, s.inv]);
  ok(doc.storagePath.startsWith(`${USER}/${s.inv}/`) && doc.storagePath.endsWith(doc.id), 'path = user/investment/document');
  const stored = s.objects.get(doc.storagePath); ok(stored && stored.length === secret.length + 28, 'sealed size');
  ok(!new TextDecoder('latin1').decode(stored).includes('CERTIFICATE'), 'the secret text is not visible in storage');
  const back = await readDocument({ files: s.files, getDek: s.getDek, userId: USER, doc });
  eq(new TextDecoder().decode(back.bytes), secret); eq([back.filename, back.mime], ['deed.pdf', 'application/pdf']);
  eq((await s.pf.metrics(s.inv, TODAY)).bundle.documents.map((d) => d.id), [doc.id], 'the investment lists it');
});
test('add: if saving the record fails the uploaded file is removed again, and if the upload fails no record is made', async () => {
  const s = await fresh(), realCreate = s.store.create;
  await rejects(addDocument({ store: { create: async () => { throw new Error('disk full'); } }, files: s.files, getDek: s.getDek, userId: USER, investmentId: s.inv, file: file('a.pdf', 'x'), today: TODAY }), (e) => e.message === 'disk full');
  eq(s.objects.size, 0, 'nothing left in storage'); eq(s.calls.map((c) => c[0]), ['upload', 'remove']);
  const down = { ...s.files, upload: async () => { throw new FilesError('OFFLINE', 'You are offline.'); } };
  await rejects(addDocument({ store: s.store, files: down, getDek: s.getDek, userId: USER, investmentId: s.inv, file: file('a.pdf', 'x'), today: TODAY }), (e) => e.code === 'OFFLINE');
  eq((await s.store.list('document')).length, 0, 'no record without a file'); ok(realCreate, 'store untouched');
});
test('add: a refused file never reaches storage', async () => {
  const s = await fresh();
  await rejects(add(s, file('virus.exe', 'x')), (e) => e instanceof InputError); await rejects(add(s, { name: 'a.pdf', size: 0, bytes: new Uint8Array(0) }), (e) => e instanceof InputError);
  eq(s.calls.length, 0);
});
test('open: a sealed file moved under another document, or one that is missing, fails clearly instead of showing the wrong file', async () => {
  const s = await fresh(), a = await add(s, file('a.pdf', 'first')), b = await add(s, file('b.pdf', 'second'));
  s.objects.set(b.storagePath, s.objects.get(a.storagePath));
  await rejects(readDocument({ files: s.files, getDek: s.getDek, userId: USER, doc: b }), (e) => e.code === 'DECRYPT_FAILED');
  s.objects.delete(a.storagePath); await rejects(readDocument({ files: s.files, getDek: s.getDek, userId: USER, doc: a }), (e) => e.code === 'MISSING');
});
test('label and delete: renaming changes only the label; a deleted document leaves the list, shows in Recently deleted, and comes back with its file', async () => {
  const s = await fresh(), doc = await add(s, file('a.pdf', 'hello'));
  const saved = await renameDocument(s.store, doc, '  Lease  '); eq([saved.label, saved.filename, saved.storagePath], ['Lease', 'a.pdf', doc.storagePath]);
  await s.store.remove(doc.id);
  eq((await s.pf.metrics(s.inv, TODAY)).bundle.documents.length, 0, 'gone from the investment');
  eq((await deletedItems(s.store)).map((x) => [x.type, x.record.id]), [['document', doc.id]]);
  ok(s.objects.has(doc.storagePath), 'the file is kept so Undo works');
  await s.store.restore(doc.id); const back = await s.store.get(doc.id);
  eq(new TextDecoder().decode((await readDocument({ files: s.files, getDek: s.getDek, userId: USER, doc: back })).bytes), 'hello');
});
test('storage adapter: uploads as unreadable bytes without overwriting, and turns errors into plain codes', async () => {
  const seen = []; let mode = 'ok';
  const supabase = { storage: { from: (b) => ({
    upload: async (p, blob, o) => { seen.push([b, p, blob.type, o.contentType, o.upsert]); if (mode === 'offline') throw new TypeError('Failed to fetch'); return { error: mode === 'deny' ? { message: 'new row violates row-level security policy', status: 403 } : null }; },
    download: async () => (mode === 'gone' ? { data: null, error: { message: 'Object not found', status: 404 } } : { data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
    remove: async (list) => { seen.push(['remove', list]); return { error: mode === 'expired' ? { message: 'invalid JWT', status: 401 } : null }; },
  }) } };
  const f = createFiles({ supabase });
  await f.upload('u/i/d', new Uint8Array([9])); eq(seen[0], ['vault', 'u/i/d', 'application/octet-stream', 'application/octet-stream', false]);
  eq([...await f.download('u/i/d')], [1, 2, 3]); await f.remove('u/i/d'); eq(seen[1], ['remove', ['u/i/d']]);
  mode = 'offline'; await rejects(f.upload('p', new Uint8Array(1)), (e) => e.code === 'OFFLINE');
  mode = 'deny'; await rejects(f.upload('p', new Uint8Array(1)), (e) => e.code === 'SERVER' && !/row-level/.test(e.message));
  mode = 'gone'; await rejects(f.download('p'), (e) => e.code === 'MISSING'); mode = 'expired'; await rejects(f.remove('p'), (e) => e.code === 'AUTH');
});

// ---------- Phase 8b: entry links, upload steps, file kinds ----------
const entryOf = (s, inv = s.inv, extra = {}) => s.store.create('entry', { investmentId: inv, date: '2026-03-12', kind: 'cost', amountKobo: 250000, ...extra });

test('upload steps: the screen is told lock, upload, save in that order, and the list of steps is read, lock, upload, save', async () => {
  const s = await fresh(), seen = [];
  eq(UPLOAD_STAGES.map((x) => x.id), ['read', 'lock', 'upload', 'save']);
  await add(s, file('a.pdf', 'hello'), { onStage: (id) => seen.push(id) });
  eq(seen, ['lock', 'upload', 'save']);
  const failing = await fresh(), got = [];
  failing.files.upload = async () => { throw new FilesError('OFFLINE', 'offline'); };
  await rejects(add(failing, file('a.pdf', 'hello'), { onStage: (id) => got.push(id) }), (e) => e.code === 'OFFLINE');
  eq(got, ['lock', 'upload'], 'a failed upload never reaches the save step');
});
test('entry link: a document can be tied to a ledger entry of the same investment, and listed under it', async () => {
  const s = await fresh(), e1 = await entryOf(s), e2 = await entryOf(s, s.inv, { kind: 'income' });
  const d1 = await add(s, file('receipt.pdf', 'r'), { entryId: e1.id }), d2 = await add(s, file('plain.pdf', 'p')), d3 = await add(s, file('agreement.pdf', 'a'), { entryId: e1.id });
  eq(d1.entryId, e1.id); eq(d2.entryId, null, 'no link is stored as null');
  const all = await s.store.list('document');
  eq(documentsForEntry(all, e1.id).map((d) => d.id).sort(), [d1.id, d3.id].sort());
  eq(documentsForEntry(all, e2.id), []);
});
test('entry link: an entry from another investment, a missing entry or a deleted entry is refused before anything is uploaded', async () => {
  const s = await fresh(), foreign = await entryOf(s, 'some-other-investment'), gone = await entryOf(s);
  await s.store.remove(gone.id);
  for (const id of [foreign.id, 'no-such-entry', gone.id]) await rejects(add(s, file('a.pdf', 'x'), { entryId: id }), (e) => e instanceof InputError && /entry/i.test(e.message));
  eq(s.calls.length, 0, 'nothing was uploaded');
  eq((await s.store.list('document')).length, 0, 'no record was made');
  const asDoc = await add(s, file('b.pdf', 'x'));
  await rejects(add(s, file('c.pdf', 'x'), { entryId: asDoc.id }), (e) => e instanceof InputError, 'a document is not an entry');
});
test('entry link: change or clear it later; label and link save together; a link to a deleted entry does not block a label edit', async () => {
  const s = await fresh(), e1 = await entryOf(s), e2 = await entryOf(s, s.inv, { kind: 'income' });
  const d = await add(s, file('r.pdf', 'r'), { label: 'Old', entryId: e1.id });
  const moved = await updateDocument(s.store, d, { label: ' New label ', entryId: e2.id });
  eq([moved.label, moved.entryId], ['New label', e2.id]);
  const versionAfterMove = (await s.store.get(d.id)).version;
  const cleared = await setDocumentEntry(s.store, moved, '');
  eq(cleared.entryId, null);
  await rejects(setDocumentEntry(s.store, cleared, 'no-such-entry'), (e) => e instanceof InputError);
  eq((await s.store.get(d.id)).entryId, null, 'a refused link changes nothing');
  ok((await s.store.get(d.id)).version > versionAfterMove, 'clearing saved a new version');
  const linked = await setDocumentEntry(s.store, cleared, e1.id);
  await s.store.remove(e1.id);
  const relabelled = await updateDocument(s.store, linked, { label: 'Still editable' });
  eq([relabelled.label, relabelled.entryId], ['Still editable', e1.id], 'the old link is kept as it was');
  await s.store.restore(e1.id);
  eq(documentsForEntry(await s.store.list('document'), e1.id).length, 1, 'restoring the entry brings the link back into view');
});
test('entry link: records saved before this step (no entry field) still open and read as not linked', async () => {
  const s = await fresh();
  const old = await s.store.create('document', { investmentId: s.inv, filename: 'old.pdf', mime: 'application/pdf', size: 3, storagePath: 'u1/x/old', uploadedOn: TODAY, label: '' });
  eq((await s.store.get(old.id)).entryId, null);
  const re = await renameDocument(s.store, old, 'Renamed');
  eq([re.label, re.entryId], ['Renamed', null]);
});
test('file kind: a plain name for the card badge', () => {
  eq(['a.pdf', 'b.JPG', 'c.heic', 'd.docx', 'e.xlsx', 'f.csv', 'g.txt', 'h.xyz', 'noext'].map(fileKind), ['PDF', 'Photo', 'Photo', 'Word', 'Excel', 'CSV', 'Text', 'File', 'File']);
});

export async function runDocumentTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) { try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); } }
  log(`\n${passed} passed, ${failed} failed (documents).`);
  return { passed, failed };
}
