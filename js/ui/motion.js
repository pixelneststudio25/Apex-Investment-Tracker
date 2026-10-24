// Motion helpers: busy buttons, count-up numbers, staggered lists, page and theme transitions.
// Styles live in css/motion.css. Everything here respects "reduce motion" and never writes inline style attributes
// (the site's content-security-policy blocks them), only CSS custom properties through the CSSOM.
import { h, svg } from './dom.js';

export const prefersReducedMotion = () => !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- busy buttons ----------
const idle = new WeakMap();

/** Swap a button's label for a spinner without changing its size. setBusy(btn, true) ... setBusy(btn, false). */
export function setBusy(btn, on) {
  if (!btn) return;
  if (on) {
    if (idle.has(btn)) return;
    idle.set(btn, { nodes: [...btn.childNodes], disabled: btn.disabled });
    btn.style.setProperty('min-width', `${btn.offsetWidth}px`);
    btn.replaceChildren(h('span', { class: 'btn-label' }, ...idle.get(btn).nodes), h('span', { class: 'spinner', 'aria-hidden': 'true' }));
    btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
  } else {
    const saved = idle.get(btn); if (!saved) return;
    idle.delete(btn);
    btn.replaceChildren(...saved.nodes);
    btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); btn.disabled = saved.disabled;
    btn.style.removeProperty('min-width');
  }
}

/** Run an async job with the button busy. The spinner stays up for at least minMs so it never just flickers. */
export async function withBusy(btn, job, { minMs = 350 } = {}) {
  const t0 = performance.now();
  setBusy(btn, true);
  try { return await job(); }
  finally {
    const rest = minMs - (performance.now() - t0);
    if (rest > 0) await sleep(rest);
    setBusy(btn, false);
  }
}

// ---------- numbers ----------
/** Count a number up (or down) into an element. format(n) turns the in-between value into text. Returns { cancel }. */
export function animateNumber(el, to, { from = 0, duration = 900, format = (n) => String(Math.round(n)) } = {}) {
  if (!el) return { cancel() {} };
  if (prefersReducedMotion() || from === to || !Number.isFinite(to) || !Number.isFinite(from)) { el.textContent = format(to); return { cancel() {} }; }
  let raf = 0, start = 0;
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const step = (now) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(from + (to - from) * ease(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { cancel() { cancelAnimationFrame(raf); el.textContent = format(to); } };
}

// ---------- entrances ----------
/** Fade and rise the children of a list one after another (first `max` only, so long lists do not drag). */
export function stagger(container, { max = 8 } = {}) {
  if (!container || prefersReducedMotion()) return;
  [...container.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, max))));
  container.classList.add('stagger');
}

/** Play the page entrance on an element, then clean the class up. */
export function enter(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.add('page-enter');
  el.addEventListener('animationend', () => el.classList.remove('page-enter'), { once: true });
}

// ---------- view transitions (page changes, theme switch) ----------
/** Run `update` inside a view transition when the browser supports it, otherwise just run it. */
export async function transition(update, { kind = 'page', origin } = {}) {
  const root = document.documentElement;
  if (prefersReducedMotion() || !document.startViewTransition) { await update(); return; }
  root.setAttribute('data-vt', kind);
  const vt = document.startViewTransition(async () => { await update(); });
  try {
    await vt.ready;
    if (kind === 'theme' && origin) { // circular reveal growing from the toggle
      const r = origin.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' });
    }
  } catch { /* transition skipped: the update still ran */ }
  try { await vt.finished; } catch { /* ignore */ }
  root.removeAttribute('data-vt');
}

// ---------- theme ----------
export const currentTheme = () => {
  const a = document.documentElement.getAttribute('data-theme');
  if (a === 'light' || a === 'dark') return a;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** mode: 'light' | 'dark' | 'system'. origin: the button the reveal grows from (optional). */
export function applyTheme(mode, origin) {
  const root = document.documentElement;
  const set = () => {
    if (mode === 'system') { root.removeAttribute('data-theme'); try { localStorage.removeItem('apex.theme'); } catch { /* storage unavailable */ } }
    else { root.setAttribute('data-theme', mode); try { localStorage.setItem('apex.theme', mode); } catch { /* storage unavailable */ } }
  };
  return transition(set, { kind: 'theme', origin });
}
export const toggleTheme = (origin) => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', origin);

// ---------- vault opening ----------
const MARK_PATH = 'M10.67 79.85 L12.95 78.56 Q14.85 77.48 16.24 75.79 L21.53 69.30 Q24.27 65.95 28.26 67.61 L29.06 67.95 Q33.05 69.61 35.71 66.19 L43.80 55.78 Q46.86 51.83 51.12 54.46 L53.50 55.93 Q57.32 58.30 60.17 54.82 L60.75 54.12 Q63.60 50.65 65.58 46.61 L67.89 41.88 Q70.08 37.39 72.54 33.04 L77.20 24.78';

/** The brief "opening your vault" moment after unlocking: the logo draws, then the app fades in underneath. */
export function unlockMoment() {
  if (prefersReducedMotion()) return;
  const overlay = h('div', { class: 'unlock-overlay', 'aria-hidden': 'true' },
    svg('svg', { class: 'splash-mark', viewBox: '0 0 100 100' },
      svg('rect', { width: 100, height: 100, rx: 22, fill: '#0F5C45' }),
      svg('path', { class: 'splash-line', pathLength: '1', d: MARK_PATH, fill: 'none', stroke: '#fff', 'stroke-width': 8.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('circle', { class: 'splash-dot', cx: 77.2, cy: 24.78, r: 6.9, fill: '#fff' })));
  document.body.append(overlay);
  setTimeout(() => { overlay.classList.add('out'); setTimeout(() => overlay.remove(), 460); }, 720);
}
