import { h } from './dom.js';

// A 4-digit PIN pad with soft dots, shake on error, keyboard support and an optional light haptic tap.
function pinPad({ subtitle, onEntered }) {
  let value = '', busy = false;
  const dots = [0, 1, 2, 3].map(() => h('span', { class: 'pin-dot' }));
  const dotsRow = h('div', { class: 'pin-dots', 'aria-hidden': 'true' }, dots);
  const msg = h('p', { class: 'pin-msg', role: 'status' }, subtitle || '');
  const render = () => dots.forEach((d, i) => d.classList.toggle('on', i < value.length));

  const api = {
    setMessage(text, isError = false) { msg.textContent = text; msg.classList.toggle('pin-msg--error', isError); },
    clear() { value = ''; render(); },
    fail(text) {
      api.clear(); api.setMessage(text, true);
      dotsRow.classList.remove('shake'); void dotsRow.offsetWidth; dotsRow.classList.add('shake');
      setTimeout(() => dotsRow.classList.remove('shake'), 500);
    },
  };

  async function press(d) {
    if (busy || value.length >= 4) return;
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
    value += d; render();
    if (value.length < 4) return;
    busy = true; api.setMessage('Unlocking…');
    try { await onEntered(value, api); } catch (e) { api.fail(e?.message || 'Something went wrong.'); } finally { busy = false; }
  }
  const back = () => { if (!busy) { value = value.slice(0, -1); render(); } };

  const key = (label, onclick, aria) => h('button', { class: 'pin-key', type: 'button', onclick, 'aria-label': aria || label }, label);
  const keys = h('div', { class: 'pin-keys' },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => key(String(n), () => press(String(n)))),
    h('span', {}), key('0', () => press('0')), key('⌫', back, 'Delete'));

  const node = h('div', { class: 'pin-pad' }, dotsRow, msg, keys);
  const onKey = (e) => {
    if (!node.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') back();
  };
  window.addEventListener('keydown', onKey);
  return { node, api };
}

export function pinUnlockView({ email, attemptsLeft, onPin, onUsePassword, onWiped }) {
  const { node } = pinPad({
    subtitle: attemptsLeft < 5 ? `Enter your PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left.` : 'Enter your PIN',
    onEntered: async (pin) => {
      try { await onPin(pin); } catch (e) { if (e.code === 'PIN_WIPED') { onWiped(e.message); return; } throw e; }
    },
  });
  return h('section', { class: 'stack pin-view' },
    h('h1', {}, 'Welcome back'), h('p', { class: 'muted' }, 'Every asset, on record.'), node,
    h('p', { class: 'hint' }, email),
    h('button', { class: 'link-btn', type: 'button', onclick: onUsePassword }, 'Use my password instead'));
}

export function pinSetupView({ onSet, onSkip }) {
  let first = null, title;
  const { node } = pinPad({
    subtitle: 'Choose 4 digits to unlock Apex quickly on this device.',
    onEntered: async (pin, api) => {
      if (!first) { first = pin; api.clear(); api.setMessage('Enter the same PIN again to confirm.'); title.textContent = 'Confirm your PIN'; return; }
      if (pin !== first) { first = null; title.textContent = 'Set a PIN'; throw new Error('Those did not match. Please start again.'); }
      api.setMessage('Securing…'); await onSet(pin);
    },
  });
  title = h('h1', {}, 'Set a PIN');
  return h('section', { class: 'stack pin-view' }, title, node,
    h('p', { class: 'hint' }, 'The PIN only unlocks Apex on this device. Your password and recovery key still protect your account. After 5 wrong tries the PIN is removed from this device.'),
    h('button', { class: 'link-btn', type: 'button', onclick: onSkip }, 'Skip for now'));
}
