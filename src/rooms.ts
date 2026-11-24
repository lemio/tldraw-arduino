import { Editor, TLStoreSnapshot, atom, getSnapshot } from 'tldraw'

/*
 * Saved rooms. A room lives on tldraw's demo sync server, which forgets it
 * after a while, so a saved room keeps its whole canvas with it: in this
 * browser, in a link, or in a file. Opening one goes back to the same room
 * (everyone with the link works together), and if the server has forgotten
 * it, the saved canvas is put back first.
 */

export interface SavedRoom {
	room: string
	name: string
	savedAt: number
	/** The canvas, compressed: see pack(). */
	data: string
}

interface Packed {
	v: 1
	room: string
	name: string
	snapshot: TLStoreSnapshot
}

const KEY = 'micropython-canvas:saved-rooms'
const RESTORE = 'micropython-canvas:restore'
export const ROOM_RE = /^[\w-]{6,64}$/

/** The room this page is in (App puts it in the address). */
export const currentRoom = () => new URLSearchParams(location.search).get('room') ?? ''

function readSaved(): SavedRoom[] {
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? '[]')
		return Array.isArray(list) ? list : []
	} catch {
		return []
	}
}

export const savedRooms = atom<SavedRoom[]>('saved rooms', readSaved())

function writeSaved(list: SavedRoom[]) {
	savedRooms.set(list)
	try {
		localStorage.setItem(KEY, JSON.stringify(list))
		return true
	} catch {
		return false // full or blocked: the link and the file still work
	}
}

/* ------------------------------------------------------------ packing */

const b64url = (bytes: Uint8Array) => {
	let s = ''
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64url = (s: string) => {
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
	return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pack(p: Packed) {
	const raw = new Blob([JSON.stringify(p)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
	return b64url(new Uint8Array(await new Response(raw).arrayBuffer()))
}

async function unpack(data: string): Promise<Packed> {
	const raw = new Blob([unb64url(data) as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
	const p = JSON.parse(await new Response(raw).text())
	if (p?.v !== 1 || !p.snapshot?.store || !ROOM_RE.test(p.room)) throw new Error('Not a saved room')
	return p
}

/* -------------------------------------------------------------- saving */

export const roomName = (editor: Editor) => editor.getDocumentSettings().name

/** Saves this room in this browser, under a name everyone in it sees. */
export async function saveRoom(editor: Editor, room: string, name: string) {
	if (name !== roomName(editor)) editor.updateDocumentSettings({ name })
	const data = await pack({ v: 1, room, name, snapshot: getSnapshot(editor.store).document })
	const saved: SavedRoom = { room, name, savedAt: Date.now(), data }
	const stored = writeSaved([saved, ...savedRooms.get().filter((s) => s.room !== room)])
	return { saved, stored }
}

export const forgetRoom = (room: string) => writeSaved(savedRooms.get().filter((s) => s.room !== room))

/** A link to the room that carries the saved canvas along. */
export function roomLink(s: Pick<SavedRoom, 'room' | 'data'>) {
	const url = new URL(location.pathname, location.origin)
	url.searchParams.set('room', s.room)
	url.hash = `canvas=${s.data}`
	return url.toString()
}

export function downloadRoom(s: SavedRoom) {
	const blob = new Blob([JSON.stringify({ format: 'micropython-canvas-room', ...s }, null, 1)], { type: 'application/json' })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = `${(s.name || 'room').replace(/[^\w\- ]+/g, '').trim() || 'room'}.room.json`
	a.click()
	setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Opens a saved room: its own room, with the saved canvas ready in case the server lost it. */
export function openRoom(s: Pick<SavedRoom, 'room' | 'data'>) {
	try {
		sessionStorage.setItem(RESTORE, JSON.stringify({ room: s.room, data: s.data }))
		location.href = `${location.pathname}?room=${encodeURIComponent(s.room)}`
	} catch {
		location.href = roomLink(s)
	}
}

/** A file from downloadRoom, opened. */
export async function openRoomFile(file: File) {
	const s = JSON.parse(await file.text())
	if (s?.format !== 'micropython-canvas-room' || typeof s.data !== 'string') throw new Error('This is not a saved room file')
	const p = await unpack(s.data)
	openRoom({ room: p.room, data: s.data })
}

/* ----------------------------------------------------------- restoring */

/** The saved canvas this page was opened with, if any: from the link, or from Open. Read once. */
export function takeRestore(room: string): string | null {
	let data: string | null = null
	const hash = new URLSearchParams(location.hash.slice(1)).get('canvas')
	if (hash) {
		data = hash
		// Keep the address short (it is what Invite copies); the canvas is in the room now.
		history.replaceState(null, '', location.pathname + location.search)
	}
	try {
		const r = JSON.parse(sessionStorage.getItem(RESTORE) ?? 'null')
		sessionStorage.removeItem(RESTORE)
		if (!data && r?.room === room) data = r.data
	} catch {
		/* nothing pending */
	}
	return data
}

/**
 * Puts a saved canvas into an empty room. A room that still has its canvas
 * is left as it is: that is the room, as the people in it left it.
 */
export async function restoreRoom(editor: Editor, data: string) {
	const p = await unpack(data)
	if (editor.getCurrentPageShapeIds().size > 0 || editor.getPages().length > 1) return false
	editor.loadSnapshot({ document: p.snapshot })
	editor.zoomToFit({ animation: { duration: 0 } })
	return true
}
