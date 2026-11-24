import { glyphW } from '../style'
import type { InputDevice } from '../shapes/types'

/*
 * A live schematic symbol of the contact, drawn like the switches and buttons
 * in Schematik's circuit drawings (circuit_minimal.html): two hollow
 * terminals with leads, a lever for a switch, a push bar on a stem for a
 * button. Ground is on the left, in ink; the pin is on the right, in the
 * colour of its net, and the moving part takes that colour while the contact
 * is closed. Strokes have the drawing's symbol weight: the wire weight up to
 * 2 px, then half as fast.
 *
 * Coordinates are Schematik's, around the centre: terminals at x = ±8, r 2.4.
 */

const BOX = { x: -16, y: -12, w: 32, h: 20 }
/** Screen pixels per symbol unit at the default size. */
const SCALE = 1.5

export function ContactSymbol({
	device,
	closed,
	active,
	title,
	net,
	...handlers
}: {
	device: InputDevice
	closed: boolean
	/** Can be worked by hand right now. */
	active?: boolean
	title?: string
	/** The colour of the net the pin drives. */
	net?: string
	onPointerDown?(e: React.PointerEvent): void
	onPointerUp?(e: React.PointerEvent): void
	onPointerCancel?(e: React.PointerEvent): void
}) {
	if (device === 'signal') return null
	return (
		<svg
			className={`contact${closed ? ' is-closed' : ''}${active ? ' is-active' : ''}`}
			viewBox={`${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`}
			width={BOX.w * SCALE}
			height={BOX.h * SCALE}
			style={{ pointerEvents: active ? 'all' : undefined, ['--net' as string]: net ?? 'var(--ink)', strokeWidth: glyphW() / SCALE }}
			role={active ? 'button' : undefined}
			aria-label={title}
			{...(active ? handlers : {})}
		>
			<title>{title}</title>
			{/* a generous hit area */}
			<rect x={BOX.x} y={BOX.y} width={BOX.w} height={BOX.h} fill="transparent" stroke="none" />
			<ContactParts device={device} closed={closed} />
		</svg>
	)
}

function ContactParts({ device, closed }: { device: Exclude<InputDevice, 'signal'>; closed: boolean }) {
	return (
		<>
			<line className="contact-gnd" x1={-16} y1={0} x2={-10.4} y2={0} />
			<line className="contact-pin" x1={10.4} y1={0} x2={16} y2={0} />
			{device === 'toggle' ? (
				// The lever, hinged by the ground terminal: down on the pin terminal when on.
				<line className="contact-move" x1={-6} y1={-1.6} x2={10} y2={closed ? -2.6 : -9} />
			) : (
				// The push bar on its stem. Normally open: it rests above the terminals
				// and pressing brings it down onto them. Normally closed: it rests
				// under them, bridging them, and pressing pushes it away.
				<g className="contact-move contact-plunger" style={{ transform: `translateY(${plungerY(device, closed)}px)` }}>
					<line x1={-11} y1={0} x2={11} y2={0} />
					<line x1={0} y1={0} x2={0} y2={device === 'nc' ? -11.6 : -5} />
				</g>
			)}
			<circle className="contact-terminal" cx={-8} cy={0} r={2.4} />
			<circle className="contact-terminal" cx={8} cy={0} r={2.4} />
		</>
	)
}

/** Where the push bar is: on the terminals (±2.6) when closed, 3.4 further away when open. */
function plungerY(device: 'no' | 'nc', closed: boolean) {
	if (device === 'no') return closed ? -2.6 : -6
	return closed ? 2.6 : 6
}

/** The kind of input as a small symbol, at rest: for chips and the palette, where words would not fit. */
export function DeviceIcon({ device, size = 1, weight }: { device: InputDevice; size?: number; /** Line weight in screen pixels. */ weight?: number }) {
	const s = SCALE * 0.62 * size
	if (device === 'signal')
		// A square wave: a signal, read as its level.
		return (
			<svg className="contact" viewBox="0 0 24 14" width={24 * size} height={14 * size} style={{ strokeWidth: 1.6 }} aria-hidden>
				<path className="contact-move" d="M1 11 H6 V3 H12 V11 H17 V3 H23" />
			</svg>
		)
	return (
		<svg
			className="contact contact-icon"
			viewBox={`${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`}
			width={BOX.w * s}
			height={BOX.h * s}
			style={{ strokeWidth: (weight ?? Math.max(1.4, glyphW() * 0.6)) / s }}
			aria-hidden
		>
			<ContactParts device={device} closed={device === 'nc'} />
		</svg>
	)
}
