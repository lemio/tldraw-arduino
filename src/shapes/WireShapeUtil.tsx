import { ReactNode, useRef } from 'react'
import {
	BindingUtil,
	HTMLContainer,
	Polyline2d,
	RecordProps,
	SVGContainer,
	ShapeUtil,
	TLHandle,
	TLHandleDragInfo,
	createBindingPropsMigrationIds,
	getIndices,
	createBindingPropsMigrationSequence,
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	T,
	TLBinding,
	TLShapeUtilCanBindOpts,
	Vec,
	VecLike,
	useEditor,
	useValue,
} from 'tldraw'
import {
	brightness,
	fmtColour,
	mixColour,
	fmtNumber,
	fmtPct,
	getBlock,
	getWireEnds,
	isMap,
	isPlainWire,
	outputValue,
	portTypeOf,
	transfer,
} from './signals'
import { SignalType, WIRE_DEFAULTS, WIRE_TYPE, WireShape } from './types'
import { baseColour, look, netColour } from '../style'
import { CurveGlyph } from '../ui/CurvePlot'
import { badgeSpot, isBadgeCompact } from './badges'
import { place } from './blocks'
import { halves, legOfCorner, pathOf, wireRoute } from './wireGeometry'
import { inspectedWire, layoutSiblings, layoutWire, wireDrag } from './wiring'

const versions = createShapePropsMigrationIds(WIRE_TYPE, { AddFunctions: 1, AddRouting: 2, AddColours: 3, AddVia: 4, AddCurve: 5 })
const bindingVersions = createBindingPropsMigrationIds(WIRE_TYPE, { AddPort: 1 })

/** Rooms made before wires had functions get the defaults. */
const wireMigrations = createShapePropsMigrationSequence({
	sequence: [
		{
			id: versions.AddFunctions,
			up(props: Record<string, unknown>) {
				for (const [k, v] of Object.entries(WIRE_DEFAULTS)) if (props[k] === undefined) props[k] = v
			},
		},
		{
			id: versions.AddRouting,
			up(props: Record<string, unknown>) {
				props.lane ??= 0
				props.bend ??= -1
			},
		},
		{
			id: versions.AddColours,
			up(props: Record<string, unknown>) {
				props.loColour ??= 0x000000
				props.hiColour ??= 0xffffff
			},
		},
		{
			id: versions.AddVia,
			up(props: Record<string, unknown>) {
				props.via ??= []
			},
		},
		{
			id: versions.AddCurve,
			up(props: Record<string, unknown>) {
				props.curve ??= 'linear'
				props.gamma ??= 2.2
			},
		},
	],
})

/* ------------------------------------------------------------------- shape */

export class WireShapeUtil extends ShapeUtil<WireShape> {
	static override type = WIRE_TYPE
	static override props: RecordProps<WireShape> = {
		ex: T.number,
		ey: T.number,
		fn: T.literalEnum('follow', 'toggle'),
		edge: T.literalEnum('rise', 'fall', 'both'),
		state: T.number,
		threshold: T.number,
		invert: T.boolean,
		inLo: T.number,
		inHi: T.number,
		lo: T.number,
		hi: T.number,
		lane: T.number,
		bend: T.number,
		loColour: T.number,
		hiColour: T.number,
		via: T.arrayOf(T.object({ x: T.number, y: T.number })),
		curve: T.literalEnum('linear', 'gamma', 'in', 'out', 'inout'),
		gamma: T.number,
	}
	static override migrations = wireMigrations

	getDefaultProps(): WireShape['props'] {
		return { ex: 0, ey: 0, ...WIRE_DEFAULTS, lane: 0, bend: -1, via: [] }
	}

	getGeometry(shape: WireShape) {
		const points = wireRoute(shape)
		if (Vec.Equals(points[0], points[points.length - 1])) points.push(new Vec(0.01, 0))
		return new Polyline2d({ points })
	}

	getIndicatorPath(shape: WireShape) {
		const route = wireRoute(shape)
		const path = new Path2D(pathOf(route))
		// Keep the selection line out of the badge, as tldraw does for arrow labels.
		const { from, fromPort, to, toPort } = getWireEnds(this.editor, shape.id)
		if (!from || !to) return path
		const plain = isPlainWire(shape.props, portTypeOf(from, fromPort), portTypeOf(to, toPort))
		const [bw, bh] = plain ? [22, 20] : [150, 22]
		const m = badgeSpot(this.editor, shape).clone().sub({ x: shape.x, y: shape.y })
		const bounds = this.getGeometry(shape).bounds
		const clipPath = new Path2D()
		clipPath.rect(bounds.minX - 100, bounds.minY - 100, bounds.width + 200, bounds.height + 200)
		clipPath.rect(m.x - bw / 2, m.y - bh / 2, bw, bh)
		return { path, clipPath }
	}

