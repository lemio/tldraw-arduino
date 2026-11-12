import { AGENT_SOURCE, TELEMETRY_PREFIX } from './agent'
import { ESPRESSIF_VID, hardReset, settleSignals } from './reset'

/*
 * One ESP32-S3 running MicroPython, reached over Web Serial (or WebUSB for
 * CH340 boards where Web Serial is missing, e.g. Chrome on Android).
 * Protocol and flashing follow lemio/Documenter's device.js.
 */

export const BUNDLED_FIRMWARE = {
	url: `${import.meta.env.BASE_URL}firmware/ESP32_GENERIC_S3-20260824-v1.29.0.bin`,
	version: 'MicroPython 1.29.0',
}

export type DeviceState =
	| 'unsupported'
	| 'disconnected'
	| 'connecting'
	| 'checking'
	| 'no-micropython' // a board answered, but not with a REPL
	| 'idle' // REPL ready, nothing running
	| 'live' // agent running, telemetry streaming
	| 'flashing'
	| 'standalone' // main.py saved and running on its own

type PortLike = SerialPort

const enc = new TextEncoder()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const hasWebSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator
export const hasWebUsb = () => typeof navigator !== 'undefined' && 'usb' in navigator

/** Pin readings by GPIO; while scanning, also the free pins' ADC and the ones left floating. */
export type Telemetry = Record<string, number>
export type ScanTelemetry = { s?: Record<string, number>; f?: number[] }

export class Device {
	state: DeviceState = hasWebSerial() || hasWebUsb() ? 'disconnected' : 'unsupported'
	detail = ''
	onState: (s: DeviceState, detail: string) => void = () => {}
	onTelemetry: (d: Telemetry) => void = () => {}
	onLine: (line: string, kind: 'out' | 'in' | 'sys') => void = () => {}

	private port?: PortLike
	private reader?: ReadableStreamDefaultReader<Uint8Array>
	private writer?: WritableStreamDefaultWriter<Uint8Array>
	private readLoop?: Promise<void>
	private rx = ''
	private lineTail = ''
	private writeChain: Promise<unknown> = Promise.resolve()
	private dec = new TextDecoder()

	private set(state: DeviceState, detail = '') {
		this.state = state
		this.detail = detail
		this.onState(state, detail)
	}

	get connected() {
		return !!this.port
	}

	/* ----------------------------------------------------------- connection */

	/** Must be called from a click: the browser only shows its port picker during a user gesture. */
	async connect() {
		this.set('connecting')
		try {
			this.port = await pickPort()
		} catch (e) {
			this.set('disconnected')
			throw e
		}
		await this.open()
		await this.start()
	}

	/** Detect MicroPython and, if it is there, start the live agent. */
	async start() {
		this.set('checking')
		if (await this.detect()) await this.runAgent()
		else this.set('no-micropython')
	}

	private async open(port = this.port!) {
		await port.open({ baudRate: 115200 })
		await this.attach(port)
	}

	/** Take over an already open port: line signals, writer, read loop. */
	private async attach(port: PortLike) {
		this.port = port
		await settleSignals(port)
		this.rx = ''
		this.lineTail = ''
		this.writer = port.writable!.getWriter()
		this.readLoop = this.pump()
		port.addEventListener?.('disconnect', this.onUnplug)
	}

	private onUnplug = () => {
		if (this.state === 'flashing') return // re-enumerating on purpose
		void this.release().then(() => {
			this.port = undefined
			this.set('disconnected', 'Board unplugged')
		})
	}

	private async pump() {
		const port = this.port!
		while (port.readable) {
			try {
				this.reader = port.readable.getReader()
				for (;;) {
					const { value, done } = await this.reader.read()
					if (done) return
					if (value) this.ingest(this.dec.decode(value, { stream: true }))
				}
			} catch {
				return
			} finally {
				try {
					this.reader?.releaseLock()
				} catch {
					/* already released */
				}
			}
		}
	}

	private async release() {
		try {
			await this.reader?.cancel()
		} catch {
			/* closed */
		}
		try {
			this.writer?.releaseLock()
		} catch {
			/* closed */
		}
		await this.readLoop?.catch(() => {})
		this.port?.removeEventListener?.('disconnect', this.onUnplug)
		this.reader = undefined
		this.writer = undefined
		this.readLoop = undefined
	}

	async disconnect() {
		await this.release()
		try {
			await this.port?.close()
		} catch {
			/* gone */
		}
		this.port = undefined
		this.set('disconnected')
	}

	/* --------------------------------------------------------------- reading */

