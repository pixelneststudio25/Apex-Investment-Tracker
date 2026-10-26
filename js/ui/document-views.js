// Screens for documents: add one to an investment, open it, rename it, delete it. The rules live in
// js/models/documents.js (tested); this file draws forms and runs the browser's file picker and download.
// No inline styles, no innerHTML.
import { h } from './dom.js';
import { icon } from './icons.js';
import { setBusy, withBusy } from './motion.js';
import { fmtDate, todayISO } from './fmt.js';
import { field, showErrors, textInput } from './formkit.js';
import { InputError } from '../models/inputs.js';
import { ACCEPTED, MAX_PER_INVESTMENT, addDocument, documentTitle, readDocument, renameDocument, sizeText } from '../models/documents.js';

const backLink = (href, text) => h('a', { class: 'back', href }, icon('chevronLeft', { size: 18 }), text);
const notFound = (href, text, what) => h('div', { class: 'flow' }, backLink(href, text), h('p', { class: 'alert alert--error', role: 'alert' }, `${what} could not be found. It may have been removed.`));
const errorLine = () => h('p', { class: 'alert alert--error', role: 'alert', hidden: true });
const failText = (e) => (e instanceof InputError || ['OFFLINE', 'AUTH', 'MISSING', 'SERVER', 'DECRYPT_FAILED', 'LOCKED', 'INVALID'].includes(e?.code) ? e.message : 'Something went wrong. Nothing was changed. Please try again.');

function saveBlob(filename, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// The documents list shown inside an investment's Overview tab.
export function documentsSection(inv, documents, { closed = false } = {}) {
  const docs = [...documents].sort((a, b) => (a.uploadedOn < b.uploadedOn ? 1 : -1));
  return h('section', {},
    h('div', { class: 'section-head' }, h('h2', {}, 'Documents'), !closed && docs.length < MAX_PER_INVESTMENT && h('a', { class: 'link-btn', href: `#/investments/${inv.id}/documents/new` }, 'Add')),
    docs.length
      ? h('ul', { class: 'rows' }, docs.map((d) => h('li', {}, h('a', { class: 'row-line', href: `#/investments/${inv.id}/documents/${d.id}` },
        h('span', { class: 'date-col' }, fmtDate(d.uploadedOn)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, documentTitle(d)), h('div', { class: 'row-sub' }, `${d.label ? `${d.filename}, ` : ''}${sizeText(d.size)}`))))))
      : h('p', { class: 'sub' }, closed ? 'No documents were kept for this investment.' : 'No documents yet. Add a contract, receipt or title deed. Each file is locked on your device before it is stored.'));
}

export async function documentView(env, invId, docId) {
  return docId === 'new' ? addScreen(env, invId) : openScreen(env, invId, docId);
}

async function addScreen({ ctx, toast, go }, invId) {
  const { store } = ctx, back = `#/investments/${invId}`;
  const inv = await store.get(invId);
  if (!inv || inv.type !== 'investment') return notFound('#/investments', 'Investments', 'This investment');
  if (!ctx.files) return h('div', { class: 'flow' }, backLink(back, inv.name), h('p', { class: 'alert alert--error', role: 'alert' }, 'Documents are not available right now. Reload the page and try again.'));
  const existing = (await store.list('document')).filter((d) => d.investmentId === invId);
  const f = { label: '', file: null };
  const reg = {}, err = errorLine();
  const picked = h('p', { class: 'hint', role: 'status' });
  const fileField = field('File', (id) => {
    const el = h('input', { class: 'input', id, type: 'file', accept: ACCEPTED });
    el.addEventListener('change', () => { f.file = el.files?.[0] || null; picked.textContent = f.file ? `${f.file.name}, ${sizeText(f.file.size)}` : ''; fileField.setError(null); });
    return el;
  }, { hint: `Up to ${sizeText(10 * 1024 * 1024)}. PDF, photo, text, Word, Excel or CSV.` });
  reg.file = fileField;
  const labelField = field('Label', textInput({ value: '', onInput: (v) => { f.label = v; }, maxlength: 120, placeholder: 'For example: Tenancy agreement 2026' }), { optional: true, hint: 'Shown instead of the file name.' });
  const form = h('form', { class: 'stack', novalidate: true },
    fileField.el, picked, labelField.el,
    h('p', { class: 'note-box' }, 'The file is locked on this device with your key before it is uploaded. Nobody else can read it, including the server.'),
    err, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Lock and upload'), h('a', { class: 'btn btn--secondary', href: back }, 'Cancel')));
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true; err.hidden = true; showErrors(reg, []);
    const btn = form.querySelector('button[type=submit]'); setBusy(btn, true);
    try {
      const file = f.file && { name: f.file.name, size: f.file.size, type: f.file.type, bytes: new Uint8Array(await f.file.arrayBuffer()) };
      const doc = await addDocument({ store, files: ctx.files.api, getDek: ctx.files.getDek, userId: ctx.files.userId(), investmentId: invId, file, label: f.label, today: todayISO(), existingCount: existing.length });
      toast('Document saved.'); go(`${back}/documents/${doc.id}`);
    } catch (x) {
      busy = false; setBusy(btn, false);
      if (x instanceof InputError) { fileField.setError(x.message); return; }
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
  const reg = {}, labelField = field('Label', textInput({ value: doc.label, onInput: (v) => { current = { ...current, label: v }; }, maxlength: 120 }), { optional: true });
  reg.label = labelField;
  const rename = h('form', { class: 'stack', novalidate: true }, labelField.el, h('div', { class: 'row' }, h('button', { class: 'btn btn--secondary btn--small', type: 'submit' }, 'Save label')));
  rename.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(rename.querySelector('button'), async () => {
      try { const saved = await renameDocument(store, doc, current.label); current = saved || { ...doc, label: current.label.trim() }; title.textContent = documentTitle(current); toast('Label saved.'); }
      catch (x) { labelField.setError(failText(x)); }
    });
  });
  const del = h('button', { class: 'btn btn--secondary btn--danger', type: 'button', onclick: async () => {
    await store.remove(docId);
    toast('Document deleted.', { label: 'Undo', run: async () => { await store.restore(docId); window.dispatchEvent(new HashChangeEvent('hashchange')); } }); go(back);
  } }, 'Delete this document');
  return h('div', { class: 'flow' }, backLink(back, 'Back'), title,
    h('dl', { class: 'defs' }, h('dt', {}, 'File name'), h('dd', {}, doc.filename), h('dt', {}, 'Size'), h('dd', {}, sizeText(doc.size)), h('dt', {}, 'Added'), h('dd', {}, fmtDate(doc.uploadedOn))),
    h('div', { class: 'row' }, open), err, rename,
    h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, 'Delete')), h('p', { class: 'sub' }, 'Deleting hides the document. You can undo it straight afterwards, or bring it back from Recently deleted.'), h('div', { class: 'row row--actions' }, del)));
}
