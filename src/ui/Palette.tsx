import { useState } from 'react'
import { Editor, TLShapeId, VecLike, useEditor, useValue } from 'tldraw'
import { CUSTOM_ID, categories, defaultCustomDef, offered } from '../blocks/registry'
import { iecOfIo, isPlc } from '../plc/iec'
import { logicSize } from '../blocks/layout'
import { IO_H, IO_W, createCameraBlock, createIoBlock, createLogicBlock, nextDropPoint } from '../shapes/blocks'
import { DEVICE_INFO, InputDevice, IoKind, KIND_INFO, SignalType, signalType } from '../shapes/types'
import { plcName, plcSymbol } from '../plc/names'
import { DeviceIcon } from './ContactSymbol'
import { stickyInputs } from './StickyInputs'
import { editingCustom } from '../blocks/CustomEditor'

interface Item {
	key: string
	title: string
	/** The IEC code or operator symbol, beside the full name. */
	tag?: string
	hint: string
	/** A symbol in place of the glyph: an input's contact. */
	icon?: React.ReactNode
	/** Glyph: the type of value the block produces (or takes, for outputs). */
	glyph: SignalType | 'camera' | 'python'
	make(editor: Editor, at: VecLike): TLShapeId
	/** Footprint, so a click can find it a free spot. */
	size: { w: number; h: number }
	/** Ask for a name straight away (hardware is named after the real thing). */
	name?: boolean
	after?(id: TLShapeId): void
}

const PLC_HINT: Record<IoKind, string> = {
	din: 'A BOOL input at %IX: a button, switch or sensor contact',
	ain: 'A REAL input at %IW, 0.0–1.0: a knob or sensor',
	dout: 'A BOOL output at %QX: a lamp, relay or buzzer',
	aout: 'A REAL output at %QW, 0.0–1.0: pulse-width modulation for a dimmer or motor speed',
	rgb: 'A DWORD output: a WS2812 colour LED (the DevKit has one on GPIO 38)',
}

const io = (kind: IoKind, plc = false, device?: InputDevice): Item => ({
	key: device ? `${kind}-${device}` : kind,
	title:
		device && device !== 'signal' ? DEVICE_INFO[device].title : plc ? `${KIND_INFO[kind].title} · ${iecOfIo(kind)}` : KIND_INFO[kind].title,
	hint: device && device !== 'signal' ? DEVICE_INFO[device].hint : plc ? PLC_HINT[kind] : KIND_INFO[kind].hint,
	glyph: signalType(kind),
	icon: device && device !== 'signal' ? <DeviceIcon device={device} size={0.6} weight={1.1} /> : undefined,
	make: (editor, at) => createIoBlock(editor, kind, at, device),
	size: { w: IO_W, h: IO_H },
	name: true,
})

function groups(plc: boolean): { title: string; items: Item[]; pinnable?: boolean }[] {
	return [
		{
			title: plc ? 'Inputs (%I)' : 'Inputs',
			pinnable: true,
			items: [io('din', plc, 'no'), io('din', plc, 'nc'), io('din', plc, 'toggle'), io('din', plc, 'signal'), io('ain', plc)],
		},
		{
			title: plc ? 'Outputs (%Q)' : 'Outputs',
			pinnable: true,
			items: [io('dout', plc), io('aout', plc), io('rgb', plc)],
		},
		...categories(plc).map((title) => ({
			title,
			items: offered(plc)
				.filter((d) => d.category === title)
				.map((d): Item => ({
					key: d.id,
					title: plcName(d),
					tag: d.plc ? (plcSymbol(d) ?? d.title) : undefined,
					hint: d.plc ? `${plcName(d)} (${d.title}): ${d.description}` : d.description,
					glyph: (d.outputs.find((o) => o.id === d.display) ?? d.outputs[0])?.type ?? 'number',
					make: (editor, at) => createLogicBlock(editor, d.id, at),
					size: logicSize(d),
				})),
		})),
		{
			title: 'Python',
			items: [
				{
					key: CUSTOM_ID,
					title: 'Python block',
					hint: 'Write your own block in MicroPython',
					glyph: 'python',
					make: (editor, at) => createLogicBlock(editor, CUSTOM_ID, at),
					size: logicSize(defaultCustomDef()),
					after: (id) => editingCustom.set(id),
				},
			],
		},
		{
			title: 'Media',
			items: [
				{
					key: 'camera',
					title: 'Camera',
					hint: 'A webcam or a phone, live for everyone on the canvas',
					glyph: 'camera',
					make: (editor, at) => createCameraBlock(editor, at),
					size: { w: 400, h: 304 },
				},
			],
		},
	]
}

/**
 * Everything that can go on the canvas, grouped by what it is. Click to add a
 * block in view, or drag it to where it should go.
 */
export function Palette() {
	const editor = useEditor()
	const plc = useValue('plc', () => isPlc(editor), [editor])
	const [ghost, setGhost] = useState<{
		item: Item
		x: number
		y: number
	} | null>(null)

	const add = (item: Item, at: VecLike) => {
		editor.markHistoryStoppingPoint('add block')
		const id = item.make(editor, at)
		editor.setCurrentTool('select')
		editor.select(id)
		if (item.name) editor.setEditingShape(id)
		item.after?.(id)
	}

	const startDrag = (item: Item, e: React.PointerEvent) => {
		e.stopPropagation()
		const x0 = e.clientX
		const y0 = e.clientY
		let dragging = false
		const move = (ev: PointerEvent) => {
			if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) dragging = true
			if (dragging) setGhost({ item, x: ev.clientX, y: ev.clientY })
		}
		const up = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
			setGhost(null)
			const overPalette = (ev.target as Element).closest?.('.palette')
			if (!dragging) add(item, nextDropPoint(editor, item.size))
			else if (!overPalette) add(item, editor.screenToPage({ x: ev.clientX, y: ev.clientY }))
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}

	return (
		<>
			<nav className={`palette${plc ? ' is-plc' : ''}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
				{groups(plc).map((g) => (
					<section key={g.title}>
						<h3>
							{g.title}
							{g.pinnable && <StickyToggle />}
						</h3>
						{g.items.map((item) => (
							<button key={item.key} title={item.hint} onPointerDown={(e) => startDrag(item, e)}>
								{item.icon ?? <i className={`glyph glyph-${item.glyph}`} />}
								<span className="palette-title">{item.title}</span>
								{item.tag && <small className="palette-tag">{item.tag}</small>}
							</button>
						))}
					</section>
				))}
			</nav>
			{ghost && (
				<div className="palette-ghost" style={{ left: ghost.x, top: ghost.y }}>
					<i className={`glyph glyph-${ghost.item.glyph}`} />
					{ghost.item.title}
				</div>
			)}
		</>
	)
}

/** Keep every input within reach at the left edge, and every output in view at the right, wherever the canvas scrolls. */
function StickyToggle() {
	const on = useValue(stickyInputs)
	return (
		<button
			className={`palette-pin${on ? ' is-on' : ''}`}
			title={
				on
					? 'Inputs stick to the left edge and outputs to the right when scrolled away. Click to stop.'
					: 'Keep inputs at the left edge and outputs at the right edge when they scroll out of view, to work and watch them while testing'
			}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={() => stickyInputs.set(!on)}
		>
			<svg viewBox="0 0 16 16" width={12} height={12} aria-hidden>
				<path d="M6 2 h4 M8 2 v5 M4.5 7 h7 l-1.5 3 h-4 z M8 10 v4" />
			</svg>
		</button>
	)
}
