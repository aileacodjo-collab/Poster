import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { z } from 'zod';
import {
  AuthRequest,
  requireAuth,
  requireRole,
  requireWorkspaceAccess,
  verifyBearerToken,
} from './src/server/authMiddleware.ts';
import { assertLocalEmulatorEnvironment, isEmulatorModeRequested } from './src/server/emulatorGuard.ts';
import { getRepository, setRepository } from './src/server/firestoreRepo.ts';
import { LocalFileRepository } from './src/server/localFallbackRepo.ts';
import { RepositoryError } from './src/server/repository.ts';
import {
  computeIpBucketKey,
  computeVisitorHash,
  consumeDistributedRateLimit,
  getHmacSecret,
  publicReactionLimiter,
  publicViewLimiter,
  resolveExistingVisitorHash,
  resolveViewVisitorHash,
  sanitizeReferrerHost,
  validateImageBuffer,
} from './src/server/security.ts';
import { renderNotFoundHtml, renderPublicIndexHtml, renderPublicPostHtml } from './src/server/ssr.ts';
import {
  acceptWorkspaceInvite,
  assertValidWorkspaceMediaStoragePath,
  createPost,
  createWorkspaceInvite,
  deleteWorkspaceMediaAsset,
  deleteWorkspacePost,
  exportPostMarkdown,
  exportWorkspaceBackup,
  getPostBundle,
  getPublishedPostByLocaleSlug,
  getVisitorReactionsForPost,
  getWorkspaceAnalytics,
  importMarkdownPost,
  isMediaAssetPubliclyReferenced,
  listAllPublishedBundles,
  listAllPublishedPostsForLocale,
  listUserWorkspaces,
  listWorkspaceInvites,
  listWorkspacePosts,
  logAudit,
  publishPost,
  readMediaAssetBuffer,
  recordPublicView,
  restorePostVersion,
  restoreWorkspaceBackup,
  revokeWorkspaceInvite,
  sanitizeMediaFilename,
  savePostReactionsConfig,
  savePostTranslation,
  saveSeoSetting,
  submitPublicReaction,
  unpublishPost,
  updatePostMetadata,
  updateWorkspaceMemberRole,
  updateWorkspaceSettings,
  uploadMediaAssetToStorage,
  upsertUserAndResolveWorkspace,
  verifyWorkspaceMembership,
} from './src/server/store.ts';
import { validatePostForPublication } from './src/shared/markdown.ts';
import { buildRobotsTxt, buildXmlSitemap, isSafeAssetOrHttpUrl, isSafeHttpUrl } from './src/shared/seo.ts';
import {
  AuditLog,
  Category,
  Locale,
  MediaAsset,
  Post,
  PublishedPostSnapshot,
  ReactionPreset,
  SUPPORTED_LOCALES,
  Tag,
  UserRole,
  Workspace,
  WorkspaceMember,
} from './src/shared/types.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const GENERATED_IMAGES_DIR = path.resolve(process.cwd(), 'src/assets/images');
const PARAM_ID_REGEX = /^[a-zA-Z0-9_-]{1,160}$/;
const SAFE_HOST_REGEX = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;

function isValidParamId(value: unknown): value is string {
  return typeof value === 'string' && PARAM_ID_REGEX.test(value);
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'export';
}

function sanitizeMembersForRole(members: WorkspaceMember[], role: UserRole, selfUid: string): WorkspaceMember[] {
  if (role !== 'viewer') return members;
  return members.map((m) => {
    if (m.userId === selfUid) return m;
    const { email: _omitEmail, ...rest } = m;
    return rest;
  });
}

function asyncHandler<TReq extends express.Request = express.Request>(
  fn: (req: TReq, res: express.Response, next: express.NextFunction) => Promise<unknown> | unknown
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as TReq, res, next)).catch(next);
  };
}

