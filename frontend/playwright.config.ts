import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(new URL('../.cache/ms-playwright', import.meta.url))
const python = fileURLToPath(new URL(process.platform === 'win32'
  ? '../backend/.venv/Scripts/python.exe' : '../backend/.venv/bin/python', import.meta.url))
const backend = fileURLToPath(new URL('../backend', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:create_app --factory --app-dir "${backend}" --host 127.0.0.1 --port 8011`,
      url: 'http://127.0.0.1:8011/api/v1/health/live',
      env: { APP_ENV: 'test', CORS_ORIGINS: '["http://127.0.0.1:5175"]',
        INFRASTRUCTURE_ENABLED: process.env.PHASE1_INFRA_E2E === '1' ? 'true' : 'false' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5175',
      env: { FRONTEND_HOST: '127.0.0.1', FRONTEND_PORT: '5175', VITE_API_BASE_URL: 'http://127.0.0.1:8011/api/v1' },
      reuseExistingServer: false,
    },
  ],
})
