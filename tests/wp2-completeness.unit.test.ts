import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';

const WP2_TOKENS: Record<string, DecodedIdToken> = {
  'wp2-owner-a': {
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
  'wp2-editor-a': {
    uid: 'u_wp2_editor_a',
    email: 'wp2.editora@ailea.test',
    email_verified: true,
    name: 'WP2 Editor A',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_wp2_editor_a',
  },
  'wp2-viewer-a': {
    uid: 'u_wp2_viewer_a',
    email: 'wp2.viewera@ailea.test',
    email_verified: true,
    name: 'WP2 Viewer A',
    aud: 'demo-ailea-postmanager-local',
    auth_time: 1700000000,
    exp: 1900000000,
    firebase: { identities: {}, sign_in_provider: 'password' },
    iat: 1700000000,
    iss: 'https://securetoken.google.com/demo-ailea-postmanager-local',
    sub: 'u_wp2_viewer_a',
  },
  'wp2-owner-b': {
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
};

// Offline Auth ID-token verifier stub for Express RBAC/completeness tests only.
vi.mock('../src/server/firebaseAdmin.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/server/firebaseAdmin.ts')>();
  return {
    ...original,
    getAdminAuth: () => ({
      verifyIdToken: async (token: string) => {
        const decoded = WP2_TOKENS[token];
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
import {
  acceptWorkspaceInvite,
  createPost,
  createWorkspaceInvite,
  getPublishedPostByLocaleSlug,
  publishPost,
  savePostTranslation,
  updatePostMetadata,
  updateWorkspaceSettings,
  upsertUserAndResolveWorkspace,
} from '../src/server/store.ts';
import { UI_STRINGS } from '../src/shared/i18n.ts';
import { SUPPORTED_LOCALES, Tag } from '../src/shared/types.ts';

function collectLeafPaths(obj: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, val] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'string') {
      out.set(p, val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = collectLeafPaths(val as Record<string, unknown>, p);
      for (const [np, nv] of nested.entries()) {
        out.set(np, nv);
      }
    }
  }
  return out;
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

describe('Work Package 2 — End-to-End Completeness, Localization & Tenant Controls', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailea-wp2-'));
    setRepository(new LocalFileRepository(path.join(tmpDir, 'store.json')));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('maintains full UI_STRINGS key parity across fr/en/fon with non-empty values and preserved Fongbe orthography', () => {
    const frLeaves = collectLeafPaths(UI_STRINGS.fr as unknown as Record<string, unknown>);
    expect(frLeaves.size).toBeGreaterThan(100);

    for (const loc of SUPPORTED_LOCALES) {
      const leaves = collectLeafPaths(UI_STRINGS[loc] as unknown as Record<string, unknown>);
      expect(Array.from(leaves.keys()).sort()).toEqual(Array.from(frLeaves.keys()).sort());
      for (const [keyPath, value] of leaves.entries()) {
        expect(value.trim().length, `Empty i18n value at ${loc}.${keyPath}`).toBeGreaterThan(0);
      }
    }

    const fonAllText = Array.from(
      collectLeafPaths(UI_STRINGS.fon as unknown as Record<string, unknown>).values()
    ).join(' ');
    expect(fonAllText).toContain('ɛ');
    expect(fonAllText).toContain('ɔ');
    expect(fonAllText).toContain('ɖ');
    // Confirm French translation approval label tested by Translation Studio SSR suite remains intact
    expect(UI_STRINGS.fr.translations.approveTranslation).toBe('Approuver la traduction');
  });

  it('persists immutable tagsSnapshot on publishPost and serves tags on SSR + JSON even if live tag doc is later deleted', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_a',
      email: 'wp2.ownera@ailea.test',
      displayName: 'WP2 Owner A',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    const customTag: Tag = {
      id: `${ws.id}_orature-benin`,
      workspaceId: ws.id,
      slug: 'orature-benin',
      names: {
        fr: 'Orature Bénin',
        en: 'Benin Orature',
        fon: 'Xó-ɖɔɖɔ Benɛ̌ tɔn',
      },
      createdAt: new Date().toISOString(),
    };
    await getRepository().set(`tags/${customTag.id}`, customTag as unknown as Record<string, unknown>);

    const created = await createPost({
      workspaceId: ws.id,
      actorId: 'u_wp2_owner_a',
      actorName: 'WP2 Owner A',
      actorEmail: 'wp2.ownera@ailea.test',
      primaryLocale: 'fr',
      title: 'Article Étiqueté Immuable',
    });

    await updatePostMetadata({
      postId: created.post.id,
      workspaceId: ws.id,
      patch: {
        tagIds: [customTag.id],
      },
    });

    const slug = `article-etiquete-${crypto.randomUUID().slice(0, 6)}`;
    await savePostTranslation({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
      actorRole: 'owner',
      locale: 'fr',
      title: 'Article Étiqueté Immuable',
      slug,
      markdownContent: 'Contenu complet sur l’édition multilingue et l’étiquetage immuable.',
      translationStatus: 'approved',
    });

    await publishPost({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
    });

    // Delete live tag doc after publication to verify immutable snapshot isolation
    await getRepository().delete(`tags/${customTag.id}`);

    const resolved = await getPublishedPostByLocaleSlug('fr', slug);
    expect(resolved).not.toBeNull();
    expect(resolved!.tags).toHaveLength(1);
    expect(resolved!.tags[0].names.fr).toBe('Orature Bénin');

    const srv = await startTestServer();
    try {
      const jsonRes = await fetch(`${srv.baseUrl}/api/public/posts/fr/${slug}`);
      expect(jsonRes.status).toBe(200);
      const jsonBody = (await jsonRes.json()) as { tags: Tag[] };
      expect(jsonBody.tags.map((t) => t.id)).toContain(customTag.id);

      const ssrRes = await fetch(`${srv.baseUrl}/p/fr/${slug}`);
      expect(ssrRes.status).toBe(200);
      const html = await ssrRes.text();
      expect(html).toContain('#Orature Bénin');
    } finally {
      await srv.close();
    }
  });

  it('renders localized Non-JS reaction error banners only for valid reaction_error query values', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_a',
      email: 'wp2.ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    const created = await createPost({
      workspaceId: ws.id,
      actorId: 'u_wp2_owner_a',
      actorName: 'WP2 Owner A',
      actorEmail: 'wp2.ownera@ailea.test',
      primaryLocale: 'fr',
      title: 'Article Réaction SSR',
    });
    const slug = `article-reaction-ssr-${crypto.randomUUID().slice(0, 6)}`;
    await savePostTranslation({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
      actorRole: 'owner',
      locale: 'en',
      title: 'SSR Reaction Feedback Post',
      slug,
      markdownContent: 'Reader reaction banner verification content.',
      translationStatus: 'approved',
    });
    await publishPost({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
    });

    const srv = await startTestServer();
    try {
      const rateLimitHtml = await (
        await fetch(`${srv.baseUrl}/p/en/${slug}?reaction_error=rate_limit`)
      ).text();
      expect(rateLimitHtml).toContain(UI_STRINGS.en.publicReader.reactionRateLimitError);

      const sessionHtml = await (
        await fetch(`${srv.baseUrl}/p/en/${slug}?reaction_error=session`)
      ).text();
      expect(sessionHtml).toContain(UI_STRINGS.en.publicReader.reactionSessionError);

      // Unknown / injected query values must never reflect or inject markup
      const xssHtml = await (
        await fetch(
          `${srv.baseUrl}/p/en/${slug}?reaction_error=${encodeURIComponent('<script>alert(1)</script>')}`
        )
      ).text();
      expect(xssHtml).not.toContain('<script>alert(1)</script>');
      expect(xssHtml).not.toContain(UI_STRINGS.en.publicReader.reactionRateLimitError);
      expect(xssHtml).not.toContain(UI_STRINGS.en.publicReader.reactionSessionError);
    } finally {
      await srv.close();
    }
  });

  it('enforces RBAC and cross-tenant isolation on DELETE /api/admin/presets/:id', async () => {
    const ownerARes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_a',
      email: 'wp2.ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_b',
      email: 'wp2.ownerb@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsA = ownerARes.workspace!;

    const invEditor = await createWorkspaceInvite({
      workspaceId: wsA.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
      email: 'wp2.editora@ailea.test',
      role: 'editor',
    });
    await acceptWorkspaceInvite({
      workspaceId: wsA.id,
      rawToken: invEditor.rawToken,
      uid: 'u_wp2_editor_a',
      email: 'wp2.editora@ailea.test',
      displayName: 'WP2 Editor A',
    });

    const invViewer = await createWorkspaceInvite({
      workspaceId: wsA.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
      email: 'wp2.viewera@ailea.test',
      role: 'viewer',
    });
    await acceptWorkspaceInvite({
      workspaceId: wsA.id,
      rawToken: invViewer.rawToken,
      uid: 'u_wp2_viewer_a',
      email: 'wp2.viewera@ailea.test',
      displayName: 'WP2 Viewer A',
    });

    const srv = await startTestServer();
    try {
      // Create a preset as Owner A
      const createRes = await fetch(`${srv.baseUrl}/api/admin/presets`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wp2-owner-a',
          'X-Workspace-Id': wsA.id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          semanticKey: 'insightful',
          emoji: '💡',
          labels: { fr: 'Éclairant', en: 'Insightful', fon: 'Wě-mɔ̌' },
          displayOrder: 5,
        }),
      });
      expect(createRes.status).toBe(201);
      const { preset } = (await createRes.json()) as { preset: { id: string } };

      // Viewer role cannot delete preset (403)
      const viewerDel = await fetch(`${srv.baseUrl}/api/admin/presets/${preset.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer wp2-viewer-a',
          'X-Workspace-Id': wsA.id,
        },
      });
      expect(viewerDel.status).toBe(403);

      // Cross-tenant Owner B cannot delete Workspace A preset (403)
      const crossDel = await fetch(`${srv.baseUrl}/api/admin/presets/${preset.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer wp2-owner-b',
        },
      });
      expect(crossDel.status).toBe(403);

      // Editor in Workspace A can delete the preset (200)
      const editorDel = await fetch(`${srv.baseUrl}/api/admin/presets/${preset.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer wp2-editor-a',
          'X-Workspace-Id': wsA.id,
        },
      });
      expect(editorDel.status).toBe(200);

      // Verify preset is absent on subsequent workspace bootstrap
      const listRes = await fetch(`${srv.baseUrl}/api/admin/bootstrap`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer wp2-owner-a',
          'X-Workspace-Id': wsA.id,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { presets: Array<{ id: string }> };
      expect(listBody.presets.some((p) => p.id === preset.id)).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('updates workspace slug atomically via updateWorkspaceSettings and rejects cross-workspace slug collisions', async () => {
    const wsARes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_a',
      email: 'wp2.ownera@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const wsBRes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp2_owner_b',
      email: 'wp2.ownerb@ailea.test',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });

    const updatedA = await updateWorkspaceSettings({
      workspaceId: wsARes.workspace!.id,
      actorId: 'u_wp2_owner_a',
      actorEmail: 'wp2.ownera@ailea.test',
      patch: { slug: 'Revue Éditoriale Bénin' },
    });
    expect(updatedA.slug).toBe('revue-editoriale-benin');

    await expect(
      updateWorkspaceSettings({
        workspaceId: wsBRes.workspace!.id,
        actorId: 'u_wp2_owner_b',
        actorEmail: 'wp2.ownerb@ailea.test',
        patch: { slug: 'revue-editoriale-benin' },
      })
    ).rejects.toThrow();
  });
});
