import crypto from 'node:crypto';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin.ts';
import {
  DataRepository,
  QueryOptions,
  RedeemInviteParams,
  RedeemInviteResult,
  RepoWriteOp,
  RepositoryError,
  TransactionContext,
} from './repository.ts';
import { Workspace, WorkspaceInvite, WorkspaceMember } from '../shared/types.ts';

function normalizeDocPath(docPath: string): string {
  const trimmed = docPath.replace(/^\/+|\/+$/g, '');
  const parts = trimmed.split('/');
  if (parts.length < 2 || parts.length % 2 !== 0) {
    throw new RepositoryError('INVALID_ARGUMENT', `Invalid Firestore document path: "${docPath}"`);
  }
  return trimmed;
}

function normalizeCollectionPath(collectionPath: string): string {
  const trimmed = collectionPath.replace(/^\/+|\/+$/g, '');
  const parts = trimmed.split('/');
  if (parts.length < 1 || parts.length % 2 !== 1) {
    throw new RepositoryError('INVALID_ARGUMENT', `Invalid Firestore collection path: "${collectionPath}"`);
  }
  return trimmed;
}

export function mapFirestoreError(err: unknown, contextMessage?: string): RepositoryError {
  if (err instanceof RepositoryError) return err;

  const anyErr = err as { code?: number | string; message?: string; details?: string };
  const rawCode = anyErr?.code;
  const msg = String(anyErr?.message || anyErr?.details || err || 'Firestore error');
  const lower = msg.toLowerCase();

  if (
    rawCode === 6 ||
    rawCode === 'already-exists' ||
    lower.includes('already exists') ||
    lower.includes('already_exists')
  ) {
    return new RepositoryError('ALREADY_EXISTS', contextMessage || 'La ressource existe déjà.', err);
  }
  if (rawCode === 5 || rawCode === 'not-found' || lower.includes('not_found') || lower.includes('no entity to update')) {
    return new RepositoryError('NOT_FOUND', contextMessage || 'Ressource introuvable.', err);
  }
  if (rawCode === 7 || rawCode === 'permission-denied' || lower.includes('permission_denied')) {
    return new RepositoryError('PERMISSION_DENIED', contextMessage || 'Accès refusé.', err);
  }
  if (
    rawCode === 10 ||
    rawCode === 9 ||
    rawCode === 'aborted' ||
    rawCode === 'failed-precondition' ||
    lower.includes('aborted') ||
    lower.includes('contention')
  ) {
    return new RepositoryError('CONFLICT', contextMessage || 'Conflit transactionnel détecté.', err);
  }
  if (
    rawCode === 14 ||
    rawCode === 4 ||
    rawCode === 'unavailable' ||
    rawCode === 'deadline-exceeded' ||
    lower.includes('unavailable') ||
    lower.includes('econnrefused') ||
    lower.includes('failed to connect') ||
    lower.includes('deadline exceeded')
  ) {
    return new RepositoryError('UNAVAILABLE', contextMessage || 'Service de persistance indisponible.', err);
  }
  if (rawCode === 3 || rawCode === 'invalid-argument') {
    return new RepositoryError('INVALID_ARGUMENT', contextMessage || 'Argument de requête invalide.', err);
  }

  return new RepositoryError('INTERNAL', contextMessage || 'Erreur interne du service de persistance.', err);
}

export class FirestoreRepository implements DataRepository {
  public readonly backendName = 'firestore' as const;

  constructor(private readonly dbResolver: () => Firestore = getAdminDb) {}

  private get db(): Firestore {
    return this.dbResolver();
  }

  private docRef(docPath: string): DocumentReference {
    return this.db.doc(normalizeDocPath(docPath));
  }

