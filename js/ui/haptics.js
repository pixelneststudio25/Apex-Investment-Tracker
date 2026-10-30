// Light vibration feedback (Phase 13), behind the Touch feedback setting. It does nothing when the setting is off or when
// the device cannot vibrate (iPhones and iPads do not allow it from a web app; most Android phones do). The last choice
// is also kept on this device, so the PIN keypad can follow it before the vault is open. Not a secret and not money.
const KEY = 'apex.haptics';
const PATTERNS = Object.freeze({ tick: 8, toggle: 12, success: [10, 40, 10], warn: [40, 70, 40], deny: [12, 50, 12] });
const TICK_GAP_MS = 45; // a fast scrub must feel like a texture, not a buzz

let enabled = (() => { try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; } })();
let lastTick = -Infinity;

export function setHaptics(on) {
  enabled = !!on;
  try { globalThis.localStorage?.setItem(KEY, enabled ? '1' : '0'); } catch { /* private mode: it still works for this visit */ }
}
export const hapticsEnabled = () => enabled;
export const hapticsSupported = () => typeof globalThis.navigator?.vibrate === 'function';

/** Plays one of: tick, toggle, success, warn, deny. Returns true if it asked the device to vibrate. */
export function haptic(kind = 'tick', now = globalThis.performance?.now?.() ?? Date.now()) {
  if (!enabled || !hapticsSupported()) return false;
  const pattern = PATTERNS[kind] ?? PATTERNS.tick;
  if (kind === 'tick') { if (now - lastTick < TICK_GAP_MS) return false; lastTick = now; }
  try { return !!globalThis.navigator.vibrate(pattern); } catch { return false; }
}
