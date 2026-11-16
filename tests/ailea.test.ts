import { describe, expect, it } from 'vitest';
import {
  generateSlug,
  parseMarkdownWithFrontmatter,
  sanitizeAndRenderMarkdown,
  serializeMarkdownWithFrontmatter,
  validatePostForPublication,
} from '../src/shared/markdown.ts';
import { buildRobotsTxt, buildXmlSitemap, resolvePostSEO } from '../src/shared/seo.ts';
import { renderPublicPostHtml } from '../src/server/ssr.ts';
import { SlidingWindowRateLimiter, validateImageBuffer } from '../src/server/security.ts';
import { FullPostBundle, Post, PostReaction, PostTranslation, SEOSetting, Workspace } from '../src/shared/types.ts';

function makeFixtureBundle(): { workspace: Workspace; bundle: FullPostBundle } {
  const now = '2026-11-15T10:00:00.000Z';
  const workspace: Workspace = {
    id: 'ws_test',
    name: 'AILEA Test',
    slug: 'ailea-test',
    ownerId: 'user_1',
    brandName: 'AILEA Revue',
    defaultLocale: 'fr',
    baseUrl: 'https://ailea.example',
    createdAt: now,
    updatedAt: now,
  };

  const post: Post = {
    id: 'post_1',
    workspaceId: 'ws_test',
    authorId: 'user_1',
    authorName: 'Codjo Ailea',
    primaryLocale: 'fr',
    status: 'published',
    categoryId: null,
    tagIds: [],
    featuredImageUrl: '/assets/images/editorial_courtyard_cover_1794750583424.jpg',
    reactionLimit: 1,
    allowReactionChange: true,
    currentVersionNumber: 2,
    publishedVersionNumber: 2,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const fr: PostTranslation = {
    id: 'post_1_fr',
    postId: 'post_1',
    workspaceId: 'ws_test',
    locale: 'fr',
    title: 'Histoire vivante du Fɔngbè numérique',
    slug: 'histoire-vivante-fongbe-numerique',
    excerpt: 'Comment publier en trois langues avec respect.',
    markdownContent: '## Bonjour\n\nTexte en **français**.\n\n| Col | Val |\n| --- | --- |\n| A | 1 |',
    sanitizedHtml: sanitizeAndRenderMarkdown('## Bonjour\n\nTexte en **français**.\n\n| Col | Val |\n| --- | --- |\n| A | 1 |'),
    frontmatterJson: {},
    translationStatus: 'approved',
    linguisticNotes: '',
    approvedBy: 'user_1',
    approvedAt: now,
    wordCount: 10,
    readingTimeMinutes: 1,
    updatedAt: now,
  };

  const en: PostTranslation = {
    ...fr,
    id: 'post_1_en',
    locale: 'en',
    title: 'Living History of Digital Fongbe',
    slug: 'living-history-digital-fongbe',
    excerpt: 'Publishing across three languages with care.',
    markdownContent: '## Hello\n\nText in **English**.',
    sanitizedHtml: sanitizeAndRenderMarkdown('## Hello\n\nText in **English**.'),
  };

  const fon: PostTranslation = {
    ...fr,
    id: 'post_1_fon',
    locale: 'fon',
    title: 'Hwɛndomɛ Fɔngbè ɖò gbɛ̀ yɔ̌yɔ́ mɛ',
    slug: 'hwendome-fongbe-gbe-yoyo-me',
    excerpt: 'Wěmá wlǎn ɖò Fɔngbè mɛ kpódó wěkwín gànjí kpán.',
    markdownContent: '## Kú déú\n\nXó ɖò **Fɔngbè** mɛ: ɛ́, ɔ̀, ɖò, gbǎ.',
    sanitizedHtml: sanitizeAndRenderMarkdown('## Kú déú\n\nXó ɖò **Fɔngbè** mɛ: ɛ́, ɔ̀, ɖò, gbǎ.'),
  };

  const reactions: PostReaction[] = [
    {
      id: 'post_1_curiosity',
      postId: 'post_1',
      workspaceId: 'ws_test',
      semanticKey: 'curiosity',
      emoji: '👀',
      labels: { fr: 'Curiosité', en: 'Curiosity', fon: 'Nǔ-ba-kpɔ́n' },
      displayOrder: 0,
      enabled: true,
      count: 4,
    },
    {
      id: 'post_1_affection',
      postId: 'post_1',
      workspaceId: 'ws_test',
      semanticKey: 'affection',
      emoji: '❤️',
      labels: { fr: 'Affection', en: 'Affection', fon: 'Wǎn-yíyí' },
      displayOrder: 1,
      enabled: true,
      count: 7,
    },
    {
      id: 'post_1_anticipation',
      postId: 'post_1',
      workspaceId: 'ws_test',
      semanticKey: 'anticipation',
      emoji: '✨',
      labels: { fr: 'Impatience', en: 'Anticipation', fon: 'Nukɔ́n-kpɔ́n' },
      displayOrder: 2,
      enabled: true,
      count: 2,
    },
  ];

  const seo: Record<'fr' | 'en' | 'fon', SEOSetting | null> = {
    fr: {
      id: 'post_1_fr',
      postId: 'post_1',
      workspaceId: 'ws_test',
      locale: 'fr',
      metaTitle: 'Histoire vivante du Fɔngbè numérique',
      metaDescription: 'Comment publier en trois langues avec respect.',
      canonicalUrl: '',
      ogTitle: 'Histoire vivante du Fɔngbè numérique',
      ogDescription: 'Comment publier en trois langues avec respect.',
      ogImageUrl: post.featuredImageUrl,
      twitterCardType: 'summary_large_image',
      schemaType: 'BlogPosting',
      noIndex: false,
      updatedAt: now,
    },
    en: null,
    fon: null,
  };

  return {
    workspace,
    bundle: {
      post,
      translations: { fr, en, fon },
      reactions,
      seo,
      versions: [],
      publishingEvents: [],
    },
  };
}

describe('AILEA PostManager — Markdown, Unicode & Security Engine', () => {
  it('parses YAML frontmatter, GFM tables, task lists, and serializes portable Markdown', () => {
    const raw = `---
title: Mon Article Test
locale: fr
slug: mon-article-test
---

# Titre

- [x] Fait
- [ ] À faire

| Langue | Code |
| :--- | :--- |
| Fɔngbè | fon |
`;
    const parsed = parseMarkdownWithFrontmatter(raw);
    expect(parsed.errors).toEqual([]);
    expect(parsed.frontmatter.title).toBe('Mon Article Test');
    expect(parsed.frontmatter.locale).toBe('fr');

    const html = sanitizeAndRenderMarkdown(parsed.body);
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Fɔngbè');

    const exported = serializeMarkdownWithFrontmatter(parsed.frontmatter, parsed.body);
    expect(exported).toContain('title: Mon Article Test');
    expect(exported).toContain('| Fɔngbè | fon |');
  });

  it('strips XSS script tags, event handlers, and javascript: URIs', () => {
    const dirty = `# Safe\n\n<script>alert("xss")</script>\n<img src="x" onerror="alert(1)" />\n<a href="javascript:alert(2)">click</a>`;
    const clean = sanitizeAndRenderMarkdown(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('href="javascript:');
  });

  it('generates clean ASCII slugs from French and Fongbe Unicode characters', () => {
    expect(generateSlug('Écrire en Fɔngbè : ɛ́, ɔ̀, ɖò')).toBe('ecrire-en-fongbe-e-o-do');
  });

  it('blocks publication when Fongbe translation is present but not human-approved', () => {
    const { bundle } = makeFixtureBundle();
    bundle.translations.fon!.translationStatus = 'draft';
    const report = validatePostForPublication(bundle);
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === 'FONGBE_APPROVAL_REQUIRED')).toBe(true);

    bundle.translations.fon!.translationStatus = 'approved';
    const approvedReport = validatePostForPublication(bundle);
    expect(approvedReport.valid).toBe(true);
  });
});

describe('AILEA PostManager — SEO, Reciprocal hreflang & XML Sitemap', () => {
  it('emits reciprocal hreflang ONLY for fr and en, never for unsupported fon code', () => {
    const { workspace, bundle } = makeFixtureBundle();

    const frSeo = resolvePostSEO({
      baseUrl: workspace.baseUrl,
      brandName: workspace.brandName,
      post: bundle.post,
      locale: 'fr',
      translation: bundle.translations.fr!,
      allTranslations: bundle.translations,
      seoSetting: bundle.seo.fr,
    });
    expect(frSeo.hreflangs.map((h) => h.hreflang)).toEqual(['fr', 'en', 'x-default']);

    const fonSeo = resolvePostSEO({
      baseUrl: workspace.baseUrl,
      brandName: workspace.brandName,
      post: bundle.post,
      locale: 'fon',
      translation: bundle.translations.fon!,
      allTranslations: bundle.translations,
      seoSetting: bundle.seo.fon,
    });
    expect(fonSeo.hreflangs).toEqual([]);
    expect(fonSeo.canonicalUrl).toBe('https://ailea.example/p/fon/hwendome-fongbe-gbe-yoyo-me');
  });

  it('generates valid XML sitemap with fr/en xhtml:link alternates and robots.txt', () => {
    const { workspace, bundle } = makeFixtureBundle();
    const xml = buildXmlSitemap({
      baseUrl: workspace.baseUrl,
      entries: [{ post: bundle.post, translations: bundle.translations }],
    });
    expect(xml).toContain('<loc>https://ailea.example/p/fr/histoire-vivante-fongbe-numerique</loc>');
    expect(xml).toContain('<loc>https://ailea.example/p/fon/hwendome-fongbe-gbe-yoyo-me</loc>');
    expect(xml).toContain('hreflang="fr"');
    expect(xml).toContain('hreflang="en"');
    expect(xml).not.toContain('hreflang="fon"');

    const robots = buildRobotsTxt(workspace.baseUrl);
    expect(robots).toContain('Sitemap: https://ailea.example/sitemap.xml');
    expect(robots).toContain('Disallow: /api/admin/');
  });
});

