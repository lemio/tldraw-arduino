import { defineBlock } from '../../define'

export default defineBlock({
	id: 'time.blink',
	category: 'Time',
	title: 'Blink',
	description: 'Switches HIGH and LOW on its own, every so many seconds',
	example: 'e.g. Warning flasher',
	inputs: [
		{ id: 'on', type: 'digital', default: 1 },
		{ id: 'seconds', type: 'number', default: 0.5, unit: 's' },
	],
	outputs: [{ id: 'out', type: 'digital' }],
	display: 'out',
	python: `
def update(b):
    if b.get('on') < 0.5:
        b.set('out', 0)
        return
    half = max(20, int(b.get('seconds') * 1000))
    b.set('out', (b.now() // half) % 2)
`,
})
