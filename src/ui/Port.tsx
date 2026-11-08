import { useEditor, useValue } from 'tldraw'
import { Block, PortInfo } from '../shapes/signals'
import { SignalType, WIRE_TYPE } from '../shapes/types'
import { beginWireDrag, isCompatibleTarget, wireDrag } from '../shapes/wiring'

const TYPE_NAME: Record<SignalType, string> = {
	digital: 'Digital (HIGH / LOW)',
	analog: 'Analog (0–100 %)',
	number: 'Number',
	colour: 'Colour',
}

/**
 * A connection point. Its glyph carries the type — square: digital, circle:
 * analog, diamond: number, rainbow ring: colour — so a cast is visible before
 * anything is connected.
 */
export function Port({ block, port, title }: { block: Block; port: PortInfo; title?: string }) {
	const editor = useEditor()
	const state = useValue(
		'port',
		() => {
			const drag = wireDrag.get()
			const connected = editor
				.getBindingsToShape(block.id, WIRE_TYPE)
				.some((b) => (b.props.port ?? '') === port.id && (b.props.terminal === 'start') === (port.side === 'out'))
			if (!drag) return { connected, target: false, snapped: false }
			return {
				connected,
				target: isCompatibleTarget(drag, port.side),
				snapped: drag.candidate?.id === block.id && drag.candidate.port === port.id,
			}
		},
		[editor, block.id, port.id, port.side]
	)

	const cls = [
		'port',
		`port-${port.side}`,
		`port-${port.type}`,
		state.connected && 'is-connected',
		state.target && 'is-target',
		state.snapped && 'is-snapped',
	]
		.filter(Boolean)
		.join(' ')

	return (
		<div
			className={cls}
			style={{ top: port.local.y, pointerEvents: 'all' }}
			title={
				title ??
				`${port.label ? port.label + ': ' : ''}${TYPE_NAME[port.type]} ${port.side === 'out' ? 'out — drag to an input' : 'in — drag a wire here'}`
			}
			onPointerDown={(e) => beginWireDrag(editor, block, port.id, e)}
		>
			<i />
		</div>
	)
}
