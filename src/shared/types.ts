export type Locale = 'fr' | 'en' | 'fon';

export const SUPPORTED_LOCALES: Locale[] = ['fr', 'en', 'fon'];
export const HREFLANG_LOCALES: Array<'fr' | 'en'> = ['fr', 'en'];

export type PostStatus = 'draft' | 'validated' | 'published' | 'archived';
export type TranslationStatus = 'missing' | 'draft' | 'in_review' | 'approved';
export type UserRole = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface LocalizedText {
  fr: string;
  en: string;
  fon: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  defaultLocale: Locale;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  brandName: string;
  defaultLocale: Locale;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  email?: string;
  displayName?: string;
  role: UserRole;
  invitedBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceInvite {
  id: string;
  tokenHash?: string;
  workspaceId: string;
  email: string;
  role: Exclude<UserRole, 'owner'>;
  status: InviteStatus;
  invitedBy: string;
  invitedByEmail: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedByUid?: string;
  revokedAt?: string;
}

export interface WorkspaceMembershipSummary {
  workspace: Workspace;
  role: UserRole;
}

export interface SlugLock {
  id: string;
  workspaceId: string;
  postId: string;
  locale: Locale;
  slug: string;
  createdAt: string;
}

export interface PublishedPostData {
  id: string;
  workspaceId: string;
  authorName: string;
  primaryLocale: Locale;
  status: PostStatus;
  categoryId: string | null;
  tagIds: string[];
  featuredImageUrl: string;
  reactionLimit: number;
  allowReactionChange: boolean;
  reactionKeys?: string[];
  currentVersionNumber: number;
  publishedVersionNumber: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedTranslationData {
  id: string;
  postId: string;
  workspaceId: string;
  isPublished?: boolean;
  locale: Locale;
  title: string;
  slug: string;
  excerpt: string;
  markdownContent: string;
  sanitizedHtml: string;
  frontmatterJson: Record<string, unknown>;
  translationStatus: TranslationStatus;
  wordCount: number;
  readingTimeMinutes: number;
  updatedAt: string;
}

export interface PublishedPostSnapshot {
  id: string;
  postId: string;
  workspaceId: string;
  status: 'published' | 'unpublished';
  versionNumber: number;
  post: PublishedPostData;
  translations: Record<Locale, PublishedTranslationData | null>;
  seo: Record<Locale, SEOSetting | null>;
  reactions?: PostReaction[];
  categorySnapshot?: Category | null;
  tagsSnapshot?: Tag[];
  publishedAt: string;
  updatedAt: string;
}

export interface PublishedSlugRoute {
  id: string;
  workspaceId: string;
  postId: string;
  locale: Locale;
  slug: string;
  status: 'published' | 'unpublished';
  updatedAt: string;
}

export interface Post {
  id: string;
  workspaceId: string;
  authorId?: string;
  authorName: string;
  primaryLocale: Locale;
  status: PostStatus;
  categoryId: string | null;
  tagIds: string[];
  featuredImageUrl: string;
  reactionLimit: number;
  allowReactionChange: boolean;
  reactionKeys?: string[];
  currentVersionNumber: number;
  publishedVersionNumber: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostTranslation {
  id: string;
  postId: string;
  workspaceId: string;
  isPublished?: boolean;
  locale: Locale;
  title: string;
  slug: string;
  excerpt: string;
  markdownContent: string;
  sanitizedHtml: string;
  frontmatterJson: Record<string, unknown>;
  translationStatus: TranslationStatus;
  linguisticNotes?: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  wordCount: number;
  readingTimeMinutes: number;
  updatedAt: string;
}

export interface PostVersion {
  id: string;
  postId: string;
  workspaceId: string;
  versionNumber: number;
  snapshotType: 'draft_checkpoint' | 'published_snapshot' | 'restored_snapshot';
  commitMessage: string;
  postSnapshot: Partial<Post>;
  translationsSnapshot: Record<Locale, PostTranslation | null>;
  reactionsSnapshot: PostReaction[];
  seoSnapshot: Record<Locale, SEOSetting | null>;
  createdBy: string;
  createdAt: string;
}

export interface SEOSetting {
  id: string;
  postId: string;
  workspaceId: string;
  isPublished?: boolean;
  locale: Locale;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  twitterCardType: 'summary' | 'summary_large_image';
  schemaType: 'BlogPosting' | 'Article' | 'NewsArticle';
  noIndex: boolean;
  updatedAt: string;
}

export interface ReactionPreset {
  id: string;
  workspaceId: string;
  semanticKey: string;
  emoji: string;
  labels: LocalizedText;
  displayOrder: number;
  createdAt: string;
}

export interface PostReaction {
  id: string;
  postId: string;
  workspaceId: string;
  isPublished?: boolean;
  draftRemoved?: boolean;
  semanticKey: string;
  emoji: string;
  labels: LocalizedText;
  displayOrder: number;
  enabled: boolean;
  count: number;
}

export interface ReactionEvent {
  id: string;
  postId: string;
  workspaceId: string;
  visitorHash: string;
  semanticKey: string;
  previousKey: string | null;
  locale: Locale;
  idempotencyKey: string;
  action: 'added' | 'changed' | 'removed';
  createdAt: string;
  updatedAt: string;
}

export interface PostView {
  id: string;
  postId: string;
  workspaceId: string;
  visitorHash: string;
  locale: Locale;
  referrer: string;
  isUnique: boolean;
  viewedDate: string;
  createdAt: string;
}

export interface Category {
  id: string;
  workspaceId: string;
  slug: string;
  names: LocalizedText;
  createdAt: string;
}

export interface Tag {
  id: string;
  workspaceId: string;
  slug: string;
  names: LocalizedText;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  storagePath?: string;
  altText: LocalizedText;
  uploadedBy: string;
  createdAt: string;
}

export interface PublishingEvent {
  id: string;
  postId: string;
  workspaceId: string;
  versionNumber: number;
  eventType: 'published' | 'unpublished' | 'restored';
  actorId: string;
  actorEmail: string;
  summary: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  locale?: Locale;
  field?: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface FullPostBundle {
  post: Post;
  translations: Record<Locale, PostTranslation | null>;
  reactions: PostReaction[];
  seo: Record<Locale, SEOSetting | null>;
  versions: PostVersion[];
  publishingEvents: PublishingEvent[];
}

export interface AnalyticsSummary {
  totalViews: number;
  uniqueVisitors: number;
  totalReactions: number;
  reactionChanges: number;
  engagementRate: number;
  byLocale: Record<Locale, { views: number; reactions: number }>;
  byReaction: Array<{ semanticKey: string; emoji: string; labels: LocalizedText; count: number }>;
  byReferrer: Array<{ source: string; count: number }>;
  timeline: Array<{ date: string; views: number; reactions: number }>;
  perPost: Array<{
    postId: string;
    title: string;
    slug: string;
    status: PostStatus;
    views: number;
    uniqueVisitors: number;
    reactions: number;
    reactionChanges: number;
    engagementRate: number;
  }>;
}
