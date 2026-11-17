import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import {
  BLOCKED_PRODUCTION_PROJECT_ID,
  assertLocalEmulatorEnvironment,
} from '../src/server/emulatorGuard.ts';
import { setRepository } from '../src/server/firestoreRepo.ts';
import { LocalFileRepository } from '../src/server/localFallbackRepo.ts';
import { RepositoryError } from '../src/server/repository.ts';
import {
  SlidingWindowRateLimiter,
  consumeDistributedRateLimit,
  issueSignedVisitorToken,
  verifySignedVisitorToken,
} from '../src/server/security.ts';
import {
  acceptWorkspaceInvite,
  assertValidWorkspaceMediaStoragePath,
  cleanupExpiredEphemeralRecords,
  createPost,
  createWorkspaceInvite,
  deleteWorkspaceMediaAsset,
  deleteWorkspacePost,
  getPostBundle,
  getPublishedPostByLocaleSlug,
  listWorkspaceInvites,
  publishPost,
  recordPublicView,
  restoreWorkspaceBackup,
  revokeWorkspaceInvite,
  savePostReactionsConfig,
  savePostTranslation,
  submitPublicReaction,
  unpublishPost,
  updateWorkspaceSettings,
  uploadMediaAssetToStorage,
  upsertUserAndResolveWorkspace,
} from '../src/server/store.ts';
import { renderNotFoundHtml, renderPublicIndexHtml, renderPublicPostHtml } from '../src/server/ssr.ts';
import { Category, FullPostBundle, MediaAsset, Workspace } from '../src/shared/types.ts';

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of keys) out[k] = process.env[k];
  return out;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const app = await createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('Phase 1 Remediation — Emulator Guard & Crypto/Anti-Abuse Controls', () => {
  it('enforces Storage emulator + local loopback + demo project ID (AUDIT-014)', () => {
    const envKeys = [
      'USE_FIREBASE_EMULATOR',
      'FIREBASE_PROJECT_ID',
      'GCLOUD_PROJECT',
      'FIRESTORE_EMULATOR_HOST',
      'FIREBASE_AUTH_EMULATOR_HOST',
      'FIREBASE_STORAGE_EMULATOR_HOST',
      'STORAGE_EMULATOR_HOST',
    ];
    const saved = snapshotEnv(envKeys);
    try {
      process.env.USE_FIREBASE_EMULATOR = 'true';
      process.env.FIREBASE_PROJECT_ID = 'demo-ailea-postmanager-local';
      process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
      process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
      delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      delete process.env.STORAGE_EMULATOR_HOST;

      expect(() => assertLocalEmulatorEnvironment()).toThrow(/FIREBASE_STORAGE_EMULATOR_HOST/);

      process.env.FIREBASE_STORAGE_EMULATOR_HOST = '10.0.0.5:9199';
      expect(() => assertLocalEmulatorEnvironment()).toThrow(/127\.0\.0\.1, localhost, or \[::1\]/);

      process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
      process.env.FIREBASE_PROJECT_ID = BLOCKED_PRODUCTION_PROJECT_ID;
      expect(() => assertLocalEmulatorEnvironment()).toThrow(/non-demo project ID/);

      process.env.FIREBASE_PROJECT_ID = 'demo-ailea-postmanager-local';
      const status = assertLocalEmulatorEnvironment();
      expect(status.storageEmulatorHost).toBe('127.0.0.1:9199');
    } finally {
      restoreEnv(saved);
    }
  });

  it('signs visitor cookies with expiry and rejects tampered or expired tokens (AUDIT-007)', () => {
    const now = 1_700_000_000_000;
    const token = issueSignedVisitorToken(now);
    const verified = verifySignedVisitorToken(token, now + 60_000);
    expect(verified).toMatch(/^[a-f0-9]{32}$/);

    // Tampered signature
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${'0'.repeat(32)}`;
    expect(verifySignedVisitorToken(tampered, now + 60_000)).toBeNull();

    // Expired after > 180 days
    const after181Days = now + 181 * 24 * 60 * 60 * 1000;
    expect(verifySignedVisitorToken(token, after181Days)).toBeNull();
  });

  it('preserves throttled rate-limit entries under high-cardinality eviction (AUDIT-008)', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000, 5);
    expect(limiter.consume('attacker').allowed).toBe(true);
    expect(limiter.consume('attacker').allowed).toBe(true);
    expect(limiter.consume('attacker').allowed).toBe(false);

    // Flood distinct unthrottled keys past maxEntries=5
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.consume(`noise_${i}`).allowed).toBe(true);
    }
    expect(limiter.consume('attacker').allowed).toBe(false);
  });
});

describe('Phase 1 Remediation — Repository, HTTP, Media, Invites & Backup Regressions', () => {
  let tmpDir = '';
  const createdLocalMediaFiles: string[] = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailea-remed-'));
    const storeFile = path.join(tmpDir, 'store.json');
    setRepository(new LocalFileRepository(storeFile));
  });

  afterEach(async () => {
    for (const filePath of createdLocalMediaFiles.splice(0)) {
      await fs.rm(filePath, { force: true }).catch(() => {});
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('requires explicit onboarding when createPersonalWorkspace=false and locks slugs globally (AUDIT-011 / AUDIT-015)', async () => {
    const pending = await upsertUserAndResolveWorkspace({
      uid: 'u_new_1',
      email: 'new1@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: false,
    });
    expect(pending.needsOnboarding).toBe(true);
    expect(pending.workspace).toBeNull();

    const first = await upsertUserAndResolveWorkspace({
      uid: 'u_new_1',
      email: 'new1@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const second = await upsertUserAndResolveWorkspace({
      uid: 'u_new_2',
      email: 'new2@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });

    await updateWorkspaceSettings({
      workspaceId: first.workspace!.id,
      actorId: 'u_new_1',
      actorEmail: 'new1@ailea.test',
      patch: { slug: 'unique-revue-slug' },
    });

    await expect(
      updateWorkspaceSettings({
        workspaceId: second.workspace!.id,
        actorId: 'u_new_2',
        actorEmail: 'new2@ailea.test',
        patch: { slug: 'unique-revue-slug' },
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 });

    // Releasing old slug allows reuse
    await updateWorkspaceSettings({
      workspaceId: first.workspace!.id,
      actorId: 'u_new_1',
      actorEmail: 'new1@ailea.test',
      patch: { slug: 'renamed-revue-slug' },
    });
    const updatedSecond = await updateWorkspaceSettings({
      workspaceId: second.workspace!.id,
      actorId: 'u_new_2',
      actorEmail: 'new2@ailea.test',
      patch: { slug: 'unique-revue-slug' },
    });
    expect(updatedSecond.slug).toBe('unique-revue-slug');
  });

  it('protects invite tokenHash, revokes by opaque invite.id, and frees inviteLocks on redemption (AUDIT-012 / AUDIT-013)', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_owner',
      email: 'owner@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsId = ownerRes.workspace!.id;

    const created = await createWorkspaceInvite({
      workspaceId: wsId,
      actorId: 'u_owner',
      actorEmail: 'owner@ailea.test',
      email: 'Collab@Ailea.Test',
      role: 'editor',
    });
    expect(created.invite.id).toMatch(/^inv_/);
    expect(created.invite.tokenHash).toBeUndefined();

    const listed = await listWorkspaceInvites(wsId);
    expect(listed.length).toBe(1);
    expect(listed[0].tokenHash).toBeUndefined();

    // Duplicate pending invite blocked by inviteLocks
    await expect(
      createWorkspaceInvite({
        workspaceId: wsId,
        actorId: 'u_owner',
        actorEmail: 'owner@ailea.test',
        email: 'collab@ailea.test',
        role: 'reviewer',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // Revoke by opaque invite ID (not tokenHash)
    await revokeWorkspaceInvite({
      workspaceId: wsId,
      inviteId: created.invite.id,
      actorId: 'u_owner',
      actorEmail: 'owner@ailea.test',
    });

    // After revocation, new invite can be created and redeemed
    const reissued = await createWorkspaceInvite({
      workspaceId: wsId,
      actorId: 'u_owner',
      actorEmail: 'owner@ailea.test',
      email: 'collab@ailea.test',
      role: 'reviewer',
    });
    const redeemed = await acceptWorkspaceInvite({
      workspaceId: wsId,
      rawToken: reissued.rawToken,
      uid: 'u_collab',
      email: 'collab@ailea.test',
      displayName: 'Collab',
    });
    expect(redeemed.role).toBe('reviewer');
    expect(redeemed.invite.tokenHash).toBeUndefined();
  });

  it('isolates draft reaction changes from live published posts, enforces cookie-bound reactions, and handles malformed JSON (AUDIT-005 / AUDIT-006 / AUDIT-007)', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_pub_owner',
      email: 'pubowner@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    const postBundle = await createPost({
      workspaceId: ws.id,
      actorId: 'u_pub_owner',
      actorName: 'Owner',
      actorEmail: 'pubowner@ailea.test',
      title: 'Article Live Snapshot',
      primaryLocale: 'fr',
      markdownContent: 'Contenu editorial complet pour la lecture publique.',
      slug: 'article-live-snapshot',
    });
    const postId = postBundle.post.id;
    await savePostTranslation({
      postId,
      workspaceId: ws.id,
      locale: 'fr',
      actorId: 'u_pub_owner',
      actorEmail: 'pubowner@ailea.test',
      actorRole: 'owner',
      title: 'Article Live Snapshot',
      slug: 'article-live-snapshot',
      markdownContent: 'Contenu editorial complet pour la lecture publique.',
      translationStatus: 'approved',
    });
    await publishPost({
      postId,
      workspaceId: ws.id,
      actorId: 'u_pub_owner',
      actorEmail: 'pubowner@ailea.test',
    });

    // Mutate draft reactions while post is published: remove 'curiosity' in draft and add 'insightful' in draft
    await savePostReactionsConfig({
      postId,
      workspaceId: ws.id,
      actorId: 'u_pub_owner',
      actorEmail: 'pubowner@ailea.test',
      reactionLimit: 1,
      allowReactionChange: true,
      reactions: [
        {
          semanticKey: 'affection',
          emoji: '❤️',
          labels: { fr: 'Affection', en: 'Affection', fon: 'Wǎn-yíyí' },
          displayOrder: 0,
          enabled: true,
        },
        {
          semanticKey: 'insightful',
          emoji: '💡',
          labels: { fr: 'Éclairant', en: 'Insightful', fon: 'Nǔ-nyɔ́' },
          displayOrder: 1,
          enabled: true,
        },
      ],
    });

    // Draft bundle sees 'insightful' and hides draftRemoved 'curiosity'
    const draftBundle = await getPostBundle(postId, ws.id, true);
    expect(draftBundle!.reactions.map((r) => r.semanticKey)).toEqual(['affection', 'insightful']);

    // Live public route MUST still expose published snapshot keys ('curiosity', 'affection', 'anticipation')
    const liveData = await getPublishedPostByLocaleSlug('fr', 'article-live-snapshot');
    expect(liveData!.bundle.reactions.map((r) => r.semanticKey)).toEqual([
      'curiosity',
      'affection',
      'anticipation',
    ]);

    // Public reaction against draft-only key MUST be rejected
    await expect(
      submitPublicReaction({
        postId,
        visitorHash: 'visitor_hash_demo_1',
        semanticKey: 'insightful',
        locale: 'fr',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Removed-in-draft reaction ('curiosity') remains votable on live published snapshot until republish
    const liveVote = await submitPublicReaction({
      postId,
      visitorHash: 'visitor_hash_demo_1',
      semanticKey: 'curiosity',
      locale: 'fr',
    });
    expect(liveVote.status).toBe('ok');
    expect(liveVote.reactions.find((r) => r.semanticKey === 'curiosity')?.count).toBe(1);

    // HTTP checks: malformed JSON -> 400; missing/tampered cookie on reaction POST -> 403; GET /p/fr/:slug issues cookie
    const srv = await startTestServer();
    try {
      const badJsonRes = await fetch(`${srv.baseUrl}/api/public/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid-json',
      });
      expect(badJsonRes.status).toBe(400);
      const badJsonBody = (await badJsonRes.json()) as { error: string };
      expect(badJsonBody.error).toContain('malformé');

      const noCookieReact = await fetch(`${srv.baseUrl}/api/public/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, locale: 'fr', semanticKey: 'affection' }),
      });
      expect(noCookieReact.status).toBe(403);
      expect(noCookieReact.headers.get('set-cookie')).toBeNull();

      const formNoCookie = await fetch(`${srv.baseUrl}/api/public/reactions/form`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          postId,
          locale: 'fr',
          semanticKey: 'affection',
          redirectTo: '/p/fr/article-live-snapshot',
        }),
      });
      expect(formNoCookie.status).toBe(303);
      expect(formNoCookie.headers.get('location')).toContain('?reaction_error=session#ailea-reactions');
      expect(formNoCookie.headers.get('set-cookie')).toBeNull();

      const pageRes = await fetch(`${srv.baseUrl}/p/fr/article-live-snapshot`);
      expect(pageRes.status).toBe(200);
      const setCookie = pageRes.headers.get('set-cookie') || '';
      const vidMatch = setCookie.match(/ailea_vid=([^;]+)/);
      expect(vidMatch).not.toBeNull();

      const validReact = await fetch(`${srv.baseUrl}/api/public/reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `ailea_vid=${vidMatch![1]}`,
        },
        body: JSON.stringify({ postId, locale: 'fr', semanticKey: 'affection' }),
      });
      expect(validReact.status).toBe(200);
      const reactJson = (await validReact.json()) as { status: string; activeKeys: string[] };
      expect(reactJson.status).toBe('ok');
      expect(reactJson.activeKeys).toContain('affection');
    } finally {
      await srv.close();
    }
  });

  it('rejects storage path traversal, gates draft media auth, blocks deleting live media, and frees after unpublish (AUDIT-001 / AUDIT-002 / AUDIT-005)', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_med_owner',
      email: 'med@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    expect(() =>
      assertValidWorkspaceMediaStoragePath('../etc/passwd', ws.id, 'med_1')
    ).toThrow(RepositoryError);
    expect(() =>
      assertValidWorkspaceMediaStoragePath(`workspaces/other_ws/media/med_1.png`, ws.id, 'med_1')
    ).toThrow(RepositoryError);

    const assetId = `med_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const storagePath = await uploadMediaAssetToStorage({
      workspaceId: ws.id,
      assetId,
      ext: 'png',
      mimeType: 'image/png',
      buffer: VALID_PNG_BYTES,
    });
    createdLocalMediaFiles.push(path.resolve(process.cwd(), '.data/media', storagePath));

    const asset: MediaAsset = {
      id: assetId,
      workspaceId: ws.id,
      filename: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG_BYTES.length,
      url: `/api/media/${assetId}`,
      storagePath,
      altText: { fr: 'Cover', en: 'Cover', fon: 'Cover' },
      uploadedBy: 'u_med_owner',
      createdAt: new Date().toISOString(),
    };
    const { getRepository } = await import('../src/server/firestoreRepo.ts');
    await getRepository().set(`mediaAssets/${assetId}`, asset as unknown as Record<string, unknown>);

    const srv = await startTestServer();
    try {
      // Unreferenced draft media is private -> 401 anonymously
      const unauthDraftMedia = await fetch(`${srv.baseUrl}/api/media/${assetId}`);
      expect(unauthDraftMedia.status).toBe(401);

      // Attach to post and publish
      const bundle = await createPost({
        workspaceId: ws.id,
        actorId: 'u_med_owner',
        actorName: 'Owner',
        actorEmail: 'med@ailea.test',
        title: 'Post Avec Media',
        primaryLocale: 'fr',
        markdownContent: `Texte ![img](/api/media/${assetId})`,
        slug: 'post-avec-media',
        featuredImageUrl: `/api/media/${assetId}`,
      });
      await publishPost({
        postId: bundle.post.id,
        workspaceId: ws.id,
        actorId: 'u_med_owner',
        actorEmail: 'med@ailea.test',
      });

      // Public media now streams cleanly with Cache-Control + nosniff
      const pubMedia = await fetch(`${srv.baseUrl}/api/media/${assetId}`);
      expect(pubMedia.status).toBe(200);
      expect(pubMedia.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
      expect(pubMedia.headers.get('x-content-type-options')).toBe('nosniff');

      // Deleting referenced live media returns 409 CONFLICT
      await expect(
        deleteWorkspaceMediaAsset({
          assetId,
          workspaceId: ws.id,
          actorId: 'u_med_owner',
          actorEmail: 'med@ailea.test',
        })
      ).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 });

      // Unpublish -> anonymous access revoked (401) and media deletion succeeds
      await unpublishPost({
        postId: bundle.post.id,
        workspaceId: ws.id,
        actorId: 'u_med_owner',
        actorEmail: 'med@ailea.test',
      });
      const afterUnpubMedia = await fetch(`${srv.baseUrl}/api/media/${assetId}`);
      expect(afterUnpubMedia.status).toBe(401);

      await deleteWorkspaceMediaAsset({
        assetId,
        workspaceId: ws.id,
        actorId: 'u_med_owner',
        actorEmail: 'med@ailea.test',
      });
      const checkMissing = await getRepository().get(`mediaAssets/${assetId}`);
      expect(checkMissing).toBeNull();
    } finally {
      await srv.close();
    }
  });

  it('validates strict backup restore schemas, cleans up expired ephemeral records, and cascades post deletes (AUDIT-009 / AUDIT-010)', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_bk_owner',
      email: 'bk@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    const { getRepository } = await import('../src/server/firestoreRepo.ts');
    const repo = getRepository();

    // Seed foreign workspace category to test cross-workspace ref rejection
    const foreignCat: Category = {
      id: 'cat_foreign_ws',
      workspaceId: 'ws_foreign_other',
      slug: 'foreign',
      names: { fr: 'Foreign', en: 'Foreign', fon: 'Foreign' },
      createdAt: new Date().toISOString(),
    };
    await repo.set(`categories/${foreignCat.id}`, foreignCat as unknown as Record<string, unknown>);

    // Unknown envelope property rejected (.strict())
    await expect(
      restoreWorkspaceBackup({
        workspaceId: ws.id,
        actorId: 'u_bk_owner',
        actorEmail: 'bk@ailea.test',
        backup: { unexpectedRootField: true },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    // Cross-workspace category reference rejected
    await expect(
      restoreWorkspaceBackup({
        workspaceId: ws.id,
        actorId: 'u_bk_owner',
        actorEmail: 'bk@ailea.test',
        backup: {
          posts: [
            {
              id: 'post_bk_badcat',
              primaryLocale: 'fr',
              categoryId: 'cat_foreign_ws',
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // Unsafe URL rejected
    await expect(
      restoreWorkspaceBackup({
        workspaceId: ws.id,
        actorId: 'u_bk_owner',
        actorEmail: 'bk@ailea.test',
        backup: {
          posts: [
            {
              id: 'post_bk_xss',
              primaryLocale: 'fr',
              featuredImageUrl: 'javascript:alert(1)',
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    // Valid atomic restore forces draft status & creates slugLocks
    const restored = await restoreWorkspaceBackup({
      workspaceId: ws.id,
      actorId: 'u_bk_owner',
      actorEmail: 'bk@ailea.test',
      backup: {
        posts: [
          {
            id: 'post_bk_ok',
            primaryLocale: 'fr',
            status: 'published',
          },
        ],
        postTranslations: [
          {
            id: 'post_bk_ok_fr',
            postId: 'post_bk_ok',
            locale: 'fr',
            title: 'Restored Title',
            slug: 'restored-slug-ok',
            markdownContent: 'Hello restored body',
          },
        ],
      },
    });
    expect(restored.restoredCount).toBe(2);
    const restoredPost = await getPostBundle('post_bk_ok', ws.id, true);
    expect(restoredPost!.post.status).toBe('draft');
    expect(await repo.get('slugLocks/fr_restored-slug-ok')).not.toBeNull();

    // Record view & cleanup expired ephemeral records
    await recordPublicView({
      postId: 'post_bk_ok',
      workspaceId: ws.id,
      visitorHash: 'v_cleanup_1',
      locale: 'fr',
      referrer: 'Direct',
    });
    await repo.set('rateLimitBuckets/expired_bucket', {
      key: 'expired_bucket',
      count: 1,
      windowStartMs: 1,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    await repo.set('rateLimitBuckets/fresh_bucket', {
      key: 'fresh_bucket',
      count: 1,
      windowStartMs: Date.now(),
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    await repo.set('reactionIdempotency/expired_idem', {
      postId: 'post_bk_ok',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const cleanedCount = await cleanupExpiredEphemeralRecords('2026-01-01T00:00:00.000Z');
    expect(cleanedCount).toBe(2);
    expect(await repo.get('rateLimitBuckets/expired_bucket')).toBeNull();
    expect(await repo.get('reactionIdempotency/expired_idem')).toBeNull();
    expect(await repo.get('rateLimitBuckets/fresh_bucket')).not.toBeNull();

    // Cascade post deletion cleans translations, slugLocks, and views
    await deleteWorkspacePost({
      postId: 'post_bk_ok',
      workspaceId: ws.id,
      actorId: 'u_bk_owner',
      actorEmail: 'bk@ailea.test',
    });
    expect(await repo.get('posts/post_bk_ok')).toBeNull();
    expect(await repo.get('postTranslations/post_bk_ok_fr')).toBeNull();
    expect(await repo.get('slugLocks/fr_restored-slug-ok')).toBeNull();

    // Atomic rollback on partial backup failure: valid category + colliding post leaves zero restored docs
    await repo.set('posts/post_collision_foreign', {
      id: 'post_collision_foreign',
      workspaceId: 'ws_foreign_other',
    });
    await expect(
      restoreWorkspaceBackup({
        workspaceId: ws.id,
        actorId: 'u_bk_owner',
        actorEmail: 'bk@ailea.test',
        backup: {
          categories: [
            {
              id: 'cat_atomic_rollback_test',
              slug: 'atomic-rollback',
              names: { fr: 'Rollback', en: 'Rollback', fon: 'Rollback' },
            },
          ],
          posts: [
            {
              id: 'post_collision_foreign',
              primaryLocale: 'fr',
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(await repo.get('categories/cat_atomic_rollback_test')).toBeNull();
  });

  it('enforces cross-workspace media delete rejection, concurrent invite creation lock, concurrent reaction count preservation, and cross-instance rate limits (Phase 1.5 Adversarial)', async () => {
    const ownerA = await upsertUserAndResolveWorkspace({
      uid: 'u_adv_a',
      email: 'adva@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ownerB = await upsertUserAndResolveWorkspace({
      uid: 'u_adv_b',
      email: 'advb@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsA = ownerA.workspace!;
    const wsB = ownerB.workspace!;
    const { getRepository } = await import('../src/server/firestoreRepo.ts');
    const repo = getRepository();

    // 1. Workspace B attempting to delete Workspace A's draft media -> 403 PERMISSION_DENIED & asset preserved
    const assetId = `med_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const storagePath = await uploadMediaAssetToStorage({
      workspaceId: wsA.id,
      assetId,
      ext: 'png',
      mimeType: 'image/png',
      buffer: VALID_PNG_BYTES,
    });
    createdLocalMediaFiles.push(path.resolve(process.cwd(), '.data/media', storagePath));
    await repo.set(`mediaAssets/${assetId}`, {
      id: assetId,
      workspaceId: wsA.id,
      filename: 'secret.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG_BYTES.length,
      url: `/api/media/${assetId}`,
      storagePath,
      altText: { fr: 'S', en: 'S', fon: 'S' },
      uploadedBy: 'u_adv_a',
      createdAt: new Date().toISOString(),
    });
    await expect(
      deleteWorkspaceMediaAsset({
        assetId,
        workspaceId: wsB.id,
        actorId: 'u_adv_b',
        actorEmail: 'advb@ailea.test',
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
    expect(await repo.get(`mediaAssets/${assetId}`)).not.toBeNull();

    // 2. Concurrent invitation creation for same email -> strictly 1 created, 1 CONFLICT
    const inviteRace = await Promise.allSettled([
      createWorkspaceInvite({
        workspaceId: wsA.id,
        actorId: 'u_adv_a',
        actorEmail: 'adva@ailea.test',
        email: 'race@ailea.test',
        role: 'editor',
      }),
      createWorkspaceInvite({
        workspaceId: wsA.id,
        actorId: 'u_adv_a',
        actorEmail: 'adva@ailea.test',
        email: 'RACE@ailea.test',
        role: 'reviewer',
      }),
    ]);
    expect(inviteRace.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(inviteRace.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // 3. Concurrent reaction submission & reaction configuration update preserve live reaction counts
    const postBundle = await createPost({
      workspaceId: wsA.id,
      actorId: 'u_adv_a',
      actorName: 'Owner A',
      actorEmail: 'adva@ailea.test',
      title: 'Post Concurrency',
      primaryLocale: 'fr',
      markdownContent: 'Contenu test concurrence réactions',
      slug: 'post-concurrency-reactions',
    });
    await publishPost({
      postId: postBundle.post.id,
      workspaceId: wsA.id,
      actorId: 'u_adv_a',
      actorEmail: 'adva@ailea.test',
    });
    const [vote1, vote2, configRes] = await Promise.all([
      submitPublicReaction({
        postId: postBundle.post.id,
        visitorHash: 'visitor_conc_1',
        semanticKey: 'curiosity',
        locale: 'fr',
      }),
      submitPublicReaction({
        postId: postBundle.post.id,
        visitorHash: 'visitor_conc_2',
        semanticKey: 'curiosity',
        locale: 'fr',
      }),
      savePostReactionsConfig({
        postId: postBundle.post.id,
        workspaceId: wsA.id,
        actorId: 'u_adv_a',
        actorEmail: 'adva@ailea.test',
        reactionLimit: 1,
        allowReactionChange: true,
        reactions: [
          {
            semanticKey: 'curiosity',
            emoji: '👀',
            labels: { fr: 'Curiosité (Brouillon)', en: 'Curiosity', fon: 'Nǔ-ba-kpɔ́n' },
            displayOrder: 0,
            enabled: true,
          },
        ],
      }),
    ]);
    expect(vote1.status).toBe('ok');
    expect(vote2.status).toBe('ok');
    expect(configRes.length).toBe(1);
    const persistedReaction = await repo.get<{ count: number }>(`postReactions/${postBundle.post.id}_curiosity`);
    expect(persistedReaction?.count).toBe(2);

    // 4. Cross-instance distributed rate-limit exhaustion across separate in-memory limiters
    const instanceLimiter1 = new SlidingWindowRateLimiter(50, 60_000);
    const instanceLimiter2 = new SlidingWindowRateLimiter(50, 60_000);
    const distBucket = `shared_ip_bucket_${Date.now()}`;
    expect(instanceLimiter1.consume('ip_1').allowed).toBe(true);
    expect((await consumeDistributedRateLimit(repo, distBucket, 2, 60_000)).allowed).toBe(true);
    expect(instanceLimiter2.consume('ip_1').allowed).toBe(true);
    expect((await consumeDistributedRateLimit(repo, distBucket, 2, 60_000)).allowed).toBe(true);
    const exhausted = await consumeDistributedRateLimit(repo, distBucket, 2, 60_000);
    expect(exhausted.allowed).toBe(false);
    expect(exhausted.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('renders unified minimal public header and 96%-height No-JS bottom sheet across post, index, and 404 SSR views', () => {
    const ws1: Workspace = {
      id: 'ws_ssr_1',
      name: 'Revue AILEA',
      slug: 'revue-ailea',
      brandName: 'Revue AILEA',
      ownerId: 'u_1',
      baseUrl: 'https://ailea.example',
      defaultLocale: 'fr',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const ws2: Workspace = {
      ...ws1,
      id: 'ws_ssr_2',
      name: 'Revue Bénin',
      slug: 'revue-benin',
      brandName: 'Revue Bénin',
    };
    const bundle: FullPostBundle = {
      post: {
        id: 'post_ssr_1',
        workspaceId: ws1.id,
        primaryLocale: 'fr',
        status: 'published',
        publishedAt: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        authorId: 'u_1',
        authorName: 'Auteur Test',
        featuredImageUrl: '',
        categoryId: null,
        tagIds: [],
        reactionLimit: 1,
        allowReactionChange: true,
        currentVersionNumber: 1,
        publishedVersionNumber: 1,
      },
      translations: {
        fr: {
          id: 'post_ssr_1_fr',
          postId: 'post_ssr_1',
          workspaceId: ws1.id,
          locale: 'fr',
          title: 'Titre SSR Public',
          slug: 'titre-ssr-public',
          markdownContent: 'Contenu test',
          sanitizedHtml: '<p>Contenu test</p>',
          excerpt: 'Contenu test',
          frontmatterJson: {},
          translationStatus: 'approved',
          wordCount: 2,
          readingTimeMinutes: 1,
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        en: {
          id: 'post_ssr_1_en',
          postId: 'post_ssr_1',
          workspaceId: ws1.id,
          locale: 'en',
          title: 'Public SSR Title',
          slug: 'public-ssr-title',
          markdownContent: 'Test content',
          sanitizedHtml: '<p>Test content</p>',
          excerpt: 'Test content',
          frontmatterJson: {},
          translationStatus: 'approved',
          wordCount: 2,
          readingTimeMinutes: 1,
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        fon: {
          id: 'post_ssr_1_fon',
          postId: 'post_ssr_1',
          workspaceId: ws1.id,
          locale: 'fon',
          title: 'Xówlǎn SSR',
          slug: 'xowlan-ssr',
          markdownContent: 'Wéma test',
          sanitizedHtml: '<p>Wéma test</p>',
          excerpt: 'Wéma test',
          frontmatterJson: {},
          translationStatus: 'approved',
          wordCount: 2,
          readingTimeMinutes: 1,
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      },
      seo: { fr: null, en: null, fon: null },
      reactions: [],
      versions: [],
      publishingEvents: [],
    };

    const postHtml = renderPublicPostHtml({
      baseUrl: 'https://ailea.example',
      workspace: ws1,
      bundle,
      locale: 'fr',
      category: null,
      activeReactionKeys: [],
      relatedPosts: [],
    });
    expect(postHtml).toContain('id="ailea-menu-trigger"');
    expect(postHtml).toContain('id="ailea-sheet-toggle"');
    expect(postHtml).toContain('id="ailea-public-sheet"');
    expect(postHtml).toContain('height: 96dvh;');
    expect(postHtml).toContain('hreflang="en"');
    expect(postHtml).not.toContain('hreflang="fon"');

    const multiWsIndexHtml = renderPublicIndexHtml({
      baseUrl: 'https://ailea.example',
      locale: 'fon',
      items: [
        { post: bundle.post, translation: bundle.translations.fon!, workspace: ws1, reactions: [] },
        { post: { ...bundle.post, id: 'post_ssr_2', workspaceId: ws2.id }, translation: bundle.translations.fon!, workspace: ws2, reactions: [] },
      ],
    });
    expect(multiWsIndexHtml).toContain('>AILEA Revue</a>');
    expect(multiWsIndexHtml).toContain('id="ailea-public-sheet"');
    expect(multiWsIndexHtml).not.toContain('hreflang="fon"');

    const notFoundHtml = renderNotFoundHtml('en', 'https://ailea.example');
    expect(notFoundHtml).toContain('class="topbar"');
    expect(notFoundHtml).toContain('id="ailea-menu-trigger"');
    expect(notFoundHtml).toContain('id="ailea-public-sheet"');
    expect(notFoundHtml).toContain('hreflang="fr"');
    expect(notFoundHtml).not.toContain('hreflang="fon"');
  });
});
