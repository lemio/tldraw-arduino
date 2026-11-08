import { defineBlock } from '../../define'

/**
 * An example of a block that draws itself: a dial at full size, a bar when
 * smaller, a number when smallest. `render` takes over the body at each size;
 * the ports, the name and the frame stay the standard ones.
 */
export default defineBlock({
	id: 'display.gauge',
	category: 'Display',
	title: 'Gauge',
	description: 'Shows a 0–100 % signal as a dial, a bar or a number, depending on its size',
	example: 'e.g. Tank level',
	inputs: [{ id: 'level', type: 'analog' }],
	outputs: [{ id: 'out', type: 'analog' }],
	display: 'out',
	fullHeight: 128,
	python: `
def update(b):
    b.set('out', max(0, min(1, b.get('level'))))
`,
	render: {
		full: ({ out }) => <Dial value={out.out ?? 0} />,
		name: ({ out }) => <Bar value={out.out ?? 0} />,
		value: ({ out }) => <span className="io-value">{Math.round((out.out ?? 0) * 100)}<small>%</small></span>,
	},
})

/** Half a circle, inked up to the value; the number underneath. */
function Dial({ value }: { value: number }) {
	const v = Math.max(0, Math.min(1, value))
	const r = 34
	const arc = (t: number) => {
		const a = Math.PI * (1 - t)
		return `${40 + r * Math.cos(a)},${44 - r * Math.sin(a)}`
	}
	return (
		<svg width="100%" height={60} viewBox="0 0 80 56" aria-label={`${Math.round(v * 100)} %`}>
			<path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(1)}`} fill="none" stroke="var(--line)" strokeWidth={6} />
			{v > 0 && <path d={`M${arc(0)} A${r},${r} 0 0 1 ${arc(v)}`} fill="none" stroke="var(--ink-2)" strokeWidth={6} />}
			<circle cx={arc(v).split(',')[0]} cy={arc(v).split(',')[1]} r={3} fill="var(--accent)" />
			<text x={40} y={50} textAnchor="middle" fontSize={14} fill="var(--ink)" fontFamily="var(--font)">
				{Math.round(v * 100)} %
			</text>
		</svg>
	)
}

function Bar({ value }: { value: number }) {
	const v = Math.max(0, Math.min(1, value))
	return (
		<div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
			<div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
				<div style={{ width: `${v * 100}%`, height: '100%', background: 'var(--ink-2)' }} />
			</div>
			<span className="io-value" style={{ fontSize: 18 }}>
				{Math.round(v * 100)}
				<small>%</small>
			</span>
		</div>
	)
}
