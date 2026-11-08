import { useEffect, useRef, useState } from 'react'
import { Editor, TLShapeId, atom, useValue } from 'tldraw'
import { LOGIC_TYPE, LogicShape } from '../shapes/types'
import { CustomDef, DEFAULT_CUSTOM, formatPorts, parsePorts } from './registry'

/** The Python block being edited, if any. Local to this browser. */
export const editingCustom = atom<TLShapeId | null>('editingCustom', null)

/**
 * Write a block on the canvas: its ports and its MicroPython. Edits are shared
 * with the room as you type and run as soon as they're valid. When it works,
 * "Copy as library block" gives the file to contribute to src/blocks/library.
 */
export function CustomEditor({ editor }: { editor: Editor }) {
	const id = useValue(editingCustom)
	const shape = useValue('shape', () => (id ? (editor.getShape(id) as LogicShape | undefined) : undefined), [editor, id])
	useEffect(() => {
		if (id && !shape) editingCustom.set(null)
	}, [id, shape])
	if (!shape) return null
	return <Form key={shape.id} editor={editor} shape={shape} />
}

function Form({ editor, shape }: { editor: Editor; shape: LogicShape }) {
	const stored = { ...DEFAULT_CUSTOM, ...(shape.props.custom as Partial<CustomDef>) }
	const [draft, setDraft] = useState<CustomDef>(stored)
	const [copied, setCopied] = useState(false)
	const timer = useRef(0)

	// Share edits after a short pause, so collaborators (and the runner) see whole words.
	const change = (patch: Partial<CustomDef>) => {
		const next = { ...draft, ...patch }
		setDraft(next)
		clearTimeout(timer.current)
		timer.current = window.setTimeout(() => {
			editor.markHistoryStoppingPoint('edit python block')
			editor.updateShape({ id: shape.id, type: LOGIC_TYPE, props: { custom: { ...next } } })
		}, 400)
	}
	useEffect(() => () => clearTimeout(timer.current), [])

	const inputs = parsePorts(draft.inputs)
	const outputs = parsePorts(draft.outputs)

	return (
		<aside className="code custom-editor">
			<header>
				<h2>Python block</h2>
				<button
					onClick={async () => {
						await navigator.clipboard.writeText(libraryFile(draft))
						setCopied(true)
						setTimeout(() => setCopied(false), 1500)
					}}
					title="A file for src/blocks/library/, to share this block with everyone"
				>
					{copied ? 'Copied' : 'Copy as library block'}
				</button>
				<button className="code-close" title="Close" onClick={() => editingCustom.set(null)}>
					×
				</button>
			</header>
			<div className="custom-fields">
				<label>
					<span>Title</span>
					<input value={draft.title} onChange={(e) => change({ title: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
				</label>
				<label>
					<span>Inputs</span>
					<input
						value={draft.inputs}
						spellCheck={false}
						placeholder="trigger:digital, seconds:number=5 s"
						onChange={(e) => change({ inputs: e.target.value })}
						onKeyDown={(e) => e.stopPropagation()}
					/>
				</label>
				<label>
					<span>Outputs</span>
					<input
						value={draft.outputs}
						spellCheck={false}
						placeholder="done:digital"
						onChange={(e) => change({ outputs: e.target.value })}
						onKeyDown={(e) => e.stopPropagation()}
					/>
				</label>
				<label>
					<span>Shown</span>
					<select value={draft.display} onChange={(e) => change({ display: e.target.value })}>
						{outputs.map((o) => (
							<option key={o.id} value={o.id}>
								{o.id}
							</option>
						))}
					</select>
				</label>
				<p className="custom-hint">
					Types: digital, analog (0–1), number, colour (0xRRGGBB). Add <code>=value</code> for a default and a unit
					after it. Now: {inputs.length} in, {outputs.length} out.
				</p>
			</div>
			<textarea
				className="custom-code"
				value={draft.python}
				spellCheck={false}
				onChange={(e) => change({ python: e.target.value })}
				onKeyDown={(e) => {
					e.stopPropagation()
					if (e.key === 'Tab') {
						// Python wants spaces: Tab indents by four.
						e.preventDefault()
						const el = e.currentTarget
						const { selectionStart: a, selectionEnd: b, value } = el
						const next = value.slice(0, a) + '    ' + value.slice(b)
						change({ python: next })
						requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4))
					}
				}}
			/>
			<footer className="custom-status">
				{shape.props.error ? <span className="custom-error">{shape.props.error}</span> : <span>Running — no errors</span>}
				<span className="custom-api">
					b.get · b.set · b.rose · b.fell · b.now · b.state · b.rgb · b.colour
				</span>
			</footer>
		</aside>
	)
}

/** The block as a file for the shared library. */
function libraryFile(d: CustomDef) {
	const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block'
	const ports = (spec: string) =>
		parsePorts(spec)
			.map((p) => `\t\t{ id: ${JSON.stringify(p.id)}, type: '${p.type}'${p.default !== undefined ? `, default: ${p.type === 'colour' ? '0x' + p.default.toString(16).padStart(6, '0') : p.default}` : ''}${p.unit ? `, unit: ${JSON.stringify(p.unit)}` : ''} },`)
			.join('\n')
	return `// src/blocks/library/community/${slug}.ts
import { defineBlock } from '../../define'

export default defineBlock({
	id: 'community.${slug}',
	category: 'Community',
	title: ${JSON.stringify(d.title)},
	description: 'Describe what it does in one sentence',
	inputs: [
${ports(d.inputs)}
	],
	outputs: [
${ports(d.outputs)}
	],
	display: ${JSON.stringify(d.display)},
	python: \`
${d.python.replace(/`/g, '\\`').trimEnd()}
\`,
})
`
}

export { formatPorts }
