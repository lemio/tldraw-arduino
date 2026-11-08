import { Editor, atom } from 'tldraw'
import { WIRE_TYPE } from './shapes/types'

/*
 * Two looks. The default follows Schematik's circuit drawings
 * (circuit_minimal.html) with its URL settings, defaulting to
 * ?color=multi&text=big&uniform=1&width=4:
 *
 *   ?color=multi | single   every net (a wire and its siblings) its own colour, or all ink
 *   ?width=4                 wire weight in px, 0.5–8
 *   ?text=big | normal | giant
 *
 * "Classic" (Preferences → Classic look, or ?style=classic) is the earlier
 * look: white cards with hairline edges and one accent blue for live signal.
 * Wires here have one weight everywhere, so ?uniform needs no handling.
 */

export type Look = 'schematik' | 'classic'

const QS = new URLSearchParams(location.search)
const STORAGE = 'micropython-canvas:look'

function initialLook(): Look {
	const q = QS.get('style')
	if (q === 'classic' || q === 'schematik') return q
	try {
		return localStorage.getItem(STORAGE) === 'classic' ? 'classic' : 'schematik'
	} catch {
		return 'schematik'
	}
}

/** The current look, for this person only. */
export const look = atom<Look>('look', initialLook())

export function setLook(next: Look) {
	look.set(next)
	try {
		localStorage.setItem(STORAGE, next)
	} catch {
		/* storage blocked: it lasts this visit */
	}
	applyStyle()
}

const MULTI = (QS.get('color') ?? 'multi') !== 'single'
const LINE_W = Math.min(8, Math.max(0.5, parseFloat(QS.get('width') ?? '') || 4))
const TEXT = ({ normal: 1, big: 1.3, giant: 1.65 } as Record<string, number>)[QS.get('text') ?? 'big'] ?? 1.3

const schematik = () => look.get() === 'schematik'

/** Box outline weight: a fine ink line, not a heavy one. */
export const outlineW = () => 1 // whole pixels: browsers draw a 1.5 px border at 1 px, and the pins centre on it
export const textScale = () => (schematik() ? TEXT : 1)
/**
 * How much smaller a block reads on screen, for choosing its level of detail.
 * Full detail down to 75 % zoom; below that, blocks simplify as if resized,
 * so a block at exactly its full height doesn't lose detail at 90 %.
 */
export const detailZoom = (zoom: number) => Math.min(1, zoom / 0.75)

/** Height of a block's header line, as the CSS draws it. */
export const headHeight = () => (schematik() ? 16 * TEXT : 18)
/** Wire bends: square in Schematik's drawings, rounded in the classic look. */
export const cornerRadius = () => (schematik() ? 0 : 10)

/** From Schematik's net colours: ten that stay distinct next to each other, none of them grey. */
const NET_COLOURS = [
	'#d7263d', // red
	'#1e3a8a', // navy
	'#22c55e', // green
	'#f77f00', // orange
	'#7c3aed', // violet
	'#0d9488', // teal
	'#db2777', // pink
	'#0ea5e9', // sky
	'#9c6644', // brown
	'#ca8a04', // ochre
]

function hash(s: string) {
	let h = 2166136261
	for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
	return h >>> 0
}

let cacheKey = ''
let cache = new Map<string, string>()

/**
 * The colour of a net: everything leaving one output port. Each net starts
 * from a colour picked by its id and moves on to the next free one, so the
 * nets on a page differ while there are colours to go round; every
 * collaborator works out the same assignment, with nothing stored.
 * The classic look has one colour for all live signal: the accent.
 */
export function netColour(editor: Editor, blockId: string, port: string) {
	if (!schematik()) return 'var(--accent)'
	if (!MULTI) return 'var(--ink)'
	const nets = new Set<string>()
	for (const s of editor.getCurrentPageShapes()) {
		if (s.type !== WIRE_TYPE) continue
		const b = editor.getBindingsFromShape(s, WIRE_TYPE).find((x) => x.props.terminal === 'start')
		if (b) nets.add(`${b.toId}|${b.props.port ?? ''}`)
	}
	const keys = [...nets].sort()
	const key = keys.join(',')
	if (key !== cacheKey) {
		cacheKey = key
		cache = new Map()
		const used = new Set<number>()
		for (const k of keys) {
			let i = hash(k) % NET_COLOURS.length
			for (let n = 0; n < NET_COLOURS.length && used.has(i); n++) i = (i + 1) % NET_COLOURS.length
			used.add(i)
			if (used.size === NET_COLOURS.length) used.clear() // all taken: start sharing
			cache.set(k, NET_COLOURS[i])
		}
	}
	return cache.get(`${blockId}|${port}`) ?? NET_COLOURS[hash(`${blockId}|${port}`) % NET_COLOURS.length]
}

/** The quiet line under a wire's signal: its net colour, faint, or the classic grey hairline. */
export const baseColour = (net: string) => (schematik() ? net : 'var(--ink-3)')

export function applyStyle() {
	const root = document.documentElement
	root.classList.toggle('style-schematik', schematik())
	root.classList.toggle('style-classic', !schematik())
	root.style.setProperty('--lw', `${schematik() ? LINE_W : 2.5}px`)
	root.style.setProperty('--gw', `${outlineW()}px`)
	root.style.setProperty('--fs', String(textScale()))
}
