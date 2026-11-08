import { Editor, TLShapeId, atom, createShapeId } from 'tldraw'
import { snapshotCircuit } from './versions'
import { cameraStreams } from '../camera/peer'
import { saveVideo } from '../camera/videoStore'
import { place as placeOnGrid } from './blocks'
import { SAMPLE_HZ } from './history'
import { encodeSeries } from './playback'
import { getDef } from '../blocks/registry'
import { clipHeight } from './ClipShapeUtil'
import { blockName, effectiveValue, getBlock } from './signals'
import { CAMERA_TYPE, CLIP_TYPE, ClipChannel, IO_TYPE, LOGIC_TYPE, LogicShape, isInput, signalType } from './types'

/*
 * Recording stays light. Signals: every block — inputs, outputs and every
 * logic block's outputs in between — at 20 Hz, 8 bits a sample (numbers as
 * floats, colours as R G B). Video: one camera at 640 px wide, 20 fps,
 * ~700 kbit/s: about 5 MB a minute, kept only on this computer. Clips stop
 * at 2 minutes.
 */

const VIDEO_WIDTH = 640
const VIDEO_FPS = 20
const VIDEO_BITRATE = 700_000
export const MAX_SECONDS = 120

export const recording = atom<{ startedAt: number } | null>('recording', null)

interface Session {
	startedAt: number
	timer: number
	/** Keyed by block id, or `id|port` for a logic block's output. */
	samples: Map<string, number[]>
	stopVideo?: () => Promise<{ blob: Blob; aspect: number } | null>
	cameraId?: TLShapeId
}
let session: Session | null = null

export function startRecording(editor: Editor) {
	if (session) return
	const samples = new Map<string, number[]>()
	let n = 0
	const push = (key: string, v: number) => {
		let s = samples.get(key)
		// A block added mid-recording starts where the others are.
		if (!s) samples.set(key, (s = new Array(n).fill(v)))
		s.push(v)
	}
	const timer = window.setInterval(() => {
		for (const b of editor.getCurrentPageShapes()) {
			if (b.type === IO_TYPE) push(b.id, effectiveValue(editor, b.id, true))
			// The steps in between: every output of every logic block.
			else if (b.type === LOGIC_TYPE) {
				const block = b as LogicShape
				for (const p of getDef(block).outputs) push(`${b.id}|${p.id}`, block.props.out[p.id] ?? 0)
			}
		}
		n++
		if (n >= MAX_SECONDS * SAMPLE_HZ) void stopRecording(editor)
	}, 1000 / SAMPLE_HZ)

	const camera = pickCamera(editor)
	session = {
		startedAt: Date.now(),
		timer,
		samples,
		cameraId: camera?.id,
		stopVideo: camera ? recordVideo(camera.stream) : undefined,
	}
	recording.set({ startedAt: session.startedAt })
}

export async function stopRecording(editor: Editor) {
	const s = session
	if (!s) return
	session = null
	clearInterval(s.timer)
	recording.set(null)

	const video = await s.stopVideo?.()
	const duration = Math.max(...[...s.samples.values()].map((v) => v.length), 1) / SAMPLE_HZ
	const channels: ClipChannel[] = []
	for (const [key, values] of s.samples) {
		const [id, port] = key.split('|') as [TLShapeId, string | undefined]
		const block = getBlock(editor, id)
		if (!block) continue
		if (block.type === IO_TYPE) {
			channels.push({
				id,
				kind: block.props.kind,
				label: blockName(block),
				role: isInput(block.props.kind) ? 'in' : 'out',
				data: encodeSeries(values, signalType(block.props.kind)),
			})
		} else {
			const spec = getDef(block).outputs.find((o) => o.id === port)
			if (!spec) continue
			const many = getDef(block).outputs.length > 1
			channels.push({
				id,
				port,
				type: spec.type,
				role: 'between',
				label: many ? `${blockName(block)} · ${spec.label ?? spec.id}` : blockName(block),
				data: encodeSeries(values, spec.type),
			})
		}
	}
	if (!channels.length) return

	const id = createShapeId()
	const key = video ? `${id}-${s.startedAt}` : ''
	if (video) await saveVideo(key, video.blob)

	const w = 360
	const videoH = video ? Math.round(w / video.aspect) : 0
	const h = clipHeight({ channels, videoH, expanded: false })
	const count = editor.getCurrentPageShapes().filter((sh) => sh.type === CLIP_TYPE).length
	const place = placement(editor, s.cameraId, w, h)

	editor.markHistoryStoppingPoint('recording')
	editor.createShape({
		id,
		type: CLIP_TYPE,
		x: placeOnGrid(editor, place.x),
		y: placeOnGrid(editor, place.y),
		props: {
			w,
			h,
			label: `Recording ${count + 1}`,
			duration,
			hz: SAMPLE_HZ,
			channels,
			video: key,
			videoOwner: editor.user.getName() || 'the recording computer',
			videoH,
			expanded: false,
			circuit: snapshotCircuit(editor),
		},
	})
	editor.select(id)
}

/** The selected camera if it shows video, else the first camera that does. */
function pickCamera(editor: Editor) {
	const cams = editor.getCurrentPageShapes().filter((s) => s.type === CAMERA_TYPE)
	const selected = editor.getSelectedShapeIds()
	const ordered = [...cams.filter((c) => selected.includes(c.id)), ...cams]
	for (const c of ordered) {
		const stream = cameraStreams.get(c.id)
		if (stream?.getVideoTracks().some((t) => t.readyState === 'live')) return { id: c.id, stream }
	}
	return undefined
}

/** Downscale through a canvas so the recording costs what a thumbnail costs. */
function recordVideo(stream: MediaStream) {
	const video = document.createElement('video')
	video.muted = true
	video.playsInline = true
	video.srcObject = stream
	void video.play().catch(() => {})

	const canvas = document.createElement('canvas')
	const ctx = canvas.getContext('2d')!
	const settings = stream.getVideoTracks()[0]?.getSettings()
	const aspect = settings?.width && settings?.height ? settings.width / settings.height : 4 / 3
	canvas.width = VIDEO_WIDTH
	canvas.height = Math.round(VIDEO_WIDTH / aspect / 2) * 2

	const draw = window.setInterval(() => {
		if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
	}, 1000 / VIDEO_FPS)

	const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) =>
		MediaRecorder.isTypeSupported(t)
	)
	const recorder = new MediaRecorder(canvas.captureStream(VIDEO_FPS), {
		mimeType,
		videoBitsPerSecond: VIDEO_BITRATE,
	})
	const chunks: Blob[] = []
	recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
	recorder.start(1000)

	return () =>
		new Promise<{ blob: Blob; aspect: number } | null>((resolve) => {
			recorder.onstop = () => {
				clearInterval(draw)
				video.srcObject = null
				resolve(chunks.length ? { blob: new Blob(chunks, { type: recorder.mimeType }), aspect: canvas.width / canvas.height } : null)
			}
			recorder.stop()
		})
}

/** Under the camera it recorded, else below everything, so it never covers a block. */
function placement(editor: Editor, cameraId: TLShapeId | undefined, w: number, h: number) {
	const cam = cameraId && editor.getShapePageBounds(cameraId)
	if (cam) return { x: cam.minX, y: cam.maxY + 24 }
	const all = editor.getCurrentPageBounds()
	if (all) return { x: all.minX, y: all.maxY + 40 }
	const c = editor.getViewportPageBounds().center
	return { x: c.x - w / 2, y: c.y - h / 2 }
}
