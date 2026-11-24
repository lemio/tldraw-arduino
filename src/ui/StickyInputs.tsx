import { Editor, TLShapeId, atom, react, useEditor, useValue } from 'tldraw'
import { fmtReal, isPlc } from '../plc/iec'
import { flip, isMomentary, pressHandlers } from '../shapes/inputControl'
import { playback, recordedValue } from '../shapes/playback'
import { blockName, effectiveValue, fmtColour, getIncomingWire, writeInputs } from '../shapes/signals'
import { DEVICE_INFO, IO_TYPE, IoShape, WIRE_TYPE, isContact, isInput } from '../shapes/types'
import { netColour } from '../style'
import { ContactSymbol } from './ContactSymbol'

/*
 * Sticky inputs and outputs: while testing, the buttons, switches and knobs
 * that scroll out of view stay within reach, and so do the lamps and motors
 * they drive. Each input that leaves the window (or slips under the palette)
 * is held at the left edge, level with where it is, as a small card that
 * works just like the block: hold a push button, flip a switch, slide a
 * knob. Each output is held at the right edge, showing what it does now.
 * Per person, and off until switched on.
 */

const KEY = 'micropython-canvas:sticky-inputs'
function read() {
	try {
		return localStorage.getItem(KEY) === 'on'
	} catch {
		return false
	}
}
export const stickyInputs = atom('stickyInputs', read())
react('remember sticky inputs', () => {
	const on = stickyInputs.get()
	try {
		localStorage.setItem(KEY, on ? 'on' : 'off')
	} catch {
		/* storage blocked: lasts this visit */
	}
})

const CARD_W = 192
const CARD_H = 44
const GAP = 6
/** Clear of the top bar and of tldraw's toolbar. */
const TOP = 60
const BOTTOM = 76

type Side = 'left' | 'right'

/**
 * Which inputs and outputs are out of reach, and where their cards go
 * (container coordinates): inputs at the left edge, right of the palette;
 * outputs at the right edge.
 */
function layout(editor: Editor, left: number, right: number, rightTop: number) {
	const vp = editor.getViewportScreenBounds()
	const want: Record<Side, { id: TLShapeId; y: number }[]> = { left: [], right: [] }
	for (const s of editor.getCurrentPageShapes()) {
		if (s.type !== IO_TYPE) continue
		const side: Side = isInput((s as IoShape).props.kind) ? 'left' : 'right'
		const b = editor.getShapePageBounds(s.id)
		if (!b) continue
		const tl = editor.pageToViewport(b.point)
		const br = editor.pageToViewport({ x: b.maxX, y: b.maxY })
		// Out of view, under the palette, or under where its card would go.
		const out = br.x < left + (side === 'left' ? CARD_W : 0) || tl.x > right - (side === 'right' ? CARD_W : 0) || br.y < TOP || tl.y > vp.h - BOTTOM
		if (!out) continue
		const top = side === 'right' ? rightTop : TOP
		const y = Math.min(Math.max((tl.y + br.y) / 2 - CARD_H / 2, top), vp.h - BOTTOM - CARD_H)
		want[side].push({ id: s.id, y })
	}
	const floor = vp.h - BOTTOM - CARD_H
	for (const [side, list] of Object.entries(want)) {
		const top = side === 'right' ? rightTop : TOP
		// Keep them in their order, without overlapping, inside the window.
		list.sort((a, b) => a.y - b.y)
		for (let i = 1; i < list.length; i++) list[i].y = Math.max(list[i].y, list[i - 1].y + CARD_H + GAP)
		for (let i = list.length - 1; i >= 0; i--) {
			const limit = i === list.length - 1 ? floor : list[i + 1].y - CARD_H - GAP
			list[i].y = Math.max(top, Math.min(list[i].y, limit))
		}
	}
	return [...want.left.map((c) => ({ ...c, side: 'left' as Side })), ...want.right.map((c) => ({ ...c, side: 'right' as Side }))]
}

export function StickyInputs() {
	const editor = useEditor()
	const on = useValue(stickyInputs)
	const plc = useValue('plc', () => isPlc(editor), [editor])
	// Right of the palette, which is fixed to the left of the window.
	const box = editor.getContainer().getBoundingClientRect()
	const pal = editor.getContainer().querySelector('.palette')?.getBoundingClientRect()
	const left = pal ? Math.round(pal.right - box.left + 8) : 8
	const width = useValue('viewport width', () => editor.getViewportScreenBounds().w, [editor])
	const right = width - 8
	// Under tldraw's style panel, which sits at the top right.
	const styles = editor.getContainer().querySelector('.tlui-style-panel__wrapper')?.getBoundingClientRect()
	const rightTop = styles && styles.height > 0 ? Math.round(Math.max(TOP, styles.bottom - box.top + 8)) : TOP
	const cards = useValue('sticky blocks', () => (on ? layout(editor, left, right, rightTop) : []), [editor, on, left, right, rightTop])
	if (!cards.length) return null
	return (
		<div className="sticky-dock" onPointerDown={(e) => e.stopPropagation()}>
			{cards.map((c) =>
				c.side === 'left' ? (
					<StickyCard key={c.id} id={c.id} x={left} y={c.y} plc={plc} />
				) : (
					<StickyOutput key={c.id} id={c.id} x={right - CARD_W} y={c.y} plc={plc} />
				)
			)}
		</div>
	)
}

