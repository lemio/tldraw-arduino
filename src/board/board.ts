import boardJson from './devkitc-1.json'
import boardSvg from './devkitc-1.svg'
import type { IoKind } from '../shapes/types'

/*
 * The ESP32-S3-DevKitC-1 as a PCBMAP.org pin map (from the Schematik project):
 * pin positions in mm on artwork drawn at 80 px per 2.54 mm pitch.
 */

export const BOARD = {
	name: boardJson.name,
	svg: boardSvg,
	/** Artwork size in px. */
	w: 816,
	h: 1936,
	pxPerMm: 80 / 2.54,
}

export interface BoardPin {
	/** Header label, e.g. "4", "GND.1", "3V3.2". */
	id: string
	/** Centre in artwork px. */
	x: number
	y: number
	side: 'left' | 'right'
	/** GPIO number, or null for power, ground and reset. */
	gpio: number | null
	note?: string
}

export const BOARD_PINS: BoardPin[] = Object.entries(boardJson.pins).map(([id, p]) => {
	const pin = p as { x: number; y: number; target: string; note?: string }
	const m = /^GPIO(\d+)$/.exec(pin.target)
	return {
		id,
		x: pin.x * BOARD.pxPerMm,
		y: pin.y * BOARD.pxPerMm,
		side: pin.x < boardJson.width / 2 ? 'left' : 'right',
		gpio: m ? Number(m[1]) : null,
		note: pin.note,
	}
})

/** ADC1 is GPIO 1–10, ADC2 GPIO 11–20. */
const isAdc = (g: number) => g >= 1 && g <= 20

/** Why a pin can't serve a block of this kind (a few words), or null when it can. */
export function pinUnavailable(pin: BoardPin, kind: IoKind): string | null {
	if (pin.gpio === null) {
		if (pin.id.startsWith('GND')) return 'Ground'
		if (pin.id === 'RST') return 'Reset'
		return `Power, ${pin.note ?? pin.id}`
	}
	const g = pin.gpio
	if (g === 19 || g === 20) return 'USB data: keeps the board connected'
	if (g === 43 || g === 44) return 'Serial port TX/RX'
	if (g >= 35 && g <= 37) return 'Used by PSRAM'
	if (kind === 'ain' && !isAdc(g)) return 'Not analog: pick a row with ~'
	return null
}

export const pinLabel = (gpio: number) => `GPIO ${gpio}`

export const boardPinFor = (gpio: number) => BOARD_PINS.find((p) => p.gpio === gpio)
