import { defineBlock } from '../../define'

export default defineBlock({
	id: 'variables.number',
	category: 'Variables',
	title: 'Number',
	description: 'A fixed number you type in, to feed other blocks',
	example: 'e.g. Snooze minutes',
	inputs: [{ id: 'value', type: 'number', default: 10 }],
	outputs: [{ id: 'out', type: 'number' }],
	display: 'out',
	python: `
def update(b):
    b.set('out', b.get('value'))
`,
})
