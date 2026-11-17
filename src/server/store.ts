import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { isEmulatorModeRequested, LOCAL_EMULATOR_PROJECT_ID } from './emulatorGuard.ts';
import { FIREBASE_CONFIG, getAdminStorage } from './firebaseAdmin.ts';
import { getRepository } from './firestoreRepo.ts';
import { LocalFileRepository } from './localFallbackRepo.ts';
import { RepoWriteOp, RepositoryError } from './repository.ts';
import { validateImageBuffer } from './security.ts';
import {
  computeWordCountAndReadingTime,
  extractExcerpt,
  generateSlug,
  parseMarkdownWithFrontmatter,
  sanitizeAndRenderMarkdown,
  serializeMarkdownWithFrontmatter,
  validatePostForPublication,
} from '../shared/markdown.ts';
import { isSafeAssetOrHttpUrl, isSafeHttpUrl } from '../shared/seo.ts';
import {
  AnalyticsSummary,
  AuditLog,
  Category,
  FullPostBundle,
  Locale,
  LocalizedText,
  MediaAsset,
  Post,
  PostReaction,
  PostTranslation,
  PostVersion,
  PostView,
  PublishedPostData,
  PublishedPostSnapshot,
  PublishedSlugRoute,
  PublishedTranslationData,
  PublishingEvent,
  ReactionEvent,
  ReactionPreset,
  SEOSetting,
  SlugLock,
  SUPPORTED_LOCALES,
  Tag,
  TranslationStatus,
  UserProfile,
  UserRole,
  Workspace,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceMembershipSummary,
} from '../shared/types.ts';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const REACTION_IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DAILY_VISITOR_VIEW_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ANALYTICS_SHARD_COUNT = 5;
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,160}$/;
const MAX_BACKUP_RESTORE_OPS = 450;

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function hashInviteToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function hashInviteEmail(email: string): string {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 32);
}

export function toPublicWorkspaceInvite(invite: WorkspaceInvite): WorkspaceInvite {
  const { tokenHash: _omitHash, ...safeInvite } = invite;
  return safeInvite;
}

export function slugLockDocId(locale: Locale, slug: string): string {
  return `${locale}_${slug}`;
}

export function publishedSlugRouteDocId(locale: Locale, slug: string): string {
  return `${locale}_${slug}`;
}

function sanitizePostForPublishedSnapshot(post: Post): PublishedPostData {
  const { authorId: _omitAuthorId, ...publicPost } = post;
  return publicPost;
}

function sanitizeTranslationForPublishedSnapshot(tr: PostTranslation): PublishedTranslationData {
  const {
    approvedBy: _omitApprovedBy,
    approvedAt: _omitApprovedAt,
    linguisticNotes: _omitLinguisticNotes,
    ...publicTr
  } = tr;
  return publicTr;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SAFE_MEDIA_FILENAME_REGEX = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,119}\.(png|jpg|jpeg|webp|gif)$/i;
const IMAGE_MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function hasUnsafePathToken(value: string): boolean {
  return (
    value.includes('..') ||
    value.includes('%') ||
    value.includes('\\') ||
    value.includes('/') ||
    /[\x00-\x1f\x7f]/.test(value)
  );
}

export function sanitizeMediaFilename(
  rawFilename: string,
  mimeType?: string,
  fallbackStem = 'media'
): string {
  if (!rawFilename || typeof rawFilename !== 'string' || rawFilename.length > 180) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Nom de fichier média invalide.');
  }
  const trimmed = rawFilename.trim();
  if (!trimmed || hasUnsafePathToken(trimmed)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Nom de fichier média non autorisé.');
  }
  const extFromMime = mimeType ? IMAGE_MIME_TO_EXT[mimeType] : undefined;
  if (mimeType && !extFromMime) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Type MIME média non autorisé.');
  }
  const extMatch = trimmed.match(/\.([a-zA-Z0-9]+)$/);
  const existingExt = extMatch ? extMatch[1].toLowerCase() : '';
  const stemRaw = extMatch ? trimmed.slice(0, -extMatch[0].length) : trimmed;
  const safeStem =
    stemRaw
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
      .slice(0, 80) || fallbackStem.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'media';
  const finalExt =
    extFromMime ||
    (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(existingExt) ? existingExt : 'png');
  const candidate = `${safeStem}.${finalExt}`;
  if (!SAFE_MEDIA_FILENAME_REGEX.test(candidate) || candidate.includes('..')) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Nom de fichier média invalide.');
  }
  return candidate;
}

export function buildCanonicalWorkspaceMediaStoragePath(
  workspaceId: string,
  assetId: string,
  safeFilename: string
): string {
  if (!SAFE_ID_REGEX.test(workspaceId) || !SAFE_ID_REGEX.test(assetId)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant d’espace ou de média invalide.');
  }
  if (!SAFE_MEDIA_FILENAME_REGEX.test(safeFilename) || hasUnsafePathToken(safeFilename)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Nom de fichier média invalide.');
  }
  return assertValidWorkspaceMediaStoragePath(
    `workspaces/${workspaceId}/media/${assetId}/${safeFilename}`,
    workspaceId,
    assetId,
    { allowLegacy: false }
  );
}

export function assertValidWorkspaceMediaStoragePath(
  storagePath: string,
  expectedWorkspaceId: string,
  expectedAssetId?: string,
  options?: { allowLegacy?: boolean }
): string {
  if (!expectedWorkspaceId || !SAFE_ID_REGEX.test(expectedWorkspaceId)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant d’espace de travail invalide.');
  }
  if (expectedAssetId !== undefined && (!expectedAssetId || !SAFE_ID_REGEX.test(expectedAssetId))) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant média invalide.');
  }
  if (!storagePath || typeof storagePath !== 'string' || storagePath.length > 512) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Chemin de stockage média manquant ou invalide.');
  }
  if (storagePath !== storagePath.trim() || /[\x00-\x1f\x7f]/.test(storagePath)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Chemin de stockage média invalide.');
  }
  if (
    storagePath.includes('..') ||
    storagePath.includes('%') ||
    storagePath.includes('\\') ||
    storagePath.includes('://') ||
    storagePath.includes(':') ||
    storagePath.startsWith('/') ||
    storagePath.endsWith('/') ||
    storagePath.includes('//')
  ) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Chemin de stockage média invalide.');
  }

  const segments = storagePath.split('/');
  if (segments.length === 5) {
    const [rootSeg, wsSeg, mediaSeg, assetSeg, fileSeg] = segments;
    if (rootSeg !== 'workspaces' || mediaSeg !== 'media') {
      throw new RepositoryError('INVALID_ARGUMENT', 'Convention de chemin de stockage média invalide.');
    }
    if (!SAFE_ID_REGEX.test(wsSeg) || !SAFE_ID_REGEX.test(assetSeg)) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Segment identifiant invalide dans le chemin média.');
    }
    if (wsSeg !== expectedWorkspaceId || (expectedAssetId !== undefined && assetSeg !== expectedAssetId)) {
      throw new RepositoryError(
        'PERMISSION_DENIED',
        'Chemin de stockage média non autorisé pour cet espace de travail.'
      );
    }
    if (!SAFE_MEDIA_FILENAME_REGEX.test(fileSeg) || fileSeg.includes('..')) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Nom de fichier invalide dans le chemin de stockage média.');
    }
    return storagePath;
  }

  if (options?.allowLegacy !== false && segments.length === 4) {
    const [rootSeg, wsSeg, mediaSeg, legacyFileSeg] = segments;
    if (rootSeg !== 'workspaces' || mediaSeg !== 'media') {
      throw new RepositoryError('INVALID_ARGUMENT', 'Convention de chemin de stockage média invalide.');
    }
    const legacyMatch = legacyFileSeg.match(/^([a-zA-Z0-9_-]{1,160})\.(png|jpg|jpeg|webp|gif)$/i);
    if (!legacyMatch) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Nom de fichier média hérité invalide.');
    }
    const [, legacyAssetSeg] = legacyMatch;
    if (!SAFE_ID_REGEX.test(wsSeg) || !SAFE_ID_REGEX.test(legacyAssetSeg)) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Segment identifiant invalide dans le chemin média.');
    }
    if (
      wsSeg !== expectedWorkspaceId ||
      (expectedAssetId !== undefined && legacyAssetSeg !== expectedAssetId)
    ) {
      throw new RepositoryError(
        'PERMISSION_DENIED',
        'Chemin de stockage média non autorisé pour cet espace de travail.'
      );
    }
    return storagePath;
  }

  throw new RepositoryError('INVALID_ARGUMENT', 'Convention de chemin de stockage média non conforme.');
}

function extractInternalMediaId(url: string): string | null {
  const match = url.trim().match(/^\/api\/media\/([^/?#]+)(?:[?#].*)?$/);
  return match ? match[1] : null;
}

function extractAllInternalMediaIdsFromMarkdown(markdown: string): string[] {
  const ids = new Set<string>();
  const regex = /\/api\/media\/([a-zA-Z0-9_-]{1,160})(?=$|[^a-zA-Z0-9_-])/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(markdown)) !== null) {
    if (SAFE_ID_REGEX.test(m[1])) {
      ids.add(m[1]);
    }
  }
  return Array.from(ids);
}

async function assertWorkspaceSafeMediaUrl(url: string, workspaceId: string): Promise<void> {
  if (!url) return;
  if (!isSafeAssetOrHttpUrl(url)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'URL média invalide ou non sécurisée.');
  }
  const mediaId = extractInternalMediaId(url);
  if (!mediaId) return;
  if (!SAFE_ID_REGEX.test(mediaId)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant média référencé invalide.');
  }
  const asset = await getRepository().get<MediaAsset>(`mediaAssets/${mediaId}`);
  if (!asset || asset.workspaceId !== workspaceId) {
    throw new RepositoryError(
      'PERMISSION_DENIED',
      'Le média référencé est introuvable ou appartient à un autre espace de travail.'
    );
  }
}

export async function isMediaAssetPubliclyReferenced(asset: MediaAsset): Promise<boolean> {
  if (!asset || !asset.id || !asset.workspaceId || !asset.storagePath) return false;
  if ((asset as MediaAsset & { deletedAt?: string }).deletedAt) return false;
  const repo = getRepository();
  const snaps = await repo.query<PublishedPostSnapshot>('publishedPosts', {
    filters: [
      { field: 'workspaceId', op: '==', value: asset.workspaceId },
      { field: 'status', op: '==', value: 'published' },
    ],
  });
  const canonicalUrl = `/api/media/${asset.id}`;
  const exactInBodyRegex = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escapeRegExp(canonicalUrl)}(?:$|[^a-zA-Z0-9_-])`);
  const altInBodyRegex =
    asset.url && asset.url !== canonicalUrl
      ? new RegExp(`(?:^|[^a-zA-Z0-9_-])${escapeRegExp(asset.url)}(?:$|[^a-zA-Z0-9_-])`)
      : null;

  for (const row of snaps) {
    const snap = row.data;
    if (snap.status !== 'published' || snap.post?.status !== 'published') continue;
    const featured = snap.post.featuredImageUrl || '';
    if (
      featured === canonicalUrl ||
      featured.startsWith(`${canonicalUrl}?`) ||
      (asset.url && featured === asset.url)
    ) {
      return true;
    }
    for (const loc of SUPPORTED_LOCALES) {
      const seoRow = snap.seo?.[loc];
      const ogImg = seoRow?.ogImageUrl || '';
      if (
        ogImg === canonicalUrl ||
        ogImg.startsWith(`${canonicalUrl}?`) ||
        (asset.url && ogImg === asset.url)
      ) {
        return true;
      }
      const tr = snap.translations?.[loc];
      if (!tr) continue;
      if (exactInBodyRegex.test(tr.markdownContent || '') || exactInBodyRegex.test(tr.sanitizedHtml || '')) {
        return true;
      }
      if (altInBodyRegex && (altInBodyRegex.test(tr.markdownContent || '') || altInBodyRegex.test(tr.sanitizedHtml || ''))) {
        return true;
      }
    }
  }
  return false;
}

function pickAnalyticsShard(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % ANALYTICS_SHARD_COUNT;
}

function dailyAnalyticsShardPath(date: string, workspaceId: string, shardIndex: number): string {
  return `dailyAnalytics/${date}/shards/${workspaceId}_s${shardIndex}`;
}

async function validateTaxonomyForWorkspace(
  workspaceId: string,
  categoryId: string | null | undefined,
  tagIds: string[] | undefined
): Promise<void> {
  const repo = getRepository();
  if (categoryId) {
    if (!SAFE_ID_REGEX.test(categoryId)) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant de catégorie invalide.');
    }
    const cat = await repo.get<Category>(`categories/${categoryId}`);
    if (!cat || cat.workspaceId !== workspaceId) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Catégorie introuvable dans cet espace de travail.');
    }
  }
  if (tagIds && tagIds.length > 0) {
    for (const tagId of tagIds) {
      if (!SAFE_ID_REGEX.test(tagId)) {
        throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant d’étiquette invalide.');
      }
      const tag = await repo.get<Tag>(`tags/${tagId}`);
      if (!tag || tag.workspaceId !== workspaceId) {
        throw new RepositoryError('INVALID_ARGUMENT', 'Étiquette introuvable dans cet espace de travail.');
      }
    }
  }
}

export async function logAudit(params: {
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
}): Promise<void> {
  try {
    const repo = getRepository();
    const id = makeId('aud');
    const entry: AuditLog = {
      id,
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      details: params.details.slice(0, 1000),
      createdAt: nowIso(),
    };
    await repo.set(`auditLogs/${id}`, entry as unknown as Record<string, unknown>);
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

export async function ensureUserProfile(params: {
  uid: string;
  email: string;
  displayName?: string;
  defaultRole?: UserRole;
}): Promise<UserProfile> {
  const repo = getRepository();
  const cleanEmail = params.email.toLowerCase().trim();
  const now = nowIso();
  const userPath = `users/${params.uid}`;
  const existingUser = await repo.get<UserProfile>(userPath);

  if (!existingUser) {
    const user: UserProfile = {
      uid: params.uid,
      email: cleanEmail,
      displayName: params.displayName || cleanEmail.split('@')[0] || 'Éditeur',
      role: params.defaultRole || 'viewer',
      defaultLocale: 'fr',
      createdAt: now,
      updatedAt: now,
    };
    await repo.set(userPath, user as unknown as Record<string, unknown>);
    return user;
  }

  if (params.displayName && existingUser.displayName !== params.displayName) {
    const updated: UserProfile = {
      ...existingUser,
      displayName: params.displayName,
      updatedAt: now,
    };
    await repo.update(userPath, { displayName: params.displayName, updatedAt: now });
    return updated;
  }

  return existingUser;
}

export async function listUserWorkspaces(uid: string): Promise<WorkspaceMembershipSummary[]> {
  const repo = getRepository();
  const [ownedWsRows, membershipRows] = await Promise.all([
    repo.query<Workspace>('workspaces', {
      filters: [{ field: 'ownerId', op: '==', value: uid }],
    }),
    repo.queryCollectionGroup<WorkspaceMember>('members', {
      filters: [{ field: 'userId', op: '==', value: uid }],
    }),
  ]);

  const byWorkspaceId = new Map<string, WorkspaceMembershipSummary>();
  for (const ws of ownedWsRows) {
    byWorkspaceId.set(ws.data.id, { workspace: ws.data, role: 'owner' });
  }

  for (const m of membershipRows) {
    const wsId = m.data.workspaceId;
    if (!wsId || byWorkspaceId.has(wsId)) continue;
    const ws = await repo.get<Workspace>(`workspaces/${wsId}`);
    if (ws) {
      byWorkspaceId.set(wsId, {
        workspace: ws,
        role: ws.ownerId === uid ? 'owner' : m.data.role,
      });
    }
  }

  return Array.from(byWorkspaceId.values());
}

/**
 * Strictly verifies an authenticated user's membership in a workspace.
 * Rejects with RepositoryError('PERMISSION_DENIED') if the user does not belong to the requested workspace.
 */
export async function verifyWorkspaceMembership(params: {
  uid: string;
  email: string;
  displayName?: string;
  requestedWorkspaceId?: string;
}): Promise<{ workspace: Workspace; role: UserRole }> {
  const repo = getRepository();

  if (params.requestedWorkspaceId) {
    const [workspace, member] = await Promise.all([
      repo.get<Workspace>(`workspaces/${params.requestedWorkspaceId}`),
      repo.get<WorkspaceMember>(`workspaces/${params.requestedWorkspaceId}/members/${params.uid}`),
    ]);

    if (!workspace) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès refusé : espace de travail introuvable ou non autorisé.');
    }

    if (workspace.ownerId === params.uid) {
      return { workspace, role: 'owner' };
    }

    if (!member) {
      throw new RepositoryError(
        'PERMISSION_DENIED',
        'Accès refusé : vous n’êtes pas membre de cet espace de travail.'
      );
    }

    return { workspace, role: member.role };
  }

  const memberships = await listUserWorkspaces(params.uid);
  if (memberships.length === 0) {
    throw new RepositoryError(
      'PERMISSION_DENIED',
      'Aucun espace de travail associé. Veuillez initialiser votre espace ou accepter une invitation.'
    );
  }

  return memberships[0];
}

export async function upsertUserAndResolveWorkspace(params: {
  uid: string;
  email: string;
  displayName?: string;
  appBaseUrl: string;
  requestedWorkspaceId?: string;
  createPersonalWorkspace?: boolean;
}): Promise<{
  user: UserProfile;
  workspace: Workspace | null;
  role: UserRole;
  memberships: WorkspaceMembershipSummary[];
  needsOnboarding: boolean;
}> {
  const repo = getRepository();
  const user = await ensureUserProfile({
    uid: params.uid,
    email: params.email,
    displayName: params.displayName,
    defaultRole: 'viewer',
  });

  if (params.requestedWorkspaceId) {
    const verified = await verifyWorkspaceMembership({
      uid: params.uid,
      email: params.email,
      displayName: params.displayName,
      requestedWorkspaceId: params.requestedWorkspaceId,
    });
    const memberships = await listUserWorkspaces(params.uid);
    return { user, workspace: verified.workspace, role: verified.role, memberships, needsOnboarding: false };
  }

  const existingMemberships = await listUserWorkspaces(params.uid);
  if (existingMemberships.length > 0) {
    return {
      user,
      workspace: existingMemberships[0].workspace,
      role: existingMemberships[0].role,
      memberships: existingMemberships,
      needsOnboarding: false,
    };
  }

  if (params.createPersonalWorkspace === false) {
    return {
      user,
      workspace: null,
      role: 'viewer',
      memberships: [],
      needsOnboarding: true,
    };
  }

  // Provision personal workspace atomically when user explicitly initializes or has no workspaces
  const now = nowIso();
  const uidHash = crypto.createHash('sha256').update(params.uid).digest('hex').slice(0, 16);
  const workspaceId = `ws_${uidHash}`;
  const workspace: Workspace = {
    id: workspaceId,
    name: 'AILEA Éditions',
    slug: `ailea-editions-${uidHash.slice(0, 10)}`,
    ownerId: params.uid,
    brandName: 'AILEA Revue',
    defaultLocale: 'fr',
    baseUrl: params.appBaseUrl,
    createdAt: now,
    updatedAt: now,
  };

  const ownerMember: WorkspaceMember = {
    id: params.uid,
    workspaceId,
    userId: params.uid,
    email: params.email.toLowerCase().trim(),
    displayName: user.displayName,
    role: 'owner',
    createdAt: now,
  };

  const seedOps = buildInitialWorkspaceSeedOps(workspace, user);
  try {
    await repo.createWorkspaceWithOwner({ workspace, ownerMember, seedOps });
  } catch (err) {
    // Handle concurrent bootstrap idempotently (RED-015)
    if (err instanceof RepositoryError && err.code === 'ALREADY_EXISTS') {
      const retryMemberships = await listUserWorkspaces(params.uid);
      if (retryMemberships.length > 0) {
        return {
          user,
          workspace: retryMemberships[0].workspace,
          role: retryMemberships[0].role,
          memberships: retryMemberships,
          needsOnboarding: false,
        };
      }
    }
    throw err;
  }

  await repo.update(`users/${params.uid}`, { role: 'owner', updatedAt: now });
  user.role = 'owner';

  const memberships = await listUserWorkspaces(params.uid);
  return { user, workspace, role: 'owner', memberships, needsOnboarding: false };
}

export async function updateWorkspaceSettings(params: {
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  patch: {
    name?: string;
    slug?: string;
    brandName?: string;
    defaultLocale?: Locale;
    baseUrl?: string;
  };
}): Promise<Workspace> {
  const repo = getRepository();
  const now = nowIso();
  const normalizedSlug = params.patch.slug !== undefined ? generateSlug(params.patch.slug) : undefined;
  if (params.patch.slug !== undefined && !normalizedSlug) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Slug d’espace de travail invalide.');
  }

  const updated = await repo.runTransaction(async (tx) => {
    const wsPath = `workspaces/${params.workspaceId}`;
    const current = await tx.get<Workspace>(wsPath);
    if (!current) throw new RepositoryError('NOT_FOUND', 'Espace introuvable.');

    const targetSlug = normalizedSlug || current.slug;
    if (targetSlug !== current.slug) {
      const lockPath = `workspaceSlugLocks/${targetSlug}`;
      const existingLock = await tx.get<{ workspaceId: string }>(lockPath);
      if (existingLock && existingLock.workspaceId !== params.workspaceId) {
        throw new RepositoryError('CONFLICT', `Le slug d’espace "${targetSlug}" est déjà utilisé.`);
      }
      tx.delete(`workspaceSlugLocks/${current.slug}`);
      tx.create(lockPath, {
        id: targetSlug,
        workspaceId: params.workspaceId,
        slug: targetSlug,
        createdAt: now,
      });
    }

    const nextWs: Workspace = {
      ...current,
      name: params.patch.name ?? current.name,
      slug: targetSlug,
      brandName: params.patch.brandName ?? current.brandName,
      defaultLocale: params.patch.defaultLocale ?? current.defaultLocale,
      baseUrl: params.patch.baseUrl ?? current.baseUrl,
      updatedAt: now,
    };
    tx.set(wsPath, nextWs as unknown as Record<string, unknown>);
    return nextWs;
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'workspace.update',
    entityType: 'workspace',
    entityId: params.workspaceId,
    details: `Mise à jour des paramètres de l’espace (${updated.name})`,
  });

  return updated;
}

function buildInitialWorkspaceSeedOps(workspace: Workspace, owner: UserProfile): RepoWriteOp[] {
  const now = nowIso();
  const ops: RepoWriteOp[] = [];
  const shortWs = workspace.id.replace(/^ws_/, '').slice(0, 12);

  const presets: ReactionPreset[] = [
    {
      id: `${workspace.id}_curiosity`,
      workspaceId: workspace.id,
      semanticKey: 'curiosity',
      emoji: '👀',
      labels: { fr: 'Curiosité', en: 'Curiosity', fon: 'Nǔ-ba-kpɔ́n' },
      displayOrder: 0,
      createdAt: now,
    },
    {
      id: `${workspace.id}_affection`,
      workspaceId: workspace.id,
      semanticKey: 'affection',
      emoji: '❤️',
      labels: { fr: 'Affection', en: 'Affection', fon: 'Wǎn-yíyí' },
      displayOrder: 1,
      createdAt: now,
    },
    {
      id: `${workspace.id}_anticipation`,
      workspaceId: workspace.id,
      semanticKey: 'anticipation',
      emoji: '✨',
      labels: { fr: 'Impatience', en: 'Anticipation', fon: 'Nukɔ́n-kpɔ́n' },
      displayOrder: 2,
      createdAt: now,
    },
  ];
  for (const preset of presets) {
    ops.push({ type: 'set', path: `reactionPresets/${preset.id}`, data: preset as unknown as Record<string, unknown> });
  }

  const catCulture: Category = {
    id: `${workspace.id}_culture`,
    workspaceId: workspace.id,
    slug: 'culture-langues',
    names: { fr: 'Culture & Langues', en: 'Culture & Languages', fon: 'Hwɛndomɛ & Gbè' },
    createdAt: now,
  };
  const catTech: Category = {
    id: `${workspace.id}_edition`,
    workspaceId: workspace.id,
    slug: 'edition-numerique',
    names: { fr: 'Édition numérique', en: 'Digital Publishing', fon: 'Wěmá-wlǎn yɔ̌yɔ́' },
    createdAt: now,
  };
  ops.push({ type: 'set', path: `categories/${catCulture.id}`, data: catCulture as unknown as Record<string, unknown> });
  ops.push({ type: 'set', path: `categories/${catTech.id}`, data: catTech as unknown as Record<string, unknown> });

  const tagMultilingual: Tag = {
    id: `${workspace.id}_multilingue`,
    workspaceId: workspace.id,
    slug: 'multilingue',
    names: { fr: 'Multilingue', en: 'Multilingual', fon: 'Gbè-gègè' },
    createdAt: now,
  };
  ops.push({ type: 'set', path: `tags/${tagMultilingual.id}`, data: tagMultilingual as unknown as Record<string, unknown> });

  const mediaCourtyard: MediaAsset = {
    id: `${workspace.id}_courtyard`,
    workspaceId: workspace.id,
    filename: 'editorial_courtyard_cover.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 184320,
    url: '/assets/images/editorial_courtyard_cover_1794750583424.jpg',
    altText: {
      fr: 'Cour de bibliothèque culturelle baignée de lumière matinale',
      en: 'Sunlit cultural library courtyard with botanical palms',
      fon: 'Wěmá-xɔ kɔ́xɔ́ mɛ kpódó wezɛ́n zǎnzǎn tɔn kpán',
    },
    uploadedBy: owner.uid,
    createdAt: now,
  };
  const mediaNotebook: MediaAsset = {
    id: `${workspace.id}_notebook`,
    workspaceId: workspace.id,
    filename: 'editorial_notebook_cover.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 142500,
    url: '/assets/images/editorial_notebook_cover_1794750583741.jpg',
    altText: {
      fr: 'Carnet ouvert et stylo-plume sur pierre sauge',
      en: 'Open cream notebook and brass pen on sage stone',
      fon: 'Wěmá hunhún kpódó kwɛ̌nkpɛ̌n kpán ɖò awǐnnyà jí',
    },
    uploadedBy: owner.uid,
    createdAt: now,
  };
  ops.push({ type: 'set', path: `mediaAssets/${mediaCourtyard.id}`, data: mediaCourtyard as unknown as Record<string, unknown> });
  ops.push({ type: 'set', path: `mediaAssets/${mediaNotebook.id}`, data: mediaNotebook as unknown as Record<string, unknown> });

  const postId = `post_${workspace.id}_intro`;
  const post: Post = {
    id: postId,
    workspaceId: workspace.id,
    authorId: owner.uid,
    authorName: owner.displayName,
    primaryLocale: 'fr',
    status: 'published',
    categoryId: catCulture.id,
    tagIds: [tagMultilingual.id],
    featuredImageUrl: mediaCourtyard.url,
    reactionLimit: 1,
    allowReactionChange: true,
    reactionKeys: presets.map((p) => p.semanticKey),
    currentVersionNumber: 1,
    publishedVersionNumber: 1,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  ops.push({ type: 'set', path: `posts/${postId}`, data: post as unknown as Record<string, unknown> });

  const mdFr = `## Écrire pour trois publics sans perdre sa voix

