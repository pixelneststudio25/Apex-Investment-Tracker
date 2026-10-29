import { AuthError } from '../core/auth.js';
import { h, svg } from './dom.js';
import { icon } from './icons.js';
import { stagger, withBusy } from './motion.js';

const invalid = (msg) => new AuthError('VALIDATION', msg);

function field({ id, label, type = 'text', autocomplete, hint, value, readonly, inputmode, placeholder, optional = false }) {
  const input = h('input', { id, name: id, type, autocomplete, value, readonly, inputmode, placeholder, class: 'input', required: !optional, spellcheck: 'false', autocapitalize: optional ? 'words' : 'none' });
  let control = input;
  if (type === 'password') {
    const eye = h('button', { class: 'input-reveal', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false' }, icon('eye'));
    eye.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show)); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      eye.replaceChildren(icon(show ? 'eyeOff' : 'eye'));
    });
    control = h('div', { class: 'input-wrap' }, input, eye);
  }
  return { input, node: h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('p', { class: 'hint' }, hint)) };
}
const alertBox = () => h('div', { class: 'alert alert--error', role: 'alert', hidden: true });
function showError(box, err) {
  box.textContent = err instanceof AuthError ? err.message : 'Something went wrong. Please try again.';
  box.hidden = false;
}
// Runs `run` on submit with a spinner on the button and error display. Returns the form.
// The busy label is announced to screen readers; sighted users see the spinner.
function wireForm(form, button, box, busyLabel, run) {
  const status = h('span', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  form.append(status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); box.hidden = true; status.textContent = busyLabel;
    try { await withBusy(button, run); } catch (err) { showError(box, err); } finally { status.textContent = ''; }
  });
  return form;
}

// Line illustration for the welcome screen. Colours come from CSS classes, so it follows the theme.
function welcomeArt() {
  const s = (tag, props, ...kids) => svg(tag, props, ...kids);
  return h('div', { class: 'welcome-art', 'aria-hidden': 'true' },
    s('svg', { viewBox: '0 0 400 320', xmlns: 'http://www.w3.org/2000/svg' },
      s('rect', { class: 'art-card', x: 40, y: 40, width: 320, height: 240, rx: 24 }),
      s('rect', { class: 'art-bar', x: 68, y: 70, width: 90, height: 10, rx: 5 }),
      s('rect', { class: 'art-ink', x: 68, y: 94, width: 150, height: 22, rx: 8 }),
      s('path', { class: 'art-area', d: 'M68 232 L120 202 L160 216 L214 162 L252 180 L312 114 L312 256 L68 256 Z' }),
      s('path', { class: 'art-line', d: 'M68 232 L120 202 L160 216 L214 162 L252 180 L312 114' }),
      s('circle', { class: 'art-dot', cx: 312, cy: 114, r: 9 }),
      s('g', { class: 'art-float' },
        s('circle', { class: 'art-chip', cx: 326, cy: 68, r: 36 }),
        s('circle', { class: 'art-ring', cx: 326, cy: 68, r: 18, 'stroke-dasharray': '64 120', transform: 'rotate(-90 326 68)' }),
        s('circle', { class: 'art-ring art-ring--2', cx: 326, cy: 68, r: 18, 'stroke-dasharray': '30 120', 'stroke-dashoffset': -70, transform: 'rotate(-90 326 68)' })),
      s('g', { class: 'art-float art-float--2' },
        s('rect', { class: 'art-lock', x: 22, y: 232, width: 92, height: 48, rx: 16 }),
        s('path', { class: 'art-lock-ico', d: 'M6 11h12v9H6zM8 11V8a4 4 0 118 0v3', transform: 'translate(46 237) scale(1.1)' }))));
}

export function welcomeView({ onCreate, onSignIn }) {
  const trust = h('ul', { class: 'trust' },
    h('li', {}, icon('shield'), 'Encrypted on this device'),
    h('li', {}, icon('clock'), 'Locks itself when you are away'),
    h('li', {}, icon('key'), 'Your recovery key stays with you'));
  stagger(trust);
  return h('section', { class: 'welcome' },
    h('div', { class: 'welcome-copy' },
      h('h1', { class: 'display' }, 'Every asset, on record.'),
      h('p', { class: 'lead' }, 'A private place for your investment records. Everything is encrypted on your device before it is saved, so only you can read it.'),
      h('div', { class: 'welcome-actions' },
        h('button', { class: 'btn', type: 'button', onclick: onCreate }, 'Create your account'),
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: onSignIn }, 'Sign in')),
      trust),
    welcomeArt());
}

