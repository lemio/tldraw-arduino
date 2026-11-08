import { Editor } from 'tldraw'
import { getDef } from '../blocks/registry'
import { PY_RUNTIME } from '../blocks/runtime'
import {
	Block,
	blockName,
	getIncomingWire,
	getWireEnds,
	isMap,
	isPlainWire,
	portTypeOf,
} from '../shapes/signals'
import {
	IO_TYPE,
	IoShape,
	KIND_INFO,
	LOGIC_TYPE,
	LogicShape,
	SignalType,
	WIRE_TYPE,
	WireShape,
	isInput,
	signalType,
} from '../shapes/types'

/*
 * Turn the canvas into a plain MicroPython program that runs on the board by
 * itself. It is written to be read: one named object per block, and one line
 * per wire, with a comment wherever a type cast happens.
 */
export function generateMain(editor: Editor): string {
	const shapes = editor.getCurrentPageShapes()
	const logic = shapes.filter((s): s is LogicShape => s.type === LOGIC_TYPE)
	const hasRgb = shapes.some((s) => s.type === IO_TYPE && (s as IoShape).props.kind === 'rgb')
	const curved = shapes.some((s) => s.type === WIRE_TYPE && (s as WireShape).props.curve !== 'linear')
	// Logic blocks, colour LEDs and curves need the general program; plain IO keeps the simplest one.
	if (logic.length || hasRgb || curved) return generateGraph(editor)

	const blocks = shapes
		.filter((s): s is IoShape => s.type === IO_TYPE && (s as IoShape).props.pin >= 0)
		.sort((a, b) => a.y - b.y || a.x - b.x)

	if (!blocks.length) {
		return '# Add blocks to the canvas and give them a pin.\n# Their program appears here.\n'
	}

	const names = new Map<string, string>()
	const taken = new Set<string>(RESERVED)
	for (const b of blocks) {
		let base = identifier(b.props.label || KIND_INFO[b.props.kind].title)
		if (!base || /^\d/.test(base)) base = `${b.props.kind}_${b.props.pin}`
		let name = base
		for (let i = 2; taken.has(name); i++) name = `${base}_${i}`
		taken.add(name)
		names.set(b.id, name)
	}

	const setup: string[] = []
	const helpers = new Set<string>()
	const loop: string[] = []
	const once: string[] = []

	for (const b of blocks) {
		const n = names.get(b.id)!
		const g = b.props.pin
		const note = `  # ${KIND_INFO[b.props.kind].title.toLowerCase()}`
		switch (b.props.kind) {
			case 'din': {
				const pull = b.props.pull === 'up' ? ', Pin.PULL_UP' : b.props.pull === 'down' ? ', Pin.PULL_DOWN' : ''
				setup.push(`${n} = Pin(${g}, Pin.IN${pull})${note}`)
				break
			}
			case 'ain':
				setup.push(`${n} = ADC(Pin(${g}), atten=ADC.ATTN_11DB)${note}`)
				break
			case 'dout':
				setup.push(`${n} = Pin(${g}, Pin.OUT)${note}`)
				break
			case 'aout':
				setup.push(`${n} = PWM(Pin(${g}), freq=1000, duty_u16=0)${note}`)
				break
		}
	}

	for (const b of blocks) {
		if (isInput(b.props.kind)) continue
		const n = names.get(b.id)!
		const wire = getIncomingWire(editor, b.id)
		const from = wire && (getWireEnds(editor, wire).from as IoShape | undefined)
		const src = from && from.props.pin >= 0 ? names.get(from.id) : undefined

		if (!wire || !from || !src) {
			// Unwired: keep whatever value it was puppeteered to.
			const v = b.props.value
			once.push(
				b.props.kind === 'dout'
					? `${n}.value(${v >= 0.5 ? 1 : 0})`
					: `${n}.duty_u16(${Math.round(v * 65535)})  # ${Math.round(v * 100)} %`
			)
			continue
		}

		const p = wire.props
		const srcType = signalType(from.props.kind)
		const dstType = signalType(b.props.kind)
		const read = srcType === 'digital' ? `${src}.value()` : `${src}.read_u16()`
		const u16 = (v: number) => Math.round(v * 65535)

		if (isMap(p, srcType, dstType)) {
			if (isPlainWire(p, srcType, dstType)) loop.push(`${n}.duty_u16(${read})`)
			else {
				helpers.add(REMAP)
				loop.push(
					`${n}.duty_u16(remap(${read}, ${u16(p.inLo)}, ${u16(p.inHi)}, ${u16(p.lo)}, ${u16(p.hi)}))  # ${pct(p.inLo)}–${pct(p.inHi)} → ${pct(p.lo)}–${pct(p.hi)} %`
				)
			}
			continue
		}

		// Everything else goes through a boolean.
		const cond = srcType === 'digital' ? read : `${read} > ${u16(p.threshold)}`
		let high: string
		if (p.fn === 'toggle') {
			const state = `${n}_on`
			const prev = `${n}_was`
			const now = srcType === 'digital' ? `${read} == 1` : cond
			once.push(`${state} = 0  # flipped by ${src}`, `${prev} = ${now}`)
			const edge = { rise: `now and not ${prev}`, fall: `${prev} and not now`, both: `now != ${prev}` }[p.edge]
			loop.push(`now = ${now}`, `if ${edge}:  # toggle on ${p.edge}`, `    ${state} = 1 - ${state}`, `${prev} = now`)
			high = state
		} else high = cond

		if (dstType === 'digital') {
			if (p.fn !== 'toggle' && srcType === 'digital' && !p.invert) loop.push(`${n}.value(${read})`)
			else if (p.invert) loop.push(`${n}.value(0 if ${high} else 1)  # inverted`)
			else loop.push(`${n}.value(1 if ${high} else 0)`)
		} else {
			loop.push(`${n}.duty_u16(${u16(p.hi)} if ${high} else ${u16(p.lo)})  # HIGH → ${pct(p.hi)} %, LOW → ${pct(p.lo)} %`)
		}
	}

	const out = [
		'# Generated from the canvas. Saved as main.py,',
		'# it runs on the board without a computer.',
		'from machine import Pin, ADC, PWM',
		'import time',
		'',
		...alignComments(setup),
	]
	for (const h of helpers) out.push('', h)
	if (once.length) out.push('', ...once)
	out.push('', 'while True:')
	out.push(...(loop.length ? loop.map((l) => '    ' + l) : ['    pass']))
	out.push('    time.sleep_ms(10)', '')
	return out.join('\n')
}

