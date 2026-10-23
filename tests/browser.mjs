import { runTests } from './crypto.test.mjs';
const out = document.getElementById('out');
const { failed } = await runTests((line) => { out.textContent += line + '\n'; });
document.getElementById('status').textContent = failed ? `${failed} FAILED` : 'ALL PASSED';
document.getElementById('status').className = failed ? 'loss' : 'gain';
