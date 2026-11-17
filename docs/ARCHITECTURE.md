# AILEA PostManager — Architecture Specification

## 1. Architectural Overview
AILEA PostManager is a multilingual Markdown editorial studio and public publishing platform built for **French (`fr`)**, **English (`en`)**, and **Fɔngbè (`fon`)** with zero-trust server-mediated access control, immutable published snapshots, and privacy-conscious engagement analytics.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Client Browser                                                          │
│  ├─ Studio SPA (React 19 + TypeScript + Vite + Tailwind CSS + Motion)   │
│  │   └─ Firebase Auth SDK (Google Sign-In, ID token Bearer header)      │
│  └─ Public Reader (SSR HTML from Express — works with or without JS)    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS (Port 3000 / Cloud Run)
┌───────────────────────────────▼─────────────────────────────────────────┐
│ Express Server (Node.js 22 + TypeScript)                                │
│  ├─ Auth & RBAC Middleware (verifyIdToken(checkRevoked: true),          │
│  │   email_verified, server-verified workspace membership)              │
│  ├─ Public SSR & JSON API (/p/:locale, /p/:locale/:slug, /api/public/*) │
│  ├─ Media Streaming Proxy (/api/media/:id)                              │
│  ├─ Domain Store & Transactions (src/server/store.ts)                   │
│  └─ Security Primitives (HMAC cookies, dual rate limiting, DOMPurify)   │
└───────────────┬───────────────────────────────────┬─────────────────────┘
                │ `DataRepository` abstraction       │ Storage Bucket API
┌───────────────▼────────────────┐   ┌──────────────▼─────────────────────┐
│ Firestore Enterprise           │   │ Firebase Storage                     │
│  (Production DB or Local Auth/ │   │  workspaces/{wsId}/media/{assetId} │
│   Firestore Emulator Suite)    │   │  (Zero direct public access)       │
└────────────────────────────────┘   └────────────────────────────────────┘
```

## 2. Established Architectural Decisions (Preserved)
- **Frontend**: React 19, TypeScript, Vite (`vite build`), Tailwind CSS v4, `lucide-react`, `motion/react`, Firebase Client SDK (`src/lib/firebase.ts`).
- **Backend**: Node.js 22 (`v22.23.2`), Express (`server.ts`), Zod request validation, CommonMark/GFM (`marked`) + `isomorphic-dompurify` HTML sanitization, YAML frontmatter (`js-yaml`).
- **Database**: Firestore Enterprise (`databaseId`: `ai-studio-remixaileapostma-c6fc74f8-13e0-4c6d-b64b-233c5c5fc9b1` in project `gen-lang-client-0958552955`) accessed server-side via Firebase Admin SDK (`src/server/firebaseAdmin.ts`) and abstracted behind `DataRepository` (`src/server/repository.ts`, `src/server/firestoreRepo.ts`).
  - Under `VITEST=true`, fallback is disabled if Firestore/emulator fails (`RepositoryError('UNAVAILABLE')`).
  - In local development when GCP Application Default Credentials are absent, `src/server/firestoreRepo.ts` activates `LocalFileRepository` (`.data/ailea-store.json`) after logging a warning; never in `NODE_ENV=production` or `VITEST`.
- **Immutable Published Snapshots**:
  - Live authoring collections (`posts`, `postTranslations`, `seoSettings`, `postReactions`, `categories`, `tags`) remain isolated from public readers.
  - `publishPost()` atomically snapshots clean public data (`publishedPosts/{postId}`, `publishedSlugRoutes/{locale}_{slug}`, `postVersions/{postId}_vN`), including `categorySnapshot` and `tagsSnapshot`, while stripping internal fields (`authorId`, `approvedBy`, `approvedAt`, `linguisticNotes`).
  - Public SSR (`/p/:locale`, `/p/:locale/:slug` including localized `?reaction_error=rate_limit|session` form feedback), XML sitemap (`/sitemap.xml`), and `/api/public/*` read exclusively from `publishedPosts` and `publishedSlugRoutes`.
- **Multilingual & Fɔngbè Support**:
  - French (`fr`) is the default platform language, with full support for English (`en`) and Fɔngbè (`fon`).
  - Fɔngbè Unicode characters (`ɛ`, `ɔ`, `ɖ`) and combining diacritics/tone marks (`\u0301`, `\u0300`, `\u030C`) are preserved verbatim in content and UI. NFKD/NFD diacritic stripping is strictly confined to ASCII URL `generateSlug()`.
  - Publishing any post with a `fon` translation requires `translationStatus === 'approved'`, and only `reviewer` or `owner` roles can set `fon` status to `approved`.
- **SEO & Localization Routing**:
  - Reciprocal `<link rel="alternate" hreflang="...">` and `<xhtml:link>` sitemap annotations are emitted strictly for `fr`, `en`, and `x-default`. Unsupported `fon` hreflang tags are intentionally omitted while keeping `/p/fon/:slug` indexable.
  - Legacy `/:locale/:slug` routes issue `301` redirects to canonical `/p/:locale/:slug`.

## 3. Codebase Layout
- `server.ts`: Express app factory (`createApp`), middleware wiring, SSR/public/admin/media HTTP routes, Vite dev middleware vs `dist/` static serving, ephemeral cleanup scheduler.
- `src/shared/`: Domain types (`types.ts`), UI localization (`i18n.ts`), Markdown/frontmatter/DOMPurify/validation (`markdown.ts`), SEO metadata/sitemap/robots builders (`seo.ts`).
- `src/server/`: Privileged Admin SDK setup (`firebaseAdmin.ts`), emulator fail-closed isolation (`emulatorGuard.ts`), repository interface & implementations (`repository.ts`, `firestoreRepo.ts`, `localFallbackRepo.ts`), transactional domain logic (`store.ts`), security & rate-limit primitives (`security.ts`), Express Auth/RBAC middleware (`authMiddleware.ts`), No-JS/progressive SSR templates (`ssr.ts`).
- `src/components/` & `src/modules/`: React studio shell with responsive 96%-height native-feel bottom sheet (`StudioShell.tsx`), authenticated media loader (`AuthorizedMediaImage.tsx`), Dashboard, Post Manager, Translation Studio, Reaction Studio, SEO Studio, Analytics, Content Library, Settings.
