import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  SearchCheck,
  Settings,
  SmilePlus,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useI18n } from '../contexts/I18nContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { LOCALE_META } from '../shared/i18n.ts';
import { Locale, SUPPORTED_LOCALES, Workspace } from '../shared/types.ts';

export type StudioModuleId =
  | 'dashboard'
  | 'posts'
  | 'translations'
  | 'reactions'
  | 'seo'
  | 'analytics'
  | 'library'
  | 'settings';

interface StudioShellProps {
  activeModule: StudioModuleId;
  onSelectModule: (mod: StudioModuleId) => void;
  children: React.ReactNode;
}

export function StudioShell({ activeModule, onSelectModule, children }: StudioShellProps) {
  const {
    firebaseUser,
    authReady,
    loadingData,
    needsOnboarding,
    workspace,
    role,
    memberships,
    switchWorkspace,
    refreshWorkspace,
    createPersonalWorkspace,
    signInWithGoogle,
    logout,
    error,
  } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [acceptWorkspaceId, setAcceptWorkspaceId] = useState('');
  const [acceptToken, setAcceptToken] = useState('');
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  const handleOnboardingCreateWorkspace = async () => {
    setOnboardingError(null);
    setOnboardingBusy(true);
    try {
      await createPersonalWorkspace();
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : 'Initialisation impossible.');
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handleOnboardingAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptWorkspaceId.trim() || !acceptToken.trim()) return;
    setOnboardingError(null);
    setOnboardingBusy(true);
    try {
      const res = await apiRequest<{ workspace: Workspace }>('/api/admin/invites/accept', {
        method: 'POST',
        workspaceId: null,
        body: { workspaceId: acceptWorkspaceId.trim(), token: acceptToken.trim() },
      });
      setAcceptWorkspaceId('');
      setAcceptToken('');
      await refreshWorkspace(res.workspace.id);
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : 'Invitation refusée ou expirée.');
    } finally {
      setOnboardingBusy(false);
    }
  };

  const navItems: Array<{ id: StudioModuleId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'posts', label: t.nav.posts, icon: FileText },
    { id: 'translations', label: t.nav.translations, icon: Languages },
    { id: 'reactions', label: t.nav.reactions, icon: SmilePlus },
    { id: 'seo', label: t.nav.seo, icon: SearchCheck },
    { id: 'analytics', label: t.nav.analytics, icon: BarChart3 },
    { id: 'library', label: t.nav.library, icon: FolderOpen },
    { id: 'settings', label: t.nav.settings, icon: Settings },
  ];

  const activeNav = navItems.find((item) => item.id === activeModule) || navItems[0];

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="clay-card p-8 text-center max-w-sm w-full">
          <p className="text-base font-medium text-[#525866]">{t.auth.verifying}</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="bg-white border-b border-[#DFE5EC]">
          <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-6">
            <span className="text-lg font-bold tracking-tight text-[#17191C] whitespace-nowrap shrink-0">
              AILEA PostManager
            </span>
            <nav className="flex items-center gap-1" aria-label="Langue">
              {SUPPORTED_LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocale(loc)}
                  className={`min-h-[48px] px-3 rounded-[10px] text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    locale === loc
                      ? 'bg-[#E5F3EA] text-[#006B35]'
                      : 'text-[#525866] hover:bg-[#F1F4F6] hover:text-[#17191C]'
                  }`}
                >
                  {LOCALE_META[loc].nativeName}
                </button>
              ))}
            </nav>
            <a
              href={`/p/${locale}`}
              className="clay-btn-secondary text-sm whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-4 h-4" />
              {t.nav.publicSite}
            </a>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
          <div className="max-w-5xl w-full grid lg:grid-cols-2 gap-6 items-stretch">
            <div className="clay-card p-8 sm:p-10 flex flex-col justify-between gap-6">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#006B35] mb-3">
                  {t.brandTagline}
                </p>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#17191C] mb-4 text-balance">
                  {t.auth.signInTitle}
                </h1>
                <p className="text-base text-[#525866] leading-relaxed">
                  {t.auth.signInSubtitle}
                </p>
              </div>

              <div className="space-y-4">
                {error && (
                  <div className="p-4 rounded-[10px] bg-red-50 border border-red-200 text-sm text-red-800">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={signInWithGoogle}
                  className="clay-btn-primary w-full text-base"
                >
                  <Globe className="w-5 h-5" />
                  {t.auth.signInButton}
                </button>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-[#525866]">
                  <span>Français · English · Fɔngbè</span>
                  <a
                    href={`/p/${locale}`}
                    className="font-semibold text-[#006B35] hover:underline inline-flex items-center gap-1.5 min-h-[48px]"
                  >
                    {t.publicReader.allArticles}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>

            <div className="clay-card overflow-hidden min-h-[280px] bg-[#E5F3EA] relative">
              <img
                src="/assets/images/editorial_notebook_cover_1794750583741.jpg"
                alt="AILEA PostManager editorial workspace"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="bg-white border-b border-[#DFE5EC]">
          <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
            <span className="text-lg font-bold tracking-tight text-[#17191C]">AILEA PostManager</span>
            <button
              type="button"
              onClick={logout}
              className="clay-btn-secondary text-sm"
            >
              <LogOut className="w-4 h-4" />
              {t.auth.signOut}
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
          {loadingData && !needsOnboarding ? (
            <div className="clay-card p-8 text-center max-w-sm w-full">
              <p className="text-base font-medium text-[#525866]">{t.common.loading}</p>
            </div>
          ) : (
            <div className="clay-card p-8 max-w-xl w-full space-y-6">
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#006B35] mb-2">
                  {t.brandTagline}
                </p>
                <h1 className="text-2xl font-bold text-[#17191C]">
                  Initialiser votre accès éditorial
                </h1>
                <p className="text-sm text-[#525866] mt-2">
                  Créez votre propre espace de publication ou rejoignez une équipe existante à l’aide d’un jeton d’invitation.
                </p>
              </div>

              {(error || onboardingError) && (
                <div className="p-4 rounded-[10px] bg-red-50 border border-red-200 text-sm text-red-800">
                  {onboardingError || error}
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="button"
                  disabled={onboardingBusy}
                  onClick={handleOnboardingCreateWorkspace}
                  className="clay-btn-primary w-full text-base"
                >
                  <Plus className="w-5 h-5" />
                  Créer mon espace éditorial personnel
                </button>
              </div>

              <form onSubmit={handleOnboardingAcceptInvite} className="pt-5 border-t border-[#DFE5EC] space-y-3">
                <h2 className="text-sm font-bold text-[#17191C] flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#006B35]" />
                  Rejoindre un espace avec une invitation
                </h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={acceptWorkspaceId}
                    onChange={(e) => setAcceptWorkspaceId(e.target.value)}
                    placeholder="Identifiant de l’espace (ws_...)"
                    className="clay-input text-sm font-mono-tabular"
                    required
                  />
                  <input
                    type="text"
                    value={acceptToken}
                    onChange={(e) => setAcceptToken(e.target.value)}
                    placeholder="Jeton d’invitation"
                    className="clay-input text-sm font-mono-tabular"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={onboardingBusy}
                  className="clay-btn-secondary text-sm"
                >
                  Accepter l’invitation
                </button>
              </form>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-[#DFE5EC] p-4 justify-between">
        <div className="space-y-6">
          <div className="px-2 pt-1 space-y-2">
            <div className="text-lg font-bold tracking-tight text-[#17191C]">
              AILEA PostManager
            </div>
            {memberships.length > 1 && workspace ? (
              <select
                aria-label="Espace de travail"
                value={workspace.id}
                onChange={(e) => switchWorkspace(e.target.value)}
                className="clay-input text-xs font-semibold py-2 min-h-[40px]"
              >
                {memberships.map((m) => (
                  <option key={m.workspace.id} value={m.workspace.id}>
                    {m.workspace.brandName} ({m.role})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-[#525866] truncate">
                {workspace?.brandName || t.brandTagline}
              </div>
            )}
          </div>

          <nav className="space-y-1" aria-label="Navigation principale">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeModule;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectModule(item.id)}
                  className={`w-full min-h-[48px] px-3.5 rounded-[10px] flex items-center gap-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#E5F3EA] text-[#006B35]'
                      : 'text-[#525866] hover:bg-[#F1F4F6] hover:text-[#17191C]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-[#DFE5EC]">
          <a
            href={`/p/${locale}`}
            target="_blank"
            rel="noopener noreferrer"
            className="clay-btn-secondary w-full text-sm justify-between"
          >
            <span>{t.nav.publicSite}</span>
            <ExternalLink className="w-4 h-4 text-[#006B35]" />
          </a>

          <div className="px-2 py-1 text-xs text-[#525866]">
            <div className="font-semibold text-[#17191C] truncate">
              {firebaseUser.displayName || firebaseUser.email}
            </div>
            <div className="mt-0.5">
              {t.auth.roleLabel} · {role}
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[48px] px-3 rounded-[10px] flex items-center gap-2.5 text-sm font-medium text-[#525866] hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.auth.signOut}</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#17191C]/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white h-full p-4 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-lg font-bold text-[#17191C]">AILEA PostManager</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[10px] hover:bg-[#F1F4F6]"
                  aria-label="Fermer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {memberships.length > 1 && workspace && (
                <select
                  aria-label="Espace de travail"
                  value={workspace.id}
                  onChange={(e) => {
                    switchWorkspace(e.target.value);
                    setMobileMenuOpen(false);
                  }}
                  className="clay-input text-xs font-semibold py-2 min-h-[40px]"
                >
                  {memberships.map((m) => (
                    <option key={m.workspace.id} value={m.workspace.id}>
                      {m.workspace.brandName} ({m.role})
                    </option>
                  ))}
                </select>
              )}
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === activeModule;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelectModule(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full min-h-[48px] px-3.5 rounded-[10px] flex items-center gap-3 text-sm font-semibold ${
                        isActive ? 'bg-[#E5F3EA] text-[#006B35]' : 'text-[#525866]'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="pt-4 border-t border-[#DFE5EC] space-y-2">
              <a
                href={`/p/${locale}`}
                target="_blank"
                rel="noopener noreferrer"
                className="clay-btn-secondary w-full text-sm"
              >
                <ExternalLink className="w-4 h-4" />
                {t.nav.publicSite}
              </a>
              <button
                type="button"
                onClick={logout}
                className="w-full min-h-[48px] px-3 rounded-[10px] flex items-center gap-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4" />
                {t.auth.signOut}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white/95 backdrop-blur border-b border-[#DFE5EC] sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[10px] border border-[#DFE5EC] bg-white"
                aria-label="Menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="truncate">
                <span className="text-sm font-semibold text-[#17191C]">{activeNav.label}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {SUPPORTED_LOCALES.map((loc: Locale) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setLocale(loc)}
                  className={`min-h-[48px] px-3 rounded-[10px] text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    locale === loc
                      ? 'bg-[#E5F3EA] text-[#006B35]'
                      : 'text-[#525866] hover:bg-[#F1F4F6] hover:text-[#17191C]'
                  }`}
                >
                  {LOCALE_META[loc].nativeName}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
