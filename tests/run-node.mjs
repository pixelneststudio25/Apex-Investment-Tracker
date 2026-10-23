import { runTests } from './crypto.test.mjs';
import { runAuthTests } from './auth.test.mjs';
const a = await runTests();
console.log('\n--- account flows ---');
const b = await runAuthTests();
process.exit(a.failed + b.failed ? 1 : 0);
