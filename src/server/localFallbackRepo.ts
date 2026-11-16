import fs from 'node:fs';
import path from 'node:path';
import {
  DataRepository,
  QueryOptions,
  RedeemInviteParams,
  RedeemInviteResult,
  RepoWriteOp,
  RepositoryError,
  TransactionContext,
  WhereClause,
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

function getNestedValue(obj: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function matchesFilter(data: Record<string, unknown>, filter: WhereClause): boolean {
  const val = getNestedValue(data, filter.field);
  switch (filter.op) {
    case '==':
      return val === filter.value;
    case '!=':
      return val !== filter.value;
    case '<':
      return typeof val === typeof filter.value && (val as number | string) < (filter.value as number | string);
    case '<=':
      return typeof val === typeof filter.value && (val as number | string) <= (filter.value as number | string);
    case '>':
      return typeof val === typeof filter.value && (val as number | string) > (filter.value as number | string);
    case '>=':
      return typeof val === typeof filter.value && (val as number | string) >= (filter.value as number | string);
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(val);
    case 'array-contains':
      return Array.isArray(val) && val.includes(filter.value);
    default:
      return false;
  }
}

export class LocalFileRepository implements DataRepository {
  public readonly backendName = 'firestore' as const;
  private docs = new Map<string, Record<string, unknown>>();
  private lockQueue: Promise<void> = Promise.resolve();
  private readonly storeFilePath: string;

  constructor(storeDir = path.resolve(process.cwd(), '.data')) {
    this.storeFilePath = path.join(storeDir, 'ailea-local-store.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storeFilePath)) return;
      const raw = fs.readFileSync(this.storeFilePath, 'utf8');
      if (!raw.trim()) return;
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      if (parsed && typeof parsed === 'object') {
        this.docs = new Map(Object.entries(parsed));
      }
    } catch (err) {
      console.warn('Could not load local fallback store; starting fresh:', err);
    }
  }

  private saveToDisk(): void {
    const dir = path.dirname(this.storeFilePath);
    fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of this.docs.entries()) {
      obj[k] = v;
    }
    const tmpPath = `${this.storeFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmpPath, this.storeFilePath);
  }

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lockQueue.then(fn, fn);
    this.lockQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async ping(): Promise<void> {
    return;
  }

  async get<T = Record<string, unknown>>(docPath: string): Promise<T | null> {
    const clean = normalizeDocPath(docPath);
    const found = this.docs.get(clean);
    return found ? structuredClone(found) as T : null;
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
    const cleanCol = normalizeCollectionPath(collectionPath);
    const prefix = `${cleanCol}/`;
    const expectedDepth = cleanCol.split('/').length + 1;

    const results: Array<{ id: string; data: T }> = [];
    for (const [docPath, raw] of this.docs.entries()) {
      if (!docPath.startsWith(prefix)) continue;
      const parts = docPath.split('/');
      if (parts.length !== expectedDepth) continue;
      if (options.filters && !options.filters.every((f) => matchesFilter(raw, f))) continue;
      results.push({ id: parts[parts.length - 1], data: structuredClone(raw) as T });
    }

    if (options.orderBy && options.orderBy.length > 0) {
      results.sort((a, b) => {
        for (const o of options.orderBy!) {
          const av = getNestedValue(a.data as Record<string, unknown>, o.field);
          const bv = getNestedValue(b.data as Record<string, unknown>, o.field);
          if (av === bv) continue;
          const cmp = String(av ?? '').localeCompare(String(bv ?? ''));
          return o.direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }
    return results;
  }

  async queryCollectionGroup<T = Record<string, unknown>>(
    collectionId: string,
    options: QueryOptions = {}
  ): Promise<Array<{ id: string; path: string; data: T }>> {
    const results: Array<{ id: string; path: string; data: T }> = [];
    for (const [docPath, raw] of this.docs.entries()) {
      const parts = docPath.split('/');
      if (parts.length < 2 || parts[parts.length - 2] !== collectionId) continue;
      if (options.filters && !options.filters.every((f) => matchesFilter(raw, f))) continue;
      results.push({
        id: parts[parts.length - 1],
        path: docPath,
        data: structuredClone(raw) as T,
      });
    }

    if (options.orderBy && options.orderBy.length > 0) {
      results.sort((a, b) => {
        for (const o of options.orderBy!) {
          const av = getNestedValue(a.data as Record<string, unknown>, o.field);
          const bv = getNestedValue(b.data as Record<string, unknown>, o.field);
          if (av === bv) continue;
          const cmp = String(av ?? '').localeCompare(String(bv ?? ''));
          return o.direction === 'desc' ? -cmp : cmp;
        }
        return 0;
      });
    }

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }
    return results;
  }

  async create<T extends Record<string, unknown>>(docPath: string, data: T): Promise<void> {
    const clean = normalizeDocPath(docPath);
    await this.withLock(async () => {
      if (this.docs.has(clean)) {
        throw new RepositoryError('ALREADY_EXISTS', 'La ressource existe déjà.');
      }
      this.docs.set(clean, structuredClone(data));
      this.saveToDisk();
    });
  }

  async set<T extends Record<string, unknown>>(docPath: string, data: T): Promise<void> {
    const clean = normalizeDocPath(docPath);
    await this.withLock(async () => {
      this.docs.set(clean, structuredClone(data));
      this.saveToDisk();
    });
  }

  async update(docPath: string, patch: Record<string, unknown>): Promise<void> {
    const clean = normalizeDocPath(docPath);
    await this.withLock(async () => {
      const existing = this.docs.get(clean);
      if (!existing) {
        throw new RepositoryError('NOT_FOUND', 'Ressource introuvable.');
      }
      this.docs.set(clean, { ...existing, ...structuredClone(patch) });
      this.saveToDisk();
    });
  }

  async delete(docPath: string): Promise<void> {
    const clean = normalizeDocPath(docPath);
    await this.withLock(async () => {
      this.docs.delete(clean);
      this.saveToDisk();
    });
  }

  async commitBatch(ops: RepoWriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    await this.withLock(async () => {
      const working = new Map(this.docs);
      for (const op of ops) {
        const clean = normalizeDocPath(op.path);
        if (op.type === 'delete') {
          working.delete(clean);
        } else if (op.type === 'update') {
          const existing = working.get(clean);
          if (!existing) throw new RepositoryError('NOT_FOUND', 'Ressource introuvable.');
          working.set(clean, { ...existing, ...structuredClone(op.data || {}) });
        } else if (op.type === 'create') {
          if (working.has(clean)) throw new RepositoryError('ALREADY_EXISTS', 'La ressource existe déjà.');
          working.set(clean, structuredClone(op.data || {}));
        } else {
          working.set(clean, structuredClone(op.data || {}));
        }
      }
      this.docs = working;
      this.saveToDisk();
    });
  }

  async runTransaction<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R> {
    return this.withLock(async () => {
      const working = new Map<string, Record<string, unknown>>();
      for (const [k, v] of this.docs.entries()) {
        working.set(k, structuredClone(v));
      }
      const ops: RepoWriteOp[] = [];
      const ctx: TransactionContext = {
        get: async <T = Record<string, unknown>>(docPath: string): Promise<T | null> => {
          const clean = normalizeDocPath(docPath);
          const found = working.get(clean);
          return found ? (structuredClone(found) as T) : null;
        },
        create: (docPath: string, data: Record<string, unknown>) => {
          ops.push({ type: 'create', path: docPath, data });
        },
        set: (docPath: string, data: Record<string, unknown>) => {
          ops.push({ type: 'set', path: docPath, data });
        },
        update: (docPath: string, patch: Record<string, unknown>) => {
          ops.push({ type: 'update', path: docPath, data: patch });
        },
        delete: (docPath: string) => {
          ops.push({ type: 'delete', path: docPath });
        },
      };

      const result = await fn(ctx);

      for (const op of ops) {
        const clean = normalizeDocPath(op.path);
        if (op.type === 'delete') {
          working.delete(clean);
        } else if (op.type === 'update') {
          const existing = working.get(clean);
          if (!existing) throw new RepositoryError('NOT_FOUND', 'Ressource introuvable.');
          working.set(clean, { ...existing, ...structuredClone(op.data || {}) });
        } else if (op.type === 'create') {
          if (working.has(clean)) throw new RepositoryError('ALREADY_EXISTS', 'La ressource existe déjà.');
          working.set(clean, structuredClone(op.data || {}));
        } else {
          working.set(clean, structuredClone(op.data || {}));
        }
      }

      this.docs = working;
      this.saveToDisk();
      return result;
    });
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
    const { createHash } = await import('node:crypto');
    const emailHash = createHash('sha256').update(cleanEmail).digest('hex').slice(0, 32);
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

      if (!workspace || !invite) {
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
