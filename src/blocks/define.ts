import type { ReactNode } from 'react'
import type { SignalType } from '../shapes/types'

/*
 * A block is one MicroPython `update(b)` function plus a description of its
 * ports. The same Python runs in the browser (MicroPython compiled to
 * WebAssembly) while you work, and on the board in the generated main.py.
 *
 * Write one by adding a file to src/blocks/library/ that default-exports
 * defineBlock({...}); it appears in the palette under its category. See
 * src/blocks/library/time/wait.ts for a complete example.
 */

export interface PortSpec {
	id: string
	type: SignalType
	/** Shown next to the port; defaults to the id. */
	label?: string
	/** Value of an unconnected input. People can change it on the block. */
	default?: number
	/** Shown after numbers, e.g. 's'. */
	unit?: string
}

/** A button on the block that pulses one of its digital inputs. */
export interface ControlSpec {
	input: string
	label: string
	title?: string
}

export type Tier = 'full' | 'name' | 'value'

/** What a custom renderer gets: everything needed to draw one size of the block. */
export interface RenderContext {
	tier: Tier
	w: number
	h: number
	/** Current values of the outputs, by id. */
	out: Record<string, number>
	/** Current values arriving at the inputs, by id. */
	inputs: Record<string, number>
	/** Values set on the block: unconnected inputs and settings, by id. */
	params: Record<string, number>
	state: Record<string, unknown>
	/** Set an unconnected input's value (as if puppeteered). */
	setParam(input: string, value: number): void
	/** Pulse a digital input, as a control button does. */
	press(input: string): void
}

export interface BlockDef {
	/** Unique and stable, e.g. 'time.wait'. Saved in documents: never rename. */
	id: string
	/** Palette group: 'Time', 'Variables', 'Logic', 'Colour', or a new one. */
	category: string
	title: string
	/** One sentence, shown when hovering the block in the palette. */
	description: string
	/** Prompt for naming it after the real thing, e.g. 'e.g. Wake-up alarm'. */
	example?: string
	inputs: PortSpec[]
	outputs: PortSpec[]
	/** The output shown large on the block, with its sparkline. */
	display: string
	/**
	 * MicroPython. Must define `update(b)`; may define `setup(b)`. In there:
	 *   b.get('in')        an input's value        b.set('out', v)    an output
	 *   b.rose('in')       went HIGH / was pressed b.fell('in')       went LOW
	 *   b.now()            milliseconds            b.state            kept across runs
	 *   b.rgb(c) -> (r, g, b)                      b.colour(r, g, b) -> c
	 */
	python: string
	controls?: ControlSpec[]
	/**
	 * Values set on the block that aren't ports (a gate's truth table, say).
	 * The Python reads them with b.get(id), like inputs; renderers change them
	 * with ctx.setParam(id, value).
	 */
	settings?: { id: string; default: number }[]
	/** Kept for documents that use it, but no longer offered in the palette. */
	hidden?: boolean
	/** Height the full-size layout needs, if a custom render wants more than the ports do. */
	fullHeight?: number
	/** Default width, if not the standard 256. */
	width?: number
	/**
	 * Lay the block out yourself, by its height: where each port sits (y, by
	 * port id) and whether the name header shows. The render then draws over
	 * the whole block, with no port labels, at every size.
	 */
	layout?: { ports(h: number): Record<string, number>; head(h: number): boolean }
	/** Replace the standard body at any of the three sizes. */
	render?: Partial<Record<Tier, (ctx: RenderContext) => ReactNode>>
}

export const defineBlock = (def: BlockDef) => def
