import { defineBlock, RenderContext } from '../../define'

/*
 * One Logic block for every two-input operator. Its behaviour is its truth
 * table, kept as four bits: bit (2a + b) is the output for that case. The
 * named operators are just tables; clicking an output cell makes any other.
 *
 * The table lies on its side, so its rows line up with the ports: a and b
 * come in on the left, the output row leaves on the right. Each column is one
 * case, and a brush marks the case the inputs are in now.
 */

/** Bit (2a + b) of the table is the output for that case. */
export const OPERATORS: [string, number][] = [
	['AND', 0b1000],
	['OR', 0b1110],
	['XOR', 0b0110],
	['NAND', 0b0111],
	['NOR', 0b0001],
	['XNOR', 0b1001],
]

const OR = 0b1110
const CASES = [0, 1, 2, 3] // 2a + b
const HL = (v: number) => (v ? 'H' : 'L')

/**
 * Rows by the block's height: under a header at full size (on the 32 px grid,
 * like other blocks), filling the block when smaller, and none at all below
 * 48 px, where it shows just the operator and the output.
 */
function rowsFor(h: number) {
	if (h >= 128) return { head: true, top: 32, row: 32 }
	if (h >= 48) return { head: false, top: 0, row: h / 3 }
	return null
}

function Operator({ table, set }: { table: number; set(t: number): void }) {
	const known = OPERATORS.some(([, t]) => t === table)
	return (
		<span className="gate-op" title="What it does: pick an operator, or click the outputs to make your own">
			<select
				value={known ? table : 'custom'}
				style={{ pointerEvents: 'all' }}
				onPointerDown={(e) => e.stopPropagation()}
				onChange={(e) => set(Number(e.target.value))}
			>
				{OPERATORS.map(([name, t]) => (
					<option key={name} value={t}>
						{name}
					</option>
				))}
				{!known && (
					<option value="custom" disabled>
						custom
					</option>
				)}
			</select>
		</span>
	)
}

function Gate({ h, tier, inputs, out, params, setParam }: RenderContext) {
	const table = params.table ?? OR
	const set = (t: number) => setParam('table', t)
	const now = (inputs.a >= 0.5 ? 2 : 0) + (inputs.b >= 0.5 ? 1 : 0)
	const rows = rowsFor(h)

	if (!rows || tier === 'value') {
		const high = out.out >= 0.5
		return (
			<div className="gate is-compact" style={{ top: rows?.top ?? 0 }}>
				<Operator table={table} set={set} />
				<span className={`io-value is-digital${high ? ' is-high' : ''}`}>{high ? 'HIGH' : 'LOW'}</span>
			</div>
		)
	}

	const cell = (c: number, row: string) => `gate-cell gate-${row}${c === now ? ' is-now' : ''}`
	return (
		<div className="gate" style={{ top: rows.top, gridTemplateRows: `repeat(3, ${rows.row}px)` }}>
			<span className="gate-label">a</span>
			{CASES.map((c) => (
				<span key={c} className={cell(c, 'a')}>
					<span className={c >> 1 ? 'is-high' : ''}>{HL(c >> 1)}</span>
				</span>
			))}
			<span />

			<span className="gate-label">b</span>
			{CASES.map((c) => (
				<span key={c} className={cell(c, 'b')}>
					<span className={c & 1 ? 'is-high' : ''}>{HL(c & 1)}</span>
				</span>
			))}
			<span />

			<Operator table={table} set={set} />
			{CASES.map((c) => {
				const o = (table >> c) & 1
				return (
					<span key={c} className={cell(c, 'out')}>
						<button
							className={o ? 'is-high' : ''}
							style={{ pointerEvents: 'all' }}
							title={`When a is ${HL(c >> 1)} and b is ${HL(c & 1)}, out is ${HL(o)}. Click to flip.`}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => set(table ^ (1 << c))}
						>
							{HL(o)}
						</button>
					</span>
				)
			})}
			<span className="gate-arrow" aria-hidden>
				→
			</span>
		</div>
	)
}

export default defineBlock({
	id: 'logic.gate',
	category: 'Logic',
	title: 'Logic',
	description: 'Combines two HIGH/LOW signals: AND, OR, XOR… shown as its truth table',
	inputs: [
		{ id: 'a', type: 'digital' },
		{ id: 'b', type: 'digital' },
	],
	outputs: [{ id: 'out', type: 'digital' }],
	display: 'out',
	settings: [{ id: 'table', default: OR }],
	width: 160,
	fullHeight: 128,
	layout: {
		head: (h) => rowsFor(h)?.head ?? false,
		ports: (h) => {
			const r = rowsFor(h)
			if (!r) return { a: h / 3, b: (2 * h) / 3, out: h / 2 }
			return { a: r.top + r.row / 2, b: r.top + 1.5 * r.row, out: r.top + 2.5 * r.row }
		},
	},
	python: `
def update(b):
    row = (2 if b.get('a') >= 0.5 else 0) + (1 if b.get('b') >= 0.5 else 0)
    b.set('out', (int(b.get('table')) >> row) & 1)
`,
	render: { full: Gate, name: Gate, value: Gate },
})
