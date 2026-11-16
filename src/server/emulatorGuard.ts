import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

export const LOCAL_EMULATOR_PROJECT_ID = 'demo-ailea-postmanager-local';
export const BLOCKED_PRODUCTION_PROJECT_ID = firebaseConfig.projectId;

export interface EmulatorEnvironmentStatus {
  isEmulatorMode: boolean;
  projectId: string;
  firestoreEmulatorHost: string | undefined;
  authEmulatorHost: string | undefined;
  storageEmulatorHost: string | undefined;
}

function extractHost(hostPort: string): string {
  let cleaned = hostPort.trim().toLowerCase();
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      return new URL(cleaned).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  if (cleaned.startsWith('[')) {
    const endBracket = cleaned.indexOf(']');
    return endBracket !== -1 ? cleaned.slice(0, endBracket + 1) : '';
  }
  return cleaned.split(':')[0] || '';
}

function isLocalHostAddress(hostPort: string | undefined): boolean {
  if (!hostPort) return false;
  const host = extractHost(hostPort);
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export function isEmulatorModeRequested(): boolean {
  return (
    process.env.USE_FIREBASE_EMULATOR === 'true' ||
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.FIRESTORE_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) ||
    Boolean(process.env.FIREBASE_STORAGE_EMULATOR_HOST)
  );
}

/**
 * Enforces strict local-emulator isolation whenever emulator or test mode is active.
 * Fails closed instead of silently falling back to any remote/production Firebase project.
 */
export function assertLocalEmulatorEnvironment(options?: {
  requireAuthEmulator?: boolean;
  requireStorageEmulator?: boolean;
}): EmulatorEnvironmentStatus {
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
  const configuredProjectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || LOCAL_EMULATOR_PROJECT_ID;

  if (!firestoreHost || !isLocalHostAddress(firestoreHost)) {
    throw new Error(
      `EMULATOR_ISOLATION_ERROR: FIRESTORE_EMULATOR_HOST must point to 127.0.0.1, localhost, or [::1] (received: "${firestoreHost || 'UNSET'}"). Refusing to fall back to remote Firestore.`
    );
  }

  if (options?.requireAuthEmulator !== false && (!authHost || !isLocalHostAddress(authHost))) {
    throw new Error(
      `EMULATOR_ISOLATION_ERROR: FIREBASE_AUTH_EMULATOR_HOST must point to 127.0.0.1, localhost, or [::1] (received: "${authHost || 'UNSET'}").`
    );
  }

  if (options?.requireStorageEmulator !== false && (!storageHost || !isLocalHostAddress(storageHost))) {
    throw new Error(
      `EMULATOR_ISOLATION_ERROR: FIREBASE_STORAGE_EMULATOR_HOST must point to 127.0.0.1, localhost, or [::1] (received: "${storageHost || 'UNSET'}").`
    );
  }

  if (storageHost && !isLocalHostAddress(storageHost)) {
    throw new Error(
      `EMULATOR_ISOLATION_ERROR: FIREBASE_STORAGE_EMULATOR_HOST must point to 127.0.0.1, localhost, or [::1] (received: "${storageHost}").`
    );
  }

  if (configuredProjectId === BLOCKED_PRODUCTION_PROJECT_ID || !configuredProjectId.startsWith('demo-')) {
    throw new Error(
      `EMULATOR_ISOLATION_ERROR: Refusing to run local emulator operations with non-demo project ID "${configuredProjectId}". Use "${LOCAL_EMULATOR_PROJECT_ID}".`
    );
  }

  return {
    isEmulatorMode: true,
    projectId: configuredProjectId,
    firestoreEmulatorHost: firestoreHost,
    authEmulatorHost: authHost,
    storageEmulatorHost: storageHost,
  };
}
