// Screens for documents: add one to an investment (optionally for one ledger entry), open it, relabel or relink
// it, delete it. The rules live in js/models/documents.js (tested); this file draws forms and runs the browser's
// file picker and download. No inline styles, no innerHTML.
import { h } from './dom.js';
import { icon } from './icons.js';
import { setBusy, withBusy } from './motion.js';
import { fmtDate, todayISO } from './fmt.js';
import { field, selectInput, showErrors, textInput } from './formkit.js';
import { InputError } from '../models/inputs.js';
import { ACCEPTED, MAX_BYTES, MAX_PER_INVESTMENT, UPLOAD_STAGES, addDocument, checkFile, documentTitle, documentsForEntry, fileKind, previewKind, previewMime, readDocument, sizeText, textPreview, updateDocument } from '../models/documents.js';
import { createDocumentsBackup, restoreDocuments } from '../models/docbackup.js';

const backLink = (href, text) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const notFound = (href, text, what) => h('div', { class: 'flow' }, backLink(href, text), h('p', { class: 'alert alert--error', role: 'alert' }, `${what} could not be found. It may have been removed.`));
const errorLine = () => h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
const failText = (e) => (e instanceof InputError || ['OFFLINE', 'AUTH', 'MISSING', 'SERVER', 'DECRYPT_FAILED', 'LOCKED', 'INVALID'].includes(e?.code) ? e.message : 'Something went wrong. Nothing was changed. Please try again.');

const ENTRY_NAMES = { capital_in: 'Money put in', cost: 'Cost', income: 'Income received', payout: 'Payout received', proceeds: 'Sale proceeds', repayment: 'Loan repayment' };
// Amounts are left out on purpose: a drop-down cannot honour "Hide amounts".
export const entryLabel = (e) => `${fmtDate(e.date)}, ${ENTRY_NAMES[e.kind] || 'Entry'}`;
const entryChoiceLabel = (e) => { const note = String(e.note || '').trim(); return note ? `${entryLabel(e)}, ${note.length > 28 ? `${note.slice(0, 27)}…` : note}` : entryLabel(e); };
const entryOptions = (entries) => [['', 'Not linked to an entry'], ...[...entries].sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => [e.id, entryChoiceLabel(e)])];

