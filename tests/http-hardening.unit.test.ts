import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';

const TEST_TOKENS: Record<string, DecodedIdToken> = {
  'token-owner-a': {
    uid: 'u_http_owner_a',
    email: 'ownera@ailea.test',
    email_verified: true,
    name: 'Owner A',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_http_owner_a',
  },
  'token-viewer-a': {
    uid: 'u_http_viewer_a',
    email: 'viewera@ailea.test',
    email_verified: true,
    name: 'Viewer A',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_http_viewer_a',
  },
  'token-owner-b': {
    uid: 'u_http_owner_b',
    email: 'ownerb@ailea.test',
    email_verified: true,
    name: 'Owner B',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_http_owner_b',
  },
};

// Offline Auth ID-token verifier stub for Express middleware / repository fault-injection tests only.
// This suite does NOT test Firebase Auth Emulator or Security Rules.
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
import { setRepository } from '../src/server/firestoreRepo.ts';
import { LocalFileRepository } from '../src/server/localFallbackRepo.ts';
import { DataRepository, RepositoryError } from '../src/server/repository.ts';
import {
  acceptWorkspaceInvite,
  createWorkspaceInvite,
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

describe('Phase 1 Remediation — Express HTTP Authz, Member Privacy & Fault Injection', () => {
  let tmpDir = '';
  const createdLocalMediaFiles: string[] = [];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailea-http-'));
    setRepository(new LocalFileRepository(path.join(tmpDir, 'store.json')));
  });

  afterEach(async () => {
    for (const filePath of createdLocalMediaFiles.splice(0)) {
      await fs.rm(filePath, { force: true }).catch(() => {});
    }
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('enforces cross-workspace 403 on authenticated non-member GET /api/media/:id and redacts member emails for viewer role (AUDIT-002 / AUDIT-012)', async () => {
    const ownerARes = await upsertUserAndResolveWorkspace({
      uid: 'u_http_owner_a',
      email: 'ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    await upsertUserAndResolveWorkspace({
      uid: 'u_http_owner_b',
      email: 'ownerb@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsA = ownerARes.workspace!;

    // Invite Viewer A into Workspace A
    const inv = await createWorkspaceInvite({
      workspaceId: wsA.id,
      actorId: 'u_http_owner_a',
      actorEmail: 'ownera@ailea.test',
      email: 'viewera@ailea.test',
      role: 'viewer',
    });
    await acceptWorkspaceInvite({
      workspaceId: wsA.id,
      rawToken: inv.rawToken,
      uid: 'u_http_viewer_a',
      email: 'viewera@ailea.test',
      displayName: 'Viewer A',
    });

    // Upload private draft asset in Workspace A
    const assetId = `med_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const storagePath = await uploadMediaAssetToStorage({
      workspaceId: wsA.id,
      assetId,
      filename: 'draft-secret.png',
      ext: 'png',
      mimeType: 'image/png',
      buffer: VALID_PNG_BYTES,
    });
    createdLocalMediaFiles.push(path.resolve(process.cwd(), '.data/media', storagePath));
    const asset: MediaAsset = {
      id: assetId,
      workspaceId: wsA.id,
      filename: 'draft-secret.png',
      mimeType: 'image/png',
      sizeBytes: VALID_PNG_BYTES.length,
      url: `/api/media/${assetId}`,
      storagePath,
      altText: { fr: 'D', en: 'D', fon: 'D' },
      uploadedBy: 'u_http_owner_a',
      createdAt: new Date().toISOString(),
    };
    const { getRepository } = await import('../src/server/firestoreRepo.ts');
    await getRepository().set(`mediaAssets/${assetId}`, asset as unknown as Record<string, unknown>);

    const srv = await startTestServer();
    try {
      // Cross-tenant authenticated non-member (Owner B) receives 403 without disclosing storagePath or workspaceId
      const crossRead = await fetch(`${srv.baseUrl}/api/media/${assetId}`, {
        headers: { Authorization: 'Bearer token-owner-b' },
      });
      expect(crossRead.status).toBe(403);
      expect(crossRead.headers.get('cache-control')).toBe('private, no-store');
      const crossBody = await crossRead.text();
      expect(crossBody).not.toContain(storagePath);
      expect(crossBody).not.toContain(wsA.id);

      // Workspace A member (Owner A) receives 200 with private/no-store cache policy
      const ownerRead = await fetch(`${srv.baseUrl}/api/media/${assetId}`, {
        headers: { Authorization: 'Bearer token-owner-a' },
      });
      expect(ownerRead.status).toBe(200);
      expect(ownerRead.headers.get('cache-control')).toBe('private, no-store');
      expect(ownerRead.headers.get('x-content-type-options')).toBe('nosniff');

      // Viewer role sees own email, but other workspace members' emails are redacted
      const viewerMembersRes = await fetch(`${srv.baseUrl}/api/admin/members`, {
        headers: {
          Authorization: 'Bearer token-viewer-a',
          'X-Workspace-Id': wsA.id,
        },
      });
      expect(viewerMembersRes.status).toBe(200);
      const viewerBody = (await viewerMembersRes.json()) as {
        members: Array<{ userId: string; email: string }>;
      };
      const selfMember = viewerBody.members.find((m) => m.userId === 'u_http_viewer_a');
      const ownerMember = viewerBody.members.find((m) => m.userId === 'u_http_owner_a');
      expect(selfMember?.email).toBe('viewera@ailea.test');
      expect(ownerMember?.email).toBeUndefined();
      expect(JSON.stringify(viewerBody)).not.toContain('ownera@ailea.test');
    } finally {
      await srv.close();
    }
  });

  it('catches injected repository errors on presets, categories, tags, and workspace routes without leaking internals or unhandled rejections (AUDIT-007)', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_http_owner_a',
      email: 'ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsId = ownerRes.workspace!.id;

    const baseRepo = new LocalFileRepository(path.join(tmpDir, 'fault-store.json'));
    // Seed base owner & workspace into fault-store before enabling fault injection
    setRepository(baseRepo);
    await upsertUserAndResolveWorkspace({
      uid: 'u_http_owner_a',
      email: 'ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const realWsRes = await upsertUserAndResolveWorkspace({
      uid: 'u_http_owner_a',
      email: 'ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const faultWsId = realWsRes.workspace!.id || wsId;

    let failNextWriteWith: 'repo_internal' | 'raw_error' | null = null;
    const faultProxyRepo: DataRepository = {
      backendName: baseRepo.backendName,
      ping: () => baseRepo.ping(),
      get: (p) => baseRepo.get(p),
      getWorkspaceScoped: (col, id, ws) => baseRepo.getWorkspaceScoped(col, id, ws),
      query: (c, o) => baseRepo.query(c, o),
      queryCollectionGroup: (colId, o) => baseRepo.queryCollectionGroup(colId, o),
      create: (p, d) => baseRepo.create(p, d),
      set: async (p, d) => {
        if (failNextWriteWith === 'repo_internal') {
          throw new RepositoryError('INTERNAL', 'SECRET_DB_URI_postgres://admin:pass@internal:5432/db');
        }
        if (failNextWriteWith === 'raw_error') {
          throw new Error('SECRET_RAW_STACK_TOKEN_XYZ');
        }
        return baseRepo.set(p, d);
      },
      update: (p, patch) => baseRepo.update(p, patch),
      delete: async (p) => {
        if (failNextWriteWith === 'raw_error') {
          throw new Error('SECRET_RAW_STACK_TOKEN_DELETE');
        }
        return baseRepo.delete(p);
      },
      commitBatch: (ops) => baseRepo.commitBatch(ops),
      runTransaction: async (fn) => {
        if (failNextWriteWith === 'repo_internal') {
          throw new RepositoryError('INTERNAL', 'SECRET_TX_INTERNAL_DSN');
        }
        if (failNextWriteWith === 'raw_error') {
          throw new Error('SECRET_TX_UNEXPECTED_ERROR');
        }
        return baseRepo.runTransaction(fn);
      },
      createWorkspaceWithOwner: (params) => baseRepo.createWorkspaceWithOwner(params),
      redeemInviteAtomic: (params) => baseRepo.redeemInviteAtomic(params),
    };
    setRepository(faultProxyRepo);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    const srv = await startTestServer();
    try {
      const headers = {
        Authorization: 'Bearer token-owner-a',
        'X-Workspace-Id': faultWsId,
        'Content-Type': 'application/json',
      };

      // 1. POST /api/admin/presets with RepositoryError('INTERNAL')
      failNextWriteWith = 'repo_internal';
      const presetRes = await fetch(`${srv.baseUrl}/api/admin/presets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          semanticKey: 'fault_key',
          emoji: '🔥',
          labels: { fr: 'Feu', en: 'Fire', fon: 'Myɔ́' },
          displayOrder: 1,
        }),
      });
      expect(presetRes.status).toBe(500);
      const presetBody = await presetRes.text();
      expect(presetBody).not.toContain('SECRET_');

      // 2. POST /api/admin/categories with raw unexpected Error
      failNextWriteWith = 'raw_error';
      const catRes = await fetch(`${srv.baseUrl}/api/admin/categories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          slug: 'fault-cat',
          names: { fr: 'Cat', en: 'Cat', fon: 'Cat' },
        }),
      });
      expect(catRes.status).toBe(500);
      const catBody = await catRes.text();
      expect(catBody).not.toContain('SECRET_');

      // 3. POST /api/admin/tags with raw unexpected Error
      failNextWriteWith = 'raw_error';
      const tagRes = await fetch(`${srv.baseUrl}/api/admin/tags`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          slug: 'fault-tag',
          names: { fr: 'Tag', en: 'Tag', fon: 'Tag' },
        }),
      });
      expect(tagRes.status).toBe(500);
      const tagBody = await tagRes.text();
      expect(tagBody).not.toContain('SECRET_');

      // 4. PATCH /api/admin/workspace with RepositoryError('INTERNAL') inside transaction
      failNextWriteWith = 'repo_internal';
      const wsRes = await fetch(`${srv.baseUrl}/api/admin/workspace`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ brandName: 'New Brand' }),
      });
      expect(wsRes.status).toBe(500);
      const wsBody = await wsRes.text();
      expect(wsBody).not.toContain('SECRET_');

      // 5. Seed a preset while healthy, then DELETE /api/admin/presets/:id under raw error
      failNextWriteWith = null;
      const seededPresetRes = await fetch(`${srv.baseUrl}/api/admin/presets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          semanticKey: 'healthy_key',
          emoji: '✨',
          labels: { fr: 'Bien', en: 'Good', fon: 'Nyɔ́' },
          displayOrder: 2,
        }),
      });
      expect(seededPresetRes.status).toBe(201);
      failNextWriteWith = 'raw_error';
      const delPresetRes = await fetch(`${srv.baseUrl}/api/admin/presets/${faultWsId}_healthy_key`, {
        method: 'DELETE',
        headers,
      });
      expect(delPresetRes.status).toBe(500);
      const delPresetBody = await delPresetRes.text();
      expect(delPresetBody).not.toContain('SECRET_');

      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      await srv.close();
    }
  });
});
