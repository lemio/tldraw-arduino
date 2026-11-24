import { defineBlock } from '../../define'
import { BOOL, TIME, out } from '../../../plc/ports'

/*
 * IEC 61131-3 timers. PT and ET are TIME, in milliseconds. A timer measures
 * real time between scans, so it behaves the same whatever the cycle time.
 * If the clock it started on is gone (the page reloaded, the board
 * restarted), a running timer starts over.
 */

const progress = ({ out, inputs }: { out: Record<string, number>; inputs: Record<string, number> }) =>
	inputs.PT > 0 ? (out.ET ?? 0) / inputs.PT : 0

export const blocks = [
	defineBlock({
		id: 'plc.ton',
		category: 'Timers',
		title: 'TON',
		description: 'On-delay: Q turns TRUE once IN has been TRUE for PT; FALSE as soon as IN is',
		example: 'For example: Start delay',
		inputs: [BOOL('IN'), TIME('PT', { default: 5000 })],
		outputs: [out(BOOL('Q')), out(TIME('ET'))],
		display: 'Q',
		python: `
def update(b):
    pt = max(0, int(b.get('PT')))
    t = b.now()
    et = 0
    if b.get('IN') >= 0.5:
        s = b.state.get('start')
        if s is None or t < s:
            s = t
            b.state['start'] = s
        et = min(pt, t - s)
    else:
        b.state['start'] = None
    b.set('ET', et)
    b.set('Q', 1 if b.get('IN') >= 0.5 and et >= pt else 0)
`,
		plc: { fb: true, progress },
	}),
	defineBlock({
		id: 'plc.tof',
		category: 'Timers',
		title: 'TOF',
		description: 'Off-delay: Q follows IN going TRUE, and stays TRUE for PT after IN goes FALSE',
		example: 'For example: Fan run-on',
		inputs: [BOOL('IN'), TIME('PT', { default: 3000 })],
		outputs: [out(BOOL('Q')), out(TIME('ET'))],
		display: 'Q',
		python: `
def update(b):
    pt = max(0, int(b.get('PT')))
    t = b.now()
    if b.get('IN') >= 0.5:
        b.state['start'] = None
        b.state['q'] = 1
        b.state['et'] = 0
    elif b.state.get('q'):
        s = b.state.get('start')
        if s is None or t < s:
            s = t
            b.state['start'] = s
        et = min(pt, t - s)
        b.state['et'] = et
        if et >= pt:
            b.state['q'] = 0
            b.state['start'] = None
    b.set('Q', b.state.get('q', 0))
    b.set('ET', b.state.get('et', 0))
`,
		plc: { fb: true, progress },
	}),
	defineBlock({
		id: 'plc.tp',
		category: 'Timers',
		title: 'TP',
		description: 'Pulse: a rising edge on IN gives a pulse on Q exactly PT long; it cannot be retriggered',
		example: 'For example: Bell pulse',
		inputs: [BOOL('IN'), TIME('PT', { default: 1000 })],
		outputs: [out(BOOL('Q')), out(TIME('ET'))],
		display: 'Q',
		python: `
def update(b):
    pt = max(0, int(b.get('PT')))
    t = b.now()
    i = 1 if b.get('IN') >= 0.5 else 0
    s = b.state.get('start')
    if s is not None and t < s:
        s = None
    q = 0
    et = 0
    if s is None and not b.state.get('done') and i and not b.state.get('M', 0):
        s = t
    if s is not None:
        et = min(pt, t - s)
        if et >= pt:
            s = None
            b.state['done'] = 1
        else:
            q = 1
    if b.state.get('done'):
        et = pt
        if not i:
            b.state['done'] = 0
            et = 0
    b.state['start'] = s
    b.state['M'] = i
    b.set('Q', q)
    b.set('ET', et)
`,
		plc: { fb: true, progress },
	}),
]
