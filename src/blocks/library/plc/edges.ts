import { defineBlock } from '../../define'
import { BOOL, out } from '../../../plc/ports'

/*
 * Edge detection, exactly as IEC 61131-3 defines it: Q is TRUE for one scan.
 * M is the remembered CLK (F_TRIG remembers NOT CLK), FALSE in a fresh
 * instance, so an F_TRIG whose CLK starts FALSE fires once on its first scan,
 * as it does on a real PLC.
 */

export const blocks = [
	defineBlock({
		id: 'plc.r_trig',
		category: 'Edges',
		title: 'R_TRIG',
		description: 'Rising edge: Q is TRUE for one scan when CLK goes from FALSE to TRUE',
		example: 'For example: Start pressed',
		inputs: [BOOL('CLK')],
		outputs: [out(BOOL('Q'))],
		display: 'Q',
		python: `
def update(b):
    clk = 1 if b.get('CLK') >= 0.5 else 0
    b.set('Q', 1 if clk and not b.state.get('M', 0) else 0)
    b.state['M'] = clk
`,
		plc: { fb: true },
	}),
	defineBlock({
		id: 'plc.f_trig',
		category: 'Edges',
		title: 'F_TRIG',
		description: 'Falling edge: Q is TRUE for one scan when CLK goes from TRUE to FALSE',
		example: 'For example: Door closed',
		inputs: [BOOL('CLK')],
		outputs: [out(BOOL('Q'))],
		display: 'Q',
		python: `
def update(b):
    nclk = 0 if b.get('CLK') >= 0.5 else 1
    b.set('Q', 1 if nclk and not b.state.get('M', 0) else 0)
    b.state['M'] = nclk
`,
		plc: { fb: true },
	}),
]
