import React, { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { LOCALE_META } from '../shared/i18n.ts';
import { generateSlug } from '../shared/markdown.ts';
import {
  AuditLog,
  Locale,
  SUPPORTED_LOCALES,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
} from '../shared/types.ts';

export function SettingsModule() {
  const { workspace, setWorkspace, members, setMembers, invites, setInvites, role, refreshWorkspace } = useAuth();
  const { t } = useI18n();
  const isOwner = role === 'owner';
  const canViewAuditLogs = role === 'owner' || role === 'editor';

  const [brandName, setBrandName] = useState(workspace?.brandName || '');
  const [name, setName] = useState(workspace?.name || '');
  const [slug, setSlug] = useState(workspace?.slug || '');
  const [defaultLocale, setDefaultLocale] = useState<Locale>(workspace?.defaultLocale || 'fr');
  const [baseUrl, setBaseUrl] = useState(workspace?.baseUrl || '');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'reviewer' | 'viewer'>('editor');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const [acceptWorkspaceId, setAcceptWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('workspaceId') || '';
  });
  const [acceptToken, setAcceptToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('inviteToken') || '';
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [confirmMemberId, setConfirmMemberId] = useState<string | null>(null);
  const [confirmInviteId, setConfirmInviteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (workspace) {
      setBrandName(workspace.brandName);
      setName(workspace.name);
      setSlug(workspace.slug);
      setDefaultLocale(workspace.defaultLocale);
      setBaseUrl(workspace.baseUrl);
    }
  }, [workspace]);

  useEffect(() => {
    if (!canViewAuditLogs) {
      setAuditLogs([]);
      setLogsError(null);
      return;
    }
    let active = true;
    setLoadingLogs(true);
    setLogsError(null);
    apiRequest<{ logs: AuditLog[] }>('/api/admin/audit-logs')
      .then((res) => {
        if (active) setAuditLogs(res.logs);
      })
      .catch((err) => {
        if (active) setLogsError(err instanceof Error ? err.message : t.common.loadError);
      })
      .finally(() => {
        if (active) setLoadingLogs(false);
      });
    return () => {
      active = false;
    };
  }, [canViewAuditLogs, workspace?.id, t.common.loadError]);

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setFeedback(null);
    try {
      const res = await apiRequest<{ workspace: Workspace }>('/api/admin/workspace', {
        method: 'PATCH',
        body: { brandName, name, slug: generateSlug(slug), defaultLocale, baseUrl },
      });
      setWorkspace(res.workspace);
      setFeedback(t.common.saved);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.saveError);
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner || !inviteEmail.trim()) return;
    setFeedback(null);
    try {
      const res = await apiRequest<{ invite: WorkspaceInvite; rawToken: string }>('/api/admin/invites', {
        method: 'POST',
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setInvites((prev) => [res.invite, ...prev]);
      setIssuedToken(res.rawToken);
      setInviteEmail('');
      setFeedback(`${t.settings.inviteCreated} ${res.invite.email}`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.requestError);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await apiRequest(`/api/admin/invites/${inviteId}`, { method: 'DELETE' });
      setInvites((prev) =>
        prev.map((inv) => (inv.id === inviteId ? { ...inv, status: 'revoked' } : inv))
      );
      setConfirmInviteId(null);
      setFeedback(t.settings.inviteRevoked);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.requestError);
    }
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptWorkspaceId.trim() || !acceptToken.trim()) return;
    setFeedback(null);
    try {
      const res = await apiRequest<{ workspace: Workspace }>('/api/admin/invites/accept', {
        method: 'POST',
        body: { workspaceId: acceptWorkspaceId.trim(), token: acceptToken.trim() },
      });
      setAcceptWorkspaceId('');
      setAcceptToken('');
      await refreshWorkspace(res.workspace.id);
      setFeedback(`${t.settings.joinedWorkspace} (${res.workspace.name})`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.studio.onboardingInviteError);
    }
  };

  const handleUpdateMemberRole = async (memberId: string, nextRole: 'editor' | 'reviewer' | 'viewer') => {
    try {
      const res = await apiRequest<{ member: WorkspaceMember }>(`/api/admin/members/${memberId}`, {
        method: 'PATCH',
        body: { role: nextRole },
      });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? res.member : m)));
      setFeedback(`${t.settings.roleUpdated} (${res.member.email})`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.saveError);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await apiRequest(`/api/admin/members/${memberId}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      setConfirmMemberId(null);
      setFeedback(t.settings.revokedAction);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.deleteError);
    }
  };

  const handleExportBackup = async () => {
    try {
      const jsonStr = await apiRequest<string>('/api/admin/backup/export');
      const blob = new Blob([typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ailea-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : t.common.requestError);
    }
  };

  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const res = await apiRequest<{ restoredCount: number }>('/api/admin/backup/restore', {
          method: 'POST',
          body: parsed,
        });
        await refreshWorkspace();
        setFeedback(t.settings.restoreSuccess.replace('{count}', String(res.restoredCount)));
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : t.settings.restoreInvalid);
      }
    };
    reader.onerror = () => {
      setFeedback(t.settings.restoreInvalid);
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#17191C]">{t.settings.title}</h1>
      </div>

      {feedback && (
        <div className="clay-card p-4 text-sm font-medium text-[#006B35] bg-[#E5F3EA]">
          {feedback}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Workspace Identity */}
        <form onSubmit={handleSaveWorkspace} className="clay-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.settings.workspace}</h2>
          <div>
            <label className="block text-xs font-semibold text-[#525866] mb-1">
              {t.settings.brandNameLabel}
            </label>
            <input
              type="text"
              disabled={!isOwner}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="clay-input"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.settings.workspaceNameLabel}
              </label>
              <input
                type="text"
                disabled={!isOwner}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="clay-input"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.settings.workspaceSlugLabel}
              </label>
              <input
                type="text"
                disabled={!isOwner}
                value={slug}
                onChange={(e) => setSlug(generateSlug(e.target.value))}
                className="clay-input font-mono-tabular text-sm"
              />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.settings.defaultLocaleLabel}
              </label>
              <select
                disabled={!isOwner}
                value={defaultLocale}
                onChange={(e) => setDefaultLocale(e.target.value as Locale)}
                className="clay-input text-sm"
              >
                {SUPPORTED_LOCALES.map((loc) => (
                  <option key={loc} value={loc}>
                    {LOCALE_META[loc].nativeName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                {t.settings.publicUrlLabel}
              </label>
              <input
                type="text"
                disabled={!isOwner}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://example.org"
                className="clay-input font-mono-tabular text-sm"
              />
            </div>
          </div>
          {isOwner && (
            <button type="submit" className="clay-btn-primary text-sm">
              <Save className="w-4 h-4" />
              {t.common.save}
            </button>
          )}
        </form>

        {/* RBAC Members & Single-Use Invitations */}
        <div className="clay-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.settings.teamRoles}</h2>
          {isOwner && (
            <form onSubmit={handleCreateInvite} className="grid sm:grid-cols-3 gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t.settings.inviteEmailPlaceholder}
                className="clay-input text-sm sm:col-span-2"
                required
              />
              <div className="flex gap-2">
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'editor' | 'reviewer' | 'viewer')}
                  className="clay-input text-sm"
                >
                  <option value="editor">editor</option>
                  <option value="reviewer">reviewer</option>
                  <option value="viewer">viewer</option>
                </select>
                <button
                  type="submit"
                  className="clay-btn-secondary min-w-[48px] px-3"
                  title={t.settings.inviteButton}
                  aria-label={t.settings.inviteButton}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {issuedToken && workspace && (
            <div className="p-3 rounded-[12px] border border-[#006B35]/30 bg-[#E5F3EA]/70 text-xs space-y-2">
              <div className="font-semibold text-[#006B35]">
                {t.settings.inviteTokenOnceNotice}
              </div>
              <div className="font-mono-tabular break-all bg-white p-2 rounded-[8px] border border-[#DFE5EC] text-[#17191C]">
                {t.settings.workspaceCol}: {workspace.id} | {t.settings.tokenCol}: {issuedToken}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(issuedToken)}
                className="clay-btn-secondary text-xs py-1.5 px-3"
              >
                <Copy className="w-3.5 h-3.5" />
                {t.settings.copyToken}
              </button>
            </div>
          )}

          <ul className="divide-y divide-[#DFE5EC]">
            {members.map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#17191C] truncate">
                    {m.email || m.displayName || m.userId}
                  </div>
                  <div className="text-xs text-[#525866]">{m.role}</div>
                </div>
                {isOwner && m.role !== 'owner' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={m.role}
                      onChange={(e) =>
                        handleUpdateMemberRole(m.id, e.target.value as 'editor' | 'reviewer' | 'viewer')
                      }
                      className="clay-input text-xs py-1 px-2"
                    >
                      <option value="editor">editor</option>
                      <option value="reviewer">reviewer</option>
                      <option value="viewer">viewer</option>
                    </select>
                    {confirmMemberId === m.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.id)}
                          className="min-h-[36px] px-2.5 rounded-[8px] bg-red-600 text-white text-xs font-semibold cursor-pointer"
                        >
                          {t.common.confirm}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmMemberId(null)}
                          className="min-h-[36px] px-2 rounded-[8px] border border-[#DFE5EC] text-xs font-semibold text-[#525866] cursor-pointer"
                        >
                          {t.common.cancel}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmMemberId(m.id)}
                        aria-label={t.settings.confirmRemoveMember}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-700 hover:bg-red-50 rounded-[8px] cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {isOwner && invites.length > 0 && (
            <div className="pt-3 border-t border-[#DFE5EC] space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#525866]">
                {t.settings.invitationsTitle}
              </h3>
              <ul className="divide-y divide-[#DFE5EC] text-xs">
                {invites.map((inv) => (
                  <li key={inv.id} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-[#17191C]">{inv.email}</span>{' '}
                      <span className="text-[#525866]">
                        ({inv.role}) — {inv.status}
                      </span>
                    </div>
                    {inv.status === 'pending' && (
                      confirmInviteId === inv.id ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRevokeInvite(inv.id)}
                            className="px-2 py-1 rounded bg-red-600 text-white font-semibold cursor-pointer"
                          >
                            {t.common.confirm}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmInviteId(null)}
                            className="px-2 py-1 rounded border border-[#DFE5EC] text-[#525866] cursor-pointer"
                          >
                            {t.common.cancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmInviteId(inv.id)}
                          className="text-red-700 hover:underline font-medium cursor-pointer shrink-0"
                        >
                          {t.common.delete}
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={handleAcceptInvite} className="pt-3 border-t border-[#DFE5EC] space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#525866] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              {t.settings.joinAnotherTitle}
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={acceptWorkspaceId}
                onChange={(e) => setAcceptWorkspaceId(e.target.value)}
                placeholder={t.studio.workspaceIdPlaceholder}
                className="clay-input text-xs font-mono-tabular"
              />
              <input
                type="text"
                value={acceptToken}
                onChange={(e) => setAcceptToken(e.target.value)}
                placeholder={t.studio.inviteTokenPlaceholder}
                className="clay-input text-xs font-mono-tabular"
              />
            </div>
            <button type="submit" className="clay-btn-secondary text-xs">
              {t.studio.acceptInvite}
            </button>
          </form>
        </div>
      </div>

      {/* Backups & Audit Logs */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="clay-card p-6 space-y-4 h-fit">
          <h2 className="text-lg font-bold text-[#17191C]">{t.settings.backups}</h2>
          <div className="space-y-3">
            <button type="button" onClick={handleExportBackup} className="clay-btn-secondary w-full text-sm">
              <Download className="w-4 h-4" />
              {t.settings.exportBackup}
            </button>
            {isOwner && (
              <label className="clay-btn-secondary w-full text-sm cursor-pointer">
                <Upload className="w-4 h-4" />
                {t.settings.restoreBackup}
                <input type="file" accept=".json,application/json" onChange={handleRestoreBackup} className="hidden" />
              </label>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 clay-card p-6 space-y-4">
          <h2 className="text-lg font-bold text-[#17191C]">{t.settings.auditLogs}</h2>
          {canViewAuditLogs ? (
            logsError ? (
              <div className="p-3 rounded-[10px] bg-red-50 border border-red-200 text-xs text-red-800">
                {logsError}
              </div>
            ) : loadingLogs ? (
              <p className="text-sm text-[#525866]">{t.common.loading}</p>
            ) : auditLogs.length === 0 ? (
              <p className="text-sm text-[#525866]">{t.settings.noAuditLogs}</p>
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#DFE5EC] text-[#525866]">
                      <th className="py-2 pr-3">{t.settings.auditDate}</th>
                      <th className="py-2 px-3">{t.settings.auditActor}</th>
                      <th className="py-2 px-3">{t.settings.auditAction}</th>
                      <th className="py-2 pl-3">{t.settings.auditDetails}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DFE5EC]">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 pr-3 font-mono-tabular whitespace-nowrap text-[#525866]">
                          {log.createdAt.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="py-2.5 px-3 text-[#17191C]">{log.actorEmail}</td>
                        <td className="py-2.5 px-3 font-mono-tabular font-semibold text-[#006B35]">
                          {log.action}
                        </td>
                        <td className="py-2.5 pl-3 text-[#525866]">{log.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <p className="text-sm text-[#525866]">
              {t.settings.auditRestrictedNote}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
