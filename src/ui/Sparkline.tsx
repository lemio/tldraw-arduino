import { Editor, TLShapeId, useEditor, useValue } from 'tldraw'
import { SAMPLE_HZ, WINDOW_S, getSeries, sampleTick } from '../shapes/history'
import { getClip, playback, recordedSeries } from '../shapes/playback'
import { fmtColour, getIncomingWire, getIo, getWireEnds, portTypeOf, simulate } from '../shapes/signals'
import { isInput, signalType } from '../shapes/types'

/*
 * A Tufte sparkline: no axes, no grid, a fixed 0..1 scale so that height means
 * the same thing on every block, and one accent dot for "now". Digital signals
 * draw as steps, because they never pass through the values in between.
 * While a clip is scrubbed, "now" is the playhead and the line is the recording.
 */
export function Sparkline({
	id,
	port,
	width,
	height,
	stepped,
	colour,
	scale,
}: {
	id: TLShapeId
	/** A logic block's output; IO blocks have just the one value. */
	port?: string
	width: number
	height: number
	stepped: boolean
	colour?: boolean
	/** 'auto' fits a number's own range; the default is the fixed 0..1 scale. */
	scale?: 'auto'
}) {
	const editor = useEditor()
	useValue('tick', () => sampleTick.get(), [])
	const replay = useValue('replay', () => (port !== undefined ? recordedWindow(editor, id, port) : replayWindow(editor, id)), [
		editor,
		id,
		port,
	])
	const data = replay ?? getSeries(id, port)
	const slots = SAMPLE_HZ * WINDOW_S
	if (colour) return <ColourStrip data={data} width={width} height={height} slots={slots} />
	return <Trace data={data} width={width} height={height} stepped={stepped} slots={slots} scale={scale} />
}

/** A colour over time: the sparkline of a colour is the colours it has been. */
export function ColourStrip({ data, width, height, slots }: { data: ArrayLike<number>; width: number; height: number; slots: number }) {
	const n = data.length
	if (width <= 0 || !n) return <svg className="spark" width={Math.max(0, width)} height={height} aria-hidden />
	const bw = width / Math.max(1, slots - 1)
	const bars: React.ReactNode[] = []
	for (let i = 0; i < n; i++) {
		if (i > 0 && data[i] === data[i - 1] && i !== n - 1) continue
		let j = i
		while (j + 1 < n && data[j + 1] === data[i]) j++
		const x = width - (n - 1 - i) * bw
		bars.push(<rect key={i} x={x} y={height / 2 - 3} width={Math.max(1, (j - i + 1) * bw)} height={6} fill={fmtColour(data[i])} />)
	}
	return (
		<svg className="spark spark-colour" width={width} height={height} aria-hidden>
			{bars}
		</svg>
	)
}

export function Trace({
	data,
	width,
	height,
	stepped,
	slots = data.length,
	dot = true,
	scale,
}: {
	data: ArrayLike<number>
	width: number
	height: number
	stepped: boolean
	slots?: number
	dot?: boolean
	scale?: 'auto'
}) {
	const pad = 2
	const h = height - pad * 2
	if (width <= 0 || height <= 0) return null
	const n = data.length
	let lo = 0
	let hi = 1
	if (scale === 'auto' && n) {
		lo = Infinity
		hi = -Infinity
		for (let i = 0; i < n; i++) {
			lo = Math.min(lo, data[i])
			hi = Math.max(hi, data[i])
		}
		if (hi - lo < 1e-9) {
			lo -= 1
			hi += 1
		}
	}
	const x = (i: number) => width - ((n - 1 - i) / Math.max(1, slots - 1)) * width
	const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * h

	// Thin long series to about one point per pixel; steps keep every change.
	const step = stepped ? 1 : Math.max(1, Math.floor(n / width))
	let d = ''
	for (let i = 0; i < n; i += step) {
		const px = x(i).toFixed(1)
		const py = y(data[i]).toFixed(1)
		if (!d) d = `M${px},${py}`
		else if (stepped) {
			if (data[i] !== data[i - 1]) d += `H${px}V${py}`
		} else d += `L${px},${py}`
	}
	if (d && stepped && n) d += `H${x(n - 1).toFixed(1)}`
	const last = data[n - 1]

	return (
		<svg className="spark" width={width} height={height} aria-hidden>
			{d && <path d={d} />}
			{dot && last !== undefined && <circle cx={x(n - 1)} cy={y(last)} r={2.25} />}
		</svg>
	)
}

/** A logic block's output while scrubbing: the ten recorded seconds before the playhead. */
function recordedWindow(editor: Editor, id: TLShapeId, port: string) {
	const pb = playback.get()
	if (!pb) return null
	const s = recordedSeries(editor, pb.clipId, id, pb.t, port)
	return s ? s.subarray(Math.max(0, s.length - SAMPLE_HZ * WINDOW_S)) : null
}

/** The ten seconds before the playhead, for an input or for the output it drives. */
function replayWindow(editor: Editor, id: TLShapeId) {
	const pb = playback.get()
	if (!pb || !getClip(editor, pb.clipId)) return null
	const block = getIo(editor, id)
	if (!block || block.type !== 'io') return null
	const keep = SAMPLE_HZ * WINDOW_S
	if (isInput(block.props.kind)) {
		const s = recordedSeries(editor, pb.clipId, id, pb.t)
		return s ? s.subarray(Math.max(0, s.length - keep)) : null
	}
	const wire = getIncomingWire(editor, id)
	const ends = wire && getWireEnds(editor, wire)
	const from = ends?.from
	const s = from && from.type === 'io' && recordedSeries(editor, pb.clipId, from.id, pb.t)
	if (!wire || !from || !s) return null
	const out = simulate(wire.props, portTypeOf(from, ends.fromPort), signalType(block.props.kind), s)
	return out.subarray(Math.max(0, out.length - keep))
}