const pct = (v: number) => Math.round(v * 100)

const REMAP = `def remap(v, in_lo, in_hi, out_lo, out_hi):
    t = min(1, max(0, (v - in_lo) / (in_hi - in_lo)))
    return int(out_lo + t * (out_hi - out_lo))`

const RESERVED = ['now', 'remap', 'brightness', 'mix_colour', 'show', 'Block', 'neopixel', 'json', 'Pin', 'ADC', 'PWM', 'time', 'machine', 'print', 'while', 'if', 'else', 'True', 'False', 'None', 'in', 'is', 'not', 'and', 'or', 'def', 'class', 'import', 'from', 'pass', 'for', 'return']

function identifier(label: string) {
	return label
		.normalize('NFKD')
		.replace(/[^\w\s]/g, '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '_')
}

/** Line up trailing comments so the setup block reads as a table. */
function alignComments(lines: string[]) {
	const split = lines.map((l) => {
		const i = l.indexOf('  # ')
		return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 2)]
	})
	const w = Math.max(...split.map(([c]) => c.length))
	return split.map(([c, k]) => (k ? `${c.padEnd(w)}  ${k}` : c))
}

/* ------------------------------------------------------- the general program */

/**
 * With logic blocks the program becomes a small dataflow loop: read the
 * inputs, run each block's update(b) in dependency order, drive the outputs.
 * Every block's Python is the same code the canvas runs.
 */
