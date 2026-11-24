import { Editor } from 'tldraw'
import { executionOrder } from '../blocks/order'
import { getDef } from '../blocks/registry'
import { Block, blockName, getIncomingWire, getWireEnds, iecTypeOf } from '../shapes/signals'
import { IO_TYPE, IoShape, KIND_INFO, LOGIC_TYPE, LogicShape, isInput } from '../shapes/types'
import { IecType, fmtReal, fmtTime, iecCompatible, iecOfIo, iecOfSignal, ioAddress } from './iec'

/*
 * The canvas as IEC 61131-3 Structured Text: one PROGRAM, with every pin at
 * its address, every function block as an instance, and the body in the
 * order the canvas scans it. It is what a PLC would run; paste it into
 * CODESYS or OpenPLC to try. (The board itself runs main.py, the same
 * program in MicroPython.)
 */

/** Words an IEC identifier can't be: keywords, types, and the standard blocks. */
const RESERVED = new Set(
	`PROGRAM END_PROGRAM VAR END_VAR VAR_INPUT VAR_OUTPUT AT IF THEN ELSE ELSIF END_IF CASE OF END_CASE FOR TO BY DO END_FOR
	WHILE END_WHILE REPEAT UNTIL END_REPEAT RETURN EXIT TRUE FALSE AND OR XOR NOT MOD BOOL INT DINT REAL LREAL TIME DWORD WORD
	BYTE STRING TON TOF TP CTU CTD CTUD R_TRIG F_TRIG SR RS GT GE EQ NE LE LT ADD SUB MUL DIV SEL MAX MIN LIMIT MUX MOVE
	PID SCALE_X NORM_X REAL_TO_INT REAL_TO_TIME INT_TO_REAL TIME_TO_REAL PLC_PRG`
		.split(/\s+/)
		.filter(Boolean)
)