	/** A wire binds to its two blocks and nothing binds to it. */
	override canBind({ bindingType }: TLShapeUtilCanBindOpts) {
		return bindingType === WIRE_TYPE
	}
	override canResize() {
		return false
	}
	override canSnap() {
		return false
	}
	override hideResizeHandles() {
		return true
	}
	override hideRotateHandle() {
		return true
	}
	override hideSelectionBoundsFg() {
		return true
	}
	override onDoubleClick(shape: WireShape) {
		inspectedWire.set(shape.id)
	}

	/*
	 * Bend points. A selected wire shows a handle at every bend: solid ones are
	 * points placed by hand, the others are where the route bends by itself.
	 * Dragging either places a point there; double-clicking a placed one
	 * removes it. Points stay put in the page when the blocks move.
	 */
	override getHandles(shape: WireShape): TLHandle[] {
		const route = wireRoute(shape)
		const via = shape.props.via
		const local = via.map((p) => new Vec(p.x - shape.x, p.y - shape.y))
		const handles: TLHandle[] = []
		// Not the little steps right at a port (the lane step-out): the port is there to grab.
		const ends = [route[0], route[route.length - 1]]
		const corners = route.slice(1, -1).filter((c) => ends.every((e) => Vec.Dist(c, e) > 20))
		const indices = getIndices(corners.length + via.length + 1)
		local.forEach((p, i) => handles.push({ id: `via-${i}`, type: 'vertex', index: indices[i], x: p.x, y: p.y }))
		corners
			.filter((c) => !local.some((p) => Vec.Dist(p, c) < 1))
			.forEach((c, i) =>
				handles.push({
					// The stretch it's on, so a drag knows where the new point goes in the list.
					id: `bend-${legOfCorner(shape, c)}-${i}`,
					type: 'virtual',
					index: indices[via.length + i],
					x: c.x,
					y: c.y,
				})
			)
		return handles
	}

	override onHandleDrag(shape: WireShape, { handle, initial }: TLHandleDragInfo<WireShape>) {
		const base = initial ?? shape
		const at = { x: place(this.editor, shape.x + handle.x), y: place(this.editor, shape.y + handle.y) }
		const via = [...base.props.via]
		if (handle.id.startsWith('via-')) via[Number(handle.id.slice(4))] = at
		else via.splice(Number(handle.id.split('-')[1]), 0, at)
		return { id: shape.id, type: WIRE_TYPE as typeof WIRE_TYPE, props: { via } }
	}

	override onDoubleClickHandle(shape: WireShape, handle: TLHandle) {
		if (!handle.id.startsWith('via-')) return
		const via = shape.props.via.filter((_, i) => i !== Number(handle.id.slice(4)))
		return { id: shape.id, type: WIRE_TYPE as typeof WIRE_TYPE, props: { via } }
	}
	/** Wires follow their ports; dragging a selected wire on its own does nothing. */
	override onTranslate(initial: WireShape) {
		return { id: initial.id, type: WIRE_TYPE as typeof WIRE_TYPE, x: initial.x, y: initial.y }
	}

	component(shape: WireShape) {
		return <Wire shape={shape} />
	}
}

function Wire({ shape }: { shape: WireShape }) {
	const editor = useEditor()
	const route = wireRoute(shape)
	useValue(look) // corners and colours follow the look

	const info = useValue(
		'wire',
		() => {
			const ends = getWireEnds(editor, shape.id)
			const drag = wireDrag.get()
			// While dragging, preview against the port the wire would snap to.
			const mine = drag?.wireId === shape.id ? drag : null
			const preview = mine?.candidate ? getBlock(editor, mine.candidate.id) : undefined
			const a = ends.from ?? (mine?.terminal === 'start' ? preview : undefined)
			const aPort = ends.from ? ends.fromPort : (mine?.candidate?.port ?? '')
			const b = ends.to ?? (mine?.terminal === 'end' ? preview : undefined)
			const bPort = ends.to ? ends.toPort : (mine?.candidate?.port ?? '')
			if (!a) return null
			const src = portTypeOf(a, aPort)
			const dst = b ? portTypeOf(b, bPort) : src
			const v = outputValue(editor, a, aPort)
			return {
				net: netColour(editor, a.id, aPort),
				src,
				dst,
				connected: !!b,
				in: v,
				out: b ? transfer(shape.props, src, dst, v, shape.props.state) : v,
			}
		},
		[editor, shape.id]
	)
	const active = useValue(
		'active',
		() =>
			editor.getHoveredShapeId() === shape.id ||
			editor.getSelectedShapeIds().includes(shape.id) ||
			inspectedWire.get() === shape.id,
		[editor, shape.id]
	)

	const [h1, h2] = halves(route)
	// The badge sits where the room-wide layout found space for it (shape space).
	const spot = useValue('badge', () => badgeSpot(editor, shape), [editor, shape])
	const mid = spot.clone().sub({ x: shape.x, y: shape.y })
	const compact = useValue('compact badge', () => isBadgeCompact(editor, shape), [editor, shape])
	const plain = !info || isPlainWire(shape.props, info.src, info.dst)

	return (
		<>
			<SVGContainer className="wire">
				<path className="wire-base" d={pathOf(route)} style={info ? { stroke: baseColour(info.net) } : undefined} />
				{info && (
					<>
						<path className="wire-signal" d={pathOf(h1)} style={signalStyle(info.in, info.src, info.net)} />
						<path className="wire-signal" d={pathOf(h2)} style={signalStyle(info.out, info.dst, info.net)} />
					</>
				)}
			</SVGContainer>
			{info?.connected && (!plain || active) && (
				<HTMLContainer>
					<WireBadge shape={shape} at={mid} src={info.src} dst={info.dst} level={info.in} compact={compact} />
				</HTMLContainer>
			)}
		</>
	)
}

