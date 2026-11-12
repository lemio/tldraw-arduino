import Anthropic from '@anthropic-ai/sdk'
import { Editor, TLShapeId, atom } from 'tldraw'
import { TOOLS, arrange, describeCanvas, describeLibrary, describePins, runTool } from './tools'

/*
 * The assistant: Claude, called straight from this browser with the person's
 * own API key, building on the canvas through the tools in tools.ts. Each
 * request is one undo step. The conversation is local to this browser; what
 * it builds is shared with the room like any other edit.
 */

const MODEL = 'claude-opus-5-5'
const KEY_STORAGE = 'micropython-canvas:anthropic-key'

export type ChatItem =
	| { kind: 'user'; text: string }
	| { kind: 'assistant'; text: string }
	| { kind: 'action'; text: string; error?: boolean }
	| { kind: 'notice'; text: string; error?: boolean }

export const chatLog = atom<ChatItem[]>('chatLog', [])
export const chatBusy = atom<'thinking' | 'asking' | null>('chatBusy', null)
export const chatOpen = atom('chatOpen', false)

function readKey() {
	try {
		return localStorage.getItem(KEY_STORAGE) ?? ''
	} catch {
		return ''
	}
}
export const apiKey = atom('apiKey', readKey())
export function setApiKey(key: string) {
	apiKey.set(key)
	try {
		if (key) localStorage.setItem(KEY_STORAGE, key)
		else localStorage.removeItem(KEY_STORAGE)
	} catch {
		/* storage blocked: the key lasts this visit */
	}
}

let history: Anthropic.Beta.BetaMessageParam[] = []
let current: { abort(): void } | null = null

export function newChat() {
	stopChat()
	history = []
	chatLog.set([])
}

export function stopChat() {
	current?.abort()
	current = null
}

const push = (item: ChatItem) => chatLog.set([...chatLog.get(), item])
/** Grow the assistant's last line as text streams in. */
function appendText(delta: string) {
	const log = chatLog.get()
	const last = log[log.length - 1]
	if (last?.kind === 'assistant') chatLog.set([...log.slice(0, -1), { ...last, text: last.text + delta }])
	else chatLog.set([...log, { kind: 'assistant', text: delta }])
}

function systemPrompt() {
	return `You help people build interactive electronics with an ESP32-S3-DevKitC-1 on a visual canvas. Each block on the canvas is real hardware or a small piece of logic; wires carry signals between them. The canvas runs live in a MicroPython simulator in the browser and is compiled to main.py for the board, so whatever you build works at once.

People ask for features, changes or whole programs in plain words. Build them on the canvas with your tools, then say in one to three sentences what you made and how to try it (which button to press, what to watch). Write for makers and students, not programmers: name things after what they are in the project ("Door switch", "Wake-up alarm"), not after block types.

How to build
- Read the <canvas> in each message first and change what is there rather than duplicating it. Reuse blocks already on the canvas when they fit.
- Prefer library blocks and wire functions. Wires do a lot on their own: thresholds, inverting, toggling on a press, mapping ranges, gamma and easing curves, fading between two colours. Only create a Python block when nothing else does the job; keep it small and give it clear port names.
- Pins: use the pin the person named. The DevKit's BOOT button is GPIO 0 and its RGB LED is GPIO 38, so use those without asking when the person means them. When the pin depends on how they will wire their own hardware and they didn't say, use pin "ask": they pick it on a drawing of the board, so add a short question. Ask one pin at a time, in the order a person would wire them. Use "auto" only for blocks where any free pin is fine.
- An input takes one wire. To combine two HIGH/LOW signals, use logic.gate; its "table" setting is four bits where bit (2a+b) is the output: AND=8, OR=14, XOR=6, NAND=7, NOR=1, XNOR=9.
- After adding Python, check the returned error and fix it.
- If the request is unclear in a way that changes what you'd build, ask one short question instead of guessing.

Signals
Every value is one number. digital: 0 or 1. analog: 0..1 (a knob at half is 0.5; analog out is PWM duty). number: any number (counts, seconds). colour: 0xRRGGBB as an integer. A wire from one type to another casts: digital → analog gives lo/hi; analog → digital is HIGH above threshold; analog/number → colour fades from loColour to hiColour; digital → colour picks loColour/hiColour.

IO block kinds: din (button, switch, on/off sensor), ain (knob, light sensor, soil sensor; analog pins only), dout (LED, relay, buzzer), aout (PWM: dimmable LED, motor speed), rgb (WS2812 colour LED).

Python blocks
Define update(b), called 20 times a second (and optionally setup(b), called once). In it:
  b.get('name')     an input's value          b.set('name', v)   set an output
  b.rose('name')    went HIGH / was pressed    b.fell('name')     went LOW
  b.now()           milliseconds               b.state            a dict kept between calls (JSON values only)
  b.rgb(c) -> (r, g, b)                        b.colour(r, g, b) -> c
Ports are written "name:type=default unit", e.g. "trigger:digital, seconds:number=5 s". No blocking code: never sleep or loop forever; use b.now() and b.state for timing.

Board pins (ESP32-S3-DevKitC-1 headers)
${describePins()}

Library blocks
${describeLibrary()}`
}

