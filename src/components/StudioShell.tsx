import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Check,
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
import { AnimatePresence, motion, PanInfo, useDragControls, useReducedMotion } from 'motion/react';
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

interface NativeBottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function NativeBottomSheet({ open, onClose, title, subtitle, children }: NativeBottomSheetProps) {
  const prefersReducedMotion = useReducedMotion();
  const dragControls = useDragControls();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 450) {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0.01 : 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#17191C]/45 backdrop-blur-[2px]"
          />

          <motion.section
            initial={prefersReducedMotion ? { opacity: 0 } : { y: '100%' }}
            animate={prefersReducedMotion ? { opacity: 1 } : { y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { y: '100%' }}
            transition={
              prefersReducedMotion
                ? { duration: 0.01 }
                : { type: 'spring', damping: 34, stiffness: 340, mass: 0.9 }
            }
            drag={prefersReducedMotion ? false : 'y'}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 0.55 }}
            dragTransition={{ bounceStiffness: 400, bounceDamping: 34 }}
            onDragEnd={handleDragEnd}
            className="relative z-10 w-full sm:max-w-lg bg-white rounded-t-[24px] border-t border-x border-[#DFE5EC] shadow-[0_-16px_44px_-12px_rgba(23,25,28,0.22)] h-[96vh] supports-[height:96dvh]:h-[96dvh] flex flex-col overflow-hidden will-change-transform"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            {/* Native grab handle + sheet header */}
            <div
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('button')) return;
                if (!prefersReducedMotion) dragControls.start(e);
              }}
              className="pt-3 pb-3 px-5 border-b border-[#DFE5EC] shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
            >
              <div
                aria-hidden="true"
                className="w-10 h-1.5 rounded-full bg-[#CBD5E1] mx-auto mb-3"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-bold tracking-tight text-[#17191C] truncate">
                    {title}
                  </div>
                  {subtitle && (
                    <div className="text-xs text-[#525866] truncate mt-0.5">{subtitle}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[12px] text-[#525866] hover:bg-[#F1F4F6] hover:text-[#17191C] active:scale-95 transition-all cursor-pointer shrink-0"
                  aria-label="Fermer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable sheet body */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 flex flex-col gap-5">
              {children}
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
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
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);
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

  const renderLocaleSelector = (onSelected?: () => void) => (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-[#525866]">Langue · Language · Gbè</div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Langue">
        {SUPPORTED_LOCALES.map((loc: Locale) => {
          const isCurrent = locale === loc;
          return (
            <button
              key={loc}
              type="button"
              onClick={() => {
                setLocale(loc);
                onSelected?.();
              }}
              className={`min-h-[48px] px-3 rounded-[12px] text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap border ${
                isCurrent
                  ? 'bg-[#E5F3EA] border-[#006B35]/30 text-[#006B35]'
                  : 'bg-[#F8FAFB] border-[#DFE5EC] text-[#525866] hover:bg-[#F1F4F6] hover:text-[#17191C]'
              }`}
            >
              <span>{LOCALE_META[loc].nativeName}</span>
              {isCurrent && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderMenuButton = () => (
    <button
      type="button"
      onClick={() => setMenuSheetOpen(true)}
      className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-[12px] border border-[#DFE5EC] bg-white text-[#17191C] hover:bg-[#F1F4F6] active:scale-95 transition-all cursor-pointer shrink-0"
      aria-label="Menu"
      aria-expanded={menuSheetOpen}
    >
      <Menu className="w-5 h-5" />
    </button>
  );

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
        <header className="bg-white/95 backdrop-blur border-b border-[#DFE5EC] sticky top-0 z-30">
          <div className="max-w-6xl mx-auto px-5 py-2.5 flex items-center justify-between gap-4">
            <span className="text-lg font-bold tracking-tight text-[#17191C] whitespace-nowrap shrink-0">
              AILEA PostManager
            </span>
            {renderMenuButton()}
          </div>
        </header>

        <NativeBottomSheet
          open={menuSheetOpen}
          onClose={() => setMenuSheetOpen(false)}
          title="AILEA PostManager"
          subtitle={t.brandTagline}
        >
          {renderLocaleSelector(() => setMenuSheetOpen(false))}

          <div className="mt-auto pt-4 border-t border-[#DFE5EC]">
            <a
              href={`/p/${locale}`}
              onClick={() => setMenuSheetOpen(false)}
              className="clay-btn-secondary w-full text-sm justify-between"
            >
              <span className="inline-flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#006B35]" />
                {t.nav.publicSite}
              </span>
              <ExternalLink className="w-4 h-4 text-[#525866]" />
            </a>
          </div>
        </NativeBottomSheet>

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
        <header className="bg-white/95 backdrop-blur border-b border-[#DFE5EC] sticky top-0 z-30">
          <div className="max-w-5xl mx-auto px-5 py-2.5 flex items-center justify-between gap-4">
            <span className="text-lg font-bold tracking-tight text-[#17191C] whitespace-nowrap shrink-0">
              AILEA PostManager
            </span>
            {renderMenuButton()}
          </div>
        </header>

        <NativeBottomSheet
          open={menuSheetOpen}
          onClose={() => setMenuSheetOpen(false)}
          title="AILEA PostManager"
          subtitle={firebaseUser.displayName || firebaseUser.email || undefined}
        >
          {renderLocaleSelector(() => setMenuSheetOpen(false))}

          <div className="mt-auto pt-4 border-t border-[#DFE5EC] space-y-2.5">
            <a
              href={`/p/${locale}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuSheetOpen(false)}
              className="clay-btn-secondary w-full text-sm justify-between"
            >
              <span className="inline-flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#006B35]" />
                {t.nav.publicSite}
              </span>
              <ExternalLink className="w-4 h-4 text-[#525866]" />
            </a>

            <button
              type="button"
              onClick={() => {
                setMenuSheetOpen(false);
                logout();
              }}
              className="w-full min-h-[48px] px-4 rounded-[12px] flex items-center justify-center gap-2 text-sm font-semibold text-red-700 bg-red-50/70 hover:bg-red-50 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{t.auth.signOut}</span>
            </button>
          </div>
        </NativeBottomSheet>

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

      {/* Native-Feel Bottom Sheet opened from the Menu icon button */}
      <NativeBottomSheet
        open={menuSheetOpen}
        onClose={() => setMenuSheetOpen(false)}
        title="AILEA PostManager"
        subtitle={`${workspace.brandName} · ${activeNav.label}`}
      >
        {memberships.length > 1 && (
          <div className="space-y-1.5">
            <label htmlFor="sheet-workspace-select" className="block text-xs font-semibold text-[#525866]">
              Espace éditorial
            </label>
            <select
              id="sheet-workspace-select"
              aria-label="Espace de travail"
              value={workspace.id}
              onChange={(e) => {
                switchWorkspace(e.target.value);
                setMenuSheetOpen(false);
              }}
              className="clay-input text-sm font-semibold py-2 min-h-[48px]"
            >
              {memberships.map((m) => (
                <option key={m.workspace.id} value={m.workspace.id}>
                  {m.workspace.brandName} ({m.role})
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="space-y-1" aria-label="Navigation principale">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeModule;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectModule(item.id);
                  setMenuSheetOpen(false);
                }}
                className={`w-full min-h-[48px] px-3.5 rounded-[12px] flex items-center gap-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
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

        <div className="pt-4 border-t border-[#DFE5EC]">
          {renderLocaleSelector(() => setMenuSheetOpen(false))}
        </div>

        <div className="mt-auto pt-4 border-t border-[#DFE5EC] space-y-3">
          <a
            href={`/p/${locale}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuSheetOpen(false)}
            className="clay-btn-secondary w-full text-sm justify-between"
          >
            <span>{t.nav.publicSite}</span>
            <ExternalLink className="w-4 h-4 text-[#006B35]" />
          </a>

          <div className="px-1 text-xs text-[#525866] flex items-center justify-between gap-2">
            <span className="font-semibold text-[#17191C] truncate">
              {firebaseUser.displayName || firebaseUser.email}
            </span>
            <span className="shrink-0">
              {t.auth.roleLabel} · {role}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setMenuSheetOpen(false);
              logout();
            }}
            className="w-full min-h-[48px] px-4 rounded-[12px] flex items-center justify-center gap-2 text-sm font-semibold text-red-700 bg-red-50/70 hover:bg-red-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.auth.signOut}</span>
          </button>
        </div>
      </NativeBottomSheet>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white/95 backdrop-blur border-b border-[#DFE5EC] sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="lg:hidden text-lg font-bold tracking-tight text-[#17191C] whitespace-nowrap shrink-0">
                AILEA PostManager
              </span>
              <span className="hidden lg:inline text-sm font-semibold text-[#17191C] truncate">
                {activeNav.label}
              </span>
            </div>

            {renderMenuButton()}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1360px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
