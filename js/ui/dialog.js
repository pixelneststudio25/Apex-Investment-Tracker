// A confirmation dialog that replaces the browser's plain confirm(). On phones it rises from the bottom as a sheet;
// on larger screens it is a centred card. Esc and a tap outside both mean "no". Focus stays inside while it is open
// and returns to where it was afterwards. Nothing here uses innerHTML or inline styles (the security policy forbids both).
//
//   const yes = await confirmDialog({ title: 'Delete it?', body: 'You can undo right after.', confirmLabel: 'Delete', danger: true });
import { h } from './dom.js';

let uid = 0;

export function confirmDialog({ title, body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const id = `dlg-${++uid}`;
    const previous = document.activeElement;
    const app = document.getElementById('app');
    const cancelBtn = h('button', { class: 'btn btn--secondary', type: 'button' }, cancelLabel);
    const confirmBtn = h('button', { class: `btn${danger ? ' btn--danger-solid' : ''}`, type: 'button' }, confirmLabel);
    const panel = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': `${id}-t`, 'aria-describedby': body ? `${id}-b` : null, tabindex: '-1' },
      h('div', { class: 'dialog-handle', 'aria-hidden': 'true' }),
      h('h2', { id: `${id}-t` }, title),
      body && h('p', { id: `${id}-b` }, body),
      h('div', { class: 'dialog-actions' }, cancelBtn, confirmBtn));
    const scrim = h('div', { class: 'scrim' }, panel);
    let done = false;

    const finish = (answer) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.classList.add('out');
      document.documentElement.classList.remove('dialog-open');
      app?.removeAttribute('inert');
      setTimeout(() => scrim.remove(), 200);
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
      if (e.key !== 'Tab') return;
      // keep Tab and Shift+Tab inside the two buttons
      const order = [cancelBtn, confirmBtn], at = order.indexOf(document.activeElement);
      e.preventDefault();
      order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
    };
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) finish(false); });

    document.addEventListener('keydown', onKey, true);
    document.body.append(scrim);
    document.documentElement.classList.add('dialog-open');
    app?.setAttribute('inert', '');
    // For a destructive question the safe answer has the focus; otherwise the main one does.
    (danger ? cancelBtn : confirmBtn).focus({ preventScroll: true });
  });
}
