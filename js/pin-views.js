import { h, svg } from './dom.js';
import { icon } from './icons.js';
import { greeting } from './fmt.js';
import { prefersReducedMotion } from './motion.js';

const DEFAULT_TRIES = 5;

// "dan.okafor92@mail.com" -> "DO"; "daniel@mail.com" -> "D"; nothing usable -> "A". Nothing is stored: it is derived from the email.
export function initialsFromEmail(email) {
  const local = String(email || '').split('@')[0];
  const parts = local.split(/[._+-]+/).map((p) => p.replace(/[^\p{L}]/gu, '')).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : parts.length === 1 ? parts[0][0] : 'A';
  return letters.toUpperCase();
}

// The auth layer says "Incorrect PIN. 3 attempts left."; read the number from it, or count down from what we had.
export function attemptsFromMessage(message, previous) {
  const m = /(\d+)\s+attempts?\s+left/i.exec(String(message || ''));
  return m ? Number(m[1]) : Math.max(0, previous - 1);
}

const haptic = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* not supported */ } };

// Padlock inside a soft ring. The shackle is its own path so it can lift when the PIN is right.
function lockEmblem() {
  return h('div', { class: 'pin-emblem', 'aria-hidden': 'true' },
    h('span', { class: 'pin-emblem-ring' }),
    svg('svg', { class: 'pin-lock', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      svg('path', { class: 'pin-shackle', d: 'M8 11V8a4 4 0 018 0v3' }),
      svg('rect', { x: 6, y: 11, width: 12, height: 9.5, rx: 2.4 }),
      svg('path', { d: 'M12 15v2' })));
}

// Pad: round keys, 4 dots, shake and red flash on error, green dots with a check on success.
// `emblem` (optional) opens when success() runs; `extraKey` (optional) fills the empty bottom-left slot.
function pinPad({ subtitle, onEntered, emblem, extraKey }) {
  let value = '', busy = false;
  const dots = [0, 1, 2, 3].map(() => h('span', { class: 'pin-dot' }));
  const dotsRow = h('div', { class: 'pin-dots', 'aria-hidden': 'true' }, dots);
  const msg = h('p', { class: 'pin-msg', role: 'status' }, subtitle || '');
  const delKey = h('button', { class: 'pin-key pin-key--icon pin-key--del is-idle', type: 'button', 'aria-label': 'Delete', onclick: () => back() }, icon('backspace'));
  const render = () => { dots.forEach((d, i) => d.classList.toggle('on', i < value.length)); delKey.classList.toggle('is-idle', !value.length); };

  const setMsg = (text, cls, sr) => {
    msg.className = 'pin-msg' + (cls ? ` pin-msg--${cls}` : '');
    msg.replaceChildren(text, sr ? h('span', { class: 'sr-only' }, ` ${sr}`) : null);
  };

  const api = {
    setMessage(text, isError = false) { setMsg(text, isError ? 'error' : ''); },
    // Spinner beside the message and a wave across the dots while work is happening.
    setBusy(text) { msg.className = 'pin-msg pin-msg--busy'; msg.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), text); dotsRow.classList.add('busy'); },
    clear() { value = ''; dotsRow.classList.remove('busy'); render(); },
    // Wrong PIN: dots flash red and shake, a double buzz, then the dots empty. `sr` is extra text for screen readers only.
    fail(text, sr) {
      value = ''; dotsRow.classList.remove('busy', 'ok'); render(); setMsg(text, 'error', sr);
      dotsRow.classList.remove('shake', 'err'); void dotsRow.offsetWidth; dotsRow.classList.add('shake', 'err');
      haptic([40, 70, 40]);
      setTimeout(() => dotsRow.classList.remove('shake', 'err'), 520);
    },
    // Right PIN: green dots and a check, the lock opens and the bloom spreads. Resolves when the moment is over (at once with reduced motion).
    success(text = 'Unlocked') {
      dotsRow.classList.remove('busy'); dotsRow.classList.add('ok');
      msg.className = 'pin-msg pin-msg--ok'; msg.replaceChildren(h('span', { class: 'pin-check', 'aria-hidden': 'true' }, icon('check')), text);
      haptic([12, 50, 12]);
      emblem?.classList.add('open');
      if (prefersReducedMotion()) return Promise.resolve();
      if (emblem) {
        const r = emblem.getBoundingClientRect();
        const bloom = h('div', { class: 'pin-bloom', 'aria-hidden': 'true', style: { '--bx': `${r.left + r.width / 2}px`, '--by': `${r.top + r.height / 2}px` } });
        document.body.append(bloom); setTimeout(() => bloom.remove(), 1400);
      }
      return new Promise((resolve) => setTimeout(resolve, 560));
    },
  };

  async function press(d) {
    if (busy || value.length >= 4) return;
    haptic(8);
    value += d; render();
    if (value.length < 4) return;
    busy = true; api.setBusy('Unlocking…');
    try { await onEntered(value, api); } catch (e) { api.fail(e?.message || 'Something went wrong.'); } finally { busy = false; dotsRow.classList.remove('busy'); }
  }
  function back() { if (!busy) { value = value.slice(0, -1); render(); } }

  const key = (label, aria) => h('button', { class: 'pin-key', type: 'button', onclick: () => press(label), 'aria-label': aria || label }, label);
  const keys = h('div', { class: 'pin-keys' },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => key(String(n))),
    extraKey || h('span', { class: 'pin-keys-gap', 'aria-hidden': 'true' }), key('0'), delKey);

  const node = h('div', { class: 'pin-pad' }, dotsRow, msg, keys);
  const onKey = (e) => {
    if (!node.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') back();
  };
  window.addEventListener('keydown', onKey);
  return { node, api };
}

