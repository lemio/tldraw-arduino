import type { BlockDef, PortSpec } from '../blocks/define'

/*
 * IEC 61131-3 names are short codes (TON, CTU, PT). The code keeps them, as
 * Structured Text needs them, but people read the full name, or the symbol
 * when the operation has one.
 */

const BLOCKS: Record<string, { name: string; symbol?: string }> = {
	AND: { name: 'And', symbol: '&' },
	OR: { name: 'Or', symbol: '≥1' },
	XOR: { name: 'Exclusive or', symbol: '=1' },
	NOT: { name: 'Not', symbol: '¬' },
	R_TRIG: { name: 'Rising edge', symbol: '↑' },
	F_TRIG: { name: 'Falling edge', symbol: '↓' },
	SR: { name: 'Latch, set wins' },
	RS: { name: 'Latch, reset wins' },
	TON: { name: 'On-delay timer' },
	TOF: { name: 'Off-delay timer' },
	TP: { name: 'Pulse timer' },
	CTU: { name: 'Count up' },
	CTD: { name: 'Count down' },
	CTUD: { name: 'Count up and down' },
	GT: { name: 'Greater than', symbol: '>' },
	GE: { name: 'Greater than or equal', symbol: '≥' },
	EQ: { name: 'Equal', symbol: '=' },
	NE: { name: 'Not equal', symbol: '≠' },
	LE: { name: 'Less than or equal', symbol: '≤' },
	LT: { name: 'Less than', symbol: '<' },
	ADD: { name: 'Add', symbol: '+' },
	SUB: { name: 'Subtract', symbol: '−' },
	MUL: { name: 'Multiply', symbol: '×' },
	DIV: { name: 'Divide', symbol: '÷' },
	SEL: { name: 'Select' },
	MAX: { name: 'Maximum' },
	MIN: { name: 'Minimum' },
	LIMIT: { name: 'Limit' },
	SCALE_X: { name: 'Scale' },
	NORM_X: { name: 'Normalise' },
	REAL_TO_INT: { name: 'Real to integer' },
	REAL_TO_TIME: { name: 'Real to time' },
	PID: { name: 'Proportional–integral–derivative controller' },
}

const PORTS: Record<string, string> = {
	IN: 'input',
	IN0: 'input when the selector is FALSE',
	IN1: 'input 1',
	IN2: 'input 2',
	OUT: 'result',
	Q: 'output',
	Q1: 'output',
	S: 'set',
	S1: 'set (wins)',
	R: 'reset',
	R1: 'reset (wins)',
	RESET: 'reset',
	PT: 'preset time',
	ET: 'elapsed time',
	CU: 'count up',
	CD: 'count down',
	LD: 'load the preset value',
	PV: 'preset value',
	CV: 'counter value',
	QU: 'reached the preset (counting up)',
	QD: 'reached zero (counting down)',
	CLK: 'clock',
	G: 'selector',
	MN: 'minimum',
	MX: 'maximum',
	MIN: 'minimum',
	MAX: 'maximum',
	VALUE: 'value',
	SET_POINT: 'set point: the value to reach',
	ACTUAL: 'actual value',
	Y: 'output',
	Y_MIN: 'lowest output',
	Y_MAX: 'highest output',
	KP: 'proportional gain',
	TN: 'integral time',
	TV: 'derivative time',
}

/** The full name of an IEC block, in place of its code. */
export const plcName = (def: Pick<BlockDef, 'title' | 'plc'>) => (def.plc && BLOCKS[def.title]?.name) || def.title

/** The operator symbol of an IEC block, when it has one (& ≥1 > + …). */
export const plcSymbol = (def: Pick<BlockDef, 'title' | 'plc'>) => (def.plc ? BLOCKS[def.title]?.symbol : undefined)

/** "PT: preset time" for an IEC port; just the id elsewhere. */
export const portName = (plc: boolean, port: Pick<PortSpec, 'id' | 'label'>) => {
	const id = port.label || port.id
	const full = plc ? PORTS[port.id] : undefined
	return full ? `${id}: ${full}` : id
}
