import { useEffect, useRef, useState } from 'react'
import {
	HTMLContainer,
	RecordProps,
	Rectangle2d,
	ShapeUtil,
	T,
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	stopEventPropagation,
	useEditor,
	useValue,
} from 'tldraw'
import { loadVideo } from '../camera/videoStore'
import { ColourStrip, Trace } from '../ui/Sparkline'
import { snapToGrid } from './blocks'
import { NameInput } from './IoShapeUtil'
import { channelRole, channelType, decodeSeries, isColourChannel, playback } from './playback'
import { CLIP_TYPE, ClipChannel, ClipShape, IO_KINDS } from './types'

const HEADER = 30
const ROW = 24
const AXIS = 22
const LABEL = 76
const TOGGLE = 20

/**
 * A clip's height: header, video, one row per shown channel (inputs, then
 * the in-between steps when expanded, then outputs), the toggle, the axis.
 */
export function clipHeight(p: Pick<ClipShape['props'], 'channels' | 'videoH' | 'expanded'>) {
	const between = p.channels.filter((c) => channelRole(c) === 'between').length
	const rows = p.channels.length - (p.expanded ? 0 : between)
	return HEADER + p.videoH + rows * ROW + (between ? TOGGLE : 0) + AXIS
}

const versions = createShapePropsMigrationIds(CLIP_TYPE, { AddSteps: 1, AddCircuit: 2 })
const clipMigrations = createShapePropsMigrationSequence({
	sequence: [
		{
			id: versions.AddSteps,
			up(props: Record<string, unknown>) {
				const channels = (props.channels as unknown[]) ?? []
				props.videoH ??= Math.max(0, (props.h as number) - HEADER - channels.length * ROW - AXIS)
				props.expanded ??= false
			},
		},
		{
			id: versions.AddCircuit,
			up(props: Record<string, unknown>) {
				props.circuit ??= ''
			},
		},
	],
})

export class ClipShapeUtil extends ShapeUtil<ClipShape> {
	static override type = CLIP_TYPE
	static override props: RecordProps<ClipShape> = {
		w: T.number,
		h: T.number,
		label: T.string,
		duration: T.number,
		hz: T.number,
		channels: T.arrayOf(
			T.object({
				id: T.string,
				label: T.string,
				kind: T.literalEnum(...IO_KINDS).optional(),
				port: T.string.optional(),
				type: T.literalEnum('digital', 'analog', 'number', 'colour').optional(),
				role: T.literalEnum('in', 'between', 'out').optional(),
				data: T.string,
			})
		),
		video: T.string,
		videoOwner: T.string,
		videoH: T.number,
		expanded: T.boolean,
		circuit: T.string,
	}
	static override migrations = clipMigrations

	getDefaultProps(): ClipShape['props'] {
		return {
			w: 360,
			h: 120,
			label: '',
			duration: 0,
			hz: 20,
			channels: [],
			video: '',
			videoOwner: '',
			videoH: 0,
			expanded: false,
			circuit: '',
		}
	}

	getGeometry(shape: ClipShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	getIndicatorPath(shape: ClipShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 12)
		return p
	}

	override canEdit() {
		return true
	}
	override canBind() {
		return false
	}
	override canResize() {
		return false
	}
	override hideResizeHandles() {
		return true
	}
	override hideRotateHandle() {
		return true
	}
	override onTranslate(initial: ClipShape, current: ClipShape) {
		return snapToGrid(this.editor, initial, current)
	}

	component(shape: ClipShape) {
		return <Clip shape={shape} />
	}
}