export function pinUnlockView({ email, attemptsLeft, maxAttempts = DEFAULT_TRIES, onPin, onUsePassword, onWiped }) {
  let left = Math.min(attemptsLeft ?? maxAttempts, maxAttempts);
  const emblem = lockEmblem();

  // Five pips, shown once a wrong PIN has been tried (also after a reload, because the count is saved on the device).
  const pips = Array.from({ length: maxAttempts }, () => h('span', { class: 'pin-pip' }));
  const pipsRow = h('div', { class: 'pin-pips', role: 'img' }, pips);
  const showPips = (justLost) => {
    pipsRow.hidden = left >= maxAttempts;
    pipsRow.setAttribute('aria-label', `${left} of ${maxAttempts} attempts left`);
    pips.forEach((p, i) => { const lost = i >= left; p.classList.toggle('lost', lost); p.classList.toggle('just-lost', !!justLost && i === left); });
  };
  showPips();

  const useKey = h('button', { class: 'pin-key pin-key--text', type: 'button', onclick: onUsePassword, 'aria-label': 'Use my password instead' }, 'Use password');
  const { node } = pinPad({
    subtitle: 'Enter your PIN', emblem, extraKey: useKey,
    onEntered: async (pin, ui) => {
      try { await onPin(pin, ui); } catch (e) {
        if (e.code === 'PIN_WIPED') { onWiped(e.message); return; }
        if (e.code === 'WRONG_PIN') {
          left = attemptsFromMessage(e.message, left); showPips(true);
          ui.fail('Incorrect PIN', `${left} attempt${left === 1 ? '' : 's'} left.`); return;
        }
        throw e;
      }
    },
  });
  const dotsEl = node.querySelector('.pin-dots'); // the pips sit just under the dots without moving anything
  const dotsWrap = h('div', { class: 'pin-dots-wrap' }); dotsEl.replaceWith(dotsWrap); dotsWrap.append(dotsEl, pipsRow);

  const chip = h('span', { class: 'pin-chip' }, h('span', { class: 'pin-avatar', 'aria-hidden': 'true' }, initialsFromEmail(email)), h('span', { class: 'pin-chip-text' }, email));
  return h('section', { class: 'stack pin-view' }, emblem, h('h1', {}, greeting()), email ? chip : null, node);
}

export function pinSetupView({ onSet, onSkip }) {
  let first = null, title;
  const emblem = lockEmblem();
  const { node } = pinPad({
    subtitle: 'Choose 4 digits to unlock Apex quickly on this device.', emblem,
    onEntered: async (pin, api) => {
      if (!first) { first = pin; api.clear(); api.setMessage('Enter the same PIN again to confirm.'); title.textContent = 'Confirm your PIN'; return; }
      if (pin !== first) { first = null; title.textContent = 'Set a PIN'; throw new Error('Those did not match. Please start again.'); }
      api.setBusy('Securing…'); await onSet(pin, api);
    },
  });
  title = h('h1', {}, 'Set a PIN');
  return h('section', { class: 'stack pin-view pin-view--setup' }, emblem, title, node,
    h('p', { class: 'hint' }, 'Only for this device. After 5 wrong tries the PIN is removed. Your password still works.'),
    h('button', { class: 'link-btn', type: 'button', onclick: onSkip }, 'Skip for now'));
}
