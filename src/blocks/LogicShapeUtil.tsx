import { plcName, plcSymbol, portName } from '../plc/names'
import { useLayoutEffect, useRef, useState } from 'react'
import {
	HTMLContainer,
	JsonObject,
	RecordProps,
	Rectangle2d,
	ShapeUtil,
	T,
	TLResizeInfo,
	TLShapeUtilCanBindOpts,
	stopEventPropagation,
	useEditor,
	useValue,
} from 'tldraw'
import { GRID, snapResize, snapToGrid } from '../shapes/blocks'
import { detailZoom, headHeight, look, outlineW } from '../style'
import { ColourValue, NameInput } from '../shapes/IoShapeUtil'
import { blockPorts, fmtNumber, fmtPct, getIncomingWire, inputValue, isRecorded, outputValue } from '../shapes/signals'
import { playback } from '../shapes/playback'
import { LOGIC_TYPE, LogicShape, SignalType, WIRE_TYPE } from '../shapes/types'
import { Port } from '../ui/Port'
import { Sparkline } from '../ui/Sparkline'
import { PortSpec, RenderContext, Tier } from './define'
import { HEAD, LOGIC_W, ROW, logicTier, simpler } from './layout'
import { CUSTOM_ID, getDef } from './registry'
import { editingCustom } from './CustomEditor'
import { executionIndex } from './order'
import { IecType, fmtIec, fmtTime, iecOfSignal, isPlc, isPlcStopped, parseTime } from '../plc/iec'

/** A port's IEC type in PLC mode, else null (the maker formats apply). */
const iecFor = (plc: boolean, p: PortSpec): IecType | null => (plc ? (p.iec ?? iecOfSignal(p.type)) : null)

export class LogicShapeUtil extends ShapeUtil<LogicShape> {
	static override type = LOGIC_TYPE
	static override props: RecordProps<LogicShape> = {
		def: T.string,
		w: T.number,
		h: T.number,
		label: T.string,
		params: T.dict(T.string, T.number),
		presses: T.dict(T.string, T.number),
		out: T.dict(T.string, T.number),
		state: T.jsonValue as T.Validatable<JsonObject>,
		error: T.string,
		custom: T.jsonValue as T.Validatable<JsonObject>,
	}

	getDefaultProps(): LogicShape['props'] {
		return {
			def: 'time.wait',
			w: LOGIC_W,
			h: 128,
			label: '',
			params: {},
			presses: {},
			out: {},
			state: {},
			error: '',
			custom: {},
		}
	}

	getGeometry(shape: LogicShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	getIndicatorPath(shape: LogicShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 12)
		return p
	}

	override canEdit() {
		return true
	}
	override canBind({ bindingType }: TLShapeUtilCanBindOpts) {
		return bindingType === WIRE_TYPE
	}
	override hideRotateHandle() {
		return true
	}
	override onResize(shape: LogicShape, info: TLResizeInfo<LogicShape>) {
		return snapResize(this.editor, shape, info, { minW: 96, minH: GRID * 2, maxH: 480, hStep: GRID * 2 })
	}
	override onTranslate(initial: LogicShape, current: LogicShape) {
		return snapToGrid(this.editor, initial, current)
	}

	component(shape: LogicShape) {
		return <LogicBlock shape={shape} />
	}
}

/* ------------------------------------------------------------------ block */

