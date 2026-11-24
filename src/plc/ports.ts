import type { PortSpec } from '../blocks/define'

/** Ports of the IEC types, named by their formal parameter (IN, PT, Q, CV…). */
type Extra = Partial<Omit<PortSpec, 'id' | 'type' | 'iec'>>

export const BOOL = (id: string, extra: Extra = {}): PortSpec => ({ id, type: 'digital', iec: 'BOOL', default: 0, ...extra })
export const INT = (id: string, extra: Extra = {}): PortSpec => ({ id, type: 'number', iec: 'INT', default: 0, ...extra })
export const REAL = (id: string, extra: Extra = {}): PortSpec => ({ id, type: 'number', iec: 'REAL', default: 0, ...extra })
/** A duration in milliseconds. */
export const TIME = (id: string, extra: Extra = {}): PortSpec => ({ id, type: 'number', iec: 'TIME', default: 0, ...extra })

/** Outputs have no default. */
export const out = (p: PortSpec): PortSpec => ({ ...p, default: undefined })
