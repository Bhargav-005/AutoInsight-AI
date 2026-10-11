import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig(({ mode }) => {
  // Read only the public prefix plus the two explicit local server settings.
  const env = loadEnv(mode, root, [
    'VITE_',
    'FRONTEND_HOST',
    'FRONTEND_PORT',
    'API_PROXY_TARGET',
  ])
  const target = env.API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const api = new URL(target)
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) ||
    !['http:', 'https:'].includes(api.protocol) ||
    api.username ||
    api.password
  )
    throw new Error('API proxy must target the local backend.')
  const host = env.FRONTEND_HOST || '127.0.0.1'
  const port = Number(env.FRONTEND_PORT || 5173)
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Frontend must bind to a loopback address in Checkpoint B.')
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('FRONTEND_PORT must be an integer from 1024 to 65535.')
  }
  return {
    plugins: [react()],
    envDir: root,
    server: {
      host,
      port,
      strictPort: true,
      proxy: { '/api/v1': { target, changeOrigin: false } },
    },
    preview: { proxy: { '/api/v1': { target, changeOrigin: false } } },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }
})