/** The name: click to go to the block. */
function CardName({ block }: { block: IoShape }) {
	const editor = useEditor()
	return (
		<button
			className="sticky-name"
			title={`${blockName(block)}${block.props.pin >= 0 ? ` · GPIO ${block.props.pin}` : ''}. Click to go to the block.`}
			onClick={() => {
				const b = editor.getShapePageBounds(block.id)
				if (b) editor.centerOnPoint(b.center, { animation: { duration: 300 } })
			}}
		>
			{blockName(block)}
		</button>
	)
}

function StickyCard({ id, x, y, plc }: { id: TLShapeId; x: number; y: number; plc: boolean }) {
	const editor = useEditor()
	const block = useValue('block', () => editor.getShape(id) as IoShape | undefined, [editor, id])
	const value = useValue('value', () => effectiveValue(editor, id), [editor, id])
	const net = useValue('net', () => netColour(editor, id, ''), [editor, id])
	const replaying = useReplaying(id)
	if (!block) return null
	const { kind, device, live } = block.props
	const manual = !replaying && !live
	const digital = kind === 'din'
	const shown = digital ? fmtDigital(value, plc) : plc ? fmtReal(value) : `${Math.round(value * 100)} %`

	let control: React.ReactNode
	if (digital && isContact(device)) {
		control = (
			<ContactSymbol
				device={device}
				closed={value >= 0.5}
				net={net}
				active={manual}
				title={manual ? (isMomentary(device) ? 'Hold to press' : 'Click to switch') : DEVICE_INFO[device].hint}
				{...pressHandlers(editor, block)}
			/>
		)
	} else if (digital) {
		control = (
			<button className="sticky-switch" disabled={!manual} onClick={() => flip(editor, block)} title="Click to switch">
				<i className={value >= 0.5 ? 'is-on' : ''} />
			</button>
		)
	} else {
		control = (
			<input
				className="sticky-slider"
				type="range"
				min={0}
				max={1}
				step={0.001}
				value={value}
				disabled={!manual}
				onChange={(e) => writeInputs(editor, [{ id, value: Number(e.target.value) }])}
				onKeyDown={(e) => e.stopPropagation()}
			/>
		)
	}

	return (
		<div
			className={`sticky-card${digital && value >= 0.5 ? ' is-high' : ''}${manual ? '' : ' is-live'}`}
			style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
		>
			<CardName block={block} />
			<span className="sticky-control">{control}</span>
			<span className="sticky-value">{shown}</span>
			<i className={`sticky-port sticky-port-${digital ? 'digital' : 'analog'}`} />
		</div>
	)
}

/**
 * An output, held at the right edge: what it is doing now. One that no wire
 * drives can be worked from here too, as on its block.
 */
function StickyOutput({ id, x, y, plc }: { id: TLShapeId; x: number; y: number; plc: boolean }) {
	const editor = useEditor()
	const block = useValue('block', () => editor.getShape(id) as IoShape | undefined, [editor, id])
	const value = useValue('value', () => effectiveValue(editor, id), [editor, id])
	const wired = useValue('wired', () => !!getIncomingWire(editor, id), [editor, id])
	const net = useValue(
		'net',
		() => {
			const w = getIncomingWire(editor, id)
			const from = w && editor.getBindingsFromShape(w, WIRE_TYPE).find((b) => b.props.terminal === 'start')
			return from ? netColour(editor, from.toId, from.props.port ?? '') : 'var(--ink)'
		},
		[editor, id]
	)
	const replaying = useReplaying(id)
	if (!block) return null
	const { kind } = block.props
	const manual = !replaying && !wired
	const set = (v: number) => editor.updateShape({ id, type: IO_TYPE, props: { value: Math.min(1, Math.max(0, v)) } })
	const digital = kind === 'dout'
	const on = kind === 'rgb' ? !!(Math.round(value) & 0xffffff) : value >= 0.5

	let control: React.ReactNode
	let shown: string
	if (kind === 'rgb') {
		shown = fmtColour(value)
		control = <i className="sticky-lamp is-colour" style={{ background: fmtColour(value) }} />
	} else if (digital) {
		shown = fmtDigital(value, plc)
		control = (
			<button
				className={`sticky-lamp${on ? ' is-on' : ''}`}
				style={{ ['--net' as string]: net }}
				disabled={!manual}
				title={manual ? 'Click to switch' : 'Driven by its wire'}
				onClick={() => set(on ? 0 : 1)}
			/>
		)
	} else {
		shown = plc ? fmtReal(value) : `${Math.round(value * 100)} %`
		control = manual ? (
			<input
				className="sticky-slider"
				type="range"
				min={0}
				max={1}
				step={0.001}
				value={value}
				onChange={(e) => set(Number(e.target.value))}
				onKeyDown={(e) => e.stopPropagation()}
			/>
		) : (
			<span className="sticky-level" style={{ ['--net' as string]: net }}>
				<i style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }} />
			</span>
		)
	}

	return (
		<div
			className={`sticky-card is-output${digital && on ? ' is-high' : ''}`}
			style={{ left: x, top: y, width: CARD_W, height: CARD_H }}
		>
			<CardName block={block} />
			<span className="sticky-control">{control}</span>
			<span className="sticky-value">{shown}</span>
			<i className={`sticky-port sticky-port-${kind === 'rgb' ? 'colour' : digital ? 'digital' : 'analog'}`} />
		</div>
	)
}

const fmtDigital = (v: number, plc: boolean) => (plc ? (v >= 0.5 ? 'TRUE' : 'FALSE') : v >= 0.5 ? 'HIGH' : 'LOW')

function useReplaying(id: TLShapeId) {
	const editor = useEditor()
	return useValue(
		'replaying',
		() => {
			const pb = playback.get()
			return !!pb && recordedValue(editor, pb.clipId, id, pb.t) !== undefined
		},
		[editor, id]
	)
}