Publier simultanément en **français**, en **anglais** et en **fɔngbè** exige bien plus qu’une simple traduction automatique. Chaque langue porte une cadence, des nuances tonales et une relation particulière au lecteur.

### Principes de notre atelier éditorial

- **Indépendance rédactionnelle** : chaque version linguistique dispose de son propre titre, slug permanent et contenu Markdown.
- **Respect typographique du fɔngbè** : prise en charge complète des caractères spéciaux (\`ɛ\`, \`ɔ\`, \`ɖ\`) et des marques tonales Unicode.
- **Réactions sémantiques** : au lieu d’icônes figées, chaque article associe une intention claire (\`curiosity\`, \`affection\`, \`anticipation\`) traduite dans chaque langue.

> « Une langue vit pleinement lorsqu’elle trouve sa place naturelle sur le web moderne, avec des URL propres et une lecture sereine sur mobile. »

| Dimension | Français | English | Fɔngbè |
| :--- | :--- | :--- | :--- |
| Statut par défaut | Langue source | Variante internationale | Révision humaine exigée |
| Balise \`hreflang\` | \`fr\` | \`en\` | Omise (code non standard évité) |
`;

  const mdEn = `## Writing for Three Audiences Without Losing Your Voice

Publishing simultaneously in **French**, **English**, and **Fongbe** requires far more than literal translation. Every language carries its own rhythm, tonal precision, and relationship with its readers.

### Principles of Our Editorial Studio

- **Independent authoring**: each language version keeps its own title, permanent slug, and curated Markdown body.
- **Full Fongbe Unicode fidelity**: complete support for extended Latin characters (\`ɛ\`, \`ɔ\`, \`ɖ\`) and tonal diacritics.
- **Semantic reactions**: rather than hardcoding meanings to emojis, each article defines semantic keys (\`curiosity\`, \`affection\`, \`anticipation\`) localized per language.

> "A language thrives online when it is given clean permanent URLs, thoughtful typography, and calm mobile reading."

| Dimension | French | English | Fongbe |
| :--- | :--- | :--- | :--- |
| Authoring role | Primary source | International edition | Human linguistic review required |
| \`hreflang\` tag | \`fr\` | \`en\` | Omitted (avoids unsupported codes) |
`;

  const mdFon = `## Wlǎn xó ɖò gbè atɔ̀n mɛ ma hɛn gbè tɔn bú ó

Wěmá ɖíɖè tɔ́n ɖò **Flanségbè**, **Glɛ̌sìgbè** kpódó **Fɔngbè** kpán mɛ byɔ́ ayǐɖótò gànjí. Gbè ɖokpó ɖokpó ɖó tɛnmɛ tɔn, gbè-ɖyɔ́ tɔn kpódó wǎn tɔn kpán.

### Nǔ tàjí azɔ̌tɛ́n mítɔn tɔn lɛ́

- **Wlǎnwá vòvò**: gbè ɖokpó ɖokpó ɖó xótà tɔn, alɔ-kán tɛgbɛ tɔn kpódó wěmá tɔn kpán.
- **Wěkwín Fɔngbè tɔn gànjí**: wěkwín \`ɛ\`, \`ɔ\`, \`ɖ\` kpódó gbè-ɖyɔ́ lɛ́ kpán nɔ́ xà tɛgbɛ ɖò alokan jí.
- **Xó-sín-nú sín tinmɛ**: xó-sín-nú lɛ́ (\`curiosity\`, \`affection\`, \`anticipation\`) ɖó nyǐkɔ yětɔn ɖò Fɔngbè mɛ.

> « Gbè ɖé nɔ́ nɔ̀ gbɛ̀ hwenu e è nɔ́ wlǎn ɛ gànjí bɔ mɛ lɛ́ nɔ́ xà ɖò fífá mɛ é. »
`;

  const translationsData: Array<{
    locale: Locale;
    title: string;
    slug: string;
    md: string;
    status: TranslationStatus;
    notes: string;
  }> = [
    {
      locale: 'fr',
      title: 'Écrire et publier en français, anglais et fɔngbè sur le web moderne',
      slug: `ecrire-publier-francais-anglais-fongbe-${shortWs}`,
      md: mdFr,
      status: 'approved',
      notes: 'Version source validée.',
    },
    {
      locale: 'en',
      title: 'Publishing Across French, English, and Fongbe on the Modern Web',
      slug: `publishing-french-english-fongbe-modern-web-${shortWs}`,
      md: mdEn,
      status: 'approved',
      notes: 'Editorial English adaptation.',
    },
    {
      locale: 'fon',
      title: 'Wěmá wlǎn kpódó xó ɖíɖè tɔ́n kpán ɖò Flanségbè, Glɛ̌sìgbè kpódó Fɔngbè mɛ',
      slug: `wema-wlan-xodide-flansegbe-glesigbe-fongbe-${shortWs}`,
      md: mdFon,
      status: 'approved',
      notes: 'Vérification orthographique et tonale effectuée (ɛ, ɔ, ɖ, tons hauts/bas).',
    },
  ];

  const translationsSnapshot: Record<Locale, PostTranslation | null> = { fr: null, en: null, fon: null };
  const seoSnapshot: Record<Locale, SEOSetting | null> = { fr: null, en: null, fon: null };

  for (const item of translationsData) {
    const metrics = computeWordCountAndReadingTime(item.md);
    const tr: PostTranslation = {
      id: `${postId}_${item.locale}`,
      postId,
      workspaceId: workspace.id,
      isPublished: true,
      locale: item.locale,
      title: item.title,
      slug: item.slug,
      excerpt: extractExcerpt(item.md),
      markdownContent: item.md,
      sanitizedHtml: sanitizeAndRenderMarkdown(item.md),
      frontmatterJson: {
        title: item.title,
        slug: item.slug,
        locale: item.locale,
        category: 'culture-langues',
      },
      translationStatus: item.status,
      linguisticNotes: item.notes,
      approvedBy: owner.uid,
      approvedAt: now,
      wordCount: metrics.wordCount,
      readingTimeMinutes: metrics.readingTimeMinutes,
      updatedAt: now,
    };
    translationsSnapshot[item.locale] = tr;
    ops.push({ type: 'set', path: `postTranslations/${tr.id}`, data: tr as unknown as Record<string, unknown> });

    const lockId = slugLockDocId(item.locale, item.slug);
    const lock: SlugLock = {
      id: lockId,
      workspaceId: workspace.id,
      postId,
      locale: item.locale,
      slug: item.slug,
      createdAt: now,
    };
    ops.push({ type: 'create', path: `slugLocks/${lock.id}`, data: lock as unknown as Record<string, unknown> });

    const routeId = publishedSlugRouteDocId(item.locale, item.slug);
    const route: PublishedSlugRoute = {
      id: routeId,
      workspaceId: workspace.id,
      postId,
      locale: item.locale,
      slug: item.slug,
      status: 'published',
      updatedAt: now,
    };
    ops.push({
      type: 'create',
      path: `publishedSlugRoutes/${route.id}`,
      data: route as unknown as Record<string, unknown>,
    });

    const seoRow: SEOSetting = {
      id: `${postId}_${item.locale}`,
      postId,
      workspaceId: workspace.id,
      isPublished: true,
      locale: item.locale,
      metaTitle: item.title.slice(0, 65),
      metaDescription: tr.excerpt,
      canonicalUrl: '',
      ogTitle: item.title.slice(0, 65),
      ogDescription: tr.excerpt,
      ogImageUrl: mediaCourtyard.url,
      twitterCardType: 'summary_large_image',
      schemaType: 'BlogPosting',
      noIndex: false,
      updatedAt: now,
    };
    seoSnapshot[item.locale] = seoRow;
    ops.push({ type: 'set', path: `seoSettings/${seoRow.id}`, data: seoRow as unknown as Record<string, unknown> });
  }

  const postReactions: PostReaction[] = presets.map((p) => ({
    id: `${postId}_${p.semanticKey}`,
    postId,
    workspaceId: workspace.id,
    isPublished: true,
    semanticKey: p.semanticKey,
    emoji: p.emoji,
    labels: p.labels,
    displayOrder: p.displayOrder,
    enabled: true,
    count: 0,
  }));
  for (const r of postReactions) {
    ops.push({ type: 'set', path: `postReactions/${r.id}`, data: r as unknown as Record<string, unknown> });
  }

  const publishedSnap: PublishedPostSnapshot = {
    id: postId,
    postId,
    workspaceId: workspace.id,
    status: 'published',
    versionNumber: 1,
    post: sanitizePostForPublishedSnapshot(post),
    translations: {
      fr: translationsSnapshot.fr ? sanitizeTranslationForPublishedSnapshot(translationsSnapshot.fr) : null,
      en: translationsSnapshot.en ? sanitizeTranslationForPublishedSnapshot(translationsSnapshot.en) : null,
      fon: translationsSnapshot.fon ? sanitizeTranslationForPublishedSnapshot(translationsSnapshot.fon) : null,
    },
    seo: seoSnapshot,
    reactions: postReactions,
    categorySnapshot: catCulture,
    tagsSnapshot: [tagMultilingual],
    publishedAt: now,
    updatedAt: now,
  };
  ops.push({
    type: 'set',
    path: `publishedPosts/${postId}`,
    data: publishedSnap as unknown as Record<string, unknown>,
  });

  const initialVersion: PostVersion = {
    id: `${postId}_v1`,
    postId,
    workspaceId: workspace.id,
    versionNumber: 1,
    snapshotType: 'published_snapshot',
    commitMessage: 'Publication initiale multilingue (FR / EN / FON)',
    postSnapshot: post,
    translationsSnapshot,
    reactionsSnapshot: postReactions,
    seoSnapshot,
    createdBy: owner.uid,
    createdAt: now,
  };
  ops.push({
    type: 'create',
    path: `postVersions/${initialVersion.id}`,
    data: initialVersion as unknown as Record<string, unknown>,
  });

  const pubEvent: PublishingEvent = {
    id: makeId('pub'),
    postId,
    workspaceId: workspace.id,
    versionNumber: 1,
    eventType: 'published',
    actorId: owner.uid,
    actorEmail: owner.email,
    summary: 'Publication initiale v1 (FR, EN, FON)',
    createdAt: now,
  };
  ops.push({
    type: 'set',
    path: `publishingEvents/${pubEvent.id}`,
    data: pubEvent as unknown as Record<string, unknown>,
  });

  return ops;
}

// ============================================================================
// INVITATIONS & RBAC TEAM MANAGEMENT
// ============================================================================

