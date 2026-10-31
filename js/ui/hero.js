// Shared-element transition (Phase 13): the icon tile and the name of an investment glide from its card or list row to
// the top of its page, and back again, instead of the whole page simply fading.
//
// How it works: a card, a list row and the page header each wear data-inv="<id>" and mark their icon tile and name with
// data-hero="tile" and data-hero="name". When the page is about to change, the old tile and name are given a
// view-transition-name; after the new page is in place the matching new ones get the same names, and the browser
// animates between them. The names are removed again as soon as it is over.
//
// It only runs when the browser supports view transitions, Reduce Motion is off, the old tile is really on screen and
// the new page has a matching one. In every other case nothing is different: the page just changes as it always did.
import { transition, prefersReducedMotion } from './motion.js';

const NAME = { tile: 'inv-tile', name: 'inv-name' };

/** Decides whether a shared-element transition should run. Pure, so it can be tested without a screen. */
export function shouldGlide({ supported, reduced, fromTile, toTile, onScreen }) {
  return !!(supported && !reduced && fromTile && toTile && onScreen);
}

const find = (root, id, kind) => {
  const box = [...root.querySelectorAll('[data-inv]')].find((e) => e.getAttribute('data-inv') === id);
  return box ? box.querySelector(`[data-hero="${kind}"]`) : null;
};
const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (window.innerHeight || 0) && r.right > 0 && r.left < (window.innerWidth || 0); };
const set = (el, name) => { if (el) el.style.viewTransitionName = name; };

/** Whether the new page has an element to glide to for this investment. */
export const hasHero = (view, id) => !!find(view, id, 'tile');

/**
 * Changes the page with a shared-element transition if it can. `swap` puts the new page in place (and may be async).
 * Returns true if it handled the change (swap has run), false if the caller should do the plain change itself.
 */
export async function heroSwap({ outlet, view, id, swap }) {
  const fromTile = find(outlet, id, 'tile'), toTile = find(view, id, 'tile');
  const supported = typeof document.startViewTransition === 'function';
  if (!shouldGlide({ supported, reduced: prefersReducedMotion(), fromTile, toTile, onScreen: fromTile ? visible(fromTile) : false })) return false;
  const fromName = find(outlet, id, 'name');
  set(fromTile, NAME.tile); set(fromName, NAME.name);
  let toName = null;
  try {
    await transition(async () => {
      await swap();
      const nowTile = find(outlet, id, 'tile'); toName = find(outlet, id, 'name'); // the new page, now in place
      set(nowTile, NAME.tile); set(toName, NAME.name);
    }, { kind: 'hero' });
  } finally {
    for (const el of outlet.querySelectorAll('[data-hero]')) el.style.viewTransitionName = '';
  }
  return true;
}