function identifier(text: string) {
	const s = text
		.normalize('NFKD')
		.replace(/[^\w\s]/g, '')
		.trim()
		.replace(/\s+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
	return /^\d/.test(s) ? `_${s}` : s
}

/** A constant of this type, as ST writes it. */
function literal(t: IecType, v: number) {
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

export function generateST(editor: Editor): string {
	const shapes = editor.getCurrentPageShapes()
	const io = shapes
		.filter((s): s is IoShape => s.type === IO_TYPE && (s as IoShape).props.pin >= 0)
		.sort((a, b) => a.y - b.y || a.x - b.x)
	const logic = executionOrder(
		editor,
		shapes.filter((s): s is LogicShape => s.type === LOGIC_TYPE)
	)
	if (!io.length && !logic.length) {
		return '(* Add blocks to the canvas: their program appears here as Structured Text. *)\n'
	}

	// Names: the block's own name, else its type numbered (TON_1). Case doesn't count in IEC.
	const taken = new Set<string>()
	const names = new Map<string, string>()
	const counts = new Map<string, number>()
	const claim = (base: string) => {
		let name = base || 'Block'
		for (let i = 2; taken.has(name.toUpperCase()) || RESERVED.has(name.toUpperCase()); i++) name = `${base}_${i}`
		taken.add(name.toUpperCase())
		return name
	}
	for (const b of [...io, ...logic]) {
		let base = b.props.label ? identifier(b.props.label) : ''
		if (!base) {
			const type = b.type === IO_TYPE ? identifier(KIND_INFO[b.props.kind].title) : identifier(getDef(b).title)
			const n = (counts.get(type) ?? 0) + 1
			counts.set(type, n)
			base = `${type}_${n}`
		}
		names.set(b.id, claim(base))
	}

	const ins: string[] = []
	const outs: string[] = []
	const fbs: string[] = []
	const analog: string[] = []
	const results: string[] = []
	const prologue: string[] = []
	const body: string[] = []
	const epilogue: string[] = []
	const raw = new Map<string, string>()

	for (const b of io) {
		const n = names.get(b.id)!
		const k = b.props.kind
		const at = ioAddress(k, b.props.pin)
		const where = `GPIO ${b.props.pin}`
		if (k === 'din') {
			const d = b.props.device
			const what =
				d === 'no' ? ', NO push button: TRUE while pressed' : d === 'nc' ? ', NC push button: TRUE at rest' : d === 'toggle' ? ', toggle switch' : b.props.pull !== 'none' ? `, pull-${b.props.pull}` : ''
			ins.push(`${n} AT ${at} : BOOL;  (* ${where}${what} *)`)
		}
		else if (k === 'dout') outs.push(`${n} AT ${at} : BOOL;  (* ${where} *)`)
		else if (k === 'rgb') outs.push(`${n} AT ${at} : DWORD;  (* ${where}, WS2812 colour 16#RRGGBB *)`)
		else {
			const r = claim(`${n}_raw`)
			raw.set(b.id, r)
			if (k === 'ain') {
				ins.push(`${r} AT ${at} : INT;  (* ${where}, ADC 0..4095 *)`)
				analog.push(`${n} : REAL;  (* 0.0..1.0 *)`)
				prologue.push(`${n} := INT_TO_REAL(${r}) / 4095.0;`)
			} else outs.push(`${r} AT ${at} : INT;  (* ${where}, PWM duty 0..4095 *)`)
		}
	}

	/** What an output port is called in ST. */
	const source = (b: Block, port: string): string => {
		const n = names.get(b.id)
		if (!n) return '0'
		if (b.type === IO_TYPE) return n
		const def = getDef(b)
		if (def.plc?.fb) return `${n}.${port}`
		if (def.plc?.st) return n
		return `${n}_${port}`
	}

	const notes: string[] = []
	/** The ST for what arrives at an input: its wire's source, widened if need be, or the constant set on the block. */
	const arriving = (b: Block, port: string, want: IecType, constant: number) => {
		const wire = getIncomingWire(editor, b.id, port)
		const ends = wire && getWireEnds(editor, wire)
		if (!ends?.from || !names.has(ends.from.id)) return literal(want, constant)
		const have = iecTypeOf(ends.from, ends.fromPort)
		if (!iecCompatible(have, want)) {
			notes.push(
				`(* Type error: ${source(ends.from, ends.fromPort)} is ${have}, ${names.get(b.id)}${port ? '.' + port : ''} wants ${want}: using ${literal(want, constant)} *)`
			)
			return literal(want, constant)
		}
		const v = source(ends.from, ends.fromPort)
		return have === want ? v : `${have}_TO_${want}(${v})`
	}

	logic.forEach((b, i) => {
		const n = names.get(b.id)!
		const def = getDef(b)
		const step = `(* ${i + 1} *) `
		const args: Record<string, string> = {}
		for (const p of def.inputs) {
			args[p.id] = arriving(b, p.id, p.iec ?? iecOfSignal(p.type), b.props.params[p.id] ?? p.default ?? 0)
		}
		const pending = notes.splice(0)
		if (def.plc?.fb) {
			fbs.push(`${n} : ${def.title};${def.id === 'plc.pid' ? '  (* CODESYS Util library *)' : ''}`)
			body.push(...pending, `${step}${n}(${def.inputs.map((p) => `${p.id} := ${args[p.id]}`).join(', ')});`)
		} else if (def.plc?.st) {
			const out = def.outputs[0]
			results.push(`${n} : ${out ? (out.iec ?? iecOfSignal(out.type)) : 'BOOL'};`)
			body.push(...pending, `${step}${n} := ${def.plc.st(args)};`)
		} else {
			for (const o of def.outputs) results.push(`${n}_${o.id} : ${o.iec ?? iecOfSignal(o.type)};`)
			body.push(`${step}(* “${blockName(b)}” is a MicroPython block: it has no Structured Text form here *)`)
		}
	})

	for (const b of io) {
		if (isInput(b.props.kind)) continue
		const n = names.get(b.id)!
		const want = iecOfIo(b.props.kind)
		const v = arriving(b, '', want, b.props.value)
		epilogue.push(...notes.splice(0))
		if (b.props.kind === 'aout') epilogue.push(`${raw.get(b.id)} := REAL_TO_INT(LIMIT(0.0, ${v}, 1.0) * 4095.0);`)
		else if (v !== n) epilogue.push(`${n} := ${v};`)
	}

	const section = (title: string, lines: string[]) => (lines.length ? [`    (* ${title} *)`, ...alignComments(lines).map((l) => '    ' + l)] : [])
	const out = [
		'(* Generated from the canvas: IEC 61131-3 Structured Text. *)',
		'(* One scan: read the inputs, run every block once in execution order (the numbers), write the outputs. *)',
		'PROGRAM PLC_PRG',
		'VAR',
		...section('Inputs', ins),
		...section('Outputs', outs),
		...section('Function blocks', fbs),
		...section('Analog inputs, scaled', analog),
		...section('Results', results),
		'END_VAR',
		'',
	]
	if (prologue.length) out.push('(* Analog inputs as REAL 0.0..1.0 *)', ...prologue, '')
	if (body.length) out.push(...body, '')
	if (epilogue.length) out.push('(* Outputs *)', ...epilogue, '')
	out.push('END_PROGRAM', '')
	return out.join('\n')
}

/** Line up trailing comments so declarations read as a table. */
function alignComments(lines: string[]) {
	const split = lines.map((l) => {
		const i = l.indexOf('  (*')
		return i < 0 ? [l, ''] : [l.slice(0, i), l.slice(i + 2)]
	})
	const w = Math.max(...split.map(([c]) => c.length))
	return split.map(([c, k]) => (k ? `${c.padEnd(w)}  ${k}` : c))
}
