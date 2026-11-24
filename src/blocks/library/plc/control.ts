import { defineBlock } from '../../define'
import { BOOL, REAL, out } from '../../../plc/ports'

/*
 * A PID controller with the inputs of the CODESYS Util PID: Y = KP·(e + 1/TN·∫e
 * dt + TV·de/dt), e = SET_POINT − ACTUAL, TN and TV in seconds (0 switches
 * that part off). Y stays within Y_MIN..Y_MAX, and the integral stops growing
 * while it is held there (anti-windup).
 */
export default defineBlock({
	id: 'plc.pid',
	category: 'Control',
	title: 'PID',
	description: 'Closed-loop control: drives Y so that ACTUAL follows SET_POINT',
	example: 'For example: Temperature control',
	inputs: [
		REAL('ACTUAL'),
		REAL('SET_POINT', { default: 0.5 }),
		REAL('KP', { default: 1 }),
		REAL('TN', { default: 1, unit: 's' }),
		REAL('TV', { unit: 's' }),
		REAL('Y_MIN'),
		REAL('Y_MAX', { default: 1 }),
		BOOL('RESET'),
	],
	outputs: [out(REAL('Y'))],
	display: 'Y',
	python: `
def update(b):
    t = b.now()
    last = b.state.get('t')
    dt = 0 if last is None or t < last else (t - last) / 1000
    b.state['t'] = t
    lo = b.get('Y_MIN')
    hi = b.get('Y_MAX')
    if b.get('RESET') >= 0.5:
        b.state['i'] = 0
        b.state['e'] = None
        b.set('Y', max(lo, min(hi, 0)))
        return
    e = b.get('SET_POINT') - b.get('ACTUAL')
    kp = b.get('KP')
    tn = b.get('TN')
    tv = b.get('TV')
    i = b.state.get('i', 0)
    step = e * dt / tn if tn > 0 and dt > 0 else 0
    i += step
    pe = b.state.get('e')
    d = tv * (e - pe) / dt if tv > 0 and dt > 0 and pe is not None else 0
    y = kp * (e + i + d)
    if y > hi or y < lo:
        i -= step
        y = max(lo, min(hi, y))
    b.state['i'] = i
    b.state['e'] = e
    b.set('Y', y)
`,
	plc: { fb: true },
})