	private ingest(text: string) {
		this.rx += text
		if (this.rx.length > 20000) this.rx = this.rx.slice(-8000)
		this.lineTail += text
		let nl: number
		while ((nl = this.lineTail.indexOf('\n')) >= 0) {
			const line = this.lineTail.slice(0, nl).replace(/\r$/, '')
			this.lineTail = this.lineTail.slice(nl + 1)
			this.handleLine(line)
		}
		if (this.lineTail.length > 4000) this.lineTail = this.lineTail.slice(-1000)
	}

	private handleLine(line: string) {
		const i = line.indexOf(TELEMETRY_PREFIX)
		if (i < 0) {
			// Strip the raw REPL's own framing so the console stays readable.
			const clean = line.replace(/[\x00-\x08\x0b-\x1f]/g, '').replace(/^OK/, '')
			if (clean.trim()) this.onLine(clean, 'out')
			return
		}
		try {
			this.onTelemetry(JSON.parse(line.slice(i + 1)))
		} catch {
			/* a line cut in half by a reset; ignore */
		}
	}

	/* ------------------------------------------------------------------ REPL */

	private write(data: string | Uint8Array) {
		const bytes = typeof data === 'string' ? enc.encode(data) : data
		this.writeChain = this.writeChain.then(() => this.writer?.write(bytes)).catch(() => {})
		return this.writeChain
	}

	private async waitFor(needle: string, timeout = 3000) {
		const t0 = Date.now()
		for (;;) {
			const i = this.rx.indexOf(needle)
			if (i >= 0) {
				this.rx = this.rx.slice(i + needle.length)
				return
			}
			if (Date.now() - t0 > timeout) throw new Error(`No answer from the board (waiting for ${JSON.stringify(needle)})`)
			await sleep(15)
		}
	}

	/** Interrupt whatever runs (including main.py) and enter the raw REPL. */
	private async enterRaw(timeout = 2500) {
		await this.write('\r\x03\x03')
		await sleep(100)
		this.rx = ''
		await this.write('\r\x01')
		await this.waitFor('raw REPL', timeout)
		await this.waitFor('>', 800).catch(() => {})
	}

	private async detect() {
		try {
			await this.enterRaw(1800)
			await this.write('\r\x02')
			await sleep(50)
			return true
		} catch {
			return false
		}
	}

	/** Paste source into the raw REPL and start it. Chunked: USB CDC drops long bursts. */
	private async exec(source: string) {
		await this.enterRaw()
		const bytes = enc.encode(source)
		for (let i = 0; i < bytes.length; i += 256) {
			await this.write(bytes.subarray(i, i + 256))
			await sleep(8)
		}
		await this.write('\x04')
		await this.waitFor('OK', 3000)
	}

	async runAgent() {
		await this.exec(AGENT_SOURCE)
		this.lastConfig = '' // a fresh agent has no pins yet
		this.set('live')
	}

	private lastConfig = ''

	/** Configure the agent's pins. No-op if unchanged. */
	configure(pins: Record<string, string>) {
		const json = JSON.stringify(pins)
		if (this.state !== 'live' || json === this.lastConfig) return
		this.lastConfig = json
		void this.write(`{"c":${json}}\n`)
	}

	drive(values: Record<string, number>) {
		if (this.state !== 'live' || !Object.keys(values).length) return
		void this.write(JSON.stringify({ w: values }) + '\n')
	}

	/** Sample these pins' ADC while no block uses them ([] stops). */
	scan(pins: number[]) {
		if (this.state !== 'live') return
		void this.write(JSON.stringify({ s: pins }) + '\n')
	}

	/** Run a line of Python typed in the console. */
	async repl(code: string) {
		this.onLine(code, 'in')
		if (this.state === 'live') {
			await this.write(JSON.stringify({ x: code }) + '\n')
		} else if (this.state === 'idle' || this.state === 'standalone') {
			await this.write(code.replace(/\n/g, '\r') + '\r')
		}
	}

	/** Save a program as main.py and soft-reset, so it runs without the browser. */
	async saveMain(source: string) {
		const script = `f = open('main.py', 'w')\nf.write(${JSON.stringify(source)})\nf.close()\n`
		await this.exec(script)
		await this.waitFor('\x04', 3000).catch(() => {})
		await this.write('\r\x02') // back to the friendly REPL…
		await sleep(80)
		await this.write('\x04') // …and soft-reset, which runs main.py
		this.set('standalone')
		this.onLine('main.py saved — the board now runs it on its own, also after power-up.', 'sys')
	}

	/** Leave standalone mode and go back to driving the board from the canvas. */
	async resumeLive() {
		await this.runAgent()
	}

