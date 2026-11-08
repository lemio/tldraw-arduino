/*
 * Clip video stays on the computer that recorded it, in IndexedDB: the shared
 * canvas carries only the signals. Small on purpose (see recorder.ts).
 */

const DB = 'micropython-canvas'
const STORE = 'clip-video'

function db() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB, 1)
		req.onupgradeneeded = () => req.result.createObjectStore(STORE)
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
	const d = await db()
	return new Promise<T>((resolve, reject) => {
		const req = fn(d.transaction(STORE, mode).objectStore(STORE))
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

export const saveVideo = (key: string, blob: Blob) => run('readwrite', (s) => s.put(blob, key))
export const loadVideo = (key: string) => run<Blob | undefined>('readonly', (s) => s.get(key)).catch(() => undefined)
