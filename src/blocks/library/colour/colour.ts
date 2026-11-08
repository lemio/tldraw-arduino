import { defineBlock } from '../../define'

/** Pick a colour (or wire one in) and dim it; send it to an RGB LED. */
export default defineBlock({
	id: 'colour.colour',
	category: 'Colour',
	title: 'Colour',
	description: 'A colour you pick, dimmed by brightness, for an RGB LED',
	example: 'e.g. Bedtime glow',
	inputs: [
		{ id: 'colour', type: 'colour', default: 0xff6a00 },
		{ id: 'brightness', type: 'analog', default: 1 },
	],
	outputs: [{ id: 'out', type: 'colour' }],
	display: 'out',
	python: `
def update(b):
    r, g, bl = b.rgb(b.get('colour'))
    k = max(0, min(1, b.get('brightness')))
    b.set('out', b.colour(r * k, g * k, bl * k))
`,
})
