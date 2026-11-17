# AILEA PostManager — Testing & Verification Guide

## 1. Verification Commands

| Check | Command | Purpose |
| :--- | :--- | :--- |
| TypeScript check | `npm run lint` | Runs `tsc --noEmit` across shared, client, server, and test files |
| Firestore rules static lint | `npm run lint:rules` | Runs `eslint firestore.rules` with `@firebase/eslint-plugin-security-rules` |
| Production client bundle | `npm run build` | Builds Vite client bundle to `dist/` |
| Independent server bundle check | `npx esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=/tmp/ailea-server-build.mjs` | Verifies server entry compiles cleanly for Node ESM runtime |
| Offline unit/SSR/HTTP suites | `npx vitest run tests/translation-studio.ssr.test.ts tests/wp1-build-and-stability.unit.test.ts tests/wp2-media-isolation.unit.test.ts tests/remediation.unit.test.ts tests/http-hardening.unit.test.ts tests/wp2-completeness.unit.test.ts` | Runs all 6 completely offline suites |
| Offline domain/SSR portion of `ailea.test.ts` | `npx vitest run tests/ailea.test.ts -t "AILEA PostManager — (Markdown\|SEO\|SSR Public\|Security Guards)"` | Runs the 11 offline unit/SSR/security tests in `tests/ailea.test.ts` |
| Full Vitest suite | `npm run test` | Runs all 11 files in `tests/` (offline + emulator-dependent) |
| Full Emulator Suite run | `npm run test:emulator` | Starts isolated Auth (`9099`), Firestore (`8080`), Storage (`9199`) under `demo-ailea-postmanager-local` and runs all test files |

## 2. Test Suite Inventory
1. `tests/translation-studio.ssr.test.ts` *(2 offline React `renderToStaticMarkup` tests)*: Verifies no TDZ initialization error across active & empty post lists, RBAC enforcement for `editor` vs `reviewer` on Fɔngbè (`fon`) vs `en`/`fr` approval controls, and trilingual target/UI locale switching.
2. `tests/wp1-build-and-stability.unit.test.ts` *(3 offline unit/SSR/HTTP tests)*: Verifies clean module imports across all React modules/contexts without TDZ errors, `I18nProvider` default `'fr'` rendering, Express route ordering (`/api/health`, `/api/*` JSON 404 fallback guard, `/api/admin/*` 401 gate, `/p/fr|en|fon` SSR + legacy `301`), and `publishPost` strict narrowing across Fɔngbè approval gate, optional `null` locales, `draftRemoved` cleanup, PII stripping, and old slug route/lock cleanup.
3. `tests/wp2-media-isolation.unit.test.ts` *(3 offline unit/HTTP regression tests)*: Verifies `AUDIT-001` canonical `workspaces/{wsId}/media/{assetId}/{filename}` paths, rejection of traversal/encoding/bucket injection, strict backup schemas & untrusted `storagePath` override, plus `AUDIT-002` cross-tenant read/delete denial, `401`/`403`/`404` status guarantees, `?isPublic=true` bypass prevention, versioned `ETag` + `304` caching, private `no-store` headers, and `409 Conflict` protection until publication removal.
4. `tests/remediation.unit.test.ts` *(14 offline tests / `LocalFileRepository`)*: `emulatorGuard`, signed `ailea_vid` cookie expiry/tampering, eviction-safe rate limiter, distributed `rateLimitBuckets`, onboarding + `workspaceSlugLocks`, invite token hash protection + `inviteLocks`, draft-vs-published reaction/snapshot isolation, media traversal/public-ref auth + `409` delete guard, backup strict schema/rollback, cascade post deletion, TTL cleanup, SSR 96% bottom sheet, PII stripping.
5. `tests/http-hardening.unit.test.ts` *(2 offline tests + mocked `verifyIdToken`)*: Cross-workspace `403` on authenticated non-member `/api/media/:id`, viewer member email redaction, repository fault injection across preset/category/tag/workspace routes ensuring no raw stack/secret leaks or unhandled rejections.
6. `tests/wp2-completeness.unit.test.ts` *(5 offline unit/HTTP tests)*: Verifies complete `UI_STRINGS` key parity and Fɔngbè orthography preservation across `fr`/`en`/`fon`, immutable `tagsSnapshot` propagation and SSR rendering, Non-JS `?reaction_error=rate_limit|session` banner safety, `DELETE /api/admin/presets/:id` RBAC (`owner`/`editor` vs `viewer` 403) and cross-tenant `403` isolation, and transactional `workspaceSlugLocks` collision checks.
7. `tests/ailea.test.ts` *(11 offline unit/SSR tests + 1 emulator integration test)*: Markdown/YAML frontmatter, DOMPurify XSS sanitization, slug normalization, Fɔngbè publication validation gate, FR/EN reciprocal `hreflang`, sitemap/robots, No-JS SSR rendering, security guards, plus Express SSR integration (`assertLocalEmulatorEnvironment()`).
8. `tests/rbac.invites.test.ts` *(requires Firebase Emulators)*: Real Auth Emulator token minting, email verification check, refresh-token revocation check, cross-workspace spoof rejection, concurrent bootstrap, hashed single-use invites, Fɔngbè self-approval block, canonical Storage emulator streaming (`401`/`403` isolation).
9. `tests/firestore.rules.test.ts` *(requires Firestore Emulator)*: Direct client SDK rule enforcement across catch-all denies, `users`, `workspaces`, `publishedPosts`, `auditLogs`, authoring collections, and analytics locks.
10. `tests/storage.rules.test.ts` *(requires Storage Emulator)*: Verifies Storage `allow read, write: if false` default-deny across anonymous and authenticated client attempts on canonical and legacy paths.
11. `tests/repository.emulator.test.ts` *(requires Auth + Firestore + Storage Emulators)*: Direct `FirestoreRepository` CRUD, transaction atomicity, `DataRepository` error normalization.

## 3. Environment Safety & Isolation
- Production project ID (`gen-lang-client-0958552955`) is explicitly blocked by `src/server/emulatorGuard.ts` whenever emulator/test mode runs.
- Required CI / local emulator environment variables:
  - `USE_FIREBASE_EMULATOR=true`
  - `VITE_USE_FIREBASE_EMULATOR=true`
  - `FIREBASE_PROJECT_ID=demo-ailea-postmanager-local`
  - `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
  - `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`
  - `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`

## 4. Verified Execution Status in Container
- `npm run lint` (`tsc --noEmit`): **PASS (exit 0)**
- `npm run lint:rules` (`eslint firestore.rules`): **PASS (exit 0)**
- `npm run build` (`vite build`): **PASS (exit 0)**
- Server bundle check (`esbuild server.ts --bundle --platform=node --format=esm --packages=external`): **PASS (exit 0)**
- Offline Vitest unit/SSR/HTTP runs (`translation-studio.ssr.test.ts`, `wp1-build-and-stability.unit.test.ts`, `remediation.unit.test.ts`, `http-hardening.unit.test.ts`, `wp2-completeness.unit.test.ts` + offline filter on `ailea.test.ts`): **37 tests PASS (exit 0)**
- `npm run test:emulator`: **BLOCKED (exit 1)** — `Error: Could not spawn java -version` (Java JDK 21+ is not installed in the sandbox container). Run in CI (`.github/workflows/ci-emulator-verification.yml`) or on a Java-equipped host to verify emulator tests.
