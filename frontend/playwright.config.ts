import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

process.env.PLAYWRIGHT_BROWSERS_PATH = fileURLToPath(
  new URL('../.cache/ms-playwright', import.meta.url),
)
const python = fileURLToPath(
  new URL(
    process.platform === 'win32'
      ? '../backend/.venv/Scripts/python.exe'
      : '../backend/.venv/bin/python',
    import.meta.url,
  ),
)
const backend = fileURLToPath(new URL('../backend', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5175', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:create_app --factory --app-dir "${backend}" --host 127.0.0.1 --port 8011 --no-proxy-headers`,
      url: 'http://127.0.0.1:8011/api/v1/health/live',
      env: {
        APP_ENV: 'test',
        CORS_ORIGINS: '["http://127.0.0.1:5175"]',
        INFRASTRUCTURE_ENABLED: 'true',
        AUTH_RATE_NAMESPACE: `autoinsight:e2e:${Date.now()}`,
        AUTH_LOGIN_LIMIT: '100',
        AUTH_REGISTER_LIMIT: '100',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5175',
      env: {
        FRONTEND_HOST: '127.0.0.1',
        FRONTEND_PORT: '5175',
        API_PROXY_TARGET: 'http://127.0.0.1:8011',
        VITE_ENABLE_VISUAL_SAMPLES: 'true',
      },
      reuseExistingServer: false,
    },
  ],
})
