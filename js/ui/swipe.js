// Swipe a list row to the left to reveal quick actions (Phase 13). A touch or pen gesture only: a mouse never drags a
// row, and everything a swipe does is also on the investment's page and on the keyboard (Left arrow opens the actions,
// Right arrow or Escape closes them). Vertical scrolling is never taken over: the gesture starts only when the finger
// moves sideways first. The pure rules are exported and tested; the binding below only moves things.
import { haptic } from './haptics.js';

export const AXIS_LOCK_PX = 8;     // how far a finger must move before we know if it is a scroll or a swipe
export const CLICK_GUARD_PX = 6;   // a drag longer than this is not a tap
export const FLING_PX_PER_MS = 0.35;

/** 'x' for a sideways swipe, 'y' for a scroll, null while it is too early to tell. */
export function swipeAxis(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) < AXIS_LOCK_PX) return null;
  return ax > ay * 1.2 ? 'x' : 'y';
}

/** Where the row sits while the finger moves: free between closed (0) and fully open (-width), with a little give beyond. */
export function swipeOffset(startOffset, dx, width) {
  const raw = startOffset + dx;
  if (raw > 0) return Math.min(raw * 0.25, 14);
  if (raw < -width) return Math.max(-width + (raw + width) * 0.25, -width - 22);
  return raw;
}

/** 'open' or 'closed' when the finger lifts: a quick flick decides, otherwise the halfway line does. */
export function swipeSettle({ offset, width, velocity }) {
  if (velocity <= -FLING_PX_PER_MS) return 'open';
  if (velocity >= FLING_PX_PER_MS) return 'closed';
  return offset <= -width / 2 ? 'open' : 'closed';
}

let openRow = null; // only one row is open at a time
const closeOthers = (except) => { if (openRow && openRow !== except) openRow.close(); };
let outsideBound = false;
function bindOutside() {
  if (outsideBound) return; outsideBound = true;
  document.addEventListener('pointerdown', (e) => { if (openRow && !openRow.li.contains(e.target)) openRow.close(); }, true);
  window.addEventListener('hashchange', () => openRow?.close());
}

/**
 * Makes `li` swipeable. `front` is the row on top; `actions` is the element behind it (its links are the actions).
 * Returns { open, close, isOpen }.
 */
export function bindSwipe({ li, front, actions, link }) {
  bindOutside();
  let open = false, width = 0;
  const buttons = () => [...actions.querySelectorAll('a, button')];
  const setOffset = (px) => front.style.setProperty('--swipe-x', `${px}px`);
  const reflect = () => {
    actions.setAttribute('aria-hidden', String(!open)); li.classList.toggle('is-open', open);
    for (const b of buttons()) b.setAttribute('tabindex', open ? '0' : '-1');
    link.setAttribute('aria-expanded', String(open));
  };
  const measure = () => { width = actions.offsetWidth || 168; li.style.setProperty('--swipe-w', `${width}px`); };
  const api = {
    li, isOpen: () => open,
    open({ focus = false } = {}) { measure(); closeOthers(api); open = true; openRow = api; setOffset(-width); reflect(); haptic('toggle'); if (focus) buttons()[0]?.focus(); },
    close({ refocus = false } = {}) { if (!open && !front.classList.contains('dragging')) return; open = false; if (openRow === api) openRow = null; setOffset(0); reflect(); if (refocus) link.focus(); },
  };
  reflect();

  let g = null; // the gesture in progress
  front.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.button > 0) return;
    measure(); g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, start: open ? -width : 0, axis: null, moved: 0, lastX: e.clientX, lastT: e.timeStamp, v: 0, offset: open ? -width : 0 };
  });
  front.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.moved = Math.max(g.moved, Math.abs(dx), Math.abs(dy));
    if (!g.axis) {
      g.axis = swipeAxis(dx, dy);
      if (g.axis === 'y') { g = null; return; }     // a scroll: leave it alone
      if (g.axis === 'x') { closeOthers(api); front.classList.add('dragging'); try { front.setPointerCapture(e.pointerId); } catch { /* fine */ } }
      else return;
    }
    g.offset = swipeOffset(g.start, dx, width); setOffset(g.offset);
    const dt = e.timeStamp - g.lastT; if (dt > 0) g.v = (e.clientX - g.lastX) / dt; g.lastX = e.clientX; g.lastT = e.timeStamp;
  });
  const end = (e) => {
    if (!g || e.pointerId !== g.id) return;
    const done = g; g = null;
    if (done.axis !== 'x') return;
    front.classList.remove('dragging');
    swipeSettle({ offset: done.offset, width, velocity: done.v }) === 'open' ? api.open() : api.close();
  };
  front.addEventListener('pointerup', end); front.addEventListener('pointercancel', end);
  // A drag is not a tap, and tapping an open row closes it instead of opening the investment.
  front.addEventListener('click', (e) => {
    if (open || front.dataset.dragged === '1') { e.preventDefault(); e.stopPropagation(); if (open) api.close(); }
    front.dataset.dragged = '0';
  }, true);
  front.addEventListener('pointermove', () => { if (g && g.moved > CLICK_GUARD_PX) front.dataset.dragged = '1'; });
  front.addEventListener('pointerdown', () => { front.dataset.dragged = '0'; });

  // Keyboard: Left arrow opens the actions and moves to the first one; Right arrow or Escape closes them.
  link.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && !open) { e.preventDefault(); api.open({ focus: true }); }
    else if ((e.key === 'ArrowRight' || e.key === 'Escape') && open) { e.preventDefault(); api.close(); }
  });
  actions.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'ArrowRight') { e.preventDefault(); api.close({ refocus: true }); }
  });
  return api;
}
