import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { assertLocalEmulatorEnvironment, LOCAL_EMULATOR_PROJECT_ID } from '../src/server/emulatorGuard.ts';

let testEnv: RulesTestEnvironment;

function parseEmulatorHostPort(envVal: string | undefined, defaultHost: string, defaultPort: number) {
  if (!envVal) return { host: defaultHost, port: defaultPort };
  const [host, portStr] = envVal.split(':');
  return { host: host || defaultHost, port: Number(portStr || defaultPort) };
}

beforeAll(async () => {
  const status = assertLocalEmulatorEnvironment({ requireAuthEmulator: false });
  const { host, port } = parseEmulatorHostPort(status.firestoreEmulatorHost, '127.0.0.1', 8080);
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: LOCAL_EMULATOR_PROJECT_ID,
    firestore: {
      host,
      port,
      rules,
    },
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = '2026-11-15T12:00:00.000Z';

    // Workspace A & Members
    await setDoc(doc(db, 'workspaces/ws_a'), {
      id: 'ws_a',
      name: 'Workspace A',
      slug: 'workspace-a',
      ownerId: 'owner_a',
      brandName: 'AILEA A',
      defaultLocale: 'fr',
      baseUrl: 'http://127.0.0.1:3000',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'workspaces/ws_a/members/owner_a'), {
      id: 'owner_a',
      workspaceId: 'ws_a',
      userId: 'owner_a',
      email: 'owner.a@example.org',
      role: 'owner',
      createdAt: now,
    });
    await setDoc(doc(db, 'workspaces/ws_a/members/editor_a'), {
      id: 'editor_a',
      workspaceId: 'ws_a',
      userId: 'editor_a',
      email: 'editor.a@example.org',
      role: 'editor',
      createdAt: now,
    });
    await setDoc(doc(db, 'workspaces/ws_a/members/reviewer_a'), {
      id: 'reviewer_a',
      workspaceId: 'ws_a',
      userId: 'reviewer_a',
      email: 'reviewer.a@example.org',
      role: 'reviewer',
      createdAt: now,
    });
    await setDoc(doc(db, 'workspaces/ws_a/members/viewer_a'), {
      id: 'viewer_a',
      workspaceId: 'ws_a',
      userId: 'viewer_a',
      email: 'viewer.a@example.org',
      role: 'viewer',
      createdAt: now,
    });

    // Workspace B
    await setDoc(doc(db, 'workspaces/ws_b'), {
      id: 'ws_b',
      name: 'Workspace B',
      slug: 'workspace-b',
      ownerId: 'owner_b',
      brandName: 'AILEA B',
      defaultLocale: 'fr',
      baseUrl: 'http://127.0.0.1:3000',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'workspaces/ws_b/members/owner_b'), {
      id: 'owner_b',
      workspaceId: 'ws_b',
      userId: 'owner_b',
      email: 'owner.b@example.org',
      role: 'owner',
      createdAt: now,
    });

    // Draft & Published posts in Workspace A (authoring drafts stay strictly member-only)
    await setDoc(doc(db, 'posts/post_draft_a'), {
      id: 'post_draft_a',
      workspaceId: 'ws_a',
      authorId: 'owner_a',
      primaryLocale: 'fr',
      status: 'draft',
      reactionLimit: 1,
      allowReactionChange: true,
      currentVersionNumber: 1,
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'postTranslations/post_draft_a_fr'), {
      id: 'post_draft_a_fr',
      postId: 'post_draft_a',
      workspaceId: 'ws_a',
      isPublished: false,
      locale: 'fr',
      title: 'Brouillon secret',
      slug: 'brouillon-secret',
      markdownContent: '# Secret',
      translationStatus: 'draft',
      updatedAt: now,
    });
    await setDoc(doc(db, 'postTranslations/post_pub_a_fon'), {
      id: 'post_pub_a_fon',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      isPublished: true,
      locale: 'fon',
      title: 'Brouillon Fongbe non approuvé',
      slug: 'brouillon-fongbe',
      markdownContent: '# Draft Fon',
      translationStatus: 'draft',
      updatedAt: now,
    });

    await setDoc(doc(db, 'posts/post_pub_a'), {
      id: 'post_pub_a',
      workspaceId: 'ws_a',
      authorId: 'owner_a',
      primaryLocale: 'fr',
      status: 'published',
      reactionLimit: 1,
      allowReactionChange: true,
      currentVersionNumber: 1,
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'postTranslations/post_pub_a_fr'), {
      id: 'post_pub_a_fr',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      isPublished: true,
      locale: 'fr',
      title: 'Article public',
      slug: 'article-public',
      markdownContent: '# Public',
      translationStatus: 'approved',
      updatedAt: now,
    });
    await setDoc(doc(db, 'publishedPosts/post_pub_a'), {
      id: 'post_pub_a',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      status: 'published',
      versionNumber: 1,
      publishedAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'publishedSlugRoutes/fr_article-public'), {
      id: 'fr_article-public',
      workspaceId: 'ws_a',
      postId: 'post_pub_a',
      locale: 'fr',
      slug: 'article-public',
      status: 'published',
      updatedAt: now,
    });
    await setDoc(doc(db, 'postReactions/post_pub_a_curiosity'), {
      id: 'post_pub_a_curiosity',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      isPublished: true,
      semanticKey: 'curiosity',
      emoji: '👀',
      displayOrder: 0,
      enabled: true,
      count: 3,
    });

    // Server-only & sensitive workspace documents
    await setDoc(doc(db, 'workspaces/ws_a/invites/hash123'), {
      id: 'hash123',
      tokenHash: 'hash123',
      workspaceId: 'ws_a',
      email: 'invitee@example.org',
      role: 'editor',
      status: 'pending',
      invitedBy: 'owner_a',
      expiresAt: '2026-11-18T12:00:00.000Z',
      createdAt: now,
    });
    await setDoc(doc(db, 'postVersions/post_pub_a_v1'), {
      id: 'post_pub_a_v1',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      versionNumber: 1,
      snapshotType: 'published_snapshot',
      createdBy: 'owner_a',
      createdAt: now,
    });
    await setDoc(doc(db, 'publishingEvents/pub_1'), {
      id: 'pub_1',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      versionNumber: 1,
      eventType: 'published',
      actorId: 'owner_a',
      createdAt: now,
    });
    await setDoc(doc(db, 'auditLogs/aud_1'), {
      id: 'aud_1',
      workspaceId: 'ws_a',
      actorId: 'owner_a',
      action: 'post.publish',
      entityType: 'post',
      entityId: 'post_pub_a',
      createdAt: now,
    });
    await setDoc(doc(db, 'visitorReactionStates/post_pub_a_vh1'), {
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      visitorHash: 'vh1',
      activeKeys: ['curiosity'],
      updatedAt: now,
    });
    await setDoc(doc(db, 'postViews/view_1'), {
      id: 'view_1',
      postId: 'post_pub_a',
      workspaceId: 'ws_a',
      visitorHash: 'vh1',
      locale: 'fr',
      isUnique: true,
      viewedDate: '2026-11-15',
      createdAt: now,
    });
    await setDoc(doc(db, 'categories/ws_a_culture'), {
      id: 'ws_a_culture',
      workspaceId: 'ws_a',
      slug: 'culture',
      createdAt: now,
    });
    await setDoc(doc(db, 'users/owner_a'), {
      uid: 'owner_a',
      email: 'owner.a@example.org',
      displayName: 'Owner A',
      role: 'owner',
      defaultLocale: 'fr',
      createdAt: now,
      updatedAt: now,
    });
  });
});

