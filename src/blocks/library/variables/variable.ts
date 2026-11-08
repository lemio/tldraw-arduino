import { defineBlock } from '../../define'

/** A number that remembers: count presses, people, laps… Kept across reloads. */
export default defineBlock({
	id: 'variables.variable',
	category: 'Variables',
	title: 'Variable',
	description: 'A number you can count up and down, and use anywhere',
	example: 'e.g. Visitors today',
	inputs: [
		{ id: 'add', type: 'digital', label: '+1' },
		{ id: 'subtract', type: 'digital', label: '−1' },
		{ id: 'reset', type: 'digital' },
		{ id: 'step', type: 'number', default: 1 },
	],
	outputs: [{ id: 'value', type: 'number' }],
	display: 'value',
	controls: [
		{ input: 'subtract', label: '−' },
		{ input: 'add', label: '+' },
		{ input: 'reset', label: 'Reset' },
	],
	python: `
def update(b):
    v = b.state.get('value', 0)
    if b.rose('add'):
        v += b.get('step')
    if b.rose('subtract'):
        v -= b.get('step')
    if b.rose('reset'):
        v = 0
    b.state['value'] = v
    b.set('value', v)
`,
})
