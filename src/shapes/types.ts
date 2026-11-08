import { JsonObject } from 'tldraw'
import { BOARD_PINS, pinUnavailable } from '../board/board'
import { TLShape } from 'tldraw'

/** din / ain read the board, dout / aout drive it. */
export type IoKind = 'din' | 'ain' | 'dout' | 'aout' | 'rgb'
/**
 * What travels along a wire. Every value is one number:
 *   digital 0 or 1 · analog 0..1 · number anything · colour 0xRRGGBB
 */
export type SignalType = 'digital' | 'analog' | 'number' | 'colour'
export const IO_KINDS: IoKind[] = ['din', 'ain', 'dout', 'aout', 'rgb']
export type Pull = 'none' | 'up' | 'down'
export type AnalogUnit = 'raw' | 'volt' | 'pct'

export const IO_TYPE = 'io'
export const WIRE_TYPE = 'wire'
export const CAMERA_TYPE = 'camera'
export const CLIP_TYPE = 'clip'
export const LOGIC_TYPE = 'logic'

export interface IoShapeProps {
	kind: IoKind
	w: number
	h: number
	label: string
	/** GPIO number, -1 when unassigned. */
	pin: number
	pull: Pull
	unit: AnalogUnit
	/**
	 * Normalised signal, 0..1 (digital: 0 or 1).
	 * Inputs: last telemetry sample, or a simulated value while no board streams.
	 * Outputs: the puppeteered value, used when no wire drives the block.
	 */
	value: number
	/** Inputs only: true while a connected board is writing `value`. */
	live: boolean
}

export type WireFn = 'follow' | 'toggle'
/** How a map bends between its ends: straight, a gamma curve, or an easing. */
export type Curve = 'linear' | 'gamma' | 'in' | 'out' | 'inout'
export type Edge = 'rise' | 'fall' | 'both'

/**
 * What a wire does to the signal on its way, after the Logic Definer of
 * Arduino Action. All levels are 0..1.
 *
 *   analog source ──(inLo..inHi)──► map ────────────────► analog target (lo..hi)
 *                 └─(threshold)──► boolean ─┬─(invert)──► digital target
 *   digital source ───────────────► boolean ─┤
 *                                  follow / toggle-on-edge └─► analog target: LOW→lo, HIGH→hi
 */
export interface WireShapeProps {
	/** End point relative to the shape's x/y, which is the start point. */
	ex: number
	ey: number
	fn: WireFn
	/** Toggle: which edge of the boolean flips the output. */
	edge: Edge
	/** Toggle: the remembered output, flipped by whoever writes the edge. */
	state: number
	/** Analog source → boolean: HIGH above this level. */
	threshold: number
	invert: boolean
	/** Analog → analog: the input range that maps onto lo..hi. */
	inLo: number
	inHi: number
	/** Analog target: the output for LOW / HIGH, or the ends of a map. */
	lo: number
	hi: number
	/** Colour target: the colour for LOW / HIGH, or the ends of a fade. 0xRRGGBB. */
	loColour: number
	hiColour: number
	/** Maps and fades: the curve between their ends, and gamma's exponent. */
	curve: Curve
	gamma: number
	/**
	 * Routing among wires leaving the same port (set by layoutSiblings):
	 * `lane` is this wire's own track, offset from the port; `bend` is where
	 * its 45° run starts (-1: wherever it looks best on its own).
	 */
	lane: number
	bend: number
	/** Bend points placed by hand, in page coordinates: the wire passes through each. */
	via: { x: number; y: number }[]
}

export const WIRE_DEFAULTS: Omit<WireShapeProps, 'ex' | 'ey' | 'lane' | 'bend' | 'via'> = {
	fn: 'follow',
	edge: 'rise',
	state: 0,
	threshold: 0.5,
	invert: false,
	inLo: 0,
	inHi: 1,
	lo: 0,
	hi: 1,
	loColour: 0x000000,
	hiColour: 0xffffff,
	curve: 'linear',
	gamma: 2.2,
}

export type CameraSource = 'none' | 'local' | 'phone'

export interface CameraShapeProps {
	w: number
	h: number
	label: string
	source: CameraSource
	/** PeerJS id of whichever device is streaming into this block. */
	peer: string
}

/** A recorded stretch of signals, plus (on the recording computer) video. */
export interface ClipShapeProps {
	w: number
	h: number
	label: string
	/** Seconds. */
	duration: number
	/** Samples per second of every channel. */
	hz: number
	/** One recorded block each; `data` is 8-bit samples, base64. */
	channels: ClipChannel[]
	/** IndexedDB key of the video on the recording computer, '' without video. */
	video: string
	/** Display name of who holds the video, for everyone else. */
	videoOwner: string
	/** Height of the video strip, 0 without video. */
	videoH: number
	/** Whether the in-between values (logic blocks) are shown. */
	expanded: boolean
	/** The page as it was recorded (see versions.ts), JSON; '' for clips from before. */
	circuit: string
}

