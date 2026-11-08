import { defineBlock } from '../../define'

export default defineBlock({
	id: 'logic.and',
	category: 'Logic',
	hidden: true, // superseded by the Logic block (logic.gate)
	title: 'Both',
	description: 'HIGH only while both inputs are HIGH',
	inputs: [
		{ id: 'a', type: 'digital' },
		{ id: 'b', type: 'digital' },
	],
	outputs: [{ id: 'out', type: 'digital' }],
	display: 'out',
	python: `
def update(b):
    b.set('out', 1 if b.get('a') >= 0.5 and b.get('b') >= 0.5 else 0)
`,
})
