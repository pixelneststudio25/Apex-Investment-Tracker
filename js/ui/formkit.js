// Small building blocks for forms. Every field has a visible label, an optional hint, and its own error line
// that screen readers announce. No inline styles and no innerHTML (the page's security policy forbids both).
import { h } from './dom.js';
import { parseNaira } from '../models/inputs.js';
import { money } from './fmt.js';

let counter = 0;
const nextId = (p) => `${p}-${++counter}`;

// field(label, makeControl, { hint, optional }) -> { el, control, setError(msg|null) }
export function field(label, makeControl, { hint, optional = false, className = '' } = {}) {
  const id = nextId('f');
  const control = makeControl(id);
  const err = h('p', { class: 'field-error', id: `${id}-err`, role: 'alert' });
  const hintEl = hint && h('p', { class: 'hint', id: `${id}-hint` }, hint);
  const describe = [hintEl && `${id}-hint`, `${id}-err`].filter(Boolean).join(' ');
  if (control.setAttribute && control.tagName !== 'DIV') control.setAttribute('aria-describedby', describe);
  const el = h('div', { class: `field ${className}`.trim() },
    h('label', { for: id }, label, optional && h('span', { class: 'optional' }, ' (optional)')), control, hintEl, err);
  return {
    el, control,
    setError(msg) {
      err.textContent = msg || '';
      if (msg) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid');
      el.classList.toggle('has-error', !!msg);
    },
  };
}

export function textInput({ value = '', onInput, type = 'text', inputmode, placeholder, maxlength, autocomplete = 'off', list } = {}) {
  return (id) => {
    const el = h('input', { class: 'input', id, type, value, inputmode, placeholder, maxlength, autocomplete, autocapitalize: type === 'text' ? 'sentences' : undefined, list });
    if (onInput) el.addEventListener('input', () => onInput(el.value));
    return el;
  };
}
export const dateInput = (o) => textInput({ ...o, type: 'date' });

export function textArea({ value = '', onInput, rows = 3, maxlength } = {}) {
  return (id) => {
    const el = h('textarea', { class: 'input input--area', id, rows, maxlength }, value);
    if (onInput) el.addEventListener('input', () => onInput(el.value));
    return el;
  };
}

export function selectInput({ value, options, onChange } = {}) {
  return (id) => {
    const el = h('select', { class: 'input', id }, options.map(([v, l]) => h('option', { value: v }, l)));
    el.value = value;
    if (onChange) el.addEventListener('change', () => onChange(el.value));
    return el;
  };
}

// A naira box: types digits, shows exactly what Apex understood underneath ("= ₦18,000,000.00") or says what is wrong.
export function moneyField(label, { value = '', onInput, allowZero = false, hint, optional = false } = {}) {
  const preview = h('p', { class: 'preview', 'aria-live': 'polite' });
  const draw = (text) => {
    if (!text.trim()) { preview.textContent = ''; return; }
    try { preview.textContent = `= ${money(parseNaira(text, { allowZero }), { compact: false })}`; preview.classList.remove('preview--bad'); }
    catch (e) { preview.textContent = e.message; preview.classList.add('preview--bad'); }
  };
  const f = field(label, textInput({ value, inputmode: 'decimal', placeholder: '0', autocomplete: 'off', onInput: (v) => { draw(v); onInput?.(v); } }), { hint, optional });
  f.el.append(preview); draw(value);
  return f;
}

export function percentField(label, { value = '', onInput, hint, optional = false } = {}) {
  const f = field(label, textInput({ value, inputmode: 'decimal', placeholder: 'for example 12.5', onInput }), { hint, optional });
  f.control.classList.add('input--suffix');
  return f;
}

// A group of big choices (radio behaviour). options: [[value, title, description?]]
export function choiceList({ name, options, value, onChange, label }) {
  const box = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': label });
  const draw = (current) => [...box.children].forEach((b) => { const on = b.dataset.v === current; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  for (const [v, title, desc] of options) {
    const b = h('button', { class: 'choice', type: 'button', role: 'radio', 'data-v': v, 'aria-checked': 'false', name },
      h('span', { class: 'choice-title' }, title), desc && h('span', { class: 'choice-desc' }, desc));
    b.addEventListener('click', () => { draw(v); onChange(v); });
    box.append(b);
  }
  draw(value);
  return box;
}

// Two or three short options in a row.
export function segmented({ label, options, value, onChange }) {
  const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  options.forEach(([v, l]) => g.append(h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { [...g.children].forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v))); onChange(v); } }, l)));
  return g;
}

export function checkbox({ label, checked, onChange }) {
  const id = nextId('c');
  const el = h('input', { type: 'checkbox', id, checked: checked || undefined });
  el.addEventListener('change', () => onChange(el.checked));
  return h('label', { class: 'check', for: id }, el, h('span', {}, label));
}

// Errors from stepErrors() -> shown on the matching fields; returns the first one that has a field on screen.
export function showErrors(registry, errors) {
  for (const f of Object.values(registry)) f.setError(null);
  let first = null;
  for (const e of errors) { const f = registry[e.field]; if (f) { f.setError(e.message); first ||= f; } }
  return first;
}