function saveBlob(filename, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const docRows = (inv, docs, entries) => h('ul', { class: 'rows' }, docs.map((d) => {
  const linked = d.entryId && entries?.find((e) => e.id === d.entryId);
  return h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/documents/${d.id}` },
    h('span', { class: 'date-col' }, fmtDate(d.uploadedOn)),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, documentTitle(d)),
      h('div', { class: 'row-sub' }, `${d.label ? `${d.filename}, ` : ''}${sizeText(d.size)}${linked ? `. For ${entryLabel(linked)}` : ''}`))));
}));

// The documents list shown inside an investment's Overview tab.
export function documentsSection(inv, documents, { closed = false, entries = [] } = {}) {
  const docs = [...documents].sort((a, b) => (a.uploadedOn < b.uploadedOn ? 1 : -1));
  return h('section', {},
    h('div', { class: 'section-head' }, h('h2', {}, 'Documents'), !closed && docs.length < MAX_PER_INVESTMENT && h('a', { class: 'link-btn', href: `#/investments/${inv.id}/documents/new` }, 'Add')),
    docs.length ? docRows(inv, docs, entries)
      : h('p', { class: 'sub' }, closed ? 'No documents were kept for this investment.' : 'No documents yet. Add a contract, receipt or title deed. Each file is locked on your device before it is stored.'));
}

// The documents attached to one ledger entry, shown on the entry's edit screen.
export function entryDocuments(inv, entry, documents, { closed = false } = {}) {
  const docs = documentsForEntry(documents, entry.id);
  return h('section', { class: 'doc-entry' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Documents'), !closed && documents.length < MAX_PER_INVESTMENT && h('a', { class: 'link-btn', href: `#/investments/${inv.id}/documents/new/${entry.id}` }, 'Attach')),
    docs.length ? docRows(inv, docs, null) : h('p', { class: 'sub' }, closed ? 'No documents are attached to this entry.' : 'Attach a receipt, an agreement or a screenshot of the payment. It is locked on your device first.'));
}

export async function documentView(env, invId, docId, entryId) {
  return docId === 'new' ? addScreen(env, invId, entryId) : openScreen(env, invId, docId);
}

// A chosen file shown as a card, or an inviting drop area when nothing is chosen.
function dropArea({ id, onPick, onClear }) {
  const input = h('input', { class: 'drop-input', id, type: 'file', accept: ACCEPTED });
  const empty = h('div', { class: 'drop-empty' },
    h('span', { class: 'drop-icon' }, icon('upload', { size: 24 })),
    h('span', { class: 'drop-title' }, 'Choose a file'),
    h('span', { class: 'drop-sub' }, 'Tap to browse, or drop a file here'));
  const badge = h('span', { class: 'drop-badge' }), name = h('div', { class: 'drop-name' }), size = h('div', { class: 'drop-size' });
  const clear = h('button', { class: 'drop-remove', type: 'button', 'aria-label': 'Remove this file' }, icon('x', { size: 18 }));
  const card = h('div', { class: 'drop-file', hidden: true }, badge, h('div', { class: 'drop-meta' }, name, size), clear);
  const el = h('div', { class: 'drop' }, empty, card, input);
  const show = (file) => {
    const has = !!file;
    el.classList.toggle('has-file', has); empty.hidden = has; card.hidden = !has; input.tabIndex = has ? -1 : 0;
    if (has) { badge.textContent = fileKind(file.name); name.textContent = file.name; size.textContent = sizeText(file.size); }
  };
  const reset = () => { input.value = ''; show(null); };
  input.addEventListener('change', () => { const file = input.files?.[0] || null; if (!file) { reset(); onClear?.(); return; } onPick(file); });
  clear.addEventListener('click', () => { reset(); onClear?.(); input.focus(); });
  for (const t of ['dragenter', 'dragover']) el.addEventListener(t, () => el.classList.add('is-over'));
  for (const t of ['dragleave', 'drop']) el.addEventListener(t, () => el.classList.remove('is-over'));
  return { el, input, show, reset, setInvalid: (bad) => { if (bad) { el.dataset.invalid = 'true'; input.setAttribute('aria-invalid', 'true'); } else { delete el.dataset.invalid; input.removeAttribute('aria-invalid'); } } };
}

// The four steps of adding a file, ticked off one by one. Honest: it shows which step is running, not a guessed percentage.
function progressPanel() {
  const items = UPLOAD_STAGES.map((s) => h('li', { 'data-stage': s.id }, h('span', { class: 'doc-dot' }, icon('check', { size: 12 })), s.label));
  const segs = UPLOAD_STAGES.map(() => h('span', {}));
  const el = h('div', { class: 'doc-progress', role: 'status', 'aria-live': 'polite', hidden: true }, h('div', { class: 'progress doc-bar', 'aria-hidden': 'true' }, segs), h('ol', { class: 'doc-stages' }, items));
  const paint = (cur, state) => UPLOAD_STAGES.forEach((_, i) => {
    const done = state === 'done' || i < cur, active = state === 'run' && i === cur, failed = state === 'failed' && i === cur;
    items[i].className = done ? 'is-done' : active ? 'is-active' : failed ? 'is-failed' : '';
    segs[i].className = done ? 'on' : active ? 'on busy' : '';
  });
  let at = 0;
  return {
    el,
    start() { el.hidden = false; at = 0; paint(0, 'run'); },
    stage(id) { at = Math.max(0, UPLOAD_STAGES.findIndex((s) => s.id === id)); paint(at, 'run'); },
    fail() { paint(at, 'failed'); },
    done() { paint(0, 'done'); },
    hide() { el.hidden = true; },
  };
}

async function addScreen({ ctx, toast, go }, invId, entryId) {
  const { store } = ctx, back = `#/investments/${invId}`;
  const inv = await store.get(invId);
  if (!inv || inv.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  if (!ctx.files) return h('div', { class: 'flow' }, backLink(back, inv.name), h('p', { class: 'alert alert--error', role: 'alert' }, 'Documents are not available right now. Reload the page and try again.'));
  const [existing, allEntries] = await Promise.all([store.list('document'), store.list('entry')]);
  const count = existing.filter((d) => d.investmentId === invId).length;
  const entries = allEntries.filter((e) => e.investmentId === invId);
  const f = { label: '', file: null, entryId: entries.some((e) => e.id === entryId) ? entryId : '' };
  const reg = {}, err = errorLine(), progress = progressPanel();

  let drop;
  const fileField = field('File', (id) => {
    drop = dropArea({
    id,
    onPick: (file) => {
      try { checkFile(file, count); } catch (x) { drop.reset(); f.file = null; drop.setInvalid(true); fileField.setError(x.message); return; }
      f.file = file; drop.setInvalid(false); fileField.setError(null); drop.show(file);
    },
    onClear: () => { f.file = null; drop.setInvalid(false); fileField.setError(null); },
    });
    return drop.el;
  }, { hint: `Up to ${sizeText(MAX_BYTES)}. PDF, photo, text, Word, Excel or CSV.` });
  drop.input.setAttribute('aria-describedby', `${drop.input.id}-hint ${drop.input.id}-err`);
  reg.file = fileField;
  const labelField = field('Label', textInput({ value: '', onInput: (v) => { f.label = v; }, maxlength: 120, placeholder: 'For example: Tenancy agreement 2026' }), { optional: true, hint: 'Shown instead of the file name.' });
  const entryField = entries.length ? field('Ledger entry', selectInput({ value: f.entryId, options: entryOptions(entries), onChange: (v) => { f.entryId = v; } }), { optional: true, hint: 'Link the file to one entry, such as a receipt for a cost.' }) : null;
  reg.entryId = entryField;

  const submit = h('button', { class: 'btn', type: 'submit' }, 'Lock and upload');
  const cancel = h('a', { class: 'btn btn--secondary', href: entryId && f.entryId ? `${back}/entry/${entryId}` : back }, 'Cancel');
  const fields = h('fieldset', { class: 'doc-fields' }, fileField.el, labelField.el, entryField?.el, h('p', { class: 'note-box' }, 'The file is locked on this device with your key before it is uploaded. Nobody else can read it, including the server.'));
  const form = h('form', { class: 'stack doc-form', novalidate: true }, fields, progress.el, err, h('div', { class: 'doc-actions' }, submit, cancel));

  let busy = false;
  const lock = (on) => { busy = on; fields.disabled = on; cancel.setAttribute('aria-disabled', String(on)); cancel.tabIndex = on ? -1 : 0; setBusy(submit, on); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    err.hidden = true; showErrors(reg, []); drop.setInvalid(false);
    if (!f.file) { drop.setInvalid(true); fileField.setError('Choose a file first.'); return; }
    lock(true); progress.start();
    try {
      progress.stage('read');
      const file = { name: f.file.name, size: f.file.size, type: f.file.type, bytes: new Uint8Array(await f.file.arrayBuffer()) };
      const doc = await addDocument({ store, files: ctx.files.api, getDek: ctx.files.getDek, userId: ctx.files.userId(), investmentId: invId, file, label: f.label, entryId: f.entryId, today: todayISO(), existingCount: count, onStage: progress.stage });
      progress.done(); toast('Document saved.');
      go(f.entryId && entryId === f.entryId ? `${back}/entry/${entryId}` : `${back}/documents/${doc.id}`);
    } catch (x) {
      lock(false); progress.fail();
      if (x instanceof InputError) { (/entry/i.test(x.message) && entryField ? entryField : fileField).setError(x.message); if (!/entry/i.test(x.message)) drop.setInvalid(true); progress.hide(); return; }
      err.textContent = failText(x); err.hidden = false; err.scrollIntoView?.({ block: 'nearest' });
      if (err.textContent.startsWith('Something went wrong')) console.error(x);
    }
  });
  return h('div', { class: 'flow' }, backLink(back, inv.name), h('h1', { class: 'page-title' }, 'Add a document'), form);
}

async function openScreen({ ctx, toast, go }, invId, docId) {
  const { store } = ctx, back = `#/investments/${invId}`;
  const doc = await store.get(docId);
  if (!doc || doc.type !== 'document' || doc.investmentId !== invId) return notFound(back, 'Back', 'This document');
  const entries = (await store.list('entry')).filter((e) => e.investmentId === invId);
  const err = errorLine();
  let current = doc;
  const title = h('h1', { class: 'page-title' }, documentTitle(doc));
  const open = h('button', { class: 'btn', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => {
    err.hidden = true;
    try {
      const f = await readDocument({ files: ctx.files.api, getDek: ctx.files.getDek, userId: ctx.files.userId(), doc: current });
      saveBlob(f.filename, f.bytes, f.mime); toast('File saved to your device.');
    } catch (x) { err.textContent = failText(x); err.hidden = false; if (err.textContent.startsWith('Something went wrong')) console.error(x); }
  }) }, icon('download'), 'Download');

  // Preview: photos and text show inside the page, a PDF opens in a new tab, everything else is download-only.
  const kind = previewKind(doc), stage = h('div', { class: 'doc-preview', hidden: true });
  let shown = null, showing = false;
  const load = () => readDocument({ files: ctx.files.api, getDek: ctx.files.getDek, userId: ctx.files.userId(), doc: current });
  const clearPreview = () => { if (shown) { URL.revokeObjectURL(shown); shown = null; } stage.replaceChildren(); stage.hidden = true; showing = false; };
  window.addEventListener('hashchange', clearPreview, { once: true });
  const fail = (x) => { err.textContent = failText(x); err.hidden = false; if (err.textContent.startsWith('Something went wrong')) console.error(x); };
  const previewLabel = h('span', {}, kind === 'pdf' ? 'Open in a new tab' : 'Preview');
  const previewBtn = kind && h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => {
    const btn = e.currentTarget; err.hidden = true;
    if (kind === 'pdf') {
      const win = window.open('', '_blank'); // opened now, while the tap still counts; filled in once the file is ready
      if (win) { try { win.opener = null; } catch { /* some browsers refuse; harmless */ } }
      return withBusy(btn, async () => {
        try {
          const f = await load(), u = URL.createObjectURL(new Blob([f.bytes], { type: 'application/pdf' }));
          setTimeout(() => URL.revokeObjectURL(u), 10 * 60 * 1000);
          if (win && !win.closed) win.location.href = u;
          else { stage.replaceChildren(h('a', { class: 'btn', href: u, target: '_blank', rel: 'noopener' }, icon('eye'), 'Tap to open the PDF')); stage.hidden = false; }
        } catch (x) { win?.close(); fail(x); }
      });
    }
    if (showing) { clearPreview(); previewLabel.textContent = 'Preview'; return undefined; }
    return withBusy(btn, async () => {
      try {
        const f = await load();
        if (kind === 'image') { shown = URL.createObjectURL(new Blob([f.bytes], { type: previewMime(current) })); stage.replaceChildren(h('img', { class: 'doc-preview-img', src: shown, alt: documentTitle(current) })); }
        else { const t = textPreview(f.bytes); stage.replaceChildren(h('pre', { class: 'doc-preview-text', tabindex: '0' }, t.text), t.truncated && h('p', { class: 'hint' }, 'Showing the start of the file. Download it to read the rest.')); }
        stage.hidden = false; showing = true; previewLabel.textContent = 'Hide preview';
      } catch (x) { fail(x); }
    });
  } }, icon('eye'), previewLabel);

  const linkedNow = (d) => (d.entryId ? entries.find((e) => e.id === d.entryId) : null);
  const entryCell = h('dd', {});
  const paintEntry = () => {
    const e = linkedNow(current);
    entryCell.replaceChildren(e ? h('a', { href: `${back}/entry/${e.id}` }, entryLabel(e)) : current.entryId ? 'The linked entry was deleted' : 'Not linked');
  };
  paintEntry();

  const form = { label: doc.label, entryId: doc.entryId && entries.some((e) => e.id === doc.entryId) ? doc.entryId : '' };
  const reg = {};
  const labelField = field('Label', textInput({ value: doc.label, onInput: (v) => { form.label = v; }, maxlength: 120 }), { optional: true });
  const options = entryOptions(entries);
  if (doc.entryId && !entries.some((e) => e.id === doc.entryId)) options.splice(1, 0, [doc.entryId, 'The linked entry was deleted']);
  const entryField = field('Ledger entry', selectInput({ value: doc.entryId || '', options, onChange: (v) => { form.entryId = v; } }), { optional: true });
  reg.label = labelField; reg.entryId = entryField;
  form.entryId = doc.entryId || '';
  const edit = h('form', { class: 'stack', novalidate: true }, labelField.el, entries.length > 0 || doc.entryId ? entryField.el : null, h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary btn--small', type: 'submit' }, 'Save changes')));
  edit.addEventListener('submit', async (e) => {
    e.preventDefault(); showErrors(reg, []);
    await withBusy(edit.querySelector('button'), async () => {
      try {
        const saved = await updateDocument(store, current, { label: form.label, entryId: form.entryId });
        current = saved || { ...current, label: form.label.trim(), entryId: form.entryId || null };
        title.textContent = documentTitle(current); paintEntry(); toast('Saved.');
      } catch (x) { (/entry/i.test(x.message) ? entryField : labelField).setError(failText(x)); }
    });
  });
  const del = h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: async () => {
    await store.remove(docId);
    toast('Document deleted.', { label: 'Undo', run: async () => { await store.restore(docId); window.dispatchEvent(new HashChangeEvent('hashchange')); } }); go(back);
  } }, 'Delete this document');
  return h('div', { class: 'flow' }, backLink(back, 'Back'), title,
    h('dl', { class: 'defs' }, h('dt', {}, 'File name'), h('dd', {}, doc.filename), h('dt', {}, 'Size'), h('dd', {}, sizeText(doc.size)), h('dt', {}, 'Added'), h('dd', {}, fmtDate(doc.uploadedOn)), h('dt', {}, 'Ledger entry'), entryCell),
    h('div', { class: 'row' }, open, previewBtn), err, stage, edit,
    h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, 'Delete')), h('p', { class: 'sub' }, 'Deleting hides the document. You can undo it straight afterwards, or bring it back from Recently deleted.'), h('div', { class: 'row row--actions' }, del)));
}

