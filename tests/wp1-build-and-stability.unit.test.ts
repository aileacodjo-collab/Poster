import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../server.ts';
import { AuthorizedMediaImage } from '../src/components/AuthorizedMediaImage.tsx';
import { StudioShell } from '../src/components/StudioShell.tsx';
import { AuthProvider } from '../src/contexts/AuthContext.tsx';
import { I18nProvider, useI18n } from '../src/contexts/I18nContext.tsx';
import { AnalyticsModule } from '../src/modules/AnalyticsModule.tsx';
import { ContentLibraryModule } from '../src/modules/ContentLibraryModule.tsx';
import { DashboardModule } from '../src/modules/DashboardModule.tsx';
import { PostManagerModule } from '../src/modules/PostManagerModule.tsx';
import { ReactionStudioModule } from '../src/modules/ReactionStudioModule.tsx';
import { SeoStudioModule } from '../src/modules/SeoStudioModule.tsx';
import { SettingsModule } from '../src/modules/SettingsModule.tsx';
import { TranslationStudioModule } from '../src/modules/TranslationStudioModule.tsx';
import { getRepository, setRepository } from '../src/server/firestoreRepo.ts';
import { LocalFileRepository } from '../src/server/localFallbackRepo.ts';
import { RepositoryError } from '../src/server/repository.ts';
import {
  acceptWorkspaceInvite,
  createPost,
  createWorkspaceInvite,
  getPublishedPostByLocaleSlug,
  publishPost,
  savePostReactionsConfig,
  savePostTranslation,
  upsertUserAndResolveWorkspace,
} from '../src/server/store.ts';
import { UI_STRINGS } from '../src/shared/i18n.ts';
import type { Locale, PublishedPostSnapshot } from '../src/shared/types.ts';

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

function I18nDefaultProbe() {
  const { locale, t } = useI18n();
  return React.createElement(
    'div',
    { 'data-locale': locale },
    `${locale}:${t.nav.translations}:${t.translations.approveTranslation}`
  );
}

