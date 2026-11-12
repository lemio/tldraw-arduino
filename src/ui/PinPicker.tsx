import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TLShapeId, atom, useEditor, useValue } from 'tldraw'
import { BOARD, BOARD_PINS, BoardPin, pinUnavailable } from '../board/board'
import { IO_TYPE, IoShape, KIND_INFO } from '../shapes/types'
import { pinQuestion } from '../ai/askPin'
import { deviceStatus, getScan, scanFloating, scanPins, scanTick } from '../device/host'
import { ADC_FULL_SCALE_V } from '../shapes/types'

/** The block whose pin is being chosen. Local to this browser. */
export const pinPickerFor = atom<TLShapeId | null>('pinPickerFor', null)

/** Room either side of the artwork for naming the blocks that use a pin. */
const MARGIN = 250
/** Artwork height on screen: at most so the silkscreen reads at about UI text size. */
const ART_MAX = 400
const ART_MIN = 240
/** Status line, padding and caret around the artwork. */
const CHROME = 44

/**
 * Choose a pin on the board itself, in a dropdown that hangs from the block's
 * pin chip. Rows a block of this kind can't use are dimmed; every pin already
 * in use carries the name of its block beside the header.
 */
export function PinPicker() {
	const editor = useEditor()
	const id = useValue(pinPickerFor)
	const block = useValue('block', () => (id ? (editor.getShape(id) as IoShape | undefined) : undefined), [editor, id])
	const others = useValue(
		'others',
		() =>
			editor
				.getCurrentPageShapes()
				.filter((s): s is IoShape => s.type === IO_TYPE && s.id !== id && (s as IoShape).props.pin >= 0),
		[editor, id]
	)
	// Follow the chip as the canvas pans and zooms.
	useValue('camera', () => editor.getCamera(), [editor])
	const ref = useRef<HTMLDivElement>(null)
	const [hover, setHover] = useState<BoardPin | null>(null)
	const [shown, setShown] = useState(false)
	const ask = useValue(pinQuestion)
	const live = useValue('live', () => deviceStatus.get().state === 'live', [])
	const floating = useValue(scanFloating)

	useLayoutEffect(() => setShown(!!id), [id])

	// On a live board, read the ADC on every analog pin no block uses, so the
	// picker shows what is connected where.
	const pin0 = block?.props.pin ?? -1
	const taken = others.map((o) => o.props.pin)
	const scan =
		id && live
			? BOARD_PINS.filter((p) => p.gpio !== null && p.gpio >= 1 && p.gpio <= 18 && p.gpio !== pin0 && !taken.includes(p.gpio)).map(
					(p) => p.gpio as number
				)
			: []
	const scanKey = scan.join(',')
	useEffect(() => {
		if (!scanKey) return
		scanPins(scanKey.split(',').map(Number))
		return () => scanPins([])
	}, [scanKey])
	const hoverGpio = hover?.gpio ?? null
	// Keep the status line's reading live while a scanned pin is hovered.
	useValue('hover scan', () => (hoverGpio !== null && scanKey.split(',').includes(String(hoverGpio)) ? scanTick.get() : 0), [
		hoverGpio,
		scanKey,
	])

	useEffect(() => {
		if (!id) return
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent && e.key !== 'Escape') return
			if (e instanceof PointerEvent) {
				const t = e.target as Element
				if (ref.current?.contains(t) || t.closest?.('[data-pin-chip]')) return
			}
			pinPickerFor.set(null)
		}
		window.addEventListener('keydown', close)
		window.addEventListener('pointerdown', close, true)
		return () => {
			window.removeEventListener('keydown', close)
			window.removeEventListener('pointerdown', close, true)
		}
	}, [id])

	useEffect(() => {
		if (id && !block) pinPickerFor.set(null)
	}, [id, block])

	const chip = id && document.querySelector(`[data-pin-chip="${id}"]`)
	if (!id || !block || !chip) return null
	const { kind, pin, label } = block.props
	const name = label || KIND_INFO[kind].title

	const choose = (gpio: number) => {
		editor.markHistoryStoppingPoint('pin')
		editor.updateShape({ id: block.id, type: IO_TYPE, props: { pin: gpio === pin ? -1 : gpio } })
		pinPickerFor.set(null)
	}

	// Hang from the chip like a dropdown, right edges aligned. Open on the side
	// with more room (clear of the top bar and the toolbar), and size the board
	// to fit there.
	const box = editor.getContainer().getBoundingClientRect()
	const c = chip.getBoundingClientRect()
	const chipTop = c.top - box.top
	const chipBottom = c.bottom - box.top
	const roomBelow = box.height - 72 - (chipBottom + 8)
	const roomAbove = chipTop - 8 - 56
	const up = roomBelow < ART_MAX + CHROME && roomAbove > roomBelow
	const artH = Math.round(Math.max(ART_MIN, Math.min(ART_MAX, (up ? roomAbove : roomBelow) - CHROME)))
	const scale = artH / BOARD.h
	const panelW = Math.round((BOARD.w + MARGIN * 2) * scale) + 16
	const question = ask?.id === id ? ask.question : ''
	const panelH = artH + 36 + (question ? 40 : 0) // padding 6 + status 16 + gap 4 + padding 8 + borders 2; the assistant's question
	const chipX = c.left - box.left + c.width / 2
	const left = Math.min(Math.max(8, c.right - box.left + 10 - panelW), box.width - panelW - 8)
	const top = up ? chipTop - 8 - panelH : chipBottom + 8

	const usedBy = new Map<number, string[]>()
	for (const o of others) {
		const list = usedBy.get(o.props.pin) ?? []
		list.push(o.props.label || KIND_INFO[o.props.kind].title)
		usedBy.set(o.props.pin, list)
	}

	let status = kind === 'ain' ? 'Pick a row marked ~' : 'Pick a green row'
	if (hover) {
		const why = pinUnavailable(hover, kind)
		const users = hover.gpio !== null ? usedBy.get(hover.gpio) : undefined
		const gpio = hover.gpio !== null ? `GPIO ${hover.gpio}` : ''
		const reading = hover.gpio !== null && scan.includes(hover.gpio) ? getScan(hover.gpio) : null
		const probe = reading?.length
			? `${(reading[reading.length - 1] * ADC_FULL_SCALE_V).toFixed(2)} V, ${
					floating.includes(hover.gpio!) ? 'nothing connected' : 'something connected'
				}`
			: ''
		status = [
			gpio,
			why ?? (hover.gpio === pin ? 'click to remove' : users ? `also ${users.join(', ')}` : probe || hover.note),
		]
			.filter(Boolean)
			.join(' · ')
	}

	const viewW = BOARD.w + MARGIN * 2
	return (
		<div
			ref={ref}
			className={`picker${up ? ' is-up' : ''}`}
			style={{ left, top, width: panelW, height: panelH, visibility: shown ? 'visible' : 'hidden' }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<i className="picker-caret" style={{ left: chipX - left }} />
			{question && (
				<p className="picker-ask" title={question}>
					<b>Assistant</b> {question}
				</p>
			)}
			<p className="picker-status" title={status}>
				{status}
			</p>
			<svg
				className="picker-board"
				viewBox={`${-MARGIN} 0 ${viewW} ${BOARD.h}`}
				width={viewW * scale}
				height={artH}
				onPointerLeave={() => setHover(null)}
			>
				<image href={BOARD.svg} x={0} y={0} width={BOARD.w} height={BOARD.h} />
				{BOARD_PINS.map((p) => {
					const why = pinUnavailable(p, kind)
					const mine = p.gpio !== null && p.gpio === pin
					const users = p.gpio !== null ? usedBy.get(p.gpio) : undefined
					const cls = ['pin', why && 'is-off', mine && 'is-mine', users && 'is-used', hover === p && !why && 'is-hover']
						.filter(Boolean)
						.join(' ')
					const outside = p.side === 'left' ? -20 : BOARD.w + 20
					const tag = mine ? name : users?.join(', ')
					return (
						<g key={p.id} className={cls} data-pin={p.id}>
							<rect
								x={p.side === 'left' ? 0 : BOARD.w / 2}
								y={p.y - 40}
								width={BOARD.w / 2}
								height={80}
								onPointerEnter={() => setHover(p)}
								onClick={() => !why && p.gpio !== null && choose(p.gpio)}
							/>
							{tag && (
								<text x={outside} y={p.y} textAnchor={p.side === 'left' ? 'end' : 'start'} dominantBaseline="central">
									{tag.length > 11 ? tag.slice(0, 10) + '…' : tag}
								</text>
							)}
						</g>
					)
				})}
				{scan.length > 0 && <ScanTraces gpios={scan} floating={floating} />}
			</svg>
		</div>
	)
}

