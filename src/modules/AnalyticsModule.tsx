import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { LOCALE_META } from '../shared/i18n.ts';
import { AnalyticsSummary, SUPPORTED_LOCALES } from '../shared/types.ts';

export function AnalyticsModule() {
  const { posts } = useAuth();
  const { locale, t } = useI18n();
  const [filterPostId, setFilterPostId] = useState<string>('');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = async (postId?: string) => {
    setLoading(true);
    try {
      const qs = postId ? `?postId=${encodeURIComponent(postId)}` : '';
      const res = await apiRequest<{ summary: AnalyticsSummary }>(`/api/admin/analytics${qs}`);
      setSummary(res.summary);
    } catch {
      // handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics(filterPostId);
  }, [filterPostId]);

  const maxTimelineVal = summary
    ? Math.max(1, ...summary.timeline.map((pt) => Math.max(pt.views, pt.reactions)))
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17191C]">{t.analytics.title}</h1>
          <p className="text-sm text-[#525866] mt-1">{t.analytics.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filterPostId}
            onChange={(e) => setFilterPostId(e.target.value)}
            className="clay-input w-auto min-w-[230px] font-semibold"
          >
            <option value="">{t.common.all}</option>
            {posts.map((b) => (
              <option key={b.post.id} value={b.post.id}>
                {b.translations[b.post.primaryLocale]?.title || b.translations.fr?.title || 'Article'}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => loadAnalytics(filterPostId)}
            className="clay-btn-secondary"
            aria-label="Actualiser"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.analytics.views}</div>
          <div className="text-3xl font-bold text-[#17191C] mt-2 font-mono-tabular">
            {summary?.totalViews ?? 0}
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.analytics.uniqueVisitors}</div>
          <div className="text-3xl font-bold text-[#17191C] mt-2 font-mono-tabular">
            {summary?.uniqueVisitors ?? 0}
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.analytics.reactions}</div>
          <div className="text-3xl font-bold text-[#006B35] mt-2 font-mono-tabular">
            {summary?.totalReactions ?? 0}
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.analytics.engagementRate}</div>
          <div className="text-3xl font-bold text-[#006B35] mt-2 font-mono-tabular">
            {summary?.engagementRate ?? 0}%
          </div>
        </div>
        <div className="clay-card p-5">
          <div className="text-xs font-semibold text-[#525866]">{t.analytics.reactionChanges}</div>
          <div className="text-3xl font-bold text-[#17191C] mt-2 font-mono-tabular">
            {summary?.reactionChanges ?? 0}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Timeline Chart */}
        <div className="lg:col-span-2 clay-card p-6">
          <h2 className="text-lg font-bold text-[#17191C] mb-4">
            {t.analytics.views} & {t.analytics.reactions}
          </h2>

          {!summary || summary.timeline.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#525866]">
              {t.analytics.noDataYet}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-full overflow-x-auto">
                <svg viewBox="0 0 640 200" className="w-full h-48">
                  {summary.timeline.map((pt, idx) => {
                    const barWidth = Math.max(14, Math.min(44, Math.floor(580 / summary.timeline.length) - 10));
                    const x = 30 + idx * (barWidth + 12);
                    const vHeight = Math.round((pt.views / maxTimelineVal) * 140);
                    const rHeight = Math.round((pt.reactions / maxTimelineVal) * 140);
                    return (
                      <g key={pt.date}>
                        <rect
                          x={x}
                          y={160 - vHeight}
                          width={barWidth / 2}
                          height={vHeight}
                          rx={4}
                          fill="#17191C"
                          opacity={0.82}
                        />
                        <rect
                          x={x + barWidth / 2 + 2}
                          y={160 - rHeight}
                          width={barWidth / 2}
                          height={rHeight}
                          rx={4}
                          fill="#006B35"
                        />
                        <text
                          x={x + barWidth / 2}
                          y={184}
                          textAnchor="middle"
                          fontSize="10"
                          fill="#525866"
                        >
                          {pt.date.slice(5)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex items-center gap-6 text-xs text-[#525866]">
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-[#17191C] inline-block" />
                  {t.analytics.views}
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-[#006B35] inline-block" />
                  {t.analytics.reactions}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Language & Referrer Breakdown */}
        <div className="space-y-6">
          <div className="clay-card p-6 space-y-3">
            <h2 className="text-base font-bold text-[#17191C]">{t.analytics.languageBreakdown}</h2>
            {SUPPORTED_LOCALES.map((loc) => {
              const row = summary?.byLocale[loc] || { views: 0, reactions: 0 };
              return (
                <div key={loc} className="flex items-center justify-between text-sm py-1.5 border-b border-[#DFE5EC] last:border-0">
                  <span className="font-semibold text-[#17191C]">{LOCALE_META[loc].nativeName}</span>
                  <span className="font-mono-tabular text-xs text-[#525866]">
                    {row.views} vues · {row.reactions} réactions
                  </span>
                </div>
              );
            })}
          </div>

          <div className="clay-card p-6 space-y-3">
            <h2 className="text-base font-bold text-[#17191C]">{t.analytics.referrers}</h2>
            {!summary || summary.byReferrer.length === 0 ? (
              <p className="text-xs text-[#525866]">{t.analytics.noDataYet}</p>
            ) : (
              summary.byReferrer.slice(0, 6).map((ref) => (
                <div key={ref.source} className="flex items-center justify-between text-sm py-1 border-b border-[#DFE5EC] last:border-0">
                  <span className="text-[#17191C] truncate">{ref.source}</span>
                  <span className="font-mono-tabular font-semibold text-[#006B35]">{ref.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Reaction Distribution & Post Performance Table */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="clay-card p-6 space-y-3">
          <h2 className="text-base font-bold text-[#17191C]">{t.nav.reactions}</h2>
          {!summary || summary.byReaction.length === 0 ? (
            <p className="text-xs text-[#525866]">{t.analytics.noDataYet}</p>
          ) : (
            summary.byReaction.map((item) => {
              const pct =
                summary.totalReactions > 0
                  ? Math.round((item.count / summary.totalReactions) * 100)
                  : 0;
              return (
                <div key={item.semanticKey} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-[#17191C]">
                      {item.emoji} {item.labels[locale] || item.semanticKey}
                    </span>
                    <span className="font-mono-tabular text-xs text-[#525866]">
                      {item.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#F1F4F6] overflow-hidden">
                    <div
                      className="h-full bg-[#006B35] rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="lg:col-span-2 clay-card p-6">
          <h2 className="text-base font-bold text-[#17191C] mb-4">{t.nav.posts}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#DFE5EC] text-xs font-semibold text-[#525866]">
                  <th className="py-2.5 pr-4">Article</th>
                  <th className="py-2.5 px-3 text-right">{t.analytics.views}</th>
                  <th className="py-2.5 px-3 text-right">{t.analytics.uniqueVisitors}</th>
                  <th className="py-2.5 px-3 text-right">{t.analytics.reactions}</th>
                  <th className="py-2.5 pl-3 text-right">{t.analytics.engagementRate}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DFE5EC]">
                {(summary?.perPost || []).map((row) => (
                  <tr key={row.postId}>
                    <td className="py-3 pr-4 font-semibold text-[#17191C]">{row.title}</td>
                    <td className="py-3 px-3 text-right font-mono-tabular">{row.views}</td>
                    <td className="py-3 px-3 text-right font-mono-tabular">{row.uniqueVisitors}</td>
                    <td className="py-3 px-3 text-right font-mono-tabular text-[#006B35] font-semibold">
                      {row.reactions}
                    </td>
                    <td className="py-3 pl-3 text-right font-mono-tabular">{row.engagementRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
