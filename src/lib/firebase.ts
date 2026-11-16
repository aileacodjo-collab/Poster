import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

if (!useEmulator && (!firebaseConfig?.projectId || firebaseConfig.projectId === 'remixed-project-id')) {
  throw new Error(
    'FIREBASE_CONFIG_ERROR: Missing valid Firebase configuration in firebase-applet-config.json.'
  );
}

const app = initializeApp(
  useEmulator
    ? {
        apiKey: 'demo-local-api-key',
        authDomain: 'demo-ailea-postmanager-local.firebaseapp.com',
        projectId: 'demo-ailea-postmanager-local',
        storageBucket: 'demo-ailea-postmanager-local.appspot.com',
      }
    : firebaseConfig
);

export const auth = getAuth(app);
const databaseId = firebaseConfig.firestoreDatabaseId;
export const db = useEmulator
  ? getFirestore(app)
  : databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);
export const storage = getStorage(app);

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });
