import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UI_STRINGS } from '../src/shared/i18n.ts';
import type { FullPostBundle, Locale, UserRole } from '../src/shared/types.ts';

let mockedRole: UserRole = 'editor';
let mockedPosts: FullPostBundle[] = [];
let mockedUiLocale: Locale = 'fr';

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
    en: {
      id: 'post_ssr_1_en',
      postId: 'post_ssr_1',
      workspaceId: 'ws_ssr',
      locale: 'en',
      title: 'English Heading',
      slug: 'english-heading',
      excerpt: 'English excerpt',
      markdownContent: 'Full English content',
      sanitizedHtml: '<p>Full English content</p>',
      frontmatterJson: {},
      translationStatus: 'draft',
      linguisticNotes: '',
      approvedBy: null,
      approvedAt: null,
      wordCount: 3,
      readingTimeMinutes: 1,
      updatedAt: '2026-11-15T10:00:00.000Z',
    },
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

mockedPosts = [fixtureBundle];

vi.mock('../src/contexts/AuthContext.tsx', () => ({
  useAuth: () => ({
    posts: mockedPosts,
    setPosts: vi.fn(),
    role: mockedRole,
  }),
}));

vi.mock('../src/contexts/I18nContext.tsx', () => ({
  useI18n: () => ({
    locale: mockedUiLocale,
    setLocale: vi.fn(),
    t: UI_STRINGS[mockedUiLocale],
  }),
}));

import { TranslationStudioModule } from '../src/modules/TranslationStudioModule.tsx';

describe('TranslationStudioModule — AUDIT-004 Initial Render, Locale Selection & RBAC Gate', () => {
  it('renders initial SSR HTML without TDZ ReferenceError and enforces RBAC on Fongbe approval controls', () => {
    mockedPosts = [fixtureBundle];
    mockedUiLocale = 'fr';
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

  it('switches rendered targetLocale (fr/en/fon) and UI interface language cleanly without runtime errors', () => {
    mockedPosts = [fixtureBundle];
    mockedRole = 'editor';

    // Target English with UI in English: editor CAN approve English
    mockedUiLocale = 'en';
    const enTargetHtml = renderToStaticMarkup(
      React.createElement(TranslationStudioModule, {
        selectedPostId: 'post_ssr_1',
        onSelectPost: () => {},
        initialTargetLocale: 'en',
      })
    );
    expect(enTargetHtml).toContain('English Heading');
    expect(enTargetHtml).toContain('english-heading');
    expect(enTargetHtml).toContain('Full English content');
    expect(enTargetHtml).toContain(UI_STRINGS.en.translations.title);
    const enApproveLabel = UI_STRINGS.en.translations.approveTranslation;
    const enApproveBtn = enTargetHtml.match(
      new RegExp(`<button[^>]*>(?:(?!<\\/button>).)*${enApproveLabel}<\\/button>`)
    );
    expect(enApproveBtn).not.toBeNull();
    expect(enApproveBtn![0]).not.toContain('disabled=');

    // Target French with UI in Fongbe: renders French fields under Fongbe UI chrome
    mockedUiLocale = 'fon';
    const frTargetFonUiHtml = renderToStaticMarkup(
      React.createElement(TranslationStudioModule, {
        selectedPostId: 'post_ssr_1',
        onSelectPost: () => {},
        initialTargetLocale: 'fr',
      })
    );
    expect(frTargetFonUiHtml).toContain('Titre Français');
    expect(frTargetFonUiHtml).toContain('titre-francais');
    expect(frTargetFonUiHtml).toContain(UI_STRINGS.fon.translations.title);

    // Empty post list renders clean localized empty state without errors
    mockedPosts = [];
    mockedUiLocale = 'fr';
    const emptyHtml = renderToStaticMarkup(
      React.createElement(TranslationStudioModule, {
        selectedPostId: null,
        onSelectPost: () => {},
      })
    );
    expect(emptyHtml).toContain(UI_STRINGS.fr.common.empty);
  });
});
