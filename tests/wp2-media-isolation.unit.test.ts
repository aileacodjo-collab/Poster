import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';

const TEST_TOKENS: Record<string, DecodedIdToken> = {
  'token-wp2-owner-a': {
    uid: 'u_wp2_owner_a',
    email: 'wp2.ownera@ailea.test',
    email_verified: true,
    name: 'WP2 Owner A',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_wp2_owner_a',
  },
  'token-wp2-owner-b': {
    uid: 'u_wp2_owner_b',
    email: 'wp2.ownerb@ailea.test',
    email_verified: true,
    name: 'WP2 Owner B',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_wp2_owner_b',
  },
  'token-wp2-outsider': {
    uid: 'u_wp2_outsider',
    email: 'wp2.outsider@ailea.test',
    email_verified: true,
    name: 'WP2 Outsider',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_wp2_outsider',
  },
};

// Offline Auth ID-token verifier stub ONLY for Express authorization regression testing.
vi.mock('../src/server/firebaseAdmin.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/server/firebaseAdmin.ts')>();
  return {
    ...original,
    getAdminAuth: () => ({
      verifyIdToken: async (token: string) => {
        const decoded = TEST_TOKENS[token];
        if (!decoded) {
          const err = new Error('Invalid test token') as Error & { code?: string };
          err.code = 'auth/id-token-expired';
          throw err;
        }
        return decoded;
      },
    }),
  };
});

import { createApp } from '../server.ts';
import { getRepository, setRepository } from '../src/server/firestoreRepo.ts';
import { LocalFileRepository } from '../src/server/localFallbackRepo.ts';
import { RepositoryError } from '../src/server/repository.ts';
import {
  assertValidWorkspaceMediaStoragePath,
  buildCanonicalWorkspaceMediaStoragePath,
  createPost,
  deleteWorkspaceMediaAsset,
  publishPost,
  readMediaAssetBuffer,
  restoreWorkspaceBackup,
  sanitizeMediaFilename,
  savePostTranslation,
  saveSeoSetting,
  unpublishPost,
  updatePostMetadata,
  uploadMediaAssetToStorage,
  upsertUserAndResolveWorkspace,
} from '../src/server/store.ts';
import { MediaAsset } from '../src/shared/types.ts';

const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

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

