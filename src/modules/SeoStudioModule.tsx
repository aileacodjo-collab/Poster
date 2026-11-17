import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Globe, Info, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { buildPublicPostPath, resolvePostSEO } from '../shared/seo.ts';
import { FullPostBundle, Locale, SUPPORTED_LOCALES } from '../shared/types.ts';

interface SeoStudioModuleProps {
  selectedPostId: string | null;
  onSelectPost: (postId: string | null) => void;
}

export function SeoStudioModule({ selectedPostId, onSelectPost }: SeoStudioModuleProps) {
  const { posts, setPosts, workspace, mediaAssets, role } = useAuth();
  const { t } = useI18n();
  const canEdit = role === 'owner' || role === 'editor';

  const activeBundle = useMemo(
    () => posts.find((b) => b.post.id === selectedPostId) || posts[0] || null,
    [posts, selectedPostId]
  );

  const [seoLocale, setSeoLocale] = useState<Locale>('fr');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');
  const [twitterCardType, setTwitterCardType] = useState<'summary' | 'summary_large_image'>('summary_large_image');
  const [schemaType, setSchemaType] = useState<'BlogPosting' | 'Article' | 'NewsArticle'>('BlogPosting');
  const [noIndex, setNoIndex] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBundle) return;
    if (!selectedPostId) onSelectPost(activeBundle.post.id);
    const s = activeBundle.seo[seoLocale];
    const tr = activeBundle.translations[seoLocale];
    setMetaTitle(s?.metaTitle || tr?.title || '');
    setMetaDescription(s?.metaDescription || tr?.excerpt || '');
    setCanonicalUrl(s?.canonicalUrl || '');
    setOgTitle(s?.ogTitle || s?.metaTitle || tr?.title || '');
    setOgDescription(s?.ogDescription || s?.metaDescription || tr?.excerpt || '');
    setOgImageUrl(s?.ogImageUrl || activeBundle.post.featuredImageUrl || '');
    setTwitterCardType(s?.twitterCardType || 'summary_large_image');
    setSchemaType(s?.schemaType || 'BlogPosting');
    setNoIndex(Boolean(s?.noIndex));
    setFeedback(null);
  }, [activeBundle?.post.id, activeBundle?.post.updatedAt, seoLocale]);

  const resolvedSeo = useMemo(() => {
    if (!activeBundle || !workspace) return null;
    const tr = activeBundle.translations[seoLocale];
    if (!tr) return null;
    const baseUrl =
      typeof window !== 'undefined' ? window.location.origin : workspace.baseUrl || 'http://localhost:3000';
    return resolvePostSEO({
      baseUrl,
      brandName: workspace.brandName,
      post: activeBundle.post,
      locale: seoLocale,
      translation: tr,
      allTranslations: activeBundle.translations,
      seoSetting: {
        id: `${activeBundle.post.id}_${seoLocale}`,
        postId: activeBundle.post.id,
        workspaceId: workspace.id,
        locale: seoLocale,
        metaTitle,
        metaDescription,
        canonicalUrl,
        ogTitle,
        ogDescription,
        ogImageUrl,
        twitterCardType,
        schemaType,
        noIndex,
        updatedAt: new Date().toISOString(),
      },
    });
  }, [
    activeBundle,
    workspace,
    seoLocale,
    metaTitle,
    metaDescription,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogImageUrl,
    twitterCardType,
    schemaType,
    noIndex,
  ]);

  const handleSaveSeo = async () => {
    if (!activeBundle || !canEdit) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/seo/${seoLocale}`,
        {
          method: 'PUT',
          body: {
            metaTitle,
            metaDescription,
            canonicalUrl,
            ogTitle,
            ogDescription,
            ogImageUrl,
            twitterCardType,
            schemaType,
            noIndex,
          },
        }
      );
      setPosts((prev) => prev.map((b) => (b.post.id === res.bundle.post.id ? res.bundle : b)));
      setFeedback(t.common.saved);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (!activeBundle) {
    return <div className="clay-card p-10 text-center text-[#525866]">{t.common.empty}</div>;
  }

  const tr = activeBundle.translations[seoLocale];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17191C]">{t.seo.title}</h1>
          <p className="text-sm text-[#525866] mt-1">{t.seo.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={activeBundle.post.id}
            onChange={(e) => onSelectPost(e.target.value)}
            className="clay-input w-auto min-w-[240px] font-semibold"
          >
            {posts.map((b) => (
              <option key={b.post.id} value={b.post.id}>
                {b.translations[b.post.primaryLocale]?.title || b.translations.fr?.title || t.common.untitled}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-white border border-[#DFE5EC] p-1 rounded-[10px]">
            {SUPPORTED_LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setSeoLocale(loc)}
                className={`min-h-[40px] px-3 rounded-[8px] text-xs font-bold uppercase cursor-pointer ${
                  seoLocale === loc ? 'bg-[#E5F3EA] text-[#006B35]' : 'text-[#525866]'
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="clay-surface-mint p-4 flex items-start gap-3 text-sm text-[#133924]">
        <Info className="w-5 h-5 text-[#006B35] shrink-0 mt-0.5" />
        <div>{t.seo.hreflangNote}</div>
      </div>

      {feedback && (
        <div className="clay-card p-4 text-sm font-medium text-[#006B35] bg-[#E5F3EA]">
          {feedback}
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 clay-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#17191C]">
              {t.seo.metadataHeading} ({seoLocale.toUpperCase()})
            </h2>
            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveSeo}
                className="clay-btn-primary text-sm"
              >
                <Save className="w-4 h-4" />
                {t.common.save}
              </button>
            )}
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold text-[#525866] mb-1">
              <span>{t.seo.metaTitle}</span>
              <span className="font-mono-tabular">{metaTitle.length} / 60</span>
            </div>
            <input
              type="text"
              disabled={!canEdit}
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              className="clay-input"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs font-semibold text-[#525866] mb-1">
              <span>{t.seo.metaDescription}</span>
              <span className="font-mono-tabular">{metaDescription.length} / 160</span>
            </div>
            <textarea
              rows={3}
              disabled={!canEdit}
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              className="clay-input"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#525866] mb-1">
              {t.seo.canonicalUrl}
            </label>
            <input
              type="text"
              disabled={!canEdit}
              value={canonicalUrl}
              onChange={(e) => setCanonicalUrl(e.target.value)}
              placeholder={tr ? buildPublicPostPath(seoLocale, tr.slug) : ''}
              className="clay-input font-mono-tabular text-sm"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.seo.ogImage}
              </label>
              <select
                disabled={!canEdit}
                value={ogImageUrl}
                onChange={(e) => setOgImageUrl(e.target.value)}
                className="clay-input text-sm"
              >
                <option value="">{t.common.none}</option>
                {mediaAssets.map((m) => (
                  <option key={m.id} value={m.url}>
                    {m.filename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                Schema.org
              </label>
              <select
                disabled={!canEdit}
                value={schemaType}
                onChange={(e) => setSchemaType(e.target.value as 'BlogPosting' | 'Article' | 'NewsArticle')}
                className="clay-input text-sm"
              >
                <option value="BlogPosting">BlogPosting</option>
                <option value="Article">Article</option>
                <option value="NewsArticle">NewsArticle</option>
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                Twitter / X Card
              </label>
              <select
                disabled={!canEdit}
                value={twitterCardType}
                onChange={(e) => setTwitterCardType(e.target.value as 'summary' | 'summary_large_image')}
                className="clay-input text-sm"
              >
                <option value="summary_large_image">summary_large_image</option>
                <option value="summary">summary</option>
              </select>
            </div>
            <label className="flex items-center gap-3 min-h-[48px] pt-4 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={noIndex}
                onChange={(e) => setNoIndex(e.target.checked)}
                className="w-5 h-5 accent-[#006B35]"
              />
              <span className="text-sm font-semibold text-[#17191C]">{t.seo.noindexLabel}</span>
            </label>
          </div>
        </div>

        {/* Live Previews & Sitemap Links */}
        <div className="lg:col-span-5 space-y-4">
          {resolvedSeo && (
            <>
              <div className="clay-card p-5 space-y-2">
                <div className="text-xs font-semibold text-[#525866]">{t.seo.serpPreviewHeading}</div>
                <div className="text-xs text-[#006B35] font-mono-tabular truncate">
                  {resolvedSeo.canonicalUrl}
                </div>
                <div className="text-base font-bold text-[#17191C]">{resolvedSeo.title}</div>
                <p className="text-xs text-[#525866] leading-relaxed">{resolvedSeo.description}</p>
              </div>

              <div className="clay-card p-5 space-y-2">
                <div className="text-xs font-semibold text-[#525866]">
                  {t.seo.hreflangHeading}
                </div>
                {resolvedSeo.hreflangs.length === 0 ? (
                  <p className="text-xs text-[#525866]">
                    {t.seo.noHreflangNote}
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs font-mono-tabular text-[#17191C]">
                    {resolvedSeo.hreflangs.map((h) => (
                      <li key={h.hreflang} className="truncate">
                        {h.hreflang} → {h.href}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="clay-card p-5 space-y-2">
                <div className="text-xs font-semibold text-[#525866]">{t.seo.schemaPreview}</div>
                <pre className="text-xs font-mono-tabular bg-[#17191C] text-[#F1F4F6] p-3.5 rounded-[10px] overflow-x-auto max-h-56">
                  {JSON.stringify(resolvedSeo.jsonLd, null, 2)}
                </pre>
              </div>
            </>
          )}

          <div className="clay-card p-5 flex flex-wrap gap-3">
            <a
              href="/sitemap.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="clay-btn-secondary text-sm flex-1"
            >
              <Globe className="w-4 h-4" />
              {t.seo.sitemapInspect}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href="/robots.txt"
              target="_blank"
              rel="noopener noreferrer"
              className="clay-btn-secondary text-sm flex-1"
            >
              {t.seo.robotsInspect}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