function LogicBlock({ shape }: { shape: LogicShape }) {
	const editor = useEditor()
	const { w, h, label, params, error, state } = shape.props
	const def = getDef(shape)
	// Detail follows size on screen; the ports stay where the block's own size puts them.
	useValue(look)
	const zoom = useValue('zoom', () => detailZoom(editor.getZoomLevel()), [editor])
	const tier = simpler(logicTier(def, h), logicTier(def, h * zoom))
	const ports = blockPorts(shape)
	const display = def.outputs.find((o) => o.id === def.display) ?? def.outputs[0]
	// What each output is now — or, while a recording is scrubbed, what it was then.
	const out = useValue(
		'outputs',
		() => Object.fromEntries(def.outputs.map((p) => [p.id, outputValue(editor, shape, p.id)])),
		[editor, shape, def]
	)
	const value = display ? (out[display.id] ?? 0) : 0
	const replaying = useValue(
		'replaying',
		() => {
			const pb = playback.get()
			return !!pb && def.outputs.some((p) => isRecorded(editor, pb.clipId, shape, p.id))
		},
		[editor, shape, def]
	)
	const isEditing = useValue('editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const isOnlySelected = useValue('selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
	// PLC mode: IEC values, every pin's value shown, and the block's place in the scan.
	const plc = useValue('plc', () => isPlc(editor), [editor])
	const stopped = useValue('stopped', () => isPlcStopped(editor), [editor])
	const step = useValue('step', () => (plc ? executionIndex(editor, shape.id) : 0), [editor, shape.id, plc])
	// Which inputs are wired, and what arrives at each: drawn next to the ports.
	const arriving = useValue(
		'inputs',
		() => Object.fromEntries(def.inputs.map((p) => [p.id, inputValue(editor, shape, p.id)])),
		[editor, shape, def]
	)
	const wired = useValue(
		'wired',
		() => new Set(def.inputs.filter((p) => getIncomingWire(editor, shape.id, p.id)).map((p) => p.id)),
		[editor, shape.id, def]
	)

	const update = (props: Partial<LogicShape['props']>, record = true) => {
		if (record) editor.markHistoryStoppingPoint()
		editor.run(() => editor.updateShape({ id: shape.id, type: LOGIC_TYPE, props }), {
			history: record ? 'record' : 'ignore',
		})
	}
	const setParam = (id: string, v: number, record = true) => update({ params: { ...params, [id]: v } }, record)
	const press = (id: string) => update({ presses: { ...shape.props.presses, [id]: (shape.props.presses[id] ?? 0) + 1 } }, false)

	const ctx: RenderContext = {
		tier,
		w,
		h,
		out,
		inputs: arriving,
		params: { ...Object.fromEntries((def.settings ?? []).map((x) => [x.id, x.default])), ...params },
		state: state as Record<string, unknown>,
		setParam: (id, v) => setParam(id, v, false),
		press,
	}
	const custom = def.render?.[tier]

	const name = label || plcName(def)
	const nameEl = isEditing ? (
		<NameInput
			value={label}
			placeholder={def.example ?? `What is it for? (${plcName(def)})`}
			onCommit={(v) => v !== label && update({ label: v })}
			onDone={() => editor.setEditingShape(null)}
		/>
	) : (
		<span
			className={`io-label${isOnlySelected ? ' is-renamable' : ''}`}
			style={isOnlySelected ? { pointerEvents: 'all' } : undefined}
			title={`${def.description}. ${isOnlySelected ? 'Click' : 'Double-click'} to name it.`}
			onPointerDown={(e) => isOnlySelected && clickNotDrag(e, () => editor.setEditingShape(shape.id))}
		>
			{name}
		</span>
	)

	// A block that lays itself out keeps its rows level with its ports at every zoom:
	// its header follows the block's own height, not its size on screen.
	const own = def.layout
	const head = own ? own.head(h) : tier !== 'value'

	const progress = plc && tier === 'full' && def.plc?.progress ? def.plc.progress({ out, inputs: arriving }) : null
	const main = custom ? (
		custom(ctx)
	) : display ? (
		progress === null ? (
			<MainValue shape={shape} port={display} value={value} tier={tier} plc={plc} />
		) : (
			<div className="plc-main">
				<MainValue shape={shape} port={display} value={value} tier={tier} plc={plc} />
				<div className="plc-progress" title={`${Math.round(Math.max(0, Math.min(1, progress)) * 100)} %`}>
					<i style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
				</div>
			</div>
		)
	) : null

	return (
		<HTMLContainer
			className={`io logic logic-tier-${tier} io-tier-${tier}${error ? ' has-error' : ''}${replaying ? ' io-replay' : ''}${plc ? ' is-plc' : ''}${stopped ? ' is-stopped' : ''}`}
			style={{ width: w, height: h }}
		>
			{head && (
				<div className="io-head">
					{nameEl}
					<span className="io-chips">
						{step > 0 && (
							<span className="chip chip-step" title={`Runs ${ordinal(step)} in every scan`}>
								{step}
							</span>
						)}
						{(label || def.plc) && (
							<span className="chip chip-kind" title={`${plcName(def)}: ${def.description}`}>
								{label ? (plcSymbol(def) ?? plcName(def)) : (plcSymbol(def) ?? def.title)}
							</span>
						)}
						{shape.props.def === CUSTOM_ID && (
							<button
								className="chip"
								style={{ pointerEvents: 'all' }}
								title="Edit this block's ports and MicroPython"
								onPointerDown={stopEventPropagation}
								onClick={() => editingCustom.set(shape.id)}
							>
								Python
							</button>
						)}
					</span>
				</div>
			)}

			{own ? (
				<div className="logic-plain">{!head && isEditing ? <div className="logic-plain-name">{nameEl}</div> : main}</div>
			) : tier === 'full' ? (
				<div
					className="logic-grid"
					style={{
						top: HEAD,
						bottom: def.controls?.length ? 40 : 8,
						gridTemplateRows: `repeat(${Math.max(1, def.inputs.length, def.outputs.length)}, ${ROW}px) 1fr`,
					}}
				>
					<div className="logic-ins">
						{def.inputs.map((p) => (
							<InputLabel
								key={p.id}
								port={p}
								plc={plc}
								wired={wired.has(p.id)}
								value={arriving[p.id]}
								onChange={(v, record) => setParam(p.id, v, record)}
							/>
						))}
					</div>
					<div className="logic-main" style={{ gridRow: '1 / -1' }}>
						{main}
					</div>
					<div className="logic-outs">
						{def.outputs.map((p) => {
							const iec = iecFor(plc, p)
							const shown = iec ? fmtIec(iec, out[p.id] ?? 0) : fmtValue(p.type, out[p.id] ?? 0, p.unit)
							return (
								<span key={p.id} className="logic-port-label" title={`${portName(plc, p)} = ${shown}`}>
									{/* Online, a PLC shows every pin's value, the main one included. */}
									{iec && <span className="logic-arriving">{shown}</span>}
									{p.id === display?.id && !iec ? '' : (p.label ?? p.id)}
								</span>
							)
						})}
					</div>
				</div>
			) : (
				<div className="io-body">
					{tier === 'value' && isEditing ? (
						nameEl
					) : (
						<>
							{/* Zoomed all the way out, a PLC block still says what it is. */}
							{plc && tier === 'value' && def.plc && (
								<span className="plc-type" title={plcName(def)}>
									{plcSymbol(def) ?? def.title}
								</span>
							)}
							{main}
						</>
					)}
				</div>
			)}

			{tier === 'full' && def.controls?.length ? (
				<div className="logic-controls">
					{def.controls.map((c) => (
						<button
							key={c.input}
							style={{ pointerEvents: 'all' }}
							title={c.title ?? `Pulse “${c.input}”`}
							onPointerDown={stopEventPropagation}
							onClick={() => press(c.input)}
						>
							{c.label}
						</button>
					))}
				</div>
			) : null}

			{error && (
				<div className="logic-error" title={error}>
					{error}
				</div>
			)}

			{ports.map((p) => (
				<Port key={`${p.side}:${p.id}`} block={shape} port={p} />
			))}
		</HTMLContainer>
	)
}

/** The block's main output: big, with its sparkline (or colour strip) beside it. */
function MainValue({ shape, port, value, tier, plc }: { shape: LogicShape; port: PortSpec; value: number; tier: Tier; plc: boolean }) {
	const ref = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const ro = new ResizeObserver(() => setWidth(el.clientWidth))
		ro.observe(el)
		setWidth(el.clientWidth)
		return () => ro.disconnect()
	}, [])
	const valueW = port.type === 'colour' ? (tier === 'full' ? 28 : 24) : VALUE_W[tier]
	const sparkW = width - valueW - 8
	const sparkH =
		tier === 'full' ? 28 : tier === 'name' ? shape.props.h - 2 * outlineW() - headHeight() - 18 : shape.props.h - 2 * outlineW() - 8
	return (
		<div className="logic-value" ref={ref}>
			{sparkW >= 24 && sparkH >= 12 && (
				<Sparkline
					id={shape.id}
					port={port.id}
					width={sparkW}
					height={sparkH}
					stepped={port.type === 'digital'}
					colour={port.type === 'colour'}
					scale={port.type === 'number' ? 'auto' : undefined}
				/>
			)}
			{port.type === 'colour' ? (
				<ColourValue value={value} showHex={false} />
			) : (
				<span className={`io-value${port.type === 'digital' && value >= 0.5 ? ' is-high' : ''}${port.type === 'digital' ? ' is-digital' : ''}`}>
					{plc ? fmtIec(iecFor(plc, port)!, value) : fmtMain(port.type, value)}
					{!plc && unitOf(port) && <small>{unitOf(port)}</small>}
					{plc && port.unit && port.iec !== 'TIME' && <small>{port.unit}</small>}
				</span>
			)}
		</div>
	)
}

