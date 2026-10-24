# Addendum B: Crypto implementation details (Phase 1)

Refines General System Plan section 5. Where this conflicts, this wins.

1. **KDF salt is derived from the email, not random.** The profile row is unreadable until the user is authenticated, but the auth secret (which authenticates them) needs the salt first. Salt = SHA-256("apex-kdf-salt-v1:" + normalized email). `profiles.kdf_salt` still stores it for the record. Consequence: changing a user's email later needs a password-change flow that re-derives under the new email. No random-salt lookup endpoint is used, which also avoids account enumeration.
2. **Pre-login parameters.** The first login attempt uses the app's current default KDF parameters; `profiles.kdf_params` is authoritative once the profile is read. Upgrading iterations later needs a version-try step (design when needed).
3. **Wrapping.** DEK wrapped with AES-GCM (random 96-bit IV, stored as base64(iv + ct)) with fixed context strings as AAD: `apex/wrap/dek/v1` (password KEK), `apex/wrap/recovery-dek/v1`, `apex/wrap/pin-dek/v1`. KEK and recovery KEK are non-extractable CryptoKeys. The DEK is extractable (needed to re-wrap) and lives in memory only.
4. **Records.** AES-GCM, random 96-bit IV, AAD = `apex/record/v1|<user_id>|<record_id>`. Payload = base64(iv + ciphertext).
5. **Recovery key format.** 256 random bits, Crockford base32 (52 chars) plus a 4-char checksum (20 bits of SHA-256), shown as 14 groups of 4. Parsing ignores case, spaces and hyphens and maps O to 0 and I/L to 1. The checksum only catches typos; security rests on the 256 bits.
6. **PIN.** PBKDF2-SHA256 (default 600,000 iterations, to be tuned on real phones) with a 16-byte per-device salt, then HKDF. Four digits only: a convenience lock, as stated in the plan.
7. **Signup under email verification.** Because Supabase blocks the profile insert until the email is verified, the keys created at signup are held locally (IndexedDB, in the wrapped form only) and uploaded on the first verified login. The recovery key is shown before that upload and never stored.
