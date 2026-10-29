// Small building blocks for forms. Every field has a visible label, an optional hint, and its own error line
// that screen readers announce. No inline styles and no innerHTML (the page's security policy forbids both).
import { h } from './dom.js';
import { icon } from './icons.js';
import { parseNaira } from '../models/inputs.js';
import { money } from './fmt.js';
import { pickOption } from './picker.js';

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
      // Taking the class off and putting it back restarts the little shake each time the person tries again.
      el.classList.remove('has-error');
      if (msg) { void el.offsetWidth; el.classList.add('has-error'); }
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

// A dropdown. It looks like the other fields and opens the Apex sheet (js/ui/picker.js) instead of the phone's own
// picker, so every choose-one field in the app is the same. The button still has .value, so callers read it as before.
export function selectInput({ value, options, onChange } = {}) {
  return (id) => {
    const text = h('span', { class: 'pick-text' });
    const el = h('button', { class: 'input input--pick', id, type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, text);
    let current = value;
    const draw = () => { text.textContent = options.find((o) => o[0] === current)?.[1] ?? ''; };
    Object.defineProperty(el, 'value', { get: () => current, set: (v) => { current = v; draw(); }, configurable: true });
    draw();
    el.addEventListener('click', async () => {
      const lab = document.querySelector(`label[for="${id}"]`);
      const title = el.getAttribute('aria-label') || (lab ? [...lab.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() : '') || 'Choose one';
      const chosen = await pickOption({ title, options, value: current, trigger: el });
      if (chosen == null || chosen === current) return;
      current = chosen; draw();
      onChange?.(chosen);
    });
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
export function choiceList({ name, options, value, onChange, label, icons = {} }) {
  const box = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': label });
  const draw = (current) => [...box.children].forEach((b) => { const on = b.dataset.v === current; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  for (const [v, title, desc] of options) {
    const b = h('button', { class: `choice${icons[v] ? ' choice--icon' : ''}`, type: 'button', role: 'radio', 'data-v': v, 'aria-checked': 'false', name },
      icons[v] && h('span', { class: 'choice-ico', 'aria-hidden': 'true' }, icon(icons[v], { size: 20 })),
      h('span', { class: 'choice-body' }, h('span', { class: 'choice-title' }, title), desc && h('span', { class: 'choice-desc' }, desc)));
    b.addEventListener('click', () => { draw(v); onChange(v); });
    box.append(b);
  }
  draw(value);
  // Arrow keys move between the options (only the chosen one is in the Tab order); Space or Enter chooses.
  box.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const items = [...box.children], at = items.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const to = items[(at + step + items.length) % items.length];
    to.tabIndex = 0; to.focus();
  });
  return box;
}

// Two or three short options in a row, with a thumb that slides to the chosen one.
export function segmented({ label, options, value, onChange }) {
  const g = h('div', { class: 'seg seg--slide', role: 'group', 'aria-label': label });
  options.forEach(([v, l]) => g.append(h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { [...g.children].forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v))); onChange(v); } }, l)));
  slideThumb(g);
  return g;
}

// Keeps the sliding thumb of a .seg.seg--slide group under its pressed button. Positions go through CSS variables
// (the site's security policy blocks style attributes). Re-measures on resize, so font loading or text size changes are fine.
export function slideThumb(group) {
  const place = () => {
    const on = group.querySelector('[aria-pressed="true"]');
    if (!on || !group.isConnected || !on.offsetWidth) return;
    group.style.setProperty('--thumb-x', `${on.offsetLeft}px`);
    group.style.setProperty('--thumb-w', `${on.offsetWidth}px`);
    group.style.setProperty('--thumb-o', '1');
  };
  try { new MutationObserver(place).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] }); } catch { /* old browser */ }
  try { new ResizeObserver(place).observe(group); } catch { /* old browser */ }
  requestAnimationFrame(place);
  return place;
}

// A slider that snaps to a few named stops (text size is the first user). Native <input type="range"> underneath, so arrow keys,
// Home and End, touch dragging and screen readers all work with no extra code; the name of the stop is what a screen reader hears.
//   stops: [[value, name]]. onPreview(stop) runs while the thumb moves; onChange(stop) runs once the person lets go or presses a key.
// The coloured fill is drawn through the --p custom property (CSSOM only: the site's security policy blocks style attributes).
export function stepSlider({ label, stops, value, onPreview, onChange, hint }) {
  const id = nextId('s');
  const last = stops.length - 1;
  const at = (v) => Math.max(0, stops.findIndex(([x]) => x === v));
  const input = h('input', { class: 'slider-input', id, type: 'range', min: 0, max: last, step: 1, value: at(value) });
  const paint = () => {
    const i = Number(input.value), [v, name] = stops[i];
    input.style.setProperty('--p', String(last ? i / last : 0));
    input.setAttribute('aria-valuetext', name);
    return [v, name];
  };
  input.addEventListener('input', () => onPreview?.(paint()));
  input.addEventListener('change', () => onChange?.(paint()));
  paint();
  const ticks = h('div', { class: 'slider-ticks', 'aria-hidden': 'true' }, stops.map(() => h('span', {})));
  const hintEl = hint && h('p', { class: 'hint', id: `${id}-hint` }, hint);
  if (hintEl) input.setAttribute('aria-describedby', `${id}-hint`);
  const el = h('div', { class: 'field slider' },
    h('label', { for: id }, label),
    h('div', { class: 'slider-row' },
      h('span', { class: 'slider-a slider-a--small', 'aria-hidden': 'true' }, 'A'),
      h('div', { class: 'slider-track' }, input, ticks),
      h('span', { class: 'slider-a slider-a--large', 'aria-hidden': 'true' }, 'A')),
    hintEl);
  return { el, input, current: () => stops[Number(input.value)] };
}

export function checkbox({ label, checked, onChange, asSwitch = false }) {
  const id = nextId('c');
  const el = h('input', { type: 'checkbox', id, checked: checked || undefined });
  el.addEventListener('change', () => onChange(el.checked));
  return h('label', { class: asSwitch ? 'check check--switch' : 'check', for: id }, el, h('span', {}, label));
}

// Errors from stepErrors() -> shown on the matching fields; returns the first one that has a field on screen.
export function showErrors(registry, errors) {
  for (const f of Object.values(registry)) f.setError(null);
  let first = null;
  for (const e of errors) { const f = registry[e.field]; if (f) { f.setError(e.message); first ||= f; } }
  return first;
}
