import { defineBlock } from '../../define'

export default defineBlock({
	id: 'logic.or',
	category: 'Logic',
	hidden: true, // superseded by the Logic block (logic.gate)
	title: 'Either',
	description: 'HIGH while one input or both are HIGH',
	inputs: [
		{ id: 'a', type: 'digital' },
		{ id: 'b', type: 'digital' },
	],
	outputs: [{ id: 'out', type: 'digital' }],
	display: 'out',
	python: `
def update(b):
    b.set('out', 1 if b.get('a') >= 0.5 or b.get('b') >= 0.5 else 0)
`,
})