/** Make sense of an API error for the chat. */
function explain(e: unknown) {
	if (e instanceof Anthropic.AuthenticationError) return 'The API key was not accepted. Check it under Key.'
	if (e instanceof Anthropic.PermissionDeniedError) return 'This API key may not use this model.'
	if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.'
	if (e instanceof Anthropic.BadRequestError) return `The request was rejected: ${e.message}`
	if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check the connection.'
	if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ''}: ${e.message}`
	return e instanceof Error ? e.message : String(e)
}

export async function sendChat(editor: Editor, text: string) {
	const key = apiKey.get()
	if (!key || chatBusy.get()) return
	const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })

	push({ kind: 'user', text })
	history.push({
		role: 'user',
		content: [
			{ type: 'text', text: `<canvas>\n${JSON.stringify(describeCanvas(editor))}\n</canvas>` },
			{ type: 'text', text },
		],
	})
	// Everything this request builds is one undo step, pins chosen along the way included.
	const mark = editor.markHistoryStoppingPoint('assistant')
	chatBusy.set('thinking')

	let aborted = false
	current = { abort: () => (aborted = true) }
	let jsonRetries = 0
	const made = new Set<TLShapeId>()
	try {
		while (!aborted) {
			const stream = client.beta.messages.stream({
				model: MODEL,
				max_tokens: 64000,
				output_config: { effort: 'medium' },
				betas: ['server-side-fallback-2026-07-01'],
				fallbacks: 'default',
				cache_control: { type: 'ephemeral' },
				system: systemPrompt(),
				tools: TOOLS,
				messages: history,
			})
			current = {
				abort: () => {
					aborted = true
					stream.abort()
				},
			}
			stream.on('text', appendText)

			let message: Anthropic.Beta.BetaMessage
			try {
				message = await stream.finalMessage()
				jsonRetries = 0
			} catch (e) {
				// Only a tool input that couldn't be parsed at all is retried; API errors go up.
				if (aborted || e instanceof Anthropic.APIError || jsonRetries++ >= 2) throw e
				continue
			}

			if (message.stop_reason === 'refusal') {
				push({ kind: 'notice', text: 'Claude declined this request.', error: true })
				history.push({ role: 'assistant', content: message.content })
				break
			}
			if (message.stop_reason === 'pause_turn') {
				history.push({ role: 'assistant', content: message.content })
				continue
			}
			const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
			history.push({ role: 'assistant', content: message.content })
			if (!uses.length) break
			if (message.stop_reason === 'max_tokens') {
				push({ kind: 'notice', text: 'The answer was cut off before it finished. Try a smaller step.', error: true })
				break
			}

			const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
			for (const use of uses) {
				if (aborted) {
					results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Stopped by the user.' })
					continue
				}
				if (use.name === 'add_io_block' || use.name === 'update_block') {
					const pin = (use.input as { pin?: unknown })?.pin
					if (pin === 'ask') chatBusy.set('asking')
				}
				const out = await runTool(editor, use.name, use.input)
				chatBusy.set('thinking')
				if (out.note) push({ kind: 'action', text: out.note, error: out.error })
				if (out.created) made.add(out.created)
				results.push({
					type: 'tool_result',
					tool_use_id: use.id,
					is_error: out.error || undefined,
					content: typeof out.result === 'string' ? out.result : JSON.stringify(out.result),
				})
			}
			history.push({ role: 'user', content: results })
			arrange(editor, made)
		}
		if (aborted) {
			push({ kind: 'notice', text: 'Stopped.' })
			repairHistory()
		}
	} catch (e) {
		if (aborted) push({ kind: 'notice', text: 'Stopped.' })
		else push({ kind: 'notice', text: explain(e), error: true })
		repairHistory()
	} finally {
		arrange(editor, made)
		const shown = [...made].filter((id) => editor.getShape(id))
		const bounds = shown.length && editor.getShapesPageBounds(shown)
		if (bounds) editor.zoomToBounds(bounds.expandBy(96), { animation: { duration: 300 }, targetZoom: 1 })
		editor.squashToMark(mark)
		current = null
		chatBusy.set(null)
	}
}

/**
 * After a failed or stopped request the history may end mid-exchange (a user
 * turn with no answer, or tool calls without results). Drop back to the last
 * complete exchange so the next message starts cleanly.
 */
function repairHistory() {
	while (history.length) {
		const last = history[history.length - 1]
		const pendingTools =
			last.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')
		if (last.role === 'user' || pendingTools) history.pop()
		else break
	}
}
