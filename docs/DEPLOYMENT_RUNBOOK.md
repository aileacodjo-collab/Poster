# AILEA PostManager — Deployment Runbook

## 1. Target Google Cloud / Firebase Environment
- **Firebase / GCP Project**: `gen-lang-client-0958552955`
- **Firestore Enterprise Database ID**: `ai-studio-remixaileapostma-c6fc74f8-13e0-4c6d-b64b-233c5c5fc9b1`
- **Firebase Storage Bucket**: `gen-lang-client-0958552955.firebasestorage.app`
- **Runtime**: Node.js `>=22`, Port `3000` (Cloud Run)

## 2. Pre-Deployment Configuration Checklist
1. **Secret Manager (`REACTION_HMAC_SECRET`)**:
   - Generate a cryptographically random 32+ byte secret:
     ```bash
     openssl rand -hex 32
     ```
   - Store in Google Cloud Secret Manager and mount into Cloud Run as environment variable `REACTION_HMAC_SECRET`.
   - Server startup (`getHmacSecret()`) fails closed if `REACTION_HMAC_SECRET` is unset or equals `CHANGE_ME_IN_PRODUCTION`.
2. **Environment Variables (Cloud Run)**:
   - `NODE_ENV=production`
   - `PORT=3000`
   - `APP_URL=<https://your-cloud-run-service-url>` (no trailing slash)
   - `FIREBASE_PROJECT_ID=gen-lang-client-0958552955`
   - `FIREBASE_STORAGE_BUCKET=gen-lang-client-0958552955.firebasestorage.app`
   - `REACTION_HMAC_SECRET=<from Secret Manager>`
   - Ensure `USE_FIREBASE_EMULATOR` and `FIRESTORE_EMULATOR_HOST` / `FIREBASE_*_EMULATOR_HOST` are **unset**.
3. **Cloud Run Service Account IAM**:
   - Grant the Cloud Run runtime service account only minimum required roles:
     - `roles/datastore.user` (Firestore Enterprise read/write)
     - `roles/storage.objectAdmin` scoped to bucket `gen-lang-client-0958552955.firebasestorage.app`
     - `roles/firebaseauth.admin` (or custom role covering `verifyIdToken` + `checkRevoked`)
     - `roles/secretmanager.secretAccessor` scoped to `REACTION_HMAC_SECRET`
4. **Firebase Console Auth Providers**:
   - Ensure Google Sign-In is enabled and authorized domains include the Cloud Run domain (`APP_URL` host).

## 3. Deploying Rules & Indexes
Run using authenticated Firebase CLI targeting `gen-lang-client-0958552955` (never inside local automated test scripts):
```bash
npm run lint:rules
firebase deploy --project gen-lang-client-0958552955 --only firestore:rules,firestore:indexes,storage
```

## 4. Build & Startup Verification
```bash
npm ci --omit=dev   # after Vite client assets are built via npm run build
npm run build
npm start           # launches tsx server.ts on port 3000 with NODE_ENV=production
```
Verify readiness via:
- `GET /api/health` → `200 { ok: true, backend: "firestore", ... }`
- `GET /robots.txt` & `GET /sitemap.xml` → `200`
- `GET /p/fr` → `200 text/html`

## 5. CI/CD Gate (`.github/workflows/ci-emulator-verification.yml`)
Every push/PR to `main`/`master` executes:
1. `npm run lint` (`tsc --noEmit`)
2. `npm run lint:rules` (`eslint firestore.rules`)
3. `npm run build` (`vite build`)
4. `npm run test:emulator` inside Java 21 + Firebase Emulator Suite (`demo-ailea-postmanager-local`)

## 6. Workspace Backups & Recovery
- Owners and editors can export workspace state as JSON via Settings (`GET /api/admin/backup/export`).
- Owners can restore JSON backups via `POST /api/admin/backup/restore` (validated by strict schemas, capped at 450 atomic transactional writes per batch, and restoring posts cleanly as `draft` so Fɔngbè review and SEO checks run prior to republication).
