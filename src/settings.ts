import { Editor, react } from 'tldraw'
import { GRID } from './shapes/blocks'
import { layoutSiblings } from './shapes/wiring'
import { IO_TYPE } from './shapes/types'

/*
 * Two kinds of setting, after how tldraw already splits them:
 *
 * - The grid follows tldraw's own Preferences: "Show grid" (per person) both
 *   draws the grid and makes blocks snap to it, exactly as it does for
 *   tldraw's shapes; the grid's cells are our 16 px block grid.
 * - "Fan out wires" changes how wires are routed, which everyone in the room
 *   sees, so it lives in the shared document.
 */

export const isFanOutOn = (editor: Editor) => editor.getDocumentSettings().meta.fanOutWires === true

export function setFanOut(editor: Editor, on: boolean) {
	editor.markHistoryStoppingPoint('fan out wires')
	editor.updateDocumentSettings({ meta: { ...editor.getDocumentSettings().meta, fanOutWires: on } })
	for (const s of editor.getCurrentPageShapes()) if (s.type === IO_TYPE) layoutSiblings(editor, s.id)
}

const GRID_PREF = 'micropython-canvas:grid'

/**
 * Match tldraw's grid to the block grid, and show it unless this person has
 * turned it off. tldraw keeps "Show grid" per room and tab, so remember the
 * choice here and bring it to every room.
 */
export function setUpGrid(editor: Editor) {
	if (editor.getDocumentSettings().gridSize !== GRID) editor.updateDocumentSettings({ gridSize: GRID })
	let on = true
	try {
		on = localStorage.getItem(GRID_PREF) !== 'off'
	} catch {
		/* storage blocked: the default */
	}
	if (editor.getInstanceState().isGridMode !== on) editor.updateInstanceState({ isGridMode: on })
	return react('remember grid', () => {
		const now = editor.getInstanceState().isGridMode
		try {
			localStorage.setItem(GRID_PREF, now ? 'on' : 'off')
		} catch {
			/* storage blocked */
		}
	})
}
