import { defineBlock } from '../../define'
import { BOOL, out } from '../../../plc/ports'

/*
 * IEC 61131-3 bit logic. Functions, not function blocks: no memory, the
 * output follows the inputs within the same scan.
 */

const gate = (name: string, description: string, py: string, op: string) =>
	defineBlock({
		id: `plc.${name.toLowerCase()}`,
		category: 'Bit logic',
		title: name,
		description,
		inputs: [BOOL('IN1'), BOOL('IN2')],
		outputs: [out(BOOL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    a = b.get('IN1') >= 0.5
    c = b.get('IN2') >= 0.5
    b.set('OUT', 1 if ${py} else 0)
`,
		plc: { st: (x) => `${x.IN1} ${op} ${x.IN2}` },
	})

export const blocks = [
	gate('AND', 'TRUE while IN1 and IN2 are both TRUE', 'a and c', 'AND'),
	gate('OR', 'TRUE while IN1 or IN2 (or both) is TRUE', 'a or c', 'OR'),
	gate('XOR', 'TRUE while exactly one of IN1 and IN2 is TRUE', 'a != c', 'XOR'),
	defineBlock({
		id: 'plc.not',
		category: 'Bit logic',
		title: 'NOT',
		description: 'TRUE while IN is FALSE',
		inputs: [BOOL('IN')],
		outputs: [out(BOOL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', 0 if b.get('IN') >= 0.5 else 1)
`,
		plc: { st: (x) => `NOT ${x.IN}` },
	}),
]
