import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiRequest, setActiveWorkspaceId } from '../lib/api.ts';
import {
  Category,
  FullPostBundle,
  MediaAsset,
  ReactionPreset,
  Tag,
  UserProfile,
  UserRole,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceMembershipSummary,
} from '../shared/types.ts';

interface BootstrapPayload {
  user: UserProfile;
  workspace: Workspace | null;
  role: UserRole;
  memberships?: WorkspaceMembershipSummary[];
  needsOnboarding?: boolean;
  posts: FullPostBundle[];
  presets: ReactionPreset[];
  categories: Category[];
  tags: Tag[];
  mediaAssets: MediaAsset[];
  members: WorkspaceMember[];
  invites?: WorkspaceInvite[];
}

const WORKSPACE_STORAGE_KEY = 'ailea_active_workspace_id';

function readStoredWorkspaceId(): string | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem(WORKSPACE_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeStoredWorkspaceId(workspaceId: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (workspaceId) {
      window.sessionStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
    } else {
      window.sessionStorage.removeItem(WORKSPACE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

interface AuthContextValue {
  firebaseUser: User | null;
  authReady: boolean;
  loadingData: boolean;
  needsOnboarding: boolean;
  error: string | null;
  userProfile: UserProfile | null;
  workspace: Workspace | null;
  role: UserRole;
  memberships: WorkspaceMembershipSummary[];
  posts: FullPostBundle[];
  presets: ReactionPreset[];
  categories: Category[];
  tags: Tag[];
  mediaAssets: MediaAsset[];
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshWorkspace: (targetWorkspaceId?: string | null) => Promise<void>;
  createPersonalWorkspace: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  setPosts: React.Dispatch<React.SetStateAction<FullPostBundle[]>>;
  setPresets: React.Dispatch<React.SetStateAction<ReactionPreset[]>>;
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  setTags: React.Dispatch<React.SetStateAction<Tag[]>>;
  setMediaAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  setMembers: React.Dispatch<React.SetStateAction<WorkspaceMember[]>>;
  setInvites: React.Dispatch<React.SetStateAction<WorkspaceInvite[]>>;
  setWorkspace: React.Dispatch<React.SetStateAction<Workspace | null>>;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  authReady: false,
  loadingData: false,
  needsOnboarding: false,
  error: null,
  userProfile: null,
  workspace: null,
  role: 'viewer',
  memberships: [],
  posts: [],
  presets: [],
  categories: [],
  tags: [],
  mediaAssets: [],
  members: [],
  invites: [],
  signInWithGoogle: async () => {},
  logout: async () => {},
  refreshWorkspace: async () => {},
  createPersonalWorkspace: async () => {},
  switchWorkspace: async () => {},
  setPosts: () => {},
  setPresets: () => {},
  setCategories: () => {},
  setTags: () => {},
  setMediaAssets: () => {},
  setMembers: () => {},
  setInvites: () => {},
  setWorkspace: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [role, setRole] = useState<UserRole>('viewer');
  const [memberships, setMemberships] = useState<WorkspaceMembershipSummary[]>([]);
  const [posts, setPosts] = useState<FullPostBundle[]>([]);
  const [presets, setPresets] = useState<ReactionPreset[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);

  const loadBootstrap = useCallback(
    async (targetWorkspaceId?: string | null, opts?: { createPersonalWorkspace?: boolean }) => {
      if (!auth.currentUser) return;
      setLoadingData(true);
      setError(null);
      const createPersonalWorkspace = opts?.createPersonalWorkspace ?? false;

      const applyPayload = (data: BootstrapPayload) => {
        setUserProfile(data.user);
        setMemberships(data.memberships || []);
        setRole(data.role);

        if (!data.workspace) {
          setActiveWorkspaceId(null);
          writeStoredWorkspaceId(null);
          setWorkspace(null);
          setNeedsOnboarding(Boolean(data.needsOnboarding ?? true));
          setPosts([]);
          setPresets([]);
          setCategories([]);
          setTags([]);
          setMediaAssets([]);
          setMembers([]);
          setInvites([]);
          return;
        }

        setNeedsOnboarding(false);
        setActiveWorkspaceId(data.workspace.id);
        writeStoredWorkspaceId(data.workspace.id);
        setWorkspace(data.workspace);
        setPosts(data.posts);
        setPresets(data.presets);
        setCategories(data.categories);
        setTags(data.tags);
        setMediaAssets(data.mediaAssets);
        setMembers(data.members);
        setInvites(data.invites || []);
      };

      try {
        const data = await apiRequest<BootstrapPayload>('/api/admin/bootstrap', {
          method: 'POST',
          workspaceId: targetWorkspaceId,
          body: { createPersonalWorkspace },
        });
        applyPayload(data);
      } catch (err) {
        if (targetWorkspaceId) {
          writeStoredWorkspaceId(null);
          try {
            const fallback = await apiRequest<BootstrapPayload>('/api/admin/bootstrap', {
              method: 'POST',
              workspaceId: null,
              body: { createPersonalWorkspace },
            });
            applyPayload(fallback);
            return;
          } catch (fallbackErr) {
            setError(fallbackErr instanceof Error ? fallbackErr.message : 'Erreur de chargement.');
            return;
          }
        }
        setError(err instanceof Error ? err.message : 'Erreur de chargement.');
      } finally {
        setLoadingData(false);
      }
    },
    []
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (user) {
        loadBootstrap(readStoredWorkspaceId(), { createPersonalWorkspace: false });
      } else {
        setActiveWorkspaceId(null);
        writeStoredWorkspaceId(null);
        setNeedsOnboarding(false);
        setUserProfile(null);
        setWorkspace(null);
        setMemberships([]);
        setPosts([]);
        setPresets([]);
        setCategories([]);
        setTags([]);
        setMediaAssets([]);
        setMembers([]);
        setInvites([]);
      }
    });
    return () => unsub();
  }, [loadBootstrap]);

  const signInWithGoogle = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connexion Google annulée ou refusée.');
    }
  };

  const logout = async () => {
    setActiveWorkspaceId(null);
    writeStoredWorkspaceId(null);
    await signOut(auth);
  };

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      await loadBootstrap(workspaceId, { createPersonalWorkspace: false });
    },
    [loadBootstrap]
  );

  const createPersonalWorkspace = useCallback(async () => {
    await loadBootstrap(null, { createPersonalWorkspace: true });
  }, [loadBootstrap]);

  const refreshWorkspace = useCallback(
    async (targetWorkspaceId?: string | null) => {
      await loadBootstrap(targetWorkspaceId, { createPersonalWorkspace: false });
    },
    [loadBootstrap]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        authReady,
        loadingData,
        needsOnboarding,
        error,
        userProfile,
        workspace,
        role,
        memberships,
        posts,
        presets,
        categories,
        tags,
        mediaAssets,
        members,
        invites,
        signInWithGoogle,
        logout,
        refreshWorkspace,
        createPersonalWorkspace,
        switchWorkspace,
        setPosts,
        setPresets,
        setCategories,
        setTags,
        setMediaAssets,
        setMembers,
        setInvites,
        setWorkspace,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