describe('Firestore Security Rules — Zero-Trust, Zero-Bypass Authoring, RBAC & Query List Rules', () => {
  it('enforces default-deny for anonymous users including published snapshots, authoring drafts, PII, and analytics (AUDIT-003)', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();

    // Denied reads for anonymous Client SDK users (public SSR & APIs are Express Admin SDK mediated)
    await assertFails(getDoc(doc(anonDb, 'publishedPosts/post_pub_a')));
    await assertFails(getDoc(doc(anonDb, 'publishedSlugRoutes/fr_article-public')));
    await assertFails(getDoc(doc(anonDb, 'postReactions/post_pub_a_curiosity')));

    // Denied reads: authoring posts/translations, workspaces, members, invites, PII, analytics
    await assertFails(getDoc(doc(anonDb, 'posts/post_pub_a')));
    await assertFails(getDoc(doc(anonDb, 'postTranslations/post_pub_a_fr')));
    await assertFails(getDoc(doc(anonDb, 'postTranslations/post_pub_a_fon')));
    await assertFails(getDoc(doc(anonDb, 'posts/post_draft_a')));
    await assertFails(getDoc(doc(anonDb, 'postTranslations/post_draft_a_fr')));
    await assertFails(getDoc(doc(anonDb, 'workspaces/ws_a')));
    await assertFails(getDoc(doc(anonDb, 'workspaces/ws_a/members/owner_a')));
    await assertFails(getDoc(doc(anonDb, 'workspaces/ws_a/invites/hash123')));
    await assertFails(getDoc(doc(anonDb, 'users/owner_a')));
    await assertFails(getDoc(doc(anonDb, 'postVersions/post_pub_a_v1')));
    await assertFails(getDoc(doc(anonDb, 'auditLogs/aud_1')));
    await assertFails(getDoc(doc(anonDb, 'visitorReactionStates/post_pub_a_vh1')));
    await assertFails(getDoc(doc(anonDb, 'postViews/view_1')));
    await assertFails(getDoc(doc(anonDb, 'categories/ws_a_culture')));
  });

  it('rejects authenticated users whose email is not verified', async () => {
    const unverifiedDb = testEnv
      .authenticatedContext('editor_a', { email: 'editor.a@example.org', email_verified: false })
      .firestore();

    await assertFails(getDoc(doc(unverifiedDb, 'workspaces/ws_a')));
    await assertFails(getDoc(doc(unverifiedDb, 'posts/post_draft_a')));
    await assertFails(
      setDoc(doc(unverifiedDb, 'categories/ws_a_new'), {
        id: 'ws_a_new',
        workspaceId: 'ws_a',
        slug: 'new',
        createdAt: '2026-11-15T12:00:00.000Z',
      })
    );
  });

  it('enforces strict cross-workspace isolation against verified non-members', async () => {
    const ownerBDb = testEnv
      .authenticatedContext('owner_b', { email: 'owner.b@example.org', email_verified: true })
      .firestore();

    await assertFails(getDoc(doc(ownerBDb, 'workspaces/ws_a')));
    await assertFails(getDoc(doc(ownerBDb, 'workspaces/ws_a/members/owner_a')));
    await assertFails(getDoc(doc(ownerBDb, 'posts/post_draft_a')));
    await assertFails(getDoc(doc(ownerBDb, 'postVersions/post_pub_a_v1')));
    await assertFails(getDoc(doc(ownerBDb, 'auditLogs/aud_1')));
    await assertFails(deleteDoc(doc(ownerBDb, 'posts/post_draft_a')));
  });

  it('enforces server-mediated zero-bypass writes on authoring collections while permitting workspace member reads (RED-004, RED-009)', async () => {
    const viewerDb = testEnv
      .authenticatedContext('viewer_a', { email: 'viewer.a@example.org', email_verified: true })
      .firestore();
    const reviewerDb = testEnv
      .authenticatedContext('reviewer_a', { email: 'reviewer.a@example.org', email_verified: true })
      .firestore();
    const editorDb = testEnv
      .authenticatedContext('editor_a', { email: 'editor.a@example.org', email_verified: true })
      .firestore();
    const ownerDb = testEnv
      .authenticatedContext('owner_a', { email: 'owner.a@example.org', email_verified: true })
      .firestore();

    const now = '2026-11-15T12:30:00.000Z';

    // Workspace members CAN read authoring workspace docs via get, while auditLogs are owner/editor only
    await assertSucceeds(getDoc(doc(viewerDb, 'posts/post_draft_a')));
    await assertFails(getDoc(doc(viewerDb, 'auditLogs/aud_1')));
    await assertFails(getDoc(doc(reviewerDb, 'auditLogs/aud_1')));
    await assertSucceeds(getDoc(doc(editorDb, 'auditLogs/aud_1')));
    await assertSucceeds(getDoc(doc(ownerDb, 'auditLogs/aud_1')));
    await assertSucceeds(getDoc(doc(reviewerDb, 'postTranslations/post_draft_a_fr')));

    // Zero-bypass: EVEN owner/editor/reviewer cannot bypass server validation, Fongbe gate, DOMPurify, or slugLocks via Client SDK
    await assertFails(
      setDoc(doc(editorDb, 'posts/post_editor_new'), {
        id: 'post_editor_new',
        workspaceId: 'ws_a',
        authorId: 'editor_a',
        primaryLocale: 'fr',
        status: 'published',
        reactionLimit: 1,
        allowReactionChange: true,
        currentVersionNumber: 1,
        createdAt: now,
        updatedAt: now,
      })
    );
    await assertFails(
      updateDoc(doc(editorDb, 'postTranslations/post_pub_a_fon'), {
        translationStatus: 'approved',
        updatedAt: now,
      })
    );
    await assertFails(
      updateDoc(doc(reviewerDb, 'postTranslations/post_draft_a_fr'), {
        translationStatus: 'approved',
        updatedAt: now,
      })
    );
    await assertFails(updateDoc(doc(ownerDb, 'workspaces/ws_a'), { name: 'Updated Direct', updatedAt: now }));
    await assertFails(
      setDoc(doc(editorDb, 'categories/ws_a_bad'), {
        id: 'ws_a_bad',
        workspaceId: 'ws_a',
        slug: 'bad',
        createdAt: now,
      })
    );
  });

  it('denies direct client allow list queries across server-mediated collections and allows owner-only workspace listing', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const viewerDb = testEnv
      .authenticatedContext('viewer_a', { email: 'viewer.a@example.org', email_verified: true })
      .firestore();
    const ownerDb = testEnv
      .authenticatedContext('owner_a', { email: 'owner.a@example.org', email_verified: true })
      .firestore();

    // Anonymous list denied across all collections
    await assertFails(getDocs(query(collection(anonDb, 'publishedPosts'), where('status', '==', 'published'))));
    await assertFails(getDocs(query(collection(anonDb, 'publishedSlugRoutes'), where('status', '==', 'published'))));
    await assertFails(getDocs(query(collection(anonDb, 'postReactions'), where('isPublished', '==', true))));
    await assertFails(getDocs(query(collection(anonDb, 'posts'), where('workspaceId', '==', 'ws_a'))));
    await assertFails(getDocs(query(collection(anonDb, 'postTranslations'), where('isPublished', '==', true))));
    await assertFails(getDocs(collection(anonDb, 'users')));

    // Owner-scoped workspace list succeeds cleanly without lookup inside rule
    await assertSucceeds(getDocs(query(collection(ownerDb, 'workspaces'), where('ownerId', '==', 'owner_a'))));
    await assertFails(getDocs(query(collection(viewerDb, 'workspaces'), where('ownerId', '==', 'owner_a'))));

    // Direct list on authoring/audit/member collections is server-mediated
    await assertFails(getDocs(query(collection(viewerDb, 'posts'), where('workspaceId', '==', 'ws_a'))));
    await assertFails(getDocs(query(collection(ownerDb, 'auditLogs'), where('workspaceId', '==', 'ws_a'))));
    await assertFails(getDocs(collection(viewerDb, 'workspaces/ws_a/members')));
    await assertFails(getDocs(collection(ownerDb, 'workspaceSlugLocks')));
    await assertFails(getDocs(collection(ownerDb, 'workspaces/ws_a/inviteLocks')));
  });

  it('prevents role self-escalation on users and direct client writes on protected collections', async () => {
    const editorDb = testEnv
      .authenticatedContext('editor_a', { email: 'editor.a@example.org', email_verified: true })
      .firestore();
    const ownerDb = testEnv
      .authenticatedContext('owner_a', { email: 'owner.a@example.org', email_verified: true })
      .firestore();

    await assertFails(updateDoc(doc(ownerDb, 'users/owner_a'), { role: 'editor' }));
    await assertFails(
      setDoc(doc(editorDb, 'users/editor_a'), {
        uid: 'editor_a',
        email: 'editor.a@example.org',
        role: 'owner',
        defaultLocale: 'fr',
        createdAt: '2026-11-15T12:00:00.000Z',
      })
    );

    await assertFails(getDoc(doc(ownerDb, 'workspaces/ws_a/invites/hash123')));
    await assertFails(updateDoc(doc(ownerDb, 'postReactions/post_pub_a_curiosity'), { count: 999 }));
    await assertFails(deleteDoc(doc(ownerDb, 'auditLogs/aud_1')));
    await assertFails(deleteDoc(doc(ownerDb, 'postVersions/post_pub_a_v1')));
  });
});
