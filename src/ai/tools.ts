import type Anthropic from '@anthropic-ai/sdk'
import { Editor, TLShapeId, createShapeId } from 'tldraw'
import { CUSTOM_ID, CustomDef, LIBRARY, formatPorts, getDef, getLibraryDef, parsePorts } from '../blocks/registry'
import { logicSize } from '../blocks/layout'
import { BOARD_PINS, pinUnavailable } from '../board/board'
import { IO_H, IO_W, createIoBlock, createLogicBlock, nextDropPoint, sendWireToBack, snap, usedPins } from '../shapes/blocks'
import {
	blockName,
	blockPorts,
	getIncomingWire,
	getWireEnds,
	inputValue,
	outputValue,
	portPagePoint,
} from '../shapes/signals'
import {
	IO_KINDS,
	IO_TYPE,
	IoKind,
	IoShape,
	KIND_INFO,
	LOGIC_TYPE,
	LogicShape,
	WIRE_DEFAULTS,
	WIRE_TYPE,
	WireShape,
	WireShapeProps,
	isInput,
	suggestPin,
} from '../shapes/types'
import { layoutWire } from '../shapes/wiring'
import { askForPin } from './askPin'

/*
 * What the assistant can do on the canvas. Every tool works through the same
 * store as people do, so changes appear for everyone in the room, run in the
 * simulator at once, and land in main.py.
 *
 * Inputs are checked here before anything changes: tool inputs stream in as
 * they're written, unchecked by the API.
 */

type Json = Record<string, unknown>

/** A tool's answer: shown to the model, and summarised for the chat. */
export interface ToolOutcome {
	result: Json | string
	/** One line for the chat, e.g. "+ Digital in · Door switch on GPIO 4". */
	note?: string
	error?: boolean
	/** A block this call created, for arrange(). */
	created?: TLShapeId
}

class InputError extends Error {}

const str = (v: unknown, name: string, optional = false): string | undefined => {
	if (v === undefined || v === null) {
		if (optional) return undefined
		throw new InputError(`${name} is required`)
	}
	if (typeof v !== 'string') throw new InputError(`${name} must be a string`)
	return v
}
const num = (v: unknown, name: string): number | undefined => {
	if (v === undefined || v === null) return undefined
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError(`${name} must be a number`)
	return v
}
const obj = (v: unknown, name: string): Json | undefined => {
	if (v === undefined || v === null) return undefined
	if (typeof v !== 'object' || Array.isArray(v)) throw new InputError(`${name} must be an object`)
	return v as Json
}

/** Accept "abc" as well as "shape:abc". */
const shapeId = (ref: string) => (ref.startsWith('shape:') ? ref : `shape:${ref}`) as TLShapeId
const short = (id: string) => id.replace(/^shape:/, '')

function getBlock(editor: Editor, ref: string) {
	const s = editor.getShape(shapeId(ref))
	if (!s || (s.type !== IO_TYPE && s.type !== LOGIC_TYPE)) throw new InputError(`no block with id "${ref}"`)
	return s as IoShape | LogicShape
}

/* ------------------------------------------------------------ describing */

const fmt = (v: number) => Math.round(v * 1000) / 1000

