import { defineBlock } from '../../define'

/**
 * The alarm clock: a trigger starts the countdown, the duration comes from
 * another block (or is typed on this one), and `done` goes HIGH when the time
 * is up — until it is reset or triggered again.
 */
export default defineBlock({
	id: 'time.wait',
	category: 'Time',
	title: 'Wait',
	description: 'Goes HIGH a set time after it is triggered, like an alarm clock',
	example: 'e.g. Wake-up alarm',
	inputs: [
		{ id: 'start', type: 'digital' },
		{ id: 'seconds', type: 'number', default: 5, unit: 's' },
		{ id: 'reset', type: 'digital' },
	],
	outputs: [
		{ id: 'left', type: 'number', unit: 's' },
		{ id: 'done', type: 'digital' },
	],
	display: 'left',
	controls: [
		{ input: 'start', label: 'Start' },
		{ input: 'reset', label: 'Reset' },
	],
	python: `
def update(b):
    if b.rose('reset'):
        b.state['due'] = None
        b.state['done'] = 0
    if b.rose('start'):
        b.state['due'] = b.now() + int(b.get('seconds') * 1000)
        b.state['done'] = 0
    due = b.state.get('due')
    if due is not None and b.now() >= due:
        b.state['due'] = None
        b.state['done'] = 1
        due = None
    b.set('left', 0 if due is None else (due - b.now()) / 1000)
    b.set('done', b.state.get('done', 0))
`,
})
