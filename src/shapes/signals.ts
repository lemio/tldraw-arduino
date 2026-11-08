import { Editor, TLShapeId, TLShapePartial, Vec } from 'tldraw'
import { logicTier, portYs } from '../blocks/layout'
import { getDef } from '../blocks/registry'
import { playback, recordedSeries, recordedValue } from './playback'
import {
	Curve,
	Edge,
	IO_TYPE,
	IoKind,
	IoShape,
	KIND_INFO,
	LOGIC_TYPE,
	LogicShape,
	SignalType,
	WIRE_TYPE,
	WireShape,
	WireShapeProps,
	isInput,
	signalType,
} from './types'

/*
 * The signal graph lives entirely in the tldraw store. IO blocks carry the
 * board's readings and their puppeteered values; logic blocks carry the
 * outputs their MicroPython last produced; wires carry a transfer function.
 * Everything here is a pure read, so calling it inside useValue / react()
 * updates the caller whenever anything upstream changes, for every
 * collaborator alike.
 *
 * Ports are addressed by (block, port id). An IO block has one port, ''.
 *
 * While a recording is being scrubbed, IO inputs read from the recording
 * instead (unless `live` is asked for), and outputs show what today's wiring
 * would have done with yesterday's signals.
 */

export type Block = IoShape | LogicShape

export const isBlock = (s: { type: string } | undefined): s is Block => s?.type === IO_TYPE || s?.type === LOGIC_TYPE

export const getBlock = (editor: Editor, id: TLShapeId) => {
	const s = editor.getShape(id)
	return isBlock(s) ? s : undefined
}

export const getIo = (editor: Editor, id: TLShapeId) => {
	const s = editor.getShape(id)
	return s && s.type === IO_TYPE ? (s as IoShape) : undefined
}

/* ----------------------------------------------------------------- ports */

/** Which edge a port is on: inputs on the left, outputs on the right. */
export type PortSide = 'in' | 'out'

export interface PortInfo {
	id: string
	side: PortSide
	type: SignalType
	label: string
	unit?: string
	default?: number
	/** Position on the block, in its own coordinates. */
	local: Vec
}

export const portSide = (kind: IoKind): PortSide => (isInput(kind) ? 'out' : 'in')

export function blockPorts(block: Block): PortInfo[] {
	const { w, h } = block.props
	if (block.type === IO_TYPE) {
		const side = portSide(block.props.kind)
		return [
			{
				id: '',
				side,
				type: signalType(block.props.kind),
				label: '',
				local: new Vec(side === 'out' ? w : 0, h / 2),
			},
		]
	}
	const def = getDef(block)
	const tier = logicTier(def, h)
	const inYs = portYs(def.inputs.length, h, tier)
	const outYs = portYs(def.outputs.length, h, tier)
	const own = def.layout?.ports(h) ?? {}
	return [
		...def.inputs.map((p, i) => ({
			id: p.id,
			side: 'in' as const,
			type: p.type,
			label: p.label ?? p.id,
			unit: p.unit,
			default: p.default,
			local: new Vec(0, own[p.id] ?? inYs[i]),
		})),
		...def.outputs.map((p, i) => ({
			id: p.id,
			side: 'out' as const,
			type: p.type,
			label: p.label ?? p.id,
			unit: p.unit,
			local: new Vec(w, own[p.id] ?? outYs[i]),
		})),
	]
}

export function getPort(block: Block, port: string, side?: PortSide) {
	return blockPorts(block).find((p) => p.id === port && (!side || p.side === side))
}

export function portPagePoint(editor: Editor, block: Block, port = '') {
	const p = getPort(block, port) ?? blockPorts(block)[0]
	return editor.getShapePageTransform(block).applyToPoint(p?.local ?? new Vec(0, block.props.h / 2))
}

/* ----------------------------------------------------------------- wires */

