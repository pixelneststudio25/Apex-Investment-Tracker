// A bottom sheet for a small form (on phones it rises from the bottom; on larger screens it is a centred card). It
// reuses the look of the confirm dialog. The caller builds the content and decides when to close:
//
//   const result = await openSheet({ title: 'Change the rate', build: (close) => [h('p', {}, '...'), h('button', { onclick: () => close('saved') }, 'Save')] });
//
// Esc or a tap outside closes it with `null`. Focus moves in, stays inside, and returns afterwards.
// Nothing here uses innerHTML or inline styles.
import { h } from './dom.js';

let uid = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openSheet({ title, build, label = null }) {
  return new Promise((resolve) => {
    const id = `sheet-${++uid}`, previous = document.activeElement, app = document.getElementById('app');
    let done = false;
    const close = (value = null) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.classList.add('out');
      document.documentElement.classList.remove('dialog-open');
      app?.removeAttribute('inert');
      setTimeout(() => scrim.remove(), 200);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      resolve(value);
    };
    const panel = h('div', { class: 'dialog dialog--sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t`, 'aria-label': label, tabindex: '-1' },
      h('div', { class: 'dialog-handle', 'aria-hidden': 'true' }), h('h2', { id: `${id}-t` }, title), h('div', { class: 'sheet-body' }, build(close)));
    const scrim = h('div', { class: 'scrim' }, panel);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
      if (e.key !== 'Tab') return;
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    document.documentElement.classList.add('dialog-open');
    app?.setAttribute('inert', '');
    (panel.querySelector('input, button') || panel).focus({ preventScroll: true });
  });
}
