import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { FONGBE_CHARACTER_BAR, LOCALE_META } from '../shared/i18n.ts';
import { generateSlug, sanitizeAndRenderMarkdown } from '../shared/markdown.ts';
import { FullPostBundle, Locale, SUPPORTED_LOCALES, TranslationStatus } from '../shared/types.ts';

interface TranslationStudioModuleProps {
  selectedPostId: string | null;
  onSelectPost: (postId: string | null) => void;
}

export function TranslationStudioModule({ selectedPostId, onSelectPost }: TranslationStudioModuleProps) {
  const { posts, setPosts, role } = useAuth();
  const { t } = useI18n();
  const canEdit = role === 'owner' || role === 'editor' || role === 'reviewer';

  const activeBundle = useMemo(
    () => posts.find((b) => b.post.id === selectedPostId) || posts[0] || null,
    [posts, selectedPostId]
  );

  const [refLocale, setRefLocale] = useState<Locale>('fr');
  const [targetLocale, setTargetLocale] = useState<Locale>('fon');
  const canApproveCurrentLocale = targetLocale === 'fon' ? role === 'owner' || role === 'reviewer' : canEdit;
  const initialTargetTr = activeBundle?.translations[targetLocale] || null;
  const [title, setTitle] = useState(initialTargetTr?.title || '');
  const [slug, setSlug] = useState(initialTargetTr?.slug || '');
  const [excerpt, setExcerpt] = useState(initialTargetTr?.excerpt || '');
  const [markdownContent, setMarkdownContent] = useState(initialTargetTr?.markdownContent || '');
  const [linguisticNotes, setLinguisticNotes] = useState(initialTargetTr?.linguisticNotes || '');
  const [translationStatus, setTranslationStatus] = useState<TranslationStatus>(
    initialTargetTr?.translationStatus || 'missing'
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!activeBundle) return;
    if (!selectedPostId) onSelectPost(activeBundle.post.id);
    const tr = activeBundle.translations[targetLocale];
    setTitle(tr?.title || '');
    setSlug(tr?.slug || '');
    setExcerpt(tr?.excerpt || '');
    setMarkdownContent(tr?.markdownContent || '');
    setLinguisticNotes(tr?.linguisticNotes || '');
    setTranslationStatus(tr?.translationStatus || 'missing');
    setFeedback(null);
  }, [activeBundle?.post.id, targetLocale]);

  const refTr = activeBundle?.translations[refLocale] || null;

  const insertFongbeChar = (char: string) => {
    const el = textareaRef.current;
    if (!el) {
      setMarkdownContent((prev) => prev + char);
      return;
    }
    const start = el.selectionStart ?? markdownContent.length;
    const end = el.selectionEnd ?? markdownContent.length;
    const next = markdownContent.slice(0, start) + char + markdownContent.slice(end);
    setMarkdownContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + char.length, start + char.length);
    });
  };

  const handleSaveTranslation = async (overrideStatus?: TranslationStatus) => {
    if (!activeBundle || !canEdit) return;
    setSaving(true);
    setFeedback(null);
    const nextStatus = overrideStatus || (translationStatus === 'missing' ? 'draft' : translationStatus);
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/translations/${targetLocale}`,
        {
          method: 'PUT',
          body: {
            title,
            slug: slug || generateSlug(title),
            excerpt,
            markdownContent,
            translationStatus: nextStatus,
            linguisticNotes,
          },
        }
      );
      setPosts((prev) => prev.map((b) => (b.post.id === res.bundle.post.id ? res.bundle : b)));
      setTranslationStatus(res.bundle.translations[targetLocale]?.translationStatus || nextStatus);
      setFeedback(`${LOCALE_META[targetLocale].nativeName} — ${t.common.saved}`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur d’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  if (!activeBundle) {
    return <div className="clay-card p-10 text-center text-[#525866]">{t.common.empty}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17191C]">{t.translations.title}</h1>
          <p className="text-sm text-[#525866] mt-1">{t.translations.subtitle}</p>
        </div>

        <select
          value={activeBundle.post.id}
          onChange={(e) => onSelectPost(e.target.value)}
          className="clay-input w-auto min-w-[260px] font-semibold"
        >
          {posts.map((b) => (
            <option key={b.post.id} value={b.post.id}>
              {b.translations[b.post.primaryLocale]?.title || b.translations.fr?.title || 'Sans titre'}
            </option>
          ))}
        </select>
      </div>

      {/* Language Readiness Strip */}
      <div className="grid sm:grid-cols-3 gap-4">
        {SUPPORTED_LOCALES.map((loc) => {
          const tr = activeBundle.translations[loc];
          const st = tr?.translationStatus || 'missing';
          const selected = loc === targetLocale;
          return (
            <button
              key={loc}
              type="button"
              onClick={() => setTargetLocale(loc)}
              className={`clay-card p-4 text-left transition-all cursor-pointer ${
                selected ? 'ring-2 ring-[#006B35] bg-[#E5F3EA]/40' : 'hover:bg-white/90'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#17191C]">{LOCALE_META[loc].nativeName}</span>
                <span
                  className={`text-xs font-bold ${
                    st === 'approved' ? 'text-[#006B35]' : st === 'in_review' ? 'text-amber-700' : 'text-[#525866]'
                  }`}
                >
                  {t.statuses[st]}
                </span>
              </div>
              <div className="text-xs text-[#525866] mt-1 truncate">
                {tr?.title || '—'}
              </div>
              <div className="text-xs text-[#8A94A6] font-mono-tabular mt-1">
                {tr?.wordCount || 0} mots · /{loc}/{tr?.slug || '…'}
              </div>
            </button>
          );
        })}
      </div>

      {targetLocale === 'fon' && (
        <div className="clay-surface-mint p-4 flex items-start gap-3 text-sm text-[#133924]">
          <AlertCircle className="w-5 h-5 text-[#006B35] shrink-0 mt-0.5" />
          <div>{t.translations.fongbeReviewNotice}</div>
        </div>
      )}

      {feedback && (
        <div className="clay-card p-4 text-sm font-medium text-[#006B35] bg-[#E5F3EA]">
          {feedback}
        </div>
      )}

      {/* Side-by-Side Workspace */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Reference Column */}
        <div className="clay-card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold text-[#17191C]">{t.translations.referenceLocale}</span>
            <select
              value={refLocale}
              onChange={(e) => setRefLocale(e.target.value as Locale)}
              className="clay-input w-auto text-sm font-semibold"
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_META[loc].nativeName}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 border-t border-[#DFE5EC] space-y-3">
            <h2 className="font-editorial text-xl font-bold text-[#17191C]">
              {refTr?.title || '—'}
            </h2>
            <p className="text-xs font-mono-tabular text-[#525866]">
              /{refLocale}/{refTr?.slug || '—'}
            </p>
            <div
              className="ailea-prose max-h-[520px] overflow-y-auto pr-2"
              dangerouslySetInnerHTML={{
                __html: sanitizeAndRenderMarkdown(refTr?.markdownContent || ''),
              }}
            />
          </div>
        </div>

        {/* Target Translation Editor */}
        <div className="clay-card p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-[#17191C]">
              {t.translations.targetLocale} · {LOCALE_META[targetLocale].nativeName}
            </span>
            <span className="text-xs font-bold text-[#006B35]">
              {t.statuses[translationStatus]}
            </span>
          </div>

          {/* Fongbe Unicode & Tone Helper */}
          <div className="p-3 rounded-[10px] bg-[#F1F4F6] border border-[#DFE5EC]">
            <div className="text-xs font-semibold text-[#525866] mb-2">
              {t.translations.diacriticHelper}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FONGBE_CHARACTER_BAR.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => insertFongbeChar(item.char)}
                  title={item.label}
                  className="min-h-[40px] min-w-[40px] px-2.5 rounded-[8px] bg-white border border-[#DFE5EC] text-sm font-semibold text-[#17191C] hover:bg-[#E5F3EA] hover:border-[#006B35] cursor-pointer"
                >
                  {item.char}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#525866] mb-1">
              Titre ({LOCALE_META[targetLocale].nativeName})
            </label>
            <input
              type="text"
              value={title}
              disabled={!canEdit}
              onChange={(e) => {
                const val = e.target.value;
                setTitle(val);
                if (!slug || slug === generateSlug(title) || slug.endsWith(`-${targetLocale}`)) {
                  setSlug(generateSlug(val));
                }
              }}
              className="clay-input font-semibold"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.postManager.slug}
              </label>
              <input
                type="text"
                value={slug}
                disabled={!canEdit}
                onChange={(e) => setSlug(generateSlug(e.target.value))}
                className="clay-input font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.postManager.excerpt}
              </label>
              <input
                type="text"
                value={excerpt}
                disabled={!canEdit}
                onChange={(e) => setExcerpt(e.target.value)}
                className="clay-input text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#525866] mb-1">
              Markdown ({LOCALE_META[targetLocale].nativeName})
            </label>
            <textarea
              ref={textareaRef}
              value={markdownContent}
              disabled={!canEdit}
              onChange={(e) => setMarkdownContent(e.target.value)}
              rows={11}
              className="clay-input font-mono-tabular text-sm leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#525866] mb-1">
              {t.translations.linguisticNotes}
            </label>
            <input
              type="text"
              value={linguisticNotes}
              disabled={!canEdit}
              onChange={(e) => setLinguisticNotes(e.target.value)}
              placeholder="Ex. : Vérification des tons hauts/bas et orthographe Gbe"
              className="clay-input text-sm"
            />
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveTranslation('draft')}
                className="clay-btn-secondary"
              >
                <Save className="w-4 h-4" />
                {t.common.save}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSaveTranslation('in_review')}
                className="clay-btn-secondary"
              >
                {t.translations.markInReview}
              </button>
              <button
                type="button"
                disabled={saving || !canApproveCurrentLocale || !title.trim() || !markdownContent.trim()}
                title={
                  !canApproveCurrentLocale
                    ? 'La validation Fɔngbè est réservée aux relecteurs humains (reviewer) ou propriétaires.'
                    : undefined
                }
                onClick={() => handleSaveTranslation('approved')}
                className="clay-btn-primary disabled:opacity-50"
              >
                <CheckCircle2 className="w-5 h-5" />
                {t.translations.approveTranslation}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