function resolveBaseUrl(req: express.Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  const proto = req.protocol === 'https' ? 'https' : 'http';
  const rawHost = String(req.get('host') || '').trim();
  const host = SAFE_HOST_REGEX.test(rawHost) ? rawHost : `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function sendRouteError(res: express.Response, err: unknown, fallbackMessage: string, fallbackStatus = 500): void {
  if (err instanceof RepositoryError) {
    const safeMsg = err.code === 'INTERNAL' ? fallbackMessage : err.message;
    res.status(err.httpStatus).json({ error: safeMsg });
    return;
  }
  if (fallbackStatus >= 500) {
    console.error('Unhandled route error:', err);
  }
  res.status(fallbackStatus).json({ error: fallbackMessage });
}

export async function createApp() {
  if (isEmulatorModeRequested()) {
    assertLocalEmulatorEnvironment();
  } else if (process.env.VITEST !== 'true') {
    try {
      await getRepository().ping();
    } catch (err) {
      if (err instanceof RepositoryError && err.code === 'PERMISSION_DENIED') {
        console.warn(
          'FIRESTORE_ADMIN_IAM_UNAVAILABLE: Admin SDK lacks Firestore IAM permissions in this sandbox; activating persistent local store fallback (.data/ailea-local-store.json).'
        );
        setRepository(new LocalFileRepository());
      } else {
        console.warn('Firestore ping warning during startup:', err);
      }
    }
  }
  // Fail-closed validation of REACTION_HMAC_SECRET at startup in production (RED-018)
  getHmacSecret();

  const app = express();
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use('/assets/images', express.static(GENERATED_IMAGES_DIR, { maxAge: '7d' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'ailea-postmanager', timestamp: new Date().toISOString() });
  });

  // =========================================================================
  // EXPRESS-MEDIATED MEDIA STREAMING (Public only when referenced by published snapshot)
  // =========================================================================
  app.get(
    '/api/media/:id',
    asyncHandler(async (req: AuthRequest, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Vary', 'Authorization');
      res.setHeader('Cache-Control', 'private, no-store');

      const id = String(req.params.id || '');
      if (!isValidParamId(id)) {
        res.status(400).json({ error: 'Identifiant média invalide.' });
        return;
      }
      try {
        const asset = await getRepository().get<MediaAsset & { deletedAt?: string }>(`mediaAssets/${id}`);
        let isPublic = false;
        let hasValidAssetRecord = false;
        if (asset && asset.id === id && asset.workspaceId && asset.storagePath && !asset.deletedAt) {
          try {
            assertValidWorkspaceMediaStoragePath(asset.storagePath, asset.workspaceId, asset.id);
            hasValidAssetRecord = true;
            isPublic = await isMediaAssetPubliclyReferenced(asset);
          } catch {
            hasValidAssetRecord = false;
            isPublic = false;
          }
        }

        if (!isPublic) {
          const ok = await verifyBearerToken(req, res);
          if (!ok || !req.user) return;
          if (!asset || asset.id !== id || !asset.storagePath || asset.deletedAt) {
            res.status(404).json({ error: 'Média introuvable.' });
            return;
          }
          const requestedWsHeader = req.headers['x-workspace-id'];
          if (
            typeof requestedWsHeader === 'string' &&
            requestedWsHeader.trim() !== '' &&
            requestedWsHeader.trim() !== asset.workspaceId
          ) {
            res.status(403).json({ error: 'Accès refusé.' });
            return;
          }
          try {
            await verifyWorkspaceMembership({
              uid: req.user.uid,
              email: req.user.email!,
              requestedWorkspaceId: asset.workspaceId,
            });
          } catch (memberErr) {
            if (memberErr instanceof RepositoryError && memberErr.code === 'PERMISSION_DENIED') {
              res.status(403).json({ error: 'Accès refusé.' });
              return;
            }
            throw memberErr;
          }
        }

        if (!asset || asset.id !== id || !asset.storagePath || asset.deletedAt || !hasValidAssetRecord) {
          res.status(404).json({ error: 'Média introuvable.' });
          return;
        }

        assertValidWorkspaceMediaStoragePath(asset.storagePath, asset.workspaceId, asset.id);

        const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
        const safeMime = allowedMimes.has(asset.mimeType) ? asset.mimeType : 'application/octet-stream';
        const buffer = await readMediaAssetBuffer(asset, { expectedWorkspaceId: asset.workspaceId });
        if (!buffer) {
          res.status(404).json({ error: 'Fichier média introuvable.' });
          return;
        }
        res.setHeader('Content-Type', safeMime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Vary', 'Authorization');

        if (isPublic) {
          const versionHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
          const versionTag = `"v1-${versionHash}"`;
          res.setHeader('ETag', versionTag);
          res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
          if (req.headers['if-none-match'] === versionTag) {
            res.status(304).end();
            return;
          }
        } else {
          res.setHeader('Cache-Control', 'private, no-store');
          res.setHeader('Pragma', 'no-cache');
        }
        res.send(buffer);
      } catch (err) {
        res.setHeader('Cache-Control', 'private, no-store');
        sendRouteError(res, err, 'Erreur lors du chargement du média.', 500);
      }
    })
  );

  // =========================================================================
  // SEO: XML Sitemap & Robots.txt
  // =========================================================================
  app.get(
    '/sitemap.xml',
    asyncHandler(async (req, res) => {
      try {
        const baseUrl = resolveBaseUrl(req);
        const published = await listAllPublishedBundles();
        const xml = buildXmlSitemap({
          baseUrl,
          entries: published.map((p) => ({
            post: p.bundle.post,
            translations: p.bundle.translations,
          })),
        });
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.send(xml);
      } catch (err) {
        console.error('Sitemap error:', err);
        res.status(500).type('text/plain').send('Error generating sitemap');
      }
    })
  );

  app.get('/robots.txt', (req, res) => {
    const baseUrl = resolveBaseUrl(req);
    res.type('text/plain; charset=utf-8').send(buildRobotsTxt(baseUrl));
  });

  // =========================================================================
  // PUBLIC SSR EDITORIAL PAGES (Works with or without JavaScript)
  // =========================================================================
  app.get('/p', (_req, res) => {
    res.redirect(302, '/p/fr');
  });

  app.get(
    '/p/:locale(fr|en|fon)',
    asyncHandler(async (req, res) => {
      const locale = req.params.locale as Locale;
      const baseUrl = resolveBaseUrl(req);
      try {
        const items = await listAllPublishedPostsForLocale(locale);
        const html = renderPublicIndexHtml({ baseUrl, locale, items });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      } catch (err) {
        console.error('Public index SSR error:', err);
        res.status(500).send(renderNotFoundHtml(locale, baseUrl));
      }
    })
  );

  const handlePublicPostSsr = async (req: express.Request, res: express.Response) => {
    const locale = req.params.locale as Locale;
    const slug = String(req.params.slug || '');
    const baseUrl = resolveBaseUrl(req);

    try {
      const found = await getPublishedPostByLocaleSlug(locale, slug);
      if (!found) {
        res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderNotFoundHtml(locale, baseUrl));
        return;
      }

      const visitorHash = computeVisitorHash(req, res, found.workspace.id);
      const ipKey = computeIpBucketKey(req);
      const rate = publicViewLimiter.consume(`view:${ipKey}:${found.bundle.post.id}`);
      if (rate.allowed) {
        const distViewRate = await consumeDistributedRateLimit(
          getRepository(),
          `view_${ipKey}_${found.bundle.post.id}`,
          120,
          60_000
        );
        if (distViewRate.allowed) {
          await recordPublicView({
            postId: found.bundle.post.id,
            workspaceId: found.workspace.id,
            visitorHash,
            locale,
            referrer: sanitizeReferrerHost(req.headers.referer, baseUrl),
          });
        }
      }

      const rawReactionErr = req.query.reaction_error;
      const reactionError: 'rate_limit' | 'session' | null =
        rawReactionErr === 'rate_limit' || rawReactionErr === 'session' ? rawReactionErr : null;

      const activeReactionKeys = await getVisitorReactionsForPost(found.bundle.post.id, visitorHash);
      const html = renderPublicPostHtml({
        baseUrl,
        workspace: found.workspace,
        bundle: found.bundle,
        locale,
        category: found.category,
        tags: found.tags,
        activeReactionKeys,
        reactionError,
        relatedPosts: found.relatedPosts,
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      console.error('Public post SSR error:', err);
      res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8').send(renderNotFoundHtml(locale, baseUrl));
    }
  };

  app.get('/p/:locale(fr|en|fon)/:slug', asyncHandler(handlePublicPostSsr));
  // Canonical 301 redirect from legacy /:locale/:slug to /p/:locale/:slug (RED-014)
  app.get('/:locale(fr|en|fon)/:slug', (req, res) => {
    const locale = req.params.locale as Locale;
    const slug = String(req.params.slug || '');
    res.redirect(301, `/p/${locale}/${encodeURIComponent(slug)}`);
  });

  // =========================================================================
  // PUBLIC APIs (Reactions, Views, Published Fetch)
  // =========================================================================
  app.get(
    '/api/public/posts/:locale(fr|en|fon)/:slug',
    asyncHandler(async (req, res) => {
      const locale = req.params.locale as Locale;
      const slug = String(req.params.slug || '');
    try {
      const found = await getPublishedPostByLocaleSlug(locale, slug);
      if (!found) {
        res.status(404).json({ error: 'Article introuvable ou non publié.' });
        return;
      }
      const visitorHash = computeVisitorHash(req, res, found.workspace.id);
      const activeReactionKeys = await getVisitorReactionsForPost(found.bundle.post.id, visitorHash);
      const rawTr = found.bundle.translations[locale];

      // Strip internal UIDs & linguistic reviewer notes from public JSON payload (RED-013)
      const publicWorkspace = {
        id: found.workspace.id,
        name: found.workspace.name,
        slug: found.workspace.slug,
        brandName: found.workspace.brandName,
        defaultLocale: found.workspace.defaultLocale,
        baseUrl: found.workspace.baseUrl,
      };
      const { authorId: _omitAuthorId, ...publicPost } = found.bundle.post;
      const publicTranslation = rawTr
        ? {
            id: rawTr.id,
            postId: rawTr.postId,
            locale: rawTr.locale,
            title: rawTr.title,
            slug: rawTr.slug,
            excerpt: rawTr.excerpt,
            sanitizedHtml: rawTr.sanitizedHtml,
            wordCount: rawTr.wordCount,
            readingTimeMinutes: rawTr.readingTimeMinutes,
            updatedAt: rawTr.updatedAt,
          }
        : null;

      res.json({
        workspace: publicWorkspace,
        post: publicPost,
        translation: publicTranslation,
        availableLocales: SUPPORTED_LOCALES.filter((loc) => {
          const t = found.bundle.translations[loc];
          if (!t || !t.slug || !t.title) return false;
          if (loc === 'fon' && t.translationStatus !== 'approved') return false;
          return true;
        }).map((loc) => ({ locale: loc, slug: found.bundle.translations[loc]!.slug })),
        reactions: found.bundle.reactions.filter((r) => r.enabled),
        activeReactionKeys,
        category: found.category,
        tags: found.tags,
        relatedPosts: found.relatedPosts,
      });
      } catch (err) {
        console.error('Public post API error:', err);
        res.status(500).json({ error: 'Erreur lors du chargement de l’article.' });
      }
    })
  );

  const reactionJsonSchema = z.object({
    postId: z.string().regex(PARAM_ID_REGEX),
    locale: z.enum(['fr', 'en', 'fon']),
    semanticKey: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
    idempotencyKey: z.string().regex(PARAM_ID_REGEX).optional(),
  });

  async function getPublishedPostOrNull(postId: string): Promise<Post | null> {
    if (!isValidParamId(postId)) return null;
    try {
      const snap = await getRepository().get<PublishedPostSnapshot>(`publishedPosts/${postId}`);
      if (!snap || snap.status !== 'published' || snap.post.status !== 'published') return null;
      return snap.post;
    } catch {
      return null;
    }
  }

  app.post(
    '/api/public/reactions',
    asyncHandler(async (req, res) => {
      const parsed = reactionJsonSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Requête de réaction invalide.' });
        return;
      }

      try {
        const post = await getPublishedPostOrNull(parsed.data.postId);
        if (!post) {
          res.status(404).json({ error: 'Article introuvable.' });
          return;
        }
        const ipKey = computeIpBucketKey(req);
        const localRate = publicReactionLimiter.consume(`react:${ipKey}`);
        if (!localRate.allowed) {
          res.setHeader('Retry-After', String(localRate.retryAfterSeconds));
          res.status(429).json({ error: 'Trop de réactions envoyées. Patientez un instant.' });
          return;
        }

        const distRate = await consumeDistributedRateLimit(getRepository(), `react_${ipKey}`, 60, 60_000);
        if (!distRate.allowed) {
          res.setHeader('Retry-After', String(distRate.retryAfterSeconds));
          res.status(429).json({ error: 'Trop de réactions envoyées. Patientez un instant.' });
          return;
        }

        const visitorHash = resolveExistingVisitorHash(req, post.workspaceId);
        if (!visitorHash) {
          res.status(403).json({
            error: 'Session visiteur requise. Veuillez charger la page de l’article avant de réagir.',
          });
          return;
        }

        const result = await submitPublicReaction({
          postId: parsed.data.postId,
          visitorHash,
          semanticKey: parsed.data.semanticKey,
          locale: parsed.data.locale,
          idempotencyKey: parsed.data.idempotencyKey,
        });

        if (result.status === 'conflict') {
          res.status(409).json({ error: result.message, activeKeys: result.activeKeys, reactions: result.reactions });
          return;
        }

        res.json({
          status: result.status,
          action: result.action,
          message: result.message || 'Réaction enregistrée.',
          activeKeys: result.activeKeys,
          reactions: result.reactions.filter((r) => r.enabled),
        });
      } catch (err) {
        sendRouteError(res, err, 'Impossible d’enregistrer la réaction.');
      }
    })
  );

  app.post(
    '/api/public/reactions/form',
    asyncHandler(async (req, res) => {
      const parsed = z
        .object({
          postId: z.string().regex(PARAM_ID_REGEX),
          locale: z.enum(['fr', 'en', 'fon']),
          semanticKey: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
          redirectTo: z.string().min(1).max(300),
        })
        .safeParse(req.body);

      const safeRedirect =
        parsed.success && /^\/(p\/)?(fr|en|fon)\/[a-z0-9-]+$/.test(parsed.data.redirectTo)
          ? parsed.data.redirectTo
          : '/p/fr';

      if (!parsed.success) {
        res.redirect(303, safeRedirect);
        return;
      }

      let errorQuery = '';
      try {
        const post = await getPublishedPostOrNull(parsed.data.postId);
        if (post) {
          const ipKey = computeIpBucketKey(req);
          const localRate = publicReactionLimiter.consume(`react:${ipKey}`);
          const distRate = localRate.allowed
            ? await consumeDistributedRateLimit(getRepository(), `react_${ipKey}`, 60, 60_000)
            : { allowed: false, retryAfterSeconds: localRate.retryAfterSeconds };

          if (!localRate.allowed || !distRate.allowed) {
            errorQuery = '?reaction_error=rate_limit';
          } else {
            const visitorHash = resolveExistingVisitorHash(req, post.workspaceId);
            if (!visitorHash) {
              errorQuery = '?reaction_error=session';
            } else {
              await submitPublicReaction({
                postId: parsed.data.postId,
                visitorHash,
                semanticKey: parsed.data.semanticKey,
                locale: parsed.data.locale,
              });
            }
          }
        }
      } catch (err) {
        console.error('Form reaction error:', err);
      }

      res.redirect(303, `${safeRedirect}${errorQuery}#ailea-reactions`);
    })
  );

  app.post(
    '/api/public/views',
    asyncHandler(async (req, res) => {
      const parsed = z
        .object({
          postId: z.string().regex(PARAM_ID_REGEX),
          locale: z.enum(['fr', 'en', 'fon']),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      try {
        const post = await getPublishedPostOrNull(parsed.data.postId);
        if (!post) {
          res.status(404).json({ error: 'Not found' });
          return;
        }
        const visitorHash = resolveViewVisitorHash(req, post.workspaceId);
        const ipKey = computeIpBucketKey(req);
        const rate = publicViewLimiter.consume(`view:${ipKey}:${parsed.data.postId}`);
        if (!rate.allowed) {
          res.setHeader('Retry-After', String(rate.retryAfterSeconds));
          res.status(429).json({ error: 'Trop de requêtes de vue.' });
          return;
        }
        const distViewRate = await consumeDistributedRateLimit(
          getRepository(),
          `view_${ipKey}_${parsed.data.postId}`,
          120,
          60_000
        );
        if (!distViewRate.allowed) {
          res.setHeader('Retry-After', String(distViewRate.retryAfterSeconds));
          res.status(429).json({ error: 'Trop de requêtes de vue.' });
          return;
        }
        await recordPublicView({
          postId: parsed.data.postId,
          workspaceId: post.workspaceId,
          visitorHash,
          locale: parsed.data.locale,
          referrer: sanitizeReferrerHost(req.headers.referer, resolveBaseUrl(req)),
        });
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: 'Failed to record view' });
      }
    })
  );

  // =========================================================================
  // AUTHENTICATED ADMIN STUDIO APIs (Token Verified + Server Workspace Isolation + RBAC)
  // =========================================================================
  app.use('/api/admin', requireAuth);

  // Endpoints requiring verified identity BEFORE workspace membership exists
  app.get(
    '/api/admin/workspaces',
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const memberships = await listUserWorkspaces(req.user!.uid);
        res.json({ memberships });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de lister vos espaces de travail.', 500);
      }
    })
  );

  app.post(
    '/api/admin/invites/accept',
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          workspaceId: z.string().regex(PARAM_ID_REGEX),
          token: z.string().min(16).max(256),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Paramètres d’invitation invalides.' });
        return;
      }

      try {
        const result = await acceptWorkspaceInvite({
          workspaceId: parsed.data.workspaceId,
          rawToken: parsed.data.token,
          uid: req.user!.uid,
          email: req.user!.email!,
          displayName: typeof req.user!.name === 'string' ? req.user!.name : undefined,
        });
        res.json(result);
      } catch (err) {
        sendRouteError(res, err, 'Impossible d’accepter l’invitation.', 500);
      }
    })
  );

  app.post(
    '/api/admin/bootstrap',
    asyncHandler(async (req: AuthRequest, res) => {
      const headerWs = req.headers['x-workspace-id'];
      const requestedWorkspaceId = typeof headerWs === 'string' && headerWs.trim() ? headerWs.trim() : undefined;
      if (requestedWorkspaceId && !isValidParamId(requestedWorkspaceId)) {
        res.status(400).json({ error: 'Identifiant d’espace de travail invalide.' });
        return;
      }

      const bodyParsed = z
        .object({
          createPersonalWorkspace: z.boolean().optional(),
        })
        .optional()
        .safeParse(req.body);
      if (!bodyParsed.success) {
        res.status(400).json({ error: 'Paramètres de démarrage invalides.' });
        return;
      }

      try {
        const resolved = await upsertUserAndResolveWorkspace({
          uid: req.user!.uid,
          email: req.user!.email!,
          displayName: typeof req.user!.name === 'string' ? req.user!.name : undefined,
          appBaseUrl: resolveBaseUrl(req),
          requestedWorkspaceId,
          createPersonalWorkspace: bodyParsed.data?.createPersonalWorkspace,
        });

        if (!resolved.workspace) {
          res.json({
            user: resolved.user,
            workspace: null,
            role: resolved.role,
            memberships: resolved.memberships,
            needsOnboarding: true,
            posts: [],
            presets: [],
            categories: [],
            tags: [],
            mediaAssets: [],
            members: [],
            invites: [],
          });
          return;
        }

        const workspaceId = resolved.workspace.id;
        const repo = getRepository();
        const wsFilter = [{ field: 'workspaceId', op: '==' as const, value: workspaceId }];
        const [posts, presetsRows, catsRows, tagsRows, mediaRows, memberRows, invites] = await Promise.all([
          listWorkspacePosts(workspaceId),
          repo.query<ReactionPreset>('reactionPresets', { filters: wsFilter }),
          repo.query<Category>('categories', { filters: wsFilter }),
          repo.query<Tag>('tags', { filters: wsFilter }),
          repo.query<MediaAsset>('mediaAssets', { filters: wsFilter }),
          repo.query<WorkspaceMember>(`workspaces/${workspaceId}/members`),
          resolved.role === 'owner' ? listWorkspaceInvites(workspaceId) : Promise.resolve([]),
        ]);

        res.json({
          user: resolved.user,
          workspace: resolved.workspace,
          role: resolved.role,
          memberships: resolved.memberships,
          needsOnboarding: false,
          posts,
          presets: presetsRows.map((d) => d.data).sort((a, b) => a.displayOrder - b.displayOrder),
          categories: catsRows.map((d) => d.data),
          tags: tagsRows.map((d) => d.data),
          mediaAssets: mediaRows.map((d) => d.data).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          members: sanitizeMembersForRole(
            memberRows.map((d) => d.data),
            resolved.role,
            req.user!.uid
          ),
          invites,
        });
      } catch (err) {
        sendRouteError(res, err, 'Erreur lors du chargement de l’espace.', 500);
      }
    })
  );

  // Strict membership verification required for ALL workspace-scoped admin routes below
  app.use('/api/admin', requireWorkspaceAccess);

  app.get(
    '/api/admin/posts',
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const posts = await listWorkspacePosts(req.workspaceId!);
        res.json({ posts });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de lister les articles.', 500);
      }
    })
  );

  app.get(
    '/api/admin/posts/:id',
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      try {
        const bundle = await getPostBundle(postId, req.workspaceId!, true);
        if (!bundle) {
          res.status(404).json({ error: 'Article introuvable.' });
          return;
        }
        res.json({ bundle });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de charger l’article.', 500);
      }
    })
  );

  app.post(
    '/api/admin/posts',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          title: z.string().min(1).max(200),
          primaryLocale: z.enum(['fr', 'en', 'fon']).optional(),
          markdownContent: z.string().max(200000).optional(),
          slug: z.string().max(140).optional(),
          categoryId: z.string().regex(PARAM_ID_REGEX).nullable().optional(),
          featuredImageUrl: z.string().max(512).refine((u) => isSafeAssetOrHttpUrl(u)).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Données de création invalides.' });
        return;
      }

      try {
        const bundle = await createPost({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorName: (typeof req.user!.name === 'string' && req.user!.name) || req.user!.email || 'Éditeur',
          actorEmail: req.user!.email || '',
          ...parsed.data,
        });
        res.status(201).json({ bundle });
      } catch (err) {
        sendRouteError(res, err, 'Création échouée.', 500);
      }
    })
  );

  app.post(
    '/api/admin/posts/import',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          rawMarkdown: z.string().min(1).max(250000),
          defaultLocale: z.enum(['fr', 'en', 'fon']).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Contenu Markdown invalide ou vide.' });
        return;
      }

      try {
        const result = await importMarkdownPost({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorName: (typeof req.user!.name === 'string' && req.user!.name) || req.user!.email || 'Éditeur',
          actorEmail: req.user!.email || '',
          rawMarkdown: parsed.data.rawMarkdown,
          defaultLocale: parsed.data.defaultLocale,
        });
        res.status(201).json(result);
      } catch (err) {
        sendRouteError(res, err, 'Import Markdown échoué.', 500);
      }
    })
  );

  app.get(
    '/api/admin/posts/:id/export',
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      const locale = (SUPPORTED_LOCALES.includes(req.query.locale as Locale) ? req.query.locale : 'fr') as Locale;
      try {
        const markdown = await exportPostMarkdown(postId, req.workspaceId!, locale);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="post-${sanitizeFilenameSegment(postId)}-${locale}.md"`);
        res.send(markdown);
      } catch (err) {
        sendRouteError(res, err, 'Export impossible.', 500);
      }
    })
  );

  app.patch(
    '/api/admin/posts/:id',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      const parsed = z
        .object({
          primaryLocale: z.enum(['fr', 'en', 'fon']).optional(),
          categoryId: z.string().regex(PARAM_ID_REGEX).nullable().optional(),
          tagIds: z.array(z.string().regex(PARAM_ID_REGEX)).max(20).optional(),
          featuredImageUrl: z.string().max(512).refine((u) => isSafeAssetOrHttpUrl(u)).optional(),
          reactionLimit: z.number().int().min(1).max(10).optional(),
          allowReactionChange: z.boolean().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Paramètres invalides.' });
        return;
      }

      try {
        const post = await updatePostMetadata({
          postId,
          workspaceId: req.workspaceId!,
          patch: parsed.data,
        });
        res.json({ post });
      } catch (err) {
        sendRouteError(res, err, 'Mise à jour impossible.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/posts/:id',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      try {
        await deleteWorkspacePost({
          postId,
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Suppression impossible.', 500);
      }
    })
  );

  app.put(
    '/api/admin/posts/:id/translations/:locale(fr|en|fon)',
    requireRole(['owner', 'editor', 'reviewer']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      const parsed = z
        .object({
          title: z.string().max(240),
          slug: z.string().max(140),
          excerpt: z.string().max(600).optional(),
          markdownContent: z.string().max(200000),
          translationStatus: z.enum(['missing', 'draft', 'in_review', 'approved']).optional(),
          linguisticNotes: z.string().max(2000).optional(),
          createCheckpoint: z.boolean().optional(),
          commitMessage: z.string().max(300).optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Données de traduction invalides.' });
        return;
      }

      try {
        const translation = await savePostTranslation({
          postId,
          workspaceId: req.workspaceId!,
          locale: req.params.locale as Locale,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          actorRole: req.memberRole!,
          ...parsed.data,
        });
        const bundle = await getPostBundle(postId, req.workspaceId!, true);
        res.json({ translation, bundle });
      } catch (err) {
        sendRouteError(res, err, 'Sauvegarde échouée.', 500);
      }
    })
  );

  app.post(
    '/api/admin/posts/:id/validate',
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      try {
        const bundle = await getPostBundle(postId, req.workspaceId!, true);
        if (!bundle) {
          res.status(404).json({ error: 'Article introuvable.' });
          return;
        }
        const report = validatePostForPublication(bundle);
        res.json({ report });
      } catch (err) {
        sendRouteError(res, err, 'Validation impossible.', 500);
      }
    })
  );

  app.post(
    '/api/admin/posts/:id/publish',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      try {
        const result = await publishPost({
          postId,
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json(result);
      } catch (err) {
        sendRouteError(res, err, 'Publication impossible.', 500);
      }
    })
  );

  app.post(
    '/api/admin/posts/:id/unpublish',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      try {
        const bundle = await unpublishPost({
          postId,
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json({ bundle });
      } catch (err) {
        sendRouteError(res, err, 'Dépublication impossible.', 500);
      }
    })
  );

  app.post(
    '/api/admin/posts/:id/versions/:versionNumber/restore',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      const versionNumber = Number(req.params.versionNumber);
      if (!Number.isInteger(versionNumber) || versionNumber < 1) {
        res.status(400).json({ error: 'Numéro de version invalide.' });
        return;
      }
      try {
        const bundle = await restorePostVersion({
          postId,
          workspaceId: req.workspaceId!,
          versionNumber,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json({ bundle });
      } catch (err) {
        sendRouteError(res, err, 'Restauration impossible.', 500);
      }
    })
  );

  app.put(
    '/api/admin/posts/:id/reactions',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      const parsed = z
        .object({
          reactionLimit: z.number().int().min(1).max(10),
          allowReactionChange: z.boolean(),
          reactions: z.array(
            z.object({
              semanticKey: z.string().min(1).max(64),
              emoji: z.string().min(1).max(16),
              labels: z.object({
                fr: z.string().min(1).max(60),
                en: z.string().min(1).max(60),
                fon: z.string().min(1).max(60),
              }),
              displayOrder: z.number().int().min(0).max(50),
              enabled: z.boolean(),
            })
          ),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Configuration des réactions invalide.' });
        return;
      }

      try {
        const reactions = await savePostReactionsConfig({
          postId,
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          ...parsed.data,
        });
        const bundle = await getPostBundle(postId, req.workspaceId!, true);
        res.json({ reactions, bundle });
      } catch (err) {
        sendRouteError(res, err, 'Erreur de configuration.', 500);
      }
    })
  );

  app.post(
    '/api/admin/presets',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          semanticKey: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
          emoji: z.string().min(1).max(16),
          labels: z.object({
            fr: z.string().min(1).max(60),
            en: z.string().min(1).max(60),
            fon: z.string().min(1).max(60),
          }),
          displayOrder: z.number().int().min(0).max(50),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Modèle de réaction invalide.' });
        return;
      }

      const id = `${req.workspaceId!}_${parsed.data.semanticKey}`;
      const preset: ReactionPreset = {
        id,
        workspaceId: req.workspaceId!,
        ...parsed.data,
        createdAt: new Date().toISOString(),
      };
      try {
        await getRepository().set(`reactionPresets/${id}`, preset as unknown as Record<string, unknown>);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'preset.upsert',
          entityType: 'reactionPreset',
          entityId: id,
          details: `Modèle de réaction "${parsed.data.semanticKey}" enregistré`,
        });
        res.status(201).json({ preset });
      } catch (err) {
        sendRouteError(res, err, 'Impossible d’enregistrer le modèle.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/presets/:id',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const id = String(req.params.id || '');
      if (!isValidParamId(id)) {
        res.status(400).json({ error: 'Identifiant invalide.' });
        return;
      }
      try {
        const existing = await getRepository().getWorkspaceScoped<ReactionPreset>(
          'reactionPresets',
          id,
          req.workspaceId!
        );
        if (!existing) {
          res.status(404).json({ error: 'Modèle introuvable.' });
          return;
        }
        await getRepository().delete(`reactionPresets/${id}`);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'preset.delete',
          entityType: 'reactionPreset',
          entityId: id,
          details: `Modèle de réaction "${existing.semanticKey}" supprimé`,
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Suppression impossible.', 500);
      }
    })
  );

  app.put(
    '/api/admin/posts/:id/seo/:locale(fr|en|fon)',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const postId = String(req.params.id || '');
      if (!isValidParamId(postId)) {
        res.status(400).json({ error: 'Identifiant d’article invalide.' });
        return;
      }
      const parsed = z
        .object({
          metaTitle: z.string().max(120).optional(),
          metaDescription: z.string().max(320).optional(),
          canonicalUrl: z.string().max(512).refine((u) => !u || isSafeHttpUrl(u)).optional(),
          ogTitle: z.string().max(120).optional(),
          ogDescription: z.string().max(320).optional(),
          ogImageUrl: z.string().max(512).refine((u) => isSafeAssetOrHttpUrl(u)).optional(),
          twitterCardType: z.enum(['summary', 'summary_large_image']).optional(),
          schemaType: z.enum(['BlogPosting', 'Article', 'NewsArticle']).optional(),
          noIndex: z.boolean().optional(),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Métadonnées SEO invalides.' });
        return;
      }

      try {
        const seo = await saveSeoSetting({
          postId,
          workspaceId: req.workspaceId!,
          locale: req.params.locale as Locale,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          patch: parsed.data,
        });
        const bundle = await getPostBundle(postId, req.workspaceId!, true);
        res.json({ seo, bundle });
      } catch (err) {
        sendRouteError(res, err, 'Erreur SEO.', 500);
      }
    })
  );

  app.get(
    '/api/admin/analytics',
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const rawPostId = typeof req.query.postId === 'string' && req.query.postId ? req.query.postId : undefined;
        if (rawPostId && !isValidParamId(rawPostId)) {
          res.status(400).json({ error: 'Identifiant d’article invalide.' });
          return;
        }
        const summary = await getWorkspaceAnalytics(req.workspaceId!, rawPostId);
        res.json({ summary });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de calculer les statistiques.', 500);
      }
    })
  );

  app.post(
    '/api/admin/categories',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
          names: z.object({
            fr: z.string().min(1).max(100),
            en: z.string().min(1).max(100),
            fon: z.string().min(1).max(100),
          }),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Catégorie invalide.' });
        return;
      }
      const id = `${req.workspaceId!}_${parsed.data.slug}`;
      const cat: Category = {
        id,
        workspaceId: req.workspaceId!,
        ...parsed.data,
        createdAt: new Date().toISOString(),
      };
      try {
        await getRepository().set(`categories/${id}`, cat as unknown as Record<string, unknown>);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'category.upsert',
          entityType: 'category',
          entityId: id,
          details: `Catégorie "${cat.slug}" enregistrée`,
        });
        res.status(201).json({ category: cat });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de créer la catégorie.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/categories/:id',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const id = String(req.params.id || '');
      if (!isValidParamId(id)) {
        res.status(400).json({ error: 'Identifiant invalide.' });
        return;
      }
      try {
        const existing = await getRepository().getWorkspaceScoped<Category>('categories', id, req.workspaceId!);
        if (!existing) {
          res.status(404).json({ error: 'Catégorie introuvable.' });
          return;
        }
        await getRepository().delete(`categories/${id}`);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'category.delete',
          entityType: 'category',
          entityId: id,
          details: `Catégorie "${existing.slug}" supprimée`,
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Suppression impossible.', 500);
      }
    })
  );

  app.post(
    '/api/admin/tags',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
          names: z.object({
            fr: z.string().min(1).max(100),
            en: z.string().min(1).max(100),
            fon: z.string().min(1).max(100),
          }),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Étiquette invalide.' });
        return;
      }
      const id = `${req.workspaceId!}_${parsed.data.slug}`;
      const tag: Tag = {
        id,
        workspaceId: req.workspaceId!,
        ...parsed.data,
        createdAt: new Date().toISOString(),
      };
      try {
        await getRepository().set(`tags/${id}`, tag as unknown as Record<string, unknown>);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'tag.upsert',
          entityType: 'tag',
          entityId: id,
          details: `Étiquette "${tag.slug}" enregistrée`,
        });
        res.status(201).json({ tag });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de créer l’étiquette.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/tags/:id',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const id = String(req.params.id || '');
      if (!isValidParamId(id)) {
        res.status(400).json({ error: 'Identifiant invalide.' });
        return;
      }
      try {
        const existing = await getRepository().getWorkspaceScoped<Tag>('tags', id, req.workspaceId!);
        if (!existing) {
          res.status(404).json({ error: 'Étiquette introuvable.' });
          return;
        }
        await getRepository().delete(`tags/${id}`);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'tag.delete',
          entityType: 'tag',
          entityId: id,
          details: `Étiquette "${existing.slug}" supprimée`,
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Suppression impossible.', 500);
      }
    })
  );

  app.post(
    '/api/admin/media/upload',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          filename: z.string().min(1).max(180),
          mimeType: z.string().min(1).max(80),
          base64Data: z.string().min(1),
          altText: z.object({
            fr: z.string().max(240),
            en: z.string().max(240),
            fon: z.string().max(240),
          }),
        })
        .safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: 'Fichier média invalide.' });
        return;
      }

      const base64Clean = parsed.data.base64Data.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(base64Clean, 'base64');
      const check = validateImageBuffer(parsed.data.mimeType, buffer);
      if (!check.ok) {
        res.status(400).json({ error: check.error });
        return;
      }

      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      const ext = extMap[parsed.data.mimeType] || 'png';
      const assetId = `med_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

      try {
        const safeFilename = sanitizeMediaFilename(parsed.data.filename, parsed.data.mimeType, assetId);
        const storagePath = await uploadMediaAssetToStorage({
          workspaceId: req.workspaceId!,
          assetId,
          filename: safeFilename,
          ext,
          mimeType: parsed.data.mimeType,
          buffer,
          actorId: req.user!.uid,
        });

        const asset: MediaAsset = {
          id: assetId,
          workspaceId: req.workspaceId!,
          filename: safeFilename,
          mimeType: parsed.data.mimeType,
          sizeBytes: buffer.length,
          url: `/api/media/${assetId}`,
          storagePath,
          altText: parsed.data.altText,
          uploadedBy: req.user!.uid,
          createdAt: new Date().toISOString(),
        };
        await getRepository().set(`mediaAssets/${assetId}`, asset as unknown as Record<string, unknown>);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'media.upload',
          entityType: 'mediaAsset',
          entityId: assetId,
          details: `Téléversement ${asset.filename} (${asset.sizeBytes} octets)`,
        });
        res.status(201).json({ asset });
      } catch (err) {
        sendRouteError(res, err, 'Téléversement média impossible.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/media/:id',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      const assetId = String(req.params.id || '');
      if (!isValidParamId(assetId)) {
        res.status(400).json({ error: 'Identifiant média invalide.' });
        return;
      }
      try {
        await deleteWorkspaceMediaAsset({
          assetId,
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Suppression du média impossible.', 500);
      }
    })
  );

  app.patch(
    '/api/admin/workspace',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          name: z.string().min(1).max(120).optional(),
          slug: z.string().min(1).max(120).optional(),
          brandName: z.string().min(1).max(120).optional(),
          defaultLocale: z.enum(['fr', 'en', 'fon']).optional(),
          baseUrl: z.string().max(255).refine((u) => !u || isSafeHttpUrl(u)).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Paramètres d’espace invalides.' });
        return;
      }

      try {
        const updated = await updateWorkspaceSettings({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          patch: parsed.data,
        });
        res.json({ workspace: updated });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de mettre à jour l’espace.', 500);
      }
    })
  );

  // =========================================================================
  // WORKSPACE INVITATIONS & MEMBER ROLE MANAGEMENT (OWNER ONLY)
  // =========================================================================
  app.get(
    '/api/admin/invites',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const invites = await listWorkspaceInvites(req.workspaceId!);
        res.json({ invites });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de charger les invitations.', 500);
      }
    })
  );

  app.post(
    '/api/admin/invites',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      const parsed = z
        .object({
          email: z.string().email().max(255),
          role: z.enum(['editor', 'reviewer', 'viewer']),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Adresse e-mail ou rôle invalide.' });
        return;
      }

      try {
        const created = await createWorkspaceInvite({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          email: parsed.data.email,
          role: parsed.data.role,
        });
        res.status(201).json({
          invite: created.invite,
          rawToken: created.rawToken,
        });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de créer l’invitation.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/invites/:inviteId',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      const inviteId = String(req.params.inviteId || '');
      if (!isValidParamId(inviteId)) {
        res.status(400).json({ error: 'Identifiant d’invitation invalide.' });
        return;
      }
      try {
        await revokeWorkspaceInvite({
          workspaceId: req.workspaceId!,
          inviteId,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de révoquer l’invitation.', 500);
      }
    })
  );

  app.get(
    '/api/admin/members',
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const rows = await getRepository().query<WorkspaceMember>(`workspaces/${req.workspaceId!}/members`);
        res.json({
          members: sanitizeMembersForRole(
            rows.map((r) => r.data),
            req.memberRole!,
            req.user!.uid
          ),
        });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de charger les membres.', 500);
      }
    })
  );

  app.patch(
    '/api/admin/members/:memberId',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      const memberId = String(req.params.memberId || '');
      if (!isValidParamId(memberId)) {
        res.status(400).json({ error: 'Identifiant de membre invalide.' });
        return;
      }
      const parsed = z
        .object({
          role: z.enum(['editor', 'reviewer', 'viewer']),
        })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Rôle invalide.' });
        return;
      }
      try {
        const member = await updateWorkspaceMemberRole({
          workspaceId: req.workspaceId!,
          memberId,
          role: parsed.data.role,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
        });
        res.json({ member });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de mettre à jour le rôle.', 500);
      }
    })
  );

  app.delete(
    '/api/admin/members/:memberId',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      const memberId = String(req.params.memberId || '');
      if (!isValidParamId(memberId)) {
        res.status(400).json({ error: 'Identifiant de membre invalide.' });
        return;
      }
      if (memberId === req.user!.uid) {
        res.status(400).json({ error: 'Impossible de retirer le propriétaire principal.' });
        return;
      }
      try {
        const repo = getRepository();
        const ws = await repo.get<Workspace>(`workspaces/${req.workspaceId!}`);
        if (ws && ws.ownerId === memberId) {
          res.status(400).json({ error: 'Impossible de retirer le propriétaire principal.' });
          return;
        }
        const memberPath = `workspaces/${req.workspaceId!}/members/${memberId}`;
        const existingMember = await repo.get<WorkspaceMember>(memberPath);
        if (!existingMember || existingMember.workspaceId !== req.workspaceId!) {
          res.status(404).json({ error: 'Membre introuvable.' });
          return;
        }
        await repo.delete(memberPath);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'member.removed',
          entityType: 'workspaceMember',
          entityId: memberId,
          details: `Membre ${memberId} retiré de l’espace`,
        });
        res.json({ ok: true });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de retirer ce membre.', 500);
      }
    })
  );

  app.get(
    '/api/admin/backup/export',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const backup = await exportWorkspaceBackup(req.workspaceId!);
        await logAudit({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          action: 'workspace.export_backup',
          entityType: 'workspace',
          entityId: req.workspaceId!,
          details: 'Export complet de sauvegarde JSON',
        });
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="ailea-backup-${sanitizeFilenameSegment(req.workspaceId!)}.json"`
        );
        res.send(JSON.stringify(backup, null, 2));
      } catch (err) {
        sendRouteError(res, err, 'Export de sauvegarde échoué.', 500);
      }
    })
  );

  app.post(
    '/api/admin/backup/restore',
    requireRole(['owner']),
    asyncHandler(async (req: AuthRequest, res) => {
      if (!req.body || typeof req.body !== 'object') {
        res.status(400).json({ error: 'Fichier JSON de sauvegarde invalide.' });
        return;
      }
      try {
        const result = await restoreWorkspaceBackup({
          workspaceId: req.workspaceId!,
          actorId: req.user!.uid,
          actorEmail: req.user!.email || '',
          backup: req.body as Record<string, unknown>,
        });
        res.json(result);
      } catch (err) {
        sendRouteError(res, err, 'Restauration échouée.', 500);
      }
    })
  );

  app.get(
    '/api/admin/audit-logs',
    requireRole(['owner', 'editor']),
    asyncHandler(async (req: AuthRequest, res) => {
      try {
        const rows = await getRepository().query<AuditLog>('auditLogs', {
          filters: [{ field: 'workspaceId', op: '==', value: req.workspaceId! }],
        });
        const logs = rows
          .map((d) => d.data)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 100);
        res.json({ logs });
      } catch (err) {
        sendRouteError(res, err, 'Impossible de charger les journaux d’audit.', 500);
      }
    })
  );

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint introuvable.' });
  });

  // Centralized Express error boundary (catches malformed JSON payloads & unhandled async errors)
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Corps JSON malformé.' });
      return;
    }
    if (err instanceof RepositoryError) {
      const safeMsg = err.code === 'INTERNAL' ? 'Erreur interne du serveur.' : err.message;
      res.status(err.httpStatus).json({ error: safeMsg });
      return;
    }
    console.error(`Unhandled Express error on ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMainModule) {
  createApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`AILEA PostManager listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start AILEA PostManager server:', err);
      process.exit(1);
    });
}
