import React, { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { LOCALE_META } from '../shared/i18n.ts';
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
  const [defaultLocale, setDefaultLocale] = useState<Locale>(workspace?.defaultLocale || 'fr');
  const [baseUrl, setBaseUrl] = useState(workspace?.baseUrl || '');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'reviewer' | 'viewer'>('editor');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const [acceptWorkspaceId, setAcceptWorkspaceId] = useState('');
  const [acceptToken, setAcceptToken] = useState('');

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (workspace) {
      setBrandName(workspace.brandName);
      setName(workspace.name);
      setDefaultLocale(workspace.defaultLocale);
      setBaseUrl(workspace.baseUrl);
    }
  }, [workspace]);

  useEffect(() => {
    if (!canViewAuditLogs) {
      setAuditLogs([]);
      return;
    }
    apiRequest<{ logs: AuditLog[] }>('/api/admin/audit-logs')
      .then((res) => setAuditLogs(res.logs))
      .catch(() => {});
  }, [canViewAuditLogs]);

  const handleSaveWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    try {
      const res = await apiRequest<{ workspace: Workspace }>('/api/admin/workspace', {
        method: 'PATCH',
        body: { brandName, name, defaultLocale, baseUrl },
      });
      setWorkspace(res.workspace);
      setFeedback(t.common.saved);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Erreur d’enregistrement.');
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner || !inviteEmail.trim()) return;
    try {
      const res = await apiRequest<{ invite: WorkspaceInvite; rawToken: string }>('/api/admin/invites', {
        method: 'POST',
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setInvites((prev) => [res.invite, ...prev]);
      setIssuedToken(res.rawToken);
      setInviteEmail('');
      setFeedback(`Invitation sécurisée générée pour ${res.invite.email} (valable 72 h, usage unique).`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Invitation refusée.');
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      await apiRequest(`/api/admin/invites/${inviteId}`, { method: 'DELETE' });
      setInvites((prev) =>
        prev.map((inv) => (inv.id === inviteId ? { ...inv, status: 'revoked' } : inv))
      );
      setFeedback('Invitation révoquée.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Révocation impossible.');
    }
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptWorkspaceId.trim() || !acceptToken.trim()) return;
    try {
      const res = await apiRequest<{ workspace: Workspace }>('/api/admin/invites/accept', {
        method: 'POST',
        body: { workspaceId: acceptWorkspaceId.trim(), token: acceptToken.trim() },
      });
      setAcceptWorkspaceId('');
      setAcceptToken('');
      await refreshWorkspace(res.workspace.id);
      setFeedback(`Vous avez rejoint l’espace "${res.workspace.name}".`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Acceptation refusée.');
    }
  };

  const handleUpdateMemberRole = async (memberId: string, nextRole: 'editor' | 'reviewer' | 'viewer') => {
    try {
      const res = await apiRequest<{ member: WorkspaceMember }>(`/api/admin/members/${memberId}`, {
        method: 'PATCH',
        body: { role: nextRole },
      });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? res.member : m)));
      setFeedback(`Rôle mis à jour pour ${res.member.email}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Mise à jour du rôle impossible.');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await apiRequest(`/api/admin/members/${memberId}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Suppression impossible.');
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
      setFeedback(err instanceof Error ? err.message : 'Export impossible.');
    }
  };

  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
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
        setFeedback(`Restauration terminée : ${res.restoredCount} documents restaurés.`);
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : 'Fichier de sauvegarde invalide.');
      }
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
            <label className="block text-xs font-semibold text-[#525866] mb-1">Nom de la revue</label>
            <input
              type="text"
              disabled={!isOwner}
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="clay-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#525866] mb-1">Nom de l’espace</label>
            <input
              type="text"
              disabled={!isOwner}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="clay-input"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#525866] mb-1">
                Langue par défaut
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
              <label className="block text-xs font-semibold text-[#525866] mb-1">URL publique</label>
              <input
                type="text"
                disabled={!isOwner}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
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
                placeholder="email@domaine.org"
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
                <button type="submit" className="clay-btn-secondary min-w-[48px] px-3" title="Générer une invitation">
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {issuedToken && workspace && (
            <div className="p-3 rounded-[12px] border border-[#006B35]/30 bg-[#E5F3EA]/70 text-xs space-y-2">
              <div className="font-semibold text-[#006B35]">
                Jeton d’invitation à usage unique (transmettre de manière sécurisée, affiché une seule fois) :
              </div>
              <div className="font-mono-tabular break-all bg-white p-2 rounded-[8px] border border-[#DFE5EC] text-[#17191C]">
                Espace: {workspace.id} | Jeton: {issuedToken}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(issuedToken)}
                className="clay-btn-secondary text-xs py-1.5 px-3"
              >
                <Copy className="w-3.5 h-3.5" />
                Copier le jeton
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
                  <div className="flex items-center gap-2">
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
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(m.id)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-red-700 hover:bg-red-50 rounded-[8px] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {isOwner && invites.length > 0 && (
            <div className="pt-3 border-t border-[#DFE5EC] space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#525866]">Invitations</h3>
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
                      <button
                        type="button"
                        onClick={() => handleRevokeInvite(inv.id)}
                        className="text-red-700 hover:underline font-medium cursor-pointer"
                      >
                        Révoquer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={handleAcceptInvite} className="pt-3 border-t border-[#DFE5EC] space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#525866] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Rejoindre un autre espace avec un jeton
            </h3>
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={acceptWorkspaceId}
                onChange={(e) => setAcceptWorkspaceId(e.target.value)}
                placeholder="Identifiant de l’espace (ex: ws_...)"
                className="clay-input text-xs font-mono-tabular"
              />
              <input
                type="text"
                value={acceptToken}
                onChange={(e) => setAcceptToken(e.target.value)}
                placeholder="Jeton d’invitation"
                className="clay-input text-xs font-mono-tabular"
              />
            </div>
            <button type="submit" className="clay-btn-secondary text-xs">
              Accepter l’invitation
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
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DFE5EC] text-[#525866]">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 px-3">Acteur</th>
                    <th className="py-2 px-3">Action</th>
                    <th className="py-2 pl-3">Détails</th>
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
          ) : (
            <p className="text-sm text-[#525866]">
              La consultation des journaux d’audit est réservée aux propriétaires et éditeurs.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
