import { defineBlock } from '../../define'
import { INT, REAL, TIME, out } from '../../../plc/ports'

/*
 * Scaling and type conversion. Analog channels arrive as REAL 0.0–1.0, so
 * SCALE_X turns one into engineering units and NORM_X goes back.
 */

export const blocks = [
	defineBlock({
		id: 'plc.scale_x',
		category: 'Conversion',
		title: 'SCALE_X',
		description: 'Scales VALUE (0.0–1.0) onto MIN..MAX, for example a sensor into °C',
		example: 'For example: Tank level in litres',
		inputs: [REAL('MIN'), REAL('VALUE'), REAL('MAX', { default: 100 })],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    lo = b.get('MIN')
    b.set('OUT', lo + b.get('VALUE') * (b.get('MAX') - lo))
`,
		plc: { st: (x) => `${x.VALUE} * (${x.MAX} - ${x.MIN}) + ${x.MIN}` },
	}),
	defineBlock({
		id: 'plc.norm_x',
		category: 'Conversion',
		title: 'NORM_X',
		description: 'Normalises VALUE from MIN..MAX onto 0.0–1.0, for example for an analog output',
		inputs: [REAL('MIN'), REAL('VALUE'), REAL('MAX', { default: 100 })],
		outputs: [out(REAL('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    lo = b.get('MIN')
    span = b.get('MAX') - lo
    b.set('OUT', (b.get('VALUE') - lo) / span if span else 0)
`,
		plc: { st: (x) => `(${x.VALUE} - ${x.MIN}) / (${x.MAX} - ${x.MIN})` },
	}),
	defineBlock({
		id: 'plc.real_to_int',
		category: 'Conversion',
		title: 'REAL_TO_INT',
		description: 'Rounds a REAL to the nearest INT',
		inputs: [REAL('IN')],
		outputs: [out(INT('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    v = b.get('IN')
    n = int(v + 0.5) if v >= 0 else -int(0.5 - v)
    b.set('OUT', max(-32768, min(32767, n)))
`,
		plc: { st: (x) => `REAL_TO_INT(${x.IN})` },
	}),
	defineBlock({
		id: 'plc.real_to_time',
		category: 'Conversion',
		title: 'REAL_TO_TIME',
		description: 'A REAL number of milliseconds as a TIME, for example to set a timer’s PT from a knob',
		inputs: [REAL('IN')],
		outputs: [out(TIME('OUT'))],
		display: 'OUT',
		python: `
def update(b):
    b.set('OUT', max(0, int(b.get('IN'))))
`,
		plc: { st: (x) => `REAL_TO_TIME(${x.IN})` },
	}),
]