describe('WP2 — Storage Tenant Isolation & Media Authorization (AUDIT-001 / AUDIT-002)', () => {
  let tmpDir = '';
  const createdMediaDirs: string[] = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailea-wp2-media-'));
    setRepository(new LocalFileRepository(path.join(tmpDir, 'store')));
  });

  afterEach(async () => {
    for (const dirPath of createdMediaDirs.splice(0)) {
      await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {});
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('enforces canonical workspaces/{wsId}/media/{assetId}/{filename} paths and rejects traversal, encoded separators, absolute paths, and unexpected buckets (AUDIT-001)', async () => {
    const wsId = 'ws_canon_1';
    const assetId = 'med_abc123';

    const canonical = buildCanonicalWorkspaceMediaStoragePath(wsId, assetId, 'hero-image.png');
    expect(canonical).toBe(`workspaces/${wsId}/media/${assetId}/hero-image.png`);

    // Legacy 4-segment path remains safely compatible only when allowLegacy !== false and wsId/assetId match
    expect(
      assertValidWorkspaceMediaStoragePath(`workspaces/${wsId}/media/${assetId}.png`, wsId, assetId)
    ).toBe(`workspaces/${wsId}/media/${assetId}.png`);

    const maliciousPaths = [
      '',
      `../other/media/${assetId}/hero.png`,
      `workspaces/${wsId}/media/${assetId}/../../etc/passwd.png`,
      `/workspaces/${wsId}/media/${assetId}/hero.png`,
      `workspaces\\${wsId}\\media\\${assetId}\\hero.png`,
      `workspaces%2f${wsId}%2fmedia%2f${assetId}%2fhero.png`,
      `workspaces/${wsId}/media/${assetId}/%2e%2e/secret.png`,
      `workspaces/${wsId}/media/${assetId}/hero\x00.png`,
      `workspaces/${wsId}/media//${assetId}/hero.png`,
      `gs://evil-bucket/workspaces/${wsId}/media/${assetId}/hero.png`,
      `https://storage.googleapis.com/evil-bucket/workspaces/${wsId}/media/${assetId}/hero.png`,
      `evil-bucket:workspaces/${wsId}/media/${assetId}/hero.png`,
      `workspaces/${wsId}/media/${assetId}/sub/nested.png`,
      `workspaces/${wsId}/media/${assetId}/script.js`,
      ` workspaces/${wsId}/media/${assetId}/hero.png`,
    ];

    for (const badPath of maliciousPaths) {
      expect(() => assertValidWorkspaceMediaStoragePath(badPath, wsId, assetId)).toThrow(RepositoryError);
    }

    // Wrong workspaceId and wrong assetId must reject with PERMISSION_DENIED
    expect(() =>
      assertValidWorkspaceMediaStoragePath(`workspaces/ws_other/media/${assetId}/hero.png`, wsId, assetId)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));

    expect(() =>
      assertValidWorkspaceMediaStoragePath(`workspaces/${wsId}/media/med_other/hero.png`, wsId, assetId)
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));

    // Unsafe filenames must reject
    expect(() => sanitizeMediaFilename('../../secret.png', 'image/png')).toThrow(RepositoryError);
    expect(() => sanitizeMediaFilename('folder/hero.png', 'image/png')).toThrow(RepositoryError);
    expect(() => sanitizeMediaFilename('bad%2fhero.png', 'image/png')).toThrow(RepositoryError);
  });

  it('rejects malicious backup storagePaths, unknown storage fields, malformed backup records, and never trusts client storagePath payloads (AUDIT-001)', async () => {
    const ownerA = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_a',
      email: 'wp2.ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ownerB = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_b',
      email: 'wp2.ownerb@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsA = ownerA.workspace!;
    const wsB = ownerB.workspace!;
    const repo = getRepository();

    // Seed an existing media record belonging to Workspace B
    await repo.set('mediaAssets/med_foreign_b', {
      id: 'med_foreign_b',
      workspaceId: wsB.id,
      filename: 'secret-b.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG_BYTES.length,
      url: '/api/media/med_foreign_b',
      storagePath: `workspaces/${wsB.id}/media/med_foreign_b/secret-b.png`,
      altText: { fr: 'B', en: 'B', fon: 'B' },
      uploadedBy: 'u_wp2_owner_b',
      createdAt: new Date().toISOString(),
    });

    const baseMediaItem = {
      id: 'med_bk_1',
      filename: 'article-cover.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG_BYTES.length,
      url: '/api/media/med_bk_1',
      altText: { fr: 'Couverture', en: 'Cover', fon: 'Àtì' },
    };

    // 1. Unknown storage fields rejected (.strict())
    for (const extraField of [
      { bucket: 'attacker-bucket' },
      { gcsUri: 'gs://attacker-bucket/secret.png' },
      { downloadTokens: 'forged-token' },
      { storageBucket: 'another-bucket' },
    ]) {
      await expect(
        restoreWorkspaceBackup({
          workspaceId: wsA.id,
          actorId: 'u_wp2_owner_a',
          actorEmail: 'wp2.ownera@ailea.test',
          backup: {
            mediaAssets: [{ ...baseMediaItem, ...extraField }],
          },
        })
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }

    // 2. Malicious backup storagePath values rejected
    const injectedPaths = [
      '../etc/passwd.png',
      `workspaces/${wsB.id}/media/med_bk_1/article-cover.png`,
      `workspaces/${wsA.id}/media/med_other_id/article-cover.png`,
      `workspaces/${wsA.id}/media/med_bk_1/%2e%2e/escape.png`,
      `gs://evil-bucket/workspaces/${wsA.id}/media/med_bk_1/article-cover.png`,
      `/workspaces/${wsA.id}/media/med_bk_1/article-cover.png`,
      `workspaces/${wsA.id}/media/med_bk_1.png`, // legacy shortcut rejected in backup restore
    ];
    for (const badPath of injectedPaths) {
      await expect(
        restoreWorkspaceBackup({
          workspaceId: wsA.id,
          actorId: 'u_wp2_owner_a',
          actorEmail: 'wp2.ownera@ailea.test',
          backup: {
            mediaAssets: [{ ...baseMediaItem, storagePath: badPath }],
          },
        })
      ).rejects.toBeInstanceOf(RepositoryError);
    }

    // 3. Malformed backup media records (unsafe filename, mismatched wsId, mismatched url, bad mime) rejected
    await expect(
      restoreWorkspaceBackup({
        workspaceId: wsA.id,
        actorId: 'u_wp2_owner_a',
        actorEmail: 'wp2.ownera@ailea.test',
        backup: {
          mediaAssets: [{ ...baseMediaItem, workspaceId: wsB.id }],
        },
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    await expect(
      restoreWorkspaceBackup({
        workspaceId: wsA.id,
        actorId: 'u_wp2_owner_a',
        actorEmail: 'wp2.ownera@ailea.test',
        backup: {
          mediaAssets: [{ ...baseMediaItem, filename: '../../escape.png' }],
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(
      restoreWorkspaceBackup({
        workspaceId: wsA.id,
        actorId: 'u_wp2_owner_a',
        actorEmail: 'wp2.ownera@ailea.test',
        backup: {
          mediaAssets: [{ ...baseMediaItem, url: '/api/media/med_other' }],
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    await expect(
      restoreWorkspaceBackup({
        workspaceId: wsA.id,
        actorId: 'u_wp2_owner_a',
        actorEmail: 'wp2.ownera@ailea.test',
        backup: {
          mediaAssets: [{ ...baseMediaItem, url: '/assets/images/cover.png', storagePath: `workspaces/${wsA.id}/media/med_bk_1/cover.png` }],
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });

    // 4. Restored translation body referencing cross-workspace media is rejected
    await expect(
      restoreWorkspaceBackup({
        workspaceId: wsA.id,
        actorId: 'u_wp2_owner_a',
        actorEmail: 'wp2.ownera@ailea.test',
        backup: {
          posts: [{ id: 'post_bk_ref', primaryLocale: 'fr' }],
          postTranslations: [
            {
              id: 'post_bk_ref_fr',
              postId: 'post_bk_ref',
              locale: 'fr',
              title: 'Ref test',
              slug: 'ref-test-bk',
              markdownContent: '![leak](/api/media/med_foreign_b)',
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    // 5. Even if a backup provides an alternative same-asset filename in storagePath,
    // restoreWorkspaceBackup ignores client-supplied storagePath and writes authoritative canonical path
    const restored = await restoreWorkspaceBackup({
      workspaceId: wsA.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
      backup: {
        mediaAssets: [
          {
            ...baseMediaItem,
            filename: 'my clean banner.png',
            storagePath: `workspaces/${wsA.id}/media/med_bk_1/hijacked_name.png`,
          },
        ],
      },
    });
    expect(restored.restoredCount).toBe(1);
    const savedMedia = await repo.get<MediaAsset>('mediaAssets/med_bk_1');
    expect(savedMedia?.workspaceId).toBe(wsA.id);
    expect(savedMedia?.filename).toBe('my_clean_banner.png');
    expect(savedMedia?.storagePath).toBe(`workspaces/${wsA.id}/media/med_bk_1/my_clean_banner.png`);
  });

  it('prevents cross-tenant reads & deletes, enforces 401/403/versioned cache headers, ignores client isPublic flags, and blocks published snapshot media deletion', async () => {
    const ownerA = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_a',
      email: 'wp2.ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ownerB = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_b',
      email: 'wp2.ownerb@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsA = ownerA.workspace!;
    const wsB = ownerB.workspace!;
    const repo = getRepository();

    const assetBId = 'med_ws_b_secret';
    const storagePathB = await uploadMediaAssetToStorage({
      workspaceId: wsB.id,
      assetId: assetBId,
      filename: 'secret-b.png',
      ext: 'png',
      mimeType: 'image/png',
      buffer: VALID_PNG_BYTES,
      actorId: 'u_wp2_owner_b',
    });
    expect(storagePathB).toBe(`workspaces/${wsB.id}/media/${assetBId}/secret-b.png`);
    createdMediaDirs.push(path.resolve(process.cwd(), '.data/media/workspaces', wsB.id));
    createdMediaDirs.push(path.resolve(process.cwd(), '.data/media/workspaces', wsA.id));

    const assetB: MediaAsset = {
      id: assetBId,
      workspaceId: wsB.id,
      filename: 'secret-b.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG_BYTES.length,
      url: `/api/media/${assetBId}`,
      storagePath: storagePathB,
      altText: { fr: 'Secret B', en: 'Secret B', fon: 'Secret B' },
      uploadedBy: 'u_wp2_owner_b',
      createdAt: new Date().toISOString(),
    };
    await repo.set(`mediaAssets/${assetBId}`, assetB as unknown as Record<string, unknown>);

    // Direct store read/delete isolation
    await expect(readMediaAssetBuffer(assetB, { expectedWorkspaceId: wsA.id })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      deleteWorkspaceMediaAsset({
        assetId: assetBId,
        workspaceId: wsA.id,
        actorId: 'u_wp2_owner_a',
        actorEmail: 'wp2.ownera@ailea.test',
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });

    // Create a post in Workspace B referencing assetBId (still draft -> unpublished!)
    const postB = await createPost({
      workspaceId: wsB.id,
      actorId: 'u_wp2_owner_b',
      actorName: 'Owner B',
      actorEmail: 'wp2.ownerb@ailea.test',
      title: 'Article WS B',
      primaryLocale: 'fr',
      markdownContent: `Contenu complet avec image ![cover](/api/media/${assetBId})`,
      slug: 'article-ws-b-media',
      featuredImageUrl: `/api/media/${assetBId}`,
    });

    const srv = await startTestServer();
    try {
      // 1. Unauthenticated private/draft media -> 401 + private, no-store (client ?isPublic=true ignored!)
      const unauthDraft = await fetch(`${srv.baseUrl}/api/media/${assetBId}?isPublic=true`, {
        headers: { 'X-Is-Public': 'true' },
      });
      expect(unauthDraft.status).toBe(401);
      expect(unauthDraft.headers.get('cache-control')).toBe('private, no-store');
      const unauthBody = await unauthDraft.text();
      expect(unauthBody).not.toContain(storagePathB);
      expect(unauthBody).not.toContain(wsB.id);

      // 2. Authenticated non-member (Owner A & Outsider) -> 403 + private, no-store + zero path/ws leak
      const crossRead = await fetch(`${srv.baseUrl}/api/media/${assetBId}?isPublic=true`, {
        headers: { Authorization: 'Bearer token-wp2-owner-a' },
      });
      expect(crossRead.status).toBe(403);
      expect(crossRead.headers.get('cache-control')).toBe('private, no-store');
      expect(crossRead.headers.get('vary')).toContain('Authorization');
      const crossText = await crossRead.text();
      expect(crossText).not.toContain(storagePathB);
      expect(crossText).not.toContain(wsB.id);

      const outsiderRead = await fetch(`${srv.baseUrl}/api/media/${assetBId}`, {
        headers: { Authorization: 'Bearer token-wp2-outsider' },
      });
      expect(outsiderRead.status).toBe(403);

      // 3. Cross-tenant delete via HTTP DELETE /api/admin/media/:id -> 403 and preserves asset
      const crossDelete = await fetch(`${srv.baseUrl}/api/admin/media/${assetBId}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer token-wp2-owner-a',
          'X-Workspace-Id': wsA.id,
        },
      });
      expect(crossDelete.status).toBe(403);
      expect(await repo.get(`mediaAssets/${assetBId}`)).not.toBeNull();

      // 4. Workspace B member can read draft media with private/no-store cache policy
      const memberDraftRead = await fetch(`${srv.baseUrl}/api/media/${assetBId}`, {
        headers: { Authorization: 'Bearer token-wp2-owner-b', 'X-Workspace-Id': wsB.id },
      });
      expect(memberDraftRead.status).toBe(200);
      expect(memberDraftRead.headers.get('cache-control')).toBe('private, no-store');

      // 5. Publish post -> public media becomes accessible with explicit versioned ETag & bounded public cache
      await publishPost({
        postId: postB.post.id,
        workspaceId: wsB.id,
        actorId: 'u_wp2_owner_b',
        actorEmail: 'wp2.ownerb@ailea.test',
      });

      const publicRes = await fetch(`${srv.baseUrl}/api/media/${assetBId}`);
      expect(publicRes.status).toBe(200);
      expect(publicRes.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
      expect(publicRes.headers.get('vary')).toContain('Authorization');
      expect(publicRes.headers.get('x-content-type-options')).toBe('nosniff');
      const etag = publicRes.headers.get('etag');
      expect(etag).toMatch(/^"v1-[a-f0-9]{24}"$/);

      const revalidatedRes = await fetch(`${srv.baseUrl}/api/media/${assetBId}`, {
        headers: { 'If-None-Match': etag! },
      });
      expect(revalidatedRes.status).toBe(304);

      // 6. Media referenced by published snapshot cannot be deleted -> 409 CONFLICT
      const blockedDelete = await fetch(`${srv.baseUrl}/api/admin/media/${assetBId}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer token-wp2-owner-b',
          'X-Workspace-Id': wsB.id,
        },
      });
      expect(blockedDelete.status).toBe(409);

      // 7. Editing ONLY draft to remove the media without republishing STILL blocks deletion (409)
      await updatePostMetadata({
        postId: postB.post.id,
        workspaceId: wsB.id,
        patch: { featuredImageUrl: '' },
      });
      await savePostTranslation({
        postId: postB.post.id,
        workspaceId: wsB.id,
        locale: 'fr',
        actorId: 'u_wp2_owner_b',
        actorEmail: 'wp2.ownerb@ailea.test',
        actorRole: 'owner',
        title: 'Article WS B Sans Image',
        slug: 'article-ws-b-media',
        markdownContent: 'Nouveau contenu brouillon sans image.',
        translationStatus: 'approved',
      });
      await expect(
        deleteWorkspaceMediaAsset({
          assetId: assetBId,
          workspaceId: wsB.id,
          actorId: 'u_wp2_owner_b',
          actorEmail: 'wp2.ownerb@ailea.test',
        })
      ).rejects.toMatchObject({ code: 'CONFLICT', httpStatus: 409 });

      // 8. Clear SEO ogImageUrl as well, then republish -> published snapshot drops reference,
      // media reverts to private (401 anonymously) and deletion is allowed
      for (const loc of ['fr', 'en', 'fon'] as const) {
        await saveSeoSetting({
          postId: postB.post.id,
          workspaceId: wsB.id,
          locale: loc,
          actorId: 'u_wp2_owner_b',
          actorEmail: 'wp2.ownerb@ailea.test',
          patch: { ogImageUrl: '' },
        });
      }
      await publishPost({
        postId: postB.post.id,
        workspaceId: wsB.id,
        actorId: 'u_wp2_owner_b',
        actorEmail: 'wp2.ownerb@ailea.test',
      });
      expect((await fetch(`${srv.baseUrl}/api/media/${assetBId}`)).status).toBe(401);

      // Delete media -> now completely inaccessible even for owner (404) and unauthenticated (401)
      const okDelete = await fetch(`${srv.baseUrl}/api/admin/media/${assetBId}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer token-wp2-owner-b',
          'X-Workspace-Id': wsB.id,
        },
      });
      expect(okDelete.status).toBe(200);

      expect((await fetch(`${srv.baseUrl}/api/media/${assetBId}`)).status).toBe(401);
      const afterDelOwner = await fetch(`${srv.baseUrl}/api/media/${assetBId}`, {
        headers: { Authorization: 'Bearer token-wp2-owner-b' },
      });
      expect(afterDelOwner.status).toBe(404);
      expect(afterDelOwner.headers.get('cache-control')).toBe('private, no-store');

      // 9. Explicit unpublish also revokes public media access when referenced
      const assetB2Id = 'med_ws_b_unpub';
      const pathB2 = await uploadMediaAssetToStorage({
        workspaceId: wsB.id,
        assetId: assetB2Id,
        filename: 'unpub.png',
        ext: 'png',
        mimeType: 'image/png',
        buffer: VALID_PNG_BYTES,
      });
      await repo.set(`mediaAssets/${assetB2Id}`, {
        id: assetB2Id,
        workspaceId: wsB.id,
        filename: 'unpub.png',
        mimeType: 'image/png',
        sizeBytes: VALID_PNG_BYTES.length,
        url: `/api/media/${assetB2Id}`,
        storagePath: pathB2,
        altText: { fr: 'U', en: 'U', fon: 'U' },
        uploadedBy: 'u_wp2_owner_b',
        createdAt: new Date().toISOString(),
      });
      await updatePostMetadata({
        postId: postB.post.id,
        workspaceId: wsB.id,
        patch: { featuredImageUrl: `/api/media/${assetB2Id}` },
      });
      await publishPost({
        postId: postB.post.id,
        workspaceId: wsB.id,
        actorId: 'u_wp2_owner_b',
        actorEmail: 'wp2.ownerb@ailea.test',
      });
      expect((await fetch(`${srv.baseUrl}/api/media/${assetB2Id}`)).status).toBe(200);
      await unpublishPost({
        postId: postB.post.id,
        workspaceId: wsB.id,
        actorId: 'u_wp2_owner_b',
        actorEmail: 'wp2.ownerb@ailea.test',
      });
      const unpubFetch = await fetch(`${srv.baseUrl}/api/media/${assetB2Id}`);
      expect(unpubFetch.status).toBe(401);
      expect(unpubFetch.headers.get('cache-control')).toBe('private, no-store');
    } finally {
      await srv.close();
    }
  });
});
