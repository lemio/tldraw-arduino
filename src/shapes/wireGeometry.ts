import { Vec } from 'tldraw'
import { cornerRadius } from '../style'
import { WireShape } from './types'

/*
 * Metro-map wiring: horizontal out of a port, horizontal into the next, and in
 * between only 45° diagonals and verticals, with square bends. Ports sit on
 * the block grid, so aligned blocks are joined by one straight line.
 */

export const STUB = 24

type RouteShape = { x: number; y: number; props: Pick<WireShape['props'], 'ex' | 'ey' | 'lane' | 'bend' | 'via'> }

/**
 * Corner points from the start port (0,0) to the end port (ex,ey), in the
 * wire's own coordinates. With bend points placed by hand, each stretch
 * between them is routed the same metro way, passing through every point.
 */
export function wireRoute(w: RouteShape): Vec[] {
	const { ex, ey, lane = 0, bend = -1, via = [] } = w.props
	if (!via.length) return laneRoute(ex, ey, lane, bend)
	const stops = [new Vec(0, 0), ...via.map((p) => new Vec(p.x - w.x, p.y - w.y)), new Vec(ex, ey)]
	const out = [stops[0]]
	for (let i = 0; i < stops.length - 1; i++) {
		const a = stops[i]
		const b = stops[i + 1]
		out.push(...baseRoute(b.x - a.x, b.y - a.y, -1).slice(1).map((p) => p.add(a)))
	}
	return out
}

/** Which stretch (between bend points) a route corner belongs to. */
export function legOfCorner(w: RouteShape, corner: Vec) {
	const via = w.props.via ?? []
	const stops = [new Vec(0, 0), ...via.map((p) => new Vec(p.x - w.x, p.y - w.y)), new Vec(w.props.ex, w.props.ey)]
	let best = 0
	let bestD = Infinity
	for (let i = 0; i < stops.length - 1; i++) {
		const leg = baseRoute(stops[i + 1].x - stops[i].x, stops[i + 1].y - stops[i].y, -1).map((p) => p.add(stops[i]))
		for (const p of leg) {
			const d = Vec.Dist(p, corner)
			if (d < bestD) {
				bestD = d
				best = i
			}
		}
	}
	return best
}

/**
 * A wire that shares its port first steps out at 45° onto its own `lane`, so
 * wires fanning out of one port never run on top of each other.
 */
function laneRoute(ex: number, ey: number, lane: number, bend: number): Vec[] {
	if (!lane) return baseRoute(ex, ey, bend)
	const s = new Vec(Math.abs(lane), lane)
	const rest = baseRoute(ex - s.x, ey - s.y, bend >= 0 ? bend - s.x : -1)
	return [new Vec(0, 0), ...rest.map((p) => p.add(s))]
}

/** The 45° run of a single-diagonal route starts here, unless told otherwise. */
export function defaultBend(ex: number, ey: number) {
	return (ex - Math.abs(ey)) / 2
}

/** Whether a single-diagonal route with its 45° run starting at `bend` fits. */
export function bendFits(ex: number, ey: number, bend: number) {
	return bend >= STUB / 2 && bend + Math.abs(ey) <= ex - STUB / 2
}

/**
 * Where a route's first 45° run starts when left to itself, and whether one
 * starting at `bend` instead would still fit. Null for routes that go round.
 */
export function bendRange(ex: number, ey: number) {
	if (ex >= Math.abs(ey) + 2 * STUB) return { natural: defaultBend(ex, ey), fits: (b: number) => bendFits(ex, ey, b) }
	if (ex >= 2 * STUB) return { natural: STUB, fits: (b: number) => b >= STUB / 2 && b <= ex - STUB }
	return null
}

