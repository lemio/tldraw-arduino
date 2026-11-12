import { Editor, TLShapeId, atom, react } from 'tldraw'
import { pinPickerFor } from '../ui/PinPicker'
import { IO_TYPE, IoShape } from '../shapes/types'

/** A question the assistant asks with the pin picker. Local to this browser. */
export const pinQuestion = atom<{ id: TLShapeId; question: string } | null>('pinQuestion', null)

/**
 * Open the pin picker on a block, with the assistant's question above the
 * board, and wait until it closes: the chosen GPIO, or -1 if none was picked.
 */
export function askForPin(editor: Editor, id: TLShapeId, question: string): Promise<number> {
	const block = editor.getShape(id) as IoShape | undefined
	if (!block || block.type !== IO_TYPE) return Promise.resolve(-1)

	// The picker hangs from the block's pin chip, so bring the block into view first.
	const bounds = editor.getShapePageBounds(id)
	if (bounds) editor.zoomToBounds(bounds.clone().expandBy(320), { animation: { duration: 200 }, targetZoom: 1 })

	return new Promise((resolve) => {
		let opened = false
		let stop = () => {}
		const start = window.setTimeout(() => {
			pinQuestion.set({ id, question })
			pinPickerFor.set(id)
			opened = true
		}, 260)
		stop = react('pin answer', () => {
			const open = pinPickerFor.get()
			if (!opened || open === id) return
			window.clearTimeout(start)
			stop()
			pinQuestion.set(null)
			resolve((editor.getShape(id) as IoShape | undefined)?.props.pin ?? -1)
		})
	})
}