  async ping(timeoutMs = 2500): Promise<void> {
    try {
      const timer = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new RepositoryError('UNAVAILABLE', `Firestore ping timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      await Promise.race([this.db.collection('_health').limit(1).get(), timer]);
    } catch (err) {
      throw mapFirestoreError(err, 'Base de données Firestore inaccessible.');
    }
  }

  async get<T = Record<string, unknown>>(docPath: string): Promise<T | null> {
    try {
      const snap = await this.docRef(docPath).get();
      if (!snap.exists) return null;
      return snap.data() as T;
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async getWorkspaceScoped<T extends { workspaceId: string }>(
    collection: string,
    docId: string,
    workspaceId: string
  ): Promise<T | null> {
    const doc = await this.get<T>(`${collection}/${docId}`);
    if (!doc) return null;
    if (doc.workspaceId !== workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces interdit.');
    }
    return doc;
  }

  async query<T = Record<string, unknown>>(
    collectionPath: string,
    options: QueryOptions = {}
  ): Promise<Array<{ id: string; data: T }>> {
    try {
      let ref: FirebaseFirestore.Query = this.db.collection(normalizeCollectionPath(collectionPath));
      if (options.filters) {
        for (const f of options.filters) {
          ref = ref.where(f.field, f.op, f.value);
        }
      }
      if (options.orderBy) {
        for (const o of options.orderBy) {
          ref = ref.orderBy(o.field, o.direction || 'asc');
        }
      }
      if (options.limit && options.limit > 0) {
        ref = ref.limit(options.limit);
      }
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async queryCollectionGroup<T = Record<string, unknown>>(
    collectionId: string,
    options: QueryOptions = {}
  ): Promise<Array<{ id: string; path: string; data: T }>> {
    try {
      let ref: FirebaseFirestore.Query = this.db.collectionGroup(collectionId);
      if (options.filters) {
        for (const f of options.filters) {
          ref = ref.where(f.field, f.op, f.value);
        }
      }
      if (options.orderBy) {
        for (const o of options.orderBy) {
          ref = ref.orderBy(o.field, o.direction || 'asc');
        }
      }
      if (options.limit && options.limit > 0) {
        ref = ref.limit(options.limit);
      }
      const snap = await ref.get();
      return snap.docs.map((d) => ({ id: d.id, path: d.ref.path, data: d.data() as T }));
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async create<T extends Record<string, unknown>>(docPath: string, data: T): Promise<void> {
    try {
      await this.docRef(docPath).create(data);
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async set<T extends Record<string, unknown>>(docPath: string, data: T): Promise<void> {
    try {
      await this.docRef(docPath).set(data);
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async update(docPath: string, patch: Record<string, unknown>): Promise<void> {
    try {
      await this.docRef(docPath).update(patch);
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async delete(docPath: string): Promise<void> {
    try {
      await this.docRef(docPath).delete();
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async commitBatch(ops: RepoWriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    try {
      // Firestore batch limit is 500 writes
      for (let i = 0; i < ops.length; i += 450) {
        const chunk = ops.slice(i, i + 450);
        const batch = this.db.batch();
        for (const op of chunk) {
          const ref = this.docRef(op.path);
          if (op.type === 'delete') {
            batch.delete(ref);
          } else if (op.type === 'update') {
            batch.update(ref, op.data || {});
          } else if (op.type === 'create') {
            batch.create(ref, op.data || {});
          } else {
            batch.set(ref, op.data || {});
          }
        }
        await batch.commit();
      }
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async runTransaction<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R> {
    try {
      return await this.db.runTransaction(async (fsTx: Transaction) => {
        const ctx: TransactionContext = {
          get: async <T = Record<string, unknown>>(docPath: string): Promise<T | null> => {
            const snap = await fsTx.get(this.docRef(docPath));
            if (!snap.exists) return null;
            return snap.data() as T;
          },
          create: (docPath: string, data: Record<string, unknown>) => {
            fsTx.create(this.docRef(docPath), data);
          },
          set: (docPath: string, data: Record<string, unknown>) => {
            fsTx.set(this.docRef(docPath), data);
          },
          update: (docPath: string, patch: Record<string, unknown>) => {
            fsTx.update(this.docRef(docPath), patch);
          },
          delete: (docPath: string) => {
            fsTx.delete(this.docRef(docPath));
          },
        };
        return fn(ctx);
      });
    } catch (err) {
      throw mapFirestoreError(err);
    }
  }

  async createWorkspaceWithOwner(params: {
    workspace: Workspace;
    ownerMember: WorkspaceMember;
    seedOps?: RepoWriteOp[];
  }): Promise<void> {
    const wsPath = `workspaces/${params.workspace.id}`;
    const memberPath = `workspaces/${params.workspace.id}/members/${params.ownerMember.userId}`;
    const slugLockPath = `workspaceSlugLocks/${params.workspace.slug}`;

    await this.runTransaction(async (tx) => {
      const [existing, existingSlugLock] = await Promise.all([
        tx.get<Workspace>(wsPath),
        tx.get<{ workspaceId: string }>(slugLockPath),
      ]);
      if (existing) {
        throw new RepositoryError('ALREADY_EXISTS', 'Cet espace de travail existe déjà.');
      }
      if (existingSlugLock && existingSlugLock.workspaceId !== params.workspace.id) {
        throw new RepositoryError('CONFLICT', `Le slug d’espace "${params.workspace.slug}" est déjà réservé.`);
      }
      tx.create(slugLockPath, {
        id: params.workspace.slug,
        workspaceId: params.workspace.id,
        slug: params.workspace.slug,
        createdAt: params.workspace.createdAt,
      });
      tx.create(wsPath, params.workspace as unknown as Record<string, unknown>);
      tx.create(memberPath, params.ownerMember as unknown as Record<string, unknown>);
      if (params.seedOps) {
        for (const op of params.seedOps) {
          if (op.type === 'create') {
            tx.create(op.path, op.data || {});
          } else if (op.type === 'set') {
            tx.set(op.path, op.data || {});
          }
        }
      }
    });
  }

  async redeemInviteAtomic(params: RedeemInviteParams): Promise<RedeemInviteResult> {
    const cleanEmail = params.email.toLowerCase().trim();
    const emailHash = crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 32);
    const wsPath = `workspaces/${params.workspaceId}`;
    const invitePath = `workspaces/${params.workspaceId}/invites/${params.tokenHash}`;
    const inviteLockPath = `workspaces/${params.workspaceId}/inviteLocks/${emailHash}`;
    const memberPath = `workspaces/${params.workspaceId}/members/${params.uid}`;

    return this.runTransaction(async (tx) => {
      const [workspace, invite, existingMember, existingLock] = await Promise.all([
        tx.get<Workspace>(wsPath),
        tx.get<WorkspaceInvite>(invitePath),
        tx.get<WorkspaceMember>(memberPath),
        tx.get<{ inviteId?: string }>(inviteLockPath),
      ]);

      if (!workspace) {
        throw new RepositoryError('NOT_FOUND', 'Invitation invalide ou expirée.');
      }

      if (!invite) {
        throw new RepositoryError('NOT_FOUND', 'Invitation invalide ou expirée.');
      }

      if (invite.email.toLowerCase().trim() !== cleanEmail) {
        throw new RepositoryError(
          'PERMISSION_DENIED',
          'Cette invitation ne correspond pas à votre adresse e-mail vérifiée.'
        );
      }

      if (invite.status === 'accepted') {
        throw new RepositoryError('CONFLICT', 'Cette invitation a déjà été utilisée.');
      }

      if (invite.status === 'revoked') {
        throw new RepositoryError('PERMISSION_DENIED', 'Cette invitation a été révoquée.');
      }

      if (invite.status === 'expired' || Date.parse(invite.expiresAt) <= Date.parse(params.nowIso)) {
        throw new RepositoryError('CONFLICT', 'Cette invitation a expiré.');
      }

      if (existingMember) {
        throw new RepositoryError('CONFLICT', 'Vous êtes déjà membre de cet espace de travail.');
      }

      const member: WorkspaceMember = {
        id: params.uid,
        workspaceId: params.workspaceId,
        userId: params.uid,
        email: cleanEmail,
        displayName: params.displayName || cleanEmail.split('@')[0] || 'Collaborateur',
        role: invite.role,
        invitedBy: invite.invitedBy,
        createdAt: params.nowIso,
        updatedAt: params.nowIso,
      };

      const acceptedInvite: WorkspaceInvite = {
        ...invite,
        status: 'accepted',
        acceptedAt: params.nowIso,
        acceptedByUid: params.uid,
      };

      tx.create(memberPath, member as unknown as Record<string, unknown>);
      tx.update(invitePath, {
        status: 'accepted',
        acceptedAt: params.nowIso,
        acceptedByUid: params.uid,
      });
      if (existingLock && (!existingLock.inviteId || existingLock.inviteId === invite.id)) {
        tx.delete(inviteLockPath);
      }

      return { invite: acceptedInvite, member, workspace };
    });
  }
}

let defaultRepository: DataRepository = new FirestoreRepository();

export function getRepository(): DataRepository {
  return defaultRepository;
}

export function setRepository(repo: DataRepository): void {
  defaultRepository = repo;
}
