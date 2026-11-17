# AILEA PostManager — Security Model

## 1. Zero-Trust Defense-in-Depth
1. **Default-Deny Security Rules (`firestore.rules` & `storage.rules`)**:
   - Both rule files enforce global catch-alls (`allow read, write: if false;`).
   - All writes to protected collections (`workspaces`, `members`, `invites`, `inviteLocks`, `workspaceSlugLocks`, `posts`, `postTranslations`, `postVersions`, `publishedPosts`, `publishedSlugRoutes`, `slugLocks`, `seoSettings`, `reactionPresets`, `postReactions`, `categories`, `tags`, `mediaAssets`, `publishingEvents`, `auditLogs`, analytics, and rate-limit buckets) are rejected directly from client SDKs (`allow write: if false`).
   - Collection-level `allow list` queries are denied on authoring, version, publishing, and audit collections (`allow list: if false`); client reads of `publishedPosts`, `publishedSlugRoutes`, `postReactions`, invites, locks, and analytics collections are blocked (`allow read, write: if false`).
   - Storage (`storage.rules`) denies all direct client SDK reads and writes; media uploads and downloads pass exclusively through `/api/admin/media/upload` and `/api/media/:id`.
   - User documents (`/users/{userId}`) require verified email (`email_verified == true`), forbid cross-user access, allow self-creation only with `role == 'viewer'`, and forbid client-side role or UID escalation on update.

## 2. Authentication & Workspace Isolation
- **Token Verification (`src/server/authMiddleware.ts`)**:
  - Every `/api/admin/*` route requires `Authorization: Bearer <Firebase ID Token>`.
  - Tokens are verified with `getAdminAuth().verifyIdToken(token, true)` (`checkRevoked: true`) and require `decoded.email_verified === true` and non-empty `decoded.email`.
- **Workspace Membership Enforcement (`verifyWorkspaceMembership`)**:
  - Client-supplied `X-Workspace-Id` headers are never trusted blindly; the server loads `workspaces/{wsId}` and `workspaces/{wsId}/members/{uid}` and returns `403` on non-membership.
  - Multi-workspace users load only workspaces where they hold `ownerId === uid` or an explicit server-written membership document.
  - First-time users without memberships receive `{ workspace: null, needsOnboarding: true }` when `createPersonalWorkspace` is `false`, requiring explicit onboarding choice (create personal workspace vs redeem invite).

## 3. RBAC Matrix

| Capability | Owner | Editor | Reviewer | Viewer |
| :--- | :---: | :---: | :---: | :---: |
| Read workspace posts, translations, analytics, export `.md` | Yes | Yes | Yes | Yes |
| Read full collaborator email list (`/api/admin/members`) | Yes | Yes | Yes | Own email only (others redacted) |
| Create/update/delete posts, SEO, categories, tags, presets, media | Yes | Yes | No | No |
| Publish / unpublish / restore post versions | Yes | Yes | No | No |
| Edit translations & approve `fr` / `en` | Yes | Yes | Yes | No |
| Approve `fon` (Fɔngbè) translations | Yes | **No (403)** | Yes | No |
| Read `/api/admin/audit-logs` & direct `auditLogs/{id}` | Yes | Yes | **No (403)** | **No (403)** |
| Manage workspace settings & slug locks (`PATCH /api/admin/workspace`) | Yes | **No** | **No** | **No** |
| Create/list/revoke invites, update/remove member roles | Yes | **No** | **No** | **No** |
| Export JSON backup | Yes | Yes | No | No |
| Restore JSON backup | Yes | **No** | **No** | **No** |

## 4. Public Reactions, Visitor Cookies & Rate Limiting
- **HMAC Secret Management (`getHmacSecret`)**:
  - In production / non-emulator environments, `REACTION_HMAC_SECRET` (or `HMAC_SECRET`) is **mandatory** and fail-closed (`SECURITY_CONFIG_ERROR` if missing or left at placeholder `CHANGE_ME_IN_PRODUCTION`).
  - Only local emulator mode derives a deterministic synthetic dev key when unset.
