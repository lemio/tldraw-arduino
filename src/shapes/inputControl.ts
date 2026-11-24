import { Editor } from 'tldraw'
import { writeInputs } from './signals'
import { InputDevice, IoShape, isContact } from './types'

/*
 * Working an input by hand, the way the real thing works: a push button is
 * held (and springs back when let go), a toggle switch stays where it is put.
 * Shared by the block itself and its card in the sticky input dock.
 */

/** The value at rest: an NC contact is closed, so TRUE, until pressed. */
export const restValue = (device: InputDevice) => (device === 'nc' ? 1 : 0)

/** Push buttons spring back; everything else is switched. */
export const isMomentary = (device: InputDevice) => device === 'no' || device === 'nc'

const set = (editor: Editor, block: IoShape, value: number) => writeInputs(editor, [{ id: block.id, value }])

/** Hold a push button down (true) or let it go (false). */
export function press(editor: Editor, block: IoShape, down: boolean) {
	const rest = restValue(block.props.device)
	set(editor, block, down ? 1 - rest : rest)
}

/** Flip a switch (or a plain signal). */
export function flip(editor: Editor, block: IoShape) {
	set(editor, block, block.props.value >= 0.5 ? 0 : 1)
}

/** A short press, for a click where holding isn't possible: long enough for a few scans. */
export function tap(editor: Editor, block: IoShape) {
	press(editor, block, true)
	setTimeout(() => {
		const now = editor.getShape(block.id) as IoShape | undefined
		if (now) press(editor, now, false)
	}, 250)
}

/** Pointer handlers that hold a push button while the pointer is down, or flip anything else on press. */
export function pressHandlers(editor: Editor, block: IoShape) {
	if (!isMomentary(block.props.device)) {
		return {
			onPointerDown: (e: React.PointerEvent) => {
				e.stopPropagation()
				flip(editor, block)
			},
		}
	}
	const release = (e: React.PointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
		e.currentTarget.releasePointerCapture(e.pointerId)
		press(editor, editor.getShape(block.id) as IoShape, false)
	}
	return {
		onPointerDown: (e: React.PointerEvent) => {
			e.stopPropagation()
			e.currentTarget.setPointerCapture(e.pointerId)
			press(editor, block, true)
		},
		onPointerUp: release,
		onPointerCancel: release,
	}
}

/** Reading a contact from its pin: closed pulls the pin LOW (pull-up). */
export const contactValue = (device: InputDevice, pinHigh: boolean) => (isContact(device) ? (pinHigh ? 0 : 1) : pinHigh ? 1 : 0)
