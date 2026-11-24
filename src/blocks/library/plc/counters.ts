import { defineBlock } from '../../define'
import { BOOL, INT, out } from '../../../plc/ports'

/*
 * IEC 61131-3 counters. They count rising edges of CU / CD (each keeps its
 * own edge memory), and CV stays within INT, -32768..32767.
 */

const progress = ({ out, inputs }: { out: Record<string, number>; inputs: Record<string, number> }) =>
	inputs.PV > 0 ? (out.CV ?? 0) / inputs.PV : 0

export const blocks = [
	defineBlock({
		id: 'plc.ctu',
		category: 'Counters',
		title: 'CTU',
		description: 'Counts up on each rising edge of CU; Q is TRUE once CV reaches PV; R sets CV to 0',
		example: 'For example: Bottles in crate',
		inputs: [BOOL('CU'), BOOL('R'), INT('PV', { default: 5 })],
		outputs: [out(BOOL('Q')), out(INT('CV'))],
		display: 'CV',
		python: `
def update(b):
    cu = 1 if b.get('CU') >= 0.5 else 0
    cv = b.state.get('CV', 0)
    if b.get('R') >= 0.5:
        cv = 0
    elif cu and not b.state.get('M', 0) and cv < 32767:
        cv += 1
    b.state['M'] = cu
    b.state['CV'] = cv
    b.set('CV', cv)
    b.set('Q', 1 if cv >= b.get('PV') else 0)
`,
		plc: { fb: true, progress },
	}),
	defineBlock({
		id: 'plc.ctd',
		category: 'Counters',
		title: 'CTD',
		description: 'Counts down on each rising edge of CD; Q is TRUE once CV is 0 or less; LD loads PV',
		example: 'For example: Parts left',
		inputs: [BOOL('CD'), BOOL('LD'), INT('PV', { default: 5 })],
		outputs: [out(BOOL('Q')), out(INT('CV'))],
		display: 'CV',
		python: `
def update(b):
    cd = 1 if b.get('CD') >= 0.5 else 0
    cv = b.state.get('CV', 0)
    if b.get('LD') >= 0.5:
        cv = int(b.get('PV'))
    elif cd and not b.state.get('M', 0) and cv > -32768:
        cv -= 1
    b.state['M'] = cd
    b.state['CV'] = cv
    b.set('CV', cv)
    b.set('Q', 1 if cv <= 0 else 0)
`,
		plc: { fb: true, progress },
	}),
	defineBlock({
		id: 'plc.ctud',
		category: 'Counters',
		title: 'CTUD',
		description: 'Counts up on CU and down on CD; QU once CV reaches PV, QD at 0 or less; R resets, LD loads PV',
		example: 'For example: Cars in car park',
		inputs: [BOOL('CU'), BOOL('CD'), BOOL('R'), BOOL('LD'), INT('PV', { default: 5 })],
		outputs: [out(BOOL('QU')), out(BOOL('QD')), out(INT('CV'))],
		display: 'CV',
		python: `
def update(b):
    cu = 1 if b.get('CU') >= 0.5 else 0
    cd = 1 if b.get('CD') >= 0.5 else 0
    up = cu and not b.state.get('MU', 0)
    down = cd and not b.state.get('MD', 0)
    cv = b.state.get('CV', 0)
    if b.get('R') >= 0.5:
        cv = 0
    elif b.get('LD') >= 0.5:
        cv = int(b.get('PV'))
    elif not (up and down):
        if up and cv < 32767:
            cv += 1
        elif down and cv > -32768:
            cv -= 1
    b.state['MU'] = cu
    b.state['MD'] = cd
    b.state['CV'] = cv
    b.set('CV', cv)
    b.set('QU', 1 if cv >= b.get('PV') else 0)
    b.set('QD', 1 if cv <= 0 else 0)
`,
		plc: { fb: true, progress },
	}),
]
