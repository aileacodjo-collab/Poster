import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  assertLocalEmulatorEnvironment,
  BLOCKED_PRODUCTION_PROJECT_ID,
  LOCAL_EMULATOR_PROJECT_ID,
} from '../src/server/emulatorGuard.ts';
import { getAdminDb, resetFirebaseAdminForTests } from '../src/server/firebaseAdmin.ts';
import { FirestoreRepository } from '../src/server/firestoreRepo.ts';
import { RepositoryError } from '../src/server/repository.ts';

async function clearEmulatorCollections(collections: string[]) {
  const db = getAdminDb();
  for (const colName of collections) {
    const snap = await db.collection(colName).get();
    for (const d of snap.docs) {
      // Delete subcollections for workspaces
      if (colName === 'workspaces') {
        const members = await d.ref.collection('members').get();
        for (const m of members.docs) await m.ref.delete();
        const invites = await d.ref.collection('invites').get();
        for (const inv of invites.docs) await inv.ref.delete();
      }
      await d.ref.delete();
    }
  }
}

describe('FirestoreRepository & Emulator Isolation — Local Emulator Suite', () => {
  let repo: FirestoreRepository;

  beforeAll(() => {
    assertLocalEmulatorEnvironment({ requireAuthEmulator: false, requireStorageEmulator: false });
    repo = new FirestoreRepository();
  });

  beforeEach(async () => {
    await clearEmulatorCollections(['workspaces', 'workspaceSlugLocks', 'posts', 'categories', 'slugLocks']);
  });

  afterAll(async () => {
    await resetFirebaseAdminForTests();
  });

  it('connects strictly to the local emulator and never uses production project ID', async () => {
    const status = assertLocalEmulatorEnvironment({ requireAuthEmulator: false, requireStorageEmulator: false });
    expect(status.isEmulatorMode).toBe(true);
    expect(status.projectId).toBe(LOCAL_EMULATOR_PROJECT_ID);
    expect(status.projectId).not.toBe(BLOCKED_PRODUCTION_PROJECT_ID);

    await expect(repo.ping()).resolves.toBeUndefined();
  });

  it('fails closed when emulator host is missing, non-local, or production project ID is configured', async () => {
    const prevHost = process.env.FIRESTORE_EMULATOR_HOST;
    const prevAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const prevProj = process.env.FIREBASE_PROJECT_ID;

    try {
      delete process.env.FIRESTORE_EMULATOR_HOST;
      expect(() => assertLocalEmulatorEnvironment()).toThrow(/EMULATOR_ISOLATION_ERROR/);

      process.env.FIRESTORE_EMULATOR_HOST = 'firestore.googleapis.com:443';
      expect(() => assertLocalEmulatorEnvironment()).toThrow(/EMULATOR_ISOLATION_ERROR/);

      process.env.FIRESTORE_EMULATOR_HOST = prevHost;
      process.env.FIREBASE_PROJECT_ID = BLOCKED_PRODUCTION_PROJECT_ID;
      expect(() => assertLocalEmulatorEnvironment()).toThrow(/EMULATOR_ISOLATION_ERROR/);
    } finally {
      if (prevHost) process.env.FIRESTORE_EMULATOR_HOST = prevHost;
      if (prevAuth) process.env.FIREBASE_AUTH_EMULATOR_HOST = prevAuth;
      if (prevProj) process.env.FIREBASE_PROJECT_ID = prevProj;
      else delete process.env.FIREBASE_PROJECT_ID;
    }
  });

  it('fails with typed UNAVAILABLE error (no fallback) when emulator port is unreachable', async () => {
    const prevHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:59999';
    const deadApp = initializeApp({ projectId: 'demo-unreachable-test' }, 'dead-emulator-app');
    const deadDb = getFirestore(deadApp);
    const deadRepo = new FirestoreRepository(() => deadDb);

    try {
      await expect(deadRepo.ping(600)).rejects.toMatchObject({
        name: 'RepositoryError',
        code: 'UNAVAILABLE',
        httpStatus: 503,
      });
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = prevHost;
      await deleteApp(deadApp);
    }
  });

  it('enforces create-if-absent deterministic IDs, workspace isolation, and transactional rollback', async () => {
    const now = '2026-11-15T12:00:00.000Z';

    await repo.create('categories/ws_1_cat', {
      id: 'ws_1_cat',
      workspaceId: 'ws_1',
      slug: 'cat',
      createdAt: now,
    });

    // Duplicate deterministic create throws ALREADY_EXISTS
    await expect(
      repo.create('categories/ws_1_cat', {
        id: 'ws_1_cat',
        workspaceId: 'ws_1',
        slug: 'cat',
        createdAt: now,
      })
    ).rejects.toMatchObject({
      code: 'ALREADY_EXISTS',
      httpStatus: 409,
    });

    // Cross-workspace scoped read throws PERMISSION_DENIED
    const allowed = await repo.getWorkspaceScoped<{ id: string; workspaceId: string }>(
      'categories',
      'ws_1_cat',
      'ws_1'
    );
    expect(allowed?.id).toBe('ws_1_cat');

    await expect(
      repo.getWorkspaceScoped<{ id: string; workspaceId: string }>('categories', 'ws_1_cat', 'ws_2')
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      httpStatus: 403,
    });

    // Transaction rollback leaves state untouched on error
    await expect(
      repo.runTransaction(async (tx) => {
        tx.set('categories/ws_1_tx_temp', {
          id: 'ws_1_tx_temp',
          workspaceId: 'ws_1',
          slug: 'tx-temp',
          createdAt: now,
        });
        throw new RepositoryError('CONFLICT', 'Simulated abort');
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const rolledBack = await repo.get('categories/ws_1_tx_temp');
    expect(rolledBack).toBeNull();
  });

  it('creates workspace and owner member atomically via createWorkspaceWithOwner', async () => {
    const now = '2026-11-15T12:00:00.000Z';
    await repo.createWorkspaceWithOwner({
      workspace: {
        id: 'ws_atomic_1',
        name: 'Atomic WS',
        slug: 'atomic-ws',
        ownerId: 'uid_owner_1',
        brandName: 'AILEA Atomic',
        defaultLocale: 'fr',
        baseUrl: 'http://127.0.0.1:3000',
        createdAt: now,
        updatedAt: now,
      },
      ownerMember: {
        id: 'uid_owner_1',
        workspaceId: 'ws_atomic_1',
        userId: 'uid_owner_1',
        email: 'owner@example.org',
        displayName: 'Owner',
        role: 'owner',
        createdAt: now,
      },
    });

    const ws = await repo.get<{ ownerId: string }>('workspaces/ws_atomic_1');
    const mem = await repo.get<{ role: string }>('workspaces/ws_atomic_1/members/uid_owner_1');
    expect(ws?.ownerId).toBe('uid_owner_1');
    expect(mem?.role).toBe('owner');
  });

  it('handles IPv6 [::1] emulator hosts, rejects non-demo project IDs, and fails closed in getAdminApp (RED-006, RED-020)', async () => {
    const prevFs = process.env.FIRESTORE_EMULATOR_HOST;
    const prevAuth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const prevStorage = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    const prevProj = process.env.FIREBASE_PROJECT_ID;
    const prevUseEmu = process.env.USE_FIREBASE_EMULATOR;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowProd = process.env.ALLOW_PRODUCTION_FIREBASE;

    try {
      process.env.FIRESTORE_EMULATOR_HOST = '[::1]:8080';
      process.env.FIREBASE_AUTH_EMULATOR_HOST = '[::1]:9099';
      process.env.FIREBASE_STORAGE_EMULATOR_HOST = '[::1]:9199';
      process.env.FIREBASE_PROJECT_ID = 'demo-ipv6-test';
      const ipv6Status = assertLocalEmulatorEnvironment({ requireAuthEmulator: true, requireStorageEmulator: true });
      expect(ipv6Status.projectId).toBe('demo-ipv6-test');

      process.env.FIREBASE_PROJECT_ID = 'arbitrary-non-demo-project';
      expect(() => assertLocalEmulatorEnvironment()).toThrow(/EMULATOR_ISOLATION_ERROR/);

      const { getAdminApp } = await import('../src/server/firebaseAdmin.ts');
      await resetFirebaseAdminForTests();
      delete process.env.FIRESTORE_EMULATOR_HOST;
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      delete process.env.USE_FIREBASE_EMULATOR;
      delete process.env.ALLOW_PRODUCTION_FIREBASE;
      process.env.NODE_ENV = 'production';
      expect(() => getAdminApp()).toThrow(/FIREBASE_ISOLATION_ERROR/);
    } finally {
      if (prevFs) process.env.FIRESTORE_EMULATOR_HOST = prevFs;
      else delete process.env.FIRESTORE_EMULATOR_HOST;
      if (prevAuth) process.env.FIREBASE_AUTH_EMULATOR_HOST = prevAuth;
      else delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      if (prevStorage) process.env.FIREBASE_STORAGE_EMULATOR_HOST = prevStorage;
      else delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      if (prevProj) process.env.FIREBASE_PROJECT_ID = prevProj;
      else delete process.env.FIREBASE_PROJECT_ID;
      if (prevUseEmu) process.env.USE_FIREBASE_EMULATOR = prevUseEmu;
      else delete process.env.USE_FIREBASE_EMULATOR;
      if (prevAllowProd) process.env.ALLOW_PRODUCTION_FIREBASE = prevAllowProd;
      else delete process.env.ALLOW_PRODUCTION_FIREBASE;
      process.env.NODE_ENV = prevNodeEnv;
      await resetFirebaseAdminForTests();
    }
  });

  it('enforces distributed rate-limiting via rateLimitBuckets in Firestore (RED-019)', async () => {
    const { consumeDistributedRateLimit } = await import('../src/server/security.ts');
    const bucketKey = `test_dist_${Date.now()}`;
    expect((await consumeDistributedRateLimit(repo, bucketKey, 2, 60_000)).allowed).toBe(true);
    expect((await consumeDistributedRateLimit(repo, bucketKey, 2, 60_000)).allowed).toBe(true);
    const blocked = await consumeDistributedRateLimit(repo, bucketKey, 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