/** The blocks and ports on both ends of a wire. */
export function getWireEnds(editor: Editor, wire: WireShape | TLShapeId) {
	let from: Block | undefined
	let to: Block | undefined
	let fromPort = ''
	let toPort = ''
	for (const b of editor.getBindingsFromShape(wire, WIRE_TYPE)) {
		const block = getBlock(editor, b.toId)
		if (b.props.terminal === 'start') {
			from = block
			fromPort = b.props.port ?? ''
		} else {
			to = block
			toPort = b.props.port ?? ''
		}
	}
	return { from, fromPort, to, toPort }
}

/** The single wire feeding an input port, if any. */
export function getIncomingWire(editor: Editor, blockId: TLShapeId, port = ''): WireShape | undefined {
	for (const b of editor.getBindingsToShape(blockId, WIRE_TYPE)) {
		if (b.props.terminal === 'end' && (b.props.port ?? '') === port) {
			return editor.getShape(b.fromId) as WireShape | undefined
		}
	}
	return undefined
}

/** Wires leaving a block; from one port, or from all when `port` is undefined. */
export function getOutgoingWires(editor: Editor, blockId: TLShapeId, port?: string): WireShape[] {
	return editor
		.getBindingsToShape(blockId, WIRE_TYPE)
		.filter((b) => b.props.terminal === 'start' && (port === undefined || (b.props.port ?? '') === port))
		.map((b) => editor.getShape(b.fromId) as WireShape)
		.filter(Boolean)
}

export function portTypeOf(block: Block | undefined, port: string): SignalType {
	if (!block) return 'analog'
	return getPort(block, port)?.type ?? 'analog'
}

/* ------------------------------------------------------- transfer function */

type P = Pick<
	WireShapeProps,
	'fn' | 'edge' | 'threshold' | 'invert' | 'inLo' | 'inHi' | 'lo' | 'hi' | 'loColour' | 'hiColour' | 'curve' | 'gamma'
>

/**
 * The bend of a map, 0..1 → 0..1. Gamma: t^γ (2.2 looks even on an LED).
 * Easings are cubic: `in` starts slowly, `out` ends slowly, `inout` both.
 */
export function shapeCurve(curve: Curve, gamma: number, t: number) {
	const x = Math.min(1, Math.max(0, t))
	switch (curve) {
		case 'gamma':
			return x ** Math.max(0.05, gamma)
		case 'in':
			return x * x * x
		case 'out':
			return 1 - (1 - x) ** 3
		case 'inout':
			return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
		default:
			return x
	}
}

/** How bright a colour is, 0..1: its strongest channel. */
export const brightness = (c: number) => Math.max((c >> 16) & 255, (c >> 8) & 255, c & 255) / 255

export const rgbOf = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const

/** The colour `t` of the way from a to b (0..1), channel by channel. */
export function mixColour(a: number, b: number, t: number) {
	const k = Math.min(1, Math.max(0, t))
	const [ar, ag, ab] = rgbOf(a)
	const [br, bg, bb] = rgbOf(b)
	const ch = (x: number, y: number) => Math.round(x + (y - x) * k)
	return (ch(ar, br) << 16) | (ch(ag, bg) << 8) | ch(ab, bb)
}

/** Colours take part in casts by their brightness. */
const level = (src: SignalType, v: number) => (src === 'colour' ? brightness(v) : v)
const asLevelType = (t: SignalType): SignalType => (t === 'colour' ? 'analog' : t)

/** The boolean a wire derives from its source (used by toggles and digital targets). */
export const asBool = (p: P, src: SignalType, v: number) =>
	src === 'digital' ? v >= 0.5 : level(src, v) > p.threshold

/** Analog-like on both ends and following: the wire maps a range onto a range. */
export const isMap = (p: P, src: SignalType, dst: SignalType) =>
	p.fn === 'follow' && src !== 'digital' && dst !== 'digital'