/** The page as the assistant sees it: blocks, their ports and values, and wires. */
export function describeCanvas(editor: Editor) {
	const blocks: Json[] = []
	const wires: Json[] = []
	for (const s of editor.getCurrentPageShapesSorted()) {
		if (s.type === IO_TYPE) {
			const b = s as IoShape
			blocks.push({
				id: short(b.id),
				kind: b.props.kind,
				label: b.props.label,
				pin: b.props.pin,
				value: fmt(isInput(b.props.kind) ? outputValue(editor, b, '', true) : inputValue(editor, b, '', true)),
				input_wired: isInput(b.props.kind) ? undefined : !!getIncomingWire(editor, b.id),
			})
		} else if (s.type === LOGIC_TYPE) {
			const b = s as LogicShape
			const def = getDef(b)
			const custom = b.props.def === CUSTOM_ID ? (b.props.custom as Partial<CustomDef>) : undefined
			blocks.push({
				id: short(b.id),
				def: b.props.def,
				title: def.title,
				label: b.props.label,
				inputs: def.inputs.map((p) => ({
					id: p.id,
					type: p.type,
					wired: !!getIncomingWire(editor, b.id, p.id),
					value: fmt(inputValue(editor, b, p.id, true)),
				})),
				outputs: def.outputs.map((p) => ({ id: p.id, type: p.type, value: fmt(outputValue(editor, b, p.id, true)) })),
				params: Object.keys(b.props.params).length ? b.props.params : undefined,
				python: custom?.python,
				error: b.props.error || undefined,
			})
		} else if (s.type === WIRE_TYPE) {
			const w = s as WireShape
			const ends = getWireEnds(editor, w)
			if (!ends.from || !ends.to) continue
			const fn: Json = {}
			for (const [k, d] of Object.entries(WIRE_DEFAULTS)) {
				const v = (w.props as unknown as Json)[k]
				if (k !== 'state' && v !== d) fn[k] = v
			}
			wires.push({
				id: short(w.id),
				from: `${short(ends.from.id)}.${ends.fromPort || 'out'}`,
				to: `${short(ends.to.id)}.${ends.toPort || 'in'}`,
				function: Object.keys(fn).length ? fn : undefined,
			})
		}
	}
	return { blocks, wires }
}

/** The block library, for the system prompt. Stable, so it caches. */
export function describeLibrary() {
	return LIBRARY.filter((d) => !d.hidden)
		.map((d) =>
			[
				`### ${d.id} — ${d.title} (${d.category})`,
				d.description,
				`inputs: ${formatPorts(d.inputs) || 'none'}`,
				`outputs: ${formatPorts(d.outputs) || 'none'}`,
				d.settings?.length ? `settings (params): ${d.settings.map((x) => `${x.id}=${x.default}`).join(', ')}` : '',
				'```python' + d.python.replace(/\n+$/, '') + '\n```',
			]
				.filter(Boolean)
				.join('\n')
		)
		.join('\n\n')
}

export function describePins() {
	const rows = BOARD_PINS.filter((p) => p.gpio !== null).map((p) => {
		const no = IO_KINDS.filter((k) => pinUnavailable(p, k))
		const why = no.length === IO_KINDS.length ? pinUnavailable(p, 'din') : no.includes('ain') && no.length === 1 ? 'not analog' : ''
		return `GPIO ${p.gpio}${why ? ` (${why})` : ''}${p.note ? ` — ${p.note}` : ''}`
	})
	return rows.join('\n')
}

/* ------------------------------------------------------------ placing */

/** New blocks go in columns by role: inputs left, logic in the middle, outputs right. */
function spotFor(editor: Editor, role: 'in' | 'logic' | 'out', size: { w: number; h: number }) {
	const c = editor.getViewportPageBounds().center
	const x = role === 'in' ? c.x - 420 : role === 'out' ? c.x + 420 : c.x
	return nextDropPoint(editor, size, { x, y: c.y })
}

/**
 * Lay out what the assistant built, in columns by signal flow: sources on the
 * left, each step one column further right, beside what was already there.
 * Blocks people placed themselves never move.
 */
