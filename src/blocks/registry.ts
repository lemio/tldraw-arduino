import type { BlockDef, PortSpec } from './define'
import type { LogicShape, SignalType } from '../shapes/types'

/** Every file in library/ that default-exports a block. */
const modules = import.meta.glob<{ default: BlockDef }>('./library/**/*.{ts,tsx}', { eager: true })

export const LIBRARY: BlockDef[] = Object.values(modules)
	.map((m) => m.default)
	.filter(Boolean)

const byId = new Map(LIBRARY.map((d) => [d.id, d]))

/** Palette order; categories not listed here follow alphabetically. */
const ORDER = ['Time', 'Variables', 'Logic', 'Colour', 'Display', 'Python']

/** What the palette offers. */
export const OFFERED = LIBRARY.filter((d) => !d.hidden)

export function categories() {
	const cats = [...new Set(OFFERED.map((d) => d.category))]
	return cats.sort((a, b) => {
		const ia = ORDER.indexOf(a)
		const ib = ORDER.indexOf(b)
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
	})
}

/* ------------------------------------------------------------ Python block */

/** A block written on the canvas: its definition travels in the shape itself. */
export interface CustomDef {
	title: string
	/** e.g. "trigger:digital, seconds:number=5" */
	inputs: string
	outputs: string
	display: string
	python: string
}

export const CUSTOM_ID = 'custom'

export const DEFAULT_CUSTOM: CustomDef = {
	title: 'Python',
	inputs: 'in:analog',
	outputs: 'out:analog',
	display: 'out',
	python: `def update(b):
    # Read inputs with b.get(name), write outputs with b.set(name, value).
    b.set('out', 1 - b.get('in'))
`,
}

const TYPES: SignalType[] = ['digital', 'analog', 'number', 'colour']

/** "trigger:digital, seconds:number=5 s" → port specs. Unknown types become analog. */
export function parsePorts(spec: string): PortSpec[] {
	return spec
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const m = /^([A-Za-z_]\w*)\s*(?::\s*(\w+))?\s*(?:=\s*([-\w.#]+))?\s*(\S+)?$/.exec(part)
			if (!m) return null
			const type = (TYPES.includes(m[2] as SignalType) ? m[2] : 'analog') as SignalType
			let def: number | undefined
			if (m[3] !== undefined) def = m[3].startsWith('#') ? parseInt(m[3].slice(1), 16) : Number(m[3])
			return { id: m[1], type, default: Number.isFinite(def) ? def : undefined, unit: m[4] }
		})
		.filter((p): p is NonNullable<typeof p> => !!p)
}

export const formatPorts = (ports: PortSpec[]) =>
	ports
		.map((p) => `${p.id}:${p.type}${p.default !== undefined ? `=${p.type === 'colour' ? '#' + p.default.toString(16).padStart(6, '0') : p.default}` : ''}${p.unit ? ` ${p.unit}` : ''}`)
		.join(', ')

const customCache = new Map<string, BlockDef>()

function customDef(raw: unknown): BlockDef {
	const c = { ...DEFAULT_CUSTOM, ...(raw as Partial<CustomDef>) }
	const key = JSON.stringify(c)
	let def = customCache.get(key)
	if (!def) {
		const outputs = parsePorts(c.outputs)
		def = {
			id: CUSTOM_ID,
			category: 'Python',
			title: c.title || 'Python',
			description: 'A block you write yourself, in MicroPython',
			inputs: parsePorts(c.inputs),
			outputs,
			display: outputs.some((o) => o.id === c.display) ? c.display : (outputs[0]?.id ?? ''),
			python: c.python,
		}
		if (customCache.size > 200) customCache.clear()
		customCache.set(key, def)
	}
	return def
}

const MISSING: BlockDef = {
	id: 'missing',
	category: 'Other',
	title: 'Unknown block',
	description: 'This document uses a block this version does not have',
	inputs: [],
	outputs: [],
	display: '',
	python: 'def update(b):\n    pass\n',
}

export function getDef(shape: LogicShape): BlockDef {
	if (shape.props.def === CUSTOM_ID) return customDef(shape.props.custom)
	return byId.get(shape.props.def) ?? { ...MISSING, title: `Unknown block “${shape.props.def}”` }
}

export const getLibraryDef = (id: string) => byId.get(id)

/** The definition a fresh Python block starts from. */
export const defaultCustomDef = () => customDef(DEFAULT_CUSTOM)
