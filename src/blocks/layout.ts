import type { BlockDef, Tier } from './define'

/*
 * Where things go on a logic block. In the full size, ports sit on grid lines
 * one row (32 px) apart under the header, so wires between aligned blocks
 * stay straight; smaller sizes spread them over whatever height there is.
 */

export const HEAD = 32
export const ROW = 32
export const CONTROLS = 32
export const LOGIC_W = 256

const roundUp = (v: number, step: number) => Math.ceil(v / step) * step

export function rows(def: BlockDef) {
	return Math.max(1, def.inputs.length, def.outputs.length)
}

/** The smallest height that still fits the full layout. */
export function fullHeight(def: BlockDef) {
	return roundUp(Math.max(def.fullHeight ?? 0, HEAD + rows(def) * ROW + (def.controls?.length ? CONTROLS : 0)), 32)
}

export function logicTier(def: BlockDef, h: number): Tier {
	return h >= fullHeight(def) ? 'full' : h >= 64 ? 'name' : 'value'
}

export function portYs(n: number, h: number, tier: Tier) {
	if (tier === 'full') return Array.from({ length: n }, (_, i) => HEAD + ROW / 2 + i * ROW)
	return Array.from({ length: n }, (_, i) => Math.round((h * (i + 1)) / (n + 1) / 8) * 8)
}

/** Default size for a new block of this kind: the full layout, on the grid. */
export function logicSize(def: BlockDef) {
	return { w: def.width ?? LOGIC_W, h: fullHeight(def) }
}

const RANK: Record<Tier, number> = { value: 0, name: 1, full: 2 }

/** The simpler of two levels of detail. */
export const simpler = (a: Tier, b: Tier) => (RANK[a] <= RANK[b] ? a : b)