export function arrange(editor: Editor, made: Set<TLShapeId>) {
	const ids = [...made].filter((id) => editor.getShape(id))
	if (!ids.length) return
	const blocks = editor.getCurrentPageShapes().filter((s) => s.type === IO_TYPE || s.type === LOGIC_TYPE) as (IoShape | LogicShape)[]
	const sources = new Map<TLShapeId, TLShapeId[]>()
	for (const w of editor.getCurrentPageShapes()) {
		if (w.type !== WIRE_TYPE) continue
		const { from, to } = getWireEnds(editor, w as WireShape)
		if (from && to) sources.set(to.id, [...(sources.get(to.id) ?? []), from.id])
	}
	const depth = new Map<TLShapeId, number>()
	const depthOf = (id: TLShapeId, seen = new Set<TLShapeId>()): number => {
		if (depth.has(id)) return depth.get(id)!
		if (seen.has(id)) return 0 // a loop: break it here
		seen.add(id)
		const d = Math.max(-1, ...(sources.get(id) ?? []).map((s) => depthOf(s, seen))) + 1
		depth.set(id, d)
		return d
	}
	// Outputs go in the last column, so the result reads left to right.
	const last = Math.max(0, ...ids.map((id) => depthOf(id)))
	const column = (id: TLShapeId) => {
		const s = editor.getShape(id) as IoShape | LogicShape
		return s.type === IO_TYPE && !isInput(s.props.kind) ? Math.max(depthOf(id), last) : depthOf(id)
	}

	const old = blocks.filter((b) => !made.has(b.id))
	const oldBounds = old.length ? editor.getShapesPageBounds(old.map((b) => b.id)) : null
	const view = editor.getViewportPageBounds()
	const x0 = snap(oldBounds ? oldBounds.minX : view.center.x - 400)
	const y0 = snap(oldBounds ? oldBounds.maxY + 128 : view.center.y - 100)
	const COL = 352
	const filled = new Map<number, number>()
	const sorted = ids.sort((a, b) => column(a) - column(b) || editor.getShape(a)!.y - editor.getShape(b)!.y)
	for (const id of sorted) {
		const s = editor.getShape(id) as IoShape | LogicShape
		const c = column(id)
		const y = filled.get(c) ?? y0
		editor.updateShape({ id, type: s.type, x: x0 + c * COL, y })
		filled.set(c, snap(y + s.props.h + 48))
	}
	for (const w of editor.getCurrentPageShapes()) if (w.type === WIRE_TYPE) layoutWire(editor, w.id)
}

/* ------------------------------------------------------------ the tools */

const WIRE_FN_SCHEMA = {
	type: 'object',
	description:
		'What the wire does to the signal (all levels 0..1). Only give fields you want to change from the defaults: fn "follow", edge "rise", threshold 0.5, invert false, inLo 0, inHi 1, lo 0, hi 1, loColour 0x000000, hiColour 0xffffff, curve "linear", gamma 2.2.',
	properties: {
		fn: { type: 'string', enum: ['follow', 'toggle'], description: 'toggle: each edge of the boolean flips the output' },
		edge: { type: 'string', enum: ['rise', 'fall', 'both'] },
		threshold: { type: 'number', description: 'analog → digital: HIGH above this level' },
		invert: { type: 'boolean', description: 'digital targets: swap HIGH and LOW' },
		inLo: { type: 'number' },
		inHi: { type: 'number' },
		lo: { type: 'number', description: 'analog target: the output for LOW, or the bottom of a map' },
		hi: { type: 'number', description: 'analog target: the output for HIGH, or the top of a map' },
		loColour: { type: 'integer', description: 'colour target: 0xRRGGBB as an integer, for LOW / the start of a fade' },
		hiColour: { type: 'integer', description: 'colour target: 0xRRGGBB as an integer, for HIGH / the end of a fade' },
		curve: { type: 'string', enum: ['linear', 'gamma', 'in', 'out', 'inout'] },
		gamma: { type: 'number', description: 'exponent for curve "gamma"; 2.2 makes LED fades look even' },
	},
} as const

