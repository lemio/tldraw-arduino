import { FirebaseApp, initializeApp } from 'firebase/app'
import { FirebaseStorage, getStorage } from 'firebase/storage'

/*
 * The Firebase project behind the canvas: Cloud Storage keeps the images and
 * videos placed on it. The config comes from the environment, not the
 * repository: .env.local on a computer, the repository's Actions secrets when
 * GitHub builds the site. What anyone may do with it is decided by the
 * security rules (storage.rules).
 */
const env = import.meta.env
const firebaseConfig = {
	apiKey: env.VITE_FIREBASE_API_KEY,
	authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: env.VITE_FIREBASE_APP_ID,
}

/** False when the site was built without the config: the canvas works, uploads don't. */
export const firebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.storageBucket && firebaseConfig.appId)

export const firebaseApp: FirebaseApp | null = firebaseConfigured ? initializeApp(firebaseConfig) : null
export const storage: FirebaseStorage | null = firebaseApp && getStorage(firebaseApp)
