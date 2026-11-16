import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UI_STRINGS } from '../src/shared/i18n.ts';
import type { FullPostBundle, UserRole } from '../src/shared/types.ts';

let mockedRole: UserRole = 'editor';

const fixtureBundle: FullPostBundle = {
  post: {
    id: 'post_ssr_1',
    workspaceId: 'ws_ssr',
    authorId: 'u_1',
    authorName: 'Auteur',
    primaryLocale: 'fr',
    status: 'draft',
    categoryId: null,
    tagIds: [],
    featuredImageUrl: '',
    reactionLimit: 1,
    allowReactionChange: true,
    currentVersionNumber: 1,
    publishedVersionNumber: null,
    publishedAt: null,
    createdAt: '2026-11-15T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
  },
  translations: {
    fr: {
      id: 'post_ssr_1_fr',
      postId: 'post_ssr_1',
      workspaceId: 'ws_ssr',
      locale: 'fr',
      title: 'Titre Français',
      slug: 'titre-francais',
      excerpt: 'Extrait FR',
      markdownContent: 'Contenu FR complet',
      sanitizedHtml: '<p>Contenu FR complet</p>',
      frontmatterJson: {},
      translationStatus: 'approved',
      linguisticNotes: '',
      approvedBy: 'u_1',
      approvedAt: '2026-11-15T10:00:00.000Z',
      wordCount: 3,
      readingTimeMinutes: 1,
      updatedAt: '2026-11-15T10:00:00.000Z',
    },
    en: null,
    fon: {
      id: 'post_ssr_1_fon',
      postId: 'post_ssr_1',
      workspaceId: 'ws_ssr',
      locale: 'fon',
      title: 'Xótà Fɔngbè Tɔn',
      slug: 'xota-fongbe-ton',
      excerpt: 'Kpɛɖé',
      markdownContent: 'Wlǎn xó ɖò Fɔngbè mɛ gànjí',
      sanitizedHtml: '<p>Wlǎn xó ɖò Fɔngbè mɛ gànjí</p>',
      frontmatterJson: {},
      translationStatus: 'in_review',
      linguisticNotes: 'Tons vérifiés',
      approvedBy: null,
      approvedAt: null,
      wordCount: 5,
      readingTimeMinutes: 1,
      updatedAt: '2026-11-15T10:00:00.000Z',
    },
  },
  reactions: [],
  seo: { fr: null, en: null, fon: null },
  versions: [],
  publishingEvents: [],
};

vi.mock('../src/contexts/AuthContext.tsx', () => ({
  useAuth: () => ({
    posts: [fixtureBundle],
    setPosts: vi.fn(),
    role: mockedRole,
  }),
}));

vi.mock('../src/contexts/I18nContext.tsx', () => ({
  useI18n: () => ({
    locale: 'fr' as const,
    setLocale: vi.fn(),
    t: UI_STRINGS.fr,
  }),
}));

import { TranslationStudioModule } from '../src/modules/TranslationStudioModule.tsx';

describe('TranslationStudioModule — AUDIT-004 Initial Render & RBAC Gate', () => {
  it('renders initial SSR HTML without TDZ ReferenceError and seeds Fongbe state immediately', () => {
    mockedRole = 'editor';
    const editorHtml = renderToStaticMarkup(
      React.createElement(TranslationStudioModule, {
        selectedPostId: 'post_ssr_1',
        onSelectPost: () => {},
      })
    );
    expect(editorHtml).toContain('Xótà Fɔngbè Tɔn');
    expect(editorHtml).toContain('xota-fongbe-ton');
    expect(editorHtml).toContain('Wlǎn xó ɖò Fɔngbè mɛ gànjí');
    // For editor role targeting 'fon', approve button must be disabled
    expect(editorHtml).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Approuver la traduction<\/button>/);

    mockedRole = 'reviewer';
    const reviewerHtml = renderToStaticMarkup(
      React.createElement(TranslationStudioModule, {
        selectedPostId: 'post_ssr_1',
        onSelectPost: () => {},
      })
    );
    const approveButtonMatch = reviewerHtml.match(/<button[^>]*>[^]*?Approuver la traduction<\/button>/);
    expect(approveButtonMatch).not.toBeNull();
    expect(approveButtonMatch![0]).not.toContain('disabled=');
  });
});
