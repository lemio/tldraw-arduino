import { useRef } from 'react'
import { fmtColour, mixColour, shapeCurve } from '../shapes/signals'
import { Curve, WireShapeProps } from '../shapes/types'

/*
 * A map's curve, drawn like the gamma chart in Schematik's learn.html: dark
 * plot, faint grid, mono ticks, the curve in light ink, and the live value as
 * a dot with dashed guides to both axes. The two ends of the map can be
 * dragged; a fade into colour is drawn in the colours it passes through.
 */

const W = 264
const H = 168
const X0 = 30
const X1 = W - 8
const Y0 = H - 24
const Y1 = 10
const px = (u: number) => X0 + u * (X1 - X0)
const py = (u: number) => Y0 - u * (Y0 - Y1)
const TICKS = [0, 0.25, 0.5, 0.75, 1]

export const CURVES: [Curve, string, string][] = [
	['linear', 'Linear', 'Straight: equal steps in, equal steps out'],
	['gamma', 'Gamma', 'out = inᵞ — 2.2 makes an LED fade look even to the eye'],
	['in', 'In', 'Ease in: starts slowly, ends fast'],
	['out', 'Out', 'Ease out: starts fast, ends slowly'],
	['inout', 'In-out', 'Ease in and out: slow at both ends, fast in the middle'],
]

export function CurvePlot({
	p,
	level,
	colour,
	set,
	editable = true,
}: {
	p: WireShapeProps
	/** The live input, on the plot's 0..1 scale. */
	level: number
	/** A fade into colour: draw the curve in its colours. */
	colour?: boolean
	set(props: Partial<WireShapeProps>, mark?: boolean): void
	/** Drag the ends (only on a 0..1 scale). */
	editable?: boolean
}) {
	const ref = useRef<SVGSVGElement>(null)
	const lo = colour ? 0 : p.lo
	const hi = colour ? 1 : p.hi
	const out = (u: number) => {
		const span = p.inHi - p.inLo || 1e-6
		return lo + shapeCurve(p.curve, p.gamma, (u - p.inLo) / span) * (hi - lo)
	}

	const N = 96
	const pts = Array.from({ length: N + 1 }, (_, i) => [i / N, out(i / N)] as const)
	const v = Math.min(1, Math.max(0, level))
	const vo = out(v)

	const grab = (end: 'lo' | 'hi') => (e: React.PointerEvent) => {
		e.stopPropagation()
		e.currentTarget.setPointerCapture(e.pointerId)
		set({}, true)
		const move = (ev: PointerEvent) => {
			const r = ref.current!.getBoundingClientRect()
			const sx = W / r.width
			const ux = Math.round(Math.min(1, Math.max(0, ((ev.clientX - r.left) * sx - X0) / (X1 - X0))) * 100) / 100
			const uy = Math.round(Math.min(1, Math.max(0, (Y0 - (ev.clientY - r.top) * sx) / (Y0 - Y1))) * 100) / 100
			if (end === 'lo') set(colour ? { inLo: Math.min(ux, p.inHi - 0.01) } : { inLo: Math.min(ux, p.inHi - 0.01), lo: uy }, false)
			else set(colour ? { inHi: Math.max(ux, p.inLo + 0.01) } : { inHi: Math.max(ux, p.inLo + 0.01), hi: uy }, false)
		}
		const up = () => {
			window.removeEventListener('pointermove', move)
			window.removeEventListener('pointerup', up)
		}
		window.addEventListener('pointermove', move)
		window.addEventListener('pointerup', up)
	}

	return (
		<svg ref={ref} className="curveplot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The map: input across, output up">
			<rect className="bg" x={0} y={0} width={W} height={H} />
			{TICKS.map((t) => (
				<g key={t}>
					<line className="grid" x1={px(t)} x2={px(t)} y1={Y0} y2={Y1} />
					<line className="grid" x1={X0} x2={X1} y1={py(t)} y2={py(t)} />
					<text x={px(t)} y={Y0 + 11} textAnchor="middle">
						{Math.round(t * 100)}
					</text>
					<text x={X0 - 4} y={py(t) + 3} textAnchor="end">
						{Math.round(t * 100)}
					</text>
				</g>
			))}
			<text x={X1} y={H - 2} textAnchor="end">
				in →
			</text>
			<text transform={`translate(8 ${Y0}) rotate(-90)`}>{colour ? 'fade →' : 'out →'}</text>
			{colour ? (
				pts.slice(1).map(([u, o], i) => (
					<line
						key={u}
						x1={px(pts[i][0])}
						y1={py(pts[i][1])}
						x2={px(u)}
						y2={py(o)}
						stroke={fmtColour(mixColour(p.loColour, p.hiColour, o))}
						strokeWidth={3}
					/>
				))
			) : (
				<path className="curve" d={pts.map(([u, o], i) => `${i ? 'L' : 'M'}${px(u).toFixed(1)},${py(o).toFixed(1)}`).join('')} />
			)}
			<path className="guide" d={`M${px(v)},${Y0} V${py(vo)} H${X0}`} />
			<circle className="now" cx={px(v)} cy={py(vo)} r={4} />
			{editable && (
				<>
					<circle className="end" cx={px(p.inLo)} cy={py(lo)} r={5} onPointerDown={grab('lo')}>
						<title>Drag: where the map starts</title>
					</circle>
					<circle className="end" cx={px(p.inHi)} cy={py(hi)} r={5} onPointerDown={grab('hi')}>
						<title>Drag: where the map ends</title>
					</circle>
				</>
			)}
		</svg>
	)
}

/** The curve as a tiny glyph, for a wire's badge. */
export function CurveGlyph({ curve, gamma }: { curve: Curve; gamma: number }) {
	const d = Array.from({ length: 13 }, (_, i) => {
		const u = i / 12
		return `${i ? 'L' : 'M'}${(1 + u * 12).toFixed(1)},${(11 - shapeCurve(curve, gamma, u) * 10).toFixed(1)}`
	}).join('')
	return (
		<svg className="cast-curve" width={14} height={12} aria-hidden>
			<path d={d} />
		</svg>
	)
}
