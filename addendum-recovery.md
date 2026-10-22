# Addendum A: Recovery (approved)

Amends General System Plan sections 5.3, 10 and 15, and Design Plan section 5.13. Where this conflicts with those sections, this wins.

**Principle.** Data is unreadable to the builder and the host, so "always recoverable" is not possible. The aim is that permanent loss needs several independent failures. No server-readable escrow in v1.

## 1. PIN-device recovery path (Phase 1)
"Forgot password" starts with: *"Can you still unlock Apex on this device?"*
- **Yes:** unlock with PIN, verify email, set new password (re-wrap DEK with the new KEK), then prompt to rotate the recovery key. No recovery key needed.
- **No:** continue to the recovery-key flow (Design Plan 5.13).
Note: five wrong PINs wipes the local wrapped key and removes this path.

## 2. Recovery key care (Phases 1 and 7)
- Recovery ceremony stays unskippable.
- Printable one-page recovery sheet (PDF): key, portfolio name, date, plain-language instructions.
- "Check your recovery key" prompt every 90 days: user enters the full key; the app confirms it unwraps `recovery_wrapped_dek`, then records the check date locally. A failed check offers immediate rotation.
- Rotation in Settings (already planned).

## 3. Optional split recovery, 2-of-3 (Phase 7)
- Shamir secret sharing in the browser splits the recovery key into 3 shares; any 2 restore it.
- Suggested holders: the owner, a trusted relative, a lawyer or adviser. No single holder can read anything.
- Settings flow: generate shares, show/print each separately, confirm each was saved; re-splitting invalidates old shares via key rotation.
- Library: vendored, pinned, reviewed (decision recorded in Phase 7).

## 4. Deferred
Passkey (WebAuthn PRF) wrapping of the DEK: revisit after v1 once browser support is checked.

## 5. Rejected for v1
Server-side escrow of the DEK. It would end the promise that the builder cannot read the data. Possible later only as an explicit, informed opt-in.

## 6. Build-order impact
Phase 1 gains the PIN-device recovery path and recovery-key check logic and tests (wrong key, tampered wrap, rotation). Phase 7 gains the recovery sheet PDF and split recovery.