export const TOOLS: Anthropic.Beta.BetaTool[] = [
	{
		name: 'get_canvas',
		description:
			'Read the canvas as it is now: every block (id, kind or def, label, pin, ports, live values, errors) and every wire (from, to, function). Call it after changes if you need fresh ids or values.',
		input_schema: { type: 'object', properties: {} },
	},
	{
		name: 'add_io_block',
		description:
			'Add a block for real hardware on a pin: din (button, switch, sensor that is on/off), ain (knob, light or soil sensor; analog pins only), dout (LED, relay, buzzer), aout (PWM: dimmable LED, motor speed), rgb (WS2812 colour LED). Name it after the real thing ("Door switch", not "Digital in"). For the pin: give a number when the user named one or it obviously follows (the DevKit\'s BOOT button is GPIO 0, its RGB LED is GPIO 38); "ask" when the choice depends on how the user will wire it, so they pick it on the board; "auto" for a sensible free pin.',
		input_schema: {
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['din', 'ain', 'dout', 'aout', 'rgb'] },
				label: { type: 'string', description: 'The real thing, e.g. "Plant soil moisture"' },
				pin: {
					description: 'A GPIO number, "ask" (the user picks it on the board drawing) or "auto"',
					anyOf: [{ type: 'integer' }, { type: 'string', enum: ['ask', 'auto'] }],
				},
				question: { type: 'string', description: 'With pin "ask": one short sentence shown above the board, e.g. "Which pin is the fan\'s MOSFET on?"' },
			},
			required: ['kind', 'label', 'pin'],
		},
	},
	{
		name: 'add_logic_block',
		description:
			'Add a block from the library (see the list in the system prompt) by its def id. Unwired inputs and settings are set with params.',
		input_schema: {
			type: 'object',
			properties: {
				def: { type: 'string', description: 'e.g. "time.wait", "logic.gate"' },
				label: { type: 'string', description: 'What it is for in this project, e.g. "Wake-up alarm"' },
				params: { type: 'object', description: 'Values for unconnected inputs and settings, by id, e.g. {"seconds": 10}', additionalProperties: { type: 'number' } },
			},
			required: ['def', 'label'],
		},
	},
	{
		name: 'add_python_block',
		description:
			'Create a new block when nothing in the library does the job: its ports and its MicroPython update(b). It runs in the browser simulator at once and on the board in main.py. Returns any Python error, so check it.',
		input_schema: {
			type: 'object',
			properties: {
				title: { type: 'string', description: 'What kind of block it is, short, e.g. "Debounce"' },
				label: { type: 'string', description: 'What it is for in this project' },
				inputs: { type: 'string', description: 'Ports as "name:type=default unit", comma separated, e.g. "trigger:digital, seconds:number=5 s". Types: digital, analog, number, colour. Empty string for none.' },
				outputs: { type: 'string', description: 'Same format, e.g. "done:digital, left:number s"' },
				display: { type: 'string', description: 'The output shown large on the block' },
				python: { type: 'string', description: 'MicroPython defining update(b) (and optionally setup(b))' },
			},
			required: ['title', 'label', 'inputs', 'outputs', 'display', 'python'],
		},
	},
	{
		name: 'update_block',
		description: "Change a block: its label, params, pin (IO blocks: a number, \"ask\" or \"auto\"), or a Python block's ports and code.",
		input_schema: {
			type: 'object',
			properties: {
				id: { type: 'string' },
				label: { type: 'string' },
				params: { type: 'object', additionalProperties: { type: 'number' } },
				pin: { anyOf: [{ type: 'integer' }, { type: 'string', enum: ['ask', 'auto'] }] },
				question: { type: 'string', description: 'With pin "ask": the question shown above the board' },
				python: {
					type: 'object',
					description: 'Python blocks only: the fields to change',
					properties: {
						title: { type: 'string' },
						inputs: { type: 'string' },
						outputs: { type: 'string' },
						display: { type: 'string' },
						python: { type: 'string' },
					},
				},
			},
			required: ['id'],
		},
	},
	{
		name: 'connect',
		description:
			'Wire an output to an input. IO input blocks have one output and IO output blocks one input: leave their port out. Logic blocks: name the port. Any type can feed any other; the wire casts (digital → analog gives lo/hi, analog → digital uses threshold, number/analog → colour fades loColour → hiColour). An input takes one wire: to combine two HIGH/LOW signals put a logic.gate in between.',
		input_schema: {
			type: 'object',
			properties: {
				from: { type: 'string', description: 'Source block id' },
				from_port: { type: 'string', description: 'Output port id (logic blocks)' },
				to: { type: 'string', description: 'Target block id' },
				to_port: { type: 'string', description: 'Input port id (logic blocks)' },
				function: WIRE_FN_SCHEMA,
			},
			required: ['from', 'to'],
		},
	},
	{
		name: 'set_wire_function',
		description: "Change what an existing wire does to the signal.",
		input_schema: {
			type: 'object',
			properties: { id: { type: 'string', description: 'Wire id' }, function: WIRE_FN_SCHEMA },
			required: ['id', 'function'],
		},
	},
	{
		name: 'delete',
		description: 'Remove blocks or wires by id. Removing a block removes its wires.',
		input_schema: {
			type: 'object',
			properties: { ids: { type: 'array', items: { type: 'string' } } },
			required: ['ids'],
		},
	},
].map((t) => ({ ...t, eager_input_streaming: true }) as Anthropic.Beta.BetaTool)

