import { runTests } from './crypto.test.mjs';
import { runAuthTests } from './auth.test.mjs';
import { runEngineTests } from './engine.test.mjs';
const a = await runTests();
console.log('\n--- account flows ---');
const b = await runAuthTests();
console.log('\n--- calculation engine ---');
const c = await runEngineTests();
process.exit(a.failed + b.failed + c.failed ? 1 : 0);
