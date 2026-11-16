import type { Workspace, WorkspaceInvite, WorkspaceMember } from '../shared/types.ts';

export type RepositoryErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'INVALID_ARGUMENT'
  | 'INTERNAL';

const HTTP_STATUS_BY_CODE: Record<RepositoryErrorCode, number> = {
  NOT_FOUND: 404,
  PERMISSION_DENIED: 403,
  ALREADY_EXISTS: 409,
  CONFLICT: 409,
  UNAVAILABLE: 503,
  INVALID_ARGUMENT: 400,
  INTERNAL: 500,
};

export class RepositoryError extends Error {
  public readonly code: RepositoryErrorCode;
  public readonly httpStatus: number;
  public readonly causeDetail?: unknown;

  constructor(code: RepositoryErrorCode, message: string, causeDetail?: unknown) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.causeDetail = causeDetail;
  }
}

export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';

export interface WhereClause {
  field: string;
  op: WhereOp;
  value: unknown;
}

export interface OrderByClause {
  field: string;
  direction?: 'asc' | 'desc';
}

export interface QueryOptions {
  filters?: WhereClause[];
  orderBy?: OrderByClause[];
  limit?: number;
}

export interface RepoWriteOp {
  type: 'create' | 'set' | 'update' | 'delete';
  path: string;
  data?: Record<string, unknown>;
}

export interface TransactionContext {
  get<T = Record<string, unknown>>(docPath: string): Promise<T | null>;
  create(docPath: string, data: Record<string, unknown>): void;
  set(docPath: string, data: Record<string, unknown>): void;
  update(docPath: string, patch: Record<string, unknown>): void;
  delete(docPath: string): void;
}

export interface RedeemInviteParams {
  workspaceId: string;
  tokenHash: string;
  uid: string;
  email: string;
  displayName: string;
  nowIso: string;
}

export interface RedeemInviteResult {
  invite: WorkspaceInvite;
  member: WorkspaceMember;
  workspace: Workspace;
}

export interface DataRepository {
  readonly backendName: 'firestore';

  ping(): Promise<void>;

  get<T = Record<string, unknown>>(docPath: string): Promise<T | null>;

  getWorkspaceScoped<T extends { workspaceId: string }>(
    collection: string,
    docId: string,
    workspaceId: string
  ): Promise<T | null>;

  query<T = Record<string, unknown>>(
    collectionPath: string,
    options?: QueryOptions
  ): Promise<Array<{ id: string; data: T }>>;

  queryCollectionGroup<T = Record<string, unknown>>(
    collectionId: string,
    options?: QueryOptions
  ): Promise<Array<{ id: string; path: string; data: T }>>;

  create<T extends Record<string, unknown>>(docPath: string, data: T): Promise<void>;

  set<T extends Record<string, unknown>>(docPath: string, data: T): Promise<void>;

  update(docPath: string, patch: Record<string, unknown>): Promise<void>;

  delete(docPath: string): Promise<void>;

  commitBatch(ops: RepoWriteOp[]): Promise<void>;

  runTransaction<R>(fn: (tx: TransactionContext) => Promise<R>): Promise<R>;

  createWorkspaceWithOwner(params: {
    workspace: Workspace;
    ownerMember: WorkspaceMember;
    seedOps?: RepoWriteOp[];
  }): Promise<void>;

  redeemInviteAtomic(params: RedeemInviteParams): Promise<RedeemInviteResult>;
}