- **Signed Visitor Cookie (`ailea_vid`)**:
  - Issued as `HttpOnly`, `SameSite=Lax` cookie containing `<nonce>.<issuedAtSec>.<hmac256>`.
  - 180-day TTL, verified in constant time via `crypto.timingSafeEqual`.
  - Reaction submission routes (`POST /api/public/reactions` and `POST /api/public/reactions/form`) **require an existing valid signed cookie** (`resolveExistingVisitorHash`) and reject requests missing/tampering cookies (`403` / `303 ?reaction_error=session`). Fresh tokens are never minted on reaction `POST`.
- **Dual-Layer Distributed Rate Limiting**:
  - Layer 1: In-memory `SlidingWindowRateLimiter` that preserves currently throttled keys when evicting entries under high-cardinality floods.
  - Layer 2: Transactional Firestore `rateLimitBuckets` shared across Cloud Run instances.
- **Idempotency & Concurrency**:
  - `POST /api/public/reactions` records `reactionIdempotency` (30-day TTL) and mutates `visitorReactionStates` + `postReactions.count` inside a single repository transaction.

## 5. Invitations, Media Security & Backups
- **Single-Use Hashed Invitations**:
  - 32 random cryptographic bytes (`base64url`), stored only as SHA-256 `tokenHash` under `workspaces/{wsId}/invites/{tokenHash}` with opaque public `id` (`inv_...`). `tokenHash` is stripped from API responses.
  - Concurrent pending invites for the same normalized email are prevented by transactional `workspaces/{wsId}/inviteLocks/{emailHash}` (72h TTL).
  - Redemption requires matching normalized email on a verified account and executes atomically (`redeemInviteAtomic`). Wrong-email probes return generic `403` without leaking token state (`status oracle` prevention).
- **Media Assets (`AUDIT-001`, `AUDIT-002`, `AUDIT-005`)**:
  - Server-side uploads validate MIME type, sanitized filenames (no `/`, `\`, `..`, `%`, or control bytes), and actual image magic bytes (`PNG`, `JPEG`, `WebP`, `GIF`), storing objects strictly under canonical `workspaces/{workspaceId}/media/{assetId}/{filename}` on the verified default bucket (`getValidatedAdminMediaBucket()`).
  - `assertValidWorkspaceMediaStoragePath()` enforces strict segment validation, rejects traversal (`..`), percent-encoded separators (`%`), null/control characters, absolute/double-slash paths, unexpected buckets/schemes (`gs://`, `http://`, `:`), and cross-workspace/wrong-asset paths on every upload, backup restore, read, and delete while preserving safe read/delete compatibility with pre-existing `workspaces/{workspaceId}/media/{assetId}.{ext}` objects.
  - `restoreWorkspaceBackup()` never trusts `storagePath` from backup payloads: any malformed, traversal, cross-workspace, or wrong-asset `storagePath` is rejected, unknown storage fields (`bucket`, `gcsUri`, etc.) fail `.strict()` schema validation, and stored paths are always reconstructed server-side from the canonical convention.
  - `GET /api/media/:id` ignores client flags (`isPublic`, headers) and allows anonymous access **only** when `isMediaAssetPubliclyReferenced()` confirms an active `'published'` snapshot reference (`Cache-Control: public, max-age=60, must-revalidate`, opaque strong `ETag` with `304` support, `Vary: Authorization`). Private, draft, unpublished, and deleted media require Bearer auth + verified workspace membership (`401` unauthenticated, `403` authenticated non-member, `Cache-Control: private, no-store`, zero storage-path or workspace disclosure).
  - Deletion verifies workspace membership (`owner`/`editor`) immediately before execution and rejects with `409 Conflict` while any active published snapshot still references the asset (`featuredImageUrl`, `seo.*.ogImageUrl`, or translation bodies).
- **Backup & Restore (`AUDIT-009`)**:
  - Strict Zod schemas (`.strict()`) validate backup envelope and every collection item; rejects unsafe URLs, cross-workspace references (including `/api/media/:id` embeds in restored markdown translations), oversized batches (`MAX_BACKUP_RESTORE_OPS = 450`), and forces restored posts back to `status: 'draft'` while updating `slugLocks` atomically.

## 6. Data Retention Policy
- **Ephemeral TTL collections** (`cleanupExpiredEphemeralRecords` every 15m): `rateLimitBuckets` (window expiry), `reactionIdempotency` (30 days), `visitorDailyViews` (90 days).
- **Permanent collections**: `postViews`, `reactionEvents`, `dailyAnalytics`, `auditLogs`, `postVersions`, `publishingEvents`.
