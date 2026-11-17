import React, { useState } from 'react';
import { Copy, Plus, Trash2, Upload } from 'lucide-react';
import { AuthorizedMediaImage } from '../components/AuthorizedMediaImage.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { generateSlug } from '../shared/markdown.ts';
import { Category, MediaAsset, Tag } from '../shared/types.ts';

export function ContentLibraryModule() {
  const { categories, setCategories, tags, setTags, mediaAssets, setMediaAssets, role } = useAuth();
  const { locale, t } = useI18n();
  const canEdit = role === 'owner' || role === 'editor';

  const [catFr, setCatFr] = useState('');
  const [catEn, setCatEn] = useState('');
  const [catFon, setCatFon] = useState('');
  const [tagFr, setTagFr] = useState('');
  const [tagEn, setTagEn] = useState('');
  const [tagFon, setTagFon] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catFr.trim()) return;
    setFeedback(null);
    try {
      const res = await apiRequest<{ category: Category }>('/api/admin/categories', {
        method: 'POST',
        body: {
          slug: generateSlug(catFr),
          names: {
            fr: catFr.trim(),
            en: catEn.trim() || catFr.trim(),
            fon: catFon.trim() || catFr.trim(),
          },
        },
      });
      setCategories((prev) => [...prev.filter((c) => c.id !== res.category.id), res.category]);
      setCatFr('');
      setCatEn('');
      setCatFon('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.saveError);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await apiRequest(`/api/admin/categories/${id}`, { method: 'DELETE' });
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setConfirmDeleteKey(null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.deleteError);
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagFr.trim()) return;
    setFeedback(null);
    try {
      const res = await apiRequest<{ tag: Tag }>('/api/admin/tags', {
        method: 'POST',
        body: {
          slug: generateSlug(tagFr),
          names: {
            fr: tagFr.trim(),
            en: tagEn.trim() || tagFr.trim(),
            fon: tagFon.trim() || tagFr.trim(),
          },
        },
      });
      setTags((prev) => [...prev.filter((x) => x.id !== res.tag.id), res.tag]);
      setTagFr('');
      setTagEn('');
      setTagFon('');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.saveError);
    }
  };

  const handleDeleteTag = async (id: string) => {
    try {
      await apiRequest(`/api/admin/tags/${id}`, { method: 'DELETE' });
      setTags((prev) => prev.filter((x) => x.id !== id));
      setConfirmDeleteKey(null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.deleteError);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      setFeedback(t.library.invalidImageType);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback(t.library.imageTooLarge);
      return;
    }

    setUploading(true);
    setFeedback(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiRequest<{ asset: MediaAsset }>('/api/admin/media/upload', {
          method: 'POST',
          body: {
            filename: file.name,
            mimeType: file.type,
            base64Data: String(reader.result || ''),
            altText: { fr: file.name, en: file.name, fon: file.name },
          },
        });
        setMediaAssets((prev) => [res.asset, ...prev]);
        setFeedback(`${t.library.uploadSuccess} (${res.asset.filename})`);
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : t.library.uploadError);
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setUploading(false);
      setFeedback(t.library.uploadError);
    };
    reader.readAsDataURL(file);
  };

  const copyMarkdownSnippet = (asset: MediaAsset) => {
    const alt = asset.altText[locale] || asset.filename;
    const md = `![${alt}](${asset.url})`;
    navigator.clipboard?.writeText(md);
    setFeedback(`${t.library.markdownCopied} ${md}`);
  };

  const handleDeleteMedia = async (asset: MediaAsset) => {
    try {
      await apiRequest(`/api/admin/media/${asset.id}`, { method: 'DELETE' });
      setMediaAssets((prev) => prev.filter((m) => m.id !== asset.id));
      setConfirmDeleteKey(null);
      setFeedback(`${t.common.delete}: ${asset.filename}`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.deleteError);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#17191C]">{t.library.title}</h1>
      </div>

      {feedback && (
        <div className="clay-card p-4 text-sm font-medium text-[#006B35] bg-[#E5F3EA]">
          {feedback}
        </div>
      )}

      {/* Media Assets */}
      <div className="clay-card p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.library.media}</h2>
          {canEdit && (
            <label className="clay-btn-primary text-sm cursor-pointer">
              <Upload className="w-4 h-4" />
              {uploading ? t.common.loading : t.library.uploadImage}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          )}
        </div>

        {mediaAssets.length === 0 ? (
          <p className="text-sm text-[#525866] py-4">{t.library.noMedia}</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mediaAssets.map((asset) => {
              const delKey = `media:${asset.id}`;
              return (
                <div key={asset.id} className="rounded-[12px] border border-[#DFE5EC] overflow-hidden bg-white">
                  <div className="aspect-video bg-[#E5F3EA]">
                    <AuthorizedMediaImage
                      src={asset.url}
                      alt={asset.altText[locale] || asset.filename}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#17191C] truncate">{asset.filename}</div>
                      <div className="text-xs text-[#525866] font-mono-tabular">
                        {Math.round(asset.sizeBytes / 1024)} {t.common.kilobytes}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => copyMarkdownSnippet(asset)}
                        aria-label={`${t.library.copyMarkdown} ${asset.filename}`}
                        className="clay-btn-secondary min-h-[40px] px-3 text-xs"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        MD
                      </button>
                      {canEdit && (
                        confirmDeleteKey === delKey ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDeleteMedia(asset)}
                              className="min-h-[36px] px-2.5 rounded-[8px] bg-red-600 text-white text-xs font-semibold cursor-pointer"
                            >
                              {t.common.confirm}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteKey(null)}
                              className="min-h-[36px] px-2 rounded-[8px] border border-[#DFE5EC] text-xs font-semibold text-[#525866] cursor-pointer"
                            >
                              {t.common.cancel}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(delKey)}
                            aria-label={`${t.common.delete} ${asset.filename}`}
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-700 hover:bg-red-50 rounded-[8px] cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Categories & Tags */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="clay-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.library.categories}</h2>
          {canEdit && (
            <form onSubmit={handleAddCategory} className="grid sm:grid-cols-4 gap-2">
              <input
                type="text"
                value={catFr}
                onChange={(e) => setCatFr(e.target.value)}
                placeholder="FR"
                className="clay-input text-sm"
                required
              />
              <input
                type="text"
                value={catEn}
                onChange={(e) => setCatEn(e.target.value)}
                placeholder="EN"
                className="clay-input text-sm"
              />
              <input
                type="text"
                value={catFon}
                onChange={(e) => setCatFon(e.target.value)}
                placeholder="FON"
                className="clay-input text-sm"
              />
              <button type="submit" className="clay-btn-secondary text-sm">
                <Plus className="w-4 h-4" />
                {t.common.create}
              </button>
            </form>
          )}
          {categories.length === 0 ? (
            <p className="text-sm text-[#525866]">{t.library.noCategories}</p>
          ) : (
            <ul className="divide-y divide-[#DFE5EC]">
              {categories.map((cat) => {
                const delKey = `cat:${cat.id}`;
                return (
                  <li key={cat.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#17191C]">
                        {cat.names.fr} · {cat.names.en} · {cat.names.fon}
                      </div>
                      <div className="text-xs font-mono-tabular text-[#525866]">{cat.slug}</div>
                    </div>
                    {canEdit && (
                      confirmDeleteKey === delKey ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.id)}
                            className="min-h-[36px] px-2.5 rounded-[8px] bg-red-600 text-white text-xs font-semibold cursor-pointer"
                          >
                            {t.common.confirm}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(null)}
                            className="min-h-[36px] px-2 rounded-[8px] border border-[#DFE5EC] text-xs font-semibold text-[#525866] cursor-pointer"
                          >
                            {t.common.cancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteKey(delKey)}
                          aria-label={`${t.common.delete} ${cat.slug}`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-700 hover:bg-red-50 rounded-[8px] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="clay-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.library.tags}</h2>
          {canEdit && (
            <form onSubmit={handleAddTag} className="grid sm:grid-cols-4 gap-2">
              <input
                type="text"
                value={tagFr}
                onChange={(e) => setTagFr(e.target.value)}
                placeholder="FR"
                className="clay-input text-sm"
                required
              />
              <input
                type="text"
                value={tagEn}
                onChange={(e) => setTagEn(e.target.value)}
                placeholder="EN"
                className="clay-input text-sm"
              />
              <input
                type="text"
                value={tagFon}
                onChange={(e) => setTagFon(e.target.value)}
                placeholder="FON"
                className="clay-input text-sm"
              />
              <button type="submit" className="clay-btn-secondary text-sm">
                <Plus className="w-4 h-4" />
                {t.common.create}
              </button>
            </form>
          )}
          {tags.length === 0 ? (
            <p className="text-sm text-[#525866]">{t.library.noTags}</p>
          ) : (
            <ul className="divide-y divide-[#DFE5EC]">
              {tags.map((tg) => {
                const delKey = `tag:${tg.id}`;
                return (
                  <li key={tg.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#17191C]">
                        {tg.names.fr} · {tg.names.en} · {tg.names.fon}
                      </div>
                      <div className="text-xs font-mono-tabular text-[#525866]">{tg.slug}</div>
                    </div>
                    {canEdit && (
                      confirmDeleteKey === delKey ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteTag(tg.id)}
                            className="min-h-[36px] px-2.5 rounded-[8px] bg-red-600 text-white text-xs font-semibold cursor-pointer"
                          >
                            {t.common.confirm}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(null)}
                            className="min-h-[36px] px-2 rounded-[8px] border border-[#DFE5EC] text-xs font-semibold text-[#525866] cursor-pointer"
                          >
                            {t.common.cancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteKey(delKey)}
                          aria-label={`${t.common.delete} ${tg.slug}`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-700 hover:bg-red-50 rounded-[8px] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
