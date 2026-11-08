import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { atom, useEditor, useValue } from 'tldraw'
import { BUNDLED_FIRMWARE, hasWebSerial } from '../device/Device'
import { device, deviceStatus, telemetryRate } from '../device/host'
import { playback } from '../shapes/playback'
import { MAX_SECONDS, recording, startRecording, stopRecording } from '../shapes/recorder'

export const codePanelOpen = atom('codePanelOpen', false)

/**
 * The strip of chrome along the top: the board's state, recording, and the
 * code. Blocks themselves come from the palette on the left.
 */
export function HardwareBar() {
	const codeOpen = useValue(codePanelOpen)

	return (
		<div className="hwbar" onPointerDown={(e) => e.stopPropagation()}>
			<BoardChip />
			<span className="hwbar-sep" />
			<RecordButton />
			<button
				className={`hwbar-add${codeOpen ? ' is-on' : ''}`}
				title="The MicroPython program this canvas describes"
				onClick={() => codePanelOpen.set(!codeOpen)}
			>
				Code
			</button>
		</div>
	)
}

/**
 * Records every block's signal, and one camera, into a clip on the canvas.
 * While a clip is scrubbed, this shows the moment and the way back to live.
 */
function RecordButton() {
	const editor = useEditor()
	const rec = useValue(recording)
	const pb = useValue(playback)
	const [, tick] = useState(0)

	useEffect(() => {
		if (!rec) return
		const i = setInterval(() => tick((n) => n + 1), 250)
		return () => clearInterval(i)
	}, [rec])

	useEffect(() => {
		if (!pb) return
		const esc = (e: KeyboardEvent) => e.key === 'Escape' && playback.set(null)
		window.addEventListener('keydown', esc)
		return () => window.removeEventListener('keydown', esc)
	}, [pb])

	if (pb && !rec) {
		return (
			<button className="hwbar-add rec-replay" title="Back to live values (Esc)" onClick={() => playback.set(null)}>
				<i className="glyph glyph-replay" />
				{pb.t.toFixed(1)} s · Live
			</button>
		)
	}
	if (rec) {
		const s = Math.floor((Date.now() - rec.startedAt) / 1000)
		return (
			<button className="hwbar-add is-on rec-on" title="Stop recording" onClick={() => void stopRecording(editor)}>
				<i className="glyph glyph-stop" />
				{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
			</button>
		)
	}
	return (
		<button
			className="hwbar-add"
			title={`Record every block's signal, and the selected or first camera, for up to ${MAX_SECONDS / 60} minutes`}
			onClick={() => startRecording(editor)}
		>
			<i className="glyph glyph-rec" />
			Record
		</button>
	)
}

function BoardChip() {
	const { state, detail } = useValue(deviceStatus)
	const rate = useValue(telemetryRate)
	const [menu, setMenu] = useState(false)
	const [progress, setProgress] = useState(0)
	const [error, setError] = useState('')
	const fileInput = useRef<HTMLInputElement>(null)
	const ref = useRef<HTMLDivElement>(null)

	// Offer the install as soon as a board without MicroPython shows up.
	useEffect(() => {
		if (state === 'no-micropython') setMenu(true)
	}, [state])

	useEffect(() => {
		if (!menu) return
		const close = (e: PointerEvent) => {
			const t = e.target as Element
			if (!ref.current?.contains(t) && !t.closest?.('.pop')) setMenu(false)
		}
		window.addEventListener('pointerdown', close)
		return () => window.removeEventListener('pointerdown', close)
	}, [menu])

	const run = (fn: () => Promise<unknown>) => async () => {
		setError('')
		setMenu(false)
		try {
			await fn()
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			if (!/No port selected|cancel/i.test(msg)) setError(msg)
		}
	}
	const flash = (bin?: Uint8Array) => run(() => device.flash(bin, (p) => setProgress(p)))

	let label: string
	let action: (() => void) | undefined
	switch (state) {
		case 'unsupported':
			label = 'Open in Chrome or Edge to connect a board'
			break
		case 'disconnected':
			label = 'Connect ESP32-S3'
			action = run(() => device.connect())
			break
		case 'connecting':
			label = 'Choose the board…'
			break
		case 'checking':
			label = 'Looking for MicroPython…'
			break
		case 'no-micropython':
			label = 'Install MicroPython'
			action = () => setMenu(true)
			break
		case 'flashing':
			label = `${detail || 'Installing'} · ${progress} %`
			break
		case 'idle':
			label = 'Connected'
			action = () => setMenu(!menu)
			break
		case 'live':
			label = `Live · ${rate} Hz`
			action = () => setMenu(!menu)
			break
		case 'standalone':
			label = 'Running main.py'
			action = () => setMenu(!menu)
			break
	}

	return (
		<div className="board" ref={ref}>
			<button
				className={`board-chip board-${state}`}
				disabled={!action}
				onClick={action}
				title={detail || (state === 'live' ? 'Readings per second from the board' : undefined)}
			>
				<i className="board-dot" />
				{label}
				{state === 'flashing' && <span className="board-progress" style={{ width: `${progress}%` }} />}
			</button>

			{menu && (
				<Popover anchor={ref}>
					{state === 'no-micropython' ? (
						<>
							<p>
								This board doesn’t run MicroPython yet. Install <b>{BUNDLED_FIRMWARE.version}</b>?
								It erases what is on the board and takes about half a minute.
							</p>
							<div className="pop-actions">
								<button className="primary" onClick={flash()}>
									Install
								</button>
								<button onClick={() => setMenu(false)}>Not now</button>
							</div>
							<p className="pop-hint">
								Stuck? Hold <kbd>BOOT</kbd>, tap <kbd>RESET</kbd>, release <kbd>BOOT</kbd>, and try again.
							</p>
						</>
					) : (
						<>
							{state === 'standalone' && <button onClick={run(() => device.resumeLive())}>Drive from the canvas again</button>}
							{state === 'idle' && <button onClick={run(() => device.runAgent())}>Go live</button>}
							<button onClick={flash()}>Reinstall MicroPython…</button>
							<button onClick={() => fileInput.current?.click()}>Install from a .bin file…</button>
							<button onClick={run(() => device.disconnect())}>Disconnect</button>
						</>
					)}
				</Popover>
			)}
			{error && !menu && (
				<Popover anchor={ref} className="pop-error" onClick={() => setError('')}>
					<p>{error}</p>
					<p className="pop-hint">
						{hasWebSerial()
							? 'If the board has no auto-reset circuit: hold BOOT, tap RESET, release BOOT, then try again.'
							: 'WebUSB works with CH340 boards only.'}
					</p>
				</Popover>
			)}
			<input
				ref={fileInput}
				type="file"
				accept=".bin"
				hidden
				onChange={async (e) => {
					const f = e.target.files?.[0]
					e.target.value = ''
					if (f) await flash(new Uint8Array(await f.arrayBuffer()))()
				}}
			/>
		</div>
	)
}

/**
 * Menus live outside the bar: the bar scrolls sideways on narrow screens, and
 * its overflow would clip anything hanging below it.
 */
function Popover({
	anchor,
	className,
	onClick,
	children,
}: {
	anchor: React.RefObject<HTMLElement | null>
	className?: string
	onClick?(): void
	children: ReactNode
}) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
	useLayoutEffect(() => {
		const place = () => {
			const r = anchor.current?.getBoundingClientRect()
			if (r) setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) })
		}
		place()
		window.addEventListener('resize', place)
		return () => window.removeEventListener('resize', place)
	}, [anchor])
	const root = document.querySelector('.app') ?? document.body
	if (!pos) return null
	return createPortal(
		<div
			className={`pop${className ? ' ' + className : ''}`}
			style={pos}
			onClick={onClick}
			onPointerDown={(e) => e.stopPropagation()}
		>
			{children}
		</div>,
		root
	)
}
