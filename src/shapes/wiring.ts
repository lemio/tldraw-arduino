import { Editor, TLShapeId, Vec, VecLike, atom, createShapeId } from 'tldraw'
import { HEAD, ROW, logicSize } from '../blocks/layout'
import { getLibraryDef } from '../blocks/registry'
import { createIoBlock, createLogicBlock, nextDropPoint, sendWireToBack } from './blocks'
import {
	Block,
	PortSide,
	blockPorts,
	getBlock,
	getIncomingWire,
	getOutgoingWires,
	getWireEnds,
	isBlock,
	portPagePoint,
	portTypeOf,
} from './signals'
import { bendRange } from './wireGeometry'
import { IoKind, SignalType, WIRE_TYPE, WireShape } from './types'

export interface PortRef {
	id: TLShapeId
	port: string
}

export interface WireDrag {
	wireId: TLShapeId
	/** The terminal following the pointer. */
	terminal: 'start' | 'end'
	/** Type of the port on the fixed end. */
	anchorType: SignalType
	/** The port the free end would connect to if released now. */
	candidate: PortRef | null
}

/** The wire whose function is open for editing, if any. Local to this browser. */
export const inspectedWire = atom<TLShapeId | null>('inspectedWire', null)

/** Shared with block and wire components so they can draw the snap affordances. */
export const wireDrag = atom<WireDrag | null>('wireDrag', null)

const SNAP_SCREEN_PX = 44

/** Keep a wire's bound ends glued to their ports. */
export function layoutWire(editor: Editor, wireId: TLShapeId) {
	const wire = editor.getShape(wireId) as WireShape | undefined
	if (!wire || wire.type !== WIRE_TYPE) return
	const { from, fromPort, to, toPort } = getWireEnds(editor, wire)
	const start = from ? portPagePoint(editor, from, fromPort) : new Vec(wire.x, wire.y)
	const end = to
		? portPagePoint(editor, to, toPort)
		: new Vec(wire.x + wire.props.ex, wire.y + wire.props.ey)
	setWirePoints(editor, wire, start, end)
	if (from) layoutSiblings(editor, from.id, fromPort)
}

/** Space between wires fanning out of one port. */
const LANE_GAP = 12
const BEND_STEP = LANE_GAP * (Math.SQRT2 - 1)

/**
 * With "Fan out wires" on, wires leaving the same port get their own tracks, like lines leaving a metro
 * station: ordered top to bottom by where they go, so they never cross, each
 * stepping onto its track at 45°. Their bends are staggered as well: going
 * down, the deepest wire turns first; going up, the highest. Their 45° runs
 * are then parallel instead of crossing.
 */
export function layoutSiblings(editor: Editor, sourceId: TLShapeId, port?: string) {
	if (port === undefined) {
		const ports = new Set(getOutgoingWires(editor, sourceId).map((w) => getWireEnds(editor, w).fromPort))
		for (const p of ports) layoutSiblings(editor, sourceId, p)
		return
	}
	const wires = getOutgoingWires(editor, sourceId, port)
	const want = new Map<TLShapeId, { lane: number; bend: number }>()

	// Off unless the room turned "Fan out wires" on (Preferences).
	const fanOut = editor.getDocumentSettings().meta.fanOutWires === true
	if (wires.length === 1 || !fanOut) for (const w of wires) want.set(w.id, { lane: 0, bend: -1 })
	else {
		const n = wires.length
		const tracks = [...wires]
			.sort((a, b) => a.props.ey - b.props.ey || a.props.ex - b.props.ex)
			.map((w, i) => {
				const lane = (i - (n - 1) / 2) * LANE_GAP
				const sx = Math.abs(lane)
				const dx = w.props.ex - sx
				const dy = w.props.ey - lane
				// A wire bent by hand keeps its own route.
				const range = w.props.via?.length ? null : bendRange(dx, dy)
				return { w, lane, sx, dy, range, bend: -1 }
			})
		// A bundle turning at 45° keeps its spacing only if each wire bends (√2 − 1) lanes
		// after the one outside it: then the diagonal runs are exactly one lane apart, as
		// the straight ones are. Wires part only where each turns off to its own block.
		const stagger = (group: typeof tracks) => {
			let prev = -Infinity
			for (const t of group) {
				const want = prev === -Infinity ? t.range!.natural : prev + BEND_STEP - t.sx // own coordinates
				t.bend = (t.range!.fits(want) ? want : t.range!.natural) + t.sx
				prev = t.bend
			}
		}
		stagger(tracks.filter((t) => t.range && t.dy > 0.5).sort((a, b) => b.w.props.ey - a.w.props.ey))
		stagger(tracks.filter((t) => t.range && t.dy < -0.5).sort((a, b) => a.w.props.ey - b.w.props.ey))
		for (const t of tracks) want.set(t.w.id, { lane: t.lane, bend: t.bend })
	}

	const updates = wires
		.filter((w) => {
			const v = want.get(w.id)!
			return v.lane !== w.props.lane || v.bend !== w.props.bend
		})
		.map((w) => ({ id: w.id, type: WIRE_TYPE, props: want.get(w.id)! }) as const)
	if (updates.length) editor.updateShapes(updates)
}

