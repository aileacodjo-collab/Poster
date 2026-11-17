import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { assertLocalEmulatorEnvironment, LOCAL_EMULATOR_PROJECT_ID } from '../src/server/emulatorGuard.ts';

let testEnv: RulesTestEnvironment;

function parseEmulatorHostPort(envVal: string | undefined, defaultHost: string, defaultPort: number) {
  if (!envVal) return { host: defaultHost, port: defaultPort };
  const [host, portStr] = envVal.split(':');
  return { host: host || defaultHost, port: Number(portStr || defaultPort) };
}

beforeAll(async () => {
  const status = assertLocalEmulatorEnvironment({ requireAuthEmulator: false, requireStorageEmulator: true });
  const fsHost = parseEmulatorHostPort(status.firestoreEmulatorHost, '127.0.0.1', 8080);
  const stHost = parseEmulatorHostPort(status.storageEmulatorHost, '127.0.0.1', 9199);
  const firestoreRules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const storageRules = fs.readFileSync(path.resolve(process.cwd(), 'storage.rules'), 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: LOCAL_EMULATOR_PROJECT_ID,
    firestore: {
      host: fsHost.host,
      port: fsHost.port,
      rules: firestoreRules,
    },
    storage: {
      host: stHost.host,
      port: stHost.port,
      rules: storageRules,
    },
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe('Firebase Storage Security Rules — Private-by-Default Zero-Trust (RED-025)', () => {
  it('denies all direct Client SDK reads and writes to Storage (both unauthenticated and authenticated)', async () => {
    const anonStorage = testEnv.unauthenticatedContext().storage();
    const authStorage = testEnv
      .authenticatedContext('owner_a', { email: 'owner.a@example.org', email_verified: true })
      .storage();

    const sampleBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const canonicalPath = 'workspaces/ws_a/media/med_test/cover.png';
    const legacyPath = 'workspaces/ws_a/media/med_test.png';

    await assertFails(uploadBytes(ref(anonStorage, canonicalPath), sampleBytes));
    await assertFails(getBytes(ref(anonStorage, canonicalPath)));

    await assertFails(uploadBytes(ref(authStorage, canonicalPath), sampleBytes));
    await assertFails(getBytes(ref(authStorage, canonicalPath)));

    await assertFails(uploadBytes(ref(authStorage, legacyPath), sampleBytes));
    await assertFails(getBytes(ref(authStorage, legacyPath)));
  });
});