	/* -------------------------------------------------------------- flashing */

	/*
	 * Follows lemio/esp-wasm: esptool-js resets the chip into the ROM loader over
	 * DTR/RTS, writes only the image (no full-chip erase, so progress moves at
	 * once), then the port is reopened and the chip hard-reset into the app. A
	 * native-USB S3 drops off the bus at that reset; we wait for it to return.
	 */
	async flash(firmware?: Uint8Array, onProgress?: (pct: number, what: string) => void) {
		if (!this.port) throw new Error('Connect a board first.')
		const port = this.port
		const progress = (p: number, what: string) => {
			this.set('flashing', what)
			onProgress?.(p, what)
		}
		progress(0, 'Loading firmware')
		const bin = firmware ?? (await fetchFirmware())

		await this.release()
		await port.close().catch(() => {})

		const { ESPLoader, Transport } = await import('esptool-js')
		const transport = new Transport(port, false)
		const log = (s: string) => s.trim() && this.onLine(s.trim(), 'sys')
		const loader = new ESPLoader({
			transport,
			baudrate: 921600,
			romBaudrate: 115200,
			terminal: { clean() {}, writeLine: log, write: log },
		})

		try {
			progress(1, 'Entering download mode')
			const chip = await loader.main()
			this.onLine(`Connected to ${chip}`, 'sys')
			if (!/ESP32-S3/i.test(chip)) throw new Error(`This is an ${chip}; the bundled MicroPython is for the ESP32-S3.`)
			await loader.writeFlash({
				fileArray: [{ data: bin, address: 0 }],
				flashMode: 'keep',
				flashFreq: 'keep',
				flashSize: 'keep',
				eraseAll: false,
				compress: true,
				reportProgress: (_i, written, total) =>
					progress(2 + Math.round((written / total) * 96), 'Installing MicroPython'),
			})
			this.onLine('MicroPython written.', 'sys')
		} catch (e) {
			await transport.disconnect().catch(() => {})
			this.port = undefined
			this.set('disconnected')
			const msg = e instanceof Error ? e.message : String(e)
			throw new Error(`Installing failed: ${msg}`)
		}
		await transport.disconnect().catch(() => {})

		progress(99, 'Restarting the board')
		const info = port.getInfo()
		try {
			await port.open({ baudRate: 115200 })
			await hardReset(port)
		} catch {
			/* already gone: it re-enumerated on its own */
		}
		await sleep(1500)

		const back = port.readable ? port : await this.waitForBoard(port, info)
		if (!back) {
			this.port = undefined
			this.set(
				'disconnected',
				'MicroPython is installed. The board now shows up as a different USB device: click Connect and pick it.'
			)
			return
		}
		if (back === port) await this.attach(port)
		else await this.open(back)
		await this.start()
	}

	/** Same port object, else same VID/PID, else any Espressif port this page may use. */
	private async waitForBoard(old: PortLike, { usbVendorId, usbProductId }: SerialPortInfo) {
		await old.close().catch(() => {})
		if (!hasWebSerial()) return undefined
		const deadline = Date.now() + 10_000
		while (Date.now() < deadline) {
			const ports = await navigator.serial.getPorts()
			const ranked = [
				...ports.filter((p) => p === old),
				...ports.filter((p) => p.getInfo().usbVendorId === usbVendorId && p.getInfo().usbProductId === usbProductId),
				...ports.filter((p) => p.getInfo().usbVendorId === ESPRESSIF_VID),
			]
			for (const p of new Set(ranked)) {
				try {
					// Probe: a port can be listed before the device is ready to open.
					await p.open({ baudRate: 115200 })
					await p.close()
					return p
				} catch {
					/* not ready yet */
				}
			}
			await sleep(300)
		}
		return undefined
	}
}

async function pickPort(): Promise<PortLike> {
	if (hasWebSerial()) {
		// No VID filter: native USB (0x303A) and CP210x / CH34x bridges must all show up.
		return navigator.serial.requestPort()
	}
	if (hasWebUsb()) {
		const { WebUSBSerialPort } = await import('esptool-js')
		const usb = await WebUSBSerialPort.requestPort()
		return usb.asSerialPort() as unknown as PortLike
	}
	throw new Error('This browser cannot talk to USB devices. Use Chrome or Edge.')
}

async function fetchFirmware() {
	const res = await fetch(BUNDLED_FIRMWARE.url)
	if (!res.ok) throw new Error('Could not load the bundled MicroPython firmware.')
	return new Uint8Array(await res.arrayBuffer())
}
