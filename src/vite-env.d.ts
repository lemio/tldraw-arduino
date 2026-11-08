/// <reference types="vite/client" />

declare module '@micropython/micropython-webassembly-pyscript' {
	export interface MicroPython {
		runPython(code: string): unknown
		globals: { get(name: string): any }
	}
	export function loadMicroPython(options?: {
		url?: string
		stdout?: (line: string) => void
		stderr?: (line: string) => void
		heapsize?: number
	}): Promise<MicroPython>
}