/* ------------------------------------------------------------ running them */

async function choosePin(editor: Editor, id: TLShapeId, kind: IoKind, pin: unknown, question: string | undefined) {
	if (pin === 'ask') {
		const chosen = await askForPin(editor, id, question || `Which pin is the ${KIND_INFO[kind].title.toLowerCase()} on?`)
		return { pin: chosen, asked: true }
	}
	if (pin === 'auto' || pin === undefined) {
		const others = usedPins(editor)
		others.delete((editor.getShape(id) as IoShape).props.pin)
		const p = suggestPin(kind, others)
		editor.updateShape({ id, type: IO_TYPE, props: { pin: p } })
		return { pin: p, asked: false }
	}
	const n = num(pin, 'pin')!
	const board = BOARD_PINS.find((p) => p.gpio === n)
	if (!board) throw new InputError(`GPIO ${n} is not on the DevKitC-1 headers`)
	const why = pinUnavailable(board, kind)
	if (why) throw new InputError(`GPIO ${n} can't be used for ${kind}: ${why}`)
	editor.updateShape({ id, type: IO_TYPE, props: { pin: n } })
	return { pin: n, asked: false }
}

function wireFunction(raw: Json | undefined): Partial<WireShapeProps> {
	if (!raw) return {}
	const out: Json = {}
	for (const [k, v] of Object.entries(raw)) {
		if (!(k in WIRE_DEFAULTS) || k === 'state') throw new InputError(`unknown wire function field "${k}"`)
		const d = (WIRE_DEFAULTS as Json)[k]
		if (typeof v !== typeof d) throw new InputError(`${k} must be a ${typeof d}`)
		out[k] = v
	}
	if (out.fn !== undefined && !['follow', 'toggle'].includes(out.fn as string)) throw new InputError('fn must be follow or toggle')
	if (out.edge !== undefined && !['rise', 'fall', 'both'].includes(out.edge as string)) throw new InputError('edge must be rise, fall or both')
	if (out.curve !== undefined && !['linear', 'gamma', 'in', 'out', 'inout'].includes(out.curve as string)) throw new InputError('unknown curve')
	return out as Partial<WireShapeProps>
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A Python block's error after the runner has had a moment to try it. */
async function pythonError(editor: Editor, id: TLShapeId) {
	await pause(700)
	return (editor.getShape(id) as LogicShape | undefined)?.props.error || null
}

function pythonDef(raw: Json, base: Partial<CustomDef> = {}): CustomDef {
	const c: CustomDef = {
		title: str(raw.title, 'title', true) ?? base.title ?? 'Python',
		inputs: str(raw.inputs, 'inputs', true) ?? base.inputs ?? '',
		outputs: str(raw.outputs, 'outputs', true) ?? base.outputs ?? '',
		display: str(raw.display, 'display', true) ?? base.display ?? '',
		python: str(raw.python, 'python', true) ?? base.python ?? '',
	}
	if (!/def\s+update\s*\(/.test(c.python)) throw new InputError('python must define update(b)')
	if (!parsePorts(c.outputs).length) throw new InputError('a block needs at least one output')
	return c
}

export async function runTool(editor: Editor, name: string, input: unknown): Promise<ToolOutcome> {
	try {
		const a = obj(input, 'input') ?? {}
		switch (name) {
			case 'get_canvas':
				return { result: describeCanvas(editor) }

			case 'add_io_block': {
				const kind = str(a.kind, 'kind') as IoKind
				if (!IO_KINDS.includes(kind)) throw new InputError(`kind must be one of ${IO_KINDS.join(', ')}`)
				const label = str(a.label, 'label')!
				const id = createIoBlock(editor, kind, spotFor(editor, isInput(kind) ? 'in' : 'out', { w: IO_W, h: IO_H }))
				editor.updateShape({ id, type: IO_TYPE, props: { label, pin: -1 } })
				try {
					const { pin, asked } = await choosePin(editor, id, kind, a.pin, str(a.question, 'question', true))
					const where = pin >= 0 ? `GPIO ${pin}` : 'no pin yet'
					return {
						created: id,
						result: { id: short(id), pin, ...(asked && pin < 0 ? { note: 'The user closed the picker without choosing a pin.' } : {}) },
						note: `+ ${KIND_INFO[kind].title} · ${label} on ${where}${asked ? ' (you chose)' : ''}`,
					}
				} catch (e) {
					editor.deleteShapes([id])
					throw e
				}
			}

			case 'add_logic_block': {
				const defId = str(a.def, 'def')!
				const def = getLibraryDef(defId)
				if (!def || defId === CUSTOM_ID) throw new InputError(`no library block "${defId}"; use add_python_block for new behaviour`)
				const params = (obj(a.params, 'params') ?? {}) as Record<string, number>
				const known = new Set([...def.inputs.map((p) => p.id), ...(def.settings ?? []).map((x) => x.id)])
				for (const [k, v] of Object.entries(params)) {
					if (!known.has(k)) throw new InputError(`${defId} has no input or setting "${k}"`)
					num(v, `params.${k}`)
				}
				const id = createLogicBlock(editor, defId, spotFor(editor, 'logic', logicSize(def)), params)
				const label = str(a.label, 'label')!
				editor.updateShape({ id, type: LOGIC_TYPE, props: { label } })
				return { created: id, result: { id: short(id) }, note: `+ ${def.title} · ${label}` }
			}

			case 'add_python_block': {
				const custom = pythonDef(a)
				const label = str(a.label, 'label')!
				const id = createLogicBlock(editor, CUSTOM_ID, spotFor(editor, 'logic', { w: 256, h: 128 }))
				editor.updateShape({ id, type: LOGIC_TYPE, props: { label, custom: { ...custom } } })
				const err = await pythonError(editor, id)
				return {
					created: id,
					result: { id: short(id), error: err ?? undefined },
					note: `+ Python block · ${label}${err ? ' (error)' : ''}`,
					error: !!err,
				}
			}

			case 'update_block': {
				const b = getBlock(editor, str(a.id, 'id')!)
				const label = str(a.label, 'label', true)
				const notes: string[] = []
				if (b.type === IO_TYPE) {
					if (a.params || a.python) throw new InputError('IO blocks have no params or python')
					if (label !== undefined) editor.updateShape({ id: b.id, type: IO_TYPE, props: { label } })
					if (a.pin !== undefined) {
						const { pin } = await choosePin(editor, b.id, b.props.kind, a.pin, str(a.question, 'question', true))
						notes.push(pin >= 0 ? `GPIO ${pin}` : 'no pin')
					}
				} else {
					if (a.pin !== undefined) throw new InputError('only IO blocks have a pin')
					const props: Partial<LogicShape['props']> = {}
					if (label !== undefined) props.label = label
					const params = obj(a.params, 'params') as Record<string, number> | undefined
					if (params) {
						for (const [k, v] of Object.entries(params)) num(v, `params.${k}`)
						props.params = { ...b.props.params, ...params }
					}
					const py = obj(a.python, 'python')
					if (py) {
						if (b.props.def !== CUSTOM_ID) throw new InputError('only Python blocks have editable code')
						props.custom = { ...pythonDef(py, b.props.custom as Partial<CustomDef>) }
						notes.push('code')
					}
					editor.updateShape({ id: b.id, type: LOGIC_TYPE, props })
					if (py) {
						const err = await pythonError(editor, b.id)
						if (err) return { result: { id: short(b.id), error: err }, note: `✎ ${blockName(b)} (error)`, error: true }
					}
				}
				const now = editor.getShape(b.id) as IoShape | LogicShape
				return { result: { id: short(b.id), ok: true }, note: `✎ ${blockName(now)}${notes.length ? ` · ${notes.join(', ')}` : ''}` }
			}

			case 'connect': {
				const from = getBlock(editor, str(a.from, 'from')!)
				const to = getBlock(editor, str(a.to, 'to')!)
				const ports = (b: IoShape | LogicShape, side: 'in' | 'out') => blockPorts(b).filter((p) => p.side === side)
				const outs = ports(from, 'out')
				const ins = ports(to, 'in')
				const fromPort = str(a.from_port, 'from_port', true) ?? (outs.length === 1 ? outs[0].id : undefined)
				const toPort = str(a.to_port, 'to_port', true) ?? (ins.length === 1 ? ins[0].id : undefined)
				const out = outs.find((p) => p.id === (fromPort ?? ''))
				const inp = ins.find((p) => p.id === (toPort ?? ''))
				if (!out) throw new InputError(`${short(from.id)} has no output "${fromPort ?? ''}"; outputs: ${outs.map((p) => p.id || '(the block)').join(', ') || 'none'}`)
				if (!inp) throw new InputError(`${short(to.id)} has no input "${toPort ?? ''}"; inputs: ${ins.map((p) => p.id || '(the block)').join(', ') || 'none'}`)
				const busy = getIncomingWire(editor, to.id, inp.id)
				if (busy) throw new InputError(`that input is already driven by wire ${short(busy.id)}; delete it, or combine both with a logic.gate`)
				const fn = wireFunction(obj(a.function, 'function'))

				const id = createShapeId()
				const at = portPagePoint(editor, from, out.id)
				editor.createShape({ id, type: WIRE_TYPE, x: at.x, y: at.y, props: fn })
				sendWireToBack(editor, id)
				editor.createBindings([
					{ type: WIRE_TYPE, fromId: id, toId: from.id, props: { terminal: 'start', port: out.id } },
					{ type: WIRE_TYPE, fromId: id, toId: to.id, props: { terminal: 'end', port: inp.id } },
				])
				layoutWire(editor, id)
				const end = (b: IoShape | LogicShape, port: string) => `${blockName(b)}${port ? '.' + port : ''}`
				return { result: { id: short(id) }, note: `↦ ${end(from, out.id)} → ${end(to, inp.id)}` }
			}

			case 'set_wire_function': {
				const w = editor.getShape(shapeId(str(a.id, 'id')!))
				if (!w || w.type !== WIRE_TYPE) throw new InputError(`no wire with id "${a.id}"`)
				editor.updateShape({ id: w.id, type: WIRE_TYPE, props: wireFunction(obj(a.function, 'function')) })
				return { result: { id: short(w.id), ok: true }, note: `ƒ wire ${short(w.id)}` }
			}

			case 'delete': {
				const ids = a.ids
				if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new InputError('ids must be a list of strings')
				const found = ids.map((x) => shapeId(x)).filter((id) => editor.getShape(id))
				editor.deleteShapes(found)
				return { result: { deleted: found.map(short) }, note: `− ${found.length} removed` }
			}
		}
		return { result: `unknown tool "${name}"`, error: true }
	} catch (e) {
		if (e instanceof InputError) return { result: { error: e.message }, error: true, note: `! ${e.message}` }
		throw e
	}
}