/**
 * Full ink only where there is signal: a HIGH wire is drawn in its net's
 * colour, a LOW wire fades to the faint line under it, an analog wire is as
 * strong as its level, and a colour wire carries its colour.
 */
function signalStyle(v: number, type: SignalType, net: string): React.CSSProperties {
	if (type === 'colour') return { stroke: fmtColour(v), opacity: v ? 1 : 0 }
	if (type === 'digital') return { stroke: net, opacity: v >= 0.5 ? 1 : 0 }
	if (type === 'number') return { stroke: net, opacity: v ? 1 : 0 }
	return { stroke: net, opacity: Math.min(1, Math.max(0, v)) }
}

const arrowFor = { rise: '↑', fall: '↓', both: '↕' } as const

/**
 * Says what the wire does, right where it does it: a cast, a threshold, a
 * map, an inversion or a toggle. A plain wire shows only an ƒ while hovered.
 * Click to edit; on an analog threshold, drag sideways to move it.
 */
function WireBadge({
	shape,
	at: p,
	src,
	dst,
	level,
	compact,
}: {
	shape: WireShape
	at: VecLike
	src: SignalType
	dst: SignalType
	level: number
	/** Too little room: words only, no meter or gradient. */
	compact: boolean
}) {
	const editor = useEditor()
	const drag = useRef<{ x: number; t: number; moved: boolean } | null>(null)
	const w = shape.props
	const style = { left: p.x, top: p.y }
	const thresholded = src !== 'digital' && !isMap(w, src, dst)
	const fs = levelFormat(src)
	const fd = levelFormat(dst)
	const open = () => {
		editor.select(shape.id)
		inspectedWire.set(shape.id)
	}

	const parts: ReactNode[] = []
	if (isPlainWire(w, src, dst)) {
		// nothing to say: just the ƒ
	} else if (isMap(w, src, dst)) {
		parts.push(
			<span key="map" className="cast-th">
				{src === 'colour' && <Swatch colour={level} />}
				{fs(w.inLo)}–{fs(w.inHi)} {w.curve !== 'linear' && <CurveGlyph curve={w.curve} gamma={w.gamma} />}
				<span className="cast-arrow">→</span>{' '}
				{dst === 'colour' ? (
					compact ? (
						<>
							<Swatch colour={w.loColour} />
							<Swatch colour={w.hiColour} />
						</>
					) : (
						<Fade from={w.loColour} to={w.hiColour} at={(lvOf(src, level) - w.inLo) / (w.inHi - w.inLo || 1e-6)} />
					)
				) : (
					`${fd(w.lo)}–${fd(w.hi)}`
				)}
			</span>
		)
	}
	if (thresholded) {
		const W = 36
		const lv = src === 'colour' ? brightness(level) : level
		parts.push(
			<span key="th" className="cast-th">
				{src === 'colour' && <Swatch colour={level} />}
				{src !== 'number' && !compact && (
					// A meter only where the scale is known; a number has no 100 %.
					<svg width={W} height={10} className="cast-meter" aria-hidden>
						<line className="track" x1={0} x2={W} y1={5} y2={5} />
						<line className="level" x1={0} x2={W * lv} y1={5} y2={5} />
						<line className="tick" x1={W * w.threshold} x2={W * w.threshold} y1={0} y2={10} />
					</svg>
				)}
				<span className={lv > w.threshold ? 'cast-on' : undefined}>&gt; {fs(w.threshold)}</span>
			</span>
		)
	}
	if (w.fn === 'toggle') parts.push(<span key="tg">toggle {arrowFor[w.edge]}</span>)
	if (dst === 'digital' && w.invert) parts.push(<span key="not">NOT</span>)
	if (dst === 'colour' && !isMap(w, src, dst)) {
		parts.push(
			<span key="lv" className="cast-th">
				<span className="cast-from">LOW</span>
				<Swatch colour={w.loColour} />
				<span className="cast-from">HIGH</span>
				<Swatch colour={w.hiColour} />
			</span>
		)
	} else if (dst !== 'digital' && !isMap(w, src, dst)) {
		parts.push(
			<span key="lv">
				{w.lo === 0 || compact ? null : (
					<>
						<span className="cast-from">LOW</span> <span className="cast-arrow">→</span> {fd(w.lo)}{' '}
					</>
				)}
				<span className="cast-from">HIGH</span> <span className="cast-arrow">→</span> {fd(w.hi)}
			</span>
		)
	}

	return (
		<div
			className={`cast${parts.length ? '' : ' cast-fn'}${thresholded ? ' cast-adjust' : ''}`}
			style={style}
			title={
				thresholded
					? 'Click to edit what this wire does. Drag sideways to move the threshold.'
					: 'Click to edit what this wire does'
			}
			onPointerDown={(e) => {
				e.stopPropagation()
				if (!thresholded) return
				editor.markHistoryStoppingPoint('threshold')
				e.currentTarget.setPointerCapture(e.pointerId)
				drag.current = { x: e.clientX, t: w.threshold, moved: false }
			}}
			onPointerMove={(e) => {
				const d = drag.current
				if (!d) return
				const dx = (e.clientX - d.x) / editor.getZoomLevel()
				if (Math.abs(dx) > 3) d.moved = true
				const t = Math.round(Math.min(0.99, Math.max(0.01, d.t + dx / 140)) * 100) / 100
				if (d.moved && t !== w.threshold) editor.updateShape({ id: shape.id, type: WIRE_TYPE, props: { threshold: t } })
			}}
			onPointerUp={() => {
				const moved = drag.current?.moved
				drag.current = null
				if (!moved) open()
			}}
		>
			{parts.length ? parts.flatMap((part, i) => (i ? [<span key={`s${i}`} className="cast-sep" />, part] : [part])) : 'ƒ'}
		</div>
	)
}