function generateGraph(editor: Editor): string {
	const all = editor
		.getCurrentPageShapes()
		.filter((s): s is Block => (s.type === IO_TYPE && (s as IoShape).props.pin >= 0) || s.type === LOGIC_TYPE)
		.sort((a, b) => a.y - b.y || a.x - b.x)
	const io = all.filter((s): s is IoShape => s.type === IO_TYPE)
	const logic = order(editor, all.filter((s): s is LogicShape => s.type === LOGIC_TYPE))

	const names = new Map<string, string>()
	const taken = new Set<string>(RESERVED)
	for (const b of all) {
		let base = identifier(blockName(b))
		if (!base || /^\d/.test(base)) base = b.type === IO_TYPE ? `${b.props.kind}_${b.props.pin}` : 'block'
		let name = base
		for (let i = 2; taken.has(name); i++) name = `${base}_${i}`
		taken.add(name)
		names.set(b.id, name)
	}

	const setup: string[] = []
	for (const b of io) {
		const n = names.get(b.id)!
		const g = b.props.pin
		const note = `  # ${KIND_INFO[b.props.kind].title.toLowerCase()}`
		if (b.props.kind === 'din') {
			const pull = b.props.pull === 'up' ? ', Pin.PULL_UP' : b.props.pull === 'down' ? ', Pin.PULL_DOWN' : ''
			setup.push(`${n} = Pin(${g}, Pin.IN${pull})${note}`)
		} else if (b.props.kind === 'ain') setup.push(`${n} = ADC(Pin(${g}), atten=ADC.ATTN_11DB)${note}`)
		else if (b.props.kind === 'dout') setup.push(`${n} = Pin(${g}, Pin.OUT)${note}`)
		else if (b.props.kind === 'aout') setup.push(`${n} = PWM(Pin(${g}), freq=1000, duty_u16=0)${note}`)
		else setup.push(`${n} = neopixel.NeoPixel(Pin(${g}), 1)${note}`)
	}

	// One factory per kind of block: its Python, kept apart from every other block's.
	const factories = new Map<string, string>()
	const factoryOf = (b: LogicShape) => {
		const def = getDef(b)
		const key = def.python
		let f = factories.get(key)
		if (!f) {
			const base = `_${identifier(def.title) || 'block'}`
			f = base
			for (let i = 2; [...factories.values()].includes(f); i++) f = `${base}_${i}`
			factories.set(key, f)
		}
		return f
	}
	const instances: string[] = []
	for (const b of logic) {
		const n = names.get(b.id)!
		instances.push(`${n} = ${factoryOf(b)}()  # ${getDef(b).title.toLowerCase()}`)
		if (Object.keys(b.props.state).length) instances.push(`${n}.state = ${pyLiteral(b.props.state)}`)
	}

	const once: string[] = []
	const loop: string[] = []
	let toggles = 0

	/** The Python for what a port sends out. */
	const portExpr = (b: Block, port: string) => {
		const n = names.get(b.id)
		if (!n) return '0'
		if (b.type === LOGIC_TYPE) return `${n}.out.get(${JSON.stringify(port)}, 0)`
		return b.props.kind === 'din' ? `${n}.value()` : `${n}.read_u16() / 65535`
	}

	/** The Python for what arrives at an input port, with its wire's function. */
	const arriving = (b: Block, port: string, fallback: string) => {
		const wire = getIncomingWire(editor, b.id, port)
		const ends = wire && getWireEnds(editor, wire)
		if (!wire || !ends?.from || !names.has(ends.from.id)) return fallback
		const src = portTypeOf(ends.from, ends.fromPort)
		const dst = portTypeOf(b, port)
		return wireExpr(wire, src, dst, portExpr(ends.from, ends.fromPort))
	}

	const wireExpr = (wire: WireShape, src: SignalType, dst: SignalType, v: string): string => {
		const p = wire.props
		if (isPlainWire(p, src, dst)) return v
		const lvl = src === 'colour' ? `brightness(${v})` : v
		if (isMap(p, src, dst)) {
			const bend = p.curve === 'linear' ? '' : `, ${CURVE_KIND[p.curve]}, ${p.gamma}`
			if (dst === 'colour')
				return `mix_colour(${hex(p.loColour)}, ${hex(p.hiColour)}, remap(${lvl}, ${p.inLo}, ${p.inHi}, 0, 1${bend}))`
			return `remap(${lvl}, ${p.inLo}, ${p.inHi}, ${p.lo}, ${p.hi}${bend})`
		}
		let cond = src === 'digital' ? `${v} >= 0.5` : `${lvl} > ${p.threshold}`
		if (p.fn === 'toggle') {
			const t = ++toggles
			once.push(`_on${t} = 0`, `_was${t} = None`)
			const edge = { rise: `_now and not _was${t}`, fall: `_was${t} and not _now`, both: `_now != _was${t}` }[p.edge]
			loop.push(`_now = ${cond}`, `if _was${t} is not None and ${edge}:  # toggle on ${p.edge}`, `    _on${t} = 1 - _on${t}`, `_was${t} = _now`)
			cond = `_on${t}`
		}
		if (dst === 'digital') return p.invert ? `(0 if ${cond} else 1)` : `(1 if ${cond} else 0)`
		if (dst === 'colour') return `(${hex(p.hiColour)} if ${cond} else ${hex(p.loColour)})`
		return `(${p.hi} if ${cond} else ${p.lo})`
	}

	for (const b of logic) {
		const n = names.get(b.id)!
		const def = getDef(b)
		for (const inp of def.inputs) {
			const fallback = String(b.props.params[inp.id] ?? inp.default ?? 0)
			loop.push(`${n}.inputs[${JSON.stringify(inp.id)}] = ${arriving(b, inp.id, fallback)}`)
		}
		// Settings don't change while the program runs: set them once.
		for (const x of def.settings ?? []) once.push(`${n}.inputs[${JSON.stringify(x.id)}] = ${b.props.params[x.id] ?? x.default}`)
		loop.push(`${n}.step()`)
	}

	for (const b of io) {
		if (isInput(b.props.kind)) continue
		const n = names.get(b.id)!
		const v = arriving(b, '', String(b.props.value))
		if (b.props.kind === 'dout') loop.push(`${n}.value(1 if ${v} >= 0.5 else 0)`)
		else if (b.props.kind === 'aout') loop.push(`${n}.duty_u16(int(max(0, min(1, ${v})) * 65535))`)
		else loop.push(`show(${n}, ${v})`)
	}

	const out = [
		'# Generated from the canvas. Saved as main.py,',
		'# it runs on the board without a computer.',
		'from machine import Pin, ADC, PWM',
		...(io.some((b) => b.props.kind === 'rgb') ? ['import neopixel'] : []),
		'import time',
		PY_RUNTIME.trimEnd(),
		'',
		GRAPH_HELPERS,
		'',
		...alignComments(setup),
	]
	for (const [code, f] of factories) out.push('', ...factory(f, code))
	if (instances.length) out.push('', ...instances)
	if (once.length) out.push('', ...once)
	out.push('', 'while True:')
	out.push(...(loop.length ? loop.map((l) => '    ' + l) : ['    pass']))
	out.push('    time.sleep_ms(10)', '')
	return out.join('\n')
}

