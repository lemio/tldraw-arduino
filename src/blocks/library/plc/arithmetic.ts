import { defineBlock } from '../../define'
import { REAL, out } from '../../../plc/ports'

/* Arithmetic on REAL. Dividing by zero gives 0 rather than stopping the PLC. */

const op = (name: string, sym: string, py: string, description: string, b2 = 0) =>
	defineBlock({
		id: `plc.${name.toLowerCase()}`,
		category: 'Arithmetic',
		title: name,
		description,
		inputs: [REAL('IN1'), REAL('IN2', { default: b2 })],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    a = b.get('IN1')
    c = b.get('IN2')
    b.set('OUT', ${py})
`,
		plc: { st: (x) => `${x.IN1} ${sym} ${x.IN2}` },
	})

export const blocks = [
	op('ADD', '+', 'a + c', 'IN1 + IN2'),
	op('SUB', '-', 'a - c', 'IN1 − IN2'),
	op('MUL', '*', 'a * c', 'IN1 × IN2', 1),
	op('DIV', '/', 'a / c if c else 0', 'IN1 ÷ IN2 (0 when IN2 is 0)', 1),
]
