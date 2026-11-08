import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Editor, TLShapeId, useEditor, useValue } from 'tldraw'
import { getSeries, sampleTick } from '../shapes/history'
import { channelSeries, playback } from '../shapes/playback'
import {
	Block,
	blockName,
	brightness,
	fmtColour,
	fmtPct,
	getWireEnds,
	isMap,
	isPlainWire,
	outputValue,
	portTypeOf,
	simulate,
} from '../shapes/signals'
import { CLIP_TYPE, ClipShape, Curve, Edge, LOGIC_TYPE, SignalType, WIRE_TYPE, WireShape, WireShapeProps } from '../shapes/types'
import { levelFormat } from '../shapes/WireShapeUtil'
import { badgeSpot } from '../shapes/badges'
import { inspectedWire } from '../shapes/wiring'
import { CURVES, CurvePlot } from './CurvePlot'
import { ColourStrip, Trace } from './Sparkline'

/**
 * The Logic Definer for one wire: follow or toggle, threshold, invert, map
 * ranges, output levels. The input is drawn above its result, from a recording
 * when there is one, so a threshold can be set against what really happened.
 */
export function WireInspector() {
	const editor = useEditor()
	const id = useValue(inspectedWire)
	const state = useValue(
		'inspector',
		() => {
			if (!id) return null
			const wire = editor.getShape(id) as WireShape | undefined
			if (!wire || wire.type !== WIRE_TYPE) return null
			const { from, fromPort, to, toPort } = getWireEnds(editor, wire)
			if (!from || !to) return null
			return { wire, from, fromPort, to, toPort, at: editor.pageToViewport(badgeSpot(editor, wire)) }
		},
		[editor, id]
	)

	// Close when the wire disappears, or when something else gets selected.
	const selected = useValue('sel', () => (id ? editor.getSelectedShapeIds().includes(id) : false), [editor, id])
	useEffect(() => {
		if (id && (!state || !selected)) inspectedWire.set(null)
	}, [id, state, selected])

	if (!state) return null
	return <Panel editor={editor} {...state} />
}

type PanelProps = {
	editor: Editor
	wire: WireShape
	from: Block
	fromPort: string
	to: Block
	toPort: string
	at: { x: number; y: number }
}