// Settings: one locked file holding every document, and a way to put the files back. Needs a connection.
export function documentsBackupPanel({ ctx, toast }) {
  if (!ctx.files) return null;
  const result = h('p', { class: 'sync-result', role: 'status', 'aria-live': 'polite', hidden: true });
  const say = (text, tone = 'ok') => { result.hidden = !text; result.textContent = text || ''; result.dataset.tone = tone; };
  const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
  const hint = (e) => (e?.code === 'BACKUP' || ['OFFLINE', 'AUTH', 'SERVER', 'MISSING'].includes(e?.code) ? e.message : 'Something went wrong. Nothing was changed. Please try again.');
  const download = h('button', { class: 'btn btn--secondary', type: 'button', onclick: (e) => withBusy(e.currentTarget, async () => {
    say('');
    try {
      const b = await createDocumentsBackup({ store: ctx.store, files: ctx.files.api, userId: ctx.files.userId(), onProgress: (i, total) => { if (total) say(`Collecting your documents: ${Math.min(i + 1, total)} of ${total}`, 'warn'); } });
      if (!b.files && !b.missing) { say('You have no documents yet, so there is nothing to save.', 'warn'); return; }
      saveBlob(b.filename, b.blob, 'application/octet-stream');
      say(`Saved ${n(b.files, 'document', 'documents')} (${sizeText(b.bytes)}) to ${b.filename}. The files stay locked: only your password or recovery key can open them.${b.missing ? ` ${n(b.missing, 'file was', 'files were')} missing from the server and left out.` : ''}`, b.missing ? 'warn' : 'ok');
      toast('Documents backup saved.');
    } catch (x) { say(hint(x), 'bad'); if (hint(x).startsWith('Something went wrong')) console.error(x); }
  }, { minMs: 0 }) }, icon('download'), 'Download documents backup');
  const file = h('input', { type: 'file', accept: '.apexdocs', class: 'visually-hidden', id: 'restore-docs', tabindex: '-1' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0]; file.value = '';
    if (!f) return;
    say('Reading the file…', 'warn');
    try {
      const r = await restoreDocuments({ bytes: new Uint8Array(await f.arrayBuffer()), files: ctx.files.api, getDek: ctx.files.getDek, userId: ctx.files.userId(), onProgress: (i, total) => { if (total) say(`Checking and uploading: ${Math.min(i + 1, total)} of ${total}`, 'warn'); } });
      const parts = [r.restored ? `Put back ${n(r.restored, 'document', 'documents')}.` : 'Nothing needed putting back.', r.alreadyThere ? `${n(r.alreadyThere, 'was', 'were')} already stored.` : '', r.damaged ? `${n(r.damaged, 'file', 'files')} did not open with your key and were skipped.` : ''].filter(Boolean);
      say(parts.join(' '), r.damaged ? 'warn' : 'ok');
    } catch (x) { say(hint(x), 'bad'); if (hint(x).startsWith('Something went wrong')) console.error(x); }
  });
  const restore = h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => file.click() }, 'Restore documents');
  return h('section', { class: 'panel stack' }, h('h2', {}, 'Documents backup'),
    h('p', { class: 'sub' }, 'Your backup file holds the records that point to your documents, not the documents themselves. This file holds the documents, still locked. It can be large, so keep it somewhere safe, and an internet connection is needed.'),
    h('div', { class: 'row' }, download, restore, file), result);
}
