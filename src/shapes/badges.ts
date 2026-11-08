import { Box, Computed, Editor, TLShapeId, Vec, computed } from 'tldraw'
import { textScale } from '../style'
import { getWireEnds, isMap, isPlainWire, isBlock, portTypeOf } from './signals'
import { CAMERA_TYPE, CLIP_TYPE, SignalType, WIRE_TYPE, WireShape } from './types'
import { pointAlong, wireRoute } from './wireGeometry'

/*
 * Where each wire's badge goes: somewhere along its own wire that is clear of
 * blocks and of the badges placed before it. The middle first, then further
 * out either way. Computed from the store alone, in a fixed order, so every
 * collaborator puts every badge in the same place.
 */

const TRIES = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.1, 0.9]
interface Spot {
	at: Vec
	/** No room for the full badge: just its words, without meter or gradient. */
	compact: boolean
}
const layouts = new WeakMap<Editor, Computed<Map<TLShapeId, Spot>>>()

function badgeLayout(editor: Editor) {
	let c = layouts.get(editor)
	if (!c) layouts.set(editor, (c = computed('badge layout', () => layout(editor))))
	return c.get()
}

/** The centre of a wire's badge, in page space. */
export function badgeSpot(editor: Editor, wire: WireShape): Vec {
	return badgeLayout(editor).get(wire.id)?.at ?? pointAlong(route(wire), 0.5)
}

export const isBadgeCompact = (editor: Editor, wire: WireShape) => badgeLayout(editor).get(wire.id)?.compact ?? false

const route = (w: WireShape) => wireRoute(w).map((p) => p.add({ x: w.x, y: w.y }))

function layout(editor: Editor) {
	const shapes = editor.getCurrentPageShapes()
	const taken: Box[] = shapes
		.filter((s) => isBlock(s) || s.type === CAMERA_TYPE || s.type === CLIP_TYPE)
		.map((s) => editor.getShapePageBounds(s)!)
		.filter(Boolean)
		.map((b) => b.clone().expandBy(4))
	const out = new Map<TLShapeId, Spot>()
	const wires = shapes.filter((s): s is WireShape => s.type === WIRE_TYPE).sort((a, b) => (a.id < b.id ? -1 : 1))
	// Badges sit on straight stretches, clear of every wire's bends: a bend stays visible, and grabbable.
	const bends = wires.flatMap((w) => route(w).slice(1, -1).map((p) => new Box(p.x - 14, p.y - 14, 28, 28)))
	for (const w of wires) {
		const ends = getWireEnds(editor, w)
		if (!ends.from || !ends.to) continue
		const src = portTypeOf(ends.from, ends.fromPort)
		const dst = portTypeOf(ends.to, ends.toPort)
		const pts = route(w)
		// The full badge where it fits; else the compact one; else whichever covers least,
		// counting a covered bend four times over (it would hide a handle).
		let pick: { box: Box; compact: boolean } | null = null
		let pickScore = Infinity
		for (const compact of [false, true]) {
			const size = badgeSize(w, src, dst, compact)
			for (const t of TRIES) {
				const c = pointAlong(pts, t)
				const box = new Box(c.x - size.w / 2, c.y - size.h / 2, size.w, size.h)
				const score = covered(box, taken) + 4 * covered(box, bends)
				if (score < pickScore) {
					pick = { box, compact }
					pickScore = score
				}
				if (score === 0) break
			}
			if (pickScore === 0) break
		}
		if (!pick) continue
		taken.push(pick.box.clone().expandBy(3))
		out.set(w.id, { at: pick.box.center, compact: pick.compact })
	}
	return out
}

/** How much of a box the others cover, in square px. */
function covered(box: Box, others: Box[]) {
	let area = 0
	for (const o of others) {
		const w = Math.min(box.maxX, o.maxX) - Math.max(box.minX, o.minX)
		const h = Math.min(box.maxY, o.maxY) - Math.max(box.minY, o.minY)
		if (w > 0 && h > 0) area += w * h
	}
	return area
}

/** Roughly how big a wire's badge draws, from what it will say. */
function badgeSize(w: WireShape, src: SignalType, dst: SignalType, compact: boolean) {
	const p = w.props
	const fs = textScale()
	if (isPlainWire(p, src, dst)) return { w: 22 * fs, h: 20 * fs }
	const parts: number[] = []
	const map = isMap(p, src, dst)
	if (map) parts.push((dst === 'colour' ? 100 : 90) + (p.curve === 'linear' ? 0 : 18))
	if (src !== 'digital' && !map) parts.push(src === 'number' ? 50 : 86)
	if (p.fn === 'toggle') parts.push(60)
	if (dst === 'digital' && p.invert) parts.push(32)
	if (dst === 'colour' && !map) parts.push(92)
	else if (dst !== 'digital' && !map) parts.push(p.lo === 0 ? 84 : 150)
	const width = parts.reduce((a, b) => a + b, 0) + Math.max(0, parts.length - 1) * 11 + 16
	return { w: width * fs * (compact ? 0.55 : 1), h: 20 * fs }
}
