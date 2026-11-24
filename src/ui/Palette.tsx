import { useState } from 'react'
import { Editor, TLShapeId, VecLike, atom, useEditor, useValue } from 'tldraw'
import { isPhone } from '../phone'
import { CUSTOM_ID, OFFERED, categories, defaultCustomDef } from '../blocks/registry'
import { logicSize } from '../blocks/layout'
import { IO_H, IO_W, createCameraBlock, createIoBlock, createLogicBlock, nextDropPoint } from '../shapes/blocks'
import { IoKind, KIND_INFO, SignalType, signalType } from '../shapes/types'
import { editingCustom } from '../blocks/CustomEditor'

interface Item {
	key: string
	title: string
	hint: string
	/** Glyph: the type of value the block produces (or takes, for outputs). */
	glyph: SignalType | 'camera' | 'python'
	make(editor: Editor, at: VecLike): TLShapeId
	/** Footprint, so a click can find it a free spot. */
	size: { w: number; h: number }
	/** Ask for a name straight away (hardware is named after the real thing). */
	name?: boolean
	after?(id: TLShapeId): void
}

const io = (kind: IoKind): Item => ({
	key: kind,
	title: KIND_INFO[kind].title,
	hint: KIND_INFO[kind].hint,
	glyph: signalType(kind),
	make: (editor, at) => createIoBlock(editor, kind, at),
	size: { w: IO_W, h: IO_H },
	name: true,
})

function groups(): { title: string; items: Item[] }[] {
	return [
		{ title: 'Inputs', items: [io('din'), io('ain')] },
		{ title: 'Outputs', items: [io('dout'), io('aout'), io('rgb')] },
		...categories().map((title) => ({
			title,
			items: OFFERED.filter((d) => d.category === title).map(
				(d): Item => ({
					key: d.id,
					title: d.title,
					hint: d.description,
					glyph: (d.outputs.find((o) => o.id === d.display) ?? d.outputs[0])?.type ?? 'number',
					make: (editor, at) => createLogicBlock(editor, d.id, at),
					size: logicSize(d),
				})
			),
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

/** Whether the palette is out. On a phone it starts folded away, to give the canvas the screen. */
export const paletteOpen = atom('palette open', !isPhone)

/**
 * Everything that can go on the canvas, grouped by what it is. Click to add a
 * block in view, or drag it to where it should go.
 */
export function Palette() {
	const editor = useEditor()
	const [ghost, setGhost] = useState<{ item: Item; x: number; y: number } | null>(null)
	const open = useValue(paletteOpen)

	const add = (item: Item, at: VecLike) => {
		editor.markHistoryStoppingPoint('add block')
		const id = item.make(editor, at)
		editor.setCurrentTool('select')
		editor.select(id)
		if (item.name) editor.setEditingShape(id)
		item.after?.(id)
		// On a phone the palette covers the canvas: fold it away to show the new block.
		if (isPhone) paletteOpen.set(false)
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
			<button
				className={`palette-toggle${open ? ' is-open' : ''}`}
				title={open ? 'Hide the blocks' : 'Show the blocks, to add one to the canvas'}
				aria-expanded={open}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => paletteOpen.set(!open)}
			>
				<svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
					{open ? <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" /> : <path d="M2 3.5 H14 M2 8 H14 M2 12.5 H14" />}
				</svg>
				Blocks
			</button>
			{open && (
				<nav className="palette" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
					{groups().map((g) => (
						<section key={g.title}>
							<h3>{g.title}</h3>
							{g.items.map((item) => (
								<button key={item.key} title={item.hint} onPointerDown={(e) => startDrag(item, e)}>
									<i className={`glyph glyph-${item.glyph}`} />
									{item.title}
								</button>
							))}
						</section>
					))}
				</nav>
			)}
			{ghost && (
				<div className="palette-ghost" style={{ left: ghost.x, top: ghost.y }}>
					<i className={`glyph glyph-${ghost.item.glyph}`} />
					{ghost.item.title}
				</div>
			)}
		</>
	)
}