describe('AILEA PostManager — SSR Public Reading Page (No-JS Ready)', () => {
  it('renders full article HTML, language links, and POST reaction forms without JS', () => {
    const { workspace, bundle } = makeFixtureBundle();
    const html = renderPublicPostHtml({
      baseUrl: workspace.baseUrl,
      workspace,
      bundle,
      locale: 'fon',
      category: null,
      activeReactionKeys: ['affection'],
      relatedPosts: [],
    });

    expect(html).toContain('<html lang="fon">');
    expect(html).toContain('Hwɛndomɛ Fɔngbè ɖò gbɛ̀ yɔ̌yɔ́ mɛ');
    expect(html).toContain('action="/api/public/reactions/form"');
    expect(html).toContain('Nǔ-ba-kpɔ́n');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('/p/fr/histoire-vivante-fongbe-numerique');
    expect(html).toContain('/p/en/living-history-digital-fongbe');
    expect(html).not.toContain('hreflang="fon"');
    expect(html).toContain('application/ld+json');
  });
});

describe('AILEA PostManager — Security Guards', () => {
  it('enforces sliding-window rate limits and validates PNG/JPEG magic bytes', () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    expect(limiter.consume('visitor_1').allowed).toBe(true);
    expect(limiter.consume('visitor_1').allowed).toBe(true);
    expect(limiter.consume('visitor_1').allowed).toBe(false);

    const fakePng = Buffer.from('not-a-png');
    expect(validateImageBuffer('image/png', fakePng).ok).toBe(false);

    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateImageBuffer('image/png', validPng).ok).toBe(true);
  });

  it('renders external links and images once without duplicate HTML attributes (RED-021)', () => {
    const html = sanitizeAndRenderMarkdown('[Lien](https://ailea.example) ![Cover](https://ailea.example/a.jpg)');
    expect((html.match(/target="_blank"/g) || []).length).toBe(1);
    expect((html.match(/rel="noopener noreferrer"/g) || []).length).toBe(1);
    expect((html.match(/loading="lazy"/g) || []).length).toBe(1);
  });

  it('rejects unsafe javascript: canonicalUrl and ogImageUrl in resolvePostSEO (RED-014, RED-022)', () => {
    const { workspace, bundle } = makeFixtureBundle();
    bundle.seo.fr!.canonicalUrl = 'javascript:alert(1)';
    bundle.seo.fr!.ogImageUrl = 'data:text/html,<script>alert(1)</script>';
    bundle.post.featuredImageUrl = 'javascript:alert(2)';
    const resolved = resolvePostSEO({
      baseUrl: workspace.baseUrl,
      brandName: workspace.brandName,
      post: bundle.post,
      locale: 'fr',
      translation: bundle.translations.fr!,
      allTranslations: bundle.translations,
      seoSetting: bundle.seo.fr,
    });
    expect(resolved.canonicalUrl).toBe('https://ailea.example/p/fr/histoire-vivante-fongbe-numerique');
    expect(resolved.ogImageUrl).toBe('');
  });

  it('fails closed when getHmacSecret runs in production without emulator and missing REACTION_HMAC_SECRET (RED-018)', async () => {
    const { getHmacSecret } = await import('../src/server/security.ts');
    const prevSecret = process.env.REACTION_HMAC_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFs = process.env.FIRESTORE_EMULATOR_HOST;
    const prevAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const prevSt = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    const prevUseEmu = process.env.USE_FIREBASE_EMULATOR;
    try {
      delete process.env.REACTION_HMAC_SECRET;
      delete process.env.FIRESTORE_EMULATOR_HOST;
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      delete process.env.USE_FIREBASE_EMULATOR;
      process.env.NODE_ENV = 'production';
      expect(() => getHmacSecret()).toThrow(/SECURITY_CONFIG_ERROR/);
    } finally {
      if (prevSecret) process.env.REACTION_HMAC_SECRET = prevSecret;
      else delete process.env.REACTION_HMAC_SECRET;
      if (prevFs) process.env.FIRESTORE_EMULATOR_HOST = prevFs;
      if (prevAuth) process.env.FIREBASE_AUTH_EMULATOR_HOST = prevAuth;
      if (prevSt) process.env.FIREBASE_STORAGE_EMULATOR_HOST = prevSt;
      if (prevUseEmu) process.env.USE_FIREBASE_EMULATOR = prevUseEmu;
      process.env.NODE_ENV = prevNodeEnv;
    }
  });
});

