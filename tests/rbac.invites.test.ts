import http from 'node:http';
import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLocalEmulatorEnvironment } from '../src/server/emulatorGuard.ts';
import { getAdminAuth, getAdminDb, resetFirebaseAdminForTests } from '../src/server/firebaseAdmin.ts';

let server: http.Server;
let baseUrl = '';

async function clearAllAuthAndFirestore() {
  const auth = getAdminAuth();
  const list = await auth.listUsers(1000);
  if (list.users.length > 0) {
    await auth.deleteUsers(list.users.map((u) => u.uid));
  }

  const db = getAdminDb();
  const cols = [
    'users',
    'workspaces',
    'workspaceSlugLocks',
    'posts',
    'postTranslations',
    'postVersions',
    'publishedPosts',
    'publishedSlugRoutes',
    'slugLocks',
    'seoSettings',
    'reactionPresets',
    'postReactions',
    'categories',
    'tags',
    'mediaAssets',
    'publishingEvents',
    'auditLogs',
    'postViews',
    'visitorDailyViews',
    'reactionEvents',
    'visitorReactionStates',
    'reactionIdempotency',
    'rateLimitBuckets',
  ];
  for (const col of cols) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) {
      if (col === 'workspaces') {
        const members = await d.ref.collection('members').get();
        for (const m of members.docs) await m.ref.delete();
        const invites = await d.ref.collection('invites').get();
        for (const inv of invites.docs) await inv.ref.delete();
        const inviteLocks = await d.ref.collection('inviteLocks').get();
        for (const lock of inviteLocks.docs) await lock.ref.delete();
      }
      await d.ref.delete();
    }
  }
  const dailySnap = await db.collection('dailyAnalytics').get();
  for (const d of dailySnap.docs) {
    const shards = await d.ref.collection('shards').get();
    for (const s of shards.docs) await s.ref.delete();
    await d.ref.delete();
  }
}

async function createEmulatedUserAndGetToken(params: {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}): Promise<{ uid: string; email: string; idToken: string }> {
  const auth = getAdminAuth();
  const password = 'LocalTestPassword!2026';
  await auth.createUser({
    uid: params.uid,
    email: params.email,
    password,
    displayName: params.displayName || params.email.split('@')[0],
    emailVerified: params.emailVerified,
  });

  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const resp = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-local-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        password,
        returnSecureToken: true,
      }),
    }
  );
  if (!resp.ok) {
    throw new Error(`Auth emulator sign-in failed (${resp.status}): ${await resp.text()}`);
  }
  const data = (await resp.json()) as { idToken: string; localId: string };
  return { uid: data.localId, email: params.email, idToken: data.idToken };
}

async function apiJson<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; token?: string; workspaceId?: string; body?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.workspaceId) headers['X-Workspace-Id'] = options.workspaceId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

