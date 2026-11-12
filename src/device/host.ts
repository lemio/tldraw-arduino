import { Editor, TLShapePartial, atom, react, unsafe__withoutCapture } from 'tldraw'
import { effectiveValue, writeInputs } from '../shapes/signals'
import { IO_TYPE, IoShape, isInput } from '../shapes/types'
import { Device, DeviceState, ScanTelemetry, Telemetry } from './Device'

/*
 * The browser a board is plugged into is its host. The host writes the board's
 * readings into the shared store (so every collaborator sees them live) and
 * drives the board's outputs from the store (so every collaborator can
 * puppeteer them). Nobody else needs to know a board exists.
 */

export const device = new Device()

export const deviceStatus = atom('deviceStatus', { state: device.state as DeviceState, detail: '' })
device.onState = (state, detail) => deviceStatus.set({ state, detail })

export interface ConsoleLine {
	id: number
	text: string
	kind: 'out' | 'in' | 'sys'
}
export const consoleLines = atom<ConsoleLine[]>('console', [])
let lineId = 0
device.onLine = (text, kind) =>
	consoleLines.update((lines) => [...lines.slice(-400), { id: lineId++, text, kind }])

/** print() from blocks running in the browser lands in the same console. */
export const logLine = (text: string) => device.onLine(text, 'out')

/** Telemetry samples per second, for the status chip. */
export const telemetryRate = atom('telemetryRate', 0)

/*
 * Pin scan: while the pin picker is open on a live board, the board reads the
 * ADC on every analog pin no block uses, so the picker can show what is on
 * them. Local to this browser.
 */
const SCAN_LEN = 150 // about three seconds of telemetry
const scanSeries = new Map<number, Float32Array>()
let scanCount = new Map<number, number>()
/** Bumps once a frame while scan readings arrive. */
export const scanTick = atom('scanTick', 0)
/** GPIOs that followed both internal pulls on the last probe: nothing is connected. */
export const scanFloating = atom<number[]>('scanFloating', [])

/** The latest readings for a scanned pin, oldest first, 0..1. */
export function getScan(gpio: number): Float32Array | null {
	const buf = scanSeries.get(gpio)
	const n = scanCount.get(gpio) ?? 0
	if (!buf || !n) return null
	if (n < SCAN_LEN) return buf.subarray(0, n)
	const i = n % SCAN_LEN
	const out = new Float32Array(SCAN_LEN)
	out.set(buf.subarray(i))
	out.set(buf.subarray(0, i), SCAN_LEN - i)
	return out
}

/** Start sampling these pins (an empty list stops). */
export function scanPins(gpios: number[]) {
	scanSeries.clear()
	scanCount = new Map()
	scanFloating.set([])
	device.scan(gpios)
}

let scanFrame = 0
function takeScan(t: Telemetry) {
	const d = t as unknown as ScanTelemetry
	if (!d.s) return
	for (const [k, raw] of Object.entries(d.s)) {
		const g = Number(k)
		let buf = scanSeries.get(g)
		if (!buf) scanSeries.set(g, (buf = new Float32Array(SCAN_LEN)))
		const n = scanCount.get(g) ?? 0
		buf[n % SCAN_LEN] = raw / 65535
		scanCount.set(g, n + 1)
	}
	const f = d.f ?? []
	const was = scanFloating.get()
	if (f.length !== was.length || f.some((g, i) => g !== was[i])) scanFloating.set(f)
	if (!scanFrame)
		scanFrame = requestAnimationFrame(() => {
			scanFrame = 0
			scanTick.update((t) => t + 1)
		})
}

const MODE = { din: 'di', ain: 'ai', dout: 'do', aout: 'ao', rgb: 'rgb' } as const

const ioShapes = (editor: Editor) =>
	editor.getCurrentPageShapes().filter((s): s is IoShape => s.type === IO_TYPE)

export function attachDevice(editor: Editor) {
	/* board → canvas */
	let pending: Record<string, number> | null = null
	let frame = 0
	let samples = 0

	const flush = () => {
		frame = 0
		const d = pending
		pending = null
		if (!d) return
		const updates: Parameters<typeof writeInputs>[1] = []
		for (const s of ioShapes(editor)) {
			if (!isInput(s.props.kind)) continue
			const raw = d[String(s.props.pin)]
			if (raw === undefined) continue
			// Quantise analog to the ADC's 12 bits: collaborators get no sub-LSB noise.
			const value = s.props.kind === 'din' ? (raw ? 1 : 0) : Math.round((raw / 65535) * 4095) / 4095
			if (value !== s.props.value || !s.props.live) {
				updates.push({ id: s.id, value, live: true })
			}
		}
		writeInputs(editor, updates)
	}

	device.onTelemetry = (d) => {
		takeScan(d)
		samples++
		pending = d
		if (!frame) frame = requestAnimationFrame(flush)
	}

	const rateTimer = setInterval(() => {
		telemetryRate.set(samples)
		samples = 0
	}, 1000)

	/* canvas → board */
	const sent = new Map<string, number>()
	let lastConfig = ''

	const stop = react('drive board', () => {
		const { state } = deviceStatus.get()
		if (state !== 'live') {
			sent.clear()
			lastConfig = ''
			return
		}
		const pins: Record<string, string> = {}
		const outputs: [string, IoShape][] = []
		for (const s of ioShapes(editor)) {
			const { pin, kind, pull } = s.props
			if (pin < 0 || pins[pin]) continue // first block wins a contested pin
			pins[pin] = kind === 'din' && pull !== 'none' ? `${MODE[kind]}:${pull}` : MODE[kind]
			if (!isInput(kind)) outputs.push([String(pin), s])
		}
		const config = JSON.stringify(pins)
		if (config !== lastConfig) {
			lastConfig = config
			sent.clear() // fresh pin objects start at 0; resend everything
			device.configure(pins)
		}
		const writes: Record<string, number> = {}
		for (const [pin, s] of outputs) {
			const v = Math.round(effectiveValue(editor, s.id, true) * 1000) / 1000 // never replays
			if (sent.get(pin) !== v) {
				sent.set(pin, v)
				writes[pin] = v
			}
		}
		device.drive(writes)
	})

	/*
	 * Inputs stop being "live" the moment their board stops streaming. Only the
	 * browser that was hosting clears the flags, not every collaborator.
	 */
	let hosted = false
	const stopLive = react('inputs offline', () => {
		if (deviceStatus.get().state === 'live') hosted = true
		else if (hosted) unsafe__withoutCapture(() => markOffline(editor))
	})
	const onUnload = () => device.state === 'live' && markOffline(editor)
	window.addEventListener('beforeunload', onUnload)

	return () => {
		stop()
		stopLive()
		clearInterval(rateTimer)
		window.removeEventListener('beforeunload', onUnload)
		device.onTelemetry = () => {}
	}
}

function markOffline(editor: Editor) {
	const updates = ioShapes(editor)
		.filter((s) => s.props.live)
		.map((s): TLShapePartial<IoShape> => ({ id: s.id, type: IO_TYPE, props: { live: false } }))
	if (updates.length) editor.run(() => editor.updateShapes(updates), { history: 'ignore' })
}
