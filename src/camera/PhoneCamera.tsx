import { useEffect, useRef, useState } from 'react'
import { Hosting, hostStream } from './peer'

/**
 * What a phone shows after scanning a camera block's QR code: the camera,
 * streamed into that block for everyone on the canvas.
 */
export function PhoneCamera({ peer }: { peer: string }) {
	const video = useRef<HTMLVideoElement>(null)
	const [facing, setFacing] = useState<'environment' | 'user'>('environment')
	const [status, setStatus] = useState('Starting camera…')

	useEffect(() => {
		let hosting: Hosting | null = null
		let cancelled = false
		navigator.mediaDevices
			.getUserMedia({ video: { facingMode: facing, width: 1280, height: 720 }, audio: false })
			.then((stream) => {
				if (cancelled) return stream.getTracks().forEach((t) => t.stop())
				if (video.current) video.current.srcObject = stream
				setStatus('Connecting…')
				hosting = hostStream(peer, stream, (s) =>
					setStatus(s === 'live' ? 'Live on the canvas' : s === 'unavailable-id' ? 'Reconnecting…' : s)
				)
			})
			.catch((e) => setStatus(e instanceof Error ? e.message : 'Camera unavailable'))
		return () => {
			cancelled = true
			hosting?.stop()
		}
	}, [peer, facing])

	useEffect(() => {
		const lock = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock
		lock?.request('screen').catch(() => {})
	}, [])

	return (
		<div className="phone">
			<video ref={video} autoPlay muted playsInline />
			<div className="phone-bar">
				<span className={status === 'Live on the canvas' ? 'phone-live' : undefined}>{status}</span>
				<button onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>Flip</button>
			</div>
		</div>
	)
}