export async function createWorkspaceInvite(params: {
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  email: string;
  role: Exclude<UserRole, 'owner'>;
  ttlMs?: number;
}): Promise<{ invite: WorkspaceInvite; rawToken: string }> {
  const repo = getRepository();
  const cleanEmail = params.email.toLowerCase().trim();
  const emailHash = hashInviteEmail(cleanEmail);
  const nowMs = Date.now();
  const inviteId = makeId('inv');
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashInviteToken(rawToken);
  const createdAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + (params.ttlMs ?? INVITE_TTL_MS)).toISOString();

  // Fast pre-check for existing verified member before entering lock transaction
  const existingMembers = await repo.query<WorkspaceMember>(`workspaces/${params.workspaceId}/members`, {
    filters: [{ field: 'email', op: '==', value: cleanEmail }],
    limit: 1,
  });
  if (existingMembers.length > 0) {
    throw new RepositoryError('CONFLICT', 'Cet utilisateur est déjà membre de cet espace de travail.');
  }

  const invite: WorkspaceInvite = {
    id: inviteId,
    tokenHash,
    workspaceId: params.workspaceId,
    email: cleanEmail,
    role: params.role,
    status: 'pending',
    invitedBy: params.actorId,
    invitedByEmail: params.actorEmail,
    expiresAt,
    createdAt,
  };

  const lockPath = `workspaces/${params.workspaceId}/inviteLocks/${emailHash}`;
  const invitePath = `workspaces/${params.workspaceId}/invites/${tokenHash}`;

  await repo.runTransaction(async (tx) => {
    const existingLock = await tx.get<{ inviteId: string; tokenHash: string; status?: string; expiresAt?: string }>(
      lockPath
    );
    if (existingLock && existingLock.tokenHash) {
      const lockedInvite = await tx.get<WorkspaceInvite>(
        `workspaces/${params.workspaceId}/invites/${existingLock.tokenHash}`
      );
      if (lockedInvite && lockedInvite.status === 'pending' && Date.parse(lockedInvite.expiresAt) > nowMs) {
        throw new RepositoryError('CONFLICT', 'Une invitation en attente existe déjà pour cette adresse e-mail.');
      }
    }

    tx.create(invitePath, invite as unknown as Record<string, unknown>);
    tx.set(lockPath, {
      id: emailHash,
      inviteId,
      tokenHash,
      workspaceId: params.workspaceId,
      email: cleanEmail,
      status: 'pending',
      expiresAt,
      createdAt,
    });
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'member.invite_created',
    entityType: 'workspaceInvite',
    entityId: inviteId,
    details: `Invitation créée pour ${cleanEmail} (rôle: ${params.role}, expiration: ${expiresAt})`,
  });

  return { invite: toPublicWorkspaceInvite(invite), rawToken };
}

export async function listWorkspaceInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
  const repo = getRepository();
  const rows = await repo.query<WorkspaceInvite>(`workspaces/${workspaceId}/invites`);
  return rows.map((r) => toPublicWorkspaceInvite(r.data)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeWorkspaceInvite(params: {
  workspaceId: string;
  inviteId: string;
  actorId: string;
  actorEmail: string;
}): Promise<void> {
  const repo = getRepository();
  const now = nowIso();

  // Resolve by opaque invite.id (with fallback to direct tokenHash doc path for legacy invites)
  const matches = await repo.query<WorkspaceInvite>(`workspaces/${params.workspaceId}/invites`, {
    filters: [{ field: 'id', op: '==', value: params.inviteId }],
    limit: 1,
  });
  let targetDocId = matches[0]?.data.tokenHash || matches[0]?.id;
  if (!targetDocId && /^[a-f0-9]{64}$/.test(params.inviteId)) {
    targetDocId = params.inviteId;
  }
  if (!targetDocId) {
    throw new RepositoryError('NOT_FOUND', 'Invitation introuvable.');
  }

  const invitePath = `workspaces/${params.workspaceId}/invites/${targetDocId}`;
  const revoked = await repo.runTransaction(async (tx) => {
    const invite = await tx.get<WorkspaceInvite>(invitePath);
    if (!invite || invite.workspaceId !== params.workspaceId) {
      throw new RepositoryError('NOT_FOUND', 'Invitation introuvable.');
    }
    if (invite.status !== 'pending') {
      throw new RepositoryError('CONFLICT', 'Seule une invitation en attente peut être révoquée.');
    }
    const emailHash = hashInviteEmail(invite.email);
    const lockPath = `workspaces/${params.workspaceId}/inviteLocks/${emailHash}`;
    const existingLock = await tx.get<{ inviteId?: string }>(lockPath);

    tx.update(invitePath, { status: 'revoked', revokedAt: now });
    if (existingLock && (!existingLock.inviteId || existingLock.inviteId === invite.id)) {
      tx.delete(lockPath);
    }
    return { email: invite.email, id: invite.id };
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'member.invite_revoked',
    entityType: 'workspaceInvite',
    entityId: revoked.id,
    details: `Invitation révoquée pour ${revoked.email}`,
  });
}

export async function acceptWorkspaceInvite(params: {
  workspaceId: string;
  rawToken: string;
  uid: string;
  email: string;
  displayName?: string;
}): Promise<{ workspace: Workspace; member: WorkspaceMember; role: UserRole; invite: WorkspaceInvite }> {
  const cleanToken = params.rawToken.trim();
  if (!cleanToken || cleanToken.length < 16 || cleanToken.length > 256) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Jeton d’invitation invalide.');
  }

  const repo = getRepository();
  const tokenHash = hashInviteToken(cleanToken);
  const now = nowIso();

  // Redeem invite BEFORE creating/updating user profile to avoid orphaned user docs on failed attempts (RED-023)
  const result = await repo.redeemInviteAtomic({
    workspaceId: params.workspaceId,
    tokenHash,
    uid: params.uid,
    email: params.email,
    displayName: params.displayName || params.email.split('@')[0] || 'Collaborateur',
    nowIso: now,
  });

  await ensureUserProfile({
    uid: params.uid,
    email: params.email,
    displayName: params.displayName,
    defaultRole: 'viewer',
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.uid,
    actorEmail: params.email,
    action: 'member.invite_accepted',
    entityType: 'workspaceMember',
    entityId: params.uid,
    details: `Invitation acceptée par ${params.email} avec le rôle ${result.member.role}`,
  });

  return {
    workspace: result.workspace,
    member: result.member,
    role: result.member.role,
    invite: toPublicWorkspaceInvite(result.invite),
  };
}

export async function updateWorkspaceMemberRole(params: {
  workspaceId: string;
  memberId: string;
  role: Exclude<UserRole, 'owner'>;
  actorId: string;
  actorEmail: string;
}): Promise<WorkspaceMember> {
  const repo = getRepository();
  const ws = await repo.get<Workspace>(`workspaces/${params.workspaceId}`);
  if (!ws) throw new RepositoryError('NOT_FOUND', 'Espace introuvable.');
  if (params.memberId === ws.ownerId) {
    throw new RepositoryError('PERMISSION_DENIED', 'Impossible de modifier le rôle du propriétaire principal.');
  }
  const memberPath = `workspaces/${params.workspaceId}/members/${params.memberId}`;
  const member = await repo.get<WorkspaceMember>(memberPath);
  if (!member || member.workspaceId !== params.workspaceId) {
    throw new RepositoryError('NOT_FOUND', 'Membre introuvable.');
  }

  const now = nowIso();
  const updated: WorkspaceMember = { ...member, role: params.role, updatedAt: now };
  await repo.update(memberPath, { role: params.role, updatedAt: now });
  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'member.role_updated',
    entityType: 'workspaceMember',
    entityId: params.memberId,
    details: `Rôle de ${member.email || params.memberId} modifié vers ${params.role}`,
  });
  return updated;
}

// ============================================================================
// POSTS, TRANSLATIONS, SLUG LOCKS & SNAPSHOTS
// ============================================================================

export async function getPostBundle(
  postId: string,
  workspaceId?: string,
  includeDraftOnlyCollections = true
): Promise<FullPostBundle | null> {
  const repo = getRepository();
  const post = await repo.get<Post>(`posts/${postId}`);
  if (!post) return null;
  if (workspaceId && post.workspaceId !== workspaceId) {
    throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
  }

  const isPublicMode = !includeDraftOnlyCollections;
  const trFilters = isPublicMode
    ? [
        { field: 'postId', op: '==' as const, value: postId },
        { field: 'isPublished', op: '==' as const, value: true },
      ]
    : [{ field: 'postId', op: '==' as const, value: postId }];

  const [trRows, reactRows, seoRows, verRows, evtRows] = await Promise.all([
    repo.query<PostTranslation>('postTranslations', { filters: trFilters }),
    repo.query<PostReaction>('postReactions', { filters: trFilters }),
    repo.query<SEOSetting>('seoSettings', { filters: trFilters }),
    includeDraftOnlyCollections
      ? repo.query<PostVersion>('postVersions', { filters: [{ field: 'postId', op: '==', value: postId }] })
      : Promise.resolve([]),
    includeDraftOnlyCollections
      ? repo.query<PublishingEvent>('publishingEvents', { filters: [{ field: 'postId', op: '==', value: postId }] })
      : Promise.resolve([]),
  ]);

  const translations: Record<Locale, PostTranslation | null> = { fr: null, en: null, fon: null };
  for (const row of trRows) {
    translations[row.data.locale] = row.data;
  }

  const seo: Record<Locale, SEOSetting | null> = { fr: null, en: null, fon: null };
  for (const row of seoRows) {
    seo[row.data.locale] = row.data;
  }

  const reactions = reactRows
    .map((r) => r.data)
    .filter((r) => (includeDraftOnlyCollections ? r.draftRemoved !== true : r.isPublished === true))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const versions = verRows.map((v) => v.data).sort((a, b) => b.versionNumber - a.versionNumber);
  const publishingEvents = evtRows.map((e) => e.data).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { post, translations, reactions, seo, versions, publishingEvents };
}

export async function listWorkspacePosts(workspaceId: string): Promise<FullPostBundle[]> {
  const repo = getRepository();
  const rows = await repo.query<Post>('posts', {
    filters: [{ field: 'workspaceId', op: '==', value: workspaceId }],
  });
  const sorted = rows.map((r) => r.data).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const bundles = await Promise.all(sorted.map((p) => getPostBundle(p.id, workspaceId, true)));
  return bundles.filter((b): b is FullPostBundle => b !== null);
}