function Clip({ shape }: { shape: ClipShape }) {
	const editor = useEditor()
	const { w, h, label, duration, channels, video, videoOwner } = shape.props
	const pb = useValue(playback)
	const mine = pb?.clipId === shape.id
	const t = mine ? pb.t : null
	const isEditing = useValue('editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const [url, setUrl] = useState<string | null>(null)
	const [playing, setPlaying] = useState(false)
	const videoEl = useRef<HTMLVideoElement>(null)
	const rows = useRef<HTMLDivElement>(null)

	const { videoH, expanded } = shape.props
	const groups = (['in', 'between', 'out'] as const).map((role) => channels.filter((c) => channelRole(c) === role))
	const traceW = w - 24 - LABEL

	useEffect(() => {
		if (!video) return
		let u: string | null = null
		void loadVideo(video).then((blob) => blob && setUrl((u = URL.createObjectURL(blob))))
		return () => {
			if (u) URL.revokeObjectURL(u)
		}
	}, [video])

	// Scrubbing moves the video; playing lets the video (or the clock) move the playhead.
	useEffect(() => {
		const v = videoEl.current
		if (v && t !== null && !playing && Math.abs(v.currentTime - t) > 0.05) v.currentTime = t
	}, [t, playing])

	useEffect(() => {
		if (!playing) return
		const v = videoEl.current
		const t0 = playback.get()?.clipId === shape.id ? playback.get()!.t : 0
		const start = performance.now() - (t0 >= duration ? 0 : t0) * 1000
		if (v) {
			v.currentTime = t0 >= duration ? 0 : t0
			void v.play().catch(() => {})
		}
		let raf = 0
		const tick = () => {
			const now = v && !v.paused ? v.currentTime : (performance.now() - start) / 1000
			if (now >= duration) {
				playback.set({ clipId: shape.id, t: duration })
				setPlaying(false)
				return
			}
			playback.set({ clipId: shape.id, t: now })
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => {
			cancelAnimationFrame(raf)
			v?.pause()
		}
	}, [playing, duration, shape.id])

	// Leaving replay elsewhere (the banner, Esc) stops this clip too.
	useEffect(() => {
		if (!mine) setPlaying(false)
	}, [mine])

	const scrubTo = (e: React.PointerEvent) => {
		const r = rows.current!.getBoundingClientRect()
		const local = (e.clientX - r.left) / (r.width / (w - 24)) // undo the canvas zoom
		const frac = (local - LABEL) / traceW
		playback.set({ clipId: shape.id, t: Math.min(1, Math.max(0, frac)) * duration })
	}

	const playheadX = t !== null ? LABEL + (t / duration) * traceW : null
	const interactive = { pointerEvents: 'all' as const }

	return (
		<HTMLContainer className={`clip${mine ? ' is-replaying' : ''}`} style={{ width: w, height: h }}>
			<header className="clip-head">
				<button
					className="clip-play"
					style={interactive}
					onPointerDown={stopEventPropagation}
					onClick={() => setPlaying(!playing)}
					title={playing ? 'Pause' : 'Play back: the canvas shows the recorded signals'}
				>
					{playing ? '❚❚' : '▶'}
				</button>
				{isEditing ? (
					<NameInput
						className="clip-name"
						value={label}
						onCommit={(v) => v !== label && editor.updateShape({ id: shape.id, type: CLIP_TYPE, props: { label: v } })}
						onDone={() => editor.setEditingShape(null)}
					/>
				) : (
					<span className="clip-label">{label}</span>
				)}
				<span className="clip-time">
					{t !== null ? `${t.toFixed(1)} / ` : ''}
					{duration.toFixed(1)} s
				</span>
				{mine && (
					<button
						className="clip-live"
						style={interactive}
						onPointerDown={stopEventPropagation}
						onClick={() => playback.set(null)}
						title="Stop replaying and show live values again"
					>
						Live
					</button>
				)}
			</header>

			{videoH > 0 && (
				<div className="clip-video" style={{ height: videoH }}>
					{url ? (
						<video ref={videoEl} src={url} muted playsInline preload="auto" />
					) : (
						<span>Video is kept on {videoOwner}’s computer</span>
					)}
				</div>
			)}

			<div
				ref={rows}
				className="clip-rows"
				style={interactive}
				title="Drag to scrub: every block on the canvas shows that moment"
				onPointerDown={(e) => {
					stopEventPropagation(e)
					setPlaying(false)
					e.currentTarget.setPointerCapture(e.pointerId)
					scrubTo(e)
				}}
				onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrubTo(e)}
			>
				{groups[0].map((c) => (
					<ClipRow key={rowKey(c)} c={c} width={traceW} slots={duration * 20} />
				))}
				{groups[1].length > 0 && (
					<button
						className="clip-toggle"
						style={{ height: TOGGLE, pointerEvents: 'all' }}
						onPointerDown={stopEventPropagation}
						onClick={() => {
							const next = { ...shape.props, expanded: !expanded }
							editor.updateShape({ id: shape.id, type: CLIP_TYPE, props: { expanded: !expanded, h: clipHeight(next) } })
						}}
						title="The steps between inputs and outputs: what each logic block did"
					>
						{expanded ? '▾' : '▸'} {groups[1].length} in between
					</button>
				)}
				{expanded && groups[1].map((c) => <ClipRow key={rowKey(c)} c={c} width={traceW} slots={duration * 20} between />)}
				{groups[2].map((c) => (
					<ClipRow key={rowKey(c)} c={c} width={traceW} slots={duration * 20} />
				))}
				<div className="clip-axis" style={{ height: AXIS }}>
					<span style={{ left: LABEL }}>0</span>
					<span style={{ right: 0 }}>{duration.toFixed(0)} s</span>
				</div>
				{playheadX !== null && <i className="clip-playhead" style={{ left: playheadX }} />}
			</div>
		</HTMLContainer>
	)
}

const rowKey = (c: ClipChannel) => `${c.id}|${c.port ?? ''}`

/** One recorded signal: its name and its trace (a strip of colour, for a colour). */
function ClipRow({ c, width, slots, between }: { c: ClipChannel; width: number; slots: number; between?: boolean }) {
	return (
		<div className={`clip-row${between ? ' is-between' : ''}`} style={{ height: ROW }}>
			<span title={c.label}>{c.label}</span>
			{isColourChannel(c) ? (
				<ColourStrip data={decodeSeries(c.data, 'colour')} width={width} height={ROW - 6} slots={slots} />
			) : (
				<Trace
					data={decodeSeries(c.data, channelType(c))}
					width={width}
					height={ROW - 6}
					stepped={channelType(c) === 'digital'}
					dot={false}
					scale={channelType(c) === 'number' ? 'auto' : undefined}
				/>
			)}
		</div>
	)
}