export function transfer(p: P, src: SignalType, dst: SignalType, v: number, state: number) {
	if (isPlainWire(p, src, dst)) return v
	if (isMap(p, src, dst)) {
		const span = p.inHi - p.inLo || 1e-6
		const t = shapeCurve(p.curve, p.gamma, (level(src, v) - p.inLo) / span)
		// Into a colour: fade from one chosen colour to the other.
		if (dst === 'colour') return mixColour(p.loColour, p.hiColour, t)
		return p.lo + t * (p.hi - p.lo)
	}
	const b = p.fn === 'toggle' ? state >= 0.5 : asBool(p, src, v)
	if (dst === 'digital') return b !== p.invert ? 1 : 0
	if (dst === 'colour') return b ? p.hiColour : p.loColour
	return b ? p.hi : p.lo
}

export function isEdge(edge: Edge, before: boolean, after: boolean) {
	if (before === after) return false
	return edge === 'both' || (edge === 'rise' ? after : before)
}

/** Run a wire over a whole series, toggles included, starting from LOW. */
export function simulate(p: P, src: SignalType, dst: SignalType, series: ArrayLike<number>) {
	const out = new Float32Array(series.length)
	let state = 0
	let prev = series.length ? asBool(p, src, series[0]) : false
	for (let i = 0; i < series.length; i++) {
		const b = asBool(p, src, series[i])
		if (p.fn === 'toggle' && i > 0 && isEdge(p.edge, prev, b)) state = state ? 0 : 1
		prev = b
		out[i] = transfer(p, src, dst, series[i], state)
	}
	return out
}

/** True when a wire passes the signal through untouched (so it needs no badge). */
export function isPlainWire(p: P, src: SignalType, dst: SignalType) {
	if (src !== dst || p.fn !== 'follow') return false
	if (src === 'digital') return !p.invert
	return p.inLo === 0 && p.inHi === 1 && p.lo === 0 && p.hi === 1 && p.curve === 'linear'
}

/** Whether a wire between these types converts the value (and so shows a badge). */
export const castsBetween = (src: SignalType, dst: SignalType) => asLevelType(src) !== asLevelType(dst) || src !== dst

/* ---------------------------------------------------------------- values */

/** Outputs computed this very tick, ahead of the store: see blocks/runner. */
export type Fresh = Map<string, number>
const key = (id: TLShapeId, port: string) => `${id}|${port}`
export const freshKey = key

/** The value a port sends out: an IO input's reading, or a logic block's output. */
export function outputValue(editor: Editor, block: Block, port: string, live = false, fresh?: Fresh): number {
	if (block.type === LOGIC_TYPE) {
		// Scrubbing a recording: the steps in between show what they were then.
		const pb = live ? null : playback.get()
		const recorded = pb && recordedValue(editor, pb.clipId, block.id, pb.t, port)
		return recorded ?? fresh?.get(key(block.id, port)) ?? block.props.out[port] ?? 0
	}
	if (isInput(block.props.kind)) {
		const pb = live ? null : playback.get()
		const recorded = pb && recordedValue(editor, pb.clipId, block.id, pb.t)
		return recorded ?? block.props.value
	}
	return block.props.value
}

/** The value arriving at an input port: through its wire, or the value set on the block. */
export function inputValue(
	editor: Editor,
	block: Block,
	port: string,
	live = false,
	fresh?: Fresh,
	depth = 0
): number {
	const pb = live ? null : playback.get()
	const wire = getIncomingWire(editor, block.id, port)
	const ends = wire && getWireEnds(editor, wire)
	const from = ends?.from

	if (!wire || !from || depth > 8) {
		if (block.type === LOGIC_TYPE) return block.props.params[port] ?? getPort(block, port, 'in')?.default ?? 0
		// Puppeteered by hand: replay how it was moved.
		return (pb && recordedValue(editor, pb.clipId, block.id, pb.t)) ?? block.props.value
	}
	const src = portTypeOf(from, ends.fromPort)
	const dst = portTypeOf(block, port)

	// Scrubbing, but what feeds this output wasn't recorded (a block added since, or
	// a clip from before in-between steps were kept): show what the output did then.
	if (pb && block.type === IO_TYPE && !isRecorded(editor, pb.clipId, from, ends.fromPort)) {
		const own = recordedValue(editor, pb.clipId, block.id, pb.t)
		if (own !== undefined) return own
	}

	// A toggle's state at a moment in a recording depends on everything before it.
	if (pb && wire.props.fn === 'toggle' && from.type === IO_TYPE) {
		const rec = recordedSeries(editor, pb.clipId, from.id, pb.t)
		if (rec) {
			const out = simulate(wire.props, src, dst, rec)
			return out[out.length - 1] ?? 0
		}
	}
	return transfer(wire.props, src, dst, outputValue(editor, from, ends.fromPort, live, fresh), wire.props.state)
}