const lvOf = (src: SignalType, v: number) => (src === 'colour' ? brightness(v) : v)

/** A colour, shown as a colour. */
export function Swatch({ colour, title }: { colour: number; title?: string }) {
	return <i className="cast-swatch" style={{ background: fmtColour(colour) }} title={title ?? fmtColour(colour)} />
}

/** A fade between two colours, with where the signal is on it right now. */
function Fade({ from, to, at }: { from: number; to: number; at: number }) {
	const t = Math.min(1, Math.max(0, at))
	return (
		<span className="cast-fade" style={{ background: `linear-gradient(90deg, ${fmtColour(from)}, ${fmtColour(to)})` }}>
			<i style={{ left: `${t * 100}%`, background: fmtColour(mixColour(from, to, t)) }} />
		</span>
	)
}

/** Levels read as % on a 0..1 scale, and as plain numbers on a number port. */
export const levelFormat = (t: SignalType) => (t === 'number' ? fmtNumber : fmtPct)

/* ----------------------------------------------------------------- binding */

export class WireBindingUtil extends BindingUtil<TLBinding<typeof WIRE_TYPE>> {
	static override type = WIRE_TYPE
	static override props = { terminal: T.literalEnum('start', 'end'), port: T.string }
	static override migrations = createBindingPropsMigrationSequence({
		sequence: [
			{
				id: bindingVersions.AddPort,
				up(props: Record<string, unknown>) {
					props.port ??= ''
				},
			},
		],
	})

	getDefaultProps() {
		return { terminal: 'start' as const, port: '' }
	}

	override onAfterCreate({ binding }: { binding: TLBinding<typeof WIRE_TYPE> }) {
		layoutWire(this.editor, binding.fromId)
	}

	override onAfterChangeToShape({ binding }: { binding: TLBinding<typeof WIRE_TYPE> }) {
		layoutWire(this.editor, binding.fromId)
	}

	/** When a wire leaves a fan-out, the others close up. */
	override onAfterDelete({ binding }: { binding: TLBinding<typeof WIRE_TYPE> }) {
		if (binding.props.terminal === 'start' && this.editor.getShape(binding.toId)) {
			layoutSiblings(this.editor, binding.toId, binding.props.port ?? '')
		}
	}

	/** A wire with a missing block is meaningless; take it along. */
	override onBeforeDeleteToShape({ binding }: { binding: TLBinding<typeof WIRE_TYPE> }) {
		this.editor.deleteShape(binding.fromId)
	}
}
