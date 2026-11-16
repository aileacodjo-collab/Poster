import React, { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, FileUp, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { buildPublicPostPath } from '../shared/seo.ts';
import { AnalyticsSummary, SUPPORTED_LOCALES } from '../shared/types.ts';
import { StudioModuleId } from '../components/StudioShell.tsx';

interface DashboardModuleProps {
  onNavigate: (module: StudioModuleId, postId?: string) => void;
  onTriggerImport: () => void;
  onTriggerNewPost: () => void;
}

export function DashboardModule({ onNavigate, onTriggerImport, onTriggerNewPost }: DashboardModuleProps) {
  const { posts, loadingData, role } = useAuth();
  const { locale, t } = useI18n();
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<{ summary: AnalyticsSummary }>('/api/admin/analytics')
      .then((res) => {
        if (active) setAnalytics(res.summary);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [posts.length]);

  const publishedCount = posts.filter((p) => p.post.status === 'published').length;
  const recentEvents = posts
    .flatMap((b) =>
      b.publishingEvents.map((ev) => ({
        ...ev,
        postTitle:
          b.translations[b.post.primaryLocale]?.title ||
          b.translations.fr?.title ||
          b.translations.en?.title ||
          'Article',
      }))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const canEdit = role === 'owner' || role === 'editor';

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17191C]">
            {t.dashboard.title}
          </h1>
          <p className="text-sm sm:text-base text-[#525866] mt-1">{t.dashboard.subtitle}</p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onTriggerImport} className="clay-btn-secondary">
              <FileUp className="w-4 h-4" />
              {t.dashboard.importMarkdown}
            </button>
            <button type="button" onClick={onTriggerNewPost} className="clay-btn-primary">
              <Plus className="w-5 h-5" />
              {t.dashboard.newPost}
            </button>
          </div>
        )}
      </div>

      {/* Real KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.dashboard.totalPosts}</div>
          <div className="text-3xl font-bold text-[#17191C] mt-2 font-mono-tabular">
            {posts.length}
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.dashboard.publishedPosts}</div>
          <div className="text-3xl font-bold text-[#006B35] mt-2 font-mono-tabular">
            {publishedCount}
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.dashboard.totalViews}</div>
          <div className="text-3xl font-bold text-[#17191C] mt-2 font-mono-tabular">
            {analytics ? analytics.totalViews : 0}
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.dashboard.totalReactions}</div>
          <div className="text-3xl font-bold text-[#006B35] mt-2 font-mono-tabular">
            {analytics ? analytics.totalReactions : 0}
          </div>
        </div>
      </div>

      {/* Translation Readiness Matrix & Recent Events */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 clay-card p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-bold text-[#17191C]">{t.dashboard.translationMatrix}</h2>
            <button
              type="button"
              onClick={() => onNavigate('posts')}
              className="text-sm font-semibold text-[#006B35] hover:underline inline-flex items-center gap-1 min-h-[48px] cursor-pointer"
            >
              {t.nav.posts}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {loadingData ? (
            <p className="text-sm text-[#525866] py-6">{t.common.loading}</p>
          ) : posts.length === 0 ? (
            <p className="text-sm text-[#525866] py-6">{t.common.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DFE5EC] text-xs font-semibold text-[#525866]">
                    <th className="py-3 pr-4">Article</th>
                    <th className="py-3 px-3">FR</th>
                    <th className="py-3 px-3">EN</th>
                    <th className="py-3 px-3">FON</th>
                    <th className="py-3 pl-3 text-right">{t.common.status}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DFE5EC] text-sm">
                  {posts.map((bundle) => {
                    const displayTitle =
                      bundle.translations[locale]?.title ||
                      bundle.translations[bundle.post.primaryLocale]?.title ||
                      bundle.translations.fr?.title ||
                      'Sans titre';
                    const pubTr = bundle.translations[locale] || bundle.translations[bundle.post.primaryLocale];
                    return (
                      <tr key={bundle.post.id} className="hover:bg-[#F8FAFB]">
                        <td className="py-3.5 pr-4">
                          <button
                            type="button"
                            onClick={() => onNavigate('posts', bundle.post.id)}
                            className="font-semibold text-[#17191C] hover:text-[#006B35] text-left cursor-pointer"
                          >
                            {displayTitle}
                          </button>
                          <div className="text-xs text-[#525866] mt-0.5">
                            v{bundle.post.currentVersionNumber} ·{' '}
                            {bundle.reactions.filter((r) => r.enabled).map((r) => r.emoji).join(' ')}
                          </div>
                        </td>
                        {SUPPORTED_LOCALES.map((loc) => {
                          const st = bundle.translations[loc]?.translationStatus || 'missing';
                          return (
                            <td key={loc} className="py-3.5 px-3">
                              <button
                                type="button"
                                onClick={() => onNavigate('translations', bundle.post.id)}
                                className={`text-xs font-semibold cursor-pointer hover:underline ${
                                  st === 'approved'
                                    ? 'text-[#006B35]'
                                    : st === 'in_review'
                                      ? 'text-amber-700'
                                      : st === 'draft'
                                        ? 'text-[#17191C]'
                                        : 'text-[#8A94A6]'
                                }`}
                              >
                                {t.statuses[st]}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-3.5 pl-3 text-right whitespace-nowrap">
                          <span
                            className={`text-xs font-semibold ${
                              bundle.post.status === 'published' ? 'text-[#006B35]' : 'text-[#525866]'
                            }`}
                          >
                            {t.statuses[bundle.post.status]}
                          </span>
                          {bundle.post.status === 'published' && pubTr?.slug && (
                            <a
                              href={buildPublicPostPath(pubTr.locale, pubTr.slug)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center ml-2 text-[#006B35] hover:underline"
                              title={t.nav.publicSite}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="clay-card p-6">
          <h2 className="text-lg font-bold text-[#17191C] mb-4">{t.dashboard.recentEvents}</h2>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-[#525866]">{t.common.empty}</p>
          ) : (
            <ul className="divide-y divide-[#DFE5EC]">
              {recentEvents.map((ev) => (
                <li key={ev.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="text-sm font-semibold text-[#17191C] truncate">{ev.postTitle}</div>
                  <div className="text-xs text-[#525866] mt-0.5">
                    {ev.summary} · v{ev.versionNumber}
                  </div>
                  <div className="text-xs text-[#8A94A6] mt-0.5 font-mono-tabular">
                    {ev.createdAt.slice(0, 16).replace('T', ' ')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