/** Whether a recording holds this port's values, so scrubbing can show them. */
export function isRecorded(editor: Editor, clipId: TLShapeId, block: Block, port = '') {
	return recordedValue(editor, clipId, block.id, 0, block.type === LOGIC_TYPE ? port : undefined) !== undefined
}

/** The value an IO block shows and drives: its reading, or what arrives at it. */
export function effectiveValue(editor: Editor, id: TLShapeId, live = false): number {
	const block = getIo(editor, id)
	if (!block) return 0
	return isInput(block.props.kind) ? outputValue(editor, block, '', live) : inputValue(editor, block, '', live)
}

/**
 * The one way signals change: board telemetry and simulated inputs on IO
 * blocks, and the runner's results on logic blocks. The writer of a value also
 * notices its edges and flips toggles on wires leaving it, so collaborators
 * never flip the same toggle twice.
 */
export function writeSignals(
	editor: Editor,
	updates: { id: TLShapeId; port?: string; value: number; live?: boolean }[],
	extra: TLShapePartial[] = []
) {
	const shapes: TLShapePartial[] = [...extra]
	const outs = new Map<TLShapeId, Record<string, number>>()
	for (const u of updates) {
		const block = getBlock(editor, u.id)
		if (!block) continue
		const port = u.port ?? ''
		const before = outputValue(editor, block, port, true)
		const src = portTypeOf(block, port)
		for (const wire of getOutgoingWires(editor, block.id, port)) {
			const p = wire.props
			if (p.fn === 'toggle' && isEdge(p.edge, asBool(p, src, before), asBool(p, src, u.value))) {
				shapes.push({ id: wire.id, type: WIRE_TYPE, props: { state: p.state ? 0 : 1 } })
			}
		}
		if (block.type === IO_TYPE) {
			const props: Partial<IoShape['props']> = { value: u.value }
			if (u.live !== undefined) props.live = u.live
			shapes.push({ id: block.id, type: IO_TYPE, props })
		} else {
			outs.set(block.id, { ...(outs.get(block.id) ?? block.props.out), [port]: u.value })
		}
	}
	for (const [id, out] of outs) shapes.push({ id, type: LOGIC_TYPE, props: { out } })
	if (shapes.length) editor.run(() => editor.updateShapes(shapes), { history: 'ignore' })
}

export const writeInputs = writeSignals

/* ---------------------------------------------------------------- format */

export const fmtPct = (v: number) => `${Math.round(v * 100)} %`

export function fmtNumber(v: number) {
	if (!Number.isFinite(v)) return '–'
	const a = Math.abs(v)
	if (a >= 1000 || Number.isInteger(v)) return String(Math.round(v))
	return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2).replace(/\.?0+$/, '')
}

export const fmtColour = (c: number) => '#' + (Math.round(c) & 0xffffff).toString(16).padStart(6, '0')

/** What people call a block: its own name, else what kind of block it is. */
export function blockName(block: Block) {
	if (block.props.label) return block.props.label
	return block.type === IO_TYPE ? KIND_INFO[block.props.kind].title : getDef(block).title
}
