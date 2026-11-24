import { Computed, Editor, TLShapeId, computed } from 'tldraw'
import { getIncomingWire, getWireEnds } from '../shapes/signals'
import { LOGIC_TYPE, LogicShape } from '../shapes/types'
import { getDef } from './registry'

/*
 * The order blocks run in, once per scan. Like the networks of a PLC's
 * Function Block Diagram: top to bottom, then left to right, except that a
 * block always runs after the blocks feeding it, so one scan carries a change
 * all the way through. A feedback loop reads its value from the scan before.
 * The runner, main.py, the Structured Text and the order numbers on the
 * blocks all use this one order.
 */
export function executionOrder(editor: Editor, blocks: LogicShape[]): LogicShape[] {
	const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1))
	const byId = new Map(sorted.map((b) => [b.id, b]))
	const done = new Set<TLShapeId>()
	const out: LogicShape[] = []
	const visit = (b: LogicShape, path: Set<TLShapeId>) => {
		if (done.has(b.id) || path.has(b.id)) return // a loop runs one scan behind
		path.add(b.id)
		for (const p of getDef(b).inputs) {
			const wire = getIncomingWire(editor, b.id, p.id)
			const from = wire && getWireEnds(editor, wire).from
			const up = from && byId.get(from.id)
			if (up) visit(up, path)
		}
		done.add(b.id)
		out.push(b)
	}
	for (const b of sorted) visit(b, new Set())
	return out
}

const cache = new WeakMap<Editor, Computed<Map<TLShapeId, number>>>()

/** A block's place in the scan, from 1. */
export function executionIndex(editor: Editor, id: TLShapeId): number {
	let c = cache.get(editor)
	if (!c) {
		c = computed('execution order', () => {
			const blocks = editor.getCurrentPageShapes().filter((s): s is LogicShape => s.type === LOGIC_TYPE)
			return new Map(executionOrder(editor, blocks).map((b, i) => [b.id, i + 1]))
		})
		cache.set(editor, c)
	}
	return c.get().get(id) ?? 0
}
