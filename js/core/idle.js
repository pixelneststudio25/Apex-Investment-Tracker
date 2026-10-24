// Idle auto-lock. Timers and clock are injectable so it can be tested without waiting.
export function createIdleLock({ ms = 120000, onLock, now = () => Date.now(), setTimer = (f, t) => setTimeout(f, t), clearTimer = (id) => clearTimeout(id) }) {
  let timer = null, running = false, armedAt = 0, hiddenAt = null;
  const fire = () => { if (!running) return; running = false; timer = null; onLock('idle'); };
  const arm = () => { clearTimer(timer); armedAt = now(); timer = setTimer(fire, ms); };
  return {
    start() { running = true; hiddenAt = null; arm(); },
    stop() { running = false; clearTimer(timer); timer = null; },
    bump() { if (running && now() - armedAt > 1000) arm(); }, // re-arm at most once a second
    hidden() { hiddenAt = now(); },
    visible() { // background timers are throttled, so also check the clock when the tab returns
      const away = hiddenAt == null ? 0 : now() - hiddenAt; hiddenAt = null;
      if (running && away >= ms) fire();
    },
  };
}
