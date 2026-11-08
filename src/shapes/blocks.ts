import {
	Editor,
	TLBaseBoxShape,
	TLResizeInfo,
	TLShape,
	TLShapeId,
	TLShapePartial,
	VecLike,
	createShapeId,
	resizeBox,
} from 'tldraw'
import { logicSize } from '../blocks/layout'
import { CUSTOM_ID, DEFAULT_CUSTOM, defaultCustomDef, getLibraryDef } from '../blocks/registry'
import { CAMERA_TYPE, IO_TYPE, IoKind, IoShape, LOGIC_TYPE, suggestPin } from './types'

/*
 * Blocks live on a 16 px grid. A block is 240 × 96, so its port (at half
 * height) lands on a grid line: two aligned blocks get a perfectly straight wire.
 */
export const GRID = 16
export const IO_W = 240
export const IO_H = 96

export const snap = (v: number) => Math.round(v / GRID) * GRID

/** Blocks snap to the grid while tldraw's "Show grid" is on, as its own shapes do. */
export const isGridOn = (editor: Editor) => editor.getInstanceState().isGridMode

/** A position on the grid when the grid is on, else left as it is. */
export const place = (editor: Editor, v: number) => (isGridOn(editor) ? snap(v) : v)

/** For ShapeUtil.onTranslate: keep the dragged block on the grid. */
export function snapToGrid<S extends TLShape>(editor: Editor, initial: S, current: S) {
	if (!isGridOn(editor)) return
	const x = snap(current.x)
	const y = snap(current.y)
	if (x === current.x && y === current.y) return
	return { id: initial.id, type: initial.type, x, y } as TLShapePartial<S>
}

export function usedPins(editor: Editor) {
	const used = new Set<number>()
	for (const s of editor.getCurrentPageShapes()) {
		if (s.type === IO_TYPE && (s as IoShape).props.pin >= 0) used.add((s as IoShape).props.pin)
	}
	return used
}

/** Create an IO block centred on `at` (page space). */
export function createIoBlock(editor: Editor, kind: IoKind, at: VecLike): TLShapeId {
	const id = createShapeId()
	editor.createShape({
		id,
		type: IO_TYPE,
		x: place(editor, at.x - IO_W / 2),
		y: place(editor, at.y - IO_H / 2),
		props: {
			kind,
			pin: suggestPin(kind, usedPins(editor)),
			pull: kind === 'din' ? 'up' : 'none',
		},
	})
	return id
}

/** Create a logic block (from the library, or a Python block) centred on `at`. */
export function createLogicBlock(
	editor: Editor,
	defId: string,
	at: VecLike,
	params: Record<string, number> = {}
): TLShapeId {
	const id = createShapeId()
	const def = defId === CUSTOM_ID ? defaultCustomDef() : getLibraryDef(defId)
	const size = def ? logicSize(def) : { w: 240, h: 96 }
	editor.createShape({
		id,
		type: LOGIC_TYPE,
		x: place(editor, at.x - size.w / 2),
		y: place(editor, at.y - size.h / 2),
		props: {
			def: defId,
			w: size.w,
			h: size.h,
			custom: defId === CUSTOM_ID ? { ...DEFAULT_CUSTOM } : {},
			params,
		},
	})
	return id
}

export function createCameraBlock(editor: Editor, at: VecLike): TLShapeId {
	const id = createShapeId()
	editor.createShape({ id, type: CAMERA_TYPE, x: place(editor, at.x - 200), y: place(editor, at.y - 152), props: { w: 400, h: 304 } })
	editor.sendToBack([id])
	return id
}

/**
 * Wires sit behind blocks, and cameras behind everything, so value blocks can
 * be laid over the video like labels on a documentation shot.
 */
export function sendWireToBack(editor: Editor, wireId: TLShapeId) {
	editor.sendToBack([wireId])
	const cameras = editor.getCurrentPageShapes().filter((s) => s.type === CAMERA_TYPE)
	if (cameras.length) editor.sendToBack(cameras)
}

/**
 * For ShapeUtil.onResize: snap the edges being dragged to the grid and leave
 * the opposite edges exactly where they were, so nothing jumps when a block
 * is resized from its left or top. Sizes move in whole steps (IO blocks step
 * their height by two cells, keeping the port on a grid line).
 */
export function snapResize<S extends TLBaseBoxShape>(
	editor: Editor,
	shape: S,
	info: TLResizeInfo<S>,
	{ minW, minH, maxH = Infinity, hStep = GRID }: { minW: number; minH: number; maxH?: number; hStep?: number }
) {
	if (!isGridOn(editor)) return resizeBox(shape, info, { minWidth: minW, minHeight: minH, maxHeight: maxH })
	const r = resizeBox(shape, info)
	const init = info.initialShape
	const handle = String(info.handle)
	const size = (d: number, step: number, min: number, max = Infinity) =>
		Math.min(max, Math.max(min, Math.round(d / step) * step))

	let left = init.x
	let right = init.x + init.props.w
	let top = init.y
	let bottom = init.y + init.props.h
	if (handle.includes('left')) left = right - size(right - r.x, GRID, minW)
	if (handle.includes('right')) right = left + size(r.x + r.props.w - left, GRID, minW)
	if (handle.includes('top')) top = bottom - size(bottom - r.y, hStep, minH, maxH)
	if (handle.includes('bottom')) bottom = top + size(r.y + r.props.h - top, hStep, minH, maxH)

	return { ...r, x: left, y: top, props: { ...r.props, w: right - left, h: bottom - top } }
}

/**
 * The centre of the nearest free spot in view for a block of this size: new
 * blocks never land on top of others (and so never hide their ports).
 */
export function nextDropPoint(editor: Editor, size = { w: IO_W, h: IO_H }, near?: VecLike) {
	const view = editor.getViewportPageBounds()
	const centre = near ?? view.center
	const taken = editor
		.getCurrentPageShapes()
		.filter((s) => s.type !== 'wire')
		.map((s) => editor.getShapePageBounds(s))
		.filter((b): b is NonNullable<typeof b> => !!b)
	const margin = GRID * 2
	const free = (x: number, y: number) =>
		taken.every(
			(b) =>
				x + size.w + margin <= b.minX || x - margin >= b.maxX || y + size.h + margin <= b.minY || y - margin >= b.maxY
		)
	// Spiral out from the middle (of the view, or of `near`), on the grid.
	const cx = snap(centre.x - size.w / 2)
	const cy = snap(centre.y - size.h / 2)
	const step = GRID * 4
	for (let r = 0; r < 24; r++) {
		for (let dx = -r; dx <= r; dx++) {
			for (let dy = -r; dy <= r; dy++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
				const x = cx + dx * step
				const y = cy + dy * step
				if (free(x, y)) return { x: x + size.w / 2, y: y + size.h / 2 }
			}
		}
	}
	return { x: centre.x, y: centre.y }
}
