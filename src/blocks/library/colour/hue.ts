import { defineBlock } from '../../define'

/** Turn any 0–100 % signal — a knob, a light sensor — into a colour of the rainbow. */
export default defineBlock({
	id: 'colour.hue',
	category: 'Colour',
	title: 'Rainbow',
	description: 'Turns a 0–100 % signal into a colour of the rainbow',
	inputs: [{ id: 'hue', type: 'analog', default: 0 }],
	outputs: [{ id: 'out', type: 'colour' }],
	display: 'out',
	python: `
def update(b):
    h = (b.get('hue') % 1) * 6
    i = int(h)
    f = h - i
    q = int(255 * (1 - f))
    t = int(255 * f)
    r, g, bl = [(255, t, 0), (q, 255, 0), (0, 255, t), (0, q, 255), (t, 0, 255), (255, 0, q)][i % 6]
    b.set('out', b.colour(r, g, bl))
`,
})
