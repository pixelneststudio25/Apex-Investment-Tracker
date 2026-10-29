// The Apex dropdown. Every "choose one" field in the app opens this instead of the phone's own picker, so they all
// look the same: a bottom sheet on phones (drag the handle down to close), a small card under the field on larger screens.
// Arrow keys, Home/End, typing a letter, Enter/Space and Esc all work. Focus returns to the field afterwards.
// Nothing here uses innerHTML or inline styles (the security policy forbids both).
//
//   const chosen = await pickOption({ title: 'How often?', options: [['monthly', 'Every month'], ...], value: 'monthly', trigger: button });
//   chosen is the new value, or null if the person closed it without choosing.
import { h } from './dom.js';
import { icon } from './icons.js';

let uid = 0, current = null;

// Pure helpers (tested without a browser).

/** Where the small card goes on a wide screen: under the field if it fits, otherwise above it. */
export function placePopover({ rect, viewW, viewH, height, gap = 6, margin = 12 }) {
  const below = viewH - rect.bottom - margin, above = rect.top - margin;
  const want = Math.min(height, 22 * 16);
  const openUp = below < Math.min(want, 220) && above > below;
  const room = openUp ? above - gap : below - gap;
  const h2 = Math.max(120, Math.min(want, room));
  const top = openUp ? Math.max(margin, rect.top - gap - h2) : rect.bottom + gap;
  const width = Math.min(Math.max(rect.width, 220), viewW - margin * 2);
  const left = Math.min(Math.max(margin, rect.left), viewW - margin - width);
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width), maxHeight: Math.round(h2), openUp };
}

/** Typing a letter jumps to the next option that starts with what was typed. Returns an index, or -1. */
export function nextMatch(labels, typed, from) {
  const q = String(typed || '').toLowerCase();
  if (!q) return -1;
  const n = labels.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (String(labels[i]).toLowerCase().startsWith(q)) return i;
  }
  return -1;
}

export const isPickerOpen = () => !!current;

export function pickOption({ title = 'Choose one', options = [], value = null, trigger = null } = {}) {
  if (current) current.close(null);
  return new Promise((resolve) => {
    const id = `pk-${++uid}`;
    const previous = trigger || document.activeElement;
    const app = document.getElementById('app');
    // If a dialog is already open underneath, it owns the scroll lock and the inert page; leave both as they were.
    const lockWasOn = document.documentElement.classList.contains('dialog-open'), inertWasOn = !!app?.hasAttribute('inert');
    const labels = options.map((o) => o[1]);
    let done = false, typed = '', typedAt = 0, dragFrom = null, dragY = 0;

    const opts = options.map(([v, l], i) => h('li', { class: 'pick-opt', id: `${id}-o${i}`, role: 'option', tabindex: '-1', 'aria-selected': String(v === value), 'data-i': String(i) },
      h('span', { class: 'pick-opt-text' }, l), v === value && icon('check', { size: 20 })));
    const list = h('ul', { class: 'pick-list', role: 'listbox', 'aria-label': title }, opts);
    const handle = h('div', { class: 'pick-handle' }, h('span', { 'aria-hidden': 'true' }));
    const panel = h('div', { class: 'pick', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      handle, h('p', { class: 'pick-title', 'aria-hidden': 'true' }, title), list);
    const scrim = h('div', { class: 'pick-scrim' }, panel);

    const finish = (answer) => {
      if (done) return;
      done = true; current = null;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      trigger?.setAttribute('aria-expanded', 'false');
      scrim.classList.add('out');
      if (!lockWasOn) document.documentElement.classList.remove('dialog-open');
      if (!inertWasOn) app?.removeAttribute('inert');
      setTimeout(() => scrim.remove(), 200);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      resolve(answer);
    };
    current = { close: finish };

    const focusAt = (i) => {
      const n = opts.length; if (!n) return;
      const k = Math.min(Math.max(i, 0), n - 1);
      opts[k].focus({ preventScroll: true });
      opts[k].scrollIntoView({ block: 'nearest' });
    };
    const at = () => opts.indexOf(document.activeElement);
    const choose = (i) => { if (options[i]) finish(options[i][0]); };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      const i = at();
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i < 0 ? 0 : i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i < 0 ? 0 : i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
      else if (e.key === 'End') { e.preventDefault(); focusAt(opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { if (i >= 0) { e.preventDefault(); choose(i); } }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now(); typed = now - typedAt > 700 ? e.key : typed + e.key; typedAt = now;
        const hit = nextMatch(labels, typed, typed.length > 1 ? Math.max(i - 1, -1) : i);
        if (hit >= 0) { e.preventDefault(); focusAt(hit); }
      }
    };
    document.addEventListener('keydown', onKey, true);

    list.addEventListener('click', (e) => { const li = e.target.closest?.('.pick-opt'); if (li) choose(Number(li.dataset.i)); });
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) finish(null); });

    // Drag the handle (or the title) down to close, like any sheet on a phone.
    const head = [handle, panel.querySelector('.pick-title')];
    head.forEach((el) => {
      el.addEventListener('pointerdown', (e) => { dragFrom = e.clientY; dragY = 0; el.setPointerCapture?.(e.pointerId); });
      el.addEventListener('pointermove', (e) => { if (dragFrom == null) return; dragY = Math.max(0, e.clientY - dragFrom); panel.style.setProperty('--pk-drag', `${dragY}px`); });
      const end = () => { if (dragFrom == null) return; const far = dragY > 90; dragFrom = null; if (far) finish(null); else panel.style.setProperty('--pk-drag', '0px'); };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    });

    const place = () => {
      if (!window.matchMedia('(min-width: 640px)').matches || !trigger) { ['--pk-x', '--pk-y', '--pk-w', '--pk-h'].forEach((p) => panel.style.removeProperty(p)); return; }
      const p = placePopover({ rect: trigger.getBoundingClientRect(), viewW: window.innerWidth, viewH: window.innerHeight, height: panel.scrollHeight + 2 });
      panel.style.setProperty('--pk-x', `${p.left}px`); panel.style.setProperty('--pk-y', `${p.top}px`);
      panel.style.setProperty('--pk-w', `${p.width}px`); panel.style.setProperty('--pk-h', `${p.maxHeight}px`);
      panel.classList.toggle('pick--up', p.openUp);
    };
    const onResize = () => place();
    window.addEventListener('resize', onResize);

    document.body.append(scrim);
    document.documentElement.classList.add('dialog-open');
    app?.setAttribute('inert', '');
    trigger?.setAttribute('aria-expanded', 'true');
    place();
    const sel = options.findIndex((o) => o[0] === value);
    if (opts.length) focusAt(sel >= 0 ? sel : 0); else panel.focus({ preventScroll: true });
  });
}
