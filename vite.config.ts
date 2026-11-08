import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [react()],
	// Web Serial and getUserMedia need a secure context; localhost counts as one.
	// Phones on the LAN need HTTPS, so run `npm run dev -- --host` behind a tunnel
	// or deploy the build to an HTTPS host to use them as cameras.
	server: { host: true },
})