const VALUE_W: Record<Tier, number> = { full: 76, name: 64, value: 48 }

const unitOf = (p: PortSpec) => (p.type === 'analog' ? '%' : p.type === 'number' ? p.unit : undefined)

function fmtMain(type: SignalType, v: number) {
	if (type === 'digital') return v >= 0.5 ? 'HIGH' : 'LOW'
	if (type === 'analog') return String(Math.round(v * 100))
	return fmtNumber(v)
}

export function fmtValue(type: SignalType, v: number, unit?: string) {
	if (type === 'digital') return v >= 0.5 ? 'HIGH' : 'LOW'
	if (type === 'analog') return fmtPct(v)
	if (type === 'colour') return '#' + (Math.round(v) & 0xffffff).toString(16).padStart(6, '0')
	return `${fmtNumber(v)}${unit ? ' ' + unit : ''}`
}

/**
 * An input's name beside its port. While nothing is wired to it, its value is
 * set right here: typed for numbers, a switch for digital, a swatch for colour.
 */
function InputLabel({
	port,
	plc,
	wired,
	value,
	onChange,
}: {
	port: PortSpec
	plc: boolean
	wired: boolean
	value: number
	onChange(v: number, record: boolean): void
}) {
	const [typing, setTyping] = useState(false)
	const label = port.label ?? port.id
	const iec = iecFor(plc, port)
	let control: React.ReactNode = null
	if (iec && iec !== 'DWORD') {
		// PLC: every unconnected input is a constant, shown and typed the IEC way.
		const shown = fmtIec(iec, value) + (port.unit && iec !== 'TIME' ? ` ${port.unit}` : '')
		if (wired) control = <span className="logic-arriving">{shown}</span>
		else if (iec === 'BOOL')
			control = (
				<button
					className="logic-param"
					style={{ pointerEvents: 'all' }}
					onPointerDown={stopEventPropagation}
					onClick={() => onChange(value >= 0.5 ? 0 : 1, true)}
					title="Click to switch"
				>
					{shown}
				</button>
			)
		else if (typing)
			control = (
				<input
					className="logic-param-input"
					autoFocus
					defaultValue={iec === 'TIME' ? fmtTime(value) : String(value)}
					onPointerDown={stopEventPropagation}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Enter') e.currentTarget.blur()
						if (e.key === 'Escape') setTyping(false)
					}}
					onBlur={(e) => {
						const text = e.currentTarget.value
						const v = iec === 'TIME' ? parseTime(text) : Number(text)
						if (v !== null && Number.isFinite(v)) onChange(iec === 'INT' ? Math.round(v) : v, true)
						setTyping(false)
					}}
				/>
			)
		else
			control = (
				<button
					className="logic-param"
					style={{ pointerEvents: 'all' }}
					onPointerDown={stopEventPropagation}
					onClick={() => setTyping(true)}
					title={iec === 'TIME' ? 'Click to change, for example T#2s500ms' : 'Click to change'}
				>
					{shown}
				</button>
			)
		return (
			<span className="logic-port-label" title={portName(plc, port)}>
				{label}
				{control}
			</span>
		)
	}
	if (wired) {
		control =
			port.type === 'colour' ? (
				<ColourValue value={value} showHex={false} title={fmtValue('colour', value)} />
			) : (
				<span className="logic-arriving">{fmtValue(port.type, value, port.unit)}</span>
			)
	} else if (port.type === 'colour') {
		control = <ColourValue value={value} showHex={false} onChange={(v) => onChange(v, true)} />
	} else if (port.type === 'digital') {
		// Only inputs with a resting value get a switch; triggers are pulsed by the buttons.
		if (port.default !== undefined)
			control = (
				<button
					className="logic-param"
					style={{ pointerEvents: 'all' }}
					onPointerDown={stopEventPropagation}
					onClick={() => onChange(value >= 0.5 ? 0 : 1, true)}
					title="Click to switch"
				>
					{value >= 0.5 ? 'HIGH' : 'LOW'}
				</button>
			)
	} else if (typing) {
		control = (
			<input
				className="logic-param-input"
				autoFocus
				defaultValue={port.type === 'analog' ? Math.round(value * 100) : value}
				onPointerDown={stopEventPropagation}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Enter') e.currentTarget.blur()
					if (e.key === 'Escape') setTyping(false)
				}}
				onBlur={(e) => {
					const v = Number(e.currentTarget.value)
					if (Number.isFinite(v)) onChange(port.type === 'analog' ? Math.min(1, Math.max(0, v / 100)) : v, true)
					setTyping(false)
				}}
			/>
		)
	} else {
		control = (
			<button
				className="logic-param"
				style={{ pointerEvents: 'all' }}
				onPointerDown={stopEventPropagation}
				onClick={() => setTyping(true)}
				title="Click to change"
			>
				{fmtValue(port.type, value, port.unit)}
			</button>
		)
	}
	return (
		<span className="logic-port-label">
			{label}
			{control}
		</span>
	)
}

const ordinal = (n: number) => {
	const s = ['th', 'st', 'nd', 'rd']
	const v = n % 100
	return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function clickNotDrag(e: React.PointerEvent, action: () => void) {
	const x = e.clientX
	const y = e.clientY
	const up = (ev: PointerEvent) => {
		window.removeEventListener('pointerup', up)
		if (Math.hypot(ev.clientX - x, ev.clientY - y) < 4) action()
	}
	window.addEventListener('pointerup', up)
}