describe('RBAC, Firebase Auth Verification & Hardened Phase 1 Workflows — Emulator Integration', () => {
  const prevNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    assertLocalEmulatorEnvironment({ requireAuthEmulator: true, requireStorageEmulator: true });
    process.env.NODE_ENV = 'production';
    const { createApp } = await import('../server.ts');
    const app = await createApp();
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(async () => {
    await clearAllAuthAndFirestore();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    process.env.NODE_ENV = prevNodeEnv;
    await resetFirebaseAdminForTests();
  });

  it('rejects missing, malformed, unverified, and revoked Firebase ID tokens (RED-005)', async () => {
    const missing = await apiJson('/api/admin/posts');
    expect(missing.status).toBe(401);

    const malformed = await apiJson('/api/admin/posts', { token: 'not.a.valid.jwt' });
    expect(malformed.status).toBe(401);

    const unverified = await createEmulatedUserAndGetToken({
      uid: 'uid_unverified',
      email: 'unverified@example.org',
      emailVerified: false,
    });
    const unverifiedRes = await apiJson('/api/admin/bootstrap', {
      method: 'POST',
      token: unverified.idToken,
    });
    expect(unverifiedRes.status).toBe(403);

    const revokedUser = await createEmulatedUserAndGetToken({
      uid: 'uid_revoked',
      email: 'revoked@example.org',
      emailVerified: true,
    });
    const beforeRevoke = await apiJson('/api/admin/bootstrap', {
      method: 'POST',
      token: revokedUser.idToken,
    });
    expect(beforeRevoke.status).toBe(200);

    // Wait >1s BEFORE revokeRefreshTokens so tokensValidAfterTime (rounded to seconds) is strictly > token auth_time
    await new Promise((r) => setTimeout(r, 1150));
    await getAdminAuth().revokeRefreshTokens(revokedUser.uid);

    const afterRevoke = await apiJson('/api/admin/posts', { token: revokedUser.idToken });
    expect(afterRevoke.status).toBe(401);
  });

  it('rejects client-supplied X-Workspace-Id, handles concurrent bootstrap, and enforces cross-workspace isolation (RED-015)', async () => {
    const ownerA = await createEmulatedUserAndGetToken({
      uid: 'uid_owner_a',
      email: 'owner.a@example.org',
      emailVerified: true,
    });
    const ownerB = await createEmulatedUserAndGetToken({
      uid: 'uid_owner_b',
      email: 'owner.b@example.org',
      emailVerified: true,
    });

    // Concurrent bootstrap calls for the same first-time user both succeed (RED-015)
    const [bootA1, bootA2] = await Promise.all([
      apiJson<{ workspace: { id: string }; posts: Array<{ post: { id: string } }> }>('/api/admin/bootstrap', {
        method: 'POST',
        token: ownerA.idToken,
      }),
      apiJson<{ workspace: { id: string }; posts: Array<{ post: { id: string } }> }>('/api/admin/bootstrap', {
        method: 'POST',
        token: ownerA.idToken,
      }),
    ]);
    expect(bootA1.status).toBe(200);
    expect(bootA2.status).toBe(200);
    const wsAId = bootA1.data.workspace.id;
    const postAId = bootA1.data.posts[0].post.id;

    const bootB = await apiJson<{ workspace: { id: string } }>('/api/admin/bootstrap', {
      method: 'POST',
      token: ownerB.idToken,
    });
    expect(bootB.status).toBe(200);
    const wsBId = bootB.data.workspace.id;

    // Owner B cannot spoof X-Workspace-Id pointing to Workspace A
    expect((await apiJson('/api/admin/posts', { token: ownerB.idToken, workspaceId: wsAId })).status).toBe(403);
    expect(
      (await apiJson('/api/admin/bootstrap', { method: 'POST', token: ownerB.idToken, workspaceId: wsAId })).status
    ).toBe(403);

    // Owner B cannot read/patch Workspace A's post
    expect((await apiJson(`/api/admin/posts/${postAId}`, { token: ownerB.idToken, workspaceId: wsBId })).status).toBe(403);
    expect(
      (
        await apiJson(`/api/admin/posts/${postAId}`, {
          method: 'PATCH',
          token: ownerB.idToken,
          workspaceId: wsBId,
          body: { reactionLimit: 5 },
        })
      ).status
    ).toBe(403);

    // Backup restore rejects cross-workspace document IDs & forces drafts (RED-002)
    const crossBackup = await apiJson('/api/admin/backup/restore', {
      method: 'POST',
      token: ownerB.idToken,
      workspaceId: wsBId,
      body: {
        schemaVersion: '1.0.0',
        posts: [
          {
            id: postAId,
            primaryLocale: 'fr',
            status: 'published',
          },
        ],
      },
    });
    expect(crossBackup.status).toBe(403);

    const draftForceBackup = await apiJson<{ restoredCount: number }>('/api/admin/backup/restore', {
      method: 'POST',
      token: ownerB.idToken,
      workspaceId: wsBId,
      body: {
        schemaVersion: '1.0.0',
        posts: [
          {
            id: 'post_restored_safe',
            primaryLocale: 'fr',
            status: 'published',
          },
        ],
      },
    });
    expect(draftForceBackup.status).toBe(200);
    const restoredPost = await getAdminDb().doc('posts/post_restored_safe').get();
    expect(restoredPost.data()?.status).toBe('draft');
  });

  it('implements single-use SHA-256 hashed invites without duplicate pending invites or status oracle (RED-016, RED-023)', async () => {
    const owner = await createEmulatedUserAndGetToken({
      uid: 'uid_ws_owner',
      email: 'owner@example.org',
      emailVerified: true,
    });
    const bootOwner = await apiJson<{ workspace: { id: string } }>('/api/admin/bootstrap', {
      method: 'POST',
      token: owner.idToken,
    });
    const wsId = bootOwner.data.workspace.id;

    // 1. Issue invite — tokenHash must NOT be returned in API response; opaque id is returned
    const inviteRes = await apiJson<{ invite: { id: string; tokenHash?: string; status: string }; rawToken: string }>(
      '/api/admin/invites',
      {
        method: 'POST',
        token: owner.idToken,
        workspaceId: wsId,
        body: { email: 'editor@example.org', role: 'editor' },
      }
    );
    expect(inviteRes.status).toBe(201);
    const { rawToken, invite } = inviteRes.data;
    expect(invite.tokenHash).toBeUndefined();
    expect(invite.id.startsWith('inv_')).toBe(true);
    const expectedHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const storedInvite = await getAdminDb().doc(`workspaces/${wsId}/invites/${expectedHash}`).get();
    expect(storedInvite.exists).toBe(true);

    // Duplicate active pending invite for same email returns 409 (RED-016)
    const dupInvite = await apiJson('/api/admin/invites', {
      method: 'POST',
      token: owner.idToken,
      workspaceId: wsId,
      body: { email: 'editor@example.org', role: 'reviewer' },
    });
    expect(dupInvite.status).toBe(409);

    // Wrong email attempting valid token -> 403 and no orphaned user profile created (RED-023)
    const wrongUser = await createEmulatedUserAndGetToken({
      uid: 'uid_wrong_user',
      email: 'intruder@example.org',
      emailVerified: true,
    });
    const mismatchAccept = await apiJson('/api/admin/invites/accept', {
      method: 'POST',
      token: wrongUser.idToken,
      body: { workspaceId: wsId, token: rawToken },
    });
    expect(mismatchAccept.status).toBe(403);
    expect((await getAdminDb().doc(`users/${wrongUser.uid}`).get()).exists).toBe(false);

    // Concurrent redemption race for legitimate invitee -> strictly one 200 and one 409
    const editorUser = await createEmulatedUserAndGetToken({
      uid: 'uid_editor_real',
      email: 'editor@example.org',
      emailVerified: true,
    });
    const [race1, race2] = await Promise.all([
      apiJson('/api/admin/invites/accept', {
        method: 'POST',
        token: editorUser.idToken,
        body: { workspaceId: wsId, token: rawToken },
      }),
      apiJson('/api/admin/invites/accept', {
        method: 'POST',
        token: editorUser.idToken,
        body: { workspaceId: wsId, token: rawToken },
      }),
    ]);
    expect([race1.status, race2.status].sort()).toEqual([200, 409]);

    // Wrong email on ALREADY ACCEPTED invite still returns generic 403 email mismatch, never status oracle (RED-023)
    const oracleProbe = await apiJson('/api/admin/invites/accept', {
      method: 'POST',
      token: wrongUser.idToken,
      body: { workspaceId: wsId, token: rawToken },
    });
    expect(oracleProbe.status).toBe(403);

    // Expired & revoked invites (revoked via opaque invite.id)
    const expRes = await apiJson<{ invite: { id: string }; rawToken: string }>('/api/admin/invites', {
      method: 'POST',
      token: owner.idToken,
      workspaceId: wsId,
      body: { email: 'expired@example.org', role: 'viewer' },
    });
    const expHash = crypto.createHash('sha256').update(expRes.data.rawToken).digest('hex');
    await getAdminDb()
      .doc(`workspaces/${wsId}/invites/${expHash}`)
      .update({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const expiredUser = await createEmulatedUserAndGetToken({
      uid: 'uid_expired_user',
      email: 'expired@example.org',
      emailVerified: true,
    });
    expect(
      (
        await apiJson('/api/admin/invites/accept', {
          method: 'POST',
          token: expiredUser.idToken,
          body: { workspaceId: wsId, token: expRes.data.rawToken },
        })
      ).status
    ).toBe(409);

    const revRes = await apiJson<{ invite: { id: string }; rawToken: string }>('/api/admin/invites', {
      method: 'POST',
      token: owner.idToken,
      workspaceId: wsId,
      body: { email: 'revoked.invitee@example.org', role: 'reviewer' },
    });
    expect(
      (
        await apiJson(`/api/admin/invites/${revRes.data.invite.id}`, {
          method: 'DELETE',
          token: owner.idToken,
          workspaceId: wsId,
        })
      ).status
    ).toBe(200);
    const revokedInvitee = await createEmulatedUserAndGetToken({
      uid: 'uid_revoked_invitee',
      email: 'revoked.invitee@example.org',
      emailVerified: true,
    });
    expect(
      (
        await apiJson('/api/admin/invites/accept', {
          method: 'POST',
          token: revokedInvitee.idToken,
          body: { workspaceId: wsId, token: revRes.data.rawToken },
        })
      ).status
    ).toBe(403);
  });

  it('enforces RBAC, blocks editor self-approval of Fongbe (RED-007), isolates snapshots (RED-001), enforces global slugs (RED-003), and streams media via Storage (RED-011)', async () => {
    const owner = await createEmulatedUserAndGetToken({
      uid: 'uid_rbac_owner',
      email: 'rbac.owner@example.org',
      emailVerified: true,
    });
    const otherOwner = await createEmulatedUserAndGetToken({
      uid: 'uid_other_owner',
      email: 'other.owner@example.org',
      emailVerified: true,
    });
    const editor = await createEmulatedUserAndGetToken({
      uid: 'uid_rbac_editor',
      email: 'rbac.editor@example.org',
      emailVerified: true,
    });
    const reviewer = await createEmulatedUserAndGetToken({
      uid: 'uid_rbac_reviewer',
      email: 'rbac.reviewer@example.org',
      emailVerified: true,
    });
    const viewer = await createEmulatedUserAndGetToken({
      uid: 'uid_rbac_viewer',
      email: 'rbac.viewer@example.org',
      emailVerified: true,
    });

    const boot = await apiJson<{ workspace: { id: string } }>('/api/admin/bootstrap', {
      method: 'POST',
      token: owner.idToken,
    });
    const wsId = boot.data.workspace.id;

    const bootOther = await apiJson<{ workspace: { id: string } }>('/api/admin/bootstrap', {
      method: 'POST',
      token: otherOwner.idToken,
    });
    const otherWsId = bootOther.data.workspace.id;

    for (const member of [
      { user: editor, role: 'editor' },
      { user: reviewer, role: 'reviewer' },
      { user: viewer, role: 'viewer' },
    ]) {
      const inv = await apiJson<{ rawToken: string }>('/api/admin/invites', {
        method: 'POST',
        token: owner.idToken,
        workspaceId: wsId,
        body: { email: member.user.email, role: member.role },
      });
      await apiJson('/api/admin/invites/accept', {
        method: 'POST',
        token: member.user.idToken,
        body: { workspaceId: wsId, token: inv.data.rawToken },
      });
    }

    // Create post as editor
    const createdPost = await apiJson<{ bundle: { post: { id: string } } }>('/api/admin/posts', {
      method: 'POST',
      token: editor.idToken,
      workspaceId: wsId,
      body: {
        title: 'Article Multilingue Global',
        slug: 'global-unique-article',
        primaryLocale: 'fr',
        markdownContent: '---\ntitle: Test YAML\n---\n\n## Contenu publié initialement\n\nParagraphe assez long pour passer la validation.',
      },
    });
    expect(createdPost.status).toBe(201);
    const postId = createdPost.data.bundle.post.id;

    // Cross-tenant global slug collision (RED-003): another workspace cannot claim 'global-unique-article'
    const otherCollision = await apiJson('/api/admin/posts', {
      method: 'POST',
      token: otherOwner.idToken,
      workspaceId: otherWsId,
      body: { title: 'Hijack', slug: 'global-unique-article', primaryLocale: 'fr' },
    });
    expect(otherCollision.status).toBe(409);

    // Editor CANNOT approve Fongbe (RED-007) -> 403
    const editorFonApprove = await apiJson(`/api/admin/posts/${postId}/translations/fon`, {
      method: 'PUT',
      token: editor.idToken,
      workspaceId: wsId,
      body: {
        title: 'Wěmá yɔ̌yɔ́',
        slug: 'wema-yoyo-global',
        markdownContent: '## Xó ɖò Fɔngbè mɛ kpódó wěkwín gànjí kpán',
        translationStatus: 'approved',
      },
    });
    expect(editorFonApprove.status).toBe(403);

    // Reviewer CAN approve Fongbe (200)
    const reviewerFonApprove = await apiJson(`/api/admin/posts/${postId}/translations/fon`, {
      method: 'PUT',
      token: reviewer.idToken,
      workspaceId: wsId,
      body: {
        title: 'Wěmá yɔ̌yɔ́',
        slug: 'wema-yoyo-global',
        markdownContent: '---\nnote: hidden frontmatter\n---\n\n## Xó ɖò Fɔngbè mɛ kpódó wěkwín gànjí kpán',
        linguisticNotes: 'INTERNAL REVIEWER NOTE - DO NOT LEAK',
        translationStatus: 'approved',
      },
    });
    expect(reviewerFonApprove.status).toBe(200);
    // YAML frontmatter must be stripped before sanitizedHtml (RED-021)
    expect((reviewerFonApprove.data as { translation: { sanitizedHtml: string } }).translation.sanitizedHtml).not.toContain('note: hidden frontmatter');

    // Publish v1
    const pubRes = await apiJson(`/api/admin/posts/${postId}/publish`, {
      method: 'POST',
      token: editor.idToken,
      workspaceId: wsId,
    });
    expect(pubRes.status).toBe(200);

    // Edit draft FR translation WITHOUT republishing -> public API & SSR must still show v1 (RED-001)
    const draftEdit = await apiJson(`/api/admin/posts/${postId}/translations/fr`, {
      method: 'PUT',
      token: editor.idToken,
      workspaceId: wsId,
      body: {
        title: 'BROUILLON NON PUBLIÉ',
        slug: 'global-unique-article',
        markdownContent: '## Nouveau texte brouillon secret qui ne doit pas fuiter publiquement.',
        translationStatus: 'draft',
      },
    });
    expect(draftEdit.status).toBe(200);

    const publicApiRes = await apiJson<{
      workspace: Record<string, unknown>;
      post: Record<string, unknown>;
      translation: Record<string, unknown>;
    }>('/api/public/posts/fr/global-unique-article');
    expect(publicApiRes.status).toBe(200);
    expect(publicApiRes.data.translation.title).toBe('Article Multilingue Global');
    expect(JSON.stringify(publicApiRes.data)).not.toContain('BROUILLON NON PUBLIÉ');
    // Verify internal fields stripped (RED-013)
    expect(publicApiRes.data.workspace.ownerId).toBeUndefined();
    expect(publicApiRes.data.post.authorId).toBeUndefined();

    const fonPublicApi = await apiJson<{ translation: Record<string, unknown> }>('/api/public/posts/fon/wema-yoyo-global');
    expect(fonPublicApi.status).toBe(200);
    expect(fonPublicApi.data.translation.approvedBy).toBeUndefined();
    expect(fonPublicApi.data.translation.linguisticNotes).toBeUndefined();

    // Legacy route redirects 301 to canonical /p/:locale/:slug (RED-014)
    const redirectRes = await fetch(`${baseUrl}/fr/global-unique-article`, { redirect: 'manual' });
    expect(redirectRes.status).toBe(301);
    expect(redirectRes.headers.get('location')).toBe('/p/fr/global-unique-article');

    // Route param validation (RED-012) & member delete 404 (RED-024)
    expect((await apiJson('/api/admin/members/nonexistent_uid', { method: 'DELETE', token: owner.idToken, workspaceId: wsId })).status).toBe(404);
    expect((await apiJson('/api/admin/posts/bad..id', { token: owner.idToken, workspaceId: wsId })).status).toBe(400);

    // RBAC on auditLogs and viewer member email redaction (AUDIT-009)
    expect((await apiJson('/api/admin/audit-logs', { token: viewer.idToken, workspaceId: wsId })).status).toBe(403);
    expect((await apiJson('/api/admin/audit-logs', { token: reviewer.idToken, workspaceId: wsId })).status).toBe(403);
    expect((await apiJson('/api/admin/audit-logs', { token: editor.idToken, workspaceId: wsId })).status).toBe(200);

    const viewerMembers = await apiJson<{ members: Array<{ userId: string; email?: string }> }>('/api/admin/members', {
      token: viewer.idToken,
      workspaceId: wsId,
    });
    expect(viewerMembers.status).toBe(200);
    expect(viewerMembers.data.members.find((m) => m.userId === owner.uid)?.email).toBeUndefined();
    expect(viewerMembers.data.members.find((m) => m.userId === viewer.uid)?.email).toBe(viewer.email);

    // Media upload via Firebase Storage + Express streaming (draft auth required; published media public)
    const validPngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64');
    const uploadRes = await apiJson<{ asset: { id: string; url: string; storagePath: string } }>('/api/admin/media/upload', {
      method: 'POST',
      token: editor.idToken,
      workspaceId: wsId,
      body: {
        filename: 'test.png',
        mimeType: 'image/png',
        base64Data: validPngBase64,
        altText: { fr: 'Test FR', en: 'Test EN', fon: 'Test FON' },
      },
    });
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.data.asset.url).toBe(`/api/media/${uploadRes.data.asset.id}`);
    expect(uploadRes.data.asset.storagePath).toBe(
      `workspaces/${wsId}/media/${uploadRes.data.asset.id}/test.png`
    );

    // Draft/unreferenced media must deny anonymous & cross-workspace requests
    expect((await fetch(`${baseUrl}${uploadRes.data.asset.url}`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}${uploadRes.data.asset.url}`, {
          headers: { Authorization: `Bearer ${otherOwner.idToken}` },
        })
      ).status
    ).toBe(403);

    const streamRes = await fetch(`${baseUrl}${uploadRes.data.asset.url}`, {
      headers: { Authorization: `Bearer ${editor.idToken}` },
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('image/png');
    expect(streamRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(streamRes.headers.get('cache-control')).toBe('private, no-store');

    const delMediaRes = await apiJson(`/api/admin/media/${uploadRes.data.asset.id}`, {
      method: 'DELETE',
      token: editor.idToken,
      workspaceId: wsId,
    });
    expect(delMediaRes.status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}${uploadRes.data.asset.url}`, {
          headers: { Authorization: `Bearer ${editor.idToken}` },
        })
      ).status
    ).toBe(404);
  });
});
