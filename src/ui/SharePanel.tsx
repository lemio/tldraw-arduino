import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PeopleMenu, useEditor, useValue } from 'tldraw'
import { SavedRoom, currentRoom, downloadRoom, forgetRoom, openRoom, openRoomFile, roomLink, roomName, saveRoom, savedRooms } from '../rooms'

export function SharePanel() {
	const [copied, setCopied] = useState(false)
	const [open, setOpen] = useState(false)
	return (
		<div className="tlui-share-zone share" draggable={false}>
			<PeopleMenu />
			<button
				className={`share-save${open ? ' is-open' : ''}`}
				title="Save this room, to open or share it later"
				onClick={() => setOpen(!open)}
			>
				Save
			</button>
			<button
				className="share-invite"
				title="Everyone with this link edits the same canvas, for as long as the sync server keeps it. Save the room to keep it longer."
				onClick={async () => {
					await navigator.clipboard.writeText(location.href)
					setCopied(true)
					setTimeout(() => setCopied(false), 1600)
				}}
			>
				{copied ? 'Link copied ✓' : 'Invite'}
			</button>
			{open && <SavePanel onClose={() => setOpen(false)} />}
		</div>
	)
}

const when = (t: number) =>
	new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

function SavePanel({ onClose }: { onClose(): void }) {
	const editor = useEditor()
	const room = currentRoom()
	const shared = useValue('room name', () => roomName(editor), [editor])
	const list = useValue(savedRooms)
	const mine = list.find((s) => s.room === room)
	const [name, setName] = useState(shared || mine?.name || '')
	const [note, setNote] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const file = useRef<HTMLInputElement>(null)
	// Above tldraw's own panels, under the Save button.
	const at = document.querySelector('.share-save')?.getBoundingClientRect()

	useEffect(() => {
		const away = (e: PointerEvent) => {
			const t = e.target as Element
			if (!ref.current?.contains(t) && !t.closest?.('.share-save')) onClose()
		}
		const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
		window.addEventListener('pointerdown', away)
		window.addEventListener('keydown', esc)
		return () => {
			window.removeEventListener('pointerdown', away)
			window.removeEventListener('keydown', esc)
		}
	}, [onClose])

	const flash = (text: string) => {
		setNote(text)
		setTimeout(() => setNote((n) => (n === text ? null : n)), 2400)
	}

	const save = async () => {
		setBusy(true)
		try {
			const { stored } = await saveRoom(editor, room, name.trim() || 'Untitled room')
			flash(stored ? 'Saved ✓' : 'Saved in the link only: this browser’s storage is full')
		} finally {
			setBusy(false)
		}
	}

	const copy = async (s: SavedRoom) => {
		await navigator.clipboard.writeText(roomLink(s))
		flash('Link copied ✓')
	}

	return createPortal(
		<div
			ref={ref}
			className="rooms"
			style={at ? { top: at.bottom + 6, right: Math.max(8, window.innerWidth - at.right) } : undefined}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
			onWheel={(e) => e.stopPropagation()}
		>
			<h3>Save this room</h3>
			<form
				className="rooms-save"
				onSubmit={(e) => {
					e.preventDefault()
					void save()
				}}
			>
				<input value={name} placeholder="Name, for example Greenhouse" onChange={(e) => setName(e.target.value)} autoFocus />
				<button type="submit" disabled={busy}>
					{mine ? 'Save again' : 'Save'}
				</button>
			</form>
			<p className="rooms-hint">
				{mine ? `Saved ${when(mine.savedAt)}. ` : ''}A saved room keeps a full copy of the canvas. Its link opens this same
				room, and if the sync server has forgotten the room, the saved copy comes back.
			</p>
			{mine && (
				<div className="rooms-actions">
					<button onClick={() => void copy(mine)}>Copy link to share</button>
					<button onClick={() => downloadRoom(mine)} title="A file to keep, or to send when a link is too long">
						Download ↓
					</button>
				</div>
			)}
			{note && <p className="rooms-note">{note}</p>}

			<h3>Saved rooms</h3>
			{list.length === 0 ? (
				<p className="rooms-hint">None yet, in this browser.</p>
			) : (
				<ul className="rooms-list">
					{list.map((s) => (
						<li key={s.room} className={s.room === room ? 'is-here' : undefined}>
							<button
								className="rooms-open"
								disabled={s.room === room}
								title={s.room === room ? 'You are in this room' : 'Open this room'}
								onClick={() => openRoom(s)}
							>
								<span>{s.name}</span>
								<small>{s.room === room ? 'this room · ' : ''}{when(s.savedAt)}</small>
							</button>
							<button className="rooms-icon" title="Copy a link to share" onClick={() => void copy(s)}>
								🔗
							</button>
							<button className="rooms-icon" title="Download as a file" onClick={() => downloadRoom(s)}>
								↓
							</button>
							<button
								className="rooms-icon"
								title="Remove from this browser (the room itself stays)"
								onClick={() => confirm(`Remove “${s.name}” from the saved rooms in this browser?`) && forgetRoom(s.room)}
							>
								✕
							</button>
						</li>
					))}
				</ul>
			)}
			<button className="rooms-file" onClick={() => file.current?.click()}>
				Open a room file…
			</button>
			<input
				ref={file}
				type="file"
				accept=".json,application/json"
				hidden
				onChange={async (e) => {
					const f = e.target.files?.[0]
					e.target.value = ''
					if (!f) return
					try {
						await openRoomFile(f)
					} catch (err) {
						flash(err instanceof Error ? err.message : String(err))
					}
				}}
			/>
		</div>,
		editor.getContainer()
	)
}
