import { AuthError } from '../core/auth.js';
import { h } from './dom.js';

const invalid = (msg) => new AuthError('VALIDATION', msg);

function field({ id, label, type = 'text', autocomplete, hint, value, readonly, inputmode }) {
  const input = h('input', { id, name: id, type, autocomplete, value, readonly, inputmode, class: 'input', required: true, spellcheck: 'false', autocapitalize: 'none' });
  return { input, node: h('div', { class: 'field' }, h('label', { for: id }, label), input, hint && h('p', { class: 'hint' }, hint)) };
}
const alertBox = () => h('div', { class: 'alert alert--error', role: 'alert', hidden: true });
function showError(box, err) {
  box.textContent = err instanceof AuthError ? err.message : 'Something went wrong. Please try again.';
  box.hidden = false;
}
// Runs `run` on submit with a busy state and error display. Returns the form.
function wireForm(form, button, box, busyLabel, run) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); box.hidden = true;
    const label = button.textContent; button.disabled = true; button.textContent = busyLabel;
    try { await run(); } catch (err) { showError(box, err); } finally { button.disabled = false; button.textContent = label; }
  });
  return form;
}

export function welcomeView({ onCreate, onSignIn }) {
  return h('section', { class: 'stack' },
    h('h1', {}, 'Every asset, on record.'), h('hr', { class: 'gold-rule' }),
    h('p', { class: 'muted' }, 'A private place for your investment records. Everything is encrypted on your device before it is saved, so only you can read it.'),
    h('button', { class: 'btn', type: 'button', onclick: onCreate }, 'Create your account'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onSignIn }, 'Sign in'));
}

export function signupView({ onSubmit, onBack }) {
  const email = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email' });
  const pw = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 10 characters. A phrase of several words is easy to remember and hard to guess.' });
  const pw2 = field({ id: 'password2', label: 'Confirm password', type: 'password', autocomplete: 'new-password' });
  const consent = h('input', { id: 'consent', type: 'checkbox', required: true });
  const box = alertBox();
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Create account');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Create your account'), h('hr', { class: 'gold-rule' }),
    email.node, pw.node, pw2.node,
    h('label', { class: 'check' }, consent, h('span', {}, 'I agree to the privacy notice (draft) and understand that my data is encrypted with a key only I hold.')),
    box, btn, h('button', { class: 'link-btn', type: 'button', onclick: onBack }, 'Back'));
  return wireForm(form, btn, box, 'Securing your vault…', async () => {
    if (!email.input.checkValidity()) throw invalid('Please enter a valid email address.');
    if (pw.input.value.length < 10) throw invalid('Your password needs at least 10 characters.');
    if (pw.input.value !== pw2.input.value) throw invalid('The two passwords do not match.');
    if (!consent.checked) throw invalid('Please accept the privacy notice to continue.');
    await onSubmit({ email: email.input.value, password: pw.input.value });
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
  const a = field({ id: 'g1', label: `Group ${idx[0] + 1}`, autocomplete: 'off' });
  const b = field({ id: 'g2', label: `Group ${idx[1] + 1}`, autocomplete: 'off' });
  const understand = h('input', { id: 'understand', type: 'checkbox' });
  const btn = h('button', { class: 'btn', type: 'submit', disabled: true }, 'I have saved my recovery key');
  const box = alertBox();
  const copied = h('span', { class: 'hint', role: 'status' });

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
    h('div', { class: 'row' },
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(recoveryKey); copied.textContent = 'Copied. Paste it somewhere safe, then clear your clipboard.'; } catch { copied.textContent = 'Copy failed. Please save the file instead.'; } } }, 'Copy'),
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => {
        const url = URL.createObjectURL(new Blob([sheet()], { type: 'text/plain' }));
        const link = h('a', { href: url, download: 'apex-recovery-key.txt' }); document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } }, 'Download')),
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
    resend.disabled = true;
    try { await onResend(); note.textContent = 'Sent. It can take a minute to arrive.'; } catch (e) { note.textContent = e instanceof AuthError ? e.message : 'Could not send. Try again shortly.'; }
    setTimeout(() => { resend.disabled = false; }, 60000);
  });
  return h('section', { class: 'stack' },
    h('h1', {}, 'Check your email'), h('hr', { class: 'gold-rule' }),
    h('p', {}, 'We sent a verification link to ', h('strong', {}, email), '. Open it, then come back and sign in with your password.'),
    h('p', { class: 'muted' }, 'Your recovery key is saved and your vault is ready on this device. Verification lets us back up your encrypted data.'),
    h('button', { class: 'btn', type: 'button', onclick: onSignIn }, 'I have verified, sign in'),
    resend, note);
}

export function loginView({ email = '', notice, onSubmit, onResend, onCreate }) {
  const e = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'username', inputmode: 'email', value: email });
  const p = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' });
  const box = alertBox();
  const extra = h('div', {});
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true },
    h('h1', {}, 'Welcome back'), h('hr', { class: 'gold-rule' }),
    notice && h('p', { class: 'muted' }, notice), e.node, p.node, box, extra, btn,
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

export function homeView({ email, onLock, onSignOut }) {
  return h('section', { class: 'stack' },
    h('h1', {}, 'Your vault is unlocked'), h('hr', { class: 'gold-rule' }),
    h('p', {}, 'Signed in as ', h('strong', {}, email), '.'),
    h('p', { class: 'muted' }, 'Account setup works. Next we add the PIN lock, then your dashboard.'),
    h('button', { class: 'btn', type: 'button', onclick: onLock }, 'Lock'),
    h('button', { class: 'btn btn--secondary', type: 'button', onclick: onSignOut }, 'Sign out'));
}
