import Peer, { MediaConnection } from 'peerjs'

/*
 * Camera video goes peer-to-peer over WebRTC; only the signalling uses the
 * public PeerJS broker. Whoever owns a camera (a laptop, or a phone that
 * scanned the block's QR code) registers the block's peer id and answers every
 * call with its stream. Every collaborator's canvas calls that id to watch.
 */

const PREFIX = 'mpcanvas-'

export function newCameraPeerId() {
	return PREFIX + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

/** Streams this browser is hosting, so it can show them without calling itself. */
export const localStreams = new Map<string, MediaStream>()
const listeners = new Set<() => void>()
export const onLocalStreamsChange = (fn: () => void) => {
	listeners.add(fn)
	return () => void listeners.delete(fn)
}
const emit = () => listeners.forEach((fn) => fn())

export interface Hosting {
	stop(): void
}

export function hostStream(peerId: string, stream: MediaStream, onStatus?: (s: string) => void): Hosting {
	let peer: Peer | null = null
	let stopped = false
	let retry = 0
	const calls = new Set<MediaConnection>()

	const open = () => {
		peer = new Peer(peerId)
		peer.on('open', () => onStatus?.('live'))
		peer.on('call', (call) => {
			calls.add(call)
			call.on('close', () => calls.delete(call))
			call.answer(stream)
		})
		peer.on('disconnected', () => !stopped && peer?.reconnect())
		peer.on('error', (err) => {
			onStatus?.(err.type)
			// The broker can hold on to an id for a while after a reload.
			if (err.type === 'unavailable-id' && !stopped) {
				peer?.destroy()
				retry = window.setTimeout(open, 3000)
			}
		})
	}
	open()
	localStreams.set(peerId, stream)
	emit()

	return {
		stop() {
			stopped = true
			clearTimeout(retry)
			calls.forEach((c) => c.close())
			peer?.destroy()
			stream.getTracks().forEach((t) => t.stop())
			localStreams.delete(peerId)
			emit()
		},
	}
}

/* --------------------------------------------------------------- watching */

let viewer: Promise<Peer> | null = null

function getViewer() {
	if (!viewer) {
		viewer = new Promise((resolve, reject) => {
			const p = new Peer()
			p.on('open', () => resolve(p))
			p.on('error', (e) => {
				if (e.type === 'network' || e.type === 'server-error') {
					viewer = null
					reject(e)
				}
			})
			p.on('disconnected', () => p.reconnect())
		})
	}
	return viewer
}

/** PeerJS can only call with a stream; send a 1 fps blank canvas. */
let blank: MediaStream | null = null
function blankStream() {
	if (!blank) {
		const c = document.createElement('canvas')
		c.width = c.height = 2
		blank = c.captureStream(1)
	}
	return blank
}

/** Keep calling `peerId` until it answers; re-call whenever the stream drops. */
export function watchStream(peerId: string, onStream: (s: MediaStream | null) => void) {
	let closed = false
	let call: MediaConnection | null = null
	let timer = 0

	const attempt = async () => {
		if (closed) return
		let peer: Peer
		try {
			peer = await getViewer()
		} catch {
			timer = window.setTimeout(attempt, 4000)
			return
		}
		if (closed) return
		call = peer.call(peerId, blankStream())
		let got = false
		const again = () => {
			if (closed) return
			onStream(null)
			call?.close()
			clearTimeout(timer)
			timer = window.setTimeout(attempt, 3000)
		}
		call.on('stream', (s) => {
			got = true
			onStream(s)
		})
		call.on('close', again)
		call.on('error', again)
		// No answer (camera not started yet): try again shortly.
		timer = window.setTimeout(() => !got && again(), 6000)
	}
	void attempt()

	return () => {
		closed = true
		clearTimeout(timer)
		call?.close()
	}
}

/** Whatever each camera block currently shows in this browser, for the recorder. */
export const cameraStreams = new Map<string, MediaStream>()