function baseRoute(ex: number, ey: number, bend: number): Vec[] {
	const ady = Math.abs(ey)
	const sy = ey < 0 ? -1 : 1

	if (ady < 0.5 && ex > 0) return [new Vec(0, 0), new Vec(ex, ey)]

	// Room for one diagonal: across, down at 45°, across.
	if (ex >= ady + 2 * STUB) {
		const x1 = bend >= 0 && bendFits(ex, ey, bend) ? bend : defaultBend(ex, ey)
		return [new Vec(0, 0), new Vec(x1, 0), new Vec(x1 + ady, ey), new Vec(ex, ey)]
	}

	// Steeper than 45°: two diagonals with a vertical between them.
	if (ex >= 2 * STUB) {
		const b = bend >= STUB / 2 && bend <= ex - STUB ? bend : STUB
		const k = (ex - STUB - b) / 2
		return [
			new Vec(0, 0),
			new Vec(b, 0),
			new Vec(b + k, sy * k),
			new Vec(b + k, ey - sy * k),
			new Vec(ex - STUB, ey),
			new Vec(ex, ey),
		]
	}

	// The target is behind the source: go round, through the gap between the
	// blocks if there is one, else underneath both.
	const lane = ady > 112 ? ey / 2 : Math.max(0, ey) + 72
	return [
		new Vec(0, 0),
		new Vec(STUB, 0),
		new Vec(STUB, lane),
		new Vec(ex - STUB, lane),
		new Vec(ex - STUB, ey),
		new Vec(ex, ey),
	]
}

/** SVG path through the points, each bend rounded by `radius` (0: mitred corners). */
export function pathOf(points: Vec[], radius = cornerRadius()) {
	if (points.length < 2) return ''
	if (radius <= 0) return 'M' + points.map((p) => `${p.x},${p.y}`).join(' L')
	let d = `M${points[0].x},${points[0].y}`
	for (let i = 1; i < points.length - 1; i++) {
		const [a, p, b] = [points[i - 1], points[i], points[i + 1]]
		const r = Math.min(radius, Vec.Dist(a, p) / 2, Vec.Dist(p, b) / 2)
		const p1 = Vec.Sub(p, Vec.Sub(p, a).uni().mul(r))
		const p2 = Vec.Add(p, Vec.Sub(b, p).uni().mul(r))
		d += ` L${p1.x},${p1.y} Q${p.x},${p.y} ${p2.x},${p2.y}`
	}
	const last = points[points.length - 1]
	return d + ` L${last.x},${last.y}`
}

/** Split the route at half its length: the source side and the target side. */
export function halves(points: Vec[]): [Vec[], Vec[], Vec] {
	const lengths = points.slice(1).map((p, i) => Vec.Dist(points[i], p))
	let half = lengths.reduce((a, b) => a + b, 0) / 2
	for (let i = 0; i < lengths.length; i++) {
		if (half <= lengths[i] || i === lengths.length - 1) {
			const t = lengths[i] ? Math.min(1, half / lengths[i]) : 0
			const mid = Vec.Lrp(points[i], points[i + 1], t)
			return [[...points.slice(0, i + 1), mid], [mid, ...points.slice(i + 1)], mid]
		}
		half -= lengths[i]
	}
	return [points, points, points[0]]
}

/** The point a fraction `t` of the way along a route. */
export function pointAlong(points: Vec[], t: number) {
	const lengths = points.slice(1).map((p, i) => Vec.Dist(points[i], p))
	let d = lengths.reduce((a, b) => a + b, 0) * Math.min(1, Math.max(0, t))
	for (let i = 0; i < lengths.length; i++) {
		if (d <= lengths[i] || i === lengths.length - 1) return Vec.Lrp(points[i], points[i + 1], lengths[i] ? Math.min(1, d / lengths[i]) : 0)
		d -= lengths[i]
	}
	return points[0].clone()
}

/** Where a wire's badge sits, in page space. */
export function wireMidpoint(wire: WireShape) {
	return halves(wireRoute(wire))[2].clone().add({ x: wire.x, y: wire.y })
}
