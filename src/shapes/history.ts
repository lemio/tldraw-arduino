import { Editor, TLShapeId, atom } from 'tldraw'
import { effectiveValue } from './signals'
import { getDef } from '../blocks/registry'
import { IO_TYPE, LOGIC_TYPE, LogicShape } from './types'

/*
 * Sparkline history is local to each browser: every client samples the shared
 * values on its own clock, so the store never has to carry time series.
 */

export const SAMPLE_HZ = 20
export const WINDOW_S = 10
const MAX = SAMPLE_HZ * WINDOW_S

/** Keyed by block id, or `id|port` for a logic block's outputs. */
const series = new Map<string, number[]>()

/** Bumped once per sample; sparklines subscribe to it to redraw. */
export const sampleTick = atom('sampleTick', 0)

export const getSeries = (id: TLShapeId, port?: string) => series.get(port === undefined ? id : `${id}|${port}`) ?? []

function push(key: string, v: number, seen: Set<string>) {
	seen.add(key)
	let s = series.get(key)
	if (!s) series.set(key, (s = []))
	s.push(v)
	if (s.length > MAX) s.splice(0, s.length - MAX)
}

export function startSampler(editor: Editor) {
	const timer = setInterval(() => {
		const seen = new Set<string>()
		for (const shape of editor.getCurrentPageShapes()) {
			if (shape.type === IO_TYPE) push(shape.id, effectiveValue(editor, shape.id, true), seen)
			else if (shape.type === LOGIC_TYPE) {
				const block = shape as LogicShape
				for (const p of getDef(block).outputs) push(`${block.id}|${p.id}`, block.props.out[p.id] ?? 0, seen)
			}
		}
		for (const id of series.keys()) if (!seen.has(id)) series.delete(id)
		sampleTick.update((n) => n + 1)
	}, 1000 / SAMPLE_HZ)
	return () => clearInterval(timer)
}
