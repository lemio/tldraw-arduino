import { useEffect, useRef, useState } from 'react'
import { Editor, useValue } from 'tldraw'
import { apiKey, chatBusy, chatLog, chatOpen, newChat, sendChat, setApiKey, stopChat } from '../ai/agent'

const EXAMPLES = [
	'When the BOOT button is pressed, blink the RGB LED red for 5 seconds',
	'A night light: an LED that turns on when the room gets dark',
	'Count how often the door opens and show it on a gauge',
]

/**
 * Ask for features, changes or whole programs in plain words; the assistant
 * builds them from blocks on the canvas, asking for pins on the board drawing
 * when it needs to know.
 */
export function ChatPanel({ editor }: { editor: Editor }) {
	const key = useValue(apiKey)
	const log = useValue(chatLog)
	const busy = useValue(chatBusy)
	const [draft, setDraft] = useState('')
	const [editingKey, setEditingKey] = useState(!key)
	const list = useRef<HTMLDivElement>(null)

	useEffect(() => {
		list.current?.scrollTo({ top: list.current.scrollHeight })
	}, [log, busy])

	const send = (text = draft) => {
		const t = text.trim()
		if (!t || busy) return
		setDraft('')
		void sendChat(editor, t)
	}

	return (
		<aside className="code chat">
			<header>
				<h2>Assistant</h2>
				<button onClick={newChat} disabled={!log.length || !!busy} title="Start a new conversation">
					New chat
				</button>
				<button onClick={() => setEditingKey(!editingKey)} title="Your Anthropic API key" className={editingKey ? 'is-on' : ''}>
					Key
				</button>
				<button className="code-close" title="Close" onClick={() => chatOpen.set(false)}>
					×
				</button>
			</header>

			{editingKey ? (
				<KeyForm current={key} onDone={() => setEditingKey(false)} />
			) : (
				<>
					<div className="chat-log" ref={list}>
						{!log.length && (
							<div className="chat-empty">
								<p>Describe what it should do. The assistant builds it from blocks on the canvas, and asks you to pick pins on the board when it needs to know.</p>
								{EXAMPLES.map((ex) => (
									<button key={ex} onClick={() => send(ex)}>
										{ex}
									</button>
								))}
							</div>
						)}
						{log.map((item, i) => (
							<div key={i} className={`chat-item chat-${item.kind}${'error' in item && item.error ? ' is-error' : ''}`}>
								{item.text}
							</div>
						))}
						{busy && (
							<div className="chat-item chat-status" role="status">
								{busy === 'asking' ? 'Pick a pin on the board…' : 'Working…'}
							</div>
						)}
					</div>
					<form
						className="chat-input"
						onSubmit={(e) => {
							e.preventDefault()
							send()
						}}
					>
						<textarea
							value={draft}
							rows={3}
							placeholder="e.g. Turn the fan on when it's warmer than 25 °C"
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								// Keep typing out of the canvas's shortcuts.
								e.stopPropagation()
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault()
									send()
								}
							}}
						/>
						{busy ? (
							<button type="button" onClick={stopChat}>
								Stop
							</button>
						) : (
							<button type="submit" disabled={!draft.trim()} className="is-primary">
								Send
							</button>
						)}
					</form>
				</>
			)}
		</aside>
	)
}

function KeyForm({ current, onDone }: { current: string; onDone(): void }) {
	const [value, setValue] = useState(current)
	return (
		<form
			className="chat-key"
			onSubmit={(e) => {
				e.preventDefault()
				setApiKey(value.trim())
				if (value.trim()) onDone()
			}}
		>
			<p>
				The assistant runs on Claude and uses your own Anthropic API key. Requests go straight from this browser to
				Anthropic and are billed to that key. The key is kept only in this browser; collaborators never see it.
			</p>
			<input
				type="password"
				value={value}
				autoComplete="off"
				spellCheck={false}
				placeholder="sk-ant-…"
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => e.stopPropagation()}
			/>
			<div className="chat-key-actions">
				<button type="submit" className="is-primary" disabled={!value.trim()}>
					Save
				</button>
				{current && (
					<button
						type="button"
						onClick={() => {
							setApiKey('')
							setValue('')
						}}
					>
						Forget key
					</button>
				)}
			</div>
			<p className="chat-fine">
				Get a key at <a href="https://platform.claude.com" target="_blank" rel="noreferrer">platform.claude.com</a>. Only use your
				own key on a computer you trust.
			</p>
		</form>
	)
}