function setWirePoints(editor: Editor, wire: WireShape, start: VecLike, end: VecLike) {
	const ex = end.x - start.x
	const ey = end.y - start.y
	if (wire.x === start.x && wire.y === start.y && wire.props.ex === ex && wire.props.ey === ey) return
	editor.updateShape({ id: wire.id, type: WIRE_TYPE, x: start.x, y: start.y, props: { ex, ey } })
}

/** A dragged end looks for ports on the other side: an end wants an input. */
const sideFor = (terminal: 'start' | 'end'): PortSide => (terminal === 'end' ? 'in' : 'out')

export function isCompatibleTarget(drag: WireDrag, side: PortSide) {
	return side === sideFor(drag.terminal)
}

/**
 * The port nearest the pointer, within snapping distance. Dropping anywhere on
 * a block counts too ("drag one into the other"): then the port of the same
 * type wins, else the nearest, so a button dropped on a Wait lands on `start`.
 */
function findCandidate(
	editor: Editor,
	point: Vec,
	terminal: 'start' | 'end',
	exclude: TLShapeId,
	type: SignalType
): PortRef | null {
	const snap = SNAP_SCREEN_PX / editor.getZoomLevel()
	const side = sideFor(terminal)
	let best: PortRef | null = null
	let bestScore = Infinity
	for (const s of editor.getCurrentPageShapes()) {
		if (!isBlock(s) || s.id === exclude) continue
		const inside = editor.isPointInShape(s, point, { hitInside: true, margin: 0 })
		for (const p of blockPorts(s)) {
			if (p.side !== side) continue
			const d = Vec.Dist(point, portPagePoint(editor, s, p.id))
			const score = inside ? (p.type === type ? 0 : snap / 2) + Math.min(d, snap / 2 - 1) / 1000 : d
			if (score < snap && score < bestScore) {
				best = { id: s.id, port: p.id }
				bestScore = score
			}
		}
	}
	return best
}

/**
 * Start dragging a wire out of a block's port. From an output port this draws
 * a new wire; from an input port that is already fed it picks the existing wire
 * up by its end, so it can be moved elsewhere or dropped to disconnect.
 */
