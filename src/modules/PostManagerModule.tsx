import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileUp,
  History,
  Plus,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { AuthorizedMediaImage } from '../components/AuthorizedMediaImage.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import {
  generateSlug,
  parseMarkdownWithFrontmatter,
  sanitizeAndRenderMarkdown,
  validatePostForPublication,
} from '../shared/markdown.ts';
import { buildPublicPostPath } from '../shared/seo.ts';
import { FullPostBundle, Locale, SUPPORTED_LOCALES } from '../shared/types.ts';

interface PostManagerModuleProps {
  selectedPostId: string | null;
  onSelectPost: (postId: string | null) => void;
  openCreateModal?: boolean;
  openImportModal?: boolean;
  onCloseModals?: () => void;
}

export function PostManagerModule({
  selectedPostId,
  onSelectPost,
  openCreateModal,
  openImportModal,
  onCloseModals,
}: PostManagerModuleProps) {
  const { posts, setPosts, categories, mediaAssets, role } = useAuth();
  const { t } = useI18n();
  const canEdit = role === 'owner' || role === 'editor';

  const activeBundle = useMemo(
    () => posts.find((b) => b.post.id === selectedPostId) || posts[0] || null,
    [posts, selectedPostId]
  );

  const [editLocale, setEditLocale] = useState<Locale>('fr');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [featuredImageUrl, setFeaturedImageUrl] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [importText, setImportText] = useState(
    `---\ntitle: Nouvel article éditorial\nslug: nouvel-article-editorial\nlocale: fr\nexcerpt: Résumé concis de votre publication multilingue.\n---\n\n## Introduction\n\nÉcrivez votre article en **Markdown** avec tableaux GFM, citations et listes de tâches.\n\n- [x] Rédaction en français\n- [ ] Traduction anglaise\n- [ ] Révision fɔngbè\n`
  );
  const [tab, setTab] = useState<'editor' | 'versions'>('editor');

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (openCreateModal) setShowCreate(true);
    if (openImportModal) setShowImport(true);
  }, [openCreateModal, openImportModal]);

  useEffect(() => {
    if (!activeBundle) return;
    if (!selectedPostId) onSelectPost(activeBundle.post.id);
    const tr = activeBundle.translations[editLocale];
    setTitle(tr?.title || '');
    setSlug(tr?.slug || '');
    setExcerpt(tr?.excerpt || '');
    setMarkdown(tr?.markdownContent || '');
    setFeaturedImageUrl(activeBundle.post.featuredImageUrl || '');
    setCategoryId(activeBundle.post.categoryId || '');
    dirtyRef.current = false;
    setSavingState('idle');
  }, [activeBundle?.post.id, editLocale]);

  const parsedFm = useMemo(() => parseMarkdownWithFrontmatter(markdown), [markdown]);
  const previewHtml = useMemo(() => sanitizeAndRenderMarkdown(parsedFm.body), [parsedFm.body]);

  const liveBundleForValidation: FullPostBundle | null = useMemo(() => {
    if (!activeBundle) return null;
    const currentTr = activeBundle.translations[editLocale];
    return {
      ...activeBundle,
      post: {
        ...activeBundle.post,
        featuredImageUrl,
        categoryId: categoryId || null,
      },
      translations: {
        ...activeBundle.translations,
        [editLocale]: currentTr
          ? {
              ...currentTr,
              title,
              slug,
              excerpt,
              markdownContent: markdown,
            }
          : null,
      },
    };
  }, [activeBundle, editLocale, title, slug, excerpt, markdown, featuredImageUrl, categoryId]);

  const validationReport = useMemo(() => {
    if (!liveBundleForValidation) return { valid: false, errors: [], warnings: [] };
    return validatePostForPublication(liveBundleForValidation);
  }, [liveBundleForValidation]);

  const persistSave = async (createCheckpoint = false) => {
    if (!activeBundle || !canEdit) return;
    setSavingState('saving');
    setFeedback(null);
    try {
      await apiRequest(`/api/admin/posts/${activeBundle.post.id}`, {
        method: 'PATCH',
        body: {
          featuredImageUrl,
          categoryId: categoryId || null,
        },
      });
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/translations/${editLocale}`,
        {
          method: 'PUT',
          body: {
            title,
            slug: slug || generateSlug(title),
            excerpt,
            markdownContent: markdown,
            createCheckpoint,
          },
        }
      );
      setPosts((prev) => prev.map((item) => (item.post.id === res.bundle.post.id ? res.bundle : item)));
      dirtyRef.current = false;
      setSavingState('saved');
    } catch (err) {
      setSavingState('error');
      setFeedback(err instanceof Error ? err.message : 'Erreur d’enregistrement.');
    }
  };

  // Draft autosave (debounced 1.8s)
  useEffect(() => {
    if (!dirtyRef.current || !activeBundle || !canEdit) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      persistSave(false);
    }, 1800);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [title, slug, excerpt, markdown, featuredImageUrl, categoryId]);

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setFeedback(null);
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>('/api/admin/posts', {
        method: 'POST',
        body: { title: newTitle.trim(), primaryLocale: 'fr' },
      });
      setPosts((prev) => [res.bundle, ...prev]);
      onSelectPost(res.bundle.post.id);
      setEditLocale('fr');
      setNewTitle('');
      setShowCreate(false);
      onCloseModals?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Création échouée.');
    }
  };

  const handleImportMarkdown = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await apiRequest<{ bundle: FullPostBundle; frontmatterErrors: string[] }>(
        '/api/admin/posts/import',
        {
          method: 'POST',
          body: { rawMarkdown: importText, defaultLocale: 'fr' },
        }
      );
      setPosts((prev) => [res.bundle, ...prev]);
      onSelectPost(res.bundle.post.id);
      setEditLocale(res.bundle.post.primaryLocale);
      setShowImport(false);
      onCloseModals?.();
      if (res.frontmatterErrors.length > 0) {
        setFeedback(`Importé avec avertissements YAML : ${res.frontmatterErrors.join(', ')}`);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Import Markdown échoué.');
    }
  };

  const handleFileUploadImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportText(reader.result);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleExportMarkdown = async () => {
    if (!activeBundle) return;
    try {
      const md = await apiRequest<string>(
        `/api/admin/posts/${activeBundle.post.id}/export?locale=${editLocale}`
      );
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug || activeBundle.post.id}-${editLocale}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Export impossible.');
    }
  };

  const handlePublish = async () => {
    if (!activeBundle) return;
    await persistSave(false);
    setFeedback(null);
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/publish`,
        { method: 'POST' }
      );
      setPosts((prev) => prev.map((b) => (b.post.id === res.bundle.post.id ? res.bundle : b)));
      setFeedback(t.postManager.publishReady);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Publication bloquée.');
    }
  };

  const handleUnpublish = async () => {
    if (!activeBundle) return;
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/unpublish`,
        { method: 'POST' }
      );
      setPosts((prev) => prev.map((b) => (b.post.id === res.bundle.post.id ? res.bundle : b)));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Dépublication impossible.');
    }
  };

  const handleRestoreVersion = async (versionNumber: number) => {
    if (!activeBundle) return;
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/versions/${versionNumber}/restore`,
        { method: 'POST' }
      );
      setPosts((prev) => prev.map((b) => (b.post.id === res.bundle.post.id ? res.bundle : b)));
      const restoredTr = res.bundle.translations[editLocale];
      setTitle(restoredTr?.title || '');
      setSlug(restoredTr?.slug || '');
      setExcerpt(restoredTr?.excerpt || '');
      setMarkdown(restoredTr?.markdownContent || '');
      setFeedback(`Version v${versionNumber} restaurée.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Restauration impossible.');
    }
  };

  const handleDeletePost = async () => {
    if (!activeBundle || !canEdit) return;
    try {
      await apiRequest(`/api/admin/posts/${activeBundle.post.id}`, { method: 'DELETE' });
      const remaining = posts.filter((p) => p.post.id !== activeBundle.post.id);
      setPosts(remaining);
      onSelectPost(remaining[0]?.post.id || null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Suppression impossible.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={activeBundle?.post.id || ''}
            onChange={(e) => onSelectPost(e.target.value)}
            className="clay-input w-auto min-w-[240px] max-w-sm font-semibold"
            aria-label="Sélectionner un article"
          >
            {posts.map((b) => (
              <option key={b.post.id} value={b.post.id}>
                {b.translations[b.post.primaryLocale]?.title || b.translations.fr?.title || 'Sans titre'} (
                {t.statuses[b.post.status]})
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 bg-white border border-[#DFE5EC] p-1 rounded-[10px]">
            {SUPPORTED_LOCALES.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setEditLocale(loc)}
                className={`min-h-[40px] px-3 rounded-[8px] text-xs font-bold uppercase cursor-pointer transition-colors ${
                  editLocale === loc ? 'bg-[#E5F3EA] text-[#006B35]' : 'text-[#525866] hover:text-[#17191C]'
                }`}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canEdit && (
            <>
              <button type="button" onClick={() => setShowImport(true)} className="clay-btn-secondary text-sm">
                <FileUp className="w-4 h-4" />
                {t.common.import}
              </button>
              <button type="button" onClick={() => setShowCreate(true)} className="clay-btn-secondary text-sm">
                <Plus className="w-4 h-4" />
                {t.common.create}
              </button>
            </>
          )}
          {activeBundle && (
            <button type="button" onClick={handleExportMarkdown} className="clay-btn-secondary text-sm">
              <Download className="w-4 h-4" />
              {t.common.export} .md
            </button>
          )}
        </div>
      </div>

      {/* Create Post Modal */}
      {showCreate && (
        <form onSubmit={handleCreatePost} className="clay-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.dashboard.newPost}</h2>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Titre de l’article en français…"
            className="clay-input"
            required
          />
          <div className="flex items-center gap-3">
            <button type="submit" className="clay-btn-primary">
              {t.common.create}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                onCloseModals?.();
              }}
              className="clay-btn-secondary"
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {/* Import Markdown Modal */}
      {showImport && (
        <form onSubmit={handleImportMarkdown} className="clay-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[#17191C]">{t.dashboard.importMarkdown}</h2>
            <label className="clay-btn-secondary text-sm cursor-pointer">
              <FileUp className="w-4 h-4" />
              Charger un fichier .md
              <input type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={handleFileUploadImport} className="hidden" />
            </label>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
            className="clay-input font-mono-tabular text-sm"
            required
          />
          <div className="flex items-center gap-3">
            <button type="submit" className="clay-btn-primary">
              {t.common.import}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowImport(false);
                onCloseModals?.();
              }}
              className="clay-btn-secondary"
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      )}

      {feedback && (
        <div className="clay-card p-4 text-sm font-medium text-[#17191C] border-[#006B35]/30 bg-[#E5F3EA]">
          {feedback}
        </div>
      )}

      {!activeBundle ? (
        <div className="clay-card p-10 text-center text-[#525866]">{t.common.empty}</div>
      ) : (
        <>
          {/* Lifecycle & Tabs */}
          <div className="clay-card p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setTab('editor')}
                className={`min-h-[48px] px-4 rounded-[10px] text-sm font-semibold cursor-pointer ${
                  tab === 'editor' ? 'bg-[#E5F3EA] text-[#006B35]' : 'text-[#525866] hover:bg-[#F1F4F6]'
                }`}
              >
                {t.postManager.markdownEditor}
              </button>
              <button
                type="button"
                onClick={() => setTab('versions')}
                className={`min-h-[48px] px-4 rounded-[10px] text-sm font-semibold inline-flex items-center gap-2 cursor-pointer ${
                  tab === 'versions' ? 'bg-[#E5F3EA] text-[#006B35]' : 'text-[#525866] hover:bg-[#F1F4F6]'
                }`}
              >
                <History className="w-4 h-4" />
                {t.postManager.versionHistory} ({activeBundle.versions.length})
              </button>

              <span className="text-xs font-medium text-[#525866] ml-1">
                {savingState === 'saving'
                  ? t.common.saving
                  : savingState === 'saved'
                    ? t.common.saved
                    : t.postManager.autosaveActive}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {canEdit && (
                <button type="button" onClick={() => persistSave(true)} className="clay-btn-secondary text-sm">
                  <Save className="w-4 h-4" />
                  {t.common.save} (v{activeBundle.post.currentVersionNumber + 1})
                </button>
              )}

              {activeBundle.post.status === 'published' && slug && (
                <a
                  href={buildPublicPostPath(editLocale, slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="clay-btn-secondary text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t.nav.publicSite}
                </a>
              )}

              {canEdit && activeBundle.post.status === 'published' && (
                <button type="button" onClick={handleUnpublish} className="clay-btn-secondary text-sm">
                  {t.common.unpublish}
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={!validationReport.valid}
                  className="clay-btn-primary text-sm"
                >
                  <Send className="w-4 h-4" />
                  {t.common.publish}
                </button>
              )}
            </div>
          </div>

          {tab === 'versions' ? (
            <div className="clay-card p-6 space-y-4">
              <h2 className="text-lg font-bold text-[#17191C]">{t.postManager.versionHistory}</h2>
              {activeBundle.versions.length === 0 ? (
                <p className="text-sm text-[#525866]">{t.common.empty}</p>
              ) : (
                <div className="divide-y divide-[#DFE5EC]">
                  {activeBundle.versions.map((ver) => (
                    <div key={ver.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#17191C] font-mono-tabular">
                          v{ver.versionNumber} · {ver.snapshotType}
                        </div>
                        <div className="text-sm text-[#525866] mt-0.5">{ver.commitMessage}</div>
                        <div className="text-xs text-[#8A94A6] font-mono-tabular mt-0.5">
                          {ver.createdAt.slice(0, 19).replace('T', ' ')}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleRestoreVersion(ver.versionNumber)}
                          className="clay-btn-secondary text-sm"
                        >
                          <RotateCcw className="w-4 h-4" />
                          {t.common.restore}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid xl:grid-cols-12 gap-6">
              {/* Editor Column */}
              <div className="xl:col-span-7 space-y-4">
                <div className="clay-card p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#525866] mb-1.5">
                      Titre ({editLocale.toUpperCase()})
                    </label>
                    <input
                      type="text"
                      value={title}
                      disabled={!canEdit}
                      onChange={(e) => {
                        dirtyRef.current = true;
                        const val = e.target.value;
                        setTitle(val);
                        if (!slug || slug === generateSlug(title)) {
                          setSlug(generateSlug(val));
                        }
                      }}
                      className="clay-input text-lg font-semibold"
                    />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#525866] mb-1.5">
                        {t.postManager.slug}
                      </label>
                      <input
                        type="text"
                        value={slug}
                        disabled={!canEdit}
                        onChange={(e) => {
                          dirtyRef.current = true;
                          setSlug(generateSlug(e.target.value));
                        }}
                        className="clay-input font-mono-tabular text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#525866] mb-1.5">
                        {t.postManager.category}
                      </label>
                      <select
                        value={categoryId}
                        disabled={!canEdit}
                        onChange={(e) => {
                          dirtyRef.current = true;
                          setCategoryId(e.target.value);
                        }}
                        className="clay-input text-sm"
                      >
                        <option value="">—</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.names[editLocale] || cat.names.fr}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#525866] mb-1.5">
                        {t.postManager.featuredImage}
                      </label>
                      <select
                        value={featuredImageUrl}
                        disabled={!canEdit}
                        onChange={(e) => {
                          dirtyRef.current = true;
                          setFeaturedImageUrl(e.target.value);
                        }}
                        className="clay-input text-sm"
                      >
                        <option value="">Aucune image</option>
                        {mediaAssets.map((m) => (
                          <option key={m.id} value={m.url}>
                            {m.filename}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#525866] mb-1.5">
                        {t.postManager.excerpt}
                      </label>
                      <input
                        type="text"
                        value={excerpt}
                        disabled={!canEdit}
                        onChange={(e) => {
                          dirtyRef.current = true;
                          setExcerpt(e.target.value);
                        }}
                        className="clay-input text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[#525866]">
                        {t.postManager.markdownEditor} (CommonMark + GFM + YAML)
                      </label>
                      <span className="text-xs font-mono-tabular text-[#525866]">
                        {markdown.length} car.
                      </span>
                    </div>
                    <textarea
                      value={markdown}
                      disabled={!canEdit}
                      onChange={(e) => {
                        dirtyRef.current = true;
                        setMarkdown(e.target.value);
                      }}
                      rows={16}
                      className="clay-input font-mono-tabular text-sm leading-relaxed"
                    />
                  </div>

                  {canEdit && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={handleDeletePost}
                        className="min-h-[48px] px-3 rounded-[10px] text-sm font-semibold text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        {t.common.delete}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Preview + Validation Gate */}
              <div className="xl:col-span-5 space-y-4">
                <div className="clay-card p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#17191C]">{t.postManager.validationGate}</h2>
                    {validationReport.valid ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#006B35]">
                        <CheckCircle2 className="w-4 h-4" />
                        {t.postManager.publishReady}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700">
                        <AlertTriangle className="w-4 h-4" />
                        {t.postManager.publishBlocked}
                      </span>
                    )}
                  </div>

                  {validationReport.errors.length > 0 && (
                    <ul className="space-y-1.5 text-xs text-red-700">
                      {validationReport.errors.map((err, idx) => (
                        <li key={idx}>• {err.message}</li>
                      ))}
                    </ul>
                  )}

                  {validationReport.warnings.length > 0 && (
                    <ul className="space-y-1 text-xs text-amber-800">
                      {validationReport.warnings.map((w, idx) => (
                        <li key={idx}>• {w.message}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="clay-card p-6">
                  <div className="text-xs font-semibold text-[#525866] mb-3">
                    {t.postManager.livePreview} ({editLocale.toUpperCase()})
                  </div>
                  <h2 className="font-editorial text-2xl font-bold text-[#17191C] mb-4">
                    {title || 'Sans titre'}
                  </h2>
                  {featuredImageUrl && (
                    <AuthorizedMediaImage
                      src={featuredImageUrl}
                      alt={title}
                      className="w-full aspect-video object-cover rounded-[12px] mb-5"
                    />
                  )}
                  <div
                    className="ailea-prose"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
