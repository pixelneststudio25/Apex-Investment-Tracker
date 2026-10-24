// Opens the encrypted store for the signed-in user. One local database per account, so two accounts on the
// same device never share a file. Screens call `await vault.store()`; the key is read from the auth state at
// the moment of each call, so locking the app immediately makes the store refuse to read.
import { openIdbBackend } from './db.js';
import { StoreError, createStore } from './store.js';

export function createVault({ auth, openBackend = (name) => openIdbBackend(name), ...storeOptions }) {
  let current = null; // { userId, backend, store }

  async function close() {
    if (!current) return;
    current.store.lock();
    await current.backend.close();
    current = null;
  }

  return {
    async store() {
      const userId = auth.state.userId;
      if (!userId) throw new StoreError('LOCKED', 'Sign in first.');
      if (current && current.userId !== userId) await close(); // a different account signed in on this device
      if (!current) {
        const backend = await openBackend(`apex-data-${userId}`);
        current = { userId, backend, store: createStore({ backend, getDek: () => auth.state.dek, userId, ...storeOptions }) };
      }
      return current.store;
    },
    close,
    // Removes this account's data from this device. NOT called on sign-out (unsynced edits would be lost);
    // Phase 6 offers it as an explicit "remove my data from this device" step after a successful sync.
    async wipe() {
      const userId = auth.state.userId;
      if (!userId) throw new StoreError('LOCKED', 'Sign in first.');
      if (current?.userId === userId) current.store.lock();
      const backend = current?.userId === userId ? current.backend : await openBackend(`apex-data-${userId}`);
      current = null;
      await backend.destroy();
    },
  };
}