export function signupView({ onSubmit, onBack }) {
  const name = field({ id: 'name', label: 'Your name (optional)', type: 'text', autocomplete: 'name', optional: true, placeholder: 'How should Apex greet you?', hint: 'Used for your greeting. It is stored encrypted with your records.' });
  const email = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email', placeholder: 'you@example.com' });
  const pw = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters. A phrase of several words is easy to remember and hard to guess.' });
  const pw2 = field({ id: 'password2', label: 'Confirm password', type: 'password', autocomplete: 'new-password' });
  const consent = h('input', { id: 'consent', type: 'checkbox', required: true });
  const box = alertBox();
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create account');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Create your account'), h('hr', { class: 'gold-rule' }),
    name.node, email.node, pw.node, pw2.node,
    h('label', { class: 'check' }, consent, h('span', {}, 'I agree to the privacy notice (draft) and understand that my data is encrypted with a key only I hold.')),
    box, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back'));
  return wireForm(form, btn, box, 'Securing your vault…', async () => {
    if (!email.input.checkValidity()) throw invalid('Please enter a valid email address.');
    if (pw.input.value.length < 10) throw invalid('Your password needs at least 10 characters.');
    if (pw.input.value !== pw2.input.value) throw invalid('The two passwords do not match.');
    if (!consent.checked) throw invalid('Please accept the privacy notice to continue.');
    await onSubmit({ email: email.input.value, password: pw.input.value, name: name.input.value.trim().slice(0, 80) });
  });
}

const normGroup = (s) => s.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

export function ceremonyView({ recoveryKey, onDone }) {
  const groups = recoveryKey.split('-');
  const idx = [];
  while (idx.length < 2) { const i = Math.floor(Math.random() * groups.length); if (!idx.includes(i)) idx.push(i); }
  idx.sort((a, b) => a - b);

  const grid = h('ol', { class: 'recovery-grid', 'aria-label': 'Your recovery key' },
    groups.map((g) => h('li', {}, h('code', {}, g))));
  stagger(grid, { max: 12 });
  const a = field({ id: 'g1', label: `Group ${idx[0] + 1}`, autocomplete: 'off' });
  const b = field({ id: 'g2', label: `Group ${idx[1] + 1}`, autocomplete: 'off' });
  const understand = h('input', { id: 'understand', type: 'checkbox' });
  const btn = h('button', { class: 'btn', type: 'submit', disabled: true }, 'I have saved my recovery key');
  const box = alertBox();
  const copied = h('span', { class: 'hint', role: 'status' });
  const copyBtn = h('button', { class: 'btn btn--secondary', type: 'button' }, icon('copy'), 'Copy');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey); copied.textContent = 'Copied. Paste it somewhere safe, then clear your clipboard.';
      copyBtn.replaceChildren(icon('check'), 'Copied'); setTimeout(() => copyBtn.replaceChildren(icon('copy'), 'Copy'), 2200);
    } catch { copied.textContent = 'Copy failed. Please save the file instead.'; }
  });

  const sheet = () => `APEX RECOVERY KEY\n\n${recoveryKey}\n\nCreated: ${new Date().toDateString()}\n\n` +
    'Keep this somewhere safe and private (a locked drawer or safe). Anyone with this key and your account can read your records. ' +
    'If you forget your password and lose this key, your data cannot be recovered by anyone, including Apex.\n';
  const refresh = () => {
    const good = normGroup(a.input.value) === groups[idx[0]] && normGroup(b.input.value) === groups[idx[1]];
    btn.disabled = !(good && understand.checked);
  };
  [a.input, b.input, understand].forEach((el) => el.addEventListener('input', refresh));

  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Your recovery key'), h('hr', { class: 'gold-rule' }),
    h('div', { class: 'alert alert--warn' }, h('strong', {}, 'This is the only way back in if you forget your password. '),
      'It is shown once. Apex cannot recover your data without it, and neither can anyone else.'),
    grid,
    h('div', { class: 'row' }, copyBtn,
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => {
        const url = URL.createObjectURL(new Blob([sheet()], { type: 'text/plain' }));
        const link = h('a', { href: url, download: 'apex-recovery-key.txt' }); document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } }, icon('download'), 'Download')),
    copied,
    h('p', {}, 'To confirm you saved it, type these two groups from your copy:'),
    h('div', { class: 'row row--fields' }, a.node, b.node),
    h('label', { class: 'check' }, understand, h('span', {}, 'I understand that without this key, my data is permanently lost if I forget my password.')),
    box, btn);
  return wireForm(form, btn, box, 'Saving…', async () => { await onDone(); });
}

