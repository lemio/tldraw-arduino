import { useLayoutEffect, useRef } from 'react'
import {
	HTMLContainer,
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
import type { Tier } from '../blocks/define'
import { simpler } from '../blocks/layout'
import { detailZoom, headHeight, look, outlineW } from '../style'
import { pinPickerFor } from '../ui/PinPicker'
import { Port } from '../ui/Port'
import { Sparkline } from '../ui/Sparkline'
import { GRID, IO_H, IO_W, snapResize, snapToGrid } from './blocks'
import { playback, recordedValue } from './playback'
import { blockPorts, effectiveValue, fmtColour, getIncomingWire, writeInputs } from './signals'
import {
	ADC_FULL_SCALE_V,
	AnalogUnit,
	IO_KINDS,
	IO_TYPE,
	IoKind,
	IoShape,
	KIND_INFO,
	Pull,
	SUPPLY_V,
	WIRE_TYPE,
	isInput,
	signalType,
} from './types'

export class IoShapeUtil extends ShapeUtil<IoShape> {
	static override type = IO_TYPE
	static override props: RecordProps<IoShape> = {
		kind: T.literalEnum(...IO_KINDS),
		w: T.number,
		h: T.number,
		label: T.string,
		pin: T.number,
		pull: T.literalEnum('none', 'up', 'down'),
		unit: T.literalEnum('raw', 'volt', 'pct'),
		value: T.number,
		live: T.boolean,
	}

	getDefaultProps(): IoShape['props'] {
		return {
			kind: 'din',
			w: IO_W,
			h: IO_H,
			label: '',
			pin: -1,
			pull: 'none',
			unit: 'raw',
			value: 0,
			live: false,
		}
	}

	getGeometry(shape: IoShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	getIndicatorPath(shape: IoShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 12)
		return p
	}

	override canEdit() {
		return true
	}
	/** Blocks connect through wires only; tldraw arrows stay annotations. */
	override canBind({ bindingType }: TLShapeUtilCanBindOpts) {
		return bindingType === WIRE_TYPE
	}
	override hideRotateHandle() {
		return true
	}

	override onResize(shape: IoShape, info: TLResizeInfo<IoShape>) {
		// Down to a 32 px strip with just the value (see the tiers in IoBlock).
		return snapResize(this.editor, shape, info, { minW: 96, minH: GRID * 2, maxH: 224, hStep: GRID * 2 })
	}

	override onTranslate(initial: IoShape, current: IoShape) {
		return snapToGrid(this.editor, initial, current)
	}

	component(shape: IoShape) {
		return <IoBlock shape={shape} />
	}
}

/* --------------------------------------------------------------- component */

function IoBlock({ shape }: { shape: IoShape }) {
	const editor = useEditor()
	const { kind, w, h, label, pin, pull, unit, live } = shape.props
	const input = isInput(kind)
	const digital = signalType(kind) === 'digital'

	const value = useValue('value', () => effectiveValue(editor, shape.id), [editor, shape.id])
	const wired = useValue(
		'wired',
		() => !input && !!getIncomingWire(editor, shape.id),
		[editor, shape.id, input]
	)
	const isEditing = useValue('editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const picking = useValue('picking', () => pinPickerFor.get() === shape.id, [shape.id])
	const isOnlySelected = useValue('selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
	const conflict = useValue('conflict', () => pinConflict(editor, shape), [editor, shape])

	// While scrubbing a recording, recorded blocks show the past and can't be touched.
	const replaying = useValue(
		'replaying',
		() => {
			const pb = playback.get()
			return !!pb && recordedValue(editor, pb.clipId, shape.id, pb.t) !== undefined
		},
		[editor, shape.id]
	)

	// Puppeteering: any output that no wire drives, and inputs while no board streams.
	const manual = !replaying && (input ? !live : !wired)

	const set = (patch: Partial<IoShape['props']>, record = true) => {
		if (record) editor.markHistoryStoppingPoint()
		editor.run(() => editor.updateShape({ id: shape.id, type: IO_TYPE, props: patch }), {
			history: record ? 'record' : 'ignore',
		})
	}
	const setValue = (v: number) => {
		const value = Math.min(1, Math.max(0, v))
		if (input) writeInputs(editor, [{ id: shape.id, value }]) // flips any toggles on its wires
		else set({ value }, false)
	}

	const units = UNITS[kind]
	const shown = formatValue(kind, unit, value)

	/*
	 * The block sheds detail as it shrinks (heights step by 32 px):
	 *   96+  name, pin, sparkline, value, slider
	 *   64   name and value
	 *   32   value only (the name stays in its tooltip)
	 */
	// Detail follows size on screen: zooming out simplifies a block just as shrinking it does.
	useValue(look)
	const zoom = useValue('zoom', () => detailZoom(editor.getZoomLevel()), [editor])
	const tier = simpler(ioTier(h), ioTier(h * zoom))
	const name = label || `Unnamed ${KIND_INFO[kind].title.toLowerCase()}`
	const showSlider = tier === 'full' && manual && !digital
	// The sparkline gets whatever the widest possible value leaves over.
	const valueFont = VALUE_FONT[tier]
	const padX = tier === 'value' ? 20 : 24
	const sparkW = w - padX - 8 - (kind === 'rgb' ? (tier === 'full' ? 96 : 32) : maxValueWidth(kind, unit, valueFont))
	// What's left after the outline, padding and the (scaled) header.
	const chrome = 2 * outlineW() + headHeight()
	const sparkH = tier === 'full' ? h - chrome - (showSlider ? 38 : 22) : tier === 'name' ? h - chrome - 18 : h - 2 * outlineW() - 8
	const showSpark = sparkW >= 24 && sparkH >= 12
	// Too small for a slider: puppeteer an analog block on its sparkline instead.
	const dragSpark = manual && !digital && !showSlider
	const chips = tier === 'full' ? (w * zoom >= 224 ? 'all' : w * zoom >= 144 ? 'pin' : 'none') : 'none'

	const valueAction =
		manual && digital ? 'Click to switch' : units.length > 1 ? 'Click to change units' : undefined
	const onValueClick = () => {
		if (manual && digital) return setValue(value >= 0.5 ? 0 : 1)
		if (units.length > 1) set({ unit: units[(units.indexOf(unit) + 1) % units.length] })
	}

	const nameEl = isEditing ? (
		<NameInput
			value={label}
			placeholder={KIND_INFO[kind].example}
			onCommit={(v) => v !== label && set({ label: v })}
			onDone={() => editor.setEditingShape(null)}
		/>
	) : (
		// Once selected, a click on the name edits it (double-click and Enter work too);
		// a drag that starts on the name still moves the block.
		<span
			className={`io-label${label ? '' : ' is-unnamed'}${isOnlySelected ? ' is-renamable' : ''}`}
			style={isOnlySelected ? { pointerEvents: 'all' } : undefined}
			title={isOnlySelected ? 'Click to name what this really is' : `${KIND_INFO[kind].hint}. Double-click to name it.`}
			onPointerDown={(e) => isOnlySelected && onClickNotDrag(e, () => editor.setEditingShape(shape.id))}
		>
			{name}
		</span>
	)

	const valueEl = kind === 'rgb' ? (
		<ColourValue
			value={value}
			showHex={tier === 'full'}
			title={[tier === 'value' ? name : '', pin >= 0 && tier !== 'full' ? `GPIO ${pin}` : ''].filter(Boolean).join(' · ')}
			onChange={manual ? setValue : undefined}
		/>
	) : (
		<span
			className={`io-value${digital && value >= 0.5 ? ' is-high' : ''}${valueAction ? ' is-action' : ''}`}
			style={{ pointerEvents: 'all' }}
			title={[tier === 'value' ? name : '', pin >= 0 && tier !== 'full' ? `GPIO ${pin}` : '', valueAction ?? '']
				.filter(Boolean)
				.join(' · ') || undefined}
			// A click acts; a drag that starts on the value still moves the block.
			onPointerDown={(e) => valueAction && onClickNotDrag(e, onValueClick)}
		>
			{shown.main}
			{shown.unit && <small>{shown.unit}</small>}
		</span>
	)

	return (
		<HTMLContainer
			className={`io io-${kind} io-tier-${tier}${manual ? ' io-manual' : ''}${replaying ? ' io-replay' : ''}`}
			style={{ width: w, height: h }}
		>
			{tier !== 'value' && (
				<div className="io-head">
					{nameEl}
					{chips !== 'none' && (
						<span className="io-chips">
							{kind === 'din' && chips === 'all' && (
								<ChipSelect
									value={pull}
									title="Pull resistor — pull-up reads HIGH until a button connects the pin to GND"
									options={PULLS}
									onChange={(v) => set({ pull: v as Pull })}
								/>
							)}
							<button
								className={`chip${conflict ? ' chip-warn' : ''}${pin < 0 ? ' chip-unset' : ''}${picking ? ' is-open' : ''}`}
								data-pin-chip={shape.id}
								style={{ pointerEvents: 'all' }}
								title={conflict ?? 'Choose the pin on the board'}
								onPointerDown={stopEventPropagation}
								onClick={() => pinPickerFor.set(pinPickerFor.get() === shape.id ? null : shape.id)}
							>
								{pin >= 0 ? `GPIO ${pin}` : 'pick a pin'}
							</button>
						</span>
					)}
				</div>
			)}

			<div className="io-body">
				{tier === 'value' && isEditing ? (
					nameEl
				) : (
					<>
						{showSpark &&
							(dragSpark ? (
								<SparkControl onChange={setValue}>
									<Sparkline id={shape.id} width={sparkW} height={sparkH} stepped={digital} colour={kind === 'rgb'} />
								</SparkControl>
							) : (
								<Sparkline id={shape.id} width={sparkW} height={sparkH} stepped={digital} colour={kind === 'rgb'} />
							))}
						{valueEl}
					</>
				)}
			</div>

			{showSlider && <Slider value={value} onChange={setValue} />}

			<Port block={shape} port={blockPorts(shape)[0]} />
		</HTMLContainer>
	)
}

/**
 * Run `action` if the pointer comes up where it went down. The press itself
 * still reaches tldraw, so dragging from the same spot moves the block.
 */
function onClickNotDrag(e: React.PointerEvent, action: () => void) {
	const x = e.clientX
	const y = e.clientY
	const up = (ev: PointerEvent) => {
		window.removeEventListener('pointerup', up)
		if (Math.hypot(ev.clientX - x, ev.clientY - y) < 4) action()
	}
	window.addEventListener('pointerup', up)
}

/**
 * Set an analog value straight on its sparkline: height is the value, so
 * pressing at a height sets it and dragging up or down moves it.
 */
function SparkControl({ onChange, children }: { onChange(v: number): void; children: React.ReactNode }) {
	const at = (e: React.PointerEvent) => {
		const r = e.currentTarget.getBoundingClientRect()
		return 1 - (e.clientY - r.top - 2) / (r.height - 4) // the sparkline's own 2 px padding
	}
	return (
		<div
			className="io-spark-control"
			style={{ pointerEvents: 'all' }}
			title="Drag up or down to set"
			onPointerDown={(e) => {
				stopEventPropagation(e)
				e.currentTarget.setPointerCapture(e.pointerId)
				onChange(at(e))
			}}
			onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && onChange(at(e))}
		>
			{children}
		</div>
	)
}

const ioTier = (h: number): Tier => (h >= 96 ? 'full' : h >= 64 ? 'name' : 'value')

/** Value font size per size tier, in px (matches styles.css). */
const VALUE_FONT = { full: 26, name: 22, value: 17 }

/** Width of the widest value a block of this kind could show, measured in its own font. */
const widthCache = new Map<string, number>()
document.fonts?.addEventListener('loadingdone', () => widthCache.clear())
function maxValueWidth(kind: IoKind, unit: AnalogUnit, size: number) {
	const key = `${kind}:${unit}:${size}`
	let w = widthCache.get(key)
	if (w === undefined) {
		const widest = (['din', 'dout'].includes(kind) ? [0, 1] : [1]).map((v) => formatValue(kind, unit, v))
		const ctx = document.createElement('canvas').getContext('2d')!
		const measure = (text: string, px: number, weight: number) => {
			ctx.font = `${weight} ${px}px "IBM Plex Sans", system-ui, sans-serif`
			return ctx.measureText(text).width
		}
		const small = Math.round(size * 0.46)
		w = Math.ceil(
			Math.max(...widest.map((v) => measure(v.main, size, 500) + (v.unit ? 3 + measure(v.unit, small, 400) : 0))) + 8
		)
		widthCache.set(key, w)
	}
	return w
}

/**
 * Naming in place. Commits on Enter, blur and unmount alike: Enter ends the
 * editing state, which unmounts the input before any blur event would fire.
 */
export function NameInput({
	value,
	placeholder,
	onCommit,
	onDone,
	className = 'io-label-input',
}: {
	value: string
	placeholder?: string
	onCommit(v: string): void
	onDone(): void
	className?: string
}) {
	const ref = useRef<HTMLInputElement>(null)
	const commit = useRef(onCommit)
	commit.current = onCommit
	useLayoutEffect(() => {
		const el = ref.current!
		el.focus()
		el.select()
		// tldraw may pull focus back to its canvas while entering the editing state.
		const raf = requestAnimationFrame(() => document.activeElement !== el && el.focus())
		return () => {
			cancelAnimationFrame(raf)
			commit.current(el.value.trim())
		}
	}, [])
	return (
		<input
			ref={ref}
			className={className}
			defaultValue={value}
			placeholder={placeholder}
			onPointerDown={stopEventPropagation}
			onKeyDown={(e) => {
				e.stopPropagation()
				if (e.key === 'Enter' || e.key === 'Escape') onDone()
			}}
			onBlur={() => onDone()}
		/>
	)
}

/** A hairline track whose filled part is the value itself. */
function Slider({ value, onChange }: { value: number; onChange(v: number): void }) {
	const ref = useRef<HTMLDivElement>(null)
	const fromEvent = (e: React.PointerEvent) => {
		const r = ref.current!.getBoundingClientRect()
		onChange((e.clientX - r.left) / r.width)
	}
	return (
		<div
			ref={ref}
			className="io-slider"
			style={{ pointerEvents: 'all' }}
			title="Drag to set"
			onPointerDown={(e) => {
				stopEventPropagation(e)
				e.currentTarget.setPointerCapture(e.pointerId)
				fromEvent(e)
			}}
			onPointerMove={(e) => {
				if (e.currentTarget.hasPointerCapture(e.pointerId)) fromEvent(e)
			}}
		>
			<div className="io-slider-fill" style={{ width: `${value * 100}%` }} />
			<div className="io-slider-knob" style={{ left: `${value * 100}%` }} />
		</div>
	)
}

/**
 * A colour as a swatch (and, at full size, its hex code). While puppeteered,
 * clicking it opens the system colour picker.
 */
export function ColourValue({
	value,
	showHex,
	title,
	onChange,
}: {
	value: number
	showHex: boolean
	title?: string
	onChange?: (v: number) => void
}) {
	const hex = fmtColour(value)
	return (
		<label className={`io-value io-colour${onChange ? ' is-action' : ''}`} title={title || (onChange ? 'Click to pick a colour' : hex)}>
			<i className="swatch" style={{ background: hex }} />
			{showHex && <small>{hex}</small>}
			{onChange && (
				<input
					type="color"
					value={hex}
					style={{ pointerEvents: 'all' }}
					onPointerDown={stopEventPropagation}
					onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))}
				/>
			)}
		</label>
	)
}

