import { defineBlock } from '../../define'
import { BOOL, REAL, out } from '../../../plc/ports'

/* Selection functions. */

export const blocks = [
	defineBlock({
		id: 'plc.sel',
		category: 'Selection',
		title: 'SEL',
		description: 'Binary selection: OUT is IN0 while G is FALSE, IN1 while G is TRUE',
		inputs: [BOOL('G'), REAL('IN0'), REAL('IN1', { default: 1 })],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', b.get('IN1') if b.get('G') >= 0.5 else b.get('IN0'))
`,
		plc: { st: (x) => `SEL(${x.G}, ${x.IN0}, ${x.IN1})` },
	}),
	defineBlock({
		id: 'plc.max',
		category: 'Selection',
		title: 'MAX',
		description: 'The larger of IN1 and IN2',
		inputs: [REAL('IN1'), REAL('IN2')],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', max(b.get('IN1'), b.get('IN2')))
`,
		plc: { st: (x) => `MAX(${x.IN1}, ${x.IN2})` },
	}),
	defineBlock({
		id: 'plc.min',
		category: 'Selection',
		title: 'MIN',
		description: 'The smaller of IN1 and IN2',
		inputs: [REAL('IN1'), REAL('IN2')],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', min(b.get('IN1'), b.get('IN2')))
`,
		plc: { st: (x) => `MIN(${x.IN1}, ${x.IN2})` },
	}),
	defineBlock({
		id: 'plc.limit',
		category: 'Selection',
		title: 'LIMIT',
		description: 'IN, kept between MN and MX',
		inputs: [REAL('MN'), REAL('IN'), REAL('MX', { default: 1 })],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', max(b.get('MN'), min(b.get('MX'), b.get('IN'))))
`,
		plc: { st: (x) => `LIMIT(${x.MN}, ${x.IN}, ${x.MX})` },
	}),
]