describe('AILEA PostManager — Express SSR & Security Integration', () => {
  it('serves health, robots.txt, sitemap.xml, SSR /p/fr, 404 for unpublished slugs, and 401 for unauthenticated admin routes', async () => {
    const { assertLocalEmulatorEnvironment } = await import('../src/server/emulatorGuard.ts');
    const { resetFirebaseAdminForTests } = await import('../src/server/firebaseAdmin.ts');
    assertLocalEmulatorEnvironment();

    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { createApp } = await import('../server.ts');
    const app = await createApp();
    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    try {
      const healthRes = await fetch(`${base}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = (await healthRes.json()) as { ok: boolean };
      expect(healthJson.ok).toBe(true);

      const robotsRes = await fetch(`${base}/robots.txt`);
      expect(robotsRes.status).toBe(200);
      expect(await robotsRes.text()).toContain('Disallow: /api/admin/');

      const sitemapRes = await fetch(`${base}/sitemap.xml`);
      expect(sitemapRes.status).toBe(200);
      const sitemapXml = await sitemapRes.text();
      expect(sitemapXml).toContain('<urlset');
      expect(sitemapXml).not.toContain('hreflang="fon"');

      const indexRes = await fetch(`${base}/p/fr`);
      expect(indexRes.status).toBe(200);
      const indexHtml = await indexRes.text();
      expect(indexHtml).toContain('<html lang="fr">');

      const draftRes = await fetch(`${base}/p/fr/unpublished-draft-must-stay-private`);
      expect(draftRes.status).toBe(404);

      const adminRes = await fetch(`${base}/api/admin/bootstrap`, { method: 'POST' });
      expect(adminRes.status).toBe(401);

      const badReaction = await fetch(`${base}/api/public/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: 'nonexistent', locale: 'fr', semanticKey: 'curiosity' }),
      });
      expect(badReaction.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.env.NODE_ENV = prevNodeEnv;
      await resetFirebaseAdminForTests();
    }
  });
});

