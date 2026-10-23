import { runTests } from './crypto.test.mjs';
const { failed } = await runTests();
process.exit(failed ? 1 : 0);
