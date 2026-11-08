import { useEffect, useRef, useState } from 'react'
import { Editor, useValue } from 'tldraw'
import { generateMain } from '../device/codegen'
import { consoleLines, device, deviceStatus } from '../device/host'
import { codePanelOpen } from './HardwareBar'

/**
 * The canvas, as the MicroPython it stands for — always in sync, because it is
 * derived from the same store — plus a console to talk to the board directly.
 */
export function CodePanel({ editor }: { editor: Editor }) {
	const code = useValue('code', () => generateMain(editor), [editor])
	const { state } = useValue(deviceStatus)
	const [copied, setCopied] = useState(false)
	const [busy, setBusy] = useState(false)
	const canSave = state === 'live' || state === 'idle' || state === 'standalone'

	return (
		<aside className="code">
			<header>
				<h2>main.py</h2>
				<button
					onClick={async () => {
						await navigator.clipboard.writeText(code)
						setCopied(true)
						setTimeout(() => setCopied(false), 1500)
					}}
				>
					{copied ? 'Copied' : 'Copy'}
				</button>
				<button
					disabled={!canSave || busy}
					title={
						canSave
							? 'Write this program to the board. It then runs without the browser, also after a power cycle.'
							: 'Connect a board first'
					}
					onClick={async () => {
						setBusy(true)
						try {
							await device.saveMain(code)
						} finally {
							setBusy(false)
						}
					}}
				>
					Save to board
				</button>
				<button className="code-close" title="Close" onClick={() => codePanelOpen.set(false)}>
					×
				</button>
			</header>
			<pre className="code-src">
				{code.split('\n').map((line, i) => (
					<Line key={i} text={line} />
				))}
			</pre>
			<Console />
		</aside>
	)
}

/** Just enough highlighting to separate code from commentary. */
function Line({ text }: { text: string }) {
	const i = text.indexOf('#')
	if (i < 0) return <div>{text || ' '}</div>
	return (
		<div>
			{text.slice(0, i)}
			<span className="c">{text.slice(i)}</span>
		</div>
	)
}

function Console() {
	const lines = useValue(consoleLines)
	const { state } = useValue(deviceStatus)
	const [input, setInput] = useState('')
	const [history, setHistory] = useState<string[]>([])
	const [cursor, setCursor] = useState(-1)
	const scroller = useRef<HTMLDivElement>(null)
	const ready = state === 'live' || state === 'idle' || state === 'standalone'

	useEffect(() => {
		scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
	}, [lines])

	return (
		<section className="console">
			<header>
				<h2>Console</h2>
				<button onClick={() => consoleLines.set([])}>Clear</button>
			</header>
			<div className="console-lines" ref={scroller}>
				{lines.length === 0 && <div className="console-empty">Output from the board appears here.</div>}
				{lines.map((l) => (
					<div key={l.id} className={`console-${l.kind}`}>
						{l.kind === 'in' ? '› ' : ''}
						{l.text}
					</div>
				))}
			</div>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					if (!input.trim()) return
					void device.repl(input)
					setHistory((h) => [...h, input])
					setCursor(-1)
					setInput('')
				}}
			>
				<span>›</span>
				<input
					value={input}
					disabled={!ready}
					spellCheck={false}
					placeholder={ready ? 'Python, e.g. 1 + 1' : 'Connect a board to use the REPL'}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
						e.preventDefault()
						const next =
							e.key === 'ArrowUp'
								? Math.min(history.length - 1, cursor + 1)
								: Math.max(-1, cursor - 1)
						setCursor(next)
						setInput(next < 0 ? '' : history[history.length - 1 - next])
					}}
				/>
			</form>
		</section>
	)
}
