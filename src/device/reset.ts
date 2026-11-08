/**
 * DTR/RTS sequences that reset an ESP32-S3, ported from esptool.py via
 * lemio/esp-wasm. Handles both a USB-UART bridge with the usual auto-reset
 * transistors and the S3's native USB-Serial/JTAG (VID 0x303A, PID 0x1001).
 */

export const ESPRESSIF_VID = 0x303a
const USB_JTAG_SERIAL_PID = 0x1001

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const set = (port: SerialPort, dtr: boolean, rts: boolean) =>
	port.setSignals({ dataTerminalReady: dtr, requestToSend: rts })

export function isUsbJtagSerial(port: SerialPort) {
	const { usbVendorId, usbProductId } = port.getInfo()
	return usbVendorId === ESPRESSIF_VID && usbProductId === USB_JTAG_SERIAL_PID
}

/** Reset and run the flashed app. esptool-js 0.7 never pulls EN low after flashing. */
export async function hardReset(port: SerialPort) {
	await set(port, false, true)
	if (isUsbJtagSerial(port)) {
		await sleep(200)
		await set(port, false, false)
		await sleep(200)
	} else {
		await sleep(100)
		await set(port, false, false)
	}
}

/**
 * After opening a port, leave the chip running. Opening can assert RTS, which
 * holds EN low (reset); release it first, as esp-wasm's monitor does. DTR stays
 * high only on MicroPython's own native-USB (TinyUSB) console, which drops all
 * output while no terminal asserts DTR.
 */
export async function settleSignals(port: SerialPort) {
	const { usbVendorId, usbProductId } = port.getInfo()
	const tinyUsb = usbVendorId === ESPRESSIF_VID && usbProductId !== USB_JTAG_SERIAL_PID
	try {
		await port.setSignals({ requestToSend: false })
		await port.setSignals({ dataTerminalReady: tinyUsb })
	} catch {
		/* WebUSB adapters and some drivers don't support every signal */
	}
}
