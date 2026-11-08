import { Editor, TLShapeId, atom } from 'tldraw'
import { CLIP_TYPE, ClipChannel, ClipShape, SignalType, signalType } from './types'

/*
 * Scrubbing is local: each person can look at a different moment of a clip
 * without moving anyone else's canvas.
 */
export const playback = atom<{ clipId: TLShapeId; t: number } | null>('playback', null)

/* Channels travel in the store as 8 bits per sample, base64: a minute at
 * 20 Hz is 1.6 kB per block. 8 bits is finer than a sparkline can show.
 * A colour keeps its own three bytes, R G B, per sample; a number (a count,
 * seconds left) a 32-bit float, since it has no 0..1 range to scale to. */

type Encoding = 'level' | 'colour' | 'number'
const encodingOf = (type: SignalType): Encoding => (type === 'colour' ? 'colour' : type === 'number' ? 'number' : 'level')

export function encodeSeries(values: ArrayLike<number>, type: SignalType = 'analog') {
	const enc = encodingOf(type)
	if (enc === 'number') return toBase64(new Uint8Array(Float32Array.from(values).buffer))
	const colour = enc === 'colour'
	const bytes = new Uint8Array(values.length * (colour ? 3 : 1))
	for (let i = 0; i < values.length; i++) {
		if (colour) {
			const c = Math.round(values[i]) & 0xffffff
			bytes[i * 3] = c >> 16
			bytes[i * 3 + 1] = (c >> 8) & 255
			bytes[i * 3 + 2] = c & 255
		} else bytes[i] = Math.round(Math.min(1, Math.max(0, values[i])) * 255)
	}
	return toBase64(bytes)
}

function toBase64(bytes: Uint8Array) {
	let bin = ''
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
	return btoa(bin)
}

const decoded = new Map<string, Float32Array>()

export function decodeSeries(data: string, type: SignalType = 'analog') {
	const enc = encodingOf(type)
	const key = enc[0] + ':' + data
	let out = decoded.get(key)
	if (!out) {
		const bin = atob(data)
		if (enc === 'number') {
			const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
			out = new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4))
		} else if (enc === 'colour') {
			// 24-bit colours are exact in a Float32Array (24-bit mantissa).
			out = new Float32Array(Math.floor(bin.length / 3))
			for (let i = 0; i < out.length; i++)
				out[i] = (bin.charCodeAt(i * 3) << 16) | (bin.charCodeAt(i * 3 + 1) << 8) | bin.charCodeAt(i * 3 + 2)
		} else {
			out = new Float32Array(bin.length)
			for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) / 255
		}
		if (decoded.size > 64) decoded.clear()
		decoded.set(key, out)
	}
	return out
}

export const channelType = (ch: ClipChannel) => ch.type ?? (ch.kind ? signalType(ch.kind) : 'analog')
export const isColourChannel = (ch: ClipChannel) => channelType(ch) === 'colour'

/** Which group a channel shows in: inputs, the steps in between, or outputs. */
export const channelRole = (ch: ClipChannel) => ch.role ?? (ch.kind === 'din' || ch.kind === 'ain' ? 'in' : 'out')

export function getClip(editor: Editor, id: TLShapeId) {
	const s = editor.getShape(id)
	return s?.type === CLIP_TYPE ? (s as ClipShape) : undefined
}

export function channelSeries(clip: ClipShape, blockId: TLShapeId, port?: string) {
	const ch = clip.props.channels.find((c) => c.id === blockId && (port === undefined || (c.port ?? '') === port))
	return ch ? decodeSeries(ch.data, channelType(ch)) : undefined
}

const indexAt = (clip: ClipShape, n: number, t: number) =>
	Math.max(0, Math.min(n - 1, Math.round(t * clip.props.hz)))

/** A block's recorded value at `t` seconds into a clip, if the clip has that block. */
export function recordedValue(editor: Editor, clipId: TLShapeId, blockId: TLShapeId, t: number, port?: string) {
	const clip = getClip(editor, clipId)
	const s = clip && channelSeries(clip, blockId, port)
	return s && s.length ? s[indexAt(clip, s.length, t)] : undefined
}

/** Everything a block recorded from the start of the clip up to `t`. */
export function recordedSeries(editor: Editor, clipId: TLShapeId, blockId: TLShapeId, t: number, port?: string) {
	const clip = getClip(editor, clipId)
	const s = clip && channelSeries(clip, blockId, port)
	return s && s.length ? s.subarray(0, indexAt(clip, s.length, t) + 1) : undefined
}