/** Colours read best as 0xRRGGBB in code. */
const hex = (c: number) => '0x' + (Math.round(c) & 0xffffff).toString(16).padStart(6, '0')

/** A block's Python, wrapped so its names can't clash with another block's. */
function factory(name: string, code: string) {
	const body = code.replace(/^\n+/, '').trimEnd().split('\n').map((l) => (l ? '    ' + l : l))
	return [
		`def ${name}():`,
		...body,
		'    try:',
		'        s = setup',
		'    except NameError:',
		'        s = None',
		'    return Block(update, s)',
	]
}

/** remap()'s curve argument: 1 gamma, 2 ease in, 3 ease out, 4 ease in-out. */
const CURVE_KIND = { linear: 0, gamma: 1, in: 2, out: 3, inout: 4 } as const

const GRAPH_HELPERS = `def remap(v, in_lo, in_hi, out_lo, out_hi, curve=0, g=1):
    t = min(1, max(0, (v - in_lo) / ((in_hi - in_lo) or 1e-6)))
    if curve == 1:
        t = t ** g
    elif curve == 2:
        t = t * t * t
    elif curve == 3:
        t = 1 - (1 - t) ** 3
    elif curve == 4:
        t = 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2
    return out_lo + t * (out_hi - out_lo)

def brightness(c):
    c = int(c)
    return max((c >> 16) & 255, (c >> 8) & 255, c & 255) / 255

def mix_colour(a, b, t):
    t = max(0, min(1, t))
    c = 0
    for s in (16, 8, 0):
        x = (a >> s) & 255
        y = (b >> s) & 255
        c |= int(x + (y - x) * t + 0.5) << s
    return c

_shown = {}
def show(led, c):
    c = int(c)
    if _shown.get(id(led)) != c:
        _shown[id(led)] = c
        led[0] = ((c >> 16) & 255, (c >> 8) & 255, c & 255)
        led.write()`

/** Logic blocks feeding other logic blocks run first, so each loop is up to date. */
function order(editor: Editor, blocks: LogicShape[]) {
	const ids = new Set(blocks.map((b) => b.id))
	const done = new Set<string>()
	const out: LogicShape[] = []
	const visit = (b: LogicShape, path: Set<string>) => {
		if (done.has(b.id) || path.has(b.id)) return
		path.add(b.id)
		for (const inp of getDef(b).inputs) {
			const wire = getIncomingWire(editor, b.id, inp.id)
			const from = wire && getWireEnds(editor, wire).from
			if (from && ids.has(from.id)) visit(from as LogicShape, path)
		}
		done.add(b.id)
		out.push(b)
	}
	for (const b of blocks) visit(b, new Set())
	return out
}

/** JSON-ish state as a Python literal. */
function pyLiteral(v: unknown): string {
	if (v === null || v === undefined) return 'None'
	if (v === true) return 'True'
	if (v === false) return 'False'
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0'
	if (typeof v === 'string') return JSON.stringify(v)
	if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`
	return `{${Object.entries(v as object).map(([k, x]) => `${JSON.stringify(k)}: ${pyLiteral(x)}`).join(', ')}}`
}
