// Phase 0 placeholder: theme switcher only, to verify tokens in both themes.
const root = document.documentElement;
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const isLight = getComputedStyle(root).colorScheme.startsWith('light');
  const next = isLight ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('apex.theme', next); } catch (e) {}
});