export async function createPost(params: {
  workspaceId: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  title: string;
  primaryLocale?: Locale;
  markdownContent?: string;
  slug?: string;
  categoryId?: string | null;
  featuredImageUrl?: string;
  excerptOverride?: string;
  frontmatterOverride?: Record<string, unknown>;
  seoMetaTitleOverride?: string;
  seoMetaDescriptionOverride?: string;
}): Promise<FullPostBundle> {
  const repo = getRepository();
  const now = nowIso();
  const postId = makeId('post');
  const primaryLocale: Locale = params.primaryLocale || 'fr';

  if (params.featuredImageUrl) {
    await assertWorkspaceSafeMediaUrl(params.featuredImageUrl, params.workspaceId);
  }
  await validateTaxonomyForWorkspace(params.workspaceId, params.categoryId, undefined);

  const rawMarkdown = params.markdownContent ?? `# ${params.title}\n\nRédigez votre article en Markdown ici.`;
  const parsed = parseMarkdownWithFrontmatter(rawMarkdown);
  const markdown = parsed.body;
  const slug = generateSlug(params.slug || params.title) || postId;

  const presetRows = await repo.query<ReactionPreset>('reactionPresets', {
    filters: [{ field: 'workspaceId', op: '==', value: params.workspaceId }],
  });
  const presets = presetRows.map((r) => r.data).sort((a, b) => a.displayOrder - b.displayOrder);

  const post: Post = {
    id: postId,
    workspaceId: params.workspaceId,
    authorId: params.actorId,
    authorName: params.actorName,
    primaryLocale,
    status: 'draft',
    categoryId: params.categoryId || null,
    tagIds: [],
    featuredImageUrl: params.featuredImageUrl || '',
    reactionLimit: 1,
    allowReactionChange: true,
    reactionKeys: presets.map((p) => p.semanticKey),
    currentVersionNumber: 1,
    publishedVersionNumber: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await repo.runTransaction(async (tx) => {
    for (const loc of SUPPORTED_LOCALES) {
      const trSlug = loc === primaryLocale ? slug : `${slug}-${loc}`;
      const lockId = slugLockDocId(loc, trSlug);
      const existingLock = await tx.get<SlugLock>(`slugLocks/${lockId}`);
      if (existingLock && existingLock.postId !== postId) {
        throw new RepositoryError(
          'CONFLICT',
          `Le slug "${trSlug}" est déjà réservé (${loc.toUpperCase()}).`
        );
      }
    }

    tx.create(`posts/${postId}`, post as unknown as Record<string, unknown>);

    for (const loc of SUPPORTED_LOCALES) {
      const isPrimary = loc === primaryLocale;
      const trMd = isPrimary ? markdown : '';
      const trTitle = isPrimary ? params.title : '';
      const trSlug = isPrimary ? slug : `${slug}-${loc}`;
      const metrics = computeWordCountAndReadingTime(trMd);
      const primaryExcerpt =
        params.excerptOverride && params.excerptOverride.trim()
          ? params.excerptOverride.trim()
          : extractExcerpt(trMd);

      const lockId = slugLockDocId(loc, trSlug);
      const lock: SlugLock = {
        id: lockId,
        workspaceId: params.workspaceId,
        postId,
        locale: loc,
        slug: trSlug,
        createdAt: now,
      };
      tx.set(`slugLocks/${lockId}`, lock as unknown as Record<string, unknown>);

      const tr: PostTranslation = {
        id: `${postId}_${loc}`,
        postId,
        workspaceId: params.workspaceId,
        isPublished: false,
        locale: loc,
        title: trTitle,
        slug: trSlug,
        excerpt: isPrimary ? primaryExcerpt : '',
        markdownContent: trMd,
        sanitizedHtml: sanitizeAndRenderMarkdown(trMd),
        frontmatterJson: isPrimary
          ? params.frontmatterOverride || { title: trTitle, slug: trSlug, locale: loc }
          : {},
        translationStatus: isPrimary ? 'draft' : 'missing',
        linguisticNotes: '',
        approvedBy: null,
        approvedAt: null,
        wordCount: metrics.wordCount,
        readingTimeMinutes: metrics.readingTimeMinutes,
        updatedAt: now,
      };
      tx.set(`postTranslations/${tr.id}`, tr as unknown as Record<string, unknown>);

      const metaTitle =
        isPrimary && params.seoMetaTitleOverride
          ? params.seoMetaTitleOverride.slice(0, 120)
          : trTitle.slice(0, 65);
      const metaDescription =
        isPrimary && params.seoMetaDescriptionOverride
          ? params.seoMetaDescriptionOverride.slice(0, 320)
          : tr.excerpt;

      const seoRow: SEOSetting = {
        id: `${postId}_${loc}`,
        postId,
        workspaceId: params.workspaceId,
        isPublished: false,
        locale: loc,
        metaTitle,
        metaDescription,
        canonicalUrl: '',
        ogTitle: trTitle.slice(0, 65),
        ogDescription: tr.excerpt,
        ogImageUrl: post.featuredImageUrl,
        twitterCardType: post.featuredImageUrl ? 'summary_large_image' : 'summary',
        schemaType: 'BlogPosting',
        noIndex: false,
        updatedAt: now,
      };
      tx.set(`seoSettings/${seoRow.id}`, seoRow as unknown as Record<string, unknown>);
    }

    for (const p of presets) {
      const pr: PostReaction = {
        id: `${postId}_${p.semanticKey}`,
        postId,
        workspaceId: params.workspaceId,
        isPublished: false,
        semanticKey: p.semanticKey,
        emoji: p.emoji,
        labels: p.labels,
        displayOrder: p.displayOrder,
        enabled: true,
        count: 0,
      };
      tx.set(`postReactions/${pr.id}`, pr as unknown as Record<string, unknown>);
    }
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'post.create',
    entityType: 'post',
    entityId: postId,
    details: `Création de l’article "${params.title}" (${primaryLocale})`,
  });

  const bundle = await getPostBundle(postId, params.workspaceId, true);
  if (!bundle) throw new RepositoryError('INTERNAL', 'Erreur lors de la création de l’article.');
  return bundle;
}

export async function importMarkdownPost(params: {
  workspaceId: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  rawMarkdown: string;
  defaultLocale?: Locale;
}): Promise<{ bundle: FullPostBundle; frontmatterErrors: string[] }> {
  const parsed = parseMarkdownWithFrontmatter(params.rawMarkdown);
  const fm = parsed.frontmatter;
  const localeRaw =
    typeof fm.locale === 'string' && SUPPORTED_LOCALES.includes(fm.locale as Locale)
      ? (fm.locale as Locale)
      : params.defaultLocale || 'fr';
  const title =
    (typeof fm.title === 'string' && fm.title.trim()) ||
    parsed.body.split('\n').find((l) => l.startsWith('# '))?.replace(/^#\s+/, '').trim() ||
    'Article importé';
  const slug = typeof fm.slug === 'string' && fm.slug.trim() ? generateSlug(fm.slug) : generateSlug(title);
  const rawFeatured = typeof fm.featuredImage === 'string' ? fm.featuredImage.trim() : '';
  const featuredImageUrl = isSafeAssetOrHttpUrl(rawFeatured) ? rawFeatured : '';
  const excerptOverride =
    typeof fm.excerpt === 'string' && fm.excerpt.trim() ? fm.excerpt.trim().slice(0, 600) : undefined;
  const seoMetaTitleOverride =
    typeof fm.metaTitle === 'string' && fm.metaTitle.trim() ? fm.metaTitle.trim() : undefined;
  const seoMetaDescriptionOverride =
    typeof fm.metaDescription === 'string' && fm.metaDescription.trim() ? fm.metaDescription.trim() : undefined;

  const bundle = await createPost({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorName: params.actorName,
    actorEmail: params.actorEmail,
    title,
    primaryLocale: localeRaw,
    markdownContent: parsed.body,
    slug,
    featuredImageUrl,
    excerptOverride,
    frontmatterOverride: fm,
    seoMetaTitleOverride,
    seoMetaDescriptionOverride,
  });

  return { bundle, frontmatterErrors: parsed.errors };
}

export async function exportPostMarkdown(
  postId: string,
  workspaceId: string,
  locale: Locale
): Promise<string> {
  const bundle = await getPostBundle(postId, workspaceId, true);
  if (!bundle) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
  const tr = bundle.translations[locale];
  if (!tr) throw new RepositoryError('NOT_FOUND', 'Traduction introuvable.');
  const seo = bundle.seo[locale];

  const frontmatter: Record<string, unknown> = {
    title: tr.title,
    slug: tr.slug,
    locale,
    status: bundle.post.status,
    translationStatus: tr.translationStatus,
    excerpt: tr.excerpt,
    featuredImage: bundle.post.featuredImageUrl || undefined,
    metaTitle: seo?.metaTitle || undefined,
    metaDescription: seo?.metaDescription || undefined,
    reactions: bundle.reactions
      .filter((r) => r.enabled)
      .map((r) => ({ key: r.semanticKey, emoji: r.emoji, label: r.labels[locale] })),
  };

  return serializeMarkdownWithFrontmatter(frontmatter, tr.markdownContent);
}

export async function updatePostMetadata(params: {
  postId: string;
  workspaceId: string;
  patch: {
    primaryLocale?: Locale;
    categoryId?: string | null;
    tagIds?: string[];
    featuredImageUrl?: string;
    reactionLimit?: number;
    allowReactionChange?: boolean;
  };
}): Promise<Post> {
  const repo = getRepository();

  if (params.patch.featuredImageUrl !== undefined && params.patch.featuredImageUrl !== '') {
    await assertWorkspaceSafeMediaUrl(params.patch.featuredImageUrl, params.workspaceId);
  }
  await validateTaxonomyForWorkspace(params.workspaceId, params.patch.categoryId, params.patch.tagIds);

  return repo.runTransaction(async (tx) => {
    const current = await tx.get<Post>(`posts/${params.postId}`);
    if (!current || current.workspaceId !== params.workspaceId) {
      if (!current) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const updated: Post = {
      ...current,
      primaryLocale: params.patch.primaryLocale ?? current.primaryLocale,
      categoryId: params.patch.categoryId !== undefined ? params.patch.categoryId : current.categoryId,
      tagIds: params.patch.tagIds ?? current.tagIds,
      featuredImageUrl: params.patch.featuredImageUrl ?? current.featuredImageUrl,
      reactionLimit:
        typeof params.patch.reactionLimit === 'number'
          ? Math.max(1, Math.min(10, Math.floor(params.patch.reactionLimit)))
          : current.reactionLimit,
      allowReactionChange: params.patch.allowReactionChange ?? current.allowReactionChange,
      updatedAt: nowIso(),
    };

    tx.set(`posts/${params.postId}`, updated as unknown as Record<string, unknown>);
    return updated;
  });
}

export async function cleanupDeletedPostChildren(postId: string, workspaceId: string): Promise<number> {
  const repo = getRepository();
  const childCollections = [
    'postReactions',
    'postVersions',
    'publishingEvents',
    'postViews',
    'reactionEvents',
    'visitorReactionStates',
    'visitorDailyViews',
    'reactionIdempotency',
  ] as const;

  let deletedTotal = 0;
  for (const col of childCollections) {
    while (true) {
      const batchRows = await repo.query<{ id?: string; workspaceId?: string }>(col, {
        filters: [{ field: 'postId', op: '==', value: postId }],
        limit: 400,
      });
      if (batchRows.length === 0) break;
      const ops: RepoWriteOp[] = batchRows
        .filter((r) => !r.data.workspaceId || r.data.workspaceId === workspaceId)
        .map((r) => ({ type: 'delete', path: `${col}/${r.id}` }));
      if (ops.length === 0) break;
      await repo.commitBatch(ops);
      deletedTotal += ops.length;
      if (batchRows.length < 400) break;
    }
  }
  return deletedTotal;
}

export async function deleteWorkspacePost(params: {
  postId: string;
  workspaceId: string;
  actorId: string;
  actorEmail: string;
}): Promise<void> {
  const repo = getRepository();
  const bundle = await getPostBundle(params.postId, params.workspaceId, true);
  if (!bundle) {
    throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
  }

  const pubSnap = await repo.get<PublishedPostSnapshot>(`publishedPosts/${params.postId}`);

  // Atomically verify & delete root docs + translations + SEO + global slug locks/routes (RED-008)
  const slugCandidates = new Set<string>();
  for (const loc of SUPPORTED_LOCALES) {
    const draftSlug = bundle.translations[loc]?.slug;
    if (draftSlug) slugCandidates.add(`${loc}::${draftSlug}`);
    const pubSlug = pubSnap?.translations?.[loc]?.slug;
    if (pubSlug) slugCandidates.add(`${loc}::${pubSlug}`);
  }

  await repo.runTransaction(async (tx) => {
    const post = await tx.get<Post>(`posts/${params.postId}`);
    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const locksToDelete: string[] = [];
    const routesToDelete: string[] = [];
    for (const pair of slugCandidates) {
      const [loc, slug] = pair.split('::') as [Locale, string];
      const lockPath = `slugLocks/${slugLockDocId(loc, slug)}`;
      const routePath = `publishedSlugRoutes/${publishedSlugRouteDocId(loc, slug)}`;
      const [lockDoc, routeDoc] = await Promise.all([
        tx.get<SlugLock>(lockPath),
        tx.get<PublishedSlugRoute>(routePath),
      ]);
      if (lockDoc && lockDoc.postId === params.postId) locksToDelete.push(lockPath);
      if (routeDoc && routeDoc.postId === params.postId) routesToDelete.push(routePath);
    }

    tx.delete(`posts/${params.postId}`);
    tx.delete(`publishedPosts/${params.postId}`);
    for (const loc of SUPPORTED_LOCALES) {
      tx.delete(`postTranslations/${params.postId}_${loc}`);
      tx.delete(`seoSettings/${params.postId}_${loc}`);
    }
    for (const p of locksToDelete) tx.delete(p);
    for (const p of routesToDelete) tx.delete(p);
  });

  await cleanupDeletedPostChildren(params.postId, params.workspaceId);

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'post.delete',
    entityType: 'post',
    entityId: params.postId,
    details: 'Suppression de l’article, de ses versions et de ses traductions.',
  });
}

export async function savePostTranslation(params: {
  postId: string;
  workspaceId: string;
  locale: Locale;
  actorId: string;
  actorEmail: string;
  actorRole: UserRole;
  title: string;
  slug: string;
  excerpt?: string;
  markdownContent: string;
  translationStatus?: TranslationStatus;
  linguisticNotes?: string;
  createCheckpoint?: boolean;
  commitMessage?: string;
}): Promise<PostTranslation> {
  const repo = getRepository();
  const cleanSlug = generateSlug(params.slug || params.title);
  if (!cleanSlug) throw new RepositoryError('INVALID_ARGUMENT', 'Slug invalide.');

  const trPath = `postTranslations/${params.postId}_${params.locale}`;
  const now = nowIso();

  const updatedTr = await repo.runTransaction(async (tx) => {
    const [post, existing, pubSnap] = await Promise.all([
      tx.get<Post>(`posts/${params.postId}`),
      tx.get<PostTranslation>(trPath),
      tx.get<PublishedPostSnapshot>(`publishedPosts/${params.postId}`),
    ]);

    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const lockId = slugLockDocId(params.locale, cleanSlug);
    const existingLock = await tx.get<SlugLock>(`slugLocks/${lockId}`);
    if (existingLock && existingLock.postId !== params.postId) {
      throw new RepositoryError(
        'CONFLICT',
        `Le slug "${cleanSlug}" est déjà utilisé par un autre article en ${params.locale.toUpperCase()}.`
      );
    }

    let nextStatus: TranslationStatus = params.translationStatus || existing?.translationStatus || 'draft';
    if (nextStatus === 'missing' && (params.title.trim() || params.markdownContent.trim())) {
      nextStatus = 'draft';
    }

    // Strict RBAC + Fongbe linguistic gate (RED-007): editors CANNOT self-approve Fongbe
    if (nextStatus === 'approved') {
      if (params.locale === 'fon' && !['owner', 'reviewer'].includes(params.actorRole)) {
        throw new RepositoryError(
          'PERMISSION_DENIED',
          'Seul un relecteur humain (reviewer) ou propriétaire (owner) peut approuver la traduction Fɔngbè.'
        );
      }
      if (!['owner', 'editor', 'reviewer'].includes(params.actorRole)) {
        throw new RepositoryError('PERMISSION_DENIED', 'Permissions insuffisantes pour approuver une traduction.');
      }
    }

    const parsed = parseMarkdownWithFrontmatter(params.markdownContent);
    const cleanBody = parsed.body;

    if (
      params.locale === 'fon' &&
      existing &&
      (existing.markdownContent !== cleanBody || existing.title !== params.title.trim() || existing.slug !== cleanSlug) &&
      params.translationStatus !== 'approved'
    ) {
      nextStatus = params.translationStatus || 'in_review';
    }

    const sanitizedHtml = sanitizeAndRenderMarkdown(cleanBody);
    const metrics = computeWordCountAndReadingTime(cleanBody);
    const resolvedExcerpt =
      params.excerpt !== undefined && params.excerpt.trim()
        ? params.excerpt.trim()
        : extractExcerpt(cleanBody);

    // Preserve publishedPosts snapshot isolation: NEVER copy post.status === 'published' onto draft isPublished (RED-001)
    const tr: PostTranslation = {
      id: `${params.postId}_${params.locale}`,
      postId: params.postId,
      workspaceId: params.workspaceId,
      isPublished: existing?.isPublished ?? false,
      locale: params.locale,
      title: params.title.trim(),
      slug: cleanSlug,
      excerpt: resolvedExcerpt,
      markdownContent: cleanBody,
      sanitizedHtml,
      frontmatterJson:
        Object.keys(parsed.frontmatter).length > 0 ? parsed.frontmatter : existing?.frontmatterJson || {},
      translationStatus: nextStatus,
      linguisticNotes:
        params.linguisticNotes !== undefined ? params.linguisticNotes : existing?.linguisticNotes || '',
      approvedBy: nextStatus === 'approved' ? params.actorId : null,
      approvedAt: nextStatus === 'approved' ? now : null,
      wordCount: metrics.wordCount,
      readingTimeMinutes: metrics.readingTimeMinutes,
      updatedAt: now,
    };

    // Only delete old draft slugLock if it is NOT still actively held by the live published snapshot (RED-001/RED-008)
    if (existing?.slug && existing.slug !== cleanSlug) {
      const stillLivePublishedSlug =
        pubSnap?.status === 'published' && pubSnap.translations?.[params.locale]?.slug === existing.slug;
      if (!stillLivePublishedSlug) {
        tx.delete(`slugLocks/${slugLockDocId(params.locale, existing.slug)}`);
      }
    }

    const newLock: SlugLock = {
      id: lockId,
      workspaceId: params.workspaceId,
      postId: params.postId,
      locale: params.locale,
      slug: cleanSlug,
      createdAt: now,
    };
    tx.set(`slugLocks/${lockId}`, newLock as unknown as Record<string, unknown>);
    tx.set(trPath, tr as unknown as Record<string, unknown>);
    tx.update(`posts/${params.postId}`, { updatedAt: now });

    return tr;
  });

  if (params.createCheckpoint) {
    await createPostVersionSnapshot({
      postId: params.postId,
      workspaceId: params.workspaceId,
      snapshotType: 'draft_checkpoint',
      commitMessage: params.commitMessage || `Point de contrôle (${params.locale.toUpperCase()})`,
      actorId: params.actorId,
    });
  }

  return updatedTr;
}

export async function createPostVersionSnapshot(params: {
  postId: string;
  workspaceId: string;
  snapshotType: 'draft_checkpoint' | 'published_snapshot' | 'restored_snapshot';
  commitMessage: string;
  actorId: string;
}): Promise<PostVersion> {
  const repo = getRepository();
  const postPre = await repo.get<Post>(`posts/${params.postId}`);
  const fallbackKeys =
    postPre && Array.isArray(postPre.reactionKeys)
      ? postPre.reactionKeys
      : (
          await repo.query<PostReaction>('postReactions', {
            filters: [{ field: 'postId', op: '==', value: params.postId }],
          })
        ).map((r) => r.data.semanticKey);
  const now = nowIso();

  return repo.runTransaction(async (tx) => {
    const post = await tx.get<Post>(`posts/${params.postId}`);
    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const keysToRead = Array.from(new Set([...(post.reactionKeys || []), ...fallbackKeys]));
    const [trFr, trEn, trFon, seoFr, seoEn, seoFon, ...freshReactions] = await Promise.all([
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fr`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_en`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fon`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_fr`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_en`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_fon`),
      ...keysToRead.map((k) => tx.get<PostReaction>(`postReactions/${params.postId}_${k}`)),
    ]);

    const nextVersion = (post.currentVersionNumber || 0) + 1;
    const versionId = `${params.postId}_v${nextVersion}`;
    const translationsSnapshot: Record<Locale, PostTranslation | null> = { fr: trFr, en: trEn, fon: trFon };
    const seoSnapshot: Record<Locale, SEOSetting | null> = { fr: seoFr, en: seoEn, fon: seoFon };
    const reactionsSnapshot = freshReactions
      .filter((r): r is PostReaction => r !== null && r.draftRemoved !== true)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const version: PostVersion = {
      id: versionId,
      postId: params.postId,
      workspaceId: params.workspaceId,
      versionNumber: nextVersion,
      snapshotType: params.snapshotType,
      commitMessage: params.commitMessage,
      postSnapshot: post,
      translationsSnapshot,
      reactionsSnapshot,
      seoSnapshot,
      createdBy: params.actorId,
      createdAt: now,
    };

    tx.create(`postVersions/${versionId}`, version as unknown as Record<string, unknown>);
    tx.update(`posts/${params.postId}`, { currentVersionNumber: nextVersion, updatedAt: now });
    return version;
  });
}

function isLocaleSnapshotPublishable(
  locale: Locale,
  tr: PublishedTranslationData | PostTranslation | null | undefined
): boolean {
  if (!tr) return false;
  if (!tr.title.trim() || !tr.slug.trim() || !tr.markdownContent.trim()) return false;
  if (locale === 'fon' && tr.translationStatus !== 'approved') return false;
  return true;
}

export async function publishPost(params: {
  postId: string;
  workspaceId: string;
  actorId: string;
  actorEmail: string;
}): Promise<{ bundle: FullPostBundle; version: PostVersion }> {
  const repo = getRepository();
  const postPre = await repo.get<Post>(`posts/${params.postId}`);
  const fallbackKeys =
    postPre && Array.isArray(postPre.reactionKeys)
      ? postPre.reactionKeys
      : (
          await repo.query<PostReaction>('postReactions', {
            filters: [{ field: 'postId', op: '==', value: params.postId }],
          })
        ).map((r) => r.data.semanticKey);
  const now = nowIso();

  const { version } = await repo.runTransaction(async (tx) => {
    const [post, existingPub] = await Promise.all([
      tx.get<Post>(`posts/${params.postId}`),
      tx.get<PublishedPostSnapshot>(`publishedPosts/${params.postId}`),
    ]);
    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const keysToRead = Array.from(
      new Set([
        ...(post.reactionKeys || []),
        ...(existingPub?.reactions?.map((r) => r.semanticKey) || []),
        ...fallbackKeys,
      ])
    );

    const tagIds = Array.isArray(post.tagIds) ? post.tagIds : [];
    const [trFr, trEn, trFon, seoFr, seoEn, seoFon, catSnap, tagReads, freshReactions] = await Promise.all([
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fr`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_en`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fon`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_fr`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_en`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_fon`),
      post.categoryId ? tx.get<Category>(`categories/${post.categoryId}`) : Promise.resolve(null),
      Promise.all(tagIds.map((tid) => tx.get<Tag>(`tags/${tid}`))),
      Promise.all(keysToRead.map((k) => tx.get<PostReaction>(`postReactions/${params.postId}_${k}`))),
    ]);

    const tagSnaps = tagReads.filter(
      (t): t is Tag => t !== null && typeof t.slug === 'string' && t.workspaceId === params.workspaceId
    );

    const translations: Record<Locale, PostTranslation | null> = { fr: trFr, en: trEn, fon: trFon };
    const seo: Record<Locale, SEOSetting | null> = { fr: seoFr, en: seoEn, fon: seoFon };
    const allReactionDocs = freshReactions.filter((r): r is PostReaction => r !== null);
    const activeDraftReactions = allReactionDocs
      .filter((r) => r.draftRemoved !== true)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const removedDraftReactions = allReactionDocs.filter((r) => r.draftRemoved === true);

    const report = validatePostForPublication({ post, translations, reactions: activeDraftReactions, seo });
    if (!report.valid) {
      throw new RepositoryError(
        'INVALID_ARGUMENT',
        `Validation échouée : ${report.errors.map((e) => e.message).join(' | ')}`
      );
    }

    // Read global slugLocks & publishedSlugRoutes for all ready locales + replaced published slugs
    const lockChecks = await Promise.all(
      SUPPORTED_LOCALES.map(async (loc) => {
        const tr = translations[loc];
        if (!tr || !isLocaleSnapshotPublishable(loc, tr)) return { loc, tr: null, lock: null, route: null };
        const lockPath = `slugLocks/${slugLockDocId(loc, tr.slug)}`;
        const routePath = `publishedSlugRoutes/${publishedSlugRouteDocId(loc, tr.slug)}`;
        const [lock, route] = await Promise.all([
          tx.get<SlugLock>(lockPath),
          tx.get<PublishedSlugRoute>(routePath),
        ]);
        return { loc, tr, lock, route };
      })
    );

    const oldSlugCleanups: Array<{
      loc: Locale;
      oldSlug: string;
      oldLock: SlugLock | null;
      oldRoute: PublishedSlugRoute | null;
    }> = [];
    for (const loc of SUPPORTED_LOCALES) {
      const prevPubSlug = existingPub?.translations?.[loc]?.slug;
      const candidateTr = translations[loc];
      const newSlug = candidateTr && isLocaleSnapshotPublishable(loc, candidateTr) ? candidateTr.slug : null;
      if (prevPubSlug && prevPubSlug !== newSlug) {
        const [oldLock, oldRoute] = await Promise.all([
          tx.get<SlugLock>(`slugLocks/${slugLockDocId(loc, prevPubSlug)}`),
          tx.get<PublishedSlugRoute>(`publishedSlugRoutes/${publishedSlugRouteDocId(loc, prevPubSlug)}`),
        ]);
        oldSlugCleanups.push({ loc, oldSlug: prevPubSlug, oldLock, oldRoute });
      }
    }

    for (const check of lockChecks) {
      if (!check.tr) continue;
      if (check.lock && check.lock.postId !== params.postId) {
        throw new RepositoryError(
          'CONFLICT',
          `Le slug "${check.tr.slug}" (${check.loc.toUpperCase()}) est déjà verrouillé par un autre article.`
        );
      }
      if (check.route && check.route.postId !== params.postId && check.route.status === 'published') {
        throw new RepositoryError(
          'CONFLICT',
          `La route publique "/p/${check.loc}/${check.tr.slug}" appartient déjà à un autre article publié.`
        );
      }
    }

    // Build immutable sanitized snapshot & commit all writes atomically
    const nextVersion = (post.currentVersionNumber || 0) + 1;
    const publishedAt = post.publishedAt || now;
    const nextReactionKeys = activeDraftReactions.map((r) => r.semanticKey);
    const publishedPost: Post = {
      ...post,
      status: 'published',
      reactionKeys: nextReactionKeys,
      currentVersionNumber: nextVersion,
      publishedVersionNumber: nextVersion,
      publishedAt,
      updatedAt: now,
    };

    const fullVersionTranslations: Record<Locale, PostTranslation | null> = { fr: null, en: null, fon: null };
    const sanitizedSnapshotTranslations: Record<Locale, PublishedTranslationData | null> = {
      fr: null,
      en: null,
      fon: null,
    };
    const publishedSeo: Record<Locale, SEOSetting | null> = { fr: null, en: null, fon: null };
    const publishedReactions: PostReaction[] = activeDraftReactions.map((r) => ({
      ...r,
      draftRemoved: false,
      isPublished: r.enabled,
    }));

    for (const loc of SUPPORTED_LOCALES) {
      const tr = translations[loc];
      const s = seo[loc];
      if (tr && isLocaleSnapshotPublishable(loc, tr)) {
        const pubTr: PostTranslation = { ...tr, isPublished: true };
        fullVersionTranslations[loc] = pubTr;
        sanitizedSnapshotTranslations[loc] = sanitizeTranslationForPublishedSnapshot(pubTr);
        tx.update(`postTranslations/${tr.id}`, { isPublished: true });
        if (s) {
          const pubSeo: SEOSetting = { ...s, isPublished: true };
          publishedSeo[loc] = pubSeo;
          tx.update(`seoSettings/${s.id}`, { isPublished: true });
        }
      } else if (tr) {
        tx.update(`postTranslations/${tr.id}`, { isPublished: false });
        if (s) tx.update(`seoSettings/${s.id}`, { isPublished: false });
      }
    }

    for (const r of activeDraftReactions) {
      tx.update(`postReactions/${r.id}`, { isPublished: r.enabled, draftRemoved: false });
    }
    for (const dead of removedDraftReactions) {
      tx.delete(`postReactions/${dead.id}`);
    }

    for (const oldItem of oldSlugCleanups) {
      if (oldItem.oldRoute && oldItem.oldRoute.postId === params.postId) {
        tx.delete(`publishedSlugRoutes/${publishedSlugRouteDocId(oldItem.loc, oldItem.oldSlug)}`);
      }
      const currentDraftSlug = translations[oldItem.loc]?.slug;
      if (oldItem.oldLock && oldItem.oldLock.postId === params.postId && currentDraftSlug !== oldItem.oldSlug) {
        tx.delete(`slugLocks/${slugLockDocId(oldItem.loc, oldItem.oldSlug)}`);
      }
    }

    for (const check of lockChecks) {
      if (!check.tr) continue;
      const lock: SlugLock = {
        id: slugLockDocId(check.loc, check.tr.slug),
        workspaceId: params.workspaceId,
        postId: params.postId,
        locale: check.loc,
        slug: check.tr.slug,
        createdAt: check.lock?.createdAt || now,
      };
      tx.set(`slugLocks/${lock.id}`, lock as unknown as Record<string, unknown>);

      const route: PublishedSlugRoute = {
        id: publishedSlugRouteDocId(check.loc, check.tr.slug),
        workspaceId: params.workspaceId,
        postId: params.postId,
        locale: check.loc,
        slug: check.tr.slug,
        status: 'published',
        updatedAt: now,
      };
      tx.set(`publishedSlugRoutes/${route.id}`, route as unknown as Record<string, unknown>);
    }

    const versionObj: PostVersion = {
      id: `${params.postId}_v${nextVersion}`,
      postId: params.postId,
      workspaceId: params.workspaceId,
      versionNumber: nextVersion,
      snapshotType: 'published_snapshot',
      commitMessage: `Publication v${nextVersion}`,
      postSnapshot: publishedPost,
      translationsSnapshot: fullVersionTranslations,
      reactionsSnapshot: publishedReactions,
      seoSnapshot: publishedSeo,
      createdBy: params.actorId,
      createdAt: now,
    };
    tx.create(`postVersions/${versionObj.id}`, versionObj as unknown as Record<string, unknown>);

    const snap: PublishedPostSnapshot = {
      id: params.postId,
      postId: params.postId,
      workspaceId: params.workspaceId,
      status: 'published',
      versionNumber: nextVersion,
      post: sanitizePostForPublishedSnapshot(publishedPost),
      translations: sanitizedSnapshotTranslations,
      seo: publishedSeo,
      reactions: publishedReactions,
      categorySnapshot: catSnap && catSnap.workspaceId === params.workspaceId ? catSnap : null,
      tagsSnapshot: tagSnaps,
      publishedAt,
      updatedAt: now,
    };
    tx.set(`publishedPosts/${params.postId}`, snap as unknown as Record<string, unknown>);

    tx.update(`posts/${params.postId}`, {
      status: 'published',
      reactionKeys: nextReactionKeys,
      currentVersionNumber: nextVersion,
      publishedVersionNumber: nextVersion,
      publishedAt,
      updatedAt: now,
    });

    const pubEvent: PublishingEvent = {
      id: makeId('pub'),
      postId: params.postId,
      workspaceId: params.workspaceId,
      versionNumber: nextVersion,
      eventType: 'published',
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      summary: `Publication v${nextVersion}`,
      createdAt: now,
    };
    tx.create(`publishingEvents/${pubEvent.id}`, pubEvent as unknown as Record<string, unknown>);

    return { version: versionObj };
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'post.publish',
    entityType: 'post',
    entityId: params.postId,
    details: `Publication de la version ${version.versionNumber}`,
  });

  const updatedBundle = await getPostBundle(params.postId, params.workspaceId, true);
  if (!updatedBundle) throw new RepositoryError('INTERNAL', 'Erreur lors du rechargement de l’article.');
  return { bundle: updatedBundle, version };
}