function Panel({ editor, wire, from, fromPort, to, toPort, at }: PanelProps) {
	const p = wire.props
	const src = portTypeOf(from, fromPort)
	const dst = portTypeOf(to, toPort)
	const map = isMap(p, src, dst)
	const showThreshold = src !== 'digital' && !map

	const set = (props: Partial<WireShapeProps>, mark = true) => {
		if (mark) editor.markHistoryStoppingPoint('wire function')
		editor.updateShape({ id: wire.id, type: WIRE_TYPE, props })
	}

	// Below the badge if it fits, else above it, else as high as it goes.
	const W = 288
	const ref = useRef<HTMLDivElement>(null)
	const [height, setHeight] = useState(0)
	useLayoutEffect(() => setHeight(ref.current?.offsetHeight ?? 0))
	const viewport = editor.getViewportScreenBounds()
	const left = Math.min(Math.max(8, at.x - W / 2), viewport.w - W - 8)
	const floor = viewport.h - 72 // clear of tldraw's toolbar
	const below = at.y + 20
	const above = at.y - 20 - height
	const top = below + height <= floor ? below : above >= 56 ? above : Math.max(56, floor - height)

	return (
		<div
			ref={ref}
			className="insp"
			style={{ left, top, width: W, visibility: height ? 'visible' : 'hidden' }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<header>
				<span>
					{blockName(from)}
					<span className="insp-arrow"> → </span>
					{blockName(to)}
				</span>
				<button className="insp-close" title="Close" onClick={() => inspectedWire.set(null)}>
					×
				</button>
			</header>

			<div className="insp-row">
				<Segmented
					value={p.fn}
					options={[
						['follow', 'Follow', 'The output follows the input'],
						['toggle', 'Toggle', 'Each press (edge) flips the output'],
					]}
					onChange={(fn) => set({ fn: fn as WireShapeProps['fn'] })}
				/>
				{p.fn === 'toggle' && (
					<Segmented
						value={p.edge}
						options={[
							['rise', '↑', 'Flip when the input goes HIGH'],
							['fall', '↓', 'Flip when the input goes LOW'],
							['both', '↕', 'Flip on every change'],
						]}
						onChange={(edge) => set({ edge: edge as Edge })}
					/>
				)}
				{p.via.length > 0 && (
					<button className="insp-straighten" title="Remove the bend points placed by hand" onClick={() => set({ via: [] })}>
						Straighten
					</button>
				)}
				{dst === 'digital' && (
					<label className="insp-check" title="Swap HIGH and LOW">
						<input type="checkbox" checked={p.invert} onChange={(e) => set({ invert: e.target.checked })} />
						Invert
					</label>
				)}
			</div>

			<Traces
				editor={editor}
				wire={wire}
				fromId={from.id}
				fromPort={from.type === LOGIC_TYPE ? fromPort : undefined}
				src={src}
				dst={dst}
				showThreshold={showThreshold}
				set={set}
			/>

			{map && (
				<div className="insp-levels">
					<CurvePicker p={p} set={set} />
					{src === 'number' || dst === 'number' ? (
						<>
							{/* A number has no fixed scale: type the ranges, and see the curve's shape. */}
							<div className="insp-ranges">
								<span>in</span>
								<NumberField value={p.inLo} onChange={(inLo) => set({ inLo })} />
								<span>–</span>
								<NumberField value={p.inHi} onChange={(inHi) => set({ inHi })} />
								{dst !== 'colour' && (
									<>
										<span>out</span>
										<NumberField value={p.lo} onChange={(lo) => set({ lo })} />
										<span>–</span>
										<NumberField value={p.hi} onChange={(hi) => set({ hi })} />
									</>
								)}
							</div>
							<CurvePlot
								p={{ ...p, inLo: 0, inHi: 1, lo: 0, hi: 1 }}
								level={(outputValue(editor, from, fromPort) - p.inLo) / (p.inHi - p.inLo || 1e-6)}
								colour={dst === 'colour'}
								set={set}
								editable={false}
							/>
						</>
					) : (
						<CurvePlot
							p={p}
							level={src === 'colour' ? brightness(outputValue(editor, from, fromPort)) : outputValue(editor, from, fromPort)}
							colour={dst === 'colour'}
							set={set}
						/>
					)}
					{dst === 'colour' && <ColourPair p={p} labels={['start', 'end']} set={set} />}
				</div>
			)}

			{dst === 'colour' && !map && (
				<div className="insp-levels">
					<ColourPair p={p} labels={['LOW →', 'HIGH →']} set={set} />
				</div>
			)}

			{dst !== 'digital' && dst !== 'colour' && !map && (
				<div className="insp-levels">
					{dst === 'number' ? (
						<div className="insp-ranges">
							<span>LOW →</span>
							<NumberField value={p.lo} onChange={(lo) => set({ lo })} />
							<span>HIGH →</span>
							<NumberField value={p.hi} onChange={(hi) => set({ hi })} />
						</div>
					) : (
						<>
							<Level label="LOW →" value={p.lo} onChange={(lo, mark) => set({ lo }, mark)} />
							<Level label="HIGH →" value={p.hi} onChange={(hi, mark) => set({ hi }, mark)} />
						</>
					)}
				</div>
			)}

			<p className="insp-note">{describe(p, src, dst)}</p>
		</div>
	)
}

/** One sentence, in words, of what the wire does now. */
function describe(p: WireShapeProps, src: SignalType, dst: SignalType) {
	const fs = levelFormat(src)
	const fd = levelFormat(dst)
	const what = src === 'colour' ? 'the colour’s brightness' : 'the input'
	const cond = src === 'digital' ? 'the input is HIGH' : `${what} is above ${fs(p.threshold)}`
	if (isPlainWire(p, src, dst)) return 'The value passes through unchanged.'
	const col = (c: number) => fmtColour(c)
	if (isMap(p, src, dst)) {
		const bend = { linear: '', gamma: `, on a gamma ${p.gamma.toFixed(1)} curve`, in: ', easing in', out: ', easing out', inout: ', easing in and out' }[p.curve]
		const input = `${src === 'colour' ? 'Brightness' : 'Input'} ${fs(p.inLo)}–${fs(p.inHi)}`
		if (dst === 'colour') return `${input} fades the colour from ${col(p.loColour)} to ${col(p.hiColour)}${bend}.`
		return `${input} becomes output ${fd(p.lo)}–${fd(p.hi)}${bend}.`
	}
	const out = (high: boolean) =>
		dst === 'digital' ? (high !== p.invert ? 'HIGH' : 'LOW') : dst === 'colour' ? col(high ? p.hiColour : p.loColour) : fd(high ? p.hi : p.lo)
	const outHigh = out(true)
	const outLow = out(false)
	if (p.fn === 'toggle') {
		const when = { rise: 'becomes true', fall: 'stops being true', both: 'changes' }[p.edge]
		return `Each time “${cond}” ${when}, the output flips between ${outLow} and ${outHigh}.`
	}
	return `The output is ${outHigh} while ${cond}, otherwise ${outLow}.`
}

/* ---------------------------------------------------------------- traces */

/**
 * The input over time with the threshold drawn across it, and right below,
 * the output this wire makes of it. Drag on the input to move the threshold.
 */
function Traces({
	editor,
	wire,
	fromId,
	fromPort,
	src,
	dst,
	showThreshold,
	set,
}: {
	editor: Editor
	wire: WireShape
	fromId: TLShapeId
	/** Set for a logic block's output, whose history is kept per port. */
	fromPort?: string
	src: SignalType
	dst: SignalType
	showThreshold: boolean
	set(props: Partial<WireShapeProps>, mark?: boolean): void
}) {
	const clips = useValue(
		'clips',
		() =>
			editor
				.getCurrentPageShapes()
				.filter((s): s is ClipShape => s.type === CLIP_TYPE && (s as ClipShape).props.channels.some((c) => c.id === fromId)),
		[editor, fromId]
	)
	const pb = useValue(playback)
	const preferred = pb && clips.some((c) => c.id === pb.clipId) ? pb.clipId : clips[clips.length - 1]?.id
	const [choice, setChoice] = useState<TLShapeId | 'live' | null>(null)
	const source = choice === 'live' ? 'live' : (clips.find((c) => c.id === choice)?.id ?? preferred ?? 'live')
	const clip = clips.find((c) => c.id === source)

	useValue('tick', () => (source === 'live' ? sampleTick.get() : 0), [source])
	const input: ArrayLike<number> = clip ? (channelSeries(clip, fromId) ?? []) : getSeries(fromId, fromPort)
	const output = simulate(wire.props, src, dst, input)
	const W = 236
	const H = 34
	const ref = useRef<SVGSVGElement>(null)

	const thresholdFrom = (e: React.PointerEvent) => {
		const r = ref.current!.getBoundingClientRect()
		const t = 1 - (e.clientY - r.top - 2) / (r.height - 4)
		return Math.round(Math.min(0.99, Math.max(0.01, t)) * 100) / 100
	}

	const playheadX = clip && pb?.clipId === clip.id ? (pb.t / clip.props.duration) * W : null

	return (
		<div className="insp-traces">
			<div className="insp-sources">
				<button className={source === 'live' ? 'is-on' : ''} onClick={() => setChoice('live')}>
					Live
				</button>
				{clips.map((c, i) => (
					<button key={c.id} className={source === c.id ? 'is-on' : ''} onClick={() => setChoice(c.id)}>
						{c.props.label || `Recording ${i + 1}`}
					</button>
				))}
			</div>
			{src === 'colour' && (
				// The colour itself; underneath, the brightness a threshold or fade works on.
				<div className="insp-trace">
					<span />
					<ColourStrip data={input} width={W} height={12} slots={input.length} />
				</div>
			)}
			<div className="insp-trace">
				<span>{src === 'colour' ? 'light' : 'in'}</span>
				<div style={{ position: 'relative' }}>
					{src === 'colour' && !showThreshold && !isMap(wire.props, src, dst) ? (
						<ColourStrip data={input} width={W} height={H} slots={input.length} />
					) : (
						<Trace
							data={src === 'colour' ? Array.from(input, brightness) : input}
							width={W}
							height={H}
							stepped={src === 'digital'}
							dot={!clip}
							scale={src === 'number' ? 'auto' : undefined}
						/>
					)}
					{showThreshold && (
						<svg
							ref={ref}
							className="insp-threshold"
							width={W}
							height={H}
							onPointerDown={(e) => {
								editor.markHistoryStoppingPoint('threshold')
								e.currentTarget.setPointerCapture(e.pointerId)
								set({ threshold: thresholdFrom(e) }, false)
							}}
							onPointerMove={(e) => {
								if (e.currentTarget.hasPointerCapture(e.pointerId)) set({ threshold: thresholdFrom(e) }, false)
							}}
						>
							<title>Drag up or down to move the threshold</title>
							<line x1={0} x2={W} y1={2 + (1 - wire.props.threshold) * (H - 4)} y2={2 + (1 - wire.props.threshold) * (H - 4)} />
							<text x={W} y={(1 - wire.props.threshold) * (H - 4) - 2} textAnchor="end">
								{fmtPct(wire.props.threshold)}
							</text>
						</svg>
					)}
					{playheadX !== null && <i className="insp-playhead" style={{ left: playheadX }} />}
				</div>
			</div>
			<div className="insp-trace">
				<span>out</span>
				<div style={{ position: 'relative' }}>
					{dst === 'colour' ? (
						<ColourStrip data={output} width={W} height={H} slots={output.length} />
					) : (
						<Trace
							data={output}
							width={W}
							height={H}
							stepped={dst === 'digital' || src === 'digital' || wire.props.fn === 'toggle'}
							dot={!clip}
							scale={dst === 'number' ? 'auto' : undefined}
						/>
					)}
					{playheadX !== null && <i className="insp-playhead" style={{ left: playheadX }} />}
				</div>
			</div>
			<div className="insp-caption">
				{clip ? `${clip.props.label || 'Recording'} · ${clip.props.duration.toFixed(1)} s` : 'last 10 s'}
			</div>
		</div>
	)
}

/* -------------------------------------------------------------- controls */

/** Linear, gamma or an easing; with gamma, its exponent. */
function CurvePicker({ p, set }: { p: WireShapeProps; set(props: Partial<WireShapeProps>, mark?: boolean): void }) {
	return (
		<div className="insp-curve">
			<Segmented
				value={p.curve}
				options={CURVES.map(([v, label, title]) => [v, label, title] as [string, string, string])}
				onChange={(curve) => set({ curve: curve as Curve })}
			/>
			{p.curve === 'gamma' && (
				<label className="insp-gamma" title="The exponent: 1 is straight, 2.2 matches how eyes see LED light">
					γ
					<input
						type="range"
						min={0.2}
						max={4}
						step={0.1}
						value={p.gamma}
						onPointerDown={() => set({}, true)}
						onChange={(e) => set({ gamma: Number(e.target.value) }, false)}
					/>
					<b>{p.gamma.toFixed(1)}</b>
				</label>
			)}
		</div>
	)
}

/** The two colours of a cast into colour, each with the system colour picker. */
function ColourPair({
	p,
	labels,
	set,
}: {
	p: WireShapeProps
	labels: [string, string]
	set(props: Partial<WireShapeProps>, mark?: boolean): void
}) {
	return (
		<div className="insp-colours">
			{(['loColour', 'hiColour'] as const).map((key, i) => (
				<label key={key} className="insp-colour">
					<span>{labels[i]}</span>
					<i className="insp-swatch" style={{ background: fmtColour(p[key]) }} />
					<code>{fmtColour(p[key])}</code>
					<input
						type="color"
						value={fmtColour(p[key])}
						onChange={(e) => set({ [key]: parseInt(e.target.value.slice(1), 16) })}
					/>
				</label>
			))}
			<span
				className="insp-fade"
				style={{ background: `linear-gradient(90deg, ${fmtColour(p.loColour)}, ${fmtColour(p.hiColour)})` }}
			/>
		</div>
	)
}

/** A number typed in, committed on Enter or blur. */
function NumberField({ value, onChange }: { value: number; onChange(v: number): void }) {
	const [text, setText] = useState(String(value))
	useEffect(() => setText(String(value)), [value])
	const commit = () => {
		const v = Number(text)
		if (Number.isFinite(v) && v !== value) onChange(v)
		else setText(String(value))
	}
	return (
		<input
			className="insp-number"
			value={text}
			inputMode="decimal"
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				e.stopPropagation()
				if (e.key === 'Enter') commit()
			}}
		/>
	)
}

function Segmented({
	value,
	options,
	onChange,
}: {
	value: string
	options: [string, string, string][]
	onChange(v: string): void
}) {
	return (
		<div className="seg">
			{options.map(([v, label, title]) => (
				<button key={v} title={title} className={v === value ? 'is-on' : ''} onClick={() => v !== value && onChange(v)}>
					{label}
				</button>
			))}
		</div>
	)
}

/** A hairline slider, like the one on output blocks. */
function Level({ label, value, onChange }: { label: string; value: number; onChange(v: number, mark: boolean): void }) {
	const ref = useRef<HTMLDivElement>(null)
	const at = (e: React.PointerEvent) => {
		const r = ref.current!.getBoundingClientRect()
		return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100) / 100
	}
	return (
		<div className="insp-level">
			<span>{label}</span>
			<div
				ref={ref}
				className="io-slider"
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId)
					onChange(at(e), true)
				}}
				onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && onChange(at(e), false)}
			>
				<div className="io-slider-fill" style={{ width: `${value * 100}%` }} />
				<div className="io-slider-knob" style={{ left: `${value * 100}%` }} />
			</div>
			<b>{fmtPct(value)}</b>
		</div>
	)
}
