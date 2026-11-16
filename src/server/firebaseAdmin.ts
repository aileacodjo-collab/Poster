import { App, deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { getStorage, Storage } from 'firebase-admin/storage';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { assertLocalEmulatorEnvironment, isEmulatorModeRequested } from './emulatorGuard.ts';

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;
let cachedStorage: Storage | null = null;
let cachedDbSettingsApplied = false;

export const FIREBASE_CONFIG = firebaseConfig;

export function getAdminApp(): App {
  const emulatorRequested = isEmulatorModeRequested();

  if (emulatorRequested) {
    const status = assertLocalEmulatorEnvironment({
      requireAuthEmulator: true,
      requireStorageEmulator: true,
    });
    if (cachedApp && cachedApp.options.projectId === status.projectId) {
      return cachedApp;
    }
    const existingApps = getApps();
    const matchingApp = existingApps.find((a) => a.options.projectId === status.projectId);
    if (matchingApp) {
      cachedApp = matchingApp;
      return cachedApp;
    }
    if (existingApps.length > 0) {
      throw new Error(
        `FIREBASE_ISOLATION_ERROR: Pre-existing Firebase Admin app has mismatched projectId "${existingApps[0].options.projectId}" (expected "${status.projectId}").`
      );
    }
    cachedApp = initializeApp({
      projectId: status.projectId,
      storageBucket: `${status.projectId}.appspot.com`,
    });
    return cachedApp;
  }

  const isTestRuntime = process.env.VITEST === 'true';
  if (isTestRuntime && process.env.ALLOW_PRODUCTION_FIREBASE !== 'true') {
    throw new Error(
      'FIREBASE_ISOLATION_ERROR: Refusing to initialize production Firebase Admin SDK without USE_FIREBASE_EMULATOR=true or ALLOW_PRODUCTION_FIREBASE=true.'
    );
  }

  if (!firebaseConfig?.projectId || firebaseConfig.projectId === 'remixed-project-id') {
    throw new Error(
      'FIREBASE_ISOLATION_ERROR: Missing valid Firebase projectId in firebase-applet-config.json.'
    );
  }

  if (cachedApp) return cachedApp;
  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedApp = existingApps[0];
    return cachedApp;
  }

  cachedApp = initializeApp({
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
  });
  return cachedApp;
}

export function getAdminAuth(): Auth {
  if (isEmulatorModeRequested()) {
    assertLocalEmulatorEnvironment({ requireAuthEmulator: true, requireStorageEmulator: true });
  }
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  if (cachedDb) return cachedDb;

  const app = getAdminApp();
  let db: Firestore;

  if (isEmulatorModeRequested()) {
    assertLocalEmulatorEnvironment({ requireAuthEmulator: true, requireStorageEmulator: true });
    const emulatorDatabaseId = process.env.FIRESTORE_DATABASE_ID;
    db = emulatorDatabaseId ? getFirestore(app, emulatorDatabaseId) : getFirestore(app);
  } else {
    const dbId = firebaseConfig.firestoreDatabaseId;
    db = dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
  }

  if (!cachedDbSettingsApplied) {
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Ignore if settings were already locked by another handle
    }
    cachedDbSettingsApplied = true;
  }

  cachedDb = db;
  return cachedDb;
}

export function getAdminStorage(): Storage {
  if (cachedStorage) return cachedStorage;
  const app = getAdminApp();
  if (isEmulatorModeRequested()) {
    assertLocalEmulatorEnvironment({ requireAuthEmulator: false, requireStorageEmulator: true });
  }
  cachedStorage = getStorage(app);
  return cachedStorage;
}

export async function resetFirebaseAdminForTests(): Promise<void> {
  const apps = getApps();
  cachedApp = null;
  cachedDb = null;
  cachedStorage = null;
  cachedDbSettingsApplied = false;
  await Promise.all(apps.map((app) => deleteApp(app).catch(() => {})));
}

// Backward-compatible lazy proxy so importing `adminAuth` does not trigger eager init
export const adminAuth: Auth = new Proxy({} as Auth, {
  get(_target, prop, receiver) {
    const instance = getAdminAuth();
    const val = Reflect.get(instance, prop, receiver);
    return typeof val === 'function' ? val.bind(instance) : val;
  },
});
