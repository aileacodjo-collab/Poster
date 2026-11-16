import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { FullPostBundle, LocalizedText, ReactionPreset } from '../shared/types.ts';

interface ReactionStudioModuleProps {
  selectedPostId: string | null;
  onSelectPost: (postId: string | null) => void;
}

interface EditableReaction {
  semanticKey: string;
  emoji: string;
  labels: LocalizedText;
  displayOrder: number;
  enabled: boolean;
  count: number;
}

export function ReactionStudioModule({ selectedPostId, onSelectPost }: ReactionStudioModuleProps) {
  const { posts, setPosts, presets, setPresets, role } = useAuth();
  const { t } = useI18n();
  const canEdit = role === 'owner' || role === 'editor';

  const activeBundle = useMemo(
    () => posts.find((b) => b.post.id === selectedPostId) || posts[0] || null,
    [posts, selectedPostId]
  );

  const [reactions, setReactions] = useState<EditableReaction[]>([]);
  const [reactionLimit, setReactionLimit] = useState(1);
  const [allowReactionChange, setAllowReactionChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newEmoji, setNewEmoji] = useState('💡');
  const [newLabelFr, setNewLabelFr] = useState('');
  const [newLabelEn, setNewLabelEn] = useState('');
  const [newLabelFon, setNewLabelFon] = useState('');

  useEffect(() => {
    if (!activeBundle) return;
    if (!selectedPostId) onSelectPost(activeBundle.post.id);
    setReactions(
      activeBundle.reactions
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((r) => ({
          semanticKey: r.semanticKey,
          emoji: r.emoji,
          labels: { ...r.labels },
          displayOrder: r.displayOrder,
          enabled: r.enabled,
          count: r.count,
        }))
    );
    setReactionLimit(activeBundle.post.reactionLimit || 1);
    setAllowReactionChange(activeBundle.post.allowReactionChange ?? true);
    setFeedback(null);
  }, [activeBundle?.post.id]);

  const moveReaction = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= reactions.length) return;
    const copy = reactions.slice();
    const [moved] = copy.splice(idx, 1);
    copy.splice(nextIdx, 0, moved);
    setReactions(copy.map((item, i) => ({ ...item, displayOrder: i })));
  };

  const handleAddToPost = () => {
    const cleanKey = newKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!cleanKey || reactions.some((r) => r.semanticKey === cleanKey)) {
      setFeedback('Clé sémantique requise et unique.');
      return;
    }
    setReactions((prev) => [
      ...prev,
      {
        semanticKey: cleanKey,
        emoji: newEmoji.trim() || '✨',
        labels: {
          fr: newLabelFr.trim() || cleanKey,
          en: newLabelEn.trim() || cleanKey,
          fon: newLabelFon.trim() || cleanKey,
        },
        displayOrder: prev.length,
        enabled: true,
        count: 0,
      },
    ]);
    setNewKey('');
    setNewLabelFr('');
    setNewLabelEn('');
    setNewLabelFon('');
  };

  const handleSavePostReactions = async () => {
    if (!activeBundle || !canEdit) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ bundle: FullPostBundle }>(
        `/api/admin/posts/${activeBundle.post.id}/reactions`,
        {
          method: 'PUT',
          body: {
            reactionLimit,
            allowReactionChange,
            reactions: reactions.map((r, i) => ({
              semanticKey: r.semanticKey,
              emoji: r.emoji,
              labels: r.labels,
              displayOrder: i,
              enabled: r.enabled,
            })),
          },
        }
      );
      setPosts((prev) => prev.map((b) => (b.post.id === res.bundle.post.id ? res.bundle : b)));
      setFeedback(t.common.saved);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur d’enregistrement.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsPreset = async (item: EditableReaction) => {
    try {
      const res = await apiRequest<{ preset: ReactionPreset }>('/api/admin/presets', {
        method: 'POST',
        body: {
          semanticKey: item.semanticKey,
          emoji: item.emoji,
          labels: item.labels,
          displayOrder: item.displayOrder,
        },
      });
      setPresets((prev) => {
        const filtered = prev.filter((p) => p.id !== res.preset.id);
        return [...filtered, res.preset].sort((a, b) => a.displayOrder - b.displayOrder);
      });
      setFeedback(`Modèle "${item.semanticKey}" enregistré.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur modèle.');
    }
  };

  const handleApplyPreset = (preset: ReactionPreset) => {
    if (reactions.some((r) => r.semanticKey === preset.semanticKey)) return;
    setReactions((prev) => [
      ...prev,
      {
        semanticKey: preset.semanticKey,
        emoji: preset.emoji,
        labels: { ...preset.labels },
        displayOrder: prev.length,
        enabled: true,
        count: 0,
      },
    ]);
  };

  if (!activeBundle) {
    return <div className="clay-card p-10 text-center text-[#525866]">{t.common.empty}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17191C]">{t.reactions.title}</h1>
          <p className="text-sm text-[#525866] mt-1">{t.reactions.subtitle}</p>
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

      {feedback && (
        <div className="clay-card p-4 text-sm font-medium text-[#006B35] bg-[#E5F3EA]">
          {feedback}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Post Reaction Map */}
        <div className="lg:col-span-2 clay-card p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[#17191C]">{t.reactions.postMapTitle}</h2>
            {canEdit && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSavePostReactions}
                className="clay-btn-primary text-sm"
              >
                <Save className="w-4 h-4" />
                {t.common.save}
              </button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4 p-4 rounded-[12px] bg-[#F1F4F6] border border-[#DFE5EC]">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.reactions.limitPerVisitor}
              </label>
              <input
                type="number"
                min={1}
                max={10}
                disabled={!canEdit}
                value={reactionLimit}
                onChange={(e) => setReactionLimit(Number(e.target.value) || 1)}
                className="clay-input font-mono-tabular"
              />
            </div>
            <label className="flex items-center gap-3 min-h-[48px] pt-4 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={allowReactionChange}
                onChange={(e) => setAllowReactionChange(e.target.checked)}
                className="w-5 h-5 accent-[#006B35]"
              />
              <span className="text-sm font-semibold text-[#17191C]">{t.reactions.allowChange}</span>
            </label>
          </div>

          <div className="space-y-3">
            {reactions.map((item, idx) => (
              <div
                key={item.semanticKey}
                className="p-4 rounded-[12px] border border-[#DFE5EC] bg-white space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={item.emoji}
                      disabled={!canEdit}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReactions((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, emoji: val } : r))
                        );
                      }}
                      className="clay-input w-16 text-center text-xl"
                      aria-label={t.reactions.emoji}
                    />
                    <div>
                      <div className="font-mono-tabular text-sm font-bold text-[#17191C]">
                        {item.semanticKey}
                      </div>
                      <div className="text-xs text-[#525866] font-mono-tabular">
                        Votes persistés : {item.count}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#17191C] min-h-[48px] px-2 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={item.enabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setReactions((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, enabled: checked } : r))
                          );
                        }}
                        className="w-4 h-4 accent-[#006B35]"
                      />
                      {t.reactions.enabled}
                    </label>
                    {canEdit && (
                      <>
                        <button
                          type="button"
                          onClick={() => moveReaction(idx, -1)}
                          className="clay-btn-secondary min-w-[48px] px-0"
                          aria-label="Monter"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveReaction(idx, 1)}
                          className="clay-btn-secondary min-w-[48px] px-0"
                          aria-label="Descendre"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveAsPreset(item)}
                          className="clay-btn-secondary text-xs"
                        >
                          Modèle
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setReactions((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[10px] text-red-700 hover:bg-red-50 cursor-pointer"
                          aria-label={t.common.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#525866] mb-1">
                      Libellé FR
                    </label>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={item.labels.fr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReactions((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, labels: { ...r.labels, fr: val } } : r
                          )
                        );
                      }}
                      className="clay-input text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#525866] mb-1">
                      Label EN
                    </label>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={item.labels.en}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReactions((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, labels: { ...r.labels, en: val } } : r
                          )
                        );
                      }}
                      className="clay-input text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#525866] mb-1">
                      Nyǐkɔ FON
                    </label>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={item.labels.fon}
                      onChange={(e) => {
                        const val = e.target.value;
                        setReactions((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, labels: { ...r.labels, fon: val } } : r
                          )
                        );
                      }}
                      className="clay-input text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {canEdit && (
            <div className="p-4 rounded-[12px] bg-[#F1F4F6] border border-[#DFE5EC] space-y-3">
              <div className="text-xs font-bold text-[#17191C]">{t.reactions.addReaction}</div>
              <div className="grid sm:grid-cols-5 gap-2.5">
                <input
                  type="text"
                  value={newEmoji}
                  onChange={(e) => setNewEmoji(e.target.value)}
                  placeholder="Emoji"
                  className="clay-input text-center text-lg"
                />
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="clé (ex: insight)"
                  className="clay-input font-mono-tabular text-sm"
                />
                <input
                  type="text"
                  value={newLabelFr}
                  onChange={(e) => setNewLabelFr(e.target.value)}
                  placeholder="Français"
                  className="clay-input text-sm"
                />
                <input
                  type="text"
                  value={newLabelEn}
                  onChange={(e) => setNewLabelEn(e.target.value)}
                  placeholder="English"
                  className="clay-input text-sm"
                />
                <input
                  type="text"
                  value={newLabelFon}
                  onChange={(e) => setNewLabelFon(e.target.value)}
                  placeholder="Fɔngbè"
                  className="clay-input text-sm"
                />
              </div>
              <button type="button" onClick={handleAddToPost} className="clay-btn-secondary text-sm">
                <Plus className="w-4 h-4" />
                {t.reactions.addReaction}
              </button>
            </div>
          )}
        </div>

        {/* Workspace Presets */}
        <div className="clay-card p-6 space-y-4 h-fit">
          <h2 className="text-lg font-bold text-[#17191C]">{t.reactions.presetsTitle}</h2>
          <div className="space-y-2.5">
            {presets.map((p) => (
              <div
                key={p.id}
                className="p-3.5 rounded-[12px] border border-[#DFE5EC] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-[#17191C] flex items-center gap-2">
                    <span className="text-lg">{p.emoji}</span>
                    <span className="font-mono-tabular text-xs">{p.semanticKey}</span>
                  </div>
                  <div className="text-xs text-[#525866] mt-0.5 truncate">
                    {p.labels.fr} · {p.labels.en} · {p.labels.fon}
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(p)}
                    className="clay-btn-secondary text-xs min-h-[40px] px-3"
                  >
                    +
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