export function beginWireDrag(editor: Editor, block: Block, port: string, e: React.PointerEvent) {
	e.stopPropagation()
	e.preventDefault()
	const mark = editor.markHistoryStoppingPoint('wire')

	const info = blockPorts(block).find((p) => p.id === port)!
	const side = info.side
	let wireId: TLShapeId
	let terminal: 'start' | 'end'
	let isNew = false
	let anchor: PortRef = { id: block.id, port }
	let anchorType = info.type

	const existing = side === 'in' ? getIncomingWire(editor, block.id, port) : undefined
	if (existing) {
		const ends = getWireEnds(editor, existing)
		wireId = existing.id
		terminal = 'end'
		if (ends.from) {
			anchor = { id: ends.from.id, port: ends.fromPort }
			anchorType = blockPorts(ends.from).find((p) => p.id === ends.fromPort)?.type ?? anchorType
		}
		const endBinding = editor
			.getBindingsFromShape(existing, WIRE_TYPE)
			.find((b) => b.props.terminal === 'end')
		if (endBinding) editor.deleteBinding(endBinding)
	} else {
		isNew = true
		wireId = createShapeId()
		terminal = side === 'out' ? 'end' : 'start'
		const p = portPagePoint(editor, block, port)
		editor.createShape({ id: wireId, type: WIRE_TYPE, x: p.x, y: p.y, props: { ex: 0, ey: 0 } })
		sendWireToBack(editor, wireId)
		editor.createBinding({
			type: WIRE_TYPE,
			fromId: wireId,
			toId: block.id,
			props: { terminal: side === 'out' ? 'start' : 'end', port },
		})
	}

	const downScreen = new Vec(e.clientX, e.clientY)
	wireDrag.set({ wireId, terminal, anchorType, candidate: null })

	const moveFreeEnd = (point: Vec) => {
		const wire = editor.getShape(wireId) as WireShape | undefined
		if (!wire) return
		const start = terminal === 'start' ? point : new Vec(wire.x, wire.y)
		const end = terminal === 'end' ? point : new Vec(wire.x + wire.props.ex, wire.y + wire.props.ey)
		setWirePoints(editor, wire, start, end)
	}

	const onMove = (ev: PointerEvent) => {
		const point = editor.screenToPage({ x: ev.clientX, y: ev.clientY })
		const candidate = findCandidate(editor, point, terminal, anchor.id, anchorType)
		wireDrag.update((d) => d && { ...d, candidate })
		const target = candidate && getBlock(editor, candidate.id)
		moveFreeEnd(target ? portPagePoint(editor, target, candidate.port) : point)
		if (terminal === 'end') layoutSiblings(editor, anchor.id, anchor.port) // make room as it fans out
	}

	const stopListening = () => {
		window.removeEventListener('pointermove', onMove)
		window.removeEventListener('pointerup', onUp)
		window.removeEventListener('keydown', onKey)
	}

	const finish = (ev: PointerEvent) => {
		stopListening()
		const drag = wireDrag.get()
		wireDrag.set(null)
		if (!drag) return

		let target: PortRef | null = drag.candidate
		let created: TLShapeId | undefined
		const dragged = Vec.Dist(downScreen, new Vec(ev.clientX, ev.clientY)) > 24

		// Released on empty canvas after a real drag: make the block it points at.
		if (!target && dragged && isNew) {
			const point = editor.screenToPage({ x: ev.clientX, y: ev.clientY })
			const kind = matchingKind(anchorType, terminal)
			const offset = terminal === 'end' ? 116 : -116 // land the port, not the centre, under the cursor
			const id = createIoBlock(editor, kind, { x: point.x + offset, y: point.y })
			target = { id, port: '' }
			created = id
		}

		if (!target) {
			editor.deleteShape(wireId)
			return
		}
		if (terminal === 'end') {
			const old = getIncomingWire(editor, target.id, target.port)
			if (old && old.id !== wireId) {
				// A second HIGH/LOW signal into a HIGH/LOW input: combine them in a Logic block.
				const was = getWireEnds(editor, old)
				const into = getBlock(editor, target.id)
				const sameSource = was.from?.id === anchor.id && was.fromPort === anchor.port
				if (
					into &&
					was.from &&
					!sameSource &&
					anchorType === 'digital' &&
					portTypeOf(was.from, was.fromPort) === 'digital' &&
					portTypeOf(into, target.port) === 'digital'
				) {
					combineInGate(editor, old, wireId, into, target.port)
					return
				}
				editor.deleteShape(old.id)
			}
		}
		editor.createBinding({ type: WIRE_TYPE, fromId: wireId, toId: target.id, props: { terminal, port: target.port } })
		layoutWire(editor, wireId)
		if (created) {
			editor.select(created)
			editor.setEditingShape(created) // name the new block right away
		}
	}

	const onUp = (ev: PointerEvent) => finish(ev)
	const onKey = (ev: KeyboardEvent) => {
		if (ev.key !== 'Escape') return
		stopListening()
		wireDrag.set(null)
		editor.bailToMark(mark) // put everything back as it was before the drag
	}

	window.addEventListener('pointermove', onMove)
	window.addEventListener('pointerup', onUp)
	window.addEventListener('keydown', onKey)
}

/**
 * Put a Logic block (OR, to start) in front of an input that two digital wires
 * now want: the wire that was there goes to its `a`, the new one to its `b`,
 * and its output feeds the input. Change the operator on the block.
 */
function combineInGate(editor: Editor, oldWire: WireShape, newWire: TLShapeId, into: Block, port: string) {
	const def = getLibraryDef(GATE)!
	const size = logicSize(def)
	const at = portPagePoint(editor, into, port)
	// Out port level with the input, a little to its left; else the nearest free spot.
	const outY = def.layout?.ports(size.h).out ?? HEAD + ROW / 2
	const centre = nextDropPoint(editor, size, { x: at.x - 64 - size.w / 2, y: at.y - outY + size.h / 2 })
	const gate = createLogicBlock(editor, GATE, centre, { table: 0b1110 })

	const end = editor.getBindingsFromShape(oldWire, WIRE_TYPE).find((b) => b.props.terminal === 'end')
	if (end) editor.deleteBinding(end)
	editor.createBinding({ type: WIRE_TYPE, fromId: oldWire.id, toId: gate, props: { terminal: 'end', port: 'a' } })
	editor.createBinding({ type: WIRE_TYPE, fromId: newWire, toId: gate, props: { terminal: 'end', port: 'b' } })

	const out = createShapeId()
	editor.createShape({ id: out, type: WIRE_TYPE, x: at.x, y: at.y })
	sendWireToBack(editor, out)
	editor.createBindings([
		{ type: WIRE_TYPE, fromId: out, toId: gate, props: { terminal: 'start', port: 'out' } },
		{ type: WIRE_TYPE, fromId: out, toId: into.id, props: { terminal: 'end', port } },
	])
	for (const w of [oldWire.id, newWire, out]) layoutWire(editor, w)
	editor.select(gate)
}

const GATE = 'logic.gate'

/** Dragging out of a port onto nothing creates the IO block that fits its type. */
function matchingKind(type: SignalType, terminal: 'start' | 'end'): IoKind {
	if (terminal === 'end') return type === 'digital' ? 'dout' : type === 'colour' ? 'rgb' : 'aout'
	return type === 'digital' ? 'din' : 'ain'
}