export function verifyView({ email, onResend, onSignIn }) {
  const note = h('p', { class: 'hint', role: 'status' });
  const resend = h('button', { class: 'btn btn--secondary', type: 'button' }, 'Resend email');
  resend.addEventListener('click', async () => {
    try { await withBusy(resend, onResend); note.textContent = 'Sent. It can take a minute to arrive.'; } catch (e) { note.textContent = e instanceof AuthError ? e.message : 'Could not send. Try again shortly.'; }
    resend.disabled = true; setTimeout(() => { resend.disabled = false; }, 60000);
  });
  return h('section', { class: 'stack' },
    h('div', { class: 'badge-ico' }, icon('mail')),
    h('h1', {}, 'Check your email'), h('hr', { class: 'gold-rule' }),
    h('p', {}, 'We sent a verification link to ', h('strong', {}, email), '. Open it, then come back and sign in with your password.'),
    h('p', { class: 'muted' }, 'Your recovery key is saved and your vault is ready on this device. Verification lets us back up your encrypted data.'),
    h('button', { class: 'btn', type: 'button', onclick: onSignIn }, 'I have verified, sign in'),
    resend, note);
}

export function loginView({ email = '', notice, onSubmit, onResend, onCreate, onForgot }) {
  const e = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email', value: email, placeholder: 'you@example.com' });
  const p = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' });
  const box = alertBox();
  const extra = h('div', {});
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Welcome back'), h('hr', { class: 'gold-rule' }),
    notice && h('p', { class: 'muted' }, notice), e.node, p.node, box, extra, btn,
    onForgot && h('button', { class: 'link-btn', type: 'button', onclick: () => onForgot(e.input.value) }, 'Forgot your password?'),
    onCreate && h('button', { class: 'link-btn', type: 'button', onclick: onCreate }, 'Create an account'));
  return wireForm(form, btn, box, 'Unlocking…', async () => {
    extra.replaceChildren();
    try { await onSubmit({ email: e.input.value, password: p.input.value }); }
    catch (err) {
      if (err instanceof AuthError && err.code === 'EMAIL_NOT_CONFIRMED') {
        extra.append(h('button', { class: 'link-btn', type: 'button', onclick: async () => {
          try { await onResend(e.input.value); extra.textContent = 'Verification email sent.'; } catch (x) { extra.textContent = x instanceof AuthError ? x.message : 'Could not send.'; }
        } }, 'Resend verification email'));
      }
      throw err;
    }
  });
}