export async function unpublishPost(params: {
  postId: string;
  workspaceId: string;
  actorId: string;
  actorEmail: string;
}): Promise<FullPostBundle> {
  const repo = getRepository();
  const postPre = await repo.get<Post>(`posts/${params.postId}`);
  const fallbackKeys =
    postPre && Array.isArray(postPre.reactionKeys)
      ? postPre.reactionKeys
      : (
          await repo.query<PostReaction>('postReactions', {
            filters: [{ field: 'postId', op: '==', value: params.postId }],
          })
        ).map((r) => r.data.semanticKey);
  const now = nowIso();

  await repo.runTransaction(async (tx) => {
    const [post, existingPub] = await Promise.all([
      tx.get<Post>(`posts/${params.postId}`),
      tx.get<PublishedPostSnapshot>(`publishedPosts/${params.postId}`),
    ]);
    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const keysToRead = Array.from(
      new Set([
        ...(post.reactionKeys || []),
        ...(existingPub?.reactions?.map((r) => r.semanticKey) || []),
        ...fallbackKeys,
      ])
    );

    const [trFr, trEn, trFon, seoFr, seoEn, seoFon, ...freshReactions] = await Promise.all([
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fr`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_en`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fon`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_fr`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_en`),
      tx.get<SEOSetting>(`seoSettings/${params.postId}_fon`),
      ...keysToRead.map((k) => tx.get<PostReaction>(`postReactions/${params.postId}_${k}`)),
    ]);

    const trMap: Record<Locale, PostTranslation | null> = { fr: trFr, en: trEn, fon: trFon };
    const seoMap: Record<Locale, SEOSetting | null> = { fr: seoFr, en: seoEn, fon: seoFon };
    const routeSlugs = new Set<string>();
    for (const loc of SUPPORTED_LOCALES) {
      if (trMap[loc]?.slug) routeSlugs.add(`${loc}::${trMap[loc]!.slug}`);
      if (existingPub?.translations?.[loc]?.slug) routeSlugs.add(`${loc}::${existingPub.translations[loc]!.slug}`);
    }

    const routesToUpdate: string[] = [];
    for (const pair of routeSlugs) {
      const [loc, slug] = pair.split('::') as [Locale, string];
      const routePath = `publishedSlugRoutes/${publishedSlugRouteDocId(loc, slug)}`;
      const route = await tx.get<PublishedSlugRoute>(routePath);
      if (route && route.postId === params.postId) {
        routesToUpdate.push(routePath);
      }
    }

    tx.update(`posts/${params.postId}`, { status: 'draft', updatedAt: now });
    for (const loc of SUPPORTED_LOCALES) {
      if (trMap[loc]) tx.update(`postTranslations/${params.postId}_${loc}`, { isPublished: false });
      if (seoMap[loc]) tx.update(`seoSettings/${params.postId}_${loc}`, { isPublished: false });
    }
    for (const r of freshReactions) {
      if (r) {
        if (r.draftRemoved) {
          tx.delete(`postReactions/${r.id}`);
        } else {
          tx.update(`postReactions/${r.id}`, { isPublished: false });
        }
      }
    }
    if (existingPub) {
      tx.update(`publishedPosts/${params.postId}`, { status: 'unpublished', updatedAt: now });
    }
    for (const routePath of routesToUpdate) {
      tx.update(routePath, { status: 'unpublished', updatedAt: now });
    }

    const pubEvent: PublishingEvent = {
      id: makeId('pub'),
      postId: params.postId,
      workspaceId: params.workspaceId,
      versionNumber: post.currentVersionNumber,
      eventType: 'unpublished',
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      summary: 'Dépublication (retour en brouillon)',
      createdAt: now,
    };
    tx.create(`publishingEvents/${pubEvent.id}`, pubEvent as unknown as Record<string, unknown>);
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'post.unpublish',
    entityType: 'post',
    entityId: params.postId,
    details: 'Article dépublié',
  });

  const updatedBundle = await getPostBundle(params.postId, params.workspaceId, true);
  if (!updatedBundle) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
  return updatedBundle;
}

export async function restorePostVersion(params: {
  postId: string;
  workspaceId: string;
  versionNumber: number;
  actorId: string;
  actorEmail: string;
}): Promise<FullPostBundle> {
  const repo = getRepository();
  const postPre = await repo.get<Post>(`posts/${params.postId}`);
  const fallbackKeys =
    postPre && Array.isArray(postPre.reactionKeys)
      ? postPre.reactionKeys
      : (
          await repo.query<PostReaction>('postReactions', {
            filters: [{ field: 'postId', op: '==', value: params.postId }],
          })
        ).map((r) => r.data.semanticKey);
  const now = nowIso();

  const nextVersionNumber = await repo.runTransaction(async (tx) => {
    const [version, post, pubSnap] = await Promise.all([
      tx.get<PostVersion>(`postVersions/${params.postId}_v${params.versionNumber}`),
      tx.get<Post>(`posts/${params.postId}`),
      tx.get<PublishedPostSnapshot>(`publishedPosts/${params.postId}`),
    ]);

    if (!version || version.workspaceId !== params.workspaceId) {
      throw new RepositoryError('NOT_FOUND', `Version v${params.versionNumber} introuvable.`);
    }
    if (!post || post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    }

    const keysToRead = Array.from(new Set([...(post.reactionKeys || []), ...fallbackKeys]));
    const [curFr, curEn, curFon, ...freshReactions] = await Promise.all([
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fr`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_en`),
      tx.get<PostTranslation>(`postTranslations/${params.postId}_fon`),
      ...keysToRead.map((k) => tx.get<PostReaction>(`postReactions/${params.postId}_${k}`)),
    ]);

    const currentTranslations: Record<Locale, PostTranslation | null> = { fr: curFr, en: curEn, fon: curFon };
    const targetLockReads = await Promise.all(
      SUPPORTED_LOCALES.map(async (loc) => {
        const snapTr = version.translationsSnapshot?.[loc];
        if (!snapTr?.slug) return { loc, snapTr: null, lock: null };
        const lock = await tx.get<SlugLock>(`slugLocks/${slugLockDocId(loc, snapTr.slug)}`);
        return { loc, snapTr, lock };
      })
    );

    for (const check of targetLockReads) {
      if (check.snapTr && check.lock && check.lock.postId !== params.postId) {
        throw new RepositoryError(
          'CONFLICT',
          `Impossible de restaurer : le slug "${check.snapTr.slug}" (${check.loc.toUpperCase()}) est désormais réservé par un autre article.`
        );
      }
    }

    const nextVer = (post.currentVersionNumber || 0) + 1;
    const restoredTranslations: Record<Locale, PostTranslation | null> = { fr: curFr, en: curEn, fon: curFon };
    const restoredSeo: Record<Locale, SEOSetting | null> = { fr: null, en: null, fon: null };

    for (const loc of SUPPORTED_LOCALES) {
      const snapTr = version.translationsSnapshot?.[loc];
      const curTr = currentTranslations[loc];
      if (snapTr) {
        if (curTr?.slug && curTr.slug !== snapTr.slug) {
          const stillLive = pubSnap?.status === 'published' && pubSnap.translations?.[loc]?.slug === curTr.slug;
          if (!stillLive) {
            tx.delete(`slugLocks/${slugLockDocId(loc, curTr.slug)}`);
          }
        }
        if (snapTr.slug) {
          const lock: SlugLock = {
            id: slugLockDocId(loc, snapTr.slug),
            workspaceId: params.workspaceId,
            postId: params.postId,
            locale: loc,
            slug: snapTr.slug,
            createdAt: now,
          };
          tx.set(`slugLocks/${lock.id}`, lock as unknown as Record<string, unknown>);
        }
        const restoredTr: PostTranslation = {
          ...snapTr,
          isPublished: curTr?.isPublished ?? false,
          updatedAt: now,
        };
        restoredTranslations[loc] = restoredTr;
        tx.set(`postTranslations/${params.postId}_${loc}`, restoredTr as unknown as Record<string, unknown>);
      }

      const snapSeo = version.seoSnapshot?.[loc];
      if (snapSeo) {
        const restoredSeoRow: SEOSetting = {
          ...snapSeo,
          isPublished: false,
          updatedAt: now,
        };
        restoredSeo[loc] = restoredSeoRow;
        tx.set(`seoSettings/${params.postId}_${loc}`, restoredSeoRow as unknown as Record<string, unknown>);
      }
    }

    const reactionsSnapshot = freshReactions
      .filter((r): r is PostReaction => r !== null && r.draftRemoved !== true)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const updatedPost: Post = {
      ...post,
      currentVersionNumber: nextVer,
      updatedAt: now,
    };
    tx.update(`posts/${params.postId}`, { currentVersionNumber: nextVer, updatedAt: now });

    const newVersionDoc: PostVersion = {
      id: `${params.postId}_v${nextVer}`,
      postId: params.postId,
      workspaceId: params.workspaceId,
      versionNumber: nextVer,
      snapshotType: 'restored_snapshot',
      commitMessage: `Restauration depuis v${params.versionNumber}`,
      postSnapshot: updatedPost,
      translationsSnapshot: restoredTranslations,
      reactionsSnapshot,
      seoSnapshot: restoredSeo,
      createdBy: params.actorId,
      createdAt: now,
    };
    tx.create(`postVersions/${newVersionDoc.id}`, newVersionDoc as unknown as Record<string, unknown>);

    const pubEvent: PublishingEvent = {
      id: makeId('pub'),
      postId: params.postId,
      workspaceId: params.workspaceId,
      versionNumber: nextVer,
      eventType: 'restored',
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      summary: `Version v${params.versionNumber} restaurée en brouillon v${nextVer}`,
      createdAt: now,
    };
    tx.create(`publishingEvents/${pubEvent.id}`, pubEvent as unknown as Record<string, unknown>);

    return nextVer;
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'post.restore_version',
    entityType: 'post',
    entityId: params.postId,
    details: `Restauration de v${params.versionNumber} vers brouillon v${nextVersionNumber}`,
  });

  const updated = await getPostBundle(params.postId, params.workspaceId, true);
  if (!updated) throw new RepositoryError('INTERNAL', 'Erreur lors de la restauration.');
  return updated;
}

export async function savePostReactionsConfig(params: {
  postId: string;
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  reactionLimit: number;
  allowReactionChange: boolean;
  reactions: Array<{
    semanticKey: string;
    emoji: string;
    labels: LocalizedText;
    displayOrder: number;
    enabled: boolean;
  }>;
}): Promise<PostReaction[]> {
  const repo = getRepository();
  const postPre = await repo.get<Post>(`posts/${params.postId}`);
  const fallbackKeys =
    postPre && Array.isArray(postPre.reactionKeys)
      ? postPre.reactionKeys
      : (
          await repo.query<PostReaction>('postReactions', {
            filters: [{ field: 'postId', op: '==', value: params.postId }],
          })
        ).map((r) => r.data.semanticKey);

  const normalizedItems: Array<{
    key: string;
    emoji: string;
    labels: LocalizedText;
    displayOrder: number;
    enabled: boolean;
  }> = [];
  const incomingKeySet = new Set<string>();
  for (const item of params.reactions) {
    const key = item.semanticKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!key || incomingKeySet.has(key)) continue;
    incomingKeySet.add(key);
    normalizedItems.push({
      key,
      emoji: item.emoji.trim() || '✨',
      labels: {
        fr: item.labels.fr.trim() || key,
        en: item.labels.en.trim() || key,
        fon: item.labels.fon.trim() || key,
      },
      displayOrder: item.displayOrder,
      enabled: item.enabled,
    });
  }

  const saved = await repo.runTransaction(async (tx) => {
    const [post, pubSnap] = await Promise.all([
      tx.get<Post>(`posts/${params.postId}`),
      tx.get<PublishedPostSnapshot>(`publishedPosts/${params.postId}`),
    ]);
    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const keysToRead = Array.from(
      new Set([
        ...(post.reactionKeys || []),
        ...(pubSnap?.reactions?.map((r) => r.semanticKey) || []),
        ...fallbackKeys,
        ...normalizedItems.map((i) => i.key),
      ])
    );

    const existingDocs = await Promise.all(
      keysToRead.map((k) => tx.get<PostReaction>(`postReactions/${params.postId}_${k}`))
    );
    const existingMap = new Map<string, PostReaction>();
    for (const d of existingDocs) {
      if (d) existingMap.set(d.semanticKey, d);
    }

    const activePubKeys = new Set(
      pubSnap?.status === 'published'
        ? (pubSnap.reactions || []).filter((sr) => sr.enabled).map((sr) => sr.semanticKey)
        : []
    );

    const nextDraftReactions: PostReaction[] = [];
    const trackedKeys = new Set<string>();

    for (const item of normalizedItems) {
      trackedKeys.add(item.key);
      const prev = existingMap.get(item.key);
      const pr: PostReaction = {
        id: `${params.postId}_${item.key}`,
        postId: params.postId,
        workspaceId: params.workspaceId,
        // Never activate draft-only reactions on public live route before republishing (AUDIT-005)
        isPublished: activePubKeys.has(item.key),
        draftRemoved: false,
        semanticKey: item.key,
        emoji: item.emoji,
        labels: item.labels,
        displayOrder: item.displayOrder,
        enabled: item.enabled,
        count: prev?.count ?? 0,
      };
      tx.set(`postReactions/${pr.id}`, pr as unknown as Record<string, unknown>);
      nextDraftReactions.push(pr);
    }

    for (const [oldKey, oldDoc] of existingMap.entries()) {
      if (!incomingKeySet.has(oldKey)) {
        if (activePubKeys.has(oldKey)) {
          // Preserve live voting counter doc until the next publishPost() removes it from snapshot
          trackedKeys.add(oldKey);
          tx.set(`postReactions/${oldDoc.id}`, {
            ...oldDoc,
            isPublished: true,
            draftRemoved: true,
          });
        } else {
          tx.delete(`postReactions/${oldDoc.id}`);
        }
      }
    }

    tx.update(`posts/${params.postId}`, {
      reactionLimit: Math.max(1, Math.min(10, Math.floor(params.reactionLimit))),
      allowReactionChange: params.allowReactionChange,
      reactionKeys: Array.from(trackedKeys),
      updatedAt: nowIso(),
    });

    return nextDraftReactions;
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'post.update_reactions',
    entityType: 'post',
    entityId: params.postId,
    details: `${saved.length} réactions configurées (limite: ${params.reactionLimit}, changement: ${params.allowReactionChange})`,
  });

  return saved.sort((a, b) => a.displayOrder - b.displayOrder);
}

export async function saveSeoSetting(params: {
  postId: string;
  workspaceId: string;
  locale: Locale;
  actorId: string;
  actorEmail: string;
  patch: Partial<SEOSetting>;
}): Promise<SEOSetting> {
  const repo = getRepository();

  if (params.patch.canonicalUrl && !isSafeHttpUrl(params.patch.canonicalUrl)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'URL canonique invalide (http:// ou https:// requis).');
  }
  if (params.patch.ogImageUrl) {
    await assertWorkspaceSafeMediaUrl(params.patch.ogImageUrl, params.workspaceId);
  }

  const seoId = `${params.postId}_${params.locale}`;
  const seoPath = `seoSettings/${seoId}`;
  const now = nowIso();

  const updated = await repo.runTransaction(async (tx) => {
    const [post, existing] = await Promise.all([
      tx.get<Post>(`posts/${params.postId}`),
      tx.get<SEOSetting>(seoPath),
    ]);
    if (!post) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (post.workspaceId !== params.workspaceId) {
      throw new RepositoryError('PERMISSION_DENIED', 'Accès inter-espaces refusé.');
    }

    const nextSeo: SEOSetting = {
      id: seoId,
      postId: params.postId,
      workspaceId: params.workspaceId,
      isPublished: existing?.isPublished ?? false,
      locale: params.locale,
      metaTitle: (params.patch.metaTitle ?? existing?.metaTitle ?? '').slice(0, 120),
      metaDescription: (params.patch.metaDescription ?? existing?.metaDescription ?? '').slice(0, 320),
      canonicalUrl: (params.patch.canonicalUrl ?? existing?.canonicalUrl ?? '').slice(0, 512),
      ogTitle: (params.patch.ogTitle ?? existing?.ogTitle ?? '').slice(0, 120),
      ogDescription: (params.patch.ogDescription ?? existing?.ogDescription ?? '').slice(0, 320),
      ogImageUrl: (params.patch.ogImageUrl ?? existing?.ogImageUrl ?? '').slice(0, 512),
      twitterCardType: params.patch.twitterCardType ?? existing?.twitterCardType ?? 'summary_large_image',
      schemaType: params.patch.schemaType ?? existing?.schemaType ?? 'BlogPosting',
      noIndex: params.patch.noIndex ?? existing?.noIndex ?? false,
      updatedAt: now,
    };

    tx.set(seoPath, nextSeo as unknown as Record<string, unknown>);
    return nextSeo;
  });

  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'seo.update',
    entityType: 'seoSetting',
    entityId: seoId,
    details: `Mise à jour SEO (${params.locale.toUpperCase()})`,
  });
  return updated;
}

// ============================================================================
// PUBLIC PUBLISHING, REACTIONS & ANALYTICS (IMMUTABLE SNAPSHOT READS)
// ============================================================================

async function mergeLiveReactionCounts(
  postId: string,
  snapshotReactions: PostReaction[] | undefined
): Promise<PostReaction[]> {
  const repo = getRepository();
  const reactRows = await repo.query<PostReaction>('postReactions', {
    filters: [
      { field: 'postId', op: '==', value: postId },
      { field: 'isPublished', op: '==', value: true },
    ],
  });
  const liveByKey = new Map<string, PostReaction>();
  for (const r of reactRows) {
    liveByKey.set(r.data.semanticKey, r.data);
  }

  if (snapshotReactions && snapshotReactions.length > 0) {
    return snapshotReactions
      .map((sr) => ({
        ...sr,
        count: liveByKey.get(sr.semanticKey)?.count ?? sr.count ?? 0,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  return reactRows.map((r) => r.data).sort((a, b) => a.displayOrder - b.displayOrder);
}

function publishedSnapshotToBundle(
  snap: PublishedPostSnapshot,
  reactions: PostReaction[]
): FullPostBundle {
  return {
    post: snap.post,
    translations: snap.translations,
    reactions,
    seo: snap.seo,
    versions: [],
    publishingEvents: [],
  };
}

export async function getPublishedPostByLocaleSlug(
  locale: Locale,
  slug: string
): Promise<{
  workspace: Workspace;
  bundle: FullPostBundle;
  category: Category | null;
  tags: Tag[];
  relatedPosts: Array<{ locale: Locale; title: string; slug: string; excerpt: string; publishedAt: string | null }>;
} | null> {
  const repo = getRepository();
  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) return null;

  let route = await repo.get<PublishedSlugRoute>(`publishedSlugRoutes/${publishedSlugRouteDocId(locale, cleanSlug)}`);
  if (!route) {
    const legacyRows = await repo.query<PublishedSlugRoute>('publishedSlugRoutes', {
      filters: [
        { field: 'locale', op: '==', value: locale },
        { field: 'slug', op: '==', value: cleanSlug },
        { field: 'status', op: '==', value: 'published' },
      ],
      limit: 1,
    });
    route = legacyRows[0]?.data || null;
  }

  if (!route || route.status !== 'published') return null;

  // Read strictly from immutable publishedPosts snapshot (RED-001)
  const snap = await repo.get<PublishedPostSnapshot>(`publishedPosts/${route.postId}`);
  if (!snap || snap.status !== 'published' || snap.post.status !== 'published') return null;

  const tr = snap.translations?.[locale];
  if (!tr || !isLocaleSnapshotPublishable(locale, tr) || tr.slug !== cleanSlug) return null;

  const [workspace, reactions, categoryCandidate, tagsCandidate, otherPubSnaps] = await Promise.all([
    repo.get<Workspace>(`workspaces/${snap.workspaceId}`),
    mergeLiveReactionCounts(snap.postId, snap.reactions),
    snap.categorySnapshot !== undefined
      ? Promise.resolve(snap.categorySnapshot)
      : snap.post.categoryId
        ? repo.get<Category>(`categories/${snap.post.categoryId}`)
        : Promise.resolve(null),
    snap.tagsSnapshot !== undefined
      ? Promise.resolve(snap.tagsSnapshot)
      : Promise.all((snap.post.tagIds || []).map((tid) => repo.get<Tag>(`tags/${tid}`))),
    repo.query<PublishedPostSnapshot>('publishedPosts', {
      filters: [
        { field: 'workspaceId', op: '==', value: snap.workspaceId },
        { field: 'status', op: '==', value: 'published' },
      ],
      limit: 6,
    }),
  ]);

  if (!workspace) return null;
  const category =
    categoryCandidate && categoryCandidate.workspaceId === workspace.id ? categoryCandidate : null;
  const tags = (tagsCandidate || []).filter((t): t is Tag => t !== null && t.workspaceId === workspace.id);

  const bundle = publishedSnapshotToBundle(snap, reactions);

  const relatedPosts: Array<{
    locale: Locale;
    title: string;
    slug: string;
    excerpt: string;
    publishedAt: string | null;
  }> = [];

  for (const row of otherPubSnaps) {
    const opSnap = row.data;
    if (opSnap.postId === snap.postId || opSnap.status !== 'published') continue;
    const opTr = opSnap.translations?.[locale];
    if (!opTr || !isLocaleSnapshotPublishable(locale, opTr)) continue;
    relatedPosts.push({
      locale,
      title: opTr.title,
      slug: opTr.slug,
      excerpt: opTr.excerpt,
      publishedAt: opSnap.publishedAt || opSnap.post.publishedAt,
    });
    if (relatedPosts.length >= 3) break;
  }

  return { workspace, bundle, category, tags, relatedPosts };
}

export async function listAllPublishedPostsForLocale(locale: Locale): Promise<
  Array<{
    post: Post;
    translation: PostTranslation;
    workspace: Workspace;
    reactions: PostReaction[];
  }>
> {
  const repo = getRepository();
  const snapRows = await repo.query<PublishedPostSnapshot>('publishedPosts', {
    filters: [{ field: 'status', op: '==', value: 'published' }],
  });

  const results: Array<{
    post: Post;
    translation: PostTranslation;
    workspace: Workspace;
    reactions: PostReaction[];
  }> = [];

  for (const row of snapRows) {
    const snap = row.data;
    const tr = snap.translations?.[locale];
    if (!tr || !isLocaleSnapshotPublishable(locale, tr)) continue;

    const [ws, reactions] = await Promise.all([
      repo.get<Workspace>(`workspaces/${snap.workspaceId}`),
      mergeLiveReactionCounts(snap.postId, snap.reactions),
    ]);
    if (!ws) continue;

    results.push({
      post: snap.post,
      translation: tr,
      workspace: ws,
      reactions: reactions.filter((r) => r.enabled),
    });
  }

  return results.sort((a, b) => (b.post.publishedAt || '').localeCompare(a.post.publishedAt || ''));
}

export async function listAllPublishedBundles(): Promise<Array<{ workspace: Workspace; bundle: FullPostBundle }>> {
  const repo = getRepository();
  const snapRows = await repo.query<PublishedPostSnapshot>('publishedPosts', {
    filters: [{ field: 'status', op: '==', value: 'published' }],
  });

  const out: Array<{ workspace: Workspace; bundle: FullPostBundle }> = [];
  for (const row of snapRows) {
    const snap = row.data;
    const [ws, reactions] = await Promise.all([
      repo.get<Workspace>(`workspaces/${snap.workspaceId}`),
      mergeLiveReactionCounts(snap.postId, snap.reactions),
    ]);
    if (!ws) continue;
    out.push({ workspace: ws, bundle: publishedSnapshotToBundle(snap, reactions) });
  }
  return out;
}

export async function getVisitorReactionsForPost(postId: string, visitorHash: string): Promise<string[]> {
  const repo = getRepository();
  const state = await repo.get<{ activeKeys?: string[] }>(`visitorReactionStates/${postId}_${visitorHash}`);
  return state && Array.isArray(state.activeKeys) ? state.activeKeys : [];
}

export async function submitPublicReaction(params: {
  postId: string;
  visitorHash: string;
  semanticKey: string;
  locale: Locale;
  idempotencyKey?: string;
}): Promise<{
  status: 'ok' | 'duplicate' | 'conflict';
  action?: 'added' | 'changed' | 'removed';
  message?: string;
  activeKeys: string[];
  reactions: PostReaction[];
}> {
  const repo = getRepository();
  const { postId, visitorHash, semanticKey, locale } = params;
  const idempotencyKey = params.idempotencyKey?.trim().slice(0, 100) || '';
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const today = now.slice(0, 10);

  return repo.runTransaction(async (tx) => {
    const pubSnap = await tx.get<PublishedPostSnapshot>(`publishedPosts/${postId}`);
    if (!pubSnap) throw new RepositoryError('NOT_FOUND', 'Article introuvable.');
    if (pubSnap.status !== 'published' || pubSnap.post.status !== 'published') {
      throw new RepositoryError('PERMISSION_DENIED', 'Impossible de réagir à un article non publié.');
    }

    const post = pubSnap.post;
    // Snapshot reactions are the SOLE authoritative live configuration (AUDIT-005/AUDIT-006)
    const snapReaction = pubSnap.reactions?.find((r) => r.semanticKey === semanticKey);
    if (!snapReaction) {
      throw new RepositoryError('NOT_FOUND', 'Clé de réaction introuvable.');
    }
    if (!snapReaction.enabled) {
      throw new RepositoryError('INVALID_ARGUMENT', 'Cette réaction est désactivée.');
    }

    const snapReactionKeys = Array.from(new Set((pubSnap.reactions || []).map((r) => r.semanticKey)));
    const statePath = `visitorReactionStates/${postId}_${visitorHash}`;
    const shardIndex = pickAnalyticsShard(`${postId}:${visitorHash}`);
    const shardPath = dailyAnalyticsShardPath(today, post.workspaceId, shardIndex);
    const idemPath = idempotencyKey ? `reactionIdempotency/${postId}_${visitorHash}_${idempotencyKey}` : null;

    const [existingState, existingShard, existingIdem, ...freshReactions] = await Promise.all([
      tx.get<{ activeKeys: string[] }>(statePath),
      tx.get<{
        workspaceId: string;
        date: string;
        views: number;
        uniqueVisitors: number;
        reactionsAdded: number;
        reactionsRemoved: number;
      }>(shardPath),
      idemPath ? tx.get(idemPath) : Promise.resolve(null),
      ...snapReactionKeys.map((k) => tx.get<PostReaction>(`postReactions/${postId}_${k}`)),
    ]);

    const liveDocsByKey = new Map<string, PostReaction>();
    for (const fresh of freshReactions) {
      if (fresh) liveDocsByKey.set(fresh.semanticKey, fresh);
    }

    const reactMap = new Map<string, PostReaction>();
    for (const sr of pubSnap.reactions || []) {
      const liveDoc = liveDocsByKey.get(sr.semanticKey);
      reactMap.set(sr.semanticKey, { ...sr, count: liveDoc?.count ?? sr.count ?? 0 });
    }
    const targetReaction = reactMap.get(semanticKey)!;
    const targetDocExists = liveDocsByKey.has(semanticKey);

    let activeKeys = existingState && Array.isArray(existingState.activeKeys) ? [...existingState.activeKeys] : [];

    if (idemPath && existingIdem) {
      return {
        status: 'duplicate',
        message: 'Requête déjà traitée (idempotence).',
        activeKeys,
        reactions: Array.from(reactMap.values()).sort((a, b) => a.displayOrder - b.displayOrder),
      };
    }

    const alreadySelected = activeKeys.includes(semanticKey);
    if (alreadySelected && !post.allowReactionChange) {
      return {
        status: 'conflict',
        message: 'Vous avez déjà enregistré cette réaction et la modification est désactivée.',
        activeKeys,
        reactions: Array.from(reactMap.values()).sort((a, b) => a.displayOrder - b.displayOrder),
      };
    }
    if (!alreadySelected && activeKeys.length >= post.reactionLimit && !post.allowReactionChange) {
      return {
        status: 'conflict',
        message: 'Limite de réactions atteinte et le changement de réaction est désactivé.',
        activeKeys,
        reactions: Array.from(reactMap.values()).sort((a, b) => a.displayOrder - b.displayOrder),
      };
    }

    if (idemPath) {
      tx.set(idemPath, {
        postId,
        visitorHash,
        semanticKey,
        createdAt: now,
        expiresAt: new Date(nowMs + REACTION_IDEMPOTENCY_TTL_MS).toISOString(),
      });
    }

    let action: 'added' | 'changed' | 'removed' = 'added';
    let previousKey: string | null = null;
    let addedDelta = 0;
    let removedDelta = 0;

    const writeReactionCount = (key: string, nextCount: number, existed: boolean) => {
      const item = reactMap.get(key)!;
      const path = `postReactions/${postId}_${key}`;
      if (existed) {
        tx.update(path, { count: nextCount });
      } else {
        tx.set(path, { ...item, isPublished: true, count: nextCount } as unknown as Record<string, unknown>);
      }
      reactMap.set(key, { ...item, count: nextCount });
    };

    if (alreadySelected) {
      activeKeys = activeKeys.filter((k) => k !== semanticKey);
      const nextCount = Math.max(0, (targetReaction.count || 0) - 1);
      writeReactionCount(semanticKey, nextCount, targetDocExists);
      action = 'removed';
      previousKey = semanticKey;
      removedDelta = 1;
    } else if (activeKeys.length >= post.reactionLimit) {
      previousKey = activeKeys.shift() || null;
      if (previousKey && reactMap.has(previousKey)) {
        const prevReaction = reactMap.get(previousKey)!;
        const decCount = Math.max(0, (prevReaction.count || 0) - 1);
        writeReactionCount(previousKey, decCount, liveDocsByKey.has(previousKey));
      }
      activeKeys.push(semanticKey);
      const incCount = (targetReaction.count || 0) + 1;
      writeReactionCount(semanticKey, incCount, targetDocExists);
      action = 'changed';
    } else {
      activeKeys.push(semanticKey);
      const incCount = (targetReaction.count || 0) + 1;
      writeReactionCount(semanticKey, incCount, targetDocExists);
      action = 'added';
      addedDelta = 1;
    }

    tx.set(statePath, {
      postId,
      workspaceId: post.workspaceId,
      visitorHash,
      activeKeys,
      updatedAt: now,
    });

    const eventId = makeId('revt');
    const eventDoc: ReactionEvent = {
      id: eventId,
      postId,
      workspaceId: post.workspaceId,
      visitorHash,
      semanticKey,
      previousKey,
      locale,
      idempotencyKey: idempotencyKey || eventId,
      action,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(`reactionEvents/${eventId}`, eventDoc as unknown as Record<string, unknown>);

    tx.set(shardPath, {
      workspaceId: post.workspaceId,
      date: today,
      views: existingShard?.views ?? 0,
      uniqueVisitors: existingShard?.uniqueVisitors ?? 0,
      reactionsAdded: (existingShard?.reactionsAdded ?? 0) + addedDelta,
      reactionsRemoved: (existingShard?.reactionsRemoved ?? 0) + removedDelta,
      updatedAt: now,
    });

    return {
      status: 'ok',
      action,
      activeKeys,
      reactions: Array.from(reactMap.values()).sort((a, b) => a.displayOrder - b.displayOrder),
    };
  });
}

export async function recordPublicView(params: {
  postId: string;
  workspaceId: string;
  visitorHash: string;
  locale: Locale;
  referrer: string;
}): Promise<void> {
  const repo = getRepository();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const viewedDate = now.slice(0, 10);
  const uniqueDocId = `${params.postId}_${viewedDate}_${params.visitorHash}`;
  const shardIndex = pickAnalyticsShard(`${params.postId}:${params.visitorHash}`);
  const shardPath = dailyAnalyticsShardPath(viewedDate, params.workspaceId, shardIndex);

  try {
    await repo.runTransaction(async (tx) => {
      const uniquePath = `visitorDailyViews/${uniqueDocId}`;
      const [existing, existingShard] = await Promise.all([
        tx.get(uniquePath),
        tx.get<{
          workspaceId: string;
          date: string;
          views: number;
          uniqueVisitors: number;
          reactionsAdded: number;
          reactionsRemoved: number;
        }>(shardPath),
      ]);
      const isUnique = !existing;
      if (isUnique) {
        tx.set(uniquePath, {
          postId: params.postId,
          workspaceId: params.workspaceId,
          visitorHash: params.visitorHash,
          viewedDate,
          createdAt: now,
          expiresAt: new Date(nowMs + DAILY_VISITOR_VIEW_TTL_MS).toISOString(),
        });
      }

      const viewId = makeId('view');
      const view: PostView = {
        id: viewId,
        postId: params.postId,
        workspaceId: params.workspaceId,
        visitorHash: params.visitorHash,
        locale: params.locale,
        referrer: params.referrer.slice(0, 255),
        isUnique,
        viewedDate,
        createdAt: now,
      };
      tx.set(`postViews/${viewId}`, view as unknown as Record<string, unknown>);

      tx.set(shardPath, {
        workspaceId: params.workspaceId,
        date: viewedDate,
        views: (existingShard?.views ?? 0) + 1,
        uniqueVisitors: (existingShard?.uniqueVisitors ?? 0) + (isUnique ? 1 : 0),
        reactionsAdded: existingShard?.reactionsAdded ?? 0,
        reactionsRemoved: existingShard?.reactionsRemoved ?? 0,
        updatedAt: now,
      });
    });
  } catch (err) {
    console.error('Failed to record view:', err);
  }
}

export async function cleanupExpiredEphemeralRecords(nowIsoCutoff = nowIso()): Promise<number> {
  const repo = getRepository();
  const ephemeralCollections = ['rateLimitBuckets', 'reactionIdempotency', 'visitorDailyViews'] as const;
  let cleaned = 0;

  for (const col of ephemeralCollections) {
    while (true) {
      const expired = await repo.query<{ expiresAt?: string }>(col, {
        filters: [{ field: 'expiresAt', op: '<=', value: nowIsoCutoff }],
        limit: 400,
      });
      if (expired.length === 0) break;
      const ops: RepoWriteOp[] = expired.map((d) => ({ type: 'delete', path: `${col}/${d.id}` }));
      await repo.commitBatch(ops);
      cleaned += ops.length;
      if (expired.length < 400) break;
    }
  }
  return cleaned;
}

export async function getWorkspaceAnalytics(workspaceId: string, filterPostId?: string): Promise<AnalyticsSummary> {
  const repo = getRepository();
  const [bundles, viewsRows, eventsRows] = await Promise.all([
    listWorkspacePosts(workspaceId),
    repo.query<PostView>('postViews', {
      filters: [{ field: 'workspaceId', op: '==', value: workspaceId }],
      limit: 5000,
    }),
    repo.query<ReactionEvent>('reactionEvents', {
      filters: [{ field: 'workspaceId', op: '==', value: workspaceId }],
      limit: 5000,
    }),
  ]);

  const allViews = viewsRows
    .map((r) => r.data)
    .filter((v) => !filterPostId || v.postId === filterPostId);

  const allEvents = eventsRows
    .map((r) => r.data)
    .filter((e) => !filterPostId || e.postId === filterPostId);

  const uniqueVisitorSet = new Set(allViews.map((v) => v.visitorHash));
  const byLocale: Record<Locale, { views: number; reactions: number }> = {
    fr: { views: 0, reactions: 0 },
    en: { views: 0, reactions: 0 },
    fon: { views: 0, reactions: 0 },
  };
  const referrerCounts = new Map<string, number>();
  const timelineMap = new Map<string, { views: number; reactions: number }>();

  for (const v of allViews) {
    if (byLocale[v.locale]) byLocale[v.locale].views += 1;
    referrerCounts.set(v.referrer || 'Direct', (referrerCounts.get(v.referrer || 'Direct') || 0) + 1);
    const day = v.viewedDate || v.createdAt.slice(0, 10);
    const cur = timelineMap.get(day) || { views: 0, reactions: 0 };
    cur.views += 1;
    timelineMap.set(day, cur);
  }

  let reactionChanges = 0;
  for (const e of allEvents) {
    if (e.action === 'changed') reactionChanges += 1;
    if (e.action !== 'removed' && byLocale[e.locale]) {
      byLocale[e.locale].reactions += 1;
    }
    const day = e.createdAt.slice(0, 10);
    const cur = timelineMap.get(day) || { views: 0, reactions: 0 };
    if (e.action !== 'removed') cur.reactions += 1;
    timelineMap.set(day, cur);
  }

  const reactionAggMap = new Map<string, { semanticKey: string; emoji: string; labels: LocalizedText; count: number }>();
  let totalReactions = 0;

  const relevantBundles = filterPostId ? bundles.filter((b) => b.post.id === filterPostId) : bundles;
  for (const b of relevantBundles) {
    for (const r of b.reactions) {
      totalReactions += r.count || 0;
      const existing = reactionAggMap.get(r.semanticKey);
      if (existing) {
        existing.count += r.count || 0;
      } else {
        reactionAggMap.set(r.semanticKey, {
          semanticKey: r.semanticKey,
          emoji: r.emoji,
          labels: r.labels,
          count: r.count || 0,
        });
      }
    }
  }

  const totalViews = allViews.length;
  const uniqueVisitors = uniqueVisitorSet.size;
  const engagementRate = totalViews > 0 ? Number(((totalReactions / totalViews) * 100).toFixed(1)) : 0;

  const perPost = bundles.map((b) => {
    const pViews = allViews.filter((v) => v.postId === b.post.id);
    const pUnique = new Set(pViews.map((v) => v.visitorHash)).size;
    const pEvents = allEvents.filter((e) => e.postId === b.post.id);
    const pChanges = pEvents.filter((e) => e.action === 'changed').length;
    const pReactTotal = b.reactions.reduce((acc, r) => acc + (r.count || 0), 0);
    const pTitle =
      b.translations[b.post.primaryLocale]?.title ||
      b.translations.fr?.title ||
      b.translations.en?.title ||
      b.translations.fon?.title ||
      'Sans titre';
    const pSlug =
      b.translations[b.post.primaryLocale]?.slug ||
      b.translations.fr?.slug ||
      '';
    return {
      postId: b.post.id,
      title: pTitle,
      slug: pSlug,
      status: b.post.status,
      views: pViews.length,
      uniqueVisitors: pUnique,
      reactions: pReactTotal,
      reactionChanges: pChanges,
      engagementRate: pViews.length > 0 ? Number(((pReactTotal / pViews.length) * 100).toFixed(1)) : 0,
    };
  });

  return {
    totalViews,
    uniqueVisitors,
    totalReactions,
    reactionChanges,
    engagementRate,
    byLocale,
    byReaction: Array.from(reactionAggMap.values()).sort((a, b) => b.count - a.count),
    byReferrer: Array.from(referrerCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    timeline: Array.from(timelineMap.entries())
      .map(([date, vals]) => ({ date, ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    perPost,
  };
}

// ============================================================================
// STORAGE MEDIA HELPERS (RED-011 / AUDIT-001 / AUDIT-002 / AUDIT-005)
// ============================================================================

function resolveLocalMediaPath(
  storagePath: string,
  expectedWorkspaceId: string,
  expectedAssetId: string
): string {
  const validated = assertValidWorkspaceMediaStoragePath(storagePath, expectedWorkspaceId, expectedAssetId);
  const mediaRoot = path.resolve(process.cwd(), '.data/media');
  const resolved = path.resolve(mediaRoot, validated);
  if (!resolved.startsWith(`${mediaRoot}${path.sep}`)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Chemin média invalide.');
  }
  return resolved;
}

function getValidatedAdminMediaBucket() {
  const bucket = getAdminStorage().bucket();
  const expectedBucket = isEmulatorModeRequested()
    ? `${(process.env.FIREBASE_PROJECT_ID || LOCAL_EMULATOR_PROJECT_ID).trim()}.appspot.com`
    : FIREBASE_CONFIG.storageBucket;
  if (!expectedBucket || (bucket.name && bucket.name !== expectedBucket)) {
    throw new RepositoryError('PERMISSION_DENIED', 'Bucket de stockage média non autorisé.');
  }
  return bucket;
}

export async function uploadMediaAssetToStorage(params: {
  workspaceId: string;
  assetId: string;
  filename?: string;
  ext: string;
  mimeType: string;
  buffer: Buffer;
  actorId?: string;
}): Promise<string> {
  if (!SAFE_ID_REGEX.test(params.workspaceId) || !SAFE_ID_REGEX.test(params.assetId)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant d’espace ou de média invalide.');
  }
  const imgCheck = validateImageBuffer(params.mimeType, params.buffer);
  if (!imgCheck.ok) {
    throw new RepositoryError('INVALID_ARGUMENT', imgCheck.error || 'Fichier média invalide.');
  }
  if (params.actorId) {
    const verified = await verifyWorkspaceMembership({
      uid: params.actorId,
      email: '',
      requestedWorkspaceId: params.workspaceId,
    });
    if (verified.role !== 'owner' && verified.role !== 'editor') {
      throw new RepositoryError('PERMISSION_DENIED', 'Permissions insuffisantes pour téléverser un média.');
    }
  }

  const safeFilename = params.filename
    ? sanitizeMediaFilename(params.filename, params.mimeType, params.assetId)
    : sanitizeMediaFilename(`${params.assetId}.${params.ext}`, params.mimeType, params.assetId);
  const storagePath = buildCanonicalWorkspaceMediaStoragePath(
    params.workspaceId,
    params.assetId,
    safeFilename
  );

  const useLocal = getRepository() instanceof LocalFileRepository;
  if (!useLocal) {
    const bucket = getValidatedAdminMediaBucket();
    assertValidWorkspaceMediaStoragePath(storagePath, params.workspaceId, params.assetId, {
      allowLegacy: false,
    });
    await bucket.file(storagePath).save(params.buffer, {
      resumable: false,
      metadata: {
        contentType: params.mimeType,
        cacheControl: 'private, max-age=0, no-store',
      },
    });
    return storagePath;
  }

  const localPath = resolveLocalMediaPath(storagePath, params.workspaceId, params.assetId);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, params.buffer);
  return storagePath;
}

export async function readMediaAssetBuffer(
  asset: MediaAsset,
  options?: { expectedWorkspaceId?: string }
): Promise<Buffer | null> {
  if (!asset || !asset.storagePath || !asset.workspaceId || !asset.id) return null;
  if (!SAFE_ID_REGEX.test(asset.workspaceId) || !SAFE_ID_REGEX.test(asset.id)) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant média invalide.');
  }
  if ((asset as MediaAsset & { deletedAt?: string }).deletedAt) {
    return null;
  }
  if (options?.expectedWorkspaceId && asset.workspaceId !== options.expectedWorkspaceId) {
    throw new RepositoryError('PERMISSION_DENIED', 'Accès média inter-espaces refusé.');
  }
  const validatedPath = assertValidWorkspaceMediaStoragePath(asset.storagePath, asset.workspaceId, asset.id);
  if (!(getRepository() instanceof LocalFileRepository)) {
    try {
      const bucket = getValidatedAdminMediaBucket();
      const [contents] = await bucket.file(validatedPath).download();
      return contents;
    } catch {
      return null;
    }
  }
  try {
    const localPath = resolveLocalMediaPath(validatedPath, asset.workspaceId, asset.id);
    return await fs.readFile(localPath);
  } catch {
    return null;
  }
}

export async function deleteWorkspaceMediaAsset(params: {
  assetId: string;
  workspaceId: string;
  actorId: string;
  actorEmail: string;
}): Promise<void> {
  if (
    !SAFE_ID_REGEX.test(params.assetId) ||
    !SAFE_ID_REGEX.test(params.workspaceId) ||
    !SAFE_ID_REGEX.test(params.actorId)
  ) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Identifiant invalide pour la suppression média.');
  }
  const verified = await verifyWorkspaceMembership({
    uid: params.actorId,
    email: params.actorEmail,
    requestedWorkspaceId: params.workspaceId,
  });
  if (verified.role !== 'owner' && verified.role !== 'editor') {
    throw new RepositoryError('PERMISSION_DENIED', 'Permissions insuffisantes pour supprimer un média.');
  }

  const repo = getRepository();
  const asset = await repo.getWorkspaceScoped<MediaAsset>('mediaAssets', params.assetId, params.workspaceId);
  if (!asset) {
    throw new RepositoryError('NOT_FOUND', 'Média introuvable.');
  }
  if (asset.id !== params.assetId || asset.workspaceId !== params.workspaceId) {
    throw new RepositoryError('PERMISSION_DENIED', 'Média non autorisé pour cet espace de travail.');
  }
  if (await isMediaAssetPubliclyReferenced(asset)) {
    throw new RepositoryError(
      'CONFLICT',
      'Ce média est actuellement référencé par un article publié et ne peut pas être supprimé avant dépublication ou remplacement.'
    );
  }
  if (asset.storagePath) {
    const validatedPath = assertValidWorkspaceMediaStoragePath(asset.storagePath, params.workspaceId, params.assetId);
    if (!(repo instanceof LocalFileRepository)) {
      try {
        await getValidatedAdminMediaBucket().file(validatedPath).delete({ ignoreNotFound: true });
      } catch {
        // Ignore missing blob on Storage cleanup
      }
    } else {
      try {
        const localPath = resolveLocalMediaPath(validatedPath, params.workspaceId, params.assetId);
        await fs.unlink(localPath);
        await fs.rmdir(path.dirname(localPath)).catch(() => {});
      } catch {
        // Ignore local file absence
      }
    }
  }
  await repo.delete(`mediaAssets/${params.assetId}`);
  await logAudit({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'media.delete',
    entityType: 'mediaAsset',
    entityId: params.assetId,
    details: `Suppression du média ${asset.filename}`,
  });
}

// ============================================================================
// WORKSPACE BACKUP & STRICTLY TYPED TRANSACTIONAL RESTORE (AUDIT-010)
// ============================================================================

export async function exportWorkspaceBackup(workspaceId: string): Promise<Record<string, unknown>> {
  const repo = getRepository();
  const wsFilter = [{ field: 'workspaceId', op: '==' as const, value: workspaceId }];
  const [ws, posts, trs, vers, seos, presets, reacts, cats, tags, media, pubs] = await Promise.all([
    repo.get<Workspace>(`workspaces/${workspaceId}`),
    repo.query('posts', { filters: wsFilter }),
    repo.query('postTranslations', { filters: wsFilter }),
    repo.query('postVersions', { filters: wsFilter }),
    repo.query('seoSettings', { filters: wsFilter }),
    repo.query('reactionPresets', { filters: wsFilter }),
    repo.query('postReactions', { filters: wsFilter }),
    repo.query('categories', { filters: wsFilter }),
    repo.query('tags', { filters: wsFilter }),
    repo.query('mediaAssets', { filters: wsFilter }),
    repo.query('publishingEvents', { filters: wsFilter }),
  ]);

  return {
    exportedAt: nowIso(),
    schemaVersion: '1.0.0',
    workspace: ws,
    posts: posts.map((d) => d.data),
    postTranslations: trs.map((d) => d.data),
    postVersions: vers.map((d) => d.data),
    seoSettings: seos.map((d) => d.data),
    reactionPresets: presets.map((d) => d.data),
    postReactions: reacts.map((d) => d.data),
    categories: cats.map((d) => d.data),
    tags: tags.map((d) => d.data),
    mediaAssets: media.map((d) => d.data),
    publishingEvents: pubs.map((d) => d.data),
  };
}

const localizedTextStrictSchema = z
  .object({
    fr: z.string().max(240),
    en: z.string().max(240),
    fon: z.string().max(240),
  })
  .strict();

const backupCategorySchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    slug: z.string().min(1).max(140),
    names: localizedTextStrictSchema,
    createdAt: z.string().max(40).optional(),
  })
  .strict();

const backupTagSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    slug: z.string().min(1).max(140),
    names: localizedTextStrictSchema,
    createdAt: z.string().max(40).optional(),
  })
  .strict();

const backupReactionPresetSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    semanticKey: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
    emoji: z.string().min(1).max(16),
    labels: localizedTextStrictSchema,
    displayOrder: z.number().int().min(0).max(50),
    createdAt: z.string().max(40).optional(),
  })
  .strict();

const backupMediaAssetSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    filename: z.string().min(1).max(180),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    sizeBytes: z.number().int().min(0).max(5 * 1024 * 1024),
    url: z.string().min(1).max(512),
    storagePath: z.string().min(1).max(512).optional(),
    altText: localizedTextStrictSchema,
    uploadedBy: z.string().max(128).optional(),
    createdAt: z.string().max(40).optional(),
  })
  .strict();

const backupPostSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    authorId: z.string().min(1).max(128).optional(),
    authorName: z.string().max(120).optional(),
    primaryLocale: z.enum(['fr', 'en', 'fon']),
    status: z.enum(['draft', 'validated', 'published', 'archived']).optional(),
    featuredImageUrl: z.string().max(512).optional(),
    reactionLimit: z.number().int().min(1).max(10).optional(),
    allowReactionChange: z.boolean().optional(),
    reactionKeys: z.array(z.string().min(1).max(64)).max(50).optional(),
    categoryId: z.string().regex(SAFE_ID_REGEX).nullable().optional(),
    tagIds: z.array(z.string().regex(SAFE_ID_REGEX)).max(20).optional(),
    currentVersionNumber: z.number().int().min(1).max(100000).optional(),
    publishedVersionNumber: z.number().int().nullable().optional(),
    publishedAt: z.string().max(40).nullable().optional(),
    createdAt: z.string().max(40).optional(),
    updatedAt: z.string().max(40).optional(),
  })
  .strict();

const backupTranslationSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    postId: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    isPublished: z.boolean().optional(),
    locale: z.enum(['fr', 'en', 'fon']),
    title: z.string().max(240),
    slug: z.string().max(140),
    excerpt: z.string().max(600).optional(),
    markdownContent: z.string().max(200000),
    sanitizedHtml: z.string().max(300000).optional(),
    frontmatterJson: z.record(z.string(), z.unknown()).optional(),
    translationStatus: z.enum(['missing', 'draft', 'in_review', 'approved']).optional(),
    linguisticNotes: z.string().max(2000).optional(),
    approvedBy: z.string().max(128).nullable().optional(),
    approvedAt: z.string().max(40).nullable().optional(),
    wordCount: z.number().int().min(0).max(500000).optional(),
    readingTimeMinutes: z.number().int().min(0).max(5000).optional(),
    updatedAt: z.string().max(40).optional(),
  })
  .strict();

const backupSeoSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    postId: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    isPublished: z.boolean().optional(),
    locale: z.enum(['fr', 'en', 'fon']),
    metaTitle: z.string().max(120).optional(),
    metaDescription: z.string().max(320).optional(),
    canonicalUrl: z.string().max(512).optional(),
    ogTitle: z.string().max(120).optional(),
    ogDescription: z.string().max(320).optional(),
    ogImageUrl: z.string().max(512).optional(),
    twitterCardType: z.enum(['summary', 'summary_large_image']).optional(),
    schemaType: z.enum(['BlogPosting', 'Article', 'NewsArticle']).optional(),
    noIndex: z.boolean().optional(),
    updatedAt: z.string().max(40).optional(),
  })
  .strict();

const backupPostReactionSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    postId: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    isPublished: z.boolean().optional(),
    draftRemoved: z.boolean().optional(),
    semanticKey: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
    emoji: z.string().min(1).max(16),
    labels: localizedTextStrictSchema,
    displayOrder: z.number().int().min(0).max(50),
    enabled: z.boolean(),
    count: z.number().int().min(0).max(10000000).optional(),
  })
  .strict();

const backupPostVersionSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    postId: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    versionNumber: z.number().int().min(1).max(100000),
    snapshotType: z.enum(['draft_checkpoint', 'published_snapshot', 'restored_snapshot']),
    commitMessage: z.string().max(300),
    postSnapshot: z.record(z.string(), z.unknown()),
    translationsSnapshot: z.record(z.string(), z.unknown()),
    reactionsSnapshot: z.array(z.unknown()).max(50),
    seoSnapshot: z.record(z.string(), z.unknown()),
    createdBy: z.string().max(128),
    createdAt: z.string().max(40),
  })
  .strict();

const backupPublishingEventSchema = z
  .object({
    id: z.string().regex(SAFE_ID_REGEX),
    postId: z.string().regex(SAFE_ID_REGEX),
    workspaceId: z.string().regex(SAFE_ID_REGEX).optional(),
    versionNumber: z.number().int().min(1).max(100000),
    eventType: z.enum(['published', 'unpublished', 'restored']),
    actorId: z.string().max(128),
    actorEmail: z.string().max(255),
    summary: z.string().max(300),
    createdAt: z.string().max(40),
  })
  .strict();

const backupEnvelopeSchema = z
  .object({
    exportedAt: z.string().max(40).optional(),
    schemaVersion: z.string().max(32).optional(),
    workspace: z.record(z.string(), z.unknown()).nullable().optional(),
    posts: z.array(z.unknown()).max(400).optional(),
    postTranslations: z.array(z.unknown()).max(400).optional(),
    postVersions: z.array(z.unknown()).max(400).optional(),
    seoSettings: z.array(z.unknown()).max(400).optional(),
    reactionPresets: z.array(z.unknown()).max(200).optional(),
    postReactions: z.array(z.unknown()).max(400).optional(),
    categories: z.array(z.unknown()).max(300).optional(),
    tags: z.array(z.unknown()).max(400).optional(),
    mediaAssets: z.array(z.unknown()).max(400).optional(),
    publishingEvents: z.array(z.unknown()).max(400).optional(),
  })
  .strict();

export async function restoreWorkspaceBackup(params: {
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  backup: Record<string, unknown>;
}): Promise<{ restoredCount: number }> {
  const repo = getRepository();
  const { workspaceId, backup } = params;
  const now = nowIso();

  const parsedEnvelope = backupEnvelopeSchema.safeParse(backup);
  if (!parsedEnvelope.success) {
    throw new RepositoryError('INVALID_ARGUMENT', 'Structure JSON de sauvegarde invalide ou champs non reconnus.');
  }

  const collectionsToRestore = [
    'categories',
    'tags',
    'reactionPresets',
    'mediaAssets',
    'posts',
    'postTranslations',
    'seoSettings',
    'postReactions',
    'postVersions',
    'publishingEvents',
  ] as const;

  const restoredCategoryIds = new Set<string>();
  const restoredTagIds = new Set<string>();
  const restoredMediaMap = new Map<string, MediaAsset>();
  const restoredPostIds = new Set<string>();

  const referencedCategoryIds = new Set<string>();
  const referencedTagIds = new Set<string>();
  const referencedParentPostIds = new Set<string>();
  const referencedMediaIds = new Set<string>();

  const sanitizedDocs: Array<{ path: string; colName: string; id: string; data: Record<string, unknown> }> = [];
  const slugChecks: Array<{ locale: Locale; slug: string; postId: string }> = [];

  for (const colName of collectionsToRestore) {
    const items = parsedEnvelope.data[colName];
    if (!items) continue;

    for (const rawItem of items) {
      if (colName === 'categories') {
        const parsed = backupCategorySchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Catégorie invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        restoredCategoryIds.add(docId);
        sanitizedDocs.push({
          path: `categories/${docId}`,
          colName,
          id: docId,
          data: {
            id: docId,
            workspaceId,
            slug: generateSlug(parsed.data.slug) || docId,
            names: parsed.data.names,
            createdAt: parsed.data.createdAt || now,
          },
        });
      } else if (colName === 'tags') {
        const parsed = backupTagSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Étiquette invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        restoredTagIds.add(docId);
        sanitizedDocs.push({
          path: `tags/${docId}`,
          colName,
          id: docId,
          data: {
            id: docId,
            workspaceId,
            slug: generateSlug(parsed.data.slug) || docId,
            names: parsed.data.names,
            createdAt: parsed.data.createdAt || now,
          },
        });
      } else if (colName === 'reactionPresets') {
        const parsed = backupReactionPresetSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Modèle de réaction invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        sanitizedDocs.push({
          path: `reactionPresets/${docId}`,
          colName,
          id: docId,
          data: {
            id: docId,
            workspaceId,
            semanticKey: parsed.data.semanticKey,
            emoji: parsed.data.emoji,
            labels: parsed.data.labels,
            displayOrder: parsed.data.displayOrder,
            createdAt: parsed.data.createdAt || now,
          },
        });
      } else if (colName === 'mediaAssets') {
        const parsed = backupMediaAssetSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Média invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        if (parsed.data.workspaceId && parsed.data.workspaceId !== workspaceId) {
          throw new RepositoryError(
            'PERMISSION_DENIED',
            `Le média "${docId}" appartient à un autre espace de travail.`
          );
        }
        const safeFilename = sanitizeMediaFilename(parsed.data.filename, parsed.data.mimeType, docId);
        if (!isSafeAssetOrHttpUrl(parsed.data.url)) {
          throw new RepositoryError('INVALID_ARGUMENT', `URL média non autorisée (${docId}).`);
        }

        if (parsed.data.storagePath !== undefined) {
          // Reject any malicious, cross-workspace, wrong-asset, traversal, or unexpected-bucket storagePath,
          // and never trust the client-supplied path verbatim.
          assertValidWorkspaceMediaStoragePath(parsed.data.storagePath, workspaceId, docId, {
            allowLegacy: false,
          });
        }

        const isStaticGeneratedAsset = parsed.data.url.startsWith('/assets/images/');
        if (isStaticGeneratedAsset) {
          if (parsed.data.storagePath !== undefined) {
            throw new RepositoryError('INVALID_ARGUMENT', `Chemin de stockage inattendu pour un média statique (${docId}).`);
          }
          const staticSubPath = parsed.data.url.slice('/assets/images/'.length);
          if (!SAFE_MEDIA_FILENAME_REGEX.test(staticSubPath) || hasUnsafePathToken(staticSubPath)) {
            throw new RepositoryError('INVALID_ARGUMENT', `URL de média statique invalide (${docId}).`);
          }
        } else if (parsed.data.url !== `/api/media/${docId}`) {
          throw new RepositoryError('INVALID_ARGUMENT', `URL média incohérente pour ${docId}.`);
        }

        const authoritativeStoragePath = isStaticGeneratedAsset
          ? undefined
          : buildCanonicalWorkspaceMediaStoragePath(workspaceId, docId, safeFilename);

        const mediaDoc: MediaAsset = {
          id: docId,
          workspaceId,
          filename: safeFilename,
          mimeType: parsed.data.mimeType,
          sizeBytes: parsed.data.sizeBytes,
          url: parsed.data.url,
          ...(authoritativeStoragePath ? { storagePath: authoritativeStoragePath } : {}),
          altText: parsed.data.altText,
          uploadedBy: params.actorId,
          createdAt: parsed.data.createdAt || now,
        };
        restoredMediaMap.set(docId, mediaDoc);
        sanitizedDocs.push({
          path: `mediaAssets/${docId}`,
          colName,
          id: docId,
          data: mediaDoc as unknown as Record<string, unknown>,
        });
      } else if (colName === 'posts') {
        const parsed = backupPostSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Article invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        if (parsed.data.featuredImageUrl) {
          if (!isSafeAssetOrHttpUrl(parsed.data.featuredImageUrl)) {
            throw new RepositoryError('INVALID_ARGUMENT', `URL d’image dangereuse dans l’article ${docId}.`);
          }
          const mediaRef = extractInternalMediaId(parsed.data.featuredImageUrl);
          if (mediaRef) referencedMediaIds.add(mediaRef);
        }
        if (parsed.data.categoryId) referencedCategoryIds.add(parsed.data.categoryId);
        for (const tId of parsed.data.tagIds || []) referencedTagIds.add(tId);
        restoredPostIds.add(docId);

        const cleanPost: Post = {
          id: docId,
          workspaceId,
          authorId: parsed.data.authorId || params.actorId,
          authorName: parsed.data.authorName || params.actorEmail,
          primaryLocale: parsed.data.primaryLocale,
          // Always restore posts as draft so validation & Fongbe review gates cannot be bypassed (RED-002)
          status: 'draft',
          categoryId: parsed.data.categoryId ?? null,
          tagIds: parsed.data.tagIds || [],
          featuredImageUrl: parsed.data.featuredImageUrl || '',
          reactionLimit: parsed.data.reactionLimit ?? 1,
          allowReactionChange: parsed.data.allowReactionChange ?? true,
          reactionKeys: parsed.data.reactionKeys,
          currentVersionNumber: parsed.data.currentVersionNumber ?? 1,
          publishedVersionNumber: null,
          publishedAt: null,
          createdAt: parsed.data.createdAt || now,
          updatedAt: now,
        };
        sanitizedDocs.push({
          path: `posts/${docId}`,
          colName,
          id: docId,
          data: cleanPost as unknown as Record<string, unknown>,
        });
      } else if (colName === 'postTranslations') {
        const parsed = backupTranslationSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Traduction invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        referencedParentPostIds.add(parsed.data.postId);
        const cleanSlug = generateSlug(parsed.data.slug || parsed.data.title || parsed.data.postId);
        const parsedMd = parseMarkdownWithFrontmatter(parsed.data.markdownContent);
        const sanitizedHtml = sanitizeAndRenderMarkdown(parsedMd.body);
        const metrics = computeWordCountAndReadingTime(parsedMd.body);
        for (const bodyMediaId of extractAllInternalMediaIdsFromMarkdown(parsedMd.body)) {
          referencedMediaIds.add(bodyMediaId);
        }
        if (cleanSlug) {
          slugChecks.push({ locale: parsed.data.locale, slug: cleanSlug, postId: parsed.data.postId });
        }
        const cleanTr: PostTranslation = {
          id: docId,
          postId: parsed.data.postId,
          workspaceId,
          isPublished: false,
          locale: parsed.data.locale,
          title: parsed.data.title,
          slug: cleanSlug,
          excerpt: parsed.data.excerpt ?? extractExcerpt(parsedMd.body),
          markdownContent: parsedMd.body,
          sanitizedHtml,
          frontmatterJson: parsed.data.frontmatterJson || {},
          translationStatus: parsed.data.translationStatus || 'draft',
          linguisticNotes: parsed.data.linguisticNotes || '',
          approvedBy: parsed.data.translationStatus === 'approved' ? parsed.data.approvedBy ?? null : null,
          approvedAt: parsed.data.translationStatus === 'approved' ? parsed.data.approvedAt ?? null : null,
          wordCount: metrics.wordCount,
          readingTimeMinutes: metrics.readingTimeMinutes,
          updatedAt: now,
        };
        sanitizedDocs.push({
          path: `postTranslations/${docId}`,
          colName,
          id: docId,
          data: cleanTr as unknown as Record<string, unknown>,
        });
      } else if (colName === 'seoSettings') {
        const parsed = backupSeoSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Métadonnées SEO invalides dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        referencedParentPostIds.add(parsed.data.postId);
        if (parsed.data.canonicalUrl && !isSafeHttpUrl(parsed.data.canonicalUrl)) {
          throw new RepositoryError('INVALID_ARGUMENT', `URL canonique dangereuse dans ${docId}.`);
        }
        if (parsed.data.ogImageUrl) {
          if (!isSafeAssetOrHttpUrl(parsed.data.ogImageUrl)) {
            throw new RepositoryError('INVALID_ARGUMENT', `URL ogImage dangereuse dans ${docId}.`);
          }
          const mediaRef = extractInternalMediaId(parsed.data.ogImageUrl);
          if (mediaRef) referencedMediaIds.add(mediaRef);
        }
        const cleanSeo: SEOSetting = {
          id: docId,
          postId: parsed.data.postId,
          workspaceId,
          isPublished: false,
          locale: parsed.data.locale,
          metaTitle: (parsed.data.metaTitle || '').slice(0, 120),
          metaDescription: (parsed.data.metaDescription || '').slice(0, 320),
          canonicalUrl: (parsed.data.canonicalUrl || '').slice(0, 512),
          ogTitle: (parsed.data.ogTitle || '').slice(0, 120),
          ogDescription: (parsed.data.ogDescription || '').slice(0, 320),
          ogImageUrl: (parsed.data.ogImageUrl || '').slice(0, 512),
          twitterCardType: parsed.data.twitterCardType || 'summary_large_image',
          schemaType: parsed.data.schemaType || 'BlogPosting',
          noIndex: parsed.data.noIndex ?? false,
          updatedAt: now,
        };
        sanitizedDocs.push({
          path: `seoSettings/${docId}`,
          colName,
          id: docId,
          data: cleanSeo as unknown as Record<string, unknown>,
        });
      } else if (colName === 'postReactions') {
        const parsed = backupPostReactionSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Configuration de réaction invalide dans la sauvegarde.');
        }
        const docId = parsed.data.id;
        referencedParentPostIds.add(parsed.data.postId);
        sanitizedDocs.push({
          path: `postReactions/${docId}`,
          colName,
          id: docId,
          data: {
            id: docId,
            postId: parsed.data.postId,
            workspaceId,
            isPublished: false,
            draftRemoved: parsed.data.draftRemoved ?? false,
            semanticKey: parsed.data.semanticKey,
            emoji: parsed.data.emoji,
            labels: parsed.data.labels,
            displayOrder: parsed.data.displayOrder,
            enabled: parsed.data.enabled,
            count: parsed.data.count ?? 0,
          },
        });
      } else if (colName === 'postVersions') {
        const parsed = backupPostVersionSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Version historique invalide dans la sauvegarde.');
        }
        referencedParentPostIds.add(parsed.data.postId);
        sanitizedDocs.push({
          path: `postVersions/${parsed.data.id}`,
          colName,
          id: parsed.data.id,
          data: { ...parsed.data, workspaceId },
        });
      } else if (colName === 'publishingEvents') {
        const parsed = backupPublishingEventSchema.safeParse(rawItem);
        if (!parsed.success) {
          throw new RepositoryError('INVALID_ARGUMENT', 'Événement de publication invalide dans la sauvegarde.');
        }
        referencedParentPostIds.add(parsed.data.postId);
        sanitizedDocs.push({
          path: `publishingEvents/${parsed.data.id}`,
          colName,
          id: parsed.data.id,
          data: { ...parsed.data, workspaceId },
        });
      }
    }
  }

  // Enforce single atomic transaction size ceiling (<= 450 ops) BEFORE touching the database
  const uniqueSlugCheckMap = new Map<string, { locale: Locale; slug: string; postId: string }>();
  for (const sc of slugChecks) {
    uniqueSlugCheckMap.set(slugLockDocId(sc.locale, sc.slug), sc);
  }
  const uniqueSlugChecks = Array.from(uniqueSlugCheckMap.values());
  const totalPlannedOps = sanitizedDocs.length + uniqueSlugChecks.length;
  if (totalPlannedOps > MAX_BACKUP_RESTORE_OPS) {
    throw new RepositoryError(
      'INVALID_ARGUMENT',
      `La sauvegarde dépasse la limite transactionnelle (${totalPlannedOps}/${MAX_BACKUP_RESTORE_OPS} opérations). Divisez l’importation.`
    );
  }

  await repo.runTransaction(async (tx) => {
    const existingTargets = await Promise.all(
      sanitizedDocs.map((entry) => tx.get<{ workspaceId?: string }>(entry.path))
    );
    for (let i = 0; i < sanitizedDocs.length; i += 1) {
      const existing = existingTargets[i];
      if (existing && existing.workspaceId && existing.workspaceId !== workspaceId) {
        throw new RepositoryError(
          'PERMISSION_DENIED',
          `Collision inter-espaces détectée sur "${sanitizedDocs[i].path}". Restauration annulée.`
        );
      }
    }

    const missingPostRefs = Array.from(referencedParentPostIds).filter((id) => !restoredPostIds.has(id));
    const missingCatRefs = Array.from(referencedCategoryIds).filter((id) => !restoredCategoryIds.has(id));
    const missingTagRefs = Array.from(referencedTagIds).filter((id) => !restoredTagIds.has(id));
    const missingMediaRefs = Array.from(referencedMediaIds).filter((id) => !restoredMediaMap.has(id));

    const [postRefs, catRefs, tagRefs, mediaRefs, slugLocks] = await Promise.all([
      Promise.all(missingPostRefs.map((id) => tx.get<Post>(`posts/${id}`))),
      Promise.all(missingCatRefs.map((id) => tx.get<Category>(`categories/${id}`))),
      Promise.all(missingTagRefs.map((id) => tx.get<Tag>(`tags/${id}`))),
      Promise.all(missingMediaRefs.map((id) => tx.get<MediaAsset>(`mediaAssets/${id}`))),
      Promise.all(
        uniqueSlugChecks.map((sc) => tx.get<SlugLock>(`slugLocks/${slugLockDocId(sc.locale, sc.slug)}`))
      ),
    ]);

    for (let i = 0; i < missingPostRefs.length; i += 1) {
      const ref = postRefs[i];
      if (!ref || ref.workspaceId !== workspaceId) {
        throw new RepositoryError(
          ref ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
          `Référence d’article invalide ou inter-espaces : "${missingPostRefs[i]}".`
        );
      }
    }
    for (let i = 0; i < missingCatRefs.length; i += 1) {
      const ref = catRefs[i];
      if (!ref || ref.workspaceId !== workspaceId) {
        throw new RepositoryError(
          ref ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
          `Catégorie référencée introuvable ou inter-espaces : "${missingCatRefs[i]}".`
        );
      }
    }
    for (let i = 0; i < missingTagRefs.length; i += 1) {
      const ref = tagRefs[i];
      if (!ref || ref.workspaceId !== workspaceId) {
        throw new RepositoryError(
          ref ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
          `Étiquette référencée introuvable ou inter-espaces : "${missingTagRefs[i]}".`
        );
      }
    }
    for (let i = 0; i < missingMediaRefs.length; i += 1) {
      const ref = mediaRefs[i];
      if (!ref || ref.workspaceId !== workspaceId) {
        throw new RepositoryError(
          ref ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
          `Média référencé introuvable ou inter-espaces : "${missingMediaRefs[i]}".`
        );
      }
    }
    for (let i = 0; i < uniqueSlugChecks.length; i += 1) {
      const sc = uniqueSlugChecks[i];
      const existingLock = slugLocks[i];
      if (existingLock && existingLock.postId !== sc.postId) {
        throw new RepositoryError(
          'CONFLICT',
          `Le slug "${sc.slug}" (${sc.locale.toUpperCase()}) appartient déjà à un autre article.`
        );
      }
    }

    for (const entry of sanitizedDocs) {
      tx.set(entry.path, entry.data);
    }
    for (const sc of uniqueSlugChecks) {
      const lockId = slugLockDocId(sc.locale, sc.slug);
      tx.set(`slugLocks/${lockId}`, {
        id: lockId,
        workspaceId,
        postId: sc.postId,
        locale: sc.locale,
        slug: sc.slug,
        createdAt: now,
      });
    }
  });

  await logAudit({
    workspaceId,
    actorId: params.actorId,
    actorEmail: params.actorEmail,
    action: 'workspace.restore_backup',
    entityType: 'workspace',
    entityId: workspaceId,
    details: `${sanitizedDocs.length} documents restaurés en brouillon depuis une sauvegarde JSON.`,
  });

  return { restoredCount: sanitizedDocs.length };
}