function ChipSelect({
	value,
	options,
	onChange,
	title,
	warn,
}: {
	value: string
	options: [string, string][]
	onChange(v: string): void
	title?: string
	warn?: string | null
}) {
	const current = options.find(([v]) => v === value)?.[1] ?? value
	return (
		<label className={`chip${warn ? ' chip-warn' : ''}${value === '-1' ? ' chip-unset' : ''}`} title={title}>
			{current}
			<select
				value={value}
				style={{ pointerEvents: 'all' }}
				onPointerDown={stopEventPropagation}
				onChange={(e) => onChange(e.target.value)}
			>
				{options.map(([v, l]) => (
					<option key={v} value={v}>
						{l}
					</option>
				))}
			</select>
		</label>
	)
}

/* ------------------------------------------------------------------ helpers */

const PULLS: [string, string][] = [
	['up', 'pull-up'],
	['down', 'pull-down'],
	['none', 'no pull'],
]

const UNITS: Record<IoKind, AnalogUnit[]> = {
	din: ['raw'],
	dout: ['raw'],
	rgb: ['raw'],
	ain: ['raw', 'volt', 'pct'],
	aout: ['pct', 'volt'],
}

function formatValue(kind: IoKind, unit: AnalogUnit, v: number): { main: string; unit?: string } {
	if (kind === 'din' || kind === 'dout') return { main: v >= 0.5 ? 'HIGH' : 'LOW' }
	if (kind === 'rgb') return { main: fmtColour(v) }
	if (kind === 'ain') {
		if (unit === 'volt') return { main: (v * ADC_FULL_SCALE_V).toFixed(2), unit: 'V' }
		if (unit === 'pct') return { main: String(Math.round(v * 100)), unit: '%' }
		return { main: String(Math.round(v * 4095)) }
	}
	if (unit === 'volt') return { main: (v * SUPPLY_V).toFixed(2), unit: 'V avg' }
	return { main: String(Math.round(v * 100)), unit: '%' }
}

/** Two blocks may share a pin only if both just read it the same way. */
function pinConflict(editor: ReturnType<typeof useEditor>, shape: IoShape): string | null {
	if (shape.props.pin < 0) return null
	for (const s of editor.getCurrentPageShapes()) {
		if (s.type !== IO_TYPE || s.id === shape.id) continue
		const o = s as IoShape
		if (o.props.pin !== shape.props.pin) continue
		const bothRead = o.props.kind === shape.props.kind && isInput(o.props.kind)
		if (!bothRead) return `GPIO ${o.props.pin} is also used by “${o.props.label || KIND_INFO[o.props.kind].title}”`
	}
	return null
}