export function forgotView({ email = '', onSubmit, onBack }) {
  const e = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email', value: email, placeholder: 'you@example.com' });
  const box = alertBox(); const sent = h('div', { class: 'stack', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Send reset link');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Reset your password'), h('hr', { class: 'gold-rule' }),
    h('div', { class: 'alert alert--warn' }, h('strong', {}, 'You will need your recovery key. '),
      'Your data is encrypted with a key only you hold. If you cannot find the recovery key you saved when you created your account, nobody can restore your records.'),
    e.node, box, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back to sign in'));
  wireForm(form, btn, box, 'Sending…', async () => {
    if (!e.input.checkValidity()) throw invalid('Please enter a valid email address.');
    await onSubmit(e.input.value);
    sent.replaceChildren(h('p', {}, 'If an account exists for ', h('strong', {}, e.input.value.trim()), ', a reset link is on its way. Open it in this browser if you can.'));
    sent.hidden = false; btn.hidden = true;
  });
  return h('section', {}, form, sent);
}

export function recoverView({ email, hasPin, onSubmit }) {
  let mode = 'key';
  const k = field({ id: 'rkey', label: 'Recovery key', autocomplete: 'off', hint: 'Spaces, hyphens and lowercase are fine.' });
  const pn = field({ id: 'rpin', label: 'PIN on this device', type: 'password', autocomplete: 'off', inputmode: 'numeric', hint: 'The 4-digit PIN you use to unlock Apex here.' });
  pn.input.required = false; k.input.required = false;
  const pinBox = h('div', { hidden: true }, pn.node), keyBox = h('div', {}, k.node);
  const p = field({ id: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters.' });
  const p2 = field({ id: 'password2', label: 'Confirm new password', type: 'password', autocomplete: 'new-password' });
  const box = alertBox();
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Unlock and set new password');
  const swap = h('button', { class: 'link-btn', type: 'button', hidden: !hasPin }, 'Use my PIN on this device instead');
  swap.addEventListener('click', () => {
    mode = mode === 'key' ? 'pin' : 'key';
    keyBox.hidden = mode === 'pin'; pinBox.hidden = mode === 'key';
    swap.textContent = mode === 'key' ? 'Use my PIN on this device instead' : 'Use my recovery key instead';
  });
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Choose a new password'), h('hr', { class: 'gold-rule' }),
    h('p', { class: 'muted' }, 'Reset link verified for ', h('strong', {}, email), '. Unlock your data with your recovery key', hasPin ? ' or the PIN on this device' : '', ', then choose a new password.'),
    keyBox, pinBox, swap, p.node, p2.node, box, btn,
    h('details', {}, h('summary', {}, 'I cannot find my recovery key'),
      h('p', { class: 'hint' }, 'Apex never holds a copy of your key, so it cannot be recovered or reset by anyone. Look for the file, printout or password-manager entry you saved at signup. If it is truly lost, the old records cannot be opened.')));
  return wireForm(form, btn, box, 'Unlocking…', async () => {
    if (p.input.value.length < 10) throw invalid('Your password needs at least 10 characters.');
    if (p.input.value !== p2.input.value) throw invalid('The two passwords do not match.');
    if (mode === 'pin') await onSubmit({ mode, pin: pn.input.value, newPassword: p.input.value });
    else await onSubmit({ mode, recoveryKey: k.input.value, newPassword: p.input.value });
  });
}

export function checkKeyView({ onSubmit, onBack }) {
  const k = field({ id: 'rkey', label: 'Recovery key', autocomplete: 'off', hint: 'Paste or type the key you saved. Spaces, hyphens and lowercase are fine.' });
  const box = alertBox(); const good = h('div', { class: 'alert alert--ok', role: 'status', hidden: true });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Check my key');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Check your recovery key'), h('hr', { class: 'gold-rule' }),
    h('p', { class: 'muted' }, 'This confirms your saved key really opens your data, without changing anything.'),
    k.node, box, good, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back'));
  return wireForm(form, btn, box, 'Checking…', async () => {
    good.hidden = true; await onSubmit(k.input.value);
    good.textContent = 'This recovery key is correct. Keep it safe.'; good.hidden = false;
  });
}

export function homeView({ email, onLock, onSignOut, onCheckKey, onRotateKey, onSetPin }) {
  return h('section', { class: 'stack' },
    h('h1', {}, 'Your vault is unlocked'), h('hr', { class: 'gold-rule' }),
    h('p', {}, 'Signed in as ', h('strong', {}, email), '.'),
    h('p', { class: 'muted' }, 'Security is set up. Next we build your dashboard and investments.'),
    h('button', { class: 'btn', type: 'button', onclick: onLock }, 'Lock now'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onCheckKey }, 'Check my recovery key'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onRotateKey }, 'Create a new recovery key'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onSetPin }, 'Set or change PIN'),
    h('button', { class: 'link-btn', type: 'button', onclick: onSignOut }, 'Sign out'));
}
