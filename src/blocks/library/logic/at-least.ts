import { defineBlock } from '../../define'

export default defineBlock({
	id: 'logic.at-least',
	category: 'Logic',
	title: 'At least',
	description: 'HIGH while a number is at least a limit, e.g. three visitors',
	inputs: [
		{ id: 'value', type: 'number' },
		{ id: 'limit', type: 'number', default: 3 },
	],
	outputs: [{ id: 'out', type: 'digital' }],
	display: 'out',
	python: `
def update(b):
    b.set('out', 1 if b.get('value') >= b.get('limit') else 0)
`,
})
