// The command palette: Ctrl+K (⌘K on a Mac) or the search button opens one box that jumps to a page, opens an
// investment by name, or runs a quick action. Arrow keys move, Enter chooses, Esc closes.
// On phones it drops down from the top and the list scrolls above the keyboard.
// Nothing here uses innerHTML or inline styles (the security policy forbids both).
//
//   openPalette({ load: async () => [{ id, group, label, sub, icon, keywords, run }], isAlive: () => true })
import { h } from './dom.js';
import { icon } from './icons.js';

let uid = 0, current = null;

// 0 = no match; higher is a better match. Whole-word and start-of-text matches beat matches in the middle.
export function score(query, text) {
  const q = String(query || '').toLowerCase().trim(), t = String(text || '').toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const at = t.indexOf(q);
  if (at > 0 && /[\s\-(]/.test(t[at - 1])) return 70;
  if (at >= 0) return 50;
  return q.split(/\s+/).every((w) => t.includes(w)) ? 30 : 0;
}

// Picks and orders what to show. With no query: every action and page, then a few investments. With one: best matches first.
export function rank(items, query, { limit = 12, idle = 6 } = {}) {
  const q = String(query || '').trim();
  if (!q) {
    const rest = items.filter((i) => i.group !== 'Investments');
    return [...rest, ...items.filter((i) => i.group === 'Investments').slice(0, idle)];
  }
  return items
    .map((i) => ({ i, s: Math.max(score(q, i.label) * 2, score(q, `${i.keywords || ''} ${i.sub || ''}`)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.i);
}

export const isPaletteOpen = () => !!current;
export function closePalette() { current?.close(); }

export function openPalette({ load, isAlive = () => true, placeholder = 'Search investments, pages and actions' } = {}) {
  if (current) { current.close(); return; } // the shortcut toggles
  const id = `pal-${++uid}`;
  const previous = document.activeElement;
  const app = document.getElementById('app');
  let items = [], shown = [], active = 0, done = false, loaded = false, watch = 0;

  const input = h('input', { class: 'palette-input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list',
    'aria-label': placeholder, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  const list = h('ul', { class: 'palette-list', id: `${id}-list`, role: 'listbox', 'aria-label': 'Results' });
  const status = h('p', { class: 'sr-only', role: 'status' });
  const panel = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search and commands' },
    h('div', { class: 'palette-search' }, icon('search'), input,
      h('button', { class: 'palette-close', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x', { size: 18 }))),
    list, status,
    h('p', { class: 'palette-keys', 'aria-hidden': 'true' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' to move'), h('span', {}, h('kbd', {}, 'Enter'), ' to open'), h('span', {}, h('kbd', {}, 'Esc'), ' to close')));
  const scrim = h('div', { class: 'palette-scrim' }, panel);

  function paint() {
    const q = input.value;
    shown = rank(items, q);
    if (active >= shown.length) active = Math.max(0, shown.length - 1);
    let lastGroup = null;
    const rows = [];
    shown.forEach((it, n) => {
      if (it.group !== lastGroup) { lastGroup = it.group; rows.push(h('li', { class: 'palette-group', role: 'presentation' }, it.group)); }
      rows.push(h('li', { class: 'palette-item', id: `${id}-o${n}`, role: 'option', 'aria-selected': String(n === active), 'data-n': String(n) },
        h('span', { class: 'palette-ico', 'aria-hidden': 'true' }, icon(it.icon || 'arrowRight', { size: 18 })),
        h('span', { class: 'palette-text' }, h('span', { class: 'palette-label' }, it.label), it.sub && h('span', { class: 'palette-sub' }, it.sub)),
        h('span', { class: 'palette-go', 'aria-hidden': 'true' }, icon('arrowRight', { size: 16 }))));
    });
    if (!shown.length) rows.push(h('li', { class: 'palette-none', role: 'presentation' }, loaded ? `Nothing matches “${q.trim()}”. Try a name, a page or a word like “lock”.` : 'Loading…'));
    list.replaceChildren(...rows);
    input.setAttribute('aria-activedescendant', shown.length ? `${id}-o${active}` : '');
    status.textContent = !loaded ? '' : shown.length ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'}` : 'No results';
  }
  function move(to) {
    if (!shown.length) return;
    active = (to + shown.length) % shown.length;
    list.querySelectorAll('[role=option]').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.n) === active)));
    input.setAttribute('aria-activedescendant', `${id}-o${active}`);
    list.querySelector(`#${id}-o${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }
  function choose(n) {
    const it = shown[n];
    if (!it) return;
    close({ restore: false });
    // Let the palette finish closing so a dialog the action opens gets a clean page to sit on.
    setTimeout(() => { try { const r = it.run(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); } }, 0);
  }
  function close({ restore = true } = {}) {
    if (done) return;
    done = true; current = null;
    clearInterval(watch);
    document.removeEventListener('keydown', onKey, true);
    scrim.classList.add('out');
    document.documentElement.classList.remove('dialog-open');
    app?.removeAttribute('inert');
    setTimeout(() => scrim.remove(), 180);
    if (restore && previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); input.focus(); return; } // one place to be: the box
    if (!panel.contains(e.target) || e.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'Home' && !input.value) { e.preventDefault(); move(0); }
    else if (e.key === 'End' && !input.value) { e.preventDefault(); move(shown.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  }

  input.addEventListener('input', () => { active = 0; paint(); });
  list.addEventListener('pointermove', (e) => { const el = e.target.closest?.('[role=option]'); if (el && Number(el.dataset.n) !== active) move(Number(el.dataset.n)); });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the box
  list.addEventListener('click', (e) => { const el = e.target.closest?.('[role=option]'); if (el) choose(Number(el.dataset.n)); });
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });

  current = { close };
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  document.documentElement.classList.add('dialog-open');
  app?.setAttribute('inert', '');
  input.focus({ preventScroll: true });
  paint();
  // If the vault locks or the person signs out while this is open, the workspace is gone: close with it.
  watch = setInterval(() => { if (!isAlive()) close({ restore: false }); }, 400);
  Promise.resolve().then(load).then((list2) => { if (done) return; items = list2 || []; loaded = true; paint(); }).catch((e) => { console.error(e); if (!done) { items = []; loaded = true; paint(); } });
}
