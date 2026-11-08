import wasmUrl from '@micropython/micropython-webassembly-pyscript/micropython.wasm?url'
import { Editor, TLShapeId, TLShapePartial, atom } from 'tldraw'
import { deviceStatus } from '../device/host'
import { Fresh, freshKey, getIncomingWire, getWireEnds, inputValue, writeSignals } from '../shapes/signals'
import { IO_TYPE, IoShape, LOGIC_TYPE, LogicShape } from '../shapes/types'
import { getDef } from './registry'
import { PY_RUNTIME } from './runtime'

/*
 * Runs every logic block's MicroPython while you work: MicroPython itself,
 * compiled to WebAssembly, running the very code main.py will run on the
 * board.
 *
 * In a shared room exactly one browser runs the blocks and writes their
 * outputs into the store, so everyone sees the same numbers: the browser a
 * board is plugged into, or else the present person with the lowest user id.
 */

export const TICK_HZ = 20

/** Whether this browser is the one running the blocks (for the status line). */
export const isRunning = atom('isRunning', false)

const HOST = `
import json
INST = {}

def make(bid, code, state):
    ns = {}
    exec(code, ns)
    b = Block(ns['update'], ns.get('setup'))
    b.state = json.loads(state)
    INST[bid] = b

def drop(bid):
    INST.pop(bid, None)

def tick(bid, inputs, presses):
    b = INST[bid]
    b.inputs = json.loads(inputs)
    b.presses = json.loads(presses)
    b.step()
    return json.dumps({'out': b.out, 'state': b.state})
`

type Py = { make(id: string, code: string, state: string): void; drop(id: string): void; tick(id: string, inputs: string, presses: string): string }
let py: Promise<Py> | null = null

function loadPython(log: (s: string) => void) {
	if (!py) {
		py = import('@micropython/micropython-webassembly-pyscript').then(async ({ loadMicroPython }) => {
			const mp = await loadMicroPython({ url: wasmUrl, stdout: log, stderr: log })
			mp.runPython(PY_RUNTIME + HOST)
			return {
				make: mp.globals.get('make'),
				drop: mp.globals.get('drop'),
				tick: mp.globals.get('tick'),
			} as Py
		})
	}
	return py
}

function elected(editor: Editor) {
	if (deviceStatus.get().state === 'live') return true
	// Someone else's board is streaming: their browser runs the blocks.
	const shapes = editor.getCurrentPageShapes()
	if (shapes.some((s) => s.type === IO_TYPE && (s as IoShape).props.live)) return false
	const plain = (id: string) => id.replace(/^user:/, '')
	const me = plain(editor.user.getId())
	return editor.getCollaborators().every((c) => plain(c.userId) >= me)
}

/** Blocks feeding other blocks run first, so one tick carries a change all the way through. */
function order(editor: Editor, blocks: LogicShape[]) {
	const byId = new Map(blocks.map((b) => [b.id, b]))
	const done = new Set<TLShapeId>()
	const out: LogicShape[] = []
	const visit = (b: LogicShape, path: Set<TLShapeId>) => {
		if (done.has(b.id) || path.has(b.id)) return // a loop runs one tick behind
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
	for (const b of blocks) visit(b, new Set())
	return out
}

export function startRunner(editor: Editor, log: (line: string) => void = console.log) {
	/** Which code each live instance was made from, so edits rebuild it. */
	const made = new Map<TLShapeId, string>()
	let busy = false

	const tick = async () => {
		if (busy) return
		const blocks = editor.getCurrentPageShapes().filter((s): s is LogicShape => s.type === LOGIC_TYPE)
		const running = blocks.length > 0 && elected(editor)
		if (isRunning.get() !== running) isRunning.set(running)
		if (!running) {
			made.clear()
			return
		}
		busy = true
		try {
			const python = await loadPython((s) => log(s))
			const ids = new Set(blocks.map((b) => b.id))
			for (const id of [...made.keys()]) {
				if (!ids.has(id)) {
					python.drop(id)
					made.delete(id)
				}
			}

			const fresh: Fresh = new Map()
			const signals: { id: TLShapeId; port: string; value: number }[] = []
			const extra: TLShapePartial[] = []

			for (const block of order(editor, blocks)) {
				const live = editor.getShape(block.id) as LogicShape | undefined
				if (!live) continue
				const def = getDef(live)
				let error = ''
				try {
					if (made.get(live.id) !== def.python) {
						python.make(live.id, def.python, JSON.stringify(live.props.state ?? {}))
						made.set(live.id, def.python)
					}
					const inputs: Record<string, number> = {}
					for (const p of def.inputs) inputs[p.id] = inputValue(editor, live, p.id, true, fresh)
					for (const x of def.settings ?? []) inputs[x.id] = live.props.params[x.id] ?? x.default
					const result = JSON.parse(python.tick(live.id, JSON.stringify(inputs), JSON.stringify(live.props.presses)))
					for (const p of def.outputs) {
						const v = Number(result.out[p.id] ?? live.props.out[p.id] ?? 0)
						const value = Number.isFinite(v) ? v : 0
						fresh.set(freshKey(live.id, p.id), value)
						if (live.props.out[p.id] !== value) signals.push({ id: live.id, port: p.id, value })
					}
					if (JSON.stringify(result.state) !== JSON.stringify(live.props.state)) {
						extra.push({ id: live.id, type: LOGIC_TYPE, props: { state: result.state } })
					}
				} catch (e) {
					error = pythonError(e)
					made.delete(live.id) // rebuild after the next edit, or try again
				}
				if (error !== live.props.error) extra.push({ id: live.id, type: LOGIC_TYPE, props: { error } })
			}
			if (signals.length || extra.length) writeSignals(editor, signals, extra)
		} finally {
			busy = false
		}
	}

	const timer = setInterval(() => void tick(), 1000 / TICK_HZ)
	return () => {
		clearInterval(timer)
		isRunning.set(false)
	}
}

/** The last line of a Python traceback is the one people need. */
function pythonError(e: unknown) {
	const text = e instanceof Error ? e.message : String(e)
	const lines = text.trim().split('\n')
	const where = lines.filter((l) => /line \d+/.test(l)).pop()?.match(/line (\d+)/)?.[1]
	return `${lines[lines.length - 1]}${where ? ` (line ${where})` : ''}`
}
