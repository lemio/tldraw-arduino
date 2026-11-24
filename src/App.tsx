import { useSync } from '@tldraw/sync'
import { useState } from 'react'
import {
	Editor,
	TLComponents,
	Tldraw,
	createBindingId,
	createShapeId,
	defaultBindingUtils,
	defaultShapeUtils,
	useValue,
} from 'tldraw'
import { assetStore, registerBookmarks } from './assets'
import { CameraShapeUtil } from './camera/CameraShapeUtil'
import { PhoneCamera } from './camera/PhoneCamera'
import { CustomEditor, editingCustom } from './blocks/CustomEditor'
import { LogicShapeUtil } from './blocks/LogicShapeUtil'
import { startRunner } from './blocks/runner'
import { attachDevice, device, deviceStatus, logLine } from './device/host'
import { setUpGrid } from './settings'
import { IO_H, IO_W, sendWireToBack, snap } from './shapes/blocks'
import { startSampler } from './shapes/history'
import { ClipShapeUtil } from './shapes/ClipShapeUtil'
import { IoShapeUtil } from './shapes/IoShapeUtil'
import { IO_TYPE, WIRE_TYPE } from './shapes/types'
import { WireBindingUtil, WireShapeUtil } from './shapes/WireShapeUtil'
import { CodePanel } from './ui/CodePanel'
import { HardwareBar, codePanelOpen } from './ui/HardwareBar'
import { MainMenu } from './ui/MainMenu'
import { Palette } from './ui/Palette'
import { PinPicker } from './ui/PinPicker'
import { SharePanel } from './ui/SharePanel'
import { WireInspector } from './ui/WireInspector'
import { HistoryCanvas } from './ui/HistoryCanvas'
import { ChatPanel } from './ui/ChatPanel'
import { chatOpen } from './ai/agent'
import { watchHistory } from './shapes/versions'
import { isPhone } from './phone'

const shapeUtils = [IoShapeUtil, LogicShapeUtil, WireShapeUtil, CameraShapeUtil, ClipShapeUtil]
const bindingUtils = [WireBindingUtil]

/** tldraw's free demo server syncs the room; images and videos go to our own storage (assets.ts). */
const SYNC_HOST = 'https://demo.tldraw.xyz'
// Fixed for the page's life: useSync reconnects when these change.
const syncShapeUtils = [...defaultShapeUtils, ...shapeUtils]
const syncBindingUtils = [...defaultBindingUtils, ...bindingUtils]

const components: TLComponents = {
	TopPanel: HardwareBar,
	MainMenu,
	SharePanel,
	// On a phone the canvas gets the screen: no menu, the palette button takes its corner.
	...(isPhone ? { MenuPanel: null } : {}),
	InFrontOfTheCanvas: () => (
		<>
			<Palette />
			<WireInspector />
			<PinPicker />
		</>
	),
}

export function App() {
	const params = new URLSearchParams(location.search)
	const cam = params.get('cam')
	if (cam) return <PhoneCamera peer={cam} />
	return <Canvas roomId={ensureRoom(params)} />
}

/** Every canvas is a room; the link is the invitation. */
function ensureRoom(params: URLSearchParams) {
	let room = params.get('room')
	if (!room || !/^[\w-]{6,64}$/.test(room)) {
		room = crypto.randomUUID().slice(0, 13)
		const url = new URL(location.href)
		url.searchParams.set('room', room)
		history.replaceState(null, '', url)
	}
	return room
}

function Canvas({ roomId }: { roomId: string }) {
	const room = `micropython-canvas-${roomId}`
	const store = useSync({
		uri: `${SYNC_HOST}/connect/${encodeURIComponent(room)}`,
		assets: assetStore,
		shapeUtils: syncShapeUtils,
		bindingUtils: syncBindingUtils,
	})
	const [editor, setEditor] = useState<Editor | null>(null)
	const codeOpen = useValue(codePanelOpen)
	const customOpen = useValue(editingCustom)
	const assistantOpen = useValue(chatOpen)
	const dark = useValue('dark', () => editor?.getColorMode() === 'dark', [editor])

	return (
		<div className="app" data-theme={dark ? 'dark' : 'light'}>
			<div className="app-canvas">
				<Tldraw
					store={store}
					shapeUtils={shapeUtils}
					bindingUtils={bindingUtils}
					components={components}
					onMount={(e) => {
						setEditor(e)
						registerBookmarks(e, SYNC_HOST)
						if (import.meta.env.DEV) Object.assign(window, { editor: e, deviceStatus, device })
						if (e.getCurrentPageShapeIds().size === 0 && !e.getShape(createShapeId('starter-button'))) seed(e)
						// On a phone, start on what is there rather than wherever the room was left.
						if (isPhone) requestAnimationFrame(() => e.zoomToFit({ animation: { duration: 0 } }))
						const stopGrid = setUpGrid(e)
						const stopSampler = startSampler(e)
						const detach = attachDevice(e)
						const stopRunner = startRunner(e, (line) => logLine(line))
						const stopHistory = watchHistory(e)
						return () => {
							stopHistory()
							stopGrid()
							stopSampler()
							detach()
							stopRunner()
						}
					}}
				/>
				{editor && <HistoryCanvas editor={editor} shapeUtils={shapeUtils} bindingUtils={bindingUtils} />}
			</div>
			{editor && customOpen ? <CustomEditor editor={editor} /> : codeOpen && editor && <CodePanel editor={editor} />}
			{editor && assistantOpen && <ChatPanel editor={editor} />}
		</div>
	)
}

/**
 * A fresh canvas starts with the smallest complete circuit: the S3 DevKit's own
 * BOOT button switching an LED. It works simulated before any board is
 * plugged in, and shows the shape of everything else.
 */
function seed(editor: Editor) {
	// Fixed ids: two people opening a new room at once write the same records,
	// which sync merges, instead of two starter circuits.
	const button = createShapeId('starter-button')
	const led = createShapeId('starter-output')
	const wire = createShapeId('starter-wire')
	const c = editor.getViewportPageBounds().center
	const x = snap(c.x)
	const y = snap(c.y - IO_H / 2)
	editor.run(
		() => {
			editor.createShapes([
				{
					id: button,
					type: IO_TYPE,
					x: x - IO_W - 96,
					y,
					props: { kind: 'din', label: 'BOOT button', pin: 0, pull: 'up' },
				},
				{
					id: led,
					type: IO_TYPE,
					x: x + 96,
					y,
					props: { kind: 'dout', label: '', pin: 13 },
				},
				{ id: wire, type: WIRE_TYPE, x: 0, y: 0 },
			])
			sendWireToBack(editor, wire)
			editor.createBindings([
				{ id: createBindingId('starter-start'), type: WIRE_TYPE, fromId: wire, toId: button, props: { terminal: 'start' } },
				{ id: createBindingId('starter-end'), type: WIRE_TYPE, fromId: wire, toId: led, props: { terminal: 'end' } },
			])
		},
		{ history: 'ignore' }
	)
}
