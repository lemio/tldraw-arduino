import { defineBlock } from '../../define'
import { BOOL, out } from '../../../plc/ports'

/* Latches. SR: set wins when both are TRUE; RS: reset wins. */

export const blocks = [
	defineBlock({
		id: 'plc.sr',
		category: 'Bistables',
		title: 'SR',
		description: 'Latch, set-dominant: S1 turns Q1 on, R turns it off; S1 wins if both are TRUE',
		example: 'For example: Pump latched on',
		inputs: [BOOL('S1'), BOOL('R')],
		outputs: [out(BOOL('Q1'))],
		display: 'Q1',
		python: `
def update(b):
    q = b.get('S1') >= 0.5 or (b.get('R') < 0.5 and b.state.get('Q1', 0))
    b.state['Q1'] = 1 if q else 0
    b.set('Q1', b.state['Q1'])
`,
		plc: { fb: true },
	}),
	defineBlock({
		id: 'plc.rs',
		category: 'Bistables',
		title: 'RS',
		description: 'Latch, reset-dominant: S turns Q1 on, R1 turns it off; R1 wins if both are TRUE',
		example: 'For example: Motor run latch',
		inputs: [BOOL('S'), BOOL('R1')],
		outputs: [out(BOOL('Q1'))],
		display: 'Q1',
		python: `
def update(b):
    q = b.get('R1') < 0.5 and (b.get('S') >= 0.5 or b.state.get('Q1', 0))
    b.state['Q1'] = 1 if q else 0
    b.set('Q1', b.state['Q1'])
`,
		plc: { fb: true },
	}),
]
