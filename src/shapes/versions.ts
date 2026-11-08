import { Editor, TLBinding, TLParentId, TLShape, TLShapeId, atom, react } from 'tldraw'
import { getClip, playback } from './playback'
import { CAMERA_TYPE, CLIP_TYPE, IO_TYPE, LOGIC_TYPE, WIRE_TYPE } from './types'

/*
 * Every recording keeps the page it was made with, so its clips double as
 * versions: examples of how the project worked at that time.
 *
 * Scrubbing a clip whose circuit has changed since opens history mode: the
 * old page, read-only, with the recording playing through it. Nothing there
 * can be changed; Restore makes it the current version again (undoably).
 * Scrubbing a clip of the circuit as it still is stays on the live page, so a
 * threshold can still be tuned against the recording.
 */

export interface Circuit {
	/** When it was recorded, ms. */
	at: number
	shapes: TLShape[]
	bindings: TLBinding[]
}

/** Clips and cameras belong to now: they're never part of a version. */
const isVersioned = (s: TLShape) => s.type !== CLIP_TYPE && s.type !== CAMERA_TYPE

function pageContents(editor: Editor) {
	// Sorted depth-first, so a frame or group comes before what it holds.
	const shapes = editor.getCurrentPageShapesSorted().filter(isVersioned)
	const ids = new Set(shapes.map((s) => s.id))
	const bindings = new Map<string, TLBinding>()
	for (const s of shapes)
		for (const b of editor.getBindingsInvolvingShape(s.id)) if (ids.has(b.fromId) && ids.has(b.toId)) bindings.set(b.id, b)
	return { shapes, bindings: [...bindings.values()] }
}

export function snapshotCircuit(editor: Editor) {
	return JSON.stringify({ at: Date.now(), ...pageContents(editor) } satisfies Circuit)
}

export function readCircuit(json: string): Circuit | null {
	try {
		return json ? (JSON.parse(json) as Circuit) : null
	} catch {
		return null
	}
}

/**
 * What makes the circuit behave as it does: blocks, their pins and settings,
 * wires, their functions and ends. Not names, positions, live values or
 * drawings, which don't change what happens.
 */
function signature(shapes: TLShape[], bindings: TLBinding[]) {
	const parts: string[] = []
	for (const s of shapes) {
		const p = s.props as Record<string, unknown>
		if (s.type === IO_TYPE) parts.push(`io ${s.id} ${p.kind} ${p.pin} ${p.pull} ${p.unit}`)
		else if (s.type === LOGIC_TYPE) parts.push(`logic ${s.id} ${p.def} ${JSON.stringify(p.params)} ${JSON.stringify(p.custom)}`)
		else if (s.type === WIRE_TYPE) {
			const { fn, edge, threshold, invert, inLo, inHi, lo, hi, loColour, hiColour, curve, gamma } = p
			parts.push(`wire ${s.id} ${JSON.stringify([fn, edge, threshold, invert, inLo, inHi, lo, hi, loColour, hiColour, curve, gamma])}`)
		}
	}
	for (const b of bindings) {
		if (b.type !== WIRE_TYPE) continue
		const p = b.props as unknown as Record<string, unknown>
		parts.push(`end ${b.fromId} ${p.terminal} ${b.toId} ${p.port ?? ''}`)
	}
	return parts.sort().join('\n')
}

export function differsFromNow(editor: Editor, circuit: Circuit) {
	const now = pageContents(editor)
	return signature(circuit.shapes, circuit.bindings) !== signature(now.shapes, now.bindings)
}

/** The version being looked at, while in history mode. */
export const historyMode = atom<{ clipId: TLShapeId; circuit: Circuit } | null>('historyMode', null)

/**
 * Decide once, when a clip starts being scrubbed: history mode if its circuit
 * has changed since. (Deciding on every edit would flip a tuning session into
 * history the moment a threshold moved.)
 */
export function watchHistory(editor: Editor) {
	let current: TLShapeId | null = null
	return react('history mode', () => {
		const clipId = playback.get()?.clipId ?? null
		if (clipId === current) return
		current = clipId
		const clip = clipId && getClip(editor, clipId)
		const circuit = clip ? readCircuit(clip.props.circuit) : null
		historyMode.set(clipId && circuit && differsFromNow(editor, circuit) ? { clipId, circuit } : null)
	})
}

/** Put a version's shapes on a page: top-level shapes onto `page`. */
export function versionShapes(circuit: Circuit, page: TLParentId) {
	return circuit.shapes.map((s) => (s.parentId.startsWith('page:') ? { ...s, parentId: page } : s))
}

/** Make a version the current one: the page's shapes (not clips or cameras) become the recorded ones. */
export function restoreVersion(editor: Editor, circuit: Circuit) {
	editor.markHistoryStoppingPoint('restore version')
	editor.run(() => {
		const now = editor.getCurrentPageShapesSorted().filter(isVersioned)
		editor.deleteShapes(now.map((s) => s.id))
		editor.createShapes(versionShapes(circuit, editor.getCurrentPageId()))
		editor.createBindings(circuit.bindings)
	})
	historyMode.set(null)
}