describe('WP1 — Build Integrity, Module Initialization, Locale Switching & publishPost Narrowing', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailea-wp1-'));
    setRepository(new LocalFileRepository(path.join(tmpDir, 'store.json')));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('imports all UI modules and contexts without TDZ/init errors and defaults I18nProvider to French', () => {
    expect(typeof AuthorizedMediaImage).toBe('function');
    expect(typeof StudioShell).toBe('function');
    expect(typeof DashboardModule).toBe('function');
    expect(typeof PostManagerModule).toBe('function');
    expect(typeof TranslationStudioModule).toBe('function');
    expect(typeof ReactionStudioModule).toBe('function');
    expect(typeof SeoStudioModule).toBe('function');
    expect(typeof AnalyticsModule).toBe('function');
    expect(typeof ContentLibraryModule).toBe('function');
    expect(typeof SettingsModule).toBe('function');
    expect(typeof AuthProvider).toBe('function');

    const html = renderToStaticMarkup(
      React.createElement(I18nProvider, null, React.createElement(I18nDefaultProbe))
    );
    expect(html).toContain('data-locale="fr"');
    expect(html).toContain(`fr:${UI_STRINGS.fr.nav.translations}:${UI_STRINGS.fr.translations.approveTranslation}`);
  });

  it('registers Express routes cleanly: health 200, unmapped /api/* returns JSON 404, protected admin routes return 401, and locale switching serves /p/fr, /p/en, /p/fon & legacy 301', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp1_router',
      email: 'wp1.router@ailea.test',
      displayName: 'WP1 Router',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    const srv = await startTestServer();
    try {
      const healthRes = await fetch(`${srv.baseUrl}/api/health`);
      expect(healthRes.status).toBe(200);
      expect((await healthRes.json()) as { ok: boolean }).toMatchObject({ ok: true });

      const unmappedApiRes = await fetch(`${srv.baseUrl}/api/nonexistent-endpoint`);
      expect(unmappedApiRes.status).toBe(404);
      expect(unmappedApiRes.headers.get('content-type')).toContain('application/json');

      const adminUnauthRes = await fetch(`${srv.baseUrl}/api/admin/bootstrap`, { method: 'POST' });
      expect(adminUnauthRes.status).toBe(401);

      // Verify seeded post switches cleanly across fr, en, fon SSR endpoints
      const seededPosts = await getRepository().query<PublishedPostSnapshot>('publishedPosts', {
        filters: [{ field: 'workspaceId', op: '==', value: ws.id }],
      });
      expect(seededPosts).toHaveLength(1);
      const snap = seededPosts[0].data;

      for (const loc of ['fr', 'en', 'fon'] as Locale[]) {
        const tr = snap.translations[loc];
        expect(tr).not.toBeNull();
        const ssrRes = await fetch(`${srv.baseUrl}/p/${loc}/${tr!.slug}`);
        expect(ssrRes.status).toBe(200);
        const html = await ssrRes.text();
        expect(html).toContain(`<html lang="${loc}">`);
        expect(html).toContain(tr!.title);

        const legacyRes = await fetch(`${srv.baseUrl}/${loc}/${tr!.slug}`, { redirect: 'manual' });
        expect(legacyRes.status).toBe(301);
        expect(legacyRes.headers.get('location')).toBe(`/p/${loc}/${tr!.slug}`);
      }
    } finally {
      await srv.close();
    }
  });

  it('executes publishPost cleanly with strict narrowing across Fongbe gate, optional null locales, removed reactions, and old slug cleanup', async () => {
    const ownerRes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp1_pub_owner',
      email: 'wp1.owner@ailea.test',
      displayName: 'WP1 Owner',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const otherRes = await upsertUserAndResolveWorkspace({
      uid: 'u_wp1_other',
      email: 'wp1.other@ailea.test',
      displayName: 'WP1 Other',
      appBaseUrl: 'https://ailea.example',
      createPersonalWorkspace: true,
    });
    const ws = ownerRes.workspace!;

    const inv = await createWorkspaceInvite({
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
      email: 'wp1.reviewer@ailea.test',
      role: 'reviewer',
    });
    await acceptWorkspaceInvite({
      workspaceId: ws.id,
      rawToken: inv.rawToken,
      uid: 'u_wp1_reviewer',
      email: 'wp1.reviewer@ailea.test',
      displayName: 'WP1 Reviewer',
    });

    const created = await createPost({
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorName: 'WP1 Owner',
      actorEmail: 'wp1.owner@ailea.test',
      primaryLocale: 'fr',
      title: 'Publication Sécurisée TypeScript',
    });

    // Reject unknown post & cross-workspace publish attempts cleanly
    await expect(
      publishPost({
        postId: 'post_does_not_exist',
        workspaceId: ws.id,
        actorId: 'u_wp1_pub_owner',
        actorEmail: 'wp1.owner@ailea.test',
      })
    ).rejects.toMatchObject<Partial<RepositoryError>>({ code: 'NOT_FOUND' });

    await expect(
      publishPost({
        postId: created.post.id,
        workspaceId: otherRes.workspace!.id,
        actorId: 'u_wp1_other',
        actorEmail: 'wp1.other@ailea.test',
      })
    ).rejects.toMatchObject<Partial<RepositoryError>>({ code: 'PERMISSION_DENIED' });

    // Save FR approved, leave EN unpopulated (null), add FON in_review -> must block publication
    await savePostTranslation({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
      actorRole: 'owner',
      locale: 'fr',
      title: 'Publication Sécurisée TypeScript',
      slug: 'pub-sec-v1',
      markdownContent: 'Article complet sur le typage strict sans cast dangereux.',
      translationStatus: 'approved',
    });
    await savePostTranslation({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
      actorRole: 'owner',
      locale: 'fon',
      title: 'Xótà Fɔngbè V1',
      slug: 'xota-fongbe-v1',
      markdownContent: 'Wlǎn xó ɖò Fɔngbè mɛ gànjí.',
      translationStatus: 'in_review',
    });

    await expect(
      publishPost({
        postId: created.post.id,
        workspaceId: ws.id,
        actorId: 'u_wp1_pub_owner',
        actorEmail: 'wp1.owner@ailea.test',
      })
    ).rejects.toMatchObject<Partial<RepositoryError>>({ code: 'INVALID_ARGUMENT' });
    expect(await getRepository().get(`publishedPosts/${created.post.id}`)).toBeNull();

    // Remove one draft reaction while keeping another enabled before publishing
    await savePostReactionsConfig({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
      reactionLimit: 1,
      allowReactionChange: true,
      reactions: [
        {
          semanticKey: 'curiosity',
          emoji: '🤔',
          labels: { fr: 'Curieux', en: 'Curious', fon: 'Byɔ́' },
          displayOrder: 0,
          enabled: true,
        },
      ],
    });

    // Reviewer approves Fongbe translation -> publishPost succeeds even with EN=null
    await savePostTranslation({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_reviewer',
      actorEmail: 'wp1.reviewer@ailea.test',
      actorRole: 'reviewer',
      locale: 'fon',
      title: 'Xótà Fɔngbè V1',
      slug: 'xota-fongbe-v1',
      markdownContent: 'Wlǎn xó ɖò Fɔngbè mɛ gànjí.',
      translationStatus: 'approved',
      linguisticNotes: 'Note interne confidentielle reviewer',
    });

    const pub1 = await publishPost({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
    });
    expect(pub1.version.versionNumber).toBe(2);

    const snap1 = await getRepository().get<PublishedPostSnapshot>(`publishedPosts/${created.post.id}`);
    expect(snap1).not.toBeNull();
    expect(snap1!.translations.en).toBeNull();
    expect(snap1!.translations.fr?.slug).toBe('pub-sec-v1');
    expect(snap1!.translations.fon?.slug).toBe('xota-fongbe-v1');
    // PII / internal reviewer notes must not be leaked in published snapshot
    expect(JSON.stringify(snap1)).not.toContain('u_wp1_pub_owner');
    expect(JSON.stringify(snap1)).not.toContain('u_wp1_reviewer');
    expect(JSON.stringify(snap1)).not.toContain('Note interne confidentielle');
    expect(snap1!.reactions?.map((r) => r.semanticKey)).toEqual(['curiosity']);

    // Rename FR slug and republish -> old slug route/lock must be cleaned up
    await savePostTranslation({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
      actorRole: 'owner',
      locale: 'fr',
      title: 'Publication Sécurisée V2',
      slug: 'pub-sec-v2',
      markdownContent: 'Version 2 publiée avec nettoyage du slug précédent.',
      translationStatus: 'approved',
    });

    const pub2 = await publishPost({
      postId: created.post.id,
      workspaceId: ws.id,
      actorId: 'u_wp1_pub_owner',
      actorEmail: 'wp1.owner@ailea.test',
    });
    expect(pub2.version.versionNumber).toBe(3);

    expect(await getPublishedPostByLocaleSlug('fr', 'pub-sec-v1')).toBeNull();
    const resolvedV2 = await getPublishedPostByLocaleSlug('fr', 'pub-sec-v2');
    expect(resolvedV2?.bundle.translations.fr?.title).toBe('Publication Sécurisée V2');
  });
});
