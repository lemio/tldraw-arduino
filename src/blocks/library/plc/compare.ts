import { defineBlock } from '../../define'
import { BOOL, REAL, out } from '../../../plc/ports'

/* Comparison functions: two numbers in, a BOOL out. INT and TIME widen to REAL on the wire. */

const compare = (name: string, op: string, py: string, words: string) =>
	defineBlock({
		id: `plc.${name.toLowerCase()}`,
		category: 'Compare',
		title: name,
		description: `TRUE while IN1 ${words} IN2`,
		inputs: [REAL('IN1'), REAL('IN2')],
		outputs: [out(BOOL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', 1 if b.get('IN1') ${py} b.get('IN2') else 0)
`,
		plc: { st: (x) => `${x.IN1} ${op} ${x.IN2}` },
	})

export const blocks = [
	compare('GT', '>', '>', 'is greater than'),
	compare('GE', '>=', '>=', 'is greater than or equal to'),
	compare('EQ', '=', '==', 'equals'),
	compare('NE', '<>', '!=', 'differs from'),
	compare('LE', '<=', '<=', 'is less than or equal to'),
	compare('LT', '<', '<', 'is less than'),
]
