import { Editor, TLAnyBindingUtilConstructor, TLAnyShapeUtilConstructor, Tldraw, useValue } from 'tldraw'
import { getClip, playback } from '../shapes/playback'
import { historyMode, restoreVersion, versionShapes } from '../shapes/versions'

/*
 * History mode: the page as a recording was made, laid over the live canvas
 * in a separate, local, read-only editor. The recording plays through it, so
 * every block and wire shows what happened then, on the circuit of then.
 * Nothing in it can be changed, and nothing in it reaches the room.
 */

export function HistoryCanvas({
	editor,
	shapeUtils,
	bindingUtils,
}: {
	editor: Editor
	shapeUtils: TLAnyShapeUtilConstructor[]
	bindingUtils: TLAnyBindingUtilConstructor[]
}) {
	const mode = useValue(historyMode)
	if (!mode) return null
	const clip = getClip(editor, mode.clipId)
	if (!clip) return null
	const when = new Date(mode.circuit.at)
	const back = () => playback.set(null)

	return (
		<div className="history" key={mode.clipId}>
			<Tldraw
				hideUi
				shapeUtils={shapeUtils}
				bindingUtils={bindingUtils}
				onMount={(h) => {
					h.run(
						() => {
							h.createShapes([...versionShapes(mode.circuit, h.getCurrentPageId()), { ...clip, parentId: h.getCurrentPageId() }])
							h.createBindings(mode.circuit.bindings)
						},
						{ history: 'ignore' }
					)
					h.updateInstanceState({ isReadonly: true })
					h.setCamera(editor.getCamera())
					if (import.meta.env.DEV) Object.assign(window, { historyEditor: h })
					// Leave history where it was looked at.
					return () => {
						editor.setCamera(h.getCamera())
					}
				}}
			/>
			<div className="history-bar" role="status">
				<i className="glyph glyph-replay" />
				<span>
					<b>History</b> · the circuit as it was in <b>{clip.props.label || 'this recording'}</b>,{' '}
					{when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{' '}
					{when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}. Read-only.
				</span>
				<button
					title="Make this the current version (undo brings back today's)"
					onClick={() => {
						restoreVersion(editor, mode.circuit)
						back()
					}}
				>
					Restore this version
				</button>
				<button className="is-primary" title="Back to the live canvas (Esc)" onClick={back}>
					Back to now
				</button>
			</div>
		</div>
	)
}
