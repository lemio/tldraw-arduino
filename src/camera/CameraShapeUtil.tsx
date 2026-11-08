import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import {
	HTMLContainer,
	RecordProps,
	Rectangle2d,
	ShapeUtil,
	T,
	TLResizeInfo,
	stopEventPropagation,
	useEditor,
	useValue,
} from 'tldraw'
import { snapResize, snapToGrid } from '../shapes/blocks'
import { NameInput } from '../shapes/IoShapeUtil'
import { CAMERA_TYPE, CameraShape } from '../shapes/types'
import { Hosting, cameraStreams, hostStream, localStreams, newCameraPeerId, onLocalStreamsChange, watchStream } from './peer'

export class CameraShapeUtil extends ShapeUtil<CameraShape> {
	static override type = CAMERA_TYPE
	static override props: RecordProps<CameraShape> = {
		w: T.number,
		h: T.number,
		label: T.string,
		source: T.literalEnum('none', 'local', 'phone'),
		peer: T.string,
	}

	getDefaultProps(): CameraShape['props'] {
		return { w: 400, h: 300, label: '', source: 'none', peer: '' }
	}

	getGeometry(shape: CameraShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	getIndicatorPath(shape: CameraShape) {
		const p = new Path2D()
		p.roundRect(0, 0, shape.props.w, shape.props.h, 12)
		return p
	}

	override canBind() {
		return false
	}
	override canEdit() {
		return true
	}
	override onResize(shape: CameraShape, info: TLResizeInfo<CameraShape>) {
		return snapResize(this.editor, shape, info, { minW: 192, minH: 144 })
	}
	override onTranslate(initial: CameraShape, current: CameraShape) {
		return snapToGrid(this.editor, initial, current)
	}

	component(shape: CameraShape) {
		return <Camera shape={shape} />
	}
}

/** This browser's own camera sessions, by peer id. Survive re-renders, not reloads. */
const hosting = new Map<string, Hosting>()

function Camera({ shape }: { shape: CameraShape }) {
	const editor = useEditor()
	const { w, h, source, peer, label } = shape.props
	const isEditing = useValue('editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
	const stream = usePeerStream(peer)
	const isHost = useIsLocal(peer)
	useEffect(() => {
		if (!stream) return
		cameraStreams.set(shape.id, stream)
		return () => void cameraStreams.delete(shape.id)
	}, [shape.id, stream])
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
	const [error, setError] = useState('')

	const update = (props: Partial<CameraShape['props']>) =>
		editor.updateShape({ id: shape.id, type: CAMERA_TYPE, props })

	const startLocal = async (deviceId?: string) => {
		setError('')
		try {
			const media = await navigator.mediaDevices.getUserMedia({
				video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1280, height: 720 },
				audio: false,
			})
			setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'))
			stopHosting(peer)
			const id = newCameraPeerId()
			hosting.set(id, hostStream(id, media))
			update({ source: 'local', peer: id })
		} catch (e) {
			setError(e instanceof Error ? e.message : 'The camera could not be opened.')
		}
	}

	const startPhone = () => {
		stopHosting(peer)
		update({ source: 'phone', peer: newCameraPeerId() })
	}

	const stop = () => {
		stopHosting(peer)
		update({ source: 'none', peer: '' })
	}

	const interactive = { pointerEvents: 'all' as const }

	return (
		<HTMLContainer className="cam" style={{ width: w, height: h }}>
			{stream ? (
				<Video stream={stream} />
			) : source === 'phone' ? (
				<PhonePairing peer={peer} />
			) : source === 'local' ? (
				<div className="cam-empty">
					<p>Waiting for the computer that shares this camera…</p>
					<button style={interactive} onPointerDown={stopEventPropagation} onClick={() => startLocal()}>
						Use this computer’s camera instead
					</button>
				</div>
			) : (
				<div className="cam-empty">
					<p>Show the real thing next to its signals.</p>
					<div className="cam-choices">
						<button style={interactive} onPointerDown={stopEventPropagation} onClick={() => startLocal()}>
							This computer
						</button>
						<button style={interactive} onPointerDown={stopEventPropagation} onClick={startPhone}>
							A phone
						</button>
					</div>
					{error && <p className="cam-error">{error}</p>}
				</div>
			)}

			{source !== 'none' && (
				<div className="cam-bar" style={interactive} onPointerDown={stopEventPropagation}>
					{isHost && devices.length > 1 && (
						<select onChange={(e) => startLocal(e.target.value)} defaultValue="">
							<option value="" disabled>
								Camera…
							</option>
							{devices.map((d, i) => (
								<option key={d.deviceId} value={d.deviceId}>
									{d.label || `Camera ${i + 1}`}
								</option>
							))}
						</select>
					)}
					<button onClick={stop}>Stop</button>
				</div>
			)}

			{(isEditing || label) && (
				<div className="cam-label">
					{isEditing ? (
						<NameInput
							className="cam-name"
							value={label}
							placeholder="What does it show? e.g. Front door"
							onCommit={(v) => v !== label && update({ label: v })}
							onDone={() => editor.setEditingShape(null)}
						/>
					) : (
						label
					)}
				</div>
			)}
		</HTMLContainer>
	)
}

function stopHosting(peer: string) {
	hosting.get(peer)?.stop()
	hosting.delete(peer)
}

function Video({ stream }: { stream: MediaStream }) {
	const ref = useRef<HTMLVideoElement>(null)
	useEffect(() => {
		if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
	}, [stream])
	return <video ref={ref} className="cam-video" autoPlay muted playsInline />
}

function useIsLocal(peer: string) {
	const [local, setLocal] = useState(() => localStreams.has(peer))
	useEffect(() => {
		setLocal(localStreams.has(peer))
		return onLocalStreamsChange(() => setLocal(localStreams.has(peer)))
	}, [peer])
	return local
}

/** The local stream if this browser hosts the camera, else the remote one. */
function usePeerStream(peer: string) {
	const isLocal = useIsLocal(peer)
	const [remote, setRemote] = useState<MediaStream | null>(null)
	useEffect(() => {
		setRemote(null)
		if (!peer || isLocal) return
		return watchStream(peer, setRemote)
	}, [peer, isLocal])
	return isLocal ? (localStreams.get(peer) ?? null) : remote
}

function PhonePairing({ peer }: { peer: string }) {
	const [qr, setQr] = useState('')
	const url = `${location.origin}${location.pathname}?cam=${encodeURIComponent(peer)}`
	useEffect(() => {
		QRCode.toDataURL(url, { margin: 0, width: 360, color: { dark: '#1d1d1f', light: '#ffffff' } }).then(setQr)
	}, [url])
	return (
		<div className="cam-empty cam-pair">
			{qr && <img src={qr} alt="QR code that opens this camera on a phone" />}
			<p>
				Scan with the phone’s camera, or open
				<br />
				<a href={url} target="_blank" rel="noreferrer" style={{ pointerEvents: 'all' }} onPointerDown={stopEventPropagation}>
					{url.replace(/^https?:\/\//, '')}
				</a>
			</p>
			{(location.protocol !== 'https:' || /^(localhost|127\.)/.test(location.hostname)) && (
				<p className="cam-error">
					A phone needs this canvas on an https:// address to reach it and use its camera.
				</p>
			)}
		</div>
	)
}
