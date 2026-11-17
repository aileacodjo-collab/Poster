# AILEA PostManager — Known Limitations & Environmental Boundaries

1. **Java Runtime Unavailable in Preview Sandbox**:
   - `firebase emulators:exec` (`npm run test:emulator`) requires a JVM (`java`) on `PATH`.
   - The execution container does not provide Java, so `tests/rbac.invites.test.ts`, `tests/firestore.rules.test.ts`, `tests/storage.rules.test.ts`, and `tests/repository.emulator.test.ts` cannot run locally inside this sandbox and must be executed in CI (`.github/workflows/ci-emulator-verification.yml`) or a Java-equipped host.
2. **Local Non-Production Dev Fallback Storage**:
   - When `NODE_ENV !== 'production'`, `VITEST` is unset, and Firebase Admin credentials/emulators are unreachable, `src/server/firestoreRepo.ts` activates `LocalFileRepository` (`.data/ailea-store.json`) and local filesystem media cache (`.data/media/`) with an explicit console warning. Production (`NODE_ENV=production`) and `VITEST` never enable silent local fallback for Firestore/Auth verification.
3. **Manual Invitation Token Delivery**:
   - Creating a workspace invitation returns a single-use cryptographic `rawToken` once to the workspace owner (storing only `SHA-256(token)` server-side). Outbound email delivery (SMTP / SendGrid / Resend) is intentionally not configured yet; workspace owners copy and deliver the Workspace ID and token out-of-band, and recipients redeem them in the Studio UI or via `?workspaceId=...&inviteToken=...`.
4. **Backup Restore Batch Cap**:
   - `restoreWorkspaceBackup` executes all validation and writes within a single Firestore transaction capped at `MAX_BACKUP_RESTORE_OPS = 450` operations (leaving headroom under Firestore's 500-op transaction limit). Very large editorial archives exceeding 450 records must be split across multiple restore payloads.
5. **Distributed Rate Limit Tradeoff**:
   - High-rate endpoints check an in-process sliding-window limiter before committing transactional reads/writes to Firestore `rateLimitBuckets` to curb hot-document contention. Under extreme bursts across many Cloud Run instances, per-instance burst allowances can marginally exceed the aggregate window before Firestore bucket enforcement rejects excess traffic.