/**
 * One recorded signal. IO blocks are recorded by `kind`; a logic block's
 * outputs by `port` and `type` — the in-between steps, from inputs to outputs.
 */
export interface ClipChannel {
	id: string
	label: string
	kind?: IoKind
	port?: string
	type?: SignalType
	role?: 'in' | 'between' | 'out'
	data: string
}

export interface WireBindingProps {
	terminal: 'start' | 'end'
	/** Which port of the block: '' for an IO block's single port. */
	port: string
}

/** A block whose behaviour is MicroPython (see src/blocks). */
export interface LogicShapeProps {
	/** Library block id, e.g. 'time.wait', or 'custom' for a Python block. */
	def: string
	w: number
	h: number
	label: string
	/** Values of unconnected inputs, by input id. */
	params: Record<string, number>
	/** Button presses on an input, as counters: a change is a pulse. */
	presses: Record<string, number>
	/** Output values, by output id: written by whichever browser runs the logic. */
	out: Record<string, number>
	/** The block's persistent `b.state`, as written by the runner. */
	state: JsonObject
	/** The last Python error, if any. */
	error: string
	/** For def 'custom': the block's own definition (see CustomDef in src/blocks). */
	custom: JsonObject
}

declare module '@tldraw/tlschema' {
	export interface TLGlobalShapePropsMap {
		[IO_TYPE]: IoShapeProps
		[WIRE_TYPE]: WireShapeProps
		[CAMERA_TYPE]: CameraShapeProps
		[CLIP_TYPE]: ClipShapeProps
		[LOGIC_TYPE]: LogicShapeProps
	}
	export interface TLGlobalBindingPropsMap {
		[WIRE_TYPE]: WireBindingProps
	}
}

export type IoShape = TLShape<typeof IO_TYPE>
export type WireShape = TLShape<typeof WIRE_TYPE>
export type CameraShape = TLShape<typeof CAMERA_TYPE>
export type ClipShape = TLShape<typeof CLIP_TYPE>
export type LogicShape = TLShape<typeof LOGIC_TYPE>

export const isInput = (kind: IoKind) => kind === 'din' || kind === 'ain'
export const signalType = (kind: IoKind): SignalType =>
	kind === 'rgb' ? 'colour' : kind === 'din' || kind === 'dout' ? 'digital' : 'analog'

/** `example` prompts for a real name: what is it, in the actual project? */
export const KIND_INFO: Record<IoKind, { title: string; example: string; hint: string }> = {
	din: { title: 'Digital in', example: 'What is it? e.g. Door switch', hint: 'Reads HIGH or LOW from a pin' },
	ain: { title: 'Analog in', example: 'What is it? e.g. Plant soil moisture', hint: 'Reads a voltage, 0–3.1 V' },
	dout: { title: 'Digital out', example: 'What is it? e.g. Red warning light', hint: 'Switches a pin HIGH or LOW' },
	aout: { title: 'Analog out', example: 'What is it? e.g. Desk fan speed', hint: 'PWM duty cycle, 0–100 %' },
	rgb: { title: 'RGB LED', example: 'What is it? e.g. Mood light', hint: 'A WS2812 colour LED (the DevKit has one on GPIO 38)' },
}

/** Pins a block of this kind may use: every header GPIO the board map allows. */
export const pinsFor = (kind: IoKind) =>
	BOARD_PINS.filter((p) => p.gpio !== null && !pinUnavailable(p, kind)).map((p) => p.gpio as number)

/** First choices per kind, so fresh blocks land on sensible, distinct pins. */
const PREFERRED: Record<IoKind, number[]> = {
	din: [0, 4, 5, 6, 7], // GPIO 0 is the BOOT button on every S3 DevKit
	ain: [1, 2, 4, 5, 6, 7],
	dout: [13, 14, 21, 47, 12],
	aout: [12, 11, 10, 9, 15],
	rgb: [38, 48, 21],
}

export function suggestPin(kind: IoKind, used: Set<number>): number {
	for (const p of [...PREFERRED[kind], ...pinsFor(kind)]) if (!used.has(p)) return p
	return -1
}

/** Full-scale input voltage of the ADC at 11 dB attenuation. */
export const ADC_FULL_SCALE_V = 3.1
export const SUPPLY_V = 3.3