/** Trace size in artwork px, in the margin beside the header. */
const TRACE_W = 200
const TRACE_H = 64

/**
 * The last seconds of ADC readings beside each free analog pin. Pins that
 * follow the board's own pull resistors have nothing connected and stay
 * faint; the others stand out.
 */
function ScanTraces({ gpios, floating }: { gpios: number[]; floating: number[] }) {
	useValue(scanTick)
	return (
		<g className="picker-scan">
			{gpios.map((g) => {
				const p = BOARD_PINS.find((b) => b.gpio === g)
				const data = getScan(g)
				if (!p || !data?.length) return null
				const left = p.side === 'left'
				const x0 = left ? -20 - TRACE_W : BOARD.w + 20
				const top = p.y - TRACE_H / 2
				const n = data.length
				const x = (i: number) => x0 + TRACE_W - ((n - 1 - i) / 149) * TRACE_W
				const y = (v: number) => top + (1 - Math.max(0, Math.min(1, v))) * TRACE_H
				let d = ''
				for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(data[i]).toFixed(1)}`
				const free = floating.includes(g)
				return (
					<g key={g} className={free ? 'is-floating' : 'is-connected'}>
						<rect x={x0} y={top} width={TRACE_W} height={TRACE_H} />
						<path d={d} />
						<circle cx={x(n - 1)} cy={y(data[n - 1])} r={7} />
					</g>
				)
			})}
		</g>
	)
}
