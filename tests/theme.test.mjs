// The Appearance cards must show what is really applied on this device. getThemeMode() reads the page itself, and
// applyTheme() announces every change with an apex:theme event so the cards can repaint. (Browser-only pieces are
// stubbed here; the on-screen behaviour is covered by the manual checks in docs/phase10-notes.md.)
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (c, m) => { if (!c) throw new Error(m || 'failed'); };

function fakePage(initial) {
  const attrs = new Map(initial ? [['data-theme', initial]] : []), seen = [], store = new Map();
  globalThis.document = {
    documentElement: { getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null), setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), animate() {} },
    dispatchEvent: (e) => { seen.push(e.detail.mode); return true; },
  };
  globalThis.window = globalThis;
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  Object.defineProperty(globalThis, 'matchMedia', { value: () => ({ matches: false }), configurable: true, writable: true });
  return { seen, store };
}

test('getThemeMode: reads what is applied (light, dark, or follow the device)', async () => {
  const m = await import('../js/ui/motion.js');
  fakePage('dark'); ok(m.getThemeMode() === 'dark');
  fakePage('light'); ok(m.getThemeMode() === 'light');
  fakePage(null); ok(m.getThemeMode() === 'system');
});
test('applyTheme: every change is announced and saved on the device, never needing the vault', async () => {
  const m = await import('../js/ui/motion.js');
  const p = fakePage(null);
  await m.applyTheme('dark'); ok(m.getThemeMode() === 'dark' && p.store.get('apex.theme') === 'dark' && p.seen.at(-1) === 'dark');
  await m.applyTheme('system'); ok(m.getThemeMode() === 'system' && !p.store.has('apex.theme') && p.seen.at(-1) === 'system');
  await m.toggleTheme(); ok(p.seen.length === 3, 'the sun and moon button announces too');
});

export async function runThemeTests(log = console.log) {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); passed++; log(`PASS  ${t.name}`); } catch (e) { failed++; log(`FAIL  ${t.name}\n      ${e.message}`); }
  }
  log(`\n${passed} passed, ${failed} failed (theme).`);
  return { passed, failed };
}
