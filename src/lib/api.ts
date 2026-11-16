import { auth } from './firebase.ts';

let activeWorkspaceId: string | null = null;

export function setActiveWorkspaceId(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId;
}

export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    requireAuthToken?: boolean;
    workspaceId?: string | null;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const wsId = options.workspaceId !== undefined ? options.workspaceId : activeWorkspaceId;
  if (wsId) {
    headers['X-Workspace-Id'] = wsId;
  }

  if (options.requireAuthToken !== false) {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Utilisateur non authentifié.');
    }
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Erreur HTTP ${response.status}`);
    }
    return data as T;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Erreur HTTP ${response.status}`);
  }
  return text as unknown as T;
}
