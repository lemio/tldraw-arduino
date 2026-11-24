import { Editor } from 'tldraw'
import type { IoKind, SignalType } from '../shapes/types'

/*
 * PLC mode: the canvas as an IEC 61131-3 Function Block Diagram.
 *
 * The mode, and whether the PLC runs, live in the shared document, so
 * everyone in the room works on the same kind of program. In PLC mode:
 *
 * - wires are strictly typed (BOOL, INT, REAL, TIME) and carry values
 *   unchanged; converting is the job of function blocks, as on a real PLC;
 * - the program runs as a scan cycle: read the inputs, run every block once
 *   in execution order, write the outputs;
 * - STOP halts the program and switches every output off.
 */

export type IecType = 'BOOL' | 'INT' | 'REAL' | 'TIME' | 'DWORD'

export const isPlc = (editor: Editor) => editor.getDocumentSettings().meta.plc === true

/** True while a PLC-mode canvas is in STOP: no scans, every output off. */
export const isPlcStopped = (editor: Editor) => isPlc(editor) && editor.getDocumentSettings().meta.plcStop === true

function setMeta(editor: Editor, patch: Record<string, boolean>, mark: string) {
	editor.markHistoryStoppingPoint(mark)
	editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, ...patch } })
}

export const setPlc = (editor: Editor, on: boolean) => setMeta(editor, { plc: on }, 'plc mode')
export const setPlcRunning = (editor: Editor, run: boolean) => setMeta(editor, { plcStop: !run }, 'plc run')

/** The scan cycle: the canvas runs every block once per cycle (see blocks/runner). */
export const CYCLE_MS = 50

/** The IEC type a signal has when a port doesn't name one. */
export function iecOfSignal(t: SignalType): IecType {
	if (t === 'digital') return 'BOOL'
	if (t === 'colour') return 'DWORD'
	return 'REAL'
}

export function iecOfIo(kind: IoKind): IecType {
	if (kind === 'din' || kind === 'dout') return 'BOOL'
	if (kind === 'rgb') return 'DWORD'
	return 'REAL'
}

/**
 * Whether a wire may join these types. Like CODESYS: the same type, or a
 * widening that loses nothing (INT and TIME into REAL). Anything else needs a
 * conversion block.
 */
export function iecCompatible(src: IecType, dst: IecType) {
	return src === dst || (dst === 'REAL' && (src === 'INT' || src === 'TIME'))
}

/** How a value reads in an online (monitoring) view. */
export function fmtIec(t: IecType, v: number): string {
	switch (t) {
		case 'BOOL':
			return v >= 0.5 ? 'TRUE' : 'FALSE'
		case 'INT':
			return String(Math.round(v))
		case 'TIME':
			return fmtTime(v)
		case 'DWORD':
			return '16#' + (Math.round(v) & 0xffffff).toString(16).toUpperCase().padStart(6, '0')
		default:
			return fmtReal(v)
	}
}

export function fmtReal(v: number) {
	if (!Number.isFinite(v)) return '0.0'
	const a = Math.abs(v)
	const s = a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3)
	const t = s.replace(/0+$/, '')
	return t.endsWith('.') ? t + '0' : t.includes('.') ? t : t + '.0'
}

/** Milliseconds as an IEC duration: T#1m30s, T#250ms, T#0ms. */
export function fmtTime(ms: number) {
	let left = Math.max(0, Math.round(ms))
	if (!left) return 'T#0ms'
	const parts: string[] = []
	for (const [unit, size] of [
		['d', 86_400_000],
		['h', 3_600_000],
		['m', 60_000],
		['s', 1000],
		['ms', 1],
	] as const) {
		const n = Math.floor(left / size)
		if (n) parts.push(`${n}${unit}`)
		left -= n * size
	}
	return 'T#' + parts.join('')
}

/**
 * Read a duration as people type it: T#5s, TIME#1m30s, 2.5s, 500ms. A bare
 * number is milliseconds, TIME's own unit. Null when it isn't a duration.
 */
export function parseTime(text: string): number | null {
	const s = text.trim().toLowerCase().replace(/^(t|time)#/, '').replace(/_/g, '')
	if (!s) return null
	if (/^-?\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.round(Number(s)))
	const re = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/g
	let total = 0
	let used = 0
	for (let m = re.exec(s); m; m = re.exec(s)) {
		const size = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1000, ms: 1 }[m[2] as 'd' | 'h' | 'm' | 's' | 'ms']
		total += Number(m[1]) * size
		used += m[0].length
	}
	return used === s.length ? Math.round(total) : null
}

/**
 * A pin's IEC address, derived from its GPIO so it never changes: bits for
 * BOOL (%IX1.5 is GPIO 13: byte 1, bit 5), words for analog channels.
 */
export function ioAddress(kind: IoKind, gpio: number) {
	if (gpio < 0) return ''
	const area = kind === 'din' || kind === 'ain' ? 'I' : 'Q'
	if (kind === 'din' || kind === 'dout') return `%${area}X${gpio >> 3}.${gpio & 7}`
	if (kind === 'rgb') return `%QD${gpio}`
	return `%${area}W${gpio}`
}

/** What a type is, in a few words, for tooltips. */
export const IEC_HINT: Record<IecType, string> = {
	BOOL: 'BOOL: TRUE or FALSE',
	INT: 'INT: a whole number',
	REAL: 'REAL: a number with decimals (analog channels run 0.0–1.0)',
	TIME: 'TIME: a duration, for example T#5s',
	DWORD: 'DWORD: a colour, 16#RRGGBB',
}
