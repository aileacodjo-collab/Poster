# AILEA PostManager — Phase 1 Local Emulator Security & Data-Flow Guide

## 1. Local Emulator Isolation Guarantees
- Synthetic Emulator Project ID: `demo-ailea-postmanager-local` (configured in `.firebaserc`).
- Target Cloud Project (`gen-lang-client-0958552955`) and Firestore Enterprise Database (`ai-studio-remixaileapostma-c6fc74f8-13e0-4c6d-b64b-233c5c5fc9b1`) from `firebase-applet-config.json` are **never** contacted in emulator/test runs.
- `src/server/emulatorGuard.ts` (`assertLocalEmulatorEnvironment()`) enforces fail-closed isolation:
  - Dynamically loads `firebase-applet-config.json` `projectId` (`gen-lang-client-0958552955`) as `BLOCKED_PRODUCTION_PROJECT_ID` and forbids any emulator run from targeting it or any non-`demo-*` project ID.
  - Requires `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` (`requireAuthEmulator !== false`), and `FIREBASE_STORAGE_EMULATOR_HOST` (`requireStorageEmulator !== false`) to point strictly to `127.0.0.1`, `localhost`, or `[::1]`.
  - Never falls back silently to remote/live Firebase services if an emulator is unreachable (`RepositoryError('UNAVAILABLE')`).
- Client SDK (`src/lib/firebase.ts`) connects Auth (`127.0.0.1:9099`), Firestore (`127.0.0.1:8080`, named database in non-emulator mode / `(default)` emulator), and Storage (`127.0.0.1:9199`) when `VITE_USE_FIREBASE_EMULATOR=true`.

## 2. How to Start, Stop, and Run Tests Against Emulators

### Automated Ephemeral Run (Recommended)
Starts Auth (`127.0.0.1:9099`), Firestore (`127.0.0.1:8080`), and Storage (`127.0.0.1:9199`), runs the complete test suite inside the isolated emulator environment, and shuts the emulators down cleanly afterward:
```bash
npm run test:emulator
```

### Manual Interactive Emulator Session
Start emulators in terminal 1:
```bash
firebase emulators:start --project demo-ailea-postmanager-local --only auth,firestore,storage
```
Run the server against local emulators in terminal 2:
```bash
USE_FIREBASE_EMULATOR=true \
VITE_USE_FIREBASE_EMULATOR=true \
FIREBASE_PROJECT_ID=demo-ailea-postmanager-local \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
npm run dev
```
Stop the emulators cleanly with `Ctrl+C` in terminal 1.

### Security Rules Static Linting
```bash
npm run lint:rules
```

## 3. Data-Flow & Zero-Trust Access Boundaries
1. **Default-Deny Rules & Server-Mediated Public/Studio Reads**:
   - `firestore.rules` and `storage.rules` both enforce `allow read, write: if false;` catch-alls.
   - Public pages (`/p/:locale`, `/p/:locale/:slug`), XML sitemap (`/sitemap.xml`), and public APIs (`/api/public/*`) are served strictly by the Express server via the Firebase Admin SDK from `publishedPosts` and `publishedSlugRoutes`, sanitized of internal `authorId`, `approvedBy`, `approvedAt`, and `linguisticNotes`.
   - Direct client SDK reads and writes on `publishedPosts`, `publishedSlugRoutes`, `postReactions`, `workspaces/{wsId}/invites`, `workspaces/{wsId}/inviteLocks`, `workspaceSlugLocks`, and all analytics/rate-limit/lock collections are denied (`allow read, write: if false;`), and collection-level `allow list` queries are disabled across authoring/audit collections.
   - `auditLogs` direct document reads (`allow get`) are restricted to `owner` and `editor` roles only; `GET /api/admin/audit-logs` enforces `requireRole(['owner', 'editor'])`.
   - `GET /api/media/:id` serves media publicly ONLY when actively referenced by a `published` snapshot (`Cache-Control: public, max-age=60, must-revalidate`); draft or unreferenced media requires a valid verified Firebase Bearer token and workspace membership (`Cache-Control: private, no-store`).
2. **RBAC Roles (`owner`, `editor`, `reviewer`, `viewer`)**:
   - `owner`: full workspace configuration (`PATCH /api/admin/workspace` with transactional `workspaceSlugLocks`), member invitations/removal, role changes, backup export/restore (`MAX_BACKUP_RESTORE_OPS = 450`, strict schemas, cross-workspace isolation), publishing, editing, audit logs.
   - `editor`: create/edit/publish/unpublish posts, configure reactions, SEO, categories/tags, media upload/deletion (`409 Conflict` if actively referenced in published snapshots), export backups, audit logs.
   - `reviewer`: review and save/approve translations (`PUT /api/admin/posts/:id/translations/:locale`, including Fɔngbè approval); cannot create/delete/publish posts, view audit logs, or mutate workspace settings/team.
   - `viewer`: read-only access to workspace posts, analytics, validation, and markdown export; member list emails for other collaborators are redacted server-side; cannot view audit logs or invitations.
3. **Signed Visitor Identity & Rate Limiting**:
   - `ailea_vid` is issued as an HMAC-SHA256-signed expiring token (`nonce.issuedAtSec.sig`, 180-day TTL, constant-time verified via `crypto.timingSafeEqual`) on `GET` article/API loads (`computeVisitorHash`).
   - Reaction mutations (`POST /api/public/reactions` and `POST /api/public/reactions/form`) require a pre-existing valid signed `ailea_vid` cookie (`resolveExistingVisitorHash`, never minting fresh tokens on `POST`) and enforce both in-memory LRU/non-throttled-preserving sliding windows and Firestore-backed `rateLimitBuckets`.
4. **Single-Use Invitations**:
   - `POST /api/admin/invites` creates `32` random bytes (`base64url`), stores only its `SHA-256` hash (`workspaces/{wsId}/invites/{tokenHash}`) plus an atomic `workspaces/{wsId}/inviteLocks/{emailHash}` guard with 72-hour expiration, and returns only opaque `invite.id` (`inv_...`) to workspace admins without exposing `tokenHash`.
   - `POST /api/admin/invites/accept` validates `email_verified`, matches normalized email strictly, and executes an atomic transaction (`redeemInviteAtomic`) creating `workspaces/{wsId}/members/{uid}`, marking the invite `accepted`, and clearing `inviteLocks/{emailHash}`.
5. **Ephemeral TTL Retention Policy vs Permanent Ledger Data**:
   - Ephemeral anti-abuse/dedup collections carry ISO `expiresAt` timestamps and are purged via `cleanupExpiredEphemeralRecords()`:
     - `rateLimitBuckets` (window expiry), `reactionIdempotency` (30 days), `visitorDailyViews` (90 days).
   - Permanent collections retained indefinitely across editorial & audit history:
     - `postViews`, `reactionEvents`, `dailyAnalytics`, `auditLogs`, `postVersions`, `publishingEvents`.
