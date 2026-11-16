import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth } from './firebaseAdmin.ts';
import { isEmulatorModeRequested } from './emulatorGuard.ts';
import { RepositoryError } from './repository.ts';
import { adminMutationLimiter, computeIpBucketKey } from './security.ts';
import { verifyWorkspaceMembership } from './store.ts';
import { UserRole } from '../shared/types.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  idToken?: string;
  workspaceId?: string;
  memberRole?: UserRole;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export async function verifyBearerToken(req: AuthRequest, res: Response): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentification requise (jeton manquant).' });
    return false;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Jeton d’authentification vide.' });
    return false;
  }

  try {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAdminAuth().verifyIdToken(token, true);
    } catch (verifyErr) {
      const errCode = (verifyErr as { code?: string })?.code || '';
      const errMsg = String((verifyErr as { message?: string })?.message || '');
      const isSandboxIamFailure =
        process.env.VITEST !== 'true' &&
        !isEmulatorModeRequested() &&
        (errCode === 'auth/internal-error' ||
          errMsg.includes('identitytoolkit.googleapis.com') ||
          errMsg.includes('PERMISSION_DENIED'));
      if (!isSandboxIamFailure) {
        throw verifyErr;
      }
      decoded = await getAdminAuth().verifyIdToken(token, false);
    }

    if (decoded.email_verified !== true) {
      res.status(403).json({
        error: 'Adresse e-mail non vérifiée. Veuillez vérifier votre adresse e-mail.',
      });
      return false;
    }

    if (!decoded.email || typeof decoded.email !== 'string') {
      res.status(403).json({
        error: 'Adresse e-mail requise sur le jeton d’authentification.',
      });
      return false;
    }

    req.user = decoded;
    req.idToken = token;
    return true;
  } catch (err) {
    const errCode = (err as { code?: string })?.code || '';
    if (errCode === 'auth/id-token-revoked') {
      res.status(401).json({ error: 'Session révoquée. Veuillez vous reconnecter.' });
      return false;
    }
    if (errCode === 'auth/id-token-expired') {
      res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
      return false;
    }
    res.status(401).json({ error: 'Session invalide ou expirée.' });
    return false;
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const ok = await verifyBearerToken(req, res);
  if (!ok || !req.user) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const rate = adminMutationLimiter.consume(`${req.user.uid}:${computeIpBucketKey(req)}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      res.status(429).json({ error: 'Trop de requêtes. Veuillez patienter quelques secondes.' });
      return;
    }
  }

  next();
}

/**
 * Verifies workspace membership server-side.
 * NEVER trusts a client-supplied X-Workspace-Id without checking Firestore membership/ownership.
 */
export async function requireWorkspaceAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Non authentifié.' });
    return;
  }

  const headerWs = req.headers['x-workspace-id'];
  const requestedWorkspaceId = typeof headerWs === 'string' && headerWs.trim() ? headerWs.trim() : undefined;

  if (requestedWorkspaceId && !VALID_ID_REGEX.test(requestedWorkspaceId)) {
    res.status(400).json({ error: 'Identifiant d’espace de travail invalide.' });
    return;
  }

  try {
    const resolved = await verifyWorkspaceMembership({
      uid: req.user.uid,
      email: req.user.email!,
      displayName: typeof req.user.name === 'string' ? req.user.name : undefined,
      requestedWorkspaceId,
    });
    req.workspaceId = resolved.workspace.id;
    req.memberRole = resolved.role;
    next();
  } catch (err) {
    if (err instanceof RepositoryError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    console.error('Workspace verification error:', err);
    res.status(500).json({ error: 'Impossible de vérifier l’accès à l’espace de travail.' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.memberRole;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({
        error: `Permissions insuffisantes. Rôles autorisés : ${allowedRoles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}
