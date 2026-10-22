// Runs before first paint (loaded synchronously in <head>) to avoid a theme flash.
try {
  var t = localStorage.getItem('apex.theme'); // 'light' | 'dark' | null (follow system)
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage unavailable: follow the system theme */ }
